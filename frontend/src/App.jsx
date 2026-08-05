import { Routes, Route } from "react-router-dom";
import { useLocation } from "react-router-dom";
import { useEffect, lazy, Suspense, memo } from "react";
import { trackPage } from "./analytics";


// ─────────────────────────────────────────────
// PAGE LOADER — shown per route while chunk loads
// ─────────────────────────────────────────────
const PageLoader = () => (
  <div style={{
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100vh",
    width: "100%",
    background: "#f9fafb",
  }}>
    <div style={{
      width: 40,
      height: 40,
      border: "4px solid #e5e7eb",
      borderTop: "4px solid #3b82f6",
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
    }} />
    <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
  </div>
);

// ─────────────────────────────────────────────
// ROUTE WRAPPER — each route gets its own boundary
// ─────────────────────────────────────────────
const R = ({ component: Component }) => (
  <Suspense fallback={<PageLoader />}>
    <Component />
  </Suspense>
);

// ─────────────────────────────────────────────
// CHUNK GROUP 1 — Auth & Registration (entry points, load fast)
// Eager-loaded: Login is nearly always first hit
// ─────────────────────────────────────────────
import Login from "./login/login";                           // NOT lazy — always first
import AmbulanceLogin from "./login/AmbulanceLogin";         // NOT lazy — entry point

const HospitalRegister    = lazy(() => import("./register/HospitalRegister"));
const CustomerCareRegister= lazy(() => import("./register/CustomerCareRegister"));
const RegisterDoctor      = lazy(() => import("./register/RegisterDoctor"));
const RegisterPatient     = lazy(() => import("./register/patientregister"));
const NurseRegister       = lazy(() => import("./register/NurseRegister"));
const ClinicalNurseRegister = lazy(() => import("./webpage/ClinicalNurseRegister"));
const ClinicDoctorRegister= lazy(() => import("./webpage/ClinicDoctorRegister"));
const QualityCheckerRegistration = lazy(() => import("./components/QualityCheckerRegistration"));

// ─────────────────────────────────────────────
// CHUNK GROUP 2 — Doctor workflows
// ─────────────────────────────────────────────
const DoctorDashboard     = lazy(() => import("./dashboard/doctordashboard"));
const DoctorEmergencyDashboard = lazy(() => import("./components/DoctorEmergencyDashboard"));
const DoctorRuleView      = lazy(() => import("./customize/DoctorRuleView"));
const DoctorCommunicationDashboard = lazy(() => import("./dashboard/CommunicationProgression"));
const DoctorUpload        = lazy(() => import("./dashboard/UploadExcel"));
const DoctorUploadWithTimings = lazy(() => import("./dashboard/UploadExelWithTimings"));
const DoctorMasterUpload  = lazy(() => import("./components/Doctormasterupload"));
const OPDTimePage         = lazy(() => import("./dashboard/OPDTimeSchedule"));
const OPDTimePageHospital = lazy(() => import("./dashboard/OpdTimingsHospital"));

// ─────────────────────────────────────────────
// CHUNK GROUP 3 — Patient workflows
// ─────────────────────────────────────────────
const PatientProfile      = lazy(() => import("./dashboard/patientprofile"));
const PatientListingPage  = lazy(() => import("./dashboard/PatientListingPage"));
const PatientList         = lazy(() => import("./dashboard/Registeredpatientlisting"));
const PatientPortal       = lazy(() => import("./patient_portal/PatientPortal"));
const PatientDashboard    = lazy(() => import("./dashboard/PatientDashboard"));
const PatientProfileEmergency = lazy(() => import("./components/PatientProfileEmergency"));
const PatientPortalAppointments = lazy(() => import("./dashboard/PatientPortalAppointment"));
const RegisterAbha        = lazy(() => import("./Abha/RegisterAbha"));
const LoginAbha           = lazy(() => import("./Abha/LoginAbha"));
const AbhaHome            = lazy(() => import("./Abha/AbhaHome"));
const Profile             = lazy(() => import("./Abha/Profile"));

// ─────────────────────────────────────────────
// CHUNK GROUP 4 — Hospital & Admin
// ─────────────────────────────────────────────
const HospitalDashboard   = lazy(() => import("./dashboard/HospitalDashboard"));
const AdminDashboard      = lazy(() => import("./dashboard/AdminDashboard"));
const AdminRuleConfig     = lazy(() => import("./Admin/AdminReportRule"));
const ReportRuleSettings  = lazy(() => import("./Admin/ReportRuleSettings"));
const HospitalAdminStaff  = lazy(() => import("./dashboard/HospitalAdminStaff"));
const Customization       = lazy(() => import("./customize/settings"));
const IntegrationDashboard= lazy(() => import("./dashboard/IntegrationSettings"));
const MonitoringDashboard = lazy(() => import("./dashboard/MonitoringDashboard"));
const IntegrationLogs    = lazy(() => import("./dashboard/integrationlogs"));

// ─────────────────────────────────────────────
// CHUNK GROUP 5 — Ambulance & Customer Care
// ─────────────────────────────────────────────
const AmbulanceDashboard  = lazy(() => import("./dashboard/AmbulanceDashboard"));
const AmbulancePatientProfile = lazy(() => import("./dashboard/AmbulancePatientProfile"));
const CustomerDashboard   = lazy(() => import("./dashboard/CustomerDashboard"));
const CustomerCarePatientProfile = lazy(() => import("./dashboard/Customercarepatientprofile"));

// ─────────────────────────────────────────────
// CHUNK GROUP 6 — Clinic (external-facing)
// ─────────────────────────────────────────────
const ClinicLogin         = lazy(() => import("./webpage/ClinicLogin"));
const ClinicDashboard     = lazy(() => import("././webpage/ClinicalDashboard"));
const AppointmentDashboard= lazy(() => import("./webpage/ComunicationDashboard"));

// ─────────────────────────────────────────────
// CHUNK GROUP 7 — Insurance
// ─────────────────────────────────────────────
const InsuranceRoutes = lazy(() =>
  import("./insurance_dashboard/InsuranceRoutes")
);

// ─────────────────────────────────────────────
// CHUNK GROUP 8 — Clinical tools & settings
// ─────────────────────────────────────────────
const ClinicalInvestigationForm = lazy(() => import("./components/ClinicalInvestigationForm"));
const ClinicalSourceDashboard = lazy(() => import("./dashboard/ClinicalSourceDashboard"));
const ClinicalKnowledgeGraph = lazy(() => import("./components/ClinicalKnowledgeGraph"));
const KnowledgeGraphUpload= lazy(() => import("./components/KnowledgeGraphUpload"));
const MedicalClinicalContextRule = lazy(() => import("./dashboard/MedicalClinicalContextRule"));
const MedicalCurrentContextRule = lazy(() => import("./dashboard/MedicalCurrentContextRule"));
const GuidelinesSettings  = lazy(() => import("./dashboard/GuidelinesSettings"));
const StructuredNoteInstructionsSettings = lazy(() => import("./dashboard/StructuredNoteInstructionSettings"));
const PreScreeningQuestionsForm = lazy(() => import("./dashboard/PrescreeningQuestions"));
const SkillView           = lazy(() => import("./components/SkillView"));
const Reportnode          = lazy(() => import("./customize/reportnode"));
const Phase1upload = lazy(() => import("./components/Phase1upload"));
const Phase3Governance = lazy(() => import("./components/Phase3Governance"));
const DoctorSoulDashboard = lazy(() => import("./components/DoctorSoulDashboard"));


// ─────────────────────────────────────────────
// CHUNK GROUP 9 — Dashboards & misc
// ─────────────────────────────────────────────
const Dashboard           = lazy(() => import("./components/dashboard"));
const IPDashboard         = lazy(() => import("./components/IPDashboard"));
const RpmView             = lazy(() => import("./dashboard/RpmView"));
const Appointments        = lazy(() => import("./dashboard/Appointments"));
const AppointmentDashboard1 = lazy(() => import("./dashboard/AppointmentDashboard"));
const DateWiseAppointmentDashboard = lazy(() => import("./dashboard/DateWiseAppointmentDashboard"));
const ComunicationDashboard = lazy(() => import("./dashboard/ComunicationDashboard"));
const VoiceAgentPage      = lazy(() => import("./dashboard/Conversation"));
const Medicalcodingdashboard = lazy(() => import("./components/Medicalcodingdashboard"));
const Qualitychecker      = lazy(() => import("./components/Qualitychecker"));
const DataProcessing      = lazy(() => import("./components/DataProcessing"));
const ReportUpload        = lazy(() => import("./components/ReportUpload"));
const PreApprovedInsuranceUpload = lazy(() => import("./components/pre_approved_insurance_upload"));
const Preventivescreening = lazy(() => import("./components/Preventivescreening"))
// ─────────────────────────────────────────────
// CHUNK GROUP 10 — Public / marketing pages
// ─────────────────────────────────────────────
const HomePage            = lazy(() => import("./login/HomePage"));
const Home                = lazy(() => import("./webpage/home"));
const WebpageOnco         = lazy(() => import("./webpage/WebpageOnco"));
const DoctorAssistApiReference = lazy(() => import("./webpage/ApiReferencePage"));
const SkillsGuideRedirect = lazy(() => import("./webpage/SkillsGuideRedirect"));
const AiInHospitals       = lazy(() => import("./webpage/AiInHospitals"));
const AuthRedirect        = lazy(() => import("./components/Authredirect"));
const OncologyDashboard = lazy(() => import("./dashboard/OncologyDashboard"));
const DoctorChat           = lazy(() => import("./components/Chat"));




// ─────────────────────────────────────────────
// PRELOAD — kick off the most common next-chunk
// after login page is idle, so it's ready instantly
// ─────────────────────────────────────────────
function preloadCommonRoutes() {
  // These are the most-visited routes after login — preload in background
  const preloads = [
    () => import("./dashboard/doctordashboard"),
    () => import("./dashboard/HospitalDashboard"),
    () => import("./components/dashboard"),
  ];
  preloads.forEach(fn => {
    requestIdleCallback ? requestIdleCallback(fn) : setTimeout(fn, 3000);
  });
}

// ─────────────────────────────────────────────
// APP
// ─────────────────────────────────────────────
const App = memo(function App() {
  const location = useLocation();

  useEffect(() => {
    trackPage(location.pathname);
  }, [location.pathname]); // ← was [location] — object ref changes every render

  useEffect(() => {
    preloadCommonRoutes();
  }, []); // run once after mount

  return (
    <Routes>
      {/* ── Auth ── */}
      <Route path="/login"                    element={<Login />} />
      <Route path="/ambulance-login"          element={<AmbulanceLogin />} />
      <Route path="/hospital-register"        element={<R component={HospitalRegister} />} />
      <Route path="/customer-care-register"   element={<R component={CustomerCareRegister} />} />
      <Route path="/register-doctor"          element={<R component={RegisterDoctor} />} />
      <Route path="/register-patient"         element={<R component={RegisterPatient} />} />
      <Route path="/nurse-register"           element={<R component={NurseRegister} />} />
      <Route path="/clinical-nurse-register"  element={<R component={ClinicalNurseRegister} />} />
      <Route path="/clinic-doctor-register"   element={<R component={ClinicDoctorRegister} />} />
      <Route path="/QualityCheckerRegistration" element={<R component={QualityCheckerRegistration} />} />

      {/* ── Doctor ── */}
      <Route path="/doctor-dashboard"         element={<R component={DoctorDashboard} />} />
      <Route path="/Doctor-Emergency-Dashbaord" element={<R component={DoctorEmergencyDashboard} />} />
      <Route path="/agentic-rule"             element={<R component={DoctorRuleView} />} />
      <Route path="/doctor-communication-dashboard" element={<R component={DoctorCommunicationDashboard} />} />
      <Route path="/upload-excel"             element={<R component={DoctorUpload} />} />
      <Route path="/doctor-upload-with-timings" element={<R component={DoctorUploadWithTimings} />} />
      <Route path="/medication-master-upload" element={<R component={DoctorMasterUpload} />} />
      <Route path="/opd-time-schedule"        element={<R component={OPDTimePage} />} />
      <Route path="/opd-time-schedule-hospital" element={<R component={OPDTimePageHospital} />} />
      <Route path ="/Preventivescreening" element={<R component={Preventivescreening} />} />
      <Route path="/chat" element={<R component={DoctorChat} />} />

      {/* ── Patient ── */}
      <Route path="/patient-profile"          element={<R component={PatientProfile} />} />
      <Route path="/patient-listing"          element={<R component={PatientListingPage} />} />
      <Route path="/patient-list"             element={<R component={PatientList} />} />
      <Route path="/patient-portal"           element={<R component={PatientPortal} />} />
      <Route path="/patient-dashboard"        element={<R component={PatientDashboard} />} />
      <Route path="/patient-profile-emergency/:id" element={<R component={PatientProfileEmergency} />} />
      <Route path="/patient-portal-appointments" element={<R component={PatientPortalAppointments} />} />
      <Route path="/abha-home"                element={<R component={AbhaHome} />} />
      <Route path="/register-abha"            element={<R component={RegisterAbha} />} />
      <Route path="/login-abha"               element={<R component={LoginAbha} />} />
      <Route path="/profile"                  element={<R component={Profile} />} />

      {/* ── Hospital & Admin ── */}
      <Route path="/hospital-dashboard"       element={<R component={HospitalDashboard} />} />
      <Route path="/admin-dashboard"          element={<R component={AdminDashboard} />} />
      <Route path="/admin-rule-config"        element={<R component={AdminRuleConfig} />} />
      <Route path="/report-rule-settings"     element={<R component={ReportRuleSettings} />} />
      <Route path="/hospital-admin-staff"     element={<R component={HospitalAdminStaff} />} />
      <Route path="/customization"            element={<R component={Customization} />} />
      <Route path="/integration-settings"     element={<R component={IntegrationDashboard} />} />
      <Route path="/monitoring-dashboard"     element={<R component={MonitoringDashboard} />} />
      <Route path="/integration-logs"         element={<R component={IntegrationLogs} />} />

      {/* ── Ambulance & Customer Care ── */}
      <Route path="/ambulance-dashboard"      element={<R component={AmbulanceDashboard} />} />
      <Route path="/ambulance-patient-profile" element={<R component={AmbulancePatientProfile} />} />
      <Route path="/customer-care-dashboard"  element={<R component={CustomerDashboard} />} />
      <Route path="/patient-details"          element={<R component={CustomerCarePatientProfile} />} />

      {/* ── Clinic ── */}
      <Route path="/clinic-login"             element={<R component={ClinicLogin} />} />
      <Route path="/clinic-dashboard"         element={<R component={ClinicDashboard} />} />
      <Route path="/appointment-dashboard"    element={<R component={AppointmentDashboard} />} />

      {/* ── Clinical Tools ── */}
      <Route path="/clinical-investigation-form-workflow" element={<R component={ClinicalInvestigationForm} />} />
      <Route path="/clinical-source-dashboard" element={<R component={ClinicalSourceDashboard} />} />
      <Route path="/ClinicalKnowledgeGraph"   element={<R component={ClinicalKnowledgeGraph} />} />
      <Route path="/knowledge-graph"          element={<R component={KnowledgeGraphUpload} />} />
      <Route path="/medical-clinical-context-rule-settings" element={<R component={MedicalClinicalContextRule} />} />
      <Route path="/medical-current-context-rule-settings" element={<R component={MedicalCurrentContextRule} />} />
      <Route path="/guidelines-settings"      element={<R component={GuidelinesSettings} />} />
      <Route path="/structured-note-instructions-settings" element={<R component={StructuredNoteInstructionsSettings} />} />
      <Route path="/pre-screening-questions"  element={<R component={PreScreeningQuestionsForm} />} />
      <Route path="/skills"                   element={<R component={SkillView} />} />
      <Route path="/report-node"              element={<R component={Reportnode} />} />
      <Route path="/Phase1Upload" element={<R component={Phase1upload} />} />
      <Route path="/governance" element={<R component={Phase3Governance} />} />
      <Route path="/doctor-soul" element={<R component={DoctorSoulDashboard} />} />

      

      {/* ── Dashboards & Misc ── */}
      <Route
        path="/insurance/*"
        element={<R component={InsuranceRoutes} />}
      />


      


      {/* ── Dashboards & Misc ── */}
      <Route path="/dashboard"                element={<R component={Dashboard} />} />
      <Route path="/IPDashboard"              element={<R component={IPDashboard} />} />
      <Route path="/rpm-view"                 element={<R component={RpmView} />} />
      <Route path="/appointments"             element={<R component={Appointments} />} />
      <Route path="/appointment-dashboard1"   element={<R component={AppointmentDashboard1} />} />
      <Route path="/date-wise-appointment-dashboard" element={<R component={DateWiseAppointmentDashboard} />} />
      <Route path="/communication-dashboard"  element={<R component={ComunicationDashboard} />} />
      <Route path="/voice-agent"              element={<R component={VoiceAgentPage} />} />
      <Route path="/Medicalcodingdashboard"   element={<R component={Medicalcodingdashboard} />} />
      <Route path="/Qualitychecker"           element={<R component={Qualitychecker} />} />
      <Route path="/data-processing"          element={<R component={DataProcessing} />} />
      <Route path="/report-upload"            element={<R component={ReportUpload} />} />
      <Route path="/pre-approved-insurance-upload" element={<R component={PreApprovedInsuranceUpload} />} />

      {/* ── Public / Marketing ── */}
      <Route path="/"                         element={<R component={HomePage} />} />
      <Route path="/home"                     element={<R component={Home} />} />
      <Route path="/onco"                     element={<R component={WebpageOnco} />} />
      <Route path="/api-reference"            element={<R component={DoctorAssistApiReference} />} />
      <Route path="/clinical-agent-skills"    element={<R component={SkillsGuideRedirect} />} />
      <Route path="/ai-in-hospitals"          element={<R component={AiInHospitals} />} />
      <Route path="/auth-redirect"            element={<R component={AuthRedirect} />} />
      <Route path="/onco-dashboard"       element={<R component={OncologyDashboard} />} />
    </Routes>
  );
});

export default App;