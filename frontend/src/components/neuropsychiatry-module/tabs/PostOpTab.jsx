import React, { useState } from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';

const MONITORING_TABS = [
  { id: 'observations', label: 'Timed Observations & Recovery' },
  { id: 'tdm', label: 'Drug Level Labs (TDM)' },
  { id: 'ip_nursing', label: 'IP Nursing & Behaviour Log' },
  { id: 'efficacy_side_effects', label: 'Efficacy vs Side-Effects' },
  { id: 'treatment_resistance', label: 'Treatment Resistance' },
];

// ─────────────────────────────────────────────────────────────────────────────
// Every monitoring panel stays MOUNTED; only the open one is laid out.
//
// Voice dictation fills the fields the provider knows about, and FormField
// registers itself on mount — so a panel that is NOT rendered is invisible to
// dictation, and one note could only ever fill the panel on screen. Keeping all
// five mounted is what lets a single dictation fill the whole Monitoring section.
//
//   active → `display: contents`, so this wrapper generates no box at all and its
//            children stay direct grid items of the Section grid. Layout is
//            identical to rendering them bare, including the `full` fields that
//            span the row with gridColumn '1 / -1'.
//   hidden → `display: none`: still mounted and still registered, but not painted
//            and out of the tab order.
//
// Registration is deliberately safe to do while hidden — FormField's
// registerField effect runs before its showIf early return, so a hidden field
// reports its spec exactly like a visible one.
// ─────────────────────────────────────────────────────────────────────────────
const Panel = ({ active, children }) => (
  <div style={{ display: active ? 'contents' : 'none' }}>{children}</div>
);

const PostOpTab = () => {
  const [activeMonTab, setActiveMonTab] = useState('observations');

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
        Post-Procedure
      </h2>
      <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: '0 0 20px' }}>
        Tab 7 of 8 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>post-procedure</span>
      </p>

      <Section title="Monitoring">
        {/* Monitoring Inner Navigation Bar */}
        <div
          style={{
            gridColumn: '1 / -1',
            display: 'flex',
            gap: '8px',
            marginBottom: '16px',
            borderBottom: '1px solid #e8e8e8',
            paddingBottom: '12px',
            flexWrap: 'wrap',
          }}
        >
          {MONITORING_TABS.map((tab) => {
            const isActive = activeMonTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveMonTab(tab.id)}
                style={{
                  background: isActive ? '#0a0a0a' : '#ffffff',
                  color: isActive ? '#ffffff' : '#4a4a4a',
                  border: isActive ? '1px solid #0a0a0a' : '1px solid #d4d4d4',
                  borderRadius: '4px',
                  padding: '6px 14px',
                  fontSize: '12px',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  boxShadow: isActive ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                }}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* 1. Timed Observations & Recovery */}
        <Panel active={activeMonTab === 'observations'}>
          <>
            <FormField k="ppPlan" label="Post-Procedure Monitoring Plan" type="select" options={['Standard recovery', 'Intensive (q15min×2h)', 'ICU/HDU continuous', 'Ward observation', 'Outpatient — discharge same day']} />
            <FormField
              k="ppObs"
              label="Timed Observations"
              type="array"
              full
              tableMode
              addLabel="+ Add Observation"
              cols={3}
              subFields={[
                { k: 'time', l: 'Time', t: 'datetime-local' },
                { k: 'bpSys', l: 'BP Systolic', t: 'number' },
                { k: 'bpDia', l: 'BP Diastolic', t: 'number' },
                { k: 'hr', l: 'Heart Rate', t: 'number' },
                { k: 'rr', l: 'Resp Rate', t: 'number' },
                { k: 'spo2', l: 'SpO₂ (%)', t: 'number' },
                { k: 'temp', l: 'Temp (°C)', t: 'number' },
                { k: 'gcs', l: 'GCS / LOC', t: 'number' },
                { k: 'sedation', l: 'Sedation Score', t: 'number' },
                { k: 'orientation', l: 'Orientation / Cognition', t: 'text' },
                { k: 'interventions', l: 'Interventions', t: 'text' },
                { k: 'assessedBy', l: 'Assessed By', t: 'text' },
              ]}
            />
            <FormField
              k="ppComplications"
              label="Complications / Adverse Events"
              type="array"
              full
              tableMode
              addLabel="+ Add Event"
              cols={2}
              subFields={[
                { k: 'time', l: 'Date & Time', t: 'datetime-local' },
                { k: 'desc', l: 'Event Description', t: 'text' },
                { k: 'ctcae', l: 'Severity', t: 'select', o: ['Grade 1 (Mild)', 'Grade 2 (Moderate)', 'Grade 3 (Severe)', 'Grade 4 (Life-threatening)', 'Grade 5 (Death)'] },
                { k: 'relatedTo', l: 'Related To', t: 'select', o: ['Procedure', 'Anaesthesia', 'Medication', 'Disease', 'Unrelated'] },
                { k: 'mgmt', l: 'Management', t: 'textarea' },
                { k: 'outcome', l: 'Outcome', t: 'select', o: ['Resolved', 'Resolving', 'Persistent', 'Worsened', 'Death'] },
              ]}
            />
          </>
        </Panel>

        {/* 2. Drug Level Labs (TDM) */}
        <Panel active={activeMonTab === 'tdm'}>
          <>
            <FormField label="Therapeutic Drug Monitoring (TDM) Baseline & Follow-up" type="subhead" />
            <FormField k="ppTdmDate" label="Sample Collection Date & Time" type="datetime-local" />
            <FormField k="ppTdmTrough" label="12-Hour Trough Level Confirmed" type="radio" options={O.yesno} />
            <FormField k="ppTdmLithium" label="Lithium Level" type="number" unit="mmol/L" hint="0.6–1.0 maintenance / 0.8–1.2 acute" />
            <FormField k="ppTdmValproate" label="Valproic Acid / Divalproex" type="number" unit="µg/mL" hint="50–125 µg/mL" />
            <FormField k="ppTdmCarbamazepine" label="Carbamazepine Level" type="number" unit="µg/mL" hint="4–12 µg/mL" />
            <FormField k="ppTdmClozapine" label="Clozapine Level" type="number" unit="ng/mL" hint=">350 ng/mL threshold" />
            <FormField k="ppTdmNorclozapine" label="Norclozapine Level" type="number" unit="ng/mL" />
            <FormField k="ppTdmLamotrigine" label="Lamotrigine Level" type="number" unit="µg/mL" hint="3–14 µg/mL" />
            <FormField k="ppTdmAnc" label="Absolute Neutrophil Count (ANC)" type="number" unit="/µL" hint="Clozapine safety monitoring" />
            <FormField k="ppTdmOther" label="Other Drug Level / Assay" type="text" placeholder="e.g. Nortriptyline, Haloperidol" />
            <FormField k="ppTdmInterp" label="TDM Clinical Interpretation" type="textarea" full placeholder="Interpret level relative to clinical response, toxicity, or non-adherence..." />
            <FormField k="ppTdmAction" label="Dosage Adjustment / Recommendation" type="textarea" full placeholder="e.g. Increase dose, maintain current dose, repeat level in 1 week..." />
          </>
        </Panel>

        {/* 3. IP Nursing & Behaviour Log */}
        <Panel active={activeMonTab === 'ip_nursing'}>
          <>
            <FormField label="Inpatient Ward Nursing, Behaviour & Observation Shift Log" type="subhead" />
            <FormField k="ppNurseShift" label="Shift Period" type="select" options={['Morning (07:00–15:00)', 'Evening (14:00–22:00)', 'Night (21:00–08:00)']} />
            <FormField k="ppNurseName" label="Staff Nurse in Charge" type="text" />
            <FormField k="ppNurseObsLevel" label="Observation Status / Level" type="select" options={['General Observation (q1-2h)', 'Intermittent Observation (q15-30min)', 'Continuous 1:1 Eyesight', 'Within Arms Length 1:1']} />
            <FormField k="ppNurseMood" label="General Mood & Demeanour" type="select" options={['Calm & cooperative', 'Anxious / Restless', 'Guarded / Suspicious', 'Agitated / Verbally hostile', 'Physically aggressive', 'Withdrawn / Mute', 'Euphoric / Disinhibited', 'Drowsy / Sedated', 'Confused / Disoriented']} />
            <FormField k="ppNurseAgitationScale" label="Agitation / Violence Risk Score" type="select" options={['BVC 0 (No imminent risk)', 'BVC 1-2 (Moderate risk — de-escalation needed)', 'BVC ≥3 (High risk — preventive measures)', 'MOAS Low', 'MOAS Moderate / Severe']} />
            <FormField k="ppNurseSleepHours" label="Sleep Duration" type="number" unit="hours" />
            <FormField k="ppNurseSleepPattern" label="Sleep Quality / Pattern" type="select" options={['Undisturbed / Restful', 'Intermittent waking / Fragmented', 'Severe insomnia / Wandering', 'Hypersomnia / Excessively sedated']} />
            <FormField k="ppNurseDietHydration" label="Oral Intake / Hydration" type="select" options={['Adequate / Full diet', 'Reduced intake (<50%)', 'Poor intake / Refused meals', 'IV Fluids / Nutritional supplement given']} />
            <FormField k="ppNursePRNGiven" label="PRN Medication Administered During Shift" type="radio" options={O.yesno} />
            <FormField k="ppNursePRNDetails" label="PRN Details & Response" type="textarea" full showIf={{ k: 'ppNursePRNGiven', in: ['Yes'] }} placeholder="Drug, dose, route, indication, time given, and behavioural response..." />
            <FormField
              k="ppNurseIncidents"
              label="Incidents & Behavioural Events Log"
              type="array"
              full
              tableMode
              addLabel="+ Add Incident / Event"
              cols={2}
              subFields={[
                { k: 'time', l: 'Time of Incident', t: 'datetime-local' },
                { k: 'type', l: 'Incident Type', t: 'select', o: ['Agitation / Verbal aggression', 'Physical aggression', 'Self-harm / Ligature attempt', 'Attempted absconding', 'Fall / Physical injury', 'Medication refusal', 'Property damage', 'Other'] },
                { k: 'triggerDesc', l: 'Trigger & Behaviour Description', t: 'textarea' },
                { k: 'intervention', l: 'De-escalation / Interventions Used', t: 'textarea' },
                { k: 'outcome', l: 'Resolution / Outcome', t: 'select', o: ['De-escalated verbally', 'PRN medication accepted', 'Rapid tranquilisation required', 'Physical restraint used', 'Nurse 1:1 initiated', 'Medical review conducted'] },
                { k: 'staff', l: 'Staff Documenting', t: 'text' },
              ]}
            />
            <FormField k="ppNurseHandoverSummary" label="Nursing Handover Summary" type="textarea" full placeholder="Key concerns, risk updates, and instructions for next shift..." />
          </>
        </Panel>

        {/* 4. Efficacy vs Side-Effects */}
        <Panel active={activeMonTab === 'efficacy_side_effects'}>
          <>
            <FormField label="Clinical Efficacy vs Side-Effect Burden Balance" type="subhead" />
            <FormField k="ppEffCgiS" label="CGI-Severity (Current)" type="select" options={['1 — Normal / not ill', '2 — Borderline mentally ill', '3 — Mildly ill', '4 — Moderately ill', '5 — Markedly ill', '6 — Severely ill', '7 — Extremely ill']} />
            <FormField k="ppEffCgiI" label="CGI-Improvement (vs Baseline)" type="select" options={['1 — Very much improved', '2 — Much improved', '3 — Minimally improved', '4 — No change', '5 — Minimally worse', '6 — Much worse', '7 — Very much worse']} />
            <FormField k="ppEffTargetSymptomResponse" label="Target Symptom Response" type="select" options={['Full Remission (>75% symptom reduction)', 'Significant Response (50–75% reduction)', 'Partial Response (25–49% reduction)', 'Non-response (<25% reduction)', 'Worsening / Deterioration']} />
            <FormField k="ppEffCurrentScore" label="Current Rating Scale Score" type="number" hint="e.g. HAM-D, MADRS, YMRS, PANSS score" />
            <FormField
              k="ppEffSideEffectsList"
              label="Observed / Patient-Reported Side Effects"
              type="checks"
              full
              options={[
                'None',
                'Sedation / Drowsiness',
                'Insomnia / Agitation',
                'Weight gain / Increased appetite',
                'Nausea / GI discomfort / Constipation',
                'Headache',
                'Dizziness / Orthostatic hypotension',
                'Tremor / Rigidity (EPS)',
                'Akathisia (motor restlessness)',
                'Dry mouth / Blurred vision / Anticholinergic',
                'Sexual dysfunction',
                'Cognitive slowing / Memory blunting',
                'Emotional blunting',
                'Hyperprolactinemia / Galactorrhea',
                'Tachycardia / Palpitations',
                'Skin rash / Dermatological',
              ]}
            />
            <FormField k="ppEffSeverityRating" label="Overall Side Effect Severity (FIBSER / UKU)" type="select" options={['0 — None', '1 — Mild (no functional impairment)', '2 — Moderate (some functional impairment)', '3 — Severe (significant impairment / unsafe)']} />
            <FormField k="ppEffRiskBenefitRatio" label="Efficacy to Tolerability Ratio" type="select" options={['Highly Favourable (Good response, no/minimal side effects)', 'Acceptable (Effective with manageable side effects)', 'Equivocal (Moderate benefit balanced by side effects)', 'Unfavourable (Side effects outweigh therapeutic benefit)', 'Intolerable (Severe toxicity / requires immediate change)']} />
            <FormField k="ppEffManagementPlan" label="Side-Effect Management & Optimization Strategy" type="textarea" full placeholder="e.g. Dose reduction, switch medication, add adjunctive counter-medication (Propranolol, Benztropine, etc.)..." />
          </>
        </Panel>

        {/* 5. Treatment Resistance */}
        <Panel active={activeMonTab === 'treatment_resistance'}>
          <>
            <FormField label="Treatment Resistance Staging & Refractoriness Assessment" type="subhead" />
            <FormField k="ppTrCriteriaMet" label="Meets Consensus Definition for Treatment Resistance" type="radio" options={O.yesno} />
            <FormField k="ppTrDisorder" label="Primary Resistant Domain / Disorder" type="select" options={['Treatment-Resistant Depression (TRD)', 'Treatment-Resistant Schizophrenia (TRS)', 'Treatment-Resistant Bipolar Disorder (TRBD)', 'Treatment-Resistant OCD (TR-OCD)', 'Treatment-Resistant Catatonia', 'Refractory Neuropsychiatric Symptoms']} />
            <FormField k="ppTrStaging" label="Staging Model Classification" type="select" options={[
              'Stage 0 — Pseudo-resistance (inadequate trial/compliance)',
              'Stage 1 — Failed ≥1 adequate first-line medication trial',
              'Stage 2 — Failed ≥2 adequate trials of different chemical classes',
              'Stage 3 — Stage 2 + Failed augmentation/combination therapy',
              'Stage 4 — Stage 3 + Failed neuromodulation (ECT / rTMS / Ketamine)',
              'Stage 5 — Ultra-resistant / Psychosurgery candidate'
            ]} />
            <FormField k="ppTrFailedTrialsCount" label="Total Number of Failed Adequate Drug Trials" type="number" />
            <FormField
              k="ppTrAdequacyCheck"
              label="Adequacy Criteria Verified for Prior Trials"
              type="checks"
              full
              options={[
                'Adequate therapeutic dose achieved',
                'Adequate duration (≥4–8 weeks per trial)',
                'Patient compliance / adherence confirmed (TDM/pill count)',
                'Correct diagnostic formulation confirmed',
                'Secondary organic / metabolic etiologies ruled out',
                'Concurrent substance misuse assessed and addressed'
              ]}
            />
            <FormField
              k="ppTrPastTrials"
              label="Chronological Log of Failed Interventions"
              type="array"
              full
              tableMode
              addLabel="+ Add Prior Trial"
              cols={3}
              subFields={[
                { k: 'agent', l: 'Drug / Modality', t: 'text' },
                { k: 'maxDose', l: 'Peak Dose', t: 'text' },
                { k: 'durationWeeks', l: 'Duration (wks)', t: 'number' },
                { k: 'adherence', l: 'Adherence', t: 'select', o: ['Good / Verified', 'Partial', 'Poor / Suspected', 'Unknown'] },
                { k: 'reasonFailure', l: 'Reason for Discontinuation', t: 'select', o: ['Lack of efficacy', 'Intolerable side effects', 'Patient non-adherence', 'Medical contraindication', 'Cost / access'] },
                { k: 'notes', l: 'Clinical Outcome / Notes', t: 'text' },
              ]}
            />
            <FormField
              k="ppTrAugmentationOptions"
              label="Evidence-Based Next-Line / Augmentation Strategies"
              type="checks"
              full
              options={[
                'Atypical Antipsychotic Augmentation (Aripiprazole, Quetiapine, Brexpiprazole)',
                'Lithium Augmentation',
                'Thyroid Hormone (T3 / Liothyronine) Augmentation',
                'Dual Antidepressant Combination (e.g. California Rocket Fuel)',
                'Intravenous / Intranasal Ketamine or Esketamine',
                'Repetitive TMS (rTMS / iTBS Protocol)',
                'Electroconvulsive Therapy (ECT)',
                'Clozapine Initiation Protocol (TRS standard)',
                'Deep Brain Stimulation (DBS) Evaluation',
                'Intensive Evidence-Based Psychotherapy (CBT / ERP / Schema)'
              ]}
            />
            <FormField k="ppTrRecommendation" label="Specialist Formulation & Next-Step Plan" type="textarea" full llm placeholder="Comprehensive summary of treatment resistance formulation and algorithmic next steps..." />
          </>
        </Panel>
      </Section>

      <Section title="Cognitive & Symptom Review">
        <FormField k="ppCognition" label="Post-procedure Cognitive Status" type="select" options={['At baseline', 'Mild transient impairment', 'Confusion/disorientation', 'Anterograde amnesia', 'Retrograde amnesia', 'Delirium']} />
        <FormField k="ppMMSE" label="Post-procedure MMSE / MoCA" type="number" />
        <FormField k="ppScale" label="Post-procedure Primary Symptom Score" type="number" hint="compare to pre-procedure baseline" />
        <FormField k="ppResponse" label="Response Assessment" type="select" options={O.outcome} />
        <FormField k="ppCSSRS" label="Suicide Risk Re-assessment (C-SSRS)" />
        <FormField k="ppInstructions" label="Post-procedure Instructions Given" type="textarea" full />
        <FormField k="ppRestrictions" label="Restrictions" type="checks" full options={['No driving 24h', 'Responsible adult escort', 'No operating machinery', 'Avoid alcohol/sedatives', 'Fasting resumed to diet', 'Return precautions given']} />
        <FormField k="ppWarning" label="Warning Signs Counseled" type="checks" full options={['Prolonged confusion', 'Severe headache', 'Fever', 'Chest pain', 'Worsening mood / suicidality', 'Seizure', 'Device site problems (DBS/VNS)']} />
        <FormField
          k="ppMeds"
          label="Medications Post-Procedure"
          type="array"
          full
          tableMode
          addLabel="+ Add Medication"
          cols={3}
          subFields={[
            { k: 'drug', l: 'Drug', t: 'text' },
            { k: 'dose', l: 'Dose', t: 'text' },
            { k: 'route', l: 'Route', t: 'select', o: O.route },
            { k: 'freq', l: 'Frequency', t: 'select', o: O.freq },
            { k: 'start', l: 'Start', t: 'date' },
            { k: 'reason', l: 'Reason', t: 'text' },
          ]}
        />
      </Section>

      <Section title="Follow-up & Discharge">
        <FormField k="ppFuDate" label="Follow-up Appointment Date" type="date" />
        <FormField k="ppFuTime" label="Follow-up Time" type="time" />
        <FormField k="ppFuDept" label="Department / Clinician" />
        <FormField k="ppNextSession" label="Next Treatment Session" type="select" options={['Scheduled', 'To be scheduled', 'Course complete', 'N/A']} />
        <FormField k="ppFuInstr" label="Specific Follow-up Instructions" type="textarea" full />
        <FormField k="ppDischargeReady" label="Ready for Discharge" type="select" options={['Yes — home', 'Yes — to ward', 'Yes — community team', 'No — needs observation', 'No — needs admission']} />
        <FormField k="ppReferrals" label="Onward Referrals" type="checks" full options={['None', 'Psychology', 'Community Mental Health Team', 'Crisis team', 'Social work', 'Occupational therapy', 'Neurology', 'Care of the elderly']} />
        <FormField k="ppBarriers" label="Barriers to Discharge" type="checks" full options={['None', 'Ongoing risk', 'Cognitive impairment', 'Awaiting results', 'Social/placement issues', 'Escort unavailable']} />
      </Section>
    </div>
  );
};

export default PostOpTab;
