"""
integration/mact/extract.py

Fact extraction from parsed pages (Groq). The LLM only extracts facts. Every field must
carry a page and a quote that appears verbatim in that document's page text, otherwise it
is dropped. Conflicts are NOT decided here (see analysis.py).
"""

import asyncio
import json
import logging
import os
import re
import unicodedata
from datetime import date, datetime, timezone

from .db import doc_extractions, doc_pages

logger = logging.getLogger("mact.extract")

GROQ_API_KEY = os.getenv("GROQ_API_KEY")
EXTRACT_MODEL = os.getenv("MACT_EXTRACT_MODEL", "openai/gpt-oss-120b")
CHUNK_CHARS = int(os.getenv("MACT_EXTRACT_CHUNK_CHARS", "14000"))
MAX_CHUNKS = 8

# key: (type, description). Types: D ISO date, H time HH:MM, N number, T text.
FACTS = {
    "accident_date": ("D", "Date of the accident"),
    "accident_time": ("H", "Time of the accident, 24-hour"),
    "accident_place": ("T", "Place of the accident"),
    "fir_no": ("T", "FIR / crime number"),
    "fir_date": ("D", "Date the FIR was registered"),
    "offence_summary": ("T", "One-line summary of the accident as narrated"),
    "victim_name": ("T", "Name of the injured / deceased person"),
    "victim_age": ("N", "Age in years of the injured / deceased person"),
    "victim_dob": ("D", "Date of birth of the injured / deceased person"),
    "victim_sex": ("T", "Sex of the injured / deceased person (M or F)"),
    "victim_occupation": ("T", "Occupation of the injured / deceased person"),
    "vehicle_reg": ("T", "Registration number of the insured / offending vehicle"),
    "vehicle_class": ("T", "Class or type of the vehicle"),
    "driver_name": ("T", "Name of the driver of the offending vehicle"),
    "dl_no": ("T", "Driving licence number"),
    "dl_class": ("T", "Licence class / vehicle classes authorised"),
    "dl_valid_to": ("D", "Licence validity end date (transport validity if given separately)"),
    "policy_no": ("T", "Insurance policy number"),
    "policy_from": ("D", "Policy start date"),
    "policy_to": ("D", "Policy end date"),
    "policy_type": ("T", "Policy type or cover"),
    "hospital": ("T", "Treating hospital"),
    "admission_date": ("D", "Date of admission"),
    "discharge_date": ("D", "Date of discharge"),
    "death_date": ("D", "Date of death"),
    "cause_of_death": ("T", "Cause of death as stated"),
    "injuries": ("T", "One injury per entry, as stated (repeat the key for each injury)"),
    "disability_pct": ("N", "Permanent disability percentage certified"),
    "claimed_disability_pct": ("N", "Permanent disability percentage claimed in the petition"),
    "bills_total": ("N", "Total amount of the bill in rupees (one entry per bill total)"),
    "monthly_income": ("N", "Monthly income in rupees as stated (for bank statements: average monthly credits, only if stated)"),
    "claimed_income": ("N", "Monthly income claimed in the petition, rupees"),
    "dependant": ("T", "One dependant per entry formatted 'Name; Relation; Age' (Age blank if not stated)"),
}
REPEATABLE = {"injuries", "dependant", "bills_total"}

SCHEMAS = {
    "petition": ["accident_date", "accident_time", "accident_place", "victim_name", "victim_age", "victim_occupation",
                 "vehicle_reg", "claimed_income", "claimed_disability_pct", "dependant", "injuries"],
    "fir": ["fir_no", "fir_date", "accident_date", "accident_time", "accident_place", "victim_name", "victim_age",
            "vehicle_reg", "driver_name", "offence_summary"],
    "dar": ["accident_date", "accident_time", "accident_place", "victim_name", "victim_age", "victim_sex",
            "vehicle_reg", "vehicle_class", "driver_name", "dl_no", "policy_no"],
    "mlc": ["victim_name", "victim_age", "victim_sex", "accident_date", "hospital", "injuries"],
    "discharge": ["victim_name", "victim_age", "hospital", "admission_date", "discharge_date", "injuries"],
    "bills": ["victim_name", "hospital", "bills_total"],
    "income": ["victim_name", "victim_occupation", "monthly_income"],
    "bank": ["victim_name", "monthly_income"],
    "dependency": ["victim_name", "dependant"],
    "id": ["victim_name", "victim_dob", "victim_sex"],
    "policy": ["policy_no", "policy_from", "policy_to", "policy_type", "vehicle_reg"],
    "rc": ["vehicle_reg", "vehicle_class"],
    "dl": ["dl_no", "dl_class", "dl_valid_to", "driver_name"],
    "pm": ["victim_name", "victim_age", "victim_sex", "death_date", "cause_of_death"],
    "death": ["victim_name", "victim_age", "death_date"],
    "disability": ["victim_name", "disability_pct"],
}

# Checklist row (DOCS in masters.js) -> schema. Anything not listed is skipped.
NAME_TO_TYPE = {
    "Claim petition": "petition", "FIR": "fir", "Detailed Accident Report (DAR)": "dar",
    "Insurance policy & endorsements": "policy", "Registration certificate": "rc", "Driving licence": "dl",
    "MLC": "mlc", "Discharge summary / IP records": "discharge", "Medical bills": "bills",
    "Post-mortem report": "pm", "Death certificate": "death", "Disability certificate": "disability",
    "Income proof (salary / ITR / Form 16)": "income", "Bank statements (12 months)": "bank",
    "Legal heir / dependency proof": "dependency", "Identity (masked)": "id",
}

SYSTEM = (
    "You extract facts from ONE Indian motor-accident claim document (OCR markdown; may contain English, "
    "Malayalam or Hindi). Return ONLY JSON: {\"fields\":[{\"key\":...,\"value\":...,\"page\":<int>,\"quote\":...}]}. "
    "Rules: use only the listed keys; extract only what the text states, never infer or guess; omit a key that is "
    "absent. 'quote' is the exact characters copied from that page's text that support the value (max 200 chars, "
    "unchanged, not translated). Value formats: D = ISO date YYYY-MM-DD; H = HH:MM 24-hour; N = plain number, digits "
    "and dot only; T = short text. A key may repeat only if its description says so. Page numbers come from the "
    "'=== PAGE n ===' markers."
)


def _call_groq(doc_type: str, text: str) -> list:
    if not GROQ_API_KEY:
        raise RuntimeError("GROQ_API_KEY is not configured")
    from groq import Groq  # imported here so a missing package cannot break service start-up

    keys = "\n".join(f"- {k} ({FACTS[k][0]}): {FACTS[k][1]}" for k in SCHEMAS[doc_type])
    r = Groq(api_key=GROQ_API_KEY, timeout=120.0).chat.completions.create(
        model=EXTRACT_MODEL, temperature=0, response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Document type: {doc_type}\nKeys:\n{keys}\n\nTEXT:\n{text}"},
        ],
    )
    data = json.loads(r.choices[0].message.content or "{}")
    fields = data.get("fields")
    return fields if isinstance(fields, list) else []


_STRIP = re.compile(r"[\s*_|#>`\\]+")


def _sq(s) -> str:
    return _STRIP.sub("", unicodedata.normalize("NFKC", str(s or ""))).casefold()


def _clean_value(typ: str, v):
    """Returns a normalised value or None."""
    if v is None:
        return None
    if typ == "N":
        try:
            n = float(str(v).replace(",", "").strip())
        except ValueError:
            return None
        return int(n) if n == int(n) else n
    s = str(v).strip()
    if typ == "D":
        try:
            date.fromisoformat(s)
        except ValueError:
            return None
        return s
    if typ == "H":
        return s if re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", s) else None
    return s if 1 <= len(s) <= 200 else None


def verify_fields(raw: list, pages: dict, doc_type: str):
    """Keep a field only if its quote appears verbatim in the document. Returns (kept, rejected_count)."""
    allowed = set(SCHEMAS[doc_type])
    squashed = {n: _sq(t) for n, t in pages.items()}
    kept, seen, rejected = [], set(), 0
    for f in raw:
        try:
            key, quote = f.get("key"), str(f.get("quote") or "")
            if key not in allowed or len(_sq(quote)) < 3:
                rejected += 1
                continue
            typ = FACTS[key][0]
            value = _clean_value(typ, f.get("value"))
            if value is None:
                rejected += 1
                continue
            q = _sq(quote)
            try:
                page = int(f.get("page"))
            except (TypeError, ValueError):
                page = None
            if page not in squashed or q not in squashed[page]:
                page = next((n for n, t in sorted(squashed.items()) if q in t), None)
            if page is None:
                rejected += 1
                continue
            if typ == "N" and str(int(float(value))) not in re.sub(r"\D", "", quote):
                rejected += 1  # number not visible in its own quote
                continue
            sig = (key, str(value))
            if sig in seen or (key not in REPEATABLE and any(k[0] == key for k in seen)):
                continue
            seen.add(sig)
            kept.append({"key": key, "value": value, "page": page, "quote": quote[:200]})
        except Exception:
            rejected += 1
    return kept, rejected


def _chunks(pages: dict) -> list:
    out, cur, size = [], [], 0
    for n in sorted(pages):
        block = f"=== PAGE {n} ===\n{pages[n]}\n"
        if cur and size + len(block) > CHUNK_CHARS:
            out.append("".join(cur))
            cur, size = [], 0
        cur.append(block)
        size += len(block)
    if cur:
        out.append("".join(cur))
    return out


async def extract_document(doc: dict):
    """Extract one uploaded file. Returns the stored record, or None if its checklist row has no schema."""
    dtype = NAME_TO_TYPE.get(doc.get("doc_name") or "")
    if not dtype:
        return None
    rows = await doc_pages.find({"doc_id": doc["id"]}, {"_id": 0, "page_number": 1, "text": 1}) \
        .sort("page_number", 1).to_list(length=2000)
    pages = {r["page_number"]: r.get("text") or "" for r in rows}
    if not pages:
        raise RuntimeError("no parsed pages")
    chunks = _chunks(pages)
    raw = []
    for ch in chunks[:MAX_CHUNKS]:
        raw += await asyncio.to_thread(_call_groq, dtype, ch)
    kept, rejected = verify_fields(raw, pages, dtype)
    rec = {
        "doc_id": doc["id"], "case_id": doc["case_id"], "doc_type": dtype, "model": EXTRACT_MODEL,
        "status": "ok", "fields": kept, "rejected": rejected, "truncated": len(chunks) > MAX_CHUNKS,
        "extracted_at": datetime.now(timezone.utc).replace(tzinfo=None),
    }
    await doc_extractions.replace_one({"doc_id": doc["id"]}, rec, upsert=True)
    return rec