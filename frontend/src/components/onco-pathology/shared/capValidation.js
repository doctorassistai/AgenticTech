// shared/capValidation.js — CAP protocol validation (pure, deterministic)
//
// Ported from templates/pathology.py endpoints /validate-cap-pathology and
// /pathology/validate-cap. Despite the old backend's "engine: llama-..."
// metadata label, NO AI is involved — these are plain rule checks. Kept on the
// frontend as pure functions; results are derived on demand (never persisted).
//
// Each function returns an array of result items:
//   { level: "ok" | "warning" | "error" | "info", title, message }
// The dialog renders these as MUI alerts.

// ─── helpers ─────────────────────────────────────────────────────────────────
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

// Band a margin distance (cm) into a message. `label` names the margin.
function marginBand(label, value) {
  const n = num(value);
  if (n === null) return { level: "info", title: `${label} Margin`, message: `${label} margin not provided.` };
  if (n < 0.1) return { level: "error", title: `${label} Margin`, message: `${label} margin (${n} cm) is extremely close — possible involvement.` };
  if (n < 1) return { level: "warning", title: `${label} Margin`, message: `${label} margin (${n} cm) — narrow margin (<1 cm).` };
  return { level: "ok", title: `${label} Margin`, message: `${label}: ${n} cm (adequate).` };
}

// ─── Grossing Bench: fixative cautions + margin adequacy ─────────────────────
// Mirrors POST /validate-cap-pathology. Reads fields that actually exist: the
// fixative / transport medium from the selected accessioned container, and the
// named margins from the grossing record (stored in mm, banded here in cm).
// Fixation *duration* is intentionally not checked here — its end point is
// recorded per-cassette in Processing, so the 6–72 h checks live in
// validateProcessingCompleteness.
export function validateGrossingCAP(record = {}, sourceSpecimen = {}) {
  const results = [];

  // Fixative cautions (fresh/unfixed and alcohol compromise downstream testing).
  const containers = Array.isArray(sourceSpecimen?.containers) ? sourceSpecimen.containers : [];
  const selectedIds = new Set(Array.isArray(record?.selected_container_ids) ? record.selected_container_ids : []);
  const selectedContainer = containers.find((container) => selectedIds.has(container?.container_id)) || containers[0];
  const fixative = selectedContainer?.fixative_transport_medium || "";
  const fixNotes = [];
  let fixLevel = "ok";

  if (/fresh|unfixed/i.test(fixative)) {
    fixLevel = "warning";
    fixNotes.push("Specimen received unfixed — immediate fixation required for optimal IHC.");
  }
  if (/alcohol/i.test(fixative)) {
    fixLevel = "warning";
    fixNotes.push("Alcohol fixation can compromise DNA/RNA extraction for molecular testing.");
  }

  if (!fixative) {
    results.push({ level: "info", title: "Fixative", message: "No fixative / transport medium is recorded on the source container." });
  } else {
    results.push(
      fixLevel === "warning"
        ? { level: "warning", title: "Fixative Alert", message: fixNotes.join("\n") }
        : { level: "ok", title: "Fixative Acceptable", message: `${fixative} — fixation is compatible with downstream IHC and molecular testing.` }
    );
  }

  // Margins (report closest margin in cm). The grossing record stores named
  // margins in mm; band them the same way the original endpoint did.
  const margins = Array.isArray(record?.resection?.margins) ? record.resection.margins : [];
  const cm = (mm) => {
    const n = num(mm);
    return n === null ? null : String(n / 10);
  };
  const findMargin = (pattern) => margins.find((margin) => pattern.test(margin?.name || ""));
  if (margins.length === 0) {
    results.push({ level: "info", title: "Margins", message: "No specimen-specific margins are recorded for this grossing." });
  } else {
    results.push(marginBand("Proximal", cm(findMargin(/proximal/i)?.distance_mm)));
    results.push(marginBand("Distal", cm(findMargin(/distal/i)?.distance_mm)));
    results.push(marginBand("Radial/Circumferential", cm(findMargin(/radial|circumferential/i)?.distance_mm)));
    const others = margins.filter((margin) => margin?.name && !/proximal|distal|radial|circumferential/i.test(margin.name));
    if (others.length) {
      results.push({ level: "info", title: "Other Margins", message: others.map((margin) => margin.name).join(", ") });
    }
  }

  return results;
}

// Grossing requirements vary by specimen and organ. Until a configured,
// versioned protocol source is available, this performs deterministic workflow
// completeness and lineage checks only; it does not claim CAP compliance.
export function validateGrossingCompleteness(record = {}, sourceSpecimen = {}) {
  if (!record?.specimen_id) {
    return [{ level: "error", title: "Specimen Link Missing", message: "Select an accessioned specimen before recording Grossing." }];
  }

  const results = [];
  const missingCommon = [];
  if (!record.grossed_by?.name) missingCommon.push("grossed by");
  if (!record.grossing_datetime) missingCommon.push("grossing date/time");
  if (!record.common?.gross_description) missingCommon.push("gross description");
  if (!record.specimen_class) missingCommon.push("specimen class");
  results.push(missingCommon.length
    ? { level: "warning", title: "Common Grossing Fields", message: `Missing: ${missingCommon.join(", ")}.` }
    : { level: "ok", title: "Common Grossing Fields", message: "Core Grossing identification and description fields are recorded." });

  const sourceContainerIds = new Set((sourceSpecimen?.containers || []).map((container) => container.container_id));
  const selectedContainerIds = record.selected_container_ids || [];
  const invalidContainerIds = selectedContainerIds.filter((id) => !sourceContainerIds.has(id));
  if (invalidContainerIds.length) {
    results.push({ level: "error", title: "Container Lineage", message: `Unknown source container IDs: ${invalidContainerIds.join(", ")}.` });
  } else if (sourceContainerIds.size > 0 && selectedContainerIds.length === 0) {
    results.push({ level: "error", title: "Container Lineage", message: "Select and barcode-verify an accessioned source container before Grossing." });
  } else {
    results.push({ level: "ok", title: "Container Lineage", message: "Grossing references the selected specimen and valid accessioned containers." });
  }

  const latestVerificationByContainer = new Map();
  (record.container_verifications || []).forEach((verification) => {
    if (verification?.container_id) latestVerificationByContainer.set(verification.container_id, verification);
  });
  const unverifiedContainerIds = selectedContainerIds.filter(
    (containerId) => latestVerificationByContainer.get(containerId)?.result !== "matched"
  );
  let barcodeVerificationResult;
  if (selectedContainerIds.length === 0) {
    barcodeVerificationResult = {
      level: "error",
      title: "Container Barcode Verification",
      message: "No source container is selected for barcode verification.",
    };
  } else if (unverifiedContainerIds.length) {
    barcodeVerificationResult = {
      level: "error",
      title: "Container Barcode Verification",
      message: `Missing, unreadable, or mismatched barcode image for: ${unverifiedContainerIds.join(", ")}.`,
    };
  } else {
    barcodeVerificationResult = {
      level: "ok",
      title: "Container Barcode Verification",
      message: "Every selected container has a matching barcode image verification.",
    };
  }
  results.push(barcodeVerificationResult);

  if (record.specimen_class === "Small biopsy") {
    const missing = [];
    if (isBlank(record.biopsy?.tissue_count)) missing.push("tissue count");
    if (!record.biopsy?.measurement_basis) missing.push("individual/aggregate measurement basis");
    if (!record.biopsy?.entire_specimen_submitted) missing.push("entire-specimen-submitted decision");
    results.push(missing.length
      ? { level: "warning", title: "Small Biopsy Details", message: `Missing: ${missing.join(", ")}.` }
      : { level: "ok", title: "Small Biopsy Details", message: "Biopsy count, measurement basis, and submission decision are recorded." });
  }

  if (record.specimen_class === "Large specimen / resection") {
    const missing = [];
    if (!record.resection?.lesion_location) missing.push("lesion/tumor location");
    if (isBlank(record.resection?.tumor_dimensions_mm?.length_mm)) missing.push("tumor greatest dimension");
    if ((record.resection?.margins || []).length === 0) missing.push("specimen-specific margins");
    results.push(missing.length
      ? { level: "warning", title: "Resection Details", message: `Missing: ${missing.join(", ")}.` }
      : { level: "ok", title: "Resection Details", message: "Core lesion measurements and specimen-specific margins are recorded." });

    const groupCount = (record.resection?.lymph_node_groups || []).reduce((sum, group) => {
      const count = num(group.count_identified);
      return sum + (count === null ? 0 : count);
    }, 0);
    const total = num(record.resection?.lymph_nodes_identified);
    if (total !== null && groupCount > total) {
      results.push({ level: "error", title: "Lymph Node Count", message: `Group counts (${groupCount}) exceed the total nodes identified (${total}).` });
    } else {
      results.push({ level: "info", title: "Lymph Node Scope", message: "Grossing records nodes identified/submitted only. Examined and positive counts belong to microscopy/synoptic reporting." });
    }
  }

  const cassettes = record.cassettes || [];
  const duplicateLabels = cassettes
    .map((cassette) => String(cassette.label || "").trim().toLowerCase())
    .filter((label, index, labels) => label && labels.indexOf(label) !== index);
  const incompleteCassettes = cassettes.filter((cassette) => !cassette.label || !cassette.tissue_description);
  if (duplicateLabels.length) {
    results.push({ level: "error", title: "Cassette Labels", message: "Cassette labels must be unique within the Grossing record." });
  } else if (cassettes.length === 0) {
    results.push({ level: "warning", title: "Cassette Sampling", message: "No cassettes have been documented." });
  } else if (incompleteCassettes.length) {
    results.push({ level: "warning", title: "Cassette Sampling", message: `${incompleteCassettes.length} cassette(s) are missing a label or tissue description.` });
  } else {
    results.push({ level: "ok", title: "Cassette Sampling", message: `${cassettes.length} cassette(s) have stable IDs, labels, and tissue descriptions.` });
  }

  if (record.status === "Completed" && results.some((item) => item.level === "error" || item.level === "warning")) {
    results.push({ level: "warning", title: "Completion Status", message: "The record is marked Completed while review warnings remain." });
  }
  return results;
}

// ─── Processing & Embedding: reconciliation + handoff checks ─────────────────
// Pure software (not AI): cassette↔run↔block reconciliation, timestamp/delay
// sanity, fixation duration, decalcification completeness, and
// Sectioning-handoff contradictions. Advisory protocol/orientation suggestions
// come from the separate AI endpoint. Deterministic and never persisted.
export function validateProcessingCompleteness(processing = {}, specimens = []) {
  const runs = Array.isArray(processing.runs) ? processing.runs : [];
  const cassettes = Array.isArray(processing.cassettes) ? processing.cassettes : [];

  if (cassettes.length === 0) {
    return [{ level: "warning", title: "No Cassettes", message: "No Grossing cassettes or cytology cell blocks are available to process. Complete Grossing, or make a cell block in Cytopathology, first." }];
  }

  const results = [];
  const runById = new Map(runs.map((run) => [run.run_id, run]));
  // A cell block was embedded from a cytology pellet, not cut at the grossing
  // bench, so it has no cassette barcode to verify against and is excluded from
  // intake reconciliation. Everything after intake applies to it normally.
  const isCellBlock = (entry = {}) => entry.source === "cell_block";
  const benchCassettes = cassettes.filter((entry) => !isCellBlock(entry));
  const cellBlocks = cassettes.filter(isCellBlock);

  // 1. Intake reconciliation: expected (all bench cassettes) vs received (verified).
  const received = benchCassettes.filter((c) => c.received === "Verified").length;
  const mismatched = benchCassettes.filter((c) => c.received === "Mismatch").length;
  if (mismatched > 0) {
    results.push({ level: "error", title: "Cassette Intake", message: `${mismatched} cassette(s) flagged as a barcode/label mismatch at intake.` });
  } else if (!benchCassettes.length) {
    results.push({ level: "ok", title: "Cassette Intake", message: "No grossing cassettes on this case; intake verification does not apply." });
  } else if (received < benchCassettes.length) {
    results.push({ level: "warning", title: "Cassette Intake", message: `${received} of ${benchCassettes.length} cassette(s) verified as received; ${benchCassettes.length - received} still unverified.` });
  } else {
    results.push({ level: "ok", title: "Cassette Intake", message: `All ${benchCassettes.length} cassette(s) verified as received.` });
  }
  if (cellBlocks.length) {
    results.push({ level: "info", title: "Cell Blocks", message: `${cellBlocks.length} cytology cell block(s) are being processed. Cassette barcode verification does not apply to them.` });
  }

  // 2. Run assignment.
  const unassigned = cassettes.filter((c) => !c.run_id);
  const dangling = cassettes.filter((c) => c.run_id && !runById.has(c.run_id));
  if (dangling.length) {
    results.push({ level: "error", title: "Run Assignment", message: `${dangling.length} cassette(s) reference a run that no longer exists.` });
  } else if (unassigned.length) {
    results.push({ level: "warning", title: "Run Assignment", message: `${unassigned.length} cassette(s) are not assigned to a processing run.` });
  } else if (runs.length) {
    results.push({ level: "ok", title: "Run Assignment", message: `All cassettes are assigned across ${runs.length} run(s).` });
  }

  // 3. Per-run protocol + timeline; a Completed run should have its cassettes embedded.
  runs.forEach((run, index) => {
    const label = run.batch_run_id || `Run ${index + 1}`;
    if (!run.protocol) {
      results.push({ level: "warning", title: "Run Protocol", message: `${label}: no processing protocol selected.` });
    }
    if (run.start_datetime && run.end_datetime && run.end_datetime < run.start_datetime) {
      results.push({ level: "error", title: "Run Timeline", message: `${label}: processing end is before start.` });
    } else if (run.start_datetime && run.end_datetime) {
      const start = new Date(run.start_datetime).getTime();
      const end = new Date(run.end_datetime).getTime();
      if (Number.isFinite(start) && Number.isFinite(end) && (end - start) / 3600000 > 36) {
        results.push({ level: "info", title: "Processing Duration", message: `${label} spanned ${Math.round((end - start) / 3600000)} h — longer than a typical overnight cycle; check for a delay.` });
      }
    }
    if (run.status === "Completed") {
      const notEmbedded = cassettes.filter((c) => c.run_id === run.run_id && !c.embedding_medium).length;
      if (notEmbedded) {
        results.push({ level: "warning", title: "Run Completion", message: `${label} is marked Completed but ${notEmbedded} of its cassette(s) are not yet embedded.` });
      }
    }
  });

  // 3b. Fixation duration (tumour-marker pre-analytical timing). Fixation runs
  // from the specimen's fixation-start (Tab 1) to the cassette's fixation-end
  // (time removed from formalin / loaded into the processor). Under 6 h gives
  // inadequate nuclear detail; over 72 h can reduce antigenicity; 6–12 h is
  // suboptimal for IHC. An end before the specimen's start is an impossible
  // timeline and is raised as an error.
  const specimenById = new Map((specimens || []).map((specimen) => [specimen.specimen_id, specimen]));
  const fixationInverted = [];
  const shortFixation = [];
  const prolongedFixation = [];
  const suboptimalFixation = [];
  cassettes.forEach((cassette) => {
    const fixationStart = specimenById.get(cassette.parent_specimen_id)?.fixation_start_datetime;
    const fixationEnd = cassette.fixation_end_datetime;
    if (!fixationStart || !fixationEnd) return;
    const start = new Date(fixationStart).getTime();
    const end = new Date(fixationEnd).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end)) return;
    const hours = (end - start) / 3600000;
    if (hours < 0) fixationInverted.push(cassette.cassette_id);
    else if (hours < 6) shortFixation.push(cassette.cassette_id);
    else if (hours > 72) prolongedFixation.push(cassette.cassette_id);
    else if (hours < 12) suboptimalFixation.push(cassette.cassette_id);
  });
  if (fixationInverted.length) {
    results.push({ level: "error", title: "Fixation Timeline", message: `${fixationInverted.length} cassette(s) record a fixation end before the specimen's fixation start. Check the recorded times.` });
  }
  if (shortFixation.length) {
    results.push({ level: "warning", title: "Fixation Duration", message: `${shortFixation.length} cassette(s) were fixed for under 6 hours — inadequate nuclear detail for optimal interpretation.` });
  }
  if (prolongedFixation.length) {
    results.push({ level: "warning", title: "Fixation Duration", message: `${prolongedFixation.length} cassette(s) exceeded 72 hours in formalin — prolonged fixation may reduce antigenicity for IHC markers.` });
  }
  if (suboptimalFixation.length) {
    results.push({ level: "info", title: "Fixation Duration", message: `${suboptimalFixation.length} cassette(s) were fixed for under 12 hours; CAP recommends ≥12 h for optimal IHC.` });
  }

  // 4. Per-cassette embedding, blocks, decalcification, and handoff.
  const embeddedNoBlock = cassettes.filter((c) => c.embedding_medium && (c.blocks || []).length === 0);
  const decalIncomplete = cassettes.filter((c) => c.decalcification_required === "Yes" && (!c.decalcification_agent || !c.decal_start_datetime));
  const strongAcidDecal = cassettes.filter((c) => c.decalcification_required === "Yes" && /hcl|formic/i.test(c.decalcification_agent || ""));
  const readyContradiction = cassettes.filter((c) => c.ready_for_sectioning === "Yes"
    && (c.processing_quality === "Underprocessed" || c.processing_quality === "Overprocessed"
      || c.reprocessing_required === "Yes" || (c.blocks || []).length === 0));

  if (embeddedNoBlock.length) {
    results.push({ level: "warning", title: "Blocks", message: `${embeddedNoBlock.length} embedded cassette(s) have no block generated.` });
  }
  if (decalIncomplete.length) {
    results.push({ level: "warning", title: "Decalcification", message: `${decalIncomplete.length} cassette(s) require decalcification but are missing the agent or start time.` });
  }
  if (strongAcidDecal.length) {
    results.push({ level: "warning", title: "Strong-Acid Decalcification", message: `${strongAcidDecal.length} cassette(s) use strong-acid decalcification (HCl/formic acid), which may impair IHC, ISH, and molecular studies. Confirm downstream testing needs.` });
  }
  if (readyContradiction.length) {
    results.push({ level: "error", title: "Sectioning Handoff", message: `${readyContradiction.length} cassette(s) marked Ready for Sectioning still have a quality problem, a pending reprocessing flag, or no block.` });
  }

  if (!results.some((item) => item.level === "error" || item.level === "warning")) {
    const readyCount = cassettes.filter((c) => c.ready_for_sectioning === "Yes").length;
    const blockCount = cassettes.reduce((sum, c) => sum + (c.blocks || []).length, 0);
    results.push({ level: "ok", title: "Ready for Sectioning", message: `${readyCount} of ${cassettes.length} cassette(s) marked ready; ${blockCount} block(s) generated.` });
  }

  return results;
}

// ─── Sectioning / Microtomy: slide reconciliation + handoff checks ───────────
// Pure software (not AI): block↔event↔slide reconciliation, slide-count and
// duplicate-ID checks, label verification before Staining, block-exhaustion
// tracking, and the repeated-cutting-problem signal. Advisory thickness/level
// judgement comes from the separate AI endpoint. Deterministic, never persisted.
//
// `blocks` is the Processing block inventory (processingBlocks() in
// shared/sectioningModel.js), passed in so this file stays dependency-free.
export function validateSectioningCompleteness(sectioning = {}, blocks = []) {
  const events = Array.isArray(sectioning.events) ? sectioning.events : [];

  if (blocks.length === 0) {
    return [{ level: "warning", title: "No Blocks", message: "No blocks are available to section. Complete embedding in Processing first." }];
  }
  if (events.length === 0) {
    return [{ level: "warning", title: "No Sectioning Recorded", message: `${blocks.length} block(s) are available but no sectioning event has been recorded.` }];
  }

  const results = [];
  const blockById = new Map(blocks.map((block) => [block.block_id, block]));
  const eventSlides = (event) => (Array.isArray(event.slides) ? event.slides : []);
  const problem = (quality) => !!quality && quality !== "Acceptable";

  // 1. Coverage: released blocks not yet cut, and cuts taken on unreleased blocks.
  const cutBlockIds = new Set(events.map((event) => event.block_id));
  const releasedNotCut = blocks.filter((block) => block.released_for_sectioning && !cutBlockIds.has(block.block_id));
  const cutNotReleased = events.filter((event) => !blockById.get(event.block_id)?.released_for_sectioning);
  if (cutNotReleased.length) {
    results.push({ level: "error", title: "Block Release", message: `${cutNotReleased.length} sectioning event(s) are recorded on block(s) not marked Ready for Sectioning in Processing.` });
  }
  if (releasedNotCut.length) {
    results.push({ level: "warning", title: "Block Coverage", message: `${releasedNotCut.length} released block(s) have no sectioning event yet.` });
  }

  const unverifiedBlocks = events.filter((event) => {
    const attempts = Array.isArray(event.block_verifications) ? event.block_verifications : [];
    return attempts[attempts.length - 1]?.result !== "matched";
  });
  if (unverifiedBlocks.length) {
    results.push({ level: "error", title: "Block Barcode Verification", message: `${unverifiedBlocks.length} sectioning event(s) do not have a matching barcode image for the selected Processing block.` });
  }

  // 2. Cutting details completeness.
  const missingCutDetails = events.filter((event) => !event.thickness_um || !event.sectioned_by || !event.sectioning_datetime);
  if (missingCutDetails.length) {
    results.push({ level: "warning", title: "Cutting Details", message: `${missingCutDetails.length} event(s) are missing section thickness, who sectioned, or the sectioning date/time.` });
  }

  // 3. Levels: cut fewer than requested.
  const levelShortfall = events.filter((event) => {
    const requested = num(event.levels_requested);
    const cut = num(event.levels_cut);
    return requested !== null && cut !== null && cut < requested;
  });
  if (levelShortfall.length) {
    results.push({ level: "warning", title: "Levels Cut", message: `${levelShortfall.length} event(s) cut fewer levels than were requested.` });
  }

  // 4. Slide-count reconciliation: expected vs slide IDs actually generated.
  const noSlides = events.filter((event) => eventSlides(event).length === 0);
  const countMismatch = events.filter((event) => {
    const expected = num(event.expected_slide_count);
    return expected !== null && expected !== eventSlides(event).length;
  });
  if (noSlides.length) {
    results.push({ level: "warning", title: "Slides Produced", message: `${noSlides.length} sectioning event(s) have no slide recorded.` });
  }
  if (countMismatch.length) {
    results.push({ level: "warning", title: "Slide Count", message: `${countMismatch.length} event(s) have an expected slide count that does not match the number of slide IDs generated.` });
  }

  // 5. Duplicate slide IDs across the whole case (breaks Staining lineage).
  const slideIds = events.flatMap((event) => eventSlides(event).map((slide) => slide.slide_id));
  const duplicateSlideIds = slideIds.filter((id, index) => id && slideIds.indexOf(id) !== index);
  if (duplicateSlideIds.length) {
    results.push({ level: "error", title: "Slide IDs", message: `Duplicate slide ID(s) detected: ${[...new Set(duplicateSlideIds)].join(", ")}.` });
  }

  // 6. Slides with no intended use have no Staining destination.
  const noIntendedUse = events.reduce((sum, event) => sum + eventSlides(event).filter((slide) => !slide.intended_use).length, 0);
  if (noIntendedUse) {
    results.push({ level: "warning", title: "Slide Intended Use", message: `${noIntendedUse} slide(s) have no intended use recorded, so no Staining destination can be derived.` });
  }

  // 7. Quality problems must resolve into a recut decision.
  const unresolvedQuality = events.filter((event) =>
    (problem(event.section_quality) || event.tissue_adequately_represented === "No") && event.recut_required !== "Yes");
  const recutNoReason = events.filter((event) => event.recut_required === "Yes" && !event.recut_reason);
  if (unresolvedQuality.length) {
    results.push({ level: "warning", title: "Section Quality", message: `${unresolvedQuality.length} event(s) record a section-quality problem or inadequate tissue representation without a recut decision.` });
  }
  if (recutNoReason.length) {
    results.push({ level: "warning", title: "Recut Reason", message: `${recutNoReason.length} event(s) require a recut but give no reason.` });
  }

  // 8. Repeated cutting problems on one block point upstream — processing,
  // embedding orientation, blade, or microtome — not at the block itself.
  const problemsByBlock = new Map();
  events.forEach((event) => {
    if (!problem(event.section_quality)) return;
    problemsByBlock.set(event.block_id, (problemsByBlock.get(event.block_id) || 0) + 1);
  });
  const repeatProblemBlocks = [...problemsByBlock.entries()].filter(([, count]) => count >= 2);
  if (repeatProblemBlocks.length) {
    results.push({
      level: "warning",
      title: "Repeated Cutting Problems",
      message: `${repeatProblemBlocks.length} block(s) had a section-quality problem on 2 or more cuts. Check tissue processing, embedding orientation, blade, and microtome condition before cutting again.`,
    });
  }

  // 9. Tissue conservation: exhausted blocks, and cuts taken after exhaustion.
  const currentStatus = new Map();
  events.forEach((event) => {
    if (event.block_id && event.block_status) currentStatus.set(event.block_id, event.block_status);
  });
  const exhausted = [...currentStatus.entries()].filter(([, status]) => status === "Exhausted");
  const lowTissue = [...currentStatus.entries()].filter(([, status]) => status === "Low tissue");
  const cutAfterExhaustion = events.filter((event, index) =>
    events.slice(0, index).some((prior) => prior.block_id === event.block_id && prior.block_status === "Exhausted"));
  if (cutAfterExhaustion.length) {
    results.push({ level: "error", title: "Block Exhausted", message: `${cutAfterExhaustion.length} sectioning event(s) were recorded on a block already marked Exhausted.` });
  } else if (exhausted.length) {
    results.push({ level: "warning", title: "Block Exhausted", message: `${exhausted.length} block(s) are exhausted — no further levels, IHC, or molecular studies can be cut from them.` });
  }
  if (lowTissue.length) {
    results.push({ level: "info", title: "Low Tissue", message: `${lowTissue.length} block(s) are low on tissue. Reserve unstained slides before spending further levels.` });
  }

  // 10. Staining handoff contradictions.
  const handoffContradiction = events.filter((event) => event.ready_for_staining === "Yes"
    && (eventSlides(event).length === 0 || event.recut_required === "Yes" || problem(event.section_quality)));
  const unverifiedLabels = events
    .filter((event) => event.ready_for_staining === "Yes")
    .reduce((sum, event) => sum + eventSlides(event).filter((slide) => slide.label_verified !== "Verified").length, 0);
  if (handoffContradiction.length) {
    results.push({ level: "error", title: "Staining Handoff", message: `${handoffContradiction.length} event(s) marked Ready for Staining still have no slide, a pending recut, or a section-quality problem.` });
  }
  if (unverifiedLabels) {
    results.push({ level: "error", title: "Slide Label Verification", message: `${unverifiedLabels} slide(s) released to Staining have not had their label/barcode verified against the parent block.` });
  }

  if (!results.some((item) => item.level === "error" || item.level === "warning")) {
    const readySlides = events
      .filter((event) => event.ready_for_staining === "Yes")
      .reduce((sum, event) => sum + eventSlides(event).length, 0);
    results.push({ level: "ok", title: "Ready for Staining", message: `${events.length} sectioning event(s) across ${cutBlockIds.size} block(s); ${readySlides} of ${slideIds.length} slide(s) released to Staining.` });
  }

  return results;
}

// ─── Staining: slide coverage, controls, traceability, Microscopy return ─────
// Deterministic reconciliation of Tab 5 against the slides Sectioning released.
// Checks only what software can decide from the record — slide coverage, control
// gating, reagent traceability, repeat lineage, and the return leg to Microscopy.
// Panel judgement (which extra marker to add) comes from the separate AI endpoint.
//
// After the ancillary-result ownership change this tab holds the LABORATORY
// record only, so nothing here checks a percentage, score or interpretation:
// those belong to microscopy.ancillary_results[] and are checked by
// validateMicroscopyCompleteness. What is checked instead is that escalated work
// came from a pathologist request, that the target performed matches the target
// requested, and that completed work reaches a reading.
//
// `slides` is the Sectioning slide inventory (sectioningSlides() in
// shared/stainingModel.js). `interpretations` is the assembled read-only
// projection (completeAncillaryResults() in shared/microscopyModel.js). Both are
// passed in so this file stays dependency-free.
export function validateStainingCompleteness(staining = {}, slides = [], interpretations = []) {
  const records = Array.isArray(staining.records) ? staining.records : [];

  if (slides.length === 0) {
    return [{ level: "warning", title: "No Slides", message: "No slides have been cut. Complete Sectioning before staining." }];
  }

  const released = slides.filter((slide) => slide.released);
  if (records.length === 0) {
    return [{ level: "warning", title: "No Staining Recorded", message: `${released.length} of ${slides.length} slide(s) are released for staining but no stain order has been recorded.` }];
  }

  const results = [];
  const slideById = new Map(slides.map((slide) => [slide.slide_id, slide]));
  const controlRequired = new Set(["Special stain", "IHC", "FISH"]);
  const repeatTypes = new Set(["Repeat", "Restain"]);

  // Local (duplicated) readers keep this file free of model imports, as elsewhere.
  const targetOf = (r) => {
    if (r.modality === "H&E") return "H&E";
    if (r.modality === "Special stain") return r.special?.stain_type === "Other" ? (r.special?.stain_type_other || "") : (r.special?.stain_type || "");
    if (r.modality === "IHC") return r.ihc?.marker || "";
    if (r.modality === "FISH") return r.fish?.gene_target || "";
    return "";
  };
  const controlOk = (r) => r.control_result === "Pass"
    || (r.control_result === "Not applicable" && !controlRequired.has(r.modality));
  const completed = records.filter((r) => r.status === "Completed");
  const readingByStain = new Map(interpretations
    .filter((item) => item.stain_id)
    .map((item) => [item.stain_id, item]));

  // 1. Slide coverage and release state. Reserve slides are excluded from the
  // coverage expectation — they are deliberately held back.
  const orderedSlideIds = new Set(records.map((r) => r.slide_id));
  const uncovered = released.filter((slide) =>
    slide.intended_use !== "Unstained reserve" && !orderedSlideIds.has(slide.slide_id));
  const notReleased = records.filter((r) => !slideById.get(r.slide_id)?.released);
  const reserveConsumed = records.filter((r) => slideById.get(r.slide_id)?.intended_use === "Unstained reserve");
  if (notReleased.length) {
    results.push({ level: "error", title: "Slide Release", message: `${notReleased.length} stain order(s) are recorded on slide(s) not released for staining in Sectioning (Ready for Staining is not Yes).` });
  }
  if (uncovered.length) {
    results.push({ level: "warning", title: "Slide Coverage", message: `${uncovered.length} released slide(s) have no stain order yet.` });
  }
  if (reserveConsumed.length) {
    results.push({ level: "warning", title: "Unstained Reserve", message: `${reserveConsumed.length} stain order(s) consume slide(s) reserved as unstained. Confirm the reserve is no longer needed for molecular work.` });
  }

  // 2. Label verification — a stain must not be released against an unverified slide.
  const unverified = records.filter((r) => slideById.get(r.slide_id)?.label_verified !== "Verified");
  if (unverified.length) {
    results.push({ level: "error", title: "Slide Label Verification", message: `${unverified.length} stain order(s) are on slide(s) whose label/barcode was not verified against the parent block in Sectioning.` });
  }

  const missingImageVerification = records.filter((record) => {
    const latest = Array.isArray(record.slide_verifications) ? record.slide_verifications[record.slide_verifications.length - 1] : null;
    return latest?.result !== "matched";
  });
  if (missingImageVerification.length) {
    results.push({ level: "error", title: "Slide Image Verification", message: `${missingImageVerification.length} stain order(s) do not have a latest matching slide barcode image verification.` });
  }

  // 3. Sub-workflow and target identity. A stain with no named target cannot be
  // interpreted or reported.
  const noModality = records.filter((r) => !r.modality);
  const noTarget = records.filter((r) => r.modality && !targetOf(r));
  const useMismatch = records.filter((r) => {
    const use = slideById.get(r.slide_id)?.intended_use;
    const expected = { "H&E": "H&E", "Special stain": "Special stain", IHC: "IHC", Molecular: "FISH" }[use];
    return expected && r.modality && r.modality !== expected;
  });
  if (noModality.length) {
    results.push({ level: "error", title: "Stain Sub-Workflow", message: `${noModality.length} stain order(s) have no sub-workflow (H&E, special stain, IHC, or FISH) selected.` });
  }
  if (noTarget.length) {
    results.push({ level: "error", title: "Stain Target", message: `${noTarget.length} stain order(s) name no stain, marker, or gene target.` });
  }
  if (useMismatch.length) {
    results.push({ level: "warning", title: "Intended Use Mismatch", message: `${useMismatch.length} stain order(s) use a sub-workflow that differs from the slide's intended use recorded in Sectioning.` });
  }

  // 4. Execution details on work that has left the order queue.
  const started = records.filter((r) => r.status && r.status !== "Ordered" && r.status !== "Queued");
  const missingExecution = started.filter((r) => !r.technician || !r.stain_datetime || !r.run_batch_id);
  const missingProtocol = started.filter((r) => !r.protocol);
  if (missingExecution.length) {
    results.push({ level: "warning", title: "Run Details", message: `${missingExecution.length} stain order(s) in process or beyond are missing the technician, stain date/time, or run/batch ID.` });
  }
  if (missingProtocol.length) {
    results.push({ level: "warning", title: "Protocol", message: `${missingProtocol.length} stain order(s) in process or beyond record no protocol.` });
  }

  // 5. Control gating — the hard rule: work is not released for interpretation
  // without a passing control. Whether the pathologist then ACCEPTS that control
  // is a separate, professional decision recorded in Microscopy.
  const acceptedWithoutControl = completed.filter((r) => !controlOk(r));
  const failedControlNoRepeat = records.filter((r) => r.control_result === "Fail" && r.repeat_required !== "Yes" && r.status !== "Repeated");
  const controlNotApplicable = records.filter((r) => controlRequired.has(r.modality) && r.control_result === "Not applicable");
  const ihcNegativeControl = completed.filter((r) => r.modality === "IHC" && r.ihc?.negative_control_result !== "Pass");
  const interpretedWithoutControl = records.filter((r) => readingByStain.get(r.stain_id)?.interpretation && !controlOk(r));
  if (acceptedWithoutControl.length) {
    results.push({ level: "error", title: "Control Not Passed", message: `${acceptedWithoutControl.length} stain order(s) are marked Completed without a passing control. Work may only be released for interpretation on a passing control.` });
  }
  if (interpretedWithoutControl.length) {
    results.push({ level: "error", title: "Interpreted Without Control", message: `${interpretedWithoutControl.length} stain order(s) carry a pathologist interpretation while the technical control has not passed.` });
  }
  if (controlNotApplicable.length) {
    results.push({ level: "error", title: "Control Required", message: `${controlNotApplicable.length} special stain / IHC / FISH order(s) record the control as Not applicable. These modalities require their own control on the run.` });
  }
  if (failedControlNoRepeat.length) {
    results.push({ level: "warning", title: "Failed Control", message: `${failedControlNoRepeat.length} stain order(s) have a failed control with no repeat or restain decision recorded.` });
  }
  if (ihcNegativeControl.length) {
    results.push({ level: "warning", title: "IHC Negative Control", message: `${ihcNegativeControl.length} completed IHC order(s) have no passing negative control, so non-specific staining cannot be excluded.` });
  }

  // 6. Reagent and probe traceability — needed to reproduce or challenge a result.
  const ihcTraceability = records.filter((r) => r.modality === "IHC" && (!r.ihc?.clone || !r.ihc?.lot));
  const specialTraceability = records.filter((r) => r.modality === "Special stain" && !r.special?.reagent_lot);
  const fishTraceability = records.filter((r) => r.modality === "FISH" && (!r.fish?.probe_kit || !r.fish?.lot));
  const traceabilityGaps = ihcTraceability.length + specialTraceability.length + fishTraceability.length;
  if (traceabilityGaps) {
    results.push({
      level: "warning",
      title: "Reagent Traceability",
      message: `${traceabilityGaps} stain order(s) are missing reagent details — ${ihcTraceability.length} IHC without clone or lot, ${specialTraceability.length} special stain(s) without a reagent lot, ${fishTraceability.length} FISH without a probe kit or lot.`,
    });
  }

  // 7. Technical completion. The bench records that the run finished and when;
  // the reading of it is checked in Microscopy, not here.
  const heNoAppearance = completed.filter((r) => r.modality === "H&E" && !r.he?.appearance);
  const resultNoDatetime = completed.filter((r) => !r.result_datetime);
  if (heNoAppearance.length) {
    results.push({ level: "warning", title: "H&E Stain Quality", message: `${heNoAppearance.length} completed H&E order(s) record no stain appearance.` });
  }
  if (resultNoDatetime.length) {
    results.push({ level: "warning", title: "Completion Date", message: `${resultNoDatetime.length} completed stain order(s) have no completion date/time.` });
  }

  // 7b. Request linkage. Escalated work must come from a pathologist request, and
  // what was applied must be what was asked for — otherwise the result cannot be
  // returned to the review that asked the question.
  const requestedTypes = new Set(["Add-on", "Reflex", "Repeat", "Restain"]);
  const escalatedNoRequest = records.filter((r) => requestedTypes.has(r.work_type) && !r.request_id && !r.originating_review_id);
  if (escalatedNoRequest.length) {
    results.push({ level: "warning", title: "Request Linkage", message: `${escalatedNoRequest.length} add-on, reflex, repeat or restain order(s) have no linked Microscopy request, so the completed result has no review to return to.` });
  }

  // 8. FISH counting basis recorded by the laboratory. The criteria version and
  // the amplified / rearranged call belong to the pathologist's interpretation.
  const fishRecords = records.filter((r) => r.modality === "FISH");
  const fishNoCount = fishRecords.filter((r) => r.status === "Completed" && !r.fish?.cells_counted);
  const fishUninterpretable = fishRecords.filter((r) => r.fish?.signal_quality === "Uninterpretable" && r.repeat_required !== "Yes");
  if (fishNoCount.length) {
    results.push({ level: "warning", title: "FISH Counting Basis", message: `${fishNoCount.length} completed FISH order(s) record no number of cells counted, so the ratio cannot be reproduced.` });
  }
  if (fishUninterpretable.length) {
    results.push({ level: "warning", title: "FISH Signal Quality", message: `${fishUninterpretable.length} FISH order(s) have uninterpretable signal with no repeat decision.` });
  }

  // 9. Quality problems must resolve into a repeat decision, and a repeat must
  // point back at the run it replaces.
  const qualityUnresolved = records.filter((r) => r.quality_result === "Failed" && r.repeat_required !== "Yes");
  const repeatNoReason = records.filter((r) => r.repeat_required === "Yes" && !r.repeat_reason);
  const repeatNoParent = records.filter((r) => repeatTypes.has(r.work_type) && !r.repeat_of_stain_id);
  if (qualityUnresolved.length) {
    results.push({ level: "warning", title: "Stain Quality", message: `${qualityUnresolved.length} stain order(s) record failed quality with no repeat or restain decision.` });
  }
  if (repeatNoReason.length) {
    results.push({ level: "warning", title: "Repeat Reason", message: `${repeatNoReason.length} stain order(s) require a repeat but give no reason.` });
  }
  if (repeatNoParent.length) {
    results.push({ level: "warning", title: "Repeat Lineage", message: `${repeatNoParent.length} repeat or restain order(s) do not reference the earlier stain they replace.` });
  }

  // 10. Duplicate testing and panel size — tissue is finite.
  const firstPass = records.filter((r) => !repeatTypes.has(r.work_type));
  const byTarget = new Map();
  firstPass.forEach((r) => {
    const target = targetOf(r);
    if (!target || !r.parent_block_id) return;
    const key = `${r.parent_block_id}|${r.modality}|${target.toLowerCase()}`;
    byTarget.set(key, (byTarget.get(key) || 0) + 1);
  });
  const duplicated = [...byTarget.values()].filter((count) => count >= 2).length;
  const ihcByBlock = new Map();
  records.filter((r) => r.modality === "IHC").forEach((r) => {
    if (!r.parent_block_id) return;
    ihcByBlock.set(r.parent_block_id, (ihcByBlock.get(r.parent_block_id) || 0) + 1);
  });
  const largePanels = [...ihcByBlock.values()].filter((count) => count >= 8).length;
  if (duplicated) {
    results.push({ level: "warning", title: "Duplicate Testing", message: `${duplicated} stain target(s) are ordered more than once on the same block without being marked Repeat or Restain.` });
  }
  if (largePanels) {
    results.push({ level: "info", title: "Panel Size", message: `${largePanels} block(s) carry 8 or more IHC markers. Check remaining tissue in Sectioning before adding further markers.` });
  }

  // 11. The return leg to Microscopy — the diagnostic loop is only closed when the
  // completed run goes back to the review that asked for it and is read there.
  const notReturned = completed.filter((r) => r.returned_to_microscopy !== "Yes");
  const returnedNoDate = records.filter((r) => r.returned_to_microscopy === "Yes" && !r.returned_datetime);
  const awaitingReading = completed.filter((r) => controlOk(r)
    && r.modality !== "H&E"
    && !readingByStain.get(r.stain_id)?.interpretation);
  if (notReturned.length) {
    results.push({ level: "warning", title: "Microscopy Handoff", message: `${notReturned.length} completed stain result(s) have not been returned to Microscopy.` });
  }
  if (returnedNoDate.length) {
    results.push({ level: "warning", title: "Return Date", message: `${returnedNoDate.length} stain order(s) are marked returned to Microscopy with no return date/time.` });
  }
  if (awaitingReading.length) {
    results.push({ level: "info", title: "Awaiting Pathologist Reading", message: `${awaitingReading.length} completed stain(s) on an accepted control have no interpretation recorded in Microscopy yet.` });
  }

  // 12. One slide, one stain. A stained section is consumed, so two stains on the
  // same slide_id is a physical impossibility, not a preference.
  const slideUse = new Map();
  records.forEach((r) => {
    if (r.slide_id) slideUse.set(r.slide_id, (slideUse.get(r.slide_id) || 0) + 1);
  });
  const reusedSlides = [...slideUse.values()].filter((count) => count >= 2).length;
  if (reusedSlides) {
    results.push({ level: "error", title: "Slide Reused", message: `${reusedSlides} slide(s) carry more than one stain order. A stained section is consumed — each marker needs its own section cut in Sectioning.` });
  }

  // 13. Duplicate stain IDs would break the Microscopy reference.
  const stainIds = records.map((r) => r.stain_id);
  const duplicateIds = [...new Set(stainIds.filter((id, index) => id && stainIds.indexOf(id) !== index))];
  if (duplicateIds.length) {
    results.push({ level: "error", title: "Stain IDs", message: `Duplicate stain ID(s) detected: ${duplicateIds.join(", ")}.` });
  }

  if (!results.some((item) => item.level === "error" || item.level === "warning")) {
    const returned = completed.filter((r) => r.returned_to_microscopy === "Yes").length;
    results.push({
      level: "ok",
      title: "Ready for Microscopy",
      message: `${records.length} stain order(s) across ${new Set(records.map((r) => r.parent_block_id)).size} block(s); ${completed.length} completed on a passing control, ${returned} returned to Microscopy.`,
    });
  }

  return results;
}

// ─── Molecular & Genomic Testing: sample linkage, adequacy, assay versioning,
// ─── variant completeness, germline handling, integrated-diagnosis return ────
// Deterministic reconciliation of Tab 6. Checks only what software can decide
// from the record — whether the test is tied to a real sample, whether adequacy
// and QC support the result, whether each variant carries the notation and the
// classification provenance needed to read it, and whether the verified result
// went back to the review that asked for it. Which test to order and what a
// variant means clinically come from the separate AI endpoint.
//
// `blocks` / `slides` are the upstream inventories (molecularBlocks() and
// molecularSlides() in shared/molecularModel.js) and `mmrRows` the assembled MMR
// results (mmrAncillaryResults() in shared/microscopyModel.js: Staining technical
// record joined to the pathologist's interpretation), all passed in so this file
// stays dependency-free.
export function validateMolecularCompleteness(molecular = {}, blocks = [], slides = [], mmrRows = []) {
  const orders = Array.isArray(molecular.orders) ? molecular.orders : [];

  if (orders.length === 0) {
    return [{ level: "warning", title: "No Molecular Testing Recorded", message: "No molecular or genomic test order has been recorded on this case." }];
  }

  const results = [];
  const blockById = new Map(blocks.map((block) => [block.block_id, block]));
  const slideById = new Map(slides.map((slide) => [slide.slide_id, slide]));
  const tissueClasses = new Set(["Tissue block", "Slide", "Tissue curls / scrolls"]);
  // Genome-scale sequencing (WES/WGS) reads everything, so its targets cannot be
  // reduced to a gene list. It is also tumour-only: a molecular order has no field
  // for a matched normal sample, so a germline call on a WES/WGS can only ever be
  // possible, never confirmed (rule 9).
  const genomeScaleTypes = new Set(["Whole exome sequencing (WES)", "Whole genome sequencing (WGS)"]);
  const tumourOnlyTypes = new Set([
    "NGS panel", "PCR", "RT-PCR", "MSI-PCR", "TMB", "cfDNA / ctDNA",
    ...genomeScaleTypes,
  ]);
  const consumedStatuses = new Set(["Sample preparation", "Running", "Analysis", "Reported"]);
  const germlineOrigins = new Set(["Possible germline", "Confirmed germline"]);

  const typeOf = (o) => (o.test_type === "Other" ? (o.test_type_other || "") : (o.test_type || ""));
  const variantsOf = (o) => (Array.isArray(o.variants) ? o.variants : []);
  const isTissue = (o) => tissueClasses.has(o.sample_class);
  const isGenomeScale = (o) => genomeScaleTypes.has(o.test_type);
  const reported = orders.filter((o) => o.status === "Reported");
  const consumed = orders.filter((o) => consumedStatuses.has(o.status));
  const allVariants = orders.flatMap((o) => variantsOf(o).map((v) => ({ order: o, variant: v })));

  // 1. Order identity. A test with no named type cannot be interpreted or billed.
  const noType = orders.filter((o) => !typeOf(o));
  const noIndication = orders.filter((o) => !o.clinical_indication && !o.diagnostic_question);
  const noRequester = orders.filter((o) => !o.requested_by || !o.request_datetime);
  if (noType.length) {
    results.push({ level: "error", title: "Test Type", message: `${noType.length} molecular order(s) name no test type.` });
  }
  if (noIndication.length) {
    results.push({ level: "warning", title: "Clinical Indication", message: `${noIndication.length} molecular order(s) record neither a clinical indication nor the diagnostic question the test should answer.` });
  }
  if (noRequester.length) {
    results.push({ level: "warning", title: "Request Details", message: `${noRequester.length} molecular order(s) are missing the requester or the request date/time.` });
  }

  // 2. Sample linkage — every test must point at the exact material used.
  const noSampleClass = orders.filter((o) => !o.sample_class);
  const noRequiredMaterial = orders.filter((o) => !o.required_material || o.required_material === "To be decided by Molecular");
  const tissueNoRef = orders.filter((o) => isTissue(o)
    && !(o.sample_class === "Slide" ? o.sample_slide_id : o.sample_block_id));
  const curlsNoPreparation = orders.filter((o) => o.sample_class === "Tissue curls / scrolls"
    && consumedStatuses.has(o.status) && !o.sectioning_event_id);
  const unresolvedRef = orders.filter((o) => {
    if (!isTissue(o)) return false;
    if (o.sample_class === "Slide") return !!o.sample_slide_id && !slideById.has(o.sample_slide_id);
    return !!o.sample_block_id && !blockById.has(o.sample_block_id);
  });
  const nonTissueNoDetail = orders.filter((o) => o.sample_class && !isTissue(o)
    && (!o.sample_description || !o.collection_datetime));
  if (noSampleClass.length) {
    results.push({ level: "error", title: "Sample Not Linked", message: `${noSampleClass.length} molecular order(s) do not state what material was tested.` });
  }
  if (noRequiredMaterial.length) {
    results.push({ level: "warning", title: "Required Material", message: `${noRequiredMaterial.length} molecular order(s) do not state whether the assay needs a whole block, unstained slides, tissue curls, extracted DNA/RNA, or a non-tissue sample.` });
  }
  if (tissueNoRef.length) {
    results.push({ level: "error", title: "Tissue Reference", message: `${tissueNoRef.length} tissue-based order(s) do not reference the block or slide that was used.` });
  }
  if (curlsNoPreparation.length) {
    results.push({ level: "error", title: "Prepared Material Not Linked", message: `${curlsNoPreparation.length} curl/scroll order(s) entered sample preparation or beyond without linking the Sectioning event that produced the material.` });
  }
  if (unresolvedRef.length) {
    results.push({ level: "error", title: "Unresolved Tissue Reference", message: `${unresolvedRef.length} molecular order(s) reference a block or slide that no longer exists in Processing or Sectioning. The result is kept — correct the reference or record why the material is gone.` });
  }
  if (nonTissueNoDetail.length) {
    results.push({ level: "warning", title: "Non-Tissue Sample Detail", message: `${nonTissueNoDetail.length} blood, plasma, bone-marrow or other sample(s) are missing the sample description or the collection date/time.` });
  }

  // 3. Tumour content and adequacy — the commonest cause of an uninterpretable
  // molecular result, and the reason a different block should be chosen.
  const tissueConsumed = consumed.filter((o) => isTissue(o));
  const noCellularity = tissueConsumed.filter((o) => isBlank(o.tumor_cellularity_percent));
  const badCellularity = orders.filter((o) => {
    const pct = num(o.tumor_cellularity_percent);
    return pct !== null && (pct < 0 || pct > 100);
  });
  const badNecrosis = orders.filter((o) => {
    const pct = num(o.necrosis_percent);
    return pct !== null && (pct < 0 || pct > 100);
  });
  const lowTumourNoDissection = orders.filter((o) => {
    const pct = num(o.tumor_cellularity_percent);
    return pct !== null && pct < 20 && (!o.dissection || o.dissection === "Not performed");
  });
  const exhaustedBlock = orders.filter((o) => {
    const block = blockById.get(o.sample_block_id);
    return !!block && block.block_status === "Exhausted";
  });
  const inadequateReported = reported.filter((o) => o.tissue_adequacy === "Inadequate" || o.tissue_adequacy === "Exhausted");
  if (noCellularity.length) {
    results.push({ level: "warning", title: "Tumour Cellularity", message: `${noCellularity.length} tissue-based order(s) that have entered preparation or beyond record no tumour cellularity, so the result cannot be read against the assay's limit of detection.` });
  }
  if (badCellularity.length) {
    results.push({ level: "error", title: "Cellularity Value", message: `${badCellularity.length} molecular order(s) record a tumour cellularity outside 0-100.` });
  }
  if (badNecrosis.length) {
    results.push({ level: "error", title: "Necrosis Value", message: `${badNecrosis.length} molecular order(s) record a necrosis percentage outside 0-100.` });
  }
  if (lowTumourNoDissection.length) {
    results.push({ level: "warning", title: "Low Tumour Content", message: `${lowTumourNoDissection.length} molecular order(s) record tumour cellularity below 20% with no macro- or microdissection. A negative result may be a false negative at this tumour fraction.` });
  }
  if (exhaustedBlock.length) {
    results.push({ level: "warning", title: "Block Exhausted", message: `${exhaustedBlock.length} molecular order(s) use a block last recorded as Exhausted in Sectioning. Confirm material was actually available.` });
  }
  if (inadequateReported.length) {
    results.push({ level: "error", title: "Reported on Inadequate Sample", message: `${inadequateReported.length} order(s) are Reported on a sample recorded as inadequate or exhausted for testing.` });
  }

  // 4. Extraction and sample QC. A failed sample must resolve into a repeat
  // extraction or a recollection, and must not carry a reported result.
  const extractedNoQc = consumed.filter((o) => o.extraction_datetime && o.sample_qc_result === "Not run");
  const qcFailNoReason = orders.filter((o) => o.sample_qc_result === "Fail" && !o.failure_reason);
  const qcFailNoAction = orders.filter((o) => o.sample_qc_result === "Fail"
    && o.repeat_extraction !== "Yes" && o.recollection_required !== "Yes");
  const qcFailReported = reported.filter((o) => o.sample_qc_result === "Fail");
  const noConcentration = consumed.filter((o) => o.extraction_datetime && (isBlank(o.concentration) || isBlank(o.quality_score)));
  const failedNoReason = orders.filter((o) => o.status === "Failed" && !o.failure_reason);
  if (extractedNoQc.length) {
    results.push({ level: "warning", title: "Sample QC Not Run", message: `${extractedNoQc.length} molecular order(s) record a nucleic-acid extraction with no sample QC result.` });
  }
  if (noConcentration.length) {
    results.push({ level: "warning", title: "Nucleic-Acid Quantity", message: `${noConcentration.length} extracted sample(s) record no concentration or quality score, so input adequacy cannot be judged.` });
  }
  if (qcFailNoReason.length) {
    results.push({ level: "warning", title: "QC Failure Reason", message: `${qcFailNoReason.length} molecular order(s) have a failed sample QC with no failure reason recorded.` });
  }
  if (qcFailNoAction.length) {
    results.push({ level: "warning", title: "Failed Sample Not Resolved", message: `${qcFailNoAction.length} molecular order(s) have a failed sample QC with no repeat extraction or recollection decision.` });
  }
  if (qcFailReported.length) {
    results.push({ level: "error", title: "Reported on Failed QC", message: `${qcFailReported.length} order(s) are marked Reported while the sample QC failed. A result must not be reported on a failed sample.` });
  }
  if (failedNoReason.length) {
    results.push({ level: "warning", title: "Failed Test Reason", message: `${failedNoReason.length} order(s) are marked Failed with no reason recorded.` });
  }

  // 5. Assay and version traceability. A molecular result cannot be reproduced
  // or compared without the panel, its version and the reference build.
  const reportedNoAssay = reported.filter((o) => !o.platform || !o.panel_name || !o.methodology);
  const reportedNoVersion = reported.filter((o) => !o.panel_version);
  const seqNoGenome = reported.filter((o) => (["NGS panel", "cfDNA / ctDNA", "Germline panel"].includes(o.test_type)
    || isGenomeScale(o)) && !o.reference_genome);
  const seqNoDepth = reported.filter((o) => (["NGS panel", "cfDNA / ctDNA"].includes(o.test_type)
    || isGenomeScale(o)) && (!o.coverage_depth || !o.limit_of_detection));
  const internalNoRun = orders.filter((o) => o.performing_lab === "Internal" && consumedStatuses.has(o.status) && !o.assay_run_id);
  const technicalQcFailReported = reported.filter((o) => o.technical_qc_status === "Fail");
  const technicalQcNotRun = reported.filter((o) => o.technical_qc_status === "Not run");
  const noGeneList = reported.filter((o) => !isGenomeScale(o) && !o.genes_tested);
  if (reportedNoAssay.length) {
    results.push({ level: "warning", title: "Assay Details", message: `${reportedNoAssay.length} reported order(s) are missing the platform, panel name, or methodology.` });
  }
  if (reportedNoVersion.length) {
    results.push({ level: "warning", title: "Panel Version", message: `${reportedNoVersion.length} reported order(s) record no panel or assay version. The result depends on the method used, so it cannot be compared across time without it.` });
  }
  if (seqNoGenome.length) {
    results.push({ level: "warning", title: "Reference Build", message: `${seqNoGenome.length} sequencing order(s) report no reference genome or transcript version, so the coordinates cannot be reproduced.` });
  }
  if (seqNoDepth.length) {
    results.push({ level: "warning", title: "Coverage and Detection Limit", message: `${seqNoDepth.length} sequencing order(s) report no coverage/depth or limit of detection, so a negative result cannot be qualified.` });
  }
  if (internalNoRun.length) {
    results.push({ level: "warning", title: "Assay Run ID", message: `${internalNoRun.length} internally performed order(s) that have entered preparation or beyond record no assay run ID.` });
  }
  if (technicalQcFailReported.length) {
    results.push({ level: "error", title: "Technical QC Failed", message: `${technicalQcFailReported.length} order(s) are Reported with a failed technical QC.` });
  }
  if (technicalQcNotRun.length && !technicalQcFailReported.length) {
    results.push({ level: "warning", title: "Technical QC Not Recorded", message: `${technicalQcNotRun.length} reported order(s) record no technical QC status.` });
  }
  if (noGeneList.length) {
    results.push({ level: "warning", title: "Genes Tested", message: `${noGeneList.length} reported order(s) do not state which genes or targets were covered, so a negative result cannot be scoped.` });
  }

  // 6. External reports must be traceable back to the issuing laboratory.
  const externalNoSource = orders.filter((o) => o.performing_lab === "External reference laboratory"
    && o.status === "Reported" && (!o.lab_name || !o.source_report_id));
  if (externalNoSource.length) {
    results.push({ level: "warning", title: "External Report Source", message: `${externalNoSource.length} externally reported order(s) do not name the performing laboratory or its report ID.` });
  }

  // 7. Result completeness and internal consistency.
  const hasAnyRecordedFinding = (o) => variantsOf(o).length > 0
    || o.no_significant_alteration === "Yes"
    || (o.msi_result && o.msi_result !== "Not tested")
    || !isBlank(o.tmb_value)
    || (o.hrd_status && o.hrd_status !== "Not tested")
    || !isBlank(o.hrd_score)
    || (o.methylation_status && !["Not tested", "Not applicable"].includes(o.methylation_status))
    || !isBlank(o.methylation_class)
    || (o.expression_risk_category && o.expression_risk_category !== "Not applicable")
    || !isBlank(o.expression_score);
  const emptyResult = reported.filter((o) => !hasAnyRecordedFinding(o));
  const contradictory = orders.filter((o) => o.no_significant_alteration === "Yes" && variantsOf(o).length > 0);
  const msiNoMethod = orders.filter((o) => o.msi_result && o.msi_result !== "Not tested" && !o.msi_method);
  const tmbNoBasis = orders.filter((o) => !isBlank(o.tmb_value) && (!o.tmb_unit || !o.tmb_method));
  const tmbNoInterpretation = orders.filter((o) => !isBlank(o.tmb_value) && !o.tmb_interpretation);
  const hrdNoStatus = reported.filter((o) => o.test_type === "HRD assay" && (!o.hrd_status || o.hrd_status === "Not tested"));
  const hrdNoMethod = reported.filter((o) => o.hrd_status && o.hrd_status !== "Not tested" && !o.hrd_method);
  const expressionNoResult = reported.filter((o) => o.test_type === "Gene expression signature / RNA-Seq"
    && isBlank(o.expression_score) && (!o.expression_risk_category || o.expression_risk_category === "Not applicable"));
  const expressionNoSignature = reported.filter((o) => (!isBlank(o.expression_score) || (o.expression_risk_category && o.expression_risk_category !== "Not applicable"))
    && !o.expression_signature_name);
  const methylationNoTarget = reported.filter((o) => ["DNA methylation profiling", "Promoter methylation assay"].includes(o.test_type)
    && !o.methylation_target);
  const methylationNoResult = reported.filter((o) => ["DNA methylation profiling", "Promoter methylation assay"].includes(o.test_type)
    && (!o.methylation_status || o.methylation_status === "Not tested") && !o.methylation_class);
  const ctdnaNoLod = orders.filter((o) => o.test_type === "cfDNA / ctDNA" && o.status === "Reported" && !o.ctdna_lod);
  const previousNoComparison = orders.filter((o) => o.previous_test_ref && !o.result_comparison);
  const reportedNoDate = reported.filter((o) => !o.result_datetime && !o.report_datetime);
  if (emptyResult.length) {
    results.push({ level: "warning", title: "Result Not Recorded", message: `${emptyResult.length} order(s) are marked Reported with no variant, MSI, TMB, HRD, expression, or methylation result, and are not marked as showing no clinically significant alteration.` });
  }
  if (contradictory.length) {
    results.push({ level: "error", title: "Contradictory Result", message: `${contradictory.length} order(s) are marked as showing no clinically significant alteration while also recording variants.` });
  }
  if (msiNoMethod.length) {
    results.push({ level: "warning", title: "MSI Method", message: `${msiNoMethod.length} order(s) record an MSI result without the method used. MSI by PCR and by NGS are not interchangeable.` });
  }
  if (tmbNoBasis.length) {
    results.push({ level: "warning", title: "TMB Basis", message: `${tmbNoBasis.length} order(s) record a TMB value without its unit or method.` });
  }
  if (tmbNoInterpretation.length) {
    results.push({ level: "warning", title: "TMB Interpretation", message: `${tmbNoInterpretation.length} order(s) record a TMB value with no assay-specific interpretation. TMB thresholds are assay-specific and are not derived by the software.` });
  }
  if (hrdNoStatus.length) {
    results.push({ level: "warning", title: "HRD Status", message: `${hrdNoStatus.length} reported HRD order(s) record no HRD status (HRD Positive, HRD Negative, or Inconclusive).` });
  }
  if (hrdNoMethod.length) {
    results.push({ level: "warning", title: "HRD Method", message: `${hrdNoMethod.length} order(s) record an HRD result without stating the assay platform or scoring method.` });
  }
  if (expressionNoResult.length) {
    results.push({ level: "warning", title: "Expression Result", message: `${expressionNoResult.length} reported gene expression signature order(s) record neither a recurrence/risk score nor a risk category.` });
  }
  if (expressionNoSignature.length) {
    results.push({ level: "warning", title: "Expression Signature Name", message: `${expressionNoSignature.length} order(s) record expression findings without naming the signature (e.g. Oncotype DX, MammaPrint, Prosigna, Decipher).` });
  }
  if (methylationNoTarget.length) {
    results.push({ level: "warning", title: "Methylation Target", message: `${methylationNoTarget.length} reported methylation order(s) record no target gene or panel (e.g. MGMT, MLH1, or Genome-wide array).` });
  }
  if (methylationNoResult.length) {
    results.push({ level: "warning", title: "Methylation Result", message: `${methylationNoResult.length} reported methylation order(s) record neither a promoter methylation status nor a classifier subgroup.` });
  }
  if (ctdnaNoLod.length) {
    results.push({ level: "warning", title: "ctDNA Detection Limit", message: `${ctdnaNoLod.length} reported liquid-biopsy order(s) record no assay limit of detection, so a negative result cannot be qualified.` });
  }
  if (previousNoComparison.length) {
    results.push({ level: "warning", title: "Previous Result Comparison", message: `${previousNoComparison.length} order(s) reference a previous molecular test without stating the comparison.` });
  }
  if (reportedNoDate.length) {
    results.push({ level: "warning", title: "Result Date", message: `${reportedNoDate.length} reported order(s) have neither a result nor a report date/time.` });
  }

  // 8. Variant-level completeness. A variant without notation, quantification or
  // a named classification system cannot be re-read later.
  const alleleFractionTypes = new Set(["SNV", "Indel"]);
  const noGene = allVariants.filter(({ variant }) => !variant.gene);
  const noChange = allVariants.filter(({ variant }) => !variant.dna_change && !variant.protein_change);
  const noVariantType = allVariants.filter(({ variant }) => !variant.variant_type);
  const noVaf = allVariants.filter(({ variant }) => alleleFractionTypes.has(variant.variant_type) && isBlank(variant.vaf_percent));
  const badVaf = allVariants.filter(({ variant }) => {
    const pct = num(variant.vaf_percent);
    return pct !== null && (pct < 0 || pct > 100);
  });
  const cnvNoCopies = allVariants.filter(({ variant }) => variant.variant_type === "CNV" && isBlank(variant.copy_number));
  const fusionNoPartner = allVariants.filter(({ variant }) => variant.variant_type === "Fusion / rearrangement"
    && !variant.fusion_partner && !variant.fusion_detail);
  const tierNoSystem = allVariants.filter(({ variant }) => variant.tier && !variant.classification_system);
  const noSignificance = allVariants.filter(({ variant }) => !variant.clinical_significance);
  const noEvidence = allVariants.filter(({ variant }) => variant.tier && (!variant.evidence_source || !variant.interpretation_db_version));
  const hgvsNoBuild = allVariants.filter(({ variant }) => variant.hgvs_genomic && !variant.genome_build);
  const noOrigin = allVariants.filter(({ variant }) => !variant.origin);
  if (noGene.length) {
    results.push({ level: "error", title: "Variant Gene", message: `${noGene.length} variant record(s) name no gene.` });
  }
  if (noChange.length) {
    results.push({ level: "error", title: "Variant Change", message: `${noChange.length} variant record(s) state neither a DNA nor a protein change.` });
  }
  if (noVariantType.length) {
    results.push({ level: "warning", title: "Variant Type", message: `${noVariantType.length} variant record(s) do not state the variant type.` });
  }
  if (badVaf.length) {
    results.push({ level: "error", title: "Allele Frequency Value", message: `${badVaf.length} variant record(s) record a variant allele frequency outside 0-100.` });
  }
  if (noVaf.length) {
    results.push({ level: "warning", title: "Allele Frequency", message: `${noVaf.length} SNV or indel record(s) report no variant allele frequency.` });
  }
  if (cnvNoCopies.length) {
    results.push({ level: "warning", title: "Copy Number", message: `${cnvNoCopies.length} copy-number variant(s) record no copy number.` });
  }
  if (fusionNoPartner.length) {
    results.push({ level: "warning", title: "Fusion Detail", message: `${fusionNoPartner.length} fusion or rearrangement record(s) name no partner or fusion detail.` });
  }
  if (tierNoSystem.length) {
    results.push({ level: "error", title: "Classification System", message: `${tierNoSystem.length} variant record(s) assign a tier without naming the classification system it belongs to.` });
  }
  if (noSignificance.length) {
    results.push({ level: "warning", title: "Clinical Significance", message: `${noSignificance.length} variant record(s) state no clinical significance.` });
  }
  if (noEvidence.length) {
    results.push({ level: "warning", title: "Interpretation Provenance", message: `${noEvidence.length} classified variant(s) record no evidence source or interpretation-database version. A classification is only valid against the database version it was made on.` });
  }
  if (hgvsNoBuild.length) {
    results.push({ level: "warning", title: "Genome Build", message: `${hgvsNoBuild.length} variant record(s) give genomic HGVS notation with no genome build, so the coordinates are ambiguous.` });
  }
  if (noOrigin.length) {
    results.push({ level: "warning", title: "Somatic or Germline Status", message: `${noOrigin.length} variant record(s) do not state whether the finding is somatic, possibly germline, or confirmed germline.` });
  }

  // Fusion detection is an assay-sensitivity question before it is a variant
  // question. A fusion breakpoint falls in an intron, so an assay fed DNA reports
  // the fusion as wild type unless its panel covers the introns the breakpoint
  // sits in, while RNA has the introns already spliced out and shows the junction
  // directly. The order records what it was fed, so a DNA-only order that carries
  // a fusion — or excludes one — is flagged for that confirmation. Whole-genome
  // sequencing is exempt: it reads introns, so DNA alone is genuinely adequate
  // there. A warning, not an error: a DNA assay with intron coverage legitimately
  // detects fusions, and nothing on the order claims that coverage, so an error
  // raised here could never be cleared.
  const dnaOnlyInput = (o) => o.nucleic_acid_input === "DNA"
    && o.test_type !== "Whole genome sequencing (WGS)";
  const fusionOnDnaOnly = allVariants.filter(({ order, variant }) =>
    dnaOnlyInput(order) && variant.variant_type === "Fusion / rearrangement");
  const fusionExcludedOnDnaOnly = orders.filter((o) => dnaOnlyInput(o) && o.no_significant_alteration === "Yes");
  if (fusionOnDnaOnly.length) {
    results.push({ level: "warning", title: "Fusion Assay Sensitivity", message: `${fusionOnDnaOnly.length} fusion record(s) sit on an order whose nucleic acid input is DNA. A DNA assay reports a fusion as wild type unless its panel covers the introns the breakpoint falls in — confirm the assay detects rearrangements before this finding is reported.` });
  }
  if (fusionExcludedOnDnaOnly.length) {
    results.push({ level: "warning", title: "Fusion Not Assessable", message: `${fusionExcludedOnDnaOnly.length} DNA-input order(s) report no clinically significant alteration. Because a DNA assay reports a fusion as wild type unless its panel covers introns, that is not yet a true fusion negative — RNA, or a DNA assay with intron coverage, is needed to exclude one.` });
  }

  // 9. Germline handling. Tumour-only testing can raise the possibility of a
  // germline finding but cannot confirm one — that needs a dedicated test.
  const confirmedOnTumourOnly = allVariants.filter(({ order, variant }) =>
    variant.origin === "Confirmed germline" && tumourOnlyTypes.has(order.test_type));
  const germlineNotFlagged = orders.filter((o) =>
    variantsOf(o).some((v) => germlineOrigins.has(v.origin)) && o.possible_germline_flagged !== "Yes");
  const flaggedNoReferral = orders.filter((o) => o.possible_germline_flagged === "Yes" && o.genetic_counselling_referral !== "Yes");
  const flaggedNoConfirmation = orders.filter((o) => o.possible_germline_flagged === "Yes" && (!o.germline_confirmation_status || o.germline_confirmation_status === "Not indicated"));
  const germlineTestNoConsent = orders.filter((o) => o.test_type === "Germline panel"
    && (o.consent_status === "Pending" || o.consent_status === "Not required" || !o.consent_status));
  if (confirmedOnTumourOnly.length) {
    results.push({ level: "error", title: "Germline Status Overstated", message: `${confirmedOnTumourOnly.length} variant(s) are recorded as confirmed germline on a tumour-only test. Tumour-only testing can only flag a possible germline finding; record the confirmatory germline test separately.` });
  }
  if (germlineNotFlagged.length) {
    results.push({ level: "warning", title: "Germline Finding Not Flagged", message: `${germlineNotFlagged.length} order(s) carry a possible or confirmed germline variant without the order being flagged for germline review.` });
  }
  if (flaggedNoReferral.length) {
    results.push({ level: "warning", title: "Genetic Counselling", message: `${flaggedNoReferral.length} order(s) flag a possible germline finding with no genetic-counselling referral recorded.` });
  }
  if (flaggedNoConfirmation.length) {
    results.push({ level: "warning", title: "Germline Confirmation", message: `${flaggedNoConfirmation.length} order(s) flag a possible germline finding with no confirmatory germline test status.` });
  }
  if (germlineTestNoConsent.length) {
    results.push({ level: "warning", title: "Germline Consent", message: `${germlineTestNoConsent.length} germline panel order(s) record no obtained consent. Local policy governs whether consent is required before germline testing.` });
  }

  // 10. Deterministic discordance against the MMR immunohistochemistry. One
  // authoritative MMR result is assembled from the Staining technical record and
  // the pathologist's interpretation in Microscopy, so only rows that carry both
  // a passing technical control and a recorded call are usable here. Only
  // clear-cut contradictions are raised; the AI endpoint handles wider correlation.
  const usableMmr = mmrRows.filter((row) => row.technical_control_result === "Pass"
    && row.control_accepted_for_interpretation !== "No"
    && row.interpretation);
  const mmrLoss = usableMmr.some((row) => row.interpretation === "Negative" || row.pattern === "Loss of expression");
  const mmrAllRetained = usableMmr.length > 0 && usableMmr.every((row) => row.interpretation === "Positive");
  const msiStable = orders.filter((o) => o.msi_result === "Microsatellite stable");
  const msiHigh = orders.filter((o) => o.msi_result === "MSI-High");
  if (mmrLoss && msiStable.length) {
    results.push({ level: "warning", title: "MMR / MSI Discordance", message: `Mismatch-repair protein loss is recorded in the confirmed immunohistochemistry while ${msiStable.length} molecular order(s) report microsatellite stability. Resolve the discordance before the integrated diagnosis.` });
  }
  if (mmrAllRetained && msiHigh.length) {
    results.push({ level: "warning", title: "MMR / MSI Discordance", message: `All mismatch-repair proteins are recorded as retained in the confirmed immunohistochemistry while ${msiHigh.length} molecular order(s) report MSI-High. Resolve the discordance before the integrated diagnosis.` });
  }
  if (!usableMmr.length && (msiStable.length || msiHigh.length)) {
    results.push({ level: "info", title: "MMR Immunohistochemistry", message: "An MSI result is recorded but no mismatch-repair immunohistochemistry with a passing control and a pathologist interpretation is available to correlate it against." });
  }

  // MLH1 IHC loss vs MLH1 promoter hypermethylation (sporadic vs suspected Lynch syndrome)
  const mlh1Loss = usableMmr.some((row) => (row.marker === "MLH1" || String(row.marker || "").toUpperCase().includes("MLH1"))
    && (row.interpretation === "Negative" || row.pattern === "Loss of expression"));
  const mlh1MethylationOrder = orders.find((o) => String(o.methylation_target || "").toUpperCase().includes("MLH1")
    || String(o.panel_name || "").toUpperCase().includes("MLH1"));
  if (mlh1Loss) {
    if (!mlh1MethylationOrder) {
      results.push({
        level: "info",
        title: "MLH1 Reflex Testing",
        message: "MLH1 protein loss is recorded on IHC. Consider reflex MLH1 promoter hypermethylation (or BRAF V600E) testing to differentiate sporadic epigenetic silencing from Lynch syndrome.",
      });
    } else if (mlh1MethylationOrder.status === "Reported" && mlh1MethylationOrder.methylation_status === "Unmethylated") {
      results.push({
        level: "warning",
        title: "Suspected Lynch Syndrome (Unmethylated MLH1)",
        message: "MLH1 protein loss with unmethylated MLH1 promoter indicates high suspicion for Lynch syndrome. Ensure genetic counselling referral and germline testing are flagged.",
      });
    }
  }

  // 11. Duplicate testing and tissue use — molecular work consumes tissue that
  // cannot be recovered.
  const byTypeAndBlock = new Map();
  orders.filter((o) => o.status !== "Failed").forEach((o) => {
    const type = typeOf(o);
    if (!type || !o.sample_block_id) return;
    const key = `${o.sample_block_id}|${type.toLowerCase()}`;
    byTypeAndBlock.set(key, (byTypeAndBlock.get(key) || 0) + 1);
  });
  const duplicated = [...byTypeAndBlock.values()].filter((count) => count >= 2).length;
  const perBlock = new Map();
  orders.forEach((o) => {
    if (!o.sample_block_id) return;
    perBlock.set(o.sample_block_id, (perBlock.get(o.sample_block_id) || 0) + 1);
  });
  const heavyBlocks = [...perBlock.values()].filter((count) => count >= 3).length;
  if (duplicated) {
    results.push({ level: "warning", title: "Duplicate Testing", message: `${duplicated} test type(s) are ordered more than once on the same block without the earlier order being marked Failed. Confirm the repeat is intended.` });
  }
  if (heavyBlocks) {
    results.push({ level: "info", title: "Tissue Use", message: `${heavyBlocks} block(s) carry 3 or more molecular orders. Check tissue remaining in Sectioning before ordering further testing.` });
  }

  // 12. Review and the return leg to the integrated diagnosis. The loop is only
  // closed when the verified result reaches the review that requested the test.
  const reportedNoReview = reported.filter((o) => !o.reviewed_by || !o.review_datetime);
  const notReturned = reported.filter((o) => o.returned_for_integrated_diagnosis !== "Yes");
  const returnedNoDate = orders.filter((o) => o.returned_for_integrated_diagnosis === "Yes" && !o.returned_datetime);
  const noOriginating = orders.filter((o) => !o.request_id && !o.originating_microscopy_id);
  if (reportedNoReview.length) {
    results.push({ level: "warning", title: "Molecular Review", message: `${reportedNoReview.length} reported order(s) have no pathologist or molecular-specialist review recorded.` });
  }
  if (notReturned.length) {
    results.push({ level: "warning", title: "Integrated Diagnosis Handoff", message: `${notReturned.length} reported result(s) have not been returned for the integrated diagnosis.` });
  }
  if (returnedNoDate.length) {
    results.push({ level: "warning", title: "Return Date", message: `${returnedNoDate.length} order(s) are marked returned for the integrated diagnosis with no return date/time.` });
  }
  if (noOriginating.length) {
    results.push({ level: "warning", title: "Originating Review", message: `${noOriginating.length} molecular order(s) do not reference the Microscopy ancillary request or review they were raised from, so the verified result cannot be returned to it.` });
  }

  // 13. Duplicate IDs would break every downstream reference.
  const orderIds = orders.map((o) => o.test_order_id);
  const duplicateOrderIds = [...new Set(orderIds.filter((id, index) => id && orderIds.indexOf(id) !== index))];
  const variantIds = allVariants.map(({ variant }) => variant.variant_id);
  const duplicateVariantIds = [...new Set(variantIds.filter((id, index) => id && variantIds.indexOf(id) !== index))];
  if (duplicateOrderIds.length) {
    results.push({ level: "error", title: "Test Order IDs", message: `Duplicate test order ID(s) detected: ${duplicateOrderIds.join(", ")}.` });
  }
  if (duplicateVariantIds.length) {
    results.push({ level: "error", title: "Variant IDs", message: `Duplicate variant ID(s) detected: ${duplicateVariantIds.join(", ")}.` });
  }

  if (!results.some((item) => item.level === "error" || item.level === "warning")) {
    const returned = reported.filter((o) => o.returned_for_integrated_diagnosis === "Yes").length;
    results.push({
      level: "ok",
      title: "Ready for Integrated Diagnosis",
      message: `${orders.length} molecular order(s) carrying ${allVariants.length} variant record(s); ${reported.length} reported, ${returned} returned for the integrated diagnosis.`,
    });
  }

  return results;
}

// Cytopathology reconciliation is intentionally small and deterministic. It
// checks linkage, adequacy, ROSE, reporting-system fields, and report handoff;
// it does not decide whether a cytologic diagnosis is clinically correct.
export function validateCytopathologyCompleteness(cytology = {}, specimens = []) {
  const records = Array.isArray(cytology?.records) ? cytology.records : [];
  if (!records.length) {
    return [{ level: "warning", title: "No Cytology Recorded", message: "No cytology specimen or report has been recorded for this case." }];
  }

  const results = [];
  const cytologySpecimenTypes = new Set([
    "Fine-needle aspiration",
    "Fluid / effusion",
    "Brushings / washings",
    "Bone marrow",
    "Other",
  ]);
  const specimenById = new Map(specimens.map((specimen) => [specimen.specimen_id, specimen]));
  const specimenIds = new Set(specimens.map((specimen) => specimen.specimen_id));
  const ids = new Set();
  const validCategories = {
    "Bethesda System": ["Nondiagnostic", "Benign", "Atypia of undetermined significance", "Follicular neoplasm", "Suspicious for malignancy", "Malignant"],
    "Paris System": ["Non-diagnostic", "Negative for high-grade urothelial carcinoma", "Atypical urothelial cells", "Suspicious for high-grade urothelial carcinoma", "High-grade urothelial carcinoma", "Other malignancy"],
    "Yokohama System": ["Insufficient", "Benign", "Atypical", "Suspicious for malignancy", "Malignant"],
    "Milan System": ["Non-diagnostic", "Non-neoplastic", "Atypia of undetermined significance", "Neoplasm: uncertain malignant potential", "Suspicious for malignancy", "Malignant"],
    "WHO Reporting System": ["Non-diagnostic", "Negative for malignancy", "Atypical", "Suspicious for malignancy", "Malignant"],
    "TPS / IASLC": ["Unsatisfactory", "Negative for malignancy", "Atypical", "Suspicious for malignancy", "Malignant"],
  };
  const number = (value) => value === "" || value === null || value === undefined ? null : Number(value);

  records.forEach((record, index) => {
    const label = `Cytology ${index + 1}`;
    if (!record.cytology_id || ids.has(record.cytology_id)) results.push({ level: "error", title: "Duplicate Cytology ID", message: `${label} has no unique cytology ID.` });
    ids.add(record.cytology_id);
    if (!record.specimen_id) results.push({ level: "error", title: "Specimen Link Missing", message: `${label} is not linked to an accessioned specimen.` });
    else if (!specimenIds.has(record.specimen_id)) results.push({ level: "error", title: "Unresolved Specimen Link", message: `${label} references a specimen that is no longer in Case Registry.` });
    else if (!cytologySpecimenTypes.has(specimenById.get(record.specimen_id)?.specimen_type)) results.push({ level: "error", title: "Non-Cytology Specimen", message: `${label} is linked to a histology or derived specimen. Start Cytopathology from the original fluid, aspiration, brushing/washing, or marrow specimen.` });
    if (!record.specimen_type) results.push({ level: "warning", title: "Specimen Type", message: `${label} has no cytology specimen type.` });
    if (record.specimen_type === "Other" && !record.specimen_type_other) results.push({ level: "warning", title: "Other Specimen Type", message: `${label} selected Other without describing the specimen type.` });
    if (!record.collection_method) results.push({ level: "warning", title: "Collection Method", message: `${label} has no collection method.` });
    if (record.collection_method === "Other" && !record.collection_method_other) results.push({ level: "warning", title: "Other Collection Method", message: `${label} selected Other without describing the collection method.` });
    if (!record.preparation_method) results.push({ level: "warning", title: "Preparation Method", message: `${label} has no preparation method.` });
    if (record.preparation_method === "Other" && !record.preparation_method_other) results.push({ level: "warning", title: "Other Preparation Method", message: `${label} selected Other without describing the preparation method.` });

    const volume = number(record.fluid_volume_ml);
    if (volume !== null && (!Number.isFinite(volume) || volume < 0)) results.push({ level: "error", title: "Fluid Volume", message: `${label} has an invalid fluid volume.` });
    const smears = number(record.smears_received);
    if (smears !== null && (!Number.isFinite(smears) || smears < 0)) results.push({ level: "error", title: "Smear Count", message: `${label} has an invalid received-slide count.` });

    if (!record.adequacy) results.push({ level: "error", title: "Adequacy Missing", message: `${label} does not record whether the sample is adequate.` });
    if (["Limited", "Inadequate", "Unsatisfactory"].includes(record.adequacy) && !record.adequacy_reason) results.push({ level: "warning", title: "Adequacy Reason", message: `${label} records limited or inadequate material without a reason.` });
    if (["Inadequate", "Unsatisfactory"].includes(record.adequacy) && !record.repeat_collection_recommended) results.push({ level: "warning", title: "Repeat Collection Decision", message: `${label} needs a repeat-collection decision.` });

    if (record.rose_performed === "Yes") {
      if (!record.rose_passes) results.push({ level: "warning", title: "ROSE Passes", message: `${label} records ROSE without the number of passes assessed.` });
      if (!record.rose_result) results.push({ level: "warning", title: "ROSE Result", message: `${label} records ROSE without a result.` });
      if (!record.rose_additional_pass_recommendation) results.push({ level: "warning", title: "ROSE Additional Passes", message: `${label} needs the additional-pass recommendation from ROSE.` });
    }
    if (record.cell_block_available === "Yes" && !record.cell_block_id) results.push({ level: "error", title: "Cell Block ID", message: `${label} marks a cell block available but has no cell-block ID. The ID is what routes the block into Processing, so without it the cell block cannot be sectioned, stained or read.` });
    if (record.background_findings?.includes("Other") && !record.background_other) results.push({ level: "warning", title: "Background Finding", message: `${label} selected Other background findings without a description.` });
    if (!record.reporting_system || record.reporting_system === "Not specified") results.push({ level: "warning", title: "Reporting System", message: `${label} has no site-appropriate reporting system.` });
    if (record.reporting_system && validCategories[record.reporting_system]?.length && record.diagnostic_category && !validCategories[record.reporting_system].includes(record.diagnostic_category) && !record.diagnostic_category_other) {
      results.push({ level: "warning", title: "Diagnostic Category", message: `${label} category does not match the selected reporting system.` });
    }
    const reportStarted = ["Preliminary", "Final", "Amended"].includes(record.report_status);
    if (reportStarted && (!record.diagnostic_category || !record.cytologic_diagnosis)) results.push({ level: "error", title: "Incomplete Cytology Report", message: `${label} is ${record.report_status} but has no category or cytologic diagnosis.` });
    if (reportStarted && (!record.reviewed_by || !record.report_datetime)) results.push({ level: "warning", title: "Report Sign-off", message: `${label} needs reviewer and report date/time before handoff.` });
    if (record.malignant_or_suspicious_cells === "Yes" && !record.cytologic_diagnosis) results.push({ level: "warning", title: "Suspicious Cells", message: `${label} identifies malignant or suspicious cells but has no diagnostic statement.` });
  });

  if (!results.some((result) => result.level === "error")) results.push({ level: "ok", title: "Cytology Reconciliation", message: `${records.length} cytology record(s) have no blocking linkage or report errors.` });
  return results;
}

// ─── Microscopy: review lineage, ancillary requests, marker interpretations ───
// Deterministic checks only. It verifies that lineage and links resolve, that a
// pathologist reading exists for the work that came back, that a reading was not
// recorded on invalid material, and that no request is left open at sign-off. It
// never judges morphology, and never decides what the diagnosis should be.
//
// `sources` is { specimens, blocks, slides, stains, molecular, sectioningEvents }
// from shared/microscopyModel.js, passed in so this file stays import-free.
export function validateMicroscopyCompleteness(microscopy = {}, sources = {}) {
  const reviews = Array.isArray(microscopy?.reviews) ? microscopy.reviews : [];
  const requests = Array.isArray(microscopy?.ancillary_requests) ? microscopy.ancillary_requests : [];
  const ancillaryResults = Array.isArray(microscopy?.ancillary_results) ? microscopy.ancillary_results : [];
  if (!reviews.length && !requests.length) {
    return [{ level: "warning", title: "No Microscopy Review", message: "No slide-level microscopy review has been recorded for this case." }];
  }

  const specimenIds = new Set((sources.specimens || []).map((item) => item.specimen_id));
  const blockIds = new Set((sources.blocks || []).map((item) => item.block_id));
  const slideIds = new Set((sources.slides || []).map((item) => item.slide_id));
  const stainById = new Map((sources.stains || []).map((item) => [item.stain_id, item]));
  const events = sources.sectioningEvents || [];
  const results = [];
  const reviewIds = new Set();
  const interpreted = (result) => !!String(result.interpretation || "").trim()
    || (result.interpretability === "Not interpretable"
      && !!String(result.interpretability_note || "").trim()
      && ["Yes", "No"].includes(result.repeat_or_additional_work_required));

  // 1. Review lineage and sign-off.
  reviews.forEach((review, index) => {
    const label = `Review ${index + 1}`;
    if (!review.microscopy_id || reviewIds.has(review.microscopy_id)) {
      results.push({ level: "error", title: "Duplicate Microscopy ID", message: `${label} has no unique microscopy ID.` });
    }
    reviewIds.add(review.microscopy_id);
    if (!review.specimen_id || !specimenIds.has(review.specimen_id)) {
      results.push({ level: "error", title: "Specimen Link Missing", message: `${label} must reference an accessioned specimen.` });
    }
    if (review.block_id && !blockIds.has(review.block_id)) {
      results.push({ level: "warning", title: "Block Link Unresolved", message: `${label} references a block that no longer exists in Processing.` });
    }
    if (review.slide_id && !slideIds.has(review.slide_id)) {
      results.push({ level: "warning", title: "Slide Link Unresolved", message: `${label} references a slide that no longer exists in Sectioning.` });
    }
    // A morphology cycle is read off a slide; a panel cycle is read off returned
    // ancillary work, so one of the two must be present.
    const cycleResults = ancillaryResults.filter((item) => item.microscopy_id === review.microscopy_id);
    if (!review.slide_id && !cycleResults.length) {
      results.push({ level: "warning", title: "Review Scope", message: `${label} has neither a slide nor any interpreted ancillary work, so it is not anchored to material.` });
    }
    if (!review.review_cycle) {
      results.push({ level: "warning", title: "Review Cycle", message: `${label} has no review-cycle label.` });
    }
    if (review.slide_id && !review.slide_quality) {
      results.push({ level: "warning", title: "Slide Quality", message: `${label} has no slide quality or adequacy assessment.` });
    }
    if (!review.reviewed_by || !review.review_datetime) {
      results.push({ level: "warning", title: "Review Sign-off", message: `${label} needs reviewer and review date/time.` });
    }
    if (["Final", "Addendum"].includes(review.report_status) && !review.primary_diagnosis) {
      results.push({ level: "error", title: "Diagnosis Missing", message: `${label} is ${review.report_status} but has no primary diagnosis.` });
    }
    // A panel that was read marker-by-marker still needs the pathologist's
    // reading of the panel as a whole.
    if (cycleResults.length > 1 && cycleResults.some(interpreted) && !review.panel_interpretation) {
      results.push({ level: "warning", title: "Panel Interpretation", message: `${label} interprets ${cycleResults.length} ancillary results but records no panel interpretation.` });
    }
    if (cycleResults.length && cycleResults.some(interpreted) && !cycleResults.every(interpreted)) {
      results.push({ level: "warning", title: "Panel Partly Read", message: `${label} has ${cycleResults.filter(interpreted).length} of ${cycleResults.length} ancillary result(s) interpreted.` });
    }
  });

  // 2. Ancillary requests: lineage, content, and whether the laboratory picked
  // them up.
  const requestIds = new Set();
  requests.forEach((request, index) => {
    const label = `Request ${index + 1}${request.request_type ? ` (${request.request_type})` : ""}`;
    if (!request.request_id || requestIds.has(request.request_id)) {
      results.push({ level: "error", title: "Duplicate Request ID", message: `${label} has no unique request ID.` });
    }
    requestIds.add(request.request_id);
    if (!request.source_specimen_id || !specimenIds.has(request.source_specimen_id)) {
      results.push({ level: "error", title: "Request Specimen", message: `${label} must reference an accessioned specimen.` });
    }
    if (request.preferred_block_id && !blockIds.has(request.preferred_block_id)) {
      results.push({ level: "warning", title: "Request Block", message: `${label} names a preferred block that no longer exists.` });
    }
    if (!request.diagnostic_question) {
      results.push({ level: "warning", title: "Diagnostic Question", message: `${label} records no diagnostic question, so the laboratory and the returning result carry no reason.` });
    }
    if (!request.originating_microscopy_id || !reviewIds.has(request.originating_microscopy_id)) {
      results.push({ level: "warning", title: "Originating Review", message: `${label} is not linked to the review that raised it.` });
    }
    const items = Array.isArray(request.requested_items) ? request.requested_items : [];
    const unnamed = items.filter((item) => !String(item.target || "").trim()).length;
    if (!items.length) {
      results.push({ level: "error", title: "Request Empty", message: `${label} names no requested marker, stain or test.` });
    }
    if (unnamed) {
      results.push({ level: "warning", title: "Request Target", message: `${label} has ${unnamed} requested item(s) with no named target.` });
    }
    if (request.cancelled === "Yes" && !request.cancel_reason) {
      results.push({ level: "warning", title: "Cancellation Reason", message: `${label} is cancelled with no reason recorded.` });
    }

    // Was the requested target actually applied?
    const performed = (sources.stains || []).filter((stain) => stain.request_id === request.request_id);
    const ordered = (sources.molecular || []).filter((order) => order.request_id === request.request_id);
    const cut = events.filter((event) => event.request_id === request.request_id);
    if (request.cancelled !== "Yes" && !performed.length && !ordered.length && !cut.length) {
      results.push({ level: "info", title: "Request Not Started", message: `${label} has no linked sectioning event, stain order or molecular order yet.` });
    }
    const mismatched = items.filter((item) => {
      const target = String(item.target || "").trim().toLowerCase();
      if (!target) return false;
      const stain = performed.find((entry) => entry.request_item_id === item.request_item_id);
      return stain && String(stain.target || "").trim().toLowerCase() !== target;
    });
    if (mismatched.length) {
      results.push({ level: "warning", title: "Requested vs Performed", message: `${label} has ${mismatched.length} item(s) where the stain performed does not match the target requested.` });
    }
  });

  // 3. Interpretations: they must interpret real staining work, on acceptable
  // material, and resolve into a call or a repeat. Molecular orders are not
  // interpreted here — see validateIntegrationCompleteness.
  const resultIds = new Set();
  const seenTargets = new Set();
  ancillaryResults.forEach((result, index) => {
    const stain = result.stain_id ? stainById.get(result.stain_id) : null;
    const label = `Interpretation ${index + 1}${stain?.target ? ` (${stain.target})` : ""}`;
    if (!result.result_id || resultIds.has(result.result_id)) {
      results.push({ level: "error", title: "Duplicate Interpretation ID", message: `${label} has no unique interpretation ID.` });
    }
    resultIds.add(result.result_id);
    const key = result.stain_id;
    if (key && seenTargets.has(key)) {
      results.push({ level: "error", title: "Duplicate Interpretation", message: `${label} is the second interpretation recorded for the same staining record. One stain carries one reading.` });
    }
    if (key) seenTargets.add(key);

    if (!stain) {
      results.push({ level: "error", title: "Interpretation Without Result", message: `${label} references no existing staining record.` });
      return;
    }
    if (!result.microscopy_id || !reviewIds.has(result.microscopy_id)) {
      results.push({ level: "warning", title: "Interpretation Not In A Review", message: `${label} is not recorded inside a review cycle.` });
    }
    if (stain.status !== "Completed") {
      results.push({ level: "warning", title: "Reading Incomplete Work", message: `${label} interprets a stain whose laboratory status is ${stain.status || "not recorded"}.` });
    }
    if (!stain.control_accepted && interpreted(result)) {
      results.push({ level: "error", title: "Interpreted Without Control", message: `${label} records a call while the technical control has not passed. Request a repeat instead.` });
    }
    if (stain.control_accepted && !result.control_accepted_for_interpretation) {
      results.push({ level: "warning", title: "Control Acceptance", message: `${label} does not record whether the control was accepted for clinical interpretation.` });
    }
    if (!result.interpretability) {
      results.push({ level: "warning", title: "Interpretability", message: `${label} does not state whether the material is interpretable.` });
    }
    if (result.interpretability === "Not interpretable") {
      if (!result.interpretability_note) {
        results.push({ level: "warning", title: "Interpretability Reason", message: `${label} is not interpretable with no reason recorded.` });
      }
      if (!["Yes", "No"].includes(result.repeat_or_additional_work_required)) {
        results.push({ level: "warning", title: "Uninterpretable Result", message: `${label} must state whether repeat or alternative work is required.` });
      }
      if (result.repeat_or_additional_work_required === "No" && !result.comments) {
        results.push({ level: "warning", title: "No Further Work Reason", message: `${label} says no further work is required but gives no reason.` });
      }
    } else if (!interpreted(result)) {
      results.push({ level: "warning", title: "Interpretation Missing", message: `${label} has no recorded interpretation.` });
    }
    if (interpreted(result)
      && result.interpretability !== "Not interpretable"
      && !result.diagnostic_contribution) {
      results.push({ level: "warning", title: "Diagnostic Contribution", message: `${label} records a call but not what it contributes to the diagnosis.` });
    }
    if (interpreted(result) && (!result.reviewed_by || !result.review_datetime)) {
      results.push({ level: "warning", title: "Interpretation Sign-off", message: `${label} needs the reviewer and review date/time.` });
    }
    // Scoring must be reproducible: a named system needs both the score and the
    // approved guideline version it was read on.
    if (result.scoring_system && result.scoring_system !== "Not applicable") {
      if (!result.score) {
        results.push({ level: "warning", title: "Marker Score", message: `${label} names a scoring system but records no score.` });
      }
      if (!result.scoring_system_version) {
        results.push({ level: "warning", title: "Scoring Version", message: `${label} names a scoring system with no guideline version, so the score cannot be reproduced.` });
      }
    }
    const pct = num(result.percent_positive);
    if (pct !== null && (pct < 0 || pct > 100)) {
      results.push({ level: "error", title: "Percent Positive", message: `${label} records a percent-positive value outside 0-100.` });
    }
    if (result.previous_result_ref && !result.comparison) {
      results.push({ level: "warning", title: "Previous Result Comparison", message: `${label} references a previous result without stating the comparison.` });
    }
    if (result.repeat_or_additional_work_required === "Yes" && !result.follow_up_request_id) {
      results.push({ level: "warning", title: "Follow-Up Request", message: `${label} asks for repeat or additional work with no linked follow-up request.` });
    }
  });

  // 4. Completed staining work that nobody has read yet. Reported molecular work
  // is not checked here — it is checked in validateIntegrationCompleteness.
  const readStains = new Set(ancillaryResults.map((item) => item.stain_id).filter(Boolean));
  const unreadStains = (sources.stains || []).filter((stain) => stain.status === "Completed"
    && stain.modality !== "H&E"
    && stain.returned_to_microscopy === "Yes"
    && !readStains.has(stain.stain_id));
  if (unreadStains.length) {
    results.push({
      level: "warning",
      title: "Awaiting Interpretation",
      message: `${unreadStains.length} completed stain(s) have no pathologist interpretation recorded.`,
    });
  }

  // 5. Open requests at sign-off. The integrated diagnosis itself is no longer
  // checked here: synthesising the case is not microscope work and moved to the
  // `integration` section.
  //
  // A requested item is satisfied either by a pathologist reading (a stained
  // slide) or by a reported molecular order returned for integration. Counting
  // only readings would leave every molecular request permanently unresolved,
  // because a sequencing result is never read at a microscope.
  const openRequests = requests.filter((request) => {
    if (request.cancelled === "Yes") return false;
    const items = Array.isArray(request.requested_items) ? request.requested_items : [];
    const read = ancillaryResults.filter((item) => item.request_id === request.request_id && interpreted(item)).length;
    const returnedOrders = (sources.molecular || []).filter((order) => order.request_id === request.request_id
      && order.status === "Reported"
      && order.returned_for_integrated_diagnosis === "Yes").length;
    return (read + returnedOrders) < Math.max(items.length, 1);
  });
  const finalReviews = reviews.filter((review) => ["Final", "Addendum"].includes(review.report_status));
  if (openRequests.length) {
    results.push({
      level: finalReviews.length ? "error" : "warning",
      title: "Unresolved Ancillary Requests",
      message: `${openRequests.length} ancillary request(s) are unresolved${finalReviews.length ? ", but a review is already marked Final or Addendum. Resolve them, or name them as pending in Integrated Diagnosis." : "."}`,
    });
  }

  if (!results.some((item) => item.level === "error")) {
    results.push({
      level: "ok",
      title: "Microscopy Reconciliation",
      message: `${reviews.length} review cycle(s), ${requests.length} ancillary request(s) and ${ancillaryResults.filter(interpreted).length} interpreted result(s) have no blocking lineage errors.`,
    });
  }
  return results;
}

// ─── Integrated Diagnosis: evidence accounted for, concordance, confirmation ──
// Deterministic checks only. It verifies that the pathologist's synthesis exists,
// that it is confirmed, and that no finished laboratory work was left unaccounted
// for. It never judges whether the diagnosis is correct.
//
// `upstream` is { evidence, outstanding, caseRegister } — the projections from
// shared/integrationModel.js, passed in so this file stays import-free.
export function validateIntegrationCompleteness(integration = {}, upstream = {}) {
  const results = [];
  const evidence = upstream.evidence || {};
  const outstanding = upstream.outstanding || {};
  const list = (value) => (Array.isArray(value) ? value : []);
  const text = (value) => String(value ?? "").trim();

  const reviews = list(evidence.reviews);
  const ancillary = list(evidence.ancillary);
  const molecular = list(evidence.molecular);
  const cytology = list(evidence.cytology);
  const hasEvidence = reviews.length || ancillary.length || molecular.length || cytology.length;

  if (!hasEvidence) {
    return [{
      level: "warning",
      title: "No Evidence To Integrate",
      message: "No confirmed microscopy review, ancillary reading, reported molecular order or cytologic diagnosis exists on this case yet.",
    }];
  }

  // 1. The synthesis itself.
  if (!text(integration.final_integrated_diagnosis)) {
    results.push({ level: "warning", title: "Integrated Diagnosis", message: "No final integrated diagnosis has been recorded." });
  } else if (!text(integration.confirmed_by) || !text(integration.confirmation_datetime)) {
    results.push({ level: "warning", title: "Integrated Confirmation", message: "The integrated diagnosis needs confirmation by and date/time." });
  }

  // 2. Each stream that produced evidence should be accounted for in words. A
  // silent stream is not an error — the pathologist may judge it non-contributory
  // — but it should be visible that it was not addressed.
  const unaddressed = [
    reviews.length && !text(integration.morphology_contribution) && "morphology",
    ancillary.length && !text(integration.ancillary_contribution) && "special stains / IHC / FISH",
    molecular.length && !text(integration.molecular_contribution) && "molecular",
    cytology.length && !text(integration.cytology_contribution) && "cytology",
  ].filter(Boolean);
  if (text(integration.final_integrated_diagnosis) && unaddressed.length) {
    results.push({
      level: "warning",
      title: "Stream Not Addressed",
      message: `An integrated diagnosis is recorded but these streams produced findings that it does not discuss: ${unaddressed.join(", ")}.`,
    });
  }

  // 3. Concordance and conflict.
  if (integration.overall_concordance === "Unresolved" && text(integration.final_integrated_diagnosis)) {
    results.push({ level: "warning", title: "Concordance Unresolved", message: "An integrated diagnosis is recorded while overall concordance is still Unresolved." });
  }
  if (integration.overall_concordance === "Discordant" && !text(integration.conflict_resolution)) {
    results.push({ level: "error", title: "Discordance Resolution", message: "Overall concordance is Discordant with no recorded resolution." });
  }
  const discordantAncillary = ancillary.filter((item) => item.discordance_status === "Discordant").length;
  if (discordantAncillary && !text(integration.conflict_resolution)) {
    results.push({ level: "warning", title: "Ancillary Discordance", message: `${discordantAncillary} ancillary reading(s) are marked discordant with no resolution recorded here.` });
  }

  // 4. Work that is finished, or still open, but not accounted for.
  const openWork = list(outstanding.open_staining).length + list(outstanding.open_molecular).length;
  if (openWork && !text(integration.pending_tests)) {
    results.push({
      level: "warning",
      title: "Pending Tests Not Named",
      message: `${openWork} staining or molecular record(s) are still open and no pending tests are named.`,
    });
  }
  if (list(outstanding.unread_stains).length) {
    results.push({
      level: "warning",
      title: "Stain Never Read",
      message: `${list(outstanding.unread_stains).length} completed stain(s) were returned to the pathologist but have no interpretation in Microscopy.`,
    });
  }
  if (list(outstanding.unreturned_molecular).length) {
    results.push({
      level: "warning",
      title: "Molecular Not Returned",
      message: `${list(outstanding.unreturned_molecular).length} reported molecular order(s) are not marked as returned for integrated diagnosis.`,
    });
  }
  if (list(outstanding.unsigned_cytology).length) {
    results.push({
      level: "warning",
      title: "Cytology Not Signed Off",
      message: `${list(outstanding.unsigned_cytology).length} cytology record(s) carry a diagnostic category but are not Final or Amended.`,
    });
  }

  // 5. Related-case links.
  const companions = list(integration.companion_cases);
  const unlabelled = companions.filter((link) => !text(link.relation)).length;
  if (unlabelled) {
    results.push({
      level: "warning",
      title: "Related Case Unlabelled",
      message: `${unlabelled} linked case(s) do not state how they relate to this case.`,
    });
  }

  if (!results.some((item) => item.level === "error")) {
    results.push({
      level: "ok",
      title: "Integration Reconciliation",
      message: `${reviews.length} confirmed review(s), ${ancillary.length} ancillary reading(s), ${molecular.length} reported molecular order(s) and ${cytology.length} cytologic diagnosis(es) have no blocking errors.`,
    });
  }
  return results;
}

// Synoptic validation uses the site schema for required fields.
export function validateSynopticCAP(schema, s = {}) {
  const results = [];

  // 1. Node count (CAP colorectal: ≥12)
  const totalNodes = num(s.total_nodes_examined);
  if (totalNodes !== null && totalNodes >= 12) {
    results.push({ level: "ok", title: "Node Count Adequate", message: `${totalNodes} lymph nodes examined meets CAP recommendation (≥12).` });
  } else {
    results.push({ level: "warning", title: "Insufficient Node Count", message: `Only ${totalNodes ?? 0} nodes examined. CAP recommends examining ≥12 lymph nodes for accurate staging.` });
  }

  // Consistency: positive nodes must not exceed examined nodes.
  const posNodes = num(s.positive_nodes);
  if (totalNodes !== null && posNodes !== null && posNodes > totalNodes) {
    results.push({ level: "error", title: "Node Count Inconsistent", message: `Positive nodes (${posNodes}) exceed total examined (${totalNodes}).` });
  }

  // 2. Margins (status → distance banding). "Involved" = R1 resection.
  const marginStatus = (label, status, distance) => {
    if (isBlank(status)) return { level: "info", title: `${label} Margin`, message: `${label}: margin status not provided.` };
    if (status === "Involved by invasive carcinoma") {
      return { level: "error", title: `${label} Margin`, message: `${label}: margin involved — indicates R1 resection.` };
    }
    return marginBand(label, distance);
  };
  results.push(marginStatus("Proximal", s.proximal_margin_status, s.proximal_margin_distance_cm));
  results.push(marginStatus("Distal", s.distal_margin_status, s.distal_margin_distance_cm));

  // 3. Grade interpretation
  const grade = s.grade;
  if (!isBlank(grade)) {
    if (/poorly/i.test(grade) || /\bG3\b/.test(grade) || /\bG4\b/.test(grade)) {
      results.push({ level: "warning", title: "Histologic Grade", message: "High-grade tumor — associated with worse prognosis." });
    } else {
      results.push({ level: "info", title: "Histologic Grade", message: "Grade is within low-to-moderate range." });
    }
  }

  // 4. CAP checklist completeness — derived from schema `required` flags.
  const missingRequired = [];
  const complete = [];
  if (schema && Array.isArray(schema.sections)) {
    schema.sections.forEach((sec) => {
      (sec.fields || []).forEach((fld) => {
        if (!fld.required) return;
        if (isBlank(s[fld.key])) missingRequired.push(fld.label);
        else complete.push(fld.label);
      });
    });
  }

  if (missingRequired.length === 0) {
    results.push({ level: "ok", title: "CAP Checklist Complete", message: `All ${complete.length} required elements completed.` });
  } else {
    results.push({
      level: "error",
      title: `CAP Checklist Incomplete (${missingRequired.length} missing)`,
      message: missingRequired.map((l) => `❌ ${l} — required, missing`).join("\n"),
    });
  }

  return results;
}

// Internal synoptic readiness checks. These are intentionally deterministic,
// minimal and non-blocking for draft saves; the UI only blocks the TNM-ready
// flag when essentials are missing, impossible or unresolved.
export function validateSynopticReadiness(schema, section = {}) {
  const answers = section.answers || section;
  const warnings = [];
  (schema?.sections || []).flatMap((item) => item.fields || []).filter((field) => field.required).forEach((field) => {
    if (answers[field.key] === "" || answers[field.key] === null || answers[field.key] === undefined) warnings.push(`${field.label} is required.`);
  });
  const sizeField = (schema?.sections || []).flatMap((item) => item.fields || []).find((field) => field.essentialGroup === "size");
  if (sizeField && !answers[sizeField.key] && !answers.tumor_size_unavailable_reason) warnings.push("Tumor size or a reason it is unavailable is required.");
  ["nodes_examined", "nodes_positive"].forEach((key) => {
    if (answers[key] !== "" && answers[key] !== undefined && (!Number.isFinite(Number(answers[key])) || Number(answers[key]) < 0)) warnings.push(`${key} must be a non-negative number.`);
  });
  if (Number.isFinite(Number(answers.nodes_examined)) && Number.isFinite(Number(answers.nodes_positive)) && Number(answers.nodes_positive) > Number(answers.nodes_examined)) warnings.push("Positive nodes cannot exceed examined nodes.");
  if (!section.template_selection?.confirmed_by || !section.template_selection?.confirmed_at) warnings.push("Template/site selection requires manual confirmation.");
  if (!(section.margins || []).length) warnings.push("At least one named surgical margin with status is required.");
  (section.margins || []).forEach((margin, index) => {
    if (!margin.name || !margin.status) warnings.push(`Margin ${index + 1} requires a name and status.`);
    if (margin.distance !== "" && (!Number.isFinite(Number(margin.distance)) || Number(margin.distance) < 0)) warnings.push(`Margin ${index + 1} distance must be non-negative.`);
  });
  return warnings;
}
