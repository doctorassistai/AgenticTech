// Microbiology workflow module — sidebar shell + save dispatch + sign-out.
//
// The plan numbers tabs 1–5 then jumps to 8–14 because Tabs 6/7 were folded into
// Tab 5 (Culture Workup) as sub-sections 5A/5B/5C. The sidebar therefore shows
// 12 cleanly-named entries; each maps to a backend section key. All are
// implemented: Registration, Specimen Processing, Direct Examination, Culture
// Setup, Culture Workup 5A/5B/5C, Molecular/NAAT, Serology & Antigen,
// Mycobacteriology/AFB, Preliminary history viewer, Clinical Interpretation,
// Infection Control & AMR, and Final Sign-out.
//
// Persistence model: one MongoDB document per microbiology case, keyed by a
// server-generated case_id. Registration creates the case (case_register is the
// initial document); every other tab later writes its own section through the
// whitelisted section-save endpoint.
//
// Case-type activation: Registration declares a case type (Bacteriology vs
// Serology vs NAAT vs Mycobacteriology vs Parasitology vs Mycology vs Virology
// vs Anaerobic vs Combined) and it gates the sidebar. The four analytical track
// entries — Culture Setup, Culture Workup, Molecular/NAAT, Serology & Antigen,
// Mycobacteriology/AFB — appear only when that case type actually offers a test
// belonging to the track (see activeTracksFor in constants.js). The generic
// bench and workflow entries (Registration, Specimen Processing, Direct
// Examination, Preliminary, Interpretation, Infection Control, Final Sign-out)
// stay visible for every case.

import React, { useEffect, useState } from "react";
import {
  Box, Typography, IconButton, Snackbar, Button,
  Dialog, DialogTitle, DialogContent, DialogActions, CircularProgress,
} from "@mui/material";
import {
  ScienceRounded, CloseRounded, WarningAmberRounded, LockRounded,
} from "@mui/icons-material";
import { motion } from "framer-motion";

import { C, FONT, FW_LIGHT, FW_NORMAL, outlineBtnSx } from "../shared/designTokens";
import { activeTracksFor, suppressedTabsFor } from "./constants";
import { useMicrobiologyCase } from "./shared/useMicrobiologyCase";
import { createCase, saveSection, signOutCase } from "./shared/api";

const AMBER = "#b76e00";
import TabPlaceholder from "./TabPlaceholder";
import RegistrationTab from "./tabs/RegistrationTab";
import SpecimenProcessingTab from "./tabs/SpecimenProcessingTab";
import DirectExamTab from "./tabs/DirectExamTab";
import CultureSetupTab from "./tabs/CultureSetupTab";
import CultureWorkupTab from "./tabs/CultureWorkupTab";
import MolecularTab from "./tabs/MolecularTab";
import SerologyTab from "./tabs/SerologyTab";
import MycobacteriologyTab from "./tabs/MycobacteriologyTab";
import PathogenGenomicsTab from "./tabs/PathogenGenomicsTab";
import HumanGenomicsTab from "./tabs/HumanGenomicsTab";
import PreliminaryTab from "./tabs/PreliminaryTab";
import InterpretationTab from "./tabs/InterpretationTab";
import InfectionControlTab from "./tabs/InfectionControlTab";
import FinalSignoutTab from "./tabs/FinalSignoutTab";

// Sidebar order follows the plan's physical tab order. `section` is the backend
// section key from the plan's "Sections" table. `track` marks the entries gated
// by case type — an entry with no `track` is always offered.
const MAIN_TABS = [
  { key: "registration", label: "Registration & Accession", section: "case_register" },
  { key: "processing", label: "Specimen Processing & Triage", section: "specimen_processing" },
  { key: "direct-exam", label: "Direct Examination", section: "direct_examination" },
  { key: "culture-setup", label: "Culture Setup", section: "culture_setup", track: "culture" },
  { key: "culture-workup", label: "Culture Workup", section: "culture_workup", track: "culture" },
  { key: "molecular", label: "Molecular / NAAT", section: "molecular", track: "molecular" },
  { key: "serology", label: "Serology & Antigen", section: "serology", track: "serology" },
  { key: "mycobacteriology", label: "Mycobacteriology / AFB", section: "mycobacteriology", track: "mycobacteriology" },
  // The two genomics tracks sit together at the end of the analytical entries.
  // They share the module and the case document but not a data model: pathogen
  // genomics is keyed by specimen_id, human genomics is a lifelong property of
  // the patient read as a patient-level register.
  { key: "pathogen-genomics", label: "Pathogen Genomics", section: "pathogen_genomics", track: "pathogen_genomics" },
  { key: "human-genomics", label: "Human Genomics (PGx)", section: "human_genomics", track: "human_genomics" },
  { key: "preliminary", label: "Preliminary & Interim Reporting", section: "preliminary_reports" },
  { key: "interpretation", label: "Clinical Interpretation", section: "interpretation" },
  { key: "infection-control", label: "Infection Control & AMR Flags", section: "infection_control" },
  { key: "final-signout", label: "Final Sign-out", section: "final_report" },
];

const NoCaseGate = ({ label, onGoRegistration }) => (
  <Box sx={{ py: 10, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
    <Typography sx={{ fontSize: 18, fontWeight: FW_LIGHT, fontFamily: FONT, color: C.textSecond }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>
      Register a case first to activate the downstream tabs.
    </Typography>
    <Button onClick={onGoRegistration} sx={outlineBtnSx}>Go to Registration</Button>
  </Box>
);

const MicrobiologyWorkflow = ({ doctorId, patientId, doctorName }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [newCaseMode, setNewCaseMode] = useState(false);
  const [forceNewCaseOpen, setForceNewCaseOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);

  const { cases, currentCaseId, currentCaseData, isLoading, refetch } = useMicrobiologyCase(patientId, doctorId);

  const hasCase = !newCaseMode && !!currentCaseId;
  const caseRegister = newCaseMode ? {} : (currentCaseData?.case_register || {});

  // Case type decides which analytical tracks the sidebar offers. With no case
  // (or an unset/Combined type) activeTracksFor activates all four, so a fresh
  // record still shows the full sidebar.
  const tracks = activeTracksFor(caseRegister.case_type);
  // A pre-emptive PGx case doesn't need the infection-management entries. The
  // track entries stay derived from the ordered-test catalogue; only the
  // always-on entries are suppressed (see SUPPRESSED_SIDEBAR in constants.js).
  const suppressed = suppressedTabsFor(caseRegister.case_type);
  const visibleTabs = MAIN_TABS.filter(
    (t) => (!t.track || tracks[t.track]) && !suppressed.includes(t.key)
  );
  const active = visibleTabs[activeTab] || visibleTabs[0];

  // A case-type change can shorten the sidebar under the current selection; keep
  // the focus in range. Index 0 is Registration, which is never gated.
  useEffect(() => {
    if (activeTab >= visibleTabs.length) setActiveTab(0);
  }, [visibleTabs.length, activeTab]);

  const specimenProcessing = currentCaseData?.specimen_processing || {};
  const directExamination = currentCaseData?.direct_examination || {};
  const cultureSetup = currentCaseData?.culture_setup || {};
  const cultureWorkup = currentCaseData?.culture_workup || {};
  const molecular = currentCaseData?.molecular || {};
  const serology = currentCaseData?.serology || {};
  const mycobacteriology = currentCaseData?.mycobacteriology || {};
  const pathogenGenomics = currentCaseData?.pathogen_genomics || {};
  const humanGenomics = currentCaseData?.human_genomics || {};
  const interpretation = currentCaseData?.interpretation || {};
  const infectionControl = currentCaseData?.infection_control || {};
  const finalReport = currentCaseData?.final_report || {};
  const preliminaryReports = currentCaseData?.preliminary_reports || {};
  const caseStatus = currentCaseData?.status || "";
  const isSignedOut = caseStatus === "Signed-out";
  const signedOutAt = currentCaseData?.signed_out_at || "";

  const showSnackbar = (message, severity = "success") =>
    setSnackbar({ open: true, message, severity });

  // ─── Sign-out (Tab 14) ─────────────────────────────────────────────────────
  const handleSignOut = async () => {
    if (!currentCaseId) return;
    try {
      await signOutCase(currentCaseId, { by: doctorName || doctorId });
      await refetch();
      showSnackbar("Case signed out and locked");
      setActiveTab(0); // registration — the signed-out case is no longer editable
    } catch (err) {
      console.error("[MicrobiologyWorkflow] sign-out error:", err);
      showSnackbar("Sign-out failed — see blockers.", "error");
    }
  };

  // ─── Start a new case ─────────────────────────────────────────────────────
  const startNewCase = (signedOutCurrent = false) => {
    setNewCaseMode(true);
    setActiveTab(0);
    showSnackbar(
      signedOutCurrent
        ? "Current case signed out. Enter details for the new case, then Save."
        : (currentCaseId
          ? "The current case remains unchanged. Save Registration details to create a separate case."
          : "Enter details for the new case, then Save."),
      "success"
    );
  };

  // An open case that is not yet signed out gates a new case. The warning dialog
  // offers to force sign-out the current case right here (blockers bypassed,
  // recorded as forced on the document), so a fresh registration can begin.
  const handleNewCase = () => {
    if (currentCaseId && !isSignedOut) {
      setForceNewCaseOpen(true);
      return;
    }
    startNewCase();
  };

  const confirmForceNewCase = async () => {
    if (!currentCaseId) {
      setForceNewCaseOpen(false);
      startNewCase();
      return;
    }
    setSignOutBusy(true);
    try {
      await signOutCase(currentCaseId, { force: true, by: doctorName || doctorId });
      await refetch();
      setForceNewCaseOpen(false);
      startNewCase(true);
    } catch (err) {
      console.error("[MicrobiologyWorkflow] force sign-out error:", err);
      showSnackbar("Failed to sign out the current case. Please try again.", "error");
    } finally {
      setSignOutBusy(false);
    }
  };

  // ─── Save dispatch ────────────────────────────────────────────────────────
  const handleSave = async (tabKey, data) => {
    try {
      if (tabKey === "registration" && (!hasCase || newCaseMode)) {
        // No case yet or starting new case → create one (backend generates the case_id + makes it active).
        const result = await createCase({
          patient_id: patientId,
          doctor_id: doctorId,
          data,
        });
        await refetch();
        setNewCaseMode(false);
        showSnackbar("Case created successfully");
        return result;
      }

      if (!hasCase) {
        showSnackbar("No active case. Register a case first.", "error");
        return;
      }

      const sectionPath = MAIN_TABS.find((t) => t.key === tabKey)?.section || tabKey;
      await saveSection(currentCaseId, sectionPath, data);
      await refetch();

      const label = MAIN_TABS.find((t) => t.key === tabKey)?.label || tabKey;
      showSnackbar(`${label} saved successfully`);
    } catch (err) {
      console.error("[MicrobiologyWorkflow] save error:", err);
      showSnackbar("Failed to save. Please try again.", "error");
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Box sx={{ background: C.bgPrimary, border: `1px solid ${C.border}`, fontFamily: FONT }}>
        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2.5, py: 2, background: C.bgSecondary, borderBottom: `1px solid ${C.borderStrong}`, flexWrap: "wrap", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Box sx={{ width: 44, height: 44, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <ScienceRounded sx={{ fontSize: 24, color: C.white }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: C.textMuted, fontFamily: FONT, mb: 0.25 }}>Microbiology</Typography>
              <Typography sx={{ fontSize: 20, fontWeight: FW_LIGHT, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.02em" }}>Microbiology Record</Typography>
            </Box>
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
            {currentCaseId && !newCaseMode && caseStatus && (
              <Box sx={{
                px: 1.5, py: 0.5, fontSize: 11, fontFamily: FONT, letterSpacing: "0.05em",
                border: `1px solid ${isSignedOut ? C.black : C.border}`,
                background: isSignedOut ? C.black : C.white,
                color: isSignedOut ? C.white : C.textSecond,
              }}>
                {caseStatus}
              </Box>
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

        {/* Layout: Sidebar + Content */}
        <Box sx={{ display: "flex", minHeight: "65vh" }}>
          <Box sx={{ width: 240, borderRight: `1px solid ${C.border}`, background: C.bgSecondary, flexShrink: 0 }}>
            {visibleTabs.map((tab, i) => (
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
            {isLoading && (
              <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
                <Box sx={{ background: C.white, p: "32px 48px", borderRadius: 1, boxShadow: "0 10px 30px rgba(0,0,0,0.1)", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 1.5 }}>Loading Case...</Typography>
                </Box>
              </Box>
            )}

            <Box sx={{ filter: isLoading ? "blur(3px)" : "none", pointerEvents: isLoading ? "none" : "auto" }}>
              {active.key === "registration" && (
                <RegistrationTab
                  key={`registration-${currentCaseId || "new"}-${newCaseMode ? "new-mode" : "current"}`}
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  caseId={newCaseMode ? "" : currentCaseId}
                  initialData={caseRegister}
                  cases={cases}
                  casesLoading={isLoading}
                  onSave={handleSave}
                />
              )}
              {active.key === "processing" && (
                hasCase ? (
                  <SpecimenProcessingTab
                    key={`processing-${currentCaseId || "none"}`}
                    caseId={currentCaseId}
                    initialData={specimenProcessing}
                    caseRegister={caseRegister}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "direct-exam" && (
                hasCase ? (
                  <DirectExamTab
                    key={`direct-exam-${currentCaseId || "none"}`}
                    patientId={patientId}
                    doctorId={doctorId}
                    doctorName={doctorName}
                    caseId={currentCaseId}
                    initialData={directExamination}
                    preliminaryReports={preliminaryReports}
                    caseRegister={caseRegister}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "culture-setup" && (
                hasCase ? (
                  <CultureSetupTab
                    key={`culture-setup-${currentCaseId || "none"}`}
                    caseId={currentCaseId}
                    initialData={cultureSetup}
                    caseRegister={caseRegister}
                    processingData={specimenProcessing}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "culture-workup" && (
                hasCase ? (
                  <CultureWorkupTab
                    key={`culture-workup-${currentCaseId || "none"}`}
                    doctorId={doctorId}
                    doctorName={doctorName}
                    caseId={currentCaseId}
                    initialData={cultureWorkup}
                    preliminaryReports={preliminaryReports}
                    cultureSetup={cultureSetup}
                    caseRegister={caseRegister}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "molecular" && (
                hasCase ? (
                  <MolecularTab
                    key={`molecular-${currentCaseId || "none"}`}
                    doctorId={doctorId}
                    doctorName={doctorName}
                    caseId={currentCaseId}
                    initialData={molecular}
                    preliminaryReports={preliminaryReports}
                    caseRegister={caseRegister}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "serology" && (
                hasCase ? (
                  <SerologyTab
                    key={`serology-${currentCaseId || "none"}`}
                    doctorId={doctorId}
                    doctorName={doctorName}
                    caseId={currentCaseId}
                    initialData={serology}
                    preliminaryReports={preliminaryReports}
                    caseRegister={caseRegister}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "mycobacteriology" && (
                hasCase ? (
                  <MycobacteriologyTab
                    key={`mycobacteriology-${currentCaseId || "none"}`}
                    doctorId={doctorId}
                    doctorName={doctorName}
                    caseId={currentCaseId}
                    initialData={mycobacteriology}
                    directExamData={directExamination}
                    preliminaryReports={preliminaryReports}
                    caseRegister={caseRegister}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "pathogen-genomics" && (
                hasCase ? (
                  <PathogenGenomicsTab
                    key={`pathogen-genomics-${currentCaseId || "none"}`}
                    doctorId={doctorId}
                    doctorName={doctorName}
                    caseId={currentCaseId}
                    initialData={pathogenGenomics}
                    preliminaryReports={preliminaryReports}
                    caseRegister={caseRegister}
                    molecular={molecular}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "human-genomics" && (
                hasCase ? (
                  <HumanGenomicsTab
                    key={`human-genomics-${currentCaseId || "none"}`}
                    caseId={currentCaseId}
                    initialData={humanGenomics}
                    caseRegister={caseRegister}
                    cases={cases}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "preliminary" && (
                hasCase ? (
                  <PreliminaryTab
                    key={`preliminary-${currentCaseId || "none"}`}
                    caseRegister={caseRegister}
                    cultureSetup={cultureSetup}
                    cultureWorkup={cultureWorkup}
                    molecular={molecular}
                    serology={serology}
                    mycobacteriology={mycobacteriology}
                    pathogenGenomics={pathogenGenomics}
                    humanGenomics={humanGenomics}
                    preliminaryReports={preliminaryReports}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "interpretation" && (
                hasCase ? (
                  <InterpretationTab
                    key={`interpretation-${currentCaseId || "none"}`}
                    doctorId={doctorId}
                    doctorName={doctorName}
                    caseId={currentCaseId}
                    initialData={interpretation}
                    caseRegister={caseRegister}
                    directExamination={directExamination}
                    cultureWorkup={cultureWorkup}
                    molecular={molecular}
                    serology={serology}
                    mycobacteriology={mycobacteriology}
                    pathogenGenomics={pathogenGenomics}
                    preliminaryReports={preliminaryReports}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "infection-control" && (
                hasCase ? (
                  <InfectionControlTab
                    key={`infection-control-${currentCaseId || "none"}`}
                    caseId={currentCaseId}
                    initialData={infectionControl}
                    caseRegister={caseRegister}
                    cultureWorkup={cultureWorkup}
                    molecular={molecular}
                    serology={serology}
                    mycobacteriology={mycobacteriology}
                    directExamination={directExamination}
                    pathogenGenomics={pathogenGenomics}
                    onSave={handleSave}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key === "final-signout" && (
                hasCase ? (
                  <FinalSignoutTab
                    key={`final-signout-${currentCaseId || "none"}`}
                    doctorId={doctorId}
                    doctorName={doctorName}
                    caseId={currentCaseId}
                    isSignedOut={isSignedOut}
                    signedOutAt={signedOutAt}
                    initialData={finalReport}
                    caseRegister={caseRegister}
                    directExamination={directExamination}
                    cultureWorkup={cultureWorkup}
                    molecular={molecular}
                    serology={serology}
                    mycobacteriology={mycobacteriology}
                    pathogenGenomics={pathogenGenomics}
                    humanGenomics={humanGenomics}
                    cases={cases}
                    preliminaryReports={preliminaryReports}
                    interpretation={interpretation}
                    infectionControl={infectionControl}
                    onSave={handleSave}
                    onSignOut={handleSignOut}
                  />
                ) : (
                  <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
                )
              )}
              {active.key !== "registration" && active.key !== "processing" && active.key !== "direct-exam" && active.key !== "culture-setup" && active.key !== "culture-workup" && active.key !== "molecular" && active.key !== "serology" && active.key !== "mycobacteriology" && active.key !== "pathogen-genomics" && active.key !== "human-genomics" && active.key !== "preliminary" && active.key !== "interpretation" && active.key !== "infection-control" && active.key !== "final-signout" && (
                hasCase
                  ? <TabPlaceholder title={active.label} />
                  : <NoCaseGate label={active.label} onGoRegistration={() => setActiveTab(0)} />
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={4000}
        onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}>
        <Box sx={{ background: C.black, color: C.white, px: 3, py: 1.5, display: "flex", alignItems: "center", gap: 2, boxShadow: "0 8px 24px rgba(0,0,0,0.3)", minWidth: 300, justifyContent: "space-between", border: `1px solid ${C.borderStrong}` }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT, letterSpacing: "0.05em" }}>{snackbar.message}</Typography>
          <IconButton size="small" onClick={() => setSnackbar((p) => ({ ...p, open: false }))} sx={{ color: C.white, p: 0.5 }}><CloseRounded fontSize="small" /></IconButton>
        </Box>
      </Snackbar>

      <Dialog open={forceNewCaseOpen} onClose={() => { if (!signOutBusy) setForceNewCaseOpen(false); }} maxWidth="sm" fullWidth>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>Start New Case</Typography>
          <IconButton onClick={() => setForceNewCaseOpen(false)} size="small" disabled={signOutBusy}><CloseRounded /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 2.5, "&:first-of-type": { pt: 3 }, fontFamily: FONT }}>
          <Typography sx={{ display: "flex", alignItems: "center", gap: 1, fontSize: 13, fontWeight: FW_NORMAL, fontFamily: FONT, color: AMBER, mb: 1.25 }}>
            <WarningAmberRounded sx={{ fontSize: 20, flexShrink: 0 }} />
            The current case is not signed out.
          </Typography>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, mb: 1.5 }}>
            {caseRegister?.case_type ? `${caseRegister.case_type} case` : (currentCaseId ? `Case ${currentCaseId}` : "Current case")} · Status: {caseStatus || "Registered"}
          </Typography>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>
            A new case cannot be opened until the current case is signed out. Signing out now bypasses the usual
            completeness checks and records this case as signed out (with the action noted as forced), so a new case
            can be started. The current case stays available in the patient's previous microbiology cases.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: `1px solid ${C.border}`, background: C.bgSecondary }}>
          <Button sx={outlineBtnSx} onClick={() => setForceNewCaseOpen(false)} disabled={signOutBusy}>
            Cancel
          </Button>
          <Button
            sx={{
              ...outlineBtnSx,
              px: 2, py: 0.75, background: C.black, color: C.white,
              border: `1px solid ${C.black}`,
              "&:hover": { background: "#222" },
            }}
            onClick={confirmForceNewCase}
            disabled={signOutBusy}
          >
            {signOutBusy
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} />
              : <LockRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            Sign Out &amp; New Case
          </Button>
        </DialogActions>
      </Dialog>
    </motion.div>
  );
};

export default MicrobiologyWorkflow;
