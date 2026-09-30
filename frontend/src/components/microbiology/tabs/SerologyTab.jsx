// tabs/SerologyTab.jsx — Microbiology Tab 9: Serology & antigen
//
// Immunological methods that need no viable organism (results 1–6 h, same
// session). Stored keyed by specimen_id (only specimens with a serology test
// ordered) —
//   serology = {
//     [specimen_id]: {
//       orders: [
//         {
//           order_id, test_type,          // test_type ∈ SEROLOGY_TEST_VALUES
//           assay, method, platform, lot, // assay from the curated catalogue
//           result: { qualitative, quantitative, interpretation, cut_off,
//                     note, result_datetime },
//           prelim: null,
//         }
//       ]
//     }
//   }
//
// Each assay declares a result vocabulary (serological "Reactive/Non-reactive/
// Equivocal" vs antigen "Positive/Negative/Equivocal") and an optional reflex
// rule. Reflexes are advisory banners only — the rule text is shown when the
// recorded result matches, nothing is auto-dispatched (consistent with the
// module's no-auto-dispatch stance; follow-up orders are placed manually).
//
// Send Preliminary dispatches a versioned entry into preliminary_reports
// (same pattern as Tab 3 / Tab 5 / Tab 8).

import React, { useEffect, useState } from "react";
import {
  Box, Typography, TextField, Button, IconButton,
} from "@mui/material";
import { AddRounded, DeleteOutlineRounded, SendRounded } from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  SectionBox, FieldLabel, Sel,
} from "../../shared/FormComponents";
import {
  serologyTestsFor,
  SEROLOGY_RESULT_OPTIONS,
  SEROLOGY_ANTIGEN_RESULT_OPTIONS,
  SEROLOGY_METHOD_OPTIONS,
  SEROLOGY_INTERPRETATION_OPTIONS,
  SEROLOGY_ASSAYS_FOR_TEST,
  SEROLOGY_ASSAY_BY_VALUE,
} from "../constants";
import { summarizeSerologyOrder } from "../shared/resultSummaries";

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

// ─── Record defaults + hydration ──────────────────────────────────────────────

const blankOrder = () => ({
  order_id: makeUid("SER"),
  test_type: "",
  assay: "",
  method: "",
  platform: "",
  lot: "",
  result: {
    qualitative: "",        // Reactive / Non-reactive / Equivocal  OR  Positive / …
    quantitative: "",       // titre / index / IU / OD ratio where applicable
    interpretation: "",     // Positive / Negative / Borderline / Equivocal
    cut_off: "",            // cut-off / reference range noted
    note: "",               // free-text clinical interpretation note
    result_datetime: "",
  },
  prelim: null,
});

const hydrateOrder = (o) => ({
  ...blankOrder(),
  ...o,
  result: { ...blankOrder().result, ...(o.result || {}) },
  prelim: o.prelim || null,
});

const blankSpecimen = () => ({ orders: [] });

const hydrateSpecimen = (saved) => ({
  orders: Array.isArray(saved?.orders) ? saved.orders.map(hydrateOrder) : [],
});

// ─── Summaries / reflex banners ───────────────────────────────────────────────

// Human summary for the preliminary, e.g. "HBsAg — Reactive · Positive".
export default function SerologyTab({
  doctorId,
  doctorName,
  caseId,
  initialData,        // serology section: { [specimen_id]: { orders: [] } }
  preliminaryReports, // preliminary_reports section (for versioned dispatch)
  caseRegister,       // case_register (specimens + tests)
  onSave,             // (tabKey, data) dispatch — "serology" | "preliminary"
}) {
  const [blocks, setBlocks] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];

  useEffect(() => {
    const hydrated = {};
    specimens.forEach((sp) => {
      if (serologyTestsFor(sp.tests_ordered).length === 0) return;
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

  const selectAssay = (specimenId, orderId, assayValue) => {
    const assay = SEROLOGY_ASSAY_BY_VALUE[assayValue];
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        orders: prev[specimenId].orders.map((o) =>
          o.order_id === orderId
            ? { ...o, assay: assayValue, method: assay?.method || "" }
            : o
        ),
      },
    }));
  };

  const saveSerology = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("serology", blocks);
    } catch (err) {
      console.error("[SerologyTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Send a versioned preliminary for one order into preliminary_reports.
  const sendPreliminary = async (sp, o) => {
    const assay = SEROLOGY_ASSAY_BY_VALUE[o.assay];
    const summary = summarizeSerologyOrder(o);
    if (!o.assay || !o.result?.qualitative && !o.result?.quantitative) {
      setNotice("Choose an assay and record a result before sending a preliminary.");
      return;
    }
    setNotice("");
    setIsSaving(true);
    try {
      const versions = Array.isArray(preliminaryReports?.versions) ? preliminaryReports.versions : [];
      const version = {
        version: versions.length + 1,
        source_tab: "Serology & Antigen",
        content_type: "serology",
        order_id: o.order_id,
        assay: o.assay,
        assay_label: assay?.label || o.assay,
        method: o.method,
        specimen_id: sp.specimen_id,
        specimen_type: sp.specimen_type || "",
        dispatched_at: new Date().toISOString(),
        dispatched_by: doctorName || doctorId || "",
        summary,
        result: o.result,
      };
      const merged = { ...(preliminaryReports && typeof preliminaryReports === "object" ? preliminaryReports : {}), versions: [...versions, version] };
      await onSave("preliminary", merged);
      patchOrder(sp.specimen_id, o.order_id, { prelim: { version: version.version, dispatched_at: version.dispatched_at } });
    } catch (err) {
      console.error("[SerologyTab] preliminary dispatch error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const activeSpecimens = specimens.filter((sp) => serologyTestsFor(sp.tests_ordered).length > 0);

  if (activeSpecimens.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>
          No serology ordered. Add a Serology / Antigen test (Dengue, HIV / Hepatitis, Fungal antigen, Parasite antigen…) to a specimen in Registration & Accession.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Serological and antigen tests — no incubation wait, results report the same session. Reflex rules shown are advisory only;
        follow-up orders (avidity, viral load, confirmatory assay) are placed manually.
      </Typography>

      {activeSpecimens.map((sp, i) => {
        const seroTests = serologyTestsFor(sp.tests_ordered);
        const block = blocks[sp.specimen_id] || blankSpecimen();

        return (
          <SectionBox
            key={sp.specimen_id}
            title={`Specimen ${i + 1} — ${sp.specimen_type || "Unspecified"} · ${sp.specimen_id}`}
          >
            {block.orders.length === 0 && (
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
                No serology orders yet for this specimen.
              </Typography>
            )}

            {block.orders.map((o) => {
              const assays = SEROLOGY_ASSAYS_FOR_TEST(o.test_type);
              const assay = SEROLOGY_ASSAY_BY_VALUE[o.assay];
              const vocab = assay?.result_type === "antigen" ? SEROLOGY_ANTIGEN_RESULT_OPTIONS : SEROLOGY_RESULT_OPTIONS;
              const reflexHit = assay?.reflex && o.result?.qualitative === assay.reflex_when;

              return (
                <Box key={o.order_id} sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.bgTertiary }}>
                  <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, borderBottom: `1px solid ${C.border}`, background: C.bgSecondary, flexWrap: "wrap" }}>
                    <Box sx={{ minWidth: 200, flex: "1 1 240px" }}>
                      <FieldLabel>Serology type</FieldLabel>
                      <Sel
                        label="Serology type"
                        options={seroTests.map((t) => ({ value: t, label: t }))}
                        value={o.test_type}
                        onChange={(v) => patchOrder(sp.specimen_id, o.order_id, { test_type: v, assay: "", method: "" })}
                      />
                    </Box>
                    <Box sx={{ flex: "1 1 300px" }}>
                      <FieldLabel>Assay / test</FieldLabel>
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
                        {/* Method / platform / lot (traceability) */}
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5, mb: 2 }}>
                          <Box>
                            <FieldLabel>Method</FieldLabel>
                            <Sel label="Method" options={SEROLOGY_METHOD_OPTIONS} value={o.method} onChange={(v) => patchOrder(sp.specimen_id, o.order_id, { method: v })} />
                          </Box>
                          <Box>
                            <FieldLabel>Platform</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} value={o.platform} onChange={(e) => patchOrder(sp.specimen_id, o.order_id, { platform: e.target.value })} />
                          </Box>
                          <Box>
                            <FieldLabel>Kit / lot number</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} value={o.lot} onChange={(e) => patchOrder(sp.specimen_id, o.order_id, { lot: e.target.value })} />
                          </Box>
                        </Box>

                        {/* Result */}
                        <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }}>
                          Result
                        </Typography>
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                          <Box>
                            <FieldLabel>Result</FieldLabel>
                            <Sel label="Result" options={vocab} value={o.result.qualitative} onChange={(v) => patchResult(sp.specimen_id, o.order_id, "qualitative", v)} />
                          </Box>
                          {assay?.unit ? (
                            <Box>
                              <FieldLabel>Quantitative ({assay.unit})</FieldLabel>
                              <TextField size="small" fullWidth sx={inputSx} placeholder={assay.unit} value={o.result.quantitative} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "quantitative", e.target.value)} />
                            </Box>
                          ) : (
                            <Box />
                          )}
                          <Box>
                            <FieldLabel>Interpretation</FieldLabel>
                            <Sel label="Interpretation" options={SEROLOGY_INTERPRETATION_OPTIONS} value={o.result.interpretation} onChange={(v) => patchResult(sp.specimen_id, o.order_id, "interpretation", v)} />
                          </Box>
                          <Box>
                            <FieldLabel>Cut-off / reference</FieldLabel>
                            <TextField size="small" fullWidth sx={inputSx} value={o.result.cut_off} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "cut_off", e.target.value)} />
                          </Box>
                          <Box>
                            <FieldLabel>Result datetime</FieldLabel>
                            <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={o.result.result_datetime} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "result_datetime", e.target.value)} InputLabelProps={{ shrink: true }} />
                          </Box>
                          <Box />
                          <Box sx={{ gridColumn: "1 / -1" }}>
                            <FieldLabel>Interpretation note (equivocal / nuance)</FieldLabel>
                            <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={o.result.note} onChange={(e) => patchResult(sp.specimen_id, o.order_id, "note", e.target.value)} />
                          </Box>
                        </Box>

                        {reflexHit && (
                          <Box sx={{ mt: 1.5, px: 2, py: 1.25, border: `1px solid ${C.borderStrong}`, background: C.bgSecondary }}>
                            <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                              ↪ <b>Reflex</b> — {assay.reflex}
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
                            disabled={!o.result?.qualitative && !o.result?.quantitative || isSaving}
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

            <Button onClick={() => addOrder(sp.specimen_id, seroTests[0])} sx={{ ...outlineBtnSx, px: 2.5 }}>
              <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add Serology Order
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
        <Button onClick={saveSerology} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Serology"}
        </Button>
      </Box>
    </Box>
  );
}
