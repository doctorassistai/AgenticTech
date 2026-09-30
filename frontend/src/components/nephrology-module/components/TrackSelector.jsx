import React from "react";
import { useNephrology } from "../context/NephrologyContext";

const HINTS = {
  intake_baseline: "Phase 1 & 2: Admission, Baseline, Primary Care Alerts",
  diagnostics: "Phase 3: Confirmatory Testing, Urine Intel, Biopsy",
  aki_hosp: "Phase 4: AKI vs CKD, Cause Engine, Inpatient Dashboard",
  ckd_mgmt: "Phase 6 & 7: CKD Stage & Progression, Hypertension, Meds",
  decision_support: "Phase 5: Decision Support & Safety",
  dialysis_rrt: "Phase 8: Dialysis Preparation & Adequacy",
  transplant: "Phase 9: Transplant & Immunosuppressant Intel",
  longitudinal_ops: "Phase 10 & 11: Discharge & Timeline",
};

const TRACKS = [
  { id: "intake_baseline", label: "Intake & Baseline" },
  { id: "diagnostics", label: "Diagnostics" },
  { id: "aki_hosp", label: "AKI & Hospital" },
  { id: "ckd_mgmt", label: "CKD Mgmt" },
  // { id: "decision_support", label: "Decision Support" },
  { id: "dialysis_rrt", label: "Dialysis & RRT" },
  { id: "transplant", label: "Transplant" },
  { id: "longitudinal_ops", label: "Discharge & Timeline" },
];

/**
 * TrackSelector Component
 * Allows switching between Patient Tracks using the 16-07-2026 segmented control styling.
 */
const TrackSelector = () => {
  const { track, setTrack } = useNephrology();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "10px 24px",
        background: "#ffffff",
        borderBottom: "1px solid #e0e0e0",
      }}
    >
      <span
        style={{
          fontSize: "10.5px",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#888888",
        }}
      >
        Phase
      </span>

      <div style={{ display: "flex", border: "1px solid #000000" }}>
        {TRACKS.map((t, index) => (
          <button
            key={t.id}
            onClick={() => setTrack(t.id)}
            style={{
              fontFamily: '"Open Sans", sans-serif',
              fontSize: "11px",
              fontWeight: 500,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              padding: "6px 14px",
              border: "none",
              borderRight: index < TRACKS.length - 1 ? "1px solid #000000" : "none",
              background: track === t.id ? "#000000" : "#ffffff",
              color: track === t.id ? "#ffffff" : "#000000",
              cursor: "pointer",
              transition: "all 0.15s",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <span
        style={{
          fontSize: "11px",
          color: "#888888",
          marginLeft: "auto",
        }}
      >
        {HINTS[track]}
      </span>
    </div>
  );
};

export default TrackSelector;
