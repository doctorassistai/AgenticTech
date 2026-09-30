import React, { useState, useEffect, useRef } from "react";
import { PulmonologyProvider, usePulmonology } from "./context/PulmonologyContext";
import TrackSelector from "./components/TrackSelector";
import {
  getPatientProfile,
  getLatestPulmonologyRecord,
  createPulmonologyRecord,
  savePulmonologyRecordSection,
  completePulmonologyRecord,
  saveTrackSession,
  updateTrackSession,
  getTrackSession,
  updateSessionStatus,
  getPatientSessions,
  getDoctorDetails,
} from "./services/pulmonologyApi";

// Intake Tabs
import OnboardingTab from "./tabs/intake/OnboardingDemographics";
import BaselineTab from "./tabs/intake/ClinicalBaselineVitals";
import ScreeningAlertsTab from "./tabs/intake/ScreeningAlerts";

// Diagnostics (Workup, Imaging & Biomarkers)
import DiagnosticsOverviewTab from "./tabs/diagnostics/DiagnosticsOverviewTab";
import ChestImagingGuide from "./tabs/diagnostics/ChestImagingGuide";
import BiomarkersMicrobiologyTab from "./tabs/diagnostics/BiomarkersMicrobiologyTab";

// Airway Management (Medical Therapy)
import AssessmentTab from "./tabs/airway/PulmonaryAssessment";
import MedicationsTab from "./tabs/airway/MedicationsDosing";
import AirwaySupportTab from "./tabs/airway/AirwaySupportTab";
import CarePlanTab from "./tabs/airway/CarePlan";

// Longitudinal Transplant Workup & Escalation
import TransplantWorkup from "./tabs/advanced/TransplantWorkup";

// Monitoring & Discharge
import PostProcedureMonitoringTab from "./tabs/monitoring/PostProcedureMonitoringTab";
import DispositionMasterTab from "./tabs/discharge/DispositionMasterTab";

const NAV = {
  screening: [
    { id: "diag_overview", label: "Diagnostics Hub & Status" },
    { id: "screen_alerts", label: "Screening & Clinical Alerts" },
    { id: "diag_imaging", label: "Chest Imaging (CXR / HRCT)" },
    { id: "diag_labs", label: "Biomarkers & Microbiology" },
  ],
  airway: [
    { id: "assess", label: "Pulmonary Assessment" },
    { id: "meds", label: "Medications & Dosing" },
    { id: "airway_support", label: "Oxygen & Airway Support" },
    { id: "plan", label: "Care Plan" },
  ],
};

const normalizeDateForInput = (value) => {
  if (!value) return "";
  const raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return "";
  return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
};

const mergeNonEmptyFields = (previous, incoming) => {
  const next = { ...previous };
  Object.entries(incoming || {}).forEach(([key, value]) => {
    const hasValue =
      value !== undefined &&
      value !== null &&
      (typeof value !== "string" || value.trim() !== "") &&
      (!Array.isArray(value) || value.length > 0) &&
      (typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 0);
    if (hasValue) next[key] = value;
  });
  return next;
};

const formatEncounterDate = (value) => {
  if (!value) return "Date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return date.toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const getEncounterLabel = (session, encounterNumber) => {
  const status = String(session.status || "active").replace("_", " ");
  return `Encounter ${encounterNumber} · ${formatEncounterDate(session.created_at)} · ${status}`;
};

const sortEncountersChronologically = (first, second) => {
  const firstTime = new Date(first.created_at || 0).getTime();
  const secondTime = new Date(second.created_at || 0).getTime();
  if (firstTime !== secondTime) return firstTime - secondTime;
  return String(first.session_id || "").localeCompare(String(second.session_id || ""));
};

const PulmonologyWorkflowInner = ({
  doctorId,
  patientId,
  treatmentPlanId: incomingPlanId,
  sessionId: incomingSessionId,
  patientInfo,
  onSaveRecord,
  onSave,
}) => {
  const {
    track,
    setTrack,
    activeTab,
    setActiveTab,
    formData,
    setFormData,
    setPatientId,
    setDoctorId,
    treatmentPlanId,
    setTreatmentPlanId,
    sessionId,
    setSessionId,
    sessionStatus,
    setSessionStatus,
    historicalSessions,
    setHistoricalSessions,
    resetSessionForm,
    setProcedures,
    setScreeningSessions,
  } = usePulmonology();

  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [lastSaveTime, setLastSaveTime] = useState(null);
  const [recordId, setRecordId] = useState("");
  const [baseFormData, setBaseFormData] = useState({});
  const baseFormDataRef = useRef({});
  const [encounterSessions, setEncounterSessions] = useState([]);
  const [isNewEncounter, setIsNewEncounter] = useState(false);

  useEffect(() => {
    baseFormDataRef.current = baseFormData;
  }, [baseFormData]);

  // Sync props into context
  useEffect(() => {
    if (patientId) setPatientId(patientId);
    if (doctorId) setDoctorId(doctorId);
    if (incomingPlanId) setTreatmentPlanId(incomingPlanId);
    if (incomingSessionId) setSessionId(incomingSessionId);
  }, [patientId, doctorId, incomingPlanId, incomingSessionId]);
 
  // Automatically select the first valid sub-tab when track changes
  useEffect(() => {
    const validTabs = NAV[track];
    if (validTabs && validTabs.length > 0) {
      if (!validTabs.some((item) => item.id === activeTab)) {
        setActiveTab(validTabs[0].id);
      }
    }
  }, [track, activeTab, setActiveTab]);

  // Prefill intake fields from HMS patient registration profile
  useEffect(() => {
    const loadPatientProfile = async () => {
      if (!patientId) return;
      try {
        const res = await getPatientProfile(patientId, doctorId);
        const profile = res?.data;
        if (!profile) return;
        const normalizedGender = String(profile.gender || "").toLowerCase();
        const gender =
          normalizedGender === "male"
            ? "Male"
            : normalizedGender === "female"
              ? "Female"
              : normalizedGender === "other"
                ? "Other"
                : profile.gender;
        const normalizedDob = normalizeDateForInput(profile.dob);

        let resolvedDoctorName = profile.doctor_name || "";
        const rawDoctorId = profile.doctor_id || doctorId || "";

        // If backend didn't return doctor_name, try resolving it via getDoctorDetails
        if (!resolvedDoctorName && rawDoctorId) {
          const cleanDocId = rawDoctorId.replace(/^Dr\.?\s*/i, "").trim();
          if (cleanDocId.startsWith("DOC-")) {
            try {
              const docRes = await getDoctorDetails(cleanDocId);
              const docData = docRes?.doctor || docRes?.data || docRes || {};
              let realName =
                docData.doctor_name ||
                docData.name ||
                docData.full_name ||
                (docData.first_name ? `${docData.first_name} ${docData.last_name}` : null);
              if (realName) {
                let formatted = realName.trim();
                if (formatted.startsWith("Dr.") && !formatted.startsWith("Dr. ")) {
                  formatted = formatted.replace(/^Dr\./, "Dr. ");
                } else if (!formatted.startsWith("Dr.") && !formatted.startsWith("Dr ")) {
                  formatted = `Dr. ${formatted}`;
                }
                resolvedDoctorName = formatted;
              }
            } catch (err) {
              console.warn("Could not resolve doctor details in profile loader:", err);
            }
          }
        }

        const profileFields = {
          pt_name: profile.name,
          pt_mrn: profile.mrn || profile.patient_id || patientId,
          pt_dob: normalizedDob,
          pt_age: profile.age,
          pt_sex: gender,
          pt_ethnicity: profile.ethnicity,
          pt_language: profile.primary_language,
          pt_contact: profile.contact,
          pt_email: profile.email,
          pt_emergency_contact: profile.emergency_contact,
          pt_payer_primary: profile.payer,
          team_pulmonologist: resolvedDoctorName || rawDoctorId,
          lifestyle_smoking: profile.smoking_history,
        };
        setBaseFormData((previous) => mergeNonEmptyFields(previous, profileFields));
        setFormData((previous) => {
          const next = { ...previous };
          Object.entries(profileFields).forEach(([key, value]) => {
            if ((next[key] === undefined || next[key] === "") && value !== undefined && value !== null && value !== "") {
              next[key] = String(value);
            }
          });
          return next;
        });
      } catch (err) {
        console.warn("Could not load patient profile:", err.message);
      }
    };
    loadPatientProfile();
  }, [patientId, doctorId]);

  // Load existing patient record
  useEffect(() => {
    const loadRecord = async () => {
      if (!patientId) return;
      try {
        const res = await getLatestPulmonologyRecord(patientId);
        const record = res?.data;
        if (!record) return;
        setRecordId(record.record_id || "");
        if (record.onboarding && Object.keys(record.onboarding).length > 0) {
          setBaseFormData((previous) => mergeNonEmptyFields(previous, record.onboarding));
          setFormData((previous) => mergeNonEmptyFields(previous, record.onboarding));
        }
        if (record.data && Object.keys(record.data).length > 0) {
          setBaseFormData((previous) => mergeNonEmptyFields(previous, record.data));
          setFormData((previous) => mergeNonEmptyFields(previous, record.data));
        }
        if (record.procedures && typeof setProcedures === "function") {
          setProcedures(record.procedures);
        }
        if (record.screeningSessions && typeof setScreeningSessions === "function") {
          setScreeningSessions(record.screeningSessions);
        }
      } catch (err) {
        console.warn("Could not load pulmonology record:", err.message);
      }
    };
    loadRecord();
  }, [patientId]);

  // Real-time synchronization bridge from ProcedureNotes (and cross-tab storage)
  useEffect(() => {
    const handleSyncEvent = (event) => {
      const { patientId: incomingPid, data } = event.detail || {};
      if (!incomingPid || incomingPid === patientId) {
        if (data && typeof data === "object") {
          const cleanData = {};
          Object.entries(data).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== "") {
              cleanData[k] = v;
            }
          });
          setFormData((previous) => ({ ...previous, ...cleanData }));
          setBaseFormData((previous) => ({ ...previous, ...cleanData }));
        }
      }
    };

    const handleStorageEvent = (event) => {
      if (event.key === `pulm_sync_${patientId}` && event.newValue) {
        try {
          const parsed = JSON.parse(event.newValue);
          if (parsed && typeof parsed === "object") {
            const cleanParsed = {};
            Object.entries(parsed).forEach(([k, v]) => {
              if (v !== undefined && v !== null && v !== "") {
                cleanParsed[k] = v;
              }
            });
            setFormData((previous) => ({ ...previous, ...cleanParsed }));
            setBaseFormData((previous) => ({ ...previous, ...cleanParsed }));
          }
        } catch (e) {
          console.warn("Storage sync parse failed:", e);
        }
      }
    };

    const handleProcCompleted = (event) => {
      const { procedure, completed_procedures_log, targetTrack } = event.detail || {};
      if (procedure && typeof procedure === "object") {
        setFormData((prev) => {
          const prevLog = Array.isArray(prev.completed_procedures_log) ? prev.completed_procedures_log : [];
          const incomingLog = Array.isArray(completed_procedures_log) ? completed_procedures_log : [];
          const combined = [procedure, ...incomingLog, ...prevLog].filter(Boolean);
          const map = new Map();
          for (const p of combined) {
            const key = p.proc_id || p.id;
            if (key && !map.has(key)) {
              map.set(key, p);
            }
          }
          const mergedLog = Array.from(map.values());
          return {
            ...prev,
            last_completed_procedure: procedure,
            completed_procedures_log: mergedLog,
            niv_procedure_performed: procedure.proc_id === "nivtitr" || procedure.proc_id === "niv" ? true : prev.niv_procedure_performed,
          };
        });
      }
      setTrack(targetTrack || "monitoring");
    };

    window.addEventListener("pulm_procedure_data_sync", handleSyncEvent);
    window.addEventListener("storage", handleStorageEvent);
    window.addEventListener("pulm_procedure_completed", handleProcCompleted);

    // Initial check for cached procedure sync values
    if (patientId) {
      try {
        const cached = localStorage.getItem(`pulm_sync_${patientId}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed && typeof parsed === "object") {
            const cleanParsed = {};
            Object.entries(parsed).forEach(([k, v]) => {
              if (v !== undefined && v !== null && v !== "") {
                cleanParsed[k] = v;
              }
            });
            setFormData((previous) => ({ ...previous, ...cleanParsed }));
            setBaseFormData((previous) => ({ ...previous, ...cleanParsed }));
          }
        }
      } catch (e) {}
    }

    return () => {
      window.removeEventListener("pulm_procedure_data_sync", handleSyncEvent);
      window.removeEventListener("storage", handleStorageEvent);
      window.removeEventListener("pulm_procedure_completed", handleProcCompleted);
    };
  }, [patientId, setTrack]);

  // Load all patient encounters
  useEffect(() => {
    const loadPatientEncounters = async () => {
      if (!patientId || isNewEncounter) return;
      try {
        setIsLoading(true);
        const historyRes = await getPatientSessions(patientId, null, null, 50);
        let sessions = historyRes?.data || [];

        sessions = sessions.map((s) => {
          let derivedTrack = s.track;
          if (!derivedTrack) {
            if (s.session_type === "airway") derivedTrack = "airway";
            else if (s.session_type === "diagnostics") derivedTrack = "diagnostics";
            else if (s.session_type === "monitoring" || s.session_type === "advanced" || s.session_type === "procedures") derivedTrack = "monitoring";
            else if (s.session_type === "discharge") derivedTrack = "discharge";
            else derivedTrack = "onboarding";
          }
          if (derivedTrack === "advanced" || derivedTrack === "procedures") derivedTrack = "monitoring";
          return { ...s, track: derivedTrack };
        });

        setEncounterSessions(sessions);
        setHistoricalSessions(sessions);
        let session = null;
        if (incomingSessionId) {
          const selected = await getTrackSession(incomingSessionId);
          session = selected?.data || null;
        } else {
          session = sessions[0] || null;
        }
        if (!session) {
          setSessionId("");
          setSessionStatus("active");
          setFormData(baseFormDataRef.current);
          return;
        }
        setSessionId(session.session_id || "");
        setSessionStatus(session.status || "active");
        setFormData(mergeNonEmptyFields(baseFormDataRef.current, session.data || {}));
      } catch (err) {
        console.warn("Could not load encounters:", err.message);
      } finally {
        setIsLoading(false);
      }
    };
    loadPatientEncounters();
  }, [patientId, incomingSessionId, isNewEncounter]);

  const selectEncounter = async (selectedSessionId) => {
    if (!selectedSessionId) return;
    try {
      setIsLoading(true);
      const res = await getTrackSession(selectedSessionId);
      const session = res?.data;
      if (!session) return;
      setIsNewEncounter(false);
      setSessionId(session.session_id);
      setSessionStatus(session.status || "active");
      setFormData(mergeNonEmptyFields(baseFormDataRef.current, session.data || {}));
    } catch (err) {
      alert(`Could not load encounter: ${err.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const startNewEncounter = () => {
    setIsNewEncounter(true);
    resetSessionForm(); // Calls Copy Forward logic in context
    setLastSaveTime(null);
  };

  const handleSave = async (silent = false) => {
    try {
      setIsSaving(true);
      const onboardingData = Object.fromEntries(
        Object.entries(formData).filter(
          ([key]) =>
            key.startsWith("pt_") ||
            key.startsWith("sdoh_") ||
            key.startsWith("lifestyle_") ||
            key.startsWith("team_") ||
            key.startsWith("pulm_")
        )
      );

      let savedRecordId = recordId;
      const isAssessmentTrack =
        track === "onboarding" ||
        track === "baseline" ||
        track === "screening" ||
        track === "intake";
      if (isAssessmentTrack && Object.keys(onboardingData).length > 0) {
        if (!savedRecordId) {
          const recordRes = await createPulmonologyRecord({
            patient_id: patientId,
            doctor_id: doctorId,
            data: onboardingData,
          });
          savedRecordId = recordRes?.record_id || "";
          setRecordId(savedRecordId);
        } else {
          await savePulmonologyRecordSection(savedRecordId, "onboarding", onboardingData).catch(() => { });
        }
      }

      if (sessionId) {
        await updateTrackSession(sessionId, formData, doctorId, patientId);
        setLastSaveTime(new Date());
        if (typeof onSaveRecord === "function") {
          await onSaveRecord(formData).catch(() => { });
        }
        if (typeof onSave === "function") {
          await onSave(formData).catch(() => { });
        }
        if (!silent) alert(`Draft updated successfully! [Session: ${sessionId}]`);
        return sessionId;
      } else {
        const payload = {
          patientId,
          doctorId,
          recordId: savedRecordId,
          treatmentPlanId,
          track,
          tab: activeTab,
          status: sessionStatus,
          data: formData,
        };
        const res = await saveTrackSession(payload);
        if (res?.session_id) {
          setSessionId(res.session_id);
          setSessionStatus(res?.data?.status || "active");
          setIsNewEncounter(false);
          setEncounterSessions((previous) => {
            const savedSession = res?.data || {
              session_id: res.session_id,
              status: "active",
              track,
              tab: activeTab,
              data: formData,
              created_at: new Date().toISOString(),
              session_no: encounterSessions.length + 1,
            };
            savedSession.track = savedSession.track || track;
            return [savedSession, ...previous.filter((session) => session.session_id !== res.session_id)];
          });
          setHistoricalSessions((previous) => {
            const histSession = res?.data || {
              session_id: res.session_id,
              track,
              data: formData,
              created_at: new Date().toISOString(),
            };
            histSession.track = histSession.track || track;
            return [histSession, ...previous.filter((session) => session.session_id !== res.session_id)];
          });
          setLastSaveTime(new Date());
          if (typeof onSaveRecord === "function") {
            await onSaveRecord(formData).catch(() => { });
          }
          if (typeof onSave === "function") {
            await onSave(formData).catch(() => { });
          }
        }
        if (!silent) alert(`Draft saved successfully! [Session ID: ${res?.session_id || "SAVED"}]`);
        return res?.session_id || "";
      }
    } catch (err) {
      if (!silent) alert(`Save failed: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const completeEncounter = async () => {
    try {
      setIsSaving(true);
      const savedSessionId = await handleSave(true);
      if (savedSessionId) {
        await updateSessionStatus(savedSessionId, "completed");
        setSessionStatus("completed");
        setEncounterSessions((previous) =>
          previous.map((session) =>
            session.session_id === savedSessionId ? { ...session, status: "completed" } : session
          )
        );
      }
      if (recordId) {
        await completePulmonologyRecord(recordId, formData).catch(() => {});
      }
      alert(`Case record successfully finalized and sealed as Completed.`);
    } catch (err) {
      alert(`Could not complete encounter: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusBadgeStyle = () => {
    switch (sessionStatus) {
      case "completed":
        return { background: "#000000", color: "#ffffff", border: "1px solid #000000" };
      case "pending_discharge":
        return { background: "#f0f0f0", color: "#000000", border: "1px dashed #000000" };
      case "active":
      default:
        return { background: "#ffffff", color: "#000000", border: "1px solid #000000" };
    }
  };

  const historyProps = {
    sessions: historicalSessions,
    currentSessionId: sessionId,
    onOpenEncounter: selectEncounter,
  };

  const renderContent = () => {
    if (track === "onboarding") {
      return <OnboardingTab historyProps={historyProps} />;
    } else if (track === "baseline") {
      return <BaselineTab historyProps={historyProps} />;
    } else if (track === "screening" || track === "diagnostics") {
      switch (activeTab) {
        case "diag_imaging":
          return <ChestImagingGuide historyProps={historyProps} patientId={patientId} />;
        case "diag_labs":
          return <BiomarkersMicrobiologyTab historyProps={historyProps} />;
        case "screen_alerts":
          return <ScreeningAlertsTab historyProps={historyProps} />;
        case "diag_overview":
        default:
          return <DiagnosticsOverviewTab historyProps={historyProps} />;
      }
    } else if (track === "airway") {
      switch (activeTab) {
        case "meds":
          return <MedicationsTab historyProps={historyProps} />;
        case "airway_support":
          return <AirwaySupportTab historyProps={historyProps} />;
        case "plan":
          return <CarePlanTab historyProps={historyProps} />;
        case "assess":
        default:
          return <AssessmentTab historyProps={historyProps} />;
      }
    } else if (track === "monitoring") {
      return <PostProcedureMonitoringTab historyProps={historyProps} />;
    } else if (track === "discharge") {
      return (
        <DispositionMasterTab
          historyProps={historyProps}
          onCompleteEncounter={completeEncounter}
          isSaving={isSaving}
          sessionStatus={sessionStatus}
        />
      );
    } else if (track === "intake") {
      switch (activeTab) {
        case "baseline":
          return <BaselineTab historyProps={historyProps} />;
        case "screening":
          return <ScreeningAlertsTab historyProps={historyProps} />;
        case "onboarding":
        default:
          return <OnboardingTab historyProps={historyProps} />;
      }
    }

    return <div>Select a tab</div>;
  };

  const navItems = NAV[track] || [];

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f5f5f5" }}>
      {/* Top Header matching Nephrology 1:1 */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 24px",
          background: "#ffffff",
          borderBottom: "1px solid #e0e0e0",
        }}
      >
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px", fontWeight: 500, color: "#000000" }}>DoctorAssist.AI Pulmonology V1</span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                padding: "3px 8px",
                borderRadius: "2px",
                ...getStatusBadgeStyle(),
              }}
            >
              {sessionStatus.replace("_", " ")}
            </span>
          </div>
          <div style={{ fontSize: "11px", color: "#888888", marginTop: "2px" }}>
            Comprehensive Clinical Workflow System
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {lastSaveTime && (
            <span style={{ fontSize: "10px", color: "#888", fontStyle: "italic" }}>
              Saved {lastSaveTime.toLocaleTimeString()}
            </span>
          )}
          <span style={{ display: "inline-block" }}>
            <button
              onClick={startNewEncounter}
              disabled={isSaving || isLoading}
              style={{
                padding: "7px 12px",
                background: "#ffffff",
                color: "#000000",
                border: "1px solid #000000",
                fontSize: "11px",
                cursor: isSaving || isLoading ? "not-allowed" : "pointer",
              }}
            >
              New Encounter
            </button>
          </span>
          <select
            value={sessionId || "new"}
            onChange={(event) =>
              event.target.value === "new" ? startNewEncounter() : selectEncounter(event.target.value)
            }
            disabled={isSaving || isLoading || encounterSessions.length === 0}
            style={{ padding: "7px 8px", border: "1px solid #d0d0d0", fontSize: "11px", maxWidth: "220px" }}
          >
            <option value="new">{isNewEncounter ? "New draft" : "Select encounter"}</option>
            {[...encounterSessions].sort(sortEncountersChronologically).map((session, index) => (
              <option key={session.session_id} value={session.session_id}>
                {getEncounterLabel(session, index + 1)}
              </option>
            ))}
          </select>
          <span style={{ display: "inline-block" }}>
            <button
              onClick={() => handleSave(false)}
              disabled={isSaving || isLoading}
              style={{
                padding: "7px 18px",
                background: isSaving ? "#666666" : "#000000",
                color: "#ffffff",
                border: "1px solid #000000",
                fontSize: "12px",
                fontWeight: 500,
                cursor: isSaving ? "not-allowed" : "pointer",
              }}
            >
              {isLoading ? "Loading..." : isSaving ? "Saving..." : sessionId ? "Update Encounter" : "Save Encounter"}
            </button>
          </span>
          {sessionId && (
            <span style={{ display: "inline-block" }}>
              <button
                onClick={completeEncounter}
                disabled={isSaving || isLoading}
                style={{
                  padding: "7px 12px",
                  background: "#ffffff",
                  color: "#000000",
                  border: "1px solid #000000",
                  fontSize: "11px",
                  cursor: isSaving || isLoading ? "not-allowed" : "pointer",
                }}
              >
                {sessionStatus === "completed" ? "Mark Completed" : "Complete Encounter"}
              </button>
            </span>
          )}
        </div>
      </div>

      {/* Track Selector */}
      <TrackSelector />

      {/* Main Content Area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar - only shown when track has sub-navigation items */}
        {navItems.length > 0 && (
          <div style={{ width: "260px", flexShrink: 0, borderRight: "1px solid #e0e0e0", background: "#fafafa", overflowY: "auto" }}>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                color: "#888888",
                padding: "20px 20px 6px",
              }}
            >
              {track === "intake"
                ? "Patient Assessment"
                : track === "screening" || track === "diagnostics"
                  ? "Diagnostics & Screening"
                  : track === "airway"
                    ? "Airway Mgmt & Care Plan"
                    : "Disposition & Follow-Up"}
            </div>
            {navItems.map((item) => (
              <div
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                style={{
                  padding: "11px 20px",
                  cursor: "pointer",
                  borderLeft: activeTab === item.id ? "3px solid #000000" : "3px solid transparent",
                  background: activeTab === item.id ? "#ffffff" : "transparent",
                  fontWeight: activeTab === item.id ? 500 : 400,
                  color: activeTab === item.id ? "#000000" : "#444444",
                  fontSize: "12.5px",
                }}
              >
                {item.label}
              </div>
            ))}
          </div>
        )}

        {/* Panel View */}
        <div style={{ flex: 1, overflowY: "auto", background: "#ffffff", padding: "22px 28px 60px" }}>
          {renderContent()}
        </div>
      </div>
    </div>
  );
};

class PulmErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error("Pulmonology Module caught an error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "24px", margin: "20px", background: "#fff5f5", border: "1px solid #ffcdd2", borderRadius: "4px" }}>
          <h3 style={{ color: "#b71c1c", margin: "0 0 8px 0" }}>Pulmonology Workflow Encountered an Issue</h3>
          <p style={{ fontSize: "13px", color: "#333", margin: "0 0 16px 0" }}>
            {this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{ padding: "8px 16px", background: "#000", color: "#fff", border: "none", cursor: "pointer", fontWeight: 600, fontSize: "12px" }}
          >
            Retry / Reload View
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function PulmonologyWorkflow(props) {
  return (
    <PulmonologyProvider initialPatientId={props.patientId} initialDoctorId={props.doctorId}>
      <PulmErrorBoundary>
        <PulmonologyWorkflowInner {...props} />
      </PulmErrorBoundary>
    </PulmonologyProvider>
  );
}
