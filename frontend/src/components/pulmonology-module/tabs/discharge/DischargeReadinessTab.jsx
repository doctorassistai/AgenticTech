import React, { useMemo, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";
import { getDischargeReadiness } from "./dispositionHelpers";

export default function DischargeReadinessTab() {
  const { formData = {}, updateField } = usePulmonology();

  // Readiness Engine Evaluation
  const readiness = useMemo(() => getDischargeReadiness(formData), [
    formData.diag_outstanding_flag,
    formData.alert_hypoxemia,
    formData.alert_tx_triage,
    formData.air_niv_mode,
    formData.air_niv_compliance_hrs,
    formData.disp_destination,
    formData.air_o2_device,
    formData.disp_dme_o2_concentrator,
    formData.disp_followup_pulm_date,
    formData.disp_followup_pcp_date,
  ]);

  // Sync readiness flag to context
  useEffect(() => {
    if (formData.disp_readiness_flag !== readiness.flag) {
      updateField("disp_readiness_flag", readiness.flag);
    }
  }, [readiness.flag, formData.disp_readiness_flag, updateField]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header Banner */}
      <div
        style={{
          borderLeft: "3px solid #000",
          background: "#fff",
          padding: "12px 16px",
          border: "1px solid #e0e0e0",
          borderLeftWidth: "3px",
        }}
      >
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Discharge Readiness &amp; Clinical Triage
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Automated evaluation of patient stabilization, unresolved diagnostic orders, and physical readiness for discharge.
        </p>
      </div>

      {/* Global Discharge Readiness Banner */}
      <div
        style={{
          border: `1px solid ${readiness.isReady ? "#81c784" : "#e57373"}`,
          backgroundColor: readiness.isReady ? "#f0fdf4" : "#ffebee",
          padding: "12px 16px",
          borderRadius: "2px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <div>
          <span
            style={{
              fontSize: "10.5px",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              backgroundColor: readiness.isReady ? "#2e7d32" : "#c62828",
              color: "#fff",
              padding: "2px 8px",
              borderRadius: "2px",
              marginRight: "8px",
            }}
          >
            {readiness.flag}
          </span>
          <span style={{ fontSize: "12px", color: "#333", fontWeight: 600 }}>
            {readiness.isReady
              ? "All clinical milestones and follow-up criteria satisfied."
              : `${readiness.blockers.length} active discharge blocker(s) require clinical review.`}
          </span>
        </div>
        <div style={{ fontSize: "11.5px", color: "#666" }}>
          Primary Diagnosis: <b>{formData.pulm_primary_dx || "Unspecified"}</b>
        </div>
      </div>

      {/* Active Blockers List Card */}
      {readiness.blockers.length > 0 && (
        <div
          style={{
            background: "#fff9f8",
            border: "1px solid #ffcdd2",
            padding: "12px 16px",
            borderRadius: "2px",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#c62828", marginBottom: "6px" }}>
            Active Discharge Blockers (Derived Across Modules)
          </div>
          <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "12px", color: "#444" }}>
            {readiness.blockers.map((blocker, idx) => (
              <li key={idx} style={{ marginBottom: "4px" }}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Functional Baseline & Discharge Ambulatory Status */}
      <Section title="Functional Baseline & Discharge Ambulatory Status" note="Evaluates physical safety for discharge destination">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField
            label="FUNCTIONAL INDEPENDENCE LEVEL"
            name="disp_functional_status"
            type="select"
            options={[
              "",
              "Independent / Community ambulator",
              "Needs Assistance (Cane/Walker)",
              "Wheelchair dependent",
              "Bedbound / High caregiver burden",
            ]}
          />
          <FormField
            label="AMBULATORY DISTANCE (From 6MWT)"
            name="disp_ambulatory_display"
            type="derived"
            derivedValue={formData.pulm_current_6mwt_m ? `${formData.pulm_current_6mwt_m} meters` : "6MWT not recorded"}
          />
          <FormField
            label="HOME STAIRS / BARRIERS"
            name="disp_home_stairs"
            type="select"
            options={[
              "",
              "No stairs / Single level home",
              "Elevator accessible",
              "Flight of stairs without ramp",
              "Multiple flights of stairs",
            ]}
          />
          <FormField
            label="DISCHARGE OXYGEN STATUS"
            name="disp_o2_prescribed_display"
            type="derived"
            derivedValue={formData.air_o2_device ? `${formData.air_o2_device} (${formData.med_o2_flow || "Titrated"} L/min)` : "Room air"}
          />
        </div>
      </Section>

      {/* Stability & Vitals Clearance Checklist */}
      <Section title="Vital Signs & Hemodynamic Stability Criteria" note="Prerequisites for safe discharge clearance">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField
            label="RESTING SPO2 MAINTAINED ON PRESCRIBED O2"
            name="disp_spo2_stable"
            type="select"
            options={["", "Yes — Maintained >= 90% (or 88-92% for retainer)", "No — Frequent desaturations", "Not Assessed"]}
          />
          <FormField
            label="HEMODYNAMICALLY STABLE (24H)"
            name="disp_hemo_stable"
            type="select"
            options={["", "Yes — Normotensive and afebrile >= 24h", "No — Borderline hypotension/tachycardia", "Active Fever"]}
          />
          <FormField
            label="ORAL INTAKE & MEDICATIONS TOLERATED"
            name="disp_oral_intake"
            type="select"
            options={["", "Yes — Full oral intake tolerated", "Modified diet tolerated", "Enteral / Tube feeding required"]}
          />
        </div>
      </Section>
    </div>
  );
}
