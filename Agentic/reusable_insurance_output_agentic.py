"""
Clinical Reasoning Agentic System — Production Ready
=====================================================
Register it in your FastAPI app exactly as before:
    from Agentic.reusable_insurance_output_agentic import router
    app.include_router(router, prefix="/api/v1")

4-Stage Architecture
--------------------
Stage 0  Document ingest & normalisation
         - Flatten nested sections  {tables, sections:[{heading,content}]}  → {heading: content}
         - Deduplicate by file_hash (not document_id)
         - Strip null vital-sign placeholder entities
         - Tag each document's type from real headings

Stage 1  Clinical context builder  
         - Classify active diagnoses vs past history
         - Identify pending reports
         - Resolve primary specialty
         - Extract confirmed vitals, medications, insurance mentions
         - Produce a shared ClinicalContext passed to every downstream agent

Stage 2  Parallel specialist agents  (12 engines + 3 core agents)
         - Medical Adequacy    (3  sub-calls)
         - Medical Sufficiency (2  sub-calls)
         - Clinical Derivation (ICD / CPT / TNM from active dx only)
         - 12 specialist engines run concurrently via asyncio.gather

Stage 3  Result consolidation & cross-validation  (deterministic, no LLM)

Stage 4  Idempotent MongoDB save
         - record_type="composite"  keyed on (patient_id, doctor_id)
         - record_type="engine"     keyed on (patient_id, engine_name)

All 10 fixes from analysis applied — see FIX comments inline.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import traceback
from collections import defaultdict
from datetime import datetime
from typing import Any, Dict, List, Optional, TypedDict

from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, Query
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from langgraph.graph import END, StateGraph
from loguru import logger
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field

load_dotenv()

# ============================================================
# CONFIGURATION
# ============================================================

MONGO_URI     = os.getenv("MONGO_URI", "")
GROQ_API_KEY  = os.getenv("GROQ_API_KEY", "")
MONGO_DB_NAME = os.getenv("MONGO_DB_NAME", "doctorassistai")

if not GROQ_API_KEY:
    raise RuntimeError("GROQ_API_KEY is not set in environment")

# ── Router ────────────────────────────────────────────────────────────────
router = APIRouter(tags=["Agentic"])

# ── MongoDB ───────────────────────────────────────────────────────────────
_mongo_client               = AsyncIOMotorClient(MONGO_URI)
_db                         = _mongo_client[MONGO_DB_NAME]
processed_documents         = _db["processed_documents"]
processed_engine_results    = _db["processed_engine_results"]
patient_user_collection     = _db["patient_users"]
doctor_user_collection      = _db["doctor_users"]

# ── LLM instances ─────────────────────────────────────────────────────────
# llm       : fast 8B — used for all 12 specialist engines
# llm_large : 70B    — used for adequacy/sufficiency where quality matters most
#             Falls back to llm if 70B is unavailable on your Groq tier.
llm = ChatGroq(
    model="llama-3.1-8b-instant",
    groq_api_key=GROQ_API_KEY,
    temperature=0.1,
    max_tokens=8000,
)

try:
    llm_large = ChatGroq(
        model="llama-3.3-70b-versatile",
        groq_api_key=GROQ_API_KEY,
        temperature=0.1,
        max_tokens=8000,
    )
except Exception:
    llm_large = llm   # graceful fallback


# ============================================================
# UTILITY HELPERS
# ============================================================

def sanitize_for_response(obj: Any) -> Any:
    """Recursively convert non-JSON-serialisable types."""
    if isinstance(obj, datetime):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: sanitize_for_response(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_response(v) for v in obj]
    if isinstance(obj, (str, int, float, bool, type(None))):
        return obj
    return str(obj)


def parse_llm_json(content: str) -> Any:
    """
    Robust JSON extraction from LLM output.
    Handles: markdown fences, leading/trailing prose, partial objects.
    Returns {} on total failure — never raises.
    """
    if not content:
        return {}

    text = content.strip()
    # Strip markdown fences like ```json ... ```
    text = re.sub(r"^```(?:json)?[^\n]*\n?", "", text, flags=re.MULTILINE).strip()
    text = re.sub(r"\n?```$", "", text, flags=re.MULTILINE).strip()

    # Direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass

    # Extract first JSON object or array
    for pattern in (r"\{[\s\S]*\}", r"\[[\s\S]*\]"):
        m = re.search(pattern, text)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass

    logger.warning("parse_llm_json: all extraction strategies failed — returning {}")
    return {}


# ============================================================
# PYDANTIC MODELS
# ============================================================

class ClinicalReasoningRequest(BaseModel):
    patient_id: str
    doctor_id: str
    consultation_text: str = ""


class NormalisedDocument(BaseModel):
    """
    A fully normalised, deduplicated document.
    sections is ALWAYS a flat {heading: content} dict    (FIX 1).
    entities has null vital placeholders removed         (FIX 3).
    doc_type is detected from real heading names         (FIX 6).
    """
    document_id:   str
    patient_id:    str
    doctor_id:     str
    document_date: Optional[str]
    file_hash:     str
    raw_markdown:  str
    sections:      Dict[str, str]   # heading → content
    entities:      List[Dict[str, Any]]
    doc_type:      str              # radiology | laboratory | discharge_summary | other


class ClinicalContext(BaseModel):
    """
    Output of Stage 1 — shared pre-parsed context for all downstream agents.
    Prevents each agent independently re-deriving the same basic clinical facts.
    """
    patient_id:        str
    active_diagnoses:  List[str]        # currently being evaluated / treated
    past_history:      List[str]        # "known case of", "s/p", "treated", etc.
    pending_reports:   List[str]        # NGS, BMA, etc. — in progress but results awaited
    primary_complaint: str
    primary_specialty: str              # Hematology / Medical Oncology / etc.
    real_vitals:       Dict[str, str]   # only vitals with confirmed numeric values
    medications:       List[str]
    insurance_mentions: List[str]
    doc_types_present: List[str]
    date_range:        Dict[str, str]
    total_documents:   int
    raw_text_summary:  str              # 3-sentence clinical narrative


class PatientDemographics(BaseModel):
    name:         Optional[str] = None
    date_of_birth: Optional[str] = None
    gender:       Optional[str] = None
    age:          Optional[int] = None
    phone_number: Optional[str] = None
    email:        Optional[str] = None
    blood_group:  Optional[str] = None
    address:      Optional[str] = None
    hms_id:       Optional[str] = None


class EnhancedClinicalReasoningResponse(BaseModel):
    status:                      str
    clinical_context:            Optional[Dict[str, Any]] = None
    medical_adequacy_results:    Optional[Dict[str, Any]] = None
    medical_sufficiency_results: Optional[Dict[str, Any]] = None
    clinical_derivation_results: Optional[Dict[str, Any]] = None
    engine_specific_results:     Dict[str, Any] = Field(default_factory=dict)
    confidence_scores:           Dict[str, float] = Field(default_factory=dict)
    warnings:                    List[str] = Field(default_factory=list)
    requires_review:             bool = False
    verdict_summary:             Optional[Dict[str, Any]] = None
    timestamp:                   str
    error:                       Optional[str] = None


class ClinicalReasoningState(TypedDict):
    patient_id:     str
    doctor_id:      str
    docs:           Optional[List[NormalisedDocument]]
    ctx:            Optional[ClinicalContext]
    demo:           Optional[PatientDemographics]
    adequacy:       Optional[Dict[str, Any]]
    sufficiency:    Optional[Dict[str, Any]]
    derivation:     Optional[Dict[str, Any]]
    engine_results: Optional[Dict[str, Any]]
    consolidation:  Optional[Dict[str, Any]]
    warnings:       List[str]
    error:          Optional[str]


# ============================================================
# STAGE 0 — DOCUMENT INGEST & NORMALISATION
# ============================================================

def flatten_sections(raw_sections: Any) -> Dict[str, str]:
    """
    FIX 1 — The core structural bug fix.

    MongoDB stores sections as:
        { "tables": [...], "sections": [{"heading": "DIAGNOSIS:", "content": "...", "kv_pairs": {...}}, ...] }

    The old code did raw_sections.items() and got keys "tables" and "sections"
    instead of real clinical headings like "DIAGNOSIS:", "SUMMARYOFHOSPITALCOURSE:", etc.

    This function ALWAYS returns a flat {heading: content} dict regardless of input format.
    """
    flat: Dict[str, str] = {}

    if not raw_sections:
        return flat

    # ── Primary format: nested {"sections": [{heading, content, kv_pairs}]} ──
    if isinstance(raw_sections, dict) and "sections" in raw_sections:
        section_list = raw_sections.get("sections", [])
        if isinstance(section_list, list):
            for item in section_list:
                if not isinstance(item, dict):
                    continue
                heading = (item.get("heading") or "").strip()
                content = item.get("content") or ""

                # Merge kv_pairs into content so structured data isn't lost
                kv = item.get("kv_pairs") or {}
                if isinstance(kv, dict) and kv:
                    kv_text = "\n".join(f"{k}: {v}" for k, v in kv.items())
                    content  = f"{content}\n{kv_text}".strip() if content else kv_text

                if heading:
                    flat[heading] = content.strip()
        return flat

    # ── Legacy format: already a flat dict ──────────────────────────────────
    if isinstance(raw_sections, dict):
        for k, v in raw_sections.items():
            if isinstance(v, str) and v.strip():
                flat[k] = v.strip()
        return flat

    return flat


def detect_doc_type(sections: Dict[str, str], raw_markdown: str) -> str:
    """
    FIX 6 — Detect document type from REAL heading names.

    The old code checked str(doc_types_dict).lower() which produced strings like
    "{'unknown': 3}" — no keywords ever matched, so doc_type was always "unknown".

    Now we check the actual heading names from the flattened sections.
    """
    # Normalise all heading names for matching
    headings_blob = " ".join(
        h.lower().replace(" ", "").replace("_", "").replace(":", "")
        for h in sections.keys()
    )
    # Also peek at start of raw markdown (doc title / first headings)
    markdown_blob = (raw_markdown or "")[:600].lower()
    combined      = headings_blob + " " + markdown_blob

    if any(k in combined for k in [
        "petctscan", "petct", "wholebodypet", "radiologyreport", "impression",
        "mri", "xray", "ultrasound", "usg", "ctscan", "radiology",
    ]):
        return "radiology"

    if any(k in combined for k in [
        "haemogram", "haematology", "bloodgroup", "cbc", "absolutecounts",
        "rbcindices", "differentialcount", "peripheralsmear", "plateletcount",
    ]):
        return "laboratory"

    if any(k in combined for k in [
        "dischargesummary", "summaryofhospitalcourse", "departmentofmedical",
        "recommendationsatdischarge", "dateofadmission", "dateofhospitalization",
        "chiefconsultant", "conditionatdischarge",
    ]):
        return "discharge_summary"

    if any(k in combined for k in ["biopsy", "histopathology", "pathology", "specimen", "hpe"]):
        return "pathology"

    if any(k in combined for k in ["consultation", "referral", "opdvisit"]):
        return "consultation"

    return "other"


def filter_null_vitals(entities: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    FIX 3 — Remove placeholder vital sign entities injected by upstream extraction.

    The extraction pipeline inserts entries like:
        {"entity_type": "Vital Sign", "entity_name": "Blood Pressure",
         "entity_value": null, "evidence_text": "None"}

    for every standard vital, even when that vital isn't in the document.
    These 8-9 blanks per document drown out real values and cause the LLM
    to hallucinate vital signs that were never measured.

    Rule: keep a Vital Sign entity only if it has a real non-null value.
    """
    clean: List[Dict[str, Any]] = []
    for entity in entities:
        if entity.get("entity_type", "").lower() == "vital sign":
            value    = entity.get("entity_value")
            evidence = (entity.get("evidence_text") or "").strip()
            # Drop if value is missing or evidence is literally the string "None"
            if not value or evidence.lower() in ("none", "", "null", "n/a"):
                continue
        clean.append(entity)
    return clean


async def fetch_and_normalise_documents(
    patient_id: str,
    doctor_id:  Optional[str] = None,
) -> List[NormalisedDocument]:
    """
    Stage 0 — Fetch, deduplicate (FIX 2), flatten (FIX 1), filter (FIX 3), tag (FIX 6).

    Returns exactly one NormalisedDocument per unique source file.
    All downstream agents work exclusively with this cleaned list.
    """
    query: Dict[str, Any] = {"metadata.patient_id": patient_id}
    if doctor_id:
        query["metadata.doctor_id"] = doctor_id

    cursor   = processed_documents.find(query).sort("metadata.document_date", -1)
    raw_docs = await cursor.to_list(length=1000)

    if not raw_docs:
        logger.warning(f"[Stage0] No documents found for patient={patient_id}")
        return []

    logger.info(f"[Stage0] Fetched {len(raw_docs)} raw docs for patient={patient_id}")

    # FIX 2 — Deduplicate by file_hash (not document_id).
    # The same PDF can be uploaded twice creating two documents with different
    # document_ids but identical content.  The old code deduplicated only inside
    # InvestigationAuditEngine and only by document_id, so every other engine
    # processed duplicate content.
    seen_hashes: set[str]          = set()
    unique_docs: List[NormalisedDocument] = []

    for raw in raw_docs:
        meta      = raw.get("metadata", {})
        file_hash = meta.get("file_hash") or str(raw.get("_id", ""))
        doc_id    = meta.get("document_id") or str(raw.get("_id", ""))

        if file_hash in seen_hashes:
            logger.info(f"[Stage0] Skipping duplicate hash={file_hash[:16]}… doc_id={doc_id}")
            continue
        seen_hashes.add(file_hash)

        raw_sections  = raw.get("sections", {})
        raw_entities  = raw.get("entities", [])
        raw_markdown  = raw.get("raw_markdown", "")

        flat_sections  = flatten_sections(raw_sections)         # FIX 1
        clean_entities = filter_null_vitals(raw_entities)       # FIX 3
        doc_type       = detect_doc_type(flat_sections, raw_markdown)  # FIX 6

        unique_docs.append(NormalisedDocument(
            document_id   = doc_id,
            patient_id    = patient_id,
            doctor_id     = doctor_id or "",
            document_date = meta.get("document_date"),
            file_hash     = file_hash,
            raw_markdown  = raw_markdown,
            sections      = flat_sections,
            entities      = [],   # 🔥 REMOVE ALL ENTITIES
            doc_type      = doc_type,
        ))

    removed = len(raw_docs) - len(unique_docs)
    logger.info(
        f"[Stage0] After dedup: {len(unique_docs)} unique docs "
        f"({removed} duplicates removed)"
    )
    for d in unique_docs:
        logger.info(
            f"[Stage0]   {d.document_id} | type={d.doc_type} | "
            f"date={d.document_date} | sections={len(d.sections)} | entities={len(d.entities)}"
        )

    return unique_docs


async def fetch_patient_demographics(patient_id: str) -> Optional[PatientDemographics]:
    """Fetch patient demographic information from patient_users collection."""
    try:
        patient = await patient_user_collection.find_one({"sys_user_id": patient_id})
        if not patient:
            logger.warning(f"No demographics record for patient={patient_id}")
            return None

        age: Optional[int] = None
        dob = patient.get("date_of_birth")
        if dob:
            try:
                birth_date = datetime.strptime(dob, "%Y-%m-%d").date()
                today      = datetime.utcnow().date()
                age = today.year - birth_date.year - (
                    (today.month, today.day) < (birth_date.month, birth_date.day)
                )
            except Exception:
                pass

        return PatientDemographics(
            name          = patient.get("name"),
            date_of_birth = dob,
            gender        = patient.get("gender"),
            age           = age,
            phone_number  = patient.get("phone_number"),
            email         = patient.get("email"),
            blood_group   = patient.get("blood_group"),
            address       = patient.get("address"),
            hms_id        = patient.get("hms_id"),
        )
    except Exception as e:
        logger.error(f"fetch_patient_demographics error: {e}")
        return None


# ============================================================
# STAGE 1 — CLINICAL CONTEXT BUILDER
# ============================================================

def _build_context_input(docs: List[NormalisedDocument]) -> str:
    parts = []

    for doc in docs:
        parts.append(
            f"\n{'='*60}\n"
            f"DOCUMENT: {doc.document_id} | TYPE: {doc.doc_type} | DATE: {doc.document_date}\n"
            f"{'='*60}"
        )

        # ✅ ONLY sections
        for heading, content in doc.sections.items():
            if content and content.strip():
                truncated = content.strip()[:1000]
                parts.append(f"\n[{heading}]\n{truncated}")

        # ✅ OPTIONAL fallback (still valid — it's section-like raw text)
        if len(doc.sections) <= 2 and doc.raw_markdown:
            parts.append(f"\n[FULL TEXT]\n{doc.raw_markdown[:1200]}")

    return "\n".join(parts)


def extract_diagnosis_from_sections(doc):
    diagnoses = []
    
    # Patterns that indicate a line is NOT a diagnosis
    NOISE_PATTERNS = [
        r'^<!--.*-->$',                          # HTML comments
        r'^(page\s*\d+|\d+\s*/\s*\d+)$',        # Page numbers
        r'^dr\.?\s+\w',                          # Doctor names
        r'^please\s+correlate',                  # Standard disclaimers
        r'^\*+end\s+of',                         # End of report markers
        r'^(patient\'?s?\s+values|normal\s+range)', # Table headers
        r'^(approved\s+by|checked\s+by|verified\s+by)', # Signatures
        r'^\d{2}[./]\d{2}[./]\d{4}$',           # Standalone dates
        r'^(mr\.|mrs\.|ms\.)\s+\w',             # Patient name references
        r'^\'',                                  # Lines starting with quote artifacts
        r'^(vo|en)\s+',                          # OCR artifacts
        r'^(chief\s+m\.o|lab\s+services)',       # Lab admin text
        r'&amp;',                                # HTML entities
    ]
    
    # What makes a line look like a real clinical diagnosis
    CLINICAL_INDICATORS = [
        r'\b(carcinoma|adenocarcinoma|malignancy|lymphoma|leukemia|sarcoma)\b',
        r'\b(anaemia|anemia|hypochromic|normocytic)\b',
        r'\b(syndrome|disease|disorder|failure|infection)\b',
        r'\b(metastati[c|s]|hypermetabolic|fdg\s*avid)\b',
        r'\b(fracture|spondyl|degenerative|lesion[s]?)\b',
        r'\b(diabetes|hypertension|thyroid|hepatitis)\b',
        r'\b(confirmed|features\s+favour|consistent\s+with|findings\s+suggest)\b',
    ]
    
    DIAGNOSIS_HEADINGS = [
        "impression", "diagnosis", "final diagnosis", "conclusion",
        "micro finding", "histopathology", "biopsy"
    ]
    
    for heading, content in doc.sections.items():
        h = heading.lower().strip()
        
        if not any(k in h for k in DIAGNOSIS_HEADINGS):
            continue
        
        lines = content.split("\n")
        for line in lines:
            clean = line.strip()
            
            # Skip empty or very short lines
            if not clean or len(clean) < 8:
                continue
            
            # Skip noise lines
            is_noise = False
            for pattern in NOISE_PATTERNS:
                if re.search(pattern, clean, re.IGNORECASE):
                    is_noise = True
                    break
            if is_noise:
                continue
            
            # Skip lines that are too long to be a diagnosis (likely narrative)
            if len(clean) > 200:
                continue
            
            # Keep lines that have clinical indicators
            has_clinical_content = any(
                re.search(pattern, clean, re.IGNORECASE)
                for pattern in CLINICAL_INDICATORS
            )
            
            if has_clinical_content:
                # Clean up leading artifacts like "- e", "•", "-"
                clean = re.sub(r'^[-•*]\s*(e\s+)?', '', clean).strip()
                if clean:
                    diagnoses.append(clean)
    
    return diagnoses

def extract_medications_from_docs(docs, llm, ctx=None):

    import json
    from langchain.schema import SystemMessage, HumanMessage

    all_content_parts = []

    for doc in docs:
        # ✅ Document header
        all_content_parts.append(f"\n=== DOCUMENT TYPE: {doc.doc_type} ===\n")

        # ✅ ALL sections (correct structure)
        if hasattr(doc, 'sections') and doc.sections:
            for heading, content in doc.sections.items():
                if content and len(str(content).strip()) > 20:
                    content_str = str(content)

                    if len(content_str) > 5000:
                        content_str = content_str[:5000] + "... [truncated]"

                    all_content_parts.append(f"[{heading}]\n{content_str}\n")

        # ✅ Raw markdown (important for drug tables)
        if doc.raw_markdown:
            raw_preview = doc.raw_markdown[:20000]   # 🔥 increase from 10k → 20k
            if len(doc.raw_markdown) > 20000:
                raw_preview += "... [truncated]"

            all_content_parts.append(f"[RAW DOCUMENT CONTENT]\n{raw_preview}\n")

    # ✅ Join everything
    full_content = "\n".join(all_content_parts)

    if not full_content or len(full_content) < 50:
        return []

    if len(full_content) > 80000:
        full_content = full_content[:80000]

    # Context
    active_dx = ctx.active_diagnoses if ctx and ctx.active_diagnoses else []
    active_dx_str = ", ".join(active_dx[:5]) if active_dx else "Not specified"

    # ✅ LLM prompt (same as your engine)
    prompt = f"""
Extract ONLY clinically valid medications from this document.

STRICT EXTRACTION RULES:

1. A medication MUST satisfy ALL of the following:
   - Recognizable drug name OR standard IV fluid OR standard therapy
   - Appears in a clinical treatment context (prescription, plan, medication chart)
   - Has clear medical meaning

2. DO NOT extract:
   - Random uppercase strings
   - OCR errors or broken words
   - Words like "Drug Name", "Orug", "CM6T", etc.
   - Non-medications (e.g., NPO, diet instructions, labels)
   - Ambiguous or unclear terms

3. If a term is not clearly identifiable as a real medication:
   → EXCLUDE it

4. Do NOT guess or normalize drug names.

5. If NO valid medications are clearly present:
   → Return empty list []

6. Each medication MUST be supported by exact text evidence.

OUTPUT FORMAT:
[
  {{
    "name": "",
    "dose": "",
    "frequency": "",
    "route": "",
    "duration": "",
    "evidence": "exact text from document"
  }}
]
Context:
Active diagnoses: {active_dx_str}

DOCUMENT:
{full_content}
"""

    try:
        response = llm.invoke([
            SystemMessage(content="You are a clinical medication extraction expert. Return only JSON."),
            HumanMessage(content=prompt)
        ])

        content = response.content.strip()

        if content.startswith("```"):
            content = content.split("```")[1]

        meds = json.loads(content)

        # ✅ Dedup (same as your engine)
        seen = set()
        unique = []

        for m in meds:
            key = (
                m.get("name", "").upper(),
                m.get("dose", ""),
                m.get("frequency", "")
            )
            if key not in seen:
                seen.add(key)
                unique.append(m)

        return unique

    except Exception as e:
        print(f"Medication extraction failed: {e}")
        return []
async def build_clinical_context(
    docs:       List[NormalisedDocument],
    patient_id: str,
) -> ClinicalContext:
    """
    Stage 1 — UNIVERSAL clinical context builder.
    - NO hardcoded cancer types
    - NO organ-specific keywords
    - Works for ANY patient, ANY condition, ANY cancer
    - Prioritization based on evidence type hierarchy, not specific diseases
    """
    if not docs:
        return _empty_context(patient_id)

    doc_types  = list({d.doc_type for d in docs})
    dates      = [d.document_date for d in docs if d.document_date]
    date_range = {
        "earliest": min(dates) if dates else "",
        "latest":   max(dates) if dates else "",
    }
    context_input = _build_context_input(docs)
    
    # Extract document type distribution (no hardcoded types)
    doc_type_summary = {}
    for doc in docs:
        doc_type_summary[doc.doc_type] = doc_type_summary.get(doc.doc_type, 0) + 1

    system_msg = (
        "You are a clinical information extraction system.\n\n"

        "You must strictly follow these constraints:\n\n"

        "1. EXTRACTION ONLY:\n"
        "- Extract information ONLY if it is explicitly present in the text\n"
        "- Do NOT infer, assume, or complete missing information\n\n"

        "2. EVIDENCE BINDING (CRITICAL):\n"
        "- Every extracted item MUST be directly supported by visible text in the document\n"
        "- If you cannot point to exact supporting text → DO NOT include the item\n\n"

        "3. NUMERIC FIDELITY:\n"
        "- Numeric values (labs, vitals, measurements) must match EXACTLY as written\n"
        "- Do NOT approximate, normalize, or generate values\n"
        "- If multiple values exist → select one that is explicitly stated, not inferred\n\n"

        "4. NO GENERATION:\n"
        "- Do NOT generate medications, tests, diagnoses, or vitals based on patterns\n"
        "- Do NOT assume standard care, protocols, or typical workflows\n\n"

        "5. UNCERTAINTY HANDLING:\n"
        "- If information is missing, unclear, or not explicitly stated → return empty\n"
        "- Absence of evidence is NOT evidence of presence\n\n"

        "6. CONSISTENCY:\n"
        "- Do not introduce contradictions within the output\n"
        "- Do not mix inferred and extracted data\n\n"

        "CRITICAL DIAGNOSTIC VALIDATION RULES:"

        "1. A diagnosis must represent a pathological condition requiring evaluation or treatment."
        "- Do NOT classify normal findings, physiological states, or test observations as diagnoses."

        "2. If a statement contains terms like normal, intact, no abnormality, or similar:"
        "→ It MUST NOT be included as an active diagnosis."

        "3. Measurements and values MUST be interpreted strictly:"
        "- A numeric value alone is NOT a diagnosis."
        "- Only classify as diagnosis if explicitly stated AND clinically abnormal."

        "4. If a condition is mentioned only as:"
        "- observation"
        "- study finding"
        "- monitoring note"
        "→ DO NOT classify as diagnosis."

        "5. If uncertainty exists:"
        "→ EXCLUDE rather than include."

        "6. You MUST NOT upgrade observations into diagnoses."
        "- Only extract what is explicitly labeled or clinically described as a diagnosis."

        "FINAL CHECK BEFORE OUTPUT:"
        "- Every diagnosis must answer:"
        "Is this a disease/condition being treated or evaluated?"
        "If NO → remove it."

        "VITAL SIGN EXTRACTION — STRICT DEFINITION"

        "You must identify vital signs based on CLINICAL ROLE, not numeric appearance."

        "A value is a VITAL SIGN ONLY if:"

        "1. It represents a DIRECT physiological measurement of:"
        "- cardiovascular status"
        "- respiratory status"
        "- temperature regulation"
        "- oxygenation"

        "2. It is typically recorded during bedside examination or monitoring"

        "3. It reflects the patient’s CURRENT physiological state (not lab analysis)"

        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        "EXCLUSION RULE (MANDATORY):"

        "DO NOT include ANY value that is:"

        "- Derived from laboratory testing"
        "- Part of blood counts, biochemistry, or panels"
        "- Reported in lab tables or investigation sections"
        "- A calculated or analyzed parameter rather than a direct measurement"

        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        "DECISION RULE (CRITICAL):"

        "Before including ANY vital:"

        "Ask:"

        "Is this a direct bedside physiological measurement, or is it a lab-derived value?"

        "- If bedside measurement → include"
        "- If lab-derived → EXCLUDE"

        "If there is ANY ambiguity:"
        "→ EXCLUDE"

        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        "ANTI-HALLUCINATION RULE:"

        "- Numeric value ≠ vital sign"
        "- Do NOT classify based on presence of units or numbers"
        "- Do NOT convert qualitative terms into numeric values"

        "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

        "FAIL-SAFE:"

        "If no values clearly satisfy ALL conditions:"
        "→ return \"real_vitals\": {}"

        "Return ONLY valid JSON."
    )

    user_msg = f"""Analyse these patient documents and extract the shared clinical context.

PATIENT ID: {patient_id}
UNIQUE DOCUMENTS: {len(docs)} (duplicates already removed)

DOCUMENT TYPES PRESENT:
{json.dumps(doc_type_summary, indent=2)}

DOCUMENT CONTENT:
{context_input[:8000]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
⚠️ UNIVERSAL RULES FOR DIAGNOSIS PRIORITIZATION ⚠️
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**RULE 1: HIERARCHY OF DIAGNOSTIC CERTAINTY (Highest to Lowest Priority)**

When multiple documents mention different findings for the SAME anatomical location,
prioritize in this order:

1. **DEFINITIVE TISSUE DIAGNOSIS** (Highest priority - GOLD STANDARD)
   - Histopathology examination of tissue specimens
   - Biopsy results with definitive diagnostic terminology
   - Surgical pathology reports
   - Immunohistochemistry results
   - Cytopathology with definitive diagnosis
   - Any report that states a definitive diagnosis based on tissue examination

2. **MOLECULAR/GENETIC CONFIRMATION**
   - Genetic sequencing results
   - Mutation analysis reports
   - Molecular diagnostic tests
   - Biomarker studies with definitive findings

3. **DIAGNOSTIC IMAGING WITH HIGH CERTAINTY**
   - Imaging studies with diagnostic confidence indicators
   - Reports that use definitive diagnostic language
   - Imaging correlated with clinical findings

4. **CLINICAL DIAGNOSIS**
   - Discharge diagnosis documented by treating physicians
   - Final diagnosis in clinical summaries
   - Treatment plans based on established diagnosis

5. **PRELIMINARY OR LOW CERTAINTY FINDINGS** (Lowest priority - do NOT treat as confirmed)
   - Reports using qualifying language (any uncertainty indicators)
   - Differential diagnoses
   - Preliminary or provisional interpretations
   - Incidental findings not confirmed

**RULE 2: RESOLVING CONFLICTS BETWEEN DOCUMENTS**

When there appears to be a conflict:

- **Higher certainty evidence ALWAYS overrides lower certainty evidence**
  - Tissue diagnosis > Imaging impression
  - Confirmed finding > Preliminary finding
  - Specific diagnosis > General description

- **Later date with higher certainty overrides earlier date with lower certainty**
  - Progression from less certain to more certain over time is NORMAL

- **More specific diagnosis overrides less specific**
  - Detailed characterization > Basic identification

**RULE 3: WHAT IS NOT AN ACTIVE DIAGNOSIS**

Do NOT include in `active_diagnoses`:

- Findings explicitly marked as benign or normal
- Findings that are incidental and not related to the primary condition
- Historical conditions already documented as resolved or treated
- Provisional or speculative findings without confirmation
- Findings from lower certainty evidence when higher certainty exists for same location

**RULE 4: WHAT CONSTITUTES AN ACTIVE DIAGNOSIS**

Include in `active_diagnoses` ONLY when:

- Confirmed by definitive tissue diagnosis OR
- Definitively diagnosed in authoritative clinical documentation AND
- Actively being managed or treated AND
- Has diagnostic certainty (not speculative or provisional)

**RULE 5: TRACKING BY ANATOMICAL LOCATION**

For each diagnosis, track the anatomical location:
- Different anatomical sites (left vs right, different organs) are SEPARATE
- Progression in same location over time is NORMAL disease evolution
- Contradictory findings only matter if SAME location, SIMILAR timeframe

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

TASK: CLASSIFY DIAGNOSES INTO ACTIVE vs PAST USING CLINICAL REASONING

You MUST classify every condition based on its ROLE in the patient's current episode of care.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINITION OF ACTIVE DIAGNOSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A condition is ACTIVE ONLY if:

- It is directly responsible for the current admission, symptoms, or treatment
- It is being actively evaluated, investigated, or treated in this encounter
- It explains the patient's present clinical condition

If a condition does NOT influence the current episode → it is NOT active

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DEFINITION OF PAST HISTORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

A condition is PAST HISTORY if:

- It is mentioned as a background condition or comorbidity
- It exists but is not the reason for current admission
- It is stable, controlled, or previously treated
- It is part of the patient’s long-term medical profile

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANDATORY DECISION RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH condition:

Ask:

"Does this condition directly explain WHY the patient is currently admitted or being treated?"

- If YES → ACTIVE
- If NO → PAST HISTORY

You MUST apply this reasoning strictly.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CONFLICT RESOLUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- If a condition appears in both contexts:
  → classify based on its CURRENT role, not historical presence

- If unclear:
  → DO NOT guess
  → classify as PAST HISTORY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT CONSTRAINTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- Do NOT classify all conditions as active
- Do NOT include background conditions in active diagnoses
- Do NOT rely on medical knowledge alone
- Use ONLY the document context and clinical role

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**EXTRACTION TASK:**

Based on the documents above, extract:

1. **ACTIVE DIAGNOSES** 
   - Apply RULE 1 (prioritization hierarchy)
   - Include ONLY confirmed diagnoses with high certainty
   - For each diagnosis, specify the evidence type that supports it
   - If multiple documents discuss the same anatomical location, use the HIGHEST certainty source

2. **PAST HISTORY** 
   - Conditions documented as prior or historical
   - Includes: prior diagnoses, resolved conditions, past surgeries
   - Distinguish from active conditions

3. **PENDING REPORTS** 
   - Investigations explicitly stated as pending or awaiting results
   - Tests ordered but not yet resulted

4. **PRIMARY SPECIALTY** 
   - Based on the HIGHEST certainty active diagnosis
   - Map the condition to the appropriate medical specialty
   - Use standard specialty names based on organ system or condition type

5. **REAL VITALS** 
   - Only vital signs with explicit numeric values and units

6. **MEDICATIONS** 
   - Documented prescriptions with names and dosages when available

7. **INSURANCE MENTIONS** 
   - Any text mentioning insurance, coverage, or payment

8. **RAW_TEXT_SUMMARY** 
   - 3-sentence clinical narrative of the patient's presentation and course

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ADDITIONAL EXTRACTION CONSTRAINTS:

- Every field in the output must be traceable to explicit text in the input
- If a field cannot be directly supported by text → return it as empty

- Do NOT include:
  • implied diagnoses
  • inferred medications
  • assumed pending investigations
  • typical clinical patterns

- If conflicting values exist:
  • select only one that is explicitly stated with highest certainty
  • do not merge or average values

- If unsure whether something is explicitly present:
  • EXCLUDE it

- Prioritize correctness over completeness


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this exact JSON structure:

{{
  "active_diagnoses": [
    {{
      "diagnosis": "string - the definitive diagnosis",
      "certainty": "DEFINITIVE | PROVISIONAL | SUSPECTED",
      "evidence_type": "TISSUE_DIAGNOSIS | MOLECULAR | IMAGING | CLINICAL",
      "anatomical_location": "string - specific location if applicable",
      "date_confirmed": "YYYY-MM-DD if available"
    }}
  ],
  "past_history": [
    {{
      "condition": "string",
      "status": "RESOLVED | STABLE | TREATED",
      "anatomical_location": "string or N/A"
    }}
  ],
  "pending_reports": ["string - report name"],
  "primary_complaint": "string - main reason for seeking care",
  "primary_specialty": "string - medical specialty",
  "real_vitals": {{"vital_name": "value with unit"}},
  "medications": ["string - medication with dose"],
  "insurance_mentions": ["string - exact text"],
  "raw_text_summary": "string - 3 sentence summary"
}}

IMPORTANT: 
- `active_diagnoses` must be a LIST of objects
- Use ONLY information explicitly present in documents
- Do NOT infer or assume diagnoses not documented
- If certainty cannot be determined, mark as "PROVISIONAL" with explanation
"""

    try:
        # Prefer 70B for context building — this is the most important call
        resp = llm_large.invoke([
            SystemMessage(content=system_msg),
            HumanMessage(content=user_msg),
        ])
        result = parse_llm_json(resp.content)
    except Exception as e:
        logger.warning(f"[Stage1] llm_large failed ({e}), retrying with llm")
        try:
            resp   = llm.invoke([SystemMessage(content=system_msg), HumanMessage(content=user_msg)])
            result = parse_llm_json(resp.content)
        except Exception as e2:
            logger.error(f"[Stage1] Both LLMs failed: {e2}")
            result = {}

    # Validate and build ClinicalContext
    if not isinstance(result, dict):
        result = {}
    
    # Extract active diagnoses with prioritization already applied by LLM
    active_diagnoses_raw = result.get("active_diagnoses", [])
    
    # Convert to simple list of diagnosis strings for backward compatibility
    if isinstance(active_diagnoses_raw, list):
        if active_diagnoses_raw and isinstance(active_diagnoses_raw[0], dict):
            # Structured format - extract diagnosis strings
            final_active_dx = []
            structured_diagnoses = []
            
            for d in active_diagnoses_raw:
                diagnosis_text = d.get("diagnosis", "")
                certainty = d.get("certainty", "PROVISIONAL")
                
                # Only include if we have actual diagnosis text
                if diagnosis_text and len(diagnosis_text) > 3:
                    # For DEFINITIVE certainty, always include
                    if certainty == "DEFINITIVE":
                        final_active_dx.append(diagnosis_text)
                        structured_diagnoses.append(d)
                    # For PROVISIONAL, include but note it
                    elif certainty == "PROVISIONAL":
                        final_active_dx.append(f"[PROVISIONAL] {diagnosis_text}")
                        structured_diagnoses.append(d)
                    # For SUSPECTED, be cautious
                    elif certainty == "SUSPECTED":
                        # Only include if no definitive diagnosis exists for same location
                        # The LLM should have handled prioritization
                        final_active_dx.append(f"[SUSPECTED] {diagnosis_text}")
                        structured_diagnoses.append(d)
        else:
            # Simple list format (fallback)
            final_active_dx = [str(d) for d in active_diagnoses_raw if d and len(str(d)) > 3]
            structured_diagnoses = []
    else:
        final_active_dx = []
        structured_diagnoses = []
    
    # NO hardcoded benign indicators - let the LLM's prioritization handle this
    # The LLM should already have excluded low-certainty findings based on RULE 3
    
    # Past history - can be simple list or structured
    past_history_raw = result.get("past_history", [])
    if isinstance(past_history_raw, list):
        if past_history_raw and isinstance(past_history_raw[0], dict):
            past_history = [p.get("condition", "") for p in past_history_raw if p.get("condition")]
        else:
            past_history = [str(p) for p in past_history_raw if p and len(str(p)) > 2]
    else:
        past_history = []
    
    # Extract primary complaint
    primary_complaint_raw = result.get("primary_complaint", "Not specified")
    if isinstance(primary_complaint_raw, dict):
        primary_complaint = primary_complaint_raw.get("text", "Not specified")
    else:
        primary_complaint = str(primary_complaint_raw)
    
    # Build ClinicalContext
    ctx = ClinicalContext(
        patient_id        = patient_id,
        active_diagnoses  = final_active_dx,
        past_history      = past_history,
        pending_reports   = _ensure_str_list(result.get("pending_reports")),
        primary_complaint = primary_complaint,
        primary_specialty = str(result.get("primary_specialty") or "General Medicine"),
        real_vitals       = result.get("real_vitals") if isinstance(result.get("real_vitals"), dict) else {},
        medications       = _ensure_str_list(result.get("medications")),
        insurance_mentions= _ensure_str_list(result.get("insurance_mentions")),
        doc_types_present = doc_types,
        date_range        = date_range,
        total_documents   = len(docs),
        raw_text_summary  = str(result.get("raw_text_summary") or ""),
    )
    
    # 🔥 ADD THIS EXACTLY HERE
    extracted_meds = extract_medications_from_docs(docs, llm, ctx)

    # Use FULL structured meds (recommended)
    ctx.medications = [m.get("name", "") for m in extracted_meds if m.get("name")]
    # Log the prioritization decisions (no hardcoded values)
    if structured_diagnoses:
        logger.info(f"[Stage1] Structured diagnoses with evidence hierarchy:")
        for dx in structured_diagnoses[:5]:  # Log first 5
            logger.info(f"  - {dx.get('diagnosis', 'N/A')[:50]} | certainty={dx.get('certainty', 'UNKNOWN')} | evidence={dx.get('evidence_type', 'UNKNOWN')}")
    
    # Additional validation: remove any entries that are too short or clearly not diagnoses
    ctx.active_diagnoses = [
        dx for dx in ctx.active_diagnoses 
        if len(dx) > 5 and not dx.lower().startswith(('the', 'a ', 'an '))
    ]

    logger.info(
        f"[Stage1] Context built | active_dx_count={len(ctx.active_diagnoses)} | "
        f"past_history_count={len(ctx.past_history)} | "
        f"specialty={ctx.primary_specialty} | pending={len(ctx.pending_reports)}"
    )
    return ctx


def _ensure_str_list(val: Any) -> List[str]:
    """Safely convert any LLM output to a list of strings."""
    if val is None:
        return []
    if isinstance(val, list):
        return [str(v) for v in val if v]
    if isinstance(val, str):
        return [val] if val else []
    return []


def _empty_context(patient_id: str) -> ClinicalContext:
    return ClinicalContext(
        patient_id=patient_id, active_diagnoses=[], past_history=[],
        pending_reports=[], primary_complaint="No documents available",
        primary_specialty="General Medicine", real_vitals={}, medications=[],
        insurance_mentions=[], doc_types_present=[], date_range={},
        total_documents=0, raw_text_summary="No documents found.",
    )


def _entity_fallback_context(ctx: ClinicalContext, docs: List[NormalisedDocument]) -> ClinicalContext:
    """Build best-effort context from entities alone when LLM call fails."""
    active, past, meds, vitals = [], [], [], {}

    past_signals = {"known case", "history of", "s/p", "post", "k/c/o", "treated", "h/o"}

    for doc in docs:
        for e in doc.entities:
            etype = (e.get("entity_type") or "").lower()
            ename = (e.get("entity_name") or "").strip()
            eval_ = (e.get("entity_value") or "").strip()
            evid  = (e.get("evidence_text") or "").lower()

            if not ename:
                continue

            if etype == "diagnosis":
                if any(sig in evid for sig in past_signals):
                    past.append(ename)
                else:
                    active.append(ename)
            elif etype == "medication":
                meds.append(ename)
            # elif etype == "vital sign" and eval_:
            #     vitals[ename] = eval_

    specialty = "General Medicine"
    if active:
        al = " ".join(active).lower()
        if any(k in al for k in ["myelodysplastic", "mds", "leukemia", "lymphoma", "aplastic"]):
            specialty = "Hematology"
        elif any(k in al for k in ["carcinoma", "cancer", "tumor", "malignant", "sarcoma"]):
            specialty = "Medical Oncology"
        elif any(k in al for k in ["diabetes", "thyroid", "endocrine"]):
            specialty = "Endocrinology"

    ctx.active_diagnoses = list(dict.fromkeys(active))   # deduplicate preserving order
    ctx.past_history     = list(dict.fromkeys(past))
    ctx.medications      = list(dict.fromkeys(meds))
    ctx.real_vitals = {}   # 🚫 DO NOT TRUST ENTITY VITALS
    ctx.primary_specialty= specialty
    ctx.raw_text_summary = f"Fallback context. Active: {active}. Past: {past}."
    return ctx

async def check_element_presence(
    element: str,
    docs: List[NormalisedDocument],
    model
) -> bool:
    """
    Fully generic semantic presence detection using LLM.
    No hardcoding, no predefined mappings.
    """

    combined_text = ""

    # 🔹 Collect all document text
    for doc in docs:
        for heading, content in doc.sections.items():
            combined_text += f"\n[SECTION] {heading}\n{content}\n"

        if doc.raw_markdown:
            combined_text += "\n" + doc.raw_markdown[:2000]

    # 🔥 Limit size
    # PRIORITIZE important sections
    priority_keywords = ["discharge", "complaint", "diagnosis", "history"]

    priority_text = ""
    other_text = ""

    for doc in docs:
        for heading, content in doc.sections.items():
            section_text = f"\n[SECTION] {heading}\n{content}\n"

            if any(k in heading.lower() for k in priority_keywords):
                priority_text += section_text
            else:
                other_text += section_text

    combined_text = (priority_text + other_text)[:6000]

    # 🔥 STEP 1 — Convert element → natural language dynamically
    element_natural = element.replace("_", " ")

    # 🔹 LLM call
    response = await model.ainvoke([
        {
            "role": "system",
            "content": (
                "You are a clinical document understanding expert.\n"
                "Your task is to determine whether a specific type of clinical information "
                "is present in the document.\n"
                "You MUST interpret the meaning of the element and recognize synonyms, "
                "clinical phrasing, and variations.\n"
                "Do NOT rely on exact keyword matching.\n"
                "Return ONLY valid JSON."
            )
        },
        {
            "role": "user",
            "content": f"""
CLINICAL ELEMENT:
{element_natural}

DOCUMENT:
{combined_text}

Instructions:
- Carefully examine BOTH section headings and content
- Clinical information may appear under different headings
- Pay special attention to sections like:
  discharge summary, advice at discharge, medications, complaints

- If the element appears in ANY section → PRESENT
- If clearly not found → ABSENT

- Extract exact supporting evidence

Return ONLY JSON:
{{
  "presence": "PRESENT" or "ABSENT",
  "evidence": "exact supporting sentence"
}}
"""
        }
    ])

    # 🔹 Handle response safely
    raw = response.content.strip()

    if not raw:
        return False

    try:
        result = json.loads(raw)
        return result.get("presence") == "PRESENT"

    except Exception:
        import re
        match = re.search(r'\{.*\}', raw, re.DOTALL)
        if match:
            try:
                result = json.loads(match.group())
                return result.get("presence") == "PRESENT"
            except:
                return False

    return False

# ============================================================
# STAGE 2 — PARALLEL SPECIALIST AGENTS
# ============================================================

class BaseAgent:
    """
    Shared helpers for all agents.
    All section iteration uses doc.sections which is now a flat Dict[str,str] (FIX 7).
    raw_markdown is always available as fallback (FIX 9).
    """

    def __init__(self, model: ChatGroq, name: str):
        self.llm  = model
        self.name = name

    # ── Context helpers ───────────────────────────────────────────────────

    def _sections_text(
        self,
        docs:      List[NormalisedDocument],
        max_chars: int = 5000,
        doc_types: Optional[List[str]] = None,
    ) -> str:
        """
        Concatenate all real section content across documents.
        FIX 7: doc.sections is now {heading: content} — iteration is correct.
        FIX 9: falls back to raw_markdown when sections are thin.
        """
        parts: List[str] = []
        for doc in docs:
            if doc_types and doc.doc_type not in doc_types:
                continue
            parts.append(f"\n--- {doc.doc_type.upper()} | {doc.document_date} ---")
            for heading, content in doc.sections.items():
                if content and content.strip():
                    parts.append(f"[{heading}]\n{content.strip()}")

                # ✅ VERY IMPORTANT — handle tables inside sections
                if isinstance(content, dict) and "tables" in content:
                    for table in content.get("tables", []):
                        for row in table.get("rows", []):
                            row_text = " ".join(str(v) for v in row.values())
                            parts.append(f"[TABLE ROW]\n{row_text}")
            # FIX 9 — use raw_markdown when sections dict has fewer than 3 real headings
            if len(doc.sections) <= 2 and doc.raw_markdown:
                parts.append(f"[FULL TEXT]\n{doc.raw_markdown[:1500]}")
        return "\n".join(parts)[:max_chars]

    def _entities_text(self, docs, types=None):
        return ""   # 🔥 DISABLED — NO ENTITY USAGE

    def _all_headings(self, docs: List[NormalisedDocument]) -> List[str]:
        """Collect all real section headings across all documents."""
        headings: List[str] = []
        for doc in docs:
            headings.extend(doc.sections.keys())
        return headings

    # ── LLM call wrapper ──────────────────────────────────────────────────

    def _call(self, system: str, user: str) -> Any:
        """Single LLM call with JSON parsing. Never raises — returns {} on failure."""
        try:
            resp = self.llm.invoke([
                SystemMessage(content=system),
                HumanMessage(content=user),
            ])
            return parse_llm_json(resp.content)
        except Exception as e:
            logger.error(f"[{self.name}] LLM call failed: {e}")
            return {"error": str(e)}

    def _ts(self) -> str:
        return datetime.utcnow().isoformat()


# ── Medical Adequacy Agent ─────────────────────────────────────────────────

# ✅ UNIVERSAL TREATMENT EXTRACTION (NO HARD DEPENDENCY ON STRUCTURE)

def extract_treatments_from_docs(docs):
    treatments = []

    for doc in docs:
        sections_data = getattr(doc, "sections", None)

        # --- CASE 1: sections is dict (tables + sections present) ---
        if isinstance(sections_data, dict):

            # ✅ Extract from tables (BEST SOURCE)
            tables = sections_data.get("tables", [])
            for table in tables:
                rows = table.get("rows", [])
                for row in rows:
                    if isinstance(row, dict):
                        val = row.get("Orders") or " ".join(str(v) for v in row.values())
                        if val and len(val.strip()) > 3:
                            treatments.append(val.strip())

            # ✅ Extract from sections (plan of care, etc.)
            section_list = sections_data.get("sections", [])
            for sec in section_list:
                if isinstance(sec, dict):
                    heading = sec.get("heading", "")
                    content = sec.get("content", "")
                    if content:
                        treatments.append(f"{heading} {content}".strip())

        # --- CASE 2: sections is already flattened ---
        elif isinstance(sections_data, dict):
            for heading, content in sections_data.items():
                if content:
                    treatments.append(f"{heading} {content}".strip())

        # --- CASE 3: fallback ---
        raw = getattr(doc, "raw_markdown", "") or ""
        if raw.strip():
            treatments.append(raw[:2000])

    return treatments


# ✅ ROBUST TREATMENT DETECTION (NO KEYWORDS, STRUCTURE BASED)

def detect_treatment_presence(docs):
    for doc in docs:
        sections_data = getattr(doc, "sections", None)

        if isinstance(sections_data, dict):

            # If ANY table has rows → treatment exists
            tables = sections_data.get("tables", [])
            for table in tables:
                if table.get("rows") and len(table["rows"]) > 0:
                    return True

            # If meaningful section content exists → treatment likely present
            section_list = sections_data.get("sections", [])
            for sec in section_list:
                content = sec.get("content", "")
                if content and len(content.strip()) > 50:
                    return True

        # fallback raw markdown
        raw = getattr(doc, "raw_markdown", "")
        if raw and len(raw.strip()) > 200:
            return True

    return False

    

class MedicalAdequacyAgent(BaseAgent):
    """
    UNIVERSAL medical adequacy assessment - NO HARDCODING.
    Works for ANY patient, ANY condition, ANY cancer type.
    Adjusts expectations based on document type (diagnostic vs treatment).
    """

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Medical Adequacy Agent")

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        section_text = self._sections_text(docs, max_chars=90000)
        
        treatment_data = extract_treatments_from_docs(docs)

        has_treatment = detect_treatment_presence(docs)
        is_diagnostic_phase = not has_treatment

        # ── Sub-call 1: Clinical narrative ────────────────────────────────
        narrative = self._call(
            system=(
                "You extract clinical narrative from medical documents.\n"
                "Use ONLY information explicitly present in the text.\n"
                "Return valid JSON only."
            ),
            user=f"""Extract the clinical narrative from these patient documents.

PATIENT CONTEXT:
Active diagnoses: {ctx.active_diagnoses}
Past history: {ctx.past_history}
Primary complaint: {ctx.primary_complaint}
Pending reports: {ctx.pending_reports}


DOCUMENT CONTENT:
{section_text}

INSTRUCTIONS:
1. Extract the chief complaint exactly as documented
2. Create a narrative summary of presentation, history, and clinical course
3. Extract past history EXACTLY as documented (do NOT group or categorize)
4. List any physical examination findings documented
5. List any discharge or current medications with doses if available
6. List any risk factors mentioned

You MUST extract treatments from:

1. Tables (especially medication / drug orders)
2. Free text sections (plan of care, treatment descriptions)

Treat ANY structured or unstructured medical intervention as treatment.

DO NOT rely on document type or labels.

Return ONLY this JSON:
{{
  "chief_complaint_structured": ["exact phrase from document"],
  "chief_complaint_narrative": "one clinical paragraph: complaint + history + timeline",
  "past_history_by_category": [],
  "physical_exam_findings": [],
  "discharge_medications": [],
  "risk_factors": []
}}

Use empty arrays for missing information. Never invent data.
"""
        )

        # ── Sub-call 2: Evidence quality (context-aware) ───────────────────
        evidence = self._call(
            system=(
                "You assess clinical documentation quality.\n"
                "You understand the difference between diagnostic workup and treatment documentation.\n"
                "You apply appropriate standards based on the phase of care.\n"
                "Return valid JSON only."
            ),
            user=f"""Assess the quality of clinical evidence for this patient.

PATIENT CONTEXT:
Active diagnoses: {ctx.active_diagnoses}
Pending reports (in progress, not missing): {ctx.pending_reports}
Treatment data extracted from document:
{treatment_data[:10000]}

Is diagnostic phase: {is_diagnostic_phase}

CLINICAL DATA:
{section_text[:35000]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
ASSESSMENT GUIDELINES (Apply universally - no hardcoded values)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1: CONTEXT-AWARE DIAGNOSTIC INTERPRETATION (CRITICAL)

FIRST determine whether an active diagnosis is already documented.

IF an active diagnosis IS PRESENT in the clinical documents:

- Treat this as a clinician-made working or confirmed diagnosis
- DO NOT require re-validation from scratch
- DO NOT aggressively penalize for missing imaging, biopsy, or labs

Instead:
- Evaluate whether the available clinical, laboratory, or treatment data reasonably SUPPORT the diagnosis
- Even partial or indirect evidence is acceptable
- Clinical judgment (symptoms + exam + basic labs) is VALID evidence

For PROVISIONAL / SUSPECTED diagnoses (e.g., "?", "possible", "evolving"):
- Interpret as EARLY-STAGE diagnostic reasoning
- This is NOT a deficiency
- Expect incomplete evidence
- Classify as MODERATE evidence if some supporting data exists

For ACUTE CLINICAL CONDITIONS (e.g., infections, LRTI, pneumonia, sepsis):
- Clinical findings (fever, cough, exam findings) + inflammatory markers (CRP, ESR, WBC)
  should be considered STRONG or MODERATE evidence
- Imaging or culture confirmation may be pending and is NOT mandatory initially

ONLY mark "lack of diagnostic evidence" IF:
- Diagnosis is present BUT absolutely NO supporting data exists in ANY form

IF NO active diagnosis is present:
- Then perform full strict diagnostic evidence evaluation

If symptoms OR treatment exist → DO NOT classify as "no evidence"

RULE 2: TREATMENT ALIGNMENT (Context-Dependent)

This assessment DEPENDS on the phase of care:

DIAGNOSTIC PHASE (no treatment documents):
- Treatment alignment score should be N/A or high by default
- Reason: Treatment planning occurs AFTER diagnosis confirmation
- Do NOT penalize for missing treatment plans during diagnostic workup
- Set score to 0.8-1.0 with note that this is diagnostic phase

TREATMENT PHASE (has discharge summary or treatment plan):
- Evaluate whether documented treatments align with active diagnosis
- Consider standard of care for the condition
- Flag any obvious mismatches

RULE 3: DOCUMENT CONSISTENCY

Check for:
- Consistent patient information across documents
- Logical temporal sequence of events
- No contradictory findings in the same anatomical location at the same time

Different findings in different locations or different times are NOT inconsistencies.

RULE 4: SCORING GUIDELINES

Score each category from 0.0 to 1.0:

For DIAGNOSTIC ACCURACY:
If diagnosis is already present:
- 0.8–1.0: Diagnosis documented with reasonable clinical support
- 0.6–0.8: Diagnosis present with partial supporting evidence or pending confirmation
- 0.4–0.6: Diagnosis present but weak supporting data
- Below 0.4: Diagnosis present but no supporting evidence at all

If NO diagnosis is present:
- Use strict evidence-based scoring (as defined above)

For TREATMENT ALIGNMENT:
- If diagnostic phase: 0.8-1.0 (treatment planning not expected)
- If treatment phase with appropriate treatment: 0.8-1.0
- If treatment phase with missing/inappropriate treatment: 0.3-0.7
- If no treatment phase documented: 0.8-1.0 with explanation

For DOCUMENT CONSISTENCY:
- 0.9-1.0: No contradictions, logical flow
- 0.7-0.9: Minor inconsistencies,不影响 overall
- 0.5-0.7: Some concerning inconsistencies
- Below 0.5: Major contradictions

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE 5: EXPLICIT EVIDENCE MAPPING (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST explicitly extract and map supporting evidence for each diagnosis.

Populate "evidence_mapping" as follows:

- diagnosis_present:
  List all active or provisional diagnoses mentioned

- supporting_symptoms:
  Extract symptoms from complaints/history that support the diagnosis

- supporting_vitals:
  Include abnormal or relevant vitals (e.g., fever, low SpO2, tachycardia)

- treatment_support:
  Include treatments that indirectly support the diagnosis (e.g., antibiotics → infection)

- missing_confirmatory_evidence:
  List missing labs, imaging, or reports ONLY if relevant

IMPORTANT RULES:
- Clinical symptoms alone are VALID supporting evidence
- Treatment is INDIRECT but VALID evidence
- DO NOT say "no evidence" if symptoms or treatment exist
- If evidence exists → classify as partial/moderate instead of absent

MANDATORY EXTRACTION REQUIREMENT:

You MUST actively extract evidence from ALL available sections:

- supporting_symptoms → MUST be extracted from chief complaints and history
- supporting_vitals → MUST be extracted from vital signs if present
- treatment_support → MUST be extracted from medications or treatment sections

DO NOT leave these fields empty if relevant data exists anywhere in the input.

If data exists and you leave it empty → it is considered an ERROR.

Before returning JSON, you MUST verify:
- If symptoms exist → supporting_symptoms cannot be empty
- If vitals exist → supporting_vitals cannot be empty
- If medications exist → treatment_support cannot be empty

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULE: TREATMENT–DIAGNOSIS ALIGNMENT (UNIVERSAL, NO HARDCODING)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST evaluate whether treatments logically correspond to the documented diagnoses using clinical reasoning.

DO NOT rely on predefined mappings, keywords, or examples.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 1: IDENTIFY TREATMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Extract ALL treatments from the document, including:
- Medications
- IV therapies
- Procedures
- Supportive care

You MUST extract treatments from:

1. Tables (especially medication / drug orders)
2. Free text sections (plan of care, treatment descriptions)

Treat ANY structured or unstructured medical intervention as treatment.

DO NOT rely on document type or labels.

If any medications, IV therapies, procedures, or treatment plans are present in the document content,
you MUST classify this as TREATMENT CONTEXT.

DO NOT depend on metadata like document type.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 2: INFER CLINICAL PURPOSE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH treatment:
- Infer its clinical purpose based on context
- Determine what condition it is intended to treat or manage

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 3: MATCH WITH DIAGNOSES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Compare inferred treatment purpose with documented diagnoses:

Classify each treatment into:

- diagnosis_to_treatment:
  Treatment directly targets a documented active diagnosis

- supportive_treatment:
  Treatment supports symptoms or physiological stability related to diagnosis

- comorbidity_management:
  Treatment is for chronic or unrelated conditions (e.g., diabetes, hypertension)

- mismatches:
  Treatment has NO logical connection to ANY documented diagnosis

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STEP 4: ALIGNMENT DECISION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Evaluate overall alignment:

- STRONG ALIGNMENT:
  Most treatments logically correspond to active diagnosis or its complications

- PARTIAL ALIGNMENT:
  Some treatments support diagnosis, but key expected treatments are missing or unclear

- WEAK ALIGNMENT:
  Treatments do not logically correspond to diagnosis OR appear inappropriate

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCORING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- 0.8–1.0 → Strong logical alignment
- 0.6–0.8 → Partial alignment
- <0.6 → Weak or inappropriate alignment

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- DO NOT use predefined medical rules (e.g., "antibiotics → infection")
- DO NOT assume treatment meaning without contextual reasoning
- DO NOT classify chronic medications as mismatches
- Use only information present in the document

You MUST justify alignment based on inferred clinical intent, not keywords.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON:
{{
  "diagnostic_accuracy": {{
  "score": 0.0,
  "strengths": [],
  "issues": [],
  "evidence_mapping": {{
    "diagnosis_present": [],
    "supporting_symptoms": [],
    "supporting_vitals": [],
    "treatment_support": [],
    "missing_confirmatory_evidence": []
  }}
}}
  "clinical_decision_making": {{
    "score": 0.0,
    "strengths": [],
    "issues": []
  }},
  "treatment_alignment": {{
  "score": 0.0,
  "strengths": [],
  "issues": [],
  "treatment_mapping": {{
    "diagnosis_to_treatment": [],
    "supportive_treatment": [],
    "comorbidity_management": [],
    "mismatches": []
  }},
  "context_note": ""
}},
  "document_consistency": {{
    "score": 0.0,
    "strengths": [],
    "issues": []
  }},
  "disease_evolution": {{
    "is_progression": null,
    "is_new_diagnosis": null,
    "justification": ""
  }},
  "uncertainties": [],
  "critical_findings": []
}}
"""
        )

        # ── Sub-call 3: Adequacy verdict (context-aware) ───────────────────
        
        diag_score = (evidence.get("diagnostic_accuracy") or {}).get("score", 0.5)
        treat_score = (evidence.get("treatment_alignment") or {}).get("score", 0.5)
        cons_score = (evidence.get("document_consistency") or {}).get("score", 0.5)
        
        # Adjust treatment score for diagnostic phase
        if is_diagnostic_phase and treat_score < 0.7:
            treat_score = 0.8  # Diagnostic phase - treatment planning not expected
            treat_note = "Diagnostic phase - treatment planning not yet expected"
        else:
            treat_note = ""
        
        avg_score = round((diag_score + treat_score + cons_score) / 3, 3)

        verdict = self._call(
            system=(
                "You determine medical adequacy verdicts for insurance review.\n"
                "You account for the phase of care (diagnostic vs treatment).\n"
                "Return valid JSON only."
            ),
            user=f"""Determine the final medical adequacy verdict.

CASE SUMMARY:
{ctx.raw_text_summary}

ACTIVE DIAGNOSES:
{ctx.active_diagnoses}

PENDING REPORTS (in progress, not deficiencies):
{ctx.pending_reports}


Is this diagnostic phase? {is_diagnostic_phase}

ASSESSMENT SCORES:
- Diagnostic accuracy: {diag_score}
- Treatment alignment: {treat_score}
- Document consistency: {cons_score}
- Average score: {avg_score}
{treat_note}

CRITICAL FINDINGS:
{evidence.get("critical_findings", [])}

UNCERTAINTIES:
{evidence.get("uncertainties", [])}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VERDICT RULES (Apply universally)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1: SCORE THRESHOLDS
- "Adequate": average score ≥ 0.7 AND no critical missing diagnostic evidence
- "Inadequate": average score < 0.4 OR critical diagnostic evidence completely missing
- "Inconclusive": average score 0.4-0.7 OR pending results needed for definitive diagnosis

RULE 2: PHASE OF CARE ADJUSTMENT
- For DIAGNOSTIC PHASE: 
  - Missing treatment plans is NOT a deficiency
  - Focus on diagnostic evidence quality
  - If diagnostic evidence is strong, can be "Adequate" even without treatment plan

- For TREATMENT PHASE:
  - Both diagnosis AND treatment alignment matter
  - Missing treatment plan when treatment is expected IS a deficiency

RULE 3: INTERPRETATION GUIDANCE
- Explain why the verdict was reached
- Note if this is diagnostic vs treatment phase
- Highlight what would be needed to reach "Adequate" if not already there

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON:
{{
  "adequacy_score": {avg_score},
  "final_verdict": "Adequate",
  "next_steps": [],
  "recommendations": [],
  "clinical_interpretation": "",
  "confidence": 0.0
}}

Note: final_verdict must be one of: "Adequate", "Inadequate", "Inconclusive"
"""
        )

        # Prepare treatment alignment with context note
        treatment_alignment_output = evidence.get("treatment_alignment", {})
        if is_diagnostic_phase:
            treatment_alignment_output["context_note"] = "Diagnostic workup phase - treatment planning not yet expected"
            if treatment_alignment_output.get("score", 0.5) < 0.7:
                treatment_alignment_output["score"] = 0.8

        return {
            "agent_name": self.name,
            "adequacy_score": verdict.get("adequacy_score", avg_score),
            "patient_summary": {
                "chief_complaints": {
                    "structured": narrative.get("chief_complaint_structured", []),
                    "narrative": narrative.get("chief_complaint_narrative", ""),
                },
                "physical_examination": narrative.get("physical_exam_findings", []),
            },
            "vital_signs": [
                {"name": k, "value": v} for k, v in ctx.real_vitals.items()
            ],
            "past_history": {
                "original": ctx.past_history,   # ✅ EXACT from context
                "categorized": narrative.get("past_history_by_category", [])
            },
            "risk_factors": narrative.get("risk_factors", []),
            "discharge_medications": {"medications": ctx.medications},
            "diagnostic_accuracy": evidence.get("diagnostic_accuracy", {}),
            "clinical_decision_making": evidence.get("clinical_decision_making", {}),
            "treatment_alignment": treatment_alignment_output,
            "document_consistency": evidence.get("document_consistency", {}),
            "disease_evolution": evidence.get("disease_evolution", {}),
            "uncertainties": evidence.get("uncertainties", []),
            "critical_findings": evidence.get("critical_findings", []),
            "clinical_interpretation": verdict.get("clinical_interpretation", ""),
            "next_steps": verdict.get("next_steps", []),
            "recommendations": verdict.get("recommendations", []),
            "final_verdict": verdict.get("final_verdict", "Inconclusive"),
            "confidence": verdict.get("confidence", 0.5),
            "patient_id": ctx.patient_id,
            "documents_analyzed": ctx.total_documents,
            "analysis_timestamp": self._ts(),
        }


# ── Medical Sufficiency Agent ──────────────────────────────────────────────

class MedicalSufficiencyAgent(BaseAgent):
    """
    FIX 5 — Two focused sub-calls instead of one mega-prompt.
    FIX 6 — Uses actual heading names for presence detection.

    Sub-call 1: Guideline concordance at item level
    Sub-call 2: Sufficiency verdict for insurance claim
    """

    REQUIRED_ELEMENTS: Dict[str, List[str]] = {
        "chief_complaints":   ["chiefcomplaint", "chiefcomplaints", "presentingcomplaint"],
        "history_of_illness": ["historyofpresentillness", "historyofpresent",
                               "presentillness", "historyofpresentingillness"],
        "past_history":       ["pasthistory", "past history", "pastmedicalhistory"],
        "vitals":             ["physicalexamination", "generalexamination",
                               "physicalexam", "vitalparameters"],
        "investigations":     ["haemogram", "bloodgroup", "absolutecounts", "rbcindices",
                               "petctscan", "petct", "radiology", "investigation",
                               "differentialcount"],
        "diagnosis":          ["diagnosis", "finaldiagnosis", "impression",
                               "dischargedx", "dischargediagnosis"],
        "discharge_meds":     ["recommendationsatdischarge", "dischargeadvice",
                               "dischargerecommendations", "dischargeprescription"],
        "discharge_summary":  ["summaryofhospitalcourse", "dischargesummary",
                               "hospitalcourse", "summaryofcourse"],
    }

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Medical Sufficiency Agent")
        self.model = model

    def _extract_element_evidence(self, element: str, ctx: ClinicalContext, docs):
        if element == "chief_complaints":
            return ctx.primary_complaint or ctx.raw_text_summary

        if element == "history_of_illness":
            return ctx.raw_text_summary

        if element == "past_history":
            return ctx.past_history

        if element == "vitals":
            return ctx.real_vitals

        if element == "diagnosis":
            return ctx.active_diagnoses

        if element == "investigations":
            return {
                "labs_present": "laboratory" in ctx.doc_types_present,
                "radiology_present": "radiology" in ctx.doc_types_present,
                "pending_reports": ctx.pending_reports
            }

        if element == "discharge_meds":
            return ctx.medications

        if element == "discharge_summary":
            return ctx.raw_text_summary

        return None

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx:  ClinicalContext,
        demo: Optional[PatientDemographics] = None,
        engine_results: Optional[Dict[str, Any]] = None   # ✅ ADD
    ) -> Dict[str, Any]:
        
        engine_results = engine_results or {}

        # FIX 6 — check against real flattened heading names
        all_headings = self._all_headings(docs)
        headings_blob = " ".join(
            h.lower().replace(" ", "").replace(":", "").replace("_", "")
            for h in all_headings
        )

        # Replace the old heading-only check:
        present: List[str] = []
        missing: List[str] = []
        def is_present_from_context(element: str, ctx: ClinicalContext) -> bool:
            if element == "chief_complaints":
                return bool(ctx.primary_complaint)

            if element == "past_history":
                return bool(ctx.past_history)

            if element == "vitals":
                return bool(ctx.real_vitals)

            if element == "diagnosis":
                return bool(ctx.active_diagnoses)

            if element == "investigations":
                return "laboratory" in ctx.doc_types_present or "radiology" in ctx.doc_types_present

            if element == "history_of_illness":
                return bool(ctx.raw_text_summary)

            # discharge elements → only if discharge doc exists
            if element in ["discharge_meds", "discharge_summary"]:
                return "discharge_summary" in ctx.doc_types_present

            return False
        
        def is_discharge_present(ctx, engine_results):
            # 1️⃣ Check discharge engine (STRONGEST signal)
            discharge_engine = engine_results.get("Discharge & Outcome Engine", {})

            if discharge_engine.get("discharge_summary"):
                return True

            # 2️⃣ Check context summary (fallback)
            if ctx.raw_text_summary and "discharge" in ctx.raw_text_summary.lower():
                return True

            return False


        def is_discharge_meds_present(ctx, engine_results):
            # 1️⃣ Check medication review engine
            med_engine = engine_results.get("Medication Review Engine", {})
            if med_engine.get("current_medications"):
                return True

            # 2️⃣ Check context meds
            if ctx.medications:
                return True

            return False


        present = []
        missing = []
        present_evidence = {}

        for element in self.REQUIRED_ELEMENTS:

            if is_present_from_context(element, ctx):
                present.append(element)
                present_evidence[element] = self._extract_element_evidence(element, ctx, docs)
                continue

            if element == "discharge_summary":
                if is_discharge_present(ctx, engine_results):
                    present.append(element)
                    present_evidence[element] = self._extract_element_evidence(element, ctx, docs)
                    continue

            if element == "discharge_meds":
                if is_discharge_meds_present(ctx, engine_results):
                    present.append(element)
                    present_evidence[element] = self._extract_element_evidence(element, ctx, docs)
                    continue

            if await check_element_presence(element, docs, self.model):
                present.append(element)
                present_evidence[element] = self._extract_element_evidence(element, ctx, docs)
            else:
                missing.append(element)

        completeness = round(len(present) / len(self.REQUIRED_ELEMENTS), 3)

        # All unique entity names for item-level assessment
        all_entity_names = []   # 🔥 removed

        # ── Sub-call 1: Item-level guideline concordance ───────────────────
        concordance = self._call(
            system=(
                "You are a medical coding and insurance guideline expert. "
                "Evaluate ONLY the items listed — do not add new ones. Return JSON only."
            ),
            user=f"""Evaluate each clinical item for guideline concordance.

ACTIVE DIAGNOSES (these drive the assessment): {ctx.active_diagnoses}
PAST HISTORY (check history codes): {ctx.past_history}
PENDING REPORTS (mark as PENDING — do not penalise): {ctx.pending_reports}
PRIMARY SPECIALTY: {ctx.primary_specialty}

CLINICAL ITEMS PRESENT (evaluate ONLY these — do not add or invent):
{json.dumps(all_entity_names[:60], indent=2)}

For EACH item return:
- category: Diagnosis | Investigation | Procedure | Medication | Lab Result | Finding
- status: CONCORDANT | NON-CONCORDANT | PENDING
- comments: one sentence
- confidence: 0.0-1.0

Status rules:
- CONCORDANT   : item clearly appropriate and guideline-aligned for active diagnosis
- PENDING      : item relates to pending reports (NGS, BMA) — not penalised
- NON-CONCORDANT: item clearly inappropriate or conflicts with guidelines

Return ONLY this JSON:
{{
  "item_level_assessment": [
    {{"name": "exact item name", "category": "Diagnosis",
      "status": "CONCORDANT", "comments": "one sentence", "confidence": 0.9}}
  ],
  "who_criteria_sufficiency": "SUFFICIENT | INSUFFICIENT | UNKNOWN",
  "guideline_summary": "one paragraph"
}}""",
        )

        # ── Sub-call 2: Sufficiency verdict ────────────────────────────────
        verdict = self._call(
            system=(
                "You are a medical sufficiency auditor for insurance claims. "
                "Return JSON only."
            ),
            user=f"""Give a final sufficiency verdict for this insurance claim.

CASE SUMMARY     : {ctx.raw_text_summary}
ACTIVE DIAGNOSES : {ctx.active_diagnoses}
PENDING (in-progress, not missing): {ctx.pending_reports}
COMPLETENESS SCORE: {completeness} ({len(present)}/{len(self.REQUIRED_ELEMENTS)} elements)
PRESENT ELEMENTS : {present}
MISSING ELEMENTS : {missing}
WHO CRITERIA     : {concordance.get("who_criteria_sufficiency", "UNKNOWN")}

IMPORTANT: pending reports (NGS, BMA, bone marrow biopsy) are IN PROGRESS — they were
ordered and done during admission, results are awaited. Do NOT treat them as missing.

Return ONLY this JSON:
{{
  "sufficiency_score": 0.0,
  "final_verdict": "Sufficient | Insufficient | Inconclusive",
  "critical_gaps": ["specific gap that would prevent claim processing"],
  "recommendations": ["actionable recommendation"],
  "executive_summary": "2-sentence summary for insurance reviewer",
  "confidence": 0.0
}}""",
        )

        return {
            "agent_name":       self.name,
            "sufficiency_score": verdict.get("sufficiency_score", completeness),
            "documentation_completeness": {
                "score":           completeness,
                "present_elements": present,
                "present_elements_with_evidence": present_evidence,
                "missing_elements": missing,
                "detailed_check":  {
                    el: ("PRESENT" if el in present else "MISSING")
                    for el in self.REQUIRED_ELEMENTS
                },
                "impact": (
                    "Missing elements may affect claim processing: " + ", ".join(missing)
                    if missing else "Documentation appears complete"
                ),
            },
            "evidence_sufficiency": {
                "score":                       round(completeness * 0.85, 3),
                "data_sources":                ctx.doc_types_present,
                "pending_reports_in_progress": ctx.pending_reports,
            },
            "guideline_concordance": {
                "who_criteria_sufficiency": concordance.get("who_criteria_sufficiency", "UNKNOWN"),
                "item_level_assessment":    concordance.get("item_level_assessment", []),
                "summary":                  concordance.get("guideline_summary", ""),
            },
            "critical_gaps":       verdict.get("critical_gaps", []),
            "recommendations":     verdict.get("recommendations", []),
            "executive_summary":   verdict.get("executive_summary", ""),
            "final_verdict":       verdict.get("final_verdict", "Inconclusive"),
            "confidence":          verdict.get("confidence", 0.5),
            "uncertainties_and_gaps": missing,
            "patient_id":              ctx.patient_id,
            "documents_analyzed":      ctx.total_documents,
            "analysis_timestamp":      self._ts(),
        }

# ── Clinical Derivation Agent ──────────────────────────────────────────────



def extract_explicit_tnm(text):
    # Find T, N, M independently (not in one line)
    t_match = re.search(r'\b[pPcC]?[Tt]\d[a-zA-Z]?\b', text)
    n_match = re.search(r'\b[pPcC]?[Nn][0-3xX]\b', text)
    m_match = re.search(r'\b[pPcC]?[Mm][0-1xX]\b', text)

    if t_match and n_match:
        t = t_match.group()
        n = n_match.group()
        m = m_match.group() if m_match else "M0"  # default if missing

        return t, n, m

    return None
class ClinicalDerivationAgent(BaseAgent):
    """
    UNIVERSAL TNM/Staging derivation - NO HALLUCINATION.
    ALL logic is in the prompt - no separate helper functions.
    
    RULES:
    1. If explicit TNM in document → use it (confidence=1.0)
    2. If no explicit TNM but sufficient clinical data → derive cautiously
    3. If insufficient data → return null for all TNM fields
    4. NEVER assume or hallucinate staging
    """

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Clinical Derivation Agent")

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        if not ctx.active_diagnoses and not ctx.past_history:
            return {
                "agent_name": self.name,
                "can_derive_any": False,
                "summary": "No diagnoses identified — cannot derive codes.",
                "tnm_classification": None,
                "icd_codes": [],
                "cpt_codes": [],
                "derivation_timestamp": self._ts(),
            }

        # Gather ALL clinical text for TNM detection
        all_text_parts: List[str] = []
        
        # Priority 1: Impression/Diagnosis sections (highest priority)
        for doc in docs:
            for heading, content in doc.sections.items():
                heading_lower = heading.lower()
                if any(k in heading_lower for k in [
                    "impression", "diagnosis", "conclusion", "finaldiagnosis",
                    "pathology", "histopathology", "biopsy result"
                ]) and content:
                    all_text_parts.append(f"[{heading}]\n{content}")
        
        # Priority 2: Discharge summary sections
        for doc in docs:
            for heading, content in doc.sections.items():
                heading_lower = heading.lower()
                if any(k in heading_lower for k in [
                    "discharge", "summaryofhospitalcourse"
                ]) and content:
                    all_text_parts.append(f"[{heading}]\n{content[:1000]}")
        
        # Priority 3: Observations/Findings (lower priority)
        for doc in docs:
            for heading, content in doc.sections.items():
                heading_lower = heading.lower()
                if any(k in heading_lower for k in [
                    "observation", "findings", "result"
                ]) and content:
                    all_text_parts.append(f"[{heading}]\n{content[:800]}")
        
        # Combine all text
        full_text = "\n\n".join(all_text_parts)
        
        # If no text available, use raw markdown
        if not full_text.strip():
            for doc in docs:
                if doc.raw_markdown:
                    full_text += doc.raw_markdown[:3000] + "\n\n"
        
        # ============================================================
        # SINGLE LLM CALL WITH COMPLETE PROMPT - ALL LOGIC HERE
        # ============================================================
        
        result = self._call(
            system=(
                "You are a clinical oncology staging expert. "
                "Your task is to extract or derive TNM classification from clinical documents. "
                "You MUST follow these rules STRICTLY:\n\n"
                "1. NEVER hallucinate or invent TNM staging that is not explicitly documented\n"
                "2. If explicit TNM is present in the document, extract it exactly and use it\n"
                "3. If no explicit TNM exists, check if there is sufficient clinical data to derive conservatively\n"
                "4. If insufficient data exists, return null for ALL TNM fields\n"
                "5. Confidence must reflect certainty: 1.0 for explicit, 0.5-0.8 for derived, 0.0 for none\n\n"
                "Return valid JSON only. Do not include any explanatory text outside the JSON."
            ),
            user=f"""Derive TNM classification and staging from the clinical documents below.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATIENT CONTEXT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ACTIVE DIAGNOSES:
{json.dumps(ctx.active_diagnoses, indent=2)}

PAST HISTORY:
{json.dumps(ctx.past_history, indent=2)}

PENDING REPORTS:
{json.dumps(ctx.pending_reports, indent=2)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOCUMENT CONTENT (Prioritized: Impression > Discharge > Observations)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{full_text[:8000]}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRACTION RULES (FOLLOW EXACTLY - NO EXCEPTIONS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1: EXPLICIT TNM DETECTION (HIGHEST PRIORITY)

Scan the document for explicit TNM notation patterns including:
- TNM format with T, N, M categories (case insensitive)
- Stage notation with Roman numerals or numbers
- Pathological or clinical staging prefixes (p, c, yp, etc.)

If ANY explicit TNM notation is found:
- Extract the EXACT values as written (do not modify or interpret)
- Set derivation_method = "document"
- Set confidence = 1.0
- Include the exact matching text as evidence
- Skip all derivation rules below

RULE 2: DERIVATION FROM CLINICAL DATA (ONLY IF NO EXPLICIT TNM)

Only apply this rule if NO explicit TNM notation was found in the document.

T CATEGORY derivation (assign ONLY if explicitly described in the text):
- T1: Tumor is small, minimally invasive, confined to organ of origin
- T2: Tumor is medium-sized, moderate local invasion
- T3: Tumor is large, multiple tumors present, or deep invasion
- T4: Tumor invades adjacent structures, blood vessels, or adjacent organs

N CATEGORY derivation:
- N0: Text explicitly states no lymph node involvement, negative nodes, or no nodal metastasis
- N1: Text explicitly states lymph node involvement, nodal metastasis, or node positive

M CATEGORY derivation:
- M0: Text explicitly states no metastasis, no distant spread, or localized disease
- M1: Text explicitly states metastasis present, distant spread, or secondary deposits

CRITICAL: Only assign a category if there is EXPLICIT descriptive text. Do NOT infer from absence of information.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLINICAL EVIDENCE INTERPRETATION (UNIVERSAL – NO KEYWORD MATCHING):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You must determine T, N, and M categories based on clinically meaningful statements describing:

1. PRIMARY TUMOR (T):
- Evaluate descriptions of tumor size, local extent, depth of invasion, or involvement of adjacent structures
- Assign T category ONLY when the document clearly describes the anatomical extent or spread of the primary tumor
- The level of local progression (confined → locally advanced → invasion into adjacent organs) should guide T categorization
- If such anatomical detail is not clearly stated → leave T as null

2. REGIONAL LYMPH NODES (N):
- Evaluate whether the document provides evidence regarding involvement of regional lymph nodes
- If regional lymph nodes are described as abnormal in a malignant context (e.g., enlarged, suspicious, involved, or pathologic), treat this as evidence of nodal involvement unless explicitly stated otherwise
- Statements describing nodal enlargement, pathological involvement, or confirmed nodal disease represent valid evidence
- If nodal status is not clearly defined → leave N as null


3. DISTANT METASTASIS (M):
- Evaluate whether the disease has spread beyond the primary organ and regional nodes
- Assign M1 when there is clear evidence of disease in distant organs, tissues, or non-regional sites
- Assign M0 ONLY when absence of distant spread is explicitly stated
- If distant spread cannot be confidently determined → leave M as null

IMPORTANT CONSTRAINTS:
- Use clinical meaning and context, not keyword matching
- Treat clearly stated clinical findings as valid evidence even if not written in TNM format
- Do NOT infer from missing information
- Do NOT assume severity based on grade, biomarkers, or treatment alone
- Each category (T, N, M) must be supported independently by documented clinical evidence

CONFIDENCE ASSIGNMENT:
- If derived from clear clinical descriptions → confidence between 0.6 and 0.85
- If partially supported → reduce confidence accordingly
- If no reliable evidence → confidence = 0.0

DERIVATION METHOD:
- If any category is assigned using this reasoning → set derivation_method = "clinical_inference"

RULE 3: INSUFFICIENT DATA HANDLING

If NONE of the following are present in the document:
- Any explicit TNM notation
- Any explicit tumor size or invasion description
- Any explicit nodal status description
- Any explicit metastasis status description

THEN:
- Set ALL categories to null
- Set derivation_method = "none"
- Set confidence = 0.0
- Set can_derive_t = false, can_derive_n = false, can_derive_m = false

RULE 4: STAGE GROUP DERIVATION

Derive stage when sufficient information is available:

- If M1 is present → assign Stage IV regardless of T or N
- Otherwise derive stage conservatively using available T and N data
- If insufficient data → stage_group = null:

Stage 0: Carcinoma in situ with no nodal involvement and no metastasis
Stage I: Small primary tumor with no nodal involvement and no metastasis
Stage II: Medium primary tumor OR small primary tumor with regional nodal involvement, no metastasis
Stage III: Large primary tumor OR any tumor with extensive nodal involvement, no metastasis
Stage IV: Any tumor with any nodal involvement and presence of distant metastasis

If metastasis is present (M1): Stage IV regardless of T and N categories
If insufficient data for stage derivation: stage_group = null

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON structure (no other text):

{{
  "tnm_classification": {{
    "t_category": null,
    "n_category": null,
    "m_category": null,
    "t_evidence": [],
    "n_evidence": [],
    "m_evidence": [],
    "stage_group": null,
    "stage_evidence": [],
    "derivation_method": "none",
    "confidence": 0.0,
    "can_derive_t": false,
    "can_derive_n": false,
    "can_derive_m": false,
    "can_derive_stage": false
  }},
  "icd_codes": [
    {{
      "code": "",
      "description": "",
      "category": "primary",
      "evidence": [],
      "confidence": 0.0,
      "is_primary": true
    }}
  ],
  "cpt_codes": [
    {{
      "code": "",
      "description": "",
      "category": "",
      "evidence": [],
      "confidence": 0.0
    }}
  ],
  "can_derive_any": true,
  "summary": ""
}}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL REMINDERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- NEVER invent TNM categories that are not explicitly documented or clearly derivable
- If you are uncertain about ANY category, leave it as null
- Confidence score must accurately reflect your certainty in the extraction or derivation
- ICD codes should only be assigned for confirmed active diagnoses with supporting evidence
- CPT codes should only be assigned for explicitly documented procedures
- The summary should be a concise 1-2 sentence explanation of what was found or why nothing could be derived
"""
        )

        if not isinstance(result, dict):
            result = {}

        # Ensure all required fields exist
        result.setdefault("tnm_classification", {
            "t_category": None,
            "n_category": None,
            "m_category": None,
            "t_evidence": [],
            "n_evidence": [],
            "m_evidence": [],
            "stage_group": None,
            "stage_evidence": [],
            "derivation_method": "none",
            "confidence": 0.0,
            "can_derive_t": False,
            "can_derive_n": False,
            "can_derive_m": False,
            "can_derive_stage": False
        })
        
        result.setdefault("icd_codes", [])
        result.setdefault("cpt_codes", [])
        result.setdefault("can_derive_any", bool(ctx.active_diagnoses))
        
        # Set summary if not provided
        if not result.get("summary"):
            tnm = result["tnm_classification"]
            if tnm.get("derivation_method") == "document":
                categories = []
                if tnm.get('t_category'):
                    categories.append(tnm.get('t_category'))
                if tnm.get('n_category'):
                    categories.append(tnm.get('n_category'))
                if tnm.get('m_category'):
                    categories.append(tnm.get('m_category'))
                result["summary"] = f"TNM extracted from document: {' '.join(categories)}".strip()
            elif tnm.get("derivation_method") == "clinical_inference":
                result["summary"] = f"TNM derived from clinical data (confidence: {tnm.get('confidence', 0):.1f})"
            else:
                result["summary"] = "No explicit TNM staging found in documents. Clinical data insufficient for TNM derivation."
        
        result["agent_name"] = self.name
        result["derivation_timestamp"] = self._ts()
        
        return result

# ── Patient & Policy Engine ────────────────────────────────────────────────

class PatientPolicyEngine(BaseAgent):
    """
    FIX 9 — Uses raw_markdown as primary source for insurance text.
    Insurance information is typically in narrative paragraphs, not structured
    sections, so raw_markdown is more reliable than section content here.
    """

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Patient & Policy Engine")

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx:  ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        # Collect insurance-related lines from raw_markdown
        insurance_lines: List[str] = []
        insurance_keywords = [
            "insurance", "policy", "tpa", "cashless", "claim",
            "coverage", "care health", "yh care", "reimbursement",
            "preauthorization", "authorization",
        ]
        for doc in docs:
            for line in (doc.raw_markdown or "").split("\n"):
                line_lower = line.lower()
                if any(kw in line_lower for kw in insurance_keywords):
                    insurance_lines.append(line.strip())

        insurance_context = (
            "\n".join(insurance_lines[:25])
            if insurance_lines else "No explicit insurance text found in documents"
        )

        result = self._call(
            system=(
                "You are a healthcare insurance policy extraction expert. "
                "Extract ONLY what is explicitly present. Never invent policy numbers. Return JSON."
            ),
            user=f"""Extract insurance and policy information from this patient's documents.

PATIENT DEMOGRAPHICS (from database):
{json.dumps(demo.dict() if demo else {{}}, default=str)}

PRE-IDENTIFIED INSURANCE MENTIONS:
{json.dumps(ctx.insurance_mentions)}

INSURANCE-RELATED TEXT FROM DOCUMENTS:
{insurance_context}

SECTION CONTENT:
{self._sections_text(docs, max_chars=1500)}

EXTRACTION RULES:
- Extract insurance info ONLY if explicitly present (insurer name, policy no., claim no., TPA, cashless, coverage)
- "YH CARE HEALTH INSURANCE" is a valid insurance type mention
- Do NOT extract medical treatment plans, anatomical planes, or clinical protocols as insurance
- If nothing found, return empty values — absolutely do not hallucinate policy numbers

Return ONLY this JSON:
{{
  "patient_demographics": {{"name": "", "age": null, "gender": ""}},
  "policy_details": {{
    "policy_mentions": [{{"mention": "exact text", "keyword": "matched keyword"}}],
    "coverage_details": [],
    "insurance_info": {{
      "insurer_name": "",
      "policy_number": "",
      "plan_name": "",
      "claim_number": "",
      "authorization_number": "",
      "coverage_type": ""
    }}
  }},
  "eligibility_status": "eligible | ineligible | unknown",
  "flags": [{{"type": "info | warning | missing_information", "message": ""}}]
}}""",
        )

        if not isinstance(result, dict):
            result = {}
        result["engine_name"] = self.name
        if demo:
            result["patient_demographics"] = demo.dict()
        return result


# ── Investigation Audit Engine ─────────────────────────────────────────────

def structure_clinical_text(text: str) -> str:
    lines = text.split("\n")
    structured = []

    for line in lines:
        clean = line.strip()

        # skip useless noise
        if len(clean) < 5:
            continue

        # detect key-value like rows (very generic, not hardcoded)
        if ":" in clean:
            structured.append(f"- {clean}")
        elif any(char.isdigit() for char in clean) and any(char.isalpha() for char in clean):
            # mixed alpha-numeric → likely clinical data
            structured.append(f"- {clean}")
        else:
            structured.append(clean)

    return "\n".join(structured)

def enrich_with_clinical_structure(text: str) -> str:
    lines = text.split("\n")
    structured = []

    for line in lines:
        clean = line.strip()
        if not clean:
            continue

        # just clean formatting, NO classification
        structured.append(clean)

    return "\n".join(structured)

class InvestigationAuditEngine(BaseAgent):
    """
    UNIVERSAL investigation extraction - NO HARDCODING.
    Works for ANY patient, ANY cancer type, ANY investigation.
    Extracts from document sections only - no examples or patterns.
    """

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Investigation Audit Engine")

    def split_investigations(self, text):
        patterns = re.split(
            r'(?=(?:[A-Z][a-zA-Z]+(?:\s|\(|/))+[\d\.]+)', 
            text
        )
        return [p.strip() for p in patterns if len(p.strip()) > 5]

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        # ============================================================
        # STEP 1: Build comprehensive document context
        # ============================================================
        
        # Collect ALL document content with section context
        all_content_parts: List[str] = []

        for doc in docs:
            doc_header = f"\n{'='*60}\nDOCUMENT: {doc.document_id}\nTYPE: {doc.doc_type}\nDATE: {doc.document_date}\n{'='*60}"
            all_content_parts.append(doc_header)

            # ONLY use sections
            if not doc.sections:
                continue

            for heading, content in doc.sections.items():

                # Handle tables separately (IMPORTANT for your case)
                if heading == "tables" and isinstance(content, list):
                    for table in content:
                        rows = table.get("rows", [])
                        headers = table.get("headers", [])

                        structured_rows = []

                        for row in rows:
                            row_dict = {}

                            for i, (k, v) in enumerate(row.items()):
                                if v and str(v).strip():
                                    header = headers[i] if i < len(headers) else f"column_{i}"
                                    row_dict[header] = str(v).strip()

                            if row_dict:
                                structured_rows.append(row_dict)

                        if structured_rows:
                            all_content_parts.append(
                                "\n[TABLE STRUCTURED]\n" + json.dumps(structured_rows, indent=2)
                            )
                # Handle normal text sections
                elif isinstance(content, str) and content.strip():
                    clean = structure_clinical_text(content)
                    all_content_parts.append(f"\n[{heading}]\n{clean}")
        # ✅ ADD THIS HERE
        full_context = "\n".join(all_content_parts)

        if len(full_context) > 90000:
            full_context = full_context[:90000]
        
        # ============================================================
        # STEP 2: LLM call with UNIVERSAL extraction (no examples)
        # ============================================================
        
        result = self._call(
            system=(
                "You extract clinical investigations from medical documents.\n"
                "You MUST follow these rules STRICTLY:\n\n"
                "1. Extract ANY test, study, or procedure that appears in the document\n"
                "2. Do NOT assume or infer investigations that are not explicitly mentioned\n"
                "3. Use the exact names as they appear in the document\n"
                "4. Extract complete details including results, findings, and dates\n"
                "5. Return ONLY valid JSON - no explanatory text"
            ),
            user=f"""Extract ALL clinical investigations from the documents below.

ACTIVE DIAGNOSES (for context only - do not use to infer investigations):
{json.dumps(ctx.active_diagnoses, indent=2) if ctx.active_diagnoses else "None"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOCUMENT CONTENT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{full_context}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXTRACTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1: WHAT TO EXTRACT
Extract ANY of the following that appear EXPLICITLY in the document:

- Laboratory tests (blood tests, urine tests, any specimen analysis)
- Imaging studies (CT, MRI, X-ray, Ultrasound, PET, any scanning procedure)
- Pathological examinations (biopsy, cytology, histopathology)
- Diagnostic procedures (endoscopy, colonoscopy, any diagnostic intervention)
- Cardiac studies (ECG, ECHO, stress test)
- Respiratory studies (PFT, spirometry)
- Any other clinical investigation with a name and result
- Donot extract Vitals from the documents such ad bp, weight etc 

RULE 2: HOW TO EXTRACT

For EACH investigation found, extract:

1. **name**: The exact test/procedure name as written in the document
   - Use the full name, not abbreviations
   - Preserve all modifiers (e.g., "CECT", "contrast-enhanced", "whole body")

2. **date**: The date when the investigation was performed
   - Format as YYYY-MM-DD if possible
   - If date is ambiguous or missing, use null
   - Do NOT infer dates from document metadata

3. **type**: Classify into one of these categories:
   - "imaging" (any scan, X-ray, ultrasound)
   - "laboratory" (blood, urine, fluid analysis)
   - "pathology" (tissue examination, biopsy)
   - "procedure" (diagnostic or therapeutic intervention)
   - "other" (any investigation that doesn't fit above)

4. **details**: The key result, finding, or observation
   - Extract the main clinical finding or result value
   - Include reference ranges if present
   - For imaging: describe the key observation
   - For labs: include value and reference range
   - Keep it concise (max 150 characters)

5. **status**: Determine from context:
   - "completed" if results are reported or procedure was done
   - "pending" if explicitly stated as awaited or in progress
   - "ordered" if planned but not yet done

RULE 3: WHAT NOT TO EXTRACT
- DO NOT extract diagnoses or clinical impressions (these are not investigations)
- DO NOT extract vital signs or physical exam findings
- DO NOT extract treatments or medications
- DO NOT infer investigations from diagnoses (e.g., don't extract "biopsy" just because cancer is mentioned)

RULE 4: HANDLING UNCERTAINTY
- If you are unsure about any field, use null or empty string
- Do NOT fabricate information to fill missing fields
- Better to have missing data than incorrect data

Investigations may appear:
- as individual rows
- as grouped panels (multiple related rows)
- as multi-line blocks

DEFINITION OF INVESTIGATION (STRICT)

An investigation is ONLY valid if ALL conditions are met:

1. It represents an independently identifiable diagnostic test or procedure
   - It must be something that can be ordered separately (e.g., lab test, imaging study)

2. It has an inherent test identity
   - It is NOT a measurement, symptom, observation, or diagnosis

3. It produces a result that comes FROM a test
   - Not a clinical interpretation or condition

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXCLUSION RULES (STRICT — NO EXCEPTIONS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You MUST EXCLUDE anything that is:

- A physiological measurement (even if numeric)
- A bedside observation or examination finding
- A symptom or complaint
- A diagnosis or medical condition
- A clinical interpretation (e.g., "improving", "elevated", "severe")

CRITICAL DISTINCTION:

❌ NOT investigations:
- Standalone values (numbers with units)
- Vital signs
- Clinical findings
- Diagnoses
- Status descriptions

✅ ONLY investigations:
- Named diagnostic tests/procedures that generate results

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRUCTURAL UNDERSTANDING RULE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If multiple values appear together:

- Extract ONLY if they belong to a recognized test panel or investigation
- Do NOT extract individual measurements unless they clearly belong to a test

Example reasoning (do NOT output this):
- "BP 120/80" → measurement → EXCLUDE
- "Creatinine 2.5" → lab test → INCLUDE

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
VALIDATION STEP (MANDATORY)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

If the extracted name is a short abbreviation or unit-based measurement (e.g., 1–3 letters followed by numeric value), treat it as a measurement, not an investigation, unless it clearly represents a standard diagnostic test.

Before adding any investigation, internally verify:

"Is this something a doctor would ORDER as a test?"

If NO → DO NOT EXTRACT

Clinical data may appear as structured numeric rows or grouped values.

If multiple related measurements (numeric + units + names) appear together,
you MUST interpret them as part of a clinical investigation,
even if the word "test" or "investigation" is not explicitly written.

You MUST identify and extract ALL investigations even if they are part of a group or panel.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY a JSON array with this exact structure:

[
  {{
    "name": "exact investigation name as written",
    "date": "YYYY-MM-DD or null",
    "type": "imaging|laboratory|pathology|procedure|other",
    "details": "key finding or result (max 150 chars)",
    "status": "completed|pending|ordered"
  }}
]

If no investigations are found in the document, return an empty array: []

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CRITICAL REMINDERS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- ONLY extract what is EXPLICITLY written in the document
- Use the EXACT wording from the document for investigation names
- Include ALL investigations, regardless of whether they relate to the active diagnosis
- Do NOT add, modify, or infer any information not present
- Empty arrays are acceptable and preferred over guessing
"""
        )

        # ============================================================
        # STEP 3: Process and validate results
        # ============================================================
        
        investigations: List[Dict] = []
        
        if isinstance(result, list):
            investigations = result
        elif isinstance(result, dict):
            investigations = result.get("investigations", [])
        else:
            investigations = []
        
        # Ensure each investigation has required fields
        validated_investigations = []
        for inv in investigations:
            if not isinstance(inv, dict):
                continue
                
            # Skip if no name
            if not inv.get("name"):
                continue
            
            # Ensure all fields exist with defaults
            validated_inv = {
                "name": inv.get("name", "").strip(),
                "date": inv.get("date") if inv.get("date") else None,
                "type": inv.get("type", "other"),
                "details": inv.get("details", "")[:150],  # Limit length
                "status": inv.get("status", "completed")
            }
            
            # Validate type is one of allowed values
            if validated_inv["type"] not in ["imaging", "laboratory", "pathology", "procedure", "other"]:
                validated_inv["type"] = "other"
            
            # Validate status
            if validated_inv["status"] not in ["completed", "pending", "ordered"]:
                validated_inv["status"] = "completed"
            
            validated_investigations.append(validated_inv)
        
        # ============================================================
        # STEP 4: Deduplicate investigations
        # ============================================================
        
        seen = set()
        unique_investigations = []
        for inv in validated_investigations:
            # Create unique key from name and date
            key = (inv["name"].lower(), inv.get("date") or "")
            if key not in seen:
                seen.add(key)
                unique_investigations.append(inv)
        
        # ============================================================
        # STEP 5: Separate completed and pending
        # ============================================================
        
        completed = [i for i in unique_investigations if i.get("status") == "completed"]
        pending = [i for i in unique_investigations if i.get("status") in ["pending", "ordered"]]
        
        # ============================================================
        # STEP 6: Calculate appropriateness score
        # ============================================================
        
        # Score based on number and types of investigations
        score = 0.4  # Base score
        
        if unique_investigations:
            score += min(len(unique_investigations) * 0.07, 0.4)
            
            # Bonus for having both imaging and labs
            has_imaging = any(i["type"] == "imaging" for i in unique_investigations)
            has_lab = any(i["type"] == "laboratory" for i in unique_investigations)
            if has_imaging and has_lab:
                score += 0.1
        
        appropriateness_score = min(score, 1.0)
        
        # ============================================================
        # STEP 7: Build summary
        # ============================================================
        
        if not unique_investigations:
            summary = "No investigations identified in the documents."
        elif pending:
            summary = f"{len(unique_investigations)} investigations identified ({len(pending)} pending results)."
        else:
            summary = f"{len(unique_investigations)} investigations identified, all completed."
        
        # ============================================================
        # STEP 8: Return result
        # ============================================================
        
        return {
            "engine_name": self.name,
            "investigations_found": unique_investigations,
            "investigations_completed": completed,
            "pending_investigations": pending,
            "investigation_count": len(unique_investigations),
            "investigation_appropriateness_score": round(appropriateness_score, 2),
            "summary": summary,
            "flags": [
                {"type": "info", "message": f"{len(pending)} investigation(s) pending results"}
            ] if pending else [],
        }

# ── Medication Review Engine ───────────────────────────────────────────────

class MedicationReviewEngine(BaseAgent):
    """
    Medication Review Engine — UNIVERSAL EXTRACTION
    - No hardcoded medication names
    - No brittle regex patterns
    - Works for ANY patient, ANY condition, ANY cancer
    - Extracts from ALL document sections intelligently
    """

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Medication Review Engine")

    def _extract_medications_via_llm(
        self, 
        docs: List[NormalisedDocument],
        ctx: ClinicalContext
    ) -> List[Dict[str, Any]]:
        """
        UNIVERSAL medication extraction using LLM.
        Works for ANY medication format, ANY abbreviation, ANY language pattern.
        No hardcoded keywords, no assumptions about document structure.
        """
        
        # Simply collect ALL document content without filtering
        # Let the LLM decide what's medication-related
        all_content_parts = []
        
        for doc in docs:
            # Add document type and metadata for context
            all_content_parts.append(f"\n=== DOCUMENT TYPE: {doc.doc_type} ===\n")
            
            # Add ALL sections with their headings
            if hasattr(doc, 'sections') and doc.sections:
                for heading, content in doc.sections.items():
                    if content and len(str(content).strip()) > 20:
                        # Convert content to string if it's a list/dict
                        content_str = str(content)
                        if len(content_str) > 5000:
                            content_str = content_str[:5000] + "... [truncated]"
                        all_content_parts.append(f"[{heading}]\n{content_str}\n")
            
            # Add raw markdown if available (first 10k chars)
            if doc.raw_markdown:
                raw_preview = doc.raw_markdown[:10000]
                if len(doc.raw_markdown) > 10000:
                    raw_preview += "... [truncated]"
                all_content_parts.append(f"[RAW DOCUMENT CONTENT]\n{raw_preview}\n")
        
        # Join all content
        full_content = "\n".join(all_content_parts)
        
        if not full_content or len(full_content) < 50:
            logger.warning("No document content available for medication extraction")
            return []
        
        # Truncate to LLM context limit (e.g., 32k tokens ~ 100k chars)
        if len(full_content) > 80000:
            full_content = full_content[:80000] + "\n...[document truncated due to length]"
        
        logger.info(f"Processing {len(full_content)} characters of document content")
        
        # Get clinical context
        active_dx = ctx.active_diagnoses if ctx.active_diagnoses else []
        active_dx_str = ", ".join(active_dx[:5]) if active_dx else "Not specified"
        
        # Universal extraction prompt - NO hardcoded examples or keywords
        extraction_prompt = f"""You are performing high-risk clinical extraction.

TASK:
Extract only substances that are clearly administered to the patient as treatment.

CRITICAL THINKING PROCESS (MANDATORY):
For each candidate item, internally verify:

1. Is this something that can be administered to a patient?
2. Is there clear evidence in the text that it was given, ordered, or prescribed?
3. Does the surrounding text indicate therapeutic intent (treatment, prevention, or clinical management)?

ONLY include the item if ALL conditions are satisfied.

EXCLUSION PRINCIPLE:
If there is any ambiguity about whether the item is:
- a measurement
- a test
- a physiological parameter
- a report value
→ DO NOT include it.

Each medication must come from a SINGLE coherent text span.
Do NOT combine information from multiple unrelated lines.
If structured fields (dose, frequency, route) are not clearly linked to the same medication → leave them empty.

If the extracted name:
- does not resemble a known drug or fluid
- or appears as random characters or fragmented tokens

→ DO NOT include it.

EVIDENCE REQUIREMENT:
Evidence must be the exact line or phrase where the medication is mentioned.
Section headers or generic labels are NOT valid evidence.
If a specific supporting line cannot be extracted → exclude the medication.

Do not infer, complete, or guess missing values.
If dose, frequency, route, or duration are unclear → leave them empty.
Never assign unrelated text to fill missing fields.

UNCERTAINTY RULE:
If confidence is not high → exclude the item.

OUTPUT:
Return only a JSON array of confirmed administered substances with:
- name
- dose
- frequency
- duration
- route
- evidence

Do not infer, assume, or complete missing information.
Do not include anything not explicitly supported by text.

If no medications are found, return an empty array: []

**CLINICAL CONTEXT (use for disambiguation only):**
- Active diagnoses: {active_dx_str}

**DOCUMENT CONTENT:**
{full_content}

Extract ALL medications now. Return ONLY the JSON array, no other text.
"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a clinical pharmacist and medication extraction expert. Extract ALL medications from documents based on clinical understanding, not pattern matching. Return ONLY valid JSON."),
                HumanMessage(content=extraction_prompt)
            ])
            
            # Parse LLM response
            content = response.content.strip()
            
            # Remove markdown code blocks if present
            if content.startswith('```json'):
                content = content[7:]
            elif content.startswith('```'):
                content = content[3:]
            if content.endswith('```'):
                content = content[:-3]
            content = content.strip()
            
            # Handle empty response
            if not content or content == '[]':
                return []
            
            medications = json.loads(content)
            
            if not isinstance(medications, list):
                logger.warning(f"LLM returned non-list: {type(medications)}")
                return []
            
            # Deduplicate by medication name (case-insensitive)
            seen = set()
            unique_meds = []
            for med in medications:
                if not isinstance(med, dict):
                    continue
                med_name = med.get('name', '').strip().upper()
                if med_name and med_name not in seen:
                    seen.add(med_name)
                    unique_meds.append(med)
            
            logger.info(f"Extracted {len(unique_meds)} unique medications")
            return unique_meds
            
        except json.JSONDecodeError as e:
            logger.error(f"Failed to parse LLM response as JSON: {e}")
            logger.debug(f"Response content: {response.content[:500]}")
            return []
        except Exception as e:
            logger.error(f"Medication extraction LLM call failed: {e}")
            return []

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:
        
        # Extract medications using LLM (universal, no filtering)
        med_list = self._extract_medications_via_llm(docs, ctx)
        
        if not med_list:
            return {
                "engine_name": self.name,
                "current_medications": [],
                "medication_changes": [],
                "drug_interactions": [],
                "contraindications": [],
                "medication_appropriateness_score": 0.0,
                "flags": [{"type": "info", "message": "No medications found in documents"}],
            }
        
        # Build medication review prompt - also universal
        review_prompt = f"""Review these medications for safety and appropriateness.

    **PATIENT CONTEXT:**
    - Active diagnoses: {ctx.active_diagnoses if ctx.active_diagnoses else 'Not specified'}
    - Age: {demo.age if demo else 'unknown'}
    - Gender: {demo.gender if demo else 'unknown'}
    - Past history: {ctx.past_history[:3] if ctx.past_history else 'None'}

    **MEDICATIONS TO REVIEW:**
    {json.dumps(med_list, indent=2)}

    **REVIEW GUIDELINES (use clinical pharmacology knowledge):**

    1. **Drug-Drug Interactions:**
    - Identify clinically significant interactions between medications
    - Consider pharmacological class, mechanisms of action, and known interaction profiles
    - Only flag interactions that could cause patient harm

    2. **Contraindications:**
    - Check medications against active diagnoses and patient history
    - Identify absolute and relative contraindications
    - Consider age-appropriate prescribing

    3. **Appropriateness Score (0.0 to 1.0):**
    - 0.9-1.0: All medications appropriate, complete information
    - 0.7-0.8: Appropriate but missing some information
    - 0.5-0.6: Some concerns or incomplete information
    - 0.3-0.4: Significant concerns or missing critical information
    - 0.0-0.2: Dangerous combinations or clearly inappropriate

    4. **Flags:**
    - INFO: Missing information, non-critical observations
    - WARNING: Potential safety concern, needs clinical review
    - CRITICAL: Dangerous interaction or absolute contraindication

    Return ONLY this JSON structure:
    {{
    "drug_interactions": ["description of each interaction"],
    "contraindications": ["description of each contraindication"],
    "medication_appropriateness_score": 0.0,
    "flags": [
        {{"type": "info|warning|critical", "message": "specific message"}}
    ]
    }}

    If no issues found, return empty arrays and appropriate score.
    """

        try:
            result = self._call(
                system="You are a clinical pharmacologist. Evaluate medication safety using pharmacological principles. Return ONLY valid JSON.",
                user=review_prompt
            )
        except Exception as e:
            logger.error(f"Medication review LLM call failed: {e}")
            result = {
                "drug_interactions": [],
                "contraindications": [],
                "medication_appropriateness_score": 0.5,
                "flags": [{"type": "warning", "message": f"Review failed: {str(e)[:100]}"}]
            }  # ← Fixed: added closing brace
        
        return {
            "engine_name": self.name,
            "current_medications": med_list,
            "medication_changes": [],
            "drug_interactions": result.get("drug_interactions", []),
            "contraindications": result.get("contraindications", []),
            "medication_appropriateness_score": result.get("medication_appropriateness_score", 0.5),
            "flags": result.get("flags", [
                {"type": "info", "message": f"{len(med_list)} medications identified"}
            ]),
        }


# ── Admission Review Engine ────────────────────────────────────────────────

class AdmissionReviewEngine(BaseAgent):

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Admission Review Engine")

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        # ============================================================
        # STEP 1: Collect ALL document content
        # ============================================================
        
        admission_parts: List[str] = []
        
        for doc in docs:
            admission_parts.append(f"\n{'='*60}")
            admission_parts.append(f"DOCUMENT ID: {doc.document_id}")
            admission_parts.append(f"DOCUMENT TYPE: {doc.doc_type}")
            admission_parts.append(f"DOCUMENT DATE: {doc.document_date}")
            admission_parts.append(f"{'='*60}")
            
            for heading, content in doc.sections.items():
                if content and content.strip():
                    admission_parts.append(f"\n[{heading}]")
                    admission_parts.append(content.strip())
            
            if doc.raw_markdown:
                admission_parts.append(f"\n[RAW TEXT]")
                admission_parts.append(doc.raw_markdown[:3000])
        
        admission_text = "\n".join(admission_parts)
        
        if len(admission_text) > 12000:
            admission_text = admission_text[:12000]

        # ============================================================
        # STEP 2: LLM call - Let the LLM do ALL the extraction
        # ============================================================
        
        result = self._call(
            system=(
                "You are a hospital utilization review specialist. Your job is to analyze medical documents "
                "and extract admission and discharge information.\n\n"
                "IMPORTANT RULES:\n"
                "1. Read ALL documents carefully - admission/discharge info is often in discharge summaries, "
                "admission notes, or transfer summaries.\n"
                "2. Dates can appear in various formats: DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, DD Month YYYY, etc.\n"
                "3. Look for section headings like 'Date of Admission', 'Admission Date', 'DATE OF ADMISSION', "
                "'Discharge Date', 'DATE OF DISCHARGE', 'Discharge Summary', etc.\n"
                "4. The date is often on the same line OR the next line after the heading.\n"
                "5. If you see a discharge summary document, it will almost always contain both admission and discharge dates.\n"
                "6. Extract referring/referring doctor from fields like 'Referred By:', 'Refer Dr:', 'Referring Doctor:'\n"
                "7. Return ONLY valid JSON, no other text.\n"
                "8. If a date is not found, set it to null."
            ),
            user=f"""Analyze the medical documents below and extract admission and discharge information.

PATIENT PRIMARY COMPLAINT: {ctx.primary_complaint if ctx.primary_complaint else "Not specified"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOCUMENTS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{admission_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLINICAL TASK:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Analyze the documents and determine whether the patient had a true hospital admission (inpatient stay), and extract admission/discharge details.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
CLINICAL REASONING RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

You must use clinical reasoning, not just presence of dates.

A patient is considered **INPATIENT** ONLY if there is clear evidence of hospitalization, such as:
- Admission to hospital with stay (not just visit)
- Presence of a discharge summary
- Mention of ward, bed, or admission ID
- In-hospital treatment or surgery with post-operative stay
- Clinical course during hospitalization

A patient is **NOT inpatient** (mark as "unknown") if documents contain only:
- Lab reports (Reg.Date, Collection Date, Report Date, Dispatch Date)
- Imaging reports (X-ray, CT, MRI, Mammogram)
- Biopsy/pathology reports without hospital stay context
- Outpatient consultations or visits

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DATE EXTRACTION RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Extract admission_date ONLY if:
- It clearly represents the start of a hospital stay

Extract discharge_date ONLY if:
- It clearly represents the end of a hospital stay

DO NOT use:
- Lab registration dates
- Sample collection dates
- Report generation dates
- Dispatch or print dates

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DECISION LOGIC
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- If clear hospitalization evidence exists → admission_type = "inpatient"
- If no hospitalization evidence → admission_type = "unknown"
- Do NOT classify as inpatient just because multiple dates exist
- Do NOT ignore strong hospitalization evidence even if dates are slightly inconsistent

If there is a discharge summary or clear hospital stay:
→ You MUST classify as "inpatient"

If uncertain:
→ admission_type = "unknown" and dates = null

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY valid JSON:

{{
  "admission_type": "inpatient or unknown",
  "admission_date": "DD/MM/YYYY or null",
  "discharge_date": "DD/MM/YYYY or null",
  "referring_doctor": "doctor name or null",
  "admission_reason": "reason for admission",
  "admission_appropriateness_score": 0.85 if inpatient else 0.0,
  "length_of_stay_projection": "short" if inpatient else null,
  "admission_criteria_met": [],
  "admission_criteria_missing": [],
  "flags": []
}}

CRITICAL: 
- If a discharge summary document exists, it WILL contain both dates. Extract them carefully.
- The date format in the documents may be DD/MM/YYYY (day/month/year) - preserve the format as found.
- If a field cannot be found, set it to null or empty list as appropriate.
"""
        )

        if not isinstance(result, dict):
            result = {}
        
        # ============================================================
        # STEP 3: Validate and clean up the result
        # ============================================================
        
        # Ensure dates are properly formatted (remove time if present)
        for date_field in ["admission_date", "discharge_date"]:
            if result.get(date_field):
                date_str = str(result[date_field])
                # If it has time component, extract just the date part
                if ' ' in date_str:
                    result[date_field] = date_str.split(' ')[0]
        
        # Determine admission type based on what we actually found
        # has_admission = result.get("admission_date") is not None and str(result.get("admission_date")).strip()
        # has_discharge = result.get("discharge_date") is not None and str(result.get("discharge_date")).strip()
        
        # if has_admission and has_discharge:
        #     result["admission_type"] = "inpatient"
        #     result["admission_appropriateness_score"] = 0.85
        #     result["length_of_stay_projection"] = "short"
        #     result["admission_criteria_met"] = []
        #     if has_admission:
        #         result["admission_criteria_met"].append("admission_date")
        #     if has_discharge:
        #         result["admission_criteria_met"].append("discharge_date")
        #     if result.get("referring_doctor"):
        #         result["admission_criteria_met"].append("referring_doctor")
        #     result["admission_criteria_missing"] = []
        # else:
        #     result["admission_type"] = "unknown"
        #     result["admission_appropriateness_score"] = 0.0
        #     result["length_of_stay_projection"] = None
        #     result["admission_criteria_met"] = []
        #     result["admission_criteria_missing"] = []
        #     if not has_admission:
        #         result["admission_criteria_missing"].append("admission_date")
        #     if not has_discharge:
        #         result["admission_criteria_missing"].append("discharge_date")

        # Trust LLM classification
        admission_type = result.get("admission_type", "unknown")

        if admission_type == "inpatient":
            result["admission_appropriateness_score"] = 0.85
            result["length_of_stay_projection"] = "short"
        else:
            result["admission_appropriateness_score"] = 0.0
            result["length_of_stay_projection"] = None
        
        # Set admission reason if missing
        if not result.get("admission_reason") or result.get("admission_reason") == "":
            result["admission_reason"] = ctx.primary_complaint if ctx.primary_complaint else "Not specified"
        
        # Ensure all fields exist
        defaults = {
            "admission_type": "unknown",
            "admission_date": None,
            "discharge_date": None,
            "referring_doctor": None,
            "admission_reason": ctx.primary_complaint if ctx.primary_complaint else "",
            "admission_appropriateness_score": 0.0,
            "length_of_stay_projection": None,
            "admission_criteria_met": [],
            "admission_criteria_missing": ["admission_date", "discharge_date"],
            "flags": []
        }
        
        for key, default_value in defaults.items():
            if key not in result:
                result[key] = default_value
            elif result[key] is None and default_value is not None:
                result[key] = default_value
        
        result["engine_name"] = self.name
        
        return result

# ── Documentation Audit Engine ─────────────────────────────────────────────

class DocumentationAuditEngine(BaseAgent):
    """
    FIX 7 — Uses real heading names (doc.sections is now flat).
    FIX 12 — PURE UNIVERSAL matching - NO hardcoded concepts.
    """

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Documentation Audit Engine")

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        # Build document payloads with actual content for semantic analysis
        doc_payloads = []
        for doc in docs:
            sections_with_content = []
            for heading, content in doc.sections.items():
                if content and content.strip():
                    sections_with_content.append({
                        "heading": heading,
                        "content_preview": content[:300]  # Increased for better context
                    })
            
            doc_payloads.append({
                "document_id": doc.document_id,
                "document_type": doc.doc_type,
                "section_headings": list(doc.sections.keys()),
                "sections_with_content": sections_with_content,
                "total_sections": len(doc.sections),
            })

        # Log what we're sending
        logger.info(f"[DocumentationAuditEngine] Analyzing {len(docs)} documents")
        for payload in doc_payloads:
            logger.info(f"  Document: {payload['document_id']} | Type: {payload['document_type']} | Sections: {payload['section_headings']}")

        result = self._call(
            system=(
                "You are a senior clinical documentation auditor.\n"
                "You analyze medical documents and identify what clinical sections are present.\n"
                "Return valid JSON only. Do not include any text outside the JSON."
            ),
            user=f"""Analyze each document and identify what clinical information is present.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DOCUMENTS TO ANALYZE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{json.dumps(doc_payloads, indent=2, default=str)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

For EACH document:

1. Look at the document_type and section_headings
2. Based on the headings and content preview, determine what clinical information is present
3. For sections_present, list the types of clinical information found (use descriptive names like: "clinical_history", "findings", "impression", "technique", "diagnosis", "medications", etc.)
4. If the document has clinical content but you cannot categorize it, use "clinical_content"
5. anomalies should be empty unless there are actual quality issues

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON:

{{
  "document_analysis": [
    {{
      "document_id": "the exact document_id from above",
      "document_type": "the document_type",
      "sections_present": ["list", "of", "clinical", "information", "types", "found"],
      "sections_missing": [],
      "anomalies": []
    }}
  ]
}}

CRITICAL: 
- Include EVERY document_id from the input
- Use the EXACT document_id strings
- If a document has clinical sections, list them in sections_present
- Do NOT add anomalies unless there is a real problem
"""
        )

        if not isinstance(result, dict):
            logger.error(f"[DocumentationAuditEngine] LLM returned non-dict: {type(result)}")
            result = {}

        # Build analysis for ALL documents
        document_analysis = []
        
        # First, add any analysis from LLM
        llm_analysis = result.get("document_analysis", [])
        llm_analysis_by_id = {a.get("document_id"): a for a in llm_analysis if a.get("document_id")}
        
        # Then ensure every document is represented
        for doc in docs:
            if doc.document_id in llm_analysis_by_id:
                # Use LLM analysis
                analysis = llm_analysis_by_id[doc.document_id]
                # Ensure required fields
                analysis.setdefault("sections_present", [])
                analysis.setdefault("sections_missing", [])
                analysis.setdefault("anomalies", [])
                document_analysis.append(analysis)
                logger.info(f"[DocumentationAuditEngine] Document {doc.document_id} analyzed by LLM: present={analysis.get('sections_present')}")
            else:
                # LLM didn't analyze this document - create analysis based on actual content
                logger.warning(f"[DocumentationAuditEngine] Document {doc.document_id} not in LLM response. Creating fallback analysis.")
                
                # Determine sections present from actual headings
                sections_present = []
                headings_lower = [h.lower() for h in doc.sections.keys()]
                
                # Intelligent fallback based on actual headings (not hardcoded, but dynamic)
                for heading in headings_lower:
                    if 'history' in heading or 'clinical' in heading:
                        sections_present.append("clinical_history")
                    elif 'technique' in heading or 'method' in heading or 'protocol' in heading:
                        sections_present.append("technique")
                    elif 'finding' in heading or 'observation' in heading or 'result' in heading:
                        sections_present.append("findings")
                    elif 'impression' in heading or 'conclusion' in heading or 'summary' in heading or 'diagnosis' in heading:
                        sections_present.append("impression")
                    elif 'procedure' in heading or 'treatment' in heading:
                        sections_present.append("procedure")
                    elif 'medication' in heading or 'drug' in heading or 'prescription' in heading:
                        sections_present.append("medications")
                
                # Remove duplicates while preserving order
                sections_present = list(dict.fromkeys(sections_present))
                
                # If no sections identified but document has content, mark as clinical_content
                if not sections_present and doc.sections:
                    sections_present = ["clinical_content"]
                
                document_analysis.append({
                    "document_id": doc.document_id,
                    "document_type": doc.doc_type,
                    "sections_present": sections_present,
                    "sections_missing": [],
                    "anomalies": [],
                })
                
                logger.info(f"[DocumentationAuditEngine] Fallback analysis for {doc.document_id}: present={sections_present}")

        result = {
            "document_analysis": document_analysis,
            "documents_analyzed": len(docs),
            "engine_name": self.name,
        }
        
        return result

# ── Billing Audit Engine ───────────────────────────────────────────────────

class BillingAuditEngine(BaseAgent):

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Billing Audit Engine")

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx:  ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        entity_text = ""   # 🔥 removed
        section_text = self._sections_text(docs, max_chars=3000)

        result = self._call(
            system="You are a medical billing audit expert. Return JSON only.",
            user=f"""Identify all billable healthcare services from this patient's documents.

ACTIVE DIAGNOSES: {ctx.active_diagnoses}
DOC TYPES: {ctx.doc_types_present}


DOCUMENT SECTIONS:
{section_text[:2000]}

Billable services include: procedures, imaging (PET-CT, CT, MRI), laboratory panels,
consultations (internal medicine, dermatology, oncology), medications administered IV,
supportive therapies, bone marrow procedures, NGS testing.

Return ONLY this JSON:
{{
  "billable_items": [
    {{
      "item": "service name",
      "type": "procedure | imaging | laboratory | consultation | medication | therapy",
      "date": "YYYY-MM-DD or null",
      "evidence": "exact supporting text",
      "confidence": 0.9
    }}
  ],
  "unbilled_items": [{{"item": "name", "reason": "why it may not be billed"}}],
  "potential_denials": ["reason for possible claim denial"],
  "coding_accuracy_score": 0.0,
  "flags": [{{"type": "info | warning | error", "message": ""}}]
}}""",
        )

        if not isinstance(result, dict):
            result = {}

        items = result.get("billable_items", [])
        result["engine_name"] = self.name
        result["summary"] = {
            "total_billable_items": len(items),
            "items_by_type": defaultdict(int, {
                t: sum(1 for i in items if i.get("type") == t)
                for t in {i.get("type", "other") for i in items}
            }),
        }
        return result


# ── Fraud Screening Engine ─────────────────────────────────────────────────

class FraudScreeningEngine(BaseAgent):
    """
    UNIVERSAL FIX: Laterality-aware fraud detection for ALL patients and ALL cancer types.
    - Works for ANY paired organ (breasts, lungs, kidneys, ovaries, testicles, eyes, ears, limbs, lymph nodes)
    - Works for ANY unpaired organ (liver, pancreas, stomach) - laterality is N/A
    - Disease progression in SAME site is NORMAL, not fraud.
    """

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Fraud Screening Engine")

    def _extract_anatomical_context(self, docs: List[NormalisedDocument]) -> str:
        """
        Extract anatomical locations from documents.
        UNIVERSAL - detects ANY organ with left/right/bilateral indicators.
        """
        location_summary = []
        
        # Universal patterns for laterality detection (works for ANY organ)
        LATERALITY_PATTERNS = {
            'left': r'\b(left|lt\.?|Lt\.?|L[\s\-/])\b',
            'right': r'\b(right|rt\.?|Rt\.?|R[\s\-/])\b',
            'bilateral': r'\b(bilateral|both|bi\.?|double|paired)\b',
        }
        
        # Universal organ detection (can be ANY body part)
        # These patterns identify the anatomical structure regardless of organ type
        ORGAN_PATTERNS = r'\b(breast|lung|kidney|ovary|testis|testicle|adrenal|fallopian|ureter|lymph\s*node|lymphadenopathy|axilla|groin|neck|clavicle|rib|hip|shoulder|knee|elbow|wrist|ankle|eye|ear|tonsil|parotid|thyroid|parathyroid)\b'
        
        for doc in docs:
            doc_locations = []
            for heading, content in doc.sections.items():
                content_lower = content.lower()
                
                # Detect laterality using universal patterns
                has_left = bool(re.search(LATERALITY_PATTERNS['left'], content_lower, re.IGNORECASE))
                has_right = bool(re.search(LATERALITY_PATTERNS['right'], content_lower, re.IGNORECASE))
                has_bilateral = bool(re.search(LATERALITY_PATTERNS['bilateral'], content_lower, re.IGNORECASE))
                
                # Detect ANY organ using universal pattern
                organ_match = re.search(ORGAN_PATTERNS, content_lower, re.IGNORECASE)
                organ = organ_match.group(0) if organ_match else "anatomical_site"
                
                # Determine laterality
                if has_left and not has_right:
                    laterality = "LEFT"
                elif has_right and not has_left:
                    laterality = "RIGHT"
                elif has_bilateral or (has_left and has_right):
                    laterality = "BILATERAL"
                else:
                    laterality = "UNSPECIFIED"
                
                if laterality != "UNSPECIFIED":
                    doc_locations.append(f"{laterality} {organ}")
            
            if doc_locations:
                # Remove duplicates while preserving order
                unique_locations = []
                for loc in doc_locations:
                    if loc not in unique_locations:
                        unique_locations.append(loc)
                location_summary.append(
                    f"Document {doc.document_id[:8]}...: {', '.join(unique_locations)}"
                )
        
        return "\n".join(location_summary) if location_summary else "No specific laterality detected"

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        doc_meta = [
            {
                "document_id":    d.document_id,
                "doc_type":       d.doc_type,
                "date":           d.document_date,
                "section_count":  len(d.sections),
                "entity_count":   len(d.entities),
            }
            for d in docs
        ]

        anatomical_context = self._extract_anatomical_context(docs)
        timeline_by_location = self._extract_timeline_by_location_universal(docs)

        result = self._call(
            system=(
                "You are a senior healthcare fraud detection auditor. "
                "You MUST consider ANATOMICAL LOCATION (laterality) when evaluating conflicts. "
                "This applies to ALL organs and body parts - left vs right are INDEPENDENT sites. "
                "Flag only evidence-based concerns. Return JSON only."
            ),
            user=f"""Screen this patient's documents for fraud indicators.

⚠️ UNIVERSAL RULES - LATERALITY AWARENESS (Applies to ALL Patients, ALL Cancer Types) ⚠️

**RULE 1: Different Anatomical Sites are NEVER Conflicting**
- A finding in the LEFT organ and a different finding in the RIGHT organ 
  are COMPLETELY INDEPENDENT and NOT contradictory.
- This applies to EVERY paired organ/structure:
  • Breasts (left breast vs right breast)
  • Lungs (left lung vs right lung)  
  • Kidneys (left kidney vs right kidney)
  • Ovaries (left ovary vs right ovary)
  • Testicles (left testis vs right testis)
  • Eyes (left eye vs right eye)
  • Ears (left ear vs right ear)
  • Lymph nodes (left axilla vs right axilla, left neck vs right neck)
  • Limbs (left arm vs right arm, left leg vs right leg)
- Example: "Left breast fibroadenoma" + "Right breast carcinoma" → NORMAL, NOT fraud
- Example: "Left lung benign nodule" + "Right lung cancer" → NORMAL, NOT fraud
- Example: "Left kidney cyst" + "Right kidney tumor" → NORMAL, NOT fraud

**RULE 2: Disease Progression is NEVER Fraud**
- A change from benign to malignant over time in the SAME anatomical site 
  is NORMAL DISEASE PROGRESSION, not fraud.
- Example: Jan: "Left breast BIRADS 2 (benign)" → June: "Left breast invasive carcinoma"
  → This is EXPECTED disease progression, NOT a red flag
- Example: March: "Left lung granuloma (benign)" → Sept: "Left lung adenocarcinoma"
  → This is NORMAL cancer development, NOT fraud
- Cancer develops over time - earlier benign findings do NOT contradict later malignancy

**RULE 3: What IS a Real Red Flag (Very Rare)**
- Same anatomical site, SAME or VERY CLOSE date → directly contradictory findings
  (e.g., same breast on same day: "no malignancy" AND "invasive carcinoma")
- Impossible timeline (e.g., surgery date before diagnosis date, patient age < 1 with adult cancer)
- Patient identity mismatch across documents (different names, DOBs)
- Completely biologically implausible combinations
  (e.g., prostate cancer in a female patient, ovarian cancer post-hysterectomy with oophorectomy)

**RULE 4: Scoring Guidelines (Based on VALID red flags only)**
- 0.0–0.2: No concerns OR only findings on different anatomical sites
- 0.2–0.4: Minor inconsistencies (possible documentation errors, not fraud)
- 0.4–0.7: Clear inconsistencies requiring review (same site same date conflicts)
- 0.7–1.0: Strong fraud signals (identity mismatch, impossible timeline)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATIENT: {ctx.patient_id}
ACTIVE DIAGNOSES: {ctx.active_diagnoses[:5] if ctx.active_diagnoses else "None"}
PAST HISTORY: {ctx.past_history[:5] if ctx.past_history else "None"}
TOTAL DOCUMENTS: {len(docs)}

ANATOMICAL LOCATIONS DETECTED (with laterality):
{anatomical_context if anatomical_context else "None detected - no left/right specific findings"}

TIMELINE OF FINDINGS BY LOCATION:
{timeline_by_location}

DOCUMENTS AFTER DEDUPLICATION:
{json.dumps(doc_meta, indent=2)}

DOCUMENT CONTENT:
{self._sections_text(docs, max_chars=4000)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**SPECIFIC INSTRUCTIONS FOR ANALYSIS:**

1. **For EACH potential conflict, ask:**
   - Are these findings from the EXACT SAME anatomical location (same organ, same side)?
   - If YES (e.g., both from LEFT breast) → This MAY be a conflict worth investigating
   - If NO (different sides OR different organs) → NOT a conflict, IGNORE completely

2. **For benign → malignant over time:**
   - If you see benign findings in a location on an EARLIER date
   - And malignant findings in the SAME location on a LATER date
   - This is NORMAL DISEASE PROGRESSION - NEVER flag as fraud
   - This applies to ALL cancer types: breast, lung, kidney, ovarian, testicular, etc.

3. **For unpaired organs (liver, pancreas, stomach):**
   - Laterality does not apply - focus on temporal progression only
   - Same rules: progression over time is normal, not fraud

4. **ONLY flag as "inconsistent" when:**
   - Same exact location, same/similar date (within days), directly contradictory findings
   - OR clear patient identity mismatch across documents
   - OR chronologically impossible timeline


heck for:
1. Clinically inconsistent findings ACROSS different documents (e.g., conflicting diagnoses)
2. Implausible clinical combinations
3. Date anomalies or impossible timelines
4. Patient identity mismatches across documents

Scoring:
  0.0–0.2 : No concerns
  0.2–0.4 : Minor inconsistencies (possible documentation errors)
  0.4–0.7 : Clear inconsistencies requiring review
  0.7–1.0 : Strong fraud signals


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON:
{{
  "fraud_risk_score": 0.0,
  "risk_level": "LOW | MEDIUM | HIGH | CRITICAL",
  "summary": "Brief explanation of scoring rationale, explicitly noting that different anatomical sites do not create conflicts",
  "red_flags": [
    {{
      "severity": "LOW | MEDIUM | HIGH",
      "issue": "string",
      "details": "Must include anatomical location (left/right/organ)",
      "evidence": ["exact text from document"]
    }}
  ],
  "findings": {{
    "clinical_consistency": {{
      "status": "CONSISTENT | INCONSISTENT",
      "issues": [],
      "laterality_considered": true,
      "note": "Different left/right sites are considered CONSISTENT by design"
    }},
    "temporal_analysis": {{
      "status": "NORMAL | SUSPICIOUS",
      "details": ""
    }},
    "patient_consistency": {{
      "status": "CONSISTENT | INCONSISTENT",
      "issues": []
    }}
  }},
  "recommendations": [],
  "confidence": 0.0
}}""",
        )

        if not isinstance(result, dict):
            result = {}
        
        result = self._validate_laterality_logic_universal(result, docs)
        
        result["engine_name"] = self.name
        result["metadata"] = {
            "analysis_timestamp": self._ts(),
            "patient_id": ctx.patient_id,
            "documents_analyzed": ctx.total_documents,
            "note": "UNIVERSAL laterality-aware fraud detection - different anatomical sites (left vs right) do NOT conflict",
            "laterality_rules_applied": [
                "Different left/right findings are NEVER conflicting (applies to ALL paired organs)",
                "Benign → malignant progression in same site is NORMAL (applies to ALL cancer types)",
                "Same site, same date conflicts are the only valid clinical inconsistency flags"
            ]
        }
        return result
    
    def _validate_laterality_logic_universal(self, result: Dict, docs: List[NormalisedDocument]) -> Dict:
        """
        UNIVERSAL post-processing validation - catches LLM mistakes about laterality
        for ANY organ system. Works with regex patterns, not hardcoded organ names.
        """
        red_flags = result.get("red_flags", [])
        
        # Universal patterns for detecting false positives
        LEFT_PATTERN = r'\b(left|lt\.?|Lt\.?)\b'
        RIGHT_PATTERN = r'\b(right|rt\.?|Rt\.?)\b'
        BENIGN_PATTERN = r'\b(benign|b9|non[-\s]?malignant|non[-\s]?cancerous|birads\s*[12]|fibroadenoma|hamartoma|cyst|benign\s*lesion)\b'
        MALIGNANT_PATTERN = r'\b(malignant|cancer|carcinoma|sarcoma|neoplasm|tumor|birads\s*[45]|invasive|metastatic|adenocarcinoma)\b'
        
        valid_flags = []
        
        for flag in red_flags:
            issue = flag.get("issue", "").lower()
            details = flag.get("details", "").lower()
            evidence = " ".join(flag.get("evidence", [])).lower()
            combined = f"{issue} {details} {evidence}"
            
            # Check for left/right different sites false positive (UNIVERSAL - works for ANY organ)
            has_left = bool(re.search(LEFT_PATTERN, combined))
            has_right = bool(re.search(RIGHT_PATTERN, combined))
            is_left_right_confusion = has_left and has_right and any(
                word in combined for word in ['different', 'separate', 'other', 'contradict', 'conflict']
            )
            
            # Check for benign→malignant progression false positive (UNIVERSAL)
            has_benign = bool(re.search(BENIGN_PATTERN, combined))
            has_malignant = bool(re.search(MALIGNANT_PATTERN, combined))
            is_benign_to_malignant = has_benign and has_malignant and not (
                'same date' in combined or 'same day' in combined
            )
            
            # Skip these false positives
            if is_left_right_confusion:
                logger.info(f"Filtering false positive: left/right different sites - {flag.get('issue')}")
                continue
                
            if is_benign_to_malignant:
                logger.info(f"Filtering false positive: benign→malignant progression - {flag.get('issue')}")
                continue
            
            valid_flags.append(flag)
        
        # Recalculate score based on valid flags only
        if len(valid_flags) < len(red_flags):
            old_score = result.get("fraud_risk_score", 0)
            new_score = old_score * (len(valid_flags) / max(len(red_flags), 1))
            result["fraud_risk_score"] = round(min(new_score, 1.0), 2)
            result["red_flags"] = valid_flags
            
            # Update risk level
            score = result["fraud_risk_score"]
            if score <= 0.2:
                result["risk_level"] = "LOW"
            elif score <= 0.4:
                result["risk_level"] = "MEDIUM"
            elif score <= 0.7:
                result["risk_level"] = "HIGH"
            else:
                result["risk_level"] = "CRITICAL"
            
            if len(valid_flags) == 0:
                result["summary"] = f"After laterality validation: All flags were false positives (left/right different sites or benign→malignant progression). Final score: LOW risk."
            else:
                result["summary"] = f"After laterality validation: {len(valid_flags)} valid flags remain. {result.get('summary', '')}"
        
        return result

    def _extract_timeline_by_location_universal(self, docs: List[NormalisedDocument]) -> str:
        """
        UNIVERSAL timeline extraction - works for ANY organ/system.
        Groups findings by anatomical location without hardcoding organ names.
        """
        from collections import defaultdict
        
        # Universal patterns for location detection
        # These patterns capture ANY body part mentioned with laterality
        ANY_BODY_PART = r'\b(\w+(?:\s+\w+)*?)\s+(left|right|bilateral|both)\b|\b(left|right|bilateral|both)\s+(\w+(?:\s+\w+)*?)\b'
        
        findings_by_location = defaultdict(list)
        
        for doc in docs:
            for heading, content in doc.sections.items():
                content_text = f"{heading} {content}".lower()
                
                # Find all location mentions using universal pattern
                matches = re.finditer(ANY_BODY_PART, content_text, re.IGNORECASE)
                
                for match in matches:
                    # Extract the body part and laterality
                    if match.group(1):  # Pattern: "breast left"
                        body_part = match.group(1).strip()
                        laterality = match.group(2).lower()
                    else:  # Pattern: "left breast"
                        laterality = match.group(3).lower()
                        body_part = match.group(4).strip()
                    
                    # Clean up the body part
                    body_part = re.sub(r'[^\w\s]', '', body_part).strip()
                    if len(body_part) < 3 or len(body_part) > 30:
                        continue
                    
                    # Determine laterality symbol
                    if laterality in ['left', 'lt']:
                        laterality_symbol = "LEFT"
                    elif laterality in ['right', 'rt']:
                        laterality_symbol = "RIGHT"
                    else:
                        laterality_symbol = "BILATERAL"
                    
                    location_key = f"{laterality_symbol} {body_part.title()}"
                    
                    # Extract relevant snippet (50 chars before/after)
                    snippet_start = max(0, match.start() - 50)
                    snippet_end = min(len(content_text), match.end() + 100)
                    snippet = content_text[snippet_start:snippet_end].strip()
                    
                    findings_by_location[location_key].append({
                        "date": doc.document_date or "unknown date",
                        "snippet": snippet[:150],
                        "doc_type": doc.doc_type
                    })
        
        # Build summary (limit to 10 locations to avoid token overflow)
        summary_lines = ["\nFINDINGS BY ANATOMICAL LOCATION (for laterality analysis):"]
        summary_lines.append("NOTE: Different LEFT vs RIGHT locations are INDEPENDENT and do NOT conflict.\n")
        
        for location, findings in list(findings_by_location.items())[:10]:
            summary_lines.append(f"\n  📍 {location}:")
            for f in findings[:2]:  # Limit to 2 per location
                summary_lines.append(f"    • {f['date']}: {f['snippet'][:80]}...")
        
        if not findings_by_location:
            summary_lines.append("\n  No specific anatomical locations detected with laterality.")
        
        return "\n".join(summary_lines)

# ── Discharge & Outcome Engine ─────────────────────────────────────────────

class DischargeOutcomeEngine(BaseAgent):
    """
    UNIVERSAL discharge detection - fully LLM driven (no rules, no regex, no keywords)
    """

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Discharge & Outcome Engine")

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        # Prepare full document context (NO filtering)
        compiled_docs = []

        for doc in docs:
            content_block = []

            # structured sections
            if isinstance(doc.sections, dict):
                for sec in doc.sections.get("sections", []):
                    heading = sec.get("heading", "")
                    content = sec.get("content", "")
                    content_block.append(f"[{heading}]\n{content}")

            # raw markdown (important for OCR cases)
            if doc.raw_markdown:
                content_block.append(doc.raw_markdown[:3000])  # limit size safely

            compiled_docs.append("\n".join(content_block))

        full_context = "\n\n--- DOCUMENT ---\n\n".join(compiled_docs)

        result = self._call(
            system=(
                "You are an expert clinical AI.\n"
                "Your task is to determine discharge status and outcomes STRICTLY from documentation.\n\n"

                "CRITICAL PRINCIPLES:\n"
                "- Only use explicitly documented evidence\n"
                "- Do NOT assume or infer discharge\n"
                "- Do NOT rely on missing data\n"
                "- Handle OCR noise, partial text, and mixed formats robustly\n"
                "- Consider all possible ways discharge may be documented (structured, narrative, dates, summaries, instructions, etc.)\n"
                "- If multiple admissions exist, consider the latest discharge context\n"
                "- If conflicting information exists, prioritize explicit discharge statements\n"
                "- If no clear discharge evidence → mark as not_discharged\n\n"

                "Return ONLY valid JSON."
            ),
            user=f"""
Analyze the following clinical documents and determine discharge status.

DOCUMENTS:
{full_context}

CLINICAL CONTEXT:
Active Diagnoses: {ctx.active_diagnoses}
Pending Reports: {ctx.pending_reports}

TASK:

1. Determine if the patient has been discharged
2. Extract discharge date if available
3. Extract discharge summary (brief clinical course)
4. Extract follow-up plans ONLY if explicitly mentioned
5. Extract condition at discharge and outcome status
6. Extract key findings relevant to discharge
7. Extract recommendations given at discharge
8. Add flags if:
   - conflicting discharge info
   - unclear status
   - multiple admissions

OUTPUT RULES:

- If NO clear discharge evidence:
  discharge_status = "not_discharged"
  ALL other fields must be null or empty

- If discharge is present:
  populate all fields strictly from evidence

Return ONLY this JSON:

{{
  "discharge_status": "discharged | not_discharged | uncertain",
  "discharge_date": "",
  "discharge_summary": "",
  "follow_up_planned": [],
  "outcomes_assessed": {{
    "primary_diagnosis_status": "",
    "condition_at_discharge": "",
    "key_findings": []
  }},
  "recommendations": [],
  "flags": []
}}
"""
        )

        # Safe fallback (NO silent empty output)
        if not isinstance(result, dict) or not result:
            result = {
                "discharge_status": "uncertain",
                "discharge_date": None,
                "discharge_summary": None,
                "follow_up_planned": [],
                "outcomes_assessed": {
                    "primary_diagnosis_status": "",
                    "condition_at_discharge": "",
                    "key_findings": []
                },
                "recommendations": [],
                "flags": ["llm_output_invalid"]
            }

        result["engine_name"] = self.name
        return result
# ── Specialty Engine ───────────────────────────────────────────────────────

class SpecialtyEngine(BaseAgent):
    """
    UNIVERSAL specialty detection - NO hardcoded disease→specialty maps.
    Derives from organ system and disease type dynamically.
    """
    def __init__(self, model: ChatGroq):
        super().__init__(model, "Specialty Engine")  # ← ADD THIS LINE

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        # Extract referring doctors (from database, not hardcoded)
        referring_doctors: List[Dict] = []
        for doc in docs:
            for heading, content in doc.sections.items():
                if any(k in heading.lower() for k in ["consultant", "referral", "doctor", "dr."]):
                    doc_id_match = re.search(r"DOC-[a-f0-9\-]+", content or "")
                    if doc_id_match:
                        doc_id = doc_id_match.group()
                        try:
                            db_doc = await doctor_user_collection.find_one(
                                {"sys_user_id": doc_id},
                                {"_id": 0, "name": 1, "specialization": 1},
                            )
                            if db_doc:
                                referring_doctors.append({
                                    "name": db_doc.get("name"),
                                    "specialty": db_doc.get("specialization"),
                                    "doctor_id": doc_id,
                                })
                        except Exception:
                            pass
        
        result = self._call(
            system=(
                "You determine appropriate medical specialties based on active diagnoses.\n"
                "Use medical knowledge to map conditions to specialties.\n"
                "Do NOT use hardcoded lists - reason from first principles.\n"
                "Return valid JSON only."
            ),
            user=f"""Determine medical specialties for this patient.

ACTIVE DIAGNOSES:
{json.dumps(ctx.active_diagnoses, indent=2)}

PRIMARY COMPLAINT:
{ctx.primary_complaint}

REFERRING DOCTORS (from database):
{json.dumps(referring_doctors, indent=2)}

REASONING STEPS:
1. For each active diagnosis, identify the primary organ system
2. Determine the appropriate specialty based on:
   - Organ system (e.g., blood → Hematology, nerves → Neurology)
   - Disease type (e.g., cancer → Oncology, infection → Infectious Disease)
   - Treatment required (e.g., surgery → Surgical specialty)

3. Primary specialty = most urgent/relevant active diagnosis
4. Secondary specialties = other relevant organ systems

Return ONLY this JSON:
{{
  "primary_specialty": "",
  "secondary_specialties": [],
  "consults_requested": [],
  "specialty_recommendations": [],
  "clinical_rationale": "",
  "flags": []
}}

Example reasoning (not hardcoded - just illustration):
- Diagnosis: "Multifocal Hepatocellular Carcinoma" → Liver + Cancer → Hepatology or Medical Oncology
- Diagnosis: "Myelodysplastic Syndrome" → Blood disorder → Hematology
- Diagnosis: "Type II Diabetes Mellitus" → Endocrine → Endocrinology
"""
        )
        
        if not isinstance(result, dict):
            result = {}
        
        # Fallback to LLM's decision or empty
        result.setdefault("primary_specialty", "")
        result.setdefault("secondary_specialties", [])
        result["engine_name"] = self.name
        return result

# ── Coding & Compliance Engine ─────────────────────────────────────────────

class CodingComplianceEngine(BaseAgent):
    """
    UNIVERSAL coding - NO CPT HALLUCINATION.
    CPT codes ONLY from explicit procedure documentation.
    """

    def __init__(self, model: ChatGroq):
        # FIX: Pass the model AND the name to BaseAgent
        super().__init__(model, "Coding & Compliance Engine")

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        # ============================================================
        # STEP 1: Extract EXPLICIT procedures from documents only
        # ============================================================
        
        explicit_procedures: List[Dict[str, str]] = []
        
        for doc in docs:
            # Check all sections for procedure-related headings
            for heading, content in doc.sections.items():
                heading_lower = heading.lower()
                
                # Look for procedure-indicating headings
                if any(k in heading_lower for k in [
                    "procedure", "investigation", "study", "scan", 
                    "imaging", "laboratory", "test", "biopsy", "surgery"
                ]):
                    if content and len(content.strip()) > 10:
                        explicit_procedures.append({
                            "heading": heading,
                            "content": content[:500],
                            "doc_type": doc.doc_type,
                            "date": doc.document_date or "unknown"
                        })
            
            # Also scan raw_markdown for procedure mentions
            if doc.raw_markdown:
                lines = doc.raw_markdown.split('\n')
                for i, line in enumerate(lines):
                    line_lower = line.lower()
                    if any(k in line_lower for k in [
                        "ct scan", "mri", "x-ray", "ultrasound", "pet-ct",
                        "biopsy", "endoscopy", "colonoscopy", "blood test",
                        "complete blood count", "cbc", "metabolic panel"
                    ]):
                        # Get context (line + 2 lines before/after)
                        start = max(0, i-2)
                        end = min(len(lines), i+3)
                        context = "\n".join(lines[start:end])
                        explicit_procedures.append({
                            "heading": "RAW_TEXT",
                            "content": context[:300],
                            "doc_type": doc.doc_type,
                            "date": doc.document_date or "unknown"
                        })
        
        # Deduplicate procedures
        seen_procedures = set()
        unique_procedures = []
        for proc in explicit_procedures:
            proc_key = proc["content"][:100].lower()
            if proc_key not in seen_procedures:
                seen_procedures.add(proc_key)
                unique_procedures.append(proc)
        
        procedures_text = ""
        if unique_procedures:
            procedures_text = "\n\n".join([
                f"[{p['heading']}] ({p['doc_type']}, {p['date']})\n{p['content']}"
                for p in unique_procedures[:10]
            ])
        else:
            procedures_text = "NO EXPLICIT PROCEDURES DOCUMENTED"
        
        # ============================================================
        # STEP 2: Extract explicit diagnoses for ICD codes
        # ============================================================
        
        diagnoses_text = ""
        if ctx.active_diagnoses:
            diagnoses_text = "\n".join(ctx.active_diagnoses)
        else:
            diagnoses_text = "NO ACTIVE DIAGNOSES DOCUMENTED"
        
        # ============================================================
        # STEP 3: LLM call with strict no-hallucination rules
        # ============================================================
        
        result = self._call(
            system=(
                "You are a medical coding expert for ICD-10-CM and CPT.\n"
                "You MUST follow these rules STRICTLY:\n\n"
                "1. NEVER assign a CPT code unless the procedure is EXPLICITLY documented\n"
                "2. NEVER infer procedures from diagnoses or context\n"
                "3. If no procedures are documented, return an empty array for cpt_codes\n"
                "4. ICD codes only from explicitly stated active diagnoses\n"
                "5. Return valid JSON only - no explanatory text"
            ),
            user=f"""Assign ICD-10-CM and CPT codes based ONLY on explicit documentation.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXPLICITLY DOCUMENTED DIAGNOSES (from active diagnoses)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{diagnoses_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EXPLICITLY DOCUMENTED PROCEDURES (from document sections)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{procedures_text}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
STRICT CODING RULES (NO EXCEPTIONS)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

RULE 1: CPT CODES - PROCEDURES ONLY
- ONLY assign CPT codes for procedures explicitly listed in the "EXPLICITLY DOCUMENTED PROCEDURES" section above
- If a procedure is NOT in that list, do NOT assign a CPT code for it
- If the procedures section says "NO EXPLICIT PROCEDURES DOCUMENTED", return an empty array
- Do NOT infer procedures from diagnoses (e.g., don't assign biopsy code just because cancer is diagnosed)
- Do NOT assume "typical" or "standard" procedures were performed

RULE 2: ICD CODES - DIAGNOSES ONLY
- ONLY assign ICD codes for diagnoses explicitly listed in active diagnoses
- Each ICD code must have supporting evidence from the diagnosis text
- Do NOT add codes for conditions not explicitly diagnosed

RULE 3: CONFIDENCE SCORING
- confidence = 1.0: Code is exact match to documented term
- confidence = 0.8: Code is clear match with minor variation in wording
- confidence = 0.5: Code is best match but documentation is vague
- confidence = 0.0: No code assigned

RULE 4: EMPTY ARRAYS ARE ACCEPTABLE
- If no procedures documented: cpt_codes = []
- If no active diagnoses: icd_codes = []
- This is PREFERABLE to inventing codes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT FORMAT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Return ONLY this JSON:

{{
  "icd_codes": [
    {{
      "diagnosis": "exact diagnosis from document",
      "icd_code": "ICD-10-CM code",
      "type": "PRIMARY",
      "evidence": ["supporting text from diagnosis"],
      "confidence": 1.0,
      "is_primary": true
    }}
  ],
  "cpt_codes": [
    {{
      "procedure": "exact procedure name from document",
      "cpt_code": "CPT code",
      "category": "imaging|laboratory|surgery|consultation",
      "evidence": ["exact text where procedure was documented"],
      "confidence": 1.0
    }}
  ],
  "coding_compliance_score": 1.0,
  "issues": [],
  "recommendations": [],
  "summary": "X ICD codes, Y CPT codes assigned",
  "confidence": 1.0
}}

IMPORTANT: 
- If no procedures documented: "cpt_codes": []
- If no diagnoses documented: "icd_codes": []
- Never invent codes - empty arrays are acceptable
"""
        )
        
        if not isinstance(result, dict):
            result = {}
        
        # ============================================================
        # STEP 4: Validate and clean CPT codes
        # ============================================================
        
        # Remove any CPT codes without evidence
        if result.get("cpt_codes"):
            valid_cpts = []
            for cpt in result["cpt_codes"]:
                evidence = cpt.get("evidence", [])
                # Only keep CPT codes that have at least one evidence string
                if evidence and any(len(e.strip()) > 10 for e in evidence):
                    valid_cpts.append(cpt)
                else:
                    logger.warning(f"Removing CPT code without evidence: {cpt.get('procedure', 'unknown')}")
            result["cpt_codes"] = valid_cpts
        
        # Ensure empty array if no valid CPT codes
        if not result.get("cpt_codes"):
            result["cpt_codes"] = []
        
        # Validate ICD codes have evidence
        if result.get("icd_codes"):
            valid_icds = []
            for icd in result["icd_codes"]:
                evidence = icd.get("evidence", [])
                if evidence and any(len(e.strip()) > 5 for e in evidence):
                    valid_icds.append(icd)
            result["icd_codes"] = valid_icds
        
        # ============================================================
        # STEP 5: Calculate compliance score
        # ============================================================
        
        # Score based on whether codes match documented items
        has_documented_procedures = len(unique_procedures) > 0
        has_cpt_codes = len(result.get("cpt_codes", [])) > 0
        has_documented_diagnoses = len(ctx.active_diagnoses) > 0
        has_icd_codes = len(result.get("icd_codes", [])) > 0
        
        compliance_score = 1.0
        
        # Penalize missing codes when documentation exists
        if has_documented_procedures and not has_cpt_codes:
            compliance_score -= 0.3
            result.setdefault("issues", []).append("Procedures documented but no CPT codes assigned")
        
        if has_documented_diagnoses and not has_icd_codes:
            compliance_score -= 0.3
            result.setdefault("issues", []).append("Diagnoses documented but no ICD codes assigned")
        
        # Penalize hallucinated codes (codes without documentation)
        if has_cpt_codes and not has_documented_procedures:
            compliance_score -= 0.5
            result.setdefault("issues", []).append("CPT codes assigned but no procedures documented - possible hallucination")
        
        result["coding_compliance_score"] = max(0.0, compliance_score)
        
        # ============================================================
        # STEP 6: Set summary
        # ============================================================
        
        icd_count = len(result.get("icd_codes", []))
        cpt_count = len(result.get("cpt_codes", []))
        
        if icd_count == 0 and cpt_count == 0:
            result["summary"] = "No codes assigned. No explicit procedures or diagnoses documented."
        elif icd_count == 0:
            result["summary"] = f"{cpt_count} CPT codes assigned. No ICD codes (no active diagnoses documented)."
        elif cpt_count == 0:
            result["summary"] = f"{icd_count} ICD codes assigned. No CPT codes (no procedures documented)."
        else:
            result["summary"] = f"{icd_count} ICD codes, {cpt_count} CPT codes assigned based on explicit documentation."
        
        result["engine_name"] = self.name
        result["metadata"] = {
            "analysis_timestamp": self._ts(),
            "patient_id": ctx.patient_id,
            "procedures_found": len(unique_procedures),
            "diagnoses_found": len(ctx.active_diagnoses)
        }
        
        return result

# ── Treatment & Procedure Engine ───────────────────────────────────────────

class TreatmentProcedureEngine(BaseAgent):

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Treatment & Procedure Engine")

    def _build_section_text(self, docs, max_chars=30000):
        narrative_parts = []
        
        for idx, doc in enumerate(docs):
            sections_data = getattr(doc, 'sections', None)
            if not sections_data:
                raw = getattr(doc, 'raw_markdown', '') or ''
                if raw.strip():
                    narrative_parts.append(raw)
                continue
            
            if hasattr(sections_data, 'dict'):
                sections_data = sections_data.dict()
            elif hasattr(sections_data, '__dict__') and not isinstance(sections_data, dict):
                sections_data = vars(sections_data)
            
            if isinstance(sections_data, dict):
                section_list = sections_data.get("sections", [])
                
                for sec in section_list:
                    if not isinstance(sec, dict):
                        continue
                    heading = sec.get("heading", "").strip()
                    content = sec.get("content", "").strip()
                    if not content:
                        continue
                    if heading:
                        narrative_parts.append(f"=== {heading.upper()} ===\n{content}")
                    else:
                        narrative_parts.append(content)
                
                if not section_list:
                    table_list = sections_data.get("tables", [])
                    for table in table_list:
                        if not isinstance(table, dict):
                            continue
                        headers = table.get("headers", [])
                        rows = table.get("rows", [])
                        lines = []
                        if headers:
                            lines.append(" | ".join(str(h) for h in headers if h))
                        for row in rows:
                            if isinstance(row, dict):
                                lines.append(" | ".join(str(v) for v in row.values() if v))
                            elif isinstance(row, list):
                                lines.append(" | ".join(str(v) for v in row if v))
                        if lines:
                            narrative_parts.append("\n".join(lines))
            
            elif isinstance(sections_data, list):
                for sec in sections_data:
                    if not isinstance(sec, dict):
                        continue
                    heading = sec.get("heading", "").strip()
                    content = sec.get("content", "").strip()
                    if content:
                        if heading:
                            narrative_parts.append(f"=== {heading.upper()} ===\n{content}")
                        else:
                            narrative_parts.append(content)
        
        full_text = "\n\n---\n\n".join(narrative_parts)
        
        if len(full_text) > max_chars:
            logger.info(f"Truncating text from {len(full_text)} to {max_chars} chars")
            full_text = full_text[:max_chars]
        
        logger.info(f"Total text length: {len(full_text)} chars, parts: {len(narrative_parts)}")
        
        if not full_text.strip():
            logger.warning("No text extracted — falling back to raw_markdown")
            for doc in docs:
                raw = getattr(doc, 'raw_markdown', '') or ''
                if raw.strip():
                    full_text += raw[:max_chars // len(docs)]
        
        return full_text

    def _normalize_to_strings(self, items):
        result = []
        for item in items:
            if isinstance(item, dict):
                result.append(str(item))
            elif isinstance(item, list):
                result.append(str(item))
            else:
                result.append(str(item))
        return result

    def _filter_procedures(self, procedures: List[str]) -> List[str]:
        """
        Use a second LLM call to semantically validate extracted procedures.
        Removes anything that is not a genuine medical/surgical intervention.
        """
        if not procedures:
            return []

        result = self._call(
            system="You are a clinical reviewer. Return JSON only.",
            user=f"""You are given a list of items extracted from a clinical document as potential procedures.

    Your task is to review each item and keep ONLY those that are genuine medical or surgical interventions performed on the patient.

    An item should be KEPT if it represents something that was physically done to the patient as an intervention — such as a surgery, implantation, or operative procedure.

    An item should be REMOVED if it is:
    - A clinical assessment or examination
    - A laboratory or diagnostic investigation
    - A medication, drug, fluid, or injection
    - A disease, condition, or diagnosis
    - A symptom or finding
    - Anything that is not an intervention physically performed on the patient

    Items to review:
    {procedures}

    Return ONLY valid JSON with the filtered list:
    {{
    "procedures_performed": []
    }}
    """,
        )

        if not isinstance(result, dict):
            return procedures

        return result.get("procedures_performed", procedures)


    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        section_text = self._build_section_text(docs, max_chars=30000)

        result = self._call(
            system="You are a clinical procedure and treatment reviewer. Extract ONLY from the document text provided. Return JSON only.",
            user=f"""You are given sections from a clinical document. Extract procedures and treatments for this patient.

    ACTIVE DIAGNOSES (for context only):
    {ctx.active_diagnoses if ctx.active_diagnoses else 'None'}

    DOCUMENT SECTIONS:
    {section_text}

    PROCEDURES_PERFORMED:
    - A procedure is a structured medical or surgical intervention documented as having been performed on this patient
    - Extract ONLY procedures explicitly stated as performed on this patient in the document text
    - Do NOT include physical examination, review of systems, or general examination
    - Do NOT include medication administration, drug infusions, IV fluids, or injections
    - Do NOT include diseases, conditions, diagnoses, or medical histories
    - Do NOT include laboratory tests, blood tests, urine tests, or imaging studies
    - Do NOT include anything not explicitly documented as a procedure performed on this patient
    - Return each as a STRING

    TREATMENTS_PLANNED:
    - Extract ONLY the high-level therapeutic approach or treatment strategy as documented by the clinical team
    - This is the broad plan of care describing what the team decided to do for the patient
    - Individual drug names, doses, routes, frequencies, and fluid orders are NOT treatments
    - Drug order tables and medication lists are NOT sources for this field
    - Extract from narrative clinical text where the treating team describes the overall plan for this admission
    - Return each as a concise STRING

    COMPLICATIONS:
    - Extract only adverse events or unintended problems that arose as a result of a procedure or treatment during this admission
    - Active diagnoses, presenting complaints, and pre-existing conditions are NOT complications
    - Return each as a STRING

    CONSTRAINTS:
    - Extract ONLY what is explicitly written in the document sections above
    - Do not infer, assume, or add anything not present in the text
    - Return empty list if nothing found for a field

    Return ONLY valid JSON:
    {{
    "procedures_performed": [],
    "treatments_planned": [],
    "complications": []
    }}
    """,
        )

        if not isinstance(result, dict):
            result = {}

        procedures = result.get("procedures_performed", [])
        treatments = result.get("treatments_planned", [])
        complications = result.get("complications", [])

        def normalize_and_deduplicate(items):
            if not items:
                return []
            string_items = []
            for item in items:
                if isinstance(item, dict):
                    if "name" in item:
                        string_items.append(str(item["name"]))
                    elif "value" in item:
                        string_items.append(str(item["value"]))
                    else:
                        string_items.append(str(item))
                elif isinstance(item, list):
                    string_items.append(" ".join(str(x) for x in item))
                else:
                    string_items.append(str(item))
            seen = set()
            unique_items = []
            for item in string_items:
                if item not in seen:
                    seen.add(item)
                    unique_items.append(item)
            return unique_items

        procedures = normalize_and_deduplicate(procedures)
        treatments = normalize_and_deduplicate(treatments)
        complications = normalize_and_deduplicate(complications)

        # Second LLM call to semantically validate procedures
        procedures = self._filter_procedures(procedures)

        score = 0.0
        if procedures:
            score += 0.4
        if treatments:
            score += 0.3
        if hasattr(ctx, 'total_documents') and ctx.total_documents > 2:
            score += 0.2
        if procedures and treatments:
            score += 0.1

        result["engine_name"] = self.name
        result["treatment_appropriateness_score"] = round(min(score, 1.0), 2)
        result["treatment_adherence"] = {
            "procedures_documented": len(procedures),
            "treatments_planned": len(treatments),
        }
        result["flags"] = [{
            "type": "info",
            "message": f"{len(procedures)} procedure(s), {len(treatments)} treatment plan(s) identified",
        }]
        result["procedures_performed"] = procedures
        result["treatments_planned"] = treatments
        result["complications"] = complications

        return result
# ── Clinical Justification Engine ─────────────────────────────────────────

class ClinicalJustificationEngine(BaseAgent):

    def __init__(self, model: ChatGroq):
        super().__init__(model, "Clinical Justification Engine")

    def _build_section_text(self, docs, max_chars=30000):
        narrative_parts = []
        
        for idx, doc in enumerate(docs):
            sections_data = getattr(doc, 'sections', None)
            if not sections_data:
                raw = getattr(doc, 'raw_markdown', '') or ''
                if raw.strip():
                    narrative_parts.append(raw)
                continue
            
            if hasattr(sections_data, 'dict'):
                sections_data = sections_data.dict()
            elif hasattr(sections_data, '__dict__') and not isinstance(sections_data, dict):
                sections_data = vars(sections_data)
            
            if isinstance(sections_data, dict):
                section_list = sections_data.get("sections", [])
                
                for sec in section_list:
                    if not isinstance(sec, dict):
                        continue
                    heading = sec.get("heading", "").strip()
                    content = sec.get("content", "").strip()
                    if not content:
                        continue
                    if heading:
                        narrative_parts.append(f"=== {heading.upper()} ===\n{content}")
                    else:
                        narrative_parts.append(content)
                
                if not section_list:
                    table_list = sections_data.get("tables", [])
                    for table in table_list:
                        if not isinstance(table, dict):
                            continue
                        headers = table.get("headers", [])
                        rows = table.get("rows", [])
                        lines = []
                        if headers:
                            lines.append(" | ".join(str(h) for h in headers if h))
                        for row in rows:
                            if isinstance(row, dict):
                                lines.append(" | ".join(str(v) for v in row.values() if v))
                            elif isinstance(row, list):
                                lines.append(" | ".join(str(v) for v in row if v))
                        if lines:
                            narrative_parts.append("\n".join(lines))
            
            elif isinstance(sections_data, list):
                for sec in sections_data:
                    if not isinstance(sec, dict):
                        continue
                    heading = sec.get("heading", "").strip()
                    content = sec.get("content", "").strip()
                    if content:
                        if heading:
                            narrative_parts.append(f"=== {heading.upper()} ===\n{content}")
                        else:
                            narrative_parts.append(content)
        
        full_text = "\n\n---\n\n".join(narrative_parts)
        
        if len(full_text) > max_chars:
            logger.info(f"Truncating text from {len(full_text)} to {max_chars} chars")
            full_text = full_text[:max_chars]
        
        if not full_text.strip():
            logger.warning("No text extracted — falling back to raw_markdown")
            for doc in docs:
                raw = getattr(doc, 'raw_markdown', '') or ''
                if raw.strip():
                    full_text += raw[:max_chars // len(docs)]
        
        return full_text

    async def process(
        self,
        docs: List[NormalisedDocument],
        ctx: ClinicalContext,
        demo: Optional[PatientDemographics] = None,
    ) -> Dict[str, Any]:

        section_text = self._build_section_text(docs, max_chars=30000)

        result = self._call(
            system=(
                "You provide evidence-based clinical justification for insurance review. "
                "You MUST base all justifications on explicit document evidence. "
                "Return valid JSON only."
            ),
            user=f"""Provide evidence-based clinical justification for this patient's care.

ACTIVE DIAGNOSES (for context only):
{json.dumps(ctx.active_diagnoses, indent=2) if ctx.active_diagnoses else "None documented"}

PRIMARY COMPLAINT:
{ctx.primary_complaint}

DOCUMENT SECTIONS:
{section_text}

EXTRACTION AND JUSTIFICATION RULES:

PRIMARY DIAGNOSIS:
- Identify the primary diagnosis from the document sections
- Return as a STRING

DIAGNOSIS JUSTIFICATION:
- Justify the primary diagnosis based on clinical findings, investigations, and evidence explicitly documented
- Base justification only on what is written in the document sections above
- Return each justification point as a STRING in a list
Do NOT convert qualitative findings into numeric values.
Example:
- "tachycardia" ≠ "HR 120 bpm"
DO NOT convert qualitative terms into numeric vitals.

Examples:
- "tachycardia" ≠ "heart rate 120 bpm"
- "hypertension" ≠ "BP 140/90"

If numeric value is not explicitly present → DO NOT create one

TREATMENT JUSTIFICATION:
- Read the document sections and identify the high-level treatment approach documented by the clinical team
- This is the broad plan of care — not individual drug names, doses, or medication orders
- Justify why the documented treatment approach was medically necessary for this patient
- Base justification only on what is explicitly written in the document sections
- Do NOT mention inpatient or outpatient care setting
- Do NOT list individual medications or drug orders
- Return each justification point as a STRING in a list

PROCEDURE JUSTIFICATION:
- Read the entire document carefully including past medical history, surgical history, and clinical notes
- Identify any surgical, operative, or structured clinical intervention that was physically performed on this patient
- This includes both interventions done during this admission and historical interventions documented in the record
- Clinical assessments, examinations, laboratory tests, imaging, and medication administration are NOT procedures
- For each procedure found, write a justification explaining its clinical relevance to this patient's current condition
- Each justification point must be grounded in something written in the document sections above
- If no procedures are documented anywhere in the record, return empty list
- Return each point as a STRING in a list

MEDICAL NECESSITY SCORE:
- Score the overall medical necessity of the care provided based on the evidence in the documents
- Return as a float between 0.0 and 1.0

SUPPORTING EVIDENCE:
- List key clinical findings, investigation results, or documented facts that support the justification
- Extract directly from the document sections
- Return each as a STRING in a list

FLAGS:
- Note any gaps, inconsistencies, or concerns found in the documentation
- Return each as a STRING in a list

CONSTRAINTS:
- Extract and justify ONLY what is explicitly written in the document sections above
- Do not infer, assume, or add anything not present in the text
- Return empty list if nothing found for a field

Return ONLY valid JSON:
{{
  "primary_diagnosis": "",
  "diagnosis_justification": [],
  "treatment_justification": [],
  "procedure_justification": [],
  "medical_necessity_score": 0.0,
  "supporting_evidence": [],
  "flags": []
}}
""",
        )

        if not isinstance(result, dict):
            result = {}

        result["engine_name"] = self.name
        return result

# ============================================================
# STAGE 2 ORCHESTRATOR
# ============================================================

class EngineOrchestrator:
    """Runs all 12 specialist engines concurrently via asyncio.gather."""

    def __init__(self) -> None:
        self.engines: Dict[str, BaseAgent] = {
            "Patient & Policy Engine":        PatientPolicyEngine(llm),
            "Clinical Justification Engine":  ClinicalJustificationEngine(llm),
            "Admission Review Engine":        AdmissionReviewEngine(llm),
            "Investigation Audit Engine":     InvestigationAuditEngine(llm),
            "Treatment & Procedure Engine":   TreatmentProcedureEngine(llm),
            "Medication Review Engine":       MedicationReviewEngine(llm),
            "Documentation Audit Engine":     DocumentationAuditEngine(llm),
            "Billing Audit Engine":           BillingAuditEngine(llm),
            "Fraud Screening Engine":         FraudScreeningEngine(llm),
            "Discharge & Outcome Engine":     DischargeOutcomeEngine(llm),
            "Specialty Engine":               SpecialtyEngine(llm),
            "Coding & Compliance Engine":     CodingComplianceEngine(llm),
        }

    async def run_all(
        self,
        docs: List[NormalisedDocument],
        ctx:  ClinicalContext,
        demo: Optional[PatientDemographics],
    ) -> Dict[str, Any]:
        tasks   = [e.process(docs, ctx, demo) for e in self.engines.values()]
        outputs = await asyncio.gather(*tasks, return_exceptions=True)
        results: Dict[str, Any] = {}
        for name, output in zip(self.engines.keys(), outputs):
            if isinstance(output, Exception):
                logger.error(f"Engine '{name}' failed: {output}")
                results[name] = {"engine_name": name, "error": str(output)}
            else:
                results[name] = output
        return results


# ============================================================
# STAGE 3 — RESULT CONSOLIDATION (deterministic — no LLM)
# ============================================================

def consolidate_results(
    ctx:            ClinicalContext,
    adequacy:       Dict[str, Any],
    sufficiency:    Dict[str, Any],
    derivation:     Dict[str, Any],
    engine_results: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Stage 3 — Reconcile scores, flag conflicts, compute composite.
    Pure Python — no LLM call needed here.
    """
    adq_score = float(adequacy.get("adequacy_score")    or 0.0)
    suf_score = float(sufficiency.get("sufficiency_score") or 0.0)
    composite  = round((adq_score + suf_score) / 2, 3)

    adq_verdict = adequacy.get("final_verdict",   "Inconclusive")
    suf_verdict = sufficiency.get("final_verdict", "Inconclusive")

    warnings: List[str] = []

    # Conflict: clinically adequate but documentally insufficient
    if adq_verdict == "Adequate" and suf_verdict == "Insufficient":
        warnings.append(
            "Conflict detected: documentation is clinically adequate but "
            "insufficient for claim processing — review missing documentation elements."
        )

    # Pending reports
    if ctx.pending_reports:
        warnings.append(
            f"Final coding should await pending report results: "
            f"{', '.join(ctx.pending_reports[:3])}"
        )

    # Specialty mismatch between Stage 1 and Specialty Engine
    specialty_result = engine_results.get("Specialty Engine") or {}
    engine_specialty = specialty_result.get("primary_specialty", "")
    if engine_specialty and engine_specialty.lower() != ctx.primary_specialty.lower():
        warnings.append(
            f"Specialty mismatch: context builder → '{ctx.primary_specialty}', "
            f"specialty engine → '{engine_specialty}'. Manual review recommended."
        )

    fraud_score = float(
        (engine_results.get("Fraud Screening Engine") or {}).get("fraud_risk_score", 0.0)
    )
    requires_review = (
        composite    < 0.5
        or adq_verdict  == "Inadequate"
        or suf_verdict  == "Insufficient"
        or fraud_score  > 0.5
        or bool(ctx.pending_reports)
    )

    tnm = derivation.get("tnm_classification") or {}
    deriv_conf = float(tnm.get("confidence", 0.5)) if isinstance(tnm, dict) else 0.5

    return {
        "composite_score": composite,
        "requires_review": requires_review,
        "warnings":        warnings,
        "confidence_scores": {
            "medical_adequacy":    adequacy.get("confidence",   adq_score),
            "medical_sufficiency": sufficiency.get("confidence", suf_score),
            "clinical_derivation": deriv_conf,
            "composite":           composite,
        },
        "verdict_summary": {
            "adequacy_verdict":   adq_verdict,
            "sufficiency_verdict": suf_verdict,
            "active_diagnoses":   ctx.active_diagnoses,
            "past_history":       ctx.past_history,
            "primary_specialty":  ctx.primary_specialty,
            "pending_reports":    ctx.pending_reports,
            "total_documents":    ctx.total_documents,
        },
    }


# ============================================================
# STAGE 4 — IDEMPOTENT MONGODB SAVE
# ============================================================

async def save_all_results(
    patient_id:     str,
    doctor_id:      str,
    ctx:            ClinicalContext,
    adequacy:       Dict[str, Any],
    sufficiency:    Dict[str, Any],
    derivation:     Dict[str, Any],
    engine_results: Dict[str, Any],
    consolidation:  Dict[str, Any],
) -> None:
    """
    FIX 10 — Two separate upsert namespaces.

    Old code used same key {patient_id, doctor_id} for everything, so the
    composite upsert and per-engine upserts overwrote each other.

    Now:
      Composite record : {patient_id, doctor_id, record_type: "composite"}
      Per-engine record: {patient_id, engine_name, record_type: "engine"}
    """
    ts = datetime.utcnow().isoformat()

    # ── Composite record ──────────────────────────────────────────────────
    composite_doc = sanitize_for_response({
        "patient_id":                   patient_id,
        "doctor_id":                    doctor_id,
        "record_type":                  "composite",       # FIX 10
        "clinical_context":             ctx.dict(),
        "medical_adequacy_results":     adequacy,
        "medical_sufficiency_results":  sufficiency,
        "clinical_derivation_results":  derivation,
        "engine_specific_results":      engine_results,
        "consolidation":                consolidation,
        "confidence_scores":            consolidation.get("confidence_scores", {}),
        "warnings":                     consolidation.get("warnings", []),
        "requires_review":              consolidation.get("requires_review", False),
        "status":                       "success",
        "timestamp":                    ts,
        "updated_at":                   ts,
    })
    await processed_engine_results.update_one(
        {"patient_id": patient_id, "doctor_id": doctor_id, "record_type": "composite"},
        {"$set": composite_doc},
        upsert=True,
    )

    # ── Per-engine records ────────────────────────────────────────────────
    for engine_name, engine_output in engine_results.items():
        engine_doc = sanitize_for_response({
            "patient_id":           patient_id,
            "doctor_id":            doctor_id,
            "record_type":          "engine",              # FIX 10
            "engine_name":          engine_name,
            "engine_output":        engine_output,
            "processing_timestamp": ts,
            "updated_at":           ts,
        })
        await processed_engine_results.update_one(
            {
                "patient_id":  patient_id,
                "engine_name": engine_name,
                "record_type": "engine",
            },
            {"$set": engine_doc},
            upsert=True,
        )

    logger.info(
        f"[Stage4] Saved composite + {len(engine_results)} engine records "
        f"for patient={patient_id}"
    )


# ============================================================
# LANGGRAPH WORKFLOW
# ============================================================

def create_workflow() -> Any:
    """
    Build the LangGraph 4-stage workflow.

    Graph edges:
      ingest_context → adequacy_sufficiency → engines_and_derivation → consolidation → save → END
    """
    adequacy_agent   = MedicalAdequacyAgent(llm_large)
    sufficiency_agent= MedicalSufficiencyAgent(llm_large)
    derivation_agent = ClinicalDerivationAgent(llm)
    orchestrator     = EngineOrchestrator()

    # ── Stage 0 + 1 ───────────────────────────────────────────────────────
    async def ingest_context_node(state: ClinicalReasoningState) -> ClinicalReasoningState:
        logger.info(f"[Stage0+1] patient={state['patient_id']}")
        try:
            docs = await fetch_and_normalise_documents(state["patient_id"], state["doctor_id"])
            demo = await fetch_patient_demographics(state["patient_id"])
            ctx  = await build_clinical_context(docs, state["patient_id"])
            state["docs"] = docs
            state["demo"] = demo
            state["ctx"]  = ctx
        except Exception as e:
            logger.error(f"[Stage0+1] Failed: {e}\n{traceback.format_exc()}")
            state["error"] = str(e)
            state.setdefault("warnings", []).append(f"Ingest/context failed: {e}")
        return state

    # ── Stage 2a — adequacy + sufficiency ─────────────────────────────────
    async def adequacy_sufficiency_node(state: ClinicalReasoningState) -> ClinicalReasoningState:
        logger.info("[Stage2a] Adequacy + Sufficiency")
        docs = state.get("docs") or []
        ctx  = state.get("ctx")
        demo = state.get("demo")

        if not docs or not ctx:
            state["adequacy"]    = {"error": "No documents", "adequacy_score":    0.0, "final_verdict": "Inconclusive"}
            state["sufficiency"] = {"error": "No documents", "sufficiency_score": 0.0, "final_verdict": "Inconclusive"}
            return state

        adq, suf = await asyncio.gather(
            adequacy_agent.process(docs, ctx, demo),
            sufficiency_agent.process(docs, ctx, demo),
            return_exceptions=True,
        )
        state["adequacy"]    = adq if not isinstance(adq, Exception) else {
            "error": str(adq), "adequacy_score": 0.0, "final_verdict": "Inconclusive",
        }
        state["sufficiency"] = suf if not isinstance(suf, Exception) else {
            "error": str(suf), "sufficiency_score": 0.0, "final_verdict": "Inconclusive",
        }
        return state

    # ── Stage 2b — derivation + 12 engines ───────────────────────────────
    async def engines_derivation_node(state: ClinicalReasoningState) -> ClinicalReasoningState:
        logger.info("[Stage2b] Derivation + 12 engines")
        docs = state.get("docs") or []
        ctx  = state.get("ctx")
        demo = state.get("demo")

        if not docs or not ctx:
            state["derivation"]     = {"error": "No documents", "can_derive_any": False}
            state["engine_results"] = {}
            return state

        deriv, eng = await asyncio.gather(
            derivation_agent.process(docs, ctx, demo),
            orchestrator.run_all(docs, ctx, demo),
            return_exceptions=True,
        )
        state["derivation"]     = deriv if not isinstance(deriv, Exception) else {
            "error": str(deriv), "can_derive_any": False,
        }
        state["engine_results"] = eng if not isinstance(eng, Exception) else {}
        return state

    # ── Stage 3 — consolidation ───────────────────────────────────────────
    async def consolidation_node(state: ClinicalReasoningState) -> ClinicalReasoningState:
        logger.info("[Stage3] Consolidation")
        ctx = state.get("ctx")
        if not ctx:
            state["consolidation"] = {}
            return state
        state["consolidation"] = consolidate_results(
            ctx            = ctx,
            adequacy       = state.get("adequacy")       or {},
            sufficiency    = state.get("sufficiency")    or {},
            derivation     = state.get("derivation")     or {},
            engine_results = state.get("engine_results") or {},
        )
        return state

    # ── Stage 4 — save ────────────────────────────────────────────────────
    async def save_node(state: ClinicalReasoningState) -> ClinicalReasoningState:
        logger.info("[Stage4] Save")
        ctx = state.get("ctx")
        if not ctx:
            return state
        try:
            await save_all_results(
                patient_id     = state["patient_id"],
                doctor_id      = state["doctor_id"],
                ctx            = ctx,
                adequacy       = state.get("adequacy")       or {},
                sufficiency    = state.get("sufficiency")    or {},
                derivation     = state.get("derivation")     or {},
                engine_results = state.get("engine_results") or {},
                consolidation  = state.get("consolidation")  or {},
            )
        except Exception as e:
            logger.error(f"[Stage4] Save failed: {e}")
            state.setdefault("warnings", []).append(f"Save error: {e}")
        return state

    # ── Wire the graph ────────────────────────────────────────────────────
    g = StateGraph(ClinicalReasoningState)
    g.add_node("ingest_context",       ingest_context_node)
    g.add_node("adequacy_sufficiency", adequacy_sufficiency_node)
    g.add_node("engines_derivation",   engines_derivation_node)
    g.add_node("consolidation_stage", consolidation_node)
    g.add_node("save",                 save_node)

    g.set_entry_point("ingest_context")
    g.add_edge("ingest_context",       "adequacy_sufficiency")
    g.add_edge("adequacy_sufficiency", "engines_derivation")
    g.add_edge("engines_derivation", "consolidation_stage")
    g.add_edge("consolidation_stage", "save")
    g.add_edge("save",                 END)

    return g.compile()


# ============================================================
# MAIN RUNNER
# ============================================================

async def run_clinical_reasoning(patient_id: str, doctor_id: str) -> Dict[str, Any]:
    """Execute the full 4-stage pipeline and return the complete API response dict."""
    logger.info(f"Starting clinical reasoning: patient={patient_id}, doctor={doctor_id}")

    workflow = create_workflow()

    initial: ClinicalReasoningState = {
        "patient_id":     patient_id,
        "doctor_id":      doctor_id,
        "docs":           None,
        "ctx":            None,
        "demo":           None,
        "adequacy":       None,
        "sufficiency":    None,
        "derivation":     None,
        "engine_results": None,
        "consolidation":  None,
        "warnings":       [],
        "error":          None,
    }

    try:
        final         = await workflow.ainvoke(initial)
        consolidation = final.get("consolidation") or {}
        ctx           = final.get("ctx")

        all_warnings = list(set(
            consolidation.get("warnings", []) + (final.get("warnings") or [])
        ))

        return sanitize_for_response({
            "status":                      "success",
            "clinical_context":            ctx.dict() if ctx else None,
            "medical_adequacy_results":    final.get("adequacy"),
            "medical_sufficiency_results": final.get("sufficiency"),
            "clinical_derivation_results": final.get("derivation"),
            "engine_specific_results": final.get("engine_results") or {},
            "confidence_scores":           consolidation.get("confidence_scores", {}),
            "warnings":                    all_warnings,
            "requires_review":             consolidation.get("requires_review", False),
            "verdict_summary":             consolidation.get("verdict_summary"),
            "timestamp":                   datetime.utcnow().isoformat(),
        })

    except Exception as e:
        logger.error(f"Workflow failed: {e}\n{traceback.format_exc()}")
        return {
            "status":                  "error",
            "error":                   str(e),
            "clinical_context":        None,
            "medical_adequacy_results":    None,
            "medical_sufficiency_results": None,
            "clinical_derivation_results": None,
            "engine_specific_results": {},
            "confidence_scores":       {},
            "warnings":                ["Clinical reasoning workflow failed"],
            "requires_review":         True,
            "verdict_summary":         None,
            "timestamp":               datetime.utcnow().isoformat(),
        }


# ============================================================
# API ENDPOINTS
# ============================================================

@router.post("/helo/clinical-reasoning", response_model=EnhancedClinicalReasoningResponse)
async def execute_clinical_reasoning(request: ClinicalReasoningRequest):
    """
    Primary endpoint — run the full 4-stage clinical reasoning pipeline.
    Replaces the old /helo/clinical-reasoning endpoint with identical path.
    """
    try:
        logger.info(f"API: patient={request.patient_id}, doctor={request.doctor_id}")
        result = await run_clinical_reasoning(request.patient_id, request.doctor_id)
        return EnhancedClinicalReasoningResponse(**result)
    except Exception as e:
        logger.error(f"API endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/clinical-reasoning/result/{patient_id}")
async def get_clinical_reasoning_result(
    patient_id: str,
    doctor_id:  Optional[str] = Query(default=None),
):
    """Retrieve the latest composite result for a patient."""
    query: Dict[str, Any] = {"patient_id": patient_id, "record_type": "composite"}
    if doctor_id:
        query["doctor_id"] = doctor_id

    result = await processed_engine_results.find_one(query, {"_id": 0})
    if not result:
        return {
            "status":     "not_found",
            "patient_id": patient_id,
            "message":    "No clinical reasoning results found",
            "timestamp":  datetime.utcnow().isoformat(),
        }
    return {
        "status":     "success",
        "patient_id": patient_id,
        "data":       result,
        "timestamp":  datetime.utcnow().isoformat(),
    }


@router.get("/results/patient/{patient_id}/engine/{engine_name}")
async def get_engine_result(patient_id: str, engine_name: str):
    """Retrieve a single engine's latest result for a patient."""
    result = await processed_engine_results.find_one(
        {"patient_id": patient_id, "engine_name": engine_name, "record_type": "engine"},
        {"_id": 0},
    )
    if not result:
        raise HTTPException(
            status_code=404,
            detail=f"No result found for engine '{engine_name}' and patient '{patient_id}'",
        )
    return {
        "status":      "success",
        "patient_id":  patient_id,
        "engine_name": engine_name,
        "result":      result,
        "timestamp":   datetime.utcnow().isoformat(),
    }


@router.get("/results/patient/{patient_id}/summary")
async def get_patient_summary(patient_id: str):
    """Quick composite verdict summary — lightweight endpoint for dashboards."""
    result = await processed_engine_results.find_one(
        {"patient_id": patient_id, "record_type": "composite"},
        {"_id": 0, "consolidation": 1, "timestamp": 1},
    )
    if not result:
        return {"status": "not_found", "patient_id": patient_id}

    c = result.get("consolidation") or {}
    return {
        "status":           "success",
        "patient_id":       patient_id,
        "composite_score":  c.get("composite_score"),
        "requires_review":  c.get("requires_review"),
        "verdict_summary":  c.get("verdict_summary"),
        "warnings":         c.get("warnings", []),
        "confidence_scores": c.get("confidence_scores", {}),
        "timestamp":        result.get("timestamp"),
    }


@router.get("/results/patient/{patient_id}/all-engines")
async def get_all_engine_results(patient_id: str):
    """Retrieve all per-engine results for a patient as a single response."""
    cursor = processed_engine_results.find(
        {"patient_id": patient_id, "record_type": "engine"},
        {"_id": 0},
    )
    docs = await cursor.to_list(length=50)
    if not docs:
        return {"status": "not_found", "patient_id": patient_id, "engines": {}}

    by_engine = {d.get("engine_name", "unknown"): d.get("engine_output", {}) for d in docs}
    return {
        "status":    "success",
        "patient_id": patient_id,
        "engines":   by_engine,
        "count":     len(by_engine),
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/clinical-reasoning/health")
async def health_check():
    """Service health check with architecture summary."""
    return {
        "status":      "healthy",
        "service":     "clinical-reasoning-agents-v2",
        "architecture": "4-stage pipeline",
        "stages": [
            "0: Ingest — flatten sections (FIX1), dedup by hash (FIX2), filter null vitals (FIX3), tag doc type (FIX6)",
            "1: Context builder — active vs past dx (FIX4), one focused LLM call (FIX5)",
            "2a: Adequacy (3 sub-calls) + Sufficiency (2 sub-calls) — parallel (FIX5)",
            "2b: Clinical derivation + 12 specialist engines — all parallel",
            "3: Consolidation — deterministic, no LLM",
            "4: Save — separate composite + per-engine namespaces (FIX10)",
        ],
        "engines": [
            "Patient & Policy Engine",
            "Clinical Justification Engine",
            "Admission Review Engine",
            "Investigation Audit Engine",
            "Treatment & Procedure Engine",
            "Medication Review Engine",
            "Documentation Audit Engine",
            "Billing Audit Engine",
            "Fraud Screening Engine",
            "Discharge & Outcome Engine",
            "Specialty Engine",
            "Coding & Compliance Engine",
        ],
        "fixes_applied": {
            "FIX1":  "flatten_sections() — real headings instead of 'tables'/'sections' keys",
            "FIX2":  "fetch_and_normalise_documents() — dedup by file_hash not document_id",
            "FIX3":  "filter_null_vitals() — strips null vital placeholders before LLM calls",
            "FIX4":  "build_clinical_context() — classifies active vs past diagnosis",
            "FIX5":  "MedicalAdequacyAgent split into 3 sub-calls; MedicalSufficiencyAgent 2 sub-calls",
            "FIX6":  "detect_doc_type() — checks real normalised heading names",
            "FIX7":  "All agents iterate flat doc.sections Dict[str,str]",
            "FIX8":  "SpecialtyEngine uses llm.invoke() not llm.agenerate()",
            "FIX9":  "raw_markdown fallback in _sections_text() when sections are thin",
            "FIX10": "save_all_results() uses record_type discriminator — no overwrite race",
        },
        "timestamp": datetime.utcnow().isoformat(),
    }


@router.get("/test")
async def test_get():
    return {"reply": "clinical-reasoning-v2 OK (GET)", "timestamp": datetime.utcnow().isoformat()}


@router.post("/test")
async def test_post(payload: dict):
    return {"reply": "clinical-reasoning-v2 OK (POST)", "received": payload}