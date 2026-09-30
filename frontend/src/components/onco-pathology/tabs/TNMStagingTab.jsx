import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, TextField, Typography } from "@mui/material";
import { AutoAwesomeRounded, CalculateRounded, SaveRounded, WarningAmberRounded } from "@mui/icons-material";
import { C, FONT, FW_BOLD, inputSx, outlineBtnSx, saveBtnSx, tdSx, thSx } from "../../shared/designTokens";
import { SectionBox, FG, FieldLabel, FlagNote, Sel } from "../../shared/FormComponents";
import { calculateStage, reviewTNM } from "../shared/api";
import { tabApplicability } from "../shared/caseClass";
import { getTnmConfig, inferTnmSite, TNM_PREFIX_OPTIONS, TNM_SITE_OPTIONS, RESPONSE_GRADE_OPTIONS } from "../shared/tnmConfig";
import { hasPositiveCytology, isMetastaticCytologyRecord } from "../shared/cytopathologyModel";

const EMPTY = {
  site: "", staging_system: "", edition: "", pT: "", pN: "", cN: "", cM: "", pM1: "",
  pT_source: "", pT_evidence: "", pN_source: "", pN_evidence: "", cN_source: "", cN_evidence: "", cM_source: "", cM_evidence: "", pM1_source: "", pM1_evidence: "",
  t_prefix: "", n_prefix: "", m_prefix: "", multifocal: false,
  nodes_examined: "", nodes_positive: "", stage_group: "", stage_basis: "", stage_rule_version: "",
  staging_basis_class: "", missing_input_warnings: [], conflicts: [], confirmation: { confirmed: false, confirmed_by: "", confirmed_at: "" },
  response: { ypT: "", ypN: "", ypM: "", pCR: "", response_grade: "", rcb: "" }, advisory_runs: [],
  prostate_grade_group: "", prostate_psa: "",
};

const value = (v) => v === null || v === undefined ? "" : v;
const listValue = (v) => Array.isArray(v) ? v : (v === null || v === undefined || v === "" ? [] : [v]);
const displayText = (item) => {
  if (item === null || item === undefined || item === "") return "";
  if (typeof item === "string" || typeof item === "number" || typeof item === "boolean") return String(item);
  if (Array.isArray(item)) return item.map(displayText).filter(Boolean).join("; ");
  if (typeof item === "object") {
    if (item.issue || item.detail) return [item.issue, item.detail].filter(Boolean).map(displayText).join(": ");
    if (item.message) return displayText(item.message);
    return Object.entries(item).map(([key, entry]) => `${key}: ${displayText(entry)}`).filter(Boolean).join("; ");
  }
  return String(item);
};

export default function TNMStagingTab({ caseId, initialData, synopticData, caseRegister, microscopyData, integrationData, grossingData, molecularData, cytopathologyData, doctorId, doctorName, onSave }) {
  const inferredSite = inferTnmSite(synopticData, caseRegister);
  // pT and pN describe tissue removed at operation. Without a resection they
  // cannot be assigned — but clinical cN and cM still can: a malignant effusion is
  // M1a, and a positive aspirate of a distant node is cM1. So the tab stays open
  // and only pathological staging is blocked.
  const applicability = tabApplicability(caseRegister);
  const pathologicalStaging = applicability.tnm.pathologicalApplicable;
  const clinicalOnly = !pathologicalStaging;
  const [f, setF] = useState({ ...EMPTY, ...(initialData || {}), response: { ...EMPTY.response, ...(initialData?.response || {}) }, confirmation: { ...EMPTY.confirmation, ...(initialData?.confirmation || {}) } });
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState(null);
  const [localWarnings, setLocalWarnings] = useState([]);
  const config = getTnmConfig(f.site);

  useEffect(() => {
    const next = { ...EMPTY, ...(initialData || {}) };
    next.site = initialData?.site || inferredSite || "";
    const nextConfig = getTnmConfig(next.site);
    next.staging_system = initialData?.staging_system || nextConfig?.staging_system || "";
    next.edition = initialData?.edition || nextConfig?.edition || "";
    next.response = { ...EMPTY.response, ...(initialData?.response || {}) };
    next.confirmation = { ...EMPTY.confirmation, ...(initialData?.confirmation || {}) };
    setF(next); setReview(null); setLocalWarnings([]);
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const set = (key, nextValue) => setF((prev) => ({ ...prev, [key]: nextValue, confirmation: { ...EMPTY.confirmation }, ...(["pT", "pN", "cN", "cM", "pM1", "t_prefix", "n_prefix", "m_prefix", "multifocal", "prostate_grade_group", "prostate_psa"].includes(key) ? { stage_group: "", stage_basis: "", stage_rule_version: "" } : {}) }));
  const setResponse = (key, nextValue) => setF((prev) => ({ ...prev, response: { ...prev.response, [key]: nextValue }, confirmation: { ...EMPTY.confirmation } }));
  const categoryOptions = useMemo(() => config ? { t: config.t, n: config.n, m: config.m } : { t: [], n: [], m: [] }, [config]);
  const confirmedFindings = { synoptic: synopticData || {}, microscopy: microscopyData || {}, integration: integrationData || {}, grossing: grossingData || {}, molecular: molecularData || {}, cytopathology: cytopathologyData || {} };
  // A body-cavity fluid / CSF cytology confirmed positive for malignant cells is
  // pathology-confirmed M1 (e.g. pM1a in lung) whether or not a resection exists.
  // Surface those records so pM1 can be recorded with a traceable cytology
  // reference instead of unverifiable free text.
  const metastaticCytologyRecords = useMemo(() =>
    (Array.isArray(cytopathologyData?.records) ? cytopathologyData.records.filter(isMetastaticCytologyRecord) : []),
  [cytopathologyData]);
  const useCytologyAsM1Evidence = (record) => setF((prev) => ({
    ...prev,
    pM1_source: "Cytopathology",
    pM1_evidence: `${record.cytology_id} · ${[record.specimen_type, record.anatomic_site, record.diagnostic_category || record.cytologic_diagnosis].filter(Boolean).join(" · ")}`,
    confirmation: { ...EMPTY.confirmation },
  }));

  const validate = () => {
    const warnings = [];
    if (!config) warnings.push("Select a supported primary site before staging.");
    if (!pathologicalStaging) {
      // Clinical-only staging. pT/pN are unavailable, so the deterministic stage
      // tables cannot run; cN/cM are still recorded as staging evidence.
      if (f.pT || f.pN) warnings.push("pT and pN cannot be assigned without a resection specimen. Record cN and cM instead.");
      if (!f.cN && !f.cM && !f.pM1) warnings.push("Record at least a clinical cN or cM for this case, or state that staging information is unavailable.");
      if (f.cN && (!f.cN_source || !f.cN_evidence)) warnings.push("cN requires source and evidence.");
      if (config && f.cN && !config.n.includes(f.cN)) warnings.push("cN is not supported for the selected site.");
    } else {
      if (config && !f.pT) warnings.push("pT is required for stage calculation.");
      if (config && !f.pN) warnings.push("pN is required for stage calculation.");
      if (f.pT && (!f.pT_source || !f.pT_evidence)) warnings.push("pT requires source and evidence.");
      if (f.pN && (!f.pN_source || !f.pN_evidence)) warnings.push("pN requires source and evidence.");
      if (config && f.pT && !config.t.includes(f.pT)) warnings.push("pT is not supported for the selected site.");
      if (config && f.pN && !config.n.includes(f.pN)) warnings.push("pN is not supported for the selected site.");
    }
    if (config && f.cM && !config.m.includes(f.cM)) warnings.push("cM is not supported for the selected site.");
    if (config && f.pM1 && !config.m.includes(f.pM1)) warnings.push("pM1 is not supported for the selected site.");
    if (pathologicalStaging && !f.cM && !f.pM1) warnings.push("M category remains unknown until supported clinical/imaging or pathology evidence is recorded.");
    if (f.cM && f.pM1 && f.cM !== f.pM1) warnings.push("cM and pM1 conflict and require resolution.");
    const examined = f.nodes_examined === "" ? null : Number(f.nodes_examined);
    const positive = f.nodes_positive === "" ? null : Number(f.nodes_positive);
    if (examined !== null && (!Number.isFinite(examined) || examined < 0)) warnings.push("Nodes examined must be a non-negative number.");
    if (positive !== null && (!Number.isFinite(positive) || positive < 0)) warnings.push("Positive nodes must be a non-negative number.");
    if (examined !== null && positive !== null && positive > examined) warnings.push("Positive nodes cannot exceed nodes examined.");
    if (f.cM && !["clinical", "imaging"].some((source) => String(f.cM_source).toLowerCase().includes(source))) warnings.push("cM requires a clinical or imaging source.");
    if (f.pM1 && (!f.pM1_source || !f.pM1_evidence)) warnings.push("pM1 requires pathology evidence.");
    if (metastaticCytologyRecords.length && !f.pM1 && (!f.cM || f.cM === "M0")) warnings.push("A body-cavity fluid / CSF cytology on this case is positive for malignant cells; if it reflects this cancer it is stage M1 — record pM1 (or cM) with that record as evidence.");
    if (f.pM1_source === "Cytopathology" && !hasPositiveCytology(cytopathologyData?.records)) warnings.push("pM1 cites Cytopathology as its source, but no cytology record on this case reports malignant cells.");
    if (pathologicalStaging && f.site === "prostate" && !f.prostate_grade_group) warnings.push("ISUP Grade Group is required for prostate stage grouping.");
    if (pathologicalStaging && f.site === "prostate" && (f.prostate_psa === "" || !Number.isFinite(Number(f.prostate_psa)) || Number(f.prostate_psa) < 0)) warnings.push("A valid pre-treatment PSA is required for prostate stage grouping.");
    return warnings;
  };

  const handleCalculate = async () => {
    const warnings = validate(); setLocalWarnings(warnings);
    if (warnings.some((item) => item.includes("required") || item.includes("Select a supported") || item.includes("must be") || item.includes("not supported"))) return;
    setBusy(true);
    try {
      const response = await calculateStage({ site: f.site, staging_system: f.staging_system, edition: f.edition, pT: f.pT, pN: f.pN, cM: f.cM, pM1: f.pM1, cM_source: f.cM_source, pM1_source: f.pM1_source, pM1_evidence: f.pM1_evidence, nodes_examined: f.nodes_examined, nodes_positive: f.nodes_positive, t_prefix: f.t_prefix, n_prefix: f.n_prefix, m_prefix: f.m_prefix, multifocal: f.multifocal, prostate_grade_group: f.prostate_grade_group, prostate_psa: f.prostate_psa });
      if (response?.status === "success" && response.data) setF((prev) => ({ ...prev, stage_group: response.data.stage_group || "", stage_basis: response.data.stage_basis || "", stage_rule_version: response.data.stage_rule_version || "" }));
    } catch (error) { setLocalWarnings([error.message || "Stage calculation failed."]); } finally { setBusy(false); }
  };

  const handleReview = async () => {
    setBusy(true); setReview(null);
    try { const response = await reviewTNM(caseId, f, confirmedFindings, clinicalOnly); if (response?.status === "success") { const missingEvidence = listValue(response.missing_evidence); const conflicts = listValue(response.conflicts); const run = { run_id: `TNM-AI-${Date.now()}`, created_at: new Date().toISOString(), engine_version: response.engine_version || "", status: "Proposed", proposal: response.proposal || {}, suggestions: listValue(response.suggestions), missing_evidence: missingEvidence, conflicts, explanation: response.explanation || "" }; setF((prev) => ({ ...prev, advisory_runs: [...(prev.advisory_runs || []), run].slice(-20), conflicts, missing_input_warnings: [...(prev.missing_input_warnings || []), ...missingEvidence] })); setReview(run); } }
    catch (error) { setReview({ error: error.message || "TNM review failed." }); }
    finally { setBusy(false); }
  };

  const acceptAIProposal = () => {
    const proposal = review?.proposal || {};
    const evidence = proposal.evidence || {};
    const stampAccepted = (prev) => ({
      ...prev,
      advisory_runs: (prev.advisory_runs || []).map((run) => run.run_id === review.run_id ? { ...run, status: "Accepted into draft", accepted_by: doctorName || doctorId || "", accepted_at: new Date().toISOString() } : run),
    });
    // Clinical-only (no resection): accept only the spread categories the records
    // can support — cN and cM / pM1. pT/pN and a stage group are never touched
    // because they do not apply without a resection.
    if (clinicalOnly) {
      setF((prev) => stampAccepted({
        ...prev,
        site: proposal.site || prev.site,
        cN: proposal.cN || "",
        cM: proposal.cM || "",
        pM1: proposal.pM1 || "",
        m_prefix: proposal.m_prefix || (proposal.pM1 ? "p" : proposal.cM ? "c" : ""),
        cN_source: evidence.cN?.source || "",
        cN_evidence: evidence.cN?.evidence || "",
        cM_source: evidence.cM?.source || "",
        cM_evidence: evidence.cM?.evidence || "",
        pM1_source: evidence.pM1?.source || "",
        pM1_evidence: evidence.pM1?.evidence || "",
        confirmation: { ...EMPTY.confirmation },
      }));
      setReview((prev) => ({ ...prev, status: "Accepted into draft", accepted_by: doctorName || doctorId || "", accepted_at: new Date().toISOString() }));
      return;
    }
    setF((prev) => stampAccepted({
      ...prev,
      site: proposal.site || prev.site,
      pT: proposal.pT || prev.pT,
      pN: proposal.pN || prev.pN,
      cM: proposal.cM || "",
      pM1: proposal.pM1 || "",
      t_prefix: proposal.t_prefix || "",
      n_prefix: proposal.n_prefix || "",
      m_prefix: proposal.m_prefix || (proposal.pM1 ? "p" : proposal.cM ? "c" : ""),
      multifocal: Boolean(proposal.multifocal),
      pT_source: evidence.pT?.source || prev.pT_source,
      pT_evidence: evidence.pT?.evidence || prev.pT_evidence,
      pN_source: evidence.pN?.source || prev.pN_source,
      pN_evidence: evidence.pN?.evidence || prev.pN_evidence,
      cM_source: evidence.cM?.source || "",
      cM_evidence: evidence.cM?.evidence || "",
      pM1_source: evidence.pM1?.source || "",
      pM1_evidence: evidence.pM1?.evidence || "",
      stage_group: proposal.stage_group || "",
      stage_basis: proposal.stage_basis || proposal.rationale || "AI-calculated proposal accepted for pathologist review",
      stage_rule_version: review.engine_version || "AI-TNM-proposal-1.0",
      confirmation: { ...EMPTY.confirmation },
    }));
    setReview((prev) => ({ ...prev, status: "Accepted into draft", accepted_by: doctorName || doctorId || "", accepted_at: new Date().toISOString() }));
  };

  const handleSave = async () => {
    const warnings = validate(); setLocalWarnings(warnings); setBusy(true);
    try { await onSave("tnm", { ...f, staging_basis_class: pathologicalStaging ? "pathological" : "clinical_only", missing_input_warnings: warnings }); } finally { setBusy(false); }
  };

  const confirm = () => setF((prev) => ({ ...prev, confirmation: { confirmed: true, confirmed_by: doctorName || doctorId || "", confirmed_at: new Date().toISOString() } }));
  const evidenceField = (prefix, label) => <Box sx={{ mt: 1.5 }}><FG cols={2}><Sel label={`${label} source`} options={["", ...(config?.evidence || [])]} value={value(f[`${prefix}_source`])} onChange={(v) => set(`${prefix}_source`, v)} /><TextField label={`${label} evidence`} value={value(f[`${prefix}_evidence`])} onChange={(e) => set(`${prefix}_evidence`, e.target.value)} size="small" sx={inputSx} fullWidth /></FG></Box>;
  const proposal = review?.proposal || {};
  const proposalReady = pathologicalStaging
    ? Boolean(proposal.pT && proposal.pN && (proposal.cM || proposal.pM1) && proposal.stage_group)
    : Boolean(proposal.site && (proposal.cN || proposal.cM || proposal.pM1));
  const aiButtonLabel = pathologicalStaging ? "Calculate complete TNM proposal with AI" : "Propose clinical spread (cN / cM / pM1) with AI";
  const aiButtonHint = pathologicalStaging
    ? "AI calculates a complete proposed pT, pN, M and stage group from confirmed findings. The proposal stays separate until explicitly accepted and never saves, confirms, or signs out the report."
    : "No resection specimen exists, so pT, pN and a stage group cannot be derived. The AI proposes only the spread categories the case can support — cN and cM / pM1 — with evidence from the cytology and other confirmed findings. It never invents a T category or a stage group.";
  const aiHeadline = pathologicalStaging
    ? `${displayText(proposal.pT) || "pT?"} · ${displayText(proposal.pN) || "pN?"} · ${displayText(proposal.pM1 || proposal.cM) || "M?"} · Stage ${displayText(proposal.stage_group) || "not calculable"}`
    : `${proposal.cN ? `c${displayText(proposal.cN)}` : "cN?"} · ${proposal.pM1 ? `p${displayText(proposal.pM1)}` : proposal.cM ? `c${displayText(proposal.cM)}` : "M?"}`;
  const aiAcceptLabel = pathologicalStaging ? "Accept complete AI proposal" : "Accept AI clinical proposal into draft";
  const evidenceRows = Object.entries(proposal.evidence || {})
    .filter(([, entry]) => entry && typeof entry === "object")
    .map(([category, entry]) => ({ category, source: displayText(entry.source), evidence: displayText(entry.evidence), confidence: displayText(entry.confidence) }))
    .filter((row) => row.source || row.evidence || row.confidence);

  return <Box sx={{ fontFamily: FONT }}>
    {!pathologicalStaging && <SectionBox title="Clinical Staging Only"><FlagNote>{applicability.tnm.reason}</FlagNote><Typography sx={{ fontFamily: FONT, fontSize: 12.5, color: C.textSecond, mt: 1.5 }}>pT, pN and the deterministic stage group are unavailable without a resection. Record cN and cM below; they are saved as staging evidence and carried into the final report. Sign-out does not require a pathological stage group for this case.</Typography></SectionBox>}
    <SectionBox title="Primary Site and Staging Protocol"><FG cols={3}><Box><FieldLabel>Confirmed Primary Site</FieldLabel><Sel label="Primary Site" options={TNM_SITE_OPTIONS} value={f.site} onChange={(site) => { const next = getTnmConfig(site); setF((prev) => ({ ...prev, site, staging_system: next?.staging_system || "", edition: next?.edition || "", pT: "", pN: "", cN: "", cM: "", pM1: "", stage_group: "", stage_basis: "", stage_rule_version: "", confirmation: { ...EMPTY.confirmation } })); }} /></Box><TextField label="Staging system" value={f.staging_system} size="small" fullWidth sx={inputSx} InputProps={{ readOnly: true }} /><TextField label="Edition" value={f.edition} size="small" fullWidth sx={inputSx} InputProps={{ readOnly: true }} /></FG><FlagNote>TNM uses confirmed Synoptic/Microscopy findings as evidence. The pathologist may calculate with deterministic rules or explicitly accept a separately displayed AI-calculated proposal.</FlagNote></SectionBox>

    {pathologicalStaging
      ? <SectionBox title="TNM Categories and Evidence"><FG cols={3}><Box><FieldLabel>pT</FieldLabel><Sel label="pT" options={categoryOptions.t} value={f.pT} onChange={(v) => set("pT", v)} />{evidenceField("pT", "pT")}</Box><Box><FieldLabel>pN</FieldLabel><Sel label="pN" options={categoryOptions.n} value={f.pN} onChange={(v) => set("pN", v)} />{evidenceField("pN", "pN")}</Box><Box><FieldLabel>Clinical M (cM)</FieldLabel><Sel label="cM" options={categoryOptions.m} value={f.cM} onChange={(v) => set("cM", v)} />{evidenceField("cM", "cM")}</Box></FG><FG cols={3}><Box><FieldLabel>Pathology-confirmed M1 (pM1)</FieldLabel><Sel label="pM1" options={["", ...categoryOptions.m.filter((item) => item !== "M0")]} value={f.pM1} onChange={(v) => set("pM1", v)} />{evidenceField("pM1", "pM1")}</Box><Box><FieldLabel>Prefixes and modifiers</FieldLabel><FG cols={3}><Sel label="T prefix" options={TNM_PREFIX_OPTIONS} value={f.t_prefix} onChange={(v) => set("t_prefix", v)} /><Sel label="N prefix" options={TNM_PREFIX_OPTIONS} value={f.n_prefix} onChange={(v) => set("n_prefix", v)} /><Sel label="M prefix" options={["", "c", "p"]} value={f.m_prefix} onChange={(v) => set("m_prefix", v)} /></FG></Box><Box><FieldLabel>Multifocal</FieldLabel><Sel label="Multifocal modifier" options={["", "m"]} value={f.multifocal ? "m" : ""} onChange={(v) => set("multifocal", v === "m")} /></Box></FG></SectionBox>
      : <SectionBox title="Clinical Categories and Evidence"><FG cols={3}><Box><FieldLabel>Clinical N (cN)</FieldLabel><Sel label="cN" options={["", ...categoryOptions.n]} value={f.cN} onChange={(v) => set("cN", v)} />{evidenceField("cN", "cN")}</Box><Box><FieldLabel>Clinical M (cM)</FieldLabel><Sel label="cM" options={["", ...categoryOptions.m]} value={f.cM} onChange={(v) => set("cM", v)} />{evidenceField("cM", "cM")}</Box><Box><FieldLabel>Pathology-confirmed M1 (pM1)</FieldLabel><Sel label="pM1" options={["", ...categoryOptions.m.filter((item) => item !== "M0")]} value={f.pM1} onChange={(v) => set("pM1", v)} />{evidenceField("pM1", "pM1")}</Box></FG><FlagNote>A malignant effusion or a positive aspirate of a distant site is pathology-confirmed M1 even without a resection — record it as pM1 with the cytology record as evidence.</FlagNote></SectionBox>}

    {metastaticCytologyRecords.length > 0 && (
      <SectionBox title="Cytology Evidence of Metastatic Disease">
        <FlagNote>A body-cavity fluid / CSF cytology confirmed positive for malignant cells is stage M1 (for example pM1a in lung). Use a record below to fill the pM1 source and evidence with a traceable cytology reference, then choose the M category above.</FlagNote>
        {metastaticCytologyRecords.map((record) => (
          <Box key={record.cytology_id} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, py: 1, borderTop: `1px solid ${C.border}` }}>
            <Typography sx={{ fontSize: 12.5, color: C.textSecond }}>
              {record.specimen_type}{record.anatomic_site ? ` · ${record.anatomic_site}` : ""}{record.sub_site ? ` (${record.sub_site})` : ""} — <b>{record.diagnostic_category || record.cytologic_diagnosis || "Malignant cells"}</b>
              <Typography component="span" sx={{ fontSize: 11, color: C.textMuted, ml: 1 }}>{record.cytology_id}</Typography>
            </Typography>
            <Button sx={outlineBtnSx} onClick={() => useCytologyAsM1Evidence(record)}>Use as pM1 evidence</Button>
          </Box>
        ))}
      </SectionBox>
    )}

    {pathologicalStaging && <SectionBox title="Node Counts and Post-treatment Response"><FG cols={3}><TextField label="Nodes examined" type="number" value={value(f.nodes_examined)} onChange={(e) => set("nodes_examined", e.target.value)} size="small" fullWidth sx={inputSx} inputProps={{ min: 0, step: 1 }} /><TextField label="Positive nodes" type="number" value={value(f.nodes_positive)} onChange={(e) => set("nodes_positive", e.target.value)} size="small" fullWidth sx={inputSx} inputProps={{ min: 0, step: 1 }} /><Typography sx={{ fontSize: 12, color: C.textSecond, alignSelf: "center" }}>Counts are supporting evidence; pN remains the confirmed category.</Typography></FG>{f.site === "prostate" && <FG cols={2}><Sel label="ISUP Grade Group" options={["", "1", "2", "3", "4", "5"]} value={f.prostate_grade_group} onChange={(v) => set("prostate_grade_group", v)} /><TextField label="Pre-treatment PSA (ng/mL)" type="number" value={value(f.prostate_psa)} onChange={(e) => set("prostate_psa", e.target.value)} size="small" fullWidth sx={inputSx} inputProps={{ min: 0, step: 0.1 }} /></FG>}<FG cols={3}><Sel label="ypT" options={["", ...categoryOptions.t]} value={f.response.ypT} onChange={(v) => setResponse("ypT", v)} /><Sel label="ypN" options={["", ...categoryOptions.n]} value={f.response.ypN} onChange={(v) => setResponse("ypN", v)} /><Sel label="ypM" options={["", ...categoryOptions.m]} value={f.response.ypM} onChange={(v) => setResponse("ypM", v)} /></FG><FG cols={3}><Sel label="Pathologic complete response" options={["", "Yes", "No", "Not assessable"]} value={f.response.pCR} onChange={(v) => setResponse("pCR", v)} /><Sel label="Treatment response grade" options={RESPONSE_GRADE_OPTIONS} value={f.response.response_grade} onChange={(v) => setResponse("response_grade", v)} /><TextField label="RCB (if applicable)" value={value(f.response.rcb)} onChange={(e) => setResponse("rcb", e.target.value)} size="small" fullWidth sx={inputSx} /></FG></SectionBox>}

    {pathologicalStaging
      ? <Box sx={{ border: `1px solid ${C.border}`, background: C.white, p: 3, mb: 2.5, textAlign: "center" }}><Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted }}>Current anatomic stage group</Typography><Typography sx={{ fontSize: 42, fontWeight: FW_BOLD, fontFamily: FONT }}>{f.stage_group || "—"}</Typography><Typography sx={{ fontSize: 13, color: C.textSecond }}>{f.pT && f.pN ? `${f.t_prefix || ""}p${f.pT}${f.multifocal ? "(m)" : ""} ${f.n_prefix || ""}p${f.pN} ${f.m_prefix || (f.pM1 ? "p" : f.cM ? "c" : "")}${f.pM1 || f.cM || "M?"}` : "Complete required categories to calculate"}</Typography>{f.stage_basis && <Typography sx={{ fontSize: 12, color: C.textSecond, mt: 1 }}>{f.stage_basis} · source/rule {f.stage_rule_version}</Typography>}<Button sx={{ ...outlineBtnSx, mt: 2 }} onClick={handleCalculate} disabled={busy}><CalculateRounded sx={{ mr: 0.75, fontSize: 16 }} />Calculate with deterministic rules</Button></Box>
      : <Box sx={{ border: `1px solid ${C.border}`, background: C.white, p: 3, mb: 2.5, textAlign: "center" }}><Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted }}>Recorded staging evidence</Typography><Typography sx={{ fontSize: 28, fontWeight: FW_BOLD, fontFamily: FONT }}>{[f.cN && `c${f.cN}`, f.pM1 ? `p${f.pM1}` : f.cM && `c${f.cM}`].filter(Boolean).join(" ") || "—"}</Typography><Typography sx={{ fontSize: 12.5, color: C.textSecond, mt: 1 }}>No anatomic stage group is derived. The AJCC stage tables need pT and pN, which require a resection specimen — deriving a group from clinical categories alone would be an invented value.</Typography></Box>}

    {(localWarnings.length > 0 || (f.conflicts || []).length > 0) && <SectionBox title="Missing-input and conflict warnings">{[...localWarnings, ...(f.conflicts || [])].map((warning, index) => <Box key={`${displayText(warning)}-${index}`} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.5 }}><WarningAmberRounded sx={{ fontSize: 16, color: "#b76e00" }} /><Typography sx={{ fontSize: 12.5, color: C.textSecond }}>{displayText(warning)}</Typography></Box>)}</SectionBox>}

    <SectionBox title={pathologicalStaging ? "AI TNM proposal and confirmation" : "AI clinical staging proposal and confirmation"}><Button sx={outlineBtnSx} onClick={handleReview} disabled={busy || !f.site}><AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />{aiButtonLabel}</Button><Typography sx={{ fontSize: 11, color: C.textMuted, mt: 1 }}>{aiButtonHint}</Typography>{review && <Box sx={{ mt: 2, p: 1.5, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
  {review.error
    ? <Typography sx={{ fontSize: 12.5 }}>{displayText(review.error)}</Typography>
    : review.proposal && (
      <Box sx={{ mt: 1.5 }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 18, fontWeight: FW_BOLD }}>{aiHeadline}</Typography>
        {evidenceRows.length > 0 && <Box sx={{ mt: 1.5, border: `1px solid ${C.border}`, overflowX: "auto" }}>
          <Table size="small">
            <TableHead>
              <TableRow>{["Category", "Source", "Evidence", "Confidence"].map((label) => <TableCell key={label} sx={thSx}>{label}</TableCell>)}</TableRow>
            </TableHead>
            <TableBody>{evidenceRows.map((row) => (
              <TableRow key={row.category}>
                <TableCell sx={{ ...tdSx, fontWeight: FW_BOLD, borderBottom: `1px solid ${C.border}` }}>{row.category}</TableCell>
                <TableCell sx={{ ...tdSx, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{row.source || "—"}</TableCell>
                <TableCell sx={{ ...tdSx, borderBottom: `1px solid ${C.border}` }}>{row.evidence || "—"}</TableCell>
                <TableCell sx={{ ...tdSx, whiteSpace: "nowrap", borderBottom: `1px solid ${C.border}` }}>{row.confidence || "—"}</TableCell>
              </TableRow>
            ))}</TableBody>
          </Table>
        </Box>}
        {proposal.confidence && <Typography sx={{ fontFamily: FONT, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, mt: 1.5 }}>Overall confidence · {displayText(proposal.confidence)}</Typography>}
        {(review.missing_evidence || []).length > 0 && <Box sx={{ mt: 1 }}>{(review.missing_evidence || []).map((item, index) => <Typography key={`missing-${index}`} sx={{ fontSize: 12, color: C.textSecond }}><WarningAmberRounded sx={{ fontSize: 14, color: "#b76e00", verticalAlign: "middle", mr: 0.5 }} />Missing evidence: {displayText(item)}</Typography>)}</Box>}
        {(review.conflicts || []).length > 0 && <Box sx={{ mt: 0.5 }}>{(review.conflicts || []).map((item, index) => <Typography key={`conflict-${index}`} sx={{ fontSize: 12, color: C.textSecond }}><WarningAmberRounded sx={{ fontSize: 14, color: "#b76e00", verticalAlign: "middle", mr: 0.5 }} />Conflict: {displayText(item)}</Typography>)}</Box>}
        <Box sx={{ mt: 1.5 }}>
          {proposalReady && review.status !== "Accepted into draft" && <Button sx={saveBtnSx} onClick={acceptAIProposal}>{aiAcceptLabel}</Button>}
          {!proposalReady && review.status !== "Accepted into draft" && <FlagNote>{pathologicalStaging ? "The proposal is incomplete because essential evidence is missing or conflicting. It cannot be accepted as a complete TNM package." : "The clinical proposal needs at least one of cN, cM or pM1 with supporting evidence before it can be accepted into the draft."}</FlagNote>}
          {review.status === "Accepted into draft" && <FlagNote>AI proposal accepted into the editable draft by {review.accepted_by}. Review every field, then confirm TNM separately.</FlagNote>}
        </Box>
      </Box>
    )}
</Box>}<Button sx={{ ...outlineBtnSx, ml: pathologicalStaging ? 1 : 0 }} onClick={confirm} disabled={f.confirmation.confirmed}>Confirm TNM{f.confirmation.confirmed ? ` · ${f.confirmation.confirmed_by}` : ""}</Button>{f.confirmation.confirmed_at && <Typography sx={{ fontSize: 11, color: C.textMuted, mt: 1 }}>Confirmed {f.confirmation.confirmed_at}</Typography>}</SectionBox>

    <Button sx={saveBtnSx} onClick={handleSave} disabled={busy}>{busy ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}Save TNM staging summary</Button>
  </Box>;
}
