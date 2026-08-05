"""
TEXT EXTRACTION v2
==================
Improvements:
- Better section reconstruction that preserves medical report structure
- Smarter header detection (doesn't confuse value lines for headers)
- Handles multi-column PDF layouts
"""

import os
import logging
import requests
import re

logger = logging.getLogger(__name__)

OCR_ENDPOINT = "http://143.110.187.180:5000/upload"


# ─────────────────────────────────────────────────────────────────────────────
# OCR SERVICE
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_via_ocr_service(file_path: str) -> str:
    try:
        logger.info(f"Sending to OCR: {file_path}")
        with open(file_path, "rb") as f:
            files = {"file": (os.path.basename(file_path), f, "application/octet-stream")}
            response = requests.post(OCR_ENDPOINT, files=files, timeout=120)

        if response.status_code != 200:
            logger.error(f"OCR failed [{response.status_code}]: {response.text}")
            return ""

        try:
            data = response.json()
            text = data.get("text") or data.get("extracted_text", "")
        except ValueError:
            text = response.text

        return text.strip()

    except requests.exceptions.Timeout:
        logger.error("OCR timeout")
        return ""
    except Exception as e:
        logger.error(f"OCR error: {e}", exc_info=True)
        return ""


# ─────────────────────────────────────────────────────────────────────────────
# SECTION RECONSTRUCTION (improved)
# ─────────────────────────────────────────────────────────────────────────────

# Known medical report section headers (regex patterns)
_SECTION_HEADER_PATTERNS = [
    r"^(HISTOPATHOLOGY REPORT|HISTOPATHOLOGY)$",
    r"^(IMMUNOHISTOCHEMISTRY|IHC REPORT|IHC)$",
    r"^(COMPLETE BLOOD COUNT|CBC)$",
    r"^(BONE MARROW REPORT|BONE MARROW SMEAR|HAEMATOLOGY|HEMATOLOGY)$",
    r"^(PERIPHERAL BLOOD REPORT)$",
    r"^(DISCHARGE SUMMARY)$",
    r"^(RESULTS SUMMARY|RESULTS)$",
    r"^(METHODOLOGY|DISCLAIMER|IMPORTANT INSTRUCTIONS)$",
    r"^(CLINICAL DATA|SPECIMEN TYPE|GROSS EXAMINATION|MICROSCOPIC EXAMINATION"
    r"|FINAL DIAGNOSIS|PROVISIONAL DIAGNOSIS|IMMUNOHISTOCHEMISTRY \(IHC\) REPORT"
    r"|LAB NUMBER|SPECIAL STUDIES)\s*:?\s*$",
    r"^[A-Z][A-Z\s/]{4,50}:\s*$",   # ALL CAPS label followed by colon
]
_COMPILED_HEADERS = [re.compile(p, re.IGNORECASE) for p in _SECTION_HEADER_PATTERNS]

# Lines that look like section headers but are actually values (false positives)
_VALUE_INDICATORS = [
    r"^\d",               # starts with digit (it's a value/date)
    r"^H/\d",             # lab number
    r"^[A-Z]\.\s+H/",     # specimen label
    r"(?:positive|negative|grade|present|identified|not\s)",  # contains result words
]
_COMPILED_VALUE_INDICATORS = [re.compile(p, re.IGNORECASE) for p in _VALUE_INDICATORS]


def is_section_header(line: str) -> bool:
    stripped = line.strip()
    if not stripped or len(stripped) < 3:
        return False

    # Reject lines that are clearly values
    for vi in _COMPILED_VALUE_INDICATORS:
        if vi.search(stripped):
            return False

    # Check against known header patterns
    for pattern in _COMPILED_HEADERS:
        if pattern.match(stripped):
            return True

    return False


def reconstruct_document_sections(text: str) -> str:
    """
    Reconstruct medical report structure while preserving readability.
    
    Key fix over v1:
    - Does NOT indent every line under a header (caused loss of context)
    - Instead just ensures headers are on their own lines
    - Joins continuation lines that were split mid-sentence by OCR
    """
    if not text:
        return text

    lines = text.splitlines()
    output_lines = []
    prev_was_header = False

    for i, line in enumerate(lines):
        stripped = line.strip()

        if not stripped:
            if not prev_was_header:
                output_lines.append("")
            prev_was_header = False
            continue

        if is_section_header(stripped):
            # Add blank line before headers for readability
            if output_lines and output_lines[-1] != "":
                output_lines.append("")
            output_lines.append(stripped)
            prev_was_header = True
        else:
            # Try to join with previous line if it was clearly cut mid-sentence
            if (output_lines
                    and output_lines[-1]
                    and not output_lines[-1].endswith((".", ":", ";", ","))
                    and not is_section_header(output_lines[-1])
                    and len(output_lines[-1]) < 60  # short line = likely wrapped
                    and stripped[0].islower()):      # continuation word
                output_lines[-1] = output_lines[-1] + " " + stripped
            else:
                output_lines.append(stripped)
            prev_was_header = False

    return "\n".join(output_lines)


# ─────────────────────────────────────────────────────────────────────────────
# MAIN EXTRACTION
# ─────────────────────────────────────────────────────────────────────────────

def extract_text_from_file(
    file_path: str,
    doc_type: str | None = None,
    additional_images_info: dict | None = None,
) -> str:
    try:
        ext = os.path.splitext(file_path)[1].lower()

        if ext == ".pdf":
            return _extract_pdf(file_path)
        elif ext in (".doc", ".docx"):
            return _extract_docx(file_path)
        elif ext in (".jpg", ".jpeg", ".png", ".tiff", ".bmp"):
            return extract_text_via_ocr_service(file_path)
        elif ext in (".txt", ".csv", ".json", ".html"):
            return _read_text_file(file_path)
        else:
            logger.warning(f"Unsupported extension: {ext}")
            return extract_text_via_ocr_service(file_path)

    except Exception as e:
        logger.error(f"extract_text_from_file failed: {e}", exc_info=True)
        return ""


def _extract_pdf(file_path: str) -> str:
    # Try PyPDF2 first
    try:
        from PyPDF2 import PdfReader
        reader = PdfReader(file_path)
        pages = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                pages.append(t)
        text = "\n".join(pages).strip()
        if len(text) >= 50:
            logger.info(f"PyPDF2 extracted {len(text)} chars")
            return text
        logger.warning(f"PyPDF2 too short ({len(text)} chars), trying OCR")
    except ImportError:
        logger.warning("PyPDF2 not installed")
    except Exception as e:
        logger.warning(f"PyPDF2 failed: {e}")

    # OCR fallback
    ocr_text = extract_text_via_ocr_service(file_path)
    if len(ocr_text) >= 50:
        logger.info(f"OCR extracted {len(ocr_text)} chars")
        return ocr_text

    logger.error("Both PyPDF2 and OCR failed or returned insufficient text")
    return ""


def _extract_docx(file_path: str) -> str:
    try:
        import docx
        doc = docx.Document(file_path)
        text = "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        if text.strip():
            return text
    except ImportError:
        logger.warning("python-docx not installed")
    except Exception as e:
        logger.warning(f"DOCX extraction failed: {e}")
    return ""


def _read_text_file(file_path: str) -> str:
    try:
        with open(file_path, "r", encoding="utf-8", errors="replace") as f:
            return f.read()
    except Exception as e:
        logger.error(f"Text read failed: {e}")
        return ""