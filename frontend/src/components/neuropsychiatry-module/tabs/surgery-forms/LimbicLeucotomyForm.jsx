import React from 'react';
import Section from '../../components/Section';
import FormField from '../../components/FormField';

const LimbicLeucotomyForm = () => {
  return (
    <div style={{ marginTop: '12px', gridColumn: '1 / -1', width: '100%' }}>
      <Section title="AAN Dual-Target Psychosurgery Indications & Clearance">
        <FormField k="limbIndication" label="Primary Psychiatric Indication" type="select" options={['Severe Refractory OCD with Comorbid Major Depression', 'Intractable Bipolar Affective Disorder', 'Severe Treatment-Resistant Anxiety & Mood Disorder']} />
        <FormField k="limbBoardReview" label="AAN / Psychosurgery Ethics Panel Clearance" type="radio" options={['Full Approval Granted', 'Pending']} />
        <FormField k="limbBaselineScales" label="Baseline Ratings (Y-BOCS & HAM-D)" type="text" placeholder="e.g. Y-BOCS: 32, HAM-D: 26" />
      </Section>

      <Section title="Target 1: Anterior Cingulate Gyrus Lesions">
        <FormField label="Cingulate Target Coordinates" type="subhead" />
        <FormField k="limbCingRX" label="Right Cingulate X / Y / Z" type="text" placeholder="X: ...mm, Y: ...mm, Z: ...mm" />
        <FormField k="limbCingLX" label="Left Cingulate X / Y / Z" type="text" placeholder="X: ...mm, Y: ...mm, Z: ...mm" />
        <FormField k="limbCingRfParams" label="Cingulate RF Parameters" type="text" placeholder="Temp: 75-80°C, Duration: 60-90 sec" />
      </Section>

      <Section title="Target 2: Subcaudate Tractotomy Lesions (Substantia Innominata)">
        <FormField label="Subcaudate Target Coordinates" type="subhead" />
        <FormField k="limbSubcRX" label="Right Subcaudate X / Y / Z" type="text" placeholder="X: ...mm, Y: ...mm, Z: ...mm" />
        <FormField k="limbSubcLX" label="Left Subcaudate X / Y / Z" type="text" placeholder="X: ...mm, Y: ...mm, Z: ...mm" />
        <FormField k="limbSubcRfParams" label="Subcaudate RF Parameters" type="text" placeholder="Temp: 75-80°C, Duration: 60-90 sec" />
      </Section>

      <Section title="Post-Procedure Verification & Safety Assessment">
        <FormField k="limbPostOpMRI" label="AAN Intra-op / Post-op MRI Verification" type="select" options={['Confirmed lesion placement in both Cingulate and Subcaudate targets', 'Post-op CT fusion confirmed targets', 'Pending MRI']} />
        <FormField k="limbComplications" label="Acute Intraoperative Complications" type="checks" full options={['None', 'Transient Confusion / Delirium', 'Frontal Executive Disinhibition', 'Intra-op Seizure', 'Bleeding / Hemorrhage', 'Infection Concern']} />
        <FormField k="limbCognitiveCheck" label="Immediate Post-op Cognitive / Frontal Check" type="textarea" full placeholder="Document orientation, executive function, speech fluency, affective responsiveness post-procedure..." />
      </Section>
    </div>
  );
};

export default LimbicLeucotomyForm;
