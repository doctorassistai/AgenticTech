import React, { useEffect, useState, useRef } from "react";
import { NephrologyProvider, useNephrology } from "./context/NephrologyContext";
import TrackSelector from "./components/TrackSelector";
import {
  saveNephrologySession,
  updateNephrologySession,
  updateSessionStatus,
  getNephrologySession,
  getLatestNephrologyRecord,
  getPatientProfile,
  createNephrologyRecord,
  saveNephrologyRecordSection,
  getPatientSessions,
} from "./services/nephrologyApi";
import PatientContextBanner from "./components/PatientContextBanner";

// Track 1: Intake & Baseline
import OnboardingTab from "./tabs/01_Intake_Baseline/OnboardingTab";
import ProfileBaselineTab from "./tabs/01_Intake_Baseline/ProfileBaselineTab";
import ScreeningAlertsTab from "./tabs/01_Intake_Baseline/ScreeningAlertsTab";

// Track 2: Diagnostics & Biopsy
import PlannerTab from "./tabs/02_Diagnostics_Biopsy/PlannerTab";
import UrineIntelTab from "./tabs/02_Diagnostics_Biopsy/UrineIntelTab";
import BiopsyGNTab from "./tabs/02_Diagnostics_Biopsy/BiopsyGNTab";

// Track 3: AKI & Hospitalization
import ClassificationTab from "./tabs/03_AKI_Hospitalization/ClassificationTab";
import CauseEngineTab from "./tabs/03_AKI_Hospitalization/CauseEngineTab";
import AkiManagementTab from "./tabs/03_AKI_Hospitalization/AkiManagementTab";
import InpatientDashboardTab from "./tabs/03_AKI_Hospitalization/InpatientDashboardTab";

// Track 4: CKD Progression & Mgmt
import OverviewTab from "./tabs/04_CKD_Progression_Mgmt/OverviewTab";
import ProgressionTab from "./tabs/04_CKD_Progression_Mgmt/ProgressionTab";
import HtnDiabetesTab from "./tabs/04_CKD_Progression_Mgmt/HtnDiabetesTab";
import ComplicationEngineTab from "./tabs/04_CKD_Progression_Mgmt/ComplicationEngineTab";
import CkdMedicationsTab from "./tabs/04_CKD_Progression_Mgmt/CkdMedicationsTab";

// Track 5: Decision Support & Safety
import NephrotoxicityTab from "./tabs/05_Decision_Support/NephrotoxicityTab";
import WhatChangedTab from "./tabs/05_Decision_Support/WhatChangedTab";
import WhatNextTab from "./tabs/05_Decision_Support/WhatNextTab";

// Track 6: Dialysis & RRT
import DecisionTab from "./tabs/06_Dialysis_RRT/DecisionTab";
import AccessTab from "./tabs/06_Dialysis_RRT/AccessTab";
import DeliveryTab from "./tabs/06_Dialysis_RRT/DeliveryTab";
import PdHomeTab from "./tabs/06_Dialysis_RRT/PdHomeTab";
import AdequacyReviewTab from "./tabs/06_Dialysis_RRT/AdequacyReviewTab";

// Track 7: Transplant
import PreTxTab from "./tabs/07_Transplant/PreTxTab";
import DonorEligibilityTab from "./tabs/07_Transplant/DonorEligibilityTab";
import ImmunoTab from "./tabs/07_Transplant/ImmunoTab";
import PostTxTab from "./tabs/07_Transplant/PostTxTab";

// Track 8: Longitudinal Care & Ops
import DischargeTab from "./tabs/08_Longitudinal_Ops/DischargeTab";
import PostDischargeTab from "./tabs/08_Longitudinal_Ops/PostDischargeTab";
import TimelineTab from "./tabs/08_Longitudinal_Ops/TimelineTab";
import DigitalTwinTab from "./tabs/08_Longitudinal_Ops/DigitalTwinTab";
import AnalyticsTab from "./tabs/08_Longitudinal_Ops/AnalyticsTab";

// Shared Procedure Guides
import HemodialysisGuide from "./tabs/procedures/HemodialysisGuide";
import AVFistulaGuide from "./tabs/procedures/AVFistulaGuide";
import TransplantGuide from "./tabs/procedures/TransplantGuide";

// We will import the actual Tab components as we build them step-by-step
// For now, we use a simple placeholder to map the routing.
const TabPlaceholder = ({ title }) => (
  <div style={{ padding: "40px", textAlign: "center", color: "#666" }}>
    <h2>{title}</h2>
    <p>This tab is currently being built...</p>
  </div>
);

const NAV = {
  intake_baseline: [
    { id: "onboarding", label: "Onboarding & Demographics" },
    { id: "profile", label: "Automatic Profile & Baseline" },
    { id: "screening", label: "Screening & Alerts" },
  ],
  diagnostics: [
    { id: "planner", label: "Investigation Planner" },
    { id: "urine_intel", label: "Urine Intelligence" },
    { id: "biopsy_gn", label: "Biopsy & Glomerular" },
  ],
  aki_hosp: [
    { id: "classification", label: "AKI Classification" },
    { id: "cause_engine", label: "Cause Engine" },
    { id: "aki_management", label: "AKI Management & Meds" },
  ],
  ckd_mgmt: [
    { id: "overview", label: "CKD Overview & Summary" },
    { id: "progression", label: "Progression Intelligence" },
    { id: "htn_diabetes", label: "Hypertension & Diabetes" },
    { id: "complication_engine", label: "Complication Engine" },
    { id: "ckd_meds", label: "Medication Reconciliation" },
  ],
  decision_support: [
    { id: "what_next", label: "Treatment Recommendations" },
    { id: "what_changed", label: "Response Assessment" },
    { id: "nephrotoxicity", label: "Progression & Deviation" },
  ],
  dialysis_rrt: [
    { id: "decision", label: "Dialysis Decision Support" },
    { id: "access", label: "Access Intelligence" },
    { id: "delivery", label: "Delivery & Optimization" },
    { id: "pd_home", label: "PD & Home Monitoring" },
    { id: "adequacy_review", label: "Monthly Adequacy & Surveillance" },
  ],
  transplant: [
    { id: "pre_tx", label: "Pre-Transplant Workup" },
    { id: "donor_eligibility", label: "Donor & Waitlist Intel" },
    { id: "immuno", label: "Immunosuppressant Intel" },
    { id: "post_tx", label: "Post-Transplant Surveillance" },
  ],
  longitudinal_ops: [
    { id: "timeline", label: "Kidney Event Timeline" },
    // { id: "digital_twin", label: "Digital Twin & Command Center" },
    // { id: "analytics", label: "Value-Based Care & Outcomes" },
    { id: "post_discharge", label: "Post-Discharge Monitoring" },
    { id: "discharge", label: "Hospital Discharge" },
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
    const hasValue = value !== undefined && value !== null &&
      (typeof value !== "string" || value.trim() !== "") &&
      (!Array.isArray(value) || value.length > 0) &&
      (typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 0);
    if (hasValue) next[key] = value;
  });
  return next;
};

const SHARED = [
  { id: "proc_hd", label: "Hemodialysis Guide" },
  { id: "proc_avf", label: "AV Fistula & Access" },
  { id: "proc_tx", label: "Kidney Transplant Guide" },
];

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

const NephrologyWorkflowInner = ({
  doctorId,
  patientId,
  treatmentPlanId: incomingPlanId,
  sessionId: incomingSessionId,
  patientInfo,
  onSaveRecord,
}) => {
  const {
    track,
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
  } = useNephrology();

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

  // Prefill intake fields from the HMS patient registration profile.
  useEffect(() => {
    const loadPatientProfile = async () => {
      if (!patientId) return;
      try {
        const res = await getPatientProfile(patientId, doctorId);
        const profile = res?.data;
        if (!profile) return;
        const normalizedGender = String(profile.gender || "").toLowerCase();
        const gender = normalizedGender === "male"
          ? "Male"
          : normalizedGender === "female"
            ? "Female"
            : normalizedGender === "other"
              ? "Other"
              : profile.gender;
        const normalizedDob = normalizeDateForInput(profile.dob);
        const profileFields = {
          v2_name: profile.name,
          v2_dob: normalizedDob,
          v2_clinical_age: profile.age,
          v2_gender: gender,
          v2_ethnicity: profile.ethnicity,
          v2_contact: profile.contact,
          v2_emergency_contact: profile.emergency_contact,
          v2_payer: profile.payer,
          v2_team_neph: profile.doctor_name || profile.doctor_id,
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
        const res = await getLatestNephrologyRecord(patientId);
        const record = res?.data;
        if (!record) return;
        setRecordId(record.record_id || "");
        if (record.onboarding && Object.keys(record.onboarding).length > 0) {
          setBaseFormData((previous) => mergeNonEmptyFields(previous, record.onboarding));
          setFormData((previous) => mergeNonEmptyFields(previous, record.onboarding));
        }
      } catch (err) {
        console.warn("Could not load nephrology record:", err.message);
      }
    };
    loadRecord();
  }, [patientId]);

  // Load all patient encounters once. Track changes only change the visible workflow.
  useEffect(() => {
    const loadPatientEncounters = async () => {
      if (!patientId || isNewEncounter) return;
      try {
        setIsLoading(true);
        const historyRes = await getPatientSessions(patientId, null, 50);
        let sessions = historyRes?.data || [];
        
        // Ensure all sessions have a track, fallback if necessary
        sessions = sessions.map(s => {
          let derivedTrack = s.track;
          if (!derivedTrack) {
            if (s.session_type === "hemodialysis" || s.session_type === "dialysis") derivedTrack = "dialysis_rrt";
            else if (s.session_type === "ckd_opd" || s.session_type === "ckd") derivedTrack = "ckd_mgmt";
            else if (s.session_type === "transplant" || s.session_type === "tx") derivedTrack = "transplant";
            else if (s.session_type === "aki" || s.session_type === "inpatient") derivedTrack = "aki_hosp";
            else derivedTrack = "intake_baseline";
          }
          return { ...s, track: derivedTrack };
        });
        
        setEncounterSessions(sessions);
        setHistoricalSessions(sessions);
        let session = null;
        if (incomingSessionId) {
          const selected = await getNephrologySession(incomingSessionId);
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

  useEffect(() => {
    if (track !== "ckd_mgmt" || !historicalSessions.length) return;
    const latestCkd = [...historicalSessions]
      .filter((session) => session.track === "ckd_mgmt" && session.data)
      .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))[0];
    if (!latestCkd?.data) return;
    setFormData((previous) => mergeNonEmptyFields(previous, latestCkd.data));
  }, [track, historicalSessions]);

  const selectEncounter = async (selectedSessionId) => {
    if (!selectedSessionId) return;
    try {
      setIsLoading(true);
      const res = await getNephrologySession(selectedSessionId);
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
    resetSessionForm(); // Calls the Copy Forward logic in context
    setLastSaveTime(null);
  };
  // Changes are persisted only when Save Record or Update Record is clicked.

  const handleSave = async (silent = false) => {
    try {
      setIsSaving(true);
      const onboardingData = Object.fromEntries(
        Object.entries(formData).filter(([key]) => key.startsWith("v2_") && !key.startsWith("v2_baseline_"))
      );
      const baselineData = Object.fromEntries(
        Object.entries(formData).filter(([key]) => key.startsWith("v2_baseline_"))
      );

      let savedRecordId = recordId;
      if (track === "intake_baseline" && Object.keys(onboardingData).length > 0) {
        if (!savedRecordId) {
          const recordRes = await createNephrologyRecord({ patientId, doctorId, data: onboardingData });
          savedRecordId = recordRes?.record_id || "";
          setRecordId(savedRecordId);
        } else {
          await saveNephrologyRecordSection(savedRecordId, "onboarding", onboardingData);
        }
      }

      if (sessionId) {
        await updateNephrologySession(sessionId, formData, patientId, doctorId);
        setLastSaveTime(new Date());
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
          data: { ...baselineData, ...formData },
        };
        const res = await saveNephrologySession(payload);
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
            const histSession = res?.data || { session_id: res.session_id, track, data: formData, created_at: new Date().toISOString() };
            histSession.track = histSession.track || track;
            return [histSession, ...previous.filter((session) => session.session_id !== res.session_id)];
          });
          setLastSaveTime(new Date());
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
    if (!sessionId || sessionStatus === "completed") return;
    const savedSessionId = await handleSave(true);
    if (!savedSessionId) return;
    try {
      setIsSaving(true);
      await updateSessionStatus(savedSessionId, "completed");
      setSessionStatus("completed");
      setEncounterSessions((previous) => previous.map((session) =>
        session.session_id === savedSessionId ? { ...session, status: "completed" } : session
      ));
      alert(`Encounter completed and locked. [Session: ${savedSessionId}]`);
    } catch (err) {
      alert(`Could not complete encounter: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  const getStatusBadgeStyle = () => {
    switch (sessionStatus) {
      case "completed": return { background: "#000000", color: "#ffffff", border: "1px solid #000000" };
      case "pending_discharge": return { background: "#f0f0f0", color: "#000000", border: "1px dashed #000000" };
      case "active":
      default: return { background: "#ffffff", color: "#000000", border: "1px solid #000000" };
    }
  };

  const renderContent = () => {
    if (activeTab === "proc_hd") return <HemodialysisGuide />;
    if (activeTab === "proc_avf") return <AVFistulaGuide />;
    if (activeTab === "proc_tx") return <TransplantGuide />;
    const historyProps = { sessions: historicalSessions, currentSessionId: sessionId, onOpenEncounter: selectEncounter };
    if (activeTab === "inpatient_dashboard") return <InpatientDashboardTab historyProps={historyProps} />;

    if (track === "intake_baseline") {
      switch (activeTab) {
        case "onboarding": return <OnboardingTab />;
        case "profile": return <ProfileBaselineTab />;
        case "screening": return <ScreeningAlertsTab />;
        default: return <OnboardingTab />;
      }
    } else if (track === "diagnostics") {
      switch (activeTab) {
        case "planner": return <PlannerTab />;
        case "urine_intel": return <UrineIntelTab />;
        case "biopsy_gn": return <BiopsyGNTab />;
        default: return <PlannerTab />;
      }
    } else if (track === "aki_hosp") {
      switch (activeTab) {
        case "classification": return <ClassificationTab historyProps={historyProps} />;
        case "cause_engine": return <CauseEngineTab historyProps={historyProps} />;
        case "aki_management": return <AkiManagementTab historyProps={historyProps} />;
        default: return <ClassificationTab historyProps={historyProps} />;
      }
    } else if (track === "ckd_mgmt") {
      switch (activeTab) {
        case "overview": return <OverviewTab historyProps={historyProps} />;
        case "progression": return <ProgressionTab historyProps={historyProps} />;
        case "htn_diabetes": return <HtnDiabetesTab historyProps={historyProps} />;
        case "complication_engine": return <ComplicationEngineTab historyProps={historyProps} />;
        case "ckd_meds": return <CkdMedicationsTab historyProps={historyProps} />;
        default: return <ProgressionTab />;
      }
    } else if (track === "decision_support") {
      switch (activeTab) {
        case "nephrotoxicity": return <NephrotoxicityTab />;
        case "what_changed": return <WhatChangedTab />;
        case "what_next": return <WhatNextTab />;
        default: return <NephrotoxicityTab />;
      }
    } else if (track === "dialysis_rrt") {
      switch (activeTab) {
        case "decision": return <DecisionTab historyProps={historyProps} />;
        case "access": return <AccessTab historyProps={historyProps} />;
        case "delivery": return <DeliveryTab historyProps={historyProps} />;
        case "pd_home": return <PdHomeTab historyProps={historyProps} />;
        case "adequacy_review": return <AdequacyReviewTab historyProps={historyProps} />;
        default: return <DecisionTab historyProps={historyProps} />;
      }
    } else if (track === "transplant") {
      switch (activeTab) {
        case "pre_tx": return <PreTxTab historyProps={historyProps} />;
        case "donor_eligibility": return <DonorEligibilityTab historyProps={historyProps} />;
        case "immuno": return <ImmunoTab historyProps={historyProps} />;
        case "post_tx": return <PostTxTab historyProps={historyProps} />;
        default: return <PreTxTab historyProps={historyProps} />;
      }
    } else if (track === "longitudinal_ops") {
      switch (activeTab) {
        case "discharge": return <DischargeTab />;
        case "post_discharge": return <PostDischargeTab />;
        case "timeline": return <TimelineTab />;
        case "digital_twin": return <DigitalTwinTab />;
        case "analytics": return <AnalyticsTab />;
        default: return <TimelineTab />;
      }
    }

    // We will replace these with actual imports step-by-step
    return <TabPlaceholder title={`${track.toUpperCase()} - ${activeTab.toUpperCase()}`} />;
  };

  let navItems = [...(NAV[track] || [])];

  if (formData?.v2_encounter_type === "Admitted (Inpatient)") {
    const reason = formData?.v2_admission_reason;
    if (
      (track === "aki_hosp" && reason === "AKI") ||
      (track === "ckd_mgmt" && reason === "CKD Exacerbation") ||
      (track === "dialysis_rrt" && reason === "Dialysis Complication") ||
      (track === "transplant" && reason === "Transplant")
    ) {
      navItems.push({ id: "inpatient_dashboard", label: "Inpatient Dashboard" });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "#f5f5f5" }}>
      {/* Top Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px 24px", background: "#ffffff", borderBottom: "1px solid #e0e0e0" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <span style={{ fontSize: "18px", fontWeight: 500, color: "#000000" }}>DoctorAssist.AI Nephrology V2</span>
            <span style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", padding: "3px 8px", borderRadius: "2px", ...getStatusBadgeStyle() }}>
              {sessionStatus.replace("_", " ")}
            </span>
          </div>
          <div style={{ fontSize: "11px", color: "#888888", marginTop: "2px" }}>
            Comprehensive Clinical Workflow System
          </div>
        </div>
        <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {lastSaveTime && <span style={{ fontSize: "10px", color: "#888", fontStyle: "italic" }}>Saved {lastSaveTime.toLocaleTimeString()}</span>}
          <button onClick={startNewEncounter} disabled={isSaving || isLoading} style={{ padding: "7px 12px", background: "#ffffff", color: "#000000", border: "1px solid #000000", fontSize: "11px", cursor: "pointer" }}>New Encounter</button>
          <select value={sessionId || "new"} onChange={(event) => event.target.value === "new" ? startNewEncounter() : selectEncounter(event.target.value)} disabled={isSaving || isLoading || encounterSessions.length === 0} style={{ padding: "7px 8px", border: "1px solid #d0d0d0", fontSize: "11px", maxWidth: "220px" }}>
            <option value="new">{isNewEncounter ? "New draft" : "Select encounter"}</option>
            {[...encounterSessions]
              .sort(sortEncountersChronologically)
              .map((session, index) => (
                <option key={session.session_id} value={session.session_id}>
                  {getEncounterLabel(session, index + 1)}
                </option>
              ))}
          </select>
          <button onClick={() => handleSave(false)} disabled={isSaving || isLoading || sessionStatus === "completed"} style={{ padding: "7px 18px", background: isSaving || sessionStatus === "completed" ? "#666666" : "#000000", color: "#ffffff", border: "1px solid #000000", fontSize: "12px", fontWeight: 500, cursor: isSaving || sessionStatus === "completed" ? "not-allowed" : "pointer" }}>
            {isLoading ? "Loading..." : isSaving ? "Saving..." : sessionId ? "Update Encounter" : "Save Encounter"}
          </button>
        </div>
      </div>
      
      {/* <PatientContextBanner /> */}
      <TrackSelector />

      {/* Main Content Area */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Sidebar Navigation */}
        <div style={{ width: "260px", flexShrink: 0, borderRight: "1px solid #e0e0e0", background: "#fafafa", overflowY: "auto" }}>
          <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#888888", padding: "20px 20px 6px" }}>
            Navigation
          </div>
          {navItems.map((item) => (
            <div
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                padding: "11px 20px", cursor: "pointer", fontSize: "12.5px",
                borderLeft: activeTab === item.id ? "3px solid #000000" : "3px solid transparent",
                background: activeTab === item.id ? "#ffffff" : "transparent",
                fontWeight: activeTab === item.id ? 500 : 400,
                color: activeTab === item.id ? "#000000" : "#444444",
              }}
            >
              {item.label}
            </div>
          ))}

          {/* <div style={{ height: "1px", background: "#e0e0e0", margin: "8px 20px" }} />
          <div style={{ fontSize: "10px", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", color: "#888888", padding: "10px 20px 6px" }}>
            Procedure Guides
          </div>
          {SHARED.map((item) => (
            <div
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              style={{
                padding: "11px 20px", cursor: "pointer", fontSize: "12.5px",
                borderLeft: activeTab === item.id ? "3px solid #000000" : "3px solid transparent",
                background: activeTab === item.id ? "#ffffff" : "transparent",
                fontWeight: activeTab === item.id ? 500 : 400,
                color: activeTab === item.id ? "#000000" : "#444444",
              }}
            >
              {item.label}
            </div>
          ))} */}
        </div>

        {/* Panel View */}
        <div style={{ flex: 1, overflowY: "auto", background: "#ffffff", padding: "22px 28px 60px" }}>
          <div style={{ pointerEvents: sessionStatus === "completed" ? "none" : "auto" }} aria-disabled={sessionStatus === "completed"}>
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
};

export default function NephrologyWorkflow(props) {
  return (
    <NephrologyProvider initialPatientId={props.patientId} initialDoctorId={props.doctorId}>
      <NephrologyWorkflowInner {...props} />
    </NephrologyProvider>
  );
}
