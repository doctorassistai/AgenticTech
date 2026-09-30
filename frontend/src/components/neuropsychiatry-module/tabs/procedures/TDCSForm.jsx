import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const TDCSForm = () => {
  return (
    <>
      <FormField label="P3 — Transcranial Direct Current Stimulation (tDCS)" type="subhead" />
      <FormField k="tdcsIndication" label="Indication" type="select" options={['Major Depression', 'Auditory hallucinations', 'Negative symptoms (schizophrenia)', 'Craving / addiction', 'Cognitive enhancement', 'Chronic pain', 'Other']} />
      <FormField k="tdcsDevice" label="Device" type="select" options={['NeuroConn/DC-Stimulator', 'Soterix', 'HDCstim', 'Other']} />

      <FormField label="Montage & Parameters" type="subhead" />
      <FormField k="tdcsAnode" label="Anode Position" placeholder="e.g., F3 (left DLPFC)" />
      <FormField k="tdcsCathode" label="Cathode Position" placeholder="e.g., F4 / supraorbital" />
      <FormField k="tdcsCurrent" label="Current Intensity" type="number" unit="mA" hint="typically 1–2 mA" />
      <FormField k="tdcsDuration" label="Stimulation Duration" type="number" unit="min" hint="typically 20–30 min" />
      <FormField k="tdcsRamp" label="Ramp Up/Down" type="number" unit="s" />
      <FormField k="tdcsElectrodeSize" label="Electrode Size" placeholder="e.g., 35 cm²" />
      <FormField k="tdcsSaline" label="Saline / Gel Applied" type="radio" options={O.yesno} />
      <FormField k="tdcsCurrentDensity" label="Current Density" type="number" unit="mA/cm²" />

      <FormField label="Session Tracking" type="subhead" />
      <FormField k="tdcsSessionNo" label="Session Number" type="number" />
      <FormField k="tdcsTotalPlanned" label="Total Sessions Planned" type="number" />
      <FormField k="tdcsAdverse" label="Adverse Effects" type="checks" full options={['None', 'Tingling', 'Itching', 'Burning sensation', 'Skin erythema', 'Headache', 'Fatigue', 'Nausea', 'Phosphenes']} />
      <FormField k="tdcsResponse" label="Clinical Response to Date" type="select" options={O.outcome} />
      <FormField k="tdcsNotes" label="tDCS Session Notes" type="textarea" full />
    </>
  );
};

export default TDCSForm;
