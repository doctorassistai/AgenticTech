"""
procedure_agent.py — v2.0
==========================
Agentic Clinical Procedure Workflow System for DoctorAssist
Neo4j Knowledge Graph integration — OUTPUT STRUCTURE IDENTICAL TO v1.0

Architecture (LangGraph):
  load_patient_context          ← fetches graph + demographics + all mongo context
  → graph_context_node          ← pre-processes graph entities into structured context
  → suggest_procedures          (if no selected_procedure)
  → select_procedure_entry      (routes: suggest vs full workflow)
  → chemo_calculation_node      ← reads from graph-enriched clinical_data
  → chemo_validation_node
  → longitudinal_node
  → treatment_node
  → alerts_node
  → pre_procedure_node
  → during_procedure_node
  → toxicity_node
  → post_procedure_node
  → audit_node
  → assemble_report

Final output JSON structure is byte-for-byte identical to v1.0 — no frontend changes needed.
"""

from __future__ import annotations

import json
import os
import traceback
import re

from typing import Dict, Any, List, Optional, TypedDict
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_groq import ChatGroq
from langgraph.graph import StateGraph, END
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from neo4j import AsyncGraphDatabase

import sys
from loguru import logger

logger.remove()
logger.add(
    sys.stdout,
    level="INFO",
    format="{time} | {level} | {message}",
    enqueue=True,
)

router = APIRouter(
    prefix="",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)

# ──────────────────────────────────────────────────────────────────────────────
# ENV / DB
# ──────────────────────────────────────────────────────────────────────────────

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
MONGO_URI    = os.getenv("MONGO_URI")
NEO4J_URI    = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER   = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASS   = os.getenv("NEO4J_PASSWORD", "password")
MONGO_DB     = "doctorassistai"

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database       = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)
db     = client[MONGO_DB]

# Neo4j async driver (module-level singleton)
neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS),
)

mongo_db = database  # alias used by graph fetch helpers

# Collections
doctor_user_collection                       = db["doctor_users"]
patient_user_collection                      = db["patient_users"]
procedure_notes_collection                   = database["procedure_notes"]
medical_context_collection                   = database["medical_contexts"]
current_context_collection                   = database["current_contexts"]
summary_collection                           = database["patient_summary"]
tumor_board_collection                       = database["tumor_board_cases"]
documentation_treatment_plan_collection      = database["documentation-treatment-plan"]
documentation_investigation_notes_collection = database["documentation-investigation-notes"]
documentation_medication_analysis_collection = database["documentation-medication-analysis"]
documentation_treatment_summary_collection   = database["documentation-treatment-summary"]
documentation_clinical_notes_collection      = database["documentation-clinical-notes"]
diagnosis_data_collection                    = database["diagnosis_data"]
patient_vitals_collection                    = database["patient_vitals"]
chemo_audit_collection                       = database["chemo_audit_logs"]
chemo_cumulative_collection                  = database["chemo_cumulative_doses"]
chemo_validation_collection                  = database["chemo_validation_results"]


# ──────────────────────────────────────────────────────────────────────────────
# GRAPH DATA FETCH HELPERS
# ──────────────────────────────────────────────────────────────────────────────

async def fetch_patient_demographics(patient_id: str) -> dict:
    """Fetch DOB and gender for a patient from MongoDB."""
    try:
        patient = await mongo_db["patient_users"].find_one(
            {"patient_id": patient_id},
            {"_id": 0, "date_of_birth": 1, "gender": 1},
        )
        if not patient:
            patient = await mongo_db["patient_users"].find_one(
                {"sys_user_id": patient_id},
                {"_id": 0, "date_of_birth": 1, "gender": 1},
            )
        if not patient:
            return {"dob": None, "sex": None}
        return {
            "dob": patient.get("date_of_birth"),
            "sex": patient.get("gender"),
        }
    except Exception:
        logger.exception(f"Failed to fetch demographics for patient {patient_id}")
        return {"dob": None, "sex": None}


async def fetch_patient_graph_documents(patient_id: str) -> List[Dict]:
    """Fetch all clinical entities from the Neo4j knowledge graph for this patient."""
    cypher = """
    MATCH (p:Patient {patient_id: $patient_id})-[r]->(n)
    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)

    WITH r, n, e,
        CASE
            WHEN e IS NULL OR e.document_date IS NULL OR e.document_date = "null"
            THEN NULL
            ELSE toString(e.document_date)
        END AS raw_date,
        coalesce(e.document_name, "unknown") AS document

    WITH r, n, e, document, raw_date,
        CASE
            WHEN raw_date IS NULL THEN NULL
            WHEN raw_date =~ '\\d{4}-\\d{2}-\\d{2}'
            THEN date(raw_date)
            WHEN raw_date =~ '\\d{2}-\\d{2}-\\d{4}'
            THEN date({
                year:  toInteger(split(raw_date,'-')[2]),
                month: toInteger(split(raw_date,'-')[1]),
                day:   toInteger(split(raw_date,'-')[0])
            })
            WHEN raw_date =~ '\\d{2}-[A-Za-z]{3}-\\d{4}'
            THEN date({
                year:  toInteger(split(raw_date,'-')[2]),
                month: CASE split(raw_date,'-')[1]
                    WHEN 'Jan' THEN 1 WHEN 'Feb' THEN 2 WHEN 'Mar' THEN 3
                    WHEN 'Apr' THEN 4 WHEN 'May' THEN 5 WHEN 'Jun' THEN 6
                    WHEN 'Jul' THEN 7 WHEN 'Aug' THEN 8 WHEN 'Sep' THEN 9
                    WHEN 'Oct' THEN 10 WHEN 'Nov' THEN 11 WHEN 'Dec' THEN 12
                    ELSE NULL END,
                day: toInteger(split(raw_date,'-')[0])
            })
            ELSE NULL
        END AS document_date

    WITH document, document_date,
        collect({
            relation:    type(r),
            entity_type: CASE
                WHEN n:Treatment   THEN "Treatment"
                WHEN n:Procedure   THEN "Procedure"
                WHEN n:Diagnosis   THEN "Diagnosis"
                WHEN n:Medication  THEN "Medication"
                WHEN n:LabResult   THEN "Lab Result"
                WHEN n:VitalSign   THEN "Vital Sign"
                WHEN n:Finding     THEN "Finding"
                WHEN n:Anatomy     THEN "Anatomy"
                WHEN n:Measurement THEN "Measurement"
                ELSE head(labels(n))
            END,
            name: coalesce(
                n.name, n.details, n.description,
                n.drug_name, n.test_name, n.vital_type, n.value
            ),
            date:     raw_date,
            evidence: e.evidence_text
        }) AS entities

    RETURN document, document_date, entities
    ORDER BY document_date ASC
    """
    try:
        async with neo4j_driver.session() as session:
            result = await session.run(cypher, patient_id=patient_id)
            docs: List[Dict] = []
            async for record in result:
                docs.append({
                    "document":      record["document"],
                    "document_date": str(record["document_date"]),
                    "entities":      record["entities"],
                })
            logger.info(f"Graph fetch: {len(docs)} documents for patient {patient_id}")
            return docs
    except Exception as e:
        logger.error(f"Neo4j fetch failed for patient {patient_id}: {e}")
        return []


async def _fetch_graph_and_demographics(patient_id: str):
    """Fetch Neo4j graph docs and Mongo demographics concurrently."""
    import asyncio
    graph_docs, demographics = await asyncio.gather(
        fetch_patient_graph_documents(patient_id),
        fetch_patient_demographics(patient_id),
    )
    return graph_docs, demographics


# ──────────────────────────────────────────────────────────────────────────────
# GRAPH CONTEXT PROCESSOR
# ──────────────────────────────────────────────────────────────────────────────

def _calculate_age(dob_value: Any) -> Optional[float]:
    """Calculate age in years from a date-of-birth value."""
    try:
        today = datetime.today()
        if isinstance(dob_value, datetime):
            birth = dob_value
        elif isinstance(dob_value, str):
            for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
                try:
                    birth = datetime.strptime(dob_value, fmt)
                    break
                except ValueError:
                    continue
            else:
                return None
        else:
            return None
        age = (today - birth).days / 365.25
        return round(age, 1) if 0 < age < 120 else None
    except Exception:
        return None


def _scan_text_into_vitals(text: str, found: Dict) -> None:
    """Scan a text string for common numeric clinical values and populate found."""
    patterns = {
        "weight_kg":             [r"weight[^0-9]{0,20}(\d+\.?\d*)\s*kg", r"(\d{2,3})\s*kg\b"],
        "height_cm":             [r"height[^0-9]{0,20}(\d+\.?\d*)\s*cm", r"(\d{2,3})\s*cm\b"],
        "creatinine_mg_dl":      [r"creatinine[^0-9]{0,20}(\d+\.?\d*)", r"serum\s+creatinine[^0-9]{0,10}(\d+\.?\d*)"],
        "age_years":             [r"age[^0-9]{0,10}(\d{1,3})\s*(?:year|yr|y)", r"(\d{1,3})\s*(?:year|yr)s?\s*old"],
        "hemoglobin":            [r"h(?:emoglobin|gb|b)[^0-9]{0,10}(\d+\.?\d*)", r"\bHb\b[^0-9]{0,10}(\d+\.?\d*)"],
        "anc_raw":               [r"ANC[^0-9]{0,10}(\d+\.?\d*)", r"absolute\s*neutrophil[^0-9]{0,10}(\d+\.?\d*)"],
        "platelets_raw":         [r"platelet[^0-9]{0,10}(\d+\.?\d*)", r"\bPLT\b[^0-9]{0,10}(\d+\.?\d*)"],
        "ast":                   [r"\bAST\b[^0-9]{0,10}(\d+\.?\d*)", r"\bSGOT\b[^0-9]{0,10}(\d+\.?\d*)"],
        "alt":                   [r"\bALT\b[^0-9]{0,10}(\d+\.?\d*)", r"\bSGPT\b[^0-9]{0,10}(\d+\.?\d*)"],
        "bilirubin":             [r"bilirubin[^0-9]{0,10}(\d+\.?\d*)"],
        "hba1c":                 [r"HbA1c[^0-9]{0,10}(\d+\.?\d*)", r"\bA1c\b[^0-9]{0,10}(\d+\.?\d*)"],
        "fasting_blood_glucose": [r"fasting[^0-9]{0,20}glucose[^0-9]{0,10}(\d+\.?\d*)", r"\bFBG\b[^0-9]{0,10}(\d+\.?\d*)"],
        "target_auc":            [r"(?:target\s+)?AUC[^0-9]{0,10}(\d+\.?\d*)"],
    }
    sanity = {
        "weight_kg": (20, 300), "height_cm": (100, 250), "age_years": (0, 120),
        "creatinine_mg_dl": (0.1, 20), "hemoglobin": (1, 25),
        "anc_raw": (0, 99999), "platelets_raw": (0, 99999),
        "hba1c": (3, 20),
    }
    for field, pats in patterns.items():
        if field in found:
            continue
        for pat in pats:
            m = re.search(pat, text, re.IGNORECASE)
            if m:
                try:
                    v = float(m.group(1))
                    lo, hi = sanity.get(field, (float("-inf"), float("inf")))
                    if lo <= v <= hi:
                        found[field] = v
                        break
                except Exception:
                    pass


def process_graph_into_clinical_context(graph_docs: List[Dict], demographics: Dict) -> Dict[str, Any]:
    """
    Parses raw Neo4j graph documents into a clean, structured clinical context
    that all downstream agents and the chemo engine can consume directly.
    """
    if not graph_docs:
        return {}

    diagnoses:    List[Dict] = []
    medications:  List[Dict] = []
    lab_results:  List[Dict] = []
    vital_signs:  List[Dict] = []
    treatments:   List[Dict] = []
    procedures:   List[Dict] = []
    findings:     List[Dict] = []
    anatomy:      List[Dict] = []
    measurements: List[Dict] = []
    all_evidence: List[str]  = []

    for doc in graph_docs:
        doc_name = doc.get("document", "unknown")
        doc_date = doc.get("document_date", "")
        for entity in (doc.get("entities") or []):
            if not isinstance(entity, dict):
                continue
            etype    = entity.get("entity_type", "")
            name     = entity.get("name") or ""
            evidence = entity.get("evidence") or ""
            edate    = entity.get("date") or doc_date

            record = {
                "name":     name,
                "date":     edate,
                "document": doc_name,
                "evidence": evidence,
                "relation": entity.get("relation", ""),
            }

            if etype == "Diagnosis":       diagnoses.append(record)
            elif etype == "Medication":    medications.append(record)
            elif etype == "Lab Result":    lab_results.append(record)
            elif etype == "Vital Sign":    vital_signs.append(record)
            elif etype == "Treatment":     treatments.append(record)
            elif etype == "Procedure":     procedures.append(record)
            elif etype == "Finding":       findings.append(record)
            elif etype == "Anatomy":       anatomy.append(record)
            elif etype == "Measurement":   measurements.append(record)

            if evidence:
                all_evidence.append(evidence)

    # Extract numeric vitals from graph text
    extracted_vitals: Dict[str, Any] = {}
    numeric_scan_texts = (
        [e.get("evidence", "") for e in lab_results + vital_signs + measurements]
        + [e.get("name", "") for e in lab_results + vital_signs + measurements]
    )
    for text in numeric_scan_texts:
        if text:
            _scan_text_into_vitals(text, extracted_vitals)

    for vs in vital_signs:
        _scan_text_into_vitals(f"{vs.get('name','')} {vs.get('evidence','')}", extracted_vitals)

    # Demographics
    dob = demographics.get("dob")
    sex = demographics.get("sex")
    if dob and "age_years" not in extracted_vitals:
        age = _calculate_age(dob)
        if age:
            extracted_vitals["age_years"] = age
    if sex and "sex" not in extracted_vitals:
        extracted_vitals["sex"] = str(sex).lower()

    # Human-readable summary for LLM prompts
    lines = []

    if diagnoses:
        lines.append("DIAGNOSES FROM KNOWLEDGE GRAPH:")
        for d in diagnoses[:10]:
            line = f"  • {d['name']}"
            if d["date"]:    line += f" (dated {d['date']})"
            if d["evidence"]: line += f" — {d['evidence'][:200]}"
            lines.append(line)

    if medications:
        lines.append("\nMEDICATIONS FROM KNOWLEDGE GRAPH:")
        for m in medications[:15]:
            line = f"  • {m['name']}"
            if m["evidence"]: line += f" — {m['evidence'][:200]}"
            lines.append(line)

    if lab_results:
        lines.append("\nLAB RESULTS FROM KNOWLEDGE GRAPH:")
        for lr in lab_results[:20]:
            line = f"  • {lr['name']}"
            if lr["date"]:    line += f" [{lr['date']}]"
            if lr["evidence"]: line += f": {lr['evidence'][:200]}"
            lines.append(line)

    if vital_signs:
        lines.append("\nVITAL SIGNS FROM KNOWLEDGE GRAPH:")
        for vs in vital_signs[:15]:
            line = f"  • {vs['name']}"
            if vs["evidence"]: line += f": {vs['evidence'][:150]}"
            lines.append(line)

    if treatments:
        lines.append("\nTREATMENTS FROM KNOWLEDGE GRAPH:")
        for t in treatments[:10]:
            line = f"  • {t['name']}"
            if t["date"]:    line += f" (dated {t['date']})"
            if t["evidence"]: line += f" — {t['evidence'][:200]}"
            lines.append(line)

    if findings:
        lines.append("\nCLINICAL FINDINGS FROM KNOWLEDGE GRAPH:")
        for f in findings[:10]:
            line = f"  • {f['name']}"
            if f["evidence"]: line += f" — {f['evidence'][:200]}"
            lines.append(line)

    if measurements:
        lines.append("\nMEASUREMENTS FROM KNOWLEDGE GRAPH:")
        for m in measurements[:10]:
            line = f"  • {m['name']}"
            if m["evidence"]: line += f": {m['evidence'][:150]}"
            lines.append(line)

    if anatomy:
        lines.append("\nANATOMY / ORGAN INVOLVEMENT:")
        for a in anatomy[:10]:
            line = f"  • {a['name']}"
            if a["evidence"]: line += f" — {a['evidence'][:150]}"
            lines.append(line)

    return {
        "graph_summary":          "\n".join(lines),
        "graph_raw_docs":         graph_docs,
        "graph_diagnoses":        diagnoses,
        "graph_medications":      medications,
        "graph_lab_results":      lab_results,
        "graph_vital_signs":      vital_signs,
        "graph_treatments":       treatments,
        "graph_procedures":       procedures,
        "graph_findings":         findings,
        "graph_anatomy":          anatomy,
        "graph_measurements":     measurements,
        "graph_extracted_vitals": extracted_vitals,
        "graph_demographics":     demographics,
        "graph_all_evidence":     all_evidence[:50],
    }


def _build_graph_prompt_section(state: "ProcedureState") -> str:
    """Returns a formatted string for LLM prompts summarising Neo4j graph data."""
    graph_ctx = state.get("graph_context") or {}
    summary   = graph_ctx.get("graph_summary", "")
    if not summary:
        return "KNOWLEDGE GRAPH: No graph data available for this patient."

    demographics = graph_ctx.get("graph_demographics", {})
    demo_lines   = []
    if demographics.get("dob"):
        demo_lines.append(f"Date of birth: {demographics['dob']}")
    if demographics.get("sex"):
        demo_lines.append(f"Sex: {demographics['sex']}")
    demo_str = "\n".join(demo_lines) if demo_lines else "Not available"

    extracted     = graph_ctx.get("graph_extracted_vitals", {})
    extracted_str = json.dumps(extracted, default=str) if extracted else "None extracted"
    summary_capped = summary[:4000] + ("…[truncated]" if len(summary) > 4000 else "")

    return f"""
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATIENT KNOWLEDGE GRAPH (Neo4j — authoritative clinical record)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

PATIENT DEMOGRAPHICS:
{demo_str}

GRAPH ENTITY SUMMARY:
{summary_capped}

NUMERICS EXTRACTED FROM GRAPH (for dose calculations):
{extracted_str}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"""


# ──────────────────────────────────────────────────────────────────────────────
# JSON PARSER UTILITY
# ──────────────────────────────────────────────────────────────────────────────

def log_inputs(state):
    logger.info("📥 ===== INPUT START =====")
    for key, value in state.items():
        try:
            logger.info(f"\n{key} ➜\n{json.dumps(value, indent=2, default=str)}")
        except Exception:
            logger.info(f"{key} ➜ {value}")
    logger.info("📥 ===== INPUT END =====")


def _parse_json(content: str) -> dict:
    try:
        content = content.strip()
        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0]
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0]
        start = content.find("{")
        end   = content.rfind("}")
        if start != -1 and end != -1:
            return json.loads(content[start:end + 1])
        return {}
    except Exception as e:
        logger.warning(f"JSON parse failed: {e}")
        return {}


def _with_schema(parsed: Optional[dict], template: dict) -> dict:
    """
    Deep-merge `parsed` (LLM output, arbitrary/partial shape) onto `template`
    (a fixed schema) so the RETURNED dict always has exactly the keys defined
    in template, in the same order, regardless of what the LLM produced.

    - Missing keys are filled from template defaults (empty list/None/etc).
    - Extra keys the LLM invented are dropped (keeps output format stable).
    - Nested dicts are merged recursively against their own sub-template.
    - Lists/scalars from `parsed` are used as-is when present and non-empty;
      otherwise the template default is kept.
    """
    out: Dict[str, Any] = {}
    if not isinstance(template, dict):
        return parsed if parsed is not None else template

    src = parsed if isinstance(parsed, dict) else {}

    for key, default_val in template.items():
        if key in src:
            val = src[key]
            if isinstance(default_val, dict):
                out[key] = _with_schema(val if isinstance(val, dict) else {}, default_val)
            elif isinstance(default_val, list):
                out[key] = val if isinstance(val, list) else (default_val if val in (None, "", {}) else [val])
            else:
                out[key] = val if val not in ("", None) else default_val
        else:
            out[key] = default_val
    return out


# ──────────────────────────────────────────────────────────────────────────────
# CHEMO CALCULATION ENGINE
# ──────────────────────────────────────────────────────────────────────────────

class ChemoCalculationEngine:
    """
    Extracts numeric clinical values from patient data (including graph data)
    and computes BSA, eGFR, Carboplatin AUC dose, obesity flags, etc.
    All inputs are extracted dynamically — nothing is invented.
    """

    def compute(self, state: "ProcedureState") -> Dict[str, Any]:
        clinical_data = state.get("clinical_data", {})
        summary       = state.get("patient_summary") or {}

        result = {
            "inputs_found":         {},
            "calculations":         {},
            "skipped_calculations": [],
            "dose_flags":           [],
            "warnings":             [],
        }

        raw = self._extract_numeric_fields(clinical_data, summary)
        result["inputs_found"] = raw

        weight_kg  = raw.get("weight_kg")
        height_cm  = raw.get("height_cm")
        creatinine = raw.get("creatinine_mg_dl")
        age        = raw.get("age_years")
        sex        = raw.get("sex", "").lower()
        anc        = raw.get("anc")
        platelets  = raw.get("platelets")
        hb         = raw.get("hemoglobin")
        ast        = raw.get("ast")
        alt        = raw.get("alt")
        bilirubin  = raw.get("bilirubin")
        hba1c      = raw.get("hba1c")
        fasting_bg = raw.get("fasting_blood_glucose")
        target_auc = raw.get("target_auc")

        # BSA — Mosteller
        if weight_kg and height_cm:
            bsa = round(((height_cm * weight_kg) / 3600) ** 0.5, 2)
            result["calculations"]["bsa_m2"]      = bsa
            result["calculations"]["bsa_formula"] = "Mosteller: sqrt((H×W)/3600)"
            if weight_kg > 100:
                result["dose_flags"].append({
                    "flag":     "obesity_weight_cap",
                    "detail":   f"Weight {weight_kg}kg exceeds 100kg — capped BSA may be required per protocol",
                    "severity": "moderate",
                })
            bmi = round(weight_kg / ((height_cm / 100) ** 2), 1)
            result["calculations"]["bmi"] = bmi
            if bmi > 30:
                result["dose_flags"].append({
                    "flag":     "obesity_bmi_flag",
                    "detail":   f"BMI {bmi} > 30 — obesity-adjusted dosing protocol may apply",
                    "severity": "moderate",
                })
        else:
            result["skipped_calculations"].append({
                "calculation": "BSA",
                "reason": f"Missing: {'weight' if not weight_kg else ''} {'height' if not height_cm else ''}".strip(),
            })

        # eGFR — Cockcroft-Gault
        if creatinine and age and weight_kg:
            egfr_raw = ((140 - age) * weight_kg) / (72 * creatinine)
            egfr = round(egfr_raw * (0.85 if "f" in sex else 1.0), 1)
            result["calculations"]["egfr_ml_min"]  = egfr
            result["calculations"]["egfr_formula"] = "Cockcroft-Gault"
            if egfr < 30:
                result["dose_flags"].append({
                    "flag":     "severe_renal_impairment",
                    "detail":   f"eGFR {egfr} mL/min — severe renal impairment, dose reduction or hold required",
                    "severity": "high",
                })
            elif egfr < 60:
                result["dose_flags"].append({
                    "flag":     "moderate_renal_impairment",
                    "detail":   f"eGFR {egfr} mL/min — moderate impairment, protocol-specific dose reduction recommended",
                    "severity": "moderate",
                })
        else:
            missing = [x for x, v in [("creatinine", creatinine), ("age", age), ("weight", weight_kg)] if not v]
            result["skipped_calculations"].append({
                "calculation": "eGFR",
                "reason":      f"Missing: {', '.join(missing)}",
            })

        # Carboplatin AUC dose — Calvert formula
        egfr_val = result["calculations"].get("egfr_ml_min")
        if egfr_val and target_auc:
            carbo_dose = round(target_auc * (egfr_val + 25), 0)
            result["calculations"]["carboplatin_dose_mg"]         = carbo_dose
            result["calculations"]["calvert_formula"]             = f"AUC({target_auc}) × (eGFR({egfr_val}) + 25)"
            rounded = round(carbo_dose / 50) * 50
            result["calculations"]["carboplatin_dose_rounded_mg"] = rounded
            if abs(rounded - carbo_dose) > 25:
                result["warnings"].append(
                    f"Carboplatin rounding deviation {abs(rounded - carbo_dose)}mg — verify with pharmacist"
                )
        elif target_auc and not egfr_val:
            result["skipped_calculations"].append({
                "calculation": "Carboplatin AUC dose",
                "reason":      "eGFR not calculable — cannot apply Calvert formula",
            })

        # Hepatic impairment flags
        hepatic_flags = []
        if bilirubin and bilirubin > 3.0:
            hepatic_flags.append(f"Bilirubin {bilirubin} mg/dL > 3.0 — severe hepatic impairment, hold most cytotoxics")
        elif bilirubin and bilirubin > 1.5:
            hepatic_flags.append(f"Bilirubin {bilirubin} mg/dL > 1.5 — moderate hepatic impairment, dose reduce per protocol")
        if ast and ast > 180:
            hepatic_flags.append(f"AST {ast} U/L > 3×ULN — hepatotoxicity risk, dose modification indicated")
        if alt and alt > 180:
            hepatic_flags.append(f"ALT {alt} U/L > 3×ULN — hepatotoxicity risk, dose modification indicated")
        if hepatic_flags:
            result["calculations"]["hepatic_flags"] = hepatic_flags
            for f in hepatic_flags:
                result["dose_flags"].append({"flag": "hepatic_impairment", "detail": f, "severity": "high"})

        # Diabetic monitoring flag
        if hba1c and hba1c > 6.5:
            result["dose_flags"].append({
                "flag":     "diabetic_glucose_monitoring",
                "detail":   f"HbA1c {hba1c}% — corticosteroid premedication risk for steroid-induced hyperglycemia, glucose monitoring mandatory",
                "severity": "moderate",
            })
        if fasting_bg and fasting_bg > 126:
            result["dose_flags"].append({
                "flag":     "elevated_fasting_glucose",
                "detail":   f"Fasting glucose {fasting_bg} mg/dL — active hyperglycemia, endocrine co-management required",
                "severity": "moderate",
            })

        logger.info(
            f"✅ ChemoCalculationEngine: {list(result['calculations'].keys())} | "
            f"flags={len(result['dose_flags'])} | skipped={len(result['skipped_calculations'])}"
        )
        return result

    def _extract_numeric_fields(self, clinical_data: Dict, summary: Dict) -> Dict:
        found = {}

        # ── PRIORITY 1: patient_vitals (structured data) ─────────────────────
        vitals = clinical_data.get("patient_vitals", {})
        if vitals:
            for key in ["weight", "weight_kg", "body_weight", "wt"]:
                val = vitals.get(key) or vitals.get(key.upper())
                if val:
                    try:
                        w = float(str(val).replace("kg", "").replace("Kg", "").strip())
                        if 20 <= w <= 300:
                            found["weight_kg"] = w
                            logger.info(f"✅ Weight from vitals: {w} kg")
                            break
                    except Exception:
                        pass

            for key in ["height", "height_cm", "ht"]:
                val = vitals.get(key) or vitals.get(key.upper())
                if val:
                    try:
                        h = float(str(val).replace("cm", "").replace("Cm", "").strip())
                        if 100 <= h <= 250:
                            found["height_cm"] = h
                            logger.info(f"✅ Height from vitals: {h} cm")
                            break
                    except Exception:
                        pass

            vital_lab_map = {
                "hemoglobin":    ("hemoglobin",            (1, 25),    1),
                "hb":            ("hemoglobin",            (1, 25),    1),
                "Hb":            ("hemoglobin",            (1, 25),    1),
                "platelets":     ("platelets_raw",         (0, 99999), 1),
                "platelet":      ("platelets_raw",         (0, 99999), 1),
                "PLT":           ("platelets_raw",         (0, 99999), 1),
                "anc":           ("anc_raw",               (0, 99999), 1),
                "ANC":           ("anc_raw",               (0, 99999), 1),
                "creatinine":    ("creatinine_mg_dl",      (0.1, 20),  1),
                "Creatinine":    ("creatinine_mg_dl",      (0.1, 20),  1),
                "ast":           ("ast",                   (0, 5000),  1),
                "AST":           ("ast",                   (0, 5000),  1),
                "alt":           ("alt",                   (0, 5000),  1),
                "ALT":           ("alt",                   (0, 5000),  1),
                "bilirubin":     ("bilirubin",             (0, 50),    1),
                "hba1c":         ("hba1c",                 (3, 20),    1),
                "HbA1c":         ("hba1c",                 (3, 20),    1),
                "blood_sugar":   ("fasting_blood_glucose", (30, 800),  1),
                "fasting_sugar": ("fasting_blood_glucose", (30, 800),  1),
                "FBG":           ("fasting_blood_glucose", (30, 800),  1),
            }
            for vkey, (found_key, vrange, multiplier) in vital_lab_map.items():
                val = vitals.get(vkey)
                if val is None:
                    continue
                try:
                    v = float(str(val).strip())
                    if vrange[0] <= v <= vrange[1]:
                        found[found_key] = v * multiplier
                except Exception:
                    pass

            for key in ["age", "patient_age", "Age"]:
                val = vitals.get(key)
                if val:
                    try:
                        a = float(str(val).replace("years", "").replace("yrs", "").strip())
                        if 0 <= a <= 120:
                            found["age_years"] = a
                            break
                    except Exception:
                        pass

        # ── PRIORITY 2: graph-extracted vitals ───────────────────────────────
        graph_vitals = clinical_data.get("graph_context", {}).get("graph_extracted_vitals", {})
        for key, val in graph_vitals.items():
            if key not in found and val is not None:
                found[key] = val
                logger.info(f"✅ {key} from graph: {val}")

        graph_demographics = clinical_data.get("graph_context", {}).get("graph_demographics", {})
        if graph_demographics.get("sex") and "sex" not in found:
            found["sex"] = str(graph_demographics["sex"]).lower()
        if graph_demographics.get("dob") and "age_years" not in found:
            age = _calculate_age(graph_demographics["dob"])
            if age:
                found["age_years"] = age

        # ── PRIORITY 3: Regex scan across all text sources ────────────────────
        text_parts = []

        for doc in clinical_data.get("documentation_context", []):
            if not isinstance(doc, dict):
                continue
            data_val = doc.get("data", "")
            if isinstance(data_val, (dict, list)):
                text_parts.append(json.dumps(data_val, default=str))
            elif data_val:
                try:
                    text_parts.append(json.dumps(json.loads(str(data_val)), default=str))
                except Exception:
                    text_parts.append(str(data_val))

        # Also scan graph evidence text
        graph_ctx = clinical_data.get("graph_context", {})
        for evidence_str in graph_ctx.get("graph_all_evidence", []):
            if evidence_str:
                text_parts.append(evidence_str)
        for entity_list in [
            graph_ctx.get("graph_lab_results", []),
            graph_ctx.get("graph_vital_signs", []),
            graph_ctx.get("graph_measurements", []),
        ]:
            for ent in entity_list:
                text_parts.append(f"{ent.get('name','') or ''} {ent.get('evidence','') or ''}")

        if summary:
            text_parts.append(json.dumps(summary, default=str))

        for key in ["organ_analysis", "timeline_events", "disease_causation",
                    "treatment_context", "missing_information", "clinical_insights",
                    "medical_context", "current_context", "latest_diagnosis"]:
            val = clinical_data.get(key)
            if val:
                text_parts.append(json.dumps(val, default=str))

        all_text    = " ".join(text_parts)
        cleaned     = all_text.replace('"', ' ').replace("'", ' ').replace(':', ' ').replace(',', ' ')
        search_text = all_text + " " + cleaned

        regex_patterns = {
            "weight_kg":             [r"weight[^0-9]{0,20}(\d+\.?\d*)\s*kg", r"(\d{2,3})\s*kg\b"],
            "height_cm":             [r"height[^0-9]{0,20}(\d+\.?\d*)\s*cm", r"(\d{2,3})\s*cm\b"],
            "creatinine_mg_dl":      [r"creatinine[^0-9]{0,20}(\d+\.?\d*)", r"serum\s+creatinine[^0-9]{0,10}(\d+\.?\d*)"],
            "age_years":             [r"age[^0-9]{0,10}(\d{1,3})\s*(?:year|yr|y)", r"(\d{1,3})\s*(?:year|yr)s?\s*old"],
            "anc_raw":               [r"ANC[^0-9]{0,10}(\d+\.?\d*)", r"absolute\s*neutrophil[^0-9]{0,10}(\d+\.?\d*)"],
            "platelets_raw":         [r"platelet[^0-9]{0,10}(\d+\.?\d*)", r"\bPLT\b[^0-9]{0,10}(\d+\.?\d*)"],
            "hemoglobin":            [r"h(?:emoglobin|gb|b)[^0-9]{0,10}(\d+\.?\d*)", r"\bHb\b[^0-9]{0,10}(\d+\.?\d*)"],
            "ast":                   [r"\bAST\b[^0-9]{0,10}(\d+\.?\d*)", r"\bSGOT\b[^0-9]{0,10}(\d+\.?\d*)"],
            "alt":                   [r"\bALT\b[^0-9]{0,10}(\d+\.?\d*)", r"\bSGPT\b[^0-9]{0,10}(\d+\.?\d*)"],
            "bilirubin":             [r"bilirubin[^0-9]{0,10}(\d+\.?\d*)"],
            "hba1c":                 [r"HbA1c[^0-9]{0,10}(\d+\.?\d*)", r"\bA1c\b[^0-9]{0,10}(\d+\.?\d*)"],
            "fasting_blood_glucose": [r"fasting[^0-9]{0,20}glucose[^0-9]{0,10}(\d+\.?\d*)", r"\bFBG\b[^0-9]{0,10}(\d+\.?\d*)"],
            "target_auc":            [r"(?:target\s+)?AUC[^0-9]{0,10}(\d+\.?\d*)"],
            "ecog":                  [r"ECOG[^0-9]{0,10}(\d)", r"performance\s+status[^0-9]{0,10}(\d)"],
        }
        sanity = {
            "weight_kg": (20, 300), "height_cm": (100, 250), "age_years": (0, 120),
            "creatinine_mg_dl": (0.1, 20), "hemoglobin": (1, 25),
            "anc_raw": (0, 99999), "platelets_raw": (0, 99999),
            "hba1c": (3, 20), "ecog": (0, 5),
        }
        for field, pats in regex_patterns.items():
            if field in found:
                continue
            for pat in pats:
                match = re.search(pat, search_text, re.IGNORECASE)
                if match:
                    try:
                        v = float(match.group(1))
                        lo, hi = sanity.get(field, (float("-inf"), float("inf")))
                        if lo <= v <= hi:
                            found[field] = v
                            break
                    except Exception:
                        pass

        # Unit conversion for Indian lab format
        raw_plt = found.pop("platelets_raw", None)
        if raw_plt is not None:
            if raw_plt < 50:
                converted = round(raw_plt * 100, 1)
                found["platelets"] = converted
                logger.info(f"🔬 Platelet lakh→K/μL: {raw_plt} lakh → {converted} K/μL")
            elif raw_plt > 1000:
                converted = round(raw_plt / 1000, 1)
                found["platelets"] = converted
                logger.info(f"🔬 Platelet /μL→K/μL: {raw_plt} → {converted} K/μL")
            else:
                found["platelets"] = raw_plt
                logger.info(f"🔬 Platelet already K/μL: {raw_plt}")

        raw_anc = found.pop("anc_raw", None)
        if raw_anc is not None:
            if raw_anc < 50:
                found["anc"] = round(raw_anc * 100000, 0)
                logger.info(f"🔬 ANC lakh→/μL: {raw_anc} → {found['anc']}")
            else:
                found["anc"] = raw_anc

        if "sex" not in found:
            sex_match = re.search(r"\b(male|female)\b", search_text, re.IGNORECASE)
            if sex_match:
                found["sex"] = sex_match.group(1).lower()

        found.pop("platelets_raw", None)
        found.pop("anc_raw", None)

        logger.info(f"🔬 Final extracted fields: {found}")
        return found


# ──────────────────────────────────────────────────────────────────────────────
# PRE-CHEMO VALIDATION ENGINE
# ──────────────────────────────────────────────────────────────────────────────

class PreChemoValidationEngine:
    RULES = [
        ("anc",        "<",  1500, "high",     "ANC < 1500/μL",         "hold"),
        ("anc",        "<",  1000, "critical", "ANC < 1000/μL",         "hold"),
        ("platelets",  "<",  100,  "high",     "Platelets < 100K/μL",   "hold"),
        ("platelets",  "<",   75,  "critical", "Platelets < 75K/μL",    "hold"),
        ("hemoglobin", "<",   8.0, "high",     "Hb < 8 g/dL",           "hold"),
        ("egfr",       "<",  30,   "critical", "eGFR < 30 mL/min",      "dose_reduce_or_hold"),
        ("egfr",       "<",  60,   "moderate", "eGFR < 60 mL/min",      "dose_reduce"),
        ("bilirubin",  ">",  3.0,  "critical", "Bilirubin > 3.0 mg/dL", "hold"),
        ("bilirubin",  ">",  1.5,  "high",     "Bilirubin > 1.5 mg/dL", "dose_reduce"),
        ("ast",        ">",  180,  "high",     "AST > 3×ULN (180 U/L)", "dose_reduce"),
        ("alt",        ">",  180,  "high",     "ALT > 3×ULN (180 U/L)", "dose_reduce"),
    ]

    def validate(self, state: "ProcedureState") -> Dict[str, Any]:
        calculations = state.get("chemo_calculations", {})
        inputs_found = calculations.get("inputs_found", {})
        calcs        = calculations.get("calculations", {})

        values = {**inputs_found}
        if "egfr_ml_min" in calcs:
            values["egfr"] = calcs["egfr_ml_min"]

        triggered_rules   = []
        hold_flags        = []
        dose_reduce_flags = []
        missing_required  = []
        overall_decision  = "proceed"

        for cf in ["anc", "platelets", "hemoglobin"]:
            if cf not in values:
                missing_required.append({
                    "field":  cf,
                    "reason": "Required for chemo clearance — must obtain before proceeding",
                })

        for rule in self.RULES:
            field, op, threshold, severity, rule_text, action = rule
            val = values.get(field)
            if val is None:
                continue
            triggered = (op == "<" and val < threshold) or (op == ">" and val > threshold)
            if triggered:
                triggered_rules.append({
                    "rule":      rule_text,
                    "value":     val,
                    "threshold": threshold,
                    "severity":  severity,
                    "action":    action,
                    "guideline": "ASCO/NCCN standard chemotherapy hold/reduce criteria",
                })
                if action == "hold" and severity == "critical":
                    hold_flags.append(rule_text)
                    overall_decision = "critical_hold"
                elif action in ("hold", "dose_reduce_or_hold") and overall_decision != "critical_hold":
                    hold_flags.append(rule_text)
                    overall_decision = "hold"
                elif action == "dose_reduce" and overall_decision == "proceed":
                    dose_reduce_flags.append(rule_text)
                    overall_decision = "dose_reduce"

        if missing_required and overall_decision == "proceed":
            overall_decision = "labs_required"

        result = {
            "overall_decision":      overall_decision,
            "triggered_rules":       triggered_rules,
            "hold_flags":            hold_flags,
            "dose_reduce_flags":     dose_reduce_flags,
            "missing_required_labs": missing_required,
            "values_evaluated":      values,
            "validation_timestamp":  datetime.utcnow().isoformat(),
            "gate_passed":           overall_decision in ("proceed", "dose_reduce"),
        }
        logger.info(
            f"✅ PreChemoValidation: decision={overall_decision} | "
            f"rules_triggered={len(triggered_rules)} | missing={len(missing_required)}"
        )
        return result


# ──────────────────────────────────────────────────────────────────────────────
# TOXICITY ASSESSMENT ENGINE
# ──────────────────────────────────────────────────────────────────────────────

class ToxicityAssessmentEngine:
    ANC_GRADES = [
        (1500, float("inf"), 0, "Normal"),
        (1000, 1500,         1, "Grade 1 — Mild neutropenia"),
        (500,  1000,         2, "Grade 2 — Moderate neutropenia"),
        (500,  500,          3, "Grade 3 — Severe neutropenia"),
        (0,    500,          4, "Grade 4 — Life-threatening neutropenia"),
    ]
    PLT_GRADES = [
        (100, float("inf"), 0, "Normal"),
        (75,  100,          1, "Grade 1"),
        (50,  75,           2, "Grade 2"),
        (25,  50,           3, "Grade 3"),
        (0,   25,           4, "Grade 4 — Life-threatening"),
    ]
    HB_GRADES = [
        (10,  float("inf"), 0, "Normal or Grade 1"),
        (8,   10,           2, "Grade 2 — Moderate anemia"),
        (6.5, 8,            3, "Grade 3 — Severe anemia"),
        (0,   6.5,          4, "Grade 4 — Life-threatening anemia"),
    ]

    def assess(self, state: "ProcedureState") -> Dict[str, Any]:
        calculations = state.get("chemo_calculations", {})
        inputs       = calculations.get("inputs_found", {})

        anc       = inputs.get("anc")
        platelets = inputs.get("platelets")
        hb        = inputs.get("hemoglobin")

        result = {
            "ctcae_grades":               {},
            "febrile_neutropenia_risk":   None,
            "dose_reduction_next_cycle":  [],
            "gcsf_recommendation":        None,
            "next_cycle_delay_suggested": False,
            "assessment_notes":           [],
        }

        if anc is not None:
            grade = self._grade(anc, self.ANC_GRADES)
            result["ctcae_grades"]["neutropenia"] = grade
            if anc < 500:
                result["febrile_neutropenia_risk"]   = "high"
                result["gcsf_recommendation"]        = "G-CSF (filgrastim/pegfilgrastim) indicated — ANC < 500/μL"
                result["next_cycle_delay_suggested"] = True
                result["dose_reduction_next_cycle"].append("Consider 20–25% dose reduction if ANC nadir < 500")
            elif anc < 1000:
                result["febrile_neutropenia_risk"] = "moderate"
                result["gcsf_recommendation"]      = "Consider prophylactic G-CSF based on regimen risk category"
            else:
                result["febrile_neutropenia_risk"] = "low"

        if platelets is not None:
            grade = self._grade(platelets, self.PLT_GRADES)
            result["ctcae_grades"]["thrombocytopenia"] = grade
            if platelets < 50:
                result["next_cycle_delay_suggested"] = True
                result["dose_reduction_next_cycle"].append(
                    "Platelet-nadir < 50K — hold or reduce next cycle per protocol"
                )

        if hb is not None:
            grade = self._grade(hb, self.HB_GRADES)
            result["ctcae_grades"]["anemia"] = grade
            if hb < 8:
                result["assessment_notes"].append(
                    f"Hb {hb} g/dL — transfusion threshold consideration required"
                )

        longitudinal = state.get("longitudinal_data", {})
        cumulative   = longitudinal.get("cumulative_doses", {})
        if "doxorubicin_mg" in cumulative:
            total_dox = cumulative["doxorubicin_mg"]
            if total_dox >= 400:
                result["assessment_notes"].append(
                    f"Cumulative doxorubicin {total_dox}mg — approaching cardiotoxicity threshold "
                    "(450–550 mg/m²). Cardiac monitoring mandatory."
                )
            if total_dox >= 450:
                result["dose_reduction_next_cycle"].append(
                    "Cumulative anthracycline dose ≥ 450mg — evaluate cardiac function before next cycle. "
                    "Hard stop at 550mg."
                )

        logger.info(
            f"✅ ToxicityAssessment: grades={list(result['ctcae_grades'].keys())} | "
            f"FN_risk={result['febrile_neutropenia_risk']}"
        )
        return result

    def _grade(self, value: float, grade_table: list) -> Dict:
        for low, high, grade_num, label in grade_table:
            if low <= value < high:
                return {"value": value, "grade": grade_num, "label": label}
        return {"value": value, "grade": 4, "label": "Grade 4 — Life-threatening"}


# ──────────────────────────────────────────────────────────────────────────────
# LONGITUDINAL TRACKING ENGINE
# ──────────────────────────────────────────────────────────────────────────────

class LongitudinalTrackingEngine:
    LIFETIME_LIMITS_MG = {
        "doxorubicin":  550,
        "epirubicin":   900,
        "daunorubicin": 550,
        "idarubicin":   150,
        "mitoxantrone": 160,
        "bleomycin":    400,
    }

    async def track(self, state: "ProcedureState") -> Dict[str, Any]:
        patient_id = state["patient_id"]

        result = {
            "completed_cycles":   0,
            "cumulative_doses":   {},
            "hard_stop_triggers": [],
            "toxicity_trend":     [],
            "cycle_history":      [],
        }

        try:
            past_notes = await procedure_notes_collection.find(
                {"patient_id": patient_id, "mode": "order"},
                {"_id": 0, "created_at": 1, "treatment_procedure": 1,
                 "post_procedure": 1, "selected_procedure": 1},
            ).sort("created_at", 1).to_list(length=50)

            result["completed_cycles"] = len(past_notes)

            for note in past_notes:
                cycle_entry = {
                    "date":      str(note.get("created_at", "")),
                    "procedure": note.get("selected_procedure", ""),
                }
                treatment = note.get("treatment_procedure", {})
                if isinstance(treatment, dict):
                    meds = treatment.get("medication_details", {}).get("medications", [])
                    for med in meds:
                        name      = med.get("name", "").lower()
                        dose_str  = str(med.get("dose", ""))
                        dose_match = re.search(r"(\d+\.?\d*)\s*mg", dose_str)
                        if dose_match:
                            dose_val = float(dose_match.group(1))
                            for drug_key in self.LIFETIME_LIMITS_MG:
                                if drug_key in name:
                                    result["cumulative_doses"][f"{drug_key}_mg"] = (
                                        result["cumulative_doses"].get(f"{drug_key}_mg", 0) + dose_val
                                    )
                result["cycle_history"].append(cycle_entry)

            for drug, cumulative in result["cumulative_doses"].items():
                drug_name = drug.replace("_mg", "")
                limit = self.LIFETIME_LIMITS_MG.get(drug_name)
                if limit and cumulative >= limit:
                    result["hard_stop_triggers"].append({
                        "drug":          drug_name,
                        "cumulative_mg": cumulative,
                        "limit_mg":      limit,
                        "action":        "HARD STOP — lifetime dose exceeded. No further administration.",
                        "severity":      "critical",
                    })
                elif limit and cumulative >= limit * 0.85:
                    result["hard_stop_triggers"].append({
                        "drug":          drug_name,
                        "cumulative_mg": cumulative,
                        "limit_mg":      limit,
                        "action":        "WARNING — within 15% of lifetime limit. Cardiac/organ evaluation required.",
                        "severity":      "high",
                    })

            logger.info(
                f"✅ LongitudinalTracking: cycles={result['completed_cycles']} | "
                f"cumulative={result['cumulative_doses']} | hard_stops={len(result['hard_stop_triggers'])}"
            )
        except Exception as e:
            logger.error(f"LongitudinalTrackingEngine failed: {e}")

        return result


# ──────────────────────────────────────────────────────────────────────────────
# CHEMO AUDIT LOGGER
# ──────────────────────────────────────────────────────────────────────────────

class ChemoAuditLogger:
    async def log(self, state: "ProcedureState") -> Dict[str, Any]:
        validation   = state.get("chemo_validation", {})
        calcs        = state.get("chemo_calculations", {})
        toxicity     = state.get("toxicity_assessment", {})
        longitudinal = state.get("longitudinal_data", {})

        gate_passed = validation.get("gate_passed", True)
        decision    = validation.get("overall_decision", "unknown")

        audit_entry = {
            "timestamp":               datetime.utcnow().isoformat(),
            "doctor_id":               state["doctor_id"],
            "patient_id":              state["patient_id"],
            "procedure":               state.get("selected_procedure"),
            "mode":                    state["mode"],
            "validation_decision":     decision,
            "gate_passed":             gate_passed,
            "triggered_rules":         validation.get("triggered_rules", []),
            "missing_labs":            validation.get("missing_required_labs", []),
            "calculations_performed":  list(calcs.get("calculations", {}).keys()),
            "hard_stop_triggers":      longitudinal.get("hard_stop_triggers", []),
            "ctcae_grades":            toxicity.get("ctcae_grades", {}),
            "dose_flags":              calcs.get("dose_flags", []),
            "guideline_framework":     "ASCO/NCCN/ESMO standard parameters",
            "override_required":       not gate_passed,
            "override_logged":         False,
        }

        try:
            await chemo_audit_collection.insert_one({**audit_entry})
            logger.info(f"✅ Audit logged: decision={decision} | gate_passed={gate_passed}")
        except Exception as e:
            logger.error(f"Audit log failed: {e}")

        return audit_entry


# ──────────────────────────────────────────────────────────────────────────────
# LANGGRAPH STATE
# ──────────────────────────────────────────────────────────────────────────────

class ProcedureState(TypedDict):
    doctor_id:          str
    patient_id:         str
    selected_procedure: Optional[str]
    mode:               str
    specialization:     str

    clinical_data:   Dict[str, Any]
    patient_summary: Optional[Dict[str, Any]]
    last_order:      Optional[Dict[str, Any]]

    suggested_procedures:       List[Dict[str, Any]]
    patient_abstract:           str
    pre_procedure:              Dict[str, Any]
    during_procedure:           Dict[str, Any]
    post_procedure:             Dict[str, Any]

    final_output:                 Optional[Dict[str, Any]]
    error:                        Optional[str]
    warnings:                     List[str]
    alerts_output:                Dict[str, Any]
    treatment_procedure_output:   Dict[str, Any]

    chemo_calculations:  Dict[str, Any]
    chemo_validation:    Dict[str, Any]
    toxicity_assessment: Dict[str, Any]
    longitudinal_data:   Dict[str, Any]
    audit_log:           Dict[str, Any]
    safety_gate_passed:  bool

    # Graph fields
    graph_documents:  List[Dict[str, Any]]
    graph_context:    Dict[str, Any]
    tumor_board_data: str


# ──────────────────────────────────────────────────────────────────────────────
# CONTEXT LOADER AGENT
# ──────────────────────────────────────────────────────────────────────────────

class ContextLoaderAgent:
    async def load(self, state: ProcedureState) -> ProcedureState:
        log_inputs(state)
        logger.info("ContextLoaderAgent — START")
        patient_id         = state["patient_id"]
        selected_procedure = state["selected_procedure"]
        mode               = state["mode"]
        clinical_data      = {}

        # Medical context
        doc = await medical_context_collection.find_one({"patient_id": patient_id}, {"_id": 0})
        medical_context = []
        if doc:
            for ctx in doc.get("medical_contexts", []):
                if ctx.get("enabled"):
                    texts = [c.get("text") for c in ctx.get("conditions", []) if c.get("text")]
                    if texts:
                        medical_context.append({"date": ctx.get("date"), "conditions": texts})
        if medical_context:
            clinical_data["medical_context"] = medical_context

        # Current context
        doc = await current_context_collection.find_one({"patient_id": patient_id}, {"_id": 0})
        current_context = []
        if doc:
            for ctx in doc.get("current_contexts", []):
                if ctx.get("enabled"):
                    texts = [c.get("text") for c in ctx.get("current_condition", []) if c.get("text")]
                    if texts:
                        current_context.append({"date": ctx.get("date"), "current_condition": texts})
        if current_context:
            clinical_data["current_context"] = current_context

        # Procedure history
        if selected_procedure:
            past_procedures = await procedure_notes_collection.find(
                {"patient_id": patient_id, "selected_procedure": selected_procedure},
                {"_id": 0, "selected_procedure": 1, "mode": 1, "created_at": 1,
                 "pre_procedure": 1, "during_procedure": 1, "post_procedure": 1, "patient_abstract": 1},
            ).sort("created_at", 1).to_list(length=10)

            procedure_history = []
            for note in past_procedures:
                procedure_history.append({
                    "date": note.get("created_at"),
                    "mode": note.get("mode"),
                    "summary": {
                        "pre":    note.get("pre_procedure"),
                        "during": note.get("during_procedure"),
                        "post":   note.get("post_procedure"),
                    },
                })
            if procedure_history:
                clinical_data["procedure_history"] = procedure_history

        # Patient summary
        logger.info(f"🔍 patient_id used: {patient_id}")
        summary = await summary_collection.find_one(
            {"patient_id": patient_id},
            sort=[("_id", -1)],
        )
        logger.info(f"🔍 RAW summary result: {summary}")
        state["patient_summary"] = summary

        if summary:
            logger.info(f"🧾 Patient Summary Loaded:\n{json.dumps(summary, indent=2, default=str)}")
        else:
            logger.info("⚠️ No patient summary found")

        if summary:
            clinical_data["patient_summary_available"] = True

        # Latest Diagnosis
        latest_diagnosis = await diagnosis_data_collection.find_one(
            {"patient_id": patient_id, "doctor_id": state["doctor_id"]},
            sort=[("updated_at", -1)],
        )
        if latest_diagnosis:
            clinical_data["latest_diagnosis"] = latest_diagnosis.get("diagnosis")
            logger.info(f"✅ Latest diagnosis loaded: {latest_diagnosis.get('diagnosis')}")

        # Extract from patient summary
        if summary:
            clinical_data["full_patient_summary"] = summary
            sg = summary.get("structured_graph", {})
            if sg:
                clinical_data["structured_graph_data"] = sg
                for key in ["organ_analysis", "timeline", "disease_causation",
                            "treatment_context", "missing_information", "clinical_insights"]:
                    if key in sg:
                        mapped = {"timeline": "timeline_events"}.get(key, key)
                        clinical_data[mapped] = sg[key]

        # Last order (report mode)
        if mode == "report" and selected_procedure:
            last_order = await procedure_notes_collection.find_one(
                {"patient_id": patient_id, "selected_procedure": selected_procedure, "mode": "order"},
                sort=[("created_at", -1)],
                projection={"_id": 0},
            )
            if not last_order:
                logger.warning("No prior order found — switching to ORDER mode")
                state["mode"]       = "order"
                state["last_order"] = None
            else:
                state["last_order"] = last_order

        # Documentation context
        documentation_data = []
        for col in [
            documentation_treatment_plan_collection,
            documentation_investigation_notes_collection,
            documentation_medication_analysis_collection,
            documentation_treatment_summary_collection,
            documentation_clinical_notes_collection,
        ]:
            cursor = col.find({"patient_id": patient_id}).sort("created_at", -1).limit(5)
            async for doc in cursor:
                documentation_data.append({"feature": doc.get("feature_id"), "data": doc.get("finaloutput")})
        if documentation_data:
            clinical_data["documentation_context"] = documentation_data

        # Patient vitals
        try:
            vitals_doc = await patient_vitals_collection.find_one(
                {"patient_id": patient_id}, sort=[("updated_at", -1)]
            )
            if not vitals_doc:
                vitals_doc = await patient_vitals_collection.find_one(
                    {"sys_user_id": patient_id}, sort=[("updated_at", -1)]
                )
            if vitals_doc:
                vitals_data   = vitals_doc.get("vitals", {})
                merged_vitals = {}
                for ts_key in sorted(vitals_data.keys()):
                    entry = vitals_data[ts_key]
                    if isinstance(entry, dict):
                        merged_vitals.update(entry)
                clinical_data["patient_vitals"] = merged_vitals
                logger.info(f"✅ Patient vitals loaded: {list(merged_vitals.keys())}")
            else:
                logger.info("⚠️ No patient vitals found")
        except Exception as e:
            logger.error(f"Patient vitals fetch failed: {e}")

        # Fetch graph documents and demographics
        try:
            graph_docs, demographics = await _fetch_graph_and_demographics(patient_id)
            state["graph_documents"] = graph_docs
            graph_context = process_graph_into_clinical_context(graph_docs, demographics)
            state["graph_context"]   = graph_context
            clinical_data["graph_context"] = graph_context
            logger.info(
                f"✅ Graph context loaded: "
                f"diagnoses={len(graph_context.get('graph_diagnoses', []))} | "
                f"labs={len(graph_context.get('graph_lab_results', []))} | "
                f"vitals={len(graph_context.get('graph_vital_signs', []))} | "
                f"medications={len(graph_context.get('graph_medications', []))}"
            )
        except Exception as e:
            logger.error(f"Graph/demographics fetch failed: {e}")
            state["graph_documents"] = []
            state["graph_context"]   = {}

        state["clinical_data"] = clinical_data
        logger.info(f"Context loaded: {list(clinical_data.keys())}")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# GRAPH CONTEXT NODE (LangGraph node)
# ──────────────────────────────────────────────────────────────────────────────

async def graph_context_node(state: ProcedureState) -> ProcedureState:
    """
    Ensures graph_context is merged into clinical_data after the context loader.
    If graph_context is already populated (by ContextLoaderAgent), this is a no-op.
    """
    graph_ctx     = state.get("graph_context") or {}
    clinical_data = state.get("clinical_data", {})

    if graph_ctx and "graph_context" not in clinical_data:
        clinical_data["graph_context"] = graph_ctx
        state["clinical_data"] = clinical_data

    logger.info(
        f"📊 GraphContextNode: diagnoses={len(graph_ctx.get('graph_diagnoses', []))}, "
        f"labs={len(graph_ctx.get('graph_lab_results', []))}, "
        f"meds={len(graph_ctx.get('graph_medications', []))}, "
        f"vital_signs={len(graph_ctx.get('graph_vital_signs', []))}"
    )
    return state


# ──────────────────────────────────────────────────────────────────────────────
# PROCEDURE SUGGESTION AGENT
# ──────────────────────────────────────────────────────────────────────────────

class ProcedureSuggestionAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def suggest(self, state: ProcedureState) -> ProcedureState:
        logger.info("ProcedureSuggestionAgent — START")
        specialization = state["specialization"]
        clinical_data  = state["clinical_data"]
        summary        = state.get("patient_summary")

        oncology_specialties = [
            "Medical Oncology", "Chemotherapy", "Immunotherapy", "Targeted therapy",
            "Hormone therapy", "Precision oncology", "Radiation Oncology",
            "External beam radiotherapy", "Brachytherapy", "Stereotactic radiosurgery",
            "Surgical Oncology", "Curative surgery", "Cytoreductive surgery",
            "Reconstructive surgery", "Breast Oncology", "Thoracic Oncology",
            "Gastrointestinal Oncology", "Gynecologic Oncology", "Urologic Oncology",
            "Head and Neck Oncology", "Neuro-oncology", "Pediatric Oncology",
            "Hematologic Oncology", "Imaging Oncology", "Pathology", "Histopathology",
            "Cytology", "Molecular pathology", "Molecular Oncology", "Biomarker Analysis",
            "Nuclear Medicine", "Interventional Oncology", "Ablation therapies",
            "Embolization", "Research Oncology", "Palliative Oncology", "Pain Management",
            "Rehabilitation Oncology", "Nutritional Oncology", "Psycho-oncology",
            "Preventive Oncology", "Cancer Screening Programs", "Genetic Counseling",
        ]

        specialization_lower = specialization.lower()
        is_oncology = any(
            s.lower() in specialization_lower or specialization_lower in s.lower()
            for s in oncology_specialties
        )

        graph_section = _build_graph_prompt_section(state)

        prompt = f"""
You are a HIGH-RELIABILITY CLINICAL WORKFLOW RECOMMENDATION ENGINE.

Doctor Specialization: {specialization}

{graph_section}

Patient Clinical Data:
{json.dumps(clinical_data, indent=2, default=str)[:3000]}

Historical Procedure Context (if any):
{json.dumps(clinical_data.get("procedure_history", []), indent=2)}

TASK 1: PROCEDURE SUGGESTION
Suggest ONLY procedures that are routinely performed within the given specialization
and logically relevant to the patient's documented conditions (including graph data above).
Procedures must be HIGH-LEVEL workflows, NOT medications or tests.

TASK 2: PATIENT ABSTRACT
Generate a SHORT, CLINICAL ABSTRACT (3–5 sentences) that:
- Summarizes the patient's condition using graph-confirmed findings
- Uses neutral, professional medical language
- STRICTLY reflects provided clinical data only

CRITICAL SAFETY RULES:
⛔ DO NOT invent diagnoses, stages, or lab values
⛔ DO NOT include treatment plans or medications
⛔ DO NOT include explanations outside JSON

OUTPUT FORMAT (JSON ONLY):
{{
  "suggested_procedures": [
    {{
      "name": "<procedure_name>",
      "reason": "<clear, data-linked justification>"
    }}
  ],
  "patient_abstract": "<concise clinical summary>"
}}
"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You are a clinical workflow recommendation engine. Output only valid JSON."),
                HumanMessage(content=prompt),
            ])
            parsed     = _parse_json(response.content)
            procedures = parsed.get("suggested_procedures", [])

            if not procedures:
                logger.warning("LLM returned empty procedures — retrying...")
                retry_response = self.llm.invoke([
                    SystemMessage(content="Return ONLY 2–3 procedures based on specialization."),
                    HumanMessage(content=prompt),
                ])
                parsed     = _parse_json(retry_response.content)
                procedures = parsed.get("suggested_procedures", [])

            if is_oncology:
                existing_names = [p.get("name", "").lower() for p in procedures]
                core = [
                    {"name": "Chemotherapy",     "reason": f"Standard systemic therapy for {specialization} patients."},
                    {"name": "Radiation Therapy", "reason": f"Standard localized treatment for {specialization} patients."},
                    {"name": "Immunotherapy",    "reason": f"Standard or emerging treatment for {specialization} patients."},
                ]
                for c in core:
                    cn = c["name"].lower()
                    already = (
                        cn in existing_names
                        or (cn == "radiation therapy" and any(v in existing_names for v in ["radiotherapy", "radiation oncology"]))
                    )
                    if not already:
                        procedures.append(c)

                seen, unique = set(), []
                for p in procedures:
                    n = p.get("name", "").lower()
                    if n not in seen:
                        seen.add(n)
                        unique.append(p)

                ordered = []
                for pname in ["Chemotherapy", "Radiation Therapy", "Immunotherapy"]:
                    for p in unique:
                        if p.get("name") == pname:
                            ordered.append(p)
                            break
                for p in unique:
                    if p not in ordered:
                        ordered.append(p)
                procedures = ordered

            elif not procedures:
                procedures = [{"name": f"{specialization} Procedure", "reason": "Standard clinical procedure"}]

            max_procedures = 8 if is_oncology else 3
            procedures     = procedures[:max_procedures]

            state["suggested_procedures"] = procedures
            state["patient_abstract"]     = parsed.get("patient_abstract", "")

            logger.info("🧠 Final Suggested Procedures:")
            for idx, proc in enumerate(state["suggested_procedures"], 1):
                logger.info(f"  {idx}. {proc.get('name')}")

        except Exception as e:
            logger.error(f"ProcedureSuggestionAgent failed: {e}")
            if is_oncology:
                state["suggested_procedures"] = [
                    {"name": "Chemotherapy",     "reason": "Standard systemic cancer therapy"},
                    {"name": "Radiation Therapy", "reason": "Standard localized cancer treatment"},
                    {"name": "Immunotherapy",    "reason": "Standard immune-based cancer treatment"},
                ]
            else:
                state["suggested_procedures"] = [
                    {"name": f"{specialization} Procedure", "reason": "Standard clinical procedure"}
                ]
            state["patient_abstract"] = ""

        return state

    def _build_summary_context(self, summary: Optional[Dict]) -> str:
        if not summary:
            return "Not available"
        try:
            parts = []
            if "clinical_summary" in summary:
                cs = summary["clinical_summary"]
                parts.append(json.dumps(cs, indent=2) if isinstance(cs, dict) else str(cs)[:1000])
            if "structured_graph" in summary:
                sg = summary["structured_graph"]
                if "primary_driver" in sg:
                    parts.append(f"Primary diagnosis: {json.dumps(sg['primary_driver'])}")
            return "\n".join(parts) if parts else "Not available"
        except Exception:
            return "Not available"


# ──────────────────────────────────────────────────────────────────────────────
# ALERTS + IMPORTANT AGENT
# ──────────────────────────────────────────────────────────────────────────────

class AlertsImportantAgent:
    TEMPLATE = {
        "alerts":    [],
        "important": [],
    }

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def process(self, state: ProcedureState) -> ProcedureState:
        log_inputs(state)
        clinical_data  = state.get("clinical_data", {})
        diagnosis      = clinical_data.get("latest_diagnosis", "")
        documentation  = clinical_data.get("documentation_context", [])
        summary        = state.get("patient_summary")
        procedure      = state.get("selected_procedure")
        treatment      = state.get("treatment_procedure_output", {})
        specialization = state.get("specialization", "")

        tumor_board_data = ""
        try:
            patient_id = state.get("patient_id") or (summary.get("patient_id") if summary else None)
            if patient_id:
                latest_tb = await tumor_board_collection.find_one(
                    {"patient_id": {"$regex": f"^{patient_id.strip()}$", "$options": "i"}},
                    sort=[("created_at", -1)],
                )
                if latest_tb and latest_tb.get("doctor_recommendation"):
                    tumor_board_data = latest_tb["doctor_recommendation"]
        except Exception as e:
            logger.warning(f"Tumor board fetch: {e}")

        state["tumor_board_data"] = tumor_board_data

        graph_section = _build_graph_prompt_section(state)
        doc_text      = "\n".join([str(d.get("data", "")) for d in documentation if isinstance(d, dict)])
        summary_text  = str(summary) if summary and isinstance(summary, dict) else ""

        prompt = f"""
You are an experienced clinical reasoning assistant.

Your task is to deeply analyze the patient in the context of the selected procedure.

Procedure: {procedure}
Specialization: {specialization}
Diagnosis: {diagnosis}

{graph_section}

Patient Summary:
{summary_text[:2000]}

Documentation:
{doc_text[:2000]}

Treatment Plan:
{str(treatment)[:1000]}

Tumor Board Recommendation:
{tumor_board_data}

Approach this like a real clinician using ALL available data including the knowledge graph:
- First understand what the procedure involves
- Identify anything unsafe, conflicting, incomplete, or clinically meaningful
- Especially flag anything from the graph that contradicts current orders or raises risks

Generate two types of outputs:

1. Alerts — things that may indicate risk, inconsistency, missing critical data, or potential harm
2. Important — clinically meaningful insights that may influence decision-making

Output STRICT JSON matching EXACTLY this schema (both keys are ALWAYS required,
use an empty array if there is nothing to report — never omit a key):
{{
  "alerts": [
    {{
      "type": "Short label",
      "message": "Clear, specific, patient-contextual explanation"
    }}
  ],
  "important": [
    {{
      "type": "Short label",
      "message": "Clear, clinically meaningful explanation"
    }}
  ]
}}

Rules:
- "message" must be specific to THIS patient and THIS procedure
- Avoid vague phrases without context
- Do not repeat the same idea
- If nothing meaningful is found, return empty arrays — DO NOT omit the "alerts" or "important" keys
- Return ONLY valid JSON. No extra text.
"""

        try:
            response = self.llm.invoke([
                SystemMessage(content="You generate clinical alerts and importance. Output ONLY JSON."),
                HumanMessage(content=prompt),
            ])
            parsed = _parse_json(response.content)
            state["alerts_output"] = _with_schema(parsed, self.TEMPLATE)
        except Exception as e:
            logger.error(f"AlertsImportantAgent failed: {e}")
            state["alerts_output"] = _with_schema({
                "alerts":    [{"type": "Error", "message": "Unable to generate alerts due to processing error"}],
                "important": [{"type": "Error", "message": "Review patient data manually"}],
            }, self.TEMPLATE)

        return state


# ──────────────────────────────────────────────────────────────────────────────
# TREATMENT PROCEDURE AGENT
# ──────────────────────────────────────────────────────────────────────────────

class TreatmentProcedureAgent:
    # Canonical, ALWAYS-present output schema — identical regardless of
    # procedure type (Chemotherapy, Radiation Therapy, Immunotherapy, etc.).
    # Fields that don't apply to a given procedure are simply left as
    # empty list / null, never removed, so downstream consumers (frontend,
    # report assembler) always see the same JSON shape.
    TEMPLATE = {
        "procedure_steps": {
            "title": "TREATMENT PROCEDURE STEPS",
            "steps": [],
        },
        "medication_details": {
            "title": "MEDICATION DETAILS",
            "medications": [],
        },
        "safety_validation": {
            "title": "PRE-TREATMENT VALIDATION",
            "clinical_flags": [],
            "bsa_or_weight": [],
            "recommendations": [],
        },
        "drug_interactions": {
            "title": "DRUG INTERACTION AND CONTRAINDICATIONS",
            "high_risk": [],
            "moderate_risk": [],
        },
        "preparation_validation": {
            "title": "PREPARATION AND INFUSION VALIDATION",
            "dilution_instructions": [],
            "stability": None,
            "infusion_rate": None,
            "line_compatibility": None,
        },
        "monitoring_checklist": {
            "title": "DURING TREATMENT MONITORING",
            "checks": [],
            "emergency_preparedness": [],
        },
        "post_procedure_toxicity": {
            "title": "POST-PROCEDURE TOXICITY AND FOLLOW-UP",
            "risk_assessment": None,
            "decision": [],
        },
        "followup_plan": {
            "title": "FOLLOW-UP AND LAB SCHEDULING",
            "next_labs": [],
            "alerts": [],
            "patient_notification": None,
        },
    }

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def process(self, state: ProcedureState) -> ProcedureState:
        log_inputs(state)
        clinical_data  = state.get("clinical_data", {})
        summary        = state.get("patient_summary")
        procedure      = state.get("selected_procedure")
        specialization = state.get("specialization", "")

        if not procedure:
            state["treatment_procedure_output"] = {}
            return state

        diagnosis         = clinical_data.get("latest_diagnosis", "")
        documentation     = clinical_data.get("documentation_context", [])
        organ_analysis    = clinical_data.get("organ_analysis", {})
        timeline_events   = clinical_data.get("timeline_events", [])
        clinical_insights = clinical_data.get("clinical_insights", {})
        missing_info      = clinical_data.get("missing_information", {})
        treatment_context = clinical_data.get("treatment_context", {})

        summary_text     = ""
        structured_graph = {}
        if summary:
            cs = summary.get("clinical_summary", {})
            summary_text = (
                cs.get("clinical_summary", "") or json.dumps(cs, default=str)
                if isinstance(cs, dict) else str(cs)
            )
            structured_graph = summary.get("structured_graph", {})

        primary_driver    = structured_graph.get("primary_driver", {})
        disease_causation = structured_graph.get("disease_causation", {})
        timeline          = structured_graph.get("timeline", [])
        treatment_ctx     = structured_graph.get("treatment_context", {}) or treatment_context
        missing_sg        = structured_graph.get("missing_information", {}) or missing_info
        clinical_ins      = structured_graph.get("clinical_insights", {}) or clinical_insights
        organ_sg          = structured_graph.get("organ_analysis", {}) or organ_analysis

        tumor_board_data = ""
        try:
            patient_id = state.get("patient_id") or (summary.get("patient_id") if summary else None)
            if patient_id:
                latest_tb = await tumor_board_collection.find_one(
                    {"patient_id": {"$regex": f"^{patient_id.strip()}$", "$options": "i"}},
                    sort=[("created_at", -1)],
                )
                if latest_tb and latest_tb.get("doctor_recommendation"):
                    tumor_board_data = latest_tb["doctor_recommendation"]
        except Exception as e:
            logger.warning(f"Tumor board fetch: {e}")

        state["tumor_board_data"] = tumor_board_data

        doc_text      = "\n".join(str(d.get("data", "")) for d in documentation if isinstance(d, dict))
        graph_section = _build_graph_prompt_section(state)

        chemo_calcs      = state.get("chemo_calculations", {})
        chemo_validation = state.get("chemo_validation", {})
        longitudinal     = state.get("longitudinal_data", {})

        calc_context = {
            "bsa_m2":                chemo_calcs.get("calculations", {}).get("bsa_m2"),
            "egfr_ml_min":           chemo_calcs.get("calculations", {}).get("egfr_ml_min"),
            "bmi":                   chemo_calcs.get("calculations", {}).get("bmi"),
            "carboplatin_dose_mg":   chemo_calcs.get("calculations", {}).get("carboplatin_dose_mg"),
            "dose_flags":            chemo_calcs.get("dose_flags", []),
            "safety_decision":       chemo_validation.get("overall_decision"),
            "triggered_rules":       chemo_validation.get("triggered_rules", []),
            "missing_required_labs": chemo_validation.get("missing_required_labs", []),
            "completed_cycles":      longitudinal.get("completed_cycles", 0),
            "cumulative_doses":      longitudinal.get("cumulative_doses", {}),
            "hard_stop_triggers":    longitudinal.get("hard_stop_triggers", []),
        }

        prompt = f"""
You are a senior clinical specialist in {specialization}.
Generate a real-world, hospital-grade treatment output for: {procedure}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
PATIENT DATA
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

DIAGNOSIS:
{diagnosis if diagnosis else "NOT PROVIDED"}

CLINICAL SUMMARY:
{summary_text if summary_text else "NOT PROVIDED"}

{graph_section}

PRIMARY DISEASE DRIVER:
{json.dumps(primary_driver, indent=2, default=str) if primary_driver else "NOT PROVIDED"}

DISEASE CAUSATION AND PATHOLOGY:
{json.dumps(disease_causation, indent=2, default=str) if disease_causation else "NOT PROVIDED"}

TREATMENT CONTEXT (prior treatments, constraints, comorbidities):
{json.dumps(treatment_ctx, indent=2, default=str) if treatment_ctx else "NOT PROVIDED"}

CLINICAL INSIGHTS AND NEXT ACTIONS:
{json.dumps(clinical_ins, indent=2, default=str) if clinical_ins else "NOT PROVIDED"}

DISEASE TIMELINE:
{json.dumps(timeline, indent=2, default=str) if timeline else "NOT PROVIDED"}

ORGAN ANALYSIS:
{json.dumps(organ_sg, indent=2, default=str) if organ_sg else "NOT PROVIDED"}

MISSING CLINICAL DATA:
{json.dumps(missing_sg, indent=2, default=str) if missing_sg else "NOT PROVIDED"}

INVESTIGATION AND DOCUMENTATION RECORDS:
{doc_text[:3000] if doc_text.strip() else "NOT PROVIDED"}

TUMOR BOARD RECOMMENDATION:
{tumor_board_data if tumor_board_data else "NOT PROVIDED"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
DETERMINISTIC CALCULATIONS (use directly — do not recalculate):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
{json.dumps(calc_context, indent=2, default=str)}

SAFETY GATE DECISION: {chemo_validation.get("overall_decision", "unknown")}
- hold / critical_hold → flag clearly in procedure steps and medication section
- dose_reduce → reflect reduction in medication dose field
- labs_required → add a step to obtain missing labs before proceeding
- Hard stop drugs (DO NOT include in medication list): {[h["drug"] for h in longitudinal.get("hard_stop_triggers", [])]}

CYCLE CONTEXT: This is cycle #{longitudinal.get("completed_cycles", 0) + 1}
Cumulative doses to date: {json.dumps(longitudinal.get("cumulative_doses", {}), default=str)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INSTRUCTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

The KNOWLEDGE GRAPH section above is the highest-priority data source.
Use graph-confirmed lab values, diagnoses, medications, and findings in preference
to inferred or assumed values.

This output schema is FIXED and is used for EVERY procedure type
(Chemotherapy, Radiation Therapy, Immunotherapy, Surgery, etc.) — you must
ALWAYS return all top-level keys shown in the schema below, even if a
section does not clinically apply to {procedure}. In that case, return that
section's arrays as empty [] and string fields as null — do NOT delete or
omit the key, and do NOT invent unrelated content to fill it.

PROCEDURE STEPS: Write 7 steps in real clinical sequence for {procedure} in {specialization}.
MEDICATION DETAILS: Include drugs standard-of-care for confirmed procedure+diagnosis. If {procedure}
  has no associated medications (e.g. a non-pharmacologic procedure), return "medications": [].
SAFETY VALIDATION: List flags from confirmed findings only.
DRUG INTERACTIONS: Derive from selected drugs + confirmed comorbidities. If no drugs apply, return
  empty arrays for "high_risk" and "moderate_risk".
PREPARATION_VALIDATION: Only applies to infused/injected therapies. If {procedure} does not involve
  infusion/dilution (e.g. radiation, surgery), return empty/null values but KEEP the key.
MONITORING CHECKLIST: Specific to {procedure} and documented organ systems.
POST-PROCEDURE TOXICITY: Use confirmed lab values only for observed_values.
FOLLOW-UP PLAN: Based on confirmed diagnosis, data gaps, and selected drug protocol.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
RULES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
- Every value from patient data or standard published protocol
- If a section/key cannot be grounded in real data, return it EMPTY ([] or null) — NEVER omit the key
- No placeholder text: "not available", "none", "N/A", "unknown", "-"
- No fabricated lab values or drug calculations
- No text outside the JSON
- ALL top-level keys in the schema below MUST be present in every response, for every procedure type

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OUTPUT — VALID JSON ONLY (all keys required, use empty values where not applicable)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

{{
  "procedure_steps": {{
    "title": "TREATMENT PROCEDURE STEPS",
    "steps": [
      "Step 1: ...",
      "Step 2: ...",
      "Step 3: ...",
      "Step 4: ...",
      "Step 5: ...",
      "Step 6: ...",
      "Step 7: ..."
    ]
  }},
  "medication_details": {{
    "title": "MEDICATION DETAILS",
    "medications": [
      {{
        "name": "...",
        "dose": "...",
        "route": "...",
        "dilution": "...",
        "infusion_time": "...",
        "warnings": ["..."]
      }}
    ]
  }},
  "safety_validation": {{
    "title": "PRE-TREATMENT VALIDATION",
    "clinical_flags": ["..."],
    "bsa_or_weight": ["..."],
    "recommendations": ["..."]
  }},
  "drug_interactions": {{
    "title": "DRUG INTERACTION AND CONTRAINDICATIONS",
    "high_risk": ["..."],
    "moderate_risk": ["..."]
  }},
  "preparation_validation": {{
    "title": "PREPARATION AND INFUSION VALIDATION",
    "dilution_instructions": ["..."],
    "stability": "...",
    "infusion_rate": "...",
    "line_compatibility": "..."
  }},
  "monitoring_checklist": {{
    "title": "DURING TREATMENT MONITORING",
    "checks": ["..."],
    "emergency_preparedness": ["..."]
  }},
  "post_procedure_toxicity": {{
    "title": "POST-PROCEDURE TOXICITY AND FOLLOW-UP",
    "risk_assessment": "...",
    "decision": ["..."]
  }},
  "followup_plan": {{
    "title": "FOLLOW-UP AND LAB SCHEDULING",
    "next_labs": ["..."],
    "alerts": ["..."],
    "patient_notification": "..."
  }}
}}
"""

        try:
            response = self.llm.invoke([
                SystemMessage(content=(
                    f"You are a senior {specialization} clinical specialist. "
                    "Generate a real-world, patient-specific treatment procedure output as valid JSON only. "
                    "The Knowledge Graph entities are the highest-priority data source. "
                    "The output schema is FIXED across all procedure types: always include every "
                    "top-level key, using empty arrays/null for sections that do not apply to this "
                    "specific procedure. Never omit a key. No markdown. No extra text."
                )),
                HumanMessage(content=prompt),
            ])

            parsed = _parse_json(response.content.strip())

            if not parsed or not isinstance(parsed, dict):
                logger.warning("First parse incomplete — retrying")
                retry = self.llm.invoke([
                    SystemMessage(content="Return ONLY valid JSON. All schema keys required. No markdown. No extra text."),
                    HumanMessage(content=prompt),
                ])
                parsed = _parse_json(retry.content.strip())

            cleaned = self._clean_output(parsed) if parsed else {}
            final   = _with_schema(cleaned, self.TEMPLATE)
            state["treatment_procedure_output"] = final
            logger.info(f"✅ TreatmentProcedureAgent success: {list(final.keys())}")

        except Exception as e:
            logger.error(f"TreatmentProcedureAgent failed: {e}")
            logger.error(traceback.format_exc())
            state["treatment_procedure_output"] = _with_schema({}, self.TEMPLATE)

        return state

    PLACEHOLDERS = {
        "none", "n/a", "not available", "not specified", "not recorded",
        "not applicable", "not provided", "unknown", "-", "", "null",
        "no data", "no information", "not found", "not documented",
        "not determined", "not stated", "not reported",
    }

    def _is_placeholder(self, value: str) -> bool:
        v = value.strip().lower()
        if v in self.PLACEHOLDERS:
            return True
        return any(v.startswith(p) for p in ("not ", "no ", "n/a", "none", "unknown", "not yet", "to be ", "tbd", "pending"))

    def _clean_output(self, obj):
        """
        Normalizes placeholder strings to None and strips whitespace, but
        NEVER removes a dict key or shrinks the structure — key presence is
        guaranteed downstream by _with_schema(). This keeps the output shape
        identical across all procedure types (e.g. Chemotherapy vs Radiation
        Therapy), only the values differ.
        """
        if isinstance(obj, dict):
            return {k: self._clean_output(v) for k, v in obj.items()}
        elif isinstance(obj, list):
            cleaned = []
            for item in obj:
                item2 = self._clean_output(item)
                if isinstance(item2, str) and self._is_placeholder(item2):
                    continue
                if item2 is None:
                    continue
                cleaned.append(item2)
            return cleaned
        elif isinstance(obj, str):
            return None if self._is_placeholder(obj) else obj.strip()
        return obj


# ──────────────────────────────────────────────────────────────────────────────
# PRE-PROCEDURE AGENT
# ──────────────────────────────────────────────────────────────────────────────

class PreProcedureAgent:
    # Two fixed schemas — one per mode. Within a given mode, the schema is
    # IDENTICAL across all procedure types (Chemotherapy, Radiation, etc.).
    TEMPLATE_ORDER = {
        "recommendations":           [],
        "tasks_to_be_completed":     [],
        "anticipated_risks_or_gaps": [],
    }
    TEMPLATE_REPORT = {
        "recommendations":     [],
        "tasks_completed":     [],
        "risks_or_gaps_found": [],
    }

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def process(self, state: ProcedureState) -> ProcedureState:
        log_inputs(state)
        logger.info("PreProcedureAgent — START")
        mode               = state["mode"]
        specialization     = state["specialization"]
        selected_procedure = state["selected_procedure"]
        clinical_data      = state["clinical_data"]
        last_order         = state.get("last_order")
        summary            = state.get("patient_summary")
        treatment          = state.get("treatment_procedure_output", {})
        alerts             = state.get("alerts_output", {})
        tumor_board_data   = state.get("tumor_board_data", "")
        summary_context    = json.dumps(summary, indent=2, default=str) if summary else "Not available"
        diagnosis          = clinical_data.get("latest_diagnosis")
        documentation      = clinical_data.get("documentation_context", [])
        missing_info       = clinical_data.get("missing_information", {})
        missing_items      = missing_info.get("missing_items", []) if isinstance(missing_info, dict) else []
        clinical_insights  = clinical_data.get("clinical_insights", {})

        graph_section = _build_graph_prompt_section(state)
        mode_label    = "PROCEDURE ORDERING MODE" if mode == "order" else "PROCEDURE REPORTING MODE"
        template      = self.TEMPLATE_ORDER if mode == "order" else self.TEMPLATE_REPORT

        order_block = ""
        if mode == "report" and last_order:
            ordered_pre = last_order.get("pre_procedure", {})
            order_block = f"""
AUTHORITATIVE ORDER DATA FOR THIS PHASE:
{json.dumps(ordered_pre, indent=2, default=str)}
STRICT REPORTING RULES:
- Map EVERY bullet to an item in the order above
- For each: state DONE / PARTIALLY DONE / NOT DONE
- DO NOT add steps that were not ordered
"""

        if mode == "order":
            output_schema = """{
  "recommendations":           ["<what to prepare / arrange / verify>"],
  "tasks_to_be_completed":     ["<specific pre-procedure checklist item>"],
  "anticipated_risks_or_gaps": ["<safety flag or gap to address before starting>"]
}"""
        else:
            output_schema = """{
  "recommendations":     ["<order item that was followed>"],
  "tasks_completed":     ["<task that was completed with brief outcome>"],
  "risks_or_gaps_found": ["<risk actually observed — or empty array if none>"]
}"""

        prompt = f"""
You are a HIGH-RELIABILITY, SPECIALTY-AWARE PROCEDURAL CARE ASSISTANT.

Mode: {mode_label}
Specialty: {specialization}
Selected Procedure: {selected_procedure}

{graph_section}

{order_block}
TREATMENT PLAN:
{json.dumps(treatment, indent=2, default=str)}

ALERTS AND IMPORTANT:
{json.dumps(alerts, indent=2, default=str)}

TUMOR BOARD RECOMMENDATION:
{tumor_board_data}

Diagnosis:
{diagnosis}

Key Missing Data:
{json.dumps(missing_items, indent=2, default=str)}

Clinical Insights:
{json.dumps(clinical_insights, indent=2, default=str)}

Documentation:
{json.dumps(documentation, indent=2, default=str)[:1500]}

Full Patient Summary:
{summary_context[:2000]}

IMPORTANT: Use the Knowledge Graph entities above as the primary authoritative source.
YOUR TASK: Generate the PRE-PROCEDURE phase content ONLY.

PRE-PROCEDURE covers: patient readiness, risk/safety considerations, verification,
consent, documentation, and equipment checks.

MODE-SPECIFIC LANGUAGE:
{"Use ACTION-ORIENTED, FUTURE-FOCUSED language." if mode == "order" else "Use PAST-TENSE documentation language."}

This output schema is FIXED for this mode and is used for EVERY procedure type
(Chemotherapy, Radiation Therapy, Immunotherapy, Surgery, etc). ALWAYS return all
keys shown below, using an empty array [] if there is genuinely nothing to report
for this procedure — never omit a key.

RULES: Bullet points only. No medications, dosages, or lab values. No fabricated findings.

Return ONLY valid JSON matching this exact schema (all keys required, empty arrays allowed):
{output_schema}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content=f"Specialist pre-procedure {mode} generator. Output only valid JSON. All schema keys required."),
                HumanMessage(content=prompt),
            ])
            parsed = _parse_json(response.content)
            state["pre_procedure"] = _with_schema(parsed, template)
            logger.info(f"Pre-procedure generated ({mode} mode): {list(state['pre_procedure'].keys())}")
        except Exception as e:
            logger.error(f"PreProcedureAgent failed: {e}")
            state["pre_procedure"] = _with_schema({}, template)
        return state


# ──────────────────────────────────────────────────────────────────────────────
# DURING-PROCEDURE AGENT
# ──────────────────────────────────────────────────────────────────────────────

class DuringProcedureAgent:
    TEMPLATE_ORDER = {
        "standard_recommendations":                [],
        "monitoring_tasks":                         [],
        "possible_complications":                   [],
        "suggested_modifications_if_issues_arise":  [],
    }
    TEMPLATE_REPORT = {
        "recommendations":              [],
        "monitored_or_completed_tasks": [],
        "complications_found":          [],
        "modifications_done":           [],
    }

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def process(self, state: ProcedureState) -> ProcedureState:
        log_inputs(state)
        logger.info("DuringProcedureAgent — START")
        mode               = state["mode"]
        specialization     = state["specialization"]
        selected_procedure = state["selected_procedure"]
        clinical_data      = state["clinical_data"]
        pre_procedure      = state.get("pre_procedure", {})
        treatment          = state.get("treatment_procedure_output", {})
        alerts             = state.get("alerts_output", {})
        tumor_board_data   = state.get("tumor_board_data", "")
        last_order         = state.get("last_order")
        summary            = state.get("patient_summary")
        summary_context    = json.dumps(summary, indent=2, default=str) if summary else "Not available"
        diagnosis          = clinical_data.get("latest_diagnosis")
        organ_analysis     = clinical_data.get("organ_analysis", {})
        timeline_events    = clinical_data.get("timeline_events", [])

        graph_section = _build_graph_prompt_section(state)
        mode_label    = "PROCEDURE ORDERING MODE" if mode == "order" else "PROCEDURE REPORTING MODE"
        template      = self.TEMPLATE_ORDER if mode == "order" else self.TEMPLATE_REPORT

        order_block = ""
        if mode == "report" and last_order:
            ordered_during = last_order.get("during_procedure", {})
            order_block = f"""
AUTHORITATIVE ORDER DATA FOR THIS PHASE:
{json.dumps(ordered_during, indent=2, default=str)}
STRICT REPORTING RULES:
- Map EVERY bullet to an item from the order
- Report complications, or return an empty array if none observed
- Use past-tense language
"""

        if mode == "order":
            output_schema = """{
  "standard_recommendations":              ["<conduct guideline during procedure>"],
  "monitoring_tasks":                      ["<real-time monitoring item>"],
  "possible_complications":                ["<potential complication to watch for>"],
  "suggested_modifications_if_issues_arise": ["<contingency if complication arises>"]
}"""
        else:
            output_schema = """{
  "recommendations":              ["<order item followed during procedure>"],
  "monitored_or_completed_tasks": ["<monitoring / task actually executed>"],
  "complications_found":          ["<complication occurred — or empty array if none>"],
  "modifications_done":           ["<modification applied — or empty array if not required>"]
}"""

        prompt = f"""
You are a HIGH-RELIABILITY, SPECIALTY-AWARE PROCEDURAL CARE ASSISTANT.

Mode: {mode_label}
Specialty: {specialization}
Selected Procedure: {selected_procedure}

{graph_section}

{order_block}
TREATMENT PLAN:
{json.dumps(treatment, indent=2, default=str)}

ALERTS: {json.dumps(alerts, indent=2, default=str)}
TUMOR BOARD: {tumor_board_data}
Diagnosis: {diagnosis}

Organ System Involvement:
{json.dumps(organ_analysis, indent=2, default=str)}

Timeline Events:
{json.dumps(timeline_events, indent=2, default=str)[:1000]}

Full Patient Summary:
{summary_context[:2000]}

Pre-Procedure Context (already completed):
{json.dumps(pre_procedure, indent=2, default=str)}

IMPORTANT: Use the Knowledge Graph entities above as the primary authoritative source.
YOUR TASK: Generate the DURING-PROCEDURE phase content ONLY.

DURING-PROCEDURE covers: monitoring, safety checks, procedural conduct, intra-procedural
observations, contingency planning.

MODE-SPECIFIC LANGUAGE:
{"Use ACTION-ORIENTED language describing what SHOULD happen WHILE the procedure is performed." if mode == "order" else "Use DOCUMENTATION language — report what WAS monitored, what complications OCCURRED."}

This output schema is FIXED for this mode and is used for EVERY procedure type. ALWAYS
return all keys shown below, using an empty array [] if there is genuinely nothing to
report for this procedure — never omit a key.

RULES: Bullet points only. No medications, dosages, or lab values. No fabricated findings.

Return ONLY valid JSON matching this exact schema (all keys required, empty arrays allowed):
{output_schema}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content=f"Specialist during-procedure {mode} generator. Output only valid JSON. All schema keys required."),
                HumanMessage(content=prompt),
            ])
            parsed = _parse_json(response.content)
            state["during_procedure"] = _with_schema(parsed, template)
            logger.info(f"During-procedure generated ({mode} mode): {list(state['during_procedure'].keys())}")
        except Exception as e:
            logger.error(f"DuringProcedureAgent failed: {e}")
            state["during_procedure"] = _with_schema({}, template)
        return state


# ──────────────────────────────────────────────────────────────────────────────
# POST-PROCEDURE AGENT
# ──────────────────────────────────────────────────────────────────────────────

class PostProcedureAgent:
    TEMPLATE_ORDER = {
        "recovery_recommendations":          [],
        "pending_tasks":                     [],
        "handover_details":                  [],
        "documentation_or_reporting_points": [],
    }
    TEMPLATE_REPORT = {
        "recommendations":         [],
        "pending_tasks_completed": [],
        "handover_details":        [],
        "documentation_points":    [],
    }

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def process(self, state: ProcedureState) -> ProcedureState:
        log_inputs(state)
        logger.info("PostProcedureAgent — START")
        mode               = state["mode"]
        specialization     = state["specialization"]
        selected_procedure = state["selected_procedure"]
        clinical_data      = state["clinical_data"]
        during_procedure   = state.get("during_procedure", {})
        treatment          = state.get("treatment_procedure_output", {})
        alerts             = state.get("alerts_output", {})
        tumor_board_data   = state.get("tumor_board_data", "")
        last_order         = state.get("last_order")
        summary            = state.get("patient_summary")
        summary_context    = json.dumps(summary, indent=2, default=str) if summary else "Not available"
        diagnosis          = clinical_data.get("latest_diagnosis")
        missing_info       = clinical_data.get("missing_information", {})
        clinical_insights  = clinical_data.get("clinical_insights", {})
        documentation      = clinical_data.get("documentation_context", [])

        graph_section = _build_graph_prompt_section(state)
        mode_label    = "PROCEDURE ORDERING MODE" if mode == "order" else "PROCEDURE REPORTING MODE"
        template      = self.TEMPLATE_ORDER if mode == "order" else self.TEMPLATE_REPORT

        order_block = ""
        if mode == "report" and last_order:
            ordered_post = last_order.get("post_procedure", {})
            order_block = f"""
AUTHORITATIVE ORDER DATA FOR THIS PHASE:
{json.dumps(ordered_post, indent=2, default=str)}
STRICT REPORTING RULES:
- Map EVERY bullet to an item from the order
- Report each as COMPLETED / PARTIALLY COMPLETED / NOT COMPLETED
"""

        if mode == "order":
            output_schema = """{
  "recovery_recommendations":          ["<what should be done in recovery>"],
  "pending_tasks":                     ["<task to complete after procedure>"],
  "handover_details":                  ["<handover instruction>"],
  "documentation_or_reporting_points": ["<documentation requirement>"]
}"""
        else:
            output_schema = """{
  "recommendations":         ["<recovery recommendation that was followed>"],
  "pending_tasks_completed": ["<post-procedure task completed with outcome>"],
  "handover_details":        ["<actual handover performed — or empty array if no handover required>"],
  "documentation_points":    ["<documentation that was completed>"]
}"""

        prompt = f"""
You are a HIGH-RELIABILITY, SPECIALTY-AWARE PROCEDURAL CARE ASSISTANT.

Mode: {mode_label}
Specialty: {specialization}
Selected Procedure: {selected_procedure}

{graph_section}

{order_block}
TREATMENT PLAN:
{json.dumps(treatment, indent=2, default=str)}

ALERTS: {json.dumps(alerts, indent=2, default=str)}
TUMOR BOARD: {tumor_board_data}
Diagnosis: {diagnosis}

Pending Clinical Gaps:
{json.dumps(missing_info, indent=2, default=str)}

Clinical Insights:
{json.dumps(clinical_insights, indent=2, default=str)}

Documentation Context:
{json.dumps(documentation, indent=2, default=str)[:1000]}

Full Patient Summary:
{summary_context[:2000]}

During-Procedure Context:
{json.dumps(during_procedure, indent=2, default=str)}

IMPORTANT: Use the Knowledge Graph entities above as the primary authoritative source.
YOUR TASK: Generate the POST-PROCEDURE phase content ONLY.

POST-PROCEDURE covers: immediate monitoring, recovery, pending tasks, follow-up,
handover instructions, documentation requirements.

MODE-SPECIFIC LANGUAGE:
{"Use ACTION-ORIENTED, FUTURE-FOCUSED language." if mode == "order" else "Use DOCUMENTATION language — report what WAS done."}

This output schema is FIXED for this mode and is used for EVERY procedure type. ALWAYS
return all keys shown below, using an empty array [] if there is genuinely nothing to
report for this procedure — never omit a key.

RULES: Bullet points only. No medications, dosages, or lab values. No fabricated findings.

Return ONLY valid JSON matching this exact schema (all keys required, empty arrays allowed):
{output_schema}"""

        try:
            response = self.llm.invoke([
                SystemMessage(content=f"Specialist post-procedure {mode} generator. Output only valid JSON. All schema keys required."),
                HumanMessage(content=prompt),
            ])
            parsed = _parse_json(response.content)
            state["post_procedure"] = _with_schema(parsed, template)
            logger.info(f"Post-procedure generated ({mode} mode): {list(state['post_procedure'].keys())}")
        except Exception as e:
            logger.error(f"PostProcedureAgent failed: {e}")
            state["post_procedure"] = _with_schema({}, template)
        return state


# ──────────────────────────────────────────────────────────────────────────────
# PROCEDURE REPORT ASSEMBLER
# ──────────────────────────────────────────────────────────────────────────────

class ProcedureReportAssembler:
    async def assemble(self, state: ProcedureState) -> ProcedureState:
        logger.info("ProcedureReportAssembler — START")
        mode               = state["mode"]
        selected_procedure = state["selected_procedure"]

        if not selected_procedure:
            # Suggestion-only response — identical to v1
            final_output = {
                "suggested_procedures": state.get("suggested_procedures", []),
                "patient_abstract":     state.get("patient_abstract", ""),
            }
        else:
            # Full procedure response
            chemo_calcs      = state.get("chemo_calculations", {})
            chemo_validation = state.get("chemo_validation", {})
            toxicity         = state.get("toxicity_assessment", {})
            longitudinal     = state.get("longitudinal_data", {})
            audit            = state.get("audit_log", {})

            # Build chemo_engine block — identical structure to v1.
            # This block is built field-by-field in Python (not parsed from
            # free-form LLM JSON), so its key set is ALWAYS the same
            # regardless of procedure type. For non-chemo procedures the
            # individual values will simply be None / empty — the shape
            # never changes.
            chemo_engine_block = {
                "pre_chemo_validation": {
                    "title": "Pre-Chemotherapy Validation Engine",
                    "baseline_data": {
                        "inputs_extracted": chemo_calcs.get("inputs_found", {}),
                        "skipped_fields":   chemo_calcs.get("skipped_calculations", []),
                    },
                    "bsa_calculation": {
                        "bsa_m2":   chemo_calcs.get("calculations", {}).get("bsa_m2"),
                        "bmi":      chemo_calcs.get("calculations", {}).get("bmi"),
                        "formula":  chemo_calcs.get("calculations", {}).get("bsa_formula"),
                        "warnings": chemo_calcs.get("warnings", []),
                    },
                    "renal_function": {
                        "egfr_ml_min": chemo_calcs.get("calculations", {}).get("egfr_ml_min"),
                        "formula":     chemo_calcs.get("calculations", {}).get("egfr_formula"),
                    },
                    "hepatic_flags": chemo_calcs.get("calculations", {}).get("hepatic_flags", []),
                    "diabetic_flags": [
                        f for f in chemo_calcs.get("dose_flags", [])
                        if f.get("flag") in ("diabetic_glucose_monitoring", "elevated_fasting_glucose")
                    ],
                    "dose_flags": chemo_calcs.get("dose_flags", []),
                },
                "regimen_protocol_mapping": {
                    "title":                  "Regimen Selection & Protocol Mapping",
                    "safety_gate_decision":   chemo_validation.get("overall_decision"),
                    "gate_passed":            chemo_validation.get("gate_passed"),
                    "triggered_safety_rules": chemo_validation.get("triggered_rules", []),
                    "hold_flags":             chemo_validation.get("hold_flags", []),
                    "dose_reduce_flags":      chemo_validation.get("dose_reduce_flags", []),
                    "missing_required_labs":  chemo_validation.get("missing_required_labs", []),
                    "values_evaluated":       chemo_validation.get("values_evaluated", {}),
                    "validation_timestamp":   chemo_validation.get("validation_timestamp"),
                    "guideline_framework":    "ASCO/NCCN/ESMO standard parameters",
                },
                "dose_calculation_engine": {
                    "title":                       "Dose Calculation Engine",
                    "bsa_m2":                      chemo_calcs.get("calculations", {}).get("bsa_m2"),
                    "bsa_formula":                 chemo_calcs.get("calculations", {}).get("bsa_formula"),
                    "egfr_ml_min":                 chemo_calcs.get("calculations", {}).get("egfr_ml_min"),
                    "egfr_formula":                chemo_calcs.get("calculations", {}).get("egfr_formula"),
                    "carboplatin_dose_mg":         chemo_calcs.get("calculations", {}).get("carboplatin_dose_mg"),
                    "carboplatin_dose_rounded_mg": chemo_calcs.get("calculations", {}).get("carboplatin_dose_rounded_mg"),
                    "calvert_formula":             chemo_calcs.get("calculations", {}).get("calvert_formula"),
                    "obesity_flags": [
                        f for f in chemo_calcs.get("dose_flags", [])
                        if f.get("flag") in ("obesity_weight_cap", "obesity_bmi_flag")
                    ],
                    "renal_adjustment_flags": [
                        f for f in chemo_calcs.get("dose_flags", [])
                        if "renal" in f.get("flag", "")
                    ],
                    "hepatic_adjustment_flags": [
                        f for f in chemo_calcs.get("dose_flags", [])
                        if "hepatic" in f.get("flag", "")
                    ],
                },
                "realtime_monitoring": {
                    "title":                      "Real-Time Monitoring Checklist",
                    "ctcae_grades":               toxicity.get("ctcae_grades", {}),
                    "febrile_neutropenia_risk":   toxicity.get("febrile_neutropenia_risk"),
                    "gcsf_recommendation":        toxicity.get("gcsf_recommendation"),
                    "next_cycle_delay_suggested": toxicity.get("next_cycle_delay_suggested", False),
                    "diabetic_monitoring_active": any(
                        f.get("flag") in ("diabetic_glucose_monitoring", "elevated_fasting_glucose")
                        for f in chemo_calcs.get("dose_flags", [])
                    ),
                    "assessment_notes": toxicity.get("assessment_notes", []),
                },
                "post_chemo_validation": {
                    "title":                      "Post-Chemotherapy Validation & Follow-Up",
                    "dose_reduction_next_cycle":  toxicity.get("dose_reduction_next_cycle", []),
                    "gcsf_recommendation":        toxicity.get("gcsf_recommendation"),
                    "next_cycle_delay_suggested": toxicity.get("next_cycle_delay_suggested", False),
                    "ctcae_grading_summary":      toxicity.get("ctcae_grades", {}),
                    "assessment_notes":           toxicity.get("assessment_notes", []),
                },
                "longitudinal_tracking": {
                    "title":              "Longitudinal Toxicity & Response Modeling",
                    "completed_cycles":   longitudinal.get("completed_cycles", 0),
                    "current_cycle":      longitudinal.get("completed_cycles", 0) + 1,
                    "cumulative_doses":   longitudinal.get("cumulative_doses", {}),
                    "hard_stop_triggers": longitudinal.get("hard_stop_triggers", []),
                    "cycle_history":      longitudinal.get("cycle_history", []),
                    "toxicity_trend":     longitudinal.get("toxicity_trend", []),
                },
                "audit_compliance": {
                    "title":                  "Safety & Compliance Layer",
                    "timestamp":              audit.get("timestamp"),
                    "validation_decision":    audit.get("validation_decision"),
                    "gate_passed":            audit.get("gate_passed"),
                    "override_required":      audit.get("override_required", False),
                    "override_logged":        audit.get("override_logged", False),
                    "calculations_performed": audit.get("calculations_performed", []),
                    "hard_stop_triggers":     audit.get("hard_stop_triggers", []),
                    "triggered_rules":        audit.get("triggered_rules", []),
                    "missing_labs":           audit.get("missing_labs", []),
                    "ctcae_grades":           audit.get("ctcae_grades", {}),
                    "dose_flags":             audit.get("dose_flags", []),
                    "guideline_framework":    "ASCO/NCCN/ESMO standard parameters",
                },
            }

            # ── FINAL OUTPUT — identical key structure to v1, and now
            # guaranteed identical regardless of procedure type because
            # every nested block (pre/during/post/treatment/alerts/chemo)
            # is schema-enforced via _with_schema() upstream. ─────────────
            final_output = {
                "procedure": selected_procedure,
                "mode":      mode,
                "pre_procedure": {
                    **state.get("pre_procedure", {}),
                    "treatment": state.get("treatment_procedure_output"),
                    "alerts":    state.get("alerts_output"),
                },
                "during_procedure": {
                    **state.get("during_procedure", {}),
                    "treatment": state.get("treatment_procedure_output"),
                    "alerts":    state.get("alerts_output"),
                },
                "post_procedure": {
                    **state.get("post_procedure", {}),
                    "treatment": state.get("treatment_procedure_output"),
                    "alerts":    state.get("alerts_output"),
                },
                "treatment_procedure":  state.get("treatment_procedure_output"),
                "alerts_and_important": state.get("alerts_output", {}),
                "chemo_engine":         chemo_engine_block,
            }

        state["final_output"] = final_output
        logger.info(f"Report assembled: mode={mode}, procedure={selected_procedure}")
        return state


# ──────────────────────────────────────────────────────────────────────────────
# LANGGRAPH NODE WRAPPERS — chemo engine nodes
# ──────────────────────────────────────────────────────────────────────────────

_calc_engine         = ChemoCalculationEngine()
_validation_engine   = PreChemoValidationEngine()
_toxicity_engine     = ToxicityAssessmentEngine()
_longitudinal_engine = LongitudinalTrackingEngine()
_audit_logger        = ChemoAuditLogger()


async def chemo_calculation_node(state: ProcedureState) -> ProcedureState:
    if not state.get("selected_procedure"):
        return state
    state["chemo_calculations"] = _calc_engine.compute(state)
    return state


async def chemo_validation_node(state: ProcedureState) -> ProcedureState:
    if not state.get("selected_procedure"):
        return state
    validation = _validation_engine.validate(state)
    state["chemo_validation"]   = validation
    state["safety_gate_passed"] = validation["gate_passed"]
    if not validation["gate_passed"]:
        logger.warning(
            f"⛔ SAFETY GATE: {validation['overall_decision']} | holds={validation['hold_flags']}"
        )
    return state


async def toxicity_node(state: ProcedureState) -> ProcedureState:
    if not state.get("selected_procedure"):
        return state
    state["toxicity_assessment"] = _toxicity_engine.assess(state)
    return state


async def longitudinal_node(state: ProcedureState) -> ProcedureState:
    if not state.get("selected_procedure"):
        return state
    state["longitudinal_data"] = await _longitudinal_engine.track(state)
    return state


async def audit_node(state: ProcedureState) -> ProcedureState:
    if not state.get("selected_procedure"):
        return state
    state["audit_log"] = await _audit_logger.log(state)
    return state


# ──────────────────────────────────────────────────────────────────────────────
# ROUTING FUNCTIONS
# ──────────────────────────────────────────────────────────────────────────────

def route_after_context(state: ProcedureState) -> str:
    if state.get("error"):
        return "assemble_report"
    if not state.get("selected_procedure"):
        return "suggest_procedures"
    return "chemo_calculation_node"


# ──────────────────────────────────────────────────────────────────────────────
# LANGGRAPH WORKFLOW BUILDER
# ──────────────────────────────────────────────────────────────────────────────

def create_procedure_workflow(llm: ChatGroq) -> any:
    context_loader   = ContextLoaderAgent()
    suggestion_agent = ProcedureSuggestionAgent(llm)
    pre_agent        = PreProcedureAgent(llm)
    during_agent     = DuringProcedureAgent(llm)
    post_agent       = PostProcedureAgent(llm)
    treatment_agent  = TreatmentProcedureAgent(llm)
    alerts_agent     = AlertsImportantAgent(llm)
    assembler        = ProcedureReportAssembler()

    workflow = StateGraph(ProcedureState)

    # Register all nodes
    workflow.add_node("load_context",           context_loader.load)
    workflow.add_node("graph_context_node",     graph_context_node)
    workflow.add_node("suggest_procedures",     suggestion_agent.suggest)
    workflow.add_node("chemo_calculation_node", chemo_calculation_node)
    workflow.add_node("chemo_validation_node",  chemo_validation_node)
    workflow.add_node("longitudinal_node",      longitudinal_node)
    workflow.add_node("treatment_node",         treatment_agent.process)
    workflow.add_node("alerts_node",            alerts_agent.process)
    workflow.add_node("pre_procedure_node",     pre_agent.process)
    workflow.add_node("during_procedure_node",  during_agent.process)
    workflow.add_node("toxicity_node",          toxicity_node)
    workflow.add_node("post_procedure_node",    post_agent.process)
    workflow.add_node("audit_node",             audit_node)
    workflow.add_node("assemble_report",        assembler.assemble)

    # Entry point
    workflow.set_entry_point("load_context")

    # load_context → graph_context_node (always)
    workflow.add_edge("load_context", "graph_context_node")

    # graph_context_node → routing
    workflow.add_conditional_edges(
        "graph_context_node",
        route_after_context,
        {
            "suggest_procedures":    "suggest_procedures",
            "chemo_calculation_node": "chemo_calculation_node",
            "assemble_report":       "assemble_report",
        },
    )

    # Suggestion path (no procedure selected)
    workflow.add_edge("suggest_procedures", "assemble_report")

    # Full procedure workflow
    workflow.add_edge("chemo_calculation_node", "chemo_validation_node")
    workflow.add_edge("chemo_validation_node",  "longitudinal_node")
    workflow.add_edge("longitudinal_node",      "treatment_node")
    workflow.add_edge("treatment_node",         "alerts_node")
    workflow.add_edge("alerts_node",            "pre_procedure_node")
    workflow.add_edge("pre_procedure_node",     "during_procedure_node")
    workflow.add_edge("during_procedure_node",  "toxicity_node")
    workflow.add_edge("toxicity_node",          "post_procedure_node")
    workflow.add_edge("post_procedure_node",    "audit_node")
    workflow.add_edge("audit_node",             "assemble_report")
    workflow.add_edge("assemble_report",        END)

    return workflow.compile()


# ──────────────────────────────────────────────────────────────────────────────
# MAIN RUNNER
# ──────────────────────────────────────────────────────────────────────────────

async def run_procedure_workflow(
    doctor_id:          str,
    patient_id:         str,
    selected_procedure: Optional[str],
    mode:               str,
    specialization:     str,
    llm:                ChatGroq,
) -> Dict[str, Any]:
    logger.info(f"""
🚀 WORKFLOW INPUT:
doctor_id={doctor_id}
patient_id={patient_id}
selected_procedure={selected_procedure}
mode={mode}
specialization={specialization}
""")

    workflow = create_procedure_workflow(llm)

    initial_state: ProcedureState = {
        "doctor_id":          doctor_id,
        "patient_id":         patient_id,
        "selected_procedure": selected_procedure,
        "mode":               mode,
        "specialization":     specialization,
        "clinical_data":      {},
        "patient_summary":    None,
        "last_order":         None,
        "suggested_procedures":       [],
        "alerts_output":              {},
        "treatment_procedure_output": {},
        "chemo_calculations":    {},
        "chemo_validation":      {},
        "toxicity_assessment":   {},
        "longitudinal_data":     {},
        "audit_log":             {},
        "safety_gate_passed":    True,
        "patient_abstract":  "",
        "pre_procedure":     {},
        "during_procedure":  {},
        "post_procedure":    {},
        "final_output":      None,
        "error":             None,
        "warnings":          [],
        # Graph fields
        "graph_documents":  [],
        "graph_context":    {},
        "tumor_board_data": "",
    }

    logger.info(f"🧠 INITIAL STATE:\n{json.dumps(initial_state, indent=2, default=str)}")

    final_state = await workflow.ainvoke(initial_state)

    if final_state.get("error"):
        raise ValueError(final_state["error"])

    if final_state.get("warnings"):
        logger.warning(f"Procedure warnings: {final_state['warnings']}")

    return final_state.get("final_output", {})


# ──────────────────────────────────────────────────────────────────────────────
# API ENDPOINT  — identical URL and response format to v1
# ──────────────────────────────────────────────────────────────────────────────

@router.post("/clinical-procedure-workflow")
async def clinical_procedure_workflow(request: Request):
    try:
        payload = await request.json()
        logger.info(f"📥 FULL REQUEST PAYLOAD:\n{json.dumps(payload, indent=2, default=str)}")

        doctor_id          = payload.get("doctor_id")
        patient_id         = payload.get("patient_id")
        selected_procedure = payload.get("selected_procedure")
        mode               = payload.get("mode", "order")

        logger.info(f"doctor_id: {doctor_id}")
        logger.info(f"patient_id: {patient_id}")
        logger.info(f"selected_procedure: {selected_procedure}")
        logger.info(f"mode: {mode}")

        if not doctor_id or not patient_id:
            raise HTTPException(status_code=400, detail="doctor_id and patient_id required")

        if mode not in ["order", "report"]:
            raise HTTPException(status_code=400, detail="Invalid mode. Must be 'order' or 'report'")

        doctor_doc = doctor_user_collection.find_one(
            {"sys_user_id": doctor_id},
            {"_id": 0, "specialization": 1},
        )
        if not doctor_doc:
            raise HTTPException(status_code=404, detail="Doctor not found")

        specialization = doctor_doc.get("specialization", "General")

        llm = ChatGroq(
            model        = "llama-3.1-8b-instant",
            groq_api_key = os.getenv("GROQ_API_KEY"),
            temperature  = 0.3,
            max_tokens   = 3500,
        )

        final_output = await run_procedure_workflow(
            doctor_id          = doctor_id,
            patient_id         = patient_id,
            selected_procedure = selected_procedure,
            mode               = mode,
            specialization     = specialization,
            llm                = llm,
        )

        # Response format IDENTICAL to v1
        return {
            "status":      "success",
            "finaloutput": final_output,
            "metadata": {
                "doctor_id":          doctor_id,
                "patient_id":         patient_id,
                "specialization":     specialization,
                "selected_procedure": selected_procedure,
                "mode":               mode,
            },
        }

    except HTTPException:
        raise
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except Exception as e:
        logger.exception("Clinical procedure workflow failed")
        raise HTTPException(
            status_code=500,
            detail=f"Clinical procedure workflow error: {str(e)}",
        )