// shared/api.js - Shared API wrapper for COMMON components

export const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
export const SO_BASE = `${API_BASE_URL}hms/users/data/surgical-oncology`;
export const CONTEXT_BASE = `${API_BASE_URL}hms/users/data/context`;
export const DOCTORS_BASE = `${API_BASE_URL}hms/users/doctors`;

export async function request(url, options = {}) {
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

export function get(path, params = {}) {
  const url = new URL(path.startsWith("http") ? path : `${SO_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return request(url.toString());
}

export function getPatientInfo(patientId) {
  return get(`/get-patient-info`, { patient_id: patientId });
}

export function getPatientVitals(patientId) {
  return get(`/patient-vitals/${patientId}`);
}

export function getDoctorsByHospital(hospitalId) {
  return request(`${CONTEXT_BASE}/get_doctors_by_hospital/${hospitalId}`);
}

export function getDoctorInfo(doctorId) {
  return request(`${DOCTORS_BASE}/get_doctor/${doctorId}`);
}

// only returns chemo and radio -> being used in surgical onco
export function getOncologyRecords(patientId) {
  return get(`/oncology-records/${patientId}`);
}



//
// ─── LAB Investigations ────────────────────────────────────────────
//




export function getInvestigations(patientId, doctorId) {
  return request(`${CONTEXT_BASE}/oncology-investigations/${patientId}?doctor_id=${doctorId || ""}`);
}

export function getCompletedInvestigations(patientId, doctorId) {
  return request(`${CONTEXT_BASE}/oncology-investigations/completed-documents`, {
    method: "POST",
    body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
  });
}




//
// ─── Anaesthesia Record CRUD ────────────────────────────────────────────
//



export const ANAESTHESIA_BASE = `${API_BASE_URL}hms/users/data/anaesthesia`;

export function createAnaesthesiaRecord(patientId, doctorId) {
  return request(`${ANAESTHESIA_BASE}/record`, {
    method: "POST",
    body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
  });
}

export function getAnaesthesiaRecord(recordId) {
  return request(`${ANAESTHESIA_BASE}/record/${recordId}`);
}

export function getAnaesthesiaRecords(patientId) {
  return request(`${ANAESTHESIA_BASE}/records/${patientId}`);
}

export function getActiveAnaesthesiaRecord(patientId) {
  return request(`${ANAESTHESIA_BASE}/record/active/${patientId}`);
}

export function getAnaesthesiaRecordByBooking(bookingId) {
  return request(`${ANAESTHESIA_BASE}/record/by-booking/${bookingId}`);
}

export function saveAnaesthesiaSection(recordId, sectionPath, data) {
  return request(`${ANAESTHESIA_BASE}/record/${recordId}/section/${sectionPath}`, {
    method: "PUT",
    body: JSON.stringify({ data }),
  });
}

export function completeAnaesthesiaRecord(recordId) {
  return request(`${ANAESTHESIA_BASE}/record/${recordId}/complete`, {
    method: "PUT",
  });
}

export function linkAnaesthesiaToBooking(recordId, bookingId) {
  const targetId = (bookingId && bookingId !== "null" && bookingId !== "none") ? bookingId : "null";
  return request(`${ANAESTHESIA_BASE}/record/${recordId}/link-booking/${targetId}`, {
    method: "PUT",
  });
}

export function structureAnaesthesiaProcedure(text, section) {
  return request(`${ANAESTHESIA_BASE}/procedure/structure`, {
    method: "POST",
    body: JSON.stringify({ text, section }),
  });
}

export function structureAnaesthesiaChecklist(text) {
  return request(`${ANAESTHESIA_BASE}/checklist/structure`, {
    method: "POST",
    body: JSON.stringify({ text }),
  });
}

