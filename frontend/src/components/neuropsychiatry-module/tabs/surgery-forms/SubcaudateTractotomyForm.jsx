import React from 'react';
import Section from '../../components/Section';
import FormField from '../../components/FormField';

const SubcaudateTractotomyForm = () => {
  return (
    <div style={{ marginTop: '12px', gridColumn: '1 / -1', width: '100%' }}>
      <Section title="AAN Selection & Refractoriness Criteria">
        <FormField k="subcIndication" label="Primary Psychiatric Indication" type="select" options={['Treatment-Resistant Major Depression', 'Severe OCD', 'Bipolar Disorder (Refractory Depressive Phase)']} />
        <FormField k="subcMdtClearance" label="Independent MDT Committee Clearance" type="radio" options={['Approved', 'Pending']} />
        <FormField k="subcBaselineScore" label="Baseline Depression Severity (HAM-D / MADRS)" type="number" />
      </Section>

      <Section title="Stereotactic Targeting (Substantia Innominata / Subcaudate Region)">
        <FormField k="subcTargetingMethod" label="Stereotactic Localization Technique" type="select" options={['Frame-based Stereotaxy (MRI Target)', 'Neuronavigation Frameless', 'Stereotactic CT Fused with MRI']} />
        <FormField k="subcLaterality" label="Procedure Laterality" type="select" options={['Bilateral (Standard)', 'Unilateral Right', 'Unilateral Left']} />
        
        <FormField label="Target Coordinates (Subcaudate Tracts)" type="subhead" />
        <FormField k="subcX" label="X Coordinate (mm lateral to midline)" type="number" unit="mm" placeholder="e.g. 6-9 mm" />
        <FormField k="subcY" label="Y Coordinate (mm anterior to AC)" type="number" unit="mm" placeholder="e.g. 10-15 mm" />
        <FormField k="subcZ" label="Z Coordinate (mm below AC-PC line / orbital roof)" type="number" unit="mm" placeholder="e.g. 5-8 mm below AC-PC" />
      </Section>

      <Section title="Lesion Parameters & Post-op Imaging">
        <FormField k="subcModality" label="Lesioning Technique" type="select" options={['Radiofrequency (RF) Thermal Lesioning', 'Laser Interstitial Thermal Therapy (LITT)', 'MRgFUS']} />
        <FormField k="subcRfTemp" label="Lesion Peak Temperature (°C)" type="number" unit="°C" placeholder="75-80°C" />
        <FormField k="subcRfTime" label="Lesion Duration (sec)" type="number" unit="sec" placeholder="60-90 sec" />
        <FormField k="subcLesionDimensions" label="Lesion Size / Diameter (mm)" type="text" placeholder="e.g. 8mm x 15mm bilateral tract disruption" />
        <FormField k="subcPostOpImaging" label="AAN Post-operative Imaging Verification" type="select" options={['Confirmed lesion location on MRI T2/FLAIR', 'CT fusion confirmed target', 'Pending']} />
      </Section>
    </div>
  );
};

export default SubcaudateTractotomyForm;
