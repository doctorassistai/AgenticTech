import React from "react";
import { useNephrology } from "../context/NephrologyContext";

const PatientContextBanner = () => {
  const { formData, historicalSessions, track } = useNephrology();

  // Helper to get the most recent value for a given field
  const getLatestField = (key) => {
    if (formData && formData[key] && typeof formData[key] === "string" && formData[key].trim() !== "") {
      return formData[key];
    }
    for (const session of [...historicalSessions].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))) {
      if (session.data && session.data[key] && typeof session.data[key] === "string" && session.data[key].trim() !== "") {
        return session.data[key];
      }
    }
    return null;
  };

  const ckdStageRaw = getLatestField("v2_risk_kdigo_stage") || getLatestField("v2_risk_kdigo_g");
  const ckdStage = ckdStageRaw ? ckdStageRaw.split("(")[0].trim() : null;
  const akiClass = getLatestField("v2_aki_class");
  const rrtModality = getLatestField("v2_rrt_final_choice");
  const txWaitlist = getLatestField("v2_rrt_tx_waitlist");

  let journeyParts = [];

  if (ckdStage) {
    journeyParts.push(`CKD ${ckdStage}`);
  } else if (historicalSessions.some(s => s.track === "ckd_mgmt")) {
    journeyParts.push("CKD Tracker");
  }

  if (akiClass) {
    journeyParts.push(`AKI (${akiClass})`);
  } else if (historicalSessions.some(s => s.track === "aki_hosp")) {
    journeyParts.push("AKI Event");
  }

  if (rrtModality) {
    journeyParts.push(`RRT (${rrtModality})`);
  } else if (historicalSessions.some(s => s.track === "dialysis_rrt")) {
    journeyParts.push("Dialysis Eval");
  }

  if (txWaitlist) {
    journeyParts.push(`Transplant (${txWaitlist})`);
  }

  if (journeyParts.length === 0) {
    journeyParts.push("New Patient Registration");
  }

  // Active status based on track
  let activeStatus = "Clinical Assessment";
  if (track === "dialysis_rrt") activeStatus = "Incident Dialysis";
  else if (track === "transplant") activeStatus = "Transplant Evaluation";
  else if (track === "ckd_mgmt") activeStatus = "Outpatient Management";
  else if (track === "aki_hosp") activeStatus = "Inpatient AKI Care";
  else if (track === "intake_baseline") activeStatus = "Intake & Baseline";
  else if (track === "diagnostics") activeStatus = "Diagnostics & Biopsy";
  else if (track === "decision_support") activeStatus = "Decision Support";
  else if (track === "longitudinal_ops") activeStatus = "Discharge & Timeline";

  return (
    <div style={{
      background: "#e6f4ea",
      borderBottom: "1px solid #ceead6",
      padding: "8px 24px",
      fontSize: "12px",
      fontWeight: 500,
      color: "#137333",
      display: "flex",
      alignItems: "center",
      gap: "8px"
    }}>
      <span style={{ fontSize: "14px" }}>📅</span>
      [CLINICAL JOURNEY] {journeyParts.join(" ➔ ")} ➔ Active: {activeStatus}
    </div>
  );
};

export default PatientContextBanner;
