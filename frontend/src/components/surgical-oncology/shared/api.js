// shared/api.js — Centralized API wrapper for Surgical Oncology module

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
const SO_BASE = `${API_BASE_URL}hms/users/data/surgical-oncology`;
const CONTEXT_BASE = `${API_BASE_URL}hms/users/data/context`;
const DOCTORS_BASE = `${API_BASE_URL}hms/users/doctors`;

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
  const url = new URL(path.startsWith("http") ? path : `${SO_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return request(url.toString());
}

function post(path, body) {
  const url = path.startsWith("http") ? path : `${SO_BASE}${path}`;
  return request(url, { method: "POST", body: JSON.stringify(body) });
}

function put(path, body) {
  const url = path.startsWith("http") ? path : `${SO_BASE}${path}`;
  return request(url, { method: "PUT", body: JSON.stringify(body) });
}

function del(path) {
  const url = path.startsWith("http") ? path : `${SO_BASE}${path}`;
  return request(url, { method: "DELETE" });
}

// ─── Booking CRUD ────────────────────────────────────────────────────────────

/**
 * Create a new booking. Backend generates the booking_id (UUID).
 * @param {{ patient_id: string, doctor_id: string, hospital_id?: string, data: object }} payload
 * @returns {{ status: string, booking_id: string }}
 */
export function createBooking(payload) {
  return post("/booking", payload);
}

/**
 * Update the booking section of an existing booking document.
 * @param {string} bookingId
 * @param {object} data — The updated booking form fields
 */
export function updateBooking(bookingId, data) {
  return put(`/booking/${bookingId}`, { data });
}

/**
 * Get the full document for a single booking (all sections).
 * @param {string} bookingId
 * @returns {{ status: string, data: object }}
 */
export function getBooking(bookingId) {
  return get(`/booking/${bookingId}`);
}

/**
 * Get all bookings for a doctor, optionally filtered by patient_id and status.
 * Powers the OT Worklist.
 * @param {string} doctorId
 * @param {{ patient_id?: string, status?: string }} params
 * @returns {{ status: string, bookings: object[] }}
 */
export function getBookings(doctorId, params = {}) {
  return get(`/bookings/${doctorId}`, params);
}

/**
 * Get all bookings for a patient, regardless of doctor.
 * @param {string} patientId
 * @returns {{ status: string, bookings: object[] }}
 */
export function getPatientBookings(patientId) {
  return get(`/patient/${patientId}/bookings`);
}

// ─── Section Save ────────────────────────────────────────────────────────────

/**
 * Get the history of anaesthesia records for a patient.
 * @param {string} patientId
 * @returns {{ status: string, data: object[] }}
 */
export function getAnaesthesiaHistory(patientId) {
  return get(`/patient/${patientId}/anaesthesia-history`);
}

/**
 * Get the history of post op records for a patient.
 * @param {string} patientId
 * @returns {{ status: string, data: object[] }}
 */
export function getPostOpHistory(patientId) {
  return get(`/patient/${patientId}/post-op-history`);
}

/**
 * Get the OT booking prefill data from the latest dictation for a specific patient and doctor.
 * @param {string} patientId
 * @param {string} doctorId
 * @returns {{ status: string, data: object }}
 */
export function getOTBookingPrefill(patientId, doctorId) {
  return get(`/patient/${patientId}/doctor/${doctorId}/ot-booking-prefill`);
}

/**
 * Save a specific section of a booking document.
 * @param {string} bookingId
 * @param {string} sectionPath — e.g., "checklist", "management", "doctors_note", "post_op"
 * @param {object} data — The section data
 */
export function saveSection(bookingId, sectionPath, data) {
  return put(`/booking/${bookingId}/section/${sectionPath}`, { data });
}

// ─── Status Management ──────────────────────────────────────────────────────

/**
 * Update booking status (Pending → In Progress → Completed).
 */
export function updateBookingStatus(bookingId, status) {
  return put(`/booking/${bookingId}/status`, { status });
}

/**
 * Set a specific booking as active for the given patient.
 */
export function setActiveBooking(patientId, bookingId) {
  return put(`/patient/${patientId}/active-booking/${bookingId}`, {});
}

/**
 * Mark a booking's surgery as finished. Updates OT room status too.
 */
export function completeBooking(bookingId) {
  return put(`/booking/${bookingId}/complete`, {});
}

/**
 * Automatically generate Pre-Induction clinical investigation suggestions
 */
export function generateInvestigationSuggestion(bookingId, patientId) {
  return post(`/booking/${bookingId}/generate-investigation-suggestion`, { patient_id: patientId });
}

export function generateDoctorsNarration(bookingId, patientId, transcript) {
  return post(`/booking/${bookingId}/generate-narration`, { patient_id: patientId, transcript });
}

/**
 * Structure dictated/transcribed text for ONE Procedure (Part B) sub-tab into
 * JSON keyed to that sub-tab's fields. The backend routes to a section-specific
 * LLM prompt based on `section`.
 * @param {string} text - transcript to structure
 * @param {"mm"|"ga"|"reg"|"mac"|"io"|"eo"} section - target sub-tab
 * @returns {{ status: string, data: object }}
 */
export function structureAnaesthesiaProcedure(text, section) {
  return post(`/anaesthesia/procedure/structure`, { text, section });
}

// ─── Discharge Summary ─────────────────────────────────────────────────────────

/**
 * Fetch the aggregated discharge summary for a single booking.
 * Assembles demographics, diagnosis, procedure, findings, investigations,
 * complications and adjuvant context from the already-captured sections, plus
 * the saved `discharge` block (doctor-entered fields).
 * @param {string} patientId
 * @param {string} bookingId
 * @returns {{ status: string, data: object }}
 */
export function getDischargeSummary(patientId, bookingId) {
  return get(`/patient/${patientId}/booking/${bookingId}/discharge-summary`);
}

/**
 * Generate an editable narrative for a discharge-summary free-text section.
 * @param {string} bookingId
 * @param {string} patientId
 * @param {"course_in_hospital"|"discharge_advice"} section
 * @returns {{ status: string, data: { text: string } }}
 */
export function generateDischargeNarrative(bookingId, patientId, section) {
  return post(`/booking/${bookingId}/generate-discharge-narrative`, { patient_id: patientId, section });
}

/**
 * Generate a clinical LLM staging commentary comparing cTNM, sTNM, and pTNM
 * for the Discharge Summary. Returns { status, data: { text } }.
 */
export function generateStagingCommentary(bookingId) {
  return post(`/booking/${bookingId}/generate-staging-commentary`, {});
}

// ─── OT Schedule ─────────────────────────────────────────────────────────────

/**
 * Get OT room schedule for a specific room and date.
 */
export function getOTSchedule(roomName, date) {
  return get(`/ot-schedule/${roomName}/${date}`);
}

// ─── Anaesthesia Checklist (external, from anaesthesia doctor) ───────────────

/**
 * Get the anaesthesia checklist for a specific booking.
 * Requires both patient_id and booking_id for an exact lookup.
 */
export function getAnaesthesiaChecklist(patientId, bookingId) {
  return get(`${CONTEXT_BASE}/anaesthesia-checklist/${patientId}/${bookingId}`);
}

/**
 * Save the anaesthesia checklist, linked to a specific booking.
 */
export function saveAnaesthesiaChecklist(patientId, doctorId, bookingId, data) {
  return request(`${CONTEXT_BASE}/anaesthesia-checklist/save`, {
    method: "POST",
    body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, booking_id: bookingId, checklist: data })
  });
}

// ─── Context APIs (external — patient info, doctor info, hospital) ───────────

export function getPatientLastAppointment(patientId, doctorId) {
  return request(`${CONTEXT_BASE}/get-patient-last-appointment?patient_id=${patientId}&doctor_id=${doctorId}`);
}

export function getPatientInfo(patientId) {
  return get(`/get-patient-info`, { patient_id: patientId });
}

export function getDoctorInfo(doctorId) {
  return request(`${DOCTORS_BASE}/get_doctor/${doctorId}`);
}

export function getDoctorsByHospital(hospitalId) {
  return request(`${CONTEXT_BASE}/get_doctors_by_hospital/${hospitalId}`);
}

// ─── Separate Collections (not per-booking) ─────────────────────────────────

export function saveDoctorLogs(doctorId, data) {
  return post("/doctor-logs", { doctor_id: doctorId, data });
}

export function savePatientDiagrams(patientId, data) {
  return post("/patient-diagrams", { patient_id: patientId, data });
}

export function getDoctorLogs(doctorId) {
  return get(`/doctor-logs/${doctorId}`);
}

export function getPatientDiagrams(patientId) {
  return get(`/patient-diagrams/${patientId}`);
}

// ─── Diagrammatic Template — Document Uploads ────────────────────────────────

/**
 * Upload a document/image for the Diagrammatic Template tab.
 * Proxies the binary to the storage service and records a history entry
 * keyed by patient_id + doctor_id + hospital_id.
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
  return fetch(`${SO_BASE}/documents/upload`, {
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
 * Get uploaded-document history for a patient, optionally scoped by doctor/hospital.
 * @param {string} patientId
 * @param {{ doctor_id?: string, hospital_id?: string }} params
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

export function getLatestBookingForPatient(patientId) {
  return get(`/patient/${patientId}/latest-booking`);
}

// ─── Lab Order Flow & Vitals ───────────────────────────────────────────────────

export function getOncologyRecords(patientId) {
  return get(`/oncology-records/${patientId}`);
}

export function getPatientVitals(patientId) {
  return get(`/patient-vitals/${patientId}`);
}

export function getDoctorsNoteSummary(patientId) {
  return get(`/patient/${patientId}/doctors-note-summary`);
}

/**
 * NOT USED | TO BE REMOVED
 */
export function saveLabOrder(bookingId, data) {
  return put(`/booking/${bookingId}/lab-order`, { data });
}

/**
 * NOT USED | TO BE REMOVED
 */
export function saveLabResults(bookingId, data) {
  return put(`/booking/${bookingId}/lab-results`, { data });
}

/**
 * NOT USED | TO BE REMOVED
 */
export function parseLabReportPdf(pdfFile, fieldDefs) {
  const formData = new FormData();
  formData.append("file", pdfFile);
  formData.append("field_defs", JSON.stringify(fieldDefs));
  return fetch(`${SO_BASE}/lab-report/parse`, {
    method: "POST",
    body: formData,
  }).then(r => {
    if (!r.ok) throw new Error(`PDF parse failed (${r.status})`);
    return r.json();
  });
}

/**
 * Predict ASA Status from chemotherapy data using backend LLM.
 * @param {object} chemoData - The raw chemotherapy data.
 * @returns {{ status: string, data: { asaClass: string, reasoning: string } }}
 */
export function predictAsaStatus(chemoData) {
  return post("/asa-status/predict", { chemo_data: chemoData });
}

// ─── Oncology Investigations ───────────────────────────────────────────────────

export function getInvestigations(patientId, doctorId) {
  return request(`${CONTEXT_BASE}/oncology-investigations/${patientId}?doctor_id=${doctorId || ""}`);
}

/**
 * Get the completed investigation documents (uploaded reports) for a patient/doctor.
 * Powers the Completed Investigations table with extracted parameter-wise values.
 * @param {string} patientId
 * @param {string} doctorId
 * @returns {{ status: string, total_documents: number, data: object[] }}
 */
export function getCompletedInvestigationDocuments(patientId, doctorId) {
  return request(`${CONTEXT_BASE}/oncology-investigations/completed-documents`, {
    method: "POST",
    body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
  });
}

export function createInvestigation(payload) {
  return request(`${CONTEXT_BASE}/oncology-investigations`, {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function uploadInvestigationFile(patientId, doctorId, investigationId, file) {
  const formData = new FormData();
  formData.append("doctor_id", doctorId);
  formData.append("patient_id", patientId);
  formData.append("investigation_id", investigationId);
  formData.append("file", file);

  return fetch(`${API_BASE_URL}hms/users/cm/storage/oncology-investigations/upload-file-url`, {
    method: "POST",
    body: formData,
  }).then(async r => {
    if (!r.ok) {
      const errorData = await r.json().catch(() => ({ detail: "Unknown error" }));
      throw new Error(errorData.detail || `Upload failed (${r.status})`);
    }
    return r.json();
  });
}

// ─── Nurse Patient Referrals ──────────────────────────────────────────────────

export function createReferral(payload) {
  return request(`${CONTEXT_BASE}/nurse_note/referral/create`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getReferrals(patientId, doctorId) {
  return request(`${CONTEXT_BASE}/nurse_note/referral/${patientId}/${doctorId}`);
}

// ─── Named export bundle for convenience ─────────────────────────────────────
const api = {
  createBooking,
  updateBooking,
  getBooking,
  getBookings,
  getLatestBookingForPatient,
  saveSection,
  updateBookingStatus,
  setActiveBooking,
  completeBooking,
  getOTSchedule,
  getAnaesthesiaChecklist,
  saveAnaesthesiaChecklist,
  getPatientInfo,
  getDoctorInfo,
  getDoctorsByHospital,
  saveDoctorLogs,
  savePatientDiagrams,
  getDoctorLogs,
  getPatientDiagrams,
  uploadDocument,
  getDocuments,
  deleteDocument,
  saveLabOrder,
  saveLabResults,
  parseLabReportPdf,
  getOncologyRecords,
  getPatientVitals,
  getDoctorsNoteSummary,
  predictAsaStatus,
  getInvestigations,
  getCompletedInvestigationDocuments,
  createInvestigation,
  generateInvestigationSuggestion,
  generateDoctorsNarration,
  structureAnaesthesiaProcedure,
  getDischargeSummary,
  generateDischargeNarrative,
  uploadInvestigationFile,
  getPatientBookings,
  getPatientLastAppointment,
  createReferral,
  getReferrals,
};

export default api;
