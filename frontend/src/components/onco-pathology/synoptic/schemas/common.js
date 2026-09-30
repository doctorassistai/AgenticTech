export const YES_NO_INDETERMINATE = ["Not identified", "Present", "Indeterminate"];
export const MARGIN_STATUS_OPTIONS = ["Uninvolved by invasive carcinoma", "Involved by invasive carcinoma", "Cannot be assessed", "Not applicable"];
export const UNIT_OPTIONS = ["mm", "cm"];
export const field = (key, label, type = "text", extra = {}) => ({ key, label, type, ...extra });
export const specimenSection = ({ procedures, sites, laterality = false, integrity = true }) => ({ id: "specimen", title: "Specimen and Procedure", fields: [field("specimen_type", "Specimen Type", "text", { required: true, essential: true }), field("procedure", "Procedure", "select", { options: procedures, required: true, essential: true }), ...(integrity ? [field("specimen_integrity", "Specimen Integrity", "select", { options: ["Intact", "Opened", "Fragmented", "Other", "Cannot be assessed"] })] : []), field("tumor_site", "Tumor Site", "select", { options: sites, required: true, essential: true }), ...(laterality ? [field("laterality", "Laterality", "select", { options: ["Left", "Right", "Bilateral", "Midline", "Not applicable", "Cannot be determined"], required: true })] : [])] });
export const classificationSection = ({ histologies, grades, gradingSystems }) => ({ id: "classification", title: "WHO Classification and Grade", fields: [field("histologic_type", "WHO Histologic Type", "select", { options: [...histologies, "Other (specify)"], required: true, essential: true }), field("histologic_subtype", "Histologic Subtype / Other Type"), field("grading_system", "Grading System", "select", { options: gradingSystems, required: true }), field("grade", "Grade", "select", { options: grades, required: true })] });
export const tumorSection = ({ invasionOptions }) => ({ id: "tumor", title: "Tumor Dimensions and Extent", fields: [field("tumor_greatest_dimension", "Greatest Dimension", "number", { min: 0, step: 0.1, essentialGroup: "size" }), field("tumor_additional_dimension_1", "Additional Dimension 1", "number", { min: 0, step: 0.1 }), field("tumor_additional_dimension_2", "Additional Dimension 2", "number", { min: 0, step: 0.1 }), field("tumor_dimension_unit", "Dimension Unit", "select", { options: UNIT_OPTIONS, required: true }), field("tumor_size_unavailable_reason", "Reason Tumor Size Is Unavailable", "text", { essentialGroup: "size" }), field("extent_of_invasion", "Extent of Invasion", "select", { options: [...invasionOptions, "Cannot be determined"], required: true, essential: true })] });
export const commonPathologySection = () => ({ id: "pathology", title: "Invasion, Nodes and Treatment Effect", fields: [field("lymphovascular_invasion", "Lymphovascular Invasion", "select", { options: YES_NO_INDETERMINATE }), field("perineural_invasion", "Perineural Invasion", "select", { options: YES_NO_INDETERMINATE }), field("treatment_effect", "Treatment Effect", "textarea", { rows: 2 }), field("extranodal_extension_summary", "Extranodal Extension Summary", "select", { options: ["Not identified", "Present", "Indeterminate", "Not applicable"] })] });
export const ancillarySection = () => ({ id: "ancillary", title: "Confirmed Ancillary Findings and Completion", fields: [field("ihc_biomarker_summary", "Confirmed IHC / Biomarker Summary", "textarea", { rows: 3 }), field("molecular_summary", "Confirmed Molecular Summary", "textarea", { rows: 3 }), field("pending_tests", "Pending Tests", "textarea", { rows: 2 }), field("comments", "Comments", "textarea", { rows: 3 })] });

// The nodal count block is the same three fields on every protocol that defines
// one, so it is written here once instead of copied into each site schema. A site
// whose protocol has no nodal section omits it and passes `hasNodes: false`.
// `withMargins` only affects the heading: the margins themselves are the tab's
// separate repeatable, so a protocol with nodes but no margin section says so.
export const nodesSection = ({ withMargins = true } = {}) => ({ id: "margins_nodes", title: withMargins ? "Margins and Lymph Nodes" : "Lymph Nodes", fields: [field("nodes_examined", "Nodes Examined", "number", { min: 0, step: 1, required: true, essential: true }), field("nodes_positive", "Positive Nodes", "number", { min: 0, step: 1, required: true, essential: true }), field("node_information_unavailable_reason", "Reason Node Information Is Unavailable")] });

// Organ systems drive the grouped template picker. The order here is the order
// the groups render in the dropdown.
export const ORGAN_SYSTEMS = ["Gastrointestinal", "Hepatobiliary", "Gynaecologic", "Head and neck", "Endocrine", "Thoracic", "Breast", "Genitourinary", "Skin", "Soft tissue and bone", "Central nervous system", "Haematolymphoid"];

// `site` is load-bearing: it becomes the template_id stem, the value saved on the
// record, and the string `inferTnmSite` matches against a `tnmConfig.js` key — so
// a site's schema `site` and its TNM config key must be the same word.
//
// `hasMargins` / `hasNodes` are facts about the protocol, not inferences from the
// scope. A glioma or a lymphoma has neither, a soft-tissue sarcoma has margins but
// no nodal section, and forcing either would make the tab demand a margin the
// protocol does not define before it will let the case reach "Ready for TNM".
// A biopsy scope never has either, whatever the caller passes.
export const makeSchema = ({ site, title, siteKeywords, procedureKeywords, sections, scope = "Resection", organSystem = "Other", hasMargins = true, hasNodes = true }) => ({ site, template_id: `${site}-${scope.toLowerCase()}-internal-v1`, version: "1.0.0", protocol_name: `Locally maintained internal ${scope.toLowerCase()} synoptic template`, title, specimen_scope: scope, organSystem, hasMargins: scope === "Resection" && hasMargins, hasNodes: scope === "Resection" && hasNodes, official_cap_compliance: false, siteKeywords, procedureKeywords, sections: [...sections, ancillarySection()] });
