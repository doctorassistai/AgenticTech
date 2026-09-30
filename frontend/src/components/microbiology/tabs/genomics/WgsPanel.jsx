// tabs/genomics/WgsPanel.jsx — Tab 15 / WGS
//
// Whole genome sequencing of a pure culture isolate: identifies the organism,
// types the strain (MLST / spa / SCCmec / serotype / clade), and enumerates the
// resistance and virulence determinants it carries.
//
// Two safety rules this panel encodes:
//   1. A resistance call is always PREDICTED. Phenotypic AST stays the reference,
//      so every record carries a genotype↔phenotype concordance field.
//   2. A call without a confidence tier is not reportable as resistant —
//      "Uncertain significance" is a first-class outcome, not a blank.
//
// The TB drug profile block renders only when the identified species is MTBC
// (see isMtbcSpecies in constants.js), and its DS/RR/MDR/pre-XDR/XDR
// classification is DERIVED from the profile rows rather than typed, so the
// badge and the table cannot drift.

import React from "react";
import { Box, Typography, TextField, Button } from "@mui/material";
import { AddRounded, SendRounded } from "@mui/icons-material";
import { C, FONT, inputSx, outlineBtnSx } from "../../../shared/designTokens";
import { Grid, Txt, SelF, Block, RowCard, ListField, YES_NO, classificationFill } from "./fields";
import {
  GENOMICS_PLATFORMS,
  SEQUENCING_LABS,
  WGS_PIPELINES,
  SPECIMEN_INPUT_TYPES,
  ID_TOOL_OPTIONS,
  ID_RESOLUTION_LEVELS,
  IDENTIFICATION_CONFIDENCE_OPTIONS,
  TYPING_SCHEMES,
  AMR_GENE_DATABASES,
  RESISTANCE_GENE_CLASSES,
  RESISTANCE_MECHANISMS,
  CARD_CONFIDENCE,
  PREDICTED_PHENOTYPE_OPTIONS,
  GENOTYPE_PHENOTYPE_CONCORDANCE,
  VIRULENCE_GENE_CATEGORIES,
  EPIDEMIOLOGICAL_LINK_OPTIONS,
  WHO_TB_CONFIDENCE_GROUPS,
  TNGS_DRUG_PANEL,
  isMtbcSpecies,
  deriveTbClassification,
} from "../../constants";
import {
  blankResistanceGene,
  blankVirulenceGene,
  blankPlasmidReplicon,
  blankTbProfileRow,
} from "./records";

export default function WgsPanel({ record, onPatch, onSendPreliminary, isSaving }) {
  if (!record) return null;

  const r = record;
  const mtbc = isMtbcSpecies(r.identified_species);

  // TB profile mutations go through one setter so the stored classification is
  // always exactly what the rows imply — there is no hand-typed path to it.
  const setTbProfile = (rows) =>
    onPatch({
      tb_drug_resistance_profile: rows,
      tb_resistance_classification: deriveTbClassification(rows),
    });

  const patchTbRow = (rowId, patch) =>
    setTbProfile(
      (r.tb_drug_resistance_profile || []).map((row) =>
        row.row_id === rowId ? { ...row, ...patch } : row
      )
    );

  const patchRow = (key, rowId, patch) =>
    onPatch({ [key]: (r[key] || []).map((row) => (row.row_id === rowId ? { ...row, ...patch } : row)) });

  const addRow = (key, blank) => onPatch({ [key]: [...(r[key] || []), blank()] });

  const removeRow = (key, rowId) =>
    onPatch({ [key]: (r[key] || []).filter((row) => row.row_id !== rowId) });

  return (
    <Box>
      {/* ── Order & sequencing run ─────────────────────────────────────────── */}
      <Block>Order &amp; sequencing run</Block>
      <Grid cols={3}>
        <Txt label="Submitted by (technical)" value={r.technical_name} onChange={(v) => onPatch({ technical_name: v })} />
        <Txt label="Submitted at" type="datetime-local" value={r.submitted_at} onChange={(v) => onPatch({ submitted_at: v })} />
        <SelF label="Specimen input" options={SPECIMEN_INPUT_TYPES} value={r.specimen_input} onChange={(v) => onPatch({ specimen_input: v })} />
        <SelF label="Platform" options={GENOMICS_PLATFORMS} value={r.platform} onChange={(v) => onPatch({ platform: v })} />
        <Txt label="Run / flowcell ID" value={r.run_id} onChange={(v) => onPatch({ run_id: v })} />
        <SelF label="Sequencing laboratory" options={SEQUENCING_LABS} value={r.sequencing_lab} onChange={(v) => onPatch({ sequencing_lab: v })} />
        <Txt label="External lab reference" value={r.sequencing_lab_ref} onChange={(v) => onPatch({ sequencing_lab_ref: v })} />
        <Txt label="Result received at" type="datetime-local" value={r.result_received_at} onChange={(v) => onPatch({ result_received_at: v })} />
        <Txt label="Result file reference" value={r.result_file_ref} onChange={(v) => onPatch({ result_file_ref: v })} />
      </Grid>

      {/* ── Sample QC (pre-sequencing) ─────────────────────────────────────── */}
      <Block>Sample QC</Block>
      <Grid cols={4}>
        <Txt label="DNA extraction method" value={r.dna_extraction_method} onChange={(v) => onPatch({ dna_extraction_method: v })} />
        <Txt label="DNA concentration (ng/µL)" value={r.dna_concentration} onChange={(v) => onPatch({ dna_concentration: v })} />
        <Txt label="A260/280" placeholder="1.8–2.0 acceptable" value={r.a260_280} onChange={(v) => onPatch({ a260_280: v })} />
        <SelF label="Extraction QC" options={YES_NO} value={r.extraction_qc_pass} onChange={(v) => onPatch({ extraction_qc_pass: v })} />
      </Grid>

      {/* ── Pipeline & assembly QC ─────────────────────────────────────────── */}
      <Block>Pipeline &amp; assembly QC</Block>
      <Grid cols={4}>
        <SelF label="Pipeline" options={WGS_PIPELINES} value={r.pipeline_name} onChange={(v) => onPatch({ pipeline_name: v })} />
        <Txt label="Pipeline version" placeholder="required for ISO 15189 traceability" value={r.pipeline_version} onChange={(v) => onPatch({ pipeline_version: v })} />
        <Txt label="Reference genome" placeholder="e.g. M. tuberculosis H37Rv NC_000962.3" value={r.reference_genome} onChange={(v) => onPatch({ reference_genome: v })} />
        <SelF label="Assembly QC" options={YES_NO} value={r.assembly_qc_pass} onChange={(v) => onPatch({ assembly_qc_pass: v })} />
        <Txt label="Total reads" value={r.total_reads} onChange={(v) => onPatch({ total_reads: v })} />
        <Txt label="Reads after QC" value={r.reads_after_qc} onChange={(v) => onPatch({ reads_after_qc: v })} />
        <Txt label="Mean coverage (×)" value={r.mean_coverage} onChange={(v) => onPatch({ mean_coverage: v })} />
        <Txt label="Coverage breadth (% at ≥10×)" value={r.coverage_breadth_pct} onChange={(v) => onPatch({ coverage_breadth_pct: v })} />
      </Grid>
      <Box sx={{ mt: 1.5 }}>
        <Txt label="QC note (borderline / fail reason)" value={r.assembly_qc_note} onChange={(v) => onPatch({ assembly_qc_note: v })} />
      </Box>

      {/* ── Identification ─────────────────────────────────────────────────── */}
      <Block>Organism identification</Block>
      <Grid cols={3}>
        <Txt label="Identified species" placeholder="genus + species" value={r.identified_species} onChange={(v) => onPatch({ identified_species: v })} />
        <SelF label="Resolution" options={ID_RESOLUTION_LEVELS} value={r.id_resolution} onChange={(v) => onPatch({ id_resolution: v })} />
        <SelF label="Identification confidence" options={IDENTIFICATION_CONFIDENCE_OPTIONS} value={r.identification_confidence} onChange={(v) => onPatch({ identification_confidence: v })} />
        <SelF label="ID tool" options={ID_TOOL_OPTIONS} value={r.id_tool} onChange={(v) => onPatch({ id_tool: v })} />
        <Txt label="ID tool version" value={r.id_tool_version} onChange={(v) => onPatch({ id_tool_version: v })} />
      </Grid>

      {/* ── Strain typing ──────────────────────────────────────────────────── */}
      <Block>Strain typing</Block>
      <Grid cols={4}>
        <Txt label="Sequence type" placeholder="e.g. ST131" value={r.sequence_type} onChange={(v) => onPatch({ sequence_type: v })} />
        <SelF label="MLST scheme" options={TYPING_SCHEMES} value={r.mlst_scheme} onChange={(v) => onPatch({ mlst_scheme: v })} />
        <Txt label="Clonal complex" placeholder="e.g. CC8" value={r.clonal_complex} onChange={(v) => onPatch({ clonal_complex: v })} />
        <Txt label="Clade" placeholder="e.g. C. auris clade I" value={r.clade} onChange={(v) => onPatch({ clade: v })} />
        <Txt label="spa type" value={r.spa_type} onChange={(v) => onPatch({ spa_type: v })} />
        <Txt label="SCCmec" value={r.sccmec} onChange={(v) => onPatch({ sccmec: v })} />
        <Txt label="Serotype" value={r.serotype} onChange={(v) => onPatch({ serotype: v })} />
        {/* Lineage is MTBC-specific — WHO lineages 1–4 + sub-lineage. */}
        {mtbc && (
          <Txt label="Lineage (MTBC)" placeholder="e.g. L2.2 (Beijing)" value={r.lineage} onChange={(v) => onPatch({ lineage: v })} />
        )}
      </Grid>

      {/* ── Resistance determinants — the core clinical output ─────────────── */}
      <Block>Resistance determinants</Block>
      {(r.resistance_genes || []).length === 0 && (
        <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1 }}>
          No resistance determinants recorded. A determinant with uncertain significance
          should still be recorded — it is not the same as no determinant detected.
        </Typography>
      )}
      {(r.resistance_genes || []).map((g) => (
        <RowCard key={g.row_id} onRemove={() => removeRow("resistance_genes", g.row_id)}>
          <Grid cols={3}>
            <Txt label="Gene / mutation" placeholder="e.g. blaNDM-1, mecA, rpoB S450L" value={g.gene_name} onChange={(v) => patchRow("resistance_genes", g.row_id, { gene_name: v })} />
            <SelF label="Class" options={RESISTANCE_GENE_CLASSES} value={g.gene_class} onChange={(v) => patchRow("resistance_genes", g.row_id, { gene_class: v })} />
            <SelF label="Mechanism" options={RESISTANCE_MECHANISMS} value={g.mechanism} onChange={(v) => patchRow("resistance_genes", g.row_id, { mechanism: v })} />
            <SelF label="Database" options={AMR_GENE_DATABASES} value={g.database_source} onChange={(v) => patchRow("resistance_genes", g.row_id, { database_source: v })} />
            <Txt label="Database version" value={g.database_version} onChange={(v) => patchRow("resistance_genes", g.row_id, { database_version: v })} />
            <SelF label="Predicted phenotype" options={PREDICTED_PHENOTYPE_OPTIONS} value={g.predicted_phenotype} onChange={(v) => patchRow("resistance_genes", g.row_id, { predicted_phenotype: v })} />
            <Txt label="Identity (%)" value={g.identity_pct} onChange={(v) => patchRow("resistance_genes", g.row_id, { identity_pct: v })} />
            <Txt label="Coverage (%)" value={g.coverage_pct} onChange={(v) => patchRow("resistance_genes", g.row_id, { coverage_pct: v })} />
            <SelF label="Confidence" options={CARD_CONFIDENCE} value={g.confidence} onChange={(v) => patchRow("resistance_genes", g.row_id, { confidence: v })} />
          </Grid>
          <Box sx={{ mt: 1.5 }}>
            <ListField
              label="Drugs predicted to be affected (comma-separated)"
              placeholder="e.g. Meropenem, Imipenem, Ertapenem"
              value={g.drug_targets}
              onChange={(v) => patchRow("resistance_genes", g.row_id, { drug_targets: v })}
            />
          </Box>
        </RowCard>
      ))}
      <Button onClick={() => addRow("resistance_genes", blankResistanceGene)} sx={{ ...outlineBtnSx, px: 2.5 }}>
        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add resistance determinant
      </Button>

      {/* ── Virulence determinants ─────────────────────────────────────────── */}
      <Block>Virulence determinants</Block>
      {(r.virulence_genes || []).map((g) => (
        <RowCard key={g.row_id} onRemove={() => removeRow("virulence_genes", g.row_id)}>
          <Grid cols={3}>
            <Txt label="Gene" placeholder="e.g. stx2, tcdB, lukS-PV" value={g.gene_name} onChange={(v) => patchRow("virulence_genes", g.row_id, { gene_name: v })} />
            <SelF label="Category" options={VIRULENCE_GENE_CATEGORIES} value={g.category} onChange={(v) => patchRow("virulence_genes", g.row_id, { category: v })} />
            <Txt label="Note" value={g.note} onChange={(v) => patchRow("virulence_genes", g.row_id, { note: v })} />
          </Grid>
        </RowCard>
      ))}
      <Button onClick={() => addRow("virulence_genes", blankVirulenceGene)} sx={{ ...outlineBtnSx, px: 2.5 }}>
        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add virulence gene
      </Button>

      {/* ── Plasmid replicons ──────────────────────────────────────────────── */}
      <Block>Plasmid replicons</Block>
      {(r.plasmid_replicons || []).map((p) => (
        <RowCard key={p.row_id} onRemove={() => removeRow("plasmid_replicons", p.row_id)}>
          <Grid cols={2}>
            <Txt label="Replicon / Inc type" placeholder="e.g. IncFII, IncX3" value={p.name} onChange={(v) => patchRow("plasmid_replicons", p.row_id, { name: v })} />
            <Txt label="Note" value={p.note} onChange={(v) => patchRow("plasmid_replicons", p.row_id, { note: v })} />
          </Grid>
        </RowCard>
      ))}
      <Button onClick={() => addRow("plasmid_replicons", blankPlasmidReplicon)} sx={{ ...outlineBtnSx, px: 2.5 }}>
        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add plasmid replicon
      </Button>

      {/* ── TB drug profile — MTBC only ────────────────────────────────────── */}
      {mtbc && (
        <>
          <Block>TB drug resistance profile (MTBC)</Block>
          <Grid cols={2}>
            <Txt
              label="WHO catalogue version"
              placeholder="WHO TB Mutation Catalogue v2 (2023)"
              value={r.tb_who_catalogue_version}
              onChange={(v) => onPatch({ tb_who_catalogue_version: v })}
            />
            <Box>
              <Box sx={{ px: 2, py: 0.75, display: "inline-flex", ...classificationFill(r.tb_resistance_classification) }}>
                <Typography sx={{ fontSize: 12.5, fontFamily: FONT, letterSpacing: "0.05em" }}>
                  {r.tb_resistance_classification || "—"}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.5 }}>
                Derived from the rows below — not typed.
              </Typography>
            </Box>
          </Grid>

          {(r.tb_drug_resistance_profile || []).map((row) => (
            <RowCard
              key={row.row_id}
              onRemove={() => setTbProfile((r.tb_drug_resistance_profile || []).filter((x) => x.row_id !== row.row_id))}
            >
              <Grid cols={4}>
                <SelF label="Drug" options={TNGS_DRUG_PANEL} value={row.drug} onChange={(v) => patchTbRow(row.row_id, { drug: v })} />
                <Txt label="Mutation" placeholder="e.g. katG S315T" value={row.mutation} onChange={(v) => patchTbRow(row.row_id, { mutation: v })} />
                <SelF label="WHO confidence group" options={WHO_TB_CONFIDENCE_GROUPS} value={row.who_confidence} onChange={(v) => patchTbRow(row.row_id, { who_confidence: v })} />
                <SelF label="Predicted phenotype" options={PREDICTED_PHENOTYPE_OPTIONS} value={row.predicted_phenotype} onChange={(v) => patchTbRow(row.row_id, { predicted_phenotype: v })} />
              </Grid>
            </RowCard>
          ))}
          <Button onClick={() => setTbProfile([...(r.tb_drug_resistance_profile || []), blankTbProfileRow()])} sx={{ ...outlineBtnSx, px: 2.5 }}>
            <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add drug row
          </Button>
        </>
      )}

      {/* ── Genotype vs phenotype ──────────────────────────────────────────── */}
      <Block>Genotype ↔ phenotype concordance</Block>
      <Grid cols={2}>
        <SelF
          label="Concordance with phenotypic AST"
          options={GENOTYPE_PHENOTYPE_CONCORDANCE}
          value={r.genotype_phenotype_concordance}
          onChange={(v) => onPatch({ genotype_phenotype_concordance: v })}
        />
        <Txt label="Concordance note" value={r.concordance_note} onChange={(v) => onPatch({ concordance_note: v })} />
      </Grid>
      <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.75 }}>
        A detected gene does not always mean clinical resistance — porin loss, efflux
        and non-expression all break the link. Phenotypic AST remains the reference.
      </Typography>

      {/* ── Epidemiology / outbreak ────────────────────────────────────────── */}
      <Block>Epidemiology / outbreak</Block>
      <Grid cols={4}>
        <Txt label="Cluster ID" value={r.cluster_id} onChange={(v) => onPatch({ cluster_id: v })} />
        <Txt label="SNP distance to cluster" value={r.cluster_snp_distance} onChange={(v) => onPatch({ cluster_snp_distance: v })} />
        <SelF label="Cluster tool" options={TYPING_SCHEMES} value={r.cluster_tool} onChange={(v) => onPatch({ cluster_tool: v })} />
        <SelF label="Epidemiological link" options={EPIDEMIOLOGICAL_LINK_OPTIONS} value={r.epidemiological_link} onChange={(v) => onPatch({ epidemiological_link: v })} />
      </Grid>
      <Box sx={{ mt: 1.5 }}>
        <Txt label="Outbreak note (for infection control)" value={r.outbreak_note} onChange={(v) => onPatch({ outbreak_note: v })} />
      </Box>

      {/* ── Summary & dispatch ─────────────────────────────────────────────── */}
      <Block>Genomic summary</Block>
      <TextField
        size="small"
        fullWidth
        multiline
        rows={3}
        sx={inputSx}
        placeholder="2–3 sentence plain-language summary for the final report"
        value={r.genomic_summary}
        onChange={(e) => onPatch({ genomic_summary: e.target.value })}
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
