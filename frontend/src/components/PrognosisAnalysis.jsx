import React, { useState, forwardRef, useImperativeHandle } from 'react';

const PrognosisAnalysis = forwardRef(({ 
  patientId, 
  doctorId, 
  dictation, 
  onSave
}, ref) => {
  const [isLoading, setIsLoading] = useState(false);
  const [analysisData, setAnalysisData] = useState(null);
  const [error, setError] = useState(null);
  const [doctorNotes, setDoctorNotes] = useState('');
  const [includeInPatientData, setIncludeInPatientData] = useState(true);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isAcceptingSuggestion, setIsAcceptingSuggestion] = useState(false);
  const [clinicalJustification, setClinicalJustification] = useState('');

  // Hospital color scheme
  const colors = {
    primary: '#0056b3',
    secondary: '#007c7c',
    success: '#28a745',
    warning: '#ffc107',
    danger: '#dc3545',
    info: '#17a2b8',
    light: '#f8f9fa',
    dark: '#343a40',
    white: '#ffffff',
    background: '#e9ecef',
    border: '#dee2e6',
    textPrimary: '#212529',
    textSecondary: '#6c757d'
  };

  const styles = {
    compactContainer: {
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
      backgroundColor: colors.white,
      borderRadius: '6px',
      padding: '15px',
      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
      margin: '10px 0',
      border: `1px solid ${colors.border}`,
      borderLeft: `4px solid ${colors.primary}`,
      transition: 'all 0.3s ease',
      cursor: 'pointer'
    },
    compactHeader: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '10px'
    },
    compactTitle: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    },
    compactIcon: {
      fontSize: '20px',
      color: colors.primary
    },
    compactText: {
      color: colors.textPrimary,
      fontSize: '16px',
      fontWeight: '600',
      margin: 0
    },
    compactSubtext: {
      color: colors.textSecondary,
      fontSize: '13px',
      margin: '2px 0 0 0'
    },
    compactButton: {
      backgroundColor: colors.primary,
      color: colors.white,
      border: 'none',
      padding: '8px 16px',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      '&:hover': {
        backgroundColor: '#004494',
        transform: 'translateY(-1px)'
      },
      '&:disabled': {
        backgroundColor: colors.border,
        color: colors.textSecondary,
        cursor: 'not-allowed',
        transform: 'none'
      }
    },
    expandedContainer: {
      fontFamily: "'Helvetica Neue', Arial, sans-serif",
      backgroundColor: colors.white,
      borderRadius: '8px',
      padding: '20px',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.1)',
      margin: '15px 0',
      border: `1px solid ${colors.border}`,
      borderLeft: `4px solid ${colors.primary}`,
      transition: 'all 0.3s ease'
    },
    header: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '20px',
      paddingBottom: '15px',
      borderBottom: `1px solid ${colors.border}`
    },
    title: {
      color: colors.primary,
      fontSize: '18px',
      fontWeight: '600',
      margin: 0,
      display: 'flex',
      alignItems: 'center',
      gap: '10px'
    },
    statusBadge: (status) => ({
      backgroundColor: status === 'excellent' ? colors.success : 
                      status === 'guarded' ? colors.warning : 
                      status === 'poor' ? colors.danger : colors.info,
      color: colors.white,
      padding: '4px 10px',
      borderRadius: '4px',
      fontSize: '12px',
      fontWeight: '600',
      textTransform: 'uppercase',
      marginLeft: '10px'
    }),
    loadingContainer: {
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 20px',
      backgroundColor: 'rgba(248, 249, 250, 0.8)',
      borderRadius: '8px'
    },
    spinner: {
      border: `3px solid ${colors.border}`,
      borderTop: `3px solid ${colors.primary}`,
      borderRadius: '50%',
      width: '40px',
      height: '40px',
      animation: 'spin 1s linear infinite',
      marginBottom: '15px'
    },
    errorContainer: {
      backgroundColor: 'rgba(220, 53, 69, 0.1)',
      border: `1px solid ${colors.danger}`,
      borderRadius: '6px',
      padding: '15px',
      marginBottom: '15px'
    },
    errorText: {
      color: colors.danger,
      margin: 0,
      fontWeight: '500',
      fontSize: '14px'
    },
    analysisGrid: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))',
      gap: '20px',
      marginTop: '20px'
    },
    card: {
      backgroundColor: colors.white,
      borderRadius: '6px',
      padding: '15px',
      border: `1px solid ${colors.border}`,
      boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
    },
    cardHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '15px',
      paddingBottom: '10px',
      borderBottom: `1px solid ${colors.border}`
    },
    cardTitle: {
      color: colors.textPrimary,
      fontSize: '15px',
      fontWeight: '600',
      margin: 0
    },
    section: {
      marginBottom: '20px'
    },
    subSection: {
      marginBottom: '15px'
    },
    subTitle: {
      color: colors.secondary,
      fontSize: '14px',
      fontWeight: '600',
      marginBottom: '8px',
      display: 'flex',
      alignItems: 'center',
      gap: '8px'
    },
    text: {
      color: colors.textPrimary,
      fontSize: '14px',
      lineHeight: '1.5',
      margin: '5px 0'
    },
    sentenceList: {
      margin: '10px 0',
      paddingLeft: '20px'
    },
    sentenceItem: {
      color: colors.textPrimary,
      fontSize: '14px',
      lineHeight: '1.5',
      marginBottom: '10px',
      position: 'relative',
      '&:before': {
        content: '"•"',
        color: colors.primary,
        position: 'absolute',
        left: '-15px',
        fontSize: '16px'
      }
    },
    suggestionBox: {
      backgroundColor: 'rgba(40, 167, 69, 0.1)',
      border: `1px solid ${colors.success}`,
      borderRadius: '6px',
      padding: '15px',
      margin: '15px 0'
    },
    acceptButton: {
      backgroundColor: colors.success,
      color: colors.white,
      border: 'none',
      padding: '8px 16px',
      borderRadius: '4px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '6px',
      marginTop: '10px',
      '&:hover': {
        backgroundColor: '#218838',
        transform: 'translateY(-1px)'
      }
    },
    toggleContainer: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      padding: '15px',
      backgroundColor: '#f8f9fa',
      borderRadius: '6px',
      marginTop: '20px',
      border: `1px solid ${colors.border}`
    },
    toggleLabel: {
      fontSize: '14px',
      fontWeight: '500',
      color: colors.textPrimary
    },
    toggleSwitch: {
      position: 'relative',
      display: 'inline-block',
      width: '60px',
      height: '34px'
    },
    toggleSlider: {
      position: 'absolute',
      cursor: 'pointer',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      backgroundColor: '#ccc',
      transition: '.4s',
      borderRadius: '34px',
      '&:before': {
        position: 'absolute',
        content: '""',
        height: '26px',
        width: '26px',
        left: '4px',
        bottom: '4px',
        backgroundColor: colors.white,
        transition: '.4s',
        borderRadius: '50%',
        boxShadow: '0 2px 4px rgba(0,0,0,0.2)'
      }
    },
    toggleSliderOn: {
      backgroundColor: colors.primary,
      '&:before': {
        transform: 'translateX(26px)'
      }
    },
    secondaryButton: {
      backgroundColor: 'transparent',
      color: colors.primary,
      border: `1px solid ${colors.primary}`,
      padding: '8px 16px',
      borderRadius: '6px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      '&:hover': {
        backgroundColor: 'rgba(0, 86, 179, 0.1)'
      }
    },
    acceptToggle: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginTop: '10px'
    },
    acceptLabel: {
      fontSize: '14px',
      color: colors.textPrimary,
      fontWeight: '500'
    },
    justificationSection: {
      backgroundColor: 'rgba(23, 162, 184, 0.05)',
      border: `1px solid ${colors.info}40`,
      borderRadius: '6px',
      padding: '15px',
      margin: '15px 0'
    },
    justificationHeader: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      marginBottom: '10px'
    },
    justificationIcon: {
      fontSize: '18px',
      color: colors.info
    },
    justificationTitle: {
      fontSize: '15px',
      fontWeight: '600',
      color: colors.info,
      margin: 0
    },
    justificationTextarea: {
      width: '100%',
      padding: '12px',
      border: `1px solid ${colors.border}`,
      borderRadius: '4px',
      fontSize: '14px',
      lineHeight: '1.5',
      fontFamily: 'inherit',
      resize: 'vertical',
      minHeight: '80px',
      marginTop: '10px',
      transition: 'all 0.2s ease',
      '&:focus': {
        outline: 'none',
        borderColor: colors.info,
        boxShadow: `0 0 0 2px ${colors.info}20`
      },
      '&::placeholder': {
        color: colors.textSecondary,
        opacity: 0.7
      }
    },
    characterCount: {
      fontSize: '11px',
      color: colors.textSecondary,
      textAlign: 'right',
      marginTop: '5px'
    }
  };

  // Helper function to determine which data structure we have
  const getDataType = (data) => {
    if (!data?.finaloutput) return 'unknown';
    
    if (data.finaloutput.clinical_validation) {
      return 'clinical_validation';
    } else if (data.finaloutput.prognosis_analysis) {
      return 'prognosis';
    } else if (data.finaloutput.documentation_analysis) {
      return 'prognosis';
    } else {
      return 'unknown';
    }
  };

  // Fetch prognosis analysis data
  const fetchPrognosisAnalysis = async () => {
    if (!patientId || !doctorId) {
      setError('Patient ID and Doctor ID are required');
      return;
    }

    if (!dictation || dictation.trim().length === 0) {
      setError('Clinical dictation is required for prognosis analysis');
      return;
    }

    setIsLoading(true);
    setError(null);
    setIsExpanded(true);

    try {
      const requestData = {
        doctor_id: doctorId,
        patient_id: patientId,
        objectives: "",
        current_dictation: dictation
      };

      console.log('📤 Sending prognosis analysis request:', requestData);

      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
      
      const response = await fetch(`${API_BASE_URL}hms/users/orchestration/generate_prognosis_analysis`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestData)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      console.log("📥 Received prognosis analysis data:", data);
      
      if (data.status === 'success') {
        setAnalysisData(data);
        console.log("📊 Data type detected:", getDataType(data));
      } else {
        throw new Error(data.message || 'Failed to fetch analysis');
      }
    } catch (err) {
      setError(err.message || 'An error occurred while fetching prognosis analysis');
      console.error('❌ Prognosis analysis error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSaveToggle = () => {
    setIncludeInPatientData(!includeInPatientData);
  };

  const handleAcceptSuggestion = () => {
    setIsAcceptingSuggestion(!isAcceptingSuggestion);
  };

  const handleCompactClick = () => {
    setIsExpanded(true);
  };

  // Helper function to get clinical justification value (null if empty string)
  const getClinicalJustificationValue = () => {
    return clinicalJustification && clinicalJustification.trim() !== '' 
      ? clinicalJustification.trim() 
      : null;
  };

  // Function to clean prognosis data - handles both data structures
  const cleanPrognosisData = (data) => {
    if (!data) return data;
    
    console.log('🧹 Cleaning prognosis data - Original:', JSON.stringify(data, null, 2));
    
    // Create a deep copy
    const cleaned = JSON.parse(JSON.stringify(data));
    
    const dataType = getDataType(data);
    
    if (dataType === 'clinical_validation') {
      // Clean clinical validation data
      if (cleaned.finaloutput?.clinical_validation?.diagnosis_validation?.diagnoses) {
        cleaned.finaloutput.clinical_validation.diagnosis_validation.diagnoses = 
          cleaned.finaloutput.clinical_validation.diagnosis_validation.diagnoses.filter(d => d.diagnosis_text);
      }
      
      if (cleaned.finaloutput?.clinical_validation?.investigation_validation?.investigations) {
        cleaned.finaloutput.clinical_validation.investigation_validation.investigations = 
          cleaned.finaloutput.clinical_validation.investigation_validation.investigations.filter(i => i.test_name);
      }
      
      if (cleaned.finaloutput?.clinical_validation?.rx_validation?.medications) {
        cleaned.finaloutput.clinical_validation.rx_validation.medications = 
          cleaned.finaloutput.clinical_validation.rx_validation.medications.filter(m => m.drug_name);
      }
    } else if (dataType === 'prognosis') {
      // Clean prognosis data - remove unwanted fields
      if (cleaned.finaloutput?.integrated_recommendations?.suggestion_properties) {
        delete cleaned.finaloutput.integrated_recommendations.suggestion_properties;
      }
      
      // Clean metadata - remove data_sources completely
      if (cleaned.metadata?.data_sources) {
        delete cleaned.metadata.data_sources;
      }
      
      // Also clean nested metadata in finaloutput if it exists
      if (cleaned.finaloutput?.metadata?.data_sources) {
        delete cleaned.finaloutput.metadata.data_sources;
      }
    }
    
    console.log('🧹 Cleaning prognosis data - Cleaned:', JSON.stringify(cleaned, null, 2));
    return cleaned;
  };

  // Method to get prognosis data for saving
  // Also update getPrognosisSaveData for consistency
const getPrognosisSaveData = () => {
  if (!analysisData || !includeInPatientData) {
    console.log('⚠️ No prognosis data to save or save is disabled');
    return null;
  }

  // Clean the data first
  const cleanedData = cleanPrognosisData(analysisData);
  
  // Structure the data EXACTLY as the backend expects
  const saveData = {
    patient_id: patientId,
    doctor_id: doctorId,
    analysis_data: {
      ...cleanedData,
      // Add clinical justification and suggestion_accepted INSIDE analysis_data
      clinical_justification: getClinicalJustificationValue(),
      suggestion_accepted: isAcceptingSuggestion,
      doctor_notes: doctorNotes
    },
    created_at: new Date().toISOString()
  };

  console.log('📦 getPrognosisSaveData() - Prepared save data:', JSON.stringify(saveData, null, 2));
  return saveData;
};
  // Method to save prognosis data directly (for dashboard.jsx to call)
  // Method to save prognosis data directly (for dashboard.jsx to call)
const savePrognosisData = async () => {
  console.log('💾 savePrognosisData() - Starting save process...');
  console.log('Current state:', {
    hasAnalysisData: !!analysisData,
    includeInPatientData,
    isAcceptingSuggestion,
    doctorNotes,
    clinicalJustification: getClinicalJustificationValue(),
    dataType: analysisData ? getDataType(analysisData) : 'none'
  });

  if (!analysisData || !includeInPatientData) {
    console.log('❌ savePrognosisData() - No data to save or save is disabled');
    return { success: false, message: 'No data to save or save is disabled' };
  }

  try {
    // Clean the data before sending
    const cleanedData = cleanPrognosisData(analysisData);
    
    // Structure the data EXACTLY as the backend expects
    const saveData = {
      patient_id: patientId,
      doctor_id: doctorId,
      analysis_data: {
        ...cleanedData,
        // Add clinical justification and suggestion_accepted INSIDE analysis_data
        clinical_justification: getClinicalJustificationValue(),
        suggestion_accepted: isAcceptingSuggestion,
        doctor_notes: doctorNotes
      },
      created_at: new Date().toISOString()
    };

    console.log('📤 savePrognosisData() - Final payload being sent to backend:', JSON.stringify(saveData, null, 2));

    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
    
    const response = await fetch(`${API_BASE_URL}hms/users/data/context/save-prognosis-data`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(saveData)
    });

    console.log('📥 savePrognosisData() - Response status:', response.status);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const result = await response.json();
    console.log('📥 savePrognosisData() - Raw response:', result);
    
    console.log('✅ savePrognosisData() - Save completed successfully:', result);
    return { success: true, data: result };
    
  } catch (err) {
    console.error('❌ savePrognosisData() - Error:', err.message);
    return { success: false, message: err.message };
  }
};

  // Expose methods via ref
  useImperativeHandle(ref, () => ({
    getPrognosisSaveData: () => {
      console.log('🔧 useImperativeHandle - getPrognosisSaveData called');
      return getPrognosisSaveData();
    },
    savePrognosisData: async () => {
      console.log('🔧 useImperativeHandle - savePrognosisData called');
      return await savePrognosisData();
    },
    hasData: () => {
      const hasData = !!analysisData;
      console.log('🔧 useImperativeHandle - hasData:', hasData, 'Type:', analysisData ? getDataType(analysisData) : 'none');
      return hasData;
    },
    isIncluded: () => {
      const included = includeInPatientData;
      console.log('🔧 useImperativeHandle - isIncluded:', included);
      return included;
    },
    resetAnalysis: () => {
      console.log('🔧 useImperativeHandle - resetAnalysis called');
      setAnalysisData(null);
      setError(null);
      setIsExpanded(false);
      setIsAcceptingSuggestion(false);
      setClinicalJustification('');
    }
  }));

  // Keyframes for spinner
  const keyframesStyle = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;

  // Render loading state
  const renderLoading = () => (
    <div style={styles.loadingContainer}>
      <style>{keyframesStyle}</style>
      <div style={styles.spinner}></div>
      <p style={{ color: colors.textPrimary, fontSize: '15px', fontWeight: '500' }}>
        Processing Analysis
      </p>
      <p style={{ color: colors.textSecondary, fontSize: '13px', marginTop: '8px' }}>
        Analyzing clinical data and generating insights...
      </p>
    </div>
  );

  // Render error state
  const renderError = () => (
    <div style={styles.errorContainer}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ 
          width: '24px', 
          height: '24px', 
          borderRadius: '50%', 
          backgroundColor: colors.danger,
          color: colors.white,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          fontWeight: 'bold',
          flexShrink: 0
        }}>
          !
        </div>
        <div>
          <p style={styles.errorText}>⚠️ {error}</p>
          <button 
            style={{ ...styles.secondaryButton, marginTop: '10px', padding: '6px 12px', fontSize: '13px' }}
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );

  // Render compact mode (always visible)
  const renderCompactMode = () => (
    <div 
      style={styles.compactContainer}
      onClick={handleCompactClick}
    >
      <div style={styles.compactHeader}>
        <div style={styles.compactTitle}>
          <div>
            <p style={styles.compactText}>Clinical Analysis</p>
            <p style={styles.compactSubtext}>
              {dictation && dictation.trim().length > 0 
                ? "Click to view analysis" 
                : "Generate analysis after dictation"}
            </p>
          </div>
        </div>
        <button
          style={{
            ...styles.compactButton,
            ...(!dictation || dictation.trim().length === 0 ? { 
              backgroundColor: colors.border, 
              color: colors.textSecondary, 
              cursor: 'not-allowed' 
            } : {})
          }}
          onClick={(e) => {
            e.stopPropagation();
            if (dictation && dictation.trim().length > 0) {
              fetchPrognosisAnalysis();
            }
          }}
          disabled={isLoading || !dictation || dictation.trim().length === 0}
        >
          {isLoading ? (
            <>
              <div style={{ ...styles.spinner, width: '14px', height: '14px', margin: 0, borderWidth: '2px' }}></div>
              Analyzing...
            </>
          ) : (
            'Analyze'
          )}
        </button>
      </div>
    </div>
  );

  // Render expanded mode without analysis data
  const renderEmptyExpandedMode = () => (
    <div style={styles.expandedContainer}>
      <div style={styles.header}>
        <div>
          <h2 style={styles.title}>
            Clinical Analysis
          </h2>
          <p style={{ color: colors.textSecondary, margin: '5px 0 0 0', fontSize: '13px' }}>
            Clinical evaluation and validation
          </p>
        </div>
        <button 
          style={styles.secondaryButton}
          onClick={() => setIsExpanded(false)}
        >
          ← Back
        </button>
      </div>

      <div style={{ padding: '30px 20px', textAlign: 'center' }}>
        <div style={{ fontSize: '48px', marginBottom: '15px', opacity: 0.3 }}>📋</div>
        <h4 style={{ margin: '0 0 10px 0', color: colors.textSecondary, fontWeight: '500' }}>
          {!dictation || dictation.trim().length === 0 
            ? 'No Clinical Dictation Available' 
            : 'Ready to Generate Analysis'}
        </h4>
        <p style={{ margin: 0, fontSize: '14px', maxWidth: '400px', lineHeight: '1.5', margin: '0 auto' }}>
          {!dictation || dictation.trim().length === 0 
            ? 'Please provide clinical dictation first to enable analysis.'
            : 'Click the button below to generate analysis based on your dictation.'}
        </p>
        
        {dictation && dictation.trim().length > 0 && (
          <button
            style={{
              ...styles.compactButton,
              marginTop: '20px',
              padding: '12px 24px',
              fontSize: '15px'
            }}
            onClick={fetchPrognosisAnalysis}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <div style={{ ...styles.spinner, width: '18px', height: '18px', margin: 0, borderWidth: '2px' }}></div>
                Analyzing...
              </>
            ) : (
              'Generate Report'
            )}
          </button>
        )}
      </div>
    </div>
  );

  // Render prognosis analysis (original format)
  const renderPrognosisFormat = (data) => {
    const prognosisData = data.finaloutput;
    const integratedRecommendations = prognosisData.integrated_recommendations;

    return (
      <>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>
              Prognosis Analysis
              {prognosisData.prognosis_analysis?.prognosis_category && (
                <span style={styles.statusBadge(prognosisData.prognosis_analysis.prognosis_category)}>
                  {prognosisData.prognosis_analysis.prognosis_category}
                </span>
              )}
            </h2>
            <p style={{ color: colors.textSecondary, margin: '5px 0 0 0', fontSize: '13px' }}>
              Generated {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </p>
          </div>
        </div>

        {/* Documentation Analysis */}
        {prognosisData.documentation_analysis && (
          <div style={styles.section}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Documentation Analysis</h3>
                {prognosisData.documentation_analysis.progression_analysis?.progression_pattern && (
                  <div style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '600',
                    backgroundColor: colors.info + '20',
                    color: colors.info,
                    border: `1px solid ${colors.info}`
                  }}>
                    Pattern: {prognosisData.documentation_analysis.progression_analysis.progression_pattern}
                  </div>
                )}
              </div>
              
              {prognosisData.documentation_analysis.progression_analysis?.historical_prognosis && 
               prognosisData.documentation_analysis.progression_analysis.historical_prognosis.length > 0 && (
                <div style={styles.subSection}>
                  <div style={styles.subTitle}>
                    <span>Historical Prognosis</span>
                  </div>
                  <div style={styles.sentenceList}>
                    {prognosisData.documentation_analysis.progression_analysis.historical_prognosis.map((sentence, index) => (
                      <div key={index} style={styles.sentenceItem}>{sentence}</div>
                    ))}
                  </div>
                </div>
              )}
              
              {prognosisData.documentation_analysis.progression_analysis?.current_prognosis && 
               prognosisData.documentation_analysis.progression_analysis.current_prognosis.length > 0 && (
                <div style={styles.subSection}>
                  <div style={styles.subTitle}>
                    <span>Current Prognosis</span>
                  </div>
                  <div style={styles.sentenceList}>
                    {prognosisData.documentation_analysis.progression_analysis.current_prognosis.map((sentence, index) => (
                      <div key={index} style={styles.sentenceItem}>{sentence}</div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Prognosis Assessment */}
        {prognosisData.prognosis_analysis && (
          <div style={styles.section}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Prognosis Assessment</h3>
                {prognosisData.prognosis_analysis.confidence_level && (
                  <div style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '600',
                    backgroundColor: colors.info + '20',
                    color: colors.info,
                    border: `1px solid ${colors.info}`
                  }}>
                    Confidence: {prognosisData.prognosis_analysis.confidence_level}
                  </div>
                )}
              </div>
              
              {prognosisData.prognosis_analysis.disease_assessment?.stage && (
                <div style={styles.subSection}>
                  <div style={styles.subTitle}>
                    <span>Disease Assessment</span>
                  </div>
                  <p style={styles.text}>
                    <strong>Stage:</strong> {prognosisData.prognosis_analysis.disease_assessment.stage}
                  </p>
                  {prognosisData.prognosis_analysis.disease_assessment.severity && (
                    <p style={styles.text}>
                      <strong>Severity:</strong> {prognosisData.prognosis_analysis.disease_assessment.severity}
                    </p>
                  )}
                  {prognosisData.prognosis_analysis.disease_assessment.trend_direction && (
                    <p style={styles.text}>
                      <strong>Trend:</strong> {prognosisData.prognosis_analysis.disease_assessment.trend_direction}
                    </p>
                  )}
                </div>
              )}
              
              {prognosisData.prognosis_analysis.risk_assessment && (
                <div style={styles.subSection}>
                  <div style={styles.subTitle}>
                    <span>Risk Assessment</span>
                  </div>
                  {Object.entries(prognosisData.prognosis_analysis.risk_assessment).map(([key, value]) => (
                    <p key={key} style={styles.text}>
                      <strong>{key.replace('_', ' ').charAt(0).toUpperCase() + key.replace('_', ' ').slice(1)}:</strong> {value}
                    </p>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Integrated Recommendations with Acceptance Option */}
        {integratedRecommendations && integratedRecommendations.suggestion && (
          <div style={styles.section}>
            <div style={styles.suggestionBox}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Clinical Recommendations</h3>
                {integratedRecommendations.expected_impact?.prognosis_impact && (
                  <div style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: '600',
                    backgroundColor: colors.success + '20',
                    color: colors.success,
                    border: `1px solid ${colors.success}`
                  }}>
                    Impact: {integratedRecommendations.expected_impact.prognosis_impact}
                  </div>
                )}
              </div>
              
              <p style={{ ...styles.text, fontSize: '15px', fontWeight: '500', marginBottom: '10px' }}>
                {integratedRecommendations.suggestion}
              </p>
              
              {integratedRecommendations.evidence_basis && (
                <div style={{ marginTop: '15px' }}>
                  <div style={styles.subTitle}>
                    <span>Evidence Basis</span>
                  </div>
                  <p style={styles.text}>{integratedRecommendations.evidence_basis}</p>
                </div>
              )}
              
              {/* Acceptance Toggle */}
              <div style={styles.acceptToggle}>
                <label style={styles.toggleSwitch}>
                  <input 
                    type="checkbox" 
                    checked={isAcceptingSuggestion}
                    onChange={handleAcceptSuggestion}
                    style={{ display: 'none' }}
                  />
                  <span style={{
                    ...styles.toggleSlider,
                    ...(isAcceptingSuggestion ? styles.toggleSliderOn : {})
                  }}></span>
                </label>
                <div style={styles.acceptLabel}>
                  {isAcceptingSuggestion ? '✓ Suggestion Accepted' : 'Accept this recommendation'}
                </div>
              </div>
              
              {isAcceptingSuggestion && (
                <div style={{ 
                  marginTop: '10px', 
                  padding: '10px', 
                  backgroundColor: colors.success + '15',
                  borderRadius: '4px',
                  border: `1px solid ${colors.success}30`
                }}>
                  <div style={{ fontSize: '12px', color: colors.success, fontWeight: '500' }}>
                    This recommendation will be included in the saved analysis.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  // Render clinical validation format (new format)
  const renderClinicalValidationFormat = (data) => {
    const clinicalValidation = data.finaloutput.clinical_validation;

    return (
      <>
        {/* Header */}
        <div style={styles.header}>
          <div>
            <h2 style={styles.title}>
              Clinical Validation Analysis
            </h2>
            <p style={{ color: colors.textSecondary, margin: '5px 0 0 0', fontSize: '13px' }}>
              Generated {new Date().toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
            </p>
          </div>
        </div>

        {/* Summary Flags */}
        {clinicalValidation?.summary_flags && (
          <div style={styles.section}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Summary Flags</h3>
              </div>
              <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                <div style={{ 
                  padding: '8px 16px', 
                  borderRadius: '20px',
                  backgroundColor: clinicalValidation.summary_flags.clinical_safety === 'green' ? colors.success + '20' : 
                                 clinicalValidation.summary_flags.clinical_safety === 'yellow' ? colors.warning + '20' : 
                                 colors.danger + '20',
                  color: clinicalValidation.summary_flags.clinical_safety === 'green' ? colors.success :
                         clinicalValidation.summary_flags.clinical_safety === 'yellow' ? colors.warning :
                         colors.danger,
                  fontWeight: '600',
                  fontSize: '13px'
                }}>
                  Clinical Safety: {clinicalValidation.summary_flags.clinical_safety.toUpperCase()}
                </div>
                <div style={{ 
                  padding: '8px 16px', 
                  borderRadius: '20px',
                  backgroundColor: clinicalValidation.summary_flags.insurance_readiness === 'green' ? colors.success + '20' : 
                                 clinicalValidation.summary_flags.insurance_readiness === 'yellow' ? colors.warning + '20' : 
                                 colors.danger + '20',
                  color: clinicalValidation.summary_flags.insurance_readiness === 'green' ? colors.success :
                         clinicalValidation.summary_flags.insurance_readiness === 'yellow' ? colors.warning :
                         colors.danger,
                  fontWeight: '600',
                  fontSize: '13px'
                }}>
                  Insurance Readiness: {clinicalValidation.summary_flags.insurance_readiness.toUpperCase()}
                </div>
                {clinicalValidation.summary_flags.requires_doctor_review && (
                  <div style={{ 
                    padding: '8px 16px', 
                    borderRadius: '20px',
                    backgroundColor: colors.warning + '20',
                    color: colors.warning,
                    fontWeight: '600',
                    fontSize: '13px'
                  }}>
                    ⚠️ Requires Doctor Review
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Diagnosis Validation */}
        {clinicalValidation?.diagnosis_validation?.diagnoses && clinicalValidation.diagnosis_validation.diagnoses.length > 0 && (
          <div style={styles.section}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Diagnosis Validation</h3>
              </div>
              {clinicalValidation.diagnosis_validation.diagnoses.map((diagnosis, index) => (
                <div key={index} style={{ ...styles.subSection, borderBottom: index < clinicalValidation.diagnosis_validation.diagnoses.length - 1 ? `1px solid ${colors.border}` : 'none', paddingBottom: '15px' }}>
                  <p style={{ ...styles.text, fontWeight: '600' }}>{diagnosis.diagnosis_text}</p>
                  <p style={styles.text}><strong>ICD-10:</strong> {diagnosis.suggested_icd10?.join(', ')}</p>
                  <p style={styles.text}><strong>Confidence:</strong> {(diagnosis.confidence * 100).toFixed(0)}%</p>
                  <p style={styles.text}><strong>Status:</strong> {diagnosis.validation_status}</p>
                  {diagnosis.explainability && (
                    <p style={{ ...styles.text, color: colors.textSecondary, fontStyle: 'italic' }}>{diagnosis.explainability}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Investigation Validation */}
        {clinicalValidation?.investigation_validation?.investigations && clinicalValidation.investigation_validation.investigations.length > 0 && (
          <div style={styles.section}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Recommended Investigations</h3>
              </div>
              {clinicalValidation.investigation_validation.investigations.map((investigation, index) => (
                <div key={index} style={{ ...styles.subSection, borderBottom: index < clinicalValidation.investigation_validation.investigations.length - 1 ? `1px solid ${colors.border}` : 'none', paddingBottom: '15px' }}>
                  <p style={{ ...styles.text, fontWeight: '600' }}>{investigation.test_name}</p>
                  <p style={styles.text}><strong>LOINC:</strong> {investigation.suggested_loinc?.join(', ')}</p>
                  <p style={styles.text}><strong>Necessity:</strong> {investigation.necessity_status}</p>
                  {investigation.clinical_justification && (
                    <p style={{ ...styles.text, color: colors.textSecondary }}>{investigation.clinical_justification}</p>
                  )}
                  {investigation.explainability && (
                    <p style={{ ...styles.text, color: colors.textSecondary, fontStyle: 'italic' }}>{investigation.explainability}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Medication Validation */}
        {clinicalValidation?.rx_validation?.medications && clinicalValidation.rx_validation.medications.length > 0 && (
          <div style={styles.section}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Medication Validation</h3>
              </div>
              {clinicalValidation.rx_validation.medications.map((medication, index) => (
                <div key={index} style={{ ...styles.subSection, borderBottom: index < clinicalValidation.rx_validation.medications.length - 1 ? `1px solid ${colors.border}` : 'none', paddingBottom: '15px' }}>
                  <p style={{ ...styles.text, fontWeight: '600' }}>{medication.drug_name}</p>
                  <p style={styles.text}><strong>Safety Status:</strong> {medication.safety_status}</p>
                  
                  {medication.interaction_risks && medication.interaction_risks.length > 0 && (
                    <div>
                      <p style={styles.text}><strong>Interaction Risks:</strong></p>
                      {medication.interaction_risks.map((risk, i) => (
                        <p key={i} style={{ ...styles.text, marginLeft: '15px', fontSize: '13px' }}>• {risk.interaction_text}</p>
                      ))}
                    </div>
                  )}
                  
                  {medication.dose_concerns && medication.dose_concerns.length > 0 && (
                    <div>
                      <p style={styles.text}><strong>Dose Concerns:</strong></p>
                      {medication.dose_concerns.map((concern, i) => (
                        <p key={i} style={{ ...styles.text, marginLeft: '15px', fontSize: '13px' }}>• {concern.dose_text}</p>
                      ))}
                    </div>
                  )}
                  
                  {medication.explainability && (
                    <p style={{ ...styles.text, color: colors.textSecondary, fontStyle: 'italic' }}>{medication.explainability}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Insurance Risk Analysis */}
        {clinicalValidation?.insurance_risk_analysis && (
          <div style={styles.section}>
            <div style={styles.card}>
              <div style={styles.cardHeader}>
                <h3 style={styles.cardTitle}>Insurance Risk Analysis</h3>
              </div>
              <p style={styles.text}><strong>Overall Risk:</strong> {clinicalValidation.insurance_risk_analysis.overall_risk}</p>
              
              {clinicalValidation.insurance_risk_analysis.risk_factors && clinicalValidation.insurance_risk_analysis.risk_factors.length > 0 && (
                <div>
                  <p style={styles.text}><strong>Risk Factors:</strong></p>
                  {clinicalValidation.insurance_risk_analysis.risk_factors.map((factor, i) => (
                    <p key={i} style={{ ...styles.text, marginLeft: '15px', fontSize: '13px' }}>• {factor}</p>
                  ))}
                </div>
              )}
              
              {clinicalValidation.insurance_risk_analysis.missing_documentation && clinicalValidation.insurance_risk_analysis.missing_documentation.length > 0 && (
                <div>
                  <p style={styles.text}><strong>Missing Documentation:</strong></p>
                  {clinicalValidation.insurance_risk_analysis.missing_documentation.map((doc, i) => (
                    <p key={i} style={{ ...styles.text, marginLeft: '15px', fontSize: '13px', color: colors.warning }}>• {doc}</p>
                  ))}
                </div>
              )}
              
              {clinicalValidation.insurance_risk_analysis.potential_rejection_reasons && clinicalValidation.insurance_risk_analysis.potential_rejection_reasons.length > 0 && (
                <div>
                  <p style={styles.text}><strong>Potential Rejection Reasons:</strong></p>
                  {clinicalValidation.insurance_risk_analysis.potential_rejection_reasons.map((reason, i) => (
                    <p key={i} style={{ ...styles.text, marginLeft: '15px', fontSize: '13px', color: colors.danger }}>• {reason}</p>
                  ))}
                </div>
              )}
              
              {clinicalValidation.insurance_risk_analysis.suggested_corrections && clinicalValidation.insurance_risk_analysis.suggested_corrections.length > 0 && (
                <div>
                  <p style={styles.text}><strong>Suggested Corrections:</strong></p>
                  {clinicalValidation.insurance_risk_analysis.suggested_corrections.map((correction, i) => (
                    <p key={i} style={{ ...styles.text, marginLeft: '15px', fontSize: '13px', color: colors.success }}>• {correction}</p>
                  ))}
                </div>
              )}
              
              {clinicalValidation.insurance_risk_analysis.explainability && (
                <p style={{ ...styles.text, color: colors.textSecondary, fontStyle: 'italic', marginTop: '10px' }}>
                  {clinicalValidation.insurance_risk_analysis.explainability}
                </p>
              )}
            </div>
          </div>
        )}
      </>
    );
  };

  // Render the appropriate format based on data type
  const renderAnalysisContent = () => {
    if (!analysisData?.finaloutput) return null;

    const dataType = getDataType(analysisData);
    console.log('🎨 Rendering analysis content for type:', dataType);

    return (
      <div style={styles.expandedContainer}>
        {/* Back button is always at the top */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '10px' }}>
          <button 
            style={styles.secondaryButton}
            onClick={() => {
              setAnalysisData(null);
              setError(null);
              setIsExpanded(false);
              setIsAcceptingSuggestion(false);
              setClinicalJustification('');
            }}
          >
            ← Back
          </button>
        </div>

        {/* Render the appropriate format */}
        {dataType === 'prognosis' && renderPrognosisFormat(analysisData)}
        {dataType === 'clinical_validation' && renderClinicalValidationFormat(analysisData)}
        {dataType === 'unknown' && (
          <div style={{ padding: '20px', textAlign: 'center' }}>
            <p style={{ color: colors.warning }}>Unknown data format received</p>
            <pre style={{ textAlign: 'left', background: '#f5f5f5', padding: '10px', borderRadius: '4px', overflow: 'auto' }}>
              {JSON.stringify(analysisData, null, 2)}
            </pre>
          </div>
        )}

        {/* Common sections for both formats */}

        {/* Doctor may: Add clinical justification */}
        <div style={styles.justificationSection}>
          <div style={styles.justificationHeader}>
            <span style={styles.justificationIcon}>📝</span>
            <h3 style={styles.justificationTitle}>Doctor may: Add clinical justification</h3>
          </div>
          <p style={{ ...styles.text, color: colors.textSecondary, marginBottom: '5px', fontSize: '13px' }}>
            Provide additional clinical context, reasoning, or justification
          </p>
          <textarea
            style={styles.justificationTextarea}
            value={clinicalJustification}
            onChange={(e) => setClinicalJustification(e.target.value)}
            placeholder="e.g., Based on patient's response to initial treatment and comorbidities, the analysis is adjusted to..."
            maxLength={500}
          />
          <div style={styles.characterCount}>
            {clinicalJustification.length}/500 characters
          </div>
          {clinicalJustification.trim() === '' && (
            <div style={{ fontSize: '11px', color: colors.textSecondary, marginTop: '5px', fontStyle: 'italic' }}>
              If left empty, this field will be saved as null
            </div>
          )}
        </div>

        {/* Save Toggle with iPhone-style switch */}
        <div style={styles.toggleContainer}>
          <div style={styles.toggleLabel}>
            <strong>Save Analysis</strong>
            <div style={{ fontSize: '12px', color: colors.textSecondary, marginTop: '2px' }}>
              {includeInPatientData 
                ? 'Analysis will be saved' 
                : 'Analysis will NOT be saved'}
            </div>
          </div>
          <label style={styles.toggleSwitch}>
            <input 
              type="checkbox" 
              checked={includeInPatientData}
              onChange={handleSaveToggle}
              style={{ display: 'none' }}
            />
            <span style={{
              ...styles.toggleSlider,
              ...(includeInPatientData ? styles.toggleSliderOn : {})
            }}></span>
          </label>
        </div>

        {/* Metadata */}
        {analysisData.metadata && (
          <div style={{ 
            marginTop: '20px', 
            paddingTop: '15px', 
            borderTop: `1px solid ${colors.border}`,
            fontSize: '11px', 
            color: colors.textSecondary 
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: '8px', marginBottom: '5px' }}>
              {analysisData.feature_id && (
                <span><strong>Feature:</strong> {analysisData.feature_name || analysisData.feature_id}</span>
              )}
              {analysisData.metadata.doctor_id && (
                <span><strong>Doctor ID:</strong> {analysisData.metadata.doctor_id.substring(0, 12)}...</span>
              )}
              {analysisData.metadata.patient_id && (
                <span><strong>Patient ID:</strong> {analysisData.metadata.patient_id.substring(0, 12)}...</span>
              )}
            </div>
            {analysisData.metadata.saved_from && (
              <div style={{ marginTop: '5px' }}>
                <strong>Saved From:</strong> {analysisData.metadata.saved_from}
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <>
      <style>{keyframesStyle}</style>
      
      {/* Error Display */}
      {error && renderError()}

      {/* Show appropriate content based on state */}
      {!isExpanded ? (
        renderCompactMode()
      ) : isLoading ? (
        renderLoading()
      ) : !analysisData ? (
        renderEmptyExpandedMode()
      ) : (
        renderAnalysisContent()
      )}
    </>
  );
});

PrognosisAnalysis.displayName = 'PrognosisAnalysis';

export default PrognosisAnalysis;