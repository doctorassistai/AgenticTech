import React from 'react';
import Section from '../../components/Section';
import FormField from '../../components/FormField';

const DBSElectrodeImplantationForm = () => {
  return (
    <div style={{ marginTop: '12px', gridColumn: '1 / -1', width: '100%' }}>
      <Section title="AAN Pre-Surgical & Selection Criteria">
        <FormField k="dbsMdtApproval" label="Multidisciplinary Team (MDT) Board Approval" type="radio" options={['Approved', 'Pending', 'Not Approved']} />
        <FormField k="dbsRefractoriness" label="Refractory Standard Met (AAN / Psychosurgery Guidelines)" type="radio" options={['Yes', 'No']} />
        <FormField k="dbsBaselineScale" label="Baseline Rating Scale Used" type="select" options={['Y-BOCS (OCD)', 'MADRS (Depression)', 'HAM-D (Depression)', 'UPDRS (Parkinsonism)', 'BFMRS (Dystonia)', 'Other']} />
        <FormField k="dbsBaselineScore" label="Baseline Severity Score" type="number" />
        <FormField k="dbsNeuropsychClearance" label="Pre-op Neuropsychological Evaluation Clearance" type="radio" options={['Cleared', 'Conditional Clearance', 'Not Cleared']} />
      </Section>

      <Section title="Stereotactic Targeting & Frame Coordinates">
        <FormField k="dbsTargetStructure" label="Target Structure" type="select" options={['Anterior Limb of Internal Capsule (ALIC)', 'Nucleus Accumbens (NAc)', 'Subcallosal Cingulate (SCC / Cg25)', 'Ventral Capsule / Ventral Striatum (VC/VS)', 'Subthalamic Nucleus (STN)', 'Globus Pallidus Internus (GPi)', 'Vim (Thalamus)', 'Other']} />
        <FormField k="dbsFrameMethod" label="Stereotactic Apparatus" type="select" options={['Leksell Frame', 'CRW Frame', 'Frameless (Neuronavigation)', 'Robotic System (ROSA/Stealth)'] } />
        
        <FormField label="Right Target Coordinates (mm)" type="subhead" />
        <FormField k="dbsCoordRX" label="Right X (Lateral)" type="number" unit="mm" />
        <FormField k="dbsCoordRY" label="Right Y (Anterior-Posterior)" type="number" unit="mm" />
        <FormField k="dbsCoordRZ" label="Right Z (Vertical)" type="number" unit="mm" />
        <FormField k="dbsCoordRArc" label="Right Arc Angle" type="number" unit="°" />
        <FormField k="dbsCoordRRing" label="Right Ring Angle" type="number" unit="°" />

        <FormField label="Left Target Coordinates (mm)" type="subhead" />
        <FormField k="dbsCoordLX" label="Left X (Lateral)" type="number" unit="mm" />
        <FormField k="dbsCoordLY" label="Left Y (Anterior-Posterior)" type="number" unit="mm" />
        <FormField k="dbsCoordLZ" label="Left Z (Vertical)" type="number" unit="mm" />
        <FormField k="dbsCoordLArc" label="Left Arc Angle" type="number" unit="°" />
        <FormField k="dbsCoordLRing" label="Left Ring Angle" type="number" unit="°" />
      </Section>

      <Section title="Intraoperative Neurophysiologic Mapping (MER & Macrostimulation)">
        <FormField k="dbsMerPasses" label="Number of MER Passes (Per Side)" type="select" options={['1 Pass', '2 Passes', '3 Passes', '4+ Passes']} />
        <FormField k="dbsMerFindings" label="MER Trajectory & Firing Characteristics" type="textarea" full placeholder="Characteristic single-unit activity, background noise changes, cell depth boundaries..." />
        
        <FormField label="Macrostimulation Testing Thresholds" type="subhead" />
        <FormField k="dbsStimEfficacy" label="Clinical Efficacy Threshold (mA / V)" type="number" unit="mA" />
        <FormField k="dbsStimSideEffects" label="Side Effect Threshold (mA / V)" type="number" unit="mA" />
        <FormField k="dbsObservedAEs" label="Observed Intra-op Side Effects" type="checks" full options={['Paresthesias', 'Dysarthria / Speech arrest', 'Muscle twitching / Contraction', 'Diplopia / Ocular deviation', 'Acute Affective Shift (Anxiety/Euphoria)', 'Autonomic response (Tachycardia/Flushing)', 'None']} />
      </Section>

      <Section title="Implanted Hardware Details & Post-op Verification">
        <FormField k="dbsLeadModel" label="DBS Lead Model & Manufacturer" type="text" placeholder="e.g. Medtronic 3387 / Boston Scientific Cartesia" />
        <FormField k="dbsLeadSerial" label="Lead Serial Number(s)" type="text" />
        <FormField k="dbsFinalImpedances" label="Final Contact Impedances (Ohms)" type="textarea" full placeholder="Contact 0: ... Ohms, Contact 1: ... Ohms, Contact 2: ... Ohms, Contact 3: ... Ohms" />
        <FormField k="dbsVerificationImaging" label="Post-op Lead Localization Imaging" type="select" options={['Intra-op O-arm / CT', 'Post-op MRI (DBS Protocol)', 'Post-op CT fused to Pre-op MRI', 'Pending']} />
      </Section>
    </div>
  );
};

export default DBSElectrodeImplantationForm;
