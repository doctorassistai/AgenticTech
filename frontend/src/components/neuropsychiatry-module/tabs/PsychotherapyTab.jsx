import React from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';
import SessionHistory, { formatSavedAt, sessionTime } from '../components/SessionHistory';
import PsychotherapyDashboard from '../components/PsychotherapyDashboard';
import { psychotherapySessionResult } from '../context/tabFieldMap';
// Option lists come FROM the scale, not retyped here: an option that drifted by
// one word would score as unmapped and quietly stop counting towards the index.
import { IMPRESSION_OPTIONS } from '../context/psychotherapyScale';
import { downloadPsychotherapyReport } from '../utils/reportGenerator';

// Fields already shown in a history entry's header — skipped in the detail body.
const DETAIL_SKIP = ['cbtSessionDate', 'cbtPrimaryModality'];

const PsychotherapyTab = () => {
  const { psychotherapySessions, formData } = useNeuropsychiatry();

  // Every saved CBT session, date-wise (newest first) — the clinical session
  // date when one was entered, otherwise when it was saved.
  const entries = [...(psychotherapySessions || [])]
    .sort((a, b) => sessionTime(b, 'cbtSessionDate') - sessionTime(a, 'cbtSessionDate'))
    .map((session) => {
      const data = session.data || {};
      const savedLabel = formatSavedAt(session.saved_at);
      const metaBits = [
        data.cbtTherapist,
        data.cbtModality,
        savedLabel && `saved ${savedLabel}`,
      ].filter(Boolean);
      return {
        id: session.id,
        dateLabel: data.cbtSessionDate || savedLabel || '—',
        title: data.cbtPrimaryModality || 'Psychotherapy session',
        note: psychotherapySessionResult(data),
        badge: `Session ${data.cbtSessionNum || session.session_no}`,
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
            Psychotherapy & CBT Session Log
          </h2>
          <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: 0 }}>
            Tab 7 of 9 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>cbt-psychotherapy</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadPsychotherapyReport(formData)}
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

      {/* ── Progress dashboard — the course scored against the CBT benchmark ──
          `provisional` is the live form, so the session being written scores as
          it is filled, before it is ever saved. Two indices, kept apart: how ill
          the patient is, and how the therapy itself is going. ─────────────── */}
      <PsychotherapyDashboard
        sessions={psychotherapySessions}
        provisional={formData}
        dateKey="cbtSessionDate"
        title="CBT / Psychotherapy Progress Dashboard"
      />

      {/* ── History records — collapsible, default collapsed, date-wise ──────── */}
      <SessionHistory entries={entries} />

      <Section title="Session Logistics & Billing Details">
        <FormField k="cbtSessionDate" label="Session Date" type="date" />
        <FormField k="cbtSessionNum" label="Session Number" type="number" placeholder="e.g. 4" />
        <FormField k="cbtTotalSessions" label="Total Planned Sessions" type="number" placeholder="e.g. 12" />
        <FormField k="cbtModality" label="Session Modality" type="select" options={['In-Person (Clinic)', 'Telehealth - Video', 'Telehealth - Audio Only', 'Home Visit / Community']} />
        <FormField k="cbtDuration" label="Session Duration" type="number" unit="mins" placeholder="e.g. 50" />
        <FormField k="cbtBillingCode" label="CPT / Billing Code" type="select" options={['90832 (Psychotherapy, 30 mins)', '90834 (Psychotherapy, 45 mins)', '90837 (Psychotherapy, 60 mins)', '90847 (Family Psychotherapy w/ Patient)', '90853 (Group Psychotherapy)']} />
        <FormField k="cbtTherapist" label="Therapist / Provider Name" type="text" placeholder="e.g. Dr. Jane Doe, PsyD" />
      </Section>

      <Section title="Routine Outcome Monitoring (Symptom Scales)">
        {/* Each instrument is paired with a clinical impression. A consultation
            does not contain a PHQ-9 total — it contains "still low in the
            evenings, but getting to work" — and inventing a total from that would
            put a measurement that never happened into the record, then plot it.
            The impression holds the severity honestly instead; the scale scores
            whichever is present and the instrument wins if both are. */}
        <FormField label="Fill a score only where the questionnaire was actually administered. Otherwise record the impression — the dashboard scores whichever is present, marks impressions as inferred, and lets the measured total win when you have both." type="note" />

        <FormField k="cbtPhq9" label="PHQ-9 Score (Depression)" type="number" hint="Range 0-27" placeholder="0-27" />
        <FormField k="cbtMoodImpression" label="Depression — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.cbtMoodImpression} hint="if no PHQ-9 was done" />

        <FormField k="cbtGad7" label="GAD-7 Score (Anxiety)" type="number" hint="Range 0-21" placeholder="0-21" />
        <FormField k="cbtAnxietyImpression" label="Anxiety — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.cbtAnxietyImpression} hint="if no GAD-7 was done" />

        <FormField k="cbtYbocs" label="Y-BOCS Score (OCD - if applicable)" type="number" hint="Range 0-40" placeholder="0-40" />
        <FormField k="cbtOcdImpression" label="Obsessive–Compulsive — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.cbtOcdImpression} hint="leave blank if OCD is not part of the picture" />

        <FormField k="cbtPreSuds" label="Pre-Session Subjective Distress (SUDs)" type="number" hint="Range 0-100" placeholder="0-100" />
        <FormField k="cbtDistressImpression" label="Distress on Arrival — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.cbtDistressImpression} hint="if no SUDs rating was given" />

        <FormField k="cbtPostSuds" label="Post-Session Subjective Distress (SUDs)" type="number" hint="Range 0-100" placeholder="0-100" />
        {/* Stands in for the DERIVED pre-minus-post change, not for the post
            rating itself: what a session reveals is "much calmer than when you
            came in", and the relief bands are the ones sudsChange already uses. */}
        <FormField k="cbtReliefImpression" label="Relief Across the Session — Clinical Impression" type="select" options={IMPRESSION_OPTIONS.cbtReliefImpression} hint="if the two SUDs numbers were not both given" />
      </Section>

      <Section title="Clinical Status & Risk Assessment">
        <FormField k="cbtMseBrief" label="Brief Mental Status Exam" type="select" options={['Within Normal Limits / Baseline', 'Depressed Mood / Restricted Affect', 'Anxious / Agitated', 'Hypomanic / Elevated', 'Cognitively Impaired / Disorganized']} />
        <FormField k="cbtRiskAssessment" label="Suicide / Self-Harm Risk Assessment" type="select" options={['No suicidal/self-harm ideation', 'Passive suicidal ideation (no plan/intent)', 'Active suicidal ideation without plan/intent', 'Active suicidal ideation WITH plan/intent (Urgent Action Required)', 'Self-harm urges present (No suicidal intent)']} />
        <FormField k="cbtSafetyPlan" label="Safety Plan Status" type="select" options={['Reviewed & Confirmed Adequate', 'Updated During Session', 'New Safety Plan Created', 'Not Required (Low Risk)']} />
      </Section>

      <Section title="Therapeutic Modality & Interventions">
        <FormField k="cbtPrimaryModality" label="Primary Therapeutic Approach" type="select" options={['Cognitive Behavioral Therapy (CBT)', 'Dialectical Behavior Therapy (DBT)', 'Acceptance & Commitment Therapy (ACT)', 'Exposure & Response Prevention (ERP)', 'EMDR / Trauma-Focused Therapy', 'Psychodynamic / Interpersonal Therapy', 'Supportive Psychotherapy']} />
        <FormField k="cbtAgenda" label="Session Agenda & Main Target Problem" type="textarea" full placeholder="e.g. Challenging automatic thoughts related to social avoidance; reviewing ERP hierarchy for contamination fear." />
        <FormField k="cbtInterventions" label="Specific Techniques / Interventions Utilized" type="select" options={['Cognitive Restructuring / Thought Records', 'Behavioral Activation / Activity Scheduling', 'Graded Exposure (In-Vivo / Imaginal)', 'Diaphragmatic Breathing / Progressive Muscle Relaxation', 'Mindfulness & Grounding Techniques', 'Socratic Questioning & Downward Arrow Technique', 'Decatastrophizing & Probability Estimation', 'Distress Tolerance & Emotion Regulation Skills (DBT)']} />
        <FormField k="cbtClinicalNotes" label="Detailed Clinical Narrative & Therapist Observations" type="textarea" full placeholder="Patient presented with heightened anxiety regarding upcoming work presentation..." />
      </Section>

      <Section title="Patient Engagement & Goal Progress">
        <FormField k="cbtEngagement" label="Patient Engagement & Alliance" type="select" options={['Highly Engaged & Collaborative', 'Moderately Engaged', 'Passive / Hesitant', 'Resistant / Guarded', 'Poor Therapeutic Alliance']} />
        <FormField k="cbtProgress" label="Progress Towards Treatment Goals" type="select" options={['Significant Progress', 'Moderate Progress', 'Minimal Progress', 'No Change', 'Temporary Regression']} />
      </Section>

      <Section title="Homework Assignment & Next Steps">
        {/* What was ASSIGNED was already recorded; whether it was DONE was not,
            and cannot be derived from anything else on the form. Between-session
            work is most of CBT's dose, so the process index needs this one field.
            "None was assigned last session" is an explicit not-applicable, so a
            first session is never scored as non-adherent. */}
        <FormField k="cbtHomeworkReview" label="Last Session's Homework — Completion" type="select" options={['Completed fully', 'Completed partially', 'Attempted, not completed', 'Not attempted', 'None was assigned last session']} />
        <FormField k="cbtHomeworkAssigned" label="Homework / Action Plan Assigned" type="textarea" full placeholder="e.g. 1. Complete 3 Thought Records when anxiety exceeds 50 SUDs. 2. Practice 10 minutes of daily diaphragmatic breathing." />
        <FormField k="cbtNextSession" label="Next Session Schedule" type="text" placeholder="e.g. Next Tuesday at 10:00 AM" />
      </Section>
    </div>
  );
};

export default PsychotherapyTab;
