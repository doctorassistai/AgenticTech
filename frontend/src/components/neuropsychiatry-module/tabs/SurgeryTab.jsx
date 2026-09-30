import React from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O } from '../context/NeuropsychiatryContext';

import DBSElectrodeImplantationForm from './surgery-forms/DBSElectrodeImplantationForm';
import DBSIPGReplacementForm from './surgery-forms/DBSIPGReplacementForm';
import VNSImplantationForm from './surgery-forms/VNSImplantationForm';
import VNSBatteryReplacementForm from './surgery-forms/VNSBatteryReplacementForm';
import AnteriorCingulotomyForm from './surgery-forms/AnteriorCingulotomyForm';
import AnteriorCapsulotomyForm from './surgery-forms/AnteriorCapsulotomyForm';
import SubcaudateTractotomyForm from './surgery-forms/SubcaudateTractotomyForm';
import LimbicLeucotomyForm from './surgery-forms/LimbicLeucotomyForm';

const renderProcedureSpecificForm = (surgCategory) => {
  switch (surgCategory) {
    case 'DBS Electrode Implantation':
      return <DBSElectrodeImplantationForm />;
    case 'DBS IPG (Battery) Replacement':
      return <DBSIPGReplacementForm />;
    case 'VNS Implantation':
      return <VNSImplantationForm />;
    case 'VNS Battery Replacement':
      return <VNSBatteryReplacementForm />;
    case 'Anterior Cingulotomy':
      return <AnteriorCingulotomyForm />;
    case 'Anterior Capsulotomy':
      return <AnteriorCapsulotomyForm />;
    case 'Subcaudate Tractotomy':
      return <SubcaudateTractotomyForm />;
    case 'Limbic Leucotomy':
      return <LimbicLeucotomyForm />;
    default:
      return null;
  }
};

const SurgeryTab = () => {
  const { formData } = useNeuropsychiatry();
  const surgCategory = formData?.surgCategory;

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
        Neurosurgical / Implant
      </h2>
      <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: '0 0 20px' }}>
        Tab 4 of 8 · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>surgery</span>
      </p>

      <Section title="Common Surgical Fields">
        <FormField k="surgCategory" label="Surgical Procedure" type="select" options={['DBS Electrode Implantation', 'DBS IPG (Battery) Replacement', 'VNS Implantation', 'VNS Battery Replacement', 'Anterior Cingulotomy', 'Anterior Capsulotomy', 'Subcaudate Tractotomy', 'Limbic Leucotomy']} />
        <FormField k="surgDate" label="Date of Surgery" type="date" />
        <FormField k="surgStart" label="Start Time" type="time" />
        <FormField k="surgEnd" label="End Time" type="time" />
        <FormField k="surgDuration" label="Total Duration" readOnly />
        <FormField k="surgUrgency" label="Urgency" type="select" options={['Elective', 'Urgent']} />
        <FormField k="surgAsa" label="ASA Physical Status" type="select" options={O.asa} />
        <FormField k="surgMDT" label="MDT / Ethics Committee Approval" type="radio" options={O.yesno} />
        <FormField k="surgTrialCriteria" label="Meets Established Refractoriness Criteria" type="radio" options={O.yesno} />

        <FormField label="WHO Surgical Safety Checklist" type="subhead" />
        <FormField k="whoSignIn" label="Sign In (Before Anaesthesia)" type="checks" full options={['Identity confirmed', 'Site marked', 'Consent signed', 'Anaesthesia safety check', 'Pulse oximeter on', 'Allergies reviewed', 'Difficult airway assessed']} />
        <FormField k="whoTimeOut" label="Time Out (Before Incision)" type="checks" full options={['Team introduced', 'Procedure confirmed', 'Antibiotic prophylaxis', 'Imaging displayed', 'Critical steps reviewed']} />
        <FormField k="whoSignOut" label="Sign Out (Before Leaving OR)" type="checks" full options={['Procedure recorded', 'Counts correct', 'Specimen labelled', 'Equipment issues noted']} />

        <FormField k="surgAnaes" label="Anaesthesia Type" type="select" options={['General — ETT', 'Awake (for MER/test stimulation)', 'Local + sedation', 'Combined']} />
        <FormField k="surgSurgeon" label="Operating Surgeon" readOnly />
        <FormField k="surgAnaesthetist" label="Anaesthetist" />

        <FormField label="Stereotaxy / Targeting" type="subhead" />
        <FormField k="surgFrame" label="Stereotactic Method" type="select" options={['Frame-based (Leksell/CRW)', 'Frameless (neuronavigation)', 'Robot-assisted', 'N/A']} />
        <FormField k="surgMER" label="Microelectrode Recording Used" type="radio" options={O.yesnoNA} />
        <FormField k="surgTestStim" label="Intraoperative Test Stimulation" type="radio" options={O.yesnoNA} />
        <FormField k="surgTarget" label="Target Coordinates / Structure" type="textarea" full />

        <FormField label="Device / Findings" type="subhead" />
        <FormField k="surgDevice" label="Device Implanted / Model" />
        <FormField k="surgFindings" label="Intraoperative Findings" type="textarea" full />
        <FormField k="surgComplications" label="Intraoperative Complications" type="checks" full options={['None', 'Haemorrhage', 'Lead misplacement', 'Seizure', 'Air embolism', 'Infection concern', 'Hardware malfunction', 'Confusion/delirium', 'Mood change']} />
        <FormField k="surgEBL" label="Estimated Blood Loss" type="number" unit="mL" />
        <FormField k="surgDisposition" label="Disposition from OR" type="select" options={['Neuro ICU', 'HDU', 'PACU → Ward', 'Ward']} />
        <FormField k="surgPostImaging" label="Post-op Imaging Ordered (lead localization)" type="radio" options={O.yesno} />
        <FormField k="surgPostOrders" label="Post-op Orders" type="textarea" full />
      </Section>

      <Section title="Procedure-Specific Notes (AAN Standards Compliant)">
        {!surgCategory ? (
          <FormField label="Select a Surgical Procedure above to load its detailed AAN-compliant form (DBS, VNS, Cingulotomy, Capsulotomy, Tractotomy, Leucotomy)." type="note" />
        ) : (
          <div style={{ gridColumn: '1 / -1', width: '100%' }}>
            {renderProcedureSpecificForm(surgCategory)}
          </div>
        )}
        
        <FormField k="surgSpecificNotes" label="Additional Device-specific / Lesion Notes" type="textarea" full placeholder="Additional surgical observations, intra-op events, or special anatomical variations..." />
      </Section>
    </div>
  );
};

export default SurgeryTab;
