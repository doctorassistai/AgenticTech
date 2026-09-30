import React, { useEffect, useMemo } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

// Standard Boston/stepwise ABG interpretation.
function interpretAbg({ ph, paco2, hco3, pao2, be }) {
  if ([ph, paco2, hco3].some((v) => v === null || isNaN(v))) return null;

  // Primary disorder from pH direction
  let primary = "";
  if (ph < 7.35) {
    primary = paco2 > 45 ? "Respiratory Acidosis" : "Metabolic Acidosis";
  } else if (ph > 7.45) {
    primary = paco2 < 35 ? "Respiratory Alkalosis" : "Metabolic Alkalosis";
  } else {
    if (paco2 > 45 && hco3 > 26) primary = "Fully Compensated Respiratory Acidosis";
    else if (paco2 < 35 && hco3 < 22) primary = "Fully Compensated Respiratory Alkalosis";
    else primary = "Normal Acid-Base Status";
  }

  // Compensation assessment
  let compensation = "";
  if (primary === "Respiratory Acidosis") {
    compensation = hco3 > 26 ? "Partially Compensated" : "Uncompensated (Acute)";
  } else if (primary === "Respiratory Alkalosis") {
    compensation = hco3 < 22 ? "Partially Compensated" : "Uncompensated (Acute)";
  } else if (primary === "Metabolic Acidosis") {
    compensation = paco2 < 35 ? "Partially Compensated" : "Uncompensated";
  } else if (primary === "Metabolic Alkalosis") {
    compensation = paco2 > 45 ? "Partially Compensated" : "Uncompensated";
  }

  // Oxygenation status
  let oxygenation = "";
  if (!isNaN(pao2)) {
    if (pao2 < 60) oxygenation = "Severe Hypoxemia";
    else if (pao2 < 80) oxygenation = "Mild-Moderate Hypoxemia";
    else oxygenation = "Normal Oxygenation";
  }

  const summary = [primary, compensation, oxygenation].filter(Boolean).join(" · ");
  return { primary, compensation, oxygenation, summary };
}

const ABGProcedure = () => {
  const { formData, updateField } = usePulmonology();

  const ph = parseFloat(formData.abg_ph);
  const paco2 = parseFloat(formData.abg_paco2);
  const pao2 = parseFloat(formData.abg_pao2);
  const hco3 = parseFloat(formData.abg_hco3);
  const be = parseFloat(formData.abg_be);

  const interpretation = useMemo(
    () => interpretAbg({ ph, paco2, hco3, pao2, be }),
    [ph, paco2, hco3, pao2, be]
  );
  useEffect(() => {
    if (!interpretation) return;
    if (formData.abg_interpretation !== interpretation.summary) {
      updateField("abg_interpretation", interpretation.summary);
    }
  }, [interpretation, formData.abg_interpretation, updateField]);

  // Push this draw's gas values into shared context
  useEffect(() => {
    if (!isNaN(pao2) && formData.pulm_current_pao2 !== formData.abg_pao2) {
      updateField("pulm_current_pao2", formData.abg_pao2);
    }
  }, [pao2, formData.abg_pao2, formData.pulm_current_pao2, updateField]);

  useEffect(() => {
    if (!isNaN(paco2) && formData.pulm_current_paco2 !== formData.abg_paco2) {
      updateField("pulm_current_paco2", formData.abg_paco2);
    }
  }, [paco2, formData.abg_paco2, formData.pulm_current_paco2, updateField]);

  useEffect(() => {
    if (!isNaN(ph) && formData.pulm_current_ph !== formData.abg_ph) {
      updateField("pulm_current_ph", formData.abg_ph);
    }
  }, [ph, formData.abg_ph, formData.pulm_current_ph, updateField]);

  useEffect(() => {
    if (!isNaN(hco3) && formData.pulm_current_hco3 !== formData.abg_hco3) {
      updateField("pulm_current_hco3", formData.abg_hco3);
    }
  }, [hco3, formData.abg_hco3, formData.pulm_current_hco3, updateField]);

  const isSigned = !!formData.abg_signed;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header Banner */}
      <div style={{ borderLeft: "3px solid #000000", background: "#ffffff", padding: "12px 16px", border: "1px solid #e0e0e0", borderLeftWidth: "3px" }}>
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Arterial Blood Gas (ABG) Draw
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666666", margin: "4px 0 0" }}>
          Point-in-time gas exchange sample. Feeds pH/PaCO2/PaO2/HCO3 into the patient's current values for GOLD staging and hypoxemia alerts.
        </p>
      </div>

      {/* 1. Pre-Draw Checklist */}
      <Section title="Pre-Draw Checklist" note="Confirm indication and site safety before puncture.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField
            label="INDICATION FOR DRAW"
            name="abg_indication"
            type="select"
            options={["", "Suspected Acute Exacerbation", "Chronic Hypercapnia Workup", "Pre/Post NIV Titration", "Post-Op Respiratory Monitoring", "Routine Home O2/NIV Reassessment", "Other"]}
          />
          <FormField label="SITE" name="abg_site" type="select" options={["", "Radial — left", "Radial — right", "Femoral", "Brachial"]} />
          <FormField label="ALLEN'S TEST" name="abg_allen" type="select" options={["", "Positive — collateral flow confirmed", "Negative — alternate site required", "Not Performed"]} />
          <FormField label="INSPIRED O2 AT DRAW" name="abg_fio2" placeholder="e.g. Room air (2L NC held 20 min prior)" />
          <FormField label="LOCAL ANAESTHETIC" name="abg_local" type="select" options={["", "1% lidocaine, 0.5mL", "None"]} />
          <FormField label="ORDERING CLINICIAN" name="abg_ordering_clinician" placeholder="e.g. Attending Pulmonologist" />
          <FormField label="ATTEMPT NUMBER" name="abg_attempt_number" type="select" options={["", "1st Attempt", "2nd Attempt", "3rd Attempt"]} />
        </div>
      </Section>

      {/* 2. Result & Gas Values */}
      <Section title="Result & Gas Values" note="Enter arterial blood gas values. Interpretation is calculated automatically from pH, PaCO2, and HCO3.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Ventilation (Acid-Base)</h4>
            <FormField label="pH (7.35 - 7.45)" name="abg_ph" type="number" />
            <FormField label="PaCO2 (35 - 45 mmHg)" name="abg_paco2" type="number" />
          </div>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Oxygenation</h4>
            <FormField label="PaO2 (80 - 100 mmHg)" name="abg_pao2" type="number" />
            <FormField label="SaO2 (%)" name="abg_sao2" type="number" />
            <FormField label="P/F Ratio (Auto-Calculated)" name="abg_pf_ratio" type="derived" placeholder="Requires PaO2 + FiO2" />
          </div>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Metabolic & Perfusion</h4>
            <FormField label="HCO3 (22 - 26 mmol/L)" name="abg_hco3" type="number" />
            <FormField label="Base Excess (-2 to +2)" name="abg_be" type="number" />
            <FormField label="Lactate (mmol/L)" name="abg_lactate" type="number" />
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <FormField
            label="Primary Disorder (Auto-Calc)"
            name="abg_interpretation"
            type="derived"
            placeholder="Requires pH, PaCO2, HCO3"
          />
          <FormField
            label="Oxygenation Status (Auto-Calc)"
            name="abg_oxygenation_status"
            type="derived"
            placeholder="Requires PaO2"
          />
        </div>
      </Section>

      {/* 3. Clinical Decision Tied to This Draw */}
      <Section title="Clinical Decision Tied to This Draw">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField
            label="ACTION TAKEN"
            name="abg_action"
            type="select"
            options={["", "No Change to Therapy", "BiPAP (NIV) Initiated", "O2 Titration Adjusted", "Escalated to ICU", "Repeat Draw Ordered"]}
          />
          <FormField
            label="COMPLICATIONS"
            name="abg_comp"
            type="select"
            options={["", "None", "Site Hematoma", "Arterial Spasm", "Failed Attempt — Repositioned", "Other (see notes)"]}
          />
          <FormField label="Additional Notes" name="abg_decision_notes" type="textarea" placeholder="Free-text context for the action taken..." />
        </div>
      </Section>

      {/* 4. Sign-off */}
      <Section title="Sign-off">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Performed By" name="abg_performed_by" placeholder="e.g. Attending Pulmonologist / Resident" />
          <FormField label="Date/Time of Draw" name="abg_signoff_datetime" type="datetime-local" />
        </div>
        <div style={{ border: "1px solid #e0e0e0", background: isSigned ? "#f0fdf4" : "#f5f5f5", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: isSigned ? "#166534" : "#666666" }}>
            {isSigned
              ? `Signed by ${formData.abg_performed_by || "Clinician"} · ${formData.abg_signoff_datetime || ""}`
              : "Awaiting Signature"}
          </div>
          {!isSigned ? (
            <button
              type="button"
              onClick={() => {
                const now = new Date().toISOString().slice(0, 16);
                updateField("abg_signed", true);
                if (!formData.abg_signoff_datetime) updateField("abg_signoff_datetime", now);
                if (!formData.abg_performed_by) updateField("abg_performed_by", formData.team_pulmonologist || "Attending Pulmonologist");
              }}
              style={{ padding: "6px 14px", background: "#000000", color: "#ffffff", border: "none", fontSize: "12px", cursor: "pointer" }}
            >
              Sign Off Draw
            </button>
          ) : (
            <button
              type="button"
              onClick={() => updateField("abg_signed", false)}
              style={{ padding: "4px 10px", background: "transparent", color: "#dc2626", border: "1px solid #dc2626", fontSize: "11px", cursor: "pointer" }}
            >
              Reopen
            </button>
          )}
        </div>
      </Section>
    </div>
  );
};

export default ABGProcedure;
