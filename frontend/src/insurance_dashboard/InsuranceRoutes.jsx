import { Routes, Route, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { ExtractionNotificationProvider } from "./pages/ExtractionNotifications";
import Dashboard from "./pages/Dashboard";
import Analytics from "./pages/Analytics";
import MDLogin from "./pages/MDLogin";
import OperationsHeadLogin from "./pages/OperationsHeadLogin";
import OperationsHeadAssignment from "./pages/OperationsHeadAssignment";
import EvidenceVault from "./pages/EvidenceVault";
import NewCase from "./pages/NewCase";
import CQReview from "./pages/QCReview";
import ReportBuilder from "./pages/ReportBuilder";
import TaskAllocation from "./pages/TaskAllocation";
import "./insurance.css";
import FieldOfficerRegistration from "./pages/FieldOfficerRegistration";
import DoctorRegistration from "./pages/DoctorRegistration";
import FieldOfficersList from "./pages/FieldOfficersList";
import DoctorReview from "./pages/DoctorReview";
import AuditingDoctorReview from "./pages/AuditingDoctorReview";
import PDFEditorPage from "./pages/PDFEditorPage";
import DoctorsList from "./pages/DoctorsList";
import MessagesPage from "./pages/MessagesPage";
import RoleDashboard from "./pages/RoleDashboard";
import UserManagement from "./pages/UserManagement";
import DoctorManagement from "./pages/DoctorManagement";
import { NotificationsProvider } from "./context/NotificationsContext";

// Path prefixes for the four spec roles added as auth scaffolding. Each lands
// on a shared RoleDashboard shell inside InsuranceLayout in "role mode".
const ROLE_MODES = ['state-team', 'reporting-manager', 'qc-manager', 'portal-team'];

const PAGE_TITLES = {
  "/insurance/dashboard": "Dashboard",
  "/insurance/analytics": "Analytics",
  "/insurance/md/dashboard": "Managing Director Dashboard",
  "/insurance/md/operations-heads": "Operations Heads",
  "/insurance/operations/dashboard": "Operations Dashboard",
  "/insurance/operations/users": "User Management",
  "/insurance/operations/doctors": "Doctor Management",
  "/insurance/state-team/dashboard": "State Team Dashboard",
  "/insurance/reporting-manager/dashboard": "Reporting Manager Dashboard",
  "/insurance/qc-manager/dashboard": "QC Manager Dashboard",
  "/insurance/portal-team/dashboard": "Portal Team Dashboard",
  "/insurance/evidence-vault": "Evidence Vault",
  "/insurance/new-case": "New Case",
  "/insurance/cq-review": "QC Review",
  "/insurance/report-builder": "Report Builder",
  "/insurance/task-allocation": "Task Allocation",
  "/insurance/field-officers": "Field Officers",
  "/insurance/doctors": "Doctors",   // ← add this
  "/insurance/messages": "Messages",
}

function InsuranceLayout() {
  const [showModal, setShowModal] = useState(false);
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || "Dashboard";
  const mdMode = location.pathname.startsWith('/insurance/md/');
  const operationsMode = location.pathname.startsWith('/insurance/operations/');
  const roleMode = ROLE_MODES.find(r => location.pathname.startsWith(`/insurance/${r}/`)) || '';

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar mdMode={mdMode} operationsMode={operationsMode} roleMode={roleMode} />

      <div style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        position: "relative",
      }}>
        {/* 🔥 wrapper gives Topbar the SAME horizontal inset as the scroll area below */}
        <div style={{ padding: "20px 20px 0" }}>
          <Topbar
            title={title}
            mdMode={mdMode || operationsMode || !!roleMode}
            onOpenModal={() => setShowModal(true)}
            onOpenDoctorModal={() => setShowDoctorModal(true)}
          />
        </div>

        <div style={{
          flex: 1,
          overflowY: "auto",
          padding: "20px",
          filter: (showModal || showDoctorModal) ? "blur(4px)" : "none",
          pointerEvents: (showModal || showDoctorModal) ? "none" : "auto",
        }}>
          <Outlet />
        </div>

        {showModal && <FieldOfficerRegistration onClose={() => setShowModal(false)} />}
        {showDoctorModal && <DoctorRegistration onClose={() => setShowDoctorModal(false)} />}
      </div>
    </div>
  );
}

export default function InsuranceRoutes() {
  return (
    <NotificationsProvider>
    <Routes>
      <Route path="md/login" element={<MDLogin />} />
      <Route path="operations/login" element={<OperationsHeadLogin />} />
      <Route path="md/dashboard" element={<InsuranceLayout />}>
        <Route index element={<Analytics mdMode />} />
      </Route>
      <Route path="md/operations-heads" element={<InsuranceLayout />}>
        <Route index element={<OperationsHeadAssignment />} />
      </Route>
      <Route path="operations/dashboard" element={<InsuranceLayout />}>
        <Route index element={<Analytics operationsMode />} />
      </Route>
      <Route path="operations/users" element={<InsuranceLayout />}>
        <Route index element={<UserManagement />} />
      </Route>
      <Route path="operations/doctors" element={<InsuranceLayout />}>
        <Route index element={<DoctorManagement />} />
      </Route>
      <Route path="state-team/dashboard" element={<InsuranceLayout />}>
        <Route index element={<RoleDashboard roleKey="state-team" />} />
      </Route>
      <Route path="reporting-manager/dashboard" element={<InsuranceLayout />}>
        <Route index element={<RoleDashboard roleKey="reporting-manager" />} />
      </Route>
      <Route path="qc-manager/dashboard" element={<InsuranceLayout />}>
        <Route index element={<RoleDashboard roleKey="qc-manager" />} />
      </Route>
      <Route path="portal-team/dashboard" element={<InsuranceLayout />}>
        <Route index element={<RoleDashboard roleKey="portal-team" />} />
      </Route>
      {/* Single layout wrapper — all children share one stable instance */}
      <Route element={<InsuranceLayout />}>
        <Route path="dashboard"       element={<Dashboard />} />
        <Route path="analytics"       element={<Analytics />} />
        <Route path="evidence-vault"  element={<EvidenceVault />} />
        <Route path="new-case"        element={<NewCase />} />
        <Route path="cq-review"       element={<CQReview />} />
        <Route path="report-builder"  element={<ReportBuilder />} />
        <Route path="task-allocation" element={<TaskAllocation />} />
        <Route path="field-officers"  element={<FieldOfficersList />} />
        <Route path="doctors"         element={<DoctorsList />} />   {/* ← add this */}
        <Route path="messages"        element={<MessagesPage />} />
      </Route>

      {/* These routes have no shared layout */}
      <Route path="/doctor-review" element={<DoctorReview />} />

      {/* Extraction toasts + shared polling only run for the auditing
          doctor's own page — provider is scoped to just this route instead
          of the whole app root. */}
      <Route
        path="/doctor-review-new"
        element={
          <ExtractionNotificationProvider>
            <AuditingDoctorReview />
          </ExtractionNotificationProvider>
        }
      />

      <Route path="doctor/pdf-editor/:caseId" element={<PDFEditorPage />} />
    </Routes>
    </NotificationsProvider>
  );
}
