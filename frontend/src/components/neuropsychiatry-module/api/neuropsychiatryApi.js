// ─────────────────────────────────────────────────────────────────────────────
// neuropsychiatryApi.js — thin fetch client for the neuropsychiatry backend
// (neuropsychiatry.py, router prefix "/neuropsychiatry").
//
// The FastAPI router is mounted under the same base as the other clinical
// modules, so every record/document endpoint resolves at:
//     {API_BASE_URL}hms/users/data/neuropsychiatry/...
// (mirrors surgical-oncology at hms/users/data/surgical-oncology/...).
//
// Doctor lookup is a shared HMS endpoint, NOT part of this module:
//     {API_BASE_URL}hms/users/doctors/get_doctor/{doctorId}
//
// Conventions copied verbatim from RadiationTherapyWorkflow.jsx:
//   • base URL from VITE_BACKEND_URL with the production fallback,
//   • JSON bodies with Content-Type: application/json,
//   • multipart uploads via FormData with NO explicit Content-Type
//     (the browser sets the multipart boundary).
// ─────────────────────────────────────────────────────────────────────────────

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || 'https://doctorassist.ai/api/';

// Base path for this module's record + document endpoints.
const NP_BASE = `${API_BASE_URL}hms/users/data/neuropsychiatry`;

// Parse a JSON response, throwing a useful error on non-2xx.
async function parseJson(res, action) {
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `${res.status}` }));
    throw new Error(err.detail || `${action} failed (${res.status})`);
  }
  return res.json();
}

// ═════════════════════════════════════════════════════════════════════════════
// RECORD LIFECYCLE
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Create a new record (Patient Info first save). Sets status "Active" on the
 * backend and returns { status, record_id, message }.
 */
export async function createRecord({ patientId, doctorId, hospitalId, data }) {
  const res = await fetch(`${NP_BASE}/record`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      patient_id: patientId,
      doctor_id: doctorId,
      hospital_id: hospitalId || null,
      data: data || {},
    }),
  });
  return parseJson(res, 'Create record');
}

/**
 * Save one section (tab) of a record. `section` must be an allowed section key
 * (see TAB_SECTION in tabFieldMap.js / ALLOWED_SECTIONS in neuropsychiatry.py).
 */
export async function saveSection(recordId, section, data) {
  const res = await fetch(
    `${NP_BASE}/record/${recordId}/section/${section}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data || {} }),
    }
  );
  return parseJson(res, `Save ${section}`);
}

/** Update a record's status (e.g. Active → Completed) without other changes. */
export async function updateStatus(recordId, status) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/status`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status }),
  });
  return parseJson(res, 'Update status');
}

/**
 * Complete a record (Summary "Save Full Record"). Marks status "Completed";
 * if `summaryData` is provided it is saved as the "summary" section atomically
 * with the completion.
 */
export async function completeRecord(recordId, summaryData) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/complete`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: summaryData ?? null }),
  });
  return parseJson(res, 'Complete record');
}

// ═════════════════════════════════════════════════════════════════════════════
// RECORD READS
// ═════════════════════════════════════════════════════════════════════════════

/** Get one full record document by record_id. Returns the document or null. */
export async function getRecord(recordId) {
  const res = await fetch(`${NP_BASE}/record/${recordId}`);
  const json = await parseJson(res, 'Fetch record');
  return json?.data || null;
}

/**
 * Get the patient's latest record (active → non-completed → most recent).
 * Used to resume an in-progress case and to attach the Procedure tab.
 * Returns the document or null.
 */
export async function getLatestRecord(patientId) {
  const res = await fetch(`${NP_BASE}/patient/${patientId}/latest-record`);
  const json = await parseJson(res, 'Fetch latest record');
  return json?.data || null;
}

/** Get all records for a patient, optionally filtered by status. */
export async function getPatientRecords(patientId, status) {
  const qs = status && status !== 'All' ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${NP_BASE}/patient/${patientId}/records${qs}`);
  const json = await parseJson(res, 'Fetch patient records');
  return json?.data || [];
}

// ═════════════════════════════════════════════════════════════════════════════
// PROCEDURE SESSIONS — nested procedures→sessions model
// ═════════════════════════════════════════════════════════════════════════════
// A case holds many procedure types (keyed by slug), each with many sessions.
// All three calls return { status, procedures } where `procedures` is the FULL
// updated map, so the caller replaces its local procedures state directly.

/**
 * Append a new session to a procedure (creating the procedure on first use).
 * `slug` is a fixed procedure slug (see PROC_SLUGS in tabFieldMap.js).
 */
export async function addProcedureSession(recordId, slug, { type, category, data }) {
  const res = await fetch(
    `${NP_BASE}/record/${recordId}/procedure/${slug}/session`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, category: category ?? null, data: data || {} }),
    }
  );
  return parseJson(res, 'Add procedure session');
}

/** Update an existing procedure session (matched by sessionId) in place. */
export async function updateProcedureSession(
  recordId,
  slug,
  sessionId,
  { type, category, data }
) {
  const res = await fetch(
    `${NP_BASE}/record/${recordId}/procedure/${slug}/session/${sessionId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, category: category ?? null, data: data || {} }),
    }
  );
  return parseJson(res, 'Update procedure session');
}

/** Delete a single procedure session (matched by sessionId). */
export async function deleteProcedureSession(recordId, slug, sessionId) {
  const res = await fetch(
    `${NP_BASE}/record/${recordId}/procedure/${slug}/session/${sessionId}`,
    { method: 'DELETE' }
  );
  return parseJson(res, 'Delete procedure session');
}

// ═════════════════════════════════════════════════════════════════════════════
// PSYCHOTHERAPY / CBT SESSIONS — same sessions model as procedures
// ═════════════════════════════════════════════════════════════════════════════
// A case runs a course of therapy sessions, stored as a flat list on the record
// (psychotherapySessions) rather than a single overwritten section. All three
// calls return { status, psychotherapy_sessions } where the list is the FULL
// updated one, so the caller replaces its local state directly.

/** Append a new psychotherapy/CBT session to the patient's record. */
export async function addPsychotherapySession(recordId, { data }) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/psychotherapy/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: data || {} }),
  });
  return parseJson(res, 'Add psychotherapy session');
}

/** Update an existing psychotherapy session (matched by sessionId) in place. */
export async function updatePsychotherapySession(recordId, sessionId, { data }) {
  const res = await fetch(
    `${NP_BASE}/record/${recordId}/psychotherapy/session/${sessionId}`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: data || {} }),
    }
  );
  return parseJson(res, 'Update psychotherapy session');
}

/** Delete a single psychotherapy session (matched by sessionId). */
export async function deletePsychotherapySession(recordId, sessionId) {
  const res = await fetch(
    `${NP_BASE}/record/${recordId}/psychotherapy/session/${sessionId}`,
    { method: 'DELETE' }
  );
  return parseJson(res, 'Delete psychotherapy session');
}

// ═════════════════════════════════════════════════════════════════════════════
// MENTAL STATE EXAMINATIONS — same sessions model as psychotherapy
// ═════════════════════════════════════════════════════════════════════════════
// An MSE is repeated at every review, and the series is the point — so each
// examination is appended to a flat list on the record (mseSessions) instead of
// overwriting one section. All three calls return { status, mse_sessions } where
// the list is the FULL updated one, so the caller replaces its local state
// directly.

/** Append a new mental state examination to the patient's record. */
export async function addMseSession(recordId, { data }) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/mse/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: data || {} }),
  });
  return parseJson(res, 'Add MSE session');
}

/** Update an existing examination (matched by sessionId) in place. */
export async function updateMseSession(recordId, sessionId, { data }) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/mse/session/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: data || {} }),
  });
  return parseJson(res, 'Update MSE session');
}

/** Delete a single examination (matched by sessionId). */
export async function deleteMseSession(recordId, sessionId) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/mse/session/${sessionId}`, {
    method: 'DELETE',
  });
  return parseJson(res, 'Delete MSE session');
}

// ═════════════════════════════════════════════════════════════════════════════
// BASELINE INVESTIGATION PANELS — same sessions model as MSE
// ═════════════════════════════════════════════════════════════════════════════
// Vitals, scales and labs are repeated on a monitoring schedule, and the trend
// is the clinical point — so each panel is appended to a flat list on the record
// (baselineSessions) instead of overwriting one section. All three calls return
// { status, baseline_sessions } where the list is the FULL updated one.

/** Append a new baseline investigation panel to the patient's record. */
export async function addBaselineSession(recordId, { data }) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/baseline/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: data || {} }),
  });
  return parseJson(res, 'Add baseline panel');
}

/** Update an existing baseline panel (matched by sessionId) in place. */
export async function updateBaselineSession(recordId, sessionId, { data }) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/baseline/session/${sessionId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: data || {} }),
  });
  return parseJson(res, 'Update baseline panel');
}

/** Delete a single baseline panel (matched by sessionId). */
export async function deleteBaselineSession(recordId, sessionId) {
  const res = await fetch(`${NP_BASE}/record/${recordId}/baseline/session/${sessionId}`, {
    method: 'DELETE',
  });
  return parseJson(res, 'Delete baseline panel');
}

// ═════════════════════════════════════════════════════════════════════════════
// FILE UPLOAD
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Upload a file for a record field. Backend proxies to the storage service and
 * returns { status, file_url, document }. We store `file_url` in the form field.
 *
 * NOTE: no Content-Type header — the browser sets the multipart boundary.
 */
export async function uploadFile({
  file,
  patientId,
  doctorId,
  hospitalId,
  recordId,
  fieldKey,
  docType,
  remarks,
}) {
  const fd = new FormData();
  fd.append('doctor_id', doctorId || '');
  fd.append('patient_id', patientId || '');
  if (hospitalId) fd.append('hospital_id', hospitalId);
  if (recordId) fd.append('record_id', recordId);
  if (fieldKey) fd.append('field_key', fieldKey);
  if (docType) fd.append('doc_type', docType);
  if (remarks) fd.append('remarks', remarks);
  fd.append('file', file);

  const res = await fetch(`${NP_BASE}/documents/upload`, {
    method: 'POST',
    body: fd,
  });
  return parseJson(res, 'File upload');
}

// ═════════════════════════════════════════════════════════════════════════════
// VOICE DICTATION
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Transcribe a recorded audio blob to text.
 *
 * Speech-to-text is a SHARED HMS service (ElevenLabs behind the HMS proxy), not
 * part of this module — the same endpoint every other workflow's dictation box
 * uses. Only the structuring step below is ours.
 *
 * NOTE: no Content-Type header — the browser sets the multipart boundary.
 */
export async function transcribeAudio(blob, filename = 'recording.webm') {
  const fd = new FormData();
  fd.append('file', blob, filename);

  const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, {
    method: 'POST',
    body: fd,
  });
  const json = await parseJson(res, 'Transcribe audio');
  return json?.text || json?.transcription || '';
}

/**
 * Turn a dictated/typed note into { fieldKey: value } for the form.
 *
 * `fields` is the live field spec collected from the FormFields currently
 * mounted (see getFieldSpecs() in NeuropsychiatryContext) — the backend builds
 * its prompt from it and validates the model's answer back against it, so the
 * form's own JSX stays the single source of truth for keys and option lists.
 *
 * Resolves to { data, applied, dropped, unmatchedKeys, model, partial }.
 * `partial` is true when the backend could not process part of the form, so the
 * caller must not report the fill as complete.
 *
 * `conversation` tells the backend the source may be the recorded doctor-patient
 * consultation rather than a doctor's dictation, which needs a different
 * extraction prompt. Omitted or false = the plain dictation behaviour, so only
 * the caller that asks for it is affected.
 */
export async function structureDictation({ text, fields, section, conversation }) {
  const res = await fetch(`${NP_BASE}/dictation/structure`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      fields: fields || [],
      section: section || null,
      conversation: !!conversation,
    }),
  });
  const json = await parseJson(res, 'Structure dictation');
  return {
    data: json?.data || {},
    applied: json?.applied || [],
    dropped: json?.dropped || [],
    unmatchedKeys: json?.unmatched_keys || [],
    // Fields two parts of one transcript disagreed about. The kept value is in
    // `data`; these need a human to confirm rather than a silent winner.
    conflicts: json?.conflicts || [],
    model: json?.model || '',
    partial: !!json?.partial,
    // How the transcript was read: >1 window means it was long enough to be
    // covered in overlapping passes. `truncated` means even that could not reach
    // the end — the tail was never seen, and the doctor has to be told.
    windows: json?.windows_total || 1,
    truncated: !!json?.transcript_truncated,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// DOCTOR LOOKUP (shared HMS endpoint — for name autopopulation)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a doctor's display name from their id. Returns a string ("" if the
 * name cannot be resolved). Parse order matches RadiationTherapyWorkflow.jsx.
 */
export async function getDoctorName(doctorId) {
  if (!doctorId) return '';
  try {
    const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
    if (!res.ok) return '';
    const json = await res.json();
    const docData = json?.data || json?.doctor || json;
    const resolved =
      docData?.name ||
      docData?.doctor_name ||
      `${docData?.first_name || ''} ${docData?.last_name || ''}`.trim();
    return resolved && resolved.trim() !== '' ? resolved.trim() : '';
  } catch (err) {
    console.error('Failed to fetch doctor name', err);
    return '';
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PATIENT LOOKUP (demographic autopopulation)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Resolve a patient's demographic details for the Patient Info tab. Returns a
 * FLAT object (or null if the patient cannot be resolved), from one of two
 * sources tried in order:
 *
 * 1. THIS module's `/neuropsychiatry/patient-profile/{patient_id}`, which reads
 *    the HMS registration document in `patient_users` directly and returns
 *    { patient_name, hms_id, date_of_birth, age, gender, phone_number,
 *      blood_group, marital_status, address, occupation }
 *    — `date_of_birth` is a 'YYYY-MM-DD' string and `age` is derived from it.
 *
 * 2. The shared HMS `get-patient-info` endpoint, as a fallback. Same key names,
 *    but only { patient_name, hms_id, age, gender, diagnosis }: it reads
 *    date_of_birth solely to compute `age` and drops it from the response, which
 *    is why the DOB field cannot be filled from this source.
 *
 * Both shapes are consumed by the same mapPatientDetails() in the context; keys
 * the fallback omits simply stay unmapped.
 *
 * ROUTE CONFIRMED: get-patient-info lives on the shared "context" router
 * (patientcontext.py → APIRouter(prefix="/context")) and is mounted under
 * hms/users/data, so it resolves at hms/users/data/context/get-patient-info.
 * Its query param is `patient_id` (snake_case) and its response is NOT wrapped
 * in { status, data } — it is the object itself.
 */
export async function getPatientDetails(patientId) {
  if (!patientId) return null;

  // 1) This module's own endpoint, which reads the `patient_users` registration
  //    document directly and therefore includes date_of_birth (plus contact,
  //    blood group, marital status, address, occupation). Preferred source.
  try {
    const res = await fetch(
      `${NP_BASE}/patient-profile/${encodeURIComponent(patientId)}`
    );
    if (res.ok) {
      const json = await res.json();
      if (json?.data) return json.data;
    }
  } catch (err) {
    console.error('Failed to fetch patient profile', err);
  }

  // 2) Fallback: the shared context endpoint. Same key names, but it supplies
  //    only a pre-computed `age` and no DOB — so DOB simply stays blank if this
  //    module's backend has not been redeployed yet.
  try {
    const res = await fetch(
      `${API_BASE_URL}hms/users/data/context/get-patient-info?patient_id=${encodeURIComponent(patientId)}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    // Flat object by contract; tolerate a { data:{…} } wrapper just in case.
    return json?.data || json || null;
  } catch (err) {
    console.error('Failed to fetch patient details', err);
    return null;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// PATIENT SUMMARY LOOKUP (for auto-filling Clinical Summary)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fetch the central AI/document-generated patient summary from MongoDB.
 * Primary: {NP_BASE}/patient-summary/{patientId}
 * Fallback: {API_BASE_URL}hms/users/data/context/patient-summary?patient_id={patientId}
 */
export async function getPatientSummary(patientId) {
  if (!patientId) return null;

  // 1) This module's dedicated endpoint (reads 'patient-summary' collection directly)
  try {
    const res = await fetch(
      `${NP_BASE}/patient-summary/${encodeURIComponent(patientId)}`
    );
    if (res.ok) {
      const json = await res.json();
      if (json?.data) {
        console.log('[neuropsychiatryApi] Successfully fetched patient summary from module endpoint:', json.data);
        return json.data;
      }
    }
  } catch (err) {
    console.warn('[neuropsychiatryApi] Module patient-summary endpoint failed, trying fallback...', err);
  }

  // 2) Fallback: shared context endpoint
  try {
    const res = await fetch(
      `${API_BASE_URL}hms/users/data/context/patient-summary?patient_id=${encodeURIComponent(patientId)}`
    );
    if (!res.ok) return null;
    const json = await res.json();
    return json?.data || json || null;
  } catch (err) {
    console.error('[neuropsychiatryApi] Failed to fetch patient summary from both endpoints:', err);
    return null;
  }
}

