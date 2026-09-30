import React, { useEffect, useMemo } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

function calcAgeFromDob(dobStr) {
  if (!dobStr) return null;
  const dob = new Date(dobStr);
  if (isNaN(dob.getTime())) return null;
  const diffMs = Date.now() - dob.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24 * 365.25));
}

// Enright & Sherrill (1998) reference equations
function calcPredicted6mwt({ sex, age, heightCm, weightKg }) {
  if (!sex || age === null || isNaN(heightCm) || isNaN(weightKg)) return null;
  let predicted, lln;
  if (sex === "Male") {
    predicted = 7.57 * heightCm - 5.02 * age - 1.76 * weightKg - 309;
    lln = predicted - 153;
  } else {
    predicted = 2.11 * heightCm - 2.29 * weightKg - 5.78 * age + 667;
    lln = predicted - 139;
  }
  return { predicted: Math.round(predicted), lln: Math.round(lln) };
}

const SixMWTProcedure = () => {
  const { formData, updateField } = usePulmonology();

  const age = calcAgeFromDob(formData.pt_dob);
  const heightCm = parseFloat(formData.pulm_clinical_height);
  const weightKg = parseFloat(formData.pulm_clinical_weight);
  const distance = parseFloat(formData.mwt_distance);
  const lowestSpo2 = parseFloat(formData.mwt_spo2_lowest);

  const predicted = useMemo(
    () => calcPredicted6mwt({ sex: formData.pt_sex, age, heightCm, weightKg }),
    [formData.pt_sex, age, heightCm, weightKg]
  );

  const pctPredicted = useMemo(() => {
    if (!predicted || isNaN(distance) || predicted.predicted <= 0) return null;
    return Math.round((distance / predicted.predicted) * 100);
  }, [predicted, distance]);

  useEffect(() => {
    if (pctPredicted === null) return;
    const belowLln = predicted && distance < predicted.lln;
    const label = `${distance} m (${pctPredicted}% predicted${belowLln ? " — below LLN" : ""})`;
    if (formData.mwt_dist !== label) updateField("mwt_dist", label);
  }, [pctPredicted, predicted, distance, formData.mwt_dist, updateField]);

  // Desaturation classification
  useEffect(() => {
    if (isNaN(lowestSpo2)) return;
    let label = "No Desaturation";
    if (lowestSpo2 < 88) label = "Significant (SpO2 <88%)";
    else if (lowestSpo2 <= 94) label = "Mild (SpO2 88-94%)";
    if (formData.ild_6mwt_desat !== label) updateField("ild_6mwt_desat", label);
    if (formData.mwt_nadir !== `${lowestSpo2}%${lowestSpo2 < 88 ? " (desaturation event)" : ""}`) {
      updateField("mwt_nadir", `${lowestSpo2}%${lowestSpo2 < 88 ? " (desaturation event)" : ""}`);
    }
  }, [lowestSpo2, formData.ild_6mwt_desat, formData.mwt_nadir, updateField]);

  // Push the walked distance into the shared "current" field
  useEffect(() => {
    if (!isNaN(distance) && formData.pulm_current_6mwt_m !== formData.mwt_distance) {
      updateField("pulm_current_6mwt_m", formData.mwt_distance);
    }
  }, [distance, formData.mwt_distance, formData.pulm_current_6mwt_m, updateField]);

  const isSigned = !!formData.mwt_signed;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header Banner */}
      <div style={{ borderLeft: "3px solid #000000", background: "#ffffff", padding: "12px 16px", border: "1px solid #e0e0e0", borderLeftWidth: "3px" }}>
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          6-Minute Walk Test (6MWT)
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666666", margin: "4px 0 0" }}>
          Functional exercise capacity test. Distance walked feeds the BODE Index directly on the Screening &amp; Alerts tab.
        </p>
      </div>

      {/* 1. Pre-Test Baseline */}
      <Section title="Pre-Test Baseline" note="Confirm contraindications and stable resting status before walking.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField
            label="INDICATION FOR TEST"
            name="mwt_indication"
            type="select"
            options={["", "COPD/ILD Severity Workup", "Lung Transplant Evaluation", "Pre/Post Pulmonary Rehab", "Pre-Op Functional Assessment", "Home O2 Qualification"]}
          />
          <FormField label="RESTING SPO2 (%)" name="mwt_spo2_rest" type="number" placeholder="e.g. 91" />
          <FormField label="RESTING HR / BP" name="mwt_vitals_rest" placeholder="e.g. 84 bpm / 128/78" />
          <FormField label="BASELINE BORG DYSPNEA (0-10)" name="mwt_borg_base" type="number" placeholder="e.g. 1" />
          <FormField label="SUPPLEMENTAL O2 DURING WALK" name="mwt_o2_walk" placeholder="e.g. 2 L/min NC" />
          <FormField label="WALKING AID USED" name="mwt_walking_aid" type="select" options={["", "None", "Cane", "Walker", "Wheelchair (unable to walk)"]} />
          <FormField
            label="PREDICTED DISTANCE (Auto-Calc)"
            name="mwt_predicted_display"
            type="derived"
            placeholder="Requires DOB, sex, height, weight"
          />
        </div>
      </Section>

      {/* 2. Walk Log & Test Outcome */}
      <Section title="Walk Log & Test Outcome" note="Record SpO2 and HR at specific minute marks during the test.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Minute-by-Minute Vitals</h4>
            <FormField label="SpO2 at 2 mins (%)" name="mwt_spo2_2m" type="number" />
            <FormField label="SpO2 at 4 mins (%)" name="mwt_spo2_4m" type="number" />
            <FormField label="SpO2 at 6 mins (%)" name="mwt_spo2_6m" type="number" />
            <FormField label="Lowest SpO2 Recorded (%)" name="mwt_spo2_lowest" type="number" />
            <FormField label="HR at 6 mins (bpm)" name="mwt_hr_6m" type="number" />
          </div>
          <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Test Outcome</h4>
            <FormField label="Total Distance Walked (meters)" name="mwt_distance" type="number" />
            <FormField label="Max HR Recorded (bpm)" name="mwt_hr_max" type="number" />
            <FormField label="Number of Rest Stops" name="mwt_rest_stops" type="number" placeholder="0 if none" />
            <FormField label="Test Completed?" name="mwt_completed" type="select" options={["", "Yes - Full 6 mins", "No - Stopped early due to dyspnea", "No - Stopped early due to desaturation", "No - Other"]} />
            <FormField label="Clinician Notes" name="mwt_notes" type="textarea" placeholder="Note any pauses, walking aids used, or specific complaints..." />
          </div>
        </div>
      </Section>

      {/* 3. Recovery & BODE Scoring */}
      <Section title="Recovery & BODE Scoring" note="Distance and desaturation feed the BODE Index (COPD) and 6MWT desaturation flag (ILD) automatically.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="RECOVERY SPO2 (1 MIN)" name="mwt_rec_spo2" type="number" placeholder="e.g. 90" />
          <FormField label="POST-TEST BORG DYSPNEA (0-10)" name="mwt_post_borg" type="number" placeholder="e.g. 6" />
          <FormField label="TOTAL DISTANCE (Auto-Calc)" name="mwt_dist" type="derived" placeholder="Requires distance walked + demographics" />
          <FormField label="SPO2 NADIR (Auto-Calc)" name="mwt_nadir" type="derived" placeholder="Requires lowest SpO2 recorded" />
          <FormField label="DESATURATION CLASSIFICATION (Auto-Calc)" name="ild_6mwt_desat" type="derived" placeholder="Requires lowest SpO2 recorded" />
        </div>
      </Section>

      {/* 4. Sign-off */}
      <Section title="Sign-off">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="Performed By" name="mwt_performed_by" placeholder="e.g. Respiratory Therapist" />
          <FormField label="Date/Time of Test" name="mwt_signoff_datetime" type="datetime-local" />
        </div>
        <div style={{ border: "1px solid #e0e0e0", background: isSigned ? "#f0fdf4" : "#f5f5f5", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: isSigned ? "#166534" : "#666666" }}>
            {isSigned
              ? `Signed by ${formData.mwt_performed_by || "Respiratory Therapist"} · ${formData.mwt_signoff_datetime || ""}`
              : "Awaiting Signature"}
          </div>
          {!isSigned ? (
            <button
              type="button"
              onClick={() => {
                const now = new Date().toISOString().slice(0, 16);
                updateField("mwt_signed", true);
                if (!formData.mwt_signoff_datetime) updateField("mwt_signoff_datetime", now);
                if (!formData.mwt_performed_by) updateField("mwt_performed_by", formData.team_rt || "Respiratory Therapist");
              }}
              style={{ padding: "6px 14px", background: "#000000", color: "#ffffff", border: "none", fontSize: "12px", cursor: "pointer" }}
            >
              Sign Off 6MWT
            </button>
          ) : (
            <button
              type="button"
              onClick={() => updateField("mwt_signed", false)}
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

export default SixMWTProcedure;
