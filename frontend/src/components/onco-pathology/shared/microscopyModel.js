// shared/microscopyModel.js — Tab 8 (Microscopy) data model
//
// Microscopy is the pathologist's workspace at the microscope. It owns three
// repeatable structures:
//
//   reviews[]              one per review cycle (initial H&E, deeper levels,
//                          post-stain, post-IHC, post-FISH/ISH, integrated).
//                          Earlier cycles are never overwritten.
//   ancillary_requests[]   why additional work is needed, and what was asked for.
//   ancillary_results[]    what the pathologist observed on one returned stained
//                          slide — one record per stain_id.
//
// Scope boundary: everything here is read down a microscope. Special stains, IHC
// and FISH/ISH qualify — FISH is signal counting per nucleus on a fluorescence
// scope. Molecular testing does NOT: it is DNA/RNA, it has no slide, and its
// interpretation belongs to Molecular. Molecular work reaches the diagnosis
// through the `integration` section, not through a microscopy review cycle.
// Microscopy still RAISES molecular requests and tracks them — only the fake
// interpretation leg was removed.
//
// Ownership split (onco_pathology_ancillary_result_ownership_change.md):
// Staining records what the laboratory performed and whether it was technically
// valid; Microscopy records what the pathologist saw and what it means. A result
// record therefore stores ONLY a reference (stain_id) — never a copy of the
// marker, clone, control, lot, run or platform. The complete result is assembled
// on read by completeAncillaryResults().

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
};

// ─── Review-cycle option sets ────────────────────────────────────────────────

// "Integrated review" stays: re-reading the H&E in the light of everything else
// is legitimate microscope work. It is the integrated *assessment* that moved out
// to the `integration` section, not the slide re-read.
export const REVIEW_CYCLE_OPTIONS = [
  "Initial H&E", "Deeper levels", "Post-special stain", "Post-IHC",
  "Post-FISH/ISH", "Integrated review",
];
export const TUMOR_PRESENT_OPTIONS = ["Yes", "No", "Indeterminate"];
export const SLIDE_QUALITY_OPTIONS = ["Adequate", "Limited", "Poor", "Uninterpretable"];
export const ADEQUACY_OPTIONS = ["Adequate", "Limited", "Inadequate"];
export const MALIGNANCY_OPTIONS = ["Benign", "Atypical", "Suspicious", "Malignant", "Indeterminate"];
export const GRADE_SYSTEM_OPTIONS = ["Not applicable", "Not specified", "Nottingham", "Fuhrman / ISUP", "Gleason", "WHO", "Other"];
export const MARGIN_STATUS_OPTIONS = ["Not applicable", "Negative", "Close", "Positive", "Cannot assess"];
export const YES_NO_OPTIONS = ["Yes", "No"];
export const COMPARISON_STATUS_OPTIONS = ["Concordant", "Changed", "Discordant", "Not comparable"];
export const REPORT_STATUS_OPTIONS = ["Pending stains", "Preliminary", "Final", "Addendum"];
export const DIAGNOSTIC_LOOP_STATUS_OPTIONS = ["Awaiting levels", "Awaiting stains", "Awaiting IHC", "Awaiting FISH/ISH", "Awaiting molecular", "Ready for integration", "Resolved"];
export const SECOND_OPINION_STATUS_OPTIONS = ["Not requested", "Requested", "In progress", "Completed"];

// Panel-level judgement on a review cycle.
export const SUPPORTS_OPTIONS = ["Yes", "No", "Partially", "Not applicable"];
export const DISCORDANCE_OPTIONS = ["Concordant", "Partially concordant", "Discordant", "Not assessable"];

// ─── Image references ────────────────────────────────────────────────────────
// A slide viewer is not connected yet. What is stored now is the reference the
// viewer will need, so adding the viewer is a component swap and not a data
// migration. Nothing here is read by the model or sent to a model.
export const IMAGE_TYPE_OPTIONS = [
  "Whole-slide image", "Microscopy photograph", "Gross photograph", "Other",
];

export const makeMicroscopyImage = () => ({
  image_id: makeUid("IMG"),
  image_type: "Whole-slide image",
  viewer_link: "",
  reference: "",
  note: "",
});

// ─── Ancillary request option sets ───────────────────────────────────────────

export const REQUEST_TYPE_OPTIONS = [
  "Additional levels", "Special stain", "IHC", "FISH/ISH", "Molecular test", "Other",
];
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
export const REQUEST_PRIORITY_OPTIONS = ["Routine", "Urgent", "STAT"];
export const TISSUE_RESERVATION_OPTIONS = [
  "Not assessed", "Material available", "Reserved", "Insufficient tissue",
];

// Request status is DERIVED from the linked Sectioning / Staining / Molecular
// records and the pathologist's own interpretations. It is never typed into a
// tab, so the same request cannot read differently in two places.
export const ANCILLARY_REQUEST_STATUS = {
  CANCELLED: "Cancelled",
  INSUFFICIENT: "Insufficient tissue",
  REQUESTED: "Requested",
  AWAITING_SLIDE: "Awaiting slide preparation",
  READY_FOR_LAB: "Ready for laboratory work",
  IN_LAB: "In laboratory",
  QC_HOLD: "QC hold",
  AWAITING_REVIEW: "Completed - awaiting pathologist review",
  UNDER_REVIEW: "Under pathologist review",
  REPEAT: "Repeat or additional work requested",
  RESOLVED: "Resolved",
};

export const OPEN_REQUEST_STATUSES = [
  ANCILLARY_REQUEST_STATUS.REQUESTED,
  ANCILLARY_REQUEST_STATUS.AWAITING_SLIDE,
  ANCILLARY_REQUEST_STATUS.READY_FOR_LAB,
  ANCILLARY_REQUEST_STATUS.IN_LAB,
  ANCILLARY_REQUEST_STATUS.QC_HOLD,
  ANCILLARY_REQUEST_STATUS.AWAITING_REVIEW,
  ANCILLARY_REQUEST_STATUS.UNDER_REVIEW,
  ANCILLARY_REQUEST_STATUS.REPEAT,
];

// ─── Pathologist interpretation option sets ──────────────────────────────────
// These moved here from stainingModel.js with the ownership change: pattern,
// intensity, percentage, scoring system, score and the positive / negative /
// equivocal call are professional judgements, so the pathologist's tab owns the
// option lists as well as the fields.

export const INTERPRETABILITY_OPTIONS = ["Interpretable", "Not interpretable"];
export const IHC_INTENSITY_OPTIONS = ["0 (none)", "1+ (weak)", "2+ (moderate)", "3+ (strong)"];
export const IHC_PATTERN_OPTIONS = [
  "Membranous", "Cytoplasmic", "Nuclear", "Nuclear and cytoplasmic",
  "Golgi / dot-like", "Loss of expression", "Patchy / heterogeneous", "Other",
];
export const IHC_SCORING_SYSTEM_OPTIONS = [
  "Not applicable", "HER2 (ASCO/CAP)", "ER/PR Allred", "H-score",
  "Ki-67 proliferation index", "PD-L1 CPS", "PD-L1 TPS",
  "MMR (retained / lost)", "Other",
];
export const IHC_INTERPRETATION_OPTIONS = ["Positive", "Negative", "Equivocal", "Cannot assess"];
export const SPECIAL_STAIN_RESULT_OPTIONS = ["Positive", "Negative", "Focal positive", "Descriptive", "Cannot assess"];
export const FISH_INTERPRETATION_OPTIONS = [
  "Amplified", "Not amplified", "Rearranged", "Not rearranged", "Deleted",
  "Indeterminate", "Other",
];
export const RESULT_COMPARISON_OPTIONS = [
  "Unchanged", "Gained", "Lost", "Increased", "Decreased", "Not comparable",
];

// The interpretation option list depends on what the linked laboratory record
// physically is, so one field serves every sub-workflow. There is no molecular
// case: a molecular result is not read here.
export const interpretationOptionsFor = (modality) => {
  switch (modality) {
    case "Special stain":
      return SPECIAL_STAIN_RESULT_OPTIONS;
    case "IHC":
      return IHC_INTERPRETATION_OPTIONS;
    case "FISH":
      return FISH_INTERPRETATION_OPTIONS;
    default:
      return SPECIAL_STAIN_RESULT_OPTIONS;
  }
};

// Which review cycle a returned stained slide belongs in. Molecular is absent by
// design — it returns to the `integration` section, not to a microscope cycle.
export const reviewCycleForModality = (modality) => ({
  "Special stain": "Post-special stain",
  IHC: "Post-IHC",
  FISH: "Post-FISH/ISH",
}[modality] || "Integrated review");

// ─── Factories ───────────────────────────────────────────────────────────────

export const makeMicroscopyReview = (reviewer = "") => ({
  microscopy_id: makeUid("MIC"),
  review_cycle: "Initial H&E",

  // Lineage. specimen_id is required; slide_id is present for a slide-scoped
  // morphology review and empty for a panel-level (request-scoped) review.
  specimen_id: "",
  block_id: "",
  slide_id: "",

  // A panel is reviewed as a panel, so the links are lists.
  linked_stain_ids: [],
  linked_molecular_order_ids: [],
  linked_request_ids: [],

  images: [],
  annotations: "",
  dictation: { transcript: "", structured_at: "", review_status: "", reviewed_by: "", reviewed_at: "" },

  slide_quality: "",
  diagnostic_adequacy: "",
  reviewed_by: reviewer || "",
  review_datetime: "",

  tumor_present: "",
  histologic_diagnosis: "",
  who_type: "",
  who_subtype: "",
  classification_version: "",
  histologic_grade: "",
  grading_system: "",
  architecture: "",
  cellular_features: "",
  nuclear_features: "",
  cytoplasmic_features: "",
  mitotic_count: "",
  mitotic_method: "",
  microscopic_tumor_size: "",
  invasion_extent: "",
  necrosis: "",
  necrosis_percent: "",
  til_percent: "",

  // Left blank rather than defaulting to "Not applicable": the merge only writes
  // into empty fields, so a pre-filled default would permanently block dictation
  // from ever setting the margin status. "Not applicable" stays selectable.
  margin_status: "",
  margin_distance: "",
  lymphovascular_invasion: "",
  perineural_invasion: "",
  lymph_nodes_examined: "",
  lymph_nodes_positive: "",
  largest_nodal_metastasis: "",
  extranodal_extension: "",
  background_findings: "",
  treatment_effect: "",
  organ_specific_findings: "",

  malignancy_assessment: "",
  morphology_working_diagnosis: "",
  suspected_lineage: "",
  working_classification: "",
  differential_diagnosis: "",
  supporting_morphology: "",
  opposing_morphology: "",
  diagnostic_question: "",
  primary_diagnosis: "",

  // Panel-level reading of the ancillary work interpreted in this cycle. The
  // marker-by-marker detail lives in ancillary_results[].
  panel_interpretation: "",
  supports_working_diagnosis: "",
  discordance_status: "",
  discordance_explanation: "",

  gross_microscopy_concordance: "",
  imaging_pathology_concordance: "",
  prior_case_reference: "",
  comparison_status: "",
  comparison_explanation: "",
  report_status: "Pending stains",
  reporting_pathologist: reviewer || "",
  comments: "",
  second_opinion_requested: "No",
  second_opinion_institution: "",
  second_opinion_status: "Not requested",
  previous_review_id: "",
  diagnostic_loop_status: "Ready for integration",
});

export const makeRequestItem = (target = "") => ({
  request_item_id: makeUid("ANI"),
  target: target || "",
  purpose: "",
});

// Created from the review that raised the diagnostic question, so the request
// always carries the reason it exists.
export const makeAncillaryRequest = (review = {}, requester = "") => ({
  request_id: makeUid("ANC"),
  originating_microscopy_id: review.microscopy_id || "",
  request_type: "IHC",
  diagnostic_question: review.diagnostic_question || "",
  priority: "Routine",

  source_specimen_id: review.specimen_id || "",
  preferred_block_id: review.block_id || "",
  preferred_slide_ids: [],
  required_material: "",

  requested_items: [makeRequestItem()],
  requested_by: requester || "",
  request_datetime: "",
  tissue_reservation_status: "Not assessed",
  cancelled: "No",
  cancel_reason: "",

  // Filled by the laboratory tabs as they create the work.
  linked_sectioning_event_ids: [],
  linked_stain_ids: [],
  linked_molecular_order_ids: [],
  resolution_note: "",
});

// One pathologist reading of one returned stained slide. `stain_id` is the only
// link to the technical work — nothing technical is copied in.
export const makeAncillaryResult = ({
  microscopyId = "",
  requestId = "",
  requestItemId = "",
  stainId = "",
  reviewer = "",
} = {}) => ({
  result_id: makeUid("AIN"),
  microscopy_id: microscopyId,
  request_id: requestId,
  request_item_id: requestItemId,
  stain_id: stainId,

  // The professional decision that the technically-passing run is usable. It
  // can contradict the bench: a passing control does not oblige the pathologist
  // to accept the slide.
  control_accepted_for_interpretation: "",
  interpretability: "",
  interpretability_note: "",

  pattern: "",
  localization: "",
  intensity: "",
  percent_positive: "",
  // Blank for the same reason as margin_status above — a pre-filled default is
  // indistinguishable from a recorded value and would block dictation.
  scoring_system: "",
  scoring_system_version: "",
  score: "",
  interpretation: "",
  result_description: "",
  diagnostic_contribution: "",

  previous_result_ref: "",
  comparison: "",

  repeat_or_additional_work_required: "No",
  follow_up_request_id: "",
  comments: "",
  reviewed_by: reviewer || "",
  review_datetime: "",
});

// The integrated assessment is NOT here. Synthesising the case is not microscope
// work, so it lives in its own `integration` section — see
// shared/integrationModel.js.
export const EMPTY_MICROSCOPY = {
  reviews: [],
  ancillary_requests: [],
  ancillary_results: [],
  recommendation_runs: [],
};

// ─── Upstream inventory ──────────────────────────────────────────────────────

const cassetteLabels = (grossing = {}) => new Map(
  (Array.isArray(grossing?.records) ? grossing.records : [])
    .flatMap((record) => (Array.isArray(record?.cassettes) ? record.cassettes : []))
    .map((cassette) => [cassette.cassette_id, cassette.label || ""])
);

export const microscopySpecimens = (caseRegister = {}) =>
  (Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : [])
    .filter((specimen) => specimen?.specimen_id)
    .map((specimen, index) => ({
      specimen_id: specimen.specimen_id,
      part_label: specimen.part_label || String(index + 1),
      specimen_type: specimen.specimen_type || "",
      anatomic_site: specimen.anatomic_site || "",
      sub_site: specimen.sub_site || "",
      laterality: specimen.laterality || "",
    }));

// Blocks come from Processing; their current tissue state is the latest
// Sectioning event that recorded one.
export const microscopyBlocks = (processing = {}, grossing = {}, sectioning = {}) => {
  const labels = cassetteLabels(grossing);
  const statusByBlock = new Map();
  (Array.isArray(sectioning?.events) ? sectioning.events : []).forEach((event) => {
    if (event?.block_id && event.block_status) statusByBlock.set(event.block_id, event.block_status);
  });
  return (Array.isArray(processing?.cassettes) ? processing.cassettes : [])
    .flatMap((entry) => (Array.isArray(entry?.blocks) ? entry.blocks : []).map((block) => ({
      block_id: block.block_id || "",
      specimen_id: entry.parent_specimen_id || "",
      cassette_id: entry.cassette_id || "",
      cassette_label: labels.get(entry.cassette_id) || "",
      block_status: statusByBlock.get(block.block_id) || "",
    })))
    .filter((block) => block.block_id);
};

export const microscopySlides = (sectioning = {}, grossing = {}) => {
  const labels = cassetteLabels(grossing);
  return (Array.isArray(sectioning?.events) ? sectioning.events : [])
    .flatMap((event) => (Array.isArray(event?.slides) ? event.slides : []).map((slide) => ({
      slide_id: slide.slide_id || "",
      block_id: slide.parent_block_id || event.block_id || "",
      specimen_id: event.parent_specimen_id || "",
      event_id: event.event_id || "",
      cassette_label: labels.get(event.cassette_id) || "",
      intended_use: slide.intended_use || "",
      level: slide.level || "",
      sectioning_reason: event.reason || "",
      released: event.ready_for_staining === "Yes",
      // The ancillary request the cut was made for, when there was one. A slide
      // cut for a request is the best candidate to carry it.
      request_id: event.request_id || "",
    })))
    .filter((slide) => slide.slide_id);
};

// The bench rule, duplicated here so the models stay independent of each other:
// a marker stain has no meaning without its own control on the run, while H&E
// may legitimately run without a separate control slide.
const CONTROL_REQUIRED_MODALITIES = ["Special stain", "IHC", "FISH"];
const technicalControlAccepted = (record = {}) => record.control_result === "Pass"
  || (record.control_result === "Not applicable" && !CONTROL_REQUIRED_MODALITIES.includes(record.modality));

const stainTarget = (record = {}) => {
  switch (record.modality) {
    case "H&E": return "H&E";
    case "Special stain": return record.special?.stain_type === "Other"
      ? (record.special?.stain_type_other || "Special stain")
      : (record.special?.stain_type || "");
    case "IHC": return record.ihc?.marker || "";
    case "FISH": return record.fish?.gene_target || "";
    default: return "";
  }
};

// Technical staining records, read-only. No interpretation is read from here —
// after the ownership change Staining no longer holds one.
export const microscopyStains = (staining = {}) =>
  (Array.isArray(staining?.records) ? staining.records : [])
    .filter((record) => record?.stain_id)
    .map((record) => ({
      stain_id: record.stain_id,
      slide_id: record.slide_id || "",
      block_id: record.parent_block_id || "",
      specimen_id: record.parent_specimen_id || "",
      modality: record.modality || "",
      target: stainTarget(record),
      work_type: record.work_type || "",
      status: record.status || "",
      control_result: record.control_result || "",
      control_accepted: technicalControlAccepted(record),
      quality_result: record.quality_result || "",
      quality_note: record.quality_note || "",
      repeat_required: record.repeat_required || "No",
      repeat_of_stain_id: record.repeat_of_stain_id || "",
      returned_to_microscopy: record.returned_to_microscopy || "No",
      request_id: record.request_id || "",
      request_item_id: record.request_item_id || "",
      diagnostic_question: record.diagnostic_question || "",
      // Reagent traceability, shown beside the observation form so the
      // pathologist can see what was actually applied.
      clone: record.ihc?.clone || "",
      lot: record.ihc?.lot || record.special?.reagent_lot || record.fish?.lot || "",
      platform_id: record.platform_id || "",
      probe_kit: record.fish?.probe_kit || "",
      cells_counted: record.fish?.cells_counted || "",
      signal_ratio: record.fish?.signal_ratio || "",
      copy_number: record.fish?.copy_number || "",
      signal_quality: record.fish?.signal_quality || "",
      appearance: record.he?.appearance || "",
      result_datetime: record.result_datetime || "",
    }));

export const microscopyMolecular = (molecular = {}) =>
  (Array.isArray(molecular?.orders) ? molecular.orders : [])
    .filter((order) => order?.test_order_id)
    .map((order) => ({
      test_order_id: order.test_order_id,
      test_type: order.test_type || "",
      sample_block_id: order.sample_block_id || "",
      sample_slide_id: order.sample_slide_id || "",
      status: order.status || "",
      final_report: order.final_report || "",
      actionable_findings: order.actionable_findings || "",
      request_id: order.request_id || "",
      returned_for_integrated_diagnosis: order.returned_for_integrated_diagnosis || "No",
    }));

export const microscopySectioningEvents = (sectioning = {}) =>
  (Array.isArray(sectioning?.events) ? sectioning.events : [])
    .filter((event) => event?.event_id)
    .map((event) => ({
      event_id: event.event_id,
      block_id: event.block_id || "",
      reason: event.reason || "",
      request_id: event.request_id || "",
      ready_for_staining: event.ready_for_staining || "No",
      slide_count: Array.isArray(event.slides) ? event.slides.length : 0,
    }));

// ─── Derived reads ───────────────────────────────────────────────────────────

const interpreted = (result = {}) => !!String(result.interpretation || "").trim()
  || (result.interpretability === "Not interpretable"
    && !!String(result.interpretability_note || "").trim()
    && ["Yes", "No"].includes(result.repeat_or_additional_work_required));

// Which bench sub-workflow a request type and a slide's intended use mean.
// Duplicated here so the models stay independent of each other; the item-level
// counterpart is slideFitsRequest() in stainingModel.js.
const REQUEST_MODALITY_BY_TYPE = { "Special stain": "Special stain", IHC: "IHC", "FISH/ISH": "FISH", "Molecular test": "Molecular" };
const SLIDE_MODALITY_BY_INTENDED_USE = {
  "H&E": "H&E", "Special stain": "Special stain", IHC: "IHC", Molecular: "FISH",
};

/**
 * Can a slide that already exists carry this requested stain? A stained slide is
 * consumed, so only slides with no stain recorded against them are offered — the
 * caller passes those in as `availableSlides`. Beyond that the slide must be
 * released by Sectioning, sit on the preferred block when one was named, and be
 * either a slide cut for this very request or a spare of the right destination
 * (including an unstained reserve held back earlier).
 */
export const slideCanCarryRequest = (slide = {}, request = {}) => {
  if (!slide.released) return false;
  if (request.preferred_block_id && slide.block_id !== request.preferred_block_id) return false;
  if (slide.request_id && slide.request_id === request.request_id) return true;
  const wanted = REQUEST_MODALITY_BY_TYPE[request.request_type];
  if (request.request_type === "Molecular test") {
    return slide.intended_use === "Molecular" || slide.intended_use === "Unstained reserve";
  }
  if (!wanted) return false;
  return SLIDE_MODALITY_BY_INTENDED_USE[slide.intended_use] === wanted
    || slide.intended_use === "Unstained reserve";
};

/**
 * How much of a request can be filled from slides that already exist, and how
 * many fresh sections Sectioning still has to cut. A new cut is NOT always
 * needed: unstained reserve slides held back at microtomy, or spare slides cut
 * for the same destination, can be assigned to the request instead.
 *
 * ctx.availableSlides must already exclude slides that carry a stain.
 */
export const requestSlideAvailability = (request = {}, ctx = {}) => {
  const molecularMaterial = request.request_type === "Molecular test" ? request.required_material || "" : "";
  if (["Whole tissue block", "Extracted DNA/RNA", "Blood", "Plasma", "Bone marrow", "Other"].includes(molecularMaterial)) {
    return { spare: [], spare_count: 0, outstanding: 0, sections_needed: 0 };
  }
  const spare = (ctx.availableSlides || []).filter((slide) => slideCanCarryRequest(slide, request));
  const targets = (request.requested_items || []).length;
  const ordered = (ctx.stains || []).filter((item) => item.request_id === request.request_id).length;
  const outstanding = Math.max(0, targets - ordered);
  return {
    spare,
    spare_count: spare.length,
    outstanding,
    sections_needed: Math.max(0, outstanding - spare.length),
  };
};

/**
 * Cross-tab status of an ancillary request, derived from the laboratory records
 * that reference it and the pathologist's own interpretations. Never stored.
 */
export const ancillaryRequestStatus = (request = {}, ctx = {}) => {
  const S = ANCILLARY_REQUEST_STATUS;
  if (request.cancelled === "Yes") return S.CANCELLED;
  if (request.tissue_reservation_status === "Insufficient tissue") return S.INSUFFICIENT;

  const id = request.request_id;
  const stains = (ctx.stains || []).filter((item) => item.request_id === id);
  const orders = (ctx.molecularOrders || []).filter((item) => item.request_id === id);
  const events = (ctx.sectioningEvents || []).filter((item) => item.request_id === id);
  const results = (ctx.results || []).filter((item) => item.request_id === id);

  const molecularRequiredMaterial = request.required_material && request.required_material !== "To be decided by Molecular"
    ? request.required_material
    : orders.find((order) => order.required_material)?.required_material || "";
  const molecularNeedsPreparation = request.request_type === "Molecular test"
    && ["Unstained slide", "Tissue curls / scrolls"].includes(molecularRequiredMaterial)
    && orders.some((order) => !order.sectioning_event_id && !order.sample_slide_id);
  if (molecularNeedsPreparation
    && !(molecularRequiredMaterial === "Unstained slide" && requestSlideAvailability(request, ctx).spare_count)) {
    return S.AWAITING_SLIDE;
  }

  if (results.some((item) => item.repeat_or_additional_work_required === "Yes")) return S.REPEAT;

  const work = stains.length + orders.length;
  // Nothing on a bench yet. A slide that already carries a stain is consumed, but
  // an unstained spare — a reserve slide, or a slide cut for this request — can be
  // stained straight away, so a new section is only needed when none is free.
  if (!work) {
    if (requestSlideAvailability(request, ctx).spare_count) return S.READY_FOR_LAB;
    return events.length ? S.AWAITING_SLIDE : S.REQUESTED;
  }

  if (stains.some((item) => item.status === "QC hold" || item.repeat_required === "Yes")) return S.QC_HOLD;

  const expected = Math.max(work, (request.requested_items || []).length);
  const returnedStains = stains.filter((item) => item.status === "Completed" && item.returned_to_microscopy === "Yes").length;
  const finished = returnedStains
    + orders.filter((item) => item.status === "Reported" && item.returned_for_integrated_diagnosis === "Yes").length;
  if (finished < expected) return S.IN_LAB;

  // Only a stained slide is read at the microscope. A molecular order is finished
  // once it is reported and returned for integration — its interpretation belongs
  // to Molecular — so a molecular-only request resolves here rather than waiting
  // forever for a microscopy reading that will never be recorded.
  if (!returnedStains) return S.RESOLVED;
  const done = results.filter(interpreted).length;
  if (!done) return S.AWAITING_REVIEW;
  if (done < returnedStains) return S.UNDER_REVIEW;
  return S.RESOLVED;
};

export const isRequestOpen = (request = {}, ctx = {}) =>
  OPEN_REQUEST_STATUSES.includes(ancillaryRequestStatus(request, ctx));

/**
 * Completed staining work that has no pathologist interpretation yet — the
 * "ready for review" queue. Control state is reported rather than filtered on,
 * because accepting a control for interpretation is the pathologist's call.
 *
 * Molecular orders are deliberately absent: a sequencing result is not read at a
 * microscope. Reported molecular work surfaces in the Integrated Diagnosis tab.
 */
export const pendingAncillaryWork = (microscopy = {}, sources = {}) => {
  const results = Array.isArray(microscopy?.ancillary_results) ? microscopy.ancillary_results : [];
  const interpretedStains = new Set(results.filter((item) => item.stain_id).map((item) => item.stain_id));
  return (sources.stains || [])
    .filter((stain) => stain.status === "Completed"
      && stain.modality !== "H&E"
      && stain.returned_to_microscopy === "Yes"
      && !interpretedStains.has(stain.stain_id))
    .map((stain) => ({
      kind: "Stain",
      id: stain.stain_id,
      modality: stain.modality,
      target: stain.target,
      request_id: stain.request_id,
      request_item_id: stain.request_item_id,
      slide_id: stain.slide_id,
      block_id: stain.block_id,
      specimen_id: stain.specimen_id,
      control_accepted: stain.control_accepted,
      control_result: stain.control_result,
      returned: stain.returned_to_microscopy === "Yes",
    }));
};

/**
 * The canonical read-only complete ancillary result: the laboratory's technical
 * record joined to the pathologist's interpretation through the stable stain ID.
 * This is what Staining displays, what Molecular reads MMR from, and what
 * Integrated Diagnosis / Synoptic / TNM / final sign-off import. It is
 * calculated, never stored, and never editable — the two source records stay
 * authoritative.
 */
export const completeAncillaryResults = (staining = {}, microscopy = {}) => {
  const stainById = new Map(microscopyStains(staining).map((stain) => [stain.stain_id, stain]));
  return (Array.isArray(microscopy?.ancillary_results) ? microscopy.ancillary_results : [])
    .map((result) => {
      const stain = result.stain_id ? stainById.get(result.stain_id) : null;
      if (!stain) return null;
      return {
        result_id: result.result_id || "",
        stain_id: stain.stain_id,
        slide_id: stain.slide_id || "",
        block_id: stain.block_id || "",
        specimen_id: stain.specimen_id || "",
        modality: stain.modality || "",
        marker: stain.target || "",
        clone: stain.clone || "",
        lot: stain.lot || "",
        platform: stain.platform_id || "",
        technical_control_result: stain.control_result || "Not applicable",
        technical_quality: stain.quality_result || "",
        control_accepted_for_interpretation: result.control_accepted_for_interpretation || "",
        interpretability: result.interpretability || "",
        pattern: result.pattern || "",
        localization: result.localization || "",
        intensity: result.intensity || "",
        percent_positive: result.percent_positive || "",
        scoring_system: result.scoring_system || "",
        scoring_system_version: result.scoring_system_version || "",
        score: result.score || "",
        interpretation: result.interpretation || "",
        result_description: result.result_description || "",
        diagnostic_contribution: result.diagnostic_contribution || "",
        comparison: result.comparison || "",
        technical_record_source: `staining.records[${stain.stain_id}]`,
        professional_interpretation_source: `microscopy.ancillary_results[${result.result_id}]`,
        microscopy_id: result.microscopy_id || "",
        request_id: result.request_id || "",
        reviewed_by: result.reviewed_by || "",
        review_datetime: result.review_datetime || "",
      };
    })
    .filter(Boolean);
};

// MMR is one authoritative result: the antibody work is Staining's, the
// retained / lost call is the pathologist's. Molecular reads it through this
// projection instead of keeping a second copy.
const MMR_MARKERS = /^(MLH1|MSH2|MSH6|PMS2)$/i;
export const mmrAncillaryResults = (staining = {}, microscopy = {}) =>
  completeAncillaryResults(staining, microscopy).filter((item) => MMR_MARKERS.test(item.marker));

// ─── Dictation merge ─────────────────────────────────────────────────────────
// Dictation is a suggestion, not an entry. Extracted values fill fields the
// pathologist has left empty and never overwrite something already recorded;
// free text is snapped to the canonical dropdown option and numbers are stripped
// of their units. Identity, lineage, links, images and provenance are never
// writable from a transcript.

const PROTECTED_REVIEW_FIELDS = new Set([
  "microscopy_id", "specimen_id", "block_id", "slide_id", "linked_stain_ids",
  "linked_molecular_order_ids", "linked_request_ids", "images", "dictation",
  "reviewed_by", "review_datetime", "reporting_pathologist", "previous_review_id",
]);

const REVIEW_ENUM_FIELDS = {
  review_cycle: REVIEW_CYCLE_OPTIONS,
  tumor_present: TUMOR_PRESENT_OPTIONS,
  slide_quality: SLIDE_QUALITY_OPTIONS,
  diagnostic_adequacy: ADEQUACY_OPTIONS,
  malignancy_assessment: MALIGNANCY_OPTIONS,
  grading_system: GRADE_SYSTEM_OPTIONS,
  margin_status: MARGIN_STATUS_OPTIONS,
  lymphovascular_invasion: YES_NO_OPTIONS,
  perineural_invasion: YES_NO_OPTIONS,
  extranodal_extension: YES_NO_OPTIONS,
  supports_working_diagnosis: SUPPORTS_OPTIONS,
  discordance_status: DISCORDANCE_OPTIONS,
  comparison_status: COMPARISON_STATUS_OPTIONS,
};

const REVIEW_NUMBER_FIELDS = new Set([
  "lymph_nodes_examined", "lymph_nodes_positive", "necrosis_percent", "til_percent",
]);

const RESULT_ENUM_FIELDS = {
  pattern: IHC_PATTERN_OPTIONS,
  intensity: IHC_INTENSITY_OPTIONS,
  scoring_system: IHC_SCORING_SYSTEM_OPTIONS,
  comparison: RESULT_COMPARISON_OPTIONS,
  interpretability: INTERPRETABILITY_OPTIONS,
  control_accepted_for_interpretation: YES_NO_OPTIONS,
};

const RESULT_NUMBER_FIELDS = new Set(["percent_positive"]);

const isEmpty = (value) => value === undefined || value === null || value === ""
  || (Array.isArray(value) && value.length === 0);

// Local copies of the transcribeMerge helpers' behaviour, kept here so the model
// stays import-free like the other pathology models.
const canon = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// A Yes/No field cannot be matched loosely: canon("No") is two characters, below
// the length floor below, so a dictated "absent" or "not identified" would snap to
// nothing and be dropped without trace. These are the phrasings a pathologist
// actually dictates for a presence/absence finding. A bare "yes"/"no" is already
// handled by the exact match, and is deliberately not listed here — "no" as a
// substring would swallow words like "nodular".
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
  // Presence/absence phrasing for the Yes/No fields. Checked in this order so
  // "not present" resolves to No rather than matching "present".
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

const mergeIntoEmpty = (target = {}, patch = {}, { protectedKeys, enumFields, numberFields }) => {
  const next = { ...target };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (!(key in next) || protectedKeys.has(key)) return;
    if (isEmpty(value) || !isEmpty(next[key])) return;
    if (enumFields[key]) {
      const snapped = snapToOption(value, enumFields[key]);
      if (snapped) next[key] = snapped;
      return;
    }
    next[key] = numberFields.has(key) ? bareNumber(value) : value;
  });
  return next;
};

export const mergeMicroscopyExtraction = (review = {}, patch = {}) => mergeIntoEmpty(review, patch, {
  protectedKeys: PROTECTED_REVIEW_FIELDS,
  enumFields: REVIEW_ENUM_FIELDS,
  numberFields: REVIEW_NUMBER_FIELDS,
});

// The interpretation option list depends on the linked laboratory record, so the
// caller passes the modality it belongs to.
export const mergeAncillaryResultExtraction = (result = {}, patch = {}, modality = "") => mergeIntoEmpty(
  result,
  patch,
  {
    protectedKeys: new Set([
      "result_id", "microscopy_id", "request_id", "request_item_id",
      "stain_id", "follow_up_request_id", "reviewed_by", "review_datetime",
    ]),
    enumFields: { ...RESULT_ENUM_FIELDS, interpretation: interpretationOptionsFor(modality) },
    numberFields: RESULT_NUMBER_FIELDS,
  },
);

/**
 * What a merge actually did, so the UI can report it instead of claiming a fill it
 * cannot see. A partial fill used to be indistinguishable from a complete one.
 *
 *   filled     fields the merge wrote
 *   unmatched  fields the model returned a value for that did NOT land — either
 *              the pathologist had already recorded something (correctly left
 *              alone), or the value matched no dropdown option and was dropped
 *
 * @param {object} before  the record as it was
 * @param {object} after   the record returned by merge*Extraction
 * @param {object} patch   the extraction response that was merged in
 */
export const mergeReport = (before = {}, after = {}, patch = {}) => {
  const filled = [];
  const unmatched = [];
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (isEmpty(value) || !(key in before)) return;
    if (!isEmpty(after[key]) && isEmpty(before[key])) filled.push(key);
    else if (String(after[key] ?? "") === String(before[key] ?? "")) unmatched.push(key);
  });
  return { filled, unmatched };
};

// ─── Reconciliation ──────────────────────────────────────────────────────────

// The only reconciliation pass. Drops records whose lineage no longer exists,
// clears links to material that was removed upstream, and re-pins block /
// specimen from the current slide list. Recorded observations are never
// rewritten.
export const syncMicroscopy = (data = {}, sources = {}) => {
  const specimenIds = new Set((sources.specimens || []).map((item) => item.specimen_id));
  const blockById = new Map((sources.blocks || []).map((item) => [item.block_id, item]));
  const slideById = new Map((sources.slides || []).map((item) => [item.slide_id, item]));
  const stainIds = new Set((sources.stains || []).map((item) => item.stain_id));
  const orderIds = new Set((sources.molecular || []).map((item) => item.test_order_id));

  const keepIds = (ids, valid) => (Array.isArray(ids) ? ids.filter((id) => valid.has(id)) : []);

  // A review is kept while its specimen exists. A stale slide reference is
  // cleared rather than dropping the review, because a panel review is
  // request-scoped and legitimately has no slide of its own.
  const reviews = (Array.isArray(data?.reviews) ? data.reviews : [])
    .filter((review) => review?.specimen_id && specimenIds.has(review.specimen_id))
    .map((review) => {
      const slide = review.slide_id ? slideById.get(review.slide_id) : null;
      const blockId = slide?.block_id || (blockById.has(review.block_id) ? review.block_id : "");
      return {
        ...makeMicroscopyReview(),
        ...review,
        microscopy_id: review.microscopy_id || makeUid("MIC"),
        slide_id: slide ? review.slide_id : "",
        block_id: blockId,
        specimen_id: slide?.specimen_id || review.specimen_id,
        linked_stain_ids: keepIds(review.linked_stain_ids, stainIds),
        linked_molecular_order_ids: keepIds(review.linked_molecular_order_ids, orderIds),
        images: Array.isArray(review.images) ? review.images : [],
        dictation: { ...makeMicroscopyReview().dictation, ...(review.dictation || {}) },
      };
    });
  const reviewIds = new Set(reviews.map((review) => review.microscopy_id));

  const requests = (Array.isArray(data?.ancillary_requests) ? data.ancillary_requests : [])
    .filter((request) => request?.source_specimen_id && specimenIds.has(request.source_specimen_id))
    .map((request) => ({
      ...makeAncillaryRequest(),
      ...request,
      request_id: request.request_id || makeUid("ANC"),
      originating_microscopy_id: reviewIds.has(request.originating_microscopy_id) ? request.originating_microscopy_id : "",
      preferred_block_id: blockById.has(request.preferred_block_id) ? request.preferred_block_id : "",
      preferred_slide_ids: keepIds(request.preferred_slide_ids, new Set(slideById.keys())),
      requested_items: (Array.isArray(request.requested_items) ? request.requested_items : [])
        .map((item) => ({ ...makeRequestItem(), ...item, request_item_id: item?.request_item_id || makeUid("ANI") })),
      linked_stain_ids: keepIds(request.linked_stain_ids, stainIds),
      linked_molecular_order_ids: keepIds(request.linked_molecular_order_ids, orderIds),
    }));
  const requestIds = new Set(requests.map((request) => request.request_id));

  // An interpretation cannot outlive the stained slide it interprets. Molecular
  // orders are not interpreted here, so a result must resolve to a real stain.
  const results = (Array.isArray(data?.ancillary_results) ? data.ancillary_results : [])
    .filter((result) => result?.stain_id && stainIds.has(result.stain_id))
    .map((result) => ({
      ...makeAncillaryResult(),
      ...result,
      result_id: result.result_id || makeUid("AIN"),
      microscopy_id: reviewIds.has(result.microscopy_id) ? result.microscopy_id : "",
      request_id: requestIds.has(result.request_id) ? result.request_id : "",
      follow_up_request_id: requestIds.has(result.follow_up_request_id) ? result.follow_up_request_id : "",
    }));

  return {
    reviews,
    ancillary_requests: requests,
    ancillary_results: results,
    recommendation_runs: Array.isArray(data?.recommendation_runs) ? data.recommendation_runs.slice(-20) : [],
  };
};
