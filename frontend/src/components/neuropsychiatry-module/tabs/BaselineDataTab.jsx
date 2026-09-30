import React, { useCallback, useMemo, useRef } from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';
import SessionHistory, {
  formatSavedAt,
  sessionTime,
  isEmptyVal,
  humanizeKey,
  renderVal,
} from '../components/SessionHistory';
import {
  baselineSessionResult,
  BASELINE_TABLE_SPEC,
  BASELINE_TABLE_KEYS,
} from '../context/tabFieldMap';
// TODO(copy-in): in the host app LabInvestigations.jsx sits beside its own
// shared/ folder (designTokens, FormComponents, api), so THIS ONE LINE must be
// re-pointed at that location when the module is copied in. Nothing else in this
// file depends on where the component lives.
import {
  LabInvestigations,
  NEURO_DEPARTMENT,
  NEURO_LAB_FIELDS,
} from '../../LabInvestigations';

// Shown in a history entry's header/meta, so they are kept out of the table body.
const HEADER_KEYS = new Set(['baselineDate', 'baselineRequestedBy']);

/**
 * The keys the investigations panel is allowed to write into formData: every
 * neuropsychiatry lab field except the three order-only rows, whose `order_*`
 * keys deliberately match no form field — those panels are orderable, but their
 * results are free text and live in the textareas at the bottom of section 3.5.
 *
 * Derived from the component's own list rather than retyped, so the two cannot
 * drift. Every key here is already in TAB_FIELDS.baseline and BASELINE_TABLE_SPEC.
 */
const NEURO_LAB_VALUE_KEYS = new Set(
  NEURO_LAB_FIELDS.filter((f) => !f.key.startsWith('order_')).map((f) => f.key),
);

// Static, so it is hoisted rather than re-created each render. Tags every order
// raised from this tab, and is what the Pending table's "Ordered For" column shows.
const BASELINE_ORDER_CONTEXT = {
  type: 'baseline',
  label: 'Baseline Investigations',
  booking_id: '',
};

/**
 * Turn one saved panel into the grouped rows SessionHistory's table renderer
 * wants: [{ group, rows: [{ k, label, value, unit }] }].
 *
 * Empty values are dropped (a panel rarely fills every row, and blank rows make
 * the numbers harder to read, which is the whole reason this one is a table).
 * Anything saved but missing from BASELINE_TABLE_SPEC lands under "Other" with a
 * humanised label rather than disappearing from the record.
 */
function buildBaselineTable(data = {}) {
  const groups = BASELINE_TABLE_SPEC.map(({ group, rows }) => ({
    group,
    rows: rows
      .filter(([k]) => !isEmptyVal(data[k]))
      .map(([k, label, unit]) => ({ k, label, value: renderVal(data[k]), unit })),
  }));

  const extra = Object.entries(data)
    .filter(([k, v]) => !BASELINE_TABLE_KEYS.has(k) && !HEADER_KEYS.has(k) && !isEmptyVal(v))
    .map(([k, v]) => ({ k, label: humanizeKey(k), value: renderVal(v), unit: '' }));
  if (extra.length) groups.push({ group: 'Other', rows: extra });

  return groups;
}

const BaselineDataTab = () => {
  const {
    baselineSessions,
    formData,
    updateField,
    patientId,
    doctorId,
    hospitalId,
    loading,
    recordId,
  } = useNeuropsychiatry();

  // Latest formData without listing it in handleLabChange's deps — the callback
  // has to stay identity-stable, or the panel's bubble-up effect would see a new
  // onChange every render.
  const formDataRef = useRef(formData);
  formDataRef.current = formData;

  /**
   * Map the investigations panel's ticked tests back into formData, so a value
   * typed beside a test is saved and read back by the history table exactly as
   * the old hand-entry fields were. This is the whole reason NEURO_LAB_FIELDS
   * reuses this tab's field keys.
   *
   * Only keys PRESENT in the payload are written; absent keys are never cleared.
   * That is what makes mounting safe: the panel starts with nothing selected, so
   * its first report is an empty list and must not wipe a hydrated panel.
   * Unticking a test therefore leaves its last value, and blanking the box clears
   * it — an empty string is still a write.
   */
  const handleLabChange = useCallback(
    (state) => {
      for (const f of state?.labOrder?.fields ?? []) {
        if (!NEURO_LAB_VALUE_KEYS.has(f.key)) continue;
        const next = f.surgeryValue ?? '';
        if (String(formDataRef.current[f.key] ?? '') !== String(next)) {
          updateField(f.key, next);
        }
      }
    },
    [updateField],
  );

  // Seed the panel's tick-boxes and value boxes from results already on record,
  // so reopening a saved panel does not present empty boxes. Recomputed only when
  // hydration settles — deliberately NOT on formData, or every keystroke would
  // hand the panel a fresh seed and reset the box being typed into.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const labPrefill = useMemo(
    () =>
      Object.fromEntries(
        [...NEURO_LAB_VALUE_KEYS]
          .filter((k) => !isEmptyVal(formData[k]))
          .map((k) => [k, formData[k]]),
      ),
    [loading, recordId],
  );

  // Every saved panel, date-wise (newest first) — the investigation date when one
  // was entered, otherwise when it was saved.
  const entries = [...(baselineSessions || [])]
    .sort((a, b) => sessionTime(b, 'baselineDate') - sessionTime(a, 'baselineDate'))
    .map((session) => {
      const data = session.data || {};
      const savedLabel = formatSavedAt(session.saved_at);
      const bp = data.bpSys && data.bpDia ? `BP ${data.bpSys}/${data.bpDia}` : '';
      const metaBits = [
        data.baselineRequestedBy,
        bp,
        data.weight && `${data.weight} kg`,
        data.bmi && `BMI ${data.bmi}`,
        savedLabel && `saved ${savedLabel}`,
      ].filter(Boolean);
      return {
        id: session.id,
        dateLabel: data.baselineDate || savedLabel || '—',
        title: 'Baseline investigations',
        note: baselineSessionResult(data),
        badge: `Panel ${session.session_no}`,
        meta: metaBits.join(' · '),
        data,
        table: buildBaselineTable(data),
      };
    });

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
        Baseline Inv.
      </h2>
      <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: '0 0 20px' }}>
        Tab 3 of 9 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>baseline</span>
      </p>

      {/* ── History records — collapsible, default collapsed, date-wise. Detail
          renders as a Parameter/Value/Unit TABLE rather than the label/value
          grid the other sessions tabs use: a panel is a column of measurements,
          and a number is only readable next to its unit. ─────────────────────── */}
      <SessionHistory
        entries={entries}
        detail="table"
        countLabel={entries.length === 1 ? '1 panel' : `${entries.length} panels`}
      />

      <Section title="3.0 — Investigation Details">
        {/* A baseline panel is repeated on a monitoring schedule, so every save
            appends a new panel rather than overwriting the last. These two fields
            are what make the history above readable: when the investigations were
            done (not necessarily when they were entered) and who requested them. */}
        <FormField k="baselineDate" label="Date of Investigation" type="date" />
        <FormField k="baselineRequestedBy" label="Requested By" type="text" placeholder="e.g. Dr. Jane Doe" />
        <FormField label="Saving this tab records a NEW panel — the monitoring trend is kept, and every previous panel stays available as a table under History records above." type="note" />
      </Section>

      <Section title="3.1 — Vital Signs">
        <FormField k="bpSys" label="Blood Pressure (Systolic)" type="number" unit="mmHg" />
        <FormField k="bpDia" label="Blood Pressure (Diastolic)" type="number" unit="mmHg" />
        <FormField k="hr" label="Heart Rate" type="number" unit="bpm" />
        <FormField k="temp" label="Temperature" type="number" unit="°C" />
        <FormField k="rr" label="Respiratory Rate" type="number" unit="/min" />
        <FormField k="spo2" label="SpO₂" type="number" unit="%" />
        <FormField k="glucose" label="Blood Glucose (POC)" type="number" unit="mg/dL" />
      </Section>

      <Section title="3.2 — Physical & Metabolic Measurements">
        <FormField k="height" label="Height" type="number" unit="cm" />
        <FormField k="weight" label="Weight" type="number" unit="kg" />
        <FormField k="bsa" label="Body Surface Area" type="number" unit="m²" readOnly hint="√(H×W/3600)" />
        <FormField k="bmi" label="BMI" readOnly hint="W/H²" />
        <FormField k="waist" label="Waist Circumference" type="number" unit="cm" />
        <FormField label="Metabolic monitoring baseline is required before antipsychotic / mood-stabiliser initiation and during clozapine/olanzapine therapy." type="note" />
      </Section>

      <Section title="3.3 — Depression / Anxiety Scales (auto-scored)">
        <FormField label="PHQ-9 — Depression (last 2 weeks)" type="subhead" />
        <FormField k="phq1" label="1. Little interest or pleasure in doing things" type="radio" options={O.scale4} />
        <FormField k="phq2" label="2. Feeling down, depressed, or hopeless" type="radio" options={O.scale4} />
        <FormField k="phq3" label="3. Trouble falling/staying asleep, or sleeping too much" type="radio" options={O.scale4} />
        <FormField k="phq4" label="4. Feeling tired or having little energy" type="radio" options={O.scale4} />
        <FormField k="phq5" label="5. Poor appetite or overeating" type="radio" options={O.scale4} />
        <FormField k="phq6" label="6. Feeling bad about yourself / failure" type="radio" options={O.scale4} />
        <FormField k="phq7" label="7. Trouble concentrating" type="radio" options={O.scale4} />
        <FormField k="phq8" label="8. Moving/speaking slowly or being fidgety/restless" type="radio" options={O.scale4} />
        <FormField k="phq9" label="9. Thoughts of being better off dead or self-harm" type="radio" options={O.scale4} />
        <FormField k="phqTotal" label="PHQ-9 Total" type="number" readOnly hint="0–27" />
        <FormField k="phqSeverity" label="PHQ-9 Severity" readOnly hint="auto-derived" />

        <FormField label="GAD-7 — Anxiety (last 2 weeks)" type="subhead" />
        <FormField k="gad1" label="1. Feeling nervous, anxious, or on edge" type="radio" options={O.scale4} />
        <FormField k="gad2" label="2. Not being able to stop or control worrying" type="radio" options={O.scale4} />
        <FormField k="gad3" label="3. Worrying too much about different things" type="radio" options={O.scale4} />
        <FormField k="gad4" label="4. Trouble relaxing" type="radio" options={O.scale4} />
        <FormField k="gad5" label="5. Being so restless it is hard to sit still" type="radio" options={O.scale4} />
        <FormField k="gad6" label="6. Becoming easily annoyed or irritable" type="radio" options={O.scale4} />
        <FormField k="gad7" label="7. Feeling afraid as if something awful might happen" type="radio" options={O.scale4} />
        <FormField k="gadTotal" label="GAD-7 Total" type="number" readOnly hint="0–21" />
        <FormField k="gadSeverity" label="GAD-7 Severity" readOnly hint="auto-derived" />
      </Section>

      <Section title="3.4 — Clinician-Rated Scales (enter totals)">
        <FormField k="hamd" label="HAM-D (Hamilton Depression, 0–52)" type="number" max={52} />
        <FormField k="madrs" label="MADRS (Montgomery-Åsberg, 0–60)" type="number" max={60} />
        <FormField k="hama" label="HAM-A (Hamilton Anxiety, 0–56)" type="number" max={56} />
        <FormField k="ymrs" label="YMRS (Young Mania, 0–60)" type="number" max={60} />
        <FormField k="panssP" label="PANSS — Positive (7–49)" type="number" />
        <FormField k="panssN" label="PANSS — Negative (7–49)" type="number" />
        <FormField k="panssG" label="PANSS — General (16–112)" type="number" />
        <FormField k="yboc" label="Y-BOCS (OCD, 0–40)" type="number" max={40} />
        <FormField k="pcl5" label="PCL-5 (PTSD, 0–80)" type="number" max={80} />
        <FormField k="cgiS" label="CGI-Severity (1–7)" type="number" max={7} />
        <FormField k="cgiI" label="CGI-Improvement (1–7)" type="number" max={7} />
        <FormField k="gaf" label="GAF Score (0–100)" type="number" max={100} />
      </Section>

      <Section title="3.5 — Laboratory Investigations">
        {/* The shared investigations panel, in place of the 19 hand-typed number
            fields that used to be here. It can actually ORDER a test, attach the
            report and show pending vs completed — the old fields could only
            record a value.

            It is the same component oncology uses; `department` picks the field
            set (see fieldSetFor in LabInvestigations.jsx), which is why the
            oncology screen is untouched by this.

            The `noDictate` guarantee those fields carried is now STRUCTURAL and
            stronger: they are no longer FormFields at all, so registerField never
            sees them and the extraction model is never told they exist. A lab
            value is transcribed digit by digit off a report, and a misheard
            decimal is a clinical error, not a typo — "lithium nought point eight"
            landing as 8 reads as toxic. */}
        <div style={{ gridColumn: '1 / -1' }}>
          <LabInvestigations
            department={NEURO_DEPARTMENT}
            patientId={patientId}
            doctorId={doctorId}
            hospitalId={hospitalId}
            orderContext={BASELINE_ORDER_CONTEXT}
            prefill={labPrefill}
            onChange={handleLabChange}
          />
        </div>

        {/* Results for the three organic-workup panels, which are orderable above
            but report as prose ("Aβ42 420, total tau 610, p-tau 78") and will not
            fit the panel's value box. noDictate for the same reason as the labs. */}
        <FormField label="Dementia / Organic Workup — Findings" type="subhead" />
        <FormField k="csfBiomarkers" label="CSF Biomarkers (Aβ42, tau, p-tau) — if performed" type="textarea" full noDictate />
        <FormField k="autoimmunePanel" label="Autoimmune Encephalitis Panel (NMDAR/LGI1/CASPR2)" type="textarea" full noDictate />
        <FormField k="toxicology" label="Urine Drug Screen / Toxicology" type="textarea" full noDictate />
        <FormField k="labOther" label="Other Lab Values / Notes" type="textarea" full noDictate />
      </Section>
    </div>
  );
};

export default BaselineDataTab;
