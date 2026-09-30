import React, { useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";
import { getDefaultReturnPrecautions } from "./dispositionHelpers";

export default function FollowupReferralsTab() {
  const { formData = {}, updateField } = usePulmonology();

  // Auto-suggest Default Return Precautions on initial load
  useEffect(() => {
    if (!formData.disp_return_precautions && formData.pulm_primary_dx) {
      const defaultText = getDefaultReturnPrecautions(formData.pulm_primary_dx);
      updateField("disp_return_precautions", defaultText);
    }
  }, [formData.disp_return_precautions, formData.pulm_primary_dx, updateField]);

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
          Follow-Up Appointments, Specialist Referrals &amp; Patient Education
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Outpatient clinic scheduling, pulmonary rehab linkage, warning precautions, action plan delivery, and home oxygen safety counseling.
        </p>
      </div>

      {/* Post-Discharge Appointments */}
      <Section title="Post-Discharge Appointments & Clinical Accountability" note="Ensure continuity of care across outpatient services">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="PULMONOLOGY CLINIC FOLLOW-UP DATE" name="disp_followup_pulm_date" type="date" />
          <FormField label="PULMONOLOGY PROVIDER / LOCATION" name="disp_followup_pulm_clinic" placeholder="e.g. Chest Clinic, Room 402" />
          <FormField label="PRIMARY CARE (PCP) FOLLOW-UP DATE" name="disp_followup_pcp_date" type="date" />
          <FormField label="PCP PHYSICIAN / CLINIC NAME" name="disp_followup_pcp_name" placeholder="e.g. Dr. John Smith / Main Street Health" />
        </div>
      </Section>

      {/* Specialist & Supportive Referrals */}
      <Section title="Specialist & Supportive Referrals" note="Check all referrals initiated during encounter">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField label="PULMONARY REHABILITATION" name="disp_ref_rehab" type="checkbox" inlineLabel="Outpatient Pulmonary Rehab (GOLD Group E indication)" />
          <FormField label="SLEEP MEDICINE / CPAP TITRATION" name="disp_ref_sleep" type="checkbox" inlineLabel="Diagnostic Polysomnography (PSG) / Sleep Clinic" />
          <FormField label="PALLIATIVE & SYMPTOM CARE" name="disp_ref_palliative" type="checkbox" inlineLabel="Palliative Care consultation for refractory dyspnea" />
          <FormField label="THORACIC SURGERY CONSULTATION" name="disp_ref_thoracic" type="checkbox" inlineLabel="LVRS, Bullectomy, or Interventional review" />
          <FormField label="LUNG TRANSPLANT PROGRAM" name="disp_ref_tx" type="checkbox" inlineLabel="Tertiary Lung Transplant Center referral" />
          <FormField label="SMOKING CESSATION PROGRAM" name="disp_ref_smoking" type="checkbox" inlineLabel="Structured behavioral & pharmacotherapy program" />
        </div>
      </Section>

      {/* Red-Flag Symptoms & Emergency Return Precautions */}
      <Section title="Red-Flag Symptoms & Emergency Return Precautions" note="Clear, patient-centered return instructions">
        <FormField
          label="PATIENT-FACING RETURN PRECAUTIONS"
          name="disp_return_precautions"
          type="textarea"
          placeholder="Return immediately if experiencing severe dyspnea at rest, hemoptysis, sudden chest pain, fever >38.5°C, or SpO2 dropping below prescribed threshold..."
        />
      </Section>

      {/* Patient & Caregiver Education, Counseling & Safety Clearance */}
      <Section title="Patient & Caregiver Education & Safety Clearance" note="Validate comprehension, action plan delivery, and home oxygen safety">
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
            placeholder="e.g. Spouse / Adult Child"
          />
          <FormField
            label="TEACH-BACK DEMONSTRATED"
            name="disp_teach_back_confirmed"
            type="checkbox"
            inlineLabel="Patient/Caregiver demonstrated verbal understanding and return demo"
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField
            label="OXYGEN FIRE SAFETY COUNSELED"
            name="disp_edu_o2_safety"
            type="checkbox"
            inlineLabel="No smoking near O2, 5ft clear from open flames & heat sources"
          />
          <FormField
            label="WRITTEN COPD / ASTHMA ACTION PLAN"
            name="disp_edu_action_plan"
            type="checkbox"
            inlineLabel="Color-coded green/yellow/red exacerbation action plan delivered"
          />
          <FormField
            label="EMERGENCY CONTACT NUMBERS PROVIDED"
            name="disp_edu_contacts"
            type="checkbox"
            inlineLabel="24/7 clinic triage and DME provider support contact numbers given"
          />
        </div>
      </Section>
    </div>
  );
}
