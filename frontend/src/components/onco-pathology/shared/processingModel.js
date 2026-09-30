// shared/processingModel.js — Tab 3 (Processing & Embedding) data model
//
// Lightweight by design. Unlike grossingModel.js there is no deep
// normalize/serialize layer; the tab saves its reconciled state as-is through
// the whitelisted "processing" section. A small dictation merge
// (mergeProcessingExtraction) fills empty run/cassette fields from AI-extracted
// speech-to-text, mirroring the Grossing dictation flow but scoped per run and
// routed to verified cassettes by label. Cross-tab lineage is protected by the
// stable run_id / block_id and references to the Grossing cassette_id /
// specimen_id, plus the single sync that reconciles the per-cassette processing
// list against the current Grossing cassettes.

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

export const YES_NO_OPTIONS = ["Yes", "No"];

export const VERIFICATION_OPTIONS = ["Not verified", "Verified", "Mismatch"];

export const PROCESSING_PROTOCOL_OPTIONS = [
  "Standard overnight",
  "Rapid",
  "Biopsy rapid",
  "Other",
];

export const PROCESSING_STATUS_OPTIONS = [
  "Waiting",
  "Running",
  "Completed",
  "Hold",
  "Reprocessing",
];

export const DECAL_AGENT_OPTIONS = ["EDTA", "Formic acid", "HCl", "Other"];

export const EMBEDDING_MEDIUM_OPTIONS = ["Paraffin", "OCT", "Resin", "Other"];

export const PROCESSING_QUALITY_OPTIONS = [
  "Satisfactory",
  "Underprocessed",
  "Overprocessed",
  "Other",
];

// A paraffin/OCT block cut from an embedded cassette. Block IDs are generated in
// app (deterministic software, not AI); Tab 4 (Sectioning) traces block_id → slides.
export const makeBlock = () => ({
  block_id: makeUid("BLK"),
  barcode_verified: "Not verified",
});

// A processor run: the shared machine/batch/protocol context that a group of
// cassettes is processed under. A case may have several runs.
export const makeRun = () => ({
  run_id: makeUid("RUN"),
  processor_machine_id: "",
  batch_run_id: "",
  protocol: "",
  protocol_other: "",
  technician: { staff_id: "", name: "" },
  start_datetime: "",
  end_datetime: "",
  status: "Waiting",
});

// One processing entry per input. cassette_id / parent_specimen_id are
// REFERENCES into the upstream lineage, never copies of specimen descriptors. The
// human-readable cassette label is looked up from Grossing at render time, not stored.
//
// `source` distinguishes where the input came from. A cell block is not a grossing
// cassette — the cytology pellet is fixed in agar or plasma-thrombin and embedded
// directly — but from Processing onward it behaves identically, so it enters here
// as a cassette-equivalent rather than through a fabricated grossing record.
export const makeCassetteProcessing = (cassette = {}) => ({
  cassette_id: cassette.cassette_id || "",
  parent_specimen_id: cassette.parent_specimen_id || "",
  source: cassette.source || "grossing_cassette",
  cytology_id: cassette.cytology_id || "",
  run_id: "",
  received: "Not verified",
  cassette_verifications: [],
  fixation_end_datetime: "",
  decalcification_required: "No",
  decalcification_agent: "",
  decalcification_agent_other: "",
  decal_start_datetime: "",
  decal_end_datetime: "",
  special_handling: "",
  embedding_medium: "",
  embedding_datetime: "",
  embedded_by: "",
  embedding_orientation: "",
  blocks: [],
  processing_quality: "",
  tissue_or_cassette_issue: "",
  corrective_action: "",
  reprocessing_required: "No",
  ready_for_sectioning: "No",
  comments: "",
});

export const EMPTY_PROCESSING = {
  runs: [],
  cassettes: [],
  dictation: null,
};

// Flatten Grossing cassettes across every specimen record in the case.
export const grossingCassettes = (grossing = {}) =>
  (Array.isArray(grossing?.records) ? grossing.records : []).flatMap((record) =>
    Array.isArray(record?.cassettes) ? record.cassettes : []
  );

/**
 * Cell blocks made in Cytopathology, as cassette-equivalent processing inputs.
 *
 * A cell block is the one real join between the cytology and histology streams:
 * the residual sediment is embedded in paraffin exactly like tissue, and from
 * that point on it is sectioned, stained and read like any other block. Before
 * this existed, a `CBK-` ID was a dead end — Processing only accepted grossing
 * cassettes, so a cell block could never reach Sectioning or Staining, which is
 * the only reason it is made.
 *
 * The `CBK-` ID becomes the cassette key, so every downstream tab (which keys on
 * cassette_id) works unchanged. No grossing record is fabricated: there is nothing
 * to describe, ink or hand-section on an already-embedded pellet.
 */
export const cytologyCellBlocks = (cytopathology = {}) =>
  (Array.isArray(cytopathology?.records) ? cytopathology.records : [])
    .filter((record) => record?.cell_block_available === "Yes" && record?.cell_block_id)
    .map((record) => ({
      cassette_id: record.cell_block_id,
      parent_specimen_id: record.specimen_id || "",
      parent_container_ids: [],
      source: "cell_block",
      cytology_id: record.cytology_id || "",
    }));

// Everything Processing accepts: grossing cassettes plus cytology cell blocks.
export const processingInputs = (grossing = {}, cytopathology = {}) => [
  ...grossingCassettes(grossing),
  ...cytologyCellBlocks(cytopathology),
];

export const isCellBlockEntry = (entry = {}) => entry?.source === "cell_block";

// The only reconciliation step: keep existing processing entries by cassette_id,
// seed a fresh entry for any input not yet present, and drop orphans (cassettes or
// cell blocks removed upstream). Entries that persist keep their run_id, blocks,
// and all recorded processing data.
export const syncProcessing = (processing = {}, grossing = {}, cytopathology = {}) => {
  const source = processingInputs(grossing, cytopathology);
  const existing = new Map(
    (Array.isArray(processing?.cassettes) ? processing.cassettes : [])
      .filter((entry) => entry && entry.cassette_id)
      .map((entry) => [entry.cassette_id, entry])
  );
  const cassettes = source.map((cassette) => {
    const prior = existing.get(cassette.cassette_id);
    if (prior) {
      const cassetteVerifications = Array.isArray(prior.cassette_verifications)
        ? prior.cassette_verifications
        : [];
      const latestVerification = cassetteVerifications[cassetteVerifications.length - 1];
      return {
        ...prior,
        parent_specimen_id: cassette.parent_specimen_id || prior.parent_specimen_id || "",
        source: cassette.source || prior.source || "grossing_cassette",
        cytology_id: cassette.cytology_id || prior.cytology_id || "",
        received: latestVerification?.result === "matched"
          ? "Verified"
          : latestVerification?.result === "bypassed"
            ? "Bypassed"
            : latestVerification?.result === "mismatch"
              ? "Mismatch"
              : "Not verified",
        cassette_verifications: cassetteVerifications,
      };
    }
    return makeCassetteProcessing(cassette);
  });
  return {
    runs: Array.isArray(processing?.runs) ? processing.runs : [],
    cassettes,
    dictation: processing?.dictation || null,
  };
};

const isEmptyValue = (value) => value === "" || value === null || value === undefined;

const canonLabel = (label) => String(label ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

// Fill a single run / cassette target from an extracted patch. Dictation never
// clobbers a value the clinician entered: only empty fields are filled, except
// that an extracted "Yes"/"No" may override the model's "No" defaults and a
// dictated run status may override the "Waiting" default (the doctor actively
// dictated the fact, so it is not a silent mutation). The routing-only facts
// `label` and `block_count` are consumed by the caller and never stored on the
// entry.
const fillEmpty = (target = {}, patch = {}) => {
  const next = { ...target };
  Object.entries(patch).forEach(([key, value]) => {
    if (key === "label" || key === "block_count" || isEmptyValue(value)) return;
    if (key === "technician" && value && typeof value === "object") {
      if (isEmptyValue(next.technician?.name) && !isEmptyValue(value.name)) {
        next.technician = { ...(next.technician || {}), name: value.name };
      }
      return;
    }
    const current = next[key];
    const write = isEmptyValue(current)
      || (typeof current === "string" && (/^No$/i.test(current.trim()) || /^Waiting$/i.test(current.trim())));
    if (!write) return;
    next[key] = value;
  });
  return next;
};

// Apply one dictated cassette entry, then mint the blocks the dictation
// describes — the dictation equivalent of the "Add block" button. A stated count
// ("cassette A had two blocks") creates that many app-made blocks; otherwise
// recording an embedding medium defaults to the single block per cassette, the
// same as picking a medium in the UI (ProcessingTab setEmbeddingMedium). Only an
// EMPTY block list is seeded: advisory dictation never clobbers or duplicates
// blocks already recorded. Blocks stay app-minted (`BLK-`), never extracted.
const applyCassettePatch = (cassette, entry) => {
  const next = fillEmpty(cassette, entry);
  if ((cassette.blocks || []).length > 0) return next;
  const stated = parseInt(String(entry?.block_count ?? ""), 10);
  const count = Number.isFinite(stated) && stated > 0
    ? stated
    : isEmptyValue(entry?.embedding_medium) ? 0 : 1;
  if (count > 0) next.blocks = Array.from({ length: count }, makeBlock);
  return next;
};

/**
 * Merge AI-extracted dictation into the processing state, filling empty fields
 * only.
 *
 *   • run  — applied to the FIRST run; a new run is created when the dictation
 *            provides run facts and none exists yet. With multiple runs the
 *            doctor routes by hand, so a single unnamed run is never
 *            mis-assigned across runs.
 *   • cassettes — an entry with a stated label is routed through `labelToId`
 *            (built by the tab from the current cassettes); an unmatched label
 *            is dropped. An entry with no label (batch-level facts) is applied
 *            to every cassette, filling empty fields only.
 *   • blocks — minted from what the dictation states per cassette: a stated
 *            `block_count` ("two blocks") creates that many, otherwise recording
 *            an `embedding_medium` defaults to one block per cassette. Only an
 *            empty block list is seeded.
 *
 * @param {object} processing  current processing state
 * @param {{ run?: object, cassettes?: Array<{label:string, ...fields}> }} patch
 * @param {Map<string,string>} labelToId  canonical cassette label -> cassette_id
 */
export const mergeProcessingExtraction = (processing = {}, patch = {}, labelToId = new Map()) => {
  const next = { ...processing };

  const patchRun = patch?.run || {};
  const hasRunFacts = Object.values(patchRun).some((value) => !isEmptyValue(value));
  if (hasRunFacts) {
    const runs = Array.isArray(next.runs) ? next.runs.slice() : [];
    // A dictated run with no run defined yet is created so the facts land.
    if (runs.length === 0) runs.push(makeRun());
    runs[0] = fillEmpty(runs[0], patchRun);
    next.runs = runs;
  }

  const patchCassettes = Array.isArray(patch?.cassettes) ? patch.cassettes : [];
  if (patchCassettes.length > 0) {
    const cassettes = Array.isArray(next.cassettes) ? next.cassettes.slice() : [];
    patchCassettes.forEach((entry) => {
      const canon = canonLabel(entry?.label);
      if (canon) {
        const targetId = labelToId.get(canon);
        if (!targetId) return;
        const index = cassettes.findIndex((cassette) => cassette.cassette_id === targetId);
        if (index === -1) return;
        cassettes[index] = applyCassettePatch(cassettes[index], entry);
        return;
      }
      // Batch-level facts with no stated cassette label: fill empty fields on
      // every cassette. The doctor dictated the fact and nothing is clobbered.
      for (let index = 0; index < cassettes.length; index += 1) {
        cassettes[index] = applyCassettePatch(cassettes[index], entry);
      }
    });
    next.cassettes = cassettes;
  }

  return next;
};
