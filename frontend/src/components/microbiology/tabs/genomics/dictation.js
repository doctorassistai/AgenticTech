// tabs/genomics/dictation.js — Tab 15 dictation merge (speech → fields)
//
// The pure half of the Pathogen Genomics dictation flow: one entry point that
// merges the `POST /pathogen-genomics/structure` response into ONE sub-tab's
// record. Pure functions only — no React, no state, no fetch — and next to the
// feature rather than in a model layer (see documentation/TRANSCRIBE_AUTOFILL.md).
//
// The filling rules that must not change:
//   • fill EMPTY fields only — nothing already on the record is overwritten;
//   • never clear a field, so a short or partial transcript is a safe no-op;
//   • enums snap to the panel's canonical option list, or stay blank for a
//     manual pick — a <Select> never receives an out-of-range value;
//   • free lists (drug targets, loci, mutations, antiviral markers) union-add
//     and de-duplicate, never remove;
//   • a dictated determinant goes to the row already carrying it (while that row
//     is free and still has room), else the first empty row, else a new row —
//     one row is never filled twice in a pass, and a determinant named twice
//     never becomes two rows;
//   • DERIVED fields are recomputed HERE from the rows just merged, never read
//     from the model: the TB classification from the call/profile rows,
//     heteroresistance from the VAF, panel_kind from the chosen panel. That is
//     the same derivation the panels run on manual entry, so a dictated record
//     and a typed one cannot disagree.
//
// Never filled, by design: `technical_name` (staff identity belongs to the
// application), `who_regimen_note` (advisory, and never auto-written on the
// record — it has its own button), every order/row/hit/call ID, and `prelim`.

import {
  AMR_GENE_DATABASES,
  AMPLICON_DATABASES,
  AMPLICON_TARGETS,
  CARD_CONFIDENCE,
  EPIDEMIOLOGICAL_LINK_OPTIONS,
  GENEXPERT_RESULT_OPTIONS,
  GENEXPERT_RIF_OPTIONS,
  GENOMICS_PLATFORMS,
  GENOTYPE_PHENOTYPE_CONCORDANCE,
  HOST_DEPLETION_OPTIONS,
  IDENTIFICATION_CONFIDENCE_OPTIONS,
  ID_RESOLUTION_LEVELS,
  ID_TOOL_OPTIONS,
  MNGS_BACKGROUND_OPTIONS,
  MNGS_CLINICAL_SIGNIFICANCE,
  MNGS_INPUT_OPTIONS,
  MNGS_KINGDOMS,
  MNGS_PIPELINES,
  PREDICTED_PHENOTYPE_OPTIONS,
  RESISTANCE_GENE_CLASSES,
  RESISTANCE_MECHANISMS,
  SEQUENCING_LABS,
  SPECIMEN_INPUT_TYPES,
  SPECIMEN_TYPE_OPTIONS,
  TARGETED_PANEL_METHODS,
  TAXON_RANK_OPTIONS,
  TNGS_ASSAYS,
  TNGS_DRUG_PANEL,
  TYPING_SCHEMES,
  VIRULENCE_GENE_CATEGORIES,
  WGS_PIPELINES,
  WHO_TB_CONFIDENCE_GROUPS,
  deriveTbClassification,
  isMtbcSpecies,
} from "../../constants";
import { YES_NO } from "./fields";
import { deriveHeteroresistance } from "../../shared/genomics";
import {
  blankAmrGene,
  blankMutationRow,
  blankOrganismHit,
  blankPlasmidReplicon,
  blankResistanceCall,
  blankResistanceGene,
  blankTargetedOrder,
  blankTbProfileRow,
  blankTaxonRow,
  blankVirulenceGene,
  blankVirusHit,
} from "./records";

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
  Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]);

// Field specs. `T` verbatim text (numbers too — this module stores every
// measurement as the string the bench wrote), `S` enum, `D` datetime, `L` list.
const T = (key) => ({ key, kind: "text" });
const S = (key, options) => ({ key, kind: "select", options });
const D = (key) => ({ key, kind: "datetime" });
const L = (key, snapTo) => ({ key, kind: "list", snapTo });

// ─── Filling ─────────────────────────────────────────────────────────────────

// What a field would contribute from a dictated entry, or "" when nothing.
const statedFieldValue = (entry, f) => {
  const raw = entry[f.key];
  if (raw === undefined || raw === null) return "";
  if (f.kind === "datetime") return toDateTimeLocal(raw);
  if (f.kind === "select") return coerceEnum(raw, f.options || []);
  return cleanText(raw);
};

// Would this entry put at least one new value into THIS object, given
// fill-empty-only semantics? Used both to route an entry to a row that still has
// room and to gate appending a new row — a dictation that names a determinant
// without stating anything about it never spawns an empty row.
const canFill = (target, entry, fields) => {
  if (!entry || typeof entry !== "object") return false;
  return (fields || []).some((f) => {
    if (f.kind === "list") {
      const cur = Array.isArray(target[f.key]) ? target[f.key] : [];
      return asItems(entry[f.key]).some((item) => {
        const val = f.snapTo ? coerceEnum(item, f.snapTo) : cleanText(item);
        return !!val && !cur.includes(val);
      });
    }
    if (cleanText(target[f.key])) return false;
    return statedFieldValue(entry, f) !== "";
  });
};

// Fill one object's empty fields from a dictated entry. Returns the number of
// values actually placed. Nothing already filled is touched, and a `derive` hook
// on a field re-runs its dependent derivation after the value lands.
const fillFields = (target, entry, fields) => {
  if (!entry || typeof entry !== "object") return 0;
  let n = 0;
  (fields || []).forEach((f) => {
    const raw = entry[f.key];
    if (raw === undefined || raw === null) return;

    if (f.kind === "list") {
      const cur = Array.isArray(target[f.key]) ? target[f.key] : [];
      asItems(raw).forEach((item) => {
        const val = f.snapTo ? coerceEnum(item, f.snapTo) : cleanText(item);
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
    if (f.derive) f.derive(target);
  });
  return n;
};

// ─── Row tables ──────────────────────────────────────────────────────────────

// A shallow clone deep enough for the row shapes this panel stores: the free
// lists are copied so a merge never mutates the record it was handed.
const cloneRow = (row) => {
  const out = { ...row };
  Object.keys(out).forEach((k) => {
    if (Array.isArray(out[k])) out[k] = [...out[k]];
  });
  return out;
};

// The fields that identify a row, joined. A resistance row's identity is its
// gene; a mutation row's is its locus+mutation PAIR, because the same mutation
// name can occur at two loci and must not be collapsed into one row.
const rowKey = (row, match) =>
  (Array.isArray(match) ? match : [match]).map((k) => canon(row[k])).join("|");

const hasRowKey = (key) => /[a-z0-9]/.test(key);

// Merge one dictated row table. Each entry is routed (and a row is never filled
// twice in a single pass):
//   1. a row already carrying the same determinant — filled if it is still free
//      and has room, otherwise the entry is DROPPED, so a determinant the
//      dictation mentions twice never becomes two rows;
//   2. else the first unused row with no determinant yet;
//   3. else a NEW row, and only when the entry states something a row can hold.
// A determinant the dictation names that has nowhere to go and nothing to say is
// dropped rather than recorded as a blank row.
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
  });

  return { rows: next, applied, created };
};

// ─── Per-sub-tab specs ───────────────────────────────────────────────────────

// WGS — the ordering is the panel's own: sample QC, run, pipeline, then the
// identification the typing and TB blocks hang off.
const WGS_SCALARS = [
  D("submitted_at"),
  S("specimen_input", SPECIMEN_INPUT_TYPES),
  S("platform", GENOMICS_PLATFORMS),
  T("run_id"),
  S("sequencing_lab", SEQUENCING_LABS),
  T("sequencing_lab_ref"),
  D("result_received_at"),
  T("result_file_ref"),
  T("dna_extraction_method"),
  T("dna_concentration"),
  T("a260_280"),
  S("extraction_qc_pass", YES_NO),
  S("pipeline_name", WGS_PIPELINES),
  T("pipeline_version"),
  T("reference_genome"),
  S("assembly_qc_pass", YES_NO),
  T("total_reads"),
  T("reads_after_qc"),
  T("mean_coverage"),
  T("coverage_breadth_pct"),
  T("assembly_qc_note"),
  T("identified_species"),
  S("id_resolution", ID_RESOLUTION_LEVELS),
  S("identification_confidence", IDENTIFICATION_CONFIDENCE_OPTIONS),
  S("id_tool", ID_TOOL_OPTIONS),
  T("id_tool_version"),
  T("sequence_type"),
  S("mlst_scheme", TYPING_SCHEMES),
  T("clonal_complex"),
  T("lineage"),
  T("spa_type"),
  T("sccmec"),
  T("serotype"),
  T("clade"),
  T("tb_who_catalogue_version"),
  S("genotype_phenotype_concordance", GENOTYPE_PHENOTYPE_CONCORDANCE),
  T("concordance_note"),
  T("cluster_id"),
  T("cluster_snp_distance"),
  S("cluster_tool", TYPING_SCHEMES),
  S("epidemiological_link", EPIDEMIOLOGICAL_LINK_OPTIONS),
  T("outbreak_note"),
  T("genomic_summary"),
];

const WGS_ROWS = [
  {
    key: "resistance_genes",
    match: "gene_name",
    blank: blankResistanceGene,
    fields: [
      T("gene_name"),
      S("gene_class", RESISTANCE_GENE_CLASSES),
      S("mechanism", RESISTANCE_MECHANISMS),
      S("database_source", AMR_GENE_DATABASES),
      T("database_version"),
      T("identity_pct"),
      T("coverage_pct"),
      S("predicted_phenotype", PREDICTED_PHENOTYPE_OPTIONS),
      S("confidence", CARD_CONFIDENCE),
      L("drug_targets"),
    ],
  },
  {
    key: "virulence_genes",
    match: "gene_name",
    blank: blankVirulenceGene,
    fields: [T("gene_name"), S("category", VIRULENCE_GENE_CATEGORIES), T("note")],
  },
  {
    key: "plasmid_replicons",
    match: "name",
    blank: blankPlasmidReplicon,
    fields: [T("name"), T("note")],
  },
  {
    key: "tb_drug_resistance_profile",
    match: "drug",
    blank: blankTbProfileRow,
    // The TB block renders only for an MTBC identification, so its rows are
    // recorded only when the species the dictation just resolved IS MTBC —
    // otherwise the panel would not show them and the values would be invisible.
    // Evaluated after the scalars, so a dictated MTB identification opens it.
    when: (rec) => isMtbcSpecies(rec.identified_species),
    fields: [
      S("drug", TNGS_DRUG_PANEL),
      T("mutation"),
      S("who_confidence", WHO_TB_CONFIDENCE_GROUPS),
      S("predicted_phenotype", PREDICTED_PHENOTYPE_OPTIONS),
    ],
  },
];

const MNGS_SCALARS = [
  S("specimen_type", SPECIMEN_TYPE_OPTIONS),
  S("input_type", MNGS_INPUT_OPTIONS),
  S("host_depletion", HOST_DEPLETION_OPTIONS),
  D("submitted_at"),
  D("result_received_at"),
  S("platform", GENOMICS_PLATFORMS),
  S("sequencing_lab", SEQUENCING_LABS),
  T("sequencing_lab_ref"),
  T("result_file_ref"),
  S("pipeline_name", MNGS_PIPELINES),
  T("pipeline_version"),
  T("total_reads"),
  T("reads_after_qc"),
  T("host_reads_pct"),
  T("non_host_reads"),
  T("interpretation_note"),
];

const MNGS_ROWS = [
  {
    key: "organism_hits",
    match: "taxon_name",
    blank: blankOrganismHit,
    fields: [
      T("taxon_name"),
      S("taxon_rank", TAXON_RANK_OPTIONS),
      S("kingdom", MNGS_KINGDOMS),
      T("rpm"),
      T("nt_coverage"),
      T("nr_coverage"),
      S("background_model", MNGS_BACKGROUND_OPTIONS),
      S("clinical_significance", MNGS_CLINICAL_SIGNIFICANCE),
      T("significance_note"),
    ],
  },
  {
    key: "virus_hits",
    match: "virus_name",
    blank: blankVirusHit,
    fields: [
      T("virus_name"),
      T("genome_coverage_pct"),
      T("mean_depth"),
      L("antiviral_resistance_markers"),
      T("clinical_note"),
    ],
  },
  {
    key: "amr_genes_detected",
    match: "gene_name",
    blank: blankAmrGene,
    // The attribution note is left to the dictation (or the row's own "Cannot be
    // attributed" button). Filling it mechanically would put a caveat on a gene
    // that may genuinely be attributable.
    fields: [
      T("gene_name"),
      S("gene_class", RESISTANCE_GENE_CLASSES),
      S("mechanism", RESISTANCE_MECHANISMS),
      S("database_source", AMR_GENE_DATABASES),
      T("card_version"),
      S("predicted_phenotype", PREDICTED_PHENOTYPE_OPTIONS),
      T("note"),
    ],
  },
];

const TNGS_SCALARS = [
  D("submitted_at"),
  S("specimen_input", SPECIMEN_INPUT_TYPES),
  S("platform", GENOMICS_PLATFORMS),
  S("sequencing_lab", SEQUENCING_LABS),
  T("sequencing_lab_ref"),
  D("result_received_at"),
  T("result_file_ref"),
  S("assay_name", TNGS_ASSAYS),
  T("assay_version"),
  S("pipeline_name", WGS_PIPELINES),
  T("pipeline_version"),
  T("mean_depth_coverage"),
  T("loci_above_threshold_pct"),
  S("qc_pass", YES_NO),
  T("qc_note"),
  T("lineage"),
  S("lineage_tool", WGS_PIPELINES),
  S("concordance_with_phenotypic_dst", GENOTYPE_PHENOTYPE_CONCORDANCE),
  T("concordance_note"),
];

// The prior aNAAT is a nested object, so its three fields are nested too.
const TNGS_PRIOR_SCALARS = [
  S("result", GENEXPERT_RESULT_OPTIONS),
  S("rif_resistance", GENEXPERT_RIF_OPTIONS),
  D("performed_at"),
];

const TNGS_ROWS = [
  {
    key: "drug_resistance_calls",
    match: "drug",
    blank: blankResistanceCall,
    fields: [
      S("drug", TNGS_DRUG_PANEL),
      S("predicted_phenotype", PREDICTED_PHENOTYPE_OPTIONS),
      S("who_confidence_tier", WHO_TB_CONFIDENCE_GROUPS),
      // Heteroresistance is implied by the VAF, so it is derived from the value
      // that lands rather than taken from the model — the panel does the same
      // on manual entry, and the warning must not depend on who typed it.
      { key: "vaf_pct", kind: "text", derive: (row) => {
        const het = deriveHeteroresistance(row.vaf_pct);
        if (het) row.heteroresistance = het;
      } },
      L("mutations_detected"),
    ],
  },
];

const SPECS = {
  wgs: {
    scalars: WGS_SCALARS,
    rows: WGS_ROWS,
    derived: (rec) => {
      // Only from actual profile rows. deriveTbClassification([]) answers
      // "DS-TB", which would assert full susceptibility from an empty profile —
      // the panel leaves the badge blank until a drug row exists, and so does
      // this. (deriveTbClassification is idempotent, so re-running it over a
      // profile the user already filled cannot change the badge.)
      if (isMtbcSpecies(rec.identified_species) && (rec.tb_drug_resistance_profile || []).length > 0) {
        rec.tb_resistance_classification = deriveTbClassification(rec.tb_drug_resistance_profile);
      }
    },
  },
  mngs: { scalars: MNGS_SCALARS, rows: MNGS_ROWS },
  tngs: {
    scalars: TNGS_SCALARS,
    rows: TNGS_ROWS,
    nested: [{ key: "prior_genexpert", fields: TNGS_PRIOR_SCALARS }],
    // The classification is a projection of the call table and is never typed,
    // here or on the panel.
    derived: (rec) => {
      rec.tb_classification = deriveTbClassification(rec.drug_resistance_calls);
    },
  },
};

// ─── Targeted panels ─────────────────────────────────────────────────────────

const TARGETED_SCALARS = [
  S("method", TARGETED_PANEL_METHODS),
  S("platform", GENOMICS_PLATFORMS),
  S("sequencing_lab", SEQUENCING_LABS),
  D("submitted_at"),
  S("pipeline_name", WGS_PIPELINES),
  T("pipeline_version"),
  T("mean_depth_coverage"),
  S("qc_pass", YES_NO),
  T("qc_note"),
  T("result_file_ref"),
  T("interpretation_note"),
];

const TYPING_SCALARS = [
  S("scheme", TYPING_SCHEMES),
  T("type_result"),
  T("cluster_id"),
  T("snp_distance"),
];

// The resistance table's drug options come from the chosen panel, so the spec is
// built per order rather than declared once.
const mutationRowSpec = (def) => ({
  key: "mutation_rows",
  match: ["locus", "mutation"],
  blank: blankMutationRow,
  fields: [
    T("locus"),
    T("mutation"),
    S("drug", def?.drugs || []),
    S("predicted_phenotype", PREDICTED_PHENOTYPE_OPTIONS),
    S("confidence", CARD_CONFIDENCE),
    T("note"),
  ],
});

const TAXON_ROW_SPEC = {
  key: "taxa_rows",
  match: "taxon_name",
  blank: blankTaxonRow,
  fields: [T("taxon_name"), T("rank"), T("identity_pct"), T("note")],
};

const cloneOrder = (o) => ({
  ...o,
  loci_targeted: [...(o.loci_targeted || [])],
  mutation_rows: (o.mutation_rows || []).map(cloneRow),
  taxa_rows: (o.taxa_rows || []).map(cloneRow),
  typing: { ...(o.typing || {}) },
});

// The panel the dictation names, matched on value and label. Returns null when
// the named panel is not one this specimen ordered.
const snapPanel = (value, panels) => {
  const choices = Array.isArray(panels) ? panels : [];
  const tokens = [];
  choices.forEach((p) => {
    [p.value, p.label].forEach((token) => {
      const k = canon(token);
      if (k) tokens.push({ key: k, panel: p });
    });
  });
  const target = canon(value);
  if (!target) return null;
  const exact = tokens.find((t) => t.key === target);
  if (exact) return exact.panel;
  const sub = tokens.find((t) => t.key.length >= 3 && (target.includes(t.key) || t.key.includes(target)));
  return sub ? sub.panel : null;
};

const rowsSpecFor = (kind, def) =>
  kind === "resistance" ? mutationRowSpec(def) : kind === "identity" ? TAXON_ROW_SPEC : null;

// `loci_targeted` is a free list on a resistance or typing panel but a fixed pick
// on an identity panel, where the card binds it to the amplicon-target selector —
// so it snaps there and stays free elsewhere. One spec, used by both the gate and
// the filler, so the two cannot disagree about whether an entry fits.
const lociSpec = (kind) => ({
  key: "loci_targeted",
  kind: "list",
  snapTo: kind === "identity" ? AMPLICON_TARGETS : null,
});

// Would this dictated order put at least one value into THIS order? Decides
// whether an existing order still has room, without disturbing what is filled.
const orderCanHold = (order, entry, def) => {
  if (!entry || typeof entry !== "object") return false;
  const kind = def?.kind;
  if (canFill(order, entry, TARGETED_SCALARS)) return true;
  if (canFill(order, entry, [lociSpec(kind)])) return true;
  if (kind === "identity" && !cleanText(order.reference_database)
    && coerceEnum(entry.reference_database, AMPLICON_DATABASES)) return true;
  if (kind === "typing" && canFill(order.typing || {}, entry.typing, TYPING_SCALARS)) return true;
  const spec = rowsSpecFor(kind, def);
  if (spec && (Array.isArray(entry[spec.key]) ? entry[spec.key] : [])
    .some((row) => canFill(spec.blank(), row, spec.fields))) return true;
  return false;
};

// Fill one targeted order.
const fillOrder = (order, entry, def) => {
  const kind = def?.kind;
  let n = fillFields(order, entry, TARGETED_SCALARS);
  n += fillFields(order, entry, [lociSpec(kind)]);
  if (kind === "identity") {
    n += fillFields(order, entry, [S("reference_database", AMPLICON_DATABASES)]);
  }
  if (kind === "typing") {
    n += fillFields(order.typing, entry.typing, TYPING_SCALARS);
  }
  const spec = rowsSpecFor(kind, def);
  if (spec) {
    const res = mergeRowTable(order[spec.key], entry[spec.key], spec);
    order[spec.key] = res.rows;
    n += res.applied;
  }
  return n;
};

// A targeted sub-tab holds an ORDERS array (one specimen may carry several
// panels at once, and a panel may legitimately be run twice), so a dictation is
// routed to an order the way Registration routes a specimen:
//   1. the order already carrying the dictated panel, while it is still free and
//      has room — the natural home for a result of that panel;
//   2. else the first order with no panel chosen yet;
//   3. else a NEW order, but only when the entry states something an order can
//      hold, so a dictation that resolved to nothing never spawns an empty one.
// An existing order's panel is NEVER switched — that would clear the rows it
// already holds — and a panel the specimen did not order is dropped rather than
// silently recorded under the wrong shape.
const mergeTargetedSection = (record, data, panels) => {
  const next = { orders: (record.orders || []).map(cloneOrder) };
  const used = new Set();
  let applied = 0;
  let created = 0;
  let dropped = 0;
  let dropReason = "";

  (Array.isArray(data.orders) ? data.orders : []).forEach((entry) => {
    if (!entry || typeof entry !== "object") return;

    const named = snapPanel(entry.panel, panels);
    if (cleanText(entry.panel) && !named) {
      dropped += 1; // named a panel this specimen did not order
      dropReason = dropReason || "the panel named is not one this specimen ordered";
      return;
    }
    // With no panel named, a specimen that ordered exactly one can only mean
    // that one; anything else is ambiguous and is left alone.
    const def = named || (panels.length === 1 ? panels[0] : null);
    if (!def) {
      dropped += 1;
      dropReason = dropReason || "which panel the result belongs to is ambiguous for this specimen";
      return;
    }

    let idx = next.orders.findIndex(
      (o, i) => !used.has(i) && o.panel === def.value && orderCanHold(o, entry, def)
    );
    if (idx === -1) idx = next.orders.findIndex((o, i) => !used.has(i) && !o.panel);
    if (idx === -1) {
      if (!orderCanHold(blankTargetedOrder(), entry, def)) {
        dropped += 1;
        dropReason = dropReason || "nothing stated could be recorded on a panel order";
        return;
      }
      next.orders.push(blankTargetedOrder());
      idx = next.orders.length - 1;
      created += 1;
    }

    used.add(idx);
    const order = next.orders[idx];
    // The panel and its derived kind are the only identity fields set here; an
    // order that already carries them keeps them.
    if (!order.panel) {
      order.panel = def.value;
      order.panel_kind = def.kind;
    }
    applied += fillOrder(order, entry, def);
  });

  return { record: next, applied, created, dropped, dropReason };
};

// ─── Entry point ─────────────────────────────────────────────────────────────

/**
 * Merge a structure response into ONE sub-tab's record.
 *
 * @param {string} subKey  "wgs" | "mngs" | "tngs" | "targeted"
 * @param {object} record  the sub-record currently on the card
 * @param {object} data    the endpoint's `data`
 * @param {{ panels?: object[] }} [ctx]  the offered targeted panels (config-driven
 *        shape), so a dictated panel is matched against what this specimen ordered
 * @returns {{ record: object, applied: number, created: number, dropped: number,
 *            dropReason: string }}
 *          `applied`/`created` count values and rows written; `dropped` counts
 *          stated entries this panel has no field for, with `dropReason` naming
 *          why — so the notice can say so rather than let them vanish silently.
 */
export function mergeGenomicsRecord(subKey, record, data, ctx = {}) {
  const payload = data && typeof data === "object" ? data : {};
  if (!record) return { record, applied: 0, created: 0, dropped: 0, dropReason: "" };

  if (subKey === "targeted") {
    return mergeTargetedSection(record, payload, Array.isArray(ctx.panels) ? ctx.panels : []);
  }

  const spec = SPECS[subKey];
  if (!spec) return { record, applied: 0, created: 0, dropped: 0, dropReason: "" };

  const next = { ...record };
  Object.keys(next).forEach((k) => {
    if (Array.isArray(next[k])) next[k] = next[k].map(cloneRow);
    else if (next[k] && typeof next[k] === "object") next[k] = { ...next[k] };
  });

  let applied = fillFields(next, payload, spec.scalars);
  (spec.nested || []).forEach((n) => {
    if (!next[n.key] || typeof next[n.key] !== "object") next[n.key] = {};
    applied += fillFields(next[n.key], payload[n.key], n.fields);
  });

  let created = 0;
  let dropped = 0;
  let dropReason = "";
  let rowsApplied = 0;
  (spec.rows || []).forEach((table) => {
    const incoming = payload[table.key];
    if (!Array.isArray(incoming) || incoming.length === 0) return;
    if (table.when && !table.when(next)) {
      dropped += incoming.length;
      dropReason = dropReason || "the TB drug profile is recorded only for an MTBC identification";
      return;
    }
    const res = mergeRowTable(next[table.key], incoming, table);
    next[table.key] = res.rows;
    applied += res.applied;
    rowsApplied += res.applied;
    created += res.created;
  });

  // The derived fields are a projection of the rows, so they are recomputed only
  // when rows actually changed — never on a scalars-only merge, which would
  // otherwise stamp a classification onto a record that has no calls yet.
  if (spec.derived && (rowsApplied > 0 || created > 0)) spec.derived(next);

  return { record: next, applied, created, dropped, dropReason };
}
