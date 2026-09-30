import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const LumbarPunctureForm = () => {
  return (
    <>
      <FormField label="P10 — Lumbar Puncture (CSF Biomarkers)" type="subhead" />
      <FormField k="lpIndication" label="Indication" type="select" options={['Dementia biomarkers (AD profile)', 'Autoimmune / limbic encephalitis', 'Rapidly progressive dementia', 'Normal pressure hydrocephalus (tap test)', 'CNS infection', 'Atypical psychiatric presentation with organic red flags']} />
      <FormField k="lpImaging" label="Neuroimaging Before LP" type="radio" options={['Yes', 'No', 'Not indicated']} />
      <FormField k="lpPosition" label="Patient Position" type="select" options={['Lateral decubitus', 'Sitting', 'Prone (fluoroscopy)']} />
      <FormField k="lpLevel" label="Vertebral Level" type="select" options={['L3-L4', 'L4-L5', 'L5-S1', 'Other']} />
      <FormField k="lpNeedle" label="Needle Type" type="select" options={['Atraumatic (Sprotte/Whitacre)', 'Quincke (cutting)']} />
      <FormField k="lpGauge" label="Needle Gauge" type="select" options={['20G', '22G', '24G', '25G']} />
      <FormField k="lpAttempts" label="Number of Attempts" type="number" />
      <FormField k="lpOpenPress" label="Opening Pressure" type="number" unit="cmH₂O" />
      <FormField k="lpAppearance" label="CSF Appearance" type="select" options={['Clear & colourless', 'Xanthochromic', 'Bloody', 'Turbid']} />
      <FormField k="lpVolume" label="Volume Collected" type="number" unit="mL" />

      <FormField label="CSF Alzheimer / Neurodegeneration Panel" type="subhead" />
      <FormField k="lpAbeta42" label="Amyloid-β 42" type="number" unit="pg/mL" />
      <FormField k="lpAbetaRatio" label="Aβ42/Aβ40 Ratio" type="number" />
      <FormField k="lpTotalTau" label="Total Tau" type="number" unit="pg/mL" />
      <FormField k="lpPTau" label="Phospho-Tau 181" type="number" unit="pg/mL" />
      <FormField k="lpADProfile" label="AD Biomarker Profile" type="select" options={['Normal', 'AD-consistent (↓Aβ42, ↑p-tau)', 'Non-specific', 'Indeterminate']} />

      <FormField label="Routine / Autoimmune" type="subhead" />
      <FormField k="lpProtein" label="Protein" type="number" unit="mg/dL" />
      <FormField k="lpGlucose" label="Glucose" type="number" unit="mg/dL" />
      <FormField k="lpCells" label="Cell Count" type="number" unit="/µL" />
      <FormField k="lpAutoimmune" label="Autoimmune Antibody Panel (NMDAR/LGI1/CASPR2/GABA-B)" type="textarea" full />
      <FormField k="lpComplications" label="Complications" type="checks" full options={['None', 'Post-LP headache', 'Back pain', 'Radicular pain', 'Traumatic tap', 'Vasovagal']} />
      <FormField k="lpNotes" label="LP Notes" type="textarea" full />
    </>
  );
};

export default LumbarPunctureForm;
