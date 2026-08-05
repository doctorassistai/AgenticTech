import React, { useState, useEffect } from 'react';

const API_BASE_URL = 'https://doctorassist.ai/api';

export default function AmbulanceDashboard() {
  const [refreshing, setRefreshing] = useState(false);
  const [driverName, setDriverName] = useState('Loading...');
  const [activeTab, setActiveTab] = useState('activerequests');
  const [registeredPatients, setRegisteredPatients] = useState([]);
  const [activeRequests, setActiveRequests] = useState([]);
  const [assignedVehicle, setAssignedVehicle] = useState(null);

  useEffect(() => {
    checkAuth();
    loadRegisteredPatients();
    loadTodayPatients();
    loadDriverName();
    loadAssignedVehicle();
  }, []);

  const checkAuth = async () => {
    const userData = localStorage.getItem('user');
    if (!userData) {
      window.location.href = '/ambulance-login';
    }
  };

  const loadDriverName = () => {
    try {
      const userData = localStorage.getItem('user');
      if (userData) {
        const user = JSON.parse(userData);
        setDriverName(user.driver_name || user.username || 'Ambulance Driver');
      }
    } catch (error) {
      console.log('Error loading driver name:', error);
    }
  };

  const loadAssignedVehicle = () => {
    try {
      const vehicleData = localStorage.getItem('assigned_vehicle');
      if (vehicleData) {
        setAssignedVehicle(JSON.parse(vehicleData));
      }
    } catch (error) {
      console.log('Error loading assigned vehicle:', error);
    }
  };

  // Load patients assigned to this driver (ALL patients, not just today)
  const loadRegisteredPatients = async () => {
    try {
      const userData = localStorage.getItem('user');
      if (!userData) {
        setRegisteredPatients([]);
        return;
      }
      
      const user = JSON.parse(userData);
      const driverId = user.driver_id;
      
      if (!driverId) {
        console.log('No driver ID found in user data');
        setRegisteredPatients([]);
        return;
      }
      
      console.log(`Loading patients for driver ID: ${driverId}`);
      
      const response = await fetch(`${API_BASE_URL}/hms/users/emergencypatients/get_all_patients`);
      const data = await response.json();
      
      if (data.status === 'success' && data.patients) {
        // Filter patients where ambulance_driver exists and driver_id matches
        const vehicleData =
  localStorage.getItem('assigned_vehicle');

const vehicle =
  vehicleData ? JSON.parse(vehicleData) : {};

const assignedVehicleId =
  vehicle?.vehicleId;

const assignedPatients = data.patients.filter(patient =>

  patient.ambulance_driver &&

  patient.ambulance_driver.driver_id === driverId &&

  patient.ambulance_driver.ambulance_id === assignedVehicleId &&

  patient.status !== 'completed'
);
        setRegisteredPatients(assignedPatients);
        console.log(`Found ${assignedPatients.length} patients assigned to driver ${driverId}`);
      } else {
        setRegisteredPatients([]);
      }
    } catch (error) {
      console.error('Error loading assigned patients:', error);
      setRegisteredPatients([]);
    }
  };

  // Load today's patients assigned to this driver
const loadTodayPatients = async () => {
  try {
    const userData = localStorage.getItem('user');
    if (!userData) {
      setActiveRequests([]);
      return;
    }
    
    const user = JSON.parse(userData);
    const driverId = user.driver_id;
    
    if (!driverId) {
      setActiveRequests([]);
      return;
    }
    
    console.log(`Loading patients for driver ID: ${driverId}`);
    
    // Batch fetch all required data
    const [assignedRes, dismissedRes, declinedRes, acceptedRes, completedRes] = await Promise.all([
      fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/get-assigned-patients/${driverId}`),
      fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/get-dismissed-patients/${driverId}`),
      fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/get-declined-patients/${driverId}`),
      fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/get-all-accepted-patients`),
      fetch(`${API_BASE_URL}/hms/users/ambulance/ambulance/get-completed-incidents/${driverId}`),
    ]);
    
    const [assignedData, dismissedData, declinedData, acceptedData, completedData] = await Promise.all([
      assignedRes.json(),
      dismissedRes.json(),
      declinedRes.json(),
      acceptedRes.json(),
      completedRes.json(),
    ]);
    
    // Create exclusion sets
    const dismissedIds = new Set(
      dismissedData.status === 'success' && dismissedData.patients
        ? dismissedData.patients.map(p => p.patient_id)
        : []
    );
    
    const declinedIds = new Set(
      declinedData.status === 'success' && declinedData.patients
        ? declinedData.patients
            .filter(p => p.driver_id === driverId)
            .map(p => p.patient_id)
        : []
    );
    
    const otherAcceptedIds = new Set(
      acceptedData.status === 'success' && acceptedData.patients
        ? acceptedData.patients
            .filter(a => a.driver_id !== driverId)
            .map(a => a.patient_id)
        : []
    );
    
    const myAcceptedIds = new Set(
      acceptedData.status === 'success' && acceptedData.patients
        ? acceptedData.patients
            .filter(a => a.driver_id === driverId)
            .map(a => a.patient_id)
        : []
    );
    
    const completedIds = new Set(
      completedData.status === 'success' && completedData.incidents
        ? completedData.incidents.map(i => i.patient_id)
        : []
    );
    
    console.log('Filtering with:', {
      dismissed: [...dismissedIds],
      declined: [...declinedIds],
      otherAccepted: [...otherAcceptedIds],
      myAccepted: [...myAcceptedIds],
      completed: [...completedIds]
    });
    
    if (assignedData.status === 'success' && assignedData.patients) {
      const filteredPatients = assignedData.patients.filter(assignment => {
        const patientId = assignment.patient_id;
        
        // Remove if dismissed
        if (dismissedIds.has(patientId)) return false;
        
        // Remove if declined by this driver
        if (declinedIds.has(patientId)) return false;
        
        // Remove if completed
        if (completedIds.has(patientId)) return false;
        
        // Remove if accepted by other driver (optional - depends on your requirement)
        if (otherAcceptedIds.has(patientId)) return false;
        
        return true;
      });
      
      const formattedRequests = filteredPatients.map(assignment => ({
        id: assignment.patient_id,
        patient_id: assignment.patient_id,
        assignment_id: assignment.assignment_id,
        fullName: assignment.patient_data?.fullName || 'Unknown',
        patient_name: assignment.patient_data?.fullName || 'Unknown',
        age: assignment.patient_data?.age || '',
        gender: assignment.patient_data?.gender || '',
        phoneNumber: assignment.patient_data?.phoneNumber || '',
        address: assignment.patient_data?.address || '',
        pickup_location: assignment.patient_data?.accidentDetails?.location || 'Not specified',
        accidentDate: assignment.patient_data?.accidentDetails?.accidentDate,
        accidentTime: assignment.patient_data?.accidentDetails?.accidentTime,
        accidentType: assignment.patient_data?.accidentDetails?.accidentType,
        condition: assignment.patient_data?.accidentDetails?.condition,
        emergencyContact: assignment.patient_data?.emergencyContact,
        registrationDate: assignment.patient_data?.registrationDate,
        status: myAcceptedIds.has(assignment.patient_id) ? 'accepted' : assignment.status
      }));
      
      setActiveRequests(formattedRequests);
      console.log(`Found ${formattedRequests.length} active requests after filtering`);
    } else {
      setActiveRequests([]);
    }
  } catch (error) {
    console.error('Error loading patients:', error);
    setActiveRequests([]);
  }
};
  const onRefresh = async () => {
    setRefreshing(true);
    await loadRegisteredPatients();
    await loadTodayPatients();
    setTimeout(() => {
      setRefreshing(false);
    }, 500);
  };

  const handleLogout = async () => {
    if (window.confirm('Are you sure you want to logout?')) {
      localStorage.removeItem('access_token');
      localStorage.removeItem('user');
      window.location.href = '/ambulance-login';
    }
  };

  const handlePatientProfile = (patient) => {
    // Store the selected patient in localStorage to access in profile page
    localStorage.setItem('selected_patient', JSON.stringify(patient));
    window.location.href = `/ambulance-patient-profile?id=${patient.patient_id}`;
  };

  const stats = [
    { label: 'Active Requests', value: activeRequests.length.toString() },
    { label: 'Total Patients', value: registeredPatients.length.toString() },
  ];

  // CSS Styles
  const styles = {
    container: {
      minHeight: '100vh',
      backgroundColor: '#ffffff',
    },
    header: {
      padding: '20px',
      borderBottom: '1px solid #e0e0e0',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      backgroundColor: '#ffffff',
    },
    brandName: {
      fontSize: '18px',
      fontWeight: '600',
      color: '#000000',
      marginBottom: '4px',
      letterSpacing: '-0.3px',
    },
    pageLabel: {
      fontSize: '10px',
      textTransform: 'uppercase',
      letterSpacing: '1.8px',
      color: '#888888',
      marginBottom: '4px',
    },
    pageTitle: {
      fontSize: '22px',
      fontWeight: '300',
      letterSpacing: '-0.5px',
      color: '#000000',
      marginBottom: '4px',
    },
    driverStatus: {
      fontSize: '11px',
      color: '#4caf50',
    },
    logoutButton: {
      border: '1px solid #e0e0e0',
      padding: '8px 16px',
      cursor: 'pointer',
      backgroundColor: '#ffffff',
    },
    logoutButtonText: {
      fontSize: '12px',
      color: '#444444',
    },
    statsGrid: {
      display: 'flex',
      margin: '16px',
      border: '1px solid #e0e0e0',
    },
    statCell: {
      flex: 1,
      padding: '12px',
      textAlign: 'center',
      borderRight: '1px solid #e0e0e0',
    },
    statNum: {
      fontSize: '20px',
      fontWeight: '300',
      color: '#000000',
      marginBottom: '4px',
    },
    statLabel: {
      fontSize: '9px',
      textTransform: 'uppercase',
      letterSpacing: '1.2px',
      color: '#888888',
    },
    tabBar: {
      display: 'flex',
      borderBottom: '1px solid #e0e0e0',
      padding: '0 16px',
    },
    tab: {
      flex: 1,
      padding: '12px',
      textAlign: 'center',
      cursor: 'pointer',
      borderBottom: '2px solid transparent',
    },
    tabActive: {
      borderBottomColor: '#000000',
    },
    tabText: {
      fontSize: '11px',
      color: '#444444',
    },
    tabTextActive: {
      color: '#000000',
      fontWeight: '500',
    },
    content: {
      padding: '16px',
      maxHeight: 'calc(100vh - 250px)',
      overflowY: 'auto',
    },
    patientRequestCard: {
      border: '1px solid #e0e0e0',
      marginBottom: '16px',
      padding: '16px',
      backgroundColor: '#ffffff',
      cursor: 'pointer',
    },
    patientRequestHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px',
      paddingBottom: '8px',
      borderBottom: '1px solid #e0e0e0',
    },
    patientRequestId: {
      fontSize: '11px',
      color: '#888888',
    },
    patientRequestStatus: {
      fontSize: '10px',
      color: '#4caf50',
    },
    patientRequestName: {
      fontSize: '18px',
      fontWeight: '500',
      color: '#000000',
      marginBottom: '12px',
    },
    patientRequestDetails: {
      display: 'flex',
      gap: '16px',
      marginBottom: '12px',
    },
    detailRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '4px',
    },
    detailLabel: {
      fontSize: '12px',
      color: '#888888',
    },
    detailValue: {
      fontSize: '12px',
      color: '#444444',
      fontWeight: '500',
    },
    locationInfo: {
      marginBottom: '12px',
      paddingVertical: '8px',
      borderTop: '1px solid #e0e0e0',
    },
    locationText: {
      fontSize: '11px',
      color: '#444444',
    },
    accidentInfoRow: {
      display: 'flex',
      alignItems: 'center',
      marginBottom: '4px',
      gap: '6px',
    },
    accidentLabel: {
      fontSize: '10px',
      color: '#888888',
      width: '55px',
    },
    accidentValue: {
      fontSize: '11px',
      color: '#444444',
      flex: 1,
    },
    footerRow: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginTop: '12px',
      paddingTop: '12px',
      borderTop: '0.5px solid #e0e0e0',
    },
    registrationDate: {
      fontSize: '9px',
      color: '#888888',
    },
    clickableText: {
      fontSize: '10px',
      color: '#000000',
      textDecoration: 'underline',
    },
    emptyState: {
      padding: '40px',
      textAlign: 'center',
    },
    emptyStateText: {
      fontSize: '12px',
      color: '#888888',
      marginBottom: '16px',
    },
    emptyStateSubText: {
      fontSize: '11px',
      color: '#888888',
      marginBottom: '16px',
    },
    todayBadge: {
      backgroundColor: '#000000',
      padding: '8px 16px',
      marginBottom: '16px',
      textAlign: 'center',
    },
    todayBadgeText: {
      fontSize: '12px',
      color: '#ffffff',
    },
    refreshButton: {
      backgroundColor: '#f5f5f5',
      border: '1px solid #e0e0e0',
      padding: '8px 16px',
      cursor: 'pointer',
      marginBottom: '16px',
    },
    patientCard: {
      border: '1px solid #e0e0e0',
      marginBottom: '16px',
      padding: '16px',
      backgroundColor: '#ffffff',
      cursor: 'pointer',
    },
    patientCardHeader: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: '12px',
      paddingBottom: '8px',
      borderBottom: '1px solid #e0e0e0',
    },
    patientId: {
      fontSize: '11px',
      color: '#888888',
    },
    patientStatus: {
      fontSize: '10px',
      color: '#4caf50',
    },
    patientName: {
      fontSize: '16px',
      fontWeight: '400',
      color: '#000000',
      marginBottom: '8px',
    },
    patientDetails: {
      display: 'flex',
      gap: '16px',
      marginBottom: '8px',
    },
    patientDetail: {
      fontSize: '12px',
      color: '#444444',
    },
    patientContact: {
      fontSize: '12px',
      color: '#444444',
      marginBottom: '4px',
    },
    patientAddress: {
      fontSize: '12px',
      color: '#444444',
      marginBottom: '8px',
    },
  };

  return (
    <>
      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div style={styles.container}>
           {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.brandName}>DoctorAssist.Ai</h1>
          <div style={styles.pageLabel}>Ambulance Service</div>
          <div style={styles.pageTitle}>Emergency Crew: {driverName}</div>
          <div style={styles.driverStatus}>● Online</div>
        </div>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button 
            onClick={onRefresh} 
            disabled={refreshing}
            style={{
              border: '1px solid #e0e0e0',
              padding: '8px 16px',
              cursor: refreshing ? 'not-allowed' : 'pointer',
              backgroundColor: refreshing ? '#f5f5f5' : '#ffffff',
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
            }}
          >
            {refreshing ? (
              <>
                <span style={{
                  display: 'inline-block',
                  width: '14px',
                  height: '14px',
                  border: '2px solid #ccc',
                  borderTopColor: '#000',
                  borderRadius: '50%',
                  animation: 'spin 0.8s linear infinite',
                }} />
                <span style={{ fontSize: '12px', color: '#999' }}>Refreshing...</span>
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M23 4v6h-6" />
                  <path d="M1 20v-6h6" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10" />
                  <path d="M20.49 15a9 9 0 0 1-14.85 3.36L1 14" />
                </svg>
                <span style={styles.logoutButtonText}>Refresh</span>
              </>
            )}
          </button>
          <button style={styles.logoutButton} onClick={handleLogout}>
            <span style={styles.logoutButtonText}>Logout</span>
          </button>
        </div>
      </div>

      {/* Stats Grid */}
      <div style={styles.statsGrid}>
        {stats.map((stat, index) => (
          <div key={index} style={styles.statCell}>
            <div style={styles.statNum}>{stat.value}</div>
            <div style={styles.statLabel}>{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Tab Navigation */}
      <div style={styles.tabBar}>
        <div
          style={{ ...styles.tab, ...(activeTab === 'activerequests' ? styles.tabActive : {}) }}
          onClick={() => setActiveTab('activerequests')}
        >
          <span style={{ ...styles.tabText, ...(activeTab === 'activerequests' ? styles.tabTextActive : {}) }}>
            Active Requests
          </span>
        </div>
        
      </div>

   

      {/* Content */}
      <div style={styles.content}>
        {activeTab === 'activerequests' && (
          <>
            {activeRequests.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={styles.emptyStateText}>No active requests available</div>
                <div style={styles.emptyStateSubText}>
                  Patients with today's accident date ({new Date().toISOString().split('T')[0]}) will appear here
                </div>
              </div>
            ) : (
              <>
                <div style={styles.todayBadge}>
                  <span style={styles.todayBadgeText}>
                    📅 Today's Accident Reports ({new Date().toISOString().split('T')[0]})
                  </span>
                </div>
                {activeRequests.map((patient, index) => (
                  <div 
                    key={patient.id || index} 
                    style={styles.patientRequestCard}
                    onClick={() => handlePatientProfile(patient)}
                    
                  >
                    <div style={styles.patientRequestHeader}>
                      <span style={styles.patientRequestId}>ID: {patient.id}</span>
                      <span style={styles.patientRequestStatus}>● Active</span>
                    </div>
                    
                    <div style={styles.patientRequestName}>{patient.patient_name}</div>
                    
                    <div style={styles.patientRequestDetails}>
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Age:</span>
                        <span style={styles.detailValue}>{patient.age}</span>
                      </div>
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>Gender:</span>
                        <span style={styles.detailValue}>{patient.gender}</span>
                      </div>
                      <div style={styles.detailRow}>
                        <span style={styles.detailLabel}>📞</span>
                        <span style={styles.detailValue}>{patient.phoneNumber || 'N/A'}</span>
                      </div>
                    </div>

                    <div style={styles.locationInfo}>
                      <span style={styles.locationText}>
                        📍 {patient.pickup_location || 'Not specified'}
                      </span>
                    </div>

                    <div style={styles.accidentInfoRow}>
                      <span style={styles.accidentLabel}>Accident:</span>
                      <span style={styles.accidentValue}>
                        {patient.accidentDate || 'N/A'} {patient.accidentTime ? `at ${patient.accidentTime}` : ''}
                      </span>
                    </div>

                    <div style={styles.accidentInfoRow}>
                      <span style={styles.accidentLabel}>Type:</span>
                      <span style={styles.accidentValue}>{patient.accidentType || 'N/A'}</span>
                    </div>

                    <div style={styles.accidentInfoRow}>
                      <span style={styles.accidentLabel}>Condition:</span>
                      <span style={styles.accidentValue}>{patient.condition || 'N/A'}</span>
                    </div>

                    <div style={styles.footerRow}>
                      <span style={styles.registrationDate}>
                        📅 {patient.registrationDate ? new Date(patient.registrationDate).toLocaleDateString() : 'N/A'}
                      </span>
                  <span
  style={styles.clickableText}
  onClick={() => handlePatientProfile(patient)}
>
  View →
</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}

        {activeTab === 'registeredpatients' && (
          <>
            {registeredPatients.length === 0 ? (
              <div style={styles.emptyState}>
                <div style={styles.emptyStateText}>No registered patients found</div>
              </div>
            ) : (
              <>
                <div style={styles.todayBadge}>
                  <span style={styles.todayBadgeText}>
                    📋 All Registered Patients ({registeredPatients.length} total)
                  </span>
                </div>
                {registeredPatients.map((patient, index) => (
                  <div 
                    key={patient.patient_id || index} 
                    style={styles.patientCard}
                    onClick={() => handlePatientProfile(patient)}
                  >
                    <div style={styles.patientCardHeader}>
                      <span style={styles.patientId}>ID: {patient.patient_id}</span>
                      <span style={styles.patientStatus}>● {patient.status || 'registered'}</span>
                    </div>
                    <div style={styles.patientName}>{patient.fullName || 'Unknown'}</div>
                    <div style={styles.patientDetails}>
                      <span style={styles.patientDetail}>Age: {patient.age}</span>
                      <span style={styles.patientDetail}>Gender: {patient.gender}</span>
                    </div>
                    {patient.phoneNumber && (
                      <div style={styles.patientContact}>📞 {patient.phoneNumber}</div>
                    )}
                    {patient.address && (
                      <div style={styles.patientAddress}>📍 {patient.address}</div>
                    )}
                    <div style={styles.footerRow}>
                      <span style={styles.registrationDate}>
                        Registered: {patient.registrationDate ? new Date(patient.registrationDate).toLocaleDateString() : 'N/A'}
                      </span>
                      <span style={styles.clickableText}>View →</span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
    </>
  );
}