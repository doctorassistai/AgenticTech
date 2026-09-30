// shared/reportMarkdown.js — reading the report text of a completed investigation.
//
// `report` (the document's `parameterwise_markdown`, else `raw_markdown`) is
// markdown: `###` headings, `-` bullets, `|` tables, two-space hard breaks and
// `-----` page rules. Dropped into a table cell as plain text, every newline
// collapses and the `###` markers show through — which is what the Report column
// was doing.
//
// This app carries no markdown dependency, so the subset those reports actually
// use is parsed here into blocks that ReportDialog renders, and the same parse
// produces the one-line cell preview. Pure functions: no fetch, no state.

const HARD_RULE = /^\s*[-=_]{3,}\s*$/;
const HEADING = /^\s*(#{1,6})\s+(.*)$/;
const BULLET = /^\s*[-*•]\s+(.*)$/;

const stripEmphasis = (text) => String(text || "")
  .replace(/\*\*(.+?)\*\*/g, "$1")
  .replace(/`/g, "")
  .trim();

const isTableLine = (line) => line.split("|").length > 2;

// A `|---|---|` alignment row carries no content.
const isTableDivider = (line) => /^[\s|:-]+$/.test(line) && line.includes("-");

const splitRow = (line) => {
  const cells = line.split("|").map(stripEmphasis);
  while (cells.length && cells[0] === "") cells.shift();
  while (cells.length && cells[cells.length - 1] === "") cells.pop();
  return cells;
};

/**
 * Parse report markdown into render-ready blocks.
 * @returns {Array<{type: "heading"|"paragraph"|"list"|"table"|"rule", ...}>}
 *   heading: { level, text } · paragraph: { lines } · list: { items }
 *   table: { head, rows } · rule: {}
 *
 * Paragraphs keep their internal line breaks: in these reports a single newline
 * is meaningful ("Patient Name: …", "Age/Gender: …" are separate lines).
 */
export function parseReportMarkdown(text) {
  const lines = String(text || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let list = [];
  let table = [];

  const flushParagraph = () => {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", lines: paragraph });
      paragraph = [];
    }
  };
  const flushList = () => {
    if (list.length) {
      blocks.push({ type: "list", items: list });
      list = [];
    }
  };
  const flushTable = () => {
    if (!table.length) return;
    if (table.length === 1) {
      // One pipe line on its own is prose that happens to contain a pipe.
      paragraph.push(table[0].join(" | "));
    } else {
      blocks.push({ type: "table", head: table[0], rows: table.slice(1) });
    }
    table = [];
  };
  const flushAll = () => { flushTable(); flushList(); flushParagraph(); };

  lines.forEach((raw) => {
    const line = raw.trim();

    if (!line) { flushAll(); return; }

    if (HARD_RULE.test(line)) {
      flushAll();
      blocks.push({ type: "rule" });
      return;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      flushAll();
      blocks.push({ type: "heading", level: heading[1].length, text: stripEmphasis(heading[2]) });
      return;
    }

    if (isTableLine(line)) {
      flushList();
      flushParagraph();
      if (!isTableDivider(line)) table.push(splitRow(line));
      return;
    }
    flushTable();

    const bullet = BULLET.exec(line);
    if (bullet) {
      flushParagraph();
      list.push(stripEmphasis(bullet[1]));
      return;
    }
    flushList();

    paragraph.push(stripEmphasis(line));
  });

  flushAll();
  return blocks;
}

/**
 * One-line preview for a table cell, built from the same parse so the cell and
 * the dialog never disagree about what the report says.
 */
export function reportPreview(text, limit = 180) {
  const parts = [];
  parseReportMarkdown(text).forEach((block) => {
    if (block.type === "heading") parts.push(block.text);
    else if (block.type === "paragraph") parts.push(block.lines.join(" "));
    else if (block.type === "list") parts.push(block.items.join("; "));
    else if (block.type === "table") {
      parts.push([block.head, ...block.rows].map((row) => row.join(" ")).join("; "));
    }
  });
  const flat = parts.filter(Boolean).join(" · ").replace(/\s+/g, " ").trim();
  return flat.length > limit ? `${flat.slice(0, limit).trimEnd()}…` : flat;
}
