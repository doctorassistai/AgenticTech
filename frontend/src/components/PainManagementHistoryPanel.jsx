import React, { useState, useEffect, useCallback } from "react";
import { Box, Typography, IconButton, Chip, Tooltip } from "@mui/material";
import {
  RefreshRounded,
  ExpandMoreRounded,
  ExpandLessRounded,
  WarningAmberRounded,
  HealingRounded,
} from "@mui/icons-material";

import { SectionBox } from "./shared/FormComponents";
import { 
  C, FONT, FW_LIGHT, FW_NORMAL, FW_BOLD,
  thStyle, tdStyle, catStylePlain 
} from "./shared/designTokens";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW_LIGHT, ...extra });

const card = {
  background: C.white,
  border: `1px solid ${C.border}`,
  borderRadius: 0,
};

// ─── Label overrides for known fields ───────────────────────────────────────
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
  duration: "Duration",
  btpEpisodes: "BTP Episodes",
  nsaid: "NSAID",
  advice: "Advice",
  hyoscine: "Hyoscine",
  antiemetic: "Antiemetic",
  prevSite: "Previous Site",
  prevRadiatesTo: "Previous Radiates To",
  prevReferredTo: "Previous Referred To",
  prevTypeOfPain: "Previous Type of Pain",
  prevDuration: "Previous Duration",
  prevBtpEpisodes: "Previous BTP Episodes",
  prevHyoscine: "Previous Hyoscine",
  prevAntiemetic: "Previous Antiemetic",
  followUpAfter: "Follow-Up After",
  rescueDoses: "Rescue Doses",
  perfStatus: "Performance Status",
  drugAdherence: "Drug Adherence",
  overallRelief: "Overall Relief",
  changeTreatment: "Change Treatment",
  painScore: "Pain Score",
  nameOfBlock: "Name of Block",
  consentTaken: "Consent Taken",
  procedureDescription: "Procedure Description",
  perfScaleType: "Performance Scale Type",
};

const FORM_META = {
  new_form: { title: "New Assessment", chip: "New" },
  follow_up_form: { title: "Follow-Up Assessment", chip: "Follow Up" },
  nerve_block_form: { title: "Nerve Block", chip: "Nerve Block" },
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

// {flag, detail} shaped fields (hyoscine, antiemetic, prevHyoscine, prevAntiemetic)
const isFlagDetail = (v) =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  "flag" in v &&
  Object.keys(v).every((k) => ["flag", "detail"].includes(k));

// Drug map shaped fields (nsaid: { DrugName: { checked, dosage, route, frequency } })
const isDrugMap = (v) =>
  typeof v === "object" &&
  v !== null &&
  !Array.isArray(v) &&
  Object.values(v).length > 0 &&
  Object.values(v).every(
    (entry) => typeof entry === "object" && entry !== null && "checked" in entry
  );

const FieldValue = ({ fieldKey, value }) => {
  if (isEmptyValue(value)) return null;

  if (isFlagDetail(value)) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
        <Chip
          label={value.flag}
          size="small"
          sx={{
            fontSize: 10,
            height: 20,
            background: value.flag === "Yes" ? C.ink : C.ghost,
            color: value.flag === "Yes" ? C.white : C.ash,
            borderRadius: "2px",
          }}
        />
        {value.detail && (
          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{value.detail}</Typography>
        )}
      </Box>
    );
  }

  if (isDrugMap(value)) {
    const activeDrugs = Object.entries(value).filter(([, v]) => v?.checked);
    if (!activeDrugs.length) return null;
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        {activeDrugs.map(([drug, detail]) => (
          <Box
            key={drug}
            sx={{
              p: 1.25,
              border: `1px solid ${C.fog}`,
              borderRadius: "2px",
              background: C.ghost,
            }}
          >
            <Typography sx={{ ...os({ fontSize: 12, color: C.ink, mb: 0.5 }) }}>{drug}</Typography>
            <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap" }}>
              {["dosage", "route", "frequency"].map((k) =>
                detail[k] ? (
                  <Typography key={k} sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                    {labelFor(k)}: <span style={{ color: C.charcoal }}>{detail[k]}</span>
                  </Typography>
                ) : null
              )}
            </Box>
          </Box>
        ))}
      </Box>
    );
  }

  if (Array.isArray(value)) {
    return (
      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
        {value.map((item, i) => (
          <Chip
            key={i}
            label={typeof item === "object" ? JSON.stringify(item) : String(item)}
            size="small"
            sx={{ fontSize: 10, height: 20, background: C.ghost, color: C.smoke, borderRadius: "2px" }}
          />
        ))}
      </Box>
    );
  }

  if (typeof value === "object") {
    return (
      <Box sx={{ display: "grid", gap: 0.75 }}>
        {Object.entries(value).map(([k, v]) =>
          isEmptyValue(v) ? null : (
            <Typography key={k} sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
              {labelFor(k)}: <span style={{ color: C.ash }}>{String(v)}</span>
            </Typography>
          )
        )}
      </Box>
    );
  }

  return <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.5 }) }}>{String(value)}</Typography>;
};

const FormSection = ({ formKey, data }) => {
  const meta = FORM_META[formKey];
  const entries = Object.entries(data || {}).filter(([, v]) => !isEmptyValue(v));
  if (!entries.length) return null;

  return (
    <SectionBox title={meta?.title || formKey}>
      <Box
        component="table"
        sx={{
          width: "100%",
          borderCollapse: "collapse",
          background: C.white,
        }}
      >
        <Box component="tbody">
          {entries.map(([key, value], idx) => (
            <Box component="tr" key={key} sx={{ borderBottom: idx === entries.length - 1 ? "none" : `1px solid ${C.border}` }}>
              <Box component="td" sx={{ ...catStylePlain, width: "35%", color: C.textSecond, textTransform: "uppercase", fontSize: 10, letterSpacing: "0.06em" }}>
                {labelFor(key)}
              </Box>
              <Box component="td" sx={{ ...tdStyle, width: "65%", verticalAlign: "top" }}>
                <FieldValue fieldKey={key} value={value} />
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </SectionBox>
  );
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

const AssessmentCard = ({ record, expanded, onToggle }) => {
  const presentForms = ["new_form", "follow_up_form", "nerve_block_form"].filter(
    (k) => record[k] && Object.values(record[k]).some((v) => !isEmptyValue(v))
  );

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box
        onClick={onToggle}
        sx={{
          px: { xs: 2, sm: 2.5 },
          py: 1.75,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          cursor: "pointer",
          background: expanded ? C.bgSecondary : C.white,
          "&:hover": { background: C.bgSecondary },
          transition: "background 0.15s",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <HealingRounded sx={{ fontSize: 16, color: C.textMuted }} />
          <Typography sx={{ ...os({ fontSize: 13, color: C.textPrimary }) }}>{formatDate(record.created_at)}</Typography>
          <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
            {presentForms.map((f) => (
              <Chip
                key={f}
                label={FORM_META[f].chip}
                size="small"
                sx={{ fontSize: 10, height: 20, background: C.black, color: C.white, borderRadius: "2px" }}
              />
            ))}
          </Box>
        </Box>
        <IconButton size="small" sx={{ color: C.textMuted }}>
          {expanded ? <ExpandLessRounded sx={{ fontSize: 18 }} /> : <ExpandMoreRounded sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>

      {expanded && (
        <Box sx={{ p: { xs: 2, sm: 2.5 }, display: "flex", flexDirection: "column", gap: 2, borderTop: `1px solid ${C.border}` }}>
          {presentForms.length ? (
            presentForms.map((f) => <FormSection key={f} formKey={f} data={record[f]} />)
          ) : (
            <Typography sx={{ ...os({ fontSize: 12, color: C.textMuted }) }}>No details recorded for this assessment.</Typography>
          )}
        </Box>
      )}
    </Box>
  );
};

// ─── Main Panel ──────────────────────────────────────────────────────────────
const PainManagementHistoryPanel = ({ patientId, doctorId }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [expandedIds, setExpandedIds] = useState(() => new Set());

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
        const data = json.data || [];
        setRecords(data);
        // most recent assessment open by default
        if (data.length) setExpandedIds(new Set([data[0]._id]));
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

  useEffect(() => {
    fetchHistory();
    const handleRefresh = () => fetchHistory();
    window.addEventListener("refreshPainManagementHistory", handleRefresh);
    return () => window.removeEventListener("refreshPainManagementHistory", handleRefresh);
  }, [fetchHistory]);

  const toggle = (id) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return (
    <Box sx={{ ...card }}>
      <Box
        sx={{
          px: { xs: 2.5, sm: 3 },
          pt: { xs: 2.5, sm: 3 },
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
            New, follow-up, and nerve block assessments over time
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

      <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
        {loading && !records.length && (
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", py: 6 }}>
            <RefreshRounded sx={{ fontSize: 28, color: C.textMuted, animation: "spin 1s linear infinite" }} />
          </Box>
        )}

        {error && !loading && (
          <Box sx={{ p: 4, textAlign: "center", border: `1px solid ${C.border}`, borderRadius: 0, background: C.bgSecondary }}>
            <WarningAmberRounded sx={{ fontSize: 28, color: C.textMuted, mb: 1 }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.textSecond }) }}>{error}</Typography>
          </Box>
        )}

        {!loading && !error && records.length === 0 && (
          <Box sx={{ p: 5, textAlign: "center", border: `1px solid ${C.border}`, borderRadius: 0, background: C.bgSecondary }}>
            <HealingRounded sx={{ fontSize: 36, color: C.textMuted, mb: 1.5, opacity: 0.6 }} />
            <Typography sx={{ ...os({ fontSize: 13, color: C.textMuted }) }}>No pain management assessments recorded</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.textMuted, mt: 0.5 }) }}>
              Assessments saved from the Pain Management tab will appear here
            </Typography>
          </Box>
        )}

        {!loading && !error && records.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {records.map((record) => (
              <AssessmentCard
                key={record._id}
                record={record}
                expanded={expandedIds.has(record._id)}
                onToggle={() => toggle(record._id)}
              />
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

export default PainManagementHistoryPanel;