import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const EEGForm = () => {
  return (
    <>
      <FormField label="P9 — Electroencephalography (EEG)" type="subhead" />
      <FormField k="eegIndication" label="Indication" type="select" options={['Delirium vs primary psychiatric', 'Dementia / encephalopathy workup', 'First-episode psychosis screen', 'Suspected seizure / NEAD differentiation', 'Catatonia workup', 'Autoimmune/limbic encephalitis', 'Clozapine-related EEG changes', 'Baseline before ECT/TMS']} />
      <FormField k="eegType" label="EEG Type" type="select" options={['Routine (20–40 min)', 'Sleep-deprived', 'Prolonged/ambulatory', 'Video-EEG', 'ICU cEEG']} />
      <FormField k="eegDuration" label="Recording Duration" type="number" unit="min" />
      <FormField k="eegMontage" label="Montage" type="select" options={['Standard 10-20', 'Average reference', 'Bipolar longitudinal', 'Laplacian']} />
      <FormField k="eegActivation" label="Activation Procedures" type="checks" full options={['Hyperventilation', 'Photic stimulation', 'Sleep', 'Sleep deprivation', 'None']} />

      <FormField label="Findings" type="subhead" />
      <FormField k="eegPDR" label="Posterior Dominant Rhythm" type="number" unit="Hz" />
      <FormField k="eegBackground" label="Background Organization" type="select" options={['Normal & well-organized', 'Mild slowing', 'Moderate diffuse slowing', 'Severe slowing', 'FIRDA', 'Triphasic waves', 'Burst-suppression']} />
      <FormField k="eegEpileptiform" label="Epileptiform Discharges" type="radio" options={O.present} />
      <FormField k="eegEDDist" label="ED Distribution" type="select" options={['Generalized', 'Focal', 'Multifocal', 'None']} showIf={{ k: 'eegEpileptiform', in: ['Present'] }} />
      <FormField k="eegSeizure" label="Electrographic Seizure Captured" type="radio" options={O.yesno} />
      <FormField k="eegInterp" label="Overall Interpretation" type="select" options={['Normal', 'Abnormal — diffuse slowing (encephalopathy)', 'Abnormal — focal slowing', 'Abnormal — epileptiform', 'Abnormal — status epilepticus', 'Consistent with delirium', 'Equivocal']} />
      <FormField k="eegCorrelation" label="Clinical Correlation" type="textarea" full />
      <FormField k="eegNotes" label="EEG Notes" type="textarea" full />
    </>
  );
};

export default EEGForm;
