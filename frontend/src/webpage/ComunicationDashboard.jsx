import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Users, Activity, Settings, Zap, Calendar, Phone, MessageSquare, FileText, Clock } from 'lucide-react';

// Import base URL from environment variable
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const AppointmentDashboard = () => {
  const [appointments, setAppointments] = useState([]);
  const [filterDate, setFilterDate] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [clinicId, setClinicId] = useState('');

  // Extract clinic_id from URL
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const clinicIdFromUrl = urlParams.get('clinic_id');
    
    if (clinicIdFromUrl) {
      setClinicId(clinicIdFromUrl);
    } else {
      setError('No clinic_id parameter found in URL');
      setLoading(false);
    }
  }, []);

  // Fetch appointments data from API - FIXED ENDPOINT
  useEffect(() => {
    if (!clinicId) return;

    const fetchAppointments = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Changed endpoint to get all appointments, not just whatsapp
        const response = await fetch(
          `${API_BASE_URL}hms/users/data/whatsapp/appointments/${clinicId}`
        );
        
        if (!response.ok) {
          throw new Error(`API failed: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        // Check if the response has records array or is directly an array
        const appointmentsData = data.records || data;
        
        // Transform API data to include unique IDs and handle new format
        const transformedData = appointmentsData.map((item, index) => ({
          _id: `appointment-${item._id || index}-${Date.now()}`,
          hms_id: item.hms_id || 'N/A',
          hospital_id: item.hospital_id || clinicId,
          phone_number: item.phone_number || '+91XXXXXXXXXX',
          appointment_id: item.appointment_id || `APT-${Date.now()}-${index}`,
          appointment_date: item.appointment_date || 'N/A',
          appointment_time: item.appointment_time || 'N/A',
          created_at: item.created_at || new Date().toISOString(),
          updated_at: item.updated_at || item.created_at || new Date().toISOString(),
          patient_name: item.patient_name || 'Unknown Patient',
          // Only set source if it exists in the data
          ...(item.source && { source: item.source }),
          // Only set metadata if it exists
          ...(item.metadata && { metadata: item.metadata })
        }));
        
        setAppointments(transformedData);
      } catch (err) {
        console.error('Error fetching appointments:', err);
        setError(`API Failed: ${err.message}`);
        setAppointments([]);
      } finally {
        setLoading(false);
      }
    };

    fetchAppointments();
  }, [clinicId]);

  // Format date from ISO string to readable format
  const formatDate = (dateString) => {
    if (!dateString || dateString === 'N/A') return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (err) {
      return 'Invalid Date';
    }
  };

  // Check if source exists in the appointment
  const hasSource = (appointment) => {
    return appointment.hasOwnProperty('source') && appointment.source && appointment.source !== 'N/A';
  };

  // Format platform/source name for display
  const formatPlatformName = (appointment) => {
    if (!hasSource(appointment)) return 'Not specified';
    
    const source = appointment.source;
    
    // Capitalize first letter and make it look nice
    const platformNames = {
      'whatsapp': 'WhatsApp',
      'web': 'Web Portal',
      'mobile': 'Mobile App',
      'clinic': 'Clinic Portal',
      'voice': 'Voice Call',
      'elevenlabs': 'Voice Agent',
      'chat': 'Chat',
      'email': 'Email',
      'sms': 'SMS',
      'unknown': 'Unknown'
    };
    
    return platformNames[source.toLowerCase()] || source.charAt(0).toUpperCase() + source.slice(1);
  };

  // Get platform icon based on source
  const getPlatformIcon = (appointment) => {
    if (!hasSource(appointment)) {
      return (
        <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 5.636L16.95 7.05M18.364 18.364L16.95 16.95M21 12h-2M4 12H2M7.05 7.05L5.636 5.636M7.05 16.95L5.636 18.364M12 4V2M12 22v-2" />
        </svg>
      );
    }
    
    const source = appointment.source.toLowerCase();
    
    switch(source) {
      case 'whatsapp':
        return (
          <svg className="w-4 h-4 mr-1.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 2.06.55 4.08 1.6 5.86L2 22l4.32-1.65c1.71.93 3.66 1.43 5.72 1.43 5.46 0 9.91-4.45 9.91-9.91S17.5 2 12.04 2zm.01 18.05c-1.7 0-3.37-.45-4.83-1.3l-.35-.2-2.56.98.99-2.52-.22-.36c-.91-1.48-1.4-3.2-1.4-4.97 0-4.55 3.71-8.26 8.27-8.26 4.55 0 8.26 3.71 8.26 8.26 0 4.56-3.71 8.27-8.26 8.27z"/>
            <path d="M16.95 14.03c-.27-.14-1.6-.79-1.85-.88-.25-.09-.44-.14-.62.14-.18.28-.72.88-.88 1.06-.16.18-.33.2-.6.07-.27-.14-1.14-.42-2.17-1.34-.8-.71-1.34-1.58-1.5-1.85-.16-.27-.02-.42.12-.55.13-.12.27-.32.4-.48.14-.16.18-.28.27-.46.09-.18.05-.34-.02-.48-.07-.14-.62-1.5-.85-2.06-.23-.56-.46-.48-.62-.49-.16-.01-.35-.01-.54-.01-.18 0-.48.07-.73.34-.25.28-.95.93-.95 2.27 0 1.34.98 2.63 1.12 2.81.14.18 1.88 2.94 4.66 4.03 2.78 1.09 2.78.73 3.28.68.5-.05 1.6-.65 1.83-1.28.23-.63.23-1.17.16-1.28-.07-.11-.25-.18-.52-.32z"/>
          </svg>
        );
      case 'web':
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.66 0 3-4 3-9s-1.34-9-3-9m0 18c-1.66 0-3-4-3-9s1.34-9 3-9" />
          </svg>
        );
      case 'mobile':
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      case 'voice':
      case 'elevenlabs':
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
          </svg>
        );
      case 'chat':
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        );
      case 'email':
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        );
      case 'sms':
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
        );
      case 'unknown':
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      default:
        return (
          <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
        );
    }
  };

  // Get platform color based on source
  const getPlatformColor = (appointment) => {
    if (!hasSource(appointment)) {
      return 'bg-gray-500/10 text-gray-400';
    }
    
    const source = appointment.source.toLowerCase();
    
    switch(source) {
      case 'whatsapp':
        return 'bg-green-500/10 text-green-400';
      case 'web':
        return 'bg-blue-500/10 text-blue-400';
      case 'mobile':
        return 'bg-purple-500/10 text-purple-400';
      case 'voice':
      case 'elevenlabs':
        return 'bg-yellow-500/10 text-yellow-400';
      case 'chat':
        return 'bg-indigo-500/10 text-indigo-400';
      case 'email':
        return 'bg-red-500/10 text-red-400';
      case 'sms':
        return 'bg-pink-500/10 text-pink-400';
      case 'unknown':
        return 'bg-gray-500/10 text-gray-400';
      default:
        return 'bg-gray-500/10 text-gray-400';
    }
  };

  // Filter appointments based on search and date filter
  const filteredAppointments = appointments.filter(appointment => {
    const matchesSearch = appointment.patient_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         appointment.hms_id.toString().includes(searchTerm);
    const matchesDate = !filterDate || appointment.appointment_date === filterDate;
    return matchesSearch && matchesDate;
  });

  // Calculate statistics
  const totalAppointments = appointments.length;
  const today = new Date().toISOString().split('T')[0];
  const todayAppointments = appointments.filter(a => a.appointment_date === today).length;
  const uniquePatients = new Set(appointments.map(a => a.patient_name)).size;

  // Loading State
  if (loading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500 mb-4"></div>
          <p className="text-white text-lg">Loading appointments...</p>
          <p className="text-gray-400 text-sm mt-2">Clinic ID: {clinicId}</p>
        </div>
      </div>
    );
  }

  // Error State
  if (error) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black flex items-center justify-center">
        <div className="glass-card p-8 rounded-2xl backdrop-blur-lg border border-red-500/20 max-w-md text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Error Loading Data</h2>
          <p className="text-gray-300 mb-4">{error}</p>
          <p className="text-gray-400 text-sm mb-4">
            Clinic ID from URL: {clinicId || 'Not found'}
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors duration-200"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-black">
      {/* Sidebar */}
      <div
        style={{
          position: "fixed",
          left: 0,
          top: 0,
          bottom: 0,
          width: "280px",
          background: "rgba(20, 20, 30, 0.95)",
          backdropFilter: "blur(20px)",
          borderRight: "1px solid rgba(255, 255, 255, 0.1)",
          padding: "24px",
          boxShadow: "4px 0 24px rgba(0, 0, 0, 0.5)",
          zIndex: 1000,
        }}
      >
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: "100%",
            background:
              "radial-gradient(circle at top left, rgba(59, 130, 246, 0.15), transparent)",
            pointerEvents: "none",
          }}
        />

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            marginBottom: "32px",
            position: "relative",
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: "40px",
              height: "40px",
              borderRadius: "10px",
              background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 12px rgba(59, 130, 246, 0.3)",
            }}
          >
            <Zap size={24} style={{ color: "#fff" }} />
          </div>
          <span
            style={{ fontSize: "20px", fontWeight: "700", color: "#fff" }}
          >
            Clinical Hub
          </span>
        </div>

        <div style={{ position: "relative", zIndex: 1 }}>
          {/* Menu Item: Overview */}
          <div
            onClick={() => window.location.href = `/clinic-dashboard?clinic_id=${clinicId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <LayoutDashboard size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Overview</span>
          </div>

          {/* Menu Item: Add Doctors */}
          <div
            onClick={() => window.location.href = `/clinic-doctor-register?clinic_id=${clinicId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Users size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Add Doctors</span>
          </div>

          {/* Menu Item: Communication node (Current Page - Active) */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "rgba(59, 130, 246, 0.2)",
              color: "#3b82f6",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
              borderLeft: "3px solid #3b82f6",
            }}
          >
            <MessageSquare size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Communication node</span>
          </div>

          {/* Menu Item: Clinical Engine */}
          <div
            onClick={() => window.location.href = `/clinical-engine?clinic_id=${clinicId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Activity size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Clinical Engine</span>
          </div>

          {/* Menu Item: OPD Doctor Schedule */}
          <div
            onClick={() => window.location.href = `/opd-time-schedule-hospital?clinic_id=${clinicId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Clock size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>OPD Schedule</span>
          </div>

          {/* Menu Item: Pre Screening Questions */}
          <div
            onClick={() => window.location.href = `/pre-screening-questions?clinic_id=${clinicId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <FileText size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Pre Screening</span>
          </div>

          {/* Menu Item: Settings */}
          <div
            onClick={() => window.location.href = `/clinic-dashboard?clinic_id=${clinicId}`}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "12px",
              padding: "12px 16px",
              borderRadius: "12px",
              background: "transparent",
              color: "rgba(255, 255, 255, 0.7)",
              cursor: "pointer",
              transition: "all 0.2s ease",
              margin: "4px 0",
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = "rgba(255, 255, 255, 0.1)";
              e.currentTarget.style.color = "#fff";
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = "transparent";
              e.currentTarget.style.color = "rgba(255, 255, 255, 0.7)";
            }}
          >
            <Settings size={20} />
            <span style={{ fontSize: "15px", fontWeight: "500" }}>Settings</span>
          </div>
        </div>
      </div>

      {/* Main Content - Add margin-left to account for sidebar */}
      <div className="p-4 md:p-8" style={{ marginLeft: "280px" }}>
      {/* Header with Clinic ID */}
      <div className="mb-8">
        <div className="flex justify-between items-start">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-white mb-2">
              Appointment Dashboard
            </h1>
            <p className="text-gray-400">Manage and monitor all patient appointments</p>
          </div>
          <div className="glass-card px-4 py-2 rounded-xl backdrop-blur-lg border border-white/10">
            <p className="text-sm text-gray-400">Clinic ID</p>
            <p className="text-white font-mono text-sm truncate max-w-xs">{clinicId}</p>
          </div>
        </div>
      </div>

      {/* Stats Cards with Glassmorphism */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="glass-card p-6 rounded-2xl backdrop-blur-lg border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Total Appointments</p>
              <p className="text-3xl font-bold text-white mt-2">{totalAppointments}</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="glass-card p-6 rounded-2xl backdrop-blur-lg border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Today's Appointments</p>
              <p className="text-3xl font-bold text-white mt-2">{todayAppointments}</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
          </div>
        </div>

        <div className="glass-card p-6 rounded-2xl backdrop-blur-lg border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-gray-400 text-sm">Unique Patients</p>
              <p className="text-3xl font-bold text-white mt-2">{uniquePatients}</p>
            </div>
            <div className="w-12 h-12 rounded-full bg-purple-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          </div>
        </div>
      </div>

      {/* Filters Section */}
      <div className="glass-card p-6 rounded-2xl backdrop-blur-lg border border-white/10 mb-8">
        <div className="flex flex-col md:flex-row gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Search Patient
            </label>
            <div className="relative">
              <input
                type="text"
                placeholder="Search by patient name or HMS ID..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <svg className="absolute right-3 top-3.5 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-2">
              Filter by Date
            </label>
            <input
              type="date"
              value={filterDate}
              onChange={(e) => setFilterDate(e.target.value)}
              className="px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          <div className="flex items-end">
            <button
              onClick={() => {
                setSearchTerm('');
                setFilterDate('');
              }}
              className="px-6 py-3 bg-white/10 hover:bg-white/20 border border-white/10 rounded-xl text-white transition-colors duration-200"
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      {/* Appointments Table */}
      <div className="glass-card rounded-2xl backdrop-blur-lg border border-white/10 overflow-hidden">
        <div className="p-6 border-b border-white/10">
          <div className="flex justify-between items-center">
            <div>
              <h2 className="text-xl font-semibold text-white">Appointment List</h2>
              <p className="text-gray-400 text-sm mt-1">
                Showing {filteredAppointments.length} of {appointments.length} appointments
              </p>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm bg-white/10 hover:bg-white/20 border border-white/10 rounded-lg text-white transition-colors duration-200 flex items-center"
            >
              <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {filteredAppointments.length === 0 ? (
          <div className="p-12 text-center">
            <div className="w-20 h-20 rounded-full bg-gray-800/50 flex items-center justify-center mx-auto mb-4">
              <svg className="w-10 h-10 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-white mb-2">No appointments found</h3>
            <p className="text-gray-400">
              {searchTerm || filterDate 
                ? 'Try changing your search or filter criteria' 
                : 'No appointments available for this clinic'
              }
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="py-4 px-6 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Patient Name
                  </th>
                  <th className="py-4 px-6 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    HMS ID
                  </th>
                  <th className="py-4 px-6 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Appointment Date
                  </th>
                  <th className="py-4 px-6 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Appointment Time
                  </th>
                  <th className="py-4 px-6 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Created Date
                  </th>
                  <th className="py-4 px-6 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
                    Platform
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {filteredAppointments.map((appointment) => (
                  <tr key={appointment._id} className="hover:bg-white/5 transition-colors duration-150">
                    <td className="py-4 px-6">
                      <div className="flex items-center">
                        <div className="flex-shrink-0 h-10 w-10 rounded-full bg-blue-500/20 flex items-center justify-center">
                          <span className="text-blue-400 font-semibold">
                            {appointment.patient_name.charAt(0)}
                          </span>
                        </div>
                        <div className="ml-4">
                          <div className="text-sm font-medium text-white">
                            {appointment.patient_name}
                          </div>
                          <div className="text-sm text-gray-400">
                            {appointment.phone_number}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-500/10 text-blue-400">
                        {appointment.hms_id}
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="text-sm text-white">
                        {appointment.appointment_date}
                      </div>
                      <div className="text-xs text-gray-400">
                        {appointment.appointment_date !== 'N/A' 
                          ? new Date(appointment.appointment_date).toLocaleDateString('en-US', { weekday: 'long' })
                          : 'N/A'
                        }
                      </div>
                    </td>
                    <td className="py-4 px-6">
                      <div className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-green-500/10 text-green-400">
                        {appointment.appointment_time}
                      </div>
                    </td>
                    <td className="py-4 px-6 text-sm text-gray-300">
                      {formatDate(appointment.created_at)}
                    </td>
                    <td className="py-4 px-6">
                      <div className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${getPlatformColor(appointment)}`}>
                        {getPlatformIcon(appointment)}
                        {formatPlatformName(appointment)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer */}
        <div className="p-6 border-t border-white/10">
          <div className="flex justify-between items-center">
            <div className="text-sm text-gray-400">
              Last updated: {new Date().toLocaleString()}
            </div>
          </div>
        </div>
      </div>

      {/* Glassmorphism Effects */}
      <style jsx global>{`
        .glass-card {
          background: rgba(255, 255, 255, 0.05);
          backdrop-filter: blur(10px);
          -webkit-backdrop-filter: blur(10px);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.36);
        }
        
        body {
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        }
        
        /* Custom scrollbar */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        
        ::-webkit-scrollbar-track {
          background: rgba(255, 255, 255, 0.05);
          border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb {
          background: rgba(255, 255, 255, 0.2);
          border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
          background: rgba(255, 255, 255, 0.3);
        }
        
        /* Input placeholder color */
        input::placeholder {
          color: #6b7280;
        }
        
        /* Date picker icon color */
        input[type="date"]::-webkit-calendar-picker-indicator {
          filter: invert(0.5);
        }
      `}</style>
    </div>

  </div>
  );
};

export default AppointmentDashboard;