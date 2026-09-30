import React from 'react';
import Section from '../../components/Section';
import FormField from '../../components/FormField';

const AnteriorCapsulotomyForm = () => {
  return (
    <div style={{ marginTop: '12px', gridColumn: '1 / -1', width: '100%' }}>
      <Section title="AAN Selection & Refractoriness Criteria">
        <FormField k="capsIndication" label="Primary Psychiatric Indication" type="select" options={['Severe Refractory OCD (Y-BOCS >= 30)', 'Refractory Major Depressive Disorder', 'Refractory Anxiety Disorder']} />
        <FormField k="capsEthicsReview" label="Ethics Committee Approval & Independent Psychiatry Review" type="radio" options={['Completed & Signed', 'Incomplete']} />
        <FormField k="capsBaselineScale" label="Pre-operative Y-BOCS / MADRS Score" type="number" />
      </Section>

      <Section title="Stereotactic Targeting (Anterior Limb of Internal Capsule - ALIC)">
        <FormField k="capsLaterality" label="Procedure Laterality" type="select" options={['Bilateral (Standard)', 'Unilateral Right', 'Unilateral Left']} />
        <FormField k="capsTargetSite" label="ALIC Target Anatomic Location" type="select" options={['Anterior 1/3 of ALIC', 'Mid-portion of ALIC', 'Ventral ALIC / Nucleus Accumbens junction']} />
        
        <FormField label="Right ALIC Target Coordinates" type="subhead" />
        <FormField k="capsRX" label="Right X (mm from AC-PC line)" type="number" unit="mm" />
        <FormField k="capsRY" label="Right Y (mm anterior to AC)" type="number" unit="mm" />
        <FormField k="capsRZ" label="Right Z (mm relative to AC-PC plane)" type="number" unit="mm" />

        <FormField label="Left ALIC Target Coordinates" type="subhead" />
        <FormField k="capsLX" label="Left X (mm from AC-PC line)" type="number" unit="mm" />
        <FormField k="capsLY" label="Left Y (mm anterior to AC)" type="number" unit="mm" />
        <FormField k="capsLZ" label="Left Z (mm relative to AC-PC plane)" type="number" unit="mm" />
      </Section>

      <Section title="Lesion Execution & Imaging Verification">
        <FormField k="capsModality" label="Ablative Technique" type="select" options={['Radiofrequency (RF) Lesioning', 'Gamma Knife Radiosurgery', 'Laser Interstitial Thermal Therapy (LITT)', 'MR-guided Focused Ultrasound (MRgFUS)']} />
        
        <FormField label="Modality Parameters" type="subhead" />
        <FormField k="capsRfTemp" label="RF Temperature (°C)" type="number" unit="°C" placeholder="75-80°C" />
        <FormField k="capsRfTime" label="RF Duration per Isocenter (sec)" type="number" unit="sec" placeholder="60-90 sec" />
        <FormField k="capsGkIsocenters" label="Gamma Knife Isocenters Used" type="select" options={['4 mm Collimator (2 isocenters per side)', '8 mm Collimator (1 isocenter per side)', 'Other']} />
        <FormField k="capsGkDose" label="Gamma Knife Maximum Dose (Gy)" type="number" unit="Gy" placeholder="e.g. 140-160 Gy" />
        
        <FormField k="capsMrVerif" label="AAN Intra-op / Post-op Imaging Verification" type="select" options={['T2 MRI shows complete ALIC disruption without hemorrhage', 'Post-op CT fusion confirmed target', 'Pending']} />
      </Section>
    </div>
  );
};

export default AnteriorCapsulotomyForm;
