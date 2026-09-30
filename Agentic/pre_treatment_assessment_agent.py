# ============================================================
# pre_treatment_assessment_agent.py
#
# SPECIALTY-DOMINANT VERSION
# ------------------------------------------------------------
# What changed compared with the previous version:
#
#  1. NEW: Specialty Scope Resolver (resolve_specialty_scope)
#     Runs once, before planning. Compares the requesting
#     clinician's specialty skill with the disease / treatment /
#     facility skills and the retrieved patient context, and
#     decides which domains and skills are IN SCOPE.
#     Example: medical oncology -> chemotherapy / systemic
#     therapy skill is primary, radiation skill is excluded.
#     Nothing is hardcoded: the decision is made by reasoning
#     over the skill definitions, not over specialty names.
#
#  2. NEW: prune_expertise_context
#     Excluded skills are physically removed from
#     expertise_context, so no downstream agent ever sees them.
#     In-scope treatment skills are ordered first.
#
#  3. NEW: specialty_scope is injected into EVERY agent prompt
#     (SPECIALTY_SCOPE_RULE) and into every payload.
#
#  4. NEW: Scope Guard pass (apply_scope_guard) removes any
#     out-of-scope item from BOTH previsit_insights and
#     assessment_points before verification.
#
#  5. NEW: Python-level enforcement in build_final_assessment
#     (drops cross_domain points and points flagged
#     in_specialty_scope == False when strict mode is on).
#
#  6. Removed duplicated function definitions (the file used to
#     define reconcile / candidate / select / generate / verify /
#     build_final / run_harness twice; the LATER copy silently
#     won, which dropped the visit_context handling).
#
#  7. Fixed invalid JSON examples in some agent prompts.
#
# Toggle:  PRETREATMENT_STRICT_SPECIALTY_SCOPE=true|false
# ============================================================

import os
import json
import re
from typing import Dict, Any, List, Optional

from datetime import datetime, timezone

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage

from loguru import logger
from dotenv import load_dotenv

from Agentic.clinical_expertise_skills import (
    build_expertise_context,
    render_expertise_instructions,
)


# ============================================================
# ENVIRONMENT
# ============================================================

load_dotenv()

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = os.getenv("PRETREATMENT_MODEL", "openai/gpt-oss-120b")
AGENT_MAX_TOKENS = int(os.getenv("PRETREATMENT_AGENT_MAX_TOKENS", "8000"))

MAX_ASSESSMENT_TASKS = int(os.getenv("PRETREATMENT_MAX_ASSESSMENT_TASKS", "25"))
MAX_FINAL_ASSESSMENT_POINTS = 5

# When True, information belonging to another specialty's domain is
# removed from the assessment points AND from Previsit Insights.
STRICT_SPECIALTY_SCOPE = os.getenv(
    "PRETREATMENT_STRICT_SPECIALTY_SCOPE", "true"
).strip().lower() in {"1", "true", "yes", "on"}

VALID_EVIDENCE_STATUS = {
    "DOCUMENTED",
    "PARTIALLY_DOCUMENTED",
    "CONFLICTING",
    "NOT_DOCUMENTED",
}

VALID_RELEVANCE = {"primary", "cross_domain", "contextual"}

VALID_CARE_STATES = {
    "pre_treatment",
    "treatment_in_progress",
    "post_treatment",
    "surveillance",
    "unknown",
}


# ============================================================
# LLM
# ============================================================

llm = ChatGroq(
    model=GROQ_MODEL,
    groq_api_key=GROQ_API_KEY,
    max_tokens=AGENT_MAX_TOKENS,
    temperature=0.1,
)


async def invoke_agent(
    system_prompt: str,
    user_prompt: str,
    max_tokens: Optional[int] = None,
) -> str:
    """Generic LLM invocation. Returns raw text."""

    call_llm = llm.bind(max_tokens=max_tokens) if max_tokens else llm

    response = await call_llm.ainvoke(
        [
            SystemMessage(content=system_prompt),
            HumanMessage(content=user_prompt),
        ]
    )

    content = response.content

    if isinstance(content, list):
        content = "\n".join(str(item) for item in content)

    return str(content)


# ============================================================
# JSON HELPERS
# ============================================================

def extract_json(text: str) -> Optional[Any]:
    """Extract JSON from pure JSON, fenced JSON, or JSON embedded in text."""

    if not text:
        return None

    text = text.strip()

    try:
        return json.loads(text)
    except Exception:
        pass

    fenced = re.search(
        r"```(?:json)?\s*(.*?)\s*```", text, re.DOTALL | re.IGNORECASE
    )
    if fenced:
        try:
            return json.loads(fenced.group(1))
        except Exception:
            pass

    for open_ch, close_ch in (("{", "}"), ("[", "]")):
        start = text.find(open_ch)
        end = text.rfind(close_ch)
        if start >= 0 and end > start:
            try:
                return json.loads(text[start:end + 1])
            except Exception:
                pass

    return None


def safe_json(value: Any) -> Any:
    try:
        return json.loads(json.dumps(value, default=str))
    except Exception:
        return str(value)


def _s(value: Any) -> str:
    """Safe string: None -> ''."""
    if value is None:
        return ""
    return str(value).strip()


# ============================================================
# SOURCE HIERARCHY RULE (shared by every agent)
# ============================================================

CONTEXT_COMPLETENESS_RULE = """
SOURCE PRESERVATION AND EVIDENCE AUTHORITY CONTRACT

SOURCE HIERARCHY (higher never overridden by lower):
1. authoritative_sources
2. secondary_graph_context
3. current Harness agent reasoning
4. generated assessment points

AUTHORITATIVE SOURCES: highest-priority patient evidence for this run.
Preserve values, units, dates, statuses, identifiers, treatment/exposure
values, route, frequency, timing and duration EXACTLY. Never replace them
with graph summaries or generated reasoning.

SECONDARY GRAPH CONTEXT: contextual; may be summarized or synthesized.
It never overrides an authoritative source. A patient value that exists
only here is graph-supplied context, not independently confirmed evidence.

GENERATED REASONING: never independent patient evidence. It must not
create a patient fact, change a documented value, turn a value into
missing/pending, convert a documented dose into a calculated dose, create
a clinical decision, or create a guideline claim without supplied evidence.

MISSING INFORMATION: absence from one layer does not prove absence from
the record. If absent from all supplied layers write
"not documented in the supplied context". Never claim the patient does not
have something unless a source explicitly says so.

NUMERICAL FIDELITY: do not calculate, convert, normalize, round or
reinterpret source values. A derived value never replaces a source value.

SOURCE CONFLICT: do not guess and do not use clinical convention, disease,
specialty, medication, treatment or keywords. Higher precedence controls.
Same-level conflicts that cannot be resolved are preserved as conflicts.

DECISION FIDELITY - never convert:
documented finding -> clinical decision
clinical consideration -> treatment decision
risk factor -> contraindication
missing information -> guessed value
documented treatment -> calculated treatment
generated reasoning -> verified patient fact

UNIVERSALITY: no hardcoded disease, cancer, treatment, drug-dosing,
keyword-to-decision or threshold rules.

EXPERTISE SKILLS are reasoning lenses, NOT patient evidence. They define
which dimensions deserve inspection. They must not create patient facts,
override patient data, prescribe, calculate doses, infer undocumented
diagnoses/stages/responses/toxicities/treatments, or turn a facility
capability into a claim that the patient received it. If a skill dimension
has no patient evidence, report "not documented in the supplied context";
never fill it from the skill definition.
"""


# ============================================================
# SPECIALTY SCOPE RULE (NEW) - injected into every agent
# ============================================================

SPECIALTY_SCOPE_RULE_STRICT = """
SPECIALTY DOMINANCE - STRICT SCOPE MODE (ACTIVE)

The payload contains "specialty_scope". It states which clinical domains,
treatment modalities and skills are IN SCOPE for the requesting clinician's
specialty, and which are OUT OF SCOPE.

Rules:
1. Analyze, report and assess ONLY information belonging to the in-scope
   domains. The requesting clinician's specialty skill is the dominant lens.
2. Information that belongs to an out-of-scope domain (for example data
   generated by another specialty's treatment modality) must NOT produce
   findings, tasks, candidates, assessment points, alerts, stat cards,
   toxicity items, changes, next-best-action text, ePRO items or
   collapsed-parameter counts. Do not mention it at all, even if it is
   richly documented and even if it is chronologically earlier.
3. Volume of documentation, chronology and the previous clinician's
   specialty never move a domain into scope.
4. The ONLY exception: the requesting clinician's specialty skill itself
   lists that relationship/dimension as something to inspect. Then include
   only the part that the skill names, tagged relevance "contextual".
5. Scope is decided from the supplied skill definitions and the data, NOT
   from specialty names, disease names, treatment names or keywords.
6. Skills flagged as primary in specialty_scope receive the deepest
   inspection. Excluded skills are not available to you.
7. If the in-scope evidence is thin, return fewer items. Never pad with
   out-of-scope material.
"""

SPECIALTY_SCOPE_RULE_SOFT = """
SPECIALTY DOMINANCE - SOFT SCOPE MODE

The payload contains "specialty_scope". Prioritize in-scope domains.
Cross-domain information may appear only when it materially affects the
requesting clinician's assessment, and it must rank below in-scope
information and be labelled relevance "cross_domain".
"""


def scope_rule() -> str:
    return (
        SPECIALTY_SCOPE_RULE_STRICT
        if STRICT_SPECIALTY_SCOPE
        else SPECIALTY_SCOPE_RULE_SOFT
    )


# ============================================================
# SPECIALTY SCOPE RESOLVER (NEW)
# ============================================================

SPECIALTY_SCOPE_RESOLVER_PROMPT = """
You are the Specialty Scope Resolver.

Decide, for THIS run, what is in scope for the requesting clinician.

You receive:
- the requesting clinician's specialty skill (dominant lens)
- every resolved disease, treatment/modality and facility skill
  (each with an id)
- the retrieved patient context (authoritative + secondary)

Method:
1. Read the specialty skill: its perspective, focus, questions, clinical
   domains, inspect dimensions and relationships. This defines the
   clinician's domain of practice.
2. Read each treatment/modality skill. Decide whether the modality it
   describes belongs to the clinician's domain of practice (as defined by
   the specialty skill) or to a different clinical domain.
   - belongs to the clinician's domain          -> primary
   - helps interpret the clinician's domain
     and the specialty skill names that link    -> supporting
   - belongs to another domain                  -> excluded
3. Do the same for facility skills (keep only those that support in-scope
   modalities) and disease skills (normally kept as supporting lenses; 
   exclude only a disease skill that has no bearing on the clinician's
   domain).
4. Inspect the patient context and describe, in plain words, which
   documented data belongs to the in-scope domains and which documented
   data belongs to out-of-scope domains.

Hard rules:
- Decide from the skill definitions and the patient data. Do NOT use
  specialty-name, disease-name, treatment-name or keyword lookup tables.
- Only return skill ids that were supplied. Never invent ids.
- Do not exclude a skill merely because the patient has little data for it
  and do not include a skill merely because the patient has a lot of data
  for it.
- Do not create patient facts.

Return JSON only:

{
  "agent": "specialty_scope",
  "specialty_perspective": "",
  "in_scope_domains": [],
  "out_of_scope_domains": [],
  "primary_treatment_skill_ids": [],
  "supporting_treatment_skill_ids": [],
  "excluded_treatment_skill_ids": [],
  "kept_disease_skill_ids": [],
  "excluded_disease_skill_ids": [],
  "kept_facility_skill_ids": [],
  "excluded_facility_skill_ids": [],
  "in_scope_data_description": [],
  "out_of_scope_data_description": [],
  "scope_rationale": ""
}
"""


def _skill_id(skill: Any) -> Optional[str]:
    """Tolerant skill-id getter (schema of skills is owned by the skills module)."""
    if isinstance(skill, dict):
        for key in ("skill_id", "id", "key", "name"):
            if skill.get(key):
                return str(skill[key])
    elif isinstance(skill, str):
        return skill
    return None


def _id_list(value: Any) -> List[str]:
    if not isinstance(value, list):
        return []
    return [str(v) for v in value if v is not None]


def default_specialty_scope(reason: str = "") -> Dict[str, Any]:
    return {
        "agent": "specialty_scope",
        "status": "unresolved",
        "specialty_perspective": "",
        "in_scope_domains": [],
        "out_of_scope_domains": [],
        "primary_treatment_skill_ids": [],
        "supporting_treatment_skill_ids": [],
        "excluded_treatment_skill_ids": [],
        "kept_disease_skill_ids": [],
        "excluded_disease_skill_ids": [],
        "kept_facility_skill_ids": [],
        "excluded_facility_skill_ids": [],
        "in_scope_data_description": [],
        "out_of_scope_data_description": [],
        "scope_rationale": reason
        or "Scope could not be resolved; the specialty skill remains the dominant lens.",
    }


async def resolve_specialty_scope(
    clinical_context: Dict[str, Any],
    expertise_context: Dict[str, Any],
) -> Dict[str, Any]:
    """LLM reasoning over skill definitions + patient data. No keyword rules."""

    payload = {
        "doctor_context": safe_json(clinical_context.get("doctor_context", {})),
        "specialty_skill": safe_json(expertise_context.get("specialty_skill", {})),
        "disease_skills": safe_json(expertise_context.get("disease_skills", [])),
        "treatment_skills": safe_json(expertise_context.get("treatment_skills", [])),
        "facility_skills": safe_json(expertise_context.get("facility_skills", [])),
        "authoritative_sources": safe_json(
            clinical_context.get("authoritative_sources", {})
        ),
        "secondary_graph_context": safe_json(
            clinical_context.get("secondary_graph_context", {})
        ),
    }

    try:
        response = await invoke_agent(
            system_prompt=SPECIALTY_SCOPE_RESOLVER_PROMPT,
            user_prompt=json.dumps(payload, indent=2, default=str),
        )
    except Exception as exc:
        logger.error(f"[PreTreatment Scope] Resolver call failed: {exc}")
        return default_specialty_scope("Scope resolver call failed.")

    parsed = extract_json(response)

    if not isinstance(parsed, dict):
        logger.warning("[PreTreatment Scope] Resolver returned invalid JSON")
        return default_specialty_scope("Scope resolver returned invalid output.")

    scope = default_specialty_scope()
    scope["status"] = "resolved"

    for key in scope:
        if key in parsed and key != "status":
            scope[key] = safe_json(parsed[key])

    # Keep list-typed fields as lists
    for key in (
        "in_scope_domains",
        "out_of_scope_domains",
        "in_scope_data_description",
        "out_of_scope_data_description",
    ):

    
        if not isinstance(scope.get(key), list):
            scope[key] = []

    for key in (
        "primary_treatment_skill_ids",
        "supporting_treatment_skill_ids",
        "excluded_treatment_skill_ids",
        "kept_disease_skill_ids",
        "excluded_disease_skill_ids",
        "kept_facility_skill_ids",
        "excluded_facility_skill_ids",
    ):
        scope[key] = _id_list(scope.get(key))

    return scope


def _filter_skill_list(
    skills: Any,
    excluded_ids: set,
) -> List[Any]:
    if not isinstance(skills, list):
        return []
    return [s for s in skills if _skill_id(s) not in excluded_ids]


def prune_expertise_context(
    expertise_context: Dict[str, Any],
    scope: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Physically remove excluded skills so downstream agents never see them,
    and put primary treatment skills first.

    Safety: only ids that actually exist are honoured. If the resolver
    failed, the context is returned unchanged.
    """

    ctx = safe_json(expertise_context)

    if not isinstance(ctx, dict) or scope.get("status") != "resolved":
        return ctx

    def existing_ids(key: str) -> set:
        return {_skill_id(s) for s in ctx.get(key, []) if _skill_id(s)}

    excl_treat = set(scope["excluded_treatment_skill_ids"]) & existing_ids(
        "treatment_skills"
    )
    excl_dis = set(scope["excluded_disease_skill_ids"]) & existing_ids(
        "disease_skills"
    )
    excl_fac = set(scope["excluded_facility_skill_ids"]) & existing_ids(
        "facility_skills"
    )

    ctx["treatment_skills"] = _filter_skill_list(
        ctx.get("treatment_skills", []), excl_treat
    )
    ctx["disease_skills"] = _filter_skill_list(
        ctx.get("disease_skills", []), excl_dis
    )
    ctx["facility_skills"] = _filter_skill_list(
        ctx.get("facility_skills", []), excl_fac
    )

    # Primary treatment skills first (deepest inspection / emphasis)
    primary = list(scope.get("primary_treatment_skill_ids", []))

    def treat_rank(skill: Any) -> int:
        sid = _skill_id(skill)
        return primary.index(sid) if sid in primary else len(primary) + 1

    ctx["treatment_skills"] = sorted(ctx["treatment_skills"], key=treat_rank)

    resolved = ctx.get("resolved_skill_ids")
    if isinstance(resolved, dict):
        for key, excluded in (
            ("treatment_skill_ids", excl_treat),
            ("disease_skill_ids", excl_dis),
            ("facility_skill_ids", excl_fac),
        ):
            if isinstance(resolved.get(key), list):
                resolved[key] = [
                    i for i in resolved[key] if str(i) not in excluded
                ]

    ctx["primary_treatment_skill_ids"] = primary
    ctx["scope_pruned"] = True

    logger.info(
        "[PreTreatment Scope] Expertise pruned | "
        f"excluded_treatment={sorted(excl_treat)} | "
        f"excluded_disease={sorted(excl_dis)} | "
        f"excluded_facility={sorted(excl_fac)} | "
        f"primary_treatment={primary}"
    )

    return ctx


async def prepare_scoped_context(
    clinical_context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Idempotent. Resolves expertise, resolves specialty scope, prunes
    expertise, and stores both on the context.
    """

    ctx = dict(clinical_context)

    expertise_context = ctx.get("expertise_context")
    if not isinstance(expertise_context, dict):
        expertise_context = build_expertise_context(ctx)

    if isinstance(ctx.get("specialty_scope"), dict) and expertise_context.get(
        "scope_pruned"
    ):
        ctx["expertise_context"] = expertise_context
        return ctx

    scope = await resolve_specialty_scope(ctx, expertise_context)
    pruned = prune_expertise_context(expertise_context, scope)

    ctx["expertise_context"] = pruned
    ctx["specialty_scope"] = scope
    ctx["strict_specialty_scope"] = STRICT_SPECIALTY_SCOPE

    resolved_ids = (pruned.get("resolved_skill_ids") or {})
    logger.info(
        "[PreTreatment Scope] Scope ready | "
        f"strict={STRICT_SPECIALTY_SCOPE} | "
        f"status={scope.get('status')} | "
        f"specialty={pruned.get('doctor_specialty')} | "
        f"specialty_skill_id={resolved_ids.get('specialty_skill_id')} | "
        f"treatment={resolved_ids.get('treatment_skill_ids', [])} | "
        f"in_scope_domains={scope.get('in_scope_domains')} | "
        f"out_of_scope_domains={scope.get('out_of_scope_domains')}"
    )

    return ctx


# ============================================================
# SYSTEM PROMPT BUILDER (NEW - single place)
# ============================================================

def build_system_prompt(
    agent_prompt: str,
    expertise_context: Dict[str, Any],
) -> str:
    return (
        f"{CONTEXT_COMPLETENESS_RULE}\n\n"
        f"{scope_rule()}\n\n"
        f"{render_expertise_instructions(expertise_context)}\n\n"
        f"{agent_prompt}"
    )


def get_expertise(clinical_context: Dict[str, Any]) -> Dict[str, Any]:
    expertise = clinical_context.get("expertise_context")
    if not isinstance(expertise, dict):
        expertise = build_expertise_context(clinical_context)
    return expertise


def get_scope(clinical_context: Dict[str, Any]) -> Dict[str, Any]:
    scope = clinical_context.get("specialty_scope")
    return scope if isinstance(scope, dict) else default_specialty_scope()


# ============================================================
# AGENT PROMPTS
# ============================================================

CLINICAL_PLANNING_AGENT_PROMPT = """
You are the Clinical Assessment Planning Agent in a generic clinical
assessment workflow (any patient, condition, treatment context, clinician).

Determine case-by-case what assessment work is required.

The requesting clinician's specialty skill is the DOMINANT lens.
Disease, treatment/modality and facility skills are supporting lenses that
tell you WHERE to inspect more deeply. They are not patient evidence.
Never use skills to create facts, infer undocumented diagnoses/treatments,
prescribe, calculate doses, or convert facility capability into patient
exposure.

SPECIALTY SCOPE
- specialty_scope lists in-scope and out-of-scope domains.
- Create tasks ONLY for in-scope clinical questions.
- Do not create a task whose purpose is to summarize, assess or "keep
  visible" out-of-scope data (in strict mode).
- Give tasks that inspect primary treatment skills the strongest emphasis
  (smallest priority numbers).

CURRENT CLINICAL STATE - first determine from the supplied context only:
latest documented state and encounter; documented treatment trajectory;
what is current/ongoing/completed/planned/changed/held/pending;
documented relationships; what materially affects the clinician's
assessment; what important information is missing.

EVIDENCE-DRIVEN INSPECTION
- The expertise layer is a lens, not a checklist.
- Do not create a task because a skill mentions a concept, because a field
  is absent, or because a generic agent could answer it.
- A missing item becomes a task only when its absence materially affects
  an in-scope clinical question.
- Prefer broad, evidence-rich clinical questions that allow synthesis of
  several related findings. The final assessment has at most five points.
- Identify changes only when both sides are in the supplied context.

PRIORITY: internal relative ordering, smaller = more emphasis. Determine it
from the relationship between the documented state, the clinician's
specialty perspective and the scope. Never from specialty names, disease
names, treatment names, keywords, chronology, documentation volume, the
previous clinician's identity or fixed task types. Not clinician-facing.

Each task must have: task_id, task, objective, required_information,
reason, dependencies (task_id values only), priority.
Do NOT select software agents; the Harness does that.

SAFETY: no autonomous decisions, prescribing, dose calculation, invented
schedules/durations, or inference of undocumented treatment, diagnoses or
investigations.

Create the complete plan in ONE pass. No re-planning.

CARE STATE (workflow classification only): pre_treatment |
treatment_in_progress | post_treatment | surveillance | unknown.
Use treatment_in_progress only when ongoing/partially delivered treatment
is explicitly documented; post_treatment only when completion is explicitly
supported; pre_treatment only when the relevant treatment has not been
delivered; otherwise unknown. Describe the assessment_intent honestly (do
not force "pre-treatment assessment" onto a context with treatment
exposure).

Return JSON only:

{
  "agent": "clinical_planning",
  "clinical_situation": "",
  "care_state": "unknown",
  "assessment_intent": "",
  "requesting_clinician_perspective": "",
  "expertise_lenses_used": [],
  "in_scope_domains_used": [],
  "clinical_questions": [],
  "assessment_tasks": [],
  "risk_questions": [],
  "toxicity_questions": [],
  "response_questions": [],
  "treatment_questions": [],
  "evidence_questions": [],
  "information_gaps": []
}
"""


CLINICAL_STATE_AGENT_PROMPT = """
You are the Clinical State Agent.

Determine the patient's current documented clinical state from the
supplied context, within the in-scope domains only.

Use only supplied information. No invented facts, no disease-specific
assumptions, no treatment recommendations.

Identify information relevant to whether the patient is ready for the next
clinical step in the requesting clinician's domain, and identify important
information gaps.

If information is not present in the supplied context, record it as an
information gap. Do not request historical information or additional
retrieval.

Return JSON only:

{
  "agent": "clinical_state",
  "findings": [],
  "information_gaps": []
}
"""


TREATMENT_STATE_AGENT_PROMPT = """
You are the Treatment State Agent.

Determine the documented current treatment state from the supplied
context, restricted to in-scope treatment modalities.

authoritative_sources has precedence over secondary_graph_context, which
has precedence over previous agent reasoning. Preserve exactly, when
supplied: treatment identity, medication identity, dose/exposure value and
unit, route, frequency, duration, timing, administration information,
status (planned, ongoing, completed, held, interrupted, discontinued),
documented changes.

Never calculate, recalculate, convert, normalize or infer a dose. Never
compare a dose to an invented threshold. Never infer undocumented
treatment, exposure, sequence, concurrency or transitions. Never report a
directly documented value as missing/pending because other reasoning lacks
it. If directly documented sources conflict, preserve the conflict.
Absent information: "not documented in the supplied context".

No historical or additional retrieval. No disease/specialty/drug rules, no
thresholds, no keyword mappings.

Return JSON only:

{
  "agent": "treatment_state",
  "findings": [],
  "information_gaps": [],
  "conflicts": [],
  "evidence": []
}
"""


INVESTIGATION_AGENT_PROMPT = """
You are the Investigation and Evidence State Agent.

Precedence: authoritative_sources > secondary_graph_context > previous
agent reasoning. Preserve authoritative results exactly. A graph summary
or agent reasoning must not turn a documented result into pending,
unavailable or missing. A result present only in the graph is
graph-supplied information.

Review only the supplied current context and identify explicitly present
investigations, measurements, results, pathology, imaging, laboratory
information, procedures and other objective evidence that is relevant to
the in-scope domains.

Distinguish: documented result | pending result | unavailable information
| conflicting information.
"Pending" only if the source says pending. "Unavailable" only if the
source says unavailable. "Not documented in the supplied context" only if
genuinely absent. Never infer status from absence. Comparisons only when
both sides are in the supplied context. No older graph state, no
recommendations, no retrieval.

Return JSON only:

{
  "agent": "investigation_state",
  "findings": [],
  "information_gaps": []
}
"""


SYMPTOM_CHANGE_AGENT_PROMPT = """
You are the Symptom and Clinical Change Agent.

Identify documented symptoms, clinical changes, unresolved findings and
relevant changes over time that relate to the in-scope domains.

Use source information only. Do not diagnose. Do not infer severity unless
supported. If information is absent, record an information gap. No
historical or additional retrieval.

Return JSON only:

{
  "agent": "symptom_change",
  "findings": [],
  "information_gaps": []
}
"""


MEDICATION_PROCEDURE_AGENT_PROMPT = """
You are the Medication and Procedure State Agent.

Review the supplied context for documented medication and procedure
information within the in-scope domains. Identify current state, recent
changes, relevant history, pending information and unresolved status where
explicitly documented.

Do not invent medication or procedure information. Do not recommend
treatment. If absent, record an information gap. No historical or
additional retrieval.

Return JSON only:

{
  "agent": "medication_procedure",
  "findings": [],
  "information_gaps": []
}
"""


RISK_READINESS_AGENT_PROMPT = """
You are the Risk and Clinical Readiness Agent.

Operate on the assigned Planning Agent task only. Determine whether the
supplied information documents factors that may affect readiness for the
in-scope clinical step being assessed.

Identify documented risk factors, safety concerns, readiness concerns,
factors needing clinician review, reassuring findings (when supported),
missing information and conflicts. Do not invent risk factors, assume
disease-specific risks, use hardcoded specialty rules, recommend
treatment, or prescribe/calculate doses.

Return JSON only:

{
  "agent": "risk_readiness",
  "risk_factors": [],
  "readiness_concerns": [],
  "reassuring_findings": [],
  "information_gaps": [],
  "conflicts": [],
  "evidence": []
}
"""


TREATMENT_SAFETY_AGENT_PROMPT = """
You are the Treatment Safety and Toxicity Assessment Agent.

Operate only on the assigned task and only on in-scope treatment
modalities.

authoritative_sources is the highest-priority patient source; graph
context is contextual; current-run reasoning is not evidence.

Preserve exactly: treatment identity, medication identity, dose/exposure
value and unit, route, frequency, duration, timing, administration
information, status, documented changes.

Do NOT calculate, recalculate, convert, normalize or infer doses. Do NOT
judge whether a documented dose is appropriate. Do NOT invent numerical,
toxicity, treatment-delay, dose-modification or supportive-care
thresholds. Do NOT create drug/disease/cancer/specialty rules or keyword
mappings. Do NOT infer undocumented toxicity, organ impairment, exposure or
treatment modification.

If a modification or clinician decision is explicitly documented, represent
it accurately. If only a possible consideration exists, present it as a
consideration for clinician review.

Never convert: consideration -> decision, risk -> contraindication,
laboratory value -> treatment hold, exposure -> dose modification, missing
information -> guessed value. Never report a directly documented value as
missing. Preserve conflicts.

Return JSON only:

{
  "agent": "treatment_safety",
  "baseline_safety_findings": [],
  "toxicity_findings": [],
  "risk_factors": [],
  "organ_function_concerns": [],
  "exposure_findings": [],
  "modification_considerations": [],
  "information_gaps": [],
  "conflicts": [],
  "evidence": []
}
"""


TREATMENT_RESPONSE_AGENT_PROMPT = """
You are the Treatment Response Assessment Agent.

Determine documented response and treatment-related changes for in-scope
treatment modalities from the supplied context.

Identify documented response findings, documented lack of response (only
when explicit), disease changes, treatment changes, toxicity changes, new
symptoms relevant to response, unresolved response questions and missing
information.

Assess response only when treatment exposure AND response evidence are
documented. In a pre-treatment state do not create a post-treatment
response conclusion. Do not infer response, progression, improvement or
failure without objective evidence. Do not recommend treatment.

Return JSON only:

{
  "agent": "treatment_response",
  "response_findings": [],
  "treatment_changes": [],
  "toxicity_changes": [],
  "unresolved_questions": [],
  "information_gaps": [],
  "evidence": []
}
"""


GUIDELINE_EVIDENCE_AGENT_PROMPT = """
You are the Guideline and Evidence Evaluation Agent.

Evaluate only evidence explicitly available during the current run for the
in-scope clinical questions from the Planning Agent. Do not retrieve
patient history. Do not invent guideline recommendations, names,
publication dates or evidence levels. Do not convert general evidence into
an individualized prescription.

For each evidence item, when available: source, guideline/reference name,
publication/version/date, recommendation or finding, population/context,
applicability, limitations, uncertainty.

Distinguish: directly documented evidence | guideline-supported
information | evidence-supported clinical consideration | information that
cannot be established. A guideline claim is valid only when the supplied
evidence identifies the guideline/reference and the supporting
recommendation. If applicability cannot be established, state the
limitation. No autonomous decisions, no prescribing.

Return JSON only:

{
  "agent": "guideline_evidence",
  "evidence": [],
  "guideline_findings": [],
  "applicability": [],
  "limitations": [],
  "information_gaps": []
}
"""


TREATMENT_CONSIDERATION_AGENT_PROMPT = """
You are the Treatment Consideration Reasoning Agent.

You receive the assessment plan and current-run findings (clinical state,
investigations, treatment state, symptoms, medication/procedure,
risk/readiness, safety/toxicity, response, guideline/evidence). Use only
supplied information and only in-scope treatment modalities.

Identify evidence-supported treatment CONSIDERATIONS for clinician review.
Do NOT make an autonomous decision, prescribe, select a final treatment,
select the lowest dose, or invent a dose, schedule, duration or
modification.

Separate: documented patient findings; clinical relevance; patient-specific
risks; expected benefit considerations; toxicity considerations;
organ-function considerations; documented treatment exposure; documented
response; applicable evidence; uncertainties; information still required;
clinician verification required.

Considerations stay conditional unless the evidence explicitly documents the
decision. "May be relevant" is never "should be selected"; "toxicity should
be considered" is never "reduce the dose"; "information needed" is never a
guessed value. "Guidelines recommend..." only with explicit
source/reference and recommendation in the supplied results.

Return JSON only:

{
  "agent": "treatment_consideration",
  "standard_approach": [],
  "patient_specific_concerns": [],
  "benefit_considerations": [],
  "toxicity_reduction_considerations": [],
  "dose_or_exposure_considerations": [],
  "alternative_considerations": [],
  "contraindication_or_precaution_signals": [],
  "uncertainties": [],
  "information_gaps": [],
  "clinician_verification_required": [],
  "evidence": []
}
"""


SYNTHESIS_REASONING_AGENT_PROMPT = """
You are the Clinical Synthesis Agent.

Use only the supplied current clinical context, findings produced during
the current Harness run, guideline/evidence results explicitly produced in
this run, and generated assessment points. Restrict synthesis to in-scope
domains.

The supplied clinical context is the primary source of patient facts.
Agent results and generated points are secondary reasoning requiring
verification and are never independent evidence. Previously generated
synthesis is not automatically a fact, measurement, diagnosis, decision,
recommendation or verified conclusion; if the underlying evidence is
missing, contradictory or insufficient, mark it uncertain.

Preserve source dates exactly. Do not replace an observation date with the
encounter date. No retrieval, no outside information, no autonomous
treatment recommendations.

Identify: directly documented current state; documented changes;
unresolved issues; source conflicts; information gaps; supported and
unsupported/uncertain secondary reasoning.

Return JSON only:

{
  "agent": "longitudinal_synthesis",
  "findings": [],
  "information_gaps": [],
  "source_conflicts": [],
  "supported_secondary_reasoning": [],
  "unsupported_secondary_reasoning": []
}
"""


CHECKPOINT_AGENT_PROMPT = """
You are the Candidate Clinical Assessment Generator (not the final
selector).

Inspect the COMPLETE supplied context through the resolved expertise lenses
and produce patient-grounded candidate findings for the requesting
clinician.

    ACTIVE EXPERTISE SKILLS + PATIENT CONTEXT + VISIT CONTEXT
        -> CLINICIAN-FACING CANDIDATES (IN SPECIALTY SCOPE ONLY)

SOURCE AUTHORITY: authoritative_sources > secondary_graph_context >
current_run_reasoning. Lower levels never override higher ones.

SPECIALTY DOMINANCE AND SCOPE
- The requesting clinician's specialty skill is the dominant lens.
- specialty_scope defines in-scope and out-of-scope domains. In strict
  mode, a candidate must be about in-scope data. Never generate a
  candidate from out-of-scope data, however well documented.
- Primary treatment skills (specialty_scope.primary_treatment_skill_ids)
  are inspected first and most deeply: look for treatment identity and
  status, exposure, documented trajectory, response, tolerance, toxicity,
  organ/function state and documented decisions that those skills name.
- Disease and facility skills support the specialty lens; they never
  displace it.
- Do not convert skills into a checklist; do not require every dimension.
  The skill decides WHERE to look; the patient context decides WHAT to
  say. If a dimension has no evidence, do not create a candidate.

CANDIDATES ARE POSITIVE PATIENT-STATE FINDINGS, not a gap/conflict list.
- A conflict is a candidate only if the specialty perspective makes it
  material to the clinical question.
- A missing item is a candidate only if the active expertise makes the
  dimension relevant AND the context supports why the absence matters.
- Do not infer absence from one incomplete layer.

VISIT CONTEXT: use visit_assessment_context as the lens for THIS
encounter. Do not use visit number, cycle number, treatment sequence,
specialty name, disease name or keywords as routing rules. A previous
finding stays relevant only if current evidence supports it; newly
documented or changed state may become relevant.

PATIENT STATE: include only what the context supports (disease state,
treatment state/trajectory/exposure, response, progression, toxicity,
organ/function, symptoms, investigations, pathology, imaging, biomarkers,
procedures, documented decisions). Do not infer diagnosis, stage,
response, toxicity, treatment, causality or decisions.

GENERATION: normally up to 12 evidence-rich, synthesized candidates (not
fragments). Each must answer: "What documented patient finding does the
active expertise make important for this clinician?" Candidates must be
expertise-grounded, patient-grounded, concise, traceable, temporally and
source-faithful.

Set "in_specialty_scope" true only when the candidate belongs to an
in-scope domain. Set "relevance" to primary for direct specialty relevance,
contextual for supporting in-scope information, and cross_domain only when
soft scope mode is active.

SAFETY: no treatment decisions, prescribing, dose calculation, invented
thresholds, or inferred diagnoses/staging/treatment/response/toxicity/
causality. Skill instructions are not patient evidence.

Return JSON only:

{
  "agent": "checkpoint_generator",
  "care_state": "unknown",
  "assessment_intent": "",
  "candidates": [
    {
      "candidate_id": "",
      "category": "",
      "point": "",
      "clinical_significance": "",
      "supporting_evidence": [],
      "source": [],
      "status": "",
      "relevance": "primary",
      "in_specialty_scope": true,
      "scope_domain": "",
      "skill_ids_used": [],
      "materiality": "",
      "current_state_relation": "",
      "visit_relevance": "",
      "visit_relation": "",
      "visit_evidence": []
    }
  ]
}
"""


EVIDENCE_VERIFICATION_AGENT_PROMPT = """
You are the Evidence Verification Agent.

Verify assessment points generated during the current Harness run using
only: the supplied clinical context, current-run findings, explicit
guideline/evidence results and the generated points. No retrieval, no
invented facts, no repair by guessing. If a point cannot be verified,
exclude it.

Absence: reject or revise any claim that treats absence from the supplied
context as proof something does not exist. Use "not documented in the
supplied context".

1. SPECIALTY SCOPE FIDELITY (NEW)
   - Exclude any point whose factual core belongs to an out-of-scope
     domain in specialty_scope (strict mode), unless the specialty skill
     itself names that relationship as an inspection dimension.
   - Exclude points flagged in_specialty_scope == false.
   - Do not re-rank a domain upward because it has more documentation,
     occurs earlier or was documented by another clinician.
   - Do not decide scope with specialty names, disease names, treatment
     names or keywords.

2. CLAIM CALIBRATION - wording must not exceed evidence. Reject/revise:
   protocol or eligibility compliance without criteria; definitive safety
   conclusions from labs/findings alone; continuation, discontinuation,
   delay, omission, modification or dose change without a documented
   decision; missing -> non-existent; risk factor -> contraindication;
   finding -> treatment failure/success; temporal association -> causality;
   consideration -> decision; guideline claims without current-run
   provenance. Distinguish documented fact | interpretation | clinical
   consideration | documented decision. If the factual core is supported
   but the wording is too strong, keep the supported core only. Do not add
   recommendations.

3. PERSPECTIVE AND PRIORITY - each point needs a defensible relationship to
   the requesting clinician's assessment. Primary requires direct
   informing/constraining of that assessment. Contextual must be genuinely
   useful. Priority must reflect importance to the requesting clinician,
   not documentation volume, chronology or another clinician's domain. Do
   not apply predefined priority tables. If priority cannot be supported,
   exclude the point; do not invent priority.

4. FACTUAL FIDELITY - facts, numbers, ranges, units, dates, identifiers,
   grades, scores, percentages and dimensions must match the source.

5. CLAIM-LEVEL ATTRIBUTE FIDELITY - compare every material attribute
   (anatomical/spatial relationship, laterality, location, timing, status,
   severity, extent, measurements, identifiers, relationships between
   findings and interventions). Never transfer an attribute between
   findings or infer one from convention. If any material attribute
   differs or is not established, the assertion is not verified: keep only
   a cleanly separable supported assertion, otherwise exclude the point.
   Preserve source ambiguity or conflict.

6. TEMPORAL FIDELITY - observation dates are not encounter dates; baseline
   is not a new observation; no undocumented timing.

7. SOURCE FIDELITY - evidence must be present and support the complete
   claim; generated synthesis is not a primary fact; conflicts preserved.

8. TREATMENT TRAJECTORY - for multi-intervention points verify identity,
   status, timing, order, relationships, current/planned/completed/etc.
   status, and explicit concurrency, dependency and transition. Never infer
   sequence, concurrency or dependency from co-occurrence, text order,
   convention, specialty or terminology. Never convert planned -> started,
   started -> completed, completed -> ongoing, considered -> decided,
   decided -> performed. Verify only the supported portion.

9. DIRECT SOURCE PRECEDENCE - directly documented information beats
   generated reasoning. Reject "missing/pending/unavailable" claims about
   documented values; reject changed, calculated, normalized or
   reinterpreted treatment values; preserve documented decisions exactly;
   never create undocumented decisions; preserve direct-source conflicts.

10. TREATMENT ATTRIBUTES - verify identity, dose/exposure value and unit,
    route, frequency, duration, timing, administration, status, change and
    decision against the source. Reject calculated, converted, inferred or
    invented values and schedules. Reject recommendations presented as
    documented decisions.

11. MATERIALITY OF MISSING INFORMATION - a NOT_DOCUMENTED point is allowed
    only if: absent from ALL layers; the plan identifies a clinical
    question it affects; it could materially affect interpretation,
    readiness, safety, trajectory or response; and the relevance is
    supported by the context. Reject checklist items, conventional fields,
    generic safety statements and skill-derived statements.

12. MATERIALITY GATE - keep a point only if the core is supported, relevant
    to the current care state and in scope, materially improves the
    clinician's understanding, is distinct, and synthesizes related
    evidence. Merge duplicates, keeping the stronger point.

13. GUIDELINES - need explicit current-run provenance and established
    applicability; otherwise reject the guideline claim.

Preserve "relevance", "in_specialty_scope" and "priority" when present.
Status must be one of DOCUMENTED, PARTIALLY_DOCUMENTED, CONFLICTING,
NOT_DOCUMENTED; same-level unresolved conflicts -> CONFLICTING. Maximum
five verified points. Metadata is internal.

Return JSON only:

{
  "agent": "evidence_verification",
  "verified_assessment_points": [],
  "excluded_assessment_points": [],
  "conflicts": []
}
"""


# ============================================================
# AGENT REGISTRY
# ============================================================

AGENT_PROMPTS = {
    "clinical_planning": CLINICAL_PLANNING_AGENT_PROMPT,
    "clinical_state": CLINICAL_STATE_AGENT_PROMPT,
    "treatment_state": TREATMENT_STATE_AGENT_PROMPT,
    "investigation_state": INVESTIGATION_AGENT_PROMPT,
    "symptom_change": SYMPTOM_CHANGE_AGENT_PROMPT,
    "medication_procedure": MEDICATION_PROCEDURE_AGENT_PROMPT,
    "longitudinal_synthesis": SYNTHESIS_REASONING_AGENT_PROMPT,
    "risk_readiness": RISK_READINESS_AGENT_PROMPT,
    "treatment_safety": TREATMENT_SAFETY_AGENT_PROMPT,
    "treatment_response": TREATMENT_RESPONSE_AGENT_PROMPT,
    "guideline_evidence": GUIDELINE_EVIDENCE_AGENT_PROMPT,
    "treatment_consideration": TREATMENT_CONSIDERATION_AGENT_PROMPT,
    "checkpoint_generator": CHECKPOINT_AGENT_PROMPT,
    "evidence_verification": EVIDENCE_VERIFICATION_AGENT_PROMPT,
}

NON_SELECTABLE_AGENTS = {
    "clinical_planning",
    "checkpoint_generator",
    "evidence_verification",
}

AGENT_SELECTOR_AGENTS: Dict[str, str] = {
    name: prompt
    for name, prompt in AGENT_PROMPTS.items()
    if name not in NON_SELECTABLE_AGENTS
}


AGENT_SELECTOR_PROMPT = """
You are the Harness Agent-Selection Reasoner.

You do not perform clinical assessment. You are given one clinical
assessment task and the prompts of the available generic agents. Select the
single agent whose described capability most directly answers the task's
stated objective.

Base the selection only on the task, its objective, required information,
dependencies and the agents' capability descriptions. Do not inspect
patient facts. Do not use previous agent reasoning. Do not use disease,
cancer type, specialty, treatment, medication or keyword routing rules, or
any fixed agent assignment.

If no agent is a reasonable match, return null and explain why.

Return JSON only:

{
  "selected_agent": "<one of the provided agent ids, or null>",
  "reason": ""
}
"""


# ============================================================
# GENERIC AGENT EXECUTION
# ============================================================

async def run_agent(
    agent_name: str,
    clinical_context: Dict[str, Any],
    previous_results: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Execute one agent. Every agent receives the shared source rule, the
    specialty-scope rule, the (pruned) expertise instructions and its own
    prompt.
    """

    expertise_context = get_expertise(clinical_context)

    system_prompt = build_system_prompt(
        AGENT_PROMPTS[agent_name],
        expertise_context,
    )

    user_payload = {
        "expertise_context": safe_json(expertise_context),
        "specialty_scope": safe_json(get_scope(clinical_context)),
        "strict_specialty_scope": STRICT_SPECIALTY_SCOPE,
        "source_authority": {
            "authoritative_sources": safe_json(
                clinical_context.get("authoritative_sources", {})
            ),
            "secondary_graph_context": safe_json(
                clinical_context.get("secondary_graph_context", {})
            ),
            "previous_agent_reasoning": safe_json(previous_results),
        },
        "assessment_plan": safe_json(clinical_context.get("assessment_plan", {})),
        "current_task": safe_json(clinical_context.get("current_task", {})),
        "required_information": safe_json(
            clinical_context.get("required_information", [])
        ),
        "full_context": safe_json(clinical_context),
    }

    response = await invoke_agent(
        system_prompt=system_prompt,
        user_prompt=json.dumps(user_payload, indent=2, default=str),
    )

    parsed = extract_json(response)

    if parsed is None:
        logger.warning(
            f"[PreTreatment] Agent returned non-JSON output | agent={agent_name}"
        )
        return {
            "agent": agent_name,
            "status": "invalid_output",
            "raw_output": response,
        }

    return parsed


async def select_agent_for_task(
    task: Dict[str, Any],
    clinical_context: Dict[str, Any],
    previous_results: Dict[str, Any],
) -> Optional[str]:
    """Harness-side agent selection. Validates against the registry only."""

    selection_payload = {
        "task": safe_json(task),
        "available_agents": dict(AGENT_SELECTOR_AGENTS),
    }

    response = await invoke_agent(
        system_prompt=AGENT_SELECTOR_PROMPT,
        user_prompt=json.dumps(selection_payload, indent=2, default=str),
    )

    parsed = extract_json(response)

    if not isinstance(parsed, dict):
        logger.warning(
            "[PreTreatment Harness] Agent selector returned non-JSON | "
            f"task={task.get('task')}"
        )
        return None

    selected = parsed.get("selected_agent")

    if not selected or not isinstance(selected, str):
        return None

    if selected not in AGENT_SELECTOR_AGENTS or selected not in AGENT_PROMPTS:
        logger.warning(
            "[PreTreatment Harness] Selector chose an ineligible agent | "
            f"selected={selected}"
        )
        return None

    return selected


# ============================================================
# TASK BOOKKEEPING
# ============================================================

def normalize_task(task: Dict[str, Any], index: int) -> Optional[Dict[str, Any]]:
    if not isinstance(task, dict):
        return None

    normalized = {k: v for k, v in task.items() if k != "agent"}

    normalized["task_id"] = str(normalized.get("task_id") or f"task_{index + 1}")

    deps = normalized.get("dependencies", [])
    if not isinstance(deps, list):
        deps = []

    normalized["dependencies"] = [str(d) for d in deps if d is not None]

    return normalized


def dependencies_satisfied(task: Dict[str, Any], completed_task_ids: set) -> bool:
    deps = task.get("dependencies", [])
    return all(str(d) in completed_task_ids for d in deps)


def get_dependency_results(
    task: Dict[str, Any],
    execution_results: List[Dict[str, Any]],
) -> List[Dict[str, Any]]:
    deps = {str(d) for d in task.get("dependencies", []) if d is not None}

    if not deps:
        return []

    return [
        safe_json(r)
        for r in execution_results
        if str(r.get("task_id")) in deps
    ]


# ============================================================
# PLAN -> HARNESS -> AGENT EXECUTION
# ============================================================

async def run_planned_assessment(
    clinical_context: Dict[str, Any],
) -> Dict[str, Any]:
    """
    1. Planning Agent creates the complete plan (once, scope-aware).
    2. Harness selects an agent per task and executes by dependency order.
    3. Results are stored by task_id and passed to dependent tasks.
    No re-planning. No Neo4j access.
    """

    # Idempotent: resolves expertise + scope + prunes skills if needed.
    clinical_context = await prepare_scoped_context(clinical_context)

    logger.info("[PreTreatment Harness] Creating assessment plan")

    planning_result = await run_agent(
        agent_name="clinical_planning",
        clinical_context=clinical_context,
        previous_results={},
    )

    if not isinstance(planning_result, dict):
        logger.error("[PreTreatment Harness] Planning Agent returned invalid result")
        return {
            "clinical_planning": {},
            "execution": {
                "status": "planning_failed",
                "completed_tasks": [],
                "skipped_tasks": [],
            },
            "assessment_results": [],
        }

    current_plan = planning_result

    assessment_tasks = planning_result.get("assessment_tasks", [])
    if not isinstance(assessment_tasks, list):
        assessment_tasks = []

    assessment_tasks = assessment_tasks[:MAX_ASSESSMENT_TASKS]

    logger.info(
        f"[PreTreatment Harness] Planning complete | tasks={len(assessment_tasks)}"
    )

    normalized_tasks: List[Dict[str, Any]] = []
    for index, raw in enumerate(assessment_tasks):
        task = normalize_task(raw, index)
        if task is not None:
            normalized_tasks.append(task)

    execution_results: List[Dict[str, Any]] = []
    completed_task_ids: set = set()
    executed_task_ids: set = set()
    skipped_tasks: List[Dict[str, Any]] = []

    while len(executed_task_ids) < len(normalized_tasks):

        ready_tasks = [
            t
            for t in normalized_tasks
            if t["task_id"] not in executed_task_ids
            and dependencies_satisfied(t, completed_task_ids)
        ]

        if not ready_tasks:
            for task in normalized_tasks:
                if task["task_id"] not in executed_task_ids:
                    skipped_tasks.append({
                        "task_id": task["task_id"],
                        "task": safe_json(task),
                        "status": "unresolved_dependencies",
                    })
                    executed_task_ids.add(task["task_id"])
            break

        for task in ready_tasks:

            task_id = task["task_id"]

            logger.info(f"[PreTreatment Harness] Executing task | task_id={task_id}")

            agent_name = await select_agent_for_task(
                task=task,
                clinical_context=clinical_context,
                previous_results={
                    "completed_results": safe_json(execution_results)
                },
            )

            if not agent_name:
                logger.warning(
                    f"[PreTreatment Harness] No suitable agent | task_id={task_id}"
                )
                skipped_tasks.append({
                    "task_id": task_id,
                    "task": safe_json(task),
                    "status": "no_suitable_agent",
                })
                executed_task_ids.add(task_id)
                continue

            task_context = dict(clinical_context)
            task_context["assessment_plan"] = safe_json(current_plan)
            task_context["current_task"] = safe_json(task)
            task_context["required_information"] = safe_json(
                task.get("required_information", [])
            )

            previous_state = {
                "dependency_reasoning": get_dependency_results(
                    task=task,
                    execution_results=execution_results,
                )
            }

            result = await run_agent(
                agent_name=agent_name,
                clinical_context=task_context,
                previous_results=previous_state,
            )

            result_status = (
                result.get("status") if isinstance(result, dict) else None
            )
            task_status = "failed" if result_status == "invalid_output" else "completed"

            execution_results.append({
                "task_id": task_id,
                "task": safe_json(task),
                "agent": agent_name,
                "result": safe_json(result),
                "status": task_status,
            })

            executed_task_ids.add(task_id)

            if task_status == "completed":
                completed_task_ids.add(task_id)

            logger.info(
                "[PreTreatment Harness] Task finished | "
                f"task_id={task_id} | agent={agent_name} | status={task_status}"
            )

    logger.info(
        "[PreTreatment Harness] Plan execution complete | "
        f"completed={len(completed_task_ids)} | skipped={len(skipped_tasks)}"
    )

    return {
        "clinical_planning": safe_json(current_plan),
        "execution": {
            "status": "completed",
            "planning_calls": 1,
            "completed_task_ids": list(completed_task_ids),
            "completed_tasks": execution_results,
            "skipped_tasks": skipped_tasks,
        },
        "assessment_results": execution_results,
    }


# ============================================================
# VISIT CONTEXT HELPERS
# ============================================================

VISIT_ASSESSMENT_CONTEXT_DEFAULT = {
    "visit_position": "unknown",
    "visit_identity": "",
    "visit_purpose": "",
    "assessment_intent": "",
    "assessment_reason": "",
    "current_state": {},
    "previous_state": {},
    "newly_relevant_information": [],
    "ongoing_relevant_information": [],
    "resolved_information": [],
    "documented_changes": [],
    "active_trajectory": {},
    "assessment_focus": [],
}


def normalize_visit_assessment_context(value: Any) -> Dict[str, Any]:
    """Normalize visit metadata without inferring clinical facts."""

    base = safe_json(VISIT_ASSESSMENT_CONTEXT_DEFAULT)

    if not isinstance(value, dict):
        return base

    for key in base:
        if key in value:
            base[key] = safe_json(value.get(key))

    # Preserve the structured encounter date if it was attached.
    if value.get("encounter_date"):
        base["encounter_date"] = value.get("encounter_date")

    for key in (
        "newly_relevant_information",
        "ongoing_relevant_information",
        "resolved_information",
        "documented_changes",
        "assessment_focus",
    ):
        if not isinstance(base.get(key), list):
            base[key] = []

    for key in ("current_state", "previous_state", "active_trajectory"):
        if not isinstance(base.get(key), dict):
            base[key] = {}

    pos = base.get("visit_position")
    if not isinstance(pos, str) or not pos.strip():
        base["visit_position"] = "unknown"

    return base


def _visit_number_to_ordinal(number: int) -> str:
    """Structured encounter number -> '1st', '2nd', ... (no clinical rules)."""

    if number < 1:
        return "unknown"

    if 10 <= (number % 100) <= 20:
        suffix = "th"
    else:
        suffix = {1: "st", 2: "nd", 3: "rd"}.get(number % 10, "th")

    return f"{number}{suffix}"


# ============================================================
# CURRENT-STATE RECONCILIATION
# ============================================================

CURRENT_STATE_RECONCILIATION_PROMPT = """
You are the Current Clinical State Reconciliation Agent.

Your role is strictly evidence reconciliation and temporal normalization of
the supplied context. No treatment decisions, prescribing, dose
calculation, undocumented facts, disease/specialty/treatment/medication
rules, keywords or clinical conventions.

SOURCE AUTHORITY: authoritative_sources > secondary_graph_context >
current_run_reasoning. Preserve unresolved same-level conflicts.

SPECIALTY SCOPE: reconcile only information that belongs to the in-scope
domains of specialty_scope. Out-of-scope domain information is not
reconciled, not listed in reconciled_items, material_conflicts or
material_information_gaps, and not used in visit_assessment_context (strict
mode).

VISIT-CENTERED TEMPORAL MODEL
The temporal anchor is the CURRENT DOCUMENTED VISIT/ENCOUNTER, not a cycle,
line, fraction or procedure counter. Use visit/encounter information only
when explicitly supplied.
- Identify the current visit, and the previous visit only if actually
  available, with supplied dates and metadata.
- Report meaningful changes between visits only when BOTH sides exist.
- Explicitly documented transitions inside the current encounter's source
  summaries remain valid current-context evidence even without a previous
  visit; represent them as source-documented transitions, never as a
  reconstructed previous visit.
- Never invent a previous visit, infer a visit from a cycle number or
  treatment sequence, or substitute an observation date for an encounter
  date. Preserve source dates exactly. If no previous visit exists, return
  an empty previous_visit object.

REQUESTING CLINICIAN PERSPECTIVE: doctor_context, expertise_context and
specialty_scope define relevance. Do not branch on specialty names or use
keyword templates.

SAFETY/TOXICITY: treat treatment-related safety, toxicity, symptoms and
functional limitations of IN-SCOPE modalities as relevant, without tying
them to a cycle. Represent only what is supported.

OBJECTIVE: for each materially relevant in-scope event/state identify,
when supported: event, current status, visit relationship, event date,
documented values, source layer, supporting statements, conflict,
unresolved issue. Distinguish planned, prescribed, scheduled, started,
delivered, partially_delivered, completed, held, interrupted,
discontinued, pending. A prescription is not delivery; a scheduled event
is not proof it occurred; "ongoing" is not proof of an exact delivered
amount.

CARE STATE: pre_treatment | treatment_in_progress | post_treatment |
surveillance | unknown, from supplied evidence only.

CHANGE REPRESENTATION: visit_changes may hold (1) encounter-to-encounter
changes where both encounters exist, or (2) documented transitions inside
the current context. Never describe (2) as an encounter comparison. Never
infer a change from two unrelated values or from chronology alone.

VISIT ASSESSMENT CONTEXT: derive it only from the supplied current and
previous visit (if available), documented changes, care state, explicit
trajectory, newly/ongoing/resolved information, the clinician perspective
and expertise. No first/second/third-visit rules. Do not use visit number,
cycle number, treatment sequence or chronology alone to decide content.
visit_position only when explicitly supported (else "unknown");
visit_identity only if supplied; visit_purpose and assessment_intent only
if supported (else empty). A previous finding may remain relevant only if
current evidence still supports it. Previous AI-generated points are not
patient evidence. assessment_focus lists only the dimensions that deserve
attention THIS visit given ACTIVE EXPERTISE, IN-SCOPE PATIENT STATE and
DOCUMENTED CHANGES; no fixed count.

Return JSON only:

{
  "agent": "current_state_reconciliation",
  "care_state": "unknown",
  "latest_documented_state": "",
  "latest_relevant_event": "",
  "current_visit": {},
  "previous_visit": {},
  "visit_changes": [],
  "reconciled_items": [],
  "material_conflicts": [],
  "material_information_gaps": [],
  "temporal_notes": [],
  "visit_assessment_context": {
    "visit_position": "unknown",
    "visit_identity": "",
    "visit_purpose": "",
    "assessment_intent": "",
    "assessment_reason": "",
    "current_state": {},
    "previous_state": {},
    "newly_relevant_information": [],
    "ongoing_relevant_information": [],
    "resolved_information": [],
    "documented_changes": [],
    "active_trajectory": {},
    "assessment_focus": []
  }
}
"""


async def reconcile_current_clinical_state(
    clinical_context: Dict[str, Any],
    agent_results: Dict[str, Any],
) -> Dict[str, Any]:
    """Evidence-reconciliation pass with authoritative structured visit metadata."""

    expertise_context = get_expertise(clinical_context)

    # ---------------------------------------------------------
    # Canonical visit context
    #
    # Prefer the structured visit_context supplied by the caller.
    # If it is absent/incomplete, use assessment_visit_context
    # prepared by the harness.
    #
    # This does NOT create clinical facts or alter specialty scope.
    # ---------------------------------------------------------
    raw_visit_context = clinical_context.get("visit_context")

    if not isinstance(raw_visit_context, dict):
        raw_visit_context = {}

    assessment_visit_context = clinical_context.get(
        "assessment_visit_context",
        {},
    )

    if not isinstance(assessment_visit_context, dict):
        assessment_visit_context = {}

    current_visit = raw_visit_context.get("current_visit")

    if not isinstance(current_visit, dict):
        current_visit = {}

    # Fill only missing structured visit metadata.
    # Never overwrite an explicitly supplied value.
    if not current_visit.get("encounter_id"):
        if assessment_visit_context.get("encounter_id"):
            current_visit["encounter_id"] = (
                assessment_visit_context["encounter_id"]
            )

    if not current_visit.get("encounter_number"):
        if assessment_visit_context.get("encounter_number") is not None:
            current_visit["encounter_number"] = (
                assessment_visit_context["encounter_number"]
            )

    if not current_visit.get("encounter_date"):
        if assessment_visit_context.get("encounter_date"):
            current_visit["encounter_date"] = (
                assessment_visit_context["encounter_date"]
            )

    canonical_visit_context = dict(raw_visit_context)
    canonical_visit_context["current_visit"] = current_visit

    payload = {
        "expertise_context": safe_json(expertise_context),
        "specialty_scope": safe_json(get_scope(clinical_context)),

        "authoritative_sources": safe_json(
            clinical_context.get("authoritative_sources", {})
        ),

        "secondary_graph_context": safe_json(
            clinical_context.get("secondary_graph_context", {})
        ),

        "current_run_reasoning": safe_json(agent_results),

        "assessment_plan": safe_json(
            clinical_context.get("assessment_plan", {})
        ),

        "request": safe_json(
            clinical_context.get("request", {})
        ),

        "doctor_context": safe_json(
            clinical_context.get("doctor_context", {})
        ),

        "patient_context": safe_json(
            clinical_context.get("patient_context", {})
        ),

        "clinical_graph": safe_json(
            clinical_context.get("clinical_graph", {})
        ),

        # IMPORTANT:
        # Send the canonicalized context, not the potentially
        # empty original context.
        "visit_context": safe_json(canonical_visit_context),

        "assessment_visit_context": safe_json(
            assessment_visit_context
        ),

        "encounter_context": safe_json(
            clinical_context.get("encounter_context", {})
        ),
    }

    response = await invoke_agent(
        system_prompt=build_system_prompt(
            CURRENT_STATE_RECONCILIATION_PROMPT,
            expertise_context,
        ),
        user_prompt=json.dumps(
            payload,
            indent=2,
            default=str,
        ),
    )

    parsed = extract_json(response)

    if not isinstance(parsed, dict):
        logger.warning(
            "[PreTreatment 9+ Pipeline] Reconciliation returned invalid JSON"
        )

        return {
            "agent": "current_state_reconciliation",
            "care_state": "unknown",
            "latest_documented_state": "",
            "latest_relevant_event": "",
            "current_visit": safe_json(current_visit),
            "previous_visit": {},
            "visit_changes": [],
            "reconciled_items": [],
            "material_conflicts": [],
            "material_information_gaps": [],
            "temporal_notes": [],
            "visit_assessment_context":
                normalize_visit_assessment_context({}),
            "status": "invalid_output",
        }

    if parsed.get("care_state") not in VALID_CARE_STATES:
        parsed["care_state"] = "unknown"

    visit_ctx = normalize_visit_assessment_context(
        parsed.get(
            "visit_assessment_context",
            {},
        )
    )

    # ---------------------------------------------------------
    # Authoritative structured current visit metadata
    # ---------------------------------------------------------
    if current_visit.get("encounter_id"):
        visit_ctx["visit_identity"] = current_visit["encounter_id"]

    number = current_visit.get("encounter_number")

    if number is not None:
        try:
            visit_ctx["visit_position"] = _visit_number_to_ordinal(
                int(number)
            )
        except (TypeError, ValueError):
            logger.warning(
                "[PreTreatment 9+ Pipeline] Invalid encounter_number: "
                f"{number!r}"
            )

    if current_visit.get("encounter_date"):
        visit_ctx["encounter_date"] = current_visit[
            "encounter_date"
        ]


    # ---------------------------------------------------------
    # Preserve deterministic current visit metadata.
    #
    # The encounter metadata comes from the structured contexts
    # and must not disappear simply because the LLM returns
    # current_visit as {}.
    #
    # This does NOT infer clinical facts and does NOT modify
    # specialty scope.
    # ---------------------------------------------------------
    parsed_current_visit = parsed.get("current_visit")

    if not isinstance(parsed_current_visit, dict):
        parsed_current_visit = {}

    if current_visit:
        merged_current_visit = dict(current_visit)

        # Only allow non-empty LLM fields to supplement the
        # deterministic visit metadata.
        merged_current_visit.update(
            {
                key: value
                for key, value in parsed_current_visit.items()
                if value not in (None, "", [], {})
            }
        )

        parsed["current_visit"] = merged_current_visit
    else:
        parsed["current_visit"] = parsed_current_visit


    # ---------------------------------------------------------
    # Previous visit is never invented.
    # ---------------------------------------------------------
    parsed_previous_visit = parsed.get("previous_visit")

    if not isinstance(parsed_previous_visit, dict):
        parsed["previous_visit"] = {}


    # ---------------------------------------------------------
    # Preserve normalized visit assessment context.
    # ---------------------------------------------------------
    parsed["visit_assessment_context"] = (
        normalize_visit_assessment_context(visit_ctx)
    )

    return parsed


# ============================================================
# CANDIDATE GENERATION
# ============================================================

async def generate_candidate_findings(
    clinical_context: Dict[str, Any],
    agent_results: Dict[str, Any],
    current_state: Dict[str, Any],
) -> Dict[str, Any]:

    expertise_context = get_expertise(clinical_context)

    visit_ctx = (
        current_state.get(
            "visit_assessment_context", normalize_visit_assessment_context({})
        )
        if isinstance(current_state, dict)
        else normalize_visit_assessment_context({})
    )

    payload = {
        "expertise_context": safe_json(expertise_context),
        "specialty_scope": safe_json(get_scope(clinical_context)),
        "request": safe_json(clinical_context.get("request", {})),
        "doctor_context": safe_json(clinical_context.get("doctor_context", {})),
        "patient_context": safe_json(clinical_context.get("patient_context", {})),
        "authoritative_sources": safe_json(
            clinical_context.get("authoritative_sources", {})
        ),
        "secondary_graph_context": safe_json(
            clinical_context.get("secondary_graph_context", {})
        ),
        "clinical_graph": safe_json(clinical_context.get("clinical_graph", {})),
        "assessment_plan": safe_json(clinical_context.get("assessment_plan", {})),
        "current_state_reconciliation": safe_json(current_state),
        "visit_assessment_context": safe_json(visit_ctx),
        "current_run_reasoning": safe_json(agent_results),
    }

    response = await invoke_agent(
        system_prompt=build_system_prompt(CHECKPOINT_AGENT_PROMPT, expertise_context),
        user_prompt=json.dumps(payload, indent=2, default=str),
    )

    parsed = extract_json(response)

    if isinstance(parsed, dict):
        candidates = parsed.get("candidates", [])
        if not isinstance(candidates, list):
            candidates = []

        # Python-level scope guard (strict mode)
        if STRICT_SPECIALTY_SCOPE:
            before = len(candidates)
            candidates = [
                c
                for c in candidates
                if isinstance(c, dict)
                and c.get("in_specialty_scope") is not False
                and c.get("relevance") != "cross_domain"
            ]
            logger.info(
                "[PreTreatment Scope] Candidate scope filter | "
                f"before={before} | after={len(candidates)}"
            )

        parsed["candidates"] = candidates[:12]

        if parsed.get("care_state") not in VALID_CARE_STATES:
            parsed["care_state"] = current_state.get("care_state", "unknown")

        return parsed

    logger.warning("[PreTreatment 9+ Pipeline] Candidate generator returned invalid JSON")

    return {
        "agent": "checkpoint_generator",
        "care_state": current_state.get("care_state", "unknown"),
        "assessment_intent": "",
        "candidates": [],
        "status": "invalid_output",
    }


# ============================================================
# FINAL SELECTION + PREVISIT INSIGHTS
# ============================================================

CANDIDATE_SELECTION_PROMPT = """
You are the Final Clinical Assessment Selection Agent.

You receive the requesting clinician perspective, expertise_context,
specialty_scope, the reconciled current state, and candidate findings.

Two independent responsibilities:
A. select and synthesize clinician-facing assessment points;
B. generate the Previsit Insights structure (structure unchanged).

You are NOT making a treatment decision.

============================================================
CORE PURPOSE
============================================================

    ACTIVE EXPERTISE SKILLS + IN-SCOPE PATIENT CONTEXT + VISIT CONTEXT
        -> CLINICIAN-FACING ASSESSMENT POINTS

Points are a skill-driven synthesis of the patient's documented condition
through the requesting specialty's lens. They are not primarily a conflict
list, gap list, alert list or generic checklist. No hardcoded visit-number,
cycle, treatment-sequence, disease or specialty rules.

============================================================
SPECIALTY DOMINANCE AND SCOPE (STRICT)
============================================================

- The requesting clinician's specialty skill is the DOMINANT lens.
  Use its perspective, focus, questions, domains, inspection dimensions
  and relationships. Do not branch on specialty names or keywords.
- specialty_scope.primary_treatment_skill_ids identify the treatment
  skills to emphasize. Points built on those skills (treatment identity
  and status, exposure, trajectory, response, tolerance, toxicity,
  organ/function, documented decisions) come first.
- In strict mode, EVERY assessment point AND EVERY Previsit Insights item
  (stat cards, alerts, since-last-visit changes, next best action,
  toxicity items, ePRO items, trial items, collapsed parameters) must be
  about in-scope domains only. Data belonging to out-of-scope domains is
  omitted entirely - not mentioned, not counted, not summarized - even
  when richly documented or chronologically earlier.
- Exception: a dimension the specialty skill itself names as a relationship
  to inspect, limited to the part that skill names, relevance "contextual".
- Documentation volume, node counts and text volume never determine
  dominance or scope.
- Set "in_specialty_scope": true for every selected point. Relevance is
  "primary" or "contextual" (use "cross_domain" only in soft scope mode).

============================================================
SELECTION PROCESS
============================================================

For each candidate ask: which active lens makes it relevant; how directly
it serves the specialty perspective; what documented evidence supports it;
what aspect of the in-scope condition it describes; whether it is distinct;
whether another candidate covers the same state more completely.

- Conflicts are NOT the default; select one only when the specialty
  perspective makes it part of the clinical question.
- Gaps are NOT the default; select one only when the expertise makes the
  dimension relevant AND the context supports why the absence matters.
- Do not force categories (conflict, gap, readiness, safety, treatment,
  toxicity, response, disease). Do not require one point per skill,
  treatment or domain. Do not invent a fact because a skill says a
  dimension matters.
- Prefer one strong synthesized point over fragments from one dimension.
  Do not duplicate evidence under multiple titles.
- Preserve exact values, dates, units, anatomy, laterality, grades, scores,
  percentages, treatment status. Never calculate, normalize or reinterpret.
- Do not state that treatment is safe, appropriate, indicated or should
  proceed unless a documented decision says so. No prescribing, treatment
  selection, dose calculation/recommendation or invented schedules.
- Visit gate: evaluate each candidate against visit_assessment_context
  (new, ongoing, changed, resolved, current-only). Do not select solely
  because it appeared earlier; do not reject solely because it appeared
  earlier; do not manufacture changes.

MAXIMUM: five points. Five is a maximum, not a target. Return two or three
if that is all that materially matters. Never pad. Order by relevance to
the specialty perspective (priority 1 = most relevant).

WRITING: "point" states documented patient evidence; "clinical_significance"
explains why it matters now from the specialty's view without repeating
the point or adding unsupported facts. "status" is exactly one of
DOCUMENTED, PARTIALLY_DOCUMENTED, CONFLICTING, NOT_DOCUMENTED
(NOT_DOCUMENTED only when an expertise-relevant gap is justified).

============================================================
PREVISIT INSIGHTS
============================================================

The section names / JSON keys are the fixed UI structure. Labels, values,
counts, trends and content are dynamic and come only from the supplied,
IN-SCOPE context. Do not hardcode diseases, specialties, drugs, toxicity
names, lab names, biomarkers, treatments, trials, cycle rules, thresholds,
examples or keyword mappings. If unsupported, use empty values/lists or
"not documented in the supplied context". Never invent values to fill UI.

1. STAT CARDS (up to four): {"label","value","trend","trend_type"}
   Most relevant documented current-state information for this encounter
   from the specialty's view (clinical state, treatment state,
   safety/readiness, response state, newly documented state), drawn from
   in-scope data. trend_type: up | down | flat | unknown. Use "unknown"
   unless supported by current and comparison data. Never calculate a
   trend without both.

2. ALERTS: [{"title","text","source","severity"}] - clinically supported
   alerts, safety concerns, decision/clearance considerations for in-scope
   domains. A possible treatment modification is a consideration unless a
   clinician decision is documented.

## 3. SINCE LAST VISIT

The "since_last_visit" section must represent a genuine comparison between the CURRENT documented encounter and the PREVIOUS documented encounter.

Use this strict evidence hierarchy:

1. Explicit current encounter + previous encounter supplied in the context.
2. Explicit encounter-to-encounter changes supplied by the temporal/visit reconciliation layer.
3. Explicitly documented transition inside the current encounter.

Do NOT reconstruct a previous visit from:

* cycle number
* treatment line
* treatment sequence
* procedure number
* fraction number
* chronology alone
* older observations
* previous AI-generated output
* graph summaries that do not identify the previous encounter
* assumptions about what must have happened previously.

### When BOTH current and previous visits are available

Populate:

{
"current_visit": {...},
"previous_visit": {...},
"changes": [...]
}

Include only meaningful changes that are:

* explicitly documented,
* supported by both sides of the comparison,
* relevant to the current specialty,
* relevant to the current encounter,
* materially useful to the clinician.

Each change must contain:

{
"parameter": "",
"value": "",
"status": "",
"status_type": ""
}

Do not create a change merely because two values are different.

A difference becomes a "change" only when the supplied encounter context supports that these values belong to the current and previous visits and the comparison is clinically meaningful.

### When the previous visit is NOT available

Do NOT invent a previous visit.

Do NOT populate previous_visit using an older observation, cycle, treatment event, or historical value.

Return:

{
"current_visit": <documented current visit information if available>,
"previous_visit": {},
"changes": []
}

However, this does NOT mean the entire Previsit Insights output should become empty.

When there is no valid previous visit comparison, the system MUST continue evaluating the current specialty-scoped clinical state and MUST attempt to produce a NEXT BEST ACTION from the current encounter evidence.

### Current-encounter transitions

If the current encounter explicitly documents a transition such as:

* treatment completed
* treatment started
* treatment held
* treatment changed
* treatment planned
* unresolved issue identified
* assessment pending
* follow-up planned
* information required before the next clinical step

that transition may be reported as current-encounter information.

However, do NOT describe it as:

"changed since the previous visit"

unless both encounters are actually available.

Use wording equivalent to:

"Currently documented transition"

or

"Current encounter identifies..."

rather than manufacturing a historical comparison.

## 4. NEXT BEST ACTION

The "next_best_action" section must be evaluated independently of "since_last_visit".

The absence of a previous visit MUST NOT prevent generation of a next best action.

Determine the most relevant specialty-scoped next clinical step, review, follow-up, monitoring action, unresolved-information resolution step, or explicitly documented plan supported by the CURRENT supplied evidence.

Use this priority order:

1. Explicit documented plan for the current encounter.
2. Explicit pending assessment, investigation, follow-up, monitoring or review.
3. Explicit unresolved clinical issue requiring clarification.
4. A clinically material information gap identified by the active specialty skill and supported by the patient context.
5. A documented transition that identifies what must be reviewed next.
6. A specialty-relevant assessment point whose evidence clearly indicates a required review or unresolved issue.

The next best action MUST remain within the current specialty scope.

The retrieved skills determine what should receive priority within the specialty.

Do NOT allow a skill to create an action that is unsupported by patient evidence.

### Important distinction

A missing value does NOT automatically become a next action.

Only use an information gap as the next best action when:

* the information is genuinely absent from all supplied context,
* the active specialty skill makes the information relevant,
* the current encounter makes the information materially important,
* and the supplied evidence supports why resolving the gap matters.

### Action wording

Distinguish carefully between:

DOCUMENTED PLAN:
"The documented plan is to..."

DOCUMENTED FOLLOW-UP:
"Follow-up is documented for..."

INFORMATION RESOLUTION:
"Clarify/obtain the documented missing information regarding..."

CLINICIAN REVIEW:
"Review the documented finding regarding..."

CONSIDERATION:
"Consider reviewing..."

Do NOT convert a consideration into an instruction.

Do NOT prescribe treatment.

Do NOT select a drug.

Do NOT select or calculate a dose.

Do NOT invent an investigation.

Do NOT invent a treatment hold.

Do NOT create a prerequisite that is not documented or supported.

Do NOT make an autonomous clinical decision.

## 5. PREVISIT COMPLETENESS RULE

Before returning the final Previsit Insights, perform the following internal completeness check:

A. Is a valid previous encounter available?

```
YES:
    Generate "since_last_visit" when meaningful specialty-scoped
    differences exist.

NO:
    Do not fabricate a comparison.
    Keep previous_visit empty.
    Continue to NEXT BEST ACTION.
```

B. Is there a specialty-scoped next action supported by current evidence?

```
YES:
    Populate next_best_action.

NO:
    Keep next_best_action empty rather than inventing one.
```

C. If both are empty:

```
Re-evaluate:
- current encounter context
- assessment intent
- active specialty skills
- documented unresolved issues
- documented treatment state
- documented information gaps
- current assessment points
- explicit plans
- pending assessments
- follow-up/monitoring information

If an evidence-supported specialty-scoped action exists, populate
next_best_action.

If no such action exists, leave both sections empty rather than
generating unsupported clinical content.
```

### Critical rule

NEVER manufacture "since last visit" merely to avoid an empty field.

NEVER manufacture "next best action" merely to avoid an empty field.

The objective is:

```
maximum clinically useful information
+
specialty correctness
+
source fidelity
+
temporal fidelity
```

not:

```
maximum number of populated UI fields.
```


5. TOXICITY PREDICTION & EARLY INTERVENTION (in-scope treatment only):
   {"summary","elevated_count","total_count",
    "items":[{"toxicity","predicted_risk","risk_type",
              "earliest_actionable_point"}],
    "remaining":[{"toxicity","predicted_risk","risk_type"}]}
   May contain documented toxicities/symptoms/adverse events (no
   prediction needed) and supported risk predictions. Never invent a
   probability or toxicity, use a predefined toxicity list, or infer a
   toxicity solely because a treatment is present. Use exact documented
   grades. Distinguish documented / improving / worsening / persistent /
   resolved / predicted / not documented. For a documented toxicity
   without supported prediction, use a non-predictive description.

6. ePRO INBOX: {"needs_review":0,"items":[{"date","report","input",
   "triage","triage_type"}],"summary":""} - only from supplied ePRO /
   patient-reported information. Never invent records.

7. TRIAL ELIGIBILITY: {"items":[{"trial","status","status_type","note"}],
   "summary":""} - only when trial information and relevant evidence are
   supplied. Never invent trials or criteria.

8. COLLAPSED PARAMETERS: {"count":0,"summary":""} - explicitly documented
   non-actionable, stable, normal, unchanged or tolerated in-scope
   information (only when the source explicitly establishes that state).
   Do not infer normality from a number, or "stable" from an unchanged
   value. Count only distinct supported findings; do not inflate; if none,
   {"count":0,"summary":""}.

QUALITY RULES: Previsit Insights is a synthesis, not an independent source.
Preserve numbers, units, dates, anatomy, laterality, grades, scores,
percentages, identifiers and treatment status. Never convert risk ->
contraindication, consideration -> decision, finding -> diagnosis, finding
-> treatment failure, missing -> negative finding, association ->
causality.

Return JSON only:

{
  "agent": "final_assessment_selection",
  "previsit_insights": {
    "stat_cards": [
      {"label": "", "value": "", "trend": "", "trend_type": "unknown"}
    ],
    "alerts": [],
    "since_last_visit": {
      "current_visit": {},
      "previous_visit": {},
      "changes": []
    },
    "next_best_action": {"text": "", "source": ""},
    "toxicity_prediction": {
      "summary": "",
      "elevated_count": 0,
      "total_count": 0,
      "items": [],
      "remaining": []
    },
    "epro_inbox": {"needs_review": 0, "items": [], "summary": ""},
    "trial_eligibility": {"items": [], "summary": ""},
    "collapsed_parameters": {"count": 0, "summary": ""}
  },
  "assessment_points": [
    {
      "candidate_id": "",
      "category": "",
      "point": "",
      "clinical_significance": "",
      "supporting_evidence": [],
      "source": [],
      "status": "",
      "relevance": "primary",
      "in_specialty_scope": true,
      "priority": 1
    }
  ]
}
"""


def _as_list(value: Any) -> List[Any]:
    return value if isinstance(value, list) else []


def _as_dict(value: Any) -> Dict[str, Any]:
    return value if isinstance(value, dict) else {}


def normalize_previsit_insights(previsit: Any) -> Dict[str, Any]:
    """Normalize SHAPE only. No clinical content is created here."""

    previsit = _as_dict(previsit)

    # Stat cards
    cards = []
    for item in _as_list(previsit.get("stat_cards"))[:4]:
        if not isinstance(item, dict):
            continue
        trend_type = item.get("trend_type", "unknown")
        if trend_type not in {"up", "down", "flat", "unknown"}:
            trend_type = "unknown"
        cards.append({
            "label": _s(item.get("label")),
            "value": _s(item.get("value")),
            "trend": _s(item.get("trend")),
            "trend_type": trend_type,
        })

    # Alerts
    alerts = [
        {
            "title": _s(i.get("title")),
            "text": _s(i.get("text")),
            "source": _s(i.get("source")),
            "severity": _s(i.get("severity")),
        }
        for i in _as_list(previsit.get("alerts"))
        if isinstance(i, dict)
    ]

    # Since last visit
    since = _as_dict(previsit.get("since_last_visit"))
    changes = [
        {
            "parameter": _s(i.get("parameter")),
            "value": _s(i.get("value")),
            "status": _s(i.get("status")),
            "status_type": _s(i.get("status_type")),
        }
        for i in _as_list(since.get("changes"))
        if isinstance(i, dict)
    ]

    # Next best action
    nba = _as_dict(previsit.get("next_best_action"))

    # Toxicity
    tox = _as_dict(previsit.get("toxicity_prediction"))
    tox_items = [
        {
            "toxicity": _s(i.get("toxicity")),
            "predicted_risk": _s(i.get("predicted_risk")),
            "risk_type": _s(i.get("risk_type")),
            "earliest_actionable_point": _s(i.get("earliest_actionable_point")),
        }
        for i in _as_list(tox.get("items"))
        if isinstance(i, dict)
    ]
    tox_remaining = [
        {
            "toxicity": _s(i.get("toxicity")),
            "predicted_risk": _s(i.get("predicted_risk")),
            "risk_type": _s(i.get("risk_type")),
        }
        for i in _as_list(tox.get("remaining"))
        if isinstance(i, dict)
    ]

    # ePRO
    epro = _as_dict(previsit.get("epro_inbox"))
    epro_items = [
        {
            "date": _s(i.get("date")),
            "report": _s(i.get("report")),
            "input": _s(i.get("input")),
            "triage": _s(i.get("triage")),
            "triage_type": _s(i.get("triage_type")),
        }
        for i in _as_list(epro.get("items"))
        if isinstance(i, dict)
    ]

    # Trials
    trials = _as_dict(previsit.get("trial_eligibility"))
    trial_items = [
        {
            "trial": _s(i.get("trial")),
            "status": _s(i.get("status")),
            "status_type": _s(i.get("status_type")),
            "note": _s(i.get("note")),
        }
        for i in _as_list(trials.get("items"))
        if isinstance(i, dict)
    ]

    collapsed = _as_dict(previsit.get("collapsed_parameters"))

    return {
        "stat_cards": cards,
        "alerts": alerts,
        "since_last_visit": {
            "current_visit": _as_dict(since.get("current_visit")),
            "previous_visit": _as_dict(since.get("previous_visit")),
            "changes": changes,
        },
        "next_best_action": {
            "text": _s(nba.get("text")),
            "source": _s(nba.get("source")),
        },
        "toxicity_prediction": {
            "summary": _s(tox.get("summary")),
            "elevated_count": tox.get("elevated_count", 0),
            "total_count": tox.get("total_count", 0),
            "items": tox_items,
            "remaining": tox_remaining,
        },
        "epro_inbox": {
            "needs_review": epro.get("needs_review", 0),
            "items": epro_items,
            "summary": _s(epro.get("summary")),
        },
        "trial_eligibility": {
            "items": trial_items,
            "summary": _s(trials.get("summary")),
        },
        "collapsed_parameters": {
            "count": collapsed.get("count", 0),
            "summary": _s(collapsed.get("summary")),
        },
    }


def normalize_assessment_points(points: Any) -> List[Dict[str, Any]]:
    """Validate status/relevance/priority; enforce strict scope in code."""

    normalized = []

    for index, point in enumerate(_as_list(points)[:MAX_FINAL_ASSESSMENT_POINTS]):

        if not isinstance(point, dict):
            continue

        if point.get("status") not in VALID_EVIDENCE_STATUS:
            continue

        relevance = point.get("relevance", "primary")
        if relevance not in VALID_RELEVANCE:
            relevance = "primary"

        if STRICT_SPECIALTY_SCOPE:
            if relevance == "cross_domain":
                continue
            if point.get("in_specialty_scope") is False:
                continue

        try:
            priority = float(point.get("priority", index + 1))
        except (TypeError, ValueError):
            priority = index + 1

        normalized.append({
            **point,
            "relevance": relevance,
            "in_specialty_scope": True,
            "priority": priority,
        })

    return normalized


async def select_final_assessment_points(
    clinical_context: Dict[str, Any],
    current_state: Dict[str, Any],
    candidates: Dict[str, Any],
) -> Dict[str, Any]:
    """Candidate -> clinician-facing points + Previsit Insights."""

    expertise_context = get_expertise(clinical_context)

    visit_ctx = (
        current_state.get(
            "visit_assessment_context", normalize_visit_assessment_context({})
        )
        if isinstance(current_state, dict)
        else normalize_visit_assessment_context({})
    )

    payload = {
        "request": safe_json(clinical_context.get("request", {})),
        "doctor_context": safe_json(clinical_context.get("doctor_context", {})),
        "expertise_context": safe_json(expertise_context),
        "specialty_scope": safe_json(get_scope(clinical_context)),
        "current_state_reconciliation": safe_json(current_state),
        "visit_assessment_context": safe_json(visit_ctx),
        "candidate_findings": safe_json(candidates),
        "authoritative_sources": safe_json(
            clinical_context.get("authoritative_sources", {})
        ),
        "secondary_graph_context": safe_json(
            clinical_context.get("secondary_graph_context", {})
        ),
        "visit_context": safe_json(clinical_context.get("visit_context", {})),
        "encounter_context": safe_json(clinical_context.get("encounter_context", {})),
    }

    response = await invoke_agent(
        system_prompt=build_system_prompt(
            CANDIDATE_SELECTION_PROMPT, expertise_context
        ),
        user_prompt=json.dumps(payload, indent=2, default=str),
    )

    parsed = extract_json(response)

    if not isinstance(parsed, dict):
        logger.warning("[PreTreatment 9+ Pipeline] Final selector returned invalid JSON")
        return {
            "agent": "final_assessment_selection",
            "previsit_insights": normalize_previsit_insights({}),
            "assessment_points": [],
            "status": "invalid_output",
        }

    parsed["previsit_insights"] = normalize_previsit_insights(
        parsed.get("previsit_insights", {})
    )
    parsed["assessment_points"] = normalize_assessment_points(
        parsed.get("assessment_points", [])
    )

    return parsed


# ============================================================
# SCOPE GUARD (NEW)
# ============================================================
# Removal-only safety net. It cannot add or rewrite content.
# ============================================================

SCOPE_GUARD_PROMPT = """
You are the Specialty Scope Guard.

You receive specialty_scope, the requesting clinician's specialty skill,
previsit_insights and assessment_points.

Your ONLY permitted action is REMOVAL.

Remove any assessment point or Previsit Insights item (stat card, alert,
since-last-visit change, toxicity item, remaining toxicity item, ePRO item,
trial item) whose factual core belongs to an OUT-OF-SCOPE domain as defined
by specialty_scope, unless the specialty skill itself names that
relationship as an inspection dimension.

Also:
- If the next_best_action text is about an out-of-scope domain, blank it
  ("text": "", "source": "").
- If toxicity items were removed, update toxicity_prediction total_count
  and elevated_count so they match the remaining items; update the summary
  ONLY by deleting the removed content (do not add new claims).
- If collapsed_parameters covers out-of-scope items, reduce count and edit
  the summary by deleting those parts only.
- If needs_review counts removed ePRO items, reduce it accordingly.

Forbidden:
- adding, rewording, merging, re-ranking or "improving" any item;
- adding facts;
- deciding scope from specialty names, disease names, treatment names or
  keywords.

Keep the structure identical to the input. Keep everything that is in scope
exactly as supplied.

Return JSON only:

{
  "agent": "scope_guard",
  "previsit_insights": {},
  "assessment_points": [],
  "removed_items": [
    {"location": "", "item_summary": "", "reason": ""}
  ]
}
"""


async def apply_scope_guard(
    clinical_context: Dict[str, Any],
    selected: Dict[str, Any],
) -> Dict[str, Any]:

    if not STRICT_SPECIALTY_SCOPE:
        return selected

    scope = get_scope(clinical_context)

    # Nothing to guard against if there is no out-of-scope domain.
    if scope.get("status") == "resolved" and not (
        scope.get("out_of_scope_domains")
        or scope.get("out_of_scope_data_description")
        or scope.get("excluded_treatment_skill_ids")
    ):
        return selected

    expertise_context = get_expertise(clinical_context)

    payload = {
        "specialty_scope": safe_json(scope),
        "specialty_skill": safe_json(expertise_context.get("specialty_skill", {})),
        "previsit_insights": safe_json(selected.get("previsit_insights", {})),
        "assessment_points": safe_json(selected.get("assessment_points", [])),
    }

    try:
        response = await invoke_agent(
            system_prompt=SCOPE_GUARD_PROMPT,
            user_prompt=json.dumps(payload, indent=2, default=str),
        )
    except Exception as exc:
        logger.error(f"[PreTreatment Scope] Guard call failed: {exc}")
        return selected

    parsed = extract_json(response)

    if not isinstance(parsed, dict):
        logger.warning("[PreTreatment Scope] Guard returned invalid JSON; keeping selection")
        return selected

    guarded = dict(selected)

    if isinstance(parsed.get("previsit_insights"), dict):
        guarded["previsit_insights"] = normalize_previsit_insights(
            parsed["previsit_insights"]
        )

    if isinstance(parsed.get("assessment_points"), list):
        guarded["assessment_points"] = normalize_assessment_points(
            parsed["assessment_points"]
        )

    guarded["scope_guard_removed"] = safe_json(parsed.get("removed_items", []))

    logger.info(
        "[PreTreatment Scope] Guard applied | "
        f"removed={len(_as_list(parsed.get('removed_items')))} | "
        f"points_after={len(guarded['assessment_points'])}"
    )

    return guarded


# ============================================================
# ASSESSMENT GENERATION PIPELINE
# ============================================================

async def generate_assessment_points(
    clinical_context: Dict[str, Any],
    agent_results: Dict[str, Any],
) -> Dict[str, Any]:
    """
    reconciliation -> candidates -> selection -> scope guard.
    The five-point limit is applied only after candidates are evaluated.
    """

    current_state = await reconcile_current_clinical_state(
        clinical_context=clinical_context,
        agent_results=agent_results,
    )

    enriched_context = dict(clinical_context)
    enriched_context["current_state_reconciliation"] = safe_json(current_state)

    candidates = await generate_candidate_findings(
        clinical_context=enriched_context,
        agent_results=agent_results,
        current_state=current_state,
    )

    selected = await select_final_assessment_points(
        clinical_context=enriched_context,
        current_state=current_state,
        candidates=candidates,
    )

    selected = await apply_scope_guard(
        clinical_context=enriched_context,
        selected=selected,
    )

    selected["current_state_reconciliation"] = safe_json(current_state)
    selected["candidate_count"] = len(
        candidates.get("candidates", []) if isinstance(candidates, dict) else []
    )

    return selected


# ============================================================
# EVIDENCE VERIFICATION
# ============================================================

async def verify_evidence(
    clinical_context: Dict[str, Any],
    agent_results: Dict[str, Any],
    assessment_points: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Verify selected assessment points against the source hierarchy,
    current-run evidence, visit context and specialty scope.

    IMPORTANT:
    Evidence verification has a dedicated payload contract.
    Do not route this payload through the generic run_agent wrapper,
    because run_agent nests the supplied verification context under
    `full_context`, which can hide generated_assessment_points and
    reconciliation from the verifier.
    """

    reconciliation = (
        assessment_points.get(
            "current_state_reconciliation",
            {},
        )
        if isinstance(assessment_points, dict)
        else {}
    )

    selected_points = (
        assessment_points.get("assessment_points", [])
        if isinstance(assessment_points, dict)
        else []
    )

    previsit_insights = (
        assessment_points.get("previsit_insights", {})
        if isinstance(assessment_points, dict)
        else {}
    )

    expertise_context = get_expertise(clinical_context)
    specialty_scope = get_scope(clinical_context)

    visit_assessment_context = (
        reconciliation.get(
            "visit_assessment_context",
            normalize_visit_assessment_context({}),
        )
        if isinstance(reconciliation, dict)
        else normalize_visit_assessment_context({})
    )

    verification_payload = {
        "agent": "evidence_verification",

        # -----------------------------------------------------
        # Source hierarchy
        # -----------------------------------------------------
        "authoritative_sources": safe_json(
            clinical_context.get(
                "authoritative_sources",
                {},
            )
        ),

        "secondary_graph_context": safe_json(
            clinical_context.get(
                "secondary_graph_context",
                {},
            )
        ),

        "current_run_reasoning": safe_json(
            agent_results
        ),

        # -----------------------------------------------------
        # EXACT GENERATED OUTPUT BEING VERIFIED
        # -----------------------------------------------------
        "generated_assessment_points": safe_json(
            selected_points
        ),

        "generated_previsit_insights": safe_json(
            previsit_insights
        ),

        "current_state_reconciliation": safe_json(
            reconciliation
        ),

        # -----------------------------------------------------
        # Visit context
        # -----------------------------------------------------
        "visit_assessment_context": safe_json(
            visit_assessment_context
        ),

        "visit_context": safe_json(
            clinical_context.get(
                "visit_context",
                clinical_context.get(
                    "assessment_visit_context",
                    {},
                ),
            )
        ),

        "encounter_context": safe_json(
            clinical_context.get(
                "encounter_context",
                {},
            )
        ),

        # -----------------------------------------------------
        # Specialty authority
        # -----------------------------------------------------
        "request": safe_json(
            clinical_context.get(
                "request",
                {},
            )
        ),

        "doctor_context": safe_json(
            clinical_context.get(
                "doctor_context",
                {},
            )
        ),

        "expertise_context": safe_json(
            expertise_context
        ),

        "specialty_scope": safe_json(
            specialty_scope
        ),

        "strict_specialty_scope": STRICT_SPECIALTY_SCOPE,
    }

    response = await invoke_agent(
        system_prompt=build_system_prompt(
            EVIDENCE_VERIFICATION_AGENT_PROMPT,
            expertise_context,
        ),
        user_prompt=json.dumps(
            verification_payload,
            indent=2,
            default=str,
        ),
    )

    parsed = extract_json(response)

    if not isinstance(parsed, dict):
        logger.warning(
            "[PreTreatment Verification] "
            "Evidence verification returned invalid JSON"
        )

        return {
            "agent": "evidence_verification",
            "verified_assessment_points": [],
            "excluded_assessment_points": [],
            "conflicts": [],
            "status": "invalid_output",
        }

    verified = parsed.get(
        "verified_assessment_points",
        [],
    )

    if not isinstance(verified, list):
        verified = []

    excluded = parsed.get(
        "excluded_assessment_points",
        [],
    )

    if not isinstance(excluded, list):
        excluded = []

    # ---------------------------------------------------------
    # Final Python-level specialty enforcement.
    #
    # This is NOT changed. It only protects specialty dominance.
    # ---------------------------------------------------------
    if STRICT_SPECIALTY_SCOPE:
        before = len(verified)

        verified = [
            point
            for point in verified
            if isinstance(point, dict)
            and point.get("relevance") != "cross_domain"
            and point.get("in_specialty_scope") is not False
        ]

        logger.info(
            "[PreTreatment Verification] "
            "Specialty scope filter | "
            f"before={before} | after={len(verified)}"
        )

    parsed["verified_assessment_points"] = verified
    parsed["excluded_assessment_points"] = excluded

    return parsed


# ============================================================
# FINAL OUTPUT
# ============================================================

def build_final_assessment(
    patient_id: str,
    doctor_id: str,
    encounter_id: Optional[str],
    assessment_points: Dict[str, Any],
    verification: Dict[str, Any],
    specialty_scope: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Only verified points are exposed. Priority is used for ordering and then
    stripped. Strict scope is enforced here once more in plain Python.
    """

    verified = verification.get("verified_assessment_points", [])
    if not isinstance(verified, list):
        verified = []

    def priority_value(point: Dict[str, Any]) -> float:
        try:
            return float(point.get("priority"))
        except (TypeError, ValueError):
            return float("inf")

    candidates = [p for p in verified if isinstance(p, dict) and p.get("point")]

    if STRICT_SPECIALTY_SCOPE:
        candidates = [
            p
            for p in candidates
            if p.get("relevance") != "cross_domain"
            and p.get("in_specialty_scope") is not False
        ]

    ordered = sorted(candidates, key=priority_value)[:MAX_FINAL_ASSESSMENT_POINTS]

    cleaned_points = []

    for point in ordered:
        status = point.get("status")
        relevance = point.get("relevance", "primary")

        cleaned_points.append({
            "category": point.get("category", ""),
            "point": point.get("point", ""),
            "clinical_significance": point.get("clinical_significance", ""),
            "status": status if status in VALID_EVIDENCE_STATUS else "DOCUMENTED",
            "supporting_evidence": _as_list(point.get("supporting_evidence")),
            "source": _as_list(point.get("source")),
            "relevance": relevance if relevance in VALID_RELEVANCE else "primary",
        })

    previsit_insights: Dict[str, Any] = {}
    reconciliation: Dict[str, Any] = {}

    if isinstance(assessment_points, dict):
        previsit_insights = _as_dict(assessment_points.get("previsit_insights"))
        reconciliation = _as_dict(
            assessment_points.get("current_state_reconciliation")
        )

    scope = specialty_scope or {}

    return {
        "patient_id": patient_id,
        "doctor_id": doctor_id,
        "encounter_id": encounter_id,
        "generated_at": datetime.now(timezone.utc).isoformat(),

        "previsit_insights": previsit_insights,

        "assessment_context": normalize_visit_assessment_context(
            reconciliation.get("visit_assessment_context", {})
        ),

        "assessment_points": cleaned_points,

        "specialty_scope": {
            "strict": STRICT_SPECIALTY_SCOPE,
            "status": scope.get("status", "unknown"),
            "in_scope_domains": _as_list(scope.get("in_scope_domains")),
            "out_of_scope_domains": _as_list(scope.get("out_of_scope_domains")),
            "primary_treatment_skill_ids": _as_list(
                scope.get("primary_treatment_skill_ids")
            ),
        },

        "assessment_quality": {
            "pipeline": "9plus_specialty_scoped",
            "max_points": MAX_FINAL_ASSESSMENT_POINTS,
            "actual_points": len(cleaned_points),
        },
    }


# ============================================================
# MAIN AGENT HARNESS
# ============================================================

async def run_pre_treatment_harness(
    clinical_context: Dict[str, Any],
) -> Dict[str, Any]:

    logger.info("[PreTreatment Harness] Started")

    request_context = _as_dict(clinical_context.get("request"))

    patient_id = request_context.get("patient_id")
    doctor_id = request_context.get("doctor_id")
    encounter_id = request_context.get("encounter_id")

    # ---------------------------------------------------------
    # Encounter / visit resolution (structured visit_context first,
    # graph-derived encounter_id as fallback)
    # ---------------------------------------------------------

    visit_context = _as_dict(clinical_context.get("visit_context"))
    current_visit = _as_dict(visit_context.get("current_visit"))

    if not encounter_id:
        encounter_id = current_visit.get("encounter_id")

    if not encounter_id:
        graph_data = _as_dict(
            _as_dict(clinical_context.get("clinical_graph")).get("data")
        )
        encounter_id = graph_data.get("encounter_id")

    encounter_number = current_visit.get("encounter_number")
    visit_position = None

    if encounter_number is not None:
        try:
            visit_position = int(encounter_number)
        except (TypeError, ValueError):
            visit_position = None

    logger.info(
        "[PreTreatment Harness] Identifiers | "
        f"patient={patient_id} | doctor={doctor_id} | "
        f"encounter={encounter_id} | encounter_number={encounter_number} | "
        f"visit_position={visit_position}"
    )

    if not encounter_id:
        logger.warning("[PreTreatment Harness] No encounter_id available")

    clinical_context = dict(clinical_context)
    clinical_context["assessment_visit_context"] = {
        "encounter_id": encounter_id,
        "encounter_number": encounter_number,
        "visit_position": visit_position,
        "encounter_date": current_visit.get("encounter_date"),
    }

    # ---------------------------------------------------------
    # PHASE 0 - Resolve expertise + SPECIALTY SCOPE + prune skills
    # ---------------------------------------------------------

    clinical_context = await prepare_scoped_context(clinical_context)

    # ---------------------------------------------------------
    # PHASE 1 - Plan and execute (scope-aware)
    # ---------------------------------------------------------

    agent_results = await run_planned_assessment(clinical_context=clinical_context)

    # ---------------------------------------------------------
    # PHASE 2 - Reconcile, candidates, selection, scope guard
    # ---------------------------------------------------------

    assessment_points = await generate_assessment_points(
        clinical_context=clinical_context,
        agent_results=agent_results,
    )

    if isinstance(assessment_points, dict):
        state = _as_dict(assessment_points.get("current_state_reconciliation"))
        insights = _as_dict(assessment_points.get("previsit_insights"))
        since = _as_dict(insights.get("since_last_visit"))

        logger.info(
            "[PreTreatment Harness] Generation summary | "
            f"care_state={state.get('care_state', 'unknown')} | "
            f"conflicts={len(_as_list(state.get('material_conflicts')))} | "
            f"gaps={len(_as_list(state.get('material_information_gaps')))} | "
            f"points={len(_as_list(assessment_points.get('assessment_points')))} | "
            f"stat_cards={len(_as_list(insights.get('stat_cards')))} | "
            f"alerts={len(_as_list(insights.get('alerts')))} | "
            f"visit_changes={len(_as_list(since.get('changes')))}"
        )



    # ---------------------------------------------------------
    # PHASE 3 — Verify evidence
    # ---------------------------------------------------------

    verification = await verify_evidence(
        clinical_context=clinical_context,
        agent_results=agent_results,
        assessment_points=assessment_points,
    )

    # ---------------------------------------------------------
    # DEBUG / PIPELINE VISIBILITY
    # ---------------------------------------------------------
    selected_points = (
        assessment_points.get("assessment_points", [])
        if isinstance(assessment_points, dict)
        else []
    )

    verified_points = (
        verification.get("verified_assessment_points", [])
        if isinstance(verification, dict)
        else []
    )

    excluded_points = (
        verification.get("excluded_assessment_points", [])
        if isinstance(verification, dict)
        else []
    )

    logger.info(
        "[PreTreatment Harness] Verification summary | "
        f"selected_points={len(_as_list(selected_points))} | "
        f"verified_points={len(_as_list(verified_points))} | "
        f"excluded_points={len(_as_list(excluded_points))}"
    )

    # ---------------------------------------------------------
    # PHASE 4 — Final assessment
    # ---------------------------------------------------------

    return build_final_assessment(
        patient_id=patient_id,
        doctor_id=doctor_id,
        encounter_id=encounter_id,
        assessment_points=assessment_points,
        verification=verification,
        specialty_scope=get_scope(clinical_context),
    )
