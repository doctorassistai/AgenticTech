import React, { useState, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import {
  Box,
  Typography,
  TextField,
  Paper,
  Grid,
  Button,
  Divider,
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Avatar,
  Chip,
  Stack,
  alpha,
  useTheme
} from "@mui/material";
import { 
  PictureAsPdf, 
  Visibility,
  LocalHospital,
  MedicalServices,
  Person,
  ArrowBack,
  Badge,
  Business,
  CalendarToday,
  Email,
  Phone,
  LocationOn,
  Assignment,
  CheckCircle,
  Download
} from "@mui/icons-material";
import { styled } from "@mui/material/styles";

const StyledPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(4),
  borderRadius: 20,
  background: "#ffffff",
  boxShadow: "0 10px 40px rgba(0,0,0,0.08)",
  border: "1px solid rgba(11,79,108,0.08)",
  transition: "all 0.3s ease",
  "&:hover": {
    boxShadow: "0 20px 60px rgba(11,79,108,0.12)",
  },
}));

const SectionTitle = styled(Typography)(({ theme }) => ({
  fontWeight: 700,
  color: "#0b4f6c",
  marginBottom: theme.spacing(2),
  fontSize: "0.95rem",
  display: "flex",
  alignItems: "center",
  gap: theme.spacing(1.2),
  letterSpacing: "0.3px",
  textTransform: "uppercase",
  borderBottom: `2px solid ${alpha("#0b4f6c", 0.12)}`,
  paddingBottom: theme.spacing(1.2),
}));

const StyledTextField = styled(TextField)(({ theme }) => ({
  "& .MuiOutlinedInput-root": {
    borderRadius: 14,
    backgroundColor: "#ffffff",
    transition: "all 0.2s ease",
    border: "1px solid #e2e8f0",
    "&:hover": {
      backgroundColor: "#fafafa",
      borderColor: "#0b4f6c",
    },
    "&.Mui-focused": {
      backgroundColor: "#ffffff",
      borderColor: "#0b4f6c",
      boxShadow: `0 0 0 4px ${alpha("#0b4f6c", 0.08)}`,
    },
  },
  "& .MuiInputLabel-root": {
    fontWeight: 600,
    color: "#475569",
    fontSize: "0.9rem",
    "&.Mui-focused": {
      color: "#0b4f6c",
    },
  },
}));

const InfoChip = styled(Chip)(({ theme }) => ({
  backgroundColor: alpha("#0b4f6c", 0.08),
  color: "#0b4f6c",
  fontWeight: 600,
  borderRadius: 10,
  height: 32,
  "& .MuiChip-icon": {
    color: "#0b4f6c",
  },
  "&:hover": {
    backgroundColor: alpha("#0b4f6c", 0.12),
  },
}));



const ClinicalSummaryPaper = styled(Paper)(({ theme }) => ({
  padding: theme.spacing(3),
  backgroundColor: alpha("#f8fafc", 0.6),
  borderRadius: 16,
  border: `1px solid ${alpha("#0b4f6c", 0.08)}`,
  minHeight: 200,
  maxHeight: 350,
  overflowY: "auto",
  "&::-webkit-scrollbar": {
    width: 6,
  },
  "&::-webkit-scrollbar-track": {
    background: alpha("#0b4f6c", 0.04),
    borderRadius: 10,
  },
  "&::-webkit-scrollbar-thumb": {
    background: alpha("#0b4f6c", 0.2),
    borderRadius: 10,
    "&:hover": {
      background: alpha("#0b4f6c", 0.3),
    },
  },
}));

export default function ReferralLetterPanel({ data }) {
  
  const BASE_URL = import.meta.env.VITE_BACKEND_URL;

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);

  const doctorId = queryParams.get("doctor_id");
  const patientId = queryParams.get("patient_id");

  const [doctorInfo, setDoctorInfo] = useState(null);
  const [patientInfo, setPatientInfo] = useState(null);

  const isReady = doctorInfo && patientInfo;

  const theme = useTheme();
  const printRef = useRef();
  const previewRef = useRef();
  
  const referral = data?.referral_letter ?? {};
  const encounterInfo = data?.encounter_info ?? {};

  const [form, setForm] = useState({
    referring_doctor_details: referral.referring_doctor_details || "",
    referred_to_specialty_or_doctor: referral.referred_to_specialty_or_doctor || "",
    reason_for_referral: referral.reason_for_referral || "",
  });
  
  useEffect(() => {
    if (!doctorId || !patientId) return;

    const controller = new AbortController();

    const fetchMetadata = async () => {
      try {
        const [doctorRes, patientRes] = await Promise.all([
          fetch(
            `${BASE_URL}hms/users/data/context/get-doctor-info?sys_user_id=${doctorId}`,
            { signal: controller.signal }
          ),
          fetch(
            `${BASE_URL}hms/users/data/context/get-patient-info?patient_id=${patientId}`,
            { signal: controller.signal }
          ),
        ]);

        if (!doctorRes.ok) throw new Error("Doctor fetch failed");
        if (!patientRes.ok) throw new Error("Patient fetch failed");

        const doctorData = await doctorRes.json();
        const patientData = await patientRes.json();

        setDoctorInfo(doctorData?.data ?? doctorData);
        setPatientInfo(patientData?.data ?? patientData);

      } catch (error) {
        if (error.name !== "AbortError") {
          console.error("Metadata fetch error:", error);
        }
      }
    };

    fetchMetadata();

    return () => controller.abort();
  }, [doctorId, patientId]);


  useEffect(() => {
    if (!data?.referral_letter) return;
    const referralData = data.referral_letter;
    setForm({
      referring_doctor_details: referralData.referring_doctor_details || "",
      referred_to_specialty_or_doctor: referralData.referred_to_specialty_or_doctor || "",
      reason_for_referral: referralData.reason_for_referral || "",
    });
  }, [data]);

  const [previewOpen, setPreviewOpen] = useState(false);

  const handleChange = (field) => (event) => {
    setForm({ ...form, [field]: event.target.value });
  };

  const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });
  };

  const parseDoctorDetails = (details) => {
    if (!details) return { name: "", specialty: "", license: "" };
    const parts = details.split('\n');
    return {
      name: parts[0] || "",
      specialty: parts[1] || "",
      license: parts[2] || ""
    };
  };

  const referringDoctor = parseDoctorDetails(form.referring_doctor_details);
  const referredDoctor = parseDoctorDetails(form.referred_to_specialty_or_doctor);

  // =========================
  // PDF GENERATION
  // =========================
  const handlePrint = () => {
    const win = window.open("", "", "height=900,width=1000");
    const currentDate = new Date();
    
    win.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Medical Referral Letter - ${patientInfo?.patient_name || 'Patient'} - ${currentDate.toLocaleDateString()}</title>
          <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
          <style>
            * {
              margin: 0;
              padding: 0;
              box-sizing: border-box;
            }
            
            body {
              font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
              background: #f1f5f9;
              padding: 40px 20px;
              color: #1e293b;
              line-height: 1.6;
            }
            
            .letter {
              max-width: 850px;
              margin: 0 auto;
              background: white;
              border-radius: 32px;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
              overflow: hidden;
            }
            
            .letter-header {
              background: linear-gradient(165deg, #0b4f6c 0%, #0a5c7e 45%, #0d6b8c 100%);
              padding: 35px 40px;
              color: white;
              position: relative;
            }
            
            .letter-header::before {
              content: "";
              position: absolute;
              top: 0;
              left: 0;
              right: 0;
              bottom: 0;
              background: linear-gradient(45deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0) 100%);
              pointer-events: none;
            }
            
            .hospital-info {
              display: flex;
              justify-content: space-between;
              align-items: flex-start;
              margin-bottom: 30px;
            }
            
            .hospital-name-section h1 {
              font-size: 28px;
              font-weight: 800;
              letter-spacing: -0.5px;
              margin-bottom: 6px;
              color: white;
            }
            
            .hospital-details {
              font-size: 13px;
              opacity: 0.9;
              line-height: 1.6;
            }
            
            .badge {
              background: rgba(255,255,255,0.15);
              backdrop-filter: blur(10px);
              padding: 10px 20px;
              border-radius: 40px;
              font-size: 13px;
              font-weight: 600;
              letter-spacing: 0.5px;
              border: 1px solid rgba(255,255,255,0.2);
            }
            
            .patient-banner {
              background: rgba(255,255,255,0.1);
              backdrop-filter: blur(10px);
              border-radius: 20px;
              padding: 20px;
              margin-top: 20px;
              display: flex;
              gap: 30px;
              border: 1px solid rgba(255,255,255,0.15);
            }
            
            .patient-info-item {
              display: flex;
              flex-direction: column;
            }
            
            .patient-info-label {
              font-size: 11px;
              text-transform: uppercase;
              letter-spacing: 1px;
              opacity: 0.8;
              margin-bottom: 4px;
            }
            
            .patient-info-value {
              font-size: 16px;
              font-weight: 700;
            }
            
            .letter-content {
              padding: 45px 40px;
            }
            
            .section {
              margin-bottom: 35px;
            }
            
            .section-title {
              font-weight: 700;
              color: #0b4f6c;
              font-size: 15px;
              text-transform: uppercase;
              letter-spacing: 1px;
              margin-bottom: 15px;
              border-bottom: 2px solid #e6f0f5;
              padding-bottom: 10px;
              display: flex;
              align-items: center;
              gap: 8px;
            }
            
            .doctor-card {
              background: linear-gradient(to right, #f8fafc, white);
              border-left: 4px solid #0b4f6c;
              border-radius: 16px;
              padding: 20px;
              display: flex;
              gap: 20px;
              margin-bottom: 20px;
              box-shadow: 0 2px 8px rgba(0,0,0,0.02);
            }
            
            .doctor-avatar {
              width: 48px;
              height: 48px;
              background: linear-gradient(135deg, #0b4f6c, #0d6b8c);
              border-radius: 16px;
              display: flex;
              align-items: center;
              justify-content: center;
              color: white;
              font-size: 20px;
            }
            
            .doctor-details h3 {
              font-size: 18px;
              font-weight: 700;
              color: #0b4f6c;
              margin-bottom: 6px;
            }
            
            .doctor-meta {
              color: #64748b;
              font-size: 14px;
              margin-bottom: 4px;
            }
            
            .clinical-content {
              background: #f8fafc;
              border-radius: 16px;
              padding: 25px;
              font-size: 15px;
              line-height: 1.8;
              color: #1e293b;
              border: 1px solid #e2e8f0;
              white-space: pre-wrap;
            }
            
            .reason-card {
              background: white;
              border: 1px solid #e2e8f0;
              border-radius: 16px;
              padding: 25px;
              margin-top: 10px;
              box-shadow: 0 4px 12px rgba(0,0,0,0.02);
            }
            
            .footer {
              margin-top: 50px;
              padding-top: 30px;
              border-top: 2px solid #e2e8f0;
              display: flex;
              justify-content: space-between;
              align-items: flex-end;
            }
            
            .signature-area {
              text-align: left;
            }
            
            .signature-line {
              font-size: 20px;
              font-weight: 700;
              color: #0b4f6c;
              margin-bottom: 5px;
              font-family: 'Brush Script MT', cursive;
            }
            
            .signature-title {
              color: #64748b;
              font-size: 13px;
            }
            
            .footer-date {
              text-align: right;
              color: #64748b;
              font-size: 14px;
            }
            
            .footer-date strong {
              color: #0b4f6c;
            }
            
            hr {
              display: none;
            }
            
            .empty-field {
              color: #94a3b8;
              font-style: italic;
              background: #f1f5f9;
              padding: 12px 16px;
              border-radius: 10px;
              display: inline-block;
            }
          </style>
        </head>
        <body>
          <div class="letter">
            <div class="letter-header">
              <div class="hospital-info">
                <div class="hospital-name-section">
                  <h1>${doctorInfo?.hospital_name?.toUpperCase() || 'HOSPITAL NAME'}</h1>
                </div>
                <div class="badge">
                  REFERRAL #${encounterInfo?.encounter_id?.slice(-6) || Math.floor(Math.random() * 10000).toString().padStart(4, '0')}
                </div>
              </div>
              
              <div class="patient-banner">
                <div class="patient-info-item">
                  <span class="patient-info-label">Patient Name</span>
                  <span class="patient-info-value">${patientInfo?.patient_name || '____________________'}</span>
                </div>
                <div class="patient-info-item">
                  <span class="patient-info-label">Date of Birth</span>
                  <span class="patient-info-value">${patientInfo.dob ? formatDate(patientInfo.dob) : '__________'}</span>
                </div>
                <div class="patient-info-item">
                  <span class="patient-info-label">MRN</span>
                  <span class="patient-info-value">${patientInfo?.hms_id || '__________'}</span>
                </div>
              </div>
            </div>
            
            <div class="letter-content">
              <!-- Referring Physician -->
              <div class="section">
                <div class="section-title">👨‍⚕️ Referring Physician</div>
                <div class="doctor-card">
                  <div class="doctor-avatar">👤</div>
                  <div class="doctor-details">
                    ${referringDoctor.name ? 
                      `<h3>${referringDoctor.name?.toUpperCase()}</h3>
                        <div class="doctor-meta">${referringDoctor.specialty?.toUpperCase() || ''}</div>
                       <div style="color: #64748b; font-size: 13px;">${referringDoctor.license || ''}</div>` 
                      : '<span class="empty-field">Referring physician details not specified</span>'}
                  </div>
                </div>
              </div>
              
              <!-- Referred To -->
              <div class="section">
                <div class="section-title">🏥 Referred To</div>
                <div class="doctor-card">
                  <div class="doctor-avatar">👨‍🔬</div>
                  <div class="doctor-details">
                    ${referredDoctor.name ? 
                      `<h3>${referredDoctor.name?.toUpperCase()}</h3>
                        <div class="doctor-meta">${referredDoctor.specialty?.toUpperCase() || ''}</div>
                       <div style="color: #64748b; font-size: 13px;">${referredDoctor.license || ''}</div>` 
                      : '<span class="empty-field">Consultant/Specialty not specified</span>'}
                  </div>
                </div>
              </div>
              
              <!-- Reason for Referral -->
              <div class="section">
                <div class="section-title">📋 Reason for Referral</div>
                <div class="reason-card">
                  ${form.reason_for_referral ? 
                    `<div style="white-space: pre-wrap; line-height: 1.8;">${form.reason_for_referral}</div>` 
                    : '<span class="empty-field">No reason for referral specified</span>'}
                </div>
              </div>
              
              <!-- Clinical Summary -->
              <div class="section">
                <div class="section-title">📊 Clinical Summary</div>
                <div class="clinical-content">
                  ${referral.clinical_summary ? 
                    referral.clinical_summary.replace(/\\n/g, '<br>') 
                    : '<span class="empty-field">No clinical summary provided</span>'}
                </div>
              </div>
              
              <!-- Additional Information -->
              ${encounterInfo?.diagnosis ? `
              <div class="section">
                <div class="section-title">🔬 Diagnosis</div>
                <div style="background: #f0f9ff; border-radius: 12px; padding: 16px 20px; border-left: 4px solid #0284c7;">
                  ${encounterInfo.diagnosis}
                </div>
              </div>
              ` : ''}
              
              <div class="footer">
                <div class="footer-date">
                  <strong>Date of Referral</strong><br>
                  ${currentDate.toLocaleDateString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                  })}
                </div>
              </div>
              
              <div style="margin-top: 30px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; padding-top: 20px;">
                This is an electronically generated medical referral letter • Valid with electronic signature
              </div>
            </div>
          </div>
        </body>
      </html>
    `);
    
    win.document.close();
    win.focus();
    setTimeout(() => {
      win.print();
      win.close();
    }, 500);
  };

  // =========================
  // Printable Layout
  // =========================
  const PrintableLetter = () => (
    <Box ref={printRef} sx={{ fontFamily: "'Inter', sans-serif" }}>
      {/* Content is generated in the PDF window */}
    </Box>
  );

  return (
    <>
      <StyledPaper elevation={0}>
        {/* Header with Actions */}
        <Box sx={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "flex-start",
          mb: 4
        }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2.5 }}>
            <Avatar 
              sx={{ 
                bgcolor: alpha("#0b4f6c", 0.1), 
                color: "#0b4f6c",
                width: 56, 
                height: 56,
                borderRadius: 3
              }}
            >
              <LocalHospital sx={{ fontSize: 32 }} />
            </Avatar>
            <Box>
              <Typography 
                variant="h4" 
                fontWeight={800} 
                color="#0b4f6c" 
                gutterBottom
                sx={{ letterSpacing: "-0.5px" }}
              >
                Referral Letter
              </Typography>
              <Stack direction="row" spacing={1}>
                <InfoChip 
                  icon={<Assignment />} 
                  label={`Ref #${encounterInfo?.encounter_id?.slice(-6) || 'NEW'}`} 
                  size="small"
                />
                <InfoChip 
                  icon={<CalendarToday />} 
                  label={formatDate(new Date())} 
                  size="small"
                />
              </Stack>
            </Box>
          </Box>
          
          <Stack direction="row" spacing={1.5}>
            <Button
              variant="outlined"
              startIcon={<Visibility />}
              onClick={() => setPreviewOpen(true)}
              sx={{
                borderRadius: 3,
                px: 3,
                py: 1.2,
                borderColor: alpha("#0b4f6c", 0.3),
                color: "#0b4f6c",
                fontWeight: 600,
                "&:hover": {
                  borderColor: "#0b4f6c",
                  backgroundColor: alpha("#0b4f6c", 0.04),
                },
              }}
            >
              Preview
            </Button>
            <Button
              variant="contained"
              startIcon={<Download />}
              onClick={handlePrint}
              sx={{
                borderRadius: 3,
                px: 3,
                py: 1.2,
                background: "linear-gradient(135deg, #0b4f6c 0%, #0a5c7e 100%)",
                fontWeight: 600,
                boxShadow: `0 8px 16px -4px ${alpha("#0b4f6c", 0.3)}`,
                "&:hover": {
                  background: "linear-gradient(135deg, #0a5c7e 0%, #094c66 100%)",
                  boxShadow: `0 12px 20px -6px ${alpha("#0b4f6c", 0.4)}`,
                },
              }}
            >
              Generate PDF
            </Button>
          </Stack>
        </Box>

        <Divider sx={{ mb: 4, borderColor: alpha("#0b4f6c", 0.08) }} />

        {/* Patient Information Summary */}
        {patientInfo?.patient_name && (
          <Box sx={{ 
            mb: 4, 
            p: 2.5, 
            bgcolor: alpha("#0b4f6c", 0.02), 
            borderRadius: 3,
            border: `1px solid ${alpha("#0b4f6c", 0.08)}`
          }}>
            <Grid container spacing={3} alignItems="center">
              <Grid item xs={12} sm={4}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  Patient Name
                </Typography>
                <Typography variant="body1" fontWeight={700} color="#0b4f6c">
                  {patientInfo?.patient_name
}
                </Typography>
              </Grid>
              {patientInfo.dob && (
                <Grid item xs={12} sm={3}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    Date of Birth
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {formatDate(patientInfo.dob)}
                  </Typography>
                </Grid>
              )}
              {patientInfo?.hms_id && (
                <Grid item xs={12} sm={3}>
                  <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                    MRN
                  </Typography>
                  <Typography variant="body1" fontWeight={600}>
                    {patientInfo?.hms_id}
                  </Typography>
                </Grid>
              )}
            </Grid>
          </Box>
        )}

        {/* Form Fields */}
        <Grid container spacing={4}>
          <Grid item xs={12} md={6}>
            <SectionTitle>
              <Badge sx={{ fontSize: 20 }} />
              Referring Physician
            </SectionTitle>
            <StyledTextField
              fullWidth
              multiline
              minRows={3}
              placeholder="Dr. John Smith&#10;Cardiology&#10;License #MED12345"
              value={form.referring_doctor_details}
              onChange={handleChange("referring_doctor_details")}
              variant="outlined"
              size="small"
              InputProps={{
                sx: { typography: "body2" }
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              Enter: Name • Specialty • License #
            </Typography>
          </Grid>

          <Grid item xs={12} md={6}>
            <SectionTitle>
              <Business sx={{ fontSize: 20 }} />
              Consultant / Specialty
            </SectionTitle>
            <StyledTextField
              fullWidth
              multiline
              minRows={3}
              placeholder="Dr. Sarah Johnson&#10;Neurology&#10;City Medical Center"
              value={form.referred_to_specialty_or_doctor}
              onChange={handleChange("referred_to_specialty_or_doctor")}
              variant="outlined"
              size="small"
              InputProps={{
                sx: { typography: "body2" }
              }}
            />
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: "block" }}>
              Enter: Name • Specialty • Institution
            </Typography>
          </Grid>

          <Grid item xs={12}>
            <SectionTitle>
              <Assignment sx={{ fontSize: 20 }} />
              Reason for Referral
            </SectionTitle>
            <StyledTextField
              fullWidth
              multiline
              minRows={4}
              placeholder="Please provide detailed clinical reason for specialist consultation..."
              value={form.reason_for_referral}
              onChange={handleChange("reason_for_referral")}
              variant="outlined"
              size="small"
            />
          </Grid>

          <Grid item xs={12}>
            <SectionTitle>
              <MedicalServices sx={{ fontSize: 20 }} />
              Clinical Summary
            </SectionTitle>
            <ClinicalSummaryPaper elevation={0}>
              {referral.clinical_summary ? (
                <Typography 
                  variant="body2" 
                  sx={{ 
                    whiteSpace: "pre-wrap",
                    lineHeight: 1.8,
                    color: "#1e293b"
                  }}
                >
                  {referral.clinical_summary}
                </Typography>
              ) : (
                <Box 
                  sx={{ 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    height: "100%",
                    minHeight: 160,
                    color: "text.secondary",
                    flexDirection: "column",
                    gap: 1
                  }}
                >
                  <MedicalServices sx={{ fontSize: 40, color: alpha("#0b4f6c", 0.2) }} />
                  <Typography variant="body2" sx={{ fontStyle: "italic" }}>
                    No clinical summary available
                  </Typography>
                </Box>
              )}
            </ClinicalSummaryPaper>
          </Grid>

          {/* Diagnosis Section */}
          {encounterInfo?.diagnosis && (
            <Grid item xs={12}>
              <SectionTitle>
                <CheckCircle sx={{ fontSize: 20 }} />
                Diagnosis
              </SectionTitle>
              <Paper
                elevation={0}
                sx={{
                  p: 2.5,
                  bgcolor: alpha("#0284c7", 0.04),
                  borderRadius: 3,
                  border: `1px solid ${alpha("#0284c7", 0.2)}`,
                  borderLeft: `4px solid #0284c7`
                }}
              >
                <Typography variant="body2" fontWeight={500}>
                  {encounterInfo.diagnosis}
                </Typography>
              </Paper>
            </Grid>
          )}
        </Grid>

        {/* Institution Footer */}
        <Box sx={{ 
          mt: 6, 
          pt: 3, 
          borderTop: `1px solid ${alpha("#0b4f6c", 0.08)}`,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}>
          <Stack direction="row" spacing={3} alignItems="center">
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <LocalHospital sx={{ fontSize: 20, color: alpha("#0b4f6c", 0.6) }} />
              <Typography variant="body2" color="text.secondary">
                {doctorInfo?.hospital_name || 'Healthcare System'}
              </Typography>
            </Box>
          </Stack>
          <Typography variant="caption" sx={{ color: alpha("#0b4f6c", 0.6), fontWeight: 500 }}>
            Generated: {formatDate(new Date())}
          </Typography>
        </Box>
      </StyledPaper>

      {/* Preview Dialog */}
      <Dialog
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        maxWidth="lg"
        fullWidth
        PaperProps={{
          sx: {
            borderRadius: 4,
            overflow: "hidden",
            background: "#f8fafc",
          }
        }}
      >
        <DialogTitle sx={{ 
          bgcolor: "#0b4f6c", 
          color: "white",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          py: 2.5,
          px: 3
        }}>
          <Stack direction="row" spacing={2} alignItems="center">
            <Avatar sx={{ bgcolor: "rgba(255,255,255,0.2)", color: "white", borderRadius: 2 }}>
              <Visibility />
            </Avatar>
            <Box>
              <Typography variant="h6" fontWeight={700}>
                Referral Letter Preview
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.9 }}>
                {patientInfo?.patient_name || 'Patient'} • {formatDate(new Date())}
              </Typography>
            </Box>
          </Stack>
          <IconButton 
            onClick={() => setPreviewOpen(false)}
            sx={{ 
              color: "white",
              bgcolor: "rgba(255,255,255,0.1)",
              "&:hover": { bgcolor: "rgba(255,255,255,0.2)" }
            }}
          >
            <ArrowBack />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 4 }}>
          <Paper 
            elevation={0} 
            sx={{ 
              p: 4, 
              borderRadius: 3,
              border: `1px solid ${alpha("#0b4f6c", 0.08)}`,
              minHeight: 600,
              bgcolor: "white"
            }}
          >
            <Box sx={{ maxWidth: 800, mx: "auto" }}>
              {/* Preview Header */}
              <Box sx={{ 
                mb: 4, 
                pb: 3, 
                borderBottom: `2px solid ${alpha("#0b4f6c", 0.12)}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start"
              }}>
                <Box>
                  <Typography variant="h5" fontWeight={800} color="#0b4f6c" gutterBottom>
                    {doctorInfo?.hospital_name?.toUpperCase() || 'hospital name'}
                  </Typography>
                </Box>
                <Chip 
                  label={`REFERRAL #${encounterInfo?.encounter_id?.slice(-6) || '0000'}`}
                  sx={{ 
                    bgcolor: alpha("#0b4f6c", 0.1),
                    color: "#0b4f6c",
                    fontWeight: 700,
                    borderRadius: 2
                  }}
                />
              </Box>

              {/* Preview Content */}
              <Grid container spacing={3}>
                {/* Referring Doctor */}
                <Grid item xs={12} md={6}>
                  <Typography variant="overline" sx={{ color: alpha("#0b4f6c", 0.7), fontWeight: 700 }}>
                    REFERRING PHYSICIAN
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2, mt: 1, bgcolor: alpha("#0b4f6c", 0.02), borderRadius: 2 }}>
                    {referringDoctor.name ? (
                      <>
                        <Typography variant="subtitle1" fontWeight={700} color="#0b4f6c">
                          {referringDoctor.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {referringDoctor.specialty}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {referringDoctor.license}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                        Not specified
                      </Typography>
                    )}
                  </Paper>
                </Grid>

                {/* Referred To */}
                <Grid item xs={12} md={6}>
                  <Typography variant="overline" sx={{ color: alpha("#0b4f6c", 0.7), fontWeight: 700 }}>
                    CONSULTANT / SPECIALTY
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 2, mt: 1, bgcolor: alpha("#0b4f6c", 0.02), borderRadius: 2 }}>
                    {referredDoctor.name ? (
                      <>
                        <Typography variant="subtitle1" fontWeight={700} color="#0b4f6c">
                          {referredDoctor.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {referredDoctor.specialty}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {referredDoctor.license}
                        </Typography>
                      </>
                    ) : (
                      <Typography variant="body2" color="text.secondary" sx={{ fontStyle: "italic" }}>
                        Not specified
                      </Typography>
                    )}
                  </Paper>
                </Grid>

                {/* Reason for Referral */}
                <Grid item xs={12}>
                  <Typography variant="overline" sx={{ color: alpha("#0b4f6c", 0.7), fontWeight: 700 }}>
                    REASON FOR REFERRAL
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 3, mt: 1, borderRadius: 2 }}>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap" }}>
                      {form.reason_for_referral || (
                        <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                          No reason for referral specified
                        </span>
                      )}
                    </Typography>
                  </Paper>
                </Grid>

                {/* Clinical Summary */}
                <Grid item xs={12}>
                  <Typography variant="overline" sx={{ color: alpha("#0b4f6c", 0.7), fontWeight: 700 }}>
                    CLINICAL SUMMARY
                  </Typography>
                  <Paper variant="outlined" sx={{ p: 3, mt: 1, bgcolor: "#f8fafc", borderRadius: 2 }}>
                    <Typography variant="body2" sx={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>
                      {referral.clinical_summary || (
                        <span style={{ color: "#94a3b8", fontStyle: "italic" }}>
                          No clinical summary provided
                        </span>
                      )}
                    </Typography>
                  </Paper>
                </Grid>
              </Grid>

              {/* Preview Footer */}
              <Box sx={{ 
                mt: 5, 
                pt: 3, 
                borderTop: `1px solid ${alpha("#0b4f6c", 0.12)}`,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-end"
              }}>
                
                <Box sx={{ textAlign: "right" }}>
                  <Typography variant="body2" fontWeight={700} color="#0b4f6c">
                    {formatDate(new Date())}
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Date of Referral
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Paper>
        </DialogContent>
      </Dialog>
    </>
  );
}