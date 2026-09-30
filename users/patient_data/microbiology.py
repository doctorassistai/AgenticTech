import os
import uuid
import json
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from motor.motor_asyncio import AsyncIOMotorClient
import httpx

logger = logging.getLogger(__name__)

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GLOBAL_LLM_MODEL = "openai/gpt-oss-20b"
API_BASE_URL = os.getenv("VITE_BACKEND_URL", "https://doctorassist.ai/api/")

try:
    mongodb_client = AsyncIOMotorClient(MONGO_URI)
    database = mongodb_client[MONGO_DB]
    microbiology_collection = database["microbiology"]
except Exception as e:  # pragma: no cover
    logger.error(f"Error initializing MongoDB in microbiology_api: {e}")

router = APIRouter(prefix="/microbiology", tags=["Microbiology"])

# Initial status for a freshly registered case; the terminal status after the
# Tab 14 sign-out (kept string-identical to onco-pathology so the frontend's
# `status === "Signed-out"` lock check is uniform across modules).
CASE_STATUS_REGISTERED = "Registered"
CASE_STATUS_SIGNED_OUT = "Signed-out"

# Case types whose sidebar omits Clinical Interpretation (Tab 12) — mirrors
# SUPPRESSED_SIDEBAR in components/microbiology/constants.js. A pre-emptive
# pharmacogenomic case has no organism to interpret, so the tab is not offered;
# the sign-out interpretation-confirmation blocker is skipped for these rather
# than left unsatisfiable. Keep in step with the frontend map.
CASE_TYPES_WITHOUT_INTERPRETATION = {"Pharmacogenomics / PGx"}


# ─── Helpers ──────────────────────────────────────────────────────────────────


def _serialize_case(doc: dict) -> dict:
    """Prepare a case document for JSON output."""
    if not doc:
        return {}
    doc["_id"] = str(doc["_id"])
    for k in ("created_at", "updated_at"):
        if k in doc and hasattr(doc[k], "isoformat"):
            doc[k] = doc[k].isoformat()
    return doc


def _groq_client():
    """Lazily build a Groq client; raise a clear error if the key is missing."""
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY not configured on server")
    from groq import Groq
    return Groq(api_key=GROQ_API_KEY)


def _compact_text(value: Any, limit: int = 4000) -> str:
    if isinstance(value, list):
        text = ", ".join(str(item).strip() for item in value if str(item).strip())
    else:
        text = str(value or "").strip()
    return text if len(text) <= limit else f"{text[:limit]}..."


def _as_list(value: Any) -> list:
    return [item for item in (value or []) if isinstance(item, dict)]


# ─── Advisory evidence compaction ─────────────────────────────────────────────
# The Tab 12 interpretation AI reads a *projection* of the case — the record
# summaries the synthesis actually needs, trimmed so a full case never blows a
# prompt window. Each helper below reduces one section to its decision-relevant
# lines. The advisory engine is advisory-only: it returns suggestions and never
# writes to the case.

def _compact_isolates(workup: Optional[Dict[str, Any]], limit: int = 4000) -> str:
    lines = []
    for sp_id, block in (workup or {}).items():
        if not isinstance(block, dict):
            continue
        for iso in _as_list(block.get("isolates")):
            parts = [f"specimen {sp_id}"]
            if iso.get("organism"):
                parts.append(f"organism: {iso.get('organism')}")
            if iso.get("significance"):
                parts.append(f"significance: {iso.get('significance')}")
            if iso.get("id_method"):
                parts.append(f"id: {iso.get('id_method')}")
            ast = iso.get("ast") or {}
            rows = _as_list(ast.get("antibiotics"))
            if rows:
                parts.append(
                    "AST: "
                    + "; ".join(
                        f"{r.get('antibiotic')} {r.get('interpretation') or '?'}"
                        + (f" (override: {r.get('override_reason')})" if r.get("override_reason") else "")
                        for r in rows
                    )
                )
            if ast.get("resistance_flags"):
                parts.append("flags: " + ", ".join(ast["resistance_flags"]))
            lines.append(" | ".join(parts))
    return _compact_text(lines, limit)


def _compact_orders(orders_section: Optional[Dict[str, Any]], result_keys: tuple, limit: int = 4000) -> str:
    """Reduce a specimen-keyed molecular/serology section to per-order lines.

    Each stored order carries `assay` (label) and a `result` dict; which result
    keys are shown varies by section, so the caller passes the relevant keys.
    """
    lines = []
    for sp_id, block in (orders_section or {}).items():
        if not isinstance(block, dict):
            continue
        for order in _as_list(block.get("orders")):
            parts = [f"specimen {sp_id}"]
            assay = order.get("assay")
            if assay:
                parts.append(f"assay: {assay}")
            res = order.get("result") or {}
            bits = [f"{k}: {res.get(k)}" for k in result_keys if res.get(k)]
            if bits:
                parts.append("result " + ", ".join(bits))
            lines.append(" | ".join(parts))
    return _compact_text(lines, limit)


def _compact_exams(section: Optional[Dict[str, Any]], limit: int = 3000) -> str:
    lines = []
    for sp_id, block in (section or {}).items():
        if not isinstance(block, dict):
            continue
        for exam in _as_list(block.get("exams")):
            res = exam.get("result") or {}
            bits = [f"{k}: {v}" for k, v in res.items() if v]
            lines.append(f"specimen {sp_id} {exam.get('exam_type') or 'exam'} · {_compact_text(bits, 500)}")
    return _compact_text(lines, limit)


def _compact_myco(section: Optional[Dict[str, Any]], limit: int = 3000) -> str:
    lines = []
    for sp_id, block in (section or {}).items():
        if not isinstance(block, dict):
            continue
        for iso in _as_list(block.get("isolates")):
            parts = [f"specimen {sp_id}"]
            if iso.get("species"):
                parts.append(f"species: {iso.get('species')}")
            if iso.get("id_method"):
                parts.append(f"id: {iso.get('id_method')}")
            dst = iso.get("dst") or {}
            fl = ", ".join(f"{r.get('drug')}={r.get('result') or '?'}" for r in _as_list(dst.get("first_line")))
            sl = ", ".join(f"{r.get('drug')}={r.get('result') or '?'}" for r in _as_list(dst.get("second_line")))
            if fl:
                parts.append(f"1st-line [{fl}]")
            if sl:
                parts.append(f"2nd-line [{sl}]")
            lines.append(" | ".join(parts))
    return _compact_text(lines, limit)


def _compact_genomics(section: Any) -> Dict[str, Any]:
    """
    Project the pathogen-genomics section (Tab 15) down to what an interpretation
    needs. Raw reads, QC metrics and pipeline logs are never sent to the model —
    only the identified organism, the resistance determinants, and the TB call.

    Resistance here is PREDICTED from genotype, not measured. The prompt must be
    able to tell the two apart, so every block carries its concordance field
    rather than being flattened into the phenotypic results.

    The human-genomics (PGx) section is deliberately NOT included: it informs drug
    toxicity, not infection management, and blending it into a per-organism
    assessment would produce advice about the wrong question.
    """
    out: Dict[str, Any] = {}
    if not isinstance(section, dict):
        return out

    for spec_id, rec in section.items():
        if not isinstance(rec, dict):
            continue
        entry: Dict[str, Any] = {}

        wgs = rec.get("wgs") or {}
        if wgs:
            entry["wgs"] = {
                "species": wgs.get("identified_species"),
                "sequence_type": wgs.get("sequence_type"),
                "lineage": wgs.get("lineage"),
                "predicted_resistance": [
                    {
                        "gene": g.get("gene_name"),
                        "drugs": g.get("drug_targets") or [],
                        "phenotype": g.get("predicted_phenotype"),
                        "confidence": g.get("confidence"),
                    }
                    for g in _as_list(wgs.get("resistance_genes"))
                ],
                "tb_classification": wgs.get("tb_resistance_classification"),
                "concordance": wgs.get("genotype_phenotype_concordance"),
                "cluster_id": wgs.get("cluster_id"),
                "snp_distance": wgs.get("cluster_snp_distance"),
            }

        tngs = rec.get("tngs") or {}
        if tngs:
            entry["tngs"] = {
                "tb_classification": tngs.get("tb_classification"),
                "lineage": tngs.get("lineage"),
                "calls": [
                    {
                        "drug": c.get("drug"),
                        "mutations": c.get("mutations_detected") or [],
                        "phenotype": c.get("predicted_phenotype"),
                        "who_group": c.get("who_confidence_tier"),
                        "heteroresistance": c.get("heteroresistance"),
                    }
                    for c in _as_list(tngs.get("drug_resistance_calls"))
                ],
                "concordance": tngs.get("concordance_with_phenotypic_dst"),
            }

        mngs = rec.get("mngs") or {}
        if mngs:
            entry["mngs"] = {
                "hits": [
                    {
                        "taxon": h.get("taxon_name"),
                        "kingdom": h.get("kingdom"),
                        "significance": h.get("clinical_significance"),
                    }
                    for h in _as_list(mngs.get("organism_hits"))[:5]
                ],
                "amr_genes": [
                    {"gene": g.get("gene_name"), "phenotype": g.get("predicted_phenotype")}
                    for g in _as_list(mngs.get("amr_genes_detected"))
                ],
            }

        panels = []
        for order in _as_list((rec.get("targeted") or {}).get("orders")):
            if not order.get("panel"):
                continue
            panels.append(
                {
                    "panel": order.get("panel"),
                    "markers": [
                        {
                            "locus": m.get("locus"),
                            "mutation": m.get("mutation"),
                            "drug": m.get("drug"),
                            "phenotype": m.get("predicted_phenotype"),
                        }
                        for m in _as_list(order.get("mutation_rows"))
                    ],
                    "taxa": [
                        {"taxon": t.get("taxon_name"), "identity": t.get("identity_pct")}
                        for t in _as_list(order.get("taxa_rows"))
                    ],
                }
            )
        if panels:
            entry["targeted_panels"] = panels

        if entry:
            out[spec_id] = entry

    return out


def _compact_pgx(section: Any) -> Dict[str, Any]:
    """
    Project the human-genomics section (Tab 16) down to what a PGx advisory needs:
    the recorded genotype and phenotype, the implications the microbiologist
    already chose, and the QC gaps.

    The no-call genes and the assay limitations are included deliberately — they
    are what stop a "not detected" being read as "normal", which is the failure
    mode this brief exists to prevent. The deterministic engine's own output is
    included too (its summary and its contradiction flags), so the model reasons
    over the same facts the screen shows rather than re-deriving them.
    """
    if not isinstance(section, dict):
        return {}

    assay = section.get("assay") or {}
    qc = section.get("qc") or {}
    g6pd = section.get("g6pd") or {}
    derived = section.get("derived") or {}

    return {
        "assay": {
            "panel": assay.get("panel"),
            "method": assay.get("method"),
            "genes_covered": assay.get("genes_covered") or [],
            "specimen_type": assay.get("specimen_type"),
            "laboratory": assay.get("laboratory"),
            "reported_at": assay.get("reported_at"),
        },
        "qc": {
            "no_call_genes": qc.get("no_call_genes") or [],
            "limitations": qc.get("limitations") or [],
            "qc_pass": qc.get("qc_pass"),
            "qc_note": _compact_text(qc.get("qc_note"), 400),
        },
        "gene_results": [
            {
                "gene": r.get("gene"),
                "diplotype": r.get("diplotype"),
                "alleles": [a for a in (r.get("allele_1"), r.get("allele_2")) if a],
                "phenotype": r.get("phenotype"),
                "activity_score": r.get("activity_score"),
                "risk_category": r.get("risk_category"),
                "dose_implication": r.get("dose_implication"),
                "implicated_drugs": r.get("implicated_drugs") or [],
                "guideline": r.get("guideline"),
                "guideline_version": r.get("guideline_version"),
                "evidence_level": r.get("evidence_level"),
                "note": _compact_text(r.get("note"), 300),
            }
            for r in _as_list(section.get("gene_results"))
            if r.get("gene")
        ],
        "hla_results": [
            {
                "allele": h.get("allele"),
                "resolution": h.get("resolution"),
                "result": h.get("result"),
                "drug": h.get("drug"),
                "reaction": h.get("reaction"),
                "recommendation": _compact_text(h.get("recommendation"), 300),
            }
            for h in _as_list(section.get("hla_results"))
            if h.get("allele")
        ],
        "g6pd": (
            {
                "status": g6pd.get("status"),
                "activity_pct": g6pd.get("activity_pct"),
                "variants": g6pd.get("variants") or [],
                "dose_implication": g6pd.get("dose_implication"),
                "affected_drugs": list(G6PD_AFFECTED_DRUGS),
            }
            if g6pd.get("status")
            else {}
        ),
        "derived_summary": derived.get("summary"),
        "derived_flags": [
            {"gene": f.get("gene"), "text": f.get("text")}
            for f in _as_list(derived.get("flags"))
        ],
        # The frontend's own guidance view — payload-only and `_`-prefixed, never
        # stored. For each gene row: what the curated table says PER DRUG, and
        # whether the table abstained. Sent so the brief reasons over the same
        # guidance the screen shows instead of recalling CPIC from memory, which is
        # what let it downgrade a real "avoid clopidogrel" to "insufficient evidence".
        "guidance": section.get("_guidance") or [],
        "recorded_limitations_note": _compact_text((section.get("report") or {}).get("limitations_note"), 600),
    }


def _compact_evidence(case: Dict[str, Any]) -> Dict[str, Any]:
    """Project the sections the clinical-interpretation advisory needs."""
    register = case.get("case_register") or {}
    clinical = register.get("clinical_context") or {}

    specimens = []
    for sp in _as_list(register.get("specimens")):
        specimens.append(
            {
                "specimen_type": sp.get("specimen_type"),
                "site": sp.get("site_of_collection"),
                "collection": sp.get("collection_datetime"),
                "tests_ordered": sp.get("tests_ordered") or [],
                "rejected": (sp.get("quality") or {}).get("rejection_met"),
            }
        )

    prelim = case.get("preliminary_reports") or {}
    prelim_lines = []
    for v in _as_list(prelim.get("versions")):
        line = f"v{v.get('version')} {v.get('source_tab')}"
        if v.get("summary"):
            line += f": {v.get('summary')}"
        if v.get("critical_reason"):
            line += f" [CRITICAL {v.get('critical_reason')}]"
        if v.get("notifiable_reason"):
            line += f" [NOTIFIABLE {v.get('notifiable_reason')}]"
        prelim_lines.append(line)

    return {
        "case_type": register.get("case_type"),
        "clinical_context": {
            "presenting_complaint": clinical.get("presenting_complaint"),
            "relevant_history": clinical.get("relevant_history"),
            "antibiotics_started": clinical.get("antibiotics_started"),
            "antibiotic_name": clinical.get("antibiotic_name"),
        },
        "specimens": specimens,
        "direct_examination": _compact_exams(case.get("direct_examination")),
        "culture_isolates": _compact_isolates(case.get("culture_workup")),
        "molecular": _compact_orders(
            case.get("molecular"), ("qualitative", "copies_ml", "ct", "markers")
        ),
        "serology": _compact_orders(
            case.get("serology"), ("qualitative", "quantitative", "interpretation")
        ),
        "mycobacteriology": _compact_myco(case.get("mycobacteriology")),
        "pathogen_genomics": _compact_genomics(case.get("pathogen_genomics")),
        "preliminaries": _compact_text(prelim_lines, 3000),
    }


# ─── Patient context reads (cross-specialty, advisory) ────────────────────────
# The Tab 12 advisory also weighs the patient's onco clinical picture — diagnosis,
# treatment (chemo → neutropenia), recent labs — when judging organism significance.
# These reads are patient-level, not case-level, so no "active/latest case" semantics
# apply; every source tolerates absence and the advisory simply proceeds without it.


async def _fetch_patient_context(patient_id: str) -> Dict[str, Any]:
    """Optional advisory context from the shared context service.

    Returns {} for any source the patient lacks (404) or that fails — never raises.
    Same endpoints onco_pathology's `_collect_clinical_context_sources` reads.
    """
    base = f"{API_BASE_URL.rstrip('/')}/hms/users/data/context"
    out: Dict[str, Any] = {}
    # 10s per request — a slow context service must not hold the advisory. A bare
    # TimeoutError has an empty str(), so the failure log carries the URL, the
    # exception class and the full traceback (exc_info) to be diagnosable.
    async with httpx.AsyncClient(timeout=10.0) as client:
        for name, method, url in (
            ("patient_summary", "GET", f"{base}/patient-summary/{patient_id}"),
            ("completed_investigations", "POST",
             f"{base}/oncology-investigations/all-completed-documents"),
        ):
            try:
                resp = await client.request(
                    method, url,
                    json={"patient_id": patient_id} if method == "POST" else None,
                )
                if resp.status_code == 404:
                    continue
                resp.raise_for_status()
                out[name] = resp.json().get("data") or {}
                logger.debug("Patient context %s fetched for %s", name, patient_id)
            except Exception as exc:
                logger.warning(
                    "Patient context %s failed for %s at %s (%s) — traceback follows",
                    name, patient_id, url, type(exc).__name__,
                    exc_info=True,
                )
    return out


def _compact_patient_context(context: Dict[str, Any], limit: int = 4000) -> str:
    """Flatten the fetched patient context to decision-relevant lines.

    patient_summary carries the confirmed diagnosis / treatment picture;
    completed_investigations carries recent lab results. "" when nothing came back.
    """
    lines = []
    summary = (context.get("patient_summary") or {}).get("summary") or {}
    for key in ("confirmed_diagnoses", "resection_status", "margin_status"):
        if summary.get(key):
            lines.append(f"{key}: {_compact_text(summary[key], 600)}")
    if summary.get("narrative"):
        lines.append(f"summary: {_compact_text(summary['narrative'], 1400)}")
    timeline = _as_list(
        ((context.get("patient_summary") or {}).get("timeline") or {}).get("timeline")
    )[:15]
    for item in timeline:
        events = []
        for group in item.get("entity_types") or []:
            if not isinstance(group, dict) or group.get("entity_type") not in {
                "Diagnosis", "Finding", "Treatment", "Medication", "Imaging",
            }:
                continue
            for entity in _as_list(group.get("entities")):
                if entity.get("name"):
                    events.append(f"{group.get('entity_type')}: {entity['name']}")
        if events:
            lines.append(f"{item.get('date') or '—'} · " + "; ".join(events[:8]))
    # all-completed-documents returns the raw list of investigations; keep only
    # the lab rows, capped at 8 — the whole block is re-capped at `limit` (4000
    # chars) before it ever reaches the prompt.
    labs = [
        item for item in _as_list(context.get("completed_investigations"))
        if str(item.get("investigation") or "").lower().startswith("labinvestigation_")
    ]
    for lab in labs[:8]:
        name = str(lab.get("investigation") or "").replace("labinvestigation_", "")
        results = "; ".join(
            f"{r.get('parameter_name')}: {_compact_text(r.get('content'), 300)}"
            for r in _as_list(lab.get("parameterwise_content")) if r.get("content")
        )
        if results:
            lines.append(f"{name}: {results[:800]}")
    return _compact_text(lines, limit)


# ─── Payload models ────────────────────────────────────────────────────────────


class CreateCasePayload(BaseModel):
    patient_id: str
    doctor_id: str
    hospital_id: Optional[str] = None
    data: Dict[str, Any]  # the case_register section


class SaveSectionPayload(BaseModel):
    data: Any


class InterpretationAdvisoryPayload(BaseModel):
    """Tab 12 advisory request — the AI reads the stored case; a partial draft
    (organism significance rows already recorded) is optional context."""

    draft_interpretation: Optional[Dict[str, Any]] = None


class PgxAdvisoryPayload(BaseModel):
    """Tab 16 advisory request. `draft_section` carries the form's unsaved state so
    a brief can be read before the section is saved; without it the stored
    `human_genomics` section is used."""

    draft_section: Optional[Dict[str, Any]] = None


# ─── ALLOWED_SECTIONS — the section keys from the module plan's Sections table.
# The frontend cannot write a section that is not whitelisted here.
ALLOWED_SECTIONS = {
    "case_register",
    "specimen_processing",
    "direct_examination",
    "culture_setup",
    "culture_workup",
    "molecular",
    "serology",
    "mycobacteriology",
    "pathogen_genomics",
    "human_genomics",
    "preliminary_reports",
    "interpretation",
    "infection_control",
    "final_report",
}


# ─── Case CRUD ────────────────────────────────────────────────────────────────


@router.post("/case")
async def create_case(payload: CreateCasePayload):
    """
    Create a new microbiology case. Generates a UUID case_id. One document per
    case; the newest case for a patient becomes the active one.
    """
    try:
        case_id = str(uuid.uuid4())
        now = datetime.utcnow()
        # Store the section exactly as the form produced it (form-driven shape);
        # only pin patient_id so the document root and case_register agree.
        case_register = dict(payload.data or {})
        case_register.setdefault("patient", {})["patient_id"] = payload.patient_id

        # New case becomes active; older cases for this patient are deactivated
        # so the frontend consistently opens the latest one.
        await microbiology_collection.update_many(
            {"patient_id": payload.patient_id},
            {"$set": {"is_active": False, "updated_at": now}},
        )

        document = {
            "patient_id": payload.patient_id,
            "doctor_id": payload.doctor_id,
            "hospital_id": payload.hospital_id,
            "case_id": case_id,
            "created_at": now,
            "updated_at": now,
            "status": CASE_STATUS_REGISTERED,
            "is_active": True,
            "case_register": case_register,
        }

        await microbiology_collection.insert_one(document)

        return {
            "status": "success",
            "case_id": case_id,
            "message": "Case created",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error creating microbiology case: {e}")
        raise HTTPException(status_code=500, detail="Failed to create case")


@router.get("/case/{case_id}")
async def get_case(case_id: str):
    """Get the full document for a single microbiology case (all sections)."""
    try:
        doc = await microbiology_collection.find_one({"case_id": case_id})
        if not doc:
            return {"status": "success", "data": {}}
        return {"status": "success", "data": _serialize_case(doc)}
    except Exception as e:
        logger.error(f"Error fetching case {case_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch case")


@router.get("/patient/{patient_id}/cases")
async def get_patient_cases(patient_id: str):
    """All microbiology cases for a patient (history), newest first."""
    try:
        cursor = microbiology_collection.find({"patient_id": patient_id}).sort(
            "created_at", -1
        )
        docs = await cursor.to_list(length=1000)
        cases = [_serialize_case(d) for d in docs]
        return {"status": "success", "cases": cases}
    except Exception as e:
        logger.error(f"Error fetching cases for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch cases")


@router.get("/patient/{patient_id}/latest-case")
async def get_latest_case(patient_id: str):
    """
    Get the active case for a patient, or the newest one if none is flagged
    active. Returns { data: {} } when the patient has no cases yet.
    """
    try:
        doc = await microbiology_collection.find_one(
            {"patient_id": patient_id, "is_active": True}
        )
        if not doc:
            doc = await microbiology_collection.find_one(
                {"patient_id": patient_id}, sort=[("created_at", -1)]
            )
        return {"status": "success", "data": _serialize_case(doc) if doc else {}}
    except Exception as e:
        logger.error(f"Error fetching latest case for patient {patient_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to fetch latest case")


# ─── Section Save ──────────────────────────────────────────────────────────────


@router.put("/case/{case_id}/section/{section_path:path}")
async def save_section(case_id: str, section_path: str, payload: SaveSectionPayload):
    """
    Save a specific section of a case document.

    section_path examples: "case_register", "specimen_processing",
    "culture_workup", "final_report".

    MongoDB operation: { "$set": { "{section_path}": data } }
    """
    if section_path not in ALLOWED_SECTIONS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Invalid section path: {section_path}. "
                f"Allowed: {', '.join(sorted(ALLOWED_SECTIONS))}"
            ),
        )
    try:
        section_data = payload.data
        case_state = await microbiology_collection.find_one(
            {"case_id": case_id}, {"patient_id": 1, "status": 1}
        )
        if not case_state:
            raise HTTPException(status_code=404, detail="Case not found")
        if case_state.get("status") == CASE_STATUS_SIGNED_OUT:
            raise HTTPException(status_code=409, detail="Signed-out cases are locked")
        if section_path == "case_register" and isinstance(section_data, dict):
            # Pin patient_id to the case's owner so a client cannot reassign the
            # case to another patient; otherwise store the form shape verbatim.
            section_data.setdefault("patient", {})["patient_id"] = case_state.get(
                "patient_id", ""
            )

        update = {
            "$set": {
                section_path: section_data,
                "updated_at": datetime.utcnow(),
            }
        }
        result = await microbiology_collection.update_one(
            {"case_id": case_id}, update
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Case not found")

        return {"status": "success", "message": f"Section '{section_path}' saved"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error saving section '{section_path}': {e}")
        raise HTTPException(
            status_code=500, detail=f"Failed to save section '{section_path}'"
        )


# ─── Tab 12 — Clinical-interpretation advisory (AI assistant) ─────────────────
# Advisory-only: the model reads a compacted projection of the stored case and
# returns a three-part clinical-insight brief — what was observed, what it
# means, and what to do now / in the future — for the microbiologist to review
# and, where useful, carry into the report for the treating clinician. It never
# writes to the case and never auto-applies a suggestion to the report.

# Option strings mirror components/microbiology/constants.js (Tab 12 enums) so
# the model returns tokens the tab's own selects / readout can render exactly.
MICRO_SIGNIFICANCE_OPTIONS = "Definite pathogen | Likely pathogen | Probable commensal | Contaminant"
MICRO_CONCORDANCE_EXAM_OPTIONS = "Concordant | Discordant | Explain"
MICRO_CONCORDANCE_CLINICAL_OPTIONS = "Consistent | Inconsistent | Explain"

# Mirrors G6PD_AFFECTED_DRUGS in components/microbiology/constants.js. Sent with the
# case so the brief NAMES the drugs a deficient result makes dangerous instead of
# recalling them from training data — without it the model could only describe the
# deficiency in prose and listed no drugs at all.
G6PD_AFFECTED_DRUGS = (
    "Primaquine",
    "Tafenoquine",
    "Dapsone",
    "Nitrofurantoin",
    "Rasburicase",
    "Methylene blue",
)


@router.post("/case/{case_id}/interpretation-advisory")
async def interpretation_advisory(case_id: str, payload: InterpretationAdvisoryPayload):
    """
    Generate an advisory clinical-interpretation brief for a microbiology case.

    The engine reads all analytical tracks together (direct exam, culture workup,
    molecular, serology, mycobacteriology, preliminaries) plus clinical context,
    and returns advisory content grouped as: what was observed (findings
    synopsis), what it means (per-organism significance + concordance with the
    direct exam and clinical picture, whole-picture interpretation, AMR/cascade
    reading), and what to do now / in the future (therapy direction,
    de-escalation, further tests, follow-up, red flags, infection control).
    Output is strictly advisory.
    """
    try:
        case = await microbiology_collection.find_one({"case_id": case_id})
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        evidence = _compact_evidence(case)
        draft = payload.draft_interpretation or {}

        patient_context = ""
        if case.get("patient_id"):
            patient_context = _compact_patient_context(
                await _fetch_patient_context(case["patient_id"])
            )

        prompt = f"""You are an advisory clinical-microbiology interpretation assistant. A qualified
microbiologist makes every decision and reviews every suggestion before anything is reported.
Use only the case facts below — do not invent a result, organism, susceptibility, specimen, or
patient fact that is not present. You never write to the case; suggestions are advisory only.

Return STRICT JSON with exactly these keys (use [] and "" when none applies):
{{
  "findings_synopsis": "",
  "organism_assessment": [
    {{
      "organism": "",
      "significance": "{MICRO_SIGNIFICANCE_OPTIONS}",
      "concordance_exam": "{MICRO_CONCORDANCE_EXAM_OPTIONS}",
      "concordance_clinical": "{MICRO_CONCORDANCE_CLINICAL_OPTIONS}",
      "reasoning": "",
      "clinical_meaning": ""
    }}
  ],
  "interpretation_summary": "",
  "amr_commentary": [{{"finding": "", "clinical_relevance": "", "recommended_action": ""}}],
  "cascade_review": {{"suppressed_agents": "", "override_justified": "", "note": ""}},
  "de_escalation": [{{"from": "", "to": "", "rationale": "", "caveat": ""}}],
  "recommendations": {{
    "therapy": "",
    "avoid": "",
    "further_tests": [],
    "follow_up": [],
    "red_flags": [],
    "infection_control": ""
  }},
  "summary": "",
  "missing_information": []
}}

Rules:
- significance, concordance_exam and concordance_clinical must be an EXACT option string
  from the lists above, or "" when the case does not support a judgement. Never paraphrase.
- findings_synopsis: a short clinician-readable prose summary of what the case shows (organisms,
  AST highlights, molecular/serology/mycobacteriology hits). Synthesise only confirmed facts.
- organism_assessment: one entry per organism/material finding worth an interpretation judgement.
  reasoning explains the significance call; clinical_meaning says what this finding means for
  this patient and the clinical picture (e.g. typical of the suspected syndrome, consequence of
  the resistance profile). Keep both tight and evidence-grounded.
- interpretation_summary: the whole-picture "what it means", written so a treating clinician can
  read it as-is.
- recommendations: phrased for a treating clinician and grounded only in case facts. therapy =
  preferred regimen direction from the AST ("" when no susceptibility supports one); avoid = drugs
  to avoid (resistance / intrinsic / allergy); further_tests = additional/confirmatory tests worth
  considering now; follow_up = forward-looking items (repeat culture timing, review points,
  monitoring); red_flags = only situations the case facts actually raise (sepsis / source control /
  neutropenia etc.), else []; infection_control = any contact-precautions / notifiable relevance.
- de_escalation, amr_commentary, cascade_review, summary and missing_information are advisory
  context for the microbiologist; keep them concise.
- The PATIENT CLINICAL CONTEXT below is background only: it may raise or lower the weight of a
  finding (e.g. neutropenia, immunosuppression, recent treatment), but it never supplies a case fact.

PATIENT CLINICAL CONTEXT (from the patient's onco clinical record; empty when the patient has
none. Background for significance weighting only — do not report it as a laboratory finding):
{patient_context}

CASE EVIDENCE (compacted from the stored case):
{json.dumps(evidence, default=str, indent=1)}

MICROBIOLOGIST DRAFT (may be empty — current interpretation rows the assistant should consider):
{json.dumps(draft, default=str, indent=1)}
"""
        client = _groq_client()
        completion = client.chat.completions.create(
            model=GLOBAL_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            # A reasoning model shares this budget between its reasoning and the
            # visible output. When reasoning spends the whole allowance the model
            # emits nothing, and Groq reports that as json_validate_failed with an
            # EMPTY failed_generation — not as a truncation — so the error carries
            # no clue about the cause. Raised to match the other advisories; the
            # schema asks for a synopsis, a per-organism assessment, an AMR and
            # cascade read, de-escalation rows and grouped recommendations, and
            # organism_assessment grows one entry per organism in the case.
            max_tokens=4500,
        )
        content = completion.choices[0].message.content
        if not content:
            finish = completion.choices[0].finish_reason
            logger.error(
                f"Interpretation advisory returned no content for case {case_id} "
                f"(finish_reason={finish}, max_tokens=4500)"
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    f"The advisory model returned nothing (finish_reason={finish}). "
                    "If it reports 'length', raise max_tokens."
                ),
            )
        output = json.loads(content)
        if not isinstance(output, dict):
            output = {}
        return {
            "status": "success",
            "data": {
                "engine_version": f"{GLOBAL_LLM_MODEL}:micro-interp-2.1",
                "generated_at": datetime.utcnow().isoformat(),
                **output,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Interpretation advisory failed for case {case_id}: {e}")
        raise HTTPException(
            status_code=500, detail=f"Interpretation advisory failed: {e}"
        )


# ─── Tab 16 — Pharmacogenomics advisory ──────────────────────────────────────
# The SIBLING of the interpretation advisory, not a variant of it. That brief is
# infection-scoped (organism significance, antimicrobial therapy); this one is
# patient-scoped (which drugs this person's genotype makes dangerous, and which
# genes were never assessed). Neither can answer the other's question, so neither
# is asked to — and because each is scoped to one domain, the final report can
# draw its fields from whichever advisory owns that half without the two ever
# disagreeing. Read-only: the microbiologist chooses every dose action.


@router.post("/case/{case_id}/pgx-advisory")
async def pgx_advisory(case_id: str, payload: PgxAdvisoryPayload = PgxAdvisoryPayload()):
    """
    Generate an advisory pharmacogenomics brief for a case (Tab 16).

    Reads the recorded genotype, phenotype, the implications already chosen and
    the QC gaps. The brief is explicitly required to say what was NOT assessed —
    a gene that failed QC is not a normal result, and that is the failure mode
    this exists to catch.
    """
    try:
        case = await microbiology_collection.find_one({"case_id": case_id})
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")

        # The form's unsaved state wins when supplied, so a brief can be read
        # before the section is saved (same contract as Tab 12's draft).
        section = payload.draft_section or case.get("human_genomics") or {}
        pgx = _compact_pgx(section)

        # `_compact_pgx` always returns the same keys, so an empty section is still
        # a truthy dict — check for an actual result rather than for the dict.
        has_result = bool(pgx.get("gene_results") or pgx.get("hla_results") or pgx.get("g6pd"))
        if not has_result:
            return {
                "status": "success",
                "data": {
                    "engine_version": f"{GLOBAL_LLM_MODEL}:micro-pgx-1.0",
                    "generated_at": datetime.utcnow().isoformat(),
                    "actionable_summary": "",
                    "gene_assessment": [],
                    "drug_actions": [],
                    "safety_flags": [],
                    "not_analysed": [],
                    "guidance_gaps": [],
                    "recommendations": {"avoid": [], "adjust": [], "monitor": [], "further_tests": []},
                    "report_note": "",
                    "patient_summary": "",
                    "limitations": [],
                    "missing_information": ["No pharmacogenomic result has been recorded for this case."],
                },
            }

        patient_context = ""
        if case.get("patient_id"):
            patient_context = _compact_patient_context(
                await _fetch_patient_context(case["patient_id"])
            )

        client = _groq_client()

        # Numbered lists rather than pipe-delimited blobs: a small model copies a
        # numbered list verbatim far more reliably, and an action string that does
        # not match the vocabulary exactly cannot be grouped downstream.
        dose_actions = "\n".join(
            f"  {i}. {a}" for i, a in enumerate(PGX_DOSE_ACTION_OPTIONS, 1)
        )
        phenotypes = "\n".join(
            f"  {i}. {a}" for i, a in enumerate(PGX_PHENOTYPE_OPTIONS, 1)
        )

        prompt = f"""You are an advisory clinical-pharmacogenomics assistant. A qualified
microbiologist or clinical pharmacologist makes every decision and reviews every suggestion
before anything is reported. You never write to the case.

=== RECORDED PHARMACOGENOMIC FACTS ===
{json.dumps(pgx, indent=2, default=str)}

Patient clinical context (background only, NOT this case's result):
{patient_context}

=== WHAT THIS BRIEF IS ===
It concerns the PATIENT's genotype. It is NOT about an infection — do not comment on organisms,
cultures or antimicrobial therapy. A separate brief covers that.

=== RULES THAT MATTER MORE THAN COMPLETENESS ===
1. A gene recorded as NOT ANALYSED is not a normal result. If a gene is listed in
   qc.no_call_genes, or is not covered by the panel, it was NOT assessed — say so. Never
   describe an untested gene as normal, wild-type or unremarkable.
2. A dose action is DRUG-specific, not phenotype-specific. Always name the drug and what to do
   with it. Never write "this patient is an intermediate metabolizer" as though that were the
   finding — the same phenotype requires opposite actions for different drugs.
3. "Insufficient evidence — use clinical judgement" is a valid and PREFERRED answer. Do not
   invent an action in order to fill a gap.
4. Every drug in the engine's derived_summary avoid / dose-adjustment lists MUST also appear in
   drug_actions. The engine has already identified which drugs matter — explain them, do not
   re-derive the list. A recorded G6PD deficiency yields one drug_actions entry per drug in
   g6pd.affected_drugs.
5. Do NOT list a drug whose action is the standard dose. Omit it — absence means no change is
   needed. Listing a drug under "Insufficient evidence" when the published guidance says no
   change is required is misleading; omit it instead.
6. The `guidance` array is YOUR OWN curated table's view of each row, and it outranks your
   recollection. Where it gives a `published_action` for a drug, use that action in
   drug_actions — do not substitute "Insufficient evidence". A row whose `state` is "mixed"
   means the drugs on it need DIFFERENT actions: state each drug separately. A row whose
   `state` is "none" means no published action applies there — that pair belongs in
   guidance_gaps if a decision is still needed. Each drug also carries a `published_reason`
   (the published mechanism) and each row a `recorded_reason` (what the microbiologist wrote
   on the record). Both exist to be used for the rationale — see the field guidance below.

=== RETURN STRICT JSON WITH EXACTLY THESE 10 KEYS ===
{{
  "actionable_summary": "",
  "gene_assessment": [
    {{ "gene": "", "finding": "", "implication": "", "confidence": "High | Moderate | Low" }}
  ],
  "drug_actions": [
    {{ "drug": "", "action": "", "gene": "", "rationale": "" }}
  ],
  "safety_flags": [ "" ],
  "not_analysed": [ "" ],
  "guidance_gaps": [ "" ],
  "report_note": "",
  "patient_summary": "",
  "limitations": [ "" ],
  "missing_information": [ "" ]
}}

=== "action" MUST BE COPIED VERBATIM FROM THIS LIST ===
Do not shorten, paraphrase or translate these strings. Copy the whole line.
{dose_actions}

=== THE RECORDED PHENOTYPES USE THIS VOCABULARY ===
{phenotypes}

=== FIELD GUIDANCE ===
- actionable_summary: one short paragraph — what actually matters for this patient.
- gene_assessment: one entry per recorded gene or HLA allele that carries a finding.
- drug_actions: one entry per drug whose management changes, per rules 4 and 5. Each entry
  carries the drug, its verbatim action, the gene it follows from, and a rationale.
- rationale (the fourth field of drug_actions): WHY that action, for this patient, in ONE
  sentence of at most 25 words. Give the MECHANISM, never a restatement of the action —
  "the prodrug is not converted, so the analgesic effect is lost" explains an avoid;
  "avoid codeine" does not. Take the reason from, in this order: the drug's
  `published_reason` · the row's `recorded_reason` · a recorded HLA reaction. Copy it, or
  compress it to fit the word limit without changing what it says. Where none of the three
  supplies a reason, write "Guideline-recommended action for this phenotype" and stop. Do
  NOT compose a mechanism from your own recollection: an invented reason is worse than an
  absent one, because it reads as authoritative and cannot be checked.
- gene_assessment `implication` is NOT where the reason goes. `implication` says what the
  genotype means at the gene level; `rationale` says why THIS drug's action follows from it.
  Do not write the same sentence in both.
- safety_flags: assay limitations that change how a result must be read — copy number not
  assessed (CYP2D6), HLA resolution below allele level, or a gene recorded both as a no-call and
  as carrying an action.
- not_analysed: genes that failed QC, plus panel genes that were not covered.
- guidance_gaps: gene/drug pairs where the recorded facts are insufficient to state an action and
  you therefore gave NO drug_actions entry. Name them so the microbiologist knows what still needs
  a human decision. NEVER list a pair here that also appears in drug_actions — the two sections
  are read side by side, and a drug cannot be both a decided action and an open question. To
  record uncertainty about an action you DID give, use safety_flags — not the rationale, which
  states the mechanism behind the action and nothing else.
- report_note: 2-3 factual sentences written to be used VERBATIM in the final report. State the
  genotype, the action, and what was NOT assessed. Plain and unhedged.
- patient_summary: 2-3 sentences in plain language for the patient — no jargon. The institution
  has no genetic-counselling service to explain the result to them.
- limitations: what this panel does not cover.
- missing_information: facts that would change the reading if they were present.

=== BEFORE YOU FINISH, CONFIRM EVERY ONE OF THESE 10 KEYS IS PRESENT ===
actionable_summary · gene_assessment · drug_actions · safety_flags · not_analysed ·
guidance_gaps · report_note · patient_summary · limitations · missing_information
An empty array or "" is the correct value when nothing applies. An OMITTED key is not — the
response is rejected if any key is missing.
"""

        completion = client.chat.completions.create(
            model=GLOBAL_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            # A reasoning model shares this budget between its reasoning and the
            # visible output. With no cap it can spend the whole default allowance
            # reasoning and emit nothing at all — which Groq reports as
            # json_validate_failed with an EMPTY failed_generation, not as a
            # truncation, so the error gives no clue. Sized above the Tab 12
            # advisory's 3200 because this schema asks for more: a per-gene
            # assessment AND a per-drug action list, plus ten further fields.
            #
            # 4500 rather than 4000 since the rationale sentence was added: one
            # sentence per drug, and a G6PD deficiency alone yields six drug_actions
            # entries, so the output grew by roughly a tenth. The word limit on
            # `rationale` is the other half of keeping this bound.
            max_tokens=4500,
        )
        content = completion.choices[0].message.content
        if not content:
            finish = completion.choices[0].finish_reason
            logger.error(
                f"PGx advisory returned no content for case {case_id} "
                f"(finish_reason={finish}, max_tokens=4500)"
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    f"The advisory model returned nothing (finish_reason={finish}). "
                    "If it reports 'length', raise max_tokens."
                ),
            )
        output = json.loads(content)
        if not isinstance(output, dict):
            output = {}

        return {
            "status": "success",
            "data": {
                "engine_version": f"{GLOBAL_LLM_MODEL}:micro-pgx-1.0",
                "generated_at": datetime.utcnow().isoformat(),
                **output,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"PGx advisory failed for case {case_id}: {e}")
        raise HTTPException(status_code=500, detail=f"PGx advisory failed: {e}")


# ─── Tab 1 — Registration specimen dictation structuring (AI autofill) ────────
# Converts a spoken specimen list into per-specimen row fields for Registration
# (Tab 1). Read-only / advisory: the frontend applies the result to EMPTY
# specimen-row fields only and may add new rows; nothing here writes to a case.
# The contract is deliberately specimen-row-only — case-level fields (case type,
# request, clinical context), patient data and the quality / rejection receipt
# block are never requested. These option lists mirror components/microbiology/
# constants.js so the model snaps to the same options the <Select>s can hold.

REGISTRATION_SPECIMEN_TYPES = (
    "Blood",
    "Blood culture (aerobic bottle)",
    "Blood culture (anaerobic bottle)",
    "Urine",
    "Pus / wound swab",
    "Tissue",
    "Cerebrospinal fluid (CSF)",
    "Sputum",
    "Bronchoalveolar lavage (BALF)",
    "Throat swab",
    "Fluid / aspirate",
    "Stool",
    "Duodenal aspirate",
    "Skin snip",
    "Rectal swab",
    "Genital swab",
    "Other",
)

REGISTRATION_TRANSPORT_MEDIA = (
    "Amies with charcoal",
    "Amies without charcoal",
    "Cary-Blair",
    "Stuart's medium",
    "Sterile plain container",
    "Blood culture bottle",
    "SAF preservative (stool)",
    "PVA fixative (stool)",
    "Plain unpreserved container (stool)",
    "EDTA tube (blood film)",
    "Clot tube / serum separator",
    "Transport swab (generic)",
    "Other",
)

# Stable keys persisted in specimens[].tests_ordered (see constants.js). The
# model may only pick from these; the frontend union-adds them.
REGISTRATION_TEST_KEYS = (
    "gram_stain", "afb_smear", "koh_calcofluor", "india_ink", "wet_prep",
    "ova_parasite_exam", "blood_film", "concentration_technique",
    "permanent_stain",
    "culture_aerobic", "culture_anaerobic", "blood_culture", "fungal_culture",
    "lj_mgit_culture", "ast",
    "gene_xpert", "naat_pcr", "viral_pcr", "fungal_pcr", "parasite_pcr",
    "serology_panel", "virology_serology", "fungal_antigen", "parasite_antigen",
    "hiv_hepatitis_serology", "dengue_serology",
)


class RegistrationStructurePayload(BaseModel):
    text: str


@router.post("/registration/structure")
async def structure_registration(payload: RegistrationStructurePayload):
    """
    Convert spoken Registration specimen details into per-specimen row fields.

    Advisory / read-only. Returns one entry per dictated specimen, in the order
    spoken. The Registration tab applies each entry to empty fields of a
    matching or blank specimen row, or adds a new row — nothing already entered
    is overwritten.
    """
    try:
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Dictation text is required")

        client = _groq_client()
        today = datetime.utcnow().strftime("%Y-%m-%d")
        prompt = f"""You convert a doctor's spoken specimen registration into structured JSON.
Extract ONLY what is stated in the dictation. Do not infer, invent, or fill an
unsupported field. Today's date is {today}; resolve relative phrases such as
"today", "now", "this morning", "8 am" and "yesterday 6 pm" against it. The
patient is already on the case — never produce patient data, doctor or staff
names, specimen IDs, case IDs, or dictation timestamps. Case type, requesting
clinician/department, priority and clinical context are handled elsewhere —
never include them.

Return STRICT JSON:
{{
  "specimens": [
    {{
      "specimen_type": "",
      "site_of_collection": "",
      "transport_medium": "",
      "collection_datetime": "",
      "received_datetime": "",
      "tests_ordered": []
    }}
  ]
}}

Rules:
- One array entry per specimen described, in the order it was spoken. A repeated
  specimen type (e.g. two urine samples) stays a separate entry.
- specimen_type: return an exact option string from this list, or "" when not
  stated:
  {", ".join(REGISTRATION_SPECIMEN_TYPES)}
  When the dictation is more specific than the list ("pus from the wound",
  "right knee joint"), keep the generic list option in specimen_type and put the
  detail in site_of_collection.
- site_of_collection: the stated anatomic site / line / source, or "".
- transport_medium: return an exact option string from this list, or "":
  {", ".join(REGISTRATION_TRANSPORT_MEDIA)}
- collection_datetime / received_datetime: a full local value in exactly
  YYYY-MM-DDTHH:MM when the dictation gives the date and time ("8 pm today",
  "collected this morning", "yesterday 6:30 am"); otherwise "". Never emit a
  bare time, seconds, a timezone, or a date the dictation did not state.
- tests_ordered: only the tests the doctor says were ordered, chosen exclusively
  from these stable keys: {", ".join(REGISTRATION_TEST_KEYS)}. Return [] when no
  test is stated.

DICTATION:
\"\"\"{payload.text.strip()}\"\"\"
"""
        completion = client.chat.completions.create(
            model=GLOBAL_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            max_tokens=1500,
        )
        structured = json.loads(completion.choices[0].message.content)
        if not isinstance(structured, dict):
            structured = {}
        return {"status": "success", "data": structured}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Registration dictation structuring failed: {e}")
        raise HTTPException(status_code=500, detail=f"Structuring failed: {e}")


# ─── Tab 2 — Specimen processing dictation structuring (AI autofill) ──────────
# Converts a spoken bench record for ONE specimen into that specimen's processing
# fields. The card's shape varies by the specimen's ordered tests (culture
# dispatch vs blood-culture bottle vs anaerobic jar vs parasitology slide-prep),
# so the frontend sends exactly which panels are live and which media options are
# offered on the card — its own render-time derivation — and this endpoint never
# has to guess the shape. Read-only / advisory: the frontend applies the result to
# empty fields of that one card only; nothing here writes to a case. Option
# strings mirror components/microbiology/constants.js (the Tab 2 constants).

PROCESSING_CONTAINMENT = ("Routine bench", "BSC required")
PROCESSING_INOCULATION_METHODS = (
    "Loop",
    "Swab roll",
    "Pour plate",
    "Centrifuged deposit",
    "Membrane filtration",
    "Other",
)
PROCESSING_ATMOSPHERE = ("Aerobic", "CO₂ 5%", "Anaerobic jar / chamber", "Microaerophilic")
PROCESSING_INDICATOR_COLOURS = ("Pink (oxygen-free)", "Blue / no colour change", "Not recorded")
PROCESSING_TEMPERATURES = ("35–37 °C", "30 °C", "25 °C", "35 °C", "Room temp")
PROCESSING_BLOOD_BOTTLE_TYPES = (
    "Aerobic",
    "Anaerobic",
    "Paediatric",
    "Fungal lysis-centrifugation",
)
PROCESSING_BLOOD_MONITORS = ("BacT/ALERT", "BACTEC", "Manual")
PROCESSING_PARASITE_METHODS = (
    "Formol-ether concentration (FEC)",
    "Zinc sulphate flotation",
    "Direct wet preparation (saline + iodine)",
    "Permanent stain (trichrome / iron haematoxylin)",
    "Thick blood film preparation",
    "Thin blood film preparation",
    "Giemsa staining",
    "Knott's concentration (microfilaria)",
    "Scotch tape test (Enterobius)",
    "Baermann funnel (Strongyloides)",
    "Skin snip in saline (Onchocerca)",
)
PROCESSING_SLIDE_TYPES = ("Wet prep", "Thick film", "Thin film", "Permanent stain")


class ProcessingStructurePayload(BaseModel):
    text: str
    specimen: Optional[Dict[str, Any]] = None  # { specimen_type, site_of_collection }
    panels: Dict[str, Any]  # live-card flags + media_options (the card's shape)


@router.post("/processing/structure")
async def structure_processing(payload: ProcessingStructurePayload):
    """
    Convert a spoken bench record for one specimen into that specimen's processing
    fields. The request carries the card's live panels (which sub-blocks render
    for this specimen) and the media options offered, so the model only ever sees
    the fields the card can actually hold. Advisory / read-only: the Specimen
    Processing tab applies the result to empty fields of that card only — nothing
    already entered is overwritten or cleared, and nothing here writes to a case.
    """
    try:
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Dictation text is required")

        panels = payload.panels or {}
        media_options = [
            str(m).strip()
            for m in (panels.get("media_options") or [])
            if str(m).strip()
        ]
        show_containment = bool(panels.get("containment"))
        show_media = bool(panels.get("media"))
        show_culture = bool(panels.get("culture"))
        show_blood_culture = bool(panels.get("blood_culture"))
        show_anaerobic = bool(panels.get("anaerobic"))
        show_parasitology = bool(panels.get("parasitology"))
        specimen = payload.specimen or {}

        client = _groq_client()
        today = datetime.utcnow().strftime("%Y-%m-%d")

        # JSON skeleton of exactly the keys the live panels can hold. Fields the
        # form shows in every card (processed_at, notes) are always requested.
        skeleton: Dict[str, Any] = {"processed_at": "", "notes": ""}
        if show_containment:
            skeleton["containment_level"] = ""
        if show_media:
            skeleton["media"] = []
            skeleton["media_remarks"] = ""
        if show_culture:
            skeleton["media_lot"] = ""
            skeleton["media_expiry"] = ""
            skeleton["inoculation_method"] = ""
            skeleton["atmosphere"] = ""
            skeleton["incubation_temperature"] = ""
            skeleton["incubation_started_at"] = ""
        if show_blood_culture:
            skeleton["blood_culture"] = {
                "bottle_type": "",
                "bottle_lot": "",
                "bottle_expiry": "",
                "monitor_system": "",
                "incubator_bay": "",
                "loaded_at": "",
            }
        if show_anaerobic:
            skeleton["anaerobic_indicator_lot"] = ""
            skeleton["anaerobic_indicator_colour"] = ""
        if show_parasitology:
            skeleton["parasite_prep"] = {
                "methods": [],
                "prepared_at": "",
                "slides": [{"slide_type": "", "count": ""}],
            }

        rules = [
            "Return STRICT JSON with EXACTLY the keys in the TEMPLATE — no extra keys, "
            "no missing keys. Replace each empty value with what the dictation states, "
            "keeping the value empty when it is not stated.",
            "Extract ONLY what is stated in the dictation. Do not infer, invent, or fill "
            "an unsupported field. When in doubt leave the value empty.",
        ]

        if specimen.get("specimen_type") or specimen.get("site_of_collection"):
            ctx = f"This card is for specimen: {specimen.get('specimen_type') or 'unspecified type'}"
            if specimen.get("site_of_collection"):
                ctx += f", from {specimen.get('site_of_collection')}"
            rules.append(f"{ctx}. Use it to decide which stated details belong on this record.")

        rules.append(
            "processed_at: a full local value in exactly YYYY-MM-DDTHH:MM when the "
            "dictation gives the time ('8 am today', 'processed this morning', "
            f"'yesterday 6 pm' resolve against today's date {today}); otherwise ''."
        )
        if show_containment:
            rules.append(
                "containment_level: return an exact option from "
                + ", ".join(PROCESSING_CONTAINMENT)
                + ", or '' when not stated."
            )
        if show_media:
            if media_options:
                rules.append(
                    "media: only the media the technologist states were inoculated, chosen "
                    "exclusively from these offered options: "
                    + ", ".join(media_options)
                    + ". Return [] when none is stated."
                )
            rules.append(
                "media_remarks: a verbatim short phrase from the dictation for other / "
                "extra media, or '' when none is stated."
            )
        if show_culture:
            rules.append(
                "media_lot: transcribe a stated media lot number as-is (a single code "
                "without spaces), or '' when not stated."
            )
            rules.append(
                "media_expiry: a date in exactly YYYY-MM-DD when the dictation gives one "
                f"('expires today', 'expiry 30 June' resolve against today {today}); "
                "otherwise ''."
            )
            rules.append(
                "inoculation_method: an exact option from "
                + ", ".join(PROCESSING_INOCULATION_METHODS)
                + ", or '' when not stated."
            )
            rules.append(
                "atmosphere: an exact option from "
                + ", ".join(PROCESSING_ATMOSPHERE)
                + ", or '' when not stated."
            )
            rules.append(
                "incubation_temperature: an exact option from "
                + ", ".join(PROCESSING_TEMPERATURES)
                + ", or '' when not stated."
            )
            rules.append(
                "incubation_started_at: YYYY-MM-DDTHH:MM when the dictation gives the "
                "datetime ('started 9:30'), otherwise ''."
            )
        if show_anaerobic:
            rules.append(
                "anaerobic_indicator_lot: transcribe a stated indicator-strip lot number "
                "as-is (a single code without spaces), or '' when not stated."
            )
            rules.append(
                "anaerobic_indicator_colour: an exact option from "
                + ", ".join(PROCESSING_INDICATOR_COLOURS)
                + ", or '' when not stated."
            )
        if show_blood_culture:
            rules.append(
                "blood_culture.bottle_type: an exact option from "
                + ", ".join(PROCESSING_BLOOD_BOTTLE_TYPES)
                + ", or '' when not stated."
            )
            rules.append(
                "blood_culture.bottle_lot: transcribe a stated bottle lot number as-is "
                "(a single code without spaces), or '' when not stated."
            )
            rules.append(
                "blood_culture.bottle_expiry: a date in exactly YYYY-MM-DD when the "
                f"dictation gives one (resolve against today {today}); otherwise ''."
            )
            rules.append(
                "blood_culture.monitor_system: an exact option from "
                + ", ".join(PROCESSING_BLOOD_MONITORS)
                + ", or '' when not stated."
            )
            rules.append(
                "blood_culture.incubator_bay: a short bay / position code as stated, or ''."
            )
            rules.append(
                "blood_culture.loaded_at: YYYY-MM-DDTHH:MM when stated, otherwise ''."
            )
        if show_parasitology:
            rules.append(
                "parasite_prep.methods: only the stated preparation method(s), chosen "
                "exclusively from "
                + ", ".join(PROCESSING_PARASITE_METHODS)
                + ". Return [] when none is stated."
            )
            rules.append(
                "parasite_prep.slides: the template's single slide is a schema hint, not a "
                "required row — return one object per slide stated (in the order spoken), "
                "each with slide_type an exact option from "
                + ", ".join(PROCESSING_SLIDE_TYPES)
                + " and count a bare number or '' when not given. Return [] when no slide "
                "is stated."
            )
        rules.append(
            "notes: a verbatim short phrase from the dictation (condition flags, odour, "
            "contamination), or '' when nothing is stated. Never compose new content."
        )
        rules.append(
            "Never return patient data, doctor or staff names (tech / performed-by fields "
            "stay manual — identity belongs to the application), specimen/case IDs, or "
            "recording timestamps."
        )

        prompt = (
            "You convert a technologist's spoken bench record for a single specimen into "
            "structured JSON for the lab's specimen-processing form.\n"
            f"Today's date is {today}.\n\n"
            "TEMPLATE (return exactly this JSON shape, values filled or left empty):\n"
            + json.dumps(skeleton, ensure_ascii=False, indent=2)
            + "\n\nRULES:\n- "
            + "\n- ".join(rules)
            + f"\n\nDICTATION:\n\"\"\"{payload.text.strip()}\"\"\""
        )

        completion = client.chat.completions.create(
            model=GLOBAL_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            max_tokens=1600,
        )
        structured = json.loads(completion.choices[0].message.content)
        if not isinstance(structured, dict):
            structured = {}
        return {"status": "success", "data": structured}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Specimen processing dictation structuring failed: {e}")
        raise HTTPException(status_code=500, detail=f"Structuring failed: {e}")


# ─── Tab 3 — Direct Exam dictation structuring (AI autofill) ──────────────────
# Converts a spoken microscopy finding for ONE specimen into that specimen's
# Direct Exam rows. A specimen can carry several exam types, so one dictation may
# describe several reads: the Direct Examination tab routes each entry to an
# existing exam row of the same type that still has room, else adds a NEW exam
# row of that type (fill-empty-only; nothing overwritten or cleared). The request
# carries the offered exam types and each type's config-driven result fields
# (keys/kinds/option lists) — the same config the card renders itself — so the
# model only ever returns exam types/fields the card can hold. Option strings
# mirror components/microbiology/constants.js (DIRECT_EXAM_TYPES). Read-only /
# advisory: nothing here writes to a case.

class DirectExamStructurePayload(BaseModel):
    text: str
    specimen: Optional[Dict[str, Any]] = None  # { specimen_type, site_of_collection }
    exam_schema: List[Dict[str, Any]]  # offered exam types: exam_type/label/prep/fields


def _render_exam_schema_guide(exam_schema: List[Dict[str, Any]]) -> List[str]:
    """Human-readable field rules for each offered exam type, built from the card's
    config so the model only targets keys/options the card can hold."""
    guide = []
    for s in exam_schema:
        name = str(s.get("exam_type") or "").strip()
        if not name:
            continue
        label = str(s.get("label") or "").strip()
        prep = str(s.get("prep") or "").strip()
        header = name
        if label:
            header += f" ('{label}'"
            header += f", '{prep}')" if (prep and prep != label) else ")"
        lines = []
        for f in s.get("fields") or []:
            if not isinstance(f, dict) or not f.get("key"):
                continue
            fkey = str(f.get("key"))
            flabel = str(f.get("label") or fkey)
            kind = str(f.get("kind") or "text")
            options = [str(o) for o in (f.get("options") or []) if str(o).strip()]
            if kind in ("select", "radio"):
                desc = ("one exact option from " + ", ".join(options)) if options else "a short verbatim phrase"
                lines.append(f"- key \"{fkey}\" ({flabel}): {desc}, or '' when not stated.")
            elif kind == "multiselect":
                desc = ("only the stated item(s), each an exact option from " + ", ".join(options)) if options else "only the stated item(s)"
                lines.append(f"- key \"{fkey}\" ({flabel}): an array of {desc}; [] when none is stated.")
            else:
                lines.append(f"- key \"{fkey}\" ({flabel}): a verbatim short phrase from the dictation, or '' when nothing is stated. Never compose new content.")
        guide.append(header + " — allowed result keys:\n" + "\n".join(lines))
    return guide


@router.post("/direct-exam/structure")
async def structure_direct_exam(payload: DirectExamStructurePayload):
    """
    Convert a spoken microscopy finding for one specimen into that specimen's
    Direct Exam rows. The request carries the offered exam types and their
    config-driven field lists (keys/kinds/option lists — the same config the card
    renders), so the model only ever returns exam types/fields the card can hold.
    Advisory / read-only: the Direct Examination tab fills empty fields only and
    adds a new exam row for a dictated type that has none — nothing already
    entered is overwritten or cleared, and nothing here writes to a case.
    """
    try:
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Dictation text is required")

        schema = [
            s for s in (payload.exam_schema or [])
            if isinstance(s, dict) and str(s.get("exam_type") or "").strip()
        ]
        if not schema:
            raise HTTPException(status_code=400, detail="exam_schema is required")

        client = _groq_client()
        today = datetime.utcnow().strftime("%Y-%m-%d")
        guide = _render_exam_schema_guide(schema)

        specimen = payload.specimen or {}
        ctx = ""
        if specimen.get("specimen_type") or specimen.get("site_of_collection"):
            ctx = f"This card is for specimen {specimen.get('specimen_type') or 'unspecified type'}"
            if specimen.get("site_of_collection"):
                ctx += f", from {specimen.get('site_of_collection')}"
            ctx += ".\nUse it only to anchor context.\n"

        rules = [
            'Return STRICT JSON shaped like {"quality_comment": "", "exams": [ {"exam_type": "", "examined_at": "", "result": {}} ]}.',
            "exams: one object per slide read the dictation describes, in the order spoken. Return [] when no exam is described.",
            "exam_type: the exact value of the exam the dictation names, chosen ONLY from the "
            "offered types below. Map everyday names to them ('gram stain' -> gram_stain; "
            "'ZN'/'auramine' -> afb_smear; 'KOH'/'calcofluor' -> koh; 'india ink' -> india_ink; "
            "'wet prep' -> wet_prep; 'stool ova and parasites'/'O&P' -> stool_opa; "
            "'concentration' -> concentration; 'trichrome'/'iron haematoxylin' -> permanent_stain; "
            "'thick film' -> thick_film; 'thin film' -> thin_film; 'knotts'/'membrane filtration' "
            "-> knotts). Skip any exam the dictation names that is not offered.",
            "result: an object holding that exam type's findings. Use only keys from THAT exam "
            "type's allowed set (shown below) that the dictation actually states, each following "
            "that key's rule. Use the BARE key name inside 'result' ('pus_cells', 'morphology'), "
            "never a dotted 'result.pus_cells'. Never mix in keys of another exam type, and never "
            "invent a key or value.",
            "examined_at: a full local value in exactly YYYY-MM-DDTHH:MM when the dictation gives "
            f"a read time ('read at 10:30', 'this morning' — resolve relative phrases against "
            f"today {today}); otherwise ''.",
            "quality_comment: an explicit specimen quality / adequacy phrase ('salivary, "
            "suboptimal', 'specimen adequate', 'contaminated') when the dictation states one, "
            "else ''.",
            "Extract ONLY what is stated in the dictation. Do not infer, invent, or fill an "
            "unsupported field. When in doubt leave the value empty.",
            "Never return patient data, doctor or staff names (the tech field stays manual — "
            "identity belongs to the application), specimen/case IDs, or exam IDs.",
        ]

        prompt = (
            "You convert a technologist's spoken microscopy finding for one specimen into "
            "structured JSON for the lab's direct-examination form.\n"
            f"Today's date is {today}.\n\n"
            "OFFERED EXAM TYPES AND THE RESULT KEYS EACH CAN HOLD:\n"
            + "\n\n".join(guide)
            + "\n\n"
            + (ctx or "No specimen context was provided.\n")
            + "\nRULES:\n- "
            + "\n- ".join(rules)
            + f"\n\nDICTATION:\n\"\"\"{payload.text.strip()}\"\"\""
        )

        completion = client.chat.completions.create(
            model=GLOBAL_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            max_tokens=1800,
        )
        structured = json.loads(completion.choices[0].message.content)
        if not isinstance(structured, dict):
            structured = {}
        return {"status": "success", "data": structured}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Direct exam dictation structuring failed: {e}")
        raise HTTPException(status_code=500, detail=f"Structuring failed: {e}")


# ─── Tab 12 — Antimicrobial & stewardship commentary dictation structuring (AI autofill) ──
# Converts the spoken antimicrobial / stewardship commentary into the section's
# free-text fields for the case-level interpretation (Tab 12). Unlike the
# specimen-keyed structure endpoints above, there is no record shape to derive —
# the section is entirely free text — so only the raw dictation is sent and the
# model returns exactly the two sub-objects the section holds. Read-only /
# advisory: the Interpretation tab fills the section's EMPTY fields only;
# nothing here writes to a case.


class AntimicrobialCommentaryStructurePayload(BaseModel):
    text: str


@router.post("/antimicrobial-commentary/structure")
async def structure_antimicrobial_commentary(payload: AntimicrobialCommentaryStructurePayload):
    """
    Convert spoken Antimicrobial & stewardship commentary (Tab 12) into the
    section's free-text fields.

    Advisory / read-only. Returns the two sub-objects the section holds —
    antimicrobial (recommended / avoid / de_escalation / clsi_reference) and
    cascade_confirm.note — each field present but "" when the dictation did not
    state it. The Interpretation tab fills the section's empty fields only;
    nothing already entered is overwritten.
    """
    try:
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Dictation text is required")

        client = _groq_client()
        today = datetime.utcnow().strftime("%Y-%m-%d")
        prompt = f"""You convert a microbiologist's spoken antimicrobial & stewardship commentary
into structured JSON for the clinical-interpretation form.
Extract ONLY what the dictation states. Do not infer, invent, or add any clinical
advice the dictation does not support, and leave a field "" when it is not spoken.
Today's date is {today}. The section is free text only — never produce patient data,
doctor or staff names, organism rows, specimen/case IDs, or dictation timestamps.

Return STRICT JSON:
{{
  "antimicrobial": {{
    "recommended": "",
    "avoid": "",
    "de_escalation": "",
    "clsi_reference": ""
  }},
  "cascade_confirm": {{
    "note": ""
  }}
}}

Field guidance:
- recommended: the drug(s) + dose suggestion the dictation recommends, or "".
- avoid: drugs to avoid (resistance / allergy), or "".
- de_escalation: the stated de-escalation / step-down note, or "".
- clsi_reference: a CLSI M100 / local antibiogram reference only when stated, or "".
- cascade_confirm.note: any cascade-suppression confirmation / override note, or "".

DICTATION:
\"\"\"{payload.text.strip()}\"\"\"
"""
        completion = client.chat.completions.create(
            model=GLOBAL_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            max_tokens=1000,
        )
        structured = json.loads(completion.choices[0].message.content)
        if not isinstance(structured, dict):
            structured = {}
        return {"status": "success", "data": structured}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Antimicrobial commentary dictation structuring failed: {e}")
        raise HTTPException(status_code=500, detail=f"Structuring failed: {e}")


# ─── Tab 15 — Pathogen genomics dictation structuring (AI autofill) ───────────
# Converts a spoken sequencing result into ONE Pathogen Genomics sub-tab's
# record. The request names the sub-tab (wgs / mngs / tngs / targeted), so the
# model is given only that panel's key guide and can never cross-wire WGS keys
# into tNGS; for the targeted sub-tab it also carries the panels the specimen
# actually ordered, so it can never invent a panel the card cannot offer.
#
# Never returned, by design:
#   • the DERIVED fields — tb_classification, tb_resistance_classification,
#     heteroresistance, panel_kind — are recomputed by the frontend from the rows
#     it just merged, exactly as the panel recomputes them on manual entry;
#   • the submitting technologist's name (staff identity belongs to the
#     application) and the advisory regimen note (button-driven, never
#     auto-written onto the record);
#   • every order / row / hit / call ID, and `prelim`.
#
# Option strings mirror components/microbiology/constants.js — including the
# lists the panels declare through it (the targeted methods, the mNGS taxon
# ranks, the prior-aNAAT result and rifampicin-resistance options) — plus the
# three-state QC answer from tabs/genomics/fields.jsx. Keep them in step.
#
# Read-only / advisory: the tab fills EMPTY fields of the active sub-tab's record
# only and appends a row for a dictated determinant that has none — nothing
# already entered is overwritten or cleared, and nothing here writes to a case.

GENOMICS_SUBTAB_KEYS = ("wgs", "mngs", "tngs", "targeted")

GENOMICS_PLATFORMS = (
    "Illumina MiSeq",
    "Illumina NextSeq",
    "Illumina NovaSeq",
    "Oxford Nanopore MinION",
    "Oxford Nanopore Flongle",
    "Oxford Nanopore GridION",
    "Ion Torrent Genexus",
    "Other",
)
GENOMICS_SEQUENCING_LABS = (
    "In-house",
    "MedGenome",
    "Strand Life Sciences",
    "Rajiv Gandhi Centre for Biotechnology (RGCB)",
    "NCBS Bangalore",
    "NIBMG Kolkata",
    "External — other",
)
GENOMICS_WGS_PIPELINES = (
    "TBProfiler",
    "Mykrobe",
    "Bactopia",
    "Snippy",
    "Galaxy",
    "Dragonflye (Nanopore)",
    "Custom in-house pipeline",
)
GENOMICS_MNGS_PIPELINES = (
    "CZ ID (Chan Zuckerberg IDseq)",
    "Kraken2 + Bracken",
    "MetaPhlAn4",
    "Kaiju",
    "Custom in-house pipeline",
)
GENOMICS_TNGS_ASSAYS = (
    "Deeplex Myc-TB",
    "Genoscholar NTM+MDRTB II (Nipro)",
    "In-house amplicon panel",
    "Other",
)
GENOMICS_SPECIMEN_INPUTS = ("Pure culture isolate", "Direct specimen", "Culture broth")
GENOMICS_ID_RESOLUTION = ("Species", "Genus", "Complex", "Unresolved")
GENOMICS_ID_CONFIDENCE = (
    "High (≥99% identity)",
    "Moderate (90–99% identity)",
    "Low (<90% identity)",
    "Unresolved",
)
GENOMICS_ID_TOOLS = (
    "Kraken2",
    "MASH",
    "MLST",
    "MALDI-TOF confirmed",
    "BLAST / reference alignment",
    "Other",
)
GENOMICS_TYPING_SCHEMES = (
    "MLST (PubMLST)",
    "cgMLST",
    "wgMLST",
    "spa typing",
    "SCCmec",
    "SNP-distance",
    "Ribotype",
    "Clade assignment",
    "Other",
)
GENOMICS_AMR_DATABASES = (
    "CARD",
    "ResFinder",
    "PointFinder",
    "AMRFinderPlus",
    "WHO TB Mutation Catalogue v2 (2023)",
    "MEGARes",
    "Other",
)
GENOMICS_RESISTANCE_CLASSES = (
    "Beta-lactam",
    "Carbapenem",
    "Glycopeptide",
    "Fluoroquinolone",
    "Aminoglycoside",
    "Macrolide",
    "Tetracycline",
    "Oxazolidinone",
    "Rifamycin",
    "Isoniazid",
    "Folate pathway",
    "Colistin",
    "Daptomycin",
    "Echinocandin",
    "Azole",
    "Other",
)
GENOMICS_RESISTANCE_MECHANISMS = (
    "Enzymatic inactivation",
    "Target alteration / mutation",
    "Efflux pump overexpression",
    "Outer membrane porin loss",
    "Target bypass",
    "Ribosomal protection",
    "Unknown",
)
GENOMICS_CALL_CONFIDENCE = (
    "High (>95% identity, >90% coverage)",
    "Moderate (80–95% identity or 70–90% coverage)",
    "Low (<80% identity or <70% coverage)",
)
GENOMICS_PREDICTED_PHENOTYPES = (
    "Resistant",
    "Susceptible",
    "Intermediate",
    "Uncertain significance",
)
GENOMICS_CONCORDANCE = (
    "Concordant",
    "Discordant — genotype resistant, phenotype susceptible",
    "Discordant — genotype susceptible, phenotype resistant",
    "Partial — see note",
    "Not done",
)
GENOMICS_WHO_CONFIDENCE_GROUPS = (
    "Group 1 — Associated with resistance",
    "Group 2 — Associated with resistance (interim)",
    "Group 3 — Uncertain significance",
    "Group 4 — Not associated with resistance (interim)",
    "Group 5 — Not associated with resistance",
)
GENOMICS_VIRULENCE_CATEGORIES = (
    "Toxin",
    "Adhesin",
    "Invasin",
    "Capsule",
    "Siderophore",
    "Immune evasion",
    "Other",
)
GENOMICS_EPI_LINKS = (
    "Confirmed — linked to known cluster",
    "Possible — within SNP threshold",
    "No epidemiological link",
    "Under investigation",
)
GENOMICS_TB_DRUG_PANEL = (
    "Isoniazid",
    "Rifampicin",
    "Pyrazinamide",
    "Ethambutol",
    "Levofloxacin",
    "Moxifloxacin",
    "Bedaquiline",
    "Linezolid",
    "Clofazimine",
    "Cycloserine / Terizidone",
    "Delamanid",
    "Pretomanid",
    "Imipenem-cilastatin",
    "Meropenem",
    "Amikacin",
    "Streptomycin",
    "Kanamycin",
    "Capreomycin",
    "Ethionamide / Prothionamide",
    "PAS",
)
GENOMICS_MNGS_KINGDOMS = ("Bacteria", "Virus", "Fungi", "Parasite", "Unknown")
GENOMICS_MNGS_BACKGROUND = (
    "Significantly above background",
    "Borderline — review in clinical context",
    "Below background threshold — likely contaminant",
)
GENOMICS_MNGS_SIGNIFICANCE = (
    "Definite pathogen",
    "Likely pathogen",
    "Commensal / contaminant",
    "Unknown",
)
GENOMICS_MNGS_INPUTS = ("DNA only", "RNA only", "Total nucleic acid (DNA + RNA)")
GENOMICS_HOST_DEPLETION = ("Yes — saponin / methylation", "Yes — other method", "No")
GENOMICS_AMPLICON_TARGETS = (
    "16S rRNA — V1–V3",
    "16S rRNA — V3–V4",
    "16S rRNA — V4",
    "16S rRNA — full length",
    "ITS1",
    "ITS2",
    "Other",
)
GENOMICS_AMPLICON_DATABASES = ("SILVA", "Greengenes", "UNITE (ITS)", "EzBioCloud", "Other")
GENOMICS_TAXON_RANKS = ("Species", "Genus", "Family", "Order", "Other")
GENOMICS_METHODS = (
    "Amplicon sequencing (NGS)",
    "Sanger sequencing",
    "Allele-specific real-time PCR",
    "Line probe assay",
    "Other",
)
# The three-state QC answer (tabs/genomics/fields.jsx YES_NO). "Not recorded" is
# distinct from "No": a QC step that was never run is not one that failed.
GENOMICS_QC_PASS = ("Yes", "No", "Not recorded")
GENOMICS_PRIOR_ANAAAT_RESULTS = ("MTB not detected", "MTB detected", "Invalid", "Not done")
GENOMICS_PRIOR_ANAAAT_RIF = (
    "Rifampicin resistance not detected",
    "Rifampicin resistance detected",
    "Indeterminate",
    "Not done",
)


def _opts(options) -> str:
    """An option list as one prompt line."""
    return " | ".join(options)


def _dictation_rules(derived_note: str) -> List[str]:
    """The rules every dictation structure endpoint states, plus that endpoint's
    own note on which fields are derived and must never be returned. Shared by
    the Tab 15 and Tab 16 structuring endpoints below, so the contract a
    transcript is held to cannot drift between the module's two big forms."""
    return [
        "Extract ONLY what is stated in the dictation. Do not infer, invent, or fill an "
        "unsupported field, and never compose new prose where a verbatim phrase is asked "
        "for. When in doubt leave the value empty.",
        "Every key is returned, with \"\" (or [] for an array) when the dictation does not "
        "state it. Never omit a key, never add one that is not listed.",
        "Never return the submitting technologist's name, patient data, or doctor / staff "
        "names (identity belongs to the application), specimen / case / order / row IDs, "
        "or dictation timestamps.",
        derived_note,
    ]


def _genomics_key_guide(sub_tab: str, panels: List[Dict[str, Any]]) -> str:
    """The per-key guide for one sub-tab: every field the model may return, with
    its rule and the exact option strings for an enum. Only keys the panel can
    actually hold are offered."""
    if sub_tab == "wgs":
        return "\n".join([
            "ORDER, RUN & SPECIMEN",
            '- "submitted_at", "result_received_at": YYYY-MM-DDTHH:MM, else "".',
            f'- "specimen_input": one of {_opts(GENOMICS_SPECIMEN_INPUTS)}.',
            f'- "platform": one of {_opts(GENOMICS_PLATFORMS)}.',
            '- "run_id": the run / flowcell identifier exactly as dictated, else "".',
            f'- "sequencing_lab": one of {_opts(GENOMICS_SEQUENCING_LABS)}.',
            '- "sequencing_lab_ref": the external laboratory\'s own reference, else "".',
            '- "result_file_ref": a file or report reference the dictation names, else "".',
            "SAMPLE QC",
            '- "dna_extraction_method": a short verbatim phrase, else "".',
            '- "dna_concentration": the bare number in ng/µL, no unit, else "".',
            '- "a260_280": the bare ratio (e.g. "1.9"), else "".',
            f'- "extraction_qc_pass": one of {_opts(GENOMICS_QC_PASS)}.',
            "PIPELINE & ASSEMBLY QC",
            f'- "pipeline_name": one of {_opts(GENOMICS_WGS_PIPELINES)}.',
            '- "pipeline_version": the version string exactly as dictated, else "".',
            '- "reference_genome": the reference used, else "".',
            f'- "assembly_qc_pass": one of {_opts(GENOMICS_QC_PASS)}.',
            '- "total_reads", "reads_after_qc": the bare number of reads, else "".',
            '- "mean_coverage": the bare depth in x, no unit, else "".',
            '- "coverage_breadth_pct": the bare percentage number, else "".',
            '- "assembly_qc_note": a verbatim phrase (borderline / fail reason), else "".',
            "IDENTIFICATION",
            '- "identified_species": the organism exactly as dictated, genus + species, else "".',
            f'- "id_resolution": one of {_opts(GENOMICS_ID_RESOLUTION)}.',
            f'- "identification_confidence": one of {_opts(GENOMICS_ID_CONFIDENCE)}.',
            f'- "id_tool": one of {_opts(GENOMICS_ID_TOOLS)}.',
            '- "id_tool_version": the version string exactly as dictated, else "".',
            "STRAIN TYPING",
            '- "sequence_type": e.g. "ST131", else "".',
            f'- "mlst_scheme": one of {_opts(GENOMICS_TYPING_SCHEMES)}.',
            '- "clonal_complex": e.g. "CC8", else "".',
            '- "lineage": the MTBC lineage, e.g. "L2.2 (Beijing)", else "".',
            '- "spa_type", "sccmec", "serotype", "clade": the value exactly as dictated, else "".',
            "RESISTANCE, VIRULENCE & PLASMIDS (one array entry per determinant)",
            '- "resistance_genes": objects with "gene_name" (e.g. "blaNDM-1", "mecA", '
            '"rpoB S450L"), "gene_class" (one of ' + _opts(GENOMICS_RESISTANCE_CLASSES) + '), '
            '"mechanism" (one of ' + _opts(GENOMICS_RESISTANCE_MECHANISMS) + '), '
            '"database_source" (one of ' + _opts(GENOMICS_AMR_DATABASES) + '), '
            '"database_version", "identity_pct", "coverage_pct" (bare numbers), '
            '"predicted_phenotype" (one of ' + _opts(GENOMICS_PREDICTED_PHENOTYPES) + '), '
            '"confidence" (one of ' + _opts(GENOMICS_CALL_CONFIDENCE) + '), and '
            '"drug_targets" (an array of the drug names the determinant is predicted to '
            'affect). One entry per determinant named.',
            '- "virulence_genes": objects with "gene_name" (e.g. "stx2", "tcdB"), '
            '"category" (one of ' + _opts(GENOMICS_VIRULENCE_CATEGORIES) + '), "note".',
            '- "plasmid_replicons": objects with "name" (e.g. "IncFII", "IncX3") and "note".',
            "TB DRUG PROFILE (only when the dictation describes TB drug resistance)",
            '- "tb_who_catalogue_version": the catalogue version, else "".',
            '- "tb_drug_resistance_profile": objects with "drug" (one of '
            + _opts(GENOMICS_TB_DRUG_PANEL) + '), "mutation" (e.g. "katG S315T"), '
            '"who_confidence" (one of ' + _opts(GENOMICS_WHO_CONFIDENCE_GROUPS) + '), '
            '"predicted_phenotype" (one of ' + _opts(GENOMICS_PREDICTED_PHENOTYPES) + '). '
            'One entry per drug named. Do NOT return the derived TB classification.',
            "GENOTYPE vs PHENOTYPE, EPIDEMIOLOGY & SUMMARY",
            f'- "genotype_phenotype_concordance": one of {_opts(GENOMICS_CONCORDANCE)}.',
            '- "concordance_note": a verbatim phrase, else "".',
            '- "cluster_id", "cluster_snp_distance": exactly as dictated, else "".',
            f'- "cluster_tool": one of {_opts(GENOMICS_TYPING_SCHEMES)}.',
            f'- "epidemiological_link": one of {_opts(GENOMICS_EPI_LINKS)}.',
            '- "outbreak_note": a verbatim phrase, else "".',
            '- "genomic_summary": the summary ONLY if the dictation speaks one, copied '
            'verbatim. Never compose a summary of your own — leave it "" otherwise.',
        ])

    if sub_tab == "mngs":
        return "\n".join([
            "SPECIMEN & LIBRARY PREP",
            f'- "specimen_type": one of {_opts(REGISTRATION_SPECIMEN_TYPES)}.',
            f'- "input_type": one of {_opts(GENOMICS_MNGS_INPUTS)}.',
            f'- "host_depletion": one of {_opts(GENOMICS_HOST_DEPLETION)}.',
            '- "submitted_at", "result_received_at": YYYY-MM-DDTHH:MM, else "".',
            "SEQUENCING & PIPELINE QC",
            f'- "platform": one of {_opts(GENOMICS_PLATFORMS)}.',
            f'- "sequencing_lab": one of {_opts(GENOMICS_SEQUENCING_LABS)}.',
            '- "sequencing_lab_ref", "result_file_ref": exactly as dictated, else "".',
            f'- "pipeline_name": one of {_opts(GENOMICS_MNGS_PIPELINES)}.',
            '- "pipeline_version": the version string exactly as dictated, else "".',
            '- "total_reads", "reads_after_qc", "non_host_reads": the bare number of '
            'reads, else "".',
            '- "host_reads_pct": the bare percentage number, else "".',
            "ORGANISM HITS (one array entry per reported hit)",
            '- "organism_hits": objects with "taxon_name" (genus + species or the rank '
            'named), "taxon_rank" (one of ' + _opts(GENOMICS_TAXON_RANKS) + '), '
            '"kingdom" (one of ' + _opts(GENOMICS_MNGS_KINGDOMS) + '), "rpm", '
            '"nt_coverage", "nr_coverage" (bare numbers), "background_model" (one of '
            + _opts(GENOMICS_MNGS_BACKGROUND) + '), "clinical_significance" (one of '
            + _opts(GENOMICS_MNGS_SIGNIFICANCE) + '), "significance_note" (a verbatim '
            'phrase). Only the hits the dictation actually reports — the full run output '
            'is reviewed at the bench.',
            "VIRUS HITS (one array entry per reported virus)",
            '- "virus_hits": objects with "virus_name", "genome_coverage_pct", '
            '"mean_depth" (bare numbers), "antiviral_resistance_markers" (an array of the '
            'markers named, each verbatim, e.g. "M184V"), "clinical_note" (a verbatim '
            'phrase).',
            "AMR GENES (one array entry per gene)",
            '- "amr_genes_detected": objects with "gene_name", "gene_class" (one of '
            + _opts(GENOMICS_RESISTANCE_CLASSES) + '), "mechanism" (one of '
            + _opts(GENOMICS_RESISTANCE_MECHANISMS) + '), "database_source" (one of '
            + _opts(GENOMICS_AMR_DATABASES) + '), "card_version", "predicted_phenotype" '
            '(one of ' + _opts(GENOMICS_PREDICTED_PHENOTYPES) + '), "note". These genes '
            'come from the total microbial reads and cannot be attributed to one '
            'organism — do not state an attribution the dictation does not make.',
            "INTERPRETATION",
            '- "interpretation_note": the assessment ONLY if the dictation speaks one, '
            'copied verbatim. Never compose one — leave it "" otherwise.',
        ])

    if sub_tab == "tngs":
        return "\n".join([
            "ORDER, RUN & SPECIMEN",
            '- "submitted_at", "result_received_at": YYYY-MM-DDTHH:MM, else "".',
            f'- "specimen_input": one of {_opts(GENOMICS_SPECIMEN_INPUTS)}.',
            f'- "platform": one of {_opts(GENOMICS_PLATFORMS)}.',
            f'- "sequencing_lab": one of {_opts(GENOMICS_SEQUENCING_LABS)}.',
            '- "sequencing_lab_ref", "result_file_ref": exactly as dictated, else "".',
            "PRIOR NUCLEIC-ACID TEST (the WHO pathway runs tNGS after one)",
            '- "prior_genexpert": an object with "result" (one of '
            + _opts(GENOMICS_PRIOR_ANAAAT_RESULTS) + '), "rif_resistance" (one of '
            + _opts(GENOMICS_PRIOR_ANAAAT_RIF) + '), "performed_at" (YYYY-MM-DDTHH:MM). '
            'Fill it only from the dictation — it is never copied from another tab.',
            "ASSAY, PIPELINE & QC",
            f'- "assay_name": one of {_opts(GENOMICS_TNGS_ASSAYS)}.',
            '- "assay_version": the version string exactly as dictated, else "".',
            f'- "pipeline_name", "lineage_tool": one of {_opts(GENOMICS_WGS_PIPELINES)}.',
            '- "pipeline_version": the version string exactly as dictated, else "".',
            '- "mean_depth_coverage": the bare depth in x, no unit, else "".',
            '- "loci_above_threshold_pct": the bare percentage number, else "".',
            f'- "qc_pass": one of {_opts(GENOMICS_QC_PASS)}.',
            '- "qc_note": a verbatim phrase, else "".',
            "DRUG RESISTANCE CALLS (one array entry per drug called)",
            '- "drug_resistance_calls": objects with "drug" (one of '
            + _opts(GENOMICS_TB_DRUG_PANEL) + '), "mutations_detected" (an array of the '
            'mutations named for that drug, each verbatim, e.g. "rpoB S450L"), '
            '"who_confidence_tier" (one of ' + _opts(GENOMICS_WHO_CONFIDENCE_GROUPS) + '), '
            '"predicted_phenotype" (one of ' + _opts(GENOMICS_PREDICTED_PHENOTYPES) + '), '
            '"vaf_pct" (the bare percentage number when a variant allele frequency is '
            'stated, else ""). Do NOT return heteroresistance or the TB classification — '
            'the application derives both from these rows.',
            "LINEAGE & CONCORDANCE",
            '- "lineage": the MTBC lineage, e.g. "L2.2 (Beijing)", else "".',
            f'- "concordance_with_phenotypic_dst": one of {_opts(GENOMICS_CONCORDANCE)}.',
            '- "concordance_note": a verbatim phrase, else "".',
        ])

    if sub_tab == "targeted":
        lines = [
            "The targeted sub-tab holds one ORDER per panel, so return an \"orders\" "
            "array with one entry per panel the dictation describes.",
            "Each entry's \"panel\" must be the exact value of one of the panels offered "
            "below — the panel decides which result shape that entry carries. Never "
            "return a panel that is not listed.",
            "OFFERED PANELS",
        ]
        for p in panels or []:
            value = str(p.get("value") or "").strip()
            if not value:
                continue
            label = str(p.get("label") or "").strip()
            kind = str(p.get("kind") or "").strip()
            lines.append(f'- "{value}" ({label}, kind {kind})')
        lines += [
            "PER-ORDER FIELDS (every entry)",
            f'- "method": one of {_opts(GENOMICS_METHODS)}.',
            f'- "platform": one of {_opts(GENOMICS_PLATFORMS)}.',
            f'- "sequencing_lab": one of {_opts(GENOMICS_SEQUENCING_LABS)}.',
            '- "submitted_at": YYYY-MM-DDTHH:MM, else "".',
            f'- "pipeline_name": one of {_opts(GENOMICS_WGS_PIPELINES)}.',
            '- "pipeline_version": the version string exactly as dictated, else "".',
            '- "mean_depth_coverage": the bare depth in x, no unit, else "".',
            f'- "qc_pass": one of {_opts(GENOMICS_QC_PASS)}.',
            '- "qc_note", "result_file_ref": verbatim, else "".',
            '- "interpretation_note": the assessment ONLY if the dictation speaks one, '
            'copied verbatim. Never compose one — leave it "" otherwise.',
            "RESULT — the shape follows the panel's kind",
            '- kind "resistance": "loci_targeted" (an array of the loci named), and '
            '"mutation_rows" — one entry per marker with "locus", "mutation" (e.g. '
            '"S450L"), "drug" (an exact option from that panel\'s drug list, shown '
            'below), "predicted_phenotype" (one of ' + _opts(GENOMICS_PREDICTED_PHENOTYPES)
            + '), "confidence" (one of ' + _opts(GENOMICS_CALL_CONFIDENCE) + '), "note".',
            '- kind "identity": "loci_targeted" holding the ONE amplicon target (an exact '
            'option from ' + _opts(GENOMICS_AMPLICON_TARGETS) + '), "reference_database" '
            '(one of ' + _opts(GENOMICS_AMPLICON_DATABASES) + '), and "taxa_rows" — one '
            'entry per taxon with "taxon_name", "rank" (genus / species), '
            '"identity_pct" (a bare number), "note". An identity panel reports NO '
            'resistance information — never return mutation rows for one.',
            '- kind "typing": "typing" — an object with "scheme" (one of '
            + _opts(GENOMICS_TYPING_SCHEMES) + '), "type_result" (e.g. "t002", '
            '"ribotype 027", "clade I"), "cluster_id", "snp_distance". A typing result '
            'is a strain label for infection control, not a resistance call.',
        ]
        per_panel = [
            f'- "{str(p.get("value"))}": drugs — '
            + (_opts([str(d) for d in (p.get("drugs") or [])]) or "(none)")
            + "; loci — " + (", ".join(str(x) for x in (p.get("loci") or [])) or "(none)")
            for p in (panels or []) if str(p.get("value") or "").strip()
        ]
        if per_panel:
            lines.append("PANEL DRUG LISTS AND LOCI")
            lines += per_panel
        return "\n".join(lines)

    return ""


def _render_genomics_shape(sub_tab: str) -> str:
    """The minimal JSON skeleton for one sub-tab, showing how the row tables nest."""
    if sub_tab == "wgs":
        return (
            '{"submitted_at": "", "specimen_input": "", "platform": "", "run_id": "", '
            '"sequencing_lab": "", "sequencing_lab_ref": "", "result_received_at": "", '
            '"result_file_ref": "", "dna_extraction_method": "", "dna_concentration": "", '
            '"a260_280": "", "extraction_qc_pass": "", "pipeline_name": "", '
            '"pipeline_version": "", "reference_genome": "", "assembly_qc_pass": "", '
            '"total_reads": "", "reads_after_qc": "", "mean_coverage": "", '
            '"coverage_breadth_pct": "", "assembly_qc_note": "", "identified_species": "", '
            '"id_resolution": "", "identification_confidence": "", "id_tool": "", '
            '"id_tool_version": "", "sequence_type": "", "mlst_scheme": "", '
            '"clonal_complex": "", "lineage": "", "spa_type": "", "sccmec": "", '
            '"serotype": "", "clade": "", "resistance_genes": [{"gene_name": "", '
            '"gene_class": "", "mechanism": "", "database_source": "", '
            '"database_version": "", "identity_pct": "", "coverage_pct": "", '
            '"predicted_phenotype": "", "confidence": "", "drug_targets": []}], '
            '"virulence_genes": [{"gene_name": "", "category": "", "note": ""}], '
            '"plasmid_replicons": [{"name": "", "note": ""}], '
            '"tb_who_catalogue_version": "", "tb_drug_resistance_profile": [{"drug": "", '
            '"mutation": "", "who_confidence": "", "predicted_phenotype": ""}], '
            '"genotype_phenotype_concordance": "", "concordance_note": "", "cluster_id": "", '
            '"cluster_snp_distance": "", "cluster_tool": "", "epidemiological_link": "", '
            '"outbreak_note": "", "genomic_summary": ""}'
        )
    if sub_tab == "mngs":
        return (
            '{"specimen_type": "", "input_type": "", "host_depletion": "", '
            '"submitted_at": "", "result_received_at": "", "platform": "", '
            '"sequencing_lab": "", "sequencing_lab_ref": "", "result_file_ref": "", '
            '"pipeline_name": "", "pipeline_version": "", "total_reads": "", '
            '"reads_after_qc": "", "host_reads_pct": "", "non_host_reads": "", '
            '"organism_hits": [{"taxon_name": "", "taxon_rank": "", "kingdom": "", '
            '"rpm": "", "nt_coverage": "", "nr_coverage": "", "background_model": "", '
            '"clinical_significance": "", "significance_note": ""}], '
            '"virus_hits": [{"virus_name": "", "genome_coverage_pct": "", "mean_depth": "", '
            '"antiviral_resistance_markers": [], "clinical_note": ""}], '
            '"amr_genes_detected": [{"gene_name": "", "gene_class": "", "mechanism": "", '
            '"database_source": "", "card_version": "", "predicted_phenotype": "", '
            '"note": ""}], "interpretation_note": ""}'
        )
    if sub_tab == "tngs":
        return (
            '{"submitted_at": "", "specimen_input": "", "platform": "", "sequencing_lab": "", '
            '"sequencing_lab_ref": "", "result_received_at": "", "result_file_ref": "", '
            '"prior_genexpert": {"result": "", "rif_resistance": "", "performed_at": ""}, '
            '"assay_name": "", "assay_version": "", "pipeline_name": "", '
            '"pipeline_version": "", "mean_depth_coverage": "", '
            '"loci_above_threshold_pct": "", "qc_pass": "", "qc_note": "", '
            '"drug_resistance_calls": [{"drug": "", "mutations_detected": [], '
            '"who_confidence_tier": "", "predicted_phenotype": "", "vaf_pct": ""}], '
            '"lineage": "", "lineage_tool": "", "concordance_with_phenotypic_dst": "", '
            '"concordance_note": ""}'
        )
    return (
        '{"orders": [{"panel": "", "method": "", "platform": "", "sequencing_lab": "", '
        '"submitted_at": "", "pipeline_name": "", "pipeline_version": "", '
        '"mean_depth_coverage": "", "qc_pass": "", "qc_note": "", "result_file_ref": "", '
        '"interpretation_note": "", "loci_targeted": [], "reference_database": "", '
        '"mutation_rows": [{"locus": "", "mutation": "", "drug": "", '
        '"predicted_phenotype": "", "confidence": "", "note": ""}], '
        '"taxa_rows": [{"taxon_name": "", "rank": "", "identity_pct": "", "note": ""}], '
        '"typing": {"scheme": "", "type_result": "", "cluster_id": "", "snp_distance": ""}}]}'
    )


class PathogenGenomicsStructurePayload(BaseModel):
    text: str
    sub_tab: str  # "wgs" | "mngs" | "tngs" | "targeted" — the card's active sub-tab
    specimen: Optional[Dict[str, Any]] = None  # { specimen_type, site_of_collection }
    species_is_mtbc: Optional[bool] = False  # WGS only: is the TB block live on the card?
    panels: List[Dict[str, Any]] = []  # targeted only: the panels this specimen ordered


@router.post("/pathogen-genomics/structure")
async def structure_pathogen_genomics(payload: PathogenGenomicsStructurePayload):
    """
    Convert a spoken sequencing result into ONE Pathogen Genomics sub-tab's record.

    The request names the sub-tab, so the model sees only that panel's key guide
    and cannot cross-wire WGS keys into tNGS; for the targeted sub-tab it carries
    the panels the specimen actually ordered, so it can never invent one. The
    derived fields (TB classification, heteroresistance, panel kind) are recomputed
    by the frontend from the rows it just merged.

    Advisory / read-only: the tab fills empty fields of the active sub-tab's record
    only and appends a row for a dictated determinant that has none — nothing
    already entered is overwritten or cleared, and nothing here writes to a case.
    """
    try:
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Dictation text is required")

        sub_tab = (payload.sub_tab or "").strip().lower()
        if sub_tab not in GENOMICS_SUBTAB_KEYS:
            raise HTTPException(
                status_code=400,
                detail=f"sub_tab must be one of: {', '.join(GENOMICS_SUBTAB_KEYS)}",
            )

        panels = [
            p for p in (payload.panels or [])
            if isinstance(p, dict) and str(p.get("value") or "").strip()
        ]
        if sub_tab == "targeted" and not panels:
            raise HTTPException(
                status_code=400,
                detail="panels is required for the targeted sub-tab (the panels this specimen ordered)",
            )

        client = _groq_client()
        today = datetime.utcnow().strftime("%Y-%m-%d")

        specimen = payload.specimen or {}
        ctx = ""
        if specimen.get("specimen_type") or specimen.get("site_of_collection"):
            ctx = f"This card is for specimen {specimen.get('specimen_type') or 'unspecified type'}"
            if specimen.get("site_of_collection"):
                ctx += f", from {specimen.get('site_of_collection')}"
            ctx += ".\nUse it only to anchor context.\n"
        if sub_tab == "wgs":
            ctx += (
                "The TB drug profile block is currently "
                + ("live on this card" if payload.species_is_mtbc else "not shown")
                + " — it renders only for an MTBC identification. Return its keys only "
                  "when the dictation describes TB drug resistance.\n"
            )

        prompt = (
            "You convert a technologist's spoken "
            f"{sub_tab.upper()} sequencing result into structured JSON for the lab's "
            "pathogen-genomics form.\n"
            f"Today's date is {today}; resolve relative phrases such as \"today\", "
            "\"this morning\", \"yesterday\" and \"8 am\" against it.\n\n"
            "FIELDS YOU MAY RETURN:\n"
            + _genomics_key_guide(sub_tab, panels)
            + "\n\n"
            + (ctx or "No specimen context was provided.\n")
            + "\nReturn STRICT JSON shaped exactly like this skeleton (same keys, same "
              "nesting; fill every key):\n"
            + _render_genomics_shape(sub_tab)
            + "\n\nRULES:\n- "
            + "\n- ".join(_dictation_rules(
                "Never return the derived fields (the TB classification, heteroresistance, "
                "the panel kind) — the application computes those from the rows you return."
            ))
            + f"\n\nDICTATION:\n\"\"\"{payload.text.strip()}\"\"\""
        )

        completion = client.chat.completions.create(
            model=GLOBAL_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            # A reasoning model shares this budget between its reasoning and the
            # visible JSON (see the Tab 16 endpoint below, where 2000 was too
            # little and surfaced as json_validate_failed with an EMPTY
            # failed_generation). The WGS guide is the heaviest here — three
            # resistance/virulence/plasmid row tables plus the TB profile — so it
            # gets the same 4000 the Tab 16 dictation chunks use. (The PGx advisory
            # sits above that at 4500; its rationale sentence is what needs the room.)
            max_tokens=4000,
        )
        content = completion.choices[0].message.content
        if not content:
            finish = completion.choices[0].finish_reason
            logger.error(
                f"Pathogen genomics dictation returned no content for the {sub_tab} "
                f"sub-tab (finish_reason={finish}, max_tokens=4000)"
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    f"The structuring model returned nothing (finish_reason={finish}). "
                    "If it reports 'length', raise max_tokens."
                ),
            )
        structured = json.loads(content)
        if not isinstance(structured, dict):
            structured = {}
        return {"status": "success", "data": structured}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Pathogen genomics dictation structuring failed: {e}")
        raise HTTPException(status_code=500, detail=f"Structuring failed: {e}")


# ─── Tab 16 — Human genomics dictation structuring (AI autofill) ──────────────
# Converts a spoken pharmacogenomic report into ONE chunk of the case-level
# human_genomics section. The tab is the largest form in the module, so the
# frontend fills it in four chunks — consent + assay, QC, gene results, and
# HLA + G6PD + report — sending the same transcript to each. A chunk sees only
# its own field guide, so a gene key cannot land in the report body, and no
# single response can outgrow its token budget.
#
# Never returned, by design:
#   • every DERIVED field. The screen derives these from a catalogue when the user
#     picks something, and the frontend re-applies the same derivations to a
#     dictated row so a dictated result and a typed one cannot differ: a gene's
#     drugs and evidence level, the published dose action for a phenotype (only
#     where one action covers every drug — pgxGuidance declines on "mixed" and
#     "partial"), a known HLA risk allele's drug and reaction, and the G6PD
#     action. Asking the model for them would put an unvalidated CPIC action
#     straight into a clinical field.
#   • consent.obtained_by and the submitting staff (identity belongs to the
#     application), report.status (a workflow state, not a finding), every row ID,
#     the stored dosing snapshot and the kept advisory brief.
#
# Option strings mirror components/microbiology/constants.js; the three-state QC
# answer comes from tabs/genomics/fields.jsx. GENOMICS_PLATFORMS and
# GENOMICS_SEQUENCING_LABS are shared with the Tab 15 block above. Keep in step.
#
# These tuples are also the ADVISORY prompt's vocabulary — it numbers them
# directly. One definition per name: a second copy under the same name wins at
# import for the whole module and breaks whichever endpoint reads the first.

PGX_CHUNK_KEYS = ("assay", "qc", "genes", "hla")

PGX_CONSENT_OPTIONS = ("Yes — recorded", "No", "Not recorded")
PGX_PANEL_OPTIONS = (
    "Core PGx panel (DPYD, TPMT, NUDT15, UGT1A1)",
    "Oncology toxicity panel",
    "Extended PGx panel",
    "Cardiology / anticoagulation panel",
    "Single gene",
    "Custom panel",
)
PGX_METHOD_OPTIONS = (
    "Targeted genotyping (allele-specific PCR)",
    "Sanger sequencing",
    "NGS panel",
    "Whole genome sequencing",
    "Array-based genotyping",
    "CNV assay (MLPA / digital PCR)",
)
PGX_SPECIMEN_OPTIONS = (
    "EDTA whole blood",
    "Saliva (Oragene)",
    "Buccal swab",
    "Dried blood spot",
    "Other",
)
PGX_PHENOTYPE_OPTIONS = (
    "Ultrarapid metabolizer",
    "Rapid metabolizer",
    "Normal metabolizer",
    "Intermediate metabolizer",
    "Poor metabolizer",
    "Indeterminate",
    "Not applicable",
)
PGX_EVIDENCE_OPTIONS = (
    "A — actionable, widely accepted",
    "B — actionable, some evidence",
    "C — testing recommended, action possible",
    "D — testing recommended, no action established",
)
PGX_GUIDELINE_OPTIONS = (
    "CPIC",
    "DPWG (Dutch Pharmacogenetics Working Group)",
    "CPNDS (Canadian Pharmacogenomics Network)",
    "RNPGx (French National Network)",
    "FDA Table of Pharmacogenomic Biomarkers",
    "Institutional protocol",
)
PGX_DOSE_ACTION_OPTIONS = (
    "Standard dose — no adjustment",
    "Reduce starting dose",
    "Increase starting dose",
    "Avoid — use alternative agent",
    "Avoid — contraindicated",
    "Insufficient evidence — use clinical judgement",
    "Not applicable",
)
PGX_RISK_OPTIONS = (
    "Normal risk",
    "Increased risk of toxicity",
    "High risk of toxicity",
    "Risk of reduced efficacy",
    "Indeterminate",
)
PGX_LIMITATION_OPTIONS = (
    "Copy number not assessed (deletions / duplications not detected)",
    "Rare or novel variants not covered",
    "Only the listed alleles were interrogated",
    "HLA resolution below allele level",
    "Phasing / cis-trans not determined",
    "Other — see note",
)
# The genes and alleles a row can hold. A dictated name is snapped to these, so a
# result for a gene the panel cannot hold is never recorded as if it were one.
PGX_GENE_KEYS = (
    "DPYD", "TPMT", "NUDT15", "UGT1A1", "CYP2D6", "CYP2C19",
    "CYP2C9", "VKORC1", "SLCO1B1", "CYP3A5", "RYR1", "CACNA1S",
)
PGX_HLA_ALLELE_KEYS = (
    "HLA-B*57:01", "HLA-B*58:01", "HLA-B*15:02", "HLA-A*31:01",
    "HLA-B*13:01", "HLA-A*32:01", "HLA-B*15:11",
)
PGX_HLA_TYPING_METHODS = (
    "Sequence-specific primers (SSP)",
    "Sequence-specific oligonucleotide probes (SSO)",
    "Sanger sequencing (SBT)",
    "NGS (allele-level)",
    "Real-time PCR (allele-specific)",
)
PGX_HLA_RESOLUTIONS = (
    "Allele level (e.g. B*57:01)",
    "Group level (e.g. B57)",
    "Low resolution — not allele-specific",
)
PGX_HLA_RESULTS = ("Positive", "Negative", "Indeterminate")
PGX_G6PD_STATUSES = (
    "Normal",
    "Deficient",
    "Intermediate / partial deficiency",
    "Indeterminate",
)
PGX_G6PD_DRUGS = (
    "Primaquine",
    "Tafenoquine",
    "Dapsone",
    "Nitrofurantoin",
    "Rasburicase",
    "Methylene blue",
)


def _pgx_key_guide(chunk: str) -> str:
    """The per-key guide for one chunk: every field that chunk may return, with
    its rule and the exact option strings for an enum."""
    if chunk == "assay":
        return "\n".join([
            "CONSENT (recorded because the institution has no genetic-counselling "
            "process — state it only as the dictation gives it)",
            f'- "obtained": one of {_opts(PGX_CONSENT_OPTIONS)}.',
            '- "obtained_at": a full local datetime as YYYY-MM-DDTHH:MM, else "".',
            '- "reference": the consent form or record reference exactly as dictated, else "".',
            "SAMPLE & ASSAY",
            f'- "specimen_type": one of {_opts(PGX_SPECIMEN_OPTIONS)}.',
            '- "collected_at", "received_at", "reported_at": YYYY-MM-DDTHH:MM, else "".',
            f'- "panel": one of {_opts(PGX_PANEL_OPTIONS)}.',
            '- "panel_version": the version string exactly as dictated, else "".',
            f'- "method": one of {_opts(PGX_METHOD_OPTIONS)}.',
            f'- "platform": one of {_opts(GENOMICS_PLATFORMS)}.',
            f'- "laboratory": one of {_opts(GENOMICS_SEQUENCING_LABS)}.',
            '- "lab_ref", "result_file_ref": exactly as dictated, else "".',
            '- "genes_covered": an array of the genes the dictation says the panel '
            'covers, each an exact key from: ' + _opts(PGX_GENE_KEYS) + '. [] when the '
            'dictation does not state the panel\'s coverage.',
        ])

    if chunk == "qc":
        return "\n".join([
            "QC",
            '- "dna_concentration": the bare number in ng/µL, no unit, else "".',
            '- "a260_280": the bare ratio, else "".',
            '- "mean_depth": the bare depth in x, no unit, else "".',
            f'- "qc_pass": one of {_opts(GENOMICS_QC_PASS)}.',
            '- "no_call_genes": an array of the genes the dictation says FAILED QC, each '
            'an exact key from: ' + _opts(PGX_GENE_KEYS) + '. A gene that failed QC is '
            'reported as NOT ANALYSED — never as normal — so this is a clinical finding, '
            'and [] must mean "none stated", not "none known".',
            '- "limitations": an array of the assay limitations the dictation states, '
            'each an exact option from: ' + _opts(PGX_LIMITATION_OPTIONS) + '. [] when '
            'none is stated.',
            '- "qc_note": a verbatim phrase, else "".',
        ])

    if chunk == "genes":
        return "\n".join([
            'GENE RESULTS — "gene_results": one array entry per gene the dictation '
            'reports, each an object with:',
            '- "gene": an exact key from: ' + _opts(PGX_GENE_KEYS) + '. Skip any gene '
            'the dictation names that is not in this list.',
            '- "allele_1", "allele_2": each allele exactly as dictated (e.g. "*1", "*2A").',
            '- "diplotype": as dictated (e.g. "*1/*2A"), else "".',
            f'- "phenotype": one of {_opts(PGX_PHENOTYPE_OPTIONS)}.',
            '- "activity_score": the bare number, else "".',
            f'- "guideline": one of {_opts(PGX_GUIDELINE_OPTIONS)}.',
            '- "guideline_version": the version exactly as dictated, else "".',
            f'- "evidence_level": one of {_opts(PGX_EVIDENCE_OPTIONS)}.',
            '- "implicated_drugs": an array of the drugs the dictation names FOR THIS '
            'GENE, each verbatim. Use [] when the dictation names none — the '
            'application fills the gene\'s standard drug list, so do not supply one '
            'from your own knowledge.',
            '- "dose_implication": an exact option from ' + _opts(PGX_DOSE_ACTION_OPTIONS)
            + ' ONLY when the dictation states an action. NEVER infer it from the '
            'phenotype: the application offers the published CPIC action for these '
            'drugs itself, and a guessed action here would bypass that.',
            '- "risk_category": an exact option from ' + _opts(PGX_RISK_OPTIONS)
            + ' ONLY when the dictation states one, else "".',
            '- "recommendation", "note": copied verbatim, and only when the dictation '
            'speaks them. Never compose dosing advice — leave them "" otherwise.',
        ])

    if chunk == "hla":
        return "\n".join([
            'HLA RESULTS — "hla_results": one array entry per allele the dictation '
            'reports, each an object with:',
            '- "allele": an exact key from: ' + _opts(PGX_HLA_ALLELE_KEYS) + '. A '
            'group-level call the dictation gives ("B57 positive") has no allele key — '
            'return the entry with "allele": "" and put what was said in "locus".',
            '- "locus": the locus or group exactly as dictated, and only when the call '
            'is not one of the allele keys above, else "".',
            f'- "resolution": one of {_opts(PGX_HLA_RESOLUTIONS)}.',
            f'- "method": one of {_opts(PGX_HLA_TYPING_METHODS)}.',
            f'- "result": one of {_opts(PGX_HLA_RESULTS)}.',
            '- "drug", "reaction": only when the dictation names them — the application '
            'fills the drug and reaction a known risk allele causes, so do not supply '
            'them from your own knowledge.',
            '- "recommendation", "note": copied verbatim, and only when the dictation '
            'speaks them, else "".',
            "G6PD — \"g6pd\": an object with",
            f'- "status": one of {_opts(PGX_G6PD_STATUSES)}.',
            '- "activity_pct": the bare percentage number, else "".',
            '- "dose_implication": an exact option from ' + _opts(PGX_DOSE_ACTION_OPTIONS)
            + ' ONLY when the dictation states an action — never inferred from the '
            'status.',
            '- "recommendation", "note": verbatim, only when spoken, else "".',
            '- "variants": an array of the variants named (e.g. "G6PD Mediterranean"), '
            'each verbatim. [] when none is stated.',
            "REPORT — \"report\": an object with",
            '- "body", "patient_summary", "limitations_note": the wording ONLY if the '
            'dictation speaks it, copied verbatim. Never compose a report, a patient '
            'summary or a limitations note of your own — leave them "" otherwise. The '
            'report\'s status is NOT returned; it is the user\'s to set.',
        ])

    return ""


def _render_pgx_shape(chunk: str) -> str:
    """The minimal JSON skeleton for one chunk."""
    if chunk == "assay":
        return (
            '{"consent": {"obtained": "", "obtained_at": "", "reference": ""}, '
            '"assay": {"specimen_type": "", "collected_at": "", "received_at": "", '
            '"reported_at": "", "panel": "", "panel_version": "", "method": "", '
            '"platform": "", "laboratory": "", "lab_ref": "", "result_file_ref": "", '
            '"genes_covered": []}}'
        )
    if chunk == "qc":
        return (
            '{"qc": {"dna_concentration": "", "a260_280": "", "mean_depth": "", '
            '"qc_pass": "", "no_call_genes": [], "limitations": [], "qc_note": ""}}'
        )
    if chunk == "genes":
        return (
            '{"gene_results": [{"gene": "", "allele_1": "", "allele_2": "", '
            '"diplotype": "", "phenotype": "", "activity_score": "", "guideline": "", '
            '"guideline_version": "", "evidence_level": "", "implicated_drugs": [], '
            '"dose_implication": "", "risk_category": "", "recommendation": "", '
            '"note": ""}]}'
        )
    return (
        '{"hla_results": [{"allele": "", "locus": "", "resolution": "", "method": "", '
        '"result": "", "drug": "", "reaction": "", "recommendation": "", "note": ""}], '
        '"g6pd": {"status": "", "activity_pct": "", "dose_implication": "", '
        '"recommendation": "", "note": "", "variants": []}, '
        '"report": {"body": "", "patient_summary": "", "limitations_note": ""}}'
    )


class HumanGenomicsStructurePayload(BaseModel):
    text: str
    chunk: str  # "assay" | "qc" | "genes" | "hla" — which part of the form to fill


@router.post("/human-genomics/structure")
async def structure_human_genomics(payload: HumanGenomicsStructurePayload):
    """
    Convert a spoken pharmacogenomic report into ONE chunk of the Human Genomics
    form. The tab is filled in four chunks (see PGX_CHUNK_KEYS), so each request
    carries only its own field guide and returns only its own section — the
    frontend folds the four results in together.

    The catalogue derivations the screen performs on manual entry (a gene's drugs
    and evidence level, the published dose action for a phenotype, an HLA risk
    allele's drug and reaction, the G6PD action) are re-applied by the frontend
    from its own tables, never taken from the model.

    Advisory / read-only: the tab fills empty fields only and adds a row for a
    dictated gene or allele that has none — nothing already entered is overwritten
    or cleared, and nothing here writes to a case.
    """
    try:
        if not payload.text.strip():
            raise HTTPException(status_code=400, detail="Dictation text is required")

        chunk = (payload.chunk or "").strip().lower()
        if chunk not in PGX_CHUNK_KEYS:
            raise HTTPException(
                status_code=400,
                detail=f"chunk must be one of: {', '.join(PGX_CHUNK_KEYS)}",
            )

        client = _groq_client()
        today = datetime.utcnow().strftime("%Y-%m-%d")

        prompt = (
            "You convert a technologist's spoken pharmacogenomic laboratory report into "
            "structured JSON for the lab's human-genomics form. The form is filled in "
            f"parts, and this request fills one part — the {chunk} part. Return ONLY that "
            "part's keys; anything from another part of the form is ignored.\n"
            f"Today's date is {today}; resolve relative phrases such as \"today\", "
            "\"this morning\", \"yesterday\" and \"8 am\" against it.\n\n"
            "FIELDS YOU MAY RETURN:\n"
            + _pgx_key_guide(chunk)
            + "\n\nReturn STRICT JSON shaped exactly like this skeleton (same keys, same "
              "nesting; fill every key):\n"
            + _render_pgx_shape(chunk)
            + "\n\nRULES:\n- "
            + "\n- ".join(_dictation_rules(
                "Never return the derived fields — a gene's standard drug list, the dose "
                "action a phenotype implies, an HLA allele's drug and reaction, or the "
                "G6PD action. The application computes all of those from its own tables, "
                "so anything you supply there is discarded."
            ))
            + f"\n\nDICTATION:\n\"\"\"{payload.text.strip()}\"\"\""
        )

        completion = client.chat.completions.create(
            model=GLOBAL_LLM_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            response_format={"type": "json_object"},
            # gpt-oss-20b is a REASONING model, and this budget is shared between
            # its reasoning and the visible JSON. Sized at 4000 — the figure the
            # PGx advisory needs for a comparable per-gene schema. At 2000 the
            # genes chunk spent the allowance reasoning and emitted nothing at
            # all, which Groq reports as json_validate_failed with an EMPTY
            # failed_generation: an opaque 400 that reads like a schema problem
            # and is not one. The genes chunk is the one that needs the room —
            # reconciling alleles, diplotypes and phenotypes against a gene list
            # is the only chunk here with real reasoning in it.
            max_tokens=4000,
        )
        content = completion.choices[0].message.content
        if not content:
            finish = completion.choices[0].finish_reason
            logger.error(
                f"Human genomics dictation returned no content for the {chunk} chunk "
                f"(finish_reason={finish}, max_tokens=4000)"
            )
            raise HTTPException(
                status_code=502,
                detail=(
                    f"The structuring model returned nothing (finish_reason={finish}). "
                    "If it reports 'length', raise max_tokens."
                ),
            )
        structured = json.loads(content)
        if not isinstance(structured, dict):
            structured = {}
        return {"status": "success", "data": structured}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Human genomics dictation structuring failed: {e}")
        raise HTTPException(status_code=500, detail=f"Structuring failed: {e}")


# ─── Tab 14 — Sign-out ─────────────────────────────────────────────────────────


def _prelim_requires_notification(prelim_reports: Optional[Dict[str, Any]]) -> bool:
    """True when any issued preliminary was flagged critical or notifiable (a
    recorded verbal/STAT notification should therefore exist in Tab 13)."""
    for v in _as_list((prelim_reports or {}).get("versions")):
        if v.get("critical") or v.get("notifiable"):
            return True
    return False


@router.put("/case/{case_id}/sign-out")
async def sign_out_case(case_id: str, force: bool = False, by: str = ""):
    """
    Mark a microbiology case as 'Signed-out' and deactivate it after the saved
    Final Report section passes the essential server-side sign-out checks.

    Only the ESSENTIAL blockers are enforced here (the full per-track checklist
    is UI-level guidance in Tab 14):
      - final_report.report_status must be "Final"
      - a final report body is required
      - interpretation must be confirmed (confirmation.name + confirmed_at)
      - if any preliminary was critical/notifiable, a Tab 13 dispatch must exist

    `force=True` bypasses every blocker so an unfinished case can be closed and
    a new case started (used by Sign Out & New Case when the current case is not
    signed out). The forced sign-out is recorded with
    `forced_sign_out`/`forced_sign_out_at`/`forced_sign_out_by` so it is
    auditable; `by` names who performed it.
    """
    try:
        case = await microbiology_collection.find_one({"case_id": case_id})
        if not case:
            raise HTTPException(status_code=404, detail="Case not found")
        if case.get("status") == CASE_STATUS_SIGNED_OUT:
            return {"status": "success", "message": "Case already signed out", "idempotent": True}

        final = case.get("final_report") or {}
        interpretation = case.get("interpretation") or {}
        infection_control = case.get("infection_control") or {}
        prelim = case.get("preliminary_reports") or {}

        register = case.get("case_register") or {}
        case_type = register.get("case_type") or ""

        blockers = []
        if final.get("report_status") != "Final":
            blockers.append("Final report status must be Final")
        if not str(final.get("report_body") or "").strip():
            blockers.append("Final report body is required")
        # Skipped for a case type that never offers Tab 12: the tab holding the
        # confirmation is not on the sidebar, so the blocker could never be
        # satisfied and the case would be unclosable except by force — which also
        # starts a new registration. Such a case keeps the other three gates.
        if case_type not in CASE_TYPES_WITHOUT_INTERPRETATION:
            confirmation = (interpretation.get("confirmation") or {}) if isinstance(interpretation, dict) else {}
            if not (confirmation.get("name") and confirmation.get("confirmed_at")):
                blockers.append("Clinical interpretation confirmation is required (Tab 12)")

        needs_notification = _prelim_requires_notification(prelim)
        dispatched = [
            alert for alert in _as_list((infection_control or {}).get("alerts"))
            if alert.get("acknowledged") == "Yes" or alert.get("notified_to") or alert.get("notified_at")
        ]
        if needs_notification and not dispatched:
            blockers.append("A critical or notifiable preliminary was issued — record its dispatch in Tab 13")

        if not force and blockers:
            raise HTTPException(
                status_code=400,
                detail={"message": "Case is not ready for sign-out", "blockers": blockers},
            )

        now = datetime.utcnow()
        set_fields = {
            "status": CASE_STATUS_SIGNED_OUT,
            "is_active": False,
            "updated_at": now,
            "signed_out_at": now,
            "signed_out_by": by
            or (final.get("reviewer") or {}).get("name")
            or confirmation.get("name")
            or "",
        }
        if force:
            set_fields["forced_sign_out"] = True
            set_fields["forced_sign_out_by"] = by
            set_fields["forced_sign_out_at"] = now

        result = await microbiology_collection.update_one(
            {"case_id": case_id, "status": {"$ne": CASE_STATUS_SIGNED_OUT}},
            {"$set": set_fields},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=409, detail="Case was already signed out")

        return {"status": "success", "message": "Case signed out"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error signing out case {case_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to sign out case")
