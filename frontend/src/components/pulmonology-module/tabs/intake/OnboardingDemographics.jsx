import React, { useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";
import { getDoctorDetails } from "../../services/pulmonologyApi";

const OnboardingTab = () => {
  const { formData = {}, updateField } = usePulmonology();

  useEffect(() => {
    const resolvePhysicianName = async () => {
      let updatedName = formData.team_pulmonologist;
      if (!updatedName) return;

      // Detect doctor ID whether raw DOC-..., Dr. DOC-..., or embedded
      let rawDocId = null;
      const stripped = updatedName.replace(/^Dr\.?\s*/i, "").trim();
      if (updatedName.startsWith("DOC-")) {
        rawDocId = updatedName.trim();
      } else if (stripped.startsWith("DOC-")) {
        rawDocId = stripped;
      } else if (updatedName.includes("DOC-")) {
        const match = updatedName.match(/DOC-[a-f0-9-]+/i);
        if (match) rawDocId = match[0];
      }

      if (rawDocId) {
        try {
          const docRes = await getDoctorDetails(rawDocId);
          const profile = docRes?.doctor || docRes?.data || docRes || {};
          let realName =
            profile.doctor_name ||
            profile.name ||
            profile.full_name ||
            (profile.first_name ? `${profile.first_name} ${profile.last_name}` : null);
          if (realName) {
            let formatted = realName.trim();
            if (formatted.startsWith("Dr.") && !formatted.startsWith("Dr. ")) {
              formatted = formatted.replace(/^Dr\./, "Dr. ");
            } else if (!formatted.startsWith("Dr.") && !formatted.startsWith("Dr ")) {
              formatted = `Dr. ${formatted}`;
            }
            updateField("team_pulmonologist", formatted);
          }
        } catch (err) {
          console.warn("Could not fetch doctor details for ID:", rawDocId);
        }
      }
    };
    resolvePhysicianName();
  }, [formData.team_pulmonologist, updateField]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Onboarding & Demographics" />
      <Section id="sec_encounter" title="Encounter Information" note="Determine patient status and routing.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField
            label="Encounter Type"
            name="pulm_encounter_type"
            type="select"
            options={[
              "",
              "Outpatient Clinic",
              "Emergency Department",
              "Admitted (Inpatient)",
              "Pulmonary Function Testing (PFT)",
              "Bronchoscopy / Procedure",
              "Pulmonary Rehab",
              "Telehealth",
            ]}
          />

          {formData.pulm_encounter_type === "Admitted (Inpatient)" && (
            <FormField
              label="Admission Reason"
              name="pulm_admission_reason"
              type="select"
              options={[
                "",
                "COPD Exacerbation",
                "Acute Respiratory Failure",
                "Pneumonia / Severe Sepsis",
                "Pleural Effusion / Empyema",
                "Pneumothorax",
                "Hemoptysis",
                "Asthma Exacerbation",
                "Lung Transplant Complication",
              ]}
            />
          )}

          <FormField
            label="Primary Respiratory Complaint"
            name="pulm_visit_reason"
            type="select"
            options={[
              "",
              "Shortness of Breath (Dyspnea)",
              "Chronic Cough",
              "COPD / Asthma Exacerbation",
              "Abnormal Chest Imaging",
              "Sleep Apnea Evaluation",
              "Pre-operative Pulmonary Clearance",
            ]}
          />
          <FormField label="Referred By" name="pulm_referred_by" placeholder="e.g., Dr. Smith (Cardiology / PCP)" />
        </div>
      </Section>

      <Section id="sec_demographics" title="Demographics Capture" note="Baseline patient identifiers.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="Full Name" name="pt_name" />
          <FormField label="MRN" name="pt_mrn" />
          <FormField label="Date of Birth" name="pt_dob" type="date" />
          <FormField label="Biological Sex" name="pt_sex" type="select" options={["", "Male", "Female", "Other"]} />
          <FormField label="Ethnicity / Race" name="pt_ethnicity" />
          <FormField label="Primary Language" name="pt_language" />
          <FormField label="Contact Number" name="pt_contact" type="tel" />
          <FormField label="Email Address" name="pt_email" type="email" />
        </div>
      </Section>

      <Section id="sec_emergency" title="Emergency Contacts & Proxy" note="Next of kin and medical proxy info.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Emergency Contact Name" name="pt_ec_name" />
          <FormField label="Emergency Contact Relation" name="pt_ec_relation" />
          <FormField label="Emergency Contact Number" name="pt_ec_number" type="tel" />
          <FormField label="Healthcare Proxy / POA Name" name="pt_poa_name" />
          <FormField label="Healthcare Proxy Relation" name="pt_poa_relation" />
          <FormField label="Healthcare Proxy Number" name="pt_poa_number" type="tel" />
        </div>
      </Section>

      <Section id="sec_insurance" title="Insurance & Billing Integration" note="Payer info and coverage.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="Primary Payer" name="pt_payer_primary" />
          <FormField label="Secondary Payer" name="pt_payer_secondary" />
          <FormField label="Coverage Verification" name="pt_coverage_status" type="select" options={["", "Verified", "Pending", "Denied"]} />
          <FormField label="Prior Auth Status (Meds/O2)" name="pt_auth_status" />
        </div>
      </Section>

      <Section id="sec_sdoh" title="Social Determinants of Health (SDOH)" note="Environmental and socioeconomic factors impacting respiratory care.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Housing Stability" name="sdoh_housing" type="select" options={["", "Stable", "Unstable", "Homeless", "Shelter"]} />
          <FormField label="Home Environment Quality" name="sdoh_environment" type="select" options={["", "Good", "Damp/Mold Noted", "Poor Ventilation", "Pest Infestation"]} />
          <FormField label="Heating / Cooling Access" name="sdoh_hvac" type="select" options={["", "Adequate HVAC", "Space Heaters Only", "No A/C", "Biomass/Wood Stove"]} />
          <FormField label="Food Security" name="sdoh_food" type="select" options={["", "Secure", "Insecure"]} />
          <FormField label="Transportation Access" name="sdoh_transport" type="select" options={["", "Reliable", "Unreliable"]} />
          <FormField label="Employment Status" name="sdoh_employment" type="select" options={["", "Employed", "Unemployed", "Retired", "Disabled"]} />
          <FormField label="Education Level" name="sdoh_education" />
          <FormField label="Health Literacy" name="sdoh_literacy" type="select" options={["", "Adequate", "Limited", "Needs Assistance"]} />
          <FormField label="Social Support Network" name="sdoh_support" type="select" options={["", "Strong (Lives with family)", "Limited", "Lives Alone (No Support)"]} />
        </div>
      </Section>

      <Section id="sec_lifestyle" title="Lifestyle & Environmental Factors" note="Habits impacting airway disease.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="Smoking Status (Tobacco)" name="lifestyle_smoking" type="select" options={["", "Never Smoked", "Former Smoker", "Current Smoker (Every day)", "Current Smoker (Some days)"]} />
          <FormField label="Tobacco Pack-Years" name="lifestyle_pack_years" type="number" />
          <FormField label="Vaping / E-Cigarette Use" name="lifestyle_vaping" type="select" options={["", "Never", "Former", "Current"]} />
          
          <FormField label="Marijuana / Cannabinoid Use" name="lifestyle_thc" type="select" options={["", "None", "Smoked", "Edibles only"]} />
          <FormField label="Alcohol Use" name="lifestyle_alcohol" type="select" options={["", "None", "Occasional", "Moderate", "Heavy"]} />
          <FormField label="Illicit Drug Use" name="lifestyle_drugs" type="select" options={["", "None", "Inhaled/Smoked", "IVDU", "Other"]} />

          <FormField label="Occupational History (Past/Present)" name="lifestyle_occupation" placeholder="e.g., Coal mining, Construction, Office" />
          <FormField label="Specific Occupational Exposures" name="lifestyle_exposures" type="select" options={["", "None", "Silica/Dust", "Asbestos", "Chemical Fumes", "Farming/Organic Dust"]} />
          <FormField label="Pets at Home" name="lifestyle_pets" type="select" options={["", "None", "Cat(s)", "Dog(s)", "Birds", "Other"]} />
        </div>
      </Section>

      <Section id="sec_careteam" title="Care Team Assignment" note="Assigned multidisciplinary team.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="Attending Pulmonologist" name="team_pulmonologist" />
          <FormField label="Respiratory Therapist (RT)" name="team_rt" />
          <FormField label="Pulmonary Rehab Nurse" name="team_nurse" />
          <FormField label="Social Worker" name="team_social_worker" />
        </div>
      </Section>
    </div>
  );
};

export default OnboardingTab;
