import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Typography, Select, MenuItem } from "@mui/material";
import { LocalHospital, RefreshRounded, WarningAmberRounded } from "@mui/icons-material";

/**
 * PalliativeAssessmentSummary
 * ------------------------------------------------------------------
 * Read-only view of the Palliative Medicine Assessment for doctors
 * who are NOT the Pain & Palliative specialist. Visible to everyone;
 * has no edit controls at all.
 *
 * Mount this UNCONDITIONALLY (mirrors how PainManagementHistoryTables
 * is always rendered). Place it directly under where
 * <PalliativeAssessmentForm /> is conditionally rendered, so:
 *   - Pain & Palliative specialist sees: editable form + this summary
 *   - Everyone else sees: just this summary
 *
 * Endpoint mirrors the pain-management history endpoint 1:1:
 *   GET {API}hms/users/data/context/palliative-assessment/history/{patientId}/{doctorId}
 * Expected shape: { status: "success", data: [ { _id, created_at,
 *   doctor_id, palliativeAssessment: {...same keys as the form...} }, ... ] }
 *
 * FIELD NAME NOTE: the save endpoint currently persists the assessment
 * under the snake_case key "palliative_assessment" (not the camelCase
 * "palliativeAssessment" this file originally expected), and existing
 * saved records already use that key — so this is patched on the read
 * side rather than changing the backend/re-migrating old records. Both
 * key spellings are checked below, snake_case first since that's what's
 * actually in the documents today.
 * ------------------------------------------------------------------
 */

const FONT = '"Open Sans", sans-serif';
const FW = 300;
const C = {
  black: "#0a0a0a", ink: "#1a1a1a", charcoal: "#2e2e2e", smoke: "#4a4a4a",
  ash: "#7a7a7a", silver: "#a8a8a8", mist: "#d4d4d4", fog: "#e8e8e8",
  ghost: "#f2f2f2", white: "#ffffff",
};
const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });
const sectionCard = {
  background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px",
  boxShadow: "0 1px 3px rgba(0,0,0,0.06)", overflow: "hidden",
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const HISTORY_URL = (patientId, doctorId) =>
  `${API_BASE_URL}hms/users/data/context/palliative-assessment/history/${patientId}/${doctorId}`;

const formatDateTime = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleString(undefined, {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
};

const SummaryRow = ({ label, value }) => {
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) return null;
  return (
    <Box sx={{ display: "flex", gap: 1.5, py: 0.6, borderBottom: `1px solid ${C.fog}` }}>
      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 170, flexShrink: 0 }) }}>{label}</Typography>
      <Typography sx={{ ...os({ fontSize: 12.5, color: C.ink }) }}>
        {Array.isArray(value) ? value.join(", ") : String(value)}
      </Typography>
    </Box>
  );
};

const ScorePill = ({ label, value }) => {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  const severe = !Number.isNaN(n) && n >= 7;
  const moderate = !Number.isNaN(n) && n >= 4 && n < 7;
  return (
    <Box sx={{
      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1,
      px: 1.25, py: 0.75, border: `1px solid ${C.fog}`, borderRadius: "2px",
      background: severe ? "#fef2f2" : moderate ? "#fffbeb" : C.ghost,
    }}>
      <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{label}</Typography>
      <Typography sx={{ ...os({ fontSize: 13, color: severe ? "#991b1b" : C.ink, fontWeight: 400 }) }}>{value}/10</Typography>
    </Box>
  );
};

const SectionBlock = ({ title, children, hidden }) => {
  if (hidden) return null;
  return (
    <Box sx={{ mb: 2.5 }}>
      <Typography sx={{ ...os({ fontSize: 11, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1, pb: 0.75, borderBottom: `1px solid ${C.fog}` }) }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
};

const ESAS_SUMMARY_ITEMS = [
  ["esas_pain", "Pain"], ["esas_tiredness", "Tiredness"], ["esas_drowsiness", "Drowsiness"],
  ["esas_nausea", "Nausea"], ["esas_appetite", "Lack of Appetite"], ["esas_breath", "Shortness of Breath"],
  ["esas_depression", "Depression"], ["esas_anxiety", "Anxiety"], ["esas_wellbeing", "Wellbeing (best=0)"],
  ["esas_constipation", "Constipation"], ["esas_sleep", "Sleep quality (adequate=0)"], ["esas_other", "Other problem"],
];

export default function PalliativeAssessmentSummary({ patientId, doctorId }) {
  const [records, setRecords] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(HISTORY_URL(patientId, doctorId));
      const json = await res.json();
      if (json.status === "success") {
        const list = Array.isArray(json.data) ? json.data : [];
        const sorted = [...list].sort((a, b) => new Date(b.created_at || b.saved_at) - new Date(a.created_at || a.saved_at));
        setRecords(sorted);
        if (sorted.length) setSelectedId(sorted[0]._id);
      } else {
        setError(json.message || "Could not load palliative assessment history");
      }
    } catch (err) {
      console.error("Palliative assessment summary load failed:", err);
      setError("Could not load palliative assessment history");
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    load();
    const handler = () => load();
    window.addEventListener("refreshPalliativeAssessmentHistory", handler);
    return () => window.removeEventListener("refreshPalliativeAssessmentHistory", handler);
  }, [load]);

  const selected = useMemo(() => records.find((r) => r._id === selectedId), [records, selectedId]);
  // Read side handles both key spellings — the save endpoint actually writes
  // "palliative_assessment" (snake_case), which is what's in every record
  // saved so far. "palliativeAssessment" / finaloutput.palliativeAssessment
  // are kept as fallbacks in case that's ever changed going forward.
  const d =
    selected?.palliative_assessment ||
    selected?.palliativeAssessment ||
    selected?.finaloutput?.palliativeAssessment ||
    selected?.finaloutput?.palliative_assessment ||
    {};

  return (
    <Box sx={{ ...sectionCard }}>
      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <Box sx={{
        px: { xs: 2.5, sm: 3 }, pt: { xs: 2.5, sm: 3 }, pb: 1.5,
        display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2, flexWrap: "wrap",
        borderBottom: `1px solid ${C.fog}`,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <LocalHospital sx={{ fontSize: 18, color: C.smoke }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>
              Palliative Medicine Assessment — Summary
            </Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
              Read-only — editable only by the Pain &amp; Palliative Care specialist
            </Typography>
          </Box>
        </Box>

        {records.length > 0 && (
          <Select
            size="small" value={selectedId} onChange={(e) => setSelectedId(e.target.value)}
            sx={{
              minWidth: 220, fontFamily: FONT, fontSize: 12, fontWeight: 300, borderRadius: "2px",
              background: C.white,
              "& .MuiOutlinedInput-notchedOutline": { borderColor: C.mist, borderRadius: "2px" },
              "& .MuiSelect-select": { py: 0.9, px: 1.25 },
            }}
          >
            {records.map((r) => (
              <MenuItem key={r._id} value={r._id} sx={{ fontFamily: FONT, fontSize: 12, fontWeight: 300 }}>
                {formatDateTime(r.created_at || r.saved_at)}
              </MenuItem>
            ))}
          </Select>
        )}
      </Box>

      {/* Body */}
      {loading ? (
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 1, py: 6 }}>
          <RefreshRounded sx={{ fontSize: 20, color: C.ash, animation: "spin 1s linear infinite" }} />
          <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash }) }}>Loading...</Typography>
        </Box>
      ) : error ? (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <WarningAmberRounded sx={{ fontSize: 28, color: C.ash, mb: 1 }} />
          <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash }) }}>{error}</Typography>
        </Box>
      ) : records.length === 0 ? (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 12.5, color: C.ash }) }}>
            No palliative medicine assessment recorded yet for this patient.
          </Typography>
        </Box>
      ) : (
        <Box sx={{ p: { xs: 2, sm: 3 } }}>

          <SectionBlock title="Referral & Diagnosis">
            <SummaryRow label="Visit Type" value={d.patientType} />
            <SummaryRow label="Cancer Diagnosis" value={d.cancerDiagnosis} />
            <SummaryRow label="Reason for Referral" value={d.reasonForReferral} />
            <SummaryRow label="Co-morbidities" value={d.comorbidities} />
          </SectionBlock>

          <SectionBlock title="Performance Scale">
            <SummaryRow label="ECOG" value={d.ecog} />
            <SummaryRow label="PPS" value={d.pps} />
          </SectionBlock>

          <SectionBlock title="ESAS-r Symptom Scores">
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr 1fr 1fr" }, gap: 1 }}>
              {ESAS_SUMMARY_ITEMS.map(([key, label]) => (
                <ScorePill key={key} label={label} value={d[key]} />
              ))}
            </Box>
          </SectionBlock>

          <SectionBlock title="Psychosocial & Spiritual" hidden={!d.patientKnowsDiagnosis && !d.socialSupport && !d.spiritualImportant}>
            <SummaryRow label="Patient Knows Diagnosis" value={d.patientKnowsDiagnosis} />
            <SummaryRow label="Patient Knows Prognosis" value={d.patientKnowsPrognosis} />
            <SummaryRow label="Social Support" value={d.socialSupport} />
            <SummaryRow label="Spirituality Important" value={d.spiritualImportant?.flag} />
          </SectionBlock>

          <SectionBlock title="CAM (Delirium Screening)" hidden={!d.camAcuteOnset}>
            <SummaryRow label="Acute Onset / Fluctuating" value={d.camAcuteOnset} />
            <SummaryRow label="Inattention" value={d.camInattention} />
            <SummaryRow label="Disorganized Thinking" value={d.camDisorganized} />
            <SummaryRow label="Consciousness" value={d.camConsciousness} />
          </SectionBlock>

          <SectionBlock title="Comprehensive Care Plan">
            <SummaryRow label="Palliative Medicine Diagnosis" value={d.palliativeDiagnosis} />
            <SummaryRow label="Primary Decision Maker" value={d.primaryDecisionMaker} />
            <SummaryRow label="Procedures" value={d.procedures} />
            <SummaryRow label="Ongoing Medications" value={d.ongoingMedications} />
            <SummaryRow label="Medications Prescribed" value={d.medicationsPrescribed} />
            <SummaryRow label="Interdisciplinary Referrals" value={d.interdisciplinaryReferrals} />
            <SummaryRow label="Follow-up Date" value={d.followUpDate} />
          </SectionBlock>

        </Box>
      )}
    </Box>
  );
}