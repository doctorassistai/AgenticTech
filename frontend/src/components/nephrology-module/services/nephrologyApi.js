/**
 * nephrology-module/services/nephrologyApi.js
 * Centralized API client service for Nephrology, Hemodialysis, and Transplant modules.
 * Connects React frontend directly to the FastAPI/MongoDB backend.
 */

// Resolves backend base URL across development, gateway, and production
const API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_BACKEND_URL) ||
  "https://doctorassist.ai/api/";

// Primary gateway route for users/patient_data endpoints
const NEPHRO_BASE = `${API_BASE_URL}hms/users/data/nephrology`.replace(/([^:]\/)\/+/g, "$1");

/**
 * Generic HTTP Request Helper
 */
async function request(endpoint, options = {}) {
  const url = endpoint.startsWith("http") ? endpoint : `${NEPHRO_BASE}${endpoint}`;

  const headers = {
    "Content-Type": "application/json",
    ...options.headers,
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown server error");
      throw new Error(`API ${options.method || "GET"} ${url} failed (${response.status}): ${errorText}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`[Nephrology API Error]:`, error);
    throw error;
  }
}

export async function transcribeNephrologyAudio(audioBlob) {
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

export async function structureNephrologyDictation(payload) {
  return request("/dictation/structure", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function generateIntakeTriage(data) {
  return request("/intake/llm-triage", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generateDifferential(data) {
  return request("/diagnostics/llm-differential", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generatePhenotype(data) {
  return request("/diagnostics/llm-phenotype", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generatePathology(data) {
  return request("/diagnostics/llm-pathology", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generateAkiAiAssist(section, data) {
  return request("/aki/ai-assist", {
    method: "POST",
    body: JSON.stringify({ section, data: data || {} }),
  });
}

export async function generateCkdAiAssist(data) {
  return request("/ckd/ai-assist", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateCkdLlmRiskSummary(data) {
  return request("/ckd/llm-risk-summary", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateCkdLlmHtnDmSummary(data) {
  return request("/ckd/llm-htn-dm-summary", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateAkiDrugReview(data) {
  return request("/aki/drug-review", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generateCkdDrugReview(data) {
  return request("/ckd/drug-review", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generateRrtModalityRec(data) {
  return request("/rrt/llm-modality-rec", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generateRrtOutcomePrediction(data) {
  return request("/rrt/llm-outcome-prediction", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generateRrtMcdaWeighting(data) {
  return request("/rrt/llm-mcda-weighting", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generateRrtDonorNlp(data) {
  return request("/rrt/llm-donor-nlp", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function generateAccessMaturation(data) {
  return request("/access/llm-maturation", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateAccessTiming(data) {
  return request("/access/llm-timing", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateAccessFailureRisk(data) {
  return request("/access/llm-failure-risk", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateAccessFlowTrajectory(data) {
  return request("/access/llm-flow-trajectory", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateAccessInterventionOpt(data) {
  return request("/access/llm-intervention-opt", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateHdIdh(data) {
  return request("/hd/llm-idh", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateHdDryWeight(data) {
  return request("/hd/llm-dry-weight", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateHdAdequacy(data) {
  return request("/hd/llm-adequacy", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateHdElectrolytes(data) {
  return request("/hd/llm-electrolytes", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generatePdHomePeritonitis(data) {
  return request("/pd-home/llm-peritonitis", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generatePdHomeFluid(data) {
  return request("/pd-home/llm-fluid", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generatePdHomeAdequacy(data) {
  return request("/pd-home/llm-adequacy", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generatePdHomeHdOpt(data) {
  return request("/pd-home/llm-hd-opt", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generatePdHomeAdherence(data) {
  return request("/pd-home/llm-adherence", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generatePdHomeTech(data) {
  return request("/pd-home/llm-tech", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateAdequacyPrognosis(data) {
  return request("/adequacy/llm-prognosis", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateAdequacyDryWeight(data) {
  return request("/adequacy/llm-dry-weight", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateTxReadiness(data) {
  return request("/transplant/llm-readiness", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateTxWaitlist(data) {
  return request("/transplant/llm-waitlist", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateTxDonorMatch(data) {
  return request("/transplant/llm-donor-match", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateTxImmuno(data) {
  return request("/transplant/llm-immuno", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateTxPostRejection(data) {
  return request("/transplant/llm-post-rejection", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateTxPostSurvival(data) {
  return request("/transplant/llm-post-survival", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateOpsTimeline(data) {
  return request("/ops/llm-timeline", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateDigitalTwin(data) {
  return request("/ops/llm-digital-twin", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function generateVbcAnalytics(data) {
  return request("/ops/llm-vbc-analytics", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}

export async function syncVbcHistoricalData(patientId) {
  return request(`/ops/vbc-historical-sync/${patientId}`);
}

export async function generatePostDischarge(data) {
  return request("/ops/llm-post-discharge", { method: "POST", body: JSON.stringify({ data: data || {} }) });
}
// ─── v2 Longitudinal Records ──────────────────────────────────────────────────

export async function createNephrologyRecord(payload) {
  return request("/record", {
    method: "POST",
    body: JSON.stringify({
      patient_id: payload.patientId || payload.patient_id || "",
      doctor_id: payload.doctorId || payload.doctor_id || "",
      hospital_id: payload.hospitalId || payload.hospital_id || null,
      data: payload.data || {},
    }),
  });
}

export async function getNephrologyRecord(recordId) {
  return request(`/record/${recordId}`);
}

export async function getLatestNephrologyRecord(patientId) {
  return request(`/patient/${patientId}/latest-record`);
}

export async function getPatientProfile(patientId, doctorId = "") {
  const contextBase = `${API_BASE_URL}hms/users/data/context`.replace(/([^:]\/\/)\/+?/g, "$1");
  const contextResponse = await fetch(
    `${contextBase}/get-patient-info?patient_id=${encodeURIComponent(patientId)}`
  );
  if (!contextResponse.ok) {
    throw new Error(`Patient profile request failed (${contextResponse.status})`);
  }

  const contextResult = await contextResponse.json();
  const context = contextResult?.data || contextResult?.patient || contextResult || {};

  let registration = {};
  try {
    const profileResponse = await fetch(
      `${contextBase.replace(/\/context$/, "")}/nephrology/patient-profile/${encodeURIComponent(patientId)}?doctor_id=${encodeURIComponent(doctorId || "")}`
    );
    if (profileResponse.ok) {
      const profileResult = await profileResponse.json();
      registration = profileResult?.data || {};
    }
  } catch (error) {
    console.warn("Detailed patient registration profile unavailable:", error.message);
  }

  const merged = { ...context, ...registration };
  return {
    status: "success",
    data: {
      name: merged.name || merged.patient_name || merged.full_name,
      dob: merged.dob || merged.date_of_birth,
      age: merged.age,
      gender: merged.gender || merged.sex,
      ethnicity: merged.ethnicity || merged.race,
      contact:
        merged.contact ||
        merged.phone_number ||
        merged.phone ||
        merged.mobile ||
        merged.contact_number,
      emergency_contact:
        merged.emergency_contact || merged.emergency_contacts,
      payer:
        merged.payer ||
        merged.payer_information ||
        merged.insurance_provider ||
        merged.insurance,
      doctor_id: doctorId,
      doctor_name: merged.doctor_name || merged.nephrologist,
    },
  };
}
export async function saveNephrologyRecordSection(recordId, section, data) {
  return request(`/record/${recordId}/section/${section}`, {
    method: "PUT",
    body: JSON.stringify({ data: data || {} }),
  });
}

// ─── v2 Track Sessions ───────────────────────────────────────────────────────

export async function saveTrackSession(payload) {
  return request("/track-session", {
    method: "POST",
    body: JSON.stringify({
      patient_id: payload.patientId || payload.patient_id || "",
      doctor_id: payload.doctorId || payload.doctor_id || "",
      hospital_id: payload.hospitalId || payload.hospital_id || null,
      record_id: payload.recordId || payload.record_id || null,
      track: payload.track || "intake_baseline",
      tab: payload.tab || null,
      data: payload.data || {},
    }),
  });
}

export async function getTrackSession(sessionId) {
  return request(`/track-session/${sessionId}`);
}

export async function updateTrackSession(sessionId, data, patientId = "", doctorId = "") {
  return request(`/track-session/${sessionId}`, {
    method: "PUT",
    body: JSON.stringify({
      data: data || {},
      patient_id: patientId || undefined,
      doctor_id: doctorId || undefined,
    }),
  });
}

// ─── Compatibility names used by the workflow ───────────────────────────────

/**
 * Create or save a discrete nephrology encounter session into MongoDB.
 * @param {Object} payload - { patient_id, doctor_id, treatment_plan_id, session_type, status, data }
 * @returns {Promise<{ status: string, session_id: string }>}
 */
export async function saveNephrologySession(payload) {
  return saveTrackSession(payload);
}

/**
 * Fetch a session document by its session_id.
 * @param {string} sessionId
 */
export async function getNephrologySession(sessionId) {
  return getTrackSession(sessionId);
}

/**
 * Update an existing session's clinical data.
 * @param {string} sessionId
 * @param {Object} data
 */
export async function updateNephrologySession(sessionId, data, patientId = "", doctorId = "") {
  return updateTrackSession(sessionId, data, patientId, doctorId);
}

/**
 * Update session encounter status (draft -> active -> completed).
 * @param {string} sessionId
 * @param {string} status
 */
export async function updateSessionStatus(sessionId, status) {
  return request(`/track-session/${sessionId}/status`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

// ─── Longitudinal History & Flowsheets ────────────────────────────────────────

/**
 * Fetch historical sessions for a patient to populate flowsheet tables.
 * @param {string} patientId
 * @param {string} [sessionType] - Optional filter ('hemodialysis' | 'ckd_opd' | 'transplant')
 * @param {number} [limit=20]
 */
export async function getPatientSessions(patientId, sessionType = null, limit = 20) {
  const track = sessionType || null;
  let endpoint = `/patient/${patientId}/history?limit=${limit}`;
  if (track) endpoint += `&track=${encodeURIComponent(track)}`;
  return request(endpoint);
}

/**
 * Fetch longitudinal flowsheet summary averages (mean UF, mean URR, last dry weight).
 * @param {string} patientId
 */
export async function getPatientFlowsheetSummary(patientId) {
  return request(`/patient/${patientId}/history/summary`);
}

// ─── Treatment Plans ──────────────────────────────────────────────────────────

/**
 * Create or update a macro-level Treatment Plan.
 * @param {Object} planPayload
 */
export async function saveTreatmentPlan(planPayload) {
  return request("/treatment-plan", {
    method: "POST",
    body: JSON.stringify(planPayload),
  });
}


export async function generateDischargePlan(data) {
  return request("/ops/llm-discharge-plan", {
    method: "POST",
    body: JSON.stringify({ data: data || {} }),
  });
}

export async function getDoctorDetails(doctorId) {
  const url = `${API_BASE_URL}hms/users/doctors/get_doctor/${encodeURIComponent(doctorId)}`.replace(/([^:]\/\/)\/+?/g, "$1");
  const response = await fetch(url);
  if (!response.ok) throw new Error("Failed to fetch doctor details");
  return response.json();
}
