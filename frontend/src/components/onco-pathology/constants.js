// constants.js — Dropdown option lists for the Onco-Pathology module.
//
// Phase 1 (Case Registry) only needs departments + sex. The remaining lists
// (grossing / synoptic / AJCC-8 TNM) are scaffolded here for later tabs; the
// per-site synoptic field schema is owned/defined separately by the user.

// ─── Case Registry ─────────────────────────────────────────────────────────
export const DEPARTMENTS = [
  "Surgical Oncology",
  "Medical Oncology",
  "Radiation Oncology",
  "Pathology",
  "Radiology",
  "Gastroenterology",
  "Pulmonology",
  "Gynecologic Oncology",
  "Urology",
  "Head and Neck Surgery",
  "Neurosurgery",
  "Orthopaedic Oncology",
  "Dermatology",
  "Haematology",
  "General Surgery",
  "Internal Medicine",
  "Emergency Medicine",
  "Other",
];

export const SEX_OPTIONS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
];

export const PRIORITY_OPTIONS = ["Routine", "Urgent", "STAT"];

export const PATIENT_STATUS_OPTIONS = ["New", "Existing"];

export const CASE_REASON_OPTIONS = [
  { value: "suspected_malignancy", label: "Suspected malignancy" },
  { value: "follow_up", label: "Follow-up" },
  { value: "staging", label: "Staging" },
  { value: "treatment_response", label: "Treatment response" },
  { value: "other", label: "Other" },
];

export const REQUESTED_TEST_OPTIONS = [
  "Histology",
  "IHC",
  "Molecular",
  "FISH / ISH",
  "Frozen Section",
  "Cytology",
  "Other",
];

export const SPECIMEN_TYPE_OPTIONS = [
  "Core biopsy",
  "Excision biopsy",
  "Incision biopsy",
  "Endoscopic biopsy",
  "Punch biopsy",
  "Shave biopsy",
  "Curettage",
  "Resection specimen",
  "Lymph-node specimen",
  "Fine-needle aspiration",
  "Fluid / effusion",
  "Brushings / washings",
  "Bone marrow",
  "Cell block",
  "Other",
];

export const LATERALITY_OPTIONS = [
  "Not applicable",
  "Right",
  "Left",
  "Bilateral",
  "Midline",
  "Unknown",
];

export const VERIFICATION_OPTIONS = ["Verified", "Not verified", "Discrepancy"];

export const YES_NO_UNKNOWN_OPTIONS = ["Yes", "No", "Unknown"];

export const SPECIMEN_INTEGRITY_OPTIONS = ["Adequate", "Inadequate", "Compromised"];

export const ACCESSION_CONTAINER_TYPES = [
  "Jar",
  "Vial",
  "Tube",
  "Syringe",
  "Slide holder",
  "Specimen bag",
  "Fresh container",
  "Other",
];

export const FIXATIVE_TRANSPORT_OPTIONS = [
  "10% Neutral Buffered Formalin",
  "Alcohol",
  "Normal saline",
  "RPMI",
  "Cytology fixative",
  "Fresh / unfixed",
  "Other",
];

// ─── Grossing Bench ─────────────────────────────────────────────────────────
export const CONTAINER_TYPES = ["Jar", "Cassette", "Bag"];

export const FIXATIVES = [
  "10% Neutral Buffered Formalin",
  "Alcohol",
  "Fresh (Not Fixed)",
];

export const GROSS_COLORS = [
  "Grey-white", "Tan", "Pink", "Yellow", "Brown", "Hemorrhagic", "Mixed",
];

export const CONSISTENCIES = ["Soft", "Firm", "Hard", "Friable", "Rubbery"];

export const TUMOR_CONFIGURATIONS = [
  "Ulcerated", "Polypoid", "Fungating", "Flat", "Infiltrative",
];

// ─── Case status lifecycle ─────────────────────────────────────────────────
export const CASE_STATUS = {
  ACCESSIONED: "Accessioned",
  GROSSED: "Grossed",
  REPORTED: "Reported",
  SIGNED_OUT: "Signed-out",
};

// ─── Molecular & Genomic Testing — gene / target vocabulary ──────────────────
// The reference list behind the "Genes / Targets Tested" picker on Tab I
// (molecular). It is deliberately NOT a claim about what any laboratory's panel
// contains: the assay actually run is recorded by panel_name + panel_version on
// the order, and nothing in validation compares this list against them. A
// laboratory's panel changes faster than any list shipped in code, so genes
// outside this list stay freely typeable and an off-list gene is a normal entry,
// not a discrepancy.
//
// `group` exists only to make the picker browsable, and the picker filters
// across every group at once — a gene filed under one organ system is still
// found when ordering for another (TP53 and the fusion genes are the common
// cases). It is a browse hint, never a clinical claim about where a gene belongs.
//
// `alteration` reuses the VARIANT_TYPE_OPTIONS vocabulary where it fits
// (SNV / indel, Fusion, Amplification, Deletion / loss, Rearrangement) and adds
// "Promoter mutation" for TERT. `action` says what the finding unlocks — a
// therapy class, a diagnostic classification, or risk — and stays generic by
// design: brand selection and approval status are not this module's business.
// `note` is written only where a real caveat would otherwise produce a wrong
// report — an assay that cannot see the alteration, a class of variant the
// therapy does not cover, or a finding that needs a germline confirmation before
// it is reported as somatic.
//
// Keep `note` for that purpose only; a gene with nothing to warn about carries no
// note, so the notes that exist stay worth reading.
export const MOLECULAR_GENES = [
  // ── Lung / thoracic ──
  {
    gene: "EGFR",
    label: "EGFR — epidermal growth factor receptor",
    group: "Lung / thoracic",
    alteration: "Activating SNV / indel (ex19del, L858R); exon 20 insertion; amplification",
    action: "EGFR tyrosine-kinase inhibitor therapy",
    note: "State an exon 20 insertion explicitly — \"EGFR mutated\" alone reads as TKI-sensitive, and exon 20 insertions do not respond to first- or second-generation TKIs.",
  },
  {
    gene: "ALK",
    label: "ALK — anaplastic lymphoma kinase",
    group: "Lung / thoracic",
    alteration: "Fusion (EML4-ALK and partners); acquired point mutations on therapy",
    action: "ALK inhibitor therapy",
    note: "Fusion detection needs RNA, or a DNA assay with intron coverage — a negative DNA hotspot result does not exclude a fusion.",
  },
  {
    gene: "ROS1",
    label: "ROS1 — ROS proto-oncogene 1",
    group: "Lung / thoracic",
    alteration: "Fusion",
    action: "ROS1 inhibitor therapy",
    note: "As with ALK, a DNA hotspot panel reports a fusion as wild type; confirm the assay detects rearrangements before reporting a negative.",
  },
  {
    gene: "KRAS",
    label: "KRAS — KRAS proto-oncogene",
    group: "Lung / thoracic",
    alteration: "SNV (codons 12, 13, 61); amplification",
    action: "G12C inhibitor therapy in lung cancer; anti-EGFR resistance in colorectal cancer",
    note: "Only G12C is drugged, and in colorectal cancer G12C inhibition also requires EGFR blockade — the codon must be stated.",
  },
  {
    gene: "MET",
    label: "MET — MET proto-oncogene",
    group: "Lung / thoracic",
    alteration: "Exon 14 skipping; amplification",
    action: "MET inhibitor therapy",
    note: "Exon 14 skipping requires intron coverage — a DNA hotspot panel reports it as wild type.",
  },
  {
    gene: "STK11",
    label: "STK11 — serine/threonine kinase 11",
    group: "Lung / thoracic",
    alteration: "Deletion / loss; SNV",
    action: "No direct therapy — predicts poor response to immune checkpoint inhibitors",
  },
  {
    gene: "KEAP1",
    label: "KEAP1 — kelch-like ECH-associated protein 1",
    group: "Lung / thoracic",
    alteration: "Deletion / loss; SNV",
    action: "No direct therapy — prognostic in lung cancer",
  },
  {
    gene: "SMARCA4",
    label: "SMARCA4 — SWI/SNF related, matrix associated, actin dependent regulator of chromatin",
    group: "Lung / thoracic",
    alteration: "Deletion / loss; SNV",
    action: "Diagnostic — SMARCA4-deficient undifferentiated tumour",
  },

  // ── Colorectal / gastro-intestinal ──
  {
    gene: "NRAS",
    label: "NRAS — NRAS proto-oncogene",
    group: "Colorectal / gastro-intestinal",
    alteration: "SNV (codons 12, 13, 61)",
    action: "Anti-EGFR resistance in colorectal cancer",
    note: "Extended RAS testing — NRAS is reported alongside KRAS before anti-EGFR therapy; either gene mutated excludes it.",
  },
  {
    gene: "IDH1",
    label: "IDH1 — isocitrate dehydrogenase 1",
    group: "Colorectal / gastro-intestinal",
    alteration: "SNV (R132)",
    action: "IDH1 inhibitor therapy in cholangiocarcinoma and acute myeloid leukaemia",
  },
  {
    gene: "FGFR2",
    label: "FGFR2 — fibroblast growth factor receptor 2",
    group: "Colorectal / gastro-intestinal",
    alteration: "Fusion",
    action: "FGFR inhibitor therapy in cholangiocarcinoma",
    note: "Fusion detection needs RNA — a DNA hotspot panel reports it as wild type.",
  },
  {
    gene: "POLE",
    label: "POLE — DNA polymerase epsilon",
    group: "Colorectal / gastro-intestinal",
    alteration: "SNV (exonuclease domain)",
    action: "Ultramutated phenotype — immune checkpoint inhibitor consideration",
    note: "Only pathogenic exonuclease-domain variants in the hotspot region carry this meaning; a variant of uncertain significance does not.",
  },
  {
    gene: "APC",
    label: "APC — APC regulator of WNT signalling pathway",
    group: "Colorectal / gastro-intestinal",
    alteration: "Deletion / loss; SNV",
    action: "Diagnostic — adenomatous polyposis pathway",
    note: "A panel-detected APC variant may be germline — confirm on a germline sample before reporting it as somatic.",
  },
  {
    gene: "SMAD4",
    label: "SMAD4 — SMAD family member 4",
    group: "Colorectal / gastro-intestinal",
    alteration: "Deletion / loss; SNV",
    action: "Prognostic in colorectal and pancreatic cancer",
  },
  {
    gene: "CTNNB1",
    label: "CTNNB1 — catenin beta 1",
    group: "Colorectal / gastro-intestinal",
    alteration: "SNV (exon 3)",
    action: "Diagnostic — hepatocellular adenoma and endometrial carcinoma",
  },

  // ── Breast / gynaecological ──
  {
    gene: "BRCA1",
    label: "BRCA1 — BRCA1 DNA repair associated",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV / indel",
    action: "PARP inhibitor therapy and platinum sensitivity",
    note: "A panel-detected BRCA1 variant may be germline — confirm on a germline sample before reporting it as somatic.",
  },
  {
    gene: "BRCA2",
    label: "BRCA2 — BRCA2 DNA repair associated",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV / indel",
    action: "PARP inhibitor therapy and platinum sensitivity",
    note: "A panel-detected BRCA2 variant may be germline — confirm on a germline sample before reporting it as somatic.",
  },
  {
    gene: "PALB2",
    label: "PALB2 — partner and localizer of BRCA2",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV / indel",
    action: "PARP inhibitor and platinum consideration",
  },
  {
    gene: "PIK3CA",
    label: "PIK3CA — phosphatidylinositol-4,5-bisphosphate 3-kinase catalytic subunit alpha",
    group: "Breast / gynaecological",
    alteration: "SNV (E542K, E545K, H1047R)",
    action: "PI3K inhibitor therapy in hormone-receptor-positive breast cancer",
  },
  {
    gene: "ESR1",
    label: "ESR1 — estrogen receptor 1",
    group: "Breast / gynaecological",
    alteration: "SNV (ligand-binding domain, e.g. Y537S, D538G)",
    action: "Acquired resistance to endocrine therapy",
    note: "Usually acquired under treatment — a baseline result is expected to be negative, so a negative does not exclude later resistance.",
  },
  {
    gene: "PTEN",
    label: "PTEN — phosphatase and tensin homolog",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV",
    action: "PI3K-pathway activation; prognostic",
    note: "A germline PTEN variant causes Cowden syndrome — confirm on a germline sample before reporting a panel-detected variant as somatic.",
  },
  {
    gene: "AKT1",
    label: "AKT1 — AKT serine/threonine kinase 1",
    group: "Breast / gynaecological",
    alteration: "SNV (E17K)",
    action: "AKT inhibitor therapy in breast cancer",
  },
  {
    gene: "ATM",
    label: "ATM — ATM serine/threonine kinase",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV / indel",
    action: "Homologous-recombination deficiency — PARP inhibitor and platinum consideration",
    note: "A germline ATM variant carries familial risk, and a somatic variant has no PARP indication on its own — the origin must be stated on the variant row.",
  },
  {
    gene: "CHEK2",
    label: "CHEK2 — checkpoint kinase 2",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV (1100delC)",
    action: "Homologous-recombination deficiency — germline referral",
  },
  {
    gene: "CDH1",
    label: "CDH1 — cadherin 1",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV / indel",
    action: "Diagnostic — hereditary diffuse gastric cancer and lobular breast cancer",
    note: "Almost always germline — a panel-detected CDH1 variant must be confirmed on a germline sample before it is reported as somatic.",
  },
  {
    gene: "RAD51C",
    label: "RAD51C — RAD51 paralog C",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV / indel",
    action: "Homologous-recombination deficiency — germline referral",
  },
  {
    gene: "RAD51D",
    label: "RAD51D — RAD51 paralog D",
    group: "Breast / gynaecological",
    alteration: "Deletion / loss; SNV / indel",
    action: "Homologous-recombination deficiency — germline referral",
  },

  // ── Prostate / genitourinary ──
  {
    gene: "AR",
    label: "AR — androgen receptor",
    group: "Prostate / genitourinary",
    alteration: "Amplification; SNV; splice variant (AR-V7)",
    action: "Resistance to androgen-receptor-directed therapy",
  },
  {
    gene: "CDK12",
    label: "CDK12 — cyclin dependent kinase 12",
    group: "Prostate / genitourinary",
    alteration: "Deletion / loss; SNV / indel",
    action: "Homologous-recombination deficiency in prostate cancer — PARP inhibitor consideration",
  },
  {
    gene: "RAD51B",
    label: "RAD51B — RAD51 paralog B",
    group: "Prostate / genitourinary",
    alteration: "Deletion / loss; SNV / indel",
    action: "Homologous-recombination deficiency in prostate cancer",
  },
  {
    gene: "RB1",
    label: "RB1 — RB transcriptional corepressor 1",
    group: "Prostate / genitourinary",
    alteration: "Deletion / loss; SNV",
    action: "Aggressive variant prostate cancer — prognostic",
  },
  {
    gene: "FGFR3",
    label: "FGFR3 — fibroblast growth factor receptor 3",
    group: "Prostate / genitourinary",
    alteration: "SNV (R248C, S249C); fusion",
    action: "FGFR inhibitor therapy in urothelial carcinoma",
  },
  {
    gene: "VHL",
    label: "VHL — von Hippel-Lindau tumour suppressor",
    group: "Prostate / genitourinary",
    alteration: "Deletion / loss; SNV",
    action: "Diagnostic in clear-cell renal cell carcinoma",
    note: "A germline VHL variant causes von Hippel-Lindau disease — confirm on a germline sample before reporting a panel-detected variant as somatic.",
  },
  {
    gene: "PBRM1",
    label: "PBRM1 — polybromo 1",
    group: "Prostate / genitourinary",
    alteration: "Deletion / loss; SNV",
    action: "Prognostic in renal cell carcinoma",
  },

  // ── Melanoma / skin ──
  {
    gene: "GNAQ",
    label: "GNAQ — G protein subunit alpha q",
    group: "Melanoma / skin",
    alteration: "SNV (Q209, R183)",
    action: "Diagnostic in uveal melanoma; targeted therapy remains investigational",
  },
  {
    gene: "GNA11",
    label: "GNA11 — G protein subunit alpha 11",
    group: "Melanoma / skin",
    alteration: "SNV (Q209, R183)",
    action: "Diagnostic in uveal melanoma; targeted therapy remains investigational",
  },
  {
    gene: "MITF",
    label: "MITF — melanocyte inducing transcription factor",
    group: "Melanoma / skin",
    alteration: "Amplification; germline E318K",
    action: "Prognostic in melanoma",
  },
  {
    gene: "CDKN2A",
    label: "CDKN2A — cyclin dependent kinase inhibitor 2A",
    group: "Melanoma / skin",
    alteration: "Deletion / loss; SNV",
    action: "Prognostic in melanoma and head and neck cancer",
    note: "A germline CDKN2A variant causes the melanoma–pancreatic cancer syndrome — confirm on a germline sample before reporting a panel-detected variant as somatic.",
  },
  {
    gene: "BAP1",
    label: "BAP1 — BRCA1 associated protein 1",
    group: "Melanoma / skin",
    alteration: "Deletion / loss; SNV",
    action: "Prognostic in uveal melanoma",
    note: "A germline BAP1 variant predisposes to melanoma, mesothelioma and renal cell carcinoma — confirm on a germline sample before reporting a panel-detected variant as somatic.",
  },

  // ── CNS ──
  {
    gene: "IDH2",
    label: "IDH2 — isocitrate dehydrogenase 2",
    group: "CNS",
    alteration: "SNV (R140, R172)",
    action: "Diagnostic classification of glioma; IDH inhibitor therapy",
  },
  {
    gene: "H3-3A",
    label: "H3-3A — H3.3 histone A (H3F3A)",
    group: "CNS",
    alteration: "SNV (K27M)",
    action: "Diagnostic — diffuse midline glioma",
  },
  {
    gene: "ATRX",
    label: "ATRX — ATRX chromatin remodeler",
    group: "CNS",
    alteration: "Deletion / loss; SNV",
    action: "Diagnostic classification of IDH-mutant astrocytoma",
  },

  // ── Head & neck / thyroid ──
  {
    gene: "HRAS",
    label: "HRAS — HRas proto-oncogene",
    group: "Head & neck / thyroid",
    alteration: "SNV (codons 12, 13, 61)",
    action: "Prognostic in head and neck cancer and thyroid nodules",
  },
  {
    gene: "NOTCH1",
    label: "NOTCH1 — notch receptor 1",
    group: "Head & neck / thyroid",
    alteration: "Deletion / loss; SNV",
    action: "Prognostic in head and neck squamous carcinoma",
  },

  // ── Sarcoma / soft tissue ──
  {
    gene: "EWSR1",
    label: "EWSR1 — EWS RNA binding protein 1",
    group: "Sarcoma / soft tissue",
    alteration: "Fusion (EWSR1-FLI1 and partners)",
    action: "Diagnostic — Ewing sarcoma and EWSR1-rearranged tumours",
  },
  {
    gene: "SS18",
    label: "SS18 — SS18 subunit of BAF chromatin remodeling complex",
    group: "Sarcoma / soft tissue",
    alteration: "Fusion (SS18-SSX)",
    action: "Diagnostic — synovial sarcoma",
  },
  {
    gene: "FOXO1",
    label: "FOXO1 — forkhead box O1",
    group: "Sarcoma / soft tissue",
    alteration: "Fusion (PAX3/PAX7-FOXO1)",
    action: "Diagnostic — alveolar rhabdomyosarcoma",
  },
  {
    gene: "TFE3",
    label: "TFE3 — transcription factor binding to IGHM enhancer 3",
    group: "Sarcoma / soft tissue",
    alteration: "Fusion; amplification",
    action: "Diagnostic — MiT-family translocation renal cell carcinoma and PEComa",
  },
  {
    gene: "TFEB",
    label: "TFEB — transcription factor EB",
    group: "Sarcoma / soft tissue",
    alteration: "Fusion; amplification",
    action: "Diagnostic — MiT-family translocation renal cell carcinoma and PEComa",
  },
  {
    gene: "MDM2",
    label: "MDM2 — MDM2 proto-oncogene",
    group: "Sarcoma / soft tissue",
    alteration: "Amplification",
    action: "Diagnostic — well-differentiated and dedifferentiated liposarcoma; MDM2 inhibitors remain investigational",
  },
  {
    gene: "CDK4",
    label: "CDK4 — cyclin dependent kinase 4",
    group: "Sarcoma / soft tissue",
    alteration: "Amplification",
    action: "Diagnostic — well-differentiated and dedifferentiated liposarcoma",
  },
  {
    gene: "PDGFRA",
    label: "PDGFRA — platelet derived growth factor receptor alpha",
    group: "Sarcoma / soft tissue",
    alteration: "SNV (D842V and other activating variants); amplification",
    action: "GIST — the inhibitor choice depends on the codon mutated",
    note: "D842V does not respond to imatinib — state the codon rather than \"PDGFRA mutated\".",
  },
  {
    gene: "SDHB",
    label: "SDHB — succinate dehydrogenase complex iron sulfur subunit B",
    group: "Sarcoma / soft tissue",
    alteration: "Deletion / loss; SNV",
    action: "Diagnostic — SDH-deficient GIST, paraganglioma and phaeochromocytoma",
    note: "Almost always germline — confirm on a germline sample before reporting a panel-detected variant as somatic.",
  },
  {
    gene: "NUTM1",
    label: "NUTM1 — NUT midline carcinoma family member 1",
    group: "Sarcoma / soft tissue",
    alteration: "Fusion",
    action: "Diagnostic — NUT midline carcinoma",
  },
  {
    gene: "KIT",
    label: "KIT — KIT proto-oncogene, receptor tyrosine kinase",
    group: "Sarcoma / soft tissue",
    alteration: "SNV (exons 9, 11, 13, 17); amplification",
    action: "GIST — imatinib response depends on the exon mutated",
    note: "Exon 11 and exon 9 respond to imatinib at different doses, and exon 17 mutations do not respond at all — the exon must be stated.",
  },

  // ── Myeloid ──
  {
    gene: "FLT3",
    label: "FLT3 — fms related receptor tyrosine kinase 3",
    group: "Myeloid",
    alteration: "Internal tandem duplication; tyrosine-kinase-domain SNV (D835)",
    action: "FLT3 inhibitor therapy in acute myeloid leukaemia",
    note: "The ITD allelic ratio stratifies risk, so the ratio must be reported alongside the mutation, and ITD must be distinguished from a TKD point mutation.",
  },
  {
    gene: "NPM1",
    label: "NPM1 — nucleophosmin 1",
    group: "Myeloid",
    alteration: "Insertion (exon 12)",
    action: "Favourable-risk acute myeloid leukaemia; measurable residual disease marker",
  },
  {
    gene: "CEBPA",
    label: "CEBPA — CCAAT enhancer binding protein alpha",
    group: "Myeloid",
    alteration: "SNV / indel (biallelic)",
    action: "Favourable-risk acute myeloid leukaemia",
    note: "Only biallelic mutation carries the favourable risk — a single CEBPA variant must not be reported as favourable-risk disease.",
  },
  {
    gene: "JAK2",
    label: "JAK2 — Janus kinase 2",
    group: "Myeloid",
    alteration: "SNV (V617F); exon 12 indel",
    action: "Diagnostic in myeloproliferative neoplasms; JAK inhibitor therapy",
  },
  {
    gene: "CALR",
    label: "CALR — calreticulin",
    group: "Myeloid",
    alteration: "Indel (exon 9)",
    action: "Diagnostic — essential thrombocythaemia and primary myelofibrosis",
  },
  {
    gene: "MPL",
    label: "MPL — MPL proto-oncogene, thrombopoietin receptor",
    group: "Myeloid",
    alteration: "SNV (W515)",
    action: "Diagnostic in myeloproliferative neoplasms",
  },
  {
    gene: "BCR::ABL1",
    label: "BCR::ABL1 — BCR activator of RhoGEF and GTPase :: ABL proto-oncogene 1",
    group: "Myeloid",
    alteration: "Rearrangement (t(9;22))",
    action: "Chronic myeloid leukaemia and acute lymphoblastic leukaemia — tyrosine-kinase inhibitor therapy",
    note: "Monitoring is by a standardised quantitative PCR assay, not by a panel — a panel result is diagnostic, not a monitoring value.",
  },
  {
    gene: "KMT2A",
    label: "KMT2A — lysine methyltransferase 2A (MLL)",
    group: "Myeloid",
    alteration: "Rearrangement",
    action: "Adverse-risk acute myeloid and lymphoblastic leukaemia; menin inhibitors remain investigational",
  },
  {
    gene: "WT1",
    label: "WT1 — WT1 transcription factor",
    group: "Myeloid",
    alteration: "SNV / indel",
    action: "Measurable residual disease marker in acute myeloid leukaemia",
  },
  {
    gene: "CSF3R",
    label: "CSF3R — colony stimulating factor 3 receptor",
    group: "Myeloid",
    alteration: "SNV (T618I)",
    action: "Diagnostic — chronic neutrophilic leukaemia",
  },
  {
    gene: "RUNX1",
    label: "RUNX1 — RUNX family transcription factor 1",
    group: "Myeloid",
    alteration: "Deletion / loss; SNV / indel",
    action: "Adverse-risk acute myeloid leukaemia and myelodysplastic syndrome (ELN risk stratification)",
  },
  {
    gene: "ASXL1",
    label: "ASXL1 — ASXL transcriptional regulator 1",
    group: "Myeloid",
    alteration: "Deletion / loss; SNV / indel",
    action: "Adverse-risk acute myeloid leukaemia and myelodysplastic syndrome (ELN risk stratification)",
  },
  {
    gene: "SRSF2",
    label: "SRSF2 — serine and arginine rich splicing factor 2",
    group: "Myeloid",
    alteration: "SNV (P95)",
    action: "Adverse-risk acute myeloid leukaemia and myelodysplastic syndrome (ELN risk stratification)",
  },
  {
    gene: "SF3B1",
    label: "SF3B1 — splicing factor 3b subunit 1",
    group: "Myeloid",
    alteration: "SNV (K700E)",
    action: "Diagnostic in myelodysplastic syndrome with ring sideroblasts; prognostic in acute myeloid leukaemia",
  },
  {
    gene: "TET2",
    label: "TET2 — tet methylcytosine dioxygenase 2",
    group: "Myeloid",
    alteration: "Deletion / loss; SNV / indel",
    action: "Clonal haematopoiesis and myelodysplastic syndrome — prognostic",
    note: "Common in clonal haematopoiesis of indeterminate potential in older patients — a low-variant-allele-fraction TET2 finding in an older patient may not be the disease.",
  },
  {
    gene: "DNMT3A",
    label: "DNMT3A — DNA methyltransferase 3 alpha",
    group: "Myeloid",
    alteration: "SNV / indel",
    action: "Clonal haematopoiesis and myelodysplastic syndrome — prognostic",
  },
  {
    gene: "EZH2",
    label: "EZH2 — enhancer of zeste 2 polycomb repressive complex 2 subunit",
    group: "Myeloid",
    alteration: "Deletion / loss; SNV / indel",
    action: "Adverse-risk myelodysplastic syndrome; EZH2 inhibitor therapy in follicular lymphoma",
  },
  {
    gene: "ZRSR2",
    label: "ZRSR2 — zinc finger CCCH-type, RNA binding motif and serine/arginine rich 2",
    group: "Myeloid",
    alteration: "SNV / indel (X-linked)",
    action: "Myelodysplastic syndrome — prognostic",
  },
  {
    gene: "STAG2",
    label: "STAG2 — stromal antigen 2",
    group: "Myeloid",
    alteration: "Deletion / loss; SNV / indel",
    action: "Myelodysplastic syndrome and acute myeloid leukaemia — prognostic",
  },
  {
    gene: "BCOR",
    label: "BCOR — BCL6 corepressor",
    group: "Myeloid",
    alteration: "Deletion / loss; SNV / indel",
    action: "Myelodysplastic syndrome and acute myeloid leukaemia — prognostic",
  },

  // ── Lymphoid ──
  {
    gene: "MYD88",
    label: "MYD88 — MYD88 innate immune signal transduction adaptor",
    group: "Lymphoid",
    alteration: "SNV (L265P)",
    action: "Diagnostic — lymphoplasmacytic lymphoma / Waldenström macroglobulinaemia",
  },
  {
    gene: "CD79B",
    label: "CD79B — CD79b molecule",
    group: "Lymphoid",
    alteration: "SNV (Y196)",
    action: "With MYD88, predicts BTK-inhibitor response in diffuse large B-cell lymphoma",
  },
  {
    gene: "BIRC3",
    label: "BIRC3 — baculoviral IAP repeat containing 3",
    group: "Lymphoid",
    alteration: "Deletion / loss; SNV",
    action: "Adverse prognostic in chronic lymphocytic leukaemia",
  },
  {
    gene: "BTK",
    label: "BTK — Bruton tyrosine kinase",
    group: "Lymphoid",
    alteration: "SNV (C481S and others)",
    action: "Acquired resistance to covalent BTK inhibitors",
    note: "A resistance marker found on progression — it is not a baseline finding.",
  },
  {
    gene: "BCL2",
    label: "BCL2 — BCL2 apoptosis regulator",
    group: "Lymphoid",
    alteration: "Rearrangement (t(14;18)); amplification",
    action: "Diagnostic in follicular lymphoma; BCL2 inhibitor therapy in chronic lymphocytic leukaemia",
  },
  {
    gene: "BCL6",
    label: "BCL6 — BCL6 transcription repressor",
    group: "Lymphoid",
    alteration: "Rearrangement",
    action: "Diagnostic in diffuse large B-cell lymphoma",
  },
  {
    gene: "MYC",
    label: "MYC — MYC proto-oncogene, bHLH transcription factor",
    group: "Lymphoid",
    alteration: "Rearrangement; amplification",
    action: "Diagnostic — Burkitt lymphoma and high-grade B-cell lymphoma",
    note: "A MYC rearrangement alone does not make a high-grade B-cell lymphoma — it is read together with BCL2 and BCL6.",
  },

  // ── Pan-tumour / agnostic ──
  // Genes whose indication does not depend on the organ of origin.
  {
    gene: "NTRK1",
    label: "NTRK1 — neurotrophic receptor tyrosine kinase 1",
    group: "Pan-tumour / agnostic",
    alteration: "Fusion",
    action: "Tumour-agnostic TRK inhibitor therapy",
    note: "Fusion detection needs RNA, or a DNA assay with intron coverage — a negative DNA hotspot result does not exclude a fusion.",
  },
  {
    gene: "NTRK2",
    label: "NTRK2 — neurotrophic receptor tyrosine kinase 2",
    group: "Pan-tumour / agnostic",
    alteration: "Fusion",
    action: "Tumour-agnostic TRK inhibitor therapy",
    note: "Fusion detection needs RNA, or a DNA assay with intron coverage — a negative DNA hotspot result does not exclude a fusion.",
  },
  {
    gene: "NTRK3",
    label: "NTRK3 — neurotrophic receptor tyrosine kinase 3",
    group: "Pan-tumour / agnostic",
    alteration: "Fusion",
    action: "Tumour-agnostic TRK inhibitor therapy",
    note: "Fusion detection needs RNA, or a DNA assay with intron coverage — a negative DNA hotspot result does not exclude a fusion.",
  },
  {
    gene: "BRAF",
    label: "BRAF — B-Raf proto-oncogene, serine/threonine kinase",
    group: "Pan-tumour / agnostic",
    alteration: "SNV (V600E, V600K, non-V600 variants); fusion",
    action: "BRAF/MEK inhibitor therapy — V600E is tumour-agnostic except in colorectal cancer, where EGFR blockade is also required",
    note: "Non-V600 variants are not covered by the V600-directed indication — state the codon, not just \"BRAF mutated\".",
  },
  {
    gene: "RET",
    label: "RET — ret proto-oncogene",
    group: "Pan-tumour / agnostic",
    alteration: "Fusion; activating SNV",
    action: "RET inhibitor therapy in lung and thyroid cancer",
    note: "A germline RET variant causes MEN2 — confirm on a germline sample before reporting an activating RET variant as somatic.",
  },
  {
    gene: "ERBB2",
    label: "ERBB2 — erb-b2 receptor tyrosine kinase 2 (HER2)",
    group: "Pan-tumour / agnostic",
    alteration: "Amplification; SNV; exon 20 insertion",
    action: "Anti-HER2 therapy — the indication depends on tumour type and alteration class",
    note: "Amplification and exon 20 insertion are different findings with different therapy — do not report them under one \"HER2 positive\".",
  },

  // ── Prognostic / classification ──
  // Recorded for coverage and classification rather than as a therapy target.
  {
    gene: "TP53",
    label: "TP53 — tumour protein p53",
    group: "Prognostic / classification",
    alteration: "Deletion / loss; SNV / indel",
    action: "Adverse prognostic across tumour types",
    note: "A germline TP53 variant causes Li-Fraumeni syndrome — confirm on a germline sample before reporting a panel-detected variant as somatic.",
  },
  {
    gene: "TERT",
    label: "TERT — telomerase reverse transcriptase",
    group: "Prognostic / classification",
    alteration: "Promoter mutation (C228T, C250T)",
    action: "Diagnostic and prognostic in glioma, thyroid, bladder and melanoma",
    note: "TERT is a promoter region, not a coding sequence — a panel that covers only exons reports it as wild type.",
  },
];

// Group lookup for the picker: the select is grouped for browsing but filters
// across every group at once, so this map is display-only and the gene symbol
// stays the stored value.
export const MOLECULAR_GENE_GROUP = Object.fromEntries(
  MOLECULAR_GENES.map((entry) => [entry.gene, entry.group])
);
