import { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { LayoutDashboard, Users, Activity, Settings, Zap, Calendar, Phone, MessageSquare, FileText, Clock } from 'lucide-react';

const DAYS = [
  { id: "monday", label: "Monday", short: "Mon" },
  { id: "tuesday", label: "Tuesday", short: "Tue" },
  { id: "wednesday", label: "Wednesday", short: "Wed" },
  { id: "thursday", label: "Thursday", short: "Thu" },
  { id: "friday", label: "Friday", short: "Fri" },
  { id: "saturday", label: "Saturday", short: "Sat" },
  { id: "sunday", label: "Sunday", short: "Sun" },
];

const TIME_INTERVALS = [
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
];

const TIME_OPTIONS = [
  "6:00 AM", "6:30 AM", "7:00 AM", "7:30 AM", "8:00 AM", "8:30 AM", "9:00 AM", "9:30 AM",
  "10:00 AM", "10:30 AM", "11:00 AM", "11:30 AM", "12:00 PM", "12:30 PM", "1:00 PM", "1:30 PM",
  "2:00 PM", "2:30 PM", "3:00 PM", "3:30 PM", "4:00 PM", "4:30 PM", "5:00 PM", "5:30 PM",
  "6:00 PM", "6:30 PM", "7:00 PM", "7:30 PM", "8:00 PM", "8:30 PM", "9:00 PM", "9:30 PM", "10:00 PM"
];

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const OPDTimePageHospital = () => {
  const location = useLocation();
  const query = new URLSearchParams(location.search);
  const hospitalId = query.get("clinic_id");
  
  const [doctors, setDoctors] = useState([]);
  const [selectedDoctor, setSelectedDoctor] = useState("");
  const [loading, setLoading] = useState(true);
  const [doctorsLoading, setDoctorsLoading] = useState(true);
  const [schedule, setSchedule] = useState(() => {
    const initial = {};
    DAYS.forEach((day) => {
      initial[day.id] = {
        enabled: false,
        fromTime: "9:00 AM",
        toTime: "5:00 PM",
        interval: 30,
      };
    });
    return initial;
  });

  // Fetch doctors for the hospital
  const fetchDoctors = async () => {
  if (!hospitalId) return;
  
  try {
    console.log("Fetching doctors for hospital:", hospitalId);
    
    const response = await fetch(
      `${API_BASE_URL}/hms/users/data/whatsapp/get_doctors_by_hospital/${hospitalId}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("Doctors data received:", data);
    
    if (Array.isArray(data) && data.length > 0) {
      setDoctors(data);
      // Only set selected doctor if it's not already set or if it's the first load
      setSelectedDoctor(prevSelected => {
        // If there's no previous selection, use the first doctor
        if (!prevSelected) {
          return data[0].sys_user_id;
        }
        // If there is a previous selection, keep it if it exists in the new list
        const doctorExists = data.some(d => d.sys_user_id === prevSelected);
        return doctorExists ? prevSelected : data[0].sys_user_id;
      });
    } else {
      setDoctors([]);
      setSelectedDoctor(""); // Clear selection if no doctors
    }
  } catch (error) {
    console.error("Error fetching doctors:", error);
    setDoctors([]);
    setSelectedDoctor(""); // Clear selection on error
  } finally {
    setDoctorsLoading(false);
  }
};

  // Fetch schedule for selected doctor
  const fetchDoctorSchedule = async () => {
  if (!selectedDoctor) {
    console.log("No doctor selected, skipping schedule fetch");
    return;
  }
  
  try {
    console.log("Fetching schedule for doctor:", selectedDoctor);
    
    const response = await fetch(
      `${API_BASE_URL}/hms/users/data/whatsapp/get-opd_timings/${selectedDoctor}`,
      {
        method: "GET",
        headers: { "Content-Type": "application/json" }
      }
    );
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    console.log("Schedule data received for doctor", selectedDoctor, ":", data);
    
    if (data.status === "success" && data.timings && data.timings.length > 0) {
      // Create a NEW empty schedule object
      const newSchedule = {};
      
      // Initialize all days with default values
      DAYS.forEach(day => {
        newSchedule[day.id] = {
          enabled: false,
          fromTime: "9:00 AM",
          toTime: "5:00 PM",
          interval: 30,
        };
      });
      
      // Update with fetched timings
      data.timings.forEach(timing => {
        const dayId = DAYS.find(day => 
          day.label.toLowerCase() === timing.day.toLowerCase()
        )?.id;
        
        if (dayId) {
          newSchedule[dayId] = {
            enabled: true,
            fromTime: timing.from_time,
            toTime: timing.to_time,
            interval: parseInt(timing.interval) || 30
          };
        }
      });
      
      // Set the new schedule
      setSchedule(newSchedule);
      console.log("Schedule updated with fetched data for doctor:", selectedDoctor);
    } else {
      console.log("No schedule found for doctor:", selectedDoctor, "- using default empty schedule");
      // Reset to default schedule when no data is found
      const defaultSchedule = {};
      DAYS.forEach(day => {
        defaultSchedule[day.id] = {
          enabled: false,
          fromTime: "9:00 AM",
          toTime: "5:00 PM",
          interval: 30,
        };
      });
      setSchedule(defaultSchedule);
    }
  } catch (error) {
    console.error("Error fetching schedule for doctor", selectedDoctor, ":", error);
    // Reset to default schedule on error
    const defaultSchedule = {};
    DAYS.forEach(day => {
      defaultSchedule[day.id] = {
        enabled: false,
        fromTime: "9:00 AM",
        toTime: "5:00 PM",
        interval: 30,
      };
    });
    setSchedule(defaultSchedule);
  } finally {
    setLoading(false);
  }
};

  // Fetch hospital doctors when component loads
// Fetch hospital doctors when component loads
useEffect(() => {
  if (hospitalId) {
    fetchDoctors();
  } else {
    setDoctorsLoading(false);
    setLoading(false);
    setDoctors([]);
    setSelectedDoctor("");
  }
  
  // Cleanup function
  return () => {
    // Optional: cancel any pending requests if you implement abort controllers
  };
}, [hospitalId]); // Only depend on hospitalId

  // Fetch schedule when doctor selection changes
  // Fetch schedule when doctor selection changes
useEffect(() => {
  if (selectedDoctor) {
    setLoading(true);
    // Reset schedule to default values before fetching new data
    const defaultSchedule = {};
    DAYS.forEach((day) => {
      defaultSchedule[day.id] = {
        enabled: false,
        fromTime: "9:00 AM",
        toTime: "5:00 PM",
        interval: 30,
      };
    });
    setSchedule(defaultSchedule);
    
    // Fetch the new doctor's schedule
    fetchDoctorSchedule();
  }
}, [selectedDoctor]); // Make sure selectedDoctor is in the dependency array

  const toggleDay = (dayId) => {
    setSchedule((prev) => ({
      ...prev,
      [dayId]: { ...prev[dayId], enabled: !prev[dayId].enabled },
    }));
  };

  const updateSchedule = (dayId, field, value) => {
    setSchedule((prev) => ({
      ...prev,
      [dayId]: { ...prev[dayId], [field]: value },
    }));
  };

  const handleSave = async () => {
    if (!selectedDoctor) {
      alert("Please select a doctor first");
      return;
    }
    
    try {
      const timingsArray = [];
      
      DAYS.forEach(day => {
        const daySchedule = schedule[day.id];
        if (daySchedule.enabled) {
          timingsArray.push({
            day: day.label,
            from_time: daySchedule.fromTime,
            to_time: daySchedule.toTime,
            interval: daySchedule.interval.toString()
          });
        }
      });
      
      const requestData = {
        doctor_id: selectedDoctor,
        timings: timingsArray
      };
      
      console.log("Saving schedule:", requestData);
      
      const response = await fetch(
        `${API_BASE_URL}/hms/users/data/whatsapp/save-opd_timings`,
        {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify(requestData)
        }
      );
      
      const result = await response.json();
      
      console.log("Save response:", result);
      
      if (result.status === "success") {
        alert(`Schedule ${result.action} successfully for ${getSelectedDoctorName()}!`);
        // Refresh schedule data after saving
        await fetchDoctorSchedule();
      } else {
        alert(`Error: ${result.message}`);
      }
      
    } catch (error) {
      console.error("Save failed:", error);
      alert("Failed to save schedule");
    }
  };

  const getSelectedDoctorName = () => {
    const doctor = doctors.find(d => d.sys_user_id === selectedDoctor);
    return doctor ? `Dr. ${doctor.name}` : "Selected Doctor";
  };

  const getSelectedDoctorSpecialization = () => {
    const doctor = doctors.find(d => d.sys_user_id === selectedDoctor);
    return doctor ? doctor.specialization : "";
  };

  // Show error if no hospitalId in URL
  if (!hospitalId) {
    return (
      <div className="min-h-screen w-full relative overflow-hidden flex items-center justify-center" style={{
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 100%)',
      }}>
        <div className="dark-glass-card-strong rounded-2xl p-8 max-w-md text-center">
          <h1 className="text-2xl font-semibold mb-3 text-red-400">No Hospital ID Provided</h1>
          <p className="text-gray-400 mb-4">Please provide a clinic_id in the URL query parameters.</p>
          <p className="text-gray-500 text-sm">
            Example: <code>/opd-time?clinic_id=HSP-d8b52915-400b-4b18-8328-a546a6c2f0af</code>
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <style>{`
        @keyframes slideInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-10px); }
        }

        @keyframes pulse-glow {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.7; }
        }

        .animate-slide-in {
          animation: slideInUp 0.5s ease-out forwards;
        }

        .animate-float {
          animation: float 3s ease-in-out infinite;
        }

        .animate-pulse-glow {
          animation: pulse-glow 2s ease-in-out infinite;
        }

        .dark-glass-card {
          background: rgba(15, 23, 42, 0.7);
          backdrop-filter: blur(30px);
          -webkit-backdrop-filter: blur(30px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          box-shadow: 0 8px 32px 0 rgba(0, 0, 0, 0.4);
        }

        .dark-glass-card-strong {
          background: rgba(15, 23, 42, 0.85);
          backdrop-filter: blur(40px);
          -webkit-backdrop-filter: blur(40px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          box-shadow: 
            0 8px 32px 0 rgba(0, 0, 0, 0.5),
            inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
        }

        .dark-glass-card-active {
          background: rgba(30, 41, 59, 0.7);
          backdrop-filter: blur(35px);
          -webkit-backdrop-filter: blur(35px);
          border: 1.5px solid rgba(56, 189, 248, 0.4);
          box-shadow: 
            0 8px 32px 0 rgba(56, 189, 248, 0.2),
            inset 0 1px 0 0 rgba(255, 255, 255, 0.1);
        }

        .hover-lift {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        }

        .hover-lift:hover {
          transform: translateY(-4px);
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        }

        .select-dark-glass {
          background: rgba(30, 41, 59, 0.7);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: #e2e8f0;
          transition: all 0.3s ease;
        }

        .select-dark-glass:hover {
          background: rgba(41, 51, 71, 0.8);
          border-color: rgba(56, 189, 248, 0.5);
          box-shadow: 0 4px 20px rgba(56, 189, 248, 0.2);
        }

        .select-dark-glass:focus {
          background: rgba(51, 65, 85, 0.9);
          border-color: rgba(56, 189, 248, 0.6);
          box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.1);
          outline: none;
        }

        .button-dark-glass {
          background: linear-gradient(135deg, 
            rgba(56, 189, 248, 0.9) 0%, 
            rgba(14, 165, 233, 0.9) 50%, 
            rgba(2, 132, 199, 0.9) 100%);
          backdrop-filter: blur(15px);
          border: 1px solid rgba(255, 255, 255, 0.15);
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }

        .button-dark-glass::before {
          content: '';
          position: absolute;
          top: 0;
          left: -100%;
          width: 100%;
          height: 100%;
          background: linear-gradient(90deg, 
            transparent, 
            rgba(255, 255, 255, 0.2), 
            transparent);
          transition: left 0.6s;
        }

        .button-dark-glass:hover::before {
          left: 100%;
        }

        .button-dark-glass:hover {
          transform: translateY(-2px);
          box-shadow: 
            0 12px 32px rgba(56, 189, 248, 0.4),
            0 4px 8px rgba(0, 0, 0, 0.3);
        }

        .button-dark-glass:active {
          transform: translateY(0);
        }

        .interval-button-dark {
          background: rgba(30, 41, 59, 0.7);
          backdrop-filter: blur(20px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          transition: all 0.2s ease;
        }

        .interval-button-dark:hover {
          background: rgba(41, 51, 71, 0.8);
        }

        .interval-button-dark-active {
          background: linear-gradient(135deg, #38bdf8 0%, #0ea5e9 50%, #0284c7 100%);
          border-color: transparent;
          box-shadow: 
            0 4px 16px rgba(56, 189, 248, 0.4),
            inset 0 1px 0 rgba(255, 255, 255, 0.2);
        }

        .toggle-switch-dark {
          transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          position: relative;
          overflow: hidden;
        }

        .toggle-switch-dark::before {
          content: '';
          position: absolute;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: linear-gradient(135deg, 
            rgba(56, 189, 248, 0.4), 
            rgba(14, 165, 233, 0.4));
          opacity: 0;
          transition: opacity 0.3s;
        }

        .toggle-switch-dark:hover::before {
          opacity: 1;
        }

        .toggle-switch-dark:hover {
          transform: scale(1.05);
        }

        .glow-text {
          text-shadow: 0 0 20px rgba(56, 189, 248, 0.7);
        }

        .glow-border {
          box-shadow: 0 0 20px rgba(56, 189, 248, 0.3);
        }

        .fade-in {
          animation: fadeIn 0.5s ease-out;
        }

        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        /* Custom scrollbar */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }

        ::-webkit-scrollbar-track {
          background: rgba(15, 23, 42, 0.3);
          border-radius: 4px;
        }

        ::-webkit-scrollbar-thumb {
          background: linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%);
          border-radius: 4px;
          transition: all 0.3s;
        }

        ::-webkit-scrollbar-thumb:hover {
          background: linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%);
        }
      `}</style>

      <div className="min-h-screen w-full relative overflow-hidden" style={{
        background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a1a 50%, #0f172a 100%)',
      }}>
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
              onClick={() => window.location.href = `/clinic-dashboard?clinic_id=${hospitalId}`}
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
              onClick={() => window.location.href = `/clinic-doctor-register?clinic_id=${hospitalId}`}
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

            {/* Menu Item: Communication node */}
            <div
              onClick={() => window.location.href = `/appointment-dashboard?clinic_id=${hospitalId}`}
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
              <MessageSquare size={20} />
              <span style={{ fontSize: "15px", fontWeight: "500" }}>Communication node</span>
            </div>

            {/* Menu Item: Clinical Engine */}
            <div
              onClick={() => window.location.href = `/login`}
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

            {/* Menu Item: OPD Doctor Schedule (Current Page - Active) */}
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
              <Clock size={20} />
              <span style={{ fontSize: "15px", fontWeight: "500" }}>OPD Schedule</span>
            </div>

            {/* Menu Item: Pre Screening Questions */}
            <div
              onClick={() => window.location.href = `/pre-screening-questions?clinic_id=${hospitalId}`}
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
              onClick={() => window.location.href = `/clinic-dashboard?clinic_id=${hospitalId}`}
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
        <div style={{ marginLeft: "280px" }}>
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-cyan-500/10 rounded-full blur-3xl animate-float"></div>
          <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-sky-500/5 rounded-full blur-3xl animate-float" style={{animationDelay: '1s'}}></div>
          <div className="absolute top-3/4 left-1/2 w-64 h-64 bg-blue-500/10 rounded-full blur-3xl animate-pulse-glow"></div>
        </div>

        <div className="relative z-10 w-full px-4 py-8">
          <div className="max-w-5xl mx-auto">
            <header className="dark-glass-card-strong rounded-2xl p-6 mb-8 text-center animate-slide-in glow-border">
              <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-cyan-400 to-sky-400 bg-clip-text text-transparent">
                Hospital OPD Schedule Management
              </h1>
              <p className="text-gray-400 font-medium">Manage doctor schedules for your hospital</p>
            </header>

            {/* Doctor Selection Card */}
            <div className="dark-glass-card-strong rounded-2xl p-6 mb-8 animate-slide-in">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-cyan-100 mb-1">Select Doctor</h2>
                  <p className="text-gray-400 text-sm">Choose a doctor to manage their OPD schedule</p>
                </div>
                
                <div className="min-w-[300px]">
                  {doctorsLoading ? (
                    <div className="flex items-center justify-center gap-2 py-2">
                      <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
                      <span className="text-cyan-300">Loading doctors...</span>
                    </div>
                  ) : doctors.length > 0 ? (
                    <select
                      value={selectedDoctor}
                      onChange={(e) => setSelectedDoctor(e.target.value)}
                      className="select-dark-glass w-full px-4 py-3 rounded-xl text-gray-200 text-sm focus:ring-2 focus:ring-cyan-500/30"
                    >
                      {doctors.map((doctor) => (
                        <option 
                          key={doctor.sys_user_id} 
                          value={doctor.sys_user_id}
                          className="bg-slate-900 text-gray-200"
                        >
                          Dr. {doctor.name} - {doctor.specialization}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <div className="text-center py-3">
                      <p className="text-amber-400">No doctors found for this hospital</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Selected Doctor Info */}
              {selectedDoctor && doctors.length > 0 && (
                <div className="dark-glass-card rounded-xl p-4 fade-in">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-cyan-100">
                        {getSelectedDoctorName()}
                      </h3>
                      <p className="text-cyan-300/80 text-sm">
                        {getSelectedDoctorSpecialization()}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-gray-400 text-sm">Doctor ID</p>
                      <p className="text-gray-300 text-xs font-mono">{selectedDoctor}</p>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Schedule Management Section */}
            {selectedDoctor && (
              <main className="dark-glass-card-strong rounded-2xl p-6 animate-slide-in">
                <div className="flex items-center justify-between mb-6">
                  <div>
                    <h2 className="text-xl font-semibold text-cyan-100">Weekly Schedule</h2>
                    <p className="text-gray-400 text-sm">
                      {getSelectedDoctorName()} • {getSelectedDoctorSpecialization()}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className={`w-2 h-2 rounded-full ${loading ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></div>
                    <span className="text-sm text-gray-400">
                      {loading ? 'Loading schedule...' : 'Ready'}
                    </span>
                  </div>
                </div>

                <div className="days-grid grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
                  {DAYS.map((day, index) => {
                    const daySchedule = schedule[day.id];
                    return (
                      <div
                        key={day.id}
                        className={`rounded-xl p-4 hover-lift ${daySchedule.enabled ? 'dark-glass-card-active' : 'dark-glass-card'}`}
                        style={{
                          animationDelay: `${index * 0.05}s`,
                        }}
                      >
                        <div className="flex items-center justify-between mb-4">
                          <div className="flex items-center gap-3">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                              daySchedule.enabled 
                                ? 'bg-cyan-900/50 text-cyan-300' 
                                : 'bg-gray-800/50 text-gray-400'
                            }`}>
                              <span className="text-sm font-bold">{day.short}</span>
                            </div>
                            <span className="text-sm font-semibold text-gray-200">{day.label}</span>
                          </div>
                          <button
                            onClick={() => toggleDay(day.id)}
                            className="toggle-switch-dark w-12 h-6 rounded-full relative p-1"
                            style={{
                              background: daySchedule.enabled
                                ? 'linear-gradient(135deg, #38bdf8 0%, #0ea5e9 100%)'
                                : 'rgba(71, 85, 105, 0.5)',
                              boxShadow: daySchedule.enabled
                                ? '0 2px 12px rgba(56, 189, 248, 0.4)'
                                : 'none'
                            }}
                          >
                            <span
                              className="block w-4 h-4 rounded-full bg-white transition-all duration-300 shadow-lg"
                              style={{
                                transform: daySchedule.enabled ? 'translateX(24px)' : 'translateX(0px)'
                              }}
                            />
                          </button>
                        </div>

                        <div
                          className="space-y-3 transition-all duration-300"
                          style={{
                            opacity: daySchedule.enabled ? 1 : 0.5,
                            pointerEvents: daySchedule.enabled ? 'auto' : 'none'
                          }}
                        >
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="block text-xs font-medium text-gray-400 mb-1">
                                Start Time
                              </label>
                              <select
                                value={daySchedule.fromTime}
                                onChange={(e) => updateSchedule(day.id, "fromTime", e.target.value)}
                                className="select-dark-glass w-full px-3 py-2 rounded-lg text-gray-200 text-xs"
                              >
                                {TIME_OPTIONS.map((time) => (
                                  <option key={time} value={time} className="bg-slate-900">{time}</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-medium text-gray-400 mb-1">
                                End Time
                              </label>
                              <select
                                value={daySchedule.toTime}
                                onChange={(e) => updateSchedule(day.id, "toTime", e.target.value)}
                                className="select-dark-glass w-full px-3 py-2 rounded-lg text-gray-200 text-xs"
                              >
                                {TIME_OPTIONS.map((time) => (
                                  <option key={time} value={time} className="bg-slate-900">{time}</option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-gray-400 mb-1">
                              Slot Duration
                            </label>
                            <div className="flex gap-2">
                              {TIME_INTERVALS.map((interval) => (
                                <button
                                  key={interval.value}
                                  onClick={() => updateSchedule(day.id, "interval", interval.value)}
                                  className={`interval-button-dark flex-1 py-2 rounded-lg text-xs font-medium transition-all ${
                                    daySchedule.interval === interval.value
                                      ? 'interval-button-dark-active text-white'
                                      : 'text-gray-300'
                                  }`}
                                >
                                  {interval.label}
                                </button>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Schedule Summary */}
                <div className="dark-glass-card rounded-xl p-4 mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="text-sm font-semibold text-cyan-100">Schedule Summary</h3>
                    <span className="text-xs text-gray-400">
                      {DAYS.filter((day) => schedule[day.id].enabled).length} days active
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {DAYS.filter((day) => schedule[day.id].enabled).length === 0 ? (
                      <div className="flex items-center gap-2 text-gray-500 text-sm py-2">
                        <div className="w-2 h-2 rounded-full bg-gray-600"></div>
                        No working days scheduled yet
                      </div>
                    ) : (
                      DAYS.filter((day) => schedule[day.id].enabled).map((day) => {
                        const s = schedule[day.id];
                        return (
                          <span
                            key={day.id}
                            className="dark-glass-card px-3 py-2 rounded-full text-xs font-medium text-cyan-200 flex items-center gap-2"
                          >
                            <span className="w-2 h-2 rounded-full bg-cyan-400"></span>
                            {day.short}: <span className="text-gray-300">{s.fromTime} - {s.toTime}</span>
                          </span>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Action Buttons */}
                <div className="flex flex-col sm:flex-row gap-4 justify-center">
                  <button
                    onClick={handleSave}
                    disabled={loading || doctorsLoading}
                    className="button-dark-glass px-8 py-3 rounded-xl text-white font-semibold text-sm min-w-[200px] disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <span className="flex items-center justify-center gap-2">
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                        Saving...
                      </span>
                    ) : doctorsLoading ? (
                      "Loading..."
                    ) : (
                      <span className="flex items-center justify-center gap-2">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
                        </svg>
                        Save Schedule
                      </span>
                    )}
                  </button>
                </div>
              </main>
            )}

            {/* No Doctor Selected Message */}
            {!selectedDoctor && doctors.length > 0 && (
              <div className="dark-glass-card-strong rounded-2xl p-8 text-center">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-slate-800/50 flex items-center justify-center">
                  <svg className="w-8 h-8 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4"></path>
                  </svg>
                </div>
                <h3 className="text-lg font-semibold text-cyan-100 mb-2">Select a Doctor</h3>
                <p className="text-gray-400 mb-6">Choose a doctor from the dropdown above to manage their schedule</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
    </>
  );
};

export default OPDTimePageHospital;