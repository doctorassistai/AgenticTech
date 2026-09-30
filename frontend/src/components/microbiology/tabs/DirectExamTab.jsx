// tabs/DirectExamTab.jsx — Microbiology Tab 3: Direct examination
//
// Immediate microscopic examination of each registered specimen, reported as a
// preliminary within 1–2 h of collection (the fastest-reporting step).
//
// Data model (per plan Sections table): direct_examination is stored keyed by
// specimen_id —
//   direct_examination = {
//     [specimen_id]: {
//       quality_comment: "",
//       exams: [
//         { exam_id, exam_type, tech_name, examined_at, result: {…fields…}, prelim: {…} }
//       ]
//     }
//   }
// Each exam record is one slide read (a specimen may carry several exam types,
// and a stool O+P may have several sample reads — each a new record).
//
// "Send preliminary" dispatches a versioned entry into the preliminary_reports
// section (Tab 11 history is read-only and populated from here). Malaria film
// results auto-fire a critical value when P. falciparum or hyperparasitaemia is
// recorded — this cannot be deferred.

import React, { useEffect, useRef, useState } from "react";
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
} from "@mui/material";
import {
  AddRounded, DeleteOutlineRounded, SendRounded, MicRounded, StopRounded, AutoAwesomeRounded,
} from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  SectionBox, FieldLabel, Sel, CbxGroup, RdoGroup,
} from "../../shared/FormComponents";
import {
  DIRECT_EXAM_TYPES,
  DIRECT_EXAM_TYPES_BY_VALUE,
  DIRECT_EXAM_TEST_TRIGGERS,
  PFALCIPARUM_HYPERPARASITAEMIA_PCT,
} from "../constants";
import { structureDirectExam, TRANSCRIBE_URL } from "../shared/api";
import { summarizeExam } from "../shared/resultSummaries";

const makeUid = (prefix) => {
  const uuid = globalThis.crypto?.randomUUID?.();
  const token = uuid
    ? parseInt(uuid.replace(/-/g, "").slice(0, 8), 16).toString(36).toUpperCase().padStart(7, "0")
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`.toUpperCase().slice(-7);
  return `${prefix}-${token}`;
};

// ─── Result summaries & critical-value detection ──────────────────────────────

// Critical-value detection for a recorded result (fires immediately, cannot defer).
const criticalValue = (examType, result) => {
  const species = result?.species || "";
  const pct = parseFloat(result?.parasitaemia_pct);
  if (examType === "thin_film" || examType === "thick_film") {
    if (/P\.?\s*falciparum|falciparum/i.test(String(species))) {
      const hyper = Number.isFinite(pct) && pct >= PFALCIPARUM_HYPERPARASITAEMIA_PCT;
      return {
        critical: true,
        reason: hyper
          ? `P. falciparum hyperparasitaemia (${pct}%) — STAT verbal notification required`
          : "P. falciparum positive — critical value, STAT verbal notification required",
      };
    }
  }
  return { critical: false, reason: "" };
};

const blankExam = () => ({
  exam_id: makeUid("EXAM"),
  exam_type: "",
  tech_name: "",
  examined_at: "",
  result: {},
  prelim: null,
});

// Is an exam type offered for a specimen (driven by its ordered tests)?
const offeredExamTypes = (tests) => {
  if (!Array.isArray(tests)) return [];
  return DIRECT_EXAM_TYPES.filter((t) =>
    (DIRECT_EXAM_TEST_TRIGGERS[t.value] || []).some((tv) => tests.includes(tv))
  );
};

const blankSpecimenBlock = (sp) => ({
  quality_comment: "",
  exams: [],
});

const hydrate = (sp, initialData) => {
  const saved = (initialData && initialData[sp.specimen_id]) || {};
  const base = blankSpecimenBlock(sp);
  const exams = Array.isArray(saved.exams) ? saved.exams.map((e) => ({
    ...blankExam(),
    ...e,
    result: { ...(e.result || {}) },
    prelim: e.prelim || null,
  })) : [];
  return {
    quality_comment: saved.quality_comment || "",
    exams,
  };
};

// ─── Direct-exam dictation + AI autofill (per specimen card) ─────────────────
// Mirrors Tab 2's per-card strip: one specimen is read under the microscope and
// its findings dictated in one pass, so the mic + transcript + autofill box lives
// on the specimen card and targets that card's exam rows only. A specimen can
// carry several exams of different types (gram stain + wet prep…), so each
// dictated exam is routed to an existing row already of that type that still has
// room, else a NEW exam row of that type is added (Registration-style). Only
// EMPTY fields are filled — nothing already entered is overwritten or cleared,
// multiselect arrays union-add, and enum fields snap to the exam config's option
// list.

const cleanText = (value) => (value === undefined || value === null ? "" : String(value).trim());

const canon = (s) => cleanText(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// Snap free text to a real option (normalized exact match, then a contained-
// substring fallback). Returns "" when nothing matches so a <Select> never
// receives an out-of-range value.
const coerceEnum = (value, options) => {
  const target = canon(value);
  if (!target) return "";
  return (
    options.find((o) => canon(o) === target)
    || options.find((o) => {
      const c = canon(o);
      return c.length >= 3 && (target.includes(c) || c.includes(target));
    })
    || ""
  );
};

// A datetime-local input only accepts YYYY-MM-DDTHH:MM. Normalize whatever the
// model returned into that shape; return "" when it isn't a datetime at all.
const toDateTimeLocal = (value) => {
  const m = cleanText(value).match(/^(\d{4})-(\d{1,2})-(\d{1,2})T(\d{1,2}):(\d{2})$/);
  if (!m) return "";
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${m[4].padStart(2, "0")}:${m[5]}`;
};

// Map a dictated exam name to a canonical exam_type value, matching the type's
// stored value AND its human label/prep synonyms ("ZN" → afb_smear,
// "calcofluor" → koh, "stool ova and parasites" → stool_opa).
const snapExamType = (value, choices) => {
  const tokens = [];
  (choices || []).forEach((c) => {
    [c.value, c.label, c.prep].forEach((t) => {
      const k = canon(t);
      if (k) tokens.push({ key: k, value: c.value });
    });
  });
  const target = canon(value);
  if (!target) return "";
  const exact = tokens.find((t) => t.key === target);
  if (exact) return exact.value;
  const sub = tokens.find((t) => t.key.length >= 3 && (target.includes(t.key) || t.key.includes(target)));
  return sub ? sub.value : "";
};

// Normalize a model-supplied multiselect value to a list of items (it may come
// back as an array, or a single comma-free string for a one-item tick).
const asItems = (raw) =>
  Array.isArray(raw) ? raw : (raw === undefined || raw === null ? [] : [raw]);

// Read a dictated exam entry's findings as one flat {fieldKey: value} map.
// The model is instructed to nest them under `result`, but if it instead echoed
// the guide's dotted paths as literal keys ("result.pus_cells": "Many"), accept
// both shapes so a good dictation is never silently dropped.
const entryResult = (entry) => {
  const out = {};
  const nested = (entry && entry.result && typeof entry.result === "object") ? entry.result : {};
  Object.keys(nested).forEach((k) => { out[k] = nested[k]; });
  if (entry && typeof entry === "object") {
    Object.keys(entry).forEach((k) => {
      if (k.startsWith("result.")) {
        const key = k.slice("result.".length);
        if (key && !(key in out)) out[key] = entry[k];
      }
    });
  }
  return out;
};

// Would this dictated entry put at least one value into a (fresh, blank) exam
// row of `type`? rowCanHold on a blank row — gates new-row creation so a
// dictation that only names an exam with no stated finding does not spawn an
// empty row.
const entryFillsBlank = (entry, type) =>
  rowCanHold(entry, { exam_type: type, examined_at: "", result: {} });

// Would this dictated entry put at least one value into THIS exam row, given
// fill-empty-only semantics? Decides whether an existing same-type row still has
// room for the entry (routing step) without disturbing what is already filled.
const rowCanHold = (entry, row) => {
  const cfg = DIRECT_EXAM_TYPES_BY_VALUE[row.exam_type];
  if (!cfg) return false;
  if (toDateTimeLocal(entry.examined_at) !== "" && !cleanText(row.examined_at)) return true;
  const resultIn = entryResult(entry);
  return (cfg.fields || []).some((f) => {
    const items = asItems(resultIn[f.key]);
    if (items.length === 0) return false;
    const cur = row.result[f.key];
    if (f.kind === "multiselect") {
      const curArr = Array.isArray(cur) ? cur : [];
      return items.some((item) => {
        const snap = coerceEnum(item, f.options || []);
        return !!snap && !curArr.includes(snap);
      });
    }
    if (cleanText(cur)) return false;
    if (f.kind === "select" || f.kind === "radio") return coerceEnum(resultIn[f.key], f.options || []) !== "";
    return cleanText(resultIn[f.key]) !== "";
  });
};

// Fill one exam row's empty fields from a dictated entry. Returns the count of
// values actually placed. Multiselect union-adds; enums snap; text copies; the
// row's identity fields (exam_id / tech_name) and its prelim are never touched.
const fillExam = (row, type, entry) => {
  const cfg = DIRECT_EXAM_TYPES_BY_VALUE[type];
  if (!cfg) return 0;
  const resultIn = entryResult(entry);
  let n = 0;
  const examinedAt = toDateTimeLocal(entry.examined_at);
  if (examinedAt && !cleanText(row.examined_at)) {
    row.examined_at = examinedAt;
    n += 1;
  }
  (cfg.fields || []).forEach((f) => {
    const raw = resultIn[f.key];
    if (raw === undefined || raw === null) return;
    if (f.kind === "multiselect") {
      const curArr = Array.isArray(row.result[f.key]) ? row.result[f.key] : [];
      asItems(raw).forEach((item) => {
        const snap = coerceEnum(item, f.options || []);
        if (snap && !curArr.includes(snap)) {
          curArr.push(snap);
          n += 1;
        }
      });
      if (curArr.length) row.result[f.key] = curArr;
    } else if (f.kind === "select" || f.kind === "radio") {
      if (cleanText(row.result[f.key])) return;
      const snap = coerceEnum(raw, f.options || []);
      if (snap) {
        row.result[f.key] = snap;
        n += 1;
      }
    } else {
      if (cleanText(row.result[f.key])) return;
      const val = cleanText(raw);
      if (val) {
        row.result[f.key] = val;
        n += 1;
      }
    }
  });
  return n;
};

// Merge a structure response into ONE specimen's direct-exam block. Routing per
// dictated exam (one record never filled twice in a single pass):
//   1. an existing unused exam already of that type that still has room, else
//   2. a NEW exam row of that type is added (only when the entry can fill it).
// The block's own quality_comment may be filled from the response when empty.
// Returns the merged block plus how many values / rows were created.
const mergeDirectExam = (block, data, examChoices) => {
  const next = {
    quality_comment: block.quality_comment || "",
    exams: (block.exams || []).map((e) => ({ ...e, result: { ...(e.result || {}) } })),
  };
  const used = new Set();
  let applied = 0;
  let created = 0;

  if (data && typeof data === "object") {
    if (cleanText(data.quality_comment) !== "" && !next.quality_comment) {
      next.quality_comment = cleanText(data.quality_comment);
      applied += 1;
    }
  }

  const incoming = Array.isArray(data?.exams) ? data.exams : [];
  incoming.forEach((entry) => {
    if (!entry || typeof entry !== "object") return;
    const type = snapExamType(entry.exam_type, examChoices);
    if (!type || !DIRECT_EXAM_TYPES_BY_VALUE[type]) return;

    let idx = next.exams.findIndex((e, i) => !used.has(i) && e.exam_type === type && rowCanHold(entry, e));
    if (idx === -1) {
      if (!entryFillsBlank(entry, type)) return; // nothing usable stated for this type
      const exam = blankExam();
      exam.exam_type = type;
      next.exams.push(exam);
      idx = next.exams.length - 1;
      created += 1;
    }
    used.add(idx);
    applied += fillExam(next.exams[idx], type, entry);
  });

  return { block: next, applied, created };
};

// Self-contained mic + transcript + autofill strip for one specimen card. Each
// instance owns its recorder/autofill state (self-contained per the shared
// transcribe reference — no recorder abstraction). getBlock() returns the latest
// block snapshot (via a parent ref) so a merge never lands on a stale copy.
function DirectExamDictation({ specimen, examChoices, getBlock, onApply }) {
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [notice, setNotice] = useState("");
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

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
      console.error("[DirectExamTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
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
        else setNotice("Nothing was heard — try again.");
      } catch (error) {
        console.error("[DirectExamTab] transcription:", error);
        setNotice("Direct-exam dictation transcription failed.");
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
    setNotice("");
    try {
      const response = await structureDirectExam({
        text,
        specimen: {
          specimen_type: specimen.specimen_type || "",
          site_of_collection: specimen.site_of_collection || "",
        },
        // The card's live shape — the same exam configs it renders with, so the
        // structure prompt only targets exam types/fields the card can hold.
        exam_schema: (examChoices || []).map((t) => ({
          exam_type: t.value,
          label: t.label,
          prep: t.prep,
          fields: t.fields,
        })),
      });
      const data = response?.data || {};
      const { block: merged, applied, created } = mergeDirectExam(getBlock(), data, examChoices);
      onApply(merged);
      if (applied === 0) {
        setNotice("Dictation matched only fields that are already filled — nothing was overwritten.");
      } else {
        setNotice(
          `Applied ${applied} dictated value${applied === 1 ? "" : "s"} to empty fields`
          + (created > 0 ? ` — added ${created} exam row${created === 1 ? "" : "s"}` : "") + "."
        );
      }
    } catch (error) {
      console.error("[DirectExamTab] structure:", error);
      setNotice("Direct-exam dictation structuring failed.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const busy = isRecording || isTranscribing || isAutofilling;

  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mb: 2.5 }}>
      <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1 }}>
        Dictate this specimen's microscopy
      </Typography>
      <TextField
        multiline
        minRows={2}
        fullWidth
        size="small"
        placeholder='e.g. "gram stain: many pus cells, moderate gram positive cocci in pairs, foul odour; wet prep: motile organisms seen; specimen adequate". Autofill fills empty exam fields only — a missing exam type is added as a new row, nothing already entered is overwritten or cleared.'
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
        <Button sx={outlineBtnSx} onClick={handleAutofill} disabled={busy || !transcript.trim()}>
          {isAutofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          AI Autofill Empty Exam Fields
        </Button>
        {notice && (
          <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        )}
      </Box>
    </Box>
  );
}

export default function DirectExamTab({
  doctorId,
  doctorName,
  caseId,
  initialData,        // direct_examination section
  preliminaryReports, // preliminary_reports section (for versioning)
  caseRegister,       // case_register (specimens + tests)
  onSave,             // (tabKey, data) dispatch — "direct-exam" or "preliminary"
}) {
  const [blocks, setBlocks] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  // Latest blocks snapshot for the per-card autofill handlers, so a merge that
  // resolves after an await always reads current values (never a stale copy).
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];

  useEffect(() => {
    const hydrated = {};
    specimens.forEach((sp) => { hydrated[sp.specimen_id] = hydrate(sp, initialData); });
    setBlocks(hydrated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const patchSpecimen = (specimenId, patchObj) =>
    setBlocks((prev) => ({ ...prev, [specimenId]: { ...prev[specimenId], ...patchObj } }));

  // Whole-block replace for the dictation autofill (the merge already fills
  // empty fields only, so a replace cannot clobber manual entries).
  const replaceBlock = (specimenId, block) =>
    setBlocks((prev) => ({ ...prev, [specimenId]: block }));

  const patchExam = (specimenId, examId, patchObj) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        exams: prev[specimenId].exams.map((e) => (e.exam_id === examId ? { ...e, ...patchObj } : e)),
      },
    }));

  const patchExamResult = (specimenId, examId, key, value) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: {
        ...prev[specimenId],
        exams: prev[specimenId].exams.map((e) =>
          e.exam_id === examId ? { ...e, result: { ...e.result, [key]: value } } : e
        ),
      },
    }));

  const addExam = (specimenId, examType) => {
    const exam = blankExam();
    exam.exam_type = examType;
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: { ...prev[specimenId], exams: [...prev[specimenId].exams, exam] },
    }));
  };

  const removeExam = (specimenId, examId) =>
    setBlocks((prev) => ({
      ...prev,
      [specimenId]: { ...prev[specimenId], exams: prev[specimenId].exams.filter((e) => e.exam_id !== examId) },
    }));

  const saveDirectExam = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("direct-exam", blocks);
    } catch (err) {
      console.error("[DirectExamTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Send a versioned preliminary from one exam record into preliminary_reports.
  const sendPreliminary = async (sp, exam) => {
    const cfg = DIRECT_EXAM_TYPES_BY_VALUE[exam.exam_type];
    if (!cfg) return;
    const summary = summarizeExam(exam.exam_type, exam.result);
    const critical = criticalValue(exam.exam_type, exam.result);
    if (!summary && !critical.critical) {
      setNotice("Record a result before sending a preliminary.");
      return;
    }
    setNotice("");
    setIsSaving(true);
    try {
      const versions = Array.isArray(preliminaryReports?.versions) ? preliminaryReports.versions : [];
      const version = {
        version: versions.length + 1,
        source_tab: "Direct Examination",
        exam_type: cfg.value,
        exam_label: cfg.label,
        specimen_id: sp.specimen_id,
        specimen_type: sp.specimen_type || "",
        dispatched_at: new Date().toISOString(),
        dispatched_by: exam.tech_name || doctorName || doctorId || "",
        summary,
        result: exam.result,
        ...(critical.critical ? { critical: true, critical_reason: critical.reason } : {}),
      };
      const merged = { ...(preliminaryReports && typeof preliminaryReports === "object" ? preliminaryReports : {}), versions: [...versions, version] };
      await onSave("preliminary", merged);
      patchExam(sp.specimen_id, exam.exam_id, { prelim: { version: version.version, dispatched_at: version.dispatched_at, critical: critical.critical } });
    } catch (err) {
      console.error("[DirectExamTab] preliminary dispatch error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (specimens.length === 0) {
    return (
      <Box sx={{ py: 8, textAlign: "center" }}>
        <Typography sx={{ fontSize: 13, color: C.textMuted, fontFamily: FONT }}>
          No specimens registered. Add specimens in Registration & Accession first.
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Results here are reported as a preliminary within 1–2 hours of collection. A "Send preliminary"
        dispatches a versioned report to the preliminary history — P. falciparum on a blood film
        auto-fires a critical value that cannot be deferred.
      </Typography>

      {specimens.map((sp, i) => {
        const block = blocks[sp.specimen_id] || blankSpecimenBlock(sp);
        const offered = offeredExamTypes(sp.tests_ordered);
        const examChoices = offered.length ? offered : DIRECT_EXAM_TYPES;

        return (
          <SectionBox
            key={sp.specimen_id}
            title={`Specimen ${i + 1} — ${sp.specimen_type || "Unspecified"} · ${sp.specimen_id}`}
          >
            {/* Per-card dictation → fills empty fields of this specimen's exams,
                adding a new exam row for a dictated type that has none */}
            <DirectExamDictation
              specimen={sp}
              examChoices={examChoices}
              getBlock={() => blocksRef.current[sp.specimen_id] || blankSpecimenBlock(sp)}
              onApply={(merged) => replaceBlock(sp.specimen_id, merged)}
            />

            <Box sx={{ mb: 2 }}>
              <FieldLabel>Specimen quality comment</FieldLabel>
              <TextField
                size="small" fullWidth multiline rows={2} sx={inputSx}
                placeholder="Adequate / salivary sputum (Murray-Washington) / contaminated / stool consistency…"
                value={block.quality_comment}
                onChange={(e) => patchSpecimen(sp.specimen_id, { quality_comment: e.target.value })}
              />
            </Box>

            {block.exams.map((exam) => {
              const cfg = DIRECT_EXAM_TYPES_BY_VALUE[exam.exam_type] || DIRECT_EXAM_TYPES[0];
              const crit = criticalValue(exam.exam_type, exam.result);
              // Group fields by their `group` label (or a default single group).
              const groups = [];
              (cfg.fields || []).forEach((f) => {
                const gName = f.group || "";
                let g = groups.find((x) => x.name === gName);
                if (!g) { g = { name: gName, fields: [] }; groups.push(g); }
                g.fields.push(f);
              });

              return (
                <Box key={exam.exam_id} sx={{ border: `1px solid ${C.border}`, mb: 2, background: C.bgTertiary }}>
                  <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1.5, borderBottom: `1px solid ${C.border}`, background: C.bgSecondary, flexWrap: "wrap" }}>
                    <Box sx={{ minWidth: 220, flex: "1 1 260px" }}>
                      <FieldLabel>Exam type</FieldLabel>
                      <Sel label="Exam type" options={examChoices.map((t) => ({ value: t.value, label: t.label }))} value={exam.exam_type} onChange={(v) => patchExam(sp.specimen_id, exam.exam_id, { exam_type: v, result: {} })} />
                    </Box>
                    <Box sx={{ width: 200 }}>
                      <FieldLabel>Tech</FieldLabel>
                      <TextField size="small" fullWidth sx={inputSx} value={exam.tech_name} onChange={(e) => patchExam(sp.specimen_id, exam.exam_id, { tech_name: e.target.value })} />
                    </Box>
                    <Box sx={{ width: 210 }}>
                      <FieldLabel>Examined at</FieldLabel>
                      <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={exam.examined_at} onChange={(e) => patchExam(sp.specimen_id, exam.exam_id, { examined_at: e.target.value })} InputLabelProps={{ shrink: true }} />
                    </Box>
                    <IconButton size="small" onClick={() => removeExam(sp.specimen_id, exam.exam_id)} sx={{ color: C.textSecond, "&:hover": { color: C.black } }}>
                      <DeleteOutlineRounded fontSize="small" />
                    </IconButton>
                  </Box>

                  <Box sx={{ p: 2 }}>
                    {!exam.exam_type && (
                      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                        Select an exam type to record results.
                      </Typography>
                    )}

                    {exam.exam_type && groups.map((g, gi) => (
                      <Box key={gi} sx={{ mb: 1.5 }}>
                        {g.name && (
                          <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.5 }}>
                            {g.name}
                          </Typography>
                        )}
                        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: g.fields.some((f) => f.multiline) ? "1fr" : "repeat(3, 1fr)" }, gap: 1.5 }}>
                          {g.fields.map((f) => {
                            const value = exam.result?.[f.key];
                            if (f.kind === "radio") {
                              return (
                                <Box key={f.key} sx={{ gridColumn: "1 / -1" }}>
                                  <RdoGroup label={f.label} options={f.options} value={value || ""} onChange={(v) => patchExamResult(sp.specimen_id, exam.exam_id, f.key, v)} row />
                                </Box>
                              );
                            }
                            if (f.kind === "multiselect") {
                              return (
                                <Box key={f.key} sx={{ gridColumn: "1 / -1" }}>
                                  <CbxGroup label={f.label} options={f.options} value={value || []} onChange={(v) => patchExamResult(sp.specimen_id, exam.exam_id, f.key, v)} />
                                </Box>
                              );
                            }
                            if (f.kind === "select") {
                              return (
                                <Box key={f.key}>
                                  <FieldLabel>{f.label}</FieldLabel>
                                  <Sel label={f.label} options={f.options} value={value || ""} onChange={(v) => patchExamResult(sp.specimen_id, exam.exam_id, f.key, v)} />
                                </Box>
                              );
                            }
                            return (
                              <Box key={f.key} sx={f.multiline ? { gridColumn: "1 / -1" } : {}}>
                                <FieldLabel>{f.label}</FieldLabel>
                                <TextField size="small" fullWidth multiline={!!f.multiline} rows={f.multiline ? 2 : undefined} sx={inputSx} value={value || ""} onChange={(e) => patchExamResult(sp.specimen_id, exam.exam_id, f.key, e.target.value)} />
                              </Box>
                            );
                          })}
                        </Box>
                      </Box>
                    ))}

                    {crit.critical && (
                      <Box sx={{ mt: 1.5, px: 2, py: 1.25, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
                        <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                          ⚠ <b>Critical value</b> — {crit.reason}
                        </Typography>
                      </Box>
                    )}

                    <Box sx={{ mt: 1.5, display: "flex", justifyContent: "flex-end", gap: 1, alignItems: "center" }}>
                      {exam.prelim && (
                        <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
                          Preliminary v{exam.prelim.version} dispatched {exam.prelim.dispatched_at ? new Date(exam.prelim.dispatched_at).toLocaleString() : ""}
                        </Typography>
                      )}
                      <Button
                        onClick={() => sendPreliminary(sp, exam)}
                        disabled={!exam.exam_type || isSaving}
                        sx={{ ...outlineBtnSx, py: 0.6, px: 2, fontSize: 11 }}
                      >
                        <SendRounded sx={{ mr: 0.5, fontSize: 14 }} /> Send Preliminary
                      </Button>
                    </Box>
                  </Box>
                </Box>
              );
            })}

            <Button
              onClick={() => addExam(sp.specimen_id, examChoices[0]?.value || "")}
              sx={{ ...outlineBtnSx, px: 2.5 }}
            >
              <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add Exam
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
        <Button onClick={saveDirectExam} disabled={isSaving} sx={{ ...saveBtnSx, px: 4 }}>
          {isSaving ? "Saving…" : "Save Direct Exam"}
        </Button>
      </Box>
    </Box>
  );
}
