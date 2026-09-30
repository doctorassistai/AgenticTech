import React, { createContext, useContext, useState } from "react";

// 1. Create the React Context instance
export const NephrologyContext = createContext(null);

export const NephrologyProvider = ({ children, initialPatientId = "", initialDoctorId = "" }) => {
  // Master Patient & Doctor identifiers
  const [patientId, setPatientId] = useState(initialPatientId);
  const [doctorId, setDoctorId] = useState(initialDoctorId);

  // Active track: 'intake_baseline', 'aki_hosp', 'diagnostics', etc.
  const [track, setTrack] = useState("intake_baseline");

  // Currently selected tab ID within the active track
  const [activeTab, setActiveTab] = useState("onboarding");

  // Macro-level treatment plan ID
  const [treatmentPlanId, setTreatmentPlanId] = useState("");

  // Discrete encounter/session ID
  const [sessionId, setSessionId] = useState("");

  // Encounter status: 'draft' | 'active' | 'pending_discharge' | 'completed'
  const [sessionStatus, setSessionStatus] = useState("active");

  // Stores all user inputs across all tabs for the active session (key-value pairs)
  const [formData, setFormData] = useState({});

  // Past sessions for the current patient (used to render historical flowsheet tables)
  const [historicalSessions, setHistoricalSessions] = useState([]);

  // Longitudinal clinical records
  const [problemList, setProblemList] = useState([]);
  const [activeMedications, setActiveMedications] = useState([]);

  // Helper to update a single form field in state
  const updateField = (key, value) => {
    if (sessionStatus === "completed") return;
    setFormData((prev) => ({
      ...prev,
      [key]: value,
    }));
  };

  // Helper to update multiple form fields at once (e.g. after loading or AI structuring)
  const updateFields = (newFieldsObj) => {
    if (sessionStatus === "completed") return;
    if (!newFieldsObj || typeof newFieldsObj !== "object") return;
    setFormData((prev) => ({
      ...prev,
      ...newFieldsObj,
    }));
  };

  // Reset form data for a new session (Copy Forward method)
  const resetSessionForm = () => {
    setFormData((prev) => {
      const copyForwardData = {};
      Object.keys(prev).forEach((key) => {
        // Wipe daily/acute fields that change per encounter
        if (
          key.startsWith("v2_aki_") ||
          key.startsWith("v2_fluid_") ||
          key.startsWith("v2_hosp_") ||
          key.startsWith("v2_dc_") ||
          key.startsWith("v2_ops_") ||
          key.startsWith("v2_rrt_") ||
          key.startsWith("v2_access_") ||
          key.startsWith("v2_pd_") ||
          key.startsWith("v2_hd_") ||
          key.startsWith("v2_ai_")
        ) {
          // Do not copy
        } else {
          // Copy forward longitudinal data (e.g. v2_bx_, v2_urine_, v2_vbc_, v2_risk_)
          copyForwardData[key] = prev[key];
        }
      });
      return copyForwardData;
    });
    setSessionStatus("active");
    setSessionId("");
  };

  // Switch tracks and reset active tab
  const handleTrackChange = (newTrack) => {
    setTrack(newTrack);
    // Setting default tab for each track
    if (newTrack === "intake_baseline") setActiveTab("onboarding");
    else if (newTrack === "aki_hosp") setActiveTab("classification");
    else if (newTrack === "diagnostics") setActiveTab("planner");
    else if (newTrack === "ckd_mgmt") setActiveTab("overview");
    else if (newTrack === "decision_support") setActiveTab("nephrotoxicity");
    else if (newTrack === "dialysis_rrt") setActiveTab("decision");
    else if (newTrack === "transplant") setActiveTab("pre_tx");
    else if (newTrack === "longitudinal_ops") setActiveTab("timeline");
  };

  return (
    <NephrologyContext.Provider
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
        formData,
        updateField,
        updateFields,
        setFormData,
        resetSessionForm,
        historicalSessions,
        setHistoricalSessions,
        problemList,
        setProblemList,
        activeMedications,
        setActiveMedications,
      }}
    >
      {children}
    </NephrologyContext.Provider>
  );
};

export const useNephrology = () => {
  const context = useContext(NephrologyContext);
  if (!context) {
    return {
      patientId: "",
      setPatientId: () => {},
      doctorId: "",
      setDoctorId: () => {},
      track: "intake_baseline",
      setTrack: () => {},
      activeTab: "onboarding",
      setActiveTab: () => {},
      treatmentPlanId: "",
      setTreatmentPlanId: () => {},
      sessionId: "",
      setSessionId: () => {},
      sessionStatus: "active",
      setSessionStatus: () => {},
      formData: {},
      updateField: () => {},
      updateFields: () => {},
      setFormData: () => {},
      resetSessionForm: () => {},
      historicalSessions: [],
      setHistoricalSessions: () => {},
      problemList: [],
      setProblemList: () => {},
      activeMedications: [],
      setActiveMedications: () => {},
    };
  }
  return context;
};
