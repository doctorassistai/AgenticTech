import React from 'react';
import FormField from '../../components/FormField';
import { O } from '../../context/NeuropsychiatryContext';

const DBSForm = () => {
  return (
    <>
      <FormField label="P5 — Deep Brain Stimulation (DBS) Programming" type="subhead" />
      <FormField k="dbsIndication" label="Indication" type="select" options={['Treatment-resistant depression', 'Obsessive-Compulsive Disorder', 'Tourette Syndrome', 'Refractory anorexia (investigational)']} />
      <FormField k="dbsTarget" label="Anatomical Target" type="select" options={['Subcallosal cingulate (SCG/Cg25)', 'Ventral capsule/ventral striatum (VC/VS)', 'Anterior limb of internal capsule (ALIC)', 'Nucleus accumbens (NAcc)', 'Subthalamic nucleus (STN)', 'Inferior thalamic peduncle', 'Medial forebrain bundle']} />
      <FormField k="dbsDevice" label="IPG / Device Model" placeholder="e.g., Medtronic Percept, Boston Vercise" />
      <FormField k="dbsSessionType" label="Session Type" type="select" options={['Initial programming', 'Re-programming / optimization', 'Troubleshooting', 'Battery/IPG check']} />

      <FormField label="Stimulation Settings — Per Hemisphere" type="subhead" />
      <FormField
        k="dbsSettings"
        label="Contact Settings"
        type="array"
        full
        addLabel="+ Add Lead / Hemisphere"
        cols={3}
        subFields={[
          { k: 'side', l: 'Side', t: 'select', o: O.side },
          { k: 'contacts', l: 'Active Contacts', t: 'text', ph: 'e.g., C+ 2−' },
          { k: 'mode', l: 'Mode', t: 'select', o: ['Monopolar', 'Bipolar'] },
          { k: 'amplitude', l: 'Amplitude', t: 'number', ph: 'V or mA' },
          { k: 'pulseWidth', l: 'Pulse Width (µs)', t: 'number' },
          { k: 'frequency', l: 'Frequency (Hz)', t: 'number' },
          { k: 'impedance', l: 'Impedance (Ω)', t: 'number' },
        ]}
      />

      <FormField label="Monopolar Review / Thresholds" type="subhead" />
      <FormField k="dbsThresholds" label="Therapeutic Window / Side-effect Thresholds" type="textarea" full placeholder="per contact: benefit threshold vs side-effect threshold" />
      <FormField k="dbsStimSideEffects" label="Stimulation-induced Effects" type="checks" full options={['None', 'Hypomania/elevated mood', 'Anxiety', 'Autonomic (flushing/nausea)', 'Paresthesia', 'Dysarthria', 'Ocular deviation', 'Muscle contraction', 'Mood worsening']} />

      <FormField label="Response & Tracking" type="subhead" />
      <FormField k="dbsResponse" label="Clinical Response to Date" type="select" options={O.outcome} />
      <FormField k="dbsBattery" label="Battery Voltage / Status" type="number" unit="V" />
      <FormField k="dbsNextVisit" label="Next Programming Visit" type="date" />
      <FormField k="dbsNotes" label="DBS Programming Notes" type="textarea" full />
    </>
  );
};

export default DBSForm;
