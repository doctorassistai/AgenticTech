import React from 'react';
import Section from '../../components/Section';
import FormField from '../../components/FormField';

const DBSIPGReplacementForm = () => {
  return (
    <div style={{ marginTop: '12px', gridColumn: '1 / -1', width: '100%' }}>
      <Section title="Explanted IPG Hardware & Indication">
        <FormField k="dbsExplantedModel" label="Explanted IPG Model & Manufacturer" type="text" />
        <FormField k="dbsExplantedSerial" label="Explanted IPG Serial Number" type="text" />
        <FormField k="dbsReplacementReason" label="Reason for IPG Replacement" type="select" options={['Normal Battery Depletion (ERI/EOL)', 'Hardware Malfunction', 'Infection / Erosion', 'Device Upgrade (Rechargeable)', 'Other']} />
      </Section>

      <Section title="Surgical Pocket & Lead Extension Assessment">
        <FormField k="dbsPocketSite" label="IPG Pocket Location" type="select" options={['Subclavicular (Right)', 'Subclavicular (Left)', 'Abdominal Wall', 'Other']} />
        <FormField k="dbsPocketRevision" label="Pocket Revision Performed" type="radio" options={['Yes', 'No']} />
        <FormField k="dbsPocketIrrigation" label="Pocket Washout Solution" type="text" placeholder="e.g. Bacitracin / Antibiotic irrigation" />
        <FormField k="dbsExtensionIntegrity" label="Lead Extension Integrity Check" type="select" options={['Intact — reconnected', 'Replaced right extension', 'Replaced left extension', 'Replaced both extensions']} />
      </Section>

      <Section title="New IPG Hardware & System Diagnostics">
        <FormField k="dbsNewIpgModel" label="New IPG Model & Manufacturer" type="text" />
        <FormField k="dbsNewIpgSerial" label="New IPG Serial Number" type="text" />
        <FormField k="dbsTelemetryCheck" label="Intra-op Telemetry Communication" type="radio" options={['Pass', 'Fail']} />
        <FormField k="dbsPostImpedanceCheck" label="Post-Connection Impedance Check" type="textarea" full placeholder="Verify impedance across all channels (0-3 Right, 4-7 Left) within normal range (500 - 1500 Ohms)" />
        <FormField k="dbsInitialSettings" label="Initial Output Status" type="select" options={['Therapy OFF (Pending programming clinic)', 'Therapy ON (Restored prior settings)']} />
      </Section>
    </div>
  );
};

export default DBSIPGReplacementForm;
