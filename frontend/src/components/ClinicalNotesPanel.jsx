import React, { useState, useEffect, useRef, useCallback, memo } from "react";
import { useLocation } from "react-router-dom";
import {
  Box,
  Typography,
  Dialog,
  DialogContent,
  DialogTitle,
  Grid,
  Table,
  TableBody,
  TableRow,
  TableCell,
} from "@mui/material";
import {
  LocalHospital as DiagnosisIcon,
  Science as InvestigationIcon,
  Medication as MedicationIcon,
  Download as DownloadIcon,
  Visibility as PreviewIcon,
  Close as CloseIcon,
} from "@mui/icons-material";
import html2pdf from "html2pdf.js";
import { motion, AnimatePresence } from "framer-motion";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;
import { THEMES } from "../dashboard/themes";

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const C = {
  // Text
  black: theme.text,
  ink: theme.text,
  charcoal: theme.textSec,
  smoke: theme.textSec,
  ash: theme.textMuted,
  silver: theme.textMuted,

  // Borders / Backgrounds
  mist: theme.border,
  fog: theme.bgTert,
  ghost: theme.bgAlt,
  white: theme.bg,

  // Status colors
  danger: {
    bg: theme.bgAlt,
    border: theme.danger,
    dot: theme.danger,
    text: theme.danger,
  },

  warn: {
    bg: theme.bgAlt,
    border: theme.warning,
    dot: theme.warning,
    text: theme.warning,
  },

  safe: {
    bg: theme.bgAlt,
    border: theme.success,
    dot: theme.success,
    text: theme.success,
  },
};
const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

// ─── Helpers ──────────────────────────────────────────────────────────────────
const safeText = (val) => {
  if (val === null || val === undefined) return "";
  if (typeof val === "string" || typeof val === "number") return String(val);
  if (Array.isArray(val)) return val.map(v => safeText(v)).join(", ");
  if (typeof val === "object") {
    if (val.code && val.name) return `${val.code} - ${val.name}`;
    return safeText(Object.values(val)[0]);
  }
  return String(val);
};

const getStatusTone = (status) => {
  const s = safeText(status).toLowerCase();
  if (["green", "safe", "low", "valid", "appropriate", "necessary"].includes(s)) return C.safe;
  if (["amber", "moderate", "warning", "caution", "consider"].includes(s)) return C.warn;
  if (["red", "high", "error", "danger"].includes(s)) return C.danger;
  return { bg: C.ghost, border: C.fog, dot: C.silver, text: C.ash };
};

// ─── Small components ─────────────────────────────────────────────────────────
const Badge = ({ label, tone }) => {
  const t = tone || { bg: C.ghost, border: C.fog, dot: C.silver, text: C.ash };
  return (
    <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.4, borderRadius: "2px", background: t.bg, border: `1px solid ${t.border}` }}>
      <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: t.dot, flexShrink: 0 }} />
      <Typography sx={{ ...os({ fontSize: 10, color: t.text, letterSpacing: "0.05em" }) }}>{label}</Typography>
    </Box>
  );
};

const Strip = ({ text, tone = C.warn }) => (
  <Box sx={{ px: 2, py: 1, borderRadius: "2px", background: tone.bg, border: `1px solid ${tone.border}`, borderLeft: `3px solid ${tone.dot}`, mt: 1 }}>
    <Typography sx={{ ...os({ fontSize: 11, color: tone.text }) }}>{text}</Typography>
  </Box>
);

const InfoRow = ({ label, value }) => (
  <Box sx={{ display: "flex", gap: 1, mb: 0.75 }}>
    <Typography sx={{ ...os({ fontSize: 12, color: C.ash, minWidth: 110, flexShrink: 0 }) }}>{label}</Typography>
    <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{value || "—"}</Typography>
  </Box>
);

const SectionLabel = ({ children }) => (
  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.09em", mb: 1.5 }) }}>
    {children}
  </Typography>
);

const Btn = ({ children, onClick, variant = "ghost", icon, disabled, sx = {} }) => {
  const styles = {
    primary: { background: C.black, color: C.white, border: "none", "&:hover": { background: C.charcoal } },
    ghost: { background: "transparent", color: C.charcoal, border: `1px solid ${C.mist}`, "&:hover": { background: C.ghost, borderColor: C.smoke } },
  };
  return (
    <Box component="button" onClick={onClick} disabled={disabled}
      sx={{ fontFamily: FONT, fontWeight: 400, fontSize: 12, letterSpacing: "0.04em", textTransform: "none", borderRadius: "2px", cursor: disabled ? "not-allowed" : "pointer", display: "inline-flex", alignItems: "center", gap: 0.75, px: 2, py: 0.9, transition: "all 0.14s", opacity: disabled ? 0.4 : 1, "& svg": { fontSize: 14 }, ...styles[variant], ...sx }}>
      {icon && icon}{children}
    </Box>
  );
};

// ─── Always-expanded section ──────────────────────────────────────────────────
const Section = ({ title, icon, count, statusTone, children }) => {
  return (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", overflow: "hidden", mb: 2 }}>
      <Box sx={{ px: 2.5, py: 1.75, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.ghost, borderBottom: `1px solid ${C.fog}` }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          {icon && <Box sx={{ color: C.ash, display: "flex", alignItems: "center", "& svg": { fontSize: 16 } }}>{icon}</Box>}
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink, fontWeight: 400 }) }}>{title}</Typography>
          {count > 0 && (
            <Box sx={{ background: C.fog, borderRadius: "2px", px: 1, py: 0.1 }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash }) }}>{count}</Typography>
            </Box>
          )}
          {statusTone && <Badge label={statusTone === C.safe ? "Validated" : statusTone === C.warn ? "Review" : "Action Required"} tone={statusTone} />}
        </Box>
      </Box>
      <Box sx={{ px: 2.5, py: 2.5 }}>{children}</Box>
    </Box>
  );
};

// ─── ICD Code Selector ────────────────────────────────────────────────────────
const ICDCodeSelector = memo(({ diagnosis, diagnosisIndex, selectedCode, onCodeSelect }) => {
  if (!diagnosis.icd10_codes?.length) {
    return <Typography sx={{ ...os({ fontSize: 11, color: C.silver, fontStyle: "italic" }) }}>No ICD-10 codes available</Typography>;
  }

  return (
    <Box sx={{ mt: 2 }}>
      <SectionLabel>Select ICD-10 Code</SectionLabel>
      {diagnosis.icd10_codes.map((icd) => {
        const isSelected = selectedCode === icd.code;
        return (
          <Box key={icd.code} onClick={() => onCodeSelect(diagnosisIndex, icd)}
            sx={{
              p: 2, mb: 1, borderRadius: "3px", cursor: "pointer",
              border: `1px solid ${isSelected ? C.charcoal : C.fog}`,
              background: isSelected ? C.ghost : C.white,
              transition: "all 0.14s",
              "&:hover": { borderColor: C.mist, background: C.ghost },
            }}
          >
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
              {/* Radio dot */}
              <Box sx={{ width: 16, height: 16, borderRadius: "50%", border: `1.5px solid ${isSelected ? C.charcoal : C.mist}`, background: isSelected ? C.black : "transparent", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: 0.3 }}>
                {isSelected && <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: C.white }} />}
              </Box>

              <Box sx={{ flex: 1 }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ink, fontWeight: 400 }) }}>{icd.code}</Typography>
                  {icd.rank === 1 && <Badge label="Recommended" tone={C.safe} />}
                  {isSelected && <Badge label="Selected" tone={{ bg: C.ghost, border: C.mist, dot: C.charcoal, text: C.charcoal }} />}
                </Box>
                <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.4 }) }}>{icd.name}</Typography>
                {icd.explainability && (
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash, lineHeight: 1.5 }) }}>{icd.explainability}</Typography>
                )}
              </Box>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
});

// ─── Professional PDF ─────────────────────────────────────────────────────────
const ProfessionalPDF = React.forwardRef(({ local, doctorInfo, patientInfo, patientIdFromUrl, icdSelections }, ref) => {
  const getValue = (obj, path, def = "") => {
    try { return path.split(".").reduce((cur, key) => cur?.[key], obj) || def; } catch { return def; }
  };
  const formatDate = () => new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const doctorName = doctorInfo?.name || getValue(doctorInfo, "data.name") || "___________________";
  const doctorSpec = doctorInfo?.specialization || getValue(doctorInfo, "data.specialization") || "";
  const doctorLic = doctorInfo?.license_number || getValue(doctorInfo, "data.license_number") || "";
  const patientName = patientInfo?.patient_name || getValue(patientInfo, "data.patient_name") || "___________________";
  const patientAge = patientInfo?.age || getValue(patientInfo, "data.age") || "";
  const patientGender = patientInfo?.gender || getValue(patientInfo, "data.gender") || "";
  const diagnoses = local?.diagnosis_validation?.diagnoses || [];
  const investigations = local?.investigation_validation?.investigations || [];
  const medications = local?.rx_validation?.medications || [];
  const getSelectedICD = (i) => icdSelections[i] || diagnoses[i]?.icd10_codes?.find(c => c.rank === 1) || diagnoses[i]?.icd10_codes?.[0];

  const headerStyle = { fontSize: "10px", fontWeight: 600, letterSpacing: "0.1em", color: "#7a7a7a", textTransform: "uppercase", borderBottom: "1px solid #e8e8e8", paddingBottom: "5px", marginBottom: "10px" };
  const rowStyle = { display: "flex", gap: "8px", marginBottom: "5px", fontSize: "12px" };
  const labelStyle = { color: "#7a7a7a", minWidth: "100px" };

  return (
    <div ref={ref} style={{ width: "100%", display: "flex", justifyContent: "center", backgroundColor: "#ffffff" }}>
      <div style={{ width: "100%", maxWidth: "792px", padding: "40px 50px", fontFamily: "'Open Sans', Arial, sans-serif", fontWeight: 300, color: "#0a0a0a", border: "1px solid #e8e8e8", borderRadius: "4px", margin: "20px" }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "28px", paddingBottom: "18px", borderBottom: "2px solid #0a0a0a" }}>
          <div style={{ fontSize: "9px", fontWeight: 600, letterSpacing: "0.16em", color: "#7a7a7a", marginBottom: "5px", textTransform: "uppercase" }}>Clinical Documentation</div>
          <div style={{ fontSize: "20px", fontWeight: 600, color: "#0a0a0a" }}>AI-Validated Clinical Note · ICD-10</div>
        </div>

        {/* Patient + Doctor */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "32px", marginBottom: "28px" }}>
          <div>
            <div style={headerStyle}>Patient Information</div>
            {[["Name", patientName], ["Patient ID", patientIdFromUrl || "N/A"], ["Age", patientAge], ["Gender", patientGender]].map(([l, v]) => (
              <div key={l} style={rowStyle}><span style={labelStyle}>{l}:</span><span>{v}</span></div>
            ))}
          </div>
          <div>
            <div style={headerStyle}>Physician</div>
            {[["Name", doctorName], ["Specialization", doctorSpec], ["License", doctorLic], ["Date", formatDate()]].map(([l, v]) => (
              <div key={l} style={rowStyle}><span style={labelStyle}>{l}:</span><span style={{ fontWeight: 400 }}>{v}</span></div>
            ))}
          </div>
        </div>

        {/* Diagnoses */}
        {diagnoses.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <div style={headerStyle}>Diagnoses & ICD-10 Codes</div>
            {diagnoses.map((d, idx) => {
              const sel = getSelectedICD(idx);
              return (
                <div key={idx} style={{ marginBottom: "14px", paddingLeft: "8px", borderLeft: "2px solid #e8e8e8" }}>
                  <div style={{ fontSize: "12px", fontWeight: 400, color: "#1a1a1a", marginBottom: "4px" }}>{idx + 1}. {safeText(d.diagnosis_text)}</div>
                  {sel && (
                    <div style={{ fontSize: "11px", color: "#4a4a4a", paddingLeft: "12px" }}>
                      <span style={{ fontWeight: 400 }}>{sel.code}</span> — {sel.name}
                      {sel.explainability && <div style={{ color: "#7a7a7a", fontStyle: "italic", marginTop: "2px" }}>{sel.explainability}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Investigations */}
        {investigations.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <div style={headerStyle}>Investigations & Laboratory Tests</div>
            {investigations.map((test, idx) => (
              <div key={idx} style={{ marginBottom: "12px", paddingLeft: "8px", borderLeft: "2px solid #e8e8e8" }}>
                <div style={{ fontSize: "12px", fontWeight: 400, color: "#1a1a1a", marginBottom: "3px" }}>{idx + 1}. {safeText(test.test_name)}</div>
                <div style={{ fontSize: "11px", color: "#4a4a4a", paddingLeft: "12px" }}>{safeText(test.clinical_justification)}</div>
                {test.suggested_loinc?.length > 0 && (
                  <div style={{ fontSize: "10px", color: "#7a7a7a", paddingLeft: "12px" }}>LOINC: {test.suggested_loinc.map(l => l.code).join(", ")}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Medications */}
        {medications.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <div style={headerStyle}>Medications & Prescriptions</div>
            {medications.map((med, idx) => (
              <div key={idx} style={{ marginBottom: "12px", paddingLeft: "8px", borderLeft: "2px solid #e8e8e8" }}>
                <div style={{ fontSize: "12px", fontWeight: 400, color: "#1a1a1a", marginBottom: "3px" }}>{idx + 1}. {safeText(med.drug_name)}</div>
                {med.interaction_risks?.length > 0 && (
                  <div style={{ fontSize: "11px", color: "#b8860b", paddingLeft: "12px" }}>Interactions: {med.interaction_risks.map(r => safeText(r.interaction_text)).join("; ")}</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: "36px", paddingTop: "16px", borderTop: "1px solid #e8e8e8", textAlign: "center" }}>
          <div style={{ fontSize: "10px", color: "#a8a8a8" }}>Electronically generated document. Valid without signature.</div>
        </div>
      </div>
    </div>
  );
});

// ─── Main Component ───────────────────────────────────────────────────────────
export default function ClinicalNotePanel({ data, metadata, onSave }) {
  if (!data) return null;

  const BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, "") || "https://doctorassist.ai/api/";
  const [local, setLocal] = useState(data?.finaloutput?.clinical_validation || data?.clinical_validation || {});
  const [doctorInfo, setDoctorInfo] = useState(null);
  const [patientInfo, setPatientInfo] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [icdSelections, setIcdSelections] = useState({});
  const userHasSelected = useRef({});

  const location = useLocation();
  const queryParams = new URLSearchParams(location.search);
  const doctorIdFromUrl = queryParams.get("doctor_id") || data?.metadata?.doctor_id;
  const patientIdFromUrl = queryParams.get("patient_id") || data?.metadata?.patient_id;
  const pdfRef = useRef();

  // Init local + ICD selections
  useEffect(() => {
    const clinicalData = data?.finaloutput?.clinical_validation || data?.clinical_validation || {};
    setLocal(clinicalData);
    if (clinicalData?.diagnosis_validation?.diagnoses) {
      setIcdSelections(prev => {
        const sel = { ...prev };
        clinicalData.diagnosis_validation.diagnoses.forEach((d, i) => {
          if (userHasSelected.current[i]) return;
          if (d.selected_icd10) { sel[i] = d.selected_icd10; }
          else if (d.icd10_codes?.length) { sel[i] = d.icd10_codes.find(c => c.rank === 1) || d.icd10_codes[0]; }
        });
        return sel;
      });
    }
  }, [data]);

  const stableOnSave = useCallback(payload => { if (onSave) onSave(payload); }, [onSave]);
  useEffect(() => { stableOnSave({ clinical_validation: local, icd_selections: icdSelections }); }, [local, icdSelections, stableOnSave]);

  // Fetch metadata
  useEffect(() => {
    if (!doctorIdFromUrl || !patientIdFromUrl || !BASE_URL) return;
    const fetchMetadata = async () => {
      try {
        const [dRes, pRes] = await Promise.all([
          fetch(`${BASE_URL}/hms/users/data/context/get-doctor-info?sys_user_id=${doctorIdFromUrl}`),
          fetch(`${BASE_URL}/hms/users/data/context/get-patient-info?patient_id=${patientIdFromUrl}`),
        ]);
        if (dRes.ok) { const d = await dRes.json(); setDoctorInfo(d?.data ?? d); }
        if (pRes.ok) { const p = await pRes.json(); setPatientInfo(p?.data ?? p); }
      } catch (err) { console.error("Metadata fetch error:", err); }
    };
    fetchMetadata();
  }, [doctorIdFromUrl, patientIdFromUrl, BASE_URL]);

  const handleDownloadPDF = () => {
    if (!pdfRef.current) return;
    html2pdf().set({
      margin: 10, filename: `Clinical_Note_${patientIdFromUrl || "unknown"}.pdf`,
      image: { type: "jpeg", quality: 0.98 }, html2canvas: { scale: 2, letterRendering: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    }).from(pdfRef.current).save();
  };

  const handleICDSelect = useCallback((diagnosisIndex, selectedCodeObj) => {
    userHasSelected.current[diagnosisIndex] = true;
    setIcdSelections(prev => ({ ...prev, [diagnosisIndex]: selectedCodeObj }));
  }, []);

  const diagnoses = local?.diagnosis_validation?.diagnoses || [];
  const investigations = local?.investigation_validation?.investigations || [];
  const medications = local?.rx_validation?.medications || [];

  return (
    <Box sx={{ fontFamily: FONT, fontWeight: FW, width: "100%" }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* ─── Top bar ──────────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5, flexWrap: "wrap", gap: 1.5, pb: 2.5, borderBottom: `1px solid ${C.fog}` }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Clinical Documentation</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>AI-Validated Clinical Notes · ICD-10 Coding</Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Btn onClick={() => setPreviewOpen(true)} icon={<PreviewIcon />}>Preview PDF</Btn>
          <Btn variant="primary" onClick={handleDownloadPDF} icon={<DownloadIcon />}>Download PDF</Btn>
        </Box>
      </Box>


      {/* ─── Diagnoses ──────────────────────────────────────────────────────── */}
      <Section
        title="Diagnoses & ICD-10 Codes"
        icon={<DiagnosisIcon />}
        count={diagnoses.length}
        statusTone={diagnoses[0]?.validation_status ? getStatusTone(diagnoses[0].validation_status) : null}
        defaultOpen
      >
        {diagnoses.length === 0 ? (
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash, textAlign: "center", py: 3 }) }}>No diagnoses available</Typography>
        ) : (
          diagnoses.map((d, i) => (
            <Box key={i} sx={{ mb: 3, pb: 3, borderBottom: i < diagnoses.length - 1 ? `1px solid ${C.fog}` : "none" }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ink, fontWeight: 400 }) }}>
                {i + 1}. {safeText(d.diagnosis_text)}
              </Typography>

              <ICDCodeSelector
                diagnosis={d}
                diagnosisIndex={i}
                selectedCode={icdSelections[i]?.code ?? null}
                onCodeSelect={handleICDSelect}
              />

              {d.issues?.map((issue, idx) => (
                <Strip key={idx} text={`• ${safeText(issue.issue_text)}`} tone={C.warn} />
              ))}
            </Box>
          ))
        )}
      </Section>

      {/* ─── Investigations ──────────────────────────────────────────────────── */}
      <Section
        title="Investigations & Laboratory Tests"
        icon={<InvestigationIcon />}
        count={investigations.length}
        statusTone={investigations[0]?.necessity_status ? getStatusTone(investigations[0].necessity_status) : null}
      >
        {investigations.length === 0 ? (
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash, textAlign: "center", py: 3 }) }}>No investigations available</Typography>
        ) : (
          investigations.map((test, i) => (
            <Box key={i} sx={{ mb: 3, pb: 3, borderBottom: i < investigations.length - 1 ? `1px solid ${C.fog}` : "none" }}>
              <Typography sx={{ ...os({ fontSize: 13, color: C.ink, fontWeight: 400, mb: 0.75 }) }}>
                {i + 1}. {safeText(test.test_name)}
              </Typography>
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.75 }) }}>{safeText(test.clinical_justification)}</Typography>

              {test.suggested_loinc?.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 }) }}>LOINC Codes</Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {test.suggested_loinc.map((loinc, idx) => (
                      <Box key={idx} sx={{ px: 1.5, py: 0.4, borderRadius: "2px", border: `1px solid ${C.fog}`, background: C.ghost }}>
                        <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{loinc.code} — {loinc.name}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>
              )}

              {test.issues?.map((issue, idx) => (
                <Strip key={idx} text={`• ${safeText(issue.issue_text)}`} tone={C.warn} />
              ))}

              {test.explainability && (
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, fontStyle: "italic", mt: 1 }) }}>{test.explainability}</Typography>
              )}
            </Box>
          ))
        )}
      </Section>

      {/* ─── Medications ─────────────────────────────────────────────────────── */}
      <Section
        title="Medications & Prescriptions"
        icon={<MedicationIcon />}
        count={medications.length}
        statusTone={medications[0]?.safety_status ? getStatusTone(medications[0].safety_status) : null}
      >
        {medications.length === 0 ? (
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash, textAlign: "center", py: 3 }) }}>No medications available</Typography>
        ) : (
          medications.map((med, i) => (
            <Box key={i} sx={{ mb: 3, pb: 3, borderBottom: i < medications.length - 1 ? `1px solid ${C.fog}` : "none" }}>
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75, flexWrap: "wrap", gap: 1 }}>
                <Typography sx={{ ...os({ fontSize: 13, color: C.ink, fontWeight: 400 }) }}>
                  {i + 1}. {safeText(med.drug_name)}
                </Typography>
                {med.safety_status && <Badge label={med.safety_status.toUpperCase()} tone={getStatusTone(med.safety_status)} />}
              </Box>

              {med.interaction_risks?.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  <Strip text={`Interactions: ${med.interaction_risks.map(r => safeText(r.interaction_text)).join("; ")}`} tone={C.warn} />
                </Box>
              )}

              {med.dose_concerns?.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  {med.dose_concerns.map((c, idx) => <Strip key={idx} text={`Dose: ${safeText(c.dose_text)}`} tone={C.warn} />)}
                </Box>
              )}

              {med.contraindications?.length > 0 && (
                <Box sx={{ mt: 1 }}>
                  {med.contraindications.map((c, idx) => <Strip key={idx} text={`Contraindication: ${safeText(c.contraindication_text)}`} tone={C.danger} />)}
                </Box>
              )}

              {med.explainability && (
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, fontStyle: "italic", mt: 1 }) }}>{med.explainability}</Typography>
              )}
            </Box>
          ))
        )}
      </Section>

      {/* ─── Hidden PDF ──────────────────────────────────────────────────────── */}
      <Box sx={{ display: "none" }}>
        <ProfessionalPDF ref={pdfRef} local={local} doctorInfo={doctorInfo} patientInfo={patientInfo} patientIdFromUrl={patientIdFromUrl} icdSelections={icdSelections} />
      </Box>

      {/* ─── Preview Dialog ───────────────────────────────────────────────────── */}
      <Dialog open={previewOpen} onClose={() => setPreviewOpen(false)} maxWidth="lg" fullWidth
        PaperProps={{ sx: { borderRadius: "4px", border: `1px solid ${C.fog}`, boxShadow: "0 8px 32px rgba(0,0,0,0.1)" } }}>
        <DialogTitle sx={{ px: 3, py: 2, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Clinical Note Preview</Typography>
          <Box sx={{ display: "flex", gap: 1 }}>
            <Btn variant="primary" onClick={handleDownloadPDF} icon={<DownloadIcon />}>Download</Btn>
            <Box component="button" onClick={() => setPreviewOpen(false)}
              sx={{ width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center", background: "transparent", border: `1px solid ${C.fog}`, borderRadius: "2px", cursor: "pointer", color: C.ash, "&:hover": { background: C.fog } }}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </Box>
          </Box>
        </DialogTitle>
        <DialogContent dividers sx={{ bgcolor: C.ghost, p: 3 }}>
          <Box sx={{ display: "flex", justifyContent: "center", overflow: "auto", maxHeight: "80vh" }}>
            <ProfessionalPDF local={local} doctorInfo={doctorInfo} patientInfo={patientInfo} patientIdFromUrl={patientIdFromUrl} icdSelections={icdSelections} />
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
}