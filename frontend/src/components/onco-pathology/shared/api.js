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
 */
export function signOutCase(caseId) {
  return put(`/case/${caseId}/sign-out`, {});
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

// ─── Accession ID / Patient Info / Prefill ───────────────────────────────────

/**
 * Deterministic display accession ID for a patient (TMH-YYYY-XXXXXX).
 * @param {string} patientId
 * @returns {{ status: string, accession_id: string }}
 */
export function getAccessionId(patientId) {
  return get(`/accession-id/${patientId}`);
}

/**
 * Patient info shaped for Case Registry prefill (name, mrn, dob, sex, …).
 * @param {string} patientId
 */
export function getPatientInfo(patientId) {
  return get(`/get-patient-info`, { patient_id: patientId });
}

/**
 * Oncology visit summary text for the "Generate" button on Clinical Indication.
 * @param {string} patientId
 * @param {string} [appointmentId]
 * @returns {{ status: string, overall_summary: string }}
 */
export function getVisitSummary(patientId, appointmentId) {
  return get(`/visit-summary/${patientId}`, { appointment_id: appointmentId });
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

// ─── TNM Staging / Final Diagnosis / AI Review ───────────────────────────────

/**
 * Auto-suggest T/N/M from a synoptic report (depth of invasion + node counts).
 * @param {object} synoptic — the synoptic section
 * @returns {{ status: string, data: { t_stage, t_description, n_stage, n_description, m_stage, m_description, node_adequate } }}
 */
export function deriveTNM(synoptic) {
  return post(`/tnm/derive`, { synoptic });
}

/**
 * Compute the AJCC 8th-edition pathologic stage group from T/N/M.
 * @param {{ t_stage: string, n_stage: string, m_stage: string }} tnm
 * @returns {{ status: string, data: { final_stage, tnm_code, confidence, message } }}
 */
export function calculateStage(tnm) {
  return post(`/tnm/calculate-stage`, tnm);
}

/**
 * Assemble a templated final pathologic diagnosis narrative.
 * @param {{ synoptic: object, grossing: object, tnm: object }} sections
 * @returns {{ status: string, data: { final_diagnosis: string } }}
 */
export function generateFinalDiagnosis(sections) {
  return post(`/final-diagnosis/generate`, sections);
}

/**
 * AI correlation + CAP validation across synoptic, grossing, and TNM.
 * @param {{ synoptic: object, grossing: object, tnm: object }} sections
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
  saveSection,
  getAccessionId,
  getPatientInfo,
  getVisitSummary,
  uploadDocument,
  getDocuments,
  deleteDocument,
  processReferralLetters,
  deriveTNM,
  calculateStage,
  generateFinalDiagnosis,
  aiReview,
};

export default api;
