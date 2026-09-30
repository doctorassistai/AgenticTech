import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const KetamineForm = () => {
  return (
    <>
      <FormField label="P7 — Ketamine / Esketamine Therapy" type="subhead" />
      <FormField k="ketIndication" label="Indication" type="select" options={['Treatment-resistant depression', 'Major depression with acute suicidality', 'Bipolar depression (adjunct)', 'PTSD (off-label)']} />
      <FormField k="ketAgent" label="Agent & Formulation" type="select" options={['Racemic ketamine — IV', 'Racemic ketamine — IM', 'Racemic ketamine — SC', 'Esketamine — intranasal (Spravato)']} />
      <FormField k="ketDose" label="Dose" placeholder="e.g., 0.5 mg/kg IV; 56/84 mg intranasal" />
      <FormField k="ketRoute" label="Route" type="select" options={['IV infusion', 'IM', 'SC', 'Intranasal']} />
      <FormField k="ketInfusionTime" label="Infusion Duration" type="number" unit="min" hint="IV typically 40 min" />
      <FormField k="ketREMS" label="REMS / Certified Site (esketamine)" type="radio" options={O.yesnoNA} />

      <FormField label="Monitoring During Session" type="subhead" />
      <FormField k="ketBaselineBP" label="Baseline BP (Systolic)" type="number" unit="mmHg" />
      <FormField k="ketPeakBP" label="Peak BP (Systolic)" type="number" unit="mmHg" />
      <FormField k="ketPeakHR" label="Peak Heart Rate" type="number" unit="bpm" />
      <FormField k="ketSpo2Nadir" label="SpO₂ Nadir" type="number" unit="%" />
      <FormField k="ketCADSS" label="Dissociation Score (CADSS)" type="number" hint="0–92" />
      <FormField k="ketSedation" label="Sedation Level (MOAA/S)" type="select" options={['5 — Alert', '4', '3', '2', '1', '0 — Unresponsive']} />
      <FormField k="ketObservation" label="Post-dose Observation" type="number" unit="min" hint="esketamine ≥2 h" />

      <FormField label="Tolerability & Response" type="subhead" />
      <FormField k="ketAdverse" label="Adverse Effects" type="checks" full options={['None', 'Dissociation', 'Hypertension', 'Tachycardia', 'Nausea/vomiting', 'Dizziness', 'Sedation', 'Anxiety', 'Euphoria', 'Bladder symptoms (chronic)']} />
      <FormField k="ketSessionNo" label="Session Number" type="number" />
      <FormField k="ketTotalPlanned" label="Total Sessions Planned" type="number" />
      <FormField k="ketSchedule" label="Treatment Phase" type="select" options={['Induction (2×/week)', 'Maintenance (weekly)', 'Maintenance (fortnightly)', 'Taper']} />
      <FormField k="ketMADRS" label="Post-session MADRS" type="number" />
      <FormField k="ketCSSRS" label="C-SSRS Post-session" placeholder="suicidality re-assessment" />
      <FormField k="ketNotes" label="Ketamine / Esketamine Session Notes" type="textarea" full />
    </>
  );
};

export default KetamineForm;
