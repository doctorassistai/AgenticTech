// tabs/genomics/pgxRecords.js — Tab 16 record defaults + hydration
//
// The human-genomics section is CASE-LEVEL, not keyed by specimen_id. That is
// the whole architectural point of this track: a pharmacogenomic result is a
// lifelong property of the PATIENT, true across every future case, whereas a
// pathogen result belongs to one specimen of one case.
//
//   human_genomics = {
//     schema_version, consent, assay, qc,
//     gene_results: [...], hla_results: [...], g6pd,
//     derived, report,
//   }
//
// `derived` is a stored SNAPSHOT of what the deterministic engine computed at
// the time of reporting — the live readout is recomputed on every render, but a
// reported result must stay readable as it was issued.
//
// Scope is pharmacogenomics + host susceptibility only. Germline / hereditary
// cancer testing is NOT here — the precision-oncology pipeline owns it (T6, M9).

import { makeUid } from "./records";
import { PGX_GENE_BY_VALUE } from "../../constants";

const arr = (v) => (Array.isArray(v) ? v : []);

export const blankGeneResult = () => ({
  row_id: makeUid("PGX"),
  gene: "",
  allele_1: "",
  allele_2: "",
  diplotype: "",
  phenotype: "",
  activity_score: "",
  guideline: "CPIC",
  guideline_version: "",
  evidence_level: "",
  implicated_drugs: [],
  recommendation: "",
  dose_implication: "",
  risk_category: "",
  note: "",
});

export const hydrateGeneResult = (saved) => ({
  ...blankGeneResult(),
  ...(saved || {}),
  implicated_drugs: arr(saved?.implicated_drugs),
});

export const blankHlaResult = () => ({
  row_id: makeUid("HLA"),
  locus: "",
  allele: "",
  resolution: "",
  method: "",
  result: "",
  drug: "",
  reaction: "",
  recommendation: "",
  note: "",
});

export const hydrateHlaResult = (saved) => ({ ...blankHlaResult(), ...(saved || {}) });

export const blankHumanGenomics = () => ({
  schema_version: "1.0",
  // Consent is deliberately light: the institution has no genetic-counselling
  // process, so this records that consent exists rather than driving a workflow.
  consent: { obtained: "", obtained_by: "", obtained_at: "", reference: "" },
  assay: {
    panel: "",
    panel_version: "",
    genes_covered: [],
    method: "",
    platform: "",
    laboratory: "In-house",
    lab_ref: "",
    specimen_type: "EDTA whole blood",
    collected_at: "",
    received_at: "",
    reported_at: "",
    result_file_ref: "",
  },
  qc: {
    dna_concentration: "",
    a260_280: "",
    mean_depth: "",
    // A gene that failed QC must report as "not analysed" — never as "normal".
    no_call_genes: [],
    limitations: [],
    qc_pass: "",
    qc_note: "",
  },
  gene_results: [],
  hla_results: [],
  g6pd: {
    status: "",
    activity_pct: "",
    variants: [],
    // Recorded, not inferred — the same rule the gene rows follow. The action a
    // deficient patient needs is drug-specific, so the engine aggregates a stated
    // implication rather than deriving one from the status.
    dose_implication: "",
    recommendation: "",
    note: "",
  },
  // The advisory brief, kept after review — never auto-applied to any field. Same
  // shape Tab 12 uses for its brief: { run_at, status, output }.
  advisory: null,
  derived: null,
  report: {
    status: "Draft",
    body: "",
    comments: [],
    // No counsellor will explain the result to the patient, so the plain-language
    // summary and the limitations note carry more weight than usual.
    patient_summary: "",
    limitations_note: "",
  },
});

export const hydrateHumanGenomics = (saved) => {
  const b = blankHumanGenomics();
  const o = saved || {};
  return {
    ...b,
    ...o,
    consent: { ...b.consent, ...(o.consent || {}) },
    assay: { ...b.assay, ...(o.assay || {}) },
    qc: { ...b.qc, ...(o.qc || {}) },
    gene_results: arr(o.gene_results).map(hydrateGeneResult),
    hla_results: arr(o.hla_results).map(hydrateHlaResult),
    g6pd: { ...b.g6pd, ...(o.g6pd || {}) },
    report: { ...b.report, ...(o.report || {}) },
    derived: o.derived || null,
  };
};

// Choosing a gene prefills the drugs it governs, so the prescriber-facing list
// is never retyped (and never silently invented by hand). The guideline and
// evidence level come from the same catalogue entry.
export const geneDefaultsFor = (gene) => {
  const g = PGX_GENE_BY_VALUE[gene];
  if (!g) return {};
  return {
    implicated_drugs: g.drugs,
    guideline: "CPIC",
    evidence_level: g.evidence,
  };
};

// A one-line description of what this gene row means, for the panel to show
// under the gene selector. This is the clinical reason the gene is on the panel.
export const geneNoteFor = (gene) => PGX_GENE_BY_VALUE[gene]?.note || "";

// True when the gene needs a copy-number call that a short-read panel cannot
// make — CYP2D6 is the one that matters, and it is the commonest PGx false
// negative. Surfaced as a warning on the row.
export const geneRequiresCnv = (gene) => !!PGX_GENE_BY_VALUE[gene]?.requiresCnv;
