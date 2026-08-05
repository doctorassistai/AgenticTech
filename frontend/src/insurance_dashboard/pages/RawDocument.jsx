import React, { useState, useMemo, useEffect, useRef, useCallback } from "react";
import { AnnotationProvider, AnnotationContext } from "./AnnotationContext";
import AnnotatableContent from "./AnnotatableContent";
import AnnotationsSidebar from "./AnnotationsSidebar";

const T = {
  bg: "#ffffff", bgAlt: "#f9f9f8", bgTert: "#f3f2ef",
  text: "#111111", textSec: "#555550", textMuted: "#999994",
  border: "rgba(0,0,0,0.09)", borderMed: "rgba(0,0,0,0.15)",
  red: "#a32d2d", redBg: "#fcebeb", redBorder: "#f7c1c1", redText: "#791f1f",
  amber: "#854f0b", amberBg: "#faeeda", amberBorder: "#fac775", amberText: "#633806",
  blue: "#185fa5", blueBg: "#e6f1fb", blueBorder: "#b5d4f4", blueText: "#0c447c",
  green: "#3b6d11", greenBg: "#eaf3de", greenBorder: "#c0dd97", greenText: "#27500a",
  teal: "#0f6e56", tealBg: "#e1f5ee",
  purple: "#534ab7", purpleBg: "#eeedfe",
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

function bareCheckboxLeaf(line) {
  const normalized = normalizeDualBrackets(line.trim());
  const m = normalized.match(/^([\w][\w\s\/\-]{0,40}?)\s*[\[\(]\s*([xX✓ ]?)\s*[\]\)]$/);
  if (!m) return null;
  return { label: m[1].trim(), checked: m[2].trim().length > 0 };
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
        const resolved = resolveCheckboxes(item.content);
        html += `<div class="kv-plain">${resolved}</div>`;
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

function collapseEmptyTables(html) {
  return html.replace(/<table[\s\S]*?<\/table>/gi, (t) => {
    const tds = [...t.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map(m => m[1].replace(/&nbsp;/g,"").replace(/<[^>]+>/g,"").replace(/\s/g,""));
    const nonEmpty = tds.filter(c => c.length > 0);
    const ratio = nonEmpty.length / Math.max(tds.length, 1);
    const rows = (t.match(/<tr/gi)||[]).length;
    if ((ratio < 0.12 && tds.length > 4) || (rows > 6 && ratio < 0.25)) {
      if (nonEmpty.length > 0 && nonEmpty.length <= 6)
        return `<div class="sparse-table-badge"><span class="eti">⊟</span> Partial data: <span class="sparse-preview">${nonEmpty.slice(0,4).join(" · ")}</span></div>`;
      return `<div class="empty-table-badge"><span class="eti">⊘</span> No data recorded</div>`;
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
const NEUTRAL_TYPE = { color: "#5f5e5a", bg: T.bgTert, border: T.border, text: "#3a3a38" };

// ─── Category priority for the grouped-view sort mode ─────────────────────────
// Member/Insured visit → Hospital visit/ICP → Identity & Policy → Bills/Registers → Other
const CATEGORY_ORDER = [
  "identity_policy",
  "member_visit",
  "hospital_visit",
  "bills_registers",
  "other",
];

const CATEGORY_LABELS = {
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

function inferDocType(text) {
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

function splitAndAnnotate(markdown = "") {
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
});
    });
    return allBlocks;
  }

  // Marker-based path: split into PDFs first, then sub-split each PDF
  // by the same heading heuristics as before — but now each piece keeps
  // its source filename + the page range it actually came from.
  // Marker-based path: split into PDFs first, then sub-split each PDF
  // by the same heading heuristics as before — but now each piece keeps
  // its source filename + the page range it actually came from.
  for (const m of pdfMatches) {
  const fileName = m[1].trim();
  const rawContent = m[2];
  const pages = extractPages(rawContent);

  pages.forEach(({ pageNumber, text: rawPageText }) => {
    const text = stripMarkers(rawPageText);
    if (text.length <= 20) return;
    allBlocks.push({
      text, fileName, pageNumber,
      date: extractEarliestDate(text), type: inferDocType(text),
      index: idx++, abnormals: extractAbnormalsFromText(text), flags: extractFlagsFromText(text),
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
    allBlocks.push({
      text: body, fileName, pageNumber: null,
      date: extractEarliestDate(body), type: inferDocType(body),
      index: idx++, abnormals: extractAbnormalsFromText(body), flags: extractFlagsFromText(body),
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
function DocCard({ block, search, searchActiveIdx, globalSearchOffset, blockRef, onOpenSource }) {
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
    let html = parseMarkdown(block.text);
    html = collapseEmptyTables(html);
    html = applyAbnormalHighlights(html);
    html = applySearchHighlight(html, search, searchActiveIdx - globalSearchOffset);
    return html;
  }, [block.text, search, searchActiveIdx, globalSearchOffset]);

  const critCount = block.flags.filter(f=>f.type==="critical").length;
  const warnCount = block.flags.filter(f=>f.type==="warning").length;
  const hasIssues = block.flags.length > 0 || block.abnormals.length > 0;

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
      fontSize: 10, fontWeight: 600, color: T.textSec,
      whiteSpace: "nowrap", padding: "2px 8px", borderRadius: 99,
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
        </div>
      )}

      {/* Expanded content */}
      {expanded && (
        <div style={{ padding: "12px 14px", borderTop: `1px solid ${T.border}` }}>
          <AnnotatableContent html={renderedHtml} blockIndex={block.index} />
        </div>
      )}
    </div>
  );
}

// ─── Category divider — shown above the first card of each category in
//     grouped mode so a reviewer can see where one group ends and the next
//     begins, without changing card markup itself. ─────────────────────────
function CategoryDivider({ category, count }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 8,
      margin: "14px 0 6px", padding: "0 2px",
    }}>
      <span style={{
        fontSize: 10, fontWeight: 700, letterSpacing: "0.08em",
        textTransform: "uppercase", color: T.textMuted, whiteSpace: "nowrap",
      }}>
        {CATEGORY_LABELS[category] || category}
      </span>
      <span style={{
        fontSize: 9, color: T.textMuted, background: T.bgTert,
        borderRadius: 99, padding: "1px 6px", flexShrink: 0,
      }}>
        {count}
      </span>
      <span style={{ flex: 1, height: 1, background: T.border }} />
    </div>
  );
}

// ─── Left sidebar: timeline + issues stacked ──────────────────────────────────
function LeftSidebar({ blocks, activeIndex, onTimelineSelect, abnormals, discFlags, abnormalIdx, onAbnormalNav }) {
  const dated   = blocks.filter(b => b.date !== null);
  const sorted  = [...dated].sort((a,b) => a.date - b.date);
  const critFlags = discFlags.filter(f=>f.type==="critical");
  const warnFlags = discFlags.filter(f=>f.type==="warning");
  const totalIssues = abnormals.length + discFlags.length;

  return (
    <div style={{
      width: 176, flexShrink: 0,
      borderRight: `1px solid ${T.border}`,
      background: T.bgAlt,
      display: "flex", flexDirection: "column",
      overflowY: "auto",
    }}>

      {/* ── Issues ── */}
      <div style={{ flexShrink: 0, borderBottom: `1px solid ${T.border}` }}>
        <div style={{ padding: "10px 12px 6px", fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, color: T.textMuted }}>
          Issues
        </div>

        {totalIssues === 0 ? (
          <div style={{ padding: "6px 12px 10px", fontSize: 11, color: T.greenText }}>
            No issues detected
          </div>
        ) : (
          <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 5 }}>
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

      {/* ── Timeline ── */}
      {sorted.length > 0 && (
        <div style={{ flex: 1, overflowY: "auto", paddingTop: 10 }}>
          <div style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 600, color: T.textMuted, padding: "0 12px 8px" }}>
            Timeline
          </div>
          {sorted.map((block, i) => {
            const isActive = block.index === activeIndex;
            const hasCrit  = block.flags.some(f=>f.type==="critical")||block.abnormals.length>0;
            const hasWarn  = block.flags.some(f=>f.type==="warning");
            return (
              <div key={block.index} onClick={() => onTimelineSelect(block.index)} style={{ display:"flex", cursor:"pointer" }}>
                <div style={{ width: 26, display:"flex", flexDirection:"column", alignItems:"center", flexShrink:0 }}>
                  <div style={{ width:1, flex: i===0?"0 0 12px":1, background: i===0?"transparent":T.border, minHeight: i===0?12:0 }} />
                  <div style={{ width: isActive?8:6, height: isActive?8:6, borderRadius:"50%", background: isActive?T.text:hasCrit?T.red:hasWarn?T.amber:T.borderMed, border:`1.5px solid ${isActive?T.text:hasCrit?T.red:hasWarn?T.amber:T.borderMed}`, flexShrink:0, zIndex:1, transition:"all 0.15s" }} />
                  <div style={{ width:1, flex: i===sorted.length-1?"0 0 12px":1, background: i===sorted.length-1?"transparent":T.border, minHeight: i===sorted.length-1?12:0 }} />
                </div>
                <div style={{ flex:1, padding:"6px 10px 6px 4px", background: isActive?T.bg:"transparent", borderLeft:`2px solid ${isActive?T.borderMed:"transparent"}` }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: isActive?T.text:T.textSec, lineHeight:1.3, marginBottom:2 }}>{block.type.label}</div>
                  <div style={{ fontSize: 9, color: T.textMuted, fontFamily:"monospace" }}>{fmtDate(block.date)}</div>
                  {(hasCrit||hasWarn) && (
                    <div style={{ marginTop:2, fontSize:9, color: hasCrit?T.redText:T.amberText }}>
                      {hasCrit?`✕ ${block.flags.filter(f=>f.type==="critical").length+block.abnormals.length} critical`:`⚠ ${block.flags.filter(f=>f.type==="warning").length} warn`}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {blocks.filter(b=>!b.date).length > 0 && (
            <div style={{ padding:"8px 12px", fontSize:9, color:T.textMuted, borderTop:`1px solid ${T.border}`, marginTop:4 }}>
              +{blocks.filter(b=>!b.date).length} undated
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function RawDocument({ markdown, pass1, externalAnnotationContext, onOpenSource, topContent }) {
      const [search, setSearch]           = useState("");
  const [searchIdx, setSearchIdx]     = useState(0);
  const [abnormalIdx, setAbnormalIdx] = useState(0);
  const [activeMode, setActiveMode]   = useState(null);
  // Default sort mode is now the grouped clinical-priority view
  // (Member visit → Hospital visit/ICP → Identity & Policy → Bills/Registers → Other),
  // replacing the previous raw "original" document order.
const [sortOrder, setSortOrder] = useState("original"); // was "grouped"
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

  const blocks = useMemo(() => splitAndAnnotate(markdown || ""), [markdown]);

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
      target.style.outline="2px solid #e24b4a"; target.style.outlineOffset="2px";
      setTimeout(()=>{target.style.outline="";target.style.outlineOffset="";},1200);
    }
  }, [abnormalIdx, activeMode]);

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
        .raw-doc-wrap th{background:#f3f2ef;text-align:left;padding:5px 8px;border:0.5px solid rgba(0,0,0,0.10);font-weight:600;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#444441}
        .raw-doc-wrap td{padding:4px 8px;border:0.5px solid rgba(0,0,0,0.10);vertical-align:top}
        .raw-doc-wrap tr:nth-child(even) td{background:#f9f9f8}
        [data-ann-highlight]{cursor:pointer;transition:filter 0.15s}
        [data-ann-highlight]:hover{filter:brightness(0.94)}
        .raw-doc-wrap h1{font-size:13px;font-weight:600;margin:16px 0 4px;color:#111;padding-bottom:4px;border-bottom:0.5px solid rgba(0,0,0,0.10)}
        .raw-doc-wrap h2{font-size:12px;font-weight:600;margin:12px 0 4px;color:#333}
        .raw-doc-wrap h3{font-size:11px;font-weight:600;margin:10px 0 3px;color:#444}
        .raw-doc-wrap strong{font-weight:600;color:#111}
        .raw-doc-wrap code{font-family:monospace;font-size:10px;background:#f3f2ef;padding:1px 3px;border-radius:3px}
        .raw-doc-wrap hr{border:none;border-top:0.5px solid rgba(0,0,0,0.10);margin:10px 0}
        .raw-doc-wrap li{margin:2px 0 2px 16px;line-height:1.6}
        .raw-doc-wrap .kv-row{display:grid;grid-template-columns:160px 1fr;gap:4px 10px;padding:4px 0;border-bottom:0.5px solid rgba(0,0,0,0.06);align-items:baseline}
        .raw-doc-wrap .pill-yes{display:inline-block;padding:1px 8px;border-radius:99px;background:#eaf3de;color:#27500a;border:0.5px solid #c0dd97;font-size:10px;font-weight:700}
        .raw-doc-wrap .kv-row:last-child{border-bottom:none}
        .raw-doc-wrap .kv-sub{grid-template-columns:140px 1fr;padding-left:14px;opacity:0.85}
        .raw-doc-wrap .kv-plain{padding:3px 0}
        .raw-doc-wrap .kv-key{font-size:10px;font-weight:600;color:#666660;line-height:1.5}
        .raw-doc-wrap .kv-val{font-size:11px;color:#111;line-height:1.6}
        .raw-doc-wrap .kv-empty{color:#bbb;font-style:italic}
        .raw-doc-wrap .pill-no{display:inline-block;padding:1px 8px;border-radius:99px;background:#fcebeb;color:#791f1f;border:0.5px solid #f7c1c1;font-size:10px;font-weight:700}
.raw-doc-wrap .pill-neutral{display:inline-block;padding:1px 8px;border-radius:99px;background:#f3f2ef;color:#666660;border:0.5px solid rgba(0,0,0,0.15);font-size:10px;font-weight:700}
.raw-doc-wrap .kv-d2{padding-left:28px;opacity:0.8}
.raw-doc-wrap .kv-d3{padding-left:42px;opacity:0.75}
.raw-doc-wrap .kv-d4{padding-left:56px;opacity:0.7}
        .raw-doc-wrap .pill-selected{display:inline-block;padding:1px 8px;border-radius:99px;background:#e6f1fb;color:#0c447c;border:0.5px solid #b5d4f4;font-size:10px;font-weight:600}
        .raw-doc-wrap .pill-unselected{display:inline-block;padding:1px 7px;border-radius:99px;background:#f9f9f8;color:#bbb;border:0.5px solid rgba(0,0,0,0.08);font-size:10px;text-decoration:line-through}
        .raw-doc-wrap .pill-blank{color:#bbb;font-size:11px}
        .empty-table-badge{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;margin:8px 0;border-radius:6px;background:#f3f2ef;border:0.5px solid rgba(0,0,0,0.10);font-size:11px;color:#888780}
        .sparse-table-badge{display:flex;align-items:center;gap:6px;padding:6px 12px;margin:8px 0;border-radius:6px;background:#fffbeb;border:0.5px solid #fac775;font-size:11px;color:#633806}
        .sparse-preview{font-family:monospace;font-size:10px;opacity:0.8;margin-left:2px}
        .eti{font-size:13px;opacity:0.45}
        mark.abnormal{background:#fcebeb;color:#791f1f;border-bottom:2px solid #e24b4a;border-radius:2px;padding:0 2px;font-weight:600}
        mark.search-hit{background:#faeeda;color:#633806;border-radius:2px;padding:0 1px}
        mark.search-active{background:#ef9f27;color:#fff;border-radius:2px;padding:0 1px}
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
      onFocus={e=>e.target.style.borderColor="#888"}
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

  <div style={{ display:"flex", alignItems:"center", gap:2, flexShrink:0 }}>
    <button onClick={decreaseFont} disabled={fontScale<=FONT_MIN} title="Decrease font size" style={navBtnStyle(false)}>A−</button>
    <span style={{ fontSize:10, color:T.textMuted, minWidth:32, textAlign:"center" }}>{Math.round(fontScale*100)}%</span>
    <button onClick={increaseFont} disabled={fontScale>=FONT_MAX} title="Increase font size" style={navBtnStyle(false)}>A+</button>
  </div>
</div>

      {/* ── Body ───────────────────────────────────────────────────── */}
      <div style={{ display:"flex", flex:1, minHeight:0, overflow:"hidden" }}>
        <LeftSidebar
          blocks={blocks}
          activeIndex={activeBlockIndex}
          onTimelineSelect={handleTimelineSelect}
          abnormals={abnormals}
          discFlags={discFlags}
          abnormalIdx={abnormalIdx}
          onAbnormalNav={(i) => { setAbnormalIdx(i); setActiveMode("abnormal"); goAbnormal(0); }}
        />

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
/>
                </React.Fragment>
              );
            });
          })()}
          <div style={{ height:40 }} />
        </div>

        <AnnotationsSidebar
  docLabels={Object.fromEntries(
    sortedBlocks.map(b => [
      b.index,
      b.pageRange ? `${b.type.label} (${b.pageRange})` : b.type.label,
    ])
  )}
/>
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
    border:`1px solid ${danger?"#f7c1c1":"rgba(0,0,0,0.09)"}`,
    background: danger?"#fcebeb":"#fff",
    color: danger?"#791f1f":"#555550",
    borderRadius:4, cursor:"pointer", fontSize:10,
    display:"flex", alignItems:"center", justifyContent:"center",
  };
}