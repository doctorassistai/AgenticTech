// shared/sectioningModel.js — Tab 4 (Sectioning / Microtomy) data model
//
// Same lightweight stance as processingModel.js: no schema_version and no deep
// normalize/serialize layer. We keep only what protects cross-tab lineage —
// stable event_id / slide_id, and references to the Processing block_id /
// cassette_id / specimen_id — plus a single sync that reconciles recorded
// sectioning against the blocks that currently exist in Processing.
//
// A block is cut MANY times over a case (initial H&E, deeper levels, recut,
// special stain, IHC, molecular, unstained reserve), so sectioning is stored as a
// flat list of EVENTS, each pointing at one block. Nothing is overwritten: an
// added level or a recut is a new event, which is what keeps the iterative
// diagnostic loop auditable. Block exhaustion is recorded per event (the state as
// of that cut); the block's current state is the latest event that recorded one.

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

export const YES_NO_OPTIONS = ["Yes", "No"];

export const VERIFICATION_OPTIONS = ["Not verified", "Verified", "Mismatch"];

// Why the block is being cut. Distinguishes initial work from repeat / deeper /
// add-on work so the lab record shows how the case escalated.
export const SECTIONING_REASON_OPTIONS = [
  "Initial H&E",
  "Deeper levels",
  "Recut",
  "Special stain",
  "IHC",
  "Molecular",
  "Unstained slides",
  "Other",
];

export const SLIDE_TYPE_OPTIONS = ["Standard", "Charged", "Other"];

// What each slide is for. This is also the Staining destination — derived, not
// re-entered downstream.
export const SLIDE_INTENDED_USE_OPTIONS = [
  "H&E",
  "Special stain",
  "IHC",
  "Molecular",
  "Unstained reserve",
  "Other",
];

export const SECTION_QUALITY_OPTIONS = [
  "Acceptable",
  "Folds",
  "Chatter",
  "Compression",
  "Tears",
  "Holes",
  "Tissue loss",
  "Contamination or floater",
  "Other",
];

export const BLOCK_STATUS_OPTIONS = ["Tissue remaining", "Low tissue", "Exhausted"];

// Anything other than "Acceptable" (or blank) counts as a cutting problem for
// reconciliation and for the repeated-problem check.
export const isQualityProblem = (quality) => !!quality && quality !== "Acceptable";

// Default a slide's Staining destination from the reason the block was cut. The
// technologist can override it per slide.
const INTENDED_USE_BY_REASON = {
  "Initial H&E": "H&E",
  "Deeper levels": "H&E",
  Recut: "H&E",
  "Special stain": "Special stain",
  IHC: "IHC",
  Molecular: "Molecular",
  "Unstained slides": "Unstained reserve",
};

export const intendedUseForReason = (reason) => INTENDED_USE_BY_REASON[reason] || "";

// One physical slide. slide_id is generated in app (deterministic software, not
// AI) and is the ID Staining and Microscopy will reference.
export const makeSlide = (event = {}) => ({
  slide_id: makeUid("SLD"),
  parent_block_id: event.block_id || "",
  level: "",
  intended_use: intendedUseForReason(event.reason),
  label_verified: "Not verified",
});

// One sectioning event on one block. block_id / cassette_id / parent_specimen_id
// are REFERENCES into the Processing lineage, never copies of embedding or
// specimen descriptors (those are read from Processing/Grossing at render time).
export const makeSectioningEvent = (block = {}, requestedBy = "") => ({
  event_id: makeUid("SEC"),
  block_id: block.block_id || "",
  cassette_id: block.cassette_id || "",
  parent_specimen_id: block.parent_specimen_id || "",
  block_verifications: [],

  // Request. request_id / originating_microscopy_id are set when the cut exists
  // because the pathologist asked for additional levels or for slides to carry an
  // ancillary stain; a routine initial H&E is lab-initiated and has neither.
  reason: "Initial H&E",
  requested_by: requestedBy || "",
  request_datetime: "",
  diagnostic_question: "",
  special_instructions: "",
  request_id: "",
  output_material_type: "Unstained slides",
  output_quantity: "",
  output_container: "",
  originating_microscopy_id: "",

  // Cutting details
  thickness_um: "",
  microtome_id: "",
  levels_requested: "",
  levels_cut: "",
  level_interval: "",
  slide_type: "Standard",
  sectioned_by: "",
  sectioning_datetime: "",

  // Slide tracking
  expected_slide_count: "",
  slides: [],

  // Quality and handoff
  section_quality: "",
  quality_note: "",
  tissue_adequately_represented: "",
  recut_required: "No",
  recut_reason: "",
  block_status: "",
  ready_for_staining: "No",
  comments: "",
});

export const EMPTY_SECTIONING = {
  events: [],
};

// Flatten every block generated in Processing into the cuttable-block inventory,
// carrying the lineage and release state Sectioning needs. `grossing` is used only
// to show the human-readable cassette label.
export const processingBlocks = (processing = {}, grossing = {}) => {
  const labels = new Map(
    (Array.isArray(grossing?.records) ? grossing.records : [])
      .flatMap((record) => (Array.isArray(record?.cassettes) ? record.cassettes : []))
      .map((cassette) => [cassette.cassette_id, cassette.label || ""])
  );
  return (Array.isArray(processing?.cassettes) ? processing.cassettes : [])
    .flatMap((entry) =>
      (Array.isArray(entry?.blocks) ? entry.blocks : []).map((block) => ({
        block_id: block.block_id || "",
        cassette_id: entry.cassette_id || "",
        parent_specimen_id: entry.parent_specimen_id || "",
        cassette_label: labels.get(entry.cassette_id) || "",
        // Processing releases tissue at cassette level; blocks carry no own flag.
        released_for_sectioning: entry.ready_for_sectioning === "Yes",
        barcode_verified: block.barcode_verified || "Not verified",
      }))
    )
    .filter((block) => block.block_id);
};

// ─── Pathologist requests that need tissue cut ───────────────────────────────
// A stained slide is consumed: it carries one stain and cannot be reused. So a
// Microscopy ancillary request needs one FRESH section per requested marker,
// unless unstained slides are already sitting on the block. This worklist is
// therefore driven by a count — how many sections are still missing — not by the
// request type alone. Requests are created and owned in Microscopy; Sectioning
// only fulfils them, and keeps the request link so each slide traces back to the
// question that caused it.

const REASON_BY_REQUEST_TYPE = {
  "Additional levels": "Deeper levels",
  "Special stain": "Special stain",
  IHC: "IHC",
  "FISH/ISH": "Molecular",
  "Molecular test": "Molecular",
};

export const reasonForRequestType = (requestType) => REASON_BY_REQUEST_TYPE[requestType] || "Other";

// Which destination a slide must carry to be usable for a request type.
const INTENDED_USE_BY_REQUEST_TYPE = {
  "Special stain": "Special stain",
  IHC: "IHC",
  "FISH/ISH": "Molecular",
  "Molecular test": "Molecular",
};

/**
 * Open requests, each with the number of sections still to cut.
 *
 * A slide counts as available only when it exists, is unstained, was released, and
 * carries (or can carry) the destination the request needs. `slides_needed` is the
 * number of requested items still outstanding minus those available slides, so a
 * panel of three markers with one spare unstained slide on the block shows two.
 *
 * An item already claimed by a stain order needs no section, and a molecular test
 * already ordered off the block needs none either — those requests drop off.
 *
 * `staining` is passed so a slide that already carries a stain is never counted as
 * available: it cannot be re-cut, it must be re-sectioned.
 */
export const openSectioningRequests = (microscopy = {}, sectioning = {}, staining = {}, molecular = {}) => {
  const events = Array.isArray(sectioning?.events) ? sectioning.events : [];
  const stainRecords = Array.isArray(staining?.records) ? staining.records : [];
  const molecularOrders = Array.isArray(molecular?.orders) ? molecular.orders : [];
  const stained = new Set(stainRecords.map((record) => record.slide_id).filter(Boolean));
  const claimedItems = new Set(stainRecords.map((record) => record.request_item_id).filter(Boolean));

  // Every slide on the case with its event context, minus the consumed ones.
  const freeSlides = events.flatMap((event) => (Array.isArray(event?.slides) ? event.slides : [])
    .filter((slide) => slide?.slide_id && !stained.has(slide.slide_id))
    .map((slide) => ({
      slide_id: slide.slide_id,
      block_id: slide.parent_block_id || event.block_id || "",
      intended_use: slide.intended_use || "",
      released: event.ready_for_staining === "Yes",
      request_id: event.request_id || "",
    })));

  const claimed = new Set();

  return (Array.isArray(microscopy?.ancillary_requests) ? microscopy.ancillary_requests : [])
    .filter((request) => request?.request_id && request.cancelled !== "Yes")
    .map((request) => {
      const wanted = INTENDED_USE_BY_REQUEST_TYPE[request.request_type] || "";
      const items = Array.isArray(request.requested_items) ? request.requested_items : [];
      const molecularOrdersForRequest = molecularOrders.filter((order) => order.request_id === request.request_id);
      const molecularMaterial = request.request_type === "Molecular test"
        ? (request.required_material && request.required_material !== "To be decided by Molecular"
          ? request.required_material
          : molecularOrdersForRequest.find((order) => order.required_material)?.required_material || "To be decided by Molecular")
        : "";
      const needsMolecularSections = ["Unstained slide", "Tissue curls / scrolls"].includes(molecularMaterial);
      if (request.request_type === "Molecular test" && !needsMolecularSections) return null;
      const cutFor = events.filter((event) => event.request_id === request.request_id);
      const alreadyCut = cutFor.reduce(
        (total, event) => total + (event.output_material_type === "Tissue curls / scrolls"
          ? (Number(event.output_quantity) || 0)
          : (Array.isArray(event.slides) ? event.slides.length : 0)),
        0,
      );

      // Stain markers are counted per requested item. Molecular material quantity
      // is assay-driven and comes from the Molecular order; creating the order
      // does not mean the material has already been prepared.
      const onBench = items.filter((item) => claimedItems.has(item.request_item_id)).length
        + (request.request_type === "Molecular test" && !needsMolecularSections
          ? molecularOrdersForRequest.length
          : 0);
      const molecularQuantity = Math.max(
        Number(molecularOrdersForRequest.find((order) => Number(order.section_count) > 0)?.section_count)
          || items.length
          || 1,
        1,
      );
      const molecularPreparedOrders = molecularOrdersForRequest.filter((order) => order.sample_slide_id || order.sectioning_event_id).length;
      const outstanding = request.request_type === "Additional levels"
        ? (cutFor.length ? 0 : 1)
        : request.request_type === "Molecular test" && needsMolecularSections
          ? Math.max(molecularQuantity - alreadyCut - molecularPreparedOrders, 0)
        : Math.max(items.length - onBench, 0);

      const usable = (molecularMaterial === "Tissue curls / scrolls" ? [] : freeSlides).filter((slide) => {
        if (claimed.has(slide.slide_id)) return false;
        if (request.preferred_block_id && slide.block_id !== request.preferred_block_id) return false;
        if (slide.request_id && slide.request_id === request.request_id) return true;
        if (request.request_type === "Additional levels") return false;
        return slide.intended_use === "Unstained reserve" || (wanted && slide.intended_use === wanted);
      }).slice(0, outstanding);
      usable.forEach((slide) => claimed.add(slide.slide_id));

      return {
        request_id: request.request_id,
        request_type: request.request_type || "",
        reason: reasonForRequestType(request.request_type),
        targets: items.map((item) => item.target || "unnamed").join(", "),
        diagnostic_question: request.diagnostic_question || "",
        priority: request.priority || "Routine",
        requested_by: request.requested_by || "",
        request_datetime: request.request_datetime || "",
        originating_microscopy_id: request.originating_microscopy_id || "",
        source_specimen_id: request.source_specimen_id || "",
        preferred_block_id: request.preferred_block_id || "",
        required_material: molecularMaterial || request.required_material || "",
        items_requested: items.length,
        items_on_bench: onBench,
        slides_available: usable.length,
        slides_cut_for_request: alreadyCut,
        slides_needed: Math.max(outstanding - usable.length, 0),
      };
    })
    // Only what still needs tissue: a request whose sections all exist drops off.
    .filter((row) => row && row.slides_needed > 0);
};

// Create the cutting event straight from the request, so the reason, the
// diagnostic question and the request link are set before anything is saved, and
// seed one slide per section still needed — a stained slide cannot be reused, so
// each requested marker gets its own section.
export const makeSectioningEventFromRequest = (block = {}, request = {}, requestedBy = "") => {
  const event = {
    ...makeSectioningEvent(block, request.requested_by || requestedBy),
    reason: request.reason || reasonForRequestType(request.request_type),
    diagnostic_question: request.diagnostic_question || "",
    request_id: request.request_id || "",
    originating_microscopy_id: request.originating_microscopy_id || "",
    output_material_type: request.required_material === "Tissue curls / scrolls"
      ? "Tissue curls / scrolls"
      : "Unstained slides",
  };
  const needed = Math.max(Number(request.slides_needed) || 0, 0);
  return {
    ...event,
    expected_slide_count: event.output_material_type === "Unstained slides" && needed ? String(needed) : "",
    output_quantity: needed ? String(needed) : "",
    slides: event.output_material_type === "Unstained slides"
      ? Array.from({ length: needed }, () => makeSlide(event))
      : [],
  };
};

// The only reconciliation step: drop events whose block no longer exists upstream,
// re-pin cassette/specimen lineage from the current block list, and keep each
// slide pointing at its parent block. Recorded cutting data is never rewritten.
export const syncSectioning = (sectioning = {}, blocks = []) => {
  const byId = new Map(blocks.map((block) => [block.block_id, block]));
  const events = (Array.isArray(sectioning?.events) ? sectioning.events : [])
    .filter((event) => event && byId.has(event.block_id))
    .map((event) => {
      const block = byId.get(event.block_id);
      return {
        ...event,
        output_material_type: event.output_material_type || "Unstained slides",
        output_quantity: event.output_quantity || "",
        cassette_id: block.cassette_id || event.cassette_id || "",
        parent_specimen_id: block.parent_specimen_id || event.parent_specimen_id || "",
        block_verifications: Array.isArray(event.block_verifications) ? event.block_verifications : [],
        slides: (Array.isArray(event.slides) ? event.slides : []).map((slide) => ({
          ...slide,
          parent_block_id: event.block_id,
        })),
      };
    });
  return {
    events,
  };
};

// Current tissue state per block = the last event (in recorded order) that set one.
export const blockStatusMap = (events = []) => {
  const map = new Map();
  events.forEach((event) => {
    if (event?.block_id && event.block_status) map.set(event.block_id, event.block_status);
  });
  return map;
};

// Every slide across the case, flattened with its event context. Used for the
// handoff summary and for the Staining destination breakdown.
export const allSlides = (events = []) =>
  events.flatMap((event) =>
    (Array.isArray(event?.slides) ? event.slides : []).map((slide) => ({
      ...slide,
      event_id: event.event_id,
      reason: event.reason,
      ready_for_staining: event.ready_for_staining,
    }))
  );

// ─── Dictation merge ─────────────────────────────────────────────────────────
// One sectioning event's dictation is anchored to that event by the UI — the
// technologist picks the block, adds the event, then dictates into that card —
// so extraction carries no routing. The model never names a cassette, block,
// slide or specimen, never creates slides or blocks, and never writes identity
// or lineage. Extraction fills EMPTY fields only: a value already recorded
// (even a model default like reason "Initial H&E") is never overwritten by
// speech. Enum/date/number coercion happens in the tab before this merge, which
// is deliberately free of that logic (same stance as processingModel.js).

const isEmptySectioningValue = (value) => value === "" || value === null || value === undefined;

const SECTIONING_DICTATION_PROTECTED = new Set([
  "event_id",
  "block_id",
  "cassette_id",
  "parent_specimen_id",
  "block_verifications",
  "request_id",
  "originating_microscopy_id",
  "output_material_type",
  "slides",
  "dictation",
]);

// Apply one dictated patch to a single sectioning event, writing only keys that
// already exist on the event and are still empty. Unknown or protected keys from
// the extraction are dropped.
export const mergeSectioningExtraction = (event = {}, patch = {}) => {
  const next = { ...event };
  Object.entries(patch || {}).forEach(([key, value]) => {
    if (isEmptySectioningValue(value)) return;
    if (SECTIONING_DICTATION_PROTECTED.has(key)) return;
    if (!(key in next)) return;
    if (!isEmptySectioningValue(next[key])) return;
    next[key] = value;
  });
  return next;
};

