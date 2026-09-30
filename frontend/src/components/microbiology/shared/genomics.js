// shared/genomics.js — deterministic genomics derivations
//
// Pure functions. No React, no state, no LLM — the same posture as
// shared/cascade.js and shared/amrFlags.js. Everything here is recomputable from
// the stored record, so a readout can never drift from the data it describes.
//
// WHY THERE IS NO PHENOTYPE → DOSE SUGGESTION
// It is tempting to derive "Poor metabolizer → avoid" automatically. That would
// be unsafe: the correct action is drug-specific, not phenotype-specific. An
// ultrarapid CYP2D6 metabolizer must AVOID codeine (it is a prodrug — rapid
// conversion means opioid toxicity) while for tamoxifen the same phenotype
// changes efficacy in the other direction. Deriving from phenotype alone would
// produce confidently wrong advice.
//
// So this module does not invent dosing. It AGGREGATES what the microbiologist
// recorded on each gene row, groups it by drug, and flags the gaps and internal
// contradictions that are objectively detectable. The one thing it reads from the
// curated table is the published REASON behind an action already recorded (see
// rowReason) — never the action itself.

import {
  MOLECULAR_ASSAY_BY_VALUE,
  G6PD_DEFICIENT_STATUSES,
  G6PD_AFFECTED_DRUGS,
} from "../constants";
// The module's single definition of when a case happened — the same one
// Registration's history table and PriorMicrobiologyDialog date a case by, so the
// register cannot date a finding differently from the table that lists the case.
import { microCaseDate } from "./caseHistory";
import { pgxGuidance } from "./pgxGuidance";

// Actions that amount to "do not give this drug as planned".
const AVOID_ACTIONS = ["Avoid — use alternative agent", "Avoid — contraindicated"];
// Actions that change the starting dose in either direction.
const ADJUST_ACTIONS = ["Reduce starting dose", "Increase starting dose"];

const DRUG_SEPARATOR = ", ";

export function deriveDosingSummary(geneResults = [], noCallGenes = [], g6pd = null) {
  const results = Array.isArray(geneResults) ? geneResults : [];
  const noCalls = Array.isArray(noCallGenes) ? noCallGenes : [];

  const rows = [];
  const flags = [];

  for (const r of results) {
    if (!r || !r.gene) continue;

    // A gene that failed QC is reported as NOT ANALYSED. If it also carries a
    // result or an action, the record contradicts itself — say so rather than
    // silently preferring one half.
    if (noCalls.includes(r.gene)) {
      if (r.dose_implication) {
        flags.push({
          gene: r.gene,
          type: "nocall_conflict",
          text: `${r.gene} is listed as a no-call but also carries a dose implication — one of the two is wrong.`,
        });
      }
      continue;
    }

    const drugs = Array.isArray(r.implicated_drugs) ? r.implicated_drugs.filter(Boolean) : [];

    if (!r.phenotype) {
      flags.push({
        gene: r.gene,
        type: "missing_phenotype",
        text: `${r.gene} has no phenotype recorded — the diplotype alone is not actionable.`,
      });
    }

    if (r.dose_implication && drugs.length === 0) {
      flags.push({
        gene: r.gene,
        type: "no_drug",
        text: `${r.gene} carries a dose implication but no implicated drugs — name the drugs it applies to.`,
      });
    }

    if (!r.dose_implication && drugs.length > 0) {
      flags.push({
        gene: r.gene,
        type: "no_action",
        text: `${r.gene} names ${drugs.length} drug(s) but no dose implication — state the action or clear the drug list.`,
      });
    }

    // One row per drug, so the summary groups by what gets prescribed.
    const actionRows = drugs.length ? drugs : [""];
    for (const drug of actionRows) {
      rows.push({
        drug,
        gene: r.gene,
        phenotype: r.phenotype || "",
        action: r.dose_implication || "",
        risk: r.risk_category || "",
        reason: rowReason(r.gene, drug, r.phenotype, r.recommendation),
      });
    }
  }

  // ── G6PD ──
  // Recorded in its own section rather than as a gene row (it does not fit the
  // star-allele model — see G6PD_STATUS_OPTIONS), so it is folded in here: one
  // gene, one home, and the finding reaches the avoid-list. Previously the section
  // and the gene row were separate paths and only the gene row was read, so a
  // deficiency entered in the section named after it produced nothing.
  //
  // Only a deficient status contributes. Emitting avoid-rows for a normal result
  // would be noise, and indeterminate is not a finding.
  if (g6pd && G6PD_DEFICIENT_STATUSES.includes(g6pd.status || "")) {
    if (!g6pd.dose_implication) {
      flags.push({
        gene: "G6PD",
        type: "no_action",
        text: "G6PD deficiency is recorded but no dose implication is stated for the affected drugs.",
      });
    }
    for (const drug of G6PD_AFFECTED_DRUGS) {
      rows.push({
        drug,
        gene: "G6PD",
        phenotype: g6pd.status,
        action: g6pd.dose_implication || "",
        risk: "",
        reason: rowReason("G6PD", drug, g6pd.status, g6pd.recommendation),
      });
    }
  }

  const avoid = rows.filter((x) => AVOID_ACTIONS.includes(x.action));
  const adjust = rows.filter((x) => ADJUST_ACTIONS.includes(x.action));
  const standard = rows.filter((x) => x.action === "Standard dose — no adjustment");
  const pending = rows.filter((x) => !x.action);

  // Drugs a prescriber has to know about before writing the order.
  const actionable = [...avoid, ...adjust].filter((x) => x.drug);
  const drugsToAvoid = unique(avoid.map((x) => x.drug));
  const drugsToAdjust = unique(adjust.map((x) => x.drug));

  return {
    rows,
    avoid,
    adjust,
    standard,
    pending,
    drugsToAvoid,
    drugsToAdjust,
    actionableCount: actionable.length,
    notAnalysed: unique(noCalls),
    flags,
    summary: buildSummary({ drugsToAvoid, drugsToAdjust, actionableCount: actionable.length, notAnalysed: noCalls, flags }),
  };
}

// WHY the action, shown beside it. The record's own recommendation wins — it is
// what this case actually says — and the curated table's published rationale stands
// in only where the row carries none.
//
// The fallback is what makes the reason reliably present rather than sometimes
// there: choosing a phenotype prefills the recommendation, but an action set by
// hand leaves the row's own text empty, and an action with no reason beside it is
// the one thing a reader cannot check.
//
// This explains an action ALREADY recorded; it never chooses one. Same line the
// module has always held to, and the same reason there is no phenotype → dose
// derivation at the top of this file.
function rowReason(gene, drug, phenotype, recorded) {
  if (recorded) return recorded;
  const g = pgxGuidance(gene, drug ? [drug] : [], phenotype);
  return g.state === "applied" ? g.recommendation || "" : "";
}

function unique(list) {
  return [...new Set(list.filter(Boolean))];
}

function buildSummary({ drugsToAvoid, drugsToAdjust, actionableCount, notAnalysed, flags }) {
  const parts = [];
  if (actionableCount === 0 && drugsToAvoid.length === 0 && drugsToAdjust.length === 0) {
    parts.push("No actionable pharmacogenomic findings recorded.");
  } else {
    parts.push(
      `${actionableCount} actionable finding(s).`
    );
    if (drugsToAvoid.length) parts.push(`Avoid: ${drugsToAvoid.join(DRUG_SEPARATOR)}.`);
    if (drugsToAdjust.length) parts.push(`Dose adjustment: ${drugsToAdjust.join(DRUG_SEPARATOR)}.`);
  }
  if (notAnalysed.length) {
    parts.push(`${unique(notAnalysed).length} gene(s) not analysed: ${unique(notAnalysed).join(DRUG_SEPARATOR)}.`);
  }
  if (flags.length) {
    parts.push(`${flags.length} record issue(s) need review.`);
  }
  return parts.join(" ");
}

// ── Heteroresistance, derived from the variant allele frequency ──
//
// Bounds for a mixed population. Outside this window the call is treated as
// homogeneous, which is what the phenotypic comparison assumes. Shared rather
// than declared on the tNGS panel because the same rule has to hold whether the
// VAF was typed by hand or merged in from a dictation — a call whose VAF implies
// heteroresistance must never lose the warning.
export const HETERO_VAF_MIN = 10;
export const HETERO_VAF_MAX = 75;

// "Yes" / "No", or "" when the value is not a number (nothing to derive from).
export function deriveHeteroresistance(vaf) {
  const v = parseFloat(vaf);
  if (!Number.isFinite(v)) return "";
  return v >= HETERO_VAF_MIN && v <= HETERO_VAF_MAX ? "Yes" : "No";
}

// ─── Patient read-forward register ────────────────────────────────────────────
//
// A pharmacogenomic result is a lifelong property of the patient, so it must stay
// visible on every future case without the lab re-entering or re-running it.
//
// `getPatientCases` returns FULL documents (no projection on the backend), so the
// register needs no extra endpoint — it reads the same case list Registration's
// history table already loads. Each finding carries its PROVENANCE: which case
// established it, when, and at which laboratory, because a carried-forward result
// printed on a signed report has to name its source.
//
// oldestFirst matters: a finding is reported once, at the case that first
// established it, so the earliest record is the origin and later cases merely
// carry it forward.
//
// A LATER case stating a DIFFERENT result is a conflict, not a duplicate. It is
// surfaced rather than ranked: deciding which of the two is right means guessing
// which assay was wrong, and that is the guess deriveDosingSummary already
// refuses to make for a no-call that also carries an action.
export function collectKnownFindings(cases = [], currentCaseId = "", currentForm = null) {
  // Every occurrence is gathered BEFORE de-duplication, so a disagreement between
  // two cases stays visible instead of being swallowed by "the earliest one wins".
  const occurrences = new Map();
  const add = (f) => {
    const key = `${f.kind}|${f.key}`;
    const list = occurrences.get(key) || [];
    list.push(f);
    occurrences.set(key, list);
  };

  const ordered = [...(cases || [])].reverse(); // the API returns newest first

  for (const c of ordered) {
    const id = c?.case_id || c?._id || "";
    if (!id || id === currentCaseId) continue;
    const hg = c?.human_genomics;
    if (!hg) continue;
    // The module's own definition of when a case happened (shared/caseHistory.js),
    // not a third one — Registration's history table dates a case by the same rule.
    const date = microCaseDate(c);
    const lab = hg?.assay?.laboratory || "";
    const noCalls = Array.isArray(hg?.qc?.no_call_genes) ? hg.qc.no_call_genes : [];

    for (const r of hg.gene_results || []) {
      if (!r?.gene) continue;
      // A gene that failed QC on THAT assay is not a patient finding: "not
      // analysed" describes the old run, not the person. Carried forward it would
      // read as a result this case holds — or, worse, as a normal one. The tab's
      // own rule is that a failed gene never reports as normal.
      if (noCalls.includes(r.gene)) continue;
      add({
        kind: "gene",
        key: r.gene,
        label: r.gene,
        genotype: r.diplotype || [r.allele_1, r.allele_2].filter(Boolean).join("/"),
        result: r.phenotype || r.diplotype || "",
        action: r.dose_implication || "",
        drugs: Array.isArray(r.implicated_drugs) ? r.implicated_drugs : [],
        case_id: id,
        date,
        lab,
      });
    }

    for (const r of hg.hla_results || []) {
      if (!r?.allele) continue;
      add({
        kind: "hla",
        key: r.allele,
        label: r.allele,
        genotype: r.locus || "HLA",
        result: r.result || "",
        action: r.recommendation || "",
        drugs: r.drug ? [r.drug] : [],
        case_id: id,
        date,
        lab,
      });
    }

    if (hg.g6pd?.status) {
      add({
        kind: "g6pd",
        key: "G6PD",
        label: "G6PD",
        genotype: Array.isArray(hg.g6pd.variants) ? hg.g6pd.variants.join(", ") : "",
        result: hg.g6pd.status,
        action: hg.g6pd.dose_implication || "",
        drugs: [],
        case_id: id,
        date,
        lab,
      });
    }
  }

  const findings = [];
  for (const list of occurrences.values()) {
    const origin = list[0]; // earliest — the case that established the finding
    const disagreeing = list.filter((f) => f.result !== origin.result);
    const latest = disagreeing[disagreeing.length - 1];
    findings.push({
      ...origin,
      // One disagreement is shown, and BOTH values are kept: the reader is told the
      // two records conflict, never which one to believe.
      conflict: latest
        ? { result: latest.result, date: latest.date, case_id: latest.case_id, lab: latest.lab }
        : null,
    });
  }

  // Which findings are ALSO recorded on the case being worked on — shown so a
  // duplicate entry is visible, not so that re-entry is required. Findings not
  // on this case are carried by the register alone.
  const onThisCase = new Set();
  for (const r of currentForm?.gene_results || []) if (r?.gene) onThisCase.add(`gene|${r.gene}`);
  for (const r of currentForm?.hla_results || []) if (r?.allele) onThisCase.add(`hla|${r.allele}`);
  if (currentForm?.g6pd?.status) onThisCase.add("g6pd|G6PD");

  return findings.map((f) => ({ ...f, onThisCase: onThisCase.has(`${f.kind}|${f.key}`) }));
}

// ─── Carried-forward findings as report rows ──────────────────────────────────
//
// The same columns the case's own PGx table uses, so the two blocks on a report
// read as one family — plus an "Established" column. On a SIGNED document a result
// this case did not produce has to name where it came from, which is why the date,
// the laboratory and a reference to the originating case travel with every row.
//
// Microbiology has no accession counter (unlike pathology's TMH-YYYY-######), so
// the case reference is the first 8 characters of the case id — enough to trace in
// the system, short enough to sit in a table cell.
export function pgxCarriedForwardRows(findings = []) {
  return (Array.isArray(findings) ? findings : []).map((f) => {
    const ref = String(f.case_id || "").slice(0, 8);
    const established = [
      f.date ? new Date(f.date).toLocaleDateString() : "",
      f.lab,
      ref ? `ref ${ref}` : "",
    ].filter(Boolean).join(" · ");
    return [f.label, f.genotype || "—", f.result || "—", f.action || "—", established];
  });
}

// The disagreements among carried-forward findings, as sentences. Printed under
// the table rather than resolved in it — the two records disagree and the report's
// job is to say so, not to pick a winner.
export function pgxCarriedForwardConflicts(findings = []) {
  return (Array.isArray(findings) ? findings : [])
    .filter((f) => f?.conflict)
    .map((f) => {
      const when = (d) => (d ? new Date(d).toLocaleDateString() : "an earlier case");
      return `${f.label}: ${f.result || "no result"} (${when(f.date)}${f.lab ? ` · ${f.lab}` : ""}) and `
        + `${f.conflict.result || "no result"} (${when(f.conflict.date)}${f.conflict.lab ? ` · ${f.conflict.lab}` : ""}) `
        + "disagree. One of the two is wrong. Both are kept until this is resolved.";
    });
}

// ─── Pharmacogenomics as report rows ─────────────────────────────────────────

// One shape, shared by Tab 14's read-only recap and the printed PDF, so a PGx
// result cannot read differently in the two — the same reason resultSummaries.js
// exists for the other tracks. Each row is { label, genotype, result, action }.
export function pgxReportRows(humanGenomics) {
  const hg = humanGenomics || {};
  const rows = [];

  for (const r of hg.gene_results || []) {
    if (!r?.gene) continue;
    rows.push({
      label: r.gene,
      genotype: r.diplotype || [r.allele_1, r.allele_2].filter(Boolean).join("/") || "—",
      result: r.phenotype || "—",
      action: r.dose_implication || "—",
    });
  }

  for (const r of hg.hla_results || []) {
    if (!r?.allele) continue;
    rows.push({
      label: r.allele,
      genotype: r.locus || "HLA",
      result: r.result || "—",
      action: r.recommendation || "—",
    });
  }

  if (hg.g6pd?.status) {
    rows.push({
      label: "G6PD",
      genotype: hg.g6pd.activity_pct ? `${hg.g6pd.activity_pct}%` : "—",
      result: hg.g6pd.status,
      action: hg.g6pd.dose_implication || hg.g6pd.recommendation || "—",
    });
  }

  return rows;
}

// The limitations that travel WITH a PGx result rather than beside it. With no
// genetic-counselling service these lines are the only thing between a "not
// detected" and a wrong "normal", so neither the tab nor the report may omit them.
export function pgxLimitations(humanGenomics) {
  const hg = humanGenomics || {};
  return [
    hg.report?.limitations_note || "",
    (hg.qc?.limitations || []).length ? `Assay limitations: ${hg.qc.limitations.join("; ")}` : "",
    (hg.qc?.no_call_genes || []).length
      ? `Not analysed (failed QC): ${hg.qc.no_call_genes.join(", ")}`
      : "",
    "Pharmacogenomic results are lifelong and independent of this specimen.",
  ].filter(Boolean);
}

// True when the case holds anything pharmacogenomic worth showing. Tab 14 gates
// its report shape on THIS rather than on the case type, so a Combined case
// carrying both an infection and a PGx panel shows both halves.
export function hasPgxContent(humanGenomics) {
  const hg = humanGenomics || {};
  return (
    (hg.gene_results || []).some((r) => r?.gene) ||
    (hg.hla_results || []).some((r) => r?.allele) ||
    !!hg.g6pd?.status
  );
}

// ─── Pathogen-side derivations ────────────────────────────────────────────────

// ── Prior GeneXpert, read back from Tab 8 ──
//
// The WHO pathway runs tNGS *after* a nucleic-acid test, so the tNGS panel records
// the prior GeneXpert result. That field is transcribed by hand, and the one thing
// worth catching is a transcription error on the most consequential TB result in
// the case — so this reads what Tab 8 actually holds and maps it into the same
// vocabulary the tNGS panel records, letting the two be compared.
//
// Tab 8 stores the qualitative result plus a tick-list of markers DETECTED
// ("Resistance / mechanism markers detected"). An absent rpoB marker therefore
// means rifampicin resistance was NOT detected — that is the field's contract, not
// an assumption about missing data.
//
// Returns null when there is nothing conclusive to compare: no GeneXpert on this
// specimen, a blank result, or an Indeterminate one.
export function genexpertFromMolecular(molecular, specimenId) {
  const orders = (molecular && molecular[specimenId] && molecular[specimenId].orders) || [];
  const gx = orders.find((o) => o.test_type === "gene_xpert");
  if (!gx) return null;

  const qualitative = gx.result?.qualitative || "";
  const result = {
    Detected: "MTB detected",
    "Not detected": "MTB not detected",
    Invalid: "Invalid",
  }[qualitative];
  if (!result) return null; // blank or Indeterminate — nothing to compare against

  const rif =
    result === "MTB detected"
      ? (gx.result?.markers || []).some((m) => /rpoB mutation detected/i.test(m))
        ? "Rifampicin resistance detected"
        : "Rifampicin resistance not detected"
      : "";

  return {
    result,
    rif_resistance: rif,
    assay: MOLECULAR_ASSAY_BY_VALUE[gx.assay]?.label || gx.assay || "GeneXpert",
  };
}

// Which fields of a hand-recorded prior GeneXpert disagree with Tab 8. Compared
// per-field so a partial agreement still surfaces the disagreement. Returns a
// list of human labels — empty means they agree, or there is nothing to compare.
//
// A warning rather than a block, deliberately: the two can legitimately differ
// (a repeat test, a different specimen, a result reissued), and the tech is the
// one who knows which is current.
export function genexpertMismatches(recorded, fromTab8) {
  if (!fromTab8 || !recorded) return [];
  const out = [];
  if (recorded.result && recorded.result !== fromTab8.result) out.push("MTB detection");
  if (
    recorded.rif_resistance &&
    fromTab8.rif_resistance &&
    recorded.rif_resistance !== fromTab8.rif_resistance
  ) {
    out.push("rifampicin resistance");
  }
  return out;
}

// Resistance determinants that warrant an infection-control flag, matched on the
// gene name. Deliberately a narrow, named list rather than a regex over
// everything — a false CRE flag has real consequences.
const AMR_GENE_FLAGS = [
  { type: "CRE_genomic", label: "Carbapenem-resistant Enterobacterales (genomic)", match: /^(bla)?(KPC|NDM|OXA-48|OXA-181|OXA-232|VIM|IMP)/i },
  { type: "MRSA_genomic", label: "Methicillin-resistant S. aureus (genomic)", match: /^(mecA|mecC)$/i },
  { type: "VRE_genomic", label: "Vancomycin-resistant Enterococcus (genomic)", match: /^(vanA|vanB)$/i },
  { type: "ESBL_genomic", label: "Extended-spectrum beta-lactamase (genomic)", match: /^(bla)?(CTX-M|SHV|TEM)/i },
  { type: "COLISTIN_genomic", label: "Plasmid-mediated colistin resistance (genomic)", match: /^mcr-/i },
];

// Flags derived from a stored pathogen_genomics section, keyed by specimen.
// Consumed by Tab 13 through the existing detectFlags() aggregator.
export function detectGenomicsFlags(pathogenGenomics = {}) {
  const flags = [];

  for (const [specimenId, rec] of Object.entries(pathogenGenomics || {})) {
    // WGS resistance determinants.
    for (const gene of rec?.wgs?.resistance_genes || []) {
      const name = gene?.gene_name || "";
      for (const def of AMR_GENE_FLAGS) {
        if (def.match.test(name)) {
          flags.push({
            type: def.type,
            label: def.label,
            source: "WGS",
            specimen_id: specimenId,
            detail: name,
          });
        }
      }
    }

    // mNGS AMR genes — same determinants, but unattributed to an organism, so
    // they are flagged separately and never merged with an isolate-level flag.
    for (const gene of rec?.mngs?.amr_genes_detected || []) {
      const name = gene?.gene_name || "";
      for (const def of AMR_GENE_FLAGS) {
        if (def.match.test(name)) {
          flags.push({
            type: def.type,
            label: def.label,
            source: "mNGS",
            specimen_id: specimenId,
            detail: `${name} (not organism-attributed)`,
          });
        }
      }
    }

    // Drug-resistant TB is notifiable, not merely flagged.
    const tbClass = rec?.tngs?.tb_classification || rec?.wgs?.tb_resistance_classification;
    if (["MDR-TB", "pre-XDR-TB", "XDR-TB"].includes(tbClass)) {
      flags.push({
        type: "DR_TB_genomic",
        label: "Drug-resistant TB (genomic)",
        source: rec?.tngs ? "tNGS" : "WGS",
        specimen_id: specimenId,
        detail: tbClass,
        notifiable: true,
      });
    }
  }

  return flags;
}

// De-duplicate flags of the same type for the same specimen, keeping the first
// detail seen — two carbapenemase genes on one isolate is one CRE flag with one
// named example, not two identical rows.
export function dedupeGenomicsFlags(flags = []) {
  const seen = new Set();
  const out = [];
  for (const f of flags) {
    const key = `${f.type}|${f.specimen_id}|${f.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}
