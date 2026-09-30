"""
services/template_field_extractor.py
─────────────────────────────────────────────────────────────────────────────
Generic per-template field extraction, run once per "Generate Conclusion"
click. Given a manifest (list of {id,title,fields:[{key,label,type}]}) and
the claim's raw_llama_markdown, returns every distinct value found for every
field, each candidate carrying its source file/page/quote. Never resolves
conflicts — that's the doctor's job via the frontend candidate picker.
"""
from __future__ import annotations

import asyncio
import json
import logging
from typing import Any, Dict, List, Optional

from routes.agents.base import call_groq
from routes.agents.chunking import split_text_by_pdf, batch_file_pages, render_page_batch

logger = logging.getLogger(__name__)

_CHUNK_BUDGET = 110_000

_FIELD_EXTRACTION_SYSTEM = """You are a meticulous insurance investigation document extractor filling out a
structured report template. You are given a list of fields the template needs (each with a key, a label, and
a type), and the raw text of one or more claim documents.

For EACH requested field, search the text and return every DISTINCT value you find for it. If different
documents disagree, or the same fact appears worded two different ways with different substance, return
BOTH as separate candidates — never resolve conflicts yourself, a human reviewer does that.

FIELD TYPES:
- Plain field (no type, or "date"): return the value as found (dates in whatever format the source uses).
- "textarea": a longer narrative/paragraph value; return the full relevant text, not a one-line summary.
- "yn": a yes/no/checklist-style question. Return the RAW PHRASE exactly as found (e.g. "Yes", a checkmark
  description, "Not indicated", "Register collected", an unmarked either/or choice) in raw_phrase, AND your
  best-effort interpretation in interpreted as one of "YES", "NO", "NA" — use "NA" if the field is blank,
  unmarked, or an either/or choice with neither option struck out. Never invent a YES/NO the source doesn't
  support.
- "table": return an array of row objects in "rows". For billing/line-item tables use
  {"item": ..., "amount": ...}. For any other table-shaped field, use whatever column names are natural.

Every candidate must include: value (null for yn/table), raw_phrase (yn only, else null), interpreted (yn
only, else null), rows (table only, else null), source_file, source_page (int or null), and quote (verbatim
supporting text, under 20 words, or null if not directly quotable e.g. a table computed from several rows).

Return ONLY valid JSON, no markdown fences, shaped exactly as:
{
  "<field_key>": [
    {"value": "...", "raw_phrase": null, "interpreted": null, "rows": null,
     "source_file": "...", "source_page": 3, "quote": "..."}
  ]
}

Rules:
- If a field is genuinely not found anywhere in this text, return an empty array for it — never invent one.
- Never fabricate a value, quote, file name, or page number.
- Keep to ONLY the field keys listed — do not add extra keys, do not skip any listed key.
"""


def _flatten_manifest_fields(manifest: List[dict]) -> List[dict]:
    out, seen = [], set()
    for section in manifest or []:
        for f in section.get("fields", []):
            if f["key"] in seen:
                continue
            seen.add(f["key"])
            out.append(f)
    return out


def _chunk_text(raw_text: str, budget: int = _CHUNK_BUDGET) -> List[str]:
    files = split_text_by_pdf(raw_text)
    if not files:
        return [raw_text] if raw_text else []
    chunks: List[str] = []
    current: List[str] = []
    current_len = 0

    def _flush():
        nonlocal current, current_len
        if current:
            chunks.append("\n\n".join(current))
            current, current_len = [], 0

    for fname, ftext in files.items():
        if len(ftext) > budget:
            _flush()
            for b in batch_file_pages(ftext, max_chars=budget, overlap_pages=1):
                chunks.append(render_page_batch(fname, b))
            continue
        wrapped = f"<!-- PDF_START: {fname} -->\n{ftext}\n<!-- PDF_END: {fname} -->"
        if current_len + len(ftext) > budget and current:
            _flush()
        current.append(wrapped)
        current_len += len(ftext)
    _flush()
    return chunks


def _get_nested(obj: dict, dotted_key: str):
    cur = obj
    for p in dotted_key.split("."):
        if not isinstance(cur, dict) or p not in cur:
            return None
        cur = cur[p]
    return cur


async def _extract_chunk(chunk_text: str, fields: List[dict]) -> Dict[str, Any]:
    field_lines = "\n".join(
        f"- key: {f['key']} | label: {f['label']} | type: {f.get('type') or 'text'}"
        for f in fields
    )
    user_prompt = (
        "FIELDS TO EXTRACT:\n" + field_lines +
        "\n\nDOCUMENT TEXT:\n" + chunk_text[:_CHUNK_BUDGET]
    )
    try:
        raw = await call_groq(_FIELD_EXTRACTION_SYSTEM, user_prompt, max_tokens=8000)
    except Exception:
        logger.exception("Template field extraction chunk failed")
        return {}
    return raw if isinstance(raw, dict) else {}


def _candidate_key(c: dict) -> str:
    if c.get("rows") is not None:
        return "rows:" + json.dumps(c["rows"], sort_keys=True, default=str)[:200]
    if c.get("raw_phrase") is not None:
        return f"yn:{str(c.get('raw_phrase')).strip().lower()}"
    return str(c.get("value") or "").strip().lower()[:200]


async def extract_all_manifest_fields(
    raw_text: str,
    manifest: List[dict],
    case_data: dict,
) -> Dict[str, List[dict]]:
    """
    One extraction call per document chunk, covering every field in `manifest`
    at once. Merges + dedupes candidates across chunks, then folds in the
    case's existing saved value (if any) as an extra manual candidate that
    stays selected by default — so nothing already on the case is silently
    replaced, only supplemented with what this pass found.
    """
    fields = _flatten_manifest_fields(manifest)
    if not fields or not raw_text:
        return {}

    chunks = _chunk_text(raw_text)
    if not chunks:
        return {}

    chunk_results = await asyncio.gather(*[_extract_chunk(c, fields) for c in chunks])

    merged: Dict[str, List[dict]] = {f["key"]: [] for f in fields}
    seen_keys: Dict[str, set] = {f["key"]: set() for f in fields}

    for result in chunk_results:
        if not isinstance(result, dict):
            continue
        for f in fields:
            key = f["key"]
            for c in (result.get(key) or []):
                if not isinstance(c, dict):
                    continue
                if not (c.get("value") or c.get("raw_phrase") or c.get("rows")):
                    continue
                ckey = _candidate_key(c)
                if ckey in seen_keys[key]:
                    continue
                seen_keys[key].add(ckey)
                merged[key].append({
                    "value": c.get("value"),
                    "raw_phrase": c.get("raw_phrase"),
                    "interpreted": c.get("interpreted"),
                    "rows": c.get("rows"),
                    "source_file": c.get("source_file"),
                    "source_page": c.get("source_page"),
                    "quote": c.get("quote"),
                    "selected": False,
                    "manual": False,
                })

    for f in fields:
        key = f["key"]
        existing = _get_nested(case_data, key)
        if existing in (None, "", [], {}):
            continue
        existing_str = json.dumps(existing, default=str) if isinstance(existing, (list, dict)) else str(existing)
        already = any(
            str(c.get("value")) == existing_str or _candidate_key(c) == existing_str.strip().lower()[:200]
            for c in merged[key]
        )
        if already:
            if merged[key]:
                merged[key][0]["selected"] = True
            continue
        merged[key] = [{
            "value": existing if not isinstance(existing, (list, dict)) else None,
            "rows": existing if isinstance(existing, list) else None,
            "raw_phrase": None,
            "interpreted": None,
            "source_file": None,
            "source_page": None,
            "quote": None,
            "selected": True,
            "manual": True,
        }] + merged[key]

    for cands in merged.values():
        if cands and not any(c.get("selected") for c in cands):
            cands[0]["selected"] = True

    return {k: v for k, v in merged.items() if v}