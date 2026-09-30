// shared/amrFlags.js — Tab 13 auto-detection engine (pure, deterministic)
//
// Certain microbiology results trigger mandatory actions independent of the
// clinical chain (infection control / public health / stewardship). Given the
// recorded sections, this engine lists the ALERT FLAGS that should fire. It is
// display-only: it returns candidate flags for the microbiologist to review and
// dispatch. It writes nothing — the tab persists only the dispatch actions.
//
// Detection sources (all keyed from the actual stored shapes):
//   • culture_workup[sp].isolates[].organism + ast.resistance_flags[] + ast.antibiotics[]
//   • molecular[sp].orders[].test_type / assay / result
//   • serology[sp].orders[].assay / result
//   • mycobacteriology[sp].isolates[].species + dst
//   • direct_examination[sp].exams[].exam_type + result
//   • pathogen_genomics[sp].wgs.resistance_genes[] / .mngs.amr_genes_detected[]
//     / .tngs.tb_classification  (via the genomics engine, not scanned here)
//
// Resistance-flag detection keys on the free-text organism name AND the
// curated resistance_flags vocabulary recorded in Tab 5C. Because both are
// free-ish, matching is case-insensitive substring with a small alias table.

import { detectGenomicsFlags, dedupeGenomicsFlags } from "./genomics";

const has = (v) => String(v || "").length > 0;
const inText = (hay, ...needles) =>
  needles.some((n) => String(hay || "").toLowerCase().includes(n.toLowerCase()));
const anyOf = (list, ...needles) =>
  (list || []).some((item) => inText(item, ...needles));

// Specimen → type lookup from case_register for display / blood-site flags.
function specimenTypeMap(caseRegister) {
  const map = {};
  (caseRegister?.specimens || []).forEach((sp) => { map[sp.specimen_id] = sp.specimen_type || ""; });
  return map;
}

function entriesOf(section) {
  return Object.entries((section && typeof section === "object") ? section : {});
}

// ─── AMR alert flags (from culture workup) ───────────────────────────────────

// Resistance mechanism → flag key. Substring rules against the isolate's
// recorded resistance_flags[] (Tab 5C vocabulary) and organism name.
function scanAmrCulture(cultureWorkup) {
  const out = [];
  entriesOf(cultureWorkup).forEach(([specimenId, block]) => {
    (block?.isolates || []).forEach((iso) => {
      if (!iso || (!iso.organism && !iso.ast?.resistance_flags?.length)) return;
      const org = iso.organism || "";
      const flags = iso.ast?.resistance_flags || [];
      const abx = iso.ast?.antibiotics || [];

      // MRSA
      if (anyOf(flags, "MRSA", "mecA") || (inText(org, "aureus", "staphylococcus") && anyOf(flags, "mecA", "MRSA", "PBP2a"))) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "MRSA", detail: "MRSA detected — contact precautions, notify ward nurse (SHEA/IDSA)" });
      }
      // ESBL (blood → infection control + stewardship)
      if (anyOf(flags, "ESBL", "extended-spectrum")) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "ESBL", detail: "ESBL-producing organism detected — infection control + stewardship alert" });
      }
      // CRE (carbapenem-resistant Enterobacterales)
      if (anyOf(flags, "Carbapenemase", "CarbaNP", "mCIM", "CRE") || inText(org, "enterobacterales") && abx.some((a) => inText(a.antibiotic, "meropenem", "imipenem", "ertapenem") && a.interpretation === "R")) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "CRE", detail: "Carbapenem-resistant Enterobacterales — enhanced contact precautions, report to infection-control committee" });
      }
      // VRE
      if (anyOf(flags, "VRE", "vanA", "vanB") || (inText(org, "enterococcus", "enterococci") && abx.some((a) => inText(a.antibiotic, "vancomycin") && a.interpretation === "R"))) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "VRE", detail: "Vancomycin-resistant Enterococcus — contact precautions, notify infection control" });
      }
      // C. difficile (toxin positive / toxigenic)
      if (inText(org, "clostridioides difficile", "c. difficile", "clostridium difficile")) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "C. difficile", detail: "C. difficile — enteric precautions, environmental decontamination" });
      }
      // Azole resistance — Aspergillus (TR34/L98H, environmental) vs Candida.
      // The flag vocabulary is shared, so pick the alert by the actual organism.
      const azole = anyOf(flags, "Azole", "TR34", "L98H")
        || (inText(org, "aspergillus", "candida") && abx.some((a) => inText(a.antibiotic, "voriconazole", "itraconazole", "posaconazole", "isavuconazole", "fluconazole") && a.interpretation === "R"));
      if (azole) {
        const isCandida = inText(org, "candida");
        out.push({
          specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org,
          flag: isCandida ? "Azole-resistant Candida" : "Azole-resistant Aspergillus",
          detail: isCandida
            ? "Azole-resistant Candida detected — alternative antifungal class (echinocandin / amphotericin B) warranted"
            : "Azole-resistant Aspergillus (TR34/L98H) — environmental azole resistance, voriconazole-sparing regimen",
        });
      }
      // Echinocandin-resistant Candida
      if (anyOf(flags, "Echinocandin") || (inText(org, "candida") && abx.some((a) => inText(a.antibiotic, "caspofungin", "micafungin", "anidulafungin") && a.interpretation === "R"))) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "Echinocandin-resistant Candida", detail: "Echinocandin-resistant Candida — confirm susceptibility in another class (azoles / amphotericin B) before therapy" });
      }
      // Metronidazole-resistant Bacteroides
      if (anyOf(flags, "Metronidazole") || (inText(org, "bacteroides", "anaerobe") && abx.some((a) => inText(a.antibiotic, "metronidazole") && a.interpretation === "R"))) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "Metronidazole-resistant Bacteroides", detail: "Metronidazole-resistant Bacteroides — empirical metronidazole ineffective, urgent clinician notification" });
      }
      // Clindamycin-resistant Bacteroides (common — important if clindamycin empiric)
      if ((anyOf(flags, "Clindamycin") && inText(org, "bacteroides", "anaerobe")) || (inText(org, "bacteroides") && abx.some((a) => inText(a.antibiotic, "clindamycin") && a.interpretation === "R"))) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "Clindamycin-resistant Bacteroides", detail: "Clindamycin-resistant Bacteroides — reassess empiric clindamycin (common resistance in the B. fragilis group)" });
      }
      // MDR Candida auris
      if (inText(org, "candida auris", "c. auris")) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "Candida auris", detail: "Multidrug-resistant C. auris — enhanced precautions, hospital committee escalation, IDSP notification (emerging pathogen)", notifiable: true });
      }
      // Mucormycete culture
      if (inText(org, "rhizopus", "mucor", "lichtheimia", "aseptate")) {
        out.push({ specimen_id: specimenId, isolate_id: iso.isolate_id, organism: org, flag: "Mucormycosis", detail: "Mucormycete isolated — national mucormycosis registry (ICMR MuCoRnet / IDSP), surgical emergency in immunocompromised", notifiable: true });
      }
    });
  });
  return out;
}

// ─── Notifiable disease flags (public health) ────────────────────────────────

// Direct exam (Tab 3): blood films → malaria; CSF → amoeba; stool O+P handled
// under culture above for C. difficile only.
function scanNotifiableDirect(directExamination) {
  const out = [];
  entriesOf(directExamination).forEach(([specimenId, block]) => {
    (block?.exams || []).forEach((exam) => {
      const res = exam.result || {};
      const type = String(exam.exam_type || "");
      const species = String(res.species || "");
      // Malaria: any Plasmodium on a film (P. falciparum always critical).
      if (type.includes("film") && /plasmodium|p\.?\s?(falciparum|vivax|malariae|ovale|knowlesi)/i.test(species)) {
        out.push({ specimen_id: specimenId, flag: "Malaria", detail: `Malaria (${species}) on blood film — IDSP/NVBDCP notifiable` + (/falciparum/i.test(species) ? "; P. falciparum is a critical value" : "") });
      }
      // Free-living amoeba in CSF
      if (/naegleria|acanthamoeba|balamuthia|free-living amoeba/i.test(species)) {
        out.push({ specimen_id: specimenId, flag: "Free-living amoeba", detail: `${species} in CSF — STAT notification, universally fatal if delayed` });
      }
      // Microfilaria / Trypanosoma on film
      if (res.microfilaria === "Yes") {
        out.push({ specimen_id: specimenId, flag: "Filariasis", detail: "Microfilaria seen — NVBDCP surveillance reporting" });
      }
      if (/trypanosoma/i.test(species)) {
        out.push({ specimen_id: specimenId, flag: "Trypanosoma", detail: `${species} detected — notify public health` });
      }
    });
  });
  return out;
}

// Molecular (Tab 8): GeneXpert MTB / parasite PCR detections.
function scanNotifiableMolecular(molecular) {
  const out = [];
  entriesOf(molecular).forEach(([specimenId, block]) => {
    (block?.orders || []).forEach((o) => {
      const assay = String(o.assay || "");
      const q = o.result?.qualitative;
      const markers = Array.isArray(o.result?.markers) ? o.result.markers : [];
      if (q === "Detected" || q === "Positive") {
        if (assay === "genexpert_mtb_rif") {
          const rifR = anyOf(markers, "rpoB") || anyOf(markers, "rifampicin resistant");
          out.push({
            specimen_id: specimenId,
            flag: "MTB (GeneXpert)",
            detail: "MTB detected (GeneXpert MTB/RIF) — RNTCP TB notification" + (rifR ? "; rifampicin resistance (rpoB) detected — MDR-TB workup" : ""),
          });
        }
        if (assay === "plasmodium_pcr") out.push({ specimen_id: specimenId, flag: "Malaria", detail: "Plasmodium spp. PCR detected — IDSP/NVBDCP notifiable" });
        if (assay === "leishmania_pcr") out.push({ specimen_id: specimenId, flag: "Visceral leishmaniasis", detail: "Leishmania PCR detected — kala-azar notification (NVBDCP)" });
        if (assay === "filaria_pcr") out.push({ specimen_id: specimenId, flag: "Filariasis", detail: "Filaria PCR detected — NVBDCP surveillance reporting" });
      }
    });
  });
  return out;
}

// Serology (Tab 9): reactive markers that are notifiable / of public-health note.
function scanNotifiableSerology(serology) {
  const out = [];
  entriesOf(serology).forEach(([specimenId, block]) => {
    (block?.orders || []).forEach((o) => {
      const assay = String(o.assay || "");
      const q = o.result?.qualitative;
      const reactive = q === "Reactive" || q === "Positive" || q === "Detected";
      if (!reactive) return;
      if (assay === "hiv_agab_4g") out.push({ specimen_id: specimenId, flag: "HIV reactive", detail: "HIV Ag/Ab reactive — counselling referral (recorded; not a public-health name-notified flag on its own)" });
      if (assay === "hbsag") out.push({ specimen_id: specimenId, flag: "HBsAg reactive", detail: "HBsAg reactive — full HBV panel + source investigation prompted" });
      if (assay === "anti_hcv") out.push({ specimen_id: specimenId, flag: "Anti-HCV reactive", detail: "Anti-HCV reactive — HCV RNA PCR (Tab 8) to distinguish active vs resolved" });
      if (assay === "malaria_rdt") out.push({ specimen_id: specimenId, flag: "Malaria RDT positive", detail: "Malaria RDT positive — blood film required for species confirmation and parasitaemia (Tab 3)" });
      if (assay === "hbv_anti_hbc_igm") out.push({ specimen_id: specimenId, flag: "Acute HBV (anti-HBc IgM)", detail: "Anti-HBc IgM reactive — acute HBV infection; IDSP notifiable; HBV DNA PCR (Tab 8) for management" });
      if (assay === "hev_igm") out.push({ specimen_id: specimenId, flag: "HEV IgM reactive", detail: "HEV IgM reactive — IDSP notifiable in outbreak context; clinical correlation advised" });
    });
  });
  return out;
}

// Mycobacteriology (Tab 10): MTBC isolate → notifiable; DST MDR/XDR derived.
function scanNotifiableMyco(mycobacteriology) {
  const out = [];
  entriesOf(mycobacteriology).forEach(([specimenId, block]) => {
    (block?.isolates || []).forEach((iso) => {
      const species = String(iso.species || "");
      if (inText(species, "tuberculosis complex", "MTBC")) {
        out.push({ specimen_id: specimenId, flag: "MTBC (culture)", detail: "MTBC isolated — RNTCP TB notification; TB case registration number" });
      }
    });
  });
  return out;
}

// Culture isolates (Tab 5): bacteraemia pathogens that are notifiable.
function scanNotifiableCulture(cultureWorkup) {
  const out = [];
  entriesOf(cultureWorkup).forEach(([specimenId, block]) => {
    (block?.isolates || []).forEach((iso) => {
      const org = String(iso.organism || "");
      if (inText(org, "salmonella typhi") || inText(org, "salmonella paratyphi")) out.push({ specimen_id: specimenId, flag: "Typhoid", detail: `${org} bacteraemia — IDSP notification` });
      if (inText(org, "vibrio cholerae")) out.push({ specimen_id: specimenId, flag: "Vibrio cholerae", detail: "V. cholerae — immediate public-health authority notification" });
      if (inText(org, "brucella")) out.push({ specimen_id: specimenId, flag: "Brucella", detail: "Brucella spp. — notification" });
      if (inText(org, "clostridioides difficile", "c. difficile")) out.push({ specimen_id: specimenId, flag: "C. difficile (toxin)", detail: "C. difficile isolated — enteric precautions; confirm toxin" });
    });
  });
  return out;
}

// ─── Top-level detector ───────────────────────────────────────────────────────
// Returns { amr: [...], notifiable: [...] }, each entry a candidate flag:
//   { specimen_id, flag, detail, [organism], [isolate_id], notifiable? }
// The tab renders these read-only and persists only dispatch actions.
//
// `pathogenGenomics` is the Tab 15 section. Its flags come from whole-genome and
// metagenomic sequencing rather than phenotypic AST, and are normalised here into
// the same shape so the existing acknowledgement/dispatch UI handles them with no
// change. Human genomics produces no infection-control flags and is not scanned.
export function detectFlags({
  caseRegister,
  cultureWorkup,
  molecular,
  serology,
  mycobacteriology,
  directExamination,
  pathogenGenomics,
}) {
  const typeMap = specimenTypeMap(caseRegister);
  const decorate = (f) => ({ ...f, specimen_type: typeMap[f.specimen_id] || "" });

  const amrCulture = scanAmrCulture(cultureWorkup).map(decorate);
  const notif = [
    ...scanNotifiableDirect(directExamination),
    ...scanNotifiableMolecular(molecular),
    ...scanNotifiableSerology(serology),
    ...scanNotifiableMyco(mycobacteriology),
    ...scanNotifiableCulture(cultureWorkup),
  ].map(decorate);

  // Genomics flags carry {type, label, source} — map to {flag, detail} so the tab
  // renders them like any other flag. The source is kept in the detail so a
  // sequencing-derived flag stays distinguishable from a phenotypic one.
  const genomic = dedupeGenomicsFlags(detectGenomicsFlags(pathogenGenomics)).map((f) =>
    decorate({
      specimen_id: f.specimen_id,
      flag: f.label,
      detail: `${f.detail} · source: ${f.source}`,
      notifiable: !!f.notifiable,
    })
  );

  // C. auris and mucormycete appear in the AMR scan as notifiable; hoist them
  // to the notifiable list as well (dual entry per the plan).
  const dual = amrCulture.filter((f) => f.notifiable).map(({ notifiable, ...rest }) => rest);
  return {
    amr: [...amrCulture.filter((f) => !f.notifiable), ...genomic.filter((f) => !f.notifiable)],
    notifiable: [...notif, ...dual, ...genomic.filter((f) => f.notifiable)],
  };
}

export default { detectFlags };
