// tabs/MycobacteriologyTab.jsx — Microbiology Tab 10: Mycobacteriology / AFB
//
// The AFB long track runs on a very different timescale (smear in hours, LJ
// culture 6–8 wks, DST +3–4 wks). Per the agreed split, the *culture reads*
// themselves live in the shared Tab 4/5 track (readScheduleFor already seeds
// weekly-to-Wk-8 reads for lj_mgit specimens), so this tab is the AFB smear
// cross-link + mycobacterial speciation + DST layer:
//   mycobacteriology = {
//     [specimen_id]: {
//       isolates: [
//         {
//           isolate_id, species, id_method, id_notes,
//           dst: { method,
//                  first_line:  [ { drug, result } ],    // MYCO_FIRST_LINE_PANEL
//                  second_line: [ { drug, result } ],    // MYCO_SECOND_LINE_PANEL (gated)
//                  notes },
//           prelim,
//         }
//       ]
//     }
//   }
//
// DST: first-line always shown; second-line revealed only when first-line
// resistance is flagged. The DS / RR / MDR / pre-XDR / XDR classification is
// derived deterministically from the recorded results by mycoClassification
// (constants), which delegates to the same rule the tNGS panel (Tab 15) uses —
// WHO 2021 definitions, keyed on the fluoroquinolones and on bedaquiline or
// linezolid rather than on the injectables. Never free-typed.
//
// AFB smear: read from direct_examination (Tab 3) when present — cross-linked,
// not re-entered. Send Preliminary dispatches a versioned entry; MTBC-confirmed
// isolates are flagged notifiable (public-health).

import React, { useEffect, useState } from "react";
import {
  Box, Typography, TextField, Button, IconButton,
} from "@mui/material";
import { AddRounded, DeleteOutlineRounded, SendRounded } from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  SectionBox, FieldLabel, Sel, RdoGroup,
} from "../../shared/FormComponents";
import {
  mycoTestsFor,
  MYCO_SPECIES_OPTIONS,
  MYCO_ID_METHOD_OPTIONS,
  MYCO_DST_METHOD_OPTIONS,
  MYCO_DST_RESULT_OPTIONS,
  MYCO_FIRST_LINE_PANEL,
  MYCO_SECOND_LINE_PANEL,
  mycoFirstLineResistance,
  mycoClassification,
  TB_CLASSIFICATION_NOTES,
} from "../constants";
import { summarizeMycoIsolate } from "../shared/resultSummaries";

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

// ─── Record defaults + hydration ──────────────────────────────────────────────

const firstLineRow = (d) => ({ drug: d.drug, result: "" });
const secondLineRow = (d) => ({ drug: d.drug, result: "" });

const blankIsolate = () => ({
  isolate_id: makeUid("MISO"),
  species: "",
  id_method: "",
  id_notes: "",
  dst: {
    method: "",
    first_line: MYCO_FIRST_LINE_PANEL.map(firstLineRow),
    second_line: MYCO_SECOND_LINE_PANEL.map(secondLineRow),
    notes: "",
  },
  prelim: null,
});

const hydrateRow = (row, drug) => ({
  drug,
  result: (row && row.result) || "",
});

const hydrateIsolate = (s) => ({
  ...blankIsolate(),
  ...s,
  dst: {
    method: s?.dst?.method || "",
    first_line: MYCO_FIRST_LINE_PANEL.map((d) => hydrateRow((s?.dst?.first_line || []).find((r) => r.drug === d.drug), d.drug)),
    second_line: MYCO_SECOND_LINE_PANEL.map((d) => hydrateRow((s?.dst?.second_line || []).find((r) => r.drug === d.drug), d.drug)),
    notes: s?.dst?.notes || "",
  },
  prelim: s?.prelim || null,
});

const blankSpecimen = () => ({ isolates: [] });

const hydrateSpecimen = (saved) => ({
  isolates: Array.isArray(saved?.isolates) ? saved.isolates.map(hydrateIsolate) : [],
});

// ─── Summary / flags ──────────────────────────────────────────────────────────

const mtbcSelected = (species) => /M\.?\s*tuberculosis complex|MTBC/i.test(String(species || ""));

// Notifiable flag: MTBC confirmed by culture → public-health notification.
const notifiableFlag = (iso) =>
  mtbcSelected(iso.species)
    ? { notifiable: true, notifiable_reason: "Mycobacterium tuberculosis complex isolated — notifiable, public-health notification required" }
    : { notifiable: false, notifiable_reason: "" };

// Human summary for the preliminary.
export default function MycobacteriologyTab({
  doctorId,
  doctorName,
  caseId,
  initialData,        // mycobacteriology section: { [specimen_id]: { isolates: [] } }
  directExamData,     // direct_examination section (AFB smear cross-link)
  preliminaryReports, // preliminary_reports section (versioned dispatch)
  caseRegister,       // case_register (specimens + tests)
  onSave,             // (tabKey, data) dispatch — "mycobacteriology" | "preliminary"
}) {
  const [blocks, setBlocks] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];

  useEffect(() => {
    const hydrated = {};
    specimens.forEach((sp) => {
      if (mycoTestsFor(sp.tests_ordered).length === 0) return;
      const saved = (initialData && initialData[sp.specimen_id]) || {};
      hydrated[sp.specimen_id] = hydrateSpecimen(saved);
    });
    setBlocks(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const patchIsolate = (specimenId, isolateId, patchObj) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        isolates: prev[specimenId].isolates.map((s) => (s.isolate_id === isolateId ? { ...s, ...patchObj } : s)),
      },
    }));

  const patchDst = (specimenId, isolateId, patchObj) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        isolates: prev[specimenId].isolates.map((s) =>
          s.isolate_id === isolateId ? { ...s, dst: { ...s.dst, ...patchObj } } : s
        ),
      },
    }));

  const patchDstRow = (specimenId, isolateId, which, drug, result) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        isolates: prev[specimenId].isolates.map((s) =>
          s.isolate_id === isolateId
            ? { ...s, dst: { ...s.dst, [which]: s.dst[which].map((r) => (r.drug === drug ? { ...r, result } : r)) } }
            : s
        ),
      },
    }));

  const addIsolate = (specimenId) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: { ...prev[specimenId], isolates: [...prev[specimenId].isolates, blankIsolate()] },
    }));

  const removeIsolate = (specimenId, isolateId) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: { ...prev[specimenId], isolates: prev[specimenId].isolates.filter((s) => s.isolate_id !== isolateId) },
    }));

  const saveMyco = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("mycobacteriology", blocks);
    } catch (err) {
      console.error("[MycobacteriologyTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const sendPreliminary = async (sp, iso) => {
    if (!iso.species) { setNotice("Record the species before sending a preliminary."); return; }
    setNotice("");
    setIsSaving(true);
    try {
      const summary = summarizeMycoIsolate(iso);
      const nf = notifiableFlag(iso);
      const versions = Array.isArray(preliminaryReports?.versions) ? preliminaryReports.versions : [];
      const version = {
        version: versions.length + 1,
        source_tab: "Mycobacteriology",
        content_type: "myco",
        isolate_id: iso.isolate_id,
        specimen_id: sp.specimen_id,
        specimen_type: sp.specimen_type || "",
        dispatched_at: new Date().toISOString(),
        dispatched_by: doctorName || doctorId || "",
        summary,
        result: {
          species: iso.species,
          id_method: iso.id_method,
          first_line: iso.dst?.first_line,
          second_line: iso.dst?.second_line,
        },
        ...(nf.notifiable ? { notifiable: true, notifiable_reason: nf.notifiable_reason } : {}),
      };
      const merged = { ...(preliminaryReports && typeof preliminaryReports === "object" ? preliminaryReports : {}), versions: [...versions, version] };
      await onSave("preliminary", merged);
      patchIsolate(sp.specimen_id, iso.isolate_id, { prelim: { version: version.version, dispatched_at: version.dispatched_at, notifiable: nf.notifiable } });
    } catch (err) {
      console.error("[MycobacteriologyTab] preliminary dispatch error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const activeSpecimens = specimens.filter((sp) => mycoTestsFor(sp.tests_ordered).length > 0);

  if (activeSpecimens.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>
          No mycobacteriology ordered. Add AFB smear / LJ-MGIT culture to a specimen in Registration & Accession.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        AFB long track. Culture reads and the weekly-to-Wk-8 schedule are handled by Culture Setup / Culture Workup;
        this tab records mycobacterial speciation and DST. First-line DST is always shown; second-line drugs reveal only
        when first-line resistance is flagged. The DS / RR / MDR / pre-XDR / XDR classification derives
        automatically from the recorded results (WHO 2021 rule).
      </Typography>

      {activeSpecimens.map((sp, i) => {
        const block = blocks[sp.specimen_id] || blankSpecimen();

        // Cross-link: AFB smear already recorded in Tab 3 direct_examination.
        const de = (directExamData && directExamData[sp.specimen_id]) || {};
        const afbSmear = Array.isArray(de.exams)
          ? de.exams.find((e) => e.exam_type === "afb_smear")
          : undefined;

        return (
          <SectionBox
            key={sp.specimen_id}
            title={`Specimen ${i + 1} — ${sp.specimen_type || "Unspecified"} · ${sp.specimen_id}`}
          >
            {/* AFB smear cross-link (read-only from Tab 3) */}
            <Box sx={{ mb: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
              {afbSmear && (afbSmear.result?.grade || afbSmear.result?.method) ? (
                <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                  <b>AFB smear</b> (Direct Examination) — {afbSmear.result.grade || "grade not recorded"}
                  {afbSmear.result.method ? ` · ${afbSmear.result.method}` : ""}
                  {afbSmear.result.fields_examined ? ` · ${afbSmear.result.fields_examined} fields` : ""}
                </Typography>
              ) : (
                <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>
                  AFB smear not yet recorded — add it in Direct Examination (Tab 3). It cross-links here when present.
                </Typography>
              )}
            </Box>

            {block.isolates.length === 0 && (
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
                No mycobacterial isolates yet. Add one once culture growth is confirmed (Tab 5).
              </Typography>
            )}

            {block.isolates.map((iso) => {
              const fl = mycoFirstLineResistance(iso.dst?.first_line);
              // Same rule as Tab 15's tNGS panel, so the two cannot disagree.
              // "" means no DST recorded yet — not the same as susceptible.
              const cls = mycoClassification(iso.dst?.first_line, iso.dst?.second_line);
              const nf = notifiableFlag(iso);
              const showSecondLine = fl.resistant.length > 0;

              return (
                <Box key={iso.isolate_id} sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.bgTertiary }}>
                  <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, borderBottom: `1px solid ${C.border}`, background: C.bgSecondary, flexWrap: "wrap" }}>
                    <Box sx={{ flex: "1 1 300px" }}>
                      <FieldLabel>Species</FieldLabel>
                      <Sel label="Species" options={MYCO_SPECIES_OPTIONS} value={iso.species} onChange={(v) => patchIsolate(sp.specimen_id, iso.isolate_id, { species: v })} />
                    </Box>
                    <Box sx={{ flex: "1 1 300px" }}>
                      <FieldLabel>ID method</FieldLabel>
                      <Sel label="ID method" options={MYCO_ID_METHOD_OPTIONS} value={iso.id_method} onChange={(v) => patchIsolate(sp.specimen_id, iso.isolate_id, { id_method: v })} />
                    </Box>
                    <IconButton size="small" onClick={() => removeIsolate(sp.specimen_id, iso.isolate_id)} sx={{ color: C.textSecond, "&:hover": { color: C.black } }}>
                      <DeleteOutlineRounded fontSize="small" />
                    </IconButton>
                  </Box>

                  <Box sx={{ p: 2 }}>
                    <Box sx={{ mb: 2 }}>
                      <FieldLabel>ID notes (e.g. growth speed, pigment, LPA bands)</FieldLabel>
                      <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={iso.id_notes} onChange={(e) => patchIsolate(sp.specimen_id, iso.isolate_id, { id_notes: e.target.value })} />
                    </Box>

                    {/* DST */}
                    <Box sx={{ mb: 1.5 }}>
                      <FieldLabel>DST method</FieldLabel>
                      <Sel label="DST method" options={MYCO_DST_METHOD_OPTIONS} value={iso.dst.method} onChange={(v) => patchDst(sp.specimen_id, iso.isolate_id, { method: v })} />
                    </Box>

                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                      {/* First-line */}
                      <Box sx={{ flex: "1 1 340px", minWidth: 300 }}>
                        <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.5 }}>
                          First-line
                        </Typography>
                        {iso.dst.first_line.map((row) => {
                          const panel = MYCO_FIRST_LINE_PANEL.find((d) => d.drug === row.drug);
                          return (
                            <Box key={row.drug} sx={{ display: "grid", gridTemplateColumns: "1fr 150px 170px", gap: 0.75, alignItems: "center", mb: 0.5 }}>
                              <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>{panel?.label}</Typography>
                              <RdoGroup
                                label=""
                                row
                                options={MYCO_DST_RESULT_OPTIONS}
                                value={row.result}
                                onChange={(v) => patchDstRow(sp.specimen_id, iso.isolate_id, "first_line", row.drug, v)}
                              />
                              <Typography sx={{ fontSize: 10.5, fontFamily: FONT, color: C.textMuted }}>{panel?.concentration}</Typography>
                            </Box>
                          );
                        })}
                      </Box>

                      {/* Second-line (gated) */}
                      <Box sx={{ flex: "1 1 340px", minWidth: 300 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
                          <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                            Second-line
                          </Typography>
                          {!showSecondLine && (
                            <Typography sx={{ fontSize: 10.5, fontFamily: FONT, color: C.textMuted }}>
                              (locked until first-line resistance)
                            </Typography>
                          )}
                        </Box>
                        {!showSecondLine ? (
                          <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                            No first-line resistance recorded — second-line drugs stay hidden.
                          </Typography>
                        ) : (
                          iso.dst.second_line.map((row) => {
                            const panel = MYCO_SECOND_LINE_PANEL.find((d) => d.drug === row.drug);
                            return (
                              <Box key={row.drug} sx={{ display: "grid", gridTemplateColumns: "1fr 150px 140px", gap: 0.75, alignItems: "center", mb: 0.5 }}>
                                <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>{panel?.label}</Typography>
                                <RdoGroup
                                  label=""
                                  row
                                  options={MYCO_DST_RESULT_OPTIONS}
                                  value={row.result}
                                  onChange={(v) => patchDstRow(sp.specimen_id, iso.isolate_id, "second_line", row.drug, v)}
                                />
                                <Typography sx={{ fontSize: 10.5, fontFamily: FONT, color: C.textMuted }}>{panel?.category}</Typography>
                              </Box>
                            );
                          })
                        )}
                      </Box>
                    </Box>

                    {/* Classification, derived from BOTH panels — shown once for the
                        isolate rather than as separate MDR / XDR banners. */}
                    {cls && cls !== "DS-TB" && (
                      <Box sx={{ mt: 1.5, px: 1.5, py: 0.75, border: `1px solid ${C.black}`, background: C.white }}>
                        <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textPrimary }}>
                          <b>{cls}</b> — {TB_CLASSIFICATION_NOTES[cls]}
                        </Typography>
                      </Box>
                    )}

                    <Box sx={{ mt: 1.5 }}>
                      <FieldLabel>DST notes</FieldLabel>
                      <TextField size="small" fullWidth sx={inputSx} value={iso.dst.notes} onChange={(e) => patchDst(sp.specimen_id, iso.isolate_id, { notes: e.target.value })} />
                    </Box>

                    {nf.notifiable && (
                      <Box sx={{ mt: 1.5, px: 2, py: 1.25, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
                        <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                          ⚠ <b>Notifiable</b> — {nf.notifiable_reason}
                        </Typography>
                      </Box>
                    )}

                    <Box sx={{ mt: 1.5, display: "flex", justifyContent: "flex-end", gap: 1, alignItems: "center" }}>
                      {iso.prelim && (
                        <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
                          Preliminary v{iso.prelim.version} dispatched {iso.prelim.dispatched_at ? new Date(iso.prelim.dispatched_at).toLocaleString() : ""}
                        </Typography>
                      )}
                      <Button
                        onClick={() => sendPreliminary(sp, iso)}
                        disabled={!iso.species || isSaving}
                        sx={{ ...outlineBtnSx, py: 0.6, px: 2, fontSize: 11 }}
                      >
                        <SendRounded sx={{ mr: 0.5, fontSize: 14 }} /> Send Preliminary
                      </Button>
                    </Box>
                  </Box>
                </Box>
              );
            })}

            <Button onClick={() => addIsolate(sp.specimen_id)} sx={{ ...outlineBtnSx, px: 2.5 }}>
              <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add Mycobacterial Isolate
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
        <Button onClick={saveMyco} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Mycobacteriology"}
        </Button>
      </Box>
    </Box>
  );
}
