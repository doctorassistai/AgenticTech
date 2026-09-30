import React, { useEffect, useRef } from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';
import { aggregateFindingsData } from '../utils/findingsAggregator';

const FindingsTab = () => {
  const {
    formData,
    setFormData,
    procedures,
    psychotherapySessions,
    mseSessions,
    baselineSessions,
  } = useNeuropsychiatry();

  const hasAggregated = useRef(false);

  // Seamless on-load auto-fill: check and populate blank fields with derived findings on mount
  useEffect(() => {
    if (hasAggregated.current) return;
    const updates = aggregateFindingsData(
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
          console.log('[FindingsTab] Auto-populated blank fields:', appliedFields);
        }
        return changed ? next : prev;
      });
    }
    hasAggregated.current = true;
  }, [formData, setFormData, procedures, psychotherapySessions, mseSessions, baselineSessions]);

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
        Findings
      </h2>
      <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: '0 0 20px' }}>
        Tab 6 of 8 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>findings</span>
      </p>

      <Section title="Findings & Results">
        <FormField k="fProcedure" label="Procedure / Treatment Performed" readOnly hint="auto-populated" />
        <FormField k="fCBTObs" label="Psychotherapy & CBT Observations" type="textarea" full placeholder="auto-populated from Psychotherapy & CBT Log" />
        <FormField k="fScalesSummary" label="Rating Scale Results Summary" type="textarea" full placeholder="auto-aggregated from Baseline / MSE" />
        <FormField k="fImaging" label="Neuroimaging Results Summary" type="textarea" full />
        <FormField k="fLabs" label="Laboratory Results" type="textarea" full />
        <FormField k="fFinalDx" label="Final Diagnosis (DSM-5-TR / ICD-11)" type="textarea" full />
        <FormField k="fICD" label="ICD-11 / DSM Code" />
        <FormField
          k="fDDx"
          label="Differential Diagnoses"
          type="array"
          full
          tableMode
          addLabel="+ Add Differential"
          cols={1}
          subFields={[{ k: 'dx', l: 'Diagnosis', t: 'text' }]}
        />
        <FormField k="fRecommend" label="Recommendations" type="textarea" full />
        <FormField k="fMDT" label="MDT Discussion Required" type="radio" options={O.yesno} />
        <FormField k="fMDTDetail" label="MDT Date / Specialities" showIf={{ k: 'fMDT', in: ['Yes'] }} />
      </Section>
    </div>
  );
};

export default FindingsTab;
