// Lightweight Tab 7 model. Cytology is recorded separately from the routine
// histology path and keeps references to the accessioned specimen plus any
// cell-block, staining, or molecular work created from it.
//
// Cytology IS microscope work — cells on a slide, screened and then read — so it
// sits with the microscope tabs in the sidebar. What it does not have is a
// resection, which is why Synoptic and pT/pN do not apply to a cytology-only
// case. See shared/caseClass.js.

import { CYTOLOGY_ACCESSION_TYPES } from "./caseClass";

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
};

export const YES_NO_OPTIONS = ["Yes", "No"];
export const CYTOLOGY_SPECIMEN_TYPES = [
  "FNAC", "Brushing", "Washing", "Sputum", "BAL", "CSF", "Urine",
  "Body-cavity fluid", "Cervical cytology", "Other",
];
export const COLLECTION_METHOD_OPTIONS = ["Fine-needle aspiration", "Endoscopic brushing", "Endoscopic washing", "Spontaneous collection", "Image-guided aspiration", "Other"];
export const PREPARATION_METHOD_OPTIONS = ["Direct smear", "Cytospin", "Liquid-based", "Cell block", "Other"];
export const ADEQUACY_OPTIONS = ["Adequate", "Limited", "Inadequate", "Unsatisfactory"];
export const ROSE_RESULT_OPTIONS = ["Diagnostic material present", "Scant / limited material", "Non-diagnostic", "Not recorded"];
export const REPORTING_SYSTEM_OPTIONS = ["Bethesda System", "Paris System", "Yokohama System", "Milan System", "WHO Reporting System", "TPS / IASLC", "Other", "Not specified"];
export const REPORT_STATUS_OPTIONS = ["Draft", "Preliminary", "Final", "Amended"];
export const BACKGROUND_OPTIONS = ["Necrosis", "Inflammation", "Mucin", "Blood", "Other"];
export const ANCILLARY_TEST_OPTIONS = ["Cell block", "IHC", "Flow cytometry", "Molecular", "Other"];

export const DIAGNOSTIC_CATEGORIES = {
  "Bethesda System": ["Nondiagnostic", "Benign", "Atypia of undetermined significance", "Follicular neoplasm", "Suspicious for malignancy", "Malignant"],
  "Paris System": ["Non-diagnostic", "Negative for high-grade urothelial carcinoma", "Atypical urothelial cells", "Suspicious for high-grade urothelial carcinoma", "High-grade urothelial carcinoma", "Other malignancy"],
  "Yokohama System": ["Insufficient", "Benign", "Atypical", "Suspicious for malignancy", "Malignant"],
  "Milan System": ["Non-diagnostic", "Non-neoplastic", "Atypia of undetermined significance", "Neoplasm: uncertain malignant potential", "Suspicious for malignancy", "Malignant"],
  "WHO Reporting System": ["Non-diagnostic", "Negative for malignancy", "Atypical", "Suspicious for malignancy", "Malignant"],
  "TPS / IASLC": ["Unsatisfactory", "Negative for malignancy", "Atypical", "Suspicious for malignancy", "Malignant"],
};

export const diagnosticCategoriesFor = (system) => DIAGNOSTIC_CATEGORIES[system] || ["Not specified", "Benign / negative", "Atypical", "Suspicious for malignancy", "Malignant", "Other"];

// ─── Metastatic (M1) evidence helpers ────────────────────────────────────────
// A fluid-compartment cytology that is positive for malignant cells is a
// pathology-confirmed distant-metastasis finding (a malignant pleural/pericardial/
// peritoneal effusion is M1a in lung, M1 for breast, etc.) even when no resection
// exists. TNM Staging uses these helpers to surface such records as traceable pM1
// evidence instead of leaving the staging M category to unverifiable free text.
//
// specimen_type here is the CYTOLOGY_SPECIMEN_TYPES value on the record, not the
// Case Registry accession type.

// Compartments whose positive cytology can only mean spread, never the primary.
export const FLUID_COMPARTMENT_SPECIMEN_TYPES = ["Body-cavity fluid", "CSF"];

const CONFIRMED_POSITIVE_CATEGORIES = new Set([
  "Malignant",                        // Bethesda / Yokohama / Milan / WHO / TPS-IASLC
  "High-grade urothelial carcinoma",  // Paris
  "Other malignancy",                 // Paris
]);

/**
 * How strongly a cytology record asserts malignancy, if at all.
 * "confirmed" — a definitive positive diagnostic category (needs a M staging read).
 * "suspicious" — atypical/suspicious language or `malignant_or_suspicious_cells`,
 *                explicitly NOT enough to call M1.
 * null — no malignancy asserted (benign / negative / non-diagnostic / untouched).
 */
export const cytologyMalignancy = (record = {}) => {
  if (!record) return null;
  const category = String(record.diagnostic_category || "").trim();
  if (CONFIRMED_POSITIVE_CATEGORIES.has(category)) return "confirmed";
  if (!/suspicious|atypical|atypia|uncertain|follicular neoplasm|neoplasm/i.test(category)
    && /malignant|malignancy|high-grade|positive for|tumor cells/i.test(category)) return "confirmed";
  if (/suspicious|atypical|atypia|uncertain|follicular neoplasm|neoplasm/i.test(category)) return "suspicious";
  if (record.malignant_or_suspicious_cells === "Yes") return "suspicious";
  return null;
};

/** A fluid-compartment record confirmed positive for malignant cells → M1 evidence. */
export const isMetastaticCytologyRecord = (record = {}) =>
  FLUID_COMPARTMENT_SPECIMEN_TYPES.includes(record.specimen_type) && cytologyMalignancy(record) === "confirmed";

/** Does any cytology record on the case assert malignancy (confirmed or suspicious)? */
export const hasPositiveCytology = (records = []) =>
  (Array.isArray(records) ? records : []).some((record) => cytologyMalignancy(record) === "confirmed" || record?.malignant_or_suspicious_cells === "Yes");

// The assistant is deliberately unavailable for an untouched record. Adequacy,
// ROSE, morphology, or a reporting-system/category entry is enough to make the
// focused review clinically meaningful; preparation/accession data alone is not.
export const hasMeaningfulCytologyContent = (record = {}) => Boolean(
  record.adequacy
  || String(record.cytomorphologic_findings || "").trim()
  || String(record.cellularity || "").trim()
  || (record.rose_performed === "Yes" && record.rose_result && record.rose_result !== "Not recorded")
  || record.reporting_system
  || record.diagnostic_category
  || String(record.cytologic_diagnosis || "").trim()
);

// An optional cytology slide image. A smear, LBC or cell-block slide may be
// digitised into the shared WSI service (the viewer writes `wsi_id` on upload)
// or referenced by link / photograph. The array is pure storage: never read by
// the model, never part of a completeness check, saved only when filled. Its
// shape mirrors Microscopy's image record so the shared SlideImageViewer renders
// both unchanged.
export const makeCytologyImage = () => ({
  image_id: makeUid("IMG"),
  image_type: "Whole-slide image",
  viewer_link: "",
  reference: "",
  note: "",
});

export const makeCytologyRecord = (reviewer = "") => ({
  cytology_id: makeUid("CYT"),
  specimen_id: "",
  specimen_type: "",
  specimen_type_other: "",
  anatomic_site: "",
  sub_site: "",
  laterality: "",
  procedure: "",
  collection_method: "",
  collection_method_other: "",
  imaging_guidance_used: "",
  imaging_report_reference: "",
  fluid_volume_ml: "",
  gross_appearance: "",
  smears_received: "",
  preparation_method: "",
  preparation_method_other: "",
  fixation: "",
  stain_used: "",

  cell_block_available: "No",
  cell_block_id: "",
  cell_block_description: "",

  adequacy: "",
  adequacy_reason: "",
  rose_performed: "No",
  rose_passes: "",
  rose_result: "",
  rose_additional_pass_recommendation: "",
  repeat_collection_recommended: "No",

  cellularity: "",
  cytomorphologic_findings: "",
  background_findings: [],
  background_other: "",
  malignant_or_suspicious_cells: "",
  reporting_system: "",
  reporting_system_version: "",
  diagnostic_category: "",
  diagnostic_category_other: "",
  cytologic_diagnosis: "",
  comments: "",
  ancillary_tests_requested: [],
  ancillary_other: "",
  diagnostic_question: "",
  prior_pathology_reference: "",
  imaging_correlation: "",
  reviewed_by: reviewer || "",
  report_datetime: "",
  report_status: "Draft",
  images: [],
});

export const EMPTY_CYTOPATHOLOGY = { records: [], recommendation_runs: [] };

export const cytologySpecimens = (caseRegister = {}) =>
  (Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : [])
    .filter((specimen) => specimen?.specimen_id)
    .map((specimen) => ({
      specimen_id: specimen.specimen_id,
      specimen_type: specimen.specimen_type || "",
      anatomic_site: specimen.anatomic_site || "",
      sub_site: specimen.sub_site || "",
      laterality: specimen.laterality || "",
      procedure: specimen.procedure || "",
      imaging_guidance_used: specimen.imaging_guidance_used || "",
      imaging_report_reference: specimen.imaging_report_reference || "",
    }))
    .filter(isCytologyCompatibleSpecimen);

export const syncCytopathology = (data = {}, caseRegister = {}) => {
  const specimens = cytologySpecimens(caseRegister);
  const allSpecimens = caseRegistrySpecimens(caseRegister);
  const ids = new Set(allSpecimens.map((specimen) => specimen.specimen_id));
  const records = (Array.isArray(data?.records) ? data.records : [])
    .filter((record) => record && (!record.specimen_id || ids.has(record.specimen_id)))
    .map((record) => ({ ...makeCytologyRecord(), ...record, cytology_id: record.cytology_id || makeUid("CYT") }));
  return {
    records,
    recommendation_runs: Array.isArray(data?.recommendation_runs) ? data.recommendation_runs.slice(-20) : [],
  };
};

export const makeCellBlockId = () => makeUid("CBK");

/**
 * The ancillary work actually done on a cytology record's cell block, traced
 * through the real lineage rather than typed by hand.
 *
 * Once the cell block enters Processing as a cassette-equivalent
 * (processingInputs() in shared/processingModel.js), the chain is:
 *
 *   cell_block_id → processing entry → block_id → sectioning slide_id → stain_id
 *
 * so the links are derivable and the old free-text "comma-separated stain IDs"
 * fields were both redundant and a place for a typo to hide. Nothing here is
 * stored; it is recomputed on every render like every other derived count.
 */
export const cytologyAncillaryWork = (record = {}, sources = {}) => {
  const cellBlockId = record?.cell_block_id;
  if (!cellBlockId) return { blocks: [], slides: [], stains: [], molecularOrders: [] };

  const blockIds = new Set(
    (Array.isArray(sources.processing?.cassettes) ? sources.processing.cassettes : [])
      .filter((entry) => entry?.cassette_id === cellBlockId)
      .flatMap((entry) => (Array.isArray(entry.blocks) ? entry.blocks : []))
      .map((block) => block?.block_id)
      .filter(Boolean),
  );

  const slideIds = new Set(
    (Array.isArray(sources.sectioning?.events) ? sources.sectioning.events : [])
      .filter((event) => blockIds.has(event?.block_id))
      .flatMap((event) => (Array.isArray(event.slides) ? event.slides : []))
      .map((slide) => slide?.slide_id)
      .filter(Boolean),
  );

  const stains = (Array.isArray(sources.staining?.records) ? sources.staining.records : [])
    .filter((stain) => stain?.stain_id && (slideIds.has(stain.slide_id) || blockIds.has(stain.parent_block_id)));

  const molecularOrders = (Array.isArray(sources.molecular?.orders) ? sources.molecular.orders : [])
    .filter((order) => order?.test_order_id
      && (blockIds.has(order.sample_block_id) || slideIds.has(order.sample_slide_id)));

  return {
    blocks: [...blockIds],
    slides: [...slideIds],
    stains,
    molecularOrders,
  };
};

// Case Registry contains both histology and cytology material. Only these
// accession types can start a new Cytopathology record; a routine tissue block
// or an already-derived cell block must not be reclassified as cytology. The set
// is owned by shared/caseClass.js so the sidebar's not-applicable state and this
// record's specimen filter can never disagree.
export const CYTOLOGY_CASE_SPECIMEN_TYPES = CYTOLOGY_ACCESSION_TYPES;

export const caseRegistrySpecimens = (caseRegister = {}) =>
  (Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : [])
    .filter((specimen) => specimen?.specimen_id)
    .map((specimen) => ({
      specimen_id: specimen.specimen_id,
      specimen_type: specimen.specimen_type || "",
      anatomic_site: specimen.anatomic_site || "",
      sub_site: specimen.sub_site || "",
      laterality: specimen.laterality || "",
      procedure: specimen.procedure || "",
      imaging_guidance_used: specimen.imaging_guidance_used || "",
      imaging_report_reference: specimen.imaging_report_reference || "",
    }));

export const isCytologyCompatibleSpecimen = (specimen = {}) =>
  CYTOLOGY_CASE_SPECIMEN_TYPES.has(specimen.specimen_type);


// ─── Dictation merge ─────────────────────────────────────────────────────────
// Dictation is a suggestion, not an entry. Extracted values fill fields the
// pathologist has left empty and never overwrite something already recorded;
// free text is snapped to the canonical dropdown option, list fields are snapped
// to their option list, and numbers are stripped of their units. Identity,
// lineage, links, images, provenance and the Case-Registry-read-only fields are
// never writable from a transcript.

const CYTOLOGY_PROTECTED_FIELDS = new Set([
  "cytology_id", "specimen_id", "cell_block_id", "images", "dictation",
  "reviewed_by", "report_datetime", "report_status",
  // Registry-read-only context that lives on the record only as display defaults.
  "anatomic_site", "sub_site", "laterality", "procedure",
  "imaging_guidance_used", "imaging_report_reference", "prior_pathology_reference",
]);

const CYTOLOGY_ENUM_FIELDS = {
  specimen_type: CYTOLOGY_SPECIMEN_TYPES,
  collection_method: COLLECTION_METHOD_OPTIONS,
  preparation_method: PREPARATION_METHOD_OPTIONS,
  adequacy: ADEQUACY_OPTIONS,
  rose_performed: YES_NO_OPTIONS,
  rose_result: ROSE_RESULT_OPTIONS,
  repeat_collection_recommended: YES_NO_OPTIONS,
  malignant_or_suspicious_cells: YES_NO_OPTIONS,
  reporting_system: REPORTING_SYSTEM_OPTIONS,
  cell_block_available: YES_NO_OPTIONS,
};

// List fields snap each element to the canonical option list; a dictated value
// outside the list belongs in the matching "*_other" free-text field.
const CYTOLOGY_ARRAY_FIELDS = {
  background_findings: BACKGROUND_OPTIONS,
  ancillary_tests_requested: ANCILLARY_TEST_OPTIONS,
};

const CYTOLOGY_NUMBER_FIELDS = new Set(["fluid_volume_ml", "smears_received", "rose_passes"]);

// These Yes/No fields default to "No" in makeCytologyRecord, so a plain
// "only fill what is empty" merge could never let a dictated "Yes" land. The
// pathologist actively dictating a positive finding overrides the unstated
// default (the Processing precedent), while a "No" is never written by dictation.
const CYTOLOGY_DEFAULT_NO_FIELDS = new Set([
  "rose_performed", "repeat_collection_recommended", "cell_block_available",
]);

const isEmpty = (value) => value === undefined || value === null || value === ""
  || (Array.isArray(value) && value.length === 0);

// Local copies of the transcribeMerge helpers' behaviour, kept here so the model
// stays import-free like the other pathology models.
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

const snapList = (values, options) => (Array.isArray(values) ? values
  .map((value) => snapToOption(value, options))
  .filter(Boolean) : []);

const bareNumber = (value) => {
  if (typeof value === "number") return String(value);
  const match = String(value ?? "").match(/-?\d+(\.\d+)?/);
  return match ? match[0] : "";
};

// `reporting_system` may land in the same pass as `diagnostic_category`, and the
// valid categories depend on the system — so a category is snapped only once the
// merged reporting_system is known, and only when the pathologist had not already
// recorded one (a recorded category is never rewritten).
const mergeDiagnosticCategory = (record, next) => {
  if (!isEmpty(record.diagnostic_category) || isEmpty(next.diagnostic_category)) return next;
  const category = snapToOption(next.diagnostic_category, diagnosticCategoriesFor(next.reporting_system));
  return category ? { ...next, diagnostic_category: category } : next;
};

/**
 * Merge one structured-dictation response into a cytology record, filling only
 * fields the pathologist left empty (or sitting on a default "No" that the
 * dictation overrides with a stated "Yes"). Never touches protected identity,
 * lineage, registry or provenance keys. Free text is snapped to the canonical
 * dropdown option, list fields to their option lists, and numbers stripped to a
 * bare value. A dictated "cell block available: Yes" mints the cell-block ID the
 * same way the manual dropdown does.
 *
 * @param {object} record  current cytology record
 * @param {object} patch   `data` from POST /cytopathology/structure
 * @returns {object}       merged record (advisory; the pathologist confirms on save)
 */
export const mergeCytopathologyExtraction = (record = {}, patch = {}) => {
  const next = { ...record };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (!(key in next) || CYTOLOGY_PROTECTED_FIELDS.has(key)) return;
    if (isEmpty(value)) return;

    const current = next[key];
    const recorded = !isEmpty(current)
      && !(CYTOLOGY_DEFAULT_NO_FIELDS.has(key) && current === "No");

    if (CYTOLOGY_ARRAY_FIELDS[key]) {
      if (isEmpty(current)) {
        const snapped = snapList(value, CYTOLOGY_ARRAY_FIELDS[key]);
        if (snapped.length) next[key] = snapped;
      }
      return;
    }
    if (recorded) return;
    if (CYTOLOGY_ENUM_FIELDS[key]) {
      const snapped = snapToOption(value, CYTOLOGY_ENUM_FIELDS[key]);
      // A dictated "No" must not clobber a field the pathologist is leaving at
      // its unspoken default; only a stated "Yes" overrides a default "No".
      if (snapped && !(CYTOLOGY_DEFAULT_NO_FIELDS.has(key) && snapped === "No")) next[key] = snapped;
      return;
    }
    next[key] = CYTOLOGY_NUMBER_FIELDS.has(key) ? bareNumber(value) : value;
  });

  const withCategory = mergeDiagnosticCategory(record, next);
  // Same minting the UI's manual "Cell Block" dropdown performs on "Yes".
  if (withCategory.cell_block_available === "Yes" && !withCategory.cell_block_id) {
    return { ...withCategory, cell_block_id: makeCellBlockId() };
  }
  return withCategory;
};

/**
 * What a merge actually did, so the UI can report it instead of claiming a fill
 * it cannot see. A partial fill used to be indistinguishable from a complete one.
 *
 *   filled     fields the merge wrote
 *   unmatched  fields the model returned a value for that did NOT land — either
 *              the pathologist had already recorded something (correctly left
 *              alone), or the value matched no dropdown option and was dropped
 *
 * @param {object} before  the record as it was
 * @param {object} after   the record returned by mergeCytopathologyExtraction
 * @param {object} patch   the extraction response that was merged in
 */
export const mergeCytopathologyReport = (before = {}, after = {}, patch = {}) => {
  const filled = [];
  const unmatched = [];
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (isEmpty(value) || !(key in before)) return;
    if (String(after[key] ?? "") !== String(before[key] ?? "") && !isEmpty(after[key])) {
      filled.push(key);
    } else {
      unmatched.push(key);
    }
  });
  return { filled, unmatched };
};
