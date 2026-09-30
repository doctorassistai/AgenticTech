import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const VNSForm = () => {
  return (
    <>
      <FormField label="P6 — Vagus Nerve Stimulation (VNS) Programming" type="subhead" />
      <FormField k="vnsIndication" label="Indication" type="select" options={['Treatment-resistant depression', 'Refractory epilepsy with mood component']} />
      <FormField k="vnsDevice" label="Device Model" placeholder="e.g., LivaNova SenTiva" />
      <FormField k="vnsSessionType" label="Session Type" type="select" options={['Initial activation', 'Dose escalation', 'Optimization', 'Troubleshooting', 'Battery check']} />

      <FormField label="Output Parameters" type="subhead" />
      <FormField k="vnsOutputCurrent" label="Output Current" type="number" unit="mA" />
      <FormField k="vnsFrequency" label="Signal Frequency" type="number" unit="Hz" />
      <FormField k="vnsPulseWidth" label="Pulse Width" type="number" unit="µs" />
      <FormField k="vnsOnTime" label="ON Time" type="number" unit="s" />
      <FormField k="vnsOffTime" label="OFF Time" type="number" unit="min" />
      <FormField k="vnsDutyCycle" label="Duty Cycle" type="number" unit="%" />

      <FormField label="Magnet & Additional Modes" type="subhead" />
      <FormField k="vnsMagnetCurrent" label="Magnet Current" type="number" unit="mA" />
      <FormField k="vnsMagnetPulseWidth" label="Magnet Pulse Width" type="number" unit="µs" />
      <FormField k="vnsMagnetOnTime" label="Magnet ON Time" type="number" unit="s" />

      <FormField label="Tolerability & Tracking" type="subhead" />
      <FormField k="vnsSideEffects" label="Side Effects" type="checks" full options={['None', 'Voice alteration/hoarseness', 'Cough', 'Dyspnea', 'Neck pain', 'Dysphagia', 'Paresthesia', 'Headache']} />
      <FormField k="vnsBattery" label="Battery Status / EOS" placeholder="OK / near EOS" />
      <FormField k="vnsResponse" label="Clinical Response to Date" type="select" options={O.outcome} />
      <FormField k="vnsNextVisit" label="Next Visit" type="date" />
      <FormField k="vnsNotes" label="VNS Programming Notes" type="textarea" full />
    </>
  );
};

export default VNSForm;
