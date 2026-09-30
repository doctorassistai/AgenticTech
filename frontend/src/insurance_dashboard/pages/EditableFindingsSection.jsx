import React, { useState, useEffect, useRef, useCallback } from "react";

/* ════════════════════════════════════════════════════════════════════
   EditableFindingsSection
   ────────────────────────────────────────────────────────────────────
   Fully inline-editable replacement for BOTH Section1EpisodeView (read
   mode) and the raw AutosizeTextarea (edit mode) in Dashboard.jsx. There
   is no toggle — this IS the view, always editable.

   Renders:
     - structured=true  (Section 1): episode cards with editable header
       fields (hospital / admission / discharge / outcome) + editable
       body, plus "<Label> — Hospital/Member Assessment" trigger cards.
     - structured=false (Section 2 / 3): just the editable body, no
       card headers — matches how those sections have no episode
       structure today.

   Body content (shared by both modes) is decomposed into:
     - bullet lines            → single-line editable text row
     - consecutive "medicine"  → wrapped, editable chip row
       lines (matches MEDICINE_LINE_RE, e.g. lines ending ", Inj.")
     - markdown pipe tables    → real editable grid (add/remove row)

   On every edit the whole section is re-serialized back into ONE plain
   string in the same format your backend (unified_report_agent.py) and
   parser (Dashboard.jsx's parseSection1IntoCards / EPISODE_HEADER_RE /
   TRIGGER_ASSESSMENT_HEADER_RE / MEDICINE_LINE_RE) already expect — so
   save-fields, generate-pdf, and re-loading the case all keep working
   unchanged.

   USAGE (replaces the readMode ternary in TriggerConclusionEditor):

     import EditableFindingsSection from "./EditableFindingsSection";

     <EditableFindingsSection
       text={triggerData.sections[sKey] || ""}
       onChange={v => updateSection(sKey, v)}
       structured={sKey === "section1"}
       accentColor={cfg.bar}
       onOpenSource={onOpenSource}
     />
   ════════════════════════════════════════════════════════════════════ */

/* ─── Shared regexes — mirror Dashboard.jsx exactly so parsing/round-trip
   stays compatible with the existing read-mode renderer and backend. ── */
const EPISODE_HEADER_RE = /^Episode\s+(\d+)\s+of\s+(\d+)\s*[—-]\s*(.+?)\s*\((.+?)\s+to\s+(.+?),\s*outcome:\s*([\w_]+)\)\s*$/;
const TRIGGER_ASSESSMENT_HEADER_RE = /^(.+?)\s*[—-]\s*(Hospital|Member)\s+Assessment\s*$/;
const MEDICINE_LINE_RE = /,\s*(Inj|Syp|Tab|Cap|IVF|Susp|Oint|Gel|Drops|Amp|Sol)\.?\s*$/i;
const MD_TABLE_ROW_RE = /^\|(.+)\|$/;
const MD_TABLE_SEP_RE = /^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?$/;
const SOURCE_CITATION_RE = /\(Source:\s*([^)]+)\)/;

function stripBulletPrefix(line) {
  return line.replace(/^[\s]*[•\-\*]\s*/, "");
}
function isTableRowLine(line) {
  return /^\s*\|.*\|\s*$/.test(line.trim());
}
function parseTableRow(line) {
  const m = line.trim().match(MD_TABLE_ROW_RE);
  const inner = m ? m[1] : line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return inner.split("|").map((c) => c.trim());
}
function escapePipe(s) {
  return String(s ?? "").replace(/\|/g, "\\|");
}

let _idCounter = 0;
function nextId(prefix) {
  _idCounter += 1;
  return `${prefix}_${_idCounter}`;
}

/* ─── Body parsing: raw text → ordered elements (line | table) ───────── */
function parseBodyIntoElements(text) {
  const lines = (text || "").split("\n");
  const elements = [];
  let i = 0;
  while (i < lines.length) {
    if (
      isTableRowLine(lines[i]) &&
      i + 1 < lines.length &&
      MD_TABLE_SEP_RE.test(lines[i + 1].trim())
    ) {
      const header = parseTableRow(lines[i]);
      i += 2;
      const rows = [];
      while (i < lines.length && isTableRowLine(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i++;
      }
      elements.push({ type: "table", id: nextId("tbl"), header, rows });
      continue;
    }
    const raw = lines[i];
    const stripped = stripBulletPrefix(raw).trim();
    if (stripped.length > 0) {
      elements.push({ type: "line", id: nextId("ln"), text: stripped });
    }
    i++;
  }
  return elements;
}

/* ─── Body serialization: elements → raw text ────────────────────────── */
function serializeBodyElements(elements) {
  return elements
    .map((el) => {
      if (el.type === "table") {
        const headerRow = `| ${el.header.map(escapePipe).join(" | ")} |`;
        const sepRow = `|${el.header.map(() => "---").join("|")}|`;
        const dataRows = el.rows.map((r) => `| ${r.map(escapePipe).join(" | ")} |`);
        return [headerRow, sepRow, ...dataRows].join("\n");
      }
      return `• ${el.text}`;
    })
    .join("\n");
}

/* ─── Root section parsing (structured=true only): intro + ordered cards ── */
function parseStructuredSection(text) {
  const lines = (text || "").split("\n");
  const cards = [];
  const introLines = [];
  let currentBodyLines = null;
  let currentCard = null;

  const flush = () => {
    if (!currentCard) return;
    currentCard.bodyText = currentBodyLines.join("\n");
    cards.push(currentCard);
    currentCard = null;
    currentBodyLines = null;
  };

  for (const rawLine of lines) {
    const strippedLine = stripBulletPrefix(rawLine).trim();
    const epMatch = strippedLine.match(EPISODE_HEADER_RE);
    const trigMatch = !epMatch && strippedLine.match(TRIGGER_ASSESSMENT_HEADER_RE);

    if (epMatch) {
      flush();
      currentCard = {
        id: nextId("card"),
        kind: "episode",
        header: {
          index: epMatch[1],
          total: epMatch[2],
          hospital: epMatch[3].trim(),
          admission: epMatch[4].trim(),
          discharge: epMatch[5].trim(),
          outcome: epMatch[6].trim(),
        },
      };
      currentBodyLines = [];
    } else if (trigMatch) {
      flush();
      currentCard = {
        id: nextId("card"),
        kind: "trigger",
        header: { label: trigMatch[1].trim(), side: trigMatch[2] },
      };
      currentBodyLines = [];
    } else if (currentCard) {
      currentBodyLines.push(rawLine);
    } else {
      introLines.push(rawLine);
    }
  }
  flush();

  return {
    introElements: parseBodyIntoElements(introLines.join("\n")),
    cards: cards.map((c) => ({ ...c, bodyElements: parseBodyIntoElements(c.bodyText) })),
  };
}

function serializeStructuredSection(introElements, cards) {
  const parts = [];
  const introText = serializeBodyElements(introElements);
  if (introText.trim()) parts.push(introText);

  for (const card of cards) {
    let headerLine;
    if (card.kind === "episode") {
      const h = card.header;
      headerLine = `Episode ${h.index} of ${h.total} — ${h.hospital} (${h.admission} to ${h.discharge}, outcome: ${h.outcome})`;
    } else {
      headerLine = `${card.header.label} — ${card.header.side} Assessment`;
    }
    const bodyText = serializeBodyElements(card.bodyElements);
    parts.push(`${headerLine}\n${bodyText}`);
  }
  return parts.join("\n\n");
}

/* ─── Outcome badge colors (mirrors Dashboard.jsx's OUTCOME_COLORS) ──── */
const OUTCOME_COLORS = {
  discharged: { bg: "#dcfce7", fg: "#15803d" },
  deceased: { bg: "#fee2e2", fg: "#b91c1c" },
  death: { bg: "#fee2e2", fg: "#b91c1c" },
  expired: { bg: "#fee2e2", fg: "#b91c1c" },
  lama: { bg: "#fef3c7", fg: "#b45309" },
  dama: { bg: "#fef3c7", fg: "#b45309" },
  discharged_at_request: { bg: "#fef3c7", fg: "#b45309" },
  referred: { bg: "#dbeafe", fg: "#1d4ed8" },
  transferred: { bg: "#dbeafe", fg: "#1d4ed8" },
};
function outcomeStyle(outcome) {
  const key = (outcome || "").toLowerCase();
  return OUTCOME_COLORS[key] || { bg: "#f1f5f9", fg: "#64748b" };
}

/* ─── Small shared input styles ───────────────────────────────────────── */
const inlineInputStyle = {
  border: "1px solid transparent",
  borderRadius: 4,
  background: "transparent",
  fontFamily: "inherit",
  outline: "none",
  padding: "2px 5px",
};
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

/* ─── Editable table block (bill / any markdown table) ────────────────── */
function EditableTableBlock({ element, onChange, onRemoveSelf }) {
  const { header, rows } = element;
  const lastColIdx = header.length - 1;

  const updateCell = (rowIdx, colIdx, val) => {
    const nextRows = rows.map((r, ri) =>
      ri === rowIdx ? r.map((c, ci) => (ci === colIdx ? val : c)) : r
    );
    onChange({ ...element, rows: nextRows });
  };
  const addRow = () => onChange({ ...element, rows: [...rows, header.map(() => "")] });
  const removeRow = (rowIdx) => onChange({ ...element, rows: rows.filter((_, ri) => ri !== rowIdx) });

  const numericValues = rows
    .map((r) => parseFloat(String(r[lastColIdx] ?? "").replace(/,/g, "")))
    .filter((n) => !isNaN(n));
  const showTotal = numericValues.length > 0;
  const total = numericValues.reduce((s, n) => s + n, 0);
  const gridCols = `repeat(${Math.max(header.length - 1, 1)}, 1fr) 130px 34px`;

  return (
    <div style={{ margin: "8px 0" }}>
      <div style={{ border: "1px solid var(--border)", borderRadius: 6, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: gridCols, background: "var(--bg3, #fafafa)", borderBottom: "1px solid var(--border)" }}>
          {header.map((h, hi) => (
            <div key={hi} style={{ padding: "6px 8px", fontSize: 10, color: "var(--muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{h}</div>
          ))}
          <div />
        </div>
        {rows.map((row, ri) => (
          <div key={ri} style={{ display: "grid", gridTemplateColumns: gridCols, borderBottom: ri === rows.length - 1 ? "none" : "1px solid var(--bg3, #fafafa)", alignItems: "center" }}>
            {row.map((cell, ci) => (
              <div key={ci} style={{ padding: "5px 8px" }}>
                <input value={cell} onChange={(e) => updateCell(ri, ci, e.target.value)} style={{ ...cellInputStyle, textAlign: ci === lastColIdx ? "right" : "left" }} />
              </div>
            ))}
            <button onClick={() => removeRow(ri)} title="Remove row" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 13, padding: "5px 8px" }}>✕</button>
          </div>
        ))}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "8px 10px", background: "var(--bg3, #fafafa)", borderTop: "1px solid var(--border)" }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={addRow} style={{ padding: "5px 12px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--text)", fontFamily: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 4 }}>+ Add row</button>
            {onRemoveSelf && (
              <button onClick={onRemoveSelf} style={{ padding: "5px 12px", border: "1px solid var(--border)", background: "var(--bg)", color: "var(--muted)", fontFamily: "inherit", fontSize: 11, cursor: "pointer", borderRadius: 4 }}>Remove table</button>
            )}
          </div>
          {showTotal && (
            <div style={{ fontSize: 11.5, color: "var(--text)" }}>
              Total:&nbsp;<strong>{total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Editable bullet line (single line, auto-growing) ────────────────── */
function EditableLine({ text, onChangeText, onRemove, onOpenSource, compact }) {
  const ref = useRef(null);
  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = `${el.scrollHeight}px`;
  }, []);
  useEffect(() => { resize(); }, [text, resize]);

  const citation = text.match(SOURCE_CITATION_RE);
  const openFirstSource = () => {
    if (!citation || !onOpenSource) return;
    const src = citation[1].split(";")[0].trim();
    const m = src.match(/^(.+?),\s*Page\s*(\d+)$/i);
    if (m) onOpenSource(m[1].trim(), parseInt(m[2], 10));
    else onOpenSource(src, null);
  };

  return (
    <div style={{ display: "flex", gap: 7, alignItems: "flex-start", padding: "2px 0" }}>
      <span style={{ color: "var(--border)", flexShrink: 0, marginTop: 6 }}>•</span>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => onChangeText(e.target.value)}
        rows={1}
        spellCheck={false}
        style={{
          ...inlineInputStyle,
          flex: 1,
          fontSize: 11.5,
          lineHeight: 1.7,
          color: "var(--text)",
          overflow: "hidden",
          resize: "none",
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
        }}
        onFocus={(e) => { e.target.style.borderColor = "var(--border)"; e.target.style.background = "var(--bg)"; }}
        onBlur={(e) => { e.target.style.borderColor = "transparent"; e.target.style.background = "transparent"; }}
      />
      {citation && onOpenSource && (
        <button
          type="button"
          onClick={openFirstSource}
          title="Open source document"
          style={{ flexShrink: 0, fontSize: 9, padding: "2px 6px", borderRadius: 99, border: "1px solid var(--border)", background: "var(--bg3, #fafafa)", color: "var(--blue)", cursor: "pointer", marginTop: 3 }}
        >
          📄
        </button>
      )}
      <button
        onClick={onRemove}
        title="Remove line"
        style={{ flexShrink: 0, background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12, padding: "3px 4px", marginTop: 2 }}
      >
        ✕
      </button>
    </div>
  );
}

/* ─── Editable medicine chip row ───────────────────────────────────────── */
function EditableMedsGroup({ lines, onChangeLine, onRemoveLine, onAddLine }) {
  return (
    <div style={{ margin: "6px 0 10px" }}>
      <div style={{ fontSize: 9.5, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 4 }}>
        Medications ({lines.length})
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
        {lines.map((el) => (
          <span key={el.id} style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "2px 4px 2px 9px", borderRadius: 5, background: "var(--bg3, #fafafa)", border: "1px solid var(--border)" }}>
            <input
              value={el.text}
              onChange={(e) => onChangeLine(el.id, e.target.value)}
              style={{
                ...inlineInputStyle, fontSize: 10.5, color: "var(--text)",
                width: `${Math.max(6, el.text.length)}ch`, minWidth: 60, maxWidth: 320,
              }}
            />
            <button onClick={() => onRemoveLine(el.id)} title="Remove" style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 11, padding: "2px 4px" }}>✕</button>
          </span>
        ))}
        <button
          onClick={onAddLine}
          style={{ fontSize: 10.5, padding: "3px 10px", borderRadius: 5, border: "1px dashed var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer", fontFamily: "inherit" }}
        >
          + medicine
        </button>
      </div>
    </div>
  );
}

/* ─── Body editor: groups line elements into meds runs at RENDER time
   (so editing a line in/out of the medicine pattern re-groups live),
   renders table elements as the editable grid. ───────────────────────── */
function EditableBody({ elements, onChange, onOpenSource }) {
  const updateElement = (id, updater) => {
    onChange(elements.map((el) => (el.id === id ? updater(el) : el)));
  };
  const removeElement = (id) => onChange(elements.filter((el) => el.id !== id));
  const addLineAfter = (id) => {
    const idx = elements.findIndex((el) => el.id === id);
    const newEl = { type: "line", id: nextId("ln"), text: "" };
    const next = [...elements];
    next.splice(idx + 1, 0, newEl);
    onChange(next);
  };
  const addLineAtEnd = () => onChange([...elements, { type: "line", id: nextId("ln"), text: "" }]);

  // Group consecutive medicine-pattern line elements for rendering only.
  const groups = [];
  let buffer = [];
  const flushBuffer = () => {
    if (buffer.length > 0) { groups.push({ kind: "meds", items: buffer }); buffer = []; }
  };
  elements.forEach((el) => {
    if (el.type === "table") { flushBuffer(); groups.push({ kind: "table", el }); return; }
    if (MEDICINE_LINE_RE.test(el.text.trim())) { buffer.push(el); return; }
    flushBuffer();
    groups.push({ kind: "line", el });
  });
  flushBuffer();

  return (
    <div>
      {elements.length === 0 && (
        <div style={{ fontSize: 11, color: "var(--muted)", fontStyle: "italic", marginBottom: 6 }}>No content — add a line below.</div>
      )}
      {groups.map((g, gi) => {
        if (g.kind === "table") {
          return (
            <EditableTableBlock
              key={g.el.id}
              element={g.el}
              onChange={(updated) => updateElement(g.el.id, () => updated)}
              onRemoveSelf={() => removeElement(g.el.id)}
            />
          );
        }
        if (g.kind === "meds") {
          return (
            <EditableMedsGroup
              key={`meds_${gi}`}
              lines={g.items}
              onChangeLine={(id, text) => updateElement(id, (el) => ({ ...el, text }))}
              onRemoveLine={removeElement}
              onAddLine={() => addLineAfter(g.items[g.items.length - 1].id)}
            />
          );
        }
        return (
          <EditableLine
            key={g.el.id}
            text={g.el.text}
            onChangeText={(text) => updateElement(g.el.id, (el) => ({ ...el, text }))}
            onRemove={() => removeElement(g.el.id)}
            onOpenSource={onOpenSource}
          />
        );
      })}
      <button
        onClick={addLineAtEnd}
        style={{ marginTop: 6, fontSize: 10.5, padding: "4px 10px", borderRadius: 5, border: "1px dashed var(--border)", background: "transparent", color: "var(--muted)", cursor: "pointer", fontFamily: "inherit" }}
      >
        + line
      </button>
    </div>
  );
}

/* ─── Episode card header (editable) ───────────────────────────────────── */
function EditableEpisodeHeader({ header, onChange }) {
  const os = outcomeStyle(header.outcome);
  const field = (key, value) => onChange({ ...header, [key]: value });

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "8px 12px", background: "color-mix(in srgb, var(--blue) 16%, var(--bg))", borderBottom: "1px solid var(--border)" }}>
      <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 8px", borderRadius: 99, background: "#1d4ed8", color: "#fff", flexShrink: 0, letterSpacing: "0.04em" }}>
        EP {header.index}/{header.total}
      </span>
      <input
        value={header.hospital}
        onChange={(e) => field("hospital", e.target.value)}
        placeholder="Hospital name"
        style={{ ...inlineInputStyle, fontSize: 12, fontWeight: 700, color: "#1e293b", flex: 1, minWidth: 120 }}
      />
      <input
        value={header.admission}
        onChange={(e) => field("admission", e.target.value)}
        placeholder="Admission"
        style={{ ...inlineInputStyle, fontSize: 10.5, color: "var(--muted)", width: 110, textAlign: "right" }}
      />
      <span style={{ fontSize: 10.5, color: "var(--muted)" }}>→</span>
      <input
        value={header.discharge}
        onChange={(e) => field("discharge", e.target.value)}
        placeholder="Discharge"
        style={{ ...inlineInputStyle, fontSize: 10.5, color: "var(--muted)", width: 110 }}
      />
      <input
        value={header.outcome}
        onChange={(e) => field("outcome", e.target.value)}
        placeholder="outcome"
        style={{
          ...inlineInputStyle, fontSize: 9.5, fontWeight: 700, textAlign: "center",
          background: os.bg, color: os.fg, borderRadius: 99, padding: "2px 9px",
          textTransform: "uppercase", letterSpacing: "0.05em", width: 120,
        }}
      />
    </div>
  );
}

/* ─── One episode or trigger-assessment card ───────────────────────────── */
function EditableCard({ card, onChange, onRemove, onOpenSource }) {
  const updateHeader = (h) => onChange({ ...card, header: h });
  const updateBody = (elements) => onChange({ ...card, bodyElements: elements });

  if (card.kind === "episode") {
    return (
      <div style={{ border: "1px solid var(--border)", borderRadius: 7, overflow: "hidden", marginBottom: 10 }}>
        <EditableEpisodeHeader header={card.header} onChange={updateHeader} />
        <div style={{ padding: "10px 12px", background: "var(--bg)" }}>
          <EditableBody elements={card.bodyElements} onChange={updateBody} onOpenSource={onOpenSource} />
        </div>
      </div>
    );
  }

  // trigger assessment card
  return (
    <div style={{ border: "1px solid var(--border-mid, var(--border))", borderRadius: 7, overflow: "hidden", marginBottom: 10 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 12px", background: "color-mix(in srgb, var(--purple) 10%, var(--bg))", borderBottom: "1px solid var(--border)" }}>
        <input
          value={card.header.label}
          onChange={(e) => updateHeader({ ...card.header, label: e.target.value })}
          style={{ ...inlineInputStyle, fontSize: 10.5, fontWeight: 600, color: "var(--purple)", textTransform: "uppercase", letterSpacing: "0.06em", flex: 1 }}
        />
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--purple)", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
          — {card.header.side} Assessment
        </span>
        {onRemove && (
          <button onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", fontSize: 12 }}>✕</button>
        )}
      </div>
      <div style={{ padding: "10px 12px", background: "var(--bg)" }}>
        <EditableBody elements={card.bodyElements} onChange={updateBody} onOpenSource={onOpenSource} />
      </div>
    </div>
  );
}

/* ─── Root exported component ──────────────────────────────────────────── */
export default function EditableFindingsSection({ text, onChange, structured = false, onOpenSource }) {
  const [parsed, setParsed] = useState(() =>
    structured
      ? parseStructuredSection(text)
      : { introElements: parseBodyIntoElements(text), cards: [] }
  );
  const lastSerialized = useRef(text);

  useEffect(() => {
    if (text !== lastSerialized.current) {
      const fresh = structured
        ? parseStructuredSection(text)
        : { introElements: parseBodyIntoElements(text), cards: [] };
      setParsed(fresh);
      lastSerialized.current = text;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const commit = useCallback(
    (next) => {
      setParsed(next);
      const serialized = structured
        ? serializeStructuredSection(next.introElements, next.cards)
        : serializeBodyElements(next.introElements);
      lastSerialized.current = serialized;
      onChange(serialized);
    },
    [onChange, structured]
  );

  const updateIntro = (elements) => commit({ ...parsed, introElements: elements });
  const updateCard = (id, updater) =>
    commit({ ...parsed, cards: parsed.cards.map((c) => (c.id === id ? updater(c) : c)) });
  const removeCard = (id) => commit({ ...parsed, cards: parsed.cards.filter((c) => c.id !== id) });

  return (
    <div style={{ fontSize: 11.5, lineHeight: 1.7, color: "var(--text)" }}>
      {(parsed.introElements.length > 0 || parsed.cards.length === 0) && (
        <div style={{ marginBottom: structured && parsed.cards.length > 0 ? 12 : 0 }}>
          <EditableBody elements={parsed.introElements} onChange={updateIntro} onOpenSource={onOpenSource} />
        </div>
      )}
      {structured &&
        parsed.cards.map((card) => (
          <EditableCard
            key={card.id}
            card={card}
            onChange={(updated) => updateCard(card.id, () => updated)}
            onRemove={() => removeCard(card.id)}
            onOpenSource={onOpenSource}
          />
        ))}
    </div>
  );
}