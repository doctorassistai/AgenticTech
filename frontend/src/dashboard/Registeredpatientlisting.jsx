import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const PatientList = () => {
  const location = useLocation();
  const [patients, setPatients] = useState([]);
  const [filteredPatients, setFilteredPatients] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [expandedPatient, setExpandedPatient] = useState(null);
  const [searchCriteria, setSearchCriteria] = useState('all');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [visitHistory, setVisitHistory] = useState([]);
  const [visitLoading, setVisitLoading] = useState(false);
  
  // Appointment States
  const [showAppointmentForm, setShowAppointmentForm] = useState(null);
  const [appointmentDate, setAppointmentDate] = useState("");
  const [appointmentTime, setAppointmentTime] = useState("");
  const [chiefComplaint, setChiefComplaint] = useState("");
  const [appointmentLoading, setAppointmentLoading] = useState(false);

  // Attachment States
  const [attachments, setAttachments] = useState([]);
  const [attachmentLoading, setAttachmentLoading] = useState(false);

  // Communication/Follow-up States
  const [followUps, setFollowUps] = useState([]);
  const [followUpLoading, setFollowUpLoading] = useState(false);
  
  // Pending Requests States
  const [pendingRequests, setPendingRequests] = useState([]);
  const [pendingRequestsLoading, setPendingRequestsLoading] = useState(false);

  // Appointment List State
  const [appointments, setAppointments] = useState([]);
  const [appointmentsLoading, setAppointmentsLoading] = useState(false);

  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

  // Get doctor ID from URL
  const doctorId = useMemo(() => {
    const query = new URLSearchParams(location.search);
    return query.get("doctor_id");
  }, [location]);
  
  console.log("Doctor ID:", doctorId);
  
  // Fetch patients
  useEffect(() => {
    const fetchPatients = async () => {
      if (!doctorId) {
        setError('Doctor ID not found in URL');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);

        const response = await fetch(
          `${API_BASE_URL}hms/users/patients/get_all_patients?doctor_id=${doctorId}`
        );

        console.log("📡 Raw Response Object:", response);

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        console.log("📦 RAW API RESPONSE:", data);
        console.log("📊 Response Type:", typeof data);
        console.log("📊 Is Array?", Array.isArray(data));

        // Extract patients array from the response object
        let patientsArray = [];
        
        if (Array.isArray(data)) {
          patientsArray = data;
        } else if (data?.patients && Array.isArray(data.patients)) {
          patientsArray = data.patients;
        } else if (data?.data && Array.isArray(data.data)) {
          patientsArray = data.data;
        }

        console.log("✅ Final Patients Array:", patientsArray);
        console.log("👥 Patient Count:", patientsArray.length);

        setPatients(patientsArray);
        setFilteredPatients(patientsArray);
        setError(null);
      } catch (err) {
        setError('Failed to fetch patients. Please try again.');
        console.error('❌ Error fetching patients:', err);

        setPatients([]);
        setFilteredPatients([]);
      } finally {
        setLoading(false);
      }
    };

    fetchPatients();
  }, [doctorId, API_BASE_URL]);

  // Fetch Appointments - UPDATED with correct endpoint
  const fetchAppointments = async () => {
    if (!doctorId) return;
    
    try {
      setAppointmentsLoading(true);
      const response = await fetch(
        `https://doctorassist.ai/api/hms/users/doctors/doctor_appointments/${doctorId}`
      );

      const data = await response.json();
      console.log("📅 Appointments Data:", data);

      if (data.status === "success" && Array.isArray(data.appointments)) {
        // Map the appointments to match your expected format
        const formattedAppointments = data.appointments.map(appt => ({
          id: appt.appointment_id,
          appointment_id: appt.appointment_id,
          patient_id: appt.patient_id,
          sys_user_id: appt.sys_user_id,
          patient_name: appt.patient_name,
          patient_phone: appt.patient_phone,
          appointment_date: appt.date, // This is the appointment date
          date: appt.date, // Keep both for compatibility
          scheduled_time: appt.scheduled_time,
          visit_type: appt.visit_type,
          status: appt.status,
          chief_complaint: appt.chief_complaint,
          updated_at: appt.updated_at,
          hms_id: appt.patient_id // Use patient_id as hms_id for matching
        }));

        console.log("✅ Formatted Appointments:", formattedAppointments);
        console.log("📊 Total appointments:", formattedAppointments.length);
        
        // Log all appointment dates for debugging
        const appointmentDates = formattedAppointments.map(a => a.date);
        console.log("📆 Appointment dates in range:", appointmentDates);
        
        setAppointments(formattedAppointments);
      } else {
        console.warn("No appointments found or invalid response format:", data);
        setAppointments([]);
      }
    } catch (error) {
      console.error("❌ Error fetching appointments:", error);
      setAppointments([]);
    } finally {
      setAppointmentsLoading(false);
    }
  };

  // Debug effect to check appointments after fetch
  useEffect(() => {
    if (appointments.length > 0) {
      console.group("📅 APPOINTMENTS DEBUG");
      console.log("Total appointments:", appointments.length);
      
      // Group appointments by date
      const appointmentsByDate = appointments.reduce((acc, appt) => {
        const date = appt.date;
        if (!acc[date]) acc[date] = [];
        acc[date].push(appt);
        return acc;
      }, {});
      
      console.log("Appointments by date:", appointmentsByDate);
      
      // Log all unique dates
      const uniqueDates = [...new Set(appointments.map(a => a.date))].sort();
      console.log("Unique appointment dates:", uniqueDates);
      
      console.groupEnd();
    }
  }, [appointments]);

  // Load Appointments
  useEffect(() => {
    if (doctorId) {
      fetchAppointments();
    }
  }, [doctorId]);

  // Fetch Pending Requests
  const fetchPendingRequests = async (patientId) => {
    try {
      setPendingRequestsLoading(true);
      
      // Mock data for pending requests - replace with actual API endpoint when available
      const mockPendingRequests = [
        {
          id: 1,
          type: "Patient Request",
          description: "Prescription refill request",
          date: new Date().toISOString().split('T')[0],
          status: "pending"
        },
        {
          id: 2,
          type: "Communication",
          description: "Follow-up required",
          date: new Date().toISOString().split('T')[0],
          status: "unread"
        }
      ];

      setPendingRequests(mockPendingRequests);
    } catch (error) {
      console.error("Error fetching pending requests:", error);
      setPendingRequests([]);
    } finally {
      setPendingRequestsLoading(false);
    }
  };

  // Fetch Visit History (Updated to GET endpoint)
  const fetchVisitHistory = async (patientId, doctorId) => {
    try {
      setVisitLoading(true);

      const response = await fetch(
        `https://doctorassist.ai/api/hms/users/data/context/date-wise-consultation-summary/${patientId}/${doctorId}`
      );

      const data = await response.json();
      console.log("Visit History:", data);

      if (data.status === "success" && data.date_wise_summary) {
        const formattedVisits = data.date_wise_summary
          .sort((a, b) => new Date(b.date) - new Date(a.date))
          .map(visit => ({
            ...visit,
            doctor_name: "Dr. JOE J",
            specialization: "General"
          }));

        setVisitHistory(formattedVisits);
      } else {
        setVisitHistory([]);
      }
    } catch (error) {
      console.error("Error fetching visit history:", error);
      setVisitHistory([]);
    } finally {
      setVisitLoading(false);
    }
  };

  // Fetch Attachments with URL (Updated to handle correct data structure)
  const fetchAttachments = async (patientId) => {
    try {
      setAttachmentLoading(true);

      const response = await fetch(
        `https://doctorassist.ai/api/hms/users/data/context/get_document_categories_by_patient?patient_id=${patientId}`
      );

      const data = await response.json();
      console.log("Attachments Data:", data);

      if (data.status === "success" && Array.isArray(data.data)) {
        // Filter to keep only documents that have file_url directly in the object
        const filesWithUrls = data.data
          .filter((doc) => doc.file_url) // Check if file_url exists directly
          .map(doc => ({
            ...doc,
            file_name: doc.document_id, // Use document_id as filename
            file_type: doc.category || 'unknown'
          }));

        setAttachments(filesWithUrls);
        console.log("Attachments with URLs:", filesWithUrls);
      } else {
        setAttachments([]);
      }
    } catch (error) {
      console.error("Error fetching attachments:", error);
      setAttachments([]);
    } finally {
      setAttachmentLoading(false);
    }
  };

  // Fetch Follow-ups with enhanced status tracking
  const fetchFollowUps = async (patientId) => {
    try {
      setFollowUpLoading(true);
      
      console.log("Fetching follow-ups for patient:", patientId);
      console.log("Doctor ID:", doctorId);

      const response = await fetch(
        `https://doctorassist.ai/api/hms/users/data/whatsapp/follow-ups/${doctorId}`
      );

      const data = await response.json();
      console.log("Raw Follow-ups Data:", data);

      if (Array.isArray(data)) {
        console.log("Total follow-ups received:", data.length);
        
        // Log all patient_ids from follow-ups for debugging
        const allPatientIds = data.map(item => item.patient_id);
        console.log("All patient IDs in follow-ups:", allPatientIds);
        
        console.log("Looking for patient_id:", patientId);
        
        // Check if any match
        const matchingItems = data.filter(item => item.patient_id === patientId);
        console.log("Matching items found:", matchingItems.length);

        if (matchingItems.length > 0) {
          console.log("First matching item:", matchingItems[0]);
        }

        // Filter for specific patient and enhance with status
        const patientFollowUps = data
          .filter(item => item.patient_id === patientId)
          .map(item => ({
            ...item,
            status: item.patient_response ? 'replied' : 
                   (item.reminder_sent ? 'sent' : 'pending'),
            communication_type: 'follow-up',
            message_status: item.patient_response ? 'read' : 
                          (item.reminder_sent ? 'sent' : 'unread'),
            patient_replied: !!item.patient_response,
            reply_text: item.patient_response?.text || null,
            reply_date: item.patient_response?.received_at || null
          }))
          .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

        console.log("Enhanced Follow-ups for this patient:", patientFollowUps);
        setFollowUps(patientFollowUps);
      } else {
        console.log("Follow-ups data is not an array:", data);
        setFollowUps([]);
      }
    } catch (error) {
      console.error("Follow-up fetch error:", error);
      setFollowUps([]);
    } finally {
      setFollowUpLoading(false);
    }
  };

  // Calculate age from date of birth
  const calculateAge = (dateOfBirth) => {
    if (!dateOfBirth) return 'N/A';
    try {
      const today = new Date();
      const birthDate = new Date(dateOfBirth);
      let age = today.getFullYear() - birthDate.getFullYear();
      const monthDiff = today.getMonth() - birthDate.getMonth();
      
      if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
        age--;
      }
      
      return age;
    } catch (error) {
      return 'N/A';
    }
  };

  // Format date
  const formatDate = (dateString) => {
    if (!dateString) return 'N/A';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
      });
    } catch (error) {
      return 'N/A';
    }
  };

  // Debug function to log patient-appointment matching
  const debugPatientAppointmentMatch = (patient, appointments) => {
    console.group(`🔍 Debug: Matching patient ${patient.name} (${patient.sys_user_id}) with appointments`);
    
    appointments.forEach((appt, index) => {
      console.log(`Appointment ${index + 1}:`, {
        id: appt.id,
        patient_id: appt.patient_id,
        hms_id: appt.hms_id,
        patient_name: appt.patient_name,
        date: appt.appointment_date || appt.date || appt.scheduled_date
      });
      
      // Check each matching strategy
      const matchByHmsId = appt.hms_id && patient.hms_id && appt.hms_id === patient.hms_id;
      const matchByPatientId = appt.patient_id && patient.sys_user_id && appt.patient_id === patient.sys_user_id;
      const matchByHmsIdAsPatientId = appt.patient_id && patient.hms_id && appt.patient_id === patient.hms_id;
      const matchByName = appt.patient_name && patient.name && 
                         appt.patient_name.toLowerCase() === patient.name.toLowerCase();
      const matchByStringId = appt.patient_id && patient.sys_user_id && 
                             String(appt.patient_id) === String(patient.sys_user_id);
      const matchByPhone = appt.patient_phone && patient.mobile_no && 
                          appt.patient_phone === patient.mobile_no;
      
      if (matchByHmsId || matchByPatientId || matchByHmsIdAsPatientId || matchByName || matchByStringId || matchByPhone) {
        console.log(`✅ MATCH found! Strategies:`, {
          matchByHmsId,
          matchByPatientId,
          matchByHmsIdAsPatientId,
          matchByName,
          matchByStringId,
          matchByPhone
        });
      }
    });
    
    console.groupEnd();
  };

  /**
   * HOW APPOINTMENT FILTERING WORKS:
   * 
   * This function checks if a patient has any appointments within the selected date range.
   * It uses multiple matching strategies to link appointments to patients because:
   * 1. Different ID fields might be used (sys_user_id, patient_id, hms_id)
   * 2. Some records might have inconsistent ID formats (string vs number)
   * 3. Patient names might be used as fallback
   * 
   * The filtering process:
   * 1. Get all appointments from the appointments state
   * 2. Filter appointments that belong to this patient using 9 matching strategies
   * 3. Extract the appointment date from various possible field names
   * 4. Compare the appointment date with the selected fromDate and toDate
   * 5. Return true if ANY appointment falls within the date range
   */
  const hasAppointmentsInDateRange = (patient, from, to) => {
    // If no date range is selected, this filter doesn't apply
    if (!from && !to) return true;
    
    // Find all appointments for this patient using the matching strategies
    const patientAppointments = appointments.filter(appt => {
      // Get the appointment date from various possible field names
      const apptDate = appt.appointment_date || appt.date || appt.scheduled_date;
      if (!apptDate) return false;
      
      // Strategy 1: Match by hms_id
      if (appt.hms_id && patient.hms_id && appt.hms_id === patient.hms_id) {
        return true;
      }
      
      // Strategy 2: Match by patient_id/sys_user_id
      if (appt.patient_id && patient.sys_user_id && appt.patient_id === patient.sys_user_id) {
        return true;
      }
      
      // Strategy 3: Match by patient_id with patient's hms_id (for old patients)
      if (appt.patient_id && patient.hms_id && appt.patient_id === patient.hms_id) {
        return true;
      }
      
      // Strategy 4: Match by patient name (if available)
      if (appt.patient_name && patient.name && 
          appt.patient_name.toLowerCase() === patient.name.toLowerCase()) {
        return true;
      }
      
      // Strategy 5: Check if appointment has patient_id that matches patient's sys_user_id as string
      if (appt.patient_id && patient.sys_user_id && 
          String(appt.patient_id) === String(patient.sys_user_id)) {
        return true;
      }
      
      // Strategy 6: Check if appointment has patient_id that matches patient's hms_id as string
      if (appt.patient_id && patient.hms_id && 
          String(appt.patient_id) === String(patient.hms_id)) {
        return true;
      }
      
      // Strategy 7: Check if appointment has patient_id that matches patient's sys_user_id as number
      if (appt.patient_id && patient.sys_user_id && 
          Number(appt.patient_id) === Number(patient.sys_user_id)) {
        return true;
      }
      
      // Strategy 8: Check if appointment has patient_id that matches patient's hms_id as number
      if (appt.patient_id && patient.hms_id && 
          Number(appt.patient_id) === Number(patient.hms_id)) {
        return true;
      }
      
      // Strategy 9: Match by phone number
      if (appt.patient_phone && patient.mobile_no && 
          appt.patient_phone === patient.mobile_no) {
        return true;
      }
      
      return false;
    });

    // Log for debugging (only in development)
    if (patientAppointments.length > 0 && (from || to)) {
      console.log(`Patient ${patient.name} has ${patientAppointments.length} appointments:`, 
        patientAppointments.map(a => ({ 
          date: a.appointment_date || a.date || a.scheduled_date, 
          id: a.id 
        })));
    }

    // Check if any appointment falls within the date range
    return patientAppointments.some(appt => {
      // Try multiple date field names
      const apptDateStr = appt.appointment_date || appt.date || appt.scheduled_date;
      if (!apptDateStr) return false;

      // Normalize to YYYY-MM-DD (remove time part if present)
      const normalizedApptDate = apptDateStr.split('T')[0] || apptDateStr;

      // Compare with from date
      if (from) {
        const fromDateStr = from.toISOString().split('T')[0];
        if (normalizedApptDate < fromDateStr) return false;
      }
      
      // Compare with to date
      if (to) {
        const toDateStr = to.toISOString().split('T')[0];
        if (normalizedApptDate > toDateStr) return false;
      }

      return true;
    });
  };

  // Helper function to check if patient's registration date is in range
  const isRegistrationDateInRange = (patient, from, to) => {
    if (!patient.created_at) return false;
    
    const regDateStr = patient.created_at?.split("T")[0];

    if (from) {
      const fromDateStr = from.toISOString().split('T')[0];
      if (regDateStr < fromDateStr) return false;
    }
    
    if (to) {
      const toDateStr = to.toISOString().split('T')[0];
      if (regDateStr > toDateStr) return false;
    }

    return true;
  };

  // Clear all filters function
  const clearFilters = () => {
    setSearchTerm('');
    setSearchCriteria('all');
    setFromDate('');
    setToDate('');
    // Reset to original patients list
    setFilteredPatients(patients);
  };

  // Filter patients effect
  useEffect(() => {
    let updatedPatients = Array.isArray(patients) ? patients : [];

    // Step 1: Apply search filter
    if (searchTerm.trim()) {
      const searchTermLower = searchTerm.toLowerCase();

      updatedPatients = updatedPatients.filter(patient => {
        if (!patient) return false;

        const patientAge = calculateAge(patient.date_of_birth);
        const regDate = formatDate(patient.created_at).toLowerCase();

        switch (searchCriteria) {
          case 'name':
            return patient.name?.toLowerCase().includes(searchTermLower);
          case 'hms_id':
            return patient.hms_id?.toLowerCase().includes(searchTermLower);
          case 'date':
            return regDate.includes(searchTermLower);
          case 'age':
            return patientAge.toString().includes(searchTermLower);
          case 'all':
          default:
            return (
              patient.name?.toLowerCase().includes(searchTermLower) ||
              patient.hms_id?.toLowerCase().includes(searchTermLower) ||
              regDate.includes(searchTermLower) ||
              patientAge.toString().includes(searchTermLower)
            );
        }
      });
    }

    // Step 2: Apply date range filter - ONLY BY APPOINTMENT DATE
if (fromDate || toDate) {
  const from = fromDate ? new Date(fromDate) : null;
  const to = toDate ? new Date(toDate) : null;

  if (from) from.setHours(0, 0, 0, 0);
  if (to) to.setHours(23, 59, 59, 999);

  updatedPatients = updatedPatients.filter(patient => {

    // Get appointments only for this patient
    const patientAppointments = appointments.filter(
      appt => appt.sys_user_id === patient.sys_user_id
    );

    // Check if ANY appointment is inside selected range
    return patientAppointments.some(appt => {
      if (!appt.date) return false;

      const appointmentDate = new Date(appt.date);

      if (from && appointmentDate < from) return false;
      if (to && appointmentDate > to) return false;

      return true;
    });

  });
}

    // Step 3: Merge appointment data with patients for display (today/upcoming badges)
    const today = new Date().toISOString().split("T")[0];

    updatedPatients = updatedPatients.map(patient => {
      // Find all appointments for this patient (same matching logic as above)
      const patientAppointments = appointments.filter(appt => {
        // Get appointment date from various possible field names
        const apptDate = appt.appointment_date || appt.date || appt.scheduled_date;
        
        // Strategy 1: Match by hms_id
        if (appt.hms_id && patient.hms_id && appt.hms_id === patient.hms_id) {
          return true;
        }
        
        // Strategy 2: Match by patient_id/sys_user_id
        if (appt.patient_id && patient.sys_user_id && appt.patient_id === patient.sys_user_id) {
          return true;
        }
        
        // Strategy 3: Match by patient_id with patient's hms_id (for old patients)
        if (appt.patient_id && patient.hms_id && appt.patient_id === patient.hms_id) {
          return true;
        }
        
        // Strategy 4: Match by patient name (if available) - for cases where IDs don't match
        if (appt.patient_name && patient.name && 
            appt.patient_name.toLowerCase() === patient.name.toLowerCase()) {
          return true;
        }
        
        // Strategy 5: Check if appointment has patient_id that matches patient's sys_user_id as string
        if (appt.patient_id && patient.sys_user_id && 
            String(appt.patient_id) === String(patient.sys_user_id)) {
          return true;
        }
        
        // Strategy 6: Check if appointment has patient_id that matches patient's hms_id as string
        if (appt.patient_id && patient.hms_id && 
            String(appt.patient_id) === String(patient.hms_id)) {
          return true;
        }
        
        // Strategy 7: Check if appointment has patient_id that matches patient's sys_user_id as number
        if (appt.patient_id && patient.sys_user_id && 
            Number(appt.patient_id) === Number(patient.sys_user_id)) {
          return true;
        }
        
        // Strategy 8: Check if appointment has patient_id that matches patient's hms_id as number
        if (appt.patient_id && patient.hms_id && 
            Number(appt.patient_id) === Number(patient.hms_id)) {
          return true;
        }
        
        // Strategy 9: Match by phone number
        if (appt.patient_phone && patient.mobile_no && 
            appt.patient_phone === patient.mobile_no) {
          return true;
        }
        
        return false;
      });

      // Find today's appointment
      const todayAppointment = patientAppointments.find(appt => {
        const apptDate = appt.appointment_date || appt.date || appt.scheduled_date;
        return apptDate === today;
      });

      // Find upcoming appointments
      const upcomingAppointment = patientAppointments.find(appt => {
        const apptDate = appt.appointment_date || appt.date || appt.scheduled_date;
        return apptDate > today;
      });

      return {
        ...patient,
        todayAppointment,
        upcomingAppointment,
        registrationPending: patientAppointments.some(
          appt => appt.patient_id === null || appt.patient_id === "null"
        ),
        allAppointments: patientAppointments
      };
    });

    setFilteredPatients(updatedPatients);
  }, [patients, appointments, searchTerm, searchCriteria, fromDate, toDate]);

  // Handle search input change
  const handleSearchChange = (e) => {
    setSearchTerm(e.target.value);
  };

  // Handle criteria change
  const handleCriteriaChange = (e) => {
    setSearchCriteria(e.target.value);
  };

  // Toggle patient expansion
  const toggleExpand = async (patient) => {
    if (expandedPatient === patient.patient_id) {
      setExpandedPatient(null);
      setVisitHistory([]);
      setAttachments([]);
      setFollowUps([]);
      setPendingRequests([]);
    } else {
      setExpandedPatient(patient.patient_id);
      await Promise.all([
        fetchVisitHistory(patient.sys_user_id, doctorId),
        fetchAttachments(patient.sys_user_id),
        fetchFollowUps(patient.sys_user_id),
        fetchPendingRequests(patient.sys_user_id)
      ]);
    }
  };

  // Take Appointment API Call
  const handleTakeAppointment = async (patient) => {
    if (!appointmentDate || !appointmentTime) {
      alert("Please select date and time");
      return;
    }

    try {
      setAppointmentLoading(true);

      console.log("📝 Taking appointment for patient:", {
        name: patient.name,
        sys_user_id: patient.sys_user_id,
        patient_id: patient.patient_id,
        hms_id: patient.hms_id,
        mobile_no: patient.mobile_no
      });

      const requestBody = {
        doctor_id: doctorId,
        sys_user_id: String(patient.sys_user_id || patient.patient_id || patient.hms_id || ''),
        hms_id: patient.hms_id || '',
        patient_id: String(patient.sys_user_id || patient.patient_id || patient.hms_id || ''),
        date: appointmentDate,
        scheduled_time: appointmentTime,
        visit_type: "op",
        chief_complaint: chiefComplaint,
        patient_name: patient.name || '',
        patient_phone: patient.mobile_no || patient.phone || ''
      };

      console.log("📤 Sending appointment request:", requestBody);

      const response = await fetch(
        `https://doctorassist.ai/api/hms/users/doctors/take_appointment`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        }
      );

      const data = await response.json();
      console.log("📥 Appointment response:", data);

      if (data.status === "success") {
        alert("Appointment created successfully ✅");
        setShowAppointmentForm(null);
        setAppointmentDate("");
        setAppointmentTime("");
        setChiefComplaint("");
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Refresh appointments to show the new appointment
        await fetchAppointments();
        
        console.log("✅ Appointment created and appointments refreshed");
      } else {
        alert(data.message || "Failed to create appointment");
      }
    } catch (error) {
      console.error("❌ Appointment Error:", error);
      alert("Error creating appointment. Please try again.");
    } finally {
      setAppointmentLoading(false);
    }
  };

  // Debug effect to check appointment-patient matching
  useEffect(() => {
    if (appointments.length > 0 && patients.length > 0) {
      console.group("🔍 DEBUG: Checking appointment-patient matching");
      
      console.log("All appointments:", appointments.map(a => ({
        id: a.id,
        patient_id: a.patient_id,
        hms_id: a.hms_id,
        patient_name: a.patient_name,
        date: a.date
      })));
      
      const samplePatient = patients[0];
      if (samplePatient) {
        debugPatientAppointmentMatch(samplePatient, appointments);
      }
      
      const today = new Date().toISOString().split('T')[0];
      const todayAppointments = appointments.filter(a => a.date === today);
      console.log(`📅 Today's appointments (${todayAppointments.length}):`, todayAppointments);
      
      console.groupEnd();
    }
  }, [appointments, patients]);

  // Styles (keeping your existing styles)
  const styles = {
    container: {
      maxWidth: '1200px',
      margin: '0 auto',
      padding: '24px',
      background: 'linear-gradient(135deg, #f8fafc 0%, #f1f5f9 100%)',
      minHeight: '100vh',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
    },
    header: {
      marginBottom: '32px',
    },
    headerContent: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      background: 'white',
      padding: '24px 32px',
      borderRadius: '20px',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)',
      border: '1px solid rgba(255, 255, 255, 0.8)',
      backdropFilter: 'blur(10px)',
    },
    headerTitle: {
      fontSize: '28px',
      fontWeight: '600',
      color: '#0f172a',
      margin: 0,
      letterSpacing: '-0.5px',
    },
    patientCount: {
      background: 'linear-gradient(135deg, #2563eb, #1e40af)',
      color: 'white',
      padding: '8px 16px',
      borderRadius: '100px',
      fontSize: '14px',
      fontWeight: '500',
      letterSpacing: '0.5px',
    },
    searchSection: {
      display: 'flex',
      gap: '16px',
      marginBottom: '32px',
      flexWrap: 'wrap',
      alignItems: 'center',
    },
    searchWrapper: {
      flex: 1,
      position: 'relative',
      minWidth: '280px',
    },
    searchIcon: {
      position: 'absolute',
      left: '16px',
      top: '50%',
      transform: 'translateY(-50%)',
      color: '#64748b',
    },
    searchInput: {
      width: '100%',
      padding: '16px 16px 16px 48px',
      border: '2px solid transparent',
      borderRadius: '16px',
      fontSize: '16px',
      background: 'white',
      transition: 'all 0.2s',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.02)',
      outline: 'none',
    },
    searchInputFocus: {
      borderColor: '#2563eb',
      boxShadow: '0 4px 16px rgba(37, 99, 235, 0.1)',
    },
    criteriaSelect: {
      padding: '16px 40px 16px 20px',
      border: '2px solid transparent',
      borderRadius: '16px',
      fontSize: '16px',
      background: 'white',
      color: '#1e293b',
      fontWeight: '500',
      cursor: 'pointer',
      appearance: 'none',
      backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23475569' stroke-width='2'%3E%3Cpolyline points='6 9 12 15 18 9'%3E%3C/polyline%3E%3C/svg%3E")`,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 20px center',
      backgroundSize: '16px',
      transition: 'all 0.2s',
      outline: 'none',
    },
    filterGroup: {
      display: 'flex',
      gap: '10px',
      alignItems: 'center',
      background: 'white',
      padding: '8px 16px',
      borderRadius: '16px',
      border: '2px solid transparent',
    },
    filterLabel: {
      color: '#475569',
      fontSize: '14px',
      fontWeight: '500',
    },
    filterInput: {
      padding: '8px 12px',
      border: '1px solid #e2e8f0',
      borderRadius: '10px',
      fontSize: '14px',
      outline: 'none',
      transition: 'all 0.2s',
    },
    clearButton: {
      padding: '12px 24px',
      background: '#ef4444',
      color: 'white',
      border: 'none',
      borderRadius: '12px',
      fontSize: '14px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background 0.2s',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
    },
    patientList: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    },
    patientCard: {
      background: 'white',
      borderRadius: '20px',
      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.02)',
      transition: 'all 0.3s ease',
      border: '1px solid rgba(226, 232, 240, 0.4)',
      overflow: 'hidden',
    },
    patientCardHover: {
      boxShadow: '0 12px 30px rgba(0, 0, 0, 0.08)',
      borderColor: '#cbd5e1',
    },
    patientCardHeader: {
      display: 'flex',
      alignItems: 'center',
      padding: '20px 24px',
      cursor: 'pointer',
      transition: 'background 0.2s',
    },
    patientAvatar: {
      width: '56px',
      height: '56px',
      borderRadius: '16px',
      background: 'linear-gradient(135deg, #2563eb, #1e40af)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'white',
      fontSize: '24px',
      fontWeight: '600',
      marginRight: '20px',
      flexShrink: 0,
    },
    patientInfo: {
      flex: 1,
    },
    patientNameRow: {
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      marginBottom: '8px',
      flexWrap: 'wrap',
    },
    patientName: {
      fontSize: '18px',
      fontWeight: '600',
      color: '#0f172a',
      margin: 0,
    },
    patientGender: {
      padding: '4px 12px',
      background: '#f1f5f9',
      borderRadius: '100px',
      fontSize: '13px',
      color: '#475569',
      fontWeight: '500',
    },
    patientDetails: {
      display: 'flex',
      gap: '20px',
      flexWrap: 'wrap',
    },
    detailItem: {
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
      fontSize: '14px',
      color: '#64748b',
    },
    expandIcon: {
      marginLeft: '16px',
      color: '#64748b',
      transition: 'transform 0.2s',
    },
    expandedContent: {
      padding: '24px',
      borderTop: '1px solid #e2e8f0',
      background: '#f8fafc',
    },
    expandedSection: {
      marginBottom: '30px',
    },
    expandedTitle: {
      fontSize: '18px',
      fontWeight: '600',
      color: '#0f172a',
      marginBottom: '16px',
      borderBottom: '2px solid #2563eb',
      paddingBottom: '8px',
      display: 'inline-block',
    },
    statusBadge: {
      padding: '4px 10px',
      borderRadius: '20px',
      fontSize: '12px',
      fontWeight: '500',
      display: 'inline-block',
    },
    noResults: {
      textAlign: 'center',
      padding: '64px 24px',
      background: 'white',
      borderRadius: '20px',
      color: '#64748b',
    },
    noResultsTitle: {
      fontSize: '20px',
      fontWeight: '600',
      color: '#0f172a',
      marginTop: '16px',
      marginBottom: '8px',
    },
    loadingSkeleton: {
      display: 'flex',
      flexDirection: 'column',
      gap: '16px',
    },
    skeletonCard: {
      background: 'white',
      borderRadius: '20px',
      padding: '24px',
      animation: 'pulse 1.5s infinite',
    },
    skeletonLine: {
      height: '16px',
      background: '#e2e8f0',
      borderRadius: '8px',
      marginBottom: '12px',
    },
    errorMessage: {
      textAlign: 'center',
      padding: '48px 24px',
      background: 'white',
      borderRadius: '20px',
      color: '#ef4444',
    },
    retryBtn: {
      marginTop: '20px',
      padding: '12px 32px',
      background: '#2563eb',
      color: 'white',
      border: 'none',
      borderRadius: '12px',
      fontSize: '16px',
      fontWeight: '500',
      cursor: 'pointer',
      transition: 'background 0.2s',
    },
  };

  // Add keyframes for animation
  useEffect(() => {
    const style = document.createElement('style');
    style.textContent = `
      @keyframes pulse {
        0%, 100% { opacity: 1; }
        50% { opacity: 0.5; }
      }
    `;
    document.head.appendChild(style);
    return () => {
      document.head.removeChild(style);
    };
  }, []);

  // Loading skeleton
  if (loading) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <div style={styles.headerContent}>
            <h1 style={styles.headerTitle}>My Patients</h1>
          </div>
        </div>
        <div style={styles.loadingSkeleton}>
          {[1, 2, 3, 4, 5].map((i) => (
            <div key={i} style={styles.skeletonCard}>
              <div style={{...styles.skeletonLine, width: '60%'}}></div>
              <div style={{...styles.skeletonLine, width: '40%'}}></div>
              <div style={{...styles.skeletonLine, width: '30%'}}></div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={styles.container}>
        <div style={styles.errorMessage}>
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <circle cx="12" cy="16" r="1" />
          </svg>
          <h2 style={{marginTop: '16px'}}>Error</h2>
          <p style={{marginBottom: '0'}}>{error}</p>
          <button 
            onClick={() => window.location.reload()} 
            style={styles.retryBtn}
            onMouseEnter={(e) => e.target.style.background = '#1e40af'}
            onMouseLeave={(e) => e.target.style.background = '#2563eb'}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerContent}>
          <h1 style={styles.headerTitle}>My Patients</h1>
          <span style={styles.patientCount}>
            {Array.isArray(filteredPatients) ? filteredPatients.length : 0} {filteredPatients?.length === 1 ? 'Patient' : 'Patients'}
          </span>
        </div>
      </div>

      {/* Search and Filter Section */}
      <div style={styles.searchSection}>
        <div style={styles.searchWrapper}>
          <svg style={styles.searchIcon} width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            type="text"
            placeholder="Search patients by name, ID, date, or age..."
            value={searchTerm}
            onChange={handleSearchChange}
            style={styles.searchInput}
            onFocus={(e) => {
              e.target.style.borderColor = styles.searchInputFocus.borderColor;
              e.target.style.boxShadow = styles.searchInputFocus.boxShadow;
            }}
            onBlur={(e) => {
              e.target.style.borderColor = 'transparent';
              e.target.style.boxShadow = '0 2px 8px rgba(0, 0, 0, 0.02)';
            }}
          />
        </div>
        
        <select 
          value={searchCriteria} 
          onChange={handleCriteriaChange}
          style={styles.criteriaSelect}
          onFocus={(e) => {
            e.target.style.borderColor = '#2563eb';
            e.target.style.boxShadow = '0 4px 16px rgba(37, 99, 235, 0.1)';
          }}
          onBlur={(e) => {
            e.target.style.borderColor = 'transparent';
            e.target.style.boxShadow = 'none';
          }}
        >
          <option value="all">All Fields</option>
          <option value="name">Patient Name</option>
          <option value="hms_id">HMS ID</option>
          <option value="date">Registration Date</option>
          <option value="age">Age</option>
        </select>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'white', padding: '8px 16px', borderRadius: '16px' }}>
          <span style={{ color: '#475569', fontSize: '14px', fontWeight: '500' }}>From:</span>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '14px' }}
          />
        </div>

        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', background: 'white', padding: '8px 16px', borderRadius: '16px' }}>
          <span style={{ color: '#475569', fontSize: '14px', fontWeight: '500' }}>To:</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            style={{ padding: '8px 12px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '14px' }}
          />
        </div>

        {/* Clear Filters Button */}
        <button
          onClick={clearFilters}
          style={styles.clearButton}
          onMouseEnter={(e) => e.target.style.background = '#dc2626'}
          onMouseLeave={(e) => e.target.style.background = '#ef4444'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
          Clear Filters
        </button>
      </div>

      {/* Active Filters Display */}
      {(fromDate || toDate || searchTerm) && (
        <div style={{
          marginBottom: '16px',
          padding: '12px 20px',
          background: '#e0f2fe',
          borderRadius: '12px',
          color: '#0369a1',
          fontSize: '14px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          flexWrap: 'wrap'
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
          </svg>
          <span><strong>Active Filters:</strong></span>
          {searchTerm && <span>Search: "{searchTerm}"</span>}
          {fromDate && <span>From: {fromDate}</span>}
          {toDate && <span>To: {toDate}</span>}
        </div>
      )}

      {/* Patient List */}
      <div style={styles.patientList}>
        {!Array.isArray(filteredPatients) || filteredPatients.length === 0 ? (
          <div style={styles.noResults}>
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h3 style={styles.noResultsTitle}>No patients found</h3>
            <p style={{margin: 0}}>Try adjusting your search or filter criteria</p>
            {(fromDate || toDate || searchTerm) && (
              <button
                onClick={clearFilters}
                style={{
                  marginTop: '16px',
                  padding: '8px 20px',
                  background: '#2563eb',
                  color: 'white',
                  border: 'none',
                  borderRadius: '8px',
                  cursor: 'pointer'
                }}
              >
                Clear All Filters
              </button>
            )}
          </div>
        ) : (
          filteredPatients.map((patient) => (
            patient && (
              <div 
                key={patient.sys_user_id || patient.patient_id || patient.hms_id || Math.random()} 
                style={{
                  ...styles.patientCard,
                  ...(expandedPatient === patient.patient_id ? styles.patientCardHover : {})
                }}
                onMouseEnter={(e) => {
                  if (expandedPatient !== patient.sys_user_id) {
                    e.currentTarget.style.boxShadow = styles.patientCardHover.boxShadow;
                    e.currentTarget.style.borderColor = styles.patientCardHover.borderColor;
                  }
                }}
                onMouseLeave={(e) => {
                  if (expandedPatient !== patient.sys_user_id) {
                    e.currentTarget.style.boxShadow = styles.patientCard.boxShadow;
                    e.currentTarget.style.borderColor = styles.patientCard.borderColor;
                  }
                }}
              >
                {/* Collapsed View */}
                <div 
                  style={styles.patientCardHeader}
                  onClick={() => toggleExpand(patient)}
                >
                  <div style={styles.patientAvatar}>
                    {patient.name?.charAt(0).toUpperCase() || '?'}
                  </div>
                  
                  <div style={styles.patientInfo}>
                    <div style={styles.patientNameRow}>
                      <h3 style={styles.patientName}>{patient.name || 'Unnamed Patient'}</h3>
                      
                      {/* Today Appointment */}
                      {patient.todayAppointment && (
                        <span style={{
                          background: "#dcfce7",
                          color: "#166534",
                          padding: "4px 10px",
                          borderRadius: "20px",
                          fontSize: "12px"
                        }}>
                          Today {patient.todayAppointment.scheduled_time || patient.todayAppointment.appointment_time}
                        </span>
                      )}

                      {/* Upcoming Appointment */}
                      {patient.upcomingAppointment && (
                        <span style={{
                          background: "#e0f2fe",
                          color: "#075985",
                          padding: "4px 10px",
                          borderRadius: "20px",
                          fontSize: "12px"
                        }}>
                          Upcoming {patient.upcomingAppointment.appointment_date || patient.upcomingAppointment.date}
                        </span>
                      )}

                      {/* Registration Pending */}
                      {patient.registrationPending && (
                        <span style={{
                          background: "#fee2e2",
                          color: "#991b1b",
                          padding: "4px 10px",
                          borderRadius: "20px",
                          fontSize: "12px"
                        }}>
                          Registration Pending
                        </span>
                      )}

                      <span style={styles.patientGender}>{patient.gender || 'Not Specified'}</span>
                    </div>
                    
                    <div style={styles.patientDetails}>
                      <span style={styles.detailItem}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        {patient.hms_id || 'No ID'}
                      </span>
                      
                      <span style={styles.detailItem}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle cx="12" cy="12" r="10" />
                          <polyline points="12 6 12 12 16 14" />
                        </svg>
                        {formatDate(patient.created_at)}
                      </span>
                      
                      <span style={styles.detailItem}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <circle cx="12" cy="8" r="4" />
                          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        </svg>
                        {calculateAge(patient.date_of_birth)} years
                      </span>
                    </div>
                  </div>
                  
                  <div style={styles.expandIcon}>
                    <svg 
                      width="20" 
                      height="20" 
                      viewBox="0 0 24 24" 
                      fill="none" 
                      stroke="currentColor"
                      style={{
                        transform: expandedPatient === patient.patient_id ? 'rotate(180deg)' : 'rotate(0deg)',
                        transition: 'transform 0.2s'
                      }}
                    >
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </div>
                </div>

                {/* Expanded View */}
                {expandedPatient === patient.patient_id && (
                  <div style={styles.expandedContent}>
                    
                    {/* Previous Visit History Section */}
                    <div style={styles.expandedSection}>
                      <h4 style={styles.expandedTitle}>Previous Visit History</h4>
                      {visitLoading ? (
                        <p>Loading visits...</p>
                      ) : visitHistory.length === 0 ? (
                        <div style={{
                          padding: '20px',
                          background: '#f1f5f9',
                          borderRadius: '12px',
                          textAlign: 'center',
                          color: '#64748b'
                        }}>
                          No previous visits found for this patient.
                        </div>
                      ) : (
                        visitHistory.map((visit, index) => (
                          <div
                            key={index}
                            style={{
                              background: "white",
                              padding: "16px",
                              borderRadius: "12px",
                              marginBottom: "12px",
                              border: "1px solid #e2e8f0"
                            }}
                          >
                            <p><strong>Date:</strong> {visit.date}</p>
                            <p><strong>Doctor:</strong> {visit.doctor_name} ({visit.specialization})</p>
                            <p><strong>Consultation Summary:</strong></p>
                            <p style={{ color: "#475569", lineHeight: "1.6" }}>
                              {visit.consultation_summary_paragraph}
                            </p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Attachments Section */}
                    <div style={styles.expandedSection}>
                      <h4 style={styles.expandedTitle}>Attachments</h4>
                      {attachmentLoading ? (
                        <p>Loading attachments...</p>
                      ) : attachments.length === 0 ? (
                        <div style={{
                          padding: '20px',
                          background: '#f1f5f9',
                          borderRadius: '12px',
                          textAlign: 'center',
                          color: '#64748b'
                        }}>
                          No attachments found.
                        </div>
                      ) : (
                        <div>
                          {attachments.map((file) => (
                            <div
                              key={file.id}
                              style={{
                                background: "white",
                                padding: "12px 16px",
                                borderRadius: "10px",
                                marginBottom: "8px",
                                border: "1px solid #e2e8f0",
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center"
                              }}
                            >
                              <div>
                                <p style={{ margin: 0, fontWeight: "500" }}>
                                  {file.document_id}
                                </p>
                                <p style={{ 
                                  margin: 0, 
                                  fontSize: "12px", 
                                  color: "#64748b",
                                  display: 'flex',
                                  alignItems: 'center',
                                  gap: '8px'
                                }}>
                                  <span>Category: {file.category || 'Other'}</span>
                                  <span>Report Date: {file.report_date || 'N/A'}</span>
                                </p>
                              </div>

                              {file.file_url && (
                                <a
                                  href={file.file_url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  style={{
                                    padding: "6px 14px",
                                    background: "#2563eb",
                                    color: "white",
                                    borderRadius: "8px",
                                    textDecoration: "none",
                                    fontSize: "14px",
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px'
                                  }}
                                >
                                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                    <circle cx="12" cy="12" r="3" />
                                  </svg>
                                  View
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Communication History Section */}
                    <div style={styles.expandedSection}>
                      <h4 style={styles.expandedTitle}>Communication History</h4>
                      {followUpLoading ? (
                        <p>Loading communication...</p>
                      ) : followUps.length === 0 ? (
                        <div style={{
                          padding: '20px',
                          background: '#f1f5f9',
                          borderRadius: '12px',
                          textAlign: 'center',
                          color: '#64748b'
                        }}>
                          No communication history found.
                        </div>
                      ) : (
                        followUps.map((item) => {
                          const getStatusStyle = () => {
                            if (item.patient_replied) return { bg: "#dcfce7", color: "#166534", text: "Replied" };
                            if (item.reminder_sent) return { bg: "#e0f2fe", color: "#075985", text: "Sent" };
                            return { bg: "#fee2e2", color: "#991b1b", text: "Pending" };
                          };

                          const status = getStatusStyle();

                          return (
                            <div
                              key={item._id}
                              style={{
                                background: "white",
                                padding: "16px",
                                borderRadius: "12px",
                                marginBottom: "12px",
                                border: "1px solid #e2e8f0"
                              }}
                            >
                              <div style={{
                                display: 'flex',
                                justifyContent: 'space-between',
                                alignItems: 'center',
                                marginBottom: '10px'
                              }}>
                                <span style={{
                                  background: status.bg,
                                  color: status.color,
                                  padding: '4px 12px',
                                  borderRadius: '20px',
                                  fontSize: '12px',
                                  fontWeight: '500'
                                }}>
                                  {status.text}
                                </span>
                                <span style={{ fontSize: '12px', color: '#64748b' }}>
                                  {item.followup_date}
                                </span>
                              </div>
                              
                              <p><strong>Type:</strong> {item.reminder_type || 'Follow-up'}</p>
                              
                              {item.template_variables && (
                                <p><strong>Message:</strong> Reminder for {item.template_variables.patient_name} on {item.template_variables.appointment_date}</p>
                              )}
                              
                              {item.patient_replied && (
                                <div style={{
                                  marginTop: '10px',
                                  padding: '10px',
                                  background: '#f8fafc',
                                  borderRadius: '8px'
                                }}>
                                  <p><strong>Patient Reply:</strong> {item.reply_text || 'Yes'}</p>
                                  <p style={{ fontSize: '12px', color: '#64748b' }}>
                                    Replied on: {item.reply_date ? new Date(item.reply_date).toLocaleString() : 'N/A'}
                                  </p>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    {/* Pending Requests Section */}
                    <div style={styles.expandedSection}>
                      <h4 style={styles.expandedTitle}>Pending Requests</h4>
                      {pendingRequestsLoading ? (
                        <p>Loading requests...</p>
                      ) : pendingRequests.length === 0 ? (
                        <div style={{
                          padding: '20px',
                          background: '#f1f5f9',
                          borderRadius: '12px',
                          textAlign: 'center',
                          color: '#64748b'
                        }}>
                          No pending requests.
                        </div>
                      ) : (
                        pendingRequests.map((request) => (
                          <div
                            key={request.id}
                            style={{
                              background: "white",
                              padding: "16px",
                              borderRadius: "12px",
                              marginBottom: "12px",
                              border: "1px solid #e2e8f0",
                              borderLeft: request.status === 'unread' ? '4px solid #2563eb' : '4px solid #f59e0b'
                            }}
                          >
                            <div style={{
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              marginBottom: '8px'
                            }}>
                              <span style={{
                                background: request.status === 'unread' ? '#dbeafe' : '#fef3c7',
                                color: request.status === 'unread' ? '#1e40af' : '#92400e',
                                padding: '4px 12px',
                                borderRadius: '20px',
                                fontSize: '12px',
                                fontWeight: '500'
                              }}>
                                {request.status === 'unread' ? 'Unread' : 'Pending'}
                              </span>
                              <span style={{ fontSize: '12px', color: '#64748b' }}>
                                {request.date}
                              </span>
                            </div>
                            <p><strong>{request.type}:</strong> {request.description}</p>
                          </div>
                        ))
                      )}
                    </div>

                    {/* Take Appointment Button */}
                    <div style={{ marginTop: "20px" }}>
                      <button
                        onClick={() => setShowAppointmentForm(patient.sys_user_id || patient.patient_id || patient.hms_id)}
                        style={{
                          padding: "10px 20px",
                          background: "#2563eb",
                          color: "white",
                          border: "none",
                          borderRadius: "10px",
                          cursor: "pointer",
                          fontWeight: "500"
                        }}
                      >
                        Take Appointment
                      </button>
                    </div>

                    {/* Appointment Form */}
                    {showAppointmentForm === (patient.sys_user_id || patient.patient_id || patient.hms_id) && (
                      <div
                        style={{
                          marginTop: "20px",
                          padding: "20px",
                          background: "white",
                          borderRadius: "12px",
                          border: "1px solid #e2e8f0"
                        }}
                      >
                        <h4 style={{ marginBottom: "16px" }}>New Appointment</h4>

                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          <input
                            type="date"
                            value={appointmentDate}
                            onChange={(e) => setAppointmentDate(e.target.value)}
                            style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                          />

                          <input
                            type="time"
                            value={appointmentTime}
                            onChange={(e) => setAppointmentTime(e.target.value)}
                            style={{ padding: "10px", borderRadius: "8px", border: "1px solid #cbd5e1" }}
                          />

                          <input
                            type="text"
                            value="OP"
                            disabled
                            style={{
                              padding: "10px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              background: "#f1f5f9",
                              fontWeight: "500"
                            }}
                          />

                          <textarea
                            placeholder="Enter Chief Complaint"
                            value={chiefComplaint}
                            onChange={(e) => setChiefComplaint(e.target.value)}
                            style={{
                              padding: "10px",
                              borderRadius: "8px",
                              border: "1px solid #cbd5e1",
                              minHeight: "80px"
                            }}
                          />

                          <button
                            onClick={() => handleTakeAppointment(patient)}
                            disabled={appointmentLoading}
                            style={{
                              padding: "12px",
                              background: appointmentLoading ? "#94a3b8" : "#16a34a",
                              color: "white",
                              border: "none",
                              borderRadius: "10px",
                              cursor: "pointer",
                              fontWeight: "600"
                            }}
                          >
                            {appointmentLoading ? "Saving..." : "Confirm Appointment"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          ))
        )}
      </div>

      {/* Keyboard shortcut hint */}
      {Array.isArray(filteredPatients) && filteredPatients.length > 0 && (
        <div style={{
          marginTop: '24px',
          padding: '12px 20px',
          background: 'rgba(37, 99, 235, 0.05)',
          borderRadius: '12px',
          color: '#2563eb',
          fontSize: '14px',
          textAlign: 'center',
          border: '1px solid rgba(37, 99, 235, 0.1)'
        }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" style={{marginRight: '8px', verticalAlign: 'middle'}}>
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          Click on any patient card to view detailed medical information
        </div>
      )}
    </div>
  );
};

export default PatientList;