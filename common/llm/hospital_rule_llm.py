"""
HOSPITAL RULE LLM - v3
======================
Architecture: EXTRACT → EVALUATE (two clean stages, never mixed)

Root cause of v1/v2 hallucinations:
  The LLM was asked to extract AND judge in one call.
  It filled missing values using medical knowledge instead of returning null.

v3 fix:
  Stage 1 — EXTRACT ONLY: LLM reads document, returns raw values verbatim.
             No rules shown. No judgment made. null if not found.
  Stage 2 — EVALUATE: The hospital's IF/THEN rules are applied to extracted values.
             LLM reads the rule for ONE parameter + its extracted value → returns flag/status.
             Rules drive everything. No medical reasoning allowed.

Additional fixes carried forward from v2:
  - OCR noise cleaning
  - Chunked extraction for large parameter sets
  - Robust JSON parser
  - Report date extraction
  - Clinical abstract from structured data
"""

import json
import logging
import re
from typing import Optional, Dict, List, Any

from groq import Groq

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────
# GROQ CLIENT
# ─────────────────────────────────────────────
groq_client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

MODEL_FAST = "llama-3.1-8b-instant"
MODEL_SMART = "llama-3.3-70b-versatile"
SMART_MODEL_THRESHOLD = 8
MAX_PARAMS_PER_CALL = 15


# ─────────────────────────────────────────────────────────────────────────────
# OCR NOISE CLEANING (unchanged from v2)
# ─────────────────────────────────────────────────────────────────────────────

_OCR_FIXES = [
    (r"\|",                      "I"),
    (r"'€",                      "c"),
    (r"\bNe\b",                  "No"),
    (r"(?<=[a-z])_(?=[a-z])",    " "),
    (r"[ \t]{2,}",               " "),
    (r"(\w)-\n(\w)",             r"\1\2"),
]

# Known field label aliases: when the document uses a different label than
# the hospital parameter name. Key = parameter name, Value = label(s) in document.
# This is the ONLY place where report-specific knowledge lives — and it's purely
# about label synonyms, never about field meaning or value interpretation.
FIELD_ALIASES: Dict[str, List[str]] = {
    "Nature of Specimen":  ["Specimen Type", "Specimen type", "Type of Specimen"],
    "Clinical Data":       ["Clinical Data", "Clinical Indication", "Clinical History"],
    "Gross Description":   ["Gross Examination", "Gross Description", "Macroscopic Examination"],
    "Macroscopic Examination": ["Gross Examination", "Macroscopic Examination", "Gross Description"],
    "Microscopic Findings":    ["Microscopic Examination", "Microscopic Findings", "Microscopy"],
    "Lymphatic / Vascular Invasion": ["Lymphovascular invasion", "Lymphatic/Vascular Invasion", "LVI"],
    "Lymphovascular Invasion":       ["Lymphovascular invasion", "LVI"],
}


def _merge_split_fields(text: str) -> str:
    """
    Fix OCR layout where a field label and its value are on separate lines.

    Before: "Clinical Data :\n\nIrregular shaped lesions..."
    After:  "Clinical Data : Irregular shaped lesions..."

    Also handles the multi-line gap case where the value is 1-3 blank lines below the label.
    """
    # Known section headers that should NOT be merged (they are standalone headings)
    _STANDALONE_HEADERS = {
        "histopathology report", "test report", "gross examination",
        "microscopic examination", "provisional diagnosis", "important instructions",
        "special studies", "end of report",
    }

    lines = text.splitlines()
    result = []
    i = 0
    while i < len(lines):
        line = lines[i]
        stripped = line.strip()

        # Detect pattern: "Label :" or "Label:" at end of line with no value after colon
        m = re.match(r'^(.+?)\s*:\s*$', stripped)
        if m:
            label = m.group(1).strip()
            if label.lower() not in _STANDALONE_HEADERS:
                # Look ahead up to 3 lines for the value (skipping blank lines)
                lookahead = []
                j = i + 1
                blank_count = 0
                while j < len(lines) and blank_count <= 2:
                    next_stripped = lines[j].strip()
                    if next_stripped == "":
                        blank_count += 1
                        j += 1
                        continue
                    # Stop if the next non-blank line looks like another label
                    if re.match(r'^[A-Za-z][A-Za-z /\(\)]+\s*:\s*$', next_stripped):
                        break
                    # Stop if it looks like a label:value pair already
                    if re.match(r'^[A-Za-z][A-Za-z /\(\)]+\s*:', next_stripped) and len(next_stripped) > 40:
                        break
                    lookahead.append(next_stripped)
                    j += 1
                    break  # only grab the first non-blank value line

                if lookahead:
                    result.append(f"{label} : {lookahead[0]}")
                    i = j  # skip the consumed lines
                    continue

        result.append(line)
        i += 1

    return "\n".join(result)


def clean_ocr_text(text: str) -> str:
    for pattern, replacement in _OCR_FIXES:
        try:
            text = re.sub(pattern, replacement, text)
        except re.error:
            pass
    # Merge split field labels with their values
    text = _merge_split_fields(text)
    # Collapse multiple blank lines
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


# ─────────────────────────────────────────────────────────────────────────────
# STAGE 1: PURE EXTRACTION
# LLM reads the document, returns verbatim values. No rules. No judgment.
# ─────────────────────────────────────────────────────────────────────────────

def build_extraction_prompt(document_text: str, param_names: List[str]) -> str:
    schema_keys = ",\n    ".join(
        '"{p}": "<exact text from document, or null>"\n    '.format(p=p)
        for p in param_names
    ).rstrip()

    # Build numbered list with alias hints
    param_lines = []
    for i, p in enumerate(param_names, 1):
        aliases = FIELD_ALIASES.get(p)
        if aliases:
            hint = " or ".join(f'"{a}"' for a in aliases)
            param_lines.append(f'{i}. "{p}"  [find this label in the document: {hint}]')
        else:
            param_lines.append(f'{i}. "{p}"')
    params_list = "\n".join(param_lines)

    divider = "\u2550" * 48
    return (
        "You are a precise medical document parser. Copy values verbatim from the document.\n\n"
        f"{divider}\nMEDICAL DOCUMENT:\n{divider}\n"
        f"{document_text}\n"
        f"{divider}\n\n"
        f"PARAMETERS TO FIND:\n{params_list}\n\n"
        "EXTRACTION RULES:\n\n"
        "RULE 1 - COPY VERBATIM:\n"
        "- Find the field label (or its alias listed above) in the document.\n"
        "- Copy the value that follows EXACTLY as written. Do not rephrase.\n"
        "- Examples:\n"
        '  * "Hemoglobin: 9.2 g/dL"  ->  "9.2 g/dL"\n'
        '  * "Lymphovascular invasion : Not identified."  ->  "Not identified"\n'
        '  * "Specimen Type: Trucut biopsy left breast"  ->  "Trucut biopsy left breast"\n\n'
        "RULE 2 - NULL = LABEL NOT IN DOCUMENT:\n"
        "- If the label (or its alias) is not in the document -> JSON null.\n"
        "- Do NOT infer, calculate, or use medical knowledge to fill missing values.\n"
        "- Do NOT copy a value from a different field because it seems related.\n\n"
        "RULE 3 - FIELD IDENTITY (read carefully):\n"
        '- "Clinical Data": value = the clinical indication / radiological finding on the request form.\n'
        '  Example: "BIRADS 4C bilateral breast lesions" or "suspicious right breast lesion"\n'
        "  NEVER patient name, age/gender, lab ID, or date.\n"
        '  If the text after "Clinical Data :" looks like demographics (e.g. "72Y/Female", a name) -> null.\n'
        '- "Nature of Specimen" or "Specimen Type": copy the printed specimen description.\n'
        '  Example: "Trucut biopsy left breast lesion (H/20557/25)"\n'
        '  NEVER invent "Diagnostic sample" or any phrase not literally in the document -> null if absent.\n'
        "- Header demographics (Name, Age/Gender, Lab.Id, UHID) are metadata.\n"
        "  Do NOT extract them unless the parameter explicitly asks for patient demographics.\n\n"
        "RULE 4 - MULTIPLE SPECIMENS:\n"
        "- If multiple specimens exist (A/B or separate accession numbers), include ALL values.\n\n"
        "RULE 5 - OUTPUT FORMAT:\n"
        "- Return ONLY a valid JSON object. No markdown, no explanation, no preamble.\n"
        "- Use JSON null (not the string 'null') for missing values.\n\n"
        "{{\n    " + schema_keys + "\n}}"
    )



def call_extraction_llm(prompt: str, num_params: int) -> str:
    model = MODEL_SMART if num_params >= SMART_MODEL_THRESHOLD else MODEL_FAST
    max_tokens = min(150 * num_params + 300, 4000)
    completion = groq_client.chat.completions.create(
        model=model,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        max_tokens=max_tokens,
    )
    return completion.choices[0].message.content.strip()


def parse_extraction_json(raw: str, expected_params: List[str]) -> Dict[str, Any]:
    """Parse raw LLM JSON, return {param: raw_value_or_none}."""

    def _try_parse(text: str) -> Optional[dict]:
        text = re.sub(r"```(?:json)?", "", text, flags=re.IGNORECASE).strip()
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1:
            return None
        json_str = text[start:end + 1]
        json_str = re.sub(r",\s*([}\]])", r"\1", json_str)
        json_str = "".join(c for c in json_str if ord(c) >= 32 or c in "\n\t")
        try:
            return json.loads(json_str)
        except json.JSONDecodeError as e:
            logger.warning(f"JSON parse error: {e}")
            return None

    parsed = _try_parse(raw)
    result: Dict[str, Any] = {}

    for param in expected_params:
        if parsed is None:
            result[param] = None
            continue

        value = parsed.get(param)
        if value is None:
            # Try case-insensitive match
            for k, v in parsed.items():
                if k.strip().lower() == param.strip().lower():
                    value = v
                    break

        # Normalise null-like strings to actual None
        if isinstance(value, str):
            null_strings = {
                "null", "none", "n/a", "na", "not mentioned", "not found",
                "not provided", "not present", "not available", ""
            }
            if value.strip().lower() in null_strings:
                value = None

        result[param] = value

    return result


def extract_raw_values_chunked(
    document_text: str,
    param_names: List[str],
) -> Dict[str, Any]:
    """Run Stage 1 extraction in chunks to respect token limits."""
    all_raw: Dict[str, Any] = {}

    for i in range(0, len(param_names), MAX_PARAMS_PER_CALL):
        chunk = param_names[i:i + MAX_PARAMS_PER_CALL]
        logger.info(f"Extraction chunk {i // MAX_PARAMS_PER_CALL + 1}: {chunk}")

        prompt = build_extraction_prompt(document_text, chunk)
        try:
            raw = call_extraction_llm(prompt, len(chunk))
            logger.debug(f"Raw extraction response:\n{raw[:400]}")
            chunk_result = parse_extraction_json(raw, chunk)
        except Exception as e:
            logger.error(f"Extraction LLM failed for chunk: {e}")
            chunk_result = {p: None for p in chunk}

        all_raw.update(chunk_result)

    return all_raw


# ─────────────────────────────────────────────────────────────────────────────
# STAGE 2: RULE-BASED EVALUATION
# Apply hospital's IF/THEN rules to the extracted raw values.
# The LLM's only job here is to parse the rule text and match the value.
# ─────────────────────────────────────────────────────────────────────────────

def extract_param_rule(rule_text: str, param_name: str) -> str:
    """
    Extract the rule block for a specific parameter from the full rule_text.
    Noise-tolerant: handles whitespace, minor capitalization differences.
    """
    if not rule_text or not rule_text.strip():
        return ""

    lines = rule_text.splitlines()
    blocks: Dict[str, List[str]] = {}
    current_param: Optional[str] = None
    param_norm = param_name.strip().lower()

    # All param names we might encounter as headings
    # We don't have the full list here, so we just detect "current param" by
    # checking if a line matches our target or would start a new section
    in_target = False

    for line in lines:
        stripped = line.strip()
        stripped_norm = stripped.lower()

        # Check if this line is the heading for our target parameter
        if stripped_norm == param_norm or stripped_norm.rstrip(",") == param_norm:
            in_target = True
            current_param = param_name
            if current_param not in blocks:
                blocks[current_param] = []
            continue

        # Check if this line starts a DIFFERENT parameter section
        # Heuristic: a line that is short (< 60 chars), no leading space, and not an IF/Flag line
        # is likely a new section heading
        if (in_target and stripped and len(stripped) < 60
                and not stripped.startswith("IF")
                and not stripped.startswith("Flag")
                and not stripped.startswith("Status")
                and not stripped.startswith("Interpretation")
                and not stripped.startswith("Stage")
                and not stripped.startswith("Record")
                and not stripped.startswith("→")
                and stripped_norm != param_norm):
            # Possible new section — stop collecting for current param
            # But only if it looks like a heading (no punctuation that would indicate it's a value)
            if not any(c in stripped for c in [":", "=", "<", ">", "≤", "≥"]):
                in_target = False

        if in_target and current_param:
            if current_param not in blocks:
                blocks[current_param] = []
            blocks[current_param].append(line)

    raw = "\n".join(blocks.get(param_name, [])).strip()
    return raw


def build_evaluation_prompt(
    param_name: str,
    raw_value: Any,
    rule_block: str,
) -> str:
    """
    Stage 2 prompt: apply the hospital's rule to the extracted value.
    """
    value_str = str(raw_value) if raw_value is not None else "NOT PROVIDED"

    return f"""You are a rule evaluation engine for a hospital information system.
Your job is to apply a predefined rule to a lab/clinical value and return the result.

PARAMETER: "{param_name}"
EXTRACTED VALUE: {value_str}

HOSPITAL RULE FOR THIS PARAMETER:
────────────────────────────────────────
{rule_block if rule_block else f"No specific rule defined. If value is present, Status: Normal. If absent, Status: Not mentioned."}
────────────────────────────────────────

EVALUATION INSTRUCTIONS:
1. Read the extracted value above.
2. Match it against the IF/THEN conditions in the rule.
3. Return the appropriate Flag, Status, or Interpretation from the rule.
4. Do NOT use your own medical knowledge — only apply what the rule says.
5. If the value is "NOT PROVIDED" → return the "NOT provided" branch of the rule (usually "Not mentioned").
6. If no rule condition matches exactly, return Status: "Not applicable".

Return ONLY a JSON object with this exact structure:
{{
  "status": "normal" | "abnormal" | "not_applicable",
  "flag": "<the flag text from the rule, or null>",
  "interpretation": "<brief interpretation from the rule, or null>",
  "reason": "<which rule condition matched, in plain English>"
}}

No markdown. No explanation outside the JSON."""


def evaluate_single_param(
    param_name: str,
    raw_value: Any,
    rule_block: str,
) -> Dict[str, Any]:
    """Apply hospital rule to one extracted value. Returns status/flag/interpretation."""

    # Fast path: value is None → "not mentioned" without LLM call
    if raw_value is None:
        return {
            "value": None,
            "status": "not_applicable",
            "flag": None,
            "interpretation": None,
            "reason": "Parameter not found in document",
        }

    # Fast path: no rule defined → just record the value
    if not rule_block:
        return {
            "value": raw_value,
            "status": "normal",
            "flag": None,
            "interpretation": None,
            "reason": "No hospital rule defined for this parameter",
        }

    prompt = build_evaluation_prompt(param_name, raw_value, rule_block)

    try:
        completion = groq_client.chat.completions.create(
            model=MODEL_FAST,  # evaluation is simpler than extraction
            messages=[{"role": "user", "content": prompt}],
            temperature=0.0,
            max_tokens=200,
        )
        raw_response = completion.choices[0].message.content.strip()
        logger.debug(f"Evaluation response for '{param_name}': {raw_response}")
    except Exception as e:
        logger.error(f"Evaluation LLM failed for '{param_name}': {e}")
        return {
            "value": raw_value,
            "status": "not_applicable",
            "flag": None,
            "interpretation": None,
            "reason": f"Evaluation error: {e}",
        }

    # Parse evaluation response
    try:
        text = re.sub(r"```(?:json)?", "", raw_response, flags=re.IGNORECASE).strip()
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end != -1:
            json_str = text[start:end + 1]
            json_str = re.sub(r",\s*([}\]])", r"\1", json_str)
            eval_result = json.loads(json_str)

            status = str(eval_result.get("status", "not_applicable")).lower()
            if "abnormal" in status:
                status = "abnormal"
            elif "normal" in status:
                status = "normal"
            else:
                status = "not_applicable"

            return {
                "value": raw_value,
                "status": status,
                "flag": eval_result.get("flag"),
                "interpretation": eval_result.get("interpretation"),
                "reason": eval_result.get("reason", ""),
            }
    except Exception as e:
        logger.warning(f"Failed to parse evaluation JSON for '{param_name}': {e}")

    return {
        "value": raw_value,
        "status": "not_applicable",
        "flag": None,
        "interpretation": None,
        "reason": "Could not parse evaluation result",
    }


def evaluate_all_params(
    raw_values: Dict[str, Any],
    rule_text: str,
    param_names: List[str],
) -> Dict[str, Dict[str, Any]]:
    """Run Stage 2 evaluation for all parameters."""
    structured_data: Dict[str, Dict[str, Any]] = {}

    for param in param_names:
        raw_value = raw_values.get(param)
        rule_block = extract_param_rule(rule_text, param)

        logger.info(f"Evaluating '{param}' | value={str(raw_value)[:60]} | rule={'yes' if rule_block else 'no'}")
        result = evaluate_single_param(param, raw_value, rule_block)
        structured_data[param] = result

        status_display = result["status"].upper().ljust(15)
        value_display = str(result["value"])[:80] if result["value"] else "null"
        flag_display = f" [{result['flag']}]" if result.get("flag") else ""
        logger.info(f"  [{status_display}] {param}: {value_display}{flag_display}")

    return structured_data


# ─────────────────────────────────────────────────────────────────────────────
# REPORT DATE EXTRACTION (unchanged from v2)
# ─────────────────────────────────────────────────────────────────────────────

def extract_report_date(text: str) -> Optional[str]:
    date_patterns = [
        r"Report\s*(?:Date|Dt\.?\s*Tm\.?)\s*[:\-]?\s*(\d{1,2}[-/\s][A-Za-z]{3,9}[-/\s]\d{2,4})",
        r"Report\s*(?:Date|Dt\.?\s*Tm\.?)\s*[:\-]?\s*(\d{1,2}[-/]\d{1,2}[-/]\d{2,4})",
        r"Reg\.?\s*Date\s*[:\-]?\s*(\d{1,2}[-/][A-Za-z]{3}[-/]\d{4})",
        r"(?:Date\s*of\s*Report|Reported\s*on)\s*[:\-]?\s*(\d{1,2}[-/][A-Za-z]{3,9}[-/]\d{2,4})",
    ]
    for pat in date_patterns:
        m = re.search(pat, text[:2000], re.IGNORECASE)
        if m:
            return m.group(1).strip()

    prompt = f"""Read this medical document header and return ONLY the report date.

DOCUMENT (first 1500 chars):
{text[:1500]}

Return ONLY the date value in DD-Mon-YYYY format (e.g. 11-Dec-2025).
If no date found, return: NOT_FOUND"""

    try:
        completion = groq_client.chat.completions.create(
            model=MODEL_FAST,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=30,
        )
        result = completion.choices[0].message.content.strip()
        if result.upper() != "NOT_FOUND" and result:
            return result
    except Exception as e:
        logger.error(f"Date extraction failed: {e}")

    return None


# ─────────────────────────────────────────────────────────────────────────────
# CLINICAL ABSTRACT (unchanged from v2)
# ─────────────────────────────────────────────────────────────────────────────

def generate_clinical_abstract(
    structured_data: Dict[str, Dict],
    category: str,
    subcategory: str,
) -> str:
    found = {
        k: v for k, v in structured_data.items()
        if v.get("value") is not None and v.get("status") in ("normal", "abnormal")
    }

    if not found:
        return "No significant findings could be extracted from this document."

    abnormal = {k: v for k, v in found.items() if v["status"] == "abnormal"}
    normal = {k: v for k, v in found.items() if v["status"] == "normal"}

    lines = []
    for param, data in abnormal.items():
        flag = f" [{data['flag']}]" if data.get("flag") else ""
        lines.append(f"[ABNORMAL] {param}: {data['value']}{flag} — {data.get('reason', '')}")
    for param, data in normal.items():
        lines.append(f"[NORMAL] {param}: {data['value']}")

    findings_text = "\n".join(lines)

    prompt = f"""You are a senior clinician writing a brief clinical summary.

REPORT TYPE: {category} / {subcategory}

EXTRACTED FINDINGS:
{findings_text}

Write ONE concise clinical summary paragraph (max 80 words).
- Lead with the most critical ABNORMAL findings first
- Include specific values and their clinical significance
- Briefly mention key normal findings if relevant
- Professional clinical prose — no bullet points, no headers
- Be medically accurate and specific"""

    try:
        completion = groq_client.chat.completions.create(
            model=MODEL_FAST,
            messages=[{"role": "user", "content": prompt}],
            temperature=0,
            max_tokens=200,
        )
        return completion.choices[0].message.content.strip()
    except Exception as e:
        logger.error(f"Abstract generation failed: {e}")
        if abnormal:
            return "Abnormal findings: " + "; ".join(
                f"{k}: {v['value']}" for k, v in list(abnormal.items())[:5]
            ) + "."
        return "Clinical summary unavailable."


# ─────────────────────────────────────────────────────────────────────────────
# MAIN ENTRY POINT
# ─────────────────────────────────────────────────────────────────────────────

def run_hospital_rule_llm(
    *,
    text: str,
    category: str,
    subcategory: str,
    values: List[str],
    rule_text: str,
) -> Dict:
    """
    Main entry point: extract and evaluate all parameters from a medical document.

    Architecture:
        1. Clean OCR noise
        2. STAGE 1: Extract raw values from document (LLM reads doc only, no rules)
        3. STAGE 2: Evaluate each value against hospital rules (LLM reads rule only)
        4. Extract report date
        5. Generate clinical abstract

    Args:
        text:        Full raw text of the medical document (from OCR)
        category:    Report category (e.g., "Pathology", "Haematology")
        subcategory: Report subcategory (e.g., "Biopsy", "CBC", "Bone Marrow")
        values:      List of parameter names to extract and evaluate
        rule_text:   Rule definitions block containing IF/THEN criteria per parameter

    Returns:
        {
            "report_date": str | None,
            "structured_data": {
                "ParamName": {
                    "value": str | None,         # raw value from document
                    "status": "normal" | "abnormal" | "not_applicable",
                    "flag": str | None,           # flag text from hospital rule
                    "interpretation": str | None, # interpretation from hospital rule
                    "reason": str                 # which rule condition matched
                }, ...
            },
            "clinical_abstract": str,
            "category": str,
            "subcategory": str
        }
    """

    logger.info(f"Starting v3 extraction: {category}/{subcategory} | {len(values)} parameters")

    if not values:
        return {
            "report_date": None,
            "structured_data": {},
            "clinical_abstract": "No parameters specified for extraction.",
            "category": category,
            "subcategory": subcategory,
        }

    # ── 1. Clean OCR noise ──────────────────────────────────────────────────
    clean_text = clean_ocr_text(text)
    logger.info(f"OCR cleaned: {len(text)} → {len(clean_text)} chars")

    # ── 2. STAGE 1: Extract raw values ──────────────────────────────────────
    logger.info("Stage 1: Extracting raw values from document...")
    raw_values = extract_raw_values_chunked(clean_text, values)
    logger.info(f"Stage 1 complete. Found values for "
                f"{sum(1 for v in raw_values.values() if v is not None)}/{len(values)} parameters")

    # ── 3. STAGE 2: Evaluate against hospital rules ─────────────────────────
    logger.info("Stage 2: Evaluating values against hospital rules...")
    structured_data = evaluate_all_params(raw_values, rule_text, values)
    logger.info("Stage 2 complete.")

    # ── 4. Extract report date ──────────────────────────────────────────────
    report_date = extract_report_date(clean_text)
    logger.info(f"Report date: {report_date}")

    # ── 5. Generate clinical abstract ───────────────────────────────────────
    clinical_abstract = generate_clinical_abstract(structured_data, category, subcategory)

    return {
        "report_date": report_date,
        "structured_data": structured_data,
        "clinical_abstract": clinical_abstract,
        "category": category,
        "subcategory": subcategory,
    }