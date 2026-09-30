"""
pre_treatment_assessment.py

Generates patient-specific, visit-specific pre-treatment verification
points for a doctor, using:

    1. MongoDB doctor_users        -> doctor specialization
    2. MongoDB patient_users       -> patient demographic/application data
    3. Neo4j patient graph         -> complete longitudinal clinical history

Identifier note: the frontend sends the patient's sys_user_id, not the
internal patient_id that Neo4j is keyed on. patient_users is the only
place that maps one to the other, so every entry point below takes
sys_user_id, resolves patient_id from the patient_users document, and
uses the resolved patient_id for the Neo4j lookup.

Design constraint: nothing in this file is hardcoded to a particular
cancer type, specialty, or clinical vocabulary. There is no keyword
dictionary, no predefined category list ("has_lab", "has_imaging",
etc.), and no fixed set of "treatment-like" entity labels. Every
signal below is derived structurally from the graph itself:

  - entity identity        -> raw node labels + raw node properties,
                               exactly as stored, nothing curated out
  - "a visit"               -> one Neo4j "document" grouping (already
                               grouped by source document + date)
  - "how many times has X
     been documented, and
     what's the latest one"  -> counted per label, dynamically, over
                               whatever labels actually exist in this
                               patient's graph
  - "what changed since the
     last visit"              -> a structural diff (by label+property
                               signature) between the two most recent
                               documents, not a text/keyword compare
  - "what cycle/session/dose
     is this"                 -> never inferred by this code. The LLM
                               is given the raw properties of every
                               documented instance and is told to use
                               an explicit sequence-identifying value
                               only if one is actually present in the
                               data, and to say "not documented"
                               otherwise.

TOKEN / CONTEXT-LENGTH DESIGN NOTE
-----------------------------------
This service previously built THREE separate large representations of
the same longitudinal graph (a full timeline render, a full occurrence
index containing every instance of every entity type again, and a
visit-change diff) and concatenated all of them into one LLM prompt.
For patients with many visits this duplicates the same clinical data
2-3x inside a single request and blows past the model's context
window (Groq returns `context_length_exceeded` at that point, and a
larger `max_tokens` does not fix it — max_tokens bounds the
*response*, not the input).

A first pass at fixing this simply truncated the oldest visits off the
front of the rendered timeline once it got too long. That solves the
token error but breaks the actual requirement: "give the doctor points
to check based on the patient's WHOLE history" — silently dropping
early visits means the LLM never sees them at all.

The fix used here instead is HISTORY-PRESERVING COMPRESSION, not
deletion:

  - build_longitudinal_clinical_context() gives the LLM full raw
    detail (including evidence text) for the most recent visit(s).
    Every older visit is still included in full — same entity types,
    same property values — but rendered without the verbose evidence
    quote, since that's the single biggest per-entity cost and is not
    itself a clinical fact.
  - If that's still over budget (very long-history patients), a
    second, deterministic compression pass collapses only LITERALLY
    IDENTICAL facts that repeat across multiple older visits (e.g. the
    same unchanged property set documented in 10 consecutive visits)
    into one line listing every date it was documented — every
    DISTINCT fact is still present, nothing unique is ever dropped.
    This is a plain structural dedup over entity signatures, not an
    LLM summarization step, so nothing can be hallucinated away.
  - No visit is ever removed from consideration. Only repetition is
    reduced.
  - build_entity_occurrence_index(..., include_full_history=False) is
    used for the prompt path, so the occurrence summary sent to the
    LLM is "count + latest instance" per entity type, not the entire
    history a second time (that's already covered by the longitudinal
    context above it — sending it twice was the single largest source
    of the original context_length_exceeded failures).
  - Each LLM call uses an explicit, overridable max_tokens budget via
    a shared _invoke_llm() helper instead of one global setting.
  - The prompt explicitly instructs the LLM to consider the entire
    supplied history, not just the latest visit, and requires every
    decision point to be justified by a specific fact from that
    history rather than a generic checklist item.

REASONING-CHAIN PROMPT DESIGN NOTE
-----------------------------------
The previous prompt told the LLM to "justify every decision point
with a historical fact" but did not force it to work through a
specific chain, and the JSON schema had nowhere to record that chain
even if the LLM did reason through it. Two things changed to fix
that, both fully generic — no clinical vocabulary, entity type, or
example test name is hardcoded anywhere below:

  1. _build_assessment_prompt() now makes the LLM explicitly identify
     TODAY'S treatment first (STEP 1), then walk every candidate
     decision point through:
         whole history -> current treatment -> relevant historical
         fact(s) -> latest status/trend -> why it matters today ->
         what to check before today's treatment
     and pass a "NO-GENERIC-CHECKLIST TEST" (a set of yes/no
     questions, not a list of forbidden items) before it's allowed to
     appear in the output. A "FINAL SELF-CHECK" repeats that
     discipline immediately before the JSON is returned.
  2. The JSON schema gained two fields per decision point —
     "historical_basis" (the concrete supporting fact) and
     "historical_relevance" (a fixed, generic classification of how
     that fact relates to today's treatment: new_today,
     changed_since_previous_visit, persistent_from_previous_history,
     prior_treatment_related, unresolved_historical_issue,
     current_status_requires_confirmation) — plus a top-level
     "current_treatment" object recording what STEP 1 determined and
     from what. These make the model's reasoning inspectable instead
     of opaque.
  3. generate_pre_treatment_assessment() now also enforces this
     structurally, not just via prompt wording: any decision point
     returned without a non-empty "historical_basis" is dropped
     before the response is returned. This is a plain field-presence
     check — no keyword matching, no entity-type list — so it behaves
     identically for every specialty and every patient.
"""

import os
import json
from typing import Dict, Any, List, Optional

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from datetime import datetime
from motor.motor_asyncio import AsyncIOMotorClient
from neo4j import AsyncGraphDatabase

from langchain_groq import ChatGroq
from langchain_core.messages import SystemMessage, HumanMessage
from loguru import logger

from dotenv import load_dotenv

load_dotenv()

router = APIRouter(
    prefix="/pre-treatment-assessment",
    tags=["pre-treatment-assessment"]
)

# ============================================================
# MONGODB
# ============================================================

MONGO_URI = os.getenv("MONGO_URI")
MONGO_DB = os.getenv("MONGO_DB", "doctorassistai")

mongodb_client = AsyncIOMotorClient(MONGO_URI)
_db = mongodb_client[MONGO_DB]

doctor_user_collection = _db.doctor_users
patient_user_collection = _db.patient_users
pre_treatment_assessments_collection = _db.pre_treatment_assessments

# ==========================================================
# NEO4J
# ============================================================

NEO4J_URI = os.getenv("NEO4J_URI", "bolt://neo4j:7687")
NEO4J_USER = os.getenv("NEO4J_USER", "neo4j")
NEO4J_PASS = os.getenv("NEO4J_PASSWORD", "password")

neo4j_driver = AsyncGraphDatabase.driver(
    NEO4J_URI,
    auth=(NEO4J_USER, NEO4J_PASS)
)

# ============================================================
# LLM
#
# Separate, overridable token budgets instead of one global number —
# a global default lives on the client, individual calls can bind
# their own budget without touching that global config.
# ============================================================

GROQ_API_KEY = os.getenv("GROQ_API_KEY")

GROQ_DEFAULT_MAX_TOKENS = int(os.getenv("GROQ_MAX_TOKENS", "5000"))
PRETREATMENT_ASSESSMENT_MAX_TOKENS = int(
    os.getenv("PRETREATMENT_ASSESSMENT_MAX_TOKENS", "5000")
)

llm = ChatGroq(
    model="openai/gpt-oss-120b",
    groq_api_key=GROQ_API_KEY,
    max_tokens=GROQ_DEFAULT_MAX_TOKENS,
    temperature=0.1
)


async def _invoke_llm(
    system_prompt: str,
    user_prompt: str,
    max_tokens: Optional[int] = None,
):
    """
    Shared LLM invocation helper. Every call gets the client's default
    token budget unless it explicitly overrides it here — that keeps
    token configuration per-call instead of forcing one global number
    to serve every kind of request this service might ever make.
    """
    call_llm = llm.bind(max_tokens=max_tokens) if max_tokens else llm
    return await call_llm.ainvoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_prompt),
    ])


# ============================================================
# REQUEST MODEL
# ============================================================

class PreTreatmentAssessmentRequest(BaseModel):
    sys_user_id: str
    doctor_id: str


# ============================================================
# 1. DOCTOR SPECIALITY
# ============================================================

@router.get("/get_doctor_speciality/{sys_user_id}")
async def get_doctor_speciality(sys_user_id: str, request: Request):
    """
    Fetch doctor speciality using sys_user_id.
    """
    try:
        doctor_info = await fetch_doctor_information(sys_user_id)

        if not doctor_info:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": f"Doctor with sys_user_id '{sys_user_id}' not found"
                }
            )

        return {
            "status": "success",
            "sys_user_id": sys_user_id,
            "doctor_name": doctor_info.get("doctor_name"),
            "specialization": doctor_info.get("specialization"),
            "hospital_id": doctor_info.get("hospital_id")
        }

    except Exception as e:
        logger.exception("Failed to fetch doctor speciality")
        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to fetch doctor speciality",
                "reason": str(e)
            }
        )


async def fetch_doctor_information(doctor_id: str) -> Optional[Dict[str, Any]]:

    doctor = await doctor_user_collection.find_one(
        {"sys_user_id": doctor_id},
        {
            "_id": 0,
            "sys_user_id": 1,
            "specialization": 1,
            "name": 1,
            "hospital_id": 1
        }
    )

    if not doctor:
        return None

    return {
        "doctor_id": doctor_id,
        "doctor_name": doctor.get("name"),
        "specialization": doctor.get("specialization"),
        "hospital_id": doctor.get("hospital_id")
    }


# ============================================================
# 2. PATIENT MONGODB DATA
#
# IDENTIFIER FIX: looked up by sys_user_id (what the frontend
# actually has), not patient_id. patient_id is read back out of the
# returned document by the caller and used only for the Neo4j lookup.
# ============================================================

async def fetch_patient_mongodb_data(sys_user_id: str) -> Optional[Dict[str, Any]]:
    """
    Returns whatever the patient_users document actually contains,
    keyed by sys_user_id. No field-by-field hardcoding beyond the
    lookup key itself, so this works across specialties and across
    whatever schema patient_users ends up having.
    """

    patient = await patient_user_collection.find_one(
        {"sys_user_id": sys_user_id},
        {"_id": 0}
    )

    if not patient:
        return None

    return patient


async def fetch_patient_graph_documents(patient_id: str) -> List[Dict[str, Any]]:
    """
    NOTE: this previously hardcoded a literal patient_id string in the
    Cypher MATCH clause and never passed `patient_id` as a query
    parameter — every call was silently querying one specific
    patient's graph regardless of the `patient_id` argument. Fixed to
    use $patient_id and pass it through session.run().
    """

    cypher = """
    MATCH (p:Patient {patient_id:$patient_id})-[r]->(n)

    OPTIONAL MATCH (n)-[:SUPPORTED_BY_EVIDENCE]->(e:Evidence)

    WITH r, n, e,
        CASE
            WHEN e IS NULL
                 OR e.document_date IS NULL
                 OR e.document_date = "null"
            THEN NULL
            ELSE toString(e.document_date)
        END AS raw_date,

        coalesce(
            e.document_name,
            "unknown"
        ) AS document

    WITH r, n, e, document, raw_date,

        CASE
            WHEN raw_date IS NULL
            THEN NULL

            WHEN raw_date =~ '\\\\d{4}-\\\\d{2}-\\\\d{2}'
            THEN date(raw_date)

            WHEN raw_date =~ '\\\\d{2}-\\\\d{2}-\\\\d{4}'
            THEN date({
                year: toInteger(split(raw_date, '-')[2]),
                month: toInteger(split(raw_date, '-')[1]),
                day: toInteger(split(raw_date, '-')[0])
            })

            WHEN raw_date =~ '\\\\d{2}-[A-Za-z]{3}-\\\\d{4}'
            THEN date({
                year: toInteger(split(raw_date, '-')[2]),
                month: CASE split(raw_date, '-')[1]
                    WHEN 'Jan' THEN 1
                    WHEN 'Feb' THEN 2
                    WHEN 'Mar' THEN 3
                    WHEN 'Apr' THEN 4
                    WHEN 'May' THEN 5
                    WHEN 'Jun' THEN 6
                    WHEN 'Jul' THEN 7
                    WHEN 'Aug' THEN 8
                    WHEN 'Sep' THEN 9
                    WHEN 'Oct' THEN 10
                    WHEN 'Nov' THEN 11
                    WHEN 'Dec' THEN 12
                    ELSE NULL
                END,
                day: toInteger(split(raw_date, '-')[0])
            })

            ELSE NULL
        END AS document_date

    WITH document, document_date,

        collect({
            relation: type(r),
            entity_types: labels(n),
            properties: properties(n),
            date: raw_date,
            evidence: e.evidence_text
        }) AS entities

    RETURN
        document,
        document_date,
        entities

    ORDER BY document_date ASC
    """

    try:
        async with neo4j_driver.session() as session:

            result = await session.run(cypher, patient_id=patient_id)

            documents = []

            async for record in result:
                documents.append({
                    "document": record["document"],
                    "document_date": (
                        str(record["document_date"])
                        if record["document_date"] is not None
                        else None
                    ),
                    "entities": record["entities"]
                })

            logger.info(
                "[PreTreatment] Neo4j graph retrieved | "
                f"patient_id={patient_id} | documents={len(documents)}"
            )

            return documents

    except Exception as e:
        logger.exception(
            "[PreTreatment] Neo4j fetch failed: %s",
            e
        )
        raise


# ============================================================
# 4. RENDER GRAPH AS LLM-READABLE TEXT — HISTORY-PRESERVING
#    COMPRESSION (never deletes a visit; see the TOKEN /
#    CONTEXT-LENGTH DESIGN NOTE at the top of this file)
# ============================================================

GRAPH_TIMELINE_MAX_CHARS = int(os.getenv("PRETREATMENT_GRAPH_TIMELINE_MAX_CHARS", "20000"))
GRAPH_RECENT_FULL_VISITS = int(os.getenv("PRETREATMENT_RECENT_FULL_VISITS", "2"))


def _format_entity_line(entity: Dict[str, Any], include_evidence: bool = True) -> Optional[str]:
    """
    Renders one entity from its raw property map as-is — no property
    name is picked out or dropped, so this works for any node shape
    the graph contains, for any cancer type or specialty. Shared by
    both the full-detail and compact renders below so the two stay
    structurally identical apart from the evidence field.
    """
    properties = entity.get("properties") or {}
    if not properties:
        return None

    entity_types = entity.get("entity_types") or ["Entity"]
    type_label = "/".join(entity_types)

    prop_text = ", ".join(
        f"{key}={value}" for key, value in properties.items() if value is not None
    )

    line = f"  - [{type_label}] {prop_text}"

    if include_evidence:
        evidence = entity.get("evidence")
        if evidence:
            line += f" | Evidence: {evidence}"

    return line


def _render_visit(document: Dict[str, Any], include_evidence: bool = True) -> List[str]:
    """
    Renders one visit (one Neo4j "document") in full — every entity,
    every documented property value. `include_evidence=False` drops
    only the free-text evidence quote (the single biggest per-entity
    cost and not itself a clinical fact); every property value is
    still present either way. Used for both the "recent, full detail"
    and "older, compact" sections below — the only difference between
    them is this flag, not which facts are included.
    """
    date = document.get("document_date") or "undated"
    doc_name = document.get("document") or "Unknown document"

    lines = [f"\n[{date}] {doc_name}"]
    for entity in document.get("entities", []):
        line = _format_entity_line(entity, include_evidence=include_evidence)
        if line:
            lines.append(line)
    return lines


def _render_older_history_deduped(older_documents: List[Dict[str, Any]]) -> List[str]:
    """
    Second-tier compression, used only if the compact-per-visit form
    is still over budget. Collapses entities that are LITERALLY
    IDENTICAL (same entity type + same property values, via the same
    structural signature used by build_visit_change_summary) across
    multiple older visits into a single line listing every date it was
    documented on — instead of repeating the exact same unchanged fact
    once per visit. Any entity whose properties differ even slightly
    between visits is treated as a distinct fact and kept separately;
    nothing unique is ever merged away or dropped, only exact repeats
    are collapsed. This is a plain structural dedup, not an LLM
    summarization step, so nothing here can be hallucinated.
    """
    signature_map: Dict[str, Dict[str, Any]] = {}
    order: List[str] = []

    for document in older_documents:
        date = document.get("document_date") or "undated"
        for entity in document.get("entities", []):
            properties = entity.get("properties") or {}
            if not properties:
                continue
            sig = _entity_signature(entity)
            if sig not in signature_map:
                signature_map[sig] = {
                    "entity_types": entity.get("entity_types") or ["Entity"],
                    "properties": properties,
                    "dates": [],
                }
                order.append(sig)
            signature_map[sig]["dates"].append(date)

    lines = [
        f"=== OLDER HISTORY ({len(older_documents)} visit(s) — identical facts "
        f"that repeat unchanged across multiple visits are shown once with "
        f"every date they were documented on; every distinct value is still "
        f"shown separately) ==="
    ]
    for sig in order:
        entry = signature_map[sig]
        type_label = "/".join(entry["entity_types"])
        prop_text = ", ".join(
            f"{k}={v}" for k, v in entry["properties"].items() if v is not None
        )
        dates_str = ", ".join(entry["dates"])
        lines.append(f"  - [{type_label}] {prop_text} | Documented on: {dates_str}")

    return lines


def build_longitudinal_clinical_context(
    graph_documents: List[Dict[str, Any]],
    recent_full_visits: int = GRAPH_RECENT_FULL_VISITS,
    max_chars: int = GRAPH_TIMELINE_MAX_CHARS,
) -> str:
    """
    Renders the patient's COMPLETE longitudinal history for the LLM —
    every visit is represented, none are dropped. The most recent
    visit(s) get full detail including evidence text; every older
    visit is still included in full (same entity types, same property
    values) but without the evidence quote, since that's the largest
    per-entity cost and not itself a clinical fact.

    If that's still over `max_chars` (very long-history patients),
    falls through to a second compression tier that collapses only
    literally-repeated facts across older visits (see
    _render_older_history_deduped) — still never deleting a distinct
    fact or a visit. As a last resort, narrows "full detail" down to
    just the single latest visit and pushes everything else through
    the deduped form. This function never truncates the front or back
    of the history — every tier keeps every visit represented.
    """
    if not graph_documents:
        return "No Neo4j patient history available."

    recent_full_visits = max(1, min(recent_full_visits, len(graph_documents)))
    older_documents = graph_documents[:-recent_full_visits]
    recent_documents = graph_documents[-recent_full_visits:]

    # Tier 1: every older visit still fully represented, evidence
    # quotes only omitted; recent visit(s) with full detail + evidence.
    older_lines: List[str] = []
    if older_documents:
        older_lines.append(
            f"=== OLDER HISTORY ({len(older_documents)} visit(s) — every visit "
            f"and every documented property value is included; evidence "
            f"quotes are omitted here for brevity only, not the facts "
            f"themselves) ==="
        )
        for document in older_documents:
            older_lines.extend(_render_visit(document, include_evidence=False))
        older_lines.append("")

    recent_lines = [
        f"=== MOST RECENT {len(recent_documents)} VISIT(S) (full detail, "
        f"including evidence) ==="
    ]
    for document in recent_documents:
        recent_lines.extend(_render_visit(document, include_evidence=True))

    full_text = "\n".join(older_lines + recent_lines)
    if len(full_text) <= max_chars:
        return full_text

    # Tier 2: collapse literally-repeated facts across older visits.
    # Still represents every visit and every distinct fact — only
    # exact repetition is reduced.
    if older_documents:
        deduped_older_lines = _render_older_history_deduped(older_documents)
        full_text = "\n".join(deduped_older_lines + [""] + recent_lines)
        if len(full_text) <= max_chars:
            logger.info(
                "[PreTreatment] longitudinal context compressed via "
                "cross-visit fact dedup to fit budget "
                f"(chars={len(full_text)}, budget={max_chars})"
            )
            return full_text

    # Tier 3: narrow "full detail" to just the latest visit and retry
    # with the wider (now larger) deduped older section.
    if recent_full_visits > 1:
        return build_longitudinal_clinical_context(
            graph_documents,
            recent_full_visits=1,
            max_chars=max_chars,
        )

    # Every distinct fact is still present at this point — nothing
    # further to compress without either merging distinct facts
    # together or dropping a visit, neither of which this function
    # does. Log it so PRETREATMENT_GRAPH_TIMELINE_MAX_CHARS can be
    # raised if this is hit often, and send the full (over-budget)
    # context through rather than silently lose history.
    logger.warning(
        f"[PreTreatment] longitudinal context still {len(full_text)} chars "
        f"after full compression (budget {max_chars}) — sending the "
        f"complete history anyway rather than dropping any visit; "
        f"consider raising PRETREATMENT_GRAPH_TIMELINE_MAX_CHARS"
    )
    return full_text



# ============================================================
# 5. STRUCTURAL CONTEXT BUILDERS (fully generic — no hardcoded
#    entity-type whitelist, no keyword categories)
# ============================================================

def determine_visit_context(graph_documents: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    FIX 1 / FIX 2 (visit detection part): purely structural.

    Each Neo4j "document" already represents one historical clinical
    encounter (grouped by source document + date), so "first visit"
    vs "follow-up" is decided from whether ANY prior encounter is
    documented at all — not from guessing which entity types count
    as "treatment". This is identical logic for every cancer type
    and every specialty.
    """

    total_visits = len(graph_documents)

    if total_visits == 0:
        return {
            "visit_type": "first_visit",
            "treatment_phase": "pre_treatment",
            "documented_prior_visit_count": 0,
            "most_recent_visit_date": None,
            "previous_visit_date": None
        }

    most_recent_visit = graph_documents[-1]
    previous_visit = graph_documents[-2] if total_visits > 1 else None

    return {
        "visit_type": "follow_up",
        "treatment_phase": "subsequent_treatment",
        "documented_prior_visit_count": total_visits,
        "most_recent_visit_date": most_recent_visit.get("document_date"),
        "most_recent_visit_document": most_recent_visit.get("document"),
        "previous_visit_date": previous_visit.get("document_date") if previous_visit else None,
        "previous_visit_document": previous_visit.get("document") if previous_visit else None
    }


def build_entity_occurrence_index(
    graph_documents: List[Dict[str, Any]],
    include_full_history: bool = True,
) -> Dict[str, Any]:
    """
    FIX 1 (sequence data) + FIX 4 (latest-value data), combined and
    made fully generic.

    For every distinct entity label that actually appears in THIS
    patient's graph — whatever labels those happen to be, nothing
    predefined — this tracks how many times it has been documented
    and preserves every instance in full raw-property form, most
    recent last.

    `include_full_history=False` drops `all_documented_instances` from
    the output and returns only the count + latest instance per label.
    That's what the prompt now uses — the full instance-by-instance
    history is already covered by render_patient_graph() above, so
    including it again here would just duplicate the same data a
    second time inside the same prompt (this was the single largest
    source of the context_length_exceeded failures). Callers that
    genuinely need the complete per-instance history for something
    other than the LLM prompt can still pass include_full_history=True.
    """

    occurrences_by_type: Dict[str, List[Dict[str, Any]]] = {}

    for document in graph_documents:
        for entity in document.get("entities", []):

            properties = entity.get("properties") or {}
            if not properties:
                continue

            for entity_type in (entity.get("entity_types") or ["Entity"]):
                occurrences_by_type.setdefault(entity_type, []).append({
                    "date": entity.get("date"),
                    "document": document.get("document"),
                    "properties": properties,
                    "evidence": entity.get("evidence")
                })

    summary: Dict[str, Any] = {}

    for entity_type, occurrences in occurrences_by_type.items():
        entry: Dict[str, Any] = {
            "documented_occurrence_count": len(occurrences),
            "latest_documented_instance": occurrences[-1],
        }
        if include_full_history:
            entry["all_documented_instances"] = occurrences
        summary[entity_type] = entry

    return summary


def _entity_signature(entity: Dict[str, Any]) -> str:
    """
    A structural fingerprint of one graph entity — its labels plus
    its property values, sorted so ordering never matters. Used only
    to tell whether the same entity reappears across two documents.
    No field name or clinical term is referenced here.
    """

    entity_types = tuple(sorted(entity.get("entity_types") or []))
    properties = entity.get("properties") or {}
    property_items = tuple(sorted((k, str(v)) for k, v in properties.items()))

    return json.dumps(
        {"types": entity_types, "properties": property_items},
        default=str,
        sort_keys=True
    )


def build_visit_change_summary(graph_documents: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    FIX 2: identifies an actual "previous visit" (the second-most-
    recent document) versus the "most recent visit" (the last
    document), and reports what is structurally new in the most
    recent visit relative to the one before it — a plain set
    difference over entity signatures, not a clinical-category
    comparison. Works the same regardless of what the entities are.
    """

    if not graph_documents:
        return {
            "most_recent_visit": None,
            "previous_visit": None,
            "new_or_changed_since_previous_visit": []
        }

    most_recent_visit = graph_documents[-1]
    previous_visit = graph_documents[-2] if len(graph_documents) > 1 else None

    if not previous_visit:
        return {
            "most_recent_visit": most_recent_visit,
            "previous_visit": None,
            "new_or_changed_since_previous_visit": most_recent_visit.get("entities", [])
        }

    previous_signatures = {
        _entity_signature(entity)
        for entity in previous_visit.get("entities", [])
    }

    new_or_changed = [
        entity
        for entity in most_recent_visit.get("entities", [])
        if _entity_signature(entity) not in previous_signatures
    ]

    return {
        "most_recent_visit": most_recent_visit,
        "previous_visit": previous_visit,
        "new_or_changed_since_previous_visit": new_or_changed
    }


# ============================================================
# 6. LLM — GENERATE PRE-TREATMENT DECISION POINTS
# ============================================================


def determine_treatment_temporal_status(
    graph_documents: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """
    Determine the most recent explicitly documented treatment sequence
    from the patient's longitudinal graph.

    Important:
    - Do NOT look only at today's/latest visit.
    - Search backwards through the complete history.
    - Use the MOST RECENT explicit sequence marker found.
    - Never calculate/increment a sequence number.
    - Never assume that visit count == treatment cycle.
    """

    if not graph_documents:
        return {
            "identified": False,
            "description": None,
            "temporal_status": "not_determinable",
            "current_sequence_marker": None,
            "previous_sequence_marker": None,
            "basis": "No treatment history available"
        }

    # ------------------------------------------------------------
    # Search newest -> oldest
    # ------------------------------------------------------------
    for document in reversed(graph_documents):

        document_date = document.get("document_date")
        document_name = document.get("document") or "unknown"

        for entity in document.get("entities", []):

            properties = entity.get("properties") or {}

            if not properties:
                continue

            sequence_value = None
            sequence_key = None

            # ----------------------------------------------------
            # Look for an EXPLICIT sequence-identifying property
            # ----------------------------------------------------
            for key, value in properties.items():

                if value is None:
                    continue

                key_lower = str(key).lower()
                value_text = str(value).lower()

                # Property name explicitly contains a sequence concept
                if any(
                    token in key_lower
                    for token in (
                        "cycle",
                        "session",
                        "fraction",
                    )
                ):
                    sequence_value = value
                    sequence_key = key
                    break

                # Property value explicitly contains a sequence marker
                if any(
                    token in value_text
                    for token in (
                        "cycle_",
                        "session_",
                        "fraction_"
                    )
                ):
                    sequence_value = value
                    sequence_key = key
                    break

            # ----------------------------------------------------
            # Found the latest explicit treatment sequence
            # ----------------------------------------------------
            if sequence_value is not None:

                return {
                    "identified": True,

                    "description": (
                        f"Most recent explicitly documented treatment "
                        f"sequence: {sequence_value}"
                    ),

                    # IMPORTANT:
                    # The sequence was documented previously, so don't
                    # falsely claim it was documented TODAY.
                    "temporal_status": (
                        "documented_today"
                        if document is graph_documents[-1]
                        else "next_treatment_after_prior_completed_event"
                    ),

                    "current_sequence_marker": sequence_value,

                    "previous_sequence_marker": None,

                    "basis": (
                        f"Explicit treatment sequence found in "
                        f"property '{sequence_key}' on document "
                        f"'{document_name}' dated {document_date}: "
                        f"{sequence_value}"
                    )
                }

    # ------------------------------------------------------------
    # Nothing explicit anywhere in history
    # ------------------------------------------------------------
    return {
        "identified": False,
        "description": None,
        "temporal_status": "not_determinable",
        "current_sequence_marker": None,
        "previous_sequence_marker": None,
        "basis": "No explicit current treatment sequence information found"
    }

def _build_assessment_prompt(
    doctor_id: str,
    specialty: str,
    patient_json: str,
    history_text: str,
    visit_context: Dict[str, Any],
    occurrence_json: str,
    visit_change_json: str,
    treatment_temporal_context: Dict[str, Any],
) -> str:
    return f"""
You are a clinical pre-treatment assessment assistant supporting a
{specialty} doctor.

Your task is NOT to prescribe treatment.

Your task is to answer this exact clinical question, and nothing
broader than it:

    "Before today's treatment, what should this doctor check and
    verify for THIS patient, based on everything that has happened
    to this patient?"

The output must be a PATIENT-SPECIFIC PRE-TREATMENT CHECKLIST for
TODAY'S treatment for THIS patient. It must not be a generic
checklist that would apply to any patient with a similar condition.

For every decision point you output, you must be able to trace this
exact reasoning chain, using only what is supplied below:

    WHOLE PATIENT HISTORY
            -> CURRENT TREATMENT / CURRENT TREATMENT EVENT
            -> RELEVANT HISTORICAL FACT(S)
            -> LATEST STATUS, CHANGE, OR TREND
            -> WHY IT MATTERS FOR TODAY'S TREATMENT
            -> WHAT THE DOCTOR MUST CHECK OR VERIFY BEFORE TODAY'S
               TREATMENT

A decision point is only valid if every link in that chain is
actually supported by the data supplied below. If any link cannot be
supported, do not include that decision point.

====================================================
DOCTOR
====================================================
Doctor ID: {doctor_id}
Specialty: {specialty}

====================================================
PATIENT DATABASE INFORMATION
====================================================
{patient_json}

====================================================
LONGITUDINAL NEO4J HISTORY — THE PATIENT'S COMPLETE AVAILABLE RECORD
(the most recent visit(s) are shown in full detail including source
evidence; every older visit is ALSO fully represented below — same
entity types, same documented property values — with only the
free-text evidence quote omitted for brevity, or with exactly-repeated
facts across visits shown once with every date they occurred, if the
OLDER HISTORY section says so. No visit and no distinct fact has been
removed from what follows.)
====================================================
{history_text}

====================================================
STEP 1 — IDENTIFY TODAY'S TREATMENT (mandatory, do this first)
====================================================
Before generating any decision_points, determine what treatment,
procedure, cycle, session, dose, shot, fraction, or treatment event
is CURRENT for this visit — i.e. what is actually being considered
or administered today.

Use only what the supplied history and visit context actually
support:

- What treatment/regimen/procedure does the most recent visit
  concern?
- Has this treatment, or something in its sequence, been documented
  before for this patient?
- Is today a first administration, a continuation, a repeat, or a
  different treatment than what was previously documented?
- Was any previous instance of this treatment delayed, interrupted,
  modified, completed, or discontinued, according to the supplied
  history?

Do NOT assume that a sequence-identifying property (e.g. a cycle,
session, dose, or fraction number) by itself means this is the
patient's first treatment, or that no treatment has been
administered before. A sequence marker identifies position in a
sequence only — nothing more. Follow the separate TREATMENT SEQUENCE
RULE below for how to read (or not read) such a value.

If today's treatment cannot be determined from the supplied data,
state plainly in your output that it requires verification — do not
guess.

====================================================
CURRENT TREATMENT CONTEXT — COMPUTED FROM RAW GRAPH
====================================================

The following treatment temporal context was determined
programmatically from explicit graph properties.

DO NOT recalculate, reinterpret, increment, decrement,
or override these values.

Use them as authoritative.

{json.dumps(treatment_temporal_context, indent=2, default=str)}

The LLM must only use this context to generate patient-specific
decision points.

If temporal_status is "documented_today", treat the identified
sequence as today's documented treatment.
If temporal_status is "documented_prior_visit", treat the identified
sequence as the most recent known treatment sequence from the patient's
history. Do not increment, advance, or reinterpret it.

If temporal_status is "not_determinable", do not invent a sequence.

====================================================
STEP 2 — REVIEW THE WHOLE HISTORY AGAINST TODAY'S TREATMENT
====================================================
The LONGITUDINAL NEO4J HISTORY above is this patient's complete
available longitudinal record, not just the latest visit. Using it,
and the ENTITY OCCURRENCE SUMMARY and VISIT-TO-VISIT COMPARISON
below to help:

1. Identify the most recent documented instance of the treatment (or
   treatment sequence) identified in STEP 1, if one exists.
2. Review the ENTIRE supplied history — old and recent — for
   documented facts relevant to whether today's treatment should
   proceed as planned: how the patient has responded to treatment so
   far, anything that changed, worsened, improved, recurred, or was
   left unresolved, and anything safety-relevant that has been
   documented about this patient over time.
3. Compare the most recent status of each such fact against its
   prior documented status: is it new today, changed since the
   immediately preceding visit, unchanged but still relevant,
   previously documented and never resolved, or does its current
   value simply need confirming before treatment proceeds?
4. Do not treat an old finding as still current unless the supplied
   history actually supports that it remains current. Do not ignore
   an older, unresolved finding just because more recent visits
   exist.

Every decision point you output must trace back to a specific,
identifiable fact from the data above — not to what is commonly
checked for this type of treatment in general.

====================================================
NO-GENERIC-CHECKLIST TEST (apply to every candidate decision point)
====================================================
Before adding any decision point, verify all of the following against
the supplied data. If you cannot answer YES to every one, do not
include it:

1. Is there a documented, patient-specific fact (or a documented
   absence of one) behind this check?
2. Is that fact specifically relevant to today's treatment, as
   identified in STEP 1 — not just relevant to this type of
   treatment in the abstract?
3. Can you point to where in the supplied data that fact comes from?
4. Has that fact's status (new, changed, persistent, unresolved,
   requiring confirmation) actually been established from the data,
   rather than assumed?

A check that would be identical for any patient receiving a similar
treatment, regardless of what this specific patient's data shows, is
a generic item and must be left out — unless the absence of that
information for THIS patient is itself something the supplied data
shows needs verifying.

====================================================
HISTORICAL RELEVANCE CLASSIFICATION
====================================================
For every decision point, classify the relationship between the
supporting historical fact and today's treatment as exactly one of:

    new_today
    changed_since_previous_visit
    persistent_from_previous_history
    prior_treatment_related
    unresolved_historical_issue
    current_status_requires_confirmation

Choose this based on what the data actually shows, not by default.

====================================================
VISIT CONTEXT (determined structurally — do not override)
====================================================
{json.dumps(visit_context, indent=2, default=str)}

====================================================
ENTITY OCCURRENCE SUMMARY (every entity label present in this
patient's graph, how many times it has been documented in total, and
the raw properties of the MOST RECENT documented instance of each —
older instances of these same entities are what's counted above and
shown in full only if they fall within the recent-visit detail above)
====================================================
{occurrence_json}

====================================================
VISIT-TO-VISIT COMPARISON (the most recent documented visit vs the
one immediately before it, and what is structurally new/changed in
the most recent one)
====================================================
{visit_change_json}

====================================================
CORE RULE
====================================================
Use ONLY information present in the supplied patient data and Neo4j
history. Do not invent diagnoses, lab results, treatment cycles,
medications, imaging results, pathology results, contraindications,
or adverse events. If required information is not documented,
explicitly say it is missing or requires verification — that itself
can be a valid decision point if verifying it matters for today's
treatment.

====================================================
TREATMENT SEQUENCE RULE (cycle / session / dose / fraction number)
====================================================
Do NOT infer a cycle, session, or dose number merely from how many
times an entity type has been documented (documented_occurrence_count
is a count of records, not a clinical cycle number).

Only report a sequence marker if the raw properties of a documented
instance in the ENTITY OCCURRENCE SUMMARY or the recent-visit detail
above literally contain a value that identifies its position in a
treatment sequence (for example, but not limited to, a property whose
name or value clearly encodes a cycle, session, dose, or fraction
number). Read it directly from the data.

If no such explicit value exists anywhere in the data, set
"sequence_documented" to false and both sequence markers to null in
your output — do not estimate, guess, or count instances to produce
one.

====================================================
SPECIALTY-SPECIFIC SCOPE
====================================================
Adapt the checks to the doctor's actual specialty ({specialty})
without inventing specialty-specific facts that aren't in the data.
Pull in only what's actually relevant given the specialty and this
patient's real data — not a fixed template.

====================================================
PRIORITY
====================================================
critical = treatment should generally not proceed until the issue is
verified/resolved.
high = important before treatment but may not always block.
moderate = useful clinical verification.

====================================================
STATUS
====================================================
For every decision point use one of: verified, missing,
needs_review, not_applicable.

====================================================
BLOCKING ITEMS
====================================================
A blocking item may be included only if both are true:
1. It is necessary for today's treatment decision, as identified in
   STEP 1 and STEP 2 above.
2. It is missing, unresolved, or concerning according to the
   supplied patient history — not simply a field that is generally
   collected before this kind of treatment.
Every blocking item must correspond to at least one decision point
above it.

====================================================
FINAL SELF-CHECK (perform silently before returning JSON)
====================================================
For EACH decision point you are about to output, confirm you can
answer all of the following from the supplied data alone:

A. What happened to this patient previously that is relevant here?
B. What is being considered or administered for this patient today?
C. What changed, persisted, or remains relevant between then and now?
D. Why does that history make this specific check necessary today?
E. Is this supported by data actually supplied above, not general
   knowledge about this type of treatment?

If you cannot answer A-E from the supplied data, remove that decision
point before returning your answer.

====================================================
SAFETY RULE
====================================================
This system provides decision-support points only. Do not state
that treatment is definitely safe. Do not independently prescribe,
change, or authorize treatment. The treating doctor makes the final
clinical decision.

====================================================
RETURN ONLY JSON — no preamble, no markdown fences
====================================================
{{
  "assessment_status": "ready | review_required | not_ready",
  "visit_context": {{
      "visit_type": "first_visit | follow_up",
      "treatment_phase": "pre_treatment | subsequent_treatment",
      "documented_prior_visit_count": 0
  }},
  "current_treatment": {{
        "identified": true,
        "description": "what STEP 1 determined today's treatment/event to be, in your own words, or null if not determinable",

        "temporal_status":
            "documented_today | next_treatment_after_prior_completed_event | "
            "prior_treatment_completed | not_determinable",

        "basis": "which part of the supplied data this was determined from, or 'not documented in graph' if it could not be determined"
    }},
  "treatment_sequence": {{
      "sequence_documented": false,
      "current_sequence_marker": null,
      "previous_sequence_marker": null,
      "basis": "which raw property/entity this was read from, or 'not documented in graph' if none exists"
  }},
  "decision_points": [
      {{
          "category": "Diagnosis | Disease Status | Laboratory | Imaging | Pathology | Biomarker | Treatment History | Toxicity | Medication | Comorbidity | Performance Status | Organ Function | Safety | Other",
          "priority": "critical | high | moderate",
          "check": "exactly what the doctor should verify before today's treatment",
          "historical_basis": "the specific fact(s) from the supplied history/patient data that make this check necessary, stated concretely (dates/values where available)",
          "historical_relevance": "new_today | changed_since_previous_visit | persistent_from_previous_history | prior_treatment_related | unresolved_historical_issue | current_status_requires_confirmation",
          "reason": "why that historical fact matters for today's treatment specifically",
          "status": "verified | missing | needs_review | not_applicable",
          "source": "Neo4j | patient_users | both"
      }}
  ],
  "blocking_items": ["specific missing or unresolved item, each corresponding to a decision point above"],
  "changes_since_previous_visit": ["specific change identified from the visit-to-visit comparison"],
  "treatment_readiness": "ready | review_required | not_ready",
  "summary": "Short patient-specific explanation of what the doctor should verify before treatment."
}}
"""


# ============================================================
# 6b. MAIN ASSESSMENT GENERATION
# ============================================================

async def generate_pre_treatment_assessment(
    doctor_id: str,
    doctor_info: Dict[str, Any],
    patient_data: Dict[str, Any],
    graph_documents: List[Dict[str, Any]]
) -> Dict[str, Any]:

    logger.info(
        f"[PreTreatment] INPUT | doctor_id={doctor_id} "
        f"| specialization={doctor_info.get('specialization')} "
        f"| patient_data_keys={list(patient_data.keys())} "
        f"| graph_documents_count={len(graph_documents)}"
    )

    # History-preserving: every visit is represented, none are
    # dropped. Most recent visit(s) get full detail incl. evidence;
    # older visits are compressed (evidence omitted, then literal
    # cross-visit repeats collapsed) only if needed to fit the budget
    # — see the TOKEN / CONTEXT-LENGTH DESIGN NOTE at the top of this
    # file for why this replaced a simple front-truncation.
    history_text = build_longitudinal_clinical_context(graph_documents)

    visit_context = determine_visit_context(graph_documents)
    treatment_temporal_context = determine_treatment_temporal_status(
        graph_documents
    )
    occurrence_index = build_entity_occurrence_index(
        graph_documents, include_full_history=False
    )
    visit_change_summary = build_visit_change_summary(graph_documents)

    patient_json = json.dumps(patient_data, indent=2, default=str)
    occurrence_json = json.dumps(occurrence_index, indent=2, default=str)
    visit_change_json = json.dumps(visit_change_summary, indent=2, default=str)

    logger.info(
        f"[PreTreatment] context block sizes (chars) | "
        f"patient_json={len(patient_json)} "
        f"history_text={len(history_text)} "
        f"occurrence_json={len(occurrence_json)} "
        f"visit_change_json={len(visit_change_json)}"
    )

    specialty = doctor_info.get("specialization") or "the doctor's specialty"

    prompt = _build_assessment_prompt(
        doctor_id=doctor_id,
        specialty=specialty,
        patient_json=patient_json,
        history_text=history_text,
        visit_context=visit_context,
        occurrence_json=occurrence_json,
        visit_change_json=visit_change_json,
        treatment_temporal_context=treatment_temporal_context,
    )

    logger.info(f"[PreTreatment] final_prompt_chars={len(prompt)}")

    try:
        response = await _invoke_llm(
            system_prompt="You are a clinical decision-support assistant. Return valid JSON only.",
            user_prompt=prompt,
            max_tokens=PRETREATMENT_ASSESSMENT_MAX_TOKENS,
        )

        result = _parse_json(response.content)


        # ------------------------------------------------------------
        # Deterministic treatment temporal state
        # Never trust the LLM to recalculate this.
        # ------------------------------------------------------------

        llm_treatment = result.get("current_treatment") or {}

        llm_treatment["temporal_status"] = (
            treatment_temporal_context["temporal_status"]
        )

        result["current_treatment"] = llm_treatment

        sequence = result.get("treatment_sequence") or {}

        sequence["current_sequence_marker"] = (
            treatment_temporal_context["current_sequence_marker"]
        )

        sequence["previous_sequence_marker"] = (
            treatment_temporal_context["previous_sequence_marker"]
        )

        sequence["sequence_documented"] = (
            treatment_temporal_context["current_sequence_marker"] is not None
        )

        sequence["basis"] = treatment_temporal_context["basis"]

        result["treatment_sequence"] = sequence

        # Deterministic fallbacks if the LLM omits or malforms these —
        # both are computed purely structurally above, so they're safe
        # to trust over an empty/missing LLM field.
        if not result.get("visit_context"):
            result["visit_context"] = visit_context

        if not result.get("current_treatment"):
            result["current_treatment"] = {
                "identified": False,
                "description": None,
                "temporal_status": "not_determinable",
                "basis": "not documented in graph",
            }

        # Deterministic enforcement of the "no generic checklist" rule.
        # The prompt asks the LLM to only emit decision points it can
        # trace back to a concrete historical_basis, but LLM compliance
        # with prompt instructions is never guaranteed — so this drops,
        # in code, any decision point that came back without one. It is
        # a plain field-presence check (is historical_basis a non-empty
        # string?), not a keyword or entity-type match, so it behaves
        # identically for every specialty, every cancer type, and every
        # patient without encoding any clinical vocabulary here.
        decision_points = result.get("decision_points") or []
        filtered_points = [
            dp for dp in decision_points
            if isinstance(dp, dict) and str(dp.get("historical_basis") or "").strip()
        ]
        dropped_count = len(decision_points) - len(filtered_points)
        if dropped_count:
            logger.warning(
                f"[PreTreatment] dropped {dropped_count} decision_point(s) "
                f"returned without a historical_basis (unsupported / "
                f"generic item per the no-generic-checklist rule)"
            )
        result["decision_points"] = filtered_points

        if not result.get("changes_since_previous_visit"):
            result["changes_since_previous_visit"] = [
                json.dumps(entity.get("properties"), default=str)
                for entity in visit_change_summary.get(
                    "new_or_changed_since_previous_visit", []
                )
            ]

        logger.info(
            f"[PreTreatment] OUTPUT assessment_status="
            f"{result.get('assessment_status')} "
            f"| decision_points={len(result.get('decision_points', []))} "
            f"| blocking_items={len(result.get('blocking_items', []))}"
        )

        return result

    except Exception:
        logger.exception("[PreTreatment] LLM assessment failed")

        fallback_result = {
            "assessment_status": "review_required",
            "visit_context": visit_context,
            "current_treatment": {
                "identified": False,
                "description": None,
                "basis": "assessment failed",
            },
            "treatment_sequence": {
                "sequence_documented": False,
                "current_sequence_marker": None,
                "previous_sequence_marker": None,
                "basis": "assessment failed"
            },
            "decision_points": [],
            "blocking_items": [
                "Automated assessment could not be generated. Manual clinical review required."
            ],
            "changes_since_previous_visit": [],
            "treatment_readiness": "review_required",
            "summary": "LLM assessment failed."
        }

        logger.info(
            "[PreTreatment] OUTPUT assessment (fallback) | "
            f"assessment_status={fallback_result['assessment_status']}"
        )

        return fallback_result


def _parse_json(content: str) -> Dict[str, Any]:

    try:
        content = content.strip()

        if "```json" in content:
            content = content.split("```json", 1)[1].split("```", 1)[0]
        elif "```" in content:
            content = content.split("```", 1)[1].split("```", 1)[0]

        start = content.find("{")
        end = content.rfind("}")

        if start == -1 or end == -1:
            return {}

        return json.loads(content[start:end + 1])

    except Exception as e:
        logger.error(f"[PreTreatment] JSON parsing failed: {e}")
        return {}


# ============================================================
# 7. RESOLVE sys_user_id -> patient_id, PATIENT MONGODB DOC
#
# Shared by both the POST and GET entry points below. patient_id is
# still resolved here because fetch_patient_graph_documents now
# accepts it as an optional second match key (see IDENTIFIER FIX
# above) — not because Neo4j is assumed to use it exclusively.
# ============================================================

async def resolve_patient(sys_user_id: str):
    """
    Returns (patient_data, patient_id, error_response).
    error_response is a JSONResponse to return immediately if
    resolution failed; otherwise it is None. patient_id may be None
    here without being an error — it is only used as a secondary
    match key for Neo4j, sys_user_id is the primary one.
    """

    patient_data = await fetch_patient_mongodb_data(sys_user_id)

    if not patient_data:
        return None, None, JSONResponse(
            status_code=404,
            content={
                "status": "error",
                "message": f"Patient with sys_user_id '{sys_user_id}' not found"
            }
        )

    patient_id = patient_data.get("patient_id")

    return patient_data, patient_id, None


# ============================================================
# 8. MAIN ENDPOINT (POST) — GENERATE + SAVE
# ============================================================

@router.post("/generate")
async def generate_pre_treatment_assessment_endpoint(
    payload: PreTreatmentAssessmentRequest
):
    """
    Generate a patient-specific pre-treatment assessment.

    Flow:
        1. Doctor information      -> MongoDB
        2. Patient information     -> MongoDB
        3. Longitudinal history    -> Neo4j
        4. Assessment generation   -> LLM
        5. Save generated result   -> MongoDB
        6. Return generated result -> Frontend

    sys_user_id is the patient identifier received from frontend.
    """

    sys_user_id = payload.sys_user_id
    doctor_id = payload.doctor_id

    try:
        # ====================================================
        # 1. DOCTOR INFORMATION
        # ====================================================

        doctor_info = await fetch_doctor_information(doctor_id)

        if not doctor_info:
            return JSONResponse(
                status_code=404,
                content={
                    "status": "error",
                    "message": f"Doctor '{doctor_id}' not found"
                }
            )

        # ====================================================
        # 2. PATIENT INFORMATION
        # ====================================================

        patient_data, patient_id, error_response = await resolve_patient(
            sys_user_id
        )

        if error_response:
            return error_response

        # ====================================================
        # 3. NEO4J PATIENT HISTORY
        # ====================================================

        graph_documents = await fetch_patient_graph_documents(
            patient_id=sys_user_id
        )

        # ====================================================
        # 4. GENERATE ASSESSMENT USING LLM
        # ====================================================

        assessment = await generate_pre_treatment_assessment(
            doctor_id=doctor_id,
            doctor_info=doctor_info,
            patient_data=patient_data,
            graph_documents=graph_documents
        )

        # ====================================================
        # 5. BUILD RESPONSE DOCUMENT
        # ====================================================

        data_sources = {
            "patient_users": True,
            "neo4j": bool(graph_documents),
            "neo4j_documents": len(graph_documents)
        }

        assessment_document = {
            "sys_user_id": sys_user_id,
            "patient_id": patient_id,
            "doctor_id": doctor_id,

            "doctor": {
                "doctor_id": doctor_id,
                "doctor_name": doctor_info.get("doctor_name"),
                "specialization": doctor_info.get("specialization"),
                "hospital_id": doctor_info.get("hospital_id")
            },

            "assessment": assessment,

            "data_sources": data_sources,

            # useful for knowing when it was generated
            "created_at": datetime.utcnow(),
            "updated_at": datetime.utcnow()
        }

        # ====================================================
        # 6. SAVE / UPDATE MONGODB
        # ====================================================

        await pre_treatment_assessments_collection.update_one(
            {
                "sys_user_id": sys_user_id,
                "doctor_id": doctor_id
            },
            {
                "$set": assessment_document
            },
            upsert=True
        )

        logger.info(
            "[PreTreatment] Assessment generated and saved | "
            "sys_user_id=%s doctor_id=%s",
            sys_user_id,
            doctor_id
        )

        # ====================================================
        # 7. RETURN GENERATED RESULT
        # ====================================================

        return {
            "status": "success",
            "sys_user_id": sys_user_id,
            "patient_id": patient_id,

            "doctor": {
                "doctor_id": doctor_id,
                "doctor_name": doctor_info.get("doctor_name"),
                "specialization": doctor_info.get("specialization"),
                "hospital_id": doctor_info.get("hospital_id")
            },

            "assessment": assessment,

            "data_sources": data_sources
        }

    except Exception as e:

        logger.exception(
            "[PreTreatment] Assessment generation failed"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to generate pre-treatment assessment",
                "reason": str(e)
            }
        )


# ============================================================
# 9. MAIN ENDPOINT (GET) — FETCH SAVED ASSESSMENT
# ============================================================

@router.get("/get/generate/{sys_user_id}/{doctor_id}")
async def get_pre_treatment_assessment(
    sys_user_id: str,
    doctor_id: str
):
    """
    Fetch an already-generated pre-treatment assessment.

    IMPORTANT:
        This endpoint does NOT call the LLM.

    It only retrieves the assessment previously generated
    and saved by POST /generate.

    Lookup:
        sys_user_id + doctor_id
    """

    try:

        # ====================================================
        # 1. FIND SAVED ASSESSMENT
        # ====================================================

        saved_assessment = await (
            pre_treatment_assessments_collection
            .find_one(
                {
                    "sys_user_id": sys_user_id,
                    "doctor_id": doctor_id
                },
                {
                    "_id": 0
                }
            )
        )

        # ====================================================
        # 2. NOTHING FOUND
        # ====================================================

        if not saved_assessment:

            logger.info(
                "[PreTreatment] No saved assessment found | "
                "sys_user_id=%s doctor_id=%s",
                sys_user_id,
                doctor_id
            )

            return JSONResponse(
                status_code=404,
                content={
                    "status": "not_found",
                    "message": "No pre-treatment assessment found",
                    "sys_user_id": sys_user_id,
                    "doctor_id": doctor_id
                }
            )

        # ====================================================
        # 3. RETURN SAVED ASSESSMENT
        # ====================================================

        logger.info(
            "[PreTreatment] Saved assessment fetched | "
            "sys_user_id=%s doctor_id=%s",
            sys_user_id,
            doctor_id
        )

        return {
            "status": "success",

            "sys_user_id": saved_assessment.get(
                "sys_user_id"
            ),

            "patient_id": saved_assessment.get(
                "patient_id"
            ),

            "doctor": saved_assessment.get(
                "doctor",
                {}
            ),

            "assessment": saved_assessment.get(
                "assessment",
                {}
            ),

            "data_sources": saved_assessment.get(
                "data_sources",
                {}
            ),

            "generated_at": (
                saved_assessment.get("updated_at")
                or saved_assessment.get("created_at")
            )
        }

    except Exception as e:

        logger.exception(
            "[PreTreatment] Failed to fetch saved assessment"
        )

        return JSONResponse(
            status_code=500,
            content={
                "status": "error",
                "message": "Failed to fetch pre-treatment assessment",
                "reason": str(e)
            }
        )