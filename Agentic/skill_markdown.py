"""
skill_markdown.py  (v4)
========================
Converts a clinical skill's `body` dict to/from a doctor-editable Markdown
document.

WHAT CHANGED FROM v3
---------------------
v3 fixed: new fields via headings, dash-free flat records, hidden-field
reattachment, and (via the router's no-merge design) duplicate headings,
read-only metadata, and reliable deletion for FLAT records.

The one thing v3 still couldn't render was a list whose items are
THEMSELVES nested (e.g. `stage_wise_treatment[i].options[j].drugs`) --
those fell back to a raw ```json``` block. That's most of what makes a
treatment skill a treatment skill, so this was the actual blocker.

v4 replaces that JSON fallback with **"Entry N" subsections**:

    ## Stage Wise Treatment

    ### Entry 1

    Stage: Active disease
    Intent: Curative

    #### Options

    ##### Entry 1

    Regimen Name: Rituximab
    Drugs:
    - Rituximab
    - Cyclophosphamide

    ##### Entry 2

    Regimen Name: CHOP
    Drugs:
    - Cyclophosphamide
    - Doxorubicin

Rules for an Entry-rendered item:
  * scalar fields          -> "Label: value" line
  * scalar-list fields     -> "Label:" line + "- " bullets
  * anything else (nested) -> its own sub-heading, recursed
So doctors only ever see headings / "Label: value" / bullets -- never
raw JSON -- no matter how deep the nesting goes (up to heading level 6;
beyond that, headings stop increasing and levels 6+ collapse together,
which is a hard Markdown limit, not a v4 limitation. This has not been
seen in practice for this schema -- stage > options > drug-list is only
3 levels deep).

On parse, "Entry 1" / "Entry 2" / ... headings are a RESERVED pattern:
after the normal heading-tree parse, any dict whose keys are ALL
`entry_1`, `entry_2`, ... is collapsed into a plain list, in order, at
whatever depth it occurs (bottom-up, so nested Entries collapse first).
This is what lets "Options" be a real list of regimen dicts again after
a save, and it also means the single-item-list-vs-dict ambiguity that
flat records have (see finalize_saved_body) never applies to
Entry-rendered fields -- there's always an explicit "Entry 1" marker
even for a list of one, so it round-trips as a list unambiguously.

Only a list that mixes dicts with non-dicts (e.g. a list of dicts AND
strings together) still falls back to the raw ```json``` block -- this
should be rare/nonexistent in this schema. When it happens on save, a
human-readable warning is now returned (see save_skill_markdown in the
router) instead of failing silently.

FORMAT SPEC
-----------
* `# Skill Name`                        -- cosmetic title, ignored on parse
* One METADATA block, clearly fenced and READ-ONLY (never parsed back):
      <!-- METADATA - read-only, edits below this block are ignored -->
      <!-- skill_id: ... -->
      <!-- END METADATA -->
* `##` .. `######` headings ARE the nested-dict path. A heading's slug
  becomes the dict key -- a heading the parser has never seen before just
  becomes a new key, which is how new fields get added.
* Content directly under a heading (until the next heading of ANY level)
  is classified by shape:
      "- item"                          -> list[str]
      one paragraph of "Label: value"   -> dict[str, str]        (flat)
      2+ paragraphs of "Label: value",
        separated by a blank line       -> list[dict[str,str]]
      "### Entry 1" / "### Entry 2" ...  -> list[dict]  (nested records,
        subheadings, recursively -- reserved pattern, see above)
      free text                         -> str
      ```json ... ```                   -> anything (lossless escape hatch,
        now rare -- see above)
* `markdown_to_skill_body()` returns everything the document implies.
  `finalize_saved_body(new_body, old_body)` is then applied by the caller
  (see skill_markdown_router.py) to restore hidden fields and fix the
  single-item-list-vs-dict ambiguity (flat records only) before persisting.
"""
from __future__ import annotations

import json
import re
from typing import Any


# Fields that are provenance/system metadata rather than clinical content
# the doctor edits. Never rendered into markdown, never come back from a
# parse -- always re-attached from the previous body by finalize_saved_body.
HIDDEN_FIELDS = {"source_page", "source_pages"}

# Reserved heading pattern used to mark items of a nested (non-flat) list.
# See module docstring. Doctors should not name their own sections this.
_ENTRY_TITLE_RE = re.compile(r"^entry\s+(\d+)", re.I)
_ENTRY_KEY_RE = re.compile(r"^entry_(\d+)$")


# ── shape helpers ────────────────────────────────────────────────
def _is_scalar(v: Any) -> bool:
    return v is None or isinstance(v, (str, int, float, bool))


def _is_flat_dict(d: Any) -> bool:
    return isinstance(d, dict) and len(d) > 0 and all(_is_scalar(v) for v in d.values())


def _is_list_of_scalars(lst: Any) -> bool:
    return isinstance(lst, list) and len(lst) > 0 and all(_is_scalar(v) for v in lst)


def _is_list_of_flat_dicts(lst: Any) -> bool:
    return isinstance(lst, list) and len(lst) > 0 and all(_is_flat_dict(v) for v in lst)


def _is_list_of_dicts(lst: Any) -> bool:
    return isinstance(lst, list) and len(lst) > 0 and all(isinstance(v, dict) and v for v in lst)


def _title(key: str) -> str:
    return key.replace("_", " ").strip().title()


def _slug(text: str) -> str:
    s = re.sub(r"[^a-zA-Z0-9]+", "_", text.strip().lower())
    return s.strip("_") or "field"


def _empty(v: Any) -> bool:
    return v is None or v == "" or v == [] or v == {}


def _visible_items(d: dict):
    """dict items with hidden fields and empty values filtered out."""
    for k, v in d.items():
        if k.startswith("_") or k in HIDDEN_FIELDS or _empty(v):
            continue
        yield k, v


# ═════════════════════════════════════════════════════════════════
# GENERATOR: body dict -> markdown
# ═════════════════════════════════════════════════════════════════
def skill_body_to_markdown(body: dict, meta: dict | None = None) -> str:
    meta = meta or {}
    lines: list[str] = []

    lines.append(f"# {meta.get('name') or 'Clinical Skill'}")
    lines.append("")
    lines.append("<!-- METADATA - read-only, edits below this block are ignored -->")
    for k in ("skill_id", "skill_type", "disease_type", "subtype", "skill_index"):
        if not _empty(meta.get(k)):
            lines.append(f"<!-- {k}: {meta[k]} -->")
    lines.append("<!-- END METADATA -->")
    lines.append("")

    def render_record(item: dict, level: int):
        """One item of an Entry-rendered nested list: scalars/scalar-lists
        inline, anything else gets its own sub-heading. Never emits JSON."""
        wrote_inline = False
        for k, v in _visible_items(item):
            if _is_scalar(v):
                lines.append(f"{_title(k)}: {v}")
                wrote_inline = True
            elif _is_list_of_scalars(v):
                lines.append(f"{_title(k)}:")
                for x in v:
                    lines.append(f"- {x}")
                wrote_inline = True
        if wrote_inline:
            lines.append("")
        for k, v in _visible_items(item):
            if _is_scalar(v) or _is_list_of_scalars(v):
                continue
            lines.append(f"{'#' * min(level, 6)} {_title(k)}")
            lines.append("")
            render(v, level + 1)

    def render_leaf(value: Any, level: int):
        if isinstance(value, dict):  # flat dict, single item
            for k, v in _visible_items(value):
                lines.append(f"{_title(k)}: {v}")

        elif _is_list_of_flat_dicts(value):
            for i, item in enumerate(value):
                if i > 0:
                    lines.append("")  # blank line = new item, no other marker
                for k, v in _visible_items(item):
                    lines.append(f"{_title(k)}: {v}")

        elif _is_list_of_scalars(value):
            for item in value:
                lines.append(f"- {item}")

        elif _is_list_of_dicts(value):
            # Nested (non-flat) list of dicts -> Entry N subsections instead
            # of raw JSON. This is the v4 fix (was the JSON-dump branch).
            for i, item in enumerate(value, 1):
                lines.append(f"{'#' * min(level, 6)} Entry {i}")
                lines.append("")
                render_record(item, level + 1)
            return  # render_record already leaves trailing blank lines

        elif isinstance(value, list):  # genuinely mixed list -> lossless fallback
            lines.append("```json")
            lines.append(json.dumps(value, indent=2, ensure_ascii=False))
            lines.append("```")

        else:
            lines.append(str(value))
        lines.append("")

    def render(value: Any, level: int):
        if isinstance(value, dict) and not _is_flat_dict(value):
            heading_marks = "#" * min(level, 6)
            for k, v in _visible_items(value):
                lines.append(f"{heading_marks} {_title(k)}")
                lines.append("")
                render(v, level + 1)
            return
        render_leaf(value, level)

    for k, v in _visible_items(body):
        lines.append(f"## {_title(k)}")
        lines.append("")
        render(v, 3)

    return "\n".join(lines).rstrip() + "\n"


# ═════════════════════════════════════════════════════════════════
# PARSER: markdown -> body dict
# ═════════════════════════════════════════════════════════════════
_META_BLOCK_RE = re.compile(r"<!--\s*METADATA.*?END METADATA\s*-->", re.S | re.I)
_TITLE_LINE_RE = re.compile(r"^#\s+.*$", re.M)
_HEADING_RE = re.compile(r"^(#{2,6})\s*(.*)$")

_LABEL = r"[A-Z][A-Za-z0-9 /&\-]{0,40}"
_FLAT_KV_RE = re.compile(rf"^({_LABEL}):\s+(.*)$")
_LABEL_ONLY_RE = re.compile(rf"^({_LABEL}):\s*$")
_BULLET_RE = re.compile(r"^-\s+(.*)$")


def _parse_record_lines(lines: list[str]):
    """Parse one run of lines (no blank lines inside) as a single record
    where each field is either:
      'Label: value'                      -> scalar
      'Label:' + following '- ' bullets   -> list[str]
    Returns a dict, or None if any line doesn't fit -- this is what lets
    an Entry-rendered item mix plain fields (Stage, Intent) with a list
    field (Drugs) in the same block."""
    record: dict = {}
    i, n = 0, len(lines)
    while i < n:
        line = lines[i]
        m_kv = _FLAT_KV_RE.match(line)
        if m_kv:
            record[_slug(m_kv.group(1))] = m_kv.group(2).strip()
            i += 1
            continue
        m_label = _LABEL_ONLY_RE.match(line)
        if m_label:
            items = []
            j = i + 1
            while j < n and _BULLET_RE.match(lines[j]):
                items.append(_BULLET_RE.match(lines[j]).group(1).strip())
                j += 1
            if not items:
                return None
            record[_slug(m_label.group(1))] = items
            i = j
            continue
        return None
    return record if record else None


def _split_paragraphs(raw_lines: list[str]) -> list[list[str]]:
    paragraphs: list[list[str]] = []
    current: list[str] = []
    for line in raw_lines:
        if line.strip() == "":
            if current:
                paragraphs.append(current)
                current = []
        else:
            current.append(line)
    if current:
        paragraphs.append(current)
    return paragraphs


def _parse_content_block(raw_lines: list[str], warnings: list[str] | None = None, path: str = ""):
    while raw_lines and not raw_lines[0].strip():
        raw_lines.pop(0)
    while raw_lines and not raw_lines[-1].strip():
        raw_lines.pop()
    if not raw_lines:
        return None

    # Lossless fenced-JSON escape hatch
    if raw_lines[0].strip().startswith("```"):
        body_lines = []
        for l in raw_lines[1:]:
            if l.strip().startswith("```"):
                break
            body_lines.append(l)
        try:
            return json.loads("\n".join(body_lines))
        except json.JSONDecodeError:
            if warnings is not None:
                where = f" under '{path}'" if path else ""
                warnings.append(
                    f"A JSON block{where} could not be parsed and was kept as "
                    f"plain text so nothing was lost -- please check its "
                    f"formatting (brackets/commas)."
                )
            return "\n".join(raw_lines)  # broken JSON -- keep raw, lose nothing silently

    paragraphs = _split_paragraphs(raw_lines)
    all_lines = [l for p in paragraphs for l in p]

    # list[str] -- blank lines between bullets are just breathing room
    if all(_BULLET_RE.match(l) for l in all_lines):
        return [_BULLET_RE.match(l).group(1).strip() for l in all_lines]

    # every paragraph parses as one record ('Label: value' scalars, and/or
    # 'Label:' + bullets for list fields) -> one dict per paragraph. A
    # single paragraph collapses to a bare dict here; if the field used to
    # be a list, finalize_saved_body() re-wraps it below.
    records = [_parse_record_lines(p) for p in paragraphs]
    if all(r is not None for r in records):
        return records[0] if len(records) == 1 else records

    # prose -- preserve internal blank lines / paragraph breaks
    return "\n".join(raw_lines).strip()


def markdown_to_skill_body(md_text: str, warnings: list[str] | None = None) -> dict:
    md_text = _META_BLOCK_RE.sub("", md_text)
    md_text = _TITLE_LINE_RE.sub("", md_text, count=1)

    body: dict = {}
    stack: list[tuple[int, dict, str]] = [(1, body, "")]
    buffer: list[str] = []
    buffer_target: tuple[dict, dict, str, str] | None = None

    def flush():
        if buffer_target is None:
            return
        node, parent, key, path = buffer_target
        parsed = _parse_content_block(list(buffer), warnings, path)
        if _empty(parsed):
            return
        if isinstance(parsed, dict):
            # Merge in place: a heading can have BOTH inline fields (Stage,
            # Intent) AND child subheadings (Options) below it. `node` is
            # already the dict that any child headings pushed onto the
            # stack and wrote into -- overwriting it here (as opposed to
            # updating it) would silently orphan whatever the children
            # already wrote, which is exactly Issue 2/9 in a new form.
            node.update(parsed)
        elif not node:
            # Heading resolved to a list/string leaf with no children --
            # safe to replace the placeholder dict entirely.
            parent[key] = parsed
        # else: content didn't fit the dict grammar AND the heading already
        # has children -- keep the children, don't discard them.

    for line in md_text.split("\n"):
        m = _HEADING_RE.match(line)
        if not m:
            buffer.append(line)
            continue

        flush()
        buffer = []

        level = len(m.group(1))
        title = m.group(2).strip()

        # Reserved "Entry N" marker: force a stable entry_N key regardless
        # of any descriptive suffix the renderer or a doctor appends
        # (e.g. "Entry 1: Active Disease" still slugs to "entry_1").
        entry_m = _ENTRY_TITLE_RE.match(title)
        key = f"entry_{entry_m.group(1)}" if entry_m else _slug(title)

        while stack and stack[-1][0] >= level:
            stack.pop()
        if not stack:
            stack = [(1, body, "")]

        parent = stack[-1][1]
        parent_path = stack[-1][2]
        node: dict = {}
        parent[key] = node
        path = f"{parent_path}.{key}" if parent_path else key
        stack.append((level, node, path))
        buffer_target = (node, parent, key, path)

    flush()

    def collapse_entries(node: Any) -> Any:
        """Bottom-up: any dict whose keys are ALL entry_1, entry_2, ...
        becomes a plain list in order. See module docstring."""
        if isinstance(node, dict):
            collapsed = {k: collapse_entries(v) for k, v in node.items()}
            keys = list(collapsed.keys())
            if keys and all(_ENTRY_KEY_RE.match(k) for k in keys):
                ordered = sorted(keys, key=lambda k: int(_ENTRY_KEY_RE.match(k).group(1)))
                return [collapsed[k] for k in ordered]
            return collapsed
        if isinstance(node, list):
            return [collapse_entries(v) for v in node]
        return node

    def prune(d: Any) -> Any:
        if isinstance(d, dict):
            for k in list(d.keys()):
                v = prune(d[k])
                if v == {} or v is None:
                    del d[k]
                else:
                    d[k] = v
            return d
        if isinstance(d, list):
            return [prune(v) for v in d if not (isinstance(v, dict) and v == {})]
        return d

    return prune(collapse_entries(body))


# ═════════════════════════════════════════════════════════════════
# RECONCILIATION: fill in what the markdown could never have said
# ═════════════════════════════════════════════════════════════════
def finalize_saved_body(new_body: dict, old_body: dict) -> dict:
    """
    Reconciles a freshly-parsed markdown body against the previously saved
    body before persisting. Two things need this, and both come from the
    same cause: some information is intentionally invisible in the
    doctor-facing markdown, so a pure parse can never fully reconstruct it.

    1. HIDDEN_FIELDS (e.g. `source_page`) are re-attached from the old
       body at the matching structural position -- they can never appear
       in what the doctor typed, so they must come from somewhere. This
       recurses into list items too, so hidden fields nested inside
       Entry-rendered records (e.g. a regimen's source_page) come back.

    2. A list with exactly one item now renders identically to a bare
       flat dict (nothing marks "one item of a list" vs "a single
       object" once the dash convention is gone) -- but ONLY for flat
       records. Entry-rendered (nested) lists always carry an explicit
       "Entry 1" marker even for a single item, so they parse back as a
       list already and never hit this ambiguity. So: wherever the old
       value at a path was a list, and the freshly parsed value is a
       bare dict, it gets re-wrapped as a one-item list. Lists with 2+
       items are never ambiguous (the blank line between paragraphs is
       unambiguous) and pass through untouched.

    Fields with no counterpart in old_body (new fields the doctor typed)
    are left exactly as parsed -- there's no prior schema to check against.
    """
    def walk(new_v: Any, old_v: Any) -> Any:
        if isinstance(old_v, list) and _is_list_of_flat_dicts(old_v) \
                and isinstance(new_v, dict) and _is_flat_dict(new_v):
            new_v = [new_v]

        if isinstance(new_v, list) and isinstance(old_v, list):
            return [
                walk(item, old_v[i]) if i < len(old_v) else item
                for i, item in enumerate(new_v)
            ]

        if isinstance(new_v, dict) and isinstance(old_v, dict):
            for k, v in old_v.items():
                if k in HIDDEN_FIELDS and k not in new_v:
                    new_v[k] = v
            for k in list(new_v.keys()):
                if k in old_v:
                    new_v[k] = walk(new_v[k], old_v[k])
            return new_v

        return new_v

    return walk(new_body, old_body)