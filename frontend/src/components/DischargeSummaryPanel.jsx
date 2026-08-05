import React, { useState, useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  Box,
  Typography,
  TextField,
  Grid,
  Button,
  Card,
  CardContent,
  Container,
  Tooltip,
  Stack,
  Paper,
  List,
  ListItem,
  Divider,
  Chip,
  Alert,
} from "@mui/material";
import {
  Download,
  Visibility,
  LocalHospital,
  Description,
  Medication,
  Assignment,
  NoteAdd,
  Healing,
  Checklist,
  Science,
  LocalPharmacy,
  Person,
  Update,
  Warning,
  KeyboardArrowRight,
  Event,
  PictureAsPdf,
  Print,
  Schedule,
  Badge,
  CalendarToday,
  CheckCircle,
} from "@mui/icons-material";

export default function DischargeSummaryPanel({
    data,
    onSave,
}) {
  const [form, setForm] = useState({
    hospital_name: "",
    patient_name: "",
    age: "",
    gender: "",
    admission_date: "",
    discharge_date: "",
    diagnosis: "",
    icd_codes: "",
    procedures: "",
    hospital_course: "",
    investigations_summary: "",
    medications_at_discharge: "",
    condition_at_discharge: "",
    follow_up_instructions: "",
    advice: "",
  });
  
  const BASE_URL = import.meta.env.VITE_BACKEND_URL;

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const doctorId = queryParams.get("doctor_id");
  const patientId = queryParams.get("patient_id");

  const [doctorInfo, setDoctorInfo] = useState(null);
  const [patientInfo, setPatientInfo] = useState(null);
  
  const isReady = doctorInfo && patientInfo;

  useEffect(() => {
    if (!data) return;

    const summary = data?.discharge_summary || data;

    const extractICDCodes = (icdData) => {
      if (!icdData) return "";

      if (Array.isArray(icdData)) {
        return icdData
          .map(item =>
            typeof item === "object" && item !== null
              ? item.code || ""
              : item
          )
          .filter(code => code && code.trim() !== "")
          .join(", ");
      }

      return icdData || "";
    };

    setForm(prev => ({
      ...prev,
      diagnosis: Array.isArray(summary?.final_diagnosis)
        ? summary.final_diagnosis.join(", ")
        : summary?.final_diagnosis || "",

      icd_codes: extractICDCodes(summary?.icd10_codes || summary?.icd_codes),

      procedures: Array.isArray(summary?.procedures_performed)
        ? summary.procedures_performed.join(", ")
        : summary?.procedures_performed || "",

      hospital_course: summary?.hospital_course || "",
      investigations_summary: summary?.investigations_summary || "",

      medications_at_discharge: Array.isArray(summary?.discharge_medications)
        ? summary.discharge_medications.join("\n")
        : summary?.discharge_medications || "",

      condition_at_discharge: summary?.condition_at_discharge || "",
      follow_up_instructions: summary?.follow_up_plan || "",
      advice: summary?.discharge_instructions || "",
    }));

  }, [data]);

  useEffect(() => {
    if (!doctorId || !patientId) return;

    const fetchMetadata = async () => {
      try {
        const [doctorRes, patientRes] = await Promise.all([
          fetch(
            `${BASE_URL}hms/users/data/context/get-doctor-info?sys_user_id=${doctorId}`
          ),
          fetch(
            `${BASE_URL}hms/users/data/context/get-patient-info?patient_id=${patientId}`
          ),
        ]);

        if (!doctorRes.ok) {
          throw new Error(`Doctor API failed: ${doctorRes.status}`);
        }

        if (!patientRes.ok) {
          throw new Error(`Patient API failed: ${patientRes.status}`);
        }

        const doctorData = await doctorRes.json();
        const patientData = await patientRes.json();

        console.log("Doctor API response:", doctorData);
        console.log("Patient API response:", patientData);

        setDoctorInfo(doctorData?.data ?? doctorData);
        setPatientInfo(patientData?.data ?? patientData);

      } catch (error) {
        console.error("Metadata fetch error:", error);
      }
    };

    fetchMetadata();
  }, [doctorId, patientId]);

  const handleChange = (field, value) => {
    setForm(prev => ({ ...prev, [field]: value }));
  };
  
  /* ===============================
            PDF GENERATION USING PRINT STYLING
            Medical Blue and White Theme
  =============================== */
  const generatePDF = (preview = false) => {
    try {
      // Create a print-friendly version
      const printWindow = window.open('', '_blank');
      if (!printWindow) {
        alert('Please allow popups to generate the discharge summary');
        return;
      }

      const currentDate = new Date().toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
      });
      const currentTime = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit'
      });

      printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Discharge Summary - ${patientId}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
            @import url('https://fonts.googleapis.com/css2?family=Source+Sans+Pro:wght@300;400;600;700&display=swap');
            
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
              font-family: 'Inter', 'Source Sans Pro', 'Calibri', 'Arial', sans-serif;
            }
            
            body {
              padding: 20px;
              background: #f0f9ff;
              color: #1e293b;
              line-height: 1.5;
              font-size: 12px;
              min-height: 100vh;
            }
            
            @media print {
              @page {
                size: A4;
                margin: 15mm;
              }
              
              body {
                padding: 0;
                background: white;
                font-size: 11px;
              }
              
              .no-print {
                display: none !important;
              }
              
              .page-break {
                page-break-before: always;
              }
              
              .avoid-break {
                page-break-inside: avoid;
              }
            }
            
            /* Medical Blue Theme */
            .hospital-header {
              text-align: center;
              padding-bottom: 15px;
              border-bottom: 3px double #1e4a7a;
              margin-bottom: 20px;
              background: linear-gradient(145deg, #ffffff, #f8fcff);
              border-radius: 12px;
              padding: 25px;
              box-shadow: 0 4px 20px rgba(0, 67, 156, 0.1);
            }
            
            .hospital-name {
              color: #003b6f;
              font-size: 28px;
              font-weight: 800;
              margin-bottom: 8px;
              letter-spacing: 0.5px;
            }
            
            .hospital-subtitle {
              color: #005a9c;
              font-size: 14px;
              font-weight: 600;
              margin-bottom: 5px;
              text-transform: uppercase;
            }
            
            .hospital-address {
              color: #4a5568;
              font-size: 11px;
              margin-bottom: 10px;
            }
            
            /* Main Title */
            .main-title {
              text-align: center;
              margin: 25px 0;
              background: linear-gradient(145deg, #e6f2ff, #d4e6fa);
              border-radius: 50px;
              padding: 15px;
            }
            
            .title-main {
              color: #002b54;
              font-size: 24px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 1px;
              margin-bottom: 5px;
            }
            
            .title-dept {
              color: #0047ab;
              font-size: 14px;
              font-weight: 600;
              text-transform: uppercase;
              border-top: 2px solid #99c2ff;
              border-bottom: 2px solid #99c2ff;
              padding: 8px 0;
              margin: 10px 0;
            }
            
            /* Section Styling */
            .section {
              margin-bottom: 20px;
              page-break-inside: avoid;
              background: #ffffff;
              border-radius: 12px;
              padding: 20px;
              border: 1px solid #d9e8ff;
              box-shadow: 0 4px 15px rgba(0, 67, 156, 0.05);
            }
            
            .section-title {
              background: #003b6f;
              color: white;
              padding: 10px 18px;
              font-size: 14px;
              font-weight: 700;
              text-transform: uppercase;
              margin-bottom: 15px;
              border-radius: 8px;
              letter-spacing: 0.5px;
              box-shadow: 0 4px 10px rgba(0, 59, 111, 0.2);
            }
            
            .section-subtitle {
              color: #003b6f;
              font-size: 13px;
              font-weight: 700;
              margin: 15px 0 8px 0;
              padding-bottom: 5px;
              border-bottom: 2px solid #b8d6ff;
            }
            
            /* Patient Info Table */
            .info-table {
              width: 100%;
              border-collapse: collapse;
              margin: 10px 0;
            }
            
            .info-table td {
              padding: 10px 14px;
              vertical-align: top;
              border: 1px solid #c5dcff;
            }
            
            .info-label {
              width: 35%;
              background: #eef5ff;
              font-weight: 600;
              color: #003b6f;
            }
            
            .info-value {
              width: 65%;
              color: #1e293b;
              background: #ffffff;
            }
            
            /* Content Areas */
            .content-box {
              background: #f8fcff;
              border: 1px solid #c5dcff;
              padding: 15px 20px;
              border-radius: 10px;
              margin: 10px 0;
              white-space: pre-line;
              line-height: 1.7;
              color: #1e293b;
            }
            
            .empty-content {
              color: #718096;
              font-style: italic;
              font-size: 11px;
            }
            
            /* Medications List */
            .medications {
              background: #f8fcff;
              border: 1px solid #c5dcff;
              padding: 15px 20px;
              border-radius: 10px;
              margin: 10px 0;
            }
            
            .med-item {
              padding: 6px 0;
              border-bottom: 1px dashed #b8d6ff;
              color: #1e293b;
            }
            
            .med-item:last-child {
              border-bottom: none;
            }
            
            /* Important Notes */
            .important-note {
              background: #fef9e7;
              border: 1px solid #fde6b3;
              padding: 20px;
              margin: 20px 0;
              border-radius: 12px;
              border-left: 5px solid #f6b83e;
            }
            
            .important-note-title {
              color: #b45f06;
              font-weight: 700;
              margin-bottom: 10px;
              font-size: 14px;
            }
            
            /* Footer */
            .footer {
              margin-top: 30px;
              padding-top: 20px;
              border-top: 3px solid #003b6f;
              page-break-inside: avoid;
              background: #f8fcff;
              border-radius: 12px;
              padding: 20px;
            }
            
            .signature-area {
              display: flex;
              justify-content: space-between;
              margin-top: 40px;
            }
            
            .signature-box {
              text-align: center;
              width: 200px;
            }
            
            .signature-line {
              border-top: 2px solid #003b6f;
              margin: 30px 0 5px 0;
              width: 180px;
              display: inline-block;
            }
            
            .signature-text {
              font-size: 12px;
              font-weight: 700;
              color: #003b6f;
            }
            
            .doctor-info {
              font-size: 11px;
              color: #4a5568;
              margin-top: 3px;
            }
            
            .stamp-area {
              border: 2px dashed #f6b83e;
              padding: 12px 20px;
              display: inline-block;
              margin-top: 20px;
              background: #fff8e7;
              border-radius: 8px;
            }
            
            .stamp-text {
              font-size: 11px;
              font-weight: 700;
              color: #b45f06;
              text-align: center;
              letter-spacing: 0.5px;
            }
            
            .footer-meta {
              text-align: center;
              font-size: 10px;
              color: #64748b;
              margin-top: 30px;
              padding-top: 15px;
              border-top: 1px solid #c5dcff;
            }
            
            /* Contact Info */
            .contact-info {
              background: #e6f2ff;
              border: 1px solid #99c2ff;
              padding: 15px 20px;
              margin: 20px 0;
              border-radius: 12px;
              text-align: center;
              font-size: 11px;
            }
            
            .contact-title {
              font-weight: 700;
              color: #003b6f;
              margin-bottom: 5px;
            }
            
            /* Print Button */
            .print-button {
              position: fixed;
              top: 20px;
              right: 20px;
              background: #003b6f;
              color: white;
              border: none;
              padding: 10px 20px;
              border-radius: 8px;
              cursor: pointer;
              font-weight: 600;
              font-size: 13px;
              z-index: 1000;
              box-shadow: 0 4px 15px rgba(0, 59, 111, 0.3);
              border: 1px solid rgba(255, 255, 255, 0.2);
            }
            
            .print-button:hover {
              background: #002b54;
              transform: scale(1.05);
            }
            
            /* Utility Classes */
            .text-bold {
              font-weight: 700;
            }
            
            .text-blue {
              color: #003b6f;
            }
            
            .mb-2 { margin-bottom: 10px; }
            .mt-2 { margin-top: 10px; }
            .mb-3 { margin-bottom: 15px; }
            .mt-3 { margin-top: 15px; }
            .ml-3 { margin-left: 15px; }
          </style>
        </head>
        <body>
          <div class="avoid-break">
            <!-- Hospital Header with Medical Blue Theme -->
            <div class="hospital-header">
              <h1 class="hospital-name">
                ${doctorInfo?.hospital_name || "CITY MULTI-SPECIALITY HOSPITAL"}
              </h1>
              <div class="hospital-address">
                123 Healthcare Avenue, Medical District • Phone: (022) 1234-5678
              </div>
            </div>
            
            <!-- Main Title -->
            <div class="main-title">
              <div class="title-main">DISCHARGE SUMMARY</div>
              <div class="title-dept">Department of ${doctorInfo?.specialization || "GENERAL MEDICINE"}</div>
            </div>
          </div>
          
          <!-- Patient Information Card -->
          <div class="section avoid-break">
            <div class="section-title">
              <span style="display: flex; align-items: center; gap: 8px;">
                <span>👤</span> PATIENT INFORMATION
              </span>
            </div>
            
            <table class="info-table">
              <tr>
                <td class="info-label">Patient Name</td>
                <td class="info-value text-bold">${patientInfo?.patient_name || "N/A"}</td>
                <td class="info-label">HMS ID</td>
                <td class="info-value text-bold">${patientInfo?.hms_id || "N/A"}</td>
              </tr>
              <tr>
                <td class="info-label">Age / Gender</td>
                <td class="info-value">${patientInfo?.age ?? "N/A"} / ${patientInfo?.gender || "N/A"}</td>
                <td class="info-label">Doctor ID</td>
                <td class="info-value">${doctorId || "N/A"}</td>
              </tr>
              <tr>
                <td class="info-label">Admission Date</td>
                <td class="info-value">${form.admission_date || "Not specified"}</td>
                <td class="info-label">Discharge Date</td>
                <td class="info-value">${form.discharge_date || "Not specified"}</td>
              </tr>
              <tr>
                <td class="info-label">Length of Stay</td>
                <td class="info-value" colspan="3">
                  ${form.admission_date && form.discharge_date ? "Calculated during stay" : "Not available"}
                </td>
              </tr>
            </table>
          </div>
          
          <!-- Diagnosis & Procedures -->
          <div class="section avoid-break">
            <div class="section-title">
              <span style="display: flex; align-items: center; gap: 8px;">
                <span>🔬</span> DIAGNOSIS & PROCEDURES
              </span>
            </div>
            
            <div class="section-subtitle">Final Diagnosis</div>
            <div class="content-box">${form.diagnosis || '<span class="empty-content">Not specified</span>'}</div>
            
            <div class="section-subtitle">ICD-10 Codes</div>
            <div class="content-box">${form.icd_codes || '<span class="empty-content">Not specified</span>'}</div>
            
            <div class="section-subtitle">Procedures Performed</div>
            <div class="content-box">${form.procedures || '<span class="empty-content">Not specified</span>'}</div>
          </div>
          
          <!-- Clinical Course -->
          <div class="section avoid-break">
            <div class="section-title">
              <span style="display: flex; align-items: center; gap: 8px;">
                <span>📋</span> CLINICAL COURSE
              </span>
            </div>
            
            <div class="section-subtitle">Hospital Course Summary</div>
            <div class="content-box">${form.hospital_course || '<span class="empty-content">Not specified</span>'}</div>
            
            <div class="section-subtitle">Investigations Summary</div>
            <div class="content-box">${form.investigations_summary || '<span class="empty-content">Not specified</span>'}</div>
            
            <div class="section-subtitle">Condition at Discharge</div>
            <div class="content-box">${form.condition_at_discharge || "Stable"}</div>
          </div>
          
          <!-- Discharge Plan -->
          <div class="section avoid-break">
            <div class="section-title">
              <span style="display: flex; align-items: center; gap: 8px;">
                <span>💊</span> DISCHARGE PLAN
              </span>
            </div>
            
            <div class="section-subtitle">Medications at Discharge</div>
            <div class="medications">
              ${form.medications_at_discharge ? 
                form.medications_at_discharge.split('\n').map(med => 
                  `<div class="med-item"><span style="color: #003b6f; font-weight: 600;">•</span> ${med}</div>`
                ).join('') : 
                '<span class="empty-content">No medications prescribed</span>'
              }
            </div>
            
            <div class="section-subtitle">Follow-up Instructions</div>
            <div class="content-box">${form.follow_up_instructions || '<span class="empty-content">Not specified</span>'}</div>
            
            <div class="section-subtitle">Additional Medical Advice</div>
            <div class="content-box">${form.advice || '<span class="empty-content">Not specified</span>'}</div>
          </div>
          
          <!-- Important Instructions -->
          <div class="important-note avoid-break">
            <div class="important-note-title">⚠️ IMPORTANT INSTRUCTIONS</div>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
              <div>• Keep this discharge summary carefully</div>
              <div>• Follow all prescribed medications strictly</div>
              <div>• Return immediately if complications develop</div>
              <div>• Keep all follow-up appointments</div>
            </div>
          </div>
          
          <!-- Contact Information -->
          <div class="contact-info avoid-break">
            <div class="contact-title">📞 24/7 CONTACT & EMERGENCY</div>
            <div style="display: flex; justify-content: center; gap: 30px;">
              <span><strong>Emergency:</strong> (022) 1234-5678</span>
              <span><strong>Appointments:</strong> (022) 8765-4321</span>
              <span><strong>Email:</strong> contact@hospital.com</span>
            </div>
          </div>
          
          <!-- Footer with Signature -->
          <div class="footer avoid-break">
            <div class="signature-area">
              <div class="stamp-area">
                <div class="stamp-text">🏥 HOSPITAL STAMP</div>
              </div>
              
              <div class="signature-box">
                <div class="signature-line"></div>
                <div class="signature-text">
                  Dr. ${doctorInfo?.name || "Physician Name"}
                </div>
                <div class="doctor-info">
                  ${doctorInfo?.specialization || "Consultant"} • Medical License: ${doctorId || "XXXXX"}
                </div>
              </div>
            </div>
            
            <div class="footer-meta">
              <div style="display: flex; justify-content: center; gap: 30px;">
                <span><strong>Document ID:</strong> DS-${patientId}-${Date.now().toString().slice(-6)}</span>
                <span><strong>Generated:</strong> ${currentDate} at ${currentTime}</span>
              </div>
              <div style="margin-top: 10px; color: #003b6f; font-weight: 600;">
                CONFIDENTIAL MEDICAL DOCUMENT
              </div>
            </div>
          </div>
          
          <button class="print-button no-print" onclick="window.print()">
            🖨️ Print / Save as PDF
          </button>
          
          <script>
            // Auto-print if download mode
            ${preview ? '' : 'window.onload = function() { setTimeout(() => window.print(), 500); }'}
            
            // Close window after print
            window.onafterprint = function() {
              setTimeout(function() {
                window.close();
              }, 1000);
            };
          </script>
        </body>
        </html>
      `);

      printWindow.document.close();

    } catch (error) {
      console.error("PDF generation error:", error);
      alert("Error generating discharge summary. Please try again.");
    }
  };

  // Section configuration with icons
  const sections = [
    { 
      label: "Final Diagnosis", 
      key: "diagnosis", 
      icon: <Healing />,
      description: "Primary and secondary medical diagnoses",
      placeholder: "Enter final diagnosis details..."
    },
    { 
      label: "ICD-10 Codes", 
      key: "icd_codes", 
      icon: <Checklist />,
      description: "International Classification of Diseases codes",
      placeholder: "Enter ICD-10 codes (e.g., I10, E11.9, J45.909)..."
    },
    { 
      label: "Procedures Performed", 
      key: "procedures", 
      icon: <NoteAdd />,
      description: "Surgical and medical procedures during hospitalization",
      placeholder: "List all procedures performed with dates..."
    },
    { 
      label: "Hospital Course Summary", 
      key: "hospital_course", 
      icon: <Description />,
      description: "Detailed account of patient's hospital stay and treatment response",
      placeholder: "Describe the hospital course, progress, and treatment response in detail..."
    },
    { 
      label: "Investigations Summary", 
      key: "investigations_summary", 
      icon: <Science />,
      description: "Laboratory tests, imaging studies, and other diagnostics with key findings",
      placeholder: "Summarize investigation findings and significant results..."
    },
    { 
      label: "Medications at Discharge", 
      key: "medications_at_discharge", 
      icon: <LocalPharmacy />,
      description: "Prescribed medications with dosage, frequency, and duration",
      placeholder: "List discharge medications with:\n- Drug name\n- Dosage\n- Frequency\n- Duration\n- Special instructions"
    },
    { 
      label: "Condition at Discharge", 
      key: "condition_at_discharge", 
      icon: <Person />,
      description: "Patient's health status and clinical condition at time of discharge",
      placeholder: "Describe patient's condition at discharge (e.g., Stable, Improved, Recovering)..."
    },
    { 
      label: "Follow-up Instructions", 
      key: "follow_up_instructions", 
      icon: <Update />,
      description: "Post-discharge care plan, follow-up appointments, and return precautions",
      placeholder: "Provide follow-up care instructions:\n- Follow-up appointment date\n- Specialist referrals\n- When to return\n- Activity restrictions"
    },
    { 
      label: "Additional Advice", 
      key: "advice", 
      icon: <Warning />,
      description: "General medical advice, lifestyle modifications, and precautions",
      placeholder: "Provide additional medical advice:\n- Diet recommendations\n- Activity restrictions\n- Warning signs\n- Lifestyle modifications"
    },
  ];

  // Date fields configuration
  const dateFields = [
    { 
      label: "Admission Date", 
      key: "admission_date", 
      icon: <CalendarToday />,
      description: "Date of patient admission to hospital",
      placeholder: "DD/MM/YYYY or YYYY-MM-DD"
    },
    { 
      label: "Discharge Date", 
      key: "discharge_date", 
      icon: <Schedule />,
      description: "Date of patient discharge from hospital",
      placeholder: "DD/MM/YYYY or YYYY-MM-DD"
    },
  ];

  // Calculate if form is complete enough for PDF
  const isFormComplete = () => {
    return form.diagnosis && form.medications_at_discharge;
  };

  return (
    <Box sx={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #e0f2f1 0%, #b2dfdb 50%, #80cbc4 100%)',
      py: 4,
    }}>
      <Container maxWidth="lg">
        {/* Header Section with Teal Gradient */}
        <Card sx={{ 
          mb: 4, 
          background: 'linear-gradient(145deg, #00695c, #004d40)',
          color: "white",
          borderRadius: 4,
          boxShadow: '0 12px 40px rgba(0,100,80,0.3)',
          position: "relative",
          overflow: "hidden",
          "&::before": {
            content: '""',
            position: "absolute",
            top: 0,
            right: 0,
            width: "300px",
            height: "300px",
            background: "rgba(255, 255, 255, 0.1)",
            borderRadius: "50%",
            transform: "translate(30%, -30%)",
          },
          "&::after": {
            content: '""',
            position: "absolute",
            bottom: 0,
            left: 0,
            width: "250px",
            height: "250px",
            background: "rgba(255, 255, 255, 0.08)",
            borderRadius: "50%",
            transform: "translate(-30%, 30%)",
          }
        }}>
          <CardContent sx={{ p: 4, position: "relative", zIndex: 1 }}>
            <Grid container spacing={3} alignItems="center">
              <Grid item xs={12} md={8}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 2 }}>
                  <Box sx={{
                    background: 'rgba(255,255,255,0.2)',
                    backdropFilter: 'blur(10px)',
                    borderRadius: 3,
                    p: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid rgba(255,255,255,0.3)'
                  }}>
                    <LocalHospital sx={{ fontSize: 36, color: "white" }} />
                  </Box>
                  <Box>
                    <Typography variant="h3" sx={{ 
                      fontWeight: 800,
                      fontFamily: '"Inter", "Roboto", sans-serif',
                      letterSpacing: '-0.5px'
                    }}>
                      Discharge Summary
                    </Typography>
                    <Typography variant="h6" sx={{ 
                      opacity: 0.9,
                      fontFamily: '"Inter", "Roboto", sans-serif',
                      fontWeight: 400
                    }}>
                      Hospital Standard Documentation
                    </Typography>
                  </Box>
                </Box>
                
                <Stack direction="row" spacing={2} sx={{ mt: 2 }}>
                  <Chip
                    icon={<Badge sx={{ color: 'white !important' }} />}
                    label={`Patient ID: ${patientId || 'N/A'}`}
                    sx={{
                      background: 'rgba(255,255,255,0.15)',
                      backdropFilter: 'blur(5px)',
                      color: 'white',
                      border: '1px solid rgba(255,255,255,0.3)',
                      '& .MuiChip-label': { color: 'white' },
                      '& .MuiChip-icon': { color: 'white' }
                    }}
                  />
                  <Chip
                    icon={<Assignment sx={{ color: 'white !important' }} />}
                    label={`Doctor ID: ${doctorId || 'N/A'}`}
                    sx={{
                      background: 'rgba(255,255,255,0.15)',
                      backdropFilter: 'blur(5px)',
                      color: 'white',
                      border: '1px solid rgba(255,255,255,0.3)',
                      '& .MuiChip-label': { color: 'white' },
                      '& .MuiChip-icon': { color: 'white' }
                    }}
                  />
                </Stack>
              </Grid>
              
              <Grid item xs={12} md={4}>
                <Paper sx={{
                  p: 2.5,
                  background: 'rgba(255,255,255,0.15)',
                  backdropFilter: 'blur(10px)',
                  borderRadius: 3,
                  border: '1px solid rgba(255,255,255,0.3)',
                }}>
                  <Typography variant="subtitle2" sx={{ color: 'rgba(255,255,255,0.8)', mb: 1 }}>
                    Document Actions
                  </Typography>
                  <Stack direction="row" spacing={1.5}>
                    <Tooltip title="Preview discharge summary">
                      <Button
                        fullWidth
                        variant="contained"
                        startIcon={<Visibility />}
                        onClick={() => generatePDF(true)}
                        sx={{ 
                          background: 'rgba(255,255,255,0.25)',
                          backdropFilter: 'blur(5px)',
                          color: "white",
                          border: '1px solid rgba(255,255,255,0.3)',
                          borderRadius: 2,
                          py: 1.2,
                          transition: "all 0.3s ease",
                          fontWeight: 600,
                          fontFamily: '"Inter", "Roboto", sans-serif',
                          "&:hover": { 
                            background: 'rgba(255,255,255,0.35)',
                            transform: "translateY(-2px)",
                          },
                        }}
                      >
                        Preview
                      </Button>
                    </Tooltip>
                    
                    <Tooltip title="Download as PDF">
                      <Button
                        fullWidth
                        variant="contained"
                        startIcon={<PictureAsPdf />}
                        onClick={() => generatePDF(false)}
                        sx={{ 
                          background: 'linear-gradient(145deg, #f57c00, #ef6c00)',
                          color: "white",
                          border: '1px solid rgba(255,255,255,0.3)',
                          borderRadius: 2,
                          py: 1.2,
                          transition: "all 0.3s ease",
                          fontWeight: 600,
                          fontFamily: '"Inter", "Roboto", sans-serif',
                          "&:hover": { 
                            background: 'linear-gradient(145deg, #ef6c00, #e65100)',
                            transform: "translateY(-2px)",
                            boxShadow: '0 8px 20px rgba(245,124,0,0.3)',
                          },
                        }}
                      >
                        Download
                      </Button>
                    </Tooltip>
                  </Stack>
                </Paper>
              </Grid>
            </Grid>
          </CardContent>
        </Card>

        {/* Date Fields Section - Glass Morphism */}
        <Card sx={{ 
          mb: 4, 
          borderRadius: 4,
          boxShadow: '0 8px 32px rgba(0,150,136,0.1)',
          overflow: "hidden",
          background: 'linear-gradient(145deg, rgba(255,255,255,0.9), rgba(240,255,240,0.9))',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.4)',
        }}>
          <CardContent sx={{ p: 3 }}>
            <Box sx={{ 
              display: 'flex', 
              alignItems: 'center', 
              gap: 2, 
              mb: 3,
              pb: 2,
              borderBottom: '2px solid',
              borderImage: 'linear-gradient(90deg, #009688, #b2dfdb, #009688) 1',
              borderImageSlice: 1,
            }}>
              <Box sx={{
                background: 'linear-gradient(145deg, #009688, #00796b)',
                borderRadius: 2.5,
                p: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <Event sx={{ color: 'white', fontSize: 28 }} />
              </Box>
              <Box>
                <Typography variant="h5" sx={{ 
                  background: 'linear-gradient(145deg, #00695c, #004d40)',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  fontWeight: 700,
                  fontFamily: '"Inter", "Roboto", sans-serif',
                }}>
                  Admission & Discharge Dates
                </Typography>
                <Typography variant="body2" sx={{ 
                  color: '#37474f',
                  fontFamily: '"Inter", "Roboto", sans-serif',
                  mt: 0.5
                }}>
                  Enter the patient's admission and discharge dates for documentation
                </Typography>
              </Box>
            </Box>
            
            <Grid container spacing={3}>
              {dateFields.map((field) => (
                <Grid item xs={12} md={6} key={field.key}>
                  <Paper sx={{
                    p: 2.5,
                    background: 'rgba(255,255,255,0.6)',
                    backdropFilter: 'blur(5px)',
                    borderRadius: 3,
                    border: '1px solid rgba(0,150,136,0.2)',
                    transition: 'all 0.3s ease',
                    '&:hover': {
                      background: 'rgba(255,255,255,0.8)',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 8px 20px rgba(0,150,136,0.15)',
                    }
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
                      <Box sx={{
                        background: 'linear-gradient(145deg, rgba(0,150,136,0.2), rgba(0,121,107,0.2))',
                        borderRadius: 2,
                        p: 1,
                      }}>
                        {React.cloneElement(field.icon, { sx: { color: '#009688', fontSize: 22 } })}
                      </Box>
                      <Typography variant="subtitle1" sx={{ 
                        color: '#00695c',
                        fontWeight: 600,
                        fontFamily: '"Inter", "Roboto", sans-serif',
                      }}>
                        {field.label}
                      </Typography>
                    </Box>
                    <TextField
                      fullWidth
                      variant="outlined"
                      value={form[field.key]}
                      onChange={e => handleChange(field.key, e.target.value)}
                      placeholder={field.placeholder}
                      size="small"
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          background: 'white',
                          borderRadius: 2,
                          fontFamily: '"Inter", "Roboto", sans-serif',
                          '& fieldset': {
                            borderColor: 'rgba(0,150,136,0.3)',
                          },
                          '&:hover fieldset': {
                            borderColor: '#009688',
                          },
                          '&.Mui-focused fieldset': {
                            borderColor: '#00796b',
                            borderWidth: '2px',
                          },
                        },
                      }}
                    />
                    <Typography variant="caption" sx={{ 
                      color: '#64748b',
                      fontFamily: '"Inter", "Roboto", sans-serif',
                      display: 'block',
                      mt: 1
                    }}>
                      {field.description}
                    </Typography>
                  </Paper>
                </Grid>
              ))}
            </Grid>
          </CardContent>
        </Card>

        {/* Medical Summary Sections */}
        <Card sx={{ 
          borderRadius: 4,
          boxShadow: '0 8px 32px rgba(0,150,136,0.1)',
          overflow: "hidden",
          background: 'linear-gradient(145deg, rgba(255,255,255,0.9), rgba(240,255,240,0.9))',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(255,255,255,0.4)',
        }}>
          <CardContent sx={{ p: 0 }}>
            <Box sx={{ 
              p: 3,
              background: 'linear-gradient(145deg, rgba(0,150,136,0.2), rgba(0,121,107,0.2))',
              backdropFilter: 'blur(10px)',
              borderBottom: '1px solid rgba(0,150,136,0.3)',
            }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box sx={{
                  background: 'linear-gradient(145deg, #009688, #00796b)',
                  borderRadius: 2.5,
                  p: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  <Description sx={{ color: 'white', fontSize: 28 }} />
                </Box>
                <Box>
                  <Typography variant="h5" sx={{ 
                    background: 'linear-gradient(145deg, #00695c, #004d40)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    fontWeight: 700,
                    fontFamily: '"Inter", "Roboto", sans-serif',
                  }}>
                    Medical Summary Sections
                  </Typography>
                  <Typography variant="body2" sx={{ 
                    color: '#37474f',
                    fontFamily: '"Inter", "Roboto", sans-serif',
                    mt: 0.5
                  }}>
                    Complete all sections below to generate a comprehensive discharge summary
                  </Typography>
                </Box>
              </Box>
            </Box>
            
            <Box sx={{ p: 3 }}>
              <Grid container spacing={3}>
                {sections.map((section, index) => (
                  <Grid item xs={12} key={section.key}>
                    <Paper sx={{
                      p: 3,
                      background: index % 2 === 0 
                        ? 'linear-gradient(145deg, rgba(255,255,255,0.8), rgba(240,255,240,0.8))'
                        : 'linear-gradient(145deg, rgba(240,255,240,0.8), rgba(255,255,255,0.8))',
                      backdropFilter: 'blur(5px)',
                      borderRadius: 3,
                      border: '1px solid rgba(0,150,136,0.2)',
                      transition: 'all 0.3s ease',
                      '&:hover': {
                        transform: 'translateY(-2px)',
                        boxShadow: '0 8px 25px rgba(0,150,136,0.15)',
                        border: '1px solid rgba(0,150,136,0.3)',
                      }
                    }}>
                      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
                        <Box sx={{
                          background: 'linear-gradient(145deg, #009688, #00796b)',
                          borderRadius: 2,
                          p: 1,
                          minWidth: 48,
                          height: 48,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          {React.cloneElement(section.icon, { sx: { color: 'white', fontSize: 24 } })}
                        </Box>
                        <Box sx={{ flex: 1 }}>
                          <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="h6" sx={{ 
                              color: '#00695c',
                              fontWeight: 700,
                              fontFamily: '"Inter", "Roboto", sans-serif',
                            }}>
                              {section.label}
                            </Typography>
                            <Chip
                              size="small"
                              label="Required"
                              sx={{
                                background: form[section.key] ? '#e8f5e9' : '#fff3e0',
                                color: form[section.key] ? '#2e7d32' : '#ed6c02',
                                fontWeight: 600,
                                fontSize: '0.7rem',
                              }}
                            />
                          </Box>
                          <Typography variant="body2" sx={{ 
                            color: '#64748b',
                            fontFamily: '"Inter", "Roboto", sans-serif',
                            mt: 0.5
                          }}>
                            {section.description}
                          </Typography>
                        </Box>
                      </Box>
                      
                      <TextField
                        multiline
                        rows={4}
                        fullWidth
                        variant="outlined"
                        value={form[section.key]}
                        onChange={e => handleChange(section.key, e.target.value)}
                        placeholder={section.placeholder}
                        sx={{
                          mt: 1,
                          '& .MuiOutlinedInput-root': {
                            background: 'white',
                            borderRadius: 2,
                            fontFamily: '"Inter", "Roboto", sans-serif',
                            '& fieldset': {
                              borderColor: 'rgba(0,150,136,0.3)',
                            },
                            '&:hover fieldset': {
                              borderColor: '#009688',
                            },
                            '&.Mui-focused fieldset': {
                              borderColor: '#00796b',
                              borderWidth: '2px',
                            },
                          },
                          '& .MuiOutlinedInput-input': {
                            fontSize: '0.95rem',
                            lineHeight: 1.6,
                          },
                        }}
                      />
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            </Box>
          </CardContent>
        </Card>

        {/* Footer Note */}
        <Box sx={{ 
          mt: 4, 
          p: 3, 
          background: 'linear-gradient(145deg, rgba(255,193,7,0.2), rgba(255,160,0,0.2))',
          backdropFilter: 'blur(10px)',
          borderRadius: 4,
          border: '1px solid rgba(255,193,7,0.3)',
          textAlign: "center",
        }}>
          <Typography variant="body2" sx={{ 
            color: '#e65100',
            fontWeight: 600,
            fontFamily: '"Inter", "Roboto", sans-serif',
          }}>
            ⚕️ This discharge summary follows hospital documentation standards. Preview to check formatting before downloading.
            Use browser's "Print" function and select "Save as PDF" for best results.
          </Typography>
        </Box>

        <style>
          {`
            @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
            
            @keyframes pulse {
              0% { opacity: 1; box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.4); }
              50% { opacity: 0.8; box-shadow: 0 0 20px 5px rgba(255, 193, 7, 0.6); }
              100% { opacity: 1; box-shadow: 0 0 0 0 rgba(255, 193, 7, 0.4); }
            }
          `}
        </style>
      </Container>
    </Box>
  );
}