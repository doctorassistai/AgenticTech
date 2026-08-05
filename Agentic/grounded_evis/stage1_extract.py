"""
grounded_evis/stage1_extract.py
==============================================================
STAGE 1 · EXTRACT — literal-only extraction, large model.

Structural difference from today's ambulance.py A1: there is NO mandatory
nested schema. The model returns a flat JSON list of facts; it only emits
an entry for something actually stated. There is no
"anticoagulation_status.on_anticoagulant_or_antiplatelet: null" slot that
exists on every case whether or not anticoagulation is relevant — if
nothing anticoagulant-related is in the text, no fact of that category
exists in the output at all.

Every fact MUST carry evidence_text (a short verbatim quote) and
source_entry_id. Stage 2 verifies both before anything downstream may
treat a fact as real.

No diagnosis, risk level, "suspected X", or triage colour is permitted
here — the system prompt says so explicitly and repeatedly, and Stage 2's
grounding check cannot catch a claim that never had a factual anchor to
begin with, so the prompt-level restriction here matters more than usual.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from langchain_core.messages import HumanMessage, SystemMessage

from .schema import Fact, next_fact_id

EXTRACT_SYSTEM_PROMPT = """You are a literal clinical-text extraction tool. You do NOT diagnose, \
assess risk, or interpret. You extract only what is explicitly stated in the source text.

STRICT RULES:
1. Every fact you return MUST include a verbatim (or near-verbatim) evidence_text quote from \
the specific source entry you claim it came from. If you cannot quote it, do not include it.
2. NEVER include: a diagnosis, a suspected condition, a risk level, a triage colour, a severity \
label, or any inference beyond what the text literally says. "Patient mechanism suggests fall" \
is fine (mechanism, literal). "Patient may have internal bleeding" is FORBIDDEN (inference).
3. Do NOT fill in a fact for something not mentioned. There is no requirement to comment on \
anticoagulation, age, or bleeding if the text doesn't mention them — omit the fact entirely \
rather than emitting a null/negative placeholder.
4. If the same parameter is stated in multiple entries (e.g. HR reported twice), emit a \
SEPARATE fact for each occurrence with its own source_entry_id — do not merge or average them.
5. Output ONLY a JSON array. No prose, no markdown fences, no commentary.

Return format — a JSON array where each item is:
{
  "category": "demographic|vital|consciousness|mechanism|symptom|exam_finding|intervention|medication_mention|medical_history|timeline_event",
  "value": <the literal extracted value — string, number, or small object>,
  "source_entry_id": "<the entry id this came from, e.g. ENTRY-2>",
  "evidence_text": "<short verbatim quote from that entry supporting this fact>",
  "confidence": "High|Moderate|Low"
}
"""


def _build_entry_id_map(entries: List[Dict]) -> Dict[str, str]:
    """Assigns stable entry ids (ENTRY-1, ENTRY-2, ...) in chronological order,
    used both in the prompt and by Stage 2 when looking up raw text to
    ground-check against."""
    return {f"ENTRY-{i + 1}": e for i, e in enumerate(entries)}


def _format_entries_for_prompt(entry_id_map: Dict[str, Dict]) -> str:
    parts = []
    for entry_id, entry in entry_id_map.items():
        source = entry.get("_source", "unknown")
        text = (entry.get("conversation") or entry.get("extracted_text") or "").strip()
        parts.append(f"[{entry_id} | source={source}]\n{text}")
    return "\n\n".join(parts)


def _parse_json_array(text: str) -> List[Dict]:
    if not text:
        return []
    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\[.*\]", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


async def extract_facts(
    entries: List[Dict],
    registered_incident_type: str | None,
    llm: Any,
) -> tuple[List[Fact], Dict[str, Dict]]:
    """
    Returns (facts, entry_id_map). entry_id_map is needed by Stage 2 to
    look up raw text for grounding checks, so it's returned alongside the
    facts rather than recomputed later.
    """
    entry_id_map = _build_entry_id_map(entries)
    entries_block = _format_entries_for_prompt(entry_id_map)

    registration_block = ""
    if registered_incident_type:
        registration_block = (
            f"\nPATIENT REGISTRATION GROUND TRUTH: incident registered as "
            f"\"{registered_incident_type}\". This is a separate, authoritative "
            f"fact — include it as one fact with category=registration_ground_truth "
            f"and source_entry_id=REGISTRATION, evidence_text=the incident type string.\n"
        )

    user_prompt = f"""Extract every literal clinical fact from the entries below.

{entries_block}
{registration_block}
Return ONLY the JSON array described in the system prompt. Nothing else.
"""

    response = await llm.ainvoke([
        SystemMessage(content=EXTRACT_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ])
    raw_items = _parse_json_array(response.content)

    facts: List[Fact] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        if not item.get("evidence_text") or not item.get("source_entry_id"):
            # No evidence anchor at all -> not even eligible for Stage 2's
            # grounding check. Drop here rather than pass along a fact
            # that can never be verified.
            continue
        fact: Fact = {
            "fact_id": next_fact_id(facts),
            "category": str(item.get("category", "unknown")),
            "value": item.get("value"),
            "source_entry_id": str(item.get("source_entry_id")),
            "evidence_text": str(item.get("evidence_text", "")),
            "confidence": str(item.get("confidence", "Moderate")),
        }
        facts.append(fact)

    return facts, entry_id_map