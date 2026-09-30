"""
llm.py — Thin Groq JSON-mode wrapper, mirroring the reference backend
(llama-3.1-8b-instant, temperature 0.1, response_format=json_object).

The platform's clinical SIGNAL is always deterministic (see agents/*.py). The LLM
is used only to synthesize NARRATIVE PROSE (summary bodies, explanations) that live
under ModuleResult.meta. So every call is optional: if GROQ_API_KEY is unset or the
SDK is missing, `generate_json()` returns None and agents fall back to deterministic
text. No clinical row status ever depends on the LLM.
"""

from __future__ import annotations

import json
import os
from typing import Any, Dict, Optional

DEFAULT_MODEL = "llama-3.1-8b-instant"


def is_available() -> bool:
    return bool(os.getenv("GROQ_API_KEY"))


def generate_json(
    prompt: str,
    *,
    model: str = DEFAULT_MODEL,
    temperature: float = 0.1,
    max_tokens: int = 1500,
) -> Optional[Dict[str, Any]]:
    """
    Return a parsed JSON object from the LLM, or None if unavailable/failed.
    Never raises — callers treat None as "narrative not generated".
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        return None

    try:
        from groq import Groq  # lazy import so the package works without the SDK
    except ImportError:
        return None

    try:
        client = Groq(api_key=api_key)
        completion = client.chat.completions.create(
            model=model,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            response_format={"type": "json_object"},
            max_tokens=max_tokens,
        )
        return json.loads(completion.choices[0].message.content)
    except (json.JSONDecodeError, Exception):  # noqa: BLE001 - narrative is best-effort
        return None
