import { Routes, Route, Outlet, useLocation } from "react-router-dom";
import { useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { ExtractionNotificationProvider } from "./pages/ExtractionNotifications";
import Dashboard from "./pages/Dashboard";
import Analytics from "./pages/Analytics";
import EvidenceVault from "./pages/EvidenceVault";
import FieldTracking from "./pages/FieldTracking";
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

const PAGE_TITLES = {
  "/insurance/dashboard": "Dashboard",
  "/insurance/analytics": "Analytics",
  "/insurance/evidence-vault": "Evidence Vault",
  "/insurance/field-tracking": "Field Tracking",
  "/insurance/new-case": "New Case",
  "/insurance/cq-review": "QC Review",
  "/insurance/report-builder": "Report Builder",
  "/insurance/task-allocation": "Task Allocation",
  "/insurance/field-officers": "Field Officers",
  "/insurance/doctors": "Doctors",   // ← add this
}

function InsuranceLayout() {
  const [showModal, setShowModal] = useState(false);
  const [showDoctorModal, setShowDoctorModal] = useState(false);
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || "Dashboard";

  return (
    <div style={{ display: "flex", height: "100vh", overflow: "hidden" }}>
      <Sidebar />

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
    <ExtractionNotificationProvider>
      <Routes>
        {/* Single layout wrapper — all children share one stable instance */}
        <Route element={<InsuranceLayout />}>
          <Route path="dashboard"       element={<Dashboard />} />
          <Route path="analytics"       element={<Analytics />} />
          <Route path="evidence-vault"  element={<EvidenceVault />} />
          <Route path="field-tracking"  element={<FieldTracking />} />
          <Route path="new-case"        element={<NewCase />} />
          <Route path="cq-review"       element={<CQReview />} />
          <Route path="report-builder"  element={<ReportBuilder />} />
          <Route path="task-allocation" element={<TaskAllocation />} />
          <Route path="field-officers"  element={<FieldOfficersList />} />
          <Route path="doctors"         element={<DoctorsList />} />   {/* ← add this */}
        </Route>

        {/* These routes have no shared layout */}
        <Route path="/doctor-review"     element={<DoctorReview />} />
        <Route path="/doctor-review-new" element={<AuditingDoctorReview />} />
        <Route path="doctor/pdf-editor/:caseId" element={<PDFEditorPage />} />
      </Routes>
    </ExtractionNotificationProvider>
  );
}