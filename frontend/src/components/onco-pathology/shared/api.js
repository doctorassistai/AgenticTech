// shared/api.js — Centralized API wrapper for the Onco-Pathology module
//
// Mirrors components/surgical-oncology/shared/api.js. All calls hit the FastAPI
// router in users/patient_data/onco_pathology.py, mounted at
//   …/hms/users/data/onco-pathology/*
//
// One document per pathology CASE (keyed by a generated case_id). Sections
// (case_register, grossing, synoptic, tnm.latest, …) are written through the
// single whitelisted saveSection endpoint.

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
const PATH_BASE = `${API_BASE_URL}hms/users/data/onco-pathology`;

// ─── Generic HTTP helpers ────────────────────────────────────────────────────

async function request(url, options = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const errorText = await res.text().catch(() => "Unknown error");
    throw new Error(`API ${options.method || "GET"} ${url} failed (${res.status}): ${errorText}`);
  }
  return res.json();
}

function get(path, params = {}) {
  const url = new URL(path.startsWith("http") ? path : `${PATH_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return request(url.toString());
}

function post(path, body) {
  const url = path.startsWith("http") ? path : `${PATH_BASE}${path}`;
  return request(url, { method: "POST", body: JSON.stringify(body) });
}

function put(path, body) {
  const url = path.startsWith("http") ? path : `${PATH_BASE}${path}`;
  return request(url, { method: "PUT", body: JSON.stringify(body) });
}

function del(path) {
  const url = path.startsWith("http") ? path : `${PATH_BASE}${path}`;
  return request(url, { method: "DELETE" });
}

// ─── Case CRUD ───────────────────────────────────────────────────────────────

/**
 * Create a new pathology case. Backend generates the case_id (UUID) and makes
 * this the active case for the patient.
 * @param {{ patient_id: string, doctor_id: string, hospital_id?: string, data: object }} payload
 *        `data` is the case_register section.
 * @returns {{ status: string, case_id: string }}
 */
export function createCase(payload) {
  return post("/case", payload);
}

/**
 * Get the full document for a single case (all sections).
 * @param {string} caseId
 * @returns {{ status: string, data: object }}
 */
export function getCase(caseId) {
  return get(`/case/${caseId}`);
}

/**
 * All cases for a patient (history), newest first.
 * @param {string} patientId
 * @returns {{ status: string, cases: object[] }}
 */
export function getPatientCases(patientId) {
  return get(`/patient/${patientId}/cases`);
}

/**
 * The active (or newest) case for a patient. Returns { data: {} } when none.
 * @param {string} patientId
 * @returns {{ status: string, data: object }}
 */
export function getLatestCase(patientId) {
  return get(`/patient/${patientId}/latest-case`);
}

/**
 * Worklist: all cases for a doctor, optionally filtered by patient.
 * @param {string} doctorId
 * @param {{ patient_id?: string }} params
 * @returns {{ status: string, cases: object[] }}
 */
export function getCasesByDoctor(doctorId, params = {}) {
  return get(`/cases/${doctorId}`, params);
}

/**
 * Set a specific case active for the given patient.
 * @param {string} patientId
 * @param {string} caseId
 */
export function setActiveCase(patientId, caseId) {
  return put(`/patient/${patientId}/active-case/${caseId}`, {});
}

/**
 * Mark a case as 'Signed-out' and deactivate it (finalize report).
 * @param {string} caseId
 * @param {{ force?: boolean, by?: string }} [options] — `force` bypasses the
 *        server-side completeness blockers so an unfinished case can be closed
 *        and a new case started (recorded as forced on the document); `by`
 *        names who performed the sign-out.
 */
export function signOutCase(caseId, options = {}) {
  const params = new URLSearchParams();
  if (options.force) params.set("force", "true");
  if (options.by) params.set("by", options.by);
  const qs = params.toString();
  return put(`/case/${caseId}/sign-out${qs ? `?${qs}` : ""}`, {});
}

export function createPathologyRequest(payload) {
  return post("/pathology-requests", payload);
}

export function getPathologyRequests(doctorId, params = {}) {
  return get("/pathology-requests", { doctor_id: doctorId, ...params });
}

export function getPathologyRequest(requestId) {
  return get(`/pathology-request/${requestId}`);
}

export function acceptPathologyRequest(requestId, doctorId, caseId) {
  return put(`/pathology-request/${requestId}/accept`, { doctor_id: doctorId, case_id: caseId });
}

export function declinePathologyRequest(requestId, doctorId, reason) {
  return put(`/pathology-request/${requestId}/decline`, { doctor_id: doctorId, reason });
}

// ─── Section Save ────────────────────────────────────────────────────────────

/**
 * Save a specific section of a case document.
 * @param {string} caseId
 * @param {string} sectionPath — e.g. "case_register", "grossing", "synoptic",
 *        "tnm.latest", "final_diagnosis", "cap_validation.grossing"
 * @param {object} data — the section data
 */
export function saveSection(caseId, sectionPath, data) {
  return put(`/case/${caseId}/section/${sectionPath}`, { data });
}

// ─── Patient Info / Prefill ──────────────────────────────────────────────────

/**
 * Patient info shaped for Case Registry prefill (name, mrn, dob, sex, …).
 * @param {string} patientId
 */
export function getPatientInfo(patientId) {
  return get(`/get-patient-info`, { patient_id: patientId });
}

/**
 * Build reviewable Tab 1 clinical-context suggestions from existing summaries,
 * investigations, and active/latest oncology records.
 */
export function autofillClinicalContext(patientId, doctorId) {
  return post(`/clinical-context/autofill`, {
    patient_id: patientId,
    doctor_id: doctorId,
  });
}

/**
 * Load compact, read-only prior clinical history for the Case Registry tables.
 */
export function getClinicalContextHistory(patientId, doctorId) {
  return post(`/clinical-context/history`, {
    patient_id: patientId,
    doctor_id: doctorId,
  });
}

/**
 * The deterministic clinical posture for a case: treatment-naive vs on- vs
 * post-treatment, whether any therapy preceded this specimen, the radiotherapy
 * field relationship, and the imaging on record.
 *
 * Derived entirely in Python (`pathology_posture.py`) — no model involved — and
 * handed to the advisory engines as established fact. The advisory endpoints
 * derive and persist it lazily on first use, so this is only needed to force a
 * recompute after the patient's treatment or imaging has changed.
 *
 * It reports which imaging studies exist and, separately, where the site
 * typically spreads. It deliberately makes no coverage claim and recommends no
 * investigation — the pathologist draws that comparison.
 */
export function refreshClinicalPosture(caseId) {
  return post(`/clinical-posture/refresh`, { case_id: caseId });
}

/** Read the stored clinical posture, deriving it on first read. */
export function getClinicalPosture(caseId) {
  return get(`/clinical-posture/${caseId}`);
}

// ─── WSI Viewer ──────────────────────────────────────────────────────────────

export function uploadWsiImage(file) {
  const formData = new FormData();
  formData.append("file", file);
  return fetch("http://143.110.187.180:8050/api/upload", {
    method: "POST",
    body: formData,
  }).then(async r => {
    if (!r.ok) {
      const errorText = await r.text().catch(() => "Unknown error");
      throw new Error(`WSI Upload failed (${r.status}): ${errorText}`);
    }
    return r.json();
  });
}

export function getWsiMetaByName(filename) {
  return fetch(`http://143.110.187.180:8010/api/meta-by-name/${filename}`).then(async r => {
    if (!r.ok) {
      const errorText = await r.text().catch(() => "Unknown error");
      throw new Error(`WSI Meta failed (${r.status}): ${errorText}`);
    }
    return r.json();
  });
}

// ─── Referral Documents ──────────────────────────────────────────────────────

/**
 * Upload a referral / requisition document. Proxied to the storage service.
 * @param {{ file: File, doctorId: string, patientId: string, hospitalId?: string, docType?: string, remarks?: string }} args
 * @returns {{ status: string, file_url: string, document: object }}
 */
export function uploadDocument({ file, doctorId, patientId, hospitalId, docType, remarks }) {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("doctor_id", doctorId || "");
  formData.append("patient_id", patientId || "");
  if (hospitalId) formData.append("hospital_id", hospitalId);
  if (docType) formData.append("doc_type", docType);
  if (remarks) formData.append("remarks", remarks);
  return fetch(`${PATH_BASE}/documents/upload`, {
    method: "POST",
    body: formData,
  }).then(async r => {
    if (!r.ok) {
      const errorText = await r.text().catch(() => "Unknown error");
      throw new Error(`Document upload failed (${r.status}): ${errorText}`);
    }
    return r.json();
  });
}

/** Upload a Grossing container image and verify its barcode against accessioning. */
export function verifyGrossingContainerImage({
  file, caseId, accessionId, specimenId, containerId, patientId, doctorId, hospitalId,
}) {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("case_id", caseId || "");
  formData.append("accession_id", accessionId || "");
  formData.append("specimen_id", specimenId || "");
  formData.append("container_id", containerId || "");
  formData.append("patient_id", patientId || "");
  formData.append("doctor_id", doctorId || "");
  if (hospitalId) formData.append("hospital_id", hospitalId);
  return fetch(`${PATH_BASE}/grossing/container-image/decode-upload`, {
    method: "POST",
    body: formData,
  }).then(async r => {
    if (!r.ok) {
      const errorText = await r.text().catch(() => "Unknown error");
      throw new Error(`Container verification failed (${r.status}): ${errorText}`);
    }
    return r.json();
  });
}

/** Upload a Processing cassette image and verify its barcode against Grossing. */
export function verifyProcessingCassetteImage({
  file, caseId, accessionId, specimenId, cassetteId, patientId, doctorId, hospitalId,
}) {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("case_id", caseId || "");
  formData.append("accession_id", accessionId || "");
  formData.append("specimen_id", specimenId || "");
  formData.append("cassette_id", cassetteId || "");
  formData.append("patient_id", patientId || "");
  formData.append("doctor_id", doctorId || "");
  if (hospitalId) formData.append("hospital_id", hospitalId);
  return fetch(`${PATH_BASE}/processing/cassette-image/decode-upload`, {
    method: "POST",
    body: formData,
  }).then(async r => {
    if (!r.ok) {
      const errorText = await r.text().catch(() => "Unknown error");
      throw new Error(`Cassette verification failed (${r.status}): ${errorText}`);
    }
    return r.json();
  });
}

/** Upload a Sectioning block image and verify its barcode against Processing. */
export function verifySectioningBlockImage({
  file, caseId, accessionId, eventId, specimenId, cassetteId, blockId, patientId, doctorId, hospitalId,
}) {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("case_id", caseId || "");
  formData.append("accession_id", accessionId || "");
  formData.append("event_id", eventId || "");
  formData.append("specimen_id", specimenId || "");
  formData.append("cassette_id", cassetteId || "");
  formData.append("block_id", blockId || "");
  formData.append("patient_id", patientId || "");
  formData.append("doctor_id", doctorId || "");
  if (hospitalId) formData.append("hospital_id", hospitalId);
  return fetch(`${PATH_BASE}/sectioning/block-image/decode-upload`, {
    method: "POST",
    body: formData,
  }).then(async r => {
    if (!r.ok) {
      const errorText = await r.text().catch(() => "Unknown error");
      throw new Error(`Block verification failed (${r.status}): ${errorText}`);
    }
    return r.json();
  });
}

/** Upload a Staining slide image and verify its barcode against Sectioning. */
export function verifyStainingSlideImage({
  file, caseId, accessionId, stainId, eventId, specimenId, blockId, slideId, patientId, doctorId, hospitalId,
}) {
  const formData = new FormData();
  formData.append("image", file);
  formData.append("case_id", caseId || "");
  formData.append("accession_id", accessionId || "");
  formData.append("stain_id", stainId || "");
  formData.append("event_id", eventId || "");
  formData.append("specimen_id", specimenId || "");
  formData.append("block_id", blockId || "");
  formData.append("slide_id", slideId || "");
  formData.append("patient_id", patientId || "");
  formData.append("doctor_id", doctorId || "");
  if (hospitalId) formData.append("hospital_id", hospitalId);
  return fetch(`${PATH_BASE}/staining/slide-image/decode-upload`, {
    method: "POST",
    body: formData,
  }).then(async r => {
    if (!r.ok) {
      const errorText = await r.text().catch(() => "Unknown error");
      throw new Error(`Slide verification failed (${r.status}): ${errorText}`);
    }
    return r.json();
  });
}

/**
 * Referral/document history for a patient, optionally scoped by doctor.
 * @param {string} patientId
 * @param {{ doctor_id?: string }} params
 * @returns {{ status: string, documents: object[] }}
 */
export function getDocuments(patientId, params = {}) {
  return get(`/documents/${patientId}`, params);
}

/**
 * Delete a document history record. The stored file is left in place.
 * @param {string} documentId
 */
export function deleteDocument(documentId) {
  return del(`/documents/${documentId}`);
}

/**
 * Extract + LLM-summarise the patient's uploaded referral PDFs.
 * Frontend reads results[0].llm_output.overall_summary for Clinical Indication.
 * @param {string} patientId
 * @returns {{ status: string, count: number, results: object[] }}
 */
export function processReferralLetters(patientId) {
  return get(`/process-referral-letters/${patientId}`);
}

/**
 * Extract structured Grossing fields from dictation for the selected workflow.
 * Suggestions are applied only to empty fields by the Grossing UI.
 */
export function structureGrossing(text, specimenClass) {
  return post(`/grossing/structure`, {
    text,
    specimen_class: specimenClass || "",
  });
}

/**
 * Extract structured Processing / Embedding fields from dictation.
 * The response carries an optional single run plus per-cassette entries keyed by
 * the cassette label the doctor stated. Suggestions are applied only to empty
 * fields of the first run and verified cassettes by the Processing UI.
 */
export function structureProcessing(text) {
  return post(`/processing/structure`, { text });
}

/**
 * Extract structured Sectioning / Microtomy fields from dictation for ONE event.
 * The event is already anchored to a single block by the UI (the technologist
 * picked the block before dictating), so the model never names a cassette, block
 * or slide and never does any routing. Suggestions are applied only to empty
 * fields of that event by the Sectioning UI.
 */
export function structureSectioning(text) {
  return post(`/sectioning/structure`, { text });
}

/**
 * Extract structured Staining / bench fields from dictation for ONE stain order.
 * The order is already anchored to a slide + sub-workflow by the UI, so the
 * model never routes or names an order. `modality` and `target` select the
 * sub-workflow detail field shape. Suggestions are merged into placeholder /
 * empty fields of that order only by the Staining UI.
 */
export function structureStaining(text, modality, target) {
  return post(`/staining/structure`, {
    text,
    modality: modality || "",
    target: target || "",
  });
}

/**
 * Generate source-labelled advisory Molecular & Genomic Testing suggestions
 * (which tests to consider for the tumour and clinical question, which block or
 * sample gives the best tumour content, adequacy and low-tumour-fraction warnings,
 * how a reported alteration should be interpreted and reported with its evidence
 * source, discordance against morphology / IHC / FISH / previous molecular results,
 * and when a finding needs genetics review). Test order IDs, variant IDs, counts,
 * timestamps and every laboratory identifier stay deterministic and client-side;
 * raw sequence QC, alignment, variant calling and primary genomic calculations are
 * NOT attempted here — those need a validated bioinformatics pipeline. The response
 * is not persisted until the clinician saves Molecular Testing.
 */
export function recommendMolecular(caseId, testOrderId, draftMolecular) {
  return post(`/molecular/recommendations`, {
    case_id: caseId,
    test_order_id: testOrderId || "",
    draft_molecular: draftMolecular || {},
  });
}

/** Generate source-labelled advisory suggestions for one Cytopathology record. */
export function recommendCytopathology(caseId, cytologyId, draftCytopathology) {
  // Keep older case-level callers functional while new callers provide the
  // focused record ID explicitly.
  if (cytologyId && typeof cytologyId === "object" && draftCytopathology === undefined) {
    draftCytopathology = cytologyId;
    cytologyId = "";
  }
  return post(`/cytopathology/recommendations`, {
    case_id: caseId,
    cytology_id: cytologyId || "",
    draft_cytopathology: draftCytopathology || {},
  });
}

/**
 * Run the advisory Microscopy assistant over the case.
 *
 * Returns one advisory run holding a short `case_summary` and `major_findings`
 * describing what the pathologist has recorded, a `diagnostic_assessment` saying
 * whether the recorded morphology and marker results support the stated
 * diagnosis (never whether the diagnosis is correct — no image is read), routed
 * `next_step_suggestions` naming the workflow each next action belongs to, and
 * the diagnostic / ancillary-test / discordance / reporting suggestion lists.
 *
 * `focusMicroscopyId` and `focusReviewCycle` identify the review the pathologist
 * currently has open. The backend validates the ID against the draft and owns
 * the fixed mode selection and cycle-specific data projection.
 *
 * Everything is advisory. Nothing is persisted until the clinician saves
 * Microscopy, and no suggestion ever writes into a clinical field.
 */
export function recommendMicroscopy(caseId, draftMicroscopy, focusMicroscopyId, focusReviewCycle) {
  return post(`/microscopy/recommendations`, {
    case_id: caseId,
    draft_microscopy: draftMicroscopy || {},
    focus_microscopy_id: focusMicroscopyId || "",
    focus_review_cycle: focusReviewCycle || "",
  });
}

/**
 * Structure Microscopy dictation into the canonical field shape.
 *
 * `scope` is "morphology" for a review cycle (tumour findings, grade, invasion,
 * margins, nodes, working diagnosis) or "marker" for one ancillary result
 * (pattern, localization, intensity, percent positive, score, interpretation).
 * `context` carries the review cycle, or the modality and target of the marker,
 * so the extraction knows which fields apply.
 *
 * Morphology runs server-side as several concurrent passes over small field
 * groups — a single 41-field pass loses most of a long dictation. The response
 * carries `extracted_fields` (keys that came back non-empty) and `failed_groups`
 * (passes that errored, whose fields are blank rather than lost), so the UI can
 * report what actually landed.
 *
 * Extraction is a suggestion: the UI merges the response into fields the
 * pathologist has left empty, never over a recorded value, and never into
 * identity, lineage, links or provenance.
 */
export function structureMicroscopy(text, scope, context = {}) {
  return post(`/microscopy/structure`, {
    text,
    scope: scope || "morphology",
    context,
  });
}

/**
 * Structure Cytopathology dictation into the canonical record field shape.
 *
 * The dictation is a pathologist's read of ONE cytology record, already anchored
 * to a specimen by the UI, so the model never names a specimen or routes work.
 * The record holds ~35 editable fields, so — like Microscopy morphology — the
 * server runs several concurrent passes over small field groups and segments
 * long dictations. The response carries `data` plus `extracted_fields` (keys
 * that came back non-empty) and `failed_groups` (passes that errored, whose
 * fields are blank rather than lost), so the UI can report what actually landed.
 *
 * Extraction is a suggestion: the UI merges the response into fields the
 * pathologist has left empty, never over a recorded value, and never into
 * identity, lineage, links or provenance.
 */
export function structureCytopathology(text) {
  return post(`/cytopathology/structure`, { text });
}

/**
 * Structure Integrated Diagnosis dictation into the synthesis field shape.
 *
 * The section is flat free text (per-stream contributions, conflict
 * resolution, final integrated diagnosis, uncertainty, pending tests, overall
 * concordance), so this is one simple LLM pass — no grouped extraction.
 *
 * Extraction is a suggestion: the UI merges the response into fields the
 * pathologist has left empty, never over a recorded value, and never into
 * confirmation identity / timestamp or companion-case links.
 */
export function structureIntegration(text) {
  return post(`/integration/structure`, { text });
}

/**
 * Structure one Molecular test order's dictation into the order field shape
 * (order / clinical question, specimen and adequacy, assay and QC, MSI / TMB,
 * findings and interpretation, germline / consent / handoff, and variants).
 *
 * Like Microscopy morphology and Cytopathology, the server runs several small
 * concurrent passes per segment (`_chunk_dictation`) for long dictations, with a
 * bounded recovery pass, and returns `data` + `extracted_fields` +
 * `failed_groups` so the UI can report what actually landed. Dictated variants
 * arrive under `data.variants`; the UI mints rows only when the order has none
 * recorded yet. `context` carries the order's recorded test type / platform so
 * the extraction names the order being dictated.
 *
 * Extraction is a suggestion: the UI fills fields the pathologist left empty,
 * never over a recorded value, and never into identity, lineage, links,
 * timestamps, staff or workflow state.
 */
export function structureMolecular(text, context = {}) {
  return post(`/molecular/structure`, { text, context });
}

// ─── TNM Staging / Final Diagnosis / AI Review ───────────────────────────────
/** Advisory TNM review. Suggestions never mutate the saved draft. */
export function reviewTNM(caseId, draftTnm, confirmedFindings, clinicalOnly) {
  return post(`/tnm/review`, { case_id: caseId, draft_tnm: draftTnm || {}, confirmed_findings: confirmedFindings || {}, clinical_only: !!clinicalOnly });
}

/**
 * Compute the configured deterministic stage group.
 * @param {{ site: string, pT: string, pN: string, cM?: string, pM1?: string }} tnm
 */
export function calculateStage(tnm) {
  return post(`/tnm/calculate-stage`, tnm);
}

/**
 * Assemble a complete Final Diagnosis report from confirmed case data. Returns
 * the full set of editable form fields — narrative, correlation comment,
 * pending tests + handling decision, and best-effort ICD-O-3 / SNOMED CT codes
 * (blank when unmapped). The UI applies these to empty fields only.
 * @param {{ case_register?: object, synoptic: object, grossing: object, microscopy?: object, integration?: object, staining?: object, molecular?: object, cytopathology?: object, tnm: object }} sections
 * @returns {{ status: string, data: { final_diagnosis: string, clinical_correlation_comment: string, diagnostic_comment: string, pending_tests: string, additional_comment: string, report_status: string, pending_test_decision: string, codes: { icdo_topography: string, icdo_morphology: string, snomed_ct: string } } }}
 */
export function generateFinalDiagnosis(sections) {
  return post(`/final-diagnosis/generate`, sections);
}

/**
 * AI correlation and advisory report review across confirmed pathology sources.
 * @param {{ case_register?: object, synoptic: object, grossing: object, microscopy?: object, staining?: object, molecular?: object, tnm: object, final_diagnosis?: string, pending_tests?: string }} sections
 * @returns {{ status: string, correlation, cap_validation, tnm_analysis, final_review }}
 */
export function aiReview(sections) {
  return post(`/ai-review`, sections);
}

// ─── Named export bundle ─────────────────────────────────────────────────────
const api = {
  createCase,
  getCase,
  getPatientCases,
  getLatestCase,
  getCasesByDoctor,
  setActiveCase,
  signOutCase,
  createPathologyRequest,
  getPathologyRequests,
  getPathologyRequest,
  acceptPathologyRequest,
  declinePathologyRequest,
  saveSection,
  getPatientInfo,
  autofillClinicalContext,
  getClinicalContextHistory,
  refreshClinicalPosture,
  getClinicalPosture,
  uploadDocument,
  verifyGrossingContainerImage,
  verifyProcessingCassetteImage,
  verifySectioningBlockImage,
  verifyStainingSlideImage,
  getDocuments,
  deleteDocument,
  processReferralLetters,
  structureGrossing,
  structureProcessing,
  structureSectioning,
  structureStaining,
  recommendMolecular,
  recommendCytopathology,
  recommendMicroscopy,
  structureMicroscopy,
  structureCytopathology,
  structureMolecular,
  structureIntegration,
  uploadWsiImage,
  getWsiMetaByName,
  reviewTNM,
  calculateStage,
  generateFinalDiagnosis,
  aiReview,
};

export default api;
