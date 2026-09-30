// shared/molecularModel.js - Tab 6 (Molecular & Genomic Testing)
//
// Molecular work is recorded as repeatable test orders. The order keeps the
// exact sample reference, assay traceability, result, and review handoff in one
// place. There is intentionally no deep normalizer here; saved records are
// kept as entered so failed and repeated work remains auditable.

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
};

export const YES_NO_OPTIONS = ["Yes", "No"];

export const MOLECULAR_TEST_TYPE_OPTIONS = [
  "NGS panel",
  "PCR",
  "RT-PCR",
  "FISH-ISH",
  "MSI-PCR",
  "TMB",
  "HRD assay",
  "Gene expression signature / RNA-Seq",
  "DNA methylation profiling",
  "Promoter methylation assay",
  "cfDNA / ctDNA",
  "Germline panel",
  // Genome-scale sequencing. capValidation treats these two as tumour-only (the
  // order carries no matched normal sample, so a germline call on one can only be
  // possible) and exempts them from the gene-list requirement, since an exome or
  // genome has no enumerable target list.
  "Whole exome sequencing (WES)",
  "Whole genome sequencing (WGS)",
  "Other",
];

export const MOLECULAR_STATUS_OPTIONS = [
  "Ordered",
  "Sample preparation",
  "Running",
  "Analysis",
  "Reported",
  "Failed",
];

export const SAMPLE_CLASS_OPTIONS = ["Tissue block", "Slide", "Tissue curls / scrolls", "Extracted DNA/RNA", "Blood", "Plasma", "Bone marrow", "Other"];
export const MOLECULAR_MATERIAL_OPTIONS = [
  "To be decided by Molecular",
  "Whole tissue block",
  "Unstained slide",
  "Tissue curls / scrolls",
  "Extracted DNA/RNA",
  "Blood",
  "Plasma",
  "Bone marrow",
  "Other",
];
export const PRIORITY_OPTIONS = ["Routine", "Urgent", "STAT"];
export const PERFORMING_LAB_OPTIONS = ["Internal", "External reference laboratory"];
export const YES_NO_NOT_APPLICABLE_OPTIONS = ["Yes", "No", "Not applicable"];
export const SAMPLE_QC_OPTIONS = ["Not run", "Pass", "Fail", "Borderline"];
export const TISSUE_ADEQUACY_OPTIONS = ["", "Adequate", "Inadequate", "Exhausted"];
export const DISSECTION_OPTIONS = ["Not performed", "Macrodissection", "Microdissection", "Both"];
export const TECHNICAL_QC_OPTIONS = ["Not run", "Pass", "Fail"];
export const MSI_RESULT_OPTIONS = ["Not tested", "Microsatellite stable", "MSI-High", "Indeterminate"];
export const VARIANT_TYPE_OPTIONS = ["SNV", "Indel", "CNV", "Fusion / rearrangement", "Other"];
// What the assay was fed. This is an assay property, not a variant property: a
// fusion breakpoint falls in an intron, so an assay fed DNA reports the fusion as
// wild type unless its panel covers the introns the breakpoint sits in, while RNA
// has the introns already spliced out and shows the junction directly. Without
// this recorded, a "no fusion detected" cannot be read as a true negative.
export const NUCLEIC_ACID_INPUT_OPTIONS = ["Not stated", "DNA", "RNA", "DNA and RNA"];
export const VARIANT_ORIGIN_OPTIONS = ["Somatic", "Possible germline", "Confirmed germline"];
export const RESULT_COMPARISON_OPTIONS = ["Unchanged", "Newly detected", "No longer detected", "Increased", "Decreased", "Not comparable"];
export const GERMLINE_CONFIRMATION_OPTIONS = ["Not indicated", "Pending", "Ordered", "Completed", "Declined"];
export const CONSENT_OPTIONS = ["Pending", "Obtained", "Not required", "Declined"];
export const HRD_STATUS_OPTIONS = ["Not tested", "HRD Positive", "HRD Negative", "Inconclusive"];
export const EXPRESSION_RISK_OPTIONS = ["Not applicable", "Low risk", "Intermediate risk", "High risk", "Indeterminate"];
export const METHYLATION_STATUS_OPTIONS = ["Not tested", "Methylated", "Unmethylated", "Indeterminate", "Not applicable"];

export const makeVariant = () => ({
  variant_id: makeUid("VAR"),
  gene: "",
  transcript: "",
  dna_change: "",
  protein_change: "",
  variant_type: "",
  vaf_percent: "",
  copy_number: "",
  // A fusion is two facts, not one: which gene it joined to (`fusion_partner`),
  // and where it joined (`fusion_detail` — breakpoint, exon, or transcript
  // detail). Both are reported on the variant row that carries the fusion.
  fusion_partner: "",
  fusion_detail: "",
  tier: "",
  classification_system: "",
  clinical_significance: "",
  evidence_source: "",
  interpretation_db_version: "",
  hgvs_genomic: "",
  genome_build: "",
  origin: "",
  zygosity: "",
  notes: "",
});

export const makeMolecularOrder = (orderedBy = "") => ({
  test_order_id: makeUid("MOL"),
  test_type: "",
  test_type_other: "",
  clinical_indication: "",
  requested_by: orderedBy || "",
  request_datetime: "",
  priority: "Routine",
  performing_lab: "Internal",
  lab_name: "",
  status: "Ordered",
  final_report: "",
  report_datetime: "",
  specimen_collection_datetime: "",
  received_datetime: "",
  result_datetime: "",
  source_report_id: "",
  source_lab_system: "",
  previous_test_ref: "",
  // The Microscopy ancillary request this order fulfils, and the review cycle
  // that raised it. The diagnostic question comes from that request.
  request_id: "",
  originating_microscopy_id: "",
  diagnostic_question: "",
  // FISH/ISH is performed and recorded on the staining bench. When this order is
  // a FISH-ISH order it links to that authoritative technical record instead of
  // holding a second copy of it.
  linked_stain_id: "",
  returned_for_integrated_diagnosis: "No",
  returned_datetime: "",

  sample_class: "",
  required_material: "",
  sample_block_id: "",
  sample_slide_id: "",
  sectioning_event_id: "",
  section_count: "",
  sample_description: "",
  selected_area: "",
  collection_datetime: "",
  tumor_cellularity_percent: "",
  necrosis_percent: "",
  dissection: "Not performed",
  tissue_adequacy: "",
  tissue_remaining: "",
  extraction_datetime: "",
  concentration: "",
  quality_score: "",
  sample_qc_result: "Not run",
  failure_reason: "",
  repeat_extraction: "No",
  recollection_required: "No",

  platform: "",
  panel_name: "",
  panel_version: "",
  genes_tested: "",
  methodology: "",
  nucleic_acid_input: "Not stated",
  reference_genome: "",
  coverage_depth: "",
  limit_of_detection: "",
  ctdna_lod: "",
  assay_run_id: "",
  technical_qc_status: "Not run",

  msi_result: "Not tested",
  msi_method: "",
  mmr_import_note: "",
  tmb_value: "",
  tmb_unit: "",
  tmb_method: "",
  tmb_interpretation: "",

  // HRD (Homologous Recombination Deficiency)
  hrd_status: "Not tested",
  hrd_score: "",
  hrd_method: "",
  loh_status: "",

  // Epigenetics & Methylation
  methylation_target: "",
  methylation_status: "Not tested",
  methylation_class: "",
  methylation_classifier_score: "",

  // Transcriptomics & Gene Expression Signatures
  expression_signature_name: "",
  expression_score: "",
  expression_risk_category: "Not applicable",

  no_significant_alteration: "No",
  variants: [],
  actionable_findings: "",
  resistance_findings: "",
  reviewed_by: "",
  review_datetime: "",
  interpretation_comments: "",
  result_comparison: "",

  possible_germline_flagged: "No",
  genetic_counselling_referral: "No",
  consent_status: "Not required",
  germline_confirmation_status: "Not indicated",
  recommended_reflex_testing: "",
});

export const EMPTY_MOLECULAR = {
  orders: [],
  recommendation_runs: [],
};

export const hasRecordedMolecularResult = (order = {}) => {
  const variants = Array.isArray(order?.variants) ? order.variants : [];
  const hasVariant = variants.some((variant) => [
    variant?.gene,
    variant?.dna_change,
    variant?.protein_change,
    variant?.clinical_significance,
  ].some((value) => String(value || "").trim()));
  const hasMsi = !["", "Not tested"].includes(String(order?.msi_result || "").trim());
  const hasTmb = !!String(order?.tmb_value || order?.tmb_interpretation || "").trim();
  const hasHrd = !["", "Not tested"].includes(String(order?.hrd_status || "").trim()) || !!String(order?.hrd_score || "").trim();
  const hasMethylation = !["", "Not tested", "Not applicable"].includes(String(order?.methylation_status || "").trim()) || !!String(order?.methylation_class || "").trim();
  const hasExpression = !["", "Not applicable"].includes(String(order?.expression_risk_category || "").trim()) || !!String(order?.expression_score || "").trim();
  return !!String(order?.final_report || "").trim()
    || hasVariant
    || hasMsi
    || hasTmb
    || hasHrd
    || hasMethylation
    || hasExpression
    || order?.no_significant_alteration === "Yes";
};

export const molecularResultReviewEligibility = (order = {}) => {
  if (order?.status !== "Reported") {
    return { eligible: false, reason: "Set the order status to Reported after the result has been entered." };
  }
  if (order?.sample_qc_result === "Fail" || order?.technical_qc_status === "Fail") {
    return { eligible: false, reason: "AI result review is unavailable while sample or technical QC is failed." };
  }
  if (!hasRecordedMolecularResult(order)) {
    return { eligible: false, reason: "Enter a final report, variant, MSI/TMB result, or no-significant-alteration result first." };
  }
  return { eligible: true, reason: "" };
};

// Blocks are read from Processing and get their current tissue state from the
// latest Sectioning event. Only IDs and lineage are copied into the worklist.
export const molecularBlocks = (processing = {}, sectioning = {}, grossing = {}) => {
  const labels = new Map(
    (Array.isArray(grossing?.records) ? grossing.records : [])
      .flatMap((record) => (Array.isArray(record?.cassettes) ? record.cassettes : []))
      .map((cassette) => [cassette.cassette_id, cassette.label || ""])
  );
  const statusByBlock = new Map();
  (Array.isArray(sectioning?.events) ? sectioning.events : []).forEach((event) => {
    if (event?.block_id && event.block_status) statusByBlock.set(event.block_id, event.block_status);
  });
  return (Array.isArray(processing?.cassettes) ? processing.cassettes : [])
    .flatMap((entry) => (Array.isArray(entry?.blocks) ? entry.blocks : []).map((block) => ({
      block_id: block.block_id || "",
      cassette_id: entry.cassette_id || "",
      cassette_label: labels.get(entry.cassette_id) || "",
      parent_specimen_id: entry.parent_specimen_id || "",
      block_status: statusByBlock.get(block.block_id) || "",
      ready_for_sectioning: entry.ready_for_sectioning || "No",
    })))
    .filter((block) => block.block_id);
};

export const molecularSlides = (sectioning = {}, grossing = {}) => {
  const labels = new Map(
    (Array.isArray(grossing?.records) ? grossing.records : [])
      .flatMap((record) => (Array.isArray(record?.cassettes) ? record.cassettes : []))
      .map((cassette) => [cassette.cassette_id, cassette.label || ""])
  );
  return (Array.isArray(sectioning?.events) ? sectioning.events : [])
    .flatMap((event) => (Array.isArray(event?.slides) ? event.slides : []).map((slide) => ({
      slide_id: slide.slide_id || "",
      parent_block_id: slide.parent_block_id || event.block_id || "",
      event_id: event.event_id || "",
      cassette_label: labels.get(event.cassette_id) || "",
      intended_use: slide.intended_use || "",
      level: slide.level || "",
      released: event.ready_for_staining === "Yes",
    })))
    .filter((slide) => slide.slide_id && ["Molecular", "Unstained reserve"].includes(slide.intended_use));
};

export const molecularSectioningOutputs = (sectioning = {}) =>
  (Array.isArray(sectioning?.events) ? sectioning.events : [])
    .filter((event) => event?.event_id && event.output_material_type === "Tissue curls / scrolls")
    .map((event) => ({
      event_id: event.event_id,
      request_id: event.request_id || "",
      block_id: event.block_id || "",
      output_quantity: event.output_quantity || "",
      output_container: event.output_container || "",
      sectioning_datetime: event.sectioning_datetime || "",
    }));

// MMR is one authoritative result assembled from two records: the antibody work
// belongs to Staining, and the retained / lost call belongs to the pathologist in
// Microscopy. Molecular reads that assembled projection through
// mmrAncillaryResults() in shared/microscopyModel.js and never stores a copy —
// see the ancillary-result ownership split.

// FISH/ISH stays authoritative on the staining bench. Molecular reads those
// technical records so a FISH-ISH order can point at one instead of creating a
// second result. The pathologist's amplified / rearranged call is in Microscopy.
export const stainingFishRecords = (staining = {}) => (Array.isArray(staining?.records) ? staining.records : [])
  .filter((record) => record?.stain_id && record.modality === "FISH")
  .map((record) => ({
    stain_id: record.stain_id,
    gene_target: record.fish?.gene_target || "",
    probe_kit: record.fish?.probe_kit || "",
    lot: record.fish?.lot || "",
    cells_counted: record.fish?.cells_counted || "",
    signal_ratio: record.fish?.signal_ratio || "",
    copy_number: record.fish?.copy_number || "",
    signal_quality: record.fish?.signal_quality || "",
    status: record.status || "",
    control_result: record.control_result || "",
    slide_id: record.slide_id || "",
    parent_block_id: record.parent_block_id || "",
  }));

// Pathologist requests for molecular work that have no order yet. The request is
// owned by Microscopy; Molecular only fulfils it and keeps the link.
export const openMolecularRequests = (microscopy = {}, molecular = {}) => {
  const ordered = new Set(
    (Array.isArray(molecular?.orders) ? molecular.orders : [])
      .map((order) => order.request_id)
      .filter(Boolean)
  );
  return (Array.isArray(microscopy?.ancillary_requests) ? microscopy.ancillary_requests : [])
    .filter((request) => request?.request_id
      && request.cancelled !== "Yes"
      && request.request_type === "Molecular test"
      && !ordered.has(request.request_id))
    .map((request) => ({
      request_id: request.request_id,
      targets: (Array.isArray(request.requested_items) ? request.requested_items : [])
        .map((item) => item.target || "unnamed")
        .join(", "),
      diagnostic_question: request.diagnostic_question || "",
      priority: request.priority || "Routine",
      requested_by: request.requested_by || "",
      request_datetime: request.request_datetime || "",
      originating_microscopy_id: request.originating_microscopy_id || "",
      source_specimen_id: request.source_specimen_id || "",
      preferred_block_id: request.preferred_block_id || "",
    }));
};

export const materialSampleClass = (material = "", hasPreferredBlock = false) => {
  if (material === "Whole tissue block") return "Tissue block";
  if (material === "Unstained slide") return "Slide";
  if (material === "Tissue curls / scrolls") return "Tissue curls / scrolls";
  if (material === "Extracted DNA/RNA") return "Extracted DNA/RNA";
  if (["Blood", "Plasma", "Bone marrow", "Other"].includes(material)) return material;
  return hasPreferredBlock ? "Tissue block" : "";
};

// Create the order from the request, so the question, priority and the link back
// to the review that asked for it are set before anything is saved.
export const makeMolecularOrderFromRequest = (request = {}, orderedBy = "") => ({
  ...makeMolecularOrder(request.requested_by || orderedBy),
  clinical_indication: request.diagnostic_question || "",
  diagnostic_question: request.diagnostic_question || "",
  priority: request.priority || "Routine",
  request_id: request.request_id || "",
  originating_microscopy_id: request.originating_microscopy_id || "",
  sample_class: materialSampleClass(request.required_material || "", !!request.preferred_block_id),
  required_material: request.required_material || "",
  sample_block_id: request.preferred_block_id || "",
  requested_by: request.requested_by || orderedBy || "",
});

export const syncMolecular = (molecular = {}) => ({
  orders: Array.isArray(molecular?.orders) ? molecular.orders : [],
  recommendation_runs: Array.isArray(molecular?.recommendation_runs)
    ? molecular.recommendation_runs.slice(-20)
    : [],
});

// ─── Dictation merge ─────────────────────────────────────────────────────────
// Dictation is a suggestion, not an entry. Extracted values fill fields the
// pathologist has left empty — or still sitting on an unstated factory default —
// and never overwrite a recorded value; free text is snapped to the canonical
// dropdown option, and numbers are stripped of their units. Identity, lineage,
// links, timestamps, staff, workflow state and provenance are never writable
// from a transcript. Dictated variant rows are minted only when the order has
// none yet, so the AI can never duplicate recorded variant work. Local copies of
// the transcribeMerge helpers' behaviour are kept here so the model stays
// import-free like the other pathology models.

const MOLECULAR_PROTECTED_FIELDS = new Set([
  // Identity and links
  "test_order_id", "request_id", "originating_microscopy_id", "linked_stain_id",
  // Lineage to upstream inventory
  "sample_block_id", "sample_slide_id", "sectioning_event_id",
  // Identifiers / references to other reports
  "assay_run_id", "source_report_id", "source_lab_system", "previous_test_ref",
  // Workflow state and internal provenance
  "status", "returned_for_integrated_diagnosis", "mmr_import_note",
  // Staff and timestamps
  "requested_by", "reviewed_by", "request_datetime", "specimen_collection_datetime",
  "collection_datetime", "received_datetime", "extraction_datetime",
  "result_datetime", "review_datetime", "report_datetime", "returned_datetime",
  "dictation",
]);

const MOLECULAR_ENUM_FIELDS = {
  test_type: MOLECULAR_TEST_TYPE_OPTIONS,
  priority: PRIORITY_OPTIONS,
  performing_lab: PERFORMING_LAB_OPTIONS,
  required_material: MOLECULAR_MATERIAL_OPTIONS,
  sample_class: SAMPLE_CLASS_OPTIONS,
  dissection: DISSECTION_OPTIONS,
  tissue_adequacy: TISSUE_ADEQUACY_OPTIONS,
  sample_qc_result: SAMPLE_QC_OPTIONS,
  repeat_extraction: YES_NO_OPTIONS,
  recollection_required: YES_NO_OPTIONS,
  technical_qc_status: TECHNICAL_QC_OPTIONS,
  nucleic_acid_input: NUCLEIC_ACID_INPUT_OPTIONS,
  msi_result: MSI_RESULT_OPTIONS,
  hrd_status: HRD_STATUS_OPTIONS,
  methylation_status: METHYLATION_STATUS_OPTIONS,
  expression_risk_category: EXPRESSION_RISK_OPTIONS,
  no_significant_alteration: YES_NO_OPTIONS,
  result_comparison: RESULT_COMPARISON_OPTIONS,
  possible_germline_flagged: YES_NO_OPTIONS,
  genetic_counselling_referral: YES_NO_OPTIONS,
  consent_status: CONSENT_OPTIONS,
  germline_confirmation_status: GERMLINE_CONFIRMATION_OPTIONS,
};

const MOLECULAR_VARIANT_ENUM_FIELDS = {
  variant_type: VARIANT_TYPE_OPTIONS,
  origin: VARIANT_ORIGIN_OPTIONS,
};

const MOLECULAR_NUMBER_FIELDS = new Set([
  "section_count", "tumor_cellularity_percent", "necrosis_percent", "tmb_value",
  "hrd_score", "expression_score", "methylation_classifier_score",
]);

const MOLECULAR_VARIANT_NUMBER_FIELDS = new Set(["vaf_percent", "copy_number"]);

// These fields ship with a factory default, so a plain "only fill what is empty"
// merge could never let a dictated active value land (e.g. a dictated "STAT"
// onto the default "Routine"). A value still sitting on its default counts as
// unstated; a recorded value that differs from the default is never overwritten.
const MOLECULAR_DEFAULTED_FIELDS = {
  priority: "Routine",
  performing_lab: "Internal",
  dissection: "Not performed",
  sample_qc_result: "Not run",
  repeat_extraction: "No",
  recollection_required: "No",
  technical_qc_status: "Not run",
  nucleic_acid_input: "Not stated",
  msi_result: "Not tested",
  hrd_status: "Not tested",
  methylation_status: "Not tested",
  expression_risk_category: "Not applicable",
  no_significant_alteration: "No",
  possible_germline_flagged: "No",
  genetic_counselling_referral: "No",
  consent_status: "Not required",
  germline_confirmation_status: "Not indicated",
};

const isEmpty = (value) => value === undefined || value === null || value === ""
  || (Array.isArray(value) && value.length === 0);

const canon = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

const NO_SYNONYMS = ["absent", "notidentified", "notseen", "notpresent", "notdetected", "none", "negative", "nil"];
const YES_SYNONYMS = ["present", "identified", "seen", "detected", "positive"];

const snapToOption = (value, options) => {
  const target = canon(value);
  if (!target) return "";
  const exact = options.find((option) => canon(option) === target);
  if (exact) return exact;
  const loose = options.find((option) => {
    const key = canon(option);
    return key.length >= 3 && (target.includes(key) || key.includes(target));
  });
  if (loose) return loose;
  const yesNo = options.length === 2 && options.includes("Yes") && options.includes("No");
  if (yesNo) {
    if (NO_SYNONYMS.some((word) => target.includes(word))) return "No";
    if (YES_SYNONYMS.some((word) => target.includes(word))) return "Yes";
  }
  return "";
};

const bareNumber = (value) => {
  if (typeof value === "number") return String(value);
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? match[0] : "";
};

const mintVariantFromDictation = (patch = {}) => {
  const variant = makeVariant();
  Object.entries(patch).forEach(([key, value]) => {
    if (key === "variant_id" || !(key in variant) || MOLECULAR_PROTECTED_FIELDS.has(key) || isEmpty(value)) return;
    if (MOLECULAR_VARIANT_ENUM_FIELDS[key]) {
      const snapped = snapToOption(value, MOLECULAR_VARIANT_ENUM_FIELDS[key]);
      if (snapped) variant[key] = snapped;
    } else if (MOLECULAR_VARIANT_NUMBER_FIELDS.has(key)) {
      variant[key] = bareNumber(value);
    } else {
      variant[key] = value;
    }
  });
  return variant;
};

/**
 * Merge one structured-dictation response into a molecular test order, filling
 * only fields the pathologist left empty (or sitting on an unstated factory
 * default). Never touches protected identity, lineage, links, timestamps, staff,
 * workflow state or provenance keys. Free text is snapped to the canonical
 * dropdown option and numbers stripped to a bare value. Dictated variant rows
 * are minted only when the order has none recorded yet.
 *
 * @param {object} order  current molecular test order
 * @param {object} patch  `data` from POST /molecular/structure
 * @returns {object}      merged order (advisory; the pathologist confirms on save)
 */
export const mergeMolecularExtraction = (order = {}, patch = {}) => {
  const next = { ...order };

  // Scalar order-level fields first. `variants` is handled below.
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key === "variants") return;
    if (!(key in next) || MOLECULAR_PROTECTED_FIELDS.has(key)) return;
    if (isEmpty(value)) return;

    const current = next[key];
    const factoryDefault = MOLECULAR_DEFAULTED_FIELDS[key];
    const recorded = factoryDefault === undefined
      ? !isEmpty(current)
      : !isEmpty(current) && current !== factoryDefault;
    if (recorded) return;

    if (MOLECULAR_ENUM_FIELDS[key]) {
      const snapped = snapToOption(value, MOLECULAR_ENUM_FIELDS[key]);
      if (!snapped) return;
      // A field sitting on an unstated "No" default is overridden only by an
      // active stated "Yes"; a dictated "No" is never written by dictation (the
      // Cytopathology precedent). For the other defaults only an active value
      // that actually changes the default lands — writing the default back is a
      // no-op.
      if (factoryDefault === "No" && snapped === "No") return;
      if (factoryDefault !== undefined && snapped === factoryDefault) return;
      next[key] = snapped;
      return;
    }
    next[key] = MOLECULAR_NUMBER_FIELDS.has(key) ? bareNumber(value) : value;
  });

  // Same derivation the manual "Required Molecular Material" dropdown performs:
  // choosing a material implies the sample class when none was recorded.
  if (!isEmpty(next.required_material) && isEmpty(next.sample_class)) {
    next.sample_class = materialSampleClass(next.required_material, false);
  }

  // Variant rows are minted from the dictation only when the order has none yet,
  // so the AI can never duplicate or overwrite recorded variant work.
  const dictated = Array.isArray(patch?.variants) ? patch.variants : [];
  if (dictated.length && isEmpty(order.variants)) {
    next.variants = dictated.map(mintVariantFromDictation);
  }
  return next;
};

/**
 * What a merge actually did, so the UI can report it instead of claiming a fill
 * it cannot see (see mergeCytopathologyReport in shared/cytopathologyModel.js).
 *
 *   filled     fields the merge wrote
 *   unmatched  fields the model returned a value for that did NOT land — either
 *              the pathologist had already recorded something (correctly left
 *              alone), the value matched no dropdown option and was dropped, or
 *              dictated variants were ignored because rows already existed
 *
 * @param {object} before  the order as it was
 * @param {object} after   the order returned by mergeMolecularExtraction
 * @param {object} patch   the extraction response that was merged in
 */
export const mergeMolecularReport = (before = {}, after = {}, patch = {}) => {
  const filled = [];
  const unmatched = [];
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (key === "variants" || isEmpty(value) || !(key in before)) return;
    if (String(after[key] ?? "") !== String(before[key] ?? "") && !isEmpty(after[key])) {
      filled.push(key);
    } else {
      unmatched.push(key);
    }
  });
  const dictated = Array.isArray(patch?.variants) ? patch.variants : [];
  if (dictated.length) {
    if (isEmpty(before.variants) && !isEmpty(after.variants)) filled.push("variants");
    else unmatched.push("variants");
  }
  return { filled, unmatched };
};
