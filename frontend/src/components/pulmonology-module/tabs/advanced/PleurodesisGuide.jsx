import React, { useMemo, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

export default function PleurodesisGuide() {
  const { formData, updateField } = usePulmonology();

  // Derived: Sclerotherapy Outcome Classification
  const outcomeStatus = useMemo(() => {
    if (formData.pleurx_recurrence) {
      return {
        label: "Recurrence Noted — Treatment Failure",
        color: "#b71c1c",
        bg: "#ffebee",
        border: "#ef9a9a",
        note: "Pleural effusion or pneumothorax recurrence observed on imaging. Evaluate for indwelling pleural catheter (IPC) or repeat pleurodesis.",
      };
    }
    if (formData.pleurx_repeat_imaging) {
      return {
        label: "Successful Pleurodesis (No Recurrence)",
        color: "#2e7d32",
        bg: "#f0fdf4",
        border: "#81c784",
        note: "Follow-up imaging confirms sustained pleural symphysis without fluid re-accumulation.",
      };
    }
    return null;
  }, [formData.pleurx_recurrence, formData.pleurx_repeat_imaging]);

  useEffect(() => {
    if (outcomeStatus && formData.pleurx_outcome !== outcomeStatus.label) {
      updateField("pleurx_outcome", outcomeStatus.label);
    }
  }, [outcomeStatus, formData.pleurx_outcome, updateField]);

  const hasFeverAlert = Boolean(formData.pleurx_fever);

  const handleSignoff = () => {
    updateField("pleurx_signoff_timestamp", new Date().toISOString());
    updateField("pleurx_signoff_status", "Signed — complete");
  };

  return (
    <div>
      <div
        style={{
          borderLeft: "3px solid #000",
          background: "#fff",
          padding: "12px 16px",
          border: "1px solid #e0e0e0",
          borderLeftWidth: "3px",
          marginBottom: "16px",
        }}
      >
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Chemical &amp; Surgical Pleurodesis Guide
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Sclerosant instillation (talc slurry, doxycycline, poudrage), post-procedure pain/fever surveillance, and follow-up outcome tracking.
        </p>
      </div>

      {/* Post-Procedure Fever Banner */}
      {hasFeverAlert && (
        <div
          style={{
            border: "1px solid #ffcc80",
            backgroundColor: "#fff3e0",
            padding: "12px 16px",
            marginBottom: "16px",
            borderRadius: "2px",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 700, color: "#e65100", marginBottom: "4px" }}>
            Post-Pleurodesis Pyrexia Documented
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "#333" }}>
            Transient fever occurs in 15–30% of talc pleurodesis cases due to acute pleural inflammatory symphysis. Monitor for respiratory compromise, acute lung injury (ALI), or empyema.
          </p>
        </div>
      )}

      {/* Outcome Status Banner */}
      {outcomeStatus && (
        <div
          style={{
            border: `1px solid ${outcomeStatus.border}`,
            backgroundColor: outcomeStatus.bg,
            padding: "12px 16px",
            marginBottom: "16px",
            borderRadius: "2px",
          }}
        >
          <div style={{ fontSize: "12px", fontWeight: 700, color: outcomeStatus.color, marginBottom: "4px" }}>
            {outcomeStatus.label}
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "#333" }}>
            {outcomeStatus.note}
          </p>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        {/* Indication, Lung Re-Expansion & Consent Verification */}
        <Section title="Indication, Lung Re-Expansion & Consent Verification">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
            <FormField
              label="PRIMARY INDICATION"
              name="pleurx_indication"
              type="select"
              options={[
                "Recurrent malignant pleural effusion (MPE) — symptomatic",
                "Recurrent secondary spontaneous pneumothorax",
                "Persistent air leak (>5–7 days post-chest tube)",
                "Refractory hepatic hydrothorax (exceptional cases)",
              ]}
            />
            <FormField
              label="LUNG RE-EXPANSION CONFIRMED (NO TRAPPED LUNG)?"
              name="pleurx_reexpansion_confirmed"
              type="checkbox"
              placeholder="CXR confirms apposition"
            />
            <FormField label="INFORMED CONSENT SIGNED?" name="pleurx_consent" type="checkbox" placeholder="Consent verified" />
            <FormField label="PROCEDURE DATE" name="pleurx_date" type="date" />
          </div>
        </Section>

        {/* Procedure & Sclerosant Details */}
        <Section title="Sclerosant Agent, Delivery Method & Administration">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField
              label="SCLEROSING AGENT"
              name="pleurx_agent"
              type="select"
              options={[
                "Sterile graded talc slurry (4–5g in 50 mL sterile saline)",
                "Talc poudrage via medical thoracoscopy (3–5g aerosolized)",
                "Doxycycline slurry (500 mg in 50 mL saline)",
                "Bleomycin (60 units in 50 mL saline)",
                "Autologous blood patch (50–100 mL patient blood)",
              ]}
            />
            <FormField
              label="DELIVERY METHOD"
              name="pleurx_method"
              type="select"
              options={[
                "Instillation via chest tube (ICD) with gravity flush",
                "Instillation via small-bore pigtail catheter",
                "Thoracoscopic insufflation under direct vision (VATS)",
              ]}
            />
            <FormField label="DOSE / COMPOSITION" name="pleurx_dose" placeholder="e.g. 4g sterile talc + 20 mL 1% lidocaine" />
            <FormField
              label="POST-INSTILLATION CLAMP TIME"
              name="pleurx_clamp_time"
              type="select"
              options={[
                "Clamped 1 hour (rotation not strictly required per BTS)",
                "Clamped 2 hours with patient repositioning",
                "Not clamped — free drainage with water seal",
              ]}
            />
            <FormField label="PERFORMING OPERATOR" name="pleurx_performed_by" placeholder="e.g. Attending / Fellow / Operator" />
          </div>
        </Section>

        {/* Post-Procedure Monitoring */}
        <Section title="Post-Pleurodesis Surveillance & Follow-up">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="POST-PROCEDURE PAIN SCORE (0–10 VAS)" name="pleurx_pain_score" type="number" placeholder="e.g. 4" />
            <FormField label="POST-PROCEDURE PYREXIA / FEVER (≥38°C)?" name="pleurx_fever" type="checkbox" placeholder="Fever documented" />
            <FormField label="EFFUSION RECURRENCE NOTED ON FOLLOW-UP?" name="pleurx_recurrence" type="checkbox" placeholder="Recurrence detected" />
          </div>
          <div style={{ marginTop: "14px" }}>
            <FormField
              label="REPEAT IMAGING & RESPONSE NARRATIVE"
              name="pleurx_repeat_imaging"
              type="textarea"
              placeholder="Document 24h, 7-day, and 30-day post-pleurodesis CXR or ultrasound findings (pleural obliteration, costophrenic angle clearance)..."
            />
          </div>
        </Section>

        {/* Sign-off */}
        <Section title="Procedural Sign-off & Verification">
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
            <FormField label="ATTENDING PROCEDURALIST" name="pleurx_signoff_by" placeholder="e.g. Attending Proceduralist" />
            <FormField
              label="SIGNOFF TIMESTAMP"
              name="pleurx_signoff_timestamp"
              type="derived"
              derivedValue={formData.pleurx_signoff_timestamp || "Pending Finalization"}
            />
            <FormField
              label="STATUS"
              name="pleurx_signoff_status"
              type="derived"
              derivedValue={formData.pleurx_signoff_status || "In Progress"}
            />
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              onClick={handleSignoff}
              style={{
                padding: "8px 22px",
                backgroundColor: "#000000",
                color: "#ffffff",
                border: "none",
                fontSize: "12.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Sign and Finalize Pleurodesis Note
            </button>
          </div>
        </Section>
      </div>
    </div>
  );
}
