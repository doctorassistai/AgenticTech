import React from 'react';
import Section from '../../components/Section';
import FormField from '../../components/FormField';

const AnteriorCingulotomyForm = () => {
  return (
    <div style={{ marginTop: '12px', gridColumn: '1 / -1', width: '100%' }}>
      <Section title="AAN & Psychosurgery Board Clearance">
        <FormField k="cingMdtClearance" label="Hospital Ethics & MDT Board Approval" type="radio" options={['Approved & Documented', 'Not Approved']} />
        <FormField k="cingRefractoryIndication" label="Primary Psychiatric Indication" type="select" options={['Refractory OCD (Y-BOCS >= 28)', 'Refractory Major Depression', 'Chronic Intractable Cancer Pain', 'Other']} />
        <FormField k="cingCapacityConsent" label="Patient Informed Capacity Verified" type="radio" options={['Independent Informed Consent', 'Substituted / Legal Guardian Consent']} />
      </Section>

      <Section title="Stereotactic Targeting (Anterior Cingulate Cortex)">
        <FormField k="cingTargetSite" label="Target Location" type="select" options={['Anterior Cingulate Gyrus (20-25mm posterior to anterior tip of frontal horn)', 'Custom Stereotactic Target']} />
        <FormField k="cingLaterality" label="Procedure Laterality" type="select" options={['Bilateral (Standard)', 'Unilateral Right', 'Unilateral Left']} />
        
        <FormField label="Right Cingulate Coordinates" type="subhead" />
        <FormField k="cingRX" label="Right X (Lateral)" type="number" unit="mm" />
        <FormField k="cingRY" label="Right Y (Anterior-Posterior)" type="number" unit="mm" />
        <FormField k="cingRZ" label="Right Z (Vertical above ventricular roof)" type="number" unit="mm" />

        <FormField label="Left Cingulate Coordinates" type="subhead" />
        <FormField k="cingLX" label="Left X (Lateral)" type="number" unit="mm" />
        <FormField k="cingLY" label="Left Y (Anterior-Posterior)" type="number" unit="mm" />
        <FormField k="cingLZ" label="Left Z (Vertical above ventricular roof)" type="number" unit="mm" />
      </Section>

      <Section title="Lesioning Parameters & Modality">
        <FormField k="cingModality" label="Lesioning Technique / Modality" type="select" options={['Radiofrequency (RF) Thermocoagulation', 'Laser Interstitial Thermal Therapy (LITT)', 'Gamma Knife Radiosurgery', 'MR-guided Focused Ultrasound (MRgFUS)']} />
        <FormField k="cingNumLesions" label="Number of Lesions Per Side" type="select" options={['1 Lesion per side', '2 Lesions per side (Stacked)', '3 Lesions per side']} />

        <FormField label="Modality-Specific Lesion Execution Parameters" type="subhead" />
        <FormField k="cingRfTemp" label="RF Thermocoagulation Temperature (°C)" type="number" unit="°C" placeholder="e.g. 75-80°C" />
        <FormField k="cingRfDuration" label="RF Lesion Duration (Seconds)" type="number" unit="sec" placeholder="e.g. 60-90 sec" />
        <FormField k="cingLittPower" label="LITT Energy / Power (Watts)" type="number" unit="W" />
        <FormField k="cingGkDose" label="Gamma Knife Maximum Dose (Gy)" type="number" unit="Gy" placeholder="e.g. 120-140 Gy" />
        
        <FormField k="cingVerificationImg" label="AAN Intraoperative / Immediate Post-op MRI Verification" type="select" options={['Confirmed lesion location & volume on T2/FLAIR MRI', 'CT Fusion confirmed target', 'Pending post-op MRI']} />
        <FormField k="cingLesionVolume" label="Estimated Total Lesion Volume (cm³)" type="number" unit="cm³" />
      </Section>
    </div>
  );
};

export default AnteriorCingulotomyForm;
