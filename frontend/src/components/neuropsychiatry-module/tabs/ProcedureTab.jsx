import React, { lazy, Suspense } from 'react';
import Section from '../components/Section';
import FormField from '../components/FormField';
import { useNeuropsychiatry, O, PROC_CATEGORIES } from '../context/NeuropsychiatryContext';

// Lazy load procedure components for maximum performance & modularity
const ECTForm = lazy(() => import('./procedures/ECTForm'));
const RTMSForm = lazy(() => import('./procedures/RTMSForm'));
const TDCSForm = lazy(() => import('./procedures/TDCSForm'));
const MSTForm = lazy(() => import('./procedures/MSTForm'));

const DBSForm = lazy(() => import('./procedures/DBSForm'));
const VNSForm = lazy(() => import('./procedures/VNSForm'));

const KetamineForm = lazy(() => import('./procedures/KetamineForm'));
const AmytalForm = lazy(() => import('./procedures/AmytalForm'));

const EEGForm = lazy(() => import('./procedures/EEGForm'));
const LumbarPunctureForm = lazy(() => import('./procedures/LumbarPunctureForm'));
const PolysomnographyForm = lazy(() => import('./procedures/PolysomnographyForm'));
const NeuropsychBatteryForm = lazy(() => import('./procedures/NeuropsychBatteryForm'));

const renderProcedureForm = (activeProcType) => {
  switch (activeProcType) {
    // Neuromodulation - Non-invasive
    case 'Electroconvulsive Therapy (ECT)': return <ECTForm />;
    case 'Repetitive TMS (rTMS)': return <RTMSForm />;
    case 'Transcranial Direct Current Stimulation (tDCS)': return <TDCSForm />;
    case 'Magnetic Seizure Therapy (MST)': return <MSTForm />;

    // Neuromodulation - Device Programming
    case 'Deep Brain Stimulation (DBS) Programming': return <DBSForm />;
    case 'Vagus Nerve Stimulation (VNS) Programming': return <VNSForm />;

    // Pharmacological / Infusion
    case 'Ketamine / Esketamine Therapy': return <KetamineForm />;
    case 'Amytal (Narcoanalysis) Interview': return <AmytalForm />;

    // Diagnostic
    case 'Electroencephalography (EEG)': return <EEGForm />;
    case 'Lumbar Puncture (CSF Biomarkers)': return <LumbarPunctureForm />;
    case 'Polysomnography (Sleep Study)': return <PolysomnographyForm />;
    case 'Neuropsychological Assessment Battery': return <NeuropsychBatteryForm />;

    default:
      return (
        <FormField
          label={`Procedure-specific subform for "${activeProcType}" is not defined or has no specific fields.`}
          type="note"
        />
      );
  }
};

const ProcedureTab = () => {
  const { formData } = useNeuropsychiatry();
  const cat = formData.procCategory;
  const procTypeOptions = cat && PROC_CATEGORIES[cat] ? PROC_CATEGORIES[cat] : ['— select category first —'];
  const activeProcType = formData.procType;

  return (
    <div>
      <h2 style={{ fontSize: '16px', fontWeight: 600, color: '#1a1a1a', margin: '0 0 3px' }}>
        Procedure
      </h2>
      <p style={{ color: '#7a7a7a', fontSize: '11.5px', margin: '0 0 20px' }}>
        Procedural Workflow · <span style={{ fontSize: '10.5px', padding: '2px 9px', borderRadius: '3px', background: '#e8e8e8', color: '#4a4a4a' }}>procedure</span>
      </p>

      <Section title="Common Procedure Fields">
        <FormField k="procCategory" label="Procedure Category" type="select" options={Object.keys(PROC_CATEGORIES)} />
        <FormField k="procType" label="Procedure Type" type="select" options={procTypeOptions} />
        <FormField k="procDate" label="Date of Procedure" type="date" />
        <FormField k="procStart" label="Time — Start" type="time" />
        <FormField k="procEnd" label="Time — End" type="time" />
        <FormField k="procDuration" label="Duration" readOnly hint="End − Start" />
        <FormField k="procIndication" label="Indication / Clinical Reason" type="textarea" full />
        <FormField k="procDiagnosis" label="Working Diagnosis (DSM-5-TR / ICD-11)" type="textarea" full />
        <FormField k="consent" label="Informed Consent Obtained" type="radio" options={O.yesno} />
        <FormField k="consentType" label="Consent Type" type="select" options={['Patient (capacity intact)', 'Substitute decision-maker / next of kin', 'Involuntary - MHA + second opinion (SOAD)', 'Emergency (best interest)']} showIf={{ k: 'consent', in: ['Yes'] }} />
        <FormField k="capacityAssessed" label="Capacity Assessed & Documented" type="radio" options={O.yesno} />
        <FormField k="consentDate" label="Consent Date" type="date" showIf={{ k: 'consent', in: ['Yes'] }} />
        <FormField k="consentFile" label="Consent File Upload" type="file" showIf={{ k: 'consent', in: ['Yes'] }} />
        <FormField k="riskBenefit" label="Risk/Benefit Discussion Documented" type="radio" options={O.yesno} />
        <FormField k="anaesType" label="Anaesthesia / Sedation Type" type="select" options={['None', 'Local anaesthesia', 'Conscious sedation', 'General anaesthesia', 'N/A']} />
        <FormField k="operator" label="Performing Clinician / Operator" readOnly />
        <FormField
          k="assistStaff"
          label="Assisting Staff"
          type="array"
          full
          addLabel="+ Add Staff"
          cols={2}
          subFields={[
            { k: 'name', l: 'Name', t: 'text' },
            { k: 'role', l: 'Role', t: 'select', o: ['Resident', 'Nurse', 'Technician', 'Anaesthetist', 'Psychologist'] },
          ]}
        />
        <FormField k="preChecklist" label="Pre-procedure Safety Checklist" type="checks" full options={['Identity verified', 'Consent signed', 'Capacity documented', 'NPO/Fasting verified', 'Safety screening complete', 'Vitals baseline checked', 'IV access secured', 'Time-out completed']} />
      </Section>

      <Section title="Procedure-Specific Fields">
        {!activeProcType && (
          <FormField label="Select a Procedure Category then Procedure Type above to load its complete field set. All 12 procedure types (ECT, rTMS, tDCS, MST, DBS, VNS, Ketamine/Esketamine, Amytal, EEG, CSF LP, Polysomnography, Neuropsychological Battery) render their full sub-forms here." type="note" />
        )}

        {activeProcType && (
          <div style={{ gridColumn: '1 / -1', width: '100%' }}>
            <Suspense fallback={<div style={{ padding: '20px', color: '#666' }}>Loading procedure form...</div>}>
              {renderProcedureForm(activeProcType)}
            </Suspense>
          </div>
        )}
      </Section>
    </div>
  );
};

export default ProcedureTab;
