import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const ECTForm = () => {
  return (
    <>
      <FormField label="P1 — Electroconvulsive Therapy (ECT)" type="subhead" />
      <FormField k="ectIndication" label="ECT Indication" type="select" options={['Severe MDD', 'Treatment-resistant depression', 'Depression with psychosis', 'Depression with high suicide risk', 'Catatonia', 'Neuroleptic Malignant Syndrome', 'Acute mania (treatment-resistant)', 'Schizophrenia/Schizoaffective (adjunct)', "Parkinson's (refractory)", 'Severe illness in pregnancy', 'Poor oral intake / life-threatening']} />
      <FormField k="ectCourseType" label="Course Type" type="select" options={['Index / Acute course', 'Continuation ECT', 'Maintenance ECT']} />

      <FormField label="Pre-ECT Workup" type="subhead" />
      <FormField k="ectWorkup" label="Pre-ECT Investigations Completed" type="checks" full options={['FBC', 'U&E / electrolytes', 'ECG', 'Chest X-ray (if indicated)', 'Anaesthetic review', 'Dental review', 'Fasting confirmed', 'Spine X-ray (if indicated)']} />
      <FormField k="ectPreAnaes" label="Pre-anaesthetic Assessment Done" type="radio" options={O.yesno} />
      <FormField k="ectRiskFactors" label="Anaesthetic / Cardiac Risk Factors" type="textarea" full />

      <FormField label="Stimulus & Electrode Parameters" type="subhead" />
      <FormField k="ectDevice" label="ECT Device" type="select" options={['Thymatron System IV', 'MECTA spECTrum', 'Niviqure', 'Other']} />
      <FormField k="ectElectrode" label="Electrode Placement" type="select" options={['Bitemporal (BT)', 'Bifrontal (BF)', "Right Unilateral (RUL, d'Elia)", 'Left Anterior Right Temporal (LART)']} />
      <FormField k="ectDosing" label="Stimulus Dosing Method" type="select" options={['Age-based', 'Half-age', 'Fixed dose', 'Dose titration (empirical seizure threshold)']} />
      <FormField k="ectThreshold" label="Seizure Threshold" type="number" unit="mC" />
      <FormField k="ectDoseMultiple" label="Dose Relative to Threshold" type="number" hint="× ST (e.g., 1.5× BT, 6× RUL)" />
      <FormField k="ectCharge" label="Charge Delivered" type="number" unit="mC" />
      <FormField k="ectCurrent" label="Current" type="number" unit="A" />
      <FormField k="ectFrequency" label="Frequency" type="number" unit="Hz" />
      <FormField k="ectPulseWidth" label="Pulse Width" type="number" unit="ms" hint="brief 0.5–1.5 / ultrabrief <0.5" />
      <FormField k="ectTrainDuration" label="Stimulus (Train) Duration" type="number" unit="s" />
      <FormField k="ectEnergyPct" label="% Energy Set" type="number" unit="%" />

      <FormField label="Anaesthesia & Medications" type="subhead" />
      <FormField k="ectAnaesAgent" label="Induction Agent" type="select" options={['Methohexital', 'Thiopental', 'Propofol', 'Etomidate', 'Ketamine', 'Ketofol']} />
      <FormField k="ectAnaesDose" label="Induction Dose" type="number" unit="mg" />
      <FormField k="ectRelaxant" label="Muscle Relaxant" type="select" options={['Succinylcholine', 'Rocuronium', 'Mivacurium']} />
      <FormField k="ectRelaxantDose" label="Relaxant Dose" type="number" unit="mg" />
      <FormField k="ectAdjuncts" label="Adjunct Medications" type="checks" full options={['Atropine', 'Glycopyrrolate', 'Caffeine (seizure augmentation)', 'Remifentanil', 'Esmolol', 'Labetalol', 'Lignocaine', 'None']} />
      <FormField k="ectAirway" label="Airway / Protection" type="checks" full options={['Pre-oxygenation', 'Bite block inserted', 'Bag-mask ventilation', 'Cuff isolation (motor timing)']} />

      <FormField label="Seizure Characteristics" type="subhead" />
      <FormField k="ectMotorDuration" label="Motor Seizure Duration" type="number" unit="s" hint="cuff method" />
      <FormField k="ectEEGDuration" label="EEG Seizure Duration" type="number" unit="s" />
      <FormField k="ectSeizureQuality" label="Seizure Quality" type="select" options={['Good — high amplitude, postictal suppression', 'Adequate', 'Poor / abortive', 'Missed seizure']} />
      <FormField k="ectPostictalSupp" label="Postictal Suppression Present" type="radio" options={O.yesno} />
      <FormField k="ectRestim" label="Number of Re-stimulations" type="number" />
      <FormField k="ectMaxHR" label="Peak Heart Rate" type="number" unit="bpm" />
      <FormField k="ectPeakBP" label="Peak Blood Pressure" placeholder="e.g., 180/100" />

      <FormField label="Recovery & Session Tracking" type="subhead" />
      <FormField k="ectReorient" label="Time to Reorientation" type="number" unit="min" />
      <FormField k="ectSideEffects" label="Immediate Side Effects" type="checks" full options={['None', 'Postictal confusion', 'Headache', 'Myalgia', 'Nausea', 'Anterograde amnesia', 'Retrograde amnesia', 'Prolonged seizure (>120s)', 'Tardive seizure', 'Dental/tongue injury', 'Cardiac event', 'Aspiration']} />
      <FormField k="ectSessionNo" label="Session Number in Course" type="number" />
      <FormField k="ectTotalPlanned" label="Total Sessions Planned" type="number" />
      <FormField k="ectResponse" label="Clinical Response to Date" type="select" options={O.outcome} />
      <FormField k="ectNextSession" label="Next Session Scheduled" type="date" />
      <FormField k="ectNotes" label="ECT Session Notes" type="textarea" full />
    </>
  );
};

export default ECTForm;
