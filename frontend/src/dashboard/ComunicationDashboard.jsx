import React, { useState, useEffect, useMemo, useCallback } from "react";
import {
  LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer
} from "recharts";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const CommunicationDashboard = () => {
  const [activeTab, setActiveTab] = useState("overview");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  // Data states
  const [appointments, setAppointments] = useState([]);
  const [followUps, setFollowUps] = useState([]);
  const [educationRecords, setEducationRecords] = useState([]);
  const [doctorInfo, setDoctorInfo] = useState(null);
  const [selectedPatientDetails, setSelectedPatientDetails] = useState(null);

  // Filter states
  const [globalSearch, setGlobalSearch] = useState("");
  const [sourceFilter, setSourceFilter] = useState("All");
  const [dateRange, setDateRange] = useState({ start: "", end: "" });
  const [followUpStatusFilter, setFollowUpStatusFilter] = useState("All");

  // Modal states
  const [selectedPatient, setSelectedPatient] = useState(null);
  const [showPatientModal, setShowPatientModal] = useState(false);
  const [modalLoading, setModalLoading] = useState(false);

  // Stats state
  const [stats, setStats] = useState({
    totalAppointments: 0,
    todayAppointments: 0,
    upcomingAppointments: 0,
    totalFollowUps: 0,
    pendingFollowUps: 0,
    respondedFollowUps: 0,
    educationCount: 0,
    sourceDistribution: {},
    weeklyTrend: []
  });

  // Professional color palette
  const COLORS = {
    primary: '#2563EB',
    secondary: '#059669',
    accent: '#7C3AED',
    warning: '#D97706',
    danger: '#DC2626',
    gray: '#6B7280',
    whatsapp: '#059669',
    voiceAgent: '#7C3AED',
    unknown: '#6B7280'
  };

  // Date formatting functions
  const formatDate = (dateString) => {
    if (!dateString) return '—';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch {
      return dateString;
    }
  };

  const formatDateTime = (dateString) => {
    if (!dateString) return '—';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return dateString;
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return dateString;
    }
  };

  const formatTimeOnly = (dateString) => {
    if (!dateString) return '';
    try {
      const date = new Date(dateString);
      if (isNaN(date.getTime())) return '';
      return date.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true
      });
    } catch {
      return '';
    }
  };

  // Fetch all data
  useEffect(() => {
    fetchAllData();
    const interval = setInterval(fetchAllData, 60000);
    return () => clearInterval(interval);
  }, []);

  const fetchAllData = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const appointmentsUrl = `${API_BASE_URL}hms/users/data/whatsapp/appointments`;
      const followUpsUrl = `${API_BASE_URL}hms/users/data/whatsapp/follow-up-data`;
      const educationUrl = `${API_BASE_URL}hms/users/data/whatsapp/education-records`;
      
      const [appointmentsRes, followUpsRes, educationRes] = await Promise.allSettled([
        fetch(appointmentsUrl),
        fetch(followUpsUrl),
        fetch(educationUrl)
      ]);

      let processedAppointments = [];
      let processedFollowUps = [];
      let processedEducation = [];

      // Process appointments
      if (appointmentsRes.status === 'fulfilled' && appointmentsRes.value.ok) {
        const appointmentsData = await appointmentsRes.value.json();
        const appointmentsArray = Array.isArray(appointmentsData) ? appointmentsData : 
                                  appointmentsData.records || appointmentsData.data || [];
        
        processedAppointments = appointmentsArray.map((apt, index) => {
          const doctorName = apt.doctor_name || apt.doctorName || null;
          const specialization = apt.specialization || null;
          
          return {
            id: apt.appointment_id || `apt-${index}-${Date.now()}`,
            patient_id: apt.patient_id,
            patient_name: apt.patient_name || 'Unknown Patient',
            hms_id: apt.hms_id || '—',
            doctor_name: doctorName,
            doctor_specialization: specialization,
            doctor_display: doctorName ? `Dr. ${doctorName}${specialization ? ` (${specialization})` : ''}` : '—',
            appointment_date: apt.appointment_date,
            appointment_time: apt.appointment_time || '—',
            source: apt.source || 'unknown',
            sourceDisplay: apt.source === 'elevenlabs' ? 'Voice Agent' : 
                          apt.source === 'whatsapp' ? 'WhatsApp' : 
                          apt.source || 'Unknown',
            created_at: apt.created_at,
            status: getAppointmentStatus(apt.appointment_date)
          };
        });
        setAppointments(processedAppointments);
      }

      // Process follow-ups
      if (followUpsRes.status === 'fulfilled' && followUpsRes.value.ok) {
        const followUpsData = await followUpsRes.value.json();
        const followUpsArray = Array.isArray(followUpsData) ? followUpsData : 
                               followUpsData.records || followUpsData.data || [];
        
        processedFollowUps = followUpsArray.map((fu, index) => {
          // Extract patient name
          let patientName = fu.patient_name;
          if (!patientName && fu.template_variables) {
            patientName = fu.template_variables.patient_name;
          }
          if (!patientName) {
            patientName = 'Unknown Patient';
          }
          
          const doctorName = fu.doctor_name_used || fu.doctor_name || null;
          
          return {
            id: fu.followup_uuid || fu._id || `fu-${index}-${Date.now()}`,
            patient_id: fu.patient_id,
            patient_name: patientName,
            doctor_name: doctorName,
            doctor_display: doctorName ? `Dr. ${doctorName}` : '—',
            followup_date: fu.followup_date,
            reminder_type: fu.reminder_type || 'follow-up',
            reminder_status: fu.reminder_sent ? 'Sent' : 
                           fu.reminded ? 'Failed' : 'Pending',
            response_received: fu.response_received || false,
            response_type: fu.response_type || null,
            response_text: fu.patient_response?.text || null,
            response_time: fu.response_time || null,
            reminded_at: fu.reminded_at || null,
            created_at: fu.created_at
          };
        });
        setFollowUps(processedFollowUps);
      }

      // Process education records
      if (educationRes.status === 'fulfilled' && educationRes.value.ok) {
        const educationData = await educationRes.value.json();
        const educationArray = educationData.records || educationData.data || [];
        
        processedEducation = educationArray.map((edu, index) => {
          const doctorName = edu.doctor_name || null;
          
          return {
            id: edu.education_id || edu._id || `edu-${index}-${Date.now()}`,
            patient_id: edu.patient_id,
            patient_name: edu.patient_name || 'Unknown Patient',
            hms_id: edu.hms_id || '—',
            doctor_name: doctorName,
            doctor_display: doctorName ? `Dr. ${doctorName}` : '—',
            question: edu.question || '—',
            answer: edu.answer || '—',
            created_at: edu.created_at,
            formatted_date: edu.created_at ? formatDate(edu.created_at) : '—',
            question_source: edu.question_source || 'Unknown'
          };
        });
        setEducationRecords(processedEducation);
      }

      setLastUpdated(new Date());
    } catch (err) {
      console.error("Fetch error:", err);
      setError("Unable to load data. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  // Calculate stats whenever data changes
  useEffect(() => {
    calculateStats();
  }, [appointments, followUps, educationRecords]);

  const calculateStats = () => {
    const today = new Date().toISOString().split('T')[0];
    
    // Source distribution
    const sourceDist = appointments.reduce((acc, curr) => {
      const source = curr.sourceDisplay || 'Unknown';
      if (source !== 'Unknown' && source !== 'N/A') {
        acc[source] = (acc[source] || 0) + 1;
      }
      return acc;
    }, {});

    // Weekly trend
    const last7Days = [...Array(7)].map((_, i) => {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      
      const appointmentsCount = appointments.filter(a => {
        if (!a.appointment_date) return false;
        const aptDate = new Date(a.appointment_date).toISOString().split('T')[0];
        return aptDate === dateStr;
      }).length;
      
      const followUpsCount = followUps.filter(f => {
        if (!f.followup_date) return false;
        const fuDate = new Date(f.followup_date).toISOString().split('T')[0];
        return fuDate === dateStr;
      }).length;
      
      return {
        date: date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        appointments: appointmentsCount,
        followUps: followUpsCount
      };
    }).reverse();

    const respondedFollowUps = followUps.filter(f => f.response_received).length;

    setStats({
      totalAppointments: appointments.length,
      todayAppointments: appointments.filter(a => {
        if (!a.appointment_date) return false;
        const aptDate = new Date(a.appointment_date).toISOString().split('T')[0];
        return aptDate === today;
      }).length,
      upcomingAppointments: appointments.filter(a => {
        if (!a.appointment_date) return false;
        return a.appointment_date > today;
      }).length,
      totalFollowUps: followUps.length,
      pendingFollowUps: followUps.filter(f => f.reminder_status === 'Pending').length,
      respondedFollowUps: respondedFollowUps,
      educationCount: educationRecords.length,
      sourceDistribution: sourceDist,
      weeklyTrend: last7Days
    });
  };

  const fetchPatientInfo = async (patientId) => {
    if (!patientId) return null;
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-info?patient_id=${patientId}`);
      if (response.ok) {
        const data = await response.json();
        return data;
      }
    } catch (err) {
      console.error("Error fetching patient info:", err);
    }
    return null;
  };

  const handlePatientClick = async (patient) => {
    setSelectedPatient(patient);
    setModalLoading(true);
    setShowPatientModal(true);
    
    try {
      const info = await fetchPatientInfo(patient.patient_id);
      setSelectedPatientDetails(info);
      
      const patientFollowUps = followUps.filter(f => f.patient_id === patient.patient_id);
      const patientEducation = educationRecords.filter(e => e.patient_id === patient.patient_id);
      
      setSelectedPatient(prev => ({ 
        ...prev, 
        followUps: patientFollowUps,
        education: patientEducation 
      }));
      
    } catch (err) {
      console.error("Error loading patient details:", err);
    } finally {
      setModalLoading(false);
    }
  };

  // Filtered data
  const filteredAppointments = useMemo(() => {
    return appointments.filter(apt => {
      const matchesSearch = !globalSearch || 
        apt.patient_name?.toLowerCase().includes(globalSearch.toLowerCase()) ||
        apt.hms_id?.toString().includes(globalSearch) ||
        apt.doctor_name?.toLowerCase().includes(globalSearch.toLowerCase());
      
      const matchesSource = sourceFilter === "All" || apt.sourceDisplay === sourceFilter;
      
      const matchesDateRange = (!dateRange.start || apt.appointment_date >= dateRange.start) &&
                              (!dateRange.end || apt.appointment_date <= dateRange.end);
      
      return matchesSearch && matchesSource && matchesDateRange;
    });
  }, [appointments, globalSearch, sourceFilter, dateRange]);

  const filteredFollowUps = useMemo(() => {
    return followUps.filter(fu => {
      const matchesSearch = !globalSearch || 
        fu.patient_name?.toLowerCase().includes(globalSearch.toLowerCase()) ||
        fu.doctor_name?.toLowerCase().includes(globalSearch.toLowerCase());
      
      const matchesStatus = followUpStatusFilter === "All" || 
        (followUpStatusFilter === "Responded" && fu.response_received) ||
        (followUpStatusFilter === "Pending" && fu.reminder_status === "Pending") ||
        (followUpStatusFilter === "Sent" && fu.reminder_status === "Sent") ||
        (followUpStatusFilter === "Failed" && fu.reminder_status === "Failed");
      
      return matchesSearch && matchesStatus;
    });
  }, [followUps, globalSearch, followUpStatusFilter]);

  const filteredEducation = useMemo(() => {
    return educationRecords.filter(edu => {
      const matchesSearch = !globalSearch || 
        edu.patient_name?.toLowerCase().includes(globalSearch.toLowerCase()) ||
        edu.hms_id?.toString().includes(globalSearch) ||
        edu.question?.toLowerCase().includes(globalSearch.toLowerCase()) ||
        edu.doctor_name?.toLowerCase().includes(globalSearch.toLowerCase());
      
      return matchesSearch;
    });
  }, [educationRecords, globalSearch]);

  // Get ALL unique patients from ALL data sources
  const allPatients = useMemo(() => {
    const patientMap = new Map();
    
    // Add patients from appointments
    appointments.forEach(apt => {
      if (apt.patient_id) {
        if (!patientMap.has(apt.patient_id)) {
          patientMap.set(apt.patient_id, {
            id: apt.patient_id,
            name: apt.patient_name,
            hms_id: apt.hms_id,
            source: 'appointment',
            appointment_count: 1,
            followup_count: 0,
            education_count: 0,
            latest_activity: apt.appointment_date
          });
        } else {
          const existing = patientMap.get(apt.patient_id);
          existing.appointment_count += 1;
          if (apt.appointment_date > existing.latest_activity) {
            existing.latest_activity = apt.appointment_date;
          }
        }
      }
    });
    
    // Add patients from follow-ups
    followUps.forEach(fu => {
      if (fu.patient_id) {
        if (!patientMap.has(fu.patient_id)) {
          patientMap.set(fu.patient_id, {
            id: fu.patient_id,
            name: fu.patient_name,
            hms_id: '—',
            source: 'followup',
            appointment_count: 0,
            followup_count: 1,
            education_count: 0,
            latest_activity: fu.followup_date || fu.created_at
          });
        } else {
          const existing = patientMap.get(fu.patient_id);
          existing.followup_count += 1;
          if (fu.followup_date && fu.followup_date > existing.latest_activity) {
            existing.latest_activity = fu.followup_date;
          } else if (fu.created_at && fu.created_at > existing.latest_activity) {
            existing.latest_activity = fu.created_at;
          }
        }
      }
    });
    
    // Add patients from education records
    educationRecords.forEach(edu => {
      if (edu.patient_id) {
        if (!patientMap.has(edu.patient_id)) {
          patientMap.set(edu.patient_id, {
            id: edu.patient_id,
            name: edu.patient_name,
            hms_id: edu.hms_id || '—',
            source: 'education',
            appointment_count: 0,
            followup_count: 0,
            education_count: 1,
            latest_activity: edu.created_at
          });
        } else {
          const existing = patientMap.get(edu.patient_id);
          existing.education_count += 1;
          if (edu.created_at && edu.created_at > existing.latest_activity) {
            existing.latest_activity = edu.created_at;
          }
        }
      }
    });
    
    // Convert map to array and sort by latest activity (most recent first)
    return Array.from(patientMap.values()).sort((a, b) => {
      const dateA = new Date(a.latest_activity || 0);
      const dateB = new Date(b.latest_activity || 0);
      return dateB - dateA;
    });
  }, [appointments, followUps, educationRecords]);

  // Filter patients based on global search
  const filteredPatients = useMemo(() => {
    if (!globalSearch) return allPatients;
    
    return allPatients.filter(patient => 
      patient.name?.toLowerCase().includes(globalSearch.toLowerCase()) ||
      patient.hms_id?.toString().includes(globalSearch) ||
      patient.id?.toLowerCase().includes(globalSearch.toLowerCase())
    );
  }, [allPatients, globalSearch]);

  // Helper functions
  function getAppointmentStatus(date) {
    if (!date) return 'unknown';
    const today = new Date().toISOString().split('T')[0];
    if (date < today) return 'past';
    if (date === today) return 'today';
    return 'upcoming';
  }

  function formatPatientResponse(response) {
    if (!response) return 'No response';
    if (response.type === 'yes') return 'Confirmed';
    if (response.type === 'no') return 'Declined';
    if (response.text) return response.text;
    return 'Responded';
  }

  function getStatusBadge(status) {
    const badges = {
      today: 'bg-blue-50 text-blue-700 border-blue-200',
      upcoming: 'bg-green-50 text-green-700 border-green-200',
      past: 'bg-gray-50 text-gray-700 border-gray-200',
      Sent: 'bg-green-50 text-green-700 border-green-200',
      Pending: 'bg-yellow-50 text-yellow-700 border-yellow-200',
      Failed: 'bg-red-50 text-red-700 border-red-200',
      Responded: 'bg-purple-50 text-purple-700 border-purple-200',
      'No Response': 'bg-gray-50 text-gray-700 border-gray-200'
    };
    return badges[status] || 'bg-gray-50 text-gray-700 border-gray-200';
  }

  function getSourceColor(source) {
    switch(source) {
      case 'WhatsApp': return COLORS.whatsapp;
      case 'Voice Agent': return COLORS.voiceAgent;
      default: return COLORS.unknown;
    }
  }

  // Custom tooltip for line chart
  const LineChartTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <p className="text-gray-900 font-medium mb-2">{label}</p>
          {payload.map((entry, index) => (
            <div key={index} className="flex items-center space-x-2 mt-1">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: entry.color }}></div>
              <p className="text-gray-600">
                {entry.name}: <span className="font-semibold text-gray-900">{entry.value}</span>
              </p>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  // Custom tooltip for pie chart
  const PieChartTooltip = ({ active, payload }) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3">
          <div className="flex items-center space-x-2">
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: data.color }}></div>
            <p className="text-gray-900 font-medium">{data.name}</p>
          </div>
          <p className="text-gray-600 mt-1">
            Count: <span className="font-semibold text-gray-900">{data.value}</span>
          </p>
          <p className="text-gray-500 text-sm">
            {((data.value / stats.totalAppointments) * 100).toFixed(1)}% of total
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading && !appointments.length && !followUps.length && !educationRecords.length) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="relative">
            <div className="w-16 h-16 border-4 border-gray-200 border-t-blue-600 rounded-full animate-spin"></div>
          </div>
          <p className="text-gray-600 text-lg mt-4">Loading Communication Dashboard</p>
          <p className="text-gray-400 text-sm mt-2">Please wait...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
        <div className="bg-white border border-red-200 rounded-xl p-8 max-w-md text-center shadow-lg">
          <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Error Loading Data</h3>
          <p className="text-gray-500 mb-4">{error}</p>
          <button
            onClick={fetchAllData}
            className="px-6 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Header */}
      <div className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-8">
              <h1 className="text-xl font-semibold text-gray-900">
                Communication Dashboard
              </h1>
              
              {/* Navigation Tabs */}
              <div className="flex space-x-1">
                {['overview', 'appointments', 'followups', 'education', 'patients'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                      activeTab === tab
                        ? 'bg-blue-600 text-white'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center space-x-4">
              <div className="text-sm text-gray-400">
                Updated: {formatTimeOnly(lastUpdated)}
              </div>
              <button
                onClick={fetchAllData}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors duration-200"
                title="Refresh data"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="p-6">
        {/* Global Search Bar */}
        <div className="mb-8">
          <div className="relative max-w-2xl mx-auto">
            <input
              type="text"
              placeholder="Search by patient name, HMS ID, doctor name, or question..."
              value={globalSearch}
              onChange={(e) => setGlobalSearch(e.target.value)}
              className="w-full px-4 py-3 bg-white border border-gray-300 rounded-lg text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {globalSearch && (
              <button
                onClick={() => setGlobalSearch("")}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            )}
          </div>
        </div>

        {/* Overview Tab */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Total Appointments</p>
                    <p className="text-3xl font-semibold text-gray-900 mt-2">{stats.totalAppointments}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {stats.todayAppointments} today • {stats.upcomingAppointments} upcoming
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Total Follow-ups</p>
                    <p className="text-3xl font-semibold text-gray-900 mt-2">{stats.totalFollowUps}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {stats.pendingFollowUps} pending • {stats.respondedFollowUps} responded
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Response Rate</p>
                    <p className="text-3xl font-semibold text-gray-900 mt-2">
                      {stats.totalFollowUps > 0 ? Math.round((stats.respondedFollowUps / stats.totalFollowUps) * 100) : 0}%
                    </p>
                    <p className="text-xs text-gray-400 mt-1">
                      {stats.respondedFollowUps} of {stats.totalFollowUps} patients responded
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-purple-50 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm hover:shadow-md transition-shadow">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm text-gray-500">Education Sessions</p>
                    <p className="text-3xl font-semibold text-gray-900 mt-2">{stats.educationCount}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      Patient questions answered
                    </p>
                  </div>
                  <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center">
                    <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Charts Row */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              {/* Weekly Trend Line Chart */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <h3 className="text-lg font-medium text-gray-900 mb-6">Weekly Activity</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={stats.weeklyTrend} margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                    <XAxis 
                      dataKey="date" 
                      stroke="#9CA3AF"
                      tick={{ fill: '#4B5563', fontSize: 12 }}
                    />
                    <YAxis 
                      stroke="#9CA3AF"
                      tick={{ fill: '#4B5563', fontSize: 12 }}
                      allowDecimals={false}
                    />
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <Tooltip content={<LineChartTooltip />} />
                    <Legend 
                      wrapperStyle={{ paddingTop: 20 }}
                      formatter={(value) => <span className="text-gray-700">{value}</span>}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="appointments" 
                      stroke={COLORS.primary} 
                      strokeWidth={3}
                      dot={{ fill: COLORS.primary, r: 4, strokeWidth: 2, stroke: 'white' }}
                      activeDot={{ r: 6, stroke: 'white', strokeWidth: 2 }}
                      name="Appointments"
                    />
                    <Line 
                      type="monotone" 
                      dataKey="followUps" 
                      stroke={COLORS.secondary} 
                      strokeWidth={3}
                      dot={{ fill: COLORS.secondary, r: 4, strokeWidth: 2, stroke: 'white' }}
                      activeDot={{ r: 6, stroke: 'white', strokeWidth: 2 }}
                      name="Follow-ups"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              {/* Source Distribution */}
              <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
                <h3 className="text-lg font-medium text-gray-900 mb-6">Communication Channels</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={Object.entries(stats.sourceDistribution)
                        .map(([name, value]) => ({ 
                          name, 
                          value, 
                          color: getSourceColor(name) 
                        }))}
                      cx="50%"
                      cy="50%"
                      innerRadius={60}
                      outerRadius={100}
                      paddingAngle={5}
                      dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={{ stroke: '#9CA3AF', strokeWidth: 1 }}
                    >
                      {Object.entries(stats.sourceDistribution).map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={getSourceColor(entry[0])}
                          stroke="white"
                          strokeWidth={2}
                        />
                      ))}
                    </Pie>
                    <Tooltip content={<PieChartTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Recent Activity */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <h3 className="text-lg font-medium text-gray-900 mb-6">Recent Activity</h3>
              <div className="space-y-4">
                {[...appointments.slice(0, 3), ...followUps.slice(0, 3), ...educationRecords.slice(0, 2)]
                  .sort((a, b) => {
                    const dateA = new Date(a.created_at || a.reminded_at || a.followup_date || 0);
                    const dateB = new Date(b.created_at || b.reminded_at || b.followup_date || 0);
                    return dateB - dateA;
                  })
                  .slice(0, 5)
                  .map((item, idx) => {
                    const isAppointment = item.appointment_date !== undefined;
                    const isFollowUp = item.reminder_type !== undefined;
                    const isEducation = item.question !== undefined;
                    
                    return (
                      <div key={idx} className="flex items-center justify-between py-3 border-b border-gray-100 last:border-0">
                        <div className="flex items-center space-x-4">
                          <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            isAppointment ? 'bg-blue-50' : isFollowUp ? 'bg-green-50' : 'bg-purple-50'
                          }`}>
                            <span className="text-sm font-medium text-gray-600">
                              {isAppointment ? 'A' : isFollowUp ? 'F' : 'Q'}
                            </span>
                          </div>
                          <div>
                            <p className="font-medium text-gray-900">{item.patient_name || 'Unknown Patient'}</p>
                            <p className="text-sm text-gray-500">
                              {isAppointment && `Appointment - ${formatDate(item.appointment_date)} at ${item.appointment_time}`}
                              {isFollowUp && `Follow-up - ${item.reminder_type?.replace(/_/g, ' ')}`}
                              {isEducation && `Question - ${item.question?.substring(0, 60)}${item.question?.length > 60 ? '...' : ''}`}
                            </p>
                            {item.doctor_name && (
                              <p className="text-xs text-gray-400">Dr. {item.doctor_name}</p>
                            )}
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm text-gray-500">
                            {formatDateTime(item.created_at || item.reminded_at || item.followup_date)}
                          </p>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </div>
          </div>
        )}

        {/* Appointments Tab */}
        {activeTab === 'appointments' && (
          <div className="space-y-6">
            {/* Filters */}
            <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <select
                  value={sourceFilter}
                  onChange={(e) => setSourceFilter(e.target.value)}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                >
                  <option value="All">All Sources</option>
                  <option value="Voice Agent">Voice Agent</option>
                  <option value="WhatsApp">WhatsApp</option>
                </select>
                <input
                  type="date"
                  placeholder="From"
                  value={dateRange.start}
                  onChange={(e) => setDateRange({ ...dateRange, start: e.target.value })}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700"
                />
                <input
                  type="date"
                  placeholder="To"
                  value={dateRange.end}
                  onChange={(e) => setDateRange({ ...dateRange, end: e.target.value })}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700"
                />
                <button
                  onClick={() => {
                    setSourceFilter("All");
                    setDateRange({ start: "", end: "" });
                  }}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-lg transition-colors"
                >
                  Clear Filters
                </button>
              </div>
            </div>

            {/* Appointments Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Patient</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">HMS ID</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Doctor</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredAppointments.length > 0 ? filteredAppointments.map((apt) => (
                      <tr key={apt.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-6">
                          <p className="font-medium text-gray-900">{apt.patient_name}</p>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-gray-600">{apt.hms_id}</p>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-gray-900">{apt.doctor_display}</p>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-gray-900">{formatDate(apt.appointment_date)}</p>
                          <p className="text-xs text-gray-500">{apt.appointment_time}</p>
                        </td>
                        <td className="py-4 px-6">
                          <span 
                            className="inline-flex px-3 py-1 rounded-full text-xs font-medium"
                            style={{ 
                              backgroundColor: `${getSourceColor(apt.sourceDisplay)}20`,
                              color: getSourceColor(apt.sourceDisplay)
                            }}
                          >
                            {apt.sourceDisplay}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium border ${getStatusBadge(apt.status)}`}>
                            {apt.status.charAt(0).toUpperCase() + apt.status.slice(1)}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <button
                            onClick={() => handlePatientClick(apt)}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="7" className="py-8 text-center text-gray-500">
                          No appointments found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Follow-ups Tab */}
        {activeTab === 'followups' && (
          <div className="space-y-6">
            {/* Follow-ups Stats */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <p className="text-sm text-gray-500">Total Follow-ups</p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">{stats.totalFollowUps}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <p className="text-sm text-gray-500">Responses</p>
                <p className="text-2xl font-semibold text-green-600 mt-1">{stats.respondedFollowUps}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <p className="text-sm text-gray-500">Pending</p>
                <p className="text-2xl font-semibold text-amber-600 mt-1">{stats.pendingFollowUps}</p>
              </div>
              <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
                <p className="text-sm text-gray-500">Response Rate</p>
                <p className="text-2xl font-semibold text-blue-600 mt-1">
                  {stats.totalFollowUps > 0 ? Math.round((stats.respondedFollowUps / stats.totalFollowUps) * 100) : 0}%
                </p>
              </div>
            </div>

            {/* Follow-ups Table */}
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 flex justify-between items-center bg-gray-50">
                <select
                  value={followUpStatusFilter}
                  onChange={(e) => setFollowUpStatusFilter(e.target.value)}
                  className="px-3 py-2 bg-white border border-gray-300 rounded-lg text-gray-700 text-sm"
                >
                  <option value="All">All Status</option>
                  <option value="Responded">Responded</option>
                  <option value="Pending">Pending</option>
                  <option value="Sent">Sent</option>
                  <option value="Failed">Failed</option>
                </select>
                <span className="text-sm text-gray-500">
                  Showing {filteredFollowUps.length} of {followUps.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Patient</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Doctor</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Follow-up Date</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase">Response</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredFollowUps.length > 0 ? filteredFollowUps.map((fu) => (
                      <tr key={fu.id} className="hover:bg-gray-50 transition-colors">
                        <td className="py-4 px-6">
                          <p className="font-medium text-gray-900">{fu.patient_name}</p>
                          <p className="text-xs text-gray-500">ID: {fu.patient_id?.substring(0, 8)}...</p>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-gray-900">{fu.doctor_display}</p>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-gray-900">{formatDate(fu.followup_date)}</p>
                        </td>
                        <td className="py-4 px-6">
                          <span className="px-3 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                            {fu.reminder_type?.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium border ${getStatusBadge(fu.reminder_status)}`}>
                            {fu.reminder_status}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          {fu.response_received ? (
                            <div>
                              <span className={`inline-flex px-3 py-1 rounded-full text-xs font-medium ${
                                fu.response_type === 'yes' ? 'bg-green-50 text-green-700' :
                                fu.response_type === 'no' ? 'bg-red-50 text-red-700' :
                                'bg-purple-50 text-purple-700'
                              }`}>
                                {fu.response_type === 'yes' ? 'Confirmed' :
                                 fu.response_type === 'no' ? 'Declined' :
                                 'Responded'}
                              </span>
                              {fu.response_text && (
                                <p className="text-xs text-gray-500 mt-1 max-w-xs truncate">"{fu.response_text}"</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="6" className="py-8 text-center text-gray-500">
                          No follow-ups found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Education Tab */}
        {activeTab === 'education' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gray-50">
                <h3 className="text-lg font-medium text-gray-900">Patient Questions & Answers</h3>
              </div>
              <div className="divide-y divide-gray-200">
                {filteredEducation.length > 0 ? filteredEducation.map((edu) => (
                  <div key={edu.id} className="p-6 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 rounded-full bg-purple-50 flex items-center justify-center">
                          <span className="text-sm font-medium text-purple-700">Q</span>
                        </div>
                        <div>
                          <p className="font-medium text-gray-900">{edu.patient_name}</p>
                          <p className="text-sm text-gray-500">HMS: {edu.hms_id}</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm text-gray-500">{edu.formatted_date}</p>
                      </div>
                    </div>
                    
                    <div className="ml-11 space-y-4">
                      <div className="bg-blue-50 rounded-lg p-4">
                        <p className="text-xs text-blue-700 font-medium mb-2">Question:</p>
                        <p className="text-gray-800">{edu.question}</p>
                      </div>
                      
                      <div className="bg-green-50 rounded-lg p-4">
                        <p className="text-xs text-green-700 font-medium mb-2">Answer:</p>
                        <p className="text-gray-700 whitespace-pre-line">{edu.answer}</p>
                        {edu.doctor_name && (
                          <p className="text-xs text-gray-500 mt-2">— Dr. {edu.doctor_name}</p>
                        )}
                      </div>
                    </div>
                  </div>
                )) : (
                  <div className="p-12 text-center text-gray-500">
                    No education records found
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Patients Tab - Shows ALL patients from all sources */}
        {activeTab === 'patients' && (
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
              <div className="p-4 border-b border-gray-200 bg-gray-50 flex justify-between items-center">
                <h3 className="text-lg font-medium text-gray-900">Complete Patient Directory</h3>
                <span className="text-sm text-gray-500">
                  Total Patients: {allPatients.length}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Patient</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">HMS ID</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Appointments</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Follow-ups</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Questions</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Source</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Activity</th>
                      <th className="py-3 px-6 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredPatients.length > 0 ? filteredPatients.map((patient) => (
                      <tr 
                        key={patient.id} 
                        className="hover:bg-gray-50 transition-colors cursor-pointer"
                        onClick={() => {
                          // Create a patient object for the modal
                          const patientForModal = {
                            patient_id: patient.id,
                            patient_name: patient.name,
                            hms_id: patient.hms_id
                          };
                          handlePatientClick(patientForModal);
                        }}
                      >
                        <td className="py-4 px-6">
                          <div className="flex items-center">
                            <div className="w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white font-semibold text-sm mr-3">
                              {patient.name?.charAt(0) || '?'}
                            </div>
                            <p className="font-medium text-gray-900">{patient.name}</p>
                          </div>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-gray-600">{patient.hms_id}</p>
                        </td>
                        <td className="py-4 px-6">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-700">
                            {patient.appointment_count}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-green-50 text-green-700">
                            {patient.followup_count}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-purple-50 text-purple-700">
                            {patient.education_count}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <span className="inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                            {patient.source || 'unknown'}
                          </span>
                        </td>
                        <td className="py-4 px-6">
                          <p className="text-sm text-gray-500">
                            {patient.latest_activity ? formatDate(patient.latest_activity) : '—'}
                          </p>
                        </td>
                        <td className="py-4 px-6">
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              const patientForModal = {
                                patient_id: patient.id,
                                patient_name: patient.name,
                                hms_id: patient.hms_id
                              };
                              handlePatientClick(patientForModal);
                            }}
                            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
                          >
                            View
                          </button>
                        </td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan="8" className="py-8 text-center text-gray-500">
                          No patients found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Patient Details Modal */}
      {showPatientModal && selectedPatient && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl border border-gray-200 max-w-4xl w-full max-h-[90vh] overflow-y-auto shadow-xl">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white">
              <div>
                <h2 className="text-xl font-semibold text-gray-900">{selectedPatient.patient_name}</h2>
                <div className="flex items-center space-x-4 mt-1">
                  <p className="text-sm text-gray-500">HMS ID: {selectedPatient.hms_id || '—'}</p>
                  {selectedPatientDetails && (
                    <>
                      <span className="text-gray-300">•</span>
                      <p className="text-sm text-gray-500">Age: {selectedPatientDetails.age || '—'}</p>
                      <span className="text-gray-300">•</span>
                      <p className="text-sm text-gray-500">Gender: {selectedPatientDetails.gender || '—'}</p>
                    </>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowPatientModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {modalLoading ? (
              <div className="p-12 text-center">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-gray-200 border-t-blue-600"></div>
                <p className="text-gray-500 mt-4">Loading patient details...</p>
              </div>
            ) : (
              <div className="p-6 space-y-6">
                {/* Patient Stats */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Total Appointments</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {appointments.filter(a => a.patient_id === selectedPatient.patient_id).length}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Follow-ups</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {selectedPatient.followUps?.length || 0}
                    </p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-4">
                    <p className="text-sm text-gray-500">Questions Asked</p>
                    <p className="text-2xl font-semibold text-gray-900">
                      {selectedPatient.education?.length || 0}
                    </p>
                  </div>
                </div>

                {/* Appointments History */}
                <div>
                  <h3 className="text-lg font-medium text-gray-900 mb-4">Appointment History</h3>
                  <div className="space-y-3">
                    {appointments
                      .filter(a => a.patient_id === selectedPatient.patient_id)
                      .sort((a, b) => new Date(b.appointment_date) - new Date(a.appointment_date))
                      .map(apt => (
                        <div key={apt.id} className="bg-gray-50 rounded-lg p-4">
                          <div className="flex justify-between items-start">
                            <div>
                              <p className="font-medium text-gray-900">{formatDate(apt.appointment_date)} at {apt.appointment_time}</p>
                              <p className="text-sm text-gray-500">{apt.doctor_display}</p>
                            </div>
                            <span 
                              className="px-3 py-1 rounded-full text-xs font-medium"
                              style={{ 
                                backgroundColor: `${getSourceColor(apt.sourceDisplay)}20`,
                                color: getSourceColor(apt.sourceDisplay)
                              }}
                            >
                              {apt.sourceDisplay}
                            </span>
                          </div>
                        </div>
                      ))}
                  </div>
                </div>

                {/* Follow-up Responses */}
                {selectedPatient.followUps && selectedPatient.followUps.length > 0 && (
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Follow-up Responses</h3>
                    <div className="space-y-3">
                      {selectedPatient.followUps.map(fu => (
                        <div key={fu.id} className="bg-gray-50 rounded-lg p-4">
                          <div className="flex justify-between items-start mb-2">
                            <div>
                              <p className="font-medium text-gray-900">{fu.reminder_type?.replace(/_/g, ' ')}</p>
                              <p className="text-sm text-gray-500">Date: {formatDate(fu.followup_date)}</p>
                              <p className="text-xs text-gray-400">{fu.doctor_display}</p>
                            </div>
                            <span className={`px-3 py-1 rounded-full text-xs font-medium ${
                              fu.response_type === 'yes' ? 'bg-green-50 text-green-700' :
                              fu.response_type === 'no' ? 'bg-red-50 text-red-700' :
                              'bg-gray-50 text-gray-600'
                            }`}>
                              {fu.response_type === 'yes' ? 'Confirmed' :
                               fu.response_type === 'no' ? 'Declined' :
                               'No response'}
                            </span>
                          </div>
                          
                          {fu.response_text && (
                            <div className="mt-2 p-3 bg-white rounded-lg border border-gray-200">
                              <p className="text-sm text-gray-700">"{fu.response_text}"</p>
                              {fu.response_time && (
                                <p className="text-xs text-gray-400 mt-1">
                                  Received: {formatDateTime(fu.response_time)}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Education Records */}
                {selectedPatient.education && selectedPatient.education.length > 0 && (
                  <div>
                    <h3 className="text-lg font-medium text-gray-900 mb-4">Questions & Answers</h3>
                    <div className="space-y-4">
                      {selectedPatient.education.map(edu => (
                        <div key={edu.id} className="bg-gray-50 rounded-lg p-4">
                          <div className="mb-3">
                            <p className="text-xs text-blue-600 font-medium mb-1">Question:</p>
                            <p className="text-gray-800">{edu.question}</p>
                            <p className="text-xs text-gray-400 mt-1">{edu.formatted_date}</p>
                          </div>
                          <div>
                            <p className="text-xs text-green-600 font-medium mb-1">Answer:</p>
                            <p className="text-gray-700 whitespace-pre-line">{edu.answer}</p>
                            {edu.doctor_name && (
                              <p className="text-xs text-gray-500 mt-2">— Dr. {edu.doctor_name}</p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Global Styles */}
      <style>{`
        * {
          scrollbar-width: thin;
          scrollbar-color: #CBD5E1 #F1F5F9;
        }
        
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        
        ::-webkit-scrollbar-track {
          background: #F1F5F9;
        }
        
        ::-webkit-scrollbar-thumb {
          background: #CBD5E1;
          border-radius: 4px;
        }
        
        ::-webkit-scrollbar-thumb:hover {
          background: #94A3B8;
        }
        
        body {
          background: #F9FAFB;
          margin: 0;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif;
        }
        
        input[type="date"]::-webkit-calendar-picker-indicator {
          opacity: 0.5;
        }
        
        input[type="date"]::-webkit-calendar-picker-indicator:hover {
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
};

export default CommunicationDashboard;