import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, IconButton, Tooltip } from "@mui/material";
import {
  RefreshRounded,
  WarningAmberRounded,
  HealingRounded,
  EmojiObjectsRounded,
  ExpandMoreRounded,
  ExpandLessRounded,
} from "@mui/icons-material";

import { SectionBox } from "./shared/FormComponents";
import { 
  C, FONT, FW_LIGHT, FW_NORMAL, FW_BOLD,
  sectionHeaderSx, thStyle, tdStyle 
} from "./shared/designTokens";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW_LIGHT, ...extra });

const card = {
  background: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 0,
};

// ─── Label overrides (same convention as PainManagementHistoryPanel) ───────
const LABELS = {
  caseNumber: "Case Number",
  phone: "Phone",
  physician: "Physician",
  service: "Service",
  chronicDisease: "Chronic Disease",
  currentMedicationsText: "Current Medications",
  site: "Site",
  radiatesTo: "Radiates To",
  referredTo: "Referred To",
  typeOfPain: "Type of Pain",
  distribution: "Distribution",
  course: "Course",
  pattern: "Pattern",
  duration: "Duration",
  btpEpisodes: "BTP Episodes",
  painScore: "Pain Score",
  relieving: "Relieving Factors",
  aggravating: "Aggravating Factors",
  pathophysiology: "Pathophysiology",
  painSyndrome: "Pain Syndrome",
  painDiagnosis: "Pain Diagnosis",
  diagnosisMadeBy: "Diagnosis Made By",
  affect: "Affects",
  nsaid: "NSAID",
  advice: "Advice",
  hyoscine: "Hyoscine",
  antiemetic: "Antiemetic",
  followUpAfter: "Follow-Up After",
  rescueDoses: "Rescue Doses",
  perfStatus: "Performance Status",
  perfScaleType: "Performance Scale Type",
  drugAdherence: "Drug Adherence",
  overallRelief: "Overall Relief",
  changeTreatment: "Change Treatment",
};

const FORM_META = {
  new_form: "New Assessment",
  follow_up_form: "Follow-Up Assessment",
};

const labelFor = (key) => {
  if (LABELS[key]) return LABELS[key];
  const spaced = key.replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const isEmptyValue = (v) => {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
};

const isFlagDetail = (v) =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  "flag" in v &&
  Object.keys(v).every((k) => ["flag", "detail"].includes(k));

const isDrugMap = (v) =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).length > 0 &&
  Object.values(v).every(
    (entry) => typeof entry === "object" && entry !== null && "checked" in entry
  );

// Flatten any field value into a single readable string for a table cell
const flattenValue = (value) => {
  if (isEmptyValue(value)) return "";

  if (isFlagDetail(value)) {
    return value.detail ? `${value.flag} — ${value.detail}` : value.flag;
  }

  if (isDrugMap(value)) {
    const activeDrugs = Object.entries(value).filter(([, v]) => v?.checked);
    if (!activeDrugs.length) return "";
    return activeDrugs
      .map(([drug, detail]) => {
        const parts = ["dosage", "route", "frequency"]
          .filter((k) => detail[k])
          .map((k) => `${detail[k]}`)
          .join(", ");
        return parts ? `${drug} (${parts})` : drug;
      })
      .join("; ");
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => (typeof item === "object" ? JSON.stringify(item) : String(item)))
      .join(", ");
  }

  if (typeof value === "object") {
    return Object.entries(value)
      .filter(([, v]) => !isEmptyValue(v))
      .map(([k, v]) => `${labelFor(k)}: ${v}`)
      .join("; ");
  }

  return String(value);
};

const formatDate = (dateString) => {
  if (!dateString) return "Unknown date";
  return new Date(dateString).toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

// ─── One table per (record, form-type) — only non-empty rows ──────────────
const AssessmentTable = ({ formKey, formData, dateLabel, expanded, onToggle }) => {
  const rows = Object.entries(formData || {})
    .map(([key, value]) => [key, flattenValue(value)])
    .filter(([, value]) => value !== "" && value !== null && value !== undefined);

  if (!rows.length) return null;

  return (
    <Box sx={{ border: `1px solid ${C.border}`, mb: 2.5 }}>
      <Box
        onClick={onToggle}
        sx={{
          ...sectionHeaderSx,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 1,
          cursor: "pointer",
          background: expanded ? C.bgSecondary : C.bgSecondary,
          borderBottom: expanded ? `1px solid ${C.border}` : "none",
          "&:hover": { background: C.bgSecondary },
          transition: "background 0.15s",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <HealingRounded sx={{ fontSize: 14, color: C.textMuted }} />
          <Typography sx={{ ...os({ fontSize: 11, color: C.textPrimary, textTransform: "uppercase", letterSpacing: "0.15em", fontWeight: FW_NORMAL }) }}>
            {FORM_META[formKey] || formKey}
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.textSecond }) }}>· {dateLabel}</Typography>
          <Typography sx={{ ...os({ fontSize: 10, color: C.textMuted }) }}>({rows.length} fields)</Typography>
        </Box>
        <IconButton size="small" sx={{ color: C.textMuted, p: 0.25 }}>
          {expanded ? <ExpandLessRounded sx={{ fontSize: 18 }} /> : <ExpandMoreRounded sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>

      {expanded && (
        <Box
          component="table"
          sx={{
            width: "100%",
            borderCollapse: "collapse",
          }}
        >
          <tbody>
            {rows.map(([key, value]) => (
              <tr key={key}>
                <td style={{ ...thStyle, width: "35%", background: C.white }}>
                  {labelFor(key)}
                </td>
                <td style={{ ...tdStyle, color: C.textPrimary, background: C.white }}>{value}</td>
              </tr>
            ))}
          </tbody>
        </Box>
      )}
    </Box>
  );
};

// ─── Main Component ─────────────────────────────────────────────────────────
const PainManagementHistoryTables = ({ patientId, doctorId, flat = false }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set()); // all collapsed by default

  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(null);

  const toggleTable = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const fetchHistory = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/pain-management/history/${patientId}/${doctorId}`
      );
      const json = await res.json();
      if (json.status === "success") {
        setRecords(json.data || []);
      } else {
        setError(json.message || "Failed to load pain management history");
        setRecords([]);
      }
    } catch (err) {
      console.error("Error fetching pain management history:", err);
      setError("Network error while fetching pain management history");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId]);

  const fetchSummary = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/pain-management/summarize/${patientId}/${doctorId}`
      );
      const json = await res.json();
      if (json.status === "success") {
        setSummary(json.finaloutput || "");
      } else {
        setSummaryError(json.message || "Failed to generate summary");
      }
    } catch (err) {
      console.error("Error generating pain management summary:", err);
      setSummaryError("Network error while generating summary");
    } finally {
      setSummaryLoading(false);
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    fetchHistory();
    const handleRefresh = () => {
      fetchHistory();
    };
    window.addEventListener("refreshPainManagementHistory", handleRefresh);
    return () => window.removeEventListener("refreshPainManagementHistory", handleRefresh);
  }, [fetchHistory]);

  // Auto-generate summary once we have history (and whenever it refreshes)
  useEffect(() => {
    if (!loading && records.length > 0) {
      fetchSummary();
    }
    if (!loading && records.length === 0) {
      setSummary("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, records.length, patientId, doctorId]);

  // Build one table per (record, form-type present), most recent first
  const tables = [];
  records.forEach((record) => {
    const dateLabel = formatDate(record.created_at);
    ["new_form", "follow_up_form"].forEach((formKey) => {
      if (record[formKey] && Object.values(record[formKey]).some((v) => !isEmptyValue(v))) {
        tables.push({ id: `${record._id}-${formKey}`, formKey, formData: record[formKey], dateLabel });
      }
    });
  });

  return (
    <Box sx={flat ? { borderTop: `1px solid ${C.border}`, pt: 3, mt: 3 } : { ...card }}>
      <Box
        sx={{
          px: flat ? 0 : { xs: 2.5, sm: 3 },
          pt: flat ? 0 : { xs: 2.5, sm: 3 },
          pb: 2,
          borderBottom: `1px solid ${C.border}`,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 2,
        }}
      >
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.textPrimary, letterSpacing: "0.02em" }) }}>
            Pain Management History
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.textMuted, mt: 0.4 }) }}>
            Previous New / Follow-Up assessments for this patient
          </Typography>
        </Box>
        <Tooltip title="Refresh">
          <IconButton
            size="small"
            onClick={fetchHistory}
            disabled={loading}
            sx={{ width: 28, height: 28, border: `1px solid ${C.border}`, borderRadius: 0, color: C.textMuted, "&:hover": { color: C.textPrimary, background: C.bgSecondary } }}
          >
            <RefreshRounded sx={{ fontSize: 14, animation: loading ? "spin 1s linear infinite" : "none" }} />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ p: flat ? 0 : { xs: 2, sm: 2.5 }, pt: flat ? 2.5 : { xs: 2, sm: 2.5 } }}>
        {loading && !records.length && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 6 }}>
            <RefreshRounded sx={{ fontSize: 28, color: C.textMuted, animation: "spin 1s linear infinite" }} />
          </Box>
        )}

        {error && !loading && (
          <Box sx={{ p: 4, textAlign: "center", border: `1px solid ${C.border}`, borderRadius: 0, background: C.bgSecondary }}>
            <WarningAmberRounded sx={{ fontSize: 28, color: C.textMuted, mb: 1 }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.textPrimary }) }}>{error}</Typography>
          </Box>
        )}

        {!loading && !error && tables.length === 0 && (
          <Box sx={{ p: 5, textAlign: "center", border: `1px solid ${C.border}`, borderRadius: 0, background: C.bgSecondary }}>
            <HealingRounded sx={{ fontSize: 36, color: C.textMuted, mb: 1.5, opacity: 0.6 }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.textSecond }) }}>No pain management assessments recorded</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.textMuted, mt: 0.5 }) }}>
              Assessments saved from the Pain Management panel will appear here
            </Typography>
          </Box>
        )}

        {!loading && !error && tables.length > 0 && (
          <>
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {tables.map((t) => (
                <AssessmentTable
                  key={t.id}
                  formKey={t.formKey}
                  formData={t.formData}
                  dateLabel={t.dateLabel}
                  expanded={expandedIds.has(t.id)}
                  onToggle={() => toggleTable(t.id)}
                />
              ))}
            </Box>

            {/* ── AI Summary ─────────────────────────────────────────────── */}
            <Box
              sx={{
                mt: 2.5,
                p: 2.5,
                border: `1px solid ${C.border}`,
                borderRadius: 0,
                background: C.bgSecondary,
                display: "flex",
                gap: 1.5,
                alignItems: "flex-start",
              }}
            >
              <EmojiObjectsRounded sx={{ fontSize: 20, color: C.textPrimary, mt: 0.2, flexShrink: 0 }} />
              <Box sx={{ flex: 1 }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
                  AI Summary
                </Typography>
                {summaryLoading && (
                  <Typography sx={{ ...os({ fontSize: 12.5, color: C.textMuted }) }}>Generating summary...</Typography>
                )}
                {summaryError && !summaryLoading && (
                  <Typography sx={{ ...os({ fontSize: 12.5, color: C.textMuted }) }}>{summaryError}</Typography>
                )}
                {!summaryLoading && !summaryError && summary && (
                  <Typography sx={{ ...os({ fontSize: 13, color: C.textPrimary, lineHeight: 1.6 }) }}>{summary}</Typography>
                )}
              </Box>
            </Box>
          </>
        )}
      </Box>
    </Box>
  );
};

export default PainManagementHistoryTables;