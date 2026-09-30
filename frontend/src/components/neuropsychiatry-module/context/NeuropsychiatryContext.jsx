import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import {
  createRecord,
  saveSection,
  completeRecord,
  getLatestRecord,
  getDoctorName,
  getPatientDetails,
  getPatientSummary,
  addProcedureSession as apiAddProcedureSession,
  updateProcedureSession as apiUpdateProcedureSession,
  deleteProcedureSession as apiDeleteProcedureSession,
  addPsychotherapySession as apiAddPsychotherapySession,
  updatePsychotherapySession as apiUpdatePsychotherapySession,
  deletePsychotherapySession as apiDeletePsychotherapySession,
  addMseSession as apiAddMseSession,
  updateMseSession as apiUpdateMseSession,
  deleteMseSession as apiDeleteMseSession,
  addBaselineSession as apiAddBaselineSession,
  updateBaselineSession as apiUpdateBaselineSession,
  deleteBaselineSession as apiDeleteBaselineSession,
} from '../api/neuropsychiatryApi';
import {
  extractSectionData,
  hydrateFromRecord,
  WORKFLOW_SECTIONS,
} from './tabFieldMap';
import { formatPatientSummary } from '../utils/patientSummaryFormatter';

const NeuropsychiatryContext = createContext(null);

// Doctor-name fields that get autopopulated from the logged-in doctor's profile
// (only when empty or still holding the placeholder — a saved value always wins).
const DOCTOR_NAME_FIELDS = ['referringDoctor', 'operator', 'surgSurgeon', 'sConsultant'];
const DOCTOR_PLACEHOLDER = 'Dr. (from profile)';

// Normalise the HMS `gender` value onto the radio options this module uses
// (O.sex = ['Male','Female','Transgender']) so the Sex radio actually selects
// regardless of the casing/abbreviation the users collection stores.
function normalizeSex(g) {
  if (!g) return undefined;
  const s = String(g).trim().toLowerCase();
  if (s === 'male' || s === 'm') return 'Male';
  if (s === 'female' || s === 'f') return 'Female';
  if (s === 'transgender' || s === 'trans' || s === 'other') return 'Transgender';
  return g; // unknown value — pass through as-is (may not match a radio option)
}

// Normalise a blood group onto O.blood. Note those options spell negatives with
// a UNICODE MINUS ('A−', U+2212), while the registration collection stores an
// ASCII hyphen ('A-'), so without this swap a select would never match.
function normalizeBloodGroup(b) {
  if (!b) return undefined;
  const s = String(b).trim().toUpperCase().replace(/\s+/g, '').replace(/-/g, '−');
  return O.blood.includes(s) ? s : undefined;
}

// Normalise marital status onto O.marital (case-insensitive match).
function normalizeMarital(m) {
  if (!m) return undefined;
  const s = String(m).trim().toLowerCase();
  return O.marital.find(opt => opt.toLowerCase() === s);
}

// 'YYYY-MM-DD' for an <input type="date">. The registration collection stores
// date_of_birth as that string already, but tolerate an ISO datetime too.
function normalizeDob(d) {
  if (!d) return undefined;
  const s = String(d).trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined;
}

// Map a patient-profile payload onto this module's flat formData keys — see
// getPatientDetails() in api/neuropsychiatryApi.js for the two shapes this
// accepts. `hmsId` is the human-readable patient code (e.g. NPSY-2026-0117)
// shown as the Patient ID. `age` arrives derived from the DOB, and `dob` itself
// is mapped so the Date of Birth field populates (it comes from `patient_users`;
// the shared fallback endpoint does not return one).
//
// `diagnosis` is intentionally NOT mapped — the tab has no registered-diagnosis
// field, and the clinical Dx fields (fFinalDx/sPrimaryDx) are the clinician's
// own conclusions from this workflow, not a prior dx. `family_history` is
// likewise skipped: familyHx/familyHxDetails are clinical psychiatric history,
// not the free-text line captured at registration.
function mapPatientDetails(d) {
  if (!d) return {};
  const out = {};
  if (d.patient_name) out.patientName = d.patient_name;
  if (d.hms_id) out.hmsId = d.hms_id;
  if (d.age !== undefined && d.age !== null && d.age !== '') out.age = d.age;
  const sex = normalizeSex(d.gender);
  if (sex) out.sex = sex;

  // From `patient_users` (this module's patient-profile endpoint) — absent when
  // the shared fallback endpoint answered instead.
  const dob = normalizeDob(d.date_of_birth);
  if (dob) out.dob = dob;
  if (d.phone_number) out.contact = String(d.phone_number);
  const blood = normalizeBloodGroup(d.blood_group);
  if (blood) out.bloodGroup = blood;
  const marital = normalizeMarital(d.marital_status);
  if (marital) out.maritalStatus = marital;
  if (d.address) out.address = d.address;
  if (d.occupation) out.occupation = d.occupation;

  return out;
}

export const O = {
  yesno: ['Yes', 'No'],
  yesnoNA: ['Yes', 'No', 'N/A'],
  yesNoUncertain: ['Yes', 'No', 'Uncertain'],
  present: ['Present', 'Absent'],
  posneg: ['Positive', 'Negative'],
  normalAbn: ['Normal', 'Abnormal', 'Not tested'],
  side: ['Right', 'Left'],
  sex: ['Male', 'Female', 'Transgender'],
  relationship: ['Spouse', 'Parent', 'Sibling', 'Child', 'Guardian', 'Friend', 'Other'],
  blood: ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−', 'Unknown'],
  marital: ['Single', 'Married', 'Cohabiting', 'Widowed', 'Divorced', 'Separated'],
  onset: ['Acute (hours–days)', 'Subacute (days–weeks)', 'Insidious (months–years)', 'Episodic', 'Chronic', 'Relapsing-remitting'],
  freq: ['OD', 'BD', 'TDS', 'QDS', 'PRN', 'Weekly', 'Fortnightly', 'Monthly', 'Other'],
  route: ['Oral', 'IV', 'IM', 'SC', 'Intranasal', 'Sublingual', 'Transdermal', 'Depot/LAI', 'Other'],
  compliance: ['Good', 'Partial', 'Poor', 'Non-adherent', 'Unknown'],
  outcome: ['Full response', 'Partial response', 'No response', 'Worsened', 'Remission', 'Relapse'],
  allergyType: ['Drug', 'Food', 'Environmental', 'Contrast dye', 'Latex', 'Other'],
  severity3: ['Mild', 'Moderate', 'Severe (anaphylaxis)'],
  smoking: ['Never', 'Former', 'Current'],
  alcohol: ['None', 'Social', 'Hazardous', 'Harmful', 'Dependent'],
  insight: ['Absent (Grade 1)', 'Partial (Grade 2–4)', 'Intellectual (Grade 5)', 'Good/True (Grade 6)'],
  riskLevel: ['None', 'Low', 'Moderate', 'High'],
  asa: ['I — Healthy', 'II — Mild systemic disease', 'III — Severe systemic disease', 'IV — Life-threatening', 'V — Moribund'],
  scale4: ['0 — Not at all', '1 — Several days', '2 — More than half the days', '3 — Nearly every day'],
  mhaStatus: ['Voluntary / Informal', 'Involuntary — assessment', 'Involuntary — treatment', 'Forensic order', 'Community treatment order'],
};

export const PROC_CATEGORIES = {
  'Neuromodulation — Non-invasive': ['Electroconvulsive Therapy (ECT)', 'Repetitive TMS (rTMS)', 'Transcranial Direct Current Stimulation (tDCS)', 'Magnetic Seizure Therapy (MST)'],
  'Neuromodulation — Device Programming': ['Deep Brain Stimulation (DBS) Programming', 'Vagus Nerve Stimulation (VNS) Programming'],
  'Pharmacological / Infusion': ['Ketamine / Esketamine Therapy', 'Amytal (Narcoanalysis) Interview'],
  'Diagnostic': ['Electroencephalography (EEG)', 'Lumbar Puncture (CSF Biomarkers)', 'Polysomnography (Sleep Study)', 'Neuropsychological Assessment Battery'],
};

export const NeuropsychiatryProvider = ({
  children,
  patientId = '',
  doctorId = '',
  hospitalId = '',
  // Which record sections this provider owns/hydrates. The main workflow uses
  // the 9 clinical sections (default); the standalone Procedure entry passes
  // PROCEDURE_SECTIONS so it only hydrates/attaches the "procedure" section.
  sections = WORKFLOW_SECTIONS,
}) => {
  // patientId is seeded from the prop so the Patient Info tab shows the real id
  // immediately (replaces the old 'NPSY-2026-0117' mock). `hmsId` holds the
  // human-readable patient code shown as the Patient ID — seeded with the prop
  // id as a fallback and replaced by the real hms_id from get-patient-info.
  // Doctor-name fields start as placeholders and are autopopulated on mount.
  const [formData, setFormData] = useState(() => ({
    patientId: patientId || '',
    hmsId: patientId || '',
    referringDoctor: DOCTOR_PLACEHOLDER,
    operator: DOCTOR_PLACEHOLDER,
    surgSurgeon: DOCTOR_PLACEHOLDER,
    sConsultant: DOCTOR_PLACEHOLDER,
  }));

  // Record lifecycle / status.
  const [recordId, setRecordId] = useState(null);
  const [status, setStatus] = useState(null); // "Active" | "Completed" | null
  const [loading, setLoading] = useState(!!patientId); // hydrating existing case
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  // Nested procedures→sessions map, keyed by procedure slug (ect, rtms, …). The
  // Procedure entry reads/mutates this; the main workflow leaves it untouched.
  const [procedures, setProcedures] = useState({});

  // Psychotherapy / CBT session list (same sessions model as procedures, but a
  // single flat list — psychotherapy is one activity, not many types). The
  // workflow's Psychotherapy tab reads/appends to this.
  const [psychotherapySessions, setPsychotherapySessions] = useState([]);

  // Mental state examination list (same sessions model again). An MSE is repeated
  // at every review and read as a series, so the MSE tab appends to this rather
  // than overwriting one section.
  const [mseSessions, setMseSessions] = useState([]);

  // Baseline investigation panels (same sessions model again). Vitals, scales and
  // labs are repeated on a monitoring schedule and read as a trend, so the
  // Baseline tab appends a panel rather than overwriting one section.
  const [baselineSessions, setBaselineSessions] = useState([]);

  // Refs mirror the latest values so the async save methods never read stale
  // closures (e.g. saving a second tab right after the record was created).
  const formDataRef = useRef(formData);
  const recordIdRef = useRef(recordId);
  useEffect(() => { formDataRef.current = formData; }, [formData]);
  useEffect(() => { recordIdRef.current = recordId; }, [recordId]);

  // ── Live field registry (voice dictation) ─────────────────────────────────
  // Every FormField reports its own spec here while it is mounted, so the
  // dictation box can tell the backend exactly which keys, types and option
  // lists are on screen right now. The JSX forms therefore stay the single
  // source of truth — no field schema is duplicated anywhere for the LLM.
  //
  // Held in a ref rather than state on purpose: ~55 fields register at once
  // whenever the procedure type changes, and registration must not re-render.
  const fieldSpecsRef = useRef(new Map());

  // Returns its own cleanup, so a FormField can just `useEffect(() =>
  // registerField(spec), [signature])`.
  const registerField = useCallback((spec) => {
    if (!spec || !spec.k) return undefined;
    fieldSpecsRef.current.set(spec.k, spec);
    return () => { fieldSpecsRef.current.delete(spec.k); };
  }, []);

  /** Snapshot of every field currently rendered, for the dictation prompt. */
  const getFieldSpecs = useCallback(
    () => Array.from(fieldSpecsRef.current.values()),
    []
  );

  const runCalculations = useCallback((data) => {
    const updated = { ...data };

    // Calculate Age from DOB. Measured against TODAY — this used to compare
    // against a hardcoded date, which was harmless while DOB was always blank
    // but would have frozen (then drifted) every patient's age now that the DOB
    // autopopulates from the registration record.
    if (updated.dob) {
      const b = new Date(updated.dob);
      const t = new Date();
      let a = t.getFullYear() - b.getFullYear();
      const m = t.getMonth() - b.getMonth();
      if (m < 0 || (m === 0 && t.getDate() < b.getDate())) a--;
      if (!isNaN(a) && a >= 0) updated.age = a;
    }

    // Calculate Procedure Duration
    if (updated.procStart && updated.procEnd) {
      const [h1, m1] = updated.procStart.split(':').map(Number);
      const [h2, m2] = updated.procEnd.split(':').map(Number);
      let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (mins < 0) mins += 1440;
      updated.procDuration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
    }

    // Calculate Surgery Duration
    if (updated.surgStart && updated.surgEnd) {
      const [h1, m1] = updated.surgStart.split(':').map(Number);
      const [h2, m2] = updated.surgEnd.split(':').map(Number);
      let mins = (h2 * 60 + m2) - (h1 * 60 + m1);
      if (mins < 0) mins += 1440;
      updated.surgDuration = `${Math.floor(mins / 60)}h ${mins % 60}m`;
    }

    // Calculate PHQ-9 Total
    const phqKeys = ['phq1', 'phq2', 'phq3', 'phq4', 'phq5', 'phq6', 'phq7', 'phq8', 'phq9'];
    let phqTot = 0, phqAny = false;
    const firstInt = (s) => { const match = String(s || '').match(/-?\d+/); return match ? parseInt(match[0]) : null; };
    phqKeys.forEach(k => {
      const val = firstInt(updated[k]);
      if (val !== null) { phqTot += val; phqAny = true; }
    });
    if (phqAny) {
      updated.phqTotal = phqTot;
      updated.phqSeverity = phqTot <= 4 ? 'Minimal (0–4)' : phqTot <= 9 ? 'Mild (5–9)' : phqTot <= 14 ? 'Moderate (10–14)' : phqTot <= 19 ? 'Moderately severe (15–19)' : 'Severe (20–27)';
    }

    // Calculate GAD-7 Total
    const gadKeys = ['gad1', 'gad2', 'gad3', 'gad4', 'gad5', 'gad6', 'gad7'];
    let gadTot = 0, gadAny = false;
    gadKeys.forEach(k => {
      const val = firstInt(updated[k]);
      if (val !== null) { gadTot += val; gadAny = true; }
    });
    if (gadAny) {
      updated.gadTotal = gadTot;
      updated.gadSeverity = gadTot <= 4 ? 'Minimal (0–4)' : gadTot <= 9 ? 'Mild (5–9)' : gadTot <= 14 ? 'Moderate (10–14)' : 'Severe (15–21)';
    }

    // ── Auto-populate representative benchmark numbers from Clinical Impressions ─
    // When a conversation yields a severity band (or the user selects an impression),
    // populate the standard scale number input with the benchmark midpoint if empty
    // or holding an auto-calculated midpoint.
    const CBT_IMPRESSION_MIDPOINTS = {
      cbtMoodImpression: {
        target: 'cbtPhq9',
        map: { 'minimal': 2, 'mild': 7, 'moderate': 12, 'moderately severe': 17, 'severe': 24 },
      },
      cbtAnxietyImpression: {
        target: 'cbtGad7',
        map: { 'minimal': 2, 'mild': 7, 'moderate': 12, 'severe': 18 },
      },
      cbtOcdImpression: {
        target: 'cbtYbocs',
        map: { 'subclinical': 4, 'none': 4, 'mild': 11, 'moderate': 20, 'severe': 28, 'extreme': 36 },
      },
      cbtDistressImpression: {
        target: 'cbtPreSuds',
        map: { 'none': 10, 'minimal': 10, 'mild': 38, 'moderate': 63, 'high': 83, 'extreme': 95 },
      },
    };

    const MSE_IMPRESSION_MIDPOINTS = {
      cogImpression: {
        target: 'mmse',
        map: { 'normal': 29, 'borderline': 25, 'mild': 21, 'moderate': 14, 'severe': 5 },
      },
      execImpression: {
        target: 'fab',
        map: { 'normal': 17, 'borderline': 15, 'mild': 13, 'moderate': 10, 'severe': 4 },
      },
      dyskinesiaImpression: {
        target: 'aims',
        map: { 'normal': 0, 'borderline': 3, 'mild': 7, 'moderate': 13, 'severe': 23 },
      },
      akathisiaImpression: {
        target: 'basAkathisia',
        map: { 'normal': 0, 'borderline': 2, 'mild': 5, 'moderate': 8, 'severe': 12 },
      },
      parkinsonismImpression: {
        target: 'simpson',
        map: { 'normal': 1, 'borderline': 4, 'mild': 8, 'moderate': 15, 'severe': 30 },
      },
    };

    for (const [impKey, { target, map }] of Object.entries(CBT_IMPRESSION_MIDPOINTS)) {
      if (updated[impKey]) {
        const norm = String(updated[impKey]).toLowerCase().trim();
        const score = map[norm];
        if (score !== undefined) {
          const cur = updated[target];
          const midpoints = new Set(Object.values(map));
          if (cur === '' || cur === null || cur === undefined || midpoints.has(Number(cur))) {
            updated[target] = score;
          }
        }
      }
    }

    for (const [impKey, { target, map }] of Object.entries(MSE_IMPRESSION_MIDPOINTS)) {
      if (updated[impKey]) {
        const norm = String(updated[impKey]).toLowerCase().trim();
        const score = map[norm];
        if (score !== undefined) {
          const cur = updated[target];
          const midpoints = new Set(Object.values(map));
          if (cur === '' || cur === null || cur === undefined || midpoints.has(Number(cur))) {
            updated[target] = score;
          }
        }
      }
    }

    if (updated.cbtReliefImpression) {
      const relief = String(updated.cbtReliefImpression || '').toLowerCase().trim();
      const pre = Number(updated.cbtPreSuds) || (updated.cbtDistressImpression ? (CBT_IMPRESSION_MIDPOINTS.cbtDistressImpression.map[String(updated.cbtDistressImpression).toLowerCase().trim()] || 60) : 60);
      const postMidpoints = new Set([
        pre + 15, pre,
        Math.max(0, pre - 10), Math.max(0, pre - 15), Math.max(0, pre - 25), Math.max(0, pre - 35), Math.max(0, pre - 45), Math.max(0, pre - 55),
        0, 10, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80,
      ]);
      const curPost = updated.cbtPostSuds;
      if (curPost === '' || curPost === null || curPost === undefined || postMidpoints.has(Number(curPost))) {
        if (relief.includes('worsened') || relief.includes('worse') || relief.includes('no relief')) {
          updated.cbtPostSuds = Math.min(100, pre + 10);
        } else if (relief.includes('no change')) {
          updated.cbtPostSuds = pre;
        } else if (relief.includes('little') || relief.includes('minimal')) {
          updated.cbtPostSuds = Math.max(0, pre - 10);
        } else if (relief.includes('some') || relief.includes('moderate')) {
          updated.cbtPostSuds = Math.max(0, pre - 25);
        } else if (relief.includes('good')) {
          updated.cbtPostSuds = Math.max(0, pre - 35);
        } else if (relief.includes('strong') || relief.includes('marked')) {
          updated.cbtPostSuds = Math.max(0, pre - 50);
        }
      }
    }

    for (const [impKey, { target, map }] of Object.entries(MSE_IMPRESSION_MIDPOINTS)) {
      if (updated[impKey]) {
        const norm = String(updated[impKey]).toLowerCase().trim();
        const score = map[norm];
        if (score !== undefined) {
          const cur = updated[target];
          const midpoints = new Set(Object.values(map));
          if (cur === '' || cur === null || cur === undefined || midpoints.has(Number(cur))) {
            updated[target] = score;
          }
        }
      }
    }

    return updated;
  }, []);

  // ── Hydrate an existing case + autopopulate doctor name & patient info ──────
  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (!patientId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        // 1) Resume the patient's latest record, if any, into this provider's
        //    owned sections.
        const record = await getLatestRecord(patientId);
        if (cancelled) return;
        if (record) {
          setRecordId(record.record_id || null);
          setStatus(record.status || null);
          setProcedures(record.procedures || {});
          setPsychotherapySessions(record.psychotherapySessions || []);
          setMseSessions(record.mseSessions || []);
          setBaselineSessions(record.baselineSessions || []);
          const flat = hydrateFromRecord(record, sections);
          setFormData(prev => {
            const merged = { ...prev, ...flat };
            // The prop is authoritative for the displayed patient id.
            if (patientId) merged.patientId = patientId;
            return runCalculations(merged);
          });
        }

        // 2) Autopopulate from the shared HMS profiles — the logged-in
        //    doctor's name, patient's demographics, and central patient summary
        //    fetched concurrently. Each only fills fields the resumed record left
        //    empty, so a saved value always wins.
        const [docName, patientDetails, patientSummary] = await Promise.all([
          getDoctorName(doctorId),
          getPatientDetails(patientId),
          getPatientSummary(patientId),
        ]);
        if (cancelled) return;

        const patientFields = mapPatientDetails(patientDetails);
        if (!docName && Object.keys(patientFields).length === 0 && !patientSummary) return;

        setFormData(prev => {
          const next = { ...prev };
          // Doctor-name fields: fill placeholder/empty only.
          if (docName) {
            for (const f of DOCTOR_NAME_FIELDS) {
              if (!next[f] || next[f] === DOCTOR_PLACEHOLDER) next[f] = docName;
            }
          }
          // The human-readable HMS id always replaces the sys-id fallback we
          // seeded into `hmsId`.
          if (patientFields.hmsId) next.hmsId = patientFields.hmsId;
          // Other demographics (name, age, sex): fill blanks only, so a
          // resumed/saved value always wins over the profile lookup.
          for (const [k, v] of Object.entries(patientFields)) {
            if (k === 'hmsId') continue;
            if (next[k] === undefined || next[k] === null || next[k] === '') {
              next[k] = v;
            }
          }
          // Clinical Summary: fill from global patient summary if blank
          if (patientSummary && (next.sClinical === undefined || next.sClinical === null || next.sClinical === '')) {
            const formattedSummary = formatPatientSummary(patientSummary);
            if (formattedSummary) {
              next.sClinical = formattedSummary;
              console.log('[NeuropsychiatryContext] Auto-populated sClinical from global patient summary:', formattedSummary);
            }
          }
          // Recompute derived fields (durations, PHQ-9/GAD-7, and age — now that
          // a DOB is autopopulated, age is re-derived from it against today's
          // date, which supersedes the age the profile lookup supplied).
          return runCalculations(next);
        });
      } catch (e) {
        if (!cancelled) setError(e.message || 'Failed to load case');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    hydrate();
    return () => {
      cancelled = true;
    };
  }, [patientId, doctorId, sections, runCalculations]);

  const updateField = useCallback((key, value) => {
    setFormData(prev => {
      const next = { ...prev, [key]: value };
      return runCalculations(next);
    });
  }, [runCalculations]);

  /**
   * Merge a validated {fieldKey: value} object from voice dictation into the
   * form, then re-run the calculated fields (duration, scores, …).
   *
   * `overwrite: false` leaves anything the doctor already answered untouched.
   * Returns { applied, skipped } so the dictation box can report what landed.
   *
   * Computed against formDataRef and written back to it SYNCHRONOUSLY rather
   * than inside a setFormData updater: the updater is deferred (and runs twice
   * under StrictMode), which would both double-count the report and hide the
   * first pass's values from the second pass of a two-pass autofill.
   */
  const applyDictatedData = useCallback((incoming, { overwrite = true } = {}) => {
    const applied = [];
    const skipped = [];
    const next = { ...formDataRef.current };

    for (const [key, value] of Object.entries(incoming || {})) {
      const current = next[key];
      const filled = Array.isArray(current)
        ? current.length > 0
        : current !== '' && current !== null && current !== undefined;
      if (filled && !overwrite) {
        skipped.push(key);
        continue;
      }
      next[key] = value;
      applied.push(key);
    }

    if (applied.length) {
      const calculated = runCalculations(next);
      formDataRef.current = calculated;
      setFormData(calculated);
    }
    return { applied, skipped };
  }, [runCalculations]);

  const updateArrayField = useCallback((arrayKey, index, itemKey, itemValue) => {
    setFormData(prev => {
      const arr = [...(prev[arrayKey] || [])];
      if (!arr[index]) arr[index] = {};
      arr[index] = { ...arr[index], [itemKey]: itemValue };
      const next = { ...prev, [arrayKey]: arr };
      return runCalculations(next);
    });
  }, [runCalculations]);

  const addArrayRow = useCallback((arrayKey, defaultObj = {}) => {
    setFormData(prev => {
      const arr = [...(prev[arrayKey] || []), defaultObj];
      const next = { ...prev, [arrayKey]: arr };
      return runCalculations(next);
    });
  }, [runCalculations]);

  const removeArrayRow = useCallback((arrayKey, index) => {
    setFormData(prev => {
      const arr = [...(prev[arrayKey] || [])];
      arr.splice(index, 1);
      const next = { ...prev, [arrayKey]: arr };
      return runCalculations(next);
    });
  }, [runCalculations]);

  // ── Save a single tab ───────────────────────────────────────────────────────
  // Patient Info's first save creates the record (status "Active"); every other
  // tab (and any re-save of Patient Info) writes its section onto that record.
  // Procedures do NOT use this path — they append sessions via
  // saveProcedureSession below. Returns { ok, created?, error? }.
  const saveTab = useCallback(async (tabId) => {
    const { section, data } = extractSectionData(tabId, formDataRef.current);
    if (!section) return { ok: false, error: `Unknown tab: ${tabId}` };

    setSaving(true);
    setError(null);
    try {
      // First save of Patient Info with no record yet → create the case.
      if (section === 'patient' && !recordIdRef.current) {
        if (!patientId || !doctorId) {
          throw new Error('Missing patient or doctor id — cannot create the case.');
        }
        const res = await createRecord({ patientId, doctorId, hospitalId, data });
        recordIdRef.current = res.record_id;
        setRecordId(res.record_id);
        setStatus('Active');
        return { ok: true, created: true };
      }

      // Any other section requires an existing record.
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      await saveSection(recordIdRef.current, section, data);
      return { ok: true, created: false };
    } catch (e) {
      const msg = e.message || `Failed to save ${section}`;
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, [patientId, doctorId, hospitalId]);

  // ── Complete the record ──────────────────────────────────────────────────────
  // Summary tab "Save Full Record": persists the summary section and flips the
  // case to "Completed" in one atomic backend call. Returns { ok, error? }.
  const completeFullRecord = useCallback(async () => {
    setSaving(true);
    setError(null);
    try {
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      const { data } = extractSectionData('summary', formDataRef.current);
      await completeRecord(recordIdRef.current, data);
      setStatus('Completed');
      return { ok: true };
    } catch (e) {
      const msg = e.message || 'Failed to complete record';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Save / delete a procedure session ────────────────────────────────────────
  // A procedure session is appended (no sessionId) or updated in place (with a
  // sessionId). Both attach to the patient's existing record and replace the
  // local `procedures` map with the full one the backend returns.
  // Returns { ok, created?, error? }.
  const saveProcedureSession = useCallback(
    async ({ slug, type, category, data, sessionId }) => {
      setSaving(true);
      setError(null);
      try {
        if (!recordIdRef.current) {
          throw new Error('Create the case from the Patient Info tab first.');
        }
        const payload = { type, category, data };
        const res = sessionId
          ? await apiUpdateProcedureSession(recordIdRef.current, slug, sessionId, payload)
          : await apiAddProcedureSession(recordIdRef.current, slug, payload);
        if (res?.procedures) setProcedures(res.procedures);
        return { ok: true, created: !sessionId };
      } catch (e) {
        const msg = e.message || 'Failed to save procedure session';
        setError(msg);
        return { ok: false, error: msg };
      } finally {
        setSaving(false);
      }
    },
    []
  );

  // Delete a single session from a procedure. Returns { ok, error? }.
  const deleteProcedureSession = useCallback(async (slug, sessionId) => {
    setSaving(true);
    setError(null);
    try {
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      const res = await apiDeleteProcedureSession(recordIdRef.current, slug, sessionId);
      if (res?.procedures) setProcedures(res.procedures);
      return { ok: true };
    } catch (e) {
      const msg = e.message || 'Failed to delete procedure session';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Save / delete a psychotherapy (CBT) session ──────────────────────────────
  // Same logic as the procedure sessions: the Psychotherapy tab's Save APPENDS a
  // session (no sessionId) so a course of therapy accumulates instead of each
  // save overwriting the last one; passing a sessionId updates that session in
  // place. Both replace the local list with the full one the backend returns.
  // Returns { ok, created?, sessionNo?, error? }.
  const savePsychotherapySession = useCallback(async ({ data, sessionId }) => {
    setSaving(true);
    setError(null);
    try {
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      const payload = { data };
      const res = sessionId
        ? await apiUpdatePsychotherapySession(recordIdRef.current, sessionId, payload)
        : await apiAddPsychotherapySession(recordIdRef.current, payload);
      const list = res?.psychotherapy_sessions;
      if (Array.isArray(list)) setPsychotherapySessions(list);
      return {
        ok: true,
        created: !sessionId,
        sessionNo: Array.isArray(list) ? list.length : undefined,
      };
    } catch (e) {
      const msg = e.message || 'Failed to save psychotherapy session';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  // Delete a single psychotherapy session. Returns { ok, error? }.
  const deletePsychotherapySession = useCallback(async (sessionId) => {
    setSaving(true);
    setError(null);
    try {
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      const res = await apiDeletePsychotherapySession(recordIdRef.current, sessionId);
      const list = res?.psychotherapy_sessions;
      if (Array.isArray(list)) setPsychotherapySessions(list);
      return { ok: true };
    } catch (e) {
      const msg = e.message || 'Failed to delete psychotherapy session';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Save / delete a mental state examination ─────────────────────────────────
  // Third tab on the sessions model: the MSE tab's Save APPENDS an examination
  // (no sessionId) so the series accumulates instead of each save overwriting the
  // last; passing a sessionId updates that examination in place. Both replace the
  // local list with the full one the backend returns.
  // Returns { ok, created?, sessionNo?, error? }.
  const saveMseSession = useCallback(async ({ data, sessionId }) => {
    setSaving(true);
    setError(null);
    try {
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      const payload = { data };
      const res = sessionId
        ? await apiUpdateMseSession(recordIdRef.current, sessionId, payload)
        : await apiAddMseSession(recordIdRef.current, payload);
      const list = res?.mse_sessions;
      if (Array.isArray(list)) setMseSessions(list);
      return {
        ok: true,
        created: !sessionId,
        sessionNo: Array.isArray(list) ? list.length : undefined,
      };
    } catch (e) {
      const msg = e.message || 'Failed to save mental state examination';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  // Delete a single examination. Returns { ok, error? }.
  const deleteMseSession = useCallback(async (sessionId) => {
    setSaving(true);
    setError(null);
    try {
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      const res = await apiDeleteMseSession(recordIdRef.current, sessionId);
      const list = res?.mse_sessions;
      if (Array.isArray(list)) setMseSessions(list);
      return { ok: true };
    } catch (e) {
      const msg = e.message || 'Failed to delete mental state examination';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  // ── Save / delete a baseline investigation panel ───────────────────────
  // Fourth tab on the sessions model: the Baseline tab's Save APPENDS a panel of
  // vitals / scales / labs (no sessionId) so the monitoring trend accumulates;
  // passing a sessionId updates that panel in place. Both replace the local list
  // with the full one the backend returns.
  // Returns { ok, created?, sessionNo?, error? }.
  const saveBaselineSession = useCallback(async ({ data, sessionId }) => {
    setSaving(true);
    setError(null);
    try {
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      const payload = { data };
      const res = sessionId
        ? await apiUpdateBaselineSession(recordIdRef.current, sessionId, payload)
        : await apiAddBaselineSession(recordIdRef.current, payload);
      const list = res?.baseline_sessions;
      if (Array.isArray(list)) setBaselineSessions(list);
      return {
        ok: true,
        created: !sessionId,
        sessionNo: Array.isArray(list) ? list.length : undefined,
      };
    } catch (e) {
      const msg = e.message || 'Failed to save baseline investigations';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  // Delete a single baseline panel. Returns { ok, error? }.
  const deleteBaselineSession = useCallback(async (sessionId) => {
    setSaving(true);
    setError(null);
    try {
      if (!recordIdRef.current) {
        throw new Error('Create the case from the Patient Info tab first.');
      }
      const res = await apiDeleteBaselineSession(recordIdRef.current, sessionId);
      const list = res?.baseline_sessions;
      if (Array.isArray(list)) setBaselineSessions(list);
      return { ok: true };
    } catch (e) {
      const msg = e.message || 'Failed to delete baseline investigations';
      setError(msg);
      return { ok: false, error: msg };
    } finally {
      setSaving(false);
    }
  }, []);

  return (
    <NeuropsychiatryContext.Provider
      value={{
        formData,
        setFormData,
        updateField,
        updateArrayField,
        addArrayRow,
        removeArrayRow,
        // voice dictation: live field registry + validated bulk merge
        registerField,
        getFieldSpecs,
        applyDictatedData,
        // identifiers
        patientId,
        doctorId,
        hospitalId,
        // record lifecycle
        recordId,
        status,
        loading,
        saving,
        error,
        // procedures (nested sessions model)
        procedures,
        // psychotherapy / CBT sessions (same sessions model)
        psychotherapySessions,
        // mental state examinations (same sessions model)
        mseSessions,
        // baseline investigation panels (same sessions model)
        baselineSessions,
        // actions
        saveTab,
        completeFullRecord,
        saveProcedureSession,
        deleteProcedureSession,
        savePsychotherapySession,
        deletePsychotherapySession,
        saveMseSession,
        deleteMseSession,
        saveBaselineSession,
        deleteBaselineSession,
      }}
    >
      {children}
    </NeuropsychiatryContext.Provider>
  );
};

export const useNeuropsychiatry = () => {
  const ctx = useContext(NeuropsychiatryContext);
  if (!ctx) throw new Error('useNeuropsychiatry must be used within NeuropsychiatryProvider');
  return ctx;
};
