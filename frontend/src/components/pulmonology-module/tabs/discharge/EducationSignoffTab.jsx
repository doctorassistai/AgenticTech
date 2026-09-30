import React, { useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

export default function EducationSignoffTab() {
  const { formData = {}, updateField } = usePulmonology();

  // Prefill clinician name with Attending Pulmonologist if available
  useEffect(() => {
    if (!formData.disp_summary_signed_by && formData.team_pulmonologist) {
      updateField("disp_summary_signed_by", formData.team_pulmonologist);
    }
  }, [formData.disp_summary_signed_by, formData.team_pulmonologist, updateField]);

  // Electronic Sign-off Stamping
  const handleElectronicSignoff = () => {
    const timestamp = new Date().toISOString();
    updateField("disp_summary_signoff_datetime", timestamp);
    updateField("disp_signoff_complete", true);
    if (!formData.disp_summary_signed_by) {
      updateField("disp_summary_signed_by", formData.team_pulmonologist || "Attending Pulmonologist");
    }
    alert(`Encounter successfully signed and closed at ${new Date(timestamp).toLocaleString()}`);
  };

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
          Education, Counseling &amp; Electronic Sign-Off
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Patient and caregiver education verification, oxygen fire safety counseling, and formal electronic sign-off closing the encounter.
        </p>
      </div>

      {/* Caregiver Presence & Teach-Back Confirmation */}
      <Section title="Caregiver Presence & Teach-Back Confirmation" note="Validate comprehension before physical discharge">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField
            label="CAREGIVER / FAMILY MEMBER PRESENT"
            name="disp_caregiver_present"
            type="select"
            options={[
              "",
              "Yes — Primary Caregiver Present",
              "Yes — Family Member Present",
              "No — Patient Independent",
              "No — Caregiver Contacted via Phone",
            ]}
          />
          <FormField
            label="CAREGIVER NAME & RELATIONSHIP"
            name="disp_caregiver_name"
            placeholder="e.g. Caregiver Name (Relationship)"
          />
          <FormField
            label="TEACH-BACK DEMONSTRATED"
            name="disp_teach_back_confirmed"
            type="checkbox"
            inlineLabel="Patient/Caregiver demonstrated verbal understanding and return demo"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="OXYGEN FIRE SAFETY EDUCATED" name="disp_edu_o2_safety" type="checkbox" inlineLabel="No smoking near oxygen, 5ft clear from open flames" />
          <FormField label="WRITTEN COPD / ASTHMA ACTION PLAN" name="disp_edu_action_plan" type="checkbox" inlineLabel="Color-coded green/yellow/red action plan provided" />
          <FormField label="EMERGENCY CONTACT NUMBERS PROVIDED" name="disp_edu_contacts" type="checkbox" inlineLabel="24/7 clinic triage line and DME provider number given" />
        </div>
      </Section>

      {/* Formal Discharge Summary Electronic Sign-Off */}
      <Section title="Formal Discharge Summary Electronic Sign-Off" variant="dark" note="Locks encounter and timestamps the disposition">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
          <FormField
            label="DISCHARGING CLINICIAN NAME"
            name="disp_summary_signed_by"
            placeholder="e.g. Discharging Physician / Attending Pulmonologist"
          />
          <FormField
            label="SIGNOFF TIMESTAMP"
            name="disp_summary_signoff_datetime"
            type="derived"
            derivedValue={
              formData.disp_summary_signoff_datetime
                ? new Date(formData.disp_summary_signoff_datetime).toLocaleString()
                : "Pending clinician sign-off"
            }
          />
        </div>

        <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
          <button
            type="button"
            onClick={handleElectronicSignoff}
            disabled={Boolean(formData.disp_signoff_complete)}
            style={{
              padding: "9px 24px",
              background: formData.disp_signoff_complete ? "#2e7d32" : "#000",
              color: "#fff",
              border: "none",
              cursor: formData.disp_signoff_complete ? "default" : "pointer",
              fontSize: "12px",
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
            }}
          >
            {formData.disp_signoff_complete ? "Encounter Signed & Closed" : "Sign & Finalize Disposition"}
          </button>
          {formData.disp_signoff_complete && (
            <span style={{ fontSize: "12px", color: "#2e7d32", fontWeight: 600 }}>
              Encounter finalized on {new Date(formData.disp_summary_signoff_datetime).toLocaleDateString()}.
            </span>
          )}
        </div>
      </Section>
    </div>
  );
}
