// tabs/genomics/records.js — Tab 15 record defaults + hydration
//
// Shared by the four Pathogen Genomics panels so the stored shape is declared in
// exactly one place. The section is keyed by specimen_id, like every other
// analytical track in this module:
//
//   pathogen_genomics = {
//     [specimen_id]: { wgs, mngs, tngs, targeted }
//   }
//
// A sub-record exists only when that specimen ordered the matching test — a
// specimen with only `mngs` ordered carries `{ wgs: null, mngs: {...}, ... }`.
// That is what keeps a partially-ordered specimen honest without a second map.

export const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

// Every order is minted with the GEN- prefix — one namespace across the four
// panels, because an order_id is what a preliminary report cites.
const newOrder = () => makeUid("GEN");

// Always returns an array, so every row loop below can be written without a guard.
const arr = (v) => (Array.isArray(v) ? v : []);

// ─── WGS — whole genome sequencing of an isolate ──────────────────────────────
// Three QC layers in order: sample (extraction), sequencing run, and the
// bioinformatics pipeline. The pipeline NAME + VERSION pair is the ISO 15189
// traceability record and is never optional on a reported result.

export const blankWgs = () => ({
  order_id: newOrder(),
  technical_name: "",
  submitted_at: "",
  specimen_input: "",
  // sample QC
  dna_extraction_method: "",
  dna_concentration: "",
  a260_280: "",
  extraction_qc_pass: "",
  // sequencing run
  platform: "",
  run_id: "",
  sequencing_lab: "In-house",
  sequencing_lab_ref: "",
  result_received_at: "",
  // pipeline QC
  pipeline_name: "",
  pipeline_version: "",
  reference_genome: "",
  total_reads: "",
  reads_after_qc: "",
  mean_coverage: "",
  coverage_breadth_pct: "",
  assembly_qc_pass: "",
  assembly_qc_note: "",
  // identification
  id_tool: "",
  id_tool_version: "",
  identified_species: "",
  id_resolution: "",
  identification_confidence: "",
  // typing
  sequence_type: "",
  mlst_scheme: "",
  lineage: "",
  clonal_complex: "",
  spa_type: "",
  sccmec: "",
  serotype: "",
  clade: "",
  // resistance / virulence
  resistance_genes: [],
  virulence_genes: [],
  plasmid_replicons: [],
  // TB layer (only meaningful when the species is MTBC)
  tb_who_catalogue_version: "",
  tb_drug_resistance_profile: [],
  tb_resistance_classification: "",
  // genotype vs phenotype
  genotype_phenotype_concordance: "",
  concordance_note: "",
  // epidemiology
  cluster_id: "",
  cluster_snp_distance: "",
  cluster_tool: "",
  epidemiological_link: "",
  outbreak_note: "",
  // dispatch
  genomic_summary: "",
  result_file_ref: "",
  prelim: null,
});

export const hydrateWgs = (saved) => {
  const b = blankWgs();
  const o = saved || {};
  return {
    ...b,
    ...o,
    resistance_genes: arr(o.resistance_genes),
    virulence_genes: arr(o.virulence_genes),
    plasmid_replicons: arr(o.plasmid_replicons),
    tb_drug_resistance_profile: arr(o.tb_drug_resistance_profile),
    prelim: o.prelim || null,
  };
};

// One row = one resistance determinant. `database_source` + `database_version`
// are recorded per row because two databases disagreeing about the same gene is
// a real reporting problem, and the row has to say which one it followed.
export const blankResistanceGene = () => ({
  row_id: makeUid("RG"),
  gene_name: "",
  gene_class: "",
  mechanism: "",
  database_source: "",
  database_version: "",
  identity_pct: "",
  coverage_pct: "",
  predicted_phenotype: "",
  confidence: "",
  drug_targets: [], // string[] — drugs the determinant is predicted to affect
});

export const blankVirulenceGene = () => ({
  row_id: makeUid("VG"),
  gene_name: "",
  category: "",
  note: "",
});

export const blankPlasmidReplicon = () => ({
  row_id: makeUid("PL"),
  name: "",
  note: "",
});

// WHO catalogue row for a TB drug profile. `who_confidence` is quoted verbatim —
// Group 3 (uncertain significance) is a legitimate answer, not a missing one.
export const blankTbProfileRow = () => ({
  row_id: makeUid("TB"),
  drug: "",
  mutation: "",
  who_confidence: "",
  predicted_phenotype: "",
});

// ─── mNGS — metagenomic sequencing of the raw specimen ────────────────────────
// No culture, no prior target. Output is a ranked organism list, so the
// significant-hit table is the clinical core; `background_model` is what stops a
// contaminant being read as a pathogen.

export const blankMngs = () => ({
  order_id: newOrder(),
  technical_name: "",
  submitted_at: "",
  specimen_type: "",
  input_type: "",
  host_depletion: "",
  platform: "",
  sequencing_lab: "In-house",
  sequencing_lab_ref: "",
  result_received_at: "",
  pipeline_name: "",
  pipeline_version: "",
  total_reads: "",
  reads_after_qc: "",
  host_reads_pct: "",
  non_host_reads: "",
  organism_hits: [],
  virus_hits: [],
  amr_genes_detected: [],
  interpretation_note: "",
  result_file_ref: "",
  prelim: null,
});

export const hydrateMngs = (saved) => {
  const b = blankMngs();
  const o = saved || {};
  return {
    ...b,
    ...o,
    organism_hits: arr(o.organism_hits),
    virus_hits: arr(o.virus_hits),
    amr_genes_detected: arr(o.amr_genes_detected),
    prelim: o.prelim || null,
  };
};

export const blankOrganismHit = () => ({
  hit_id: makeUid("HIT"),
  taxon_name: "",
  taxon_rank: "",
  kingdom: "",
  rpm: "",
  nt_coverage: "",
  nr_coverage: "",
  background_model: "",
  clinical_significance: "",
  significance_note: "",
});

// Viral hits are tracked separately from the general organism table because what
// matters for a virus is genome coverage and depth, not read abundance — and
// because antiviral resistance markers only exist on this row type.
export const blankVirusHit = () => ({
  hit_id: makeUid("VH"),
  virus_name: "",
  genome_coverage_pct: "",
  mean_depth: "",
  antiviral_resistance_markers: [],
  clinical_note: "",
});

// AMR genes found in mNGS reads. These are detected from the TOTAL microbial
// reads and cannot be attributed to a specific organism — a gene pinned to the
// wrong organism is a real prescribing error, so the row carries that caveat.
export const blankAmrGene = () => ({
  row_id: makeUid("AG"),
  gene_name: "",
  gene_class: "",
  mechanism: "",
  card_version: "",
  predicted_phenotype: "",
  note: "",
});

// ─── tNGS — targeted NGS for TB drug resistance ───────────────────────────────
// The 2025 WHO pathway places this AFTER a nucleic-acid test, so the prior
// GeneXpert result is part of the record rather than context. Every resistance
// call cites the WHO catalogue confidence group; `tb_classification` is derived
// from the calls (see deriveTbClassification in constants.js) and stored too.

export const blankTngs = () => ({
  order_id: newOrder(),
  technical_name: "",
  submitted_at: "",
  specimen_input: "",
  prior_genexpert: { result: "", rif_resistance: "", performed_at: "" },
  assay_name: "",
  assay_version: "",
  platform: "",
  sequencing_lab: "In-house",
  sequencing_lab_ref: "",
  result_received_at: "",
  pipeline_name: "",
  pipeline_version: "",
  mean_depth_coverage: "",
  loci_above_threshold_pct: "",
  qc_pass: "",
  qc_note: "",
  drug_resistance_calls: [],
  tb_classification: "", // always the value derived from the calls — never typed
  concordance_with_phenotypic_dst: "",
  concordance_note: "",
  lineage: "",
  lineage_tool: "",
  who_regimen_note: "",
  result_file_ref: "",
  prelim: null,
});

export const hydrateTngs = (saved) => {
  const b = blankTngs();
  const o = saved || {};
  return {
    ...b,
    ...o,
    prior_genexpert: { ...b.prior_genexpert, ...(o.prior_genexpert || {}) },
    drug_resistance_calls: arr(o.drug_resistance_calls),
    prelim: o.prelim || null,
  };
};

export const blankResistanceCall = () => ({
  call_id: makeUid("CALL"),
  drug: "",
  mutations_detected: [],
  who_confidence_tier: "",
  predicted_phenotype: "",
  vaf_pct: "",
  heteroresistance: "",
});

// ─── Targeted panels — resistance genotyping and broad-range ID ───────────────
// Holds an ORDERS array, like Tab 8's NAAT: a specimen may legitimately carry
// several targeted panels at once (e.g. a carbapenemase gene panel plus a typing
// run for infection control), and each is its own order with its own result.
//
// One order serves both panel kinds; `panel_kind` decides which row table the
// panel renders. A "resistance" panel reports mutation → drug → predicted R/S.
// An "identity" panel (16S / ITS) reports taxon → identity % → database, and
// carries NO resistance information at all.

export const blankTargetedOrder = () => ({
  order_id: newOrder(),
  technical_name: "",
  submitted_at: "",
  panel: "",
  panel_kind: "",
  loci_targeted: [],
  method: "",
  platform: "",
  sequencing_lab: "In-house",
  sequencing_lab_ref: "",
  result_received_at: "",
  pipeline_name: "",
  pipeline_version: "",
  reference_database: "",
  mean_depth_coverage: "",
  qc_pass: "",
  qc_note: "",
  mutation_rows: [],
  taxa_rows: [],
  // Third panel kind: infection-control typing (spa/SCCmec, ribotype, clade).
  // A typing result is neither a resistance call nor an identification — it is a
  // strain label used to link cases — so it gets its own small block.
  typing: { scheme: "", type_result: "", cluster_id: "", snp_distance: "" },
  interpretation_note: "",
  result_file_ref: "",
  prelim: null,
});

export const hydrateTargetedOrder = (saved) => {
  const b = blankTargetedOrder();
  const o = saved || {};
  return {
    ...b,
    ...o,
    loci_targeted: arr(o.loci_targeted),
    mutation_rows: arr(o.mutation_rows),
    taxa_rows: arr(o.taxa_rows),
    typing: { ...b.typing, ...(o.typing || {}) },
    prelim: o.prelim || null,
  };
};

export const blankTargetedSection = () => ({ orders: [] });

export const hydrateTargetedSection = (saved) => ({
  orders: arr(saved?.orders).map(hydrateTargetedOrder),
});

export const blankMutationRow = () => ({
  row_id: makeUid("MUT"),
  locus: "",
  mutation: "",
  drug: "",
  predicted_phenotype: "",
  confidence: "",
  note: "",
});

export const blankTaxonRow = () => ({
  row_id: makeUid("TAX"),
  taxon_name: "",
  rank: "",
  identity_pct: "",
  database: "",
  note: "",
});

// ─── Specimen-level hydration ─────────────────────────────────────────────────

// Which sub-record the ordered tests switch on. Mirrors GENOMICS_SUBTABS in
// constants.js but at the record level: a sub-tab renders only when its record
// exists, so the two can never disagree.
export const hydrateSpecimen = (saved, tests) => {
  const t = arr(tests);
  const o = saved || {};
  return {
    wgs: t.includes("pathogen_wgs") ? hydrateWgs(o.wgs) : null,
    mngs: t.includes("mngs") ? hydrateMngs(o.mngs) : null,
    tngs: t.includes("tngs_tb") ? hydrateTngs(o.tngs) : null,
    targeted:
      t.includes("amplicon_id") || t.includes("resistance_genotyping") || t.includes("typing_ipc")
        ? hydrateTargetedSection(o.targeted)
        : null,
  };
};
