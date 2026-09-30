import React, { useEffect, useMemo, useState } from "react";
import { Box, Button, CircularProgress, FormControl, InputLabel, ListSubheader, MenuItem, Select, TextField, Typography } from "@mui/material";
import { AutoAwesomeRounded, FactCheckRounded, SaveRounded } from "@mui/icons-material";
import { C, FONT, inputSx, outlineBtnSx, saveBtnSx, sectionHeaderSx } from "../../shared/designTokens";
import { SectionBox, FG, FieldLabel, FlagNote, Sel } from "../../shared/FormComponents";
import { getSynopticSchema, inferSynopticTemplate, schemaFields, SYNOPTIC_TEMPLATE_OPTIONS, synopticTemplateForSavedSite } from "../synoptic/schemaRegistry";
import { tabApplicability } from "../shared/caseClass";
import { hasUnreviewedAI, makeSynopticMargin, makeSynopticNode, normalizeSynoptic } from "../shared/synopticModel";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
const PATH_BASE = `${API_BASE_URL}hms/users/data/onco-pathology`;
const blank = (value) => value === "" || value === null || value === undefined;
const numberValue = (value) => value === "" || value === null || value === undefined ? null : Number(value);

// A bordered sub-card with an uppercase header bar. The synoptic templates already
// carry their own section titles in the schema (`sections[].title`); this renders
// each one as a distinct card so the fields read in columns instead of one-per-row.
const RecordSection = ({ title, children }) => (
  <Box sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.white }}>
    <Box sx={sectionHeaderSx}>{title}</Box>
    <Box sx={{ p: 2.5 }}>{children}</Box>
  </Box>
);

// The template picker is the one select in the module that needs grouping: 28
// templates across a dozen organ systems, and — when the case matches only one
// specimen class — a second tier for the protocols that need the class confirmed
// first. Built here rather than added to the shared `Sel`, which every module
// uses and none of them need group headers in. Options arrive already sorted (see
// synoptic/schemaRegistry.js and `availableTemplates`), so each header is emitted
// once and the group keys stay unique across tiers.
const TemplateSelect = ({ label, options, value, onChange }) => {
  const items = []; let currentTier = null; let currentGroup = null;
  options.forEach((option) => {
    if (option.tier && option.tier !== currentTier) {
      currentTier = option.tier; currentGroup = null;
      items.push(<ListSubheader key={`tier-${option.tier}`} sx={{ fontFamily: FONT, fontSize: 10.5, fontWeight: 700, letterSpacing: 0.8, textTransform: "uppercase", color: C.white, background: C.black, lineHeight: "30px" }}>{option.tier}</ListSubheader>);
    }
    if (option.group && option.group !== currentGroup) {
      currentGroup = option.group;
      items.push(<ListSubheader key={`group-${currentTier}-${option.group}`} sx={{ fontFamily: FONT, fontSize: 10.5, fontWeight: 400, letterSpacing: 1, textTransform: "uppercase", color: C.textSecond, background: C.white, lineHeight: "28px" }}>{option.group}</ListSubheader>);
    }
    items.push(<MenuItem key={option.value} value={option.value} sx={{ fontFamily: FONT, fontSize: 13 }}>{option.label}</MenuItem>);
  });
  return (
    <FormControl size="small" fullWidth sx={inputSx}>
      <InputLabel>{label}</InputLabel>
      <Select label={label} value={value || ""} onChange={(event) => onChange(event.target.value)}>{items}</Select>
    </FormControl>
  );
};

function validateSynoptic(schema, data) {
  const answers = data.answers || {}; const warnings = []; const blockers = []; const fields = schemaFields(schema);
  // Margins and node groups are per-protocol facts, not per-scope assumptions. A
  // glioma or a lymphoma has neither, a soft-tissue sarcoma has margins but no
  // nodal section; demanding one the protocol does not define would block a
  // correct report, so the schema declares which of the two it carries.
  const hasMargins = schema?.hasMargins === true;
  const hasNodes = schema?.hasNodes === true;
  fields.filter((field) => field.required).forEach((field) => {
    const satisfiedByNodeRecords = ["nodes_examined", "nodes_positive"].includes(field.key) && (data.nodes || []).length > 0;
    if (blank(answers[field.key]) && !satisfiedByNodeRecords) { const message = `${field.label} is required.`; warnings.push(message); if (field.essential) blockers.push(message); }
  });
  const size = fields.find((field) => field.essentialGroup === "size");
  if (size && blank(answers[size.key]) && blank(answers.tumor_size_unavailable_reason)) { const message = "Tumor size or a reason it is unavailable is required."; warnings.push(message); blockers.push(message); }
  // Only numeric fields are checked for being a non-negative number. A select or
  // text answer is a string, and Number("Adenocarcinoma, NOS") is NaN, which the
  // old unchecked sweep reported as a blocker on every resection template.
  [...fields.filter((field) => field.type === "number"), { key: "nodes_examined", label: "Nodes examined" }, { key: "nodes_positive", label: "Positive nodes" }].forEach((field) => { const value = numberValue(answers[field.key]); if (value !== null && (!Number.isFinite(value) || value < 0)) { const message = `${field.label} must be a non-negative number.`; warnings.push(message); blockers.push(message); } });
  if (hasNodes) {
    const recordExamined = (data.nodes || []).reduce((sum, node) => sum + (numberValue(node.examined) || 0), 0);
    const recordPositive = (data.nodes || []).reduce((sum, node) => sum + (numberValue(node.positive) || 0), 0);
    const examined = numberValue(answers.nodes_examined) ?? ((data.nodes || []).length ? recordExamined : null); const positive = numberValue(answers.nodes_positive) ?? ((data.nodes || []).length ? recordPositive : null); if (examined !== null && positive !== null && positive > examined) { const message = "Positive nodes cannot exceed examined nodes."; warnings.push(message); blockers.push(message); }
    (data.nodes || []).forEach((node, index) => { const nodeExamined = numberValue(node.examined); const nodePositive = numberValue(node.positive); if (nodeExamined !== null && nodePositive !== null && nodePositive > nodeExamined) { const message = `Node group ${index + 1}: positive nodes cannot exceed examined nodes.`; warnings.push(message); blockers.push(message); } });
    if (!(data.nodes || []).length && blank(answers.nodes_examined) && blank(answers.node_information_unavailable_reason)) { const message = "Node information or a reason it is unavailable is required."; warnings.push(message); blockers.push(message); }
  }
  if (hasMargins) {
    if (!(data.margins || []).length) { const message = "At least one named surgical margin with status is required."; warnings.push(message); blockers.push(message); }
    (data.margins || []).forEach((margin, index) => { const distance = numberValue(margin.distance); if (!margin.name || !margin.status) { const message = `Margin ${index + 1} requires a name and status.`; warnings.push(message); blockers.push(message); } if (distance !== null && (!Number.isFinite(distance) || distance < 0)) { const message = `Margin ${index + 1} distance must be non-negative.`; warnings.push(message); blockers.push(message); } });
  }
  if (!data.template_selection?.confirmed_by || !data.template_selection?.confirmed_at) { const message = "Template/site selection requires manual confirmation."; warnings.push(message); blockers.push(message); }
  if (hasUnreviewedAI(data)) { const message = "AI-filled values require pathologist review."; warnings.push(message); blockers.push(message); }
  return { warnings, blockers };
}

export default function SynopticReportTab({ caseId, initialData, caseRegister, microscopyData, integrationData, grossingData, stainingData, molecularData, doctorId, doctorName, onSave }) {
  const applicability = tabApplicability(caseRegister);
  const inferred = inferSynopticTemplate(caseRegister, microscopyData, integrationData);
  const savedTemplateId = initialData?.template_id || synopticTemplateForSavedSite(initialData?.site)?.template_id || "";
  const [templateId, setTemplateId] = useState(savedTemplateId || inferred || "");
  const schema = getSynopticSchema(templateId);
  const [data, setData] = useState(() => normalizeSynoptic(initialData, schema, { id: doctorId, name: doctorName }));
  const [busy, setBusy] = useState(false); const [warnings, setWarnings] = useState([]); const [message, setMessage] = useState("");
  useEffect(() => { const nextSchema = getSynopticSchema(templateId); setData(normalizeSynoptic(initialData, nextSchema, { id: doctorId, name: doctorName })); }, [caseId, templateId]);
  useEffect(() => { if (!savedTemplateId && inferred && !templateId) setTemplateId(inferred); }, [inferred, savedTemplateId, templateId]);
  const fields = useMemo(() => schemaFields(schema), [schema]);
  // Whether the repeatables apply is the protocol's call, not the scope's — see
  // makeSchema in synoptic/schemas/common.js.
  const hasMargins = schema?.hasMargins === true;
  const hasNodes = schema?.hasNodes === true;
  // Every protocol stays reachable. An "Excision biopsy" can legitimately need a
  // resection-style protocol — a wide local excision of a melanoma is not
  // accessioned as a "Resection specimen" — and whether it does is a clinical
  // call this tab must not make by hiding the option. So nothing is filtered out:
  // protocols matching the case's specimen class are listed first, and the rest
  // follow under a heading that asks the pathologist to confirm the class before
  // choosing. A case carrying both classes matches everything, so there is no
  // second tier to show and the list reads exactly as it did before.
  const scopeOf = (option) => getSynopticSchema(option.value)?.specimen_scope;
  const matchesCase = (option) => (scopeOf(option) === "Resection" ? applicability.classes.hasResection : applicability.classes.hasBiopsy);
  const hasUnmatched = SYNOPTIC_TEMPLATE_OPTIONS.some((option) => !matchesCase(option));
  const availableTemplates = SYNOPTIC_TEMPLATE_OPTIONS
    .map((option) => ({ option, matches: matchesCase(option) }))
    .sort((a, b) => Number(b.matches) - Number(a.matches))
    .map(({ option, matches }) => (hasUnmatched ? { ...option, tier: `${scopeOf(option)} protocols${matches ? "" : ` — confirm this case has a ${scopeOf(option) === "Resection" ? "resection" : "biopsy"}`}` } : option));
  const setAnswer = (key, value) => setData((prev) => ({ ...prev, answers: { ...prev.answers, [key]: value }, provenance: { ...prev.provenance, [key]: { ...(prev.provenance?.[key] || {}), review_status: "Reviewed" } } }));
  const confirmTemplate = () => setData((prev) => ({ ...prev, template_id: schema.template_id, site: schema.site, specimen_scope: schema.specimen_scope, template_selection: { method: "manual", evidence: inferred ? `Inferred from confirmed site/procedure: ${getSynopticSchema(inferred)?.title || inferred}` : "", confirmed_by: doctorName || doctorId || "", confirmed_at: new Date().toISOString() } }));
  const appendMargin = () => setData((prev) => ({ ...prev, margins: [...prev.margins, makeSynopticMargin()] }));
  const updateMargin = (index, key, value) => setData((prev) => ({ ...prev, margins: prev.margins.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  const removeMargin = (index) => setData((prev) => ({ ...prev, margins: prev.margins.filter((_, itemIndex) => itemIndex !== index) }));
  const appendNode = () => setData((prev) => ({ ...prev, nodes: [...prev.nodes, makeSynopticNode()] }));
  const updateNode = (index, key, value) => setData((prev) => ({ ...prev, nodes: prev.nodes.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) }));
  const removeNode = (index) => setData((prev) => ({ ...prev, nodes: prev.nodes.filter((_, itemIndex) => itemIndex !== index) }));
  const autofill = async () => { setBusy(true); setMessage(""); try { const response = await fetch(`${PATH_BASE}/synoptic/autofill`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ case_id: caseId, template: { site: schema.site, template_id: schema.template_id, fields }, confirmed_findings: { diagnosis: integrationData?.final_integrated_diagnosis, integration: integrationData, microscopy: microscopyData, registration: caseRegister, grossing: grossingData, ihc: stainingData, molecular: molecularData } }) }); const result = await response.json(); if (!response.ok) { const detail = typeof result?.detail === "string" ? result.detail : result?.error?.message; throw new Error(detail || `Autofill failed (${response.status})`); } const proposals = result?.data?.proposals || []; setData((prev) => { const next = { ...prev, answers: { ...prev.answers }, provenance: { ...prev.provenance }, ai_autofill_runs: [...(prev.ai_autofill_runs || []), { run_id: `AI-${Date.now()}`, created_at: new Date().toISOString(), template_id: schema.template_id, status: "Requires pathologist review", proposals: proposals.length }].slice(-20) }; proposals.forEach((proposal) => { if (!fields.some((field) => field.key === proposal.field_key) || !blank(next.answers[proposal.field_key])) return; next.answers[proposal.field_key] = proposal.proposed_value; next.provenance[proposal.field_key] = { method: "ai_autofill", source_tab: proposal.source_tab, source_field: proposal.source_field, confirmation_status: "Confirmed upstream", review_status: "Needs review", confidence: proposal.confidence, evidence: proposal.evidence }; }); return next; }); setMessage(`${proposals.length} recognized proposal(s) received. Review highlighted fields before saving.`); } catch (error) { setMessage(error?.message || "Autofill failed. Review the confirmed findings manually."); } finally { setBusy(false); } };
  const markAIReviewed = () => setData((prev) => ({ ...prev, provenance: Object.fromEntries(Object.entries(prev.provenance || {}).map(([key, item]) => [key, item?.method === "ai_autofill" ? { ...item, review_status: "Reviewed", reviewed_by: doctorName || doctorId || "", reviewed_at: new Date().toISOString() } : item])), review: { ...prev.review, ai_review_status: "Reviewed", reporting_pathologist_id: doctorId || prev.review.reporting_pathologist_id, reporting_pathologist: doctorName || prev.review.reporting_pathologist, review_datetime: new Date().toISOString() } }));
  const save = async () => { const validation = validateSynoptic(schema, data); setWarnings(validation.warnings); setBusy(true); try { await onSave("synoptic", { ...data, readiness: { ready_for_tnm: validation.blockers.length === 0, warnings: validation.warnings } }); } finally { setBusy(false); } };
  // A synoptic report describes a resection or a CAP-protocol biopsy. A
  // cytology-only case has none, so the tab states why rather than presenting an
  // unfillable template. It is not hidden: a pathologist must be able to see the
  // reason, and an accessioning correction makes it applicable again.
  if (!applicability.synoptic.applicable) return <Box sx={{ fontFamily: FONT }}><SectionBox title="Synoptic Report — Not Applicable"><FlagNote>{applicability.synoptic.reason}</FlagNote><Typography sx={{ fontFamily: FONT, fontSize: 12.5, color: C.textSecond, mt: 1.5 }}>Record the diagnosis in Integrated Diagnosis and Final Diagnosis instead. Sign-out does not require a synoptic report for this case.</Typography></SectionBox></Box>;
  if (!schema) return <Box sx={{ fontFamily: FONT }}><SectionBox title="Select Synoptic Template"><FlagNote>No template matched this case's site and procedure automatically. Choose the confirmed primary site and specimen type manually — the tab never forces a template on uncertain evidence, and a biopsy or resection template should only be selected when it genuinely applies.</FlagNote><TemplateSelect label="Confirmed Template" options={availableTemplates} value="" onChange={(value) => setTemplateId(value)} /></SectionBox></Box>;
  return <Box sx={{ fontFamily: FONT }}>
    <SectionBox title="Template and Review Metadata"><FG cols={2}><Box><FieldLabel>Confirmed Template</FieldLabel><TemplateSelect label="Confirmed Template" options={availableTemplates} value={availableTemplates.some((item) => item.value === schema.template_id) ? schema.template_id : ""} onChange={(value) => setTemplateId(value)} /></Box><Box><FieldLabel>Protocol</FieldLabel><Typography sx={{ fontSize: 12 }}>{schema.protocol_name} · v{schema.version} · Internal, not CAP-approved</Typography></Box><Box><FieldLabel>Report Status</FieldLabel><Sel label="Report Status" options={["Draft", "Ready for TNM review", "Reviewed"]} value={data.review.report_status} onChange={(value) => setData((prev) => ({ ...prev, review: { ...prev.review, report_status: value } }))} /></Box><Box><FieldLabel>Reporting Pathologist</FieldLabel><TextField value={data.review.reporting_pathologist || doctorName || ""} size="small" fullWidth sx={inputSx} onChange={(event) => setData((prev) => ({ ...prev, review: { ...prev.review, reporting_pathologist: event.target.value } }))} /></Box></FG><Button sx={outlineBtnSx} onClick={confirmTemplate}>Confirm Template Selection</Button></SectionBox>
    <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mb: 2 }}><Button sx={outlineBtnSx} onClick={autofill} disabled={busy || !data.template_selection?.confirmed_at}><AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />Autofill from Confirmed Findings</Button><Typography sx={{ fontSize: 11, mt: 1 }}>Uses only confirmed diagnosis, Microscopy, Registration, Grossing, IHC and Molecular findings. AI never overwrites an existing answer or calculates TNM.</Typography>{message && <Typography sx={{ fontSize: 12, mt: 1 }}>{message}</Typography>}</Box>
    {schema.sections.map((section) => {
      const shortFields = (section.fields || []).filter((field) => field.type !== "textarea");
      const longFields = (section.fields || []).filter((field) => field.type === "textarea");
      return (
        <RecordSection key={section.id || section.title} title={section.title}>
          {shortFields.length > 0 && (
            <FG cols={shortFields.length === 1 ? 1 : 2}>
              {shortFields.map((field) => {
                const aiPending = data.provenance?.[field.key]?.method === "ai_autofill" && data.provenance?.[field.key]?.review_status !== "Reviewed";
                return (
                  <Box key={field.key}>
                    <FieldLabel>{field.label}{field.required && <span style={{ color: "#cf1322" }}> *</span>}</FieldLabel>
                    {field.type === "select"
                      ? <Sel label={field.label} options={field.options} value={data.answers?.[field.key] || ""} onChange={(value) => setAnswer(field.key, value)} />
                      : <TextField value={data.answers?.[field.key] || ""} size="small" fullWidth type={field.type === "number" ? "number" : "text"} inputProps={{ min: field.min, step: field.step }} sx={aiPending ? { ...inputSx, background: "#fff7cc" } : inputSx} onChange={(event) => setAnswer(field.key, event.target.value)} />}
                    {aiPending && <Typography sx={{ fontSize: 10, color: "#8a6d00" }}>AI proposal · review required</Typography>}
                  </Box>
                );
              })}
            </FG>
          )}
          {longFields.map((field) => {
            const aiPending = data.provenance?.[field.key]?.method === "ai_autofill" && data.provenance?.[field.key]?.review_status !== "Reviewed";
            return (
              <Box key={field.key} sx={{ mb: 2 }}>
                <FieldLabel>{field.label}{field.required && <span style={{ color: "#cf1322" }}> *</span>}</FieldLabel>
                <TextField value={data.answers?.[field.key] || ""} size="small" fullWidth multiline minRows={field.rows || 1} sx={aiPending ? { ...inputSx, background: "#fff7cc" } : inputSx} onChange={(event) => setAnswer(field.key, event.target.value)} />
                {aiPending && <Typography sx={{ fontSize: 10, color: "#8a6d00" }}>AI proposal · review required</Typography>}
              </Box>
            );
          })}
        </RecordSection>
      );
    })}
    {hasMargins && <SectionBox title="Repeatable Margins"><Button sx={outlineBtnSx} onClick={appendMargin}>Add Margin</Button>{data.margins.map((margin, index) => <Box key={margin.margin_id} sx={{ display: "grid", gridTemplateColumns: "1.3fr 1.5fr 1fr 0.7fr auto", gap: 1, mt: 1 }}><TextField label="Name" value={margin.name} onChange={(e) => updateMargin(index, "name", e.target.value)} size="small" /><Sel label="Status" options={["Uninvolved", "Involved", "Cannot be assessed", "Not applicable"]} value={margin.status} onChange={(v) => updateMargin(index, "status", v)} /><TextField label="Distance" type="number" inputProps={{ min: 0, step: 0.1 }} value={margin.distance} onChange={(e) => updateMargin(index, "distance", e.target.value)} size="small" /><Sel label="Unit" options={["mm", "cm"]} value={margin.unit} onChange={(v) => updateMargin(index, "unit", v)} /><Button onClick={() => removeMargin(index)}>Remove</Button></Box>)}</SectionBox>}
    {hasNodes && <SectionBox title="Repeatable Lymph Node Groups"><Button sx={outlineBtnSx} onClick={appendNode}>Add Node Group</Button>{data.nodes.map((node, index) => <Box key={node.node_record_id} sx={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1.3fr auto", gap: 1, mt: 1 }}><TextField label="Group" value={node.group} onChange={(e) => updateNode(index, "group", e.target.value)} size="small" /><TextField label="Examined" type="number" inputProps={{ min: 0, step: 1 }} value={node.examined} onChange={(e) => updateNode(index, "examined", e.target.value)} size="small" /><TextField label="Positive" type="number" inputProps={{ min: 0, step: 1 }} value={node.positive} onChange={(e) => updateNode(index, "positive", e.target.value)} size="small" /><Sel label="Extranodal Extension" options={["Not identified", "Present", "Indeterminate", "Not applicable"]} value={node.extranodal_extension} onChange={(v) => updateNode(index, "extranodal_extension", v)} /><Button onClick={() => removeNode(index)}>Remove</Button></Box>)}</SectionBox>}
    <SectionBox title="Readiness and Save">{warnings.map((warning) => <Typography key={warning} sx={{ color: "#a8071a", fontSize: 12 }}>{warning}</Typography>)}{hasUnreviewedAI(data) && <FlagNote>AI-filled values remain highlighted until reviewed. Draft saving is allowed, but Ready for TNM is withheld.</FlagNote>}{hasUnreviewedAI(data) && <Button sx={{ mr: 1, ...outlineBtnSx }} onClick={markAIReviewed}>Mark AI-filled Values Reviewed</Button>}<Button sx={{ mr: 1, ...outlineBtnSx }} onClick={() => setWarnings(validateSynoptic(schema, data).warnings)}><FactCheckRounded sx={{ mr: 0.75, fontSize: 16 }} />Validate</Button><Button sx={saveBtnSx} onClick={save} disabled={busy}>{busy ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} /> : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}Save Synoptic Report</Button></SectionBox>
  </Box>;
}
