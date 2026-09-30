import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const RTMSForm = () => {
  return (
    <>
      <FormField label="P2 — Repetitive Transcranial Magnetic Stimulation (rTMS)" type="subhead" />
      <FormField k="tmsIndication" label="Indication" type="select" options={['Major Depressive Disorder (TRD)', 'OCD', 'Anxious depression', 'Smoking cessation', 'Bipolar depression (adjunct)', 'Auditory hallucinations', 'Negative symptoms', 'PTSD', 'Other']} />
      <FormField k="tmsSafety" label="Safety Screening" type="checks" full options={['No ferromagnetic implant', 'No cardiac pacemaker/ICD', 'No cochlear implant', 'No history of seizure (or documented)', 'Not pregnant / discussed', 'No unstable medical condition', 'Medication seizure-threshold reviewed']} />

      <FormField label="Motor Threshold & Coil" type="subhead" />
      <FormField k="tmsMTMethod" label="Motor Threshold Determination" type="select" options={['Visual (thumb twitch)', 'EMG-guided (APB)']} />
      <FormField k="tmsRMT" label="Resting Motor Threshold" type="number" unit="% MSO" />
      <FormField k="tmsCoil" label="Coil Type" type="select" options={['Figure-8 (focal)', 'H-coil (Deep TMS)', 'Circular', 'Double-cone']} />
      <FormField k="tmsTarget" label="Stimulation Target" type="select" options={['Left DLPFC', 'Right DLPFC', 'Bilateral DLPFC', 'Medial PFC / ACC (OCD)', 'Left TPJ (hallucinations)', 'SMA', 'Other']} />
      <FormField k="tmsLocalization" label="Localization Method" type="select" options={['5 cm rule', 'Beam F3 (EEG 10-20)', 'Neuronavigation (MRI-guided)']} />

      <FormField label="Stimulation Parameters" type="subhead" />
      <FormField k="tmsIntensity" label="Stimulation Intensity" type="number" unit="% RMT" hint="e.g., 120%" />
      <FormField k="tmsProtocol" label="Protocol" type="select" options={['High-frequency 10 Hz', 'Low-frequency 1 Hz', 'Intermittent Theta Burst (iTBS)', 'Continuous Theta Burst (cTBS)', 'SAINT/accelerated', 'Deep TMS (H1)']} />
      <FormField k="tmsFrequency" label="Frequency" type="number" unit="Hz" />
      <FormField k="tmsTrainDuration" label="Train Duration" type="number" unit="s" />
      <FormField k="tmsInterTrain" label="Inter-train Interval" type="number" unit="s" />
      <FormField k="tmsTrains" label="Number of Trains" type="number" />
      <FormField k="tmsPulsesSession" label="Pulses per Session" type="number" />
      <FormField k="tmsSessionsPerDay" label="Sessions per Day" type="number" />

      <FormField label="Session Tracking" type="subhead" />
      <FormField k="tmsSessionNo" label="Session Number" type="number" />
      <FormField k="tmsTotalPlanned" label="Total Sessions Planned" type="number" />
      <FormField k="tmsAdverse" label="Adverse Effects" type="checks" full options={['None', 'Scalp discomfort/pain', 'Headache', 'Facial twitching', 'Transient hearing change', 'Lightheadedness', 'Seizure (rare)']} />
      <FormField k="tmsDiscomfort" label="Scalp Discomfort (0–10)" type="number" max={10} />
      <FormField k="tmsResponse" label="Clinical Response to Date" type="select" options={O.outcome} />
      <FormField k="tmsNotes" label="rTMS Session Notes" type="textarea" full />
    </>
  );
};

export default RTMSForm;
