import React from 'react';
import Section from '../../components/Section';
import FormField from '../../components/FormField';

const VNSImplantationForm = () => {
  return (
    <div style={{ marginTop: '12px', gridColumn: '1 / -1', width: '100%' }}>
      <Section title="AAN Selection & Pre-op Safety Criteria">
        <FormField k="vnsIndication" label="Primary Surgical Indication" type="select" options={['Treatment-Resistant Depression (TRD)', 'Drug-Resistant Epilepsy (DRE)', 'Combined Depression & Epilepsy']} />
        <FormField k="vnsAanRefractoriness" label="AAN Refractoriness Criteria (>=4 Antidepressant Trials)" type="radio" options={['Met', 'Not Met']} />
        <FormField k="vnsCardiacAssessment" label="Pre-op Cardiac / ECG Screening" type="radio" options={['Normal ECG', 'Abnormal — Cleared by Cardiology', 'Not Done']} />
      </Section>

      <Section title="Vagus Nerve Dissection & Lead Placement">
        <FormField k="vnsSurgicalSide" label="Target Nerve Anatomy" type="select" options={['Left Vagus Nerve (Standard)', 'Right Vagus Nerve (Special Case)']} />
        <FormField k="vnsNerveAppearance" label="Vagus Nerve Identification & Quality" type="select" options={['Normal calibre & position', 'Thin / Small diameter', 'Scarred / Prior surgery', 'Anatomic variant']} />
        <FormField k="vnsLeadCoilSize" label="VNS Helical Lead Coil Size" type="select" options={['2.0 mm Inner Diameter', '3.0 mm Inner Diameter']} />
        <FormField k="vnsStrainRelief" label="Strain Relief Loop Secured" type="radio" options={['Yes', 'No']} />
        <FormField k="vnsTieDowns" label="Tie-Down Cleats Placement" type="text" placeholder="e.g. 2 silicone cleats anchored to fascia" />
      </Section>

      <Section title="Generator Details & Intraoperative Diagnostics">
        <FormField k="vnsGeneratorModel" label="VNS Pulse Generator Model" type="text" placeholder="e.g. LivaNova SenTiva / Symphony" />
        <FormField k="vnsGeneratorSerial" label="Generator Serial Number" type="text" />
        <FormField k="vnsLeadSerial" label="Lead Model & Serial Number" type="text" />
        
        <FormField label="AAN Intraoperative Safety Diagnostics" type="subhead" />
        <FormField k="vnsIntraopImpedance" label="System Diagnostics Test Result" type="select" options={['Pass (OK)', 'High Impedance (Open circuit)', 'Low Impedance (Short circuit)']} />
        <FormField k="vnsImpedanceValue" label="Measured Impedance (Ohms)" type="number" unit="Ohms" />
        <FormField k="vnsEcgMonitoring" label="Continuous ECG Check During Test Stim" type="radio" options={['Pass — Normal sinus rhythm', 'Bradycardia observed', 'Asystole observed (Stimulation aborted)']} />
        <FormField k="vnsInitialOutput" label="Initial Output Current (mA)" type="number" unit="mA" placeholder="Typically 0.25 mA" />
      </Section>
    </div>
  );
};

export default VNSImplantationForm;
