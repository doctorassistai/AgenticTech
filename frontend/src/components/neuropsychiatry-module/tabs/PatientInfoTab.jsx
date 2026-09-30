import React from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';

const PatientInfoTab = () => {
  const { formData } = useNeuropsychiatry();

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
        Patient Info
      </h2>
      <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: '0 0 20px' }}>
        Tab 1 of 8 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>patient</span>
      </p>

      <Section title="1.1 — Basic Information">
        <FormField k="hmsId" label="Patient ID" readOnly placeholder="auto-populated" />
        <FormField k="patientName" label="Patient Name" readOnly />
        <FormField k="age" label="Age" type="number" readOnly hint="auto from DOB" />
        <FormField k="sex" label="Sex" type="radio" options={O.sex} />
        <FormField k="dob" label="Date of Birth" type="date" />
        <FormField k="contact" label="Contact Number" type="tel" />
        <FormField k="emgName" label="Emergency Contact Name" />
        <FormField k="emgNumber" label="Emergency Contact Number" type="tel" />
        <FormField k="emgRel" label="Emergency Contact Relationship" type="select" options={O.relationship} />
        <FormField k="bloodGroup" label="Blood Group" type="select" options={O.blood} />
        <FormField k="address" label="Address" type="textarea" full />
        <FormField k="occupation" label="Occupation / Employment" />
        <FormField k="maritalStatus" label="Marital Status" type="select" options={O.marital} />
        <FormField k="insurance" label="Insurance / Payer" />
        <FormField k="mhaStatus" label="Legal / Mental Health Act Status" type="select" options={O.mhaStatus} />
        <FormField k="referringDoctor" label="Referring Doctor" readOnly />
        <FormField k="referringHospital" label="Referring Hospital / Source" />
      </Section>

      <Section title="1.2 — Presenting Complaint & HPI">
        <FormField k="presentingComplaint" label="Presenting Complaint(s)" type="textarea" full llm />
        <FormField k="hpi" label="History of Present Illness" type="textarea" full llm />
        <FormField k="durationIllness" label="Duration of Current Episode" placeholder="e.g., 6 weeks, 2 years" />
        <FormField k="onsetPattern" label="Onset Pattern" type="select" options={O.onset} />
        <FormField k="coreSymptoms" label="Core Symptom Domains" type="checks" full options={['Depressed mood', 'Anhedonia', 'Anxiety/panic', 'Mania/elevated mood', 'Psychosis', 'Obsessions/compulsions', 'Cognitive decline', 'Behavioural change', 'Sleep disturbance', 'Appetite/weight change', 'Agitation', 'Apathy', 'Suicidal ideation', 'Self-harm']} />
        <FormField k="precipitant" label="Identifiable Precipitant / Stressor" type="radio" options={O.yesno} />
        <FormField k="precipitantDetail" label="Precipitant Details" type="textarea" full showIf={{ k: 'precipitant', in: ['Yes'] }} />
      </Section>

      <Section title="1.3 — Past Psychiatric History">
        <FormField k="pastPsych" label="Previous Psychiatric Illness" type="radio" options={O.yesno} />
        <FormField k="pastDx" label="Prior Diagnoses" type="checks" full showIf={{ k: 'pastPsych', in: ['Yes'] }} options={['Major Depressive Disorder', 'Bipolar Affective Disorder', 'Schizophrenia', 'Schizoaffective Disorder', 'Generalized Anxiety Disorder', 'Panic Disorder', 'OCD', 'PTSD', 'Personality Disorder', 'Substance Use Disorder', 'Neurocognitive Disorder/Dementia', 'Delirium (prior)', 'ADHD', 'Autism Spectrum', 'Eating Disorder', 'None']} />
        <FormField k="priorAdmissions" label="Number of Prior Psychiatric Admissions" type="number" />
        <FormField k="priorSuicideAttempts" label="Number of Prior Suicide Attempts" type="number" />
        <FormField k="priorECT" label="Previous ECT" type="radio" options={O.yesnoNA} />
        <FormField k="priorNeuromod" label="Previous Neuromodulation (rTMS/tDCS/DBS/VNS)" type="radio" options={O.yesnoNA} />
        <FormField k="pastPsychDetail" label="Past Psychiatric History Details" type="textarea" full />
      </Section>

      <Section title="1.4 — Past Medical / Neurological History">
        <FormField k="comorbidities" label="Medical / Neurological Co-morbidities" type="checks" full options={['Hypertension', 'Diabetes Mellitus', 'Ischemic Heart Disease', 'Arrhythmia', "Epilepsy/Seizure disorder", 'Head injury/TBI', 'Stroke/TIA', "Parkinson's Disease", 'Multiple Sclerosis', 'Thyroid disorder', 'Chronic Kidney Disease', 'Chronic Liver Disease', 'HIV', 'Autoimmune disorder', 'Metabolic syndrome', 'None']} />
        <FormField k="comorbidityDetails" label="Co-morbidity Details" type="textarea" full />
        <FormField k="metalImplant" label="Ferromagnetic Implant / Pacemaker / Cochlear" type="radio" options={['Yes', 'No', 'Unknown']} hint="screening for rTMS/MRI" />
        <FormField k="seizureHx" label="History of Seizures" type="radio" options={O.yesno} />
        <FormField k="seizureDetail" label="Seizure History Detail" type="textarea" full showIf={{ k: 'seizureHx', in: ['Yes'] }} />
      </Section>

      <Section title="1.5 — Current Medications (Psychotropic & Other)">
        <FormField
          k="medications"
          label="Medications"
          type="array"
          full
          addLabel="+ Add Medication"
          cols={3}
          subFields={[
            { k: 'drug', l: 'Drug Name', t: 'text' },
            { k: 'dose', l: 'Dose', t: 'text', ph: 'e.g., 20mg' },
            { k: 'freq', l: 'Frequency', t: 'select', o: O.freq },
            { k: 'route', l: 'Route', t: 'select', o: O.route },
            { k: 'class', l: 'Class', t: 'select', o: ['Antidepressant (SSRI)', 'Antidepressant (SNRI)', 'Antidepressant (TCA)', 'Antidepressant (MAOI)', 'Antipsychotic (typical)', 'Antipsychotic (atypical)', 'Mood stabiliser', 'Benzodiazepine', 'Anticonvulsant', 'Stimulant', 'Cognitive enhancer', 'Hypnotic', 'Other'] },
            { k: 'duration', l: 'Duration', t: 'text', ph: 'Since ...' },
            { k: 'compliance', l: 'Compliance', t: 'select', o: O.compliance },
          ]}
        />
        <FormField k="clozapine" label="On Clozapine" type="radio" options={O.yesno} />
        <FormField k="medNotes" label="Medication Notes / Interactions" type="textarea" full />
      </Section>

      <Section title="1.6 — Substance Use History">
        <FormField k="smoking" label="Tobacco / Nicotine" type="select" options={O.smoking} />
        <FormField k="smokingPackYears" label="Pack-years" showIf={{ k: 'smoking', in: ['Former', 'Current'] }} />
        <FormField k="alcohol" label="Alcohol Use" type="select" options={O.alcohol} />
        <FormField k="alcoholUnits" label="Alcohol Units / Week" type="number" showIf={{ k: 'alcohol', in: ['Hazardous', 'Harmful', 'Dependent'] }} />
        <FormField k="substance" label="Substance Use" type="checks" full options={['None', 'Cannabis', 'Opioids', 'Stimulants (cocaine/amphetamine)', 'Benzodiazepines (illicit)', 'Hallucinogens', 'Inhalants', 'Ketamine (recreational)', 'IV drug use', 'Other']} />
        <FormField k="substanceDetail" label="Substance Use Details (quantity, route, last use)" type="textarea" full />
        <FormField k="withdrawalRisk" label="Withdrawal Risk" type="radio" options={O.yesno} />
      </Section>

      <Section title="1.7 — Family, Personal & Forensic History">
        <FormField k="familyHx" label="Family Psychiatric / Neurological History" type="checks" full options={['Depression', 'Bipolar Disorder', 'Schizophrenia', 'Suicide', 'Dementia', 'Epilepsy', 'Substance use', 'Completed neuromodulation/ECT', 'None significant']} />
        <FormField k="familyHxDetails" label="Family History Details" type="textarea" full />
        <FormField k="personalHistory" label="Personal / Developmental History" type="textarea" full placeholder="birth, milestones, education, occupation, relationships" />
        <FormField k="premorbidPersonality" label="Premorbid Personality" type="textarea" full />
        <FormField k="forensicHx" label="Forensic History" type="radio" options={O.yesno} />
        <FormField k="forensicDetail" label="Forensic Details" type="textarea" full showIf={{ k: 'forensicHx', in: ['Yes'] }} />
      </Section>

      <Section title="1.8 — Allergies">
        <FormField
          k="allergies"
          label="Allergies"
          type="array"
          full
          tableMode
          addLabel="+ Add Allergy"
          cols={2}
          subFields={[
            { k: 'allergen', l: 'Allergen', t: 'text' },
            { k: 'type', l: 'Type', t: 'select', o: O.allergyType },
            { k: 'severity', l: 'Severity', t: 'select', o: O.severity3 },
            { k: 'reaction', l: 'Reaction Description', t: 'text' },
          ]}
        />
      </Section>
    </div>
  );
};

export default PatientInfoTab;
