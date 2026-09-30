"""
agents/base.py — BaseAgent: the template every module-agent follows.

Lifecycle (see PLAN.md §2):
    gather_context()  → pull records from the data source
    build_rows()      → DETERMINISTIC derivation of the module's fixed rows
    build_prompt()    → OPTIONAL prompt for narrative prose
    call_llm()        → OPTIONAL Groq JSON (prose only, never row status)
    assemble()        → ModuleResult

Subclasses normally implement only `moduleId/slug/num/title` and `build_rows()`.
The clinical signal (row status/label) is always deterministic; the LLM touches
`meta` only. Every agent runs end-to-end with no DB and no LLM via the demo source.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from ..data_sources import RTDataSource, get_data_source
from ..state import ModuleResult, Row, success_envelope
from .. import llm


class BaseAgent:
    # Subclasses override these four to bind to a dashboard module.
    moduleId: str = ""
    slug: str = ""
    num: str = ""
    title: str = ""

    def __init__(self, data_source: Optional[RTDataSource] = None):
        self.ds = data_source or get_data_source()

    # ── steps ───────────────────────────────────────────────────────────────
    async def gather_context(self, patient_id: Optional[str]) -> Dict[str, Any]:
        """Default: pull both records. Subclasses may narrow this."""
        return {
            "ebrt": await self.ds.get_ebrt_record(patient_id),
            "workflow": await self.ds.get_workflow_record(patient_id),
        }

    def build_rows(self, ctx: Dict[str, Any]) -> List[Row]:
        raise NotImplementedError

    def build_prompt(self, ctx: Dict[str, Any], rows: List[Row]) -> Optional[str]:
        """Return a prompt to synthesize narrative prose, or None to skip the LLM."""
        return None

    def call_llm(self, prompt: Optional[str]) -> Optional[Dict[str, Any]]:
        if not prompt:
            return None
        return llm.generate_json(prompt)

    def summarize(self, rows: List[Row]) -> str:
        """Default one-line roll-up used in the module header."""
        total = len(rows)
        na = sum(1 for r in rows if r.statusLabel == "Not available")
        derived = total - na
        return f"{derived} of {total} derived from records" + (
            f" · {na} not available" if na else ""
        )

    # ── orchestration ────────────────────────────────────────────────────────
    async def run(self, patient_id: Optional[str] = None) -> ModuleResult:
        ctx = await self.gather_context(patient_id)
        rows = self.build_rows(ctx)

        narrative = self.call_llm(self.build_prompt(ctx, rows))

        result = ModuleResult(
            moduleId=self.moduleId,
            slug=self.slug,
            num=self.num,
            title=self.title,
            rows=rows,
            summary=self.summarize(rows),
        )
        result.status = result.rollup_status()
        result.meta = {
            "provenance": [
                {"param": r.param, "source": r.source} for r in rows
            ],
            "llmUsed": narrative is not None,
        }
        if narrative:
            result.meta["narrative"] = narrative
        return result

    async def run_envelope(self, patient_id: Optional[str] = None) -> Dict[str, Any]:
        return success_envelope(await self.run(patient_id))
