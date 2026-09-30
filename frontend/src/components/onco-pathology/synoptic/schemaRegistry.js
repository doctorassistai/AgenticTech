import { ORGAN_SYSTEMS } from "./schemas/common";
import { colorectalSchema } from "./schemas/colorectal";
import { colorectalBiopsySchema } from "./schemas/colorectalBiopsy";
import { esophagusSchema } from "./schemas/esophagus";
import { stomachSchema } from "./schemas/stomach";
import { anusSchema } from "./schemas/anus";
import { pancreasSchema } from "./schemas/pancreas";
import { liverSchema } from "./schemas/liver";
import { biliarySchema } from "./schemas/biliary";
import { endometriumSchema } from "./schemas/endometrium";
import { ovarySchema } from "./schemas/ovary";
import { cervixSchema } from "./schemas/cervix";
import { oralCavitySchema } from "./schemas/oralCavity";
import { larynxSchema } from "./schemas/larynx";
import { oropharynxSchema } from "./schemas/oropharynx";
import { salivarySchema } from "./schemas/salivary";
import { thyroidSchema } from "./schemas/thyroid";
import { lungSchema } from "./schemas/lung";
import { breastSchema } from "./schemas/breast";
import { breastBiopsySchema } from "./schemas/breastBiopsy";
import { kidneySchema } from "./schemas/kidney";
import { bladderSchema } from "./schemas/bladder";
import { testisSchema } from "./schemas/testis";
import { prostateSchema } from "./schemas/prostate";
import { prostateBiopsySchema } from "./schemas/prostateBiopsy";
import { melanomaSchema } from "./schemas/melanoma";
import { sarcomaSchema } from "./schemas/sarcoma";
import { gliomaSchema } from "./schemas/glioma";
import { lymphomaSchema } from "./schemas/lymphoma";

const ALL_SCHEMAS = [colorectalSchema, colorectalBiopsySchema, esophagusSchema, stomachSchema, anusSchema, pancreasSchema, liverSchema, biliarySchema, endometriumSchema, ovarySchema, cervixSchema, oralCavitySchema, larynxSchema, oropharynxSchema, salivarySchema, thyroidSchema, lungSchema, breastSchema, breastBiopsySchema, kidneySchema, bladderSchema, testisSchema, prostateSchema, prostateBiopsySchema, melanomaSchema, sarcomaSchema, gliomaSchema, lymphomaSchema];

// Keyed by template_id, not site: breast and prostate each have a resection and
// a biopsy template, so the site string alone no longer identifies one schema.
export const schemaRegistry = Object.fromEntries(ALL_SCHEMAS.map((schema) => [schema.template_id, schema]));

const organSystemRank = (schema) => { const index = ORGAN_SYSTEMS.indexOf(schema.organSystem); return index === -1 ? ORGAN_SYSTEMS.length : index; };

// The picker groups by organ system, and Sel emits a header whenever `group`
// changes, so the options are sorted here once rather than at every call site.
// Array.prototype.sort is stable, so sites keep their declaration order inside
// a group.
export const SYNOPTIC_TEMPLATE_OPTIONS = [...ALL_SCHEMAS].sort((a, b) => organSystemRank(a) - organSystemRank(b)).map((schema) => ({ value: schema.template_id, label: schema.title.replace("Internal Synoptic Template - ", ""), group: schema.organSystem }));

export function getSynopticSchema(templateId) { return schemaRegistry[templateId] || null; }
export function schemaFields(schema) { return (schema?.sections || []).flatMap((section) => section.fields || []); }
// Records saved before biopsy templates exist carry only a site string; map it
// back to that site's resection template.
export function synopticTemplateForSavedSite(site) { return schemaRegistry[`${site}-resection-internal-v1`] || null; }
// The confirmed diagnosis comes from the `integration` section — synthesising the
// case is not microscope work — with the confirmed microscopy review as fallback.
// Returns a template_id: biopsy procedures only match the biopsy templates, so a
// core biopsy infers the needle/core template and a prostatectomy infers the
// resection template, keeping the match unambiguous.
//
// With a schema per organ this only ever fires on an exact single match, and the
// site keyword sets are kept disjoint on purpose. Where two genuinely overlap —
// "base of tongue" is both an oral-cavity and an oropharyngeal keyword, and a
// gastric cardia case can carry both "gastric" and a gastrectomy-derived
// procedure — the result is "" and the pathologist picks, which is the intended
// fallback. A wrong template proposed silently would be worse than none.
export function inferSynopticTemplate(caseRegister = {}, microscopy = {}, integration = {}) {
  const confirmed = integration?.final_integrated_diagnosis && integration?.confirmed_by && integration?.confirmation_datetime ? integration.final_integrated_diagnosis : "";
  const review = [...(microscopy?.reviews || [])].reverse().find((item) => ["Final", "Addendum"].includes(item?.report_status) && item?.primary_diagnosis);
  const specimens = caseRegister?.specimens || [];
  const text = [confirmed, review?.primary_diagnosis, review?.histologic_diagnosis, ...specimens.flatMap((s) => [s.anatomic_site, s.sub_site, s.procedure, s.specimen_type])].filter(Boolean).join(" ").toLowerCase();
  const procedures = specimens.map((s) => s.procedure || s.specimen_type || "").join(" ").toLowerCase();
  const matches = Object.values(schemaRegistry).filter((schema) => schema.siteKeywords.some((keyword) => text.includes(keyword)) && schema.procedureKeywords.some((keyword) => procedures.includes(keyword)));
  return matches.length === 1 ? matches[0].template_id : "";
}
