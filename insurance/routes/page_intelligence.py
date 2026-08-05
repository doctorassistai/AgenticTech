"""
Non-LLM page preprocessing (blank/duplicate/low-quality filtering) + LLM
page classification (with heuristic fallback) for the advanced-upload
pipeline. Feeds the "smart preview" shown to the allocation team, and the
page-grouping used by the Celery worker for targeted extraction.
"""
from __future__ import annotations
import io, json, logging, re, difflib, os
from typing import Any, Dict, List, Tuple

from groq import Groq
try:
    from pypdf import PdfReader
except ImportError:
    from PyPDF2 import PdfReader

logger = logging.getLogger(__name__)
_groq = Groq(api_key=os.getenv("GROQ_API_KEY"))
_CLASSIFY_MODEL = "llama-3.3-70b-versatile"

DOCUMENT_TYPES = [
    "admission_summary", "discharge_summary", "bills", "prescriptions",
    "lab_reports", "radiology_reports", "operative_notes", "id_proof",
    "consent_forms", "insurance_forms", "accident_report", "nursing_notes",
    "other",
]
LOW_VALUE_TYPES = {"consent_forms", "insurance_forms", "other"}
GROUP_PRIORITY = [
    "discharge_summary", "admission_summary", "bills", "operative_notes",
    "lab_reports", "radiology_reports", "accident_report", "nursing_notes",
    "prescriptions", "id_proof", "insurance_forms", "consent_forms", "other",
]


def extract_quick_page_texts(content: bytes) -> List[str]:
    """Fast per-page text via pypdf — NOT a LlamaParse substitute, just
    enough raw text for filtering/classification."""
    try:
        reader = PdfReader(io.BytesIO(content))
    except Exception as e:
        logger.warning("Quick page text extraction failed: %s", e)
        return []
    out = []
    for page in reader.pages:
        try:
            out.append(page.extract_text() or "")
        except Exception:
            out.append("")
    return out


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _quality_score(text: str) -> float:
    norm = _normalize(text)
    if not norm:
        return 0.0
    alnum = sum(c.isalnum() or c.isspace() for c in norm)
    ratio = alnum / max(len(norm), 1)
    length_score = min(len(norm.split()) / 25, 1.0)
    return round(ratio * 0.6 + length_score * 0.4, 3)


def filter_pages(page_texts: List[str]) -> Dict[int, Dict[str, Any]]:
    """Pure heuristic — no LLM. Returns per-page blank/duplicate/quality."""
    result: Dict[int, Dict[str, Any]] = {}
    seen_norm: Dict[str, int] = {}

    for idx, text in enumerate(page_texts):
        page_num = idx + 1
        norm = _normalize(text)
        is_blank = len(norm) < 15
        duplicate_of = None

        if not is_blank:
            if norm in seen_norm:
                duplicate_of = seen_norm[norm]
            else:
                for prev_norm, prev_num in seen_norm.items():
                    if abs(len(norm) - len(prev_norm)) / max(len(prev_norm), 1) > 0.3:
                        continue
                    ratio = difflib.SequenceMatcher(None, norm[:2000], prev_norm[:2000]).ratio()
                    if ratio > 0.92:
                        duplicate_of = prev_num
                        break
                seen_norm[norm] = page_num

        result[page_num] = {
            "blank": is_blank,
            "duplicate_of": duplicate_of,
            "quality": _quality_score(text),
        }
    return result


def _default_classification() -> Dict[str, Any]:
    return {"type": "other", "confidence": 0.3, "relevant": False, "method": "fallback"}


def classify_pages(page_texts: List[str], page_filter: Dict[int, Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """Batched single LLM call for the whole doc; falls back to keyword
    heuristics per-page if the call fails or returns unusable output."""
    candidates: List[Tuple[int, str]] = [
        (i + 1, txt) for i, txt in enumerate(page_texts)
        if not page_filter.get(i + 1, {}).get("blank")
        and not page_filter.get(i + 1, {}).get("duplicate_of")
    ]
    if not candidates:
        return {}

    llm_result = _classify_pages_llm(candidates)
    if llm_result and len(llm_result) >= len(candidates) * 0.7:
        missing = [p for p, _ in candidates if p not in llm_result]
        if missing:
            heuristic = _classify_pages_heuristic(candidates)
            for p in missing:
                llm_result[p] = heuristic.get(p, _default_classification())
        return llm_result

    logger.warning("Page classification LLM output unusable — falling back to heuristic.")
    return _classify_pages_heuristic(candidates)


def _classify_pages_llm(candidates: List[Tuple[int, str]]) -> Dict[int, Dict[str, Any]]:
    payload = [{"page": p, "text": txt[:1500]} for p, txt in candidates]
    system = f"""You classify pages of an Indian insurance investigation case file.
For EACH page given, return exactly one type from: {", ".join(DOCUMENT_TYPES)}
Return ONLY JSON: {{"pages": [{{"page": <int>, "type": "<type>", "confidence": <0-1 float>}}]}}
One entry per input page. No prose, no markdown fences."""
    try:
        completion = _groq.chat.completions.create(
            model=_CLASSIFY_MODEL, temperature=0.0, max_tokens=2000,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": json.dumps({"pages": payload})},
            ],
        )
        raw = json.loads(completion.choices[0].message.content)
        out: Dict[int, Dict[str, Any]] = {}
        for row in raw.get("pages", []):
            page, ptype = row.get("page"), row.get("type")
            if page is None or ptype not in DOCUMENT_TYPES:
                continue
            out[int(page)] = {
                "type": ptype,
                "confidence": round(float(row.get("confidence", 0.6) or 0.6), 2),
                "relevant": ptype not in LOW_VALUE_TYPES,
                "method": "llm",
            }
        return out
    except Exception as e:
        logger.warning("Page classification LLM call failed: %s", e)
        return {}


_KEYWORD_MAP = {
    "discharge_summary": ["discharge summary", "discharge advice", "course in hospital"],
    "admission_summary": ["admission note", "initial assessment", "chief complaint"],
    "bills": ["invoice", "bill no", "grand total", "amount payable", "final bill"],
    "prescriptions": ["rx", "prescription", "tab.", "cap.", "syp.", "dosage"],
    "lab_reports": ["laboratory report", "test name", "reference range", "specimen"],
    "radiology_reports": ["impression:", "x-ray", "mri", "ct scan", "ultrasound", "usg"],
    "operative_notes": ["operative note", "surgery performed", "procedure performed", "operation theatre"],
    "id_proof": ["aadhaar", "government of india", "election commission", "permanent account number"],
    "consent_forms": ["consent form", "i hereby consent", "informed consent"],
    "insurance_forms": ["policy schedule", "terms and conditions", "insured verification form"],
    "accident_report": ["accident report", "alleged causes", "mlc", "fir no"],
    "nursing_notes": ["nursing note", "vitals chart", "tpr chart"],
}


def _classify_pages_heuristic(candidates: List[Tuple[int, str]]) -> Dict[int, Dict[str, Any]]:
    out: Dict[int, Dict[str, Any]] = {}
    for page, text in candidates:
        norm = _normalize(text)
        best_type, best_hits = "other", 0
        for dtype, keywords in _KEYWORD_MAP.items():
            hits = sum(1 for kw in keywords if kw in norm)
            if hits > best_hits:
                best_type, best_hits = dtype, hits
        out[page] = {
            "type": best_type,
            "confidence": 0.5 if best_hits else 0.3,
            "relevant": best_type not in LOW_VALUE_TYPES,
            "method": "heuristic",
        }
    return out


def group_pages_by_type(
    page_classifications: Dict[int, Dict[str, Any]],
    selected_pages: List[int],
) -> Dict[str, List[int]]:
    groups: Dict[str, List[int]] = {}
    for p in sorted(selected_pages):
        cls = page_classifications.get(p) or page_classifications.get(str(p)) or _default_classification()
        groups.setdefault(cls.get("type", "other"), []).append(p)
    return groups