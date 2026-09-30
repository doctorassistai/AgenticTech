import React, { useMemo, useState } from "react";
import { Box, Button, Checkbox, CircularProgress, FormControlLabel, TextField, Typography } from "@mui/material";
import { AutoAwesomeRounded, FactCheckRounded, LockRounded, SaveRounded } from "@mui/icons-material";
import { C, FONT, outlineBtnSx, inputSx, saveBtnSx, FW_LIGHT, FW_NORMAL } from "../../shared/designTokens";
import { SectionBox, FG, ROInput, Sel, FlagNote } from "../../shared/FormComponents";
import { BIOPSY_SPECIMEN_TYPES, CYTOLOGY_ACCESSION_TYPES, RESECTION_SPECIMEN_TYPES } from "../shared/caseClass";
import { aiReview, generateFinalDiagnosis } from "../shared/api";

const EMPTY = {
  final_diagnosis: "",
  clinical_correlation_comment: "",
  diagnostic_comment: "",
  pending_tests: "",
  pending_test_decision: "",
  additional_comment: "",
  report_status: "Draft",
  codes: { icdo_topography: "", icdo_morphology: "", snomed_ct: "" },
  reviewer: { id: "", name: "", reviewed_at: "" },
  confirmation: { confirmed: false, confirmed_by: "", confirmed_at: "" },
  source_summary: {},
  pre_signout: { checklist: {}, validated: false, validated_by: "", validated_at: "", blockers: [], warnings: [] },
  ai_draft: { generated_at: "", review_status: "Not generated" },
};

const CHECKS = [
  ["synoptic", "Synoptic template confirmed and ready for TNM."],
  ["tnm_complete", "Essential TNM inputs and deterministic stage group completed."],
  ["tnm_confirmed", "TNM confirmed by the pathologist."],
  ["cytology_report", "Cytology diagnosis categorised and signed off."],
  ["integration", "Integrated diagnosis recorded and confirmed."],
  ["conflicts", "No unresolved critical conflicts."],
  ["pending", "Pending stains or molecular tests are explicitly listed or marked none."],
  ["status", "The selected report status allows sign-out."],
];

const text = (value) => (value === null || value === undefined ? "" : String(value));
const answer = (synoptic, key) => text(synoptic?.answers?.[key] || synoptic?.[key]);
const summarize = (value) => {
  if (!value || typeof value !== "object") return text(value);
  if (Array.isArray(value)) return value.map((item) => summarize(item)).filter(Boolean).join("; ");
  return Object.entries(value).filter(([, v]) => v !== "" && v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0)).map(([k, v]) => `${k.replaceAll("_", " ")}: ${summarize(v)}`).join(" | ");
};
const confirmedAncillarySummary = (microscopy = {}) => (microscopy?.ancillary_results || [])
  .filter((result) => result?.interpretation && result?.control_accepted_for_interpretation !== "No" && result?.interpretability !== "Not interpretable")
  .map((result) => `${result.interpretation}${result.score ? ` (${result.score})` : ""}`)
  .join("; ");
const cytologySummary = (cytopathology = {}) => (cytopathology?.records || [])
  .filter((record) => record?.diagnostic_category || text(record?.cytologic_diagnosis).trim())
  .map((record) => [record.specimen_type, record.diagnostic_category, record.cytologic_diagnosis].filter(Boolean).join(" · "))
  .join("; ");
const molecularSummary = (molecular = {}) => (molecular?.orders || [])
  .filter((order) => order?.status === "Reported")
  .map((order) => order.actionable_findings || order.final_report || (order.no_significant_alteration === "Yes" ? "No significant alteration" : order.test_type))
  .filter(Boolean)
  .join("; ");

export default function FinalDiagnosisTab({ caseId, accessionId, initialData, caseRegister, grossingData, microscopyData, integrationData, stainingData, molecularData, cytopathologyData, synopticData, tnmData, doctorId, doctorName, onSave, onSignOut }) {
  const [f, setF] = useState({ ...EMPTY, ...(initialData || {}), reviewer: { ...EMPTY.reviewer, ...(initialData?.reviewer || {}) }, confirmation: { ...EMPTY.confirmation, ...(initialData?.confirmation || {}) }, pre_signout: { ...EMPTY.pre_signout, ...(initialData?.pre_signout || {}), checklist: { ...(initialData?.pre_signout?.checklist || {}) } }, ai_draft: { ...EMPTY.ai_draft, ...(initialData?.ai_draft || {}) } });
  const [busy, setBusy] = useState(false);
  const [aiMessage, setAiMessage] = useState("");
  const [notice, setNotice] = useState("");

  // The integrated diagnosis now lives in its own `integration` section, not
  // inside microscopy: synthesising a case is not microscope work.
  const integrated = integrationData || {};
  const pendingWork = [
    ...(stainingData?.records || []).filter((record) => record?.status && !["Completed", "Reported", "Cancelled"].includes(record.status)).map((record) => `${record.marker || record.target || record.stain_name || record.modality || "Stain"}: ${record.status}`),
    ...(molecularData?.orders || []).filter((order) => order?.status && !["Reported", "Completed", "Cancelled"].includes(order.status)).map((order) => `${order.test_name || order.test_type || "Molecular test"}: ${order.status}`),
  ];
  // Synoptic and pT/pN describe a resection. A cytology-only or biopsy-only case
  // has neither, so those checks pass rather than blocking the report forever.
  const hasResection = (caseRegister?.specimens || []).some((specimen) => RESECTION_SPECIMEN_TYPES.has(specimen?.specimen_type));
  const tnmComplete = !hasResection || Boolean(tnmData?.site && tnmData?.pT && tnmData?.pN && (tnmData?.cM || tnmData?.pM1) && tnmData?.stage_group);
  // A confirmed synoptic template — resection or CAP-protocol biopsy — must be ready
  // for TNM; a case with no confirmed template only needs it when it is a resection.
  const synopticConfirmed = Boolean(synopticData?.template_selection?.confirmed_at);
  const synopticReady = synopticConfirmed ? Boolean(synopticData?.readiness?.ready_for_tnm) : !hasResection;
  const tnmConfirmed = !hasResection || Boolean(tnmData?.confirmation?.confirmed);
  // Mirrors the server gate: on a cytology-only case the cytologic diagnosis IS
  // the report, so it must be categorised and signed off. Kept in step with
  // sign_out_case() in onco_pathology.py so the UI never promises a sign-out the
  // server will reject.
  const cytologyOnly = !hasResection
    && (caseRegister?.specimens || []).some((specimen) => CYTOLOGY_ACCESSION_TYPES.has(specimen?.specimen_type))
    && !(caseRegister?.specimens || []).some((specimen) => BIOPSY_SPECIMEN_TYPES.has(specimen?.specimen_type));
  const cytologyReported = !cytologyOnly || (cytopathologyData?.records || []).some(
    (record) => record?.diagnostic_category && ["Final", "Amended"].includes(record?.report_status),
  );
  const integrationReady = Boolean(integrated?.final_integrated_diagnosis && integrated?.confirmed_by && integrated?.confirmation_datetime);
  const conflicts = [...(tnmData?.conflicts || []), ...(integrated.overall_concordance === "Discordant" && !text(integrated.conflict_resolution).trim() ? ["The integrated diagnosis records unresolved discordance."] : [])];
  const pendingNarrative = Boolean(text(f.pending_tests).trim() || text(integrated.pending_tests).trim());
  const pendingExplicit = Boolean(text(f.pending_test_decision).trim()) && (pendingWork.length > 0 ? f.pending_test_decision !== "No pending tests" && pendingNarrative : f.pending_test_decision === "No pending tests" || pendingNarrative);
  const checklistValues = useMemo(() => ({ synoptic: synopticReady, tnm_complete: tnmComplete, tnm_confirmed: tnmConfirmed, cytology_report: cytologyReported, integration: integrationReady, conflicts: conflicts.length === 0, pending: pendingExplicit, status: ["Preliminary", "Final"].includes(f.report_status) && f.pending_test_decision !== "Hold report until testing complete" }), [synopticReady, tnmComplete, tnmConfirmed, cytologyReported, integrationReady, conflicts.length, pendingExplicit, f.report_status, f.pending_test_decision]);
  const blockers = CHECKS.filter(([key]) => !checklistValues[key]).map(([, label]) => label);
  const sources = { case_register: caseRegister || {}, grossing: grossingData || {}, microscopy: microscopyData || {}, integration: integrated, staining: stainingData || {}, molecular: molecularData || {}, cytopathology: cytopathologyData || {}, synoptic: synopticData || {}, tnm: tnmData || {} };

  const update = (key, value) => setF((prev) => ({ ...prev, [key]: value }));
  const setCode = (key) => (value) => setF((prev) => ({ ...prev, codes: { ...prev.codes, [key]: value } }));
  const generate = async () => {
    setBusy(true); setAiMessage("");
    try {
      const response = await generateFinalDiagnosis(sources);
      const data = response?.data || {};
      setF((prev) => {
        // Autofill only empty fields — never clobber text the pathologist typed.
        const fill = (key) => (String(prev[key] ?? "").trim() ? prev[key] : (data[key] ?? ""));
        return {
          ...prev,
          final_diagnosis: fill("final_diagnosis"),
          clinical_correlation_comment: fill("clinical_correlation_comment"),
          diagnostic_comment: fill("diagnostic_comment"),
          pending_tests: fill("pending_tests"),
          additional_comment: fill("additional_comment"),
          pending_test_decision: fill("pending_test_decision"),
          report_status: prev.report_status || data.report_status || "Draft",
          codes: {
            icdo_topography: prev.codes.icdo_topography || data.codes?.icdo_topography || "",
            icdo_morphology: prev.codes.icdo_morphology || data.codes?.icdo_morphology || "",
            snomed_ct: prev.codes.snomed_ct || data.codes?.snomed_ct || "",
          },
          ai_draft: { generated_at: new Date().toISOString(), review_status: "Autofilled from case data" },
        };
      });
      setAiMessage("Report form autofilled from confirmed case data. Review before signing out.");
    } catch (error) { setAiMessage(error.message || "Unable to autofill the report."); }
    finally { setBusy(false); }
  };
  const review = async () => {
    setBusy(true); setAiMessage("");
    try {
      const response = await aiReview({ ...sources, final_diagnosis: f.final_diagnosis, pending_tests: f.pending_tests });
      const reviewText = response?.final_review?.overall_summary || response?.final_review?.final_diagnosis || "AI review returned.";
      setAiMessage(reviewText);
      setF((prev) => ({ ...prev, ai_draft: { ...prev.ai_draft, review_status: "AI review available", review: response, reviewed_at: new Date().toISOString() } }));
    } catch (error) { setAiMessage(error.message || "Unable to review the report."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    setBusy(true); setNotice("");
    try {
      const next = { ...f, reviewer: { ...f.reviewer, id: doctorId || f.reviewer.id, name: doctorName || f.reviewer.name }, source_summary: { grossing: { saved: Boolean(grossingData && Object.keys(grossingData).length) }, staining: { record_count: stainingData?.records?.length || 0 }, molecular: { order_count: molecularData?.orders?.length || 0 }, cytopathology: { record_count: cytopathologyData?.records?.length || 0 }, synoptic: { template_id: synopticData?.template_id || "", site: synopticData?.site || "" }, tnm: { site: tnmData?.site || "", stage_group: tnmData?.stage_group || "" }, integration: { confirmed_by: integrated.confirmed_by || "" }, case_class: { has_resection: hasResection } }, pre_signout: { ...f.pre_signout, checklist: checklistValues, blockers, validated: blockers.length === 0, validated_by: doctorName || doctorId || "", validated_at: new Date().toISOString() } };
      await onSave("final_diagnosis", next); setF(next); setNotice("Final report saved.");
    } finally { setBusy(false); }
  };
  const confirm = () => setF((prev) => ({ ...prev, confirmation: { confirmed: true, confirmed_by: doctorName || doctorId || "", confirmed_at: new Date().toISOString() }, reviewer: { ...prev.reviewer, id: doctorId || prev.reviewer.id, name: doctorName || prev.reviewer.name, reviewed_at: new Date().toISOString() } }));
  const signOut = async () => {
    if (blockers.length || !f.final_diagnosis.trim() || !f.confirmation.confirmed) { setNotice("Sign-out is blocked: complete the checklist, enter the diagnosis, and confirm the report."); return; }
    if (!window.confirm("Sign out and lock this report?")) return;
    setBusy(true);
    try { await onSignOut({ ...f, pre_signout: { ...f.pre_signout, checklist: checklistValues, blockers: [], validated: true, validated_by: doctorName || doctorId || "", validated_at: new Date().toISOString() } }); }
    finally { setBusy(false); }
  };

  return <Box sx={{ fontFamily: FONT }}>
    <SectionBox title="Case Header">
      <FG cols={4}><ROInput label="Patient" value={caseRegister?.patient?.patient_name || caseRegister?.patient?.patient_id} /><ROInput label="Accession" value={accessionId} /><ROInput label="Specimen / Procedure" value={`${answer(synopticData, "specimen_type")} · ${answer(synopticData, "procedure")}`} /><ROInput label="Site / Laterality" value={`${answer(synopticData, "tumor_site")} · ${answer(synopticData, "laterality")}`} /></FG>
    </SectionBox>
    <SectionBox title="Confirmed Findings (Read-only)">
      <FG cols={2}><ROInput label="Integrated diagnosis" value={integrated.final_integrated_diagnosis} /><ROInput label="Confirmed IHC / Biomarkers" value={confirmedAncillarySummary(microscopyData) || integrated.ancillary_contribution} /><ROInput label="Molecular / Genomic Findings" value={integrated.molecular_contribution || molecularSummary(molecularData)} /><ROInput label="Cytology" value={cytologySummary(cytopathologyData) || integrated.cytology_contribution} /><ROInput label="Synoptic summary" value={synopticData?.template_selection?.confirmed_at ? `${answer(synopticData, "histologic_type")} · ${answer(synopticData, "grade")}${synopticData?.specimen_scope !== "Biopsy" ? ` · ${answer(synopticData, "extent_of_invasion")}` : ""}` : "Not applicable — no synoptic template confirmed"} /><ROInput label="TNM / Stage group" value={hasResection ? `${tnmData?.pT || ""} ${tnmData?.pN || ""} ${tnmData?.cM || tnmData?.pM1 || ""} · ${tnmData?.stage_group || "Not complete"}` : `Clinical only: ${[tnmData?.cN, tnmData?.cM].filter(Boolean).join(" ") || "Not recorded"}`} /></FG>
      {pendingWork.length > 0 && <FlagNote>Pending laboratory work: {pendingWork.join("; ")}</FlagNote>}
      {!hasResection && <FlagNote>This case has no resection specimen, so pT/pN pathological staging does not apply and is not required for sign-out. A biopsy synoptic template, once confirmed, is still required to be ready for TNM before sign-out. Clinical cM/cN remain available in TNM.</FlagNote>}
      <FlagNote>These summaries are projections from the source tabs. Edit Integrated Diagnosis, Synoptic, Microscopy, Staining, Molecular, Cytopathology or TNM in their own tabs.</FlagNote>
    </SectionBox>
    <SectionBox title="Final Report">
      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 1.5 }}><Button sx={outlineBtnSx} onClick={generate} disabled={busy}><AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />Autofill report</Button><Button sx={outlineBtnSx} onClick={review} disabled={busy || !f.final_diagnosis.trim()}><FactCheckRounded sx={{ mr: 0.75, fontSize: 16 }} />Review wording</Button></Box>
      {aiMessage && <FlagNote>{aiMessage}</FlagNote>}
      {f.ai_draft?.review_status !== "Not generated" && <Typography sx={{ fontSize: 11, color: C.textMuted, mb: 1 }}>Autofill status: {f.ai_draft.review_status}</Typography>}
      <Box sx={{ mb: 2 }}><TextField label="Final pathologic diagnosis" multiline minRows={6} fullWidth value={f.final_diagnosis} onChange={(e) => update("final_diagnosis", e.target.value)} sx={inputSx} /></Box>
      <FG cols={2}><TextField label="Clinical / pathology correlation" multiline minRows={3} fullWidth value={f.clinical_correlation_comment} onChange={(e) => update("clinical_correlation_comment", e.target.value)} sx={inputSx} /><TextField label="Diagnostic comment / differential" multiline minRows={3} fullWidth value={f.diagnostic_comment} onChange={(e) => update("diagnostic_comment", e.target.value)} sx={inputSx} /><TextField label="Pending tests and report handling" multiline minRows={3} fullWidth value={f.pending_tests} onChange={(e) => update("pending_tests", e.target.value)} sx={inputSx} /><TextField label="Additional report comment" multiline minRows={3} fullWidth value={f.additional_comment} onChange={(e) => update("additional_comment", e.target.value)} sx={inputSx} /></FG>
      <FG cols={2}><Sel label="Report status" options={["Draft", "Preliminary", "Final", "Addendum", "Corrected"]} value={f.report_status} onChange={(value) => update("report_status", value)} /><Sel label="Pending-test decision" options={["", "No pending tests", "Report may proceed - addendum planned", "Hold report until testing complete"]} value={f.pending_test_decision} onChange={(value) => update("pending_test_decision", value)} /></FG>
    </SectionBox>
    <SectionBox title="Diagnostic Coding">
      <FG cols={3}>
        <TextField label="ICD-O-3 Topography" value={f.codes.icdo_topography} onChange={(e) => setCode("icdo_topography")(e.target.value)} fullWidth sx={inputSx} />
        <TextField label="ICD-O-3 Morphology" value={f.codes.icdo_morphology} onChange={(e) => setCode("icdo_morphology")(e.target.value)} fullWidth sx={inputSx} />
        <TextField label="SNOMED CT" value={f.codes.snomed_ct} onChange={(e) => setCode("snomed_ct")(e.target.value)} fullWidth sx={inputSx} />
      </FG>
    </SectionBox>
    <SectionBox title="Pre-sign-out Review">
      {CHECKS.map(([key, label]) => <FormControlLabel key={key} control={<Checkbox size="small" checked={Boolean(checklistValues[key])} disabled sx={{ color: checklistValues[key] ? C.black : C.border }} />} label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: checklistValues[key] ? C.textPrimary : C.textSecond }}>{label}</Typography>} />)}
      {blockers.length > 0 && <FlagNote>{blockers.join(" ")}</FlagNote>}
      <FormControlLabel control={<Checkbox size="small" checked={f.confirmation.confirmed} onChange={(e) => e.target.checked ? confirm() : setF((prev) => ({ ...prev, confirmation: { ...EMPTY.confirmation } }))} />} label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT }}>I confirm that I reviewed this report and its source findings.</Typography>} />
      {f.confirmation.confirmed_at && <Typography sx={{ fontSize: 11, color: C.textMuted }}>Confirmed by {f.confirmation.confirmed_by} at {f.confirmation.confirmed_at}</Typography>}
    </SectionBox>
    {notice && <Typography sx={{ fontSize: 12.5, color: C.textSecond, mb: 1.5 }}>{notice}</Typography>}
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}><Button sx={saveBtnSx} onClick={save} disabled={busy}>{busy ? <CircularProgress size={15} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}Save Final Report</Button><Button sx={{ ...saveBtnSx, background: C.black }} onClick={signOut} disabled={busy || blockers.length > 0 || !f.final_diagnosis.trim() || !f.confirmation.confirmed}><LockRounded sx={{ mr: 0.75, fontSize: 16 }} />Sign Out and Lock Report</Button></Box>
    <Typography sx={{ mt: 1.5, fontSize: 11, color: C.textMuted, fontFamily: FONT, fontWeight: FW_LIGHT }}>Sign-out locks the case and completes linked pathology requests. AI cannot sign or finalize.</Typography>
  </Box>;
}
