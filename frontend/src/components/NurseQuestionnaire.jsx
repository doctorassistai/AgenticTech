// NurseQuestionnaire.jsx — shareable, cross-specialty bedside questionnaire.
//
// One component for all three oncology specialties (Surgical / Medical / Radiation).
// The backend (POST /context/nurse-questionnaire/generate) builds a lean patient context
// from the specialty's own record + common vitals/labs and asks an LLM for the questions a
// nurse should ask this patient — spanning before / during / after the procedure or
// treatment, with no fixed count. The nurse records free-text answers inline; Save persists
// questions + answers to the `nurse_questionaire` collection so they survive reloads.
//
// Props:
//   patientId  — required.
//   speciality — "Surgical Oncology" | "Medical Oncology" | "Radiation Oncology" (or any
//                casing/synonym; the backend normalizes it).
//   doctorId   — optional, stored as metadata.
//   defaultOpen — optional, start expanded (default: collapsed).
//
// Styling follows the shared design system (./shared/designTokens) so it drops cleanly into
// any specialty dashboard.

import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, CircularProgress, Button } from "@mui/material";

import { C, FONT, FW_LIGHT, FW_NORMAL } from "./shared/designTokens";
import {
  generateNurseQuestionnaire, getNurseQuestionnaire, saveNurseQuestionnaire,
} from "./shared/api";

// before → during → after; groups with no questions are skipped at render time.
const PHASES = [
  { key: "before", label: "Before" },
  { key: "during", label: "During" },
  { key: "after", label: "After" },
];

const answerStyle = {
  width: "100%", padding: "8px 10px", border: `1px solid ${C.border}`,
  borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT,
  outline: "none", boxSizing: "border-box", resize: "vertical", background: C.white,
};

const NurseQuestionnaire = ({ patientId, speciality, doctorId, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  const [questions, setQuestions] = useState([]);
  const [status, setStatus] = useState("idle");   // idle | loading | ready | empty
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [generatedAt, setGeneratedAt] = useState("");
  const [savedAt, setSavedAt] = useState("");
  const [error, setError] = useState("");

  // Load any previously saved questionnaire (questions + answers) on mount.
  useEffect(() => {
    if (!patientId || !speciality) { setStatus("idle"); return; }
    let alive = true;
    setStatus("loading");
    setError("");
    getNurseQuestionnaire(patientId, speciality)
      .then((res) => {
        if (!alive) return;
        const data = res?.data;
        if (data && Array.isArray(data.questions) && data.questions.length) {
          setQuestions(data.questions);
          setGeneratedAt(data.generated_at || "");
          setStatus("ready");
        } else {
          setQuestions([]);
          setStatus("empty");
        }
      })
      .catch((err) => {
        if (!alive) return;
        setError(String(err?.message || err));
        setQuestions([]);
        setStatus("empty");
      });
    return () => { alive = false; };
  }, [patientId, speciality]);

  const handleGenerate = useCallback(() => {
    if (!patientId || !speciality || generating) return;
    setGenerating(true);
    setError("");
    setSavedAt("");
    generateNurseQuestionnaire(patientId, speciality, doctorId)
      .then((res) => {
        setQuestions(Array.isArray(res?.questions) ? res.questions : []);
        setGeneratedAt(res?.generated_at || "");
        setStatus((res?.questions || []).length ? "ready" : "empty");
        setOpen(true);
      })
      .catch((err) => setError(String(err?.message || err)))
      .finally(() => setGenerating(false));
  }, [patientId, speciality, doctorId, generating]);

  const handleSave = useCallback(() => {
    if (!patientId || !speciality || saving || !questions.length) return;
    setSaving(true);
    setError("");
    saveNurseQuestionnaire(patientId, speciality, questions, doctorId)
      .then((res) => setSavedAt(res?.saved_at || new Date().toISOString()))
      .catch((err) => setError(String(err?.message || err)))
      .finally(() => setSaving(false));
  }, [patientId, speciality, doctorId, questions, saving]);

  const updateAnswer = useCallback((id, value) => {
    setQuestions((prev) => prev.map((q) => (q.id === id ? { ...q, answer: value } : q)));
    setSavedAt("");   // answers changed since last save
  }, []);

  const answered = questions.filter((q) => (q.answer || "").trim()).length;
  const busy = generating || status === "loading";

  return (
    <Box sx={{ border: `1px solid ${C.border}`, background: C.white }}>
      {/* Header bar — click to collapse/expand */}
      <Box
        onClick={() => setOpen((o) => !o)}
        sx={{
          px: 2.5, py: 1.75, background: C.bgSecondary, borderBottom: open ? `1px solid ${C.border}` : "none",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2,
          cursor: "pointer", userSelect: "none",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.25 }}>
          <Box component="span" sx={{ fontSize: 10, lineHeight: 1, color: C.textSecond }}>{open ? "▾" : "▸"}</Box>
          <Box>
            <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted, letterSpacing: "0.15em", textTransform: "uppercase", mb: 0.25 }}>
              Nurse Questionnaire
            </Typography>
            <Typography sx={{ fontSize: 15, fontWeight: FW_NORMAL, color: C.textPrimary, fontFamily: FONT }}>
              Bedside questions for the patient
            </Typography>
          </Box>
        </Box>
        <Box sx={{ fontFamily: FONT, fontSize: 10, letterSpacing: "0.05em", textTransform: "uppercase", color: C.textMuted, border: `1px solid ${C.border}`, background: C.white, px: 1.25, py: 0.6, whiteSpace: "nowrap" }}>
          {questions.length ? `${answered}/${questions.length} answered` : "Not generated"}
        </Box>
      </Box>

      {open && (
        <Box sx={{ p: 2.5 }}>
          {/* Toolbar */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 2 }}>
            <Button
              onClick={handleGenerate}
              disabled={!patientId || generating}
              sx={{
                px: 2, py: 0.6, fontSize: 11, minWidth: 0, borderRadius: 0, textTransform: "none",
                fontFamily: FONT, background: C.white, color: C.black, border: `1px solid ${C.black}`,
                "&:hover": { background: C.bgTertiary },
                "&.Mui-disabled": { opacity: 0.5, color: C.textMuted, borderColor: C.border },
              }}
            >
              {generating ? <CircularProgress size={13} sx={{ mr: 1, color: C.textMuted }} /> : null}
              {generating ? "Generating" : questions.length ? "Regenerate" : "Generate questions"}
            </Button>

            <Box sx={{ flex: 1 }} />
            {generatedAt ? (
              <Typography sx={{ fontFamily: FONT, fontSize: 11, fontWeight: FW_LIGHT, color: C.textMuted, whiteSpace: "nowrap" }}>
                Generated {generatedAt}
              </Typography>
            ) : null}
          </Box>

          {error ? (
            <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_LIGHT, color: "#b91c1c", mb: 1.5 }}>
              {error}
            </Typography>
          ) : null}

          {/* Body */}
          {busy ? (
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 5 }}>
              <CircularProgress size={20} sx={{ color: C.black }} />
            </Box>
          ) : !questions.length ? (
            <Typography sx={{ fontSize: 12.5, fontFamily: FONT, fontWeight: FW_LIGHT, color: C.textSecond }}>
              {status === "empty"
                ? "No questionnaire yet. Click “Generate questions” to build one from this patient's current treatment, recent vitals and investigations."
                : "Select a patient to generate the questionnaire."}
            </Typography>
          ) : (
            PHASES.map((phase) => {
              const items = questions.filter((q) => (q.phase || "during") === phase.key);
              if (!items.length) return null;
              return (
                <Box key={phase.key} sx={{ mb: 2.5 }}>
                  <Typography sx={{ fontFamily: FONT, fontSize: 11, fontWeight: FW_NORMAL, letterSpacing: "0.12em", textTransform: "uppercase", color: C.textSecond, borderBottom: `1px solid ${C.border}`, pb: 0.75, mb: 1.5 }}>
                    {phase.label} · {items.length}
                  </Typography>
                  {items.map((q) => (
                    <Box key={q.id} sx={{ mb: 2 }}>
                      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
                        {q.category ? (
                          <Box component="span" sx={{ fontFamily: FONT, fontSize: 9, letterSpacing: "0.06em", textTransform: "uppercase", color: C.textMuted, border: `1px solid ${C.border}`, px: 0.75, py: 0.15, whiteSpace: "nowrap" }}>
                            {q.category}
                          </Box>
                        ) : null}
                        <Typography sx={{ fontSize: 13, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.textPrimary }}>
                          {q.question}
                        </Typography>
                      </Box>
                      <textarea
                        rows={2}
                        value={q.answer || ""}
                        placeholder="Record the patient's answer…"
                        onChange={(e) => updateAnswer(q.id, e.target.value)}
                        style={answerStyle}
                      />
                    </Box>
                  ))}
                </Box>
              );
            })
          )}

          {/* Save — at the bottom, after all answers, so the nurse can save in place */}
          {!busy && questions.length ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 1, pt: 2, borderTop: `1px solid ${C.border}` }}>
              <Button
                onClick={handleSave}
                disabled={saving}
                sx={{
                  px: 3, py: 0.7, fontSize: 12, minWidth: 0, borderRadius: 0, textTransform: "none",
                  fontFamily: FONT, background: C.black, color: C.white,
                  "&:hover": { background: "#1a1a1a" },
                  "&.Mui-disabled": { opacity: 0.5, color: C.bgTertiary },
                }}
              >
                {saving ? <CircularProgress size={13} sx={{ mr: 1, color: C.bgTertiary }} /> : null}
                {saving ? "Saving" : "Save answers"}
              </Button>
              {savedAt ? (
                <Typography sx={{ fontFamily: FONT, fontSize: 11, fontWeight: FW_LIGHT, color: "#15803d" }}>Saved</Typography>
              ) : null}
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
};

export default NurseQuestionnaire;
