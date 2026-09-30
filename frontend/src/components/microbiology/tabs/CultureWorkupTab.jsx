// tabs/CultureWorkupTab.jsx — Microbiology Tab 5: Culture workup (5A · 5B · 5C)
//
// The core analytical tab. One sidebar entry ("Culture Workup") holding three
// sub-sections, switched by a sub-tab bar at the top of the centre pane:
//   5A Plate reading      — repeatable, timestamped read events
//   5B Organism ID        — one record per isolate selected for work-up
//   5C Antimicrobial AST  — per-antibiotic result rows + QC + resistance flags
//
// Persistence model (plan: no split sections):
//   culture_workup = {
//     [specimen_id]: {
//       reads:     [ { read_id, label, tech, read_at, …plate/growth fields… } ],
//       isolates:  [ { isolate_id, from_read_id, …5B fields…, ast: {…5C…} } ]
//     }
//   }
//
// Flow (the plan's specific requirements):
//   • Reads ACCUMULATE — the tab never "completes". New read events are seeded
//     from the Tab 4 read schedule and added as the incubation window passes.
//   • Growth on a read lets the tech spawn an isolate (5B).
//   • 5C AST unlocks only once that isolate has a confirmed organism ID (5B).
//   • A Send Preliminary is available at any read and per confirmed isolate.
//   Soft-gated throughout: a view is always open but explains what must happen
//   first when nothing qualifies.

import React, { useEffect, useState, useMemo, Fragment } from "react";
import {
  Box, Typography, TextField, Button, IconButton, Autocomplete,
} from "@mui/material";
import { AddRounded, DeleteOutlineRounded, SendRounded } from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  FieldLabel, Sel, CbxGroup, RdoGroup, SubTabBar,
} from "../../shared/FormComponents";
import {
  readScheduleFor,
  cultureTestsFor,
  ID_METHOD_DETAIL_FIELDS, maldiScoreConfidence,
  AST_METHOD_DETAIL_FIELDS,
  CULTURE_GROWTH_OPTIONS, CULTURE_BC_POSITIVE_OPTIONS,
  QUANTITY_SEMI_OPTIONS, QUANTITY_URINE_OPTIONS, COLONY_FEATURE_OPTIONS,
  MIXED_GROWTH_OPTIONS, CONTAMINATION_OPTIONS,
  ID_METHOD_OPTIONS, CONFIDENCE_OPTIONS, SIGNIFICANCE_OPTIONS, ID_REFLEX_OPTIONS,
  AST_METHOD_OPTIONS, BREAKPOINT_SOURCE_OPTIONS, INTERPRETATION_OPTIONS,
  QC_RESULT_OPTIONS, RESISTANCE_FLAG_OPTIONS,
} from "../constants";
import { applyCascade, suggestedPanel, normalizeAntibiotic, resolveAstProfile } from "../shared/cascade";
import { COMMON_ORGANISMS, ALL_ANTIBIOTICS } from "../shared/astData";

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

const toArray = (v) => (Array.isArray(v) ? v : []);

// Anaerobe profiles get the CLSI M11 "No AST" option (AST not routine for most
// anaerobes — run for sterile-site isolates / B. fragilis group / treatment failure).
const ANAEROBE_PROFILE_KEYS = new Set(["bacteroides", "clostridium", "anaerobe_gnr", "anaerobe_gpc"]);
const isAnaerobeProfile = (key) => ANAEROBE_PROFILE_KEYS.has(key);

// Tab 5 option vocabulary (growth/quantity/ID/AST/QC/flags) is centralised in
// ../constants so panels & flags grow without touching this file.

// ─── Factories ────────────────────────────────────────────────────────────────

const blankRead = (label = "") => ({
  read_id: makeUid("READ"),
  label,
  tech: "",
  read_at: "",
  plate_growth: "",
  quantity_semi: "",
  quantity_urine: "",
  colony_features: [],
  mixed_growth: "",
  contamination: "",
  contamination_reason: "",
  blood_positive: "",
  blood_ttp_hours: "",
  blood_gram_broth: "",
  notes: "",
  prelim: null,
});

const blankAntibiotic = (antibiotic = "") => ({
  antibiotic,
  method_value: "",
  interpretation: "",
  override_reason: "",
});

const blankAst = () => ({
  method: "",
  method_detail: {},           // per-method detail (see AST_METHOD_DETAIL_FIELDS)
  qc_organism: "",
  qc_result: "",
  breakpoint_source: "",
  resistance_flags: [],
  antibiotics: [],
  no_ast_reason: "",
  notes: "",
});

const blankIsolate = (from_read_id = "") => ({
  isolate_id: makeUid("ISO"),
  from_read_id,
  colony_morphotype: "",
  colony_count_at_selection: "",
  id_detail: {},                 // method-specific detail (see ID_METHOD_DETAIL_FIELDS)
  id_method: "",
  organism: "",
  confidence: "",
  db_version: "",
  identified_at: "",
  performed_by: "",
  significance: "",
  reflex: "",
  reflex_reason: "",
  id_notes: "",
  ast: blankAst(),
  prelim: null,
});

const blankSpecimen = (sp, saved = {}) => ({
  reads: toArray(saved?.reads).map((r) => ({ ...blankRead(), ...r, colony_features: toArray(r.colony_features) })),
  isolates: toArray(saved?.isolates).map((iso) => ({
    ...blankIsolate(),
    ...iso,
    colony_features: toArray(iso.colony_features),
    id_detail: { ...(iso.id_detail || {}) },
    ast: { ...blankAst(), ...(iso.ast || {}), antibiotics: toArray(iso?.ast?.antibiotics), resistance_flags: toArray(iso?.ast?.resistance_flags), method_detail: { ...(iso?.ast?.method_detail || {}) } },
  })),
});

const isBloodCultureSpecimen = (sp) =>
  (Array.isArray(sp?.tests_ordered) && sp.tests_ordered.includes("blood_culture")) ||
  /blood culture/i.test(sp?.specimen_type || "");

const isUrineSpecimen = (sp) => /urine/i.test(sp?.specimen_type || "");

export default function CultureWorkupTab({
  doctorId,
  doctorName,
  caseId,
  initialData,          // culture_workup section
  preliminaryReports,   // preliminary_reports (for versioned dispatch)
  cultureSetup,         // culture_setup (Tab 4 schedule → read seeding)
  caseRegister,         // case_register (specimens + tests)
  onSave,               // (tabKey, data) dispatch — "culture-workup" | "preliminary"
}) {
  const [records, setRecords] = useState({});
  const [subTab, setSubTab] = useState(0);
  const [focusSpecimenId, setFocusSpecimenId] = useState("");
  const [focusIsolateId, setFocusIsolateId] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];
  // Only specimens with a culture test ordered are worked up here. Records for
  // every specimen are still hydrated below, so a stored culture_workup block
  // (isolates / AST) is never dropped from the section if a specimen's ordered
  // tests change.
  const cultureSpecimens = specimens.filter((sp) => cultureTestsFor(sp.tests_ordered).length > 0);
  const spec = cultureSpecimens.find((s) => s.specimen_id === focusSpecimenId) || cultureSpecimens[0] || null;

  // Hydrate on case change; default focus to the first culture specimen.
  useEffect(() => {
    const saved = (initialData && typeof initialData === "object") ? initialData : {};
    const hydrated = {};
    specimens.forEach((sp) => { hydrated[sp.specimen_id] = blankSpecimen(sp, saved[sp.specimen_id]); });
    setRecords(hydrated);
    setFocusSpecimenId((prev) => (cultureSpecimens.some((s) => s.specimen_id === prev) ? prev : (cultureSpecimens[0]?.specimen_id || "")));
    setFocusIsolateId("");
    setSubTab(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const record = (cultureSpecimens.length && records[spec?.specimen_id]) || blankSpecimen(spec || {});
  const isolates = record.isolates || [];
  const focusIsolate = isolates.find((i) => i.isolate_id === focusIsolateId) || isolates[0] || null;

  const patchRecord = (patchObj) => {
    if (!spec) return;
    setRecords((prev) => ({ ...prev, [spec.specimen_id]: { ...prev[spec.specimen_id], ...patchObj } }));
  };

  const patchIsolate = (isolateId, patchObj) =>
    patchRecord({
      isolates: isolates.map((i) => (i.isolate_id === isolateId ? { ...i, ...patchObj } : i)),
    });

  const patchAst = (isolateId, patchObj) =>
    patchIsolate(isolateId, { ast: { ...(isolates.find((i) => i.isolate_id === isolateId)?.ast || {}), ...patchObj } });

  const patchRead = (readId, patchObj) =>
    patchRecord({ reads: record.reads.map((r) => (r.read_id === readId ? { ...r, ...patchObj } : r)) });

  // Config-driven 5B method-detail sub-fields for the focused isolate's ID method.
  // Field config lives in constants (ID_METHOD_DETAIL_FIELDS); values are stored
  // flat on isolate.id_detail. MALDI score auto-suggests the confidence level.
  const renderMethodDetail = () => {
    if (!focusIsolate?.id_method) return null;
    const detailFields = ID_METHOD_DETAIL_FIELDS[focusIsolate.id_method] || [];
    if (detailFields.length === 0) return null;
    const idDetail = focusIsolate.id_detail || {};
    let lastGroup = "";
    const fieldBox = (f, control, full = false) => (
      <Box key={f.key} sx={{ gridColumn: full ? "1 / -1" : undefined }}>
        <FieldLabel>{f.label}</FieldLabel>
        {control}
      </Box>
    );
    const controls = detailFields.map((f) => {
      const setDetail = (value) => patchIsolate(focusIsolate.isolate_id, { id_detail: { ...idDetail, [f.key]: value } });
      const heading = (f.group && f.group !== lastGroup) ? f.group : null;
      lastGroup = f.group || lastGroup;

      let cell = null;
      if (f.key === "maldi_score") {
        const hint = maldiScoreConfidence(idDetail.maldi_score);
        cell = fieldBox(f, (
          <>
            <TextField size="small" fullWidth type="number" sx={inputSx} value={idDetail.maldi_score} onChange={(e) => {
              const v = e.target.value;
              setDetail(v);
              const auto = maldiScoreConfidence(v);
              if (auto && !focusIsolate.confidence) patchIsolate(focusIsolate.isolate_id, { confidence: auto });
            }} inputProps={{ min: 0, step: 0.01, max: 3 }} />
            <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>≥2.0 Acceptable · 1.7–1.99 Equivocal · &lt;1.7 Unreliable{hint ? ` → ${hint}` : ""}</Typography>
          </>
        ));
      } else if (f.kind === "radio") {
        cell = fieldBox(f, <RdoGroup label="" options={f.options} value={idDetail[f.key] || ""} onChange={setDetail} row />, true);
      } else if (f.kind === "multiselect") {
        const arr = Array.isArray(idDetail[f.key]) ? idDetail[f.key] : [];
        cell = fieldBox(f, <CbxGroup label="" options={f.options} value={arr} onChange={(v) => setDetail(v)} />, true);
      } else if (f.kind === "select") {
        cell = fieldBox(f, <Sel label="" options={f.options} value={idDetail[f.key] || ""} onChange={setDetail} />);
      } else {
        cell = fieldBox(f, <TextField size="small" fullWidth multiline={!!f.multiline} rows={f.multiline ? 2 : 1} sx={inputSx} value={idDetail[f.key] || ""} onChange={(e) => setDetail(e.target.value)} />, !!f.multiline);
      }

      if (!heading) return cell;
      return (
        <Fragment key={f.key}>
          <Box sx={{ gridColumn: "1 / -1", mt: 0.5 }}>
            <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: FONT, color: C.textMuted }}>{heading}</Typography>
          </Box>
          {cell}
        </Fragment>
      );
    });

    return (
      <Box sx={{ mt: 1.5, border: `1px solid ${C.border}`, p: 1.5, background: C.bgTertiary }}>
        <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: FONT, color: C.textMuted, mb: 1 }}>
          Method detail — {focusIsolate.id_method}
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
          {controls}
        </Box>
      </Box>
    );
  };

  // Config-driven AST-method detail (ast.method_detail), same schema as above.
  const renderAstMethodDetail = () => {
    if (!focusIsolate?.ast?.method) return null;
    const detailFields = AST_METHOD_DETAIL_FIELDS[focusIsolate.ast.method] || [];
    if (detailFields.length === 0) return null;
    const md = focusIsolate.ast.method_detail || {};
    const setDetail = (key, value) => patchAst(focusIsolate.isolate_id, { method_detail: { ...md, [key]: value } });
    const controls = detailFields.map((f) => (
      f.kind === "select" ? (
        <Box key={f.key}>
          <FieldLabel>{f.label}</FieldLabel>
          <Sel label="" options={f.options} value={md[f.key] || ""} onChange={(v) => setDetail(f.key, v)} />
        </Box>
      ) : (
        <Box key={f.key} sx={{ gridColumn: f.multiline ? "1 / -1" : undefined }}>
          <FieldLabel>{f.label}</FieldLabel>
          <TextField size="small" fullWidth multiline={!!f.multiline} rows={f.multiline ? 2 : 1} sx={inputSx} value={md[f.key] || ""} onChange={(e) => setDetail(f.key, e.target.value)} />
        </Box>
      )
    ));
    return (
      <Box sx={{ mt: 1.5, border: `1px solid ${C.border}`, p: 1.5, background: C.bgTertiary }}>
        <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: FONT, color: C.textMuted, mb: 1 }}>
          Method detail — {focusIsolate.ast.method}
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
          {controls}
        </Box>
      </Box>
    );
  };

  // ─── Read scheduling / seeding from Tab 4 ───────────────────────────────────
  const scheduleLabels = useMemo(() => {
    if (!spec) return [];
    const setup = (cultureSetup && cultureSetup[spec.specimen_id]) || {};
    if (Array.isArray(setup.reads) && setup.reads.length) return setup.reads.map((r) => r.label || "Read");
    return readScheduleFor(spec).map((r) => r.label);
  }, [spec, cultureSetup]);

  const addScheduledRead = () => {
    const missing = scheduleLabels.filter((label) => !record.reads.some((r) => r.label === label));
    const nextLabel = missing[0] || "";
    const read = blankRead(nextLabel);
    read.read_at = new Date().toISOString().slice(0, 16);
    patchRecord({ reads: [...record.reads, read] });
    setSubTab(0);
  };

  // Spawn an isolate from a growth read → 5B.
  const spawnIsolate = (read) => {
    const iso = blankIsolate(read.read_id);
    iso.colony_morphotype = `${read.colony_features.length ? read.colony_features.join(", ") : "Growth"} · from ${read.label || read.read_id}`;
    patchRecord({ isolates: [...record.isolates, iso] });
    setFocusIsolateId(iso.isolate_id);
    setSubTab(1);
  };

  const sendPreliminary = async (payload) => {
    setNotice("");
    setIsSaving(true);
    try {
      const versions = Array.isArray(preliminaryReports?.versions) ? preliminaryReports.versions : [];
      const version = { ...payload, source_tab: "Culture Workup", version: versions.length + 1, dispatched_at: new Date().toISOString(), dispatched_by: doctorName || doctorId || "" };
      const merged = { ...(preliminaryReports && typeof preliminaryReports === "object" ? preliminaryReports : {}), versions: [...versions, version] };
      await onSave("preliminary", merged);
      return version;
    } catch (err) {
      console.error("[CultureWorkupTab] preliminary error:", err);
      return null;
    } finally {
      setIsSaving(false);
    }
  };

  const saveWorkup = async () => {
    setNotice("");
    setIsSaving(true);
    try {
      await onSave("culture-workup", records);
    } catch (err) {
      console.error("[CultureWorkupTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (cultureSpecimens.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>
          {specimens.length === 0
            ? "No specimens registered. Add specimens in Registration & Accession first."
            : "No specimen in this case has a culture test ordered — culture workup does not apply."}
        </Typography>
      </Box>
    );
  }

  // 5C cascade result for the focused isolate (species/site-aware profile).
  const focusedProfile = focusIsolate?.organism ? resolveAstProfile(focusIsolate.organism, spec?.specimen_type) : null;
  const focusedFamily = focusedProfile?.label || "";

  // Autocomplete menu for antibiotic rows: the isolate's resolved panel first,
  // then the full canonical catalogue (free text still allowed).
  const antibioticChoices = (() => {
    if (!focusIsolate?.organism) return ALL_ANTIBIOTICS;
    const panel = suggestedPanel(focusIsolate.organism, spec?.specimen_type);
    return [...panel, ...ALL_ANTIBIOTICS.filter((x) => !panel.includes(x))];
  })();
  const cascadeRows = focusIsolate?.ast?.antibiotics
    ? applyCascade(focusedProfile, focusIsolate.ast.antibiotics, { specimenType: spec?.specimen_type })
    : [];

  const SUBTABS = [
    `Plate Reading (${record.reads.length})`,
    `Organism ID (${record.isolates.length})`,
    `AST (${focusIsolate?.ast?.antibiotics?.length || 0})`,
  ];

  return (
    <Box>
      {/* Specimen + sub-tab focus bar */}
      <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1.5, mb: 1.5, flexWrap: "wrap" }}>
        <Box sx={{ minWidth: 260, flex: "1 1 280px" }}>
          <FieldLabel>Specimen under work-up</FieldLabel>
          <Sel
            label="Specimen"
            options={cultureSpecimens.map((s) => ({ value: s.specimen_id, label: `${s.specimen_type || "Unspecified"} · ${s.specimen_id}` }))}
            value={spec?.specimen_id}
            onChange={(v) => { setFocusSpecimenId(v); setFocusIsolateId(""); }}
          />
        </Box>
        <Button onClick={addScheduledRead} sx={{ ...outlineBtnSx, py: 0.8 }}>
          <AddRounded sx={{ mr: 0.5, fontSize: 16 }} /> Add Scheduled Read
        </Button>
      </Box>

      <SubTabBar tabs={SUBTABS} active={subTab} onSelect={setSubTab} />

      {/* ═══ 5A — PLATE READING ═══════════════════════════════════════════════ */}
      {subTab === 0 && (
        <Box>
          <Typography sx={{ fontSize: 11.5, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
            Reads accumulate until the incubation window closes — each scheduled read is a separate timestamped event,
            never an overwrite. Growth on a read spawns an isolate for ID (5B).
          </Typography>

          {record.reads.length === 0 && (
            <Box sx={{ px: 2, py: 3, border: `1px dashed ${C.border}`, background: C.bgSecondary, textAlign: "center" }}>
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                No reads yet. Add a scheduled read above ({scheduleLabels[0] || "first read"} onwards).
              </Typography>
            </Box>
          )}

          {record.reads.map((read, ri) => {
            const blood = isBloodCultureSpecimen(spec);
            const urine = isUrineSpecimen(spec);
            return (
              <Box key={read.read_id} sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.white }}>
                <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, background: C.bgSecondary, borderBottom: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", fontFamily: FONT, color: C.textSecond }}>
                    Read {ri + 1} · {read.label || "Unscheduled"}
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                    {read.prelim && (
                      <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>Prelim v{read.prelim.version}</Typography>
                    )}
                    <IconButton size="small" onClick={() => patchRecord({ reads: record.reads.filter((r) => r.read_id !== read.read_id) })} sx={{ color: C.textSecond, "&:hover": { color: C.black } }}><DeleteOutlineRounded fontSize="small" /></IconButton>
                  </Box>
                </Box>

                <Box sx={{ p: 2 }}>
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                    <Box>
                      <FieldLabel>Tech</FieldLabel>
                      <TextField size="small" fullWidth sx={inputSx} value={read.tech} onChange={(e) => patchRead(read.read_id, { tech: e.target.value })} />
                    </Box>
                    <Box>
                      <FieldLabel>Read datetime</FieldLabel>
                      <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={read.read_at} onChange={(e) => patchRead(read.read_id, { read_at: e.target.value })} InputLabelProps={{ shrink: true }} />
                    </Box>
                    <Box>
                      <FieldLabel>Plate / bottle</FieldLabel>
                      <RdoGroup label="Growth" options={blood ? CULTURE_BC_POSITIVE_OPTIONS : CULTURE_GROWTH_OPTIONS} value={read.plate_growth} onChange={(v) => patchRead(read.read_id, { plate_growth: v })} row />
                    </Box>
                  </Box>

                  {(read.plate_growth === "Growth" || read.plate_growth === "Growth (bottle signals positive)") && (
                    <>
                      <Box sx={{ mt: 1.5, border: `1px solid ${C.border}`, p: 1.5, background: C.bgTertiary }}>
                        <FieldLabel>Colony morphology / features</FieldLabel>
                        <CbxGroup label="" options={COLONY_FEATURE_OPTIONS} value={read.colony_features} onChange={(v) => patchRead(read.read_id, { colony_features: v })} />
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5, mt: 1 }}>
                          <Box>
                            <FieldLabel>Quantity {urine ? "(CFU/mL)" : "(semi-quantitative)"}</FieldLabel>
                            <Sel label="Quantity" options={urine ? QUANTITY_URINE_OPTIONS : QUANTITY_SEMI_OPTIONS} value={urine ? read.quantity_urine : read.quantity_semi} onChange={(v) => urine ? patchRead(read.read_id, { quantity_urine: v }) : patchRead(read.read_id, { quantity_semi: v })} />
                          </Box>
                          <Box>
                            <FieldLabel>Mixed growth</FieldLabel>
                            <Sel label="Mixed" options={MIXED_GROWTH_OPTIONS} value={read.mixed_growth} onChange={(v) => patchRead(read.read_id, { mixed_growth: v })} />
                          </Box>
                          <Box>
                            <FieldLabel>Contamination suspicion</FieldLabel>
                            <Sel label="Contamination" options={CONTAMINATION_OPTIONS} value={read.contamination} onChange={(v) => patchRead(read.read_id, { contamination: v })} />
                          </Box>
                        </Box>
                        {read.contamination && read.contamination !== "No" && (
                          <Box sx={{ mt: 1 }}>
                            <FieldLabel>Contamination reason</FieldLabel>
                            <TextField size="small" fullWidth multiline rows={1} sx={inputSx} value={read.contamination_reason} onChange={(e) => patchRead(read.read_id, { contamination_reason: e.target.value })} />
                          </Box>
                        )}
                        {blood && read.plate_growth === "Growth (bottle signals positive)" && (
                          <Box sx={{ mt: 1.5, border: `1px solid ${C.black}`, p: 1.5, background: C.white }}>
                            <Typography sx={{ fontSize: 11, fontWeight: 600, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }}>
                              Blood-culture positive — immediate actions (CLSI M47)
                            </Typography>
                            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                              <Box>
                                <FieldLabel>TTP (h)</FieldLabel>
                                <TextField size="small" fullWidth sx={inputSx} value={read.blood_ttp_hours} onChange={(e) => patchRead(read.read_id, { blood_ttp_hours: e.target.value })} />
                              </Box>
                              <Box>
                                <FieldLabel>Gram stain of broth</FieldLabel>
                                <RdoGroup label="" options={["Performed", "Not performed"]} value={read.blood_gram_broth} onChange={(v) => patchRead(read.read_id, { blood_gram_broth: v })} row />
                              </Box>
                            </Box>
                            <Button size="small" onClick={async () => {
                              const v = await sendPreliminary({ content_type: "read", read_id: read.read_id, specimen_id: spec?.specimen_id, specimen_type: spec?.specimen_type || "", summary: `Positive blood culture at ${read.blood_ttp_hours || "?"} h — Gram stain of broth ${read.blood_gram_broth || "not recorded"}`, critical: true, critical_reason: "Positive blood culture — STAT verbal notification required" });
                              if (v) patchRead(read.read_id, { prelim: { version: v.version, dispatched_at: v.dispatched_at, critical: true } });
                            }} sx={{ ...outlineBtnSx, mt: 1, py: 0.5, px: 1.5, fontSize: 11 }}>
                              <SendRounded sx={{ mr: 0.5, fontSize: 13 }} /> Notify Clinician (Critical)
                            </Button>
                          </Box>
                        )}
                      </Box>

                      {(read.plate_growth === "Growth" || read.plate_growth === "Growth (bottle signals positive)") && (
                        <Box sx={{ mt: 1, display: "flex", justifyContent: "flex-end" }}>
                          <Button onClick={() => spawnIsolate(read)} sx={{ ...outlineBtnSx, py: 0.6, px: 2, fontSize: 11 }}>
                            <AddRounded sx={{ mr: 0.5, fontSize: 14 }} /> Select Colony → Organism ID
                          </Button>
                        </Box>
                      )}
                    </>
                  )}

                  {read.plate_growth === "No growth" && (
                    <Box sx={{ mt: 1 }}>
                      <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, fontStyle: "italic" }}>
                        No growth at {read.label || "this read"} — incubation continues{blood ? " (continuous monitor)" : ""}.
                      </Typography>
                    </Box>
                  )}

                  <Box sx={{ mt: 1.5 }}>
                    <FieldLabel>Read notes</FieldLabel>
                    <TextField size="small" fullWidth multiline rows={1} sx={inputSx} value={read.notes} onChange={(e) => patchRead(read.read_id, { notes: e.target.value })} />
                  </Box>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* ═══ 5B — ORGANISM ID ═════════════════════════════════════════════════ */}
      {subTab === 1 && (
        <Box>
          {isolates.length === 0 && (
            <Box sx={{ px: 2, py: 3, border: `1px dashed ${C.border}`, background: C.bgSecondary, textAlign: "center" }}>
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                No isolates yet. Go to Plate Reading (5A), record growth on a read, then select a colony to begin ID.
              </Typography>
            </Box>
          )}

          {isolates.length > 0 && (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
              {isolates.map((iso) => (
                <Box key={iso.isolate_id} onClick={() => setFocusIsolateId(iso.isolate_id)}
                  sx={{ px: 1.75, py: 0.7, border: `1px solid ${focusIsolateId === iso.isolate_id ? C.black : C.border}`, background: focusIsolateId === iso.isolate_id ? C.black : C.white, color: focusIsolateId === iso.isolate_id ? C.white : C.textSecond, fontSize: 11, fontFamily: FONT, cursor: "pointer", transition: "all 0.15s" }}>
                  Isolate {iso.isolate_id.slice(-5)}{iso.organism ? ` · ${iso.organism}` : " · un-ID'd"}
                </Box>
              ))}
            </Box>
          )}

          {focusIsolate && (
            <Box sx={{ border: `1px solid ${C.border}`, p: 2, background: C.white }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
                <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: FONT, color: C.textSecond }}>
                  Organism ID — isolate {focusIsolate.isolate_id.slice(-5)}
                </Typography>
                <IconButton size="small" onClick={() => patchRecord({ isolates: isolates.filter((i) => i.isolate_id !== focusIsolate.isolate_id) })} sx={{ color: C.textSecond, "&:hover": { color: C.black } }}><DeleteOutlineRounded fontSize="small" /></IconButton>
              </Box>

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
                <Box sx={{ gridColumn: "1 / -1" }}>
                  <FieldLabel>Colony morphotype / selected colony</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} value={focusIsolate.colony_morphotype} onChange={(e) => patchIsolate(focusIsolate.isolate_id, { colony_morphotype: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Colony count at selection</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} placeholder="e.g. 10–50 CFU" value={focusIsolate.colony_count_at_selection} onChange={(e) => patchIsolate(focusIsolate.isolate_id, { colony_count_at_selection: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Identification method</FieldLabel>
                  <Sel label="Method" options={ID_METHOD_OPTIONS} value={focusIsolate.id_method} onChange={(v) => patchIsolate(focusIsolate.isolate_id, { id_method: v })} />
                </Box>
                <Box>
                  <FieldLabel>Organism (genus species)</FieldLabel>
                  <Autocomplete
                    freeSolo
                    options={COMMON_ORGANISMS}
                    value={focusIsolate.organism || ""}
                    onInputChange={(_e, val) => patchIsolate(focusIsolate.isolate_id, { organism: val })}
                    renderInput={(params) => <TextField {...params} size="small" sx={inputSx} placeholder="e.g. Escherichia coli" />}
                  />
                  {focusIsolate.organism && !focusedFamily && (
                    <Typography sx={{ fontSize: 10.5, fontWeight: 600, fontFamily: FONT, color: C.textSecond, mt: 0.5 }}>
                      ⚠ Unrecognised organism — no AST panel / cascade. Pick from the list or check the spelling.
                    </Typography>
                  )}
                </Box>
                <Box>
                  <FieldLabel>Confidence</FieldLabel>
                  <Sel label="Confidence" options={CONFIDENCE_OPTIONS} value={focusIsolate.confidence} onChange={(v) => patchIsolate(focusIsolate.isolate_id, { confidence: v })} />
                </Box>
                {focusIsolate.confidence && (
                  <Box>
                    <FieldLabel>Reflex if equivocal / unreliable</FieldLabel>
                    <Sel label="Reflex" options={ID_REFLEX_OPTIONS} value={focusIsolate.reflex} onChange={(v) => patchIsolate(focusIsolate.isolate_id, { reflex: v })} />
                  </Box>
                )}
                <Box>
                  <FieldLabel>Database / panel version</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} value={focusIsolate.db_version} onChange={(e) => patchIsolate(focusIsolate.isolate_id, { db_version: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Identified at</FieldLabel>
                  <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={focusIsolate.identified_at} onChange={(e) => patchIsolate(focusIsolate.isolate_id, { identified_at: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Performed by</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} placeholder="Technologist / microbiologist" value={focusIsolate.performed_by} onChange={(e) => patchIsolate(focusIsolate.isolate_id, { performed_by: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Clinical significance</FieldLabel>
                  <Sel label="Significance" options={SIGNIFICANCE_OPTIONS} value={focusIsolate.significance} onChange={(v) => patchIsolate(focusIsolate.isolate_id, { significance: v })} />
                </Box>
                <Box sx={{ gridColumn: "1 / -1" }}>
                  <FieldLabel>ID notes</FieldLabel>
                  <TextField size="small" fullWidth multiline rows={1} sx={inputSx} value={focusIsolate.id_notes} onChange={(e) => patchIsolate(focusIsolate.isolate_id, { id_notes: e.target.value })} />
                </Box>
              </Box>

              {renderMethodDetail()}

              <Box sx={{ mt: 2, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 1 }}>
                <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted }}>
                  {focusIsolate.organism
                    ? <>Confirmed as <b>{focusIsolate.organism}</b>{focusedFamily ? ` · ${focusedFamily}` : ""} — AST (5C) is unlocked.</>
                    : "Confirm an organism name above to unlock AST (5C)."}
                </Typography>
                <Button onClick={async () => {
                  if (!focusIsolate.organism) { setNotice("Record the organism name before sending an ID preliminary."); return; }
                  const idBits = [];
                  const did = focusIsolate.id_detail || {};
                  if (did.maldi_score) idBits.push(`MALDI score ${did.maldi_score}`);
                  if (did.germ_tube) idBits.push(`germ tube ${did.germ_tube}`);
                  if (did.chromagar_colour) idBits.push(`CHROMagar ${did.chromagar_colour}`);
                  if (did.aerotolerance) idBits.push(`aerotolerance: ${did.aerotolerance}`);
                  if (did.seq_target) idBits.push(`target ${did.seq_target}`);
                  const v = await sendPreliminary({ content_type: "id", isolate_id: focusIsolate.isolate_id, specimen_id: spec?.specimen_id, specimen_type: spec?.specimen_type || "", summary: `${focusIsolate.organism} identified (${focusIsolate.id_method || "method not recorded"}, ${focusIsolate.confidence || "confidence not recorded"})${idBits.length ? ` — ${idBits.join("; ")}` : ""}`, result: { organism: focusIsolate.organism, confidence: focusIsolate.confidence, significance: focusIsolate.significance } });
                  if (v) patchIsolate(focusIsolate.isolate_id, { prelim: { version: v.version, dispatched_at: v.dispatched_at, critical: false } });
                }} sx={{ ...outlineBtnSx, py: 0.6, px: 2, fontSize: 11 }}>
                  <SendRounded sx={{ mr: 0.5, fontSize: 14 }} /> Send ID Preliminary
                </Button>
              </Box>
            </Box>
          )}
        </Box>
      )}

      {/* ═══ 5C — AST ════════════════════════════════════════════════════════ */}
      {subTab === 2 && (
        <Box>
          {isolates.length === 0 ? (
            <Box sx={{ px: 2, py: 3, border: `1px dashed ${C.border}`, background: C.bgSecondary, textAlign: "center" }}>
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                No isolates with a confirmed ID yet. Organism ID (5B) must confirm an isolate before AST unlocks.
              </Typography>
            </Box>
          ) : isolates.every((i) => !i.organism) ? (
            <Box sx={{ px: 2, py: 3, border: `1px dashed ${C.border}`, background: C.bgSecondary, textAlign: "center" }}>
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                Confirm an organism ID (5B) on an isolate to unlock AST.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2 }}>
              {isolates.filter((i) => i.organism).map((iso) => (
                <Box key={iso.isolate_id} onClick={() => setFocusIsolateId(iso.isolate_id)}
                  sx={{ px: 1.75, py: 0.7, border: `1px solid ${focusIsolateId === iso.isolate_id ? C.black : C.border}`, background: focusIsolateId === iso.isolate_id ? C.black : C.white, color: focusIsolateId === iso.isolate_id ? C.white : C.textSecond, fontSize: 11, fontFamily: FONT, cursor: "pointer" }}>
                  {iso.organism}
                </Box>
              ))}
            </Box>
          )}

          {focusIsolate?.organism && (
            <Box sx={{ border: `1px solid ${C.border}`, p: 2, background: C.white }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1.5 }}>
                <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: FONT, color: C.textSecond }}>
                  AST — {focusIsolate.organism}{focusedFamily ? ` (${focusedFamily})` : ""}
                </Typography>
                {focusIsolate.prelim && (
                  <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>Prelim v{focusIsolate.prelim.version}</Typography>
                )}
              </Box>

              {isAnaerobeProfile(focusedProfile?.key) && (
                <Box sx={{ mb: 1.5, border: `1px solid ${C.border}`, p: 1.5, background: C.bgSecondary }}>
                  <FieldLabel>Anaerobic AST decision</FieldLabel>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                    <Button size="small" onClick={() => patchAst(focusIsolate.isolate_id, { no_ast_reason: focusIsolate.ast.no_ast_reason ? "" : "No AST — empiric therapy per institutional anaerobe protocol" })} sx={{ ...outlineBtnSx, py: 0.5, px: 1.5, fontSize: 11 }}>
                      {focusIsolate.ast.no_ast_reason ? "Clear 'No AST' record" : "Record No AST (empiric per protocol)"}
                    </Button>
                    <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
                      Anaerobe AST is not routine — run for sterile-site isolates, the B. fragilis group, or suspected resistance (CLSI M11).
                    </Typography>
                  </Box>
                  {focusIsolate.ast.no_ast_reason && (
                    <Box sx={{ mt: 1 }}>
                      <TextField size="small" fullWidth multiline rows={1} sx={inputSx} value={focusIsolate.ast.no_ast_reason} onChange={(e) => patchAst(focusIsolate.isolate_id, { no_ast_reason: e.target.value })} />
                    </Box>
                  )}
                </Box>
              )}

              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "repeat(4, 1fr)" }, gap: 1.5 }}>
                <Box sx={{ gridColumn: { xs: "1", md: "1 / 3" } }}>
                  <FieldLabel>AST method</FieldLabel>
                  <Sel label="Method" options={AST_METHOD_OPTIONS} value={focusIsolate.ast.method} onChange={(v) => patchAst(focusIsolate.isolate_id, { method: v })} />
                </Box>
                <Box>
                  <FieldLabel>QC organism</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} value={focusIsolate.ast.qc_organism} onChange={(e) => patchAst(focusIsolate.isolate_id, { qc_organism: e.target.value })} />
                  {(focusedProfile?.qcOrganisms || []).length > 0 && (
                    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mt: 0.5 }}>
                      {(focusedProfile.qcOrganisms || []).map((strain) => (
                        <Box key={strain} onClick={() => patchAst(focusIsolate.isolate_id, { qc_organism: strain })}
                          sx={{ px: 1, py: 0.3, fontSize: 10, fontFamily: FONT, cursor: "pointer", border: `1px solid ${focusIsolate.ast.qc_organism === strain ? C.black : C.border}`, background: focusIsolate.ast.qc_organism === strain ? C.black : C.white, color: focusIsolate.ast.qc_organism === strain ? C.white : C.textSecond }}>
                          {strain}
                        </Box>
                      ))}
                    </Box>
                  )}
                </Box>
                <Box>
                  <FieldLabel>QC result</FieldLabel>
                  <Sel label="QC" options={QC_RESULT_OPTIONS} value={focusIsolate.ast.qc_result} onChange={(v) => patchAst(focusIsolate.isolate_id, { qc_result: v })} />
                </Box>
                <Box sx={{ gridColumn: { xs: "1", md: "1 / 3" } }}>
                  <FieldLabel>Breakpoint source</FieldLabel>
                  <Sel label="Breakpoints" options={BREAKPOINT_SOURCE_OPTIONS} value={focusIsolate.ast.breakpoint_source} onChange={(v) => patchAst(focusIsolate.isolate_id, { breakpoint_source: v })} />
                </Box>
                <Box sx={{ gridColumn: { xs: "1", md: "1 / -1" } }}>
                  <FieldLabel>Resistance mechanism flags</FieldLabel>
                  <CbxGroup
                    label=""
                    options={RESISTANCE_FLAG_OPTIONS}
                    value={focusIsolate.ast.resistance_flags}
                    onChange={(v) => patchAst(focusIsolate.isolate_id, { resistance_flags: v })}
                  />
                </Box>
              </Box>

              {renderAstMethodDetail()}

              {focusIsolate.ast.qc_result === "Out of range" && (
                <Box sx={{ mt: 1.5, px: 2, py: 1, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                    ⚠ QC out of range — patient results must not be reported until QC passes (CLSI M100).
                  </Typography>
                </Box>
              )}

              {/* Antibiotic rows */}
              <Box sx={{ mt: 2 }}>
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1 }}>
                  <FieldLabel>Antibiotic results</FieldLabel>
                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                    <Button size="small" onClick={() => {
                      const already = new Set(focusIsolate.ast.antibiotics.map((a) => normalizeAntibiotic(a.antibiotic)));
                      const toAdd = suggestedPanel(focusIsolate.organism, spec?.specimen_type).filter((abx) => !already.has(normalizeAntibiotic(abx)));
                      if (toAdd.length === 0) { setNotice("All suggested agents are already added."); return; }
                      patchAst(focusIsolate.isolate_id, { antibiotics: [...focusIsolate.ast.antibiotics, ...toAdd.map(blankAntibiotic)] });
                    }} sx={{ ...outlineBtnSx, py: 0.5, px: 1.5, fontSize: 10 }}>+ Add all suggested</Button>
                    <Button size="small" onClick={() => patchAst(focusIsolate.isolate_id, { antibiotics: [...focusIsolate.ast.antibiotics, blankAntibiotic("")] })} sx={{ ...outlineBtnSx, py: 0.5, px: 1.5, fontSize: 10 }}>+ Custom</Button>
                  </Box>
                </Box>

                <Box sx={{ border: `1px solid ${C.border}`, overflowX: "auto" }}>
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 90px 70px 120px", lg: "1fr 130px 70px 130px 120px" }, gap: 0, minWidth: 560, borderBottom: `1px solid ${C.border}`, background: C.bgTertiary }}>
                    {["Antibiotic", "Zone / MIC", "S/I/R", "Cascade", ""].map((h, hi) => (
                      <Typography key={hi} sx={{ px: 1.5, py: 1, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: FONT, color: C.textMuted }}>{h}</Typography>
                    ))}
                  </Box>
                  {cascadeRows.length === 0 && (
                    <Box sx={{ px: 1.5, py: 2 }}>
                      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>No antibiotics added.</Typography>
                    </Box>
                  )}
                  {cascadeRows.map((row, ai) => (
                    <Box key={ai} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 90px 70px 120px", lg: "1fr 130px 70px 130px 120px" }, gap: 0, alignItems: "center", borderBottom: `1px solid ${C.border}`, background: row.reported === false ? C.bgTertiary : C.white }}>
                      <Box sx={{ px: 1.5, py: 1 }}>
                        <Autocomplete
                          freeSolo
                          options={antibioticChoices}
                          value={row.antibiotic || ""}
                          onInputChange={(_e, val) => {
                            const antibiotics = focusIsolate.ast.antibiotics.map((a, x) => (x === ai ? { ...a, antibiotic: val } : a));
                            patchAst(focusIsolate.isolate_id, { antibiotics });
                          }}
                          renderInput={(params) => <TextField {...params} size="small" sx={inputSx} placeholder="Antibiotic" />}
                        />
                      </Box>
                      <Box sx={{ px: 1, py: 1 }}>
                        <TextField size="small" fullWidth sx={inputSx} placeholder="mm / µg/mL" value={row.method_value} onChange={(e) => {
                          const antibiotics = focusIsolate.ast.antibiotics.map((a, x) => (x === ai ? { ...a, method_value: e.target.value } : a));
                          patchAst(focusIsolate.isolate_id, { antibiotics });
                        }} />
                      </Box>
                      <Box sx={{ px: 1, py: 1 }}>
                        <Sel label="" options={INTERPRETATION_OPTIONS} value={row.interpretation} onChange={(v) => {
                          const antibiotics = focusIsolate.ast.antibiotics.map((a, x) => (x === ai ? { ...a, interpretation: v } : a));
                          patchAst(focusIsolate.isolate_id, { antibiotics });
                        }} />
                      </Box>
                      <Box sx={{ px: 1, py: 1 }}>
                        {row.cascade_status === "suppressed" ? (
                          <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted }}>
                            Suppressed{row.cascade_reason ? ` — ${row.cascade_reason}` : ""}
                          </Typography>
                        ) : (
                          <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted }}>Report</Typography>
                        )}
                      </Box>
                      <Box sx={{ px: 1, py: 1 }}>
                        <IconButton size="small" onClick={() => patchAst(focusIsolate.isolate_id, { antibiotics: focusIsolate.ast.antibiotics.filter((_, x) => x !== ai) })} sx={{ color: C.textSecond, "&:hover": { color: C.black } }}><DeleteOutlineRounded fontSize="small" /></IconButton>
                      </Box>
                      {row.cascade_status === "suppressed" && !row.override_reason && (
                        <Box sx={{ gridColumn: "1 / -1", px: 1.5, pb: 1 }}>
                          <TextField size="small" fullWidth sx={inputSx} placeholder={`Override reason to release ${row.antibiotic || ""} on the report`} value={row.override_reason} onChange={(e) => {
                            const antibiotics = focusIsolate.ast.antibiotics.map((a, x) => (x === ai ? { ...a, override_reason: e.target.value } : a));
                            patchAst(focusIsolate.isolate_id, { antibiotics });
                          }} />
                        </Box>
                      )}
                    </Box>
                  ))}
                </Box>
              </Box>

              <Box sx={{ mt: 1.5 }}>
                <FieldLabel>AST notes</FieldLabel>
                <TextField size="small" fullWidth multiline rows={1} sx={inputSx} value={focusIsolate.ast.notes} onChange={(e) => patchAst(focusIsolate.isolate_id, { notes: e.target.value })} />
              </Box>
            </Box>
          )}
        </Box>
      )}

      {notice && (
        <Box sx={{ mb: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1, mt: 1 }}>
        <Button onClick={saveWorkup} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Culture Workup"}
        </Button>
      </Box>
    </Box>
  );
}
