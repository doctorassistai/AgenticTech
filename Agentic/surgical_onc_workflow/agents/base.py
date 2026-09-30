"""BaseDashboardAgent — the shared skeleton all 12 module agents follow.

Contract for a subclass:
  - MODULE_ID   : "m1".."m12"
  - TITLE       : the module <h3> exactly as in dashboardConfig.js
  - PARAMETERS  : the exact ordered row names for this module (must match the config)
  - _slice(state) -> dict : pull ONLY this module's data from the shared state
  - _prompt(data) -> str  : the instruction (base supplies a strong default)

Three anti-hallucination layers (see PLAN §4):
  1. Pydantic defaults on ParameterRow ('Not available' / neutral).
  2. Deterministic empty-slice guard — skip the LLM entirely, emit default rows.
  3. _reconcile_rows() forces the output back onto the exact PARAMETERS list, so the
     LLM can neither drop a parameter nor invent one the config doesn't render.

Data-extraction policy (user decision): agents MAY read the record's own prose
(pac.otherHistory, mdtComments, narration, remarks) and extract grounded values.
'Not available' is reserved for data that is genuinely absent — not merely unstructured.
"""

from typing import Any, Dict, List

from langchain_core.messages import HumanMessage, SystemMessage
from loguru import logger

from ..state import ModuleResult, ParameterRow

SYSTEM_PROMPT = (
    "You populate ONE module of a surgical-oncology dashboard by aggregating a patient's "
    "record into a fixed table. You are an aggregator, not a diagnostician. "
    "Return ONLY the structured object requested."
)


class BaseDashboardAgent:
    MODULE_ID: str = ""
    TITLE: str = ""
    PARAMETERS: List[str] = []

    def __init__(self, llm):
        # llm is a ChatGroq; bind the structured-output schema once.
        self.llm = llm
        self.structured = llm.with_structured_output(ModuleResult)

    # --- subclasses override these two -------------------------------------

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError

    def _prompt(self, data: Dict[str, Any]) -> str:
        return (
            f"MODULE: {self.TITLE}\n"
            f"Return exactly one row for EACH of these parameters, using these EXACT names:\n"
            f"{self.PARAMETERS}\n\n"
            "RULES:\n"
            "- Use ONLY the DATA below. You MAY read narrative/prose fields and extract a "
            "grounded value from them, but do NOT infer, guess, or invent anything not "
            "supported by the text.\n"
            "- If a parameter is genuinely absent from the DATA, set finding='Not available', "
            "status='neutral', statusLabel='Not Available', action='No action.'\n"
            "- COMPLETE EVERY POPULATED ROW: whenever 'finding' is a real value (anything other than "
            "'Not available'), you MUST also fill the rest of that row — never leave a populated row with "
            "blank cells, because the UI renders any blank cell as 'Not available'. Specifically: pick a "
            "'statusLabel' from the PILL VOCABULARY below, set 'status' to that word's tier, give a "
            "concrete 'action', and set 'reference' whenever this module names an expected value/standard "
            "for that row.\n"
            "- PILL VOCABULARY — 'statusLabel' MUST be exactly one of these words and 'status' MUST be its "
            "tier. The word decides the pill color, so text and color can never disagree:\n"
            "    - status='ok'    (GENUINELY reassuring / done): Normal, Clear, Complete, Negative, "
            "Resectable, Optimized, Ready, Approved, Concordant\n"
            "    - status='watch'  (needs review / pending / borderline): Review, Pending, Borderline, "
            "Partial, Draft\n"
            "    - status='alert'  (abnormal / act now): Critical, Abnormal, Positive, Unresectable\n"
            "    - status='flag'   (notable engine finding): Key Finding, Upstaged, Downstaged\n"
            "    - status='neutral' (a captured but NEUTRAL fact — staging, procedure, approach, plan): Noted\n"
            "  PILL RULES: NEVER restate the parameter name (do NOT use 'TNM', 'Stage', 'Procedure', "
            "'Strategy', etc. — that is not a signal). Default a real-but-neutral fact to 'Noted' "
            "(status='neutral') — most staging/procedure/planning rows are 'Noted'. Reserve the green "
            "'ok' words for findings that are genuinely reassuring; never mark a plain descriptive fact "
            "green. Use the red 'alert' words only when the DATA states an abnormal/critical result.\n"
            "- 'reference' = the expected/normal value or the standard this row is judged against "
            "(short); leave '' if not applicable. 'action' = a short next step.\n"
            "- OUTPUT SHAPE: return a SINGLE ModuleResult object whose 'rows' field is the list of "
            "row objects. Do NOT return a bare array of rows — the rows MUST be nested under the "
            "'rows' key of one object.\n\n"
            f"DATA:\n{data}"
        )

    def _reasoning_license(self) -> str:
        """Shared DECISION-SUPPORT licence + hard boundaries — the single source of the
        m7/m2 'LLM clinical-knowledge' guardrail. Any module that fills the
        'Reference / Expected' column and judges the finding against it prepends this to
        its per-parameter guide, so the licence never drifts between modules: the agent
        MAY apply general guideline knowledge to name the expected standard and judge the
        finding, but the patient-specific FACTS come strictly from the record and are
        never invented. See m7_adjuvant / m2_staging for the precedent."""
        return (
            "This is a DECISION-SUPPORT module, not a transcription table. For every row you "
            "must fill THREE things, not one: the finding (from the record), the expected STANDARD "
            "it is judged against ('reference'), and a JUDGEMENT of the finding vs that standard "
            "(the pill + a concrete 'action'). A row that only echoes the record into 'finding' and "
            "leaves reference='Not available' / action='No action.' has FAILED — it adds nothing.\n"
            "LLM CLINICAL-KNOWLEDGE LICENCE (same rules as the adjuvant module): you MAY apply your "
            "general surgical-oncology guideline knowledge (NCCN / ESMO / AJCC-style, or the "
            "recognised operational / quality standard for this module) to name the applicable "
            "expected standard in 'reference' and to judge whether the finding meets it.\n"
            "HARD BOUNDARIES (do not cross):\n"
            "  * The patient-specific FACTS — stage, procedure, results, values, dates, decisions — "
            "come STRICTLY from the DATA. Never invent a clinical value, a result, or a decision the "
            "DATA does not state.\n"
            "  * Only the GENERAL standard in 'reference' is trained knowledge, and it must fit THIS "
            "patient's tumour site / diagnosis (read the diagnosis in the DATA). Keep it short (a "
            "yardstick, e.g. 'AJCC 8th', 'ASA <=III', 'R0', '>=12 nodes'), and frame every judgement "
            "for surgeon / MDT review — never a directive.\n"
            "  * If a row's finding is genuinely absent from the DATA, leave the FINDING 'Not "
            "available' (neutral) — do NOT manufacture a finding just to have something to judge. But "
            "STILL fill 'reference' with the expected standard for that row and 'action' with the "
            "concrete next step, so the Reference/Expected column is never blank even on an absent row.\n"
            "PILL FROM THE JUDGEMENT (not from the bare fact): once you have judged finding vs "
            "reference, pick the pill from that judgement — 'Concordant'/'Normal'/'Complete' (ok) when "
            "the finding MEETS the standard, 'Review'/'Pending' (watch) when it is provisional or a "
            "step is outstanding, 'Critical'/'Abnormal' (alert) when the DATA shows the standard is "
            "breached or a hazard is named. Reserve 'Noted' (neutral) ONLY for a real fact you "
            "genuinely cannot judge against a standard.\n\n"
        )

    # --- shared machinery ---------------------------------------------------

    def _default_rows(self) -> List[ParameterRow]:
        return [ParameterRow(parameter=p) for p in self.PARAMETERS]

    def _empty_result(self) -> ModuleResult:
        return ModuleResult(module_id=self.MODULE_ID, title=self.TITLE, rows=self._default_rows())

    @staticmethod
    def _is_empty(data: Dict[str, Any]) -> bool:
        """True when the slice holds no usable content at all."""
        def has_content(v: Any) -> bool:
            if v in (None, "", [], {}):
                return False
            if isinstance(v, dict):
                return any(has_content(x) for x in v.values())
            if isinstance(v, list):
                return any(has_content(x) for x in v)
            return True
        return not any(has_content(v) for v in data.values())

    # Predefined pill vocabulary → color tier. The agent picks a statusLabel from this
    # set; the tier decides the pill COLOR at the frontend, so label and color can never
    # disagree. Kept lean — the common signal words plus the ones existing agents emit
    # (m4 'Positive', m9 'Ready'/'Partial'/'Draft', m10 'Upstaged'/'Downstaged'). Any
    # out-of-vocab label (e.g. a restated parameter name) is snapped in _reconcile_rows.
    _PILL_TIER = {
        # ok (green) — genuinely reassuring / done
        "normal": "ok", "clear": "ok", "complete": "ok", "negative": "ok",
        "resectable": "ok", "optimized": "ok", "ready": "ok", "approved": "ok",
        "concordant": "ok",
        # watch (amber) — needs review / pending / borderline
        "review": "watch", "pending": "watch", "borderline": "watch",
        "partial": "watch", "draft": "watch",
        # alert (red) — abnormal / act now
        "critical": "alert", "abnormal": "alert", "positive": "alert",
        "unresectable": "alert",
        # flag (blue) — notable engine finding
        "key finding": "flag", "upstaged": "flag", "downstaged": "flag",
        # info (slate, semi-neutral) — a captured but neutral fact (staging, procedure, plan)
        "noted": "info",
        # neutral (grey) — no data
        "not available": "neutral",
    }
    # Fallback label when the agent's chosen word is out of vocabulary: use the word that
    # matches the LLM's own status tier, so pill text always agrees with pill color.
    _TIER_DEFAULT_LABEL = {"ok": "Normal", "watch": "Review", "alert": "Critical",
                           "flag": "Key Finding", "info": "Noted", "neutral": "Not Available"}

    @staticmethod
    def _has_finding(row: ParameterRow) -> bool:
        f = (row.finding or "").strip().lower()
        return bool(f) and f != "not available"

    def _snap_pill(self, row: ParameterRow) -> None:
        """Force one row's (statusLabel, status) onto the predefined vocabulary so the
        frontend can color deterministically and text/color always agree. Presentational
        normalisation only — no clinical value is invented."""
        if not self._has_finding(row):
            row.statusLabel, row.status = "Not Available", "neutral"
            return
        label = (row.statusLabel or "").strip().lower()
        tier = self._PILL_TIER.get(label)
        if tier is not None:
            # In-vocab: the word decides the color; tidy the label's casing.
            row.status = tier
            row.statusLabel = "Not Available" if label == "not available" else row.statusLabel.strip().title()
        else:
            # Out-of-vocab (the bug: a restated parameter name). This row IS populated,
            # so fall back on the LLM's own status tier; if that tier is missing or bare
            # 'neutral' (no signal), treat it as a captured fact -> 'Noted'/info. Grey
            # 'neutral'/'Not Available' is reserved for genuinely absent data only.
            tier = row.status if row.status in ("ok", "watch", "alert", "flag", "info") else "info"
            row.status = tier
            row.statusLabel = self._TIER_DEFAULT_LABEL[tier]

    def _reconcile_rows(self, result: ModuleResult) -> ModuleResult:
        """Force the LLM output onto the exact PARAMETERS list: keep rows whose name
        matches a parameter, fill missing parameters with default (Not available) rows,
        and drop any invented parameter names — preserving config order.

        Also snaps every row's pill onto the predefined vocabulary (see _snap_pill) so
        the frontend colors deterministically and the pill's text always matches its
        color — an out-of-vocab label (e.g. a restated parameter name) can never leak
        through, and a populated row never shows a blank/'Not available' pill."""
        by_name = {r.parameter: r for r in (result.rows or [])}
        rows: List[ParameterRow] = []
        for p in self.PARAMETERS:
            row = by_name.get(p)
            if row is None:
                rows.append(ParameterRow(parameter=p))
            else:
                row.parameter = p  # normalise exact spelling
                self._snap_pill(row)
                rows.append(row)
        result.rows = rows
        result.module_id = self.MODULE_ID
        result.title = self.TITLE
        return result

    async def run(self, state: Dict[str, Any]) -> Dict[str, Any]:
        data = self._slice(state)

        if self._is_empty(data):
            logger.info(f"[{self.MODULE_ID}] empty slice — emitting default rows, skipping LLM")
            return {
                "modules": {self.MODULE_ID: self._empty_result()},
                "warnings": [f"{self.MODULE_ID}: no source data"],
            }

        # The Groq/llama function-calling envelope is occasionally malformed (e.g. the
        # model returns a bare rows array instead of a ModuleResult object → a 400
        # 'tool_use_failed'). That flake is transient and independent of our data, so
        # retry a couple of times before degrading the whole module to 'Not available'.
        # Larger prompts (e.g. m10) flake more often, which is exactly where a wiped
        # module hurts most.
        last_error = None
        for attempt in range(1, 4):
            try:
                result: ModuleResult = await self.structured.ainvoke([
                    SystemMessage(content=SYSTEM_PROMPT),
                    HumanMessage(content=self._prompt(data)),
                ])
                result = self._reconcile_rows(result)
                logger.info(f"[{self.MODULE_ID}] {self.TITLE}: {len(result.rows)} rows"
                            + (f" (attempt {attempt})" if attempt > 1 else ""))
                return {"modules": {self.MODULE_ID: result}}
            except Exception as e:  # noqa: BLE001 — never let one agent crash the graph
                last_error = e
                logger.warning(f"[{self.MODULE_ID}] attempt {attempt}/3 failed: {e}")

        logger.error(f"[{self.MODULE_ID}] all attempts failed: {last_error}")
        return {
            "modules": {self.MODULE_ID: self._empty_result()},
            "warnings": [f"{self.MODULE_ID}: {last_error}"],
        }
