"""
state.py — Shared types and constants for the radiation oncology agent platform.

The single source of truth for the frozen row contract the dashboard consumes.
`Row.to_dict()` emits EXACTLY the six keys that RadiationOncologyIntelligence.jsx
already reads: param, finding, ref, status, statusLabel, action. Agents never add
or remove keys from a row; anything extra lives under ModuleResult.meta, which the
dashboard ignores.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


# ── Status vocabulary (maps 1:1 to the JSX StatusPill) ──────────────────────
STATUS_OK = "ok"          # green
STATUS_WATCH = "watch"    # amber
STATUS_ALERT = "alert"    # red
STATUS_NEUTRAL = "neutral"  # grey

VALID_STATUSES = {STATUS_OK, STATUS_WATCH, STATUS_ALERT, STATUS_NEUTRAL}

# The canonical label + placeholder for anything we cannot source or derive.
NOT_AVAILABLE = "Not available"
DASH = "—"  # em dash, matches the dashboard's "—" placeholder


@dataclass
class Row:
    """One dashboard table row. Serializes to the frozen 6-key shape."""

    param: str
    finding: str = DASH
    ref: str = ""
    status: str = STATUS_NEUTRAL
    statusLabel: str = ""
    action: str = ""
    # Non-rendered provenance — kept out of to_dict(), surfaced via ModuleResult.meta.
    source: str = ""  # one of: db | derived | llm | external | request | gap

    def __post_init__(self) -> None:
        if self.status not in VALID_STATUSES:
            self.status = STATUS_NEUTRAL

    def to_dict(self) -> Dict[str, str]:
        """Exactly the keys the frozen dashboard reads — nothing more.

        When a row cannot be sourced (statusLabel == "Not available"), the
        indication/action column mirrors the status — it shows "Not available"
        rather than a "populates from …" hint. Applies uniformly to every module.
        """
        action = NOT_AVAILABLE if self.statusLabel == NOT_AVAILABLE else self.action
        return {
            "param": self.param,
            "finding": self.finding,
            "ref": self.ref,
            "status": self.status,
            "statusLabel": self.statusLabel,
            "action": action,
        }

    # ── Constructors that encode the missing-data policy ────────────────────
    @classmethod
    def not_available(
        cls,
        param: str,
        *,
        ref: str = "",
        action: str = "",
        source: str = "gap",
    ) -> "Row":
        """A row whose value cannot be sourced or derived. Never invents data."""
        return cls(
            param=param,
            finding=DASH,
            ref=ref,
            status=STATUS_NEUTRAL,
            statusLabel=NOT_AVAILABLE,
            action=action or "Source not linked; will populate when available.",
            source=source,
        )


@dataclass
class ModuleResult:
    """The full payload for one module-agent. Wrapped by the API envelope."""

    moduleId: str          # e.g. "m9" — matches REPORT_MODULES[i].id
    slug: str              # e.g. "documentation"
    num: str               # e.g. "09 / 12" — matches REPORT_MODULES[i].num
    title: str
    rows: List[Row] = field(default_factory=list)
    status: str = STATUS_OK       # roll-up status for KPI/summary use
    summary: str = ""
    meta: Dict[str, Any] = field(default_factory=dict)

    def rollup_status(self) -> str:
        """Worst status across rows: alert > watch > ok/neutral."""
        statuses = {r.status for r in self.rows}
        if STATUS_ALERT in statuses:
            return STATUS_ALERT
        if STATUS_WATCH in statuses:
            return STATUS_WATCH
        return STATUS_OK

    def to_dict(self) -> Dict[str, Any]:
        available = sum(1 for r in self.rows if r.statusLabel != NOT_AVAILABLE)
        meta = dict(self.meta)
        meta.setdefault("rowCount", len(self.rows))
        meta.setdefault("availableCount", available)
        meta.setdefault("notAvailableCount", len(self.rows) - available)
        return {
            "moduleId": self.moduleId,
            "slug": self.slug,
            "num": self.num,
            "title": self.title,
            "status": self.status or self.rollup_status(),
            "summary": self.summary,
            "rows": [r.to_dict() for r in self.rows],
            "meta": meta,
        }


def success_envelope(result: ModuleResult) -> Dict[str, Any]:
    """The universal response shape shared with the reference backend."""
    return {"status": "success", "data": result.to_dict()}


def error_envelope(message: str) -> Dict[str, Any]:
    return {"status": "error", "data": None, "message": message}
