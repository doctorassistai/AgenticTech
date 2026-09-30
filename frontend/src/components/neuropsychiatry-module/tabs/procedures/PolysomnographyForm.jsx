import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const PolysomnographyForm = () => {
  return (
    <>
      <FormField label="P11 — Polysomnography (Sleep Study)" type="subhead" />
      <FormField k="psgIndication" label="Indication" type="select" options={['REM sleep behaviour disorder (prodromal synucleinopathy)', 'Depression — sleep architecture', 'Obstructive sleep apnea', 'Narcolepsy / hypersomnia (with MSLT)', 'Periodic limb movement disorder', 'Insomnia workup', 'Parasomnia evaluation', 'Medication effect on sleep']} />
      <FormField k="psgType" label="Study Type" type="select" options={['Level 1 — attended in-lab', 'Level 2 — unattended full', 'Level 3 — cardiorespiratory', 'Level 4 — oximetry', 'PSG + MSLT']} />
      <FormField k="psgChannels" label="Channels Recorded" type="checks" full options={['EEG', 'EOG', 'Chin EMG', 'Leg EMG', 'ECG', 'Nasal airflow', 'Respiratory effort', 'SpO₂', 'Snore', 'Body position', 'Video']} />

      <FormField label="Sleep Architecture" type="subhead" />
      <FormField k="psgTST" label="Total Sleep Time" type="number" unit="min" />
      <FormField k="psgEfficiency" label="Sleep Efficiency" type="number" unit="%" />
      <FormField k="psgSOL" label="Sleep Onset Latency" type="number" unit="min" />
      <FormField k="psgREMLat" label="REM Latency" type="number" unit="min" hint="shortened in depression" />
      <FormField k="psgN1" label="N1" type="number" unit="%" />
      <FormField k="psgN2" label="N2" type="number" unit="%" />
      <FormField k="psgN3" label="N3" type="number" unit="%" />
      <FormField k="psgREM" label="REM" type="number" unit="%" />
      <FormField k="psgWASO" label="WASO" type="number" unit="min" />
      <FormField k="psgArousal" label="Arousal Index" type="number" unit="/hr" />

      <FormField label="Respiratory & Movement" type="subhead" />
      <FormField k="psgAHI" label="AHI" type="number" unit="/hr" />
      <FormField k="psgRDI" label="RDI" type="number" unit="/hr" />
      <FormField k="psgODI" label="ODI" type="number" unit="/hr" />
      <FormField k="psgSpo2Nadir" label="SpO₂ Nadir" type="number" unit="%" />
      <FormField k="psgPLM" label="PLM Index" type="number" unit="/hr" />
      <FormField k="psgRBD" label="REM Without Atonia / RBD" type="radio" options={O.present} />

      <FormField label="MSLT (if performed)" type="subhead" />
      <FormField k="msltLatency" label="Mean Sleep Latency" type="number" unit="min" />
      <FormField k="msltSOREMP" label="Number of SOREMPs" type="number" />
      <FormField k="psgInterp" label="Interpretation" type="select" options={['Normal', 'OSA — mild', 'OSA — moderate', 'OSA — severe', 'PLMD', 'RBD', 'Narcolepsy features', 'Depression-related changes', 'Insomnia']} />
      <FormField k="psgNotes" label="PSG Notes" type="textarea" full />
    </>
  );
};

export default PolysomnographyForm;
