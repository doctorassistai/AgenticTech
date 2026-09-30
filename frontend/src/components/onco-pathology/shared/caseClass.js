// shared/caseClass.js — what a case's accessioned specimens make applicable.
//
// A pathology case is not one shape. A resection carries margins, nodes and a
// synoptic report; a CAP-protocol biopsy (prostate, breast, colorectum) carries a
// biopsy synoptic; a biopsy at an unprotocoled site carries none; a pleural fluid
// is liquid and never enters the block chain at all. The module used to assume
// every case was a resection, which made a cytology-only or biopsy-only case
// impossible to sign out.
//
// Deliberately narrow: Grossing, Processing, Sectioning and Staining need no
// gating because they are already inventory-driven — a specimen with no
// containers or blocks simply renders nothing. Only Cytopathology, Synoptic and
// TNM need to know the case class.
//
// The specimen-type strings are the ones in ../constants.js SPECIMEN_TYPE_OPTIONS.

// A resection is the only thing that carries pT/pN and named surgical margins.
// Synoptic applicability is broader (see tabApplicability) but this set stays
// narrow because TNM pathological staging and the Final Diagnosis pT/pN checks
// genuinely need a resection. `Excision biopsy` is deliberately NOT here: it is
// named a biopsy, and whether it warrants pT/pN is a clinical decision that has
// not been made. Revisit with the pathologist.
export const RESECTION_SPECIMEN_TYPES = new Set([
  "Resection specimen",
  "Lymph-node specimen",
]);

export const BIOPSY_SPECIMEN_TYPES = new Set([
  "Core biopsy",
  "Excision biopsy",
  "Incision biopsy",
  "Endoscopic biopsy",
  "Punch biopsy",
  "Shave biopsy",
  "Curettage",
]);

// Case Registry holds both histology and cytology material. Only these accession
// types can start a Cytopathology record; a routine tissue block or an
// already-derived cell block must not be reclassified as cytology.
//
// Named ACCESSION types deliberately: cytopathologyModel.js has its own
// CYTOLOGY_SPECIMEN_TYPES, which is the option list on the cytology record
// ("FNAC", "Brushing", …). These are the Case Registry accession types.
export const CYTOLOGY_ACCESSION_TYPES = new Set([
  "Fine-needle aspiration",
  "Fluid / effusion",
  "Brushings / washings",
  "Bone marrow",
  "Other",
]);

const specimenList = (caseRegister = {}) =>
  (Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : []).filter((specimen) => specimen?.specimen_id);

export const isResectionSpecimen = (specimen = {}) => RESECTION_SPECIMEN_TYPES.has(specimen.specimen_type);
export const isBiopsySpecimen = (specimen = {}) => BIOPSY_SPECIMEN_TYPES.has(specimen.specimen_type);
export const isCytologySpecimen = (specimen = {}) => CYTOLOGY_ACCESSION_TYPES.has(specimen.specimen_type);

export const caseSpecimenClasses = (caseRegister = {}) => {
  const specimens = specimenList(caseRegister);
  return {
    specimen_count: specimens.length,
    hasResection: specimens.some(isResectionSpecimen),
    hasBiopsy: specimens.some(isBiopsySpecimen),
    hasCytology: specimens.some(isCytologySpecimen),
    hasCellBlock: specimens.some((specimen) => specimen.specimen_type === "Cell block"),
  };
};

const NOT_APPLICABLE = "Not applicable";

/**
 * Per-tab applicability. `applicable: false` means the tab should be shown as Not
 * applicable with the reason — never hidden. A mixed case needs every tab, and a
 * pathologist must be able to see *why* something does not apply rather than
 * finding it missing.
 *
 * TNM is a special case: pT/pN need a resection, but cM/cN do not. A malignant
 * effusion is M1a and a positive FNA of a distant node is real staging input, so
 * the tab stays open and only pathological staging is blocked.
 */
export const tabApplicability = (caseRegister = {}) => {
  const classes = caseSpecimenClasses(caseRegister);
  const noSpecimen = classes.specimen_count === 0;

  return {
    classes,
    cytopathology: {
      applicable: classes.hasCytology,
      reason: noSpecimen
        ? "No specimen has been accessioned on this case yet."
        : classes.hasCytology
          ? ""
          : `${NOT_APPLICABLE} — this case has no liquid or aspirate specimen. Cytopathology needs a fine-needle aspiration, fluid / effusion, brushings / washings or bone marrow accession.`,
    },
    synoptic: {
      applicable: classes.hasResection || classes.hasBiopsy,
      reason: noSpecimen
        ? "No specimen has been accessioned on this case yet."
        : classes.hasResection || classes.hasBiopsy
          ? ""
          : `${NOT_APPLICABLE} — a synoptic report describes a resection or a biopsy at a CAP-protocol site. This case has no such tissue specimen.`,
    },
    tnm: {
      applicable: true,
      pathologicalApplicable: classes.hasResection,
      reason: classes.hasResection
        ? ""
        : `pT and pN need a resection specimen, which this case does not have. Clinical cM and cN remain available — a malignant effusion or a positive distant-node aspirate is still staging information.`,
    },
  };
};
