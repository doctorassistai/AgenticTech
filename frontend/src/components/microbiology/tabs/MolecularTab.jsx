// tabs/MolecularTab.jsx — Microbiology Tab 8: Molecular / NAAT
//
// All nucleic-acid-based testing that runs independently of culture: rapid
// syndromic panels, quantitative viral loads, GeneXpert MTB/RIF, parasite PCR.
// Stored keyed by specimen_id (only specimens with a NAAT test ordered) —
//   molecular = {
//     [specimen_id]: {
//       orders: [
//         {
//           order_id, test_type,           // test_type ∈ NAAT_TEST_VALUES
//           assay, platform, target,       // assay from the curated catalogue
//           internal_control, adequacy_note,
//           result: { qualitative, copies_ml, log10, ct, markers[], assay_version, lot_number, result_datetime },
//           prelim: null,                  // stamped after dispatch
//         }
//       ]
//     }
//   }
//
// Send Preliminary dispatches a versioned entry into preliminary_reports
// (same pattern as Tab 3 / Tab 5). MTB detected (GeneXpert) is flagged
// notifiable — consumed by Tab 13 / Tab 14 later.

import React, { useEffect, useState } from "react";
import {
  Box, Typography, TextField, Button, IconButton,
} from "@mui/material";
import { AddRounded, DeleteOutlineRounded, SendRounded } from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  SectionBox, FieldLabel, Sel, CbxGroup,
} from "../../shared/FormComponents";
import {
  naatTestsFor,
  NAAT_QUALITATIVE_OPTIONS,
  NAAT_INTERNAL_CONTROL_OPTIONS,
  MOLECULAR_ASSAYS_FOR_TEST,
  MOLECULAR_ASSAY_BY_VALUE,
  NAAT_NOTIFIABLE_TESTS,
} from "../constants";
import { summarizeNaatOrder } from "../shared/resultSummaries";

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

// ─── Record defaults + hydration ──────────────────────────────────────────────

const blankOrder = () => ({
  order_id: makeUid("NAT"),
  test_type: "",
  assay: "",
  platform: "",
  target: "",
  internal_control: "",
  adequacy_note: "",
  result: {
    qualitative: "",
    copies_ml: "",
    log10: "",
    ct: "",
    markers: [],
    assay_version: "",
    lot_number: "",
    result_datetime: "",
  },
  prelim: null,
});

const hydrateOrder = (o) => ({
  ...blankOrder(),
  ...o,
  result: {
    ...blankOrder().result,
    ...(o.result || {}),
    markers: Array.isArray(o.result?.markers) ? o.result.markers : [],
  },
  prelim: o.prelim || null,
});

const blankSpecimen = () => ({ orders: [] });

const hydrateSpecimen = (saved) => ({
  orders: Array.isArray(saved?.orders) ? saved.orders.map(hydrateOrder) : [],
});

// ─── Summaries / flags ────────────────────────────────────────────────────────

const displayValue = (v) =>
  Array.isArray(v) ? v.join(", ") : String(v ?? "");

// Human summary for the preliminary, e.g. "GeneXpert MTB/RIF — Detected (Ct 22)".
// MTB detected on GeneXpert → notifiable (public-health) flag.
const notifiableFlag = (o) => {
  const notifiableTest = NAAT_NOTIFIABLE_TESTS.includes(o.test_type);
  const detected = o.result?.qualitative === "Detected";
  if (notifiableTest && detected) {
    return { notifiable: true, notifiable_reason: "MTB detected (GeneXpert) — notifiable, public-health notification required" };
  }
  return { notifiable: false, notifiable_reason: "" };
};

export default function MolecularTab({
  doctorId,
  doctorName,
  caseId,
  initialData,        // molecular section: { [specimen_id]: { orders: [] } }
  preliminaryReports, // preliminary_reports section (for versioned dispatch)
  caseRegister,       // case_register (specimens + tests)
  onSave,             // (tabKey, data) dispatch — "molecular" | "preliminary"
}) {
  const [blocks, setBlocks] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];

  useEffect(() => {
    const hydrated = {};
    // Only specimens that carry a NAAT ordered test get a molecular block.
    specimens.forEach((sp) => {
      const naatTests = naatTestsFor(sp.tests_ordered);
      if (naatTests.length === 0) return;
      const saved = (initialData && initialData[sp.specimen_id]) || {};
      hydrated[sp.specimen_id] = hydrateSpecimen(saved);
    });
    setBlocks(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const patchOrder = (specimenId, orderId, patchObj) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        orders: prev[specimenId].orders.map((o) => (o.order_id === orderId ? { ...o, ...patchObj } : o)),
      },
    }));

  const patchResult = (specimenId, orderId, key, value) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        orders: prev[specimenId].orders.map((o) =>
          o.order_id === orderId ? { ...o, result: { ...o.result, [key]: value } } : o
        ),
      },
    }));

  const addOrder = (specimenId, testType) => {
    const order = blankOrder();
    order.test_type = testType;
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: { ...prev[specimenId], orders: [...prev[specimenId].orders, order] },
    }));
  };

  const removeOrder = (specimenId, orderId) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: { ...prev[specimenId], orders: prev[specimenId].orders.filter((o) => o.order_id !== orderId) },
    }));

  // Choosing an assay from the curated catalogue prefills platform + target.
  const selectAssay = (specimenId, orderId, assayValue) => {
    const assay = MOLECULAR_ASSAY_BY_VALUE[assayValue];
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        orders: prev[specimenId].orders.map((o) =>
          o.order_id === orderId
            ? { ...o, assay: assayValue, platform: assay?.platform || "", target: assay?.target || "" }
            : o
        ),
      },
    }));
  };

  const saveMolecular = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("molecular", blocks);
    } catch (err) {
      console.error("[MolecularTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Send a versioned preliminary for one order into preliminary_reports.
  const sendPreliminary = async (sp, o) => {
    const assay = MOLECULAR_ASSAY_BY_VALUE[o.assay];
    const summary = summarizeNaatOrder(o);
    const nf = notifiableFlag(o);
    if (!o.assay || !o.result?.qualitative && !o.result?.copies_ml) {
      setNotice("Choose an assay and record a result before sending a preliminary.");
      return;
    }
    setNotice("");
    setIsSaving(true);
    try {
      const versions = Array.isArray(preliminaryReports?.versions) ? preliminaryReports.versions : [];
      const version = {
        version: versions.length + 1,
        source_tab: "Molecular / NAAT",
        content_type: "naat",
        order_id: o.order_id,
        assay: o.assay,
        assay_label: assay?.label || o.assay,
        platform: o.platform,
        specimen_id: sp.specimen_id,
        specimen_type: sp.specimen_type || "",
        dispatched_at: new Date().toISOString(),
        dispatched_by: doctorName || doctorId || "",
        summary,
        result: o.result,
        ...(nf.notifiable ? { notifiable: true, notifiable_reason: nf.notifiable_reason } : {}),
      };
      const merged = { ...(preliminaryReports && typeof preliminaryReports === "object" ? preliminaryReports : {}), versions: [...versions, version] };
      await onSave("preliminary", merged);
      patchOrder(sp.specimen_id, o.order_id, { prelim: { version: version.version, dispatched_at: version.dispatched_at, notifiable: nf.notifiable } });
    } catch (err) {
      console.error("[MolecularTab] preliminary dispatch error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const activeSpecimens = specimens.filter((sp) => naatTestsFor(sp.tests_ordered).length > 0);

  if (activeSpecimens.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>
          No NAAT ordered. Add a Molecular / NAAT test (GeneXpert, Viral PCR, Fungal PCR, Parasite PCR…) to a specimen in Registration & Accession.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Nucleic-acid testing runs independently of culture. Each order links to a registered specimen; results dispatch as a
        versioned preliminary. MTB detected (GeneXpert) is auto-flagged notifiable for public-health reporting.
      </Typography>

      {activeSpecimens.map((sp, i) => {
        const naatTests = naatTestsFor(sp.tests_ordered);
        const block = blocks[sp.specimen_id] || blankSpecimen();

        return (
          <SectionBox
            key={sp.specimen_id}
            title={`Specimen ${i + 1} — ${sp.specimen_type || "Unspecified"} · ${sp.specimen_id}`}
          >
            {block.orders.length === 0 && (
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
                No NAAT orders yet for this specimen.
              </Typography>
            )}

            {block.orders.map((o) => {
              const assays = MOLECULAR_ASSAYS_FOR_TEST(o.test_type);
              const assay = MOLECULAR_ASSAY_BY_VALUE[o.assay];
              const nf = notifiableFlag(o);
              const quant = !!assay?.quantitative;

              return (
                <Box key={o.order_id} sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.bgTertiary }}>
                  <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, borderBottom: `1px solid ${C.border}`, background: C.bgSecondary, flexWrap: "wrap" }}>
                    <Box sx={{ minWidth: 200, flex: "1 1 240px" }}>
                      <FieldLabel>NAAT type</FieldLabel>
                      <Sel
                        label="NAAT type"
                        options={naatTests.map((t) => ({ value: t, label: t }))}
                        value={o.test_type}
                        onChange={(v) => patchOrder(sp.specimen_id, o.order_id, { test_type: v, assay: "", platform: "", target: "" })}
                      />
                    </Box>
                    <Box sx={{ flex: "1 1 280px" }}>
                      <FieldLabel>Assay</FieldLabel>
                      <Sel
                        label="Assay"
                        options={assays.map((a) => ({ value: a.value, label: a.label }))}
                        value={o.assay}
                        onChange={(v) => selectAssay(sp.specimen_id, o.order_id, v)}
                      />
                    </Box>
                    <IconButton size="small" onClick={() => removeOrder(sp.specimen_id, o.order_id)} sx={{ color: C.textSecond, "&:hover": { color: C.black } }}>
                      <DeleteOutlineRounded fontSize="small" />
                    </IconButton>
                  </Box>

                  <Box sx={{ p: 2 }}>
                    {!o.assay && (
                      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                        Select an assay to set up the order.
                      </Typography>
                    )}

                    {o.assay && (
                      <>
                        {/* Order identity */}
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5, mb: 2 }}>
                          <Box>
                            <FieldLabel>Platform</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} value={o.platform} onChange={(e) => patchOrder(sp.specimen_id, o.order_id, { platform: e.target.value })} />
                          </Box>
                          <Box>
                            <FieldLabel>Target pathogen(s)</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} value={o.target} onChange={(e) => patchOrder(sp.specimen_id, o.order_id, { target: e.target.value })} />
                          </Box>
                        </Box>

                        {/* Extraction QC */}
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5, mb: 2 }}>
                          <Box>
                            <FieldLabel>Internal control (extraction QC)</FieldLabel>
                            <Sel label="Internal control" options={NAAT_INTERNAL_CONTROL_OPTIONS} value={o.internal_control} onChange={(v) => patchOrder(sp.specimen_id, o.order_id, { internal_control: v })} />
                          </Box>
                          <Box>
                            <FieldLabel>Adequacy note</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} placeholder="Specimen adequacy / extraction comments" value={o.adequacy_note} onChange={(e) => patchOrder(sp.specimen_id, o.order_id, { adequacy_note: e.target.value })} />
                          </Box>
                        </Box>

                        {/* Result */}
                        <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }}>
                          Result
                        </Typography>
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: quant ? "repeat(3, 1fr)" : "repeat(2, 1fr)" }, gap: 1.5 }}>
                          <Box>
                            <FieldLabel>Qualitative</FieldLabel>
                            <Sel label="Qualitative" options={NAAT_QUALITATIVE_OPTIONS} value={o.result.qualitative} onChange={(v) => patchResult(sp.specimen_id, o.order_id, "qualitative", v)} />
                          </Box>
                          {quant && (
                            <>
                              <Box>
                                <FieldLabel>Quantity (copies/mL)</FieldLabel>
                                <TextField size="small" fullWidth sx={inputSx} placeholder="e.g. 245000" value={o.result.copies_ml} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "copies_ml", e.target.value)} />
                              </Box>
                              <Box>
                                <FieldLabel>Log₁₀ copies/mL</FieldLabel>
                                <TextField size="small" fullWidth sx={inputSx} placeholder="e.g. 5.39" value={o.result.log10} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "log10", e.target.value)} />
                              </Box>
                            </>
                          )}
                          <Box>
                            <FieldLabel>Ct value (if reported)</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} placeholder="cycle threshold" value={o.result.ct} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "ct", e.target.value)} />
                          </Box>
                          {!quant && <Box />}
                        </Box>

                        {/* Resistance markers (assay-dependent) */}
                        {assay?.markers && assay.markers.length > 0 && (
                          <Box sx={{ mt: 1.5 }}>
                            <CbxGroup
                              label="Resistance / mechanism markers detected"
                              options={assay.markers}
                              value={o.result.markers}
                              onChange={(v) => patchResult(sp.specimen_id, o.order_id, "markers", v)}
                            />
                          </Box>
                        )}

                        {/* Traceability */}
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5, mt: 1.5 }}>
                          <Box>
                            <FieldLabel>Assay version</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} value={o.result.assay_version} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "assay_version", e.target.value)} />
                          </Box>
                          <Box>
                            <FieldLabel>Lot number</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} value={o.result.lot_number} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "lot_number", e.target.value)} />
                          </Box>
                          <Box>
                            <FieldLabel>Result datetime</FieldLabel>
                            <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={o.result.result_datetime} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "result_datetime", e.target.value)} InputLabelProps={{ shrink: true }} />
                          </Box>
                        </Box>

                        {nf.notifiable && (
                          <Box sx={{ mt: 1.5, px: 2, py: 1.25, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
                            <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                              ⚠ <b>Notifiable</b> — {nf.notifiable_reason}
                            </Typography>
                          </Box>
                        )}

                        <Box sx={{ mt: 1.5, display: "flex", justifyContent: "flex-end", gap: 1, alignItems: "center" }}>
                          {o.prelim && (
                            <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
                              Preliminary v{o.prelim.version} dispatched {o.prelim.dispatched_at ? new Date(o.prelim.dispatched_at).toLocaleString() : ""}
                            </Typography>
                          )}
                          <Button
                            onClick={() => sendPreliminary(sp, o)}
                            disabled={!o.result?.qualitative && !o.result?.copies_ml || isSaving}
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

            <Button onClick={() => addOrder(sp.specimen_id, naatTests[0])} sx={{ ...outlineBtnSx, px: 2.5 }}>
              <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add NAAT Order
            </Button>
          </SectionBox>
        );
      })}

      {notice && (
        <Box sx={{ mb: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1 }}>
        <Button onClick={saveMolecular} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Molecular"}
        </Button>
      </Box>
    </Box>
  );
}
