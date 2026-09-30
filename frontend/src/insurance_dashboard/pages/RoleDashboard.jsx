import { useEffect, useState } from 'react';

// Placeholder landing page for the four spec roles added as auth scaffolding
// (State Team, Reporting Manager, QC Manager, Portal Team). The real workflow
// screens (case handoff, allocation, QC queue, portal download) land in a
// separate follow-up once the case data model + audit log exist.
const ROLE_INFO = {
  'state-team': {
    label: 'State Team',
    blurb: 'State-specific case review, Field Officer allocation, and document review will appear here.',
  },
  'reporting-manager': {
    label: 'Reporting Manager',
    blurb: 'Doctor allocation (workload / leave / capacity) and doctor case monitoring will appear here.',
  },
  'qc-manager': {
    label: 'QC Manager',
    blurb: 'The post-conclusion QC queue and quality review tools will appear here.',
  },
  'portal-team': {
    label: 'Portal Team',
    blurb: 'The portal-claim conclusion queue and download/completion workflow will appear here.',
  },
};

export default function RoleDashboard({ roleKey }) {
  const info = ROLE_INFO[roleKey] || { label: 'Dashboard', blurb: '' };
  const [name, setName] = useState('');

  useEffect(() => {
    const keyByRole = {
      'state-team': 'state_name',
      'reporting-manager': 'rm_name',
      'qc-manager': 'qc_name',
      'portal-team': 'portal_name',
    };
    setName(localStorage.getItem(keyByRole[roleKey]) || '');
  }, [roleKey]);

  return (
    <div style={{ maxWidth: 720 }}>
      <div style={{
        border: '1px solid #e0e0e0', borderRadius: 8, padding: '2rem', background: '#fff',
      }}>
        <div style={{ fontSize: '0.72rem', letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888' }}>
          {info.label} Portal
        </div>
        <h2 style={{ margin: '0.5rem 0 0.75rem', fontWeight: 300 }}>
          Welcome{name ? `, ${name}` : ''}
        </h2>
        <p style={{ color: '#555', lineHeight: 1.7 }}>{info.blurb}</p>
        <p style={{ color: '#999', fontSize: '0.85rem', marginTop: '1.5rem' }}>
          Workflow screens are coming soon — your account and access are set up.
        </p>
      </div>
    </div>
  );
}
