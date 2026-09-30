"""
routes/agents/chunking.py
─────────────────────────────────────────────────────────────────────────────
Shared, dependency-free helpers for splitting a claim's combined document
text into per-PDF and per-page-batch chunks.

WHY THIS FILE EXISTS:
Both base.py (Pass 1 extraction) and unified_report_agent.py (episode /
member classification) need to split large single files into smaller
page-batches instead of truncating them. Putting the logic here (rather
than importing between base.py and unified_report_agent.py) avoids a
circular import, since unified_report_agent.py already imports FROM
base.py.

HARD CAP:
A single source PDF is capped at MAX_FILE_CHARS (800,000 chars) per the
agreed limit. Content in one file beyond that is truncated with a warning
— this is a deliberate cost/latency ceiling, not expected to be hit in
normal operation.
"""
from __future__ import annotations

import logging
import re
from typing import Dict, Iterable, List, Tuple

logger = logging.getLogger(__name__)

# Hard ceiling per single source file. Anything beyond this is truncated
# (with a loud warning) rather than batched indefinitely — protects
# against pathological files blowing up latency/cost.
MAX_FILE_CHARS = 800_000

_PDF_BLOCK_RE = re.compile(
    r'<!-- PDF_START:\s*(.+?)\s*-->(.*?)<!-- PDF_END:\s*\1?\s*-->',
    flags=re.IGNORECASE | re.DOTALL,
)


def split_text_by_pdf(full_text: str) -> Dict[str, str]:
    """
    Split combined raw_llama_markdown into {filename: file_text}, in
    document order, using the <!-- PDF_START: name --> / <!-- PDF_END -->
    markers that _llamacloud_parse() already writes.

    Applies MAX_FILE_CHARS as a hard per-file cap (truncates + warns).

    Falls back to {"<unknown>": full_text} if no markers are found, so
    callers never special-case "no markers present".
    """
    blocks: Dict[str, str] = {}
    matches = list(_PDF_BLOCK_RE.finditer(full_text or ""))
    if not matches:
        text = full_text or ""
        if len(text) > MAX_FILE_CHARS:
            logger.warning(
                "split_text_by_pdf: unmarked text exceeds MAX_FILE_CHARS "
                "(%d > %d) — truncating.", len(text), MAX_FILE_CHARS,
            )
            text = text[:MAX_FILE_CHARS]
        return {"<unknown>": text}

    for m in matches:
        fname = m.group(1).strip()
        content = m.group(2)
        if fname in blocks:
            blocks[fname] += "\n" + content
        else:
            blocks[fname] = content

    for fname, content in list(blocks.items()):
        if len(content) > MAX_FILE_CHARS:
            logger.warning(
                "split_text_by_pdf: file=%s exceeds MAX_FILE_CHARS "
                "(%d > %d) — truncating this file's content. Content past "
                "the cap is dropped entirely, not just unseen by one call.",
                fname, len(content), MAX_FILE_CHARS,
            )
            blocks[fname] = content[:MAX_FILE_CHARS]

    return blocks


def split_file_into_pages(file_text: str) -> List[Tuple[int, str]]:
    """Split ONE file's text into [(page_number, page_content_with_marker), ...]."""
    parts = re.split(r'<!-- PAGE_START: (\d+) -->', file_text or "", flags=re.IGNORECASE)
    pages: List[Tuple[int, str]] = []
    for i in range(1, len(parts), 2):
        try:
            num = int(parts[i])
        except (ValueError, IndexError):
            continue
        content = parts[i + 1] if i + 1 < len(parts) else ""
        pages.append((num, content))
    return pages


def extract_pages(full_text: str, filename: str, page_numbers: Iterable[int]) -> str:
    """Extract specific pages from ONE named file within the combined text."""
    files = split_text_by_pdf(full_text)
    file_text = files.get(filename)
    if file_text is None:
        logger.warning("extract_pages: filename %r not found in split output", filename)
        return ""
    wanted = set(page_numbers)
    out: List[str] = []
    for num, content in split_file_into_pages(file_text):
        if num in wanted:
            out.append(f"<!-- PDF_START: {filename} -->\n<!-- PAGE_START: {num} -->{content}")
    return "\n".join(out)


def extract_page_range(full_text: str, filename: str, start_page: int, end_page: int) -> str:
    """Extract an inclusive page range from ONE named file."""
    if start_page > end_page:
        start_page, end_page = end_page, start_page
    return extract_pages(full_text, filename, range(start_page, end_page + 1))


def render_page_batch(filename: str, batch: List[Tuple[int, str]]) -> str:
    """Reconstruct PDF_START/PAGE_START-marked text for one batch of pages,
    in the same shape the rest of the pipeline already expects."""
    parts = [f"<!-- PDF_START: {filename} -->"]
    for num, content in batch:
        parts.append(f"<!-- PAGE_START: {num} -->{content}")
    parts.append(f"<!-- PDF_END: {filename} -->")
    return "\n".join(parts)


def batch_file_pages(
    file_text: str,
    max_chars: int = 130_000,
    overlap_pages: int = 1,
) -> List[List[Tuple[int, str]]]:
    """
    Split ONE file's pages into batches, each roughly <= max_chars of raw
    page content, with a small page overlap between consecutive batches
    so content sitting near a batch boundary (e.g. an admission note that
    starts on the last page of one batch) is still seen whole by at least
    one batch.
    """
    pages = split_file_into_pages(file_text)

    if not pages:
        # No PAGE_START markers found at all (defensive — LlamaCloud
        # parses always emit them, but don't assume).
        if not file_text:
            return []
        if len(file_text) <= max_chars:
            return [[(0, file_text)]]
        # Oversized AND unmarked — fall back to raw char-window slicing so
        # it still gets chunked instead of ending up as one giant batch.
        chunks: List[List[Tuple[int, str]]] = []
        step = max(max_chars - 2000, 1000)
        for start in range(0, len(file_text), step):
            chunks.append([(0, file_text[start:start + max_chars])])
            if start + max_chars >= len(file_text):
                break
        return chunks

    batches: List[List[Tuple[int, str]]] = []
    current: List[Tuple[int, str]] = []
    current_len = 0

    for num, content in pages:
        page_len = len(content)
        if current and current_len + page_len > max_chars:
            batches.append(current)
            overlap_start = max(0, len(current) - overlap_pages)
            current = current[overlap_start:]
            current_len = sum(len(c) for _, c in current)
        current.append((num, content))
        current_len += page_len

    if current:
        batches.append(current)
    return batches