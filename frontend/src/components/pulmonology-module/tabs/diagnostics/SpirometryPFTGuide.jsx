import React, { useEffect, useMemo } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

// Standard ATS/ERS thresholds — fixed cutoffs, same "safe to automate"
// category as the GOLD spirometric grade in ScreeningAlertsTab.
function classifyPattern({ ratioPost, fvcPct }) {
  if (ratioPost == null || isNaN(ratioPost) || ratioPost <= 0) return "";
  const obstructed = ratioPost < 0.70;
  const restrictedSuspected = !isNaN(fvcPct) && fvcPct < 80;
  if (obstructed && restrictedSuspected) return "Mixed Obstructive/Restrictive Pattern";
  if (obstructed) return "Obstructive Pattern";
  if (restrictedSuspected) return "Restrictive Pattern Suspected (confirm with TLC)";
  return "Normal Spirometry";
}

function classifyReversibility({ fev1Pre, fev1Post }) {
  if (fev1Pre == null || fev1Post == null || isNaN(fev1Pre) || isNaN(fev1Post) || fev1Pre <= 0 || fev1Post <= 0) return "";
  const deltaL = fev1Post - fev1Pre;
  const deltaPct = deltaL / fev1Pre;
  if (deltaPct >= 0.12 && deltaL >= 0.2) return "Positive (>12% and 200mL)";
  return "Negative";
}

const SpirometryProcedure = () => {
  const { formData, updateField } = usePulmonology();

  const fev1Pre = parseFloat(formData.pft_fev1_pre);
  const fev1Post = parseFloat(formData.pft_fev1_post);
  const fvcPre = parseFloat(formData.pft_fvc_pre);
  const fvcPost = parseFloat(formData.pft_fvc_post);
  const fev1Pct = parseFloat(formData.pft_fev1_pct);
  const fvcPct = parseFloat(formData.pft_fvc_pct);
  const dlcoPct = parseFloat(formData.pft_dlco_pct);

  // FEV1/FVC ratio, pre and post — computed instead of hand-entered
  const ratioPre = useMemo(() => (fev1Pre > 0 && fvcPre > 0 ? fev1Pre / fvcPre : null), [fev1Pre, fvcPre]);
  const ratioPost = useMemo(() => (fev1Post > 0 && fvcPost > 0 ? fev1Post / fvcPost : null), [fev1Post, fvcPost]);

  useEffect(() => {
    if (ratioPre === null) {
      if (formData.pft_ratio_pre) updateField("pft_ratio_pre", "");
      return;
    }
    const val = ratioPre.toFixed(2);
    if (formData.pft_ratio_pre !== val) updateField("pft_ratio_pre", val);
  }, [ratioPre, formData.pft_ratio_pre, updateField]);

  useEffect(() => {
    if (ratioPost === null) {
      if (formData.pft_ratio_post) updateField("pft_ratio_post", "");
      return;
    }
    const val = ratioPost.toFixed(2);
    if (formData.pft_ratio_post !== val) updateField("pft_ratio_post", val);
  }, [ratioPost, formData.pft_ratio_post, updateField]);

  const pattern = useMemo(
    () => classifyPattern({ ratioPost, fvcPct }),
    [ratioPost, fvcPct]
  );
  useEffect(() => {
    if (pattern) {
      if (formData.pft_pattern !== pattern) updateField("pft_pattern", pattern);
    } else {
      if (formData.pft_pattern) updateField("pft_pattern", "");
    }
  }, [pattern, formData.pft_pattern, updateField]);

  const reversibility = useMemo(
    () => classifyReversibility({ fev1Pre, fev1Post }),
    [fev1Pre, fev1Post]
  );
  useEffect(() => {
    if (reversibility) {
      if (formData.pft_reversibility !== reversibility) updateField("pft_reversibility", reversibility);
    } else {
      if (formData.pft_reversibility) updateField("pft_reversibility", "");
    }
  }, [reversibility, formData.pft_reversibility, updateField]);

  // Push post-bronchodilator FEV1%/FVC%/DLCO% into the shared "current"
  // fields BaselineTab defines — these feed GOLD stage, BODE, and GAP directly.
  useEffect(() => {
    if (!isNaN(fev1Pct) && formData.pulm_current_fev1_pct !== formData.pft_fev1_pct) {
      updateField("pulm_current_fev1_pct", formData.pft_fev1_pct);
    }
  }, [fev1Pct, formData.pft_fev1_pct, formData.pulm_current_fev1_pct, updateField]);

  useEffect(() => {
    if (!isNaN(fvcPct) && formData.pulm_current_fvc_pct !== formData.pft_fvc_pct) {
      updateField("pulm_current_fvc_pct", formData.pft_fvc_pct);
    }
  }, [fvcPct, formData.pft_fvc_pct, formData.pulm_current_fvc_pct, updateField]);

  useEffect(() => {
    if (!isNaN(dlcoPct) && formData.pulm_current_dlco_pct !== formData.pft_dlco_pct) {
      updateField("pulm_current_dlco_pct", formData.pft_dlco_pct);
    }
  }, [dlcoPct, formData.pft_dlco_pct, formData.pulm_current_dlco_pct, updateField]);

  const isSigned = !!formData.spiro_signed;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Top Banner */}
      <div style={{ borderLeft: "3px solid #000000", background: "#ffffff", padding: "12px 16px", border: "1px solid #e0e0e0", borderLeftWidth: "3px" }}>
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Spirometry / PFT Session
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666666", margin: "4px 0 0" }}>
          Pre- and post-bronchodilator spirometry. Post-BD FEV1%/FVC%/DLCO% feed GOLD stage, BODE, and GAP Index directly.
        </p>
      </div>

      {/* 1. Session Details */}
      <Section title="Session Details" note="Confirm test quality before entering values — ATS/ERS acceptability criteria affect interpretability.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField
            label="INDICATION FOR TEST"
            name="spiro_indication"
            type="select"
            options={["", "New Dyspnea Workup", "COPD/Asthma Diagnosis", "Annual Disease Monitoring", "Pre-Op Clearance", "Occupational Screening"]}
          />
          <FormField label="TECHNICIAN" name="spiro_tech" placeholder="e.g. R. Balan, RPFT" />
          <FormField
            label="EFFORT / REPRODUCIBILITY"
            name="spiro_effort"
            type="select"
            options={["", "3 acceptable maneuvers, ATS criteria met", "2 acceptable maneuvers, borderline", "Poor effort — repeat recommended"]}
          />
          <FormField label="BRONCHODILATOR USED" name="spiro_bd" placeholder="e.g. Salbutamol 400mcg via spacer" />
          <FormField label="WAIT TIME TO POST-TEST (min)" name="spiro_wait" type="number" placeholder="e.g. 15" />
          <FormField label="PATIENT POSITION" name="spiro_position" type="select" options={["", "Seated", "Standing"]} />
        </div>
      </Section>

      {/* 2. Values & Reversibility */}
      <Section title="Spirometry Values & Reversibility" note="Enter absolute values in Liters. Ratios, pattern, and reversibility are calculated automatically.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>FEV1 (Liters)</h4>
            <FormField label="Pre-Bronchodilator" name="pft_fev1_pre" type="number" />
            <FormField label="Post-Bronchodilator" name="pft_fev1_post" type="number" />
            <FormField label="% Predicted (Post)" name="pft_fev1_pct" type="number" />
          </div>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>FVC (Liters)</h4>
            <FormField label="Pre-Bronchodilator" name="pft_fvc_pre" type="number" />
            <FormField label="Post-Bronchodilator" name="pft_fvc_post" type="number" />
            <FormField label="% Predicted (Post)" name="pft_fvc_pct" type="number" />
          </div>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>FEV1 / FVC Ratio (Auto-Calc)</h4>
            <FormField label="Pre-Bronchodilator" name="pft_ratio_pre" type="derived" placeholder="Requires pre FEV1 + FVC" />
            <FormField label="Post-Bronchodilator" name="pft_ratio_post" type="derived" placeholder="Requires post FEV1 + FVC" />
            <FormField label="Pattern (Auto-Calc)" name="pft_pattern" type="derived" placeholder="Obstructive if < 0.70" />
          </div>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Lung Volumes & Diffusion</h4>
            <FormField label="TLC % Predicted" name="pft_tlc_pct" type="number" />
            <FormField label="DLCO % Predicted" name="pft_dlco_pct" type="number" />
            <FormField label="PEF (L/sec)" name="pft_pef" type="number" />
            <FormField label="FEF25-75% (L/sec)" name="pft_fef2575" type="number" />
            <FormField label="Reversibility (Auto-Calc)" name="pft_reversibility" type="derived" placeholder="Requires pre/post FEV1" />
          </div>
        </div>
      </Section>

      {/* 3. Technician Notes / Interpretation */}
      <Section title="Technician Notes / Interpretation">
        <FormField
          label="INTERPRETATION & GOLD STAGING"
          name="spiro_notes"
          type="textarea"
          placeholder="Document spirometry trends, post-bronchodilator reversibility, and airflow obstruction findings..."
        />
      </Section>

      {/* 4. Sign-off */}
      <Section title="Sign-off">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Performed By" name="spiro_performed_by" placeholder="e.g. R. Balan, RPFT" />
          <FormField label="Date/Time of Test" name="spiro_signoff_datetime" type="datetime-local" />
        </div>
        <div style={{ border: "1px solid #e0e0e0", background: isSigned ? "#f0fdf4" : "#f5f5f5", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: isSigned ? "#166534" : "#666666" }}>
            {isSigned 
              ? `Signed by ${formData.spiro_performed_by || "RPFT"} · ${formData.spiro_signoff_datetime || ""}` 
              : "Awaiting Signature"}
          </div>
          {!isSigned ? (
            <button
              type="button"
              onClick={() => {
                const now = new Date().toISOString().slice(0, 16);
                updateField("spiro_signed", true);
                if (!formData.spiro_signoff_datetime) updateField("spiro_signoff_datetime", now);
                if (!formData.spiro_performed_by) updateField("spiro_performed_by", formData.team_pulmonologist || "Pulmonary Technologist");
              }}
              style={{ padding: "6px 14px", background: "#000000", color: "#ffffff", border: "none", fontSize: "12px", cursor: "pointer" }}
            >
              Sign Off Test
            </button>
          ) : (
            <button
              type="button"
              onClick={() => updateField("spiro_signed", false)}
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

export default SpirometryProcedure;
