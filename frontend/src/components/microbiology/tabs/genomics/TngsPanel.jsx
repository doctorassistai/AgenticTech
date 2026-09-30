// tabs/genomics/TngsPanel.jsx — Tab 15 / TB targeted NGS
//
// Amplicon sequencing of curated M. tuberculosis resistance loci. The 2025 WHO
// pathway places tNGS AFTER a nucleic-acid test, so the prior GeneXpert result is
// part of the record, not context.
//
// The clinical core is the per-drug resistance call table. Each call cites a WHO
// Mutation Catalogue confidence group, and the DS/RR/MDR/pre-XDR/XDR
// classification is DERIVED from the calls (deriveTbClassification in
// constants.js) — never typed by hand, so the badge and the table cannot drift.
//
// Heteroresistance is derived from the variant allele frequency: a VAF between
// 10% and 75% means a mixed population — part of the bacilli carry the mutation
// and part do not, so a single-colony phenotypic DST can miss it.

import React from "react";
import { Box, Typography, TextField, Button } from "@mui/material";
import { AddRounded, SendRounded } from "@mui/icons-material";
import { C, FONT, inputSx, outlineBtnSx } from "../../../shared/designTokens";
import { Grid, Txt, SelF, Block, RowCard, ListField, YES_NO, classificationFill } from "./fields";
import {
  GENOMICS_PLATFORMS,
  SEQUENCING_LABS,
  WGS_PIPELINES,
  TNGS_ASSAYS,
  SPECIMEN_INPUT_TYPES,
  TNGS_DRUG_PANEL,
  WHO_TB_CONFIDENCE_GROUPS,
  PREDICTED_PHENOTYPE_OPTIONS,
  GENOTYPE_PHENOTYPE_CONCORDANCE,
  TB_REGIMEN_SUGGESTIONS,
  GENEXPERT_RESULT_OPTIONS,
  GENEXPERT_RIF_OPTIONS,
  deriveTbClassification,
} from "../../constants";
import { blankResistanceCall } from "./records";
import { genexpertMismatches, deriveHeteroresistance } from "../../shared/genomics";

// TB classifications that trigger a public-health notification — the same list
// Tab 13 auto-detects on and Tab 15 flags at dispatch.
const NOTIFIABLE_TB = ["MDR-TB", "pre-XDR-TB", "XDR-TB"];

export default function TngsPanel({ record, onPatch, onSendPreliminary, isSaving, tab8Genexpert }) {
  if (!record) return null;

  const r = record;
  const calls = r.drug_resistance_calls || [];

  // What Tab 8 actually holds for this specimen, mapped into this panel's
  // vocabulary (null when there is nothing conclusive to compare).
  const mismatches = genexpertMismatches(r.prior_genexpert, tab8Genexpert);

  // Every mutation to the call table recomputes the classification, so the badge
  // can never disagree with the rows it sits above.
  const setCalls = (rows) =>
    onPatch({ drug_resistance_calls: rows, tb_classification: deriveTbClassification(rows) });

  const patchCall = (callId, patch) =>
    setCalls(calls.map((c) => (c.call_id === callId ? { ...c, ...patch } : c)));

  // VAF implies heteroresistance; derived on entry so it cannot be forgotten.
  // The bounds live with the derivation (shared/genomics.js) so a dictated call
  // and a typed one cannot disagree.
  const setVaf = (callId, vaf) => {
    const het = deriveHeteroresistance(vaf);
    patchCall(callId, het ? { vaf_pct: vaf, heteroresistance: het } : { vaf_pct: vaf });
  };

  const notifiable = NOTIFIABLE_TB.includes(r.tb_classification || "");
  const suggestion = TB_REGIMEN_SUGGESTIONS[r.tb_classification] || "";

  return (
    <Box>
      {/* ── Order & sequencing run ─────────────────────────────────────────── */}
      <Block>Order &amp; sequencing run</Block>
      <Grid cols={3}>
        <Txt label="Submitted by (technical)" value={r.technical_name} onChange={(v) => onPatch({ technical_name: v })} />
        <Txt label="Submitted at" type="datetime-local" value={r.submitted_at} onChange={(v) => onPatch({ submitted_at: v })} />
        <SelF label="Specimen input" options={SPECIMEN_INPUT_TYPES} value={r.specimen_input} onChange={(v) => onPatch({ specimen_input: v })} />
        <SelF label="Platform" options={GENOMICS_PLATFORMS} value={r.platform} onChange={(v) => onPatch({ platform: v })} />
        <SelF label="Sequencing laboratory" options={SEQUENCING_LABS} value={r.sequencing_lab} onChange={(v) => onPatch({ sequencing_lab: v })} />
        <Txt label="External lab reference" value={r.sequencing_lab_ref} onChange={(v) => onPatch({ sequencing_lab_ref: v })} />
        <Txt label="Result received at" type="datetime-local" value={r.result_received_at} onChange={(v) => onPatch({ result_received_at: v })} />
        <Txt label="Result file reference" value={r.result_file_ref} onChange={(v) => onPatch({ result_file_ref: v })} />
      </Grid>

      {/* ── Prior aNAAT — the WHO pathway requires it before tNGS ──────────── */}
      <Block>Prior nucleic-acid test (WHO pathway)</Block>
      <Grid cols={3}>
        <SelF
          label="GeneXpert MTB/RIF result"
          options={GENEXPERT_RESULT_OPTIONS}
          value={r.prior_genexpert?.result}
          onChange={(v) => onPatch({ prior_genexpert: { ...r.prior_genexpert, result: v } })}
        />
        <SelF
          label="Rifampicin resistance"
          options={GENEXPERT_RIF_OPTIONS}
          value={r.prior_genexpert?.rif_resistance}
          onChange={(v) => onPatch({ prior_genexpert: { ...r.prior_genexpert, rif_resistance: v } })}
        />
        <Txt
          label="Performed at"
          type="datetime-local"
          value={r.prior_genexpert?.performed_at}
          onChange={(v) => onPatch({ prior_genexpert: { ...r.prior_genexpert, performed_at: v } })}
        />
      </Grid>
      <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.75 }}>
        {tab8Genexpert
          ? `Cross-checked against the ${tab8Genexpert.assay} result recorded in Tab 8 for this specimen.`
          : "Recorded for the pathway audit trail. Tab 8 holds no GeneXpert result for this specimen to cross-check against."}
      </Typography>

      {mismatches.length > 0 && (
        <Box sx={{ mt: 1.25, px: 1.5, py: 1, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
          <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>
            ⚠ <b>Disagrees with Tab 8</b> — {mismatches.join(" and ")}{" "}
            {mismatches.length > 1 ? "differ" : "differs"} from the GeneXpert result recorded there (
            {tab8Genexpert.result}
            {tab8Genexpert.rif_resistance ? `, ${tab8Genexpert.rif_resistance}` : ""}). A repeat test
            or a different specimen may explain it — check which is current before dispatching.
          </Typography>
        </Box>
      )}

      {/* ── Assay & pipeline ───────────────────────────────────────────────── */}
      <Block>Assay &amp; pipeline</Block>
      <Grid cols={4}>
        <SelF label="Assay" options={TNGS_ASSAYS} value={r.assay_name} onChange={(v) => onPatch({ assay_name: v })} />
        <Txt label="Assay version" value={r.assay_version} onChange={(v) => onPatch({ assay_version: v })} />
        <SelF label="Pipeline" options={WGS_PIPELINES} value={r.pipeline_name} onChange={(v) => onPatch({ pipeline_name: v })} />
        <Txt label="Pipeline version" placeholder="required for ISO 15189 traceability" value={r.pipeline_version} onChange={(v) => onPatch({ pipeline_version: v })} />
      </Grid>

      {/* ── QC ─────────────────────────────────────────────────────────────── */}
      <Block>QC</Block>
      <Grid cols={4}>
        <Txt label="Mean depth of coverage (×)" placeholder="≥50× per locus recommended" value={r.mean_depth_coverage} onChange={(v) => onPatch({ mean_depth_coverage: v })} />
        <Txt label="Loci above threshold (%)" value={r.loci_above_threshold_pct} onChange={(v) => onPatch({ loci_above_threshold_pct: v })} />
        <SelF label="QC pass" options={YES_NO} value={r.qc_pass} onChange={(v) => onPatch({ qc_pass: v })} />
        <Txt label="QC note" value={r.qc_note} onChange={(v) => onPatch({ qc_note: v })} />
      </Grid>

      {/* ── Drug resistance calls — the clinical core ──────────────────────── */}
      <Block>Drug resistance calls</Block>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5, flexWrap: "wrap" }}>
        <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.06em" }}>
          Derived classification
        </Typography>
        <Box sx={{ px: 2, py: 0.75, ...classificationFill(r.tb_classification) }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, letterSpacing: "0.05em" }}>
            {r.tb_classification || "—"}
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
          Derived from the rows below — not typed.
        </Typography>
      </Box>

      {calls.length === 0 && (
        <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1 }}>
          No resistance calls recorded. A call at WHO Group 3 (uncertain significance) is
          still a call — record it rather than leaving the row blank.
        </Typography>
      )}

      {calls.map((c) => (
        <RowCard key={c.call_id} onRemove={() => setCalls(calls.filter((x) => x.call_id !== c.call_id))}>
          <Grid cols={4}>
            <SelF label="Drug" options={TNGS_DRUG_PANEL} value={c.drug} onChange={(v) => patchCall(c.call_id, { drug: v })} />
            <SelF label="Predicted phenotype" options={PREDICTED_PHENOTYPE_OPTIONS} value={c.predicted_phenotype} onChange={(v) => patchCall(c.call_id, { predicted_phenotype: v })} />
            <SelF label="WHO confidence group" options={WHO_TB_CONFIDENCE_GROUPS} value={c.who_confidence_tier} onChange={(v) => patchCall(c.call_id, { who_confidence_tier: v })} />
            <Txt label="VAF (%)" placeholder="10–75% suggests heteroresistance" value={c.vaf_pct} onChange={(v) => setVaf(c.call_id, v)} />
          </Grid>
          <Box sx={{ mt: 1.5 }}>
            <ListField
              label="Mutations detected (comma-separated)"
              placeholder="e.g. rpoB S450L, katG S315T"
              value={c.mutations_detected}
              onChange={(v) => patchCall(c.call_id, { mutations_detected: v })}
            />
          </Box>
          {c.heteroresistance === "Yes" && (
            <Box sx={{ mt: 1.25, px: 1.5, py: 1, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
              <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>
                ⚠ <b>Heteroresistance</b> — VAF {c.vaf_pct}% implies a mixed population. Part
                of the bacilli carry this mutation, so a single-colony phenotypic DST may
                miss it.
              </Typography>
            </Box>
          )}
        </RowCard>
      ))}
      <Button onClick={() => setCalls([...calls, blankResistanceCall()])} sx={{ ...outlineBtnSx, px: 2.5 }}>
        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add drug call
      </Button>

      {/* ── Lineage ────────────────────────────────────────────────────────── */}
      <Block>Lineage</Block>
      <Grid cols={2}>
        <Txt label="WHO lineage" placeholder="e.g. L2.2 (Beijing)" value={r.lineage} onChange={(v) => onPatch({ lineage: v })} />
        <SelF label="Lineage tool" options={WGS_PIPELINES} value={r.lineage_tool} onChange={(v) => onPatch({ lineage_tool: v })} />
      </Grid>

      {/* ── Concordance with phenotypic DST ────────────────────────────────── */}
      <Block>Concordance with phenotypic DST</Block>
      <Grid cols={2}>
        <SelF label="Concordance" options={GENOTYPE_PHENOTYPE_CONCORDANCE} value={r.concordance_with_phenotypic_dst} onChange={(v) => onPatch({ concordance_with_phenotypic_dst: v })} />
        <Txt label="Concordance note" value={r.concordance_note} onChange={(v) => onPatch({ concordance_note: v })} />
      </Grid>

      {/* ── Regimen note — advisory, never auto-written ────────────────────── */}
      <Block>Regimen note (advisory)</Block>
      <TextField
        size="small"
        fullWidth
        multiline
        rows={3}
        sx={inputSx}
        placeholder="Advisory regimen implication — the treatment decision belongs to the treating clinician"
        value={r.who_regimen_note}
        onChange={(e) => onPatch({ who_regimen_note: e.target.value })}
      />
      {suggestion && (
        <Box sx={{ mt: 1, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, flex: "1 1 320px" }}>
            Suggested for {r.tb_classification}: {suggestion}
          </Typography>
          <Button onClick={() => onPatch({ who_regimen_note: suggestion })} sx={{ ...outlineBtnSx, py: 0.5, px: 1.5, fontSize: 11 }}>
            Use suggestion
          </Button>
        </Box>
      )}

      {notifiable && (
        <Box sx={{ mt: 1.5, px: 2, py: 1.25, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
          <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
            ⚠ <b>Notifiable</b> — {r.tb_classification} detected by tNGS. Public-health
            notification required; dispatch a preliminary and record it in Tab 13.
          </Typography>
        </Box>
      )}

      <Box sx={{ mt: 1.5, display: "flex", justifyContent: "flex-end", gap: 1, alignItems: "center" }}>
        {r.prelim && (
          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
            Preliminary v{r.prelim.version} dispatched{" "}
            {r.prelim.dispatched_at ? new Date(r.prelim.dispatched_at).toLocaleString() : ""}
          </Typography>
        )}
        <Button onClick={onSendPreliminary} disabled={isSaving} sx={{ ...outlineBtnSx, py: 0.6, px: 2, fontSize: 11 }}>
          <SendRounded sx={{ mr: 0.5, fontSize: 14 }} /> Send Preliminary
        </Button>
      </Box>
    </Box>
  );
}
