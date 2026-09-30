// tabs/genomics/MngsPanel.jsx — Tab 15 / mNGS
//
// Metagenomic sequencing of the raw specimen — no culture, no prior target.
// Everything in the sample is sequenced, so the output is a RANKED organism list
// rather than a single identification, and the background model is what stops a
// skin-flora contaminant being read as a pathogen.
//
// Two things this panel deliberately keeps apart:
//   • Virus hits have their own table. What matters for a virus is genome
//     coverage and depth, not read abundance, and only this row type carries
//     antiviral resistance markers.
//   • AMR genes come from the TOTAL microbial reads and cannot be attributed to
//     a specific organism. The row says so, because a gene pinned to the wrong
//     organism is a real prescribing error.

import React from "react";
import { Box, Typography, TextField, Button } from "@mui/material";
import { AddRounded, SendRounded } from "@mui/icons-material";
import { C, FONT, inputSx, outlineBtnSx } from "../../../shared/designTokens";
import { Grid, Txt, SelF, Block, RowCard, ListField } from "./fields";
import {
  GENOMICS_PLATFORMS,
  SEQUENCING_LABS,
  MNGS_PIPELINES,
  MNGS_KINGDOMS,
  MNGS_BACKGROUND_OPTIONS,
  MNGS_CLINICAL_SIGNIFICANCE,
  MNGS_INPUT_OPTIONS,
  HOST_DEPLETION_OPTIONS,
  PREDICTED_PHENOTYPE_OPTIONS,
  RESISTANCE_GENE_CLASSES,
  RESISTANCE_MECHANISMS,
  AMR_GENE_DATABASES,
  SPECIMEN_TYPE_OPTIONS,
  TAXON_RANK_OPTIONS,
} from "../../constants";
import { blankOrganismHit, blankVirusHit, blankAmrGene } from "./records";

// The standing caveat on every mNGS AMR row. Offered as a one-click fill rather
// than pre-filled, so a gene that genuinely can be attributed does not have to
// carry a misleading note.
const UNATTRIBUTED_NOTE = "Detected in total microbial reads — cannot be attributed to a specific organism";

export default function MngsPanel({ record, onPatch, onSendPreliminary, isSaving }) {
  if (!record) return null;

  const r = record;

  // Organism and virus rows key on hit_id; the AMR rows key on row_id. One
  // accessor lets all three tables share the same helpers.
  const rowIdOf = (row) => row.row_id || row.hit_id;

  const addRow = (key, blank) => onPatch({ [key]: [...(r[key] || []), blank()] });

  const patchRow = (key, row, patch) => {
    const id = rowIdOf(row);
    onPatch({ [key]: (r[key] || []).map((x) => (rowIdOf(x) === id ? { ...x, ...patch } : x)) });
  };

  const removeRow = (key, row) => {
    const id = rowIdOf(row);
    onPatch({ [key]: (r[key] || []).filter((x) => rowIdOf(x) !== id) });
  };

  return (
    <Box>
      {/* ── Specimen & library prep ────────────────────────────────────────── */}
      <Block>Specimen &amp; library prep</Block>
      <Grid cols={3}>
        <SelF label="Specimen type" options={SPECIMEN_TYPE_OPTIONS} value={r.specimen_type} onChange={(v) => onPatch({ specimen_type: v })} />
        <SelF label="Nucleic acid input" options={MNGS_INPUT_OPTIONS} value={r.input_type} onChange={(v) => onPatch({ input_type: v })} />
        <SelF label="Host depletion" options={HOST_DEPLETION_OPTIONS} value={r.host_depletion} onChange={(v) => onPatch({ host_depletion: v })} />
        <Txt label="Submitted by (technical)" value={r.technical_name} onChange={(v) => onPatch({ technical_name: v })} />
        <Txt label="Submitted at" type="datetime-local" value={r.submitted_at} onChange={(v) => onPatch({ submitted_at: v })} />
        <Txt label="Result received at" type="datetime-local" value={r.result_received_at} onChange={(v) => onPatch({ result_received_at: v })} />
      </Grid>

      {/* ── Sequencing & pipeline QC ───────────────────────────────────────── */}
      <Block>Sequencing &amp; pipeline QC</Block>
      <Grid cols={4}>
        <SelF label="Platform" options={GENOMICS_PLATFORMS} value={r.platform} onChange={(v) => onPatch({ platform: v })} />
        <SelF label="Sequencing laboratory" options={SEQUENCING_LABS} value={r.sequencing_lab} onChange={(v) => onPatch({ sequencing_lab: v })} />
        <Txt label="External lab reference" value={r.sequencing_lab_ref} onChange={(v) => onPatch({ sequencing_lab_ref: v })} />
        <Txt label="Result file reference" value={r.result_file_ref} onChange={(v) => onPatch({ result_file_ref: v })} />
        <SelF label="Pipeline" options={MNGS_PIPELINES} value={r.pipeline_name} onChange={(v) => onPatch({ pipeline_name: v })} />
        <Txt label="Pipeline version" placeholder="required for ISO 15189 traceability" value={r.pipeline_version} onChange={(v) => onPatch({ pipeline_version: v })} />
        <Txt label="Total reads" value={r.total_reads} onChange={(v) => onPatch({ total_reads: v })} />
        <Txt label="Reads after QC" value={r.reads_after_qc} onChange={(v) => onPatch({ reads_after_qc: v })} />
        <Txt label="Host reads (%)" value={r.host_reads_pct} onChange={(v) => onPatch({ host_reads_pct: v })} />
        <Txt label="Non-host reads" value={r.non_host_reads} onChange={(v) => onPatch({ non_host_reads: v })} />
      </Grid>
      <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.75 }}>
        A high host-read fraction narrows what the run can detect — interpret a negative
        result against it, not in isolation.
      </Typography>

      {/* ── Organism hits — the main clinical output ───────────────────────── */}
      <Block>Organism hits</Block>
      {(r.organism_hits || []).length === 0 && (
        <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1 }}>
          No organism hits recorded. Record only hits above the significance threshold —
          the full output is reviewed at the bench, not transcribed here.
        </Typography>
      )}
      {(r.organism_hits || []).map((h) => (
        <RowCard key={h.hit_id} onRemove={() => removeRow("organism_hits", h)}>
          <Grid cols={3}>
            <Txt label="Taxon" placeholder="genus + species" value={h.taxon_name} onChange={(v) => patchRow("organism_hits", h, { taxon_name: v })} />
            <SelF label="Rank" options={TAXON_RANK_OPTIONS} value={h.taxon_rank} onChange={(v) => patchRow("organism_hits", h, { taxon_rank: v })} />
            <SelF label="Kingdom" options={MNGS_KINGDOMS} value={h.kingdom} onChange={(v) => patchRow("organism_hits", h, { kingdom: v })} />
            <Txt label="RPM (reads per million)" value={h.rpm} onChange={(v) => patchRow("organism_hits", h, { rpm: v })} />
            <Txt label="NT coverage (×)" value={h.nt_coverage} onChange={(v) => patchRow("organism_hits", h, { nt_coverage: v })} />
            <Txt label="NR coverage" value={h.nr_coverage} onChange={(v) => patchRow("organism_hits", h, { nr_coverage: v })} />
            <SelF label="Background model" options={MNGS_BACKGROUND_OPTIONS} value={h.background_model} onChange={(v) => patchRow("organism_hits", h, { background_model: v })} />
            <SelF label="Clinical significance" options={MNGS_CLINICAL_SIGNIFICANCE} value={h.clinical_significance} onChange={(v) => patchRow("organism_hits", h, { clinical_significance: v })} />
            <Txt label="Significance note" value={h.significance_note} onChange={(v) => patchRow("organism_hits", h, { significance_note: v })} />
          </Grid>
        </RowCard>
      ))}
      <Button onClick={() => addRow("organism_hits", blankOrganismHit)} sx={{ ...outlineBtnSx, px: 2.5 }}>
        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add organism hit
      </Button>

      {/* ── Virus hits ─────────────────────────────────────────────────────── */}
      <Block>Virus hits</Block>
      {(r.virus_hits || []).map((v) => (
        <RowCard key={v.hit_id} onRemove={() => removeRow("virus_hits", v)}>
          <Grid cols={3}>
            <Txt label="Virus" value={v.virus_name} onChange={(x) => patchRow("virus_hits", v, { virus_name: x })} />
            <Txt label="Genome coverage (%)" value={v.genome_coverage_pct} onChange={(x) => patchRow("virus_hits", v, { genome_coverage_pct: x })} />
            <Txt label="Mean depth (×)" value={v.mean_depth} onChange={(x) => patchRow("virus_hits", v, { mean_depth: x })} />
            <Txt label="Clinical note" value={v.clinical_note} onChange={(x) => patchRow("virus_hits", v, { clinical_note: x })} />
          </Grid>
          <Box sx={{ mt: 1.5 }}>
            <ListField
              label="Antiviral resistance markers (comma-separated)"
              placeholder="e.g. M184V, K103N"
              value={v.antiviral_resistance_markers}
              onChange={(x) => patchRow("virus_hits", v, { antiviral_resistance_markers: x })}
            />
          </Box>
        </RowCard>
      ))}
      <Button onClick={() => addRow("virus_hits", blankVirusHit)} sx={{ ...outlineBtnSx, px: 2.5 }}>
        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add virus hit
      </Button>

      {/* ── AMR genes from mNGS ────────────────────────────────────────────── */}
      <Block>AMR genes detected (from total microbial reads)</Block>
      {(r.amr_genes_detected || []).map((g) => (
        <RowCard key={g.row_id} onRemove={() => removeRow("amr_genes_detected", g)}>
          <Grid cols={3}>
            <Txt label="Gene" value={g.gene_name} onChange={(v) => patchRow("amr_genes_detected", g, { gene_name: v })} />
            <SelF label="Class" options={RESISTANCE_GENE_CLASSES} value={g.gene_class} onChange={(v) => patchRow("amr_genes_detected", g, { gene_class: v })} />
            <SelF label="Mechanism" options={RESISTANCE_MECHANISMS} value={g.mechanism} onChange={(v) => patchRow("amr_genes_detected", g, { mechanism: v })} />
            <SelF label="Database" options={AMR_GENE_DATABASES} value={g.database_source} onChange={(v) => patchRow("amr_genes_detected", g, { database_source: v })} />
            <Txt label="Database version" value={g.card_version} onChange={(v) => patchRow("amr_genes_detected", g, { card_version: v })} />
            <SelF label="Predicted phenotype" options={PREDICTED_PHENOTYPE_OPTIONS} value={g.predicted_phenotype} onChange={(v) => patchRow("amr_genes_detected", g, { predicted_phenotype: v })} />
          </Grid>
          <Box sx={{ mt: 1.5, display: "flex", alignItems: "flex-end", gap: 1.5 }}>
            <Box sx={{ flex: 1 }}>
              <Txt label="Attribution note" value={g.note} onChange={(v) => patchRow("amr_genes_detected", g, { note: v })} />
            </Box>
            {!g.note && (
              <Button
                onClick={() => patchRow("amr_genes_detected", g, { note: UNATTRIBUTED_NOTE })}
                sx={{ ...outlineBtnSx, py: 0.5, px: 1.5, fontSize: 11, mb: 0.25 }}
              >
                Cannot be attributed
              </Button>
            )}
          </Box>
        </RowCard>
      ))}
      <Button onClick={() => addRow("amr_genes_detected", blankAmrGene)} sx={{ ...outlineBtnSx, px: 2.5 }}>
        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add AMR gene
      </Button>

      {/* ── Interpretation & dispatch ──────────────────────────────────────── */}
      <Block>Interpretation</Block>
      <TextField
        size="small"
        fullWidth
        multiline
        rows={3}
        sx={inputSx}
        placeholder="Microbiologist's assessment of these findings in the clinical context"
        value={r.interpretation_note}
        onChange={(e) => onPatch({ interpretation_note: e.target.value })}
      />

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
