import React, { useState, useEffect, useRef } from "react";
import {
  Box, Typography, TextField, Button, Snackbar, Alert,
  Table, TableHead, TableBody, TableRow, TableCell, TableContainer,
  Dialog, DialogTitle, DialogContent, DialogActions, Divider,
  FormControl, InputLabel, Select, MenuItem,
} from "@mui/material";
import { SaveRounded, LocalHospitalRounded, UploadFileRounded, DescriptionRounded } from "@mui/icons-material";
import { motion } from "framer-motion";

// SHARED COMPONENT HELPERS
import {
  C, FONT, FW_LIGHT, FW_NORMAL, FW_BOLD, inputSx, saveBtnSx, thSx, tdSx,
} from "./shared/designTokens";
import {
  SectionBox, FG, FieldLabel, ROInput, RdoGroup, CbxGroup, SelectInput, Sel,
} from "./shared/FormComponents";
import {
  getDoctorInfo, getDoctorsByHospital, getPatientInfo, getPatientVitals,
  getActiveAnaesthesiaRecord, createAnaesthesiaRecord,
  getAnaesthesiaRecords, saveAnaesthesiaSection, linkAnaesthesiaToBooking
} from "./shared/api";

// SHARED COMPONENTS 
import LabInvestigations from "./LabInvestigations";
import AnaesthesiaHistoryAccordion from "./AnaesthesiaHistoryAccordion";

import { uploadDocument, getPatientBookings, getBooking } from "./surgical-oncology/shared/api";
import usePatientInfo from "./surgical-oncology/shared/usePatientInfo";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const DEMO_OTP_CODES = ["1234", "123456", "0000", "999999", "4528", "7360", "4044", "2041", "6590"];
// ─────────────────────────────────────────────────────────────────────────────
// STATIC OPTION / FIELD DEFINITIONS (mirrors NER Pre-Anaesthesia Check-up v2.0)
// ─────────────────────────────────────────────────────────────────────────────

const YES_NO_FINDINGS = [
  ["pallor", "Pallor"],
  ["icterus", "Icterus"],
  ["cyanosis", "Cyanosis"],
  ["clubbing", "Clubbing"],
  ["lymphadenopathy", "Lymphadenopathy"],
  ["pedalEdema", "Pedal Edema"],
  ["lrti", "LRTI"],
  ["urti", "URTI"],
  ["fever", "Fever"],
];

const COMORBIDITY_FIELDS = [
  ["hypertension", "Hypertension"],
  ["diabetes", "Diabetes Mellitus"],
  ["cardiac", "Cardiac (IHD/CHF/Any other)"],
  ["respiratory", "Respiratory (Asthma/TB/COPD)"],
  ["nervousSystem", "Nervous System (Epilepsy/Stroke/Others)"],
  ["renal", "Renal (AKI/CKD/Others)"],
  ["thyroidDisorder", "Thyroid Disorder"],
];

const STOP_BANG_OPTIONS = [
  "Gender - Male", "Neck Circumference > 40 cm", "Age > 50 yrs", "BMI > 35 kg/m2",
  "High Blood Pressure", "Observed Apnoea", "Tiredness", "Snoring",
];

const SUBSTANCE_ROWS = [
  ["drugs", "Drugs"],
  ["alcohol", "Alcohol"],
  ["betelNut", "Betel Nut"],
  ["tobacco", "Tobacco"],
  ["smoking", "Smoking"],
];

const SYSTEMIC_FIELDS = [
  ["cvs", "Cardiovascular System"],
  ["rs", "Respiratory System"],
  ["abdomen", "Abdominal System"],
  ["cns", "Central Nervous System"],
];



const REFERRAL_DEPARTMENTS = [
  "Cardiology", "Pulmonology", "Nephrology", "Endocrinology", "Neurology",
  "Haematology", "ENT", "General Medicine", "Others",
];

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-POPULATE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Booking demographics/surgery fields come back nested under
 * `fullBooking` (camelCase) from GET /surgical-oncology/patient/{id}/latest-booking
 * — NOT top-level snake_case as the previous version of this file assumed.
 */
const splitAgeSex = (ageSex) => {
  if (!ageSex || typeof ageSex !== "string" || !ageSex.includes("/")) {
    return { age: "", sex: "" };
  }
  const [age, sex] = ageSex.split("/").map((s) => s.trim());
  return { age: age || "", sex: sex || "" };
};

/**
 * chemotherapy_records.data shape (confirmed against real sample doc):
 *   data.regimen.selectedProtocol / protocolDetails, data.regimen.doseAdjustments
 * Sparse/inconsistent by nature (dynamic form) — build best-effort one-liner.
 */
const formatChemotherapySummary = (chemoRecord) => {
  const data = chemoRecord?.data || {};
  
  // Try to find regimen in the latest cycle first
  let regimen = data.regimen || {};
  if (data.cycles && typeof data.cycles === "object") {
    const cycleKeys = Object.keys(data.cycles).filter(k => !isNaN(parseInt(k))).sort((a, b) => parseInt(b) - parseInt(a));
    if (cycleKeys.length > 0) {
      const latestCycle = data.cycles[cycleKeys[0]];
      if (latestCycle && latestCycle.regimen) {
        regimen = latestCycle.regimen;
      }
    }
  }

  const protocol = regimen.selectedProtocol || regimen.protocolDetails || "";
  const adjustments = (regimen.doseAdjustments || "").trim();
  if (!protocol && !adjustments) return "";
  return adjustments ? `${protocol} (dose adjustments: ${adjustments})` : protocol;
};

/**
 * radiotherapy_records.data shape (confirmed against real sample doc):
 *   data.treatment.treatmentType, data.treatment.totalDose
 * Most other fields are dynamic `field_-xxxxx` keys from a form-builder and
 * are NOT reliably decodable here, so they're intentionally left out.
 */
const formatRadiotherapySummary = (radioRecord) => {
  const data = radioRecord?.data || {};
  const treatment = data.treatment || {};
  const treatmentType = treatment.treatmentType || "";
  const totalDose = treatment.totalDose || "";
  const parts = [];
  if (treatmentType) parts.push(treatmentType);
  // Guard against known placeholder/invalid values seen in sample data (e.g. "-2")
  if (totalDose && !String(totalDose).startsWith("-")) parts.push(`dose: ${totalDose}`);
  return parts.join(", ");
};

// ─────────────────────────────────────────────────────────────────────────────
// DERIVED / COMPUTED SCORE HELPERS (read-only — never user-entered)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * STOP-BANG score: 1 point per checked item out of the 8 standard items.
 * Risk stratification per the validated STOP-BANG questionnaire:
 *   0-2 = Low risk, 3-4 = Intermediate risk, 5-8 = High risk of OSA.
 */
const computeStopBangScore = (stopBangSelections = []) => {
  const score = stopBangSelections.length;
  let risk = "";
  if (score <= 2) risk = "Low Risk";
  else if (score <= 4) risk = "Intermediate Risk";
  else risk = "High Risk";
  return { score, risk };
};

/**
 * Comorbidity flag count: number of Section 4 comorbidity fields that have
 * a non-empty value entered (i.e. the clinician documented something there).
 */
const computeComorbidityCount = (pac) => {
  return COMORBIDITY_FIELDS.reduce(
    (count, [key]) => count + (String(pac[key] || "").trim() ? 1 : 0),
    0
  );
};

/**
 * Positive findings count: number of Section 3 Yes/No findings answered "Yes".
 */
const computePositiveFindingsCount = (pac) => {
  return YES_NO_FINDINGS.reduce(
    (count, [key]) => count + (pac[key] === "Yes" ? 1 : 0),
    0
  );
};

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT DATA MODEL
// ─────────────────────────────────────────────────────────────────────────────
const todayISO = () => new Date().toISOString().slice(0, 10);

const buildDefaultPac = () => ({
  formMode: "PAC",
  ward: "",
  department: "",
  caseNumber: "",
  height: "",
  weight: "",
  evaluatingAnaesthesiologist: "",
  natureOfSurgery: "",

  vitalsDate: todayISO(),
  temperature: "",
  pulse: "",
  bp: "",
  spo2: "",
  breathHoldingTime: "",

  generalCondition: "",
  breathingPattern: [],
  orientation: "",
  pallor: "", icterus: "", cyanosis: "", clubbing: "", lymphadenopathy: "",
  pedalEdema: "", lrti: "", urti: "", fever: "",
  pacEvalHistory: "", pacEvalHistoryDetails: "",

  hypertension: "", diabetes: "", cardiac: "", respiratory: "",
  nervousSystem: "", renal: "", thyroidDisorder: "",
  anyHOSurgeries: "", hoTransfusion: "", acuteChronicPain: "",
  stopBang: [],
  drugAllergies: "", otherHistory: "",

  substanceAbuse: {
    drugs: { duration: "", remarks: "" },
    alcohol: { duration: "", remarks: "" },
    betelNut: { duration: "", remarks: "" },
    tobacco: { duration: "", remarks: "" },
    smoking: { duration: "", remarks: "" },
  },

  nares: "", deviatedNasalSeptum: "", mouthOpening: "", teeth: [],
  mallampati: "", jawSliding: "", thyromentalDistance: "",
  neck: "", spine: "", tracheostomy: "", tracheostomyDetails: "", airwayComments: "",

  cvs: "", rs: "", abdomen: "", cns: "",

  referredTo: "", specialityRemarks: "",

  asaGrade: "", fitnessStatus: "", consentGiven: "", consentDate: "", consentDocumentUrl: "",

  anemiaManagement: "", anemiaRemarks: "",
  preOperativeRemarks: "",

  anaesthesiologistId: "",
  anaesthesiologistESign: "",
  anaesthesiologistName: "", approvalDate: todayISO(),
});

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
const PreAnaesthesiaCheckup = ({ patientId, doctorId, doctorName }) => {
  const [pac, setPac] = useState(buildDefaultPac());
  const [recordId, setRecordId] = useState(null);
  const [bookingData, setBookingData] = useState(null);
  const [patientBookings, setPatientBookings] = useState([]);
  const [selectedBookingId, setSelectedBookingId] = useState("");
  const [patientInfoData, setPatientInfoData] = useState(null);
  const [oncologyRecords, setOncologyRecords] = useState(null);
  const [history, setHistory] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [activeRecordData, setActiveRecordData] = useState(null);
  const [snackbar, setSnackbar] = useState({ open: false, message: "", severity: "success" });

  const [anaesthetistList, setAnaesthetistList] = useState([]);
  const [otpDialog, setOtpDialog] = useState(false);
  const [otpStep, setOtpStep] = useState("send");
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSending, setOtpSending] = useState(false);

  const consentFileInputRef = useRef(null);
  const [isUploadingConsent, setIsUploadingConsent] = useState(false);

  const handleConsentFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploadingConsent(true);
    try {
      const res = await uploadDocument({
        file,
        doctorId: doctorId || "",
        patientId: patientId || "",
        docType: "Anaesthesia Consent",
        remarks: "Uploaded from Pre-Anaesthesia Checkup"
      });
      if (res && res.file_url) {
        set("consentDocumentUrl", res.file_url);
        setSnackbar({ open: true, message: "Consent document uploaded successfully!", severity: "success" });
      } else {
        throw new Error("Upload failed: No file URL returned");
      }
    } catch (err) {
      console.error("[PreAnaesthesiaCheckup] Consent upload error:", err);
      setSnackbar({ open: true, message: "Failed to upload consent document.", severity: "error" });
    } finally {
      setIsUploadingConsent(false);
      if (consentFileInputRef.current) {
        consentFileInputRef.current.value = "";
      }
    }
  };

  useEffect(() => {
    const fetchAnaesthetists = async () => {
      if (!doctorId) return;
      try {
        const docInfo = await getDoctorInfo(doctorId);
        if (docInfo && docInfo.hospital_id) {
          const docs = await getDoctorsByHospital(docInfo.hospital_id);
          if (Array.isArray(docs)) {
            const filtered = docs.filter(doc =>
              doc.specialization === "Anaesthesia" ||
              doc.specialization === "Anesthesia" ||
              doc.specialization === "Anaesthesiology" ||
              doc.specialization === "Anesthesiology"
            );
            const opts = filtered.map(doc => ({ value: doc.sys_user_id, label: doc.name }));
            setAnaesthetistList(opts.length > 0 ? opts : [{ value: doctorId, label: doctorName || "Dr. Anaesthetist" }]);
          }
        }
      } catch (err) {
        console.error("[PreAnaesthesiaCheckup] Error fetching anaesthetists:", err);
      }
    };
    fetchAnaesthetists();
  }, [doctorId, doctorName]);

  const openOtpDialog = () => {
    if (!pac.anaesthesiologistId && !doctorId) return;
    setOtpDialog(true);
    setOtpStep("send");
    setOtpInput("");
    setOtpError("");
  };

  const closeOtpDialog = () => {
    setOtpDialog(false);
    setOtpStep("send");
    setOtpInput("");
    setOtpError("");
    setOtpSending(false);
  };

  const handleSendOtp = () => {
    setOtpSending(true);
    setTimeout(() => {
      setOtpSending(false);
      setOtpStep("enter");
    }, 800);
  };

  const selectedAnaesthetistLabel = () => {
    const selectedId = pac.anaesthesiologistId || doctorId;
    const found = anaesthetistList.find(a => a.value === selectedId);
    return found ? found.label : (pac.anaesthesiologistName || doctorName || "Anaesthesiologist");
  };

  const handleVerifyOtp = () => {
    if (DEMO_OTP_CODES.includes(otpInput.trim())) {
      const docLabel = selectedAnaesthetistLabel();
      setPac(prev => ({
        ...prev,
        anaesthesiologistESign: "Yes",
        anaesthesiologistName: docLabel,
        anaesthesiologistId: pac.anaesthesiologistId || doctorId || ""
      }));
      closeOtpDialog();
    } else {
      setOtpError("Invalid OTP. Please try again.");
    }
  };

  const set = (key, value) => setPac((p) => ({ ...p, [key]: value }));
  const setSA = (row, field, value) =>
    setPac((p) => ({ ...p, substanceAbuse: { ...p.substanceAbuse, [row]: { ...p.substanceAbuse[row], [field]: value } } }));

  useEffect(() => {
    const fetchBookingAndOncology = async () => {
      if (!patientId || !doctorId) return;
      setIsLoading(true);

      let currentRecordId = null;
      let activeRecord = null;
      try {
        // 1. Fetch active anaesthesia record or create one
        const activeRes = await getActiveAnaesthesiaRecord(patientId);
        if (activeRes?.status === "success" && activeRes.data) {
          activeRecord = activeRes.data;
          setActiveRecordData(activeRecord);
          currentRecordId = activeRecord.record_id;
          setRecordId(currentRecordId);
          setPac(prev => {
            const loaded = { ...buildDefaultPac(), ...(activeRecord.pac || {}) };
            return {
              ...loaded,
              bp: loaded.bp || prev.bp,
              pulse: loaded.pulse || prev.pulse,
              spo2: loaded.spo2 || prev.spo2,
              temperature: loaded.temperature || prev.temperature,
              height: loaded.height || prev.height,
              weight: loaded.weight || prev.weight,
            };
          });
        } else {
          // Auto-create if nothing exists
          const createRes = await createAnaesthesiaRecord(patientId, doctorId);
          if (createRes?.status === "success") {
            currentRecordId = createRes.record_id;
            setRecordId(currentRecordId);
            setPac(prev => {
              const defaultPac = buildDefaultPac();
              return {
                ...defaultPac,
                bp: prev.bp || "",
                pulse: prev.pulse || "",
                spo2: prev.spo2 || "",
                temperature: prev.temperature || "",
                height: prev.height || "",
                weight: prev.weight || "",
              };
            });
          }
        }

        // 2. Fetch history for the accordion
        const histRes = await getAnaesthesiaRecords(patientId);
        if (histRes?.status === "success") {
          setHistory(histRes.data || []);
        }
      } catch (err) {
        console.error("[PreAnaesthesiaCheckup] Error with anaesthesia record:", err);
      }

      try {
        // 3. Fetch patient bookings & linked booking data
        const bookingsRes = await getPatientBookings(patientId);
        const allBookings = bookingsRes?.bookings || [];
        setPatientBookings(allBookings);

        let linkedId = activeRecord?.linked_booking_id || "";
        if (linkedId && linkedId !== "null" && linkedId !== "none") {
          setSelectedBookingId(linkedId);
          const found = allBookings.find(b => (b.booking_id || b.id) === linkedId);
          setBookingData(found || null);
        } else {
          setSelectedBookingId("");
          setBookingData(null);
        }

        // Fetch general patient info
        try {
          const pInfo = await getPatientInfo(patientId);
          if (pInfo?.data) {
            setPatientInfoData(pInfo.data);
          }
        } catch (pErr) {
          console.error("[PreAnaesthesiaCheckup] Error fetching general patient info:", pErr);
        }
      } catch (err) {
        console.error("[PreAnaesthesiaCheckup] Error fetching booking:", err);
      }

      try {
        // GET /surgical-oncology/oncology-records/{patient_id}
        const oncologyFetchRes = await fetch(`${API_BASE_URL}hms/users/data/surgical-oncology/oncology-records/${patientId}`);
        const oncologyRes = await oncologyFetchRes.json();
        if (oncologyRes) {
          setOncologyRecords(oncologyRes);
        }
      } catch (err) {
        console.error("[PreAnaesthesiaCheckup] Error fetching oncology records:", err);
      } finally {
        setIsLoading(false);
      }
    };
    fetchBookingAndOncology();
  }, [patientId, doctorId]);

  useEffect(() => {
    if (patientId) {
      getPatientVitals(patientId)
        .then(res => {
          if (res && res.data) {
            const v = res.data;
            setPac(p => ({
              ...p,
              bp: p.bp || (v.blood_pressure ? String(v.blood_pressure).replace(" mmHg", "") : ""),
              pulse: p.pulse || (v.pulse ? String(v.pulse).replace(" bpm", "") : ""),
              spo2: p.spo2 || (v.spo2 ? String(v.spo2).replace("%", "") : ""),
              temperature: p.temperature || (v.temperature ? String(v.temperature).replace("°C", "") : ""),
              height: p.height || (v.height ? String(v.height).replace(" cm", "") : ""),
              weight: p.weight || (v.weight ? String(v.weight).replace(" kg", "") : ""),
            }));
          }
        })
        .catch(err => console.error("[PreAnaesthesiaCheckup] Failed to fetch vitals:", err));
    }
  }, [patientId]);

  const handleBookingSelect = async (bId) => {
    setSelectedBookingId(bId);
    if (bId) {
      const found = patientBookings.find(b => (b.booking_id || b.id) === bId);
      let docData = found;

      try {
        // Fetch full booking document to get the doctors_note sub-document
        const fullDoc = await getBooking(bId);
        if (fullDoc && fullDoc.data) {
          docData = fullDoc.data;
        }
      } catch (err) {
        console.error("[PreAnaesthesiaCheckup] Failed to fetch full booking document:", err);
      }

      setBookingData(docData || null);
      
      const bWard = docData?.booking?.wardBed || docData?.booking?.ward || docData?.fullBooking?.wardBed || docData?.fullBooking?.ward || docData?.wardBed || docData?.ward || "";
      const bHeight = docData?.doctors_note?.height || docData?.fullBooking?.doctors_note?.height || docData?.height || "";
      const bWeight = docData?.doctors_note?.weight || docData?.fullBooking?.doctors_note?.weight || docData?.weight || "";
      
      const rawAsa = docData?.booking?.asaClass || docData?.fullBooking?.asaClass || docData?.asaClass || "";
      let bAsa = "";
      if (rawAsa) {
        bAsa = rawAsa.replace(/^ASA\s*/i, "").trim();
      }

      setPac(prev => {
        const updates = { ...prev };
        if (bWard) updates.ward = bWard;
        if (bHeight && !prev.height) updates.height = String(bHeight).replace(" cm", "");
        if (bWeight && !prev.weight) updates.weight = String(bWeight).replace(" kg", "");
        if (bAsa && !prev.asaGrade) updates.asaGrade = bAsa;
        return updates;
      });

      if (recordId) {
        await linkAnaesthesiaToBooking(recordId, bId);
      }
    } else {
      setBookingData(null);
      if (recordId) {
        await linkAnaesthesiaToBooking(recordId, null);
      }
    }
  };

  const patientInfo = usePatientInfo(patientId);
  const fullBooking = bookingData?.fullBooking || bookingData?.booking || bookingData || {};
  const { age: autoAge, sex: autoSex } = splitAgeSex(patientInfo.ageSex || fullBooking.ageSex || fullBooking.age_sex || "");
  const autoName = patientInfo.name || fullBooking.patientName || fullBooking.patient_name || "";
  const autoUnitName = fullBooking.unitName || fullBooking.unit_name || "";
  const autoWard = fullBooking.wardBed || fullBooking.ward || bookingData?.wardBed || bookingData?.ward || "";
  const autoTreatingDoctor = selectedBookingId ? (fullBooking.treatingDoctor || fullBooking.treating_doctor || bookingData?.surgeon || "") : (pac.treatingDoctor || "");
  const autoProcedureName = selectedBookingId ? (fullBooking.procedureName || fullBooking.procedure_name || bookingData?.procedure || "") : (pac.procedureName || "");
  const autoDateOfSurgery = selectedBookingId ? (fullBooking.surgeryDate || fullBooking.surgery_date || bookingData?.date || "") : (pac.procedureDate || "");

  // Chemotherapy / radiotherapy — from the separate oncology-records lookup,
  // NOT from the booking document (those fields don't exist there).
  const autoChemotherapy = formatChemotherapySummary(oncologyRecords?.chemotherapy);
  const autoRadiotherapy = formatRadiotherapySummary(oncologyRecords?.radiotherapy);

  const bmi = (() => {
    const h = parseFloat(pac.height);
    const w = parseFloat(pac.weight);
    if (!h || !w) return "";
    const m = h / 100;
    return (w / (m * m)).toFixed(1);
  })();

  // ── Derived / computed scores (read-only, based purely on data already
  // captured elsewhere in the form — never entered directly by the user).
  const { score: stopBangScore, risk: stopBangRisk } = computeStopBangScore(pac.stopBang);
  const comorbidityCount = computeComorbidityCount(pac);
  const positiveFindingsCount = computePositiveFindingsCount(pac);

  const handleSave = async () => {
    if (!recordId) {
      setSnackbar({ open: true, message: "No active anaesthesia record found.", severity: "error" });
      return;
    }
    try {
      const res = await saveAnaesthesiaSection(recordId, "pac", pac);
      if (res?.status !== "success") {
        throw new Error("Save failed");
      }
      setSnackbar({ open: true, message: "Pre-Anaesthesia Checkup saved successfully", severity: "success" });
    } catch (err) {
      console.error("[PreAnaesthesiaCheckup] Save error:", err);
      setSnackbar({ open: true, message: "Failed to save Pre-Anaesthesia Checkup.", severity: "error" });
    }
  };

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
              <Typography sx={{ fontSize: 20, fontWeight: FW_LIGHT, fontFamily: FONT, color: C.textPrimary, letterSpacing: "-0.02em" }}>Pre-Anaesthesia Checkup (PAC)</Typography>
            </Box>
          </Box>
          <Box sx={{ px: 1.5, py: 0.5, border: `1px solid ${C.border}`, background: C.white, fontSize: 11, fontFamily: FONT, color: C.textMuted }}>NCG-KCDO NER v2.0</Box>
        </Box>

        <Box sx={{ p: 3, position: "relative", minHeight: "60vh" }}>
          {isLoading && (
            <Box sx={{ position: "absolute", inset: 0, background: "rgba(255,255,255,0.4)", backdropFilter: "blur(5px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
              <Box sx={{ background: C.white, p: "32px 48px", textAlign: "center", border: `1px solid ${C.border}` }}>
                <Typography sx={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, mb: 1.5 }}>Loading Record...</Typography>
              </Box>
            </Box>
          )}

          <Box sx={{ filter: isLoading ? "blur(3px)" : "none", pointerEvents: isLoading ? "none" : "auto" }}>

            <AnaesthesiaHistoryAccordion history={history} currentRecordId={recordId} title="Past Anaesthesia Records" />

            {/* 1. General Details */}
            <SectionBox title="1. General Details">
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {/* ① Procedure Context */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Procedure Context
                  </Typography>
                  <FG cols={3}>
                    <Box sx={{ gridColumn: "1/-1", mb: 1 }}>
                      <FormControl fullWidth size="small">
                        <InputLabel sx={{ fontSize: 12, fontFamily: FONT }}>Link to Surgical Booking (Optional)</InputLabel>
                        <Select
                          value={selectedBookingId}
                          label="Link to Surgical Booking (Optional)"
                          onChange={(e) => handleBookingSelect(e.target.value)}
                          sx={{ ...inputSx, background: C.white }}
                        >
                          <MenuItem value="">
                            <em>Standalone / Non-Surgical Procedure (Chemo, Radio, Endoscopy, Pain, etc.)</em>
                          </MenuItem>
                          {patientBookings
                            .filter((b) => {
                              const status = (b.status || b.bookingStatus || b.fullBooking?.bookingStatus || b.booking?.bookingStatus || "").toLowerCase();
                              return !status.includes("cancel");
                            })
                            .map((b) => {
                              const bId = b.booking_id || b.id;
                              const proc = (b.fullBooking?.procedureName || b.procedureName || b.procedure_name || b.procedure || b.booking?.procedureName || "").trim() || "Unspecified Surgery";
                              const date = b.fullBooking?.surgeryDate || b.date || b.surgeryDate || b.surgery_date || b.booking?.surgeryDate || "";
                              const status = b.status || b.bookingStatus || b.fullBooking?.bookingStatus || b.booking?.bookingStatus || "Pending";
                              return (
                                <MenuItem key={bId} value={bId}>
                                  {`Surgery: ${proc} ${date ? `— ${date}` : ''} (${status})`}
                                </MenuItem>
                              );
                            })}
                        </Select>
                      </FormControl>
                    </Box>

                    {selectedBookingId ? (
                      <>
                        <ROInput label="Name of Procedure" value={autoProcedureName} />
                        <ROInput label="Date of Surgery" value={autoDateOfSurgery} />
                        <ROInput label="Treating Doctor" value={autoTreatingDoctor} />
                      </>
                    ) : (
                      <>
                        <TextField label="Name of Procedure" value={pac.procedureName || ""} size="small" onChange={(e) => set("procedureName", e.target.value)} sx={inputSx} fullWidth placeholder="e.g. Chemotherapy Port Placement" />
                        <TextField label="Date of Procedure" type="date" value={pac.procedureDate || todayISO()} size="small" onChange={(e) => set("procedureDate", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
                        <TextField label="Treating Doctor" value={pac.treatingDoctor || ""} size="small" onChange={(e) => set("treatingDoctor", e.target.value)} sx={inputSx} fullWidth />
                      </>
                    )}

                    <TextField label="Evaluating Anaesthesiologist" value={pac.evaluatingAnaesthesiologist || doctorName || ""} size="small" onChange={(e) => set("evaluatingAnaesthesiologist", e.target.value)} sx={inputSx} fullWidth />
                    <ROInput label="Unit Name" value={autoUnitName} />
                    <RdoGroup label="Nature of Procedure" options={["Urgent", "Emergency", "Elective"]} value={pac.natureOfSurgery} onChange={(v) => set("natureOfSurgery", v)} />
                  </FG>
                </Box>

                {/* ② Form Details */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Form Details
                  </Typography>
                  <FG cols={4}>
                    <RdoGroup label="Form Type" options={["PAC", "Review PAC"]} value={pac.formMode} onChange={(v) => set("formMode", v)} />
                    <TextField label="Ward" value={pac.ward || autoWard} size="small" onChange={(e) => set("ward", e.target.value)} sx={inputSx} fullWidth placeholder="e.g. Ward 4 / Bed 12" />
                    <TextField label="Department" value={pac.department || "Anaesthesia"} size="small" onChange={(e) => set("department", e.target.value)} sx={inputSx} fullWidth />
                    <ROInput label="Patient ID" value={patientId} />
                  </FG>
                </Box>

                {/* ③ Patient Info */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Patient Info
                  </Typography>
                  <FG cols={6}>
                    <ROInput label="Name" value={autoName} />
                    <ROInput label="Age" value={autoAge} />
                    <ROInput label="Sex" value={autoSex} />
                    <TextField label="Height (cm)" value={pac.height} type="number" size="small" onChange={(e) => set("height", e.target.value)} sx={inputSx} fullWidth />
                    <TextField label="Weight (kg)" value={pac.weight} type="number" size="small" onChange={(e) => set("weight", e.target.value)} sx={inputSx} fullWidth />
                    <ROInput label="BMI (Auto-calculated)" value={bmi} />
                  </FG>
                </Box>
              </Box>
            </SectionBox>

            {/* 2. Vitals */}
            <SectionBox title="2. Vitals">
              <FG cols={3}>
                <TextField label="Date" type="date" size="small" value={pac.vitalsDate} onChange={(e) => set("vitalsDate", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
                <TextField label="Temperature" value={pac.temperature} size="small" onChange={(e) => set("temperature", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Pulse" value={pac.pulse} size="small" onChange={(e) => set("pulse", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Blood Pressure" value={pac.bp} size="small" onChange={(e) => set("bp", e.target.value)} sx={inputSx} fullWidth placeholder="e.g., 120/80" />
                <TextField label="SpO2" value={pac.spo2} size="small" onChange={(e) => set("spo2", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Breath Holding Time (sec)" value={pac.breathHoldingTime} type="number" size="small" onChange={(e) => set("breathHoldingTime", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </SectionBox>

            {/* 3. General Physical Examination */}
            <SectionBox title="3. General Physical Examination">
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {/* ① General State */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    General State
                  </Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: "repeat(12, 1fr)", gap: 2 }}>
                    <Box sx={{ gridColumn: "span 6" }}>
                      <RdoGroup label="General Condition" options={["Good", "Fair", "Poor"]} value={pac.generalCondition} onChange={(v) => set("generalCondition", v)} />
                    </Box>
                    <Box sx={{ gridColumn: "span 6" }}>
                      <RdoGroup label="Orientation" options={["Normal", "Confused", "Very Poor", "Agitated"]} value={pac.orientation} onChange={(v) => set("orientation", v)} />
                    </Box>
                    <Box sx={{ gridColumn: "span 12", mt: 1 }}>
                      <CbxGroup label="Breathing Pattern" options={["Normal", "Tachypnoea", "Bradypnoea", "Obstructed", "Noisy Breathing", "Stridor"]} value={pac.breathingPattern} onChange={(v) => set("breathingPattern", v)} />
                    </Box>
                  </Box>
                </Box>

                {/* ② Physical Findings */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Physical Findings
                  </Typography>
                  <FG cols={3}>
                    {YES_NO_FINDINGS.map(([key, label]) => (
                      <RdoGroup key={key} label={label} options={["Yes", "No"]} value={pac[key]} onChange={(v) => set(key, v)} />
                    ))}
                  </FG>
                  <Box sx={{ mt: 2, maxWidth: 300 }}>
                    <ROInput label="Positive Findings (Auto-calculated)" value={`${positiveFindingsCount} / ${YES_NO_FINDINGS.length}`} />
                  </Box>
                </Box>

                {/* ③ Evaluation History */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Evaluation History
                  </Typography>
                  <RdoGroup label="Pre-Anaesthesia Evaluation History" options={["Yes", "No"]} value={pac.pacEvalHistory} onChange={(v) => set("pacEvalHistory", v)} />
                  {pac.pacEvalHistory === "Yes" && (
                    <TextField label="Details" value={pac.pacEvalHistoryDetails} size="small" multiline rows={2} onChange={(e) => set("pacEvalHistoryDetails", e.target.value)} sx={{ ...inputSx, mt: 1.5 }} fullWidth />
                  )}
                </Box>
              </Box>
            </SectionBox>

            {/* 4. Comorbidities and Treatment History */}
            <SectionBox title="4. Comorbidities and Treatment History">
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>

                {/* ① Comorbidities */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Comorbidities
                  </Typography>
                  <FG cols={2}>
                    {COMORBIDITY_FIELDS.map(([key, label]) => (
                      <TextField key={key} label={label} value={pac[key]} size="small" multiline rows={2} onChange={(e) => set(key, e.target.value)} sx={inputSx} fullWidth />
                    ))}
                    <ROInput label="Comorbidities Documented (Auto-calculated)" value={`${comorbidityCount} / ${COMORBIDITY_FIELDS.length}`} />
                  </FG>
                </Box>

                {/* ② Oncology Treatment History */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Oncology Treatment History
                  </Typography>
                  <FG cols={2}>
                    <ROInput label="Chemotherapy Drugs (from Medical Onco Module)" value={autoChemotherapy} />
                    <ROInput label="Radiotherapy (from Radiotherapy Onco Module)" value={autoRadiotherapy} />
                  </FG>
                </Box>

                {/* ③ Surgical & Medical History */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Surgical & Medical History
                  </Typography>
                  <FG cols={2}>
                    <TextField label="Any H/O Surgeries" value={pac.anyHOSurgeries} size="small" multiline rows={2} onChange={(e) => set("anyHOSurgeries", e.target.value)} sx={inputSx} fullWidth />
                    <TextField label="H/O Transfusion / Blood Disorders" value={pac.hoTransfusion} size="small" multiline rows={2} onChange={(e) => set("hoTransfusion", e.target.value)} sx={inputSx} fullWidth />
                    <TextField label="Acute/Chronic Pain" value={pac.acuteChronicPain} size="small" multiline rows={2} onChange={(e) => set("acuteChronicPain", e.target.value)} sx={inputSx} fullWidth />
                    <TextField label="Drug Allergies" value={pac.drugAllergies} size="small" multiline rows={2} onChange={(e) => set("drugAllergies", e.target.value)} sx={inputSx} fullWidth />
                  </FG>
                </Box>

                {/* ④ Obesity & OSA Assessment (STOP-BANG) */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Obesity & OSA Assessment (STOP-BANG)
                  </Typography>
                  <Box sx={{ mb: 2 }}>
                    <CbxGroup label="Obesity (STOP-BANG Questionnaire) — Multiple choice possible" options={STOP_BANG_OPTIONS} value={pac.stopBang} onChange={(v) => set("stopBang", v)} />
                  </Box>
                  <FG cols={2}>
                    <ROInput label="STOP-BANG Score (Auto-calculated)" value={`${stopBangScore} / 8`} />
                    <ROInput label="OSA Risk (Auto-calculated)" value={stopBangRisk} />
                  </FG>
                </Box>

                {/* ⑤ Additional Medical History */}
                <Box sx={{ p: 2, background: C.bgPrimary, border: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_BOLD, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }}>
                    Additional Medical History
                  </Typography>
                  <TextField label="Any Other Relevant Medical History" value={pac.otherHistory} size="small" multiline rows={2} onChange={(e) => set("otherHistory", e.target.value)} sx={inputSx} fullWidth />
                </Box>

              </Box>
            </SectionBox>

            {/* 5. Substance Abuse History */}
            <SectionBox title="5. Substance Abuse History">
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={thSx}>Substance</TableCell>
                      <TableCell sx={thSx}>Duration</TableCell>
                      <TableCell sx={thSx}>Remarks</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {SUBSTANCE_ROWS.map(([key, label]) => (
                      <TableRow key={key} sx={{ "&:hover": { background: C.bgSecondary } }}>
                        <TableCell sx={tdSx}>{label}</TableCell>
                        <TableCell sx={tdSx}>
                          <TextField size="small" value={pac.substanceAbuse[key].duration} onChange={(e) => setSA(key, "duration", e.target.value)} sx={{ ...inputSx, width: 140 }} />
                        </TableCell>
                        <TableCell sx={tdSx}>
                          <TextField size="small" value={pac.substanceAbuse[key].remarks} onChange={(e) => setSA(key, "remarks", e.target.value)} sx={{ ...inputSx, width: "100%" }} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </SectionBox>

            {/* 6. Airway Assessment */}
            <SectionBox title="6. Airway Assessment">
              <FG cols={3}>
                <RdoGroup label="Nares" options={["Normal", "Abnormal"]} value={pac.nares} onChange={(v) => set("nares", v)} />
                <RdoGroup label="Deviated Nasal Septum" options={["Normal", "Right", "Left", "Post Surgical"]} value={pac.deviatedNasalSeptum} onChange={(v) => set("deviatedNasalSeptum", v)} />
                <RdoGroup label="Mouth Opening" options={[">4 cm", "3-4 cm", "<3 cm"]} value={pac.mouthOpening} onChange={(v) => set("mouthOpening", v)} />
                <CbxGroup label="Teeth" options={["Normal", "Edentulous", "Protruding", "Artificial", "Buck", "Loose tooth"]} value={pac.teeth} onChange={(v) => set("teeth", v)} />
                <RdoGroup label="Mallampati" options={["0", "1", "2", "3", "4", "NA"]} value={pac.mallampati} onChange={(v) => set("mallampati", v)} />
                <RdoGroup label="Jaw Sliding" options={["+1", "0", "-1"]} value={pac.jawSliding} onChange={(v) => set("jawSliding", v)} />
                <RdoGroup label="Thyromental Distance" options={[">7.5 cm", "6-7.5 cm", "<6 cm"]} value={pac.thyromentalDistance} onChange={(v) => set("thyromentalDistance", v)} />
                <TextField label="Neck" value={pac.neck} size="small" onChange={(e) => set("neck", e.target.value)} sx={inputSx} fullWidth />
                <TextField label="Spine" value={pac.spine} size="small" onChange={(e) => set("spine", e.target.value)} sx={inputSx} fullWidth />
                <Box sx={{ display: "flex", gap: 2, alignItems: "flex-end" }}>
                  <RdoGroup label="Tracheostomy" options={["Yes", "No"]} value={pac.tracheostomy} onChange={(v) => set("tracheostomy", v)} />
                  {pac.tracheostomy === "Yes" && (
                    <TextField label="Details" value={pac.tracheostomyDetails} size="small" onChange={(e) => set("tracheostomyDetails", e.target.value)} sx={{ ...inputSx, flex: 1 }} />
                  )}
                </Box>
                <Box sx={{ gridColumn: "1/-1" }}>
                  <TextField label="Airway Comments (if any other)" value={pac.airwayComments} size="small" multiline rows={2} onChange={(e) => set("airwayComments", e.target.value)} sx={inputSx} fullWidth />
                </Box>
              </FG>
            </SectionBox>

            {/* 7. Systemic Examination */}
            <SectionBox title="7. Systemic Examination">
              <FG cols={2}>
                {SYSTEMIC_FIELDS.map(([key, label]) => (
                  <TextField key={key} label={label} value={pac[key]} size="small" multiline rows={2} onChange={(e) => set(key, e.target.value)} sx={inputSx} fullWidth />
                ))}
              </FG>
            </SectionBox>

            {/* 8. Investigations and Imaging */}
            <SectionBox title="8. Investigations and Imaging">
              <LabInvestigations
                patientId={patientId}
                doctorId={doctorId}
                currentBookingId={recordId || bookingData?.booking_id}
                department="anaesthesia"
                currentProcedure={autoProcedureName ? `Anaesthesia - ${autoProcedureName}` : "Anaesthesia"}
                bookingData={{ ...bookingData, anaesthesia: activeRecordData }}
              />
            </SectionBox>

            {/* 9. Speciality Reference */}
            <SectionBox title="9. Speciality Reference">
              <FG cols={2}>
                <CbxGroup label="Referred To" options={REFERRAL_DEPARTMENTS} value={pac.referredTo ? pac.referredTo.split(",").filter(Boolean) : []} onChange={(v) => set("referredTo", v.join(","))} />
                <TextField label="Remarks" value={pac.specialityRemarks} size="small" multiline rows={2} onChange={(e) => set("specialityRemarks", e.target.value)} sx={inputSx} fullWidth />
              </FG>
            </SectionBox>

            {/* 10. Status */}
            <SectionBox title="10. Status">
              <FG cols={3}>
                <RdoGroup label="ASA Grade" options={["I", "II", "III", "IV", "V", "VI", "E"]} value={pac.asaGrade} onChange={(v) => set("asaGrade", v)} />
                <RdoGroup label="Fitness Status" options={["Yes with accepted risk", "No"]} value={pac.fitnessStatus} onChange={(v) => set("fitnessStatus", v)} />
                <Box>
                  <RdoGroup label="Anaesthesia Consent Administered" options={["Yes", "No"]} value={pac.consentGiven} onChange={(v) => set("consentGiven", v)} />
                  {pac.consentGiven === "Yes" && (
                    <Box sx={{ mt: 1 }}>
                      <input
                        type="file"
                        ref={consentFileInputRef}
                        onChange={handleConsentFileChange}
                        style={{ display: "none" }}
                        accept="image/*,.pdf,.doc,.docx"
                      />
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => consentFileInputRef.current?.click()}
                          disabled={isUploadingConsent}
                          startIcon={<UploadFileRounded sx={{ fontSize: 16 }} />}
                          sx={{
                            fontFamily: FONT,
                            fontSize: 12,
                            textTransform: "none",
                            borderColor: C.border,
                            color: C.textPrimary,
                            "&:hover": { borderColor: C.black, background: "rgba(0,0,0,0.04)" }
                          }}
                        >
                          {isUploadingConsent ? "Uploading..." : pac.consentDocumentUrl ? "Re-upload Consent Doc" : "Upload Consent Document"}
                        </Button>
                      </Box>
                      {pac.consentDocumentUrl && (
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mb: 1 }}>
                          <DescriptionRounded sx={{ fontSize: 16, color: "#52c41a" }} />
                          <Typography
                            component="a"
                            href={pac.consentDocumentUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            sx={{
                              fontSize: 12,
                              fontFamily: FONT,
                              color: "#1890ff",
                              textDecoration: "underline",
                              wordBreak: "break-all"
                            }}
                          >
                            View Uploaded Consent
                          </Typography>
                        </Box>
                      )}
                    </Box>
                  )}
                  <TextField label="Date" type="date" size="small" value={pac.consentDate} onChange={(e) => set("consentDate", e.target.value)} sx={{ ...inputSx, mt: 1 }} fullWidth InputLabelProps={{ shrink: true }} />
                </Box>
              </FG>
            </SectionBox>

            {/* 11. Anaesthesiologist's Advice & Pre-operative Orders */}
            <SectionBox title="11. Anaesthesiologist's Advice & Pre-operative Orders">
              <RdoGroup label="Anaemia Management" options={["Yes", "No"]} value={pac.anemiaManagement} onChange={(v) => set("anemiaManagement", v)} />
              {pac.anemiaManagement === "Yes" && (
                <TextField label="Remarks" value={pac.anemiaRemarks} size="small" multiline rows={2} onChange={(e) => set("anemiaRemarks", e.target.value)} sx={{ ...inputSx, mt: 1 }} fullWidth />
              )}
              <TextField label="Pre-Operative Remarks" value={pac.preOperativeRemarks} size="small" multiline rows={2} onChange={(e) => set("preOperativeRemarks", e.target.value)} sx={{ ...inputSx, mt: 1.5 }} fullWidth />
              <Box sx={{ mt: 2, p: 1.5, border: `1px dashed ${C.border}`, background: C.bgSecondary }}>
                <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, fontStyle: "italic" }}>
                  Fasting guidelines prior to surgery: 2 hours for clear liquids. 8 hours for heavy meal, 6 hours for light meal/formula feeds, 4 hours for breast feeding.
                </Typography>
              </Box>
            </SectionBox>

            {/* 12. Approvals */}
            <SectionBox title="12. Approvals">
              <FG cols={3}>
                <Sel
                  label="Anaesthesiologist's Name"
                  value={pac.anaesthesiologistId || doctorId || ""}
                  onChange={(selectedId) => {
                    const found = anaesthetistList.find(a => a.value === selectedId);
                    setPac(prev => ({
                      ...prev,
                      anaesthesiologistId: selectedId,
                      anaesthesiologistName: found ? found.label : selectedId,
                      anaesthesiologistESign: ""
                    }));
                  }}
                  options={anaesthetistList.length > 0 ? anaesthetistList : [{ value: doctorId || "", label: pac.anaesthesiologistName || doctorName || "Select Anaesthesiologist" }]}
                />
                <Box sx={{ display: "flex", flexDirection: "column" }}>
                  <Button
                    disabled={pac.anaesthesiologistESign === "Yes"}
                    onClick={openOtpDialog}
                    sx={{
                      height: 40,
                      background: pac.anaesthesiologistESign === "Yes" ? "#52c41a" : C.black,
                      color: C.white,
                      fontFamily: FONT,
                      fontSize: 13,
                      fontWeight: 500,
                      textTransform: "none",
                      borderRadius: "4px",
                      "&:hover": { background: pac.anaesthesiologistESign === "Yes" ? "#52c41a" : "#1a1a1a" },
                      width: "100%"
                    }}
                  >
                    {pac.anaesthesiologistESign === "Yes" ? "Approved ✅" : "Authorize via OTP"}
                  </Button>
                </Box>
                <TextField label="Date" type="date" size="small" value={pac.approvalDate} onChange={(e) => set("approvalDate", e.target.value)} sx={inputSx} fullWidth InputLabelProps={{ shrink: true }} />
              </FG>
            </SectionBox>

            <Button sx={saveBtnSx} onClick={handleSave}>
              <SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />
              Save Pre-Anaesthesia Checkup
            </Button>
          </Box>
        </Box>
      </Box>

      {/* ─── OTP Authorization Dialog ─────────────────────────────────────── */}
      <Dialog open={otpDialog} onClose={closeOtpDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 16, fontWeight: FW_NORMAL }}>
          Authorize {selectedAnaesthetistLabel()}
        </DialogTitle>
        <DialogContent>
          {otpStep === "send" ? (
            <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, mt: 1 }}>
              A one-time password will be sent to {selectedAnaesthetistLabel()} to confirm their
              authorization. Click "Send OTP" to proceed.
            </Typography>
          ) : (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, mb: 2 }}>
                An OTP has been sent to {selectedAnaesthetistLabel()}. Enter the code below to complete
                authorization.
              </Typography>
              <TextField
                autoFocus
                fullWidth
                label="Enter OTP"
                value={otpInput}
                onChange={e => { setOtpInput(e.target.value); setOtpError(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleVerifyOtp(); }}
                error={!!otpError}
                helperText={otpError || " "}
                inputProps={{ inputMode: "numeric", maxLength: 6 }}
                sx={inputSx}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeOtpDialog} sx={{ fontFamily: FONT, textTransform: "none", color: C.textSecond }}>
            Cancel
          </Button>
          {otpStep === "send" ? (
            <Button
              onClick={handleSendOtp}
              disabled={otpSending}
              variant="contained"
              sx={{ fontFamily: FONT, textTransform: "none", background: C.black, "&:hover": { background: "#1a1a1a" } }}
            >
              {otpSending ? "Sending…" : "Send OTP"}
            </Button>
          ) : (
            <Button
              onClick={handleVerifyOtp}
              disabled={!otpInput.trim()}
              variant="contained"
              sx={{ fontFamily: FONT, textTransform: "none", background: C.black, "&:hover": { background: "#1a1a1a" } }}
            >
              Verify & Approve
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar open={snackbar.open} autoHideDuration={4000}
        onClose={() => setSnackbar((p) => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}>
        <Alert severity={snackbar.severity} sx={{ width: "100%", fontFamily: FONT }}>
          {snackbar.message}
        </Alert>
      </Snackbar>
    </motion.div>
  );
};

export default PreAnaesthesiaCheckup;