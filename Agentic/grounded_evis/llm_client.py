"""
grounded_evis/llm_client.py
==============================================================
Single place the "which model" decision lives, so Stage 1/3/case-
classification never hardcode a provider — they take an `llm` object with
an `.ainvoke(messages) -> response.content` interface (LangChain's chat
model interface) and don't care where it came from.

DECISION: staying on Groq, per explicit instruction. Groq's current model
ladder tops out at Llama 3.3 70B Versatile for general reasoning/JSON-mode
tasks (their flagship general-purpose model as of the most recent
availability data checked) — this is the model ambulance.py's own
`llm_synthesis` already uses for A8/SIMPLE_SYNTH, so this keeps the new
pipeline on the same provider and same top-tier model as today's synthesis
agent, just applied consistently to Stage 1/3/case-classification instead
of only the final synthesis step.

Changing the model string is a one-line edit to _MODEL_NAME below;
nothing else in the pipeline needs to change.
"""

from __future__ import annotations

import os
from typing import Any, Optional

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

_MODEL_NAME = "llama-3.3-70b-versatile"

_cached_llm: Optional[Any] = None


def _build_default_llm() -> Any:
    groq_key = os.getenv("GROQ_API_KEY")
    if not groq_key:
        raise RuntimeError(
            "grounded_evis: GROQ_API_KEY not set. This pipeline is configured to use "
            f"Groq's {_MODEL_NAME} for Stage 1/3/case-classification."
        )

    from langchain_groq import ChatGroq

    logger.info(f"grounded_evis: using {_MODEL_NAME} (Groq) for Stage 1/3/case-classification.")
    return ChatGroq(
        model=_MODEL_NAME,
        temperature=0.1,
        max_tokens=4000,
        groq_api_key=groq_key,
    )


def get_best_available_llm() -> Any:
    """
    Returns a cached, shared LLM client for Stage 1, Stage 3, and
    case_classification's LLM call — all three use the same model per the
    decision above. If you need different models per stage, stop caching
    and pass explicit model names through here instead of reaching for a
    different factory function elsewhere.
    """
    global _cached_llm
    if _cached_llm is None:
        _cached_llm = _build_default_llm()
    return _cached_llm