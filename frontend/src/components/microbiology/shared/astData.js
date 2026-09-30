// shared/astData.js — Curated AST catalogue for Tab 5C (pure data, no engine)
//
// Grows with the lab's antibiogram. This file is DATA ONLY — the cascade logic
// that consumes it lives in shared/cascade.js. Canonical antibiotic names are the
// storage keys: an AST row keeps `antibiotic` as the human label the preliminary
// and final reports print verbatim, and the engine matches on that label with a
// tolerant alias map below (so a free-typed "AMP" still cascades as Ampicillin).
//
// AST_PROFILES — organism groups, each classifying a family and optionally
// narrowing to a species variant. `panel` is the family default; a `species`
// key that appears in the lower-cased organism name REPLACES the listed panel
// fields (an override that only sets `intrinsic` leaves `agents` inherited).
// Species keys are short distinctive tokens ("coli", "faecium", "krusei") — the
// group regex has already pinned the family, so tokens need only be unique within
// it and they also survive abbreviations ("E. coli", "E. faecium"). Earlier keys
// win, so put fuller overrides ("salmonella typhi") before the family-wide ones.
//
//   agents         ordered first-line → broadest; cascade index 0 = first line
//   intrinsic      agents the whole group/species is intrinsically resistant to
//                  (auto-suppressed; never reported as tested-S)
//   urine_only     agents appropriate ONLY for urine (offered when specimen is
//                  urine; suppressed on any other specimen)
//   qc_organisms   suggested QC strains for the group (quick-fill in 5C)
//
// Reference: CLSI M100 Ed34 (bacterial breakpoints/QC/cascade/intrinsic tables),
// CLSI M27/M38 (antifungal), CLSI M11 (anaerobic). Panels are starter-and-growing
// per the institution's antibiogram; unclassified organisms get no panel (nothing
// cascades).

// Canonical antibiotic name → tolerantly-matched free-text spellings (lower-case key).
export const ANTIBIOTIC_ALIASES = {
  // β-lactams
  ampicillin: "Ampicillin", amp: "Ampicillin", am: "Ampicillin",
  "ampicillin/sulbactam": "Ampicillin-Sulbactam", "ampicillin-sulbactam": "Ampicillin-Sulbactam", unasyn: "Ampicillin-Sulbactam", ams: "Ampicillin-Sulbactam",
  "amoxicillin-clavulanate": "Amoxicillin-Clavulanate", "amoxicillin/clavulanate": "Amoxicillin-Clavulanate", "amox-clav": "Amoxicillin-Clavulanate", augmentin: "Amoxicillin-Clavulanate", amc: "Amoxicillin-Clavulanate",
  cefazolin: "Cefazolin", cfz: "Cefazolin",
  cefoxitin: "Cefoxitin", fox: "Cefoxitin",
  cefotaxime: "Cefotaxime", ctx: "Cefotaxime",
  ceftazidime: "Ceftazidime", caz: "Ceftazidime",
  ceftriaxone: "Ceftriaxone", cro: "Ceftriaxone", ctr: "Ceftriaxone",
  cefepime: "Cefepime", fep: "Cefepime",
  cefixime: "Cefixime",
  "piperacillin-tazobactam": "Piperacillin-Tazobactam", "piperacillin/tazobactam": "Piperacillin-Tazobactam", "pip-tazo": "Piperacillin-Tazobactam", tazocin: "Piperacillin-Tazobactam", ptz: "Piperacillin-Tazobactam",
  meropenem: "Meropenem", mem: "Meropenem", mero: "Meropenem",
  imipenem: "Imipenem", ipm: "Imipenem", "imipenem-cilastatin": "Imipenem",
  penicillin: "Penicillin", "pen g": "Penicillin", benzylpenicillin: "Penicillin",
  // Aminoglycosides & others
  amikacin: "Amikacin", amk: "Amikacin", ak: "Amikacin",
  gentamicin: "Gentamicin", gen: "Gentamicin", gm: "Gentamicin",
  chloramphenicol: "Chloramphenicol",
  // Fluoroquinolones / macrolides / tetracyclines
  ciprofloxacin: "Ciprofloxacin", cip: "Ciprofloxacin",
  levofloxacin: "Levofloxacin", lvx: "Levofloxacin", levo: "Levofloxacin",
  azithromycin: "Azithromycin", azm: "Azithromycin", azithro: "Azithromycin",
  erythromycin: "Erythromycin", ery: "Erythromycin",
  doxycycline: "Doxycycline", dox: "Doxycycline",
  tigecycline: "Tigecycline",
  // Folate-pathway inhibitors
  "trimethoprim-sulfamethoxazole": "Trimethoprim-Sulfamethoxazole", cotrimoxazole: "Trimethoprim-Sulfamethoxazole", "co-trimoxazole": "Trimethoprim-Sulfamethoxazole", "tmp-smx": "Trimethoprim-Sulfamethoxazole", "tmp-smz": "Trimethoprim-Sulfamethoxazole", bactrim: "Trimethoprim-Sulfamethoxazole", septrin: "Trimethoprim-Sulfamethoxazole",
  nitrofurantoin: "Nitrofurantoin",
  fosfomycin: "Fosfomycin",
  // Anti-Gram-positive
  clindamycin: "Clindamycin", clinda: "Clindamycin", cc: "Clindamycin",
  vancomycin: "Vancomycin", vanco: "Vancomycin", van: "Vancomycin",
  linezolid: "Linezolid", lzd: "Linezolid",
  teicoplanin: "Teicoplanin",
  daptomycin: "Daptomycin",
  rifampicin: "Rifampicin", rif: "Rifampicin", "rifampin": "Rifampicin",
  // Antifungals
  fluconazole: "Fluconazole", flc: "Fluconazole", flu: "Fluconazole",
  voriconazole: "Voriconazole", vrc: "Voriconazole", vori: "Voriconazole",
  itraconazole: "Itraconazole", itc: "Itraconazole", itra: "Itraconazole",
  posaconazole: "Posaconazole", posa: "Posaconazole",
  isavuconazole: "Isavuconazole", isavu: "Isavuconazole",
  "amphotericin b": "Amphotericin B", "ampho b": "Amphotericin B", amb: "Amphotericin B", "amphotericin-b": "Amphotericin B",
  flucytosine: "Flucytosine", "5-fc": "Flucytosine", "5fc": "Flucytosine",
  caspofungin: "Caspofungin", casp: "Caspofungin",
  micafungin: "Micafungin", mica: "Micafungin",
  anidulafungin: "Anidulafungin", ani: "Anidulafungin",
  // Polymyxins
  colistin: "Colistin", "polymyxin e": "Colistin", cst: "Colistin",
  // Anaerobe-focused
  metronidazole: "Metronidazole", mtz: "Metronidazole", metro: "Metronidazole",
};

// Lookup: a lower-cased string → canonical antibiotic label (or "" if unknown).
export function canonicalAntibiotic(name) {
  const key = String(name || "").trim().toLowerCase();
  if (!key) return "";
  return ANTIBIOTIC_ALIASES[key] || "";
}

// Full canonical antibiotic menu (unique labels), for 5C antibiotic autocomplete.
export const ALL_ANTIBIOTICS = [...new Set(Object.values(ANTIBIOTIC_ALIASES))].sort();

// Curated organism pick-list for the 5B organism autocomplete (free text still
// allowed). Entries are chosen to resolve to an AST_PROFILE so typing/picking
// them yields a panel; an unrecognised free-typed name is warned about in the tab.
export const COMMON_ORGANISMS = [
  // Enterobacterales
  "Escherichia coli",
  "E. coli",
  "Klebsiella pneumoniae",
  "Klebsiella oxytoca",
  "Enterobacter cloacae",
  "Enterobacter aerogenes",
  "Citrobacter freundii",
  "Serratia marcescens",
  "Morganella morganii",
  "Proteus mirabilis",
  "Proteus vulgaris",
  "Providencia stuartii",
  "Hafnia alvei",
  "Salmonella typhi",
  "Salmonella enteritidis",
  "Shigella sonnei",
  // Non-fermenters / Gram-negative
  "Pseudomonas aeruginosa",
  "Acinetobacter baumannii",
  "Haemophilus influenzae",
  "Neisseria meningitidis",
  "Neisseria gonorrhoeae",
  // Gram-positive
  "Staphylococcus aureus",
  "Staphylococcus epidermidis",
  "Staphylococcus lugdunensis",
  "Staphylococcus saprophyticus",
  "Enterococcus faecalis",
  "Enterococcus faecium",
  "Streptococcus pneumoniae",
  "Streptococcus pyogenes",
  "Streptococcus agalactiae",
  "Streptococcus mutans",
  "Viridans group Streptococcus",
  "Listeria monocytogenes",
  // Anaerobes
  "Bacteroides fragilis",
  "Parabacteroides distasonis",
  "Prevotella intermedia",
  "Fusobacterium nucleatum",
  "Clostridium perfringens",
  "Clostridium septicum",
  "Peptostreptococcus anaerobius",
  "Finegoldia magna",
  // Fungi
  "Candida albicans",
  "Candida glabrata",
  "Candida krusei",
  "Candida parapsilosis",
  "Candida tropicalis",
  "Candida auris",
  "Cryptococcus neoformans",
  "Aspergillus fumigatus",
  "Aspergillus flavus",
  "Aspergillus niger",
];

export const AST_PROFILES = [
  // ─── Enterobacterales ────────────────────────────────────────────────────────
  // Family default (intrinsic AmpC → ampicillin auto-suppressed) applies to the
  // ampicillin-intrinsically-resistant members: Klebsiella / Enterobacter /
  // Serratia / Citrobacter / Morganella / Providencia / Hafnia. Ampicillin-
  // susceptible species (E. coli, Proteus mirabilis, Salmonella, Shigella) and
  // S. typhi's distinct panel override below — the engine merges the first
  // matching species override onto the family panel.
  {
    key: "entero",
    label: "Enterobacterales",
    match: /(enterobacterales|enterobacteriaceae|enterobacter|e\.?\s*coli|escherichia|klebsiella|proteus|citrobacter|serratia|salmonella|shigella|morganella|hafnia|providencia)/i,
    panel: {
      agents: ["Ampicillin", "Cefazolin", "Ceftriaxone", "Cefepime", "Piperacillin-Tazobactam", "Meropenem", "Amikacin", "Ciprofloxacin", "Trimethoprim-Sulfamethoxazole"],
      intrinsic: ["Ampicillin"],
      urine_only: ["Nitrofurantoin", "Fosfomycin"],
      qc_organisms: ["E. coli ATCC 25922", "P. aeruginosa ATCC 27853"],
    },
    species: {
      "coli": { intrinsic: [] }, // E. coli ampicillin-susceptible (interpretive, not intrinsic)
      "mirabilis": { intrinsic: [] }, // Proteus mirabilis ampicillin-susceptible
      "salmonella typhi": { agents: ["Ceftriaxone", "Azithromycin", "Ciprofloxacin", "Meropenem", "Chloramphenicol", "Trimethoprim-Sulfamethoxazole"], intrinsic: [], qc_organisms: ["E. coli ATCC 25922", "S. aureus ATCC 29213"] },
      "salmonella": { intrinsic: [] }, // non-typhoidal Salmonella ampicillin-susceptible
      "shigella": { intrinsic: [] }, // Shigella ampicillin-susceptible (interpretive)
    },
  },

  // ─── Pseudomonas ─────────────────────────────────────────────────────────────
  {
    key: "pseudomonas",
    label: "Pseudomonas",
    match: /pseudomonas/i,
    panel: {
      agents: ["Ceftazidime", "Cefepime", "Piperacillin-Tazobactam", "Meropenem", "Amikacin", "Ciprofloxacin", "Colistin"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["P. aeruginosa ATCC 27853"],
    },
  },

  // ─── Acinetobacter ───────────────────────────────────────────────────────────
  {
    key: "acinetobacter",
    label: "Acinetobacter",
    match: /acinetobacter/i,
    panel: {
      agents: ["Ampicillin-Sulbactam", "Ceftazidime", "Meropenem", "Amikacin", "Ciprofloxacin", "Colistin"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["E. coli ATCC 25922", "P. aeruginosa ATCC 27853"],
    },
  },

  // ─── Staphylococcus ──────────────────────────────────────────────────────────
  {
    key: "staphylococcus",
    label: "Staphylococcus",
    match: /staphylococcus|staph/i,
    panel: {
      agents: ["Penicillin", "Cefoxitin", "Cefazolin", "Clindamycin", "Trimethoprim-Sulfamethoxazole", "Vancomycin", "Linezolid"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["S. aureus ATCC 29213"],
    },
    species: {
      "lugdunensis": { agents: ["Penicillin", "Cefazolin", "Clindamycin", "Trimethoprim-Sulfamethoxazole", "Vancomycin", "Linezolid"] }, // cefoxitin NOT surrogate for oxacillin in S. lugdunensis
    },
  },

  // ─── Enterococcus ────────────────────────────────────────────────────────────
  // Nitrofurantoin is urine-only and so sits OUTSIDE the common agents. E. faecium
  // gets the broader reserved panel (daptomycin/tigecycline).
  {
    key: "enterococcus",
    label: "Enterococcus",
    match: /enterococcus|enterococci/i,
    panel: {
      agents: ["Ampicillin", "Vancomycin", "Linezolid", "Teicoplanin"],
      intrinsic: [],
      urine_only: ["Nitrofurantoin"],
      qc_organisms: ["E. faecalis ATCC 29212"],
    },
    species: {
      "faecalis": { agents: ["Ampicillin", "Vancomycin", "Linezolid", "Teicoplanin"] },
      "faecium": { agents: ["Ampicillin", "Vancomycin", "Linezolid", "Teicoplanin", "Daptomycin", "Tigecycline"] },
    },
  },

  // ─── Streptococcus (family) ─────────────────────────────────────────────────
  // Family default is the beta-haemolytic-style core. Species overrides split
  // pneumococcus (broader) and viridans from the pyogenes/agalactiae groups.
  {
    key: "streptococcus",
    label: "Streptococcus",
    match: /streptococcus|strep/i,
    panel: {
      agents: ["Penicillin", "Ceftriaxone", "Vancomycin", "Clindamycin"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["S. pneumoniae ATCC 49619", "S. pyogenes ATCC 19615"],
    },
    species: {
      "pneumoniae": { agents: ["Penicillin", "Ceftriaxone", "Levofloxacin", "Vancomycin", "Clindamycin", "Linezolid"], qc_organisms: ["S. pneumoniae ATCC 49619"] },
      "pyogenes": { agents: ["Penicillin", "Clindamycin", "Erythromycin", "Vancomycin", "Linezolid"], qc_organisms: ["S. pyogenes ATCC 19615"] },
      "agalactiae": { agents: ["Penicillin", "Clindamycin", "Erythromycin", "Vancomycin", "Linezolid"], qc_organisms: ["S. agalactiae ATCC 12386"] },
      "mutans": { agents: ["Penicillin", "Ceftriaxone", "Vancomycin"], qc_organisms: ["S. pneumoniae ATCC 49619"] }, // viridans (S. mutans family)
      "viridans": { agents: ["Penicillin", "Ceftriaxone", "Vancomycin"], qc_organisms: ["S. pneumoniae ATCC 49619"] },
    },
  },

  // ─── Haemophilus ─────────────────────────────────────────────────────────────
  {
    key: "haemophilus",
    label: "Haemophilus",
    match: /haemophilus|hemophilus/i,
    panel: {
      agents: ["Ampicillin", "Amoxicillin-Clavulanate", "Ceftriaxone", "Cefotaxime", "Trimethoprim-Sulfamethoxazole", "Azithromycin", "Meropenem"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["H. influenzae ATCC 49247"],
    },
  },

  // ─── Neisseria ───────────────────────────────────────────────────────────────
  // Meningitidis and gonorrhoeae panels differ enough to split at species level.
  {
    key: "neisseria",
    label: "Neisseria",
    match: /neisseria/i,
    panel: {
      agents: ["Ceftriaxone", "Ciprofloxacin"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["N. gonorrhoeae ATCC 49226"],
    },
    species: {
      "meningitidis": { agents: ["Penicillin", "Ceftriaxone", "Ciprofloxacin", "Rifampicin"], qc_organisms: ["N. meningitidis ATCC 13077"] },
      "gonorrhoeae": { agents: ["Ceftriaxone", "Cefixime", "Azithromycin", "Doxycycline", "Ciprofloxacin"], qc_organisms: ["N. gonorrhoeae ATCC 49226"] },
    },
  },

  // ─── Listeria ────────────────────────────────────────────────────────────────
  {
    key: "listeria",
    label: "Listeria",
    match: /listeria/i,
    panel: {
      agents: ["Ampicillin", "Trimethoprim-Sulfamethoxazole", "Meropenem"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["E. coli ATCC 25922", "S. aureus ATCC 29213"],
    },
  },

  // ─── Anaerobes — Bacteroides fragilis group (CLSI M11) ──────────────────────
  // High and variable resistance rates → AST indicated (esp. blood/CSF/sterile
  // site). Metronidazole resistance is rare but critical; clindamycin resistance
  // is common in the group (both auto-fire Tab 13 AMR flags).
  {
    key: "bacteroides",
    label: "Bacteroides fragilis group",
    match: /bacteroides|parabacteroides/i,
    panel: {
      agents: ["Metronidazole", "Amoxicillin-Clavulanate", "Clindamycin", "Piperacillin-Tazobactam", "Imipenem", "Meropenem", "Chloramphenicol"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["B. fragilis ATCC 25285", "B. thetaiotaomicron ATCC 29741"],
    },
  },

  // ─── Anaerobes — other Gram-negative rods (CLSI M11) ────────────────────────
  {
    key: "anaerobe_gnr",
    label: "Gram-negative anaerobe",
    match: /prevotella|fusobacterium|porphyromonas|veillonella/i,
    panel: {
      agents: ["Metronidazole", "Amoxicillin-Clavulanate", "Clindamycin", "Piperacillin-Tazobactam", "Meropenem", "Chloramphenicol"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["B. fragilis ATCC 25285"],
    },
  },

  // ─── Anaerobes — Clostridium (CLSI M11) ─────────────────────────────────────
  // Routine AST is limited; indicated for sterile-site isolates / suspected
  // resistance. C. difficile is excluded — toxin/PCR drives it, not culture AST.
  {
    key: "clostridium",
    label: "Clostridium",
    match: /clostridium/i,
    panel: {
      agents: ["Penicillin", "Clindamycin", "Metronidazole", "Meropenem", "Chloramphenicol"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["B. fragilis ATCC 25285", "C. perfringens ATCC 13124"],
    },
  },

  // ─── Anaerobes — Gram-positive cocci (CLSI M11) ─────────────────────────────
  {
    key: "anaerobe_gpc",
    label: "Gram-positive anaerobic coccus",
    match: /peptostreptococcus|anaerobic cocci|peptoniphilus|finegoldia/i,
    panel: {
      agents: ["Penicillin", "Clindamycin", "Metronidazole", "Vancomycin", "Linezolid"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["S. aureus ATCC 29213", "B. fragilis ATCC 25285"],
    },
  },

  // ─── Yeasts — Candida (CLSI M27) ─────────────────────────────────────────────
  // Fluconazole is intrinsically inactive against C. krusei and effectively so
  // against C. auris (multidrug-resistance → Tab 13 notifiable). Echinocandins
  // are first-line for invasive candidiasis.
  {
    key: "candida",
    label: "Candida (yeast)",
    match: /candida/i,
    panel: {
      agents: ["Fluconazole", "Voriconazole", "Amphotericin B", "Flucytosine", "Caspofungin", "Micafungin", "Anidulafungin"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["C. parapsilosis ATCC 22019", "C. krusei ATCC 6258"],
    },
    species: {
      "krusei": { intrinsic: ["Fluconazole"] },
      "auris": { intrinsic: ["Fluconazole"], qc_organisms: ["C. auris CBS 10913"] },
      "glabrata": { qc_organisms: ["C. glabrata ATCC 2001"] },
    },
  },

  // ─── Yeasts — Cryptococcus (CLSI M27) ───────────────────────────────────────
  {
    key: "cryptococcus",
    label: "Cryptococcus",
    match: /cryptococcus/i,
    panel: {
      agents: ["Fluconazole", "Amphotericin B", "Flucytosine"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["C. neoformans ATCC 208821"],
    },
  },

  // ─── Moulds — Aspergillus (CLSI M38) ────────────────────────────────────────
  // No echinocandin MIC breakpoints for most moulds, so none are listed. Species
  // key adds the triazole-screening QC strain for the invasive panel.
  {
    key: "aspergillus",
    label: "Aspergillus (mould)",
    match: /aspergillus/i,
    panel: {
      agents: ["Voriconazole", "Isavuconazole", "Itraconazole", "Posaconazole", "Amphotericin B"],
      intrinsic: [],
      urine_only: [],
      qc_organisms: ["A. flavus ATCC 204304", "C. parapsilosis ATCC 22019"],
    },
    species: {
      "fumigatus": { qc_organisms: ["A. flavus ATCC 204304", "A. fumigatus ATCC MYA-3626"] },
    },
  },
];
