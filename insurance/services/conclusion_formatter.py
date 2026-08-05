"""
conclusion_formatter.py — plain-text version (no coloured boxes/tags)
"""
from __future__ import annotations

import html as _html_module
import re
from typing import List, Tuple


_SECTION_TITLES = {
    1: "HOSPITAL VISIT FINDINGS",
    2: "MEMBER / INSURED VISIT FINDINGS",
    3: "CONCLUSION",
}


def _detect_verdict(text: str) -> str:
    tail = text.lower()[-400:]
    if "suspected" in tail:
        return "SUSPECTED"
    if "genuine" in tail:
        return "GENUINE"
    return ""


def _esc(text: str) -> str:
    return _html_module.escape(text)

_BULLET_RE = re.compile(r"^[•\-\*]\s+(.*)$")

def _format_bullet_list(items: List[str]) -> str:
    lis = "".join(
        f'<li style="margin:2px 0;font-size:9.5px;color:#111;line-height:1.5;">{_esc(item.strip())}</li>'
        for item in items if item.strip()
    )
    return f'<ul style="margin:4px 0 6px 18px;padding:0;">{lis}</ul>'

def _format_discrepancy_line(line: str) -> str:
    m = re.match(r"^\[([A-Z /]+)\]\s*(.+)$", line.strip())
    if not m:
        stripped = line.strip()
        if not stripped or stripped.lower() in ("kindly note —", "kindly note-", "kindly note"):
            return ""
        return (
            f'<p style="margin:2px 0;font-size:9.5px;color:#111;">'
            f'{_esc(stripped)}</p>'
        )

    tag  = m.group(1).strip().upper()
    body = m.group(2).strip()

    # Plain text line: bold tag prefix, no background/box
    return (
        f'<p style="margin:3px 0;font-size:9.5px;color:#111;line-height:1.5;">'
        f'<span style="font-weight:bold;">[{_esc(tag)}]</span> '
        f'{_esc(body)}</p>'
    )


def _format_paragraph(text: str) -> str:
    if not text.strip():
        return ""
    return (
        f'<p style="margin:4px 0 6px 0;line-height:1.65;text-align:justify;'
        f'font-size:9.5px;color:#111;">{_esc(text.strip())}</p>'
    )


def _format_verdict_line(text: str, verdict: str) -> str:
    if verdict == "SUSPECTED":
        label = "SUSPECTED"
    elif verdict == "GENUINE":
        label = "GENUINE"
    else:
        label = "VERDICT"

    return (
        f'<p style="margin:8px 0 4px 0;font-size:9.5px;color:#111;line-height:1.6;">'
        f'<span style="font-weight:bold;text-transform:uppercase;">'
        f'FINAL VERDICT — {label}:</span> {_esc(text.strip())}</p>'
    )


def _section_header(number: int, title: str) -> str:
    return (
        f'<p style="margin:10px 0 6px 0;font-weight:bold;font-size:10.5px;'
        f'color:#111;text-transform:uppercase;letter-spacing:0.3px;'
        f'border-bottom:1px solid #333;padding-bottom:3px;">'
        f'SECTION {number} — {_esc(title)}</p>'
    )


def _sub_header(text: str) -> str:
    return (
        f'<p style="font-weight:bold;font-size:9.5px;color:#111;'
        f'margin:6px 0 4px 0;text-transform:uppercase;letter-spacing:0.2px;">'
        f'{_esc(text.strip())}</p>'
    )


_SECTION_RE = re.compile(
    r"^SECTION\s+(\d)\s*[—\-–]\s*(.+)$",
    re.IGNORECASE | re.MULTILINE,
)

def _split_sections(text: str) -> List[Tuple[int, str, str]]:
    matches = list(_SECTION_RE.finditer(text))
    if not matches:
        return [(1, "HOSPITAL VISIT FINDINGS", text.strip())]
    sections: List[Tuple[int, str, str]] = []
    for i, m in enumerate(matches):
        num   = int(m.group(1))
        title = m.group(2).strip()
        start = m.end()
        end   = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body  = text[start:end].strip()
        sections.append((num, title, body))
    return sections


_VERDICT_PATTERNS = [
    re.compile(r"hence based on the above.*?(?:suspected|genuine)\.?", re.IGNORECASE),
    re.compile(r"claim (?:is found to be|seems to be)\s+(?:SUSPECTED|GENUINE)\.?", re.IGNORECASE),
    re.compile(r"claim found to be\s+(?:Suspected|Genuine)\.?", re.IGNORECASE),
    re.compile(r"recommended for settlement\.?", re.IGNORECASE),
]

def _is_verdict_line(line: str) -> bool:
    return any(p.search(line) for p in _VERDICT_PATTERNS)


def _render_section3(body: str, overall_verdict: str) -> str:
    lines  = body.splitlines()
    chunks: List[str] = []
    in_discrepancy_block = False
    pending_paragraphs: List[str] = []
    current_para_lines: List[str] = []

    def _flush_para():
        if current_para_lines:
            joined = " ".join(l.strip() for l in current_para_lines if l.strip())
            if joined:
                pending_paragraphs.append(joined)
            current_para_lines.clear()

    def _flush_pending():
        i = 0
        bullets: List[str] = []
        while i < len(pending_paragraphs):
            p = pending_paragraphs[i]
            if p.startswith("__BULLET__"):
                bullets.append(p[len("__BULLET__"):])
            else:
                if bullets:
                    chunks.append(_format_bullet_list(bullets)); bullets = []
                chunks.append(_format_paragraph(p))
            i += 1
        if bullets:
            chunks.append(_format_bullet_list(bullets))
        pending_paragraphs.clear()

    i = 0
    while i < len(lines):
        line    = lines[i]
        stripped = line.strip()

        if _is_verdict_line(stripped):
            _flush_para(); _flush_pending()
            if in_discrepancy_block:
                in_discrepancy_block = False
            chunks.append(_format_verdict_line(stripped, overall_verdict))
            i += 1; continue

        if re.match(r"^DISCREPANCIES\s*$", stripped, re.IGNORECASE):
            _flush_para(); _flush_pending()
            chunks.append(_sub_header("Discrepancies"))
            in_discrepancy_block = True
            i += 1; continue

        if re.match(r"^kindly note\s*[—\-–]?\s*$", stripped, re.IGNORECASE):
            in_discrepancy_block = True
            i += 1; continue

        if re.match(r"^\[[A-Z /]+\]", stripped):
            _flush_para(); _flush_pending()
            in_discrepancy_block = True
            rendered = _format_discrepancy_line(stripped)
            if rendered:
                chunks.append(rendered)
            i += 1; continue

        if in_discrepancy_block:
            if not stripped:
                in_discrepancy_block = False
                i += 1; continue
            rendered = _format_discrepancy_line(stripped)
            if rendered:
                chunks.append(rendered)
            i += 1; continue

        if not stripped:
            _flush_para(); _flush_pending()
            i += 1; continue

        bm = _BULLET_RE.match(stripped)
        if bm:
            _flush_para()
            pending_paragraphs.append(f"__BULLET__{bm.group(1)}")
            i += 1; continue

        current_para_lines.append(stripped)
        i += 1

    _flush_para(); _flush_pending()
    return "\n".join(chunks)


def _render_prose_section(body: str) -> str:
    chunks: List[str] = []
    current: List[str] = []
    bullet_items: List[str] = []

    def _flush_para():
        if current:
            joined = " ".join(l.strip() for l in current if l.strip())
            if joined:
                chunks.append(_format_paragraph(joined))
            current.clear()

    def _flush_bullets():
        if bullet_items:
            chunks.append(_format_bullet_list(bullet_items))
            bullet_items.clear()

    for line in body.splitlines():
        stripped = line.strip()
        if not stripped:
            _flush_para(); _flush_bullets()
            continue
        m = _BULLET_RE.match(stripped)
        if m:
            _flush_para()
            bullet_items.append(m.group(1))
        else:
            _flush_bullets()
            current.append(line)

    _flush_para(); _flush_bullets()
    return "\n".join(chunks)


def _section_wrapper(number: int, title: str, inner_html: str) -> str:
    return (
        f'<div style="margin-bottom:10px;">'
        + _section_header(number, title)
        + f'<div style="padding:0 2px;">'
        + inner_html
        + f'</div>'
        + f'</div>'
    )


def format_conclusion_html(conclusion_raw: str) -> str:
    if not conclusion_raw or not conclusion_raw.strip():
        return '<p class="no-conclusion">No conclusion provided.</p>'

    # Already rich HTML (from doctor editor with base64 images etc.) — pass through
    if re.search(r"<(div|span|img|table|p\s)[^>]*>", conclusion_raw):
        def _add_max_width(match: re.Match) -> str:
            tag = match.group(0)
            if "max-width" not in tag:
                tag = tag.replace(
                    "<img ",
                    '<img style="max-width:160mm;height:auto;display:block;margin:4px 0;" ',
                    1,
                )
            return tag
        return re.sub(r"<img[^>]+>", _add_max_width, conclusion_raw, flags=re.IGNORECASE)

    # Plain text — parse and format
    overall_verdict = _detect_verdict(conclusion_raw)
    sections        = _split_sections(conclusion_raw)

    section_html_parts: List[str] = []
    for num, title, body in sections:
        inner = _render_section3(body, overall_verdict) if num == 3 else _render_prose_section(body)
        section_html_parts.append(_section_wrapper(num, title, inner))

    return (
        '<div style="font-family:Arial,sans-serif;font-size:9.5px;color:#111;line-height:1.6;">\n'
        + "\n".join(section_html_parts)
        + "\n</div>"
    )
def get_section_html(conclusion_raw: str, section_number: int) -> str:
    """
    Returns rendered HTML for a single section (1, 2, or 3) of the doctor's
    conclusion text, without the "SECTION N — TITLE" heading.
    Returns '' if empty, already-rich HTML, or section not found.
    """
    if not conclusion_raw or not conclusion_raw.strip():
        return ""

    if re.search(r"<(div|span|img|table|p\s)[^>]*>", conclusion_raw):
        return ""

    overall_verdict = _detect_verdict(conclusion_raw)
    for num, title, body in _split_sections(conclusion_raw):
        if num == section_number:
            if num == 3:
                return _render_section3(body, overall_verdict)
            return _render_prose_section(body)
    return ""