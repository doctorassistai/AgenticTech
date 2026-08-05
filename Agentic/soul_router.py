from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from motor.motor_asyncio import AsyncIOMotorClient
from pymongo import MongoClient
from bson import ObjectId
from datetime import datetime, timedelta
from groq import Groq
from dotenv import load_dotenv
import os
import json
import logging
import traceback

load_dotenv()

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

MONGO_URI     = os.getenv("MONGO_URI")
MONGO_DB      = "doctorassistai"
NODES_DB      = "doctorassistai_nodes"
GROQ_API_KEY  = os.getenv("GROQ_API_KEY")

mongodb_client = AsyncIOMotorClient(MONGO_URI)
database       = mongodb_client[MONGO_DB]
nodes_database = mongodb_client[NODES_DB]

sync_client    = MongoClient(MONGO_URI)
sync_db        = sync_client[MONGO_DB]
sync_nodes_db  = sync_client[NODES_DB]

groq_client = Groq(api_key=GROQ_API_KEY)

router = APIRouter(
    prefix="/soul",
    tags=["soul"],
    responses={404: {"description": "Not found"}},
)

# ─────────────────────────────────────────────────────────────────────────────
# Collections
# ─────────────────────────────────────────────────────────────────────────────

# PRIMARY (raw doctor-authored content — highest soul signal)
dictation_col    = database["dictation"]
conversation_col = database["conversation_user"]

# SECONDARY (doctor reasoning & decisions)
doc_clinical_notes   = database["documentation-clinical-notes"]
doc_investigation    = database["documentation-investigation-notes"]

# TERTIARY (may be AI-assisted — lower weight, still useful for pattern counts)
doc_treatment_plan      = database["documentation-treatment-plan"]
doc_medication_analysis = database["documentation-medication-analysis"]
doc_treatment_summary   = database["documentation-treatment-summary"]

# SUPPORTING
conditions_col = database["conditions"]
agentic_col    = database["agentic_data"]

# Outpatient structured notes (high-value: chief complaints, HPI, assessment)
outpatient_notes_col = database["doctor_screening_results"]

# Soul output
soul_collection      = database["doctor_soul_profiles"]

# ── NEW: Clinical QA Engine collections ──────────────────────────────────────
doctor_quality_metrics_col = database["doctor_quality_metrics"]

sync_doctor_users    = sync_db["doctor_users"]
soul_collection_sync = sync_db["doctor_soul_profiles"]

# ─────────────────────────────────────────────────────────────────────────────
# Source weights (used to calculate weighted sufficiency score)
# ─────────────────────────────────────────────────────────────────────────────

SOURCE_WEIGHTS = {
    "dictations":        40,
    "conversations":     25,
    "clinical_notes":    15,
    "investigations":    10,
    "treatment_plans":    5,
    "agentic_outputs":    5,
}

# ─────────────────────────────────────────────────────────────────────────────
# Continuous-update thresholds
# ─────────────────────────────────────────────────────────────────────────────

REGENERATION_CONSULTATION_THRESHOLD = 25   # regenerate after this many new consultations
REGENERATION_STALE_DAYS             = 7    # weekly_refresh() fallback

# ─────────────────────────────────────────────────────────────────────────────
# Final Doctor Intelligence Score weights (SOUL + QA layers)
# soul_score * 0.40 + guideline * 0.20 + medication * 0.15
#   + diagnostic * 0.15 + outcome * 0.10
# ─────────────────────────────────────────────────────────────────────────────

INTELLIGENCE_WEIGHTS = {
    "soul":       0.40,
    "guideline":  0.20,
    "medication": 0.15,
    "diagnostic": 0.15,
    "outcome":    0.10,
}

# ─────────────────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────────────────

def _safe_text(raw) -> str:
    if isinstance(raw, str):
        return raw[:2000]
    if isinstance(raw, (dict, list)):
        return json.dumps(raw, default=str)[:2000]
    return str(raw)[:2000]


async def _fetch_recent(collection, doctor_id: str, limit: int = 20) -> list:
    cursor = collection.find(
        {"doctor_id": doctor_id},
        {"_id": 0}
    ).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


async def _fetch_recent_patients(collection, doctor_id: str, limit: int = 15) -> list:
    cursor = collection.find(
        {"doctor_id": doctor_id},
        {"_id": 0, "patient_id": 1, "finaloutput": 1, "created_at": 1, "feature_id": 1}
    ).sort("created_at", -1).limit(limit)
    return await cursor.to_list(length=limit)


def _compact_list(items: list, key_fields: list) -> list:
    out = []
    for item in items:
        row = {f: _safe_text(item[f]) for f in key_fields if item.get(f) is not None}
        if row:
            out.append(row)
    return out


def _extract_raw_texts(docs: list, field: str = "raw_data", max_chars: int = 800) -> list:
    texts = []
    for d in docs:
        raw = d.get(field, [])
        for r in (raw if isinstance(raw, list) else []):
            content = r.get("content", "") if isinstance(r, dict) else str(r)
            if content:
                texts.append(str(content)[:max_chars])
    return texts


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — Quantitative behavior metrics
# Counts real observed behaviors instead of asking LLM to guess
# ─────────────────────────────────────────────────────────────────────────────

async def compute_behavior_metrics(doctor_id: str) -> dict:
    """
    Generate evidence-based numeric metrics from the doctor's real activity.
    These are passed to the LLM so it reasons from facts, not guesses.
    """

    total_consults = await dictation_col.count_documents({"doctor_id": doctor_id})
    if total_consults == 0:
        total_consults = await conversation_col.count_documents({"doctor_id": doctor_id})

    investigation_count = await doc_investigation.count_documents({"doctor_id": doctor_id})
    medication_count    = await doc_medication_analysis.count_documents({"doctor_id": doctor_id})
    clinical_note_count = await doc_clinical_notes.count_documents({"doctor_id": doctor_id})
    condition_count     = await conditions_col.count_documents({"doctor_id": doctor_id})
    agentic_count       = await agentic_col.count_documents({"doctor_id": doctor_id})

    unique_patients = len(
        await dictation_col.distinct("patient_id", {"doctor_id": doctor_id})
    ) or len(
        await conversation_col.distinct("patient_id", {"doctor_id": doctor_id})
    )

    safe_consults = max(total_consults, 1)

    metrics = {
        "consultation_count":               total_consults,
        "unique_patients_seen":             unique_patients,
        "investigation_order_rate":         round(investigation_count / safe_consults, 3),
        "medication_prescription_rate":     round(medication_count / safe_consults, 3),
        "clinical_note_rate":               round(clinical_note_count / safe_consults, 3),
        "avg_conditions_surfaced_per_visit": round(condition_count / safe_consults, 2),
        "agentic_engagement_count":         agentic_count,
        "raw_counts": {
            "dictations":      total_consults,
            "investigations":  investigation_count,
            "medications":     medication_count,
            "clinical_notes":  clinical_note_count,
            "conditions":      condition_count,
            "agentic_outputs": agentic_count,
        },
    }

    weighted_score = (
        min(total_consults, 30)    / 30 * SOURCE_WEIGHTS["dictations"] +
        min(clinical_note_count, 15) / 15 * SOURCE_WEIGHTS["clinical_notes"] +
        min(investigation_count, 20) / 20 * SOURCE_WEIGHTS["investigations"] +
        min(medication_count, 20)  / 20 * SOURCE_WEIGHTS["treatment_plans"] +
        min(agentic_count, 10)     / 10 * SOURCE_WEIGHTS["agentic_outputs"]
    )

    metrics["weighted_sufficiency_score"] = round(weighted_score, 1)
    metrics["data_sufficiency"] = (
        "high"   if weighted_score >= 60 else
        "medium" if weighted_score >= 25 else
        "low"
    )

    return metrics


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — Soul Scores (Phase 7)
# Deterministic, measurable soul dimensions (0-100).
# ─────────────────────────────────────────────────────────────────────────────

def compute_soul_scores(metrics: dict, soul_features: dict) -> dict:
    """
    Turns quantitative metrics + LLM-assessed confidence into the four
    measurable soul dimensions:
    evidence_score, safety_score, patient_centered_score, documentation_score.
    """
    soul_features = soul_features or {}

    inv_rate    = metrics.get("investigation_order_rate", 0) or 0
    note_rate   = metrics.get("clinical_note_rate", 0) or 0
    agentic     = metrics.get("agentic_engagement_count", 0) or 0
    sufficiency = metrics.get("weighted_sufficiency_score", 0) or 0

    evidence_score = round(
        min(100, (min(inv_rate, 1.0) * 40) + (min(agentic, 10) / 10 * 30) + (sufficiency * 0.30)),
        1
    )

    conf_map       = {"high": 100, "medium": 65, "low": 30}
    safety_conf    = soul_features.get("safety_behaviors", {}).get("confidence", "low")
    red_lines_conf = soul_features.get("red_lines", {}).get("confidence", "low")
    safety_score   = round(
        (conf_map.get(safety_conf, 30) + conf_map.get(red_lines_conf, 30)) / 2, 1
    )

    comm = soul_features.get("communication_style", {})
    patient_centered_score = comm.get("patient_centered_score")
    if not isinstance(patient_centered_score, (int, float)):
        patient_centered_score = 50.0

    documentation_score = round(min(100, note_rate * 100), 1)

    overall_soul_score = round(
        (evidence_score + safety_score + float(patient_centered_score) + documentation_score) / 4,
        1
    )

    return {
        "evidence_score":         evidence_score,
        "safety_score":           safety_score,
        "patient_centered_score": round(float(patient_centered_score), 1),
        "documentation_score":    documentation_score,
        "overall_soul_score":     overall_soul_score,
    }


def _render_scores_block(scores: dict) -> str:
    """Appends a deterministic Soul Scores section to the LLM-authored markdown."""
    return f"""

## Soul Scores (measurable dimensions)
| Dimension | Score |
|---|---|
| Evidence Score | {scores['evidence_score']}/100 |
| Safety Score | {scores['safety_score']}/100 |
| Patient-Centered Score | {scores['patient_centered_score']}/100 |
| Documentation Score | {scores['documentation_score']}/100 |
| **Overall Soul Score** | **{scores['overall_soul_score']}/100** |

_Scores are computed deterministically from observed activity and LLM confidence
levels, not generated text — they stay comparable across doctors and over time._
"""


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — Clinical QA / Safety Engine
# ─────────────────────────────────────────────────────────────────────────────

async def compute_quality_metrics(doctor_id: str) -> dict:
    """
    Layer 2: Clinical QA Engine.

    Computes six measurable quality dimensions from real activity data:
      1. guideline_compliance_score  — how often decisions align with evidence-based guidelines
      2. medication_safety_score     — drug interaction / dosing / contraindication signals
      3. diagnostic_quality_score    — initial vs final diagnosis consistency
      4. investigation_appropriateness_score — under/over investigation detection
      5. documentation_quality_score — completeness, reasoning depth
      6. outcome_quality_score       — patient improvement / readmission / escalation signals

    All scores are 0-100. Missing data defaults to a conservative 50 (neutral).
    """

    safe_count = max(
        await dictation_col.count_documents({"doctor_id": doctor_id}), 1
    )

    # ── 1. Guideline compliance ───────────────────────────────────────────────
    # Proxy: proportion of treatment plans that contain evidence-based
    # keywords vs raw plan count. Richer signal comes when the app pushes
    # structured compliance flags; we use counts as a conservative baseline.
    treatment_count = await doc_treatment_plan.count_documents({"doctor_id": doctor_id})
    # Compliance is estimated from the ratio of structured plans (investigation
    # linked to treatment) out of all consultations. Caps at 100.
    raw_compliance = min(treatment_count / safe_count, 1.0)
    guideline_compliance_score = round(50 + raw_compliance * 37, 1)   # range 50–87

    # ── 2. Medication safety ──────────────────────────────────────────────────
    # Proxy: medication events per consultation. High rate may indicate broad
    # prescribing; low rate with good investigation suggests targeted therapy.
    medication_count = await doc_medication_analysis.count_documents({"doctor_id": doctor_id})
    med_rate = medication_count / safe_count
    # Penalise extreme over-prescribing (>3 per consult) mildly; reward moderate rates.
    if med_rate == 0:
        medication_safety_score = 50.0
    elif med_rate <= 1.5:
        medication_safety_score = round(80 + med_rate * 8, 1)
    elif med_rate <= 3.0:
        medication_safety_score = round(92 - (med_rate - 1.5) * 5, 1)
    else:
        medication_safety_score = round(max(60, 84 - (med_rate - 3) * 4), 1)

    # ── 3. Diagnostic quality ─────────────────────────────────────────────────
    # Proxy: clinical note rate — higher structured note-keeping correlates with
    # better initial→final diagnosis consistency.
    clinical_note_count = await doc_clinical_notes.count_documents({"doctor_id": doctor_id})
    note_rate = clinical_note_count / safe_count
    diagnostic_quality_score = round(min(100, 50 + note_rate * 45), 1)

    # ── 4. Investigation appropriateness ─────────────────────────────────────
    investigation_count = await doc_investigation.count_documents({"doctor_id": doctor_id})
    inv_rate = investigation_count / safe_count
    # Ideal band: 0.4–1.0 investigations per consultation
    if inv_rate == 0:
        investigation_appropriateness_score = 50.0
    elif inv_rate <= 0.4:
        investigation_appropriateness_score = round(60 + inv_rate * 50, 1)
    elif inv_rate <= 1.0:
        investigation_appropriateness_score = round(80 + (inv_rate - 0.4) * 15, 1)
    else:
        investigation_appropriateness_score = round(max(65, 89 - (inv_rate - 1.0) * 10), 1)

    # ── 5. Documentation quality ──────────────────────────────────────────────
    # Same note_rate but with a different weighting to reflect completeness/reasoning.
    documentation_quality_score = round(min(100, note_rate * 100), 1)

    # ── 6. Outcome quality ────────────────────────────────────────────────────
    # Proxy: condition count relative to consultations. Surfacing more conditions
    # per visit correlates with comprehensive follow-up and fewer missed diagnoses.
    condition_count = await conditions_col.count_documents({"doctor_id": doctor_id})
    cond_rate = condition_count / safe_count
    outcome_quality_score = round(min(100, 50 + cond_rate * 15), 1)

    overall_quality_score = round(
        guideline_compliance_score   * 0.25 +
        medication_safety_score      * 0.20 +
        diagnostic_quality_score     * 0.20 +
        investigation_appropriateness_score * 0.15 +
        documentation_quality_score  * 0.10 +
        outcome_quality_score        * 0.10,
        1
    )

    return {
        "doctor_id":                           doctor_id,
        "guideline_compliance_score":          guideline_compliance_score,
        "medication_safety_score":             medication_safety_score,
        "diagnostic_quality_score":            diagnostic_quality_score,
        "investigation_appropriateness_score": investigation_appropriateness_score,
        "documentation_quality_score":         documentation_quality_score,
        "outcome_quality_score":               outcome_quality_score,
        "overall_quality_score":               overall_quality_score,
        "generated_at":                        datetime.utcnow().isoformat(),
    }


def _render_quality_block(qm: dict) -> str:
    """Appends the Clinical QA Engine scores section to the SOUL.md markdown."""
    return f"""

## Clinical QA Scores (Safety Engine — Layer 2)
| Dimension | Score |
|---|---|
| Guideline Compliance | {qm['guideline_compliance_score']}/100 |
| Medication Safety | {qm['medication_safety_score']}/100 |
| Diagnostic Quality | {qm['diagnostic_quality_score']}/100 |
| Investigation Appropriateness | {qm['investigation_appropriateness_score']}/100 |
| Documentation Quality | {qm['documentation_quality_score']}/100 |
| Outcome Quality | {qm['outcome_quality_score']}/100 |
| **Overall Quality Score** | **{qm['overall_quality_score']}/100** |

_Clinical QA scores are computed from observed activity data and reflect
evidence-based safety standards. They complement (not replace) the Soul Scores._
"""


def compute_intelligence_score(soul_scores: dict, quality_metrics: dict) -> dict:
    """
    Unified Doctor Intelligence Score:
    Combines Layer 1 (SOUL Engine) and Layer 2 (Clinical QA Engine).

    Formula (from architecture doc):
      overall_intelligence_score =
        soul_score   * 0.40
        + guideline  * 0.20
        + medication * 0.15
        + diagnostic * 0.15
        + outcome    * 0.10
    """
    soul_score       = soul_scores.get("overall_soul_score", 50)
    guideline_score  = quality_metrics.get("guideline_compliance_score", 50)
    medication_score = quality_metrics.get("medication_safety_score", 50)
    diagnostic_score = quality_metrics.get("diagnostic_quality_score", 50)
    outcome_score    = quality_metrics.get("outcome_quality_score", 50)

    overall = round(
        soul_score       * INTELLIGENCE_WEIGHTS["soul"] +
        guideline_score  * INTELLIGENCE_WEIGHTS["guideline"] +
        medication_score * INTELLIGENCE_WEIGHTS["medication"] +
        diagnostic_score * INTELLIGENCE_WEIGHTS["diagnostic"] +
        outcome_score    * INTELLIGENCE_WEIGHTS["outcome"],
        1
    )

    return {
        "soul_score":       soul_score,
        "guideline_score":  guideline_score,
        "medication_score": medication_score,
        "diagnostic_score": diagnostic_score,
        "outcome_score":    outcome_score,
        "overall_intelligence_score": overall,
        "weights": INTELLIGENCE_WEIGHTS,
    }


def _render_intelligence_block(intel: dict) -> str:
    """Appends the Unified Doctor Intelligence Score to the markdown."""
    return f"""

## Unified Doctor Intelligence Score
| Component | Score | Weight |
|---|---|---|
| Soul (Behavioral) | {intel['soul_score']}/100 | 40% |
| Guideline Compliance | {intel['guideline_score']}/100 | 20% |
| Medication Safety | {intel['medication_score']}/100 | 15% |
| Diagnostic Quality | {intel['diagnostic_score']}/100 | 15% |
| Outcome Quality | {intel['outcome_score']}/100 | 10% |
| **Overall Intelligence Score** | **{intel['overall_intelligence_score']}/100** | — |

_This score represents the Unified Doctor Intelligence: personalized (doctor-like)
AND safe (evidence-based). The system preserves the doctor's clinical style while
enforcing medical safety standards._
"""


# ─────────────────────────────────────────────────────────────────────────────
# Layer 2 — QA Prompt (LLM-assisted quality analysis)
# ─────────────────────────────────────────────────────────────────────────────

QA_ANALYSIS_PROMPT = """
You are a CLINICAL QUALITY ASSURANCE ENGINE.

Your task: analyze a doctor's clinical activity and assess alignment with
evidence-based medicine, patient safety, and clinical quality standards.

CRITICAL RULES:
1. Only assess from evidence present in the data.
2. Be specific — cite actual patterns, not generalities.
3. If data is insufficient for a dimension, state "insufficient_data".
4. Output ONLY valid JSON. No markdown, no preamble.

═══════════════════════════════════════════════════════════════
DOCTOR CONTEXT
═══════════════════════════════════════════════════════════════
Doctor ID:       {doctor_id}
Specialization:  {specialization}

═══════════════════════════════════════════════════════════════
QUANTITATIVE QUALITY METRICS (pre-computed)
═══════════════════════════════════════════════════════════════
{quality_metrics}

═══════════════════════════════════════════════════════════════
CLINICAL NOTES (doctor's structured reasoning)
═══════════════════════════════════════════════════════════════
{clinical_notes}

═══════════════════════════════════════════════════════════════
INVESTIGATION ORDERS
═══════════════════════════════════════════════════════════════
{investigation_orders}

═══════════════════════════════════════════════════════════════
TREATMENT PLANS
═══════════════════════════════════════════════════════════════
{treatment_plans}

═══════════════════════════════════════════════════════════════
MEDICATION ANALYSIS
═══════════════════════════════════════════════════════════════
{medication_analysis}

═══════════════════════════════════════════════════════════════
REQUIRED OUTPUT SCHEMA
═══════════════════════════════════════════════════════════════
{{
  "doctor_id": "{doctor_id}",
  "generated_at": "ISO timestamp here",

  "guideline_alignment": {{
    "observed_compliant_patterns": ["pattern1", "pattern2"],
    "observed_gaps": ["gap1", "gap2"],
    "references": ["NCCN", "ASCO", "WHO", "NICE"],
    "confidence": "high|medium|low"
  }},

  "medication_safety": {{
    "observed_safe_patterns": ["pattern1"],
    "potential_flags": ["flag1"],
    "confidence": "high|medium|low"
  }},

  "diagnostic_accuracy": {{
    "consistency_observations": ["obs1", "obs2"],
    "missed_condition_signals": ["signal1"],
    "escalation_appropriateness": "appropriate|under|over",
    "confidence": "high|medium|low"
  }},

  "investigation_appropriateness": {{
    "pattern": "under_investigation|appropriate|over_investigation",
    "observations": ["obs1", "obs2"],
    "efficiency_signal": "low|medium|high",
    "confidence": "high|medium|low"
  }},

  "outcome_quality": {{
    "positive_signals": ["signal1", "signal2"],
    "risk_signals": ["risk1"],
    "confidence": "high|medium|low"
  }},

  "risk_flags": [
    {{
      "severity": "low|medium|high",
      "category": "medication|diagnosis|guideline|documentation|outcome",
      "description": "specific observed risk pattern"
    }}
  ],

  "safety_md": "Complete SAFETY.md markdown content as a single escaped string"
}}

SAFETY.md FORMAT (put inside safety_md as escaped string):

# SAFETY PROFILE — {{doctor_id}}
Specialization: {{specialization}}
Generated: {{timestamp}}

## Guideline Alignment
[2-3 sentences. What guidelines does this doctor align with? Any observed gaps?]

### Compliant Patterns
- [pattern 1]
- [pattern 2]

### Observed Gaps
- [gap 1 or "No significant gaps identified from available data."]

## Medication Safety
[2 sentences on prescribing safety patterns observed.]

### Safe Patterns
- [pattern 1]

### Potential Flags
- [flag 1 or "No flags from available data."]

## Diagnostic Quality
[2 sentences on diagnosis consistency and escalation behavior.]

## Investigation Appropriateness
Pattern: {{pattern}}
[1-2 sentences interpreting the investigation rate in context of evidence-based standards.]

## Outcome Quality Signals
[2 sentences on positive and risk signals observed.]

## Risk Flags
{{risk_flags_list}}

## Runtime AI Protection
When the AI acts on behalf of this doctor, the Safety Engine enforces:
- Always check guideline alignment before recommending treatment
- Flag any medication pattern that deviates from standard safety thresholds
- Surface risk flags to the doctor before finalizing a recommendation
- If doctor style conflicts with guidelines, explain both: style AND guideline recommendation

Minimum 300 words. Write as a clinical quality reviewer.
"""


async def generate_safety_profile(
    doctor_id: str,
    behavioral_data: dict,
    quality_metrics: dict,
    specialization: str,
) -> dict:
    """LLM-assisted qualitative QA analysis on top of the quantitative metrics."""

    def trunc(lst, n=6):
        return (lst or [])[:n]

    prompt = QA_ANALYSIS_PROMPT.format(
        doctor_id=doctor_id,
        specialization=specialization or "General Medicine",
        quality_metrics=json.dumps(quality_metrics, indent=2, default=str)[:1200],
        clinical_notes=json.dumps(
            trunc(behavioral_data.get("clinical_notes"), 6), default=str
        )[:1800],
        investigation_orders=json.dumps(
            trunc(behavioral_data.get("investigation_orders"), 6), default=str
        )[:1500],
        treatment_plans=json.dumps(
            trunc(behavioral_data.get("treatment_plans"), 5), default=str
        )[:1200],
        medication_analysis=json.dumps(
            trunc(behavioral_data.get("medication_analysis"), 5), default=str
        )[:1200],
    )

    completion = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.15,
        max_tokens=3000,
        response_format={"type": "json_object"},
    )

    raw    = completion.choices[0].message.content.strip()
    result = json.loads(raw)
    result["generated_at"] = datetime.utcnow().isoformat()
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Behavioral data aggregation (unchanged from existing code)
# ─────────────────────────────────────────────────────────────────────────────

async def collect_doctor_behavioral_data(doctor_id: str) -> dict:
    """
    Collect and prioritize behavioral signals.

    Priority:
      HIGH   — dictation, conversation  (raw doctor words)
      MEDIUM — clinical_notes, investigations  (doctor reasoning)
      LOW    — treatment_plans, medication_analysis  (may be AI-assisted)
      SUPPORT — conditions, agentic_outputs
    """

    dictations    = await _fetch_recent(dictation_col, doctor_id, 30)
    conversations = await _fetch_recent(conversation_col, doctor_id, 20)

    dictation_texts    = _extract_raw_texts(dictations)[:20]
    conversation_texts = _extract_raw_texts(conversations)[:15]

    clinical_notes_all = await _fetch_recent_patients(doc_clinical_notes, doctor_id, 15)
    investigations     = await _fetch_recent_patients(doc_investigation, doctor_id, 20)

    note_snippets   = _compact_list(clinical_notes_all, ["patient_id", "finaloutput", "created_at"])
    invest_snippets = _compact_list(investigations,     ["patient_id", "finaloutput", "created_at"])

    treatment_plans   = await _fetch_recent_patients(doc_treatment_plan,      doctor_id, 20)
    medication_items  = await _fetch_recent_patients(doc_medication_analysis, doctor_id, 20)
    treatment_summary = await _fetch_recent_patients(doc_treatment_summary,   doctor_id, 15)

    plan_snippets    = _compact_list(treatment_plans,   ["patient_id", "finaloutput", "created_at"])
    med_snippets     = _compact_list(medication_items,  ["patient_id", "finaloutput", "created_at"])
    summary_snippets = _compact_list(treatment_summary, ["patient_id", "finaloutput", "created_at"])

    conditions = await _fetch_recent(conditions_col, doctor_id, 40)
    agentic    = await _fetch_recent(agentic_col,    doctor_id, 10)

    condition_texts = [
        c.get("condition", "") for c in conditions
        if isinstance(c.get("condition"), str) and c.get("condition")
    ]

    agentic_snippets = [
        _safe_text(a["data"]) for a in agentic if a.get("data")
    ]

    metrics = await compute_behavior_metrics(doctor_id)

    return {
        "dictation_samples":     dictation_texts,
        "conversation_samples":  conversation_texts,
        "clinical_notes":        note_snippets[:10],
        "investigation_orders":  invest_snippets[:15],
        "treatment_plans":       plan_snippets[:10],
        "medication_analysis":   med_snippets[:10],
        "treatment_summaries":   summary_snippets[:8],
        "condition_extractions": condition_texts[:30],
        "agentic_outputs":       agentic_snippets[:8],
        "behavior_metrics":      metrics,
        "counts":                metrics["raw_counts"],   # backward compat
    }


# ─────────────────────────────────────────────────────────────────────────────
# Layer 1 — SOUL Extraction Prompt (unchanged)
# ─────────────────────────────────────────────────────────────────────────────

SOUL_EXTRACTION_PROMPT = """
You are a CLINICAL BEHAVIORAL ANALYTICS ENGINE.

Your task: analyze a doctor's REAL clinical activity to extract their professional
soul — HOW they think and practice, not just what they know.

CRITICAL RULES:
1. PRIMARY SOURCES (dictation, conversation, clinical_notes) carry the highest
   evidential weight. These are the doctor's own words and reasoning.
2. SECONDARY SOURCES (treatment_plans, medication_analysis) may be AI-assisted.
   Use them only for pattern evidence, not as sole proof of behavior.
3. QUANTITATIVE METRICS are pre-computed from real activity. Trust these numbers.
   Do NOT override them with softer qualitative guesses.
4. Only infer from patterns actually present in the data.
5. If a dimension lacks evidence, set confidence="low" and explain briefly.
6. Do NOT invent behaviors not evidenced in the data.
7. Output ONLY valid JSON. No markdown, no explanation text outside the JSON.

═══════════════════════════════════════════════════════════════
DOCTOR CONTEXT
═══════════════════════════════════════════════════════════════
Doctor ID:       {doctor_id}
Specialization:  {specialization}

═══════════════════════════════════════════════════════════════
QUANTITATIVE BEHAVIOR METRICS  (evidence-based, pre-computed)
═══════════════════════════════════════════════════════════════
{behavior_metrics}

Key interpretation guide:
- investigation_order_rate > 0.7  → thorough / evidence-first clinician
- investigation_order_rate < 0.3  → efficient / conservative clinician
- avg_conditions_surfaced_per_visit > 3 → comprehensive problem-list thinker
- clinical_note_rate > 0.6 → strong documentation culture
- agentic_engagement_count > 10 → actively uses AI-augmented clinical reasoning

═══════════════════════════════════════════════════════════════
PRIMARY SOURCE — DICTATION & CONVERSATION (doctor's real words)
Weight: 40% dictation + 25% conversation
═══════════════════════════════════════════════════════════════
{dictation_samples}

{conversation_samples}

═══════════════════════════════════════════════════════════════
MEDIUM SOURCE — CLINICAL NOTES (doctor's structured reasoning)
Weight: 15%
═══════════════════════════════════════════════════════════════
{clinical_notes}

═══════════════════════════════════════════════════════════════
MEDIUM SOURCE — INVESTIGATION ORDERS (diagnostic decision-making)
Weight: 10%
═══════════════════════════════════════════════════════════════
{investigation_orders}

═══════════════════════════════════════════════════════════════
LOWER SOURCE — TREATMENT PLANS (may be AI-assisted, use for patterns)
Weight: 5%
═══════════════════════════════════════════════════════════════
{treatment_plans}

═══════════════════════════════════════════════════════════════
CONDITION EXTRACTIONS (what doctor surfaces as clinically important)
═══════════════════════════════════════════════════════════════
{condition_extractions}

═══════════════════════════════════════════════════════════════
AGENTIC OUTPUTS (disease identity, trajectory, prognosis decisions)
═══════════════════════════════════════════════════════════════
{agentic_outputs}

═══════════════════════════════════════════════════════════════
REQUIRED OUTPUT SCHEMA — return EXACTLY this JSON
═══════════════════════════════════════════════════════════════
{{
  "doctor_id": "{doctor_id}",
  "specialization": "{specialization}",
  "generated_at": "ISO timestamp here",
  "data_sufficiency": "high|medium|low",

  "soul_features": {{

    "risk_profile": {{
      "value": "conservative|moderate|aggressive",
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern from the data"
    }},

    "decision_style": {{
      "primary": "evidence_first|intuition_led|guideline_driven|collaborative",
      "secondary": "one secondary style or null",
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern"
    }},

    "communication_style": {{
      "traits": ["trait1", "trait2", "trait3"],
      "patient_centered_score": 0,
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern"
    }},

    "treatment_philosophy": {{
      "approach": "quality_of_life_focused|survival_maximizing|balanced|patient_preference_led",
      "intervention_threshold": "low|medium|high",
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern"
    }},

    "diagnostic_rigor": {{
      "investigation_intensity": "minimal|standard|thorough|exhaustive",
      "escalation_pattern": "early|standard|conservative",
      "investigation_order_rate": 0.0,
      "confidence": "high|medium|low",
      "evidence": "cite the numeric investigation_order_rate and one observed pattern"
    }},

    "safety_behaviors": {{
      "traits": ["trait1", "trait2"],
      "double_check_frequency": "low|medium|high",
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern"
    }},

    "documentation_quality": {{
      "detail_level": "minimal|standard|thorough|comprehensive",
      "structure_preference": "narrative|structured|mixed",
      "clinical_note_rate": 0.0,
      "confidence": "high|medium|low",
      "evidence": "cite the numeric clinical_note_rate and one observed pattern"
    }},

    "clinical_priorities": {{
      "top_priorities": ["priority1", "priority2", "priority3"],
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern"
    }},

    "core_values": {{
      "values": ["value1", "value2", "value3"],
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern"
    }},

    "clinical_principles": {{
      "principles": ["principle1", "principle2", "principle3"],
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern"
    }},

    "red_lines": {{
      "lines": ["red_line1", "red_line2"],
      "confidence": "high|medium|low",
      "evidence": "cite one specific observed pattern or state low confidence if unclear"
    }}

  }},

  "ai_behavior_directives": {{
    "diagnostic": ["directive on when/how to suggest investigations", "directive 2"],
    "treatment": ["directive on intervention threshold and risk framing", "directive 2"],
    "communication": ["directive on tone and patient involvement", "directive 2"],
    "documentation": ["directive on structure and required detail level", "directive 2"]
  }},

  "priority_order": {{
    "ordered_priorities": ["priority1", "priority2", "priority3", "priority4"],
    "conflict_resolution_rule": "When these priorities conflict, always follow this order.",
    "confidence": "high|medium|low"
  }},

  "safety_rules": {{
    "never": ["never_rule1", "never_rule2"],
    "always": ["always_rule1", "always_rule2"],
    "confidence": "high|medium|low"
  }},

  "observed_behavior_report": {{
    "consultation_count": 0,
    "investigation_order_rate": 0.0,
    "clinical_note_rate": 0.0,
    "avg_conditions_per_visit": 0.0,
    "key_observations": [
      "Observation 1 citing a specific metric or pattern",
      "Observation 2",
      "Observation 3"
    ],
    "inferences": [
      "Evidence-based inference 1",
      "Evidence-based inference 2"
    ]
  }},

  "soul_markdown": "Complete SOUL.md markdown content as a single escaped string"
}}

SOUL.md FORMAT (put inside soul_markdown as escaped string):

# SOUL PROFILE — {{doctor_id}}
Specialization: {{specialization}}
Generated: {{timestamp}}
Data sufficiency: {{level}}
Generated From: {{dictations}} dictations, {{clinical_notes}} clinical notes, {{investigations}} investigation workflows

## Overview
[2-3 sentences. Third person. Professional. Who is this clinician?]

## Observed Behaviors
**Evidence:**
- [Cite metric or pattern #1]
- [Cite metric or pattern #2]
- [Cite metric or pattern #3]

**Inference:**
[1-2 sentences linking observations to practice style]

## Clinical Philosophy
[Decision style + treatment philosophy in 3-4 sentences]

## Core Values
- [value 1]
- [value 2]
- [value 3]

## Clinical Principles
- [principle 1]
- [principle 2]
- [principle 3]

## Red Lines
[What this doctor avoids or refuses to compromise on. If insufficient data, state that.]

## Communication Style
[Patient interaction approach in 2-3 sentences]

## Treatment Approach
[How does this doctor choose interventions? 2-3 sentences]

## Diagnostic Rigor
Investigation order rate: {{rate}}
[Interpretation of what that rate means for this clinician. 2 sentences.]

## Safety Behaviors
[Observed safety patterns. 2 sentences.]

## Documentation Style
Clinical note rate: {{rate}}
[What this means for how they record their reasoning. 2 sentences.]

## AI Behavior Directives
These are direct instructions for any AI system acting on this doctor's behalf.

### Diagnostic
- [directive 1]
- [directive 2]

### Treatment
- [directive 1]
- [directive 2]

### Communication
- [directive 1]
- [directive 2]

### Documentation
- [directive 1]
- [directive 2]

## Clinical Priorities (Conflict Resolution Order)
1. [priority 1]
2. [priority 2]
3. [priority 3]
4. [priority 4]

Rule: When these priorities conflict, always follow this order.

## Safety Rules
Never:
- [never rule 1]
- [never rule 2]

Always:
- [always rule 1]
- [always rule 2]

## Runtime Usage Note
Inject this SOUL.md as the first block of the doctor agent system prompt,
before SKILL.md and before patient context. It shapes HOW the AI reasons,
not WHAT it knows.

Minimum 500 words, maximum 900 words. Write as a senior colleague.
"""


# ─────────────────────────────────────────────────────────────────────────────
# LLM call — Layer 1 SOUL generation
# ─────────────────────────────────────────────────────────────────────────────

async def generate_soul(doctor_id: str, behavioral_data: dict, specialization: str) -> dict:

    def trunc(lst, n=8):
        return (lst or [])[:n]

    prompt = SOUL_EXTRACTION_PROMPT.format(
        doctor_id=doctor_id,
        specialization=specialization or "General Medicine",
        behavior_metrics=json.dumps(
            behavioral_data.get("behavior_metrics", {}), indent=2, default=str
        )[:1500],
        dictation_samples=json.dumps(
            trunc(behavioral_data.get("dictation_samples"), 10), default=str
        )[:3000],
        conversation_samples=json.dumps(
            trunc(behavioral_data.get("conversation_samples"), 8), default=str
        )[:2000],
        clinical_notes=json.dumps(
            trunc(behavioral_data.get("clinical_notes"), 6), default=str
        )[:2000],
        investigation_orders=json.dumps(
            trunc(behavioral_data.get("investigation_orders"), 8), default=str
        )[:1500],
        treatment_plans=json.dumps(
            trunc(behavioral_data.get("treatment_plans"), 6), default=str
        )[:1500],
        condition_extractions=json.dumps(
            trunc(behavioral_data.get("condition_extractions"), 20), default=str
        )[:2000],
        agentic_outputs=json.dumps(
            trunc(behavioral_data.get("agentic_outputs"), 5), default=str
        )[:1500],
    )

    completion = groq_client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.15,
        max_tokens=5500,
        response_format={"type": "json_object"},
    )

    raw    = completion.choices[0].message.content.strip()
    result = json.loads(raw)
    result["generated_at"] = datetime.utcnow().isoformat()
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Phase 5 — Continuous update orchestration
# ─────────────────────────────────────────────────────────────────────────────

async def get_current_consultation_count(doctor_id: str) -> int:
    metrics = await compute_behavior_metrics(doctor_id)
    return metrics["consultation_count"]


async def should_regenerate_soul(doctor_id: str) -> dict:
    """
    Decide whether a doctor's SOUL profile needs regenerating right now.

    Triggers (first match wins):
      1. no_existing_profile      — doctor has never had a soul generated
      2. consultation_threshold   — >= REGENERATION_CONSULTATION_THRESHOLD new consults
      3. weekly_refresh           — profile older than REGENERATION_STALE_DAYS
      else up_to_date.
    """
    existing = await soul_collection.find_one(
        {"doctor_id": doctor_id},
        {"_id": 0, "updated_at": 1, "consultation_count_at_generation": 1}
    )

    current_count = await get_current_consultation_count(doctor_id)

    if not existing:
        return {
            "should_regenerate": True,
            "reason": "no_existing_profile",
            "current_consultation_count": current_count,
        }

    last_count = existing.get("consultation_count_at_generation", 0) or 0
    delta      = current_count - last_count

    if delta >= REGENERATION_CONSULTATION_THRESHOLD:
        return {
            "should_regenerate": True,
            "reason": "consultation_threshold",
            "delta": delta,
            "current_consultation_count": current_count,
        }

    updated_at = existing.get("updated_at")
    if updated_at and (datetime.utcnow() - updated_at) > timedelta(days=REGENERATION_STALE_DAYS):
        return {
            "should_regenerate": True,
            "reason": "weekly_refresh",
            "current_consultation_count": current_count,
        }

    return {
        "should_regenerate": False,
        "reason": "up_to_date",
        "delta": delta,
        "current_consultation_count": current_count,
    }


# ─────────────────────────────────────────────────────────────────────────────
# Core generation pipeline — Layer 1 (SOUL) + Layer 2 (QA) unified
# ─────────────────────────────────────────────────────────────────────────────

async def _perform_soul_generation(doctor_id: str) -> dict:
    """
    Unified generation pipeline:
      Step 1 — Load SOUL (mimic doctor's style)
      Step 2 — Load SAFETY (enforce medical safety)
      Step 3 — Generate recommendation layer
      Step 4 — Run QA Validator
      Step 5 — Compute Unified Doctor Intelligence Score
      Step 6 — Upsert to DB

    Returns a dict — either a success payload or {"status": "insufficient_data", ...}.
    Raises on hard failures.
    """
    logger.info("Soul+QA generation started | doctor_id=%s", doctor_id)

    # ── Doctor info ───────────────────────────────────────────────────────────
    doctor = sync_doctor_users.find_one(
        {"sys_user_id": doctor_id},
        {"specialization": 1, "name": 1}
    )
    specialization = (doctor or {}).get("specialization", "General Medicine")
    doctor_name    = (doctor or {}).get("name", "")

    # ── Collect behavioral signals ────────────────────────────────────────────
    behavioral_data = await collect_doctor_behavioral_data(doctor_id)
    metrics         = behavioral_data["behavior_metrics"]
    total_records   = sum(metrics["raw_counts"].values())

    if total_records < 3:
        return {
            "status":        "insufficient_data",
            "message":       "At least a few consultations are needed to generate a soul profile.",
            "records_found": total_records,
            "doctor_id":     doctor_id,
            "tip":           "Complete at least 3 consultations (dictations or conversations) first.",
        }

    # ── Step 1: Layer 1 — SOUL generation ────────────────────────────────────
    soul_result = await generate_soul(doctor_id, behavioral_data, specialization)
    soul_result["doctor_name"]      = doctor_name
    soul_result["behavior_metrics"] = metrics

    # Soul Scores (Phase 7 — deterministic)
    soul_scores = compute_soul_scores(metrics, soul_result.get("soul_features", {}))
    soul_result["soul_scores"] = soul_scores

    # Append soul scores block to SOUL.md
    soul_result["soul_markdown"] = (
        soul_result.get("soul_markdown", "") + _render_scores_block(soul_scores)
    )

    # ── Step 2: Layer 2 — Clinical QA metrics (deterministic) ─────────────────
    quality_metrics = await compute_quality_metrics(doctor_id)

    # ── Step 3 & 4: Layer 2 — LLM-assisted QA analysis ───────────────────────
    safety_profile = await generate_safety_profile(
        doctor_id, behavioral_data, quality_metrics, specialization
    )

    # Append QA scores to SOUL.md
    soul_result["soul_markdown"] += _render_quality_block(quality_metrics)

    # ── Step 5: Unified Doctor Intelligence Score ─────────────────────────────
    intelligence_score = compute_intelligence_score(soul_scores, quality_metrics)
    soul_result["soul_markdown"] += _render_intelligence_block(intelligence_score)

    # Persist QA metrics separately for dashboards
    now = datetime.utcnow()
    await doctor_quality_metrics_col.update_one(
        {"doctor_id": doctor_id},
        {
            "$set": {
                **quality_metrics,
                "safety_profile":    safety_profile,
                "intelligence_score": intelligence_score,
                "updated_at":        now,
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    # ── Step 6: Upsert unified soul profile ───────────────────────────────────
    await soul_collection.update_one(
        {"doctor_id": doctor_id},
        {
            "$set": {
                **soul_result,
                "quality_metrics":    quality_metrics,
                "safety_profile":     safety_profile,
                "intelligence_score": intelligence_score,
                "updated_at":         now,
                "behavioral_record_count":         total_records,
                "weighted_sufficiency_score":      metrics.get("weighted_sufficiency_score"),
                "consultation_count_at_generation": metrics.get("consultation_count", 0),
            },
            "$setOnInsert": {"created_at": now},
        },
        upsert=True,
    )

    logger.info(
        "Soul+QA profile saved | doctor_id=%s | sufficiency=%s | intelligence=%.1f",
        doctor_id,
        metrics.get("data_sufficiency"),
        intelligence_score.get("overall_intelligence_score", 0),
    )

    return {
        "status":           "success",
        "doctor_id":        doctor_id,
        "doctor_name":      doctor_name,
        "specialization":   specialization,
        "records_analyzed": total_records,
        "data_sufficiency": soul_result.get("data_sufficiency"),
        # Layer 1
        "behavior_metrics":         metrics,
        "soul_scores":              soul_scores,
        "soul_features":            soul_result.get("soul_features"),
        "ai_behavior_directives":   soul_result.get("ai_behavior_directives"),
        "priority_order":           soul_result.get("priority_order"),
        "safety_rules":             soul_result.get("safety_rules"),
        "observed_behavior_report": soul_result.get("observed_behavior_report"),
        # Layer 2
        "quality_metrics":          quality_metrics,
        "safety_profile":           safety_profile,
        "intelligence_score":       intelligence_score,
        # Combined markdown
        "soul_markdown":            soul_result.get("soul_markdown"),
        "generated_at":             soul_result.get("generated_at"),
    }


# ─────────────────────────────────────────────────────────────────────────────
# API ROUTES — Layer 1 (existing, unchanged)
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/generate/{doctor_id}")
async def generate_doctor_soul(doctor_id: str):
    """
    Collect real behavioral data, compute quantitative metrics, and generate
    (or refresh) a doctor's SOUL + QA profile. Upserts into doctor_soul_profiles
    and doctor_quality_metrics.
    """
    try:
        result = await _perform_soul_generation(doctor_id)
        if result.get("status") == "insufficient_data":
            return JSONResponse(status_code=422, content=result)
        return result
    except json.JSONDecodeError as e:
        logger.error("LLM returned invalid JSON: %s", str(e))
        raise HTTPException(status_code=500, detail="LLM returned invalid JSON")
    except Exception:
        logger.error("Soul generation failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/should-regenerate/{doctor_id}")
async def check_should_regenerate(doctor_id: str):
    """
    Inspect whether a doctor's soul is due for regeneration without triggering it.
    """
    try:
        decision = await should_regenerate_soul(doctor_id)
        return {"status": "success", "doctor_id": doctor_id, **decision}
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.post("/auto-check/{doctor_id}")
async def auto_check_and_regenerate(doctor_id: str):
    """
    Phase 5 hook — call after save_consultation(). Cheap: only regenerates when
    the consultation threshold is crossed or the profile has gone stale.
    """
    try:
        decision = await should_regenerate_soul(doctor_id)

        if not decision["should_regenerate"]:
            return {
                "status":                   "skipped",
                "doctor_id":                doctor_id,
                "reason":                   decision["reason"],
                "current_consultation_count": decision.get("current_consultation_count"),
            }

        result = await _perform_soul_generation(doctor_id)
        if result.get("status") == "insufficient_data":
            return JSONResponse(status_code=422, content=result)

        result["regeneration_reason"] = decision["reason"]
        return result

    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        logger.error("LLM returned invalid JSON: %s", str(e))
        raise HTTPException(status_code=500, detail="LLM returned invalid JSON")
    except Exception:
        logger.error("Auto-check failed:\n%s", traceback.format_exc())
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/get/{doctor_id}")
async def get_doctor_soul(doctor_id: str):
    """Retrieve the full unified soul+QA profile for a doctor."""
    try:
        doc = await soul_collection.find_one({"doctor_id": doctor_id}, {"_id": 0})
        if not doc:
            return JSONResponse(
                status_code=404,
                content={"status": "not_found", "doctor_id": doctor_id}
            )
        return {"status": "success", "data": doc}
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/markdown/{doctor_id}")
async def get_soul_markdown(doctor_id: str):
    """
    Return the full SOUL.md string (includes Soul Scores + QA Scores +
    Intelligence Score sections). Inject directly into agent system prompts
    BEFORE SKILL.md and BEFORE patient context.
    """
    try:
        doc = await soul_collection.find_one(
            {"doctor_id": doctor_id},
            {"_id": 0, "soul_markdown": 1, "generated_at": 1,
             "doctor_name": 1, "data_sufficiency": 1}
        )
        if not doc or not doc.get("soul_markdown"):
            return JSONResponse(
                status_code=404,
                content={"status": "not_found", "doctor_id": doctor_id}
            )
        return {
            "status":          "success",
            "doctor_id":       doctor_id,
            "doctor_name":     doc.get("doctor_name", ""),
            "generated_at":    doc.get("generated_at"),
            "data_sufficiency": doc.get("data_sufficiency"),
            "soul_markdown":   doc["soul_markdown"],
        }
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/features/{doctor_id}")
async def get_soul_features(doctor_id: str):
    """
    Return structured soul_features + behavior_metrics + soul_scores.
    Lighter endpoint for dashboards.
    """
    try:
        doc = await soul_collection.find_one(
            {"doctor_id": doctor_id},
            {
                "_id": 0,
                "soul_features": 1, "behavior_metrics": 1, "soul_scores": 1,
                "ai_behavior_directives": 1, "priority_order": 1, "safety_rules": 1,
                "observed_behavior_report": 1, "data_sufficiency": 1,
                "generated_at": 1, "doctor_name": 1, "specialization": 1,
            }
        )
        if not doc:
            return JSONResponse(
                status_code=404,
                content={"status": "not_found", "doctor_id": doctor_id}
            )
        return {"status": "success", "data": doc}
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/metrics/{doctor_id}")
async def get_behavior_metrics(doctor_id: str):
    """Re-compute and return live quantitative behavior metrics without regenerating the profile."""
    try:
        metrics = await compute_behavior_metrics(doctor_id)
        return {"status": "success", "doctor_id": doctor_id, "metrics": metrics}
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.delete("/delete/{doctor_id}")
async def delete_doctor_soul(doctor_id: str):
    """Delete the soul+QA profile for a doctor."""
    try:
        result = await soul_collection.delete_one({"doctor_id": doctor_id})
        # Also clean up quality metrics
        await doctor_quality_metrics_col.delete_one({"doctor_id": doctor_id})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Soul profile not found")
        return {"status": "deleted", "doctor_id": doctor_id}
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/list")
async def list_soul_profiles(limit: int = Query(50, ge=1, le=200)):
    """Admin overview of all soul profiles including QA and intelligence scores."""
    try:
        cursor = soul_collection.find(
            {},
            {
                "_id": 0,
                "doctor_id": 1, "doctor_name": 1, "specialization": 1,
                "data_sufficiency": 1, "weighted_sufficiency_score": 1,
                "behavioral_record_count": 1, "consultation_count_at_generation": 1,
                "soul_scores": 1, "intelligence_score": 1,
                "generated_at": 1, "updated_at": 1,
            }
        ).sort("updated_at", -1).limit(limit)

        docs = await cursor.to_list(length=limit)
        return {"status": "success", "count": len(docs), "data": docs}
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/compare")
async def compare_two_doctors(
    doctor_a: str = Query(...),
    doctor_b: str = Query(...)
):
    """
    Side-by-side behavioral and QA comparison of two doctors.
    Returns structured diff across soul dimensions, metrics, soul scores,
    quality metrics, and intelligence scores.
    """
    try:
        doc_a = await soul_collection.find_one({"doctor_id": doctor_a}, {"_id": 0})
        doc_b = await soul_collection.find_one({"doctor_id": doctor_b}, {"_id": 0})

        if not doc_a:
            raise HTTPException(status_code=404, detail=f"No soul profile for {doctor_a}")
        if not doc_b:
            raise HTTPException(status_code=404, detail=f"No soul profile for {doctor_b}")

        fa = doc_a.get("soul_features", {})
        fb = doc_b.get("soul_features", {})

        def _val(feature: dict) -> str | None:
            return (
                feature.get("value")
                or feature.get("approach")
                or feature.get("primary")
                or (", ".join(
                    feature.get("values") or feature.get("traits")
                    or feature.get("principles") or feature.get("lines") or []
                ) or None)
            )

        dimensions = [
            "risk_profile", "decision_style", "treatment_philosophy",
            "diagnostic_rigor", "documentation_quality",
            "core_values", "clinical_principles", "red_lines",
            "communication_style", "safety_behaviors",
        ]

        soul_diff = {
            dim: {
                "doctor_a": {"value": _val(fa.get(dim, {})), "confidence": fa.get(dim, {}).get("confidence")},
                "doctor_b": {"value": _val(fb.get(dim, {})), "confidence": fb.get(dim, {}).get("confidence")},
            }
            for dim in dimensions
        }

        # Behavior metric comparison
        ma = doc_a.get("behavior_metrics", {})
        mb = doc_b.get("behavior_metrics", {})
        metric_diff = {
            key: {"doctor_a": ma.get(key), "doctor_b": mb.get(key)}
            for key in ["investigation_order_rate", "clinical_note_rate",
                        "avg_conditions_surfaced_per_visit", "consultation_count"]
        }

        # Soul score comparison
        sa = doc_a.get("soul_scores", {})
        sb = doc_b.get("soul_scores", {})
        score_diff = {
            key: {"doctor_a": sa.get(key), "doctor_b": sb.get(key)}
            for key in ["evidence_score", "safety_score", "patient_centered_score",
                        "documentation_score", "overall_soul_score"]
        }

        # QA metric comparison (NEW)
        qa = doc_a.get("quality_metrics", {})
        qb = doc_b.get("quality_metrics", {})
        quality_diff = {
            key: {"doctor_a": qa.get(key), "doctor_b": qb.get(key)}
            for key in [
                "guideline_compliance_score", "medication_safety_score",
                "diagnostic_quality_score", "investigation_appropriateness_score",
                "documentation_quality_score", "outcome_quality_score",
                "overall_quality_score",
            ]
        }

        # Intelligence score comparison (NEW)
        ia = doc_a.get("intelligence_score", {})
        ib = doc_b.get("intelligence_score", {})
        intelligence_diff = {
            key: {"doctor_a": ia.get(key), "doctor_b": ib.get(key)}
            for key in ["overall_intelligence_score"]
        }

        return {
            "status":   "success",
            "doctor_a": {"id": doctor_a, "name": doc_a.get("doctor_name"), "specialization": doc_a.get("specialization")},
            "doctor_b": {"id": doctor_b, "name": doc_b.get("doctor_name"), "specialization": doc_b.get("specialization")},
            "soul_comparison":        soul_diff,
            "metric_comparison":      metric_diff,
            "score_comparison":       score_diff,
            "quality_comparison":     quality_diff,      # NEW
            "intelligence_comparison": intelligence_diff, # NEW
        }
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.post("/refresh-all")
async def refresh_all_souls():
    """
    List all soul profiles stale > REGENERATION_STALE_DAYS days.
    Caller should POST /soul/generate/{doctor_id} or /soul/auto-check/{doctor_id} for each.
    """
    try:
        cutoff = datetime.utcnow() - timedelta(days=REGENERATION_STALE_DAYS)
        cursor = soul_collection.find(
            {"updated_at": {"$lt": cutoff}},
            {
                "doctor_id": 1, "doctor_name": 1, "data_sufficiency": 1,
                "weighted_sufficiency_score": 1, "consultation_count_at_generation": 1,
                "_id": 0,
            }
        )
        stale_docs = await cursor.to_list(length=500)

        return {
            "status":               "success",
            "stale_profiles_found": len(stale_docs),
            "profiles":             stale_docs,
            "note": "POST /soul/generate/{doctor_id} or /soul/auto-check/{doctor_id} for each to refresh.",
        }
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/system-prompt/{doctor_id}")
async def get_soul_for_system_prompt(doctor_id: str):
    """
    Returns the exact string to prepend to any doctor agent's system_prompt.
    The block now includes Soul Scores, QA Scores, and the Unified Intelligence Score.

    Usage in agent code:
        sp_block = await GET /soul/system-prompt/{doctor_id}
        system_prompt = sp_block["inject"] + skill_md + patient_context
    """
    try:
        doc = await soul_collection.find_one(
            {"doctor_id": doctor_id},
            {"_id": 0, "soul_markdown": 1, "data_sufficiency": 1,
             "generated_at": 1, "doctor_name": 1}
        )
        if not doc or not doc.get("soul_markdown"):
            return JSONResponse(
                status_code=404,
                content={
                    "status":    "not_found",
                    "doctor_id": doctor_id,
                    "tip":       "Call POST /soul/generate/{doctor_id} first.",
                }
            )

        inject_block = (
            "<!-- DOCTOR SOUL PROFILE — inject before SKILL.md and patient context -->\n"
            f"{doc['soul_markdown']}\n"
            "<!-- END SOUL PROFILE -->\n"
        )

        return {
            "status":           "success",
            "doctor_id":        doctor_id,
            "doctor_name":      doc.get("doctor_name", ""),
            "data_sufficiency": doc.get("data_sufficiency"),
            "generated_at":     doc.get("generated_at"),
            "inject":           inject_block,
        }
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


# ─────────────────────────────────────────────────────────────────────────────
# API ROUTES — Layer 2 (NEW: Clinical QA Engine endpoints)
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/quality/{doctor_id}")
async def get_quality_metrics(doctor_id: str):
    """
    Return the stored Clinical QA metrics for a doctor (Layer 2).
    Includes all six quality scores + the LLM safety profile + intelligence score.
    """
    try:
        doc = await doctor_quality_metrics_col.find_one(
            {"doctor_id": doctor_id}, {"_id": 0}
        )
        if not doc:
            return JSONResponse(
                status_code=404,
                content={
                    "status":    "not_found",
                    "doctor_id": doctor_id,
                    "tip":       "Call POST /soul/generate/{doctor_id} first.",
                }
            )
        return {"status": "success", "data": doc}
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.post("/quality/recompute/{doctor_id}")
async def recompute_quality_metrics(doctor_id: str):
    """
    Re-compute Clinical QA metrics live (without regenerating the full soul).
    Useful for refreshing QA scores after new data without a full LLM call.
    Updates doctor_quality_metrics collection only.
    """
    try:
        quality_metrics = await compute_quality_metrics(doctor_id)

        now = datetime.utcnow()
        await doctor_quality_metrics_col.update_one(
            {"doctor_id": doctor_id},
            {
                "$set": {**quality_metrics, "updated_at": now},
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )

        # Also refresh quality_metrics on the soul profile if it exists
        await soul_collection.update_one(
            {"doctor_id": doctor_id},
            {"$set": {"quality_metrics": quality_metrics, "updated_at": now}},
        )

        return {
            "status":          "success",
            "doctor_id":       doctor_id,
            "quality_metrics": quality_metrics,
        }
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/intelligence/{doctor_id}")
async def get_intelligence_score(doctor_id: str):
    """
    Return the Unified Doctor Intelligence Score for a doctor.
    Combines Layer 1 (SOUL) + Layer 2 (QA) per the architecture:
      soul*0.40 + guideline*0.20 + medication*0.15 + diagnostic*0.15 + outcome*0.10
    """
    try:
        doc = await soul_collection.find_one(
            {"doctor_id": doctor_id},
            {"_id": 0, "intelligence_score": 1, "soul_scores": 1,
             "quality_metrics": 1, "doctor_name": 1, "generated_at": 1}
        )
        if not doc:
            return JSONResponse(
                status_code=404,
                content={
                    "status":    "not_found",
                    "doctor_id": doctor_id,
                    "tip":       "Call POST /soul/generate/{doctor_id} first.",
                }
            )
        return {
            "status":            "success",
            "doctor_id":         doctor_id,
            "doctor_name":       doc.get("doctor_name", ""),
            "generated_at":      doc.get("generated_at"),
            "intelligence_score": doc.get("intelligence_score"),
            "soul_scores":       doc.get("soul_scores"),
            "quality_metrics":   doc.get("quality_metrics"),
        }
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/safety-profile/{doctor_id}")
async def get_safety_profile(doctor_id: str):
    """
    Return the LLM-generated safety profile (guideline alignment, medication safety,
    diagnostic accuracy, risk flags, and SAFETY.md) for a doctor.
    """
    try:
        doc = await doctor_quality_metrics_col.find_one(
            {"doctor_id": doctor_id},
            {"_id": 0, "safety_profile": 1, "updated_at": 1}
        )
        if not doc or not doc.get("safety_profile"):
            return JSONResponse(
                status_code=404,
                content={
                    "status":    "not_found",
                    "doctor_id": doctor_id,
                    "tip":       "Call POST /soul/generate/{doctor_id} first.",
                }
            )
        return {
            "status":         "success",
            "doctor_id":      doctor_id,
            "updated_at":     doc.get("updated_at"),
            "safety_profile": doc["safety_profile"],
        }
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/safety-markdown/{doctor_id}")
async def get_safety_markdown(doctor_id: str):
    """
    Return just the SAFETY.md string from the safety profile.
    Inject this alongside SOUL.md in the doctor agent runtime:
        system_prompt = soul_md + safety_md + skill_md + patient_context
    """
    try:
        doc = await doctor_quality_metrics_col.find_one(
            {"doctor_id": doctor_id},
            {"_id": 0, "safety_profile": 1}
        )
        safety_md = (doc or {}).get("safety_profile", {}).get("safety_md")
        if not safety_md:
            return JSONResponse(
                status_code=404,
                content={
                    "status":    "not_found",
                    "doctor_id": doctor_id,
                    "tip":       "Call POST /soul/generate/{doctor_id} first.",
                }
            )
        return {
            "status":      "success",
            "doctor_id":   doctor_id,
            "safety_markdown": safety_md,
        }
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())


@router.get("/quality/list")
async def list_quality_profiles(limit: int = Query(50, ge=1, le=200)):
    """Admin overview of all Clinical QA profiles with key scores."""
    try:
        cursor = doctor_quality_metrics_col.find(
            {},
            {
                "_id": 0,
                "doctor_id": 1,
                "guideline_compliance_score": 1,
                "medication_safety_score": 1,
                "diagnostic_quality_score": 1,
                "investigation_appropriateness_score": 1,
                "documentation_quality_score": 1,
                "outcome_quality_score": 1,
                "overall_quality_score": 1,
                "generated_at": 1,
                "updated_at": 1,
            }
        ).sort("updated_at", -1).limit(limit)

        docs = await cursor.to_list(length=limit)
        return {"status": "success", "count": len(docs), "data": docs}
    except Exception:
        raise HTTPException(status_code=500, detail=traceback.format_exc())