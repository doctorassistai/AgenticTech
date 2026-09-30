// shared/pgxGuidance.js — CPIC gene + drug + phenotype → dose action (DATA ONLY)
//
// The lookups that consume this live in shared/genomics.js. This file is data, the
// same split as astData.js (panels) / cascade.js (rules): growing the guidance is a
// data edit, never an engine change.
//
// WHY IT IS KEYED BY DRUG AND NOT BY PHENOTYPE ALONE
// The obvious design — "Poor metabolizer → avoid" — is unsafe, because the correct
// action is drug-specific. CYP2D6 is the proof: for CODEINE an ultrarapid
// metabolizer must AVOID the drug (it is a prodrug, and rapid conversion to morphine
// causes opioid toxicity), while for TAMOXIFEN the same phenotype acts in the other
// direction. So guidance is a drug-keyed table, and a row whose drugs disagree is
// left alone rather than guessed at.
//
// WHAT IS DELIBERATELY MISSING, AND WHY
// A table that guesses is worse than one that abstains: an unmatched combination
// returns "none" and the field is left for the microbiologist, never defaulted to
// "standard dose". These are omitted because their published guidance does not fit
// the metabolizer vocabulary this module records:
//   • VKORC1, SLCO1B1 — CPIC phenotype terms are function-based ("decreased
//     function"), not metabolizer-based; the dropdown would have to grow first.
//   • CYP2C9 + warfarin — inherently a TWO-gene algorithm (CYP2C9 + VKORC1) plus
//     clinical inputs; neither gene alone determines the dose.
//   • CYP3A5 + tacrolimus — CPIC reports expresser / non-expresser, not
//     metabolizer phenotype.
//   • RYR1, CACNA1S — malignant hyperthermia is a variant-present/absent call, not
//     a phenotype; the action is "avoid triggering agents", already in the note.
//   • CYP2D6 + tamoxifen — the guidance turns on menopausal status and whether an
//     aromatase inhibitor is suitable; it needs clinical input, not transcription.
//   • G6PD at intermediate activity — heterozygous females are managed case by
//     case; only frank deficiency is recorded here.
//
// EVERY ENTRY BELOW NEEDS REVIEW by a clinical pharmacologist before this is used
// on a patient. The actions are the load-bearing part (they drive the avoid/dose-
// adjustment lists); the recommendation text is explanatory. Same standing notice
// as astData.js — this is a starter set, not a validated one.

const AVOID = "Avoid — contraindicated";
const AVOID_ALT = "Avoid — use alternative agent";
const REDUCE = "Reduce starting dose";
const INCREASE = "Increase starting dose";
const STANDARD = "Standard dose — no adjustment";

export const PGX_GUIDANCE = [
  // ─── DPYD — fluoropyrimidines ────────────────────────────────────────────────
  // The enzyme that clears 5-FU. Slow enzyme → the drug accumulates, and full-dose
  // treatment in a poor metabolizer has caused fatal toxicity.
  {
    gene: "DPYD",
    drugs: ["5-Fluorouracil", "Capecitabine", "Tegafur"],
    byPhenotype: {
      "Poor metabolizer": {
        action: AVOID,
        recommendation: "High risk of severe or fatal fluoropyrimidine toxicity. Use an alternative agent; if none exists, specialist advice only.",
      },
      "Intermediate metabolizer": {
        action: REDUCE,
        recommendation: "Reduce the starting dose substantially and titrate on tolerance, with close monitoring of blood counts and mucositis.",
      },
      "Normal metabolizer": { action: STANDARD, recommendation: "" },
    },
  },

  // ─── TPMT + NUDT15 — thiopurines ─────────────────────────────────────────────
  // Both genes clear the same drugs, and they are tested as a pair: NUDT15 *3 is
  // common in South Asian populations while TPMT reads normal, so a TPMT-only
  // panel reports "normal" for a patient who will still be poisoned. Guidance
  // therefore exists for both, and the worse of the two findings governs.
  {
    gene: "TPMT",
    drugs: ["Azathioprine", "Mercaptopurine", "Thioguanine"],
    byPhenotype: {
      "Poor metabolizer": {
        action: AVOID_ALT,
        recommendation: "Severe myelosuppression risk. Consider an alternative agent; if a thiopurine is required, a drastically reduced dose under specialist supervision.",
      },
      "Intermediate metabolizer": {
        action: REDUCE,
        recommendation: "Reduce the starting dose and titrate on tolerance, with regular blood counts.",
      },
      "Normal metabolizer": { action: STANDARD, recommendation: "" },
    },
  },
  {
    gene: "NUDT15",
    drugs: ["Azathioprine", "Mercaptopurine", "Thioguanine"],
    byPhenotype: {
      "Poor metabolizer": {
        action: AVOID_ALT,
        recommendation: "Severe myelosuppression risk — read together with TPMT. Consider an alternative agent.",
      },
      "Intermediate metabolizer": {
        action: REDUCE,
        recommendation: "Reduce the starting dose and titrate on tolerance, with regular blood counts.",
      },
      "Normal metabolizer": { action: STANDARD, recommendation: "" },
    },
  },

  // ─── UGT1A1 — irinotecan ─────────────────────────────────────────────────────
  {
    gene: "UGT1A1",
    drugs: ["Irinotecan"],
    byPhenotype: {
      "Poor metabolizer": {
        action: REDUCE,
        recommendation: "(*28/*28, and *6 in Asian populations.) Reduce the starting dose; monitor closely for severe diarrhoea and neutropenia.",
      },
      "Intermediate metabolizer": { action: STANDARD, recommendation: "" },
      "Normal metabolizer": { action: STANDARD, recommendation: "" },
    },
  },

  // ─── CYP2D6 — codeine and tramadol ───────────────────────────────────────────
  // Both are PRODRUGS: the body converts them into the active opioid. A poor
  // metabolizer gets no pain relief; an ultrarapid metabolizer gets a dangerous
  // bolus. This is the pair that makes a phenotype-keyed table unsafe.
  {
    gene: "CYP2D6",
    drugs: ["Codeine", "Tramadol"],
    byPhenotype: {
      "Poor metabolizer": {
        action: AVOID_ALT,
        recommendation: "Analgesic effect is lost — the prodrug is not converted. Use a non-CYP2D6-dependent analgesic.",
      },
      "Intermediate metabolizer": { action: STANDARD, recommendation: "Monitor analgesic response; reduced effect is possible." },
      "Normal metabolizer": { action: STANDARD, recommendation: "" },
      "Rapid metabolizer": { action: STANDARD, recommendation: "" },
      "Ultrarapid metabolizer": {
        action: AVOID,
        recommendation: "Rapid conversion to the active opioid causes toxicity, including in breastfed infants. Use a non-CYP2D6-dependent analgesic.",
      },
    },
  },

  // ─── CYP2C19 — clopidogrel ───────────────────────────────────────────────────
  // Also a prodrug, but here the failure mode is the opposite of codeine's: a poor
  // metabolizer does not activate it, so the antiplatelet effect is missing.
  {
    gene: "CYP2C19",
    drugs: ["Clopidogrel"],
    byPhenotype: {
      "Poor metabolizer": {
        action: AVOID_ALT,
        recommendation: "Reduced activation — the antiplatelet effect is diminished. Use prasugrel or ticagrelor if not contraindicated.",
      },
      "Intermediate metabolizer": {
        action: AVOID_ALT,
        recommendation: "Reduced activation. Consider prasugrel or ticagrelor if not contraindicated.",
      },
      "Normal metabolizer": { action: STANDARD, recommendation: "" },
      "Rapid metabolizer": { action: STANDARD, recommendation: "" },
      "Ultrarapid metabolizer": { action: STANDARD, recommendation: "" },
    },
  },

  // ─── CYP2C19 — voriconazole ──────────────────────────────────────────────────
  // Same gene, a different direction entirely: this is a drug the liver has to
  // CLEAR, so a poor metabolizer accumulates it rather than failing to activate it.
  // A row carrying both clopidogrel and voriconazole therefore has no single right
  // answer — which is exactly the case the engine refuses to guess at.
  {
    gene: "CYP2C19",
    drugs: ["Voriconazole"],
    byPhenotype: {
      "Poor metabolizer": {
        action: REDUCE,
        recommendation: "Increased drug exposure. Reduce the starting dose and monitor trough levels.",
      },
      "Intermediate metabolizer": {
        action: REDUCE,
        recommendation: "Consider a reduced starting dose and monitor trough levels.",
      },
      "Normal metabolizer": { action: STANDARD, recommendation: "" },
    },
  },

  // ─── G6PD — one status, not a phenotype ──────────────────────────────────────
  // Recorded in its own section rather than as a gene row, so these entries are
  // keyed on the status string. Deficiency causes acute haemolysis on exposure to
  // these drugs, several of which are routine in this hospital's caseload —
  // primaquine for malaria, dapsone for leprosy.
  ...["Primaquine", "Tafenoquine", "Dapsone", "Nitrofurantoin", "Rasburicase", "Methylene blue"].map(
    (drug) => ({
      gene: "G6PD",
      drugs: [drug],
      byPhenotype: {
        Deficient: {
          action: AVOID,
          recommendation: "G6PD deficiency causes acute haemolysis on exposure. Use an alternative agent.",
        },
      },
    })
  ),
];

// ─── Lookup ───────────────────────────────────────────────────────────────────
//
// Returns one of four states. The distinction matters: "applied" is the only state
// that prefills a dose, and the other three exist so the UI can say WHY it did not,
// rather than leaving a blank the user cannot interpret.
//
//   { state: "none" }                                   nothing published that fits
//   { state: "partial" }                                only some drugs are covered
//   { state: "mixed" }                                  the drugs need DIFFERENT actions
//   { state: "applied", action, recommendation }        one action covers every drug
//
// "mixed" is real, not theoretical: a CYP2C19 row naming both clopidogrel and
// voriconazole hits it, because a poor metabolizer must avoid one and reduce the
// other. A single-implication row cannot express two answers, so it declines.
export function pgxGuidance(gene, drugs, phenotype) {
  const list = (Array.isArray(drugs) ? drugs : []).filter(Boolean);
  if (!gene || !phenotype || list.length === 0) return { state: "none" };

  const hits = list.map((drug) =>
    PGX_GUIDANCE.find((e) => e.gene === gene && e.drugs.includes(drug) && e.byPhenotype[phenotype])
  );
  const covered = hits.filter(Boolean);
  if (covered.length === 0) return { state: "none" };
  if (covered.length < list.length) return { state: "partial" };

  const actions = [...new Set(covered.map((e) => e.byPhenotype[phenotype].action))];
  if (actions.length > 1) return { state: "mixed" };

  const { recommendation } = covered[0].byPhenotype[phenotype];
  return { state: "applied", action: actions[0], recommendation: recommendation || "" };
}

// The gene-level wrap for G6PD, whose drug list is the whole panel rather than a
// row's implicated drugs. Returns the same four states.
export function g6pdGuidance(status, affectedDrugs) {
  return pgxGuidance("G6PD", affectedDrugs, status);
}
