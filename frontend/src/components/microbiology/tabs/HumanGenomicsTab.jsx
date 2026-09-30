// tabs/HumanGenomicsTab.jsx — Microbiology Tab 16: Human Genomics (PGx)
//
// Sequencing the PATIENT, not the organism. Scope is pharmacogenomics and host
// susceptibility: the question this tab answers is "will this patient be
// poisoned by, or fail to respond to, the drug we are about to give them".
//
// Every result follows the same chain, and the chain IS the record shape:
//
//     gene → star allele (diplotype) → activity score → phenotype → drug action
//
// STORAGE IS THE ARCHITECTURAL POINT. This section is CASE-LEVEL and not keyed
// by specimen_id, because a pharmacogenomic result is a lifelong property of the
// person — a DPYD result from 2026 is still true in 2029. Pathogen genomics, by
// contrast, is a property of one specimen of one case.
//
// Scope note: germline / hereditary cancer testing is deliberately NOT here. It
// carries ACMG/AMP classification, VUS reclassification and cascade-testing
// obligations, and it is already owned by the precision-oncology pipeline.
//
// Three clinical-safety rules this tab encodes:
//   • A gene that failed QC reports as "not analysed" — never as "normal".
//   • CYP2D6 needs a copy-number call a short-read panel cannot make.
//   • Only allele-level HLA calls are actionable; a low-resolution "B57" is not
//     a B*57:01 result.

import React, { useEffect, useRef, useState } from "react";
import { Box, Typography, TextField, Button, CircularProgress } from "@mui/material";
import { AddRounded, AutoAwesomeRounded, MicRounded, StopRounded } from "@mui/icons-material";
import { C, FONT, FW_NORMAL, inputSx, outlineBtnSx, saveBtnSx } from "../../shared/designTokens";
import { SectionBox } from "../../shared/FormComponents";
import { Grid, Txt, SelF, RowCard, ListField, YES_NO, FLAG_COLOR } from "./genomics/fields";
import {
  GENOMICS_PLATFORMS,
  SEQUENCING_LABS,
  PGX_PANELS,
  PGX_METHODS,
  PGX_SPECIMEN_TYPES,
  PGX_GENES,
  CPIC_PHENOTYPES,
  CPIC_EVIDENCE_LEVELS,
  PGX_GUIDELINE_SOURCES,
  PGX_DOSE_ACTIONS,
  PGX_RISK_CATEGORIES,
  PGX_ASSAY_LIMITATIONS,
  GENOMIC_CONSENT_OPTIONS,
  HLA_PGX_ALLELES,
  HLA_TYPING_METHODS,
  HLA_RESULT_OPTIONS,
  HLA_RESOLUTION_OPTIONS,
  G6PD_STATUS_OPTIONS,
  G6PD_AFFECTED_DRUGS,
  pgxTestsFor,
} from "../constants";
import {
  blankHumanGenomics,
  hydrateHumanGenomics,
  blankGeneResult,
  blankHlaResult,
  geneDefaultsFor,
  geneNoteFor,
  geneRequiresCnv,
} from "./genomics/pgxRecords";
import { deriveDosingSummary, collectKnownFindings } from "../shared/genomics";
import { pgxGuidance, g6pdGuidance } from "../shared/pgxGuidance";
import { pgxAdvisory, structureHumanGenomics, TRANSCRIBE_URL } from "../shared/api";
import { mergePgxChunk, PGX_CHUNKS } from "./genomics/pgxDictation";

const GENE_OPTIONS = PGX_GENES.map((g) => ({ value: g.gene, label: g.label }));
const HLA_ALLELE_OPTIONS = HLA_PGX_ALLELES.map((a) => ({ value: a.allele, label: a.allele }));

// The carried-forward register's column template, shared by its header and every
// row so the columns line up across rows whatever the cell text is. The first
// three are fixed at the width of their longest value ("Abacavir acceptable — no
// risk allele detected" sets the action track); origin takes the rest, because it
// is the one column that grows with the patient's history.
const CARRIED_COLUMNS = "150px 190px 320px minmax(240px, 1fr)";

// A low-resolution call is NOT actionable: only HLA-B*57:01 carries abacavir
// risk, so a "B57 positive" without the allele is a false positive waiting to
// happen. Surfaced on the row rather than left to the reader.
const LOW_RESOLUTION = "Low resolution — not allele-specific";

// A register value only prefills a field when it is a LEGAL value for that field.
// The register's `result` falls back to the diplotype when no phenotype was
// recorded, so writing it straight into an enum select would put a genotype in a
// phenotype field. An unmatched value is withheld rather than coerced.
const optionOnly = (options, v) => (options.includes(v) ? v : "");

// Turn a guidance lookup into a prefill patch. "applied" is the only state that
// writes anything — "none", "partial" and "mixed" all decline, because a partly
// applicable or contradictory action is worse than a blank the user fills in.
// The free-text recommendation is only set when the field is still empty.
const guidancePatch = (g, currentRecommendation) => {
  if (g.state !== "applied") return {};
  return {
    dose_implication: g.action,
    ...(g.recommendation && !currentRecommendation ? { recommendation: g.recommendation } : {}),
  };
};

// Why no action was offered, when the user would otherwise be looking at an
// unexplained blank. "none" says nothing — most gene/drug pairs have no published
// guidance and a note on each would be noise.
const guidanceNote = (state) => {
  if (state === "mixed") {
    return "These drugs need different actions at this phenotype — set the dose implication yourself.";
  }
  if (state === "partial") {
    return "Guidance covers only some of these drugs — set the dose implication yourself.";
  }
  return "";
};

// The guidance note for one gene row, or nothing. A component so the lookup runs
// once per row rather than being called twice inside the map below.
const GuidanceNote = ({ row }) => {
  const note = guidanceNote(pgxGuidance(row.gene, row.implicated_drugs, row.phenotype).state);
  if (!note) return null;
  return (
    <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.5 }}>
      {note}
    </Typography>
  );
};

// The row collides with a result the patient already has. Two states, and the
// second is the one that matters: a re-entry that AGREES with the old record is
// bookkeeping, but a re-entry that DISAGREES is a contradiction between two
// records — and this module never picks a winner. The earlier record is left
// untouched, both are kept, and the reader is told which is which.
//
// No border of its own: the red flag belongs to the card (RowCard's `flagged`, or
// the wrapper on the G6PD grid), and the note is what that flag is saying.
const CarriedNote = ({ carried, current, label }) => {
  if (!carried) return null;
  const diverged = Boolean(current && carried.value && current !== carried.value);
  const source = [
    carried.lab,
    carried.date ? new Date(carried.date).toLocaleDateString() : "",
  ].filter(Boolean).join(" · ");
  return (
    <Typography sx={{ mt: 1.25, fontSize: 11.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.6 }}>
      <Box component="span" sx={{ color: FLAG_COLOR, fontWeight: "bold" }}>
        {diverged
          ? "⚠ This disagrees with the earlier result."
          : "⚠ Already on file for this patient."}
      </Box>{" "}
      {diverged ? (
        <>
          The patient already has {label} — {carried.value}
          {source ? ` (${source})` : ""}. One of the two is wrong; both records are kept, and
          the earlier one is not changed by this case.
        </>
      ) : (
        <>
          {label} — {carried.result || "no result"}
          {carried.action ? ` · ${carried.action}` : ""}
          {source ? ` (${source})` : ""}. Prefilled from that record; saving records it on this
          case too, and the earlier result is not changed.
        </>
      )}
    </Typography>
  );
};

// A labelled row of toggle chips. Local because only the limitations block uses
// it — the rest of the tab is plain fields.
const FieldLabelRow = ({ label, children }) => (
  <Box>
    <Typography
      sx={{
        fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase",
        letterSpacing: "0.08em", mb: 0.75,
      }}
    >
      {label}
    </Typography>
    <Box sx={{ display: "flex", flexWrap: "wrap" }}>{children}</Box>
  </Box>
);

// ── The advisory brief ────────────────────────────────────────────────────────
// Rendered strictly by presence, so a partial response still reads cleanly and an
// older kept brief stays legible. Advisory only: nothing here is applied to any
// field, and there are deliberately no accept buttons — the microbiologist copies
// what is useful, which is the module's standing posture for AI output.

const briefList = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

// Pass `items` for a bullet list, or `children` for custom content — in which case
// the caller decides whether it is worth showing at all.
const BriefBlock = ({ title, items, children }) => {
  const list = items ? briefList(items) : null;
  if (list && list.length === 0) return null;
  if (!list && !children) return null;
  return (
    <Box sx={{ mb: 1.75 }}>
      <Typography
        sx={{
          fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase",
          letterSpacing: "0.08em", mb: 0.5,
        }}
      >
        {title}
      </Typography>
      {list ? (
        <Box sx={{ display: "grid", gap: 0.35 }}>
          {list.map((t, i) => (
            <Typography key={i} sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>· {t}</Typography>
          ))}
        </Box>
      ) : (
        children
      )}
    </Box>
  );
};

const BriefChips = ({ items }) => (
  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
    {briefList(items).map((t, i) => (
      <Box key={i} sx={{ px: 1.25, py: 0.5, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
        <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>{t}</Typography>
      </Box>
    ))}
  </Box>
);

const PgxBrief = ({ advisory }) => {
  const a = advisory || {};
  const genes = (Array.isArray(a.gene_assessment) ? a.gene_assessment : []).filter((g) => g?.gene);
  const actions = (Array.isArray(a.drug_actions) ? a.drug_actions : []).filter((d) => d?.drug);
  const flags = briefList(a.safety_flags);
  const actionOf = (d) => String(d.action || "");
  // Derived from drug_actions rather than asked for as a separate field, so the
  // chips and the table cannot disagree and a model returning one but not the
  // other cannot produce a contradiction.
  const recGroups = [
    ["Avoid", actions.filter((d) => actionOf(d).startsWith("Avoid")).map((d) => d.drug)],
    ["Dose adjustment", actions.filter((d) => /^(Reduce|Increase) starting dose/.test(actionOf(d))).map((d) => d.drug)],
  ].filter(([, v]) => v.length > 0);

  return (
    <Box>
      {a.actionable_summary && (
        <Box sx={{ px: 2, py: 1.5, mb: 2, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.6 }}>
            {a.actionable_summary}
          </Typography>
        </Box>
      )}

      {flags.length > 0 && (
        <Box sx={{ px: 1.5, py: 1.25, mb: 2, border: `1px solid ${C.black}`, background: C.white }}>
          {flags.map((f, i) => (
            <Typography key={i} sx={{ fontSize: 12, fontFamily: FONT, color: C.textPrimary }}>⚠ {f}</Typography>
          ))}
        </Box>
      )}

      {actions.length > 0 && (
        <BriefBlock title="Drug actions">
          <Box>
            {actions.map((d, i) => (
              <Box key={i} sx={{ display: "flex", gap: 1.5, py: 0.6, borderBottom: `1px solid ${C.border}`, flexWrap: "wrap", alignItems: "baseline" }}>
                <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary, minWidth: 130 }}>{d.drug}</Typography>
                <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary, minWidth: 180 }}>{d.action}</Typography>
                <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, minWidth: 70 }}>{d.gene}</Typography>
                <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, flex: "1 1 220px" }}>{d.rationale}</Typography>
              </Box>
            ))}
          </Box>
        </BriefBlock>
      )}

      {genes.length > 0 && (
        <BriefBlock title="Gene assessment">
          <Box sx={{ display: "grid", gap: 0.75 }}>
            {genes.map((g, i) => (
              <Box key={i} sx={{ px: 1.5, py: 1, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
                <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary, fontWeight: FW_NORMAL }}>
                  {g.gene}{g.confidence ? ` · ${g.confidence} confidence` : ""}
                </Typography>
                {g.finding && <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>{g.finding}</Typography>}
                {g.implication && <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>{g.implication}</Typography>}
              </Box>
            ))}
          </Box>
        </BriefBlock>
      )}

      <BriefBlock title="Not analysed — not the same as normal" items={a.not_analysed} />
      <BriefBlock title="Needs a human decision" items={a.guidance_gaps} />

      {recGroups.length > 0 && (
        <BriefBlock title="Drugs to act on">
          <Box sx={{ display: "grid", gap: 1 }}>
            {recGroups.map(([label, v]) => (
              <Box key={label}>
                <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.35 }}>{label}</Typography>
                <BriefChips items={v} />
              </Box>
            ))}
          </Box>
        </BriefBlock>
      )}

      {a.report_note && (
        <BriefBlock title="Report note — offered for the final report">
          <Box sx={{ px: 1.5, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
            <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.6 }}>{a.report_note}</Typography>
          </Box>
        </BriefBlock>
      )}

      {a.patient_summary && (
        <BriefBlock title="For the patient">
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.6 }}>{a.patient_summary}</Typography>
        </BriefBlock>
      )}

      <BriefBlock title="Limitations" items={a.limitations} />
      <BriefBlock title="Missing information" items={a.missing_information} />
    </Box>
  );
};

export default function HumanGenomicsTab({
  caseId,
  initialData,        // human_genomics section (case-level, NOT keyed by specimen)
  caseRegister,       // case_register (specimens + ordered tests)
  cases,              // the patient's case list — full documents, so the register
                      // reads prior human_genomics sections with no extra endpoint
  onSave,             // (tabKey, data) dispatch — "human-genomics"
}) {
  const [form, setForm] = useState(blankHumanGenomics());
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [advisory, setAdvisory] = useState(null);
  const [advisoryLoading, setAdvisoryLoading] = useState(false);
  const [advisoryKept, setAdvisoryKept] = useState(false);
  // Dictation runs its own state and its own notice: the strip fills the form and
  // the advisory generates a brief, and neither result should overwrite the other.
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [dictationNotice, setDictationNotice] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Latest form snapshot for the async autofill handler, so the four chunk merges
  // fold onto what is actually on screen rather than onto a stale capture.
  const formRef = useRef(form);
  formRef.current = form;

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];

  // Hydration is keyed on caseId, not initialData, so saving does not wipe
  // in-progress edits — the workflow remounts the tab on case change instead.
  useEffect(() => {
    const hydrated = hydrateHumanGenomics(initialData);
    setForm(hydrated);
    // A brief kept from an earlier run re-surfaces for reference. It is never
    // re-applied to any field, and it is never authoritative — it is a reading of
    // the result, not the result.
    const stored = hydrated.advisory;
    setAdvisory(stored?.output && typeof stored.output === "object" ? stored.output : null);
    setAdvisoryKept(!!stored);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Any test on the case that belongs to the PGx family. The section is
  // case-level, so this only decides whether the tab is workable at all.
  const orderedTests = specimens.flatMap((sp) => pgxTestsFor(sp.tests_ordered));

  const hasPgxPanelOrder = orderedTests.includes("pgx_panel");
  const hasHlaOrder = orderedTests.includes("hla_typing");
  const hasG6pdOrder = orderedTests.includes("g6pd");
  const hasSpecificPgxOrder = hasPgxPanelOrder || hasHlaOrder || hasG6pdOrder;

  // Gate sections by ordered test, with safeguards:
  // 1. If explicitly ordered, show it.
  // 2. If data is already entered/saved on this case, keep it visible so data is never hidden.
  // 3. If no specific PGx test was selected (e.g. general order), show all three by default.
  const showGeneResults = !hasSpecificPgxOrder || hasPgxPanelOrder || form.gene_results.length > 0;
  const showHla = !hasSpecificPgxOrder || hasHlaOrder || form.hla_results.length > 0;
  const showG6pd =
    !hasSpecificPgxOrder
    || hasG6pdOrder
    || Boolean(form.g6pd?.status || form.g6pd?.activity_pct || (form.g6pd?.variants && form.g6pd.variants.length > 0));

  // Recomputed on every render from the rows above — the readout can never drift
  // from the data it describes. Deterministic, no LLM (shared/genomics.js).
  const dosing = deriveDosingSummary(form.gene_results, form.qc.no_call_genes, form.g6pd);

  // Findings established by the patient's OTHER cases, with provenance. These are
  // read-only: a lifelong result is never re-ordered or re-entered, it is simply
  // already known.
  const knownFindings = collectKnownFindings(cases, caseId, form);

  const patch = (key, value) => setForm((p) => ({ ...p, [key]: value }));
  const patchIn = (key, value) => setForm((p) => ({ ...p, [key]: { ...p[key], ...value } }));

  const patchGeneRow = (rowId, p) =>
    setForm((prev) => ({
      ...prev,
      gene_results: prev.gene_results.map((r) => (r.row_id === rowId ? { ...r, ...p } : r)),
    }));

  const addGeneRow = () =>
    setForm((prev) => ({ ...prev, gene_results: [...prev.gene_results, blankGeneResult()] }));

  const removeGeneRow = (rowId) =>
    setForm((prev) => ({
      ...prev,
      gene_results: prev.gene_results.filter((r) => r.row_id !== rowId),
    }));

  // Picking a gene prefills the drugs it governs plus its guideline and evidence
  // level, so the prescriber-facing list is never retyped.
  //
  // If the patient ALREADY has a result for that gene, the earlier record is what
  // prefills the row and the row is flagged. This is an offer the microbiologist
  // reviews, never an auto-write — the same posture as the dose-implication prefill
  // below — and `carried_from` keeps where the value came from so a later edit can
  // be compared against it. Nothing is written into the earlier case.
  const selectGene = (rowId, gene) => {
    const defaults = geneDefaultsFor(gene);
    const known = knownFindings.find((f) => f.kind === "gene" && f.key === gene);
    if (!known) {
      // carried_from is cleared as well as set: re-pointing a row at a gene we have
      // never seen must not leave the previous gene's provenance attached to it.
      patchGeneRow(rowId, { gene, ...defaults, carried_from: null });
      return;
    }
    const phenotype = optionOnly(CPIC_PHENOTYPES, known.result);
    patchGeneRow(rowId, {
      gene,
      ...defaults,
      phenotype,
      diplotype: known.genotype || "",
      dose_implication: optionOnly(PGX_DOSE_ACTIONS, known.action),
      ...(known.drugs.length ? { implicated_drugs: known.drugs } : {}),
      carried_from: {
        case_id: known.case_id,
        date: known.date,
        lab: known.lab,
        result: known.result,
        value: phenotype,
        action: known.action,
      },
    });
  };

  // Picking a phenotype OFFERS the published action for these drugs — a prefill the
  // microbiologist reviews, never an auto-write. A row whose drugs need different
  // actions is left alone rather than guessed at, which is the whole reason the
  // guidance is keyed by drug (see shared/pgxGuidance.js). The free-text
  // recommendation is only filled when empty, so typing is never overwritten.
  const selectPhenotype = (rowId, phenotype) => {
    const row = form.gene_results.find((r) => r.row_id === rowId);
    const g = pgxGuidance(row?.gene, row?.implicated_drugs, phenotype);
    patchGeneRow(rowId, { phenotype, ...guidancePatch(g, row?.recommendation) });
  };

  // Same offer for G6PD, whose "drug list" is the whole affected panel rather than
  // a row's implicated drugs. A status already on file wins over the published
  // offer, because it is what this patient was actually found to be.
  const selectG6pdStatus = (status) => {
    const g = g6pdGuidance(status, G6PD_AFFECTED_DRUGS);
    const onFile = knownFindings.find((f) => f.kind === "g6pd");
    const fromRegister = onFile ? optionOnly(PGX_DOSE_ACTIONS, onFile.action) : "";
    const value = onFile ? optionOnly(G6PD_STATUS_OPTIONS, onFile.result) : "";
    patchG6pd({
      status,
      ...(fromRegister ? { dose_implication: fromRegister } : guidancePatch(g, form.g6pd.recommendation)),
      carried_from: onFile
        ? {
            case_id: onFile.case_id,
            date: onFile.date,
            lab: onFile.lab,
            result: onFile.result,
            value,
            action: onFile.action,
          }
        : null,
    });
  };

  const patchHlaRow = (rowId, p) =>
    setForm((prev) => ({
      ...prev,
      hla_results: prev.hla_results.map((r) => (r.row_id === rowId ? { ...r, ...p } : r)),
    }));

  const addHlaRow = () =>
    setForm((prev) => ({ ...prev, hla_results: [...prev.hla_results, blankHlaResult()] }));

  const removeHlaRow = (rowId) =>
    setForm((prev) => ({ ...prev, hla_results: prev.hla_results.filter((r) => r.row_id !== rowId) }));

  // Picking a known risk allele prefills the drug and the reaction it causes, and —
  // as with the gene rows — a result the patient already has is what prefills it,
  // flagged, with the earlier record left untouched.
  const selectHlaAllele = (rowId, allele) => {
    const known = HLA_PGX_ALLELES.find((a) => a.allele === allele);
    const onFile = knownFindings.find((f) => f.kind === "hla" && f.key === allele);
    const result = onFile ? optionOnly(HLA_RESULT_OPTIONS, onFile.result) : "";
    patchHlaRow(rowId, {
      allele,
      ...(known ? { drug: known.drug, reaction: known.reaction } : {}),
      ...(onFile
        ? {
            result,
            ...(onFile.action ? { recommendation: onFile.action } : {}),
            carried_from: {
              case_id: onFile.case_id,
              date: onFile.date,
              lab: onFile.lab,
              result: onFile.result,
              value: result,
              action: onFile.action,
            },
          }
        : { carried_from: null }),
    });
  };

  const patchG6pd = (p) => patchIn("g6pd", p);

  const save = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      // Snapshot the derivation alongside the result: the live readout is always
      // recomputed, but a reported result must stay readable as it was issued.
      await onSave("human-genomics", {
        ...form,
        derived: dosing,
        // Keep the brief with the result when one has been run, so a later reader
        // sees what the case was reviewed against. It is stored, never applied —
        // the report body stays handwritten.
        advisory: advisory
          ? { run_at: advisory.run_at, status: "success", output: advisory }
          : form.advisory,
      });
    } catch (err) {
      console.error("[HumanGenomicsTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Advisory only. Sends the form's CURRENT state, so a brief can be read before
  // the section is saved. Nothing it returns is written into any field.
  const runAdvisory = async () => {
    if (!caseId) return;
    setAdvisoryLoading(true);
    setNotice("");
    setAdvisory(null);
    setAdvisoryKept(false);
    try {
      // Send the same guidance view the screen shows: for each row, what our curated
      // table says per drug, and where it deliberately abstained. Without this the
      // brief sees drugs with no recorded action and can only answer "insufficient
      // evidence" — honest, but it under-informs exactly where the table knows the
      // answer. Resolved per DRUG, not per row, so a `mixed` row (clopidogrel must
      // be avoided, voriconazole reduced) can be stated as the two separate actions
      // it actually is. Payload-only and `_`-prefixed: never stored.
      //
      // The REASON travels with the action. The action alone ("Reduce starting dose")
      // is un-checkable, and this is the one field in the brief with no curated
      // counterpart to be validated against — so a model asked for a mechanism from
      // memory is where a plausible-but-backwards one comes from ("accumulation of
      // the active metabolite" for a prodrug that is never activated). Sending the
      // published reason, and the reason written on the record, lets the brief
      // phrase a reason that exists rather than invent one.
      const guidance = (form.gene_results || [])
        .filter((r) => r.gene)
        .map((r) => ({
          gene: r.gene,
          phenotype: r.phenotype || "",
          state: pgxGuidance(r.gene, r.implicated_drugs, r.phenotype).state,
          // What the microbiologist wrote on the row — often the most specific
          // reason there is, because it is about this patient's actual drugs.
          recorded_reason: r.recommendation || "",
          drugs: (r.implicated_drugs || [])
            .map((d) => {
              const g = pgxGuidance(r.gene, [d], r.phenotype);
              const applied = g.state === "applied";
              return {
                drug: d,
                published_action: applied ? g.action : "",
                published_reason: applied ? g.recommendation || "" : "",
              };
            })
            .filter((x) => x.published_action),
        }));

      // G6PD is not a gene row — it has its own section — but a deficiency is the
      // single biggest source of drug_actions entries (one per affected drug), so
      // without this the brief would have to invent a reason for every one of them.
      if (form.g6pd?.status) {
        const g = g6pdGuidance(form.g6pd.status, G6PD_AFFECTED_DRUGS);
        const applied = g.state === "applied";
        guidance.push({
          gene: "G6PD",
          phenotype: form.g6pd.status,
          state: g.state,
          recorded_reason: form.g6pd.recommendation || "",
          drugs: G6PD_AFFECTED_DRUGS.map((d) => ({
            drug: d,
            published_action: applied ? g.action : "",
            published_reason: applied ? g.recommendation || "" : "",
          })).filter((x) => x.published_action),
        });
      }
      const res = await pgxAdvisory(caseId, { ...form, _guidance: guidance });
      setAdvisory({ run_at: new Date().toISOString(), ...(res?.data || {}) });
    } catch (err) {
      console.error("[HumanGenomicsTab] advisory error:", err);
      // Clinician-facing: names no environment variable or internal endpoint —
      // enough to act on, and the detail is in the browser console for whoever
      // supports it.
      setNotice("Could not generate the advisory. Please try again — if it keeps failing, tell your system administrator.");
    } finally {
      setAdvisoryLoading(false);
    }
  };

  // ─── Dictation (speech-to-text + AI autofill) ──────────────────────────────
  // One transcript, four requests. The tab is the largest form in the module, so
  // it is filled in chunks (PGX_CHUNKS): each request carries only its own field
  // guide, and its response is bounded by that chunk. They are issued together
  // and folded in a fixed order, so the outcome never depends on which request
  // returned first. The merge is fill-empty and idempotent, so a chunk that fails
  // costs only its own section — retrying fills exactly what is missing.

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error("[HumanGenomicsTab] microphone:", error);
      setDictationNotice("Microphone access is unavailable.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.onstop = async () => {
      setIsRecording(false);
      setIsTranscribing(true);
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      audioChunksRef.current = [];
      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        const response = await fetch(TRANSCRIBE_URL, { method: "POST", body: formData });
        if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
        const data = await response.json();
        const text = data.text || data.transcription || "";
        if (text) setTranscript((current) => (current ? `${current} ${text}` : text));
        else setDictationNotice("Nothing was heard — try again.");
      } catch (error) {
        console.error("[HumanGenomicsTab] transcription:", error);
        setDictationNotice("Pharmacogenomic dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  const handleAutofill = async () => {
    const text = transcript.trim();
    if (!text || isAutofilling) return;
    setIsAutofilling(true);
    setDictationNotice("");
    try {
      const settled = await Promise.allSettled(
        PGX_CHUNKS.map((c) => structureHumanGenomics({ text, chunk: c.key }))
      );

      let next = formRef.current;
      let applied = 0;
      let created = 0;
      const failed = [];
      settled.forEach((res, i) => {
        const chunk = PGX_CHUNKS[i];
        if (res.status !== "fulfilled") {
          failed.push(chunk.label);
          // The reason stays in the console for whoever supports this — the
          // notice names the section that failed, not the server's error.
          console.error(`[HumanGenomicsTab] ${chunk.key} chunk failed:`, res.reason);
          return;
        }
        const merged = mergePgxChunk(chunk.key, next, res.value?.data || {});
        next = merged.form;
        applied += merged.applied;
        created += merged.created;
      });
      setForm(next);

      if (applied === 0 && created === 0) {
        if (failed.length === PGX_CHUNKS.length) {
          setDictationNotice("The dictation could not be structured. Please try again.");
        } else if (failed.length) {
          setDictationNotice(`${failed.join(" and ")} could not be structured — please retry.`);
        } else {
          setDictationNotice("Dictation matched only fields that are already filled — nothing was overwritten.");
        }
      } else {
        setDictationNotice(
          `Applied ${applied} dictated value${applied === 1 ? "" : "s"} to empty fields`
          + (created > 0 ? ` — added ${created} new row${created === 1 ? "" : "s"}` : "")
          + (failed.length
            ? `. ${failed.join(" and ")} could not be structured — retry to fill ${failed.length === 1 ? "it" : "them"}.`
            : ".")
        );
      }
    } catch (error) {
      console.error("[HumanGenomicsTab] dictation structure:", error);
      setDictationNotice("The dictation could not be structured. Please try again.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const dictationBusy = isRecording || isTranscribing || isAutofilling;

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Pharmacogenomic and host-susceptibility results. A result recorded here is
        lifelong and belongs to the patient, not to this case — it stays visible on
        every future case and is never re-ordered.
        {orderedTests.length === 0 && (
          <>
            {" "}
            <b>No PGx test is ordered on this case</b> — you can still record a known
            result, but consider adding the test in Registration &amp; Accession.
          </>
        )}
      </Typography>

      {/* ── Speech-to-text result dictation — fills empty fields only ──────── */}
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mb: 2.5 }}>
        <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1 }}>
          Speech-to-text pharmacogenomic result dictation
        </Typography>
        <TextField
          multiline
          minRows={3}
          fullWidth
          size="small"
          placeholder={''}
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          sx={{ ...inputSx, background: C.white }}
        />
        <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
          <Button
            sx={{
              ...outlineBtnSx,
              background: isRecording ? "#cf1322" : C.white,
              color: isRecording ? C.white : C.black,
              borderColor: isRecording ? "#cf1322" : C.black,
              "&:hover": { background: isRecording ? "#a8071a" : C.bgTertiary },
            }}
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isTranscribing || isAutofilling}
          >
            {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            {isTranscribing ? "Transcribing..." : isRecording ? "Stop Recording" : "Record"}
          </Button>
          <Button sx={outlineBtnSx} onClick={handleAutofill} disabled={dictationBusy || !transcript.trim()}>
            {isAutofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            AI Autofill Empty Fields
          </Button>
          {dictationNotice && (
            <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>
              {dictationNotice}
            </Typography>
          )}
        </Box>
      </Box>

      {/* ── Known findings, carried forward from prior cases ───────────────── */}
      {knownFindings.length > 0 && (
        <SectionBox title="Known findings — carried forward">
          <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
            Established by an earlier case for this patient. Read-only — these are not
            re-ordered and do not need re-entering. A result is reported once, at the case
            that first established it.
          </Typography>

          {/* One column template shared by the header and every row: with per-row
              flex the columns were sized by their own content, so a long action
              pushed the origin of that row out of line with all the others. */}
          <Box sx={{ border: `1px solid ${C.border}`, overflowX: "auto" }}>
            <Box sx={{ display: "grid", gridTemplateColumns: CARRIED_COLUMNS, minWidth: 900, background: C.bgSecondary, borderBottom: `1px solid ${C.border}` }}>
              {["Gene / allele", "Result", "Action", "Origin"].map((h) => (
                <Typography key={h} sx={{ px: 1.5, py: 1, fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {h}
                </Typography>
              ))}
            </Box>
            {knownFindings.map((f) => (
              <Box
                key={`${f.kind}-${f.key}`}
                sx={{ display: "grid", gridTemplateColumns: CARRIED_COLUMNS, minWidth: 900, borderBottom: `1px solid ${C.border}`, alignItems: "baseline" }}
              >
                <Typography sx={{ px: 1.5, py: 1, fontSize: 12, fontFamily: FONT, color: C.textPrimary, fontWeight: FW_NORMAL }}>
                  {f.label}
                </Typography>
                <Typography sx={{ px: 1.5, py: 1, fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                  {f.result || "—"}
                </Typography>
                <Typography sx={{ px: 1.5, py: 1, fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                  {f.action || "—"}
                </Typography>
                <Typography sx={{ px: 1.5, py: 1, fontSize: 11, fontFamily: FONT, color: C.textMuted }}>
                  {f.onThisCase ? "Also recorded on this case" : "From a prior case"}
                  {f.date ? ` · ${new Date(f.date).toLocaleDateString()}` : ""}
                  {f.lab ? ` · ${f.lab}` : ""}
                  {f.drugs.length ? ` · ${f.drugs.join(", ")}` : ""}
                </Typography>
                {/* A disagreement is surfaced here and never resolved: the register
                    keeps the earliest record as the origin, so without this line a
                    later contradicting result would simply be invisible. */}
                {f.conflict && (
                  <Typography sx={{ gridColumn: "1 / -1", px: 1.5, pb: 1, fontSize: 11, fontFamily: FONT, color: FLAG_COLOR }}>
                    ⚠ A later case recorded {f.conflict.result || "no result"}
                    {f.conflict.date ? ` (${new Date(f.conflict.date).toLocaleDateString()})` : ""} —
                    one of the two is wrong. Both are kept.
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        </SectionBox>
      )}

      {/* ── Consent ────────────────────────────────────────────────────────── */}
      <SectionBox title="Consent">
        <Grid cols={4}>
          <SelF label="Consent recorded" options={GENOMIC_CONSENT_OPTIONS} value={form.consent.obtained} onChange={(v) => patchIn("consent", { obtained: v })} />
          <Txt label="Obtained by" value={form.consent.obtained_by} onChange={(v) => patchIn("consent", { obtained_by: v })} />
          <Txt label="Obtained at" type="datetime-local" value={form.consent.obtained_at} onChange={(v) => patchIn("consent", { obtained_at: v })} />
          <Txt label="Consent reference" value={form.consent.reference} onChange={(v) => patchIn("consent", { reference: v })} />
        </Grid>
        <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 1 }}>
          No secondary or incidental findings are reported from this panel — there is no
          genetic-counselling service to explain them.
        </Typography>
      </SectionBox>

      {/* ── Sample & assay ─────────────────────────────────────────────────── */}
      <SectionBox title="Sample & assay">
        <Grid cols={4}>
          <SelF label="Specimen type" options={PGX_SPECIMEN_TYPES} value={form.assay.specimen_type} onChange={(v) => patchIn("assay", { specimen_type: v })} />
          <Txt label="Collected at" type="datetime-local" value={form.assay.collected_at} onChange={(v) => patchIn("assay", { collected_at: v })} />
          <Txt label="Received at" type="datetime-local" value={form.assay.received_at} onChange={(v) => patchIn("assay", { received_at: v })} />
          <Txt label="Reported at" type="datetime-local" value={form.assay.reported_at} onChange={(v) => patchIn("assay", { reported_at: v })} />
          <SelF label="Panel" options={PGX_PANELS} value={form.assay.panel} onChange={(v) => patchIn("assay", { panel: v })} />
          <Txt label="Panel version" value={form.assay.panel_version} onChange={(v) => patchIn("assay", { panel_version: v })} />
          <SelF label="Method" options={PGX_METHODS} value={form.assay.method} onChange={(v) => patchIn("assay", { method: v })} />
          <SelF label="Platform" options={GENOMICS_PLATFORMS} value={form.assay.platform} onChange={(v) => patchIn("assay", { platform: v })} />
          <SelF label="Laboratory" options={SEQUENCING_LABS} value={form.assay.laboratory} onChange={(v) => patchIn("assay", { laboratory: v })} />
          <Txt label="Lab reference" value={form.assay.lab_ref} onChange={(v) => patchIn("assay", { lab_ref: v })} />
          <Txt label="Result file reference" value={form.assay.result_file_ref} onChange={(v) => patchIn("assay", { result_file_ref: v })} />
        </Grid>
        <Box sx={{ mt: 1.5 }}>
          <ListField
            label="Genes covered by this panel (comma-separated)"
            placeholder="e.g. DPYD, TPMT, NUDT15, UGT1A1"
            value={form.assay.genes_covered}
            onChange={(v) => patchIn("assay", { genes_covered: v })}
          />
        </Box>
        <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 1 }}>
          A result outside the genes listed here is not ruled out by this panel — state
          coverage so a "not detected" is read correctly.
        </Typography>
      </SectionBox>

      {/* ── QC ─────────────────────────────────────────────────────────────── */}
      <SectionBox title="QC">
        <Grid cols={4}>
          <Txt label="DNA concentration (ng/µL)" value={form.qc.dna_concentration} onChange={(v) => patchIn("qc", { dna_concentration: v })} />
          <Txt label="A260/280" value={form.qc.a260_280} onChange={(v) => patchIn("qc", { a260_280: v })} />
          <Txt label="Mean depth (×)" value={form.qc.mean_depth} onChange={(v) => patchIn("qc", { mean_depth: v })} />
          <SelF label="QC pass" options={YES_NO} value={form.qc.qc_pass} onChange={(v) => patchIn("qc", { qc_pass: v })} />
        </Grid>
        <Box sx={{ mt: 1.5 }}>
          <ListField
            label="No-call genes — failed QC (comma-separated)"
            placeholder="These report as NOT ANALYSED, never as normal"
            value={form.qc.no_call_genes}
            onChange={(v) => patchIn("qc", { no_call_genes: v })}
          />
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <FieldLabelRow label="Assay limitations">
            {PGX_ASSAY_LIMITATIONS.map((lim) => {
              const on = form.qc.limitations.includes(lim);
              return (
                <Box
                  key={lim}
                  onClick={() =>
                    patchIn("qc", {
                      limitations: on
                        ? form.qc.limitations.filter((x) => x !== lim)
                        : [...form.qc.limitations, lim],
                    })
                  }
                  sx={{
                    px: 1.5, py: 0.75, mr: 1, mb: 1, cursor: "pointer", display: "inline-block",
                    border: `1px solid ${on ? C.black : C.border}`,
                    background: on ? C.black : "transparent",
                  }}
                >
                  <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: on ? C.white : C.textSecond }}>
                    {lim}
                  </Typography>
                </Box>
              );
            })}
          </FieldLabelRow>
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <Txt label="QC note" value={form.qc.qc_note} onChange={(v) => patchIn("qc", { qc_note: v })} />
        </Box>
      </SectionBox>

      {/* ── Gene results — the clinical core ───────────────────────────────── */}
      {showGeneResults && (
        <SectionBox title="Gene results">
          {form.gene_results.length === 0 && (
            <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
              No gene results recorded. A gene listed on the panel but not analysed belongs
              in "no-call genes" above — it is not the same as a normal result.
            </Typography>
          )}

          {form.gene_results.map((r) => (
            <RowCard key={r.row_id} onRemove={() => removeGeneRow(r.row_id)} flagged={Boolean(r.carried_from)}>
              <Grid cols={4}>
                <SelF label="Gene" options={GENE_OPTIONS} value={r.gene} onChange={(v) => selectGene(r.row_id, v)} />
                <Txt label="Allele 1" placeholder="e.g. *1" value={r.allele_1} onChange={(v) => patchGeneRow(r.row_id, { allele_1: v })} />
                <Txt label="Allele 2" placeholder="e.g. *2A" value={r.allele_2} onChange={(v) => patchGeneRow(r.row_id, { allele_2: v })} />
                <Txt label="Diplotype" placeholder="e.g. *1/*2A" value={r.diplotype} onChange={(v) => patchGeneRow(r.row_id, { diplotype: v })} />
                <SelF label="Phenotype" options={CPIC_PHENOTYPES} value={r.phenotype} onChange={(v) => selectPhenotype(r.row_id, v)} />
                <Txt label="Activity score" placeholder="e.g. 1.0" value={r.activity_score} onChange={(v) => patchGeneRow(r.row_id, { activity_score: v })} />
                <SelF label="Guideline" options={PGX_GUIDELINE_SOURCES} value={r.guideline} onChange={(v) => patchGeneRow(r.row_id, { guideline: v })} />
                <Txt label="Guideline version" placeholder="CPIC revises dosing over time" value={r.guideline_version} onChange={(v) => patchGeneRow(r.row_id, { guideline_version: v })} />
                <SelF label="Evidence level" options={CPIC_EVIDENCE_LEVELS} value={r.evidence_level} onChange={(v) => patchGeneRow(r.row_id, { evidence_level: v })} />
                <SelF label="Dose implication" options={PGX_DOSE_ACTIONS} value={r.dose_implication} onChange={(v) => patchGeneRow(r.row_id, { dose_implication: v })} />
                <SelF label="Risk category" options={PGX_RISK_CATEGORIES} value={r.risk_category} onChange={(v) => patchGeneRow(r.row_id, { risk_category: v })} />
              </Grid>

              <CarriedNote carried={r.carried_from} current={r.phenotype} label={r.gene} />

              {geneNoteFor(r.gene) && (
                <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 1 }}>
                  {geneNoteFor(r.gene)}
                </Typography>
              )}

              <GuidanceNote row={r} />

              {geneRequiresCnv(r.gene) && (
                <Box sx={{ mt: 1.25, px: 1.5, py: 1, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
                  <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>
                    ⚠ <b>Copy number required</b> — this gene cannot be reported from a
                    short-read panel alone (whole-gene deletion and duplication are the
                    commonest false negatives). Confirm a CNV-capable assay was used, or
                    record it under assay limitations.
                  </Typography>
                </Box>
              )}

              <Box sx={{ mt: 1.5 }}>
                <ListField
                  label="Implicated drugs (comma-separated)"
                  value={r.implicated_drugs}
                  onChange={(v) => patchGeneRow(r.row_id, { implicated_drugs: v })}
                />
              </Box>
              <Box sx={{ mt: 1.5 }}>
                <Txt label="Recommendation" placeholder="e.g. Reduce starting dose by 50%" value={r.recommendation} onChange={(v) => patchGeneRow(r.row_id, { recommendation: v })} />
              </Box>
              <Box sx={{ mt: 1.5 }}>
                <Txt label="Note" value={r.note} onChange={(v) => patchGeneRow(r.row_id, { note: v })} />
              </Box>
            </RowCard>
          ))}

          <Button onClick={addGeneRow} sx={{ ...outlineBtnSx, px: 2.5 }}>
            <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add gene result
          </Button>
        </SectionBox>
      )}

      {/* ── HLA-mediated hypersensitivity ──────────────────────────────────── */}
      {showHla && (
        <SectionBox title="HLA results">
          {form.hla_results.length === 0 && (
            <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
              No HLA results recorded. HLA calls must be at allele level to be actionable.
            </Typography>
          )}

          {form.hla_results.map((r) => (
            <RowCard key={r.row_id} onRemove={() => removeHlaRow(r.row_id)} flagged={Boolean(r.carried_from)}>
              <Grid cols={4}>
                <SelF label="Allele" options={HLA_ALLELE_OPTIONS} value={r.allele} onChange={(v) => selectHlaAllele(r.row_id, v)} />
                <SelF label="Resolution" options={HLA_RESOLUTION_OPTIONS} value={r.resolution} onChange={(v) => patchHlaRow(r.row_id, { resolution: v })} />
                <SelF label="Typing method" options={HLA_TYPING_METHODS} value={r.method} onChange={(v) => patchHlaRow(r.row_id, { method: v })} />
                <SelF label="Result" options={HLA_RESULT_OPTIONS} value={r.result} onChange={(v) => patchHlaRow(r.row_id, { result: v })} />
                <Txt label="Drug" value={r.drug} onChange={(v) => patchHlaRow(r.row_id, { drug: v })} />
                <Txt label="Reaction" value={r.reaction} onChange={(v) => patchHlaRow(r.row_id, { reaction: v })} />
                <Txt label="Locus (other)" placeholder="if not in the list" value={r.locus} onChange={(v) => patchHlaRow(r.row_id, { locus: v })} />
                <Txt label="Note" value={r.note} onChange={(v) => patchHlaRow(r.row_id, { note: v })} />
              </Grid>

              <CarriedNote carried={r.carried_from} current={r.result} label={r.allele} />

              <Box sx={{ mt: 1.5 }}>
                <Txt label="Recommendation" placeholder="e.g. Avoid abacavir — use an alternative agent" value={r.recommendation} onChange={(v) => patchHlaRow(r.row_id, { recommendation: v })} />
              </Box>

              {r.resolution === LOW_RESOLUTION && (
                <Box sx={{ mt: 1.25, px: 1.5, py: 1, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
                  <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>
                    ⚠ <b>Not actionable at this resolution</b> — a group-level call such as
                    "B57 positive" does not distinguish B*57:01 (the risk allele) from
                    B*57:03 (which is not). Report an allele-level result before acting on it.
                  </Typography>
                </Box>
              )}
            </RowCard>
          ))}

          <Button onClick={addHlaRow} sx={{ ...outlineBtnSx, px: 2.5 }}>
            <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add HLA result
          </Button>
        </SectionBox>
      )}

      {/* ── G6PD ───────────────────────────────────────────────────────────── */}
      {showG6pd && (
        <SectionBox title="G6PD">
          {/* Flagged, not restructured. G6PD has no row card of its own — it is one
              section — so the section takes the same red mark the gene and HLA cards
              take, and the note inside says what the mark means. */}
          <Box sx={{ border: `1px solid ${form.g6pd.carried_from ? FLAG_COLOR : "transparent"}`, p: form.g6pd.carried_from ? 1.5 : 0 }}>
          <Grid cols={4}>
            <SelF label="Status" options={G6PD_STATUS_OPTIONS} value={form.g6pd.status} onChange={selectG6pdStatus} />
            <Txt label="Enzyme activity (%)" value={form.g6pd.activity_pct} onChange={(v) => patchG6pd({ activity_pct: v })} />
            <SelF label="Dose implication" options={PGX_DOSE_ACTIONS} value={form.g6pd.dose_implication} onChange={(v) => patchG6pd({ dose_implication: v })} />
            <Txt label="Note" value={form.g6pd.note} onChange={(v) => patchG6pd({ note: v })} />
          </Grid>
          <CarriedNote carried={form.g6pd.carried_from} current={form.g6pd.status} label="G6PD" />
          </Box>
          <Box sx={{ mt: 1.5 }}>
            <ListField
              label="Variants detected (comma-separated)"
              placeholder="e.g. G6PD Mediterranean, G6PD Orissa"
              value={form.g6pd.variants}
              onChange={(v) => patchG6pd({ variants: v })}
            />
          </Box>
          <Box sx={{ mt: 1.5 }}>
            <Txt
              label="Recommendation"
              placeholder="e.g. Avoid primaquine and dapsone — check G6PD status before each course"
              value={form.g6pd.recommendation}
              onChange={(v) => patchG6pd({ recommendation: v })}
            />
          </Box>
          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.75 }}>
            X-linked — hemizygous males are fully affected while heterozygous females may
            show intermediate activity. Drugs affected: {G6PD_AFFECTED_DRUGS.join(", ")}. A deficient
            status carries all of them onto the dosing summary below with the implication
            recorded here; a normal or indeterminate result carries nothing.
          </Typography>
        </SectionBox>
      )}

      {/* ── Derived toxicity & dosing summary ──────────────────────────────── */}
      <SectionBox title="Derived toxicity & dosing summary">
        <Box sx={{ border: `1px solid ${C.border}`, background: C.bgTertiary, px: 2, py: 1.5, mb: 2 }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.6 }}>
            {dosing.summary}
          </Typography>
        </Box>

        <Grid cols={3}>
          <Box>
            <FieldLabelRow label="Avoid">
              {dosing.drugsToAvoid.length === 0 ? (
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>—</Typography>
              ) : (
                dosing.drugsToAvoid.map((d) => (
                  <Box key={d} sx={{ px: 1.5, py: 0.6, mr: 1, mb: 1, background: C.black }}>
                    <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.white }}>{d}</Typography>
                  </Box>
                ))
              )}
            </FieldLabelRow>
          </Box>
          <Box>
            <FieldLabelRow label="Dose adjustment">
              {dosing.drugsToAdjust.length === 0 ? (
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>—</Typography>
              ) : (
                dosing.drugsToAdjust.map((d) => (
                  <Box key={d} sx={{ px: 1.5, py: 0.6, mr: 1, mb: 1, border: `1px solid ${C.black}` }}>
                    <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>{d}</Typography>
                  </Box>
                ))
              )}
            </FieldLabelRow>
          </Box>
          <Box>
            <FieldLabelRow label="Not analysed">
              {dosing.notAnalysed.length === 0 ? (
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>—</Typography>
              ) : (
                dosing.notAnalysed.map((g) => (
                  <Box key={g} sx={{ px: 1.5, py: 0.6, mr: 1, mb: 1, border: `1px dashed ${C.border}` }}>
                    <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted }}>{g}</Typography>
                  </Box>
                ))
              )}
            </FieldLabelRow>
          </Box>
        </Grid>

        {dosing.rows.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <FieldLabelRow label="Every recorded action">
              <Box sx={{ width: "100%" }}>
                {dosing.rows.map((r, i) => (
                  <Box
                    key={`${r.gene}-${r.drug}-${i}`}
                    sx={{
                      display: "flex", gap: 1.5, flexWrap: "wrap", py: 0.75,
                      borderBottom: `1px solid ${C.border}`,
                    }}
                  >
                    <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textPrimary, minWidth: 130 }}>
                      {r.drug || "—"}
                    </Typography>
                    <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted, minWidth: 160 }}>
                      {r.gene}{r.phenotype ? ` · ${r.phenotype}` : ""}
                    </Typography>
                    <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, flex: "1 1 220px" }}>
                      {r.action || "No action recorded"}
                    </Typography>
                    {/* WHY, on its own line under the action it explains. It is the
                        part of the row a reader can check against the guideline —
                        "Reduce starting dose" alone has to be taken on faith. */}
                    {r.reason && (
                      <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted, flex: "1 1 100%", lineHeight: 1.6 }}>
                        {r.reason}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </FieldLabelRow>
          </Box>
        )}

        {dosing.flags.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <FieldLabelRow label="Record issues to review">
              <Box sx={{ width: "100%" }}>
                {dosing.flags.map((f, i) => (
                  <Box
                    key={`${f.gene}-${f.type}-${i}`}
                    sx={{ px: 1.5, py: 1, mb: 1, border: `1px solid ${C.black}`, background: C.bgSecondary }}
                  >
                    <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>{f.text}</Typography>
                  </Box>
                ))}
              </Box>
            </FieldLabelRow>
          </Box>
        )}

        <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 2 }}>
          This summary aggregates what was recorded above. It does not derive dosing from
          phenotype — the correct action is drug-specific, so a phenotype alone cannot
          determine it. Where a row shows no recommendation of its own, the published
          rationale for that gene, drug and phenotype is shown in its place: it explains an
          action already recorded, it does not choose one. The prescribing decision remains
          with the treating clinician.
        </Typography>
      </SectionBox>

      {/* ── AI advisory ────────────────────────────────────────────────────── */}
      <SectionBox title="AI advisory assistant (advisory only)">
        <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
          Reads the recorded result and returns an advisory brief — what the genotype means for
          this patient's drugs, and what was <b>not</b> assessed. Phrased for review and for the
          treating clinician. Nothing here is written into the report, and the dose action stays
          the microbiologist's to choose.
        </Typography>
        <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1.5, flexWrap: "wrap" }}>
          <Button onClick={runAdvisory} disabled={advisoryLoading || !caseId} sx={{ ...outlineBtnSx, px: 2.5 }}>
            <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 18 }} /> {advisoryLoading ? "Generating…" : "Run AI Advisory"}
          </Button>
          {advisory && (
            // The TIMESTAMP is what belongs on screen: a brief kept from weeks ago
            // describes a result that may since have changed, so when it was
            // generated travels with the text. `engine_version` is stored for audit
            // but deliberately not shown — it names the model and prompt revision,
            // which is an implementation detail, not something a clinician needs.
            <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
              generated {new Date(advisory.run_at).toLocaleString()}
              {advisoryKept ? " · kept for reference" : ""}
            </Typography>
          )}
        </Box>
        {advisoryLoading && (
          <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>
            Consulting the pharmacogenomics advisory engine…
          </Typography>
        )}
        {advisory && !advisoryLoading && <PgxBrief advisory={advisory} />}
      </SectionBox>

      {/* ── Report ─────────────────────────────────────────────────────────── */}
      <SectionBox title="Report">
        <Grid cols={2}>
          <Txt label="Report status" value={form.report.status} onChange={(v) => patchIn("report", { status: v })} />
        </Grid>
        <Box sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            multiline
            rows={3}
            sx={inputSx}
            placeholder="Report body — gene, result and recommended action, in reporting order"
            value={form.report.body}
            onChange={(e) => patchIn("report", { body: e.target.value })}
          />
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            multiline
            rows={2}
            sx={inputSx}
            placeholder="Plain-language summary for the patient — no counsellor will explain this result"
            value={form.report.patient_summary}
            onChange={(e) => patchIn("report", { patient_summary: e.target.value })}
          />
        </Box>
        <Box sx={{ mt: 1.5 }}>
          <TextField
            size="small"
            fullWidth
            multiline
            rows={2}
            sx={inputSx}
            placeholder="Limitations — what this panel did NOT assess"
            value={form.report.limitations_note}
            onChange={(e) => patchIn("report", { limitations_note: e.target.value })}
          />
        </Box>
      </SectionBox>

      {notice && (
        <Box sx={{ mb: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1, alignItems: "center" }}>
        <Button onClick={save} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Human Genomics"}
        </Button>
      </Box>
    </Box>
  );
}

