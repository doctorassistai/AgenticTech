// tabs/genomics/TargetedPanel.jsx — Tab 15 / targeted panels
//
// One sub-tab, three kinds of panel, decided by the panel chosen on each order:
//
//   "resistance" — mutation → drug → predicted R/S. TB, HIV, HBV, HCV, CMV, HSV,
//                  influenza, Aspergillus CYP51A, Candida FKS, P. falciparum,
//                  gonococcal NG-STAR.
//   "identity"   — taxon → identity % → database. 16S and ITS only.
//   "typing"     — strain label for infection control (spa/SCCmec, ribotype,
//                  clade), used to link cases rather than to guide therapy.
//
// They are separate row tables rather than one wide table because an identity
// panel carries NO resistance information at all — an amplicon result is also
// meaningless on a non-sterile site, which is enforced at specimen receipt, not
// here.
//
// The section holds an ORDERS array (like Tab 8's NAAT), because one specimen
// may carry several targeted panels at once — a carbapenemase gene panel plus a
// typing run, say — and each is its own result.

import React from "react";
import { Box, Typography, TextField, Button } from "@mui/material";
import { AddRounded, SendRounded } from "@mui/icons-material";
import { C, FONT, inputSx, outlineBtnSx } from "../../../shared/designTokens";
import { Grid, Txt, SelF, Block, RowCard, ListField, YES_NO } from "./fields";
import {
  GENOMICS_PLATFORMS,
  SEQUENCING_LABS,
  WGS_PIPELINES,
  AMPLICON_DATABASES,
  AMPLICON_TARGETS,
  CARD_CONFIDENCE,
  PREDICTED_PHENOTYPE_OPTIONS,
  TYPING_SCHEMES,
  TARGETED_PANEL_METHODS,
  GENOTYPING_PANEL_BY_VALUE,
  genotypingPanelsForTests,
} from "../../constants";
import {
  blankTargetedOrder,
  blankTargetedSection,
  blankMutationRow,
  blankTaxonRow,
} from "./records";

export default function TargetedPanel({ record, onPatch, onSendPreliminary, isSaving, testsOrdered }) {
  if (!record) return null;

  const section = record.orders ? record : blankTargetedSection();
  const orders = section.orders || [];
  const panels = genotypingPanelsForTests(testsOrdered);

  const setOrders = (rows) => onPatch({ orders: rows });

  const patchOrder = (orderId, patch) =>
    setOrders(orders.map((o) => (o.order_id === orderId ? { ...o, ...patch } : o)));

  const addOrder = () => setOrders([...orders, blankTargetedOrder()]);
  const removeOrder = (orderId) => setOrders(orders.filter((o) => o.order_id !== orderId));

  const patchSubRow = (order, key, row, patch) =>
    patchOrder(order.order_id, {
      [key]: (order[key] || []).map((x) => (x.row_id === row.row_id ? { ...x, ...patch } : x)),
    });

  const addSubRow = (order, key, blank) =>
    patchOrder(order.order_id, { [key]: [...(order[key] || []), blank()] });

  const removeSubRow = (order, key, row) =>
    patchOrder(order.order_id, { [key]: (order[key] || []).filter((x) => x.row_id !== row.row_id) });

  return (
    <Box>
      {orders.length === 0 && (
        <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
          No targeted panel ordered yet for this specimen.
        </Typography>
      )}

      {orders.map((o) => {
        const def = GENOTYPING_PANEL_BY_VALUE[o.panel];
        const kind = o.panel_kind;

        return (
          <Box key={o.order_id} sx={{ border: `1px solid ${C.border}`, mb: 2.5, background: C.bgTertiary }}>
            {/* Order header — panel selection drives everything below it */}
            <Box
              sx={{
                px: 2, py: 1.25, display: "flex", alignItems: "flex-end", gap: 1.5,
                flexWrap: "wrap", borderBottom: `1px solid ${C.border}`, background: C.bgSecondary,
              }}
            >
              <Box sx={{ flex: "1 1 300px" }}>
                <SelF
                  label="Panel"
                  options={panels.map((p) => ({ value: p.value, label: p.label }))}
                  value={o.panel}
                  onChange={(v) => {
                    const chosen = panels.find((p) => p.value === v);
                    patchOrder(o.order_id, {
                      panel: v,
                      panel_kind: chosen?.kind || "",
                      // A panel change invalidates the previous row set and the
                      // loci it was targeting — clear rather than merge.
                      mutation_rows: [],
                      taxa_rows: [],
                      loci_targeted: [],
                      reference_database: "",
                      typing: { scheme: "", type_result: "", cluster_id: "", snp_distance: "" },
                    });
                  }}
                />
              </Box>
              <Box sx={{ flex: "1 1 200px" }}>
                <SelF label="Method" options={TARGETED_PANEL_METHODS} value={o.method} onChange={(v) => patchOrder(o.order_id, { method: v })} />
              </Box>
              <Button onClick={() => removeOrder(o.order_id)} sx={{ ...outlineBtnSx, py: 0.6, px: 1.5, fontSize: 11, mb: 0.25 }}>
                Remove order
              </Button>
            </Box>

            <Box sx={{ p: 2 }}>
              {!o.panel && (
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                  Choose a panel to set up the order.
                </Typography>
              )}

              {o.panel && (
                <>
                  {/* ── Run, pipeline & QC ─────────────────────────────────── */}
                  <Block>Run &amp; QC</Block>
                  <Grid cols={4}>
                    <SelF label="Platform" options={GENOMICS_PLATFORMS} value={o.platform} onChange={(v) => patchOrder(o.order_id, { platform: v })} />
                    <SelF label="Sequencing laboratory" options={SEQUENCING_LABS} value={o.sequencing_lab} onChange={(v) => patchOrder(o.order_id, { sequencing_lab: v })} />
                    <Txt label="Submitted at" type="datetime-local" value={o.submitted_at} onChange={(v) => patchOrder(o.order_id, { submitted_at: v })} />
                    <Txt label="Submitted by (technical)" value={o.technical_name} onChange={(v) => patchOrder(o.order_id, { technical_name: v })} />
                    <SelF label="Pipeline" options={WGS_PIPELINES} value={o.pipeline_name} onChange={(v) => patchOrder(o.order_id, { pipeline_name: v })} />
                    <Txt label="Pipeline version" placeholder="required for ISO 15189 traceability" value={o.pipeline_version} onChange={(v) => patchOrder(o.order_id, { pipeline_version: v })} />
                    <Txt label="Mean depth of coverage (×)" value={o.mean_depth_coverage} onChange={(v) => patchOrder(o.order_id, { mean_depth_coverage: v })} />
                    <SelF label="QC pass" options={YES_NO} value={o.qc_pass} onChange={(v) => patchOrder(o.order_id, { qc_pass: v })} />
                  </Grid>
                  <Box sx={{ mt: 1.5 }}>
                    <Txt label="QC note" value={o.qc_note} onChange={(v) => patchOrder(o.order_id, { qc_note: v })} />
                  </Box>

                  {/* ── Loci targeted ──────────────────────────────────────── */}
                  <Box sx={{ mt: 1.5 }}>
                    <ListField
                      label="Loci targeted (comma-separated)"
                      placeholder={def?.loci?.slice(0, 3).join(", ") || "e.g. rpoB, katG"}
                      value={o.loci_targeted}
                      onChange={(v) => patchOrder(o.order_id, { loci_targeted: v })}
                    />
                  </Box>

                  {/* ── Result — the shape depends on the panel kind ───────── */}
                  {kind === "resistance" && (
                    <>
                      <Block>Resistance markers</Block>
                      {(o.mutation_rows || []).length === 0 && (
                        <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1 }}>
                          No markers recorded. Absence of a listed mutation is a susceptible
                          call only where the locus was covered — check the QC above.
                        </Typography>
                      )}
                      {(o.mutation_rows || []).map((row) => (
                        <RowCard key={row.row_id} onRemove={() => removeSubRow(o, "mutation_rows", row)}>
                          <Grid cols={3}>
                            <Txt label="Locus" placeholder={def?.loci?.[0] || "e.g. rpoB"} value={row.locus} onChange={(v) => patchSubRow(o, "mutation_rows", row, { locus: v })} />
                            <Txt label="Mutation" placeholder="e.g. S450L" value={row.mutation} onChange={(v) => patchSubRow(o, "mutation_rows", row, { mutation: v })} />
                            <SelF label="Drug" options={def?.drugs || []} value={row.drug} onChange={(v) => patchSubRow(o, "mutation_rows", row, { drug: v })} />
                            <SelF label="Predicted phenotype" options={PREDICTED_PHENOTYPE_OPTIONS} value={row.predicted_phenotype} onChange={(v) => patchSubRow(o, "mutation_rows", row, { predicted_phenotype: v })} />
                            <SelF label="Confidence" options={CARD_CONFIDENCE} value={row.confidence} onChange={(v) => patchSubRow(o, "mutation_rows", row, { confidence: v })} />
                            <Txt label="Note" value={row.note} onChange={(v) => patchSubRow(o, "mutation_rows", row, { note: v })} />
                          </Grid>
                        </RowCard>
                      ))}
                      <Button onClick={() => addSubRow(o, "mutation_rows", blankMutationRow)} sx={{ ...outlineBtnSx, px: 2.5 }}>
                        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add marker
                      </Button>
                    </>
                  )}

                  {kind === "identity" && (
                    <>
                      <Block>Identification</Block>
                      <Grid cols={2}>
                        <SelF label="Amplicon target" options={AMPLICON_TARGETS} value={o.loci_targeted?.[0] || ""} onChange={(v) => patchOrder(o.order_id, { loci_targeted: v ? [v] : [] })} />
                        <SelF label="Reference database" options={AMPLICON_DATABASES} value={o.reference_database} onChange={(v) => patchOrder(o.order_id, { reference_database: v })} />
                      </Grid>
                      {(o.taxa_rows || []).map((row) => (
                        <RowCard key={row.row_id} onRemove={() => removeSubRow(o, "taxa_rows", row)}>
                          <Grid cols={4}>
                            <Txt label="Taxon" value={row.taxon_name} onChange={(v) => patchSubRow(o, "taxa_rows", row, { taxon_name: v })} />
                            <Txt label="Rank" placeholder="genus / species" value={row.rank} onChange={(v) => patchSubRow(o, "taxa_rows", row, { rank: v })} />
                            <Txt label="Identity (%)" value={row.identity_pct} onChange={(v) => patchSubRow(o, "taxa_rows", row, { identity_pct: v })} />
                            <Txt label="Note" value={row.note} onChange={(v) => patchSubRow(o, "taxa_rows", row, { note: v })} />
                          </Grid>
                        </RowCard>
                      ))}
                      <Button onClick={() => addSubRow(o, "taxa_rows", blankTaxonRow)} sx={{ ...outlineBtnSx, px: 2.5 }}>
                        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add taxon
                      </Button>
                      <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 1 }}>
                        Broad-range amplicon identification reports no resistance information,
                        and is only interpretable on a sterile-site specimen.
                      </Typography>
                    </>
                  )}

                  {kind === "typing" && (
                    <>
                      <Block>Typing result</Block>
                      <Grid cols={4}>
                        <SelF label="Scheme" options={TYPING_SCHEMES} value={o.typing?.scheme} onChange={(v) => patchOrder(o.order_id, { typing: { ...o.typing, scheme: v } })} />
                        <Txt label="Type / result" placeholder="e.g. t002, ribotype 027, clade I" value={o.typing?.type_result} onChange={(v) => patchOrder(o.order_id, { typing: { ...o.typing, type_result: v } })} />
                        <Txt label="Cluster ID" value={o.typing?.cluster_id} onChange={(v) => patchOrder(o.order_id, { typing: { ...o.typing, cluster_id: v } })} />
                        <Txt label="SNP distance to cluster" value={o.typing?.snp_distance} onChange={(v) => patchOrder(o.order_id, { typing: { ...o.typing, snp_distance: v } })} />
                      </Grid>
                      <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.75 }}>
                        A typing result links cases for infection control. It does not by itself
                        indicate resistance and should not be reported as one.
                      </Typography>
                    </>
                  )}

                  {/* ── Interpretation & dispatch ──────────────────────────── */}
                  <Block>Interpretation</Block>
                  <TextField
                    size="small"
                    fullWidth
                    multiline
                    rows={2}
                    sx={inputSx}
                    value={o.interpretation_note}
                    onChange={(e) => patchOrder(o.order_id, { interpretation_note: e.target.value })}
                  />

                  <Box sx={{ mt: 1.5, display: "flex", justifyContent: "flex-end", gap: 1, alignItems: "center" }}>
                    {o.prelim && (
                      <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
                        Preliminary v{o.prelim.version} dispatched{" "}
                        {o.prelim.dispatched_at ? new Date(o.prelim.dispatched_at).toLocaleString() : ""}
                      </Typography>
                    )}
                    <Button
                      onClick={() => onSendPreliminary(o)}
                      disabled={isSaving}
                      sx={{ ...outlineBtnSx, py: 0.6, px: 2, fontSize: 11 }}
                    >
                      <SendRounded sx={{ mr: 0.5, fontSize: 14 }} /> Send Preliminary
                    </Button>
                  </Box>
                </>
              )}
            </Box>
          </Box>
        );
      })}

      <Button onClick={addOrder} sx={{ ...outlineBtnSx, px: 2.5 }}>
        <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add targeted panel
      </Button>
    </Box>
  );
}
