import React, { useState, useEffect, useRef, useCallback } from "react";

/* ════════════════════════════════════════════════════════════════════
   EditableSectionText
   ────────────────────────────────────────────────────────────────────
   Drop-in replacement for the plain <AutosizeTextarea> used in EDIT mode
   inside TriggerConclusionEditor (Dashboard.jsx). Splits the section's
   raw text into alternating "text" and "table" blocks, renders text
   blocks as editable textareas (unchanged behaviour) and table blocks as
   a real editable grid (add/remove row, edit cells) — matching the same
   pipe-table markdown shape unified_report_agent.py generates:

       | Item | Amount |
       |---|---|
       | NAME | 123.45 |

   On every edit, blocks are re-serialized back into ONE plain string in
   that exact format, so nothing downstream (save-fields, generate-pdf,
   the read-mode MarkdownTableBlock renderer, conclusion_formatter.py)
   needs to change — the stored string shape is identical to today's.

   USAGE (inside TriggerConclusionEditor, replacing the section3/edit
   branch's <AutosizeTextarea>):

     import EditableSectionText from "./EditableSectionText";

     ...
     ) : (
       <EditableSectionText
         value={triggerData.sections[sKey] || ""}
         onChange={v => updateSection(sKey, v)}
         minRows={sKey === "section1" ? 8 : sKey === "section2" ? 5 : 6}
         accentColor={cfg.bar}
       />
     )}
   ════════════════════════════════════════════════════════════════════ */

/* ─── Markdown pipe-table detection — mirrors groupMarkdownTables /
   MD_TABLE_ROW_RE / MD_TABLE_SEP_RE already used in Dashboard.jsx's
   read-mode renderer, so a table this component builds is guaranteed to
   still render correctly in Preview mode. ─────────────────────────── */
const MD_TABLE_ROW_RE = /^\|(.+)\|$/;
const MD_TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;

function isTableRowLine(line) {
  return /^\s*\|.*\|\s*$/.test(line.trim());
}

function parseRow(line) {
  const m = line.trim().match(MD_TABLE_ROW_RE);
  const inner = m ? m[1] : line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}

function escapePipe(s) {
  return String(s ?? "").replace(/\|/g, "\\|");
}

let _idCounter = 0;
function nextBlockId() {
  _idCounter += 1;
  return `blk_${_idCounter}`;
}

/** Splits raw section text into alternating text/table blocks. Every
 *  character outside a detected table is preserved verbatim, so
 *  serializeBlocks(parseTextIntoBlocks(x)) === x for any text with no
 *  edits applied. */
export function parseTextIntoBlocks(text) {
  const lines = (text || "").split("\n");
  const blocks = [];
  let textBuf = [];

  const flushText = () => {
    if (textBuf.length > 0) {
      blocks.push({ type: "text", id: nextBlockId(), content: textBuf.join("\n") });
      textBuf = [];
    }
  };

  let i = 0;
  while (i < lines.length) {
    if (
      isTableRowLine(lines[i]) &&
      i + 1 < lines.length &&
      MD_TABLE_SEP_RE.test(lines[i + 1].trim())
    ) {
      flushText();
      const header = parseRow(lines[i]);
      i += 2; // skip header + separator rows
      const rows = [];
      while (i < lines.length && isTableRowLine(lines[i])) {
        rows.push(parseRow(lines[i]));
        i++;
      }
      blocks.push({ type: "table", id: nextBlockId(), header, rows });
    } else {
      textBuf.push(lines[i]);
      i++;
    }
  }
  flushText();
  if (blocks.length === 0) blocks.push({ type: "text", id: nextBlockId(), content: "" });
  return blocks;
}

/** Reassembles blocks back into the single plain-text string the rest of
 *  the app expects, in the exact markdown-table format used elsewhere. */
export function serializeBlocks(blocks) {
  return blocks
    .map((b) => {
      if (b.type === "text") return b.content;
      const headerRow = `| ${b.header.map(escapePipe).join(" | ")} |`;
      const sepRow = `|${b.header.map(() => "---").join("|")}|`;
      const dataRows = b.rows.map((r) => `| ${r.map(escapePipe).join(" | ")} |`);
      return [headerRow, sepRow, ...dataRows].join("\n");
    })
    .join("\n");
}

/* ─── Minimal self-contained autosize textarea (mirrors Dashboard.jsx's
   AutosizeTextarea so this file has no dependency on the parent file). ── */
function AutoTextarea({ value, onChange, style, minRows = 3, ...rest }) {
  const ref = useRef(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => { resize(); }, [value, resize]);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => resize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [resize]);
  return (
    <textarea
      ref={ref}
      value={value}
      onChange={onChange}
      rows={minRows}
      style={{ ...style, overflow: "hidden", resize: "none" }}
      {...rest}
    />
  );
}

const cellInputStyle = {
  width: "100%",
  padding: "5px 7px",
  border: "1px solid var(--border)",
  borderRadius: 4,
  fontSize: 11.5,
  fontFamily: "inherit",
  color: "var(--text)",
  background: "var(--bg)",
  outline: "none",
  boxSizing: "border-box",
};

/* ─── Editable grid for ONE detected table block. Assumes the last
   column is numeric (true for every table this pipeline currently
   generates — "Item | Amount") and shows a running total when it is;
   otherwise still works fine as a plain N-column editable grid. ─────── */
function EditableTableBlock({ block, onChange }) {
  const { header, rows } = block;
  const lastColIdx = header.length - 1;

  const updateCell = (rowIdx, colIdx, val) => {
    const nextRows = rows.map((r, ri) =>
      ri === rowIdx ? r.map((c, ci) => (ci === colIdx ? val : c)) : r
    );
    onChange({ ...block, rows: nextRows });
  };

  const addRow = () => onChange({ ...block, rows: [...rows, header.map(() => "")] });
  const removeRow = (rowIdx) => onChange({ ...block, rows: rows.filter((_, ri) => ri !== rowIdx) });

  const numericValues = rows
    .map((r) => parseFloat(String(r[lastColIdx] ?? "").replace(/,/g, "")))
    .filter((n) => !isNaN(n));
  const showTotal = numericValues.length > 0;
  const total = numericValues.reduce((s, n) => s + n, 0);

  const gridCols = `repeat(${Math.max(header.length - 1, 1)}, 1fr) 130px 34px`;

  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{
          display: "grid", gridTemplateColumns: gridCols,
          background: "var(--bg3, #fafafa)", borderBottom: "1px solid var(--border)",
        }}>
          {header.map((h, hi) => (
            <div key={hi} style={{
              padding: "6px 8px", fontSize: 10, color: "var(--muted)",
              textTransform: "uppercase", letterSpacing: "0.06em",
            }}>
              {h}
            </div>
          ))}
          <div />
        </div>

        {rows.length === 0 && (
          <div style={{ padding: "14px 8px", fontSize: 11, color: "var(--muted)", textAlign: "center" }}>
            No rows yet.
          </div>
        )}

        {rows.map((row, ri) => (
          <div key={ri} style={{
            display: "grid", gridTemplateColumns: gridCols,
            borderBottom: ri === rows.length - 1 ? "none" : "1px solid var(--bg3, #fafafa)",
            alignItems: "center",
          }}>
            {row.map((cell, ci) => (
              <div key={ci} style={{ padding: "5px 8px" }}>
                <input
                  value={cell}
                  onChange={(e) => updateCell(ri, ci, e.target.value)}
                  style={{ ...cellInputStyle, textAlign: ci === lastColIdx ? "right" : "left" }}
                />
              </div>
            ))}
            <button
              onClick={() => removeRow(ri)}
              title="Remove row"
              style={{
                background: "none", border: "none", cursor: "pointer",
                color: "var(--muted)", fontSize: 13, padding: "5px 8px",
                display: "flex", alignItems: "center", justifyContent: "center",
              }}
            >
              ✕
            </button>
          </div>
        ))}

        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "8px 10px", background: "var(--bg3, #fafafa)", borderTop: "1px solid var(--border)",
        }}>
          <button
            onClick={addRow}
            style={{
              padding: "5px 12px", border: "1px solid var(--border)",
              background: "var(--bg)", color: "var(--text)", fontFamily: "inherit",
              fontSize: 11, cursor: "pointer", borderRadius: 4,
            }}
          >
            + Add row
          </button>
          {showTotal && (
            <div style={{ fontSize: 11.5, color: "var(--text)" }}>
              Total:&nbsp;
              <strong>
                {total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Main exported component ──────────────────────────────────────── */
export default function EditableSectionText({
  value,
  onChange,
  minRows = 6,
  accentColor = "var(--accent)",
  textareaStyle,
}) {
  const [blocks, setBlocks] = useState(() => parseTextIntoBlocks(value));
  const lastSerialized = useRef(value);

  // If the parent's value changes from OUTSIDE this component (fresh AI
  // generation, switching triggers, undo, etc.), re-parse from scratch.
  // Otherwise we keep local block state so typing doesn't get clobbered.
  useEffect(() => {
    if (value !== lastSerialized.current) {
      setBlocks(parseTextIntoBlocks(value));
      lastSerialized.current = value;
    }
  }, [value]);

  const commit = useCallback(
    (nextBlocks) => {
      setBlocks(nextBlocks);
      const serialized = serializeBlocks(nextBlocks);
      lastSerialized.current = serialized;
      onChange(serialized);
    },
    [onChange]
  );

  const updateBlock = (id, updater) => {
    commit(blocks.map((b) => (b.id === id ? updater(b) : b)));
  };

  const defaultTextareaStyle = {
    width: "100%", padding: "8px 10px",
    border: "1px solid var(--border)", borderRadius: 4,
    fontSize: 11.5, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    color: "var(--text)", background: "var(--bg)",
    outline: "none", lineHeight: 1.7, boxSizing: "border-box",
    whiteSpace: "pre-wrap", overflowWrap: "anywhere", wordBreak: "break-word",
    ...textareaStyle,
  };

  return (
    <div>
      {blocks.map((b) =>
        b.type === "table" ? (
          <EditableTableBlock
            key={b.id}
            block={b}
            onChange={(updated) => updateBlock(b.id, () => updated)}
          />
        ) : (
          <AutoTextarea
            key={b.id}
            minRows={minRows}
            value={b.content}
            onChange={(e) => updateBlock(b.id, (blk) => ({ ...blk, content: e.target.value }))}
            spellCheck={false}
            style={defaultTextareaStyle}
            onFocus={(e) => { e.target.style.borderColor = accentColor; }}
            onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
          />
        )
      )}
    </div>
  );
}