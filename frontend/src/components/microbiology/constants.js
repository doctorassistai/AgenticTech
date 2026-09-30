// constants.js — Shared enums / option lists for the Microbiology module
//
// Registration (Tab 1) declares a case type that activates or suppresses the
// downstream analytical tracks. The specimen type, transport medium and ordered
// test option lists below feed the specimen table; ordered tests are filtered by
// case type (same field, fewer options) to reduce clutter.

// ─── Case types ───────────────────────────────────────────────────────────────
// Value is what is stored in case_register.case_type; drives sidebar tab
// activation/suppression. `Combined` activates any track independently.
export const CASE_TYPES = [
  { value: "Bacteriology culture", label: "Bacteriology culture" },
  { value: "Serology / antigen", label: "Serology / antigen" },
  { value: "NAAT / molecular", label: "NAAT / molecular" },
  { value: "Mycobacteriology / AFB", label: "Mycobacteriology / AFB" },
  { value: "Parasitology", label: "Parasitology" },
  { value: "Mycology / Fungal", label: "Mycology / Fungal" },
  { value: "Virology serology", label: "Virology serology" },
  { value: "Anaerobic bacteriology", label: "Anaerobic bacteriology" },
  { value: "Pathogen genomics", label: "Pathogen genomics (WGS / mNGS / tNGS)" },
  { value: "Pharmacogenomics / PGx", label: "Pharmacogenomics / PGx" },
  { value: "Combined", label: "Combined" },
];

// ─── Priority ─────────────────────────────────────────────────────────────────
export const PRIORITY_OPTIONS = ["Routine", "Urgent", "STAT"];

// ─── Yes / No / Unknown ───────────────────────────────────────────────────────
export const YES_NO_UNKNOWN_OPTIONS = ["Yes", "No", "Unknown"];
export const YES_NO_OPTIONS = ["Yes", "No"];
export const ADEQUATE_OPTIONS = ["Yes", "No", "Marginal"];

// ─── Specimen types ───────────────────────────────────────────────────────────
// Site-specific sub-types (e.g. right knee joint) are typed under "Site of
// collection", not here. Parasitology / mycology additions live in this same
// list — no new field (per plan).
export const SPECIMEN_TYPE_OPTIONS = [
  "Blood",
  "Blood culture (aerobic bottle)",
  "Blood culture (anaerobic bottle)",
  "Urine",
  "Pus / wound swab",
  "Tissue",
  "Cerebrospinal fluid (CSF)",
  "Sputum",
  "Bronchoalveolar lavage (BALF)",
  "Throat swab",
  "Fluid / aspirate",
  "Stool",
  "Duodenal aspirate",
  "Skin snip",
  "Rectal swab",
  "Genital swab",
  // Genomics. A pure isolate is submitted for bacterial WGS — the direct
  // specimen is not what gets sequenced. Saliva / buccal / DBS exist because a
  // pre-emptive PGx order often happens outside a phlebotomy visit.
  "Saliva",
  "Buccal swab",
  "Dried blood spot (DBS)",
  "Pure culture isolate (sequencing)",
  "Other",
];

// ─── Transport medium / device (CLSI M40-A2 compliant devices recorded) ───────
// Stool: SAF preservative / PVA fixative / plain unpreserved container — the
// choice affects which concentration methods are available in Tab 3. These are
// kept in the same field (no new transport field per specimen).
export const TRANSPORT_MEDIUM_OPTIONS = [
  "Amies with charcoal",
  "Amies without charcoal",
  "Cary-Blair",
  "Stuart's medium",
  "Sterile plain container",
  "Blood culture bottle",
  "SAF preservative (stool)",
  "PVA fixative (stool)",
  "Plain unpreserved container (stool)",
  "EDTA tube (blood film)",
  // Genomics. EDTA whole blood is the PGx / HLA default — a HEPARIN tube is a
  // PCR inhibitor and must be rejected (free-text rejection reason on Tab 1).
  "EDTA whole blood tube (genomics)",
  "Streck cfDNA tube",
  "Oragene saliva kit",
  "Clot tube / serum separator",
  "Transport swab (generic)",
  "Other",
];

// ─── Ordered tests, grouped by track + specimen/case-type filter ──────────────
// Each test carries a stable `value` (this is what is persisted in a specimen's
// tests_ordered and what later tabs key off) plus the case types that may order
// it. A test is offered in the specimen table only when its case type is active
// (Combined offers all). Tests with an empty `types` list are offered for every
// case type.
export const ORDERED_TEST_GROUPS = [
  {
    label: "Direct examination",
    tests: [
      { value: "gram_stain", label: "Gram stain", types: ["Bacteriology culture", "Anaerobic bacteriology"] },
      { value: "afb_smear", label: "AFB smear (ZN / Auramine-O)", types: ["Mycobacteriology / AFB"] },
      { value: "koh_calcofluor", label: "KOH / Calcofluor white", types: ["Mycology / Fungal"] },
      { value: "india_ink", label: "India ink", types: ["Mycology / Fungal"] },
      { value: "wet_prep", label: "Wet preparation", types: ["Bacteriology culture", "Parasitology", "Anaerobic bacteriology"] },
      { value: "ova_parasite_exam", label: "Ova + parasite (O+P) exam", types: ["Parasitology"] },
      { value: "blood_film", label: "Thick / thin blood film", types: ["Parasitology"] },
      { value: "concentration_technique", label: "Concentration technique", types: ["Parasitology"] },
      { value: "permanent_stain", label: "Permanent stain (trichrome / iron haematoxylin)", types: ["Parasitology"] },
    ],
  },
  {
    label: "Culture & sensitivity",
    tests: [
      { value: "culture_aerobic", label: "Culture (aerobic)", types: ["Bacteriology culture", "Mycology / Fungal", "Anaerobic bacteriology"] },
      { value: "culture_anaerobic", label: "Anaerobic culture", types: ["Bacteriology culture", "Anaerobic bacteriology"] },
      { value: "blood_culture", label: "Blood culture", types: ["Bacteriology culture", "Anaerobic bacteriology"] },
      { value: "fungal_culture", label: "Fungal culture (SDA / CHOC)", types: ["Mycology / Fungal"] },
      { value: "lj_mgit_culture", label: "LJ / MGIT culture", types: ["Mycobacteriology / AFB"] },
      { value: "ast", label: "Sensitivity (AST)", types: ["Bacteriology culture", "Mycology / Fungal", "Anaerobic bacteriology", "Mycobacteriology / AFB"] },
    ],
  },
  {
    label: "Molecular / NAAT",
    tests: [
      { value: "gene_xpert", label: "GeneXpert MTB/RIF", types: ["Mycobacteriology / AFB", "NAAT / molecular"] },
      { value: "naat_pcr", label: "Targeted PCR / NAAT", types: ["NAAT / molecular", "Bacteriology culture"] },
      { value: "viral_pcr", label: "Viral PCR / load", types: ["Virology serology", "NAAT / molecular"] },
      { value: "fungal_pcr", label: "Fungal PCR", types: ["Mycology / Fungal", "NAAT / molecular"] },
      { value: "parasite_pcr", label: "Parasite PCR", types: ["Parasitology", "NAAT / molecular"] },
    ],
  },
  {
    label: "Serology / antigen",
    tests: [
      { value: "serology_panel", label: "Serology panel", types: ["Serology / antigen", "Virology serology"] },
      { value: "virology_serology", label: "Virology serology panel", types: ["Virology serology", "Serology / antigen"] },
      { value: "fungal_antigen", label: "Fungal antigen (Galactomannan / Cryptococcal / BDG)", types: ["Mycology / Fungal", "Serology / antigen"] },
      { value: "parasite_antigen", label: "Parasite antigen (rK39 / RDT etc.)", types: ["Parasitology", "Serology / antigen"] },
      { value: "hiv_hepatitis_serology", label: "HIV / Hepatitis serology", types: ["Serology / antigen"] },
      { value: "dengue_serology", label: "Dengue NS1 / IgM / IgG", types: ["Serology / antigen"] },
    ],
  },
  {
    label: "Genomics",
    tests: [
      // Pathogen genomics — keyed by specimen. Offered on the genomics case type,
      // except tNGS-TB which also belongs to a mycobacteriology case (the WHO
      // pathway runs it after GeneXpert).
      { value: "pathogen_wgs", label: "Pathogen WGS (whole genome sequencing)", types: ["Pathogen genomics"] },
      { value: "mngs", label: "Metagenomic NGS (mNGS)", types: ["Pathogen genomics"] },
      { value: "tngs_tb", label: "Targeted NGS — TB drug resistance (tNGS)", types: ["Pathogen genomics", "Mycobacteriology / AFB"] },
      { value: "amplicon_id", label: "Broad-range amplicon ID (16S / ITS)", types: ["Pathogen genomics"] },
      { value: "resistance_genotyping", label: "Targeted resistance genotyping panel", types: ["Pathogen genomics"] },
      { value: "typing_ipc", label: "Typing for infection control", types: ["Pathogen genomics"] },
      // Human genomics — a lifelong patient property, not a specimen property.
      // A PGx case type exists so a panel can be ordered pre-emptively, with no
      // infection present.
      { value: "pgx_panel", label: "Pharmacogenomic panel", types: ["Pharmacogenomics / PGx"] },
      { value: "hla_typing", label: "HLA typing (pharmacogenomic)", types: ["Pharmacogenomics / PGx"] },
      { value: "g6pd", label: "G6PD genotype / activity", types: ["Pharmacogenomics / PGx"] },
    ],
  },
];

// Flattened convenience: every { value, label, types } test in one list.
export const ALL_ORDERED_TESTS = ORDERED_TEST_GROUPS.flatMap((group) =>
  group.tests.map((t) => ({ value: t.value, label: t.label, types: t.types || [], group: group.label }))
);

// Which tests are offered for a given case type. Combined offers everything.
export function testsForCaseType(caseType) {
  if (!caseType || caseType === "Combined") return ALL_ORDERED_TESTS;
  return ALL_ORDERED_TESTS.filter((t) => t.types.includes(caseType));
}

// Which analytical tracks a case type activates — the sidebar counterpart of
// testsForCaseType. Derived from that same catalogue so the sidebar and the
// Registration test menu can never disagree: a track is active when the case
// type offers at least one test belonging to it. An absent case type (or
// `Combined`) offers everything and therefore activates all four tracks, which
// is the right default before a case is registered.
//
// The per-track test families are declared with each tab's own constants further
// down the file; this is only ever called at render time, after evaluation.
export function activeTracksFor(caseType) {
  const offered = testsForCaseType(caseType).map((t) => t.value);
  const offers = (family) => offered.some((tv) => family.includes(tv));
  return {
    culture: offers(CULTURE_TEST_VALUES),
    molecular: offers(NAAT_TEST_VALUES),
    serology: offers(SEROLOGY_TEST_VALUES),
    mycobacteriology: offers(MYCO_TEST_VALUES),
    pathogen_genomics: offers(GENOMICS_TEST_VALUES),
    human_genomics: offers(PGX_TEST_VALUES),
  };
}

// Which always-on sidebar entries a case type does NOT need. Only the
// pre-emptive PGx case needs this today: it has no bench triage to speak of, no
// microscopy, no organism to interpret and no AMR flag, and its final report is
// a dosing report rather than an infection diagnosis.
//
// Deliberately a short hand-written list rather than a derivation. The track
// entries stay derived from the ordered-test catalogue — so the sidebar and
// Registration's test menu still cannot disagree — and only the *always-on*
// entries are suppressed here. Combined suppresses nothing, so a case carrying
// both an infection and a PGx order shows both genomics tracks with no special
// rule. Specimen Processing is NOT suppressed: a wrong tube (heparin) is the
// real failure mode for a PGx sample.
// The case type that suppresses the infection-management tabs. Exported so Tab 14
// can gate its report blocks on the same fact rather than repeating the string,
// and mirrored in microbiology.py as CASE_TYPES_WITHOUT_INTERPRETATION.
export const PGX_CASE_TYPE = "Pharmacogenomics / PGx";

const SUPPRESSED_SIDEBAR = {
  [PGX_CASE_TYPE]: [
    "direct-exam",
    "pathogen-genomics",
    "preliminary",
    "interpretation",
    "infection-control",
  ],
};

export function suppressedTabsFor(caseType) {
  return SUPPRESSED_SIDEBAR[caseType] || [];
}

// ─── Tab 2 — Specimen processing ──────────────────────────────────────────────

// Containment flag per specimen (CLSI M29-A4). BSC is auto-suggested for AFB,
// BALF, and CSF when meningitis is suspected.
export const CONTAINMENT_OPTIONS = ["Routine bench", "BSC required"];

// Media catalogs grouped by track. Which group(s) a specimen can use is driven
// by the ordered tests from Tab 1 (culture → bacteriology/anaerobic media;
// fungal culture → fungal media; LJ/MGIT → mycobacterial media). Value == label.
export const MEDIA_GROUPS = [
  {
    key: "bacteriology",
    label: "Bacteriology",
    options: [
      "Blood agar (BA)",
      "Chocolate agar (CHOC)",
      "MacConkey agar (MAC)",
      "CLED agar",
      "Mannitol Salt agar",
      "Thayer-Martin agar",
      "Thioglycollate broth",
    ],
  },
  {
    key: "anaerobic",
    label: "Anaerobic",
    options: [
      "Anaerobic blood agar (Brucella / CDC base)",
      "Phenylethyl alcohol agar (PEA)",
      "Kanamycin-Vancomycin Laked Blood (KVLB)",
      "Cooked meat broth",
    ],
  },
  {
    key: "mycobacteriology",
    label: "Mycobacteriology",
    options: [
      "Löwenstein-Jensen (LJ) slope",
      "MGIT tube",
      "Middlebrook 7H10 / 7H11 agar",
    ],
  },
  {
    key: "mycology",
    label: "Mycology / Fungal",
    options: [
      "Sabouraud Dextrose Agar (SDA)",
      "SDA with antibiotics (Mycosel)",
      "Chromogenic Candida agar (CHROMagar)",
      "Brain Heart Infusion (BHI) agar",
      "Corn meal agar",
      "Mycosel / DTM agar",
    ],
  },
];

// A media group is offered to a specimen only when at least one of these test
// values (stable keys from ALL_ORDERED_TESTS) is in that specimen's ordered
// tests (from Tab 1).
export const MEDIA_GROUP_TEST_TRIGGERS = {
  bacteriology: ["culture_aerobic", "ast"],
  anaerobic: ["culture_anaerobic"],
  mycobacteriology: ["lj_mgit_culture"],
  mycology: ["fungal_culture"],
};

// Ordered-test values that mark a specimen as parasitology (drives the parasite
// preparation panel in Tab 2 and suppresses the culture/incubation fields).
export const PARASITOLOGY_TEST_VALUES = [
  "ova_parasite_exam",
  "blood_film",
  "concentration_technique",
  "permanent_stain",
  "parasite_pcr",
  "parasite_antigen",
];

// Inoculation method per specimen (not applicable for parasitology).
export const INOCULATION_METHOD_OPTIONS = [
  "Loop",
  "Swab roll",
  "Pour plate",
  "Centrifuged deposit",
  "Membrane filtration",
  "Other",
];

// Atmosphere for incubated culture plates (not applicable for parasitology).
export const ATMOSPHERE_OPTIONS = ["Aerobic", "CO₂ 5%", "Anaerobic jar / chamber", "Microaerophilic"];

// Anaerobic indicator strip colour confirmation (anaerobic cultures only).
export const INDICATOR_COLOUR_OPTIONS = ["Pink (oxygen-free)", "Blue / no colour change", "Not recorded"];

// Incubation temperature: 35–37 °C standard; 30 °C fungal moulds / dermatophytes;
// 25 °C dermatophyte test medium; 35 °C yeasts.
export const TEMPERATURE_OPTIONS = ["35–37 °C", "30 °C", "25 °C", "35 °C", "Room temp"];

// Blood-culture bottle config (CLSI M47).
export const BLOOD_BOTTLE_TYPE_OPTIONS = ["Aerobic", "Anaerobic", "Paediatric", "Fungal lysis-centrifugation"];
export const BLOOD_MONITOR_OPTIONS = ["BacT/ALERT", "BACTEC", "Manual"];

// ─── Parasitology processing record (case type Parasitology / Combined) ───────
// Slide preparation methods available in Tab 2 → read in Tab 3.
export const PARASITE_PREP_METHOD_OPTIONS = [
  "Formol-ether concentration (FEC)",
  "Zinc sulphate flotation",
  "Direct wet preparation (saline + iodine)",
  "Permanent stain (trichrome / iron haematoxylin)",
  "Thick blood film preparation",
  "Thin blood film preparation",
  "Giemsa staining",
  "Knott's concentration (microfilaria)",
  "Scotch tape test (Enterobius)",
  "Baermann funnel (Strongyloides)",
  "Skin snip in saline (Onchocerca)",
];

export const SLIDE_TYPE_OPTIONS = ["Wet prep", "Thick film", "Thin film", "Permanent stain"];

// ─── Pharmacogenomic (PGx) receipt record (case type Pharmacogenomics / PGx) ──
// The receipt check that stands in for culture dispatch on a PGx specimen card.
// There is no culture to set up and nothing to incubate — the sample is blood (or
// saliva / a swab) and it goes straight to DNA extraction — but the sample still
// has to be checked in, and for PGx the failure modes are different ones.
//
// `ok: false` is a hard stop rather than a warning: nothing done in the lab makes
// these containers usable, so the sample has to be recollected. The reason travels
// with the option so the card can state it without a second lookup table.
export const PGX_TUBE_OPTIONS = [
  { value: "EDTA whole blood (lavender top)", label: "EDTA whole blood (lavender top)", ok: true },
  { value: "Saliva kit", label: "Saliva kit", ok: true },
  { value: "Buccal swab", label: "Buccal swab", ok: true },
  { value: "Dried blood spot card", label: "Dried blood spot card", ok: true },
  { value: "Extracted DNA — referred in", label: "Extracted DNA — referred in", ok: true },
  {
    value: "Heparin (green top)",
    label: "Heparin (green top)",
    ok: false,
    why: "Heparin blocks the amplification reaction itself, so the panel would return as a false negative. Recollect in EDTA.",
  },
  {
    value: "Citrate (blue top)",
    label: "Citrate (blue top)",
    ok: false,
    why: "The liquid anticoagulant dilutes the sample. Recollect in EDTA.",
  },
  {
    value: "Serum / plain (red or gold top)",
    label: "Serum / plain (red or gold top)",
    ok: false,
    why: "The blood has already clotted, so the white cells carrying the DNA are gone. Recollect in EDTA.",
  },
];

// Problems seen when the sample is checked in — restricted to what Registration
// does NOT already ask. Volume, labelling and container integrity are captured on
// every specimen's quality block in Tab 1 (`volume_adequate`, `labelling_match`,
// `container_intact`), and a rejection is recorded there too (`rejection_met` /
// `rejection_reason` / `rejection_notified`). So this list carries only the
// blood-specific observations that have no equivalent anywhere else, and
// deliberately does not restate the generic ones.
export const PGX_INTEGRITY_ISSUES = [
  "Blood looks broken down (haemolysed)",
  "Clotted / clumped sample",
  "Delayed in transit / temperature excursion",
];

// Where the sample is held between receipt and extraction. A PGx panel is usually
// run in batches to save reagent, so the sample waits.
export const PGX_STORAGE_OPTIONS = [
  "Refrigerated 2–8 °C",
  "Room temperature",
  "Frozen −20 °C",
  "Extracted DNA −20 °C",
];

// ─── Tab 3 — Direct examination ───────────────────────────────────────────────
// Each exam type declares its structured result fields. Field `kind`:
//   "select" / "radio"  → single choice
//   "multiselect"       → checkbox group
//   "text" / "number" / "date" → free entry
// `group` is an optional section header so one exam's fields can be split
// visually. Options are plain strings or [{value,label}].

export const GRAM_MORPHOLOGY_OPTIONS = [
  "Gram-positive cocci in clusters",
  "Gram-positive cocci in chains",
  "Gram-positive cocci in pairs",
  "Gram-negative rods",
  "Gram-negative cocci",
  "Gram-positive rods",
  "Mixed organisms",
  "No organisms seen",
];

export const GRAM_PUS_CELLS_OPTIONS = ["None", "Scanty", "Moderate", "Many"];
export const GRAM_EPI_CELLS_OPTIONS = ["None", "Scanty", "Moderate", "Many"];
export const ANAEROBE_MORPHOLOGY_OPTIONS = [
  "Pale gram-negative rods (suggests Bacteroides / Prevotella)",
  "Gram-positive rods with subterminal spores (suggests Clostridium)",
  "Gram-positive cocci in clumps (suggests Peptostreptococcus)",
];

export const AFB_GRADE_OPTIONS = ["No AFB seen", "Scanty (1–9 / 100 fields)", "1+", "2+", "3+"];
export const AFB_METHOD_OPTIONS = ["Ziehl-Neelsen", "Auramine-O fluorescence"];

export const FUNGAL_ELEMENTS_OPTIONS = [
  "Septate hyphae",
  "Aseptate / ribbon-like broad hyphae (Mucor / Rhizopus)",
  "Pseudohyphae",
  "Budding yeast cells",
  "Spherules with endospores (Coccidioides)",
];
export const FUNGAL_PIGMENT_OPTIONS = ["Hyaline", "Dematiaceous"];
export const BURDEN_OPTIONS = ["Rare", "Moderate", "Heavy"];

export const BLOOD_PARASITE_SPECIES_OPTIONS = [
  "P. falciparum",
  "P. vivax",
  "P. malariae",
  "P. ovale",
  "P. knowlesi",
  "Mixed infection",
];
export const PARASITE_STAGE_OPTIONS = ["Ring", "Trophozoite", "Schizont", "Gametocyte"];
export const P_FALCIPARUM_FEATURE_OPTIONS = [
  "Multiple rings per RBC",
  "Appliqué (accolé) forms",
  "Banana-shaped gametocytes",
];
export const RBC_MORPHOLOGY_OPTIONS = [
  "Normal",
  "Enlarged (favours P. vivax / P. ovale)",
  "Normal-to-small (favours P. falciparum / P. malariae)",
];

export const STOOL_ORGANISM_OPTIONS = [
  "Giardia lamblia — cysts",
  "Giardia lamblia — trophozoites",
  "Entamoeba histolytica/dispar — cysts",
  "Entamoeba histolytica/dispar — trophozoites",
  "Entamoeba coli",
  "Cryptosporidium oocysts",
  "Cyclospora oocysts",
  "Isospora belli",
  "Blastocystis hominis",
  "Balantidium coli",
  "Ascaris lumbricoides (ova)",
  "Trichuris trichiura (ova)",
  "Hookworm ova (Necator / Ancylostoma)",
  "Strongyloides stercoralis — larvae",
  "Taenia spp. (ova / proglottid)",
  "Hymenolepis nana (ova)",
  "Schistosoma mansoni / japonicum (ova)",
  "No ova, cysts, or parasites seen",
];
export const STOOL_BURDEN_OPTIONS = ["Rare", "Few", "Moderate", "Many"];

// Exam-type → structured result field config. Keys are persisted verbatim under
// direct_examination[specimen_id].exams[].result.
export const DIRECT_EXAM_TYPES = [
  {
    value: "gram_stain",
    label: "Gram stain",
    prep: "Gram stain",
    fields: [
      { key: "pus_cells", label: "Pus cells", kind: "select", options: GRAM_PUS_CELLS_OPTIONS, group: "Cellularity" },
      { key: "epithelial_cells", label: "Epithelial cells", kind: "select", options: GRAM_EPI_CELLS_OPTIONS, group: "Cellularity" },
      { key: "intracellular_organisms", label: "Intracellular organisms (gonorrhoea screen)", kind: "radio", options: ["Yes", "No"], group: "Cellularity" },
      { key: "morphology", label: "Organism morphology", kind: "multiselect", options: GRAM_MORPHOLOGY_OPTIONS, group: "Morphology" },
      { key: "anaerobe_flags", label: "Anaerobic morphology flags", kind: "multiselect", options: ANAEROBE_MORPHOLOGY_OPTIONS, group: "Anaerobe flags (when anaerobic suspected)" },
      { key: "foul_odour", label: "Foul odour noted", kind: "radio", options: ["Yes", "No"], group: "Anaerobe flags (when anaerobic suspected)" },
      { key: "comment", label: "Comment", kind: "text", multiline: true, group: "" },
    ],
  },
  {
    value: "afb_smear",
    label: "AFB smear (ZN / Auramine-O)",
    prep: "AFB smear",
    fields: [
      { key: "grade", label: "WHO / RNTCP grading", kind: "select", options: AFB_GRADE_OPTIONS },
      { key: "method", label: "Staining method", kind: "select", options: AFB_METHOD_OPTIONS },
      { key: "fields_examined", label: "Fields examined", kind: "text" },
      { key: "comment", label: "Comment", kind: "text", multiline: true },
    ],
  },
  {
    value: "koh",
    label: "KOH / Calcofluor white",
    prep: "KOH / Calcofluor",
    fields: [
      { key: "fungal_elements", label: "Fungal elements seen", kind: "radio", options: ["Yes", "No"] },
      { key: "morphology", label: "Morphology", kind: "multiselect", options: FUNGAL_ELEMENTS_OPTIONS },
      { key: "pigmentation", label: "Pigmentation", kind: "select", options: FUNGAL_PIGMENT_OPTIONS },
      { key: "burden", label: "Approximate burden", kind: "select", options: BURDEN_OPTIONS },
      { key: "comment", label: "Comment", kind: "text", multiline: true },
    ],
  },
  {
    value: "india_ink",
    label: "India ink (Cryptococcus)",
    prep: "India ink",
    fields: [
      { key: "capsule_seen", label: "Encapsulated yeast (capsule seen)", kind: "radio", options: ["Yes", "No"] },
      { key: "comment", label: "Comment", kind: "text", multiline: true },
    ],
  },
  {
    value: "wet_prep",
    label: "Wet preparation",
    prep: "Wet prep",
    fields: [
      { key: "motility", label: "Motility seen", kind: "radio", options: ["Yes", "No"] },
      { key: "description", label: "Organism description", kind: "text", multiline: true },
    ],
  },
  {
    value: "stool_opa",
    label: "Stool ova + parasite (O+P)",
    prep: "Stool O+P",
    fields: [
      { key: "organisms", label: "Organisms identified", kind: "multiselect", options: STOOL_ORGANISM_OPTIONS },
      { key: "burden", label: "Quantity / burden", kind: "select", options: STOOL_BURDEN_OPTIONS },
      { key: "samples_examined", label: "Stool samples examined in this case", kind: "text" },
      { key: "pcr_reflex", label: "PCR reflex recommended (E. histolytica/dispar)", kind: "radio", options: ["Yes — recommend PCR", "No"] },
      { key: "comment", label: "Comment", kind: "text", multiline: true },
    ],
  },
  {
    value: "concentration",
    label: "Concentration technique",
    prep: "Concentration technique",
    fields: [
      { key: "method", label: "Method", kind: "text" },
      { key: "organisms", label: "Organisms identified", kind: "multiselect", options: STOOL_ORGANISM_OPTIONS },
      { key: "comment", label: "Comment", kind: "text", multiline: true },
    ],
  },
  {
    value: "permanent_stain",
    label: "Permanent stain (trichrome / iron haematoxylin)",
    prep: "Permanent stain",
    fields: [
      { key: "stain", label: "Stain", kind: "select", options: ["Trichrome", "Iron haematoxylin"] },
      { key: "organisms", label: "Organisms identified", kind: "multiselect", options: STOOL_ORGANISM_OPTIONS },
      { key: "comment", label: "Comment", kind: "text", multiline: true },
    ],
  },
  {
    value: "thick_film",
    label: "Thick blood film (malaria / parasites)",
    prep: "Thick blood film",
    fields: [
      { key: "parasite_seen", label: "Parasite seen", kind: "radio", options: ["Yes", "No"] },
      { key: "species", label: "Species (confirm on thin film)", kind: "select", options: BLOOD_PARASITE_SPECIES_OPTIONS },
      { key: "fields_examined", label: "Fields examined (≥100 per WHO)", kind: "text" },
      { key: "gametocytes", label: "Gametocytes seen", kind: "radio", options: ["Yes", "No"] },
      { key: "microfilaria", label: "Microfilaria seen", kind: "radio", options: ["Yes", "No"] },
      { key: "trypomastigotes", label: "Trypomastigotes seen", kind: "radio", options: ["Yes", "No"] },
    ],
  },
  {
    value: "thin_film",
    label: "Thin blood film (species + parasitaemia)",
    prep: "Thin blood film",
    fields: [
      { key: "species", label: "Species confirmed", kind: "select", options: BLOOD_PARASITE_SPECIES_OPTIONS },
      { key: "stages", label: "Stage(s) present", kind: "multiselect", options: PARASITE_STAGE_OPTIONS },
      { key: "pf_features", label: "P. falciparum-specific features", kind: "multiselect", options: P_FALCIPARUM_FEATURE_OPTIONS },
      { key: "parasitaemia_pct", label: "Parasitaemia (% infected RBCs)", kind: "text" },
      { key: "rbc_morphology", label: "RBC morphology", kind: "select", options: RBC_MORPHOLOGY_OPTIONS },
    ],
  },
  {
    value: "knotts",
    label: "Knott's concentration / membrane filtration",
    prep: "Knott's",
    fields: [
      { key: "microfilaria", label: "Microfilaria seen", kind: "radio", options: ["Yes", "No"] },
      { key: "sheath", label: "Sheath present", kind: "radio", options: ["Yes", "No"] },
      { key: "tail_nuclei", label: "Nuclei in tail tip", kind: "radio", options: ["Yes", "No"] },
      { key: "species", label: "Presumptive species", kind: "text" },
    ],
  },
];

// A direct-exam type is offered to a specimen when at least one of these ordered
// test values (from Tab 1) is present on that specimen. Parasitology slides follow
// the O+P / film tests; Gram/AFB/fungal follow their respective ordered tests.
export const DIRECT_EXAM_TEST_TRIGGERS = {
  gram_stain: ["gram_stain", "culture_aerobic", "culture_anaerobic", "ast"],
  afb_smear: ["afb_smear", "lj_mgit_culture"],
  koh: ["koh_calcofluor", "fungal_culture"],
  india_ink: ["india_ink"],
  wet_prep: ["wet_prep"],
  stool_opa: ["ova_parasite_exam"],
  concentration: ["concentration_technique"],
  permanent_stain: ["permanent_stain"],
  thick_film: ["blood_film"],
  thin_film: ["blood_film"],
  knotts: ["blood_film"],
};

// Lookup: exam type value → its DIRECT_EXAM_TYPES entry (fields/label/prep).
export const DIRECT_EXAM_TYPES_BY_VALUE = Object.fromEntries(
  DIRECT_EXAM_TYPES.map((t) => [t.value, t])
);

// Hyperparasitaemia threshold — critical value when P. falciparum parasitaemia
// reaches this % (fires a STAT notification, cannot be deferred).
export const PFALCIPARUM_HYPERPARASITAEMIA_PCT = 5;

// ─── Tab 4 — Culture setup / read schedule ────────────────────────────────────
// Blood culture volume guidance (CLSI M47): adult 8–10 mL/bottle; paediatric
// 1–3 mL.
export const BLOOD_VOLUME_OPTIONS = ["Adult 8–10 mL", "Paediatric 1–3 mL", "Other"];

export const WINDOW_CLOSED_OPTIONS = ["No", "Yes — no growth by window end", "Yes — growth confirmed"];

// Auto-generated read schedule rows for a specimen, derived from its ordered
// tests (stable keys from ALL_ORDERED_TESTS) + specimen type. Each row is
// { label, hint? }; the tab stamps each with a read id + status. Order follows
// track precedence (blood → AFB → fungal → anaerobic → aerobic) and dedupes.
export function readScheduleFor(sp) {
  const tests = Array.isArray(sp?.tests_ordered) ? sp.tests_ordered : [];
  const type = String(sp?.specimen_type || "").toLowerCase();
  const rows = [];

  // Each row carries the hour offset it represents. The offset exists only to
  // order the finished schedule and is never returned — the stored row shape
  // stays { label }, which is what Tab 4 edits.
  const push = (list) => {
    list.forEach(([label, hours]) => {
      if (!rows.some((r) => r.label === label)) rows.push({ label, hours });
    });
  };

  if (tests.includes("blood_culture") || /blood culture/.test(type)) {
    push([
      ["Day 1", 24],
      ["Day 2", 48],
      ["Day 3", 72],
      ["Day 4", 96],
      ["Day 5 — end of continuous monitor window", 120],
    ]);
  }
  if (tests.includes("lj_mgit_culture") || tests.includes("afb_smear")) {
    push([
      ["Week 1", 168],
      ["Week 2", 336],
      ["Week 4", 672],
      ["Week 6", 1008],
      ["Week 8 — end of AFB incubation window", 1344],
    ]);
  }
  if (tests.includes("fungal_culture")) {
    push([
      ["48 h (first check)", 48],
      ["Day 5–7", 120],
      ["Week 2", 336],
      ["Week 3", 504],
      ["Week 4 — end of fungal window", 672],
    ]);
  }
  if (tests.includes("culture_anaerobic")) {
    // Anaerobic reads are labelled by culture type. An anaerobic jar and an
    // aerobic plate are read at the same hours, and without this a bare "72 h"
    // could not be told apart from the aerobic read of the same hour.
    push([
      ["48 h (anaerobic — jar must not open early)", 48],
      ["72 h (anaerobic)", 72],
      ["96–120 h (anaerobic)", 96],
    ]);
  }
  if (tests.includes("culture_aerobic")) {
    // Urine is called at 48 h — a negative urine culture at 48 h is reliably
    // negative, so it gets no third read. Every other specimen gets 72 h, since
    // a slow or fastidious organism can still appear late.
    if (/urine/.test(type)) push([["24 h", 24], ["48 h", 48]]);
    else if (/cerebrospinal|csf|fluid/.test(type)) push([["24 h", 24], ["48 h", 48], ["72 h", 72]]);
    else if (/pus|wound|abscess/.test(type)) push([["24 h", 24], ["48 h", 48], ["72 h", 72]]);
    else push([["24 h", 24], ["48 h", 48], ["72 h", 72]]);
  }

  // Order chronologically. Rows landing on the same hour are all kept — they are
  // separate reads (an aerobic plate and an anaerobic jar at 72 h), not
  // duplicates, and each label now says which culture it belongs to.
  return rows.sort((a, b) => a.hours - b.hours).map((r) => ({ label: r.label }));
}

// ─── Tab 5 — Culture workup option lists (5A/5B/5C) ──────────────────────────
// Vocabulary centralised here so expansion is data-only (the tab imports it).
export const CULTURE_GROWTH_OPTIONS = ["No growth", "Growth"];
export const CULTURE_BC_POSITIVE_OPTIONS = ["No growth", "Growth (bottle signals positive)"];
export const QUANTITY_SEMI_OPTIONS = ["Scanty", "Light", "Moderate", "Heavy"];
export const QUANTITY_URINE_OPTIONS = ["<10³ CFU/mL", "10³–10⁴ CFU/mL", "10⁴–10⁵ CFU/mL", "≥10⁵ CFU/mL"];
export const COLONY_FEATURE_OPTIONS = [
  "Haemolytic on BA",
  "Lactose fermenter (MAC)",
  "Non-lactose fermenter (MAC)",
  "Mucoid",
  "Dry / rough",
  "Pigmented",
];
export const MIXED_GROWTH_OPTIONS = ["Single organism", "Two organisms", "Mixed flora (>2)"];
export const CONTAMINATION_OPTIONS = ["No", "Suspected", "Yes"];

export const ID_METHOD_OPTIONS = [
  "MALDI-TOF MS",
  "VITEK 2 / API biochemical",
  "Conventional biochemical",
  "16S / ITS sequencing",
  "Fungal-specific (germ tube / CHROMagar / LPCB)",
  "Anaerobe-specific (aerotolerance / potency disks)",
  "Line probe assay (mycobacteria)",
];
export const CONFIDENCE_OPTIONS = ["Acceptable", "Equivocal", "Unreliable"];
export const SIGNIFICANCE_OPTIONS = ["Definite pathogen", "Potential pathogen", "Likely commensal", "Contaminant"];
export const ID_REFLEX_OPTIONS = ["Accept", "Repeat from fresh colony", "Send to reference lab", "Accept at genus level"];

export const AST_METHOD_OPTIONS = [
  "Automated (VITEK 2 / Phoenix)",
  "Disk diffusion (Kirby-Bauer)",
  "Broth microdilution",
  "Gradient strip (Etest)",
  "Rapid AST from blood-culture broth",
  "Antifungal broth microdilution (CLSI M27/M38)",
  "Anaerobic agar dilution / Etest (CLSI M11)",
];
export const BREAKPOINT_SOURCE_OPTIONS = ["CLSI M100 Ed34", "EUCAST", "CLSI M27/M38 (antifungal)", "CLSI M11 (anaerobe)", "No established breakpoint — report MIC only"];
export const INTERPRETATION_OPTIONS = ["S", "I", "R"];
export const QC_RESULT_OPTIONS = ["In range", "Out of range"];

// Resistance-mechanism flag vocabulary for 5C. These strings also drive Tab 13's
// AMR auto-detection (shared/amrFlags.js), so a new flag needs a matching rule
// there. Starter set + antifungal/anaerobe additions for the expanded panels.
export const RESISTANCE_FLAG_OPTIONS = [
  "MRSA (mecA/PBP2a)",
  "ESBL (combined disk)",
  "Carbapenemase (CarbaNP/mCIM)",
  "VRE (vanA/vanB)",
  "Azole-resistant Aspergillus (TR34/L98H)",
  "Azole-resistant Candida",
  "Echinocandin-resistant Candida",
  "Metronidazole-resistant Bacteroides",
  "Clindamycin-resistant Bacteroides",
];

// Per-AST-method detail sub-fields (5C), same DIRECT_EXAM-style schema as
// ID_METHOD_DETAIL_FIELDS; stored flat on ast.method_detail.
export const AST_METHOD_DETAIL_FIELDS = {
  "Automated (VITEK 2 / Phoenix)": [
    { key: "system", label: "System", kind: "select", options: ["VITEK 2", "Phoenix", "MicroScan"] },
    { key: "card_panel", label: "Card / panel type", kind: "text" },
    { key: "software_version", label: "Software version", kind: "text" },
  ],
  "Disk diffusion (Kirby-Bauer)": [
    { key: "disk_lot", label: "Disk lot / expiry", kind: "text" },
    { key: "incubation", label: "Incubation (time / atmosphere)", kind: "text" },
  ],
  "Broth microdilution": [
    { key: "panel_lot", label: "Panel lot / expiry", kind: "text" },
    { key: "format", label: "Format", kind: "select", options: ["Commercial panel", "In-house"] },
  ],
  "Gradient strip (Etest)": [
    { key: "strip_ref", label: "Strip reference", kind: "text" },
    { key: "strip_lot", label: "Strip lot / expiry", kind: "text" },
  ],
  "Rapid AST from blood-culture broth": [
    { key: "rapid_protocol", label: "In-house protocol reference", kind: "text" },
    { key: "rapid_hours", label: "Incubation (h)", kind: "text" },
  ],
  "Antifungal broth microdilution (CLSI M27/M38)": [
    { key: "antifungal_format", label: "Format", kind: "select", options: ["Yeast MIC (M27)", "Mould MIC (M38)"] },
    { key: "panel_lot", label: "Panel lot / expiry", kind: "text" },
  ],
  "Anaerobic agar dilution / Etest (CLSI M11)": [
    { key: "anaerobe_format", label: "Format", kind: "select", options: ["Agar dilution", "Etest on Brucella BA"] },
    { key: "atmosphere", label: "Incubation atmosphere", kind: "text" },
  ],
};

// ─── Tab 5 — Culture workup: 5B method-detail sub-fields ─────────────────────
// Structured detail revealed per selected ID method (mirror of the DIRECT_EXAM
// field config). Rendered generically by CultureWorkupTab into isolate.id_detail
// (a flat { fieldKey: value } map). Field `kind`:
//   "select" / "radio"  → single choice
//   "multiselect"       → checkbox group
//   "text" (multiline)  → free entry
// `group` is an optional section header within the method's fields. Keys match
// the ID-method option strings shown in Tab 5B.
export const ID_METHOD_DETAIL_FIELDS = {
  "MALDI-TOF MS": [
    { key: "maldi_extraction", label: "Extraction method", kind: "select", options: ["Direct smear", "On-plate ethanol-formic overlay", "Full extraction"], group: "Score" },
    { key: "maldi_score", label: "MALDI score (target ≥2.0)", kind: "text", group: "Score" },
    { key: "maldi_top_hit", label: "Top-hit agreement with reported organism", kind: "select", options: ["Top hit matches", "2nd/3rd hit — reviewed", "No agreement"], group: "Score" },
    { key: "maldi_library", label: "Library / database version", kind: "text", group: "Score" },
    { key: "maldi_run_trace", label: "Instrument / plate-well / run date", kind: "text", group: "Score" },
  ],
  "VITEK 2 / API biochemical": [
    { key: "panel_type", label: "Panel / card type (GN · GP · YST · API 20E …)", kind: "text" },
    { key: "card_serial", label: "Card / strip serial number", kind: "text" },
    { key: "api_profile_code", label: "API numerical profile code", kind: "text" },
    { key: "auto_percent_id", label: "% identification / probability", kind: "text" },
    { key: "auto_second_choice", label: "Second-choice organism", kind: "text" },
    { key: "system_version", label: "System / database version", kind: "text" },
  ],
  "Conventional biochemical": [
    { key: "biochem_tests", label: "Manual tests performed", kind: "text", multiline: true },
    { key: "api_kit", label: "Biochemical kit (if used)", kind: "select", options: ["API 20E", "API 20NE", "API 20A", "Rapid ID 32A", "Other"] },
  ],
  "16S / ITS sequencing": [
    { key: "seq_target", label: "Sequencing target", kind: "select", options: ["16S rRNA", "ITS1/ITS2", "hsp65", "rpoB", "β-tubulin", "calmodulin"] },
    { key: "seq_identity", label: "% sequence identity", kind: "text" },
    { key: "seq_coverage", label: "% query coverage", kind: "text" },
    { key: "seq_database", label: "Reference database / accession", kind: "text" },
    { key: "seq_quality", label: "Chromatogram / read quality note", kind: "text", multiline: true },
  ],
  "Fungal-specific (germ tube / CHROMagar / LPCB)": [
    { key: "germ_tube", label: "Germ tube test (GTT)", kind: "radio", options: ["Positive", "Negative", "Not performed"], group: "Candida-specific" },
    { key: "germ_tube_h", label: "GTT read at (h in serum 37 °C)", kind: "text", group: "Candida-specific" },
    { key: "chromagar_colour", label: "CHROMagar colony colour", kind: "select", options: ["Green (C. albicans)", "Blue / metallic (C. tropicalis)", "Pink / rough (C. krusei)", "Cream / white (C. glabrata)", "Not applicable"], group: "Candida-specific" },
    { key: "cornmeal", label: "Corn-meal agar microscopy", kind: "multiselect", options: ["Pseudohyphae", "True hyphae", "Terminal chlamydospores (C. albicans)", "Blastoconidia"], group: "Candida-specific" },
    { key: "india_ink_capsule", label: "India ink — capsule seen (Cryptococcus)", kind: "radio", options: ["Yes", "No"], group: "Yeast / capsule" },
    { key: "lpcb_structures", label: "LPCB mount structures", kind: "multiselect", options: ["Vesicle + phialides (Aspergillus)", "Banana-shaped macroconidia (Fusarium)", "Aseptate hyphae + sporangiophore (Mucor/Rhizopus)", "Dermatophyte macro/microconidia", "None seen"], group: "Mould microscopy" },
    { key: "slide_culture", label: "Slide culture (Riddell) — conidial arrangement / texture", kind: "text", multiline: true, group: "Mould microscopy" },
  ],
  "Anaerobe-specific (aerotolerance / potency disks)": [
    { key: "aerotolerance", label: "Aerotolerance test (mandatory first)", kind: "select", options: ["Obligate anaerobe (no aerobic growth)", "Facultative / aerotolerant", "Not performed"], group: "Aerotolerance" },
    { key: "anaerobe_gram_morph", label: "Gram morphology from subculture", kind: "select", options: ["Gram-positive cocci", "Gram-positive bacilli", "Gram-negative bacilli", "Gram-negative cocci", "Not performed"], group: "Aerotolerance" },
    { key: "anaerobe_selective_growth", label: "Growth on selective media (BBE / PEA / LKV)", kind: "text", group: "Aerotolerance" },
    { key: "potency_disks", label: "Potency-disk pattern", kind: "multiselect", options: ["Vanco-R + Kana-R + bile-sensitive (B. fragilis group)", "SPS-sensitive (Clostridium)", "Colistin-resistant (Gram-neg anaerobe)", "Not performed"], group: "Presumptive grouping" },
    { key: "nagler", label: "Nagler reaction (egg-yolk agar)", kind: "radio", options: ["Positive (C. perfringens lecithinase)", "Negative", "Not performed"], group: "Presumptive grouping" },
    { key: "bile_solubility", label: "Bile solubility (B. fragilis group)", kind: "radio", options: ["Positive", "Negative", "Not performed"], group: "Presumptive grouping" },
  ],
  "Line probe assay (mycobacteria)": [
    { key: "lpa_kit", label: "LPA kit", kind: "select", options: ["GenoType MTBDRplus", "GenoType MTBDRsl", "Other"] },
    { key: "lpa_kit_lot", label: "Kit lot / expiry", kind: "text" },
    { key: "lpa_bands", label: "Probe / band result (e.g. rpoB WT/MUT)", kind: "text", multiline: true },
  ],
};

// MALDI-TOF score → confidence hint (manufacturer thresholds). Returns "" when
// the score is empty/non-numeric so the caller only auto-fills a real hint.
export function maldiScoreConfidence(score) {
  const n = parseFloat(score);
  if (!Number.isFinite(n)) return "";
  if (n >= 2.0) return "Acceptable";
  if (n >= 1.7) return "Equivocal";
  return "Unreliable";
}

// Ordered-test values that route a specimen to the culture track (Tabs 4/5) —
// the mirror of NAAT_TEST_VALUES / SEROLOGY_TEST_VALUES / MYCO_TEST_VALUES for
// the culture pair. `ast` is included because it is ordered alongside a culture
// and a specimen carrying it belongs on the culture bench.
export const CULTURE_TEST_VALUES = [
  "culture_aerobic",
  "culture_anaerobic",
  "blood_culture",
  "fungal_culture",
  "lj_mgit_culture",
  "ast",
];

// Is a culture card owed for a specimen (driven by its ordered tests)?
export const cultureTestsFor = (tests) =>
  (Array.isArray(tests) ? tests : []).filter((tv) => CULTURE_TEST_VALUES.includes(tv));

// ─── Tab 8 — Molecular / NAAT ────────────────────────────────────────────────
// NAAT runs independently of culture (rapid panels, viral load, targeted
// pathogen detection). Which ordered-test values (from ALL_ORDERED_TESTS) route
// a specimen to Tab 8.
export const NAAT_TEST_VALUES = [
  "gene_xpert",
  "naat_pcr",
  "viral_pcr",
  "fungal_pcr",
  "parasite_pcr",
];

// Is a molecular order offered for a specimen (driven by its ordered tests)?
export const naatTestsFor = (tests) =>
  (Array.isArray(tests) ? tests : []).filter((tv) => NAAT_TEST_VALUES.includes(tv));

// Qualitative result vocabulary used across platforms.
export const NAAT_QUALITATIVE_OPTIONS = [
  "Detected",
  "Not detected",
  "Invalid",
  "Indeterminate",
];

// Internal control / extraction adequacy (QC).
export const NAAT_INTERNAL_CONTROL_OPTIONS = ["Passed", "Failed", "Not recorded"];

// ─── Curated NAAT assay catalogue (Tab 8) ─────────────────────────────────────
// Each assay belongs to one ordered-test value (`test`) and declares its default
// platform, the target it looks for, whether a quantitative (viral-load style)
// result applies, and the resistance markers the platform reports when present
// (e.g. GeneXpert rpoB). Quantitative is surfaced as copies/mL + log₁₀ in the
// tab. This is a starter catalogue — panels expand per the lab's actual menu.
export const MOLECULAR_ASSAYS = [
  // GeneXpert MTB/RIF (mycobacterial — runs parallel to LJ/MGIT track)
  {
    value: "genexpert_mtb_rif",
    label: "GeneXpert MTB/RIF (rpoB)",
    test: "gene_xpert",
    platform: "Cepheid GeneXpert",
    target: "MTB complex + rpoB rifampicin-resistance",
    qualitative: true,
    markers: ["rpoB mutation detected (rifampicin resistant)"],
  },
  {
    value: "genexpert_mtb_rif_ultra",
    label: "GeneXpert MTB/RIF Ultra (rpoB, semi-quant)",
    test: "gene_xpert",
    platform: "Cepheid GeneXpert",
    target: "MTB complex (lower LOD) + rpoB rifampicin-resistance",
    qualitative: true,
    markers: ["rpoB mutation detected (rifampicin resistant)", "Semi-quantitative trace (high / medium / low / very low)"],
  },

  // Targeted PCR / NAAT — bacteriology and syndromic panels
  {
    value: "respiratory_panel",
    label: "Multiplex respiratory panel (FilmArray RP)",
    test: "naat_pcr",
    platform: "bioMérieux BioFire FilmArray",
    target: "Influenza A/B, RSV, SARS-CoV-2, hMPV, adenovirus…",
    qualitative: true,
    markers: [],
  },
  {
    value: "gi_panel",
    label: "Multiplex GI panel (FilmArray GI)",
    test: "naat_pcr",
    platform: "bioMérieux BioFire FilmArray",
    target: "Bacterial / viral / parasitic enteric pathogens",
    qualitative: true,
    markers: [],
  },
  {
    value: "me_panel",
    label: "Meningitis / Encephalitis panel (FilmArray ME)",
    test: "naat_pcr",
    platform: "bioMérieux BioFire FilmArray",
    target: "CSF bacteria (E. coli K1, H. influenzae, L. monocytogenes, N. meningitidis, S. agalactiae, S. pneumoniae), viruses (CMV, enterovirus, HSV-1/2, HHV-6, HPeV, VZV), fungi (C. neoformans/gattii)",
    qualitative: true,
    markers: [],
  },
  {
    value: "bcid2_panel",
    label: "Blood culture ID panel (FilmArray BCID2)",
    test: "naat_pcr",
    platform: "bioMérieux BioFire FilmArray",
    target: "Direct-from-positive-bottle ID: Gram-positive / Gram-negative organisms + Candida spp.",
    qualitative: true,
    markers: ["mecA/C + SCCmec (MRSA)", "vanA/vanB (VRE)", "blaKPC / blaNDM / blaVIM / blaIMP / blaOXA-48-like (carbapenemase)", "blaCTX-M (ESBL)"],
  },
  {
    value: "cdiff_naat",
    label: "C. difficile toxin A/B NAAT",
    test: "naat_pcr",
    platform: "Cepheid GeneXpert",
    target: "Clostridioides difficile toxin A/B",
    qualitative: true,
    markers: [],
  },
  {
    value: "mrsa_naat",
    label: "MRSA NAAT (mecA)",
    test: "naat_pcr",
    platform: "Cepheid GeneXpert",
    target: "Staphylococcus aureus + mecA",
    qualitative: true,
    markers: ["mecA (MRSA)"],
  },
  {
    value: "ctng_pcr",
    label: "Chlamydia / Gonococcus PCR (CT/NG)",
    test: "naat_pcr",
    platform: "Roche cobas",
    target: "Chlamydia trachomatis, Neisseria gonorrhoeae",
    qualitative: true,
    markers: [],
  },

  // Viral PCR / load — quantitative (copies/mL + log₁₀)
  {
    value: "hiv1_rna",
    label: "HIV-1 RNA (viral load)",
    test: "viral_pcr",
    platform: "Roche cobas",
    target: "HIV-1",
    quantitative: true,
    markers: [],
  },
  {
    value: "hbv_dna",
    label: "HBV DNA (viral load)",
    test: "viral_pcr",
    platform: "Roche cobas",
    target: "Hepatitis B virus",
    quantitative: true,
    markers: [],
  },
  {
    value: "hcv_rna",
    label: "HCV RNA (viral load)",
    test: "viral_pcr",
    platform: "Roche cobas",
    target: "Hepatitis C virus",
    quantitative: true,
    markers: [],
  },
  {
    value: "cmv_dna",
    label: "CMV DNA (viral load)",
    test: "viral_pcr",
    platform: "Abbott m2000",
    target: "Cytomegalovirus",
    quantitative: true,
    markers: [],
  },
  {
    value: "ebv_dna",
    label: "EBV DNA (viral load)",
    test: "viral_pcr",
    platform: "Abbott m2000",
    target: "Epstein-Barr virus",
    quantitative: true,
    markers: [],
  },
  {
    value: "hsv_pcr",
    label: "HSV 1/2 DNA PCR",
    test: "viral_pcr",
    platform: "Roche cobas",
    target: "Herpes simplex virus 1/2",
    qualitative: true,
    markers: [],
  },
  {
    value: "vzv_pcr",
    label: "VZV DNA PCR",
    test: "viral_pcr",
    platform: "In-house real-time PCR",
    target: "Varicella-zoster virus",
    qualitative: true,
    markers: [],
  },
  {
    value: "enterovirus_pcr",
    label: "Enterovirus PCR",
    test: "viral_pcr",
    platform: "In-house real-time PCR",
    target: "Enterovirus (pan-enterovirus)",
    qualitative: true,
    markers: [],
  },
  {
    value: "bkv_dna",
    label: "BK polyomavirus DNA (viral load)",
    test: "viral_pcr",
    platform: "In-house real-time PCR",
    target: "BK polyomavirus (transplant monitoring)",
    quantitative: true,
    markers: [],
  },
  {
    value: "jcv_dna",
    label: "JC polyomavirus DNA (viral load)",
    test: "viral_pcr",
    platform: "In-house real-time PCR",
    target: "JC polyomavirus (PML)",
    quantitative: true,
    markers: [],
  },

  // Fungal PCR
  {
    value: "aspergillus_pcr",
    label: "Aspergillus spp. PCR",
    test: "fungal_pcr",
    platform: "In-house real-time PCR",
    target: "Aspergillus spp.",
    qualitative: true,
    markers: [],
  },
  {
    value: "pcp_pcr",
    label: "Pneumocystis jirovecii PCR",
    test: "fungal_pcr",
    platform: "In-house real-time PCR",
    target: "Pneumocystis jirovecii",
    qualitative: true,
    markers: [],
  },

  // Parasite PCR
  {
    value: "plasmodium_pcr",
    label: "Plasmodium spp. PCR (with speciation)",
    test: "parasite_pcr",
    platform: "In-house / reference PCR",
    target: "Plasmodium spp. (speciation)",
    qualitative: true,
    markers: [],
  },
  {
    value: "ehistolytica_pcr",
    label: "Entamoeba histolytica PCR",
    test: "parasite_pcr",
    platform: "In-house / reference PCR",
    target: "Entamoeba histolytica (vs non-pathogenic E. dispar)",
    qualitative: true,
    markers: [],
  },
  {
    value: "crypto_pcr",
    label: "Cryptosporidium spp. PCR",
    test: "parasite_pcr",
    platform: "In-house / reference PCR",
    target: "Cryptosporidium spp.",
    qualitative: true,
    markers: [],
  },
  {
    value: "giardia_pcr",
    label: "Giardia lamblia PCR",
    test: "parasite_pcr",
    platform: "In-house / reference PCR",
    target: "Giardia lamblia",
    qualitative: true,
    markers: [],
  },
  {
    value: "leishmania_pcr",
    label: "Leishmania spp. PCR",
    test: "parasite_pcr",
    platform: "In-house / reference PCR",
    target: "Leishmania spp.",
    qualitative: true,
    markers: [],
  },
  {
    value: "strongyloides_pcr",
    label: "Strongyloides stercoralis PCR",
    test: "parasite_pcr",
    platform: "In-house / reference PCR",
    target: "Strongyloides stercoralis",
    qualitative: true,
    markers: [],
  },
  {
    value: "toxoplasma_pcr",
    label: "Toxoplasma gondii PCR",
    test: "parasite_pcr",
    platform: "In-house / reference PCR",
    target: "Toxoplasma gondii",
    qualitative: true,
    markers: [],
  },
  {
    value: "filaria_pcr",
    label: "Filaria PCR (W. bancrofti / Brugia spp.)",
    test: "parasite_pcr",
    platform: "Reference PCR",
    target: "Wuchereria bancrofti / Brugia spp.",
    qualitative: true,
    markers: [],
  },
];

// Lookups over the catalogue.
export const MOLECULAR_ASSAYS_FOR_TEST = (testValue) =>
  MOLECULAR_ASSAYS.filter((a) => a.test === testValue);

export const MOLECULAR_ASSAY_BY_VALUE = Object.fromEntries(
  MOLECULAR_ASSAYS.map((a) => [a.value, a])
);

// NAAT result is notifiable (public-health) when these ordered tests detect a
// notifiable pathogen on a "Detected" result. Starter: MTB (GeneXpert).
export const NAAT_NOTIFIABLE_TESTS = ["gene_xpert"];

// ─── Tab 9 — Serology & antigen ───────────────────────────────────────────────
// Immunological methods (no viable organism; results 1–6 h). Which ordered-test
// values (from ALL_ORDERED_TESTS) route a specimen to Tab 9.
export const SEROLOGY_TEST_VALUES = [
  "serology_panel",
  "dengue_serology",
  "hiv_hepatitis_serology",
  "virology_serology",
  "fungal_antigen",
  "parasite_antigen",
];

// Is a serology order offered for a specimen (driven by its ordered tests)?
export const serologyTestsFor = (tests) =>
  (Array.isArray(tests) ? tests : []).filter((tv) => SEROLOGY_TEST_VALUES.includes(tv));

// Result vocabularies. Serological assays read Reactive / Non-reactive / Equivocal;
// antigen-detection assays (NS1, RDT, CrAg) read Positive / Negative / Equivocal.
export const SEROLOGY_RESULT_OPTIONS = ["Reactive", "Non-reactive", "Equivocal"];
export const SEROLOGY_ANTIGEN_RESULT_OPTIONS = ["Positive", "Negative", "Equivocal"];

// Methods (manufacturer IFU / lab menu).
export const SEROLOGY_METHOD_OPTIONS = ["ELISA", "CLIA", "LFIA (rapid card)", "Latex agglutination", "Tube agglutination", "Immunochromatography"];

// Interpretation vocabulary for the per-order interpretation field.
export const SEROLOGY_INTERPRETATION_OPTIONS = ["Positive", "Negative", "Borderline", "Equivocal"];

// ─── Curated serology assay catalogue (Tab 9) ─────────────────────────────────
// Each assay belongs to one ordered-test value (`test`), declares its default
// method, its result vocabulary (serological vs antigen-detection), an optional
// quantitative unit (titre / index / IU), and an optional advisory reflex rule
// shown as a banner when the recorded result matches `reflex_when`. This is a
// STARTER main menu — the virology sub-panel and parasite/fungal additions grow
// per the lab's actual menu (see the plan Tab 9 gap-extension notes).
export const SEROLOGY_ASSAYS = [
  // ── serology_panel — general bacterial / febrile serology ──
  { value: "widal_o_h", label: "Widal — O and H titres", test: "serology_panel", method: "Tube agglutination", result_type: "serological", unit: "Titre (1:x)" },
  { value: "brucella_agglutination", label: "Brucella agglutination", test: "serology_panel", method: "Tube agglutination", result_type: "serological", unit: "Titre (1:x)" },
  { value: "leptospira_mat", label: "Leptospira MAT / IgM", test: "serology_panel", method: "ELISA", result_type: "serological" },
  { value: "aso_titre", label: "ASO titre", test: "serology_panel", method: "Latex agglutination", result_type: "serological", unit: "IU/mL" },
  { value: "crp", label: "CRP", test: "serology_panel", method: "Latex agglutination", result_type: "serological", unit: "mg/L" },

  // ── dengue_serology ──
  { value: "dengue_ns1", label: "Dengue NS1 antigen", test: "dengue_serology", method: "ELISA", result_type: "antigen" },
  { value: "dengue_igm", label: "Dengue IgM", test: "dengue_serology", method: "ELISA", result_type: "serological", reflex_when: "Equivocal", reflex: "Equivocal Dengue IgM — clinical correlation recommended" },
  { value: "dengue_igg", label: "Dengue IgG", test: "dengue_serology", method: "ELISA", result_type: "serological" },

  // ── hiv_hepatitis_serology ──
  { value: "hiv_agab_4g", label: "HIV Ag/Ab — 4th generation", test: "hiv_hepatitis_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "Reactive HIV Ag/Ab — reflex to confirmatory algorithm (Western blot / supplemental assay) before reporting" },
  { value: "hbsag", label: "HBsAg", test: "hiv_hepatitis_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "HBsAg reactive — full HBV panel auto-prompted (HBeAg, anti-HBe, anti-HBc IgM)" },
  { value: "anti_hcv", label: "Anti-HCV", test: "hiv_hepatitis_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "Anti-HCV reactive — HCV RNA PCR (Tab 8) auto-prompted to distinguish active from resolved infection" },
  { value: "hav_igm", label: "HAV IgM", test: "hiv_hepatitis_serology", method: "CLIA", result_type: "serological" },

  // ── fungal_antigen ──
  { value: "galactomannan", label: "Galactomannan index", test: "fungal_antigen", method: "ELISA", result_type: "serological", unit: "Index" },
  { value: "cryptococcal_ag", label: "Cryptococcal antigen", test: "fungal_antigen", method: "LFIA (rapid card)", result_type: "antigen", unit: "Titre (1:x)" },
  { value: "beta_d_glucan", label: "Beta-D-glucan", test: "fungal_antigen", method: "ELISA", result_type: "serological", unit: "pg/mL" },

  // ── parasite_antigen ──
  { value: "toxo_igm", label: "Toxoplasma gondii IgM", test: "parasite_antigen", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "Reactive Toxoplasma IgM — reflex to IgG avidity (distinguishes recent vs remote infection)" },
  { value: "toxo_igg", label: "Toxoplasma gondii IgG", test: "parasite_antigen", method: "CLIA", result_type: "serological", unit: "IU/mL" },
  { value: "toxo_igg_avidity", label: "Toxoplasma IgG avidity", test: "parasite_antigen", method: "ELISA", result_type: "serological", unit: "Avidity index %" },
  { value: "rk39_leishmania", label: "Leishmania rK39 (rapid / ELISA)", test: "parasite_antigen", method: "LFIA (rapid card)", result_type: "antigen" },
  { value: "echinococcus_igg", label: "Echinococcus IgG (hydatid)", test: "parasite_antigen", method: "ELISA", result_type: "serological" },
  { value: "strongyloides_igg", label: "Strongyloides stercoralis IgG", test: "parasite_antigen", method: "ELISA", result_type: "serological" },
  { value: "schistosoma_igg", label: "Schistosoma IgG", test: "parasite_antigen", method: "ELISA", result_type: "serological" },
  { value: "toxocara_igg", label: "Toxocara IgG", test: "parasite_antigen", method: "ELISA", result_type: "serological" },
  { value: "filaria_og4c3", label: "Filaria antigen (Og4C3 ELISA)", test: "parasite_antigen", method: "ELISA", result_type: "serological" },
  { value: "malaria_rdt", label: "Malaria RDT (HRP2 / pLDH)", test: "parasite_antigen", method: "LFIA (rapid card)", result_type: "antigen", reflex_when: "Positive", reflex: "Positive malaria RDT — blood-film examination required for species confirmation and parasitaemia quantification (Tab 3)" },

  // ── virology_serology ──
  { value: "hcv_rna_followup", label: "HCV RNA (viral load) — follow-up", test: "virology_serology", method: "RT-PCR", result_type: "serological", unit: "IU/mL" },
  { value: "hbv_panel", label: "HBV marker panel (HBeAg / anti-HBe / anti-HBc)", test: "virology_serology", method: "CLIA", result_type: "serological" },
  { value: "hbv_anti_hbc_igm", label: "HBV anti-HBc IgM (acute marker)", test: "virology_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "Anti-HBc IgM reactive — acute HBV; IDSP notifiable flag to Tab 13; HBV DNA PCR (Tab 8) for management" },
  { value: "hbv_anti_hbs", label: "HBV anti-HBs (quantitative — immune status)", test: "virology_serology", method: "CLIA", result_type: "serological", unit: "mIU/mL (≥10 = protected)" },
  { value: "hdv_igm", label: "HDV anti-HDV IgM", test: "virology_serology", method: "ELISA", result_type: "serological", reflex_when: "Reactive", reflex: "HDV meaningful only if HBsAg positive — confirm HBsAg result before reporting" },
  { value: "hdv_igg", label: "HDV anti-HDV IgG", test: "virology_serology", method: "ELISA", result_type: "serological" },
  { value: "hev_igm", label: "HEV IgM", test: "virology_serology", method: "ELISA", result_type: "serological", reflex_when: "Reactive", reflex: "HEV IgM reactive — IDSP notifiable in outbreak context (Tab 13); clinical correlation advised" },
  { value: "hev_igg", label: "HEV IgG", test: "virology_serology", method: "ELISA", result_type: "serological" },
  { value: "cmv_igm", label: "CMV IgM", test: "virology_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "Reactive CMV IgM — reflex to IgG avidity (high = past infection, low = primary within ~3 months); transplant patients → CMV PCR load (Tab 8)" },
  { value: "cmv_igg", label: "CMV IgG", test: "virology_serology", method: "CLIA", result_type: "serological", unit: "IU/mL" },
  { value: "cmv_igg_avidity", label: "CMV IgG avidity", test: "virology_serology", method: "ELISA", result_type: "serological", unit: "Avidity index %" },
  { value: "cmv_pp65", label: "CMV pp65 antigenemia (semi-quant)", test: "virology_serology", method: "Immunofluorescence", result_type: "serological", unit: "Positive cells / 200,000 leucocytes" },
  { value: "ebv_vca_igm", label: "EBV VCA IgM", test: "virology_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "EBV VCA IgM reactive — check EBNA IgG: VCA IgM+ / EBNA− pattern consistent with primary EBV infection" },
  { value: "ebv_vca_igg", label: "EBV VCA IgG", test: "virology_serology", method: "CLIA", result_type: "serological" },
  { value: "ebv_ea_igg", label: "EBV Early Antigen (EA) IgG", test: "virology_serology", method: "CLIA", result_type: "serological" },
  { value: "ebv_ebna_igg", label: "EBV EBNA IgG", test: "virology_serology", method: "CLIA", result_type: "serological" },
  { value: "hsv1_igm", label: "HSV-1 IgM", test: "virology_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "HSV serology unreliable for active lesions — PCR preferred for lesion diagnosis (Tab 8)" },
  { value: "hsv1_igg", label: "HSV-1 IgG", test: "virology_serology", method: "CLIA", result_type: "serological" },
  { value: "hsv2_igm", label: "HSV-2 IgM", test: "virology_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "HSV serology unreliable for active lesions — PCR preferred for lesion diagnosis (Tab 8)" },
  { value: "hsv2_igg", label: "HSV-2 IgG", test: "virology_serology", method: "CLIA", result_type: "serological" },
  { value: "vzv_igm", label: "VZV IgM", test: "virology_serology", method: "CLIA", result_type: "serological" },
  { value: "vzv_igg", label: "VZV IgG (immune status)", test: "virology_serology", method: "CLIA", result_type: "serological", unit: "mIU/mL" },
  { value: "rubella_igm", label: "Rubella IgM", test: "virology_serology", method: "CLIA", result_type: "serological", reflex_when: "Reactive", reflex: "Reactive Rubella IgM — reflex to IgG avidity; in pregnancy: urgent congenital rubella risk flag (Tab 11)" },
  { value: "rubella_igg", label: "Rubella IgG (immune status)", test: "virology_serology", method: "CLIA", result_type: "serological", unit: "IU/mL (≥10 = immune)" },
  { value: "rubella_igg_avidity", label: "Rubella IgG avidity", test: "virology_serology", method: "ELISA", result_type: "serological", unit: "Avidity index %" },
  { value: "parvo_b19_igm", label: "Parvovirus B19 IgM", test: "virology_serology", method: "ELISA", result_type: "serological" },
  { value: "parvo_b19_igg", label: "Parvovirus B19 IgG", test: "virology_serology", method: "ELISA", result_type: "serological" },
  { value: "measles_igm", label: "Measles IgM", test: "virology_serology", method: "ELISA", result_type: "serological" },
  { value: "measles_igg", label: "Measles IgG", test: "virology_serology", method: "ELISA", result_type: "serological" },
  { value: "mumps_igm", label: "Mumps IgM", test: "virology_serology", method: "ELISA", result_type: "serological" },
  { value: "mumps_igg", label: "Mumps IgG", test: "virology_serology", method: "ELISA", result_type: "serological" },
];

// Lookups over the catalogue.
export const SEROLOGY_ASSAYS_FOR_TEST = (testValue) =>
  SEROLOGY_ASSAYS.filter((a) => a.test === testValue);

export const SEROLOGY_ASSAY_BY_VALUE = Object.fromEntries(
  SEROLOGY_ASSAYS.map((a) => [a.value, a])
);

// ─── Tab 10 — Mycobacteriology / AFB (long-track) ─────────────────────────────
// Mycobacteria run on a different timescale (AFB smear in hours; LJ culture
// 6–8 wks; DST +3–4 wks). This tab is the AFB + speciation + DST layer on top of
// the shared Tab 4/5 culture reads (weekly-to-Wk-8 is already seeded there for
// lj_mgit specimens — see readScheduleFor). Which ordered-test values route a
// specimen to Tab 10.
export const MYCO_TEST_VALUES = ["afb_smear", "lj_mgit_culture"];

export const mycoTestsFor = (tests) =>
  (Array.isArray(tests) ? tests : []).filter((tv) => MYCO_TEST_VALUES.includes(tv));

// Species (WHO/RNTCP).
export const MYCO_SPECIES_OPTIONS = [
  "Mycobacterium tuberculosis complex (MTBC)",
  "M. avium complex (MAC)",
  "M. kansasii",
  "M. abscessus",
  "M. fortuitum",
  "Other NTM",
];

// ID methods specific to mycobacteria (Tab 5 generic ID methods also exist).
export const MYCO_ID_METHOD_OPTIONS = [
  "Line probe assay (LPA — GenoType MTBDRplus)",
  "MALDI-TOF (mycobacterial library)",
  "Sequencing (16S rRNA / hsp65 / rpoB)",
];

// DST methods (CLSI M24 / WHO).
export const MYCO_DST_METHOD_OPTIONS = ["MGIT 960 DST (liquid)", "LJ proportion method (solid)"];

export const MYCO_DST_RESULT_OPTIONS = ["Sensitive", "Resistant"];

// First-line panel (drug key → label + critical concentration guidance).
export const MYCO_FIRST_LINE_PANEL = [
  { drug: "isoniazid", label: "Isoniazid", concentration: "0.1 µg/mL (MGIT) / 0.2 µg/mL (LJ)" },
  { drug: "rifampicin", label: "Rifampicin", concentration: "1.0 µg/mL (MGIT) / 40 µg/mL (LJ)" },
  { drug: "ethambutol", label: "Ethambutol", concentration: "5.0 µg/mL (MGIT) / 2.0 µg/mL (LJ)" },
  { drug: "pyrazinamide", label: "Pyrazinamide", concentration: "100 µg/mL (MGIT pH 6.0)" },
];

// Second-line panel — revealed only when first-line resistance is flagged.
// `category` is a DISPLAY label (WHO DR-TB drug group + class) printed beside the
// result. It drives no logic — the classification rule works off the drug labels,
// not these strings.
// Bedaquiline and linezolid are the two Group A drugs that define XDR-TB under
// the WHO 2021 rule; clofazimine (Group B) takes no part in it.
export const MYCO_SECOND_LINE_PANEL = [
  { drug: "levofloxacin", label: "Levofloxacin", category: "Fluoroquinolone · Group A", concentration: "1.0 µg/mL" },
  { drug: "moxifloxacin", label: "Moxifloxacin", category: "Fluoroquinolone · Group A", concentration: "0.25 µg/mL" },
  { drug: "amikacin", label: "Amikacin", category: "Injectable · Group C", concentration: "1.0 µg/mL" },
  { drug: "kanamycin", label: "Kanamycin", category: "Injectable · Group C", concentration: "2.5 µg/mL" },
  { drug: "bedaquiline", label: "Bedaquiline", category: "Group A — XDR-defining", concentration: "1.0 µg/mL" },
  { drug: "linezolid", label: "Linezolid", category: "Group A — XDR-defining", concentration: "1.0 µg/mL" },
  { drug: "clofazimine", label: "Clofazimine", category: "Group B", concentration: "1.0 µg/mL" },
];

// Pure deterministic helpers for the isolate's first/second-line results.
// rows: [{ drug, result: "Sensitive"|"Resistant" }]
export function mycoFirstLineResistance(firstLine = []) {
  const resistant = (firstLine || []).filter((r) => r.result === "Resistant").map((r) => r.drug);
  const isonHRes = resistant.includes("isoniazid");
  const rifRes = resistant.includes("rifampicin");
  return { resistant, mdr: isonHRes && rifRes };
}

// TB drug-resistance classification for a phenotypic DST panel.
//
// The RULE lives in exactly one place — deriveTbClassification (defined with the
// genomics constants below), which is also what the tNGS panel (Tab 15) uses, so
// the two tabs cannot classify the same strain differently.
//
// WHO 2021 definitions. The pre-2021 rule keyed XDR on the injectables; that was
// dropped when amikacin/kanamycin/capreomycin left the core DR-TB regimen, and a
// definition resting on drugs nobody prescribes stopped meaning anything.
//   DS-TB       susceptible to all
//   RR-TB       resistant to rifampicin
//   MDR-TB      resistant to isoniazid AND rifampicin
//   pre-XDR-TB  MDR + resistant to any fluoroquinolone
//   XDR-TB      pre-XDR + resistant to bedaquiline OR linezolid
//
// DST rows here use drug KEYS (lower-case) and read Sensitive / Resistant; the
// shared classifier works on the label vocabulary the tNGS panel records.
const TB_DRUG_LABELS = Object.fromEntries(
  [...MYCO_FIRST_LINE_PANEL, ...MYCO_SECOND_LINE_PANEL].map((d) => [d.drug, d.label])
);

// Returns "" when no DST result has been recorded — an untested isolate is NOT
// the same as a susceptible one, and "DS-TB" must never be inferred from silence.
export function mycoClassification(firstLine = [], secondLine = []) {
  const rows = [...(firstLine || []), ...(secondLine || [])].filter((r) => r && r.result);
  if (rows.length === 0) return "";
  return deriveTbClassification(
    rows.map((r) => ({
      drug: TB_DRUG_LABELS[r.drug] || r.drug,
      predicted_phenotype: r.result === "Resistant" ? "Resistant" : "Susceptible",
    }))
  );
}

// What each classification means, for the badge caption. States the rule rather
// than reconstructing it from the drug rows.
export const TB_CLASSIFICATION_NOTES = {
  "DS-TB": "susceptible to all tested first-line drugs",
  "RR-TB": "resistant to rifampicin",
  "MDR-TB": "resistant to isoniazid + rifampicin",
  "pre-XDR-TB": "MDR + resistant to a fluoroquinolone",
  "XDR-TB": "pre-XDR + resistant to bedaquiline or linezolid",
};

// ─── Tab 12 — Clinical interpretation ─────────────────────────────────────────
// Case-level synthesis option lists. Interpretation is one synthesis subtree
// (not keyed by specimen_id) — the microbiologist reviews all tracks together.
// The `interpretation` section shape is documented in documentation/MICROBIOLOGY.md.

// Per-organism significance (the core synthesis decision).
export const INTERPRETATION_SIGNIFICANCE_OPTIONS = [
  "Definite pathogen",
  "Likely pathogen",
  "Probable commensal",
  "Contaminant",
];

// Concordance of culture/molecular findings with the direct exam (Tab 3).
export const INTERPRETATION_CONCORDANCE_EXAM_OPTIONS = [
  "Concordant",
  "Discordant",
  "Explain",
];

// Concordance with the clinical picture (clinical context from Tab 1).
export const INTERPRETATION_CONCORDANCE_CLINICAL_OPTIONS = [
  "Consistent",
  "Inconsistent",
  "Explain",
];

// ─── Tab 14 — Final sign-out ─────────────────────────────────────────────────
// Final-report composition + pre-sign-out checklist. The report feeds nothing
// downstream (it IS the terminal output); sign-out flips the case status and
// locks every section.

// Report status vocabulary. Only "Final" is signable.
export const FINAL_REPORT_STATUS_OPTIONS = ["Draft", "Final"];

// Structured final diagnosis vocabulary. The diagnosis is the case's clinical
// conclusion stated at sign-out — distinct from Tab 12's interpretation rows
// (which assess individual organisms) and from the ICD-10 coding below.
export const FINAL_INFECTION_SITE_OPTIONS = [
  "Urinary tract",
  "Lower respiratory tract",
  "Upper respiratory tract",
  "Bloodstream / sepsis",
  "Skin & soft tissue",
  "Intra-abdominal",
  "Central nervous system",
  "Bone & joint",
  "Gastrointestinal / enteric",
  "Genital tract",
  "Device-related",
  "Ocular",
  "Other / not determined",
];

// Acquisition — community vs healthcare-associated (HCAI). "Indeterminate" is
// the honest option when the onset date and admission history don't settle it.
export const FINAL_ACQUISITION_OPTIONS = [
  "Community-acquired",
  "Healthcare-associated (HCAI)",
  "Indeterminate",
];

// Device-associated infection — surveillance-relevant (CLABSI/CAUTI/VAP/SSI);
// the free-text detail field carries the device and insertion date.
export const FINAL_DEVICE_ASSOCIATED_OPTIONS = [
  "None",
  "CLABSI (central line)",
  "CAUTI (urinary catheter)",
  "VAP / ventilator-associated",
  "SSI (surgical site)",
  "Other device",
];

export const FINAL_DIAGNOSIS_CERTAINTY_OPTIONS = ["Confirmed", "Probable", "Possible"];

// ICD-10 / coding vocabulary (starter — free-text also allowed).
export const ICD10_ORGANISM_CODE_OPTIONS = [
  "B96.20 (unspecified E. coli)",
  "B96.5 (Pseudomonas)",
  "A15.0 (pulmonary TB)",
  "B95.6 (S. aureus)",
  "B95.2 (Enterococcus)",
  "B34.9 (unspecified viral)",
  "Other / free code",
];

export const ICD10_SITE_CODE_OPTIONS = [
  "N39.0 (UTI)",
  "J15.9 (unspecified pneumonia)",
  "A41.9 (unspecified sepsis)",
  "L08.9 (local skin infection)",
  "B99 (other infectious disease)",
  "Other / free code",
];

// Coded comment library — the standard laboratory comments a microbiologist
// attaches to a report. Ticked comments are stored and reported as their OWN
// block (final_report.comments.selected); they are never merged into the
// free-text report body. The free-text "additional comment" carries anything
// the list doesn't cover.
export const FINAL_REPORT_COMMENT_OPTIONS = [
  "No significant growth",
  "Mixed growth of probable commensal flora",
  "Growth of probable contaminant — repeat sample recommended",
  "Repeat sample recommended (post-treatment or inadequate sample)",
  "Culture performed after antibiotics started — interpret with caution",
  "Colony count below the significance threshold for this specimen",
  "Unable to interpret — pre-treatment sample required",
  "Speciation / susceptibility referred to reference laboratory",
  "Clinical correlation advised",
];

// Antimicrobial stewardship record at sign-out. Tab 12 records the antimicrobial
// commentary written while interpreting; these capture the final therapy advice
// issued WITH the report (duration, route switch, de-escalation decision,
// restricted-agent approval) plus whether a stewardship review happened at all.
export const FINAL_STEWARDSHIP_REVIEWED_OPTIONS = ["Yes", "No", "Not applicable"];

export const FINAL_IV_ORAL_OPTIONS = ["Yes", "No", "Not applicable"];

// Pre-sign-out checklist keys — derived or user-confirmed. Each is a
// [key, label] tuple; the UI derives most, the server enforces only the
// ESSENTIAL subset (see microbiology.py sign-out endpoint + documentation
// Part III).
export const FINAL_CHECKLIST = [
  ["ordered_tests_results", "All ordered tests have results or a documented reason"],
  ["ast_qc_passed", "QC passed for all reported AST runs"],
  ["critical_notified", "Critical / notifiable values have a recorded dispatch (Tab 13)"],
  ["interpretation_confirmed", "Clinical interpretation confirmed by a microbiologist (Tab 12)"],
  ["windows_closed", "Incubation windows closed OR positive results confirmed"],
  ["cascade_confirmed", "Cascade reporting applied and confirmed (Tab 12)"],
];

// ══════════════════════════════════════════════════════════════════════════════
// Tabs 15 / 16 — Genomics
//
// Two tracks share this catalogue but NOT a data model:
//   Tab 15 Pathogen genomics  — keyed by specimen_id. "This K. pneumoniae from
//                               this urine is ST131 with blaNDM-1" is a property
//                               of that specimen of that case.
//   Tab 16 Human genomics     — pharmacogenomics. A lifelong property of the
//                               PATIENT, true across every future case, so it is
//                               stored case-level and read as a patient register.
//
// Scope is pharmacogenomics + host susceptibility only. Germline / hereditary
// cancer testing is deliberately NOT here — the precision-oncology pipeline owns
// it (T6 germline screener, M9 germline pathogenicity). See
// microbiology_genomics_plan_v2.md (decisions D2 and D6).
// ══════════════════════════════════════════════════════════════════════════════

// ─── Tab 15 — ordered-test family ─────────────────────────────────────────────
// The keys a specimen may carry in tests_ordered. Drives both the sub-tab bar
// inside Tab 15 and the sidebar's pathogen-genomics track activation.

export const GENOMICS_TEST_VALUES = [
  "pathogen_wgs",
  "mngs",
  "tngs_tb",
  "amplicon_id",
  "resistance_genotyping",
  "typing_ipc",
];

export const genomicsTestsFor = (tests) =>
  (Array.isArray(tests) ? tests : []).filter((tv) => GENOMICS_TEST_VALUES.includes(tv));

// ─── Tab 15 — sequencing platforms and laboratories ───────────────────────────

export const GENOMICS_PLATFORMS = [
  "Illumina MiSeq",
  "Illumina NextSeq",
  "Illumina NovaSeq",
  "Oxford Nanopore MinION",
  "Oxford Nanopore Flongle",
  "Oxford Nanopore GridION",
  "Ion Torrent Genexus",
  "Other",
];

// Sequencing runs in-house (this plan's decision D3). The external entries are
// kept because a result may still be referred out or received from a partner lab.
export const SEQUENCING_LABS = [
  "In-house",
  "MedGenome",
  "Strand Life Sciences",
  "Rajiv Gandhi Centre for Biotechnology (RGCB)",
  "NCBS Bangalore",
  "NIBMG Kolkata",
  "External — other",
];

// ─── Tab 15 — bioinformatics pipelines ────────────────────────────────────────
// Pipeline NAME + VERSION must be recorded per run (ISO 15189 traceability).
// These lists only offer the name; the version is free text on the record.

export const WGS_PIPELINES = [
  "TBProfiler",
  "Mykrobe",
  "Bactopia",
  "Snippy",
  "Galaxy",
  "Dragonflye (Nanopore)",
  "Custom in-house pipeline",
];

export const MNGS_PIPELINES = [
  "CZ ID (Chan Zuckerberg IDseq)",
  "Kraken2 + Bracken",
  "MetaPhlAn4",
  "Kaiju",
  "Custom in-house pipeline",
];

// ─── Tab 15 — tNGS-TB assay names ─────────────────────────────────────────────
// The 2025 WHO pathway places tNGS after a nucleic-acid test (GeneXpert), so the
// record carries the prior aNAAT result alongside the assay.

export const TNGS_ASSAYS = [
  "Deeplex Myc-TB",
  "Genoscholar NTM+MDRTB II (Nipro)",
  "In-house amplicon panel",
  "Other",
];

// The prior aNAAT the tNGS record carries. Its own vocabulary rather than Tab 8's
// qualitative list, because the tNGS record states the result in the wording the
// WHO pathway and the report use ("MTB not detected"), not the NAAT panel's.
export const GENEXPERT_RESULT_OPTIONS = ["MTB not detected", "MTB detected", "Invalid", "Not done"];

export const GENEXPERT_RIF_OPTIONS = [
  "Rifampicin resistance not detected",
  "Rifampicin resistance detected",
  "Indeterminate",
  "Not done",
];

// ─── Tab 15 — resistance vocabulary ───────────────────────────────────────────
// Every resistance-gene row cites the database it came from, because two
// databases disagreeing about the same gene is a real reporting problem.

export const AMR_GENE_DATABASES = [
  "CARD",
  "ResFinder",
  "PointFinder",
  "AMRFinderPlus",
  "WHO TB Mutation Catalogue v2 (2023)",
  "MEGARes",
  "Other",
];

export const RESISTANCE_GENE_CLASSES = [
  "Beta-lactam",
  "Carbapenem",
  "Glycopeptide",
  "Fluoroquinolone",
  "Aminoglycoside",
  "Macrolide",
  "Tetracycline",
  "Oxazolidinone",
  "Rifamycin",
  "Isoniazid",
  "Folate pathway",
  "Colistin",
  "Daptomycin",
  "Echinocandin",
  "Azole",
  "Other",
];

export const RESISTANCE_MECHANISMS = [
  "Enzymatic inactivation",
  "Target alteration / mutation",
  "Efflux pump overexpression",
  "Outer membrane porin loss",
  "Target bypass",
  "Ribosomal protection",
  "Unknown",
];

// Confidence of a resistance call. Uncertain significance is a first-class
// outcome, not an afterthought — a call without a tier is not reportable as
// resistant (WHO TB catalogue Groups 3/4/5 exist for exactly this).
export const CARD_CONFIDENCE = [
  "High (>95% identity, >90% coverage)",
  "Moderate (80–95% identity or 70–90% coverage)",
  "Low (<80% identity or <70% coverage)",
];

// Predicted phenotype. Genomic resistance is always "predicted" — phenotypic AST
// stays the reference, and discordance is recorded (see
// GENOTYPE_PHENOTYPE_CONCORDANCE). Porin loss, efflux and non-expression mean a
// detected gene does not always mean clinical resistance.
export const PREDICTED_PHENOTYPE_OPTIONS = [
  "Resistant",
  "Susceptible",
  "Intermediate",
  "Uncertain significance",
];

export const GENOTYPE_PHENOTYPE_CONCORDANCE = [
  "Concordant",
  "Discordant — genotype resistant, phenotype susceptible",
  "Discordant — genotype susceptible, phenotype resistant",
  "Partial — see note",
  "Not done",
];

// ─── Tab 15 — WHO TB mutation catalogue ───────────────────────────────────────
// The mandatory interpretation reference for tNGS and WGS of MTBC. Confidence
// groups are quoted verbatim from the catalogue.

export const WHO_TB_CONFIDENCE_GROUPS = [
  "Group 1 — Associated with resistance",
  "Group 2 — Associated with resistance (interim)",
  "Group 3 — Uncertain significance",
  "Group 4 — Not associated with resistance (interim)",
  "Group 5 — Not associated with resistance",
];

export const TB_GENOMIC_CLASSIFICATIONS = ["DS-TB", "RR-TB", "MDR-TB", "pre-XDR-TB", "XDR-TB"];

// Advisory regimen note per classification. A SUGGESTION the microbiologist
// edits before dispatch — never auto-written onto the record, because the
// regimen decision belongs to the treating clinician and the DR-TB committee.
// Prefilled from the derived classification, not from the mutation list.
export const TB_REGIMEN_SUGGESTIONS = {
  "DS-TB": "Susceptible profile — standard regimen (2HRZE/4HR), subject to phenotypic confirmation.",
  "RR-TB": "Rifampicin-resistant — refer for a DR-TB regimen; consider BPaLM if bedaquiline and linezolid are susceptible.",
  "MDR-TB": "MDR-TB — BPaLM (Bedaquiline–Pretomanid–Linezolid–Moxifloxacin) if bedaquiline and linezolid are susceptible; otherwise an individualized longer regimen.",
  "pre-XDR-TB": "pre-XDR-TB — individualized DR-TB regimen required; fluoroquinolone resistance limits BPaLM. Refer to the DR-TB committee.",
  "XDR-TB": "XDR-TB — individualized regimen only. Notify the national TB programme immediately.",
};

// WHO 2024 DR-TB regimen drug panel (Groups A/B/C) plus first-line.
export const TNGS_DRUG_PANEL = [
  "Isoniazid",
  "Rifampicin",
  "Pyrazinamide",
  "Ethambutol",
  "Levofloxacin",
  "Moxifloxacin",
  "Bedaquiline",
  "Linezolid",
  "Clofazimine",
  "Cycloserine / Terizidone",
  "Delamanid",
  "Pretomanid",
  "Imipenem-cilastatin",
  "Meropenem",
  "Amikacin",
  "Streptomycin",
  "Kanamycin",
  "Capreomycin",
  "Ethionamide / Prothionamide",
  "PAS",
];

// ─── Tab 15 — mNGS ────────────────────────────────────────────────────────────

export const MNGS_KINGDOMS = ["Bacteria", "Virus", "Fungi", "Parasite", "Unknown"];

// Rank of an mNGS hit. Deliberately coarser than the taxonomy it comes from —
// the report reads at genus/species level whatever depth the run reached.
export const TAXON_RANK_OPTIONS = ["Species", "Genus", "Family", "Order", "Other"];

export const MNGS_BACKGROUND_OPTIONS = [
  "Significantly above background",
  "Borderline — review in clinical context",
  "Below background threshold — likely contaminant",
];

export const MNGS_CLINICAL_SIGNIFICANCE = [
  "Definite pathogen",
  "Likely pathogen",
  "Commensal / contaminant",
  "Unknown",
];

export const MNGS_INPUT_OPTIONS = [
  "DNA only",
  "RNA only",
  "Total nucleic acid (DNA + RNA)",
];

export const HOST_DEPLETION_OPTIONS = [
  "Yes — saponin / methylation",
  "Yes — other method",
  "No",
];

// ─── Tab 15 — sample input, typing, identification ────────────────────────────

// What was actually sequenced. Bacterial WGS needs a pure isolate; tNGS and
// mNGS can run on the direct specimen.
export const SPECIMEN_INPUT_TYPES = [
  "Pure culture isolate",
  "Direct specimen",
  "Culture broth",
];

export const ID_RESOLUTION_LEVELS = ["Species", "Genus", "Complex", "Unresolved"];

export const IDENTIFICATION_CONFIDENCE_OPTIONS = [
  "High (≥99% identity)",
  "Moderate (90–99% identity)",
  "Low (<90% identity)",
  "Unresolved",
];

export const ID_TOOL_OPTIONS = [
  "Kraken2",
  "MASH",
  "MLST",
  "MALDI-TOF confirmed",
  "BLAST / reference alignment",
  "Other",
];

// Strain typing schemes. `lineage` is MTBC-specific (WHO lineages 1–4 + sub-
// lineage) and only renders when the identified species is MTBC.
export const TYPING_SCHEMES = [
  "MLST (PubMLST)",
  "cgMLST",
  "wgMLST",
  "spa typing",
  "SCCmec",
  "SNP-distance",
  "Ribotype",
  "Clade assignment",
  "Other",
];

export const SEROTYPE_SCHEMES = [
  "SeqSero2 (Salmonella)",
  "SeroTypeFinder (E. coli)",
  "PneumoCAT (S. pneumoniae)",
  "Other",
];

export const VIRULENCE_GENE_CATEGORIES = [
  "Toxin",
  "Adhesin",
  "Invasin",
  "Capsule",
  "Siderophore",
  "Immune evasion",
  "Other",
];

// ─── Tab 15 — epidemiology / outbreak ─────────────────────────────────────────

export const EPIDEMIOLOGICAL_LINK_OPTIONS = [
  "Confirmed — linked to known cluster",
  "Possible — within SNP threshold",
  "No epidemiological link",
  "Under investigation",
];

// Typing targets for infection control live in the GENOTYPING_PANELS catalogue
// below, as the "ipc_typing" entry — a typing result is a panel like any other,
// so keeping a second list here would only let the two drift apart.

// ─── Tab 15 — amplicon (broad-range) identification ───────────────────────────
// Targets a conserved ribosomal region. Identification only — an amplicon result
// carries NO resistance information, and is meaningless on a non-sterile site.

export const AMPLICON_TARGETS = [
  "16S rRNA — V1–V3",
  "16S rRNA — V3–V4",
  "16S rRNA — V4",
  "16S rRNA — full length",
  "ITS1",
  "ITS2",
  "Other",
];

export const AMPLICON_DATABASES = ["SILVA", "Greengenes", "UNITE (ITS)", "EzBioCloud", "Other"];

// How a targeted panel's result was produced. Named for the panel rather than
// "methods" because constants.js is a flat namespace.
export const TARGETED_PANEL_METHODS = [
  "Amplicon sequencing (NGS)",
  "Sanger sequencing",
  "Allele-specific real-time PCR",
  "Line probe assay",
  "Other",
];

// ─── Tab 15 — targeted genotyping panels ──────────────────────────────────────
// `kind` drives the panel's result schema:
//   "resistance" → mutation → drug → predicted R/S rows
//   "identity"   → top taxa + identity % + database rows (16S / ITS only)
// `loci` is the offered target list; free text is still allowed for an unlisted
// locus, so an in-house panel is never blocked by this catalogue.

export const GENOTYPING_PANELS = [
  {
    value: "tb_dr",
    label: "M. tuberculosis drug resistance",
    kind: "resistance",
    loci: ["rpoB", "katG", "inhA promoter", "pncA", "embB", "gyrA", "rrs", "eis", "rplC", "atpE", "Rv0678"],
    drugs: ["Rifampicin", "Isoniazid", "Pyrazinamide", "Ethambutol", "Fluoroquinolones", "Aminoglycosides", "Bedaquiline", "Clofazimine", "Linezolid"],
  },
  {
    value: "hiv_pol",
    label: "HIV-1 genotypic resistance (pol)",
    kind: "resistance",
    loci: ["Protease", "Reverse transcriptase", "Integrase"],
    drugs: ["NRTI", "NNRTI", "PI", "INSTI"],
  },
  {
    value: "hbv_rt",
    label: "HBV resistance (RT / pol)",
    kind: "resistance",
    loci: ["RT domain", "YMDD motif", "HBsAg overlap"],
    drugs: ["Lamivudine", "Entecavir", "Tenofovir", "Adefovir"],
  },
  {
    value: "hcv_ns",
    label: "HCV resistance (NS3/4A, NS5A, NS5B)",
    kind: "resistance",
    loci: ["NS3/4A", "NS5A", "NS5B"],
    drugs: ["NS3/4A inhibitors", "NS5A inhibitors", "Sofosbuvir"],
  },
  {
    value: "cmv_ul",
    label: "CMV resistance (UL97, UL54)",
    kind: "resistance",
    loci: ["UL97 (kinase)", "UL54 (polymerase)"],
    drugs: ["Ganciclovir", "Valganciclovir", "Cidofovir", "Foscarnet"],
  },
  {
    value: "hsv_ul",
    label: "HSV resistance (UL23, UL30)",
    kind: "resistance",
    loci: ["UL23 (thymidine kinase)", "UL30 (polymerase)"],
    drugs: ["Aciclovir", "Valaciclovir", "Foscarnet"],
  },
  {
    value: "flu_na",
    label: "Influenza antiviral resistance",
    kind: "resistance",
    loci: ["NA (neuraminidase)", "M2"],
    drugs: ["Oseltamivir", "Zanamivir", "Adamantanes"],
  },
  {
    value: "aspergillus_cyp51a",
    label: "Aspergillus azole resistance (CYP51A)",
    kind: "resistance",
    loci: ["CYP51A — TR34/L98H", "CYP51A — TR46/Y121F/T289A", "CYP51A — other"],
    drugs: ["Voriconazole", "Itraconazole", "Posaconazole", "Isavuconazole"],
  },
  {
    value: "candida_fks",
    label: "Candida echinocandin / azole resistance",
    kind: "resistance",
    loci: ["FKS1 hotspot", "FKS2 hotspot", "ERG11"],
    drugs: ["Micafungin", "Caspofungin", "Anidulafungin", "Fluconazole"],
  },
  {
    value: "pf_resistance",
    label: "P. falciparum antimalarial resistance",
    kind: "resistance",
    loci: ["K13 propeller", "PfCRT", "PfMDR1", "PfDHFR", "PfDHPS"],
    drugs: ["Artemisinin", "Chloroquine", "Sulfadoxine-pyrimethamine", "Mefloquine"],
  },
  {
    value: "ng_star",
    label: "N. gonorrhoeae AMR (NG-STAR)",
    kind: "resistance",
    loci: ["penA", "mtrR", "porB", "gyrA", "parC", "23S rRNA", "rpsJ"],
    drugs: ["Ceftriaxone", "Cefixime", "Azithromycin", "Ciprofloxacin", "Tetracycline"],
  },
  {
    value: "rrna_16s",
    label: "16S rRNA broad-range identification",
    kind: "identity",
    loci: ["16S rRNA — V1–V3", "16S rRNA — V3–V4", "16S rRNA — V4", "16S rRNA — full length"],
    drugs: [],
  },
  {
    value: "its_fungal",
    label: "ITS broad-range fungal identification",
    kind: "identity",
    loci: ["ITS1", "ITS2"],
    drugs: [],
  },
  {
    // A typing result is neither a resistance call nor an identification — it is
    // a strain label used to link cases for infection control, and must not be
    // reported as indicating resistance.
    value: "ipc_typing",
    label: "Infection-control typing",
    kind: "typing",
    loci: [
      "MRSA spa / SCCmec",
      "VRE vanA / vanB typing",
      "Carbapenemase gene typing",
      "C. difficile ribotyping",
      "C. auris clade",
      "ESBL gene typing",
      "Other",
    ],
    drugs: [],
  },
];

export const GENOTYPING_PANEL_BY_VALUE = Object.fromEntries(
  GENOTYPING_PANELS.map((p) => [p.value, p])
);

// Display label for a stored panel value — reports cite the label, not the key.
export const genotypingPanelLabel = (value) =>
  GENOTYPING_PANEL_BY_VALUE[value]?.label || value || "";

// Panel options filtered to one kind — the Targeted-panels sub-tab offers
// resistance, identity and typing panels from separate selectors.
export const genotypingPanelsFor = (kind) => GENOTYPING_PANELS.filter((p) => p.kind === kind);

// The panels a specimen's ordered tests open up. One specimen may legitimately
// carry several targeted test types at once, so the three slices are unioned in
// the order the sub-tab shows them. Shared by the Targeted-panels panel (which
// offers them) and the dictation payload (which describes them to the model), so
// the two can never disagree about what may be picked.
export const genotypingPanelsForTests = (tests) => {
  const t = Array.isArray(tests) ? tests : [];
  const out = [];
  if (t.includes("resistance_genotyping")) out.push(...genotypingPanelsFor("resistance"));
  if (t.includes("amplicon_id")) out.push(...genotypingPanelsFor("identity"));
  if (t.includes("typing_ipc")) out.push(...genotypingPanelsFor("typing"));
  return out;
};

// ─── Tab 15 — sub-tab grouping ────────────────────────────────────────────────
// Six ordered tests collapse into four sub-tabs. `tests` lists the ordered-test
// keys that switch a sub-tab on; a sub-tab renders only when the specimen
// carries at least one of them.

export const GENOMICS_SUBTABS = [
  { key: "wgs", label: "WGS", tests: ["pathogen_wgs"] },
  { key: "mngs", label: "mNGS", tests: ["mngs"] },
  { key: "tngs", label: "TB — tNGS", tests: ["tngs_tb"] },
  { key: "targeted", label: "Targeted panels", tests: ["amplicon_id", "resistance_genotyping", "typing_ipc"] },
];

// Which sub-tabs a specimen shows is decided by which sub-records exist in the
// hydrated block (see hydrateSpecimen), not by re-reading tests_ordered — the
// stored shape is the single source, so the bar cannot disagree with the data.

// MTBC test — the WGS panel reveals the TB drug profile only when the
// identified species matches. Kept as a loose match because the free-text
// species field and MYCO_SPECIES_OPTIONS disagree in spelling.
export const isMtbcSpecies = (species) => /mtbc|tuberculosis|\bM\.\s*tb\b/i.test(species || "");

// ─── Tab 15 — TB classification, derived from the resistance calls ────────────
// WHO 2021 definitions. Deterministic — no LLM, same posture as cascade.js.
//   DS-TB      susceptible to all
//   RR-TB      resistant to rifampicin
//   MDR-TB     resistant to isoniazid AND rifampicin
//   pre-XDR-TB MDR + resistant to any fluoroquinolone
//   XDR-TB     pre-XDR + resistant to bedaquiline OR linezolid
export function deriveTbClassification(calls = []) {
  const resistant = (drug) =>
    (calls || []).some((c) => c.drug === drug && c.predicted_phenotype === "Resistant");
  const inh = resistant("Isoniazid");
  const rif = resistant("Rifampicin");
  if (!inh && !rif) return "DS-TB";
  const mdr = inh && rif;
  if (!mdr) return "RR-TB";
  const fq = resistant("Levofloxacin") || resistant("Moxifloxacin");
  const bdq = resistant("Bedaquiline");
  const lzd = resistant("Linezolid");
  if (fq && (bdq || lzd)) return "XDR-TB";
  if (fq) return "pre-XDR-TB";
  return "MDR-TB";
}

// ══════════════════════════════════════════════════════════════════════════════
// Tab 16 — Human genomics (pharmacogenomics + host susceptibility)
//
// Every pharmacogenomic result follows the same chain, and the chain IS the data
// model:
//     gene → star allele (diplotype) → activity score → phenotype → drug action
//
// The vocabulary below is CPIC's. Each gene row on a record cites its guideline
// and guideline VERSION, because CPIC revises phenotypes and dosing over time and
// a 2026 result must stay readable against the version it was issued under.
//
// NOT in scope (decision D2): germline / hereditary cancer testing, ACMG/AMP
// classification, VUS reclassification, cascade testing. The precision-oncology
// pipeline owns those.
// ══════════════════════════════════════════════════════════════════════════════

// ─── Tab 16 — ordered-test family ─────────────────────────────────────────────

export const PGX_TEST_VALUES = ["pgx_panel", "hla_typing", "g6pd"];

export const pgxTestsFor = (tests) =>
  (Array.isArray(tests) ? tests : []).filter((tv) => PGX_TEST_VALUES.includes(tv));

// ─── Tab 16 — panel and method ────────────────────────────────────────────────

export const PGX_PANELS = [
  "Core PGx panel (DPYD, TPMT, NUDT15, UGT1A1)",
  "Oncology toxicity panel",
  "Extended PGx panel",
  "Cardiology / anticoagulation panel",
  "Single gene",
  "Custom panel",
];

export const PGX_METHODS = [
  "Targeted genotyping (allele-specific PCR)",
  "Sanger sequencing",
  "NGS panel",
  "Whole genome sequencing",
  "Array-based genotyping",
  "CNV assay (MLPA / digital PCR)",
];

// ─── Tab 16 — specimen ────────────────────────────────────────────────────────
// EDTA whole blood is the default. HEPARIN IS A PCR INHIBITOR — a heparin tube
// must be rejected, and that rule lives on the specimen receipt block (Tab 2),
// not here. Saliva / buccal / DBS exist because a pre-emptive PGx order often
// happens outside a phlebotomy visit.
//
// Deliberately NOT the same list as PGX_TUBE_OPTIONS (Tab 2), and the two must
// not be merged: this list is what the ASSAY ran on, so every value here is by
// definition usable; that one is what ARRIVED at the bench, so it has to be able
// to say "heparin" and mean it. A value can therefore appear here and be a hard
// stop there, which is the whole point of the receipt check.
export const PGX_SPECIMEN_TYPES = [
  "EDTA whole blood",
  "Saliva (Oragene)",
  "Buccal swab",
  "Dried blood spot",
  "Other",
];

// ─── Tab 16 — CPIC vocabulary ─────────────────────────────────────────────────

export const CPIC_PHENOTYPES = [
  "Ultrarapid metabolizer",
  "Rapid metabolizer",
  "Normal metabolizer",
  "Intermediate metabolizer",
  "Poor metabolizer",
  "Indeterminate",
  "Not applicable",
];

// CPIC evidence levels. A = actionable and widely accepted; D = testing
// recommended but no action established.
export const CPIC_EVIDENCE_LEVELS = [
  "A — actionable, widely accepted",
  "B — actionable, some evidence",
  "C — testing recommended, action possible",
  "D — testing recommended, no action established",
];

export const PGX_GUIDELINE_SOURCES = [
  "CPIC",
  "DPWG (Dutch Pharmacogenetics Working Group)",
  "CPNDS (Canadian Pharmacogenomics Network)",
  "RNPGx (French National Network)",
  "FDA Table of Pharmacogenomic Biomarkers",
  "Institutional protocol",
];

// What the lab advises should happen to the drug. Deliberately not a dose number —
// the exact dose is the prescriber's decision; the lab states the direction.
export const PGX_DOSE_ACTIONS = [
  "Standard dose — no adjustment",
  "Reduce starting dose",
  "Increase starting dose",
  "Avoid — use alternative agent",
  "Avoid — contraindicated",
  "Insufficient evidence — use clinical judgement",
  "Not applicable",
];

export const PGX_RISK_CATEGORIES = [
  "Normal risk",
  "Increased risk of toxicity",
  "High risk of toxicity",
  "Risk of reduced efficacy",
  "Indeterminate",
];

// ─── Tab 16 — assay limitations ───────────────────────────────────────────────
// Recorded per result, not buried in a footnote. L1 (CYP2D6 copy number) and L3
// (no-call genes) are the two that cause real clinical error: a short-read panel
// cannot reliably call a whole-gene deletion, and a failed gene must report as
// "not analysed" — never as "normal".
export const PGX_ASSAY_LIMITATIONS = [
  "Copy number not assessed (deletions / duplications not detected)",
  "Rare or novel variants not covered",
  "Only the listed alleles were interrogated",
  "HLA resolution below allele level",
  "Phasing / cis-trans not determined",
  "Other — see note",
];

// ─── Tab 16 — pharmacogenomic genes ───────────────────────────────────────────
// `requiresCnv` marks the genes where a copy-number call is essential and a
// short-read result alone is not reportable.
// `note` is shown beside the gene row — it carries the clinical reason the gene
// is on the panel, which is what makes the panel defensible to a prescriber.

export const PGX_GENES = [
  {
    gene: "DPYD",
    label: "DPYD — dihydropyrimidine dehydrogenase",
    group: "Oncology toxicity",
    drugs: ["5-Fluorouracil", "Capecitabine", "Tegafur"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Reduced activity causes severe or fatal fluoropyrimidine toxicity. Activity score 0 → avoid; 0.5–1 → reduce starting dose.",
  },
  {
    gene: "TPMT",
    label: "TPMT — thiopurine S-methyltransferase",
    group: "Oncology toxicity",
    drugs: ["Azathioprine", "Mercaptopurine", "Thioguanine"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Poor metabolizers risk severe myelosuppression. Always interpreted together with NUDT15.",
  },
  {
    gene: "NUDT15",
    label: "NUDT15 — nudix hydrolase 15",
    group: "Oncology toxicity",
    drugs: ["Azathioprine", "Mercaptopurine", "Thioguanine"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "NUDT15 *3 is common in South and East Asian populations while TPMT reads normal — a TPMT-only panel misses the toxicity in exactly this patient population.",
  },
  {
    gene: "UGT1A1",
    label: "UGT1A1 — UDP-glucuronosyltransferase 1A1",
    group: "Oncology toxicity",
    drugs: ["Irinotecan", "Atazanavir", "Belinostat", "Sacituzumab govitecan"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "*28/*28 (and *6 in Asian populations) → reduce irinotecan starting dose per the FDA label.",
  },
  {
    gene: "CYP2D6",
    label: "CYP2D6 — cytochrome P450 2D6",
    group: "Oncology toxicity",
    drugs: ["Tamoxifen", "Codeine", "Tramadol"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: true,
    note: "A short-read panel cannot reliably call *5 (whole-gene deletion) or duplications — the commonest PGx false negative. Requires a CNV-capable assay.",
  },
  {
    gene: "CYP2C19",
    label: "CYP2C19 — cytochrome P450 2C19",
    group: "Infectious disease / antimicrobial",
    drugs: ["Clopidogrel", "Voriconazole"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Poor metabolizers have raised voriconazole exposure; ultrarapid metabolizers risk sub-therapeutic levels. Also governs clopidogrel activation.",
  },
  {
    gene: "CYP2C9",
    label: "CYP2C9 — cytochrome P450 2C9",
    group: "Cardiology / anticoagulation",
    drugs: ["Warfarin", "Phenytoin"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Interpreted together with VKORC1 for warfarin initiation dosing.",
  },
  {
    gene: "VKORC1",
    label: "VKORC1 — vitamin K epoxide reductase",
    group: "Cardiology / anticoagulation",
    drugs: ["Warfarin"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Promoter variant increases warfarin sensitivity.",
  },
  {
    gene: "SLCO1B1",
    label: "SLCO1B1 — solute carrier organic anion transporter 1B1",
    group: "Cardiology / anticoagulation",
    drugs: ["Simvastatin", "Atorvastatin"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Reduced function raises simvastatin exposure and myopathy risk.",
  },
  {
    gene: "CYP3A5",
    label: "CYP3A5 — cytochrome P450 3A5",
    group: "Transplant",
    drugs: ["Tacrolimus"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Expressers need a higher tacrolimus starting dose to reach target trough.",
  },
  {
    gene: "RYR1",
    label: "RYR1 — ryanodine receptor 1",
    group: "Anaesthesia",
    drugs: ["Volatile anaesthetics", "Succinylcholine"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Malignant hyperthermia susceptibility. Pathogenic variants are actionable — avoid triggering agents.",
  },
  {
    gene: "CACNA1S",
    label: "CACNA1S — calcium channel, voltage-dependent, L type",
    group: "Anaesthesia",
    drugs: ["Volatile anaesthetics", "Succinylcholine"],
    evidence: "A — actionable, widely accepted",
    requiresCnv: false,
    note: "Second malignant hyperthermia susceptibility gene, alongside RYR1.",
  },
  // G6PD is deliberately NOT in this catalogue. It does not fit the star-allele
  // model this table is built on (gene → diplotype → activity score → metabolizer
  // phenotype): it reports as normal / deficient with an enzyme-activity
  // percentage and named variants, which is why it has its own section — the same
  // reason HLA does. Listing it here as well gave the same finding two homes, and
  // only the gene-row one reached the dosing summary. See G6PD_STATUS_OPTIONS.
];

export const PGX_GENE_BY_VALUE = Object.fromEntries(PGX_GENES.map((g) => [g.gene, g]));

// ─── Tab 16 — HLA-mediated hypersensitivity ───────────────────────────────────
// HLA needs ALLELE-LEVEL resolution. Only HLA-B*57:01 carries abacavir risk, not
// B*57:03 — a low-resolution "B57 positive" is a FALSE POSITIVE, so the typing
// method is recorded beside every call.

export const HLA_PGX_ALLELES = [
  {
    allele: "HLA-B*57:01",
    drug: "Abacavir",
    reaction: "Abacavir hypersensitivity syndrome",
    evidence: "A — actionable, widely accepted",
    note: "CPIC Level A. Mandatory before initiating abacavir.",
  },
  {
    allele: "HLA-B*58:01",
    drug: "Allopurinol",
    reaction: "Stevens-Johnson syndrome / TEN",
    evidence: "A — actionable, widely accepted",
    note: "High allele frequency in Indian and other Asian populations.",
  },
  {
    allele: "HLA-B*15:02",
    drug: "Carbamazepine",
    reaction: "Stevens-Johnson syndrome / TEN",
    evidence: "A — actionable, widely accepted",
    note: "Test before starting carbamazepine in at-risk ancestry groups.",
  },
  {
    allele: "HLA-A*31:01",
    drug: "Carbamazepine",
    reaction: "DRESS / SJS",
    evidence: "A — actionable, widely accepted",
    note: "Broader ancestry applicability than B*15:02.",
  },
  {
    allele: "HLA-B*13:01",
    drug: "Dapsone",
    reaction: "Dapsone hypersensitivity syndrome",
    evidence: "A — actionable, widely accepted",
    note: "Relevant to leprosy and dermatology treatment programmes.",
  },
  {
    allele: "HLA-A*32:01",
    drug: "Vancomycin",
    reaction: "Vancomycin DRESS",
    evidence: "B — actionable, some evidence",
    note: "Vancomycin is an antimicrobial — this marker sits directly on the ID pathway.",
  },
  {
    allele: "HLA-B*15:11",
    drug: "Carbamazepine",
    reaction: "Stevens-Johnson syndrome / TEN",
    evidence: "B — actionable, some evidence",
    note: "Additional Asian-population risk allele.",
  },
];

export const HLA_TYPING_METHODS = [
  "Sequence-specific primers (SSP)",
  "Sequence-specific oligonucleotide probes (SSO)",
  "Sanger sequencing (SBT)",
  "NGS (allele-level)",
  "Real-time PCR (allele-specific)",
];

export const HLA_RESULT_OPTIONS = ["Positive", "Negative", "Indeterminate"];

// Resolution matters: a "B57 positive" at low resolution is not a B*57:01 call.
export const HLA_RESOLUTION_OPTIONS = [
  "Allele level (e.g. B*57:01)",
  "Group level (e.g. B57)",
  "Low resolution — not allele-specific",
];

// ─── Tab 16 — G6PD ────────────────────────────────────────────────────────────

export const G6PD_STATUS_OPTIONS = [
  "Normal",
  "Deficient",
  "Intermediate / partial deficiency",
  "Indeterminate",
];

// Statuses that make the affected drugs a live concern. A normal or indeterminate
// result raises nothing — emitting avoid-rows for a normal result would be noise,
// and indeterminate is not a finding.
export const G6PD_DEFICIENT_STATUSES = ["Deficient", "Intermediate / partial deficiency"];

// The drugs G6PD deficiency makes dangerous — the reason the marker is on the
// panel at all. Primaquine and tafenoquine are the antimalarials, dapsone the
// leprosy/dermatology drug, nitrofurantoin the urinary antibiotic, and
// rasburicase and methylene blue the two that cause haemolysis acutely.
export const G6PD_AFFECTED_DRUGS = [
  "Primaquine",
  "Tafenoquine",
  "Dapsone",
  "Nitrofurantoin",
  "Rasburicase",
  "Methylene blue",
];

// ─── Tab 16 — consent ─────────────────────────────────────────────────────────
// Light by design (decision D5): the institution has no genetic-counselling
// process, so this records that consent exists rather than driving a workflow.
// No secondary or incidental findings are reported — there is no counsellor to
// explain them.

export const GENOMIC_CONSENT_OPTIONS = ["Yes — recorded", "No", "Not recorded"];



