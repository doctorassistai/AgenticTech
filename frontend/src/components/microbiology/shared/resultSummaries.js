// shared/resultSummaries.js — human-readable one-liners for a recorded result.
//
// These are the SAME strings each track puts on its preliminary report, hoisted
// out of the tab components so the final-report PDF and the preliminaries can
// never disagree about how a result reads. Each returns a plain string; an
// empty string means "nothing recorded worth printing", and callers skip it.
//
// Pure functions — no React, no state. Siblings of cascade.js / amrFlags.js.

import {
  DIRECT_EXAM_TYPES_BY_VALUE,
  MOLECULAR_ASSAY_BY_VALUE,
  SEROLOGY_ASSAY_BY_VALUE,
  mycoFirstLineResistance,
  mycoClassification,
  genotypingPanelLabel,
} from "../constants";

const displayValue = (v) => (Array.isArray(v) ? v.join(", ") : String(v ?? ""));
const asArray = (v) => (Array.isArray(v) ? v : []);

// ─── Tab 3 — Direct Examination ──────────────────────────────────────────────
// Rendered through the exam type's own field config, so a newly added field
// shows up here without touching this file.
export const summarizeExam = (examType, result) => {
  const cfg = DIRECT_EXAM_TYPES_BY_VALUE[examType];
  if (!cfg) return "";
  const out = [];
  (cfg.fields || []).forEach((f) => {
    const v = result?.[f.key];
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0)) return;
    out.push(`${f.label}: ${displayValue(v)}`);
  });
  return out.join(" · ");
};

// ─── Tab 8 — Molecular / NAAT ────────────────────────────────────────────────
export const summarizeNaatOrder = (o) => {
  const assay = MOLECULAR_ASSAY_BY_VALUE[o.assay];
  const bits = [];
  if (assay) bits.push(assay.label);
  else if (o.assay) bits.push(o.assay);
  if (o.result?.qualitative) bits.push(o.result.qualitative);
  if (o.result?.copies_ml) bits.push(`${o.result.copies_ml} copies/mL`);
  if (o.result?.ct) bits.push(`Ct ${o.result.ct}`);
  if (Array.isArray(o.result?.markers) && o.result.markers.length) {
    bits.push(o.result.markers.join(", "));
  }
  return bits.join(" — ");
};

// ─── Tab 9 — Serology & Antigen ──────────────────────────────────────────────
export const summarizeSerologyOrder = (o) => {
  const assay = SEROLOGY_ASSAY_BY_VALUE[o.assay];
  const bits = [];
  if (assay) bits.push(assay.label);
  else if (o.assay) bits.push(o.assay);
  if (o.result?.qualitative) bits.push(o.result.qualitative);
  if (o.result?.quantitative) bits.push(assay?.unit ? `${o.result.quantitative} ${assay.unit}` : o.result.quantitative);
  if (o.result?.interpretation) bits.push(o.result.interpretation);
  return bits.join(" — ");
};

// ─── Tab 10 — Mycobacteriology / AFB ─────────────────────────────────────────
export const summarizeMycoIsolate = (iso) => {
  const bits = [iso.species || "Mycobacterium sp."];
  if (iso.id_method) bits.push(iso.id_method);
  const fl = mycoFirstLineResistance(iso.dst?.first_line);
  if (fl.resistant.length) bits.push(`1st-line R: ${fl.resistant.join(", ")}`);
  // The same classification Tab 15 derives. DS-TB is omitted: "tested and fully
  // susceptible" adds nothing beside the absent resistance list above it. An
  // empty string means no DST recorded — never reported as susceptible.
  const cls = mycoClassification(iso.dst?.first_line, iso.dst?.second_line);
  if (cls && cls !== "DS-TB") bits.push(cls);
  return bits.join(" — ");
};

// ─── Tab 15 — Pathogen Genomics ──────────────────────────────────────────────
// `rec` is the SUB-RECORD being reported. For the targeted sub-tab that is one
// order out of the section's orders[] array, not the section itself.
//
// Genomic resistance is always described as predicted — the string never implies
// a measured phenotype, because the reader has to know which one they are holding.
export const summarizeGenomics = (subTab, rec) => {
  if (!rec) return "";

  if (subTab === "wgs") {
    const species = rec.identified_species || "organism";
    const st = rec.sequence_type ? ` · ${rec.sequence_type}` : "";
    const genes = asArray(rec.resistance_genes).map((g) => g.gene_name).filter(Boolean);
    return `WGS — ${species}${st}${genes.length ? ` · ${genes.join(", ")}` : ""}`;
  }

  if (subTab === "mngs") {
    const top = asArray(rec.organism_hits).slice(0, 3).map((h) => h.taxon_name).filter(Boolean);
    return `mNGS — ${top.length ? top.join(", ") : "no significant organism hits"}`;
  }

  if (subTab === "tngs") {
    const res = asArray(rec.drug_resistance_calls)
      .filter((c) => c.predicted_phenotype === "Resistant")
      .map((c) => c.drug)
      .filter(Boolean);
    return `tNGS-TB — ${rec.tb_classification || "classification pending"}${res.length ? ` (R: ${res.join(", ")})` : ""}`;
  }

  if (subTab === "targeted") {
    const label = genotypingPanelLabel(rec.panel);

    if (rec.panel_kind === "identity") {
      const top = asArray(rec.taxa_rows).slice(0, 2).map((r) => r.taxon_name).filter(Boolean);
      return `${label || "Amplicon ID"} — ${top.length ? top.join(", ") : "no identification"}`;
    }

    if (rec.panel_kind === "typing") {
      const t = rec.typing || {};
      if (!t.scheme && !t.type_result) return "";
      return `${label || "Typing"} — ${t.scheme}${t.type_result ? `: ${t.type_result}` : ""}${
        t.cluster_id ? ` (cluster ${t.cluster_id})` : ""
      }`;
    }

    const res = asArray(rec.mutation_rows)
      .filter((r) => r.predicted_phenotype === "Resistant")
      .map((r) => r.drug || r.mutation)
      .filter(Boolean);
    return `${label || "Genotyping"} — ${res.length ? `R: ${res.join(", ")}` : "no resistance markers"}`;
  }

  return "";
};

// ─── Tab 16 — Human Genomics (PGx) ───────────────────────────────────────────
// One gene result as a single line: what the genotype is, and what to do about
// it. The dose implication is the part a prescriber acts on, so it always
// appears when it has been recorded.
export const summarizePgxGene = (r) => {
  if (!r || !r.gene) return "";
  const genotype = r.diplotype || [r.allele_1, r.allele_2].filter(Boolean).join("/");
  const bits = [r.gene];
  if (genotype) bits.push(genotype);
  if (r.phenotype) bits.push(r.phenotype);
  if (r.dose_implication) bits.push(r.dose_implication);
  return bits.join(" — ");
};

export default {
  summarizeExam,
  summarizeNaatOrder,
  summarizeSerologyOrder,
  summarizeMycoIsolate,
  summarizeGenomics,
  summarizePgxGene,
};
