import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { AnnotationProvider, AnnotationContext } from "./AnnotationContext";
import AnnotatableContent from "./AnnotatableContent";
import AnnotationsSidebar from "./AnnotationsSidebar";

const T = {
  bg: "var(--bg)", bgAlt: "var(--bg3, #f9f9f8)", bgTert: "var(--bg2, var(--bg3, #f3f2ef))",
  text: "var(--text)", textSec: "color-mix(in srgb, var(--text) 85%, var(--muted))", textMuted: "var(--muted)",
  border: "var(--border)", borderMed: "color-mix(in srgb, var(--border) 60%, var(--muted))",
  red: "var(--red)", redBg: "color-mix(in srgb, var(--red) 10%, var(--bg))", redBorder: "color-mix(in srgb, var(--red) 35%, var(--bg))", redText: "var(--red)",
  amber: "var(--amber)", amberBg: "color-mix(in srgb, var(--amber) 12%, var(--bg))", amberBorder: "color-mix(in srgb, var(--amber) 40%, var(--bg))", amberText: "var(--amber)",
  blue: "var(--blue)", blueBg: "color-mix(in srgb, var(--blue) 10%, var(--bg))", blueBorder: "color-mix(in srgb, var(--blue) 35%, var(--bg))", blueText: "var(--blue)",
  green: "var(--green)", greenBg: "color-mix(in srgb, var(--green) 10%, var(--bg))", greenBorder: "color-mix(in srgb, var(--green) 35%, var(--bg))", greenText: "var(--green)",
  teal: "var(--teal, #0f6e56)", tealBg: "color-mix(in srgb, var(--teal, #0f6e56) 10%, var(--bg))",
  purple: "var(--purple)", purpleBg: "color-mix(in srgb, var(--purple) 10%, var(--bg))",
};
// Collapses a redundant double-mark like "(✓) [x]" or "( ) [ ]" into a
// single bracket group, keeping it checked if *either* mark was checked.
// This handles hospital forms that write the same option with two
// notations back-to-back, which otherwise gets parsed as two separate
// checkboxes and renders as a duplicated pill (e.g. "YESYES").
function normalizeDualBrackets(text) {
  return text.replace(
    /[\[\(]\s*([xX✓ ]?)\s*[\]\)]\s*[\[\(]\s*([xX✓ ]?)\s*[\]\)]/g,
    (full, mark1, mark2) => {
      const checked = mark1.trim() || mark2.trim();
      return `[${checked ? "x" : " "}]`;
    }
  );
}

// Resolves "Option1/Option2/... [checked: VALUE]" style annotations.
// e.g. "Yes/No [checked: No]", "Very much/Moderate/Mild/None [checked: None]"
// Rule: checked:Yes -> green, checked:No -> red, anything else -> neutral gray.
function resolveCheckedAnnotation(text) {
  const re = /([\w][\w\s\/\-]{0,60}?)\s*(?:\([^)]*\)\s*)?\[\s*checked\s*:\s*([\w][\w\s]{0,20}?)\s*\]/gi;
  return text.replace(re, (full, optionsStr, checkedVal) => {
    const val = checkedVal.trim();
    let cls = "pill-neutral";
    if (/^yes$/i.test(val)) cls = "pill-yes";
    else if (/^no$/i.test(val)) cls = "pill-no";
    return `<span class="${cls}">${val}</span>`;
  });
}

function resolveCheckboxes(text) {
  // Pass 0: "[checked: X]" style annotations, resolved first so later
  // passes never see their brackets.
  text = normalizeDualBrackets(text);
  text = resolveCheckedAnnotation(text);

  const stripStars = (s) => (s || "").trim().replace(/^\*\*/, "").replace(/\*\*$/, "").replace(/:\s*$/, "").trim();
  const isYesNo = (s) => /^(yes|no)$/i.test((s || "").trim());

  // Pass 1a: literal "YES (mark) NO (mark)" pair, optional short prefix label
  const yesNoPairRe = /(?:([*\-\s]*[\w][\w\s\/\-]{0,25}?)\s+)?\b(YES|NO)\s*[\[\(]\s*([xX✓ ]?)\s*[\]\)]\s+(YES|NO)\s*[\[\(]\s*([xX✓ ]?)\s*[\]\)]/gi;
  text = text.replace(yesNoPairRe, (full, prefix, word1, mark1, word2, mark2) => {
  const checked1 = mark1.trim().length > 0;
  const checked2 = mark2.trim().length > 0;
  let verdict, cls;
  if (checked1 && word1.toUpperCase() === "YES") { verdict = "YES"; cls = "pill-yes"; }
  else if (checked2 && word2.toUpperCase() === "YES") { verdict = "YES"; cls = "pill-yes"; }
  else if ((checked1 && word1.toUpperCase() === "NO") || (checked2 && word2.toUpperCase() === "NO")) { verdict = "NO"; cls = "pill-no"; }
  else { verdict = "Not marked"; cls = "pill-neutral"; }
  const pfx = prefix ? `${stripStars(prefix).replace(/^[*\-\s]+/, "")}: ` : "";
  return `${pfx}<span class="${cls}">${verdict}</span>`;
});

  // Pass 1b: custom-label binary pair — "LabelA (mark) LabelB (mark)"
  const customPairRe = /([\w][\w\s\/\-]{0,30}?)\s*[\[\(]\s*([xX✓ ]?)\s*[\]\)]\s+([\w][\w\s\/\-]{0,30}?)\s*[\[\(]\s*([xX✓ ]?)\s*[\]\)]/g;
  text = text.replace(customPairRe, (full, labelA, markA, labelB, markB) => {
    if (isYesNo(labelA) || isYesNo(labelB)) return full;
    const checkedA = markA.trim().length > 0;
    const checkedB = markB.trim().length > 0;
    const lA = stripStars(labelA), lB = stripStars(labelB);
    if (checkedA && !checkedB) return `<span class="pill-yes">${lA}: YES</span>`;
    if (checkedB && !checkedA) return `<span class="pill-yes">${lB}: YES</span>`;
    const clsA = checkedA ? "pill-yes" : "pill-no";
    const clsB = checkedB ? "pill-yes" : "pill-no";
    return `<span class="${clsA}">${lA}: ${checkedA ? "YES" : "NO"}</span> <span class="${clsB}">${lB}: ${checkedB ? "YES" : "NO"}</span>`;
  });

  // Pass 2: generic single checkbox, with or without a label
  // Pass 2: generic single checkbox, with or without a label
  const labelOrBare = (label, verdictWord) => {
    const l = stripStars(label);
    if (!l || isYesNo(l)) return verdictWord;
    return `${l}: ${verdictWord}`;
  };
  text = text.replace(/([\w*][\w\s\/\-*]{0,40}?)?\s*[\[\(]\s*[xX✓]\s*[\]\)]/g, (_, label) =>
    `<span class="pill-yes">${labelOrBare(label, "YES")}</span>`
  );
  // Unchecked boxes: a bare "YES"/"NO" label that's unticked is NOT the
  // same as the form-filler answering "No" — it just means that half of
  // the pair wasn't marked. Render it neutral instead of a misleading red NO.
  text = text.replace(/([\w*][\w\s\/\-*]{0,40}?)?\s*[\[\(]\s*[\]\)]/g, (_, label) => {
    const l = stripStars(label);
    if (isYesNo(l)) {
      return `<span class="pill-unselected">${l}</span>`;
    }
    return `<span class="pill-no">${labelOrBare(label, "NO")}</span>`;
  });

  return text;
}
// ─── BILL BREAKDOWN → TABLE ────────────────────────────────────────────
// Source text arrives in more than one format depending on which bill
// template was OCR'd, e.g.:
//   "Bill line items: SFS O SUSPENSION SUGAR FREE (289.99), DISPOSABLE APRON L (45.00), ..."
//   "Bill breakdown items: • SFS O SUSPENSION SUGAR FREE — 289.99, • DISPOSABLE APRON L — 45.00, ..."
// Both use a comma to separate items, but some item names/amounts contain
// their own commas (e.g. "VASOFIX BRAUNULE (20GX1,1/4) — 225.00" or
// "7,500.00"), so a naive comma-split breaks those apart. We only split on
// a comma when what follows looks like the START of a new item (a bullet,
// a letter, or an opening paren) — never when followed by a digit, which
// means it's a comma inside a number or inside parentheses.
const BILL_BREAKDOWN_RE = /^(Bill\s*(?:line\s*items|breakdown(?:\s*items)?|breakdown\s*includes))\s*[:\-]\s*(.+)$/i;

// Matches "NAME (amount)" or "NAME — amount" / "NAME - amount" / "NAME: amount"
// at the end of a segment, tolerating thousands-commas in the amount.
const BILL_ITEM_RE = /^(.+?)\s*(?:\(\s*([\d,]+(?:\.\d+)?)\s*\)|[—\-:]\s*([\d,]+(?:\.\d+)?))\s*$/;

function renderBillBreakdownIfMatch(content) {
  const m = content.trim().match(BILL_BREAKDOWN_RE);
  if (!m) return null;
  const label = m[1];
  const rest = m[2];

  // Split only where a comma is followed by the start of a new item
  // (optional bullet, then a letter or "(") — never when followed by a
  // digit, so numbers like "7,500.00" and "(20GX1,1/4)" stay intact.
  const rawItems = rest
    .split(/,\s*(?=•?\s*[A-Za-z(])/)
    .map(s => s.replace(/^•\s*/, "").trim())
    .filter(Boolean);

  const rows = rawItems.map(seg => {
    const im = seg.match(BILL_ITEM_RE);
    if (!im) return null;
    const name = im[1].trim();
    const amount = (im[2] || im[3] || "").trim();
    if (!name || !amount) return null;
    return { name, amount };
  }).filter(Boolean);

  // Bail out to plain text if parsing didn't cleanly cover most segments —
  // safer than showing a table missing half the line items.
  if (rows.length < 2 || rows.length < rawItems.length * 0.6) return null;

  const rowsHtml = rows.map(r =>
    `<tr><td>${r.name}</td><td style="text-align:right;font-family:monospace;white-space:nowrap">${r.amount}</td></tr>`
  ).join("");
  return `<div class="bill-table-wrap"><div class="bill-table-label">${label} (${rows.length} items)</div>` +
    `<table class="bill-table"><thead><tr><th>Item</th><th style="text-align:right">Amount</th></tr></thead>` +
    `<tbody>${rowsHtml}</tbody></table></div>`;
}

// ─── MEDICINE LINE RUNS → TABLE ─────────────────────────────────────────
// Consecutive sibling bullets like "XONE SB 1.5 gm in 100ml NS IV, Inj."
// each render as their own row; grouping 2+ in a row into one compact
// table instead of N separate bullet lines.
const MEDICINE_LINE_RE = /,\s*(Inj|Syp|Tab|Cap|IVF|Susp|Oint|Gel|Drops|Amp|Sol)\.?\s*$/i;
function isMedicineLine(content) {
  return MEDICINE_LINE_RE.test(content.trim());
}
function renderMedicineTable(lines) {
  const rowsHtml = lines.map(l => `<tr><td>${resolveCheckboxes(l)}</td></tr>`).join("");
  return `<div class="bill-table-wrap"><div class="bill-table-label">Medications (${lines.length})</div>` +
    `<table class="bill-table med-table"><tbody>${rowsHtml}</tbody></table></div>`;
}

function bareCheckboxLeaf(line) {
  const normalized = normalizeDualBrackets(line.trim());
  const m = normalized.match(/^([\w][\w\s\/\-]{0,40}?)\s*[\[\(]\s*([xX✓ ]?)\s*[\]\)]$/);
  if (!m) return null;
  return { label: m[1].trim(), checked: m[2].trim().length > 0 };
}

// ─── EPISODE HEADER DETECTION ────────────────────────────────────────────
// Matches lines like:
//   "Episode 2 of 5 — Hospital (Not documented to Not documented, outcome: unknown)"
//   "Episode 1 of 5 — ABHAYAHASTA MULTISPECIALITY HOSPITAL (29/06/2026 to 01/07/2026, outcome: discharged)"
const EPISODE_LINE_RE = /^Episode\s+(\d+)\s+of\s+(\d+)\s*[—\-–]\s*(.+?)(?:\s*\((.+?)\s+to\s+(.+?),\s*outcome:\s*([\w\s]+?)\))?\s*$/i;

const EP_OUTCOME_COLORS = {
  discharged: "green", deceased: "red", expired: "red",
  lama: "amber", dama: "amber", referred: "blue", unknown: "neutral",
};

function renderEpisodeHeaderIfMatch(content) {
  const m = content.trim().match(EPISODE_LINE_RE);
  if (!m) return null;
  const [, idx, total, hospital, admission, discharge, outcome] = m;
  const outcomeKey = (outcome || "").trim().toLowerCase();
  const colorKey = EP_OUTCOME_COLORS[outcomeKey] || "neutral";
  const badge = `<span class="ep-badge">EP ${idx}/${total}</span>`;
  const hospitalHtml = `<span class="ep-hospital">${hospital.trim()}</span>`;
  const datesHtml = (admission && discharge)
    ? `<span class="ep-dates">${admission.trim()} → ${discharge.trim()}</span>`
    : "";
  const outcomeHtml = outcome
    ? `<span class="ep-outcome ep-outcome-${colorKey}">${outcome.trim()}</span>`
    : "";
  return `<div class="episode-header">${badge}${hospitalHtml}${datesHtml}${outcomeHtml}</div>`;
}

function resolveTableCellCheckboxes(html) {
  return html.replace(/<td([^>]*)>([\s\S]*?)<\/td>/gi, (full, attrs, inner) => {
    if (!inner || inner.trim() === "") return full;
    const resolved = resolveCheckboxes(inner);
    return `<td${attrs}>${resolved}</td>`;
  });
}

// Parse "* **Key**: value" / "* plain text" bullet lines into a flat
// indent-aware array (indent measured in raw leading-space count).
function parseBulletLines(mdBlock) {
  const items = [];
  for (const raw of mdBlock.split("\n")) {
    const m = raw.match(/^( *)[*\-]\s+(.*)$/);
    if (!m) continue;
    if (m[2].trim() === "") continue;
    items.push({ indent: m[1].length, content: m[2] });
  }
  return items;
}

// Render one run of siblings (same indent) as kv-row divs, recursing into
// deeper indents as kv-sub rows. A pair of bare checkbox leaves merges into
// the parent row's value when they form a true binary choice (literal
// Yes/No, or an explicit "X" / "Not X" negation) — this is what distinguishes
// a Yes/No-style question from an enumerated multi-option list (AC Room /
// Non-AC Room / Ward / Suite / ...) where each option must stay on its own row.
function renderKvRows(items, start, depth) {
  if (start >= items.length) return { html: "", next: start };
  const baseIndent = items[start].indent;
  let i = start;
  let html = "";
  const rowClass = depth === 0 ? "kv-row" : `kv-row kv-sub kv-d${Math.min(depth, 4)}`;

  while (i < items.length && items[i].indent === baseIndent) {
    const item = items[i];

    // The source bill-line-items list is sometimes wrapped mid-item across
    // multiple separate bullets by the original document's pagination —
    // an item's amount "(82.50)" can land on its own bullet, disconnected
    // from the item name it belongs to on the previous bullet. Detect the
    // "Bill line items:" header, then greedily absorb every following
    // sibling bullet that starts with "(amount)" (a continuation fragment,
    // not a new top-level item) before parsing — stitching the fragments
    // back into one continuous string reconstructs the original pairing.
    const billHeaderMatch = item.content.trim().match(BILL_BREAKDOWN_RE);
    if (billHeaderMatch) {
      let merged = item.content.trim();
      let j = i + 1;
      while (
        j < items.length &&
        items[j].indent === baseIndent &&
        /^\(\s*[\d,]+\.\d+\s*\)/.test(items[j].content.trim())
      ) {
        merged += " " + items[j].content.trim();
        j++;
      }
      const billTable = renderBillBreakdownIfMatch(merged);
      if (billTable) {
        html += billTable;
        i = j;
        continue;
      }
      // fall through to normal handling if parsing still failed
    }

    // Buffer consecutive medicine-dosage lines into one compact table
    // instead of one bullet per drug.
    if (isMedicineLine(item.content)) {
      const medRun = [];
      let j = i;
      while (j < items.length && items[j].indent === baseIndent && isMedicineLine(items[j].content)) {
        medRun.push(items[j].content.trim());
        j++;
      }
      if (medRun.length >= 2) {
        html += renderMedicineTable(medRun);
        i = j;
        continue;
      }
      // a lone medicine line falls through to normal handling below
    }

    // ↓↓↓ PASTE THE NEW BLOCK HERE ↓↓↓
    {
      const leafA = bareCheckboxLeaf(item.content);
      const nextItem = items[i + 1];
      const leafB = (nextItem && nextItem.indent === baseIndent) ? bareCheckboxLeaf(nextItem.content) : null;
      const isYN = (l) => /^(yes|no)$/i.test(l);
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const isPair = leafA && leafB && (
        (isYN(leafA.label) && isYN(leafB.label) && leafA.label.toLowerCase() !== leafB.label.toLowerCase()) ||
        new RegExp(`^not\\s+${esc(leafA.label)}$`, "i").test(leafB.label) ||
        new RegExp(`^not\\s+${esc(leafB.label)}$`, "i").test(leafA.label)
      );
      if (isPair) {
        let pillHtml;
        if (isYN(leafA.label) && isYN(leafB.label)) {
          let verdict, cls;
          if (leafA.checked && leafA.label.toUpperCase() === "YES") { verdict = "YES"; cls = "pill-yes"; }
          else if (leafB.checked && leafB.label.toUpperCase() === "YES") { verdict = "YES"; cls = "pill-yes"; }
          else if ((leafA.checked && leafA.label.toUpperCase() === "NO") || (leafB.checked && leafB.label.toUpperCase() === "NO")) { verdict = "NO"; cls = "pill-no"; }
          else { verdict = "Not marked"; cls = "pill-neutral"; }
          pillHtml = `<span class="${cls}">${verdict}</span>`;
        } else if (leafA.checked && !leafB.checked) {
          pillHtml = `<span class="pill-yes">${leafA.label}: YES</span>`;
        } else if (leafB.checked && !leafA.checked) {
          pillHtml = `<span class="pill-yes">${leafB.label}: YES</span>`;
        } else {
          pillHtml = `<span class="pill-no">${leafA.label}: NO</span> <span class="pill-no">${leafB.label}: NO</span>`;
        }
        html += `<div class="kv-plain">${pillHtml}</div>`;
        i += 2;
        continue;
      }
    }
    // ↑↑↑ END OF NEW BLOCK ↑↑↑

    const kvMatch = item.content.match(/^\*\*([^*\n]+?)\*\*\s*[:\-]\s*(.*)$/);
    const hasChildren = (i + 1 < items.length) && items[i + 1].indent > baseIndent;

    let valueHtml = null;
    let consumedChildIdx = i + 1;
    let remainingChildStart = null;

    if (hasChildren) {
      const childIndent = items[i + 1].indent;
      const childStart = i + 1;
      const leaf1 = bareCheckboxLeaf(items[childStart]?.content || "");
      const leaf2 = (items[childStart + 1] && items[childStart + 1].indent === childIndent)
        ? bareCheckboxLeaf(items[childStart + 1].content)
        : null;

      const isYN = (l) => /^(yes|no)$/i.test(l);
      const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const isComplementaryPair = leaf1 && leaf2 && (
        (isYN(leaf1.label) && isYN(leaf2.label) && leaf1.label.toLowerCase() !== leaf2.label.toLowerCase()) ||
        new RegExp(`^not\\s+${esc(leaf1.label)}$`, "i").test(leaf2.label) ||
        new RegExp(`^not\\s+${esc(leaf2.label)}$`, "i").test(leaf1.label)
      );

      if (isComplementaryPair) {
        let pillHtml;
        if (isYN(leaf1.label) && isYN(leaf2.label)) {
          let verdict = "NO";
          if (leaf1.checked && leaf1.label.toUpperCase() === "YES") verdict = "YES";
          else if (leaf2.checked && leaf2.label.toUpperCase() === "YES") verdict = "YES";
          pillHtml = `<span class="${verdict === "YES" ? "pill-yes" : "pill-no"}">${verdict}</span>`;
        } else if (leaf1.checked && !leaf2.checked) {
          pillHtml = `<span class="pill-yes">${leaf1.label}: YES</span>`;
        } else if (leaf2.checked && !leaf1.checked) {
          pillHtml = `<span class="pill-yes">${leaf2.label}: YES</span>`;
        } else {
          pillHtml = `<span class="pill-no">${leaf1.label}: NO</span> <span class="pill-no">${leaf2.label}: NO</span>`;
        }
        valueHtml = pillHtml;
        consumedChildIdx = childStart + 2;
        if (items[consumedChildIdx] && items[consumedChildIdx].indent === childIndent) {
          remainingChildStart = consumedChildIdx;
        }
      }
    }

    let nextIdx;
    if (kvMatch) {
      const key = kvMatch[1].trim();
      const rawVal = kvMatch[2].trim();
      if (valueHtml) {
        html += `<div class="${rowClass}"><span class="kv-key">${key}</span><span class="kv-val">${valueHtml}</span></div>`;
        nextIdx = consumedChildIdx;
        if (remainingChildStart !== null) {
          const rest = renderKvRows(items, remainingChildStart, depth + 1);
          html += rest.html;
          nextIdx = rest.next;
        }
      } else {
        const resolved = resolveCheckboxes(rawVal);
        const empty = !rawVal || rawVal === "—";
        html += `<div class="${rowClass}"><span class="kv-key">${key}</span><span class="kv-val${empty ? " kv-empty" : ""}">${empty ? "—" : resolved}</span></div>`;
        nextIdx = i + 1;
        if (hasChildren) {
          const child = renderKvRows(items, i + 1, depth + 1);
          html += child.html;
          nextIdx = child.next;
        }
      }
    } else {
      if (valueHtml) {
        html += `<div class="${rowClass}"><span class="kv-val">${valueHtml}</span></div>`;
        nextIdx = consumedChildIdx;
        if (remainingChildStart !== null) {
          const rest = renderKvRows(items, remainingChildStart, depth + 1);
          html += rest.html;
          nextIdx = rest.next;
        }
      } else {
        const episodeHtml = renderEpisodeHeaderIfMatch(item.content);
        const billHtml = !episodeHtml ? renderBillBreakdownIfMatch(item.content) : null;
        html += episodeHtml || billHtml || `<div class="kv-plain">${resolveCheckboxes(item.content)}</div>`;
        nextIdx = i + 1;
        if (hasChildren) {
          const child = renderKvRows(items, i + 1, depth + 1);
          html += child.html;
          nextIdx = child.next;
        }
      }
    }
    i = nextIdx;
  }
  return { html, next: i };
}

function renderBulletBlock(mdBlock) {
  const items = parseBulletLines(mdBlock);
  if (items.length === 0) return "";
  const { html } = renderKvRows(items, 0, 0);
  return html;
}

function parseMarkdown(md = "") {
  // Extract contiguous runs of bullet lines and render each run as a block
  // of kv-row/kv-plain divs (handles arbitrary nesting depth + checkbox
  // pair merging). Non-bullet lines pass through untouched for the
  // header/bold/table handling below.
  const lines = md.split("\n");
  const outLines = [];
  let i = 0;
  while (i < lines.length) {
    if (/^ *[*\-]\s+\S/.test(lines[i])) {
      let j = i;
      while (j < lines.length && (/^ *[*\-]\s+/.test(lines[j]) || lines[j].trim() === "")) j++;
      // trim trailing blank lines from the captured block
      let blockEnd = j;
      while (blockEnd > i && lines[blockEnd - 1].trim() === "") blockEnd--;
      const block = lines.slice(i, blockEnd).join("\n");
      outLines.push(renderBulletBlock(block));
      i = j;
    } else {
      outLines.push(lines[i]);
      i++;
    }
  }
  let out = outLines.join("\n");
  out = resolveTableCellCheckboxes(out);   // ← add this line


  return out
    .replace(/^### (.+)$/gm, "<h3>$1</h3>")
    .replace(/^## (.+)$/gm, "<h2>$1</h2>")
    .replace(/^# (.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/^---$/gm, "<hr/>")
    .replace(/\n{2,}/g, "<br/><br/>");
}

// NOTE: this no longer discards any table content. Sparse tables are
// collapsed into a native <details>/<summary> so the badge is what shows
// by default, but the full <table> is still in the DOM and one click away
// — nothing the source document contained is ever hidden from the user.
function collapseEmptyTables(html) {
  return html.replace(/<table[\s\S]*?<\/table>/gi, (t) => {
    const tds = [...t.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/&nbsp;/g,"").replace(/<[^>]+>/g,"").replace(/\s/g,""));
    const nonEmpty = tds.filter(c => c.length > 0);
    const ratio = nonEmpty.length / Math.max(tds.length, 1);
    const rows = (t.match(/<tr/gi)||[]).length;
    if ((ratio < 0.12 && tds.length > 4) || (rows > 6 && ratio < 0.25)) {
      const summary = nonEmpty.length > 0
        ? `<span class="eti">⊟</span> Mostly empty table — preview: <span class="sparse-preview">${nonEmpty.slice(0,4).join(" · ")}</span> (click to view all ${tds.length} cells)`
        : `<span class="eti">⊘</span> Mostly empty table (click to view)`;
      return `<details class="sparse-table-details"><summary class="sparse-table-summary">${summary}</summary>${t}</details>`;
    }
    return t;
  });
}

const ABNORMAL_PATTERNS = [
  { pattern: /\bHbA1c\s*[:\-]?\s*(\d+\.?\d*)\s*%/gi, check: (m,v) => parseFloat(v)>6.5, label:"HbA1c", normal:"≤6.5%" },
  { pattern: /\b(?:FBS|RBS|blood\s*sugar|glucose)\s*[:\-]?\s*(\d+\.?\d*)\s*(?:mg\/dL)?/gi, check: (m,v) => parseFloat(v)>140, label:"Blood Sugar", normal:"≤140 mg/dL" },
  { pattern: /\bCreatinine\s*[:\-]?\s*(\d+\.?\d*)\s*(?:mg\/dL)?/gi, check: (m,v) => parseFloat(v)>1.2, label:"Creatinine", normal:"≤1.2 mg/dL" },
{ pattern: /\bBP\s*[-:]?\s*(\d{2,3})\/(\d{2,3})\s*(?:mmHg)?/gi, check: (m,s,d) => parseInt(s)>140||parseInt(d)>90, label:"BP", normal:"≤140/90 mmHg" },  { pattern: /\b(?:Hb|Haemoglobin|Hemoglobin)\s*[:\-]?\s*(\d+\.?\d*)\s*(?:g\/dL)?/gi, check: (m,v) => parseFloat(v)<12, label:"Hemoglobin", normal:"≥12 g/dL" },
  { pattern: /\b(?:Pulse|HR|Heart Rate)\s*[:\-]?\s*(\d+)\s*(?:bpm)?/gi, check: (m,v) => parseInt(v)>100||parseInt(v)<60, label:"Pulse", normal:"60–100 bpm" },
  { pattern: /\bSpO2\s*[:\-]?\s*(\d+)\s*%?/gi, check: (m,v) => parseInt(v)<95, label:"SpO2", normal:"≥95%" },
  { pattern: /\b(?:Temp|Temperature)\s*[:\-]?\s*(\d+\.?\d*)\s*[°]?[FCfc]?/gi, check: (m,v) => parseFloat(v)>99||(parseFloat(v)>37.5&&parseFloat(v)<50), label:"Temp", normal:"≤99°F" },
  { pattern: /\b(?:Urea|BUN)\s*[:\-]?\s*(\d+\.?\d*)/gi, check: (m,v) => parseFloat(v)>45, label:"Urea/BUN", normal:"≤45" },
  { pattern: /\bSodium\s*[:\-]?\s*(\d+\.?\d*)/gi, check: (m,v) => parseFloat(v)<135||parseFloat(v)>145, label:"Sodium", normal:"135–145 mEq/L" },
  { pattern: /\bPotassium\s*[:\-]?\s*(\d+\.?\d*)/gi, check: (m,v) => parseFloat(v)<3.5||parseFloat(v)>5.0, label:"Potassium", normal:"3.5–5.0 mEq/L" },
  { pattern: /\b(?:WBC|TLC)\s*[:\-]?\s*(\d+\.?\d*)/gi, check: (m,v) => parseFloat(v)>11000, label:"WBC/TLC", normal:"≤11000/µL" },
  { pattern: /\b(?:Platelets?|PLT)\s*[:\-]?\s*(\d+\.?\d*)/gi, check: (m,v) => parseFloat(v)<150000, label:"Platelets", normal:"≥150000/µL" },
  { pattern: /\bRR\s*[:\-]?\s*(\d+)\s*(?:breaths?\/min|\/min|bpm)?/gi, check: (m,v) => parseInt(v)>40, label:"RR", normal:"≤40/min" },
];

const DISC_PATTERNS = [
  { re: /\[MISSING\][^\n]*/gi, type: "critical" },
  { re: /\[INCOMPLETE\][^\n]*/gi, type: "warning" },
  { re: /\[SINGLE STRETCH\][^\n]*/gi, type: "warning" },
  { re: /\[BILLING MISMATCH\][^\n]*/gi, type: "critical" },
  { re: /\[PHYSIOLOGICAL ANOMALY\][^\n]*/gi, type: "critical" },
];

// ─── Document findings (PED / billing / coverage) ──────────────────────────
// These come from the backend's map-reduce pass over raw_llama_markdown
// (see routes/case_documents_router.py::_generate_document_findings), NOT
// from a regex — so unlike ABNORMAL_PATTERNS/DISC_PATTERNS above, findings
// arrive as a prop rather than being derived from the text here.
const FINDING_STYLES = {
  PED_SUSPECTED:                 { label: "Pre-Existing Disease",      color: "var(--red)" },
  BILLING_MISMATCH:              { label: "Billing Mismatch",          color: "var(--red)" },
  POLICY_COVERAGE_ISSUE:         { label: "Coverage Issue",            color: "var(--amber)" },
  IDENTITY_MISMATCH:             { label: "Identity Mismatch",         color: "var(--red)" },
  TIMELINE_INCONSISTENCY:        { label: "Timeline Inconsistency",    color: "var(--amber)" },
  DOCTOR_FACILITY_INCONSISTENCY: { label: "Doctor/Facility Mismatch",  color: "var(--amber)" },
  NARRATIVE_INCONSISTENCY:       { label: "Narrative Inconsistency",   color: "var(--amber)" },
  DOCUMENT_QUALITY_FLAG:         { label: "Document Quality",          color: "var(--muted)" },
  OTHER_SUSPICIOUS:              { label: "Suspicious Pattern",        color: "var(--amber)" },
};

function findingStyle(finding) {
  const base = FINDING_STYLES[finding.type] || { label: "Flagged", color: "var(--amber)" };
  return { ...base, color: finding.severity === "critical" ? "var(--red)" : base.color };
}

function normStr(s) {
  return (s || "").trim().toLowerCase();
}

// Sentinel markers (Unicode Private Use Area codepoints) used to wrap a
// finding's verbatim quote inside the RAW block text, before parseMarkdown
// runs. PUA chars can never collide with real document content or any
// markdown/bullet/checkbox syntax, so they survive every regex transform in
// parseMarkdown untouched — then get swapped for a real <mark> afterwards.
const FIND_OPEN = "\uE050", FIND_MID = "\uE051", FIND_CLOSE = "\uE052";

function injectFindingMarkers(text, findings) {
  if (!findings || findings.length === 0) return text;
  let out = text;
  for (const f of findings) {
    const quotes = f.quotes || [];
    quotes.forEach((q, qi) => {
      if (!q.quote) return;
      const idx = out.indexOf(q.quote);
      if (idx === -1) return; // backend already verifies quotes exist; stay safe regardless
      const markerId = `${f.id}::q${qi}`;
      out = out.slice(0, idx) + FIND_OPEN + markerId + FIND_MID + q.quote + FIND_CLOSE + out.slice(idx + q.quote.length);
    });
  }
  return out;
}

const FIND_MARKER_RE = new RegExp(`${FIND_OPEN}(.*?)${FIND_MID}([\\s\\S]*?)${FIND_CLOSE}`, "g");

function renderFindingMarkers(html, findingsById) {
  return html.replace(FIND_MARKER_RE, (full, markerId, quoted) => {
    const baseId = markerId.split("::q")[0];
    const f = findingsById[baseId];
    if (!f) return quoted;
    const style = findingStyle(f);
    const title = (f.explanation || "").replace(/"/g, "&quot;");
    return `<mark class="finding-mark" data-finding-id="${baseId}" style="background:color-mix(in srgb, ${style.color} 20%, var(--bg));border-bottom:2px solid ${style.color};color:${style.color};font-weight:700;border-radius:2px;padding:0 2px;" title="${title}">${quoted}</mark>`;
  });
}

const MONTH_MAP = {jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11};

function extractEarliestDate(text) {
  const c = [];
  let m;
  const r1 = /\b(\d{4})-(\d{2})-(\d{2})\b/g; while((m=r1.exec(text))!==null) c.push(new Date(+m[1],+m[2]-1,+m[3]));
  const r2 = /\b(\d{1,2})[-\/]([A-Za-z]{3})[-\/](\d{4})\b/g; while((m=r2.exec(text))!==null){const mo=MONTH_MAP[m[2].toLowerCase()];if(mo!==undefined)c.push(new Date(+m[3],mo,+m[1]));}
  const r3 = /\b(\d{1,2})[\/\-](\d{2})[\/\-](\d{4})\b/g; while((m=r3.exec(text))!==null){const d=+m[1],mo=+m[2]-1,y=+m[3];if(d>=1&&d<=31&&mo>=0&&mo<=11&&y>=2000&&y<=2100)c.push(new Date(y,mo,d));}
  const valid = c.filter(d=>d instanceof Date&&!isNaN(d));
  return valid.length ? valid.reduce((a,b)=>a<b?a:b) : null;
}
const NEUTRAL_TYPE = { color: "var(--muted)", bg: T.bgTert, border: T.border, text: "var(--text)" };

// ─── Category priority for the grouped-view sort mode ─────────────────────────
// Member/Insured visit → Hospital visit/ICP → Identity & Policy → Bills/Registers → Other
const CATEGORY_ORDER = [
  "field_investigation",
  "identity_policy",
  "member_visit",
  "hospital_visit",
  "bills_registers",
  "other",
];

const CATEGORY_LABELS = {
  field_investigation: "Field Investigation Documents",
  member_visit:     "Member / Insured Visit",
  hospital_visit:   "Hospital Visit / ICP",
  identity_policy:  "Identity & Policy",
  bills_registers:  "Bills & Registers",
  other:            "Other Documents",
};

const DOC_TYPES = [
  // ── Member / Insured visit ──────────────────────────────────────────────
  { test: /insured verification/i,                               label: "Insured Verification", category: "member_visit"    },
  { test: /mandatory details.*field officer|field officer/i,     label: "Field Officer Form",   category: "member_visit"    },
  { test: /gps map camera/i,                                     label: "Field Visit Photo",    category: "member_visit"    },

  // ── Hospital visit / ICP (clinical record of the admission) ───────────
  { test: /discharge summary/i,                                  label: "Discharge Summary",    category: "hospital_visit"  },
  { test: /initial assessment/i,                                 label: "Admission Assessment", category: "hospital_visit"  },
  { test: /case sheet/i,                                         label: "Case Sheet",           category: "hospital_visit"  },
  { test: /progress.*record|doctor.*progress|handover/i,         label: "Progress Notes",        category: "hospital_visit"  },
  { test: /vital signs|pews|intake.*output/i,                    label: "Vitals Chart",          category: "hospital_visit"  },
  { test: /treatment.*chart|treatment.*order/i,                  label: "Treatment Chart",       category: "hospital_visit"  },
  { test: /prescription|rx\b/i,                                  label: "Prescription",          category: "hospital_visit"  },
  { test: /lab.*report|report.*result|patholog/i,                label: "Lab Report",            category: "hospital_visit"  },

  // ── Identity & Policy ───────────────────────────────────────────────────
  { test: /aadhaar|government of india.*unique identification/i, label: "Identity Document",     category: "identity_policy" },

  // ── Bills & Registers ───────────────────────────────────────────────────
  { test: /in patient bill|bill of supply/i,                     label: "Billing",               category: "bills_registers" },
].map(d => ({ ...d, ...NEUTRAL_TYPE }));

// Field-investigation documents are tagged "[INV_TYPE/step_key] realname.ext"
// in their fileName (see field_investigation_parse.py). When that marker is
// present, the card header should always reflect it — which investigation
// type and step this came from — rather than guessing from document
// content, since content-based inference (DOC_TYPES below) has no way to
// recognize field-investigation step types and will always fall through to
// the generic "Document" label for them regardless of what's inside.
const INV_TAG_RE = /^\[([A-Z]+)\/([^\]]+)\]\s*(.*)$/;

function parseTaggedFileName(fileName) {
  if (!fileName) return null;
  const m = fileName.match(INV_TAG_RE);
  if (!m) return null;
  return { invType: m[1], stepKey: m[2], originalName: m[3] || "" };
}

const INV_TYPE_STYLES = {
  MV:   { bg: "#EFF6FF", border: "#BFDBFE", text: "#2563EB" },
  HV:   { bg: "#F0FDF4", border: "#BBF7D0", text: "#16A34A" },
  HVI:  { bg: "#FFF7ED", border: "#FED7AA", text: "#EA580C" },
  TELE: { bg: "#FAF5FF", border: "#DDD6FE", text: "#7C3AED" },
  BILL: { bg: "#FFFBEB", border: "#FDE68A", text: "#B45309" },
  DIGI: { bg: "#F0F9FF", border: "#BAE6FD", text: "#0369A1" },
};

function stepKeyToLabel(stepKey) {
  return (stepKey || "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function inferDocType(text, fileName) {
  const tag = parseTaggedFileName(fileName);
  if (tag) {
    const style = INV_TYPE_STYLES[tag.invType] || NEUTRAL_TYPE;
    return {
      label: `${tag.invType} — ${stepKeyToLabel(tag.stepKey)}`,
      category: "field_investigation",
      color: style.text,
      bg: style.bg,
      border: style.border,
      text: style.text,
    };
  }
  for (const dt of DOC_TYPES) if (dt.test.test(text)) return dt;
  return { label: "Document", category: "other", ...NEUTRAL_TYPE };
}

function extractAbnormalsFromText(text) {
  const results = [];
  for (const {pattern,check,label,normal} of ABNORMAL_PATTERNS) {
    pattern.lastIndex = 0; let m;
    while((m=pattern.exec(text))!==null){const g=m.slice(1);if(check(m[0],...g))results.push({match:m[0],label,normal});}
  }
  return results;
}

function extractFlagsFromText(text) {
  const flags=[],seen=new Set();
  for(const{re,type}of DISC_PATTERNS){re.lastIndex=0;let m;while((m=re.exec(text))!==null){const t=(m[0]||"").trim().slice(0,200);if(t&&!seen.has(t)&&t.length>5){seen.add(t);flags.push({text:t,type});}}}
  return flags;
}
function extractPages(rawContent) {
  const pageRegex = /<!--\s*PAGE_START:\s*(\d+)\s*-->([\s\S]*?)<!--\s*PAGE_END:\s*\1\s*-->/g;
  const pages = [];
  let m;
  while ((m = pageRegex.exec(rawContent)) !== null) {
    pages.push({ pageNumber: parseInt(m[1], 10), text: m[2] });
  }
  return pages;
}

function stripMarkers(text) {
  return text.replace(/<!--\s*(PDF_START|PDF_END|PAGE_START|PAGE_END)[^>]*-->/g, "").trim();
}
function splitFieldInvestigationBlocks(text) {
  const blockRegex = /---\n(##[^\n]+)\n([\s\S]*?)\n---\n\n([\s\S]*?)(?=\n*---\n##|$)/g;
  const blocks = [];
  let m;
  while ((m = blockRegex.exec(text)) !== null) {
    const heading = m[1].replace(/^##\s*/, "").trim();
    const meta    = m[2];
    const content = m[3].trim();
    if (!content) continue;

    const fileMatch = meta.match(/\*\*File:\*\*\s*([^\|]+?)\s*\|/);
    const fileName  = fileMatch ? fileMatch[1].trim() : null;

    blocks.push({
      heading,
      fileName,
      body: `**${heading}**\n${meta}\n\n${content}`,
    });
  }
  return blocks;
}

function splitAndAnnotate(markdown = "", findings = []) {
  const pdfRegex = /<!--\s*PDF_START:\s*(.*?)\s*-->([\s\S]*?)<!--\s*PDF_END:\s*\1\s*-->/g;
  const pdfMatches = [...markdown.matchAll(pdfRegex)];

  let idx = 0;
  const allBlocks = [];

  // Legacy fallback for old case_documents created before markers existed
  if (pdfMatches.length === 0) {
    let rawBlocks = markdown.split(/={3}\s*NEW DOCUMENT\s*={3}/i);
    if (rawBlocks.length === 1) {
      let text = rawBlocks[0].replace(/^\s*EMAIL CONTENT:\s*\n[\s\S]*?DOCUMENT CONTENT:\s*\n/i, "").trim();
      const segs = text.split(/(?=\n#{1,2}\s+(?:Discharge Summary|In Patient Bill|Duplicate\b))|(?=\nFORM VII\b)|(?=\n(?:GPS Map Camera|Photograph of Apollo))|(?=\n<u>\*\*Mandatory)/im);
      rawBlocks = segs.length > 1 ? segs : [text];
    }
    rawBlocks.forEach((block) => {
      let text = block.replace(/^\s*EMAIL CONTENT:\s*\n[\s\S]*?DOCUMENT CONTENT:\s*\n/i, "").trim();
      if (text.length <= 20) return;
      allBlocks.push({
  text, fileName: null, pageNumber: null,
  date: extractEarliestDate(text), type: inferDocType(text),
  index: idx++, abnormals: extractAbnormalsFromText(text), flags: extractFlagsFromText(text),
  findings: [],
});
    });
    return allBlocks;
  }

  // Marker-based path: split into PDFs first, then sub-split each PDF
  // by the same heading heuristics as before — but now each piece keeps
  // its source filename + the page range it actually came from, which is
  // also how we match backend-generated findings to the right card.
  for (const m of pdfMatches) {
  const fileName = m[1].trim();
  const rawContent = m[2];
  const pages = extractPages(rawContent);

  pages.forEach(({ pageNumber, text: rawPageText }) => {
    const text = stripMarkers(rawPageText);
    if (text.length <= 20) return;
    const blockFindings = (findings || []).filter(f =>
      (f.quotes || []).some(q =>
        normStr(q.file_name) === normStr(fileName) &&
        (q.page_number == null || q.page_number === pageNumber)
      )
    );
    allBlocks.push({
      text, fileName, pageNumber,
      date: extractEarliestDate(text), type: inferDocType(text, fileName),
      index: idx++, abnormals: extractAbnormalsFromText(text), flags: extractFlagsFromText(text),
      findings: blockFindings,
    });
  });
}

  // ── Fallback: pick up content that sits OUTSIDE any PDF_START/PDF_END
  //    pair — e.g. the "FIELD INVESTIGATION DOCUMENTS" section appended
  //    by the backend, which uses "---\n## [...]" dividers instead of
  //    PDF markers. Without this, that entire section is silently dropped.
  let leftover = markdown;
  for (const m of pdfMatches) {
    leftover = leftover.replace(m[0], "");
  }
  const fieldBlocks = splitFieldInvestigationBlocks(leftover);
  fieldBlocks.forEach(({ fileName, body }) => {
    if (body.length <= 20) return;
    const blockFindings = (findings || []).filter(f =>
      fileName && (f.quotes || []).some(q => normStr(q.file_name) === normStr(fileName))
    );
        allBlocks.push({
      text: body, fileName, pageNumber: null,
      date: extractEarliestDate(body), type: inferDocType(body, fileName),
      index: idx++, abnormals: extractAbnormalsFromText(body), flags: extractFlagsFromText(body),
      findings: blockFindings,
    });
  });

  return allBlocks;
}

function extractDiscrepancyFlags(text, pass1) {
  const flags=[],seen=new Set();
  const verbatim=(pass1?.discrepancies_verbatim||"").trim();
  if(verbatim&&verbatim.length>10){for(const line of verbatim.split("\n")){const t=line.trim();if(t&&!seen.has(t)){seen.add(t);flags.push({text:t,type:/\[MISSING\]/i.test(t)||/not collected/i.test(t)?"critical":"warning"});}}}
  for(const{re,type}of DISC_PATTERNS){re.lastIndex=0;let m;while((m=re.exec(text))!==null){const t=(m[0]||"").trim().slice(0,200);if(t&&!seen.has(t)&&t.length>5){seen.add(t);flags.push({text:t,type});}}}
  return flags;
}

function fmtDate(date) {
  if (!date) return null;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

let _id = 0;
const nextId = () => `rd-${++_id}`;

function applyAbnormalHighlights(html) {
  let r = html;
  for(const{pattern,check}of ABNORMAL_PATTERNS){
    pattern.lastIndex=0;
    r=r.replace(pattern,(...args)=>{
      const full=args[0],groups=args.slice(1,args.length-2);
      return check(full,...groups)?`<mark class="abnormal" data-abnormal="true" id="${nextId()}">${full}</mark>`:full;
    });
  }
  return r;
}

function applySearchHighlight(html, query, activeIdx) {
  if (!query.trim()) return html;
  const esc = query.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
  let i=0;
  return html.replace(new RegExp(`(${esc})`,"gi"), (match) => {
    const id=`search-hit-${i}`,active=i===activeIdx; i++;
    return `<mark class="search-hit${active?" search-active":""}" id="${id}">${match}</mark>`;
  });
}

// ─── Doc card ──────────────────────────────────────────────────────────────────
// FIX 1: default expanded=true
// FIX 2: auto-expand when block contains active search match
function DocCard({ block, search, searchActiveIdx, globalSearchOffset, blockRef, onOpenSource, findingsById }) {
    const [expanded, setExpanded] = useState(true); // FIX 1: default open

  // FIX 2: auto-expand if this card contains the active search hit
  useEffect(() => {
    if (!search.trim()) return;
    const esc = search.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    const matchesInBlock = (block.text.match(new RegExp(esc, "gi")) || []).length;
    if (matchesInBlock === 0) return;
    const localIdx = searchActiveIdx - globalSearchOffset;
    if (localIdx >= 0 && localIdx < matchesInBlock) {
      setExpanded(true);
    }
  }, [search, searchActiveIdx, globalSearchOffset, block.text]);

  const renderedHtml = useMemo(() => {
    const markedText = injectFindingMarkers(block.text, block.findings);
    let html = parseMarkdown(markedText);
    html = collapseEmptyTables(html);
    html = applyAbnormalHighlights(html);
    html = renderFindingMarkers(html, findingsById);
    html = applySearchHighlight(html, search, searchActiveIdx - globalSearchOffset);
    return html;
  }, [block.text, block.findings, findingsById, search, searchActiveIdx, globalSearchOffset]);

  const findingCritCount = (block.findings || []).filter(f => f.severity === "critical").length;
  const findingWarnCount = (block.findings || []).filter(f => f.severity === "warning").length;
  const critCount = block.flags.filter(f=>f.type==="critical").length + findingCritCount;
  const warnCount = block.flags.filter(f=>f.type==="warning").length + findingWarnCount;
  const hasIssues = block.flags.length > 0 || block.abnormals.length > 0 || (block.findings||[]).length > 0;

  const leftBorder = (critCount>0||block.abnormals.length>0) ? T.red : warnCount>0 ? T.amber : T.borderMed;

  return (
    <div
      ref={blockRef}
      style={{
        borderRadius: 6, marginBottom: 5, overflow: "hidden",
        background: T.bg,
        border: `1px solid ${hasIssues?(critCount>0||block.abnormals.length>0?T.redBorder:T.amberBorder):T.border}`,
        borderLeft: `3px solid ${leftBorder}`,
      }}
    >
      {/* Header */}
<div
  onClick={() => setExpanded(e => !e)}
  style={{
    display: "flex", alignItems: "center", gap: 9,
    padding: "8px 12px", cursor: "pointer", userSelect: "none",
    background: expanded ? T.bg : T.bgAlt,
  }}
>
  <span style={{
    display: "inline-flex", alignItems: "center",
    padding: "2px 9px", borderRadius: 99,
    background: block.type.bg, color: block.type.text,
    border: `0.5px solid ${block.type.border}`,
    fontSize: 11, fontWeight: 600, whiteSpace: "nowrap",
  }}>
    {block.type.label}
  </span>

  {block.date
    ? <span style={{ fontSize: 11, color: T.textSec, fontFamily: "monospace", whiteSpace: "nowrap" }}>{fmtDate(block.date)}</span>
    : <span style={{ fontSize: 10, color: T.textMuted, fontStyle: "italic" }}>No date</span>
  }

{(block.fileName || block.pageNumber) && (
  <span
    onClick={(e) => {
      e.stopPropagation();
      onOpenSource?.(block.fileName, block.pageNumber);
    }}
    title="Open this page in PDF viewer"
    style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 9, fontWeight: 600, color: T.textSec,
      whiteSpace: "nowrap", padding: "1px 7px", borderRadius: 99,
      background: T.bgTert, border: `0.5px solid ${T.border}`,
      cursor: onOpenSource ? "pointer" : "default",
      textDecoration: "none",
    }}
    onMouseEnter={e => { if (onOpenSource) e.currentTarget.style.background = T.border; }}
    onMouseLeave={e => { e.currentTarget.style.background = T.bgTert; }}
  >
    {block.pageNumber ? `→ Go to page ${block.pageNumber}` : block.fileName ? `→ Open ${block.fileName}` : ""}
  </span>
)}

{block.pages && block.pages.length > 0 && (
  <span style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
    {block.pages.map((p) => (
      <span
        key={p}
        style={{
          fontSize: 9, fontFamily: "monospace", color: T.textSec,
          padding: "1px 6px", borderRadius: 4,
          background: T.bgTert, border: `0.5px solid ${T.border}`,
          whiteSpace: "nowrap",
        }}
      >
        Page {p}
      </span>
    ))}
  </span>
)}

  <span style={{ flex: 1 }} />
  {(critCount>0||block.abnormals.length>0) && (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 99, background: T.redBg, color: T.redText, border: `0.5px solid ${T.redBorder}` }}>
      {critCount+block.abnormals.length} critical
    </span>
  )}
  {warnCount > 0 && (
    <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 7px", borderRadius: 99, background: T.amberBg, color: T.amberText, border: `0.5px solid ${T.amberBorder}` }}>
      {warnCount} warn
    </span>
  )}
  <span style={{ fontSize: 12, color: T.textMuted, width: 14, textAlign: "center" }}>
    {expanded ? "▾" : "▸"}
  </span>
</div>

      {/* Collapsed issue tags — only shown when manually collapsed */}
      {!expanded && hasIssues && (
        <div style={{ padding: "4px 12px 7px", display: "flex", flexWrap: "wrap", gap: 4, borderTop: `1px solid ${T.border}` }}>
          {block.abnormals.map((a,i) => (
            <span key={i} style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, background: T.redBg, color: T.redText, border: `0.5px solid ${T.redBorder}` }}>
              {a.label}: {a.match}
            </span>
          ))}
          {block.flags.map((f,i) => {
            const c = f.type==="critical";
            return <span key={i} style={{ fontSize: 10, padding: "1px 7px", borderRadius: 99, background: c?T.redBg:T.amberBg, color: c?T.redText:T.amberText, border: `0.5px solid ${c?T.redBorder:T.amberBorder}`, maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {c?"✕":"⚠"} {f.text.replace(/^\[.*?\]\s*/,"").slice(0,50)}
            </span>;
          })}
          {(block.findings||[]).map((f,i) => {
            const st = findingStyle(f);
            return (
              <span key={`fnd-${i}`} style={{
                fontSize: 10, padding: "1px 7px", borderRadius: 99,
                background: `color-mix(in srgb, ${st.color} 10%, var(--bg))`, color: st.color,
                border: `0.5px solid color-mix(in srgb, ${st.color} 35%, var(--bg))`,
                maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                ⚑ {st.label}
              </span>
            );
          })}
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.border}` }}>
          {(block.findings||[]).length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 }}>
              {block.findings.map(f => {
                const st = findingStyle(f);
                return (
                  <div key={f.id} style={{
                    display: "flex", gap: 8, alignItems: "flex-start",
                    padding: "7px 10px", borderRadius: 6,
                    background: `color-mix(in srgb, ${st.color} 8%, var(--bg))`,
                    border: `0.5px solid color-mix(in srgb, ${st.color} 35%, var(--bg))`,
                  }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: st.color, flexShrink: 0, whiteSpace: "nowrap" }}>
                      ⚑ {st.label}
                    </span>
                    <span style={{ fontSize: 11, color: st.color, lineHeight: 1.5 }}>{f.explanation}</span>
                  </div>
                );
              })}
            </div>
          )}
          <AnnotatableContent html={renderedHtml} blockIndex={block.index} />
        </div>
      )}
    </div>
  );
}
function CategoryDivider({ category, count }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      margin: "18px 0 8px", padding: "6px 10px",
      background: T.bgAlt, borderRadius: 5,
      borderLeft: `3px solid ${T.accent}`,
    }}>
      <span style={{
        fontSize: 12, fontWeight: 700, letterSpacing: "0.06em",
        textTransform: "uppercase", color: T.text, whiteSpace: "nowrap",
      }}>
        {CATEGORY_LABELS[category] || category}
      </span>
      <span style={{
        fontSize: 10, fontWeight: 600, color: "#fff", background: T.accent,
        borderRadius: 99, padding: "1px 7px", flexShrink: 0,
      }}>
        {count}
      </span>
      <span style={{ flex: 1, height: 1, background: T.border }} />
    </div>
  );
}

// ─── Scroll-fade wrapper for IssuesPanel — shows a bottom gradient +
//     "more below" hint whenever the list is scrollable and not yet
//     scrolled to the end, so a capped-height panel doesn't silently
//     hide content the way a plain overflow:auto box does. ──────────────
function IssuesPanelScrollWrap(props) {
  const scrollRef = useRef(null);
  const [hasMore, setHasMore] = useState(false);

  const checkOverflow = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 4;
    setHasMore(el.scrollHeight > el.clientHeight + 4 && !atBottom);
  }, []);

  useEffect(() => {
    checkOverflow();
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(checkOverflow);
    ro.observe(el);
    return () => ro.disconnect();
  }, [checkOverflow, props.findings, props.abnormals, props.discFlags]);

  return (
    <div style={{ position: "relative", flexShrink: 0, borderBottom: `1px solid ${T.border}` }}>
      <div
        ref={scrollRef}
        onScroll={checkOverflow}
        style={{ maxHeight: "48vh", overflowY: "auto" }}
      >
        <IssuesPanel {...props} />
      </div>
      {hasMore && (
        <div style={{
          position: "absolute", left: 0, right: 0, bottom: 0, height: 40,
          background: `linear-gradient(to bottom, transparent, ${T.bgAlt} 85%)`,
          pointerEvents: "none", display: "flex", alignItems: "flex-end", justifyContent: "center",
        }}>
          <span style={{
            fontSize: 10, fontWeight: 600, color: T.textSec, background: T.bg,
            border: `1px solid ${T.border}`, borderRadius: 99, padding: "2px 10px",
            marginBottom: 4, boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
          }}>
            ▾ more issues
          </span>
        </div>
      )}
    </div>
  );
}

// ─── Left sidebar: timeline + issues stacked ──────────────────────────────────
// // Timeline feature removed — Issues now renders in the right column,
// stacked above Reviewer Notes (AnnotationsSidebar), instead of as a
// left-hand sidebar with its own dated timeline underneath.
function IssuesPanel({ abnormals, discFlags, findings, findingsStatus, abnormalIdx, onAbnormalNav, onFindingNav }) {
    const critFlags = discFlags.filter(f=>f.type==="critical");
  const warnFlags = discFlags.filter(f=>f.type==="warning");
  const totalIssues = abnormals.length + discFlags.length + (findings?.length || 0);

  return (
    <div style={{ flexShrink: 0, borderBottom: `1px solid ${T.border}`, background: T.bgAlt }}>
      <div style={{ padding: "10px 12px 6px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, color: T.textMuted }}>
        Issues
      </div>

      {totalIssues === 0 ? (
        findingsStatus === "error" ? (
          <div style={{ padding: "6px 12px 10px", fontSize: 11, color: T.redText }}>
            ⚠ Findings check failed to run — use "Re-check flags" above to retry.
          </div>
        ) : (
          <div style={{ padding: "6px 12px 10px", fontSize: 11, color: T.greenText }}>
            No issues detected
          </div>
        )
      ) : (
        <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
          {(findings || []).map((f) => {
            const st = findingStyle(f);
            const locs = (f.quotes || []).map(q => q.page_number ? `p.${q.page_number}` : q.file_name).filter(Boolean);
            const locLabel = locs.length ? [...new Set(locs)].join(" ↔ ") : null;
            const clickable = (f.quotes || []).length > 0;
            return (
              <div
                key={f.id}
                onClick={() => onFindingNav?.(f.id)}
                style={{
                  background: `color-mix(in srgb, ${st.color} 10%, var(--bg))`,
                  border: `0.5px solid color-mix(in srgb, ${st.color} 40%, var(--bg))`,
                  borderRadius: 5, padding: "5px 8px",
                  cursor: clickable ? "pointer" : "default",
                }}
              >
                <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.05em", color: st.color, marginBottom: 1 }}>
                  ⚑ {st.label}{locLabel ? ` · ${locLabel}` : ""}
                </div>
                <div style={{ fontSize: 10.5, color: st.color, lineHeight: 1.35, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical" }}>
                  {f.explanation}
                </div>
              </div>
            );
          })}

          {Object.entries(
            abnormals.reduce((acc,a)=>{ if(!acc[a.label])acc[a.label]=[];acc[a.label].push(a);return acc; },{})
          ).map(([label,items],i) => (
            <div
              key={label}
              onClick={() => onAbnormalNav(i)}
              style={{
                background: T.redBg, border: `0.5px solid ${T.redBorder}`,
                borderRadius: 5, padding: "6px 9px",
                cursor: "pointer",
                outline: i===abnormalIdx ? `2px solid ${T.red}` : "none",
                outlineOffset: 1,
              }}
            >
              <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.06em", color: T.red, marginBottom: 1 }}>{label}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: T.redText, lineHeight: 1.2 }}>{items[0].match}</div>
              <div style={{ fontSize: 9, color: T.red, opacity: 0.75, marginTop: 1 }}>Normal: {items[0].normal}</div>
            </div>
          ))}

          {[...critFlags,...warnFlags].map((f,i) => {
            const c = f.type==="critical";
            return (
              <div key={i} style={{
                background: c?T.redBg:T.amberBg,
                border: `0.5px solid ${c?T.redBorder:T.amberBorder}`,
                borderRadius: 5, padding: "5px 8px",
                display: "flex", gap: 5, alignItems: "flex-start",
              }}>
                <span style={{ fontSize: 9, color: c?T.redText:T.amberText, flexShrink:0, paddingTop:1 }}>{c?"✕":"⚠"}</span>
                <span style={{ fontSize: 10, color: c?T.redText:T.amberText, lineHeight: 1.4 }}>
                  {f.text.replace(/^\[.*?\]\s*/,"").slice(0,70)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
// ─── Main ──────────────────────────────────────────────────────────────────────
export default function RawDocument({ markdown, pass1, externalAnnotationContext, onOpenSource, topContent, findings, findingsStatus, findingsError, onRegenerateFindings }) {
        const [search, setSearch]           = useState("");
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError]     = useState(null);
  const handleRegenerateFindings = useCallback(async () => {
    if (!onRegenerateFindings || regenLoading) return;
    setRegenLoading(true);
    setRegenError(null);
    try {
      await onRegenerateFindings();
    } catch (e) {
      setRegenError(e?.message || "Failed to re-run findings.");
    } finally {
      setRegenLoading(false);
    }
  }, [onRegenerateFindings, regenLoading]);
  const [searchIdx, setSearchIdx]     = useState(0);
  const [abnormalIdx, setAbnormalIdx] = useState(0);
  const [activeFindingId, setActiveFindingId] = useState(null);
  const [activeMode, setActiveMode]   = useState(null);
  // Default sort mode is the grouped clinical-priority view
  // (Member visit → Hospital visit/ICP → Identity & Policy → Bills/Registers → Other).
const [sortOrder, setSortOrder] = useState("grouped");
  const [activeBlockIndex, setActiveBlockIndex] = useState(null);
  const [fontScale, setFontScale] = useState(1); // 1 = 100%
const FONT_STEP = 0.1, FONT_MIN = 0.7, FONT_MAX = 1.5;
const decreaseFont = useCallback(() => {
  setFontScale(s => Math.max(FONT_MIN, +(s - FONT_STEP).toFixed(2)));
}, []);
const increaseFont = useCallback(() => {
  setFontScale(s => Math.min(FONT_MAX, +(s + FONT_STEP).toFixed(2)));
}, []);
  const containerRef = useRef(null);
  const blockRefs    = useRef({});
  // FIX 3: track a scroll "trigger" counter so scrolling fires even when searchIdx stays 0
  const scrollTrigger = useRef(0);

  const blocks = useMemo(() => splitAndAnnotate(markdown || "", findings || []), [markdown, findings]);

  const findingsById = useMemo(() => {
    const map = {};
    for (const f of (findings || [])) map[f.id] = f;
    return map;
  }, [findings]);

  const sortedBlocks = useMemo(() => {
  if (sortOrder === "original") {
    return blocks; // already in PDF/page order from splitAndAnnotate
  }
  if (sortOrder === "grouped") {
    const buckets = Object.fromEntries(CATEGORY_ORDER.map(c => [c, []]));
    for (const b of blocks) {
      const cat = b.type.category || "other";
      (buckets[cat] || buckets.other).push(b);
    }
    return CATEGORY_ORDER.flatMap(cat => buckets[cat]);
  }
  const dated = blocks.filter(b=>b.date!==null);
  const undated = blocks.filter(b=>b.date===null);
  return [...[...dated].sort((a,b)=>sortOrder==="asc"?a.date-b.date:b.date-a.date), ...undated];
}, [blocks, sortOrder]);

  const abnormals = useMemo(() => {
    const r=[];
    for(const{pattern,check,label,normal}of ABNORMAL_PATTERNS){
      pattern.lastIndex=0; let m;
      while((m=pattern.exec(markdown||""))!==null){const g=m.slice(1);if(check(m[0],...g))r.push({match:m[0],label,normal});}
    }
    return r;
  }, [markdown]);

  const discFlags = useMemo(() => extractDiscrepancyFlags(markdown||"",pass1), [markdown,pass1]);

  const searchHitCount = useMemo(() => {
    if (!search.trim()) return 0;
    const esc = search.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
    return (sortedBlocks.map(b=>b.text).join("\n").match(new RegExp(esc,"gi"))||[]).length;
  }, [sortedBlocks, search]);

  // FIX 3: reset to 0 and bump trigger when search changes
  useEffect(() => {
    setSearchIdx(0);
    scrollTrigger.current += 1;
    if(search.trim()) setActiveMode("search");
    else setActiveMode(null);
  }, [search]);

  // FIX 3: scroll to active hit — depends on searchIdx AND scrollTrigger so it always fires
  const scrollVersion = useRef(0);
  useEffect(() => {
    if(activeMode!=="search"||!search.trim())return;
    // small delay to let cards expand first (FIX 2 sets expanded, DOM updates next render)
    const id = setTimeout(() => {
      containerRef.current?.querySelector(`#search-hit-${searchIdx}`)?.scrollIntoView({behavior:"smooth",block:"center"});
    }, 50);
    return () => clearTimeout(id);
  }, [searchIdx, activeMode, search, scrollTrigger.current]);

  useEffect(() => {
    if(activeMode!=="abnormal")return;
    const marks = containerRef.current?.querySelectorAll("[data-abnormal='true']");
    if(!marks?.length)return;
    const target = marks[abnormalIdx];
    if(target){
      target.scrollIntoView({behavior:"smooth",block:"center"});
      target.style.outline="2px solid var(--red)"; target.style.outlineOffset="2px";
      setTimeout(()=>{target.style.outline="";target.style.outlineOffset="";},1200);
    }
  }, [abnormalIdx, activeMode]);

  // ── Finding nav: scroll to & flash the matching <mark data-finding-id> ──
  useEffect(() => {
    if (activeMode !== "finding" || !activeFindingId) return;
    const target = containerRef.current?.querySelector(`[data-finding-id="${activeFindingId}"]`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      const prevOutline = target.style.outline, prevOffset = target.style.outlineOffset;
      target.style.outline = "2px solid var(--red)";
      target.style.outlineOffset = "2px";
      setTimeout(() => { target.style.outline = prevOutline; target.style.outlineOffset = prevOffset; }, 1200);
    }
  }, [activeFindingId, activeMode]);

  const goSearch = useCallback((dir) => {
    setActiveMode("search");
    setSearchIdx(p => { const n=p+dir; return n<0?searchHitCount-1:n>=searchHitCount?0:n; });
  }, [searchHitCount]);

  const goAbnormal = useCallback((dir) => {
    setActiveMode("abnormal");
    setAbnormalIdx(p => { const n=p+dir; return n<0?abnormals.length-1:n>=abnormals.length?0:n; });
  }, [abnormals.length]);

  const handleTimelineSelect = useCallback((idx) => {
    setActiveBlockIndex(idx);
    blockRefs.current[idx]?.scrollIntoView({behavior:"smooth",block:"start"});
  }, []);

  if (!markdown) return (
    <div style={{ padding:40, textAlign:"center", fontSize:12, color:T.textMuted }}>No raw document available.</div>
  );

  const content = (
    <>
      <style>{`
        .raw-doc-wrap table{width:100%;border-collapse:collapse;margin:10px 0;font-size:11px}
        .raw-doc-wrap th{background:var(--bg2, var(--bg3, #f3f2ef));text-align:left;padding:5px 8px;border:0.5px solid var(--border);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted)}
        .raw-doc-wrap td{padding:4px 8px;border:0.5px solid var(--border);vertical-align:top}
        .raw-doc-wrap tr:nth-child(even) td{background:var(--bg3, #f9f9f8)}
        [data-ann-highlight]{cursor:pointer;transition:filter 0.15s}
        [data-ann-highlight]:hover{filter:brightness(0.94)}
        .raw-doc-wrap h1{font-size:13px;font-weight:600;margin:16px 0 4px;color:var(--text);padding-bottom:4px;border-bottom:0.5px solid var(--border)}
        .raw-doc-wrap h2{font-size:12px;font-weight:600;margin:12px 0 4px;color:var(--text)}
        .raw-doc-wrap h3{font-size:11px;font-weight:600;margin:10px 0 3px;color:var(--text)}
        .raw-doc-wrap strong{font-weight:600;color:var(--text)}
        .raw-doc-wrap code{font-family:monospace;font-size:10px;background:var(--bg2, var(--bg3, #f3f2ef));padding:1px 3px;border-radius:3px}
        .raw-doc-wrap hr{border:none;border-top:0.5px solid var(--border);margin:10px 0}
        .raw-doc-wrap li{margin:2px 0 2px 16px;line-height:1.6}
        .raw-doc-wrap .kv-row{display:grid;grid-template-columns:160px 1fr;gap:4px 10px;padding:4px 0;border-bottom:0.5px solid var(--border);align-items:baseline}
        .raw-doc-wrap .pill-yes{display:inline-block;padding:1px 8px;border-radius:99px;background:color-mix(in srgb, var(--green) 14%, var(--bg));color:var(--green);border:0.5px solid color-mix(in srgb, var(--green) 40%, var(--bg));font-size:10px;font-weight:700}
        .raw-doc-wrap .kv-row:last-child{border-bottom:none}
        .raw-doc-wrap .kv-sub{grid-template-columns:140px 1fr;padding-left:14px;opacity:0.85}
        .raw-doc-wrap .kv-plain{padding:3px 0}
        .raw-doc-wrap .kv-key{font-size:10px;font-weight:600;color:var(--muted);line-height:1.5}
        .raw-doc-wrap .kv-val{font-size:11px;color:var(--text);line-height:1.6}
        .raw-doc-wrap .kv-empty{color:var(--muted);font-style:italic}
        .raw-doc-wrap .pill-no{display:inline-block;padding:1px 8px;border-radius:99px;background:color-mix(in srgb, var(--red) 14%, var(--bg));color:var(--red);border:0.5px solid color-mix(in srgb, var(--red) 40%, var(--bg));font-size:10px;font-weight:700}
.raw-doc-wrap .pill-neutral{display:inline-block;padding:1px 8px;border-radius:99px;background:var(--bg2, var(--bg3, #f3f2ef));color:var(--muted);border:0.5px solid var(--border);font-size:10px;font-weight:700}
.raw-doc-wrap .kv-d2{padding-left:28px;opacity:0.8}
.raw-doc-wrap .kv-d3{padding-left:42px;opacity:0.75}
.raw-doc-wrap .kv-d4{padding-left:56px;opacity:0.7}
        .raw-doc-wrap .pill-selected{display:inline-block;padding:1px 8px;border-radius:99px;background:color-mix(in srgb, var(--blue) 14%, var(--bg));color:var(--blue);border:0.5px solid color-mix(in srgb, var(--blue) 40%, var(--bg));font-size:10px;font-weight:600}
        .raw-doc-wrap .pill-unselected{display:inline-block;padding:1px 7px;border-radius:99px;background:var(--bg3, #f9f9f8);color:var(--muted);border:0.5px solid var(--border);font-size:10px;text-decoration:line-through}
        .raw-doc-wrap .pill-blank{color:var(--muted);font-size:11px}
        .raw-doc-wrap .bill-table-wrap{margin:10px 0}
        .raw-doc-wrap .bill-table-label{font-size:9.5px;text-transform:uppercase;letter-spacing:0.06em;color:var(--muted);margin-bottom:4px;font-weight:600}
        .raw-doc-wrap table.bill-table{width:100%;border-collapse:collapse;font-size:11px}
        .raw-doc-wrap table.bill-table th{background:var(--bg2, var(--bg3, #f3f2ef));padding:4px 8px;text-align:left;font-size:9.5px;text-transform:uppercase;letter-spacing:0.05em;color:var(--muted);border:0.5px solid var(--border)}
        .raw-doc-wrap table.bill-table td{padding:3px 8px;border:0.5px solid var(--border)}
        .raw-doc-wrap table.bill-table tr:nth-child(even) td{background:var(--bg3, #f9f9f8)}
        .raw-doc-wrap table.med-table td{font-size:10.5px}
        .raw-doc-wrap .episode-header{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin:12px 0 6px;padding:7px 12px;border-radius:6px;background:color-mix(in srgb, var(--blue) 9%, var(--bg));border-left:3px solid var(--blue)}
        .raw-doc-wrap .ep-badge{font-size:9.5px;font-weight:700;padding:2px 8px;border-radius:99px;background:var(--blue);color:#fff;letter-spacing:0.04em;white-space:nowrap}
        .raw-doc-wrap .ep-hospital{font-size:12px;font-weight:600;color:var(--text);flex:1;min-width:120px}
        .raw-doc-wrap .ep-dates{font-size:10.5px;color:var(--muted);white-space:nowrap}
        .raw-doc-wrap .ep-outcome{font-size:9.5px;font-weight:700;padding:2px 9px;border-radius:99px;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap}
        .raw-doc-wrap .ep-outcome-green{background:color-mix(in srgb, var(--green) 14%, var(--bg));color:var(--green)}
        .raw-doc-wrap .ep-outcome-red{background:color-mix(in srgb, var(--red) 14%, var(--bg));color:var(--red)}
        .raw-doc-wrap .ep-outcome-amber{background:color-mix(in srgb, var(--amber) 14%, var(--bg));color:var(--amber)}
        .raw-doc-wrap .ep-outcome-blue{background:color-mix(in srgb, var(--blue) 14%, var(--bg));color:var(--blue)}
        .raw-doc-wrap .ep-outcome-neutral{background:var(--bg2, var(--bg3, #f3f2ef));color:var(--muted)}        .empty-table-badge        .sparse-table-details{margin:8px 0;border-radius:6px;overflow:hidden;border:0.5px solid color-mix(in srgb, var(--amber) 45%, var(--bg))}
        .sparse-table-summary{cursor:pointer;list-style:none;display:flex;align-items:center;gap:6px;padding:6px 12px;background:color-mix(in srgb, var(--amber) 10%, var(--bg));font-size:11px;color:var(--amber)}
        .sparse-table-summary::-webkit-details-marker{display:none}
        .sparse-table-details[open] .sparse-table-summary{border-bottom:0.5px solid color-mix(in srgb, var(--amber) 45%, var(--bg))}
        .sparse-table-details table{margin:0}
        .sparse-preview{font-family:monospace;font-size:10px;opacity:0.8;margin-left:2px}
        .eti{font-size:13px;opacity:0.45}
        mark.abnormal{background:color-mix(in srgb, var(--red) 14%, var(--bg));color:var(--red);border-bottom:2px solid var(--red);border-radius:2px;padding:0 2px;font-weight:600}
        mark.finding-mark{cursor:pointer;transition:filter 0.15s}
        mark.finding-mark:hover{filter:brightness(0.92)}
        mark.search-hit{background:color-mix(in srgb, var(--amber) 18%, var(--bg));color:var(--amber);border-radius:2px;padding:0 1px}
        mark.search-active{background:var(--amber);color:#fff;border-radius:2px;padding:0 1px}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>

      {/* ── Single toolbar row ──────────────────────────────────────── */}
      {/* ── Single toolbar row ──────────────────────────────────────── */}
<div style={{
  position:"sticky", top:0, zIndex:20,
  background:T.bg, borderBottom:`1px solid ${T.border}`,
  padding:"7px 12px",
  display:"flex", alignItems:"center", gap:7, flexShrink:0,
}}>
  <div style={{ position:"relative", width:200 }}>
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={T.textMuted} strokeWidth="2"
      style={{ position:"absolute", left:9, top:"50%", transform:"translateY(-50%)", pointerEvents:"none" }}>
      <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
    </svg>
    <input
      type="text" placeholder="Search…" value={search}
      onChange={e=>setSearch(e.target.value)}
      onKeyDown={e=>{if(e.key==="Enter")goSearch(e.shiftKey?-1:1);}}
      style={{
        width:"100%", paddingLeft:28, paddingRight:8, paddingTop:5, paddingBottom:5,
        border:`1px solid ${T.border}`, borderRadius:20,
        fontSize:12, fontFamily:"inherit", color:T.text, background:T.bgAlt,
        outline:"none", boxSizing:"border-box",
      }}
      onFocus={e=>e.target.style.borderColor="var(--muted)"}
      onBlur={e=>e.target.style.borderColor=T.border}
    />
  </div>

  {search.trim() && (
    <div style={{ display:"flex", alignItems:"center", gap:3, flexShrink:0 }}>
      <span style={{ fontSize:11, color:searchHitCount>0?T.textSec:T.textMuted, minWidth:44 }}>
        {searchHitCount>0?`${searchIdx+1}/${searchHitCount}`:"0 found"}
      </span>
      <button onClick={()=>goSearch(-1)} disabled={searchHitCount===0} style={navBtnStyle(false)}>▲</button>
      <button onClick={()=>goSearch(1)}  disabled={searchHitCount===0} style={navBtnStyle(false)}>▼</button>
    </div>
  )}

  <span style={{ flex:1 }} />
<select value={sortOrder} onChange={e=>setSortOrder(e.target.value)} style={{
    width: 92,
    padding:"4px 6px", border:`1px solid ${T.border}`, background:T.bg, color:T.textSec,
    fontSize:11, cursor:"pointer", borderRadius:4, fontFamily:"inherit", outline:"none",
  }}>
    <option value="original">Original</option>
    <option value="grouped">Grouped</option>
    <option value="asc">Oldest</option>
    <option value="desc">Newest</option>
  </select>

  {onRegenerateFindings && (
    <button
      onClick={handleRegenerateFindings}
      disabled={regenLoading}
      title="Re-run suspicious-finding detection over the documents already uploaded for this case"
      style={{
        display:"flex", alignItems:"center", gap:5,
        padding:"4px 10px", border:`1px solid ${T.border}`, borderRadius:20,
        background:T.bg, color:T.textSec, fontSize:11, fontWeight:600,
        cursor: regenLoading ? "default" : "pointer", whiteSpace:"nowrap",
      }}
    >
      <span style={{ display:"inline-block", animation: regenLoading ? "spin 0.8s linear infinite" : "none" }}>↻</span>
      {regenLoading ? "Checking…" : "Re-check flags"}
    </button>
  )}
  {regenError && (
    <span style={{ fontSize:10, color:T.red }} title={regenError}>⚠ retry failed</span>
  )}
  {!regenError && findingsStatus === "error" && (
    <span style={{ fontSize:10, color:T.red }} title={findingsError || "Findings generation failed on last run"}>
      ⚠ last findings check failed
    </span>
  )}
  <div style={{ display:"flex", alignItems:"center", gap:2, flexShrink:0 }}>
    <button onClick={decreaseFont} disabled={fontScale<=FONT_MIN} title="Decrease font size" style={navBtnStyle(false)}>A−</button>
    <span style={{ fontSize:10, color:T.textMuted, minWidth:32, textAlign:"center" }}>{Math.round(fontScale*100)}%</span>
    <button onClick={increaseFont} disabled={fontScale>=FONT_MAX} title="Increase font size" style={navBtnStyle(false)}>A+</button>
  </div>
</div>
      {/* ── Body ───────────────────────────────────────────────────── */}
      <div style={{ display:"flex", flex:1, minHeight:0, overflow:"hidden" }}>
<div ref={containerRef} className="raw-doc-wrap" style={{ flex:1, overflowY:"auto", padding:"10px 12px", minWidth:0, zoom: fontScale }}>
              {topContent && (
    <div style={{ marginBottom: 12, borderBottom: `1px solid ${T.border}`, paddingBottom: 12 }}>
      {topContent}
    </div>
  )}
  
            {(() => {
            let lastCategory = null;
            return sortedBlocks.map((block, i) => {
              const prevText = sortedBlocks.slice(0,i).map(b=>b.text).join("\n");
              const esc = search.replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
              const offset = search.trim()?(prevText.match(new RegExp(esc,"gi"))||[]).length:0;

              const cat = block.type.category || "other";
              const showDivider = sortOrder === "grouped" && cat !== lastCategory;
              if (showDivider) {
                lastCategory = cat;
              }
              const catCount = sortOrder === "grouped"
                ? sortedBlocks.filter(b => (b.type.category || "other") === cat).length
                : 0;

              return (
                <React.Fragment key={`${block.index}-${i}`}>
                  {showDivider && <CategoryDivider category={cat} count={catCount} />}
                  <DocCard
  block={block}
  search={search}
  searchActiveIdx={searchIdx}
  globalSearchOffset={offset}
  blockRef={el=>{ blockRefs.current[block.index]=el; }}
  onOpenSource={onOpenSource}
  findingsById={findingsById}
/>
                </React.Fragment>
              );
            });
          })()}
          <div style={{ height:40 }} />
        </div>

        {/* Right column: Issues on top, Reviewer Notes underneath — the
            left "Documents"-panel timeline sidebar is gone; Issues moved
            here instead. */}
        <div style={{ display: "flex", flexDirection: "column", width: 320, flexShrink: 0, borderLeft: `1px solid ${T.border}`, overflow: "hidden" }}>
          <IssuesPanelScrollWrap
            abnormals={abnormals}
            discFlags={discFlags}
            findings={findings || []}
            findingsStatus={findingsStatus}
            abnormalIdx={abnormalIdx}
            onAbnormalNav={(i) => { setAbnormalIdx(i); setActiveMode("abnormal"); goAbnormal(0); }}
            onFindingNav={(id) => { setActiveFindingId(id); setActiveMode("finding"); }}
          />
          <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
            <AnnotationsSidebar
              docLabels={Object.fromEntries(
                sortedBlocks.map(b => [
                  b.index,
                  b.pageRange ? `${b.type.label} (${b.pageRange})` : b.type.label,
                ])
              )}
            />
          </div>
        </div>
      </div>
    </>
  );

  if (externalAnnotationContext) {
    return (
      <AnnotationContext.Provider value={externalAnnotationContext}>
        <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>{content}</div>
      </AnnotationContext.Provider>
    );
  }
  return (
    <AnnotationProvider>
      <div style={{ display:"flex", flexDirection:"column", height:"100%", overflow:"hidden" }}>{content}</div>
    </AnnotationProvider>
  );
}

function navBtnStyle(danger) {
  return {
    width:24, height:24,
    border:`1px solid ${danger?"color-mix(in srgb, var(--red) 35%, var(--bg))":"var(--border)"}`,
    background: danger?"color-mix(in srgb, var(--red) 10%, var(--bg))":"var(--bg)",
    color: danger?"var(--red)":"var(--muted)",
    borderRadius:4, cursor:"pointer", fontSize:10,
    display:"flex", alignItems:"center", justifyContent:"center",
  };
}