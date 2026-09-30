import React from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';
import SessionHistory, { formatSavedAt, sessionTime } from '../components/SessionHistory';
import AssessmentDashboard from '../components/AssessmentDashboard';
import { mseSessionResult } from '../context/tabFieldMap';
// Option lists come FROM the scale, not retyped here: an option that drifted by
// one word would score as unmapped and quietly stop counting towards the index.
import { IMPRESSION_OPTIONS } from '../context/clinicalScale';
import { downloadMseReport } from '../utils/reportGenerator';

// Fields already shown in a history entry's header — skipped in the detail body.
const DETAIL_SKIP = ['mseDate', 'moodObjective'];

const MSETab = () => {
  const { mseSessions, formData } = useNeuropsychiatry();

  // Every saved examination, date-wise (newest first) — the clinical examination
  // date when one was entered, otherwise when it was saved.
  const entries = [...(mseSessions || [])]
    .sort((a, b) => sessionTime(b, 'mseDate') - sessionTime(a, 'mseDate'))
    .map((session) => {
      const data = session.data || {};
      const savedLabel = formatSavedAt(session.saved_at);
      const metaBits = [
        data.mseExaminer,
        data.mmse && `MMSE ${data.mmse}`,
        data.moca && `MoCA ${data.moca}`,
        savedLabel && `saved ${savedLabel}`,
      ].filter(Boolean);
      return {
        id: session.id,
        dateLabel: data.mseDate || savedLabel || '—',
        title: data.moodObjective || 'Mental state examination',
        note: mseSessionResult(data),
        badge: `Examination ${session.session_no}`,
        meta: metaBits.join(' · '),
        data,
        skipKeys: DETAIL_SKIP,
      };
    });

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
            MSE & Cognition
          </h2>
          <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: 0 }}>
            Tab 2 of 9 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>mse</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadMseReport(formData)}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#ffffff',
            color: '#2e2e2e',
            border: '1px solid #d4d4d4',
            borderRadius: '2px',
            padding: '6px 12px',
            fontSize: '12px',
            fontWeight: 500,
            fontFamily: 'inherit',
            cursor: 'pointer',
            transition: 'all .15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#fafafa';
            e.currentTarget.style.borderColor = '#999999';
            e.currentTarget.style.color = '#0a0a0a';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#ffffff';
            e.currentTarget.style.borderColor = '#d4d4d4';
            e.currentTarget.style.color = '#2e2e2e';
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Download Report
        </button>
      </div>

      {/* ── Analytical dashboard — this examination scored against the benchmark
             scale, and how it has moved across visits. `formData` is passed as
             the provisional visit so the numbers move WHILE the examination is
             being filled in (dictated or typed); it is drawn as unsaved and is
             deliberately kept out of the saved trend line. ────────────────── */}
      <AssessmentDashboard
        sessions={mseSessions}
        provisional={formData}
        dateKey="mseDate"
        title="MSE Assessment Dashboard"
      />

      {/* ── History records — collapsible, default collapsed, date-wise ──────── */}
      <SessionHistory
        entries={entries}
        countLabel={entries.length === 1 ? '1 examination' : `${entries.length} examinations`}
      />

      <Section title="2.0 — Examination Details">
        {/* An MSE is a snapshot, so every save appends a new examination rather
            than overwriting the last one. These two fields are what make the
            history above readable: when the examination happened (which is not
            necessarily when it was typed up) and who performed it. */}
        <FormField k="mseDate" label="Date of Examination" type="date" />
        <FormField k="mseExaminer" label="Examined By" type="text" placeholder="e.g. Dr. Jane Doe" />
        <FormField label="Saving this tab records a NEW examination — the series is kept, and every previous one stays available under History records above." type="note" />
      </Section>

      <Section title="2.1 — Appearance & Behaviour">
        <FormField k="appearance" label="General Appearance" type="select" options={['Well-kempt', 'Unkempt/self-neglect', 'Dishevelled', 'Bizarre', 'Age-appropriate', 'Signs of weight loss', 'Signs of intoxication']} />
        <FormField k="behaviour" label="Behaviour" type="select" options={['Cooperative', 'Guarded', 'Suspicious', 'Hostile/aggressive', 'Withdrawn', 'Disinhibited', 'Agitated', 'Preoccupied']} />
        <FormField k="eyeContact" label="Eye Contact" type="select" options={['Appropriate', 'Reduced', 'Avoidant', 'Intense/staring']} />
        <FormField k="rapport" label="Rapport" type="select" options={['Easily established', 'Difficult', 'Not established']} />
        <FormField k="psychomotor" label="Psychomotor Activity" type="select" options={['Normal', 'Retardation', 'Agitation', 'Stupor', 'Catatonic features']} />
        <FormField k="catatonia" label="Catatonic Signs (Bush-Francis screen)" type="checks" full options={['None', 'Stupor', 'Mutism', 'Negativism', 'Posturing', 'Waxy flexibility', 'Echolalia', 'Echopraxia', 'Stereotypy', 'Automatic obedience', 'Ambitendency', 'Grimacing']} />
        <FormField k="eps" label="Extrapyramidal / Movement Signs" type="checks" full options={['None', 'Tremor', 'Rigidity', 'Bradykinesia', 'Akathisia', 'Dystonia', 'Tardive dyskinesia', 'Gait abnormality']} />
        <FormField k="appearanceNotes" label="Additional Observations" type="textarea" full />
      </Section>

      <Section title="2.2 — Speech">
        <FormField k="speechRate" label="Rate" type="select" options={['Normal', 'Increased (pressured)', 'Reduced', 'Mute']} />
        <FormField k="speechVolume" label="Volume" type="select" options={['Normal', 'Loud', 'Soft', 'Whispered']} />
        <FormField k="speechTone" label="Tone / Prosody" type="select" options={['Normal', 'Monotonous', 'Dysarthric', 'Dysprosodic']} />
        <FormField k="speechFlow" label="Flow / Quantity" type="select" options={['Normal', 'Circumstantial', 'Tangential', 'Poverty of speech', 'Flight of ideas', 'Loosening of associations']} />
        <FormField k="speechFormal" label="Formal Thought Disorder Evident" type="radio" options={O.yesno} />
      </Section>

      <Section title="2.3 — Mood & Affect">
        <FormField k="moodSubjective" label="Mood — Subjective" placeholder="patient's own words" />
        <FormField k="moodObjective" label="Mood — Objective" type="select" options={['Euthymic', 'Depressed', 'Elated/euphoric', 'Irritable', 'Anxious', 'Perplexed', 'Labile']} />
        <FormField k="affectRange" label="Affect — Range" type="select" options={['Full', 'Restricted', 'Blunted', 'Flat']} />
        <FormField k="affectReactivity" label="Affect — Reactivity" type="select" options={['Reactive', 'Non-reactive']} />
        <FormField k="affectCongruence" label="Congruence" type="select" options={['Congruent', 'Incongruent']} />
        <FormField k="affectAppropriate" label="Appropriateness" type="select" options={['Appropriate', 'Inappropriate']} />
      </Section>

      <Section title="2.4 — Thought (Form, Content, Possession)">
        <FormField k="thoughtForm" label="Thought Form" type="select" options={['Logical & goal-directed', 'Circumstantial', 'Tangential', 'Flight of ideas', 'Loosening of associations', 'Thought block', 'Neologisms', 'Word salad', 'Perseveration']} />
        <FormField k="delusions" label="Delusions" type="checks" full options={['None', 'Persecutory', 'Grandiose', 'Reference', 'Control/passivity', 'Nihilistic', 'Guilt', 'Hypochondriacal', 'Jealousy', 'Erotomanic', 'Religious', 'Bizarre']} />
        <FormField k="delusionDetail" label="Delusion Detail" type="textarea" full showIf={{ k: 'delusions', in: ['Persecutory', 'Grandiose', 'Reference', 'Control/passivity', 'Nihilistic', 'Guilt', 'Hypochondriacal', 'Jealousy', 'Erotomanic', 'Religious', 'Bizarre'] }} />
        <FormField k="thoughtPossession" label="Thought Possession / Passivity" type="checks" full options={['None', 'Thought insertion', 'Thought withdrawal', 'Thought broadcasting', 'Made acts/feelings/impulses']} />
        <FormField k="obsessions" label="Obsessions / Compulsions" type="checks" full options={['None', 'Contamination', 'Checking', 'Symmetry/ordering', 'Hoarding', 'Aggressive/harm', 'Sexual', 'Religious', 'Compulsive rituals']} />
        <FormField k="suicidalThoughts" label="Suicidal Ideation" type="radio" options={['None', 'Passive', 'Active without plan', 'Active with plan', 'Active with intent']} />
        <FormField k="homicidalThoughts" label="Homicidal / Harm-to-others Ideation" type="radio" options={['None', 'Present']} />
      </Section>

      <Section title="2.5 — Perception">
        <FormField k="hallucinations" label="Hallucinations" type="checks" full options={['None', 'Auditory — 2nd person', 'Auditory — 3rd person', 'Auditory — commentary', 'Auditory — command', 'Visual', 'Olfactory', 'Gustatory', 'Tactile/somatic']} />
        <FormField k="hallucinationDetail" label="Hallucination Detail" type="textarea" full showIf={{ k: 'hallucinations', in: ['Auditory — 2nd person', 'Auditory — 3rd person', 'Auditory — commentary', 'Auditory — command', 'Visual', 'Olfactory', 'Gustatory', 'Tactile/somatic'] }} />
        <FormField k="otherPerception" label="Other Perceptual Disturbance" type="checks" full options={['None', 'Illusions', 'Depersonalisation', 'Derealisation', 'Déjà vu', 'Heightened perception']} />
      </Section>

      <Section title="2.6 — Cognition (Bedside)">
        <FormField k="conscLevel" label="Level of Consciousness" type="select" options={['Alert', 'Drowsy', 'Fluctuating', 'Clouding', 'Stuporous']} />
        <FormField k="orientation" label="Orientation" type="checks" options={['Person', 'Place', 'Time', 'Situation']} />
        <FormField k="attention" label="Attention & Concentration" type="select" options={['Normal', 'Mildly impaired', 'Moderately impaired', 'Severely impaired']} />
        <FormField k="digitSpan" label="Digit Span (forward/backward)" placeholder="e.g., 6 / 4" />
        <FormField k="shortMemory" label="Short-term / Recall Memory" type="select" options={['Intact', 'Impaired']} />
        <FormField k="longMemory" label="Long-term Memory" type="select" options={['Intact', 'Impaired']} />
        <FormField k="workingMemory" label="Working Memory (serial 7s / WORLD)" type="select" options={['Intact', 'Impaired']} />
        <FormField k="language" label="Language" type="select" options={['Normal', 'Dysphasia', 'Dysarthria', 'Anomia']} />
        <FormField k="executive" label="Executive Function (bedside)" type="select" options={['Normal', 'Impaired']} />
        <FormField k="confabulation" label="Confabulation" type="radio" options={O.present} />
      </Section>

      <Section title="2.7 — Insight & Judgement">
        <FormField k="insight" label="Insight" type="select" options={O.insight} />
        <FormField k="judgement" label="Judgement" type="select" options={['Intact', 'Impaired', 'Grossly impaired']} />
        <FormField k="capacityTreatment" label="Capacity re: Treatment Decision" type="select" options={['Has capacity', 'Lacks capacity', 'Fluctuating', 'Not assessed']} />
        <FormField k="insightNotes" label="Insight / Capacity Notes" type="textarea" full />
      </Section>

      <Section title="2.8 — Risk Assessment">
        <FormField k="riskSelfHarm" label="Risk of Self-Harm / Suicide" type="radio" options={O.riskLevel} />
        <FormField k="riskViolence" label="Risk to Others / Violence" type="radio" options={O.riskLevel} />
        <FormField k="riskNeglect" label="Risk of Self-Neglect" type="radio" options={O.riskLevel} />
        <FormField k="riskVulnerability" label="Risk of Vulnerability / Exploitation" type="radio" options={O.riskLevel} />
        <FormField k="riskAbsconding" label="Risk of Absconding" type="radio" options={O.riskLevel} />
        <FormField k="protectiveFactors" label="Protective Factors" type="checks" full options={['Social support', 'Engaged with services', 'Future-oriented', 'Responsibility for dependents', 'Help-seeking', 'Religious/moral beliefs', 'No access to means']} />
        <FormField k="riskFormulation" label="Risk Formulation & Management Plan" type="textarea" full llm />
        <FormField k="cSSRS" label="C-SSRS Screen Result" placeholder="e.g., ideation 3, behaviour none" />
      </Section>

      <Section title="2.9 — Cognitive Screening & Movement Scales">
        {/* Each score is paired with a clinical impression. A consultation does not
            contain an MMSE total — it contains a patient who cannot say what month
            it is and has stopped managing her own tablets. Turning that into
            "MMSE 22" would put a test that was never administered into the record
            and then plot it; the impression records the same severity honestly.
            The scale scores whichever is present, and the score wins if both are.

            No impression exists for the clock, the digit span or the C-SSRS: the
            first two are specific administrations, and an inferred suicide risk is
            the one value this system must never produce. */}
        <FormField label="Fill a score only where the test was actually administered. Otherwise record the impression — the dashboard scores whichever is present, marks impressions as inferred, and lets the measured score win when you have both." type="note" />

        <FormField k="mmse" label="MMSE Score (0–30)" type="number" max={30} />
        <FormField k="moca" label="MoCA Score (0–30)" type="number" max={30} />
        <FormField k="aceIII" label="ACE-III Score (0–100)" type="number" max={100} />
        <FormField k="cogImpression" label="Global Cognition — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.cogImpression} hint="if no MMSE / MoCA / ACE-III was done" />

        <FormField k="clock" label="Clock Drawing Test" type="select" options={['Normal (3)', 'Minor errors (2)', 'Inaccurate (1)', 'No attempt (0)']} />
        <FormField k="fab" label="Frontal Assessment Battery (0–18)" type="number" max={18} />
        <FormField k="execImpression" label="Executive / Frontal Function — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.execImpression} hint="if no FAB was done" />

        <FormField k="aims" label="AIMS Total (Tardive Dyskinesia, 0–28)" type="number" max={28} />
        <FormField k="dyskinesiaImpression" label="Involuntary Movements — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.dyskinesiaImpression} hint="observed or described only" />

        <FormField k="basAkathisia" label="Barnes Akathisia Rating Scale (0–14)" type="number" max={14} />
        <FormField k="akathisiaImpression" label="Restlessness / Akathisia — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.akathisiaImpression} hint="observed or described only" />

        <FormField k="simpson" label="Simpson-Angus EPS Scale (0–40)" type="number" max={40} />
        <FormField k="parkinsonismImpression" label="Stiffness / Parkinsonism — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.parkinsonismImpression} hint="observed or described only" />

        <FormField k="cognitiveSummary" label="Cognitive / Neuropsychiatric Summary" type="textarea" full placeholder="Attention, Memory, Language, Visuospatial, Executive, Social cognition" />
      </Section>
    </div>
  );
};

export default MSETab;
