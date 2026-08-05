// OTRecord.jsx — NCG-KCDO Surgical Oncology Module (Refactored)
// Imports shared design tokens, components, API, and hooks.

import React, { useState, useEffect, useRef } from "react";
import {
  Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel,
  Checkbox, FormControlLabel, FormGroup, RadioGroup, Radio,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Button, Snackbar, Alert, Dialog, DialogTitle, DialogContent, DialogActions, IconButton,
  Accordion, AccordionSummary, AccordionDetails, Autocomplete, Tooltip
} from "@mui/material";
import {
  SaveRounded, AddRounded, DeleteRounded, UploadFileRounded,
  FilterListRounded, PictureAsPdfRounded, TableChartRounded,
  FileDownloadRounded, LocalHospitalRounded, CloseRounded, MicRounded, StopRounded,
  ExpandMoreRounded,
} from "@mui/icons-material";
import { motion } from "framer-motion";
import { jsPDF } from "jspdf";
import * as XLSX from "xlsx";
import ClinicalSummaryTab from "../ClinicalSummaryTab";
import DoctorsNoteTab from "./DoctorsNoteTab";
import DICOMViewer from "../DICOMViewer";
import DischargeSummary from "../Dischargesummary";
import DischargeSummaryTab from "./DischargeSummaryTab";
import PatientReferralsTab from "../PatientReferralsTab";
import StructuredNotePanel from "../structurenoteview";  // Sub tab inside the Record - Not total discharge summary
import TumorBoardCommonElement from "../TumorBoardCommonElement";
// ─── Shared Imports ──────────────────────────────────────────────────────────
import {
  C, FONT, FW_LIGHT, FW_NORMAL, FW_BOLD, inputSx, fieldLabelSx, flagNoteSx,
  sectionHeaderSx, saveBtnSx, outlineBtnSx, thSx, tdSx,
} from "./shared/designTokens";
import {
  SectionBox, FG, FieldLabel, FlagNote, ROInput, Sel, CbxGroup, RdoGroup,
  StatusBadge, SubTabBar, PostponedBanner, WasPostponedTag,
} from "./shared/FormComponents";
import { getPostponeInfo } from "./shared/postponeStatus";
import {
  createBooking, updateBooking, getBooking, getBookings,
  saveSection, updateBookingStatus, setActiveBooking, completeBooking,
  getOTSchedule, getPatientInfo, getDoctorInfo, getDoctorsByHospital,
  savePatientDiagrams, getPatientDiagrams,
  uploadDocument, getDocuments, deleteDocument,
  getOncologyRecords, getPatientVitals,
  predictAsaStatus, getAnaesthesiaHistory, getPostOpHistory,
  generateInvestigationSuggestion, getOTBookingPrefill, getPatientBookings,
  createReferral, getReferrals,
} from "./shared/api";
import { usePatientInfo } from "./shared/usePatientInfo";
import { useBookingData } from "./shared/useBookingData";

// ─── Constants ───────────────────────────────────────────────────────────────
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const PROCEDURES = [
  "Modified Radical Mastectomy", "Low Anterior Resection", "Abdominoperineal Resection",
  "Radical Hysterectomy", "Radical Cystectomy", "Total Gastrectomy", "Ivor Lewis Esophagectomy",
  "Hepatectomy", "Whipple Procedure", "Total Thyroidectomy", "Neck Dissection", "Lobectomy",
  "Pneumonectomy", "Distal Gastrectomy", "Hemicolectomy", "Radical Prostatectomy",
  "Radical Nephrectomy", "Adrenalectomy", "Splenectomy", "Distal Pancreatectomy",
  "Radical Cholecystectomy", "Pelvic Exenteration", "Limb Sparing Surgery", "Amputation",
  "Flap Reconstruction", "Skin Grafting", "Other (Specify)",
];
const OT_ROOMS = ["OT 1", "OT 2", "OT 3", "OT 4", "OT 5", "OT 6", "OT 7", "OT 8"];
const SURGEONS_DEFAULT = ["Dr. Smith", "Dr. Jones", "Dr. Williams", "Dr. Brown", "Dr. Taylor"];

// ─── Standard Pre-Op Lab Fields ───────────────────────────────────────────────
// Each field: { key, label, unit, range, category }
// key is stable — never changes. custom fields use "custom_<uuid8>" keys.
const STANDARD_LAB_FIELDS = [
  // Haematology
  { key: "hb", label: "Haemoglobin (Hb)", unit: "g/dL", range: "12–18", category: "Haematology" },
  { key: "pcv", label: "PCV / Haematocrit", unit: "%", range: "36–52", category: "Haematology" },
  { key: "wbc", label: "WBC Count", unit: "×10³/µL", range: "4–11", category: "Haematology" },
  { key: "platelets", label: "Platelets", unit: "×10³/µL", range: "150–400", category: "Haematology" },
  { key: "inr", label: "PT / INR", unit: "", range: "<1.5", category: "Haematology" },
  { key: "aptt", label: "aPTT", unit: "sec", range: "25–35", category: "Haematology" },
  // Renal
  { key: "creatinine", label: "Serum Creatinine", unit: "mg/dL", range: "0.6–1.2", category: "Renal" },
  { key: "blood_urea", label: "Blood Urea", unit: "mg/dL", range: "7–20", category: "Renal" },
  { key: "sodium", label: "Serum Na⁺", unit: "mEq/L", range: "136–145", category: "Renal" },
  { key: "potassium", label: "Serum K⁺", unit: "mEq/L", range: "3.5–5.0", category: "Renal" },
  // Liver
  { key: "bilirubin", label: "Total Bilirubin", unit: "mg/dL", range: "0.2–1.2", category: "Liver" },
  { key: "sgot", label: "SGOT / AST", unit: "U/L", range: "<40", category: "Liver" },
  { key: "sgpt", label: "SGPT / ALT", unit: "U/L", range: "<40", category: "Liver" },
  { key: "albumin", label: "Serum Albumin", unit: "g/dL", range: "3.5–5.0", category: "Liver" },
  // Metabolic
  { key: "rbs", label: "Random Blood Sugar", unit: "mg/dL", range: "<180", category: "Metabolic" },
  { key: "hba1c", label: "HbA1c", unit: "%", range: "<7.0", category: "Metabolic" },
  { key: "calcium", label: "Serum Calcium", unit: "mg/dL", range: "8.5–10.5", category: "Metabolic" },
  // Cardiac
  { key: "ecg", label: "ECG Result", unit: "", range: "", category: "Cardiac" },
  { key: "echo_lvef", label: "Echo LVEF", unit: "%", range: ">55", category: "Cardiac" },
  { key: "bnp", label: "BNP", unit: "pg/mL", range: "<100", category: "Cardiac" },
  // Virology
  { key: "hiv", label: "HIV", unit: "", range: "Negative", category: "Virology" },
  { key: "hbsag", label: "HBsAg", unit: "", range: "Negative", category: "Virology" },
  { key: "hcv", label: "HCV", unit: "", range: "Negative", category: "Virology" },
];

const LAB_CATEGORIES = ["Haematology", "Renal", "Liver", "Metabolic", "Cardiac", "Virology"];

// Compute a flag string from a value against a range string (client-side only)
function computeLabFlag(value, range) {
  if (!range || !value) return "";
  const num = parseFloat(value);
  if (isNaN(num)) return "";
  // Pattern: "X–Y" or "X-Y"
  const rangeMatch = range.match(/^([\d.]+)[\u2013-]([\d.]+)$/);
  if (rangeMatch) {
    const lo = parseFloat(rangeMatch[1]), hi = parseFloat(rangeMatch[2]);
    if (num < lo) return num < lo * 0.8 ? "Critical Low" : "Low";
    if (num > hi) return num > hi * 1.2 ? "Critical High" : "High";
    return "";
  }
  // Pattern: "<X"
  const ltMatch = range.match(/^<([\d.]+)$/);
  if (ltMatch && num >= parseFloat(ltMatch[1])) return "High";
  // Pattern: ">X"
  const gtMatch = range.match(/^>([\d.]+)$/);
  if (gtMatch && num <= parseFloat(gtMatch[1])) return "Low";
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// TAB 1 — OT BOOKING (Part A)
// ─────────────────────────────────────────────────────────────────────────────
const OTBookingTab = ({ patientId, doctorId, doctorName, hospitalId, bookingId, onSave, initialData, onCancel }) => {
  const [f, setF] = useState({
    patientId: patientId || "", patientName: "", ageSex: "", wardBed: "", unitName: "", treatingDoctor: doctorName || "",
    caseStatus: "", bookingStatus: "Pending", surgeryType: [], procedureName: "", laterality: "", approach: [], duration: "",
    surgeryDate: new Date().toISOString().split("T")[0], startTime: "", otRoom: "", surgeonName: "", preOpDiagnosis: "",
    viralMarkers: [], insurance: "", insuranceType: [], asaClass: "ASA II",
    highRiskMDT: "", mdtComments: "", bloodGroup: "",
    pastTransfusion: "", transfusionReaction: "", reactionDetails: "", remarks: "",
    ...(initialData || {}),
    bookingId: bookingId || (initialData && initialData.bookingId) || "",
  });

  useEffect(() => {
    if (initialData) setF(p => ({ ...p, ...initialData, bookingId: bookingId || p.bookingId }));
  }, [initialData, bookingId]);

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const [surgeonList, setSurgeonList] = useState(SURGEONS_DEFAULT);
  const [otSchedule, setOtSchedule] = useState([]);
  const [conflictMsg, setConflictMsg] = useState("");
  const [isPredictingAsa, setIsPredictingAsa] = useState(false);
  const [asaReasoning, setAsaReasoning] = useState("");
  const [isPrefilling, setIsPrefilling] = useState(false);
  const [structuredNoteExpanded, setStructuredNoteExpanded] = useState(false);

  // Prefill from dictation if new booking
  useEffect(() => {
    if (patientId && doctorId && !bookingId && !initialData) {
      setIsPrefilling(true);
      getOTBookingPrefill(patientId, doctorId)
        .then(res => {
          if (res?.status === "success" && res?.data) {
            const prefill = res.data;
            console.log("[OTBookingTab] Prefill data received:", prefill);
            setF(prev => {
              const updated = { ...prev };
              Object.keys(prefill).forEach(key => {
                // Only override if current value is empty
                if (prefill[key]) {
                  if (Array.isArray(updated[key]) && updated[key].length === 0) {
                    updated[key] = prefill[key];
                  } else if (typeof updated[key] === "string" && !updated[key]) {
                    updated[key] = prefill[key];
                  }
                }
              });
              return updated;
            });
          }
        })
        .catch(err => console.error("[OTBookingTab] Prefill error:", err))
        .finally(() => setIsPrefilling(false));
    }
  }, [patientId, doctorId, bookingId, initialData]);

  // Fetch surgeons for hospital
  useEffect(() => {
    if (!hospitalId) return;
    getDoctorsByHospital(hospitalId)
      .then(d => {
        if (Array.isArray(d)) {
          const filtered = d.filter(doc => doc.specialization === "Surgical Oncology");
          const opts = filtered.map(doc => ({ value: doc.sys_user_id, label: doc.name }));
          setSurgeonList(opts.length > 0 ? opts : SURGEONS_DEFAULT.map(s => ({ value: s, label: s })));
        }
      })
      .catch(err => console.error("[OTBookingTab] surgeons fetch:", err));
  }, [hospitalId]);

  useEffect(() => {
    if (doctorName && !f.treatingDoctor) set("treatingDoctor", doctorName);
  }, [doctorName]);

  // Cross-module oncology data fetched from backend
  const [oncologyData, setOncologyData] = useState(null);
  const [viewFullOncology, setViewFullOncology] = useState(null);
  useEffect(() => {
    if (patientId) {
      getOncologyRecords(patientId).then(res => {
        let chemoMapped = { hasRecord: false };
        let radioMapped = { hasRecord: false };

        if (res.chemotherapy) {
          const chemo = res.chemotherapy;
          const treatment = chemo.treatment || {};
          const assessment = chemo.data?.assessment || {};
          const currentCycleNum = treatment.currentCycle || 1;
          const currentCycleData = chemo.data?.cycles?.[currentCycleNum.toString()] || {};
          const regimen = currentCycleData.regimen || {};
          const response = currentCycleData.response || {};

          const summary = chemo.data?.summary || {};
          // Fallback to cycle 1 if current cycle doesn't have details or pre_chemo (often happens for in-progress cycles)
          const cycle1Data = chemo.data?.cycles?.['1'] || {};
          const details = currentCycleData.details || cycle1Data.details || {};
          const preChemo = currentCycleData.pre_chemo || cycle1Data.pre_chemo || {};

          const asaRelevantData = {
            comorbidities: details.comorbidities || null,
            cardiacFunction: assessment.cardiacFunction || null,
            renalFunction: assessment.renalFunction || null,
            hepaticFunction: assessment.hepaticFunction || null,
            currentLabs: preChemo.currentLabs || null,
            vitals: preChemo.vitals || null,
            performanceStatus: assessment.performanceStatus || null,
            age: summary.age || details.age || null,
          };

          chemoMapped = {
            hasRecord: true,
            latestRecord: {
              selectedProtocol: regimen.selectedProtocol || null,
              treatmentIntent: regimen.treatmentIntent || null,
              cyclesCompleted: treatment.completedCycles,
              plannedCycles: treatment.plannedCycles,
              lastCycleDate: currentCycleData.cycle_admin?.cycleDate1 || currentCycleData.post_chemo?.onset || null,
              responseAssessment: response.responseCriteria || response.interimImaging || null,
              ecogStatus: assessment.performanceStatus || null,
              diseaseStage: assessment.diseaseStage || null,
              diagnosis: assessment.diagnosis || null,
              allergies: []
            },
            raw_data: chemo.data,
            asa_relevant_data: asaRelevantData
          };
        }

        if (res.radiotherapy) {
          const radio = res.radiotherapy;
          const data = radio.data || {};
          const intent = data.intent || {};
          const treatment = data.treatment || {};
          const sessions = data.sessions?.treatmentSessions || [];
          const chemoData = data.chemo || {};

          let fractionsCompleted = sessions.length || 0;
          let totalDoseDelivered = sessions.reduce((acc, curr) => acc + parseFloat(curr.deliveredDoseGy || 0), 0);

          radioMapped = {
            hasRecord: true,
            latestRecord: {
              treatmentIntent: intent.treatmentIntent || null,
              treatmentType: intent.treatmentSetting || treatment.treatmentType || null,
              treatmentSite: data.setup?.treatmentSite || treatment.treatmentSite || null,
              fractionsCompleted: fractionsCompleted > 0 ? fractionsCompleted : (data.sessions?.totalSessionsDelivered || 0),
              fractionsPlanned: treatment.numFractions || data.prescription?.numFractions || null,
              totalDoseDelivered: totalDoseDelivered > 0 ? totalDoseDelivered : (data.sessions?.totalDoseDeliveredGy || 0),
              totalDosePlanned: treatment.totalDose || data.prescription?.totalDose || null,
              status: radio.status || null,
              concurrentChemo: chemoData.concurrentChemotherapy || null
            },
            raw_data: radio.data
          };
        }

        setOncologyData({
          chemotherapy: chemoMapped,
          radiation: radioMapped
        });
      }).catch(err => {
        console.error("[OTRecord] Failed to fetch oncology records:", err);
      });
    }
  }, [patientId]);

  // OT schedule + conflict detection
  useEffect(() => {
    if (f.otRoom && f.surgeryDate) {
      getOTSchedule(f.otRoom, f.surgeryDate)
        .then(d => setOtSchedule(d.data || []))
        .catch(err => { console.error("[OTBookingTab] schedule fetch:", err); setOtSchedule([]); });
    } else {
      setOtSchedule([]);
    }
  }, [f.otRoom, f.surgeryDate]);

  useEffect(() => {
    if (f.startTime && f.duration && otSchedule.length > 0) {
      let hours = 0;
      const match = f.duration.match(/(\d+)\s*[Hh]our/);
      if (match) hours = parseInt(match[1]);
      else if (f.duration.includes("More than 8 Hours")) hours = 8;

      if (hours > 0 && f.startTime.includes(":")) {
        const [h, m] = f.startTime.split(":");
        const start = new Date(2000, 0, 1, parseInt(h), parseInt(m));
        const end = new Date(start.getTime() + hours * 60 * 60 * 1000);
        const startStr = f.startTime;
        const endStr = `${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}`;

        let conflict = null;
        for (const b of otSchedule) {
          if (f.bookingId && b.booking_id === f.bookingId) continue;
          if ((startStr >= b.start_time && startStr < b.end_time) ||
            (endStr > b.start_time && endStr <= b.end_time) ||
            (startStr <= b.start_time && endStr >= b.end_time)) {
            conflict = b; break;
          }
        }
        setConflictMsg(conflict ? `Conflict with another booking (${conflict.start_time} - ${conflict.end_time}).` : "");
      } else { setConflictMsg(""); }
    } else { setConflictMsg(""); }
  }, [f.startTime, f.duration, otSchedule, f.bookingId]);

  // Auto-populate patient info
  const autoPopulate = async (idToFetch) => {
    const id = typeof idToFetch === 'string' ? idToFetch : f.patientId;
    if (!id) return;
    try {
      const data = await getPatientInfo(id);
      console.log("[OTBookingTab] autoPopulate data fetched:", data); // Added logging to debug missing blood group
      setF(p => ({
        ...p,
        patientId: id,
        patientName: data.patient_name || data.name || p.patientName,
        ageSex: (data.age ? data.age + " / " : "") + (data.gender || "") || p.ageSex,
        bloodGroup: data.blood_group || data.bloodGroup || p.bloodGroup
      }));
    } catch (err) {
      console.error("[OTRecord] autoPopulate fetch:", err);
    }
  };

  useEffect(() => {
    if (patientId) autoPopulate(patientId);
  }, [patientId]);

  const asaPredictedRef = useRef(false);

  useEffect(() => {
    asaPredictedRef.current = false;
  }, [patientId]);

  useEffect(() => {
    const asaData = oncologyData?.chemotherapy?.asa_relevant_data;
    if (asaData && !asaPredictedRef.current) {
      asaPredictedRef.current = true;
      setIsPredictingAsa(true);
      predictAsaStatus(asaData)
        .then(response => {
          if (response?.data?.asaClass) {
            setF(p => ({ ...p, asaClass: response.data.asaClass }));
            setAsaReasoning(response.data.reasoning || "");
          }
        })
        .catch(err => console.error("Failed to predict ASA status:", err))
        .finally(() => setIsPredictingAsa(false));
    }
  }, [oncologyData]);

  return (
    <Box>
      <ClinicalSummaryTab patientId={patientId} doctorId={doctorId} />

      <Box sx={{ px: 3, mt: 3, mb: 1 }}>
        <TumorBoardCommonElement patientId={patientId} doctorId={doctorId} />
      </Box>

      {isPrefilling && (
        <Box sx={{ mb: 2 }}>
          <FlagNote>🤖 Analyzing latest clinical dictation and prefilling OT booking fields...</FlagNote>
        </Box>
      )}

      <SectionBox title="Primary Patient Details">
        <FG cols={3}>
          <TextField label="Patient ID *" value={f.patientId} size="small"
            onChange={e => set("patientId", e.target.value)} onBlur={autoPopulate} sx={inputSx} fullWidth />
          <ROInput label="Patient Name" value={f.patientName} />
          <ROInput label="Age / Sex" value={f.ageSex} />
          <TextField label="Ward / Bed" value={f.wardBed} size="small"
            onChange={e => set("wardBed", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., Ward 4A / Bed 12" />
          <TextField label="Unit Name" value={f.unitName} size="small"
            onChange={e => set("unitName", e.target.value)} sx={inputSx} fullWidth />
          <TextField label="Treating Doctor" value={f.treatingDoctor} size="small"
            onChange={e => set("treatingDoctor", e.target.value)} sx={inputSx} fullWidth />
        </FG>
      </SectionBox>

      {/* Cross-Module Banners */}
      {oncologyData?.chemotherapy?.hasRecord && (
        <Alert severity="info" sx={{ mb: 2, fontFamily: FONT, borderRadius: 0, border: `1px solid ${C.border}` }} icon={false} action={
          <Button color="inherit" size="small" onClick={() => setViewFullOncology({ type: 'chemotherapy', data: oncologyData.chemotherapy.raw_data })}>
            View Full Record
          </Button>
        }>
          <strong>Chemotherapy History:</strong>{' '}
          {(() => {
            const r = oncologyData.chemotherapy.latestRecord;
            const parts = [];
            if (r.selectedProtocol) {
              let p = `Patient on ${r.selectedProtocol}`;
              if (r.treatmentIntent) p += ` (${r.treatmentIntent})`;
              parts.push(p);
            } else if (r.treatmentIntent) {
              parts.push(`Intent: ${r.treatmentIntent}`);
            }

            if (r.cyclesCompleted !== undefined && r.cyclesCompleted !== null) {
              let cycles = `${r.cyclesCompleted}`;
              if (r.plannedCycles) cycles += `/${r.plannedCycles}`;
              cycles += ` cycles completed`;
              parts.push(cycles);
            }

            if (r.lastCycleDate) parts.push(`Last cycle: ${r.lastCycleDate}`);
            if (r.responseAssessment) parts.push(`Assessment: ${r.responseAssessment}`);

            return parts.length > 0 ? parts.join(" • ") : "Chemotherapy record available in Oncology module.";
          })()}
        </Alert>
      )}
      {oncologyData?.radiation?.hasRecord && (
        <Alert severity="info" sx={{ mb: 2.5, fontFamily: FONT, borderRadius: 0, border: `1px solid ${C.border}` }} icon={false} action={
          <Button color="inherit" size="small" onClick={() => setViewFullOncology({ type: 'radiation', data: oncologyData.radiation.raw_data })}>
            View Full Record
          </Button>
        }>
          <strong>Radiation History:</strong>{' '}
          {(() => {
            const r = oncologyData.radiation.latestRecord;
            const parts = [];

            let intentStr = [];
            if (r.treatmentIntent) intentStr.push(r.treatmentIntent);
            if (r.treatmentType) intentStr.push(r.treatmentType);
            if (intentStr.length > 0) {
              let s = intentStr.join(" ");
              if (r.treatmentSite) s += ` to ${r.treatmentSite}`;
              parts.push(s);
            } else if (r.treatmentSite) {
              parts.push(`Site: ${r.treatmentSite}`);
            }

            if (r.fractionsCompleted !== undefined && r.fractionsCompleted !== null && r.fractionsCompleted !== 0) {
              let frac = `${r.fractionsCompleted}`;
              if (r.fractionsPlanned) frac += `/${r.fractionsPlanned}`;
              frac += ` fractions`;

              if (r.totalDoseDelivered !== undefined && r.totalDoseDelivered !== null && r.totalDoseDelivered !== 0) {
                let dose = `${r.totalDoseDelivered}`;
                if (r.totalDosePlanned) dose += `/${r.totalDosePlanned}`;
                dose += ` Gy`;
                frac += ` (${dose})`;
              }
              parts.push(frac);
            }

            if (r.status) parts.push(`Status: ${r.status}`);
            if (r.concurrentChemo === "yes") parts.push(`Concurrent Chemo`);

            return parts.length > 0 ? parts.join(" • ") : "Radiotherapy record available in Oncology module.";
          })()}
        </Alert>
      )}
      <Box sx={{ px: 3, mb: 3 }}>
        <Button
          fullWidth
          onClick={() => setStructuredNoteExpanded(v => !v)}
          sx={{
            justifyContent: "space-between",
            textTransform: "none",
            background: C.black,
            color: C.white,
            borderRadius: structuredNoteExpanded ? "4px 4px 0 0" : "4px",
            px: 2.5,
            py: 1.5,
            "&:hover": { background: "#222" }
          }}
        >
          <Typography sx={{ fontSize: 14.5, fontWeight: FW_BOLD, letterSpacing: "0.02em", textTransform: "uppercase", color: C.white, fontFamily: FONT }}>
            Clinical Structured Note
          </Typography>
          <Typography sx={{ fontSize: 13, color: C.white, fontFamily: FONT }}>
            {structuredNoteExpanded ? "▲ Collapse" : "▼ Expand"}
          </Typography>
        </Button>
        {structuredNoteExpanded && (
          <Box sx={{ border: `1px solid ${C.border}`, borderTop: "none", borderRadius: "0 0 4px 4px", background: C.white, p: 2 }}>
            <StructuredNotePanel
              doctorId={doctorId}
              patientId={patientId}

            />
          </Box>
        )}
      </Box>
      <SectionBox title="Surgery Classification">
        <FG cols={3}>
          <Box>
            <Sel label="Case Status" value={f.caseStatus} onChange={v => set("caseStatus", v)}
              options={["Minor", "Elective", "Emergency", "Re-Exploration"]} />
            {oncologyData?.radiation?.latestRecord?.concurrentChemo === "yes" && (
              <FlagNote>⚠️ Concurrent Chemo-RT in progress</FlagNote>
            )}
          </Box>
          <Box><CbxGroup label="Type of Surgery" options={["Primary", "Adjunct", "Reconstructive"]}
            value={f.surgeryType} onChange={v => set("surgeryType", v)} /></Box>
          <Box><RdoGroup label="Laterality" options={["Right", "Left", "Bilateral", "Not Applicable"]}
            value={f.laterality} onChange={v => set("laterality", v)} /></Box>
          <Box sx={{ gridColumn: "1/-1" }}>
            <Autocomplete
              freeSolo
              options={PROCEDURES}
              value={f.procedureName}
              onChange={(e, newValue) => set("procedureName", newValue || "")}
              onInputChange={(e, newInputValue) => set("procedureName", newInputValue || "")}
              renderInput={(params) => (
                <TextField {...params} label="Name of Procedure" size="small" sx={inputSx} fullWidth />
              )}
            />
          </Box>
          <Box><CbxGroup label="Approach" options={["Open", "Laparoscopic", "Robotic"]}
            value={f.approach} onChange={v => set("approach", v)} /></Box>
          <Sel label="Estimated Duration" value={f.duration} onChange={v => set("duration", v)}
            options={["1 Hour", "2 Hours", "3 Hours", "4 Hours", "5 Hours", "6 Hours", "7 Hours", "More than 8 Hours"]} />
        </FG>
      </SectionBox>

      <SectionBox title="Scheduling & Resources">
        <FG cols={4}>
          <TextField label="Date of Surgery" type="date" value={f.surgeryDate} size="small"
            onChange={e => set("surgeryDate", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
          <Sel label="OT Room Number" value={f.otRoom} onChange={v => set("otRoom", v)} options={OT_ROOMS} />
          <TextField label="Estimated Start Time" type="time" value={f.startTime} size="small"
            onChange={e => set("startTime", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
          <Sel label="Primary Surgeon" value={f.surgeonName} onChange={v => set("surgeonName", v)} options={surgeonList} />
          <Box sx={{ gridColumn: "1/-1" }}>
            <TextField label="Pre-Operative Diagnosis" value={f.preOpDiagnosis} size="small"
              multiline rows={3} onChange={e => set("preOpDiagnosis", e.target.value)} sx={inputSx} fullWidth />
            {oncologyData?.chemotherapy?.latestRecord?.diagnosis && (
              <Box sx={{ mt: 1, display: 'flex', gap: 2 }}>
                <FlagNote>ℹ️ Disease Stage from Oncology: {oncologyData.chemotherapy.latestRecord.diseaseStage}</FlagNote>
                {f.preOpDiagnosis && f.preOpDiagnosis.toLowerCase() !== oncologyData.chemotherapy.latestRecord.diagnosis.toLowerCase() && (
                  <FlagNote>⚠️ Oncology Diagnosis: {oncologyData.chemotherapy.latestRecord.diagnosis} (Cross-check needed)</FlagNote>
                )}
                {f.preOpDiagnosis && f.preOpDiagnosis.toLowerCase() === oncologyData.chemotherapy.latestRecord.diagnosis.toLowerCase() && (
                  <FlagNote>✅ Diagnosis matches Oncology Record</FlagNote>
                )}
              </Box>
            )}
          </Box>
        </FG>
        {f.otRoom && f.surgeryDate && (
          <Box sx={{ mt: 2, p: 1.5, background: C.bgSecondary, border: `1px solid ${C.border}` }}>
            <Typography sx={{ fontSize: 12, fontWeight: FW_NORMAL, fontFamily: FONT, mb: 1, textTransform: "uppercase" }}>
              {f.otRoom} Schedule for {f.surgeryDate}
            </Typography>
            {otSchedule.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>No bookings for this date. Room is fully available.</Typography>
            ) : (
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
                {otSchedule.map((b, i) => (
                  <Box key={i} sx={{ px: 1, py: 0.5, background: C.white, border: `1px solid ${C.border}`, fontSize: 11, fontFamily: FONT, borderRadius: 1 }}>
                    <strong>{b.start_time} - {b.end_time}</strong>
                    {b.booking_id === f.bookingId ? " (This Booking)" : ` [${b.status}]`}
                  </Box>
                ))}
              </Box>
            )}
            {conflictMsg && (
              <Alert severity="error" sx={{ mt: 1.5, p: 0, px: 1, '& .MuiAlert-message': { py: 0.5 }, fontSize: 12, fontFamily: FONT, borderRadius: 0, border: `1px solid ${C.border}` }}>
                <strong>Slot Unavailable:</strong> {conflictMsg}
              </Alert>
            )}
            {!conflictMsg && f.startTime && f.duration && (
              <Alert severity="success" sx={{ mt: 1.5, p: 0, px: 1, '& .MuiAlert-message': { py: 0.5 }, fontSize: 12, fontFamily: FONT, borderRadius: 0, border: `1px solid ${C.border}` }} icon={false}>
                ✅ Time slot is available.
              </Alert>
            )}
          </Box>
        )}
      </SectionBox>

      <SectionBox title="Pre-Operative Assessment">
        <FG cols={3}>
          <Box><CbxGroup label="Viral Markers" options={["HBsAg", "HCV", "HIV", "COVID"]}
            value={f.viralMarkers} onChange={v => set("viralMarkers", v)} /></Box>
          <Box>
            <RdoGroup label="Insurance" options={["Yes", "No"]} value={f.insurance} onChange={v => set("insurance", v)} />
            {f.insurance === "Yes" && (
              <Box sx={{ mt: 1 }}>
                <CbxGroup label="Type of Insurance"
                  options={["State Insurance", "Private Insurance", "Ayushman Bharat"]}
                  value={f.insuranceType} onChange={v => set("insuranceType", v)} />
              </Box>
            )}
          </Box>
          <Box>
            <TextField label="ASA Physical Status Class" value={f.asaClass} size="small"
              onChange={e => set("asaClass", e.target.value)} sx={inputSx} fullWidth />
            {isPredictingAsa && (
              <Typography sx={{ fontSize: 11, color: C.textMuted, mt: 0.5, fontStyle: 'italic', fontFamily: FONT }}>🤖 Auto-predicting ASA class...</Typography>
            )}
            {asaReasoning && (
              <FlagNote>🤖 AI Reasoning: {asaReasoning}</FlagNote>
            )}
            {oncologyData?.chemotherapy?.latestRecord?.ecogStatus && (
              <FlagNote>ℹ️ Latest ECOG: {oncologyData.chemotherapy.latestRecord.ecogStatus} (from Chemo)</FlagNote>
            )}
          </Box>
          <Box><RdoGroup label="High Risk MDT" options={["Yes", "No", "Not Applicable"]}
            value={f.highRiskMDT} onChange={v => set("highRiskMDT", v)} /></Box>
          {f.highRiskMDT === "Yes" && (
            <Box sx={{ gridColumn: "1/-1" }}>
              <TextField label="MDT Comments" value={f.mdtComments} size="small"
                multiline rows={3} onChange={e => set("mdtComments", e.target.value)}
                sx={inputSx} fullWidth placeholder="Enter MDT discussion details" />
            </Box>
          )}
          <Box><TextField label="Blood Group" value={f.bloodGroup} size="small"
            onChange={e => set("bloodGroup", e.target.value)} sx={inputSx} fullWidth /></Box>
          <Box><RdoGroup label="Any Past Transfusions?" options={["Yes", "No"]}
            value={f.pastTransfusion} onChange={v => set("pastTransfusion", v)} /></Box>
          {f.pastTransfusion === "Yes" && (
            <Box sx={{ gridColumn: "1/-1" }}>
              <FG cols={2}>
                <Box><RdoGroup label="History of Transfusion Reactions?"
                  options={["Yes", "No"]} value={f.transfusionReaction}
                  onChange={v => set("transfusionReaction", v)} /></Box>
                {f.transfusionReaction === "Yes" && (
                  <TextField label="Details about Reaction" value={f.reactionDetails} size="small"
                    multiline rows={2} onChange={e => set("reactionDetails", e.target.value)}
                    sx={inputSx} fullWidth placeholder="Describe transfusion reaction" />
                )}
              </FG>
            </Box>
          )}
          <Box sx={{ gridColumn: "1/-1" }}>
            <TextField label="Remarks (Equipment / Position / Special requirements)"
              value={f.remarks} size="small" multiline rows={3}
              onChange={e => set("remarks", e.target.value)} sx={inputSx} fullWidth />
            {oncologyData?.chemotherapy?.latestRecord?.allergies?.length > 0 && (
              <Box sx={{ mt: 1 }}>
                {oncologyData.chemotherapy.latestRecord.allergies.map((al, idx) => (
                  <Alert key={idx} severity="error" sx={{ py: 0, px: 1, '& .MuiAlert-message': { py: 0.5 }, fontSize: 12, fontFamily: FONT, borderRadius: 0, border: `1px solid ${C.border}`, mb: 0.5 }}>
                    <strong>Allergy Alert:</strong> {al.drug} — {al.type} — {al.severity} (from Chemo record)
                  </Alert>
                ))}
              </Box>
            )}
          </Box>
        </FG>
      </SectionBox>

      <Box sx={{ display: "flex", gap: 1 }}>
        <Button sx={{ ...saveBtnSx, opacity: conflictMsg ? 0.5 : 1 }} disabled={!!conflictMsg} onClick={() => onSave("ot-booking", f)}>
          <SaveRounded sx={{ mr: 0.5, fontSize: 14 }} /> {onCancel ? "Update Booking" : "Save Booking"}
        </Button>
        {onCancel ? (
          <Button sx={outlineBtnSx} onClick={onCancel}>Cancel</Button>
        ) : (
          <Button sx={outlineBtnSx} onClick={() => setF(p => ({ ...p, patientId: "", patientName: "", ageSex: "", bookingId: undefined }))}>
            Reset
          </Button>
        )}
      </Box>

      {/* Full Oncology Record Dialog */}
      {viewFullOncology && (
        <Dialog open={true} onClose={() => setViewFullOncology(null)} maxWidth="md" fullWidth>
          <DialogTitle sx={{ fontFamily: FONT, fontSize: 14, fontWeight: FW_BOLD, background: C.bgPrimary, borderBottom: `1px solid ${C.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            {viewFullOncology.type === 'chemotherapy' ? "Full Chemotherapy Record" : "Full Radiation Record"}
            <IconButton size="small" onClick={() => setViewFullOncology(null)}><CloseRounded fontSize="small" /></IconButton>
          </DialogTitle>
          <DialogContent sx={{ p: 2, background: C.white }}>
            {viewFullOncology.type === 'chemotherapy' && viewFullOncology.data && (
              <Box>
                {viewFullOncology.data.assessment && (
                  <SectionBox title="Assessment">
                    <FG cols={3}>
                      <ROInput label="Diagnosis" value={viewFullOncology.data.assessment.diagnosis} />
                      <ROInput label="Disease Stage" value={viewFullOncology.data.assessment.diseaseStage} />
                      <ROInput label="Performance Status" value={viewFullOncology.data.assessment.performanceStatus} />
                      <ROInput label="Cardiac Function" value={viewFullOncology.data.assessment.cardiacFunction} />
                      <ROInput label="Hepatic Function" value={viewFullOncology.data.assessment.hepaticFunction} />
                      <ROInput label="Renal Function" value={viewFullOncology.data.assessment.renalFunction} />
                    </FG>
                  </SectionBox>
                )}
                {viewFullOncology.data.cycles && Object.keys(viewFullOncology.data.cycles).length > 0 && (
                  <SectionBox title="Treatment Cycles">
                    <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ background: C.bgSecondary }}>
                            <TableCell sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textMuted }}>Cycle No</TableCell>
                            <TableCell sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textMuted }}>Date</TableCell>
                            <TableCell sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textMuted }}>Drugs / Admin</TableCell>
                            <TableCell sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textMuted }}>Status</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {Object.entries(viewFullOncology.data.cycles).map(([cycleNum, cycleData]) => (
                            <TableRow key={cycleNum}>
                              <TableCell sx={{ fontSize: 11 }}>{cycleNum}</TableCell>
                              <TableCell sx={{ fontSize: 11 }}>{cycleData.cycle_admin?.cycleDate1 || "-"}</TableCell>
                              <TableCell sx={{ fontSize: 11 }}>{cycleData.cycle_admin?.cycleDrugs1 || cycleData.prep?.calculatedDose || "-"}</TableCell>
                              <TableCell sx={{ fontSize: 11 }}>{cycleData.cycle_admin?.cycleCompleted || "Completed"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                )}
              </Box>
            )}

            {viewFullOncology.type === 'radiation' && viewFullOncology.data && (
              <Box>
                {viewFullOncology.data.intent && (
                  <SectionBox title="Intent & Setup">
                    <FG cols={3}>
                      <ROInput label="Treatment Intent" value={viewFullOncology.data.intent.treatmentIntent} />
                      <ROInput label="Treatment Setting" value={viewFullOncology.data.intent.treatmentSetting} />
                      <ROInput label="Treatment Site" value={viewFullOncology.data.setup?.treatmentSite} />
                      <ROInput label="Positioning" value={viewFullOncology.data.setup?.patientPositioning} />
                    </FG>
                  </SectionBox>
                )}
                {viewFullOncology.data.treatment && (
                  <SectionBox title="Treatment Details">
                    <FG cols={3}>
                      <ROInput label="Treatment Type" value={viewFullOncology.data.treatment.treatmentType} />
                      <ROInput label="Total Dose" value={viewFullOncology.data.treatment.totalDose} />
                      <ROInput label="Fractions" value={viewFullOncology.data.treatment.numFractions} />
                    </FG>
                  </SectionBox>
                )}
                {viewFullOncology.data.sessions?.treatmentSessions?.length > 0 && (
                  <SectionBox title="Sessions Delivered">
                    <TableContainer sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}>
                      <Table size="small">
                        <TableHead>
                          <TableRow sx={{ background: C.bgSecondary }}>
                            <TableCell sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textMuted }}>Fraction No</TableCell>
                            <TableCell sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textMuted }}>Date</TableCell>
                            <TableCell sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textMuted }}>Delivered Dose</TableCell>
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {viewFullOncology.data.sessions.treatmentSessions.map((s, i) => (
                            <TableRow key={i}>
                              <TableCell sx={{ fontSize: 11 }}>{s.fractionNumber || i + 1}</TableCell>
                              <TableCell sx={{ fontSize: 11 }}>{s.date || "-"}</TableCell>
                              <TableCell sx={{ fontSize: 11 }}>{s.deliveredDoseGy ? `${s.deliveredDoseGy} Gy` : "-"}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </SectionBox>
                )}
              </Box>
            )}

            {!viewFullOncology.data && (
              <Typography sx={{ fontSize: 12, color: C.textMuted }}>No structured data available.</Typography>
            )}
          </DialogContent>
          <DialogActions sx={{ p: 1.5, borderTop: `1px solid ${C.border}`, background: C.bgPrimary }}>
            <Button sx={outlineBtnSx} onClick={() => setViewFullOncology(null)}>Close</Button>
          </DialogActions>
        </Dialog>
      )}
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 2 — OT WORKLIST (Part B)
// ─────────────────────────────────────────────────────────────────────────────
const OTWorklistTab = ({ doctorId, patientId, hospitalId, onEditBooking, refetchBookings }) => {
  const [filters, setFilters] = useState({ fromDate: "", toDate: "", status: "All", otRoom: "All" });
  const [appliedFilters, setAppliedFilters] = useState({ fromDate: "", toDate: "", status: "All", otRoom: "All" });
  const [worklist, setWorklist] = useState([]);
  const [viewDialog, setViewDialog] = useState({ open: false, data: null });
  const [isEditMode, setIsEditMode] = useState(false);
  const [surgeonMap, setSurgeonMap] = useState({});
  const [cancelDialog, setCancelDialog] = useState({ open: false, bookingId: null, reason: "" });
  const [postponeDialog, setPostponeDialog] = useState({ open: false, bookingId: null, reason: "", newDate: "" });
  const [priorityDialog, setPriorityDialog] = useState({ open: false, bookingId: null, priority: "", justification: "" });

  const sf = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  useEffect(() => {
    if (!hospitalId) return;
    getDoctorsByHospital(hospitalId)
      .then(d => {
        if (Array.isArray(d)) {
          const map = {};
          d.forEach(doc => map[doc.sys_user_id] = doc.name);
          setSurgeonMap(map);
        }
      })
      .catch(err => console.error("[OTWorklistTab] surgeonMap fetch error:", err));
  }, [hospitalId]);

  const fetchWorklist = () => {
    if (!doctorId) return;
    getBookings(doctorId, { patient_id: patientId || undefined })
      .then(d => { if (d?.bookings) setWorklist(d.bookings); })
      .catch(err => console.error("[OTWorklistTab] fetch error:", err));
  };

  useEffect(() => { fetchWorklist(); }, [doctorId, patientId]);

  const handleUpdateStatus = async (bookingId, status) => {
    try {
      await updateBookingStatus(bookingId, status);
      fetchWorklist();
      if (refetchBookings) refetchBookings();
    } catch (err) { console.error(err); }
  };

  const handleSetActive = async (patientId, bookingId) => {
    try {
      await setActiveBooking(patientId, bookingId);
      fetchWorklist();
      if (refetchBookings) refetchBookings();
    } catch (err) { console.error(err); }
  };

  const handleCancelBooking = async () => {
    try {
      if (!cancelDialog.reason.trim()) {
        alert("Please enter a cancellation reason.");
        return;
      }
      const bRes = await getBooking(cancelDialog.bookingId);
      const currentBookingData = bRes.data?.booking || {};
      await updateBooking(cancelDialog.bookingId, { ...currentBookingData, cancellationReason: cancelDialog.reason });
      await updateBookingStatus(cancelDialog.bookingId, "Cancelled");
      setCancelDialog({ open: false, bookingId: null, reason: "" });
      fetchWorklist();
      if (refetchBookings) refetchBookings();
    } catch (err) { console.error(err); }
  };

  const handleUpdatePriority = async () => {
    try {
      if (!priorityDialog.priority) {
        alert("Please enter a priority.");
        return;
      }
      const bRes = await getBooking(priorityDialog.bookingId);
      const currentBookingData = bRes.data?.booking || {};
      await updateBooking(priorityDialog.bookingId, {
        ...currentBookingData,
        priority: priorityDialog.priority,
        priorityJustification: priorityDialog.justification
      });
      setPriorityDialog({ open: false, bookingId: null, priority: "", justification: "" });
      fetchWorklist();
      if (refetchBookings) refetchBookings();
    } catch (err) { console.error(err); }
  };

  const handlePostponeBooking = async () => {
    try {
      if (!postponeDialog.reason.trim()) { alert("Please enter a reason."); return; }
      if (!postponeDialog.newDate) { alert("Please select a new date."); return; }
      const bRes = await getBooking(postponeDialog.bookingId);
      const currentBookingData = bRes.data?.booking || {};
      await updateBooking(postponeDialog.bookingId, {
        ...currentBookingData,
        postponeReason: postponeDialog.reason,
        originalSurgeryDate: currentBookingData.originalSurgeryDate || currentBookingData.surgeryDate,
        surgeryDate: postponeDialog.newDate,
        isPostponed: true,
        postponeHistory: [
          ...(currentBookingData.postponeHistory || []),
          {
            oldDate: currentBookingData.surgeryDate,
            newDate: postponeDialog.newDate,
            reason: postponeDialog.reason,
            timestamp: new Date().toISOString()
          }
        ]
      });
      await updateBookingStatus(postponeDialog.bookingId, "Postponed");
      setPostponeDialog({ open: false, bookingId: null, reason: "", newDate: "" });
      fetchWorklist();
      if (refetchBookings) refetchBookings();
    } catch (err) { console.error(err); }
  };

  const thStyle = { ...thSx, whiteSpace: "nowrap" };
  const tdStyle = { ...tdSx, whiteSpace: "nowrap" };

  return (
    <Box>
      <SectionBox title="Filters">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-end" }}>
          <TextField label="From Date" type="date" size="small" value={filters.fromDate}
            onChange={e => sf("fromDate", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
          <TextField label="To Date" type="date" size="small" value={filters.toDate}
            onChange={e => sf("toDate", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
          <Sel label="Status" value={filters.status} onChange={v => sf("status", v)} minWidth={140}
            options={["All", "Completed", "Cancelled", "Pending", "In Progress", "Postponed"]} />
          <Sel label="OT Room" value={filters.otRoom} onChange={v => sf("otRoom", v)} minWidth={130}
            options={["All", ...OT_ROOMS]} />
          <Button sx={saveBtnSx} onClick={() => setAppliedFilters(filters)}>Apply Filters</Button>
        </Box>
      </SectionBox>

      <SectionBox title="Surgery Schedule (Upcoming / In Progress)">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {["SNo", "Patient ID", "Patient Name", "Age/Sex", "Procedure", "Surgeon", "OT Room", "Date", "Status", "Priority", "Actions"].map(h => (
                  <TableCell key={h} sx={thSx}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {worklist.filter(row => {
                if (appliedFilters.status !== "All" && row.status !== appliedFilters.status) return false;
                if (appliedFilters.otRoom !== "All" && row.otRoom !== appliedFilters.otRoom) return false;
                if (appliedFilters.fromDate && row.date && row.date < appliedFilters.fromDate) return false;
                if (appliedFilters.toDate && row.date && row.date > appliedFilters.toDate) return false;
                if (row.status === "Completed" || row.status === "Cancelled") return false;
                return true;
              }).map((row, i) => (
                <TableRow key={i} sx={{ "&:hover": { background: C.bgSecondary } }}>
                  <TableCell sx={tdStyle}>{row.sno}</TableCell>
                  <TableCell sx={tdStyle}>{row.patient_id}</TableCell>
                  <TableCell sx={tdStyle}>{row.patientName}</TableCell>
                  <TableCell sx={tdStyle}>{row.ageSex}</TableCell>
                  <TableCell sx={{ ...tdStyle, whiteSpace: "normal" }}>{row.procedure}</TableCell>
                  <TableCell sx={tdStyle}>{row.surgeon}</TableCell>
                  <TableCell sx={tdStyle}>{row.otRoom}</TableCell>
                  <TableCell sx={tdStyle}>
                    {row.fullBooking.isPostponed && row.fullBooking.originalSurgeryDate ? (
                      <Box>
                        {(() => {
                           const pCount = row.fullBooking.postponeHistory ? row.fullBooking.postponeHistory.length : 1;
                           return (
                             <Typography sx={{ textDecoration: 'line-through', color: C.textMuted, fontSize: 11 }}>
                               {row.fullBooking.originalSurgeryDate}
                               {pCount > 1 && ` (${pCount} times)`}
                             </Typography>
                           );
                        })()}
                        <Typography sx={{ fontSize: 13 }}>{row.date}</Typography>
                        {row.fullBooking.postponeReason && (
                          <Tooltip title={row.fullBooking.postponeReason} placement="top">
                            <Typography sx={{
                              fontSize: 11,
                              color: C.textSecond,
                              mt: 0.5,
                              background: C.bgTertiary,
                              px: 1,
                              py: 0.5,
                              borderRadius: 1,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                              maxWidth: 180,
                              cursor: 'help'
                            }}>
                              {row.fullBooking.postponeReason}
                            </Typography>
                          </Tooltip>
                        )}
                      </Box>
                    ) : (
                      row.date
                    )}
                  </TableCell>
                  <TableCell sx={tdStyle}>
                    {(() => {
                      const isPast = new Date(row.date) < new Date(new Date().toDateString());
                      const isDelayed = (row.status === "Pending" || row.status === "In Progress" || row.status === "Postponed") && isPast;
                      // "Postponed" is a display concern: keep it as the primary badge only
                      // while the rescheduled date is still in the future. Once the date has
                      // arrived, show the case as due (Pending) but keep a persistent
                      // "Was Postponed" marker so the history isn't lost. Action buttons
                      // continue to key off the stored row.status, so they are unaffected.
                      const info = getPostponeInfo({ status: row.status, booking: row.fullBooking });
                      const displayStatus = (info.isPostponed && !info.isFuture) ? "Pending" : row.status;
                      return (
                        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 0.5 }}>
                          <StatusBadge status={displayStatus} />
                          {info.isPostponed && !info.isFuture && <WasPostponedTag count={info.postponeCount} />}
                          {isDelayed && (
                            <Typography sx={{ fontSize: 10, color: '#cf1322', fontWeight: FW_BOLD, px: 0.5, py: 0.1, border: '1px solid #ffa39e', background: '#fff1f0', borderRadius: 0 }}>DELAYED</Typography>
                          )}
                        </Box>
                      );
                    })()}
                  </TableCell>
                  <TableCell sx={tdStyle}>
                    {row.priorityJustification ? (
                      <Box>
                        <Typography sx={{ fontSize: 13 }}>{row.priority}</Typography>
                        <Tooltip title={row.priorityJustification} placement="top">
                          <Typography sx={{
                            fontSize: 11,
                            color: C.textSecond,
                            mt: 0.5,
                            background: C.bgTertiary,
                            px: 1,
                            py: 0.5,
                            borderRadius: 1,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            maxWidth: 180,
                            cursor: 'help'
                          }}>
                            {row.priorityJustification}
                          </Typography>
                        </Tooltip>
                      </Box>
                    ) : (
                      row.priority
                    )}
                  </TableCell>
                  <TableCell sx={tdStyle}>
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      {row.is_active ? (
                        <Button size="small" disabled sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, color: 'success.main', borderColor: 'success.main', opacity: 1, fontWeight: 'bold' }}>
                          Active
                        </Button>
                      ) : (
                        <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, color: 'info.main', borderColor: 'info.main' }}
                          onClick={() => handleSetActive(row.patient_id, row.booking_id)}>
                          Select
                        </Button>
                      )}
                      <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }}
                        onClick={() => setViewDialog({ open: true, data: row })}>
                        View
                      </Button>
                      {row.status === "Pending" && (
                        <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }}
                          onClick={() => handleUpdateStatus(row.booking_id, "In Progress")}>
                          Approve
                        </Button>
                      )}
                      <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }}
                        onClick={() => setPriorityDialog({ open: true, bookingId: row.booking_id, priority: row.priority || "", justification: row.priorityJustification || "" })}>
                        Edit Priority
                      </Button>
                      {(row.status === "Pending" || row.status === "In Progress" || row.status === "Postponed") && (
                        <>
                          <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, color: 'warning.main', borderColor: 'warning.main' }}
                            onClick={() => setPostponeDialog({ open: true, bookingId: row.booking_id, reason: "", newDate: row.date })}>
                            Postpone
                          </Button>
                          <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, color: 'error.main', borderColor: 'error.main' }}
                            onClick={() => setCancelDialog({ open: true, bookingId: row.booking_id, reason: "" })}>
                            Cancel
                          </Button>
                        </>
                      )}
                      {row.status === "In Progress" && (
                        <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }}
                          onClick={() => handleUpdateStatus(row.booking_id, "Completed")}>
                          Complete
                        </Button>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>

      <SectionBox title="Completed Procedures">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {["SNo", "Patient ID", "Patient Name", "Age/Sex", "Procedure", "Surgeon", "OT Room", "Date", "Status", "Priority", "Actions"].map((h, idx) => (
                  <TableCell key={h} sx={{ ...thStyle, minWidth: h === "Procedure" ? 180 : h === "Surgeon" ? 140 : 'auto' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {worklist.filter(row => {
                if (appliedFilters.status !== "All" && row.status !== appliedFilters.status) return false;
                if (appliedFilters.otRoom !== "All" && row.otRoom !== appliedFilters.otRoom) return false;
                if (appliedFilters.fromDate && row.date && row.date < appliedFilters.fromDate) return false;
                if (appliedFilters.toDate && row.date && row.date > appliedFilters.toDate) return false;
                if (row.status !== "Completed") return false;
                return true;
              }).map((row, i) => (
                <TableRow key={i} sx={{ "&:hover": { background: C.bgSecondary } }}>
                  <TableCell sx={tdStyle}>{row.sno}</TableCell>
                  <TableCell sx={tdStyle}>{row.patient_id}</TableCell>
                  <TableCell sx={tdStyle}>{row.patientName}</TableCell>
                  <TableCell sx={tdStyle}>{row.ageSex}</TableCell>
                  <TableCell sx={{ ...tdStyle, whiteSpace: "normal" }}>{row.procedure}</TableCell>
                  <TableCell sx={tdStyle}>{row.surgeon}</TableCell>
                  <TableCell sx={tdStyle}>{row.otRoom}</TableCell>
                  <TableCell sx={tdStyle}>{row.date}</TableCell>
                  <TableCell sx={tdStyle}><StatusBadge status={row.status} /></TableCell>
                  <TableCell sx={tdStyle}>
                    {row.priorityJustification ? (
                      <Box>
                        <Typography sx={{ fontSize: 13 }}>{row.priority}</Typography>
                        <Tooltip title={row.priorityJustification} placement="top">
                          <Typography sx={{
                            fontSize: 11,
                            color: C.textSecond,
                            mt: 0.5,
                            background: C.bgTertiary,
                            px: 1,
                            py: 0.5,
                            borderRadius: 1,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                            maxWidth: 180,
                            cursor: 'help'
                          }}>
                            {row.priorityJustification}
                          </Typography>
                        </Tooltip>
                      </Box>
                    ) : (
                      row.priority
                    )}
                  </TableCell>
                  <TableCell sx={tdStyle}>
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      {row.is_active ? (
                        <Button size="small" disabled sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, color: 'success.main', borderColor: 'success.main', opacity: 1, fontWeight: 'bold' }}>
                          Active
                        </Button>
                      ) : (
                        <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, color: 'info.main', borderColor: 'info.main' }}
                          onClick={() => handleSetActive(row.patient_id, row.booking_id)}>
                          Select
                        </Button>
                      )}
                      <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }}
                        onClick={() => setViewDialog({ open: true, data: row })}>
                        View Procedure
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>

      <SectionBox title="Cancelled Procedures">
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                {["SNo", "Patient ID", "Patient Name", "Age/Sex", "Procedure", "Surgeon", "Date", "Status", "Cancellation Reason", "Actions"].map((h, idx) => (
                  <TableCell key={h} sx={{ ...thStyle, minWidth: h === "Procedure" ? 180 : h === "Surgeon" ? 140 : h === "Cancellation Reason" ? 200 : 'auto' }}>{h}</TableCell>
                ))}
              </TableRow>
            </TableHead>
            <TableBody>
              {worklist.filter(row => {
                if (appliedFilters.status !== "All" && row.status !== appliedFilters.status) return false;
                if (appliedFilters.otRoom !== "All" && row.otRoom !== appliedFilters.otRoom) return false;
                if (appliedFilters.fromDate && row.date && row.date < appliedFilters.fromDate) return false;
                if (appliedFilters.toDate && row.date && row.date > appliedFilters.toDate) return false;
                if (row.status !== "Cancelled") return false;
                return true;
              }).map((row, i) => (
                <TableRow key={i} sx={{ "&:hover": { background: C.bgSecondary } }}>
                  <TableCell sx={tdStyle}>{row.sno}</TableCell>
                  <TableCell sx={tdStyle}>{row.patient_id}</TableCell>
                  <TableCell sx={tdStyle}>{row.patientName}</TableCell>
                  <TableCell sx={tdStyle}>{row.ageSex}</TableCell>
                  <TableCell sx={{ ...tdStyle, whiteSpace: "normal" }}>{row.procedure}</TableCell>
                  <TableCell sx={tdStyle}>{row.surgeon}</TableCell>
                  <TableCell sx={tdStyle}>{row.date}</TableCell>
                  <TableCell sx={tdStyle}><StatusBadge status={row.status} /></TableCell>
                  <TableCell sx={{ ...tdStyle, whiteSpace: "normal" }}>{row.cancellationReason || "-"}</TableCell>
                  <TableCell sx={tdStyle}>
                    <Box sx={{ display: "flex", gap: 0.5, flexWrap: "wrap" }}>
                      <Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }}
                        onClick={() => setViewDialog({ open: true, data: row })}>
                        View Procedure
                      </Button>
                    </Box>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>

      {/* Cancel Booking Dialog */}
      <Dialog open={cancelDialog.open} onClose={() => setCancelDialog({ open: false, bookingId: null, reason: "" })} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 16, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          Cancel Booking
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          <Typography sx={{ mb: 2, fontSize: 13, fontFamily: FONT }}>Are you sure you want to cancel this booking? Please provide a reason.</Typography>
          <TextField
            fullWidth
            size="small"
            label="Cancellation Reason"
            multiline
            rows={3}
            value={cancelDialog.reason}
            onChange={(e) => setCancelDialog(p => ({ ...p, reason: e.target.value }))}
            sx={inputSx}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: `1px solid ${C.border}`, background: C.bgPrimary }}>
          <Button sx={outlineBtnSx} onClick={() => setCancelDialog({ open: false, bookingId: null, reason: "" })}>Back</Button>
          <Button sx={{ ...saveBtnSx, background: 'red' }} onClick={handleCancelBooking}>Confirm Cancel</Button>
        </DialogActions>
      </Dialog>

      {/* Postpone Booking Dialog */}
      <Dialog open={postponeDialog.open} onClose={() => setPostponeDialog({ open: false, bookingId: null, reason: "", newDate: "" })} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 16, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          Postpone Surgery
        </DialogTitle>
        <DialogContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth
            size="small"
            label="New Date"
            type="date"
            InputLabelProps={{ shrink: true }}
            value={postponeDialog.newDate}
            onChange={(e) => setPostponeDialog(p => ({ ...p, newDate: e.target.value }))}
            sx={{ ...inputSx, mt: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Reason for Postponement"
            multiline
            rows={3}
            value={postponeDialog.reason}
            onChange={(e) => setPostponeDialog(p => ({ ...p, reason: e.target.value }))}
            sx={inputSx}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: `1px solid ${C.border}`, background: C.bgPrimary }}>
          <Button sx={outlineBtnSx} onClick={() => setPostponeDialog({ open: false, bookingId: null, reason: "", newDate: "" })}>Cancel</Button>
          <Button sx={saveBtnSx} onClick={handlePostponeBooking}>Postpone</Button>
        </DialogActions>
      </Dialog>

      {/* Edit Priority Dialog */}
      <Dialog open={priorityDialog.open} onClose={() => setPriorityDialog({ open: false, bookingId: null, priority: "", justification: "" })} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 16, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          Edit Priority
        </DialogTitle>
        <DialogContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth
            size="small"
            label="Priority (Numerical)"
            type="number"
            value={priorityDialog.priority}
            onChange={(e) => setPriorityDialog(p => ({ ...p, priority: e.target.value }))}
            sx={{ ...inputSx, mt: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Priority Justification"
            multiline
            rows={3}
            value={priorityDialog.justification}
            onChange={(e) => setPriorityDialog(p => ({ ...p, justification: e.target.value }))}
            sx={inputSx}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: `1px solid ${C.border}`, background: C.bgPrimary }}>
          <Button sx={outlineBtnSx} onClick={() => setPriorityDialog({ open: false, bookingId: null, priority: "", justification: "" })}>Cancel</Button>
          <Button sx={saveBtnSx} onClick={handleUpdatePriority}>Save Priority</Button>
        </DialogActions>
      </Dialog>

      {/* View/Edit Dialog */}
      <Dialog open={viewDialog.open} onClose={() => { setViewDialog({ open: false, data: null }); setIsEditMode(false); }} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>{isEditMode ? "Edit Booking Details" : "Booking Details"}</Typography>
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            {!isEditMode && (
              <Button size="small" sx={{ ...outlineBtnSx, py: 0.4 }} onClick={() => setIsEditMode(true)}>Edit</Button>
            )}
            <IconButton onClick={() => { setViewDialog({ open: false, data: null }); setIsEditMode(false); }} size="small">
              <CloseRounded />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 3, fontFamily: FONT, display: 'flex', flexDirection: 'column', gap: 3 }}>
          {viewDialog.data && !isEditMode && (() => {
            const fb = viewDialog.data.fullBooking || viewDialog.data;
            return (
              <>
                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, mb: 1.5 }}>Primary Patient Details</Typography>
                  <FG cols={3}>
                    <ROInput label="Patient Name" value={fb.patientName} />
                    <ROInput label="Age / Sex" value={fb.ageSex} />
                    <ROInput label="Ward / Bed" value={fb.wardBed} />
                    <ROInput label="Unit Name" value={fb.unitName} />
                    <ROInput label="Treating Doctor" value={fb.treatingDoctor} />
                    <ROInput label="Status" value={viewDialog.data.status || fb.status} />
                  </FG>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, mb: 1.5 }}>Surgery Classification</Typography>
                  <FG cols={3}>
                    <ROInput label="Case Status" value={fb.caseStatus} />
                    <ROInput label="Type of Surgery" value={(fb.surgeryType || []).join(", ")} />
                    <ROInput label="Laterality" value={fb.laterality} />
                    <ROInput label="Name of Procedure" value={fb.procedureName} />
                    <ROInput label="Approach" value={(fb.approach || []).join(", ")} />
                    <ROInput label="Estimated Duration" value={fb.duration} />
                  </FG>
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, mb: 1.5 }}>Scheduling & Resources</Typography>
                  <FG cols={3}>
                    <ROInput label="Date of Surgery" value={fb.surgeryDate} />
                    <ROInput label="OT Room Number" value={fb.otRoom} />
                    <ROInput label="Surgeon Name" value={surgeonMap[fb.surgeonName] || fb.surgeonName || fb.treatingDoctor} />
                  </FG>
                  <TextField label="Pre-Operative Diagnosis" value={fb.preOpDiagnosis || ""} multiline rows={2} InputProps={{ readOnly: true }} sx={{ ...inputSx, mt: 1.5 }} fullWidth size="small" />
                </Box>

                <Box>
                  <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, mb: 1.5 }}>Pre-Operative Assessment</Typography>
                  <FG cols={3}>
                    <ROInput label="Viral Markers" value={(fb.viralMarkers || []).join(", ")} />
                    <ROInput label="Insurance" value={fb.insurance === "Yes" ? `Yes (${(fb.insuranceType || []).join(", ")})` : "No"} />
                    <ROInput label="ASA Physical Status Class" value={fb.asaClass} />
                    <ROInput label="High Risk MDT" value={fb.highRiskMDT} />
                    <ROInput label="Blood Group" value={fb.bloodGroup} />
                    <ROInput label="Past Transfusions" value={fb.pastTransfusion} />
                    {fb.pastTransfusion === "Yes" && (
                      <ROInput label="Transfusion Reaction" value={fb.transfusionReaction === "Yes" ? `Yes - ${fb.reactionDetails}` : "No"} />
                    )}
                  </FG>
                  {fb.highRiskMDT === "Yes" && (
                    <TextField label="MDT Comments" value={fb.mdtComments || ""} multiline rows={2} InputProps={{ readOnly: true }} sx={{ ...inputSx, mt: 1.5 }} fullWidth size="small" />
                  )}
                  <TextField label="Remarks" value={fb.remarks || ""} multiline rows={2} InputProps={{ readOnly: true }} sx={{ ...inputSx, mt: 1.5 }} fullWidth size="small" />
                </Box>

                {(viewDialog.data.checklist || fb.checklist || viewDialog.data.management || fb.management) && (() => {
                  const cl = viewDialog.data.checklist || fb.checklist;
                  const mg = viewDialog.data.management || fb.management;
                  const renderCheck = (label, id) => {
                    const status = cl[`${id}_status`];
                    const remarks = cl[`${id}_remarks`];
                    if (!status && !remarks) return null;
                    return (
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', borderBottom: `1px solid ${C.border}`, py: 0.5 }}>
                        <Typography sx={{ fontSize: 11, color: C.textMain }}>{label}</Typography>
                        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                          <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, color: status === 'No' ? 'red' : C.textMain }}>{status || "-"}</Typography>
                          {remarks && <Typography sx={{ fontSize: 11, color: C.textMuted, fontStyle: 'italic' }}>({remarks})</Typography>}
                        </Box>
                      </Box>
                    );
                  };

                  return (
                    <Box>
                      <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, mb: 1.5 }}>Surgical Procedure</Typography>
                      {cl && (
                        <Box sx={{ mb: 2, p: 1.5, border: `1px solid ${C.border}`, borderRadius: 1, background: C.bgPrimary }}>
                          <Typography sx={{ fontSize: 12, fontWeight: FW_NORMAL, fontFamily: FONT, mb: 1 }}>Surgical Checklist</Typography>

                          <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, mt: 1, color: C.textMuted }}>SIGN IN (Before Induction)</Typography>
                          {renderCheck("Identity Confirmed", "signin_identity")}
                          {renderCheck("Consent Obtained", "signin_consent")}
                          {renderCheck("Site Marked", "signin_site")}
                          {renderCheck("Viral Markers Checked", "signin_viral")}
                          {renderCheck("Blood Confirmed", "signin_blood")}
                          {renderCheck("Instruments Available", "signin_instruments")}
                          {renderCheck("Machine Check", "signin_machine")}
                          {renderCheck("Pulse Oximeter", "signin_oximeter")}
                          {renderCheck("Airway Risk", "signin_airway")}
                          {renderCheck("Aspiration Risk", "signin_aspiration")}

                          <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, mt: 1.5, color: C.textMuted }}>TIME OUT (Before Incision)</Typography>
                          {renderCheck("Team Introduction", "timeout_intro")}
                          {renderCheck("Patient Identity", "timeout_patient")}
                          {renderCheck("Procedure Confirmed", "timeout_procedure")}
                          {renderCheck("Side (Laterality)", "timeout_side")}
                          {renderCheck("Mop/Gauze Count", "timeout_mop")}
                          {renderCheck("Antibiotic Prophylaxis", "timeout_antibiotic")}
                          {renderCheck("Imaging Displayed", "timeout_imaging")}
                          {renderCheck("HPR / Frozen Form", "timeout_hpr")}
                          {renderCheck("Tourniquet", "timeout_tourniquet")}

                          <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, mt: 1.5, color: C.textMuted }}>SIGN OUT (Before leaving OT)</Typography>
                          {renderCheck("Procedure Name Recorded", "signout_name")}
                          {renderCheck("Sponge/Needle Count", "signout_count")}
                          {renderCheck("Specimen Labelled", "signout_specimen")}
                          {renderCheck("Equipment Problems", "signout_equipment")}
                          {renderCheck("Throat Pack Removed", "extubation_throat")}

                          {(cl.timeout_events_surgeon || cl.timeout_events_anaesthesia || cl.timeout_events_nursing || cl.signout_concerns_surgeon || cl.signout_concerns_anaesthesia || cl.signout_concerns_nursing) && (
                            <Box sx={{ mt: 1.5 }}>
                              <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, color: C.textMuted, mb: 0.5 }}>Critical Events & Concerns</Typography>
                              {cl.timeout_events_surgeon && <Typography sx={{ fontSize: 11 }}>Surgeon: {cl.timeout_events_surgeon}</Typography>}
                              {cl.timeout_events_anaesthesia && <Typography sx={{ fontSize: 11 }}>Anaesthesia: {cl.timeout_events_anaesthesia}</Typography>}
                              {cl.timeout_events_nursing && <Typography sx={{ fontSize: 11 }}>Nursing: {cl.timeout_events_nursing}</Typography>}
                              {cl.signout_concerns_surgeon && <Typography sx={{ fontSize: 11 }}>Post-Op (Surgeon): {cl.signout_concerns_surgeon}</Typography>}
                              {cl.signout_concerns_anaesthesia && <Typography sx={{ fontSize: 11 }}>Post-Op (Anaesthesia): {cl.signout_concerns_anaesthesia}</Typography>}
                              {cl.signout_concerns_nursing && <Typography sx={{ fontSize: 11 }}>Post-Op (Nursing): {cl.signout_concerns_nursing}</Typography>}
                            </Box>
                          )}
                        </Box>
                      )}

                      {mg && (
                        <Box sx={{ p: 1.5, border: `1px solid ${C.border}`, borderRadius: 1, background: C.bgPrimary }}>
                          <Typography sx={{ fontSize: 12, fontWeight: FW_NORMAL, fontFamily: FONT, mb: 1 }}>Surgical Management</Typography>

                          <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, mt: 1, color: C.textMuted, mb: 0.5 }}>Surgical Team</Typography>
                          <FG cols={3}>
                            <ROInput label="Primary Surgeon" value={surgeonMap[mg.primarySurgeon] || mg.primarySurgeon} />
                            <ROInput label="Assistants" value={[mg.assistantSurgeon1, mg.assistantSurgeon2, mg.assistantSurgeon3].map(s => surgeonMap[s] || s).filter(Boolean).join(", ")} />
                            <ROInput label="Anaesthetists" value={[mg.primaryAnaesthetist, mg.anaesthetist1, mg.anaesthetist2].map(a => surgeonMap[a] || a).filter(Boolean).join(", ")} />
                            <ROInput label="Recon Surgeon" value={surgeonMap[mg.reconPrimarySurgeon] || mg.reconPrimarySurgeon} />
                            <ROInput label="Scrub Nurses" value={[mg.scrubNurse1, mg.scrubNurse2].filter(Boolean).join(", ")} />
                            <ROInput label="Circulating Nurse" value={mg.circulatingNurse} />
                          </FG>

                          <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, mt: 1.5, color: C.textMuted, mb: 0.5 }}>Procedure Details</Typography>
                          <FG cols={3}>
                            <ROInput label="Procedure Name" value={mg.nameOfProcedure || mg.otherNameOfProcedure || (mg.typeOfSurgery || []).join(", ")} />
                            <ROInput label="Approach" value={mg.approach} />
                            <ROInput label="Classification" value={mg.classification} />
                            <ROInput label="Case Status" value={(mg.caseStatus || []).join(", ")} />
                            <ROInput label="Skin Preparation" value={mg.skinPreparation} />
                            <ROInput label="Wound Class" value={(mg.woundClass || []).join(", ")} />
                          </FG>

                          <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, mt: 1.5, color: C.textMuted, mb: 0.5 }}>Outcomes & Materials</Typography>
                          <FG cols={3}>
                            <ROInput label="Blood Loss (ml)" value={mg.bloodLoss} />
                            <ROInput label="Blood Products" value={(mg.bloodProducts || []).join(", ")} />
                            <ROInput label="Resection Status" value={mg.resection} />
                            <ROInput label="Complications" value={mg.complications} />
                            <ROInput label="Frozen Section" value={mg.frozen} />
                            <ROInput label="Materials Forwarded" value={mg.materialsForwarded} />
                            <ROInput label="Anatomical Site" value={mg.anatomicalSite} />
                            <ROInput label="Staging (T N M)" value={`${mg.stagingT || '-'} ${mg.stagingN || '-'} ${mg.stagingM || '-'}`} />
                          </FG>

                          {(mg.preOperativeDiagnosis || mg.postOperativeDiagnosis) && (
                            <FG cols={2}>
                              <TextField label="Pre-Operative Diagnosis" value={mg.preOperativeDiagnosis || ""} multiline rows={2} InputProps={{ readOnly: true }} sx={{ ...inputSx, mt: 1.5 }} fullWidth size="small" />
                              <TextField label="Post-Operative Diagnosis" value={mg.postOperativeDiagnosis || ""} multiline rows={2} InputProps={{ readOnly: true }} sx={{ ...inputSx, mt: 1.5 }} fullWidth size="small" />
                            </FG>
                          )}

                          {mg.findings && (
                            <TextField label="Findings" value={mg.findings} multiline rows={2} InputProps={{ readOnly: true }} sx={{ ...inputSx, mt: 1.5 }} fullWidth size="small" />
                          )}
                          {mg.procedureDetails && (
                            <TextField label="Procedure Details" value={mg.procedureDetails} multiline rows={4} InputProps={{ readOnly: true }} sx={{ ...inputSx, mt: 1.5 }} fullWidth size="small" />
                          )}
                        </Box>
                      )}
                    </Box>
                  );
                })()}
              </>
            );
          })()}
          {viewDialog.data && isEditMode && (
            <OTBookingTab
              patientId={viewDialog.data.patient_id}
              doctorId={doctorId}
              doctorName={viewDialog.data.surgeon}
              hospitalId={hospitalId}
              bookingId={viewDialog.data.booking_id}
              initialData={viewDialog.data.fullBooking || {}}
              onCancel={() => setIsEditMode(false)}
              onSave={async (tab, data) => {
                try {
                  await updateBooking(viewDialog.data.booking_id, data);
                  fetchWorklist();
                  setViewDialog({ open: false, data: null });
                  setIsEditMode(false);
                } catch (err) {
                  console.error("Failed to update booking", err);
                }
              }}
            />
          )}
        </DialogContent>
        {!isEditMode && (
          <DialogActions sx={{ borderTop: `1px solid ${C.border}`, p: 1.5 }}>
            <Button sx={outlineBtnSx} onClick={() => { setViewDialog({ open: false, data: null }); setIsEditMode(false); }}>Close</Button>
          </DialogActions>
        )}
      </Dialog>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 3 — ANAESTHESIA MANAGEMENT (Part E) — 7 sub-tabs
// (This tab keeps its full form UI but uses the shared hooks/components)
// ─────────────────────────────────────────────────────────────────────────────

const AnaesthesiaHistoryTable = ({ history = [], currentBookingId, sectionKey, title }) => {
  const [expanded, setExpanded] = useState(false);
  const [viewDialog, setViewDialog] = useState({ open: false, data: null });

  // Filter out the current booking, and keep only those that have data for this section
  const historyData = history.filter(b => b.booking_id !== currentBookingId);

  if (historyData.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Accordion expanded={expanded} onChange={() => setExpanded(!expanded)} sx={{ background: C.bgSecondary, border: `1px solid ${C.border}`, boxShadow: 'none', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 1 } }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_BOLD, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Past {title} Records ({historyData.length})</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0, borderTop: `1px solid ${C.border}` }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={thSx}>Date</TableCell>
                  <TableCell sx={thSx}>Procedure</TableCell>
                  <TableCell sx={thSx}>Surgeon</TableCell>
                  <TableCell sx={thSx}>Action</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {historyData.map((b, i) => {
                  const bd = b.fullBooking || b;
                  const sectionData = bd.anaesthesia?.[sectionKey] || b.anaesthesia?.[sectionKey];

                  let hasData = false;
                  if (sectionData && typeof sectionData === 'object' && !Array.isArray(sectionData)) {
                    hasData = Object.entries(sectionData).some(([k, v]) => k !== 'patientId' && v !== "" && v !== null && (!Array.isArray(v) || v.length > 0));
                  }

                  return (
                    <TableRow key={i} sx={{ "&:hover": { background: C.bgPrimary } }}>
                      <TableCell sx={tdSx}>{bd.surgeryDate || b.date}</TableCell>
                      <TableCell sx={tdSx}>{bd.procedureName || b.procedure}</TableCell>
                      <TableCell sx={tdSx}>{bd.surgeonName || bd.treatingDoctor || b.surgeon}</TableCell>
                      <TableCell sx={tdSx}>
                        <Button disabled={!hasData} size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10, borderColor: hasData ? C.primary : C.border, color: hasData ? C.primary : C.textMuted }} onClick={() => setViewDialog({ open: true, data: sectionData })}>
                          {hasData ? "View" : "No Data"}
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>

      <Dialog open={viewDialog.open} onClose={() => setViewDialog({ open: false, data: null })} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          <Typography sx={{ fontFamily: FONT, fontWeight: FW_NORMAL, fontSize: 16 }}>Past {title} Details</Typography>
          <IconButton onClick={() => setViewDialog({ open: false, data: null })} size="small">
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3, fontFamily: FONT }}>
          <Box>
            <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, textTransform: 'uppercase', letterSpacing: '0.1em', color: C.textMuted, mb: 1.5 }}>{title} Data</Typography>
            <FG cols={3}>
              {viewDialog.data && Object.entries(viewDialog.data).map(([k, v]) => {
                if (k === 'patientId') return null; // Redundant in history view
                if (k === 'labOrder') return <ROInput key={k} label="Lab Order" value={v?.status ? `Status: ${v.status}` : "-"} />;
                if (k === 'labResults') return <ROInput key={k} label="Lab Results" value={v?.approved ? "Approved" : "Pending"} />;

                let displayVal = "-";
                if (Array.isArray(v)) {
                  displayVal = v.length > 0 ? v.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join(", ") : "-";
                }
                else if (typeof v === 'object' && v !== null) {
                  displayVal = "Data Recorded (Complex)";
                }
                else if (v !== "" && v !== null && v !== undefined) {
                  displayVal = String(v);
                }

                // If it's literally just the default unselected state, we can still render it, it will just be "-" or the default value
                return <ROInput key={k} label={k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())} value={displayVal} />;
              })}
            </FG>
          </Box>
        </DialogContent>
      </Dialog>
    </Box>
  );
};

const DEFAULT_INTRA_OP_MONITORING = {
  "O2 (FiO2 %)": [{ time: "", value: "" }, { time: "", value: "" }],
  "N2O / Air": [{ time: "", value: "" }, { time: "", value: "" }],
  "Inhalation Agent": [{ time: "", value: "" }, { time: "", value: "" }],
  "IV Fluid": [{ time: "", value: "" }, { time: "", value: "" }],
  "Urine Output (ml)": [{ time: "", value: "" }, { time: "", value: "" }],
  "Blood Products": [{ time: "", value: "" }, { time: "", value: "" }],
};

const AnaesthesiaTab = ({ patientId, doctorId, doctorName, bookingData, currentBookingId, onSave, initialPI = {}, getSection }) => {
  const [sub, setSub] = useState(0);
  const SUBS = ["Mode & Monitoring", "General Anaesthesia", "Regional Anaesthesia", "MAC / Local", "Intra-op / Fluids", "End Op / Post-op"];

  const [history, setHistory] = useState([]);
  useEffect(() => {
    if (patientId) {
      getAnaesthesiaHistory(patientId)
        .then(res => {
          if (res && res.data) setHistory(res.data);
        })
        .catch(err => console.error("[AnaesthesiaTab] Failed to fetch history:", err));
    }
  }, [patientId]);

  // ── Pre-Induction state removed to DoctorsNoteTab

  // ── Mode & Monitoring state
  const [mm, setMm] = useState({ modeAnaesthesia: "", monitors: [], ivTiming: "", ivType: "", centralSite: [], centralSize: [], centralAttempts: "", centralIssues: "", artSite: [], artLaterality: "", artSize: [], artTechnique: "", artAttempts: "", artOperators: "", intraOpMonitoring: DEFAULT_INTRA_OP_MONITORING, ...(getSection("mm") || {}) });
  const smm = (k, v) => setMm(p => ({ ...p, [k]: v }));

  // ── General Anaesthesia state
  const [ga, setGa] = useState({ inductionAgents: [], inductionDetails: "", airwayDevice: [], airwaySize: "", airwayAttempts: "", opioids: [], opioidDetails: "", relaxants: [], relaxantDetails: "", maintenanceMode: [], maintenanceDetails: "", nmMonitoring: "", reversalDetails: "", ...(getSection("ga") || {}) });
  const sga = (k, v) => setGa(p => ({ ...p, [k]: v }));

  // ── Regional Anaesthesia state
  const [reg, setReg] = useState({
    showSpinal: false, showEpidural: false, showCSE: false, showPNB: false, showFascial: false, showIVRA: false, showOther: false,
    otherDetails: "",
    spinal: { posture: "", needleType: "", needleSize: "", site: "", approach: "", attempts: "", operators: "", timing: [], startTime: "", endTime: "", la: "", concentration: "", volume: "", adjuvants: "", catheter: "", blockExtent: "", complications: [] },
    epidural: { posture: "", needleType: "", needleSize: "", site: [], insertionDetails: "", approach: "", technique: "", depthSpace: "", catheterDepth: "", attempts: "", operators: "", timing: [], startTime: "", endTime: "", la: "", concentration: "", volume: "", loadingDose: "", infusion: "", adjuvants: "", complications: [] },
    raTiming: "",
    pnb: { nerve: [], posture: "", laterality: "", technique: [], needleType: "", needleSize: "", site: "", timing: [], startTime: "", endTime: "", la: "", concentration: "", volume: "", adjuvants: "", catheter: "", blockExtent: "", blockExtentDetails: "", complications: "", comments: "" },
    fascial: { block: [], laterality: "", posture: "", usg: "", needleType: "", needleSize: "", timing: [], startTime: "", endTime: "", la: "", concentration: "", volume: "", adjuvants: "", catheter: "", blockExtent: "", blockExtentDetails: "", complications: "" },
    ivra: { limb: "", duration: "", la: "", concentration: "", volume: "", adjuvants: "", blockExtent: "", complications: "", tourniquet: "" },
    ...(getSection("reg") || {}),
  });
  const sreg = (path, v) => setReg(p => {
    const parts = path.split(".");
    if (parts.length === 1) return { ...p, [path]: v };
    return { ...p, [parts[0]]: { ...p[parts[0]], [parts[1]]: v } };
  });

  // ── MAC / Local state
  const [mac, setMac] = useState({ laDrug: "", laConc: "", laVolume: "", laRoute: [], additiveDrug: "", additiveConc: "", additiveVolume: "", propofol: "", ketamine: "", midazolam: "", fentanyl: "", dexmedetomidine: "", ramsay: "", oxygenSupp: "", complications: [], ...(getSection("mac") || {}) });
  const smac = (k, v) => setMac(p => ({ ...p, [k]: v }));

  // ── Intra-op state
  const [io, setIo] = useState({
    patientPosition: [], pressureAreas: "", eyesShut: "", normothermia: [], tempMonitoring: [],
    ivFluids: { ringerLactate: "", normalSaline: "", dns: "", dextrose5: "", dextrose10: "", plasmalyte: "", gelofusine: "", albumin20: "", albumin5: "", mannitol20: "", drl1: "", drl2: "", others: "" },
    bloodProducts: [
      { product: "Whole Blood", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Packed Cells", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "FFP", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Cryoprecipitate", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Random Donor Platelets", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Single Donor Platelets", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Tranexamic Acid", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
      { product: "Others", checked: false, volume: "", bagNo: "", reaction: "", details: "" },
    ],
    bloodLoss: "", urineOutput: "", otherLosses: "",
    complications: [], complicationDetails: "",
    ioMedAnalgesics: "", ioMedAntiemetics: "", ioMedAntibiotics: "", ioMedVasoactive: "", ioMedOthers: "",
    ...(getSection("io") || {}),
  });
  const sio = (k, v) => setIo(p => ({ ...p, [k]: v }));
  const sivf = (k, v) => setIo(p => ({ ...p, ivFluids: { ...p.ivFluids, [k]: v } }));
  const sbp = (i, k, v) => setIo(p => { const a = [...p.bloodProducts]; a[i] = { ...a[i], [k]: v }; return { ...p, bloodProducts: a }; });

  // ── End Op state
  const [eo, setEo] = useState({
    reversalTime: "", reversalDrug: [], reversalDose: "", extubation: "", postOpVent: "",
    vasoactiveDrugs: [], postExtubComps: [], patientCondition: "", pr: "", bp: "", spo2: "", rr: "", temperature: "",
    airwayAdjunct: "", monitorLevel: "", oxygenSupp: "", npoHours: "", ivfRate: "", analgesics: "",
    antiemetics: "", chronicMeds: "", investigations: [], otherComments: "",
    ...(getSection("eo") || {}),
  });
  const seo = (k, v) => setEo(p => ({ ...p, [k]: v }));

  // NOTE: The full anaesthesia sub-tab JSX rendering is preserved exactly as before.
  // For brevity, only the structure is shown here. Each sub-tab renders identically
  // to the original OTRecord.jsx lines 1082-1533.
  // The key change is that onSave now calls saveSection directly.

  return (
    <Box>
      <SubTabBar tabs={SUBS} active={sub} onSelect={setSub} />

      {/* Sub-tabs 1-6: Mode & Monitoring, GA, Regional, MAC, Intra-op, End Op */}
      {/* These sub-tabs maintain identical UI to the original. The only change is the save path. */}
      {sub === 0 && (
        <Box>
          <AnaesthesiaHistoryTable history={history} currentBookingId={currentBookingId} sectionKey="mm" title="Mode & Monitoring" />
          <SectionBox title="Mode of Anaesthesia">
            <RdoGroup label="Mode (Select One)" options={["General", "Regional", "Both (General + Regional)", "MAC"]} value={mm.modeAnaesthesia} onChange={v => smm("modeAnaesthesia", v)} />
          </SectionBox>
          <SectionBox title="Intra-operative Monitoring">
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>{["Particulars", "Time", "Value", "Time", "Value"].map((h, i) => <TableCell key={i} sx={thSx}>{h}</TableCell>)}</TableRow>
                </TableHead>
                <TableBody>
                  {["O2 (FiO2 %)", "N2O / Air", "Inhalation Agent", "IV Fluid", "Urine Output (ml)", "Blood Products"].map(row => {
                    const rowData = mm.intraOpMonitoring?.[row] || [{ time: "", value: "" }, { time: "", value: "" }];
                    return (
                      <TableRow key={row}>
                        <TableCell sx={tdSx}>{row}</TableCell>
                        {[0, 1].map(p => (
                          <React.Fragment key={p}>
                            <TableCell sx={tdSx}>
                              <TextField
                                type="time"
                                size="small"
                                value={rowData[p]?.time || ""}
                                onChange={(e) => {
                                  const newRowData = [...rowData];
                                  newRowData[p] = { ...newRowData[p], time: e.target.value };
                                  smm("intraOpMonitoring", { ...mm.intraOpMonitoring, [row]: newRowData });
                                }}
                                sx={{ ...inputSx, width: 110 }}
                                InputLabelProps={{ shrink: true }}
                              />
                            </TableCell>
                            <TableCell sx={tdSx}>
                              <TextField
                                size="small"
                                value={rowData[p]?.value || ""}
                                onChange={(e) => {
                                  const newRowData = [...rowData];
                                  newRowData[p] = { ...newRowData[p], value: e.target.value };
                                  smm("intraOpMonitoring", { ...mm.intraOpMonitoring, [row]: newRowData });
                                }}
                                sx={{ ...inputSx, width: 110 }}
                                placeholder="Value"
                              />
                            </TableCell>
                          </React.Fragment>
                        ))}
                      </TableRow>
                    );
                  })}
                  <TableRow>
                    <TableCell sx={tdSx}>Monitors Connected</TableCell>
                    <TableCell colSpan={4} sx={tdSx}>
                      <CbxGroup options={["ECG", "NIBP", "SpO2", "EtCO2", "Temp", "Pulse", "BP (Arterial)", "Others"]} value={mm.monitors} onChange={v => smm("monitors", v)} />
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </TableContainer>
          </SectionBox>
          <SectionBox title="IV Access">
            <FG cols={3}>
              <RdoGroup label="Timing" options={["Pre-Induction", "Post-Induction"]} value={mm.ivTiming} onChange={v => smm("ivTiming", v)} />
              <RdoGroup label="Type" options={["Peripheral", "Central"]} value={mm.ivType} onChange={v => smm("ivType", v)} />
              {mm.ivType === "Central" && (
                <>
                  <CbxGroup label="Site" options={["Internal Jugular Vein", "Subclavian Vein", "Femoral Vein"]} value={mm.centralSite} onChange={v => smm("centralSite", v)} />
                  <CbxGroup label="Size" options={["5F", "7F", "Others"]} value={mm.centralSize} onChange={v => smm("centralSize", v)} />
                  <TextField label="No of Attempts" value={mm.centralAttempts} type="number" size="small" onChange={e => smm("centralAttempts", e.target.value)} sx={inputSx} fullWidth />
                  <Box sx={{ gridColumn: "1/-1" }}>
                    <TextField label="Issues, if any" value={mm.centralIssues} size="small" multiline rows={2} onChange={e => smm("centralIssues", e.target.value)} sx={inputSx} fullWidth />
                  </Box>
                </>
              )}
            </FG>
          </SectionBox>
          <SectionBox title="Arterial Line">
            <FG cols={3}>
              <CbxGroup label="Site" options={["Radial", "Dorsalis Pedis", "Femoral"]} value={mm.artSite} onChange={v => smm("artSite", v)} />
              <RdoGroup label="Laterality" options={["Right", "Left"]} value={mm.artLaterality} onChange={v => smm("artLaterality", v)} />
              <CbxGroup label="Size (G)" options={["20G", "22G", "24G"]} value={mm.artSize} onChange={v => smm("artSize", v)} />
              <RdoGroup label="Technique" options={["Standard Canula", "Seldinger"]} value={mm.artTechnique} onChange={v => smm("artTechnique", v)} />
              <TextField label="No of Attempts" value={mm.artAttempts} type="number" size="small" onChange={e => smm("artAttempts", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="No of Operators" value={mm.artOperators} type="number" size="small" onChange={e => smm("artOperators", e.target.value)} sx={inputSx} fullWidth />
              <Box sx={{ gridColumn: "1/-1" }}>
                <TextField label="Issues, if any" value={mm.artIssues} size="small" multiline rows={2} onChange={e => smm("artIssues", e.target.value)} sx={inputSx} fullWidth />
              </Box>
            </FG>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.mm", mm)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Mode & Monitoring</Button>
        </Box>
      )}

      {/* ── Sub-tab 2: General Anaesthesia */}
      {sub === 1 && (
        <Box>
          <AnaesthesiaHistoryTable history={history} currentBookingId={currentBookingId} sectionKey="ga" title="General Anaesthesia" />

          <SectionBox title="Induction">
            <FG cols={3}>
              <TextField label="Time of Induction" type="time" size="small" value={ga.timeInduction || ""} onChange={e => sga("timeInduction", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
              <RdoGroup label="Preoxygenation" options={["Yes", "No"]} value={ga.preoxygenation} onChange={v => sga("preoxygenation", v)} />
              <RdoGroup label="Induction" options={["Intravenous", "Inhalational"]} value={ga.induction} onChange={v => sga("induction", v)} />
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Intubation Response Prevention" options={["Opioids", "NTG", "Lignocaine", "Esmolol", "Labetalol", "Other"]} value={ga.intubRespPrev} onChange={v => sga("intubRespPrev", v)} />
              </Box>
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>IV Opioids</Typography>
              <FG cols={4}>
                <TextField label="Fentanyl Dose (mcg)" size="small" value={ga.ivOpioidFentanyl || ""} onChange={e => sga("ivOpioidFentanyl", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Morphine Dose (mg)" size="small" value={ga.ivOpioidMorphine || ""} onChange={e => sga("ivOpioidMorphine", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Tramadol Dose (mg)" size="small" value={ga.ivOpioidTramadol || ""} onChange={e => sga("ivOpioidTramadol", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Other (Specify & Dose)" size="small" value={ga.ivOpioidOther || ""} onChange={e => sga("ivOpioidOther", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>IV Induction Agent</Typography>
              <FG cols={5}>
                <TextField label="Propofol (mg)" size="small" value={ga.ivInductionPropofol || ""} onChange={e => sga("ivInductionPropofol", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Ketamine (mg)" size="small" value={ga.ivInductionKetamine || ""} onChange={e => sga("ivInductionKetamine", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Etomidate (mg)" size="small" value={ga.ivInductionEtomidate || ""} onChange={e => sga("ivInductionEtomidate", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Thiopentone (mg)" size="small" value={ga.ivInductionThiopentone || ""} onChange={e => sga("ivInductionThiopentone", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Other (Specify & Dose)" size="small" value={ga.ivInductionOther || ""} onChange={e => sga("ivInductionOther", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
            <FG cols={2} sx={{ mt: 1.5 }}>
              <CbxGroup label="Carrier Gas Composition" options={["Air + O2", "N2O + O2"]} value={ga.carrierGas} onChange={v => sga("carrierGas", v)} />
              <CbxGroup label="Inhalation Agent" options={["Isoflurane", "Sevoflurane"]} value={ga.inhalationAgent} onChange={v => sga("inhalationAgent", v)} />
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Muscle Relaxant 1 - Intubation</Typography>
              <FG cols={5}>
                <TextField label="Succinyl Choline (mg)" size="small" value={ga.mr1Succ || ""} onChange={e => sga("mr1Succ", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Rocuronium (mg)" size="small" value={ga.mr1Roc || ""} onChange={e => sga("mr1Roc", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Vecuronium (mg)" size="small" value={ga.mr1Vec || ""} onChange={e => sga("mr1Vec", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Atracurium (mg)" size="small" value={ga.mr1Atr || ""} onChange={e => sga("mr1Atr", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Cis-Atracurium (mg)" size="small" value={ga.mr1Cis || ""} onChange={e => sga("mr1Cis", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Muscle Relaxant 2 - Maintenance</Typography>
              <FG cols={5}>
                <TextField label="Succinyl Choline (mg)" size="small" value={ga.mr2Succ || ""} onChange={e => sga("mr2Succ", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Rocuronium (mg)" size="small" value={ga.mr2Roc || ""} onChange={e => sga("mr2Roc", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Vecuronium (mg)" size="small" value={ga.mr2Vec || ""} onChange={e => sga("mr2Vec", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Atracurium (mg)" size="small" value={ga.mr2Atr || ""} onChange={e => sga("mr2Atr", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Cis-Atracurium (mg)" size="small" value={ga.mr2Cis || ""} onChange={e => sga("mr2Cis", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
          </SectionBox>

          <SectionBox title="Airway & Intubation">
            <Box sx={{ mb: 1.5 }}>
              <CbxGroup label="Airway and Oxygen Delivery Devices" options={["ETT Standard", "ETT Preformed", "Double Lumen", "With Bronchial Blocker", "SGD Supreme", "SGD AuraGain", "SGD iGel", "SGD ProSeal", "Face Mask", "Nasal Prongs", "Hudson Mask", "Rigid Bronchoscope", "Tracheostomy Tube", "Others"]} value={ga.airwayDevice} onChange={v => sga("airwayDevice", v)} />
            </Box>
            <FG cols={3}>
              <RdoGroup label="Mode of Intubation" options={["Awake", "GA + Muscle Relaxant", "GA + Spont. Ventilation", "Pre-Op Tracheostomy (LA)", "Not Applicable"]} value={ga.intubationMode} onChange={v => sga("intubationMode", v)} />
              <CbxGroup label="Method of Intubation" options={["Video Laryngoscope - C Blade", "Video Laryngoscope - D Blade", "Standard Laryngoscope", "Flexible Bronchoscope", "Others"]} value={ga.intubationMethod} onChange={v => sga("intubationMethod", v)} />
              <RdoGroup label="CL Grade" options={["1", "2A", "2B", "3", "4"]} value={ga.clGrade} onChange={v => sga("clGrade", v)} />
              <RdoGroup label="POGO (%)" options={["0", "25", "50", "75", "100"]} value={ga.pogo} onChange={v => sga("pogo", v)} />
              <CbxGroup label="Adjuncts" options={["Bougie", "Stylet", "Others"]} value={ga.adjuncts} onChange={v => sga("adjuncts", v)} />
              <TextField label="Number of Attempts" type="number" size="small" value={ga.airwayAttempts || ""} onChange={e => sga("airwayAttempts", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Number of Operators" type="number" size="small" value={ga.airwayOperators || ""} onChange={e => sga("airwayOperators", e.target.value)} sx={inputSx} fullWidth />
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <CbxGroup label="Complications" options={["Desaturation < 90%", "Significant trauma", "Aspiration of stomach contents", "Aspiration of blood", "Others"]} value={ga.airwayComplications} onChange={v => sga("airwayComplications", v)} />
            </Box>
          </SectionBox>

          <SectionBox title="Maintenance & Ventilation">
            <FG cols={3}>
              <RdoGroup label="Inhalational Maintenance" options={["O2 + N2O + Volatile", "O2 + Air + Volatile"]} value={ga.maintInhalational} onChange={v => sga("maintInhalational", v)} />
              <CbxGroup label="TIVA / Inhalation Details" options={["Propofol", "Dexmedetomidine", "Remifentanil", "Others"]} value={ga.maintTiva} onChange={v => sga("maintTiva", v)} />
              <CbxGroup label="Breathing System" options={["Circle Absorber", "Jackson Rees", "Magill's", "Bains"]} value={ga.breathingSystem} onChange={v => sga("breathingSystem", v)} />
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Ventilator Mode" options={["Spontaneous", "Pressure Support", "Volume Control", "Pressure Control", "Others"]} value={ga.ventMode} onChange={v => sga("ventMode", v)} />
              </Box>
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Non-Opioid Analgesic Drugs</Typography>
              <FG cols={3}>
                <TextField label="Paracetamol (mg)" size="small" value={ga.nonOpioidPara || ""} onChange={e => sga("nonOpioidPara", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Diclofenac (mg)" size="small" value={ga.nonOpioidDiclo || ""} onChange={e => sga("nonOpioidDiclo", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Others (Specify & Dose)" size="small" value={ga.nonOpioidOther || ""} onChange={e => sga("nonOpioidOther", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 0.5, letterSpacing: "0.05em", textTransform: "uppercase" }}>Antiemetic Drugs</Typography>
              <FG cols={4}>
                <TextField label="Metoclopramide (mg)" size="small" value={ga.antiemeticMetoclo || ""} onChange={e => sga("antiemeticMetoclo", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Ondansetron (mg)" size="small" value={ga.antiemeticOndan || ""} onChange={e => sga("antiemeticOndan", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Dexamethasone (mg)" size="small" value={ga.antiemeticDexa || ""} onChange={e => sga("antiemeticDexa", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Others (Specify & Dose)" size="small" value={ga.antiemeticOther || ""} onChange={e => sga("antiemeticOther", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </Box>
          </SectionBox>

          <SectionBox title="Ventilation Settings">
            <FG cols={3}>
              <TextField label="Tidal Volume / Preset Pressure" size="small" value={ga.vt || ""} onChange={e => sga("vt", e.target.value)} sx={inputSx} fullWidth placeholder="ml or cmH2O" />
              <TextField label="Rate / Minute" type="number" size="small" value={ga.rr || ""} onChange={e => sga("rr", e.target.value)} sx={inputSx} fullWidth placeholder="Breaths/min" />
              <TextField label="I:E Ratio" size="small" value={ga.ieRatio || ""} onChange={e => sga("ieRatio", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., 1:2" />
              <TextField label="PEEP (cm H2O)" type="number" size="small" value={ga.peep || ""} onChange={e => sga("peep", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Airway Pressure (cm H2O)" type="number" size="small" value={ga.airwayPressure || ""} onChange={e => sga("airwayPressure", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="EtCO2 (mm Hg)" type="number" size="small" value={ga.etco2 || ""} onChange={e => sga("etco2", e.target.value)} sx={inputSx} fullWidth />
              <RdoGroup label="Gas Scavenging" options={["Yes", "No"]} value={ga.gasScavenging} onChange={v => sga("gasScavenging", v)} />
            </FG>
          </SectionBox>

          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.ga", ga)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save General Anaesthesia</Button>
        </Box>
      )}

      {/* ── Sub-tab 3: Regional Anaesthesia */}
      {sub === 2 && (
        <Box>
          <AnaesthesiaHistoryTable history={history} currentBookingId={currentBookingId} sectionKey="reg" title="Regional Anaesthesia" />
          <SectionBox title="Select Regional Block Type(s)">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {[["showSpinal", "Spinal"], ["showEpidural", "Epidural"], ["showCSE", "CSE"], ["showPNB", "Peripheral Nerve Block"], ["showFascial", "Fascial Plane Block"], ["showIVRA", "IVRA"], ["showOther", "Others"]].map(([key, label]) => (
                <Box key={key} onClick={() => sreg(key, !reg[key])}
                  sx={{ px: 2, py: 0.7, border: `1px solid ${reg[key] ? C.black : C.border}`, background: reg[key] ? C.black : C.white, color: reg[key] ? C.white : C.textSecond, fontSize: 12, fontFamily: FONT, cursor: "pointer", transition: "all 0.15s", "&:hover": { borderColor: C.black } }}>
                  {label}
                </Box>
              ))}
            </Box>
            <FlagNote>Individual modules open depending on selection</FlagNote>
            {reg.showOther && (
              <Box sx={{ mt: 1.5 }}>
                <TextField label="Other Regional Technique — Details" value={reg.otherDetails} size="small" multiline rows={2} onChange={e => sreg("otherDetails", e.target.value)} sx={inputSx} fullWidth />
              </Box>
            )}
            <Box sx={{ mt: 2 }}>
              <RdoGroup label="Regional Anaesthesia Timing" options={["Asleep", "Awake"]} value={reg.raTiming} onChange={v => sreg("raTiming", v)} />
            </Box>
          </SectionBox>

          {reg.showSpinal && (
            <SectionBox title="1. Spinal Anaesthesia">
              <FG cols={3}>
                <RdoGroup label="Posture" options={["Lateral", "Sitting"]} value={reg.spinal.posture} onChange={v => sreg("spinal.posture", v)} />
                <TextField label="Needle Type" value={reg.spinal.needleType} size="small" onChange={e => sreg("spinal.needleType", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Size" value={reg.spinal.needleSize} size="small" onChange={e => sreg("spinal.needleSize", e.target.value)} sx={inputSx} fullWidth />
                <RdoGroup label="Site of Insertion" options={["L3-L4", "L4-L5", "Others"]} value={reg.spinal.site} onChange={v => sreg("spinal.site", v)} />
                <RdoGroup label="Approach" options={["Median", "Paramedian"]} value={reg.spinal.approach} onChange={v => sreg("spinal.approach", v)} />
                <TextField label="No of Attempts" value={reg.spinal.attempts} type="number" size="small" onChange={e => sreg("spinal.attempts", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="No of Operators" value={reg.spinal.operators} type="number" size="small" onChange={e => sreg("spinal.operators", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Time" options={["Start of Surgery", "End of Surgery"]} value={reg.spinal.timing} onChange={v => sreg("spinal.timing", v)} />
                  {(reg.spinal.timing || []).length > 0 && (
                    <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                      {reg.spinal.timing.includes("Start of Surgery") && (
                        <TextField label="Start Time" type="time" value={reg.spinal.startTime || ""} size="small" onChange={e => sreg("spinal.startTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                      {reg.spinal.timing.includes("End of Surgery") && (
                        <TextField label="End Time" type="time" value={reg.spinal.endTime || ""} size="small" onChange={e => sreg("spinal.endTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                    </Box>
                  )}
                </Box>
                <TextField label="Local Anaesthetic" value={reg.spinal.la} size="small" onChange={e => sreg("spinal.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.spinal.concentration} size="small" onChange={e => sreg("spinal.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.spinal.volume} size="small" onChange={e => sreg("spinal.volume", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug and Dose)" value={reg.spinal.adjuvants} size="small" multiline rows={2} onChange={e => sreg("spinal.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>

                <Box sx={{ display: "flex", gap: 2 }}>
                  <RdoGroup label="Spinal Catheter" options={["Yes", "No"]} value={reg.spinal.catheter} onChange={v => sreg("spinal.catheter", v)} />
                  {reg.spinal.catheter === "Yes" && <TextField label="Catheter Details" value={reg.spinal.catheterDetails || ""} size="small" onChange={e => sreg("spinal.catheterDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />}
                </Box>
                <Box sx={{ display: "flex", gap: 2, gridColumn: "span 2" }}>
                  <RdoGroup label="Extent of Block" options={["Checked", "Not checked"]} value={reg.spinal.blockExtent} onChange={v => sreg("spinal.blockExtent", v)} />
                  {reg.spinal.blockExtent === "Checked" && <TextField label="Details" value={reg.spinal.blockExtentDetails || ""} size="small" onChange={e => sreg("spinal.blockExtentDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />}
                </Box>

                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Complications" options={["No action", "Inadequate", "High Spinal", "Total Spinal", "Severe hypotension", "Others"]} value={reg.spinal.complications} onChange={v => sreg("spinal.complications", v)} />
                </Box>
              </FG>
            </SectionBox>
          )}

          {reg.showEpidural && (
            <SectionBox title="2. Epidural Anaesthesia">
              <FG cols={3}>
                <RdoGroup label="Posture" options={["Lateral", "Sitting"]} value={reg.epidural.posture} onChange={v => sreg("epidural.posture", v)} />
                <TextField label="Needle Type" value={reg.epidural.needleType} size="small" onChange={e => sreg("epidural.needleType", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Size" value={reg.epidural.needleSize} size="small" onChange={e => sreg("epidural.needleSize", e.target.value)} sx={inputSx} fullWidth />
                <CbxGroup label="Site of Insertion" options={["Lumbar", "Thoracic", "Others"]} value={reg.epidural.site} onChange={v => sreg("epidural.site", v)} />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Insertion Details" value={reg.epidural.insertionDetails} size="small" multiline rows={2} onChange={e => sreg("epidural.insertionDetails", e.target.value)} sx={inputSx} fullWidth /></Box>
                <RdoGroup label="Approach" options={["Median", "Paramedian"]} value={reg.epidural.approach} onChange={v => sreg("epidural.approach", v)} />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <RdoGroup label="Technique" options={["Intermittent LOR - Air", "Intermittent LOR - Saline", "Continuous Saline", "Hanging drop", "Others"]} value={reg.epidural.technique} onChange={v => sreg("epidural.technique", v)} row={false} />
                  <FlagNote>Single choice possible</FlagNote>
                </Box>
                <TextField label="Depth of Epidural Space (cm)" value={reg.epidural.depthSpace} size="small" onChange={e => sreg("epidural.depthSpace", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Depth of Catheter Insertion (cm)" value={reg.epidural.catheterDepth} size="small" onChange={e => sreg("epidural.catheterDepth", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="No of Attempts" value={reg.epidural.attempts} type="number" size="small" onChange={e => sreg("epidural.attempts", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="No of Operators" value={reg.epidural.operators} type="number" size="small" onChange={e => sreg("epidural.operators", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Time" options={["Start of Surgery", "End of Surgery"]} value={reg.epidural.timing} onChange={v => sreg("epidural.timing", v)} />
                  {(reg.epidural.timing || []).length > 0 && (
                    <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                      {reg.epidural.timing.includes("Start of Surgery") && (
                        <TextField label="Start Time" type="time" value={reg.epidural.startTime || ""} size="small" onChange={e => sreg("epidural.startTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                      {reg.epidural.timing.includes("End of Surgery") && (
                        <TextField label="End Time" type="time" value={reg.epidural.endTime || ""} size="small" onChange={e => sreg("epidural.endTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                    </Box>
                  )}
                </Box>

                <Box sx={{ gridColumn: "1/-1", mt: 1, p: 1, border: `1px solid ${C.border}`, borderRadius: 1 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 500, fontFamily: FONT, mb: 1 }}>Test Dose</Typography>
                  <FG cols={3}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Checkbox size="small" checked={!!reg.epidural.testIntrathecal} onChange={e => sreg("epidural.testIntrathecal", e.target.checked)} />
                      <TextField label="For Intrathecal (Drug & Dose)" size="small" value={reg.epidural.testIntrathecalDetails || ""} onChange={e => sreg("epidural.testIntrathecalDetails", e.target.value)} sx={inputSx} fullWidth />
                    </Box>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Checkbox size="small" checked={!!reg.epidural.testIntravascular} onChange={e => sreg("epidural.testIntravascular", e.target.checked)} />
                      <TextField label="For Intravascular (Drug & Dose)" size="small" value={reg.epidural.testIntravascularDetails || ""} onChange={e => sreg("epidural.testIntravascularDetails", e.target.value)} sx={inputSx} fullWidth />
                    </Box>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Checkbox size="small" checked={!!reg.epidural.testPositive} onChange={e => sreg("epidural.testPositive", e.target.checked)} />
                      <TextField label="Positive Details" size="small" value={reg.epidural.testPositiveDetails || ""} onChange={e => sreg("epidural.testPositiveDetails", e.target.value)} sx={inputSx} fullWidth />
                    </Box>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Checkbox size="small" checked={!!reg.epidural.testNegative} onChange={e => sreg("epidural.testNegative", e.target.checked)} />
                      <Typography sx={{ fontSize: 12, fontFamily: FONT }}>Negative</Typography>
                    </Box>
                  </FG>
                </Box>

                <TextField label="Local Anaesthetic" value={reg.epidural.la} size="small" onChange={e => sreg("epidural.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.epidural.concentration} size="small" onChange={e => sreg("epidural.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.epidural.volume} size="small" onChange={e => sreg("epidural.volume", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Loading Dose" value={reg.epidural.loadingDose} size="small" onChange={e => sreg("epidural.loadingDose", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Infusion" value={reg.epidural.infusion} size="small" onChange={e => sreg("epidural.infusion", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug and Dose)" value={reg.epidural.adjuvants} size="small" multiline rows={2} onChange={e => sreg("epidural.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>

                <Box sx={{ display: "flex", gap: 2, gridColumn: "1/-1" }}>
                  <RdoGroup label="Extent of Block" options={["Checked", "Not checked"]} value={reg.epidural.blockExtent} onChange={v => sreg("epidural.blockExtent", v)} />
                  {reg.epidural.blockExtent === "Checked" && <TextField label="Details" value={reg.epidural.blockExtentDetails || ""} size="small" onChange={e => sreg("epidural.blockExtentDetails", e.target.value)} sx={{ ...inputSx, flex: 1, mt: 2 }} />}
                </Box>

                <Box sx={{ gridColumn: "1/-1" }}><CbxGroup label="Complications" options={["None", "Inadequate", "Intravascular injection", "Dural puncture", "High block", "Others"]} value={reg.epidural.complications} onChange={v => sreg("epidural.complications", v)} /></Box>
              </FG>
            </SectionBox>
          )}

          {reg.showCSE && (
            <SectionBox title="3. Combined Spinal Epidural (CSE)">
              <FG cols={1}>
                <RdoGroup label="Technique" options={["Spinal followed by Epidural", "Epidural followed by Spinal"]} value={reg.cseTechnique} onChange={v => sreg("cseTechnique", v)} />
              </FG>
              <Typography sx={{ mt: 1, fontSize: 11, fontFamily: FONT, color: C.textMuted }}>* Please also open both Spinal and Epidural sections above to fill in the respective details.</Typography>
            </SectionBox>
          )}

          {reg.showPNB && (
            <SectionBox title="4. Peripheral Nerve Block">
              <Box sx={{ mb: 1.5 }}>
                <CbxGroup label="Name of Block" options={["Brachial Plexus - Interscalene", "Brachial Plexus - Supraclavicular", "Brachial Plexus - Axillary", "Other Upper Limb", "Femoral", "Sciatic", "Other Lower Limb", "Others"]} value={reg.pnb.nerve || []} onChange={v => sreg("pnb.nerve", v)} />
                <FlagNote>Multiple choice possible</FlagNote>
              </Box>
              <FG cols={3}>
                <RdoGroup label="Posture" options={["Lateral", "Sitting"]} value={reg.pnb.posture} onChange={v => sreg("pnb.posture", v)} />
                <RdoGroup label="Laterality" options={["Right", "Left", "Bilateral"]} value={reg.pnb.laterality} onChange={v => sreg("pnb.laterality", v)} />
                <CbxGroup label="Technique" options={["USG Guided", "Nerve Stimulator Guided", "Landmark Technique"]} value={reg.pnb.technique || []} onChange={v => sreg("pnb.technique", v)} />
                <TextField label="Needle Type" value={reg.pnb.needleType} size="small" onChange={e => sreg("pnb.needleType", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Size" value={reg.pnb.needleSize} size="small" onChange={e => sreg("pnb.needleSize", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Site of Insertion" value={reg.pnb.site} size="small" onChange={e => sreg("pnb.site", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Time" options={["Start of Surgery", "End of Surgery"]} value={reg.pnb.timing} onChange={v => sreg("pnb.timing", v)} />
                  {(reg.pnb.timing || []).length > 0 && (
                    <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                      {reg.pnb.timing.includes("Start of Surgery") && (
                        <TextField label="Start Time" type="time" value={reg.pnb.startTime || ""} size="small" onChange={e => sreg("pnb.startTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                      {reg.pnb.timing.includes("End of Surgery") && (
                        <TextField label="End Time" type="time" value={reg.pnb.endTime || ""} size="small" onChange={e => sreg("pnb.endTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                    </Box>
                  )}
                </Box>
                <TextField label="Local Anaesthetic" value={reg.pnb.la} size="small" onChange={e => sreg("pnb.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.pnb.concentration} size="small" onChange={e => sreg("pnb.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.pnb.volume} size="small" onChange={e => sreg("pnb.volume", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug, Concentration, Volume)" value={reg.pnb.adjuvants} size="small" multiline rows={2} onChange={e => sreg("pnb.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>
                <RdoGroup label="Catheter" options={["Yes", "No"]} value={reg.pnb.catheter} onChange={v => sreg("pnb.catheter", v)} />
                <Box sx={{ display: "flex", gap: 2, gridColumn: "span 2" }}>
                  <RdoGroup label="Extent of Block" options={["Checked", "Not checked"]} value={reg.pnb.blockExtent} onChange={v => sreg("pnb.blockExtent", v)} />
                  {reg.pnb.blockExtent === "Checked" && <TextField label="Details" value={reg.pnb.blockExtentDetails || ""} size="small" onChange={e => sreg("pnb.blockExtentDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />}
                </Box>
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Complications" value={reg.pnb.complications} size="small" multiline rows={2} onChange={e => sreg("pnb.complications", e.target.value)} sx={inputSx} fullWidth placeholder="Complications if any" /></Box>
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Any Other Comments" value={reg.pnb.comments} size="small" multiline rows={2} onChange={e => sreg("pnb.comments", e.target.value)} sx={inputSx} fullWidth /></Box>
              </FG>
            </SectionBox>
          )}

          {reg.showFascial && (
            <SectionBox title="5. Fascial Plane Block">
              <Box sx={{ mb: 1.5 }}>
                <CbxGroup label="Name of Fascial Block" options={["Thoracic", "Abdominal", "Others"]} value={reg.fascial.block || []} onChange={v => sreg("fascial.block", v)} />
                <FlagNote>Multiple choice possible with details of each option</FlagNote>
              </Box>
              <FG cols={3}>
                <RdoGroup label="Laterality" options={["Right", "Left", "Bilateral"]} value={reg.fascial.laterality} onChange={v => sreg("fascial.laterality", v)} />
                <RdoGroup label="Posture" options={["Lateral", "Sitting"]} value={reg.fascial.posture} onChange={v => sreg("fascial.posture", v)} />
                <RdoGroup label="USG Guided" options={["Yes", "No"]} value={reg.fascial.usg} onChange={v => sreg("fascial.usg", v)} />
                <TextField label="Needle Type" value={reg.fascial.needleType} size="small" onChange={e => sreg("fascial.needleType", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Size" value={reg.fascial.needleSize} size="small" onChange={e => sreg("fascial.needleSize", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}>
                  <CbxGroup label="Time" options={["Start of Surgery", "End of Surgery"]} value={reg.fascial.timing} onChange={v => sreg("fascial.timing", v)} />
                  {(reg.fascial.timing || []).length > 0 && (
                    <Box sx={{ display: "flex", gap: 2, mt: 1 }}>
                      {reg.fascial.timing.includes("Start of Surgery") && (
                        <TextField label="Start Time" type="time" value={reg.fascial.startTime || ""} size="small" onChange={e => sreg("fascial.startTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                      {reg.fascial.timing.includes("End of Surgery") && (
                        <TextField label="End Time" type="time" value={reg.fascial.endTime || ""} size="small" onChange={e => sreg("fascial.endTime", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
                      )}
                    </Box>
                  )}
                </Box>
                <TextField label="Local Anaesthetic" value={reg.fascial.la} size="small" onChange={e => sreg("fascial.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.fascial.concentration} size="small" onChange={e => sreg("fascial.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.fascial.volume} size="small" onChange={e => sreg("fascial.volume", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug, Concentration, Volume)" value={reg.fascial.adjuvants} size="small" multiline rows={2} onChange={e => sreg("fascial.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>
                <RdoGroup label="Catheter" options={["Yes", "No"]} value={reg.fascial.catheter} onChange={v => sreg("fascial.catheter", v)} />
                <Box sx={{ display: "flex", gap: 2, gridColumn: "span 2" }}>
                  <RdoGroup label="Extent of Block" options={["Checked", "Not checked"]} value={reg.fascial.blockExtent} onChange={v => sreg("fascial.blockExtent", v)} />
                  {reg.fascial.blockExtent === "Checked" && <TextField label="Details" value={reg.fascial.blockExtentDetails || ""} size="small" onChange={e => sreg("fascial.blockExtentDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />}
                </Box>
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Complications" value={reg.fascial.complications} size="small" multiline rows={2} onChange={e => sreg("fascial.complications", e.target.value)} sx={inputSx} fullWidth placeholder="Complications if any" /></Box>
              </FG>
            </SectionBox>
          )}

          {reg.showIVRA && (
            <SectionBox title="6. IVRA (Bier's Block)">
              <FG cols={3}>
                <RdoGroup label="Site" options={["Upper", "Lower"]} value={reg.ivra.limb} onChange={v => sreg("ivra.limb", v)} />
                <TextField label="Duration (minutes)" value={reg.ivra.duration} type="number" size="small" onChange={e => sreg("ivra.duration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Local Anaesthetic Name" value={reg.ivra.la} size="small" onChange={e => sreg("ivra.la", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Concentration (%)" value={reg.ivra.concentration} size="small" onChange={e => sreg("ivra.concentration", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Volume (ml)" value={reg.ivra.volume} size="small" onChange={e => sreg("ivra.volume", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Adjuvants (Drug, Concentration, Volume)" value={reg.ivra.adjuvants} size="small" multiline rows={2} onChange={e => sreg("ivra.adjuvants", e.target.value)} sx={inputSx} fullWidth /></Box>
                <TextField label="Extent of Block" value={reg.ivra.blockExtent} size="small" onChange={e => sreg("ivra.blockExtent", e.target.value)} sx={inputSx} fullWidth placeholder="Block details" />
                <TextField label="Tourniquet Details" value={reg.ivra.tourniquet} size="small" onChange={e => sreg("ivra.tourniquet", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ gridColumn: "1/-1" }}><TextField label="Complications" value={reg.ivra.complications} size="small" multiline rows={2} onChange={e => sreg("ivra.complications", e.target.value)} sx={inputSx} fullWidth placeholder="Complications if any" /></Box>
              </FG>
            </SectionBox>
          )}

          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.reg", reg)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Regional Anaesthesia</Button>
        </Box>
      )}

      {/* ── Sub-tab 4: MAC / Local */}
      {sub === 3 && (
        <Box>
          <AnaesthesiaHistoryTable history={history} currentBookingId={currentBookingId} sectionKey="mac" title="MAC / Local" />
          <SectionBox title="Local Anaesthetic">
            <FG cols={3}>
              <TextField label="Drug Name" value={mac.laDrug} size="small" onChange={e => smac("laDrug", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Concentration (%)" value={mac.laConc} size="small" onChange={e => smac("laConc", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Volume (ml)" value={mac.laVolume} size="small" onChange={e => smac("laVolume", e.target.value)} sx={inputSx} fullWidth />
              <CbxGroup label="Route" options={["Infiltration", "Topical Application", "Others"]} value={mac.laRoute} onChange={v => smac("laRoute", v)} />
            </FG>
          </SectionBox>
          <SectionBox title="Additives">
            <FG cols={3}>
              <TextField label="Name of Drug" value={mac.additiveDrug} size="small" onChange={e => smac("additiveDrug", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Concentration (%)" value={mac.additiveConc} size="small" onChange={e => smac("additiveConc", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Volume (ml)" value={mac.additiveVolume} size="small" onChange={e => smac("additiveVolume", e.target.value)} sx={inputSx} fullWidth />
            </FG>
          </SectionBox>
          <SectionBox title="Sedatives">
            <FlagNote>Multiple choice possible</FlagNote>
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 2, mt: 1.5 }}>
              {[["Propofol", "propofol", "mg"], ["Ketamine", "ketamine", "mg"], ["Midazolam", "midazolam", "mg"], ["Fentanyl", "fentanyl", "mcg"], ["Dexmedetomidine", "dexmedetomidine", "mcg"]].map(([label, key, unit]) => (
                <Box key={key} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, minWidth: 120 }}>{label}</Typography>
                  <TextField value={mac[key]} size="small" placeholder={`Dose (${unit})`} onChange={e => smac(key, e.target.value)} sx={{ ...inputSx, flex: 1 }} />
                </Box>
              ))}
            </Box>
          </SectionBox>
          <SectionBox title="Monitoring & Complications">
            <FG cols={3}>
              <Sel label="Ramsay Sedation Scale" value={mac.ramsay} onChange={v => smac("ramsay", v)}
                options={["1 - Anxious/agitated", "2 - Cooperative/oriented", "3 - Responds to commands", "4 - Asleep/brisk response", "5 - Asleep/sluggish response", "6 - No response"]} />
              <RdoGroup label="Oxygen Supplementation" options={["No", "Nasal Prongs", "Face Mask", "Others"]} value={mac.oxygenSupp} onChange={v => smac("oxygenSupp", v)} />
              <Box sx={{ gridColumn: "1/-1" }}><CbxGroup label="Complications" options={["Emergency Airway intervention needed", "Conversion to GA", "Others"]} value={mac.complications} onChange={v => smac("complications", v)} /></Box>
            </FG>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.mac", mac)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save MAC / Local</Button>
        </Box>
      )}

      {/* ── Sub-tab 5: Intra-op / Fluids */}
      {sub === 4 && (
        <Box>
          <AnaesthesiaHistoryTable history={history} currentBookingId={currentBookingId} sectionKey="io" title="Intra-op / Fluids" />
          <SectionBox title="Patient Position & Warming">
            <FG cols={3}>
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Patient Position" options={["Supine", "Supine with extension of head", "Supine with Lithotomy", "Trendelenberg", "Reverse Trendelenberg", "Prone", "Semi Prone", "Right Lateral", "Left Lateral", "Others"]} value={io.patientPosition} onChange={v => sio("patientPosition", v)} />
              </Box>
              <RdoGroup label="Pressure Areas Padded" options={["Yes", "No"]} value={io.pressureAreas} onChange={v => sio("pressureAreas", v)} />
              <RdoGroup label="Eyes Shut and Taped" options={["Yes", "No"]} value={io.eyesShut} onChange={v => sio("eyesShut", v)} />
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Maintenance of Normothermia" options={["None", "Inline Fluid Warmer", "Warming Blanket", "Warming Mattress", "Others"]} value={io.normothermia} onChange={v => sio("normothermia", v)} />
              </Box>
              <CbxGroup label="Temperature Monitoring" options={["None", "Skin", "Nasopharyngeal", "Oro-esophageal", "Other core"]} value={io.tempMonitoring} onChange={v => sio("tempMonitoring", v)} />
            </FG>
          </SectionBox>

          <SectionBox title="IV Fluids">
            <TableContainer>
              <Table size="small">
                <TableHead><TableRow><TableCell sx={thSx}>Fluid Type</TableCell><TableCell sx={thSx}>Volume (ml)</TableCell></TableRow></TableHead>
                <TableBody>
                  {[["Ringer Lactate", "ringerLactate"], ["Normal Saline", "normalSaline"], ["Dextrose Normal Saline", "dns"], ["5% Dextrose", "dextrose5"], ["10% Dextrose", "dextrose10"], ["Plasmalyte", "plasmalyte"], ["Gelofusine", "gelofusine"], ["Albumin 20%", "albumin20"], ["Albumin 5%", "albumin5"], ["Mannitol 20%", "mannitol20"], ["1% DRL", "drl1"], ["2% DRL", "drl2"], ["Others", "others"]].map(([label, key]) => (
                    <TableRow key={key} sx={{ "&:hover": { background: C.bgSecondary } }}>
                      <TableCell sx={tdSx}>{label}</TableCell>
                      <TableCell sx={tdSx}><TextField type="number" size="small" placeholder="ml" value={io.ivFluids[key]} onChange={e => sivf(key, e.target.value)} sx={{ ...inputSx, width: 120 }} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </SectionBox>

          <SectionBox title="Blood / Blood Products / Coagulation Products">
            <FlagNote>Multiple choice possible. Mention Volume, Bag No, Reaction for each.</FlagNote>
            <Box sx={{ mt: 1, overflowX: "auto" }}>
              <Table size="small">
                <TableHead>
                  <TableRow>{["Product", "Volume (ml)", "Bag No", "Reaction", "Reaction Details"].map(h => <TableCell key={h} sx={thSx}>{h}</TableCell>)}</TableRow>
                </TableHead>
                <TableBody>
                  {io.bloodProducts.map((bp, i) => (
                    <TableRow key={bp.product} sx={{ "&:hover": { background: C.bgSecondary } }}>
                      <TableCell sx={tdSx}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                          <Checkbox size="small" checked={bp.checked} onChange={e => sbp(i, "checked", e.target.checked)} sx={{ color: C.border, "&.Mui-checked": { color: C.black }, p: 0.4 }} />
                          <Typography sx={{ fontSize: 12, fontFamily: FONT }}>{bp.product}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={tdSx}><TextField type="number" size="small" placeholder="ml" value={bp.volume} onChange={e => sbp(i, "volume", e.target.value)} sx={{ ...inputSx, width: 90 }} disabled={!bp.checked} /></TableCell>
                      <TableCell sx={tdSx}><TextField size="small" placeholder="Bag#" value={bp.bagNo} onChange={e => sbp(i, "bagNo", e.target.value)} sx={{ ...inputSx, width: 90 }} disabled={!bp.checked} /></TableCell>
                      <TableCell sx={tdSx}>
                        <RadioGroup row value={bp.reaction} onChange={e => sbp(i, "reaction", e.target.value)}>
                          {["Yes", "No"].map(v => <FormControlLabel key={v} value={v} control={<Radio size="small" sx={{ color: C.border, "&.Mui-checked": { color: C.black }, p: 0.4 }} />} label={<Typography sx={{ fontSize: 11, fontFamily: FONT }}>{v}</Typography>} disabled={!bp.checked} />)}
                        </RadioGroup>
                      </TableCell>
                      <TableCell sx={tdSx}><TextField size="small" placeholder="Details if yes" value={bp.details} onChange={e => sbp(i, "details", e.target.value)} sx={{ ...inputSx, width: 160 }} disabled={!bp.checked || bp.reaction !== "Yes"} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
          </SectionBox>

          <SectionBox title="Intra-Operative Medications">
            <FG cols={3}>
              <TextField label="Analgesics" value={io.ioMedAnalgesics} size="small" multiline rows={2} onChange={e => sio("ioMedAnalgesics", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., Paracetamol, Diclofenac, Fentanyl" />
              <TextField label="Antiemetics" value={io.ioMedAntiemetics} size="small" multiline rows={2} onChange={e => sio("ioMedAntiemetics", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., Ondansetron, Dexamethasone" />
              <TextField label="Antibiotics" value={io.ioMedAntibiotics} size="small" multiline rows={2} onChange={e => sio("ioMedAntibiotics", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., Ceftriaxone, Cefuroxime (with time)" />
              <TextField label="Vasoactive / Emergency Drugs" value={io.ioMedVasoactive} size="small" multiline rows={2} onChange={e => sio("ioMedVasoactive", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., Ephedrine, Noradrenaline" />
              <Box sx={{ gridColumn: "span 2" }}>
                <TextField label="Other Medications" value={io.ioMedOthers} size="small" multiline rows={2} onChange={e => sio("ioMedOthers", e.target.value)} sx={inputSx} fullWidth placeholder="Any other intra-operative medications" />
              </Box>
            </FG>
          </SectionBox>

          <SectionBox title="Total Output">
            <FG cols={3}>
              <TextField label="Blood Loss (ml)" value={io.bloodLoss} type="number" size="small" onChange={e => sio("bloodLoss", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Urine Output (ml)" value={io.urineOutput} type="number" size="small" onChange={e => sio("urineOutput", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Other Losses" value={io.otherLosses} size="small" onChange={e => sio("otherLosses", e.target.value)} sx={inputSx} fullWidth placeholder="Specify" />
            </FG>
          </SectionBox>

          <SectionBox title="Intra-Operative Complications">
            <Box>
              <CbxGroup label="Complications" options={["Airway related", "Cardiovascular", "Respiratory", "Haemorrhagic", "CNS", "Dyselectrolytemia", "Other Metabolic", "Others"]} value={io.complications} onChange={v => sio("complications", v)} />
              <FlagNote>Multiple option, details of each option</FlagNote>
            </Box>
            <Box sx={{ mt: 1.5 }}>
              <TextField label="Details of Complications" value={io.complicationDetails} size="small" multiline rows={3} onChange={e => sio("complicationDetails", e.target.value)} sx={inputSx} fullWidth placeholder="Describe each complication" />
            </Box>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.io", io)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Intra-op / Fluids</Button>
        </Box>
      )}

      {/* ── Sub-tab 6: End Op / Post-op */}
      {sub === 5 && (
        <Box>
          <AnaesthesiaHistoryTable history={history} currentBookingId={currentBookingId} sectionKey="eo" title="End Op / Post-op" />
          <SectionBox title="End Op Notes">
            <FG cols={3}>
              <TextField label="Reversal at Time" value={eo.reversalTime} type="time" size="small" onChange={e => seo("reversalTime", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
              <CbxGroup label="Reversal Drug" options={["Neostigmine + Glycopyrrolate", "Sugamadex", "None"]} value={eo.reversalDrug} onChange={v => seo("reversalDrug", v)} />
              <TextField label="Reversal Dose" value={eo.reversalDose} size="small" onChange={e => seo("reversalDose", e.target.value)} sx={inputSx} fullWidth placeholder="Dose details" />
              <RdoGroup label="Extubation" options={["Uneventful", "Needed Reintubation", "Not Extubated"]} value={eo.extubation} onChange={v => seo("extubation", v)} />
              <RdoGroup label="Post Op Ventilation" options={["No", "Planned", "Unplanned"]} value={eo.postOpVent} onChange={v => seo("postOpVent", v)} />
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Vasoactive Drugs at End of Surgery" options={["Adrenaline", "Nor-Adrenaline", "Dobutamine", "Vasopressin", "Amiodarone", "NTG", "Labetalol", "Esmolol", "Others"]} value={eo.vasoactiveDrugs} onChange={v => seo("vasoactiveDrugs", v)} />
                <FlagNote>With infusion rates. Multiple choice possible.</FlagNote>
              </Box>
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Post Extubation Complications" options={["Laryngospasm", "Bronchospasm", "Upper airway obstruction", "Hypoventilation", "Hypopnoea", "Others"]} value={eo.postExtubComps} onChange={v => seo("postExtubComps", v)} />
              </Box>
            </FG>
          </SectionBox>

          <SectionBox title="End Op Vital Parameters">
            <FG cols={3}>
              <Box sx={{ gridColumn: "1/-1" }}>
                <RdoGroup label="Patient Condition" options={["Patient fully awake and obeys commands", "Patient sleepy but unobstructed airway", "Sedated on Ventilator support"]} value={eo.patientCondition} onChange={v => seo("patientCondition", v)} />
              </Box>
              <TextField label="PR (bpm)" value={eo.pr} type="number" size="small" onChange={e => seo("pr", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="BP (mmHg)" value={eo.bp} size="small" onChange={e => seo("bp", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., 120/80" />
              <TextField label="SpO2 (%)" value={eo.spo2} type="number" size="small" onChange={e => seo("spo2", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="RR (breaths/min)" value={eo.rr} type="number" size="small" onChange={e => seo("rr", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Temperature (°C)" value={eo.temperature} type="number" size="small" onChange={e => seo("temperature", e.target.value)} sx={inputSx} fullWidth />
              <Box sx={{ gridColumn: "1/-1" }}>
                <RdoGroup label="Patient Shifted With Airway Adjunct" options={["Endotracheal Tube", "Tracheostomy Tube", "Oropharyngeal Airway", "Nasopharyngeal Airway", "None of the above"]} value={eo.airwayAdjunct} onChange={v => seo("airwayAdjunct", v)} />
                <FlagNote>Single choice possible</FlagNote>
              </Box>
              <RdoGroup label="Level of Post Op Monitoring" options={["Routine", "High Dependency", "Intensive Care"]} value={eo.monitorLevel} onChange={v => seo("monitorLevel", v)} />
            </FG>
          </SectionBox>

          <SectionBox title="Post Operative Advice">
            <FG cols={3}>
              <RdoGroup label="Oxygen Supplementation" options={["Yes", "No"]} value={eo.oxygenSupp} onChange={v => seo("oxygenSupp", v)} />
              <TextField label="NPO For (Hours)" value={eo.npoHours} type="number" size="small" onChange={e => seo("npoHours", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="IVF Maintenance (ml/hour)" value={eo.ivfRate} type="number" size="small" onChange={e => seo("ivfRate", e.target.value)} sx={inputSx} fullWidth />
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Analgesics Orders" value={eo.analgesics} size="small" multiline rows={2} onChange={e => seo("analgesics", e.target.value)} sx={inputSx} fullWidth placeholder="Analgesic protocol" /></Box>
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Antiemetics Given" value={eo.antiemetics} size="small" multiline rows={2} onChange={e => seo("antiemetics", e.target.value)} sx={inputSx} fullWidth /></Box>
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Pre-op Chronic Medications" value={eo.chronicMeds} size="small" multiline rows={2} onChange={e => seo("chronicMeds", e.target.value)} sx={inputSx} fullWidth placeholder="Continue/Stop medications" /></Box>
              <Box sx={{ gridColumn: "1/-1" }}>
                <CbxGroup label="Investigations" options={["CBC", "Electrolytes", "Biochemistry", "Coagulation", "TEG", "X-ray", "ECG", "Others"]} value={eo.investigations} onChange={v => seo("investigations", v)} />
              </Box>
              <Box sx={{ gridColumn: "1/-1" }}><TextField label="Other Comments" value={eo.otherComments} size="small" multiline rows={3} onChange={e => seo("otherComments", e.target.value)} sx={inputSx} fullWidth placeholder="Additional post-op instructions" /></Box>
            </FG>
          </SectionBox>
          <Button sx={saveBtnSx} onClick={() => onSave("anaesthesia.eo", eo)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save End Op / Post-op</Button>
        </Box>
      )}
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// STAGING COMPARISON PANEL (shared read-only component)
// Shows: Pre-Op cTNM | Intra-Op sTNM | Post-Op pTNM side-by-side
// ─────────────────────────────────────────────────────────────────────────────
const StagingComparisonPanel = ({ bookingData, livePathStaging }) => {
  const dn = bookingData?.doctors_note || bookingData?.fullBooking?.doctors_note || {};
  const mg = bookingData?.management || bookingData?.fullBooking?.management || {};
  const po = livePathStaging || bookingData?.post_op || bookingData?.fullBooking?.post_op || {};

  const cT = dn.clinicalStagingT || ""; const cN = dn.clinicalStagingN || ""; const cM = dn.clinicalStagingM || "";
  const cStage = dn.clinicalStageGroup || ""; const cDiag = dn.clinicalDiagnosis || "";
  const sT = mg.stagingT || ""; const sN = mg.stagingN || ""; const sM = mg.stagingM || "";
  const pT = po.pathStagingT || ""; const pN = po.pathStagingN || ""; const pM = po.pathStagingM || "";
  const pStage = po.pathStageGroup || ""; const pDiag = po.pathDiagnosis || "";

  const hasAnyData = (cT || cN || cM || sT || sN || sM || pT || pN || pM);
  if (!hasAnyData) return null;

  const extractNum = (s) => { const m = String(s || "").match(/\d/); return m ? parseInt(m[0]) : null; };

  // For each T/N component, compare clinical (prefer cTNM, fall back to sTNM) vs pathological
  const getChange = (clinVal, intVal, pathVal) => {
    const ref = clinVal || intVal;
    const c = extractNum(ref); const p = extractNum(pathVal);
    if (p === null || c === null) return null; // not enough data to compare
    if (p > c) return "up";
    if (p < c) return "down";
    return "same";
  };
  const tChange = getChange(cT, sT, pT);
  const nChange = getChange(cN, sN, pN);

  // Overall concordance
  const tNum = extractNum(cT || sT); const pTNum = extractNum(pT);
  const nNum = extractNum(cN || sN); const pNNum = extractNum(pN);
  let concordance = null;
  if (pTNum !== null || pNNum !== null) {
    const anyUp = (pTNum !== null && tNum !== null && pTNum > tNum) || (pNNum !== null && nNum !== null && pNNum > nNum);
    const anyDown = (pTNum !== null && tNum !== null && pTNum < tNum) || (pNNum !== null && nNum !== null && pNNum < nNum);
    if (anyUp) concordance = { label: "Upstaged", color: "#b91c1c", bg: "#fef2f2" };
    else if (anyDown) concordance = { label: "Downstaged", color: "#15803d", bg: "#f0fdf4" };
    else concordance = { label: "Concordant", color: "#1d4ed8", bg: "#eff6ff" };
  }

  // Inline sub-components
  const changeStyle = (ch) => ({
    "up":   { bg: "#fef2f2", border: "#b91c1c", text: "#b91c1c" },
    "down": { bg: "#f0fdf4", border: "#15803d", text: "#15803d" },
    "same": { bg: "#f8fafc", border: "#6b7280", text: "#374151" },
  }[ch] || { bg: "#fff", border: C.border, text: C.textPrimary });

  const TnmBadge = ({ prefix, val, change, showChange }) => {
    const s = showChange ? changeStyle(change) : { bg: "#fff", border: C.border, text: C.textPrimary };
    return (
      <Box sx={{ textAlign: "center" }}>
        <Typography sx={{ fontSize: 8, fontFamily: FONT, color: C.textMuted, mb: 0.4, textTransform: "uppercase", letterSpacing: "0.06em" }}>{prefix}</Typography>
        <Box sx={{ width: 42, height: 42, display: "flex", alignItems: "center", justifyContent: "center", border: `2px solid ${s.border}`, background: s.bg, position: "relative" }}>
          <Typography sx={{ fontSize: 14, fontFamily: "'Roboto Mono', monospace", fontWeight: "bold", color: val ? s.text : C.textMuted }}>
            {val || "—"}
          </Typography>
          {showChange && change === "up" && (
            <Box sx={{ position: "absolute", top: -9, right: -3, fontSize: 12, color: "#b91c1c", lineHeight: 1 }}>▲</Box>
          )}
          {showChange && change === "down" && (
            <Box sx={{ position: "absolute", top: -9, right: -3, fontSize: 12, color: "#15803d", lineHeight: 1 }}>▼</Box>
          )}
        </Box>
      </Box>
    );
  };

  const FactPill = ({ label, value, hi }) => {
    if (!value) return null;
    const palette = { danger: ["#fef2f2", "#b91c1c"], success: ["#f0fdf4", "#15803d"], warn: ["#fffbeb", "#b45309"], neutral: ["#f3f4f6", "#6b7280"] };
    const [bg, color] = palette[hi || "neutral"];
    return (
      <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, px: 1, py: 0.35, background: bg, border: `1px solid ${color}33`, mr: 0.75, mb: 0.5, flexShrink: 0 }}>
        <Typography sx={{ fontSize: 9, fontFamily: FONT, color, fontWeight: FW_BOLD, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</Typography>
        <Typography sx={{ fontSize: 10, fontFamily: FONT, color, fontWeight: FW_NORMAL }}>{value}</Typography>
      </Box>
    );
  };

  const StageBubble = ({ stage, color, bg, borderColor }) => !stage ? null : (
    <Box sx={{ mt: 1, display: "inline-block", px: 1.5, py: 0.3, background: bg, border: `1px solid ${borderColor}` }}>
      <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color }}>Stage {stage}</Typography>
    </Box>
  );

  const nodesPos = po.pathNodesPositive || ""; const nodesEx = po.pathNodesExamined || "";
  const hasHPR = po.pathResection || po.pathMarginStatus || po.pathLVI || po.pathPNI || po.pathGrade || nodesEx;

  return (
    <Box sx={{ mb: 3, border: `1px solid ${C.border}`, background: "#fff", overflow: "hidden" }}>
      {/* ── Header ── */}
      <Box sx={{ px: 2.5, py: 1.25, borderBottom: `1px solid ${C.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", background: C.bgSecondary }}>
        <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textPrimary }}>
          Staging Journey
        </Typography>
        {concordance && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.5, py: 0.35, background: concordance.bg, border: `1px solid ${concordance.color}` }}>
            <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: concordance.color, flexShrink: 0 }} />
            <Typography sx={{ fontSize: 10, fontFamily: FONT, fontWeight: FW_BOLD, color: concordance.color, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              {concordance.label}
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Main Journey Flow ── */}
      <Box sx={{ display: "flex", alignItems: "center", px: 2.5, py: 2.5, gap: 0 }}>

        {/* Column A: Pre-Op cTNM */}
        <Box sx={{ flex: 1, textAlign: "center" }}>
          <Box sx={{ pb: 0.75, mb: 1.75, borderBottom: "2px solid #1d4ed8", display: "inline-block", px: 1 }}>
            <Typography sx={{ fontSize: 9, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", color: "#1d4ed8", letterSpacing: "0.1em" }}>Pre-Op Clinical</Typography>
            <Typography sx={{ fontSize: 8, fontFamily: FONT, color: "#3b82f6", letterSpacing: "0.06em" }}>cTNM</Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "center", gap: 1 }}>
            <TnmBadge prefix="T" val={cT} showChange={false} />
            <TnmBadge prefix="N" val={cN} showChange={false} />
            <TnmBadge prefix="M" val={cM} showChange={false} />
          </Box>
          {cStage
            ? <StageBubble stage={cStage} color="#1d4ed8" bg="#eff6ff" borderColor="#1d4ed8" />
            : !cT && !cN && !cM && <Typography sx={{ fontSize: 9, fontFamily: FONT, color: C.textMuted, fontStyle: "italic", mt: 1 }}>Doctors Note tab</Typography>}
          {cDiag && <Typography sx={{ fontSize: 9, fontFamily: FONT, color: C.textMuted, mt: 0.75, fontStyle: "italic" }}>{cDiag}</Typography>}
        </Box>

        {/* Arrow + Intra-Op waypoint */}
        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, mx: 0.5 }}>
          <Typography sx={{ fontSize: 8, fontFamily: FONT, color: C.textMuted, mb: 0.5, textTransform: "uppercase", letterSpacing: "0.06em" }}>Intra-Op</Typography>
          {(sT || sN || sM) && (
            <Box sx={{ display: "flex", gap: 0.4, mb: 0.5 }}>
              {sT && <Box sx={{ px: 0.5, py: 0.2, background: "#f3f4f6", border: `1px solid ${C.border}` }}><Typography sx={{ fontSize: 9, fontFamily: "'Roboto Mono', monospace", color: "#374151" }}>{sT}</Typography></Box>}
              {sN && <Box sx={{ px: 0.5, py: 0.2, background: "#f3f4f6", border: `1px solid ${C.border}` }}><Typography sx={{ fontSize: 9, fontFamily: "'Roboto Mono', monospace", color: "#374151" }}>{sN}</Typography></Box>}
              {sM && <Box sx={{ px: 0.5, py: 0.2, background: "#f3f4f6", border: `1px solid ${C.border}` }}><Typography sx={{ fontSize: 9, fontFamily: "'Roboto Mono', monospace", color: "#374151" }}>{sM}</Typography></Box>}
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center" }}>
            <Box sx={{ width: 28, height: 1.5, background: C.border }} />
            <Box sx={{ fontSize: 18, color: C.border, lineHeight: 0.5, mx: -0.25 }}>▶</Box>
            <Box sx={{ width: 28, height: 1.5, background: concordance ? concordance.color : C.border }} />
          </Box>
        </Box>

        {/* Column B: Post-Op pTNM */}
        <Box sx={{ flex: 1, textAlign: "center" }}>
          <Box sx={{ pb: 0.75, mb: 1.75, borderBottom: `2px solid ${concordance?.color || C.border}`, display: "inline-block", px: 1 }}>
            <Typography sx={{ fontSize: 9, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", color: concordance?.color || C.textMuted, letterSpacing: "0.1em" }}>Post-Op Pathological</Typography>
            <Typography sx={{ fontSize: 8, fontFamily: FONT, color: concordance?.color || C.textMuted, letterSpacing: "0.06em" }}>pTNM · HPR</Typography>
          </Box>
          <Box sx={{ display: "flex", justifyContent: "center", gap: 1 }}>
            <TnmBadge prefix="pT" val={pT} change={tChange} showChange={true} />
            <TnmBadge prefix="pN" val={pN} change={nChange} showChange={true} />
            <TnmBadge prefix="pM" val={pM} showChange={false} />
          </Box>
          {pStage
            ? <StageBubble stage={pStage} color={concordance?.color || C.textPrimary} bg={concordance?.bg || "#f3f4f6"} borderColor={concordance?.color || C.border} />
            : !pT && !pN && !pM && <Typography sx={{ fontSize: 9, fontFamily: FONT, color: C.textMuted, fontStyle: "italic", mt: 1 }}>Awaiting HPR report</Typography>}
          {pDiag && <Typography sx={{ fontSize: 9, fontFamily: FONT, color: C.textMuted, mt: 0.75, fontStyle: "italic" }}>{pDiag}</Typography>}
        </Box>
      </Box>

      {/* ── HPR Quick Facts Strip ── */}
      {hasHPR && (
        <Box sx={{ borderTop: `1px solid ${C.border}`, px: 2.5, py: 1.25, background: C.bgSecondary }}>
          <Typography sx={{ fontSize: 8, fontFamily: FONT, fontWeight: FW_BOLD, textTransform: "uppercase", color: C.textMuted, mb: 0.75, letterSpacing: "0.1em" }}>HPR Quick Facts</Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap" }}>
            {(nodesPos || nodesEx) && <FactPill label="Nodes" value={`${nodesPos || "?"}/${nodesEx || "?"}`} hi={nodesPos && parseInt(nodesPos) > 0 ? "warn" : "success"} />}
            <FactPill label="R" value={po.pathResection} hi={po.pathResection === "R0" ? "success" : po.pathResection ? "danger" : null} />
            <FactPill label="Margins" value={po.pathMarginStatus} hi={po.pathMarginStatus === "Clear" ? "success" : po.pathMarginStatus === "Involved" ? "danger" : "neutral"} />
            <FactPill label="LVI" value={po.pathLVI} hi={po.pathLVI === "Yes" ? "danger" : po.pathLVI === "No" ? "success" : "neutral"} />
            <FactPill label="PNI" value={po.pathPNI} hi={po.pathPNI === "Yes" ? "danger" : po.pathPNI === "No" ? "success" : "neutral"} />
            {po.pathGrade && <FactPill label="Grade" value={po.pathGrade.replace("Differentiated", "Diff.")} hi="neutral" />}
          </Box>
        </Box>
      )}
    </Box>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// TAB 4 — POST OP COMPLICATIONS (Part F)
// ─────────────────────────────────────────────────────────────────────────────

const PostOpHistoryTable = ({ history = [], currentBookingId }) => {
  const [expanded, setExpanded] = useState(false);

  const historyData = history.filter(b => b.booking_id !== currentBookingId);

  if (historyData.length === 0) return null;

  return (
    <Box sx={{ mb: 3 }}>
      <Accordion expanded={expanded} onChange={() => setExpanded(!expanded)} sx={{ background: C.bgSecondary, border: `1px solid ${C.border}`, boxShadow: 'none', '&:before': { display: 'none' } }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />} sx={{ minHeight: 40, '& .MuiAccordionSummary-content': { my: 1 } }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_BOLD, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Past Post Op Complications ({historyData.length})</Typography>
        </AccordionSummary>
        <AccordionDetails sx={{ p: 0, borderTop: `1px solid ${C.border}` }}>
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={thSx}>Date</TableCell>
                  <TableCell sx={thSx}>Procedure</TableCell>
                  <TableCell sx={thSx}>Surgeon</TableCell>
                  <TableCell sx={thSx}>Complications</TableCell>
                  <TableCell sx={thSx}>Clavien Dindo</TableCell>
                  <TableCell sx={thSx}>Readmit / Mortality</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {historyData.map((b, i) => {
                  const po = b.post_op || {};
                  const hasData = po.hasComplications || po.clavienDindo || po.mortality30 || po.readmit30 || (po.complications && po.complications.length > 0);

                  return (
                    <TableRow key={i} sx={{ "&:hover": { background: C.bgPrimary } }}>
                      <TableCell sx={tdSx}>{b.date}</TableCell>
                      <TableCell sx={tdSx}>{b.procedure}</TableCell>
                      <TableCell sx={tdSx}>{b.surgeon}</TableCell>
                      {!hasData ? (
                        <TableCell colSpan={3} sx={{ ...tdSx, color: C.textMuted, fontStyle: 'italic', textAlign: 'center' }}>
                          No Post Op Data Recorded
                        </TableCell>
                      ) : (
                        <>
                          <TableCell sx={tdSx}>
                            {po.hasComplications === "Yes" ? (
                              <>
                                {(po.complications || []).join(", ")}
                                {po.description ? <Box sx={{ fontSize: 10, color: C.textMuted, mt: 0.5 }}>{po.description}</Box> : null}
                              </>
                            ) : "No"}
                          </TableCell>
                          <TableCell sx={tdSx}>{po.clavienDindo || "-"}</TableCell>
                          <TableCell sx={tdSx}>
                            <Box sx={{ fontSize: 11, color: C.textSecond }}>30D Readmit: <span style={{ color: C.textPrimary }}>{po.readmit30 || "-"}</span></Box>
                            <Box sx={{ fontSize: 11, color: C.textSecond }}>30D Mort: <span style={{ color: C.textPrimary }}>{po.mortality30 || "-"}</span></Box>
                            <Box sx={{ fontSize: 11, color: C.textSecond }}>90D Readmit: <span style={{ color: C.textPrimary }}>{po.readmit90 || "-"}</span></Box>
                            <Box sx={{ fontSize: 11, color: C.textSecond }}>90D Mort: <span style={{ color: C.textPrimary }}>{po.mortality90 || "-"}</span></Box>
                          </TableCell>
                        </>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        </AccordionDetails>
      </Accordion>
    </Box>
  );
};

const PostOpComplicationsTab = ({ initialData, onSave, patientId, currentBookingId, bookingData }) => {
  const [f, setF] = useState({
    unitName: "", hasComplications: "", complications: [], description: "",
    clavienDindo: "", readmit30: "", mortality30: "", readmit90: "", mortality90: "",
    // Pathological Staging (pTNM) — from HPR report
    pathStagingT: "", pathStagingN: "", pathStagingM: "", pathStageGroup: "",
    pathDiagnosis: "", pathNodesExamined: "", pathNodesPositive: "",
    pathResection: "", pathMarginStatus: "", pathLVI: "", pathPNI: "",
    pathGrade: "", pathReportDate: "", pathReportNotes: "",
    ...(initialData || {}),
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);

  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) setF(prev => ({ ...prev, ...initialData }));
  }, [initialData]);

  const [history, setHistory] = useState([]);
  useEffect(() => {
    if (patientId) {
      getPostOpHistory(patientId)
        .then(res => {
          if (res && res.data) setHistory(res.data);
        })
        .catch(err => console.error("[PostOpComplicationsTab] Failed to fetch history:", err));
    }
  }, [patientId]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access denied or not available.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");
          const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
          const data = await res.json();
          console.log("ElevenLabs API Response:", data);
          const transcribedText = data.text || data.transcription || "";

          if (transcribedText) {
            console.log("Transcribed Text:", transcribedText);
            setTranscript(prev => prev ? prev + " " + transcribedText : transcribedText);
          }
        } catch (err) {
          console.error("Error processing audio:", err);
          alert("Error transcribing data.");
        } finally {
          setIsProcessing(false);
        }
      };
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleAutofill = async () => {
    if (!transcript) return;
    setIsAutofilling(true);
    try {
      const llmRes = await fetch(`${API_BASE_URL}hms/users/data/surgical-oncology/post-op/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript })
      });
      const llmData = await llmRes.json();
      console.log("LLM Structured Data (Post-Op):", llmData);
      if (llmData.status === "success" && llmData.data) {
        // Ensure unitName is not overwritten if missing in LLM data or specifically ignored.
        // Also safely merge arrays and prevent empty/null values from wiping existing data.
        setF(prev => {
          const next = { ...prev };
          Object.entries(llmData.data).forEach(([k, v]) => {
            if (k === "unitName") return;
            const incomingEmpty = v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
            if (!incomingEmpty) {
              if (Array.isArray(next[k]) && Array.isArray(v)) {
                next[k] = Array.from(new Set([...next[k], ...v]));
              } else {
                next[k] = v;
              }
            }
          });
          return next;
        });
      }
    } catch (err) {
      console.error("Error structuring data:", err);
      alert("Error structuring data.");
    } finally {
      setIsAutofilling(false);
    }
  };

  return (
    <Box>
      <PostOpHistoryTable history={history} currentBookingId={currentBookingId} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 2 }}>
        <SectionBox title="Speech-to-Text Transcript">
          <TextField
            label="Transcript"
            value={transcript}
            size="small"
            multiline
            rows={4}
            onChange={e => setTranscript(e.target.value)}
            sx={inputSx}
            fullWidth
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1.5, mt: 1.5 }}>
            <Button
              variant="contained"
              color={isRecording ? "error" : "primary"}
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing || isAutofilling}
              sx={{ fontFamily: FONT, textTransform: 'none', borderRadius: 1, boxShadow: 'none', background: isRecording ? '#cf1322' : C.black, color: C.white, '&:hover': { background: isRecording ? '#a8071a' : '#333' } }}
              startIcon={isRecording ? <StopRounded /> : <MicRounded />}
            >
              {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
            </Button>
            <Button
              variant="contained"
              onClick={handleAutofill}
              disabled={isAutofilling || !transcript}
              sx={{ fontFamily: FONT, textTransform: 'none', borderRadius: 1, boxShadow: 'none', background: C.black, color: C.white, '&:hover': { background: '#333' } }}
            >
              {isAutofilling ? "Autofilling..." : "AI Autofill"}
            </Button>
          </Box>
        </SectionBox>
      </Box>
      <SectionBox title="Primary Details">
        <FG cols={2}>
          <Box><TextField label="Unit Name" value={f.unitName} size="small" onChange={e => set("unitName", e.target.value)} sx={inputSx} fullWidth /><FlagNote>This module available for OP and IP</FlagNote></Box>
          <Box><RdoGroup label="Post Op Complications?" options={["Yes", "No"]} value={f.hasComplications} onChange={v => set("hasComplications", v)} /><FlagNote>Further options appear only if Yes</FlagNote></Box>
        </FG>
      </SectionBox>
      {f.hasComplications === "Yes" && (
        <SectionBox title="Complication Details">
          <Box sx={{ mb: 2 }}>
            <CbxGroup label="Complication(s)" options={["Surgical Site Infection", "Wound Dehiscence", "Anastomotic Leak", "Haemorrhage", "Seroma", "Lymphoedema", "Flap Failure", "Nerve Injury", "Urinary Retention", "Pneumonia", "DVT/PE", "Cardiac Event", "Respiratory Failure", "Renal Failure", "Sepsis", "Ileus", "Others"]} value={f.complications} onChange={v => set("complications", v)} />
            <FlagNote>Multiple choice possible. Option of Others available.</FlagNote>
          </Box>
          <TextField label="Describe Complications" value={f.description} size="small" multiline rows={4} onChange={e => set("description", e.target.value)} sx={{ ...inputSx, mb: 2 }} fullWidth />
          <Box><RdoGroup label="Clavien-Dindo Grading" options={["Grade 1", "Grade 2", "Grade 3", "Grade 3a", "Grade 3b", "Grade 4", "Grade 4a", "Grade 4b", "Grade 5"]} value={f.clavienDindo} onChange={v => set("clavienDindo", v)} /></Box>
        </SectionBox>
      )}
      <SectionBox title="Outcome Tracking">
        <FG cols={2}>
          <Box><RdoGroup label="30-Day Re-Admission" options={["Yes", "No"]} value={f.readmit30} onChange={v => set("readmit30", v)} /></Box>
          <Box><RdoGroup label="30-Day Mortality" options={["Yes", "No"]} value={f.mortality30} onChange={v => set("mortality30", v)} /></Box>
          <Box><RdoGroup label="90-Day Re-Admission" options={["Yes", "No"]} value={f.readmit90} onChange={v => set("readmit90", v)} /></Box>
          <Box><RdoGroup label="90-Day Mortality" options={["Yes", "No"]} value={f.mortality90} onChange={v => set("mortality90", v)} /></Box>
        </FG>
      </SectionBox>

      <SectionBox title="Pathological Staging (HPR Report)">
        <FG cols={3}>
          <Box>
            <FieldLabel>Pathological TNM (pTNM)</FieldLabel>
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField label="pT" value={f.pathStagingT} size="small" onChange={e => set("pathStagingT", e.target.value)} sx={inputSx} fullWidth placeholder="T0-T4" />
              <TextField label="pN" value={f.pathStagingN} size="small" onChange={e => set("pathStagingN", e.target.value)} sx={inputSx} fullWidth placeholder="N0-N3" />
              <TextField label="pM" value={f.pathStagingM} size="small" onChange={e => set("pathStagingM", e.target.value)} sx={inputSx} fullWidth placeholder="M0/M1" />
            </Box>
          </Box>
          <TextField label="Overall pStage" value={f.pathStageGroup} size="small" onChange={e => set("pathStageGroup", e.target.value)} sx={inputSx} fullWidth placeholder="e.g. IIA, III" />
          <TextField label="HPR Report Date" type="date" value={f.pathReportDate} size="small" onChange={e => set("pathReportDate", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
          <Box sx={{ gridColumn: "1/-1" }}>
            <TextField label="Final Pathological Diagnosis" value={f.pathDiagnosis} size="small" multiline rows={2} onChange={e => set("pathDiagnosis", e.target.value)} sx={inputSx} fullWidth placeholder="Final diagnosis from histopathology report" />
          </Box>
          <Box>
            <FieldLabel>Lymph Node Status</FieldLabel>
            <Box sx={{ display: "flex", gap: 1 }}>
              <TextField label="Nodes Examined" value={f.pathNodesExamined} size="small" type="number" onChange={e => set("pathNodesExamined", e.target.value)} sx={inputSx} fullWidth />
              <TextField label="Nodes Positive" value={f.pathNodesPositive} size="small" type="number" onChange={e => set("pathNodesPositive", e.target.value)} sx={inputSx} fullWidth />
            </Box>
          </Box>
          <RdoGroup label="Pathological Resection (R)" options={["R0", "R1", "R2"]} value={f.pathResection} onChange={v => set("pathResection", v)} />
          <RdoGroup label="Margin Status" options={["Clear", "Involved", "Close"]} value={f.pathMarginStatus} onChange={v => set("pathMarginStatus", v)} />
          <RdoGroup label="Lymphovascular Invasion (LVI)" options={["Yes", "No", "Indeterminate"]} value={f.pathLVI} onChange={v => set("pathLVI", v)} />
          <RdoGroup label="Perineural Invasion (PNI)" options={["Yes", "No", "Indeterminate"]} value={f.pathPNI} onChange={v => set("pathPNI", v)} />
          <RdoGroup label="Tumour Grade" options={["Well Differentiated", "Moderately Differentiated", "Poorly Differentiated", "Undifferentiated"]} value={f.pathGrade} onChange={v => set("pathGrade", v)} />
          <Box sx={{ gridColumn: "1/-1" }}>
            <TextField label="Additional Pathology Notes" value={f.pathReportNotes} size="small" multiline rows={2} onChange={e => set("pathReportNotes", e.target.value)} sx={inputSx} fullWidth />
          </Box>
        </FG>
      </SectionBox>

      <Button sx={{ ...saveBtnSx, mb: 3 }} onClick={() => onSave("post_op", f)}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Complications</Button>
      <StagingComparisonPanel bookingData={bookingData} livePathStaging={f} />
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// TAB 5 — DIAGRAMMATIC TEMPLATE (Part G) — Simplified
// ─────────────────────────────────────────────────────────────────────────────
const DOC_TYPES = ["Pre-op Image", "Intra-op Image", "Post-op Image", "Pathology Report", "Imaging (CT/MRI)", "Video Clip", "Diagram/Sketch", "Other"];

const DiagrammaticTemplateTab = ({ patientId, doctorId, hospitalId, doctorName, onSave, initialData }) => {
  const patientInfo = usePatientInfo(patientId);
  const [docs, setDocs] = useState(() => {
    if (initialData && Array.isArray(initialData)) return initialData;
    if (initialData && Array.isArray(initialData.docs)) return initialData.docs;
    return [{ type: "Pre-op Image", name: "", remarks: "" }];
  });
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  // Load diagram data & upload history for this patient
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;
    getPatientDiagrams(patientId)
      .then(res => {
        if (cancelled) return;
        if (res?.data?.docs && Array.isArray(res.data.docs) && res.data.docs.length > 0) {
          setDocs(res.data.docs);
        } else {
          getDocuments(patientId, { doctor_id: doctorId, hospital_id: hospitalId })
            .then(docRes => {
              if (cancelled || !docRes?.documents?.length) return;
              const historyRows = docRes.documents.map(d => ({
                type: d.doc_type || "Other",
                name: d.original_filename || d.stored_filename || "",
                remarks: d.remarks || "",
                file_url: d.file_url,
                document_id: d.document_id,
              }));
              setDocs(historyRows);
            })
            .catch(err => console.error("[DiagrammaticTemplateTab] history fetch:", err));
        }
      })
      .catch(err => console.error("[DiagrammaticTemplateTab] diagram fetch:", err));
    return () => { cancelled = true; };
  }, [patientId, doctorId, hospitalId]);

  const addRow = () => setDocs(p => [...p, { type: "Pre-op Image", name: "", remarks: "" }]);
  const delRow = async i => {
    const row = docs[i];
    // Remove from history store first for uploaded files
    if (row?.document_id) {
      try {
        await deleteDocument(row.document_id);
      } catch (err) {
        console.error("[DiagrammaticTemplateTab] delete failed:", err);
        setUploadError("Failed to delete document. Please try again.");
        return;
      }
    }
    setDocs(p => p.filter((_, idx) => idx !== i));
  };
  const upd = (i, k, v) => setDocs(p => { const a = [...p]; a[i] = { ...a[i], [k]: v }; return a; });

  const handleFileSelect = async e => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setUploadError("");
    setUploading(true);
    try {
      for (const file of files) {
        const res = await uploadDocument({
          file,
          doctorId,
          patientId,
          hospitalId,
          docType: "Other",
        });
        const doc = res.document || {};
        setDocs(p => [...p, {
          type: doc.doc_type || "Other",
          name: doc.original_filename || file.name,
          remarks: "",
          file_url: res.file_url || doc.file_url,
          document_id: doc.document_id,
        }]);
      }
    } catch (err) {
      console.error("[DiagrammaticTemplateTab] upload failed:", err);
      setUploadError("One or more files failed to upload. Please try again.");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  return (
    <Box>
      <SectionBox title="Primary Details">
        <FG cols={3}>
          <ROInput label="Patient ID" value={patientId} />
          <ROInput label="Patient Name" value={patientInfo.name} />
          <ROInput label="Age/Sex" value={patientInfo.ageSex} />
        </FG>
      </SectionBox>
      <SectionBox title="Document Upload">
        <Box onClick={() => !uploading && document.getElementById("otRecordUpload").click()}
          sx={{ border: `2px dashed ${C.border}`, p: 4, textAlign: "center", cursor: uploading ? "wait" : "pointer", mb: 2, transition: "all 0.2s", opacity: uploading ? 0.6 : 1, "&:hover": { background: C.bgSecondary, borderColor: C.black } }}>
          <UploadFileRounded sx={{ fontSize: 32, color: C.textMuted, mb: 1 }} />
          <Typography sx={{ fontFamily: FONT, fontSize: 13, textTransform: "uppercase", letterSpacing: "0.1em" }}>{uploading ? "Uploading…" : "Click to Upload Files"}</Typography>
          <input type="file" id="otRecordUpload" style={{ display: "none" }} multiple accept="image/*,video/*,.pdf" onChange={handleFileSelect} />
        </Box>
        {uploadError && <Typography sx={{ fontFamily: FONT, fontSize: 12, color: "#c0392b", mb: 1.5 }}>{uploadError}</Typography>}
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow>{["SNo", "Document Type", "Name", "Remarks", "Action"].map(h => <TableCell key={h} sx={thSx}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {docs.map((doc, i) => (
                <TableRow key={doc.document_id || i}>
                  <TableCell sx={tdSx}>{i + 1}</TableCell>
                  <TableCell sx={tdSx}>
                    <FormControl size="small" sx={{ ...inputSx, minWidth: 160 }}>
                      <Select value={doc.type} onChange={e => upd(i, "type", e.target.value)}>
                        {DOC_TYPES.map(t => <MenuItem key={t} value={t} sx={{ fontFamily: FONT, fontSize: 12 }}>{t}</MenuItem>)}
                      </Select>
                    </FormControl>
                  </TableCell>
                  <TableCell sx={tdSx}>
                    {doc.file_url
                      ? <a href={doc.file_url} target="_blank" rel="noopener noreferrer" style={{ fontFamily: FONT, fontSize: 12, color: C.black, textDecoration: "underline", wordBreak: "break-all" }}>{doc.name || "View file"}</a>
                      : <TextField size="small" placeholder="File name" value={doc.name} onChange={e => upd(i, "name", e.target.value)} sx={{ ...inputSx, width: 140 }} />}
                  </TableCell>
                  <TableCell sx={tdSx}><TextField size="small" placeholder="Remarks" value={doc.remarks} onChange={e => upd(i, "remarks", e.target.value)} sx={{ ...inputSx, width: 160 }} /></TableCell>
                  <TableCell sx={tdSx}><Button size="small" onClick={() => delRow(i)} sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }}><DeleteRounded sx={{ fontSize: 14 }} /></Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        <Button sx={{ ...outlineBtnSx, mt: 1.5 }} onClick={addRow}><AddRounded sx={{ mr: 0.5, fontSize: 14 }} />Add Row</Button>
      </SectionBox>
      <Button sx={saveBtnSx} onClick={() => onSave("diagrammatic", { docs })}><SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />Save Documents</Button>
    </Box>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// TAB — IMAGING STUDIES (Part H)
// ─────────────────────────────────────────────────────────────────────────────
const ImagingStudiesTab = ({ patientId }) => {
  const patientInfo = usePatientInfo(patientId);
  return (
    <Box>
      <SectionBox title="Primary Details">
        <FG cols={3}>
          <ROInput label="Patient ID" value={patientId} />
          <ROInput label="Patient Name" value={patientInfo.name} />
          <ROInput label="Age/Sex" value={patientInfo.ageSex} />
        </FG>
      </SectionBox>
      <SectionBox title="DICOM Imaging Studies">
        <DICOMViewer patientId={patientId} />
      </SectionBox>
    </Box>
  );
};


// ─────────────────────────────────────────────────────────────────────────────
// TAB 7 — REPORTS (Part I) — Simplified
// ─────────────────────────────────────────────────────────────────────────────
const ReportsTab = ({ patientId, doctorId, hospitalId }) => {
  const [filters, setFilters] = useState({ fromDate: "", toDate: "", surgeon: "", unit: "" });
  const [appliedFilters, setAppliedFilters] = useState({ fromDate: "", toDate: "", surgeon: "", unit: "" });
  const [patientBookings, setPatientBookings] = useState([]);
  const [loading, setLoading] = useState(false);
  const [surgeonList, setSurgeonList] = useState(SURGEONS_DEFAULT.map(s => ({ value: s, label: s })));

  useEffect(() => {
    if (!hospitalId) return;
    getDoctorsByHospital(hospitalId)
      .then(d => {
        if (Array.isArray(d)) {
          const filtered = d.filter(doc => doc.specialization === "Surgical Oncology");
          const opts = filtered.map(doc => ({ value: doc.name, label: doc.name }));
          setSurgeonList(opts.length > 0 ? opts : SURGEONS_DEFAULT.map(s => ({ value: s, label: s })));
        }
      })
      .catch(err => console.error("surgeons fetch error in ReportsTab:", err));
  }, [hospitalId]);

  useEffect(() => {
    if (patientId) {
      setLoading(true);
      getPatientBookings(patientId)
        .then(res => setPatientBookings(res.bookings || []))
        .catch(err => console.error("Error fetching patient bookings", err))
        .finally(() => setLoading(false));
    }
  }, [patientId]);

  const sf = (k, v) => setFilters(p => ({ ...p, [k]: v }));

  const processedData = patientBookings.map(b => {
    const booking = b.fullBooking || b.booking || b;
    let age = "", sex = "";
    const ageSex = booking.ageSex || b.ageSex || "";
    if (ageSex) { const parts = ageSex.split("/"); age = parts[0]?.trim() || ""; sex = parts[1]?.trim() || ""; }
    return {
      date: booking.surgeryDate || b.date || "",
      patientName: booking.patientName || b.patientName || "",
      patientId: booking.patientId || b.patient_id || "",
      age, sex,
      diagnosis: booking.preOpDiagnosis || "",
      procedure: booking.procedureName || b.procedure || "",
      unitName: booking.unitName || "",
      surgeon: booking.treatingDoctor || b.surgeon || "",
      nature: booking.caseStatus || b.status || "",
      bookingId: b.booking_id || booking.bookingId || "",
    };
  });

  const filteredData = processedData.filter(row => {
    if (!row.patientName && !row.patientId && !row.date) return false;
    if (appliedFilters.fromDate && row.date < appliedFilters.fromDate) return false;
    if (appliedFilters.toDate && row.date > appliedFilters.toDate) return false;
    if (appliedFilters.surgeon && row.surgeon !== appliedFilters.surgeon) return false;
    if (appliedFilters.unit && row.unitName !== appliedFilters.unit) return false;
    return true;
  });

  const handleExport = (type) => {
    if (filteredData.length === 0) { alert(`No data to export.`); return; }
    const exportData = filteredData.map((row, i) => ({ "SNo": i + 1, "Date": row.date, "Patient Name": row.patientName, "Patient ID": row.patientId, "Diagnosis": row.diagnosis, "Procedure": row.procedure, "Surgeon": row.surgeon, "Status": row.nature }));
    const worksheet = XLSX.utils.json_to_sheet(exportData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "OT_Report");
    XLSX.writeFile(workbook, `OT_Report.${type === "excel" ? "xlsx" : "csv"}`);
  };

  const generatePDF = async (bookingId) => {
    try {
      const result = await getBooking(bookingId);
      const docData = result.data || {};
      const booking = docData.booking || {};
      const cl = docData.checklist || {};
      const mg = docData.management || {};

      const doc = new jsPDF();
      let y = 35;
      const marginX = 14;
      const col1Width = 65;
      const col2Width = 117;
      const tableWidth = col1Width + col2Width;

      doc.setFontSize(18);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(0);
      doc.text("OT COMPREHENSIVE RECORD", 105, 20, null, null, "center");

      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(100);
      doc.text(`Generated on: ${new Date().toLocaleDateString()} at ${new Date().toLocaleTimeString()}`, 105, 26, null, null, "center");

      const addSection = (title) => {
        if (y > 270) { doc.addPage(); y = 20; }
        doc.setFillColor(240, 240, 240);
        doc.rect(marginX, y, tableWidth, 10, 'F');
        doc.setDrawColor(0);
        doc.setLineWidth(0.2);
        doc.rect(marginX, y, tableWidth, 10, 'S');
        doc.setFontSize(11);
        doc.setTextColor(0);
        doc.setFont("helvetica", "bold");
        doc.text(title.toUpperCase(), marginX + 3, y + 7);
        y += 10;
      };

      const addLine = (label, value) => {
        if (value === undefined || value === null || value === "") return;
        const textVal = String(value);
        if (textVal.trim() === "") return;

        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        const splitText = doc.splitTextToSize(textVal, col2Width - 6);
        const rowHeight = Math.max(10, 5 * splitText.length + 5);

        if (y + rowHeight > 280) { doc.addPage(); y = 20; }

        doc.setDrawColor(0);
        doc.setLineWidth(0.2);
        doc.rect(marginX, y, tableWidth, rowHeight, 'S');
        doc.line(marginX + col1Width, y, marginX + col1Width, y + rowHeight);

        doc.setFont("helvetica", "bold");
        doc.setTextColor(50);
        doc.text(label, marginX + 3, y + 7);

        doc.setFont("helvetica", "normal");
        doc.setTextColor(0);
        doc.text(splitText, marginX + col1Width + 3, y + 7);

        y += rowHeight;
      };

      const addCheckRow = (label, id) => {
        const status = cl[`${id}_status`];
        const remarks = cl[`${id}_remarks`];
        if (!status && !remarks) return;
        let val = status || "-";
        if (remarks) val += ` (${remarks})`;
        addLine(label, val);
      };

      addSection("Patient & Scheduling Details");
      addLine("Patient Name", booking.patientName);
      addLine("Patient ID", docData.patient_id);
      addLine("Age / Sex", booking.ageSex);
      addLine("Procedure", booking.procedureName);
      addLine("Date of Surgery", booking.surgeryDate);
      addLine("OT Room", booking.otRoom);
      addLine("Surgeon", booking.treatingDoctor);
      addLine("Status", docData.status);
      y += 5;

      if (Object.keys(cl).length > 0) {
        addSection("Surgical Checklist - Sign In");
        addCheckRow("Identity Confirmed", "signin_identity");
        addCheckRow("Consent Obtained", "signin_consent");
        addCheckRow("Site Marked", "signin_site");
        addCheckRow("Viral Markers Checked", "signin_viral");
        addCheckRow("Blood Confirmed", "signin_blood");
        addCheckRow("Instruments Available", "signin_instruments");
        addCheckRow("Machine Check", "signin_machine");
        addCheckRow("Pulse Oximeter", "signin_oximeter");
        addCheckRow("Airway Risk", "signin_airway");
        addCheckRow("Aspiration Risk", "signin_aspiration");
        y += 5;

        addSection("Surgical Checklist - Time Out");
        addCheckRow("Team Introduction", "timeout_intro");
        addCheckRow("Patient Identity", "timeout_patient");
        addCheckRow("Procedure Confirmed", "timeout_procedure");
        addCheckRow("Side (Laterality)", "timeout_side");
        addCheckRow("Mop/Gauze Count", "timeout_mop");
        addCheckRow("Antibiotic Prophylaxis", "timeout_antibiotic");
        addCheckRow("Imaging Displayed", "timeout_imaging");
        addCheckRow("HPR / Frozen Form", "timeout_hpr");
        addCheckRow("Tourniquet", "timeout_tourniquet");
        if (cl.timeout_events_surgeon) addLine("Critical Events (Surgeon)", cl.timeout_events_surgeon);
        if (cl.timeout_events_anaesthesia) addLine("Critical Events (Anaes)", cl.timeout_events_anaesthesia);
        if (cl.timeout_events_nursing) addLine("Critical Events (Nursing)", cl.timeout_events_nursing);
        y += 5;

        addSection("Surgical Checklist - Sign Out");
        addCheckRow("Procedure Name Recorded", "signout_name");
        addCheckRow("Sponge/Needle Count", "signout_count");
        addCheckRow("Specimen Labelled", "signout_specimen");
        addCheckRow("Equipment Problems", "signout_equipment");
        addCheckRow("Throat Pack Removed", "extubation_throat");
        if (cl.signout_concerns_surgeon) addLine("Post-Op Concerns (Surgeon)", cl.signout_concerns_surgeon);
        if (cl.signout_concerns_anaesthesia) addLine("Post-Op Concerns (Anaes)", cl.signout_concerns_anaesthesia);
        if (cl.signout_concerns_nursing) addLine("Post-Op Concerns (Nursing)", cl.signout_concerns_nursing);
        y += 5;
      }

      if (Object.keys(mg).length > 0) {
        addSection("Surgical Management - Team");
        addLine("Primary Surgeon", mg.primarySurgeon);
        addLine("Assistants", [mg.assistantSurgeon1, mg.assistantSurgeon2, mg.assistantSurgeon3].filter(Boolean).join(", "));
        addLine("Anaesthetists", [mg.primaryAnaesthetist, mg.anaesthetist1, mg.anaesthetist2].filter(Boolean).join(", "));
        addLine("Recon Surgeon", mg.reconPrimarySurgeon);
        addLine("Scrub Nurses", [mg.scrubNurse1, mg.scrubNurse2].filter(Boolean).join(", "));
        addLine("Circulating Nurse", mg.circulatingNurse);
        y += 5;

        addSection("Surgical Management - Procedure Details");
        addLine("Procedure Name", mg.nameOfProcedure || mg.otherNameOfProcedure || (mg.typeOfSurgery || []).join(", "));
        addLine("Approach", mg.approach);
        addLine("Classification", mg.classification);
        addLine("Case Status", (mg.caseStatus || []).join(", "));
        addLine("Skin Preparation", mg.skinPreparation);
        addLine("Wound Class", (mg.woundClass || []).join(", "));
        addLine("Pre-Op Diagnosis", mg.preOperativeDiagnosis);
        addLine("Post-Op Diagnosis", mg.postOperativeDiagnosis);
        addLine("Findings", mg.findings);
        addLine("Procedure Details", mg.procedureDetails);
        y += 5;

        addSection("Surgical Management - Outcomes & Materials");
        addLine("Blood Loss (ml)", mg.bloodLoss);
        addLine("Blood Products", (mg.bloodProducts || []).join(", "));
        addLine("Resection Status", mg.resection);
        addLine("Complications", mg.complications);
        addLine("Frozen Section", mg.frozen);
        addLine("Materials Forwarded", mg.materialsForwarded);
        addLine("Anatomical Site", mg.anatomicalSite);
        addLine("Staging (T N M)", (mg.stagingT || mg.stagingN || mg.stagingM) ? `${mg.stagingT || '-'} ${mg.stagingN || '-'} ${mg.stagingM || '-'}` : "");
      }

      window.open(doc.output("bloburl"), "_blank");
    } catch (err) {
      console.error("PDF error:", err);
      alert("Failed to generate PDF. Check console for details.");
    }
  };

  return (
    <Box>
      <SectionBox title="Report Filters">
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2, alignItems: "flex-end" }}>
          <TextField label="From Date" type="date" size="small" value={filters.fromDate} onChange={e => sf("fromDate", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
          <TextField label="To Date" type="date" size="small" value={filters.toDate} onChange={e => sf("toDate", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} InputLabelProps={{ shrink: true }} />
          <FormControl size="small" sx={{ ...inputSx, minWidth: 160 }}>
            <InputLabel shrink sx={fieldLabelSx}>Surgeon</InputLabel>
            <Select displayEmpty value={filters.surgeon} onChange={e => sf("surgeon", e.target.value)} notched label="Surgeon">
              <MenuItem value="" sx={{ fontFamily: FONT, fontSize: 13 }}><em>All Surgeons</em></MenuItem>
              {surgeonList.map(s => (
                <MenuItem key={s.value} value={s.value} sx={{ fontFamily: FONT, fontSize: 13 }}>{s.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField label="Unit Name" size="small" value={filters.unit} onChange={e => sf("unit", e.target.value)} sx={{ ...inputSx, minWidth: 160 }} />
          <Button sx={saveBtnSx} onClick={() => setAppliedFilters(filters)}><FilterListRounded sx={{ mr: 0.5, fontSize: 14 }} />Apply Filters</Button>
        </Box>
      </SectionBox>
      <SectionBox title="OT Activity Report">
        <TableContainer>
          <Table size="small">
            <TableHead><TableRow>{["SNo", "Date", "Patient", "ID", "Procedure", "Surgeon", "Status", "Actions"].map(h => <TableCell key={h} sx={thSx}>{h}</TableCell>)}</TableRow></TableHead>
            <TableBody>
              {filteredData.map((row, i) => (
                <TableRow key={i} sx={{ "&:hover": { background: C.bgSecondary } }}>
                  <TableCell sx={tdSx}>{i + 1}</TableCell>
                  <TableCell sx={tdSx}>{row.date}</TableCell>
                  <TableCell sx={tdSx}>{row.patientName}</TableCell>
                  <TableCell sx={tdSx}>{row.patientId}</TableCell>
                  <TableCell sx={tdSx}>{row.procedure}</TableCell>
                  <TableCell sx={tdSx}>{row.surgeon}</TableCell>
                  <TableCell sx={tdSx}><StatusBadge status={row.nature} /></TableCell>
                  <TableCell sx={tdSx}><Button size="small" sx={{ ...outlineBtnSx, mt: 0, py: 0.4, px: 1, fontSize: 10 }} onClick={() => generatePDF(row.bookingId)}>PDF</Button></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </SectionBox>
      <Box sx={{ display: "flex", gap: 1 }}>
        <Button sx={outlineBtnSx} onClick={() => handleExport("excel")}><TableChartRounded sx={{ mr: 0.5, fontSize: 14 }} />Export Excel</Button>
        <Button sx={outlineBtnSx} onClick={() => handleExport("csv")}><FileDownloadRounded sx={{ mr: 0.5, fontSize: 14 }} />Export CSV</Button>
      </Box>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT — OTRecord
// ─────────────────────────────────────────────────────────────────────────────
const MAIN_TABS = [
  { key: "ot-booking", label: "OT Booking", part: "OT Part A" },
  { key: "ot-worklist", label: "OT Worklist", part: "OT Part B" },
  { key: "doctors-note", label: "Doctors Note", part: "OT Part D" },
  { key: "anaesthesia", label: "Anaesthesia Management", part: "OT Part E" },
  { key: "post-op", label: "Post Op Complications", part: "OT Part F" },
  { key: "diagrammatic", label: "Diagrammatic Template", part: "OT Part G" },
  { key: "imaging-studies", label: "Imaging Studies", part: "OT Part H" },
  { key: "reports", label: "Reports", part: "OT Part I" },
  { key: "discharge-summary", label: "Discharge Summary", part: "OT Part J" },
  { key: "total-discharge", label: "Total Discharge Summary", part: "OT Part K" },
  { key: "patient-referrals", label: "Patient Referrals", part: "OT Part L" },
];

const OTRecord = ({ doctorId, patientId: propPatientId, doctorName }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [patientId, setPatientId] = useState(propPatientId || "");
  const [hospitalId, setHospitalId] = useState("");
  const [doctorInfo, setDoctorInfo] = useState({ name: doctorName || "", specialization: "Surgical Oncology", hospital_name: "" });
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });
  const [postponeOverride, setPostponeOverride] = useState(false);

  // Core hook — handles all booking data + merging
  const {
    bookings,
    currentBookingId,
    currentBookingData,
    isLoading,
    refetch,
    getMergedDoctorsNote,
    getMergedPostOp,
    getAnaesthesiaSection,
  } = useBookingData(patientId, doctorId);

  useEffect(() => { if (propPatientId) setPatientId(propPatientId); }, [propPatientId]);

  // Derived postponement state for the active booking (see shared/postponeStatus.js).
  const postponeInfo = getPostponeInfo(currentBookingData);
  // Clinical editing tabs (Doctors Note, Anaesthesia, Post-Op, Diagrammatic) — the
  // banner + soft-gate only apply here, not to Booking/Worklist/Reports/Discharge.
  const isClinicalTab = activeTab >= 2 && activeTab <= 5;
  // Soft-gate: lock clinical tabs while a postponed case's date is still in the future,
  // unless the doctor explicitly overrides. Reset the override whenever the active booking changes.
  const postponeGated = isClinicalTab && postponeInfo.isPostponed && postponeInfo.isFuture && !postponeOverride;
  useEffect(() => { setPostponeOverride(false); }, [currentBookingId]);

  // Fetch doctor info + hospital ID
  useEffect(() => {
    if (!doctorId) return;
    getDoctorInfo(doctorId)
      .then(d => {
        if (d?.doctor?.hospital_id) setHospitalId(d.doctor.hospital_id);
        setDoctorInfo(prev => ({ ...prev, ...d?.doctor }));
      })
      .catch(err => console.error("[OTRecord] doctor info fetch:", err));
  }, [doctorId]);

  // ─── Simplified handleSave ──────────────────────────────────────────────
  const handleSave = async (tabKey, data) => {
    try {
      if (tabKey === "ot-booking") {
        if (data.bookingId) {
          // Update existing booking
          await updateBooking(data.bookingId, data);
        } else {
          // Create new booking — backend generates the booking_id
          const result = await createBooking({
            patient_id: patientId,
            doctor_id: doctorId,
            hospital_id: hospitalId,
            data,
          });
          // Store the backend-generated bookingId into the data for local state
          data.bookingId = result.booking_id;

          // Background trigger for LLM investigation suggestions
          generateInvestigationSuggestion(result.booking_id, patientId)
            .then(() => console.log("[OTRecord] LLM investigation suggestions generated successfully."))
            .catch(err => console.error("[OTRecord] LLM investigation generation failed:", err));
        }
      } else if (tabKey === "diagrammatic") {
        await savePatientDiagrams(patientId, data);
      } else {
        // All other sections: checklist, management, anaesthesia.*, post_op
        if (!currentBookingId) {
          setSnackbar({ open: true, message: "No active booking. Create a booking first.", severity: "error" });
          return;
        }
        await saveSection(currentBookingId, tabKey, data);
      }

      const savedLabel = MAIN_TABS.find(t => t.key === tabKey)?.label
        || (tabKey === "discharge" ? "Discharge Summary" : tabKey);
      setSnackbar({ open: true, message: `${savedLabel} saved successfully`, severity: "success" });
      refetch(); // Refresh all data

      if (tabKey === "ot-booking") {
        setActiveTab(1); // Redirect to OT Worklist
      }
    } catch (err) {
      console.error("[OTRecord] save error:", err);
      setSnackbar({ open: true, message: "Failed to save. Please try again.", severity: "error" });
    }
  };

  const hasBooking = !!currentBookingId;

  return (
    <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
      <Box sx={{ background: C.bgPrimary, border: `1px solid ${C.border}`, fontFamily: FONT }}>

        {/* Header */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 2.5, py: 2, background: C.bgSecondary, borderBottom: `1px solid ${C.borderStrong}`, flexWrap: "wrap", gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Box sx={{ width: 44, height: 44, background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
              <LocalHospitalRounded sx={{ fontSize: 24, color: C.white }} />
            </Box>
            <Box>
              <Typography sx={{ fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.2em", color: C.textMuted, fontFamily: FONT, mb: 0.25 }}>Surgical Oncology</Typography>
              <Typography sx={{ fontSize: 20, fontWeight: FW_LIGHT, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.02em" }}>OT Operation Record</Typography>
            </Box>
          </Box>
          <Box sx={{ px: 1.5, py: 0.5, border: `1px solid ${C.border}`, background: C.white, fontSize: 11, fontFamily: FONT, color: C.textMuted }}>NCG-KCDO Module v3.0</Box>
        </Box>

        {/* Layout: Sub-sidebar + Content */}
        <Box sx={{ display: "flex", minHeight: "65vh" }}>
          <Box sx={{ width: 240, borderRight: `1px solid ${C.border}`, background: C.bgSecondary, flexShrink: 0 }}>
            {MAIN_TABS.map((tab, i) => (
              <Box key={tab.key} onClick={() => setActiveTab(i)}
                sx={{
                  px: 2.5, py: 1.75, borderBottom: `1px solid ${C.border}`,
                  borderLeft: activeTab === i ? `3px solid ${C.black}` : "3px solid transparent",
                  background: activeTab === i ? C.black : "transparent", cursor: "pointer", transition: "all 0.15s",
                  "&:hover": { background: activeTab === i ? C.black : C.white },
                }}>
                <Typography sx={{ fontSize: 13, fontFamily: FONT, color: activeTab === i ? C.white : C.textSecond, fontWeight: activeTab === i ? FW_NORMAL : FW_LIGHT }}>{tab.label}</Typography>
              </Box>
            ))}
          </Box>

          {/* Content */}
          <Box sx={{ flex: 1, p: 3, overflowX: "auto", overflowY: "auto", maxHeight: "80vh", position: "relative" }}>
            {/* Loading / No Booking overlays for tabs that require a booking */}
            {activeTab > 1 && isLoading && (
              <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
                <Box sx={{ background: C.white, p: "32px 48px", borderRadius: 1, boxShadow: "0 10px 30px rgba(0,0,0,0.1)", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 1.5 }}>Loading Record...</Typography>
                  <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textSecond }}>Please wait while we fetch the details.</Typography>
                </Box>
              </Box>
            )}
            {activeTab > 1 && !isLoading && !hasBooking && (
              <Box sx={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
                <Box sx={{ background: C.white, p: "32px 48px", borderRadius: 1, boxShadow: "0 10px 30px rgba(0,0,0,0.1)", textAlign: "center", border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 1.5 }}>No Active Booking</Typography>
                  <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textSecond, mb: 3 }}>Please create an OT Booking first.</Typography>
                  <Button onClick={() => setActiveTab(0)} sx={{ px: 3, py: 1.2, background: C.black, color: C.white, fontFamily: FONT, fontSize: 13, borderRadius: 1, textTransform: "none", "&:hover": { background: "#222" } }}>
                    Go to Booking
                  </Button>
                </Box>
              </Box>
            )}

            {/* Postponed warning + soft-gate — clinical editing tabs only (2–5) */}
            {isClinicalTab && hasBooking && !isLoading && postponeInfo.isPostponed && (
              <PostponedBanner info={postponeInfo} gated={postponeGated} onOverride={() => setPostponeOverride(true)} />
            )}

            <Box sx={{
              filter: (activeTab > 1 && (isLoading || !hasBooking)) ? "blur(3px)" : "none",
              pointerEvents: ((activeTab > 1 && (isLoading || !hasBooking)) || postponeGated) ? "none" : "auto",
              opacity: postponeGated ? 0.5 : 1,
            }}>
              {activeTab === 0 && <OTBookingTab patientId={patientId} doctorId={doctorId} doctorName={doctorInfo.name} hospitalId={hospitalId} onSave={handleSave} />}
              {activeTab === 1 && <OTWorklistTab doctorId={doctorId} patientId={patientId} hospitalId={hospitalId} refetchBookings={refetch} />}
              {activeTab === 2 && <DoctorsNoteTab key={`doctors-note-${currentBookingId}`} patientId={patientId} doctorId={doctorId} doctorName={doctorInfo.name} bookingData={currentBookingData} currentBookingId={currentBookingId} onSave={handleSave} initialPI={getMergedDoctorsNote()} />}
              {activeTab === 3 && <AnaesthesiaTab key={`anaesthesia-${currentBookingId}`} patientId={patientId} doctorId={doctorId} doctorName={doctorInfo.name} bookingData={currentBookingData} currentBookingId={currentBookingId} onSave={handleSave} getSection={getAnaesthesiaSection} />}
              {activeTab === 4 && <PostOpComplicationsTab key={`post-op-${currentBookingId}`} initialData={getMergedPostOp()} onSave={handleSave} patientId={patientId} currentBookingId={currentBookingId} bookingData={currentBookingData} />}
              {activeTab === 5 && <DiagrammaticTemplateTab patientId={patientId} doctorId={doctorId} hospitalId={hospitalId} doctorName={doctorInfo.name} onSave={handleSave} />}
              {activeTab === 6 && <ImagingStudiesTab patientId={patientId} />}
              {activeTab === 7 && <ReportsTab patientId={patientId} doctorId={doctorId} hospitalId={hospitalId} />}
              {activeTab === 8 && (
                <DischargeSummaryTab
                  key={`discharge-summary-${currentBookingId}`}
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorInfo.name}
                  currentBookingId={currentBookingId}
                  bookingData={currentBookingData}
                  onSave={handleSave}
                />
              )}
              {activeTab === 9 && (
                <DischargeSummary
                  patientId={patientId}
                  doctorId={doctorId}
                />
              )}
              {activeTab === 10 && (
                <PatientReferralsTab
                  patientId={patientId}
                  doctorId={doctorId}
                  doctorName={doctorInfo.name}
                  hospitalId={hospitalId}
                />
              )}
            </Box>
          </Box>
        </Box>
      </Box>

      <Snackbar open={snackbar.open} autoHideDuration={4000}
        onClose={() => setSnackbar(p => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
        sx={{ top: { xs: '40%' } }}>
        <Box sx={{ background: C.black, color: C.white, px: 3, py: 1.5, display: 'flex', alignItems: 'center', gap: 2, boxShadow: '0 8px 24px rgba(0,0,0,0.3)', minWidth: 300, justifyContent: 'space-between', border: `1px solid ${C.borderStrong}` }}>
          <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: FW_LIGHT, letterSpacing: '0.05em' }}>{snackbar.message}</Typography>
          <IconButton size="small" onClick={() => setSnackbar(p => ({ ...p, open: false }))} sx={{ color: C.white, p: 0.5 }}><CloseRounded fontSize="small" /></IconButton>
        </Box>
      </Snackbar>
    </motion.div>
  );
};

export default OTRecord;
