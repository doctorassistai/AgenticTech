// shared/api.js — Centralized API wrapper for the Microbiology module
//
// Mirrors components/onco-pathology/shared/api.js. All calls hit the FastAPI
// router in a future users/patient_data/microbiology.py, mounted at
//   …/hms/users/data/microbiology/*
//
// One document per microbiology CASE (keyed by a generated case_id). Sections
// (case_register, specimen_processing, direct_examination, culture_setup,
// culture_workup, molecular, serology, mycobacteriology, preliminary_reports,
// interpretation, infection_control, final_report) are written through the
// single whitelisted saveSection endpoint.
//
// Patient profile / doctor / investigation reads come from components/shared/
// api.js (getPatientInfo etc.) — not duplicated here.

import { API_BASE_URL } from "../../shared/api";

const MICRO_BASE = `${API_BASE_URL}hms/users/data/microbiology`;

// ElevenLabs speech-to-text endpoint. The dictation boxes in the module tabs
// (Registration today; other tabs later) POST their recorded webm blobs here and
// receive back the transcript text.
export const TRANSCRIBE_URL = `${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`;

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
  const url = new URL(path.startsWith("http") ? path : `${MICRO_BASE}${path}`);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  return request(url.toString());
}

function post(path, body) {
  const url = path.startsWith("http") ? path : `${MICRO_BASE}${path}`;
  return request(url, { method: "POST", body: JSON.stringify(body) });
}

function put(path, body) {
  const url = path.startsWith("http") ? path : `${MICRO_BASE}${path}`;
  return request(url, { method: "PUT", body: JSON.stringify(body) });
}

// ─── Case CRUD ────────────────────────────────────────────────────────────────

/**
 * Create a new microbiology case. Backend generates the case_id (UUID) and makes
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

// ─── Section Save ────────────────────────────────────────────────────────────

/**
 * Save a specific section of a case document.
 * @param {string} caseId
 * @param {string} sectionPath — e.g. "case_register", "specimen_processing",
 *        "culture_workup", "final_report"
 * @param {object} data — the section data
 */
export function saveSection(caseId, sectionPath, data) {
  return put(`/case/${caseId}/section/${sectionPath}`, { data });
}

// ─── Advisory (Tab 12 AI assistant) ──────────────────────────────────────────

/**
 * Generate advisory clinical-interpretation suggestions for a case (Tab 12 AI).
 * The backend reads the stored case; a partial interpretation draft may be sent
 * as optional context. Output is advisory only — never auto-written.
 * @param {string} caseId
 * @param {object} [draftInterpretation]
 * @returns {{ status: string, data: object }}
 */
export function interpretationAdvisory(caseId, draftInterpretation) {
  return post(`/case/${caseId}/interpretation-advisory`, { draft_interpretation: draftInterpretation || null });
}

/**
 * Generate an advisory pharmacogenomics brief for a case (Tab 16).
 *
 * A sibling of the interpretation advisory rather than a variant: that brief is
 * infection-scoped, this one is patient-scoped (which drugs this genotype makes
 * dangerous, and which genes were never assessed). Read-only — the microbiologist
 * chooses every dose action; nothing here is written to the case.
 * @param {string} caseId
 * @param {object} [draftSection] the form's unsaved state, so a brief can be read
 *        before the section is saved
 * @returns {{ status: string, data: object }}
 */
export function pgxAdvisory(caseId, draftSection) {
  return post(`/case/${caseId}/pgx-advisory`, { draft_section: draftSection || null });
}

// ─── Sign-out (Tab 14) ───────────────────────────────────────────────────────

/**
 * Sign out (finalize + lock) a microbiology case.
 * @param {string} caseId
 * @param {{ force?: boolean, by?: string }} [options] — `force` bypasses the
 *        server-side essential blockers so an unfinished case can be closed and
 *        a new case started (recorded as forced on the document); `by` names
 *        who performed the sign-out. The saved final_report must be present on
 *        the server regardless (this endpoint reads it, it is not sent here).
 * @returns {{ status: string, message: string }}
 */
export function signOutCase(caseId, options = {}) {
  const params = new URLSearchParams();
  if (options.force) params.set("force", "true");
  if (options.by) params.set("by", options.by);
  const qs = params.toString();
  return put(`/case/${caseId}/sign-out${qs ? `?${qs}` : ""}`, {});
}

// ─── Registration dictation autofill (Tab 1) ─────────────────────────────────

/**
 * Structure a spoken specimen list into per-specimen Registration row fields.
 * Advisory: the tab applies each entry to empty specimen-row fields only and may
 * add new rows; nothing already entered is overwritten.
 * @param {string} text  the dictated transcript
 * @returns {{ status: string, data: { specimens: object[] } }}
 */
export function structureRegistration(text) {
  return post(`/registration/structure`, { text });
}

// ─── Processing dictation autofill (Tab 2) ───────────────────────────────────

/**
 * Structure a spoken bench record for ONE specimen into that specimen's
 * Processing record fields. The card's live panels (which sub-blocks render for
 * this specimen) and the offered media options are sent so the model only ever
 * targets fields the card can hold. Advisory: the tab fills empty fields of that
 * card only — nothing already entered is overwritten or cleared.
 * @param {{ text: string, specimen: object, panels: object }} payload
 *        `panels` carries the containment/media/culture/blood_culture/anaerobic/
 *        parasitology booleans plus `media_options`.
 * @returns {{ status: string, data: object }}  record keys for the live panels
 */
export function structureProcessing(payload) {
  return post(`/processing/structure`, payload);
}

// ─── Direct Exam dictation autofill (Tab 3) ─────────────────────────────────

/**
 * Structure a spoken microscopy record for ONE specimen into that specimen's
 * Direct Exam fields — per-exam-type result rows (and optionally the specimen
 * quality comment). The card's live shape is its offered exam types, so the
 * request sends `exam_schema` — each offered exam type's value/label/prep and
 * its config-driven field keys/kinds/option lists — the same config the card
 * renders itself. Advisory: the tab fills empty fields only, adds a new exam
 * row when a dictated type has none, and never overwrites or clears anything.
 * @param {{ text: string, specimen: object, exam_schema: object[] }} payload
 *        `specimen` carries { specimen_type, site_of_collection }; `exam_schema`
 *        is the offered DIRECT_EXAM_TYPES config subset.
 * @returns {{ status: string, data: object }}  data = { quality_comment, exams: [ { exam_type, examined_at, result } ] }
 */
export function structureDirectExam(payload) {
  return post(`/direct-exam/structure`, payload);
}

// ─── Pathogen genomics dictation autofill (Tab 15) ───────────────────────────

/**
 * Structure a spoken sequencing result into ONE Pathogen Genomics sub-tab's
 * record. The request names the sub-tab, so the model is given only that panel's
 * field guide and can never cross-wire WGS keys into tNGS. For the targeted
 * sub-tab it also carries the offered panels (the specimen's own ordered-test
 * derivation), so only panels this specimen ordered are ever returned.
 *
 * Advisory: the tab fills empty fields of the ACTIVE sub-tab's record only, adds
 * a row for a dictated determinant that has none, and recomputes the derived
 * fields (TB classification, heteroresistance, panel kind) itself — the model
 * never supplies them. Nothing here writes to a case.
 * @param {{ text: string, sub_tab: string, specimen?: object,
 *           species_is_mtbc?: boolean, panels?: object[] }} payload
 * @returns {{ status: string, data: object }}  that sub-tab's record keys
 */
export function structurePathogenGenomics(payload) {
  return post(`/pathogen-genomics/structure`, payload);
}

// ─── Human genomics dictation autofill (Tab 16) ──────────────────────────────

/**
 * Structure a spoken pharmacogenomic result into ONE chunk of the Human Genomics
 * form. The tab is case-level and much the largest in the module, so one
 * transcript is sent once per chunk ("assay" = consent + assay, "qc", "genes",
 * "hla" = HLA + G6PD + report) and the responses are folded in together. Each
 * request then carries only its own field guide, so the model cannot put a gene
 * key in the report body, and no single response can outgrow its token budget.
 *
 * Advisory: the tab fills empty fields only and adds a row for a dictated gene or
 * allele that has none. The catalogue derivations the screen performs on manual
 * entry (a gene's drugs and evidence level, the published dose action for a
 * phenotype, an HLA allele's drug and reaction, the G6PD action) are re-applied
 * by the frontend, never taken from the model.
 * @param {{ text: string, chunk: string }} payload
 * @returns {{ status: string, data: object }}  that chunk's section keys
 */
export function structureHumanGenomics(payload) {
  return post(`/human-genomics/structure`, payload);
}

// ─── Interpretation dictation autofill (Tab 12 — antimicrobial commentary) ───

/**
 * Structure spoken Antimicrobial & stewardship commentary (Tab 12) into the
 * section's two free-text sub-objects. The section is case-level (not keyed by
 * specimen) and entirely free text, so only the raw dictation is sent. Advisory:
 * the tab fills the section's empty fields only — nothing already entered is
 * overwritten or cleared.
 * @param {string} text  the dictated transcript
 * @returns {{ status: string, data: { antimicrobial: object, cascade_confirm: object } }}
 *          data.antimicrobial = { recommended, avoid, de_escalation, clsi_reference }
 *          data.cascade_confirm = { note }
 */
export function structureAntimicrobialCommentary(text) {
  return post(`/antimicrobial-commentary/structure`, { text });
}

export default {
  createCase,
  getCase,
  getPatientCases,
  getLatestCase,
  saveSection,
  interpretationAdvisory,
  pgxAdvisory,
  signOutCase,
  structureRegistration,
  structureProcessing,
  structureDirectExam,
  structurePathogenGenomics,
  structureHumanGenomics,
  structureAntimicrobialCommentary,
};
