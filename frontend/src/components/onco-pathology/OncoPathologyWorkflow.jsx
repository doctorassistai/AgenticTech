
// Holds the specimen-in-the-lab pathology lifecycle following the histology
// workflow order: Case → Gross → Processing → Sectioning → Staining →
// Microscopy → Synoptic → TNM. One document per case (case_id); sections are
// written through the whitelisted saveSection endpoint.
//
// Built tabs: Case Registry, Grossing Bench, Synoptic Report, TNM & Final
// Diagnosis. Processing / Sectioning / Staining / Microscopy are placeholder
// stubs shown for the full workflow view (wired up later).

import React, { useState, useEffect } from "react";
import { Box, Typography, Button, Snackbar, IconButton } from "@mui/material";
import { BiotechRounded, CloseRounded } from "@mui/icons-material";
import { motion } from "framer-motion";

import { C, FONT, FW_LIGHT, FW_NORMAL } from "../shared/designTokens";
import { usePathologyCase } from "./shared/usePathologyCase";
import { createCase, saveSection, signOutCase } from "./shared/api";
import CaseRegistryTab from "./tabs/CaseRegistryTab";
import GrossingBenchTab from "./tabs/GrossingBenchTab";
import SynopticReportTab from "./tabs/SynopticReportTab";
import TNMStagingTab from "./tabs/TNMStagingTab";
import PathologyHistoryAccordion from "./PathologyHistoryAccordion";

const MAIN_TABS = [
  { key: "case-register", label: "Case Registry", part: "Path A" },
  { key: "grossing", label: "Grossing Bench", part: "Path B" },
  { key: "processing", label: "Processing", part: "Path C", stub: true },
  { key: "sectioning", label: "Sectioning", part: "Path D", stub: true },
  { key: "staining", label: "Staining", part: "Path E", stub: true },
  { key: "micro", label: "Microscopy", part: "Path F", stub: true },
  { key: "synoptic", label: "Synoptic Report", part: "Path G" },
  { key: "tnm", label: "TNM & Final Diagnosis", part: "Path H" },
];

// Sidebar-tab key → backend section path (case_register uses underscore).
const SECTION_PATH = {
  "case-register": "case_register",
  grossing: "grossing",
  synoptic: "synoptic",
  tnm: "tnm.latest",
};

// Placeholder for lab-workflow stages that exist in the pipeline but aren't
// built yet (Processing → Sectioning → Staining → Microscopy). Shown for
// visualising the full histology workflow; wired up later.
const TabStub = ({ label }) => (
  <Box sx={{ p: 6, textAlign: "center", border: `1px dashed ${C.border}`, background: C.bgSecondary }}>
    <Typography sx={{ fontSize: 15, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 0.5 }}>{label}</Typography>
    <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>Coming soon.</Typography>
  </Box>
);

const OncoPathologyWorkflow = ({ doctorId, patientId: propPatientId, doctorName }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [patientId, setPatientId] = useState(propPatientId || "");
  const [hospitalId] = useState("");
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  const {
    cases,
    currentCaseId,
    currentCaseData,
    isLoading,
    refetch,
    switchCase,
  } = usePathologyCase(patientId, doctorId);

  useEffect(() => { if (propPatientId) setPatientId(propPatientId); }, [propPatientId]);

  const hasCase = !!currentCaseId;
  const activeKey = MAIN_TABS[activeTab]?.key;
  const activeIsStub = !!MAIN_TABS[activeTab]?.stub;
  // Real tabs (except Case Registry) need an active case; stubs are viewable anytime.
  const gated = activeTab > 0 && !activeIsStub;

  // ─── Save dispatch ────────────────────────────────────────────────────────
  const handleSave = async (tabKey, data) => {
    try {
      if (tabKey === "case-register" && !currentCaseId) {
        // No case yet → create one (backend generates the case_id + makes it active).
        const result = await createCase({
          patient_id: patientId,
          doctor_id: doctorId,
          hospital_id: hospitalId || undefined,
          data,
        });
        await refetch();
        setSnackbar({ open: true, message: "Case created successfully", severity: "success" });
        return result;
      }

      if (!currentCaseId) {
        setSnackbar({ open: true, message: "No active case. Create a case first.", severity: "error" });
        return;
      }

      const sectionPath = SECTION_PATH[tabKey] || tabKey;
      await saveSection(currentCaseId, sectionPath, data);
      await refetch();

      const label = MAIN_TABS.find((t) => t.key === tabKey)?.label || tabKey;
      setSnackbar({ open: true, message: `${label} saved successfully`, severity: "success" });
    } catch (err) {
      console.error("[OncoPathologyWorkflow] save error:", err);
      setSnackbar({ open: true, message: "Failed to save. Please try again.", severity: "error" });
    }
  };

  // ─── Sign out (finalize) the current case ─────────────────────────────────
  const handleSignOut = async () => {
    if (!currentCaseId) return;
    if (!window.confirm("Sign out and finalize this case? It will be marked 'Signed-out' and closed for editing.")) return;
    try {
      await signOutCase(currentCaseId);
      await refetch();
      setSnackbar({ open: true, message: "Case signed out successfully", severity: "success" });
    } catch (err) {
      console.error("[OncoPathologyWorkflow] sign-out error:", err);
      setSnackbar({ open: true, message: "Failed to sign out case.", severity: "error" });
    }
  };

  // ─── Start a new case (auto-close the current one first) ──────────────────
  const handleNewCase = async () => {
    if (currentCaseId) {
      const proceed = window.confirm(
        "Close the current case and start a new one? The current case will be signed out."
      );
      if (!proceed) return;
      try {
        await signOutCase(currentCaseId);
        await refetch();
      } catch (err) {
        console.error("[OncoPathologyWorkflow] auto-close error:", err);
        setSnackbar({ open: true, message: "Could not close the current case.", severity: "error" });
        return;
      }
    }
    // Land on Case Registry with a blank form; saving there creates the new case.
    setActiveTab(0);
    setSnackbar({ open: true, message: "Enter details for the new case, then Save.", severity: "success" });
  };

  const caseRegister = currentCaseData?.case_register || {};
  const grossing = currentCaseData?.grossing || {};
  const synoptic = currentCaseData?.synoptic || {};
  const tnm = currentCaseData?.tnm?.latest || {};
  const caseStatus = currentCaseData?.status || "";
  const isSignedOut = caseStatus === "Signed-out";

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Box sx={{ background: C.bgPrimary, border: `1px solid ${C.border}`, fontFamily: FONT }}>

        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2.5, py: 2, background: C.bgSecondary, borderBottom: `1px solid ${C.borderStrong}`, flexWrap: "wrap", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Box sx={{ width: 44, height: 44, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <BiotechRounded sx={{ fontSize: 24, color: C.white }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: C.textMuted, fontFamily: FONT, mb: 0.25 }}>Onco-Pathology</Typography>
              <Typography sx={{ fontSize: 20, fontWeight: FW_LIGHT, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.02em" }}>Pathology Record</Typography>
            </Box>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            {caseRegister.accession_id && (
              <Box sx={{ px: 1.5, py: 0.5, border: `1px solid ${C.border}`, background: C.white, fontSize: 11, fontFamily: FONT, color: C.textMuted }}>
                {caseRegister.accession_id}
              </Box>
            )}
            {currentCaseId && caseStatus && (
              <Box sx={{
                px: 1.5, py: 0.5, fontSize: 11, fontFamily: FONT, letterSpacing: "0.05em",
                border: `1px solid ${isSignedOut ? C.black : C.border}`,
                background: isSignedOut ? C.black : C.white,
                color: isSignedOut ? C.white : C.textSecond,
              }}>
                {caseStatus}
              </Box>
            )}
            {currentCaseId && !isSignedOut && (
              <Button
                onClick={handleSignOut}
                sx={{
                  px: 2, py: 0.75, fontSize: 12, fontFamily: FONT, fontWeight: FW_NORMAL,
                  background: C.white, color: C.black, border: `1px solid ${C.black}`,
                  textTransform: "none", borderRadius: 0,
                  "&:hover": { background: C.black, color: C.white },
                }}
              >
                Sign Out Report
              </Button>
            )}
            <Button
              onClick={handleNewCase}
              sx={{
                px: 2, py: 0.75, fontSize: 12, fontFamily: FONT, fontWeight: FW_NORMAL,
                background: C.black, color: C.white, border: `1px solid ${C.black}`,
                textTransform: "none", borderRadius: 0,
                "&:hover": { background: "#222" },
              }}
            >
              New Case
            </Button>
          </Box>
        </Box>

        {/* History Table */}
        {patientId && (
          <Box sx={{ px: 2.5, pt: 2.5 }}>
            <PathologyHistoryAccordion
              cases={cases}
              currentCaseId={currentCaseId}
              switchCase={switchCase}
            />
          </Box>
        )}

        {/* Layout: Sub-sidebar + Content */}
        <Box sx={{ display: "flex", minHeight: "65vh" }}>
          <Box sx={{ width: 240, borderRight: `1px solid ${C.border}`, background: C.bgSecondary, flexShrink: 0 }}>
            {MAIN_TABS.map((tab, i) => (
              <Box key={tab.key} onClick={() => setActiveTab(i)}
                sx={{
                  px: 2.5, py: 1.75, borderBottom: `1px solid ${C.border}`,
                  borderLeft: activeTab === i ? `3px solid ${C.black}` : "3px solid transparent",
                  background: activeTab === i ? C.black : "transparent", cursor: "pointer", transition: "all 0.15s",
                  "&:hover": { background: activeTab === i ? C.black : C.white },
                }}>
                <Typography sx={{ fontSize: 13, fontFamily: FONT, color: activeTab === i ? C.white : C.textSecond, fontWeight: activeTab === i ? FW_NORMAL : FW_LIGHT }}>{tab.label}</Typography>
              </Box>
            ))}
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1, p: 3, overflowX: "auto", overflowY: "auto", maxHeight: "80vh", position: "relative" }}>
            {/* Loading / No-case overlays for tabs that require an existing case (all except Case Registry and stubs) */}
            {gated && isLoading && (
              <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
                <Box sx={{ background: C.white, p: "32px 48px", borderRadius: 1, boxShadow: "0 10px 30px rgba(0,0,0,0.1)", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 1.5 }}>Loading Case...</Typography>
                  <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textSecond }}>Please wait while we fetch the details.</Typography>
                </Box>
              </Box>
            )}
            {gated && !isLoading && !hasCase && (
              <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
                <Box sx={{ background: C.white, p: "32px 48px", borderRadius: 1, boxShadow: "0 10px 30px rgba(0,0,0,0.1)", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 1.5 }}>No Active Case</Typography>
                  <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textSecond, mb: 3 }}>Please create a case in the Case Registry first.</Typography>
                  <Button onClick={() => setActiveTab(0)} sx={{ px: 3, py: 1.2, background: C.black, color: C.white, fontFamily: FONT, fontSize: 13, borderRadius: 1, textTransform: "none", "&:hover": { background: "#222" } }}>
                    Go to Case Registry
                  </Button>
                </Box>
              </Box>
            )}

            <Box sx={{
              filter: (gated && (isLoading || !hasCase)) ? "blur(3px)" : "none",
              pointerEvents: (gated && (isLoading || !hasCase)) ? "none" : "auto",
            }}>
              {activeKey === "case-register" && (
                <CaseRegistryTab
                  key={`case-register-${currentCaseId || "new"}`}
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  hospitalId={hospitalId}
                  caseId={currentCaseId}
                  initialData={caseRegister}
                  onSave={handleSave}
                />
              )}
              {activeKey === "grossing" && (
                <GrossingBenchTab
                  key={`grossing-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  initialData={grossing}
                  onSave={handleSave}
                />
              )}
              {activeKey === "synoptic" && (
                <SynopticReportTab
                  key={`synoptic-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  initialData={synoptic}
                  grossingData={grossing}
                  onSave={handleSave}
                />
              )}
              {activeKey === "tnm" && (
                <TNMStagingTab
                  key={`tnm-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  initialData={tnm}
                  synopticData={synoptic}
                  grossingData={grossing}
                  onSave={handleSave}
                />
              )}
              {activeIsStub && <TabStub label={MAIN_TABS[activeTab].label} />}
            </Box>
          </Box>
        </Box>
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={4000}
        onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        sx={{ top: { xs: "40%" } }}>
        <Box sx={{ background: C.black, color: C.white, px: 3, py: 1.5, display: "flex", alignItems: "center", gap: 2, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", minWidth: 300, justifyContent: "space-between", border: `1px solid ${C.borderStrong}` }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT, letterSpacing: "0.05em" }}>{snackbar.message}</Typography>
          <IconButton size="small" onClick={() => setSnackbar((p) => ({ ...p, open: false }))} sx={{ color: C.white, p: 0.5 }}><CloseRounded fontSize="small" /></IconButton>
        </Box>
      </Snackbar>
    </motion.div>
  );
};

export default OncoPathologyWorkflow;
