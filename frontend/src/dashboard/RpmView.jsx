// RpmView.jsx
import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

const RpmView = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const patient = location.state?.patient;
  const [patientIframeUrl, setPatientIframeUrl] = useState('');

  useEffect(() => {
    const fetchPatientIframe = async () => {
      try {
        const patientId = patient?.patient_id || patient?.id;
        if (!patientId) return;
        
        const response = await fetch(
          `https://doctorassist.ai/api/hms/users/ambulance/ambulance/patient-click/latest/${patientId}`
        );
        
        const result = await response.json();
        
        if (result?.status === 'success') {
          setPatientIframeUrl(result?.data?.iframeUrl || '');
        }
      } catch (err) {
        console.log('Error fetching iframe:', err);
      }
    };
    
    fetchPatientIframe();
  }, [patient]);

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
  padding: '1rem', 
  borderBottom: '1px solid #e0e0e0',
  display: 'flex',
  justifyContent: 'center',  /* CHANGED: space-between → center */
  alignItems: 'center',
  position: 'relative'  /* ADDED: for absolute positioning of button */
}}>
  <h2 style={{ margin: 0 }}>RPM Patient Monitor</h2>
  <button 
    onClick={() => navigate(-1)}
    style={{
      position: 'absolute',
      right: '1rem',  /* ADDED: positions button on right */
      padding: '8px 16px',
      background: '#000',
      color: '#fff',
      border: 'none',
      cursor: 'pointer',
      fontSize: '0.8rem'
    }}
  >
    Back to Dashboard
  </button>
</div>
      <div
  style={{
    marginTop: '12px',
    border: '1px solid #e0e0e0',
    height: '600px',
    background: '#fff',
    overflow: 'hidden',
    position: 'relative'
  }}
>
  {patientIframeUrl ? (
    <>
      <iframe
        src={patientIframeUrl}
        title="RPM Platform"
        width="100%"
        height="100%"
        style={{
          border: 'none'
        }}
        allow="camera; microphone; fullscreen"
      />
      <div style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        height: '60px',
        backgroundColor: '#000000',
        zIndex: 10
      }} />
    </>
  ) : (
    <div style={{ padding: '20px', fontSize: '12px', color: '#666' }}>
      No RPM iframe available
    </div>
  )}
</div>
    </div>
  );
};

export default RpmView;