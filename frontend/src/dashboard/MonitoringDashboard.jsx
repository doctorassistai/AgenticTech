import React, { useState, useEffect } from "react";
import {
  Home, LogOut, Calendar, Activity, FileText, Users,
  ChevronRight, Bed, UserPlus, Settings, Menu, X,
  MessageCircle, Notebook, ChevronDown, ChevronUp,
  Hospital, User, Stethoscope
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matching doctorassist.ai website) ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStr: "#000000",
  accent: "#000000",
};

/* ─── INLINE STYLES ─── */
const S = {
  layout: {
    display: "flex",
    minHeight: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
  },
  main: {
    flex: 1,
    marginLeft: 0,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },
  topBar: {
    position: "sticky",
    top: 0,
    background: T.bg,
    borderBottom: `1px solid ${T.border}`,
    padding: "0.875rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 100,
  },
  topBarTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
  },
  body: {
    padding: "2rem",
    flex: 1,
  },
  pageLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },
  pageTitle: {
    fontSize: "1.4rem",
    fontWeight: 300,
    letterSpacing: "-0.02em",
    color: T.text,
    marginBottom: "1.5rem",
  },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(4, 1fr)",
    gap: "1px",
    border: `1px solid ${T.border}`,
    marginBottom: "2rem",
    background: T.border,
  },
  statCell: {
    background: T.bg,
    padding: "1.25rem 1.5rem",
  },
  statNum: {
    fontSize: "1.8rem",
    fontWeight: 300,
    letterSpacing: "-0.04em",
    color: T.text,
    margin: 0,
    lineHeight: 1,
  },
  statLabel: {
    fontSize: "0.65rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    marginTop: "0.35rem",
    display: "block",
  },
  card: {
    border: `1px solid ${T.border}`,
    marginBottom: "1rem",
    background: T.bg,
  },
  cardHeader: {
    padding: "1rem 1.5rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    cursor: "pointer",
  },
  cardTitle: {
    fontSize: "0.85rem",
    fontWeight: 500,
    color: T.text,
    margin: 0,
    display: "flex",
    alignItems: "center",
    gap: "8px",
  },
  cardSubtitle: {
    fontSize: "0.7rem",
    color: T.textMuted,
    marginTop: "4px",
  },
  cardContent: {
    padding: "1.5rem",
  },
  tabs: {
    display: "flex",
    borderBottom: `1px solid ${T.border}`,
    marginBottom: "1.5rem",
  },
  tab: {
    padding: "0.5rem 1.25rem",
    fontSize: "0.75rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    cursor: "pointer",
    borderBottom: "2px solid transparent",
    transition: "all 0.15s",
  },
  tabActive: {
    color: T.text,
    borderBottomColor: T.accent,
  },
  tableWrap: { overflowX: "auto", WebkitOverflowScrolling: "touch" },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    minWidth: "500px",
  },
  th: {
    textAlign: "left",
    padding: "0.65rem 1rem",
    fontSize: "0.62rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
    background: T.bgAlt,
  },
  td: {
    padding: "0.75rem 1rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    borderBottom: `1px solid ${T.border}`,
    whiteSpace: "nowrap",
  },
  badge: {
    padding: "0.2rem 0.5rem",
    fontSize: "0.6rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
  },
  loading: {
    padding: "2rem",
    textAlign: "center",
    fontSize: "0.78rem",
    color: T.textMuted,
  },
  emptyState: {
    padding: "2rem",
    textAlign: "center",
    fontSize: "0.78rem",
    color: T.textMuted,
  },
  actionBtn: {
    padding: "0.3rem 0.75rem",
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.65rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
    textDecoration: "none",
    display: "inline-block",
    textAlign: "center",
    letterSpacing: "0.05em",
  },
};

function MonitoringDashboard() {
  const [hospitals, setHospitals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedHospital, setExpandedHospital] = useState(null);
  const [doctorsData, setDoctorsData] = useState({});
  const [appointmentsData, setAppointmentsData] = useState({});
  const [patientDetailsData, setPatientDetailsData] = useState({});
  const [loadingDoctors, setLoadingDoctors] = useState({});
  const [loadingAppointments, setLoadingAppointments] = useState({});
  const [loadingPatientDetails, setLoadingPatientDetails] = useState({});
  const [activeTab, setActiveTab] = useState({});

  // Fetch hospitals on load
  useEffect(() => {
    const fetchHospitals = async () => {
      try {
        setLoading(true);
        const response = await fetch(`${API_BASE_URL}hms/users/data/context/hospital/endswith-inst`);
        const data = await response.json();
        setHospitals(Array.isArray(data) ? data : []);
      } catch (error) {
        console.error("Error fetching hospitals:", error);
        setHospitals([]);
      } finally {
        setLoading(false);
      }
    };
    fetchHospitals();
  }, []);

  // Fetch doctors from the new endpoint for all hospitals
  useEffect(() => {
    const fetchAllDoctors = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}hms/users/data/context/doctors/endswith-dra`);
        const data = await response.json();
        const doctorsList = Array.isArray(data) ? data : [];
        
        // Group doctors by hospital_id
        const groupedDoctors = {};
        doctorsList.forEach(doctor => {
          const hospitalKey = doctor.hospital_id;
          if (hospitalKey) {
            if (!groupedDoctors[hospitalKey]) {
              groupedDoctors[hospitalKey] = [];
            }
            groupedDoctors[hospitalKey].push(doctor);
          }
        });
        
        setDoctorsData(groupedDoctors);
      } catch (error) {
        console.error("Error fetching doctors:", error);
      }
    };
    
    fetchAllDoctors();
  }, []);

  // Fetch patient details for a specific patient
  // Fetch patient details for a specific patient
const fetchPatientDetails = async (patientId) => {
  if (patientDetailsData[patientId]) return; // Already loaded
  
  setLoadingPatientDetails(prev => ({ ...prev, [patientId]: true }));
  try {
    const response = await fetch(`${API_BASE_URL}hms/users/patients/patient/${patientId}`);
    const data = await response.json();
    // Handle the nested response structure
    const patientDetails = data.status === "success" ? data.data : data;
    setPatientDetailsData(prev => ({ ...prev, [patientId]: patientDetails }));
  } catch (error) {
    console.error("Error fetching patient details:", error);
    setPatientDetailsData(prev => ({ ...prev, [patientId]: null }));
  } finally {
    setLoadingPatientDetails(prev => ({ ...prev, [patientId]: false }));
  }
};

  // Fetch appointments for a specific hospital
  const fetchAppointments = async (sysUserId) => {
    if (appointmentsData[sysUserId]) return; // Already loaded
    
    setLoadingAppointments(prev => ({ ...prev, [sysUserId]: true }));
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/patients/hospital/${sysUserId}/appointments`);
      const data = await response.json();
      console.log("Fetched appointments for hospital", sysUserId, data);
      const appointments = data.status === "success" ? (data.appointments || []) : (Array.isArray(data) ? data : []);
      setAppointmentsData(prev => ({ ...prev, [sysUserId]: appointments }));
      
      // Fetch patient details for each appointment
      appointments.forEach(appointment => {
        if (appointment.sys_user_id) {
          fetchPatientDetails(appointment.sys_user_id, appointment.sys_user_id);
        }
      });
    } catch (error) {
      console.error("Error fetching appointments:", error);
      setAppointmentsData(prev => ({ ...prev, [sysUserId]: [] }));
    } finally {
      setLoadingAppointments(prev => ({ ...prev, [sysUserId]: false }));
    }
  };

  // Handle hospital expand/collapse
  const handleToggleHospital = (hospital) => {
    if (expandedHospital === hospital.sys_user_id) {
      setExpandedHospital(null);
    } else {
      setExpandedHospital(hospital.sys_user_id);
      // Initialize active tab for this hospital if not exists
      if (!activeTab[hospital.sys_user_id]) {
        setActiveTab(prev => ({ ...prev, [hospital.sys_user_id]: "doctors" }));
      }
      // Fetch appointments for this hospital
      fetchAppointments(hospital.sys_user_id);
    }
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-IN", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  };

  // Calculate age from DOB
  const calcAge = (dob) => {
    if (!dob) return "N/A";
    const d = new Date(dob);
    const now = new Date();
    let age = now.getFullYear() - d.getFullYear();
    if (now.getMonth() - d.getMonth() < 0 || 
        (now.getMonth() === d.getMonth() && now.getDate() < d.getDate())) {
      age--;
    }
    return age;
  };

  // Get patient name from patient details
  const getPatientName = (patientId) => {
    const patientDetails = patientDetailsData[patientId];
    if (!patientDetails) return "Loading...";
    return patientDetails.name || patientDetails.patient_name || "N/A";
  };

  // Get patient phone from patient details
  const getPatientPhone = (patientId) => {
    const patientDetails = patientDetailsData[patientId];
    if (!patientDetails) return "Loading...";
    return patientDetails.phone_number || patientDetails.mobile || "—";
  };

  // Get patient age from patient details
  const getPatientAge = (patientId) => {
    const patientDetails = patientDetailsData[patientId];
    if (!patientDetails) return "Loading...";
    return calcAge(patientDetails.dob || patientDetails.date_of_birth);
  };

  // Calculate statistics
  const totalHospitals = hospitals.length;
  const totalDoctors = Object.values(doctorsData).flat().length;
  const totalAppointments = Object.values(appointmentsData).flat().length;

  if (loading) {
    return (
      <div style={S.layout}>
        <main style={S.main}>
          <div style={S.topBar}>
            <span style={S.topBarTitle}>Monitoring Dashboard</span>
          </div>
          <div style={S.body}>
            <div style={S.loading}>Loading hospitals data...</div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .da-stat-cell:hover { background: ${T.bgAlt} !important; }
        .da-tbl-row:hover td { background: ${T.bgAlt} !important; }
        .da-tab:hover { color: ${T.text} !important; }
        .da-action-btn:hover { background: transparent !important; color: ${T.text} !important; }
        @media (max-width: 767px) {
          .da-stats-grid { grid-template-columns: repeat(2, 1fr) !important; }
          .da-body { padding: 1rem !important; }
        }
        @media (min-width: 768px) {
          .da-stats-grid { grid-template-columns: repeat(4, 1fr) !important; }
        }
      `}</style>

      <main style={S.main}>
        {/* Top Bar */}
        <div style={S.topBar}>
          <span style={S.topBarTitle}>Monitoring Dashboard</span>
        </div>

        {/* Main Content */}
        <div className="da-body" style={S.body}>
          <span style={S.pageLabel}>Healthcare Network</span>
          <h1 style={S.pageTitle}>Hospital & Patient Monitoring</h1>

          {/* Stats Grid */}
          <div className="da-stats-grid" style={S.statsGrid}>
            <div className="da-stat-cell" style={S.statCell}>
              <span style={S.statLabel}>Total Hospitals</span>
              <p style={S.statNum}>{totalHospitals}</p>
            </div>
            <div className="da-stat-cell" style={S.statCell}>
              <span style={S.statLabel}>Total Doctors</span>
              <p style={S.statNum}>{totalDoctors}</p>
            </div>
            <div className="da-stat-cell" style={S.statCell}>
              <span style={S.statLabel}>Total Appointments</span>
              <p style={S.statNum}>{totalAppointments}</p>
            </div>
            <div className="da-stat-cell" style={S.statCell}>
              <span style={S.statLabel}>Active Institutions</span>
              <p style={S.statNum}>{hospitals.filter(h => h.hospital_user_type === "da_user").length}</p>
            </div>
          </div>

          {/* Hospitals List */}
          <div>
            {hospitals.length === 0 ? (
              <div style={S.emptyState}>No hospitals found</div>
            ) : (
              hospitals.map((hospital) => (
                <div key={hospital._id} style={S.card}>
                  {/* Card Header - Click to Expand */}
                  <div 
                    style={S.cardHeader}
                    onClick={() => handleToggleHospital(hospital)}
                    className="da-card-header"
                  >
                    <div>
                      <div style={S.cardTitle}>
                        <Hospital size={16} />
                        <span>{hospital.name}</span>
                        {expandedHospital === hospital.sys_user_id ? (
                          <ChevronUp size={14} style={{ marginLeft: "8px", color: T.textMuted }} />
                        ) : (
                          <ChevronDown size={14} style={{ marginLeft: "8px", color: T.textMuted }} />
                        )}
                      </div>
                      <div style={S.cardSubtitle}>
                        Username: {hospital.username} | ID: {hospital.hospital_id} | Created: {formatDate(hospital.created_at)}
                      </div>
                    </div>
                    <div style={{ fontSize: "0.7rem", color: T.textMuted }}>
                      {hospital.country_code} • {hospital.no_of_staff} staff • {hospital.no_of_beds} beds
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedHospital === hospital.sys_user_id && (
                    <div style={S.cardContent}>
                      {/* Tabs */}
                      <div style={S.tabs}>
                        <div
                          style={{
                            ...S.tab,
                            ...(activeTab[hospital.sys_user_id] === "doctors" ? S.tabActive : {}),
                          }}
                          className="da-tab"
                          onClick={() => setActiveTab(prev => ({ ...prev, [hospital.sys_user_id]: "doctors" }))}
                        >
                          <Stethoscope size={12} style={{ display: "inline", marginRight: "6px" }} />
                          Doctors
                        </div>
                        <div
                          style={{
                            ...S.tab,
                            ...(activeTab[hospital.sys_user_id] === "patients" ? S.tabActive : {}),
                          }}
                          className="da-tab"
                          onClick={() => setActiveTab(prev => ({ ...prev, [hospital.sys_user_id]: "patients" }))}
                        >
                          <Users size={12} style={{ display: "inline", marginRight: "6px" }} />
                          Patient Appointments
                        </div>
                      </div>

                      {/* Doctors Tab */}
                      {activeTab[hospital.sys_user_id] === "doctors" && (
                        <div>
                          {loadingDoctors[hospital.sys_user_id] ? (
                            <div style={S.loading}>Loading doctors...</div>
                          ) : !doctorsData[hospital.sys_user_id]?.length ? (
                            <div style={S.emptyState}>No doctors found for this hospital</div>
                          ) : (
                            <div style={S.tableWrap}>
                              <table style={S.table}>
                                <thead>
                                  <tr>
                                    <th style={S.th}>Doctor Name</th>
                                    <th style={S.th}>Specialization</th>
                                    <th style={S.th}>Email</th>
                                    <th style={S.th}>Phone</th>
                                    <th style={S.th}>Doctor ID</th>
                                    <th style={S.th}>Reg. Number</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {doctorsData[hospital.sys_user_id].map((doctor, idx) => (
                                    <tr key={doctor.sys_user_id || idx} className="da-tbl-row">
                                      <td style={S.td}>{doctor.name || "N/A"}</td>
                                      <td style={S.td}>
                                        <span style={S.badge}>
                                          {doctor.specialization || "General"}
                                        </span>
                                      </td>
                                      <td style={S.td}>{doctor.email || "—"}</td>
                                      <td style={S.td}>{doctor.phone_number || "—"}</td>
                                      <td style={S.td}>
                                        <span style={{ fontSize: "0.7rem", fontFamily: "monospace" }}>
                                          {doctor.doctor_id || doctor.sys_user_id?.slice(-8) || "—"}
                                        </span>
                                      </td>
                                      <td style={S.td}>{doctor.registeration_number || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Patients/Appointments Tab */}
                        {activeTab[hospital.sys_user_id] === "patients" && (
                        <div>
                            {loadingAppointments[hospital.sys_user_id] ? (
                            <div style={S.loading}>Loading appointments...</div>
                            ) : !appointmentsData[hospital.sys_user_id]?.length ? (
                            <div style={S.emptyState}>No patient appointments found for this hospital</div>
                            ) : (
                            <div style={S.tableWrap}>
                                <table style={S.table}>
                                <thead>
                                    <tr>
                                    <th style={S.th}>Patient Name</th>
                                    <th style={S.th}>Age</th>
                                    <th style={S.th}>Phone</th>
                                    <th style={S.th}>Doctor Name</th>
                                    <th style={S.th}>Department</th>
                                    <th style={S.th}>Date</th>
                                    <th style={S.th}>Visit Type</th>
                                    <th style={S.th}>Chief Complaint</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {appointmentsData[hospital.sys_user_id].map((appt, idx) => {
                                    const patientId = appt.sys_user_id;
                                    const patientDetails = patientDetailsData[patientId];
                                    const isLoadingPatient = loadingPatientDetails[patientId];
                                    
                                    // Extract patient information from the response structure
                                    const patientName = patientDetails?.demographics?.name || 
                                                        patientDetails?.name || 
                                                        patientDetails?.patient_name || 
                                                        "N/A";
                                    const patientAge = patientDetails?.demographics?.date_of_birth 
                                                        ? calcAge(patientDetails.demographics.date_of_birth)
                                                        : patientDetails?.date_of_birth 
                                                        ? calcAge(patientDetails.date_of_birth)
                                                        : "N/A";
                                    const patientPhone = patientDetails?.demographics?.phone_number || 
                                                        patientDetails?.auth?.phone_number ||
                                                        patientDetails?.phone_number || 
                                                        "—";
                                    
                                    return (
                                        <tr key={appt.sys_user_id || idx} className="da-tbl-row">
                                        <td style={S.td}>
                                            {isLoadingPatient ? "Loading..." : patientName}
                                        </td>
                                        <td style={S.td}>
                                            {isLoadingPatient ? "Loading..." : patientAge}
                                        </td>
                                        <td style={S.td}>
                                            {isLoadingPatient ? "Loading..." : patientPhone}
                                        </td>
                                        <td style={S.td}>{appt.doctor_name || "N/A"}</td>
                                        <td style={S.td}>{appt.department || "—"}</td>
                                        <td style={S.td}>{formatDate(appt.date)}</td>
                                        <td style={S.td}>
                                            <span style={S.badge}>
                                            {appt.visit_type || "OPD"}
                                            </span>
                                        </td>
                                        <td style={S.td}>
                                            {appt.chief_complaint ? (
                                            appt.chief_complaint.length > 40 
                                                ? `${appt.chief_complaint.substring(0, 40)}...` 
                                                : appt.chief_complaint
                                            ) : "—"}
                                        </td>
                                        </tr>
                                    );
                                    })}
                                </tbody>
                                </table>
                            </div>
                            )}
                        </div>
                        )}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default MonitoringDashboard;