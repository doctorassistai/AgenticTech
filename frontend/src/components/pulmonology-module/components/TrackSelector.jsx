import React from "react";
import { usePulmonology } from "../context/PulmonologyContext";

const HINTS = {
  onboarding: "Patient identity, contact info, insurance, care team assignment, and encounter context",
  baseline: "Presenting respiratory symptoms, baseline physical vitals, lung auscultation, and medication history",
  screening: "Diagnostics Hub (PFT/6MWT/ABG), automated risk scores (GOLD, BODE, GAP), alerts, imaging, and biomarkers",
  airway: "Medical therapy: inhaler regimens, bronchodilators, steroids, supplemental O2, care plan, and transplant workup",
  monitoring: "Post-Procedure Monitoring & Inpatient Care: 5 coordinated panels (Observations, TDM, Nursing, Efficacy, Resistance) + Whole-Tab AI Dictation",
  discharge: "Discharge & Clinical Summary: Aggregated diagnoses, meds table, return precautions, consultant sign-off, and Save Full Record atomic seal",
  intake: "Collect baseline demographics, vitals, and presenting symptoms",
};

const TRACKS = [
  { id: "onboarding", label: "Onboarding & Demographics" },
  { id: "baseline", label: "Clinical Baseline & Vitals" },
  { id: "screening", label: "Diagnostics & Screening" },
  { id: "airway", label: "Airway Mgmt" },
  { id: "monitoring", label: "Post-Procedure Monitoring" },
  { id: "discharge", label: "Discharge & Clinical Summary" },
];

/**
 * TrackSelector Component
 * Allows switching between Patient Tracks in the new Clinical Pathway model.
 */
const TrackSelector = () => {
  const { track, setTrack } = usePulmonology();

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "10px 24px",
        background: "#ffffff",
        borderBottom: "1px solid #e0e0e0",
        flexWrap: "wrap",
        rowGap: "8px",
      }}
    >
      <span
        style={{
          fontSize: "10.5px",
          fontWeight: 600,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "#888888",
          whiteSpace: "nowrap",
        }}
      >
        Phase of Care
      </span>

      <div style={{ display: "flex", border: "1px solid #000000", flexWrap: "wrap" }}>
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
              background: (track === t.id || (t.id === "procedures" && track === "advanced")) ? "#000000" : "#ffffff",
              color: (track === t.id || (t.id === "procedures" && track === "advanced")) ? "#ffffff" : "#000000",
              cursor: "pointer",
              transition: "all 0.15s",
              whiteSpace: "nowrap",
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
