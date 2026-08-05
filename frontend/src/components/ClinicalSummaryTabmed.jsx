// ClinicalSummaryTab.jsx — NCG-KCDO Surgical Oncology Module
// New menu inserted before OT Booking. Contains two sub-tabs:
//   1) Clinical Summary   -> GET  hms/users/data/context/patient-summary/{patientId}
//   2) Synoptic Report    -> GET  hms/users/data/context/synoptic-report/{patientId}
//                             POST hms/users/ai-legacy/synoptic-report (Generate button)
//
// Pattern mirrors OTRecord.jsx — Doctorassist.AI brand tokens

import React, { useState, useEffect, useCallback } from "react";
import {
  Box, Typography, TextField, Button, CircularProgress,
} from "@mui/material";
import {
  RefreshRounded, AutoAwesomeRounded, LocalHospitalRounded,
} from "@mui/icons-material";

// ─── Brand Tokens (mirrors OTRecord.jsx) ──────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_NORMAL = 400;

const C = {
  black:        "#000000",
  white:        "#ffffff",
  bgPrimary:    "#ffffff",
  bgSecondary:  "#fafafa",
  bgTertiary:   "#f5f5f5",
  textPrimary:  "#000000",
  textSecond:   "#444444",
  textMuted:    "#888888",
  border:       "#e0e0e0",
  borderStrong: "#000000",
  success:      "#2e7d32",
  warning:      "#795548",
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
const PATIENT_SUMMARY_GET_URL   = (patientId) => `${API_BASE_URL}hms/users/data/context/patient-summary/${patientId}`;

const SYNOPTIC_GET_URL  = (patientId) => `${API_BASE_URL}hms/users/data/context/synoptic-report/${patientId}`;
const SYNOPTIC_POST_URL = `${API_BASE_URL}hms/users/ai-legacy/synoptic-report`;

// ─── Shared Styles ────────────────────────────────────────────────────────────
const inputSx = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 0, fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT,
    "& fieldset": { borderColor: C.border },
    "&:hover fieldset": { borderColor: C.black },
    "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: 1 },
  },
  "& .MuiInputLabel-root": { fontFamily: FONT, fontSize: 13 },
};
const sectionHeaderSx = {
  px: 2.5, py: 1.25, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`,
  fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em",
  color: C.textPrimary, fontFamily: FONT, fontWeight: FW_NORMAL,
};
const saveBtnSx = {
  px: 3, py: 0.9, background: C.black, color: C.white,
  fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 12,
  textTransform: "none", borderRadius: 0,
  "&:hover": { background: "#1a1a1a" },
  "&.Mui-disabled": { background: "#cccccc", color: "#ffffff" },
};
const outlineBtnSx = {
  px: 3, py: 0.9, background: C.white, color: C.black,
  border: `1px solid ${C.black}`, fontFamily: FONT, fontWeight: FW_NORMAL,
  fontSize: 12, textTransform: "none", borderRadius: 0,
  "&:hover": { background: C.bgTertiary },
};

const SectionBox = ({ title, children, right }) => (
  <Box sx={{ border: `1px solid ${C.border}`, mb: 2.5 }}>
    <Box sx={{ ...sectionHeaderSx, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
      <span>{title}</span>
      {right}
    </Box>
    <Box sx={{ p: 2.5 }}>{children}</Box>
  </Box>
);

const FieldLabel = ({ children }) => (
  <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 0.75 }}>
    {children}
  </Typography>
);

const StatusChip = ({ label, tone = "neutral" }) => {
  const map = {
    positive: { bg: "#f0f7f0", color: C.success, border: C.success },
    negative: { bg: "#fafafa", color: C.textMuted, border: C.border },
    warning:  { bg: "#fff8e1", color: C.warning, border: C.warning },
    neutral:  { bg: "#f5f5f5", color: C.textSecond, border: C.border },
  };
  const s = map[tone] || map.neutral;
  return (
    <Box sx={{ display: "inline-block", px: 1, py: 0.3, border: `1px solid ${s.border}`, background: s.bg, color: s.color, fontSize: 10, fontFamily: FONT, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      {label}
    </Box>
  );
};

const EmptyState = ({ message }) => (
  <Box sx={{ py: 5, textAlign: "center" }}>
    <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textMuted, fontStyle: "italic" }}>
      {message}
    </Typography>
  </Box>
);

const LoadingState = ({ message = "Loading…" }) => (
  <Box sx={{ py: 5, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
    <CircularProgress size={22} sx={{ color: C.black }} />
    <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted }}>{message}</Typography>
  </Box>
);

// Converts **bold** markdown segments into <strong> without pulling in a markdown lib
const renderMarkdownBold = (text) => {
  if (!text) return null;
  const parts = String(text).split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    return <React.Fragment key={i}>{part}</React.Fragment>;
  });
};

const SubTabBar = ({ tabs, active, onSelect }) => (
  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 2.5, borderBottom: `1px solid ${C.border}`, pb: 1.5 }}>
    {tabs.map((t, i) => (
      <Box key={t} onClick={() => onSelect(i)}
        sx={{
          px: 1.75, py: 0.6, border: `1px solid ${active === i ? C.black : C.border}`,
          background: active === i ? C.black : C.white,
          color: active === i ? C.white : C.textSecond,
          fontSize: 11, fontFamily: FONT, letterSpacing: "0.08em",
          cursor: "pointer", textTransform: "uppercase", transition: "all 0.15s",
          "&:hover": { borderColor: C.black },
        }}>
        {t}
      </Box>
    ))}
  </Box>
);

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TAB 1 — CLINICAL SUMMARY
// ─────────────────────────────────────────────────────────────────────────────
const ClinicalSummaryPanel = ({ patientId }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paragraphs, setParagraphs] = useState([]);

  const fetchSummary = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(PATIENT_SUMMARY_GET_URL(patientId));
      const data = await res.json();
      console.log("FULL API RESPONSE:", data);
      if (!res.ok) throw new Error(data?.detail || "Failed to fetch clinical summary");
      const p = data?.data?.summary?.paragraphs || [];
      setParagraphs(Array.isArray(p) ? p : []);
    } catch (err) {
      console.error("[ClinicalSummaryPanel] fetch error:", err);
      setError(err.message || "Unable to load clinical summary");
      setParagraphs([]);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { fetchSummary(); }, [fetchSummary]);

  return (
    <SectionBox
      title="Clinical Summary"
      right={
        <Button size="small" onClick={fetchSummary} disabled={loading}
          sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1.25, fontSize: 10 }}>
          <RefreshRounded sx={{ mr: 0.5, fontSize: 13 }} /> Refresh
        </Button>
      }
    >
      {!patientId && <EmptyState message="Enter a Patient ID to load the clinical summary." />}
      {patientId && loading && <LoadingState message="Fetching clinical summary…" />}
      {patientId && !loading && error && (
        <Typography sx={{ fontFamily: FONT, fontSize: 12, color: "#b00020" }}>{error}</Typography>
      )}
      {patientId && !loading && !error && paragraphs.length === 0 && (
        <EmptyState message="No clinical summary available for this patient yet." />
      )}
      {patientId && !loading && !error && paragraphs.length > 0 && (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {paragraphs.map((para, i) => (
            <Typography key={i} sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT, lineHeight: 1.7, color: C.textPrimary }}>
              {renderMarkdownBold(typeof para === "string" ? para : para?.text || "")}
            </Typography>
          ))}
        </Box>
      )}
    </SectionBox>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// SUB-TAB 2 — SYNOPTIC REPORT
// ─────────────────────────────────────────────────────────────────────────────
//
// Behavior: clicking "Generate Synoptic Report" calls the POST generate
// endpoint, and ONLY on success does it call the GET retrieve endpoint to
// populate the panel.
//
const DomainCard = ({ domain }) => {
  const elementCount = (domain.documents || []).reduce(
    (sum, d) => sum + (d.elements?.length || 0), 0
  );

  return (
    <Box sx={{ border: `1px solid ${C.border}`, mb: 2 }}>
      <Box sx={{
        px: 2, py: 1, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`,
        display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1,
      }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_NORMAL, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textPrimary }}>
          {domain.domain}
        </Typography>
        <StatusChip label={`${elementCount} element${elementCount === 1 ? "" : "s"}`} tone="neutral" />
      </Box>

      <Box sx={{ p: 2 }}>
        {domain.domain_rollup && (
          <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: FW_LIGHT, lineHeight: 1.6, color: C.textSecond, mb: 1.5, fontStyle: "italic" }}>
            {domain.domain_rollup}
          </Typography>
        )}

        {(domain.documents || []).map((doc, i) => (
          <Box key={`${doc.document}-${i}`} sx={{ mb: i < domain.documents.length - 1 ? 2 : 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 11, fontWeight: FW_NORMAL, color: C.textPrimary }}>
                {doc.document}
              </Typography>
              {doc.date && (
                <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted }}>
                  {doc.date}
                </Typography>
              )}
            </Box>

            {(doc.elements || []).length > 0 ? (
              <Box component="table" sx={{
                width: "100%", borderCollapse: "collapse", fontFamily: FONT,
              }}>
                <Box component="thead">
                  <Box component="tr">
                    {["Element ID", "Data Element", "Value"].map((h) => (
                      <Box component="th" key={h} sx={{
                        textAlign: "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
                        color: C.textMuted, borderBottom: `1px solid ${C.border}`, py: 0.5, pr: 1.5,
                      }}>
                        {h}
                      </Box>
                    ))}
                  </Box>
                </Box>
                <Box component="tbody">
                  {doc.elements.map((el, j) => (
                    <Box component="tr" key={el.element_id || j}>
                      <Box component="td" sx={{ fontSize: 11, color: C.textMuted, py: 0.5, pr: 1.5, borderBottom: `1px solid ${C.bgTertiary}` }}>
                        {el.element_id}
                      </Box>
                      <Box component="td" sx={{ fontSize: 12, color: C.textSecond, py: 0.5, pr: 1.5, borderBottom: `1px solid ${C.bgTertiary}` }}>
                        {el.data_element}
                      </Box>
                      <Box component="td" sx={{ fontSize: 12, color: C.textPrimary, py: 0.5, pr: 1.5, borderBottom: `1px solid ${C.bgTertiary}` }}>
                        {el.value}{el.unit ? ` ${el.unit}` : ""}
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            ) : (
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
                No discrete synoptic data elements documented for this record.
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

const SynopticSummaryPanel = ({ patientId, doctorId }) => {
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [genError, setGenError] = useState("");
  const [report, setReport] = useState(null);
  const [generatedAt, setGeneratedAt] = useState(null);

  const fetchSynopticReport = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    setError("");
    try {
      const res = await fetch(SYNOPTIC_GET_URL(patientId));
      const data = await res.json();
      if (res.status === 404) {
        setReport(null);
        setGeneratedAt(null);
        return;
      }
      if (!res.ok || data?.status !== "success") {
        throw new Error(data?.detail || "Failed to fetch synoptic report");
      }
      setReport(data?.data?.synoptic_report || null);
      setGeneratedAt(data?.data?.generated_at || null);
    } catch (err) {
      console.error("[SynopticSummaryPanel] fetch error:", err);
      setError(err.message || "Unable to load synoptic report");
      setReport(null);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  useEffect(() => { fetchSynopticReport(); }, [fetchSynopticReport]);

  const handleGenerate = async () => {
    if (!patientId || !doctorId) return;
    setGenerating(true);
    setGenError("");
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId,
        specialty: "Surgical Oncology",
        include_intermediates: false,
      };
      const res = await fetch(SYNOPTIC_POST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Failed to generate synoptic report");

      // Only populate from the retrieve endpoint after a successful generate
      await fetchSynopticReport();
    } catch (err) {
      console.error("[SynopticSummaryPanel] generate error:", err);
      setGenError(err.message || "Failed to generate synoptic report");
    } finally {
      setGenerating(false);
    }
  };

  const domains = report?.domains || [];

  return (
    <Box>
      <SectionBox title="Generate Synoptic Report">
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Button
              sx={saveBtnSx}
              onClick={handleGenerate}
              disabled={generating || !patientId || !doctorId}
            >
              {generating ? (
                <CircularProgress size={14} sx={{ color: C.white, mr: 1 }} />
              ) : (
                <AutoAwesomeRounded sx={{ mr: 0.5, fontSize: 14 }} />
              )}
              {generating ? "Generating…" : "Generate Synoptic Report"}
            </Button>
            {(!patientId || !doctorId) && (
              <Typography sx={{ fontFamily: FONT, fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
                Requires both Patient ID and Doctor ID
              </Typography>
            )}
          </Box>
          {genError && (
            <Typography sx={{ fontFamily: FONT, fontSize: 12, color: "#b00020" }}>{genError}</Typography>
          )}
        </Box>
      </SectionBox>

      <SectionBox
        title="Synoptic Report"
        right={
          <Button size="small" onClick={fetchSynopticReport} disabled={loading}
            sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1.25, fontSize: 10 }}>
            <RefreshRounded sx={{ mr: 0.5, fontSize: 13 }} /> Refresh
          </Button>
        }
      >
        {!patientId && <EmptyState message="Enter a Patient ID to load the synoptic report." />}
        {patientId && loading && <LoadingState message="Fetching synoptic report…" />}
        {patientId && !loading && error && (
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: "#b00020" }}>{error}</Typography>
        )}
        {patientId && !loading && !error && domains.length === 0 && (
          <EmptyState message="No synoptic report generated yet. Use Generate Synoptic Report above." />
        )}
        {patientId && !loading && !error && domains.length > 0 && (
          <Box>
            {domains.map((domain, i) => (
              <DomainCard key={`${domain.domain}-${i}`} domain={domain} />
            ))}

            {generatedAt && (
              <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.textMuted, fontStyle: "italic", mt: 1 }}>
                Last generated: {new Date(generatedAt).toLocaleString()}
              </Typography>
            )}
          </Box>
        )}
      </SectionBox>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — ClinicalSummaryTab (menu with 2 sub-tabs)
// ─────────────────────────────────────────────────────────────────────────────
const ClinicalSummaryTab = ({ patientId, doctorId }) => {
  const [sub, setSub] = useState(0);
  const SUBS = ["Clinical Summary", "Synoptic Report"];

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2 }}>
        <LocalHospitalRounded sx={{ fontSize: 18, color: C.textMuted }} />
        <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.15em", color: C.textMuted, fontFamily: FONT }}>
          AI Clinical Intelligence
        </Typography>
      </Box>

      <SubTabBar tabs={SUBS} active={sub} onSelect={setSub} />

      {sub === 0 && <ClinicalSummaryPanel patientId={patientId} />}
      {sub === 1 && <SynopticSummaryPanel patientId={patientId} doctorId={doctorId} />}
    </Box>
  );
};

export default ClinicalSummaryTab;