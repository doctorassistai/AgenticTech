import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const AmytalForm = () => {
  return (
    <>
      <FormField label="P8 — Amytal / Narcoanalysis Interview" type="subhead" />
      <FormField k="amyIndication" label="Indication" type="select" options={['Catatonia (diagnostic/therapeutic)', 'Suspected conversion/functional disorder', 'Dissociative disorder / amnesia', 'Mutism of unclear origin', 'Differentiating organic vs functional', 'Abreaction']} />
      <FormField k="amyAgent" label="Agent" type="select" options={['Sodium amobarbital (Amytal)', 'Lorazepam (challenge)', 'Diazepam', 'Midazolam']} />
      <FormField k="amyDose" label="Total Dose Administered" type="number" unit="mg" />
      <FormField k="amyRate" label="Infusion Rate" type="number" unit="mg/min" hint="amobarbital ~50 mg/min" />
      <FormField k="amyMonitoring" label="Monitoring" type="checks" full options={['BP', 'HR', 'SpO₂', 'Respiratory rate', 'Resuscitation equipment available', 'IV access']} />

      <FormField label="Response" type="subhead" />
      <FormField k="amyResponse" label="Response to Interview" type="select" options={['Symptom resolution (functional favoured)', 'Partial improvement', 'No change (organic favoured)', 'Emergence of new material', 'Adverse reaction']} />
      <FormField k="amyContent" label="Interview Content / Findings" type="textarea" full />
      <FormField k="amyAdverse" label="Adverse Effects" type="checks" full options={['None', 'Over-sedation', 'Respiratory depression', 'Hypotension', 'Slurred speech (expected)', 'Paradoxical agitation', 'Laryngospasm']} />
      <FormField k="amyRecovery" label="Recovery Time" type="number" unit="min" />
      <FormField k="amyNotes" label="Narcoanalysis Notes" type="textarea" full />
    </>
  );
};

export default AmytalForm;
