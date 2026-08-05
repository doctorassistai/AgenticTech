"""
treatment_plan_agent.py
=======================
Next-Generation Treatment Planning Engine for DoctorAssist

Features:
- Evidence-based treatment recommendations
- Multi-guideline integration (NCCN, WHO, AHA, etc.)
- Avoids already completed procedures/investigations
- Neo4j treatment knowledge graph
- Pharmacological + Procedural + Non-pharmacological planning
- Cost-effectiveness analysis
- Drug interaction checking
- Contraindication detection
- Follow-up scheduling intelligence
- Specialty-Aware Treatment Planning (Specialty Skill Layer)

Author: AI Architect
Version: 2.0.0
"""

import json
import re
from typing import Dict, Any, List, Optional, TypedDict, Set
from datetime import datetime, timedelta
from enum import Enum
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile, Body
# LangGraph
from langgraph.graph import StateGraph, END
from langchain_core.messages import HumanMessage, SystemMessage

# LLM
from langchain_groq import ChatGroq

# Graph libraries
import networkx as nx
from neo4j import GraphDatabase

# Logging
from loguru import logger

# Utilities
from pydantic import BaseModel, Field



from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, WebSocket, status, File, Form, UploadFile
from fastapi.responses import HTMLResponse, RedirectResponse, JSONResponse, FileResponse
# from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field, EmailStr, validator
from fastapi.encoders import jsonable_encoder
from typing import Any, Dict, List, Optional, Union
from pymongo import MongoClient
from motor.motor_asyncio import AsyncIOMotorClient
from datetime import datetime, date, timedelta
from bson import ObjectId
from enum import Enum
import logging
import random
import string
import sys
import pytz
import socket
import platform
import httpx
import asyncio
import json
import time
import queue
import threading
from passlib.context import CryptContext
from functools import wraps, partial
import uuid
import os
import aiofiles
import shutil
import re
import copy
import traceback
from groq import Groq
from fastapi import Query
from typing import Optional
from fastapi import Response
from jose import jwt, JWTError
from datetime import datetime, timedelta
from fastapi.encoders import jsonable_encoder
from shared.audit.schema import AuditEvent
from shared.audit.utils import emit_audit
from datetime import datetime, timezone
from dotenv import load_dotenv
import os
from pydantic import BaseModel, Field
from typing import List, Optional
from bson import ObjectId



router = APIRouter(
    prefix="",
    tags=["doctor"],
    responses={404: {"description": "Not found"}},
)

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)



MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = "doctorassistai"
NODES_DB = "doctorassistai_nodes"

mongodb_client = AsyncIOMotorClient(MONGO_URI)  # async (Motor)
database = mongodb_client[MONGO_DB]

client = MongoClient(MONGO_URI)  # sync (PyMongo)
db = client[MONGO_DB]

nodes_database = mongodb_client[NODES_DB]
nodes_db = client[NODES_DB]    


summary_collection = database["patient_summary"]

patient_user_collection = database["patient_users"]

doctor_user_collection = database["doctor_users"]

doctor_guidelines_collection = database["doctor_guidelines"]


# =====================================================================
# LLM RATE-LIMIT RETRY HELPER (NEW)
# =====================================================================
#
# Groq's API enforces per-minute / per-day token & request limits. Because this
# pipeline calls self.llm.invoke(...) many times per patient (intent, stage
# context, drugs, procedures, investigations, lifestyle, follow-up, and then
# an evaluation pass -- all of that repeated for 3 strategies), it is very easy
# to trip a 429 "Too Many Requests" / rate_limit_exceeded response from Groq,
# especially back-to-back with low latency between calls.
#
# self.llm.invoke() is a drop-in replacement for `llm.invoke(messages)`
# that:
#   1. Detects rate-limit errors (429 / "rate limit" / "too many requests" in
#      the exception, or a Groq/OpenAI-style error object with status_code==429).
#   2. Honors a `Retry-After` header if the underlying HTTP error exposes one.
#   3. Otherwise backs off exponentially (with jitter) between retries.
#   4. Re-raises immediately for any *non* rate-limit error, so all existing
#      try/except fallback logic in each agent below still behaves exactly as
#      it did before (falls back to defaults, logs a warning, etc.).
#
# Nothing else about the agents' control flow changes -- every call site of
# `self.llm.invoke([...])` is simply routed through this helper inst.




# =====================================================================
# ENUMS & CONSTANTS
# =====================================================================

class TreatmentIntent(str, Enum):
    CURATIVE = "curative"
    DISEASE_MODIFYING = "disease_modifying"
    PALLIATIVE = "palliative"
    SYMPTOM_CONTROL = "symptom_control"
    PREVENTIVE = "preventive"


class TreatmentModality(str, Enum):
    PHARMACOLOGICAL = "pharmacological"
    SURGICAL = "surgical"
    PROCEDURAL = "procedural"
    RADIATION = "radiation"
    LIFESTYLE = "lifestyle"
    PHYSIOTHERAPY = "physiotherapy"
    PSYCHOLOGICAL = "psychological"


class DrugClass(str, Enum):
    ANTIBIOTIC = "antibiotic"
    ANTIHYPERTENSIVE = "antihypertensive"
    ANTICOAGULANT = "anticoagulant"
    CHEMOTHERAPY = "chemotherapy"
    IMMUNOTHERAPY = "immunotherapy"
    ANALGESIC = "analgesic"
    CORTICOSTEROID = "corticosteroid"


class GuidelineSource(str, Enum):
    NCCN = "NCCN"
    WHO = "WHO"
    AHA = "AHA/ACC"
    NICE = "NICE"
    IDSA = "IDSA"
    ASCO = "ASCO"
    ESMO = "ESMO"
    NCG_INDIA = "NCG India"


class EvidenceLevel(str, Enum):
    A = "A"  # RCT/Meta-analysis
    B = "B"  # Observational
    C = "C"  # Expert opinion


class RecommendationClass(str, Enum):
    CLASS_I = "I"      # Must do
    CLASS_IIA = "IIa"  # Should do
    CLASS_IIB = "IIb"  # May consider
    CLASS_III = "III"  # Must not do

class TreatmentStrategy(str, Enum):
    CONSERVATIVE = "conservative"
    STANDARD = "standard"
    AGGRESSIVE = "aggressive"

# =====================================================================
# SPECIALTY SKILL LAYER
# =====================================================================
#
# This layer implements the "Specialty-Aware Treatment Planning Architecture (v2)".
# It sits between Guideline Retrieval context-gathering and the content-generating
# agents (Pharmacological / Procedural / Investigation / Lifestyle). It does NOT
# change the LangGraph topology's data flow contract -- it only injects a
# `doctor_speciality`-derived skill prompt into state, which downstream agents
# read and strictly obey.
#
# Canonical specialty labels recognized out of the box:
#   - "Medical Oncology"
#   - "Radiation Oncology"
#   - "Surgical Oncology"
#
# Any other / unrecognized doctor_speciality value falls back to Medical Oncology
# (the safest, most general default) so the pipeline never breaks.
#
# Future versions can move these into external Markdown skill files without
# changing the architecture -- SPECIALTY_SKILLS is the only thing that would
# need to be swapped for a file-loader.

MEDICAL_ONCOLOGY_SKILL = """
SPECIALTY: MEDICAL ONCOLOGY

You are acting strictly as a MEDICAL ONCOLOGIST. Every recommendation you produce must fall
within the scope of systemic (drug-based) cancer therapy.

YOU MUST GENERATE (when clinically indicated):
- Treatment intent for systemic therapy
- Chemotherapy regimens
- Immunotherapy
- Targeted therapy
- Hormonal / endocrine therapy
- Drug doses, cycle schedule, duration, dose modification rules
- Toxicity monitoring specific to systemic therapy
- Supportive medications (antiemetics, growth factors, prophylactic anticoagulation, etc.)
- Systemic-therapy-related follow-up

YOU MUST NOT GENERATE (strictly out of scope -- omit entirely, do not mention doses/fractions/plans):
- Radiation dose, fractionation, technique, or radiation treatment planning
- Surgical procedures, surgical approach, margins, or operative planning

If a patient clearly also needs radiation or surgery, you may note in passing that "multidisciplinary
tumor board input for radiation/surgical options is recommended" but you must NOT invent radiation
doses, fractionation schedules, or surgical procedure names/details -- that is strictly out of scope
for this specialty.
"""

RADIATION_ONCOLOGY_SKILL = """
SPECIALTY: RADIATION ONCOLOGY

You are acting strictly as a RADIATION ONCOLOGIST. Every recommendation you produce must fall
within the scope of radiation therapy planning and delivery.

YOU MUST GENERATE (when clinically indicated):
- Radiation indication and treatment intent
- Treatment site
- Technique (e.g. IMRT, VMAT, 3D-CRT, brachytherapy, SBRT/SRS)
- Total dose and dose per fraction
- Number of fractions
- Target volumes (GTV/CTV/PTV) and organs at risk
- Simulation, immobilization, and image guidance requirements
- Concurrent chemotherapy -- ONLY if clinically indicated as a radiosensitizer per guideline
  (e.g. concurrent cisplatin with pelvic/head-and-neck radiation). If you include a concurrent
  drug, you MUST explicitly mark it as "concurrent radiosensitizer" in patient_specific_reason.
  Do not add any other systemic regimen.
- Radiation-specific toxicity monitoring (skin, mucositis, pneumonitis, proctitis, etc.)
- Radiation follow-up (response assessment imaging, late-effect surveillance)

IMPORTANT -- REUSE EXISTING PRESCRIPTIONS:
If an uploaded document or the patient clinical summary/timeline already contains a radiation
prescription, extract and REUSE those exact values instead of inventing new ones:
- Technique
- Dose
- Fractionation
- Treatment site

YOU MUST NOT GENERATE (strictly out of scope -- omit entirely):
- Full chemotherapy regimens, immunotherapy, targeted therapy, or hormonal therapy (except the single
  narrowly-scoped concurrent radiosensitizer case described above)
- Surgical procedures, surgical approach, margins, or operative planning
"""

SURGICAL_ONCOLOGY_SKILL = """
SPECIALTY: SURGICAL ONCOLOGY

You are acting strictly as a SURGICAL ONCOLOGIST. Every recommendation you produce must fall
within the scope of operative/peri-operative cancer care.

YOU MUST GENERATE (when clinically indicated):
- Surgical intent (curative resection, debulking, palliative, diagnostic, etc.)
- Procedure name and surgical approach (open / laparoscopic / robotic)
- Margin planning
- Reconstruction (if applicable)
- Lymph node dissection / sampling
- Pre-operative optimization (medical clearance, nutritional/anemia correction, prehabilitation)
- Peri-operative care (VTE prophylaxis, antibiotic prophylaxis, anesthesia considerations)
- Post-operative care and complication surveillance
- Surgical follow-up (wound check, pathology review, staging confirmation)

Medications you MAY include are strictly limited to peri-operative supportive care: surgical
antibiotic prophylaxis, VTE prophylaxis (e.g. LMWH), analgesia, and antiemetics directly tied to
the operative course. These are the ONLY drug categories in scope for this specialty.

YOU MUST NOT GENERATE (strictly out of scope -- omit entirely):
- Radiation prescriptions, dose, fractionation, or radiation planning
- Chemotherapy, immunotherapy, targeted therapy, or hormonal/endocrine therapy protocols
"""

GENERAL_MEDICINE_SKILL = """
SPECIALTY: GENERAL MEDICINE

You are acting strictly as a GENERAL / INTERNAL MEDICINE PHYSICIAN. Every recommendation you produce
must fall within the scope of first-contact, broad-spectrum adult medical care.

YOU MUST GENERATE (when clinically indicated):
- Initial diagnostic workup for undifferentiated symptoms
- First-line management of common conditions (hypertension, type 2 diabetes, dyslipidemia,
  uncomplicated infections, thyroid disorders, mild-moderate asthma/COPD, GERD, etc.)
- Preventive care: vaccinations, cancer screening schedules, cardiovascular risk screening
- Chronic disease monitoring and medication titration for stable, uncomplicated conditions
- Basic lab/imaging orders appropriate for primary-care-level workup
- Lifestyle counseling (diet, exercise, smoking/alcohol cessation)
- Identification of red flags requiring specialist referral, and the referral recommendation itself

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, refer instead):
- Subspecialty procedures (cardiac catheterization, endoscopy, dialysis initiation, chemotherapy/
  radiotherapy regimens, surgical procedures)
- Complex/refractory disease management that has failed first-line therapy — note that this
  "warrants specialist referral" rather than inventing subspecialty-level therapy
- ICU-level critical care management or emergency resuscitation protocols

If findings suggest a condition needing subspecialty input, you may note "referral to [specialty]
recommended" but must NOT invent procedures, regimens, or dosing that belongs to that specialty.
"""

EMERGENCY_MEDICINE_SKILL = """
SPECIALTY: EMERGENCY MEDICINE

You are acting strictly as an EMERGENCY PHYSICIAN. Every recommendation you produce must fall within
the scope of acute stabilization and immediate-term emergency department management.

YOU MUST GENERATE (when clinically indicated):
- Primary survey/stabilization priorities (airway, breathing, circulation, disability, exposure)
- Emergent diagnostics (point-of-care tests, stat labs/imaging) needed to rule in/out life threats
- Immediate resuscitative medications (IV fluids, emergency analgesia, empiric antibiotics for sepsis,
  reversal agents, emergency antiarrhythmics, thrombolytics/anticoagulation when time-critical)
- Emergency procedures within ED scope (airway management, procedural sedation, wound care,
  splinting/reduction, chest tube/needle decompression when indicated)
- Disposition decision: discharge with safety-netting, admission, ICU transfer, or OR activation

YOU MUST NOT GENERATE (strictly out of scope — omit entirely):
- Long-term/outpatient chronic disease management plans or medication titration protocols
- Elective procedures or surgical planning (leave to the admitting/surgical team)
- Curative-intent oncology regimens (chemotherapy, radiation, definitive cancer surgery planning)
- Long-term follow-up/monitoring schedules beyond immediate ED-to-admission handoff

Focus strictly on the acute presentation and immediate next steps; note "admit to [specialty] for
further management" rather than generating that specialty's ongoing treatment plan.
"""

CARDIOLOGY_SKILL = """
SPECIALTY: CARDIOLOGY

You are acting strictly as a CARDIOLOGIST (non-surgical, medical/interventional cardiology). Every
recommendation you produce must fall within the scope of cardiovascular diagnosis and medical/
catheter-based management.

YOU MUST GENERATE (when clinically indicated):
- Cardiovascular diagnostics (ECG, echocardiogram, stress testing, Holter monitor, coronary
  angiography, cardiac biomarkers, lipid panel)
- Pharmacological management: antihypertensives, antianginals, antiarrhythmics, anticoagulation/
  antiplatelet therapy, heart failure medications (ACEi/ARB/ARNI, beta-blockers, MRAs, SGLT2i),
  statins/lipid-lowering therapy
- Catheter-based interventions when within an interventional cardiology scope (PCI/stenting,
  pacemaker/ICD implantation) if clinically indicated and stated as such
- Cardiac risk stratification and peri-procedural cardiac clearance
- Cardiac-specific follow-up (echo intervals, device checks, anticoagulation monitoring)

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, note referral instead):
- Open cardiac/thoracic surgery (CABG, valve replacement/repair, aortic surgery) — note
  "cardiothoracic surgery referral recommended" without inventing surgical technique/steps
- Chemotherapy, radiation, or other oncologic treatment for cardiac tumors — refer to oncology
- Management of unrelated organ systems' primary disease outside a cardiac comorbidity lens
"""

PULMONOLOGY_SKILL = """
SPECIALTY: PULMONOLOGY

You are acting strictly as a PULMONOLOGIST. Every recommendation you produce must fall within the
scope of medical respiratory diagnosis and management.

YOU MUST GENERATE (when clinically indicated):
- Pulmonary diagnostics (spirometry/PFTs, chest imaging interpretation guidance, bronchoscopy,
  polysomnography, arterial blood gas interpretation)
- Pharmacological management: bronchodilators, inhaled/systemic corticosteroids, biologics for
  severe asthma, antifibrotics for ILD, antibiotics for respiratory infections, oxygen therapy,
  CPAP/BiPAP for sleep-disordered breathing
- Pulmonary rehabilitation referral and smoking cessation programs
- Non-surgical procedures within scope (bronchoscopy, thoracentesis)
- Respiratory-specific monitoring (PFT intervals, oxygen saturation targets)

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, note referral instead):
- Thoracic surgical procedures (lobectomy, pneumonectomy, lung transplant surgery) — refer to
  thoracic/surgical oncology
- Curative-intent chemotherapy/radiation regimens for lung malignancy — refer to medical/radiation
  oncology (may note need for multidisciplinary tumor board input)
- Cardiac-specific therapy unrelated to respiratory-cardiac overlap conditions
"""

ENDOCRINOLOGY_SKILL = """
SPECIALTY: ENDOCRINOLOGY

You are acting strictly as an ENDOCRINOLOGIST. Every recommendation you produce must fall within the
scope of hormonal and metabolic disease management.

YOU MUST GENERATE (when clinically indicated):
- Diabetes management: insulin regimens, oral/injectable hypoglycemics, glucose monitoring plans,
  management of diabetic ketoacidosis/hyperglycemic emergencies (medical management)
- Thyroid disorder management: levothyroxine, antithyroid drugs, radioactive iodine referral
- Adrenal, pituitary, and gonadal hormone disorder management and relevant hormone panels
- Metabolic bone disease management (osteoporosis pharmacotherapy, DEXA scheduling, calcium/
  vitamin D management)
- Endocrine-specific labs and dynamic testing (stimulation/suppression tests)

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, note referral instead):
- Surgical procedures (thyroidectomy, parathyroidectomy, adrenalectomy, pituitary surgery) —
  note "surgical referral recommended" without inventing operative detail
- Oncologic chemotherapy/radiation regimens for endocrine malignancies — refer to oncology
- Diabetic foot wound care/debridement or vascular assessment — refer to diabetic foot/wound care
  specialty (may co-manage glycemic control only)
"""

GASTROENTEROLOGY_SKILL = """
SPECIALTY: GASTROENTEROLOGY

You are acting strictly as a GASTROENTEROLOGIST. Every recommendation you produce must fall within
the scope of medical/endoscopic management of digestive tract and liver disease.

YOU MUST GENERATE (when clinically indicated):
- Endoscopic diagnostics/procedures (upper endoscopy, colonoscopy, ERCP, capsule endoscopy)
- Pharmacological management: PPIs/H2 blockers, IBD therapy (5-ASA, immunomodulators, biologics),
  antivirals for viral hepatitis, laxatives/antidiarrheals, hepatic disease management
- GI-specific labs and imaging (liver panel, fibroscan, abdominal imaging interpretation guidance)
- Nutritional support recommendations tied to GI disease (e.g. IBD flare, malabsorption)
- Surveillance intervals for GI conditions (colonoscopy surveillance, varices screening)

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, note referral instead):
- GI surgical resections (colectomy, gastrectomy, liver resection, transplant surgery) — refer to
  surgical oncology/general/transplant surgery
- Curative-intent chemotherapy/radiation for GI malignancy — refer to medical/radiation oncology
- Management of unrelated systemic disease outside a GI/hepatic comorbidity lens
"""

NEPHROLOGY_SKILL = """
SPECIALTY: NEPHROLOGY

You are acting strictly as a NEPHROLOGIST. Every recommendation you produce must fall within the
scope of medical kidney disease management.

YOU MUST GENERATE (when clinically indicated):
- CKD/AKI staging, workup, and medical management (fluid/electrolyte correction, RAAS blockade,
  SGLT2i, phosphate binders, erythropoiesis-stimulating agents, vitamin D analogues)
- Dialysis modality selection and prescription (hemodialysis/peritoneal dialysis parameters)
- Renal-dose adjustment guidance for medications in renal impairment
- Post-transplant medical management (immunosuppression monitoring, rejection surveillance labs)
- Renal-specific monitoring (eGFR/creatinine trends, electrolytes, proteinuria)

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, note referral instead):
- Surgical procedures (dialysis access creation, transplant surgery, nephrectomy) — refer to
  vascular/transplant/urologic surgery
- Oncologic chemotherapy/radiation for renal malignancy — refer to oncology
- Primary management of unrelated systemic disease outside a renal comorbidity lens
"""

DIABETIC_FOOT_SKILL = """
SPECIALTY: DIABETIC FOOT CARE

You are acting strictly as a DIABETIC FOOT / LIMB-PRESERVATION SPECIALIST. Every recommendation you
produce must fall within the scope of diabetic foot and lower-limb complication management.

YOU MUST GENERATE (when clinically indicated):
- Diabetic foot ulcer assessment (Wagner/University of Texas grading), wound care, and debridement
  planning
- Offloading strategies (total contact casting, offloading footwear)
- Infection management for foot/soft tissue infection (antibiotic choice pending culture, escalation
  criteria for limb-threatening infection)
- Peripheral neuropathy and peripheral arterial disease screening, and vascular referral triage
- Amputation-prevention monitoring and foot-care education/self-inspection guidance
- Coordination points with endocrinology for glycemic control as it affects wound healing

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, note referral instead):
- Systemic diabetes medication regimens/titration — refer to endocrinology
- Vascular bypass/revascularization surgery — refer to vascular surgery
- Oncologic management of any skin/soft tissue malignancy found incidentally — refer to oncology
"""

ANESTHESIOLOGY_SKILL = """
SPECIALTY: ANESTHESIOLOGY

You are acting strictly as an ANESTHESIOLOGIST. Every recommendation you produce must fall within
the scope of peri-operative anesthesia, sedation, and procedural pain management.

YOU MUST GENERATE (when clinically indicated):
- Pre-anesthetic risk assessment (ASA physical status, airway assessment, relevant optimization)
- Anesthesia technique selection (general, regional, neuraxial, sedation) and airway management plan
- Intra-operative monitoring and hemodynamic/fluid management plan
- Regional/neuraxial block planning for peri-operative or chronic pain indications
- Post-operative pain management (multimodal analgesia, PCA, nerve blocks) and PONV prophylaxis
- Peri-operative medication management (holding/bridging anticoagulants, stress-dose steroids)

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, note referral instead):
- The primary surgical procedure itself, its indication, or operative technique — that is the
  surgeon's scope; anesthesiology plans around it, not for it
- Long-term disease-modifying treatment (chemotherapy, radiation, chronic disease titration)
- Oncologic treatment planning of any kind
"""

ONCO_PAIN_PALLIATIVE_SKILL = """
SPECIALTY: ONCO PAIN AND PALLIATIVE CARE

You are acting strictly as an ONCOLOGY PAIN AND PALLIATIVE CARE SPECIALIST. Every recommendation you
produce must fall within the scope of symptom control, quality-of-life, and non-curative supportive
care for patients with serious/advanced illness.

YOU MUST GENERATE (when clinically indicated):
- Cancer pain assessment and analgesic ladder management (non-opioid, opioid titration/rotation,
  adjuvant agents for neuropathic pain, interventional pain procedures referral when needed)
- Management of other distressing symptoms: nausea/vomiting, dyspnea, constipation, fatigue,
  delirium, anorexia/cachexia
- Goals-of-care discussions, advance care planning, and hospice-eligibility guidance
- Psychosocial and spiritual support coordination for patient and family
- End-of-life symptom management protocols

YOU MUST NOT GENERATE (strictly out of scope — omit entirely, note referral instead):
- Curative-intent or disease-modifying treatment: chemotherapy, immunotherapy, targeted/hormonal
  therapy, radiation regimens, or surgical procedures — that belongs to Medical/Radiation/Surgical
  Oncology
- Primary disease staging/workup decisions — you may note "multidisciplinary tumor board input"
  but must not invent disease-directed treatment plans
"""



SPECIALTY_SKILLS: Dict[str, str] = {
    "Medical Oncology": MEDICAL_ONCOLOGY_SKILL,
    "Radiation Oncology": RADIATION_ONCOLOGY_SKILL,
    "Surgical Oncology": SURGICAL_ONCOLOGY_SKILL,
    "General Medicine": GENERAL_MEDICINE_SKILL,
    "Emergency": EMERGENCY_MEDICINE_SKILL,
    "Cardiology": CARDIOLOGY_SKILL,
    "Pulmonology": PULMONOLOGY_SKILL,
    "Endocrinology": ENDOCRINOLOGY_SKILL,
    "Gastroenterology": GASTROENTEROLOGY_SKILL,
    "Nephrology": NEPHROLOGY_SKILL,
    "Diabetic foot": DIABETIC_FOOT_SKILL,
    "Anesthesiology": ANESTHESIOLOGY_SKILL,
    "Onco Pain and Palliative Care": ONCO_PAIN_PALLIATIVE_SKILL,
}

# Keywords used for excluded-category safety-net filtering (belt-and-suspenders on top of the
# prompt-level instructions above -- the LLM is instructed not to generate these, but we also
# filter defensively in code in case it slips).
SPECIALTY_EXCLUDED_DRUG_KEYWORDS: Dict[str, List[str]] = {
    "Medical Oncology": [],
    "Radiation Oncology": [
        "chemotherapy", "immunotherapy", "targeted therapy", "hormonal therapy",
        "endocrine therapy", "hormone therapy"
    ],
    "Surgical Oncology": [
        "chemotherapy", "immunotherapy", "targeted therapy", "hormonal therapy",
        "endocrine therapy", "hormone therapy", "radiosensitizer"
    ],
}

SPECIALTY_EXCLUDED_PROCEDURE_KEYWORDS: Dict[str, List[str]] = {
    "Medical Oncology": ["resection", "cystectomy", "mastectomy", "lobectomy", "prostatectomy",
                          "colectomy", "brachytherapy", "radiation implant"],
    "Radiation Oncology": ["resection", "cystectomy", "mastectomy", "lobectomy", "prostatectomy",
                            "colectomy", "laparoscopic", "robotic surgery", "open surgery"],
    "Surgical Oncology": ["brachytherapy", "external beam radiation", "radiation implant",
                           "radiotherapy"],
}


def resolve_specialty_label(doctor_speciality: Optional[str]) -> str:
    """
    Resolve a raw doctor_speciality string (as stored in doctor_users / passed via
    additional_input) to one of the canonical specialty labels used by SPECIALTY_SKILLS.
    Falls back to "Medical Oncology" (the safest default) if unrecognized.
    """
    if not doctor_speciality:
        return "Medical Oncology"

    normalized = doctor_speciality.strip().lower()

    # Exact match first
    for canonical in SPECIALTY_SKILLS.keys():
        if canonical.lower() == normalized:
            return canonical

    # Fuzzy / substring match (handles values like "Surgical Onc.", "Radiation Onc - Head & Neck")
    if "radiation" in normalized or "radiotherapy" in normalized or "clinical oncology" in normalized:
        return "Radiation Oncology"
    if "surgical" in normalized or "surgery" in normalized or "surgeon" in normalized:
        return "Surgical Oncology"
    if "medical oncology" in normalized or "med onc" in normalized or "oncology" in normalized:
        return "Medical Oncology"

    logger.info(f"ℹ️ Unrecognized doctor_speciality '{doctor_speciality}' — defaulting specialty skill to Medical Oncology")
    return "Medical Oncology"


def get_specialty_skill(doctor_speciality: Optional[str]) -> str:
    """Return the specialty skill prompt block for the given doctor_speciality."""
    canonical = resolve_specialty_label(doctor_speciality)
    return SPECIALTY_SKILLS.get(canonical, MEDICAL_ONCOLOGY_SKILL)


# =====================================================================
# PATIENT CONTEXT LAYER (FULL-DATA, SCHEMA-AGNOSTIC)
# =====================================================================
#
# Every agent previously built its own narrow "agentic_context" dict by hand,
# reading only patient_summary["summary"]["paragraphs"] and
# patient_summary["timeline"]["timeline"]. That silently dropped everything
# else that might be sitting in the patient_summary document -- tumor size,
# staging, biomarkers, lab trends, prior treatment phases, imaging findings,
# current medical condition, etc. -- whatever keys happen to exist in that
# document for a given patient.
#
# build_full_patient_context() replaces all of those hand-rolled blocks. It
# does NOT guess or hardcode specific clinical field names (no assumptions
# like "tumor size must be under imaging_summary.size") -- instead it passes
# the ENTIRE patient_summary document through untouched (JSON-safe), plus
# pulls out the clinical_summary text and timeline entries at the top level
# purely for prompt readability. Whatever fields the summary/timeline
# generation pipeline actually populates (tumor size, stage, biomarkers, labs,
# treatment phases, whatever they're called) are therefore always available
# to every downstream agent -- nothing is predefined or filtered out.
#
# This function is purely a data-plumbing utility. It does not participate in
# specialty routing/scoping in any way -- SPECIALTY_SKILLS, resolve_specialty_label,
# and all specialty filtering logic above/below are untouched.

def _json_safe_default(obj: Any) -> Any:
    """default= handler for json.dumps so ObjectId/datetime/date/set never blow up serialization."""
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, ObjectId):
        return str(obj)
    if isinstance(obj, set):
        return list(obj)
    try:
        return str(obj)
    except Exception:
        return None


def to_json(context: Dict[str, Any]) -> str:
    """Serialize an agentic context dict for prompt injection, JSON-safe."""
    return json.dumps(context, indent=2, default=_json_safe_default)
    """
    Build the complete patient context object passed into every agent prompt.

    Contract:
    - "clinical_summary": joined narrative paragraphs (if present) -- kept at the
      top level purely for prompt readability, not because other fields are excluded.
    - "timeline_entries": the timeline list (if present), same reason as above.
    - "full_patient_record": the ENTIRE patient_summary document, verbatim,
      JSON-safe. This is the actual source of truth -- tumor size, staging,
      biomarkers, labs, imaging, treatment phases, current condition, prior
      procedures/investigations/medications, and anything else the summary
      pipeline ever attaches, all flow through here with no field allow-list.

    No clinical field names are assumed or required to exist. If the summary
    pipeline adds a new field tomorrow (e.g. a new biomarker or staging key),
    it is automatically visible to every agent without touching this function.
    """
    ps = patient_summary or {}

    # Narrative convenience extraction (best-effort; absence of these keys is fine --
    # the full record below still carries everything regardless).
    summary_data = ps.get("summary") if isinstance(ps.get("summary"), dict) else {}
    paragraphs = summary_data.get("paragraphs") if isinstance(summary_data, dict) else None
    clinical_summary_text = "\n\n".join(paragraphs) if isinstance(paragraphs, list) else ""

    timeline_block = ps.get("timeline") if isinstance(ps.get("timeline"), dict) else {}
    timeline_entries = timeline_block.get("timeline") if isinstance(timeline_block, dict) else None
    if not isinstance(timeline_entries, list):
        timeline_entries = []

    # Full, unfiltered passthrough of the patient_summary document.
    try:
        full_record = copy.deepcopy(ps)
    except Exception:
        full_record = ps

    if isinstance(full_record, dict):
        full_record.pop("_id", None)  # internal Mongo id only, not clinical data

    return {
        "clinical_summary": clinical_summary_text,
        "timeline_entries": timeline_entries,
        "full_patient_record": full_record,
    }


def to_json(context: Dict[str, Any]) -> str:
    """Serialize an agentic context dict for prompt injection, JSON-safe."""
    return json.dumps(context, indent=2, default=_json_safe_default)


# =====================================================================
# PYDANTIC SCHEMAS
# =====================================================================

class PrimaryDiagnosis(BaseModel):
    """Primary diagnosis from diagnostic agent"""
    disease: str
    icd10_code: Optional[str] = None
    stage: Optional[str] = None
    severity: str = "moderate"
    confidence: float = 0.8


class CompletedProcedure(BaseModel):
    """Already performed procedure"""
    procedure_name: str
    date_performed: str
    outcome: Optional[str] = None
    complications: Optional[str] = None


class CompletedInvestigation(BaseModel):
    """Already completed investigation"""
    test_name: str
    date_performed: str
    result: Optional[str] = None
    is_abnormal: bool = False


class CurrentMedication(BaseModel):
    """Medication patient is currently taking"""
    drug_name: str
    dose: str
    frequency: str
    route: str
    started_date: Optional[str] = None
    indication: Optional[str] = None


class Allergy(BaseModel):
    """Drug/substance allergy"""
    allergen: str
    reaction: str
    severity: str = "moderate"

class PrognosisData(BaseModel):
    overall_prognosis: Optional[str] = None
    five_year_survival_rate: Optional[float] = None
    expected_treatment_response: Optional[str] = None
    risk_stratification: Optional[str] = None
    performance_status: Optional[str] = None
    complication_risk: Optional[str] = None


class TreatmentPlanInput(BaseModel):
    """Input schema for treatment planning"""
    # From diagnostic agent
    primary_diagnosis: Optional[PrimaryDiagnosis] = None
    prognosis: Optional[PrognosisData] = None
    alternative_diagnoses: List[str] = Field(default_factory=list)
    
    # Patient context
    patient_id: str
    patient_age: Optional[int] = None
    patient_sex: Optional[str] = None
    patient_weight_kg: Optional[float] = None
    
    # Medical history
    comorbidities: List[str] = Field(default_factory=list)
    allergies: List[Allergy] = Field(default_factory=list)
    current_medications: List[CurrentMedication] = Field(default_factory=list)
    
    # Organ function
    renal_function_egfr: Optional[float] = None  # mL/min/1.73m²
    hepatic_function: Optional[str] = "normal"  # normal/mild/moderate/severe impairment
    cardiac_function_ef: Optional[float] = None  # Ejection fraction %
    
    # Already completed (CRITICAL - avoid duplication)
    completed_procedures: List[CompletedProcedure] = Field(default_factory=list)
    completed_investigations: List[CompletedInvestigation] = Field(default_factory=list)
    
    # Clinical context
    visit_type: Optional[str] = None  # first_visit, followup, emergency, etc.
    doctor_speciality: Optional[str] = None
    treatment_setting: Optional[str] = "outpatient"  # outpatient/inpatient/icu
    
    # Preferences
    cost_sensitivity: Optional[str] = "moderate"  # low/moderate/high
    patient_preferences: Optional[str] = None


class DrugRecommendation(BaseModel):
    """Pharmacological treatment recommendation"""
    drug_name: str
    drug_class: str
    indication: str
    dose: str
    frequency: str
    route: str
    duration: str
    
    # Evidence
    guideline_support: GuidelineSource
    recommendation_class: RecommendationClass
    evidence_level: EvidenceLevel
    
    # Guideline Rationale — WHY this drug for THIS patient
    guideline_rationale: str = ""           # e.g. "NCCN 2024 Category 1 — MVAC shown superior OS in SWOG S8710 trial"
    patient_specific_reason: str = ""      # e.g. "Chosen over gemcitabine due to patient age <65 and normal renal function"
    supporting_trial: Optional[str] = None # e.g. "SWOG S8710", "CheckMate 274"
    
    # Safety
    contraindications_checked: bool = True
    renal_dose_adjustment: Optional[str] = None
    hepatic_dose_adjustment: Optional[str] = None
    drug_interactions: List[str] = Field(default_factory=list)
    
    # Monitoring
    monitoring_required: List[str] = Field(default_factory=list)
    monitoring_frequency: Optional[str] = None
    
    # Alternatives
    alternative_if_unavailable: Optional[str] = None
    generic_available: bool = True
    approximate_cost: Optional[str] = None



class ProcedureStep(BaseModel):
    """Individual procedure step"""

    step_number: int
    title: str
    description: str
    expected_duration: Optional[str] = None
    responsible_team: Optional[str] = None
    equipment_required: List[str] = Field(default_factory=list)
    precautions: List[str] = Field(default_factory=list)


class ProceduralRecommendation(BaseModel):
    """Surgical/Procedural Recommendation"""

    # Procedure Details
    procedure_name: str
    patient_needs_this: bool = True
    reason_needed: str

    indication: str
    timing: str

    # Guideline Evidence
    guideline_support: GuidelineSource
    recommendation_class: RecommendationClass
    evidence_level: EvidenceLevel

    # Rationale
    guideline_rationale: str = ""
    patient_specific_reason: str = ""
    supporting_trial: Optional[str] = None

    # Procedure Workflow
    procedure_steps: List[str] = Field(default_factory=list)

    # Planning
    estimated_duration: Optional[str] = None
    anesthesia_type: Optional[str] = None

    # Safety
    prerequisites: List[str] = Field(default_factory=list)
    contraindications: List[str] = Field(default_factory=list)
    expected_complications: List[str] = Field(default_factory=list)

    # Post Procedure
    post_procedure_care: List[str] = Field(default_factory=list)

    # Risk Assessment
    cardiac_risk_note: str = "safe"

    # Optional Information
    estimated_blood_loss: Optional[str] = None
    hospital_stay: Optional[str] = None
    recovery_time: Optional[str] = None
    follow_up_schedule: Optional[str] = None

    expected_benefit: Optional[str] = None
    expected_outcome: Optional[str] = None
    success_rate: Optional[str] = None

    alternative_procedure: Optional[str] = None
    comments: Optional[str] = None

    # Specialty Validation
    specialty_scope_compliant: bool = True
    specialty_scope_reason: Optional[str] = None


class InvestigationRecommendation(BaseModel):
    """Diagnostic test recommendation"""
    test_name: str
    parameters: List[str] = Field(default_factory=list)
    indication: str
    urgency: str
    
    # Justification
    expected_finding: str
    will_change_management: bool = True
    what_decision_it_drives: str = ""      # e.g. "Will determine T-stage and eligibility for bladder preservation"
    
    # Guideline Rationale — WHY this test for THIS patient
    guideline_rationale: str = ""          # e.g. "NCCN recommends CT urogram — detects upper tract disease in 3-5% of cases"
    patient_specific_reason: str = ""     # e.g. "Ordered because prior imaging showed left hydroureter suspicious for ureteral involvement"
    
    # Already done check
    already_completed: bool = False
    last_result_date: Optional[str] = None
    repeat_justified: bool = False
    repeat_justification: Optional[str] = None


class LifestyleRecommendation(BaseModel):
    """Non-pharmacological lifestyle intervention"""
    intervention_type: str
    specific_recommendation: str
    evidence_strength: EvidenceLevel
    expected_benefit: str
    implementation_difficulty: str = "moderate"
    
    # Guideline Rationale — WHY this lifestyle change for THIS patient
    guideline_rationale: str = ""          # e.g. "ACS 2023 — smoking is #1 modifiable risk factor for bladder cancer, responsible for 50% of cases"
    patient_specific_reason: str = ""     # e.g. "Critical for this patient as continued smoking doubles recurrence risk post-cystectomy"
    supporting_evidence: Optional[str] = None  # e.g. "Meta-analysis of 32 studies (Cumberbatch et al., 2016)"


class MonitoringParameter(BaseModel):
    parameter: str
    reason: str = ""
    guideline: str = ""
    frequency: str = ""

class SuccessCriterion(BaseModel):
    criterion: str
    guideline_basis: str = ""

class EscalationTrigger(BaseModel):
    trigger: str
    action: str = ""
    guideline_basis: str = ""

class FollowUpPlan(BaseModel):
    """Follow-up scheduling"""
    next_visit_timing: str
    follow_up_guideline_rationale: str = ""
    monitoring_parameters: List[Any] = Field(default_factory=list)  # List[MonitoringParameter] or List[str]
    success_criteria: List[Any] = Field(default_factory=list)       # List[SuccessCriterion] or List[str]
    escalation_triggers: List[Any] = Field(default_factory=list)    # List[EscalationTrigger] or List[str]

class ValidationResult(BaseModel):
    is_valid: bool
    validation_score: float
    guideline_compliance_score: float = 0.0
    critical_issues: List[str] = Field(default_factory=list)
    warnings: List[str] = Field(default_factory=list)
    recommendations_to_remove: List[str] = Field(default_factory=list)
    recommendations_to_add: List[str] = Field(default_factory=list)
    guideline_compliance_notes: List[str] = Field(default_factory=list)
    safety_notes: List[str] = Field(default_factory=list)

class TreatmentPlan(BaseModel):
    """Complete treatment plan output"""
    # Intent
    rank: Optional[int] = None
    treatment_intent: TreatmentIntent
    primary_goals: List[str] = Field(default_factory=list)

    # Specialty scoping (NEW)
    treating_specialty: Optional[str] = None
    specialty_scope_notes: List[str] = Field(default_factory=list)
    
    # Pharmacological
    first_line_drugs: List[DrugRecommendation] = Field(default_factory=list)
    adjunctive_drugs: List[DrugRecommendation] = Field(default_factory=list)
    
    # Procedural
    recommended_procedures: List[ProceduralRecommendation] = Field(default_factory=list)
    
    # Investigations
    required_investigations: List[InvestigationRecommendation] = Field(default_factory=list)
    
    # Non-pharmacological
    lifestyle_modifications: List[LifestyleRecommendation] = Field(default_factory=list)
    
    # Safety
    contraindications_detected: List[str] = Field(default_factory=list)
    drug_interactions_detected: List[str] = Field(default_factory=list)
    
    # Follow-up
    follow_up_plan: FollowUpPlan

    strategy: TreatmentStrategy = TreatmentStrategy.STANDARD
    validation_result: Optional[ValidationResult] = None
    
    # Metadata
    guideline_compliance_score: float = 0.0
    cost_effectiveness_tier: str = "moderate"
    patient_adherence_prediction: str = "moderate"
    
    # Warnings
    warnings: List[str] = Field(default_factory=list)
    requires_specialist_review: bool = False
    
    # Summary
    treatment_summary: str = ""
    confidence_score: float = 0.0

# =====================================================================
# STATE DEFINITION
# =====================================================================

class TreatmentPlanState(TypedDict):
    """LangGraph state for treatment planning"""
    # Input
    treatment_input: TreatmentPlanInput
    
    # ✅ FIX 1: Added patient_summary to state
    patient_summary: Optional[Dict[str, Any]]

    # Doctor's selected guidelines (fetched from doctor_guidelines_collection)
    doctor_guidelines: List[Dict[str, Any]]
    allowed_guideline_titles: List[str]

    # Specialty Skill Layer (NEW)
    specialty_skill: Optional[str]
    resolved_specialty: Optional[str]

    # Layer 1: Intent & Goals
    treatment_intent: Optional[TreatmentIntent]
    treatment_goals: List[str]
    
    # Layer 2: Guideline Retrieval
    applicable_guidelines: List[Dict[str, Any]]
    guideline_recommendations: Dict[str, Any]
    
    # Layer 3: Exclusion Filters
    excluded_procedures: Set[str]
    excluded_investigations: Set[str]
    
    # Layer 4: Drug Recommendations
    candidate_drugs: List[DrugRecommendation]
    
    # Layer 5: Procedural Recommendations
    candidate_procedures: List[ProceduralRecommendation]
    
    # Layer 6: Investigation Recommendations
    candidate_investigations: List[InvestigationRecommendation]
    
    # Layer 7: Safety Validation
    contraindications: List[str]
    drug_interactions: List[str]
    
    # Layer 8: Cost-Effectiveness
    cost_analysis: Dict[str, Any]
    
    # Layer 9: Follow-up Planning
    follow_up_plan: Optional[FollowUpPlan]
    
    # Lifestyle recommendations
    lifestyle_recommendations: List[LifestyleRecommendation]

    current_strategy: Optional[TreatmentStrategy]
    prognosis: Optional[PrognosisData]
    
    # Final output
    treatment_plan: Optional[TreatmentPlan]
    
    # Metadata
    error: Optional[str]
    warnings: List[str]


# ==================================================================
# NEO4J TREATMENT KNOWLEDGE GRAPH
# =====================================================================

class TreatmentKnowledgeGraph:
    """Neo4j-based treatment knowledge graph"""
    
    def __init__(self, uri: str, user: str, password: str):
        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        logger.info(f"✅ Treatment Knowledge Graph connected: {uri}")
    
    def close(self):
        if self.driver:
            self.driver.close()
    
    def get_treatment_guidelines(
        self,
        disease: str,
        stage: Optional[str] = None,
        specialty: Optional[str] = None,
        prior_treatments: Optional[List[str]] = None
    ) -> List[Dict[str, Any]]:
        """Retrieve treatment guidelines from knowledge graph"""

        query = """
        MATCH (d:Disease)
        WHERE toLower(d.name) = toLower($disease)
        OR toLower(d.name) CONTAINS toLower($disease)
        MATCH (d)-[:HAS_TREATMENT]->(t:Treatment)
        OPTIONAL MATCH (t)-[:RECOMMENDED_BY]->(g:Guideline)
        WHERE ($stage IS NULL OR toLower(t.applicable_stage) = toLower($stage)
            OR t.applicable_stage IS NULL)
        AND ($specialty IS NULL OR toLower(g.specialty) = toLower($specialty)
            OR g.specialty IS NULL)
        AND NOT (
            size($prior_treatments) > 0
            AND toLower(t.name) IN [x IN $prior_treatments | toLower(x)]
            AND t.line_of_therapy = 'first_line'
        )
        RETURN
            t.name as treatment,
            t.modality as modality,
            t.recommendation_class as rec_class,
            t.evidence_level as evidence,
            g.source as guideline,
            t.first_line as is_first_line,
            t.line_of_therapy as line_of_therapy
        ORDER BY t.first_line DESC, t.recommendation_class ASC
        LIMIT 20
        """

        try:
            with self.driver.session() as session:
                result = session.run(
                    query,
                    disease=disease,
                    stage=stage,
                    specialty=specialty,
                    prior_treatments=prior_treatments or []
                )
                
                treatments = []
                for record in result:
                    treatments.append({
                        "treatment": record["treatment"],
                        "modality": record["modality"],
                        "recommendation_class": record["rec_class"],
                        "evidence_level": record["evidence"],
                        "guideline": record["guideline"],
                        "is_first_line": record["is_first_line"]
                    })
                
                logger.info(f"📊 Retrieved {len(treatments)} treatments from knowledge graph")
                return treatments
                
        except Exception as e:
            logger.error(f"❌ Neo4j treatment query failed: {str(e)}")
            return []
    
    def get_drug_interactions(
        self,
        drug_name: str,
        current_medications: List[str]
    ) -> List[Dict[str, Any]]:
        """Check drug-drug interactions"""
        
        query = """
        MATCH (d1:Drug {name: $drug_name})-[i:INTERACTS_WITH]->(d2:Drug)
        WHERE d2.name IN $current_meds
        RETURN 
            d2.name as interacting_drug,
            i.severity as severity,
            i.mechanism as mechanism,
            i.management as management
        """
        
        try:
            with self.driver.session() as session:
                result = session.run(
                    query,
                    drug_name=drug_name,
                    current_meds=current_medications
                )
                
                interactions = []
                for record in result:
                    interactions.append({
                        "drug": record["interacting_drug"],
                        "severity": record["severity"],
                        "mechanism": record["mechanism"],
                        "management": record["management"]
                    })
                
                return interactions
                
        except Exception as e:
            logger.error(f"❌ Interaction query failed: {str(e)}")
            return []
    
    def get_contraindications(
        self,
        drug_name: str,
        comorbidities: List[str],
        patient_age: int,
        renal_function: Optional[float]
    ) -> List[str]:
        """Check contraindications for a drug"""
        
        query = """
        MATCH (d:Drug {name: $drug_name})-[:CONTRAINDICATED_IN]->(c:Condition)
        WHERE c.name IN $comorbidities
        RETURN c.name as condition, 'absolute' as type
        
        UNION
        
        MATCH (d:Drug {name: $drug_name})-[:CAUTION_IN]->(c:Condition)
        WHERE c.name IN $comorbidities
        RETURN c.name as condition, 'relative' as type
        """
        
        try:
            with self.driver.session() as session:
                result = session.run(
                    query,
                    drug_name=drug_name,
                    comorbidities=comorbidities
                )
                
                contraindications = []
                for record in result:
                    contraindications.append(
                        f"{record['type'].upper()}: {record['condition']}"
                    )
                
                # Age-based contraindications
                if patient_age >= 65:
                    # Check Beers Criteria
                    beers_query = """
                    MATCH (d:Drug {name: $drug_name})-[:BEERS_CRITERIA]->(b)
                    RETURN b.warning as warning
                    """
                    beers_result = session.run(beers_query, drug_name=drug_name)
                    for record in beers_result:
                        contraindications.append(f"BEERS: {record['warning']}")
                
                # Renal contraindications
                if renal_function and renal_function < 60:
                    renal_query = """
                    MATCH (d:Drug {name: $drug_name})
                    WHERE d.avoid_if_egfr_below > $egfr
                    RETURN d.renal_warning as warning
                    """
                    renal_result = session.run(renal_query, drug_name=drug_name, egfr=renal_function)
                    for record in renal_result:
                        contraindications.append(f"RENAL: {record['warning']}")
                
                return contraindications
                
        except Exception as e:
            logger.error(f"❌ Contraindication query failed: {str(e)}")
            return []


# =====================================================================
# LAYER 1: TREATMENT INTENT & GOAL IDENTIFICATION
# =====================================================================

class TreatmentIntentAgent:
    """Determines treatment intent and goals"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def determine_intent(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Identify treatment intent based on diagnosis and patient summary"""
        
        logger.info("🎯 Treatment Intent Agent: Starting for patient ID %s", state["treatment_input"].patient_id)
        
        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        patient_summary = state.get("patient_summary") or {}
        logger.info(f"📋 Patient summary retrieved: {patient_summary}")

        # ── FULL, SCHEMA-AGNOSTIC PATIENT CONTEXT ──
        # Pulls the entire patient_summary document (tumor size, stage, biomarkers,
        # labs, imaging, prior treatments, current condition, timeline, etc.) instead
        # of only clinical_summary paragraphs + a trimmed timeline slice.
        summary_data = patient_summary.get("summary", {}) if isinstance(patient_summary, dict) else {}
        clinical_summary_text = "\n\n".join(summary_data.get("paragraphs", []))

        timeline_data = patient_summary.get("timeline", {}) if isinstance(patient_summary, dict) else {}
        timeline_entries = timeline_data.get("timeline", [])

        agentic_context = {
            "clinical_summary": clinical_summary_text,
            "timeline": timeline_entries
        }

        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)

        logger.info(f"🎯 TreatmentIntentAgent | agentic_context: {patient_summary_json}")
        strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)
        prognosis = state.get("prognosis")
        prognosis_context = ""
        if prognosis:
            prognosis_context = f"""
        PROGNOSIS DATA (use to inform intent — poor prognosis may shift curative → palliative):
        Overall prognosis        : {prognosis.overall_prognosis or 'Not specified'}
        5-year survival rate     : {prognosis.five_year_survival_rate or 'Unknown'}
        Risk stratification      : {prognosis.risk_stratification or 'Not specified'}
        Expected treatment response: {prognosis.expected_treatment_response or 'Not specified'}
        Performance status       : {prognosis.performance_status or 'Not specified'}
"""

        summary_context = f"""
        PATIENT CLINICAL CONTEXT (full patient record — clinical summary, timeline, tumor/imaging
        characteristics, labs, biomarkers, prior treatments, current condition, everything the
        summary pipeline has on this patient — use ALL of it, not just the narrative text, to decide intent):
        {patient_summary_json}
        {prognosis_context}
        INTENT MAPPING RULES — apply strictly in this order:
        1. If imaging confirms distant metastasis (liver/lung/bone/brain) → palliative
        2. If nodal metastasis only (regional lymph nodes), no distant spread, newly diagnosed → curative
        3. If early stage (I or II), no metastasis → curative
        4. If chronic stable disease under ongoing management → disease_modifying
        5. If progressive after multiple treatment lines with no curative option remaining → palliative
        6. If acute crisis (sepsis, obstruction, hemorrhage, severe pain) → symptom_control
        7. If no active disease, only risk factors → preventive

        CRITICAL: Nodal involvement alone does NOT make intent palliative.
        Only assign palliative if distant organ metastasis is explicitly documented in the imaging above.
        """

        if not patient_summary:
            logger.warning("Patient summary is missing. Using default values.")

        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            logger.info("No structured primary_diagnosis provided - deriving intent from clinical summary/timeline")

            prompt = f"""You are a senior physician determining treatment intent.

⚠️ PRIORITY INSTRUCTION — READ THIS FIRST:
No structured diagnosis object was passed with this request. This does NOT mean the patient is healthy —
it only means the caller didn't attach one. Your first and most important job is to read the PATIENT
CLINICAL CONTEXT below (full patient record — clinical summary + timeline + tumor/imaging characteristics +
labs + prior treatments + current condition) and determine if it documents an active disease.

- If the clinical context documents ANY active serious condition — cancer, cardiac disease, organ failure,
  active infection, or any diagnosed pathology — you MUST treat that as the real primary condition and
  choose intent (curative / disease_modifying / palliative / symptom_control) exactly as you would if it
  had been passed as a structured diagnosis. Do NOT downgrade a real disease into a "wellness plan."
- Only choose "preventive" if the clinical context shows NO active disease process at all — i.e. a
  genuinely healthy patient with, at most, risk factors and no diagnosed condition.
- Silently defaulting to "preventive" without checking the clinical context below is a critical error.

PATIENT CONTEXT:
Age: {treatment_input.patient_age}
Sex: {treatment_input.patient_sex}
Comorbidities: {', '.join(treatment_input.comorbidities)}
Current Medications: {', '.join([m.drug_name for m in treatment_input.current_medications])}
Visit Type: {treatment_input.visit_type}

{summary_context}

TASK:
1. Read the clinical context above and identify the actual active condition, if any.
2. Select the treatment intent that matches that real condition (not a default).
3. Define 3-5 specific, measurable goals appropriate to that condition and intent — e.g. for an active
   cancer diagnosis, goals should reflect staging, treatment initiation, and disease control — NOT generic
   wellness language — unless the patient is genuinely healthy.

OUTPUT (JSON):
{{
  "identified_condition": "the actual disease/condition found in the clinical context, or 'none identified'",
  "treatment_intent": "EXACTLY ONE of: curative, disease_modifying, palliative, symptom_control, preventive",
  "treatment_goals": [
    "Specific measurable goal 1",
    "Specific measurable goal 2",
    "Specific measurable goal 3"
  ]
}}

Return ONLY JSON."""
        else:
            prompt = f"""You are a senior physician determining treatment intent.

            DIAGNOSIS: {primary_dx.disease} | STAGE: {primary_dx.stage or 'Not specified'} | SEVERITY: {primary_dx.severity}
            AGE: {treatment_input.patient_age} | VISIT: {treatment_input.visit_type}

            {summary_context}

            Read the patient summary above carefully. Apply the intent mapping rules to select exactly one intent.
            Then define 3-5 specific measurable treatment goals based on the patient's actual condition.

            OUTPUT JSON only:
            {{
            "treatment_intent": "curative|disease_modifying|palliative|symptom_control|preventive",
            "treatment_goals": ["goal 1", "goal 2", "goal 3"]
            }}"""
        
        try:
            response = self.llm.invoke( [  # Send prompt to LLM for treatment intent
                SystemMessage(content="Determine treatment intent. Return only JSON."),
                HumanMessage(content=prompt)
            ])
            
            result = self._parse_json(response.content)
            
            # FIX: Handle invalid intent values
            raw_intent = result.get("treatment_intent", "").lower()
            
            # Map to valid enum
            valid_intents = {
                "curative": TreatmentIntent.CURATIVE,
                "disease_modifying": TreatmentIntent.DISEASE_MODIFYING,
                "palliative": TreatmentIntent.PALLIATIVE,
                "symptom_control": TreatmentIntent.SYMPTOM_CONTROL,
                "preventive": TreatmentIntent.PREVENTIVE
            }
            
            # If invalid or contains pipe, default to symptom_control or preventive
            if raw_intent in valid_intents:
                state["treatment_intent"] = valid_intents[raw_intent]
            else:
                # Default to preventive if no diagnosis, otherwise symptom_control
                if not primary_dx:
                    logger.warning(f"⚠️ Invalid intent '{raw_intent}', defaulting to preventive")
                    state["treatment_intent"] = TreatmentIntent.PREVENTIVE
                else:
                    logger.warning(f"⚠️ Invalid intent '{raw_intent}', defaulting to symptom_control")
                    state["treatment_intent"] = TreatmentIntent.SYMPTOM_CONTROL
            
            state["treatment_goals"] = result.get("treatment_goals", [])
            
            logger.info(f"✅ Treatment Intent: {state['treatment_intent']}")
            
        except Exception as e:
            logger.error(f"❌ Intent determination failed: {str(e)}")
            # FIX: Set default intent based on whether diagnosis exists
            if not primary_dx:
                state["treatment_intent"] = TreatmentIntent.PREVENTIVE
            else:
                state["treatment_intent"] = TreatmentIntent.SYMPTOM_CONTROL
            state["warnings"].append("Treatment intent determination incomplete")
        
        return state
    
    def _parse_json(self, content: str) -> dict:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return {}
        except:
            return {}


# =====================================================================
# LAYER 1b (NEW): SPECIALTY SKILL SELECTION AGENT
# =====================================================================
#
# Per the Specialty-Aware Treatment Planning Architecture (v2):
#
#   Patient Summary -> Timeline -> Primary Diagnosis -> Doctor Specialty
#       -> Specialty Skill Selection -> Guideline Retrieval -> Treatment
#          Planning Agents -> Specialty-Specific Treatment Plan
#
# This agent is deterministic (no LLM call) -- it simply resolves
# treatment_input.doctor_speciality to one of the predefined specialty
# skill prompts and stores it in state so every downstream content-generating
# agent (Pharmacological / Procedural / Investigation / Lifestyle) can inject
# it into their prompts and stay strictly within that specialty's scope.

class SpecialtySkillAgent:
    """Resolves doctor_speciality -> specialty skill prompt, stored in state."""

    async def select_skill(self, state: TreatmentPlanState) -> TreatmentPlanState:
        treatment_input = state["treatment_input"]
        doctor_speciality = treatment_input.doctor_speciality

        resolved_specialty = resolve_specialty_label(doctor_speciality)
        selected_skill = SPECIALTY_SKILLS.get(resolved_specialty, MEDICAL_ONCOLOGY_SKILL)

        state["resolved_specialty"] = resolved_specialty
        state["specialty_skill"] = selected_skill

        logger.info(
            f"🩺 Specialty Skill Selection: raw='{doctor_speciality}' -> resolved='{resolved_specialty}'"
        )

        return state


# =====================================================================
# LAYER 2: GUIDELINE RETRIEVAL AGENT
# =====================================================================

class GuidelineRetrievalAgent:
    """Retrieves evidence-based treatment guidelines, filtered by doctor's selected guidelines"""
    
    def __init__(self, knowledge_graph: TreatmentKnowledgeGraph):
        self.kg = knowledge_graph
    
    async def retrieve_guidelines(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Query knowledge graph for treatment guidelines, filtered by doctor's selected guidelines"""

        logger.info("📚 Guideline Retrieval Agent: Starting")

        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        resolved_specialty = state.get("resolved_specialty") or resolve_specialty_label(treatment_input.doctor_speciality)

        # ── FULL, SCHEMA-AGNOSTIC PATIENT CONTEXT ──
        patient_summary = state.get("patient_summary") or {}
        logger.info(f"📋 Patient summary retrieved: {patient_summary}")
        summary_data = patient_summary.get("summary", {}) if isinstance(patient_summary, dict) else {}
        clinical_summary_text = "\n\n".join(summary_data.get("paragraphs", []))

        timeline_data = patient_summary.get("timeline", {}) if isinstance(patient_summary, dict) else {}
        timeline_entries = timeline_data.get("timeline", [])

        agentic_context = {
            "clinical_summary": clinical_summary_text,
            "timeline": timeline_entries
        }

        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        logger.info(f"📚 GuidelineRetrievalAgent | agentic_context: {patient_summary_json}")

        # ── Extract prior_treatments for Neo4j query — scan the full record instead of a
        #    single predefined "treatment_timeline" key, since summary pipelines vary in
        #    where they nest this. ──
        prior_treatments: List[str] = []
        full_record = patient_summary or {}

        def _collect_prior_treatments(obj: Any) -> List[str]:
            found = []
            if isinstance(obj, dict):
                for k, v in obj.items():
                    key_lower = str(k).lower()
                    if "treatment" in key_lower or "regimen" in key_lower or "therapy" in key_lower:
                        if isinstance(v, list):
                            for item in v:
                                if isinstance(item, dict):
                                    t = item.get("treatment") or item.get("name") or item.get("regimen")
                                    if t:
                                        found.append(t)
                                elif isinstance(item, str) and item:
                                    found.append(item)
                        elif isinstance(v, str) and v:
                            found.append(v)
                    found.extend(_collect_prior_treatments(v))
            elif isinstance(obj, list):
                for item in obj:
                    found.extend(_collect_prior_treatments(item))
            return found

        prior_treatments = list(dict.fromkeys(_collect_prior_treatments(full_record)))

        if prior_treatments:
            logger.info(f"📚 Prior treatments found: {prior_treatments} — will fetch next-line guidelines")

        # ── Fetch doctor's selected guidelines from doctor_guidelines_collection by doctorId ──
        # doctor sys_user_id is stored in patient_preferences during build_treatment_input
        doctor_lookup_id = treatment_input.patient_preferences or treatment_input.doctor_speciality
        logger.info(f"📚 Looking up doctor guidelines for doctorId: {doctor_lookup_id}")
        doctor_guidelines_list = []
        allowed_guideline_titles = set()

        try:
            doctor_guideline_doc = await doctor_guidelines_collection.find_one(
                {"doctorId": doctor_lookup_id}
            )

            if doctor_guideline_doc:
                doctor_guidelines_list = doctor_guideline_doc.get("guidelines", [])
                allowed_guideline_titles = {
                    g.get("title", "").strip().upper()
                    for g in doctor_guidelines_list
                    if g.get("title")
                }
                logger.info(f"✅ Doctor guidelines fetched from DB:")
                logger.info(f"   doctorId      : {doctor_guideline_doc.get('doctorId')}")
                logger.info(f"   specialization: {doctor_guideline_doc.get('specialization')}")
                logger.info(f"   total count   : {len(doctor_guidelines_list)}")
                logger.info(f"   ┌─────────────────────────────────────────")
                for g in doctor_guidelines_list:
                    logger.info(f"   │ [{g.get('id')}] {g.get('title')}")
                    logger.info(f"   │     reference  : {g.get('reference', 'N/A')}")
                    logger.info(f"   │     explanation: {g.get('explanation', 'N/A')}")
                logger.info(f"   └─────────────────────────────────────────")
                logger.info(f"   allowed_titles: {sorted(list(allowed_guideline_titles))}")
            else:
                logger.warning(
                    f"⚠️ No doctor guidelines found for doctorId={doctor_lookup_id} — "
                    f"all guideline recommendations will be blocked to enforce strict compliance"
                )
        except Exception as gde:
            logger.error(f"❌ Failed to fetch doctor guidelines: {str(gde)}")

        # Store doctor guidelines in state for downstream agents
        state["doctor_guidelines"] = doctor_guidelines_list
        state["allowed_guideline_titles"] = list(allowed_guideline_titles)
        logger.info(f"📚 Allowed guideline titles stored in state: {list(allowed_guideline_titles)}")

        # ── Handle case when no primary diagnosis is provided ──
        if not primary_dx:
            logger.info("ℹ️ No primary diagnosis provided - skipping guideline retrieval")
            state["applicable_guidelines"] = []
            state["guideline_recommendations"] = {
                "class_I": [],
                "class_IIa": [],
                "class_IIb": [],
                "first_line": [],
                "all": []
            }
            return state

        # ── Query knowledge graph (scoped to the resolved treating specialty) ──
        try:
            guidelines = self.kg.get_treatment_guidelines(
                disease=primary_dx.disease,
                stage=primary_dx.stage,
                specialty=resolved_specialty,
                prior_treatments=prior_treatments
            )

            # ── Filter guidelines to only those the doctor has selected ──
            if allowed_guideline_titles:
                filtered_guidelines = []
                for g in guidelines:
                    g_source = str(g.get("guideline", "") or g.get("source", "")).strip().upper()
                    matched = any(
                        allowed in g_source or g_source in allowed
                        for allowed in allowed_guideline_titles
                    )
                    if matched:
                        filtered_guidelines.append(g)
                    else:
                        logger.info(f"   ⏭️ Skipping guideline '{g_source}' — not in doctor's selected list")
                guidelines = filtered_guidelines
                logger.info(f"📚 After doctor filter: {len(guidelines)} guidelines remain")
            else:
                logger.info("📚 No guideline filter applied — using all retrieved guidelines")

            state["applicable_guidelines"] = guidelines

            # Organize by recommendation class
            guideline_recs = {
                "class_I": [g for g in guidelines if g.get("recommendation_class") == "I"],
                "class_IIa": [g for g in guidelines if g.get("recommendation_class") == "IIa"],
                "class_IIb": [g for g in guidelines if g.get("recommendation_class") == "IIb"],
                "first_line": [g for g in guidelines if g.get("is_first_line")],
                "all": guidelines
            }

            state["guideline_recommendations"] = guideline_recs

            logger.info(f"✅ Retrieved {len(guidelines)} guideline recommendations")
            logger.info(f"   Class I (Must do): {len(guideline_recs['class_I'])}")
            logger.info(f"   First-line: {len(guideline_recs['first_line'])}")

        except Exception as e:
            logger.error(f"❌ Guideline retrieval failed: {str(e)}")
            state["applicable_guidelines"] = []
            state["guideline_recommendations"] = {
                "class_I": [],
                "class_IIa": [],
                "class_IIb": [],
                "first_line": [],
                "all": []
            }
            state["warnings"].append("Guideline retrieval failed")

        return state

# =====================================================================
# LAYER 3: EXCLUSION FILTER AGENT (CRITICAL)
# =====================================================================

class ExclusionFilterAgent:
    """Filters out already completed procedures and investigations"""
    
    async def filter_completed(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Build exclusion sets from completed items"""

        logger.info("🚫 Exclusion Filter Agent: Starting")

        treatment_input = state["treatment_input"]

        # Build exclusion sets
        excluded_procedures = set()
        excluded_investigations = set()

        # Add completed procedures from treatment_input (already built from summary)
        for proc in treatment_input.completed_procedures:
            excluded_procedures.add(proc.procedure_name.lower())
            logger.info(f"   ❌ Excluding procedure: {proc.procedure_name} (done on {proc.date_performed})")

        # Add completed investigations from treatment_input
        for inv in treatment_input.completed_investigations:
            excluded_investigations.add(inv.test_name.lower())
            logger.info(f"   ❌ Excluding investigation: {inv.test_name} (done on {inv.date_performed})")

        # Cross-check directly with patient_summary for anything missed.
        # This walks the ENTIRE summary document (no fixed key allow-list) looking for
        # any nested dict that looks like a procedure/investigation record, so it keeps
        # working regardless of exactly which keys a given summary pipeline used.
        patient_summary = state.get("patient_summary") or {}

        PROCEDURE_HINT_KEYS = {"procedure", "procedure_name", "surgery", "treatment"}
        INVESTIGATION_HINT_KEYS = {"test_name", "test", "modality", "investigation"}

        def _walk_for_records(obj):
            """Recursively yield every dict found anywhere in the structure."""
            if isinstance(obj, dict):
                yield obj
                for v in obj.values():
                    yield from _walk_for_records(v)
            elif isinstance(obj, list):
                for item in obj:
                    yield from _walk_for_records(item)

        for record in _walk_for_records(patient_summary):
            for hint in PROCEDURE_HINT_KEYS:
                val = record.get(hint)
                if isinstance(val, str) and val.strip():
                    excluded_procedures.add(val.strip().lower())
            for hint in INVESTIGATION_HINT_KEYS:
                val = record.get(hint)
                if isinstance(val, str) and val.strip():
                    excluded_investigations.add(val.strip().lower())

        state["excluded_procedures"] = excluded_procedures
        state["excluded_investigations"] = excluded_investigations

        logger.info(f"✅ Exclusion Filter: {len(excluded_procedures)} procedures, {len(excluded_investigations)} investigations excluded")

        return state


# =====================================================================
# LAYER 4: PHARMACOLOGICAL RECOMMENDATION AGENT (SPECIALTY-SCOPED)
# =====================================================================

class PharmacologicalAgent:
    """Generates drug recommendations with safety checks, strictly scoped to the
    treating specialist's specialty skill (Medical / Radiation / Surgical Oncology)."""
    
    def __init__(self, llm: ChatGroq, knowledge_graph: TreatmentKnowledgeGraph):
        self.llm = llm
        self.kg = knowledge_graph

    def _get_stage_context(self, stage: Optional[str], disease: str) -> str:
        """
        Dynamically generates stage-appropriate clinical constraints
        using the LLM's medical knowledge — works for ANY disease/specialty.
        """
        if not stage:
            return (
                f"Stage not specified for {disease}. "
                "Recommend conservatively. Only suggest treatments with broad indication "
                "across all stages of this disease. Do not assume advanced or metastatic disease."
            )

        prompt = f"""You are a senior clinical pharmacologist and oncologist with expertise across all medical specialties.

    DISEASE: {disease}
    STAGE: {stage}

    Your task is to write a SHORT clinical constraint paragraph (3-5 sentences max) that will be injected into a treatment planning prompt.

    This paragraph must:
    1. Describe what "{stage}" means clinically for "{disease}" 
    2. State which drug classes or treatment modalities ARE appropriate for this stage
    3. State which drug classes or treatment modalities are NOT appropriate (e.g., drugs approved only for metastatic/advanced/refractory settings when this is early-stage)
    4. Be specific to the actual disease — use correct clinical terminology for that specialty

    Return ONLY the plain text paragraph. No JSON. No bullet points. No preamble."""

        try:
            response = self.llm.invoke( [
                SystemMessage(content="You are a clinical expert. Return only a plain text clinical constraint paragraph."),
                HumanMessage(content=prompt)
            ])
            
            stage_context = response.content.strip()
            
            # Safety fallback if response is empty or too short
            if not stage_context or len(stage_context) < 30:
                raise ValueError("Response too short")
                
            logger.info(f"✅ Stage context generated for {disease} {stage}")
            return stage_context
            
        except Exception as e:
            logger.warning(f"⚠️ Stage context generation failed: {str(e)}, using safe fallback")
            return (
                f"Stage: {stage} for {disease}. "
                "Apply the most current disease-specific clinical guidelines strictly. "
                "Only recommend treatments with evidence-based indication for this exact stage. "
                "Do not recommend drugs approved only for more advanced stages of this disease."
            )

    def _apply_specialty_drug_filter(
        self,
        candidate_drugs: List[DrugRecommendation],
        resolved_specialty: str
    ) -> List[DrugRecommendation]:
        """
        Safety-net keyword filter: even though the prompt strictly instructs the LLM to stay
        within the specialty skill's scope, this defensively drops any drug whose drug_class
        matches an excluded category for the resolved specialty — UNLESS it is explicitly
        flagged as a concurrent radiosensitizer (Radiation Oncology's one narrow exception)
        or a peri-operative supportive drug (Surgical Oncology's allowed exception).
        """
        excluded_keywords = SPECIALTY_EXCLUDED_DRUG_KEYWORDS.get(resolved_specialty, [])
        if not excluded_keywords:
            return candidate_drugs

        perioperative_allowlist = [
            "antibiotic", "prophylaxis", "analgesic", "antiemetic",
            "anticoagulant", "lmwh", "heparin", "pain"
        ]

        filtered = []
        for drug in candidate_drugs:
            drug_class_lower = (drug.drug_class or "").lower()
            indication_lower = (drug.indication or "").lower()
            reason_lower = (drug.patient_specific_reason or "").lower()

            matches_excluded = any(kw in drug_class_lower for kw in excluded_keywords)

            if not matches_excluded:
                filtered.append(drug)
                continue

            # Radiation Oncology narrow exception: explicitly-flagged concurrent radiosensitizer
            if resolved_specialty == "Radiation Oncology" and (
                "concurrent" in reason_lower or "radiosensitiz" in reason_lower or "radiosensitiz" in indication_lower
            ):
                logger.info(f"   ✓ Keeping {drug.drug_name} — flagged as concurrent radiosensitizer (Radiation Oncology exception)")
                filtered.append(drug)
                continue

            # Surgical Oncology narrow exception: peri-operative supportive medications
            if resolved_specialty == "Surgical Oncology" and any(term in drug_class_lower for term in perioperative_allowlist):
                logger.info(f"   ✓ Keeping {drug.drug_name} — peri-operative supportive medication (Surgical Oncology exception)")
                filtered.append(drug)
                continue

            logger.warning(
                f"   ⛔ Specialty filter: dropping '{drug.drug_name}' (class='{drug.drug_class}') — "
                f"out of scope for {resolved_specialty}"
            )

        return filtered

    async def recommend_drugs(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate pharmacological recommendations, strictly scoped to the treating specialty"""
        
        logger.info("💊 Pharmacological Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        logger.info(f"📋 Patient summary retrieved: {patient_summary}")

        # ── FULL, SCHEMA-AGNOSTIC PATIENT CONTEXT ──
        summary_data = patient_summary.get("summary", {}) if isinstance(patient_summary, dict) else {}
        clinical_summary_text = "\n\n".join(summary_data.get("paragraphs", []))

        timeline_data = patient_summary.get("timeline", {}) if isinstance(patient_summary, dict) else {}
        timeline_entries = timeline_data.get("timeline", [])

        agentic_context = {
            "clinical_summary": clinical_summary_text,
            "timeline": timeline_entries
        }

        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        logger.info(f"💊 PharmacologicalAgent | agentic_context: {patient_summary_json}")
        primary_dx = treatment_input.primary_diagnosis
        guideline_recs = state.get("guideline_recommendations", {})

        # ── Specialty Skill Layer ──
        resolved_specialty = state.get("resolved_specialty") or resolve_specialty_label(treatment_input.doctor_speciality)
        specialty_skill = state.get("specialty_skill") or get_specialty_skill(treatment_input.doctor_speciality)
        specialty_scope_block = f"""
⚠️⚠️⚠️ SPECIALTY SCOPE — MANDATORY, READ FIRST ⚠️⚠️⚠️
{specialty_skill}

You MUST strictly follow the specialty scope above. Any drug recommendation belonging exclusively to
another specialty's scope must be OMITTED ENTIRELY from your output, even if it would otherwise be
clinically reasonable for the patient's diagnosis. Only include drugs that fall within the treating
specialty's ("{resolved_specialty}") stated responsibilities.
"""
        
        if not primary_dx:
            logger.info("ℹ️ No structured primary diagnosis - checking clinical summary/timeline for active disease before recommending")
            
            prompt = f"""
You are a clinical pharmacologist designing a medication plan for this patient.

{specialty_scope_block}

⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis object was attached to this request. Before recommending anything, you MUST read
the patient clinical context below (full patient record: clinical summary, timeline, tumor/imaging
characteristics, labs, biomarkers, prior treatments, current condition — everything the summary pipeline
has on this patient) and check whether it documents an active disease (cancer, cardiac disease, infection,
organ dysfunction, or any diagnosed pathology).

- If an active disease IS documented (e.g. a cancer diagnosis, even mentioned only in narrative form in the
  timeline or summary): you MUST design a disease-specific pharmacological plan for that condition, STRICTLY
  WITHIN THE SPECIALTY SCOPE ABOVE — the same rigor you would apply if a structured diagnosis had been
  provided. This means guideline-based primary therapy appropriate to the treating specialty (e.g. systemic
  therapy only if Medical Oncology; peri-operative medications only if Surgical Oncology; concurrent
  radiosensitizer only if Radiation Oncology and clinically indicated), NOT vitamins, generic supplements, or
  "preventive" medications. A serious active disease is never treated with a wellness/supplement plan.
- ONLY if the clinical summary and timeline show NO active disease process (a genuinely healthy patient with
  at most risk factors) should you recommend preventive/prophylactic medications or supplements — and even
  then, stay within the specialty scope above.
- Recommending vitamins or general supplements for a patient whose record documents an active malignancy or
  other serious disease is a critical failure. Check the clinical context below carefully before deciding.

PATIENT CLINICAL CONTEXT (this is your primary source of truth — read it in full before deciding; it
contains the full patient record, not just narrative text — check every section for tumor size, stage,
biomarkers, and lab trends):
{patient_summary_json}

TASK:
1. First, state internally whether an active disease is present in the clinical context above.
2. If yes: recommend the appropriate disease-specific medications for that actual condition, STRICTLY WITHIN
   THE SPECIALTY SCOPE ABOVE, considering:
   - The specific diagnosis/stage/findings as documented in the summary and timeline
   - Prior treatments and current therapy stage (e.g. pre-op, post-op, on active treatment)
   - Comorbidities and current medications
   - Age, sex, renal/hepatic function, lab trends, and lifestyle factors if mentioned
   Only recommend drugs supported by approved guidelines for that condition AND within specialty scope.
3. If no active disease is found: recommend preventive/adjunctive medications or supplements as before,
   still within specialty scope.
- Derive every recommendation directly from the patient summary and timeline.
- If treatment (e.g., chemotherapy) is documented as not yet started, mark recommendations as **conditional**
  pending therapy initiation and organ function assessment.
- Do NOT make assumptions beyond what is in the summary and timeline.

OUTPUT FORMAT (JSON array):
[
  {{
    "drug_name": "Exact drug name",
    "drug_class": "Pharmacological class",
    "indication": "Specific indication derived directly from the patient summary",
    "dose": "Patient-specific dose if applicable; otherwise 'conditional pending therapy/labs'",
    "frequency": "Frequency of administration",
    "route": "PO/IV/IM/SC",
    "duration": "Specific duration or 'conditional'",
    "guideline_support": "Exact guideline title + year + recommendation",
    "recommendation_class": "I|IIa|IIb",
    "evidence_level": "A|B|C",
    "guideline_rationale": "Exact guideline + year + recommendation",
    "patient_specific_reason": "Reference at least 2 factors from the patient summary",
    "supporting_trial": "RCT/trial name or null",
    "renal_dose_adjustment": "Adjustment needed if explicitly mentioned, else null",
    "hepatic_dose_adjustment": "Adjustment needed if explicitly mentioned, else null",
    "monitoring_required": ["Parameters to monitor — only if indicated in summary"],
    "monitoring_frequency": "Frequency",
    "generic_available": true|false,
    "alternative_if_unavailable": "Alternative drug"
  }}
]

CRITICAL RULES:
1. All recommendations MUST be **derived from the patient summary and timeline**.
2. If therapy has not started, **flag recommendations as conditional**.
3. guideline_rationale MUST cite **exact approved guideline**.
4. patient_specific_reason must reference **at least 2 explicit patient factors**.
5. If an active disease is documented anywhere in the summary/timeline, disease-specific treatment MUST
   take priority over any preventive/supplement recommendation for that same organ system — but ONLY within
   the specialty scope defined above.
6. Do NOT generate any drug belonging exclusively to another specialty's scope, per the SPECIALTY SCOPE block.
7. Return **ONLY JSON array** — no explanations or filler text.
"""

        else:
            # Safe stage label — works whether stage is None or provided
            stage_label = primary_dx.stage if primary_dx and primary_dx.stage else "stated"
            disease_label = primary_dx.disease if primary_dx else "the stated condition"

            first_line_treatments = guideline_recs.get("first_line", [])
            first_line_drugs = [
                t for t in first_line_treatments
                if t.get("modality") == "pharmacological"
            ]

            stage_context = self._get_stage_context(primary_dx.stage, primary_dx.disease)

            strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)

            strategy_instruction = {
                TreatmentStrategy.CONSERVATIVE: (
                    "CONSERVATIVE STRATEGY: Prefer monotherapy. Start lowest effective dose. "
                    "Prioritize safety over efficacy. Avoid combinations unless absolutely necessary. "
                    "Prefer oral over IV. Prefer generic over branded."
                ),
                TreatmentStrategy.STANDARD: (
                    "STANDARD STRATEGY: Follow first-line guideline recommendations. "
                    "Use standard doses. Combine drugs only per guideline protocols."
                ),
                TreatmentStrategy.AGGRESSIVE: (
                    "AGGRESSIVE STRATEGY: Use combination therapy from the start. "
                    "Prioritize maximum efficacy. Use higher end of dose ranges. "
                    "Include adjunctive drugs proactively. "
                    "Consider newer/targeted agents if available."
                ),
            }[strategy]

            intent = state.get("treatment_intent")
            intent_str = intent.value if intent else "not specified"

            excluded_investigations = state.get("excluded_investigations", set())

            prompt = f"""You are a clinical pharmacologist designing a medication regimen.

{specialty_scope_block}

DIAGNOSIS: {primary_dx.disease} | STAGE: {primary_dx.stage or 'Not specified'} | INTENT: {intent_str}

⚠️ STAGE CONSTRAINT (MUST FOLLOW):
{stage_context}

⚠️ TREATMENT STRATEGY (MUST FOLLOW):
{strategy_instruction}

PATIENT FACTORS:
Age: {treatment_input.patient_age} | eGFR: {treatment_input.renal_function_egfr or 'Unknown'} | Hepatic: {treatment_input.hepatic_function}
Allergies: {', '.join(a.allergen for a in treatment_input.allergies) or 'None'}
Current Medications: {', '.join(f"{m.drug_name} {m.dose}" for m in treatment_input.current_medications) or 'None'}

ALREADY COMPLETED INVESTIGATIONS (do NOT list these under monitoring_required):
{chr(10).join(f"- {i}" for i in excluded_investigations) or 'None'}

PATIENT CLINICAL CONTEXT (full patient record — clinical summary, timeline, tumor/imaging characteristics,
labs, biomarkers, prior treatments, current condition — use ALL of it, not just narrative text, for
biomarker status, prior treatments, tumor size/stage, and active diagnoses):
{patient_summary_json}

⚠️ BIOMARKER RULES — read from the patient summary above and apply strictly (only relevant if the drug
category is within your specialty scope above):
- If HER2/IHC score is 1+ or negative → DO NOT recommend Trastuzumab, Pertuzumab, or any HER2-targeted therapy
- If HER2 score is 3+ or FISH amplified → HER2-targeted therapy IS indicated
- If ER/PR positive → endocrine therapy (Letrozole/Anastrozole for postmenopausal, Tamoxifen for premenopausal) IS indicated
- If ER/PR negative → DO NOT recommend Tamoxifen, Letrozole, or Anastrozole
- If patient is postmenopausal (age ≥55 or documented) → prefer Aromatase Inhibitor over Tamoxifen
- DO NOT combine Tamoxifen + Aromatase Inhibitor — use only one
- Apply equivalent biomarker logic for any other disease (MSI, EGFR, ALK, BCR-ABL, etc.) found in the summary

⚠️ APPROVED GUIDELINES — YOU MUST ONLY USE THESE (fetched from doctor's profile in DB):
{chr(10).join(f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}" for g in state.get('doctor_guidelines', [])) or '  No specific guidelines configured — use your best clinical judgment'}

DO NOT cite any guideline not listed above. If a recommendation has no support from the approved guidelines above, omit it entirely.

GUIDELINE FIRST-LINE OPTIONS FROM KNOWLEDGE GRAPH (pre-filtered to approved guidelines only):
{chr(10).join(f"- {d.get('treatment')} (Class {d.get('recommendation_class')}, Evidence {d.get('evidence_level')})" for d in first_line_drugs) or 'No knowledge graph matches — base recommendations strictly on approved guidelines above'}

REQUIREMENTS:
1. Only recommend drugs indicated for {stage_label} {disease_label}
2. Every drug MUST be supported by one of the approved guidelines listed above
3. Strictly respect all biomarker rules above — check the summary before recommending any targeted therapy
4. Do not repeat drugs from prior failed treatments listed in the summary
5. Match drug count to the strategy
6. Adjust doses for renal/hepatic function
7. Avoid allergens
8. Strictly respect the SPECIALTY SCOPE block above — omit any drug outside that scope entirely

OUTPUT (JSON array):
[
  {{
    "drug_name": "Exact drug name",
    "drug_class": "pharmacological class",
    "indication": "specific indication for {stage_label} {disease_label}",
    "dose": "specific dose",
    "frequency": "frequency",
    "route": "PO/IV/IM/SC",
    "duration": "duration or ongoing",
    "guideline_support": "MUST match one of the approved guideline titles above exactly",
    "recommendation_class": "I|IIa|IIb",
    "evidence_level": "A|B|C",
    "guideline_rationale": "Approved guideline name + year + class + one sentence. Must be from the approved list above only.",
    "patient_specific_reason": "Why this drug for THIS patient — reference at least 2 of: age, stage, biomarker status, renal function, prior treatments. If this is a concurrent radiosensitizer (Radiation Oncology) or peri-operative drug (Surgical Oncology), state that explicitly here.",
    "supporting_trial": "Key trial or null",
    "renal_dose_adjustment": "adjustment or null",
    "monitoring_required": ["parameter"],
    "monitoring_frequency": "frequency",
    "generic_available": true,
    "alternative_if_unavailable": "alternative"
  }}
]

Return ONLY JSON array."""

        try:
            response = self.llm.invoke( [
                SystemMessage(content=f"Generate stage-appropriate, specialty-scoped ({resolved_specialty}) drug recommendations. Return only JSON array."),
                HumanMessage(content=prompt)
            ])
            
            drugs_json = self._parse_json_array(response.content)
            candidate_drugs = []
            
            for drug_data in drugs_json:
                drug_name = drug_data.get("drug_name")
                
                current_med_names = [m.drug_name for m in treatment_input.current_medications]
                interactions = self.kg.get_drug_interactions(drug_name, current_med_names)
                
                contraindications = self.kg.get_contraindications(
                    drug_name=drug_name,
                    comorbidities=treatment_input.comorbidities,
                    patient_age=treatment_input.patient_age or 0,
                    renal_function=treatment_input.renal_function_egfr
                )
                
                if any("ABSOLUTE" in c for c in contraindications):
                    logger.warning(f"⚠️ Skipping {drug_name} - absolute contraindication")
                    continue
                
                guideline_key_map = {
                    "NCCN": GuidelineSource.NCCN,
                    "WHO": GuidelineSource.WHO,
                    "AHA": GuidelineSource.AHA,
                    "AHA/ACC": GuidelineSource.AHA,
                    "ACC": GuidelineSource.AHA,
                    "NICE": GuidelineSource.NICE,
                    "IDSA": GuidelineSource.IDSA,
                    "ASCO": GuidelineSource.ASCO,
                    "ESMO": GuidelineSource.ESMO,
                    "NCG INDIA": GuidelineSource.NCG_INDIA,
                }
                raw_guideline = (drug_data.get("guideline_support") or "").strip().upper()

                # Try exact match first, then partial match
                guideline_enum = guideline_key_map.get(raw_guideline)
                if guideline_enum is None:
                    for key, val in guideline_key_map.items():
                        if key in raw_guideline:
                            guideline_enum = val
                            break

                # If still not found, infer from guideline_rationale text
                if guideline_enum is None:
                    rationale_upper = (drug_data.get("guideline_rationale") or "").upper()
                    for key, val in guideline_key_map.items():
                        if key in rationale_upper:
                            guideline_enum = val
                            logger.info(f"ℹ️ guideline_support '{raw_guideline}' unknown — inferred {val} from rationale text")
                            break

                if guideline_enum is None:
                    logger.warning(f"⚠️ Could not resolve guideline_support '{raw_guideline}', defaulting to WHO")
                    guideline_enum = GuidelineSource.WHO
                
                rec_class = drug_data.get("recommendation_class", "IIa")
                try:
                    rec_class_enum = RecommendationClass(rec_class)
                except ValueError:
                    logger.warning(f"⚠️ Invalid RecommendationClass '{rec_class}', defaulting to IIa")
                    rec_class_enum = RecommendationClass.CLASS_IIA
                
                evidence = drug_data.get("evidence_level", "B")
                try:
                    evidence_enum = EvidenceLevel(evidence)
                except ValueError:
                    logger.warning(f"⚠️ Invalid EvidenceLevel '{evidence}', defaulting to B")
                    evidence_enum = EvidenceLevel.B
                
                drug_rec = DrugRecommendation(
                    drug_name=drug_name,
                    drug_class=drug_data.get("drug_class", ""),
                    indication=drug_data.get("indication", ""),
                    dose=drug_data.get("dose", ""),
                    frequency=drug_data.get("frequency", ""),
                    route=drug_data.get("route", "PO"),
                    duration=drug_data.get("duration", ""),
                    guideline_support=guideline_enum,
                    recommendation_class=rec_class_enum,
                    evidence_level=evidence_enum,
                    guideline_rationale=drug_data.get("guideline_rationale", ""),
                    patient_specific_reason=drug_data.get("patient_specific_reason", ""),
                    supporting_trial=drug_data.get("supporting_trial"),
                    renal_dose_adjustment=drug_data.get("renal_dose_adjustment"),
                    monitoring_required=drug_data.get("monitoring_required", []),
                    monitoring_frequency=drug_data.get("monitoring_frequency"),
                    drug_interactions=[i["drug"] for i in interactions],
                    generic_available=drug_data.get("generic_available", True),
                    alternative_if_unavailable=drug_data.get("alternative_if_unavailable")
                )
                candidate_drugs.append(drug_rec)
            
            # Post-process: fill any empty rationale fields as fallback
            for drug in candidate_drugs:
                if not drug.guideline_rationale or drug.guideline_rationale.strip() == "":
                    drug.guideline_rationale = (
                        f"{drug.guideline_support} guidelines — {drug.drug_name} is recommended "
                        f"for {drug.indication} "
                        f"(Class {drug.recommendation_class}, Evidence Level {drug.evidence_level})"
                    )
                if not drug.patient_specific_reason or drug.patient_specific_reason.strip() == "":
                    disease = primary_dx.disease if primary_dx else "the stated condition"
                    stage = primary_dx.stage if primary_dx and primary_dx.stage else "stated stage"
                    drug.patient_specific_reason = (
                        f"Recommended for this patient with {disease} ({stage}) based on "
                        f"{drug.guideline_support} {drug.recommendation_class} recommendation "
                        f"with Evidence Level {drug.evidence_level}"
                    )

            # ── Specialty safety-net filter ──
            pre_filter_count = len(candidate_drugs)
            candidate_drugs = self._apply_specialty_drug_filter(candidate_drugs, resolved_specialty)
            if len(candidate_drugs) < pre_filter_count:
                state["warnings"].append(
                    f"{pre_filter_count - len(candidate_drugs)} drug(s) removed by specialty scope filter ({resolved_specialty})"
                )

            state["candidate_drugs"] = candidate_drugs
            logger.info(f"✅ Pharmacological: {len(candidate_drugs)} drugs recommended (specialty={resolved_specialty})")
            
        except Exception as e:
            logger.error(f"❌ Drug recommendation failed: {str(e)}")
            state["warnings"].append("Drug recommendation incomplete")
        
        return state

    def _parse_json_array(self, content: str) -> List[dict]:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return []
        except:
            return []


# =====================================================================
# LAYER 5: PROCEDURAL RECOMMENDATION AGENT (SPECIALTY-SCOPED)
# =====================================================================

# =====================================================================
# LAYER 5: PROCEDURAL RECOMMENDATION AGENT (SPECIALTY-SCOPED, FULLY LLM-DRIVEN)
# =====================================================================
#
# WHAT CHANGED vs the previous version, and why:
#
# 1. NO MORE "SKIP IF NO PRIMARY DIAGNOSIS" SHORTCUT
#    The old code returned candidate_procedures = [] immediately whenever
#    treatment_input.primary_diagnosis was None, without ever looking at the
#    patient_summary/timeline. That's inconsistent with every other agent in
#    this file (Pharmacological, Investigation, Lifestyle, FollowUp), all of
#    which fall back to reading the full patient record and letting the LLM
#    decide whether an active disease is documented. This agent now does the
#    same: if no structured diagnosis is attached, the LLM is handed the full
#    patient_summary + timeline and is explicitly instructed to look for an
#    active/documented condition before deciding whether any procedure is
#    warranted. A genuinely healthy patient with no diagnosis still correctly
#    gets an empty procedure list — but that's now a model decision grounded
#    in the record, not a code-level shortcut that never looks at the data.
#
# 2. NO MORE HARDCODED EF RISK BANDING
#    The old code pre-computed ef_risk via a fixed if/elif ladder
#    (>=55 normal, >=40 mildly reduced, >=30 reduced, <30 severe) and then
#    separately hardcoded "if ef < 30 and timing == 'elective': timing = 'defer'"
#    after the LLM call. Both are now removed. The raw EF value (and the fact
#    that it may be unknown) is handed to the model, and the model is asked to
#    apply standard cardiac-risk stratification itself and to set
#    cardiac_risk_note / timing accordingly, with its reasoning surfaced in
#    patient_specific_reason. Nothing about EF thresholds is pre-decided in code.
#
# 3. NO MORE HARDCODED STRATEGY-INSTRUCTION DICT
#    The old code had a fixed CONSERVATIVE/STANDARD/AGGRESSIVE string dict
#    dictating exactly how each strategy should behave for procedures. That's
#    now replaced by simply telling the model which strategy label applies and
#    asking it to apply the clinical judgment appropriate to that label itself
#    (a licensed specialist already knows what "conservative" vs "aggressive"
#    means for procedural decision-making) rather than encoding that judgment
#    as a fixed string in code.
#
# 4. SPECIALTY SCOPE ENFORCEMENT — UNCHANGED (already model self-report based)
#    Scope compliance is still decided by the model itself via the
#    "specialty_scope_compliant" self-report field on each item, and enforced
#    in _apply_specialty_scope_selfreport_filter(). No keyword lists.
#
# 5. GUIDELINE / RECOMMENDATION-CLASS / EVIDENCE-LEVEL ENUM RESOLUTION
#    This part is retained. It isn't a clinical hardcoding — it's a schema
#    constraint: ProceduralRecommendation.guideline_support is a fixed
#    GuidelineSource enum, so *something* has to map the model's free-text
#    guideline name onto one of those enum members. To keep this as
#    non-hardcoded as possible, resolution now first tries an exact/substring
#    match against the model's own guideline_support string, and — mirroring
#    PharmacologicalAgent — falls back to inferring the source from the
#    guideline_rationale text before defaulting. No clinical judgment is
#    encoded here, only string-to-enum plumbing.
#
# 6. OUTPUT SCHEMA UNCHANGED
#    ProceduralRecommendation is populated with the exact same fields as
#    before. specialty_scope_compliant / specialty_scope_reason are consumed
#    only for filtering/logging and are never attached to the Pydantic object.

class ProceduralAgent:
    """Generates procedure recommendations only when clinically needed, strictly scoped
    to the treating specialist's specialty skill. Every clinical judgment call — whether
    an active disease is present when no structured diagnosis was supplied, cardiac risk
    from EF, and how to apply the selected treatment strategy — is made by the LLM from
    the full patient record, not by hardcoded rules in code."""

    def __init__(self, llm: ChatGroq):
        self.llm = llm

    def _apply_specialty_scope_selfreport_filter(
        self,
        raw_items: List[dict],
        resolved_specialty: str
    ) -> List[dict]:
        """
        Enforce specialty scope using the model's OWN per-item self-report
        (`specialty_scope_compliant`) instead of a hardcoded keyword dictionary.

        - If the field is explicitly False -> drop it (logged).
        - If the field is missing/unclear -> keep it, but log a warning so it's
          visible in ops/monitoring that the model didn't self-certify scope.
        """
        kept = []
        for item in raw_items:
            proc_name = item.get("procedure_name", "unknown procedure")
            compliant = item.get("specialty_scope_compliant", None)

            if compliant is False:
                logger.warning(
                    f"   ⛔ Specialty scope: model excluded '{proc_name}' — "
                    f"reason: {item.get('specialty_scope_reason', 'not specified')} "
                    f"(specialty={resolved_specialty})"
                )
                continue

            if compliant is None:
                logger.info(
                    f"   ℹ️ Specialty scope: '{proc_name}' did not include "
                    f"specialty_scope_compliant — keeping, but flag for review "
                    f"(specialty={resolved_specialty})"
                )

            kept.append(item)
        return kept

    async def recommend_procedures(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate procedural recommendations only if patient needs them, within specialty
        scope. Whether a diagnosis is structured or must be inferred from the patient record,
        and every risk/strategy judgment, is delegated to the LLM — no hardcoded shortcuts."""

        logger.info("🔪 Procedural Agent: Starting")

        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        logger.info(f"📋 Patient summary retrieved: {patient_summary}")

        # ── FULL, SCHEMA-AGNOSTIC PATIENT CONTEXT (no field allow-list) ──
        try:
            full_patient_record = copy.deepcopy(patient_summary) if isinstance(patient_summary, dict) else {}
        except Exception:
            full_patient_record = patient_summary if isinstance(patient_summary, dict) else {}
        if isinstance(full_patient_record, dict):
            full_patient_record.pop("_id", None)

        patient_summary_json = to_json({"full_patient_record": full_patient_record})

        primary_dx = treatment_input.primary_diagnosis
        guideline_recs = state.get("guideline_recommendations", {})
        excluded = state.get("excluded_procedures", set())

        # ── Specialty Skill Layer ──
        resolved_specialty = state.get("resolved_specialty") or resolve_specialty_label(treatment_input.doctor_speciality)
        specialty_skill = state.get("specialty_skill") or get_specialty_skill(treatment_input.doctor_speciality)
        specialty_scope_block = f"""
⚠️⚠️⚠️ SPECIALTY SCOPE — MANDATORY, READ FIRST ⚠️⚠️⚠️
{specialty_skill}

You MUST strictly follow the specialty scope above. Only recommend procedures that fall within the
treating specialty's ("{resolved_specialty}") stated responsibilities. If the diagnosis would normally
warrant a procedure outside this specialty's scope (e.g. a surgical resection for a patient under a
Medical Oncologist, or a chemo port placement for a Radiation Oncologist), do NOT generate it here —
that belongs to a different specialist's plan. For every procedure you output, you must self-certify
scope compliance using the "specialty_scope_compliant" field described in the output schema below —
this is the ONLY mechanism used to enforce specialty scope, so be honest and precise about it.
"""

        # ── Guideline-derived procedural options (may legitimately be empty) ──
        procedural_treatments = [
            t for t in guideline_recs.get("all", [])
            if t.get("modality") in ["surgical", "procedural"]
            and t.get("treatment", "").lower() not in excluded
        ]

        kg_block = (
            chr(10).join(f"- {p.get('treatment')} (Class {p.get('recommendation_class')})" for p in procedural_treatments)
            if procedural_treatments
            else "No structured matches were found in the knowledge graph for this diagnosis/stage. "
                 "This does NOT mean no procedure is needed — base your decision on the full patient "
                 "record and the approved guidelines below instead."
        )

        # ── Patient safety profile — raw data only, no pre-computed risk bands ──
        ef = treatment_input.cardiac_function_ef
        age = treatment_input.patient_age
        comorbidities = treatment_input.comorbidities or []

        strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)
        strategy_value = strategy.value if hasattr(strategy, "value") else str(strategy)

        intent = state.get("treatment_intent")
        intent_str = intent.value if intent else "not specified"

        doctor_guidelines = state.get('doctor_guidelines', [])
        approved_guidelines_block = (
            chr(10).join(
                f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                for g in doctor_guidelines
            ) or "  No specific guidelines configured — use your best clinical judgment"
        )

        drugs_block = (
            chr(10).join(f"  - {d.drug_name} ({d.indication})" for d in state.get('candidate_drugs', []))
            or "  None"
        )

        excluded_block = chr(10).join(f"- {p}" for p in excluded) if excluded else "None"

        # ── Diagnosis-presence-dependent priority instruction ──
        if not primary_dx:
            diagnosis_block = f"""
⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis object was attached to this request. This does NOT mean the patient is
healthy — it only means the caller didn't pass one. Before deciding anything about procedures, you
MUST read the FULL PATIENT RECORD below (clinical summary, timeline, tumor/imaging characteristics,
labs, biomarkers, prior treatments, current condition — everything the summary pipeline has captured)
and determine whether it documents an active disease process (cancer, cardiac disease, organ
dysfunction, active infection, or any other diagnosed pathology).

- If an active disease IS documented anywhere in the record: treat it as the real primary condition
  and reason about procedural need exactly as rigorously as you would if a structured diagnosis object
  had been supplied — including staging/findings-based indication, not a vague guess.
- If NO active disease is documented (a genuinely healthy patient with at most risk factors): return an
  empty procedure list. Do not invent a procedure for a healthy patient.
- Silently returning an empty list without actually reading the record below is a critical error.

Primary Diagnosis (structured): Not provided — infer from the full patient record below.
"""
        else:
            diagnosis_block = f"""
Primary Diagnosis: {primary_dx.disease}
Stage            : {primary_dx.stage or 'Not specified'}
Severity         : {primary_dx.severity}
"""

        prompt = f"""You are a senior specialist deciding IF and WHICH procedures this patient actually needs,
strictly within your specialty scope. Base every decision on the full patient record below — do not
rely on assumptions about a diagnosis label alone, and do not apply any fixed numeric risk thresholds
you were not given explicitly here; use your own clinical judgment as a specialist would.

{specialty_scope_block}

⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from doctor's profile in DB):
{approved_guidelines_block}
DO NOT reference any guideline not listed above. If a procedure cannot be justified by an approved guideline, omit it.

═══════════════════════════════════
PATIENT PROFILE
═══════════════════════════════════
Age              : {age}
{diagnosis_block}
Treatment Intent : {intent_str}

CARDIAC STATUS (raw data — assess risk yourself; no pre-computed banding has been applied)
Ejection Fraction : {ef if ef is not None else 'Unknown'}%

COMORBIDITIES (raw list — assess clinical significance yourself, nothing has been pre-filtered):
{', '.join(comorbidities) if comorbidities else 'None documented'}

═══════════════════════════════════
FULL PATIENT RECORD (this is your primary source of truth — check every section: tumor/imaging
findings, staging, biomarkers, labs, prior surgeries/treatments, current condition, timeline —
for evidence of what this patient actually needs)
═══════════════════════════════════
{patient_summary_json}

DRUGS ALREADY RECOMMENDED IN THIS PLAN:
{drugs_block}

⚠️ TREATMENT STRATEGY SELECTED: {strategy_value.upper()}
Apply the clinical rigor and threshold for recommending procedures that a specialist would normally
associate with a "{strategy_value}" strategy (e.g. how readily to recommend a procedure versus waiting
on medical management, and how far to extend to prophylactic or borderline-indicated procedures).
Use your own clinical judgment to interpret what this strategy label implies — nothing about it is
pre-defined for you.

═══════════════════════════════════
GUIDELINE-RECOMMENDED PROCEDURES (knowledge-graph lookup — may be incomplete)
═══════════════════════════════════
{kg_block}

ALREADY COMPLETED (DO NOT RECOMMEND):
{excluded_block}

═══════════════════════════════════
YOUR TASK
═══════════════════════════════════
1. Read the full patient record above and determine, from the actual documented findings (not just
   a diagnosis label), whether a procedure is genuinely indicated for this patient.
2. For each candidate procedure, decide if this SPECIFIC patient needs it, AND whether it falls within
   your specialty scope, based on:
   - Their diagnosis, stage, and documented findings (imaging, biopsy, labs, prior treatments)
   - Their cardiac ejection fraction and overall surgical/procedural risk — reason about this yourself
     from the raw EF value and comorbidities; do not assume any numeric cutoff not stated by you
   - Their comorbidities and age
   - Treatment intent (curative vs palliative)
   - The selected treatment strategy above
   - The SPECIALTY SCOPE block above
3. Set cardiac_risk_note and timing yourself based on your own assessment of the patient's cardiac and
   overall status — including deferring an elective procedure if you judge the patient too high-risk,
   and explain that judgment in patient_specific_reason.
4. SKIP any procedure already in the completed list.
5. SKIP any procedure outside your specialty scope — set specialty_scope_compliant to false and explain
   why, rather than omitting the field.
6. If the patient does NOT need any procedure, return an empty JSON array — do not invent one.

OUTPUT — Return ONLY a JSON array ([] if no procedure is recommended).

[
  {{
    "procedure_name": "Exact procedure name",
    "patient_needs_this": true,
    "reason_needed": "Why this patient needs this procedure",

    "indication": "Clinical indication",
    "timing": "immediate|urgent|elective|defer",

    "guideline_support": "Approved guideline name",
    "recommendation_class": "I|IIa|IIb",
    "evidence_level": "A|B|C",

    "guideline_rationale": "Brief guideline recommendation",
    "patient_specific_reason": "Why this procedure is appropriate for this patient",
    "supporting_trial": "Trial name or null",

    "procedure_steps": [
      "Step 1",
      "Step 2",
      "Step 3",
      "Step 4",
      "Step 5"
    ],

    "prerequisites": [
      "Requirement 1",
      "Requirement 2"
    ],

    "contraindications": [
      "Contraindication 1"
    ],

    "expected_complications": [
      "Complication 1",
      "Complication 2"
    ],

    "post_procedure_care": [
      "Care 1",
      "Care 2"
    ],

    "cardiac_risk_note": "Safe | Moderate risk | High risk"
  }}
]
CRITICAL RULES:
- Only include procedures where patient_needs_this is true.
- Never recommend a completed procedure.
- Every procedure MUST include specialty_scope_compliant — this is the only scope check applied downstream, so be accurate.
- guideline_rationale MUST name the specific guideline, year, and class — never vague.
- patient_specific_reason MUST reference at least one patient-specific factor from the full patient record.
- procedure_steps MUST be specific and actionable (dose/technique/approach/monitoring detail), never a one-line generic placeholder like "perform the procedure".
- Set timing to "defer" yourself if your own risk assessment warrants it — do not wait for external logic to override you.
- Return ONLY valid JSON array, no explanation text."""

        try:
            response = self.llm.invoke([
                SystemMessage(content=f"You are a specialty-scoped ({resolved_specialty}) surgical decision-making assistant. Return only a JSON array."),
                HumanMessage(content=prompt)
            ])
            logger.info(f"procedures_json:{response}")

            procedures_json = self._parse_json_array(response.content)

            # ── Enforce specialty scope via the model's own self-report, not keywords ──
            pre_scope_count = len(procedures_json)
            procedures_json = self._apply_specialty_scope_selfreport_filter(procedures_json, resolved_specialty)
            if len(procedures_json) < pre_scope_count:
                state["warnings"].append(
                    f"{pre_scope_count - len(procedures_json)} procedure(s) excluded by specialty scope "
                    f"self-report ({resolved_specialty})"
                )

            candidate_procedures = []

            for proc_data in procedures_json:
                proc_name = proc_data.get("procedure_name", "")

                # Safety net against re-recommending completed work
                if proc_name.lower() in excluded:
                    logger.warning(f"⚠️ Skipping {proc_name} — already completed")
                    continue

                # Only include if the model confirmed patient needs it
                if not proc_data.get("patient_needs_this", False):
                    logger.info(f"ℹ️ {proc_name} — not needed for this patient, skipping")
                    continue

                # ── GuidelineSource resolution: exact/substring match, then infer from
                #    rationale text (mirrors PharmacologicalAgent), only default as last resort ──
                guideline_key_map = {
                    "NCCN": GuidelineSource.NCCN,
                    "WHO": GuidelineSource.WHO,
                    "AHA": GuidelineSource.AHA,
                    "AHA/ACC": GuidelineSource.AHA,
                    "ACC": GuidelineSource.AHA,
                    "NICE": GuidelineSource.NICE,
                    "IDSA": GuidelineSource.IDSA,
                    "ASCO": GuidelineSource.ASCO,
                    "ESMO": GuidelineSource.ESMO,
                    "NCG INDIA": GuidelineSource.NCG_INDIA,
                }
                raw_guideline = (proc_data.get("guideline_support") or "").strip().upper()

                guideline_enum = guideline_key_map.get(raw_guideline)
                if guideline_enum is None:
                    for key, val in guideline_key_map.items():
                        if key in raw_guideline:
                            guideline_enum = val
                            break

                if guideline_enum is None:
                    rationale_upper = (proc_data.get("guideline_rationale") or "").upper()
                    for key, val in guideline_key_map.items():
                        if key in rationale_upper:
                            guideline_enum = val
                            logger.info(f"ℹ️ guideline_support '{raw_guideline}' unknown — inferred {val} from rationale text")
                            break

                if guideline_enum is None:
                    logger.warning(f"⚠️ Could not resolve guideline_support '{raw_guideline}', defaulting to WHO")
                    guideline_enum = GuidelineSource.WHO

                # ── RecommendationClass / EvidenceLevel — schema-required enum parsing ──
                rec_class = proc_data.get("recommendation_class", "IIa")
                try:
                    rec_class_enum = RecommendationClass(rec_class)
                except ValueError:
                    logger.warning(f"⚠️ Invalid RecommendationClass '{rec_class}', defaulting to IIa")
                    rec_class_enum = RecommendationClass.CLASS_IIA

                evidence = proc_data.get("evidence_level", "B")
                try:
                    evidence_enum = EvidenceLevel(evidence)
                except ValueError:
                    logger.warning(f"⚠️ Invalid EvidenceLevel '{evidence}', defaulting to B")
                    evidence_enum = EvidenceLevel.B

                # Timing is taken as the model set it — no code-level override.
                timing = proc_data.get("timing", "elective")

                proc_rec = ProceduralRecommendation(
                    procedure_name=proc_name,
                    patient_needs_this=proc_data.get("patient_needs_this", True),
                    reason_needed=proc_data.get("reason_needed", ""),

                    indication=proc_data.get("indication", ""),
                    timing=timing,

                    guideline_support=guideline_enum,
                    recommendation_class=rec_class_enum,
                    evidence_level=evidence_enum,

                    guideline_rationale=proc_data.get("guideline_rationale", ""),
                    patient_specific_reason=proc_data.get("patient_specific_reason", ""),
                    supporting_trial=None if proc_data.get("supporting_trial") in (None, "", "null") else proc_data.get("supporting_trial"),

                    procedure_steps=proc_data.get("procedure_steps", []),

                    estimated_duration=proc_data.get("estimated_duration"),
                    anesthesia_type=proc_data.get("anesthesia_type"),

                    prerequisites=proc_data.get("prerequisites", []),
                    contraindications=proc_data.get("contraindications", []),
                    expected_complications=proc_data.get("expected_complications", []),
                    post_procedure_care=proc_data.get("post_procedure_care", []),

                    cardiac_risk_note=proc_data.get("cardiac_risk_note", "safe"),

                    estimated_blood_loss=proc_data.get("estimated_blood_loss"),
                    hospital_stay=proc_data.get("hospital_stay"),
                    recovery_time=proc_data.get("recovery_time"),
                    follow_up_schedule=proc_data.get("follow_up_schedule"),

                    expected_benefit=proc_data.get("expected_benefit"),
                    expected_outcome=proc_data.get("expected_outcome"),
                    success_rate=proc_data.get("success_rate"),

                    alternative_procedure=proc_data.get("alternative_procedure"),
                    comments=proc_data.get("comments"),

                    specialty_scope_compliant=proc_data.get("specialty_scope_compliant", True),
                    specialty_scope_reason=proc_data.get("specialty_scope_reason"),
                )
                candidate_procedures.append(proc_rec)

            # Post-process: fill any empty rationale fields as fallback (unchanged behavior)
            for proc in candidate_procedures:
                if not proc.guideline_rationale or proc.guideline_rationale.strip() == "":
                    proc.guideline_rationale = (
                        f"{proc.guideline_support} guidelines — {proc.procedure_name} is recommended "
                        f"for {proc.indication} "
                        f"(Class {proc.recommendation_class}, Evidence Level {proc.evidence_level})"
                    )
                if not proc.patient_specific_reason or proc.patient_specific_reason.strip() == "":
                    disease = primary_dx.disease if primary_dx else "the patient's documented condition"
                    proc.patient_specific_reason = (
                        f"Indicated for this patient with {disease} based on "
                        f"{proc.guideline_support} {proc.recommendation_class} recommendation; "
                        f"timing: {proc.timing}"
                    )

            state["candidate_procedures"] = candidate_procedures
            logger.info(
                f"✅ Procedural: {len(candidate_procedures)} procedures recommended for this patient "
                f"(specialty={resolved_specialty}, fully LLM-driven — no hardcoded skip/EF-band/strategy-dict)"
            )

        except Exception as e:
            logger.error(f"❌ Procedure recommendation failed: {str(e)}")
            state["warnings"].append("Procedure recommendation incomplete")
            state["candidate_procedures"] = state.get("candidate_procedures", [])

        return state

    def _parse_json_array(self, content: str) -> List[dict]:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return []
        except Exception:
            return []



# =====================================================================
# LAYER 6: INVESTIGATION RECOMMENDATION AGENT (SPECIALTY-SCOPED)
# =====================================================================

class InvestigationAgent:
    """Recommends diagnostic tests intelligently, scoped to what the treating
    specialist actually needs to order/monitor."""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def recommend_investigations(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate investigation recommendations, within specialty scope"""
        
        logger.info("🔬 Investigation Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        logger.info(f"📋 Patient summary retrieved: {patient_summary}")

        # ── FULL, SCHEMA-AGNOSTIC PATIENT CONTEXT ──
        summary_data = patient_summary.get("summary", {}) if isinstance(patient_summary, dict) else {}
        clinical_summary_text = "\n\n".join(summary_data.get("paragraphs", []))

        timeline_data = patient_summary.get("timeline", {}) if isinstance(patient_summary, dict) else {}
        timeline_entries = timeline_data.get("timeline", [])

        agentic_context = {
            "clinical_summary": clinical_summary_text,
            "timeline": timeline_entries
        }

        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        primary_dx = treatment_input.primary_diagnosis
        excluded = state.get("excluded_investigations", set())

        # ── Specialty Skill Layer ──
        resolved_specialty = state.get("resolved_specialty") or resolve_specialty_label(treatment_input.doctor_speciality)
        specialty_skill = state.get("specialty_skill") or get_specialty_skill(treatment_input.doctor_speciality)
        specialty_scope_block = f"""
⚠️⚠️⚠️ SPECIALTY SCOPE — MANDATORY, READ FIRST ⚠️⚠️⚠️
{specialty_skill}

Investigations must serve the treating specialty's decision-making, e.g.:
- Medical Oncology: baseline labs before systemic therapy, response-to-chemo/immunotherapy imaging,
  biomarker/genomic testing, toxicity monitoring labs.
- Radiation Oncology: simulation imaging, target-volume delineation imaging, radiation-toxicity
  monitoring, response assessment post-radiation.
- Surgical Oncology: pre-operative fitness workup, staging imaging needed to plan the operation,
  post-operative pathology review, surveillance imaging tied to the surgical follow-up schedule.
Do NOT order investigations that only serve a different specialty's treatment decision (e.g. do not
order pre-chemo cardiac baseline labs if you are the Surgical Oncologist and no chemo is in this plan).
"""
        
        # Get completed investigations with dates
        completed_map = {
            inv.test_name.lower(): inv
            for inv in treatment_input.completed_investigations
        }
        
        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            logger.info("ℹ️ No structured primary diagnosis - checking clinical summary/timeline for active disease before ordering tests")
            
            doctor_guidelines_inv = state.get('doctor_guidelines', [])
            approved_inv_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_inv
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""
You are designing a diagnostic testing strategy for this patient.

{specialty_scope_block}

⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis was attached to this request. Before recommending any tests, check the clinical
context below (full patient record — clinical summary, timeline, tumor/imaging characteristics, labs,
prior treatments) for evidence of an active disease (cancer, cardiac disease, infection, etc.).
- If an active disease IS documented: recommend the disease-specific staging/monitoring investigations that
  condition requires within your specialty scope (e.g. staging CT/PET, tumor markers, biopsy follow-up for
  a cancer diagnosis) — NOT generic age/sex screening only.
- ONLY if no active disease is documented should this become a general preventive screening plan.

⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from this doctor's profile in DB):
{approved_inv_block}
- Do NOT reference any guideline not listed above.
- Only recommend investigations supported by the approved guidelines above.

PATIENT FACTORS (derived from patient summary):
- Age: {treatment_input.patient_age} years
- Sex: {treatment_input.patient_sex}
- Comorbidities: {', '.join(treatment_input.comorbidities)}
- Current Medications: {', '.join([m.drug_name for m in treatment_input.current_medications])}
- Completed Investigations: {chr(10).join(f"- {inv.test_name}: {inv.result or 'Result pending'} (done {inv.date_performed})" for inv in treatment_input.completed_investigations)}
- Full patient record (clinical summary + timeline + tumor/imaging + labs + prior treatments — use ALL
  of this to infer risk factors, symptoms, prior diagnoses, lab trends, and lifestyle details): {patient_summary_json}

PROPOSED TREATMENTS/SUPPLEMENTS:
{', '.join(d.drug_name for d in state.get('candidate_drugs', []))}

TASK:
- Recommend **health screening and monitoring tests** tailored to this specific patient, within your specialty scope.
- Base recommendations on **the patient summary**, including inferred risks, comorbidities, medication effects, and prior investigations.
- Consider:
  1. Age- and sex-appropriate preventive screening (e.g., colonoscopy, mammogram)
  2. Monitoring for medications or supplements (safety labs, side-effect surveillance)
  3. Monitoring for comorbidities (disease-specific labs or imaging)
  4. Baseline health assessment for undiagnosed risks

OUTPUT (JSON array):
[
  {{
    "test_name": "Exact test name",
    "parameters": "Parameter1, Parameter2, Parameter3, Parameter4",
    "indication": "Why this test is needed — must reference patient-specific factors from the summary (age, sex, comorbidities, medications, lifestyle, lab trends)",
    "urgency": "stat|urgent|routine",
    "expected_finding": "What the result will tell us clinically for this patient",
    "will_change_management": true|false,
    "what_decision_it_drives": "Specific clinical decision this result informs (e.g., medication adjustment, initiation of therapy, further diagnostics)",
    "guideline_rationale": "MANDATORY — exact approved guideline title + year + what it recommends for this test",
    "patient_specific_reason": "Explain exactly why this test is relevant to THIS patient — reference factors in the patient summary",
    "already_completed": false,
    "repeat_justified": false,
    "repeat_justification": null
  }}
]

GENDER RULES (STRICT):
- Never recommend mammogram for male patients
- Never recommend cervical smear/Pap smear for male patients
- Never recommend PSA test for female patients
- Never recommend ovarian cancer screening for male patients
- Patient sex is: {treatment_input.patient_sex} — apply rules accordingly

CRITICAL RULES:
1. All recommendations MUST be **derived from patient-specific summary details**.
2. guideline_rationale MUST cite the **exact guideline and year**.
3. what_decision_it_drives MUST explain a **real clinical decision**.
4. If a test was done recently, set already_completed=true.
5. Focus exclusively on **preventive health, monitoring, and risk-based interventions**, within your specialty scope.
6. Return **ONLY JSON array** — do NOT add explanations or commentary.

- parameters MUST contain the individual measurements or observations produced by the investigation as a comma-separated string.

Examples:
  • Complete Blood Count (CBC): Hemoglobin, Hematocrit, RBC, WBC, Platelet Count, MCV, MCH, MCHC, RDW
  • Liver Function Tests (LFT): ALT, AST, ALP, GGT, Total Bilirubin, Direct Bilirubin, Albumin, Total Protein
  • Mammography: Breast tissue imaging, Mass, Calcifications, Breast density, Architectural distortion, Asymmetry
  • Ultrasound of the Axilla: Axillary lymph nodes, Lymph node size, Cortical thickness, Hilum, Vascularity
"""
        else:
            strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)

            strategy_instruction = {
                TreatmentStrategy.CONSERVATIVE: (
                    "CONSERVATIVE: Only truly essential investigations. "
                    "Avoid redundant or low-yield tests. Minimum workup to guide treatment safely."
                ),
                TreatmentStrategy.STANDARD: (
                    "STANDARD: Full guideline-recommended workup for this diagnosis and stage."
                ),
                TreatmentStrategy.AGGRESSIVE: (
                    "AGGRESSIVE: Comprehensive workup. Include staging, predictive biomarkers, "
                    "pharmacogenomics if relevant, and baseline tests for all planned drugs."
                ),
            }[strategy]

            intent = state.get("treatment_intent")
            intent_str = intent.value if intent else "not specified"

            doctor_guidelines_inv = state.get('doctor_guidelines', [])
            approved_inv_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_inv
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""You are designing a diagnostic testing strategy.

        {specialty_scope_block}

        ⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from doctor's profile in DB):
        {approved_inv_block}
        DO NOT reference any guideline not in the list above. Only recommend investigations that can be justified by an approved guideline.

        PRIMARY DIAGNOSIS: {primary_dx.disease}
        STAGE: {primary_dx.stage or 'Not specified'}
        TREATMENT INTENT: {intent_str}

        ⚠️ INVESTIGATION STRATEGY (MUST FOLLOW):
        {strategy_instruction}

        PROPOSED TREATMENTS (from THIS specialty's plan only):
        Drugs: {', '.join(d.drug_name for d in state.get('candidate_drugs', []))}
        Procedures: {', '.join(p.procedure_name for p in state.get('candidate_procedures', []))}

        PATIENT CLINICAL CONTEXT (full patient record — clinical summary, timeline, tumor/imaging
        characteristics, labs, biomarkers, prior treatments — use for lab trends, imaging context, and
        prior investigations):
        {patient_summary_json}

        ALREADY COMPLETED INVESTIGATIONS (with dates):
        {chr(10).join(f"- {inv.test_name}: {inv.result or 'Result pending'} (done {inv.date_performed})" for inv in treatment_input.completed_investigations)}

        TASK: Recommend ONLY investigations that:
        1. Have NOT been done recently (unless repeat is medically justified)
        2. Will change management
        3. Are needed for monitoring the planned drugs/procedures from THIS specialty's plan
        4. Are required before planned procedures from THIS specialty's plan
        5. Are warranted by concerning lab trends or imaging findings above
        6. Fall within the SPECIALTY SCOPE block above

        OUTPUT (JSON array):
        [
        {{
            "test_name": "specific test name",
            "parameters": "Parameter1, Parameter2, Parameter3, Parameter4","
            "indication": "why needed — reference patient history/trends/planned treatments if applicable",
            "urgency": "stat|urgent|routine",
            "expected_finding": "what the result will tell us clinically",
            "will_change_management": true|false,
            "what_decision_it_drives": "Exactly what clinical decision this result will change — e.g. 'Will determine if patient is eligible for bladder-sparing protocol vs radical cystectomy' or 'Will guide cisplatin dose reduction if eGFR < 60'",
            "guideline_rationale": "MUST reference one of the approved guidelines listed above — name it exactly + year + what it says about this test. Never cite a guideline not in the approved list.",
            "patient_specific_reason": "Why this specific test is needed for THIS patient — reference their diagnosis, stage, planned drugs/procedures, lab trends, or prior imaging",
            "already_completed": false,
            "repeat_justified": false,
            "repeat_justification": null
        }}
        ]

        CRITICAL RULES:
        - If lab trend is worsening → prioritize related monitoring tests
        - If prior imaging showed abnormality → check if follow-up imaging is now due
        - If test was done <30 days ago: set already_completed=true, repeat_justified=false (unless medically necessary)
        - If repeat IS needed: explain WHY in repeat_justification
        - guideline_rationale MUST name the specific guideline and year — never write 'guidelines recommend'
        - what_decision_it_drives MUST explain a real clinical decision, not just 'will monitor health'
        - Match investigation depth to strategy above
        - Do not order investigations that only serve another specialty's treatment decision
        - parameters MUST contain the individual measurements or observations produced by the investigation as a comma-separated string.

Examples:
  • Complete Blood Count (CBC): Hemoglobin, Hematocrit, RBC, WBC, Platelet Count, MCV, MCH, MCHC, RDW
  • Liver Function Tests (LFT): ALT, AST, ALP, GGT, Total Bilirubin, Direct Bilirubin, Albumin, Total Protein
  • Mammography: Breast tissue imaging, Mass, Calcifications, Breast density, Architectural distortion, Asymmetry
  • Ultrasound of the Axilla: Axillary lymph nodes, Lymph node size, Cortical thickness, Hilum, Vascularity
        Return ONLY JSON array."""
        
        try:
            response = self.llm.invoke( [
                SystemMessage(content=f"Recommend specialty-scoped ({resolved_specialty}) investigations. Return only JSON array."),
                HumanMessage(content=prompt)
            ])
            
            investigations_json = self._parse_json_array(response.content)
            
            candidate_investigations = []
            
            for inv_data in investigations_json:
                test_name = inv_data.get("test_name", "")
                test_lower = test_name.lower()
                
                # Check if already completed
                already_done = test_lower in excluded
                completed_inv = completed_map.get(test_lower)
                
                if already_done and not inv_data.get("repeat_justified"):
                    logger.info(f"   ✓ Skipping {test_name} - already done on {completed_inv.date_performed if completed_inv else 'unknown date'}")
                    continue
                
                inv_rec = InvestigationRecommendation(
                    test_name=test_name,
                    parameters=[
                        p.strip()
                        for p in inv_data.get("parameters", "").split(",")
                        if p.strip()
                    ],
                    indication=inv_data.get("indication", ""),
                    urgency=inv_data.get("urgency", "routine"),
                    expected_finding=inv_data.get("expected_finding", ""),
                    will_change_management=inv_data.get("will_change_management", True),
                    what_decision_it_drives=inv_data.get("what_decision_it_drives", ""),
                    guideline_rationale=inv_data.get("guideline_rationale", ""),
                    patient_specific_reason=inv_data.get("patient_specific_reason", ""),
                    already_completed=already_done,
                    last_result_date=completed_inv.date_performed if completed_inv else None,
                    repeat_justified=inv_data.get("repeat_justified", False),
                    repeat_justification=inv_data.get("repeat_justification")
                )
                
                candidate_investigations.append(inv_rec)
            
            # Post-process: fill any empty rationale fields as fallback
            for inv in candidate_investigations:
                if not inv.guideline_rationale or inv.guideline_rationale.strip() == "":
                    inv.guideline_rationale = (
                        f"Standard clinical guidelines recommend {inv.test_name} "
                        f"for {inv.indication}"
                    )
                if not inv.patient_specific_reason or inv.patient_specific_reason.strip() == "":
                    inv.patient_specific_reason = (
                        f"Ordered for this patient because: {inv.indication}. "
                        f"Result will drive decision: {inv.what_decision_it_drives or inv.expected_finding}"
                    )
                if not inv.what_decision_it_drives or inv.what_decision_it_drives.strip() == "":
                    inv.what_decision_it_drives = (
                        f"Will guide clinical management based on {inv.expected_finding}"
                    )

            state["candidate_investigations"] = candidate_investigations
            logger.info(f"✅ Investigation: {len(candidate_investigations)} tests recommended (specialty={resolved_specialty})")
            
        except Exception as e:
            logger.error(f"❌ Investigation recommendation failed: {str(e)}")
            state["warnings"].append("Investigation recommendation incomplete")
        
        return state
    
    def _parse_json_array(self, content: str) -> List[dict]:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return []
        except:
            return []


# =====================================================================
# LAYER 7: LIFESTYLE RECOMMENDATION AGENT (SPECIALTY-SCOPED)
# =====================================================================

class LifestyleAgent:
    """Non-pharmacological interventions, scoped to the active treatment plan and specialty."""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def recommend_lifestyle(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate lifestyle recommendations, within specialty scope"""
        
        logger.info("🏃 Lifestyle Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        logger.info(f"📋 Patient summary retrieved: {patient_summary}")

        # ── FULL, SCHEMA-AGNOSTIC PATIENT CONTEXT ──
        summary_data = patient_summary.get("summary", {}) if isinstance(patient_summary, dict) else {}
        clinical_summary_text = "\n\n".join(summary_data.get("paragraphs", []))

        timeline_data = patient_summary.get("timeline", {}) if isinstance(patient_summary, dict) else {}
        timeline_entries = timeline_data.get("timeline", [])

        agentic_context = {
            "clinical_summary": clinical_summary_text,
            "timeline": timeline_entries
        }

        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        primary_dx = treatment_input.primary_diagnosis

        # ── Specialty Skill Layer ──
        resolved_specialty = state.get("resolved_specialty") or resolve_specialty_label(treatment_input.doctor_speciality)
        specialty_skill = state.get("specialty_skill") or get_specialty_skill(treatment_input.doctor_speciality)
        specialty_scope_block = f"""
⚠️⚠️⚠️ SPECIALTY SCOPE — MANDATORY, READ FIRST ⚠️⚠️⚠️
{specialty_skill}

Tailor lifestyle advice to what THIS specialist's plan actually involves, e.g.:
- Medical Oncology: fatigue/nausea management around chemo cycles, neutropenic precautions, nutrition
  during systemic therapy.
- Radiation Oncology: skin care at the radiation site, positioning/immobilization comfort, fatigue
  management during a radiation course.
- Surgical Oncology: pre-operative optimization (smoking cessation before surgery, prehabilitation,
  nutrition/anemia correction), post-operative mobilization and wound care.
Do not give lifestyle advice tied to a treatment modality that is not part of THIS specialty's plan.
"""
        
        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            doctor_guidelines_ls = state.get('doctor_guidelines', [])
            approved_ls_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_ls
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""
You are designing lifestyle interventions for this patient.

{specialty_scope_block}

⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis was attached to this request. Before writing generic wellness advice, check the
clinical context below (full patient record) for an active disease. If one is documented, tailor every
recommendation to that condition and its treatment WITHIN YOUR SPECIALTY SCOPE (e.g. neutropenic precautions
and fatigue management around chemotherapy if Medical Oncology, pre-operative activity restriction if
Surgical Oncology and surgery is planned) rather than generic wellness advice. Only fall back to general
wellness/lifestyle guidance if no active disease is documented.

⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from this doctor's profile in DB):
{approved_ls_block}
- Do NOT reference any guideline not listed above.
- Only include lifestyle recommendations supported by an approved guideline.

PATIENT FACTORS (derived from patient summary):
- Age: {treatment_input.patient_age} years
- Sex: {treatment_input.patient_sex}
- Comorbidities: {', '.join(treatment_input.comorbidities)}
- Current Medications: {', '.join([m.drug_name for m in treatment_input.current_medications])}
- Full patient record (clinical summary + timeline + tumor/imaging + labs + prior treatments — use ALL of
  this to infer lifestyle risks, prior interventions, lab trends, symptoms, and functional status): {patient_summary_json}

TASK:
- Recommend **evidence-based, patient-specific lifestyle modifications** for general health and wellness, within specialty scope.
- Focus on actionable and measurable interventions **tailored to this patient**.
- Categories to address:
  - Diet (specific dietary changes based on age, comorbidities, medications, and lab trends)
  - Exercise (type, intensity, duration, frequency, contraindications based on patient factors)
  - Smoking cessation (if smoking risk is noted in summary)
  - Alcohol moderation (personalized based on risk factors)
  - Sleep hygiene (age-appropriate and comorbidity-adjusted)
  - Stress management (techniques suitable for patient lifestyle and mental health risk)

OUTPUT (JSON array):
[
  {{
    "intervention_type": "diet|exercise|smoking_cessation|alcohol|sleep|stress",
    "specific_recommendation": "SPECIFIC actionable recommendation with exact frequency, duration, intensity, and modification based on patient summary",
    "evidence_strength": "A|B|C",
    "expected_benefit": "Specific measurable benefit for this patient based on their comorbidities or lab trends",
    "implementation_difficulty": "easy|moderate|difficult",
    "guideline_rationale": "MANDATORY — exact approved guideline title + year + what it recommends for this intervention",
    "patient_specific_reason": "Explain why this intervention is relevant for THIS patient, referencing their age, comorbidities, medications, lab trends, or lifestyle factors from the summary",
    "supporting_evidence": "Key study supporting this recommendation, or null if none"
  }}
]

CRITICAL RULES:
1. All recommendations MUST be **directly derived from patient-specific summary details**.
2. guideline_rationale MUST cite **exact guideline and year** from the approved list.
3. patient_specific_reason MUST reference **at least two patient-specific factors** (e.g., age + comorbidity, medication + lifestyle risk).
4. Be actionable, measurable, and realistic — include exact frequency, duration, and intensity where applicable.
5. Focus exclusively on **preventive health, wellness, and risk reduction**, within specialty scope.
6. Return **ONLY JSON array** — do NOT add explanations or commentary.
"""
        else:
            strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)
            candidate_procedures = state.get("candidate_procedures", [])
            candidate_drugs = state.get("candidate_drugs", [])

            doctor_guidelines_ls = state.get('doctor_guidelines', [])
            approved_ls_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_ls
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""You are designing lifestyle interventions.

        {specialty_scope_block}

        ⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from doctor's profile in DB):
        {approved_ls_block}
        DO NOT reference any guideline not listed above. Only include lifestyle recommendations supported by an approved guideline.

        PRIMARY DIAGNOSIS: {primary_dx.disease}
        PATIENT AGE: {treatment_input.patient_age}
        COMORBIDITIES: {', '.join(treatment_input.comorbidities)}

        PATIENT CLINICAL CONTEXT (full patient record — clinical summary, timeline, tumor/imaging
        characteristics, labs, biomarkers — use for active diagnoses, medications, and urgency context):
        {patient_summary_json}

        DRUGS IN THIS TREATMENT PLAN (tailor lifestyle advice around these):
        {chr(10).join(f"- {d.drug_name} ({d.drug_class})" for d in candidate_drugs) or 'None'}

        PLANNED PROCEDURES IN THIS TREATMENT PLAN:
        {chr(10).join(f"- {p.procedure_name}" for p in candidate_procedures) or 'None'}

        LIFESTYLE CONSTRAINT RULES (MUST FOLLOW):
        1. If surgery is planned → NO high-intensity exercise pre-operatively; recommend gentle mobilization only
        2. If any anticoagulant is in the DRUGS list above (Warfarin, Apixaban, Rivaroxaban, Heparin, Enoxaparin) → warn against contact sports and fall/bleeding risk activities
        3. If any corticosteroid is in the DRUGS list (Prednisolone, Dexamethasone) → advise high-calcium low-sodium diet; weight-bearing exercise to prevent bone loss
        4. If any chemotherapy drug is in the DRUGS list → advise fatigue management, neutropenic diet precautions, avoid crowded places
        5. If patient has cardiac condition → specify safe exercise intensity (e.g., <60% max heart rate; avoid isometric exercises)
        6. If patient has renal impairment → advise on fluid intake and protein restriction if applicable
        7. If patient has active infection/sepsis → defer exercise recommendations until resolved
        8. Tailor diet specifically to active conditions (e.g., low-sodium for heart failure, low-purine for gout)
        9. Only give advice tied to drugs/procedures actually present in THIS specialty's plan above — do not invent advice for treatments outside your specialty scope

        TASK: Recommend evidence-based lifestyle modifications that are SAFE given the above constraints and within specialty scope.

        CATEGORIES:
        - Diet (specific dietary changes tailored to active conditions — not generic "eat healthy")
        - Exercise (type, intensity, frequency — with explicit contraindications based on planned procedures and conditions)
        - Smoking cessation (if applicable)
        - Alcohol reduction (if applicable)
        - Sleep hygiene
        - Stress management

        OUTPUT (JSON array):
        [
        {{
            "intervention_type": "diet|exercise|smoking_cessation|alcohol|sleep|stress",
            "specific_recommendation": "SPECIFIC actionable recommendation with exact frequency, duration, intensity",
            "evidence_strength": "A|B|C",
            "expected_benefit": "specific measurable benefit for this patient",
            "implementation_difficulty": "easy|moderate|difficult",
            "guideline_rationale": "MUST reference one of the approved guidelines listed above — name it exactly + year + what it says. Never cite a guideline not in the approved list.",
            "patient_specific_reason": "Why this lifestyle change is critical for THIS specific patient — reference their diagnosis, stage, planned treatments, or comorbidities",
            "supporting_evidence": "Key study or meta-analysis supporting this recommendation, or null. Example: 'Cumberbatch et al. 2016 meta-analysis of 32 studies — smoking cessation reduces bladder cancer recurrence by 40%'"
        }}
        ]

        CRITICAL RULES:
        - guideline_rationale MUST name the specific guideline and year
        - patient_specific_reason MUST link the recommendation to this patient's specific clinical situation
        - Be SPECIFIC with recommendations:
        BAD: "Exercise regularly"
        GOOD: "Moderate-intensity aerobic exercise 150 min/week (e.g., brisk walking), avoiding high-impact activities pre-operatively if cystectomy is planned"

        Return ONLY JSON array."""
        
        try:
            response = self.llm.invoke( [
                SystemMessage(content=f"Recommend specialty-scoped ({resolved_specialty}) lifestyle interventions. Return only JSON array."),
                HumanMessage(content=prompt)
            ])
            
            lifestyle_json = self._parse_json_array(response.content)
            
            lifestyle_recommendations = []
            for item in lifestyle_json:
                try:
                    # Handle evidence_strength mapping
                    evidence = item.get("evidence_strength", "B")
                    try:
                        evidence_enum = EvidenceLevel(evidence)
                    except ValueError:
                        logger.warning(f"⚠️ Invalid EvidenceLevel '{evidence}', defaulting to B")
                        evidence_enum = EvidenceLevel.B
                    
                    lifestyle_rec = LifestyleRecommendation(
                        intervention_type=item.get("intervention_type", "general"),
                        specific_recommendation=item.get("specific_recommendation", ""),
                        evidence_strength=evidence_enum,
                        expected_benefit=item.get("expected_benefit", ""),
                        implementation_difficulty=item.get("implementation_difficulty", "moderate"),
                        guideline_rationale=item.get("guideline_rationale", ""),
                        patient_specific_reason=item.get("patient_specific_reason", ""),
                        supporting_evidence=item.get("supporting_evidence")
                    )
                    lifestyle_recommendations.append(lifestyle_rec)
                except Exception as e:
                    logger.warning(f"⚠️ Error creating lifestyle recommendation: {str(e)}")
                    continue
            
            # Post-process: fill any empty rationale fields as fallback
            for rec in lifestyle_recommendations:
                if not rec.guideline_rationale or rec.guideline_rationale.strip() == "":
                    rec.guideline_rationale = (
                        f"Evidence-based guidelines recommend {rec.intervention_type} modifications "
                        f"for patients with this condition "
                        f"(Evidence Level {rec.evidence_strength}): {rec.expected_benefit}"
                    )
                if not rec.patient_specific_reason or rec.patient_specific_reason.strip() == "":
                    disease = primary_dx.disease if primary_dx else "the stated condition"
                    rec.patient_specific_reason = (
                        f"Recommended for this patient with {disease} "
                        f"to achieve: {rec.expected_benefit}"
                    )

            state["lifestyle_recommendations"] = lifestyle_recommendations
            logger.info(f"✅ Lifestyle: {len(lifestyle_recommendations)} interventions recommended (specialty={resolved_specialty})")
            
        except Exception as e:
            logger.error(f"❌ Lifestyle recommendation failed: {str(e)}")
            state["warnings"].append("Lifestyle recommendation incomplete")
            state["lifestyle_recommendations"] = []
        
        return state
    
    def _parse_json_array(self, content: str) -> List[dict]:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("[")
            end = content.rfind("]")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return []
        except:
            return []


# =====================================================================
# LAYER 8: FOLLOW-UP PLANNING AGENT (SPECIALTY-AWARE)
# =====================================================================

class FollowUpAgent:
    """Intelligent follow-up scheduling, aware of the treating specialty's typical cadence."""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def plan_followup(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Generate follow-up plan"""
        
        logger.info("📅 Follow-up Agent: Starting")
        
        treatment_input = state["treatment_input"]
        patient_summary = state.get("patient_summary") or {}
        logger.info(f"📋 Patient summary retrieved: {patient_summary}")

        # ── FULL, SCHEMA-AGNOSTIC PATIENT CONTEXT ──
        summary_data = patient_summary.get("summary", {}) if isinstance(patient_summary, dict) else {}
        clinical_summary_text = "\n\n".join(summary_data.get("paragraphs", []))

        timeline_data = patient_summary.get("timeline", {}) if isinstance(patient_summary, dict) else {}
        timeline_entries = timeline_data.get("timeline", [])

        agentic_context = {
            "clinical_summary": clinical_summary_text,
            "timeline": timeline_entries
        }

        patient_summary_json = json.dumps(agentic_context, indent=2, default=str)
        primary_dx = treatment_input.primary_diagnosis
        resolved_specialty = state.get("resolved_specialty") or resolve_specialty_label(treatment_input.doctor_speciality)
        
        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            prompt = f"""
You are scheduling follow-up for this patient. You are the treating {resolved_specialty} specialist —
the follow-up plan should reflect what THIS specialty typically monitors, not a generic multidisciplinary
schedule.

⚠️ PRIORITY INSTRUCTION — MANDATORY FIRST STEP:
No structured diagnosis was attached to this request. Before scheduling generic wellness follow-up, check
the clinical context below (full patient record) for an active disease. If one is documented (e.g. an active
cancer), the follow-up interval and monitoring parameters MUST match that disease's actual management needs
within your specialty (e.g. frequent early visits during active systemic treatment if Medical Oncology;
imaging surveillance tied to a radiation course if Radiation Oncology; wound/pathology follow-up if Surgical
Oncology) — NOT a generic 3-month wellness check. Only use generic wellness follow-up if no active disease
is documented.

PATIENT CLINICAL CONTEXT (full patient record — primary source for all decisions):
{patient_summary_json}

ADDITIONAL FACTORS:
- Age: {treatment_input.patient_age} years
- Sex: {treatment_input.patient_sex}
- Comorbidities: {', '.join(treatment_input.comorbidities)}
- Current Medications: {', '.join([m.drug_name for m in treatment_input.current_medications])}

TASK: Design a follow-up schedule appropriate to whatever is actually found in the clinical context above,
and to your specialty ({resolved_specialty}).

OUTPUT (JSON) — must match this exact top-level schema:
{{
  "next_visit_timing": "specific timeframe justified by the patient's actual condition",
  "follow_up_guideline_rationale": "which guideline/clinical rationale justifies this interval",
  "monitoring_parameters": [
    {{
      "parameter": "what to monitor",
      "reason": "why — reference the actual condition found",
      "guideline": "guideline basis if applicable",
      "frequency": "how often"
    }}
  ],
  "success_criteria": [
    {{
      "criterion": "specific measurable success indicator",
      "guideline_basis": "basis for this threshold"
    }}
  ],
  "escalation_triggers": [
    {{
      "trigger": "specific warning sign",
      "action": "what to do",
      "guideline_basis": "basis for this escalation"
    }}
  ]
}}

CRITICAL RULES:
1. All recommendations MUST be derived primarily from the clinical summary and timeline above.
2. If an active disease is documented, follow-up timing and monitoring MUST reflect that disease's actual
   management schedule for YOUR specialty, not a default wellness interval.
3. patient_specific_reason/reason fields MUST reference at least two patient-specific factors from the summary.
4. Return ONLY JSON matching the schema above — no nested "follow_up" wrapper, no extra top-level keys.
"""
        else:
            strategy = state.get("current_strategy", TreatmentStrategy.STANDARD)
            candidate_investigations = state.get("candidate_investigations", [])
            lifestyle_recommendations = state.get("lifestyle_recommendations", [])

            strategy_instruction = {
                TreatmentStrategy.CONSERVATIVE: (
                    "CONSERVATIVE: Longer follow-up intervals (2-3 months). "
                    "Focus on safety monitoring and side effect detection."
                ),
                TreatmentStrategy.STANDARD: (
                    "STANDARD: Standard follow-up intervals per disease guidelines."
                ),
                TreatmentStrategy.AGGRESSIVE: (
                    "AGGRESSIVE: Frequent early follow-up (2-4 weeks). "
                    "Aggressive monitoring and early titration. "
                    "Include response assessment imaging if applicable."
                ),
            }[strategy]

            intent = state.get("treatment_intent")
            intent_str = intent.value if intent else "not specified"

            doctor_guidelines_fu = state.get('doctor_guidelines', [])
            approved_fu_block = (
                chr(10).join(
                    f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}"
                    for g in doctor_guidelines_fu
                ) or "  No specific guidelines configured — use your best clinical judgment"
            )

            prompt = f"""You are scheduling follow-up for treatment monitoring, as the treating {resolved_specialty} specialist.

        ⚠️ APPROVED GUIDELINES — USE ONLY THESE (fetched from doctor's profile in DB):
        {approved_fu_block}
        Every follow_up_guideline_rationale and every monitoring parameter guideline citation MUST reference one of the approved guidelines above only.

        PRIMARY DIAGNOSIS: {primary_dx.disease}
        TREATMENT INTENT: {intent_str}
        TREATING SPECIALTY: {resolved_specialty}

        ⚠️ FOLLOW-UP STRATEGY (MUST FOLLOW):

        {strategy_instruction}

        TREATMENTS PRESCRIBED (from THIS specialty's plan only):
        {chr(10).join(f"- {d.drug_name} ({d.dose} {d.frequency})" for d in state.get('candidate_drugs', [])) or '- None'}

        PROCEDURES PLANNED (from THIS specialty's plan only):
        {chr(10).join(f"- {p.procedure_name} ({p.timing})" for p in state.get('candidate_procedures', [])) or '- None'}

        INVESTIGATIONS ORDERED (results must be reviewed at follow-up):
        {chr(10).join(f"- {i.test_name} ({i.urgency})" for i in candidate_investigations) or '- None'}

        LIFESTYLE INTERVENTIONS TO TRACK:
        {chr(10).join(f"- {l.intervention_type}: {l.specific_recommendation}" for l in lifestyle_recommendations) or '- None'}

        PATIENT CLINICAL CONTEXT (full patient record — clinical summary, timeline, tumor/imaging
        characteristics, labs, biomarkers, prior treatments — use for urgency level, lab trends, active
        diagnoses, and prior treatments):
        {patient_summary_json}

        TASK: Design a complete follow-up schedule that covers ALL of the above, appropriate to your specialty's
        typical monitoring cadence (e.g. Medical Oncology cycles every 2-3 weeks during active chemo; Radiation
        Oncology weekly on-treatment review plus post-treatment surveillance imaging; Surgical Oncology
        post-op wound check at ~2 weeks then staged surveillance).

        OUTPUT (JSON):
        {{
        "next_visit_timing": "specific timeframe matched to strategy with guideline justification",
        "follow_up_guideline_rationale": "Which approved guideline mandates this follow-up interval — MUST be from the approved list above, name it exactly",
        "monitoring_parameters": [
            {{
            "parameter": "what to monitor — e.g. PSA level",
            "reason": "why — e.g. primary tumor marker for prostate cancer",
            "guideline": "which guideline requires this — e.g. NCCN 2024",
            "frequency": "how often — e.g. every 3 months"
            }}
        ],
        "success_criteria": [
            {{
            "criterion": "specific measurable success indicator",
            "guideline_basis": "which guideline defines this threshold — e.g. 'NCCN defines PSA < 0.1 ng/mL as biochemical remission post-prostatectomy'"
            }}
        ],
        "escalation_triggers": [
            {{
            "trigger": "specific warning sign",
            "action": "what to do — e.g. urgent urology referral, repeat imaging",
            "guideline_basis": "which guideline recommends this escalation"
            }}
        ]
        }}

        REQUIREMENTS:
        1. monitoring_parameters MUST include every ordered investigation result review
        2. monitoring_parameters MUST include side effect monitoring for every prescribed drug
        3. monitoring_parameters MUST include lifestyle adherence checks
        4. Every monitoring parameter MUST cite which guideline requires it
        5. Every escalation trigger MUST include the recommended action
        6. Match timing to strategy: {strategy_instruction}
        7. Do not schedule monitoring for treatments outside THIS specialty's plan

        Return ONLY JSON."""
        
        try:
            response = self.llm.invoke( [
                SystemMessage(content=f"Plan follow-up for the treating {resolved_specialty} specialist. Return only JSON."),
                HumanMessage(content=prompt)
            ])
            
            followup_json = self._parse_json(response.content)
            
            def _normalize_list(items, key="parameter") -> List[str]:
                """Flatten list of dicts or strings into list of strings"""
                result = []
                for item in (items or []):
                    if isinstance(item, str):
                        result.append(item)
                    elif isinstance(item, dict):
                        # Try common keys in order
                        value = (
                            item.get("parameter") or
                            item.get("criterion") or
                            item.get("trigger") or
                            item.get("monitoring") or
                            item.get("text") or
                            str(item)
                        )
                        # Append reason/guideline if present
                        reason = item.get("reason") or item.get("guideline_basis") or item.get("guideline") or ""
                        action = item.get("action", "")
                        freq = item.get("frequency", "")
                        
                        parts = [value]
                        if freq:
                            parts.append(f"({freq})")
                        if reason:
                            parts.append(f"— {reason}")
                        if action:
                            parts.append(f"→ {action}")
                        
                        result.append(" ".join(parts))
                return result

            follow_up_plan = FollowUpPlan(
                next_visit_timing=followup_json.get("next_visit_timing", "3 months"),
                follow_up_guideline_rationale=followup_json.get("follow_up_guideline_rationale", ""),
                monitoring_parameters=_normalize_list(
                    followup_json.get("monitoring_parameters", []), key="parameter"
                ),
                success_criteria=_normalize_list(
                    followup_json.get("success_criteria", []), key="criterion"
                ),
                escalation_triggers=_normalize_list(
                    followup_json.get("escalation_triggers", []), key="trigger"
                )
            )
            
            state["follow_up_plan"] = follow_up_plan
            logger.info(f"✅ Follow-up: Next visit in {follow_up_plan.next_visit_timing}")
            
        except Exception as e:
            logger.error(f"❌ Follow-up planning failed: {str(e)}")
            state["follow_up_plan"] = FollowUpPlan(
                next_visit_timing="3 months",
                follow_up_guideline_rationale="Default follow-up schedule",
                monitoring_parameters=[
                    "General health assessment",
                    "Review of medications",
                    "Vital signs check"
                ],
                success_criteria=[
                    "Stable health status",
                    "No new symptoms",
                    "Good medication tolerance"
                ],
                escalation_triggers=[
                    "New or worsening symptoms",
                    "Medication side effects",
                    "Abnormal vital signs"
                ]
            )
            state["warnings"].append("Follow-up planning incomplete - using default")
        
        return state
    
    def _parse_json(self, content: str) -> dict:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            start = content.find("{")
            end = content.rfind("}")
            if start != -1 and end != -1:
                return json.loads(content[start:end + 1])
            return {}
        except:
            return {}


# =====================================================================
# LAYER 9: FINAL TREATMENT PLAN ASSEMBLER
# =====================================================================

class TreatmentPlanAssembler:
    """Assembles final treatment plan"""
    
    def __init__(self, llm: ChatGroq):
        self.llm = llm
    
    async def assemble(self, state: TreatmentPlanState) -> TreatmentPlanState:
        """Create final treatment plan"""
        
        logger.info("📋 Treatment Plan Assembler: Starting")
        
        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        resolved_specialty = state.get("resolved_specialty") or resolve_specialty_label(treatment_input.doctor_speciality)
        
        # Separate first-line vs adjunctive drugs
        all_drugs = state.get("candidate_drugs", [])
        first_line = [d for d in all_drugs if d.recommendation_class == RecommendationClass.CLASS_I]
        adjunctive = [d for d in all_drugs if d.recommendation_class != RecommendationClass.CLASS_I]
        
        # Generate summary
        summary = await self._generate_summary(state)
        
        # Collect all warnings
        warnings = state.get("warnings", [])
        
        # Add drug interaction warnings
        for drug in all_drugs:
            if drug.drug_interactions:
                warnings.append(f"Drug interaction: {drug.drug_name} with {', '.join(drug.drug_interactions)}")
        
        # Check if specialist review needed
        requires_specialist = (
            len(state.get("candidate_procedures", [])) > 0
            or any(d.recommendation_class == RecommendationClass.CLASS_III for d in all_drugs)
        )
        
        # FIX: Ensure treatment_intent is never None
        treatment_intent = state.get("treatment_intent")
        if treatment_intent is None:
            logger.warning("⚠️ Treatment intent is None, defaulting to PREVENTIVE")
            treatment_intent = TreatmentIntent.PREVENTIVE

        # Specialty scope notes — surfaced to the UI so the doctor can see the plan was
        # deliberately scoped to their specialty (and what that excludes).
        specialty_scope_notes = [
            f"This plan was generated strictly within the scope of {resolved_specialty}.",
        ]
        if resolved_specialty == "Medical Oncology":
            specialty_scope_notes.append("Radiation and surgical planning are out of scope — refer to Radiation/Surgical Oncology as needed.")
        elif resolved_specialty == "Radiation Oncology":
            specialty_scope_notes.append("Systemic chemotherapy/immunotherapy regimens and surgical planning are out of scope, except concurrent radiosensitizer therapy where explicitly indicated.")
        elif resolved_specialty == "Surgical Oncology":
            specialty_scope_notes.append("Systemic therapy and radiation planning are out of scope — only peri-operative supportive medications are included.")
        
        treatment_plan = TreatmentPlan(
            treatment_intent=treatment_intent,
            primary_goals=state.get("treatment_goals", []),
            treating_specialty=resolved_specialty,
            specialty_scope_notes=specialty_scope_notes,
            first_line_drugs=first_line,
            adjunctive_drugs=adjunctive,
            recommended_procedures=state.get("candidate_procedures", []),
            required_investigations=state.get("candidate_investigations", []),
            lifestyle_modifications=state.get("lifestyle_recommendations", []),
            follow_up_plan=state.get("follow_up_plan") or FollowUpPlan(
                next_visit_timing="3 months",
                monitoring_parameters=["General health assessment"],
                success_criteria=["Stable health status"],
                escalation_triggers=["New symptoms", "Worsening condition"]
            ),
            guideline_compliance_score=0.0, 
            patient_adherence_prediction="pending",
            warnings=warnings,
            requires_specialist_review=requires_specialist,
            treatment_summary=summary,
            confidence_score=0.0,
        )
        
        state["treatment_plan"] = treatment_plan
        
        logger.info("✅ Treatment Plan Assembled")
        logger.info(f"   Treating specialty: {resolved_specialty}")
        logger.info(f"   First-line drugs: {len(first_line)}")
        logger.info(f"   Procedures: {len(treatment_plan.recommended_procedures)}")
        logger.info(f"   Investigations: {len(treatment_plan.required_investigations)}")
        
        return state
    
    async def _generate_summary(self, state: TreatmentPlanState) -> str:
        """Generate treatment summary"""
        
        treatment_input = state["treatment_input"]
        primary_dx = treatment_input.primary_diagnosis
        resolved_specialty = state.get("resolved_specialty") or resolve_specialty_label(treatment_input.doctor_speciality)
        
        drugs = state.get("candidate_drugs", [])
        procedures = state.get("candidate_procedures", [])
        investigations = state.get("candidate_investigations", [])
        lifestyle = state.get("lifestyle_recommendations", [])
        
        summary_parts = []
        
        # Handle case when no primary diagnosis is provided
        if not primary_dx:
            summary_parts.append(
                f"{resolved_specialty} wellness plan with {state.get('treatment_intent', TreatmentIntent.PREVENTIVE)} intent."
            )
        else:
            summary_parts.append(
                f"{resolved_specialty} treatment plan for {primary_dx.disease} with {state.get('treatment_intent')} intent."
            )
        
        if drugs:
            drug_names = [d.drug_name for d in drugs[:3]]
            summary_parts.append(f"Medications: {', '.join(drug_names)}.")
        
        if procedures:
            proc_names = [p.procedure_name for p in procedures]
            summary_parts.append(f"Procedures: {', '.join(proc_names)}.")
        
        if investigations:
            summary_parts.append(f"Recommended tests: {len(investigations)} investigations.")
        
        if lifestyle:
            summary_parts.append(f"Lifestyle modifications: {len(lifestyle)} recommendations.")
        
        if not drugs and not procedures and not investigations and not lifestyle:
            summary_parts.append("No specific recommendations at this time.")
        
        return " ".join(summary_parts)


class ClinicalEvaluationAgent:
    def __init__(self, llm: ChatGroq):
        self.llm = llm

    async def evaluate(
        self,
        plan: TreatmentPlan,
        treatment_input: TreatmentPlanInput,
        patient_summary: Optional[Dict[str, Any]],
    ) -> ValidationResult:
        logger.info(f"🧠 Evaluating | strategy={plan.strategy.value} | specialty={plan.treating_specialty}")

        dx = treatment_input.primary_diagnosis
        all_drugs = plan.first_line_drugs + plan.adjunctive_drugs
        resolved_specialty = plan.treating_specialty or resolve_specialty_label(treatment_input.doctor_speciality)

        # ── FULL, SCHEMA-AGNOSTIC PATIENT CONTEXT ──
        # Previously this hand-picked clinical_summary/timeline/treatment_timeline keys
        # from patient_summary. It now reuses the same full-record builder as every other
        # agent, so the audit sees exactly the same complete patient data (tumor size,
        # stage, biomarkers, labs, prior treatments, everything) as the generation agents did.
        summary_data_eval = patient_summary.get("summary", {}) if isinstance(patient_summary, dict) else {}
        clinical_summary_text_eval = "\n\n".join(summary_data_eval.get("paragraphs", []))

        timeline_data_eval = patient_summary.get("timeline", {}) if isinstance(patient_summary, dict) else {}
        timeline_entries_eval = timeline_data_eval.get("timeline", [])

        agentic_context_eval = {
            "clinical_summary": clinical_summary_text_eval,
            "timeline": timeline_entries_eval
        }
        patient_summary_json_eval = json.dumps(agentic_context_eval, indent=2, default=str)

        # ── Build plan context strings ────────────────────────────────────
        drug_lines = [
            f"- {d.drug_name} | Class: {d.drug_class} | Dose: {d.dose} | "
            f"Indication: {d.indication} | Rec Class: {d.recommendation_class.value} | "
            f"Guideline: {d.guideline_support.value}"
            for d in all_drugs
        ]
        inv_lines = [
            f"- {i.test_name} | Urgency: {i.urgency} | Indication: {i.indication} | "
            f"Already done: {i.already_completed} | Repeat justified: {i.repeat_justified}"
            for i in plan.required_investigations
        ]
        proc_lines = [
            f"- {p.procedure_name} | Timing: {p.timing} | Indication: {p.indication}"
            for p in plan.recommended_procedures
        ]
        allergy_list = [a.allergen for a in treatment_input.allergies]
        completed_inv_list = [inv.test_name for inv in treatment_input.completed_investigations]
        completed_proc_list = [proc.procedure_name for proc in treatment_input.completed_procedures]
        current_med_list = [f"{m.drug_name} {m.dose}" for m in treatment_input.current_medications]

        strategy_bands = {
            TreatmentStrategy.CONSERVATIVE: "0.40–0.72",
            TreatmentStrategy.STANDARD:     "0.55–0.82",
            TreatmentStrategy.AGGRESSIVE:   "0.62–0.90",
        }
        score_band = strategy_bands[plan.strategy]

        specialty_skill_for_eval = SPECIALTY_SKILLS.get(resolved_specialty, MEDICAL_ONCOLOGY_SKILL)

        evaluation_prompt = f"""You are a senior specialist physician and clinical pharmacologist performing a comprehensive treatment plan audit.

    ═══════════════════════════════════════════════════════════
    TREATING SPECIALTY UNDER AUDIT: {resolved_specialty}
    ═══════════════════════════════════════════════════════════
    {specialty_skill_for_eval}

    ═══════════════════════════════════════════════════════════
    PATIENT PROFILE
    ═══════════════════════════════════════════════════════════
    Age          : {treatment_input.patient_age}
    Sex          : {treatment_input.patient_sex}
    Diagnosis    : {dx.disease if dx else 'None'}
    Stage        : {dx.stage if dx else 'N/A'}
    Severity     : {dx.severity if dx else 'N/A'}
    Renal (eGFR) : {treatment_input.renal_function_egfr or 'Unknown'}
    Hepatic      : {treatment_input.hepatic_function or 'Unknown'}
    Cardiac EF   : {treatment_input.cardiac_function_ef or 'Unknown'}%
    Strategy     : {plan.strategy.value.upper()}
    Intent       : {plan.treatment_intent.value}

    KNOWN ALLERGIES:
    {chr(10).join(f'- {a}' for a in allergy_list) or '- None'}

    CURRENT MEDICATIONS (before this plan):
    {chr(10).join(f'- {m}' for m in current_med_list) or '- None'}

    ALREADY COMPLETED INVESTIGATIONS:
    {chr(10).join(f'- {i}' for i in completed_inv_list) or '- None'}

    ALREADY COMPLETED PROCEDURES:
    {chr(10).join(f'- {p}' for p in completed_proc_list) or '- None'}

    ═══════════════════════════════════════════════════════════
    PATIENT CLINICAL CONTEXT (full patient record — clinical summary, timeline, tumor/imaging
    characteristics, labs, biomarkers, prior treatments, current condition — everything the summary
    pipeline has on this patient)
    Use for: biomarker status, prior treatments, active diagnoses, urgency level, tumor size/stage
    ═══════════════════════════════════════════════════════════
    {patient_summary_json_eval}

    ═══════════════════════════════════════════════════════════
    TREATMENT PLAN BEING EVALUATED
    ═══════════════════════════════════════════════════════════
    DRUGS IN PLAN:
    {chr(10).join(drug_lines) or '- None'}

    INVESTIGATIONS IN PLAN:
    {chr(10).join(inv_lines) or '- None'}

    PROCEDURES IN PLAN:
    {chr(10).join(proc_lines) or '- None'}

    FOLLOW-UP: {plan.follow_up_plan.next_visit_timing if plan.follow_up_plan else 'Not specified'}

    ═══════════════════════════════════════════════════════════
    YOUR EVALUATION TASK — CHECK ALL OF THE FOLLOWING
    ═══════════════════════════════════════════════════════════

    SECTION A — BIOMARKER & RECEPTOR CHECKS (read from patient summary above):
    A1. Read IHC/biomarker results from the patient summary. For each drug in the plan, verify it matches the patient's biomarker status.
        - HER2-targeted drugs (Trastuzumab, Pertuzumab, Lapatinib, Neratinib, Tucatinib, T-DM1): ONLY if HER2 score 3+ or FISH amplified. Flag if HER2 is 1+ or negative.
        - Endocrine therapy (Tamoxifen, Letrozole, Anastrozole, Exemestane, Fulvestrant): ONLY if ER or PR positive. Flag if ER/PR negative.
        - Tamoxifen vs Aromatase Inhibitor: Tamoxifen is for premenopausal women. Aromatase inhibitors are for postmenopausal women (age ≥55 or documented). Flag wrong choice.
        - Tamoxifen + Aromatase Inhibitor simultaneously: No evidence base. Flag as critical.
        - EGFR inhibitors, ALK inhibitors, BRAF inhibitors, BCR-ABL inhibitors, PD-1/PD-L1 inhibitors: verify matching biomarker in summary.
        - Any other targeted therapy: verify target is confirmed positive in the summary.

    SECTION B — DRUG SAFETY CHECKS:
    B1. ALLERGIES: Check every drug in the plan against the known allergies above. Flag any match as critical.
    B2. CARDIOTOXIC MONITORING: If any cardiotoxic drug is in the plan (Doxorubicin, Epirubicin, Cyclophosphamide, Trastuzumab, Pertuzumab, 5-FU, Imatinib), check if Echocardiogram is in the investigation plan. Flag if missing.
    B3. NEPHROTOXIC MONITORING: If any nephrotoxic drug is in the plan (Cisplatin, Carboplatin, Methotrexate, Vancomycin, Amphotericin, NSAIDs), check if renal function tests (eGFR/Creatinine) are in the investigation plan. Flag if missing.
    B4. HEPATOTOXIC MONITORING: If any hepatotoxic drug is in the plan (Tamoxifen, Methotrexate, Letrozole, Anastrozole, Doxorubicin, Isoniazid, Statins at high dose), check if LFTs are in the investigation plan. Flag if missing.
    B5. DRUG-DRUG INTERACTIONS: Review the current medications above alongside the new drugs. Flag any clinically significant interactions.
    B6. DOSE APPROPRIATENESS: Check doses against patient's age, renal function, hepatic function. Flag dangerous doses.
    B7. RENAL DOSE ADJUSTMENT: If eGFR is known and reduced (<60 mL/min), flag any renally-cleared drugs that need dose adjustment.

    SECTION C — INVESTIGATION CHECKS:
    C1. DUPLICATION: Check every investigation in the plan against the already-completed investigations above. Flag any test being re-ordered within the past 30 days without justification.
    C2. MISSING BASELINE TESTS: For the planned drugs and procedures, flag any mandatory baseline tests that are missing (e.g., CBC before chemotherapy, ECHO before anthracyclines, bone density before long-term aromatase inhibitors).
    C3. STAGING COMPLETENESS: For the given diagnosis and stage, flag if any mandatory staging investigation is missing per current guidelines.

    SECTION D — CLINICAL APPROPRIATENESS:
    D1. STAGE MISMATCH: Flag any drug approved only for a more advanced stage than documented (e.g., a metastatic-only drug prescribed for localized disease).
    D2. INTENT MISMATCH: Flag any drug whose indication contradicts the stated treatment intent (e.g., a palliative-only drug in a curative plan).
    D3. MISSING MANDATORY DRUGS: Per the APPROVED GUIDELINES listed below, flag any Class I mandatory drug that is absent from the plan — but only if it falls within the TREATING SPECIALTY's scope above; do not flag a missing drug that belongs to a different specialty's scope.
    D4. GUIDELINE VIOLATIONS: Flag any recommendation that directly contradicts the APPROVED GUIDELINES listed below. Also flag any recommendation that cites a guideline NOT in the approved list.

    APPROVED GUIDELINES FOR THIS DOCTOR (audit must be based ONLY on these):
    {chr(10).join(f"  [{g.get('id')}] {g.get('title')} — {g.get('explanation', '')}" for g in (getattr(treatment_input, '_doctor_guidelines', None) or []))}

    SECTION E — STRATEGY & FOLLOW-UP:
    E1. STRATEGY APPROPRIATENESS: Given the diagnosis severity and intent, is the {plan.strategy.value} strategy appropriate? Flag under-treatment (too conservative for a curable aggressive cancer) or over-treatment (too aggressive for a palliative intent).
    E2. FOLLOW-UP VAGUENESS: Is the follow-up timing specific? Flag if it is vague (e.g., "as needed", "TBD", missing entirely).
    E3. MONITORING COMPLETENESS: Are all prescribed drugs covered by appropriate monitoring parameters in the follow-up plan?

    SECTION F — SPECIALTY SCOPE COMPLIANCE (NEW):
    F1. Verify EVERY drug, procedure, and investigation in the plan falls within the TREATING SPECIALTY's
        scope defined at the top of this prompt. Flag ANY recommendation that belongs exclusively to a
        different specialty's scope (e.g. a full chemotherapy regimen recommended by a Radiation Oncologist,
        or a radiation prescription recommended by a Surgical Oncologist) as a CRITICAL issue.
    F2. The one narrow exception: Radiation Oncology may include a concurrent radiosensitizer drug if
        explicitly justified as such — this is NOT a scope violation.
    F3. Surgical Oncology may include peri-operative supportive medications (antibiotics, VTE prophylaxis,
        analgesia, antiemetics) — this is NOT a scope violation.

    ═══════════════════════════════════════════════════════════
    SCORING INSTRUCTIONS
    ═══════════════════════════════════════════════════════════
    Start from a base score of 1.0. Apply deductions:
    - Each CRITICAL issue (allergy violation, biomarker mismatch, stage mismatch, missing mandatory drug, specialty scope violation): -0.15 to -0.20
    - Each WARNING (suboptimal choice, missing monitoring, vague follow-up): -0.05 to -0.10
    - Class I guideline drugs present: +0.02 per drug (max +0.06)
    - All mandatory baseline tests present: +0.03
    - Complete and specific follow-up plan: +0.02

    Clamp final score to strategy band: {score_band}

    Guideline compliance score = validation_score - 0.03 + (number of Class I drugs × 0.02), clamped to same band.

    ═══════════════════════════════════════════════════════════
    OUTPUT — Return ONLY this JSON, no text outside it:
    ═══════════════════════════════════════════════════════════
    {{
    "validation_score": <float in {score_band}>,
    "guideline_compliance_score": <float in {score_band}>,
    "is_valid": <true if no CRITICAL issues, else false>,
    "critical_issues": [
        "CRITICAL: <specific issue — name the drug, biomarker, guideline violated, or specialty scope violation>"
    ],
    "warnings": [
        "<specific warning — name the drug or test>"
    ],
    "recommendations_to_remove": [
        "<drug or test name> — <one sentence reason with guideline reference>"
    ],
    "recommendations_to_add": [
        "<drug or test name> — <one sentence reason with guideline reference>"
    ],
    "safety_notes": [
        "<specific safety monitoring instruction>"
    ]
    }}

    RULES:
    - Be specific in every issue: name the drug, name the biomarker, cite the exact approved guideline.
    - Only cite guidelines from the APPROVED GUIDELINES list above — never reference NCCN, ASCO, ESMO, WHO, or any other guideline unless it appears in that approved list.
    - If a recommendation in the plan cites a non-approved guideline, flag it as a warning.
    - Do NOT generate vague issues like "some drugs may not be appropriate".
    - If a section has no issues, return an empty list for that field.
    - critical_issues must only contain genuinely critical safety or efficacy violations.
    - Return ONLY valid JSON. No markdown, no preamble, no explanation outside the JSON."""

        try:
            resp = self.llm.invoke( [
                SystemMessage(content=(
                    f"You are a senior {resolved_specialty} specialist and clinical pharmacologist performing a "
                    "treatment plan audit. Return only valid JSON matching the exact schema provided. "
                    "No markdown. No text outside JSON."
                )),
                HumanMessage(content=evaluation_prompt)
            ])

            logger.info(f"  🔍 LLM evaluation response: {resp.content[:300]}")
            result = self._parse_json(resp.content)

            def _flatten(items) -> List[str]:
                out = []
                for item in (items or []):
                    if isinstance(item, str) and item.strip():
                        out.append(item)
                    elif isinstance(item, dict):
                        out.append(str(item))
                return out

            # Extract scores from LLM output
            bands = {
                TreatmentStrategy.CONSERVATIVE: (0.40, 0.72),
                TreatmentStrategy.STANDARD:     (0.55, 0.82),
                TreatmentStrategy.AGGRESSIVE:   (0.62, 0.90),
            }
            lo, hi = bands[plan.strategy]

            raw_val_score = result.get("validation_score")
            raw_guide_score = result.get("guideline_compliance_score")

            # Fallback: compute from critical issue count if LLM didn't return scores
            critical_issues = _flatten(result.get("critical_issues", []))
            warnings_list = _flatten(result.get("warnings", []))

            if raw_val_score is None or not isinstance(raw_val_score, (int, float)):
                # Derive from issue count
                fallback = 1.0 - (len(critical_issues) * 0.18) - (len(warnings_list) * 0.06)
                final_score = round(max(lo, min(hi, fallback)), 3)
                logger.warning(f"⚠️ LLM did not return validation_score — computed fallback: {final_score}")
            else:
                final_score = round(max(lo, min(hi, float(raw_val_score))), 3)

            if raw_guide_score is None or not isinstance(raw_guide_score, (int, float)):
                guideline_score = round(max(lo, min(hi, final_score - 0.02)), 3)
            else:
                guideline_score = round(max(lo, min(hi, float(raw_guide_score))), 3)

            is_valid = result.get("is_valid")
            if not isinstance(is_valid, bool):
                is_valid = len([c for c in critical_issues if "CRITICAL" in c.upper()]) == 0

            logger.info(
                f"  ✅ {plan.strategy.value} | "
                f"val={final_score:.2f} | guideline={guideline_score:.2f} | "
                f"critical={len(critical_issues)} | warnings={len(warnings_list)}"
            )

            return ValidationResult(
                is_valid=is_valid,
                validation_score=final_score,
                guideline_compliance_score=guideline_score,
                critical_issues=critical_issues,
                warnings=warnings_list,
                recommendations_to_remove=_flatten(result.get("recommendations_to_remove", [])),
                recommendations_to_add=_flatten(result.get("recommendations_to_add", [])),
                guideline_compliance_notes=[],
                safety_notes=_flatten(result.get("safety_notes", [])),
            )

        except Exception as e:
            logger.error(f"❌ Evaluation failed for strategy={plan.strategy.value}: {e}")
            bands = {
                TreatmentStrategy.CONSERVATIVE: (0.40, 0.72),
                TreatmentStrategy.STANDARD:     (0.55, 0.82),
                TreatmentStrategy.AGGRESSIVE:   (0.62, 0.90),
            }
            lo, hi = bands[plan.strategy]
            return ValidationResult(
                is_valid=False,
                validation_score=round(lo + 0.05, 3),
                guideline_compliance_score=round(lo, 3),
                critical_issues=[f"Evaluation failed: {str(e)}"],
                warnings=["Manual clinical review required — automated evaluation could not complete"],
                recommendations_to_remove=[],
                recommendations_to_add=[],
                guideline_compliance_notes=[],
                safety_notes=[],
            )

    def _parse_json(self, content: str) -> dict:
        try:
            content = content.strip()
            if "```json" in content:
                content = content.split("```json", 1)[1].split("```", 1)[0]
            s, e = content.find("{"), content.rfind("}")
            if s != -1 and e != -1:
                return json.loads(content[s:e+1])
            return {}
        except Exception:
            return {}


# =====================================================================
# LANGGRAPH WORKFLOW ORCHESTRATOR
# =====================================================================


def create_treatment_plan_workflow(
    llm: ChatGroq,
    knowledge_graph: TreatmentKnowledgeGraph
) -> StateGraph:
    """Create LangGraph treatment planning workflow (with Specialty Skill Layer)"""
    
    # Initialize agents
    intent_agent = TreatmentIntentAgent(llm)
    specialty_skill_agent = SpecialtySkillAgent()
    guideline_agent = GuidelineRetrievalAgent(knowledge_graph)
    exclusion_agent = ExclusionFilterAgent()
    pharma_agent = PharmacologicalAgent(llm, knowledge_graph)
    procedural_agent = ProceduralAgent(llm)
    investigation_agent = InvestigationAgent(llm)
    lifestyle_agent = LifestyleAgent(llm)
    followup_agent = FollowUpAgent(llm)
    assembler = TreatmentPlanAssembler(llm)
    
    # Create workflow
    workflow = StateGraph(TreatmentPlanState)
    
    # Add nodes
    async def _lift_drug_safety(state: TreatmentPlanState) -> TreatmentPlanState:
        all_interactions = []
        all_contraindications = []
        for d in state.get("candidate_drugs", []):
            all_interactions.extend(d.drug_interactions)
            if d.renal_dose_adjustment:
                all_contraindications.append(
                    f"Renal adjustment needed: {d.drug_name} — {d.renal_dose_adjustment}"
                )
        state["drug_interactions"] = list(set(all_interactions))
        state["contraindications"] = all_contraindications
        return state

    # Add nodes
    workflow.add_node("intent_identification", intent_agent.determine_intent)
    workflow.add_node("specialty_skill_selection", specialty_skill_agent.select_skill)
    workflow.add_node("guideline_retrieval", guideline_agent.retrieve_guidelines)
    workflow.add_node("exclusion_filter", exclusion_agent.filter_completed)
    workflow.add_node("pharmacological", pharma_agent.recommend_drugs)
    workflow.add_node("lift_drug_safety", _lift_drug_safety)
    workflow.add_node("procedural", procedural_agent.recommend_procedures)
    workflow.add_node("investigation", investigation_agent.recommend_investigations)
    workflow.add_node("lifestyle", lifestyle_agent.recommend_lifestyle)
    workflow.add_node("followup", followup_agent.plan_followup)
    workflow.add_node("assemble", assembler.assemble)
    
    # Set entry point
    workflow.set_entry_point("intent_identification")
    
    # Define edges
    # Patient Summary -> Timeline -> Primary Diagnosis -> [Intent] -> Doctor Specialty
    #   -> Specialty Skill Selection -> Guideline Retrieval -> Treatment Planning Agents
    #   -> Specialty-Specific Treatment Plan
    workflow.add_edge("intent_identification", "specialty_skill_selection")
    workflow.add_edge("specialty_skill_selection", "guideline_retrieval")
    workflow.add_edge("guideline_retrieval", "exclusion_filter")
    workflow.add_edge("exclusion_filter", "pharmacological")
    workflow.add_edge("pharmacological", "lift_drug_safety")
    workflow.add_edge("lift_drug_safety", "procedural")
    workflow.add_edge("procedural", "investigation")
    workflow.add_edge("investigation", "lifestyle")
    workflow.add_edge("lifestyle", "followup")
    workflow.add_edge("followup", "assemble")
    workflow.add_edge("assemble", END)
    
    return workflow.compile()


# =====================================================================
# MAIN EXECUTION FUNCTION
# =====================================================================

async def generate_treatment_plan(
    treatment_input: TreatmentPlanInput,
    llm: ChatGroq,
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
    patient_summary: Optional[Dict[str, Any]] = None
) -> TreatmentPlan:
    
    logger.info(f"🚀 Starting Treatment Planning: Patient={treatment_input.patient_id}")
    
    if treatment_input.primary_diagnosis:
        logger.info(f"   Diagnosis: {treatment_input.primary_diagnosis.disease}")
    else:
        logger.info("   No primary diagnosis provided - will generate general wellness recommendations")
    
    logger.info(f"   Doctor Speciality (raw): {treatment_input.doctor_speciality}")
    logger.info(f"   Excluding {len(treatment_input.completed_procedures)} procedures")
    logger.info(f"   Excluding {len(treatment_input.completed_investigations)} investigations")
    
    # Initialize knowledge graph
    knowledge_graph = TreatmentKnowledgeGraph(neo4j_uri, neo4j_user, neo4j_password)
    
    try:
        # Create workflow
        workflow = create_treatment_plan_workflow(llm, knowledge_graph)
        
        # Initialize state
        initial_state: TreatmentPlanState = {
            "treatment_input": treatment_input,
            "patient_summary": patient_summary,
            "current_strategy": TreatmentStrategy.STANDARD,
            "prognosis": treatment_input.prognosis,
            "doctor_guidelines": [],
            "allowed_guideline_titles": [],
            "specialty_skill": None,
            "resolved_specialty": None,
            "treatment_intent": None,
            "treatment_goals": [],
            "applicable_guidelines": [],
            "guideline_recommendations": {},
            "excluded_procedures": set(),
            "excluded_investigations": set(),
            "candidate_drugs": [],
            "candidate_procedures": [],
            "candidate_investigations": [],
            "contraindications": [],
            "drug_interactions": [],
            "cost_analysis": {},
            "follow_up_plan": None,
            "lifestyle_recommendations": [],
            "treatment_plan": None,
            "error": None,
            "warnings": []
        }
        
        # Run workflow
        final_state = await workflow.ainvoke(initial_state)
        
        logger.info("✅ Treatment Planning Complete")
        
        if final_state.get("treatment_plan"):
            return final_state["treatment_plan"]
        else:
            logger.warning("⚠️ Workflow failed to generate plan - creating default plan")
            return create_default_treatment_plan(treatment_input)
            
    finally:
        knowledge_graph.close()

def create_default_treatment_plan(treatment_input: TreatmentPlanInput) -> TreatmentPlan:
    """Create a default treatment plan when workflow fails"""
    
    resolved_specialty = resolve_specialty_label(treatment_input.doctor_speciality)

    return TreatmentPlan(
        treatment_intent=TreatmentIntent.PREVENTIVE,
        primary_goals=[
            "Maintain overall health and wellness",
            "Monitor existing conditions",
            "Prevent future health issues"
        ],
        treating_specialty=resolved_specialty,
        specialty_scope_notes=[f"Default fallback plan generated within {resolved_specialty} scope."],
        first_line_drugs=[],
        adjunctive_drugs=[],
        recommended_procedures=[],
        required_investigations=[],
        lifestyle_modifications=[],
        follow_up_plan=FollowUpPlan(
            next_visit_timing="3 months",
            monitoring_parameters=[
                "General health assessment",
                "Review of any symptoms",
                "Vital signs check"
            ],
            success_criteria=[
                "Stable health status",
                "No new concerning symptoms",
                "Good medication tolerance"
            ],
            escalation_triggers=[
                "New or worsening symptoms",
                "Medication side effects",
                "Abnormal vital signs"
            ]
        ),
        guideline_compliance_score=0.7,
        patient_adherence_prediction="moderate",
        warnings=["Treatment plan generated with limited information"],
        requires_specialist_review=False,
        treatment_summary="General wellness plan based on available patient information.",
        confidence_score=0.6
    )

async def generate_three_treatment_plans(
    treatment_input: TreatmentPlanInput,
    llm: ChatGroq,
    neo4j_uri: str,
    neo4j_user: str,
    neo4j_password: str,
    patient_summary: Optional[Dict[str, Any]] = None,
) -> List[TreatmentPlan]:

    logger.info(f"🚀 Multi-Plan Generation | Patient={treatment_input.patient_id}")

    knowledge_graph = TreatmentKnowledgeGraph(neo4j_uri, neo4j_user, neo4j_password)
    eval_agent = ClinicalEvaluationAgent(llm)

    strategies = [TreatmentStrategy.CONSERVATIVE, TreatmentStrategy.STANDARD, TreatmentStrategy.AGGRESSIVE]
    enriched_plans: List[TreatmentPlan] = []

    try:
        workflow = create_treatment_plan_workflow(llm, knowledge_graph)

        for strategy in strategies:
            logger.info(f"\n▶ Generating {strategy.value.upper()} plan")

            initial_state: TreatmentPlanState = {
                "treatment_input": treatment_input,
                "patient_summary": patient_summary,
                "current_strategy": strategy,
                "prognosis": treatment_input.prognosis,
                "doctor_guidelines": [],
                "allowed_guideline_titles": [],
                "specialty_skill": None,
                "resolved_specialty": None,
                "treatment_intent": None,
                "treatment_goals": [],
                "applicable_guidelines": [],
                "guideline_recommendations": {},
                "excluded_procedures": set(),
                "excluded_investigations": set(),
                "candidate_drugs": [],
                "candidate_procedures": [],
                "candidate_investigations": [],
                "contraindications": [],
                "drug_interactions": [],
                "cost_analysis": {},
                "follow_up_plan": None,
                "lifestyle_recommendations": [],
                "treatment_plan": None,
                "error": None,
                "warnings": [],
            }

            final_state = await workflow.ainvoke(initial_state)
            plan: TreatmentPlan = final_state.get("treatment_plan") or create_default_treatment_plan(treatment_input)
            plan.strategy = strategy

            # Attach doctor guidelines so ClinicalEvaluationAgent can enforce approved-only audit
            treatment_input._doctor_guidelines = final_state.get("doctor_guidelines", [])
            val_result = await eval_agent.evaluate(plan, treatment_input, patient_summary)
            plan.validation_result = val_result
            plan.confidence_score = val_result.validation_score
            plan.guideline_compliance_score = val_result.guideline_compliance_score

            logger.info(
                f"  ✅ {strategy.value.upper()} | specialty={plan.treating_specialty} | "
                f"valid={val_result.is_valid} | "
                f"val_score={val_result.validation_score:.2f} | "
                f"guideline={val_result.guideline_compliance_score:.2f}"
            )
            enriched_plans.append(plan)

        def _clinical_rank_score(p: TreatmentPlan) -> float:
            """
            Composite ranking score that considers clinical content quality,
            not just the LLM probability score.
            """
            prob = p.confidence_score if p.confidence_score else 0.0
            val  = p.validation_result.validation_score if p.validation_result else 0.0
            stress = p.validation_result.guideline_compliance_score if p.validation_result else 0.0

            # Investigation quality: reward more management-changing tests, penalize flagged-for-removal
            inv_count = len(p.required_investigations)
            inv_change_mgmt = sum(1 for i in p.required_investigations if i.will_change_management)
            flagged_removals = len(p.validation_result.recommendations_to_remove) if p.validation_result else 0
            inv_score = min(1.0, (inv_change_mgmt * 0.15) - (flagged_removals * 0.08))

            # Follow-up quality: reward specific monitoring parameters and escalation triggers
            followup_depth = 0.0
            if p.follow_up_plan:
                followup_depth = min(1.0, (
                    len(p.follow_up_plan.monitoring_parameters) * 0.04 +
                    len(p.follow_up_plan.escalation_triggers) * 0.05
                ))

            # Drug quality: reward Class I drugs, penalize Class III
            drug_quality = 0.0
            all_drugs = p.first_line_drugs + p.adjunctive_drugs
            if all_drugs:
                class_i = sum(1 for d in all_drugs if d.recommendation_class == RecommendationClass.CLASS_I)
                class_iii = sum(1 for d in all_drugs if d.recommendation_class == RecommendationClass.CLASS_III)
                drug_quality = min(1.0, (class_i / len(all_drugs)) - (class_iii * 0.2))

            composite = (
                prob         * 0.35 +
                val          * 0.25 +
                inv_score    * 0.15 +
                followup_depth * 0.10 +
                drug_quality * 0.10 +
                stress       * 0.05
            )
            return round(composite, 4)

        enriched_plans.sort(
            key=lambda p: (
                (p.validation_result.validation_score if p.validation_result else 0.0) * 0.6 +
                (p.validation_result.guideline_compliance_score if p.validation_result else 0.0) * 0.4
            ),
            reverse=True
        )

        for plan in enriched_plans:
            plan._clinical_rank_score = _clinical_rank_score(plan)
            logger.info(
                f"  🏆 {plan.strategy.value.upper()} | "
                f"composite={_clinical_rank_score(plan):.3f} | "
                f"confidence={plan.confidence_score:.2f} | "
                f"val={plan.validation_result.validation_score:.2f} | "
                f"inv_mgmt={sum(1 for i in plan.required_investigations if i.will_change_management)} | "
                f"flagged_removals={len(plan.validation_result.recommendations_to_remove) if plan.validation_result else 0}"
            )

        return enriched_plans

    finally:
        knowledge_graph.close()


# =====================================================================
# EXAMPLE USAGE / API ENDPOINTS
# =====================================================================
#
# NOTE: This section mirrors the endpoint from the previous (non-specialty-aware)
# version of this file, restored here and wired up to the new Specialty-Aware
# pipeline. Nothing else about the request/response contract has changed —
# doctor_speciality (fetched from doctor_users.specialization, same as before)
# now additionally drives the Specialty Skill Layer end-to-end.

from pydantic import parse_obj_as

@router.post("/generate-treatment-plan")
async def generate_treatment_plan_endpoint(
    request: dict = Body(...)  # Accept any dictionary
):
    """
    Generate specialty-aware treatment plan(s) with optional fields.

    The endpoint accepts:
    - patient_id: Required
    - doctor_id: Required
    - primary_diagnosis: Optional (can be null or not provided)
    - prognosis: Optional
    - additional_input: Optional

    Diagnosis fallback (per Specialty-Aware Architecture v2):
    If `primary_diagnosis` is supplied, it is used as-is. If it is NOT supplied,
    `build_treatment_input` leaves it as None, and every downstream planning agent
    (TreatmentIntentAgent, PharmacologicalAgent, ProceduralAgent, InvestigationAgent,
    LifestyleAgent, FollowUpAgent) automatically infers the active diagnosis from the
    fetched `patient_summary` (the FULL patient record — clinical_summary + timeline +
    every other field the summary pipeline populated) instead of defaulting to
    a generic wellness plan.

    Specialty scoping:
    `doctor_speciality` (from doctor_users.specialization) is resolved via
    `resolve_specialty_label()` into one of "Medical Oncology" / "Radiation Oncology" /
    "Surgical Oncology", and every generated plan is strictly scoped to that specialty.
    """
    logger.info(f"📋 Received treatment plan request: {json.dumps(request, indent=2)}")
    
    try:
        # Extract fields with defaults
        patient_id = request.get("patient_id")
        doctor_id = request.get("doctor_id")
        primary_diagnosis = request.get("primary_diagnosis")
        prognosis = request.get("prognosis")
        additional_input = request.get("additional_input", {})
        
        # Validate required fields
        if not patient_id:
            raise HTTPException(
                status_code=400, 
                detail="patient_id is required"
            )
        
        if not doctor_id:
            raise HTTPException(
                status_code=400, 
                detail="doctor_id is required"
            )
        
        # Step 1: Fetch patient data from patient_users collection
        logger.info(f"🔍 Fetching patient data for ID: {patient_id}")
        patient_data = await database["patient_users"].find_one(
            {"patient_id": patient_id}
        )
        
        if not patient_data:
            patient_data = await database["patient_users"].find_one(
                {"sys_user_id": patient_id}
            )
            
        if not patient_data:
            logger.warning(f"⚠️ Patient not found with ID: {patient_id}, using minimal data")
            patient_data = {
                "patient_id": patient_id,
                "name": "Unknown",
                "gender": None,
                "date_of_birth": None
            }
        
        logger.info(f"✅ Patient data fetched successfully: Name: {patient_data.get('name')}, Gender: {patient_data.get('gender')}")
        
        # Step 2: Fetch doctor data from doctor_users collection using sys_user_id
        # (doctor_data.specialization drives the Specialty Skill Layer downstream)
        logger.info(f"🔍 Fetching doctor data for sys_user_id: {doctor_id}")
        doctor_data = await database["doctor_users"].find_one(
            {"sys_user_id": doctor_id}
        )
        
        if not doctor_data:
            doctor_data = await database["doctor_users"].find_one(
                {"doctor_id": doctor_id}
            )
        
        if doctor_data:
            doctor_specialization = doctor_data.get("specialization", "general_practice")
            logger.info(f"✅ Doctor data fetched: Name: {doctor_data.get('name')}, Specialization: {doctor_specialization}")
        else:
            doctor_data = {"sys_user_id": doctor_id, "name": "Unknown", "specialization": "general_practice"}
            logger.warning(f"⚠️ Doctor data not found, using default")

        # Step 3: Fetch latest patient summary using patient_id only, sorted by generated_at
        logger.info(f"🔍 Fetching latest patient summary for patient_id: {patient_id}")
        patient_summary = None
        try:
            docs = await summary_collection.find(
                {"patient_id": patient_id}
            ).sort("generated_at", -1).limit(1).to_list(1)

            if docs:
                patient_summary = docs[0]
                logger.info(f"✅ Latest patient summary fetched | patient_id={patient_id} | summary_id={str(patient_summary.get('_id', ''))}")
            else:
                logger.warning(f"⚠️ No patient summary found for patient_id={patient_id}")

        except Exception as summary_fetch_error:
            logger.error(f"❌ Failed to fetch patient summary for patient_id={patient_id}: {str(summary_fetch_error)}")

        # Log patient summary details if found
        if patient_summary:
            patient_summary["_id"] = str(patient_summary["_id"])
            logger.info(f"📊 PATIENT SUMMARY DATA RETRIEVED:")
            logger.info(f"   │ Summary ID: {patient_summary['_id']}")
            logger.info(f"   │ Created At: {patient_summary.get('created_at')}")
            logger.info(f"   │ Last Updated: {patient_summary.get('last_updated')}")

            medical_history = patient_summary.get("patient_medical_history", {})
            if medical_history.get("major_diagnoses"):
                for i, diagnosis in enumerate(medical_history["major_diagnoses"], 1):
                    if isinstance(diagnosis, dict):
                        logger.info(f"   │   {i}. Diagnosis: {diagnosis.get('diagnosis', 'Unknown diagnosis')}")
                    else:
                        logger.info(f"   │   {i}. Diagnosis: {diagnosis}")
            
            completed_procedures = patient_summary.get("completed_procedures", [])
            if completed_procedures:
                logger.info(f"   │ Completed Procedures:")
                for i, proc in enumerate(completed_procedures, 1):
                    if isinstance(proc, dict):
                        logger.info(f"   │   {i}. Procedure: {proc.get('procedure_name', 'Unknown procedure')}")
                    else:
                        logger.info(f"   │   {i}. Procedure: {proc}")

            completed_investigations = patient_summary.get("completed_investigations", [])
            if completed_investigations:
                logger.info(f"   │ Completed Investigations:")
                for i, inv in enumerate(completed_investigations, 1):
                    if isinstance(inv, dict):
                        logger.info(f"   │   {i}. Investigation: {inv.get('test_name', 'Unknown test')}")
                    else:
                        logger.info(f"   │   {i}. Investigation: {inv}")

            current_medications = patient_summary.get("current_medications", [])
            if current_medications:
                logger.info(f"   │ Current Medications:")
                for i, med in enumerate(current_medications, 1):
                    if isinstance(med, dict):
                        logger.info(f"   │   {i}. Medication: {med.get('drug_name', 'Unknown drug')} - {med.get('dose', 'Unknown dose')}")
                    else:
                        logger.info(f"   │   {i}. Medication: {med}")
        else:
            logger.info(f"ℹ️ No summary found for patient: {patient_id} with doctor: {doctor_id}")
        
        # Step 4: Calculate age from date_of_birth
        patient_age = calculate_age(patient_data.get("date_of_birth"))
        logger.info(f"📅 Patient age calculated: {patient_age} years")
        
        # Step 5: Build TreatmentPlanInput from all data sources
        # (primary_diagnosis fallback + doctor_speciality resolution happen here)
        logger.info(f"🛠️ Building treatment input from all data sources...")
        treatment_input = build_treatment_input(
            patient_data=patient_data,
            doctor_data=doctor_data,
            patient_summary=patient_summary,
            primary_diagnosis=primary_diagnosis,
            patient_age=patient_age,
            additional_input=additional_input,
            prognosis=prognosis,
        )
        
        resolved_specialty_for_log = resolve_specialty_label(treatment_input.doctor_speciality)

        # Log treatment input summary
        logger.info(f"✅ Treatment input built successfully with:")
        logger.info(f"   - Primary Diagnosis: {treatment_input.primary_diagnosis.disease if treatment_input.primary_diagnosis else 'None (will be inferred from patient summary)'}")
        logger.info(f"   - Doctor Speciality (raw): {treatment_input.doctor_speciality}")
        logger.info(f"   - Resolved Specialty Skill: {resolved_specialty_for_log}")
        logger.info(f"   - Comorbidities: {len(treatment_input.comorbidities)}")
        logger.info(f"   - Current Medications: {len(treatment_input.current_medications)}")
        logger.info(f"   - Completed Procedures: {len(treatment_input.completed_procedures)}")
        logger.info(f"   - Completed Investigations: {len(treatment_input.completed_investigations)}")
        
        # Step 6: Initialize LLM
        logger.info(f"🤖 Initializing LLM (llama-3.3-70b-versatile)...")
        llm = ChatGroq(
            model="llama-3.3-70b-versatile",
            groq_api_key=os.getenv("GROQ_API_KEY"),
            temperature=0.1,
            max_retries=2,
            request_timeout=60,
        )
        logger.info(f"✅ LLM initialized successfully")
        
        # Step 7: Neo4j connection
        neo4j_uri = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
        neo4j_user = os.getenv("NEO4J_USER", "neo4j")
        neo4j_password = os.getenv("NEO4J_PASSWORD", "password")
        logger.info(f"🔌 Connecting to Neo4j at: {neo4j_uri}")
        
        # Step 8: Generate specialty-aware treatment plans (3 strategies, evaluated + ranked)
        logger.info(f"🚀 Starting treatment plan generation...")
        plans = await generate_three_treatment_plans(
            treatment_input=treatment_input,
            llm=llm,
            neo4j_uri=neo4j_uri,
            neo4j_user=neo4j_user,
            neo4j_password=neo4j_password,
            patient_summary=patient_summary,
        )

        ranked_summary = []
        for rank, plan in enumerate(plans, 1):
            ranked_summary.append({
                "rank": rank,
                "strategy": plan.strategy.value,
                "treating_specialty": plan.treating_specialty,
                "severity": treatment_input.primary_diagnosis.severity if treatment_input.primary_diagnosis else None,
                "treatment_intent": plan.treatment_intent.value,
                "validation_score": round(plan.validation_result.validation_score, 3) if plan.validation_result else 0.0,
                "guideline_compliance_score": round(plan.validation_result.guideline_compliance_score, 3) if plan.validation_result else 0.0,
                "is_valid": plan.validation_result.is_valid if plan.validation_result else None,
                "confidence_score": round(plan.confidence_score, 3),
                "drug_count": len(plan.first_line_drugs) + len(plan.adjunctive_drugs),
                "requires_specialist_review": plan.requires_specialist_review,
            })
            plan.rank = rank

        logger.info(f"✅ Treatment plan generation complete for patient: {patient_id}")

        # Log top-ranked plan summary
        if plans:
            top_plan = plans[0]
            logger.info(f"📋 TOP-RANKED TREATMENT PLAN ({top_plan.strategy.value.upper()}):")
            logger.info(f"   ┌─────────────────────────────────────────")
            logger.info(f"   │ Treating Specialty: {top_plan.treating_specialty}")
            logger.info(f"   │ Intent: {top_plan.treatment_intent}")
            logger.info(f"   │ Primary Goals: {len(top_plan.primary_goals)}")
            for i, goal in enumerate(top_plan.primary_goals, 1):
                logger.info(f"   │   {i}. {goal}")

            logger.info(f"   │ 💊 First-line Drugs: {len(top_plan.first_line_drugs)}")
            for i, drug in enumerate(top_plan.first_line_drugs, 1):
                logger.info(f"   │   {i}. {drug.drug_name} - {drug.dose} {drug.frequency}")

            logger.info(f"   │ 🔪 Procedures: {len(top_plan.recommended_procedures)}")
            for i, proc in enumerate(top_plan.recommended_procedures, 1):
                logger.info(f"   │   {i}. {proc.procedure_name} ({proc.timing})")

            logger.info(f"   │ 🔬 Investigations: {len(top_plan.required_investigations)}")
            for i, inv in enumerate(top_plan.required_investigations, 1):
                logger.info(f"   │   {i}. {inv.test_name} ({inv.urgency})")

            logger.info(f"   │ 🏃 Lifestyle Modifications: {len(top_plan.lifestyle_modifications)}")

            logger.info(f"   │ 📅 Follow-up: {top_plan.follow_up_plan.next_visit_timing}")
            logger.info(f"   │ Monitoring: {len(top_plan.follow_up_plan.monitoring_parameters)} parameters")

            logger.info(f"   │ 📊 Scores:")
            logger.info(f"   │   - Guideline Compliance: {top_plan.guideline_compliance_score:.0%}")
            logger.info(f"   │   - Confidence: {top_plan.confidence_score:.0%}")
            logger.info(f"   │   - Adherence Prediction: {top_plan.patient_adherence_prediction}")

            if top_plan.warnings:
                logger.info(f"   │ ⚠️ Warnings ({len(top_plan.warnings)}):")
                for i, warning in enumerate(top_plan.warnings, 1):
                    logger.info(f"   │   {i}. {warning}")

            logger.info(f"   └─────────────────────────────────────────")

        # Emit audit event (based on top-ranked plan)
        try:
            top_plan = plans[0] if plans else None
            if top_plan:
                await emit_audit(AuditEvent(
                    action="treatment_plan_generated",
                    actor_id=doctor_id,
                    resource_id=patient_id,
                    metadata={
                        "treating_specialty": top_plan.treating_specialty,
                        "confidence_score": top_plan.confidence_score,
                        "guideline_compliance": top_plan.guideline_compliance_score,
                        "drug_count": len(top_plan.first_line_drugs),
                        "requires_specialist_review": top_plan.requires_specialist_review,
                        "primary_diagnosis": top_plan.treatment_summary
                    }
                ))
        except Exception as audit_error:
            logger.warning(f"⚠️ Audit emission failed (non-blocking): {str(audit_error)}")

        return {
            "success": True,
            "patient_id": patient_id,
            "doctor_id": doctor_id,
            "treating_specialty": resolved_specialty_for_log,
            "total_plans": len(plans),
            "ranked_summary": ranked_summary,
            "treatment_plans": plans,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Error generating treatment plan: {str(e)}")
        logger.error(f"   Traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


def calculate_age(dob_str: Optional[str]) -> Optional[int]:
    """Calculate age from date of birth string"""
    if not dob_str:
        return None
    
    try:
        # Parse date of birth
        if isinstance(dob_str, str):
            # Handle different date formats
            if "T" in dob_str:  # ISO format
                dob = datetime.fromisoformat(dob_str.replace('Z', '+00:00'))
            elif "-" in dob_str:  # YYYY-MM-DD
                dob = datetime.strptime(dob_str, "%Y-%m-%d")
            else:
                return None
        else:
            return None
        
        # Calculate age
        today = datetime.now()
        age = today.year - dob.year
        
        # Adjust if birthday hasn't occurred this year
        if today.month < dob.month or (today.month == dob.month and today.day < dob.day):
            age -= 1
        
        return age
    except Exception as e:
        logger.error(f"Error calculating age from {dob_str}: {str(e)}")
        return None


def build_treatment_input(
    patient_data: dict,
    doctor_data: Optional[dict],
    patient_summary: Optional[dict],
    primary_diagnosis: Optional[dict],
    patient_age: Optional[int],
    additional_input: Optional[dict] = None,
    prognosis: Optional[dict] = None       # ADD this
) -> TreatmentPlanInput:
    """
    Build TreatmentPlanInput from all data sources.

    DIAGNOSIS FALLBACK (per Specialty-Aware Treatment Planning Architecture v2):
        If `primary_diagnosis` exists -> use it (structured PrimaryDiagnosis).
        Else -> leave primary_dx = None.

    We deliberately do NOT try to synthesize a PrimaryDiagnosis object from the
    patient_summary here. Instead, every downstream planning agent (TreatmentIntentAgent,
    GuidelineRetrievalAgent, PharmacologicalAgent, ProceduralAgent, InvestigationAgent,
    LifestyleAgent, FollowUpAgent) already contains explicit "no primary_dx" branches that
    read `patient_summary` directly (via build_full_patient_context, which passes through
    the ENTIRE document with no field allow-list) and infer/derive the active condition and
    appropriate recommendations from it — this preserves richer, narrative-grounded reasoning
    than truncating everything down to a single disease string this early in the pipeline.
    This matches the original diagnosis-extraction behavior:

        If primary_diagnosis exists
                Use it
        Else
                Extract diagnosis from Patient Summary   (done downstream, per-agent)

    Note on extraction below: the completed_procedures / completed_investigations /
    current_medications / comorbidities extraction still uses a set of common field-name
    hints (procedure/treatment/name, modality/test_name, drug_name, diagnosis, etc.) purely
    to populate the strongly-typed TreatmentPlanInput lists that the rest of the pipeline
    (ExclusionFilterAgent, prompts referencing treatment_input.*) expects. This is separate
    from and does not limit what the LLM agents see — they always receive the complete
    patient_summary document via build_full_patient_context/to_json regardless of whether
    this extraction below finds a match.

    SPECIALTY SCOPING:
        `doctor_speciality` is taken from doctor_data.specialization (or
        additional_input["doctor_speciality"] override) and stored as-is on
        TreatmentPlanInput. `resolve_specialty_label()` / `SpecialtySkillAgent`
        canonicalize it downstream into "Medical Oncology" / "Radiation Oncology" /
        "Surgical Oncology" for the Specialty Skill Layer.
    """
    
    completed_procedures = []
    completed_investigations = []
    current_medications = []
    comorbidities = []
    allergies = []
    
    if patient_summary:
        def _deep_collect(obj, target_keys, name_keys):
            """Walk entire summary dict, collect items under target_keys using name_keys"""
            results = []
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if k in target_keys:
                        items = v if isinstance(v, list) else [v]
                        for item in items:
                            if isinstance(item, dict):
                                for nk in name_keys:
                                    if item.get(nk):
                                        results.append(item)
                                        break
                            elif isinstance(item, str) and item.strip():
                                results.append({"name": item})
                    else:
                        results.extend(_deep_collect(v, target_keys, name_keys))
            elif isinstance(obj, list):
                for item in obj:
                    results.extend(_deep_collect(item, target_keys, name_keys))
            return results

        # ── Completed Procedures ──────────────────────────────────────────
        for item in _deep_collect(
            patient_summary,
            {"past_surgeries", "treatment_progressions", "recent_procedures"},
            ["procedure", "treatment", "name"]
        ):
            name = item.get("procedure") or item.get("treatment") or item.get("name", "")
            if name:
                completed_procedures.append(CompletedProcedure(
                    procedure_name=name,
                    date_performed=item.get("date", "unknown"),
                    outcome=item.get("evidence", item.get("outcome", "Completed"))
                ))

        # ── Completed Investigations ──────────────────────────────────────
        for item in _deep_collect(
            patient_summary,
            {"imaging_summary", "recent_imaging", "completed_investigations"},
            ["modality", "test_name", "name"]
        ):
            name = item.get("modality") or item.get("test_name") or item.get("name", "")
            finding = item.get("key_finding") or item.get("finding") or item.get("result", "")
            if name:
                completed_investigations.append(CompletedInvestigation(
                    test_name=name,
                    date_performed=item.get("date", "unknown"),
                    result=finding,
                    is_abnormal=bool(finding)
                ))

        # ── Current Medications ───────────────────────────────────────────
        for item in _deep_collect(
            patient_summary,
            {"current_medications"},
            ["drug_name", "name", "medication"]
        ):
            name = item.get("drug_name") or item.get("name") or item.get("medication", "")
            if name:
                current_medications.append(CurrentMedication(
                    drug_name=name,
                    dose=item.get("dose", ""),
                    frequency=item.get("frequency", ""),
                    route=item.get("route", "PO"),
                    started_date=item.get("started_date"),
                    indication=item.get("indication")
                ))

        # ── Comorbidities ─────────────────────────────────────────────────
        for item in _deep_collect(
            patient_summary,
            {"major_diagnoses", "active_diagnoses"},
            ["diagnosis", "name"]
        ):
            name = item.get("diagnosis") or item.get("name", "")
            if name and name not in comorbidities:
                comorbidities.append(name)

    # ── Primary Diagnosis (fallback preserved: None -> downstream agents infer) ────────

    primary_dx = None
    if primary_diagnosis:
        primary_dx = PrimaryDiagnosis(
            disease=primary_diagnosis.get("disease", "Unknown diagnosis"),
            icd10_code=primary_diagnosis.get("icd10_code"),
            stage=primary_diagnosis.get("stage"),
            severity=primary_diagnosis.get("severity", "moderate"),
            confidence=primary_diagnosis.get("confidence", 0.8)
        )
    else:
        logger.info(
            "ℹ️ No structured primary_diagnosis supplied — leaving primary_dx=None. "
            "Downstream agents will infer the active diagnosis from the full patient_summary "
            "document (via build_full_patient_context) per the diagnosis-extraction fallback logic."
        )

    # ── Visit Type ────────────────────────────────────────────────────────

    visit_type = "first_visit"
    if patient_summary:
        if completed_procedures or completed_investigations:
            visit_type = "followup"
        current_condition = patient_summary.get("current_medical_condition", {})
        urgency = current_condition.get("urgency_level")
        if urgency == "emergency":
            visit_type = "emergency"
        elif urgency == "urgent":
            visit_type = "urgent"

    # ── Doctor Speciality (drives the Specialty Skill Layer) ────────────────

    doctor_speciality = None
    doctor_sys_id = None
    if doctor_data:
        doctor_speciality = doctor_data.get("specialization") or doctor_data.get("specialty")
        doctor_sys_id = (
            doctor_data.get("sys_user_id")
            or doctor_data.get("doctor_id")
            or doctor_data.get("doctorId")
        )
        logger.info(f"🩺 Doctor sys_user_id for guidelines lookup: {doctor_sys_id}")
        logger.info(f"🩺 Doctor specialization (raw) for Specialty Skill Layer: {doctor_speciality}")

    # ── Additional Input Overrides ────────────────────────────────────────

    if additional_input:
        if "visit_type" in additional_input:
            visit_type = additional_input["visit_type"]
        if "doctor_speciality" in additional_input:
            doctor_speciality = additional_input["doctor_speciality"]

    treatment_setting = (additional_input or {}).get("treatment_setting", "outpatient")
    cost_sensitivity = (additional_input or {}).get("cost_sensitivity", "moderate")
    patient_preferences = (additional_input or {}).get("patient_preferences")

    # ── Validate age bounds ────────────────────────────────────

    if patient_age is not None and (patient_age < 0 or patient_age > 120):
        logger.warning(f"⚠️ Unrealistic patient age: {patient_age}, setting to None")
        patient_age = None
    prognosis_data = None
    if prognosis and isinstance(prognosis, dict):
        try:
            prognosis_data = PrognosisData(**prognosis)
        except Exception as e:
            logger.warning(f"⚠️ Could not parse prognosis: {e}")

    # Building TreatmentPlanInput
    # doctor_sys_id is stored in patient_preferences so GuidelineRetrievalAgent
    # can look up the correct doctor guidelines by doctorId
    final_patient_preferences = patient_preferences or doctor_sys_id or ""

    # Building TreatmentPlanInput
    treatment_input = TreatmentPlanInput(
        primary_diagnosis=primary_dx,
        patient_id=patient_data.get("patient_id", patient_data.get("sys_user_id", "")),
        patient_age=patient_age,
        patient_sex=patient_data.get("gender"),
        patient_weight_kg=None,
        comorbidities=comorbidities,
        allergies=allergies,
        current_medications=current_medications,
        renal_function_egfr=None,
        hepatic_function="normal",
        cardiac_function_ef=None,
        completed_procedures=completed_procedures,
        completed_investigations=completed_investigations,
        visit_type=visit_type,
        doctor_speciality=doctor_speciality,
        treatment_setting=treatment_setting,
        cost_sensitivity=cost_sensitivity,
        patient_preferences=final_patient_preferences,
        prognosis=prognosis_data,
    )
    
    logger.info(f"✅ Treatment input built successfully for patient: {treatment_input}")

    return treatment_input


@router.get("/patient-summary")
async def get_patient_summary():
    # Fetch all data from the collection asynchronously
    data_cursor = summary_collection.find()
    data = await data_cursor.to_list(length=None)  # Await and convert to list
    
    # Convert MongoDB ObjectId to string for JSON response
    for document in data:
        document["_id"] = str(document["_id"])  # Convert ObjectId to string

    return data


@router.get("/doctor-guidelines")
async def get_doctor_guidelines():
    try:
        # Retrieve all data from the collection as a cursor
        cursor = doctor_guidelines_collection.find()

        # Convert the cursor to a list asynchronously
        all_data = []
        async for doc in cursor:
            # Convert ObjectId and datetime to strings
            doc = {
                key: str(value) if isinstance(value, (ObjectId, datetime)) else value
                for key, value in doc.items()
            }
            all_data.append(doc)

        # Return the data as JSON respons
        return JSONResponse(content=all_data)
    
    except Exception as e:
        return JSONResponse(content={"error": str(e)}, status_code=500)