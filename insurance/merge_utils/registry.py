"""
merge_utils/registry.py
─────────────────────────────────────────────────────────────────────────────
Thin re-export only. The old registry ran a separate 14-trigger-file
pipeline (generate_conclusion / generate_multi_conclusion) with its own
heuristic retry logic — placeholder-text equality checks, a "TRIGGER:"
substring count used as a correctness check, and a PED-only special-cased
retry. That pipeline has been removed. routes/agents/unified_report_agent.py
is now the single conclusion generator: it batches oversized files instead
of truncating, segments hospital content into episodes, runs a
deterministic critical-fact check (e.g. death signal vs generated prose),
and resolves the verdict via one rule engine (compute_rule_verdict) that
can only escalate toward SUSPECTED, never silently downgrade.

This file exists only so callers importing `from merge_utils.registry
import ...` don't need to change their import path. If nothing ends up
importing from here after the endpoint is updated, delete this file too.
"""
from __future__ import annotations

from routes.agents.unified_report_agent import (
    generate_unified_conclusion,
    TRIGGER_LABELS,
)

__all__ = ["generate_unified_conclusion", "TRIGGER_LABELS"]