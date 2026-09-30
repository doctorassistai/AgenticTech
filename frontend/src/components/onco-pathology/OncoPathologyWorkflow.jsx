
// Holds the specimen-in-the-lab pathology lifecycle. The sidebar follows the
// bench and the microscope: the histology bench (Grossing → Staining), Primary
// Microscopy, then the review/testing stage (Ancillary Work, Microscopy Review,
// Molecular Testing, Cytopathology), then synthesis (Integrated Diagnosis →
// Synoptic → TNM → Final Diagnosis).
//
// Molecular deliberately does NOT return to the microscope: it is DNA/RNA with no
// slide. Cytopathology is cells on a slide and keeps its own specimen stream. Both
// converge in Integrated Diagnosis, which is where every stream reaches the final
// report. One document per case (case_id); sections are written through the
// whitelisted saveSection endpoint.

import React, { useState, useEffect } from "react";
import { Box, Typography, Button, Snackbar, IconButton, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle } from "@mui/material";
import { BiotechRounded, CloseRounded, WarningAmberRounded, LockRounded } from "@mui/icons-material";
import { motion } from "framer-motion";

import { C, FONT, FW_LIGHT, FW_NORMAL, FW_BOLD, outlineBtnSx } from "../shared/designTokens";
import { usePathologyCase } from "./shared/usePathologyCase";
import { createCase, saveSection, signOutCase, getPathologyRequest } from "./shared/api";
import { EMPTY_CASE_REGISTRY, pathologyRequestToCaseRegistry } from "./shared/caseRegistryModel";
import { tabApplicability } from "./shared/caseClass";
import CaseRegistryTab from "./tabs/CaseRegistryTab";
import GrossingBenchTab from "./tabs/GrossingBenchTab";
import ProcessingTab from "./tabs/ProcessingTab";
import SectioningTab from "./tabs/SectioningTab";
import StainingTab from "./tabs/StainingTab";
import MolecularTestingTab from "./tabs/MolecularTestingTab";
import CytopathologyTab from "./tabs/CytopathologyTab";
import MicroscopyTab from "./tabs/MicroscopyTab";
import IntegratedDiagnosisTab from "./tabs/IntegratedDiagnosisTab";
import SynopticReportTab from "./tabs/SynopticReportTab";
import TNMStagingTab from "./tabs/TNMStagingTab";
import FinalDiagnosisTab from "./tabs/FinalDiagnosisTab";

const AMBER = "#b76e00";

const MAIN_TABS = [
  { key: "case-register", label: "Case Registry", part: "Path A" },
  { key: "grossing", label: "Grossing Bench", part: "Path B" },
  { key: "processing", label: "Processing & Embedding", part: "Path C" },
  { key: "sectioning", label: "Sectioning", part: "Path D" },
  { key: "staining", label: "Staining", part: "Path E" },
  { key: "primary-micro", label: "Primary Microscopy", part: "Path F" },
  { key: "ancillary-work", label: "Ancillary Work", part: "Path G" },
  { key: "micro-review", label: "Microscopy Review", part: "Path H" },
  { key: "molecular", label: "Molecular Testing", part: "Path I" },
  { key: "cytopathology", label: "Cytopathology", part: "Path J" },
  { key: "integration", label: "Integrated Diagnosis", part: "Path K" },
  { key: "synoptic", label: "Synoptic Report", part: "Path L" },
  { key: "tnm", label: "TNM Staging", part: "Path M" },
  { key: "final-diagnosis", label: "Final Diagnosis", part: "Path N" },
];

// Visual boxed stage groupings for the sidebar
const SIDEBAR_STAGE_GROUPS = [
  {
    title: "1 · Specimen & Bench",
    tabIndices: [0, 1, 2, 3, 4],
  },
  {
    title: "2 · Diagnostic Work",
    tabIndices: [5, 6, 7, 8, 9],
  },
  {
    title: "3 · Synthesis & Sign-Out",
    tabIndices: [10, 11, 12, 13],
  },
];

// Sidebar-tab key → backend section path (case_register uses underscore).
const SECTION_PATH = {
  "case-register": "case_register",
  grossing: "grossing",
  processing: "processing",
  sectioning: "sectioning",
  staining: "staining",
  molecular: "molecular",
  cytopathology: "cytopathology",
  "primary-micro": "microscopy",
  "ancillary-work": "microscopy",
  "micro-review": "microscopy",
  integration: "integration",
  synoptic: "synoptic",
  tnm: "tnm.latest",
  "final-diagnosis": "final_diagnosis",
};

const OncoPathologyWorkflow = ({ doctorId, patientId: propPatientId, doctorName, pathologyRequestId }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [patientId, setPatientId] = useState(propPatientId || "");
  const [hospitalId] = useState("");
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [pathologyRequest, setPathologyRequest] = useState(null);
  const [requestLoading, setRequestLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [newCaseMode, setNewCaseMode] = useState(false);
  // A "New Case" on an open case that is not yet signed out is gated: it opens a
  // warning dialog offering a forced sign-out of the current case first.
  const [forceNewCaseOpen, setForceNewCaseOpen] = useState(false);
  const [signOutBusy, setSignOutBusy] = useState(false);
  // Cytopathology needs a liquid/aspirate specimen, and only Case Registry mints a
  // specimen_id. Rather than dead-ending, it asks the workflow to open Case
  // Registry with a specimen of that type already started.
  const [seedSpecimenType, setSeedSpecimenType] = useState("");
  const goToAccessioning = (specimenType) => {
    setSeedSpecimenType(specimenType || "");
    setActiveTab(0);
  };
  // A "New Case" started while a pathology request is loaded is detached from
  // that request: the created case must not consume it, and the request stays
  // pending in the requests table.
  const [unlinkRequest, setUnlinkRequest] = useState(false);

  const {
    cases,
    currentCaseId,
    currentCaseData,
    isLoading,
    refetch,
  } = usePathologyCase(patientId, doctorId);

  useEffect(() => { if (propPatientId) setPatientId(propPatientId); }, [propPatientId]);

  useEffect(() => {
    if (!pathologyRequestId) {
      setPathologyRequest(null);
      setRequestError("");
      return;
    }
    let cancelled = false;
    setRequestLoading(true);
    getPathologyRequest(pathologyRequestId)
      .then((result) => {
        if (cancelled) return;
        const request = result.request || null;
        setPathologyRequest(request);
        if (request?.patient_id) setPatientId(request.patient_id);
        setRequestError("");
      })
      .catch((err) => { if (!cancelled) setRequestError(err.message || "Unable to load pathology request"); })
      .finally(() => { if (!cancelled) setRequestLoading(false); });
    return () => { cancelled = true; };
  }, [pathologyRequestId]);
  useEffect(() => { if (pathologyRequestId) setActiveTab(0); }, [pathologyRequestId]);

  const hasCase = !!currentCaseId;
  const activeRequestCase = pathologyRequest?.active_case || null;
  const requestDraft = pathologyRequest ? pathologyRequestToCaseRegistry(pathologyRequest, patientId) : null;
  const requestBlockedByActiveCase = !!pathologyRequestId && !!activeRequestCase;
  const activeKey = MAIN_TABS[activeTab]?.key;
  const activeIsStub = !!MAIN_TABS[activeTab]?.stub;
  // Real tabs (except Case Registry) need an active case; stubs are viewable anytime.
  const gated = activeTab > 0 && !activeIsStub;

  // ─── Save dispatch ────────────────────────────────────────────────────────
  const handleSave = async (tabKey, data) => {
    try {
      if (tabKey === "case-register" && !unlinkRequest && pathologyRequestId && requestBlockedByActiveCase) {
        setSnackbar({ open: true, message: "An active pathology case already exists for this patient. Continue that case instead.", severity: "error" });
        return;
      }
      if (tabKey === "case-register" && (!currentCaseId || pathologyRequestId || newCaseMode)) {
        // No case yet → create one (backend generates the case_id + makes it active).
        const result = await createCase({
          patient_id: patientId,
          doctor_id: doctorId,
          hospital_id: hospitalId || undefined,
          data,
          // A detached new case omits the request link so it never consumes the
          // request (JSON.stringify drops undefined, so the key is simply absent).
          pathology_request_id: unlinkRequest ? undefined : (pathologyRequestId || undefined),
        });
        await refetch();
        setNewCaseMode(false);
        setUnlinkRequest(false);
        if (!unlinkRequest && pathologyRequestId) window.dispatchEvent(new CustomEvent("pathologyRequestChanged", { detail: { requestId: pathologyRequestId } }));
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
  const handleSignOut = async (finalData) => {
    if (!currentCaseId) return;
    try {
      await saveSection(currentCaseId, "final_diagnosis", finalData);
      await signOutCase(currentCaseId);
      await refetch();
      setSnackbar({ open: true, message: "Case signed out successfully", severity: "success" });
    } catch (err) {
      console.error("[OncoPathologyWorkflow] sign-out error:", err);
      setSnackbar({ open: true, message: "Failed to sign out case.", severity: "error" });
    }
  };

  // ─── Start a new case without changing or finalizing the current one ─────
  const startNewCase = (signedOutCurrent = false) => {
    setNewCaseMode(true);
    setUnlinkRequest(!!pathologyRequestId);
    setActiveTab(0);
    setSnackbar({
      open: true,
      message: signedOutCurrent
        ? "Current case signed out. Enter details for the new case, then Save."
        : (currentCaseId
          ? "The current case remains unchanged. Save Case Registry details to create a separate case."
          : "Enter details for the new case, then Save."),
      severity: "success",
    });
  };

  // An open case that is not yet signed out gates a new case. Rather than send
  // the user through Final Diagnosis, the warning dialog offers to force sign-out
  // the current case right here (completeness checks bypassed, recorded as forced).
  const handleNewCase = () => {
    if (currentCaseId && !isSignedOut) {
      setForceNewCaseOpen(true);
      return;
    }
    startNewCase();
  };

  const confirmForceNewCase = async () => {
    if (!currentCaseId) { setForceNewCaseOpen(false); startNewCase(); return; }
    setSignOutBusy(true);
    try {
      await signOutCase(currentCaseId, { force: true, by: doctorName || doctorId });
      await refetch();
      setForceNewCaseOpen(false);
      startNewCase(true);
    } catch (err) {
      console.error("[OncoPathologyWorkflow] force sign-out error:", err);
      setSnackbar({ open: true, message: "Failed to sign out the current case. Please try again.", severity: "error" });
    } finally {
      setSignOutBusy(false);
    }
  };

  const caseRegister = newCaseMode ? EMPTY_CASE_REGISTRY : (requestDraft && !hasCase ? requestDraft : currentCaseData?.case_register || {});
  const accessionId = currentCaseData?.accession_id || "";
  const grossing = currentCaseData?.grossing || {};
  const processing = currentCaseData?.processing || {};
  const sectioning = currentCaseData?.sectioning || {};
  const staining = currentCaseData?.staining || {};
  const molecular = currentCaseData?.molecular || {};
  const cytopathology = currentCaseData?.cytopathology || {};
  const microscopy = currentCaseData?.microscopy || {};
  const integration = currentCaseData?.integration || {};
  const synoptic = currentCaseData?.synoptic || {};
  const tnm = currentCaseData?.tnm?.latest || {};
  const finalDiagnosis = currentCaseData?.final_diagnosis || {};
  const caseStatus = currentCaseData?.status || "";
  const isSignedOut = caseStatus === "Signed-out";

  // Which tabs this case's specimens actually make applicable. A not-applicable
  // tab is marked, never hidden: a mixed case needs all of them, and a
  // pathologist must be able to see why something does not apply.
  const applicability = tabApplicability(caseRegister);
  const notApplicable = {
    cytopathology: hasCase && !applicability.cytopathology.applicable,
    synoptic: hasCase && !applicability.synoptic.applicable,
    tnm: false,
  };

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
            {accessionId && (
              <Box sx={{ px: 1.5, py: 0.5, border: `1px solid ${C.border}`, background: C.white, fontSize: 11, fontFamily: FONT, color: C.textMuted }}>
                {accessionId}
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

        {/* Past pathology cases are listed in Case Registry → Clinical History,
            where View opens them in a read-only dialog instead of loading them
            into this workflow. */}

        {/* Layout: Sub-sidebar + Content */}
        <Box sx={{ display: "flex", minHeight: "65vh" }}>
          <Box sx={{ width: 250, borderRight: `1px solid ${C.border}`, background: C.bgSecondary, flexShrink: 0, p: 1.5, overflowY: "auto" }}>
            {SIDEBAR_STAGE_GROUPS.map((grp, gIdx) => (
              <Box
                key={grp.title}
                sx={{
                  background: C.white,
                  border: `1px solid ${C.border}`,
                  borderRadius: 1,
                  overflow: "hidden",
                  mb: gIdx < SIDEBAR_STAGE_GROUPS.length - 1 ? 1.75 : 0,
                  boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
                }}
              >
                {/* Box Header Bar */}
                <Box
                  sx={{
                    px: 1.75,
                    py: 0.9,
                    background: C.bgTertiary,
                    borderBottom: `1px solid ${C.border}`,
                    userSelect: "none",
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: 10,
                      fontFamily: FONT,
                      fontWeight: FW_BOLD,
                      color: C.textSecond,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    {grp.title}
                  </Typography>
                </Box>

                {/* Tabs inside Box */}
                <Box sx={{ "& > :not(:last-child)": { borderBottom: `1px solid ${C.border}` } }}>
                  {grp.tabIndices.map((i) => {
                    const tab = MAIN_TABS[i];
                    const isActive = activeTab === i;
                    return (
                      <Box
                        key={tab.key}
                        onClick={() => setActiveTab(i)}
                        sx={{
                          px: 1.75,
                          py: 1.25,
                          background: isActive ? C.black : "transparent",
                          cursor: "pointer",
                          transition: "all 0.15s",
                          "&:hover": { background: isActive ? C.black : C.bgSecondary },
                        }}
                      >
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
                          <Typography
                            sx={{
                              fontSize: 12.5,
                              fontFamily: FONT,
                              color: isActive ? C.white : C.textSecond,
                              fontWeight: isActive ? FW_NORMAL : FW_LIGHT,
                            }}
                          >
                            {tab.label}
                          </Typography>
                          {notApplicable[tab.key] && (
                            <Typography
                              sx={{
                                fontSize: 9,
                                fontFamily: FONT,
                                letterSpacing: "0.1em",
                                textTransform: "uppercase",
                                px: 0.6,
                                py: 0.15,
                                border: `1px solid ${isActive ? C.white : C.border}`,
                                color: isActive ? C.white : C.textMuted,
                                borderRadius: 0.5,
                                flexShrink: 0,
                              }}
                            >
                              N/A
                            </Typography>
                          )}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
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

            {pathologyRequestId && requestLoading && (
              <Box sx={{ p: 3, border: `1px solid ${C.border}`, background: C.white, mb: 2 }}>Loading pathology request...</Box>
            )}
            {pathologyRequestId && requestError && (
              <Box sx={{ p: 3, border: `1px solid ${C.borderStrong}`, background: C.white, mb: 2 }}>{requestError}</Box>
            )}
            {requestBlockedByActiveCase && (
              <Box sx={{ p: 2, mb: 2, border: `1px solid ${C.borderStrong}`, background: C.bgSecondary }}>
                <Typography sx={{ fontSize: 13, fontFamily: FONT, mb: 0.5 }}>Active pathology case already exists</Typography>
                <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                  {activeRequestCase.accession_id || activeRequestCase.case_id} · {activeRequestCase.status || "Active"}
                </Typography>
                <Button onClick={() => { window.location.href = `/dashboard?doctor_id=${doctorId}&patient_id=${patientId}`; }} sx={{ mt: 1, ...outlineBtnSx }}>
                  Continue Active Case
                </Button>
              </Box>
            )}
            {pathologyRequestId && pathologyRequest?.related_pending_count > 0 && (
              <Box sx={{ p: 1.5, mb: 2, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
                <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                  Warning: this patient has {pathologyRequest.related_pending_count} other pending pathology request{pathologyRequest.related_pending_count === 1 ? "" : "s"}.
                </Typography>
              </Box>
            )}

            <Box sx={{
              filter: (gated && (isLoading || !hasCase)) ? "blur(3px)" : "none",
              pointerEvents: (gated && (isLoading || !hasCase)) ? "none" : "auto",
            }}>
              {activeKey === "case-register" && (
                <CaseRegistryTab
                  key={`case-register-${currentCaseId || "new"}-${newCaseMode ? "new-mode" : "current"}-${pathologyRequestId || "none"}-${requestLoading ? "loading" : "ready"}`}
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  hospitalId={hospitalId}
                  newCaseMode={newCaseMode}
                  caseId={currentCaseId}
                  accessionId={accessionId}
                  initialData={caseRegister}
                  cases={cases}
                  casesLoading={isLoading}
                  seedSpecimenType={seedSpecimenType}
                  onSeedConsumed={() => setSeedSpecimenType("")}
                  onSave={handleSave}
                />
              )}
              {activeKey === "grossing" && (
                <GrossingBenchTab
                  key={`grossing-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  accessionId={accessionId}
                  initialData={grossing}
                  caseRegister={caseRegister}
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  hospitalId={hospitalId}
                  onSave={handleSave}
                />
              )}
              {activeKey === "processing" && (
                <ProcessingTab
                  key={`processing-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  accessionId={accessionId}
                  initialData={processing}
                  grossing={grossing}
                  cytopathology={cytopathology}
                  caseRegister={caseRegister}
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  hospitalId={hospitalId}
                  onSave={handleSave}
                />
              )}
              {activeKey === "sectioning" && (
                <SectioningTab
                  key={`sectioning-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  accessionId={accessionId}
                  initialData={sectioning}
                  processing={processing}
                  grossing={grossing}
                  microscopy={microscopy}
                  staining={staining}
                  molecular={molecular}
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  hospitalId={hospitalId}
                  onSave={handleSave}
                />
              )}
              {activeKey === "staining" && (
                <StainingTab
                  key={`staining-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  accessionId={accessionId}
                  initialData={staining}
                  sectioning={sectioning}
                  grossing={grossing}
                  microscopy={microscopy}
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  hospitalId={hospitalId}
                  onSave={handleSave}
                />
              )}
              {activeKey === "molecular" && (
                <MolecularTestingTab
                  key={`molecular-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  initialData={molecular}
                  processing={processing}
                  sectioning={sectioning}
                  staining={staining}
                  microscopy={microscopy}
                  grossing={grossing}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  onSave={handleSave}
                />
              )}
              {activeKey === "cytopathology" && (
                <CytopathologyTab
                  key={`cytopathology-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  initialData={cytopathology}
                  caseRegister={caseRegister}
                  processing={processing}
                  sectioning={sectioning}
                  staining={staining}
                  molecular={molecular}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  onAccessionSpecimen={goToAccessioning}
                  onSave={handleSave}
                />
              )}
              {(activeKey === "primary-micro" || activeKey === "ancillary-work" || activeKey === "micro-review") && (
                <MicroscopyTab
                  key={`${activeKey}-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  initialData={microscopy}
                  caseRegister={caseRegister}
                  processing={processing}
                  sectioning={sectioning}
                  staining={staining}
                  molecular={molecular}
                  grossing={grossing}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  mode={activeKey === "micro-review" ? "review" : activeKey === "ancillary-work" ? "ancillary" : "primary"}
                  onSave={handleSave}
                />
              )}
              {activeKey === "integration" && (
                <IntegratedDiagnosisTab
                  key={`integration-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  accessionId={accessionId}
                  patientId={patientId}
                  initialData={integration}
                  caseRegister={caseRegister}
                  microscopyData={microscopy}
                  stainingData={staining}
                  molecularData={molecular}
                  cytopathologyData={cytopathology}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  onSave={handleSave}
                />
              )}
              {activeKey === "synoptic" && (
                <SynopticReportTab
                  key={`synoptic-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  initialData={synoptic}
                  caseRegister={caseRegister}
                  grossingData={grossing}
                  microscopyData={microscopy}
                  integrationData={integration}
                  stainingData={staining}
                  molecularData={molecular}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  onSave={handleSave}
                />
              )}
              {activeKey === "tnm" && (
                <TNMStagingTab
                  key={`tnm-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  initialData={tnm}
                  synopticData={synoptic}
                  caseRegister={caseRegister}
                  microscopyData={microscopy}
                  integrationData={integration}
                  grossingData={grossing}
                  molecularData={molecular}
                  cytopathologyData={cytopathology}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  onSave={handleSave}
                />
              )}
              {activeKey === "final-diagnosis" && (
                <FinalDiagnosisTab
                  key={`final-diagnosis-${currentCaseId || "none"}`}
                  caseId={currentCaseId}
                  accessionId={accessionId}
                  initialData={finalDiagnosis}
                  caseRegister={caseRegister}
                  grossingData={grossing}
                  microscopyData={microscopy}
                  integrationData={integration}
                  stainingData={staining}
                  molecularData={molecular}
                  cytopathologyData={cytopathology}
                  synopticData={synoptic}
                  tnmData={tnm}
                  doctorId={doctorId}
                  doctorName={doctorName}
                  onSave={handleSave}
                  onSignOut={handleSignOut}
                />
              )}
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
            {accessionId ? `Accession ${accessionId}` : "Current case"} · Status: {caseStatus || "Active"}
          </Typography>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>
            A new case cannot be opened until the current case is signed out. Signing out now bypasses the usual
            completeness checks and records this case as signed out (with the action noted as forced), so a new case
            can be started. The current case stays available in the patient's previous pathology cases.
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

export default OncoPathologyWorkflow;
