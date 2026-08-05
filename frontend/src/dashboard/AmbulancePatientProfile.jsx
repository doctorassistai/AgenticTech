import React, { useState, useEffect } from 'react';

const API_BASE_URL = 'https://doctorassist.ai/api';

export default function AmbulancePatientProfile() {
  const [iframeUrl, setIframeUrl] = useState('');
  const [incidentCompleted, setIncidentCompleted] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [patient, setPatient] = useState(null);

  useEffect(() => {
    // Get patient_id from URL
    const urlParams = new URLSearchParams(window.location.search);
    const patientId = urlParams.get('id');
    // ✅ Listen for completion message from iframe
    const handleMessage = (event) => {
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        console.log('📩 MESSAGE FROM IFRAME:', msg);
        if (msg?.action === 'mark_as_completed') {
          console.log('✅ Completion message received — showing popup');
          setIncidentCompleted(true);
        }
      } catch (e) {}
    };
    window.addEventListener('message', handleMessage);
    // Also try to get patient data from localStorage
    const storedPatient = localStorage.getItem('selected_patient');
    
    if (storedPatient) {
      setPatient(JSON.parse(storedPatient));
    }
    
    if (patientId) {
      fetchIframeUrl(patientId);
    } else {
      setError('No patient ID found');
      setLoading(false);
    }
return () => {
      window.removeEventListener('message', handleMessage);
    };
  }, []);

const fetchIframeUrl = async (patientId) => {
  try {
    setLoading(true);
    const response = await fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/patient-click/latest/${patientId}`);
    const data = await response.json();
    
  if (response.ok && data.status === 'success') {
      // Check if incident already completed
      if (data.data?.status === 'completed') {
        setIncidentCompleted(true);
      }
      let url = data.data?.iframeUrl;
      if (url) {
        // Replace the domain and port
        url = url.replace('https://zenzo.theapothecary.co.in:9502', 'http://localhost:9001');
        
        console.log('🔗 IFRAME URL:', url);
        setIframeUrl(url);
      } else {
        setError('No iframe URL found for this patient');
      }
    } else {
      setError(data.detail || 'Failed to load patient details');
    }
  } catch (error) {
    console.error('Error fetching iframe URL:', error);
    setError('Network error. Please try again.');
  } finally {
    setLoading(false);
  }
};

  const handleGoBack = () => {
    window.location.href = '/ambulance-dashboard';
  };

  const handleIframeLoad = () => {
    // Try to hide branding elements (may not work due to CORS)
    setTimeout(() => {
      try {
        const iframes = document.querySelectorAll('iframe');
        const lastIframe = iframes[iframes.length - 1];
        
        if (lastIframe && lastIframe.contentDocument) {
          const elementsToHide = lastIframe.contentDocument.querySelectorAll(
            '[class*="footer"], [class*="branding"], [class*="powered"], [class*="watermark"], ' +
            '[id*="footer"], [id*="branding"], [id*="powered"], [class*="logo"], [class*="apoc"]'
          );
          elementsToHide.forEach(el => el.style.display = 'none');
        }
      } catch (error) {
        // Cross-origin restrictions - can't modify iframe content
        console.log('Cannot modify iframe content due to CORS policy');
      }
    }, 1000);
  };

  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: '#f5f5f5',
      display: 'flex',
      flexDirection: 'column',
    },
    header: {
      backgroundColor: '#ffffff',
      borderBottom: '1px solid #e0e0e0',
      padding: '16px 24px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      position: 'sticky',
      top: 0,
      zIndex: 100,
      flexShrink: 0,
    },
    headerLeft: {
      display: 'flex',
      alignItems: 'center',
      gap: '16px',
    },
    backButton: {
      backgroundColor: '#000000',
      color: '#ffffff',
      border: 'none',
      padding: '8px 16px',
      cursor: 'pointer',
      fontSize: '14px',
      borderRadius: '4px',
    },
    title: {
      fontSize: '20px',
      fontWeight: '500',
      color: '#000000',
      margin: 0,
    },
    patientInfo: {
      fontSize: '14px',
      color: '#666666',
    },
    content: {
      flex: 1,
      padding: '0',
      overflow: 'auto',
      minHeight: 0,
    },
    loadingContainer: {
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '400px',
    },
    spinner: {
      border: '3px solid #f3f3f3',
      borderTop: '3px solid #000000',
      borderRadius: '50%',
      width: '40px',
      height: '40px',
      animation: 'spin 1s linear infinite',
    },
    errorContainer: {
      textAlign: 'center',
      padding: '40px',
      backgroundColor: '#ffffff',
      borderRadius: '8px',
      margin: '20px',
    },
    errorText: {
      color: '#d32f2f',
      fontSize: '16px',
      marginBottom: '20px',
    },
    iframeContainer: {
      width: '100%',
      height: '100%',
      backgroundColor: '#ffffff',
      position: 'relative',
    },
    iframe: {
      width: '100%',
      height: '100vh',
      border: 'none',
      display: 'block',
    },
  hideOverlay: {
  position: 'relative',  // ← CHANGED from 'fixed' to 'relative'
  bottom: 0,
  left: 0,
  right: 0,
  height: '50px',
  backgroundColor: '#000000',
  zIndex: 999,
  pointerEvents: 'none',
},
  };

  return (
    <div style={styles.container}>
      <style>
        {`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
          * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
          }
          body {
            margin: 0;
            padding: 0;
            overflow: hidden;
          }
        `}
      </style>
      
  <div style={styles.content}>
  {/* Breadcrumb Navigation */}
 <div style={{ padding: '16px 24px', backgroundColor: '#ffffff', borderBottom: '1px solid #e0e0e0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px' }}>
    <span 
      style={{ cursor: 'pointer', color: '#000000', fontWeight: '500' }}
      onClick={() => {
        localStorage.removeItem('access_token');
        localStorage.removeItem('user');
        localStorage.removeItem('selected_patient');
        window.location.href = '/ambulance-login';
      }}
    >
      Logout
    </span>
    <span style={{ color: '#888888' }}>{'>'}</span>
    <span 
      style={{ cursor: 'pointer', color: '#000000', fontWeight: '500' }}
      onClick={handleGoBack}
    >
      Dashboard
    </span>
  </div>

    <h2 style={{ margin: 0, fontSize: '18px', fontWeight: '500', color: '#000000', position: 'absolute', left: '50%', transform: 'translateX(-50%)' }}>Patient Monitoring Screen</h2>
  
</div>
  
  
        
        {loading ? (
          <div style={styles.loadingContainer}>
            <div style={styles.spinner}></div>
          </div>
        ) : error ? (
          <div style={styles.errorContainer}>
            <div style={styles.errorText}>❌ {error}</div>
            <button style={styles.backButton} onClick={handleGoBack}>
              Return to Dashboard
            </button>
          </div>
       ) : (
          <div style={styles.iframeContainer}>
            {/* SCROLLABLE WRAPPER - this enables outer scrolling */}
            <div style={{ height: '100vh', overflowY: 'auto', overflowX: 'hidden' }}>
              
              {/* Iframe with fixed height - NO internal scrolling */}
              <div style={{ height: '100vh', flexShrink: 0 }}>
                <iframe 
                  src={iframeUrl}
                  style={{ ...styles.iframe, height: '100%', overflow: 'hidden' }}
                  title="Patient Details"
                  allow="camera; microphone; autoplay; fullscreen"
                  sandbox="allow-same-origin allow-scripts allow-popups allow-forms allow-modals"
                  allowFullScreen
                  onLoad={handleIframeLoad}
                  scrolling="no"
                />
              </div>
              
              {/* THIS SPACER ENABLES SCROLLING - Adjust height as needed */}
              <div style={{ height: '378px', flexShrink: 0, backgroundColor: '#000000' }}></div>
              
            </div>

            {/* Incident Completed Popup - fixed overlay, does NOT affect scroll */}
            {incidentCompleted && (
              <div style={{
                position: 'fixed', inset: 0, zIndex: 9999,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <div style={{
                  background: '#fff', borderRadius: 12,
                  padding: '36px 40px', maxWidth: 360, width: '90%',
                  textAlign: 'center', boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
                }}>
                 
                  <div style={{ fontSize: 20, fontWeight: 700, color: '#000', marginBottom: 8 }}>
                    Incident Completed
                  </div>
                  <div style={{ fontSize: 14, color: '#555', marginBottom: 24, lineHeight: 1.6 }}>
                    The incident has been successfully completed.
                  </div>
                  <button
                    onClick={() => window.location.href = '/ambulance-dashboard'}
                    style={{
                      background: '#000', color: '#fff', border: 'none',
                      padding: '12px 32px', borderRadius: 6, fontSize: 14,
                      fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    OK — Go to Dashboard
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}