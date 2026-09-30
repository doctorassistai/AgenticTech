// tabs/genomics/pgxDictation.js — Tab 16 dictation merge (speech → fields)
//
// The pure half of the Human Genomics dictation flow: one entry point that
// merges one chunk of the `POST /human-genomics/structure` response into the
// case-level human_genomics form. Pure functions only — no React, no state, no
// fetch — and next to the feature rather than in a model layer.
//
// Self-contained by design, per documentation/TRANSCRIBE_AUTOFILL.md: each
// dictation site copies the small block it needs and owns its own merge, so a
// rule can be changed for one form without silently changing another. This file
// therefore carries its own primitives rather than sharing them with Tab 15's
// merge, which is an unrelated track (a pathogen result belongs to a specimen;
// this one belongs to the patient). Where the two copies must still agree is the
// CONTRACT below, which the doc states once for the whole module.
//
// The filling rules that must not change:
//   • fill EMPTY fields only — nothing already on the form is overwritten;
//   • never clear a field, so a short or partial transcript is a safe no-op;
//   • enums snap to the control's canonical option list, or stay blank for a
//     manual pick — a <Select> never receives a value it cannot render;
//   • lists union-add and de-duplicate, never remove;
//   • a row is never filled twice in one pass, and a gene or allele the
//     dictation names twice never becomes two rows;
//   • DERIVED fields are computed HERE from the catalogue, never read from the
//     model — see the note below.
//
// WHY THIS TAB IS FILLED IN FOUR CHUNKS
// The tab is case-level and much the largest form in the module — consent, assay,
// QC, two row tables, G6PD and the report. One transcript describes all of it, so
// the strip fires one request per chunk (PGX_CHUNKS) with the same transcript and
// folds the four results in. Each request then carries only its own field guide
// and returns only its own section. The merge is fill-empty and idempotent, so a
// chunk that fails costs only its own section — retrying fills exactly what is
// missing.
//
// DERIVED FIELDS ARE NEVER DICTATED. The screen itself derives several fields
// from a catalogue when the user picks something, and a dictated row must end up
// identical to a hand-entered one, so the same derivations run here:
//   • a gene pulls the drugs it governs and its evidence level (geneDefaultsFor);
//   • a phenotype OFFERS the published action for those drugs (pgxGuidance), and
//     only when one action covers every drug on the row — "mixed" and "partial"
//     decline exactly as they do on manual entry;
//   • a known HLA risk allele pulls the drug and reaction it causes;
//   • a G6PD status offers the action for the affected drugs (g6pdGuidance).
// All four are fill-empty-only, so a dictated value is never overwritten by the
// catalogue's, and the prompt tells the model not to return them at all.

import {
  CPIC_EVIDENCE_LEVELS,
  CPIC_PHENOTYPES,
  GENOMIC_CONSENT_OPTIONS,
  GENOMICS_PLATFORMS,
  G6PD_AFFECTED_DRUGS,
  G6PD_STATUS_OPTIONS,
  HLA_PGX_ALLELES,
  HLA_RESOLUTION_OPTIONS,
  HLA_RESULT_OPTIONS,
  HLA_TYPING_METHODS,
  PGX_ASSAY_LIMITATIONS,
  PGX_DOSE_ACTIONS,
  PGX_GENES,
  PGX_GUIDELINE_SOURCES,
  PGX_METHODS,
  PGX_PANELS,
  PGX_RISK_CATEGORIES,
  PGX_SPECIMEN_TYPES,
  SEQUENCING_LABS,
} from "../../constants";
import { YES_NO } from "./fields";
import { g6pdGuidance, pgxGuidance } from "../../shared/pgxGuidance";
import { blankGeneResult, blankHlaResult, geneDefaultsFor } from "./pgxRecords";

// The catalogue's own values. A gene or allele only ever exists on a row as one
// of these, so a dictated name is snapped to the catalogue's spelling — a
// no-call gene that reads "cyp2d6" would silently fail to match the CYP2D6 row it
// is supposed to disable, and the gene would report as NORMAL.
const GENE_VALUES = PGX_GENES.map((g) => g.gene);
const HLA_ALLELE_VALUES = HLA_PGX_ALLELES.map((a) => a.allele);

// ─── Primitives ──────────────────────────────────────────────────────────────

const cleanText = (value) => (value === undefined || value === null ? "" : String(value).trim());

const canon = (s) => cleanText(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Snap free text to a real option (normalized exact match, then a contained-
// substring fallback). Returns "" when nothing matches, so a <Select> is left
// for a manual pick rather than given a value it cannot render.
const coerceEnum = (value, options) => {
  const target = canon(value);
  if (!target) return "";
  return (
    options.find((o) => canon(o) === target)
    || options.find((o) => {
      const c = canon(o);
      return c.length >= 3 && (target.includes(c) || c.includes(target));
    })
    || ""
  );
};

// A datetime-local input only accepts YYYY-MM-DDTHH:MM. Normalize whatever the
// model returned into that shape; "" when it isn't a datetime at all, so a
// malformed value is dropped rather than written.
const toDateTimeLocal = (value) => {
  const m = cleanText(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}`;
};

// A model-supplied list value may come back as an array or as a single string
// for a one-item entry.
const asItems = (raw) =>
  (Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]));

// ─── Field specs ─────────────────────────────────────────────────────────────
// T verbatim text (numbers too — this form stores every measurement as the string
// the bench wrote), S enum, D datetime, L a list.
//
// The three list strengths are a clinical choice, not a cosmetic one:
//   L        union-add verbatim — an open vocabulary (drug names, variants);
//   LSnap    must be one of the option strings, or it is dropped. For a control
//            that cannot render anything else, and where a value outside the list
//            would be unreachable afterwards;
//   LPrefer  snapped to the catalogue's spelling when it matches, else kept
//            verbatim. For a free-text list whose entries are COMPARED against
//            catalogue values elsewhere.

const T = (key) => ({ key, kind: "text" });
const S = (key, options) => ({ key, kind: "select", options });
const D = (key) => ({ key, kind: "datetime" });
const L = (key) => ({ key, kind: "list" });
const LSnap = (key, options) => ({ key, kind: "list", snapTo: options });
const LPrefer = (key, options) => ({ key, kind: "list", preferFrom: options });

// ─── Filling ─────────────────────────────────────────────────────────────────

// One dictated list item, resolved against the spec's strength.
const listItemValue = (item, f) => {
  if (f.snapTo) return coerceEnum(item, f.snapTo);
  if (f.preferFrom) return coerceEnum(item, f.preferFrom) || cleanText(item);
  return cleanText(item);
};

// What a non-list field would contribute from a dictated entry, or "" when
// nothing. (Lists are compared item-by-item in canFill and written item-by-item
// in fillFields, so they never reach here.)
const statedFieldValue = (entry, f) => {
  const raw = entry[f.key];
  if (raw === undefined || raw === null) return "";
  if (f.kind === "datetime") return toDateTimeLocal(raw);
  if (f.kind === "select") return coerceEnum(raw, f.options || []);
  return cleanText(raw);
};

// Would this entry put at least one new value into THIS object, given
// fill-empty-only semantics? Used both to route an entry to a row that still has
// room and to gate appending a new row — a dictation that names a gene without
// stating anything about it never spawns an empty row.
const canFill = (target, entry, fields) => {
  if (!entry || typeof entry !== "object") return false;
  return (fields || []).some((f) => {
    if (f.kind === "list") {
      const cur = Array.isArray(target[f.key]) ? target[f.key] : [];
      return asItems(entry[f.key]).some((item) => {
        const val = listItemValue(item, f);
        return !!val && !cur.includes(val);
      });
    }
    if (cleanText(target[f.key])) return false;
    return statedFieldValue(entry, f) !== "";
  });
};

// Fill one object's empty fields from a dictated entry. Returns the number of
// values actually placed. Nothing already filled is touched.
const fillFields = (target, entry, fields) => {
  if (!entry || typeof entry !== "object") return 0;
  let n = 0;
  (fields || []).forEach((f) => {
    const raw = entry[f.key];
    if (raw === undefined || raw === null) return;

    if (f.kind === "list") {
      const cur = Array.isArray(target[f.key]) ? target[f.key] : [];
      asItems(raw).forEach((item) => {
        const val = listItemValue(item, f);
        if (val && !cur.includes(val)) {
          cur.push(val);
          n += 1;
        }
      });
      if (cur.length) target[f.key] = cur;
      return;
    }

    if (cleanText(target[f.key])) return;
    const val = statedFieldValue(entry, f);
    if (!val) return;
    target[f.key] = val;
    n += 1;
  });
  return n;
};

// Fill a whole sub-object (a section of the form), then run the spec's `after`
// hook — the derivation the screen itself performs on manual entry, such as a
// chosen gene pulling the drugs it governs. Fill-empty-only applies to the
// derivations too, so a merge never overwrites a value that is already there.
const fillBlock = (target, incoming, spec) => {
  const n = fillFields(target, incoming, spec.fields);
  return n + (spec.after ? (spec.after(target) || 0) : 0);
};

// ─── Row tables ──────────────────────────────────────────────────────────────

// A shallow clone deep enough for the row shapes this form stores: the free
// lists are copied so a merge never mutates the object it was handed.
const cloneRow = (row) => {
  const out = { ...row };
  Object.keys(out).forEach((k) => {
    if (Array.isArray(out[k])) out[k] = [...out[k]];
  });
  return out;
};

// The field that identifies a row — the gene, or the HLA allele.
const rowKey = (row, match) => canon(row[match]);

const hasRowKey = (key) => /[a-z0-9]/.test(key);

// Merge one dictated row table. Each entry is routed (and a row is never filled
// twice in a single pass):
//   1. a row already carrying the same gene or allele — filled if it is still
//      free and has room, otherwise the entry is DROPPED, so a gene the
//      dictation mentions twice never becomes two rows;
//   2. else the first unused row with no identity yet;
//   3. else a NEW row, and only when the entry states something a row can hold.
// An entry that names a gene and has nothing else to say is dropped rather than
// recorded as a blank row.
const mergeRowTable = (rows, incoming, spec) => {
  const next = (Array.isArray(rows) ? rows : []).map(cloneRow);
  const used = new Set();
  let applied = 0;
  let created = 0;

  (Array.isArray(incoming) ? incoming : []).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const identity = rowKey(entry, spec.match);

    let idx = -1;
    if (hasRowKey(identity)) {
      const existing = next.findIndex((r) => rowKey(r, spec.match) === identity);
      if (existing !== -1) {
        if (used.has(existing) || !canFill(next[existing], entry, spec.fields)) return;
        idx = existing;
      }
    }
    if (idx === -1) {
      idx = next.findIndex(
        (r, i) => !used.has(i) && !hasRowKey(rowKey(r, spec.match)) && canFill(r, entry, spec.fields)
      );
    }
    if (idx === -1) {
      if (!canFill(spec.blank(), entry, spec.fields)) return;
      next.push(spec.blank());
      idx = next.length - 1;
      created += 1;
    }

    used.add(idx);
    applied += fillFields(next[idx], entry, spec.fields);
    if (spec.after) applied += spec.after(next[idx]) || 0;
  });

  return { rows: next, applied, created };
};

// ─── The derivations the screen performs on manual entry ─────────────────────

// Choosing a gene prefills the drugs it governs plus its guideline and evidence
// level, so the prescriber-facing list is never retyped. The catalogue only fills
// what is still empty, so a dictated drug list survives.
const applyGeneDefaults = (row) => {
  const defs = geneDefaultsFor(row.gene);
  let n = 0;
  if (!Array.isArray(row.implicated_drugs) || row.implicated_drugs.length === 0) {
    const drugs = (defs.implicated_drugs || []).filter(Boolean);
    if (drugs.length) {
      row.implicated_drugs = [...drugs];
      n += 1;
    }
  }
  // `guideline` already defaults to CPIC on a blank row, so only an emptied one
  // can take the catalogue value.
  if (!cleanText(row.guideline) && cleanText(defs.guideline)) {
    row.guideline = cleanText(defs.guideline);
    n += 1;
  }
  if (!cleanText(row.evidence_level) && cleanText(defs.evidence_level)) {
    row.evidence_level = cleanText(defs.evidence_level);
    n += 1;
  }
  return n;
};

// The published action for this gene's drugs at this phenotype. "applied" is the
// only state that writes anything: a row whose drugs need DIFFERENT actions
// ("mixed") or are only partly covered ("partial") declines, because a partly
// applicable action is worse than a blank the microbiologist fills in.
const applyGeneGuidance = (row) => {
  const g = pgxGuidance(row.gene, row.implicated_drugs, row.phenotype);
  if (g.state !== "applied") return 0;
  let n = 0;
  if (!cleanText(row.dose_implication) && g.action) {
    row.dose_implication = g.action;
    n += 1;
  }
  if (!cleanText(row.recommendation) && g.recommendation) {
    row.recommendation = g.recommendation;
    n += 1;
  }
  return n;
};

// Same offer for G6PD, whose "drug list" is the whole affected panel rather than
// a row's implicated drugs.
const applyG6pdGuidance = (block) => {
  const g = g6pdGuidance(block.status, G6PD_AFFECTED_DRUGS);
  if (g.state !== "applied") return 0;
  let n = 0;
  if (!cleanText(block.dose_implication) && g.action) {
    block.dose_implication = g.action;
    n += 1;
  }
  if (!cleanText(block.recommendation) && g.recommendation) {
    block.recommendation = g.recommendation;
    n += 1;
  }
  return n;
};

// A known risk allele carries the drug it makes dangerous and the reaction it
// causes. Only the listed alleles are actionable — a group-level call such as
// "B57 positive" is left to the resolution warning on the row.
const applyHlaDefaults = (row) => {
  const known = HLA_PGX_ALLELES.find((a) => a.allele === row.allele);
  if (!known) return 0;
  let n = 0;
  if (!cleanText(row.drug) && cleanText(known.drug)) {
    row.drug = cleanText(known.drug);
    n += 1;
  }
  if (!cleanText(row.reaction) && cleanText(known.reaction)) {
    row.reaction = cleanText(known.reaction);
    n += 1;
  }
  return n;
};

// ─── Chunk specs ─────────────────────────────────────────────────────────────

// The four chunks, in the order their results are folded in. Exported so the tab
// fires and reports on exactly this list rather than repeating it.
export const PGX_CHUNKS = [
  { key: "assay", label: "consent & assay" },
  { key: "qc", label: "QC" },
  { key: "genes", label: "gene results" },
  { key: "hla", label: "HLA, G6PD & report" },
];

// Consent is governance, not a result — it is recorded because the institution
// has no genetic-counselling process, so the file must show consent existed.
// `obtained_by` is a staff name and is never filled: identity belongs to the
// application, not to a transcript.
const ASSAY_SPEC = {
  blocks: [
    {
      key: "consent",
      fields: [S("obtained", GENOMIC_CONSENT_OPTIONS), D("obtained_at"), T("reference")],
    },
    {
      key: "assay",
      fields: [
        S("specimen_type", PGX_SPECIMEN_TYPES),
        D("collected_at"),
        D("received_at"),
        D("reported_at"),
        S("panel", PGX_PANELS),
        T("panel_version"),
        S("method", PGX_METHODS),
        S("platform", GENOMICS_PLATFORMS),
        S("laboratory", SEQUENCING_LABS),
        T("lab_ref"),
        T("result_file_ref"),
        LPrefer("genes_covered", GENE_VALUES),
      ],
    },
  ],
};

const QC_SPEC = {
  blocks: [
    {
      key: "qc",
      fields: [
        T("dna_concentration"),
        T("a260_280"),
        T("mean_depth"),
        S("qc_pass", YES_NO),
        // Both lists are read back against the row set: a no-call has to match
        // the gene it disables, and a limitation has to be one of the chips the
        // QC block can render — an unlisted string would be recorded but visible
        // nowhere, and would vanish the moment any chip was toggled.
        LPrefer("no_call_genes", GENE_VALUES),
        LSnap("limitations", PGX_ASSAY_LIMITATIONS),
        T("qc_note"),
      ],
    },
  ],
};

const GENE_ROW = {
  key: "gene_results",
  match: "gene",
  blank: blankGeneResult,
  fields: [
    S("gene", GENE_VALUES),
    T("allele_1"),
    T("allele_2"),
    T("diplotype"),
    S("phenotype", CPIC_PHENOTYPES),
    T("activity_score"),
    S("guideline", PGX_GUIDELINE_SOURCES),
    T("guideline_version"),
    S("evidence_level", CPIC_EVIDENCE_LEVELS),
    L("implicated_drugs"),
    S("dose_implication", PGX_DOSE_ACTIONS),
    S("risk_category", PGX_RISK_CATEGORIES),
    T("recommendation"),
    T("note"),
  ],
  // Order matters: the drugs must be settled before the guidance lookup, which
  // is keyed by drug.
  after: (row) => applyGeneDefaults(row) + applyGeneGuidance(row),
};

const HLA_ROW = {
  key: "hla_results",
  match: "allele",
  blank: blankHlaResult,
  fields: [
    S("allele", HLA_ALLELE_VALUES),
    T("locus"),
    S("resolution", HLA_RESOLUTION_OPTIONS),
    S("method", HLA_TYPING_METHODS),
    S("result", HLA_RESULT_OPTIONS),
    T("drug"),
    T("reaction"),
    T("recommendation"),
    T("note"),
  ],
  after: applyHlaDefaults,
};

const HLA_SPEC = {
  blocks: [
    {
      key: "g6pd",
      fields: [
        S("status", G6PD_STATUS_OPTIONS),
        T("activity_pct"),
        S("dose_implication", PGX_DOSE_ACTIONS),
        T("recommendation"),
        T("note"),
        L("variants"),
      ],
      after: applyG6pdGuidance,
    },
    {
      key: "report",
      // Prose is copied only when the dictation speaks it, never composed — and
      // `status` is deliberately absent: a report's workflow state is the user's
      // to set, not something a transcript can assert.
      fields: [T("body"), T("patient_summary"), T("limitations_note")],
    },
  ],
  rows: [HLA_ROW],
};

const SPECS = {
  assay: ASSAY_SPEC,
  qc: QC_SPEC,
  genes: { rows: [GENE_ROW] },
  hla: HLA_SPEC,
};

// ─── Entry point ─────────────────────────────────────────────────────────────

// Clone only what a merge may write into, so the caller's form is never mutated
// and untouched sections (derived, advisory, report comments) are carried
// through by reference.
const cloneForm = (form) => ({
  ...form,
  consent: { ...(form.consent || {}) },
  assay: {
    ...(form.assay || {}),
    genes_covered: [...((form.assay || {}).genes_covered || [])],
  },
  qc: {
    ...(form.qc || {}),
    no_call_genes: [...((form.qc || {}).no_call_genes || [])],
    limitations: [...((form.qc || {}).limitations || [])],
  },
  g6pd: {
    ...(form.g6pd || {}),
    variants: [...((form.g6pd || {}).variants || [])],
  },
  gene_results: (form.gene_results || []).map(cloneRow),
  hla_results: (form.hla_results || []).map(cloneRow),
  report: { ...(form.report || {}) },
});

/**
 * Merge one chunk's structure response into the form.
 *
 * @param {string} chunk  one of PGX_CHUNKS[].key
 * @param {object} form   the form as it stands (with earlier chunks already folded in)
 * @param {object} data   the endpoint's `data` for that chunk
 * @returns {{ form: object, applied: number, created: number }}
 */
export function mergePgxChunk(chunk, form, data) {
  const spec = SPECS[chunk];
  const payload = data && typeof data === "object" ? data : {};
  if (!spec || !form) return { form, applied: 0, created: 0 };

  const next = cloneForm(form);
  let applied = 0;
  (spec.blocks || []).forEach((b) => {
    if (!next[b.key] || typeof next[b.key] !== "object") next[b.key] = {};
    applied += fillBlock(next[b.key], payload[b.key], b);
  });

  let created = 0;
  (spec.rows || []).forEach((t) => {
    const res = mergeRowTable(next[t.key], payload[t.key], t);
    next[t.key] = res.rows;
    applied += res.applied;
    created += res.created;
  });

  return { form: next, applied, created };
}
