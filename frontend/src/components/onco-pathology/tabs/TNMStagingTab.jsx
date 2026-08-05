// tabs/TNMStagingTab.jsx — TNM Staging Calculator + Final Diagnosis
//
// Fourth tab of Onco-Pathology workflow. AJCC 8th Edition (Colon & Rectum)
// pathologic staging. Features:
//   • Auto-derive T/N/M from the synoptic report (depth + node counts)
//   • Manual T/N/M dropdowns with descriptions
//   • Calculate final stage group (AJCC 8th) via backend
//   • Generate + edit final pathologic diagnosis narrative
//   • AI Review & Validate — correlates synoptic + grossing + TNM (CAP checks)
//   • Save via onSave("tnm", {...tnm + final_diagnosis})
//
// Ported from templates/pathology_pp.html #tnm-staging (2028–2179). Persistence
// uses the case document: tnm.latest + final_diagnosis sections.

import React, { useState, useEffect } from "react";
import { Box, Typography, TextField, Button, CircularProgress } from "@mui/material";
import {
  SaveRounded, CalculateRounded, AutoAwesomeRounded, DownloadRounded,
  DescriptionRounded, WarningAmberRounded,
} from "@mui/icons-material";
import {
  C, FONT, FW_LIGHT, FW_NORMAL, FW_BOLD, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import { SectionBox, FG, FieldLabel, FlagNote, Sel } from "../../shared/FormComponents";
import { deriveTNM, calculateStage, generateFinalDiagnosis, aiReview } from "../shared/api";

// AJCC 8th Edition (Colon & Rectum) — T/N/M option lists with descriptions.
const T_OPTIONS = [
  { value: "Tis", label: "Tis - Carcinoma in situ" },
  { value: "T1", label: "T1 - Submucosa" },
  { value: "T2", label: "T2 - Muscularis propria" },
  { value: "T3", label: "T3 - Subserosa / pericolic" },
  { value: "T4a", label: "T4a - Visceral peritoneum" },
  { value: "T4b", label: "T4b - Adjacent organs" },
];
const N_OPTIONS = [
  { value: "N0", label: "N0 - No nodes" },
  { value: "N1a", label: "N1a - 1 node" },
  { value: "N1b", label: "N1b - 2-3 nodes" },
  { value: "N1c", label: "N1c - Tumor deposits" },
  { value: "N2a", label: "N2a - 4-6 nodes" },
  { value: "N2b", label: "N2b - ≥7 nodes" },
];
const M_OPTIONS = [
  { value: "M0", label: "M0 - No metastasis" },
  { value: "M1a", label: "M1a - 1 organ/site" },
  { value: "M1b", label: "M1b - >1 organ" },
  { value: "M1c", label: "M1c - Peritoneal" },
];

const EMPTY = {
  t_stage: "", t_description: "",
  n_stage: "", n_description: "",
  m_stage: "", m_description: "",
  final_stage: "", tnm_code: "", ai_confidence: "", stage_message: "",
  final_diagnosis: "",
};

export default function TNMStagingTab({ caseId, initialData, synopticData, grossingData, onSave }) {
  const [f, setF] = useState({ ...EMPTY, ...(initialData || {}) });
  const [isSaving, setIsSaving] = useState(false);
  const [isDeriving, setIsDeriving] = useState(false);
  const [isCalculating, setIsCalculating] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isReviewing, setIsReviewing] = useState(false);
  const [review, setReview] = useState(null);

  const set = (key) => (val) => setF((prev) => ({ ...prev, [key]: val }));
  const onInput = (key) => (e) => set(key)(e.target.value);

  // ─── Re-merge when the loaded case changes ────────────────────────────────
  useEffect(() => {
    setF({ ...EMPTY, ...(initialData || {}) });
    setReview(null);
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Auto-derive T/N/M from the synoptic report ───────────────────────────
  const handleDerive = async () => {
    if (!synopticData || Object.keys(synopticData).length === 0) {
      alert("No synoptic report data available. Complete the Synoptic tab first.");
      return;
    }
    setIsDeriving(true);
    try {
      const r = await deriveTNM(synopticData);
      if (r?.status === "success" && r.data) {
        setF((prev) => ({ ...prev, ...r.data }));
      }
    } catch (err) {
      console.error("[TNMStagingTab] derive error:", err);
      alert("Error deriving TNM from synoptic report.");
    } finally {
      setIsDeriving(false);
    }
  };

  // ─── Calculate final stage group (AJCC 8th) ───────────────────────────────
  const handleCalculate = async () => {
    if (!f.t_stage || !f.n_stage || !f.m_stage) {
      alert("Select T, N, and M stages first.");
      return;
    }
    setIsCalculating(true);
    try {
      const r = await calculateStage({
        t_stage: f.t_stage, n_stage: f.n_stage, m_stage: f.m_stage,
      });
      if (r?.status === "success" && r.data) {
        setF((prev) => ({
          ...prev,
          final_stage: r.data.final_stage,
          tnm_code: r.data.tnm_code,
          ai_confidence: r.data.confidence,
          stage_message: r.data.message,
        }));
      }
    } catch (err) {
      console.error("[TNMStagingTab] calculate error:", err);
      alert("Error calculating stage.");
    } finally {
      setIsCalculating(false);
    }
  };

  // ─── Generate final diagnosis narrative ───────────────────────────────────
  const handleGenerateDiagnosis = async () => {
    setIsGenerating(true);
    try {
      const r = await generateFinalDiagnosis({
        synoptic: synopticData || {},
        grossing: grossingData || {},
        tnm: {
          t_stage: f.t_stage, t_description: f.t_description,
          n_stage: f.n_stage, m_stage: f.m_stage,
          final_stage: f.final_stage, tnm_code: f.tnm_code, message: f.stage_message,
        },
      });
      if (r?.status === "success" && r.data?.final_diagnosis) {
        set("final_diagnosis")(r.data.final_diagnosis);
      }
    } catch (err) {
      console.error("[TNMStagingTab] final diagnosis error:", err);
      alert("Error generating final diagnosis.");
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── AI Review & Validate ─────────────────────────────────────────────────
  const handleAIReview = async () => {
    setIsReviewing(true);
    setReview(null);
    try {
      const r = await aiReview({
        synoptic: synopticData || {},
        grossing: grossingData || {},
        tnm: {
          t_stage: f.t_stage, n_stage: f.n_stage, m_stage: f.m_stage,
          final_stage: f.final_stage, tnm_code: f.tnm_code,
        },
      });
      if (r?.status === "success") setReview(r);
    } catch (err) {
      console.error("[TNMStagingTab] AI review error:", err);
      alert("Error running AI review.");
    } finally {
      setIsReviewing(false);
    }
  };

  // ─── Save ─────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await onSave("tnm", { ...f });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isDeriving || isCalculating || isGenerating || isReviewing;

  const statusColor = (status) =>
    status === "fail" ? "#cf1322" : status === "warning" ? "#b76e00" : "#237804";

  return (
    <Box sx={{ fontFamily: FONT }}>
      {/* AI Panel */}
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2.5, mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <AutoAwesomeRounded sx={{ fontSize: 18, color: C.black }} />
          <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            AJCC 8th Edition Staging (Colon & Rectum)
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, mb: 1.75 }}>
          Auto-derive T/N/M from the synoptic report, or select manually below, then calculate the stage group.
        </Typography>
        <Button sx={outlineBtnSx} onClick={handleDerive} disabled={busy}>
          {isDeriving ? (
            <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
          ) : (
            <DownloadRounded sx={{ mr: 0.75, fontSize: 16 }} />
          )}
          Derive from Synoptic
        </Button>
      </Box>

      {/* T / N / M selectors */}
      <SectionBox title="TNM Categories (Pathologic)">
        <FG cols={3}>
          <Box>
            <FieldLabel>Primary Tumor (pT)</FieldLabel>
            <Sel label="T Stage" options={T_OPTIONS} value={f.t_stage} onChange={set("t_stage")} />
            {f.t_description && <FlagNote>{f.t_description}</FlagNote>}
          </Box>
          <Box>
            <FieldLabel>Regional Nodes (pN)</FieldLabel>
            <Sel label="N Stage" options={N_OPTIONS} value={f.n_stage} onChange={set("n_stage")} />
            {f.n_description && <FlagNote>{f.n_description}</FlagNote>}
          </Box>
          <Box>
            <FieldLabel>Distant Metastasis (pM)</FieldLabel>
            <Sel label="M Stage" options={M_OPTIONS} value={f.m_stage} onChange={set("m_stage")} />
            {f.m_description && <FlagNote>{f.m_description}</FlagNote>}
          </Box>
        </FG>
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1 }}>
          <Button sx={outlineBtnSx} onClick={handleCalculate} disabled={busy}>
            {isCalculating ? (
              <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
            ) : (
              <CalculateRounded sx={{ mr: 0.75, fontSize: 16 }} />
            )}
            Calculate Stage
          </Button>
        </Box>
      </SectionBox>

      {/* Stage result */}
      <Box sx={{ border: `1px solid ${C.border}`, background: C.white, p: 3, mb: 2.5, textAlign: "center" }}>
        <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted, fontFamily: FONT, mb: 1 }}>
          Pathologic Stage (AJCC 8th Ed.)
        </Typography>
        <Typography sx={{ fontSize: 44, fontWeight: FW_BOLD, fontFamily: FONT, color: C.black, lineHeight: 1.1 }}>
          {f.final_stage || "—"}
        </Typography>
        <Typography sx={{ fontSize: 15, color: C.textSecond, fontFamily: FONT, mt: 0.5 }}>
          {f.tnm_code || "pT– pN– M–"}
        </Typography>
        {f.ai_confidence && (
          <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mt: 1 }}>
            Confidence: {f.ai_confidence}
          </Typography>
        )}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, mt: 2, px: 2, py: 1, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
          <WarningAmberRounded sx={{ fontSize: 16, color: "#b76e00" }} />
          <Typography sx={{ fontSize: 11.5, color: C.textSecond, fontFamily: FONT }}>
            Pathologist review required — AI-generated stage must be confirmed.
          </Typography>
        </Box>
      </Box>

      {/* Final diagnosis */}
      <SectionBox title="Final Pathologic Diagnosis">
        <FieldLabel>Final Diagnosis</FieldLabel>
        <TextField
          value={f.final_diagnosis}
          onChange={onInput("final_diagnosis")}
          size="small"
          fullWidth
          multiline
          minRows={9}
          placeholder="Generate from the case data, or dictate the final diagnostic narrative..."
          sx={{ ...inputSx, "& .MuiOutlinedInput-root": { ...inputSx["& .MuiOutlinedInput-root"], fontFamily: '"Georgia", serif' } }}
        />
        <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
          <Button sx={outlineBtnSx} onClick={handleGenerateDiagnosis} disabled={busy}>
            {isGenerating ? (
              <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
            ) : (
              <DescriptionRounded sx={{ mr: 0.75, fontSize: 16 }} />
            )}
            Generate Diagnosis
          </Button>
          <Button sx={outlineBtnSx} onClick={handleAIReview} disabled={busy}>
            {isReviewing ? (
              <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
            ) : (
              <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />
            )}
            AI Review &amp; Validate
          </Button>
        </Box>
      </SectionBox>

      {/* AI Review output */}
      {review && (
        <SectionBox title="AI Review & CAP Validation">
          {review.final_review?.final_diagnosis && (
            <Box sx={{ mb: 2 }}>
              <FieldLabel>Suggested Diagnosis</FieldLabel>
              <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textPrimary }}>
                {review.final_review.final_diagnosis}
                {review.final_review.ai_confidence ? ` (Confidence: ${review.final_review.ai_confidence})` : ""}
              </Typography>
            </Box>
          )}

          {Array.isArray(review.cap_validation) && review.cap_validation.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <FieldLabel>CAP Validation</FieldLabel>
              {review.cap_validation.map((v, i) => (
                <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", py: 0.5, borderBottom: `1px solid ${C.border}` }}>
                  <Box sx={{ mt: 0.4, width: 8, height: 8, flexShrink: 0, borderRadius: "50%", background: statusColor(v.status) }} />
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>
                    <b style={{ color: statusColor(v.status) }}>{(v.status || "").toUpperCase()}</b>
                    {v.rule ? ` · ${v.rule}` : ""} — {v.message}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {review.tnm_analysis?.stage_interpretation && (
            <Box sx={{ mb: 2 }}>
              <FieldLabel>Staging Analysis</FieldLabel>
              <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>
                {review.tnm_analysis.tnm_consistency}
              </Typography>
              <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, mt: 0.5 }}>
                {review.tnm_analysis.stage_interpretation}
              </Typography>
              {review.tnm_analysis.stage_recommendation && (
                <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, mt: 0.5 }}>
                  <b>Recommendation:</b> {review.tnm_analysis.stage_recommendation}
                </Typography>
              )}
            </Box>
          )}

          {review.final_review?.overall_summary && (
            <Box>
              <FieldLabel>Overall Summary</FieldLabel>
              <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>
                {review.final_review.overall_summary}
              </Typography>
            </Box>
          )}
        </SectionBox>
      )}

      {/* Save */}
      <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
        <Button sx={saveBtnSx} onClick={handleSubmit} disabled={isSaving}>
          {isSaving ? (
            <CircularProgress size={14} sx={{ mr: 1, color: C.white }} />
          ) : (
            <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />
          )}
          Save TNM &amp; Diagnosis
        </Button>
      </Box>
    </Box>
  );
}
