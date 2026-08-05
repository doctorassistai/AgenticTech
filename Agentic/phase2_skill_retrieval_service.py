"""
phase2_skill_retrieval_service.py  (memory-optimised + bug-fixed + ChromaDB vector search
                                     + disease-centric diagnosis retrieval)
============================================================================================
Phase 2 — Clinical RAG Retrieval Engine

CHANGES IN V4 BUILD  (this build)
------------------------------------------------------------------------
V4-1.  NEW: DiseaseCentricDiagnosisRetriever (Section 6D).
       Standard Top-K vector/BM25/graph retrieval answers "what's most
       similar to the query embedding". Diagnosis retrieval needs a
       different question: "which diagnosis skills belong to this
       patient's disease family and are supported by the evidence in
       front of me" — and the answer set size is whatever actually
       exists for that disease (1, 3, 7 — whatever), never a fixed K,
       and never a skill from an unrelated disease.
         - Stage 1: extract disease/subtype/pathology/biomarker/symptom
           evidence terms straight from the existing PatientRetrievalContext
           (no new input shape required).
         - Stage 2: candidate generation restricted to skill_type=diagnosis
           ONLY — treatment skills are structurally unreachable from this
           retriever's mongo queries.
         - Stage 3: weighted evidence-overlap scoring (disease / subtype /
           pathology / biomarker / trigger-keyword match).
         - Stage 4: relevance decision via a *dynamic* threshold computed
           from the score distribution of this query's candidates
           (mean + 0.5*std) — never an absolute magic number.
         - Stage 5: disease-family expansion — once a disease_type clears
           the bar, ALL diagnosis skills for that disease_type are pulled
           in, even ones whose individual keyword overlap was thin.
         - Stage 6: lightweight evidence validation — each returned skill
           carries matched_evidence / missing_evidence for the diagnosis
           agent to cite (Stage 7/8 authority pattern from the design doc).
       This retriever runs IN ADDITION to the existing vector/BM25/graph/
       subtype/cluster retrievers (not instead of) and its results are
       merged into the diagnosis fusion candidate set via
       HybridFusion.fuse_disease_centric(). Diagnosis-side reranking then
       uses a dynamic top_k (= number of disease-centric-relevant skills)
       instead of the fixed FINAL_TOP_K, and disease-centric-flagged
       skills are exempted from the FINAL_MIN_SCORE cutoff so an
       authoritative disease-family skill can never be silently dropped.
       Treatment retrieval/reranking is completely unchanged.

CHANGES IN V3-1 BUILD  (retained, unchanged)
------------------------------------------------------------------------
V3-1.  ChromaRetriever replaces the old Atlas → FAISS → paginated-cosine
       three-tier fallback stack entirely.
         - Single ANN query per skill_type ("diagnosis" | "treatment")
           against a dedicated Chroma collection of skill-level vectors.
         - Chroma's HNSW index already gives O(log N) search — no tiers,
           no per-doctor on-disk FAISS index files, no MongoDB $vectorSearch
           Atlas dependency.
         - Same persistent Chroma store phase1 already uses
           (CHROMA_PERSIST_PATH), just two new collections:
             phase1_diagnosis_skills_vectors
             phase1_treatment_skills_vectors
         - Full skill body is still loaded lazily, only after fusion +
           rerank, exactly as before.

REMOVED (V3-1)
------------------------------------------------------------------------
- VectorSearchRetrieverV2 (Atlas / FAISS / paginated cosine 3-tier stack)
- FaissIndexManager, _LRUIndexCache, all FAISS build/search/load helpers
- COSINE_PAGE_SIZE / COSINE_MAX_PAGES paginated-cosine scan
- FAISS_* env vars and on-disk index files

PREVIOUS FIXES (all retained, unchanged)
-----------------------------------------
Fix 1.  Cluster results wired into fusion
Fix 2.  Graph path lookup uses skill_id fallback
Fix 3.  float16 kept as ndarray (not .tolist())
Fix 4.  Subtype query body-field index note
Fix 5.  Reranker uses _body_summary pre-load
Fix 6.  Threshold fallback sets final_score
Fix 7.  Duplicate graph node lookup eliminated
Fix 8.  (superseded — Chroma failures now logged as warnings directly)
Fix 9.  (superseded — no more paginated cosine fallback needed)
Fix 10. Worker model leak documented

MEMORY OPTIMISATIONS (unchanged)
----------------------------------
1. Singleton Mongo client
2. Lazy full-body loading
3. float16 ndarray embeddings (community cluster centroids)
4. ChromaDB vector search (persistent, on-disk, HNSW-backed)
5. Bug fix: `raw =` assigned
6. Reasoning paths on final only
7. Engine singleton
8. Lean graph projections
9. Community centroid float16

CHROMA SETUP
--------------------------------------------
    pip install chromadb

    # Skill vectors are pushed into Chroma automatically at save time by
    # phase1_knowledge_pipeline_v14.py's save_to_mongodb() — no separate
    # build/backfill step needed for new documents.

ENV VARS (all optional)
------------------------
(none required beyond what phase1_knowledge_pipeline_v14.py already reads —
 CHROMA_PERSIST_PATH is shared from there)
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import math
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional
from rapidfuzz import fuzz
import numpy as np
import chromadb

from Agentic.phase1_knowledge_pipeline import (
    _embed_text as _phase1_embed_text,
    EMBEDDING_MODEL as PHASE1_EMBEDDING_MODEL,
    EMBEDDING_DIMENSION as PHASE1_EMBEDDING_DIM,
    CHROMA_PERSIST_PATH,
)


# ─────────────────────────────────────────────────────────────────
# SINGLETON MONGODB CLIENT
# ─────────────────────────────────────────────────────────────────

MONGO_URI = os.getenv("MONGO_URI", "")
MONGO_DB  = "doctorassistai"

_mongo_client = None

def _get_client():
    global _mongo_client
    if _mongo_client is None:
        from motor.motor_asyncio import AsyncIOMotorClient
        _mongo_client = AsyncIOMotorClient(
            MONGO_URI,
            maxPoolSize=50,
            minPoolSize=2,
            serverSelectionTimeoutMS=5_000,
        )
    return _mongo_client

def get_collection(name: str):
    return _get_client()[MONGO_DB][name]

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────
# CONFIGURATION
# ─────────────────────────────────────────────────────────────────

VECTOR_WEIGHT  = 0.50
BM25_WEIGHT    = 0.30
GRAPH_WEIGHT   = 0.20
SUBTYPE_WEIGHT = 0.20
CLUSTER_WEIGHT = 0.0

VECTOR_TOP_K  = 10
BM25_TOP_K    = 10
GRAPH_TOP_K   = 8
FUSION_TOP_K  = 15
FINAL_TOP_K   = 5

VECTOR_MIN_SCORE = 0.35
BM25_MIN_SCORE   = 0.10
FINAL_MIN_SCORE  = 0.05

# ── Treatment retrieval is intentionally broader than diagnosis retrieval —
# a disease has one diagnosis pathway but many valid treatment skills
# (regimens, stage-specific options, targeted/immuno variants), so a
# narrow top-K silently drops legitimate alternatives.
TREATMENT_VECTOR_TOP_K = 25
TREATMENT_BM25_TOP_K   = 25
TREATMENT_FINAL_TOP_K  = 15

EMBEDDING_DIM = int(os.getenv("EMBEDDING_DIM", str(PHASE1_EMBEDDING_DIM)))  # 3072

# ── ChromaDB skill-vector collections ──────────────────────────────────────
# Separate from phase1's "medical_guidelines" collection (raw document
# sections) — these hold one vector per SKILL, keyed by skill_id, embedded
# from name + description + disease_type/subtype/skill_type + trigger_keywords
# (never skill_md / body — see phase1_knowledge_pipeline_v14.py make_skill()).
SKILL_CHROMA_DIAGNOSIS_COLLECTION = "phase1_diagnosis_skills_vectors"
SKILL_CHROMA_TREATMENT_COLLECTION = "phase1_treatment_skills_vectors"

# Retrieval projection: excludes `body`, `embedding`, and `skill_md`.
# Full body is loaded lazily after final reranking only.
_RETRIEVAL_PROJECTION = {
    "_id":       0,
    "embedding": 0,
    "body":      0,
    "skill_md":  0,
}


# Fix 10: Worker model sharing note.
# Each uvicorn/gunicorn worker loads its own copy of _embed_model (~440 MB).
# To share across workers use:
#   - preload_app=True in gunicorn  (shares before fork, Linux only)
#   - a dedicated embedding microservice  (recommended for >4 workers)


# ─────────────────────────────────────────────────────────────────
# SECTION 1 — DATA STRUCTURES  (unchanged, matched_evidence/missing_evidence
#              fields added to RetrievedSkill so disease-centric output has
#              somewhere to live if callers instantiate this dataclass)
# ─────────────────────────────────────────────────────────────────

@dataclass
class MetadataFilter:
    guideline:  Optional[str] = None
    version:    Optional[str] = None
    specialty:  Optional[str] = None

    def to_mongo_filter(self) -> dict:
        f = {}
        if self.guideline:
            f["guideline"] = {"$regex": re.escape(self.guideline), "$options": "i"}
        if self.version:
            f["guideline_version"] = {"$regex": re.escape(self.version), "$options": "i"}
        if self.specialty:
            f["specialty"] = {"$regex": re.escape(self.specialty), "$options": "i"}
        return f


@dataclass
class PatientRetrievalContext:
    doctor_id:             str
    patient_id:            str
    specialty:             str
    suspected_diseases:    list[str]      = field(default_factory=list)
    confirmed_diagnoses:   list[str]      = field(default_factory=list)
    disease_stage:         str            = ""
    disease_subtype:       str            = ""
    biomarkers:            list[str]      = field(default_factory=list)
    mutations:             list[str]      = field(default_factory=list)
    pathology_findings:    list[str]      = field(default_factory=list)
    symptoms:              list[str]      = field(default_factory=list)
    investigations_done:   list[str]      = field(default_factory=list)
    investigation_results: dict[str, str] = field(default_factory=dict)
    prior_treatments:      list[str]      = field(default_factory=list)
    current_medications:   list[str]      = field(default_factory=list)
    clinical_summary:      str            = ""
    physician_query:       str            = ""
    visit_type:            str            = "first_visit"
    created_at:            str            = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


@dataclass
class RetrievedSkill:
    skill_id:          str
    skill_type:        str
    disease_type:      str
    subtype:           str
    guideline:         str
    guideline_version: str
    trigger_keywords:  list[str]
    source_pages:      list[int]
    confidence:        dict
    vector_score:      float = 0.0
    bm25_score:        float = 0.0
    graph_score:       float = 0.0
    fusion_score:      float = 0.0
    rerank_score:      float = 0.0
    final_score:       float = 0.0
    retrieval_methods: list[str]      = field(default_factory=list)
    body_summary:      dict           = field(default_factory=dict)
    full_body:         Optional[dict] = None
    matched_evidence:  list[str]      = field(default_factory=list)
    missing_evidence:  list[str]      = field(default_factory=list)


@dataclass
class RetrievalResult:
    query_context:     PatientRetrievalContext
    diagnosis_skills:  list[RetrievedSkill]
    treatment_skills:  list[RetrievedSkill]
    context_block:     str
    guidelines_list:   list[dict]
    retrieval_metrics: dict
    retrieval_time_ms: float
    matched_diseases:  list[str]
    retrieval_method:  str


# ─────────────────────────────────────────────────────────────────
# SECTION 2 — EMBEDDING HELPERS  (unchanged)
# ─────────────────────────────────────────────────────────────────

EMBEDDING_MODEL = PHASE1_EMBEDDING_MODEL   # "openai/text-embedding-3-large"

_embed_model    = None   # kept only so /phase2/health doesn't break

def _get_embed_model():
    return bool(os.getenv("OPENAI_API_ROUTER_KEY"))

def _embed(text: str) -> Optional[list[float]]:
    """float32 embedding via OpenRouter — same call phase1 uses. Only ever
    called on short search text (query text, or a skill's name/description/
    keywords) — never on the full skill body."""
    return _phase1_embed_text(text[:8000])

def _embed_float16(text: str) -> Optional[np.ndarray]:
    vec = _phase1_embed_text(text[:8000])
    return np.asarray(vec, dtype=np.float16) if vec is not None else None

def _cosine(a, b) -> float:
    """
    Fix 3 — accepts both ndarray and list[float].
    Upcasts to float32 only for the arithmetic; storage savings preserved upstream.
    Still used by CommunityClusterRetriever's centroid fallback below.
    """
    if a is None or b is None:
        return 0.0
    av = np.asarray(a, dtype=np.float32)
    bv = np.asarray(b, dtype=np.float32)
    denom = (np.linalg.norm(av) * np.linalg.norm(bv)) + 1e-9
    return float(np.dot(av, bv) / denom)


# ─────────────────────────────────────────────────────────────────
# SECTION 3 — QUERY GENERATOR  (unchanged)
# ─────────────────────────────────────────────────────────────────

class QueryGenerator:
    _GENE_PATTERN      = re.compile(r'\b(BRCA[12]?|HER2?|EGFR|ALK|ROS1|KRAS|NRAS|BRAF|PIK3CA|ESR1|ERBB2|TP53|ATM|CDH1|PALB2|CHEK2)\b', re.I)
    _STAGE_PATTERN     = re.compile(r'\b(stage\s+[IVX]+[ABC]?|T[0-4][a-z]?N[0-3]M[01]|pT[0-4]|cT[0-4])\b', re.I)
    _DRUG_PATTERN      = re.compile(r'\b(trastuzumab|pertuzumab|tamoxifen|letrozole|anastrozole|capecitabine|paclitaxel|docetaxel|carboplatin|cisplatin|cyclophosphamide|olaparib|pembrolizumab|atezolizumab|bevacizumab|lapatinib|neratinib|tucatinib|sacituzumab|T-DXd|ribociclib|palbociclib|abemaciclib|everolimus|alpelisib|elacestrant|fulvestrant)\b', re.I)
    _BIOMARKER_PATTERN = re.compile(r'\b(ER\+|PR\+|HER2\+|HER2-low|triple.negative|TNBC|HR\+|MSI-H|MMR-d|PD-L1|TMB|ctDNA|Ki67|Oncotype)\b', re.I)

    def generate(self, ctx: PatientRetrievalContext) -> dict[str, Any]:
        all_diseases = list(dict.fromkeys(ctx.suspected_diseases + ctx.confirmed_diagnoses))
        primary = all_diseases[0] if all_diseases else ""

        vector_parts = []
        if primary:
            vector_parts.append(f"{primary} clinical diagnosis treatment management")
        if ctx.disease_stage:
            vector_parts.append(f"stage {ctx.disease_stage}")
        if ctx.disease_subtype:
            vector_parts.append(ctx.disease_subtype)
        if ctx.biomarkers:
            vector_parts.append(f"biomarkers: {' '.join(ctx.biomarkers[:5])}")
        if ctx.specialty:
            vector_parts.append(ctx.specialty)
        if ctx.symptoms:
            vector_parts.append(f"symptoms: {' '.join(ctx.symptoms[:5])}")
        if ctx.pathology_findings:
            vector_parts.append(f"pathology: {' '.join(ctx.pathology_findings[:3])}")
        if ctx.physician_query:
            vector_parts.append(ctx.physician_query)
        if ctx.clinical_summary:
            vector_parts.append(ctx.clinical_summary[:300])
        vector_query = " ".join(vector_parts)

        all_text = " ".join([
            " ".join(all_diseases),
            " ".join(ctx.biomarkers),
            " ".join(ctx.mutations),
            " ".join(ctx.pathology_findings),
            " ".join(ctx.prior_treatments),
            ctx.disease_stage,
            ctx.disease_subtype,
            ctx.physician_query,
            ctx.clinical_summary[:500],
        ])

        bm25_terms = list(dict.fromkeys(
            self._GENE_PATTERN.findall(all_text)
            + self._STAGE_PATTERN.findall(all_text)
            + self._DRUG_PATTERN.findall(all_text)
            + self._BIOMARKER_PATTERN.findall(all_text)
            + [d for d in all_diseases if d]
            + ctx.biomarkers[:5]
        ))

        graph_entities = {
            "diseases":   all_diseases[:4],
            "subtypes":   [ctx.disease_subtype] if ctx.disease_subtype else [],
            "stages":     [ctx.disease_stage]   if ctx.disease_stage   else [],
            "biomarkers": ctx.biomarkers[:6],
            "drugs":      ctx.current_medications[:5] + ctx.prior_treatments[:3],
        }

        logger.debug(
            f"[QueryGen] primary='{primary}' | "
            f"vector_len={len(vector_query)} | "
            f"bm25_terms={len(bm25_terms)} | "
            f"graph_entities={sum(len(v) for v in graph_entities.values())}"
        )

        return {
            "vector_query":    vector_query,
            "bm25_terms":      bm25_terms,
            "graph_entities":  graph_entities,
            "primary_disease": primary,
            "all_diseases":    all_diseases,
        }


# ─────────────────────────────────────────────────────────────────
# SECTION 4 — VECTOR SEARCH RETRIEVER  (ChromaDB, single-tier)  ← V3-1
#
# Replaces the old Atlas → FAISS → paginated-cosine 3-tier fallback ladder.
# ChromaDB's HNSW index already gives O(log N) ANN search, so there's no
# need for tiers or on-disk per-doctor FAISS files — one query per
# skill_type collection, then a lightweight Mongo lookup for metadata.
# ─────────────────────────────────────────────────────────────────

_skill_chroma_client = None
_skill_chroma_collections: dict[str, Any] = {}

def _get_skill_chroma_collection(skill_type: str):
    """
    skill_type: "diagnosis" | "treatment"
    Lazily opens the persistent Chroma client (same on-disk store as
    phase1's guideline-section collection) and caches the two skill
    collections by name.
    """
    global _skill_chroma_client
    if _skill_chroma_client is None:
        _skill_chroma_client = chromadb.PersistentClient(path=CHROMA_PERSIST_PATH)

    name = (
        SKILL_CHROMA_DIAGNOSIS_COLLECTION if skill_type == "diagnosis"
        else SKILL_CHROMA_TREATMENT_COLLECTION
    )
    if name not in _skill_chroma_collections:
        _skill_chroma_collections[name] = _skill_chroma_client.get_or_create_collection(name)
    return _skill_chroma_collections[name]


class ChromaRetriever:
    """
    Single-tier semantic retrieval via ChromaDB.

    Flow per skill_type ("diagnosis" | "treatment"):
      1. Embed the query once (same OpenRouter model phase1 uses).
      2. Query the doctor-scoped Chroma collection for the nearest skill_ids.
         (Vectors were written at save time from name + description +
         disease_type/subtype/skill_type + trigger_keywords — see
         phase1_knowledge_pipeline_v14.py's make_skill()/save_to_mongodb().)
      3. Fetch those skill_ids' lightweight metadata from Mongo (never
         body/skill_md — see _RETRIEVAL_PROJECTION), applying any
         guideline/version/specialty filter at this step.
      4. Attach score + retrieval method tag, filter by VECTOR_MIN_SCORE,
         sort, truncate to top_k.
    """

    async def retrieve(
        self,
        query:            str,
        doctor_id:        str,
        top_k:            int = VECTOR_TOP_K,
        treatment_top_k:  Optional[int] = None,
        metadata_filter:  Optional[MetadataFilter] = None,
    ) -> dict[str, list[dict]]:
        top_k = top_k or VECTOR_TOP_K
        treatment_top_k = treatment_top_k or TREATMENT_VECTOR_TOP_K

        query_vec = _embed(query)
        if not query_vec:
            logger.warning("[ChromaRetriever] No embedding — skipping vector search")
            return {"diagnosis": [], "treatment": []}

        diag, treat = await asyncio.gather(
            self._search_collection("diagnosis", query_vec, doctor_id, top_k, metadata_filter),
            self._search_collection("treatment", query_vec, doctor_id, treatment_top_k, metadata_filter),
        )
        return {"diagnosis": diag, "treatment": treat}

    async def _search_collection(
        self,
        skill_type:      str,
        query_vec:       list[float],
        doctor_id:       str,
        top_k:           int,
        metadata_filter: Optional[MetadataFilter],
    ) -> list[dict]:
        loop = asyncio.get_event_loop()
        try:
            collection = _get_skill_chroma_collection(skill_type)
            results = await loop.run_in_executor(
                None,
                lambda: collection.query(
                    query_embeddings=[query_vec],
                    n_results=top_k * 4,   # over-fetch; Mongo-side filters may drop some
                    where={"doctor_id": doctor_id},
                ),
            )
        except Exception as e:
            logger.warning(f"[ChromaRetriever] query failed ({skill_type}): {e}")
            return []

        ids       = (results.get("ids") or [[]])[0]
        distances = (results.get("distances") or [[]])[0]
        if not ids:
            return []

        # Chroma's default distance is L2; convert to the same 0..1
        # similarity scale phase1 already uses for guideline-section
        # search, so VECTOR_MIN_SCORE stays comparable across the codebase.
        score_map = {sid: max(0.0, 1.0 - (dist / 2.0)) for sid, dist in zip(ids, distances)}

        collection_name = (
            "phase1_diagnosis_skills" if skill_type == "diagnosis" else "phase1_treatment_skills"
        )
        mongo_coll  = get_collection(collection_name)
        base_filter: dict = {"doctor_id": doctor_id}
        if metadata_filter:
            base_filter.update(metadata_filter.to_mongo_filter())

        docs = await mongo_coll.find(
            {**base_filter, "$or": [{"skill_id": {"$in": ids}}, {"doc_id": {"$in": ids}}]},
            _RETRIEVAL_PROJECTION,
        ).to_list(length=len(ids))

        hits = []
        for d in docs:
            sid   = d.get("skill_id") or d.get("doc_id", "")
            score = score_map.get(sid, 0.0)
            if score < VECTOR_MIN_SCORE:
                continue
            d["score"]             = round(score, 4)
            d["_retrieval_method"] = "vector_chroma"
            hits.append(d)

        hits.sort(key=lambda x: x["score"], reverse=True)
        logger.debug(f"[ChromaRetriever] {skill_type}: {len(hits)}/{len(ids)} above threshold")
        return hits[:top_k]


# Backward-compatible alias so any code doing
#   from phase2_skill_retrieval_service import VectorSearchRetriever
# still works without changes.
VectorSearchRetriever = ChromaRetriever


# ─────────────────────────────────────────────────────────────────
# SECTION 5 — BM25 KEYWORD RETRIEVER  (unchanged)
# ─────────────────────────────────────────────────────────────────

class BM25KeywordRetriever:

    def __init__(self):
        self.k1 = 1.5
        self.b  = 0.75

    async def retrieve(
        self,
        terms:            list[str],
        doctor_id:        str,
        top_k:            int = BM25_TOP_K,
        treatment_top_k:  Optional[int] = None,
        metadata_filter:  Optional[MetadataFilter] = None,
    ) -> dict[str, list[dict]]:
        if not terms:
            return {"diagnosis": [], "treatment": []}

        treatment_top_k = treatment_top_k or TREATMENT_BM25_TOP_K

        diag, treat = await asyncio.gather(
            self._search_collection("phase1_diagnosis_skills", terms, doctor_id, top_k, metadata_filter),
            self._search_collection("phase1_treatment_skills", terms, doctor_id, treatment_top_k, metadata_filter),
        )
        return {"diagnosis": diag, "treatment": treat}

    async def _search_collection(
        self,
        collection_name: str,
        terms:           list[str],
        doctor_id:       str,
        top_k:           int,
        metadata_filter: Optional[MetadataFilter],
    ) -> list[dict]:
        coll = get_collection(collection_name)
        base_filter = {"doctor_id": doctor_id}
        if metadata_filter:
            base_filter.update(metadata_filter.to_mongo_filter())

        try:
            term_patterns = [re.escape(t.strip()) for t in terms if t.strip()]
            if not term_patterns:
                return []

            combined_regex = "|".join(term_patterns)
            query = {
                **base_filter,
                "$or": [
                    {"disease_type":     {"$regex": combined_regex, "$options": "i"}},
                    {"subtype":          {"$regex": combined_regex, "$options": "i"}},
                    {"trigger_keywords": {"$elemMatch": {"$regex": combined_regex, "$options": "i"}}},
                    {"name":             {"$regex": combined_regex, "$options": "i"}},
                ],
            }

            projection = {"_id": 0, "embedding": 0, "body": 0, "skill_md": 0}  # pure exclusion; _body_summary included by default
            raw = await coll.find(query, projection).to_list(length=top_k * 3)

            scored = []
            for doc in raw:
                bm25 = self._score_document(doc, terms)
                if bm25 >= BM25_MIN_SCORE:
                    doc["score"] = round(bm25, 4)
                    doc["_retrieval_method"] = "bm25"
                    scored.append(doc)

            scored.sort(key=lambda x: x["score"], reverse=True)
            logger.debug(f"[BM25Retriever] {len(scored[:top_k])} from {collection_name}")
            return scored[:top_k]

        except Exception as e:
            logger.error(f"[BM25Retriever] Search failed: {e}")
            return []

    def _score_document(self, doc: dict, query_terms: list[str]) -> float:
        token_counts: dict[str, float] = defaultdict(float)

        def _add_tokens(text: str, weight: float):
            if not text:
                return
            for tok in re.findall(r"\w+", text.lower()):
                token_counts[tok] += weight

        _add_tokens(doc.get("disease_type", ""), weight=3.0)
        _add_tokens(doc.get("subtype", ""),       weight=2.5)
        for kw in doc.get("trigger_keywords", []):
            _add_tokens(kw,                        weight=2.0)
        _add_tokens(doc.get("name", ""),           weight=1.5)
        _add_tokens(doc.get("guideline", ""),      weight=1.0)

        doc_len = sum(token_counts.values())
        avg_len = 20.0
        score   = 0.0

        for term in query_terms:
            term_lower = term.lower()
            tf = token_counts.get(term_lower, 0.0)
            if tf == 0:
                for tok, cnt in token_counts.items():
                    if term_lower in tok or tok in term_lower:
                        tf = max(tf, cnt * 0.5)

            if tf > 0:
                tf_norm = (tf * (self.k1 + 1)) / (
                    tf + self.k1 * (1 - self.b + self.b * doc_len / avg_len)
                )
                score += 1.0 * tf_norm

        return min(score / max(len(query_terms), 1), 1.0)


# ─────────────────────────────────────────────────────────────────
# SECTION 6 — GRAPH TRAVERSAL RETRIEVER  (unchanged)
# ─────────────────────────────────────────────────────────────────

class GraphTraversalRetriever:

    async def retrieve(
        self,
        graph_entities:  dict[str, list[str]],
        doctor_id:       str,
        top_k:           int = GRAPH_TOP_K,
        metadata_filter: Optional[MetadataFilter] = None,
        matched_nodes:   Optional[list[dict]] = None,
    ) -> dict[str, list[dict]]:
        if not any(graph_entities.values()):
            return {"diagnosis": [], "treatment": []}

        if matched_nodes is None:
            matched_nodes = await self._find_nodes(graph_entities, doctor_id, metadata_filter)
        if not matched_nodes:
            return {"diagnosis": [], "treatment": []}

        skill_scores = await self._traverse_to_skills(matched_nodes, doctor_id, metadata_filter)
        if not skill_scores:
            return {"diagnosis": [], "treatment": []}

        diag, treat = await asyncio.gather(
            self._fetch_skills_by_ids("phase1_diagnosis_skills", skill_scores, doctor_id, metadata_filter),
            self._fetch_skills_by_ids("phase1_treatment_skills", skill_scores, doctor_id, metadata_filter),
        )
        return {"diagnosis": diag[:top_k], "treatment": treat[:top_k]}

    async def _find_nodes(
        self,
        graph_entities:  dict[str, list[str]],
        doctor_id:       str,
        metadata_filter: Optional[MetadataFilter],
    ) -> list[dict]:
        coll = get_collection("phase1_graph_nodes")
        base_filter = {"doctor_id": doctor_id}
        if metadata_filter:
            base_filter.update(metadata_filter.to_mongo_filter())

        try:
            all_names = [e for entities in graph_entities.values() for e in entities if e]
            if not all_names:
                return []

            pattern = "|".join(re.escape(n) for n in all_names if n.strip())
            nodes = await coll.find(
                {**base_filter, "name": {"$regex": pattern, "$options": "i"}},
                {"_id": 0}
            ).to_list(length=50)

            entity_priority = {
                "diseases": 3.0, "subtypes": 2.5, "biomarkers": 2.0,
                "stages": 2.0, "drugs": 1.5,
            }
            for node in nodes:
                node_name_lower = node.get("name", "").lower()
                best = 0.0
                for etype, entities in graph_entities.items():
                    base = entity_priority.get(etype, 1.0)
                    for e in entities:
                        if e and (e.lower() in node_name_lower or node_name_lower in e.lower()):
                            s = base * (1.0 if e.lower() == node_name_lower else 0.7)
                            best = max(best, s)
                node["_graph_score"] = best

            # ✅ CRITICAL FIX: Use .get() with default to avoid dict comparison
            nodes.sort(key=lambda x: x.get("_graph_score", 0.0), reverse=True)
            logger.debug(f"[GraphRetriever] Found {len(nodes)} graph nodes")
            return nodes[:20]

        except Exception as e:
            logger.error(f"[GraphRetriever] Node lookup failed: {e}")
            return []

    async def _traverse_to_skills(
        self,
        nodes:           list[dict],
        doctor_id:       str,
        metadata_filter: Optional[MetadataFilter],
    ) -> dict[str, float]:
        edges_coll = get_collection("phase1_graph_edges")
        nodes_coll = get_collection("phase1_graph_nodes")
        base_filter = {"doctor_id": doctor_id}
        if metadata_filter:
            base_filter.update(metadata_filter.to_mongo_filter())

        skill_scores: dict[str, float] = {}
        try:
            # ✅ FIX: Safely extract indices
            node_indices = []
            node_scores = {}
            for n in nodes:
                idx = n.get("index")
                if idx is not None:
                    node_indices.append(idx)
                    node_scores[idx] = n.get("_graph_score", 1.0)

            if not node_indices:
                return {}

            direct_edges = await edges_coll.find(
                {**base_filter, "from": {"$in": node_indices}},
                {"_id": 0, "from": 1, "to": 1}
            ).to_list(length=200)

            # Safely extract 'to' values
            hop1_indices = []
            for e in direct_edges:
                to_idx = e.get("to")
                if to_idx is not None:
                    hop1_indices.append(to_idx)
            hop1_indices = list(set(hop1_indices))

            hop2_edges = []
            if hop1_indices:
                hop2_edges = await edges_coll.find(
                    {**base_filter, "from": {"$in": hop1_indices[:30]}},
                    {"_id": 0, "from": 1, "to": 1}
                ).to_list(length=200)

            all_connected = hop1_indices.copy()
            for e in hop2_edges:
                to_idx = e.get("to")
                if to_idx is not None:
                    all_connected.append(to_idx)
            all_connected = list(set(all_connected))

            if not all_connected:
                return {}

            skill_nodes = await nodes_coll.find(
                {
                    **base_filter,
                    "index": {"$in": all_connected},
                    "type":  {"$in": ["skill", "disease", "subtype", "stage", "regimen"]},
                },
                {"_id": 0, "index": 1, "doc_id": 1, "skill_id": 1, "type": 1}
            ).to_list(length=100)

            # Create a set of 'to' values from direct_edges for O(1) lookup
            direct_to_set = {e.get("to") for e in direct_edges if e.get("to") is not None}
            
            for n in skill_nodes:
                idx = n.get("index")
                doc_id = n.get("doc_id") or n.get("skill_id", "")
                
                if idx is not None and doc_id:
                    if idx in direct_to_set:
                        # Find the parent score
                        parent_score = 0.0
                        for e in direct_edges:
                            if e.get("to") == idx:
                                parent_idx = e.get("from")
                                if parent_idx in node_scores:
                                    parent_score = max(parent_score, node_scores[parent_idx] * 0.7)
                        final_score = max(parent_score, 0.4)
                    else:
                        final_score = 0.4
                        
                    skill_scores[doc_id] = max(skill_scores.get(doc_id, 0.0), final_score)

            logger.debug(f"[GraphRetriever] Traversal found {len(skill_scores)} doc_ids")
            return skill_scores

        except Exception as e:
            logger.error(f"[GraphRetriever] Traversal failed: {e}")
            return {}

    async def _fetch_skills_by_ids(
        self,
        collection_name: str,
        skill_scores:    dict[str, float],
        doctor_id:       str,
        metadata_filter: Optional[MetadataFilter],
    ) -> list[dict]:
        if not skill_scores:
            return []

        coll = get_collection(collection_name)
        base_filter = {"doctor_id": doctor_id}
        if metadata_filter:
            base_filter.update(metadata_filter.to_mongo_filter())

        try:
            id_list = list(skill_scores.keys())
            query = {
                **base_filter,
                "$or": [
                    {"doc_id":   {"$in": id_list}},
                    {"skill_id": {"$in": id_list}},
                ],
            }
            projection = {"_id": 0, "embedding": 0, "body": 0, "skill_md": 0}
            docs = await coll.find(query, projection).to_list(length=50)

            for doc in docs:
                resolved_id = doc.get("doc_id") or doc.get("skill_id", "")
                doc["score"] = round(skill_scores.get(resolved_id, 0.4), 4)
                doc["_retrieval_method"] = "graph"

            doc_ids_list = [doc.get("doc_id") or doc.get("skill_id", "") for doc in docs]
            pagerank_map = await self._get_pagerank_scores(doc_ids_list, doctor_id)

            PAGERANK_ALPHA = 0.3
            for doc in docs:
                resolved_id     = doc.get("doc_id") or doc.get("skill_id", "")
                proximity_score = doc.get("score", 0.4)
                pr_score        = pagerank_map.get(resolved_id, 0.5)
                doc["score"]          = round(
                    proximity_score * (1 - PAGERANK_ALPHA) + pr_score * PAGERANK_ALPHA, 4
                )
                doc["pagerank_score"] = pr_score

            docs.sort(key=lambda x: x["score"], reverse=True)
            return docs

        except Exception as e:
            logger.error(f"[GraphRetriever] Skill fetch failed: {e}")
            return []

    async def _get_pagerank_scores(
        self,
        doc_ids:   list[str],
        doctor_id: str,
    ) -> dict[str, float]:
        coll = get_collection("phase1_graph_nodes")
        try:
            nodes = await coll.find(
                {"doctor_id": doctor_id,
                 "$or": [
                     {"doc_id":   {"$in": doc_ids}},
                     {"skill_id": {"$in": doc_ids}},
                 ]},
                {"_id": 0, "doc_id": 1, "skill_id": 1, "pagerank_score": 1}
            ).to_list(length=len(doc_ids))

            raw_scores = {}
            for n in nodes:
                key = n.get("doc_id") or n.get("skill_id", "")
                if key:
                    raw_scores[key] = n.get("pagerank_score", 0.0)

            if not raw_scores:
                return {}
            max_pr = max(raw_scores.values()) or 1.0
            return {k: round(v / max_pr, 4) for k, v in raw_scores.items()}

        except Exception as e:
            logger.error(f"[GraphRetriever] PageRank fetch failed: {e}")
            return {}

    async def build_reasoning_paths_for_final(
        self,
        skill_doc_ids: list[str],
        matched_nodes: list[dict],
        doctor_id:     str,
    ) -> dict[str, list[dict]]:
        results = await asyncio.gather(*[
            self._build_reasoning_path(doc_id, matched_nodes, doctor_id)
            for doc_id in skill_doc_ids
        ])
        return dict(zip(skill_doc_ids, results))

    async def _build_reasoning_path(
        self,
        skill_doc_id:  str,
        matched_nodes: list[dict],
        doctor_id:     str,
    ) -> list[dict]:
        edges_coll = get_collection("phase1_graph_edges")
        nodes_coll = get_collection("phase1_graph_nodes")

        try:
            skill_node = await nodes_coll.find_one(
                {"doctor_id": doctor_id,
                 "$or": [
                     {"doc_id":   skill_doc_id},
                     {"skill_id": skill_doc_id},
                 ]},
                {"_id": 0, "index": 1}
            )
            if not skill_node:
                return []

            skill_idx        = skill_node.get("index")
            all_node_indices = [n.get("index") for n in matched_nodes if n.get("index")]
            all_node_indices.append(skill_idx)

            edges = await edges_coll.find(
                {"doctor_id": doctor_id,
                 "$or": [
                     {"from": {"$in": all_node_indices}},
                     {"to":   {"$in": all_node_indices}},
                 ]},
                {"_id": 0, "from": 1, "to": 1}
            ).to_list(length=300)

            reverse_adj: dict[int, list[int]] = defaultdict(list)
            for e in edges:
                reverse_adj[e.get("to", -1)].append(e.get("from", -1))

            start_indices = {n.get("index") for n in matched_nodes}
            visited   = {skill_idx}
            queue     = [(skill_idx, [skill_idx])]
            best_path = None

            while queue:
                current, path = queue.pop(0)
                if current in start_indices:
                    best_path = path[::-1]
                    break
                if len(path) >= 5:
                    continue
                for parent in reverse_adj.get(current, []):
                    if parent not in visited:
                        visited.add(parent)
                        queue.append((parent, path + [parent]))

            if not best_path:
                return []

            path_nodes = await nodes_coll.find(
                {"doctor_id": doctor_id, "index": {"$in": best_path}},
                {"_id": 0, "index": 1, "name": 1, "type": 1}
            ).to_list(length=10)

            idx_to_node = {n.get("index"): n for n in path_nodes}
            return [
                {"node": idx_to_node.get(idx, {}).get("name", str(idx)),
                 "type": idx_to_node.get(idx, {}).get("type", "unknown"),
                 "hop":  hop}
                for hop, idx in enumerate(best_path)
            ]

        except Exception as e:
            logger.error(f"[GraphRetriever] Path build failed: {e}")
            return []


# ─────────────────────────────────────────────────────────────────
# SECTION 6B — SUBTYPE RETRIEVAL AGENT  (unchanged)
# ─────────────────────────────────────────────────────────────────

class SubtypeRetrievalAgent:
    """
    Fix 4 — compound index hints:
        db.phase1_diagnosis_skills.createIndex(
            {"doctor_id":1, "body.stage_wise_treatment.stage":1})
        db.phase1_treatment_skills.createIndex(
            {"doctor_id":1, "body.biomarkers.name":1})
    """

    async def retrieve(
        self,
        ctx:             PatientRetrievalContext,
        top_k:           int = 8,
        metadata_filter: Optional[MetadataFilter] = None,
    ) -> dict[str, list[dict]]:
        if not ctx.suspected_diseases:
            return {"diagnosis": [], "treatment": []}

        hierarchy = await self._resolve_hierarchy(ctx, metadata_filter)
        if not hierarchy:
            return {"diagnosis": [], "treatment": []}

        diag, treat = await asyncio.gather(
            self._fetch_skills_for_hierarchy("phase1_diagnosis_skills", hierarchy, ctx.doctor_id, top_k, metadata_filter),
            self._fetch_skills_for_hierarchy("phase1_treatment_skills", hierarchy, ctx.doctor_id, top_k, metadata_filter),
        )
        logger.debug(
            f"[SubtypeAgent] hierarchy_depth={len(hierarchy)} | "
            f"diag={len(diag)} treat={len(treat)}"
        )
        return {"diagnosis": diag, "treatment": treat}

    async def _resolve_hierarchy(
        self,
        ctx:             PatientRetrievalContext,
        metadata_filter: Optional[MetadataFilter],
    ) -> list[dict]:
        coll = get_collection("phase1_subtype_taxonomy")
        try:
            base_filter = {"doctor_id": ctx.doctor_id}
            if metadata_filter:
                base_filter.update(metadata_filter.to_mongo_filter())

            hierarchy: list[dict] = []

            disease_pattern = "|".join(re.escape(d) for d in ctx.suspected_diseases[:3] if d)
            if not disease_pattern:
                return []

            disease_nodes = await coll.find(
                {**base_filter, "level": "disease",
                 "name": {"$regex": disease_pattern, "$options": "i"}},
                {"_id": 0}
            ).to_list(length=5)

            if not disease_nodes:
                return []

            best_disease = max(disease_nodes, key=lambda n: n.get("node_score", 1.0))
            best_disease["_hierarchy_score"] = 1.0
            hierarchy.append(best_disease)
            parent_id = best_disease.get("node_id")

            if ctx.disease_subtype:
                subtype_nodes = await coll.find(
                    {**base_filter, "level": "subtype", "parent_id": parent_id,
                     "name": {"$regex": re.escape(ctx.disease_subtype), "$options": "i"}},
                    {"_id": 0}
                ).to_list(length=5)

                if not subtype_nodes and ctx.biomarkers:
                    bm_pattern = "|".join(re.escape(b) for b in ctx.biomarkers[:4])
                    subtype_nodes = await coll.find(
                        {**base_filter, "level": "subtype", "parent_id": parent_id,
                         "name": {"$regex": bm_pattern, "$options": "i"}},
                        {"_id": 0}
                    ).to_list(length=5)

                if subtype_nodes:
                    best = max(subtype_nodes, key=lambda n: n.get("node_score", 1.0))
                    best["_hierarchy_score"] = 0.9
                    hierarchy.append(best)
                    parent_id = best.get("node_id")

            if ctx.disease_stage and parent_id:
                stage_nodes = await coll.find(
                    {**base_filter, "level": "stage", "parent_id": parent_id,
                     "name": {"$regex": re.escape(ctx.disease_stage), "$options": "i"}},
                    {"_id": 0}
                ).to_list(length=3)
                if stage_nodes:
                    best = max(stage_nodes, key=lambda n: n.get("node_score", 1.0))
                    best["_hierarchy_score"] = 0.8
                    hierarchy.append(best)
                    parent_id = best.get("node_id")

            if ctx.biomarkers and parent_id:
                bm_pattern = "|".join(re.escape(b) for b in ctx.biomarkers[:5])
                biomarker_nodes = await coll.find(
                    {**base_filter, "level": "biomarker", "parent_id": parent_id,
                     "name": {"$regex": bm_pattern, "$options": "i"}},
                    {"_id": 0}
                ).limit(4).to_list(length=4)
                for bn in biomarker_nodes:
                    bn["_hierarchy_score"] = 0.7
                hierarchy.extend(biomarker_nodes)

            return hierarchy

        except Exception as e:
            logger.error(f"[SubtypeAgent] Hierarchy resolution failed: {e}")
            return []

    async def _fetch_skills_for_hierarchy(
        self,
        collection_name: str,
        hierarchy:       list[dict],
        doctor_id:       str,
        top_k:           int,
        metadata_filter: Optional[MetadataFilter],
    ) -> list[dict]:
        coll = get_collection(collection_name)
        try:
            or_conditions = []
            for node in hierarchy:
                level = node.get("level", "")
                name  = node.get("name", "")
                if level == "disease":
                    or_conditions.append({"disease_type": {"$regex": re.escape(name), "$options": "i"}})
                elif level == "subtype":
                    or_conditions.append({"subtype": {"$regex": re.escape(name), "$options": "i"}})
                elif level == "stage":
                    or_conditions.append({"body.stage_wise_treatment.stage": {"$regex": re.escape(name), "$options": "i"}})
                elif level == "biomarker":
                    or_conditions.append({"body.biomarkers.name": {"$regex": re.escape(name), "$options": "i"}})

            if not or_conditions:
                return []

            base_filter = {"doctor_id": doctor_id, "$or": or_conditions}
            if metadata_filter:
                base_filter.update(metadata_filter.to_mongo_filter())

            projection = {"_id": 0, "embedding": 0, "body": 0, "skill_md": 0}
            docs = await coll.find(base_filter, projection).to_list(length=top_k * 3)

            level_weights = {"disease": 0.4, "subtype": 0.9, "stage": 0.8, "biomarker": 0.7}
            for doc in docs:
                best = 0.0
                for node in hierarchy:
                    level  = node.get("level", "")
                    name   = node.get("name", "").lower()
                    weight = level_weights.get(level, 0.5) * node.get("_hierarchy_score", 0.5)
                    match_fields = [
                        str(doc.get("disease_type", "")).lower(),
                        str(doc.get("subtype", "")).lower(),
                        " ".join(str(kw) for kw in doc.get("trigger_keywords", [])).lower(),
                    ]
                    if any(name in f or f in name for f in match_fields):
                        best = max(best, weight)
                doc["score"] = round(best, 4)
                doc["_retrieval_method"] = "subtype_hierarchy"

            docs = [d for d in docs if d["score"] > 0]
            docs.sort(key=lambda x: x["score"], reverse=True)
            return docs[:top_k]

        except Exception as e:
            logger.error(f"[SubtypeAgent] Skill fetch failed: {e}")
            return []


# ─────────────────────────────────────────────────────────────────
# SECTION 6C — COMMUNITY CLUSTER RETRIEVER  (unchanged)
# ─────────────────────────────────────────────────────────────────

class CommunityClusterRetriever:

    async def retrieve(
        self,
        ctx:             PatientRetrievalContext,
        top_k:           int = 8,
        metadata_filter: Optional[MetadataFilter] = None,
    ) -> dict[str, list[dict]]:
        community_ids = await self._find_communities(ctx, metadata_filter)
        if not community_ids:
            return {"diagnosis": [], "treatment": []}

        diag, treat = await asyncio.gather(
            self._fetch_skills_in_communities("phase1_diagnosis_skills", community_ids, ctx.doctor_id, top_k, metadata_filter),
            self._fetch_skills_in_communities("phase1_treatment_skills", community_ids, ctx.doctor_id, top_k, metadata_filter),
        )
        logger.debug(
            f"[ClusterRetriever] communities={len(community_ids)} | "
            f"diag={len(diag)} treat={len(treat)}"
        )
        return {"diagnosis": diag, "treatment": treat}

    async def _find_communities(
        self,
        ctx:             PatientRetrievalContext,
        metadata_filter: Optional[MetadataFilter],
    ) -> list[str]:
        coll = get_collection("phase1_graph_communities")
        try:
            base_filter = {"doctor_id": ctx.doctor_id}
            if metadata_filter:
                base_filter.update(metadata_filter.to_mongo_filter())

            all_entities = (
                ctx.suspected_diseases
                + ctx.biomarkers[:4]
                + ([ctx.disease_subtype] if ctx.disease_subtype else [])
            )
            if not all_entities:
                return []

            entity_pattern = "|".join(re.escape(e) for e in all_entities if e)
            communities = await coll.find(
                {**base_filter, "$or": [
                    {"name":     {"$regex": entity_pattern, "$options": "i"}},
                    {"keywords": {"$elemMatch": {"$regex": entity_pattern, "$options": "i"}}},
                ]},
                {"_id": 0, "community_id": 1, "name": 1}
            ).to_list(length=10)

            community_ids = [c["community_id"] for c in communities if c.get("community_id")]

            if not community_ids:
                query_text = " ".join(all_entities[:6])
                query_arr  = _embed_float16(query_text)
                if query_arr is not None:
                    all_communities = await coll.find(
                        base_filter,
                        {"_id": 0, "community_id": 1, "centroid_embedding": 1}
                    ).to_list(length=200)

                    scored = []
                    for c in all_communities:
                        centroid = c.get("centroid_embedding")
                        if centroid:
                            centroid_arr = np.asarray(centroid, dtype=np.float16)
                            sim = _cosine(query_arr, centroid_arr)
                            if sim >= 0.30:
                                scored.append((c["community_id"], sim))

                    scored.sort(key=lambda x: x[1], reverse=True)
                    community_ids = [cid for cid, _ in scored[:5]]

            return community_ids

        except Exception as e:
            logger.error(f"[ClusterRetriever] Community lookup failed: {e}")
            return []

    async def _fetch_skills_in_communities(
        self,
        collection_name: str,
        community_ids:   list[str],
        doctor_id:       str,
        top_k:           int,
        metadata_filter: Optional[MetadataFilter],
    ) -> list[dict]:
        nodes_coll  = get_collection("phase1_graph_nodes")
        skills_coll = get_collection(collection_name)

        try:
            nodes = await nodes_coll.find(
                {"doctor_id": doctor_id, "community_id": {"$in": community_ids}},
                {"_id": 0, "doc_id": 1, "skill_id": 1}
            ).to_list(length=500)

            doc_ids = list({
                n.get("doc_id") or n.get("skill_id")
                for n in nodes
                if n.get("doc_id") or n.get("skill_id")
            })
            if not doc_ids:
                return []

            base_filter = {
                "doctor_id": doctor_id,
                "$or": [
                    {"doc_id":   {"$in": doc_ids}},
                    {"skill_id": {"$in": doc_ids}},
                ],
            }
            if metadata_filter:
                base_filter.update(metadata_filter.to_mongo_filter())

            projection = {"_id": 0, "embedding": 0, "body": 0, "skill_md": 0}
            docs = await skills_coll.find(base_filter, projection).to_list(length=top_k * 2)

            for doc in docs:
                doc["score"] = 0.5
                doc["_retrieval_method"] = "cluster"

            return docs[:top_k]

        except Exception as e:
            logger.error(f"[ClusterRetriever] Skill fetch failed: {e}")
            return []




# ─────────────────────────────────────────────────────────────────
# SECTION 6D — DISEASE-CENTRIC DIAGNOSIS RETRIEVER  ← MODIFIED (V5)
#
# Now mirrors treatment retrieval logic EXACTLY:
#   - No hardcoded 0.75 threshold
#   - Scores ALL candidates first
#   - Finds disease family boundary dynamically (like treatment)
#   - Uses dynamic threshold instead of fixed cutoff
#   - Disease-family expansion with proper filtering
#   - Preserves all evidence matching and validation
#   - NO hardcoded disease keywords - fully dynamic
#
# Every other retriever in this file answers "what's most similar to the
# query". This one answers a different question that ONLY applies to
# diagnosis skills: "which diagnosis skills belong to this patient's
# disease family, and are they supported by the evidence in front of me."
# The result set is never a fixed K — it's exactly as many skills as
# genuinely exist and qualify for that disease, per the design spec:
#   1 relevant skill  -> retrieve 1
#   3 relevant skills -> retrieve 3
#   7 relevant skills -> retrieve 7
#   never an unrelated disease's skills
#   never a treatment skill
# ─────────────────────────────────────────────────────────────────

class DiseaseAffinityCalculator:
    """
    Calculates disease family affinity with dynamic boundary detection.
    Mirrors the treatment retriever's affinity calculation logic.
    """
    
    @staticmethod
    def calculate_affinity(skill_disease: str, patient_terms: list[str]) -> float:
        """
        Calculate disease affinity using multiple matching strategies.
        Returns a score between 0.0 and 1.0.
        """
        if not skill_disease or not patient_terms:
            return 0.0
        
        skill_lower = skill_disease.lower()
        best_score = 0.0
        
        for term in patient_terms:
            term_lower = term.lower()
            
            # Strategy 1: Exact containment (highest confidence)
            if term_lower in skill_lower or skill_lower in term_lower:
                best_score = max(best_score, 1.0)
                continue
            
            # Strategy 2: Word-level matching (for multi-word diseases)
            skill_words = set(skill_lower.split())
            term_words = set(term_lower.split())
            common_words = skill_words.intersection(term_words)
            if common_words:
                score = len(common_words) / max(len(skill_words), len(term_words))
                best_score = max(best_score, score * 0.9)
            
            # Strategy 3: Fuzzy partial ratio (original method)
            from rapidfuzz import fuzz
            fuzzy_score = fuzz.partial_ratio(skill_lower, term_lower) / 100.0
            best_score = max(best_score, fuzzy_score * 0.85)
            
            # Strategy 4: Token set ratio (handles word order differences)
            token_set_score = fuzz.token_set_ratio(skill_lower, term_lower) / 100.0
            best_score = max(best_score, token_set_score * 0.80)
        
        return min(best_score, 1.0)
    
    @staticmethod
    def find_disease_family_boundary(affinities: list[float]) -> float:
        """
        Find the natural boundary between disease families.
        EXACTLY mirrors treatment retrieval's boundary detection.
        """
        if not affinities:
            return 0.50  # fallback (mirrors treatment's MIN_AFFINITY)
        
        sorted_affinities = sorted(affinities, reverse=True)
        
        # Look for the largest gap in the top portion
        max_gap = 0
        gap_index = 0
        top_portion = min(20, len(sorted_affinities))
        
        for i in range(min(top_portion - 1, len(sorted_affinities) - 1)):
            gap = sorted_affinities[i] - sorted_affinities[i + 1]
            if gap > max_gap:
                max_gap = gap
                gap_index = i
        
        # Check for clear disease-family separation
        # A gap > 0.15 with high scores above and low scores below indicates family boundary
        for i in range(min(top_portion - 1, len(sorted_affinities) - 1)):
            gap = sorted_affinities[i] - sorted_affinities[i + 1]
            if gap > 0.15 and sorted_affinities[i] > 0.60 and sorted_affinities[i + 1] < 0.50:
                return sorted_affinities[i]  # boundary above the gap
        
        # If we found a significant gap, use it
        if max_gap > 0.15:
            return sorted_affinities[gap_index]
        
        # No clear gap - use 75th percentile (mirrors treatment's fallback)
        import numpy as np
        return float(np.percentile(sorted_affinities, 75))


class DiseaseCentricDiagnosisRetriever:
    """
    Stage 1 — Patient evidence extraction (from the existing
              PatientRetrievalContext; no new input shape required).
    Stage 2 — Candidate generation: ALL diagnosis skills for this doctor
              (skill_type is implicit — this class only ever queries the
              phase1_diagnosis_skills collection, so treatment skills are
              structurally unreachable here).
    Stage 3 — Weighted evidence-overlap scoring per candidate.
    Stage 4 — Relevance decision via a threshold computed dynamically from
              THIS query's score distribution (mean + 0.5*std) — there is
              no fixed/absolute cutoff constant.
    Stage 5 — Disease-family expansion: once a disease_type clears the
              bar, every diagnosis skill for that disease_type is pulled
              in (a thin-keyword histology/staging skill for the correct
              disease should never be dropped just because it scored low
              on its own).
    Stage 6 — Evidence validation: each surviving skill carries
              matched_evidence / missing_evidence for downstream citation.
    """

    # Relative importance of each evidence dimension — these are
    # *proportions* that sum to 1.0, not absolute point thresholds. The
    # actual keep/discard cut (Stage 4) is derived from the resulting
    # score distribution per query, never a fixed magic number.
    _WEIGHTS = {
        "disease":   0.40,
        "subtype":   0.20,
        "pathology": 0.15,
        "biomarker": 0.15,
        "keyword":   0.10,
    }

    # Generic histopathology vocabulary used only to *pull* pathology terms
    # out of free-text clinical summaries when the structured
    # `pathology_findings` list is thin — not disease-specific, so it
    # generalises across specialties rather than hardcoding one disease.
    _PATHOLOGY_PATTERN = re.compile(
        r'\b(onion[\s-]?skin(?:ning)?|lollipop\s+lesion[s]?|'
        r'regressed\s+germinal\s+cent(?:er|re)s?|follicular\s+hyalinization|'
        r'vascular\s+proliferation|plasma\s?cell(?:oid)?\s+infiltrate|'
        r'atrophic\s+germinal\s+cent(?:er|re)s?|angiofollicular|'
        r'hyaline[\s-]?vascular|necrosis|granuloma(?:tous)?|fibrosis|'
        r'hyperplasia|dysplasia|metaplasia|atypia|infiltrat\w*)\b',
        re.IGNORECASE,
    )

    # Minimum safety threshold - anything below this is definitely unrelated
    # This is a safety net, not the primary filtering mechanism
    _MIN_AFFINITY = 0.50

    def __init__(self):
        self._affinity_calculator = DiseaseAffinityCalculator()

    # ---- Stage 1: patient evidence extraction -----------------------------
    def extract_evidence(self, ctx: PatientRetrievalContext) -> dict[str, list[str]]:
        all_diseases = list(dict.fromkeys(ctx.suspected_diseases + ctx.confirmed_diagnoses))
        free_text = " ".join([
            ctx.clinical_summary or "",
            ctx.physician_query or "",
            " ".join(ctx.pathology_findings),
            " ".join(ctx.symptoms),
        ])
        pathology_terms = list(dict.fromkeys(
            [p for p in ctx.pathology_findings if p]
            + self._PATHOLOGY_PATTERN.findall(free_text)
        ))
        return {
            "diagnosis_terms": [d for d in all_diseases if d],
            "subtype_terms":   [ctx.disease_subtype] if ctx.disease_subtype else [],
            "pathology_terms": pathology_terms,
            "biomarker_terms": list(dict.fromkeys(ctx.biomarkers + ctx.mutations)),
            "symptom_terms":   [s for s in ctx.symptoms if s],
        }

    # ---- Stage 2: candidate generation (diagnosis skills ONLY) ------------
    async def _fetch_diagnosis_skills(
        self,
        doctor_id:       str,
        metadata_filter: Optional[MetadataFilter],
        disease_regex:   Optional[str] = None,
    ) -> list[dict]:
        """Fetch diagnosis skills with optional disease filtering."""
        coll = get_collection("phase1_diagnosis_skills")
        base_filter: dict = {"doctor_id": doctor_id}
        if metadata_filter:
            base_filter.update(metadata_filter.to_mongo_filter())
        if disease_regex:
            base_filter["disease_type"] = {"$regex": disease_regex, "$options": "i"}

        try:
            return await coll.find(base_filter, _RETRIEVAL_PROJECTION).to_list(length=None)
        except Exception as e:
            logger.error(f"[DiseaseCentric] Candidate fetch failed: {e}")
            return []

    # ---- Stage 3: weighted evidence-overlap scoring -----------------------
    def _score_skill(
        self,
        skill:    dict,
        evidence: dict[str, list[str]],
    ) -> tuple[float, list[str], list[str]]:
        """
        Score a single diagnosis skill against patient evidence.
        Returns: (score, matched_evidence, missing_evidence)
        """
        def _norm(x: Any) -> str:
            return str(x or "").strip().lower()

        # Build searchable text from skill data
        searchable_bits = [
            _norm(skill.get("disease_type", "")),
            _norm(skill.get("subtype", "")),
            _norm(skill.get("name", "")),
        ] + [_norm(k) for k in (skill.get("trigger_keywords") or [])]
        body_summary_text = _norm(json.dumps(skill.get("_body_summary", {}) or {}, default=str))
        searchable_blob = " ".join(searchable_bits) + " " + body_summary_text

        def _overlap(terms: list[str]) -> list[str]:
            return [t for t in terms if t and _norm(t) in searchable_blob]

        matched_evidence: list[str] = []
        component_scores: dict[str, float] = {}

        # ---- Disease component ----
        best_disease_score = 0.0
        disease_matched = []
        for disease in evidence["diagnosis_terms"]:
            affinity = self._disease_affinity(
                skill.get("disease_type", ""),
                [disease]
            )
            if affinity >= 0.75:
                disease_matched.append(disease)
            best_disease_score = max(best_disease_score, affinity)

        

        component_scores["disease"] = best_disease_score
        matched_evidence += disease_matched

        # ---- Subtype component ----
        subtype_matched = _overlap(evidence["subtype_terms"])
        component_scores["subtype"] = 1.0 if subtype_matched else 0.0
        matched_evidence += subtype_matched

        # ---- Pathology component ----
        pathology_matched = _overlap(evidence["pathology_terms"])
        component_scores["pathology"] = (
            len(pathology_matched) / len(evidence["pathology_terms"])
            if evidence["pathology_terms"] else 0.0
        )
        matched_evidence += pathology_matched

        # ---- Biomarker component ----
        biomarker_matched = _overlap(evidence["biomarker_terms"])
        component_scores["biomarker"] = (
            len(biomarker_matched) / len(evidence["biomarker_terms"])
            if evidence["biomarker_terms"] else 0.0
        )
        matched_evidence += biomarker_matched

        # ---- Keyword component ----
        skill_keywords = skill.get("trigger_keywords") or []
        reference_terms = evidence["diagnosis_terms"] + evidence["symptom_terms"] + evidence["pathology_terms"]
        keyword_matched = [
            kw for kw in skill_keywords
            if any(_norm(kw) in _norm(t) or _norm(t) in _norm(kw) for t in reference_terms)
        ]
        component_scores["keyword"] = (
            len(keyword_matched) / len(skill_keywords) if skill_keywords else 0.0
        )

        # ---- Combine components ----
        base_score = sum(
            self._WEIGHTS[k] * v
            for k, v in component_scores.items()
        )

        # ---- Evidence ratio (matched vs missing) ----
        missing_evidence = [
            kw for kw in skill_keywords
            if kw not in keyword_matched
        ][:10]

        matched_count = len(matched_evidence)
        missing_count = len(missing_evidence)
        evidence_ratio = matched_count / (matched_count + missing_count + 1)

        # ---- Final score ----
        final_score = (base_score * 0.7) + (evidence_ratio * 0.3)

        return (
            final_score,
            list(dict.fromkeys(matched_evidence)),
            missing_evidence
        )

    # ---- Disease affinity calculation (delegates to calculator) ----
    def _disease_affinity(
        self,
        disease_name: str,
        diagnosis_terms: list[str]
    ) -> float:
        """Calculate disease affinity using the dedicated calculator."""
        return DiseaseAffinityCalculator.calculate_affinity(disease_name, diagnosis_terms)

    # ---- Orchestration ------------------------------------------------------
    async def retrieve(
        self,
        ctx:             PatientRetrievalContext,
        metadata_filter: Optional[MetadataFilter] = None,
    ) -> list[dict]:
        """
        Main retrieval method - mirrors treatment retrieval logic EXACTLY.
        
        Flow:
        1. Extract patient evidence
        2. Fetch ALL diagnosis skills (no filtering yet)
        3. Score ALL candidates with affinity
        4. Find disease family boundary dynamically
        5. Filter using dynamic threshold
        6. Disease-family expansion
        7. Return relevant skills
        """
        evidence = self.extract_evidence(ctx)
        if not evidence["diagnosis_terms"]:
            # No named disease to anchor a disease family on — defer entirely
            # to the existing vector/BM25/graph/subtype/cluster stack.
            return []

        # ---- Stage 1: Fetch ALL candidates (no filtering) ----
        candidates = await self._fetch_diagnosis_skills(ctx.doctor_id, metadata_filter)
        if not candidates:
            return []

        # ---- Stage 2: Score ALL candidates with affinity ----
        all_scored = []
        for skill in candidates:
            disease_type = skill.get("disease_type", "")
            if not disease_type:
                continue
                
            affinity = self._disease_affinity(
                disease_type,
                evidence["diagnosis_terms"]
            )
            skill["_disease_affinity"] = affinity
            all_scored.append(skill)

        if not all_scored:
            return []

        # ---- Stage 3: Find disease family boundary dynamically ----
        affinities = sorted([s["_disease_affinity"] for s in all_scored], reverse=True)
        
        # Find the LARGEST gap in the top portion (mirrors treatment)
        max_gap = 0
        gap_index = 0
        top_portion = min(20, len(affinities))
        
        for i in range(min(top_portion - 1, len(affinities) - 1)):
            gap = affinities[i] - affinities[i + 1]
            if gap > max_gap:
                max_gap = gap
                gap_index = i
        
        # Also check if there's a clear separation between disease families
        # Look for a gap where the higher side is > 0.60 and lower side is < 0.50
        best_gap_index = -1
        for i in range(min(top_portion - 1, len(affinities) - 1)):
            gap = affinities[i] - affinities[i + 1]
            if gap > 0.15 and affinities[i] > 0.60 and affinities[i + 1] < 0.50:
                best_gap_index = i
                break
        
        if best_gap_index >= 0:
            threshold = affinities[best_gap_index]
            logger.info(
                f"[DiseaseCentric] Using disease-family boundary at index {best_gap_index}: "
                f"threshold={threshold:.2f} (gap={affinities[best_gap_index] - affinities[best_gap_index + 1]:.2f})"
            )
        elif max_gap > 0.15:
            threshold = affinities[gap_index]
            logger.info(
                f"[DiseaseCentric] Using largest gap: "
                f"threshold={threshold:.2f} (gap={max_gap:.2f})"
            )
        else:
            # No clear gap - use 75th percentile
            import numpy as np
            threshold = float(np.percentile(affinities, 75)) if affinities else 0.50
            logger.info(
                f"[DiseaseCentric] No clear gap, using 75th percentile: "
                f"threshold={threshold:.2f}"
            )
        
        # Apply minimum safety threshold
        threshold = max(threshold, self._MIN_AFFINITY)
        
        # Log distribution for debugging
        import numpy as np
        logger.info(
            f"[DiseaseCentric] Affinity distribution: "
            f"min={affinities[-1]:.2f}, max={affinities[0]:.2f}, "
            f"mean={np.mean(affinities):.2f}, median={np.median(affinities):.2f}, "
            f"threshold={threshold:.2f}"
        )

        # ---- Stage 4: Score only skills above the threshold ----
        scored = []
        skipped_count = 0
        for skill in all_scored:
            affinity = skill["_disease_affinity"]
            
            if affinity < threshold:
                skipped_count += 1
                logger.debug(
                    f"[DiseaseCentric] Skipping {skill.get('disease_type', 'Unknown')} "
                    f"(affinity={affinity:.2f} < {threshold:.2f})"
                )
                continue
            
            score, matched_ev, missing_ev = self._score_skill(skill, evidence)
            skill["_disease_centric_score"] = 0.6 * affinity + 0.4 * score
            skill["matched_evidence"] = matched_ev
            skill["missing_evidence"] = missing_ev
            scored.append(skill)

        logger.info(
            f"[DiseaseCentric] Kept {len(scored)}/{len(all_scored)} skills "
            f"(skipped {skipped_count}) at threshold={threshold:.2f}"
        )

        # ---- Stage 5: Fallback if no skills cleared the threshold ----
        if not scored:
            logger.warning(
                f"[DiseaseCentric] No skills cleared threshold {threshold:.2f} "
                f"for diseases={evidence['diagnosis_terms'][:3]}"
            )
            # Return top 5 by affinity as fallback
            fallback_count = min(5, len(all_scored))
            top_by_affinity = sorted(all_scored, key=lambda x: x["_disease_affinity"], reverse=True)[:fallback_count]
            for skill in top_by_affinity:
                score, matched_ev, missing_ev = self._score_skill(skill, evidence)
                skill["_disease_centric_score"] = 0.6 * skill["_disease_affinity"] + 0.4 * score
                skill["matched_evidence"] = matched_ev
                skill["missing_evidence"] = missing_ev
                scored.append(skill)
            logger.info(f"[DiseaseCentric] Fallback: returning top {len(scored)} skills")

        # ---- Stage 6: Disease-family expansion ----
        # Identify diseases that cleared the threshold
        disease_scores: dict[str, float] = {}
        disease_max_affinity: dict[str, float] = {}

        for s in scored:
            d = (s.get("disease_type") or "").strip()
            if d:
                disease_scores[d] = max(disease_scores.get(d, 0.0), s["_disease_centric_score"])
                disease_max_affinity[d] = max(disease_max_affinity.get(d, 0.0), s["_disease_affinity"])

        # Only keep diseases that have high affinity
        confirmed_diseases = []
        max_affinity = max(disease_max_affinity.values()) if disease_max_affinity else 0

        for d in sorted(disease_scores.keys(), key=lambda x: disease_scores[x], reverse=True):
            # Only include if affinity is high OR it's within 0.10 of the max
            if disease_max_affinity.get(d, 0) > 0.60 or disease_max_affinity.get(d, 0) > (max_affinity - 0.10):
                confirmed_diseases.append(d)
            
            # Limit to 3 diseases
            if len(confirmed_diseases) >= 3:
                break

        # ---- Stage 7: Fetch ALL skills for confirmed diseases ----
        if confirmed_diseases:
            disease_regex = "|".join(re.escape(d) for d in confirmed_diseases if d)
            
            expansion_candidates = await self._fetch_diagnosis_skills(
                ctx.doctor_id, metadata_filter, disease_regex=disease_regex
            )
            
            seen_ids = {(s.get("skill_id") or s.get("doc_id")) for s in scored}
            expansion_added = 0
            
            for skill in expansion_candidates:
                sid = skill.get("skill_id") or skill.get("doc_id")
                if not sid or sid in seen_ids:
                    continue
                
                score, matched_ev, missing_ev = self._score_skill(skill, evidence)
                affinity = self._disease_affinity(
                    skill.get("disease_type", ""), evidence["diagnosis_terms"]
                )
                skill["_disease_centric_score"] = 0.6 * affinity + 0.4 * score
                skill["matched_evidence"] = matched_ev
                skill["missing_evidence"] = missing_ev
                scored.append(skill)
                seen_ids.add(sid)
                expansion_added += 1
            
            if expansion_added > 0:
                logger.info(
                    f"[DiseaseCentric] Disease-family expansion added "
                    f"{expansion_added} skills for diseases: {confirmed_diseases[:3]}"
                )

        # ---- Stage 8: Final formatting ----
        for skill in scored:
            skill["score"] = round(skill["_disease_centric_score"], 4)
            skill["_retrieval_method"] = "disease_centric"

        scored.sort(key=lambda x: x["score"], reverse=True)
        
        logger.info(
            f"[DiseaseCentric] FINAL: diseases={evidence['diagnosis_terms'][:3]} | "
            f"candidates={len(candidates)} | threshold={threshold:.2f} | "
            f"scored={len(scored)} | expansion_diseases={len(confirmed_diseases)}"
        )
        
        return scored


# ─────────────────────────────────────────────────────────────────
# SECTION 6E — DISEASE-CENTRIC TREATMENT RETRIEVER  (STANDALONE, V1)
#
# Fully independent from DiseaseCentricDiagnosisRetriever.
# Fixes applied (per review):
#   Fix 1: skills with empty matched_evidence are DROPPED, not kept
#   Fix 2: own _treatment_disease_affinity() — no dependency on
#          diagnosis retriever's _disease_affinity()
#   Fix 3: own _score_treatment_skill() — treatment-weighted scoring,
#          no dependency on diagnosis retriever's _score_skill()
#   Fix 4: hardcoded `disease_keywords = ["larynx","breast",...]` list
#          REMOVED entirely — replaced by corpus-driven dynamic generic
#          token detection computed per-retrieval from the candidate set
# ─────────────────────────────────────────────────────────────────

class TreatmentDiseaseAffinityCalculator:
    """
    Entity-overlap based affinity, computed independently of the
    diagnosis retriever. No hardcoded vocabulary anywhere — the set of
    "generic" tokens to ignore (cancer, disease, carcinoma, of, the...)
    is derived dynamically from the document-frequency of tokens across
    the CURRENT candidate pool, not from a fixed dictionary.
    """

    PATHOLOGY_TERMS = {
        "cancer",
        "carcinoma",
        "adenocarcinoma",
        "sarcoma",
        "lymphoma",
        "tumor",
        "tumour",
        "malignancy",
        "malignant",
        "squamous",
        "cell",
        "cells",
        "nos",
    }

    @staticmethod
    def compute_generic_tokens(disease_names: list[str], df_threshold: float = 0.30) -> set[str]:
        """
        Build a per-query "generic token" set from document frequency.
        A token that appears in >= df_threshold fraction of all disease
        names in this doctor's corpus is treated as non-discriminative
        (e.g. "cancer", "of", "disease") and excluded from entity sets.
        This replaces any fixed keyword list and adapts automatically to
        oncology, hematology, cardiology, or any other specialty corpus.
        """
        if not disease_names:
            return set()

        doc_count = len(disease_names)
        token_doc_freq: dict[str, int] = {}

        for name in disease_names:
            if not name:
                continue
            tokens = set(re.findall(r"[a-z0-9]+", name.lower()))
            for t in tokens:
                if len(t) <= 2:
                    continue
                token_doc_freq[t] = token_doc_freq.get(t, 0) + 1

        generic = {
            tok for tok, count in token_doc_freq.items()
            if (count / doc_count) >= df_threshold
        }
        return generic

    @staticmethod
    def extract_entities(disease_text: str, generic_tokens: set[str]) -> set[str]:
        """
        Tokenize a disease/subtype string into its discriminative entity
        set, e.g. "Squamous cell carcinoma of supraglottic larynx" ->
        {"supraglottic", "larynx"} once generic tokens are stripped.
        """
        if not disease_text:
            return set()
        tokens = re.findall(r"[a-z0-9]+", disease_text.lower())
        return {t for t in tokens if len(t) > 2 and t not in generic_tokens}

    @classmethod
    def calculate_affinity(
        cls,
        skill_disease: str,
        patient_terms: list[str],
        generic_tokens: set[str],
    ) -> float:
        """
        Core rule (per plan step 2): if the discriminative entity sets
        share NOTHING, affinity is 0.0 — immediately, no partial credit.
        This is what eliminates "Breast Cancer" skills from surfacing
        for a larynx patient. If there IS overlap, grade it by Jaccard
        similarity plus a light containment bonus for exact substring
        matches (handles "Larynx" vs "Larynx, Supraglottic" cases).
        """
        if not skill_disease or not patient_terms:
            return 0.0

        skill_entities = cls.extract_entities(skill_disease, generic_tokens)
        if not skill_entities:
            return 0.0

        best_score = 0.0
        skill_lower = skill_disease.lower()

        for term in patient_terms:
            if not term:
                continue
            patient_entities = cls.extract_entities(term, generic_tokens)
            if not patient_entities:
                continue

            overlap = {
                t for t in (skill_entities & patient_entities)
                if t not in cls.PATHOLOGY_TERMS
            }

            if not overlap:
                continue

            overlap_ratio = len(overlap) / min(
                len(skill_entities),
                len(patient_entities)
            )

            # Small bonus if one string fully contains the other
            # (handles "Larynx" contained inside "Larynx, Supraglottic").
            containment_bonus = 0.0
            term_lower = term.lower()
            if term_lower in skill_lower or skill_lower in term_lower:
                containment_bonus = 0.15

            score = min(1.0, overlap_ratio + containment_bonus)
            best_score = max(best_score, score)

        return best_score

    @staticmethod
    def find_disease_family_boundary(affinities: list[float]) -> float:
        """
        Dynamic boundary detection, duplicated here (not shared with the
        diagnosis retriever) so the treatment retriever has zero runtime
        coupling to diagnosis internals.
        """
        if not affinities:
            return 0.50

        sorted_aff = sorted(affinities, reverse=True)
        top_portion = min(20, len(sorted_aff))

        # Look for a clean disease-family separation first.
        for i in range(min(top_portion - 1, len(sorted_aff) - 1)):
            gap = sorted_aff[i] - sorted_aff[i + 1]
            if gap > 0.15 and sorted_aff[i] > 0.60 and sorted_aff[i + 1] < 0.50:
                return sorted_aff[i]

        # Otherwise use the largest gap in the top portion.
        max_gap, gap_index = 0.0, 0
        for i in range(min(top_portion - 1, len(sorted_aff) - 1)):
            gap = sorted_aff[i] - sorted_aff[i + 1]
            if gap > max_gap:
                max_gap, gap_index = gap, i
        if max_gap > 0.15:
            return sorted_aff[gap_index]

        # No clear gap -> 75th percentile fallback.
        import numpy as np
        return float(np.percentile(sorted_aff, 75))


class DiseaseCentricTreatmentRetriever:
    """
    Stage 1 — Patient evidence extraction (treatment-relevant fields:
              confirmed diagnosis, subtype, stage, biomarkers/mutations).
    Stage 2 — Candidate generation: ALL treatment skills for this doctor
              (queries phase1_treatment_skills only — diagnosis skills
              are structurally unreachable here).
    Stage 3 — Treatment-weighted evidence-overlap scoring per candidate,
              using this class's OWN scorer (_score_treatment_skill),
              never the diagnosis retriever's scorer.
    Stage 4 — Relevance decision via a threshold computed dynamically
              from THIS query's affinity distribution.
    Stage 5 — Disease-family expansion for confirmed diseases.
    Stage 6 — Hard evidence gate: any skill with matched_evidence == []
              is dropped, no matter how it scored (Fix 1).
    """

    # Treatment leans more heavily on disease/subtype match than
    # diagnosis does, since a wrong-disease treatment skill is far more
    # dangerous to surface than a wrong-disease diagnosis skill.
    _WEIGHTS = {
        "disease":   0.55,
        "subtype":   0.20,
        "biomarker": 0.15,
        "keyword":   0.10,
    }

    _MIN_AFFINITY = 0.50
    _DISEASE_GATE_THRESHOLD = 0.20  # <-- add this


    def __init__(self):
        self._affinity_calculator = TreatmentDiseaseAffinityCalculator()

    # ---- Stage 1: patient evidence extraction -----------------------------
    def extract_evidence(self, ctx: PatientRetrievalContext) -> dict[str, list[str]]:
        all_diseases = list(dict.fromkeys(
            getattr(ctx, "confirmed_diagnoses", []) + getattr(ctx, "suspected_diseases", [])
        ))
        stage = getattr(ctx, "disease_stage", None)
        subtype = getattr(ctx, "disease_subtype", None)

        return {
            "diagnosis_terms": [d for d in all_diseases if d],
            "subtype_terms":   [subtype] if subtype else [],
            "stage_terms":     [stage] if stage else [],
            "biomarker_terms": list(dict.fromkeys(
                getattr(ctx, "biomarkers", []) + getattr(ctx, "mutations", [])
            )),
            "symptom_terms":   [s for s in getattr(ctx, "symptoms", []) if s],
        }

    # ---- Stage 2: candidate generation (treatment skills ONLY) ------------
    async def _fetch_treatment_skills(
        self,
        doctor_id:       str,
        metadata_filter: Optional[MetadataFilter],
        disease_regex:   Optional[str] = None,
    ) -> list[dict]:
        coll = get_collection("phase1_treatment_skills")
        base_filter: dict = {"doctor_id": doctor_id}
        if metadata_filter:
            base_filter.update(metadata_filter.to_mongo_filter())
        if disease_regex:
            base_filter["disease_type"] = {"$regex": disease_regex, "$options": "i"}

        try:
            return await coll.find(base_filter, _RETRIEVAL_PROJECTION).to_list(length=None)
        except Exception as e:
            logger.error(f"[TreatmentCentric] Candidate fetch failed: {e}")
            return []

    # ---- Fix 2: own affinity function (no diagnosis dependency) -----------
    def _treatment_disease_affinity(
        self,
        disease_name: str,
        diagnosis_terms: list[str],
        generic_tokens: set[str],
    ) -> float:
        return TreatmentDiseaseAffinityCalculator.calculate_affinity(
            disease_name, diagnosis_terms, generic_tokens
        )

    # ---- Fix 3: own scoring function (no diagnosis dependency) ------------
    def _score_treatment_skill(
        self,
        skill:          dict,
        evidence:       dict[str, list[str]],
        generic_tokens: set[str],
    ) -> tuple[float, list[str], list[str]]:
        """
        Score a single treatment skill against patient evidence.
        Returns: (score, matched_evidence, missing_evidence)
        """
        def _norm(x: Any) -> str:
            return str(x or "").strip().lower()

        searchable_bits = [
            _norm(skill.get("disease_type", "")),
            _norm(skill.get("subtype", "")),
            _norm(skill.get("stage", "")),
            _norm(skill.get("name", "")),
        ] + [_norm(k) for k in (skill.get("trigger_keywords") or [])]
        body_summary_text = _norm(json.dumps(skill.get("_body_summary", {}) or {}, default=str))
        searchable_blob = " ".join(searchable_bits) + " " + body_summary_text

        def _overlap(terms: list[str]) -> list[str]:
            return [t for t in terms if t and _norm(t) in searchable_blob]

        matched_evidence: list[str] = []
        component_scores: dict[str, float] = {}

        # ---- Disease component (uses OWN affinity fn) ----
        best_disease_score = 0.0
        disease_matched = []
        for disease in evidence["diagnosis_terms"]:
            affinity = self._treatment_disease_affinity(
                skill.get("disease_type", ""), [disease], generic_tokens
            )
            if affinity >= self._DISEASE_GATE_THRESHOLD:
                disease_matched.append(disease)
            best_disease_score = max(best_disease_score, affinity)

        if best_disease_score < self._DISEASE_GATE_THRESHOLD:
            return 0.0, [], []
        component_scores["disease"] = best_disease_score
        matched_evidence += disease_matched

        # ---- Subtype component (also folds in stage, since staging
        #      language usually lives in subtype/keyword fields and no
        #      dedicated stage weight was specified) ----
        subtype_matched = _overlap(evidence["subtype_terms"] + evidence["stage_terms"])
        component_scores["subtype"] = 1.0 if subtype_matched else 0.0
        matched_evidence += subtype_matched

        # ---- Biomarker component ----
        biomarker_matched = _overlap(evidence["biomarker_terms"])
        component_scores["biomarker"] = (
            len(biomarker_matched) / len(evidence["biomarker_terms"])
            if evidence["biomarker_terms"] else 0.0
        )
        matched_evidence += biomarker_matched

        # ---- Keyword component ----
        skill_keywords = skill.get("trigger_keywords") or []
        reference_terms = (
            evidence["diagnosis_terms"] + evidence["symptom_terms"] + evidence["stage_terms"]
        )
        keyword_matched = [
            kw for kw in skill_keywords
            if any(_norm(kw) in _norm(t) or _norm(t) in _norm(kw) for t in reference_terms)
        ]
        component_scores["keyword"] = (
            len(keyword_matched) / len(skill_keywords) if skill_keywords else 0.0
        )
        matched_evidence += keyword_matched

        base_score = sum(self._WEIGHTS[k] * v for k, v in component_scores.items())

        missing_evidence = [kw for kw in skill_keywords if kw not in keyword_matched][:10]

        matched_count = len(matched_evidence)
        missing_count = len(missing_evidence)
        evidence_ratio = matched_count / (matched_count + missing_count + 1)

        final_score = (base_score * 0.7) + (evidence_ratio * 0.3)

        return (
            final_score,
            list(dict.fromkeys(matched_evidence)),
            missing_evidence,
        )

    # ---- Orchestration ------------------------------------------------------
    async def retrieve(
        self,
        ctx:             PatientRetrievalContext,
        metadata_filter: Optional[MetadataFilter] = None,
    ) -> list[dict]:
        evidence = self.extract_evidence(ctx)
        if not evidence["diagnosis_terms"]:
            return []

        # ---- Stage 1: Fetch ALL candidates ----
        candidates = await self._fetch_treatment_skills(ctx.doctor_id, metadata_filter)
        if not candidates:
            return []

        # ---- Fix 4: generic tokens computed dynamically from THIS
        #      candidate pool instead of a hardcoded keyword list ----
        all_disease_names = [c.get("disease_type", "") for c in candidates if c.get("disease_type")]
        generic_tokens = TreatmentDiseaseAffinityCalculator.compute_generic_tokens(all_disease_names)

        # ---- Stage 2: Score ALL candidates with affinity ----
        all_scored = []
        for skill in candidates:
            disease_type = skill.get("disease_type", "")
            if not disease_type:
                continue
            affinity = self._treatment_disease_affinity(
                disease_type, evidence["diagnosis_terms"], generic_tokens
            )
            skill["_disease_affinity"] = affinity
            all_scored.append(skill)

        if not all_scored:
            return []

        # ---- Stage 3: Find disease family boundary dynamically ----
        affinities = [s["_disease_affinity"] for s in all_scored]
        threshold = TreatmentDiseaseAffinityCalculator.find_disease_family_boundary(affinities)
        threshold = max(threshold, self._MIN_AFFINITY)

        import numpy as np
        logger.info(
            f"[TreatmentCentric] Affinity distribution: "
            f"min={min(affinities):.2f}, max={max(affinities):.2f}, "
            f"mean={np.mean(affinities):.2f}, threshold={threshold:.2f}"
        )

        # ---- Stage 4: Score skills above threshold, apply Fix 1 gate ----
        scored = []
        skipped_low_affinity = 0
        skipped_no_evidence = 0

        for skill in all_scored:
            if skill["_disease_affinity"] < threshold:
                skipped_low_affinity += 1
                continue

            score, matched_ev, missing_ev = self._score_treatment_skill(
                skill, evidence, generic_tokens
            )

            # ---- FIX 1: hard evidence gate ----
            # A skill with zero matched evidence must never survive,
            # regardless of affinity or base score. This was the main
            # source of "Breast Cancer / Matched Evidence: []" leakage.
            if not matched_ev:
                skipped_no_evidence += 1
                continue

            skill["_treatment_centric_score"] = 0.6 * skill["_disease_affinity"] + 0.4 * score
            skill["matched_evidence"] = matched_ev
            skill["missing_evidence"] = missing_ev
            scored.append(skill)

        logger.info(
            f"[TreatmentCentric] Kept {len(scored)}/{len(all_scored)} "
            f"(skipped_low_affinity={skipped_low_affinity}, "
            f"skipped_no_evidence={skipped_no_evidence}) at threshold={threshold:.2f}"
        )

        # ---- Stage 5: Fallback if nothing survives ----
        # Fallback still respects the Fix 1 evidence gate — we do NOT
        # fall back to affinity-only skills with no matched evidence,
        # since that would silently reintroduce the original bug.
        if not scored:
            logger.warning(
                f"[TreatmentCentric] No skills cleared threshold {threshold:.2f} "
                f"for diseases={evidence['diagnosis_terms'][:3]}"
            )
            top_by_affinity = sorted(all_scored, key=lambda x: x["_disease_affinity"], reverse=True)[:10]
            for skill in top_by_affinity:
                score, matched_ev, missing_ev = self._score_treatment_skill(
                    skill, evidence, generic_tokens
                )
                if not matched_ev:
                    continue
                skill["_treatment_centric_score"] = 0.6 * skill["_disease_affinity"] + 0.4 * score
                skill["matched_evidence"] = matched_ev
                skill["missing_evidence"] = missing_ev
                scored.append(skill)
            logger.info(f"[TreatmentCentric] Fallback: returning {len(scored)} evidence-backed skills")

        # ---- Stage 6: Disease-family expansion ----
        disease_scores: dict[str, float] = {}
        disease_max_affinity: dict[str, float] = {}
        for s in scored:
            d = (s.get("disease_type") or "").strip()
            if d:
                disease_scores[d] = max(disease_scores.get(d, 0.0), s["_treatment_centric_score"])
                disease_max_affinity[d] = max(disease_max_affinity.get(d, 0.0), s["_disease_affinity"])

        confirmed_diseases = []
        max_affinity = max(disease_max_affinity.values()) if disease_max_affinity else 0
        for d in sorted(disease_scores.keys(), key=lambda x: disease_scores[x], reverse=True):
            if disease_max_affinity.get(d, 0) > 0.60 or disease_max_affinity.get(d, 0) > (max_affinity - 0.10):
                confirmed_diseases.append(d)
            if len(confirmed_diseases) >= 3:
                break

        if confirmed_diseases:
            disease_regex = "|".join(re.escape(d) for d in confirmed_diseases if d)
            expansion_candidates = await self._fetch_treatment_skills(
                ctx.doctor_id, metadata_filter, disease_regex=disease_regex
            )
            seen_ids = {(s.get("skill_id") or s.get("doc_id")) for s in scored}
            expansion_added = 0

            for skill in expansion_candidates:
                sid = skill.get("skill_id") or skill.get("doc_id")
                if not sid or sid in seen_ids:
                    continue

                score, matched_ev, missing_ev = self._score_treatment_skill(
                    skill, evidence, generic_tokens
                )
                # Fix 1 gate applies here too — expansion must not
                # reintroduce evidence-free skills.
                if not matched_ev:
                    continue

                affinity = self._treatment_disease_affinity(
                    skill.get("disease_type", ""), evidence["diagnosis_terms"], generic_tokens
                )
                skill["_treatment_centric_score"] = 0.6 * affinity + 0.4 * score
                skill["matched_evidence"] = matched_ev
                skill["missing_evidence"] = missing_ev
                scored.append(skill)
                seen_ids.add(sid)
                expansion_added += 1

            if expansion_added > 0:
                logger.info(
                    f"[TreatmentCentric] Disease-family expansion added "
                    f"{expansion_added} evidence-backed skills for: {confirmed_diseases[:3]}"
                )

        # ---- Stage 7: Final formatting ----
        for skill in scored:
            skill["score"] = round(skill["_treatment_centric_score"], 4)
            skill["_retrieval_method"] = "treatment_centric"

        scored.sort(key=lambda x: x["score"], reverse=True)

        logger.info(
            f"[TreatmentCentric] FINAL: diseases={evidence['diagnosis_terms'][:3]} | "
            f"candidates={len(candidates)} | threshold={threshold:.2f} | "
            f"scored={len(scored)} | expansion_diseases={len(confirmed_diseases)}"
        )

        return scored

# ─────────────────────────────────────────────────────────────────
# SECTION 7 — HYBRID FUSION (RRF)
#   unchanged core fuse() logic; added fuse_disease_centric() (V4) to merge
#   the disease-centric diagnosis result set into the fused candidate pool.
# ─────────────────────────────────────────────────────────────────

class HybridFusion:

    RRF_K = 60

    def fuse(
        self,
        vector_results:  list[dict],
        bm25_results:    list[dict],
        graph_results:   list[dict],
        subtype_results: Optional[list[dict]] = None,
        cluster_results: Optional[list[dict]] = None,
        top_k:           int = FUSION_TOP_K,
    ) -> list[dict]:
        all_docs:   dict[str, dict]  = {}
        rrf_scores: dict[str, float] = defaultdict(float)

        def _get_id(doc: dict) -> str:
            return (
                doc.get("skill_id")
                or doc.get("doc_id")
                or json.dumps({
                    "dt": doc.get("disease_type", ""),
                    "st": doc.get("subtype", ""),
                    "g":  doc.get("guideline", ""),
                    "sk": doc.get("skill_type", ""),
                }, sort_keys=True)
            )

        def _apply_rrf(ranked_list: list[dict], weight: float):
            for rank, doc in enumerate(ranked_list, start=1):
                doc_id = _get_id(doc)
                all_docs[doc_id] = doc
                rrf_scores[doc_id] += weight * (1.0 / (self.RRF_K + rank))

        _apply_rrf(vector_results, VECTOR_WEIGHT)
        _apply_rrf(bm25_results,   BM25_WEIGHT)
        _apply_rrf(graph_results,  GRAPH_WEIGHT)
        if subtype_results:
            _apply_rrf(subtype_results, SUBTYPE_WEIGHT)
        if cluster_results:
            _apply_rrf(cluster_results, CLUSTER_WEIGHT)

        # Track which retrieval methods contributed to each doc's RRF score.
        # V3-1: only "vector_chroma" is a vector method now.
        _VECTOR_METHODS = {"vector_chroma"}
        for doc_id, doc in all_docs.items():
            doc["fusion_score"]              = round(rrf_scores[doc_id], 6)
            doc["_vector_retrieved"]         = doc.get("_retrieval_method") in _VECTOR_METHODS
            doc["_bm25_retrieved"]           = doc.get("_retrieval_method") == "bm25"
            doc["_graph_retrieved"]          = doc.get("_retrieval_method") == "graph"
            doc["_subtype_retrieved"]        = doc.get("_retrieval_method") == "subtype_hierarchy"
            doc["_cluster_retrieved"]        = doc.get("_retrieval_method") == "cluster"
            doc["_disease_centric_retrieved"] = doc.get("_retrieval_method") == "disease_centric"

        fused = sorted(all_docs.values(), key=lambda x: x["fusion_score"], reverse=True)
        logger.debug(
            f"[HybridFusion] vector={len(vector_results)} bm25={len(bm25_results)} "
            f"graph={len(graph_results)} subtype={len(subtype_results or [])} "
            f"cluster={len(cluster_results or [])} → fused={len(fused[:top_k])}"
        )
        return fused[:top_k]

    def fuse_disease_centric(
        self,
        diag_fused:            list[dict],
        disease_centric_results: list[dict],
    ) -> list[dict]:
        """
        V4 — merges the DiseaseCentricDiagnosisRetriever's authoritative
        output into the already-fused diagnosis candidate list.

        Skills found by BOTH the standard hybrid stack and the
        disease-centric retriever keep their RRF fusion_score (bumped up
        to at least their disease-centric score) and get flagged so they
        can never be dropped by the FINAL_MIN_SCORE cutoff downstream.
        Skills found ONLY by the disease-centric retriever are added
        outright — this is exactly how a correct-disease, thin-overlap
        skill (e.g. a pure staging/histology skill) survives even if the
        standard vector/BM25/graph stack never surfaced it.

        Never touches treatment results — this method is only ever called
        with the diagnosis-side fused list.
        """
        def _get_id(doc: dict) -> str:
            return (
                doc.get("skill_id")
                or doc.get("doc_id")
                or json.dumps({
                    "dt": doc.get("disease_type", ""),
                    "st": doc.get("subtype", ""),
                    "g":  doc.get("guideline", ""),
                }, sort_keys=True)
            )

        merged: dict[str, dict] = {_get_id(d): d for d in diag_fused}

        for dc_skill in disease_centric_results:
            key = _get_id(dc_skill)
            if key in merged:
                existing = merged[key]
                existing["_disease_centric_retrieved"] = True
                existing["matched_evidence"] = dc_skill.get("matched_evidence", [])
                existing["missing_evidence"] = dc_skill.get("missing_evidence", [])
                existing["fusion_score"] = max(
                    existing.get("fusion_score", 0.0), dc_skill.get("score", 0.0)
                )
            else:
                dc_skill["fusion_score"] = dc_skill.get("score", 0.0)
                dc_skill["_disease_centric_retrieved"] = True
                dc_skill.setdefault("_vector_retrieved", False)
                dc_skill.setdefault("_bm25_retrieved", False)
                dc_skill.setdefault("_graph_retrieved", False)
                dc_skill.setdefault("_subtype_retrieved", False)
                dc_skill.setdefault("_cluster_retrieved", False)
                merged[key] = dc_skill

        return sorted(merged.values(), key=lambda x: x.get("fusion_score", 0.0), reverse=True)


# ─────────────────────────────────────────────────────────────────
# SECTION 8 — LLM RERANKER  (unchanged)
# ─────────────────────────────────────────────────────────────────
import json
from groq import Groq

_rerank_groq_client = Groq(api_key=os.getenv("GROQ_API_KEY", ""))

class LLMReranker:
    """
    Uses Groq (same provider/model already used elsewhere in this codebase)
    to score how well each candidate skill matches the query. No local
    model, one LLM call per rerank (only run on the small fused candidate
    list, not all skills).
    """

    def __init__(self, model: str = "llama-3.3-70b-versatile"):
        self.model = model

    def rerank(self, query: str, candidates: list[dict], top_k: int = FINAL_TOP_K) -> list[dict]:
        if not candidates:
            return []

        items = [
            {
                "id": i,
                "disease_type": c.get("disease_type", ""),
                "subtype": c.get("subtype", ""),
                "skill_type": c.get("skill_type", ""),
                "trigger_keywords": c.get("trigger_keywords", [])[:8],
            }
            for i, c in enumerate(candidates)
        ]

        try:
            resp = _rerank_groq_client.chat.completions.create(
                model=self.model,
                temperature=0.0,
                max_tokens=1000,
                messages=[
                    {"role": "system", "content": (
                        "You are a clinical relevance scorer. Given a patient query and a "
                        "list of candidate skills (id, disease_type, subtype, skill_type, "
                        "trigger_keywords), score each candidate's relevance to the query "
                        "from 0.0 to 1.0. Return ONLY valid JSON: "
                        '{"scores": {"<id>": 0.0}}'
                    )},
                    {"role": "user", "content": f"QUERY: {query[:500]}\n\nCANDIDATES: {json.dumps(items)}"},
                ],
                response_format={"type": "json_object"},
            )
            scores = json.loads(resp.choices[0].message.content or "{}").get("scores", {})
        except Exception as e:
            logger.warning(f"[LLMReranker] failed ({e}) — falling back to fusion score")
            scores = {}

        for i, doc in enumerate(candidates):
            llm_score = float(scores.get(str(i), 0.0))
            doc["rerank_score"] = llm_score
            doc["final_score"]  = round(0.5 * llm_score + 0.5 * doc.get("fusion_score", 0.0), 4)

        return sorted(candidates, key=lambda x: x["final_score"], reverse=True)[:top_k]


# ─────────────────────────────────────────────────────────────────
# SECTION 8B — LAZY FULL-BODY LOADER  (unchanged)
# ─────────────────────────────────────────────────────────────────

async def _load_full_bodies(
    skills:          list[dict],
    collection_name: str,
    doctor_id:       str,
) -> list[dict]:
    if not skills:
        return skills

    id_pairs  = [(s.get("skill_id"), s.get("doc_id")) for s in skills]
    skill_ids = list({p[0] for p in id_pairs if p[0]})
    doc_ids   = list({p[1] for p in id_pairs if p[1]})

    coll = get_collection(collection_name)
    try:
        query = {
            "doctor_id": doctor_id,
            "$or": (
                [{"skill_id": {"$in": skill_ids}}] if skill_ids else []
            ) + (
                [{"doc_id": {"$in": doc_ids}}] if doc_ids else []
            ),
        }
        if not query["$or"]:
            return skills

        full_docs = await coll.find(
            query, {"_id": 0, "skill_id": 1, "doc_id": 1, "body": 1}
        ).to_list(length=len(skills))

        body_map: dict[str, dict] = {}
        for d in full_docs:
            body = d.get("body", {})
            if d.get("skill_id"):
                body_map[d["skill_id"]] = body
            if d.get("doc_id"):
                body_map[d["doc_id"]] = body

        for skill in skills:
            sid = skill.get("skill_id") or skill.get("doc_id", "")
            if sid in body_map:
                skill["body"] = body_map[sid]

    except Exception as e:
        logger.error(f"[LazyBodyLoader] Failed for {collection_name}: {e}")

    return skills


# ─────────────────────────────────────────────────────────────────
# SECTION 9 — CONTEXT ASSEMBLER
#   score_tag / guideline reason strings extended (V4) to surface the
#   disease_centric flag and matched/missing evidence for diagnosis skills.
# ─────────────────────────────────────────────────────────────────

class ContextAssembler:
    MAX_CHARS_PER_SKILL = 1_200
    MAX_TOTAL_CHARS     = 8_000

    def assemble(
        self,
        diagnosis_skills:  list[dict],
        treatment_skills:  list[dict],
        query_context:     PatientRetrievalContext,
    ) -> tuple[str, list[dict]]:
        lines = [
            "═══════════════════════════════════════════════════════════════════",
            "CLINICAL KNOWLEDGE BASE — Retrieved from Phase 1 guideline extraction",
            f"Patient: {query_context.specialty} | "
            f"Disease: {', '.join(query_context.suspected_diseases[:2])} | "
            f"Stage: {query_context.disease_stage or 'unknown'} | "
            f"Subtype: {query_context.disease_subtype or 'general'}",
            "═══════════════════════════════════════════════════════════════════",
            "",
            "INSTRUCTION: Use this knowledge to ground your clinical reasoning.",
            "Apply ONLY items relevant to this specific patient.",
            "Retrieved diagnosis skills are authoritative — do not invent",
            "biomarkers, investigations, pathology findings, staging systems,",
            "or guidelines beyond what is provided below.",
            "",
        ]

        total_chars = sum(len(l) for l in lines)
        guidelines_list: list[dict] = []
        seen_guidelines: set[str]   = set()

        if diagnosis_skills:
            lines.append("── DIAGNOSIS KNOWLEDGE ─────────────────────────────────────────")
            for skill in diagnosis_skills:
                if total_chars >= self.MAX_TOTAL_CHARS:
                    break
                block = self._format_diagnosis_skill(skill)
                if block:
                    lines.append(block)
                    total_chars += len(block)
                    self._add_to_guidelines(guidelines_list, seen_guidelines, skill, "diagnosis")

        if treatment_skills:
            lines.append("\n── TREATMENT KNOWLEDGE ──────────────────────────────────────────")
            for skill in treatment_skills:
                if total_chars >= self.MAX_TOTAL_CHARS:
                    break
                block = self._format_treatment_skill(skill)
                if block:
                    lines.append(block)
                    total_chars += len(block)
                    self._add_to_guidelines(guidelines_list, seen_guidelines, skill, "treatment")

        lines += [
            "",
            f"[Knowledge base: {len(diagnosis_skills)} diagnosis + {len(treatment_skills)} treatment skills | "
            f"{len(guidelines_list)} guidelines | {total_chars:,} chars]",
            "═══════════════════════════════════════════════════════════════════",
            "",
        ]

        return "\n".join(lines), guidelines_list

    def _format_diagnosis_skill(self, skill: dict) -> str:
        body = skill.get("body") or skill.get("_body_summary") or {}
        if not isinstance(body, dict):
            return ""

        score_tag  = f"[score={skill.get('final_score', skill.get('score', 0)):.2f} | "
        score_tag += f"{'vector+' if skill.get('_vector_retrieved') else ''}"
        score_tag += f"{'bm25+' if skill.get('_bm25_retrieved') else ''}"
        score_tag += f"{'graph+' if skill.get('_graph_retrieved') else ''}"
        score_tag += f"{'disease_family' if skill.get('_disease_centric_retrieved') else ''}"
        score_tag  = score_tag.replace("++", "+").rstrip("+]") + "]"

        parts = [
            f"\n📋 DIAGNOSIS: {skill.get('disease_type','')} "
            f"({skill.get('subtype','General')}) | "
            f"{skill.get('guideline','')} {skill.get('guideline_version','')} "
            f"| conf={skill.get('confidence',{}).get('label','')} {score_tag}",
        ]
        if body.get("diagnostic_criteria"):
            parts.append(f"  Criteria: {str(body['diagnostic_criteria'])[:250]}")
        for s in (body.get("staging", []) or [])[:3]:
            if isinstance(s, dict) and s.get("stage"):
                parts.append(f"  Staging: {s['stage']}: {s.get('criteria','')[:200]}")
        bm_text = ", ".join(
            bm.get("name", "") if isinstance(bm, dict) else str(bm)
            for bm in (body.get("biomarkers", []) or [])[:5]
        )
        if bm_text:
            parts.append(f"  Biomarkers: {bm_text[:200]}")
        pw_text = " → ".join(
            s.get("action", "") if isinstance(s, dict) else str(s)
            for s in (body.get("diagnostic_pathway", []) or [])[:4]
        )
        if pw_text:
            parts.append(f"  Pathway: {pw_text[:250]}")
        ddx_text = "; ".join(
            d.get("condition", "") if isinstance(d, dict) else str(d)
            for d in (body.get("differential_diagnosis", []) or [])[:4]
        )
        if ddx_text:
            parts.append(f"  Differentials: {ddx_text[:200]}")
        ev_text = "; ".join(
            f"{e.get('trial','')}: {e.get('finding','')[:80]}"
            for e in (body.get("key_evidence", []) or [])[:2]
            if isinstance(e, dict)
        )
        if ev_text:
            parts.append(f"  Evidence: {ev_text[:200]}")
        matched_ev = skill.get("matched_evidence") or []
        if matched_ev:
            parts.append(f"  Patient evidence matched: {', '.join(matched_ev[:8])}")
        pages = skill.get("source_pages", [])
        if pages:
            parts.append(f"  Source pages: {pages[:5]}")
        return "\n".join(parts)[:self.MAX_CHARS_PER_SKILL]

    def _format_treatment_skill(self, skill: dict) -> str:
        body = skill.get("body") or skill.get("_body_summary") or {}
        if not isinstance(body, dict):
            return ""

        score_tag = f"[score={skill.get('final_score', 0):.2f}]"
        parts = [
            f"\n💊 TREATMENT: {skill.get('disease_type','')} "
            f"({skill.get('subtype','General')}) | "
            f"{skill.get('guideline','')} {skill.get('guideline_version','')} "
            f"| conf={skill.get('confidence',{}).get('label','')} {score_tag}",
        ]
        if body.get("treatment_principles"):
            parts.append(f"  Principles: {str(body['treatment_principles'])[:200]}")
        for stage_entry in (body.get("stage_wise_treatment", []) or [])[:3]:
            if isinstance(stage_entry, dict) and stage_entry.get("stage"):
                stage   = stage_entry["stage"]
                intent  = stage_entry.get("intent", "")
                primary = stage_entry.get("primary_treatment", "")
                parts.append(f"  Stage {stage} ({intent}): {primary[:150]}")
                for opt in (stage_entry.get("options", []) or [])[:2]:
                    if isinstance(opt, dict) and opt.get("regimen_name"):
                        drugs    = ", ".join(opt.get("drugs", [])[:4])
                        cond_str = f" [if {opt['condition']}]" if opt.get("condition") else ""
                        parts.append(f"    • {opt['regimen_name']}{cond_str}: {drugs}")
        for rule in (body.get("if_then_rules", []) or [])[:4]:
            if isinstance(rule, dict) and rule.get("condition") and rule.get("action"):
                parts.append(f"    IF {rule['condition']} → {rule['action'][:100]}")
        tt = body.get("targeted_therapy", {})
        if isinstance(tt, dict) and tt.get("drugs"):
            parts.append(f"  Targeted: {', '.join(str(d) for d in tt['drugs'][:5])}")
        immuno = body.get("immunotherapy", {})
        if isinstance(immuno, dict) and immuno.get("drugs"):
            parts.append(f"  Immunotherapy: {', '.join(str(d) for d in immuno['drugs'][:5])}")
        ci_text = "; ".join(
            f"{c.get('drug_or_action','')}: avoid if {c.get('condition','')}"
            for c in (body.get("contraindications", []) or [])[:2]
            if isinstance(c, dict)
        )
        if ci_text:
            parts.append(f"  Contraindications: {ci_text[:200]}")
        ev_text = "; ".join(
            f"{e.get('trial','')}: {e.get('finding','')[:80]}"
            for e in (body.get("key_evidence", []) or [])[:2]
            if isinstance(e, dict)
        )
        if ev_text:
            parts.append(f"  Evidence: {ev_text[:200]}")
        path = skill.get("reasoning_path", [])
        if path:
            path_str = " → ".join(f"{p['node']} ({p['type']})" for p in path)
            parts.append(f"  Graph path: {path_str[:250]}")
        pages = skill.get("source_pages", [])
        if pages:
            parts.append(f"  Source pages: {pages[:5]}")
        return "\n".join(parts)[:self.MAX_CHARS_PER_SKILL]

    def _add_to_guidelines(
        self,
        guidelines_list: list[dict],
        seen:            set[str],
        skill:           dict,
        skill_type:      str,
    ):
        key = f"{skill.get('guideline','')}_{skill.get('guideline_version','')}_{skill.get('disease_type','')}"
        if key in seen:
            return
        seen.add(key)

        body = skill.get("body") or skill.get("_body_summary") or {}
        guidelines_list.append({
            "title":       f"{skill.get('guideline','')} {skill.get('guideline_version','')}".strip(),
            "reference":   skill.get("guideline", ""),
            "explanation": (
                f"Phase 1 extracted {skill_type} knowledge for "
                f"{skill.get('disease_type','')} ({skill.get('subtype','General')}). "
                f"Covers: {', '.join(skill.get('trigger_keywords',[])[:6])}."
            ),
            "reason": (
                f"Retrieved via hybrid RAG (score={skill.get('final_score',0):.2f}). "
                f"Confidence: {skill.get('confidence',{}).get('label','unknown')}. "
                f"Methods: vector={'✓' if skill.get('_vector_retrieved') else '✗'} "
                f"bm25={'✓' if skill.get('_bm25_retrieved') else '✗'} "
                f"graph={'✓' if skill.get('_graph_retrieved') else '✗'} "
                f"cluster={'✓' if skill.get('_cluster_retrieved') else '✗'} "
                f"disease_family={'✓' if skill.get('_disease_centric_retrieved') else '✗'}."
            ),
            "skill_id":         skill.get("skill_id", ""),
            "skill_type":       skill_type,
            "disease_type":     skill.get("disease_type", ""),
            "subtype":          skill.get("subtype", ""),
            "source_pages":     skill.get("source_pages", []),
            "confidence":       skill.get("confidence", {}),
            "final_score":      skill.get("final_score", 0.0),
            "matched_evidence": skill.get("matched_evidence", []),
            "missing_evidence": skill.get("missing_evidence", []),
            "body_summary": {
                k: v for k, v in (body.items() if isinstance(body, dict) else {})
                if k not in ("embedding", "_id")
            },
        })


# ─────────────────────────────────────────────────────────────────
# SECTION 10 — RETRIEVAL EVALUATOR
#   method_counts extended (V4) with a "disease_centric" bucket.
# ─────────────────────────────────────────────────────────────────

class RetrievalEvaluator:
    async def log(
        self,
        ctx:            PatientRetrievalContext,
        diag_skills:    list[dict],
        treat_skills:   list[dict],
        retrieval_time: float,
        method:         str,
    ) -> dict:
        all_skills = diag_skills + treat_skills

        method_counts = {"vector": 0, "bm25": 0, "graph": 0, "cluster": 0, "disease_centric": 0}
        multi_method  = 0
        fusion_scores = []
        final_scores  = []

        for s in all_skills:
            methods_hit = sum([
                bool(s.get("_vector_retrieved")),
                bool(s.get("_bm25_retrieved")),
                bool(s.get("_graph_retrieved")),
                bool(s.get("_cluster_retrieved")),
                bool(s.get("_disease_centric_retrieved")),
            ])
            if methods_hit >= 2:
                multi_method += 1
            if s.get("_vector_retrieved"):           method_counts["vector"]          += 1
            if s.get("_bm25_retrieved"):             method_counts["bm25"]            += 1
            if s.get("_graph_retrieved"):            method_counts["graph"]           += 1
            if s.get("_cluster_retrieved"):          method_counts["cluster"]         += 1
            if s.get("_disease_centric_retrieved"):  method_counts["disease_centric"] += 1
            fusion_scores.append(s.get("fusion_score", 0.0))
            final_scores.append(s.get("final_score",   0.0))

        def _stats(scores: list[float]) -> dict:
            if not scores:
                return {"mean": 0.0, "min": 0.0, "max": 0.0}
            return {
                "mean": round(sum(scores) / len(scores), 4),
                "min":  round(min(scores), 4),
                "max":  round(max(scores), 4),
            }

        metrics = {
            "query_id":             hashlib.sha256(
                (ctx.doctor_id + str(ctx.suspected_diseases)).encode()
            ).hexdigest()[:12],
            "timestamp":            datetime.now(timezone.utc).isoformat(),
            "doctor_id":            ctx.doctor_id,
            "suspected_diseases":   ctx.suspected_diseases[:3],
            "retrieval_method":     method,
            "retrieval_time_ms":    round(retrieval_time, 1),
            "total_retrieved":      len(all_skills),
            "diagnosis_skills":     len(diag_skills),
            "treatment_skills":     len(treat_skills),
            "method_hits":          method_counts,
            "multi_method_overlap": multi_method,
            "fusion_score_stats":   _stats(fusion_scores),
            "final_score_stats":    _stats(final_scores),
            "matched_diseases":     list({s.get("disease_type","") for s in all_skills if s.get("disease_type")}),
            "pagerank_coverage":    sum(1 for s in all_skills if s.get("pagerank_score", 0) > 0) / max(len(all_skills), 1),
        }

        try:
            coll = get_collection("phase2_retrieval_metrics")
            await coll.insert_one({**metrics})
        except Exception:
            pass

        logger.info(
            f"[RetrievalEval] method={method} | total={len(all_skills)} | "
            f"diag={len(diag_skills)} treat={len(treat_skills)} | "
            f"multi_method={multi_method} | disease_centric={method_counts['disease_centric']} | "
            f"time={retrieval_time:.0f}ms | final_mean={_stats(final_scores)['mean']:.3f}"
        )
        return metrics


# ─────────────────────────────────────────────────────────────────
# SECTION 11 — QUERY CONTEXT BUILDER  (unchanged)
# ─────────────────────────────────────────────────────────────────

def build_retrieval_context_from_diagnostic_input(
    diagnostic_input,
    scored_diagnoses: list,
    clinical_data,
) -> PatientRetrievalContext:
    di = diagnostic_input

    suspected = [d.disease for d in scored_diagnoses[:4]] if scored_diagnoses else []

    biomarker_re = re.compile(
        r'\b(ER\+|PR\+|HER2[\+\-]?|HER2-low|TNBC|triple.negative|HR\+|'
        r'MSI-H|MMR-d|PD-L1|Ki67|BRCA[12]?|EGFR|ALK|ROS1|KRAS|PIK3CA|ESR1|'
        r'TMB|ctDNA|Oncotype)\b',
        re.IGNORECASE,
    )

    all_text = " ".join([
        di.patient_context_summary or "",
        di.latest_lab_summary or "",
        di.latest_imaging_summary or "",
        di.doctor_note_or_dictation or "",
        " ".join(clinical_data.symptoms if clinical_data else []),
        " ".join(clinical_data.clinical_findings if clinical_data else []),
    ])

    biomarkers  = list(dict.fromkeys(biomarker_re.findall(all_text)))
    mutation_re = re.compile(r'\b(BRCA[12]?|EGFR|ALK|ROS1|KRAS|NRAS|BRAF|PIK3CA|ESR1|TP53|ATM)\b', re.I)
    mutations   = list(dict.fromkeys(mutation_re.findall(all_text)))
    stage_re    = re.compile(r'\b(stage\s+[IVX]+[ABC]?|Stage\s+\d[ABC]?)\b', re.I)
    stage_match = stage_re.search(all_text)
    stage       = stage_match.group(0) if stage_match else ""

    subtype = scored_diagnoses[0].disease_type if scored_diagnoses else ""

    return PatientRetrievalContext(
        doctor_id           = di.doctor_id,
        patient_id          = di.patient_id,
        specialty           = di.doctor_speciality or "",
        suspected_diseases  = suspected,
        confirmed_diagnoses = [],
        disease_stage       = stage,
        disease_subtype     = subtype,
        biomarkers          = biomarkers[:8],
        mutations           = mutations[:6],
        pathology_findings  = [f for f in (clinical_data.clinical_findings if clinical_data else []) if f][:5],
        symptoms            = (clinical_data.symptoms if clinical_data else [])[:8],
        investigations_done = [],
        current_medications = (di.last_medications or [])[:5],
        prior_treatments    = [],
        clinical_summary    = di.patient_context_summary[:500] if di.patient_context_summary else "",
        physician_query     = di.doctor_note_or_dictation[:200] if di.doctor_note_or_dictation else "",
        visit_type          = str(di.visit_type.value) if hasattr(di.visit_type, "value") else str(di.visit_type),
    )

async def build_retrieval_context_from_patient_summary(
    patient_id: str,
    doctor_id: str,
) -> PatientRetrievalContext:
    summary_coll = get_collection("patient_summary")
    doctor_coll  = get_collection("doctor_users")

    summary_doc = await summary_coll.find_one(
        {"patient_id": patient_id, "doctor_id": doctor_id}, sort=[("_id", -1)]
    )
    if not summary_doc:
        summary_doc = await summary_coll.find_one(
            {"patient_id": patient_id}, sort=[("_id", -1)]
        )

    summary_block = (summary_doc or {}).get("summary", {})
    confirmed_diagnoses = summary_block.get("confirmed_diagnoses", []) or []
    full_text = summary_block.get("full_text") or "\n\n".join(summary_block.get("paragraphs", []))
    diagnosis_header = summary_block.get("diagnosis_header", "")

    doctor_doc = await doctor_coll.find_one(
        {"$or": [{"sys_user_id": doctor_id}, {"doctor_id": doctor_id}]}
    )
    specialty = (doctor_doc or {}).get("specialization", "")

    return PatientRetrievalContext(
        doctor_id          = doctor_id,
        patient_id         = patient_id,
        specialty          = specialty,
        suspected_diseases = confirmed_diagnoses[:4],   # e.g. "Non-keratinizing squamous cell carcinoma"
        clinical_summary   = full_text[:1500],
        physician_query    = (diagnosis_header or full_text[:300]),
    )

# ─────────────────────────────────────────────────────────────────
# SECTION 12 — MAIN RAG ENGINE
# ─────────────────────────────────────────────────────────────────

class ClinicalRAGRetrievalEngine:
    """
    Fix 1  — cluster_res wired into fusion.
    Fix 6  — threshold fallback assigns final_score before continuing.
    Fix 7  — matched_nodes fetched once, passed to both graph.retrieve()
             and build_reasoning_paths_for_final().
    V3-1   — self.vector = ChromaRetriever()  (replaces Atlas/FAISS/cosine)
    V4     — self.disease_centric = DiseaseCentricDiagnosisRetriever().
             Diagnosis-side reranking now uses a DYNAMIC top_k (the number
             of disease-family-relevant skills found) instead of the fixed
             FINAL_TOP_K, and disease-centric-flagged skills are exempt
             from the FINAL_MIN_SCORE cutoff. Treatment retrieval/rerank/
             top_k is completely unchanged.
    """

    def __init__(self):
        self.query_gen        = QueryGenerator()
        self.vector           = ChromaRetriever()   # V3-1: was VectorSearchRetrieverV2()
        self.bm25              = BM25KeywordRetriever()
        self.graph             = GraphTraversalRetriever()
        self.fusion            = HybridFusion()
        self.reranker          = LLMReranker()   # instead of NoModelReranker()
        self.assembler         = ContextAssembler()
        self.evaluator         = RetrievalEvaluator()
        self.subtype_agent     = SubtypeRetrievalAgent()
        self.cluster           = CommunityClusterRetriever()
        self.disease_centric   = DiseaseCentricDiagnosisRetriever()   # V4
        self.disease_centric_treatment = DiseaseCentricTreatmentRetriever()   # Phase 1 fix
    async def retrieve(
        self,
        ctx:             PatientRetrievalContext,
        top_k:           int = FINAL_TOP_K,
        metadata_filter: Optional[MetadataFilter] = None,
    ) -> RetrievalResult:
        t_start = time.time()

        if not ctx.suspected_diseases and not ctx.physician_query:
            return self._empty_result(ctx, 0.0)

        queries = self.query_gen.generate(ctx)
        logger.info(
            f"[RAG] Starting retrieval | doctor={ctx.doctor_id} | "
            f"diseases={queries['all_diseases'][:3]} | "
            f"bm25_terms={len(queries['bm25_terms'])}"
        )

        # ✅ FIX: Wrap in try-except to handle empty results
        matched_nodes = []
        try:
            matched_nodes = await self.graph._find_nodes(
                queries["graph_entities"], ctx.doctor_id, metadata_filter
            )
        except Exception as e:
            logger.warning(f"[RAG] Graph node lookup failed: {e}")

        # Continue with retrieval even if graph fails.
        # V4: disease_centric_res added to the gather — runs concurrently
        # with everything else, touches only phase1_diagnosis_skills.
        vector_res, bm25_res, graph_res, subtype_res, cluster_res, disease_centric_res, disease_centric_treat_res = await asyncio.gather(
            self.vector.retrieve(
                queries["vector_query"], ctx.doctor_id,
                top_k=top_k, treatment_top_k=TREATMENT_VECTOR_TOP_K, metadata_filter=metadata_filter),
            self.bm25.retrieve(
                queries["bm25_terms"], ctx.doctor_id,
                treatment_top_k=TREATMENT_BM25_TOP_K, metadata_filter=metadata_filter),
            self.graph.retrieve(
                queries["graph_entities"], ctx.doctor_id,
                metadata_filter=metadata_filter,
                matched_nodes=matched_nodes if matched_nodes else None),
            self.subtype_agent.retrieve(ctx, metadata_filter=metadata_filter),
            self.cluster.retrieve(ctx, metadata_filter=metadata_filter),
            self.disease_centric.retrieve(ctx, metadata_filter=metadata_filter),
            self.disease_centric_treatment.retrieve(ctx, metadata_filter=metadata_filter),
        )

        diag_fused = self.fusion.fuse(
            vector_results  = vector_res["diagnosis"],
            bm25_results    = bm25_res["diagnosis"],
            graph_results   = graph_res["diagnosis"],
            subtype_results = subtype_res["diagnosis"],
            cluster_results = cluster_res["diagnosis"],
            top_k           = FUSION_TOP_K,
        )
        treat_fused = self.fusion.fuse(
            vector_results  = vector_res["treatment"],
            bm25_results    = bm25_res["treatment"],
            graph_results   = graph_res["treatment"],
            subtype_results = subtype_res["treatment"],
            cluster_results = cluster_res["treatment"],
            top_k           = TREATMENT_VECTOR_TOP_K,   # was FUSION_TOP_K — treatment fusion pool must be as wide as its retrieval pool
        )


        # Phase 1 fix — merge the disease-family-authoritative treatment set
        # into the fused pool the same way diagnosis already does.
        treat_fused = self.fusion.fuse_disease_centric(treat_fused, disease_centric_treat_res)

        # V4 — merge the disease-centric authoritative diagnosis set into
        # the fused diagnosis candidates. Treatment is never touched here.
        diag_candidates = self.fusion.fuse_disease_centric(diag_fused, disease_centric_res)

        # V4 — dynamic diagnosis top_k: when the disease-centric retriever
        # found a relevant family, rerank/return exactly that many
        # diagnosis skills (never a fixed K). Falls back to the standard
        # `top_k` when disease-centric found nothing (e.g. disease name
        # couldn't be resolved), preserving prior behaviour untouched.
        diag_top_k = len(disease_centric_res) if disease_centric_res else top_k
        treat_top_k = (
            max(len(disease_centric_treat_res), TREATMENT_FINAL_TOP_K)
            if disease_centric_treat_res else TREATMENT_FINAL_TOP_K
        )

        rerank_query = queries["vector_query"][:512]
        diag_final   = self.reranker.rerank(rerank_query, diag_candidates, diag_top_k)
        treat_final  = self.reranker.rerank(rerank_query, treat_fused,     treat_top_k)

        # After treat_final is created, filter by disease family using fuzzy matching
        # ---- Filter treatment skills by primary disease (PURELY DYNAMIC - NO HARDCODING) ----
        # if treat_final and queries.get("all_diseases"):
        #     patient_diseases = [d.lower() for d in queries["all_diseases"]]
            
        #     from rapidfuzz import fuzz
            
        #     original_count = len(treat_final)
        #     filtered_skills = []
            
        #     for skill in treat_final:
        #         skill_disease = skill.get("disease_type", "").lower()
        #         skill_subtype = skill.get("subtype", "").lower()
        #         skill_text = f"{skill_disease} {skill_subtype}"
                
        #         is_relevant = False
        #         best_match_score = 0
                
        #         # Check against all patient diseases
        #         for patient_disease in patient_diseases:
        #             # Clean the patient disease for better matching
        #             patient_clean = patient_disease.lower().strip()
                    
        #             # Try multiple matching strategies
                    
        #             # 1. Check if one contains the other (exact containment)
        #             if patient_clean in skill_text or skill_text in patient_clean:
        #                 is_relevant = True
        #                 best_match_score = 100
        #                 break
                    
        #             # 2. Check if the skill's disease type is a substring of patient disease
        #             # This handles cases like "Carcinoma of the Larynx and Hypopharynx" vs "Larynx Cancer"
        #             if skill_disease and len(skill_disease) > 5:
        #                 if skill_disease in patient_clean or patient_clean in skill_disease:
        #                     is_relevant = True
        #                     best_match_score = 90
        #                     break
                    
        #             # 3. Fuzzy matching - compare skill disease type with patient disease
        #             if skill_disease:
        #                 fuzzy_score = fuzz.partial_ratio(patient_clean, skill_disease)
        #                 if fuzzy_score > 70:
        #                     is_relevant = True
        #                     best_match_score = max(best_match_score, fuzzy_score)
                    
        #             # 4. Check individual words - extract significant words from both
        #             patient_words = set(patient_clean.split())
        #             skill_words = set(skill_disease.split())
                    
        #             # Remove common stop words
        #             stop_words = {'the', 'of', 'and', 'for', 'with', 'cell', 'carcinoma', 
        #                         'cancer', 'tumor', 'malignant', 'benign', 'invasive'}
        #             patient_words = {w for w in patient_words if len(w) > 3 and w not in stop_words}
        #             skill_words = {w for w in skill_words if len(w) > 3 and w not in stop_words}
                    
        #             # Check for significant word overlap
        #             common_words = patient_words.intersection(skill_words)
        #             if common_words:
        #                 is_relevant = True
        #                 break
                
        #         if is_relevant:
        #             filtered_skills.append(skill)
        #             logger.debug(f"[RAG] Keeping skill: {skill.get('disease_type')} (match score: {best_match_score})")
        #         else:
        #             logger.debug(f"[RAG] Filtering out: {skill.get('disease_type')}")
            
        #     treat_final = filtered_skills
        #     logger.info(
        #         f"[RAG] Filtered treatment skills using disease matching: "
        #         f"{original_count} → {len(treat_final)}"
        #     )

        # V4 — disease-centric-flagged diagnosis skills are exempt from the
        # FINAL_MIN_SCORE cutoff: they're authoritative by disease-family
        # membership, not by similarity score, so a low LLM rerank score
        # alone must never silently drop them. Treatment filtering is
        # unchanged.
        diag_final  = [
            s for s in diag_final
            if s.get("final_score", 0) >= FINAL_MIN_SCORE or s.get("_disease_centric_retrieved")
        ]
        # Phase 1 fix — same exemption diagnosis skills already get: a
        # disease-family-confirmed treatment skill must never be silently
        # dropped by a low LLM rerank score.
        treat_final = [
            s for s in treat_final
            if s.get("final_score", 0) >= FINAL_MIN_SCORE or s.get("_disease_centric_retrieved")
        ]

        if not diag_final and not treat_final:
            logger.warning(
                f"[RAG] All results below threshold {FINAL_MIN_SCORE} — returning top 2 regardless"
            )
            for doc in diag_fused[:2] + treat_fused[:2]:
                if "final_score" not in doc:
                    doc["final_score"] = doc.get("fusion_score", 0.0)
            diag_final  = diag_fused[:2]
            treat_final = treat_fused[:2]

        diag_final, treat_final = await asyncio.gather(
            _load_full_bodies(diag_final,  "phase1_diagnosis_skills", ctx.doctor_id),
            _load_full_bodies(treat_final, "phase1_treatment_skills", ctx.doctor_id),
        )

        final_ids = list({
            s.get("doc_id", "") or s.get("skill_id", "")
            for s in diag_final + treat_final
            if s.get("doc_id") or s.get("skill_id")
        })

        path_map = await self.graph.build_reasoning_paths_for_final(
            final_ids, matched_nodes, ctx.doctor_id
        )
        for skill in diag_final + treat_final:
            sid = skill.get("doc_id", "") or skill.get("skill_id", "")
            skill["reasoning_path"] = path_map.get(sid, [])

        context_block, guidelines_list = self.assembler.assemble(
            diagnosis_skills = diag_final,
            treatment_skills = treat_final,
            query_context    = ctx,
        )

        has_vector          = bool(vector_res["diagnosis"]  or vector_res["treatment"])
        has_bm25            = bool(bm25_res["diagnosis"]    or bm25_res["treatment"])
        has_graph           = bool(graph_res["diagnosis"]   or graph_res["treatment"])
        has_cluster         = bool(cluster_res["diagnosis"] or cluster_res["treatment"])
        has_disease_centric = bool(disease_centric_res)
        method_count = sum([has_vector, has_bm25, has_graph, has_cluster, has_disease_centric])
        retrieval_method = (
            "hybrid"           if method_count >= 2 else
            "disease_centric"  if has_disease_centric else
            "vector_only"      if has_vector          else
            "keyword_only"     if has_bm25            else
            "graph_only"       if has_graph           else
            "cluster_only"     if has_cluster         else
            "none"
        )

        t_end          = time.time()
        retrieval_time = (t_end - t_start) * 1000

        metrics = await self.evaluator.log(
            ctx            = ctx,
            diag_skills    = diag_final,
            treat_skills   = treat_final,
            retrieval_time = retrieval_time,
            method         = retrieval_method,
        )

        matched = list({
            s.get("disease_type", "")
            for s in diag_final + treat_final
            if s.get("disease_type")
        })

        logger.info(
            f"[RAG] Complete | method={retrieval_method} | "
            f"diag={len(diag_final)} (dynamic_top_k={diag_top_k}) treat={len(treat_final)} | "
            f"guidelines={len(guidelines_list)} | time={retrieval_time:.0f}ms"
        )

        return RetrievalResult(
            query_context     = ctx,
            diagnosis_skills  = diag_final,
            treatment_skills  = treat_final,
            context_block     = context_block,
            guidelines_list   = guidelines_list,
            retrieval_metrics = metrics,
            retrieval_time_ms = retrieval_time,
            matched_diseases  = matched,
            retrieval_method  = retrieval_method,
        )

    def _empty_result(self, ctx: PatientRetrievalContext, time_ms: float) -> RetrievalResult:
        return RetrievalResult(
            query_context     = ctx,
            diagnosis_skills  = [],
            treatment_skills  = [],
            context_block     = "",
            guidelines_list   = [],
            retrieval_metrics = {},
            retrieval_time_ms = time_ms,
            matched_diseases  = [],
            retrieval_method  = "none",
        )


# ─────────────────────────────────────────────────────────────────
# CONVENIENCE WRAPPER  (unchanged)
# ──────────────────────────────────────────────────────────────

_engine_singleton: Optional[ClinicalRAGRetrievalEngine] = None


def _get_engine() -> ClinicalRAGRetrievalEngine:
    global _engine_singleton
    if _engine_singleton is None:
        _engine_singleton = ClinicalRAGRetrievalEngine()
    return _engine_singleton


async def retrieve_skills_for_patient(
    doctor_id:       str,
    disease_names:   list[str],
    patient_context: str = "",
    specialty:       str = "",
    top_k_each:      int = FINAL_TOP_K,
    score_threshold: float = FINAL_MIN_SCORE,
    biomarkers:      Optional[list[str]] = None,
    disease_stage:   str = "",
    disease_subtype: str = "",
    physician_query: str = "",
    patient_id:      str = "",
) -> dict:
    ctx = PatientRetrievalContext(
        doctor_id          = doctor_id,
        patient_id         = patient_id or "",
        specialty          = specialty,
        suspected_diseases = disease_names,
        biomarkers         = biomarkers or [],
        disease_stage      = disease_stage,
        disease_subtype    = disease_subtype,
        clinical_summary   = patient_context[:500],
        physician_query    = physician_query,
    )

    result = await _get_engine().retrieve(ctx, top_k=top_k_each)

    return {
        "guidelines":        result.guidelines_list,
        "diagnosis_skills":  result.diagnosis_skills,
        "treatment_skills":  result.treatment_skills,
        "prompt_block":      result.context_block,
        "retrieval_method":  result.retrieval_method,
        "matched_diseases":  result.matched_diseases,
        "retrieval_metrics": result.retrieval_metrics,
        "retrieval_time_ms": result.retrieval_time_ms,
    }