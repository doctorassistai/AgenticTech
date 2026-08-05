"""
grounded_evis/stage3_interpret.py
==============================================================
STAGE 3 · INTERPRET — large model, only fed:
  - grounded Stage 1 facts (never ungrounded/dropped ones)
  - Stage 2's trigger flags
  - ONLY the reference blocks whose matching trigger fired

Every generated claim MUST carry evidence_fact_ids referencing real
Stage-1 fact_ids. This module does not verify those citations resolve —
that is Stage 4's job (ground_check_claims). Stage 3's prompt explicitly
tells the model an unresolvable citation gets the claim discarded, so
there's no incentive to fabricate one — but the ENFORCEMENT is Stage 4,
not this prompt instruction. Per the task's explicit warning: a prompt
instruction alone is not treated as the defense here.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List

from langchain_core.messages import HumanMessage, SystemMessage

from .reference_blocks import get_active_reference_blocks
from .schema import Claim, GroundedFact, TriggerFlags, next_claim_id

INTERPRET_SYSTEM_PROMPT = """You are a senior emergency physician performing clinical \
interpretation. You are given ONLY facts that have already been verified against the source \
text — you do not see the raw conversation directly, and you must not assume anything beyond \
what is listed as a fact below.

STRICT RULES:
1. EVERY claim you produce MUST include "evidence_fact_ids": a list of one or more fact_ids \
from the GROUNDED FACTS list below. A claim with an empty evidence_fact_ids list will be \
DISCARDED entirely, UNLESS its category is "data_gap" (data gaps describe an absence, so they \
are exempt from needing positive evidence).
2. Do NOT cite a fact_id that isn't in the GROUNDED FACTS list below. An unresolvable citation \
gets the whole claim discarded — citing one does not help you, it only wastes the claim.
3. If your reasoning depends on a clinical pattern from one of the CLINICAL REFERENCE blocks \
below, set "trigger_tag" to the trigger name that block is associated with (given at the top \
of each block). A claim tagged with a trigger that did not fire will be discarded, so do not \
invent relevance to a pattern whose trigger isn't active — if the trigger isn't listed as \
ACTIVE TRIGGERS below, you were not shown that reference block for a reason.
4. hedge_level MUST be one of: "observed" (directly restates a grounded fact's clinical \
significance), "suspected" (a clinical impression — MUST be phrased as suspected/possible, \
never confirmed, unless a fact explicitly states a clinician already diagnosed it), \
"recommendation" (an action/precaution), or "data_gap" (an explicit missing/ambiguous \
data point).
5. If ZERO triggers are active and the grounded facts show normal vitals with no concerning \
findings, overall risk_level MUST be Low or Moderate — do not invent a High/Critical risk \
claim to seem thorough. A quiet, unremarkable case should produce a quiet, unremarkable output.
6. Output ONLY a JSON array. No prose, no markdown fences, no commentary.

Return format — a JSON array where each item is:
{
  "category": "risk_level|suspected_diagnosis|trigger_pattern_note|precaution|immediate_action|hospital_prep_item|monitoring_alert|data_gap|escalation_trigger",
  "value": <the claim content — string or small object>,
  "evidence_fact_ids": ["F001", "F004"],
  "trigger_tag": "<trigger name this depends on, or null if not trigger-dependent>",
  "hedge_level": "observed|suspected|recommendation|data_gap"
}
"""


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


def _format_facts_for_prompt(grounded_facts: List[GroundedFact]) -> str:
    lines = []
    for fact in grounded_facts:
        lines.append(
            f"[{fact['fact_id']}] category={fact.get('category')} "
            f"value={json.dumps(fact.get('value'), default=str)} "
            f"(evidence: \"{fact.get('evidence_text', '')}\")"
        )
    return "\n".join(lines) if lines else "(no grounded facts)"


def _format_active_triggers(triggers: TriggerFlags) -> str:
    fired = [k for k, v in triggers.items() if k != "trigger_basis" and v is True]
    return ", ".join(fired) if fired else "(none fired)"

def _dedupe_raw_items(raw_items: List[Dict]) -> List[Dict]:
    """Defensive guard against LLM output-repetition loops (observed: Groq
    llama-3.3-70b-versatile occasionally re-emits the entire claims array
    a second time within one completion, doubling every claim). Dedupes
    on (category, value, evidence_fact_ids, trigger_tag) — NOT on
    claim_id, since claim_id is assigned downstream by next_claim_id and
    doesn't exist yet at this point. This is intentionally exact-match:
    it should only collapse true repeats, never two claims that happen to
    share a category but differ in content."""
    seen = set()
    deduped = []
    for item in raw_items:
        if not isinstance(item, dict):
            deduped.append(item)
            continue
        key = (
            item.get("category"),
            json.dumps(item.get("value"), sort_keys=True, default=str),
            tuple(sorted(item.get("evidence_fact_ids") or [])),
            item.get("trigger_tag"),
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(item)
    return deduped

async def interpret(
    grounded_facts: List[GroundedFact],
    triggers: TriggerFlags,
    case_type: str,
    care_setting: str,
    prior_action_context: str,
    llm: Any,
) -> List[Claim]:
    facts_block = _format_facts_for_prompt(grounded_facts)
    active_triggers_block = _format_active_triggers(triggers)
    reference_block = get_active_reference_blocks(triggers)

    user_prompt = f"""CASE CONTEXT:
case_type: {case_type}
care_setting: {care_setting}
ACTIVE TRIGGERS (only these reference patterns are relevant — do not tag a claim with a \
trigger not in this list): {active_triggers_block}

GROUNDED FACTS (the ONLY things you may treat as true — every claim must cite fact_ids from \
this list):
{facts_block}

PRIOR CLINICAL ACTION CONTEXT (clinician's own words only — never AI-generated diagnostic \
text; do not re-suggest anything listed as already done):
{prior_action_context}

{reference_block}

Produce your clinical interpretation as the JSON array described in the system prompt. \
Include at minimum: one risk_level claim, and a data_gap claim for anything clinically \
important that is missing from the grounded facts above (e.g. no vitals at all, unclear \
mechanism) rather than guessing.
"""
    response = await llm.ainvoke([
        SystemMessage(content=INTERPRET_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ])

    raw_items = _parse_json_array(response.content)

    print(f"[stage3_interpret] raw_items count={len(raw_items)}")
    for i, item in enumerate(raw_items):
        print(f"  [{i}] {json.dumps(item, sort_keys=True, default=str)}")

    raw_items_pre_dedup = raw_items
    raw_items = _dedupe_raw_items(raw_items)

    if len(raw_items) < len(raw_items_pre_dedup):
        print(
            f"[stage3_interpret] deduped {len(raw_items_pre_dedup)} -> {len(raw_items)} claims"
        )

    claims: List[Claim] = []
    for item in raw_items:
        if not isinstance(item, dict):
            continue
        category = str(item.get("category", "unknown"))
        evidence_ids = item.get("evidence_fact_ids") or []
        if not isinstance(evidence_ids, list):
            evidence_ids = []
        claim: Claim = {
            "claim_id": next_claim_id(claims),
            "category": category,
            "value": item.get("value"),
            "evidence_fact_ids": [str(x) for x in evidence_ids],
            "trigger_tag": item.get("trigger_tag") or None,
            "hedge_level": str(item.get("hedge_level", "suspected")),
        }
        claims.append(claim)

    return claims