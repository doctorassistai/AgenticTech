import React, { useEffect, useRef } from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';
import { aggregateSummaryData } from '../utils/findingsAggregator';
import { downloadSummaryReport } from '../utils/reportGenerator';

const SummaryTab = () => {
  const {
    formData,
    setFormData,
    procedures,
    psychotherapySessions,
    mseSessions,
    baselineSessions,
  } = useNeuropsychiatry();

  const hasAggregated = useRef(false);

  // Seamless on-load auto-fill: populate blank derived summary fields on mount
  useEffect(() => {
    if (hasAggregated.current) return;
    const updates = aggregateSummaryData(
      formData,
      procedures,
      psychotherapySessions,
      mseSessions,
      baselineSessions
    );
    if (Object.keys(updates).length > 0) {
      setFormData((prev) => {
        const next = { ...prev };
        let changed = false;
        const appliedFields = [];
        for (const [k, v] of Object.entries(updates)) {
          if ((next[k] === undefined || next[k] === '' || next[k] === null) && v) {
            next[k] = v;
            appliedFields.push(k);
            changed = true;
          }
        }
        if (changed) {
          console.log('[SummaryTab] Auto-populated blank fields:', appliedFields);
        }
        return changed ? next : prev;
      });
    }
    hasAggregated.current = true;
  }, [formData, setFormData, procedures, psychotherapySessions, mseSessions, baselineSessions]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
            Summary
          </h2>
          <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: 0 }}>
            Tab 8 of 8 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>summary</span>
          </p>
        </div>
        <button
          type="button"
          onClick={() => downloadSummaryReport(formData)}
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

      <Section title="Summary & Sign-off">
        <FormField k="sClinical" label="Clinical Summary" type="textarea" full llm />
        <FormField k="sProcedures" label="Procedures / Treatments Performed" type="textarea" full readOnly placeholder="auto-aggregated from procedure/surgery/emergency tabs" />
        <FormField k="sKeyFindings" label="Key Findings" type="textarea" full readOnly placeholder="auto-aggregated from findings tab" />
        <FormField k="sPrimaryDx" label="Primary Diagnosis (DSM-5-TR / ICD-11)" type="textarea" full />
        <FormField
          k="sSecondaryDx"
          label="Secondary Diagnoses"
          type="array"
          full
          tableMode
          addLabel="+ Add Diagnosis"
          cols={1}
          subFields={[{ k: 'dx', l: 'Diagnosis', t: 'text' }]}
        />
        <FormField
          k="sCodes"
          label="Diagnostic Codes"
          type="array"
          full
          tableMode
          addLabel="+ Add Code"
          cols={2}
          subFields={[
            { k: 'code', l: 'Code', t: 'text' },
            { k: 'desc', l: 'Description', t: 'text' },
          ]}
        />
        <FormField
          k="sDischargeMeds"
          label="Medications at Discharge"
          type="array"
          full
          tableMode
          addLabel="+ Add Medication"
          cols={3}
          subFields={[
            { k: 'drug', l: 'Drug', t: 'text' },
            { k: 'dose', l: 'Dose', t: 'text' },
            { k: 'freq', l: 'Frequency', t: 'select', o: O.freq },
            { k: 'route', l: 'Route', t: 'select', o: O.route },
            { k: 'duration', l: 'Duration', t: 'text' },
            { k: 'status', l: 'Status', t: 'select', o: ['New', 'Continued', 'Modified', 'Stopped'] },
          ]}
        />
        <FormField
          k="sFollowup"
          label="Follow-up Appointments"
          type="array"
          full
          tableMode
          addLabel="+ Add Appointment"
          cols={3}
          subFields={[
            { k: 'date', l: 'Date', t: 'date' },
            { k: 'dept', l: 'Department/Clinician', t: 'text' },
            { k: 'purpose', l: 'Purpose', t: 'text' },
          ]}
        />
        <FormField k="sPrognosis" label="Prognosis Discussed with Patient/Family" type="radio" options={O.yesno} />

        <FormField label="Staff Sign-off" type="subhead" />
        <FormField k="sConsultant" label="Consultant Psychiatrist" readOnly />
        <FormField k="sConsultantSign" label="Consultant sign-off" type="checks" options={['Consultant sign-off']} />
      </Section>
    </div>
  );
};

export default SummaryTab;
