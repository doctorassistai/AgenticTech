import React, { useState, useEffect } from 'react';
import {
  Box,
  Typography,
  Button,
  IconButton,
  Alert,
  LinearProgress,
  Tooltip,
  CircularProgress,
  Chip,
} from '@mui/material';
import {
  RefreshRounded,
  ChevronLeftRounded,
  ChevronRightRounded,
  WarningAmberRounded,
  CheckCircleRounded,
  AssessmentRounded,
  MedicalServicesRounded,
  ScienceRounded,
  GavelRounded,
  LocalHospitalRounded,
  BiotechRounded,
  MedicationRounded,
  DescriptionRounded,
  PaidRounded,
  SecurityRounded,
  LogoutRounded,
  VerifiedRounded,
  TimelineRounded,
  ErrorRounded,
  InfoRounded,
} from '@mui/icons-material';
import html2pdf from "html2pdf.js";

const API_BASE_URL = 'https://doctorassist.ai/api/hms/users/ai-legacy';

// Design tokens - BLACK & WHITE ONLY
const FONT = '"Open Sans", sans-serif';
const FW = 400; // uniform font weight

const C = {
  black: "#000000",
  white: "#ffffff",
  gray900: "#1a1a1a",
  gray800: "#2e2e2e",
  gray700: "#4a4a4a",
  gray600: "#7a7a7a",
  gray500: "#a8a8a8",
  gray400: "#d4d4d4",
  gray300: "#e8e8e8",
  gray200: "#f2f2f2",
  gray100: "#f9f9f9",
};

const os = (extra = {}) => ({
  fontFamily: FONT,
  fontWeight: FW,
  ...extra,
});

const cardStyle = {
  background: C.white,
  border: `1px solid ${C.gray400}`,
  borderRadius: "4px",
  boxShadow: "none",
};

const sectionHeader = {
  px: { xs: 2.5, sm: 3 },
  pt: { xs: 2.5, sm: 3 },
  pb: 2,
  borderBottom: `1px solid ${C.gray400}`,
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 2,
  flexWrap: "wrap",
};

const sidebarModules = [
  { id: 'medical_adequacy', name: 'Medical Adequacy', icon: <AssessmentRounded sx={{ fontSize: 18 }} /> },
  { id: 'medical_sufficiency', name: 'Medical Sufficiency', icon: <CheckCircleRounded sx={{ fontSize: 18 }} /> },
  { id: 'clinical_derivation', name: 'Clinical Derivation', icon: <BiotechRounded sx={{ fontSize: 18 }} /> },
  { id: 'patient_policy', name: 'Patient & Policy', icon: <MedicalServicesRounded sx={{ fontSize: 18 }} /> },
  { id: 'clinical_justification', name: 'Clinical Justification', icon: <GavelRounded sx={{ fontSize: 18 }} /> },
  { id: 'admission_review', name: 'Admission Review', icon: <LocalHospitalRounded sx={{ fontSize: 18 }} /> },
  { id: 'investigation_audit', name: 'Investigation Audit', icon: <ScienceRounded sx={{ fontSize: 18 }} /> },
  { id: 'treatment_procedure', name: 'Treatment & Procedure', icon: <MedicalServicesRounded sx={{ fontSize: 18 }} /> },
  { id: 'medication_review', name: 'Medication Review', icon: <MedicationRounded sx={{ fontSize: 18 }} /> },
  { id: 'documentation_audit', name: 'Documentation Audit', icon: <DescriptionRounded sx={{ fontSize: 18 }} /> },
  { id: 'billing_audit', name: 'Billing Audit', icon: <PaidRounded sx={{ fontSize: 18 }} /> },
  { id: 'fraud_screening', name: 'Fraud Screening', icon: <SecurityRounded sx={{ fontSize: 18 }} /> },
  { id: 'discharge_outcome', name: 'Discharge & Outcome', icon: <LogoutRounded sx={{ fontSize: 18 }} /> },
  { id: 'specialty', name: 'Specialty', icon: <VerifiedRounded sx={{ fontSize: 18 }} /> },
  { id: 'coding_compliance', name: 'Coding & Compliance', icon: <GavelRounded sx={{ fontSize: 18 }} /> }
];

function Unifiedinsurance({ patientId: propPatientId, doctorId: propdoctorId }) {
  const [selectedModule, setSelectedModule] = useState('medical_adequacy');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [patientData, setPatientData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState(null);
  const [showAllMedications, setShowAllMedications] = useState(false);
  const [showAllBillableItems, setShowAllBillableItems] = useState(false);
  const [showAllInvestigations, setShowAllInvestigations] = useState(false);

  const patientId = propPatientId;
  const doctorId = propdoctorId;

  const safeString = (value) => {
    if (typeof value === 'string') return value;
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if (value.message) return value.message;
      if (value.description) return value.description;
      if (value.text) return value.text;
      if (value.reason) return value.reason;
      if (value.name) return value.name;
      if (value.details) return value.details;
      if (value.evidence) return value.evidence;
      try {
        return JSON.stringify(value);
      } catch {
        return 'Information';
      }
    }
    return String(value);
  };

  useEffect(() => {
    if (patientId) {
      fetchExistingData();
    }
  }, [patientId]);

  const fetchExistingData = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `${API_BASE_URL}/clinical-reasoning/result/${patientId}`
      );
      
      if (!response.ok) {
        throw new Error('No existing data found');
      }
      
      const data = await response.json();
      console.log("Existing data:", data);
      
      if (data.data) {
        setPatientData(data.data);
      } else {
        setPatientData(data);
      }
    } catch (err) {
      console.log("No existing data found, will need to run analysis");
      setPatientData(null);
    } finally {
      setLoading(false);
    }
  };

  const runAnalysis = async () => {
    setProcessing(true);
    setError(null);
    try {
      const response = await fetch(`${API_BASE_URL}/helo/clinical-reasoning`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, consultation_text: "Current user consultation" })
      });
      if (!response.ok) throw new Error("Failed to run clinical analysis");
      const data = await response.json();
      console.log("Raw API Response",data)
      setPatientData(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleGeneratePDF = () => {
  const html = generateReportHTML(patientData);

  const element = document.createElement("div");
  element.innerHTML = html;

  html2pdf()
    .from(element)
    .set({
      margin: 0.5,
      filename: "claim_report.pdf",
      html2canvas: { scale: 2 },
      jsPDF: { format: "a4", orientation: "portrait" }
    })
    .save();
};

const generateReportHTML = (data) => {
  if (!data) return '<html><body>No data available</body></html>';
  
  // Extract from engine_specific_results
  const patientPolicy = data?.engine_specific_results?.['Patient & Policy Engine'] || {};
  const admissionReview = data?.engine_specific_results?.['Admission Review Engine'] || {};
  const medicationReview = data?.engine_specific_results?.['Medication Review Engine'] || {};
  const treatmentProcedure = data?.engine_specific_results?.['Treatment & Procedure Engine'] || {};
  const codingCompliance = data?.engine_specific_results?.['Coding & Compliance Engine'] || {};
  const billingAudit = data?.engine_specific_results?.['Billing Audit Engine'] || {};
  const dischargeOutcome = data?.engine_specific_results?.['Discharge & Outcome Engine'] || {};
  const fraudScreening = data?.engine_specific_results?.['Fraud Screening Engine'] || {};
  const investigationAudit = data?.engine_specific_results?.['Investigation Audit Engine'] || {};
  
  // Extract from medical_adequacy_results
  const medicalAdequacy = data?.medical_adequacy_results || {};
  
  // Extract from medical_sufficiency_results
  const medicalSufficiency = data?.medical_sufficiency_results || {};
  
  // Extract from clinical_context
  const clinicalContext = data?.clinical_context || {};
  
  // Extract from verification_results
  const verificationResults = data?.verification_results || {};
  const workplaceVisit = verificationResults?.workplace_visit || {};
  const employerVisit = verificationResults?.employer_visit || {};
  const socialMediaFindings = verificationResults?.social_media_findings || {};
  const googleMapDetails = verificationResults?.google_map_details || {};
  const pharmacyVisit = verificationResults?.pharmacy_visit || {};
  const labRadiologyVisit = verificationResults?.lab_radiology_visit || {};
  const evidenceGrade = verificationResults?.evidence_grade || {};
  
  // Patient Demographics
  const demographics = patientPolicy?.patient_demographics || {};
  const patientName = demographics.name || '—';
  const patientAge = demographics.age || '—';
  const patientGender = demographics.gender || '—';
  const patientPhone = demographics.phone_number || '—';
  const patientDOB = demographics.date_of_birth || '—';
  const patientBloodGroup = demographics.blood_group || '—';
  const patientHmsId = demographics.hms_id || '—';
  const patientAddress = demographics.address || '—';
  const patientOccupation = demographics.occupation || '—';
  const kycDetails = demographics.kyc_details || (patientHmsId !== '—' ? 'Available' : '—');
  
  // Insurance Info
  const insuranceInfo = patientPolicy?.policy_details?.insurance_info || {};
  const policyNumber = insuranceInfo.policy_number || '—';
  const claimNumber = insuranceInfo.claim_number || '—';
  const policyProduct = insuranceInfo.policy_product || '—';
  
  // Hospital Info
  const hospitalInfo = patientPolicy?.hospital_info || {};
  const hospitalName = hospitalInfo.name || '—';
  const hospitalCity = hospitalInfo.city || '—';
  const claimAmount = patientPolicy?.claim_amount || '—';
  const allocationDate = patientPolicy?.allocation_date || '—';
  const submissionDate = patientPolicy?.submission_date || '—';
  const investigationTAT = patientPolicy?.investigation_tat || '—';
  
  // Admission Details
  const admissionDate = admissionReview?.admission_date || clinicalContext?.date_range?.earliest || '—';
  const admissionTime = admissionReview?.admission_time || '—';
  const dischargeDate = admissionReview?.discharge_date || clinicalContext?.date_range?.latest || '—';
  const dischargeTime = admissionReview?.discharge_time || '—';
  const referringDoctor = admissionReview?.referring_doctor || '—';
  const roomCategory = admissionReview?.room_category || '—';
  const finalBillAmount = admissionReview?.final_bill_amount || claimAmount || '—';
  const treatmentType = admissionReview?.treatment_type || '—';
  const clinicalRecommendations = admissionReview?.clinical_recommendations || '—';
  const previousConsultation = admissionReview?.previous_consultation || '—';
  const distanceChecking = admissionReview?.distance_checking || '—';
  const modeOfPayment = admissionReview?.mode_of_payment || '—';
  const personalHabits = admissionReview?.personal_habits || '—';
  
  // Diagnoses
  const activeDiagnoses = clinicalContext?.active_diagnoses || [];
  const allDiagnoses = activeDiagnoses.length > 0 ? activeDiagnoses.join(', ') : '—';
  
  // Chief Complaints
  const chiefComplaints = clinicalContext?.primary_complaint || '—';
  
  // Past History
  const pastHistory = clinicalContext?.past_history || [];
  const pastHistoryText = pastHistory.length > 0 ? pastHistory.join('; ') : '—';
  
  // Comorbidities
  const comorbidities = clinicalContext?.comorbidities || [];
  const comorbiditiesText = comorbidities.length > 0 ? comorbidities.join(', ') : '—';
  
  // Medications
  const currentMedications = medicationReview?.current_medications || [];
  const medicationsList = currentMedications.length > 0 ? currentMedications : [];
  
  // Treatments & Procedures
  const proceduresPerformed = treatmentProcedure?.procedures_performed || [];
  const treatmentsPlanned = treatmentProcedure?.treatments_planned || [];
  const complications = treatmentProcedure?.complications || [];
  
  // Investigations
  const investigations = investigationAudit?.investigations_found || [];
  
  // ICD Codes
  const icdCodes = codingCompliance?.icd_codes || [];
  
  // CPT Codes
  const cptCodes = codingCompliance?.cpt_codes || [];
  
  // Discharge Summary
  const dischargeSummary = dischargeOutcome?.discharge_summary || '';
  const keyFindings = dischargeOutcome?.outcomes_assessed?.key_findings || [];
  
  // Hospital Visit Findings
  const hospitalVisitFindings = data?.hospital_visit_findings || {};
  
  // Fraud Risk
  const fraudRiskLevel = fraudScreening?.risk_level || '—';
  const fraudSummary = fraudScreening?.summary || '—';
  const fraudScore = fraudScreening?.risk_score || '—';
  
  // Final Verdicts
  const adequacyVerdict = medicalAdequacy?.final_verdict || '—';
  const sufficiencyVerdict = medicalSufficiency?.final_verdict || '—';
  const adequacyScore = medicalAdequacy?.adequacy_score || 0;
  const sufficiencyScore = medicalSufficiency?.sufficiency_score || 0;
  
  // Missing Elements
  const missingElements = medicalSufficiency?.documentation_completeness?.missing_elements || [];
  
  // Recommendations
  const recommendations = medicalSufficiency?.recommendations || [];
  
  // Executive Summary
  const executiveSummary = medicalSufficiency?.executive_summary || medicalAdequacy?.summary || '—';
  
  // Vital Signs
  const vitalSigns = medicalAdequacy?.vital_signs || [];
  const vitalSignsDisplay = vitalSigns.length > 0 
    ? vitalSigns.map(v => `${v.name}: ${v.value}`).join(', ')
    : '—';
  
  // O/E Findings
  const oeFindings = clinicalContext?.oe_findings || '—';
  
  // Format date function
  const formatDate = (dateStr) => {
    if (!dateStr || dateStr === '—') return '—';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-GB', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };
  
  // Get risk level style
  const getRiskStyle = (level) => {
    if (!level || level === '—') return { color: '#6c757d', bg: '#f8f9fa', icon: '⚪' };
    switch(level?.toUpperCase()) {
      case 'CRITICAL': return { color: '#d32f2f', bg: '#ffebee', icon: '🔴' };
      case 'HIGH': return { color: '#e65100', bg: '#fff3e0', icon: '🟠' };
      case 'MEDIUM': return { color: '#f57c00', bg: '#fff8e1', icon: '🟡' };
      case 'LOW': return { color: '#2e7d32', bg: '#e8f5e9', icon: '🟢' };
      default: return { color: '#6c757d', bg: '#f8f9fa', icon: '⚪' };
    }
  };
  
  const riskStyle = getRiskStyle(fraudRiskLevel);
  
  let pageCounter = 1;
  
  return `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <title>Insurance Claim Verification Report</title>
      <style>
        * { 
          margin: 0; 
          padding: 0; 
          box-sizing: border-box; 
        }
        
        body { 
          font-family: 'Segoe UI', 'Arial', 'Helvetica', sans-serif; 
          background: #e9ecef; 
          padding: 30px 20px; 
          font-size: 10px; 
          line-height: 1.45; 
          color: #212529;
        }
        
        .report-container { 
          max-width: 1100px; 
          margin: 0 auto; 
          background: white;
          box-shadow: 0 10px 40px rgba(0,0,0,0.1);
          border-radius: 4px;
          overflow: hidden;
        }
        
        .report-content {
          padding: 30px 35px;
        }
        
        .page-header {
          text-align: right;
          font-size: 9px;
          color: #6c757d;
          margin-bottom: 10px;
          padding-bottom: 5px;
          border-bottom: 1px solid #dee2e6;
        }
        
        .header { 
          text-align: center; 
          margin-bottom: 25px; 
          padding-bottom: 20px; 
          border-bottom: 3px solid #1a3a5c; 
        }
        
        .header h1 { 
          font-size: 22px; 
          margin-bottom: 6px; 
          color: #1a3a5c;
          letter-spacing: 1px;
        }
        
        .header p { 
          font-size: 11px; 
          color: #6c757d;
          font-weight: 500;
        }
        
        table { 
          width: 100%; 
          border-collapse: collapse; 
          margin-bottom: 20px; 
          font-size: 9.5px;
        }
        
        th, td { 
          border: 1px solid #dee2e6; 
          padding: 8px 10px; 
          vertical-align: top; 
          text-align: left; 
        }
        
        th { 
          background-color: #f8f9fa; 
          font-weight: 700;
          color: #495057;
          font-size: 9.5px;
        }
        
        .section-title { 
          font-size: 14px; 
          font-weight: 800; 
          margin: 25px 0 12px 0; 
          padding-bottom: 5px; 
          border-bottom: 2px solid #1a3a5c;
          color: #1a3a5c;
          letter-spacing: 0.5px;
          page-break-after: avoid;
          break-after: avoid;
        }
        
        /* Force page break control */
        .page-break-before {
          page-break-before: always;
          break-before: page;
        }
        
        /* Keep heading with its content */
        .keep-with-next {
          page-break-after: avoid;
          break-after: avoid;
        }
        
        .footer { 
          margin-top: 30px; 
          padding-top: 15px; 
          border-top: 1px solid #dee2e6; 
          font-size: 8px; 
          text-align: center; 
          color: #6c757d;
        }
        
        .compact-table td, .compact-table th { 
          padding: 8px 10px; 
        }
        
        .findings-table td:first-child { 
          width: 220px; 
          font-weight: 600;
          background-color: #f8f9fa;
        }
        
        .bg-gray { 
          background-color: #f8f9fa; 
          font-weight: 600;
        }
        
        .verdict-badge { 
          display: inline-block; 
          padding: 3px 12px; 
          border-radius: 3px; 
          font-size: 9px; 
          font-weight: 700; 
          letter-spacing: 0.5px;
        }
        
        .verdict-adequate { 
          background: #1a3a5c; 
          color: #fff; 
        }
        
        .verdict-insufficient { 
          background: #dc3545; 
          color: #fff; 
        }
        
        .verdict-sufficient { 
          background: #28a745; 
          color: #fff; 
        }
        
        .risk-badge {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 4px 12px;
          border-radius: 20px;
          font-weight: 700;
          font-size: 10px;
        }
        
        .critical-flag {
          background: #dc3545;
          color: white;
          padding: 8px 12px;
          margin: 15px 0;
          border-left: 4px solid #a71d2a;
          font-size: 9.5px;
          font-weight: 600;
        }
        
        .brief-findings-container {
          border: 1px solid #dee2e6;
          padding: 15px;
          background: #fff;
          margin-bottom: 20px;
        }
        
        /* Prevent content from breaking inside */
        .no-break {
          page-break-inside: avoid;
          break-inside: avoid;
        }
        
        /* List styles */
        .procedure-list, .complication-list, .recommendation-list {
          margin: 0;
          padding-left: 20px;
        }
        
        .procedure-list li, .complication-list li, .recommendation-list li {
          margin-bottom: 4px;
        }
        
        @media print {
          body {
            background: white;
            padding: 0;
          }
          .report-container {
            box-shadow: none;
            border-radius: 0;
          }
          .section-title {
            page-break-after: avoid;
          }
          /* Add to your <style> section */
.section-title {
  font-size: 14px;
  font-weight: 800;
  margin: 25px 0 12px 0;
  padding-bottom: 5px;
  border-bottom: 2px solid #1a3a5c;
  color: #1a3a5c;
  letter-spacing: 0.5px;
  page-break-after: avoid;
  break-after: avoid;
  page-break-inside: avoid;
}

/* Keep tables with their headings */
.table-container {
  page-break-inside: avoid;
  break-inside: avoid;
}

/* Prevent orphaned headings */
h1, h2, h3, h4, .section-title {
  page-break-after: avoid;
  break-after: avoid;
}

/* Keep table rows together */
tr {
  page-break-inside: avoid;
  break-inside: avoid;
}

/* But allow large tables to break gracefully */
table {
  page-break-inside: auto;
  break-inside: auto;
}

/* Keep heading with first few rows of table */
.section-title + table,
.section-title + div > table {
  page-break-before: avoid;
  break-before: avoid;
}
        }
      </style>
    </head>
    <body>
      <div class="report-container">
        <div class="report-content">
        
          <!-- Page 1 -->
          <div class="page-header">${pageCounter} Page</div>
          
          <div class="header">
            <h1>INSURANCE CLAIM VERIFICATION REPORT</h1>
            <p>Insurance Claim Verification Report</p>
          </div>
          
          <!-- Claim Details Table -->
          <table class="compact-table">
            <tr>
              <td style="width: 160px;" class="bg-gray">Claim Number</td>
              <td style="width: 280px;">${claimNumber}</td>
              <td style="width: 160px;" class="bg-gray">Policy Number</td>
              <td>${policyNumber}</td>
            </tr>
            <tr>
              <td class="bg-gray">Policy Product</td>
              <td>${policyProduct}</td>
              <td class="bg-gray">Patient Name</td>
              <td>${patientName}</td>
            </tr>
            <tr>
              <td class="bg-gray">Hospital Name and City</td>
              <td>${hospitalName}${hospitalCity ? ', ' + hospitalCity : ''}</td>
              <td class="bg-gray">Claim Amount</td>
              <td>${claimAmount}</td>
            </tr>
            <tr>
              <td class="bg-gray">Allocation Date</td>
              <td>${allocationDate}</td>
              <td class="bg-gray">Submission Date</td>
              <td>${submissionDate}</td>
            </tr>
            <tr>
              <td class="bg-gray">Investigation TAT</td>
              <td colspan="3">${investigationTAT}</td>
            </tr>
          </table>

          <!-- Hospital Visit Findings -->
          <div class="section-title keep-with-next">HOSPITAL VISIT FINDINGS</div>
          <div class="no-break">
            <table class="findings-table">
              <tr><th style="width: 220px;">Details</th><th style="width: 70px;">Yes/No</th><th>Comments</th></tr>
              <tr><td>Indoor register Verified</td><td>${hospitalVisitFindings.indoor_register_verified || '—'}</td><td>${hospitalVisitFindings.indoor_register_comments || '—'}</td></tr>
              <tr><td>Indoor Case Papers</td><td>${hospitalVisitFindings.indoor_case_papers || '—'}</td><td>${hospitalVisitFindings.indoor_case_papers_comments || '—'}</td></tr>
              <tr><td>Hospital Registration Certificate & Number</td><td>${hospitalVisitFindings.hospital_registration || '—'}</td><td>${hospitalVisitFindings.hospital_registration_comments || '—'}</td></tr>
              <tr><td>Rohini ID</td><td>${hospitalVisitFindings.rohini_id || '—'}</td><td>${hospitalVisitFindings.rohini_id_comments || '—'}</td></tr>
              <tr><td>No of Beds</td><td>${hospitalVisitFindings.no_of_beds || '—'}</td><td>${hospitalVisitFindings.no_of_beds_comments || '—'}</td></tr>
              <tr><td>Network/Non Network hospital</td><td>${hospitalVisitFindings.network_status || '—'}</td><td>${hospitalVisitFindings.network_comments || '—'}</td></tr>
              <tr><td>Infrastructure of hospital</td><td>${hospitalVisitFindings.infrastructure || '—'}</td><td>${hospitalVisitFindings.infrastructure_comments || '—'}</td></tr>
              <tr><td>Name of Hospital Owner & mobile no</td><td>${hospitalVisitFindings.hospital_owner || '—'}</td><td>${hospitalVisitFindings.hospital_owner_comments || '—'}</td></tr>
              <tr><td>Met with Treating Doctor</td><td>${hospitalVisitFindings.met_doctor || '—'}</td><td>${hospitalVisitFindings.met_doctor_comments || '—'}</td></tr>
              <tr><td>Name of Treating Doctor, registration no</td><td colspan="2">${hospitalVisitFindings.treating_doctor_name || '—'}</td></tr>
              <tr><td>Qualification and Mobile no of treating doctor</td><td colspan="2">${hospitalVisitFindings.treating_doctor_qualification || '—'}</td></tr>
            </table>
          </div>

          <!-- Admission Details -->
          <div class="section-title keep-with-next">ADMISSION DETAILS</div>
          <div class="no-break">
            <table>
              <tr><td style="width: 200px;" class="bg-gray">Chief Complaints with Duration</td><td colspan="3">${chiefComplaints}</td></tr>
              <tr><td class="bg-gray">P/H/O any major ailment with Duration</td><td colspan="3">${pastHistoryText}</td></tr>
              <tr><td class="bg-gray">Diagnosis</td><td colspan="3">${allDiagnoses}</td></tr>
              <tr><td class="bg-gray">Treatment - conservative/Surgical</td><td colspan="3">${treatmentType !== '—' ? treatmentType : (treatmentsPlanned.length > 0 ? treatmentsPlanned.join(', ') : '—')}</td></tr>
              <tr><td class="bg-gray">Clinical correlation and further evaluation; Recommendations for patient care</td><td colspan="3">${clinicalRecommendations}</td></tr>
              <tr><td class="bg-gray">Room Category</td><td colspan="3">${roomCategory}</td></tr>
              <tr><td class="bg-gray">Final Bill amount</td><td colspan="3">${finalBillAmount}</td></tr>
              <tr><td class="bg-gray">DOA with time</td><td>${formatDate(admissionDate)}${admissionTime !== '—' ? ', ' + admissionTime : ''}</td>
                  <td class="bg-gray">DOD with time</td><td>${formatDate(dischargeDate)}${dischargeTime !== '—' ? ', ' + dischargeTime : ''}</td></tr>
            </table>
          </div>

          <!-- Brief Findings -->
          <div class="section-title keep-with-next">BRIEF FINDINGS</div>
          <div class="brief-findings-container no-break">
            <div style="margin-bottom: 15px; line-height: 1.5;">${executiveSummary}</div>
            <div style="border-top: 1px dashed #dee2e6; margin: 10px 0; padding-top: 10px;">
              <div><strong style="color: #1a3a5c; min-width: 120px; display: inline-block;">Comorbidities:</strong> <span>${comorbiditiesText}</span></div>
              <div><strong style="color: #1a3a5c; min-width: 120px; display: inline-block;">Vitals:</strong> <span>${vitalSignsDisplay}</span></div>
              <div><strong style="color: #1a3a5c; min-width: 120px; display: inline-block;">O/E:</strong> <span>${oeFindings}</span></div>
              <div><strong style="color: #1a3a5c; min-width: 120px; display: inline-block;">Active Diagnoses:</strong> <span>${allDiagnoses}</span></div>
            </div>
          </div>

          <!-- Investigation Reports - Page Break -->
          
<div style="margin-top: 20px;"></div>

          
          <div class="section-title keep-with-next">INVESTIGATION REPORTS ${investigations.length > 0 ? `(${investigations.length} investigations)` : ''}</div>
          <div class="no-break">
            <table>
              <tr><th>Date</th><th>Investigation</th><th>Type</th><th>Result / Details</th></tr>
              ${investigations.length > 0 ? investigations.map(inv => `
                <tr><td>${inv.date || '—'}</td><td>${inv.name || '—'}</td><td>${inv.type || '—'}</td><td>${inv.details || inv.result || '—'}</td></tr>
              `).join('') : '<tr><td colspan="4" style="text-align: center;">No investigation reports available</td></tr>'}
            </table>
          </div>

          <!-- ICD Codes -->
          ${icdCodes.length > 0 ? `
          <div class="section-title keep-with-next">ICD-10 CODES</div>
          <div class="no-break">
            <table><tr><th>Code</th><th>Diagnosis</th><th>Type</th></tr>
            ${icdCodes.map(code => `<tr><td>${code.icd_code || code.code || '—'}</td><td>${code.diagnosis || '—'}</td><td>${code.is_primary ? 'PRIMARY' : (code.type || 'SECONDARY')}</td></tr>`).join('')}
            </table>
          </div>
          ` : ''}

          <!-- CPT Codes -->
          ${cptCodes.length > 0 ? `
          <div class="section-title keep-with-next">CPT CODES</div>
          <div class="no-break">
            <table><tr><th>CPT Code</th><th>Procedure</th><th>Category</th><th>Confidence</th></tr>
            ${cptCodes.map(code => `<tr><td>${code.cpt_code || code.code || '—'}</td><td>${code.procedure || '—'}</td><td>${code.category || '—'}</td><td>${code.confidence || '—'}${code.confidence ? '%' : ''}</td></tr>`).join('')}
            </table>
          </div>
          ` : ''}

          <!-- Medications Administered -->
          <div class="section-title keep-with-next">MEDICATIONS ADMINISTERED</div>
          <div class="no-break">
            <table>
              <tr><th>Medication Name</th><th>Dosage / Frequency</th><th>Route</th><th>Notes</th></tr>
              ${medicationsList.length > 0 ? medicationsList.map(med => `
                <tr><td>${med.name || '—'}</td><td>${med.dose || med.frequency || 'As prescribed'}</td><td>${med.route || '—'}</td><td>${med.notes || med.contraindications || ''}</td></tr>
              `).join('') : '<tr><td colspan="4" style="text-align: center;">No medications recorded</td></tr>'}
            </table>
          </div>

          <!-- Patient Details - Page Break -->
          <div style="margin-top: 20px;"></div>
          
          <div class="section-title keep-with-next">PATIENT DETAILS</div>
          <div class="no-break">
            <table>
              <tr><td style="width: 200px;" class="bg-gray">Name of Patient</td><td colspan="3">${patientName}</td></tr>
              <tr><td class="bg-gray">Age / Gender</td><td>${patientAge !== '—' ? patientAge + ' Y' : '—'} / ${patientGender}</td><td class="bg-gray">Date of Birth</td><td>${patientDOB}</td></tr>
              <tr><td class="bg-gray">Blood Group</td><td>${patientBloodGroup}</td><td class="bg-gray">Mobile No</td><td>${patientPhone}</td></tr>
              <tr><td class="bg-gray">HMS ID</td><td>${patientHmsId}</td><td class="bg-gray">KYC Details</td><td>${kycDetails}</td></tr>
              <tr><td class="bg-gray">Occupation</td><td colspan="3">${patientOccupation}</td></tr>
              <tr><td class="bg-gray">Address</td><td colspan="3">${patientAddress}</td></tr>
              <tr><td class="bg-gray">Previous consultation Details</td><td colspan="3">${previousConsultation}</td></tr>
              <tr><td class="bg-gray">Referring Doctor</td><td colspan="3">${referringDoctor}</td></tr>
              <tr><td class="bg-gray">Distance Checking</td><td colspan="3">${distanceChecking}</td></tr>
              <tr><td class="bg-gray">Mode of Payment</td><td colspan="3">${modeOfPayment}</td></tr>
              <tr><td class="bg-gray">Personal Habits</td><td colspan="3">${personalHabits}</td></tr>
            </table>
          </div>

          <!-- Procedures Performed -->
          ${proceduresPerformed.length > 0 ? `
          <div class="section-title keep-with-next">PROCEDURES PERFORMED</div>
          <div class="no-break">
            <ul class="procedure-list" style="margin: 0 0 20px 20px;">
              ${proceduresPerformed.map(proc => `<li style="margin-bottom: 4px;">${proc}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          <!-- Complications -->
          ${complications.length > 0 ? `
          <div class="section-title keep-with-next">COMPLICATIONS</div>
          <div class="no-break">
            <ul class="complication-list" style="margin: 0 0 20px 20px;">
              ${complications.map(comp => `<li style="margin-bottom: 4px;">${comp}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          <!-- Discharge Summary -->
          ${dischargeSummary ? `
          <div class="section-title keep-with-next">DISCHARGE SUMMARY</div>
          <div class="no-break">
            <table><tr><td style="padding: 12px;">${dischargeSummary}</td></tr></table>
          </div>
          ` : ''}

          <!-- Key Findings at Discharge -->
          ${keyFindings.length > 0 ? `
          <div class="section-title keep-with-next">KEY FINDINGS AT DISCHARGE</div>
          <div class="no-break">
            <ul style="margin: 0 0 20px 20px;">
              ${keyFindings.map(finding => `<li style="margin-bottom: 4px;">${finding}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          <!-- Workplace Visit Findings - FIXED ALIGNMENT -->
          <div class="section-title keep-with-next">WORKPLACE VISIT FINDINGS</div>
          <div class="no-break">
            <table>
              <tr><td style="width: 200px;" class="bg-gray">Workplace Visit</td><td>${workplaceVisit.status || 'NOT DONE'}</td></tr>
              <tr><td class="bg-gray">Employer Visit Findings</td><td>${employerVisit.findings || 'NOT DONE'}</td></tr>
              <tr><td class="bg-gray">Social Media Findings</td><td>${socialMediaFindings.findings || 'NOT DONE'}</td></tr>
              <tr><td class="bg-gray">Google Map Location Details</td><td>${googleMapDetails.details || 'NOT PROVIDED'}</td></tr>
            </table>
          </div>

          <!-- Pharmacy Visit Findings -->
          <div class="section-title keep-with-next">PHARMACY VISIT FINDINGS</div>
          <div class="no-break">
            <table>
              <tr><td style="width: 200px;" class="bg-gray">Address of Pharmacy</td><td>${pharmacyVisit.address || 'NA'}</td></tr>
              <tr><td class="bg-gray">Drug License No</td><td>${pharmacyVisit.license_no || 'NA'}</td></tr>
              <tr><td class="bg-gray">Inward-Outward Purchase Invoice</td><td>${pharmacyVisit.invoice_details || 'NA'}</td></tr>
              <tr><td class="bg-gray">Bills Verified</td><td>${pharmacyVisit.bills_verified || 'NO'}</td></tr>
            </table>
          </div>

          <!-- Laboratory/Radiologist Visit Findings -->
          <div class="section-title keep-with-next">LABORATORY/RADIOLOGIST VISIT FINDINGS</div>
          <div class="no-break">
            <table>
              <tr><td style="width: 200px;" class="bg-gray">Name of Laboratory/Radiology</td><td>${labRadiologyVisit.name || 'NA'}</td></tr>
              <tr><td class="bg-gray">Address of Laboratory/Radiology</td><td>${labRadiologyVisit.address || 'NA'}</td></tr>
              <tr><td class="bg-gray">Pathologist/Radiologist Name & Mobile No</td><td>${labRadiologyVisit.doctor_name || 'NA'}</td></tr>
              <tr><td class="bg-gray">Pathologist/Radiologist Registration No</td><td>${labRadiologyVisit.registration_no || 'NA'}</td></tr>
              <tr><td class="bg-gray">Association of Pathologist with labs</td><td>${labRadiologyVisit.association || 'NA'}</td></tr>
              <tr><td class="bg-gray">Distance from Laboratory</td><td>${labRadiologyVisit.distance || 'NA'}</td></tr>
              <tr><td class="bg-gray">Reports Verified</td><td>${labRadiologyVisit.reports_verified || '—'}</td></tr>
              <tr><td class="bg-gray">Brief Findings</td><td>${labRadiologyVisit.brief_findings || '—'}</td></tr>
            </table>
          </div>

          <!-- Missing Documentation -->
          ${missingElements.length > 0 ? `
          <div class="section-title keep-with-next">MISSING DOCUMENTATION</div>
          <div class="no-break">
            <table>
              <tr><th>Missing Element</th><th>Impact</th></tr>
              ${missingElements.map(element => `
                <tr><td>${typeof element === 'string' ? element.replace(/_/g, ' ').toUpperCase() : element}</td><td>Required for claim processing</td></tr>
              `).join('')}
            </table>
          </div>
          ` : ''}

          <!-- Recommendations -->
          ${recommendations.length > 0 ? `
          <div class="section-title keep-with-next">RECOMMENDATIONS</div>
          <div class="no-break">
            <ul class="recommendation-list" style="margin: 0 0 20px 20px;">
              ${recommendations.map(rec => `<li style="margin-bottom: 4px;">${rec}</li>`).join('')}
            </ul>
          </div>
          ` : ''}

          <!-- Fraud Risk Assessment -->
          <div class="section-title keep-with-next">FRAUD RISK ASSESSMENT</div>
          <div class="no-break">
            <table>
              <tr><td style="width: 150px;" class="bg-gray">Risk Level</td><td><span class="risk-badge" style="background: ${riskStyle.bg}; color: ${riskStyle.color};">${riskStyle.icon} ${fraudRiskLevel}</span></td></tr>
              ${fraudScore !== '—' ? `<tr><td class="bg-gray">Fraud Risk Score</td><td>${fraudScore} / 100</td></tr>` : ''}
              <tr><td class="bg-gray">Summary</td><td>${fraudSummary}</td></tr>
            </table>
          </div>

          <!-- Conclusion -->
          <div class="section-title keep-with-next">CONCLUSION / RECOMMENDATION</div>
          <div class="no-break">
            <table>
              <tr><td style="padding: 15px;">
                <strong>Medical Adequacy Verdict:</strong> 
                <span class="verdict-badge ${adequacyVerdict === 'Adequate' ? 'verdict-adequate' : 'verdict-insufficient'}">${adequacyVerdict}</span> 
                ${adequacyScore ? `(Score: ${(adequacyScore * 100).toFixed(1)}%)` : ''}<br><br>
                
                <strong>Medical Sufficiency Verdict:</strong> 
                <span class="verdict-badge ${sufficiencyVerdict === 'Sufficient' ? 'verdict-sufficient' : 'verdict-insufficient'}">${sufficiencyVerdict}</span> 
                ${sufficiencyScore ? `(Score: ${(sufficiencyScore * 100).toFixed(1)}%)` : ''}<br><br>
                
                ${(adequacyScore || sufficiencyScore) ? `<strong>Overall Score:</strong> ${(((adequacyScore || 0) + (sufficiencyScore || 0)) / 2 * 100).toFixed(1)}%<br><br>` : ''}
                
                <strong>Evidence Grade:</strong> ${evidenceGrade.grade || '—'}<br>
                <strong>Enclosure/Evidence:</strong> ${evidenceGrade.enclosure || '—'}<br><br>
                
                <strong>Conclusion:</strong><br>
                ${evidenceGrade.conclusion || executiveSummary}<br><br>
                
                ${missingElements.length > 0 ? '<strong>Warning:</strong> Documentation is clinically adequate but insufficient for claim processing — review missing documentation elements before final adjudication.' : ''}
              </td>
            </tr>
          </table>
          </div>

          <!-- Footer -->
          <div class="footer">
            <p>The Investigation Report is being issued without prejudice, which is meant strictly confidential and subject to 
            Terms & Conditions of Insurance Policy under which the subject claim is lodged.</p>
            <p style="margin-top: 12px;"><strong>Authorized Signatory</strong></p>
            <p>_________________________</p>
          </div>

        </div>
      </div>
    </body>
    </html>
  `;
};
  // Score Card Component - Black & White
  const ScoreCard = ({ label, score, subtitle }) => {
    const percentage = (score || 0) * 100;
    // Monochrome: darker for higher scores
    const getScoreColor = () => {
      if (percentage >= 80) return C.black;
      if (percentage >= 60) return C.gray700;
      return C.gray500;
    };

    return (
      <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
            {label}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 20, fontWeight: 600, color: getScoreColor() }) }}>
            {percentage.toFixed(0)}%
          </Typography>
        </Box>
        <Box sx={{ height: 2, background: C.gray400, borderRadius: "1px", overflow: "hidden" }}>
          <Box sx={{ height: "100%", width: `${percentage}%`, background: getScoreColor(), borderRadius: "1px" }} />
        </Box>
        {subtitle && (
          <Typography sx={{ ...os({ fontSize: 10, color: C.gray500, mt: 1 }) }}>{subtitle}</Typography>
        )}
      </Box>
    );
  };

  // Metric Card Component - Black & White
  const MetricCard = ({ title, items, type = 'neutral' }) => {
    // Monochrome border based on type
    const getBorderColor = () => {
      switch(type) {
        case 'success': return C.gray900;
        case 'warning': return C.gray700;
        case 'error': return C.black;
        default: return C.gray500;
      }
    };

    const getItemText = (item) => {
      if (typeof item === 'string') return item;
      if (item === null || item === undefined) return '';
      if (typeof item === 'object') {
        if (item.message) return item.message;
        if (item.description) return item.description;
        if (item.details) return item.details;
        if (item.evidence) return item.evidence;
        if (item.name) return item.name;
        if (item.reason) return item.reason;
        if (item.issue) return item.issue;
        try { return JSON.stringify(item); } catch { return 'Complex object'; }
      }
      return String(item);
    };

    if (!items?.length) return null;

    return (
      <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", borderLeft: `3px solid ${getBorderColor()}`, background: C.white }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.gray900, fontWeight: 600, mb: 1.5 }) }}>{title}</Typography>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
          {items.map((item, idx) => (
            <Box key={idx} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.gray500 }) }}>•</Typography>
              <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.5, flex: 1 })}}
                dangerouslySetInnerHTML={{ __html: getItemText(item).replace(/\n/g, '<br/>') }}
              />
            </Box>
          ))}
        </Box>
      </Box>
    );
  };

  // Section Component
  const Section = ({ title, children, action }) => (
    <Box sx={{ mb: 3 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, pb: 1.5, borderBottom: `1px solid ${C.gray400}` }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.gray900, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em" }) }}>
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  );

  // Grid Component
  const Grid = ({ children, minWidth = 300 }) => (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: `repeat(auto-fit, minmax(${minWidth}px, 1fr))` }, gap: 2 }}>
      {children}
    </Box>
  );

  // Clinical Context Summary
  const renderClinicalContext = () => {
    const context = patientData?.clinical_context;
    if (!context) return null;

    return (
      <Box sx={{ mb: 4, p: 2.5, background: C.gray200, border: `1px solid ${C.gray400}`, borderRadius: "4px" }}>
        <Typography sx={{ ...os({ fontSize: 13, fontWeight: 600, color: C.gray900, mb: 2 }) }}>
          Clinical Context Summary
        </Typography>
        <Grid minWidth={250}>
          <Box>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Primary Complaint</Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>{context.primary_complaint || '—'}</Typography>
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Total Documents</Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>{context.total_documents || 0}</Typography>
          </Box>
          <Box>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Date Range</Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>
              {context.date_range?.earliest} — {context.date_range?.latest}
            </Typography>
          </Box>
        </Grid>
        {context.raw_text_summary && (
          <Box sx={{ mt: 2, pt: 2, borderTop: `1px solid ${C.gray400}` }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Summary</Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.6 }) }}>
              {context.raw_text_summary}
            </Typography>
          </Box>
        )}
      </Box>
    );
  };

  // Render Medical Adequacy
  const renderMedicalAdequacy = () => {
    const data = patientData?.medical_adequacy_results;
    if (!data) return null;

    return (
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3, flexWrap: "wrap", gap: 2 }}>
          <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600 }) }}>
            Medical Adequacy Analysis
          </Typography>
        </Box>

        {/* Patient Summary */}
        {data.patient_summary && (
          <Section title="Patient Summary">
            <Grid>
              {data.patient_summary.chief_complaints?.structured?.length > 0 && (
                <MetricCard title="Chief Complaints" items={data.patient_summary.chief_complaints.structured} type="neutral" />
              )}
              {data.patient_summary.chief_complaints?.narrative && (
                <MetricCard title="Clinical Narrative" items={[data.patient_summary.chief_complaints.narrative]} type="neutral" />
              )}
            </Grid>
          </Section>
        )}

        {/* Past History */}
        {data.past_history?.original?.length > 0 && (
          <Section title="Past History">
            <MetricCard title="Medical History" items={data.past_history.original} type="neutral" />
          </Section>
        )}

        {/* Active Diagnoses */}
        {patientData?.clinical_context?.active_diagnoses?.length > 0 && (
          <Section title="Active Diagnoses">
            <MetricCard title="Diagnoses" items={patientData.clinical_context.active_diagnoses} type="warning" />
          </Section>
        )}

        {/* Vital Signs */}
        {data.vital_signs?.length > 0 && (
          <Section title="Vital Signs">
            <Grid minWidth={150}>
              {data.vital_signs.map((vital, idx) => (
                <Box key={idx} sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.gray200 }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.gray600, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>
                    {safeString(vital.name)}
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 20, color: C.gray900, fontWeight: 600 }) }}>
                    {safeString(vital.value)}
                  </Typography>
                </Box>
              ))}
            </Grid>
          </Section>
        )}

        {/* Medications */}
        {patientData?.clinical_context?.medications?.length > 0 && (
          <Section title="Current Medications">
            <MetricCard title="Medications" items={patientData.clinical_context.medications} type="neutral" />
          </Section>
        )}

        {/* Diagnostic Accuracy */}
      {data.diagnostic_accuracy && (
        <Section title="Diagnostic Accuracy">
          <Grid>
            {/* Strengths */}
            {data.diagnostic_accuracy.strengths?.length > 0 && (
              <MetricCard title="Strengths" items={data.diagnostic_accuracy.strengths} type="success" />
            )}
            
            {/* Issues */}
            {data.diagnostic_accuracy.issues?.length > 0 && (
              <MetricCard title="Issues" items={data.diagnostic_accuracy.issues} type="error" />
            )}
          </Grid>

          {/* Evidence Mapping - Detailed View */}
          {data.diagnostic_accuracy.evidence_mapping && (
            <Box sx={{ mt: 2 }}>
              <Typography sx={{ ...os({ fontSize: 12, fontWeight: 600, color: C.gray900, mb: 1.5, mt: 1 }) }}>
                Evidence Mapping
              </Typography>
              
              {/* Diagnoses Present */}
              {data.diagnostic_accuracy.evidence_mapping.diagnosis_present?.length > 0 && (
                <Box sx={{ mb: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
                    ✓ Diagnoses Documented
                  </Typography>
                  {data.diagnostic_accuracy.evidence_mapping.diagnosis_present.map((dx, idx) => (
                    <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                      • {safeString(dx)}
                    </Typography>
                  ))}
                </Box>
              )}

              {/* Supporting Symptoms */}
              {data.diagnostic_accuracy.evidence_mapping.supporting_symptoms?.length > 0 && (
                <Box sx={{ mb: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
                    📋 Supporting Symptoms
                  </Typography>
                  {data.diagnostic_accuracy.evidence_mapping.supporting_symptoms.map((symptom, idx) => (
                    <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                      • {safeString(symptom)}
                    </Typography>
                  ))}
                </Box>
              )}

              {/* Supporting Vitals */}
              {data.diagnostic_accuracy.evidence_mapping.supporting_vitals?.length > 0 && (
                <Box sx={{ mb: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
                    📊 Supporting Vitals
                  </Typography>
                  {data.diagnostic_accuracy.evidence_mapping.supporting_vitals.map((vital, idx) => (
                    <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                      • {safeString(vital)}
                    </Typography>
                  ))}
                </Box>
              )}

              {/* Treatment Support */}
              {data.diagnostic_accuracy.evidence_mapping.treatment_support?.length > 0 && (
                <Box sx={{ mb: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
                    💊 Treatment Support
                  </Typography>
                  {data.diagnostic_accuracy.evidence_mapping.treatment_support.map((tx, idx) => (
                    <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                      • {safeString(tx)}
                    </Typography>
                  ))}
                </Box>
              )}

              {/* Missing Confirmatory Evidence */}
              {data.diagnostic_accuracy.evidence_mapping.missing_confirmatory_evidence?.length > 0 && (
                <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
                    ⚠ Missing Confirmatory Evidence
                  </Typography>
                  {data.diagnostic_accuracy.evidence_mapping.missing_confirmatory_evidence.map((missing, idx) => (
                    <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                      • {safeString(missing)}
                    </Typography>
                  ))}
                </Box>
              )}
            </Box>
          )}
        </Section>
      )}

        {/* Treatment Alignment */}
        

{data.treatment_alignment && (
  <Section title="Treatment Alignment">
    <Grid>
      {/* Strengths */}
      {data.treatment_alignment.strengths?.length > 0 && (
        <MetricCard title="Strengths" items={data.treatment_alignment.strengths} type="success" />
      )}
      
      {/* Issues */}
      {data.treatment_alignment.issues?.length > 0 && (
        <MetricCard title="Issues" items={data.treatment_alignment.issues} type="error" />
      )}
    </Grid>

    {/* Treatment Mapping - Detailed View */}
    {data.treatment_alignment.treatment_mapping && (
      <Box sx={{ mt: 2 }}>
        <Typography sx={{ ...os({ fontSize: 12, fontWeight: 600, color: C.gray900, mb: 1.5, mt: 1 }) }}>
          Treatment Mapping Details
        </Typography>
        
        {/* Diagnosis to Treatment */}
        {data.treatment_alignment.treatment_mapping.diagnosis_to_treatment?.length > 0 && (
          <Box sx={{ mb: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
              🩺 Diagnosis → Treatment
            </Typography>
            {data.treatment_alignment.treatment_mapping.diagnosis_to_treatment.map((item, idx) => (
              <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                • {safeString(item)}
              </Typography>
            ))}
          </Box>
        )}

        {/* Supportive Treatment */}
        {data.treatment_alignment.treatment_mapping.supportive_treatment?.length > 0 && (
          <Box sx={{ mb: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
              💚 Supportive Treatment
            </Typography>
            {data.treatment_alignment.treatment_mapping.supportive_treatment.map((item, idx) => (
              <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                • {safeString(item)}
              </Typography>
            ))}
          </Box>
        )}

        {/* Comorbidity Management */}
        {data.treatment_alignment.treatment_mapping.comorbidity_management?.length > 0 && (
          <Box sx={{ mb: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
              📋 Comorbidity Management
            </Typography>
            {data.treatment_alignment.treatment_mapping.comorbidity_management.map((item, idx) => (
              <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                • {safeString(item)}
              </Typography>
            ))}
          </Box>
        )}

        {/* Mismatches */}
        {data.treatment_alignment.treatment_mapping.mismatches?.length > 0 && (
          <Box sx={{ mb: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>
              ⚠ Treatment Mismatches
            </Typography>
            {data.treatment_alignment.treatment_mapping.mismatches.map((item, idx) => (
              <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800, mb: 0.5 }) }}>
                • {safeString(item)}
              </Typography>
            ))}
          </Box>
        )}
      </Box>
    )}

    {/* Context Note */}
    {data.treatment_alignment.context_note && (
      <Box sx={{ mt: 2, p: 2, background: C.gray200, borderRadius: "4px" }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>
          <InfoRounded sx={{ fontSize: 12, verticalAlign: "middle", mr: 0.5 }} />
          Note: {data.treatment_alignment.context_note}
        </Typography>
      </Box>
    )}
  </Section>
)}

        {/* Uncertainties */}
        {data.uncertainties?.length > 0 && (
          <Section title="Uncertainties">
            <MetricCard title="Pending Information" items={data.uncertainties} type="warning" />
          </Section>
        )}

        {/* Pending Reports */}
        {patientData?.clinical_context?.pending_reports?.length > 0 && (
          <Section title="Pending Reports">
            <MetricCard title="Reports Awaiting" items={patientData.clinical_context.pending_reports} type="warning" />
          </Section>
        )}

        {/* Recommendations */}
        {data.recommendations?.length > 0 && (
          <Section title="Recommendations">
            <MetricCard title="Suggested Actions" items={data.recommendations} type="neutral" />
          </Section>
        )}

        {/* Clinical Interpretation */}
        {data.clinical_interpretation && (
          <Section title="Clinical Interpretation">
            <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.6 }) }}>
                {data.clinical_interpretation}
              </Typography>
            </Box>
          </Section>
        )}

        {/* Final Verdict */}
        {data.final_verdict && (
          <Box sx={{ mt: 3, p: 3, background: data.final_verdict === 'Adequate' ? C.gray200 : data.final_verdict === 'Inconclusive' ? C.gray200 : C.gray200, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center" }}>
            <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: data.final_verdict === 'Adequate' ? C.gray900 : data.final_verdict === 'Inconclusive' ? C.gray800 : C.black }) }}>
              {data.final_verdict === 'Adequate' ? '✓' : data.final_verdict === 'Inconclusive' ? '⚠' : '✗'} Final Verdict: {safeString(data.final_verdict)}
            </Typography>
          </Box>
        )}

        {/* Metadata */}
        {(data.documents_analyzed || data.analysis_timestamp) && (
          <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${C.gray400}`, display: "flex", justifyContent: "space-between", fontSize: 10, color: C.gray500, flexWrap: "wrap", gap: 1 }}>
            <span>Documents Analyzed: {data.documents_analyzed}</span>
            <span>Analysis Time: {new Date(data.analysis_timestamp).toLocaleString()}</span>
          </Box>
        )}
      </Box>
    );
  };

  // Render Medical Sufficiency
  // Render Medical Sufficiency
// Helper function to render evidence content properly
const renderEvidenceContent = (evidence) => {
  if (!evidence) return null;
  
  // Handle string evidence
  if (typeof evidence === 'string') {
    return (
      <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mt: 0.5, lineHeight: 1.4 }) }}>
        {evidence.substring(0, 300)}{evidence.length > 300 ? '...' : ''}
      </Typography>
    );
  }
  
  // Handle array evidence
  if (Array.isArray(evidence)) {
    if (evidence.length === 0) return null;
    const displayItems = evidence.slice(0, 5);
    return (
      <Box sx={{ mt: 0.5 }}>
        {displayItems.map((item, idx) => (
          <Typography key={idx} sx={{ ...os({ fontSize: 11, color: C.gray600, lineHeight: 1.3 }) }}>
            • {typeof item === 'string' ? item.substring(0, 100) : JSON.stringify(item).substring(0, 100)}
          </Typography>
        ))}
        {evidence.length > 5 && (
          <Typography sx={{ ...os({ fontSize: 10, color: C.gray500, mt: 0.5 }) }}>
            +{evidence.length - 5} more
          </Typography>
        )}
      </Box>
    );
  }
  
  // Handle object evidence (like vitals or investigations)
  if (typeof evidence === 'object' && evidence !== null) {
    // Special handling for vitals
    if (evidence.RespiratoryRate || evidence.Temperature || evidence.Systolic_BP || evidence.Pulse_Rate) {
      return (
        <Box sx={{ mt: 0.5, display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 0.5 }}>
          {Object.entries(evidence).map(([key, value]) => (
            <Box key={key} sx={{ display: "flex", justifyContent: "space-between", borderBottom: `1px dotted ${C.gray400}`, py: 0.25 }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.gray600 }) }}>{key}:</Typography>
              <Typography sx={{ ...os({ fontSize: 10, color: C.gray800, fontWeight: 500 }) }}>{String(value)}</Typography>
            </Box>
          ))}
        </Box>
      );
    }
    
    // Special handling for investigations
    if (evidence.labs_present !== undefined || evidence.radiology_present !== undefined || evidence.pending_reports) {
      return (
        <Box sx={{ mt: 0.5 }}>
          <Box sx={{ display: "flex", gap: 2, mb: 0.5 }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.gray600 }) }}>
              Labs: {evidence.labs_present ? '✓ Present' : '✗ Missing'}
            </Typography>
            <Typography sx={{ ...os({ fontSize: 10, color: C.gray600 }) }}>
              Radiology: {evidence.radiology_present ? '✓ Present' : '✗ Missing'}
            </Typography>
          </Box>
          {evidence.pending_reports?.length > 0 && (
            <Box sx={{ mt: 0.5 }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.gray700, fontWeight: 500 }) }}>
                Pending Reports:
              </Typography>
              {evidence.pending_reports.map((report, idx) => (
                <Typography key={idx} sx={{ ...os({ fontSize: 10, color: C.gray600, ml: 1 }) }}>
                  • {report}
                </Typography>
              ))}
            </Box>
          )}
        </Box>
      );
    }
    
    // Generic object handling
    const entries = Object.entries(evidence).slice(0, 5);
    if (entries.length === 0) return null;
    return (
      <Box sx={{ mt: 0.5 }}>
        {entries.map(([key, value]) => (
          <Typography key={key} sx={{ ...os({ fontSize: 10, color: C.gray600, lineHeight: 1.3 }) }}>
            {key}: {typeof value === 'string' ? value.substring(0, 50) : String(value).substring(0, 50)}
          </Typography>
        ))}
        {Object.keys(evidence).length > 5 && (
          <Typography sx={{ ...os({ fontSize: 9, color: C.gray500, mt: 0.5 }) }}>
            +{Object.keys(evidence).length - 5} more fields
          </Typography>
        )}
      </Box>
    );
  }
  
  return null;
};

// Render Medical Sufficiency
const renderMedicalSufficiency = () => {
  const data = patientData?.medical_sufficiency_results;
  if (!data) return null;

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 3, flexWrap: "wrap", gap: 2 }}>
        <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600 }) }}>
          Medical Sufficiency Analysis
        </Typography>
        {/* {data.sufficiency_score !== undefined && (
          <Chip 
            label={`Sufficiency Score: ${(data.sufficiency_score * 100).toFixed(0)}%`}
            sx={{ background: C.gray900, color: C.white, fontSize: 12 }}
          />
        )} */}
      </Box>

      {/* Documentation Completeness - Detailed View */}
      {data.documentation_completeness && (
        <Section title="Documentation Completeness">
          {/* Score */}
          {data.documentation_completeness.score !== undefined && (
            <Box sx={{ mb: 2, display: "flex", alignItems: "center", gap: 2 }}>
              <Typography sx={{ ...os({ fontSize: 12, color: C.gray600 }) }}>Completeness Score:</Typography>
              <Chip 
                label={`${(data.documentation_completeness.score * 100).toFixed(0)}%`}
                size="small"
                sx={{ background: C.gray700, color: C.white, fontSize: 11 }}
              />
            </Box>
          )}

          <Grid>
            {/* Present Elements with Evidence */}
            {data.documentation_completeness.present_elements?.length > 0 && (
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white, overflow: "auto" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, pb: 1, borderBottom: `1px solid ${C.gray400}` }}>
                  <CheckCircleRounded sx={{ fontSize: 18, color: C.gray900 }} />
                  <Typography sx={{ ...os({ fontSize: 12, fontWeight: 600, color: C.gray900 }) }}>
                    Present Elements ({data.documentation_completeness.present_elements.length})
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                  {data.documentation_completeness.present_elements.map((element, idx) => {
                    const evidence = data.documentation_completeness.present_elements_with_evidence?.[element];
                    return (
                      <Box key={idx} sx={{ borderLeft: `2px solid ${C.gray400}`, pl: 1.5 }}>
                        <Typography sx={{ ...os({ fontSize: 13, fontWeight: 600, color: C.gray900 }) }}>
                          {element.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                        </Typography>
                        {renderEvidenceContent(evidence)}
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            )}

            {/* Missing Elements */}
            {data.documentation_completeness.missing_elements?.length > 0 && (
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, pb: 1, borderBottom: `1px solid ${C.gray400}` }}>
                  <WarningAmberRounded sx={{ fontSize: 18, color: C.gray800 }} />
                  <Typography sx={{ ...os({ fontSize: 12, fontWeight: 600, color: C.gray900 }) }}>
                    Missing Elements ({data.documentation_completeness.missing_elements.length})
                  </Typography>
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  {data.documentation_completeness.missing_elements.map((element, idx) => (
                    <Box key={idx} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                      <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>○</Typography>
                      <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>
                        {element.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              </Box>
            )}
          </Grid>

          {/* Detailed Check Table */}
          {/* {data.documentation_completeness.detailed_check && (
            <Box sx={{ mt: 2, p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
              <Typography sx={{ ...os({ fontSize: 11, fontWeight: 600, color: C.gray900, mb: 1 }) }}>
                Detailed Element Check
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 1 }}>
                {Object.entries(data.documentation_completeness.detailed_check).map(([key, value]) => (
                  <Box key={key} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", p: 0.5 }}>
                    <Typography sx={{ ...os({ fontSize: 11, color: C.gray700 }) }}>
                      {key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}:
                    </Typography>
                    <Chip 
                      label={value} 
                      size="small" 
                      sx={{ 
                        fontSize: 9, 
                        background: value === 'PRESENT' ? C.gray900 : C.gray700,
                        color: C.white,
                        height: 20
                      }} 
                    />
                  </Box>
                ))}
              </Box>
            </Box>
          )} */}

          {/* Impact Statement */}
          {data.documentation_completeness.impact && (
            <Box sx={{ mt: 2, p: 2, background: C.gray200, borderRadius: "4px", borderLeft: `3px solid ${C.gray700}` }}>
              <Typography sx={{ ...os({ fontSize: 12, color: C.gray600 }) }}>
                <InfoRounded sx={{ fontSize: 12, verticalAlign: "middle", mr: 0.5 }} />
                Impact: {data.documentation_completeness.impact}
              </Typography>
            </Box>
          )}
        </Section>
      )}

      {/* Evidence Sufficiency */}
      {data.evidence_sufficiency && (
        <Section title="Evidence Sufficiency">
          <Grid>
            {data.evidence_sufficiency.data_sources?.length > 0 && (
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 1 }) }}>Data Sources</Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {data.evidence_sufficiency.data_sources.map((source, idx) => (
                    <Chip key={idx} label={source} size="small" sx={{ fontSize: 10, background: C.gray200 }} />
                  ))}
                </Box>
              </Box>
            )}
            {data.evidence_sufficiency.pending_reports_in_progress?.length > 0 && (
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 1 }) }}>Pending Reports</Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  {data.evidence_sufficiency.pending_reports_in_progress.map((report, idx) => (
                    <Typography key={idx} sx={{ ...os({ fontSize: 12, color: C.gray800 }) }}>
                      • {report}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </Grid>
          {data.evidence_sufficiency.score !== undefined && (
            <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
              <Chip 
                label={`Evidence Score: ${(data.evidence_sufficiency.score * 100).toFixed(0)}%`}
                size="small"
                sx={{ background: C.gray700, color: C.white, fontSize: 10 }}
              />
            </Box>
          )}
        </Section>
      )}

      {/* Critical Gaps */}
      {data.critical_gaps?.length > 0 && (
        <Section title="Critical Gaps">
          <MetricCard title="Gaps Identified" items={data.critical_gaps} type="error" />
        </Section>
      )}

      {/* Uncertainties & Gaps */}
      {data.uncertainties_and_gaps?.length > 0 && (
        <Section title="Uncertainties & Gaps">
          <MetricCard title="Areas Needing Review" items={data.uncertainties_and_gaps} type="warning" />
        </Section>
      )}

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <Section title="Recommendations">
          <MetricCard title="Suggested Actions" items={data.recommendations} type="neutral" />
        </Section>
      )}

      {/* Executive Summary */}
      {data.executive_summary && (
        <Section title="Executive Summary">
          <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.6 }) }}>
              {data.executive_summary}
            </Typography>
          </Box>
        </Section>
      )}

      {/* Final Verdict */}
      {data.final_verdict && (
        <Box sx={{ mt: 3, p: 3, background: C.gray200, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: data.final_verdict === 'Sufficient' ? C.gray900 : C.black }) }}>
            {data.final_verdict === 'Sufficient' ? '✓' : '✗'} Final Verdict: {safeString(data.final_verdict)}
          </Typography>
          {data.confidence !== undefined && (
            <Typography sx={{ ...os({ fontSize: 10, color: C.gray500, mt: 0.5 }) }}>
              Confidence: {(data.confidence * 100).toFixed(0)}%
            </Typography>
          )}
        </Box>
      )}

      {/* Metadata */}
      {(data.documents_analyzed || data.analysis_timestamp) && (
        <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${C.gray400}`, display: "flex", justifyContent: "space-between", fontSize: 10, color: C.gray500, flexWrap: "wrap", gap: 1 }}>
          <span>Documents Analyzed: {data.documents_analyzed}</span>
          <span>Analysis Time: {new Date(data.analysis_timestamp).toLocaleString()}</span>
        </Box>
      )}
    </Box>
  );
};

  // Render Clinical Derivation
  const renderClinicalDerivation = () => {
    const data = patientData?.clinical_derivation_results;
    if (!data) return null;

    return (
      <Box>
        <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
          Clinical Derivation
        </Typography>

        {/* TNM Classification */}
        {data.tnm_classification && (
          <Section title="TNM Classification">
            <Grid minWidth={150}>
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>T Category</Typography>
                <Typography sx={{ ...os({ fontSize: 20, fontWeight: 600, color: C.gray900 }) }}>{data.tnm_classification.t_category || '—'}</Typography>
              </Box>
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>N Category</Typography>
                <Typography sx={{ ...os({ fontSize: 20, fontWeight: 600, color: C.gray900 }) }}>{data.tnm_classification.n_category || '—'}</Typography>
              </Box>
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>M Category</Typography>
                <Typography sx={{ ...os({ fontSize: 20, fontWeight: 600, color: C.gray900 }) }}>{data.tnm_classification.m_category || '—'}</Typography>
              </Box>
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Stage Group</Typography>
                <Typography sx={{ ...os({ fontSize: 20, fontWeight: 600, color: C.gray900 }) }}>{data.tnm_classification.stage_group || '—'}</Typography>
              </Box>
            </Grid>
          </Section>
        )}

        {/* ICD Codes */}
        {data.icd_codes?.length > 0 && data.icd_codes[0]?.code && (
          <Section title="ICD Codes">
            {data.icd_codes.map((code, idx) => (
              <Box key={idx} sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", mb: 1, background: C.white }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>{code.code || '—'}</Typography>
                  {code.is_primary && <Chip label="Primary" size="small" sx={{ background: C.black, color: C.white, fontSize: 10 }} />}
                </Box>
                <Typography sx={{ ...os({ fontSize: 12, color: C.gray600, mt: 0.5 }) }}>{code.description || 'No description'}</Typography>
              </Box>
            ))}
          </Section>
        )}

        {/* Summary */}
        {data.summary && (
          <Section title="Summary">
            <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.6 }) }}>
                {data.summary}
              </Typography>
            </Box>
          </Section>
        )}

        {/* Metadata */}
        {data.derivation_timestamp && (
          <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${C.gray400}`, fontSize: 10, color: C.gray500 }}>
            <span>Analysis Time: {new Date(data.derivation_timestamp).toLocaleString()}</span>
          </Box>
        )}
      </Box>
    );
  };

  // Render Patient & Policy Engine
  const renderPatientPolicy = () => {
    const data = patientData?.engine_specific_results?.['Patient & Policy Engine'];
    if (!data) return null;

    return (
      <Box>
        <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
          Patient & Policy Information
        </Typography>

        {/* Patient Demographics */}
        {data.patient_demographics && (
          <Section title="Patient Demographics">
            <Grid>
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 1 }) }}>Basic Information</Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Typography><strong>Name:</strong> {safeString(data.patient_demographics.name)}</Typography>
                  <Typography><strong>HMS ID:</strong> {safeString(data.patient_demographics.hms_id)}</Typography>
                  <Typography><strong>Age:</strong> {data.patient_demographics.age} years</Typography>
                  <Typography><strong>Gender:</strong> {safeString(data.patient_demographics.gender)}</Typography>
                  <Typography><strong>Blood Group:</strong> {safeString(data.patient_demographics.blood_group)}</Typography>
                  <Typography><strong>DOB:</strong> {safeString(data.patient_demographics.date_of_birth)}</Typography>
                  <Typography><strong>Phone:</strong> {safeString(data.patient_demographics.phone_number)}</Typography>
                  <Typography><strong>Email:</strong> {safeString(data.patient_demographics.email)}</Typography>
                </Box>
              </Box>
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 1 }) }}>Insurance Information</Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Typography><strong>Insurer:</strong> {data.policy_details?.insurance_info?.insurer_name || '—'}</Typography>
                  <Typography><strong>Policy Number:</strong> {data.policy_details?.insurance_info?.policy_number || '—'}</Typography>
                  <Typography><strong>Plan Name:</strong> {data.policy_details?.insurance_info?.plan_name || '—'}</Typography>
                  <Typography><strong>Coverage Type:</strong> {data.policy_details?.insurance_info?.coverage_type || '—'}</Typography>
                </Box>
              </Box>
            </Grid>
          </Section>
        )}

        {/* Flags */}
        {data.flags?.length > 0 && (
          <Section title="Alerts & Flags">
            {data.flags.map((flag, idx) => (
              <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${C.gray700}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
                <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                  <WarningAmberRounded sx={{ fontSize: 16, color: C.gray700 }} />
                  <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>{safeString(flag.message || flag)}</Typography>
                </Box>
              </Box>
            ))}
          </Section>
        )}
      </Box>
    );
  };

  // Render Clinical Justification
  const renderClinicalJustification = () => {
    const data = patientData?.engine_specific_results?.['Clinical Justification Engine'];
    if (!data) return null;

    return (
      <Box>
        <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
          Clinical Justification Analysis
        </Typography>

        {/* Primary Diagnosis */}
        {data.primary_diagnosis && (
          <Section title="Primary Diagnosis">
            <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
              <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>{safeString(data.primary_diagnosis)}</Typography>
            </Box>
          </Section>
        )}

        {/* Diagnosis Justification */}
        {data.diagnosis_justification?.length > 0 && (
          <Section title="Diagnosis Justification">
            <MetricCard title="Supporting Evidence" items={data.diagnosis_justification} type="success" />
          </Section>
        )}

        {/* Treatment Justification */}
        {data.treatment_justification?.length > 0 && (
          <Section title="Treatment Justification">
            <MetricCard title="Clinical Rationale" items={data.treatment_justification} type="neutral" />
          </Section>
        )}

        {/* Supporting Evidence */}
        {data.supporting_evidence?.length > 0 && (
          <Section title="Supporting Evidence">
            <MetricCard title="Evidence" items={data.supporting_evidence} type="neutral" />
          </Section>
        )}

        {/* Flags */}
        {data.flags?.length > 0 && (
          <Section title="Flags & Alerts">
            {data.flags.map((flag, idx) => (
              <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${C.gray700}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
                <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                  <WarningAmberRounded sx={{ fontSize: 16, color: C.gray700 }} />
                  <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>{safeString(flag)}</Typography>
                </Box>
              </Box>
            ))}
          </Section>
        )}
      </Box>
    );
  };

  // Render Investigation Audit
  const renderInvestigationAudit = () => {
  const data = patientData?.engine_specific_results?.['Investigation Audit Engine'];
  if (!data) return null;
  
  const displayedInvestigations = showAllInvestigations 
    ? data.investigations_found 
    : data.investigations_found?.slice(0, 5);
  const hasMoreInvestigations = data.investigations_found?.length > 5;

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Investigation Audit
      </Typography>

      {/* Summary Stats */}
      <Grid minWidth={150}>
        <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Total Investigations</Typography>
          <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray900 }) }}>{data.investigation_count || 0}</Typography>
        </Box>
        <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Completed</Typography>
          <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray900 }) }}>{data.investigations_completed?.length || 0}</Typography>
        </Box>
      </Grid>

      {/* Investigations List */}
      {data.investigations_found?.length > 0 && (
        <Section title={`Investigations (${data.investigations_found.length})`}>
          {displayedInvestigations.map((inv, idx) => (
            <Box key={idx} sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", mb: 1.5, background: C.white }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 1, mb: 1 }}>
                <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>{safeString(inv.name)}</Typography>
                <Chip 
                  label={inv.status || 'completed'} 
                  size="small" 
                  sx={{ 
                    background: C.gray700, 
                    color: C.white, 
                    fontSize: 10 
                  }} 
                />
              </Box>
              <Typography sx={{ ...os({ fontSize: 12, color: C.gray600 }) }}>Date: {inv.date || '—'}</Typography>
              {inv.details && (
                <Typography sx={{ ...os({ fontSize: 12, color: C.gray800, mt: 1, p: 1, background: C.gray200, borderRadius: "4px" }) }}>
                  {safeString(inv.details)}
                </Typography>
              )}
            </Box>
          ))}
          
          {/* Show All / Show Less Button */}
          {hasMoreInvestigations && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Button 
                onClick={() => setShowAllInvestigations(!showAllInvestigations)}
                sx={{ 
                  ...os({ fontSize: 12, textTransform: "none" }), 
                  color: C.gray900,
                  '&:hover': { background: C.gray400 }
                }}
              >
                {showAllInvestigations ? 'Show Less' : `Show All ${data.investigations_found.length} Investigations`}
              </Button>
            </Box>
          )}
        </Section>
      )}
    </Box>
  );
};
  // Render Medication Review
const renderMedicationReview = () => {
  const data = patientData?.engine_specific_results?.['Medication Review Engine'];
  if (!data) return null;

  const displayedMedications = showAllMedications 
    ? data.current_medications 
    : data.current_medications.slice(0, 10);
  const hasMoreMedications = data.current_medications.length > 10;

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Medication Review
      </Typography>

      {/* Current Medications */}
      {data.current_medications?.length > 0 && (
        <Section title={`Current Medications (${data.current_medications.length})`}>
          <Grid>
            {displayedMedications.map((med, idx) => (
              <Box key={idx} sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>{safeString(med.name)}</Typography>
                {med.dose && <Typography sx={{ ...os({ fontSize: 12, color: C.gray600 }) }}>Dose: {safeString(med.dose)}</Typography>}
                {med.frequency && <Typography sx={{ ...os({ fontSize: 12, color: C.gray600 }) }}>Frequency: {safeString(med.frequency)}</Typography>}
                {med.route && <Typography sx={{ ...os({ fontSize: 12, color: C.gray600 }) }}>Route: {safeString(med.route)}</Typography>}
              </Box>
            ))}
          </Grid>
          {hasMoreMedications && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Button 
                onClick={() => setShowAllMedications(!showAllMedications)}
                sx={{ ...os({ fontSize: 12, textTransform: "none" }), color: C.gray900 }}
              >
                {showAllMedications ? 'Show Less' : `Show All ${data.current_medications.length} Medications`}
              </Button>
            </Box>
          )}
        </Section>
      )}

      {/* Drug Interactions */}
      {data.drug_interactions?.length > 0 && (
        <Section title="Drug Interactions">
          <MetricCard title="Interactions" items={data.drug_interactions} type="warning" />
        </Section>
      )}

      {/* Contraindications */}
      {data.contraindications?.length > 0 && (
        <Section title="Contraindications">
          <MetricCard title="Contraindications" items={data.contraindications} type="error" />
        </Section>
      )}

      {/* Flags */}
      {data.flags?.length > 0 && (
        <Section title="Critical Alerts">
          {data.flags.filter(f => f.type === 'critical').map((flag, idx) => (
            <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${C.black}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <ErrorRounded sx={{ fontSize: 16, color: C.black }} />
                <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>{safeString(flag.message || flag)}</Typography>
              </Box>
            </Box>
          ))}
        </Section>
      )}
    </Box>
  );
};
  // ==================== RENDER FUNCTIONS FOR ALL ENGINES ====================

// 1. Render Medical Adequacy (already in your code)
// 2. Render Medical Sufficiency (already in your code)
// 3. Render Clinical Derivation (already in your code)

// 4. Render Patient & Policy Engine (already in your code)
// 5. Render Clinical Justification (already in your code)

// 6. Render Admission Review Engine
const renderAdmissionReview = () => {
  const data = patientData?.engine_specific_results?.['Admission Review Engine'];
  if (!data) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Not specified';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const getAdmissionTypeIcon = (type) => {
    const types = {
      'inpatient': '🏥',
      'outpatient': '🚶',
      'emergency': '🚑',
      'unknown': '❓'
    };
    return types[type?.toLowerCase()] || '📋';
  };

  const getAdmissionTypeLabel = (type) => {
    if (!type || type === 'unknown') return 'Unknown';
    return type.charAt(0).toUpperCase() + type.slice(1);
  };

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Admission Review Analysis
      </Typography>

      {/* Admission Header */}
      <Box sx={{ 
        mb: 3, 
        p: 2.5, 
        background: C.gray200, 
        border: `1px solid ${C.gray400}`, 
        borderRadius: "4px",
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap"
      }}>
      </Box>

      {/* Key Information Grid */}
      <Section title="Admission Details">
        <Grid minWidth={250}>
          <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Referring Doctor</Typography>
            <Typography sx={{ ...os({ fontSize: 14, fontWeight: 500, color: C.gray900 }) }}>
              {data.referring_doctor || '—'}
            </Typography>
          </Box>
          <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Admission Reason</Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.5 }) }}>
              {data.admission_reason || '—'}
            </Typography>
          </Box>
          {data.admission_date && (
            <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Admission Date</Typography>
              <Typography sx={{ ...os({ fontSize: 14, fontWeight: 500, color: C.gray900 }) }}>
                {formatDate(data.admission_date)}
              </Typography>
            </Box>
          )}
          {data.discharge_date && (
            <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Discharge Date</Typography>
              <Typography sx={{ ...os({ fontSize: 14, fontWeight: 500, color: C.gray900 }) }}>
                {formatDate(data.discharge_date)}
              </Typography>
            </Box>
          )}
        </Grid>
      </Section>

      {/* Appropriateness Score */}
      {/* {data.admission_appropriateness_score !== undefined && data.admission_appropriateness_score > 0 && (
        <ScoreCard label="Admission Appropriateness" score={data.admission_appropriateness_score} />
      )} */}

      {/* Length of Stay Projection */}
      {data.length_of_stay_projection && (
        <Section title="Length of Stay">
          <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>
              {data.length_of_stay_projection}
            </Typography>
          </Box>
        </Section>
      )}

      {/* Admission Criteria Assessment */}
      <Section title="Admission Criteria Assessment">
        <Grid>
          {/* Criteria Met */}
          <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, pb: 1, borderBottom: `1px solid ${C.gray400}` }}>
              <CheckCircleRounded sx={{ fontSize: 18, color: C.gray900 }} />
              <Typography sx={{ ...os({ fontSize: 12, fontWeight: 600, color: C.gray900 }) }}>
                Criteria Met
              </Typography>
              <Chip 
                label={data.admission_criteria_met?.length || 0} 
                size="small" 
                sx={{ background: C.gray900, color: C.white, fontSize: 10, height: 20 }} 
              />
            </Box>
            {data.admission_criteria_met?.length > 0 ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {data.admission_criteria_met.map((criterion, idx) => (
                  <Box key={idx} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.gray900 }) }}>✓</Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.gray800 }) }}>{safeString(criterion)}</Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography sx={{ ...os({ fontSize: 12, color: C.gray600, fontStyle: "italic" }) }}>
                No criteria met
              </Typography>
            )}
          </Box>

          {/* Criteria Missing */}
          <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1.5, pb: 1, borderBottom: `1px solid ${C.gray400}` }}>
              <WarningAmberRounded sx={{ fontSize: 18, color: C.gray800 }} />
              <Typography sx={{ ...os({ fontSize: 12, fontWeight: 600, color: C.gray900 }) }}>
                Criteria Missing
              </Typography>
              <Chip 
                label={data.admission_criteria_missing?.length || 0} 
                size="small" 
                sx={{ background: C.gray800, color: C.white, fontSize: 10, height: 20 }} 
              />
            </Box>
            {data.admission_criteria_missing?.length > 0 ? (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {data.admission_criteria_missing.map((criterion, idx) => (
                  <Box key={idx} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>○</Typography>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.gray800 }) }}>{safeString(criterion)}</Typography>
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography sx={{ ...os({ fontSize: 12, color: C.gray600, fontStyle: "italic" }) }}>
                No missing criteria
              </Typography>
            )}
          </Box>
        </Grid>
      </Section>

      {/* Flags */}
      {data.flags?.length > 0 && (
        <Section title="Flags & Alerts">
          {data.flags.map((flag, idx) => (
            <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${C.gray700}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <InfoRounded sx={{ fontSize: 16, color: C.gray700 }} />
                <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>
                  {safeString(flag.message || flag)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Section>
      )}
    </Box>
  );
};

// 7. Render Investigation Audit (already in your code)

// 8. Render Treatment & Procedure Engine
const renderTreatmentProcedure = () => {
  const data = patientData?.engine_specific_results?.['Treatment & Procedure Engine'];
  if (!data) return null;

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Treatment & Procedure Analysis
      </Typography>

      {/* Stats Grid */}
      <Grid minWidth={150}>
        <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Procedures Performed</Typography>
          <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray900 }) }}>{data.procedures_performed?.length || 0}</Typography>
        </Box>
        <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Treatments Planned</Typography>
          <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray900 }) }}>{data.treatments_planned?.length || 0}</Typography>
        </Box>
        {data.treatment_adherence && (
          <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Documentation Adherence</Typography>
            <Typography sx={{ ...os({ fontSize: 20, fontWeight: 600, color: C.gray900 }) }}>
              {data.treatment_adherence.procedures_documented || 0} / {data.treatment_adherence.treatments_planned || 0}
            </Typography>
          </Box>
        )}
      </Grid>

      {/* Procedures Performed */}
      {data.procedures_performed?.length > 0 && (
        <Section title="Procedures Performed">
          {data.procedures_performed.map((procedure, idx) => (
            <Box key={idx} sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", mb: 1.5, background: C.white }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <MedicalServicesRounded sx={{ fontSize: 18, color: C.gray600 }} />
                <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>
                  {safeString(procedure)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Section>
      )}

      {/* Treatments Planned */}
      {data.treatments_planned?.length > 0 && (
        <Section title="Treatments Planned">
          {data.treatments_planned.map((treatment, idx) => (
            <Box key={idx} sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", mb: 1.5, background: C.white }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                <MedicationRounded sx={{ fontSize: 18, color: C.gray600 }} />
                <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>
                  {safeString(treatment)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Section>
      )}

      {/* Complications */}
      {data.complications?.length > 0 && (
        <Section title="Complications">
          <MetricCard title="Complications" items={data.complications} type="error" />
        </Section>
      )}

      {/* Flags */}
      {data.flags?.length > 0 && (
        <Section title="Information">
          {data.flags.map((flag, idx) => (
            <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${C.gray700}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <InfoRounded sx={{ fontSize: 16, color: C.gray700 }} />
                <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>
                  {safeString(flag.message || flag)}
                </Typography>
              </Box>
            </Box>
          ))}
        </Section>
      )}
    </Box>
  );
};

// 9. Render Medication Review (already in your code)

// 10. Render Documentation Audit Engine
const renderDocumentationAudit = () => {
  const data = patientData?.engine_specific_results?.['Documentation Audit Engine'];
  if (!data) return null;

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Documentation Audit
      </Typography>

      {/* Stats */}
      <Box sx={{ mb: 3, p: 2, background: C.gray200, border: `1px solid ${C.gray400}`, borderRadius: "4px", display: "inline-block" }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Documents Analyzed</Typography>
        <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray900 }) }}>{data.documents_analyzed || 0}</Typography>
      </Box>

      {/* Document Analysis List */}
      {data.document_analysis?.length > 0 && (
        <Section title="Document Analysis">
          {data.document_analysis.map((doc, idx) => {
            const completenessScore = ((doc.sections_present?.length || 0) / 
              ((doc.sections_present?.length || 0) + (doc.sections_missing?.length || 0)) * 100).toFixed(0);
            
            return (
              <Box key={idx} sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", mb: 2, background: C.white }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2, flexWrap: "wrap", gap: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>
                    Document: {doc.document_id?.substring(0, 12)}...
                  </Typography>
                </Box>

                {/* Sections Present */}
                {doc.sections_present?.length > 0 && (
                  <Box sx={{ mb: 2 }}>
                    <Typography sx={{ ...os({ fontSize: 11, color: C.gray800, mb: 0.5 }) }}>✓ Present Sections</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {doc.sections_present.map((section, i) => (
                        <Chip key={i} label={safeString(section)} size="small" sx={{ fontSize: 10, background: C.gray200 }} />
                      ))}
                    </Box>
                  </Box>
                )}

                {/* Sections Missing */}
                {doc.sections_missing?.length > 0 && (
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 11, color: C.gray700, mb: 0.5 }) }}>○ Missing Sections</Typography>
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                      {doc.sections_missing.map((section, i) => (
                        <Chip key={i} label={safeString(section)} size="small" sx={{ fontSize: 10, background: C.gray200, color: C.gray800 }} />
                      ))}
                    </Box>
                  </Box>
                )}
              </Box>
            );
          })}
        </Section>
      )}
    </Box>
  );
};

// 11. Render Billing Audit Engine
const renderBillingAudit = () => {
  const data = patientData?.engine_specific_results?.['Billing Audit Engine'];
  if (!data) return null;

  const displayedBillableItems = showAllBillableItems 
    ? data.billable_items 
    : data.billable_items?.slice(0, 15);
  const hasMoreBillableItems = data.billable_items?.length > 15;

  const getItemTypeIcon = (type) => {
    const icons = {
      'consultation': <MedicalServicesRounded sx={{ fontSize: 16 }} />,
      'laboratory': <ScienceRounded sx={{ fontSize: 16 }} />,
      'imaging': <BiotechRounded sx={{ fontSize: 16 }} />,
      'medication': <MedicationRounded sx={{ fontSize: 16 }} />,
      'procedure': <MedicalServicesRounded sx={{ fontSize: 16 }} />,
      'therapy': <LocalHospitalRounded sx={{ fontSize: 16 }} />
    };
    return icons[type?.toLowerCase()] || <DescriptionRounded sx={{ fontSize: 16 }} />;
  };

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Billing Audit Analysis
      </Typography>

      {/* Summary Stats */}
      {data.summary && (
        <Grid minWidth={150}>
          <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Total Billable Items</Typography>
            <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray900 }) }}>
              {data.summary.total_billable_items || data.billable_items?.length || 0}
            </Typography>
          </Box>
          {data.unbilled_items?.length > 0 && (
            <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Unbilled Items</Typography>
              <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray800 }) }}>{data.unbilled_items.length}</Typography>
            </Box>
          )}
          {data.potential_denials?.length > 0 && (
            <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>Potential Denials</Typography>
              <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.black }) }}>{data.potential_denials.length}</Typography>
            </Box>
          )}
        </Grid>
      )}

      {/* Billable Items */}
      {data.billable_items?.length > 0 && (
        <Section title={`Billable Items (${data.billable_items.length})`}>
          <Grid>
            {displayedBillableItems.map((item, idx) => (
              <Box key={idx} sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                  {getItemTypeIcon(item.type)}
                  <Typography sx={{ ...os({ fontSize: 13, fontWeight: 600, color: C.gray900 }) }}>
                    {safeString(item.item)}
                  </Typography>
                  <Chip label={item.type} size="small" sx={{ fontSize: 9, background: C.gray200 }} />
                </Box>
                {item.evidence && (
                  <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mt: 0.5 }) }}>
                    Evidence: {safeString(item.evidence).substring(0, 100)}...
                  </Typography>
                )}
                {item.confidence && (
                  <Typography sx={{ ...os({ fontSize: 10, color: C.gray500, mt: 0.5 }) }}>
                    Confidence: {(item.confidence * 100).toFixed(0)}%
                  </Typography>
                )}
              </Box>
            ))}
          </Grid>
          {hasMoreBillableItems && (
            <Box sx={{ display: "flex", justifyContent: "center", mt: 2 }}>
              <Button 
                onClick={() => setShowAllBillableItems(!showAllBillableItems)}
                sx={{ ...os({ fontSize: 12, textTransform: "none" }), color: C.gray900 }}
              >
                {showAllBillableItems ? 'Show Less' : `Show All ${data.billable_items.length} Billable Items`}
              </Button>
            </Box>
          )}
        </Section>
      )}

      {/* Unbilled Items */}
      {data.unbilled_items?.length > 0 && (
        <Section title="Unbilled Items">
          {data.unbilled_items.map((item, idx) => (
            <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${C.gray700}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
              <Typography sx={{ ...os({ fontSize: 13, fontWeight: 600, color: C.gray800 }) }}>{safeString(item.item)}</Typography>
              {item.reason && (
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mt: 0.5 }) }}>Reason: {safeString(item.reason)}</Typography>
              )}
            </Box>
          ))}
        </Section>
      )}

      {/* Potential Denials */}
      {data.potential_denials?.length > 0 && (
        <Section title="Potential Denials">
          <MetricCard title="Denial Risks" items={data.potential_denials} type="error" />
        </Section>
      )}

      {/* Flags */}
      {data.flags?.length > 0 && (
        <Section title="Alerts">
          {data.flags.map((flag, idx) => (
            <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${flag.type === 'warning' ? C.gray700 : C.gray700}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                {flag.type === 'warning' ? <WarningAmberRounded sx={{ fontSize: 16, color: C.gray700 }} /> : <InfoRounded sx={{ fontSize: 16, color: C.gray700 }} />}
                <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>{safeString(flag.message || flag)}</Typography>
              </Box>
            </Box>
          ))}
        </Section>
      )}
    </Box>
  );
};
// 12. Render Fraud Screening Engine
const renderFraudScreening = () => {
  const data = patientData?.engine_specific_results?.['Fraud Screening Engine'];
  if (!data) return null;

  const getRiskLevelStyles = (level) => {
    const levels = {
      'CRITICAL': { color: C.black, background: C.gray200, icon: '🔴' },
      'HIGH': { color: C.gray800, background: C.gray200, icon: '🟠' },
      'MEDIUM': { color: C.gray700, background: C.gray200, icon: '🟡' },
      'LOW': { color: C.gray600, background: C.gray200, icon: '🟢' }
    };
    return levels[level] || { color: C.gray500, background: C.gray200, icon: '⚪' };
  };

  const riskStyles = getRiskLevelStyles(data.risk_level);

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Fraud Screening Analysis
      </Typography>

      {/* Risk Level Badge */}
      <Box sx={{ 
        mb: 3, 
        p: 2.5, 
        background: riskStyles.background, 
        border: `1px solid ${C.gray400}`, 
        borderRadius: "4px",
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap"
      }}>
        <Typography sx={{ fontSize: 28 }}>{riskStyles.icon}</Typography>
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Risk Level</Typography>
          <Typography sx={{ ...os({ fontSize: 18, fontWeight: 600, color: riskStyles.color }) }}>
            {data.risk_level || 'Unknown'}
          </Typography>
        </Box>
      </Box>

      {/* Summary */}
      {data.summary && (
        <Section title="Summary">
          <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.6 }) }}>
              {data.summary}
            </Typography>
          </Box>
        </Section>
      )}

      {/* Findings */}
      {data.findings && (
        <Section title="Findings">
          <Grid>
            {data.findings.clinical_consistency && (
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 12, fontWeight: 600, color: C.gray900, mb: 1 }) }}>
                  Clinical Consistency
                </Typography>
                <Chip 
                  label={data.findings.clinical_consistency.status} 
                  size="small" 
                  sx={{ 
                    background: data.findings.clinical_consistency.status === 'CONSISTENT' ? C.gray900 : C.gray800, 
                    color: C.white, 
                    fontSize: 10,
                    mb: 1
                  }} 
                />
                {data.findings.clinical_consistency.note && (
                  <Typography sx={{ ...os({ fontSize: 12, color: C.gray600, mt: 1 }) }}>
                    {data.findings.clinical_consistency.note}
                  </Typography>
                )}
              </Box>
            )}
            {data.findings.temporal_analysis && (
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 12, fontWeight: 600, color: C.gray900, mb: 1 }) }}>
                  Temporal Analysis
                </Typography>
                <Chip 
                  label={data.findings.temporal_analysis.status} 
                  size="small" 
                  sx={{ 
                    background: data.findings.temporal_analysis.status === 'NORMAL' ? C.gray900 : C.gray800, 
                    color: C.white, 
                    fontSize: 10,
                    mb: 1
                  }} 
                />
                {data.findings.temporal_analysis.details && (
                  <Typography sx={{ ...os({ fontSize: 12, color: C.gray600, mt: 1 }) }}>
                    {data.findings.temporal_analysis.details}
                  </Typography>
                )}
              </Box>
            )}
          </Grid>
        </Section>
      )}

      {/* Red Flags */}
      {data.red_flags?.length > 0 && (
        <Section title="Red Flags">
          {data.red_flags.map((flag, idx) => (
            <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${C.black}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
              <Typography sx={{ ...os({ fontSize: 13, fontWeight: 600, color: C.black, mb: 0.5 }) }}>
                {safeString(flag.issue)}
              </Typography>
              {flag.details && (
                <Typography sx={{ ...os({ fontSize: 12, color: C.gray600 }) }}>{safeString(flag.details)}</Typography>
              )}
              {flag.severity && (
                <Chip label={flag.severity} size="small" sx={{ mt: 1, fontSize: 10, background: C.gray800, color: C.white }} />
              )}
            </Box>
          ))}
        </Section>
      )}

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <Section title="Recommendations">
          <MetricCard title="Suggested Actions" items={data.recommendations} type="neutral" />
        </Section>
      )}
    </Box>
  );
};

// 13. Render Discharge & Outcome Engine
const renderDischargeOutcome = () => {
  const data = patientData?.engine_specific_results?.['Discharge & Outcome Engine'];
  if (!data) return null;

  const formatDate = (dateStr) => {
    if (!dateStr) return 'Not specified';
    try {
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return dateStr;
      return date.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      });
    } catch {
      return dateStr;
    }
  };

  const getDischargeStatusDisplay = (status) => {
    const statusMap = {
      'discharged': { label: 'Discharged', icon: '✅', color: C.gray900 },
      'follow_up_planned': { label: 'Follow-up Planned', icon: '📅', color: C.gray800 },
      'planned': { label: 'Planned', icon: '📅', color: C.gray700 },
      'active_treatment': { label: 'Active Treatment', icon: '💊', color: C.gray700 }
    };
    return statusMap[status] || { label: status || 'Unknown', icon: '📋', color: C.gray500 };
  };

  const statusInfo = getDischargeStatusDisplay(data.discharge_status);

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Discharge & Outcome Analysis
      </Typography>

      {/* Status Badge */}
      <Box sx={{ 
        mb: 3, 
        p: 2.5, 
        background: `${statusInfo.color}20`, 
        border: `1px solid ${C.gray400}`, 
        borderRadius: "4px",
        display: "flex",
        alignItems: "center",
        gap: 2,
        flexWrap: "wrap"
      }}>
        <Typography sx={{ fontSize: 24 }}>{statusInfo.icon}</Typography>
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Discharge Status</Typography>
          <Typography sx={{ ...os({ fontSize: 18, fontWeight: 600, color: statusInfo.color }) }}>
            {statusInfo.label}
          </Typography>
        </Box>
        {data.discharge_date && (
          <Box>
            <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Discharge Date</Typography>
            <Typography sx={{ ...os({ fontSize: 14, fontWeight: 500, color: C.gray900 }) }}>
              {formatDate(data.discharge_date)}
            </Typography>
          </Box>
        )}
      </Box>

      {/* Discharge Summary */}
      {data.discharge_summary && (
        <Section title="Discharge Summary">
          <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.6 }) }}>
              {data.discharge_summary}
            </Typography>
          </Box>
        </Section>
      )}

      {/* Outcomes Assessed */}
      {data.outcomes_assessed && (
        <Section title="Outcomes">
          <Grid>
            {data.outcomes_assessed.primary_diagnosis_status && (
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Primary Diagnosis Status</Typography>
                <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>
                  {data.outcomes_assessed.primary_diagnosis_status}
                </Typography>
              </Box>
            )}
            {data.outcomes_assessed.condition_at_discharge && (
              <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Condition at Discharge</Typography>
                <Typography sx={{ ...os({ fontSize: 14, fontWeight: 600, color: C.gray900 }) }}>
                  {data.outcomes_assessed.condition_at_discharge}
                </Typography>
              </Box>
            )}
          </Grid>
          {data.outcomes_assessed.key_findings?.length > 0 && (
            <Box sx={{ mt: 2 }}>
              <MetricCard title="Key Findings" items={data.outcomes_assessed.key_findings} type="neutral" />
            </Box>
          )}
        </Section>
      )}

      {/* Follow-up Plans */}
      {data.follow_up_planned?.length > 0 && (
        <Section title="Follow-up Plans">
          <MetricCard title="Planned Follow-ups" items={data.follow_up_planned} type="neutral" />
        </Section>
      )}

      {/* Recommendations */}
      {data.recommendations?.length > 0 && (
        <Section title="Recommendations">
          <MetricCard title="Suggested Actions" items={data.recommendations} type="warning" />
        </Section>
      )}
    </Box>
  );
};

// 14. Render Specialty Engine
const renderSpecialty = () => {
  const data = patientData?.engine_specific_results?.['Specialty Engine'];
  if (!data) return null;

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Specialty Analysis
      </Typography>

      {/* Primary Specialty */}
      {data.primary_specialty && (
        <Box sx={{ 
          mb: 3, 
          p: 2.5, 
          background: C.gray200, 
          border: `1px solid ${C.gray400}`, 
          borderRadius: "4px",
          textAlign: "center"
        }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mb: 0.5 }) }}>Primary Specialty</Typography>
          <Typography sx={{ ...os({ fontSize: 20, fontWeight: 600, color: C.gray900 }) }}>
            {data.primary_specialty}
          </Typography>
        </Box>
      )}

      {/* Secondary Specialties */}
      {data.secondary_specialties?.length > 0 && (
        <Section title="Related Specialties">
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
            {data.secondary_specialties.map((specialty, idx) => (
              <Chip key={idx} label={safeString(specialty)} sx={{ background: C.gray200, fontSize: 12 }} />
            ))}
          </Box>
        </Section>
      )}

      {/* Clinical Rationale */}
      {data.clinical_rationale && (
        <Section title="Clinical Rationale">
          <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.6 }) }}>
              {data.clinical_rationale}
            </Typography>
          </Box>
        </Section>
      )}

      {/* Flags */}
      {data.flags?.length > 0 && (
        <Section title="Flags & Alerts">
          {data.flags.map((flag, idx) => (
            <Box key={idx} sx={{ p: 2, borderLeft: `3px solid ${C.gray700}`, background: C.gray200, borderRadius: "4px", mb: 1 }}>
              <Box sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
                <WarningAmberRounded sx={{ fontSize: 16, color: C.gray700 }} />
                <Typography sx={{ ...os({ fontSize: 13, color: C.gray800 }) }}>{safeString(flag)}</Typography>
              </Box>
            </Box>
          ))}
        </Section>
      )}
    </Box>
  );
};

// 15. Render Coding & Compliance Engine
const renderCodingCompliance = () => {
  const data = patientData?.engine_specific_results?.['Coding & Compliance Engine'];
  if (!data) return null;

  return (
    <Box>
      <Typography sx={{ ...os({ fontSize: 16, color: C.gray900, fontWeight: 600, mb: 3 }) }}>
        Coding & Compliance Analysis
      </Typography>

      {/* Summary Stats */}
      <Grid minWidth={150}>
        <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>ICD-10 Codes</Typography>
          <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray900 }) }}>{data.icd_codes?.length || 0}</Typography>
        </Box>
        <Box sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", textAlign: "center", background: C.white }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>CPT Codes</Typography>
          <Typography sx={{ ...os({ fontSize: 24, fontWeight: 600, color: C.gray900 }) }}>{data.cpt_codes?.length || 0}</Typography>
        </Box>
      </Grid>

      {/* Summary Text */}
      {data.summary && (
        <Section title="Summary">
          <Box sx={{ p: 2.5, border: `1px solid ${C.gray400}`, borderRadius: "4px", background: C.gray200 }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, lineHeight: 1.6 }) }}>
              {data.summary}
            </Typography>
          </Box>
        </Section>
      )}

      {/* ICD Codes */}
      {data.icd_codes?.length > 0 && (
        <Section title={`ICD-10 Codes (${data.icd_codes.length})`}>
          {data.icd_codes.map((code, idx) => (
            <Box key={idx} sx={{ p: 2, border: `1px solid ${C.gray400}`, borderRadius: "4px", mb: 1.5, background: C.white }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1, mb: 0.5 }}>
                <Typography sx={{ ...os({ fontSize: 16, fontWeight: 700, color: C.gray900, fontFamily: "monospace" }) }}>
                  {code.icd_code || code.code || '—'}
                </Typography>
                <Chip 
                  label={code.type || (code.is_primary ? 'PRIMARY' : 'SECONDARY')} 
                  size="small" 
                  sx={{ 
                    background: (code.type === 'PRIMARY' || code.is_primary) ? C.gray900 : C.gray700, 
                    color: C.white, 
                    fontSize: 10 
                  }} 
                />
              </Box>
              <Typography sx={{ ...os({ fontSize: 13, color: C.gray800, mb: 0.5 }) }}>
                {code.diagnosis || 'No description'}
              </Typography>
              {code.confidence && (
                <Typography sx={{ ...os({ fontSize: 10, color: C.gray500 }) }}>
                  Confidence: {(code.confidence * 100).toFixed(0)}%
                </Typography>
              )}
            </Box>
          ))}
        </Section>
      )}

      {/* Issues */}
      {data.issues?.length > 0 && (
        <Section title="Issues Identified">
          <MetricCard title="Compliance Issues" items={data.issues} type="error" />
        </Section>
      )}

      {/* Metadata */}
      {data.metadata && (
        <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${C.gray400}`, display: "flex", justifyContent: "space-between", fontSize: 10, color: C.gray500, flexWrap: "wrap", gap: 1 }}>
          <span>Diagnoses Found: {data.metadata.diagnoses_found || 0}</span>
          <span>Procedures Found: {data.metadata.procedures_found || 0}</span>
          <span>Analysis Time: {new Date(data.metadata.analysis_timestamp).toLocaleString()}</span>
        </Box>
      )}
    </Box>
  );
};

  // Main render function
  const renderContent = () => {
    if (!patientData) {
      return (
        <Box sx={{ textAlign: "center", py: 12 }}>
          <AssessmentRounded sx={{ fontSize: 48, color: C.gray500, mb: 2 }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.gray900, mb: 1 }) }}>No Data Available</Typography>
          <Typography sx={{ ...os({ fontSize: 12, color: C.gray600 }) }}>Click "Run Analysis" to fetch and analyze patient data.</Typography>
        </Box>
      );
    }

    // Show clinical context summary for all modules
    const showClinicalContext = selectedModule !== 'medical_adequacy' && patientData?.clinical_context;

    return (
      <Box>
        {showClinicalContext && renderClinicalContext()}
        
        {selectedModule === 'medical_adequacy' && renderMedicalAdequacy()}
        {selectedModule === 'medical_sufficiency' && renderMedicalSufficiency()}
        {selectedModule === 'clinical_derivation' && renderClinicalDerivation()}
        {selectedModule === 'patient_policy' && renderPatientPolicy()}
        {selectedModule === 'clinical_justification' && renderClinicalJustification()}
        {selectedModule === 'admission_review' && renderAdmissionReview()}
        {selectedModule === 'investigation_audit' && renderInvestigationAudit()}
        {selectedModule === 'treatment_procedure' && renderTreatmentProcedure()}
        {selectedModule === 'medication_review' && renderMedicationReview()}
        {selectedModule === 'documentation_audit' && renderDocumentationAudit()}
        {selectedModule === 'billing_audit' && renderBillingAudit()}
        {selectedModule === 'fraud_screening' && renderFraudScreening()}
        {selectedModule === 'discharge_outcome' && renderDischargeOutcome()}
        {selectedModule === 'specialty' && renderSpecialty()}
        {selectedModule === 'coding_compliance' && renderCodingCompliance()}

        {/* Warnings */}
        {patientData.warnings?.length > 0 && (
          <Box sx={{ mt: 3, pt: 2, borderTop: `1px solid ${C.gray400}` }}>
            {patientData.warnings.map((warning, idx) => (
              <Box key={idx} sx={{ p: 1.5, background: C.gray200, borderRadius: "4px", mb: 1, display: "flex", gap: 1, alignItems: "center" }}>
                <InfoRounded sx={{ fontSize: 14, color: C.gray700 }} />
                <Typography sx={{ ...os({ fontSize: 11, color: C.gray600 }) }}>{warning}</Typography>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    );
    
  };
  

  return (
    <Box sx={{ ...cardStyle, overflow: "hidden", height: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <Box sx={sectionHeader}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.gray900, letterSpacing: "0.02em" }) }}>
            Insurance & Clinical Analysis
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mt: 0.4 }) }}>
            Medical adequacy, sufficiency, and compliance review
          </Typography>
        </Box>
        <Button
          variant="contained"
          onClick={runAnalysis}
          disabled={processing || loading}
          sx={{
            ...os({ fontSize: 12, textTransform: "none" }),
            background: C.black,
            color: C.white,
            px: 2.5,
            py: 1,
            borderRadius: "2px",
            "&:hover": { background: C.gray800 },
            "&:disabled": { opacity: 0.4 }
          }}
        >
          {(processing || loading) ? (
            <CircularProgress size={16} sx={{ color: C.white, mr: 1 }} />
          ) : (
            <RefreshRounded sx={{ fontSize: 16, mr: 1 }} />
          )}
          Run Analysis
        </Button>
        <Button
  variant="contained"
  onClick={handleGeneratePDF}
  disabled={!patientData}
  sx={{
    background: "#000",
    color: "#fff",
    '&:hover': { background: "#333" }
  }}
>
  Save PDF
</Button>
      </Box>

      {/* Error Alert */}
      {error && (
        <Alert severity="error" sx={{ m: 3, borderRadius: "2px" }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Loading Indicator */}
      {(loading || processing) && (
        <Box sx={{ px: 3, pt: 2 }}>
          <LinearProgress sx={{ background: C.gray400, "& .MuiLinearProgress-bar": { background: C.black } }} />
          <Typography sx={{ ...os({ fontSize: 11, color: C.gray600, mt: 1, textAlign: "center" }) }}>
            {loading ? 'Loading existing data...' : 'Processing analysis...'}
          </Typography>
        </Box>
      )}

      {/* Content Area with flex grow */}
      <Box sx={{ display: "flex", flex: 1, minHeight: 0, overflow: "hidden" }}>
        {/* Sidebar - Now scrollable */}
        <Box sx={{
          width: sidebarCollapsed ? 56 : 240,
          borderRight: `1px solid ${C.gray400}`,
          background: C.white,
          transition: "width 0.2s ease",
          flexShrink: 0,
          display: "flex",
          flexDirection: "column",
          height: "100%",
        }}>
          {/* Toggle Button - Fixed at top */}
          <Box sx={{ 
            p: 1.5, 
            borderBottom: `1px solid ${C.gray400}`, 
            display: "flex", 
            justifyContent: "center",
            flexShrink: 0,
          }}>
            <IconButton
              size="small"
              onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
              sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.gray400}`, color: C.gray600 }}
            >
              {sidebarCollapsed ? <ChevronRightRounded sx={{ fontSize: 16 }} /> : <ChevronLeftRounded sx={{ fontSize: 16 }} />}
            </IconButton>
          </Box>

          {/* Module List - Scrollable */}
          <Box sx={{ 
            flex: 1,
            overflowY: "auto",
            py: 1,
            '&::-webkit-scrollbar': {
              width: '4px',
            },
            '&::-webkit-scrollbar-track': {
              background: C.gray400,
            },
            '&::-webkit-scrollbar-thumb': {
              background: C.gray500,
              borderRadius: '2px',
            },
            '&::-webkit-scrollbar-thumb:hover': {
              background: C.gray600,
            },
          }}>
            {sidebarModules.map(module => (
              <Tooltip key={module.id} title={sidebarCollapsed ? module.name : ''} placement="right">
                <Box
                  onClick={() => setSelectedModule(module.id)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    px: 2,
                    py: 1.5,
                    cursor: "pointer",
                    background: selectedModule === module.id ? C.gray200 : "transparent",
                    borderLeft: selectedModule === module.id ? `2px solid ${C.black}` : "2px solid transparent",
                    "&:hover": { background: C.gray200 },
                    transition: "all 0.12s",
                  }}
                >
                  <Box sx={{ color: selectedModule === module.id ? C.black : C.gray600, minWidth: 24 }}>
                    {module.icon}
                  </Box>
                  {!sidebarCollapsed && (
                    <Typography sx={{ ...os({ fontSize: 12, color: selectedModule === module.id ? C.gray900 : C.gray800 }) }}>
                      {module.name}
                    </Typography>
                  )}
                </Box>
              </Tooltip>
            ))}
          </Box>
        </Box>

        {/* Main Content - Now scrollable */}
        <Box sx={{ 
          flex: 1, 
          overflowY: "auto", 
          background: C.gray200,
          '&::-webkit-scrollbar': {
            width: '8px',
          },
          '&::-webkit-scrollbar-track': {
            background: C.gray400,
          },
          '&::-webkit-scrollbar-thumb': {
            background: C.gray500,
            borderRadius: '4px',
          },
          '&::-webkit-scrollbar-thumb:hover': {
            background: C.gray600,
          },
        }}>
          <Box sx={{ p: 3 }}>
            {renderContent()}
          </Box>
        </Box>
      </Box>
    </Box>
  );
}

export default Unifiedinsurance;