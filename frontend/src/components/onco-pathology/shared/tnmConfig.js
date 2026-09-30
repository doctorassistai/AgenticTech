// AJCC 8th-edition category arrays per primary site. The keys are the contract
// with the synoptic schemas: a schema's `site` and its TNM key here must be the
// same word, because `inferTnmSite` resolves one from the other.
const AJCC_EVIDENCE = ["Synoptic", "Microscopy", "Cytopathology", "Grossing", "Clinical", "Imaging", "Molecular", "Other"];

export const TNM_SITE_CONFIG = {
  colorectal: {
    label: "Colorectal",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1", "T2", "T3", "T4a", "T4b"],
    n: ["N0", "N1a", "N1b", "N1c", "N2a", "N2b"],
    m: ["M0", "M1a", "M1b", "M1c"],
    evidence: AJCC_EVIDENCE,
  },
  breast: {
    label: "Breast",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T0", "T1mi", "T1a", "T1b", "T1c", "T2", "T3", "T4a", "T4b", "T4c", "T4d"],
    n: ["N0", "N0(i+)", "N1mi", "N1a", "N1b", "N1c", "N2a", "N2b", "N3a", "N3b", "N3c"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  lung: {
    label: "Lung",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1mi", "T1a", "T1b", "T1c", "T2a", "T2b", "T3", "T4"],
    n: ["N0", "N1", "N2", "N3"],
    m: ["M0", "M1a", "M1b", "M1c"],
    evidence: AJCC_EVIDENCE,
  },
  prostate: {
    label: "Prostate",
    staging_system: "AJCC",
    edition: "8th",
    t: ["T2", "T3a", "T3b", "T4"],
    n: ["N0", "N1"],
    m: ["M0", "M1a", "M1b", "M1c"],
    evidence: AJCC_EVIDENCE,
  },
  esophagus: {
    label: "Oesophagus and gastro-oesophageal junction",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T2", "T3", "T4a", "T4b"],
    n: ["N0", "N1", "N2", "N3"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  stomach: {
    label: "Stomach",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T2", "T3", "T4a", "T4b"],
    n: ["N0", "N1", "N2", "N3a", "N3b"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  anus: {
    label: "Anal canal",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1", "T2", "T3", "T4"],
    n: ["N0", "N1a", "N1b", "N1c", "N2", "N3"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  pancreas: {
    label: "Pancreas",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T1c", "T2", "T3", "T4"],
    n: ["N0", "N1", "N2"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  liver: {
    label: "Liver",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T2", "T3", "T4"],
    n: ["N0", "N1"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  biliary: {
    label: "Gallbladder and extrahepatic bile duct",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T2a", "T2b", "T3", "T4"],
    n: ["N0", "N1", "N2"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  endometrium: {
    label: "Endometrium / uterus",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T2", "T3a", "T3b", "T4"],
    n: ["N0", "N0(i+)", "N1mi", "N1a", "N2mi", "N2a", "N2b"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  ovary: {
    label: "Ovary, fallopian tube and primary peritoneum",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T1c", "T2a", "T2b", "T2c", "T3a", "T3b", "T3c"],
    n: ["N0", "N0(i+)", "N1a", "N1b"],
    m: ["M0", "M1a", "M1b"],
    evidence: AJCC_EVIDENCE,
  },
  cervix: {
    label: "Cervix",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a1", "T1a2", "T1b1", "T1b2", "T1b3", "T2a1", "T2a2", "T2b", "T3a", "T3b", "T4"],
    n: ["N0", "N0(i+)", "N1", "N2"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  "oral-cavity": {
    label: "Oral cavity",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1", "T2", "T3", "T4a", "T4b"],
    n: ["N0", "N1", "N2a", "N2b", "N2c", "N3a", "N3b"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  larynx: {
    label: "Larynx, hypopharynx and trachea",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1", "T2", "T3", "T4a", "T4b"],
    n: ["N0", "N1", "N2a", "N2b", "N2c", "N3a", "N3b"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  // AJCC 8th splits oropharyngeal N by p16 status. This config carries the union
  // of both pathways so a case is recordable either way; the p16 status is on the
  // synoptic record, and the stage calculation upstream is what applies the
  // correct branch.
  oropharynx: {
    label: "Oropharynx",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1", "T2", "T3", "T4", "T4a", "T4b"],
    n: ["N0", "N1", "N2", "N2a", "N2b", "N2c", "N3", "N3a", "N3b"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  salivary: {
    label: "Major salivary gland",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1", "T2", "T3", "T4a", "T4b"],
    n: ["N0", "N1", "N2a", "N2b", "N2c", "N3a", "N3b"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  thyroid: {
    label: "Thyroid (differentiated)",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T2", "T3a", "T3b", "T4a", "T4b"],
    n: ["N0", "N0a", "N0b", "N1a", "N1b"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  kidney: {
    label: "Kidney",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T2a", "T2b", "T3a", "T3b", "T3c", "T4"],
    n: ["N0", "N1"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  bladder: {
    label: "Urinary bladder",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "Ta", "T1", "T2", "T3a", "T3b", "T4a", "T4b"],
    n: ["N0", "N1", "N2", "N3"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  testis: {
    label: "Testis",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1", "T2", "T3", "T4"],
    n: ["N0", "N1", "N2", "N3"],
    m: ["M0", "M1a", "M1b"],
    evidence: AJCC_EVIDENCE,
  },
  melanoma: {
    label: "Cutaneous melanoma",
    staging_system: "AJCC",
    edition: "8th",
    t: ["Tis", "T1a", "T1b", "T2a", "T2b", "T3a", "T3b", "T4a", "T4b"],
    n: ["N0", "N1a", "N1b", "N1c", "N2a", "N2b", "N2c", "N3a", "N3b", "N3c"],
    m: ["M0", "M1a", "M1b", "M1c", "M1d"],
    evidence: AJCC_EVIDENCE,
  },
  sarcoma: {
    label: "Soft tissue sarcoma",
    staging_system: "AJCC",
    edition: "8th",
    t: ["T1", "T2", "T3", "T4"],
    n: ["N0", "N1"],
    m: ["M0", "M1"],
    evidence: AJCC_EVIDENCE,
  },
  // Primary CNS tumours are not staged by the AJCC TNM system — CAP and WHO grade
  // them by histology and extent of resection instead. The entry exists so the
  // site resolves and the tab says so explicitly rather than offering categories
  // that do not exist for it.
  glioma: {
    label: "Central nervous system (not TNM-staged)",
    staging_system: "WHO CNS 5th edition",
    edition: "5th",
    t: ["Not applicable"],
    n: ["Not applicable"],
    m: ["Not applicable"],
    evidence: AJCC_EVIDENCE,
  },
  // Lymphoma is staged by the Lugano classification, not TNM. Same reasoning as CNS.
  lymphoma: {
    label: "Lymphoma (Lugano, not TNM-staged)",
    staging_system: "Lugano",
    edition: "2014",
    t: ["Not applicable"],
    n: ["Not applicable"],
    m: ["Not applicable"],
    evidence: AJCC_EVIDENCE,
  },
};

export const TNM_SITE_OPTIONS = Object.entries(TNM_SITE_CONFIG).map(([value, config]) => ({ value, label: config.label }));
export const TNM_PREFIX_OPTIONS = ["", "y", "r", "a"];
export const RESPONSE_GRADE_OPTIONS = ["", "Not applicable", "No response", "Partial response", "Major response", "Complete response"];

export function getTnmConfig(site) {
  return TNM_SITE_CONFIG[site] || null;
}

// Comparison is on a hyphen-normalised string so a free-text suspected site
// ("Oral Cavity", "oral_cavity") still resolves to the hyphenated key.
export function inferTnmSite(synoptic = {}, caseRegister = {}) {
  const raw = synoptic.site || synoptic.template_selection?.site || caseRegister?.clinical_context?.suspected_primary_site || "";
  const normalized = String(raw).toLowerCase().replace(/[\s_]+/g, "-");
  return Object.keys(TNM_SITE_CONFIG).find((site) => normalized === site || normalized.includes(site)) || "";
}
