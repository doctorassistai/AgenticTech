import React, { useState, useEffect, useRef } from 'react';

const API_BASE_URL = 'https://doctorassist.ai/api';

const NewPatientToast = ({ alerts, onDismiss, onView }) => {
  if (!alerts.length) return null;
  return (
    <div style={{ position: 'fixed', top: 20, right: 20, zIndex: 9999, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {alerts.map((p, i) => (
        <div key={p.patient_id + i} style={{
          background: '#1a1a2e', color: '#fff', padding: '14px 18px', borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.28)', display: 'flex', alignItems: 'center', gap: 12,
          width: 320, border: '1px solid #333',
        }}>
          <div style={{ fontSize: 20 }}>🆕</div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 3 }}>New Patient Added</div>
            <div style={{ fontSize: 12, color: '#ccc', marginBottom: 6 }}>{p.fullName} · {p.patient_id}</div>
            <button onClick={() => onView(p)} style={{
              background: '#fff', color: '#000', border: 'none', padding: '5px 12px',
              borderRadius: 4, fontSize: 11, fontWeight: 700, cursor: 'pointer', fontFamily: "'DM Sans', sans-serif",
            }}>View →</button>
          </div>
          <button onClick={() => onDismiss(i)} style={{ background: 'none', border: 'none', color: '#aaa', cursor: 'pointer', fontSize: 16, alignSelf: 'flex-start' }}>✕</button>
        </div>
      ))}
    </div>
  );
};

export default function DoctorEmergencyDashboard() {
    const [refreshing, setRefreshing]               = useState(false);
  const [doctorName, setDoctorName]               = useState('');
  const [searchTerm, setSearchTerm]               = useState('');
  const [dateFilter, setDateFilter] = useState('today');
const [customDate, setCustomDate] = useState('');
  const [allPatients, setAllPatients]             = useState([]);
  const [filteredPatients, setFilteredPatients]   = useState([]);
  const [loading, setLoading]                     = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
const [completedStatuses, setCompletedStatuses] = useState({});
const [todayCount, setTodayCount] = useState(0);
  const knownPatientIdsRef = useRef(null); // null = baseline not yet set
  const [newPatientAlerts, setNewPatientAlerts] = useState([]);
  // ── Auth guard ──
    const completedStatusesRef = useRef({});
  useEffect(() => {
    completedStatusesRef.current = completedStatuses;
  }, [completedStatuses]);
// ── Auth guard ──
useEffect(() => {

  // ✅ CHECK DOCTORASSIST USER FIRST (NOT Zenzo token)
  const userData = localStorage.getItem('user');
  
  console.log('USER DATA:', userData);

  // ❌ NO USER DATA → GO LOGIN
  if (!userData) {
    window.location.href = '/ambulance-login';
    return;
  }

  try {
    const user = JSON.parse(userData);
    
    // Check if user is logged in and has doctor role
    if (!user.isLoggedIn || user.role !== 'doctor') {
      console.log('Invalid user role or not logged in');
      window.location.href = '/ambulance-login';
      return;
    }
    
    setDoctorName(user.doctor_name || user.username || 'Doctor');
    
  } catch (e) {
    console.error('Error parsing user data:', e);
    window.location.href = '/ambulance-login';
    return;
  }

  // ✅ Zenzo token is OPTIONAL - log but don't redirect
  const zenzoToken = localStorage.getItem('zenzo_doctor_access_token');

  
  if (!zenzoToken) {
    console.log('⚠️ No Zenzo token found - RPM monitor will be unavailable, but dashboard works fine');
    // DO NOT REDIRECT - just continue
  }

  // ✅ LOAD DATA (always load even without Zenzo)
  fetchPatients();

}, []);
const buildDateQuery = (filter, custom) => {
    const ist = new Date(); // fine for date-only comparison
    const todayStr = ist.toLocaleDateString('en-CA');
    if (filter === 'today') return `date=${todayStr}`;
    if (filter === 'yesterday') {
      const y = new Date(); y.setDate(y.getDate() - 1);
      return `date=${y.toLocaleDateString('en-CA')}`;
    }
    if (filter === 'week') {
      const weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 6);
      return `start_date=${weekAgo.toLocaleDateString('en-CA')}&end_date=${todayStr}`;
    }
    if (filter === 'custom' && custom) return `date=${custom}`;
    return `date=${todayStr}`;
  };

  // ── Fetch all patients ──
  const fetchPatients = async () => {
    setLoading(true);
    try {
      const response = await fetch(
        `${API_BASE_URL}/hms/users/emergencypatients/get_today_patients-with-timestamp-and-withotut-limit?${buildDateQuery(dateFilter, customDate)}`
      );
      const result = await response.json();

      if (result.status === 'success') {
        setAllPatients(result.patients);

        // ── New patient detection ──
        const currentIds = new Set(result.patients.map((p) => p.patient_id));
        if (knownPatientIdsRef.current === null) {
          knownPatientIdsRef.current = currentIds;
        } else {
          const newOnes = result.patients.filter((p) => !knownPatientIdsRef.current.has(p.patient_id));
          if (newOnes.length > 0) {
            setNewPatientAlerts((prev) => [...prev, ...newOnes]);
          }
          knownPatientIdsRef.current = currentIds;
        }

       
        const prevStatuses = completedStatusesRef.current;
        const idsToCheck = result.patients
          .map((p) => p.patient_id)
          .filter((id) => prevStatuses[id] !== "completed");

        let statusMap = { ...prevStatuses };

        if (idsToCheck.length > 0) {
          try {
            const response = await fetch(
              `${API_BASE_URL}/hms/users/ambulance/ambulance/get-completed-incidents-batch`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ patient_ids: idsToCheck }),
              }
            );
            const data = await response.json();
            if (data.status === "success" && data.statuses) {
              statusMap = { ...statusMap, ...data.statuses };
            }
          } catch (error) {
            console.log("Batch status fetch error:", error);
            idsToCheck.forEach((id) => {
              if (!statusMap[id]) statusMap[id] = "active";
            });
          }
        }

        // Drop entries for patients no longer in the list
        // Drop entries for patients no longer in the list
        Object.keys(statusMap).forEach((id) => {
          if (!currentIds.has(id)) delete statusMap[id];
        });

        setCompletedStatuses(statusMap);
      }
    } catch (error) {
      console.error('Error fetching patients:', error);
      alert('Failed to load patients');
    } finally {
      setLoading(false);
    }
  };
  const fetchTodayCountOnly = async () => {
    try {
      const todayStr = new Date().toLocaleDateString('en-CA');
      const response = await fetch(
        `${API_BASE_URL}/hms/users/emergencypatients/get_today_patients-with-timestamp-and-withotut-limit?date=${todayStr}`
      );
      const result = await response.json();
      if (result.status === 'success') {
        setTodayCount(result.total ?? (result.patients || []).length);
      }
    } catch (error) {
      console.error('Error fetching today count:', error);
    }
  };
// Auto-refresh patient list every 20 seconds
useEffect(() => {
  const interval = setInterval(() => {
    fetchPatients();
  }, 20000); // adjust interval as needed
  return () => clearInterval(interval);
}, []);
useEffect(() => {
  fetchPatients();
}, [dateFilter, customDate]);

  const handleRefresh = async () => {
        setRefreshing(true);
    await fetchPatients();
    setRefreshing(false);
  };

  // ── Logout ──
  const handleLogout = () => {
    const confirmed = window.confirm('Are you sure you want to logout?');
    if (confirmed) {
      localStorage.removeItem('user');
      localStorage.removeItem('access_token');
      localStorage.removeItem('zenzo_doctor_access_token');
      localStorage.removeItem('zenzo_doctor_data');
      localStorage.removeItem('zenzo_doctor_mongo_id');
      localStorage.removeItem('zenzo_doctor_organization_id');
      localStorage.removeItem('zenzo_doctor_department_id');
      localStorage.removeItem('zenzo_doctor_email');
      window.location.href = '/ambulance-login';
    }
  };

  // ── Search ──
  const handleSearch = (text) => {
    setSearchTerm(text);
    if (text.length >= 1) {
      const filtered = allPatients.filter(
        (p) =>
          p.patient_id.toLowerCase().includes(text.toLowerCase()) ||
          p.fullName.toLowerCase().includes(text.toLowerCase()) ||
          (p.phoneNumber && p.phoneNumber.includes(text)) ||
          (p.age && p.age.toString().includes(text)) ||
          (p.accidentDetails?.accidentTime &&
            p.accidentDetails.accidentTime.toLowerCase().includes(text.toLowerCase())) ||
          (p.accidentDetails?.condition &&
            p.accidentDetails.condition.toLowerCase().includes(text.toLowerCase()))
      );
      setFilteredPatients(filtered);
      setShowSearchResults(true);
    } else {
      setFilteredPatients([]);
      setShowSearchResults(false);
    }
  };

  const clearSearch = () => {
    setSearchTerm('');
    setFilteredPatients([]);
    setShowSearchResults(false);
  };

  const navigateToPatientProfile = (patient) => {
    // Store selected patient and navigate
    localStorage.setItem('selected_patient', JSON.stringify(patient));
    window.location.href = `/patient-profile-emergency/${patient.patient_id}`;
  };

  const totalPatients      = allPatients.length;
  const getDateStr = (d) => d.toISOString().split('T')[0];

const todayAccidentPatients = allPatients; // backend already filtered by dateFilter/customDate
const todayAccidentsCount = todayAccidentPatients.length;

const dateFilterLabel = {
  today: "Today",
  yesterday: "Yesterday",
  week: "Last 7 Days",
  custom: customDate ? new Date(customDate).toLocaleDateString() : "Custom Date",
}[dateFilter];

  const TABLE_HEADERS = [
    'Patient ID', 'Patient Name', 'Phone', 'Age',
    'Incident Time', 'Condition', 'Actions', 'Status'
  ];

  const PatientRow = ({ patient }) => (
    <tr style={s.tr}>
      <td style={s.td}>{patient.patient_id}</td>
      <td style={s.td}>
        <button style={s.linkBtn} onClick={() => navigateToPatientProfile(patient)}>
          {patient.fullName}
        </button>
      </td>
      <td style={s.td}>{patient.phoneNumber || 'N/A'}</td>
      <td style={s.td}>{patient.age}</td>
      <td style={s.td}>{patient.accidentDetails?.accidentTime || 'N/A'}</td>
      <td style={s.td}>{patient.accidentDetails?.condition || 'N/A'}</td>
      <td style={s.td}>
        <button style={s.actionBtn} onClick={() => navigateToPatientProfile(patient)}>
          View →
        </button>
      </td>
    </tr>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display:ital@0;1&family=DM+Sans:wght@300;400;500;600&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          font-family: 'DM Sans', sans-serif;
          background: #ffffff;
          color: #000000;
        }

        /* ── Table scrollable wrapper ── */
        .dd-table-scroll {
          overflow-x: auto;
          width: 100%;
        }

        table {
          border-collapse: collapse;
          width: 100%;
          min-width: 780px;
        }

        thead tr {
          background: #fafafa;
          border-bottom: 1px solid #e0e0e0;
        }

        thead th {
          padding: 10px 14px;
          font-size: 10px;
          font-weight: 400;
          text-transform: uppercase;
          letter-spacing: 1.2px;
          color: #888888;
          text-align: left;
          white-space: nowrap;
        }

        tbody tr {
          border-bottom: 1px solid #e0e0e0;
          transition: background 0.1s;
        }

        tbody tr:hover { background: #fafafa; }

        tbody td {
          padding: 12px 14px;
          font-size: 12px;
          color: #444444;
          white-space: nowrap;
        }

        /* Search input */
        .dd-search-wrap {
          position: relative;
          display: flex;
          align-items: center;
        }

        .dd-search-input {
          width: 100%;
          padding: 10px 40px 10px 14px;
          border: 1px solid #e0e0e0;
          background: #ffffff;
          font-size: 12px;
          font-family: 'DM Sans', sans-serif;
          color: #000000;
          outline: none;
          border-radius: 0;
          transition: border-color 0.2s;
        }

        .dd-search-input::placeholder { color: #aaaaaa; }
        .dd-search-input:focus { border-color: #000000; }

        .dd-search-clear {
          position: absolute;
          right: 10px;
          background: none;
          border: none;
          cursor: pointer;
          font-size: 16px;
          color: #888888;
          line-height: 1;
          padding: 4px;
        }
        .dd-search-clear:hover { color: #000000; }

        /* Stat cells */
        .dd-stat-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          border: 1px solid #e0e0e0;
          border-right: none;
          border-bottom: none;
        }

        .dd-stat-cell {
          padding: 18px 20px;
          border-right: 1px solid #e0e0e0;
          border-bottom: 1px solid #e0e0e0;
        }

        /* Section card */
        .dd-section {
          border: 1px solid #e0e0e0;
        }

        .dd-section-head {
          padding: 14px 16px;
          border-bottom: 1px solid #e0e0e0;
          background: #fafafa;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        /* Refresh button */
        .dd-refresh-btn {
          display: flex;
          align-items: center;
          gap: 6px;
          background: none;
          border: 1px solid #e0e0e0;
          padding: 6px 14px;
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          color: #444444;
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
          border-radius: 0;
        }
        .dd-refresh-btn:hover { border-color: #000000; color: #000000; }
        .dd-refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

        .dd-refresh-spinner {
          width: 12px;
          height: 12px;
          border: 1.5px solid rgba(0,0,0,0.2);
          border-top-color: #000000;
          border-radius: 50%;
          animation: dd-spin 0.6s linear infinite;
        }

        @keyframes dd-spin { to { transform: rotate(360deg); } }

        /* Logout */
        .dd-logout-btn {
          border: 1px solid #e0e0e0;
          background: none;
          padding: 8px 18px;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          color: #444444;
          cursor: pointer;
          transition: border-color 0.2s, color 0.2s;
          border-radius: 0;
        }
        .dd-logout-btn:hover { border-color: #000000; color: #000000; }

        /* Clear results */
        .dd-clear-btn {
          background: #e0e0e0;
          border: none;
          padding: 5px 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 10px;
          color: #444444;
          cursor: pointer;
          border-radius: 0;
          transition: background 0.15s;
        }
        .dd-clear-btn:hover { background: #d0d0d0; }

        /* Action button inside table */
        .dd-action-btn {
          background: #000000;
          color: #ffffff;
          border: none;
          padding: 5px 12px;
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          cursor: pointer;
          border-radius: 0;
          transition: background 0.15s;
          white-space: nowrap;
        }
        .dd-action-btn:hover { background: #222222; }

        /* Patient name link */
        .dd-link-btn {
          background: none;
          border: none;
          padding: 0;
          font-family: 'DM Sans', sans-serif;
          font-size: 12px;
          color: #000000;
          text-decoration: underline;
          cursor: pointer;
          text-align: left;
        }
        .dd-link-btn:hover { color: #444444; }

        @media (max-width: 640px) {
          .dd-stat-grid { grid-template-columns: 1fr; }
        }
      `}</style>

      <div style={{ minHeight: '100vh', background: '#ffffff' }}>

        <NewPatientToast
          alerts={newPatientAlerts}
          onDismiss={(idx) => setNewPatientAlerts((prev) => prev.filter((_, i) => i !== idx))}
          onView={(patient) => navigateToPatientProfile(patient)}
        />

        {/* ── HEADER ── */}
        <div style={{
          padding: '48px 24px 20px',
          borderBottom: '1px solid #e0e0e0',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 12,
        }}>
          <div>
            <p style={{
              fontSize: 10,
              textTransform: 'uppercase',
              letterSpacing: '1.8px',
              color: '#888888',
              marginBottom: 6,
            }}>
              Clinical Interface
            </p>
            <h1 style={{
              fontFamily: "'DM Serif Display', serif",
              fontSize: 28,
              fontWeight: 400,
              letterSpacing: '-0.5px',
              color: '#000000',
              marginBottom: 4,
            }}>Doctor: {doctorName}
            </h1>
            <p style={{ fontSize: 12, color: '#888888', marginBottom: 2 }}>
              Emergency Department
            </p>
            <p style={{
              fontSize: 15,
              fontWeight: 400,
              color: '#000000',
              letterSpacing: '-0.3px',
            }}>
              DoctorAssist.Ai
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <button
              className="dd-refresh-btn"
              onClick={handleRefresh}
              disabled={refreshing || loading}
            >
              {refreshing ? <span className="dd-refresh-spinner" /> : '↻'}
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button className="dd-logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </div>

        {/* ── STAT GRID ── */}
        <div style={{ padding: '20px 24px 0' }}>
          <div className="dd-stat-grid">
            <div className="dd-stat-cell">
              <p style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '1.2px',
                color: '#888888',
                marginBottom: 6,
              }}>
                Total Patients
              </p>
              <p style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 32,
                fontWeight: 400,
                letterSpacing: '-0.5px',
                color: '#000000',
              }}>
                {loading ? '—' : totalPatients}
              </p>
            </div>
            <div className="dd-stat-cell">
              <p style={{
                fontSize: 11,
                textTransform: 'uppercase',
                letterSpacing: '1.2px',
                color: '#888888',
                marginBottom: 6,
              }}>
                Today's Appointments
              </p>
              <p style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 32,
                fontWeight: 400,
                letterSpacing: '-0.5px',
                color: '#000000',
              }}>
                {loading ? '—' : todayCount}
              </p>
            </div>
          </div>
        </div>

        {/* ── SEARCH BAR ── */}
        <div style={{ padding: '16px 24px 0' }}>
          <div className="dd-search-wrap">
            <input
              className="dd-search-input"
              type="text"
              placeholder="🔍  Search by Patient ID, Name, Phone, Age, Condition…"
              value={searchTerm}
              onChange={(e) => handleSearch(e.target.value)}
            />
            {searchTerm.length > 0 && (
              <button className="dd-search-clear" onClick={clearSearch}>✕</button>
            )}
          </div>
        </div>

        {/* ── MAIN CONTENT ── */}
        <div style={{ padding: '16px 24px 40px', display: 'flex', flexDirection: 'column', gap: 20 }}>

          {/* Search Results */}
          {showSearchResults && (
            <div className="dd-section">
              <div className="dd-section-head">
                <div>
                  <p style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '1px',
                    color: '#000000',
                    fontWeight: 400,
                  }}>
                    Search Results
                  </p>
                  <p style={{ fontSize: 10, color: '#888888', marginTop: 3 }}>
                    {filteredPatients.length} patient{filteredPatients.length !== 1 ? 's' : ''} found
                  </p>
                </div>
                <button className="dd-clear-btn" onClick={clearSearch}>
                  Clear
                </button>
              </div>

              <div className="dd-table-scroll">
                <table>
                  <thead>
                    <tr>
                      {TABLE_HEADERS.map((h) => <th key={h}>{h}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPatients.length === 0 ? (
                      <tr>
                        <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#888888', fontSize: 12 }}>
                          No patients found matching &ldquo;{searchTerm}&rdquo;
                        </td>
                      </tr>
                    ) : (
                      filteredPatients.map((patient) => (
                        <tr key={patient.patient_id} style={{ borderBottom: '1px solid #e0e0e0' }}>
                          <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.patient_id}</td>
                          <td style={{ padding: '12px 14px' }}>
                            <button className="dd-link-btn" onClick={() => navigateToPatientProfile(patient)}>
                              {patient.fullName}
                            </button>
                          </td>
                          <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.phoneNumber || 'N/A'}</td>
                          <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.age}</td>
                          <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.accidentDetails?.accidentTime || 'N/A'}</td>
                          <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.accidentDetails?.condition || 'N/A'}</td>
                          <td style={{ padding: '12px 14px' }}>
                            <button className="dd-action-btn" onClick={() => navigateToPatientProfile(patient)}>
                              View →
                            </button>
                          </td>
     <td
  style={{
    padding: '12px 14px',
    fontSize: 12,
    fontWeight: '600',
    color:
      completedStatuses[patient.patient_id] === "completed"
        ? 'green'
        : 'red'
  }}
>
  {completedStatuses[patient.patient_id] === "completed"
    ? "Completed"
    : "Active"}
</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Today's Accident Patients */}
          <div className="dd-section">
            <div className="dd-section-head">
  <div>
    <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <p style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '1px', color: '#000000', fontWeight: 400 }}>
        Appointments — {dateFilterLabel}
      </p>
      <select
        value={dateFilter}
        onChange={(e) => setDateFilter(e.target.value)}
        style={{ border: '1px solid #e0e0e0', padding: '4px 8px', fontSize: 11, fontFamily: "'DM Sans', sans-serif", background: '#fff' }}
      >
        <option value="today">Today</option>
        <option value="yesterday">Yesterday</option>
        <option value="week">Last 7 Days</option>
        <option value="custom">Custom Date</option>
      </select>
      {dateFilter === 'custom' && (
        <input
          type="date"
          value={customDate}
          max={getDateStr(new Date())}
          onChange={(e) => setCustomDate(e.target.value)}
          style={{ border: '1px solid #e0e0e0', padding: '4px 8px', fontSize: 11, fontFamily: "'DM Sans', sans-serif" }}
        />
      )}
    </div>
    <p style={{ fontSize: 10, color: '#888888', marginTop: 3 }}>
      {dateFilter === 'today' ? getDateStr(new Date()) : ''}
    </p>
  </div>
  <p style={{ fontSize: 10, color: '#888888' }}>
    {todayAccidentsCount} record{todayAccidentsCount !== 1 ? 's' : ''}
  </p>
</div>

            <div className="dd-table-scroll">
              <table>
                <thead>
                  <tr>
                    {TABLE_HEADERS.map((h) => <th key={h}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#888888', fontSize: 12 }}>
                        Loading patients…
                      </td>
                    </tr>
                  ) : todayAccidentPatients.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ padding: 40, textAlign: 'center', color: '#888888', fontSize: 12 }}>
                        No patients with accidents today
                      </td>
                    </tr>
                  ) : (
                    todayAccidentPatients.map((patient) => (
                      <tr key={patient.patient_id} style={{ borderBottom: '1px solid #e0e0e0' }}>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.patient_id}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <button className="dd-link-btn" onClick={() => navigateToPatientProfile(patient)}>
                            {patient.fullName}
                          </button>
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.phoneNumber || 'N/A'}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.age}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.accidentDetails?.accidentTime || 'N/A'}</td>
                        <td style={{ padding: '12px 14px', fontSize: 12, color: '#444' }}>{patient.accidentDetails?.condition || 'N/A'}</td>
                        <td style={{ padding: '12px 14px' }}>
                          <button className="dd-action-btn" onClick={() => navigateToPatientProfile(patient)}>
                            View →
                          </button>
                        </td>
                        <td
  style={{
    padding: '12px 14px',
    fontSize: 12,
    fontWeight: '600',
    color:
      completedStatuses[patient.patient_id] === "completed"
        ? 'green'
        : 'red'
  }}
>
  {completedStatuses[patient.patient_id] === "completed"
    ? "Completed"
    : "Active"}
</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </div>
    </>
  );
}

// Inline style constants used in JSX above
const s = {
  tr: { borderBottom: '1px solid #e0e0e0' },
  td: { padding: '12px 14px', fontSize: 12, color: '#444444', whiteSpace: 'nowrap' },
  linkBtn: {
    background: 'none', border: 'none', padding: 0,
    fontFamily: "'DM Sans', sans-serif", fontSize: 12,
    color: '#000000', textDecoration: 'underline', cursor: 'pointer',
  },
  actionBtn: {
    background: '#000000', color: '#ffffff', border: 'none',
    padding: '5px 12px', fontFamily: "'DM Sans', sans-serif",
    fontSize: 11, cursor: 'pointer', whiteSpace: 'nowrap',
  },
};