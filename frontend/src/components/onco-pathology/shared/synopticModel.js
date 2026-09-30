import { schemaFields } from "../synoptic/schemaRegistry";
const uid = (prefix) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
export const makeSynopticMargin = () => ({ margin_id: uid("MARGIN"), name: "", status: "", distance: "", unit: "mm" });
export const makeSynopticNode = () => ({ node_record_id: uid("NODE"), group: "", examined: "", positive: "", extranodal_extension: "" });
export function emptySynoptic(schema, doctor = {}) {
  const answers = {}; schemaFields(schema).forEach((field) => { answers[field.key] = ""; });
  return { data_contract_version: "1.0", template_id: schema?.template_id || "", site: schema?.site || "", specimen_scope: schema?.specimen_scope || "", template_selection: { method: "manual", evidence: "", confirmed_by: "", confirmed_at: "" }, protocol: { name: schema?.protocol_name || "", version: schema?.version || "", official_cap_compliance: false, clinical_review_status: "Not clinically approved" }, answers, margins: [], nodes: [], provenance: {}, ai_autofill_runs: [], review: { report_status: "Draft", reporting_pathologist_id: doctor.id || "", reporting_pathologist: doctor.name || "", review_datetime: "", ai_review_status: "Not applicable" }, readiness: { ready_for_tnm: false, warnings: [] } };
}
export function normalizeSynoptic(data, schema, doctor = {}) {
  const base = emptySynoptic(schema, doctor);
  const legacyAnswers = {};
  if (!data?.answers) schemaFields(schema).forEach((field) => { if (Object.prototype.hasOwnProperty.call(data || {}, field.key)) legacyAnswers[field.key] = data[field.key]; });
  return { ...base, ...(data || {}), template_id: schema?.template_id || data?.template_id || "", site: schema?.site || data?.site || "", specimen_scope: schema?.specimen_scope || data?.specimen_scope || "", protocol: { ...base.protocol, ...(data?.protocol || {}) }, template_selection: { ...base.template_selection, ...(data?.template_selection || {}) }, answers: { ...base.answers, ...legacyAnswers, ...(data?.answers || {}) }, margins: Array.isArray(data?.margins) ? data.margins : [], nodes: Array.isArray(data?.nodes) ? data.nodes : [], provenance: { ...(data?.provenance || {}) }, ai_autofill_runs: Array.isArray(data?.ai_autofill_runs) ? data.ai_autofill_runs.slice(-20) : [], review: { ...base.review, ...(data?.review || {}) }, readiness: { ...base.readiness, ...(data?.readiness || {}) } };
}
export function hasUnreviewedAI(data = {}) { return Object.values(data.provenance || {}).some((item) => item?.method === "ai_autofill" && item?.review_status !== "Reviewed"); }
