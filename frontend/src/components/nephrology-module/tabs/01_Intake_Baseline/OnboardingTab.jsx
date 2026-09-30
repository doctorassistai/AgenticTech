import React, { useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import { getDoctorDetails } from "../../services/nephrologyApi";

const ONBOARDING_DICTATION_FIELDS = [
  { k: "v2_encounter_type", label: "Encounter Type", type: "select", options: ["Outpatient Clinic", "Emergency Department", "Admitted (Inpatient)"] },
  { k: "v2_admission_reason", label: "Admission Reason", type: "select", options: ["AKI", "CKD Exacerbation", "Dialysis Complication", "Transplant"] },
  { k: "v2_name", label: "Patient Name", type: "text" },
  { k: "v2_dob", label: "Date of Birth", type: "date" },
  { k: "v2_gender", label: "Gender", type: "select", options: ["Male", "Female", "Other"] },
  { k: "v2_ethnicity", label: "Ethnicity", type: "text" },
  { k: "v2_contact", label: "Contact Information", type: "tel" },
  { k: "v2_emergency_contact_name", label: "Emergency Contact Name", type: "text" },
  { k: "v2_emergency_contact_relation", label: "Emergency Contact Relation", type: "text" },
  { k: "v2_emergency_contact_number", label: "Emergency Contact Number", type: "tel" },
  { k: "v2_payer", label: "Payer Information", type: "text" },
  { k: "v2_coverage", label: "Coverage Verification", type: "select", options: ["Verified", "Pending", "Denied"] },
  { k: "v2_auth_track", label: "Authorization Tracking", type: "text" },
  { k: "v2_sdoh_housing", label: "Housing Stability", type: "select", options: ["Stable", "Unstable", "Homeless"] },
  { k: "v2_sdoh_food", label: "Food Security", type: "select", options: ["Secure", "Insecure"] },
  { k: "v2_sdoh_transport", label: "Transportation Access", type: "select", options: ["Reliable", "Unreliable"] },
  { k: "v2_sdoh_education", label: "Education Level", type: "text" },
  { k: "v2_sdoh_employment", label: "Employment Status", type: "select", options: ["Employed", "Unemployed", "Retired", "Disabled"] },
  { k: "v2_sdoh_support", label: "Social Support Network", type: "select", options: ["Strong", "Limited", "None"] },
  { k: "v2_lifestyle_diet", label: "Diet Habits", type: "text" },
  { k: "v2_lifestyle_sodium", label: "Sodium Intake Estimation", type: "text" },
  { k: "v2_lifestyle_fluid", label: "Fluid Intake", type: "text" },
  { k: "v2_lifestyle_exercise", label: "Exercise Patterns", type: "text" },
  { k: "v2_lifestyle_smoking", label: "Smoking Use", type: "select", options: ["Never", "Former", "Current"] },
  { k: "v2_lifestyle_alcohol", label: "Alcohol Use", type: "select", options: ["None", "Occasional", "Frequent"] },
  { k: "v2_team_neph", label: "Nephrologist", type: "text" },
  { k: "v2_team_nurse", label: "Nurse Coordinator", type: "text" },
  { k: "v2_team_dietitian", label: "Dietitian", type: "text" },
  { k: "v2_team_social_worker", label: "Social Worker", type: "text" },
];

const OnboardingTab = () => {
  const { formData, updateField } = useNephrology();

  useEffect(() => {
    const resolvePhysicianName = async () => {
      let updatedName = formData.v2_team_neph;
      if (updatedName && updatedName.startsWith("DOC-")) {
        try {
          const docRes = await getDoctorDetails(updatedName);
          const profile = docRes?.doctor || docRes?.data || docRes || {};
          const realName = profile.doctor_name || profile.name || profile.full_name || (profile.first_name ? `${profile.first_name} ${profile.last_name}` : null);
          if (realName) {
            updateField("v2_team_neph", realName);
          }
        } catch (err) {
          console.warn("Could not fetch doctor details for ID:", updatedName);
        }
      }
    };
    resolvePhysicianName();
  }, [formData.v2_team_neph, updateField]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Nephrology Intake and Onboarding" fields={ONBOARDING_DICTATION_FIELDS} />
      <Section title="Encounter Information" note="Determine patient status and routing.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField 
            label="Encounter Type" 
            name="v2_encounter_type" 
            type="select" 
            options={["", "Outpatient Clinic", "Emergency Department", "Admitted (Inpatient)"]} 
          />
          
          {formData.v2_encounter_type === "Admitted (Inpatient)" && (
            <FormField 
              label="Admission Reason" 
              name="v2_admission_reason" 
              type="select" 
              options={["", "AKI", "CKD Exacerbation", "Dialysis Complication", "Transplant"]} 
            />
          )}
        </div>
      </Section>

      <Section title="Demographics Capture" note="Baseline patient identifiers.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Name" name="v2_name" />
          <FormField label="DOB" name="v2_dob" type="date" />
          <FormField label="Gender" name="v2_gender" type="select" options={["", "Male", "Female", "Other"]} />
          <FormField label="Ethnicity" name="v2_ethnicity" />
          <FormField label="Contact Information" name="v2_contact" />
          <FormField label="Emergency Contact Name" name="v2_emergency_contact_name" />
          <FormField label="Emergency Contact Relation" name="v2_emergency_contact_relation" />
          <FormField label="Emergency Contact Number" name="v2_emergency_contact_number" />
        </div>
      </Section>

      <Section title="Insurance & Billing Integration" note="Payer info and coverage.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Payer Information" name="v2_payer" />
          <FormField label="Coverage Verification" name="v2_coverage" type="select" options={["", "Verified", "Pending", "Denied"]} />
          <FormField label="Authorization Tracking" name="v2_auth_track" />
        </div>
      </Section>

      <Section title="Social Determinants of Health (SDOH)" note="Environmental and socioeconomic factors impacting care.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Housing Stability" name="v2_sdoh_housing" type="select" options={["", "Stable", "Unstable", "Homeless"]} />
          <FormField label="Food Security" name="v2_sdoh_food" type="select" options={["", "Secure", "Insecure"]} />
          <FormField label="Transportation Access" name="v2_sdoh_transport" type="select" options={["", "Reliable", "Unreliable"]} />
          <FormField label="Education Level" name="v2_sdoh_education" />
          <FormField label="Employment Status" name="v2_sdoh_employment" type="select" options={["", "Employed", "Unemployed", "Retired", "Disabled"]} />
          <FormField label="Social Support Network" name="v2_sdoh_support" type="select" options={["", "Strong", "Limited", "None"]} />
        </div>
      </Section>

      <Section title="Lifestyle Factors" note="Habits and intake.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Diet Habits" name="v2_lifestyle_diet" />
          <FormField label="Sodium Intake Estimation" name="v2_lifestyle_sodium" />
          <FormField label="Fluid Intake" name="v2_lifestyle_fluid" />
          <FormField label="Exercise Patterns" name="v2_lifestyle_exercise" />
          <FormField label="Smoking Use" name="v2_lifestyle_smoking" type="select" options={["", "Never", "Former", "Current"]} />
          <FormField label="Alcohol Use" name="v2_lifestyle_alcohol" type="select" options={["", "None", "Occasional", "Frequent"]} />
        </div>
      </Section>

      <Section title="Care Team Assignment" note="Automatic assignment based on location/availability/specialization.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="Nephrologist" name="v2_team_neph" />
          <FormField label="Nurse Coordinator" name="v2_team_nurse" />
          <FormField label="Dietitian" name="v2_team_dietitian" />
          <FormField label="Social Worker" name="v2_team_social_worker" />
        </div>
      </Section>
    </div>
  );
};

export default OnboardingTab;
