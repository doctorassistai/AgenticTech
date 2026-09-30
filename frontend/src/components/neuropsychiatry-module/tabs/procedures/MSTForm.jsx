import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const MSTForm = () => {
  return (
    <>
      <FormField label="P4 — Magnetic Seizure Therapy (MST)" type="subhead" />
      <FormField k="mstIndication" label="Indication" type="select" options={['Treatment-resistant depression', 'Depression (cognitive-sparing alternative to ECT)', 'Suicidality']} />
      <FormField k="mstDevice" label="Device / Coil" type="select" options={['MagPro MST (twin coil)', 'Cap coil', 'Circular coil']} />
      <FormField k="mstFrequency" label="Stimulation Frequency" type="number" unit="Hz" hint="typically 25–100 Hz" />
      <FormField k="mstIntensity" label="Intensity" type="number" unit="% max output" />
      <FormField k="mstTrainDuration" label="Train Duration" type="number" unit="s" />
      <FormField k="mstCoilPosition" label="Coil Position" placeholder="e.g., vertex" />

      <FormField label="Anaesthesia & Seizure" type="subhead" />
      <FormField k="mstAnaesAgent" label="Induction Agent" type="select" options={['Methohexital', 'Propofol', 'Etomidate', 'Ketamine']} />
      <FormField k="mstRelaxant" label="Muscle Relaxant" type="select" options={['Succinylcholine', 'Rocuronium']} />
      <FormField k="mstMotorDuration" label="Motor Seizure Duration" type="number" unit="s" />
      <FormField k="mstEEGDuration" label="EEG Seizure Duration" type="number" unit="s" />
      <FormField k="mstReorient" label="Time to Reorientation" type="number" unit="min" />

      <FormField label="Session Tracking" type="subhead" />
      <FormField k="mstSessionNo" label="Session Number" type="number" />
      <FormField k="mstTotalPlanned" label="Total Sessions Planned" type="number" />
      <FormField k="mstAdverse" label="Adverse Effects" type="checks" full options={['None', 'Headache', 'Myalgia', 'Nausea', 'Transient confusion', 'Site discomfort']} />
      <FormField k="mstResponse" label="Clinical Response to Date" type="select" options={O.outcome} />
      <FormField k="mstNotes" label="MST Session Notes" type="textarea" full />
    </>
  );
};

export default MSTForm;
