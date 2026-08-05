/**
 * DischargeSummaryReportPanel.jsx  ·  v3.0
 * ─────────────────────────────────────────────────────────────────────────────
 * HMS Discharge Summary Report
 *
 * NEW in v3:
 *   ① Dictation textarea — expandable, character count, clear button
 *   ② Per-section inline editing — pencil icon → edit modal → saves to local state
 *   ③ Hospital-grade PDF export — letterhead, watermark, proper typography
 *
 * Usage:
 *   <DischargeSummaryReportPanel doctorId={doctorId} patientId={patientId} specialty={specialty} />
 *
 * Backend: POST /discharge-report  (unchanged contract)
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useCallback, useRef, useEffect } from "react";
import {
  Box, Typography, CircularProgress, Tooltip,
  Collapse, IconButton, Modal, TextField, Button,
} from "@mui/material";
import {
  ArticleRounded, CheckCircleRounded, CancelRounded,
  WarningAmberRounded, PrintRounded, RefreshRounded,
  ExpandMoreRounded, ExpandLessRounded, FiberManualRecordRounded,
  EditRounded, CloseRounded, SaveRounded, MicRounded,
  PictureAsPdfRounded, KeyboardArrowDownRounded,
} from "@mui/icons-material";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ══════════════════════════════════════════════════════════════════════════════
// DESIGN TOKENS
// ══════════════════════════════════════════════════════════════════════════════
const FONT = '"Inter", "Open Sans", sans-serif';
const MONO = '"JetBrains Mono", "Courier New", monospace';
const FW   = 300;

const C = {
  black:          "#080C10",
  ink:            "#0F1923",
  charcoal:       "#1E2D3D",
  smoke:          "#3D5166",
  ash:            "#6B849A",
  silver:         "#9BB0C1",
  mist:           "#C8D8E3",
  fog:            "#E4EDF3",
  ghost:          "#F2F7FA",
  white:          "#FFFFFF",
  accent:         "#0057B8",        // NHS-like institutional blue
  accentLight:    "#E8F1FB",
  accentBorder:   "#9EC4F0",
  warn:           "#92400E",
  warnBg:         "#FFFBEB",
  warnBorder:     "#FCD34D",
  ok:             "#065F46",
  okBg:           "#ECFDF5",
  okBorder:       "#6EE7B7",
  critical:       "#7F1D1D",
  criticalBg:     "#FFF1F2",
  criticalBorder: "#FECACA",
  dictBg:         "#F8FBFF",
  dictBorder:     "#B8D4F0",
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });


// ══════════════════════════════════════════════════════════════════════════════
// PRIMITIVES
// ══════════════════════════════════════════════════════════════════════════════

const HMSSection = ({ number, title, children, onEdit, editable = true }) => {
  const [open, setOpen] = useState(true);
  return (
    <Box sx={{ mb: 0 }}>
      <Box
        sx={{
          display: "flex", alignItems: "center", gap: 1.5,
          py: 1.1, borderTop: `1px solid ${C.fog}`,
          px: 2.5, mx: -2.5,
          "&:hover": { background: C.ghost },
          "&:hover .edit-btn": { opacity: 1 },
        }}
      >
        <Box
          onClick={() => setOpen(p => !p)}
          sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1, cursor: "pointer" }}
        >
          <Typography sx={{ ...os({ fontSize: 9, color: C.silver, letterSpacing: "0.12em", textTransform: "uppercase", minWidth: 22 }) }}>
            {String(number).padStart(2, "0")}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.smoke, letterSpacing: "0.07em", textTransform: "uppercase", flex: 1 }) }}>
            {title}
          </Typography>
          <IconButton size="small" sx={{ p: 0.25, color: C.silver }}>
            {open ? <ExpandLessRounded sx={{ fontSize: 13 }} /> : <ExpandMoreRounded sx={{ fontSize: 13 }} />}
          </IconButton>
        </Box>
        {editable && onEdit && (
          <Tooltip title="Edit this section">
            <IconButton
              className="edit-btn"
              size="small"
              onClick={onEdit}
              sx={{
                p: 0.4, color: C.accent, opacity: 0, transition: "opacity 0.15s",
                border: `1px solid ${C.accentBorder}`,
                background: C.accentLight,
                borderRadius: "3px",
                "&:hover": { background: C.accentBorder },
              }}
            >
              <EditRounded sx={{ fontSize: 12 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      <Collapse in={open}>
        <Box sx={{ pt: 1.5, pb: 2.5 }}>{children}</Box>
      </Collapse>
    </Box>
  );
};

const Field = ({ label, value, mono = false, wide = false, alert = false }) => {
  const v = value && value !== "null" && value !== "Not documented" && value !== "N/A" ? value : null;
  if (!v && !wide) return null;
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: wide ? "1fr" : "140px 1fr", gap: wide ? 0.25 : 1.5, mb: 0.85, alignItems: "baseline" }}>
      <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", lineHeight: 1.4 }) }}>
        {label}
      </Typography>
      <Typography sx={{ ...os({ fontSize: 12, color: alert ? C.critical : v ? C.ink : C.silver, lineHeight: 1.55, fontFamily: mono ? MONO : FONT, fontStyle: v ? "normal" : "italic" }) }}>
        {v || "Not documented"}
      </Typography>
    </Box>
  );
};

const Pill = ({ label, color = C.smoke, bg = C.ghost, border = C.fog }) => (
  <Box sx={{ display: "inline-flex", alignItems: "center", px: 1.1, py: 0.2, borderRadius: "2px", background: bg, border: `1px solid ${border}`, mr: 0.75, mb: 0.5 }}>
    <Typography sx={{ ...os({ fontSize: 10, color, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{label}</Typography>
  </Box>
);

const Divider = ({ label }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 1.75 }}>
    <Box sx={{ flex: 1, height: "1px", background: C.fog }} />
    {label && <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.1em" }) }}>{label}</Typography>}
    <Box sx={{ flex: 1, height: "1px", background: C.fog }} />
  </Box>
);

const BulletList = ({ items, color = C.charcoal, emptyText = "Not documented." }) => {
  const valid = (items || []).filter(i => i && i !== "null" && i !== "...");
  if (!valid.length)
    return <Typography sx={{ ...os({ fontSize: 12, color: C.silver, fontStyle: "italic" }) }}>{emptyText}</Typography>;
  return (
    <Box>
      {valid.map((item, i) => (
        <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "flex-start" }}>
          <FiberManualRecordRounded sx={{ fontSize: 5, color: C.mist, mt: 0.85, flexShrink: 0 }} />
          <Typography sx={{ ...os({ fontSize: 12, color, lineHeight: 1.55 }) }}>
            {typeof item === "string" ? item : JSON.stringify(item)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

const LabStatus = ({ status }) => {
  const s   = (status || "").toLowerCase();
  const map = { normal: { color: C.ok, bg: C.okBg }, abnormal: { color: C.warn, bg: C.warnBg }, critical: { color: C.critical, bg: C.criticalBg } };
  const st  = map[s] || { color: C.ash, bg: C.ghost };
  if (!status || status === "null") return null;
  return (
    <Box sx={{ display: "inline-block", px: 0.85, py: 0.1, borderRadius: "2px", background: st.bg, ml: 0.5 }}>
      <Typography sx={{ ...os({ fontSize: 9, color: st.color, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{status}</Typography>
    </Box>
  );
};

const ClinicalTable = ({ columns, rows, emptyText = "None documented." }) => {
  const valid = (rows || []).filter(Boolean);
  if (!valid.length)
    return <Typography sx={{ ...os({ fontSize: 12, color: C.silver, fontStyle: "italic" }) }}>{emptyText}</Typography>;
  return (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "2px", overflow: "hidden" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: columns.map(c => c.width || "1fr").join(" "), background: C.ghost, borderBottom: `1px solid ${C.fog}` }}>
        {columns.map(col => (
          <Box key={col.key} sx={{ px: 1.5, py: 0.75 }}>
            <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>{col.label}</Typography>
          </Box>
        ))}
      </Box>
      {valid.map((row, i) => (
        <Box key={i} sx={{ display: "grid", gridTemplateColumns: columns.map(c => c.width || "1fr").join(" "), borderBottom: i < valid.length - 1 ? `1px solid ${C.fog}` : "none", "&:hover": { background: C.ghost } }}>
          {columns.map(col => (
            <Box key={col.key} sx={{ px: 1.5, py: 1 }}>
              {col.render
                ? col.render(row[col.key], row)
                : <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.5 }) }}>{row[col.key] ?? "—"}</Typography>
              }
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
};


// ══════════════════════════════════════════════════════════════════════════════
// DICTATION PANEL  ← NEW
// ══════════════════════════════════════════════════════════════════════════════

const DictationPanel = ({ value, onChange, onSubmit, loading }) => {
  const [expanded, setExpanded] = useState(false);
  const MAX = 8000;

  return (
    <Box sx={{
      border: `1px solid ${C.dictBorder}`,
      borderRadius: "4px",
      background: C.dictBg,
      mb: 2.5,
      overflow: "hidden",
      transition: "all 0.2s ease",
    }}>
      {/* Header */}
      <Box
        onClick={() => setExpanded(p => !p)}
        sx={{
          display: "flex", alignItems: "center", gap: 1.5,
          px: 2, py: 1.25, cursor: "pointer",
          borderBottom: expanded ? `1px solid ${C.dictBorder}` : "none",
          "&:hover": { background: `${C.accentLight}80` },
        }}
      >
        <MicRounded sx={{ fontSize: 15, color: C.accent }} />
        <Typography sx={{ ...os({ fontSize: 12, color: C.accent, flex: 1 }) }}>
          Doctor's Dictation
          {value?.trim() && (
            <Typography component="span" sx={{ ...os({ fontSize: 10, color: C.ash, ml: 1 }) }}>
              · {value.trim().split(/\s+/).length} words
            </Typography>
          )}
        </Typography>
        {value?.trim() && !expanded && (
          <Box sx={{ px: 1, py: 0.2, borderRadius: "2px", background: C.accentLight, border: `1px solid ${C.accentBorder}` }}>
            <Typography sx={{ ...os({ fontSize: 9, color: C.accent, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Ready</Typography>
          </Box>
        )}
        <KeyboardArrowDownRounded sx={{ fontSize: 16, color: C.ash, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
      </Box>

      <Collapse in={expanded}>
        <Box sx={{ p: 2 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 1.25, lineHeight: 1.55 }) }}>
            Dictate the clinical narrative — admission reason, diagnosis, procedures, medications, follow-up, instructions.
            The report pipeline will merge this with the patient timeline data.
          </Typography>
          <Box sx={{ position: "relative" }}>
            <textarea
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder={`Example: Patient Mr. Rajesh Kumar, 58-year-old male, was admitted on 6th January 2026 under urology with presenting complaint of painless hematuria for 3 months...\n\nOn discharge, medications:\n1. Tab Amlodipine 5mg OD\n2. Tab Metformin 500mg BD\n\nFollow-up with urology in 2 weeks.`}
              maxLength={MAX}
              style={{
                width: "100%",
                minHeight: "220px",
                resize: "vertical",
                fontFamily: MONO,
                fontSize: "12px",
                fontWeight: 300,
                color: C.ink,
                background: C.white,
                border: `1px solid ${C.dictBorder}`,
                borderRadius: "3px",
                padding: "14px",
                lineHeight: 1.7,
                outline: "none",
                boxSizing: "border-box",
                transition: "border-color 0.15s",
              }}
              onFocus={e => { e.target.style.borderColor = C.accent; }}
              onBlur={e => { e.target.style.borderColor = C.dictBorder; }}
            />
            <Typography sx={{ ...os({ fontSize: 9, color: C.silver, position: "absolute", bottom: 8, right: 12, pointerEvents: "none" }) }}>
              {(value || "").length}/{MAX}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1.25 }}>
            <Box
              component="button"
              type="button"
              onClick={() => { onChange(""); }}
              disabled={!value?.trim()}
              sx={{
                fontSize: 11, fontFamily: FONT, fontWeight: 300, px: 1.5, py: 0.7,
                background: "transparent", color: C.ash, border: `1px solid ${C.fog}`,
                borderRadius: "3px", cursor: value?.trim() ? "pointer" : "not-allowed",
                opacity: value?.trim() ? 1 : 0.4, transition: "all 0.15s",
                "&:hover:not(:disabled)": { borderColor: C.mist, color: C.smoke },
              }}
            >
              Clear
            </Box>
            <Box
              component="button"
              type="button"
              onClick={() => { setExpanded(false); onSubmit(); }}
              disabled={loading}
              sx={{
                display: "flex", alignItems: "center", gap: 0.75,
                fontSize: 12, fontFamily: FONT, fontWeight: 300, px: 2.5, py: 0.9,
                background: loading ? C.ghost : C.accent,
                color:      loading ? C.ash   : C.white,
                border:     `1px solid ${loading ? C.fog : C.accent}`,
                borderRadius: "3px", cursor: loading ? "not-allowed" : "pointer",
                transition: "all 0.15s",
                "&:hover:not(:disabled)": { background: C.charcoal },
              }}
            >
              {loading
                ? <><CircularProgress size={12} sx={{ color: C.ash }} /> Generating…</>
                : <><ArticleRounded sx={{ fontSize: 14 }} /> Generate Report</>
              }
            </Box>
          </Box>
        </Box>
      </Collapse>
    </Box>
  );
};


// ══════════════════════════════════════════════════════════════════════════════
// SECTION EDIT MODAL  ← NEW
// ══════════════════════════════════════════════════════════════════════════════

const EditModal = ({ open, onClose, sectionTitle, sectionData, onSave }) => {
  const [draft, setDraft] = useState("");

  useEffect(() => {
    if (open) setDraft(JSON.stringify(sectionData, null, 2));
  }, [open, sectionData]);

  const handleSave = () => {
    try {
      const parsed = JSON.parse(draft);
      onSave(parsed);
      onClose();
    } catch {
      // show inline error without alert
      setDraft(prev => prev); // re-render to expose parse error feedback
    }
  };

  let parseError = null;
  try { JSON.parse(draft); } catch (e) { parseError = e.message; }

  return (
    <Modal open={open} onClose={onClose}>
      <Box sx={{
        position: "absolute", top: "50%", left: "50%",
        transform: "translate(-50%, -50%)",
        width: "min(720px, 92vw)",
        maxHeight: "85vh",
        display: "flex", flexDirection: "column",
        background: C.white,
        border: `1px solid ${C.fog}`,
        borderRadius: "6px",
        boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        overflow: "hidden",
      }}>
        {/* Modal header */}
        <Box sx={{ display: "flex", alignItems: "center", px: 2.5, py: 1.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, flexShrink: 0 }}>
          <EditRounded sx={{ fontSize: 14, color: C.accent, mr: 1.25 }} />
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink, flex: 1 }) }}>
            Edit — <span style={{ color: C.ash }}>{sectionTitle}</span>
          </Typography>
          <IconButton size="small" onClick={onClose} sx={{ color: C.ash }}>
            <CloseRounded sx={{ fontSize: 16 }} />
          </IconButton>
        </Box>

        {/* JSON editor */}
        <Box sx={{ flex: 1, overflow: "auto", p: 2 }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mb: 1, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
            Edit section data as JSON · changes are local to this session
          </Typography>
          <textarea
            value={draft}
            onChange={e => setDraft(e.target.value)}
            spellCheck={false}
            style={{
              width: "100%",
              minHeight: "360px",
              fontFamily: MONO,
              fontSize: "12px",
              fontWeight: 400,
              color: parseError ? C.critical : C.ink,
              background: parseError ? C.criticalBg : C.white,
              border: `1px solid ${parseError ? C.criticalBorder : C.fog}`,
              borderRadius: "3px",
              padding: "14px",
              lineHeight: 1.65,
              outline: "none",
              resize: "vertical",
              boxSizing: "border-box",
              transition: "border-color 0.15s",
            }}
          />
          {parseError && (
            <Typography sx={{ ...os({ fontSize: 10, color: C.critical, mt: 0.75, fontFamily: MONO }) }}>
              JSON error: {parseError}
            </Typography>
          )}
        </Box>

        {/* Modal footer */}
        <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, px: 2.5, py: 1.5, borderTop: `1px solid ${C.fog}`, background: C.ghost, flexShrink: 0 }}>
          <Box component="button" type="button" onClick={onClose}
            sx={{ fontSize: 11, fontFamily: FONT, fontWeight: 300, px: 2, py: 0.85, background: C.white, color: C.smoke, border: `1px solid ${C.fog}`, borderRadius: "3px", cursor: "pointer", "&:hover": { background: C.ghost } }}>
            Cancel
          </Box>
          <Box component="button" type="button" onClick={handleSave} disabled={!!parseError}
            sx={{ display: "flex", alignItems: "center", gap: 0.75, fontSize: 11, fontFamily: FONT, fontWeight: 300, px: 2, py: 0.85, background: parseError ? C.ghost : C.accent, color: parseError ? C.ash : C.white, border: `1px solid ${parseError ? C.fog : C.accent}`, borderRadius: "3px", cursor: parseError ? "not-allowed" : "pointer" }}>
            <SaveRounded sx={{ fontSize: 13 }} /> Save Changes
          </Box>
        </Box>
      </Box>
    </Modal>
  );
};


// ══════════════════════════════════════════════════════════════════════════════
// PDF EXPORT  ← NEW (hospital-grade print layout)
// Uses the browser's print API with a meticulously styled print document.
// ══════════════════════════════════════════════════════════════════════════════

const exportToPDF = (hmsReport, meta, patientId, doctorId) => {
  const s  = hmsReport || {};
  const s1 = s.section_1_patient_demographics    || {};
  const s2 = s.section_2_admission_details        || {};
  const s3 = s.section_3_clinicians               || {};
  const s4 = s.section_4_principal_diagnosis      || {};
  const s5 = s.section_5_secondary_diagnoses      || [];
  const s6 = s.section_6_presenting_complaints_and_history || {};
  const s7 = s.section_7_examination_on_admission || {};
  const s8 = s.section_8_investigations           || {};
  const s9 = s.section_9_procedures_interventions || [];
  const s10= s.section_10_hospital_course         || {};
  const s11= s.section_11_medications_on_discharge|| [];
  const s12= s.section_12_discharge_vitals        || {};
  const s13= s.section_13_discharge_condition     || {};
  const s14= s.section_14_discharge_instructions  || {};
  const s15= s.section_15_follow_up_plan          || [];
  const s16= s.section_16_allergies               || [];
  const s17= s.section_17_attestation             || {};

  const genDate = meta?.generated_at ? new Date(meta.generated_at).toLocaleString() : new Date().toLocaleString();
  const specialty = s.report_metadata?.specialty || "General Medicine";

  const val = (v) => (!v || v === "null" || v === "Not documented" || v === "N/A") ? "—" : v;
  const listRows = (items, fn) => (items || []).filter(Boolean).map(fn).join("");
  const safeList = (arr) => (arr || []).filter(i => i && i !== "null" && i !== "...").map(i => `<li>${i}</li>`).join("");

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>Discharge Summary — ${val(s1.patient_name)} — ${val(s2.admission_date)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&display=swap');

  * { box-sizing: border-box; margin: 0; padding: 0; }

  body {
    font-family: 'Inter', Arial, sans-serif;
    font-weight: 300;
    font-size: 10.5pt;
    color: #0F1923;
    background: white;
    line-height: 1.5;
  }

  /* ── Page layout ── */
  @page {
    size: A4;
    margin: 18mm 16mm 22mm 16mm;
    @top-left { content: ""; }
    @bottom-center {
      content: "CONFIDENTIAL MEDICAL RECORD  ·  Page " counter(page) " of " counter(pages);
      font-size: 7.5pt;
      color: #9BB0C1;
      font-family: 'Inter', Arial, sans-serif;
    }
  }

  /* ── Hospital letterhead ── */
  .letterhead {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    padding-bottom: 12px;
    border-bottom: 2.5pt solid #0F1923;
    margin-bottom: 12px;
  }
  .hospital-name {
    font-size: 18pt;
    font-weight: 600;
    color: #0F1923;
    letter-spacing: -0.03em;
    line-height: 1.1;
  }
  .hospital-sub {
    font-size: 8pt;
    color: #6B849A;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    margin-top: 3px;
  }
  .report-meta-right { text-align: right; }
  .report-type {
    font-size: 11pt;
    font-weight: 500;
    color: #0057B8;
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }
  .report-specialty {
    font-size: 8.5pt;
    color: #6B849A;
    margin-top: 2px;
  }
  .report-gendate {
    font-size: 7.5pt;
    color: #9BB0C1;
    margin-top: 4px;
  }

  /* ── Patient strip ── */
  .patient-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border: 1pt solid #E4EDF3;
    border-radius: 3pt;
    overflow: hidden;
    margin-bottom: 14px;
    background: #F2F7FA;
  }
  .strip-cell {
    padding: 8px 10px;
    border-right: 1pt solid #E4EDF3;
  }
  .strip-cell:last-child { border-right: none; }
  .strip-label { font-size: 7pt; color: #9BB0C1; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
  .strip-value { font-size: 10pt; font-weight: 500; color: #0F1923; }

  /* ── Allergy banner ── */
  .allergy-banner {
    background: #FFF1F2;
    border: 1pt solid #FECACA;
    border-left: 3pt solid #7F1D1D;
    border-radius: 2pt;
    padding: 7px 12px;
    margin-bottom: 12px;
    font-size: 9pt;
    color: #7F1D1D;
    font-weight: 400;
  }
  .allergy-banner strong { font-weight: 600; }

  /* ── CONFIDENTIAL watermark ── */
  .watermark {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%) rotate(-35deg);
    font-size: 64pt;
    font-weight: 700;
    color: rgba(0,87,184,0.04);
    text-transform: uppercase;
    letter-spacing: 0.15em;
    pointer-events: none;
    white-space: nowrap;
    z-index: 0;
  }

  /* ── Section ── */
  .section {
    break-inside: avoid;
    margin-bottom: 0;
    page-break-inside: avoid;
  }
  .section-header {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 7px 0 5px;
    border-top: 1pt solid #E4EDF3;
    margin-top: 2px;
  }
  .section-num {
    font-size: 7pt;
    color: #9BB0C1;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    min-width: 18px;
  }
  .section-title {
    font-size: 8pt;
    font-weight: 500;
    color: #3D5166;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    flex: 1;
    border-bottom: 0.5pt solid #C8D8E3;
    padding-bottom: 3px;
  }
  .section-body { padding: 8px 0 10px 0; }

  /* ── Field rows ── */
  .field-row {
    display: grid;
    grid-template-columns: 140px 1fr;
    gap: 8px 12px;
    margin-bottom: 4px;
    align-items: baseline;
  }
  .field-label { font-size: 8pt; color: #9BB0C1; text-transform: uppercase; letter-spacing: 0.07em; }
  .field-value { font-size: 10pt; color: #0F1923; line-height: 1.5; }
  .field-value.mono { font-family: 'Courier New', monospace; font-size: 9.5pt; }
  .field-value.alert { color: #7F1D1D; font-weight: 500; }

  /* ── Two-column grid ── */
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 28px; }
  .grid4 { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 8px 0; }

  /* ── Principal diagnosis box ── */
  .dx-box {
    background: #F2F7FA;
    border: 1pt solid #E4EDF3;
    border-left: 3pt solid #0F1923;
    border-radius: 2pt;
    padding: 10px 12px;
    margin-bottom: 10px;
  }
  .dx-main { font-size: 13pt; font-weight: 400; color: #0F1923; line-height: 1.35; }
  .dx-meta { display: flex; gap: 16px; margin-top: 5px; }
  .dx-code { font-family: 'Courier New', monospace; font-size: 9pt; color: #0057B8; background: #E8F1FB; padding: 2px 6px; border-radius: 2pt; }
  .dx-type { font-size: 8.5pt; color: #6B849A; background: #F2F7FA; padding: 2px 7px; border: 1pt solid #E4EDF3; border-radius: 2pt; }

  /* ── Secondary dx list ── */
  .sec-dx-row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 4px 0;
    border-bottom: 0.5pt solid #F2F7FA;
    font-size: 10pt;
    color: #1E2D3D;
  }
  .sec-dx-row .tag { font-size: 7.5pt; color: #9BB0C1; background: #F2F7FA; padding: 1px 5px; border-radius: 2pt; white-space: nowrap; }
  .sec-dx-code { font-family: 'Courier New', monospace; font-size: 8.5pt; color: #0057B8; margin-left: auto; white-space: nowrap; }

  /* ── Vitals cards ── */
  .vital-card {
    background: #F2F7FA;
    border: 1pt solid #E4EDF3;
    border-radius: 2pt;
    padding: 7px 8px;
    text-align: center;
  }
  .vital-label { font-size: 7pt; color: #9BB0C1; text-transform: uppercase; letter-spacing: 0.07em; margin-bottom: 3px; }
  .vital-value { font-size: 11.5pt; font-weight: 400; color: #0F1923; }

  /* ── Lab table ── */
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt; margin: 4px 0; }
  th { background: #F2F7FA; font-size: 7.5pt; color: #9BB0C1; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 400; padding: 5px 8px; border: 0.5pt solid #E4EDF3; text-align: left; }
  td { padding: 5px 8px; border: 0.5pt solid #E4EDF3; color: #0F1923; vertical-align: top; }
  tr:nth-child(even) td { background: #F8FBFF; }
  .badge { display: inline-block; padding: 1px 5px; border-radius: 2pt; font-size: 7pt; text-transform: uppercase; letter-spacing: 0.05em; font-weight: 400; }
  .badge-normal   { background: #ECFDF5; color: #065F46; }
  .badge-abnormal { background: #FFFBEB; color: #92400E; }
  .badge-critical { background: #FFF1F2; color: #7F1D1D; font-weight: 600; }

  /* ── Procedure block ── */
  .proc-block {
    border: 1pt solid #E4EDF3;
    border-left: 2pt solid #1E2D3D;
    border-radius: 2pt;
    padding: 10px 12px;
    margin-bottom: 8px;
  }
  .proc-name { font-size: 11.5pt; font-weight: 400; color: #0F1923; margin-bottom: 6px; }

  /* ── Narrative box ── */
  .narrative {
    background: #F8FBFF;
    border: 1pt solid #E4EDF3;
    border-radius: 2pt;
    padding: 12px 14px;
    font-size: 10.5pt;
    line-height: 1.75;
    color: #1E2D3D;
    margin-bottom: 10px;
  }

  /* ── Medications ── */
  .med-row {
    display: flex;
    gap: 12px;
    align-items: baseline;
    padding: 5px 0;
    border-bottom: 0.5pt solid #F2F7FA;
    font-size: 10pt;
  }
  .med-num { color: #9BB0C1; min-width: 18px; font-size: 9pt; }
  .med-name { font-weight: 400; color: #0F1923; flex: 1; }
  .med-detail { color: #3D5166; font-size: 9.5pt; }
  .med-note { color: #6B849A; font-size: 8.5pt; font-style: italic; margin-top: 2px; }

  /* ── Warning / emergency boxes ── */
  .warn-box {
    background: #FFFBEB;
    border: 1pt solid #FCD34D;
    border-left: 3pt solid #92400E;
    border-radius: 2pt;
    padding: 8px 12px;
    margin: 6px 0;
  }
  .warn-box .box-label { font-size: 7.5pt; color: #92400E; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; margin-bottom: 4px; }
  .emg-box {
    background: #FFF1F2;
    border: 1pt solid #FECACA;
    border-left: 3pt solid #7F1D1D;
    border-radius: 2pt;
    padding: 8px 12px;
    margin: 6px 0;
  }
  .emg-box .box-label { font-size: 7.5pt; color: #7F1D1D; text-transform: uppercase; letter-spacing: 0.08em; font-weight: 500; margin-bottom: 4px; }
  ul { list-style: none; padding: 0; }
  li { padding: 2px 0 2px 12px; position: relative; font-size: 10pt; line-height: 1.5; }
  li::before { content: "·"; position: absolute; left: 0; color: #9BB0C1; }

  /* ── Follow-up ── */
  .fu-card {
    border: 1pt solid #E4EDF3;
    border-radius: 2pt;
    padding: 8px 12px;
    margin-bottom: 6px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 2px 16px;
  }

  /* ── Attestation box ── */
  .attestation {
    border: 1pt solid #E4EDF3;
    border-top: 2pt solid #0F1923;
    border-radius: 2pt;
    padding: 12px;
    background: #F2F7FA;
    margin-top: 6px;
  }

  /* ── Divider with label ── */
  .sub-divider { display: flex; align-items: center; gap: 10px; margin: 10px 0 7px; }
  .sub-divider span { font-size: 7.5pt; color: #9BB0C1; text-transform: uppercase; letter-spacing: 0.09em; white-space: nowrap; }
  .sub-divider::before, .sub-divider::after { content: ""; flex: 1; height: 0.5pt; background: #E4EDF3; }

  /* ── Footer ── */
  .doc-footer {
    margin-top: 20px;
    padding-top: 10px;
    border-top: 1pt solid #E4EDF3;
    display: flex;
    justify-content: space-between;
    font-size: 8pt;
    color: #9BB0C1;
  }

  @media print {
    .no-print { display: none !important; }
    .section { page-break-inside: avoid; }
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>

<div class="watermark">CONFIDENTIAL</div>

<!-- ═══ LETTERHEAD ═══ -->
<div class="letterhead">
  <div>
    <div class="hospital-name">Hospital Management System</div>
    <div class="hospital-sub">Clinical Documentation · Discharge Summary</div>
  </div>
  <div class="report-meta-right">
    <div class="report-type">Discharge Summary</div>
    <div class="report-specialty">${specialty}</div>
    <div class="report-gendate">Generated: ${genDate}</div>
  </div>
</div>

<!-- ═══ PATIENT STRIP ═══ -->
<div class="patient-strip">
  <div class="strip-cell">
    <div class="strip-label">Patient</div>
    <div class="strip-value">${val(s1.patient_name)}</div>
  </div>
  <div class="strip-cell">
    <div class="strip-label">Admission</div>
    <div class="strip-value">${val(s2.admission_date)}</div>
  </div>
  <div class="strip-cell">
    <div class="strip-label">Discharge</div>
    <div class="strip-value">${val(s2.discharge_date)}</div>
  </div>
  <div class="strip-cell">
    <div class="strip-label">Consultant</div>
    <div class="strip-value">${val(s3.attending_consultant)}</div>
  </div>
</div>

${s16.filter(a => a?.allergen && a.allergen !== "null").length > 0 ? `
<div class="allergy-banner">
  ⚠ <strong>ALLERGIES:</strong> ${s16.map(a => `${a.allergen} (${a.reaction_type || "reaction"} · ${a.severity || ""})`).join(" | ")}
</div>` : ""}

<!-- ═══ SECTION 1 — DEMOGRAPHICS ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">01</span><span class="section-title">Patient Demographics &amp; Identifiers</span></div>
  <div class="section-body">
    <div class="grid2">
      <div>
        ${[["Patient Name", s1.patient_name], ["Date of Birth", s1.date_of_birth], ["Age", s1.age], ["Sex", s1.sex]].map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${val(v)}</span></div>`).join("")}
      </div>
      <div>
        ${[["Patient ID", patientId], ["Blood Group", s1.blood_group], ["Contact", s1.contact_number], ["Insurance", s1.insurance_details]].map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value ${l==="Patient ID"?"mono":""}">${val(v)}</span></div>`).join("")}
      </div>
    </div>
    ${s1.address && s1.address !== "null" ? `<div class="field-row"><span class="field-label">Address</span><span class="field-value">${s1.address}</span></div>` : ""}
    ${s1.emergency_contact && s1.emergency_contact !== "null" ? `<div class="field-row"><span class="field-label">Emergency Contact</span><span class="field-value">${s1.emergency_contact}</span></div>` : ""}
  </div>
</div>

<!-- ═══ SECTION 2 — ADMISSION ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">02</span><span class="section-title">Admission Details</span></div>
  <div class="section-body">
    <div class="grid2">
      <div>
        ${[["Date of Admission", s2.admission_date], ["Date of Discharge", s2.discharge_date], ["Length of Stay", s2.length_of_stay]].map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${val(v)}</span></div>`).join("")}
      </div>
      <div>
        ${[["Ward / Unit", s2.ward], ["Admission Type", s2.admission_type], ["Mode", s2.mode_of_admission]].map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${val(v)}</span></div>`).join("")}
      </div>
    </div>
  </div>
</div>

<!-- ═══ SECTION 3 — CLINICIANS ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">03</span><span class="section-title">Treating Team</span></div>
  <div class="section-body">
    <div class="grid2">
      ${[["Attending Consultant", s3.attending_consultant], ["Resident Doctor", s3.resident_doctor], ["Anaesthetist", s3.anaesthetist], ["Primary Nurse", s3.primary_nurse]].map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${val(v)}</span></div>`).join("")}
    </div>
    ${(s3.consulting_specialists||[]).filter(Boolean).length > 0 ? `<div class="field-row"><span class="field-label">Consulting</span><span class="field-value">${s3.consulting_specialists.filter(Boolean).join(" · ")}</span></div>` : ""}
  </div>
</div>

<!-- ═══ SECTION 4 — PRINCIPAL DIAGNOSIS ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">04</span><span class="section-title">Principal Diagnosis</span></div>
  <div class="section-body">
    <div class="dx-box">
      <div class="dx-main">${val(s4.diagnosis)}</div>
      <div class="dx-meta">
        ${s4.icd_10_code && s4.icd_10_code !== "null" ? `<span class="dx-code">${s4.icd_10_code}</span>` : ""}
        ${s4.diagnosis_type && s4.diagnosis_type !== "null" ? `<span class="dx-type">${s4.diagnosis_type}</span>` : ""}
        ${s4.laterality && !["Not applicable","null",null].includes(s4.laterality) ? `<span class="dx-type">${s4.laterality}</span>` : ""}
      </div>
    </div>
  </div>
</div>

<!-- ═══ SECTION 5 — SECONDARY DIAGNOSES ═══ -->
${s5.filter(d => d?.diagnosis && d.diagnosis !== "null").length > 0 ? `
<div class="section">
  <div class="section-header"><span class="section-num">05</span><span class="section-title">Secondary Diagnoses &amp; Comorbidities</span></div>
  <div class="section-body">
    ${s5.filter(d => d?.diagnosis && d.diagnosis !== "null").map(d => `
    <div class="sec-dx-row">
      <span>${d.diagnosis}</span>
      ${d.relationship ? `<span class="tag">${d.relationship}</span>` : ""}
      ${d.icd_10_code && d.icd_10_code !== "null" ? `<span class="sec-dx-code">${d.icd_10_code}</span>` : ""}
    </div>`).join("")}
  </div>
</div>` : ""}

<!-- ═══ SECTION 6 — HISTORY ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">06</span><span class="section-title">Presenting Complaints &amp; History</span></div>
  <div class="section-body">
    ${(s6.chief_complaints||[]).filter(c => c && c !== "...").length > 0 ? `
    <div class="field-row"><span class="field-label">Chief Complaints</span>
    <span class="field-value">${s6.chief_complaints.filter(c=>c&&c!=="...").join(" · ")}</span></div>` : ""}
    ${s6.duration_of_complaints ? `<div class="field-row"><span class="field-label">Duration</span><span class="field-value">${s6.duration_of_complaints}</span></div>` : ""}
    ${s6.history_of_present_illness && s6.history_of_present_illness !== "null" ? `
    <div class="sub-divider"><span>History of Present Illness</span></div>
    <div class="narrative">${s6.history_of_present_illness}</div>` : ""}
    ${(s6.past_medical_history||[]).filter(Boolean).length > 0 ? `
    <div class="sub-divider"><span>Past Medical History</span></div>
    <ul>${safeList(s6.past_medical_history)}</ul>` : ""}
    ${(s6.past_surgical_history||[]).filter(Boolean).length > 0 ? `
    <div class="sub-divider"><span>Past Surgical History</span></div>
    <ul>${safeList(s6.past_surgical_history)}</ul>` : ""}
    <div class="grid2" style="margin-top:6px">
      ${s6.family_history && s6.family_history !== "null" ? `<div class="field-row"><span class="field-label">Family History</span><span class="field-value">${s6.family_history}</span></div>` : ""}
      ${s6.social_history && s6.social_history !== "null" ? `<div class="field-row"><span class="field-label">Social History</span><span class="field-value">${s6.social_history}</span></div>` : ""}
    </div>
  </div>
</div>

<!-- ═══ SECTION 7 — EXAMINATION ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">07</span><span class="section-title">Examination on Admission</span></div>
  <div class="section-body">
    ${s7.general_appearance && s7.general_appearance !== "null" ? `<div class="field-row"><span class="field-label">General</span><span class="field-value">${s7.general_appearance}</span></div>` : ""}
    ${Object.values(s7.vitals||{}).some(v => v && v !== "null") ? `
    <div class="sub-divider"><span>Vitals on Admission</span></div>
    <div class="grid4">
      ${[["BP", "blood_pressure"], ["HR", "heart_rate"], ["RR", "respiratory_rate"], ["Temp", "temperature"], ["SpO2", "spo2"], ["Weight", "weight"], ["Height", "height"], ["BMI", "bmi"]]
        .filter(([,k]) => s7.vitals?.[k] && s7.vitals[k] !== "null")
        .map(([l,k]) => `<div class="vital-card"><div class="vital-label">${l}</div><div class="vital-value">${s7.vitals[k]}</div></div>`).join("")}
    </div>` : ""}
    ${Object.values(s7.systemic_examination||{}).some(v => v && v !== "null" && v !== "Not documented") ? `
    <div class="sub-divider"><span>Systemic Examination</span></div>
    <div class="grid2">
      ${[["Cardiovascular", "cardiovascular"], ["Respiratory", "respiratory"], ["Abdomen", "abdomen"], ["CNS", "central_nervous_system"], ["Musculoskeletal", "musculoskeletal"], ["Other", "other"]]
        .filter(([,k]) => s7.systemic_examination?.[k] && s7.systemic_examination[k] !== "null" && s7.systemic_examination[k] !== "Not documented")
        .map(([l,k]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${s7.systemic_examination[k]}</span></div>`).join("")}
    </div>` : ""}
  </div>
</div>

<!-- ═══ SECTION 8 — INVESTIGATIONS ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">08</span><span class="section-title">Investigations &amp; Results</span></div>
  <div class="section-body">
    ${(s8.laboratory||[]).filter(Boolean).length > 0 ? `
    <div class="sub-divider"><span>Laboratory</span></div>
    <table>
      <thead><tr><th>Test</th><th>Result</th><th>Unit</th><th>Reference</th><th>Date</th><th>Status</th></tr></thead>
      <tbody>
        ${s8.laboratory.filter(Boolean).map(r => `
        <tr>
          <td>${r.test||"—"}</td>
          <td>${r.result||"—"}</td>
          <td>${r.unit||"—"}</td>
          <td>${r.reference_range||"—"}</td>
          <td>${r.date||"—"}</td>
          <td>${r.status ? `<span class="badge badge-${(r.status||"").toLowerCase()}">${r.status}</span>` : "—"}</td>
        </tr>`).join("")}
      </tbody>
    </table>` : ""}
    ${(s8.imaging||[]).filter(Boolean).length > 0 ? `
    <div class="sub-divider"><span>Imaging</span></div>
    ${s8.imaging.filter(Boolean).map(i => `
    <div style="border:0.5pt solid #E4EDF3;border-radius:2pt;padding:7px 10px;margin-bottom:5px;background:#F8FBFF">
      <div style="display:flex;justify-content:space-between;margin-bottom:3px">
        <strong style="font-size:10pt">${i.modality||""} ${i.region ? `— ${i.region}` : ""}</strong>
        <span style="font-size:8pt;color:#9BB0C1">${i.date||""}</span>
      </div>
      <div style="font-size:10pt;color:#1E2D3D">${i.findings||""}</div>
    </div>`).join("")}` : ""}
    ${(s8.ecg_echo||[]).filter(Boolean).length > 0 ? `
    <div class="sub-divider"><span>ECG / Echocardiogram</span></div>
    ${s8.ecg_echo.filter(Boolean).map(e => `
    <div style="border:0.5pt solid #E4EDF3;border-radius:2pt;padding:7px 10px;margin-bottom:5px">
      <strong>${e.type||""}</strong> ${e.date ? `<span style="color:#9BB0C1;font-size:8.5pt">(${e.date})</span>` : ""}
      <div style="margin-top:3px;font-size:10pt">${e.findings||""}</div>
    </div>`).join("")}` : ""}
  </div>
</div>

<!-- ═══ SECTION 9 — PROCEDURES ═══ -->
${s9.filter(p => p?.procedure_name && p.procedure_name !== "null").length > 0 ? `
<div class="section">
  <div class="section-header"><span class="section-num">09</span><span class="section-title">Procedures &amp; Interventions</span></div>
  <div class="section-body">
    ${s9.filter(p => p?.procedure_name && p.procedure_name !== "null").map(p => `
    <div class="proc-block">
      <div class="proc-name">${p.procedure_name}</div>
      <div class="grid2">
        ${[["Date", p.date], ["Surgeon", p.surgeon_operator], ["Anaesthesia", p.anaesthesia_type], ["Indication", p.indication]].filter(([,v]) => v && v !== "null").map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${v}</span></div>`).join("")}
      </div>
      ${p.intraoperative_findings && p.intraoperative_findings !== "null" ? `<div class="field-row"><span class="field-label">Findings</span><span class="field-value">${p.intraoperative_findings}</span></div>` : ""}
      ${p.complications && !["None","Nil","null","None.","No complications"].includes(p.complications) ? `<div class="field-row"><span class="field-label" style="color:#7F1D1D">Complications</span><span class="field-value alert">${p.complications}</span></div>` : ""}
      ${p.outcome && p.outcome !== "null" ? `<div class="field-row"><span class="field-label">Outcome</span><span class="field-value">${p.outcome}</span></div>` : ""}
    </div>`).join("")}
  </div>
</div>` : ""}

<!-- ═══ SECTION 10 — HOSPITAL COURSE ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">10</span><span class="section-title">Hospital Course</span></div>
  <div class="section-body">
    ${s10.narrative && s10.narrative !== "null" ? `<div class="narrative">${s10.narrative}</div>` : ""}
    ${(s10.clinical_days||[]).filter(d => d?.date || d?.key_events).length > 0 ? `
    <div class="sub-divider"><span>Day-by-Day Summary</span></div>
    <table>
      <thead><tr><th>Date</th><th>Day</th><th>Key Events</th></tr></thead>
      <tbody>
        ${s10.clinical_days.filter(Boolean).map(d => `<tr><td style="white-space:nowrap">${d.date||"—"}</td><td style="white-space:nowrap">${d.day_label||""}</td><td>${d.key_events||""}</td></tr>`).join("")}
      </tbody>
    </table>` : ""}
    ${(s10.significant_events||[]).filter(e => e && e !== "...").length > 0 ? `
    <div class="sub-divider"><span>Significant Events</span></div>
    <ul>${safeList(s10.significant_events)}</ul>` : ""}
    ${(s10.complications_during_admission||[]).filter(c => c && c !== "..." && c !== "None").length > 0 ? `
    <div class="sub-divider"><span>Complications</span></div>
    <ul>${safeList(s10.complications_during_admission)}</ul>` : ""}
  </div>
</div>

<!-- ═══ SECTION 11 — MEDICATIONS ON DISCHARGE ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">11</span><span class="section-title">Medications on Discharge</span></div>
  <div class="section-body">
    ${s11.filter(m => m?.drug_name && m.drug_name !== "null").length > 0 ? s11.filter(m => m?.drug_name && m.drug_name !== "null").map((m, i) => `
    <div class="med-row">
      <span class="med-num">${i+1}.</span>
      <div>
        <span class="med-name">${m.drug_name}${m.brand_name && m.brand_name !== "null" && m.brand_name !== "Not specified" ? ` <span style="color:#6B849A;font-size:9pt">(${m.brand_name})</span>` : ""}</span>
        <span class="med-detail">${[m.dose, m.route ? `(${m.route})` : null, m.frequency, m.duration ? `× ${m.duration}` : null].filter(Boolean).join("  ")}</span>
        ${m.special_instructions && m.special_instructions !== "null" ? `<div class="med-note">Note: ${m.special_instructions}</div>` : ""}
        ${m.indication && m.indication !== "null" ? `<div class="med-note">For: ${m.indication}</div>` : ""}
      </div>
    </div>`).join("") : '<div style="font-style:italic;color:#9BB0C1;font-size:10pt">No discharge medications documented.</div>'}
  </div>
</div>

<!-- ═══ SECTION 12 — DISCHARGE VITALS ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">12</span><span class="section-title">Discharge Vitals</span></div>
  <div class="section-body">
    ${Object.values(s12).some(v => v && v !== "null" && v !== "Not documented") ? `
    <div class="grid4">
      ${[["BP", "blood_pressure"], ["HR", "heart_rate"], ["RR", "respiratory_rate"], ["Temp", "temperature"], ["SpO2", "spo2"], ["Weight", "weight"]]
        .filter(([,k]) => s12[k] && s12[k] !== "null" && s12[k] !== "Not documented")
        .map(([l,k]) => `<div class="vital-card"><div class="vital-label">${l}</div><div class="vital-value">${s12[k]}</div></div>`).join("")}
    </div>
    ${s12.general_condition && s12.general_condition !== "null" ? `<div class="field-row" style="margin-top:8px"><span class="field-label">General Condition</span><span class="field-value">${s12.general_condition}</span></div>` : ""}` :
    '<div style="font-style:italic;color:#9BB0C1;font-size:10pt">Discharge vitals not documented.</div>'}
  </div>
</div>

<!-- ═══ SECTION 13 — CONDITION ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">13</span><span class="section-title">Condition on Discharge</span></div>
  <div class="section-body">
    <div class="grid2">
      ${[["Overall Condition", s13.overall_condition], ["Functional Status", s13.functional_status], ["Mobility", s13.mobility], ["Pain Level", s13.pain_level], ["Wound Status", s13.wound_status]].filter(([,v]) => v && v !== "null").map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${v}</span></div>`).join("") || '<div style="font-style:italic;color:#9BB0C1;font-size:10pt">Not documented.</div>'}
    </div>
  </div>
</div>

<!-- ═══ SECTION 14 — INSTRUCTIONS ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">14</span><span class="section-title">Discharge Instructions</span></div>
  <div class="section-body">
    <div class="grid2">
      ${[["Activity", s14.activity], ["Diet", s14.diet], ["Wound Care", s14.wound_care], ["Catheter/Drain", s14.catheter_drain_care]].filter(([,v]) => v && v !== "null").map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${v}</span></div>`).join("")}
    </div>
    ${(s14.restrictions||[]).filter(Boolean).length > 0 ? `<div class="sub-divider"><span>Restrictions</span></div><ul>${safeList(s14.restrictions)}</ul>` : ""}
    ${(s14.warning_signs_to_watch||[]).filter(Boolean).length > 0 ? `
    <div class="warn-box">
      <div class="box-label">⚠ Warning Signs — Contact Doctor If</div>
      <ul>${safeList(s14.warning_signs_to_watch)}</ul>
    </div>` : ""}
    ${(s14.when_to_seek_emergency_care||[]).filter(Boolean).length > 0 ? `
    <div class="emg-box">
      <div class="box-label">🚨 Go to Emergency Immediately If</div>
      <ul>${safeList(s14.when_to_seek_emergency_care)}</ul>
    </div>` : ""}
  </div>
</div>

<!-- ═══ SECTION 15 — FOLLOW-UP ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">15</span><span class="section-title">Follow-Up Plan</span></div>
  <div class="section-body">
    ${s15.filter(f => f?.appointment_with && f.appointment_with !== "null").map(f => `
    <div class="fu-card">
      <div class="field-row"><span class="field-label">With</span><span class="field-value">${[f.appointment_with, f.specialty].filter(Boolean).join(" · ")}</span></div>
      <div class="field-row"><span class="field-label">When</span><span class="field-value">${val(f.timeframe)}</span></div>
      <div class="field-row"><span class="field-label">Where</span><span class="field-value">${val(f.location)}</span></div>
      <div class="field-row"><span class="field-label">Purpose</span><span class="field-value">${val(f.purpose)}</span></div>
      ${(f.tests_before_visit||[]).filter(Boolean).length > 0 ? `<div class="field-row" style="grid-column:1/-1"><span class="field-label">Pre-visit Tests</span><span class="field-value">${f.tests_before_visit.join(", ")}</span></div>` : ""}
    </div>`).join("") || '<div style="font-style:italic;color:#9BB0C1;font-size:10pt">No follow-up plan documented.</div>'}
  </div>
</div>

<!-- ═══ SECTION 16 — ALLERGIES ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">16</span><span class="section-title">Allergies &amp; Adverse Reactions</span></div>
  <div class="section-body">
    ${s16.filter(a => a?.allergen && a.allergen !== "null").length > 0
      ? s16.map(a => `<div style="display:flex;gap:10px;align-items:baseline;padding:4px 0;border-bottom:0.5pt solid #F2F7FA"><span style="color:#7F1D1D;font-weight:500">⚠ ${a.allergen}</span><span style="color:#6B849A;font-size:9.5pt">${a.reaction_type||""}</span><span class="badge badge-critical" style="margin-left:auto">${a.severity||""}</span></div>`).join("")
      : '<div style="color:#065F46;font-size:10pt">✓ No known allergies documented.</div>'}
  </div>
</div>

<!-- ═══ SECTION 17 — ATTESTATION ═══ -->
<div class="section">
  <div class="section-header"><span class="section-num">17</span><span class="section-title">Clinician Attestation</span></div>
  <div class="section-body">
    <div class="attestation">
      <div class="grid2">
        ${[["Prepared By", s17.prepared_by], ["Designation", s17.designation], ["Date", s17.date], ["Reviewed By", s17.reviewed_by], ["Reviewer Designation", s17.reviewer_designation], ["Digital Signature", s17.digital_signature]].filter(([,v]) => v && v !== "null").map(([l,v]) => `<div class="field-row"><span class="field-label">${l}</span><span class="field-value">${v}</span></div>`).join("")}
      </div>
      <div style="margin-top:14px;display:grid;grid-template-columns:1fr 1fr;gap:32px">
        <div><div style="border-top:1pt solid #0F1923;padding-top:4px;margin-top:24px"><span style="font-size:8pt;color:#9BB0C1">Treating Physician Signature</span></div></div>
        <div><div style="border-top:1pt solid #0F1923;padding-top:4px;margin-top:24px"><span style="font-size:8pt;color:#9BB0C1">Reviewer / Department Head Signature</span></div></div>
      </div>
    </div>
  </div>
</div>

<!-- ═══ DOCUMENT FOOTER ═══ -->
<div class="doc-footer">
  <span>Patient ID: ${patientId} · Doctor ID: ${doctorId}</span>
  <span>This document is CONFIDENTIAL and intended for medical personnel only.</span>
  <span>Version 3.0</span>
</div>

</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) { alert("Please allow pop-ups to export PDF."); return; }
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => { win.print(); }, 800);
};


// ══════════════════════════════════════════════════════════════════════════════
// QUALITY BAR
// ══════════════════════════════════════════════════════════════════════════════

const QualityBar = ({ label, value }) => {
  const pct = Math.round((value || 0) * 100);
  const color = pct >= 80 ? C.ok : pct >= 50 ? C.warn : C.critical;
  return (
    <Box sx={{ minWidth: 90 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.3 }}>
        <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
          {label.replace(/_/g, " ")}
        </Typography>
        <Typography sx={{ ...os({ fontSize: 9, color, fontWeight: 400 }) }}>{pct}%</Typography>
      </Box>
      <Box sx={{ height: 2, background: C.fog, borderRadius: "1px", overflow: "hidden" }}>
        <Box sx={{ height: "100%", width: `${pct}%`, background: color, transition: "width 0.6s ease" }} />
      </Box>
    </Box>
  );
};

const QualityRibbon = ({ quality }) => {
  const [open, setOpen] = useState(false);
  if (!quality) return null;
  const scores   = quality.scores || {};
  const gaps     = quality.gaps   || [];
  const recs     = quality.recommendations_for_clinician || [];
  const approved = quality.approved_for_clinical_use;
  return (
    <Box sx={{ border: `1px solid ${approved ? C.okBorder : C.criticalBorder}`, borderRadius: "3px", background: approved ? C.okBg : C.criticalBg, mb: 2.5, overflow: "hidden" }}>
      
      <Collapse in={open}>
        <Box sx={{ px: 2, pb: 1.75, borderTop: `1px solid ${approved ? C.okBorder : C.criticalBorder}` }}>
          {quality.review_notes && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6, mt: 1.25, mb: 1.25 }) }}>{quality.review_notes}</Typography>}
          {gaps.length > 0 && <><Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75, mt: 0.5 }) }}>Documentation Gaps</Typography><BulletList items={gaps} color={C.warn} /></>}
          {recs.length > 0 && <><Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75, mt: 1.25 }) }}>Recommendations</Typography><BulletList items={recs} color={C.charcoal} /></>}
        </Box>
      </Collapse>
    </Box>
  );
};


// ══════════════════════════════════════════════════════════════════════════════
// DOCUMENT HEADER
// ══════════════════════════════════════════════════════════════════════════════

const DocumentHeader = ({ hms, meta }) => {
  const s1 = hms?.section_1_patient_demographics || {};
  const s2 = hms?.section_2_admission_details    || {};
  const s3 = hms?.section_3_clinicians           || {};
  const rm = hms?.report_metadata                || {};
  return (
    <Box sx={{ borderBottom: `2px solid ${C.ink}`, pb: 2, mb: 0 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.12em", mb: 0.5 }) }}>
            Hospital Management System
          </Typography>
          <Typography sx={{ ...os({ fontSize: 18, color: C.ink, fontWeight: 400, letterSpacing: "-0.02em" }) }}>
            Discharge Summary
          </Typography>
          {rm.specialty && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>{rm.specialty}</Typography>}
        </Box>
        <Box sx={{ textAlign: "right" }}>
          <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.3 }) }}>Generated</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ink }) }}>
            {meta?.generated_at ? new Date(meta.generated_at).toLocaleString() : "—"}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 9, color: C.silver, mt: 0.25 }) }}>v{rm.version || "3.0"}</Typography>
        </Box>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", border: `1px solid ${C.fog}`, borderRadius: "2px", overflow: "hidden" }}>
        {[
          { label: "Patient",    value: s1.patient_name || s1.patient_id },
          { label: "Admission",  value: s2.admission_date },
          { label: "Discharge",  value: s2.discharge_date },
          { label: "Consultant", value: s3.attending_consultant },
        ].map((item, i, arr) => (
          <Box key={item.label} sx={{ p: 1.25, borderRight: i < arr.length - 1 ? `1px solid ${C.fog}` : "none", background: i === 0 ? C.ghost : C.white }}>
            <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.3 }) }}>{item.label}</Typography>
            <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{item.value || "—"}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};


// ══════════════════════════════════════════════════════════════════════════════
// ALL SECTION RENDERERS (same as before, unchanged)
// ══════════════════════════════════════════════════════════════════════════════

const S1_Demographics = ({ s }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
    <Field label="Patient Name"      value={s?.patient_name} />
    <Field label="Patient ID"        value={s?.patient_id} mono />
    <Field label="Date of Birth"     value={s?.date_of_birth} />
    <Field label="Age / Sex"         value={[s?.age, s?.sex].filter(Boolean).join(" · ")} />
    <Field label="Blood Group"       value={s?.blood_group} />
    <Field label="Contact"           value={s?.contact_number} />
    <Field label="Address"           value={s?.address} />
    <Field label="Emergency Contact" value={s?.emergency_contact} />
    <Field label="Insurance"         value={s?.insurance_details} />
  </Box>
);

const S2_Admission = ({ s }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
    <Field label="Admission Date"    value={s?.admission_date} />
    <Field label="Discharge Date"    value={s?.discharge_date} />
    <Field label="Length of Stay"    value={s?.length_of_stay} />
    <Field label="Ward / Unit"       value={s?.ward} />
    <Field label="Bed Number"        value={s?.bed_number} />
    <Field label="Admission Type"    value={s?.admission_type} />
    <Field label="Mode of Admission" value={s?.mode_of_admission} />
    <Field label="Referral Source"   value={s?.referral_source} />
  </Box>
);

const S3_Clinicians = ({ s }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
    <Field label="Attending Consultant" value={s?.attending_consultant} />
    <Field label="Resident Doctor"      value={s?.resident_doctor} />
    <Field label="Anaesthetist"         value={s?.anaesthetist} />
    <Field label="Primary Nurse"        value={s?.primary_nurse} />
    {(s?.consulting_specialists || []).filter(Boolean).length > 0 && (
      <Box sx={{ gridColumn: "1 / -1", mb: 0.85 }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>Consulting Specialists</Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap" }}>
          {s.consulting_specialists.map((sp, i) => <Pill key={i} label={sp} />)}
        </Box>
      </Box>
    )}
  </Box>
);

const S4_PrincipalDiagnosis = ({ s }) => (
  <Box>
    <Box sx={{ p: 2, border: `1px solid ${C.fog}`, borderLeft: `3px solid ${C.ink}`, borderRadius: "2px", background: C.ghost, mb: 1.5 }}>
      <Typography sx={{ ...os({ fontSize: 15, color: C.ink, lineHeight: 1.45 }) }}>{s?.diagnosis || "Not documented"}</Typography>
    </Box>
    <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
      {s?.icd_10_code && s.icd_10_code !== "null" && (
        <Box><Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.3 }) }}>ICD-10</Typography>
          <Typography sx={{ ...os({ fontSize: 12, color: C.accent, fontFamily: MONO }) }}>{s.icd_10_code}</Typography>
        </Box>
      )}
      {s?.diagnosis_type && s.diagnosis_type !== "null" && (
        <Box><Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.3 }) }}>Type</Typography><Pill label={s.diagnosis_type} /></Box>
      )}
    </Box>
  </Box>
);

const S5_SecondaryDiagnoses = ({ s }) => {
  const valid = (s || []).filter(d => d?.diagnosis && d.diagnosis !== "null" && d.diagnosis !== "...");
  if (!valid.length) return <Typography sx={{ ...os({ fontSize: 12, color: C.silver, fontStyle: "italic" }) }}>None documented.</Typography>;
  return (
    <Box>
      {valid.map((d, i) => (
        <Box key={i} sx={{ display: "flex", alignItems: "baseline", gap: 1.5, mb: 0.85, pb: 0.85, borderBottom: i < valid.length - 1 ? `1px solid ${C.fog}` : "none" }}>
          <FiberManualRecordRounded sx={{ fontSize: 5, color: C.mist, mt: 0.9, flexShrink: 0 }} />
          <Typography sx={{ ...os({ fontSize: 12, color: C.ink, lineHeight: 1.5, flex: 1 }) }}>{d.diagnosis}</Typography>
          {d?.icd_10_code && d.icd_10_code !== "null" && <Typography sx={{ ...os({ fontSize: 10, color: C.accent, fontFamily: MONO, flexShrink: 0 }) }}>{d.icd_10_code}</Typography>}
          {d?.relationship && d.relationship !== "null" && <Pill label={d.relationship} color={C.ash} />}
        </Box>
      ))}
    </Box>
  );
};

const S6_History = ({ s }) => (
  <Box>
    {(s?.chief_complaints || []).filter(c => c && c !== "...").length > 0 && (
      <>
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>Chief Complaints</Typography>
        <Box sx={{ mb: 1.5 }}>
          {s.chief_complaints.filter(c => c && c !== "...").map((c, i) => (
            <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.4, alignItems: "flex-start" }}>
              <FiberManualRecordRounded sx={{ fontSize: 5, color: C.mist, mt: 0.85, flexShrink: 0 }} />
              <Typography sx={{ ...os({ fontSize: 12, color: C.ink, lineHeight: 1.55 }) }}>{c}</Typography>
            </Box>
          ))}
        </Box>
      </>
    )}
    <Field label="Duration" value={s?.duration_of_complaints} />
    {s?.history_of_present_illness && s.history_of_present_illness !== "null" && (
      <><Divider label="History of Present Illness" />
        <Box sx={{ p: 1.75, background: C.ghost, borderRadius: "2px", border: `1px solid ${C.fog}`, mb: 1.5 }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.7 }) }}>{s.history_of_present_illness}</Typography>
        </Box>
      </>
    )}
    <Divider label="Background" />
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
      <Box>
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>Past Medical History</Typography>
        <BulletList items={s?.past_medical_history} />
      </Box>
      <Box>
        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>Past Surgical History</Typography>
        <BulletList items={s?.past_surgical_history} />
      </Box>
    </Box>
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px", mt: 1 }}>
      <Field label="Family History" value={s?.family_history} />
      <Field label="Social History"  value={s?.social_history} />
    </Box>
  </Box>
);

const S7_Examination = ({ s }) => {
  const vitals = s?.vitals || {};
  const syst   = s?.systemic_examination || {};
  const hasVitals = Object.values(vitals).some(v => v && v !== "null");
  const hasSyst   = Object.values(syst).some(v => v && v !== "null" && v !== "Not documented");
  return (
    <Box>
      <Field label="General Appearance" value={s?.general_appearance} />
      {hasVitals && (
        <>
          <Divider label="Vitals on Admission" />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 1, mb: 1.5 }}>
            {[["BP","blood_pressure"],["HR","heart_rate"],["RR","respiratory_rate"],["Temp","temperature"],["SpO₂","spo2"],["Weight","weight"],["Height","height"],["BMI","bmi"]]
              .map(([l, k]) => vitals[k] && vitals[k] !== "null"
                ? <Box key={k} sx={{ p: 1.25, border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
                    <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.25 }) }}>{l}</Typography>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{vitals[k]}</Typography>
                  </Box>
                : null
              )}
          </Box>
        </>
      )}
      {hasSyst && (
        <>
          <Divider label="Systemic Examination" />
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
            {[["Cardiovascular","cardiovascular"],["Respiratory","respiratory"],["Abdomen","abdomen"],["CNS","central_nervous_system"],["Musculoskeletal","musculoskeletal"],["Other","other"]]
              .map(([l, k]) => syst[k] && syst[k] !== "null" && syst[k] !== "Not documented"
                ? <Field key={k} label={l} value={syst[k]} /> : null
              )}
          </Box>
        </>
      )}
    </Box>
  );
};

const S8_Investigations = ({ s }) => {
  const lab   = (s?.laboratory||[]).filter(Boolean);
  const img   = (s?.imaging||[]).filter(Boolean);
  const echo  = (s?.ecg_echo||[]).filter(Boolean);
  const histo = (s?.histopathology_microbiology||[]).filter(Boolean);
  const other = (s?.other||[]).filter(Boolean);
  if (!lab.length && !img.length && !echo.length && !histo.length && !other.length)
    return <Typography sx={{ ...os({ fontSize: 12, color: C.silver, fontStyle: "italic" }) }}>No investigations documented.</Typography>;
  return (
    <Box>
      {lab.length > 0 && (
        <><Divider label="Laboratory" />
          <ClinicalTable columns={[
            { key: "test",            label: "Test",      width: "2fr" },
            { key: "result",          label: "Result",    width: "1fr" },
            { key: "unit",            label: "Unit",      width: "80px" },
            { key: "reference_range", label: "Reference", width: "1fr" },
            { key: "date",            label: "Date",      width: "100px" },
            { key: "status",          label: "Status",    width: "100px", render: (v) => <LabStatus status={v} /> },
          ]} rows={lab} />
        </>
      )}
      {img.length > 0 && (
        <><Divider label="Imaging" />
          {img.map((item, i) => (
            <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "2px", p: 1.5, mb: 0.75, background: C.white }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.4 }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{item.modality} {item.region && `— ${item.region}`}</Typography>
                {item.date && item.date !== "null" && <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{item.date}</Typography>}
              </Box>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.55 }) }}>{item.findings}</Typography>
            </Box>
          ))}
        </>
      )}
      {echo.length > 0 && (
        <><Divider label="ECG / Echo" />
          {echo.map((item, i) => (
            <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "2px", p: 1.5, mb: 0.75 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.4 }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{item.type}</Typography>
                {item.date && item.date !== "null" && <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{item.date}</Typography>}
              </Box>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.55 }) }}>{item.findings}</Typography>
            </Box>
          ))}
        </>
      )}
      {histo.length > 0 && (
        <><Divider label="Histopathology / Microbiology" />
          {histo.map((item, i) => (
            <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "2px", p: 1.5, mb: 0.75 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.4 }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{item.test}{item.specimen ? ` · ${item.specimen}` : ""}</Typography>
                {item.date && item.date !== "null" && <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{item.date}</Typography>}
              </Box>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.55 }) }}>{item.findings}</Typography>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
};

const S9_Procedures = ({ s }) => {
  const valid = (s || []).filter(p => p?.procedure_name && p.procedure_name !== "null" && p.procedure_name !== "...");
  if (!valid.length) return <Typography sx={{ ...os({ fontSize: 12, color: C.silver, fontStyle: "italic" }) }}>No procedures documented.</Typography>;
  return (
    <Box>
      {valid.map((proc, i) => (
        <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderLeft: `3px solid ${C.charcoal}`, borderRadius: "2px", p: 2, mb: 1.25 }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink, mb: 1 }) }}>{proc.procedure_name}</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
            <Field label="Date"          value={proc.date} />
            <Field label="Surgeon"       value={proc.surgeon_operator} />
            <Field label="Anaesthesia"   value={proc.anaesthesia_type} />
            <Field label="Indication"    value={proc.indication} />
            <Field label="Findings"      value={proc.intraoperative_findings} />
            <Field label="Specimens"     value={proc.specimens_sent} />
            <Field label="Complications" value={proc.complications} alert={proc.complications && !["None","Nil","null","None.","No complications"].includes(proc.complications)} />
            <Field label="Outcome"       value={proc.outcome} />
          </Box>
        </Box>
      ))}
    </Box>
  );
};

const S10_HospitalCourse = ({ s }) => {
  const days   = (s?.clinical_days||[]).filter(d => d?.date || d?.key_events);
  const vitals = (s?.vitals_trend ||[]).filter(v => v?.date);
  const events = (s?.significant_events||[]).filter(e => e && e !== "...");
  const comps  = (s?.complications_during_admission||[]).filter(c => c && c !== "..." && c !== "None");
  return (
    <Box>
      {s?.narrative && s.narrative !== "null" && (
        <Box sx={{ p: 2, background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "2px", mb: 1.75 }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.8 }) }}>{s.narrative}</Typography>
        </Box>
      )}
      {days.length > 0 && (
        <><Divider label="Day-by-Day Summary" />
          {days.map((day, i) => (
            <Box key={i} sx={{ display: "flex", gap: 0, mb: 0.25 }}>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mr: 2, flexShrink: 0, width: 16 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: C.charcoal, mt: 1.3, flexShrink: 0, border: `2px solid ${C.white}`, boxShadow: `0 0 0 1px ${C.mist}` }} />
                {i < days.length - 1 && <Box sx={{ flex: 1, width: 1, background: C.fog, mt: 0.4 }} />}
              </Box>
              <Box sx={{ flex: 1, pb: 1.5 }}>
                <Box sx={{ display: "flex", gap: 1.5, alignItems: "baseline", mb: 0.35 }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>{day.date}</Typography>
                  {day.day_label && day.day_label !== "null" && <Typography sx={{ ...os({ fontSize: 9, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{day.day_label}</Typography>}
                </Box>
                <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6 }) }}>{day.key_events}</Typography>
              </Box>
            </Box>
          ))}
        </>
      )}
      {vitals.length > 0 && (
        <><Divider label="Vitals Trend" />
          <Box sx={{ overflowX: "auto" }}>
            <ClinicalTable columns={[
              { key: "date",             label: "Date",  width: "100px" },
              { key: "day_label",        label: "Day",   width: "70px" },
              { key: "blood_pressure",   label: "BP",    width: "90px" },
              { key: "heart_rate",       label: "HR",    width: "60px" },
              { key: "respiratory_rate", label: "RR",    width: "60px" },
              { key: "temperature",      label: "Temp",  width: "80px" },
              { key: "spo2",             label: "SpO₂",  width: "70px" },
              { key: "urine_output",     label: "UO",    width: "80px" },
            ]} rows={vitals} />
          </Box>
        </>
      )}
      {events.length > 0 && <><Divider label="Significant Events" /><BulletList items={events} /></>}
      {comps.length > 0 && (
        <><Divider label="Complications" />
          {comps.map((c, i) => (
            <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "flex-start" }}>
              <WarningAmberRounded sx={{ fontSize: 13, color: C.warn, mt: 0.2, flexShrink: 0 }} />
              <Typography sx={{ ...os({ fontSize: 12, color: C.warn, lineHeight: 1.55 }) }}>{c}</Typography>
            </Box>
          ))}
        </>
      )}
    </Box>
  );
};

const S11_Medications = ({ s }) => {
  const valid = (s || []).filter(m => m?.drug_name && m.drug_name !== "null" && m.drug_name !== "...");
  if (!valid.length)
    return <Box sx={{ p: 1.75, border: `1px solid ${C.warnBorder}`, borderRadius: "2px", background: C.warnBg }}><Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>No discharge medications documented.</Typography></Box>;
  return (
    <Box>
      {valid.map((med, i) => (
        <Box key={i} sx={{ display: "grid", gridTemplateColumns: "24px 1fr", gap: 1.5, borderBottom: i < valid.length - 1 ? `1px solid ${C.fog}` : "none", py: 1.25, alignItems: "baseline" }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.silver, textAlign: "right" }) }}>{i + 1}.</Typography>
          <Box>
            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", gap: 1, mb: 0.3 }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                {med.drug_name}
                {med.brand_name && med.brand_name !== "null" && med.brand_name !== "Not specified" && (
                  <Typography component="span" sx={{ ...os({ fontSize: 11, color: C.ash, ml: 0.75 }) }}>({med.brand_name})</Typography>
                )}
              </Typography>
              {[med.dose, med.route && `(${med.route})`, med.frequency, med.duration && `× ${med.duration}`].filter(Boolean).map((v, j) => (
                <Typography key={j} sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>{v}</Typography>
              ))}
            </Box>
            {med.special_instructions && med.special_instructions !== "null" && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, fontStyle: "italic" }) }}>Note: {med.special_instructions}</Typography>}
            {med.indication && med.indication !== "null" && <Typography sx={{ ...os({ fontSize: 10, color: C.silver }) }}>For: {med.indication}</Typography>}
          </Box>
        </Box>
      ))}
    </Box>
  );
};

const S12_DischargeVitals = ({ s }) => {
  const items = [["BP","blood_pressure"],["HR","heart_rate"],["RR","respiratory_rate"],["Temp","temperature"],["SpO₂","spo2"],["Weight","weight"]]
    .filter(([,k]) => s?.[k] && s[k] !== "null" && s[k] !== "Not documented");
  const condition = s?.general_condition;
  if (!items.length && !condition)
    return <Box sx={{ p: 1.75, border: `1px solid ${C.warnBorder}`, borderRadius: "2px", background: C.warnBg }}><Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>Discharge vitals not documented.</Typography></Box>;
  return (
    <Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(100px, 1fr))", gap: 1, mb: condition ? 1.5 : 0 }}>
        {items.map(([l, k]) => (
          <Box key={k} sx={{ p: 1.25, border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.ghost }}>
            <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.06em", mb: 0.25 }) }}>{l}</Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{s[k]}</Typography>
          </Box>
        ))}
      </Box>
      {condition && condition !== "null" && <Field label="General Condition" value={condition} />}
    </Box>
  );
};

const S13_Condition = ({ s }) => (
  <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
    <Field label="Overall Condition" value={s?.overall_condition} />
    <Field label="Functional Status" value={s?.functional_status} />
    <Field label="Mobility"          value={s?.mobility} />
    <Field label="Pain Level"        value={s?.pain_level} />
    <Field label="Wound Status"      value={s?.wound_status} />
    <Field label="Drain / Tube"      value={s?.drain_tube_status} />
  </Box>
);

const S14_Instructions = ({ s }) => (
  <Box>
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px", mb: 1 }}>
      <Field label="Activity"            value={s?.activity} />
      <Field label="Diet"                value={s?.diet} />
      <Field label="Wound Care"          value={s?.wound_care} />
      <Field label="Catheter/Drain Care" value={s?.catheter_drain_care} />
    </Box>
    {(s?.restrictions||[]).filter(Boolean).length > 0 && <><Divider label="Restrictions" /><BulletList items={s.restrictions} /></>}
    {(s?.warning_signs_to_watch||[]).filter(Boolean).length > 0 && (
      <><Divider label="Warning Signs — Contact Doctor If" />
        <Box sx={{ p: 1.5, border: `1px solid ${C.warnBorder}`, borderRadius: "2px", background: C.warnBg }}>
          <BulletList items={s.warning_signs_to_watch} color={C.warn} />
        </Box>
      </>
    )}
    {(s?.when_to_seek_emergency_care||[]).filter(Boolean).length > 0 && (
      <><Divider label="Go to Emergency Immediately If" />
        <Box sx={{ p: 1.5, border: `1px solid ${C.criticalBorder}`, borderRadius: "2px", background: C.criticalBg }}>
          <BulletList items={s.when_to_seek_emergency_care} color={C.critical} />
        </Box>
      </>
    )}
    {!s?.activity && !s?.diet && !s?.wound_care && !(s?.restrictions||[]).length && !(s?.warning_signs_to_watch||[]).length && !(s?.when_to_seek_emergency_care||[]).length && (
      <Typography sx={{ ...os({ fontSize: 12, color: C.silver, fontStyle: "italic" }) }}>Not documented.</Typography>
    )}
  </Box>
);

const S15_FollowUp = ({ s }) => {
  const valid = (s || []).filter(f => f?.appointment_with && f.appointment_with !== "null" && f.appointment_with !== "...");
  if (!valid.length)
    return <Box sx={{ p: 1.75, border: `1px solid ${C.warnBorder}`, borderRadius: "2px", background: C.warnBg }}><Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>No follow-up plan documented.</Typography></Box>;
  return (
    <Box>
      {valid.map((fu, i) => (
        <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "2px", p: 1.75, mb: 1, background: C.white, display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
          <Field label="With"    value={[fu.appointment_with, fu.specialty].filter(Boolean).join(" · ")} />
          <Field label="When"    value={fu.timeframe} />
          <Field label="Where"   value={fu.location} />
          <Field label="Purpose" value={fu.purpose} />
          {(fu.tests_before_visit||[]).filter(Boolean).length > 0 && (
            <Box sx={{ gridColumn: "1 / -1" }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>Tests Before Visit</Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap" }}>{fu.tests_before_visit.filter(Boolean).map((t, j) => <Pill key={j} label={t} />)}</Box>
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};

const S16_Allergies = ({ s }) => {
  const valid = (s || []).filter(a => a?.allergen && a.allergen !== "null" && a.allergen !== "...");
  if (!valid.length)
    return <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}><CheckCircleRounded sx={{ fontSize: 14, color: C.ok }} /><Typography sx={{ ...os({ fontSize: 12, color: C.ok }) }}>No known allergies documented.</Typography></Box>;
  return (
    <Box>
      {valid.map((a, i) => (
        <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, border: `1px solid ${C.criticalBorder}`, borderRadius: "2px", p: 1.25, mb: 0.75, background: C.criticalBg }}>
          <WarningAmberRounded sx={{ fontSize: 14, color: C.critical, flexShrink: 0, mt: 0.15 }} />
          <Box sx={{ flex: 1 }}>
            <Typography sx={{ ...os({ fontSize: 12, color: C.critical }) }}>{a.allergen}</Typography>
            {a.reaction_type && a.reaction_type !== "null" && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.2 }) }}>{a.reaction_type}</Typography>}
          </Box>
          {a.severity && a.severity !== "null" && <Pill label={a.severity} color={C.critical} bg={C.criticalBg} border={C.criticalBorder} />}
        </Box>
      ))}
    </Box>
  );
};

const S17_Attestation = ({ s }) => (
  <Box sx={{ border: `1px solid ${C.fog}`, borderTop: `2px solid ${C.ink}`, borderRadius: "2px", p: 2, background: C.ghost }}>
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 32px" }}>
      <Field label="Prepared By"          value={s?.prepared_by} />
      <Field label="Designation"          value={s?.designation} />
      <Field label="Date"                 value={s?.date} />
      <Field label="Reviewed By"          value={s?.reviewed_by} />
      <Field label="Reviewer Designation" value={s?.reviewer_designation} />
      <Field label="Digital Signature"    value={s?.digital_signature} />
    </Box>
    <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 48px", mt: 3 }}>
      {["Treating Physician Signature", "Reviewer / Department Head Signature"].map(label => (
        <Box key={label}>
          <Box sx={{ height: "1px", background: C.ink, mb: 0.5 }} />
          <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>{label}</Typography>
        </Box>
      ))}
    </Box>
  </Box>
);


// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════

export default function DischargeSummaryReportPanel({ doctorId, patientId, specialty }) {
  const [loading,       setLoading]       = useState(false);
  const [error,         setError]         = useState(null);
  const [data,          setData]          = useState(null);
  const [dictation,     setDictation]     = useState("");
  const [editModal,     setEditModal]     = useState({ open: false, sectionKey: null, title: "" });
  const [localOverrides,setLocalOverrides]= useState({});   // { sectionKey: editedData }
  const reportRef = useRef(null);

  // Merge DB data with local edits
  const hmsReport = data?.hms_report
    ? { ...data.hms_report, ...localOverrides }
    : null;

  const fetchReport = useCallback(async () => {
    if (!doctorId || !patientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/discharge-report`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          patient_id:     patientId,
          doctor_id:      doctorId,
          specialty:      specialty || "General Medicine",
          dictation_text: dictation.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const result = await res.json();
      setData(result);
      setLocalOverrides({});   // reset edits on new generation
    } catch (e) {
      setError(e.message || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  }, [doctorId, patientId, specialty, dictation]);

  const openEdit = (sectionKey, title) => setEditModal({ open: true, sectionKey, title });
  const closeEdit = () => setEditModal({ open: false, sectionKey: null, title: "" });
  const saveEdit = (newData) => {
    setLocalOverrides(prev => ({ ...prev, [editModal.sectionKey]: newData }));
  };

  const handlePDF = () => {
    if (!hmsReport) return;
    exportToPDF(hmsReport, data, patientId, doctorId);
  };

  // Sections config
  const SECTIONS = [
    { n: 1,  title: "Patient Demographics & Identifiers",  key: "section_1_patient_demographics",            render: (s) => <S1_Demographics s={s} /> },
    { n: 2,  title: "Admission Details",                   key: "section_2_admission_details",                render: (s) => <S2_Admission s={s} /> },
    { n: 3,  title: "Treating Team",                       key: "section_3_clinicians",                       render: (s) => <S3_Clinicians s={s} /> },
    { n: 4,  title: "Principal Diagnosis",                 key: "section_4_principal_diagnosis",              render: (s) => <S4_PrincipalDiagnosis s={s} /> },
    { n: 5,  title: "Secondary Diagnoses & Comorbidities", key: "section_5_secondary_diagnoses",              render: (s) => <S5_SecondaryDiagnoses s={s} /> },
    { n: 6,  title: "Presenting Complaints & History",     key: "section_6_presenting_complaints_and_history",render: (s) => <S6_History s={s} /> },
    { n: 7,  title: "Examination on Admission",            key: "section_7_examination_on_admission",         render: (s) => <S7_Examination s={s} /> },
    { n: 8,  title: "Investigations & Results",            key: "section_8_investigations",                   render: (s) => <S8_Investigations s={s} /> },
    { n: 9,  title: "Procedures & Interventions",          key: "section_9_procedures_interventions",         render: (s) => <S9_Procedures s={s} /> },
    { n: 10, title: "Hospital Course",                     key: "section_10_hospital_course",                 render: (s) => <S10_HospitalCourse s={s} /> },
    { n: 11, title: "Medications on Discharge",            key: "section_11_medications_on_discharge",        render: (s) => <S11_Medications s={s} /> },
    { n: 12, title: "Discharge Vitals",                    key: "section_12_discharge_vitals",                render: (s) => <S12_DischargeVitals s={s} /> },
    { n: 13, title: "Condition on Discharge",              key: "section_13_discharge_condition",             render: (s) => <S13_Condition s={s} /> },
    { n: 14, title: "Discharge Instructions",              key: "section_14_discharge_instructions",          render: (s) => <S14_Instructions s={s} /> },
    { n: 15, title: "Follow-Up Plan",                      key: "section_15_follow_up_plan",                  render: (s) => <S15_FollowUp s={s} /> },
    { n: 16, title: "Allergies & Adverse Reactions",       key: "section_16_allergies",                       render: (s) => <S16_Allergies s={s} /> },
    { n: 17, title: "Clinician Attestation",               key: "section_17_attestation",                     render: (s) => <S17_Attestation s={s} /> },
  ];

  return (
    <Box sx={{ fontFamily: FONT, fontWeight: FW }}>

      {/* ── DICTATION PANEL ─────────────────────────────────────────────────── */}
      <DictationPanel
        value={dictation}
        onChange={setDictation}
        onSubmit={fetchReport}
        loading={loading}
      />

      {/* ── TOP ACTION BAR ──────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5, flexWrap: "wrap", gap: 1 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <ArticleRounded sx={{ fontSize: 16, color: C.ash }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>
            Discharge Summary Report
            {Object.keys(localOverrides).length > 0 && (
              <Typography component="span" sx={{ ...os({ fontSize: 10, color: C.accent, ml: 1.5 }) }}>
                · {Object.keys(localOverrides).length} section{Object.keys(localOverrides).length > 1 ? "s" : ""} edited locally
              </Typography>
            )}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          {hmsReport && (
            <Tooltip title="Export hospital-grade PDF">
              <Box component="button" type="button" onClick={handlePDF}
                sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.75, py: 0.85, borderRadius: "2px", fontSize: 11, fontFamily: FONT, fontWeight: 300, letterSpacing: "0.05em", background: C.white, color: C.smoke, border: `1px solid ${C.fog}`, cursor: "pointer", transition: "all 0.15s", "&:hover": { background: C.ghost, borderColor: C.mist } }}>
                <PictureAsPdfRounded sx={{ fontSize: 13 }} /> Export PDF
              </Box>
            </Tooltip>
          )}
          <Tooltip title="Print report">
            <Box component="button" type="button" onClick={handlePDF}
              sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.75, py: 0.85, borderRadius: "2px", fontSize: 11, fontFamily: FONT, fontWeight: 300, letterSpacing: "0.05em", background: C.white, color: C.smoke, border: `1px solid ${C.fog}`, cursor: "pointer", "&:hover": { background: C.ghost } }}>
              <PrintRounded sx={{ fontSize: 13 }} /> Print
            </Box>
          </Tooltip>
          <Tooltip title={data ? "Regenerate report" : "Generate report"}>
            <Box component="button" type="button" onClick={fetchReport} disabled={loading}
              sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 2, py: 0.85, borderRadius: "2px", fontSize: 11, fontFamily: FONT, fontWeight: 300, letterSpacing: "0.05em", background: loading ? C.ghost : C.accent, color: loading ? C.ash : C.white, border: `1px solid ${loading ? C.fog : C.accent}`, cursor: loading ? "not-allowed" : "pointer", transition: "all 0.15s", "&:hover:not(:disabled)": { background: C.charcoal } }}>
              {loading ? <CircularProgress size={12} sx={{ color: C.ash }} /> : <RefreshRounded sx={{ fontSize: 13 }} />}
              {loading ? "Generating…" : data ? "Regenerate" : "Generate"}
            </Box>
          </Tooltip>
        </Box>
      </Box>

      {/* ── LOADING ─────────────────────────────────────────────────────────── */}
      {loading && (
        <Box>
          <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2.5, mb: 2, background: C.ghost }}>
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mb: 1 }) }}>Running 5-agent report pipeline…</Typography>
            {["DR0 · Data Fetcher", "DR1 · Dictation Parser", "DR2 · Timeline Extractor", "DR3 · Report Synthesizer", "DR4 · Quality Audit"].map((a, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                <CircularProgress size={8} sx={{ color: C.mist }} />
                <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>{a}</Typography>
              </Box>
            ))}
          </Box>
          {[100, 75, 90, 60, 85, 50].map((w, i) => (
            <Box key={i} sx={{ height: 12, width: `${w}%`, background: C.fog, borderRadius: "2px", mb: 1.25, animation: "pulse 1.4s ease-in-out infinite", "@keyframes pulse": { "0%,100%": { opacity: 0.4 }, "50%": { opacity: 0.9 } } }} />
          ))}
        </Box>
      )}

      {/* ── ERROR ───────────────────────────────────────────────────────────── */}
      {error && !loading && (
        <Box sx={{ p: 2.5, border: `1px solid ${C.criticalBorder}`, borderRadius: "4px", background: C.criticalBg, display: "flex", gap: 1.5 }}>
          <CancelRounded sx={{ fontSize: 18, color: C.critical, flexShrink: 0 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 13, color: C.critical, mb: 0.5 }) }}>Report generation failed</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.critical }) }}>{error}</Typography>
          </Box>
        </Box>
      )}

      {/* ── REPORT DOCUMENT ─────────────────────────────────────────────────── */}
      {hmsReport && !loading && (
        <Box ref={reportRef}>
          <DocumentHeader hms={hmsReport} meta={data} />

          <Box sx={{ mt: 2 }}>
            <QualityRibbon quality={data?.quality_report} />
          </Box>

          {(data?.data_sources_used?.admission_reason || data?.data_sources_used?.admission_date) && (
            <Box sx={{ display: "flex", gap: 3, mb: 2, flexWrap: "wrap" }}>
              {data.data_sources_used.admission_reason && (
                <Box>
                  <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.2 }) }}>Admission Reason</Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{data.data_sources_used.admission_reason}</Typography>
                </Box>
              )}
              {data.data_sources_used.admission_date && (
                <Box>
                  <Typography sx={{ ...os({ fontSize: 9, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.2 }) }}>Admission Date</Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{data.data_sources_used.admission_date}</Typography>
                </Box>
              )}
              {dictation?.trim() && (
                <Box sx={{ px: 1.25, py: 0.4, borderRadius: "3px", background: C.accentLight, border: `1px solid ${C.accentBorder}`, alignSelf: "center" }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.accent }) }}>
                    Dictation included · {dictation.trim().split(/\s+/).length} words
                  </Typography>
                </Box>
              )}
            </Box>
          )}

          {/* 17 HMS sections */}
          <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", overflow: "hidden", px: 2.5 }}>
            {SECTIONS.map(({ n, title, key, render }) => (
              <HMSSection
                key={n}
                number={n}
                title={title}
                onEdit={() => openEdit(key, title)}
              >
                {render(localOverrides[key] !== undefined ? localOverrides[key] : hmsReport[key])}
              </HMSSection>
            ))}
          </Box>

          {/* Footer meta */}
          <Box sx={{ display: "flex", justifyContent: "space-between", mt: 1.5, flexWrap: "wrap", gap: 0.5 }}>
            <Typography sx={{ ...os({ fontSize: 9, color: C.silver }) }}>
              Generated {data.generated_at ? new Date(data.generated_at).toLocaleString() : "—"} · {data.processing_time_ms}ms · v{data.version}
            </Typography>
            <Typography sx={{ ...os({ fontSize: 9, color: C.silver }) }}>
              Sources: {data.data_sources_used?.dictation_provided ? "Dictation + " : ""}Timeline ({data.data_sources_used?.timeline_blocks || 0} blocks)
            </Typography>
          </Box>
        </Box>
      )}

      {/* ── EDIT MODAL ──────────────────────────────────────────────────────── */}
      <EditModal
        open={editModal.open}
        onClose={closeEdit}
        sectionTitle={editModal.title}
        sectionData={
          editModal.sectionKey
            ? (localOverrides[editModal.sectionKey] !== undefined
                ? localOverrides[editModal.sectionKey]
                : hmsReport?.[editModal.sectionKey])
            : {}
        }
        onSave={saveEdit}
      />
    </Box>
  );
}