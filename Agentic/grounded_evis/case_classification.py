"""
grounded_evis/case_classification.py
==============================================================
REWRITTEN per your instruction: case_type/care_setting classification is
now an LLM call (matching today's ambulance.py A0 CaseRouterAgent
pattern), using the same best-available model as Stage 1/3
(llm_client.get_best_available_llm()) — no cost-saving cheap-model swap.

The registered_incident_type ground-truth override is preserved exactly
as today's A0 has it: if the patient's registration incident_type
contains a trauma keyword, case_type is forced to "trauma" regardless of
what the LLM says, since registration data doesn't depend on dictation
wording or timing the way free-text classification does. Stage 2's
deterministic is_trauma trigger is ALSO checked as a second override, for
the same reason (regex-computed, more trustworthy for this one field than
a free-text classification call).

Note the asymmetry with Stage 1/2/3/4: this classification call is NOT
grounding-checked the way facts/claims are, because case_type/care_setting
are routing metadata (which reference blocks and role-scope text to use),
not clinical claims that reach the patient-facing output. An incorrect
case_type produces a worse-fitting reference-block selection, not a
fabricated finding in the output — worth confirming you agree this class
of error doesn't need the same grounding enforcement Stage 4 applies to
claims.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

try:
    from langchain_core.messages import HumanMessage, SystemMessage
except ImportError:
    # Fallback shim ONLY for environments without langchain_core installed
    # (e.g. this sandbox, which has no network access to pip-install it).
    # The real deployment already depends on langchain_core via ambulance.py
    # and will use the real classes — this shim is never hit there.
    class SystemMessage:  # type: ignore
        def __init__(self, content):
            self.content = content

    class HumanMessage:  # type: ignore
        def __init__(self, content):
            self.content = content
try:
    from loguru import logger
except ImportError:
    # Fallback shim ONLY for environments without loguru installed (this
    # sandbox has no network to pip-install it). Production already
    # depends on loguru via ambulance.py and will use the real logger.
    import logging as _logging

    class _LoguruShim:
        def __init__(self):
            self._logger = _logging.getLogger("grounded_evis")

        def info(self, msg, *a, **k):
            self._logger.info(msg)

        def warning(self, msg, *a, **k):
            self._logger.warning(msg)

        def error(self, msg, *a, **k):
            self._logger.error(msg)

        def debug(self, msg, *a, **k):
            self._logger.debug(msg)

    logger = _LoguruShim()

from Agentic.clinical_shared.keyword_triggers import TRAUMA_MECHANISM_KEYWORDS
from .schema import GroundedFact, TriggerFlags

CLASSIFY_SYSTEM_PROMPT = """You are a triage classification assistant for an emergency \
medical AI pipeline. Your ONLY job is to read grounded clinical facts and decide the case \
type and care setting. You do NOT diagnose or treat, and you do NOT invent facts — you only \
classify based on what is given to you.

Always respond with valid JSON only, no prose, no markdown fences.
"""


def _parse_json_object(text: str) -> Dict:
    if not text:
        return {}
    text = text.strip()
    text = re.sub(r"```json", "", text)
    text = re.sub(r"```", "", text)
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if match:
        text = match.group(0)
    try:
        parsed = json.loads(text)
        return parsed if isinstance(parsed, dict) else {}
    except Exception:
        return {}


def _format_facts_for_prompt(grounded_facts: List[GroundedFact]) -> str:
    lines = []
    for fact in grounded_facts:
        lines.append(
            f"[{fact['fact_id']}] category={fact.get('category')} "
            f"value={json.dumps(fact.get('value'), default=str)}"
        )
    return "\n".join(lines) if lines else "(no grounded facts)"


async def classify_case(
    grounded_facts: List[GroundedFact],
    triggers: TriggerFlags,
    registered_incident_type: Optional[str],
    llm: Any,
) -> Dict[str, str]:
    """
    Returns {"case_type": ..., "care_setting": ..., "rationale": ...}.
    Only ever fed GROUNDED facts (never raw text directly) and Stage 2's
    already-computed trigger flags, so the classification call can't be
    swayed by anything Stage 2 already determined isn't real.
    """
    facts_block = _format_facts_for_prompt(grounded_facts)
    fired_triggers = [k for k, v in triggers.items() if k != "trigger_basis" and v is True]

    user_prompt = f"""Classify this emergency case from the grounded facts below.
Do not invent anything beyond what is listed — if the facts are ambiguous or thin, say so in
your rationale rather than guessing confidently.

GROUNDED FACTS:
{facts_block}

TRIGGERS ALREADY FIRED (computed deterministically, not by you — treat as ground truth):
{", ".join(fired_triggers) if fired_triggers else "(none)"}

Decide:
1. case_type — one of: "trauma" | "cardiorespiratory" | "neurological" | "toxicology" | \
"obstetric" | "general_medical" | "unknown"
   (if is_trauma is in the fired-triggers list above, case_type MUST be "trauma")
2. care_setting — "prehospital_ems" | "ed_or_inpatient" | "unknown", based on whether the
   documented facts imply field/BLS-level care or hospital/ED-level care already under way
   (e.g. facts mentioning NIV/BiPAP, IV medications, or cardiac monitoring imply
   "ed_or_inpatient").

Return ONLY valid JSON:
{{"case_type": "...", "care_setting": "...", "rationale": "one sentence"}}
"""

    response = await llm.ainvoke([
        SystemMessage(content=CLASSIFY_SYSTEM_PROMPT),
        HumanMessage(content=user_prompt),
    ])
    parsed = _parse_json_object(response.content)

    case_type = parsed.get("case_type", "unknown")
    care_setting = parsed.get("care_setting", "unknown")
    rationale = parsed.get("rationale", "")

    if registered_incident_type and TRAUMA_MECHANISM_KEYWORDS.search(registered_incident_type):
        if case_type != "trauma":
            logger.warning(
                f"case_classification OVERRIDE: LLM classified case_type={case_type!r} "
                f"but registration incident_type={registered_incident_type!r} indicates "
                f"trauma. Forcing case_type='trauma'."
            )
        case_type = "trauma"
        rationale = (
            f"Registration incident_type={registered_incident_type!r} confirms a trauma "
            f"mechanism; used as ground truth ahead of the LLM's own classification. "
            f"(LLM's own read: {rationale})"
        )

    if triggers.get("is_trauma") and case_type != "trauma":
        logger.warning(
            f"case_classification OVERRIDE: LLM classified case_type={case_type!r} but "
            f"Stage 2's is_trauma trigger fired. Forcing case_type='trauma'."
        )
        case_type = "trauma"

    return {"case_type": case_type, "care_setting": care_setting, "rationale": rationale}