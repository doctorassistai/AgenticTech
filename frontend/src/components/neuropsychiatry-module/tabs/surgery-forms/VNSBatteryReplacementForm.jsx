import React from 'react';
import Section from '../../components/Section';
import FormField from '../../components/FormField';

const VNSBatteryReplacementForm = () => {
  return (
    <div style={{ marginTop: '12px', gridColumn: '1 / -1', width: '100%' }}>
      <Section title="Explanted VNS Generator Details">
        <FormField k="vnsExplantedModel" label="Explanted Generator Model" type="text" />
        <FormField k="vnsExplantedSerial" label="Explanted Generator Serial Number" type="text" />
        <FormField k="vnsReplacementIndication" label="Reason for Replacement" type="select" options={['End of Service (EOS / ERI)', 'Device Malfunction', 'Infection / Erosion', 'Elective Upgrade']} />
      </Section>

      <Section title="New Generator & System Diagnostics">
        <FormField k="vnsNewGeneratorModel" label="New VNS Generator Model" type="text" />
        <FormField k="vnsNewGeneratorSerial" label="New Generator Serial Number" type="text" />
        <FormField k="vnsPocketCondition" label="Infraclavicular Pocket Condition" type="select" options={['Clean / Normal capsule', 'Capsular thickening / Fibrosis', 'Signs of inflammation / Infection']} />
        <FormField k="vnsPinConnection" label="Lead Pin Connection & Torque Screw" type="radio" options={['Secured & Checked with Torque Wrench', 'Problem encountered']} />
        <FormField k="vnsDiagCheck" label="Intraoperative Telemetry & Diagnostic Check" type="select" options={['Pass (Impedance OK)', 'High Impedance Warning', 'Low Impedance Warning']} />
        <FormField k="vnsPostOpSettings" label="Output Current Setting Post-op" type="select" options={['0.25 mA (Standard initial restart)', '0.00 mA (Off until recovery)', 'Preserved previous setting']} />
      </Section>
    </div>
  );
};

export default VNSBatteryReplacementForm;
