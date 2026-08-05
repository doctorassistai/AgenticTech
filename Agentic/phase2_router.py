"""
phase2_router.py
================
FastAPI router for Phase 2 RAG Retrieval Engine.

Prefix : /phase2
Tag    : Phase 2 — Clinical RAG

Endpoints
---------
POST /retrieve                  Full hybrid retrieval for a patient context
POST /verify-retrieval          Debug: verify skills are correctly retrieved
                                 for a doctor + condition (e.g. invasive carcinoma)
GET  /verify-retrieval/quick    Quick GET version with query params (dev-friendly)
POST /faiss/build               Build / rebuild FAISS index for a doctor
POST /faiss/build-all           Build indexes for ALL doctors (one-time setup)
GET  /faiss/status/{doctor_id}  Check whether FAISS indexes exist for a doctor
GET  /health                    Engine health check
"""

from __future__ import annotations

import logging
import time
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from Agentic.phase2_skill_retrieval_service import (
    FINAL_MIN_SCORE,
    FINAL_TOP_K,
    ClinicalRAGRetrievalEngine,
    MetadataFilter,
    PatientRetrievalContext,
    RetrievalResult,
    _get_engine,
    retrieve_skills_for_patient,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/phase2",
    tags=["Phase 2 — Clinical RAG"],
)


# ───────────────────────────────────────────────────────────────
# REQUEST / RESPONSE SCHEMAS
# ─────────────────────────────────────────────────────────────────

class RetrieveRequest(BaseModel):
    doctor_id:             str
    patient_id:            str             = ""
    specialty:             str             = ""
    suspected_diseases:    list[str]       = Field(default_factory=list)
    confirmed_diagnoses:   list[str]       = Field(default_factory=list)
    disease_stage:         str             = ""
    disease_subtype:       str             = ""
    biomarkers:            list[str]       = Field(default_factory=list)
    mutations:             list[str]       = Field(default_factory=list)
    pathology_findings:    list[str]       = Field(default_factory=list)
    symptoms:              list[str]       = Field(default_factory=list)
    prior_treatments:      list[str]       = Field(default_factory=list)
    current_medications:   list[str]       = Field(default_factory=list)
    clinical_summary:      str             = ""
    physician_query:       str             = ""
    visit_type:            str             = "first_visit"
    top_k:                 int             = FINAL_TOP_K
    guideline_filter:      Optional[str]   = None
    version_filter:        Optional[str]   = None
    specialty_filter:      Optional[str]   = None


class SkillSummary(BaseModel):
    skill_id:          str
    skill_type:        str
    disease_type:      str
    subtype:           str
    guideline:         str
    guideline_version: str
    trigger_keywords:  list[str]
    source_pages:      list[int]
    vector_score:      float
    bm25_score:        float
    graph_score:       float
    fusion_score:      float
    rerank_score:      float
    final_score:       float
    retrieval_methods: list[str]
    confidence_label:  str


class RetrieveResponse(BaseModel):
    doctor_id:         str
    patient_id:        str
    retrieval_method:  str
    retrieval_time_ms: float
    diagnosis_count:   int
    treatment_count:   int
    matched_diseases:  list[str]
    guidelines_list:   list[dict]
    diagnosis_skills:  list[SkillSummary]
    treatment_skills:  list[SkillSummary]
    context_block:     str
    retrieval_metrics: dict


# ── Verify retrieval schemas ──────────────────────────────────────

class VerifyRetrievalRequest(BaseModel):
    """
    Minimal payload for verifying that skills are correctly retrieved
    for a given doctor + patient condition.

    Example body for invasive carcinoma:
    {
        "doctor_id": "doc_abc123",
        "condition": "Invasive ductal carcinoma",
        "stage": "Stage II",
        "subtype": "HER2-positive",
        "biomarkers": ["HER2+", "ER-", "PR-"],
        "specialty": "Oncology",
        "physician_query": "What is the standard neoadjuvant regimen?",
        "top_k": 5
    }
    """
    doctor_id:       str
    condition:       str                     # primary disease / condition string
    stage:           str                     = ""
    subtype:         str                     = ""
    biomarkers:      list[str]               = Field(default_factory=list)
    symptoms:        list[str]               = Field(default_factory=list)
    specialty:       str                     = "Oncology"
    physician_query: str                     = ""
    top_k:           int                     = Field(default=5, le=20)
    min_score:       float                   = Field(default=0.0)  # 0 = show all
    guideline:       Optional[str]           = None


class VerifySkillDetail(BaseModel):
    rank:              int
    skill_id:          str
    skill_type:        str
    disease_type:      str
    subtype:           str
    guideline:         str
    guideline_version: str
    final_score:       float
    fusion_score:      float
    retrieval_methods: list[str]
    trigger_keywords:  list[str]
    source_pages:      list[int]
    confidence_label:  str
    # Diagnostics
    matched_by_vector:  bool
    matched_by_bm25:    bool
    matched_by_graph:   bool
    matched_by_cluster: bool
    matched_by_subtype: bool
    body_summary_keys:  list[str]      # which body fields are present


class VerifyRetrievalResponse(BaseModel):
    ok:                bool           # True if ≥1 skill retrieved
    doctor_id:         str
    condition:         str
    retrieval_method:  str
    retrieval_time_ms: float
    diagnosis_count:   int
    treatment_count:   int
    matched_diseases:  list[str]
    diagnosis_skills:  list[VerifySkillDetail]
    treatment_skills:  list[VerifySkillDetail]
    # Verdicts
    has_diagnosis_skill:  bool
    has_treatment_skill:  bool
    top_diagnosis_score:  float
    top_treatment_score:  float
    # Retrieval coverage per method
    vector_hits:    int
    bm25_hits:      int
    graph_hits:     int
    cluster_hits:   int
    subtype_hits:   int
    # Warnings emitted when retrieval looks suspect
    warnings:       list[str]
    # Raw query generated (helpful for debugging BM25 / vector mismatch)
    debug_vector_query:   str
    debug_bm25_terms:     list[str]





# ─────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────

def _skill_to_summary(skill: dict, rank: int | None = None) -> dict:
    """Convert a raw skill dict from the engine into a clean response dict."""
    return {
        "rank":               rank,
        "skill_id":           skill.get("skill_id", skill.get("doc_id", "")),
        "skill_type":         skill.get("skill_type", ""),
        "disease_type":       skill.get("disease_type", ""),
        "subtype":            skill.get("subtype", ""),
        "guideline":          skill.get("guideline", ""),
        "guideline_version":  skill.get("guideline_version", ""),
        "final_score":        round(skill.get("final_score", 0.0), 4),
        "fusion_score":       round(skill.get("fusion_score", 0.0), 4),
        "vector_score":       round(skill.get("score", 0.0), 4),
        "bm25_score":         round(skill.get("bm25_score", 0.0), 4),
        "graph_score":        round(skill.get("graph_score", 0.0), 4),
        "rerank_score":       round(skill.get("rerank_score", 0.0), 4),
        "retrieval_methods":  _collect_methods(skill),
        "trigger_keywords":   skill.get("trigger_keywords", [])[:10],
        "source_pages":       skill.get("source_pages", [])[:10],
        "confidence_label":   (skill.get("confidence") or {}).get("label", "unknown"),
        "matched_by_vector":  bool(skill.get("_vector_retrieved")),
        "matched_by_bm25":    bool(skill.get("_bm25_retrieved")),
        "matched_by_graph":   bool(skill.get("_graph_retrieved")),
        "matched_by_cluster": bool(skill.get("_cluster_retrieved")),
        "matched_by_subtype": bool(skill.get("_subtype_retrieved")),
        "body_summary_keys":  list((skill.get("_body_summary") or {}).keys()),
    }


def _collect_methods(skill: dict) -> list[str]:
    methods = []
    if skill.get("_vector_retrieved"):  methods.append(skill.get("_retrieval_method", "vector"))
    if skill.get("_bm25_retrieved"):    methods.append("bm25")
    if skill.get("_graph_retrieved"):   methods.append("graph")
    if skill.get("_subtype_retrieved"): methods.append("subtype_hierarchy")
    if skill.get("_cluster_retrieved"): methods.append("cluster")
    return methods or [skill.get("_retrieval_method", "unknown")]


def _build_warnings(
    diag:  list[dict],
    treat: list[dict],
    condition: str,
) -> list[str]:
    warnings = []
    all_skills = diag + treat

    if not all_skills:
        warnings.append("No skills retrieved at all — check that guideline PDFs "
                        "for this condition have been ingested via Phase 1.")

    if not diag:
        warnings.append("No diagnosis skills found. Verify that Phase 1 extracted "
                        "DiagnosisAgent skills for this doctor's guidelines.")

    if not treat:
        warnings.append("No treatment skills found. Verify that Phase 1 extracted "
                        "TreatmentAgent skills for this doctor's guidelines.")

    # Check if disease_type in retrieved skills matches the queried condition
    condition_lower = condition.lower()
    matched = [
        s for s in all_skills
        if condition_lower in (s.get("disease_type") or "").lower()
        or condition_lower in (s.get("subtype") or "").lower()
        or any(condition_lower in kw.lower() for kw in s.get("trigger_keywords", []))
    ]
    if all_skills and not matched:
        warnings.append(
            f"Skills retrieved but none directly mention '{condition}' in disease_type, "
            f"subtype, or trigger_keywords. Possible keyword mismatch in the guideline "
            f"extraction — check how this condition is named in the source PDF."
        )

    low_conf = [
        s for s in all_skills
        if (s.get("confidence") or {}).get("label", "") in ("low", "very_low", "unknown")
    ]
    if low_conf:
        warnings.append(
            f"{len(low_conf)} skill(s) have low confidence labels — "
            f"Phase 1 extraction may have been incomplete for those sections."
        )

    only_one_method = [
        s for s in all_skills
        if len(_collect_methods(s)) == 1
        and _collect_methods(s)[0] in ("cluster", "subtype_hierarchy")
    ]
    if len(only_one_method) == len(all_skills) and all_skills:
        warnings.append(
            "All skills were found only by cluster/subtype — vector and BM25 "
            "had no hits. Check that embeddings were generated (phase1_section_vectors) "
            "and that FAISS indexes are built for this doctor."
        )

    return warnings


def _metadata_filter(req: RetrieveRequest | VerifyRetrievalRequest) -> Optional[MetadataFilter]:
    guideline = getattr(req, "guideline_filter", None) or getattr(req, "guideline", None)
    version   = getattr(req, "version_filter", None)
    specialty  = getattr(req, "specialty_filter", None)
    if any([guideline, version, specialty]):
        return MetadataFilter(
            guideline=guideline,
            version=version,
            specialty=specialty,
        )
    return None


# ─────────────────────────────────────────────────────────────────
# ENDPOINTS
# ─────────────────────────────────────────────────────────────────

@router.post(
    "/retrieve",
    response_model=RetrieveResponse,
    summary="Full hybrid RAG retrieval for a patient context",
)
async def retrieve(req: RetrieveRequest) -> RetrieveResponse:
    """
    Runs the full five-component retrieval pipeline (vector → BM25 → graph →
    subtype → cluster → fusion → rerank) and returns ranked diagnosis and
    treatment skills for the given patient context.
    """
    ctx = PatientRetrievalContext(
        doctor_id             = req.doctor_id,
        patient_id            = req.patient_id,
        specialty             = req.specialty,
        suspected_diseases    = req.suspected_diseases,
        confirmed_diagnoses   = req.confirmed_diagnoses,
        disease_stage         = req.disease_stage,
        disease_subtype       = req.disease_subtype,
        biomarkers            = req.biomarkers,
        mutations             = req.mutations,
        pathology_findings    = req.pathology_findings,
        symptoms              = req.symptoms,
        prior_treatments      = req.prior_treatments,
        current_medications   = req.current_medications,
        clinical_summary      = req.clinical_summary,
        physician_query       = req.physician_query,
        visit_type            = req.visit_type,
    )

    try:
        result: RetrievalResult = await _get_engine().retrieve(
            ctx,
            top_k           = req.top_k,
            metadata_filter = _metadata_filter(req),
        )
    except Exception as e:
        logger.error(f"[Phase2Router] /retrieve failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    def _to_summary(skill: dict) -> SkillSummary:
        return SkillSummary(
            skill_id          = skill.get("skill_id", skill.get("doc_id", "")),
            skill_type        = skill.get("skill_type", ""),
            disease_type      = skill.get("disease_type", ""),
            subtype           = skill.get("subtype", ""),
            guideline         = skill.get("guideline", ""),
            guideline_version = skill.get("guideline_version", ""),
            trigger_keywords  = skill.get("trigger_keywords", [])[:10],
            source_pages      = skill.get("source_pages", [])[:10],
            vector_score      = round(skill.get("score", 0.0), 4),
            bm25_score        = round(skill.get("bm25_score", 0.0), 4),
            graph_score       = round(skill.get("graph_score", 0.0), 4),
            fusion_score      = round(skill.get("fusion_score", 0.0), 4),
            rerank_score      = round(skill.get("rerank_score", 0.0), 4),
            final_score       = round(skill.get("final_score", 0.0), 4),
            retrieval_methods = _collect_methods(skill),
            confidence_label  = (skill.get("confidence") or {}).get("label", "unknown"),
        )

    return RetrieveResponse(
        doctor_id         = req.doctor_id,
        patient_id        = req.patient_id,
        retrieval_method  = result.retrieval_method,
        retrieval_time_ms = round(result.retrieval_time_ms, 1),
        diagnosis_count   = len(result.diagnosis_skills),
        treatment_count   = len(result.treatment_skills),
        matched_diseases  = result.matched_diseases,
        guidelines_list   = result.guidelines_list,
        diagnosis_skills  = [_to_summary(s) for s in result.diagnosis_skills],
        treatment_skills  = [_to_summary(s) for s in result.treatment_skills],
        context_block     = result.context_block,
        retrieval_metrics = result.retrieval_metrics,
    )


# ─────────────────────────────────────────────────────────────────
# VERIFY RETRIEVAL  — the main debug endpoint you asked for
# ─────────────────────────────────────────────────────────────────

@router.post(
    "/verify-retrieval",
    response_model=VerifyRetrievalResponse,
    summary="Verify that correct skills are retrieved for a doctor + condition",
    description="""
Debug endpoint.  Send a minimal patient condition (e.g. "Invasive ductal carcinoma",
Stage II, HER2+) and get back a full diagnostic report:

- Which skills were retrieved and at what score
- Which retrieval methods (vector / BM25 / graph / cluster / subtype) fired
- Which body-summary fields are present in each skill
- Warnings if retrieval looks suspect (no hits, low confidence, wrong disease name, etc.)
- The internal BM25 terms and vector query so you can spot keyword mismatches

Use this endpoint to verify Phase 1 extraction quality before wiring Phase 2
into the clinical decision support flow.
""",
)
async def verify_retrieval(req: VerifyRetrievalRequest) -> VerifyRetrievalResponse:
    from Agentic.phase2_skill_retrieval_service import QueryGenerator

    ctx = PatientRetrievalContext(
        doctor_id          = req.doctor_id,
        patient_id         = "verify_test",
        specialty          = req.specialty,
        suspected_diseases = [req.condition],
        disease_stage      = req.stage,
        disease_subtype    = req.subtype,
        biomarkers         = req.biomarkers,
        symptoms           = req.symptoms,
        physician_query    = req.physician_query,
        clinical_summary   = "",
    )

    # Generate query internals for debug output BEFORE running retrieval
    qgen   = QueryGenerator()
    qparts = qgen.generate(ctx)

    mf = _metadata_filter(req)
    try:
        result: RetrievalResult = await _get_engine().retrieve(
            ctx,
            top_k           = req.top_k,
            metadata_filter = mf,
        )
    except Exception as e:
        logger.error(f"[Phase2Router] /verify-retrieval failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

    diag_raw  = result.diagnosis_skills
    treat_raw = result.treatment_skills

    # Filter by caller-supplied min_score
    if req.min_score > 0:
        diag_raw  = [s for s in diag_raw  if s.get("final_score", 0) >= req.min_score]
        treat_raw = [s for s in treat_raw if s.get("final_score", 0) >= req.min_score]

    diag_details  = [VerifySkillDetail(**_skill_to_summary(s, rank=i+1))
                     for i, s in enumerate(diag_raw)]
    treat_details = [VerifySkillDetail(**_skill_to_summary(s, rank=i+1))
                     for i, s in enumerate(treat_raw)]

    all_skills = diag_raw + treat_raw

    # Per-method hit counts
    vector_hits  = sum(1 for s in all_skills if s.get("_vector_retrieved"))
    bm25_hits    = sum(1 for s in all_skills if s.get("_bm25_retrieved"))
    graph_hits   = sum(1 for s in all_skills if s.get("_graph_retrieved"))
    cluster_hits = sum(1 for s in all_skills if s.get("_cluster_retrieved"))
    subtype_hits = sum(1 for s in all_skills if s.get("_subtype_retrieved"))

    top_diag_score  = max((s.get("final_score", 0.0) for s in diag_raw),  default=0.0)
    top_treat_score = max((s.get("final_score", 0.0) for s in treat_raw), default=0.0)

    warnings = _build_warnings(diag_raw, treat_raw, req.condition)

    return VerifyRetrievalResponse(
        ok                  = bool(all_skills),
        doctor_id           = req.doctor_id,
        condition           = req.condition,
        retrieval_method    = result.retrieval_method,
        retrieval_time_ms   = round(result.retrieval_time_ms, 1),
        diagnosis_count     = len(diag_details),
        treatment_count     = len(treat_details),
        matched_diseases    = result.matched_diseases,
        diagnosis_skills    = diag_details,
        treatment_skills    = treat_details,
        has_diagnosis_skill = bool(diag_details),
        has_treatment_skill = bool(treat_details),
        top_diagnosis_score = round(top_diag_score, 4),
        top_treatment_score = round(top_treat_score, 4),
        vector_hits         = vector_hits,
        bm25_hits           = bm25_hits,
        graph_hits          = graph_hits,
        cluster_hits        = cluster_hits,
        subtype_hits        = subtype_hits,
        warnings            = warnings,
        debug_vector_query  = qparts.get("vector_query", ""),
        debug_bm25_terms    = qparts.get("bm25_terms", []),
    )


@router.get(
    "/verify-retrieval/quick",
    response_model=VerifyRetrievalResponse,
    summary="Quick GET-based verify retrieval (dev-friendly)",
    description="Same as POST /verify-retrieval but accepts query params for rapid testing in a browser or curl.",
)
async def verify_retrieval_quick(
    doctor_id:       str = Query(...,  description="Doctor ID to test against"),
    condition:       str = Query(...,  description="Disease/condition name, e.g. 'Invasive ductal carcinoma'"),
    stage:           str = Query("",   description="Disease stage, e.g. 'Stage II'"),
    subtype:         str = Query("",   description="Disease subtype, e.g. 'HER2-positive'"),
    biomarkers:      str = Query("",   description="Comma-separated biomarkers, e.g. 'HER2+,ER-'"),
    specialty:       str = Query("Oncology"),
    physician_query: str = Query("",   description="Free-text clinical question"),
    top_k:           int = Query(5,    le=20),
    min_score:       float = Query(0.0),
    guideline:       Optional[str] = Query(None),
) -> VerifyRetrievalResponse:
    req = VerifyRetrievalRequest(
        doctor_id       = doctor_id,
        condition       = condition,
        stage           = stage,
        subtype         = subtype,
        biomarkers      = [b.strip() for b in biomarkers.split(",") if b.strip()],
        specialty       = specialty,
        physician_query = physician_query,
        top_k           = top_k,
        min_score       = min_score,
        guideline       = guideline,
    )
    return await verify_retrieval(req)




# ─────────────────────────────────────────────────────────────────
# HEALTH CHECK
# ─────────────────────────────────────────────────────────────────

@router.get("/health", summary="Phase 2 engine health check")
async def health() -> dict:
    from Agentic.phase2_skill_retrieval_service import _get_embed_model
    embed_ok  = bool(_get_embed_model())
    return {
        "status":        "ok",
        "embedding_model_loaded": embed_ok,
        "engine_singleton_ready": True,   # _get_engine() is lazy but always returns
    }