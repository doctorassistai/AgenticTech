// shared/stainingModel.js — Tab 5 (Staining: H&E, special stains, IHC, FISH) data model
//
// Same lightweight stance as processingModel.js / sectioningModel.js: no
// schema_version and no deep normalize/serialize layer. We keep only what
// protects cross-tab lineage — a stable stain_id plus references to the
// Sectioning slide_id / event_id and the block and specimen behind it — and a
// single sync that reconciles recorded staining against the slides that
// currently exist in Sectioning.
//
// Staining is stored as a flat list of RECORDS, one per slide per stain. That is
// how the bench actually works: one slide carries one stain, so one IHC marker
// (with its own clone, lot and control) is one record, and a repeat / restain
// after a failed control is a NEW record pointing back at the one it replaces.
// Nothing is overwritten, which is what keeps the iterative diagnostic loop
// auditable.
//
// OWNERSHIP: this tab is the LABORATORY record. It holds what was physically
// performed and whether it was technically valid — marker/probe applied, clone,
// vendor, dilution, lot, platform, run, protocol, controls, technical quality
// and the repeat decision. It does NOT hold percentage, intensity, pattern,
// localization, professional score, or the positive / negative / equivocal
// interpretation: those are pathologist judgements and live in
// microscopy.ancillary_results[], keyed back to stain_id. See
// onco_pathology_ancillary_result_ownership_change.md.
//
// Cross-tab contract (from onco_pathology_implemented_status.md):
//   • slide_id is the stable slide identity; parent_block_id is its lineage.
//   • The staining destination of a slide is its Sectioning `intended_use` —
//     Staining does not re-ask for it, it only defaults the sub-workflow from it.
//   • Only slides on events with ready_for_staining === "Yes" are handed off.
//   • Section thickness, level and block descriptors are read from Sectioning at
//     render time, never copied into a stain record.
//   • request_id / request_item_id point at the Microscopy ancillary request the
//     order fulfils. Initial H&E is lab-initiated and has none.

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
};

export const YES_NO_OPTIONS = ["Yes", "No"];

// The four sub-workflows. FISH is run on the staining bench: its probe, run,
// controls, signal quality and counting stay here, while the amplified /
// rearranged call belongs to the pathologist in Microscopy. Molecular displays
// this record read-only under its FISH-ISH order rather than re-entering it.
export const STAIN_MODALITY_OPTIONS = ["H&E", "Special stain", "IHC", "FISH"];

// Distinguishes first-pass work from escalated work, so the record shows how the
// case progressed rather than only its final state.
export const WORK_TYPE_OPTIONS = ["Initial", "Add-on", "Reflex", "Repeat", "Restain"];

export const REPEAT_WORK_TYPES = ["Repeat", "Restain"];

// Work that must have come from a pathologist request (or an approved reflex
// rule); only initial work is lab-initiated.
export const REQUESTED_WORK_TYPES = ["Add-on", "Reflex", "Repeat", "Restain"];

export const STAIN_STATUS_OPTIONS = [
  "Ordered",
  "Queued",
  "In process",
  "QC hold",
  "Completed",
  "Repeated",
];

export const CONTROL_RESULT_OPTIONS = ["Not run", "Pass", "Fail", "Not applicable"];

export const STAIN_QUALITY_OPTIONS = ["Acceptable", "Suboptimal", "Failed"];

// ─── Sub-workflow option sets (technical only) ───────────────────────────────

export const HE_APPEARANCE_OPTIONS = ["Adequate", "Pale", "Overstained", "Artifact", "Failed"];

export const SPECIAL_STAIN_TYPE_OPTIONS = [
  "PAS",
  "PAS with diastase",
  "Alcian blue",
  "Mucicarmine",
  "Gomori methenamine silver (GMS)",
  "Ziehl-Neelsen / AFB",
  "Gram",
  "Giemsa",
  "Warthin-Starry",
  "Congo red",
  "Masson trichrome",
  "Reticulin",
  "Elastic (VVG)",
  "Perls iron",
  "Oil red O",
  "Other",
];

export const FISH_SIGNAL_QUALITY_OPTIONS = ["Adequate", "Weak", "High background", "Uninterpretable"];

// ─── Modality defaults and grouping ──────────────────────────────────────────

// Default the sub-workflow from the slide's Sectioning intended use. "Unstained
// reserve" deliberately maps to nothing: reserve slides are not sent for staining
// unless the pathologist explicitly picks a modality for one.
const MODALITY_BY_INTENDED_USE = {
  "H&E": "H&E",
  "Special stain": "Special stain",
  IHC: "IHC",
  Molecular: "FISH",
};

export const modalityForIntendedUse = (intendedUse) => MODALITY_BY_INTENDED_USE[intendedUse] || "";

// A Microscopy ancillary request names a request type; only these three reach
// the staining bench (additional levels go to Sectioning, molecular tests to
// Molecular).
const MODALITY_BY_REQUEST_TYPE = {
  "Special stain": "Special stain",
  IHC: "IHC",
  "FISH/ISH": "FISH",
};

export const modalityForRequestType = (requestType) => MODALITY_BY_REQUEST_TYPE[requestType] || "";

const MODALITY_KEY = { "H&E": "he", "Special stain": "special", IHC: "ihc", FISH: "fish" };

export const modalityKey = (modality) => MODALITY_KEY[modality] || "";

// Modalities whose result is only meaningful with its own control on the run.
export const CONTROL_REQUIRED_MODALITIES = ["Special stain", "IHC", "FISH"];

const makeHeDetail = () => ({
  // Technical stain quality of the H&E itself. The morphology on the slide is
  // read in Microscopy.
  appearance: "",
});

const makeSpecialDetail = () => ({
  stain_type: "",
  stain_type_other: "",
  reagent_lot: "",
});

const makeIhcDetail = () => ({
  marker: "",
  clone: "",
  vendor: "",
  dilution: "",
  lot: "",
  negative_control_result: "Not run",
});

const makeFishDetail = () => ({
  gene_target: "",
  probe_kit: "",
  vendor: "",
  catalog_number: "",
  lot: "",
  hybridization_protocol: "",
  cells_counted: "",
  signal_quality: "",
  signal_ratio: "",
  copy_number: "",
});

const MODALITY_FACTORY = {
  he: makeHeDetail,
  special: makeSpecialDetail,
  ihc: makeIhcDetail,
  fish: makeFishDetail,
};

const modalityGroup = (modality) => {
  const key = MODALITY_KEY[modality];
  return key ? { [key]: MODALITY_FACTORY[key]() } : {};
};

// ─── Record factory ──────────────────────────────────────────────────────────

// One stain on one slide. slide_id / parent_block_id / event_id / specimen are
// REFERENCES into the Sectioning lineage. The slide's intended use, level and
// section detail are NOT copied — they are read from the slide inventory.
export const makeStainRecord = (slide = {}, orderedBy = "") => {
  const modality = modalityForIntendedUse(slide.intended_use);
  return {
    stain_id: makeUid("STN"),

    // Lineage references
    slide_id: slide.slide_id || "",
    parent_block_id: slide.parent_block_id || "",
    event_id: slide.event_id || "",
    parent_specimen_id: slide.parent_specimen_id || "",
    slide_verifications: [],

    // Order / provenance of the request
    modality,
    work_type: "Initial",
    ordered_by: orderedBy || "",
    order_datetime: "",
    request_id: "",
    request_item_id: "",
    originating_review_id: "",
    diagnostic_question: "",
    repeat_of_stain_id: "",

    // Execution
    status: "Ordered",
    platform_id: "",
    run_batch_id: "",
    technician: "",
    stain_datetime: "",
    protocol: "",
    protocol_version: "",

    // Technical controls and quality
    control_result: "Not run",
    control_note: "",
    quality_result: "",
    quality_note: "",
    repeat_required: "No",
    repeat_reason: "",

    // Technical completion, bench check and the return leg to Microscopy
    result_datetime: "",
    source_report_ref: "",
    checked_by: "",
    check_datetime: "",
    comments: "",
    returned_to_microscopy: "No",
    returned_datetime: "",
    dictation: null,

    ...modalityGroup(modality),
  };
};

// Create the bench order straight from a pathologist request item, so the target
// is never retyped and the request link is set before the order is saved.
export const makeStainRecordFromRequest = (slide = {}, item = {}, orderedBy = "") => {
  const modality = modalityForRequestType(item.request_type);
  const record = withModality(makeStainRecord(slide, orderedBy), modality);
  const target = item.target || "";
  if (modality === "IHC") {
    record.ihc = { ...record.ihc, marker: target };
  } else if (modality === "FISH") {
    record.fish = { ...record.fish, gene_target: target };
  } else if (modality === "Special stain") {
    record.special = SPECIAL_STAIN_TYPE_OPTIONS.includes(target)
      ? { ...record.special, stain_type: target }
      : { ...record.special, stain_type: "Other", stain_type_other: target };
  }
  return {
    ...record,
    work_type: "Add-on",
    request_id: item.request_id || "",
    request_item_id: item.request_item_id || "",
    originating_review_id: item.originating_microscopy_id || "",
    diagnostic_question: item.purpose || item.diagnostic_question || "",
  };
};

// Switching sub-workflow keeps whatever was already entered for the old modality
// (in case it is switched back) and seeds the new group if it is missing.
export const withModality = (record = {}, modality = "") => ({
  ...record,
  modality,
  ...(MODALITY_KEY[modality] && record[MODALITY_KEY[modality]] ? {} : modalityGroup(modality)),
});

export const EMPTY_STAINING = {
  records: [],
};

// ─── Upstream inventory ──────────────────────────────────────────────────────

// Flatten every slide cut in Sectioning into the stainable-slide inventory,
// carrying the lineage, the destination (intended use) and the release state
// Staining needs. `grossing` is used only for the human-readable cassette label.
export const sectioningSlides = (sectioning = {}, grossing = {}) => {
  const labels = new Map(
    (Array.isArray(grossing?.records) ? grossing.records : [])
      .flatMap((record) => (Array.isArray(record?.cassettes) ? record.cassettes : []))
      .map((cassette) => [cassette.cassette_id, cassette.label || ""])
  );
  return (Array.isArray(sectioning?.events) ? sectioning.events : [])
    .flatMap((event) =>
      (Array.isArray(event?.slides) ? event.slides : []).map((slide) => ({
        slide_id: slide.slide_id || "",
        parent_block_id: slide.parent_block_id || event.block_id || "",
        event_id: event.event_id || "",
        cassette_id: event.cassette_id || "",
        cassette_label: labels.get(event.cassette_id) || "",
        parent_specimen_id: event.parent_specimen_id || "",
        level: slide.level || "",
        // Destination and label state come from Sectioning and stay read-only here.
        intended_use: slide.intended_use || "",
        label_verified: slide.label_verified || "Not verified",
        released: event.ready_for_staining === "Yes",
        sectioning_reason: event.reason || "",
        // Why the cut was asked for. Shown for context; the stain order records
        // its own diagnostic question.
        sectioning_question: event.diagnostic_question || "",
        // The Microscopy request that caused the cut, when there was one.
        request_id: event.request_id || "",
      }))
    )
    .filter((slide) => slide.slide_id);
};

/**
 * Slides that can still take a stain. A slide carries ONE stain: once it is
 * stained it is consumed, so a slide that already has a stain record can never
 * be reused for another marker. Every additional marker needs its own fresh
 * section, cut in Sectioning.
 */
export const unstainedSlides = (slides = [], staining = {}) => {
  const used = new Set(
    (Array.isArray(staining?.records) ? staining.records : [])
      .map((record) => record.slide_id)
      .filter(Boolean)
  );
  return slides.filter((slide) => !used.has(slide.slide_id));
};

export const isSlideStained = (slideId, staining = {}) =>
  (Array.isArray(staining?.records) ? staining.records : [])
    .some((record) => record.slide_id === slideId);

// Can this free slide carry the stain the request asks for? A slide cut for this
// very request is the best match; otherwise a slide cut for the same destination,
// or one held back unstained, will do. A named preferred block is respected.
const slideFitsRequest = (slide, item) => {
  if (!slide.released) return false;
  if (item.preferred_block_id && slide.parent_block_id !== item.preferred_block_id) return false;
  if (slide.request_id && slide.request_id === item.request_id) return true;
  return modalityForIntendedUse(slide.intended_use) === item.modality
    || slide.intended_use === "Unstained reserve";
};

/**
 * Pathologist request items that still need a bench order. One row per requested
 * target, with the request context the technologist needs to act, plus the free
 * slide that can carry it. Requests for additional levels or molecular tests are
 * excluded — those belong to Sectioning and Molecular.
 *
 * `available_slide_id` is claimed greedily, so two markers are never offered the
 * same physical slide. `needs_new_section` means exactly that: no unstained slide
 * exists for this marker, so Sectioning must cut one before it can be stained.
 */
export const openRequestItems = (microscopy = {}, staining = {}, slides = []) => {
  const claimed = new Set(
    (Array.isArray(staining?.records) ? staining.records : [])
      .map((record) => record.request_item_id)
      .filter(Boolean)
  );
  const free = unstainedSlides(slides, staining);
  const taken = new Set();

  return (Array.isArray(microscopy?.ancillary_requests) ? microscopy.ancillary_requests : [])
    .filter((request) => request?.cancelled !== "Yes" && modalityForRequestType(request.request_type))
    .flatMap((request) => (Array.isArray(request.requested_items) ? request.requested_items : [])
      .filter((item) => item?.request_item_id && !claimed.has(item.request_item_id))
      .map((item) => {
        const row = {
          request_id: request.request_id,
          request_item_id: item.request_item_id,
          request_type: request.request_type,
          modality: modalityForRequestType(request.request_type),
          target: item.target || "",
          purpose: item.purpose || "",
          diagnostic_question: request.diagnostic_question || "",
          priority: request.priority || "Routine",
          originating_microscopy_id: request.originating_microscopy_id || "",
          requested_by: request.requested_by || "",
          request_datetime: request.request_datetime || "",
          source_specimen_id: request.source_specimen_id || "",
          preferred_block_id: request.preferred_block_id || "",
          preferred_slide_ids: Array.isArray(request.preferred_slide_ids) ? request.preferred_slide_ids : [],
        };
        // A slide the pathologist named explicitly wins, provided it is still free.
        const named = free.find((slide) => row.preferred_slide_ids.includes(slide.slide_id)
          && !taken.has(slide.slide_id));
        const match = named || free.find((slide) => !taken.has(slide.slide_id) && slideFitsRequest(slide, row));
        if (match) taken.add(match.slide_id);
        return { ...row, available_slide_id: match?.slide_id || "", needs_new_section: !match };
      }));
};

// The only reconciliation step: drop records whose slide no longer exists
// upstream and re-pin block / event / specimen lineage from the current slide
// list. Recorded staining data is never rewritten.
export const syncStaining = (staining = {}, slides = []) => {
  const byId = new Map(slides.map((slide) => [slide.slide_id, slide]));
  const records = (Array.isArray(staining?.records) ? staining.records : [])
    .filter((record) => record && byId.has(record.slide_id))
    .map((record) => {
      const slide = byId.get(record.slide_id);
      return {
        ...record,
        parent_block_id: slide.parent_block_id || record.parent_block_id || "",
        event_id: slide.event_id || record.event_id || "",
        parent_specimen_id: slide.parent_specimen_id || record.parent_specimen_id || "",
        slide_verifications: Array.isArray(record.slide_verifications) ? record.slide_verifications : [],
      };
    });
  return {
    records,
  };
};

// ─── Derived reads ───────────────────────────────────────────────────────────

// What the stain is against — the marker, gene, or stain name. Used for card
// titles, the Microscopy review queue, and duplicate-testing checks.
export const stainTargetOf = (record = {}) => {
  switch (record.modality) {
    case "H&E":
      return "H&E";
    case "Special stain":
      return record.special?.stain_type === "Other"
        ? record.special?.stain_type_other || "Special stain"
        : record.special?.stain_type || "";
    case "IHC":
      return record.ihc?.marker || "";
    case "FISH":
      return record.fish?.gene_target || "";
    default:
      return "";
  }
};

// The bench's own outcome for the record — never a diagnostic reading. H&E
// reports its stain appearance, FISH its signal quality and measured ratio,
// everything else its technical quality grade.
export const stainTechnicalOutcomeOf = (record = {}) => {
  switch (record.modality) {
    case "H&E":
      return record.he?.appearance || "";
    case "FISH":
      return [record.fish?.signal_quality, record.fish?.signal_ratio && `ratio ${record.fish.signal_ratio}`]
        .filter(Boolean)
        .join(" · ");
    default:
      return record.quality_result || "";
  }
};

// A stain may only be released for interpretation on a passing control. H&E can
// legitimately run without a separate control slide; marker stains (special
// stain, IHC, FISH) cannot, so "Not applicable" is not acceptable for them.
// Accepting that control FOR CLINICAL INTERPRETATION is a separate, pathologist
// decision recorded in Microscopy.
export const controlAccepted = (record = {}) =>
  record.control_result === "Pass"
  || (record.control_result === "Not applicable"
    && !CONTROL_REQUIRED_MODALITIES.includes(record.modality));

export const isStainQualityProblem = (quality) => !!quality && quality !== "Acceptable";

// Completed technical work with a passing control, ready to go back to Microscopy.
export const completedResults = (records = []) =>
  records.filter((record) => record.status === "Completed" && controlAccepted(record));

// ─── Dictation merge ─────────────────────────────────────────────────────────
// One stain order's dictation is anchored to that order by the UI — the
// technologist picks the slide and sub-workflow, adds the order, then dictates
// into that card — so extraction carries no routing. The model never names a
// slide, block, specimen, stain order or request, never writes identity,
// lineage, links or work type, and never mints a repeat/restain.
//
// Writing rule: dictation fills EMPTY fields, and may additionally overwrite a
// field that still sits at its placeholder DEFAULT (status "Ordered",
// control_result / negative_control_result "Not run", repeat_required "No",
// returned_to_microscopy "No") — those are unrecorded stances, not entered
// values. Anything a technologist already chose (a real "Pass", "Completed",
// "Yes", a marker, a platform ID …) is never overwritten by speech. This is the
// ProcessingTab rule, needed here because the run-outcome fields a bench tech
// dictates ("control passed, completed, no repeat") start at those placeholders.
// The patch is split into `flat` (record-level keys) and `detail` (the keys of
// the modality's own he/special/ihc/fish group); enum/date/number coercion
// happens in the tab before this merge.

const isEmptyStainValue = (value) => value === "" || value === null || value === undefined;

// Field -> placeholder default values that dictation may replace. A current
// value not in this map is treated as a real entry and left alone.
const STAIN_DICTATION_PLACEHOLDERS = {
  status: ["Ordered"],
  control_result: ["Not run"],
  negative_control_result: ["Not run"],
  repeat_required: ["No"],
  returned_to_microscopy: ["No"],
};

const STAIN_DICTATION_PROTECTED = new Set([
  "stain_id",
  "slide_id",
  "event_id",
  "parent_block_id",
  "parent_specimen_id",
  "slide_verifications",
  "modality",
  "work_type",
  "request_id",
  "request_item_id",
  "originating_review_id",
  "repeat_of_stain_id",
  "dictation",
]);

const stainWritable = (current, key) =>
  isEmptyStainValue(current) || (STAIN_DICTATION_PLACEHOLDERS[key] || []).includes(current);

// Apply a dictated patch to a single stain order: `patch.flat` onto the
// record's top-level keys, `patch.detail` onto the sub-workflow's group object
// (record.he / .special / .ihc / .fish, chosen from the record's modality).
// Unknown or protected keys, and keys with no place to land, are dropped.
export const mergeStainingExtraction = (record = {}, patch = {}) => {
  const next = { ...record };
  Object.entries(patch?.flat || {}).forEach(([key, value]) => {
    if (isEmptyStainValue(value)) return;
    if (STAIN_DICTATION_PROTECTED.has(key)) return;
    if (!(key in next)) return;
    if (!stainWritable(next[key], key)) return;
    next[key] = value;
  });

  const detail = patch?.detail || {};
  const group = modalityKey(record.modality);
  if (group && Object.keys(detail).length > 0) {
    const nextGroup = { ...(next[group] || {}) };
    Object.entries(detail).forEach(([key, value]) => {
      if (isEmptyStainValue(value)) return;
      if (!(key in nextGroup)) return;
      if (!stainWritable(nextGroup[key], key)) return;
      nextGroup[key] = value;
    });
    next[group] = nextGroup;
  }
  return next;
};
