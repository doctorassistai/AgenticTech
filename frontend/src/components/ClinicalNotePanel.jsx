import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  MenuItem,
  Select,
  FormControl,
  Tab,
  Tabs,
} from "@mui/material";
import { motion, AnimatePresence } from "framer-motion";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import RefreshIcon from "@mui/icons-material/Refresh";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;

const C = {
  black:    "#000000",
  charcoal: "#444444",
  ash:      "#888888",
  mist:     "#e0e0e0",
  ghost:    "#fafafa",
  offwhite: "#f5f5f5",
  white:    "#ffffff",
};

const os = (extra = {}) => ({
  fontFamily: FONT,
  fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased",
  ...extra,
});

// ─── Badge ────────────────────────────────────────────────────────────────────
const Badge = ({ label }) => (
  <Box sx={{
    display: "inline-flex", alignItems: "center", gap: 0.75,
    px: 1.5, py: 0.5,
    background: C.ghost,
    border: `1px solid ${C.mist}`,
  }}>
    <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: C.ash, flexShrink: 0 }} />
    <Typography sx={{ ...os({ fontSize: 10, color: C.charcoal, letterSpacing: "0.08em", textTransform: "uppercase" }) }}>
      {label}
    </Typography>
  </Box>
);

// ─── Section ──────────────────────────────────────────────────────────────────
const Section = ({ title, count, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ border: `1px solid ${C.mist}`, mb: 1.5, transition: "border-color 0.2s", "&:hover": { borderColor: C.black } }}>
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          px: 2, py: 1.5,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer",
          background: open ? C.ghost : C.white,
          borderBottom: open ? `1px solid ${C.mist}` : "none",
          transition: "background 0.15s",
          "&:hover": { background: C.ghost },
          userSelect: "none",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, letterSpacing: "0.05em", textTransform: "uppercase" }) }}>
            {title}
          </Typography>
          {count > 0 && (
            <Box sx={{ background: C.offwhite, border: `1px solid ${C.mist}`, px: 1, py: 0.1 }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash }) }}>{count}</Typography>
            </Box>
          )}
        </Box>
        {open
          ? <ExpandLessIcon sx={{ fontSize: 14, color: C.ash }} />
          : <ExpandMoreIcon sx={{ fontSize: 14, color: C.ash }} />
        }
      </Box>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeInOut" }}
            style={{ overflow: "hidden" }}
          >
            <Box sx={{ px: 2, py: 2 }}>{children}</Box>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
  );
};

// ─── Info row ─────────────────────────────────────────────────────────────────
const InfoRow = ({ label, value }) => (
  <Box sx={{ display: "flex", gap: 1, mb: 0.75, py: 0.4, borderBottom: `1px solid ${C.mist}` }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 100, letterSpacing: "0.03em" }) }}>
      {label}
    </Typography>
    <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontWeight: FW_REGULAR }) }}>
      {value || "—"}
    </Typography>
  </Box>
);

// ─── Strip ────────────────────────────────────────────────────────────────────
const Strip = ({ text }) => (
  <Box sx={{
    px: 1.5, py: 1, mt: 1,
    background: C.ghost,
    border: `1px solid ${C.mist}`,
    borderLeft: `2px solid ${C.charcoal}`,
  }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6 }) }}>
      {text}
    </Typography>
  </Box>
);

// ─── Safe fetch ───────────────────────────────────────────────────────────────
const safeFetch = async (url) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}`);
    }
    const contentType = response.headers.get("content-type");
    if (!contentType || !contentType.includes("application/json")) return null;
    const text = await response.text();
    try { return JSON.parse(text); } catch { return null; }
  } catch (error) {
    if (error.name === "AbortError") console.warn("Request timeout:", url);
    return null;
  }
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClinicalNotesPanel({ patientId, doctorId, metadata }) {
  const [allNotes, setAllNotes]                         = useState([]);
  const [selectedDate, setSelectedDate]                 = useState("");
  const [notesForSelectedDate, setNotesForSelectedDate] = useState([]);
  const [selectedNoteIndex, setSelectedNoteIndex]       = useState(0);
  const [loading, setLoading]                           = useState(false);
  const [error, setError]                               = useState(null);

  const fetchClinicalNotes = async () => {
    if (!patientId || !doctorId) { setError("Patient ID and Doctor ID are required"); return; }
    setLoading(true);
    setError(null);
    try {
      const baseUrl = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "";
      if (!baseUrl) throw new Error("Backend URL not configured");
      const url = `${baseUrl}/hms/users/data/context/clinical-notes-by-patient-doctor/${patientId}/${doctorId}`;
      const result = await safeFetch(url);
      if (result === null) { setAllNotes([]); setError(null); return; }
      let notesArray = result?.data || result;
      if (!Array.isArray(notesArray)) notesArray = [];
      if (notesArray.length > 0) {
        const sorted = [...notesArray].sort((a, b) => {
          const dA = a?.date || a?.created_at || "";
          const dB = b?.date || b?.created_at || "";
          return new Date(dB) - new Date(dA);
        });
        setAllNotes(sorted);
        const uniqueDates = [...new Set(sorted.map(n => n?.date || n?.created_at || "").filter(d => d))];
        if (uniqueDates.length > 0) {
          setSelectedDate(uniqueDates[0]);
          const notesForDate = sorted.filter(n => (n?.date || n?.created_at) === uniqueDates[0]);
          setNotesForSelectedDate(notesForDate);
          setSelectedNoteIndex(0);
        }
      } else {
        setAllNotes([]);
        setNotesForSelectedDate([]);
        setSelectedDate("");
      }
    } catch (err) {
      console.error("Fetch error:", err);
      setError("Failed to load clinical notes. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedDate("");
    setNotesForSelectedDate([]);
    setAllNotes([]);
    setError(null);
    setSelectedNoteIndex(0);
    fetchClinicalNotes();
  }, [patientId, doctorId]);

  const handleDateChange = (e) => {
    const date = e.target.value;
    setSelectedDate(date);
    const notesForDate = allNotes.filter(n => (n?.date || n?.created_at) === date);
    setNotesForSelectedDate(notesForDate);
    setSelectedNoteIndex(0);
  };

  const uniqueDates = [...new Set(allNotes.map(n => n?.date || n?.created_at || "").filter(d => d))];
  const currentNote = notesForSelectedDate[selectedNoteIndex];
  const validation  = currentNote?.clinical_validation || currentNote?.validation || {};
  const notesCount  = notesForSelectedDate.length;

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Box sx={{ py: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <CircularProgress size={20} thickness={1.5} sx={{ color: C.black }} />
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.08em", textTransform: "uppercase" }) }}>
          Loading clinical notes...
        </Typography>
      </Box>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mb: 2 }) }}>{error}</Typography>
        <Box
          component="button"
          onClick={fetchClinicalNotes}
          sx={{
            fontFamily: FONT, fontWeight: FW_REGULAR, fontSize: 11,
            color: C.black, background: "transparent",
            border: `1px solid ${C.mist}`,
            px: 2.5, py: 0.9, cursor: "pointer",
            letterSpacing: "0.05em", textTransform: "uppercase",
            transition: "all 0.2s",
            "&:hover": { background: C.ghost, borderColor: C.black },
          }}
        >
          <RefreshIcon sx={{ fontSize: 12, mr: 0.5, verticalAlign: "middle" }} />
          Retry
        </Box>
      </Box>
    );
  }

  // ─── Empty ────────────────────────────────────────────────────────────────
  if (!allNotes.length) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash, letterSpacing: "0.05em" }) }}>
          No clinical notes found for this patient
        </Typography>
      </Box>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <Box sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        mb: 2.5, pb: 2, borderBottom: `1px solid ${C.mist}`,
        flexWrap: "wrap", gap: 1.5,
      }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.12em", textTransform: "uppercase", mb: 0.4 }) }}>
            Clinical Documentations
          </Typography>
          <Typography sx={{ ...os({ fontSize: 13, color: C.black, fontWeight: FW_REGULAR }) }}>
            AI Validation · {allNotes.length} note{allNotes.length !== 1 ? "s" : ""}
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {uniqueDates.length > 0 && (
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <Select
                value={selectedDate}
                onChange={handleDateChange}
                displayEmpty
                sx={{
                  fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 11,
                  color: C.black, borderRadius: 0,
                  "& .MuiOutlinedInput-notchedOutline": { borderColor: C.mist, borderRadius: 0 },
                  "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: C.black },
                  "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: C.black, borderWidth: 1 },
                  "& .MuiSelect-select": { py: 0.9, letterSpacing: "0.02em" },
                }}
              >
                {uniqueDates.map((date) => {
                  const count = allNotes.filter(n => (n?.date || n?.created_at) === date).length;
                  return (
                    <MenuItem key={date} value={date}
                      sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 11, letterSpacing: "0.02em" }}>
                      {date} · {count} {count === 1 ? "note" : "notes"}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          )}

          <Box
            component="button"
            onClick={fetchClinicalNotes}
            sx={{
              width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: `1px solid ${C.mist}`,
              cursor: "pointer", color: C.ash, transition: "all 0.2s",
              "&:hover": { background: C.ghost, borderColor: C.black, color: C.black },
            }}
          >
            <RefreshIcon sx={{ fontSize: 13 }} />
          </Box>
        </Box>
      </Box>

      {/* ─── Multi-note tabs ─────────────────────────────────────────────── */}
      {notesCount > 1 && (
        <Box sx={{ mb: 2.5, borderBottom: `1px solid ${C.mist}` }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", mb: 1 }) }}>
            {notesCount} notes on this date
          </Typography>
          <Tabs
            value={selectedNoteIndex}
            onChange={(_, v) => setSelectedNoteIndex(v)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 36,
              "& .MuiTab-root": {
                fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 11,
                textTransform: "uppercase", letterSpacing: "0.08em",
                minHeight: 36, minWidth: "auto", px: 2, py: 0.75,
                color: C.ash,
                "&.Mui-selected": { color: C.black, fontWeight: FW_REGULAR },
              },
              "& .MuiTabs-indicator": { background: C.black, height: 1.5 },
            }}
          >
            {notesForSelectedDate.map((_, index) => (
              <Tab key={index} label={`Note ${index + 1}`} />
            ))}
          </Tabs>
        </Box>
      )}

      {notesForSelectedDate.length > 0 && currentNote && (
        <motion.div
          key={`${selectedDate}-${selectedNoteIndex}`}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15 }}
        >
          {/* ─── Note meta ────────────────────────────────────────────────── */}
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2, flexWrap: "wrap", gap: 1 }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.03em" }) }}>
              Note {selectedNoteIndex + 1} of {notesCount} · {currentNote?.date || currentNote?.created_at || "Unknown date"}
            </Typography>
            {currentNote?.doctor_edits && <Badge label="Doctor Edited" />}
          </Box>

          {/* ─── Summary badges ───────────────────────────────────────────── */}
          {(validation?.insurance_risk_analysis?.overall_risk || validation?.summary_flags) && (
            <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", mb: 2.5, pb: 2.5, borderBottom: `1px solid ${C.mist}` }}>
              {validation?.insurance_risk_analysis?.overall_risk && (
                <Badge label={`Insurance Risk: ${validation.insurance_risk_analysis.overall_risk}`} />
              )}
              {validation?.summary_flags?.clinical_safety && (
                <Badge label={`Clinical Safety: ${validation.summary_flags.clinical_safety}`} />
              )}
              {validation?.summary_flags?.requires_doctor_review && (
                <Badge label="Requires Review" />
              )}
              {currentNote?.status && (
                <Badge label={`Status: ${currentNote.status}`} />
              )}
            </Box>
          )}

          {/* ─── Diagnoses ────────────────────────────────────────────────── */}
          {validation?.diagnosis_validation?.diagnoses?.length > 0 && (
            <Section title="Diagnoses" count={validation.diagnosis_validation.diagnoses.length} defaultOpen>
              {validation.diagnosis_validation.diagnoses.map((d, idx) => (
                <Box key={idx} sx={{ mb: 2.5, pb: 2.5, borderBottom: idx < validation.diagnosis_validation.diagnoses.length - 1 ? `1px solid ${C.mist}` : "none" }}>
                  <Typography sx={{ ...os({ fontSize: 13, color: C.black, mb: 1, fontWeight: FW_REGULAR }) }}>
                    {d?.diagnosis_text || "Unknown diagnosis"}
                  </Typography>
                  <InfoRow label="ICD-10"     value={d?.suggested_icd10?.join(", ")} />
                  <InfoRow label="Confidence" value={d?.confidence ? `${(d.confidence * 100).toFixed(0)}%` : null} />
                  <InfoRow label="Status"     value={d?.validation_status} />
                  {d?.explainability && (
                    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, fontStyle: "italic", mt: 1, lineHeight: 1.7 }) }}>
                      {d.explainability}
                    </Typography>
                  )}
                  {d?.issues?.map((issue, i) => (
                    <Strip key={i} text={`${issue?.issue_text || "Unknown issue"} (${issue?.confidence ? (issue.confidence * 100).toFixed(0) : "?"}% confidence)`} />
                  ))}
                </Box>
              ))}
            </Section>
          )}

          {/* ─── Investigations ───────────────────────────────────────────── */}
          {validation?.investigation_validation?.investigations?.length > 0 && (
            <Section title="Investigations" count={validation.investigation_validation.investigations.length}>
              {validation.investigation_validation.investigations.map((inv, idx) => (
                <Box key={idx} sx={{ mb: 2.5, pb: 2.5, borderBottom: idx < validation.investigation_validation.investigations.length - 1 ? `1px solid ${C.mist}` : "none" }}>
                  <Typography sx={{ ...os({ fontSize: 13, color: C.black, mb: 1, fontWeight: FW_REGULAR }) }}>
                    {inv?.test_name || "Unknown test"}
                  </Typography>
                  <InfoRow label="Necessity" value={inv?.necessity_status} />
                  <InfoRow label="LOINC"     value={inv?.suggested_loinc?.join(", ")} />
                  {inv?.clinical_justification && (
                    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5, lineHeight: 1.7 }) }}>
                      {inv.clinical_justification}
                    </Typography>
                  )}
                  {inv?.issues?.map((issue, i) => (
                    <Strip key={i} text={`${issue?.issue_text || "Unknown issue"} (${issue?.confidence ? (issue.confidence * 100).toFixed(0) : "?"}% confidence)`} />
                  ))}
                </Box>
              ))}
            </Section>
          )}

          {/* ─── Medications ──────────────────────────────────────────────── */}
          {validation?.rx_validation?.medications?.length > 0 && (
            <Section title="Medications" count={validation.rx_validation.medications.length}>
              {validation.rx_validation.medications.map((med, idx) => (
                <Box key={idx} sx={{ mb: 2.5, pb: 2.5, borderBottom: idx < validation.rx_validation.medications.length - 1 ? `1px solid ${C.mist}` : "none" }}>
                  <Typography sx={{ ...os({ fontSize: 13, color: C.black, mb: 1, fontWeight: FW_REGULAR }) }}>
                    {med?.drug_name || "Unknown medication"}
                  </Typography>
                  <InfoRow label="Safety" value={med?.safety_status} />
                  {med?.dose_concerns?.map((dose, i) => (
                    <Typography key={i} sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4, lineHeight: 1.7 }) }}>
                      Dose: {dose?.dose_text}
                    </Typography>
                  ))}
                  {med?.interaction_risks?.map((risk, i) => (
                    <Strip key={i} text={`Interaction: ${risk?.interaction_text}`} />
                  ))}
                </Box>
              ))}
            </Section>
          )}

          {/* ─── Insurance Analysis ───────────────────────────────────────── */}
          {validation?.insurance_risk_analysis && (
            <Section title="Insurance Analysis">
              <InfoRow label="Overall Risk" value={validation.insurance_risk_analysis?.overall_risk} />

              {validation.insurance_risk_analysis?.risk_factors?.length > 0 && (
                <Box sx={{ mt: 2, mb: 1.5 }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", mb: 1 }) }}>
                    Risk Factors
                  </Typography>
                  {validation.insurance_risk_analysis.risk_factors.map((factor, idx) => (
                    <Box key={idx} sx={{ display: "flex", gap: 1.25, mb: 0.75, alignItems: "flex-start" }}>
                      <Box sx={{ width: 4, height: 4, borderRadius: "50%", background: C.mist, mt: 0.8, flexShrink: 0 }} />
                      <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.7 }) }}>
                        {factor?.risk_factor_text}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {validation.insurance_risk_analysis?.missing_documentation?.length > 0 && (
                <Box sx={{ mt: 2, mb: 1.5 }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", mb: 1 }) }}>
                    Missing Documentation
                  </Typography>
                  {validation.insurance_risk_analysis.missing_documentation.map((doc, idx) => (
                    <Strip key={idx} text={doc?.missing_documentation_text} />
                  ))}
                </Box>
              )}

              {validation.insurance_risk_analysis?.suggested_corrections?.length > 0 && (
                <Box sx={{ mt: 2, mb: 1.5 }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", mb: 1 }) }}>
                    Suggested Corrections
                  </Typography>
                  {validation.insurance_risk_analysis.suggested_corrections.map((corr, idx) => (
                    <Strip key={idx} text={corr?.suggested_correction_text} />
                  ))}
                </Box>
              )}

              {validation.insurance_risk_analysis?.explainability && (
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, fontStyle: "italic", mt: 1.5, lineHeight: 1.7 }) }}>
                  {validation.insurance_risk_analysis.explainability}
                </Typography>
              )}
            </Section>
          )}
        </motion.div>
      )}
    </motion.div>
  );
}