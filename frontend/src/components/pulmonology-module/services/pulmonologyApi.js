/**
 * pulmonology-module/services/pulmonologyApi.js
 * Centralized API client service for Pulmonology Module.
 * Connects React frontend directly to the FastAPI/MongoDB backend.
 */

const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BACKEND_URL) ||
  "https://doctorassist.ai/api/";

const PULM_BASE = `${API_BASE_URL}hms/users/data/pulmonology`.replace(/([^:]\/)\/+/g, "$1");
const DIRECT_PULM_BASE = `${API_BASE_URL}pulmonology`.replace(/([^:]\/)\/+/g, "$1");

/**
 * Generic HTTP Request Helper with gateway and direct fallback
 */
async function request(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${PULM_BASE}${endpoint}`;

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  try {
    let response = await fetch(url, { ...options, headers });

    // Fallback to direct /pulmonology path if gateway returns 404
    if (!response.ok && response.status === 404 && !endpoint.startsWith("http")) {
      const fallbackUrl = `${DIRECT_PULM_BASE}${endpoint}`;
      const fallbackResponse = await fetch(fallbackUrl, { ...options, headers }).catch(() => null);
      if (fallbackResponse && fallbackResponse.ok) {
        return await fallbackResponse.json();
      }
    }

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown server error");
      throw new Error(`API ${options.method || "GET"} ${url} failed (${response.status}): ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[Pulmonology API Error]:`, error);
    throw error;
  }
}

// ─── Patient Profile & Demographics ──────────────────────────────────────────

export async function getPatientProfile(patientId, doctorId = "") {
  const contextBase = `${API_BASE_URL}hms/users/data/context`.replace(/([^:]\/\/)\/+?/g, "$1");
  let context = {};

  try {
    const contextResponse = await fetch(
      `${contextBase}/get-patient-info?patient_id=${encodeURIComponent(patientId)}`
    );
    if (contextResponse.ok) {
      const contextResult = await contextResponse.json();
      context = contextResult?.data || contextResult?.patient || contextResult || {};
    }
  } catch (err) {
    console.warn("Context get-patient-info unavailable:", err.message);
  }

  let registration = {};
  try {
    const profileResult = await request(
      `/patient-profile/${encodeURIComponent(patientId)}?doctor_id=${encodeURIComponent(doctorId || "")}`
    );
    registration = profileResult?.data || {};
  } catch (err) {
    console.warn("Pulmonology patient-profile unavailable:", err.message);
  }

  const merged = { ...context, ...registration };
  return {
    status: "success",
    data: {
      name: merged.name || merged.patient_name || merged.full_name || "",
      patient_id: merged.patient_id || merged.mrn || patientId,
      mrn: merged.mrn || merged.patient_id || patientId,
      dob: merged.dob || merged.date_of_birth || "",
      age: merged.age || "",
      gender: merged.gender || merged.sex || "",
      ethnicity: merged.ethnicity || merged.race || "",
      contact: merged.contact || merged.phone_number || merged.phone || merged.mobile || "",
      email: merged.email || merged.email_address || "",
      primary_language: merged.primary_language || merged.language || "",
      emergency_contact: merged.emergency_contact || merged.emergency_contacts || "",
      payer: merged.payer || merged.insurance_provider || merged.insurance || "",
      doctor_id: doctorId || merged.doctor_id || "",
      doctor_name: merged.doctor_name || merged.pulmonologist || "",
      smoking_history: merged.smoking_history || merged.smoking_status || "",
    },
  };
}

// ─── Longitudinal Records & Encounters ───────────────────────────────────────

export async function getLatestPulmonologyRecord(patientId) {
  return request(`/patient/${encodeURIComponent(patientId)}/latest-record`);
}

export async function getPatientRecords(patientId, status = "All") {
  return request(`/patient/${encodeURIComponent(patientId)}/records?status=${encodeURIComponent(status)}`);
}

export async function createPulmonologyRecord(payload) {
  return request("/record", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function savePulmonologyRecordSection(recordId, section, data) {
  return request(`/record/${encodeURIComponent(recordId)}/section/${encodeURIComponent(section)}`, {
    method: "PUT",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function completePulmonologyRecord(recordId, completionSummary = null) {
  return request(`/record/${encodeURIComponent(recordId)}/complete`, {
    method: "PUT",
    body: JSON.stringify({ data: completionSummary }),
  });
}

// ─── Longitudinal Procedure Sessions (procedures.<slug>.sessions) ────────────

/**
 * Append a new session to a procedure (creating the procedure on first use).
 * Returns { status: "success", procedures: { ... } } with the full updated procedures map.
 */
export async function addPulmProcedureSession(recordId, slug, { type, category, notes, data } = {}) {
  return request(`/record/${encodeURIComponent(recordId)}/procedure/${encodeURIComponent(slug)}/session`, {
    method: "POST",
    body: JSON.stringify({
      type: type || "Procedure",
      category: category ?? null,
      notes: notes ?? null,
      data: data || {},
    }),
  });
}

/** Update an existing procedure session in place. */
export async function updatePulmProcedureSession(
  recordId,
  slug,
  sessionId,
  { type, category, notes, data } = {}
) {
  return request(
    `/record/${encodeURIComponent(recordId)}/procedure/${encodeURIComponent(slug)}/session/${encodeURIComponent(sessionId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        type: type || "Procedure",
        category: category ?? null,
        notes: notes ?? null,
        data: data || {},
      }),
    }
  );
}

/** Delete a single procedure session. */
export async function deletePulmProcedureSession(recordId, slug, sessionId) {
  return request(
    `/record/${encodeURIComponent(recordId)}/procedure/${encodeURIComponent(slug)}/session/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

/** Retrieve all sessions for a specific procedure slug. */
export async function getPulmProcedureSessions(recordId, slug) {
  return request(`/record/${encodeURIComponent(recordId)}/procedure/${encodeURIComponent(slug)}/sessions`);
}

// ─── Longitudinal Screening Sessions (screeningSessions[]) ───────────────────

/**
 * Append a new screening assessment to the record's screeningSessions array.
 * Returns { status: "success", screeningSessions: [ ... ] } with the full updated array.
 */
export async function addPulmScreeningSession(recordId, { type, screening_type, notes, data } = {}) {
  return request(`/record/${encodeURIComponent(recordId)}/screening/session`, {
    method: "POST",
    body: JSON.stringify({
      type: type || "Screening Alert",
      screening_type: screening_type ?? null,
      notes: notes ?? null,
      data: data || {},
    }),
  });
}

/** Update an existing screening session in place. */
export async function updatePulmScreeningSession(recordId, sessionId, { type, screening_type, notes, data } = {}) {
  return request(
    `/record/${encodeURIComponent(recordId)}/screening/session/${encodeURIComponent(sessionId)}`,
    {
      method: "PUT",
      body: JSON.stringify({
        type: type || "Screening Alert",
        screening_type: screening_type ?? null,
        notes: notes ?? null,
        data: data || {},
      }),
    }
  );
}

/** Delete a single screening session. */
export async function deletePulmScreeningSession(recordId, sessionId) {
  return request(
    `/record/${encodeURIComponent(recordId)}/screening/session/${encodeURIComponent(sessionId)}`,
    { method: "DELETE" }
  );
}

/** Retrieve all screening sessions recorded in the record. */
export async function getPulmScreeningSessions(recordId) {
  return request(`/record/${encodeURIComponent(recordId)}/screening/sessions`);
}

// Aliases matching Neurology conventions
export const addProcedureSession = addPulmProcedureSession;
export const updateProcedureSession = updatePulmProcedureSession;
export const deleteProcedureSession = deletePulmProcedureSession;
export const getProcedureSessions = getPulmProcedureSessions;

export const addScreeningSession = addPulmScreeningSession;
export const updateScreeningSession = updatePulmScreeningSession;
export const deleteScreeningSession = deletePulmScreeningSession;
export const getScreeningSessions = getPulmScreeningSessions;

// ─── Repeatable Track Sessions (ABGs, PFTs, Interventions) ────────────────────

export async function saveTrackSession(payload) {
  return request("/track-session", {
    method: "POST",
    body: JSON.stringify({
      patient_id: payload.patientId || payload.patient_id || "",
      doctor_id: payload.doctorId || payload.doctor_id || "",
      hospital_id: payload.hospitalId || payload.hospital_id || null,
      record_id: payload.recordId || payload.record_id || null,
      track: payload.track || "diagnostics",
      tab: payload.tab || null,
      data: payload.data || {},
    }),
  });
}

export async function updateTrackSession(sessionId, data, doctorId = null, patientId = null) {
  return request(`/track-session/${encodeURIComponent(sessionId)}`, {
    method: "PUT",
    body: JSON.stringify({ data, doctor_id: doctorId, patient_id: patientId }),
  });
}

export async function getTrackSession(sessionId) {
  return request(`/track-session/${encodeURIComponent(sessionId)}`);
}

export async function updateSessionStatus(sessionId, status) {
  return request(`/track-session/${encodeURIComponent(sessionId)}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export async function getPatientHistory(patientId, track = null, tab = null, limit = 50) {
  const params = new URLSearchParams();
  if (track) params.append("track", track);
  if (tab) params.append("tab", tab);
  if (limit) params.append("limit", String(limit));
  const q = params.toString() ? `?${params.toString()}` : "";
  return request(`/patient/${encodeURIComponent(patientId)}/history${q}`);
}

export const getPatientSessions = getPatientHistory;
export const getNephrologySession = getTrackSession;
export const savePulmonologySession = saveTrackSession;
export const updatePulmonologySession = updateTrackSession;

export async function checkDiagnosticsCompleteness(recordId) {
  return request(`/record/${encodeURIComponent(recordId)}/completeness`);
}

// ─── Deterministic Physiological Engines ────────────────────────────────────

export async function calculateAbg(payload) {
  return request("/diagnostics/abg-calc", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function calculatePft(payload) {
  return request("/diagnostics/pft-calc", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function calculatePrognosticScores(payload) {
  return request("/screening/scores-calc", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function evaluateLightsCriteria(payload) {
  return request("/advanced/lights-criteria", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function evaluateChestTubeReadiness(payload) {
  return request("/advanced/chest-tube-readiness", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function evaluateTransplantRules(payload) {
  return request("/advanced/transplant-rules", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Specialty Pulmonology AI Copilots ──────────────────────────────────────

export async function generateIntakeTriage(data) {
  return request("/intake/llm-triage", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function generateDiagnosticsSynthesis(data) {
  return request("/diagnostics/llm-synthesis", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function generateNivTitration(data) {
  return request("/airway/llm-niv-titration", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function generateInhalerOptimization(data) {
  return request("/airway/llm-inhaler-optimization", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function reconcileMedicationsAi(data) {
  return request("/airway/llm-medication-reconcile", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function generateProcedureNarrative(data, procedureType = "") {
  return request("/advanced/llm-procedure-narrative", {
    method: "POST",
    body: JSON.stringify({ data, procedure_type: procedureType }),
  });
}

export async function generateTransplantSynthesis(data) {
  return request("/advanced/llm-transplant-synthesis", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function generateDispositionSummary(data) {
  return request("/discharge/llm-disposition-summary", {
    method: "POST",
    body: JSON.stringify({ data }),
  });
}

export async function getVbcAnalytics(patientId) {
  return request(`/ops/vbc-analytics/${encodeURIComponent(patientId)}`);
}

export async function transcribePulmonologyAudio(audioBlob) {
  const formData = new FormData();
  formData.append("file", audioBlob, "recording.webm");
  const url = `${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`.replace(/([^:]\/\/)\/+?/g, "$1");
  const response = await fetch(url, { method: "POST", body: formData });
  if (!response.ok) {
    const detail = await response.text().catch(() => "Audio transcription failed");
    throw new Error(`Audio transcription failed (${response.status}): ${detail}`);
  }
  return response.json();
}

export async function structurePulmonologyDictation(payload) {
  return request("/dictation/structure", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getDoctorDetails(doctorId) {
  const url = `${API_BASE_URL}hms/users/doctors/get_doctor/${encodeURIComponent(doctorId)}`.replace(/([^:]\/\/)\/+?/g, "$1");
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch doctor details");
  return response.json();
}
