import React from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';

const EmergencyTab = () => {
  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
        Emergency / Acute
      </h2>
      <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: '0 0 20px' }}>
        Tab 5 of 8 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>emergency</span>
      </p>

      <Section title="Common Emergency Fields (all presentations)">
        <FormField k="emgType6" label="Emergency Type" type="select" options={['Acute Behavioural Disturbance / Agitation', 'Delirium', 'Neuroleptic Malignant Syndrome', 'Serotonin Syndrome', 'Catatonia (acute/malignant)', 'Suicidal Crisis / Self-harm', 'Substance Intoxication / Withdrawal', 'Status Epilepticus (neuropsychiatric)']} />
        <FormField k="arrivalMode" label="Arrival Mode" type="select" options={['Ambulance', 'Police / Section', 'Private vehicle', 'Walk-in', 'Ward referral', 'In-hospital emergency']} />
        <FormField k="legalStatus" label="Legal Status on Arrival" type="select" options={O.mhaStatus} />

        <FormField label="Time Tracking" type="subhead" />
        <FormField k="timeOnset" label="Time of Onset" type="datetime-local" />
        <FormField k="timeArrival" label="Time of Arrival" type="datetime-local" />
        <FormField k="timeAssess" label="Time of First Assessment" type="datetime-local" />
        <FormField k="timeTreat" label="Time of First Treatment" type="datetime-local" />

        <FormField label="ABCDE & Vitals" type="subhead" />
        <FormField k="abcdeA" label="A — Airway" type="select" options={['Patent', 'Compromised', 'Secured']} />
        <FormField k="abcdeB" label="B — Breathing" type="checks" options={['Spontaneous', 'Assisted', 'Chest clear', 'Abnormal']} />
        <FormField k="abcdeC" label="C — Circulation" placeholder="HR, BP, CRT, IV access" />
        <FormField k="abcdeD" label="D — Disability" placeholder="GCS, pupils, glucose, focal signs" />
        <FormField k="abcdeE" label="E — Exposure" type="checks" options={['Fully exposed', 'Injuries identified', 'Temperature measured', 'Warm blanket']} />
        <FormField k="emgBpSys" label="Systolic BP" type="number" unit="mmHg" />
        <FormField k="emgBpDia" label="Diastolic BP" type="number" unit="mmHg" />
        <FormField k="emgHr" label="Heart Rate" type="number" unit="bpm" />
        <FormField k="emgRr" label="Respiratory Rate" type="number" unit="/min" />
        <FormField k="emgSpo2" label="SpO₂" type="number" unit="%" />
        <FormField k="emgTempArrival" label="Temperature" type="number" unit="°C" hint="critical for NMS/serotonin syndrome" />
        <FormField k="emgGlucose" label="Blood Glucose" type="number" unit="mg/dL" />
        <FormField k="emgGCS" label="GCS on Arrival" type="number" />

        <FormField label="Acute Behavioural Management" type="subhead" />
        <FormField k="deEscalation" label="De-escalation Attempted" type="select" options={['Yes — successful', 'Yes — partial', 'Yes — unsuccessful', 'Not appropriate']} />
        <FormField k="restraint" label="Restrictive Interventions Used" type="checks" full options={['None', 'Verbal de-escalation', 'Environmental', 'Physical restraint', 'Mechanical restraint', 'Seclusion', 'Rapid tranquillisation']} />
        <FormField
          k="rapidTranq"
          label="Rapid Tranquillisation Given"
          type="array"
          full
          addLabel="+ Add Medication"
          cols={3}
          subFields={[
            { k: 'drug', l: 'Drug', t: 'text', ph: 'e.g., Lorazepam / Haloperidol / Promethazine' },
            { k: 'dose', l: 'Dose', t: 'text' },
            { k: 'route', l: 'Route', t: 'select', o: O.route },
            { k: 'time', l: 'Time', t: 'datetime-local' },
          ]}
        />

        <FormField label="Screening & Safety" type="subhead" />
        <FormField k="emgCSSRS" label="C-SSRS / Suicide Risk" placeholder="ideation, plan, intent, access to means" />
        <FormField k="emgMeds" label="Relevant Current Medications" placeholder="antipsychotics, serotonergics, lithium, AEDs" />
        <FormField k="emgOrganicScreen" label="Organic Cause Screen Done" type="radio" options={O.yesno} />
        <FormField k="emgContactNotified" label="Next of Kin / Carer Notified" type="radio" options={['Yes', 'No', 'Unable to reach']} />
      </Section>

      <Section title="Presentation-Specific Fields">
        <FormField k="emgSpecific" label="Presentation-specific Assessment" type="textarea" full placeholder="NMS: CK, rigidity, autonomic instability | Serotonin syndrome: clonus, hyperreflexia | Catatonia: BFCRS, lorazepam challenge | Delirium: 4AT/CAM, precipitants | Withdrawal: CIWA/COWS" />
        <FormField k="emgScaleScore" label="Relevant Scale Score" placeholder="e.g., 4AT, CIWA-Ar, BFCRS, CK level" />
        <FormField k="emgManagementPlan" label="Acute Management Plan & Disposition" type="textarea" full llm />
      </Section>
    </div>
  );
};

export default EmergencyTab;
