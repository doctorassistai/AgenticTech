import React, { createContext, useContext, useState, useRef, useCallback } from "react";
import {
  createPulmonologyRecord,
  addPulmProcedureSession,
  updatePulmProcedureSession,
  deletePulmProcedureSession,
  addPulmScreeningSession,
  updatePulmScreeningSession,
  deletePulmScreeningSession,
} from "../services/pulmonologyApi";

// 1. Create the React Context instance
export const PulmonologyContext = createContext(null);

export const PulmonologyProvider = ({
  children,
  initialPatientId = "",
  initialDoctorId = "",
}) => {
  // Master Patient & Doctor identifiers
  const [patientId, setPatientId] = useState(initialPatientId);
  const [doctorId, setDoctorId] = useState(initialDoctorId);

  // Active track: 'onboarding', 'baseline', 'screening', 'diagnostics', 'airway', 'advanced', 'discharge'
  const [track, setTrack] = useState("onboarding");

  // Currently selected tab ID within the active track or procedure guide
  const [activeTab, setActiveTab] = useState("onboarding");

  // Macro-level treatment plan ID
  const [treatmentPlanId, setTreatmentPlanId] = useState("");

  // Discrete encounter/session ID
  const [sessionId, setSessionId] = useState("");

  // Encounter status: 'active' | 'pending_discharge' | 'completed'
  const [sessionStatus, setSessionStatus] = useState("active");

  // Longitudinal Pulmonology Record ID & Nested Models
  const [recordId, setRecordId] = useState("");
  const recordIdRef = useRef("");
  const [procedures, setProcedures] = useState({});
  const [screeningSessions, setScreeningSessions] = useState([]);
  const [isSavingProcedure, setIsSavingProcedure] = useState(false);
  const [procedureFeedback, setProcedureFeedback] = useState(null);

  const updateRecordId = useCallback((id) => {
    recordIdRef.current = id || "";
    setRecordId(id || "");
  }, []);

  // Stores all user inputs across all tabs for the active session (key-value pairs)
  const [formData, setFormData] = useState({});

  // Past sessions for the current patient (used to render historical flowsheet tables)
  const [historicalSessions, setHistoricalSessions] = useState([]);

  // Registry of FormFields currently mounted on screen (dynamic voice dictation target)
  const fieldSpecsRef = useRef(new Map());

  const registerField = useCallback((spec) => {
    if (!spec || (!spec.name && !spec.k)) return undefined;
    const key = spec.name || spec.k;
    fieldSpecsRef.current.set(key, { ...spec, k: key });
    return () => {
      fieldSpecsRef.current.delete(key);
    };
  }, []);

  const getFieldSpecs = useCallback(
    () => Array.from(fieldSpecsRef.current.values()),
    []
  );

  const applyDictatedData = useCallback((incomingData, { overwrite = true } = {}) => {
    if (!incomingData || typeof incomingData !== "object") return { applied: [], skipped: [] };
    const applied = [];
    const skipped = [];

    const SYMPTOM_LOOKUP = {
      dyspnea_exertional: ["dyspnea_exertional", "dyspnea (exertional)", "exertional dyspnea", "exertional", "shortness of breath on exertion", "exertional shortness of breath"],
      dyspnea_rest: ["dyspnea_rest", "dyspnea (at rest)", "dyspnea at rest", "shortness of breath at rest", "resting dyspnea"],
      chronic_cough: ["chronic_cough", "chronic cough", "cough", "coughing"],
      sputum_production: ["sputum_production", "sputum production", "sputum", "phlegm", "mucus"],
      wheezing: ["wheezing", "wheeze", "wheezes"],
      chest_tightness: ["chest_tightness", "chest tightness", "tight chest", "tightness in chest"],
      hemoptysis: ["hemoptysis", "coughing blood", "blood in sputum"],
      orthopnea: ["orthopnea"],
      pnd: ["pnd", "paroxysmal nocturnal dyspnea"],
      daytime_somnolence: ["daytime_somnolence", "daytime somnolence", "daytime sleepiness", "somnolence"],
      snoring: ["snoring", "sleep apnea"],
      fatigue: ["fatigue", "tiredness", "exhaustion"],
      weight_loss: ["weight_loss", "weight loss"],
    };

    const MED_LOOKUP = {
      saba: ["saba", "saba (albuterol)", "albuterol", "salbutamol", "proair", "ventolin"],
      sama: ["sama", "sama (ipratropium)", "ipratropium", "atrovent"],
      ics: ["ics", "ics (fluticasone, etc.)", "fluticasone", "budesonide", "flovent", "pulmicort", "inhaled steroid"],
      laba: ["laba", "laba (salmeterol, etc.)", "salmeterol", "formoterol", "serevent"],
      lama: ["lama", "lama (tiotropium, etc.)", "tiotropium", "spiriva", "incruse"],
      triple_therapy: ["triple_therapy", "triple therapy", "triple therapy (ics/lama/laba)", "trelegy", "breztri"],
      oral_steroids: ["oral_steroids", "oral corticosteroids", "oral steroids", "prednisone", "methylprednisolone"],
      biologics: ["biologics", "biologics (omalizumab, etc.)", "omalizumab", "xolair", "dupilumab", "dupixent", "nucala", "fasenra"],
      macrolides: ["macrolides", "macrolides (azithromycin)", "azithromycin"],
      pde4_inhibitor: ["pde4_inhibitor", "phosphodiesterase-4 inhibitor", "roflumilast", "daliresp", "pde4"],
      home_oxygen: ["home_oxygen", "home oxygen", "supplemental oxygen", "nasal cannula oxygen", "home o2"],
    };

    const normalizeChecklist = (rawVal, mapObj) => {
      const result = {};
      if (!rawVal) return result;
      const candidates = [];
      if (Array.isArray(rawVal)) {
        candidates.push(...rawVal);
      } else if (typeof rawVal === "object") {
        Object.entries(rawVal).forEach(([k, v]) => {
          if (v) candidates.push(k);
        });
      } else if (typeof rawVal === "string") {
        candidates.push(...rawVal.split(/[,;\n|]+/));
      }

      candidates.forEach((cand) => {
        const clean = String(cand).trim().toLowerCase();
        if (!clean) return;
        for (const [canonKey, aliases] of Object.entries(mapObj)) {
          if (aliases.some((alias) => clean === alias || clean.includes(alias) || alias.includes(clean))) {
            result[canonKey] = true;
          }
        }
      });
      return result;
    };

    setFormData((prev) => {
      const next = { ...prev };
      Object.entries(incomingData).forEach(([key, val]) => {
        if (val === undefined || val === null || val === "") return;

        if (key === "pulm_symptoms") {
          const mappedSyms = normalizeChecklist(val, SYMPTOM_LOOKUP);
          next.pulm_symptoms = { ...(prev.pulm_symptoms || {}), ...mappedSyms };
          applied.push("pulm_symptoms");
          return;
        }

        if (key === "pulm_meds") {
          const mappedMeds = normalizeChecklist(val, MED_LOOKUP);
          next.pulm_meds = { ...(prev.pulm_meds || {}), ...mappedMeds };
          applied.push("pulm_meds");
          return;
        }

        // Direct individual symptom or med keys
        for (const [symKey, aliases] of Object.entries(SYMPTOM_LOOKUP)) {
          if (aliases.includes(key.toLowerCase()) && (val === true || String(val).toLowerCase() === "yes" || String(val) === "1")) {
            next.pulm_symptoms = { ...(next.pulm_symptoms || prev.pulm_symptoms || {}), [symKey]: true };
            applied.push(`pulm_symptoms.${symKey}`);
            return;
          }
        }
        for (const [medKey, aliases] of Object.entries(MED_LOOKUP)) {
          if (aliases.includes(key.toLowerCase()) && (val === true || String(val).toLowerCase() === "yes" || String(val) === "1")) {
            next.pulm_meds = { ...(next.pulm_meds || prev.pulm_meds || {}), [medKey]: true };
            applied.push(`pulm_meds.${medKey}`);
            return;
          }
        }

        const currentVal = prev[key];
        const isEmpty = currentVal === undefined || currentVal === null || currentVal === "";
        if (overwrite || isEmpty) {
          next[key] = val;
          applied.push(key);
        } else {
          skipped.push(key);
        }
      });
      return next;
    });

    return { applied, skipped };
  }, []);

  // Helper to update a single form field in state
  const updateField = (key, value) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Helper to update multiple form fields at once (e.g. after loading or AI structuring)
  const updateFields = (newFieldsObj) => {
    if (!newFieldsObj || typeof newFieldsObj !== "object") return;
    setFormData((prev) => ({
      ...prev,
      ...newFieldsObj,
    }));
  };

  // Reset form data for a new session (Copy Forward method matching Nephrology)
  const resetSessionForm = () => {
    setFormData((prev) => {
      const copyForwardData = {};
      Object.keys(prev).forEach((key) => {
        // Wipe daily/acute fields that change per encounter
        if (
          key.startsWith("abg_") ||
          key.startsWith("niv_") ||
          key.startsWith("ct_") ||
          key.startsWith("proc_") ||
          key.startsWith("disp_") ||
          key.startsWith("pulm_triage_") ||
          key.startsWith("diag_ai_") ||
          key.startsWith("air_ai_")
        ) {
          // Do not copy
        } else {
          // Copy forward baseline and longitudinal patient data (pt_, smoking_, baseline_)
          copyForwardData[key] = prev[key];
        }
      });
      return copyForwardData;
    });
    setSessionStatus("active");
    setSessionId("");
  };

  const DEFAULT_TABS = {
    onboarding: "onboarding",
    baseline: "baseline",
    diagnostics: "diag_overview",
    screening: "diag_overview",
    airway: "assess",
    monitoring: "monitoring_care",
    discharge: "disp_master",
    intake: "onboarding",
  };

  // Switch tracks and reset active tab to the track's default tab
  const handleTrackChange = (newTrack) => {
    setTrack(newTrack);
    setActiveTab(DEFAULT_TABS[newTrack] || "onboarding");
  };

  // ── Save / Delete a Procedure Session (procedures.<slug>.sessions) ─────────
  const saveProcedureSession = useCallback(
    async ({ slug, type, category, notes, data, sessionId: targetSessionId }) => {
      setIsSavingProcedure(true);
      setProcedureFeedback(null);
      try {
        let activeRecId = recordIdRef.current;
        if (!activeRecId) {
          if (!patientId || !doctorId) {
            throw new Error("Missing patient or doctor id — cannot save procedure.");
          }
          const recRes = await createPulmonologyRecord({
            patient_id: patientId,
            doctor_id: doctorId,
            data: {},
          });
          activeRecId = recRes.record_id;
          updateRecordId(activeRecId);
        }

        let res;
        if (targetSessionId) {
          res = await updatePulmProcedureSession(activeRecId, slug, targetSessionId, {
            type,
            category,
            notes,
            data: data || formData,
          });
        } else {
          res = await addPulmProcedureSession(activeRecId, slug, {
            type,
            category,
            notes,
            data: data || formData,
          });
        }

        if (res?.procedures) {
          setProcedures(res.procedures);
        }
        const successMsg = `${type || "Procedure"} session saved successfully.`;
        setProcedureFeedback({ ok: true, text: successMsg });
        return { ok: true, procedures: res?.procedures };
      } catch (err) {
        console.error("Failed to save procedure session:", err);
        const errMsg = err.message || "Failed to save procedure session.";
        setProcedureFeedback({ ok: false, text: errMsg });
        return { ok: false, error: errMsg };
      } finally {
        setIsSavingProcedure(false);
      }
    },
    [patientId, doctorId, formData, updateRecordId]
  );

  const deleteProcedureSession = useCallback(
    async (slug, targetSessionId) => {
      if (!recordIdRef.current || !slug || !targetSessionId) return { ok: false };
      try {
        const res = await deletePulmProcedureSession(recordIdRef.current, slug, targetSessionId);
        if (res?.procedures) {
          setProcedures(res.procedures);
        }
        return { ok: true, procedures: res?.procedures };
      } catch (err) {
        console.error("Failed to delete procedure session:", err);
        return { ok: false, error: err.message };
      }
    },
    []
  );

  // ── Save / Delete a Screening Session (screeningSessions[]) ────────────────
  const saveScreeningSession = useCallback(
    async ({ type, screening_type, notes, data, sessionId: targetSessionId }) => {
      try {
        let activeRecId = recordIdRef.current;
        if (!activeRecId) {
          if (!patientId || !doctorId) {
            throw new Error("Missing patient or doctor id — cannot save screening assessment.");
          }
          const recRes = await createPulmonologyRecord({
            patient_id: patientId,
            doctor_id: doctorId,
            data: {},
          });
          activeRecId = recRes.record_id;
          updateRecordId(activeRecId);
        }

        let res;
        if (targetSessionId) {
          res = await updatePulmScreeningSession(activeRecId, targetSessionId, {
            type,
            screening_type,
            notes,
            data: data || formData,
          });
        } else {
          res = await addPulmScreeningSession(activeRecId, {
            type,
            screening_type,
            notes,
            data: data || formData,
          });
        }

        if (res?.screeningSessions) {
          setScreeningSessions(res.screeningSessions);
        }
        return { ok: true, screeningSessions: res?.screeningSessions };
      } catch (err) {
        console.error("Failed to save screening session:", err);
        return { ok: false, error: err.message };
      }
    },
    [patientId, doctorId, formData, updateRecordId]
  );

  const deleteScreeningSession = useCallback(
    async (targetSessionId) => {
      if (!recordIdRef.current || !targetSessionId) return { ok: false };
      try {
        const res = await deletePulmScreeningSession(recordIdRef.current, targetSessionId);
        if (res?.screeningSessions) {
          setScreeningSessions(res.screeningSessions);
        }
        return { ok: true, screeningSessions: res?.screeningSessions };
      } catch (err) {
        console.error("Failed to delete screening session:", err);
        return { ok: false, error: err.message };
      }
    },
    []
  );

  return (
    <PulmonologyContext.Provider
      value={{
        patientId,
        setPatientId,
        doctorId,
        setDoctorId,
        track,
        setTrack: handleTrackChange,
        activeTab,
        setActiveTab,
        treatmentPlanId,
        setTreatmentPlanId,
        sessionId,
        setSessionId,
        sessionStatus,
        setSessionStatus,
        recordId,
        setRecordId: updateRecordId,
        procedures,
        setProcedures,
        screeningSessions,
        setScreeningSessions,
        isSavingProcedure,
        procedureFeedback,
        setProcedureFeedback,
        saveProcedureSession,
        deleteProcedureSession,
        saveScreeningSession,
        deleteScreeningSession,
        formData,
        setFormData,
        historicalSessions,
        setHistoricalSessions,
        updateField,
        updateFields,
        resetSessionForm,
        registerField,
        getFieldSpecs,
        applyDictatedData,
      }}
    >
      {children}
    </PulmonologyContext.Provider>
  );
};

/**
 * Custom Hook: usePulmonology
 * Safely accesses PulmonologyContext values with a fallback if used outside Provider.
 */
export const usePulmonology = () => {
  const context = useContext(PulmonologyContext);
  if (!context) {
    return {
      patientId: "",
      setPatientId: () => {},
      doctorId: "",
      setDoctorId: () => {},
      track: "onboarding",
      setTrack: () => {},
      activeTab: "onboarding",
      setActiveTab: () => {},
      treatmentPlanId: "",
      setTreatmentPlanId: () => {},
      sessionId: "",
      setSessionId: () => {},
      sessionStatus: "active",
      setSessionStatus: () => {},
      recordId: "",
      setRecordId: () => {},
      procedures: {},
      setProcedures: () => {},
      screeningSessions: [],
      setScreeningSessions: () => {},
      isSavingProcedure: false,
      procedureFeedback: null,
      setProcedureFeedback: () => {},
      saveProcedureSession: async () => ({ ok: false }),
      deleteProcedureSession: async () => ({ ok: false }),
      saveScreeningSession: async () => ({ ok: false }),
      deleteScreeningSession: async () => ({ ok: false }),
      formData: {},
      setFormData: () => {},
      historicalSessions: [],
      setHistoricalSessions: () => {},
      updateField: () => {},
      updateFields: () => {},
      resetSessionForm: () => {},
      registerField: () => () => {},
      getFieldSpecs: () => [],
      applyDictatedData: () => ({ applied: [], skipped: [] }),
    };
  }
  return context;
};
