import React, { useState, useEffect, useRef } from "react";
import RadiationTherapyWorkflow from "./RadiationTherapyWorkflow";
import {
  Box,
  Typography,
  Button,
  Radio,
  RadioGroup as MuiRadioGroup,
  FormControlLabel,
  Checkbox,
  TextField,
  Select,
  MenuItem,
  IconButton,
  Collapse,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Snackbar,
  Alert
} from "@mui/material";
import { Add, Delete, ExpandMore, ExpandLess, Mic as MicIcon, Stop as StopIcon } from "@mui/icons-material";
import ClinicalSummaryTab from "./ClinicalSummaryTabradi";
import DischargeSummary from "./Dischargesummary";
import DICOMViewer from "./DICOMViewer";
import StructuredNotePanel from "./structurenoteview";
import RadiotherapyProtocolSelector from "./RadiotherapyProtocolSelector";
import TumorBoardCommonElement from "./TumorBoardCommonElement";
// ─── BRAND TOKENS (matching Doctorassist.AI / TumorBoard) ──────────
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_NORMAL = 400;
const FW_MEDIUM = 500;

const C = {
  black: "#000000",
  white: "#ffffff",
  bgPrimary: "#ffffff",
  bgSecondary: "#fafafa",
  bgTertiary: "#f5f5f5",
  textPrimary: "#000000",
  textSecond: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStrong: "#000000",
};

const labelStyle = {
  fontSize: "0.65rem",
  textTransform: "uppercase",
  letterSpacing: "0.2em",
  color: C.textMuted,
  fontFamily: FONT,
  fontWeight: FW_NORMAL,
};

const inputStyle = {
  fontFamily: FONT,
  fontSize: "13px",
  fontWeight: FW_LIGHT,
  borderRadius: 0,
  "& .MuiOutlinedInput-root": {
    borderRadius: 0,
    background: C.bgPrimary,
    "& fieldset": { borderColor: C.border },
    "&:hover fieldset": { borderColor: C.textMuted },
    "&.Mui-focused fieldset": { borderColor: C.black, borderWidth: "1px" },
  },
  "& .MuiInputBase-input": {
    padding: "9px 12px",
    height: "auto",
  }
};

const btnStyle = {
  fontFamily: FONT,
  fontWeight: FW_MEDIUM,
  textTransform: "none",
  borderRadius: 0,
  boxShadow: "none",
  "&:hover": { boxShadow: "none" }
};

// Mock OTP codes accepted for the approval authorization (simulation only).
const DEMO_OTP_CODES = ["1234", "123456", "0000", "999999"];

// ─── REUSABLE UI COMPONENTS ──────────────────────────────────────

const SectionHeader = ({ num, title, note }) => (
  <Box sx={{ display: "flex", alignItems: "baseline", gap: 1.5, background: C.black, color: C.white, p: "13px 20px" }}>
    <Typography sx={{ fontSize: 14.5, fontWeight: FW_MEDIUM, letterSpacing: "0.02em", textTransform: "uppercase", m: 0 }}>
      {title}
    </Typography>
    {note && (
      <Typography sx={{ ml: "auto", fontSize: 10.5, color: C.textMuted, fontWeight: FW_LIGHT, letterSpacing: "0.02em" }}>
        {note}
      </Typography>
    )}
  </Box>
);

const FieldRow = ({ label, tag, nested = false, hidden = false, children }) => {
  if (hidden) return null;
  return (
    <Box sx={{
      display: "grid",
      gridTemplateColumns: { xs: "1fr", md: "280px 1fr" },
      gap: 2,
      borderBottom: `1px solid ${C.border}`,
      p: "16px 20px",
      alignItems: "start",
      background: nested ? C.bgSecondary : "transparent",
      pl: nested ? { xs: "20px", md: "36px" } : "20px"
    }}>
      <Box sx={{ pt: 1 }}>
        <Typography sx={{ fontSize: 12.5, color: C.textPrimary, lineHeight: 1.5 }}>{label}</Typography>
        {tag && <Typography sx={{ display: "inline-block", mt: 0.5, fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted }}>{tag}</Typography>}
      </Box>
      <Box sx={{ minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
};

const CustomRadio = ({ label, value, checked, onChange }) => (
  <FormControlLabel
    value={value}
    control={<Radio size="small" sx={{ color: C.border, "&.Mui-checked": { color: C.black } }} />}
    label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: checked ? C.black : C.textSecond }}>{label}</Typography>}
    checked={checked}
    onChange={onChange}
    sx={{
      m: 0, mr: 1, mb: 1, pr: 2,
      border: `1px solid ${checked ? C.black : C.border}`,
      background: checked ? C.bgSecondary : C.white,
      transition: "all 0.2s"
    }}
  />
);

const CustomCheckbox = ({ label, checked, onChange }) => (
  <FormControlLabel
    control={<Checkbox size="small" checked={checked} onChange={onChange} sx={{ color: C.border, "&.Mui-checked": { color: C.black } }} />}
    label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: checked ? C.black : C.textSecond }}>{label}</Typography>}
    sx={{ m: 0, mr: 1, mb: 1, pr: 2, border: `1px solid ${checked ? C.black : C.border}`, background: checked ? C.bgSecondary : C.white }}
  />
);

const OtherField = ({ show, label, value, fromProtocol }) => {
  if (!show) return null;
  return (
    <Box sx={{ mt: 1 }}>
      <TextField
        fullWidth
        multiline
        size="small"
        label={label}
        value={value || ""}
        sx={inputStyle}
        InputProps={{ readOnly: true }}
      />
      {fromProtocol && (
        <Typography sx={{ fontSize: 10, color: C.textMuted, mt: 0.5, fontStyle: "italic" }}>
          Imported from Protocol Master
        </Typography>
      )}
    </Box>
  );
};

// ─── HISTORY TABLE & STRUCTURED MODAL COMPONENT ───────────────────────

const StructuredHistoryModalContent = ({ content, C, FW_MEDIUM }) => {
  const wfData = content?.workflowData || (content?.patient || content?.baseline ? content : null);
  const recData = content?.recordDetailsData || content;

  const commonData = recData?.common || content?.common;
  const ebrtData = recData?.ebrt || content?.ebrt;
  const brachyData = recData?.brachy || content?.brachy;
  const dischargeData = recData?.discharge || content?.discharge;

  // Tabs definitions
  const tabs = [];
  if (wfData && Object.keys(wfData).length > 0) tabs.push({ id: "workflow", label: "Workflow / Baseline Data" });
  if (commonData && Object.keys(commonData).length > 0) tabs.push({ id: "common", label: "Common Elements" });
  if (ebrtData && Object.keys(ebrtData).length > 0) tabs.push({ id: "ebrt", label: "EBRT Module" });
  if (brachyData && Object.keys(brachyData).length > 0) tabs.push({ id: "brachy", label: "Brachytherapy" });
  if (dischargeData && Object.keys(dischargeData).length > 0) tabs.push({ id: "discharge", label: "Discharge Summary" });

  if (tabs.length === 0) {
    tabs.push({ id: "all", label: "Full Details" });
  }

  const [activeModalTab, setActiveModalTab] = useState(tabs[0]?.id || "workflow");

  const IGNORED_KEYS = ["labOrder", "radOrder", "investigationSuggestion", "labClinicalIndication", "radClinicalIndication"];

  const formatCellObject = (obj) => {
    if (!obj || typeof obj !== "object") return "-";

    const entries = Object.entries(obj).filter(([k, v]) => {
      if (IGNORED_KEYS.includes(k)) return false;
      if (v === null || v === undefined || v === "") return false;
      if (typeof v === "object" && !Array.isArray(v)) {
        if (v.status === "none" && Array.isArray(v.fields) && v.fields.length === 0) return false;
        if (Object.keys(v).length === 0) return false;
      }
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    });

    if (entries.length === 0) return "-";

    return (
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, py: 0.5 }}>
        {entries.map(([k, v]) => {
          const formattedKey = k
            .replace(/^phy[-_]/i, '')
            .replace(/([A-Z])/g, ' $1')
            .replace(/^./, s => s.toUpperCase())
            .trim();

          let displayVal = "";
          if (typeof v === "object" && v !== null) {
            if (Array.isArray(v)) {
              displayVal = v.map((item) => {
                if (typeof item === "object" && item !== null) {
                  return Object.entries(item)
                    .filter(([subK, subV]) => subV !== null && subV !== undefined && subV !== "")
                    .map(([subK, subV]) => {
                      const formattedSubKey = subK.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
                      const displaySubV = typeof subV === "object" && subV !== null ? JSON.stringify(subV) : String(subV);
                      return `${formattedSubKey}: ${displaySubV}`;
                    })
                    .join(", ");
                }
                return String(item);
              }).filter(Boolean).join(" | ");
            } else if (v.status) {
              displayVal = `Status: ${v.status}`;
            } else {
              displayVal = Object.entries(v)
                .filter(([subK, subV]) => subV !== null && subV !== undefined && subV !== "")
                .map(([subK, subV]) => {
                  const formattedSubKey = subK.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim();
                  const displaySubV = typeof subV === "object" && subV !== null ? JSON.stringify(subV) : String(subV);
                  return `${formattedSubKey}: ${displaySubV}`;
                })
                .join(", ");
            }
          } else {
            displayVal = String(v);
          }

          return (
            <Box key={k} sx={{ bgcolor: C.bgSecondary, border: `1px solid ${C.border}`, px: 1, py: 0.5, borderRadius: 1, display: "inline-flex", alignItems: "center", gap: 0.5 }}>
              <Typography sx={{ fontSize: "10px", fontWeight: 600, color: C.textMuted, textTransform: "uppercase" }}>
                {formattedKey}:
              </Typography>
              <Typography sx={{ fontSize: "12px", fontWeight: 500, color: C.textPrimary }}>
                {displayVal}
              </Typography>
            </Box>
          );
        })}
      </Box>
    );
  };

  const renderArrayTable = (arr) => {
    if (!Array.isArray(arr) || arr.length === 0) return null;

    if (typeof arr[0] !== "object" || arr[0] === null) {
      return (
        <Box sx={{ p: 2 }}>
          <Typography sx={{ fontSize: 13, color: C.textPrimary }}>{arr.join(", ")}</Typography>
        </Box>
      );
    }

    const allKeys = Array.from(new Set(arr.flatMap(item => Object.keys(item || {}))))
      .filter(k => k !== "id" && k !== "_isNew" && !IGNORED_KEYS.includes(k));

    if (allKeys.length === 0) return null;

    return (
      <Box sx={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px" }}>
          <thead>
            <tr style={{ background: C.bgSecondary, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "8px 12px", textAlign: "left", color: C.textMuted, fontWeight: 600, textTransform: "uppercase" }}>#</th>
              {allKeys.map(k => (
                <th key={k} style={{ padding: "8px 12px", textAlign: "left", color: C.textMuted, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap" }}>
                  {k.replace(/([A-Z])/g, ' $1').trim()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {arr.map((item, idx) => (
              <tr key={idx} style={{ borderBottom: idx === arr.length - 1 ? "none" : `1px solid ${C.border}` }}>
                <td style={{ padding: "8px 12px", color: C.textMuted, fontWeight: 600, verticalAlign: "top" }}>{idx + 1}</td>
                {allKeys.map(k => {
                  const val = item ? item[k] : null;
                  let content = "-";

                  if (val !== undefined && val !== null && val !== "") {
                    if (k === "savedAt" && typeof val === "string" && !isNaN(Date.parse(val))) {
                      content = new Date(val).toLocaleString();
                    } else if (typeof val === "object") {
                      content = formatCellObject(val);
                    } else {
                      content = String(val);
                    }
                  }

                  return (
                    <td style={{ padding: "8px 12px", color: C.textPrimary, verticalAlign: "top" }} key={k}>
                      {content}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    );
  };

  const renderObjectGrid = (dataObj) => {
    if (!dataObj || typeof dataObj !== "object") return <Typography sx={{ fontSize: 13, color: C.textMuted }}>No data recorded</Typography>;

    const entries = Object.entries(dataObj).filter(([k, v]) => {
      if (k === "treatmentId" || k === "savedAt" || k === "_id" || IGNORED_KEYS.includes(k)) return false;
      if (v === null || v === undefined || v === "") return false;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 0) return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    });

    if (entries.length === 0) return <Typography sx={{ fontSize: 13, color: C.textMuted }}>No data recorded</Typography>;

    const primitives = entries.filter(([_, v]) => typeof v !== "object" || v === null);
    const complexObjects = entries.filter(([_, v]) => typeof v === "object" && v !== null && !Array.isArray(v));
    const arrays = entries.filter(([_, v]) => Array.isArray(v) && v.length > 0);

    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
        {primitives.length > 0 && (
          <Box sx={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 2,
            p: 2,
            bgcolor: C.bgSecondary,
            border: `1px solid ${C.border}`,
            borderRadius: 1
          }}>
            {primitives.map(([k, v]) => (
              <Box key={k} sx={{ display: "flex", flexDirection: "column" }}>
                <Typography sx={{ fontSize: "11px", fontWeight: 600, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.5px", mb: 0.5 }}>
                  {k.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase()).trim()}
                </Typography>
                <Typography sx={{ fontSize: "13px", color: C.textPrimary, fontWeight: FW_MEDIUM, wordBreak: "break-word" }}>
                  {String(v)}
                </Typography>
              </Box>
            ))}
          </Box>
        )}

        {arrays.map(([k, arr]) => (
          <Box key={k} sx={{ border: `1px solid ${C.border}`, borderRadius: 1, overflow: "hidden" }}>
            <Box sx={{ p: 1.5, bgcolor: C.black, color: C.white }}>
              <Typography sx={{ fontSize: "12px", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {k.replace(/([A-Z])/g, ' $1').trim()}
              </Typography>
            </Box>
            {renderArrayTable(arr)}
          </Box>
        ))}

        {complexObjects.map(([k, obj]) => (
          <Box key={k} sx={{ border: `1px solid ${C.border}`, borderRadius: 1, overflow: "hidden" }}>
            <Box sx={{ p: 1.2, px: 2, bgcolor: C.bgTertiary, borderBottom: `1px solid ${C.border}` }}>
              <Typography sx={{ fontSize: "12px", fontWeight: 600, color: C.textPrimary, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                {k.replace(/([A-Z])/g, ' $1').trim()}
              </Typography>
            </Box>
            <Box sx={{ p: 2 }}>
              {renderObjectGrid(obj)}
            </Box>
          </Box>
        ))}
      </Box>
    );
  };

  const renderTabContent = () => {
    switch (activeModalTab) {
      case "workflow":
        return renderObjectGrid(wfData);
      case "common":
        return renderObjectGrid(commonData);
      case "ebrt":
        return renderObjectGrid(ebrtData);
      case "brachy":
        return renderObjectGrid(brachyData);
      case "discharge":
        return renderObjectGrid(dischargeData);
      default:
        return renderObjectGrid(content);
    }
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Box sx={{ display: "flex", gap: 1, borderBottom: `2px solid ${C.black}`, pb: 1, overflowX: "auto" }}>
        {tabs.map(tab => {
          const isActive = activeModalTab === tab.id;
          return (
            <Button
              key={tab.id}
              onClick={() => setActiveModalTab(tab.id)}
              sx={{
                borderRadius: 0,
                px: 2,
                py: 0.8,
                fontSize: "11px",
                fontWeight: isActive ? 600 : 400,
                color: isActive ? C.white : C.textPrimary,
                bgcolor: isActive ? C.black : C.bgSecondary,
                border: `1px solid ${isActive ? C.black : C.border}`,
                "&:hover": {
                  bgcolor: isActive ? "#333" : C.bgTertiary
                },
                whiteSpace: "nowrap",
                textTransform: "uppercase",
                letterSpacing: "0.5px"
              }}
            >
              {tab.label}
            </Button>
          );
        })}
      </Box>

      <Box sx={{ pt: 1 }}>
        {renderTabContent()}
      </Box>
    </Box>
  );
};

const HistoryTable = ({ historyData, hiddenKeys = [], expandDepth = 100 }) => {
  const [detailsModal, setDetailsModal] = useState(null);

  if (!Array.isArray(historyData) || historyData.length === 0) return null;

  return (
    <Box sx={{ mt: 3, mb: 3, border: `1px solid ${C.border}`, bgcolor: C.white }}>
      <Box sx={{ p: 2, borderBottom: `1px solid ${C.border}` }}>
        <Typography sx={{ fontSize: 13, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: FW_MEDIUM }}>
          History Records
        </Typography>
      </Box>
      <Box sx={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 400 }}>
          <thead>
            <tr style={{ background: C.bgSecondary, borderBottom: `1px solid ${C.border}` }}>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.textSecond, fontWeight: FW_MEDIUM, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px", width: "80px" }}>SNO</th>
              <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.textSecond, fontWeight: FW_MEDIUM, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Date</th>
              <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "11px", color: C.textSecond, fontWeight: FW_MEDIUM, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px", width: "150px" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {historyData.map((entry, idx) => {
              const isLast = idx === historyData.length - 1;
              return (
                <tr key={idx} style={{ borderBottom: isLast ? "none" : `1px solid ${C.border}` }}>
                  <td style={{ padding: "16px", fontSize: "13px", color: C.textMuted }}>{idx + 1}</td>
                  <td style={{ padding: "16px", fontSize: "13px", color: C.textPrimary, whiteSpace: "nowrap" }}>{new Date(entry.savedAt).toLocaleString()}</td>
                  <td style={{ padding: "16px", textAlign: "right" }}>
                    <Button
                      variant="outlined"
                      size="small"
                      onClick={() => setDetailsModal({ title: "Full Record Details", content: entry.data, hiddenKeys })}
                      sx={{ py: 0.5, px: 1.5, fontSize: "10px", borderColor: C.textPrimary, color: C.textPrimary, textTransform: "uppercase", borderRadius: 1, whiteSpace: "nowrap" }}
                    >
                      View Details
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Box>

      {detailsModal && (
        <Box sx={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, bgcolor: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Box sx={{ bgcolor: C.white, borderRadius: 1, border: `1px solid ${C.black}`, width: "95%", maxWidth: "1000px", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", overflow: "hidden" }}>
            <Box sx={{ p: "12px 20px", bgcolor: C.black, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <Typography sx={{ m: 0, fontSize: "15px", color: C.white, textTransform: "capitalize", fontWeight: FW_MEDIUM }}>{detailsModal.title.replace(/([A-Z])/g, ' $1')}</Typography>
              <IconButton onClick={() => setDetailsModal(null)} sx={{ color: C.white, p: 0 }}><Typography sx={{ fontSize: "20px" }}>&times;</Typography></IconButton>
            </Box>
            <Box sx={{ p: "20px", overflowY: "auto", fontSize: "14px", color: C.textSecond, lineHeight: "1.6" }}>
              <StructuredHistoryModalContent content={detailsModal.content} C={C} FW_MEDIUM={FW_MEDIUM} />
            </Box>
            <Box sx={{ p: "12px 20px", borderTop: `1px solid ${C.border}`, display: "flex", justifyContent: "flex-end", bgcolor: C.bgSecondary }}>
              <Button onClick={() => setDetailsModal(null)} sx={{ bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" }, px: 3, py: 1, fontSize: "12px", borderRadius: 1 }}>Close</Button>
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

// ─── MAIN COMPONENT ──────────────────────────────────────────────────
const defaultFormData = {
  // Part A — Common Data Elements
  common: {
    registration: { regType: "Revisit", referredFrom: "Outside", regNumber: "", visitNumber: "" },
    // Note: "Diagnostic Investigations / Imaging" is omitted per instruction
    diagnosis: {
      laterality: "", stagingType: "TNM", stagingOther: "",
      tClinical: "", nClinical: "", mClinical: "",
      tPathological: "", nPathological: "", mPathological: "",
      histopathology: "", grading: "", tumorMarkers: ""
    },
    tumorBoard: {
      speciality: "", doctorRecommendation: "", createdAt: "",
      tbFollowed: "", tbNotFollowedReason: "", tbAssign: "", tbScheduleDate: "", tbQuestion: ""
    },
    systemicTherapy: {
      type: "", startDate: "", endDate: "", cycleCount: "",
      regimen: "", drugs: "", schedule: "", toxicityRemarks: ""
    },
    treatment: {
      intent: "Curative", rtRole: "", rtSetting: "Per Primum",
      rtType: "", consentTaken: "", consentDate: "", consentFile: null
    }
  },
  // Part B — EBRT Module
  ebrt: {
    simulationSets: [{
      id: 1, intentPrimary: false, intentAdaptive: false, intentReplanning: false, intentSecondary: false,
      immobilisation: "",
      imaging: "", imagingOther: "", imagingFromProtocol: false,
      patientPos: "", positionOther: "", positionFromProtocol: false,
      specialTech: "", totalDose: "",
      totalFractions: "", fracSched: "", fracSchedOther: "", sibBoost: "", dosePerFrac: "",
      machine: "", startDate: "", endDate: "", peerReview: "", peerComments: ""
    }],
    procedure: {
      machine: "", machineOther: "", machineFromProtocol: false,
      systemicTherapy: "", combinationSpecify: "",
      technique: "", techniqueOther: "", techniqueFromProtocol: false,
      doseConstraints: "", doseConstraintsComment: "",
      energy: { photon: false, photonMV: "", electron: false, electronMeV: "", proton: false, protonMeV: "", other: "" }
    },
    planning: {
      verification: "", verificationType: "", verificationFrequency: "",
      adaptiveRadiation: "", adaptiveReason: ""
    },
    approvals: { roName: "", roSigned: false, mpName: "", mpSigned: false, rttName: "", rttSigned: false },
    interruption: {
      continueTreatment: "Continue with the same treatment", interruptReason: "",
      interruptedDate: "", resumeDate: "", completionDate: ""
    },
    completion: {
      rtCompletion: "Planned", rtCompletionJustification: "", clinResponse: "", responseCriteria: "",
      weightStart: "", weightCompletion: "", overallTreatmentTime: "",
      txGap: "No", gapFrom: "", gapTo: "", gapReason: "", gapCorrection: "", gapCorrectionDetails: "", interruptionDetails: ""
    },
    adverseEvents: [{ id: 1, date: "", event: "", gradingSystem: "CTCAE 5", grade: "", management: "" }],
    followUp: {
      date: "", time: "",
      imagingAdvised: "", imagingAdvisedOther: "",
      postCompletionPlan: "", adviceOnCompletion: ""
    },
    interruptionHistory: [],
    followUpHistory: [],
    rtTracking: { organsAtRisk: [""], exposureLevels: "", exposureStatus: "", organStatuses: [] }
  },
  // Part C — Brachytherapy Module
  brachy: {
    treatment: { clinicalAssessment: "", planOfTreatment: "" },
    prevEBRT: { intent: "", totalDose: "", totalFractions: "", fracSched: "", fracSchedOther: "", dosePerFrac: "", oar1: "", oar2: "", oar3: "", oar4: "" },
    procedure: { dateOfProcedure: "", anaesthesiaType: "", anaesthesiaTypeOther: "", implantUsed: "", implantUsedOther: "", euaFindings: "", tubesNeedles: "", planes: "", remarks: "" },
    imaging: { technique: "", targetDefinition: "", gtv: false, ctv: false, ptv: false },
    dosePrescription: { technique: "", techniqueOther: "", techniqueFromProtocol: false, prescriptionDose: "", numberOfFractions: "", prescriptionTarget: "", totalDose: "", doseConstraints: "" },
    approvals: { roName: "", roSigned: false, mpName: "", mpSigned: false, rttName: "", rttSigned: false },
    interruption: { continueTreatment: "Continue with the same treatment", interruptReason: "", interruptedDate: "", resumeDate: "", completionDate: "" },
    followUp: { date: "", time: "", imagingAdvised: "", imagingAdvisedOther: "", postCompletionPlan: "", adviceOnCompletion: "" },
    interruptionHistory: [],
    followUpHistory: [],
    rtTracking: { organsAtRisk: [""], exposureLevels: "", exposureStatus: "", organStatuses: [] }
  },
  // Part D — Discharge Summary
  discharge: {
    primary: {}, prevChemo: {},
    rtSummaryRows: [{ id: 1, visitNo: "", rtDate: "", totalDose: "", fractions: "", schedule: "", earlyReaction: "", followUpDate: "", followUpTime: "", remarks: "" }],
    toxicitySummaryRows: [{ id: 1, visitNo: "", gradingSystem: "", adverseEvent: "", grade: "" }],
    interruption: { gap: "", duration: "", reason: "" },
    followUp: { imagingAdvised: "", postCompletionPlan: "", adviceOnCompletion: "" },
    summaryParagraph: "",
    toxicitySummaryParagraph: ""
  }
};

const RadiotherapyRecord = ({ doctorId, patientId, doctorSpeciality, doctorName }) => {
  const [activeTab, setActiveTab] = useState("clinical-summary"); // common, ebrt, brachy, discharge
  const [doctorsList, setDoctorsList] = useState([]);
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGeneratingToxicitySummary, setIsGeneratingToxicitySummary] = useState(false);
  const [completedRecords, setCompletedRecords] = useState([]);

  // ─── OTP authorization state (Approvals) ─────────────────────────
  const [otpDialog, setOtpDialog] = useState(null); // { module, role, doctorLabel }
  const [otpStep, setOtpStep] = useState("send");   // "send" → "enter"
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSending, setOtpSending] = useState(false);

  // ─── Voice Dictation State ──────────────────────────────────────────
  const [isRecordingEbrt, setIsRecordingEbrt] = useState(false);
  const [isProcessingEbrt, setIsProcessingEbrt] = useState(false);
  const [isAutofillingEbrt, setIsAutofillingEbrt] = useState(false);
  const [transcriptEbrt, setTranscriptEbrt] = useState("");

  const [isRecordingBrachy, setIsRecordingBrachy] = useState(false);
  const [isProcessingBrachy, setIsProcessingBrachy] = useState(false);
  const [isAutofillingBrachy, setIsAutofillingBrachy] = useState(false);
  const [transcriptBrachy, setTranscriptBrachy] = useState("");
  const [structuredNoteExpanded, setStructuredNoteExpanded] = useState(false);
  const [protocolDialogOpen, setProtocolDialogOpen] = useState(false);

  // ─── RT Tracking State & Functions ─────────────────────────────────
  const [isCalculatingExposure, setIsCalculatingExposure] = useState({ ebrt: false, brachy: false });

  const handleOARChange = (moduleType, index, val) => {
    setFormData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if (!next[moduleType].rtTracking) {
        next[moduleType].rtTracking = { organsAtRisk: [""], exposureLevels: "", exposureStatus: "" };
      }
      const oars = [...(next[moduleType].rtTracking.organsAtRisk || [""])];
      oars[index] = val;
      next[moduleType].rtTracking.organsAtRisk = oars;
      return next;
    });
  };

  const addOARField = (moduleType) => {
    setFormData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if (!next[moduleType].rtTracking) {
        next[moduleType].rtTracking = { organsAtRisk: [""], exposureLevels: "", exposureStatus: "" };
      }
      const oars = [...(next[moduleType].rtTracking.organsAtRisk || [""])];
      oars.push("");
      next[moduleType].rtTracking.organsAtRisk = oars;
      return next;
    });
  };

  const removeOARField = (moduleType, index) => {
    setFormData(prev => {
      const next = JSON.parse(JSON.stringify(prev));
      if (!next[moduleType].rtTracking) return prev;
      const oars = (next[moduleType].rtTracking.organsAtRisk || [""]).filter((_, i) => i !== index);
      next[moduleType].rtTracking.organsAtRisk = oars.length > 0 ? oars : [""];
      return next;
    });
  };

  const calculateExposureLevels = async (moduleType) => {
    setIsCalculatingExposure(prev => ({ ...prev, [moduleType]: true }));
    try {
      let totalDose = "";
      let totalFractions = "";

      if (moduleType === "ebrt") {
        const simSet = formData.ebrt?.simulationSets?.[0] || {};
        totalDose = simSet.totalDose || "";
        totalFractions = simSet.totalFractions || "";
      } else if (moduleType === "brachy") {
        const dosePresc = formData.brachy?.dosePrescription || {};
        totalDose = dosePresc.totalDose || "";
        totalFractions = dosePresc.numberOfFractions || "";
      }

      const oars = formData[moduleType]?.rtTracking?.organsAtRisk || [];

      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/calculate-exposure-levels`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          totalFractions,
          totalDoseGy: totalDose,
          doseUnit: moduleType === "ebrt" ? "cGy" : "Gy",
          moduleType,
          organsAtRisk: oars
        })
      });

      const json = await res.json();
      if (json.status === "success" && json.data) {
        let detailsText = "";
        const rawDetails = json.data.details;
        if (typeof rawDetails === "object" && rawDetails !== null) {
          if (Array.isArray(rawDetails)) {
            detailsText = rawDetails.join("\n");
          } else {
            detailsText = Object.entries(rawDetails)
              .map(([key, val]) => `${key}: ${typeof val === "object" ? JSON.stringify(val) : val}`)
              .join("\n\n");
          }
        } else {
          detailsText = String(rawDetails || "");
        }

        setFormData(prev => {
          const next = JSON.parse(JSON.stringify(prev));
          if (!next[moduleType].rtTracking) {
            next[moduleType].rtTracking = { organsAtRisk: [""], exposureLevels: "", exposureStatus: "", organStatuses: [] };
          }
          next[moduleType].rtTracking.exposureLevels = detailsText;
          next[moduleType].rtTracking.exposureStatus = json.data.status || "Safe";
          next[moduleType].rtTracking.organStatuses = Array.isArray(json.data.organ_statuses) ? json.data.organ_statuses : [];
          return next;
        });
      } else {
        alert("Failed to calculate exposure levels.");
      }
    } catch (err) {
      console.error("Error calculating exposure levels:", err);
      alert("Error occurred while calculating exposure levels.");
    } finally {
      setIsCalculatingExposure(prev => ({ ...prev, [moduleType]: false }));
    }
  };

  const renderRTTrackingSection = (moduleType) => {
    const trackingData = formData[moduleType]?.rtTracking || { organsAtRisk: [""], exposureLevels: "", exposureStatus: "", organStatuses: [] };
    const oars = trackingData.organsAtRisk && trackingData.organsAtRisk.length > 0 ? trackingData.organsAtRisk : [""];
    const loading = isCalculatingExposure[moduleType];
    const status = trackingData.exposureStatus; // "Safe" or "Exceeded"
    const organStatuses = trackingData.organStatuses || [];

    return (
      <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
        <SectionHeader title="RT Tracking" note="Organ At Risk (OAR) Exposure Evaluation" />
        
        {/* Dynamic OARs list */}
        <FieldRow label="Organs at Risk (OARs)">
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            {oars.map((oar, idx) => (
              <Box key={idx} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder={`Organ at Risk #${idx + 1} (e.g. Spinal Cord, Heart, Lungs)`}
                  value={oar}
                  onChange={e => handleOARChange(moduleType, idx, e.target.value)}
                  sx={inputStyle}
                />
                {oars.length > 1 && (
                  <IconButton size="small" onClick={() => removeOARField(moduleType, idx)} sx={{ color: "error.main" }}>
                    <Delete fontSize="small" />
                  </IconButton>
                )}
              </Box>
            ))}
            <Box sx={{ mt: 0.5 }}>
              <Button
                size="small"
                onClick={() => addOARField(moduleType)}
                startIcon={<Add />}
                sx={{ ...btnStyle, fontSize: 11, color: C.textPrimary }}
              >
                Add Organ at Risk
              </Button>
            </Box>
          </Box>
        </FieldRow>

        {/* Calculate Button */}
        <FieldRow label="Calculate Exposure Levels">
          <Button
            variant="contained"
            onClick={() => calculateExposureLevels(moduleType)}
            disabled={loading}
            sx={{
              ...btnStyle,
              bgcolor: C.black,
              color: C.white,
              "&:hover": { bgcolor: "#333" }
            }}
          >
            {loading ? "Calculating via LLM..." : "Calculate Exposure Levels"}
          </Button>
        </FieldRow>

        {/* Overall Exposure Safety Status */}
        {status && (
          <FieldRow label="Overall Exposure Safety Status">
            <Alert
              severity={status.toLowerCase() === "safe" ? "success" : "error"}
              variant="filled"
              sx={{ borderRadius: 0, fontWeight: FW_MEDIUM, textTransform: "uppercase", letterSpacing: "0.05em" }}
            >
              Overall Exposure Status: {status}
            </Alert>
          </FieldRow>
        )}

        {/* Individual Organ Exposure Breakdown */}
        {organStatuses.length > 0 && (
          <FieldRow label="Individual Organ Statuses">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, width: "100%" }}>
              {organStatuses.map((item, idx) => {
                const isSafe = (item.status || "").toLowerCase() === "safe";
                return (
                  <Box
                    key={idx}
                    sx={{
                      p: 1.5,
                      border: `1px solid ${isSafe ? "#b7eb8f" : "#ffa39e"}`,
                      bgcolor: isSafe ? "#f6ffed" : "#fff1f0",
                      borderRadius: 1
                    }}
                  >
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 0.5 }}>
                      <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.black, fontFamily: FONT }}>
                        {item.organ || `Organ #${idx + 1}`}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 10,
                          fontWeight: 600,
                          px: 1,
                          py: 0.2,
                          borderRadius: 1,
                          color: isSafe ? "#389e0d" : "#cf1322",
                          bgcolor: isSafe ? "#d9f7be" : "#ffccc7",
                          textTransform: "uppercase",
                          letterSpacing: "0.05em",
                          fontFamily: FONT
                        }}
                      >
                        {item.status || "Unknown"}
                      </Typography>
                    </Box>
                    {item.details && (
                      <Typography sx={{ fontSize: 12, color: C.textSecond, lineHeight: 1.4, fontFamily: FONT }}>
                        {item.details}
                      </Typography>
                    )}
                  </Box>
                );
              })}
            </Box>
          </FieldRow>
        )}

        {/* Exposure Levels Summary Details */}
        {trackingData.exposureLevels && (
          <FieldRow label="Overall Evaluation Summary">
            <TextField
              fullWidth
              multiline
              rows={4}
              size="small"
              value={trackingData.exposureLevels}
              InputProps={{ readOnly: true }}
              sx={{ ...inputStyle, bgcolor: C.bgSecondary }}
            />
          </FieldRow>
        )}
      </Box>
    );
  };

  // ─── Patient Referrals State ─────────────────────────────────────────
  const [hospitalId, setHospitalId] = useState("");
  const [referralSpecializations, setReferralSpecializations] = useState([]);
  const [referralSelectedSpec, setReferralSelectedSpec] = useState("");
  const [referralsList, setReferralsList] = useState([]);
  const [referralLoading, setReferralLoading] = useState(false);
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralOutsideDoctor, setReferralOutsideDoctor] = useState(false);
  const [referralSnack, setReferralSnack] = useState("");
  const [referralForm, setReferralForm] = useState({
    patient_id: patientId || "",
    patient_name: "",
    doctor_id: doctorId || "",
    hospital_id: "",
    from_doctor_id: doctorId || "",
    from_doctor_name: doctorName || "",
    from_doctor_speciality: doctorSpeciality || "Radiation Oncology",
    to_doctor_id: "",
    to_doctor_name: "",
    to_doctor_hospital: "",
    to_doctor_speciality: "",
    reason_for_referral: "",
    additional_notes: "",
    referred_by_nurse: "",
    nurse_signed: false,
    date: new Date().toISOString().split("T")[0],
  });
  const setReferral = (k, v) => setReferralForm(p => ({ ...p, [k]: v }));

  const REFERRAL_QUICK_REASONS = [
    "Post-radiotherapy specialized care",
    "Cardiology evaluation & fitness assessment",
    "Nephrology consultation for elevated creatinine",
    "Oncology Multi-Disciplinary Team (MDT) review",
    "Histopathology / Biopsy second opinion",
    "Pain & Palliative Management",
  ];

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  const startRecording = async (moduleType) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.start();
      if (moduleType === 'ebrt') setIsRecordingEbrt(true);
      if (moduleType === 'brachy') setIsRecordingBrachy(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access denied or not available.");
    }
  };

  const stopRecording = (moduleType) => {
    if (mediaRecorderRef.current && (isRecordingEbrt || isRecordingBrachy)) {
      mediaRecorderRef.current.onstop = async () => {
        if (moduleType === 'ebrt') { setIsRecordingEbrt(false); setIsProcessingEbrt(true); }
        if (moduleType === 'brachy') { setIsRecordingBrachy(false); setIsProcessingBrachy(true); }

        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];

        try {
          const formDataObj = new FormData();
          formDataObj.append("file", audioBlob, "recording.webm");
          const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
          const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formDataObj });
          const data = await res.json();
          const transcribedText = data.text || data.transcription || "";
          if (transcribedText) {
            if (moduleType === 'ebrt') setTranscriptEbrt(transcribedText);
            if (moduleType === 'brachy') setTranscriptBrachy(transcribedText);
          }
        } catch (err) {
          console.error("Error processing audio:", err);
          alert("Error transcribing data.");
        } finally {
          if (moduleType === 'ebrt') setIsProcessingEbrt(false);
          if (moduleType === 'brachy') setIsProcessingBrachy(false);
        }
      };
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleAutofill = async (moduleType) => {
    const transcript = moduleType === 'ebrt' ? transcriptEbrt : transcriptBrachy;
    if (!transcript) return;

    if (moduleType === 'ebrt') setIsAutofillingEbrt(true);
    if (moduleType === 'brachy') setIsAutofillingBrachy(true);

    try {
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/radiotherapy-ebrt-brachy-structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript, module_type: moduleType })
      });
      const json = await res.json();
      if (json.status === "success" && json.data) {
        console.log("LLM Autofill Data:", json.data);

        // Deep merge the structured data into the current module state
        const updateNestedState = (currentObj, newObj, moduleName) => {
          for (const key in newObj) {
            if (typeof newObj[key] === 'object' && newObj[key] !== null && !Array.isArray(newObj[key])) {
              if (currentObj[key]) {
                updateNestedState(currentObj[key], newObj[key], moduleName);
              }
            } else {
              handleUpdate(moduleName, null, null, {
                ...formData[moduleName],
                [key]: newObj[key] !== undefined ? newObj[key] : currentObj[key]
              });
              // For nested structures like `planning` we should use the section specific update if it's top level section
              if (currentObj.hasOwnProperty(key)) {
                // handled by bulk update above, but we need to ensure the merge is clean
                // A simpler way is to just set the whole module state with a merged object.
              }
            }
          }
        };

        // Better way to update: merge objects and use single setFormData
        setFormData(prev => {
          const next = JSON.parse(JSON.stringify(prev));
          const mergeObjects = (target, source) => {
            for (const key of Object.keys(source)) {
              if (source[key] instanceof Object && key in target) {
                Object.assign(source[key], mergeObjects(target[key], source[key]));
              }
            }
            Object.assign(target || {}, source);
            return target;
          };
          next[moduleType] = mergeObjects(next[moduleType], json.data);
          return next;
        });

      } else {
        alert("Failed to auto-populate data.");
      }
    } catch (err) {
      console.error("Error during AI Autofill:", err);
      alert("An error occurred while auto-filling data.");
    } finally {
      if (moduleType === 'ebrt') setIsAutofillingEbrt(false);
      if (moduleType === 'brachy') setIsAutofillingBrachy(false);
    }
  };

  const handleProtocolApplied = (data) => {
    // data = { common, ebrt, brachy } — deep-merge into existing formData,
    // same merge strategy already used by the Voice Dictation autofill.
    console.log("[handleProtocolApplied] Incoming protocol data:", data);

    setFormData(prev => {
      console.log("[handleProtocolApplied] formData BEFORE merge — ebrt.simulationSets[0]:", prev.ebrt.simulationSets[0]);
      console.log("[handleProtocolApplied] formData BEFORE merge — ebrt.procedure:", prev.ebrt.procedure);
      console.log("[handleProtocolApplied] formData BEFORE merge — brachy.dosePrescription:", prev.brachy.dosePrescription);
      console.log("[handleProtocolApplied] formData BEFORE merge — brachy.procedure:", prev.brachy.procedure);

      const next = JSON.parse(JSON.stringify(prev));
      const mergeObjects = (target, source) => {
        for (const key of Object.keys(source || {})) {
          if (source[key] instanceof Object && !Array.isArray(source[key]) && key in target && target[key] instanceof Object) {
            mergeObjects(target[key], source[key]);
          } else {
            target[key] = source[key];
          }
        }
        return target;
      };
      mergeObjects(next.common, data.common);
      mergeObjects(next.ebrt, data.ebrt);
      mergeObjects(next.brachy, data.brachy);

      // The backend never assigns an `id` to simulationSets / adverseEvents
      // entries (it isn't a UI concern for it) — but React needs a stable,
      // unique key to render the list without warnings. Backfill any
      // missing ids here rather than depending on the source data to have them.
      if (Array.isArray(next.ebrt?.simulationSets)) {
        next.ebrt.simulationSets = next.ebrt.simulationSets.map((set, idx) =>
          set && set.id != null ? set : { ...set, id: `sim-${Date.now()}-${idx}` }
        );
      }
      if (Array.isArray(next.ebrt?.adverseEvents)) {
        next.ebrt.adverseEvents = next.ebrt.adverseEvents.map((evt, idx) =>
          evt && evt.id != null ? evt : { ...evt, id: `evt-${Date.now()}-${idx}` }
        );
      }

      console.log("[handleProtocolApplied] formData AFTER merge — ebrt.simulationSets[0]:", next.ebrt.simulationSets[0]);
      console.log("[handleProtocolApplied] formData AFTER merge — ebrt.procedure:", next.ebrt.procedure);
      console.log("[handleProtocolApplied] formData AFTER merge — ebrt.procedure.energy:", next.ebrt.procedure.energy);
      console.log("[handleProtocolApplied] formData AFTER merge — brachy.dosePrescription:", next.brachy.dosePrescription);
      console.log("[handleProtocolApplied] formData AFTER merge — brachy.procedure:", next.brachy.procedure);

      return next;
    });
  };

  // Form State Architecture
  const [formData, setFormData] = useState(JSON.parse(JSON.stringify(defaultFormData)));

  // ─── SAVE CURRENT TAB DATA TO DB ───────────────────────────────────
  const saveTab = async (tabId) => {
    try {
      const isDischarge = tabId === "discharge";
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/save-rt-record-details`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctorId: doctorId || "unknown",
          patientId: patientId || "unknown",
          hospitalId: "unknown",
          formData: { [tabId]: formData[tabId] },
          isComplete: isDischarge
        })
      });
      if (res.ok) {
        alert(`${tabId.charAt(0).toUpperCase() + tabId.slice(1)} data saved successfully!${isDischarge ? " Record completed." : ""}`);
        if (isDischarge) {
          setFormData(JSON.parse(JSON.stringify(defaultFormData)));
        }
        loadFormData();
      } else {
        alert(`Failed to save ${tabId} data.`);
      }
    } catch (err) {
      console.error("Save error:", err);
      alert("Error saving data. Please try again.");
    }
  };

  const loadFormData = async () => {
    if (!patientId || !doctorId) return;
    try {
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

      const [res, savedRes] = await Promise.all([
        fetch(`${API_BASE_URL}hms/users/data/context/get-radiotherapy-record?patientId=${patientId}&doctorId=${doctorId}&hospitalId=unknown`),
        fetch(`${API_BASE_URL}hms/users/data/context/get-rt-record-details?patientId=${patientId}&doctorId=${doctorId}`)
      ]);

      let incoming = null;
      let rtRecords = [];
      if (res.ok) {
        const json = await res.json();
        if (json.data && Object.keys(json.data).length > 0) {
          incoming = json.data;
        }
        if (json.past_records) {
          rtRecords = json.past_records;
        }
      }

      let savedData = null;
      let rtDetailsRecords = [];
      if (savedRes.ok) {
        const savedJson = await savedRes.json();
        if (savedJson.status === "success") {
          if (savedJson.data && Object.keys(savedJson.data).length > 0) {
            savedData = savedJson.data;
          }
          if (savedJson.past_records) {
            rtDetailsRecords = savedJson.past_records;
          }
        }
      }

      const mergedRecordsMap = {};
      rtRecords.forEach(r => {
        const tId = r.treatmentId || `legacy_${r.updatedAt || Math.random()}`;
        mergedRecordsMap[tId] = {
          treatmentId: tId,
          workflowData: r.data || {},
          savedAt: r.updatedAt || new Date().toISOString()
        };
      });

      rtDetailsRecords.forEach(r => {
        const tId = r.treatmentId;
        const d = r.history?.discharge;
        const date = (d && d.length > 0) ? d[d.length - 1].savedAt : new Date().toISOString();
        if (tId && mergedRecordsMap[tId]) {
          mergedRecordsMap[tId].recordDetailsData = r;
          mergedRecordsMap[tId].savedAt = date;
        } else {
          const id = tId || `legacy_${Math.random()}`;
          mergedRecordsMap[id] = {
            treatmentId: id,
            recordDetailsData: r,
            savedAt: date
          };
        }
      });
      setCompletedRecords(Object.values(mergedRecordsMap).sort((a, b) => new Date(b.savedAt) - new Date(a.savedAt)));

      const findValue = (obj, options) => {
        for (const key in obj) {
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            const result = findValue(obj[key], options);
            if (result) return result;
          } else if (typeof obj[key] === 'string') {
            const val = obj[key].toLowerCase().trim();
            for (const opt of options) {
              if (val === opt.toLowerCase().trim()) return opt;
            }
          }
        }
        return null;
      };

      const findDate = (obj) => {
        for (const key in obj) {
          if (typeof obj[key] === 'object' && obj[key] !== null) {
            const result = findDate(obj[key]);
            if (result) return result;
          } else if (typeof obj[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(obj[key])) {
            return obj[key];
          }
        }
        return null;
      };

      setFormData(prev => {
        const next = JSON.parse(JSON.stringify(prev));

        if (incoming) {
          if (incoming.patient) {
            const p = incoming.patient;
            const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
            if (name) next.discharge.primary["Name"] = name;
            if (p["pat-age"]) next.discharge.primary["Age"] = p["pat-age"];
            if (p.sex) next.discharge.primary["Gender"] = p.sex.charAt(0).toUpperCase() + p.sex.slice(1);
            if (p.contact) next.discharge.primary["Contact No."] = p.contact;
            if (p.diagnosis) next.discharge.primary["Co-morbidities"] = p.diagnosis;
          }

          if (incoming.intent) {
            const intentMatch = findValue(incoming.intent, ["curative", "palliative", "adjuvant", "neoadjuvant", "definitive", "salvage", "prophylactic"]);
            if (intentMatch) {
              const m = intentMatch.toLowerCase();
              if (m === "curative") next.common.treatment.intent = "Curative";
              else if (m === "palliative") next.common.treatment.intent = "Palliative";
              else if (m === "adjuvant") next.common.treatment.intent = "Adjuvant";
              else if (m === "neoadjuvant") next.common.treatment.intent = "Neoadjuvant";
              else if (m === "definitive") next.common.treatment.intent = "Definitive";
              else if (m === "salvage") next.common.treatment.intent = "Salvage";
              else if (m === "prophylactic") next.common.treatment.intent = "Prophylactic";
            }
          }

          if (incoming.setup) {
            const posMatch = findValue(incoming.setup, ["Supine", "Prone", "Lateral"]);
            if (posMatch) next.ebrt.simulationSets[0].patientPos = posMatch;
          }

          if (incoming.simulation) {
            const simMatch = findValue(incoming.simulation, ["ct", "mri", "pet-ct"]);
            if (simMatch) {
              const m = simMatch.toLowerCase();
              if (m === "ct") next.ebrt.simulationSets[0].imaging = "CT";
              if (m === "mri") next.ebrt.simulationSets[0].imaging = "CT / MRI";
              if (m === "pet-ct") next.ebrt.simulationSets[0].imaging = "CT / PET";
            }
            const simDate = findDate(incoming.simulation);
            if (simDate) next.ebrt.simulationSets[0].startDate = simDate;
          }

          const techMatch = findValue(incoming, ["3dcrt", "imrt", "vmat", "sbrt", "srs", "single portal", "2 dimensional"]);
          if (techMatch) {
            const m = techMatch.toLowerCase();
            if (m === "3dcrt") next.ebrt.procedure.technique = "3DCRT";
            if (m === "imrt") next.ebrt.procedure.technique = "IMRT";
            if (m === "vmat") next.ebrt.procedure.technique = "VMAT";
            if (m === "single portal") next.ebrt.procedure.technique = "Single Portal";
            if (m === "2 dimensional") next.ebrt.procedure.technique = "2 Dimensional";
          }

          const machineMatch = findValue(incoming, ["Cobalt", "LA", "CyberKnife", "MRI LINAC", "Proton"]);
          if (machineMatch) next.ebrt.procedure.machine = machineMatch;
          if (incoming.history) {
            next.history = incoming.history;
          }
        }

        // Overlay saved data
        if (savedData) {
          for (const key in savedData) {
            if (savedData[key]) {
              if (key === "history") {
                next.history = { ...(next.history || {}), ...savedData.history };
              } else {
                next[key] = { ...next[key], ...savedData[key] };
              }
            }
          }
        }

        // Populate Weight from incoming if not already set by savedData
        if (incoming && incoming.baseline && incoming.baseline["phy-weight"]) {
          if (!next.discharge.primary["Weight"]) {
            next.discharge.primary["Weight"] = incoming.baseline["phy-weight"];
          }
        }

        // Fallback to most recent completed workflow record for demographic data if missing in current active record
        if (rtRecords && rtRecords.length > 0) {
          // Find most recent completed record
          const mostRecent = [...rtRecords].sort((a, b) => new Date(b.updatedAt || b.savedAt || 0) - new Date(a.updatedAt || a.savedAt || 0))[0];
          if (mostRecent && mostRecent.data) {
            const oldData = mostRecent.data;
            if (oldData.patient) {
              const p = oldData.patient;
              const name = [p.firstName, p.lastName].filter(Boolean).join(" ");
              if (name && !next.discharge.primary["Name"]) next.discharge.primary["Name"] = name;
              if (p["pat-age"] && !next.discharge.primary["Age"]) next.discharge.primary["Age"] = p["pat-age"];
              if (p.sex && !next.discharge.primary["Gender"]) next.discharge.primary["Gender"] = p.sex.charAt(0).toUpperCase() + p.sex.slice(1);
              if (p.contact && !next.discharge.primary["Contact No."]) next.discharge.primary["Contact No."] = p.contact;
              if (p.diagnosis && !next.discharge.primary["Co-morbidities"]) next.discharge.primary["Co-morbidities"] = p.diagnosis;
            }
            if (oldData.baseline && oldData.baseline["phy-weight"]) {
              if (!next.discharge.primary["Weight"]) {
                next.discharge.primary["Weight"] = oldData.baseline["phy-weight"];
              }
            }
          }
        }

        return next;
      });

    } catch (err) {
      console.error("Failed to load radiotherapy data for autopopulation:", err);
    }

    // Fetch Tumor Board Plan
    try {
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const tbRes = await fetch(`${API_BASE_URL}hms/users/data/context/get-tumor-board-plan?patientId=${patientId}`);
      if (tbRes.ok) {
        const tbJson = await tbRes.json();
        if (tbJson.status === "success" && tbJson.data) {
          setFormData(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            next.common.tumorBoard = {
              planData: tbJson.data
            };
            return next;
          });
        }
      }
    } catch (err) {
      console.error("Failed to load tumor board plan:", err);
    }

    // Fetch Patient Registration Details
    try {
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const regRes = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-registration-details?patientId=${patientId}`);
      if (regRes.ok) {
        const regJson = await regRes.json();
        if (regJson.status === "success" && regJson.data) {
          setFormData(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            if (regJson.data.hms_id) next.common.registration.regNumber = regJson.data.hms_id;

            // Populate Discharge Summary Name, Age, Gender, Contact No. from patient_users
            if (regJson.data.name) next.discharge.primary["Name"] = regJson.data.name;
            if (regJson.data.gender) next.discharge.primary["Gender"] = regJson.data.gender;
            if (regJson.data.phone_number) next.discharge.primary["Contact No."] = regJson.data.phone_number;
            if (regJson.data.date_of_birth) {
              const dob = new Date(regJson.data.date_of_birth);
              const diff = Date.now() - dob.getTime();
              const age = Math.abs(new Date(diff).getUTCFullYear() - 1970);
              next.discharge.primary["Age"] = age.toString();
            }

            // Sync Common values into Discharge Summary
            if (!next.discharge.primary["Laterality"]) next.discharge.primary["Laterality"] = next.common.diagnosis.laterality || "";
            if (!next.discharge.primary["Histopathology"]) next.discharge.primary["Histopathology"] = next.common.diagnosis.histopathology || "";
            if (!next.discharge.primary["Intent"]) next.discharge.primary["Intent"] = next.common.treatment.intent || "";
            if (!next.discharge.primary["Role of Radiotherapy"]) next.discharge.primary["Role of Radiotherapy"] = next.common.treatment.rtRole || "";

            if (!next.discharge.primary["TNM Staging"]) {
              const c = next.common.diagnosis;
              if (c.stagingType === "TNM") {
                const cTNM = `cTNM: ${c.tClinical || 'Tx'}${c.nClinical || 'Nx'}${c.mClinical || 'Mx'}`;
                const pTNM = `pTNM: ${c.tPathological || 'Tx'}${c.nPathological || 'Nx'}${c.mPathological || 'Mx'}`;
                let val = `${cTNM} / ${pTNM}`;
                if (val === "cTNM: TxNxMx / pTNM: TxNxMx") val = "";
                next.discharge.primary["TNM Staging"] = val;
              } else if (c.stagingType === "Others") {
                next.discharge.primary["TNM Staging"] = c.stagingOther || "";
              }
            }

            // Auto-populate logic removed for read-only view

            return next;
          });
        }
      }
    } catch (err) {
      console.error("Failed to load patient registration details:", err);
    }

    // Fetch Radiotherapy Treatment LLM Extraction
    try {
      console.log("[Radiotherapy] Fetching LLM extracted treatment details for patient:", patientId);
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const rtExtRes = await fetch(`${API_BASE_URL}hms/users/data/context/radiotherapy-treatment-extraction/${patientId}`);
      if (rtExtRes.ok) {
        const extJson = await rtExtRes.json();
        console.log("[Radiotherapy] Extracted details response:", extJson);
        if (extJson.status === "success" && extJson.data) {
          setFormData(prev => {
            const next = JSON.parse(JSON.stringify(prev));
            const ext = extJson.data;
            const cur = next.common.treatment;
            console.log("[Radiotherapy] Current treatment fields before prefill:", cur);

            // Only prefill if current value is default/empty or invalid
            const validIntents = ["Curative", "Adjuvant", "Neoadjuvant", "Definitive", "Palliative", "Salvage", "Prophylactic"];
            const intentVal = ext["Treatment Intent"] || ext["Treatment intent"] || ext.intent;
            if (intentVal && (!cur.intent || cur.intent === "Curative" || cur.intent === "" || !validIntents.includes(cur.intent))) {
              cur.intent = intentVal;
            }
            if (ext.rtRole && !cur.rtRole) cur.rtRole = ext.rtRole;
            if (ext.rtSetting && (!cur.rtSetting || cur.rtSetting === "Per Primum")) cur.rtSetting = ext.rtSetting;
            if (ext.rtType && !cur.rtType) cur.rtType = ext.rtType;
            if (ext.consentTaken && !cur.consentTaken) cur.consentTaken = ext.consentTaken;
            if (ext.consentDate && !cur.consentDate) cur.consentDate = ext.consentDate;

            console.log("[Radiotherapy] Treatment fields after prefill:", next.common.treatment);
            return next;
          });
        } else {
          console.log("[Radiotherapy] No extraction data returned or extraction pending.");
        }
      } else {
        console.warn("[Radiotherapy] Failed to fetch extraction API, status:", rtExtRes.status);
      }
    } catch (err) {
      console.error("[Radiotherapy] Failed to load radiotherapy dictation extraction:", err);
    }
  };
  // saveDraft and finalizeDischarge are now handled by saveTab()

  useEffect(() => { loadFormData(); }, [patientId]);

  // Fetch doctors list for RO approvals dropdown
  useEffect(() => {
    const fetchDoctors = async () => {
      if (!doctorId) return;
      try {
        const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
        // Step 1: Get the doctor's profile to extract hospital_id
        console.log("[Approvals] Fetching doctor profile for:", doctorId);
        const docRes = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
        console.log("[Approvals] Doctor profile response status:", docRes.status);
        if (!docRes.ok) return;
        const docJson = await docRes.json();
        console.log("[Approvals] Doctor profile data:", JSON.stringify(docJson, null, 2));
        const docData = docJson?.data || docJson?.doctor || docJson;
        const hId = docData?.hospital_id || (Array.isArray(docData) ? docData[0]?.hospital_id : null);
        console.log("[Approvals] Extracted hospital_id:", hId);
        if (!hId) return;
        setHospitalId(hId);
        // Step 2: Fetch all doctors by hospital
        console.log("[Approvals] Fetching doctors by hospital:", hId);
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/get_doctors_by_hospital/${hId}`);
        console.log("[Approvals] Doctors list response status:", res.status);
        if (res.ok) {
          const json = await res.json();
          console.log("[Approvals] Doctors list data:", json);
          const list = Array.isArray(json) ? json : (json.data || json.doctors || json.result || []);
          console.log("[Approvals] Extracted list, isArray:", Array.isArray(list), "count:", list.length);
          if (Array.isArray(list) && list.length > 0) {
            setDoctorsList(list);
            console.log("[Approvals] Set doctorsList, count:", list.length);
          }
        }
      } catch (err) {
        console.error("Failed to fetch doctors list:", err);
      }
    };
    fetchDoctors();
  }, [doctorId]);

  // ─── Patient Referrals: derive specializations from the hospital doctor list
  useEffect(() => {
    if (Array.isArray(doctorsList) && doctorsList.length > 0) {
      const specs = Array.from(new Set(doctorsList.map(d => d.specialization).filter(Boolean)));
      setReferralSpecializations(specs);
    }
  }, [doctorsList]);

  // ─── Patient Referrals: keep form in sync with props ─────────────────
  useEffect(() => {
    setReferralForm(p => ({
      ...p,
      patient_id: patientId || p.patient_id,
      doctor_id: doctorId || p.doctor_id,
      from_doctor_id: doctorId || p.from_doctor_id,
      from_doctor_name: doctorName || p.from_doctor_name,
    }));
  }, [patientId, doctorId, doctorName]);

  useEffect(() => {
    if (hospitalId) setReferralForm(p => ({ ...p, hospital_id: hospitalId }));
  }, [hospitalId]);

  // ─── Patient Referrals: fetch patient name for the referral letter ───
  useEffect(() => {
    if (!patientId) return;
    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
    fetch(`${API_BASE_URL}hms/users/data/surgical-oncology/get-patient-info?patient_id=${patientId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(info => {
        if (info) {
          setReferralForm(p => ({
            ...p,
            patient_name: info?.patient_name || info?.name || p.patient_name,
          }));
        }
      })
      .catch(err => console.error("[Referrals] patient info error:", err));
  }, [patientId]);

  // ─── Patient Referrals: load existing referrals for this patient ─────
  const fetchReferrals = () => {
    if (!patientId || !doctorId) return;
    setReferralLoading(true);
    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
    fetch(`${API_BASE_URL}hms/users/data/context/nurse_note/referral/${patientId}/${doctorId}`)
      .then(res => (res.ok ? res.json() : null))
      .then(res => {
        if (res?.referrals) setReferralsList(res.referrals);
      })
      .catch(err => console.error("[Referrals] fetch error:", err))
      .finally(() => setReferralLoading(false));
  };

  useEffect(() => {
    fetchReferrals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, doctorId]);

  // ─── Patient Referrals: handlers ─────────────────────────────────────
  const handleReferralSpecSelect = (spec) => {
    setReferralSelectedSpec(spec);
    setReferralForm(p => ({ ...p, to_doctor_speciality: spec, to_doctor_id: "", to_doctor_name: "" }));
  };

  const handleReferralDoctorSelect = (docId) => {
    const doc = doctorsList.find(d => (d.sys_user_id || d.id || d.doctor_id) === docId);
    if (doc) {
      setReferralForm(p => ({
        ...p,
        to_doctor_id: doc.sys_user_id || doc.id || doc.doctor_id || docId,
        to_doctor_name: doc.name || doc.doctor_name || "",
        to_doctor_speciality: doc.specialization || p.to_doctor_speciality,
        to_doctor_hospital: doc.hospital_name || p.to_doctor_hospital || "Main Hospital",
      }));
    } else {
      setReferral("to_doctor_id", docId);
    }
  };

  const resetReferralForm = () => {
    setReferralForm(p => ({
      ...p,
      to_doctor_id: "",
      to_doctor_name: "",
      to_doctor_hospital: "",
      to_doctor_speciality: "",
      reason_for_referral: "",
      additional_notes: "",
      referred_by_nurse: "",
      nurse_signed: false,
    }));
    setReferralSelectedSpec("");
    setReferralOutsideDoctor(false);
  };

  const handleReferralSubmit = async () => {
    if (!referralForm.to_doctor_name) {
      setReferralSnack("Please select or type the target doctor's name.");
      return;
    }
    if (!referralForm.reason_for_referral) {
      setReferralSnack("Please enter the reason for referral.");
      return;
    }
    setReferralSubmitting(true);
    try {
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const payload = {
        ...referralForm,
        hospital_id: hospitalId || referralForm.hospital_id,
        reason: referralForm.reason_for_referral,
      };
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/nurse_note/referral/create`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`Referral create failed (${res.status})`);
      setReferralSnack("Referral submitted successfully!");
      resetReferralForm();
      fetchReferrals();
    } catch (err) {
      console.error("[Referrals] submit error:", err);
      setReferralSnack("Failed to submit referral. Please try again.");
    } finally {
      setReferralSubmitting(false);
    }
  };

  // Helper to update deeply nested state
  const handleUpdate = (module, section, field, value) => {
    setFormData(prev => {
      if (field === null) {
        return {
          ...prev,
          [module]: {
            ...prev[module],
            [section]: value
          }
        };
      }
      return {
        ...prev,
        [module]: {
          ...prev[module],
          [section]: {
            ...prev[module][section],
            [field]: value
          }
        }
      };
    });
  };

  // ─── OTP authorization handlers ─────────────────────────────────────
  const openOtpDialog = (module, role) => {
    const nameKey = role + "Name";
    const doctorLabel = formData[module]?.approvals?.[nameKey];
    if (!doctorLabel) return;
    setOtpDialog({ module, role, doctorLabel });
    setOtpStep("send");
    setOtpInput("");
    setOtpError("");
  };

  const closeOtpDialog = () => {
    setOtpDialog(null);
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

  const handleVerifyOtp = () => {
    if (!otpDialog) return;
    if (DEMO_OTP_CODES.includes(otpInput.trim())) {
      handleUpdate(otpDialog.module, "approvals", otpDialog.role + "Signed", true);
      closeOtpDialog();
    } else {
      setOtpError("Invalid OTP. Please try again.");
    }
  };

  // Helper to calculate delayed days
  const calculateDelayedDays = (start, end) => {
    if (!start || !end) return "";
    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = endDate - startDate;
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays > 0 ? diffDays : 0;
  };

  // ─── DICTATION UI RENDERING ───────────────────────────────────────
  const renderDictationBox = (moduleType) => {
    const isRecording = moduleType === 'ebrt' ? isRecordingEbrt : isRecordingBrachy;
    const isProcessing = moduleType === 'ebrt' ? isProcessingEbrt : isProcessingBrachy;
    const isAutofilling = moduleType === 'ebrt' ? isAutofillingEbrt : isAutofillingBrachy;
    const transcript = moduleType === 'ebrt' ? transcriptEbrt : transcriptBrachy;
    const setTranscript = moduleType === 'ebrt' ? setTranscriptEbrt : setTranscriptBrachy;

    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2, mb: 3, p: 2, border: `1px solid ${C.border}`, borderRadius: 1, background: C.bgSecondary }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Typography sx={{ margin: 0, fontSize: '15px', color: C.black, fontWeight: FW_MEDIUM, fontFamily: FONT }}>Voice Dictation</Typography>
          <Button
            onClick={() => isRecording ? stopRecording(moduleType) : startRecording(moduleType)}
            disabled={isProcessing || isAutofilling}
            variant="contained"
            sx={{
              ...btnStyle,
              bgcolor: isRecording ? '#cf1322' : C.black,
              color: C.white,
              display: 'flex', alignItems: 'center', gap: 1,
              opacity: (isProcessing || isAutofilling) ? 0.7 : 1,
              '&:hover': { bgcolor: isRecording ? '#a80f1b' : '#333' }
            }}
          >
            {isRecording ? <StopIcon sx={{ fontSize: '16px' }} /> : <MicIcon sx={{ fontSize: '16px' }} />}
            {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Transcribe"}
          </Button>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          <TextField
            multiline
            minRows={3}
            fullWidth
            placeholder="Transcript will appear here... (You can also type manually)"
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
            sx={{ ...inputStyle, bgcolor: C.white }}
          />
          <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button
              onClick={() => handleAutofill(moduleType)}
              disabled={isAutofilling || !transcript}
              variant="contained"
              sx={{ ...btnStyle, bgcolor: C.black, color: C.white, opacity: (isAutofilling || !transcript) ? 0.7 : 1, '&:hover': { bgcolor: '#333' } }}
            >
              {isAutofilling ? "Autofilling..." : "AI Autofill"}
            </Button>
          </Box>
        </Box>
      </Box>
    );
  };

  // ─── SIDEBAR RENDERING ────────────────────────────────────────────

  const renderSidebar = () => (
    <Box sx={{ display: "flex", flexDirection: "column", p: { xs: 2, md: 3 }, gap: 1, minWidth: { xs: '100%', md: '280px' }, borderRight: { md: `1px solid ${C.border}` }, borderBottom: { xs: `1px solid ${C.border}`, md: 'none' } }}>
      <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted, mb: 2, px: 1 }}>Radiotherapy Record</Typography>

      {[
        { id: "clinical-summary", label: "AI Clinical Summary" },
        { id: "common", label: "Common Data Elements" },
        { id: "procedure", label: "Procedure Details" },
        { id: "ebrt", label: "EBRT Module" },
        { id: "brachy", label: "Brachytherapy Module" },
        { id: "dicom", label: "Imaging Studies" },
        { id: "qa", label: "QA" },
        { id: "summary-staff", label: "Summary & Staff" },
        { id: "discharge", label: "Discharge Summary" },
        { id: "total-discharge", label: "Total Discharge Summary" },
        { id: "referrals", label: "Patient Referals" }
      ].map(tab => (
        <Button
          key={tab.id}
          onClick={() => setActiveTab(tab.id)}
          sx={{
            justifyContent: "flex-start",
            textAlign: "left",
            ...btnStyle,
            px: 2, py: 1.5,
            fontSize: 13,
            color: activeTab === tab.id ? C.black : C.textSecond,
            background: activeTab === tab.id ? C.bgSecondary : "transparent",
            border: `1px solid ${activeTab === tab.id ? C.black : 'transparent'}`,
            "&:hover": { background: activeTab === tab.id ? C.bgSecondary : C.bgTertiary, border: `1px solid ${activeTab === tab.id ? C.black : C.border}` }
          }}
        >
          {tab.label}
        </Button>
      ))}
    </Box>
  );

  // ─── PATIENT REFERALS ──────────────────────────────────────────────
  const renderReferrals = () => {
    const f = referralForm;
    const filteredDoctors = referralSelectedSpec
      ? doctorsList.filter(d => d.specialization === referralSelectedSpec)
      : doctorsList;

    return (
      <Box>
        <Box sx={{ mb: 4, pb: 2, borderBottom: `1px solid ${C.black}` }}>
          <Typography sx={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted, mb: 1 }}>RT — Referrals</Typography>
          <Typography variant="h5" sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, mb: 1 }}>Patient Referals</Typography>
          <Typography sx={{ fontSize: 13, color: C.textSecond, maxWidth: 760, lineHeight: 1.6 }}>Initiate specialist referral letters and review referral history for this patient.</Typography>
        </Box>

        {/* Overview */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader title="Patient Referral Management" />
          <FieldRow label="Patient ID">
            <TextField value={f.patient_id || "-"} size="small" fullWidth sx={inputStyle} InputProps={{ readOnly: true }} />
          </FieldRow>
          <FieldRow label="Patient Name">
            <TextField value={f.patient_name || "-"} size="small" fullWidth sx={inputStyle} InputProps={{ readOnly: true }} />
          </FieldRow>
          <FieldRow label="Referring Doctor (From)">
            <TextField value={f.from_doctor_name || "-"} size="small" fullWidth sx={inputStyle} InputProps={{ readOnly: true }} />
          </FieldRow>
        </Box>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "340px 1fr" }, gap: 2.5 }}>
          {/* Left: specialization filter + referral history */}
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ background: C.white, p: 2, border: `1px solid ${C.border}` }}>
              <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, fontFamily: FONT, mb: 1, textTransform: "uppercase", color: C.textPrimary }}>
                Hospital Specializations
              </Typography>
              <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 1.5 }}>
                Click a specialization to filter doctors:
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                <Button
                  size="small"
                  onClick={() => handleReferralSpecSelect("")}
                  sx={{
                    ...btnStyle, fontSize: 11, py: 0.3, px: 1,
                    background: referralSelectedSpec === "" ? C.black : "transparent",
                    color: referralSelectedSpec === "" ? C.white : C.textSecond,
                    border: `1px solid ${referralSelectedSpec === "" ? C.black : C.border}`,
                    "&:hover": { background: referralSelectedSpec === "" ? "#222" : C.bgSecondary }
                  }}
                >
                  All Specializations
                </Button>
                {referralSpecializations.map(spec => (
                  <Button
                    key={spec}
                    size="small"
                    onClick={() => handleReferralSpecSelect(spec)}
                    sx={{
                      ...btnStyle, fontSize: 11, py: 0.3, px: 1,
                      background: referralSelectedSpec === spec ? C.black : "transparent",
                      color: referralSelectedSpec === spec ? C.white : C.textSecond,
                      border: `1px solid ${referralSelectedSpec === spec ? C.black : C.border}`,
                      "&:hover": { background: referralSelectedSpec === spec ? "#222" : C.bgSecondary }
                    }}
                  >
                    {spec}
                  </Button>
                ))}
                {referralSpecializations.length === 0 && (
                  <Typography sx={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
                    No hospital specializations retrieved.
                  </Typography>
                )}
              </Box>
              <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px dashed ${C.border}` }}>
                <CustomCheckbox
                  label="Refer to Outside Hospital / Doctor"
                  checked={referralOutsideDoctor}
                  onChange={e => {
                    setReferralOutsideDoctor(e.target.checked);
                    if (e.target.checked) {
                      setReferralForm(p => ({ ...p, to_doctor_id: "", to_doctor_name: "", to_doctor_hospital: "" }));
                    }
                  }}
                />
              </Box>
            </Box>

            {/* Referral History */}
            <Box sx={{ background: C.white, p: 2, border: `1px solid ${C.border}`, flex: 1 }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
                <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, fontFamily: FONT, textTransform: "uppercase", color: C.textPrimary }}>
                  Referral History ({referralsList.length})
                </Typography>
                <Button size="small" onClick={fetchReferrals} sx={{ ...btnStyle, fontSize: 10, color: C.textMuted }}>
                  Refresh
                </Button>
              </Box>

              {referralLoading ? (
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, fontStyle: "italic" }}>
                  Loading referral history...
                </Typography>
              ) : referralsList.length === 0 ? (
                <Box sx={{ p: 2, textAlign: "center", background: C.bgSecondary, border: `1px dashed ${C.border}` }}>
                  <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                    No referrals logged for this patient yet.
                  </Typography>
                </Box>
              ) : (
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, maxHeight: 420, overflowY: "auto", pr: 0.5 }}>
                  {referralsList.map((ref, idx) => (
                    <Box key={ref._id || idx} sx={{ p: 1.5, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                        <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, fontFamily: FONT, color: C.textPrimary }}>
                          To: {ref.to_doctor_name || "Doctor"} ({ref.to_doctor_speciality || "General"})
                        </Typography>
                        <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>
                          {ref.date || ref.created_at?.split("T")[0] || "Recent"}
                        </Typography>
                      </Box>
                      {ref.to_doctor_hospital && (
                        <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT, mb: 0.5 }}>
                          Hospital: {ref.to_doctor_hospital}
                        </Typography>
                      )}
                      <Typography sx={{ fontSize: 11, color: C.textSecond, fontFamily: FONT, mb: 0.5 }}>
                        <strong>Reason:</strong> {ref.reason_for_referral || ref.reason || "-"}
                      </Typography>
                      {ref.additional_notes && (
                        <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT, fontStyle: "italic", mb: 0.5 }}>
                          Notes: {ref.additional_notes}
                        </Typography>
                      )}
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1, pt: 0.5, borderTop: `1px solid ${C.border}` }}>
                        <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>
                          Nurse: {ref.referred_by_nurse || "Assigned Nurse"}
                        </Typography>
                        <Typography sx={{
                          fontSize: 9.5, letterSpacing: "0.06em", textTransform: "uppercase", px: 1, py: 0.3,
                          border: `1px solid ${ref.nurse_signed ? C.black : C.border}`,
                          color: ref.nurse_signed ? C.black : C.textMuted,
                          background: ref.nurse_signed ? C.bgSecondary : "transparent",
                        }}>
                          {ref.nurse_signed ? "Signed" : "Pending Signature"}
                        </Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              )}
            </Box>
          </Box>

          {/* Right: create referral form */}
          <Box sx={{ background: C.white, border: `1px solid ${C.border}` }}>
            <SectionHeader title="Initiate New Referral Letter" />

            <Box sx={{ p: 2.5 }}>
              <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, fontFamily: FONT, mb: 1.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted }}>
                Target Specialist Information
              </Typography>

              {!referralOutsideDoctor ? (
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mb: 3 }}>
                  <Box>
                    <Typography sx={labelStyle}>Specialization</Typography>
                    <Select
                      value={referralSelectedSpec}
                      onChange={e => handleReferralSpecSelect(e.target.value)}
                      displayEmpty
                      size="small"
                      fullWidth
                      sx={{ ...inputStyle, mt: 0.5 }}
                    >
                      <MenuItem value="" sx={{ fontFamily: FONT, fontSize: 13 }}><em>Select Specialization</em></MenuItem>
                      {referralSpecializations.map(s => (
                        <MenuItem key={s} value={s} sx={{ fontFamily: FONT, fontSize: 13 }}>{s}</MenuItem>
                      ))}
                    </Select>
                  </Box>
                  <Box>
                    <Typography sx={labelStyle}>Select Doctor *</Typography>
                    <Select
                      value={f.to_doctor_id}
                      onChange={e => handleReferralDoctorSelect(e.target.value)}
                      displayEmpty
                      size="small"
                      fullWidth
                      sx={{ ...inputStyle, mt: 0.5 }}
                    >
                      <MenuItem value="" sx={{ fontFamily: FONT, fontSize: 13 }}><em>Select Doctor</em></MenuItem>
                      {filteredDoctors.map(doc => (
                        <MenuItem key={doc.sys_user_id || doc.id || doc.doctor_id} value={doc.sys_user_id || doc.id || doc.doctor_id} sx={{ fontFamily: FONT, fontSize: 13 }}>
                          {doc.name || doc.doctor_name} ({doc.specialization || "General"})
                        </MenuItem>
                      ))}
                    </Select>
                  </Box>
                  <Box>
                    <Typography sx={labelStyle}>Target Doctor Name</Typography>
                    <TextField value={f.to_doctor_name} onChange={e => setReferral("to_doctor_name", e.target.value)} size="small" fullWidth sx={{ ...inputStyle, mt: 0.5 }} placeholder="Doctor Name" />
                  </Box>
                  <Box>
                    <Typography sx={labelStyle}>Hospital Name</Typography>
                    <TextField value={f.to_doctor_hospital} onChange={e => setReferral("to_doctor_hospital", e.target.value)} size="small" fullWidth sx={{ ...inputStyle, mt: 0.5 }} placeholder="Hospital Name" />
                  </Box>
                </Box>
              ) : (
                <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2, mb: 3 }}>
                  <Box>
                    <Typography sx={labelStyle}>Target Doctor Name *</Typography>
                    <TextField value={f.to_doctor_name} onChange={e => setReferral("to_doctor_name", e.target.value)} size="small" fullWidth sx={{ ...inputStyle, mt: 0.5 }} placeholder="e.g. Dr. Robert Vance" />
                  </Box>
                  <Box>
                    <Typography sx={labelStyle}>Specialization</Typography>
                    <TextField value={f.to_doctor_speciality} onChange={e => setReferral("to_doctor_speciality", e.target.value)} size="small" fullWidth sx={{ ...inputStyle, mt: 0.5 }} placeholder="e.g. Surgical Gastroenterology" />
                  </Box>
                  <Box sx={{ gridColumn: { sm: "1/-1" } }}>
                    <Typography sx={labelStyle}>Outside Hospital Name</Typography>
                    <TextField value={f.to_doctor_hospital} onChange={e => setReferral("to_doctor_hospital", e.target.value)} size="small" fullWidth sx={{ ...inputStyle, mt: 0.5 }} placeholder="e.g. Apollo Cancer Institute, Chennai" />
                  </Box>
                </Box>
              )}

              <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, fontFamily: FONT, mb: 1.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted }}>
                Referral Details &amp; Clinical Context
              </Typography>
              <Box sx={{ mb: 2 }}>
                <Typography sx={labelStyle}>Reason for Referral *</Typography>
                <TextField
                  value={f.reason_for_referral}
                  onChange={e => setReferral("reason_for_referral", e.target.value)}
                  size="small" multiline rows={3} fullWidth sx={{ ...inputStyle, mt: 0.5 }}
                  placeholder="State the clinical diagnosis, purpose of referral, and requested intervention/opinion..."
                />
                <Box sx={{ mt: 1 }}>
                  <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.5 }}>
                    Quick Fill Reason Suggestions:
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                    {REFERRAL_QUICK_REASONS.map(r => (
                      <Button
                        key={r}
                        size="small"
                        onClick={() => setReferral("reason_for_referral", f.reason_for_referral ? `${f.reason_for_referral}; ${r}` : r)}
                        sx={{ ...btnStyle, fontSize: 10, py: 0.2, px: 0.8, border: `1px solid ${C.border}`, color: C.textSecond, "&:hover": { background: C.bgSecondary } }}
                      >
                        + {r}
                      </Button>
                    ))}
                  </Box>
                </Box>
              </Box>

              <Box sx={{ mb: 3 }}>
                <Typography sx={labelStyle}>Additional Notes / Clinical History Summary</Typography>
                <TextField
                  value={f.additional_notes}
                  onChange={e => setReferral("additional_notes", e.target.value)}
                  size="small" multiline rows={3} fullWidth sx={{ ...inputStyle, mt: 0.5 }}
                  placeholder="Include pertinent investigations, vitals, allergies, or urgent instructions..."
                />
              </Box>

              <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, fontFamily: FONT, mb: 1.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted }}>
                Nurse Sign-off &amp; Verification
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
                <Box>
                  <Typography sx={labelStyle}>Referred By Nurse (Name / ID)</Typography>
                  <TextField value={f.referred_by_nurse} onChange={e => setReferral("referred_by_nurse", e.target.value)} size="small" fullWidth sx={{ ...inputStyle, mt: 0.5 }} placeholder="Enter Nurse Name or Staff ID" />
                </Box>
                <Box>
                  <Typography sx={labelStyle}>Date of Referral</Typography>
                  <TextField type="date" value={f.date} onChange={e => setReferral("date", e.target.value)} size="small" fullWidth sx={{ ...inputStyle, mt: 0.5 }} InputLabelProps={{ shrink: true }} />
                </Box>
              </Box>
              <Box sx={{ mt: 1.5 }}>
                <CustomCheckbox
                  label="Nurse Verification Signed & Validated"
                  checked={f.nurse_signed}
                  onChange={e => setReferral("nurse_signed", e.target.checked)}
                />
              </Box>

              <Box sx={{ display: "flex", gap: 1.5, mt: 3 }}>
                <Button
                  variant="contained"
                  disabled={referralSubmitting}
                  onClick={handleReferralSubmit}
                  sx={{ ...btnStyle, minWidth: 160, bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" } }}
                >
                  {referralSubmitting ? "Submitting..." : "Submit Referral Letter"}
                </Button>
                <Button
                  variant="outlined"
                  onClick={resetReferralForm}
                  sx={{ ...btnStyle, color: C.textPrimary, borderColor: C.border, "&:hover": { borderColor: C.black, background: C.bgSecondary } }}
                >
                  Reset Form
                </Button>
              </Box>
            </Box>
          </Box>
        </Box>
      </Box>
    );
  };

  // ─── COMMON DATA ELEMENTS (A) ──────────────────────────────────────
  const renderCommon = () => {
    const data = formData.common;
    const capFirst = (val) => {
      if (val === null || val === undefined || val === "") return "N/A";
      const str = String(val);
      return str.charAt(0).toUpperCase() + str.slice(1);
    };

    return (
      <Box>
        {completedRecords && completedRecords.length > 0 && (
          <Box sx={{ mb: 4, pb: 2, borderBottom: `1px solid ${C.border}` }}>
            <Typography variant="h6" sx={{ fontFamily: FONT, fontWeight: FW_MEDIUM, mb: 2 }}>View past treatment reports</Typography>
            <HistoryTable historyData={completedRecords.map(r => {
              return { savedAt: r.savedAt, data: r };
            })} expandDepth={1} />
          </Box>
        )}

        <Box sx={{ mb: 4, pb: 2, borderBottom: `1px solid ${C.black}` }}>
          <Typography sx={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted, mb: 1 }}>RT — Part A</Typography>
          <Typography variant="h5" sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, mb: 1 }}>Common Data Elements</Typography>
          <Typography sx={{ fontSize: 13, color: C.textSecond, maxWidth: 760, lineHeight: 1.6 }}>Standardises collection of essential radiotherapy data — patient diagnosis, treatment history, treatment intent and patient consent — shared across the EBRT, Brachytherapy and Discharge Summary sections.</Typography>
        </Box>




        {/* DIAGNOSIS */}
        {/* <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="1" title="Diagnosis" />
          <FieldRow label="Treatment Site"><TextField disabled placeholder="Auto-populated" fullWidth sx={inputStyle} size="small" /></FieldRow>
          <FieldRow label="Subsite"><TextField disabled placeholder="Auto-populated" fullWidth sx={inputStyle} size="small" /></FieldRow>
          <FieldRow label="Laterality" tag="choose one">
            <Box sx={{ display: "flex", flexWrap: "wrap" }}>
              {["Left", "Right", "Central", "Bi-lateral"].map(opt => (
                <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.laterality === opt} onChange={e => handleUpdate("common", "diagnosis", "laterality", e.target.value)} />
              ))}
            </Box>
          </FieldRow>
          <FieldRow label="Staging">
            <Box sx={{ display: "flex", flexWrap: "wrap" }}>
              {["TNM", "Others"].map(opt => (
                <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.stagingType === opt} onChange={e => handleUpdate("common", "diagnosis", "stagingType", e.target.value)} />
              ))}
            </Box>
            <Typography sx={{ fontSize: 11, color: C.textMuted, mt: 1 }}>— Choosing "Others" opens a free-text field; choosing "TNM" opens the clinical / pathological staging grid below.</Typography>
          </FieldRow>

          <FieldRow label="If others" nested hidden={data.diagnosis.stagingType !== "Others"}>
            <TextField fullWidth placeholder="Open text box" sx={inputStyle} size="small" value={data.diagnosis.stagingOther} onChange={e => handleUpdate("common", "diagnosis", "stagingOther", e.target.value)} />
          </FieldRow>

          {data.diagnosis.stagingType === "TNM" && (
            <>
              <FieldRow label="Tumor Staging (Clinical)" nested>
                <Box sx={{ display: "flex", flexWrap: "wrap" }}>{["T0", "T1", "T2", "T3", "T4", "Tx"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.tClinical === opt} onChange={e => handleUpdate("common", "diagnosis", "tClinical", e.target.value)} />)}</Box>
              </FieldRow>
              <FieldRow label="Nodal Staging (Clinical)" nested>
                <Box sx={{ display: "flex", flexWrap: "wrap" }}>{["N0", "N1", "N2", "N3", "Nx"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.nClinical === opt} onChange={e => handleUpdate("common", "diagnosis", "nClinical", e.target.value)} />)}</Box>
              </FieldRow>
              <FieldRow label="Metastatic Staging (Clinical)" nested>
                <Box sx={{ display: "flex", flexWrap: "wrap" }}>{["M0", "M1", "Mx"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.mClinical === opt} onChange={e => handleUpdate("common", "diagnosis", "mClinical", e.target.value)} />)}</Box>
              </FieldRow>
              <FieldRow label="Tumor Staging (Pathological)" nested>
                <Box sx={{ display: "flex", flexWrap: "wrap" }}>{["T0", "T1", "T2", "T3", "T4", "Tx", "Others"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.tPathological === opt} onChange={e => handleUpdate("common", "diagnosis", "tPathological", e.target.value)} />)}</Box>
              </FieldRow>
              <FieldRow label="Nodal Staging (Pathological)" nested>
                <Box sx={{ display: "flex", flexWrap: "wrap" }}>{["N0", "N1", "N2", "N3", "Nx"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.nPathological === opt} onChange={e => handleUpdate("common", "diagnosis", "nPathological", e.target.value)} />)}</Box>
              </FieldRow>
              <FieldRow label="Metastatic Staging (Pathological)" nested>
                <Box sx={{ display: "flex", flexWrap: "wrap" }}>{["M0", "M1", "M1a", "M1b", "M1c", "Mx"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.mPathological === opt} onChange={e => handleUpdate("common", "diagnosis", "mPathological", e.target.value)} />)}</Box>
              </FieldRow>
            </>
          )}

          <FieldRow label="Histopathology">
            <Select fullWidth size="small" sx={inputStyle} value={data.diagnosis.histopathology} onChange={e => handleUpdate("common", "diagnosis", "histopathology", e.target.value)}>
              <MenuItem value="">Choose one</MenuItem>
              {["Adenocarcinoma", "Squamous Carcinoma", "Adenosquamous Carcinoma", "Small Cell Carcinoma", "Undifferentiated", "Others"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
            </Select>
          </FieldRow>
          <FieldRow label="Grading">
            <Box sx={{ display: "flex", flexWrap: "wrap" }}>
              {["Well-Differentiated", "Moderately Differentiated", "Poorly Differentiated", "Undifferentiated"].map(opt => (
                <CustomRadio key={opt} label={opt} value={opt} checked={data.diagnosis.grading === opt} onChange={e => handleUpdate("common", "diagnosis", "grading", e.target.value)} />
              ))}
            </Box>
          </FieldRow>
          <FieldRow label="Tumor Markers"><TextField fullWidth placeholder="Open text box" sx={inputStyle} size="small" value={data.diagnosis.tumorMarkers} onChange={e => handleUpdate("common", "diagnosis", "tumorMarkers", e.target.value)} /></FieldRow>
        </Box> */}

        {/* TUMOR BOARD */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="2" title="Tumor Board / MDT Plan" />
          <Box sx={{ "& > div": { border: "none", mb: 0 } }}>
            <TumorBoardCommonElement patientId={patientId} doctorId={doctorId} />
          </Box>
        </Box>
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
            <Typography sx={{ fontSize: 14.5, fontWeight: FW_MEDIUM, letterSpacing: "0.02em", textTransform: "uppercase", color: C.white, fontFamily: FONT }}>
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

        <Box sx={{ mb: 4, display: "flex", justifyContent: "flex-end" }}>
          <Button
            variant="contained"
            sx={{ bgcolor: C.black, color: C.white, textTransform: "none", borderRadius: 0, "&:hover": { bgcolor: "#333" } }}
            onClick={() => setProtocolDialogOpen(true)}
          >
            📋 Select Protocol Master
          </Button>
        </Box>
        {/* TREATMENT */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="3" title="Treatment" />
          <FieldRow label="Treatment Intent">
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
              {["Curative", "Adjuvant", "Neoadjuvant", "Definitive", "Palliative", "Salvage", "Prophylactic"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.treatment.intent === opt} onChange={e => handleUpdate("common", "treatment", "intent", e.target.value)} />)}
            </Box>
          </FieldRow>

          <FieldRow label="Role of Radiotherapy" tag={data.treatment.rtRole ? "from protocol master" : undefined}>
            <TextField
              fullWidth
              size="small"
              placeholder="e.g. IMRT, VMAT, 3DCRT — auto-filled when a protocol is applied"
              sx={inputStyle}
              value={data.treatment.rtRole}
              onChange={e => handleUpdate("common", "treatment", "rtRole", e.target.value)}
            />
          </FieldRow>
          <FieldRow label="RT Setting">
            <Box sx={{ display: "flex" }}>{["Per Primum", "Re-Irradiation"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.treatment.rtSetting === opt} onChange={e => handleUpdate("common", "treatment", "rtSetting", e.target.value)} />)}</Box>
          </FieldRow>
          <FieldRow label="Type of Radiotherapy">
            <Box sx={{ display: "flex" }}>{["EBRT", "Brachytherapy", "Both"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.treatment.rtType === opt} onChange={e => handleUpdate("common", "treatment", "rtType", e.target.value)} />)}</Box>
          </FieldRow>
          <FieldRow label="Patient Consent taken">
            <Box sx={{ display: "flex" }}>{["Yes", "No"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.treatment.consentTaken === opt} onChange={e => handleUpdate("common", "treatment", "consentTaken", e.target.value)} />)}</Box>
          </FieldRow>
          <FieldRow label="Upload signed consent" tag="capture photo or upload scanned form" nested hidden={data.treatment.consentTaken !== "Yes"}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
              <Button variant="outlined" component="label" sx={{ ...btnStyle, borderColor: C.border, color: C.black }}>
                Upload File
                <input
                  type="file"
                  hidden
                  accept="image/*,.pdf"
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleUpdate("common", "treatment", "consentFile", e.target.files[0]);
                    }
                  }}
                />
              </Button>
              {data.treatment.consentFile && (
                <Button
                  variant="outlined"
                  sx={{ ...btnStyle, borderColor: C.border, color: C.black }}
                  onClick={() => {
                    const file = data.treatment.consentFile;
                    const url = typeof file === "string" ? file : URL.createObjectURL(file);
                    window.open(url, "_blank");
                  }}
                >
                  View File
                </Button>
              )}
              {data.treatment.consentFile && typeof data.treatment.consentFile !== "string" && (
                <Typography sx={{ fontSize: 12, color: C.textSecond }}>
                  {data.treatment.consentFile.name}
                </Typography>
              )}
            </Box>
          </FieldRow>
          <FieldRow label="Patient consent taken date">
            <TextField type="date" fullWidth sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={data.treatment.consentDate} onChange={e => handleUpdate("common", "treatment", "consentDate", e.target.value)} />
          </FieldRow>
        </Box>

        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 4, pt: 3, borderTop: `1px solid ${C.border}` }}>
          <Button variant="outlined" sx={{ ...btnStyle, borderColor: C.border, color: C.black }} onClick={() => saveTab("common")}>Save draft</Button>
          <Button variant="contained" sx={{ ...btnStyle, bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" } }} onClick={() => setActiveTab("procedure")}>Continue to Procedure Details →</Button>
        </Box>
      </Box>
    );
  };

  // ─── EBRT MODULE (B) ────────────────────────────────────────────────
  const renderEBRT = () => {
    const data = formData.ebrt;

    const handleSimSet = (index, field, val) => {
      const newSets = [...data.simulationSets];
      newSets[index][field] = val;
      // auto calc dose
      if (field === "totalDose" || field === "totalFractions") {
        const d = parseFloat(field === "totalDose" ? val : newSets[index].totalDose);
        const f = parseFloat(field === "totalFractions" ? val : newSets[index].totalFractions);
        newSets[index].dosePerFrac = (d && f) ? (d / f).toFixed(1) + " cGy" : "";
      }
      handleUpdate("ebrt", "simulationSets", null, newSets); // bypass single field helper
    };
    const addSimSet = () => handleUpdate("ebrt", "simulationSets", null, [...data.simulationSets, { id: Date.now(), intentPrimary: false, intentAdaptive: false, intentReplanning: false, intentSecondary: false, immobilisation: "", imaging: "", imagingOther: "", imagingFromProtocol: false, patientPos: "", positionOther: "", positionFromProtocol: false, specialTech: "", totalDose: "", totalFractions: "", fracSched: "", fracSchedOther: "", sibBoost: "", dosePerFrac: "", machine: "", startDate: "", endDate: "", peerReview: "", peerComments: "" }]);
    const removeSimSet = (id) => handleUpdate("ebrt", "simulationSets", null, data.simulationSets.filter(s => s.id !== id));

    const handleAdverseEvent = (index, field, val) => {
      const newEvents = [...(data.adverseEvents || [])];
      newEvents[index][field] = val;
      handleUpdate("ebrt", "adverseEvents", null, newEvents);
    };
    const addAdverseEvent = () => handleUpdate("ebrt", "adverseEvents", null, [...(data.adverseEvents || []), { id: Date.now(), date: "", event: "", gradingSystem: "CTCAE 5", grade: "", management: "" }]);
    const removeAdverseEvent = (id) => handleUpdate("ebrt", "adverseEvents", null, (data.adverseEvents || []).filter(e => e.id !== id));

    const handleAddInterruptionRecord = () => {
      if (!data.interruption.interruptedDate) {
        alert("Please enter the Interrupted Date before adding the record.");
        return;
      }
      const newRecord = { ...data.interruption, savedAt: new Date().toISOString() };
      handleUpdate("ebrt", "interruptionHistory", null, [...(data.interruptionHistory || []), newRecord]);
      handleUpdate("ebrt", "interruption", null, { continueTreatment: "Continue with the same treatment", interruptReason: "", interruptedDate: "", resumeDate: "", completionDate: "" });
    };

    const handleAddFollowUpRecord = () => {
      if (!data.followUp.date) {
        alert("Please enter the Follow up date before adding the record.");
        return;
      }
      const newRecord = { ...data.followUp, savedAt: new Date().toISOString() };
      handleUpdate("ebrt", "followUpHistory", null, [...(data.followUpHistory || []), newRecord]);
      handleUpdate("ebrt", "followUp", null, { date: "", time: "", imagingAdvised: "", imagingAdvisedOther: "", postCompletionPlan: "", adviceOnCompletion: "" });
    };

    return (
      <Box>
        <Box sx={{ mb: 4, pb: 2, borderBottom: `1px solid ${C.black}` }}>
          <Typography sx={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted, mb: 1 }}>RT — Part B</Typography>
          <Typography variant="h5" sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, mb: 1 }}>EBRT Module</Typography>
          <Typography sx={{ fontSize: 13, color: C.textSecond, maxWidth: 760, lineHeight: 1.6 }}>Planning and delivery of external beam radiotherapy — simulation, dose calculation, verification and treatment-delivery tracking.</Typography>
        </Box>

        {renderDictationBox('ebrt')}

        {/* HISTORY */}
        <HistoryTable historyData={formData.history?.ebrt} />

        {/* TREATMENT / SIMULATION SETS */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="5" title="Treatment" note="If multiple Simulation Intent options are chosen, repeat the entire set (A–M) per intent" />
          <Box sx={{ p: 2 }}>
            {data.simulationSets.map((set, i) => (
              <Box key={set.id} sx={{ border: `1px dashed ${C.border}`, p: 2, mb: 2, bgcolor: C.bgSecondary }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted }}>Simulation Set {i + 1}</Typography>
                  {i > 0 && <Button size="small" sx={{ color: "error.main", fontSize: 10 }} onClick={() => removeSimSet(set.id)}>Remove</Button>}
                </Box>
                <FieldRow label="Simulation Intent" tag="choose one or more">
                  <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                    <CustomCheckbox label="Primary" checked={set.intentPrimary} onChange={e => handleSimSet(i, "intentPrimary", e.target.checked)} />
                    <CustomCheckbox label="Adaptive" checked={set.intentAdaptive} onChange={e => handleSimSet(i, "intentAdaptive", e.target.checked)} />
                    <CustomCheckbox label="Re-Planning" checked={set.intentReplanning} onChange={e => handleSimSet(i, "intentReplanning", e.target.checked)} />
                    <CustomCheckbox label="Secondary" checked={set.intentSecondary} onChange={e => handleSimSet(i, "intentSecondary", e.target.checked)} />
                  </Box>
                </FieldRow>
                <FieldRow label="Immobilisation"><TextField fullWidth placeholder="Open text box" sx={inputStyle} size="small" value={set.immobilisation} onChange={e => handleSimSet(i, "immobilisation", e.target.value)} /></FieldRow>
                <FieldRow label="Simulation Imaging">
                  <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                    {["CT", "CT / MRI", "CT / PET", "X-Ray", "Clinical", "Other"].map(opt => (
                      <CustomRadio key={opt} label={opt} value={opt} checked={set.imaging === opt} onChange={e => handleSimSet(i, "imaging", e.target.value)} />
                    ))}
                  </Box>
                  <OtherField show={set.imaging === "Other"} label="Other Imaging" value={set.imagingOther} fromProtocol={set.imagingFromProtocol} />
                </FieldRow>
                <FieldRow label="Patient Position">
                  <Box sx={{ display: "flex", flexWrap: "wrap" }}>
                    {["Supine", "Prone", "Lateral", "Others"].map(opt => (
                      <CustomRadio key={opt} label={opt} value={opt} checked={set.patientPos === opt} onChange={e => handleSimSet(i, "patientPos", e.target.value)} />
                    ))}
                  </Box>
                  <OtherField show={set.patientPos === "Others"} label="Other Patient Position" value={set.positionOther} fromProtocol={set.positionFromProtocol} />
                </FieldRow>
                <FieldRow label="Special Techniques"><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["SRS", "SRT", "DIBH", "DEBH", "Gating", "Tracking", "Fiducials"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={set.specialTech === opt} onChange={e => handleSimSet(i, "specialTech", e.target.value)} />)}</Box></FieldRow>
                <FieldRow label="Total Radiotherapy Dose (cGy)"><TextField type="text" inputMode="decimal" sx={inputStyle} size="small" value={set.totalDose} onChange={e => handleSimSet(i, "totalDose", e.target.value)} /></FieldRow>
                <FieldRow label="Total Number of Fractions"><TextField type="number" sx={inputStyle} size="small" value={set.totalFractions} onChange={e => handleSimSet(i, "totalFractions", e.target.value)} /></FieldRow>
                <FieldRow label="Fractionation Schedule">
                  <Box sx={{ display: "flex", flexWrap: "wrap" }}>{["Alternate Day", "Daily", "Once Weekly", "Others"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={set.fracSched === opt} onChange={e => handleSimSet(i, "fracSched", e.target.value)} />)}</Box>
                  {set.fracSched === "Others" && <TextField fullWidth placeholder="Specify" sx={{ ...inputStyle, mt: 1 }} size="small" value={set.fracSchedOther} onChange={e => handleSimSet(i, "fracSchedOther", e.target.value)} />}
                </FieldRow>
                <FieldRow label="SIB / Sequential Boost"><TextField fullWidth placeholder="Details" sx={inputStyle} size="small" value={set.sibBoost} onChange={e => handleSimSet(i, "sibBoost", e.target.value)} /></FieldRow>
                <FieldRow label="Dose Per Fraction" tag="auto-calculate"><TextField disabled placeholder="Auto-calculated" fullWidth sx={inputStyle} size="small" value={set.dosePerFrac} /></FieldRow>
                <FieldRow label="Radiotherapy Dates">
                  <Box sx={{ display: "flex", gap: 2 }}>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: C.textMuted, mb: 0.5 }}>Start Date</Typography>
                      <TextField type="date" sx={{ ...inputStyle, width: 200 }} size="small" value={set.startDate} onChange={e => handleSimSet(i, "startDate", e.target.value)} />
                    </Box>
                    <Box>
                      <Typography sx={{ fontSize: 11, color: C.textMuted, mb: 0.5 }}>End Date</Typography>
                      <TextField type="date" sx={{ ...inputStyle, width: 200 }} size="small" value={set.endDate} onChange={e => handleSimSet(i, "endDate", e.target.value)} />
                    </Box>
                  </Box>
                </FieldRow>
                <FieldRow label="Peer Review"><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["Yes", "No"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={set.peerReview === opt} onChange={e => handleSimSet(i, "peerReview", e.target.value)} />)}</Box></FieldRow>
                {set.peerReview === "Yes" && <FieldRow label="If yes, comments" nested><TextField fullWidth placeholder="Open text box" sx={inputStyle} size="small" value={set.peerComments} onChange={e => handleSimSet(i, "peerComments", e.target.value)} /></FieldRow>}
              </Box>
            ))}
            <Button variant="text" size="small" sx={{ ...btnStyle, color: C.textSecond, mt: 1 }} onClick={addSimSet}>+ Add another simulation set</Button>
          </Box>
        </Box>

        {/* PROCEDURE DETAILS */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="6" title="Procedure Details" />
          <FieldRow label="Treatment Machine">
            <Box sx={{ display: "flex", flexWrap: "wrap" }}>
              {["Cobalt", "LA", "CyberKnife", "MRI LINAC", "Proton", "Other"].map(opt => (
                <CustomRadio key={opt} label={opt} value={opt} checked={data.procedure.machine === opt} onChange={e => handleUpdate("ebrt", "procedure", "machine", e.target.value)} />
              ))}
            </Box>
            <OtherField show={data.procedure.machine === "Other"} label="Other Machine" value={data.procedure.machineOther} fromProtocol={data.procedure.machineFromProtocol} />
          </FieldRow>
          <FieldRow label="Systemic Therapy"><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["Chemotherapy", "Targeted Therapy", "Immunotherapy", "Combination"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.procedure.systemicTherapy === opt} onChange={e => handleUpdate("ebrt", "procedure", "systemicTherapy", e.target.value)} />)}</Box></FieldRow>
          <FieldRow label="If combination, specify" nested hidden={data.procedure.systemicTherapy !== "Combination"}><TextField fullWidth placeholder="e.g. Chemotherapy + Immunotherapy" sx={inputStyle} size="small" value={data.procedure.combinationSpecify} onChange={e => handleUpdate("ebrt", "procedure", "combinationSpecify", e.target.value)} /></FieldRow>
          <FieldRow label="Radiotherapy Technique">
            <Box sx={{ display: "flex", flexWrap: "wrap" }}>
              {["Single Portal", "2 Dimensional", "3DCRT", "IMRT", "VMAT", "Other"].map(opt => (
                <CustomRadio key={opt} label={opt} value={opt} checked={data.procedure.technique === opt} onChange={e => handleUpdate("ebrt", "procedure", "technique", e.target.value)} />
              ))}
            </Box>
            <OtherField show={data.procedure.technique === "Other"} label="Other Technique" value={data.procedure.techniqueOther} fromProtocol={data.procedure.techniqueFromProtocol} />
          </FieldRow>
          <FieldRow
            label="Beam Energy"
            tag="from protocol"
            hidden={!(data.procedure.energy?.photon || data.procedure.energy?.electron || data.procedure.energy?.proton || data.procedure.energy?.other)}
          >
            <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
              {data.procedure.energy?.photon && (
                <Typography sx={{ fontSize: 12.5, color: C.textPrimary }}>Photon: {data.procedure.energy.photonMV || "-"} MV</Typography>
              )}
              {data.procedure.energy?.electron && (
                <Typography sx={{ fontSize: 12.5, color: C.textPrimary }}>Electron: {data.procedure.energy.electronMeV || "-"} MeV</Typography>
              )}
              {data.procedure.energy?.proton && (
                <Typography sx={{ fontSize: 12.5, color: C.textPrimary }}>Proton: {data.procedure.energy.protonMeV || "-"} MeV</Typography>
              )}
              <OtherField show={!!data.procedure.energy?.other} label="Other Energy" value={data.procedure.energy?.other} />
            </Box>
          </FieldRow>
          <FieldRow label="If No, comments" nested hidden={data.procedure.doseConstraints !== "No"}><TextField fullWidth placeholder="Open text box" sx={inputStyle} size="small" value={data.procedure.doseConstraintsComment} onChange={e => handleUpdate("ebrt", "procedure", "doseConstraintsComment", e.target.value)} /></FieldRow>
        </Box>

        {/* PLANNING */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="7" title="Treatment Planning" />
          <FieldRow label="Treatment Verification"><Box sx={{ display: "flex" }}>{["Yes", "No"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.planning.verification === opt} onChange={e => handleUpdate("ebrt", "planning", "verification", e.target.value)} />)}</Box></FieldRow>
          {data.planning.verification === "Yes" && (
            <>
              <FieldRow label="Verification Type" nested><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["CBCT", "EPID"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.planning.verificationType === opt} onChange={e => handleUpdate("ebrt", "planning", "verificationType", e.target.value)} />)}</Box></FieldRow>
              <FieldRow label="Verification Frequency" nested><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["Daily", "Once Weekly", "Thrice Weekly"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.planning.verificationFrequency === opt} onChange={e => handleUpdate("ebrt", "planning", "verificationFrequency", e.target.value)} />)}</Box></FieldRow>
            </>
          )}
          <FieldRow label="Adaptive Radiation"><Box sx={{ display: "flex" }}>{["Yes", "No"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.planning.adaptiveRadiation === opt} onChange={e => handleUpdate("ebrt", "planning", "adaptiveRadiation", e.target.value)} />)}</Box></FieldRow>
          <FieldRow label="If yes, reason" nested hidden={data.planning.adaptiveRadiation !== "Yes"}><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["Tumor Related", "Patient Related", "Treatment Related"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.planning.adaptiveReason === opt} onChange={e => handleUpdate("ebrt", "planning", "adaptiveReason", e.target.value)} />)}</Box></FieldRow>
        </Box>

        {renderRTTrackingSection("ebrt")}

        {/* APPROVALS — OTP Authorization */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="8" title="Approvals" note="OTP Authorization" />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 2, p: 2 }}>
            {/* RO */}
            <Box sx={{ border: `1px solid ${C.border}`, p: 2 }}>
              <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>RO — Radiation Oncologist</Typography>
              <Select fullWidth displayEmpty size="small" sx={{ ...inputStyle, mb: 1 }} value={data.approvals.roName} onChange={e => { handleUpdate("ebrt", "approvals", "roName", e.target.value); handleUpdate("ebrt", "approvals", "roSigned", false); }}>
                <MenuItem value=""><em>Select Name</em></MenuItem>
                {doctorsList.filter(doc => (doc.speciality || doc.specialization || "").toLowerCase() === "radiation oncology").map(doc => <MenuItem key={doc._id || doc.name} value={doc.name}>{doc.name}</MenuItem>)}
              </Select>
              <Button fullWidth disabled={!data.approvals.roName || data.approvals.roSigned} onClick={() => openOtpDialog("ebrt", "ro")} sx={{ height: 52, border: `1px solid ${data.approvals.roSigned ? "#52c41a" : C.border}`, background: data.approvals.roSigned ? "#f6ffed" : "transparent", color: data.approvals.roSigned ? "#52c41a" : C.textMuted, ...btnStyle, fontSize: 10.5, opacity: !data.approvals.roName ? 0.5 : 1 }}>{data.approvals.roSigned ? 'Approved ✅' : 'Authorize via OTP'}</Button>
            </Box>
            {/* MP */}
            <Box sx={{ border: `1px solid ${C.border}`, p: 2 }}>
              <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>MP — Medical Physicist</Typography>
              <Select fullWidth displayEmpty size="small" sx={{ ...inputStyle, mb: 1 }} value={data.approvals.mpName} onChange={e => { handleUpdate("ebrt", "approvals", "mpName", e.target.value); handleUpdate("ebrt", "approvals", "mpSigned", false); }}>
                <MenuItem value=""><em>Select Name</em></MenuItem>
                {["Dr. Kavita Rao", "Dr. Manish Joshi", "Dr. Neha Kulkarni", "Dr. Sanjay Deshmukh", "Dr. Pooja Nair"].map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}
              </Select>
              <Button fullWidth disabled={!data.approvals.mpName || data.approvals.mpSigned} onClick={() => openOtpDialog("ebrt", "mp")} sx={{ height: 52, border: `1px solid ${data.approvals.mpSigned ? "#52c41a" : C.border}`, background: data.approvals.mpSigned ? "#f6ffed" : "transparent", color: data.approvals.mpSigned ? "#52c41a" : C.textMuted, ...btnStyle, fontSize: 10.5, opacity: !data.approvals.mpName ? 0.5 : 1 }}>{data.approvals.mpSigned ? 'Approved ✅' : 'Authorize via OTP'}</Button>
            </Box>
            {/* RTT */}
            <Box sx={{ border: `1px solid ${C.border}`, p: 2 }}>
              <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>RTT — Radiotherapy Technician</Typography>
              <Select fullWidth displayEmpty size="small" sx={{ ...inputStyle, mb: 1 }} value={data.approvals.rttName} onChange={e => { handleUpdate("ebrt", "approvals", "rttName", e.target.value); handleUpdate("ebrt", "approvals", "rttSigned", false); }}>
                <MenuItem value=""><em>Select Name</em></MenuItem>
                {["Ramesh Kumar", "Anita Singh", "Suresh Yadav", "Deepa Pillai", "Amit Tiwari"].map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}
              </Select>
              <Button fullWidth disabled={!data.approvals.rttName || data.approvals.rttSigned} onClick={() => openOtpDialog("ebrt", "rtt")} sx={{ height: 52, border: `1px solid ${data.approvals.rttSigned ? "#52c41a" : C.border}`, background: data.approvals.rttSigned ? "#f6ffed" : "transparent", color: data.approvals.rttSigned ? "#52c41a" : C.textMuted, ...btnStyle, fontSize: 10.5, opacity: !data.approvals.rttName ? 0.5 : 1 }}>{data.approvals.rttSigned ? 'Approved ✅' : 'Authorize via OTP'}</Button>
            </Box>
          </Box>
        </Box>

        {/* INTERRUPTION */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="9" title="Treatment Interruption Details" />
          {data.interruptionHistory && data.interruptionHistory.map((rec, idx) => (
            <Box key={idx} sx={{ p: 2, m: 2, bgcolor: C.bgSecondary, border: `1px dashed ${C.border}` }}>
              <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, mb: 1, color: C.textSecond }}>
                Record {idx + 1} (Added on {new Date(rec.savedAt).toLocaleDateString()})
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Continue Treatment: <span style={{ color: C.textPrimary }}>{rec.continueTreatment || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Reason: <span style={{ color: C.textPrimary }}>{rec.interruptReason || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Interrupted Date: <span style={{ color: C.textPrimary }}>{rec.interruptedDate || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Resume Date: <span style={{ color: C.textPrimary }}>{rec.resumeDate || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Completion Date: <span style={{ color: C.textPrimary }}>{rec.completionDate || "-"}</span></Typography>
              </Box>
            </Box>
          ))}
          <FieldRow label="Continue with treatment?"><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["Stop the treatment", "Suspend the treatment", "Continue with the same treatment"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.interruption.continueTreatment === opt} onChange={e => handleUpdate("ebrt", "interruption", "continueTreatment", e.target.value)} />)}</Box></FieldRow>
          <FieldRow label="Justification" nested><TextField fullWidth placeholder="Open text box" sx={inputStyle} size="small" value={data.interruption.interruptReason} onChange={e => handleUpdate("ebrt", "interruption", "interruptReason", e.target.value)} /></FieldRow>
          <FieldRow label="EBRT Interrupted date"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={data.interruption.interruptedDate} onChange={e => handleUpdate("ebrt", "interruption", "interruptedDate", e.target.value)} /></FieldRow>
          <FieldRow label="Resume date"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={data.interruption.resumeDate} onChange={e => handleUpdate("ebrt", "interruption", "resumeDate", e.target.value)} /></FieldRow>
          <FieldRow label="Days Delayed"><TextField disabled size="small" sx={{ ...inputStyle, maxWidth: 100 }} value={calculateDelayedDays(data.interruption.interruptedDate, data.interruption.resumeDate)} /></FieldRow>
          <FieldRow label="Radiotherapy Completion Date"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={data.interruption.completionDate} onChange={e => handleUpdate("ebrt", "interruption", "completionDate", e.target.value)} /></FieldRow>
          <Box sx={{ p: 2, display: "flex", justifyContent: "flex-end" }}>
            <Button variant="outlined" size="small" sx={{ ...btnStyle, borderColor: C.textPrimary, color: C.textPrimary }} onClick={handleAddInterruptionRecord}>+ Add Interruption Record</Button>
          </Box>
        </Box>

        {/* COMPLETION */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="10" title="Treatment Completion" />
          <FieldRow label="Radiotherapy Completion"><Box sx={{ display: "flex" }}>{["Planned", "Unplanned"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.completion.rtCompletion === opt} onChange={e => handleUpdate("ebrt", "completion", "rtCompletion", e.target.value)} />)}</Box></FieldRow>
          <FieldRow label="Justification" nested><TextField fullWidth placeholder="Enter justification for completion" sx={inputStyle} size="small" value={data.completion.rtCompletionJustification} onChange={e => handleUpdate("ebrt", "completion", "rtCompletionJustification", e.target.value)} /></FieldRow>

          <FieldRow label="Response Criteria"><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["WHO", "RECIST"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.completion.responseCriteria === opt} onChange={e => handleUpdate("ebrt", "completion", "responseCriteria", e.target.value)} />)}</Box></FieldRow>
          <FieldRow label="Clinical Response"><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["CR", "PR", "SD", "PD"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.completion.clinResponse === opt} onChange={e => handleUpdate("ebrt", "completion", "clinResponse", e.target.value)} />)}</Box></FieldRow>

          <FieldRow label="Treatment Gap"><Box sx={{ display: "flex" }}>{["Yes", "No"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={data.completion.txGap === opt} onChange={e => handleUpdate("ebrt", "completion", "txGap", e.target.value)} />)}</Box></FieldRow>
          {data.completion.txGap === "Yes" && (
            <>
              <FieldRow label="Interruption Details" nested><TextField fullWidth multiline rows={2} placeholder="Enter details of interruption" sx={inputStyle} value={data.completion.interruptionDetails} onChange={e => handleUpdate("ebrt", "completion", "interruptionDetails", e.target.value)} /></FieldRow>
              <FieldRow label="Reason for Gap" nested><TextField fullWidth multiline rows={2} placeholder="Enter reason for gap" sx={inputStyle} value={data.completion.gapReason} onChange={e => handleUpdate("ebrt", "completion", "gapReason", e.target.value)} /></FieldRow>
            </>
          )}
        </Box>

        {/* ADVERSE EVENTS */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="11" title="Adverse Event Reporting" note="As per RTOG and CTCAE 5" />
          <Box sx={{ p: 2 }}>
            {(data.adverseEvents || []).map((event, i) => (
              <Box key={event.id} sx={{ border: `1px dashed ${C.border}`, p: 2, mb: 2, bgcolor: C.bgSecondary }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 2 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: FW_MEDIUM, letterSpacing: "0.08em", textTransform: "uppercase", color: C.textMuted }}>Adverse Event {i + 1}</Typography>
                  <Button size="small" sx={{ color: "error.main", fontSize: 10 }} onClick={() => removeAdverseEvent(event.id)}>Remove</Button>
                </Box>
                <FieldRow label="Date of Event"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={event.date} onChange={e => handleAdverseEvent(i, "date", e.target.value)} /></FieldRow>
                <FieldRow label="Adverse Event"><TextField fullWidth placeholder="Enter adverse event details" sx={inputStyle} size="small" value={event.event} onChange={e => handleAdverseEvent(i, "event", e.target.value)} /></FieldRow>
                <FieldRow label="Grading System"><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["CTCAE 5", "RTOG", "Other"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={event.gradingSystem === opt} onChange={e => handleAdverseEvent(i, "gradingSystem", e.target.value)} />)}</Box></FieldRow>
                <FieldRow label="Grade">
                  <Select size="small" displayEmpty value={event.grade} onChange={e => handleAdverseEvent(i, "grade", e.target.value)} sx={{ ...inputStyle, width: "100%", maxWidth: 300 }}>
                    <MenuItem value=""><em>Select Grade</em></MenuItem>
                    {["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
                  </Select>
                </FieldRow>
                <FieldRow label="Management / Remarks"><TextField fullWidth placeholder="Enter management or remarks" sx={inputStyle} size="small" value={event.management} onChange={e => handleAdverseEvent(i, "management", e.target.value)} /></FieldRow>
              </Box>
            ))}
            <Button variant="text" size="small" sx={{ ...btnStyle, color: C.textSecond, mt: 1 }} onClick={addAdverseEvent}>+ Add another adverse event</Button>
          </Box>
        </Box>

        {/* FOLLOW UP */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="12" title="Follow Up" />
          {data.followUpHistory && data.followUpHistory.map((rec, idx) => (
            <Box key={idx} sx={{ p: 2, m: 2, bgcolor: C.bgSecondary, border: `1px dashed ${C.border}` }}>
              <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, mb: 1, color: C.textSecond }}>
                Record {idx + 1} (Added on {new Date(rec.savedAt).toLocaleDateString()})
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Date: <span style={{ color: C.textPrimary }}>{rec.date || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Time: <span style={{ color: C.textPrimary }}>{rec.time || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Imaging Advised: <span style={{ color: C.textPrimary }}>{rec.imagingAdvised || "-"} {rec.imagingAdvisedOther ? `(${rec.imagingAdvisedOther})` : ""}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Post Completion Plan: <span style={{ color: C.textPrimary }}>{rec.postCompletionPlan || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Advice: <span style={{ color: C.textPrimary }}>{rec.adviceOnCompletion || "-"}</span></Typography>
              </Box>
            </Box>
          ))}
          <FieldRow label="Follow up date"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={data.followUp.date} onChange={e => handleUpdate("ebrt", "followUp", "date", e.target.value)} /></FieldRow>
          <FieldRow label="Follow up time"><TextField type="time" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={data.followUp.time} onChange={e => handleUpdate("ebrt", "followUp", "time", e.target.value)} /></FieldRow>
          <FieldRow label="Imaging Advised">
            <Select size="small" displayEmpty value={data.followUp.imagingAdvised} onChange={e => handleUpdate("ebrt", "followUp", "imagingAdvised", e.target.value)} sx={{ ...inputStyle, width: "100%", maxWidth: 300 }}>
              <MenuItem value=""><em>Select Imaging</em></MenuItem>
              {["CT", "MRI", "PET-CT", "USG", "X-Ray", "Other"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
            </Select>
          </FieldRow>
          {data.followUp.imagingAdvised === "Other" && (
            <FieldRow label="Specify Other Imaging" nested><TextField fullWidth placeholder="Enter imaging name" sx={inputStyle} size="small" value={data.followUp.imagingAdvisedOther} onChange={e => handleUpdate("ebrt", "followUp", "imagingAdvisedOther", e.target.value)} /></FieldRow>
          )}
          <FieldRow label="Post completion treatment plan"><TextField fullWidth placeholder="Free text box" sx={inputStyle} size="small" value={data.followUp.postCompletionPlan} onChange={e => handleUpdate("ebrt", "followUp", "postCompletionPlan", e.target.value)} /></FieldRow>
          <FieldRow label="Advice on completion"><TextField fullWidth placeholder="Free text box" sx={inputStyle} size="small" value={data.followUp.adviceOnCompletion} onChange={e => handleUpdate("ebrt", "followUp", "adviceOnCompletion", e.target.value)} /></FieldRow>
          <Box sx={{ p: 2, display: "flex", justifyContent: "flex-end" }}>
            <Button variant="outlined" size="small" sx={{ ...btnStyle, borderColor: C.textPrimary, color: C.textPrimary }} onClick={handleAddFollowUpRecord}>+ Add Follow Up Record</Button>
          </Box>
        </Box>

        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 4, pt: 3, borderTop: `1px solid ${C.border}` }}>
          <Button variant="outlined" sx={{ ...btnStyle, borderColor: C.border, color: C.black }} onClick={() => setActiveTab("procedure")}>← Back</Button>
          <Box sx={{ display: "flex", gap: 2 }}>
            <Button variant="outlined" sx={{ ...btnStyle, borderColor: C.border, color: C.black }} onClick={() => saveTab("ebrt")}>Save draft</Button>
            <Button variant="contained" sx={{ ...btnStyle, bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" } }} onClick={() => setActiveTab("brachy")}>Continue to Brachytherapy →</Button>
          </Box>
        </Box>
      </Box>
    );
  };

  // ─── BRACHYTHERAPY MODULE (C) ────────────────────────────────────────
  const renderBrachy = () => {
    const handleAddInterruptionRecord = () => {
      if (!formData.brachy.interruption.interruptedDate) {
        alert("Please enter the Interrupted Date before adding the record.");
        return;
      }
      const newRecord = { ...formData.brachy.interruption, savedAt: new Date().toISOString() };
      handleUpdate("brachy", "interruptionHistory", null, [...(formData.brachy.interruptionHistory || []), newRecord]);
      handleUpdate("brachy", "interruption", null, { continueTreatment: "Continue with the same treatment", interruptReason: "", interruptedDate: "", resumeDate: "", completionDate: "" });
    };

    const handleAddFollowUpRecord = () => {
      if (!formData.brachy.followUp.date) {
        alert("Please enter the Follow up date before adding the record.");
        return;
      }
      const newRecord = { ...formData.brachy.followUp, savedAt: new Date().toISOString() };
      handleUpdate("brachy", "followUpHistory", null, [...(formData.brachy.followUpHistory || []), newRecord]);
      handleUpdate("brachy", "followUp", null, { date: "", time: "", imagingAdvised: "", imagingAdvisedOther: "", postCompletionPlan: "", adviceOnCompletion: "" });
    };

    // Similar mapping for brachytherapy fields...
    return (
      <Box>
        <Box sx={{ mb: 4, pb: 2, borderBottom: `1px solid ${C.black}` }}>
          <Typography sx={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted, mb: 1 }}>RT — Part C</Typography>
          <Typography variant="h5" sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, mb: 1 }}>Brachytherapy Module</Typography>
          <Typography sx={{ fontSize: 13, color: C.textSecond, maxWidth: 760, lineHeight: 1.6 }}>Planning and delivery of brachytherapy — source placement, dose calculation and treatment-delivery tracking.</Typography>
        </Box>

        {renderDictationBox('brachy')}

        <HistoryTable historyData={formData.history?.brachy} />

        {/* TREATMENT */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="5" title="Treatment" />
          <FieldRow label="Clinical Assessment Details"><TextField multiline rows={2} fullWidth placeholder="Open text box" sx={inputStyle} value={formData.brachy.treatment.clinicalAssessment} onChange={e => handleUpdate("brachy", "treatment", "clinicalAssessment", e.target.value)} /></FieldRow>
          <FieldRow label="Plan of Treatment"><TextField multiline rows={2} fullWidth placeholder="Open text box" sx={inputStyle} value={formData.brachy.treatment.planOfTreatment} onChange={e => handleUpdate("brachy", "treatment", "planOfTreatment", e.target.value)} /></FieldRow>
        </Box>

        {/* PREVIOUS EBRT */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="6" title="Previous EBRT Details" />
          <FieldRow label="Intent"><Box sx={{ display: "flex" }}>{["Curative", "Non-Curative"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={formData.brachy.prevEBRT.intent === opt} onChange={e => handleUpdate("brachy", "prevEBRT", "intent", e.target.value)} />)}</Box></FieldRow>
          <FieldRow label="Total Radiotherapy Dose (cGy)"><TextField type="number" sx={inputStyle} size="small" value={formData.brachy.prevEBRT.totalDose} onChange={e => handleUpdate("brachy", "prevEBRT", "totalDose", e.target.value)} /></FieldRow>
          <FieldRow label="Total Number of Fractions"><TextField type="number" sx={inputStyle} size="small" value={formData.brachy.prevEBRT.totalFractions} onChange={e => handleUpdate("brachy", "prevEBRT", "totalFractions", e.target.value)} /></FieldRow>
          <FieldRow label="Dose Per Fraction" tag="auto-calculate"><TextField disabled placeholder="Auto-calculated" fullWidth sx={inputStyle} size="small" value={formData.brachy.prevEBRT.totalDose && formData.brachy.prevEBRT.totalFractions ? (formData.brachy.prevEBRT.totalDose / formData.brachy.prevEBRT.totalFractions).toFixed(1) : ""} /></FieldRow>
        </Box>

        {/* PROCEDURE DETAILS */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="7" title="Procedure Details" />
          <FieldRow label="Date of Procedure"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.procedure.dateOfProcedure} onChange={e => handleUpdate("brachy", "procedure", "dateOfProcedure", e.target.value)} /></FieldRow>
          <FieldRow label="Anaesthesia Type">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%" }}>
              <Select size="small" displayEmpty value={formData.brachy.procedure.anaesthesiaType} onChange={e => handleUpdate("brachy", "procedure", "anaesthesiaType", e.target.value)} sx={inputStyle}>
                <MenuItem value="" disabled>Select Anaesthesia Type</MenuItem>
                {["General Anaesthesia (GA)", "Spinal Anaesthesia (SA)", "Epidural", "Local Anaesthesia (LA)", "Sedation", "None", "Other"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
              </Select>
              {formData.brachy.procedure.anaesthesiaType === "Other" && (
                <TextField fullWidth placeholder="Enter other anaesthesia type" sx={inputStyle} size="small" value={formData.brachy.procedure.anaesthesiaTypeOther || ""} onChange={e => handleUpdate("brachy", "procedure", "anaesthesiaTypeOther", e.target.value)} />
              )}
            </Box>
          </FieldRow>
          <FieldRow label="Implant / Template Used">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%" }}>
              <Select size="small" displayEmpty value={formData.brachy.procedure.implantUsed} onChange={e => handleUpdate("brachy", "procedure", "implantUsed", e.target.value)} sx={inputStyle}>
                <MenuItem value="" disabled>Select Implant / Template Used</MenuItem>
                {["Tandem & Ovoid", "Tandem & Ring", "Vaginal Cylinder (30 mm)", "Utrecht Applicator with Interstitial Needles", "Venezia Applicator", "Syed-Neblett Template", "MUPIT", "Transperineal Template Grid", "Multi-catheter Implant", "SAVI Applicator", "Freiburg Flap", "Leipzig Applicator", "COMS Plaque", "Other"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
              </Select>
              {formData.brachy.procedure.implantUsed === "Other" && (
                <TextField fullWidth placeholder="Enter other implant / template" sx={inputStyle} size="small" value={formData.brachy.procedure.implantUsedOther || ""} onChange={e => handleUpdate("brachy", "procedure", "implantUsedOther", e.target.value)} />
              )}
            </Box>
          </FieldRow>
          <FieldRow label="EUA Findings"><TextField fullWidth placeholder="Free text box" sx={inputStyle} size="small" value={formData.brachy.procedure.euaFindings} onChange={e => handleUpdate("brachy", "procedure", "euaFindings", e.target.value)} /></FieldRow>
          <FieldRow label="No. of Tubes / Needles Used"><TextField type="number" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.procedure.tubesNeedles} onChange={e => handleUpdate("brachy", "procedure", "tubesNeedles", e.target.value)} /></FieldRow>
          <FieldRow label="No. of Planes Used"><TextField type="number" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.procedure.planes} onChange={e => handleUpdate("brachy", "procedure", "planes", e.target.value)} /></FieldRow>
        </Box>

        {/* IMAGING */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="8" title="Imaging" />
          <FieldRow label="Technique">
            <Select size="small" displayEmpty value={formData.brachy.imaging.technique} onChange={e => handleUpdate("brachy", "imaging", "technique", e.target.value)} sx={{ ...inputStyle, width: "100%", maxWidth: 300 }}>
              <MenuItem value="" disabled>Select Technique</MenuItem>
              {["CT", "MRI", "PET-CT", "USG", "X-Ray", "Other"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
            </Select>
          </FieldRow>
          <FieldRow label="Target Definition"><TextField fullWidth placeholder="GTV / CTV / PTV Details" sx={inputStyle} size="small" value={formData.brachy.imaging.targetDefinition} onChange={e => handleUpdate("brachy", "imaging", "targetDefinition", e.target.value)} /></FieldRow>
          <FieldRow label="Contouring">
            <Box sx={{ display: "flex", gap: 2 }}>
              {["gtv", "ctv", "ptv"].map(opt => <CustomCheckbox key={opt} label={opt.toUpperCase()} checked={formData.brachy.imaging[opt]} onChange={e => handleUpdate("brachy", "imaging", opt, e.target.checked)} />)}
            </Box>
          </FieldRow>
        </Box>

        {/* DOSE PRESCRIPTION */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="9" title="Dose Prescription" />
          <FieldRow label="Technique">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, width: "100%" }}>
              <Select size="small" displayEmpty value={formData.brachy.dosePrescription.technique} onChange={e => handleUpdate("brachy", "dosePrescription", "technique", e.target.value)} sx={{ ...inputStyle, width: "100%", maxWidth: 300 }}>
                <MenuItem value="" disabled>Select Technique</MenuItem>
                {["HDR", "LDR", "PDR", "Other"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
              </Select>
              <OtherField
                show={formData.brachy.dosePrescription.technique === "Other"}
                label="Other Dose Rate Technique"
                value={formData.brachy.dosePrescription.techniqueOther}
                fromProtocol={formData.brachy.dosePrescription.techniqueFromProtocol}
              />
            </Box>
          </FieldRow>
          <FieldRow label="Prescription Target"><TextField fullWidth placeholder="e.g. HR-CTV" sx={inputStyle} size="small" value={formData.brachy.dosePrescription.prescriptionTarget} onChange={e => handleUpdate("brachy", "dosePrescription", "prescriptionTarget", e.target.value)} /></FieldRow>
          <FieldRow label="Prescription Dose"><TextField fullWidth placeholder="e.g. 7 Gy × 4 Fractions" sx={inputStyle} size="small" value={formData.brachy.dosePrescription.prescriptionDose} onChange={e => handleUpdate("brachy", "dosePrescription", "prescriptionDose", e.target.value)} /></FieldRow>
          <FieldRow label="Number of Fractions"><TextField type="number" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.dosePrescription.numberOfFractions} onChange={e => handleUpdate("brachy", "dosePrescription", "numberOfFractions", e.target.value)} /></FieldRow>
          <FieldRow label="Total Dose (Gy)"><TextField type="text" inputMode="decimal" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.dosePrescription.totalDose} onChange={e => handleUpdate("brachy", "dosePrescription", "totalDose", e.target.value)} /></FieldRow>
          <FieldRow label="Fractionation Schedule">
            <Select size="small" displayEmpty value={formData.brachy.dosePrescription.fractionationSchedule || ""} onChange={e => handleUpdate("brachy", "dosePrescription", "fractionationSchedule", e.target.value)} sx={{ ...inputStyle, width: "100%", maxWidth: 300 }}>
              <MenuItem value="" disabled>Select Schedule</MenuItem>
              {["AlternateDay", "Daily", "Once Weekly", "Others"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
            </Select>
          </FieldRow>
          <FieldRow label="Doses Per Fraction"><TextField type="number" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.dosePrescription.dosePerFraction || ""} onChange={e => handleUpdate("brachy", "dosePrescription", "dosePerFraction", e.target.value)} /></FieldRow>
          <FieldRow label="Dose Constraints"><TextField multiline rows={3} fullWidth placeholder="e.g. Bladder D2cc < 90 Gy EQD2" sx={inputStyle} value={formData.brachy.dosePrescription.doseConstraints} onChange={e => handleUpdate("brachy", "dosePrescription", "doseConstraints", e.target.value)} /></FieldRow>
        </Box>

        {renderRTTrackingSection("brachy")}

        {/* APPROVALS — OTP Authorization */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="10" title="Approvals" note="OTP Authorization" />
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 2, p: 2 }}>
            {/* RO */}
            <Box sx={{ border: `1px solid ${C.border}`, p: 2 }}>
              <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>RO — Radiation Oncologist</Typography>
              <Select fullWidth displayEmpty size="small" sx={{ ...inputStyle, mb: 1 }} value={formData.brachy.approvals.roName} onChange={e => { handleUpdate("brachy", "approvals", "roName", e.target.value); handleUpdate("brachy", "approvals", "roSigned", false); }}>
                <MenuItem value=""><em>Select Name</em></MenuItem>
                {doctorsList.filter(doc => (doc.speciality || doc.specialization || "").toLowerCase() === "radiation oncology").map(doc => <MenuItem key={doc._id || doc.name} value={doc.name}>{doc.name}</MenuItem>)}
              </Select>
              <Button fullWidth disabled={!formData.brachy.approvals.roName || formData.brachy.approvals.roSigned} onClick={() => openOtpDialog("brachy", "ro")} sx={{ height: 52, border: `1px solid ${formData.brachy.approvals.roSigned ? "#52c41a" : C.border}`, background: formData.brachy.approvals.roSigned ? "#f6ffed" : "transparent", color: formData.brachy.approvals.roSigned ? "#52c41a" : C.textMuted, ...btnStyle, fontSize: 10.5, opacity: !formData.brachy.approvals.roName ? 0.5 : 1 }}>{formData.brachy.approvals.roSigned ? 'Approved ✅' : 'Authorize via OTP'}</Button>
            </Box>
            {/* MP */}
            <Box sx={{ border: `1px solid ${C.border}`, p: 2 }}>
              <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>MP — Medical Physicist</Typography>
              <Select fullWidth displayEmpty size="small" sx={{ ...inputStyle, mb: 1 }} value={formData.brachy.approvals.mpName} onChange={e => { handleUpdate("brachy", "approvals", "mpName", e.target.value); handleUpdate("brachy", "approvals", "mpSigned", false); }}>
                <MenuItem value=""><em>Select Name</em></MenuItem>
                {["Dr. Kavita Rao", "Dr. Manish Joshi", "Dr. Neha Kulkarni", "Dr. Sanjay Deshmukh", "Dr. Pooja Nair"].map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}
              </Select>
              <Button fullWidth disabled={!formData.brachy.approvals.mpName || formData.brachy.approvals.mpSigned} onClick={() => openOtpDialog("brachy", "mp")} sx={{ height: 52, border: `1px solid ${formData.brachy.approvals.mpSigned ? "#52c41a" : C.border}`, background: formData.brachy.approvals.mpSigned ? "#f6ffed" : "transparent", color: formData.brachy.approvals.mpSigned ? "#52c41a" : C.textMuted, ...btnStyle, fontSize: 10.5, opacity: !formData.brachy.approvals.mpName ? 0.5 : 1 }}>{formData.brachy.approvals.mpSigned ? 'Approved ✅' : 'Authorize via OTP'}</Button>
            </Box>
            {/* RTT */}
            <Box sx={{ border: `1px solid ${C.border}`, p: 2 }}>
              <Typography sx={{ fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>RTT — Radiotherapy Technician</Typography>
              <Select fullWidth displayEmpty size="small" sx={{ ...inputStyle, mb: 1 }} value={formData.brachy.approvals.rttName} onChange={e => { handleUpdate("brachy", "approvals", "rttName", e.target.value); handleUpdate("brachy", "approvals", "rttSigned", false); }}>
                <MenuItem value=""><em>Select Name</em></MenuItem>
                {["Ramesh Kumar", "Anita Singh", "Suresh Yadav", "Deepa Pillai", "Amit Tiwari"].map(name => <MenuItem key={name} value={name}>{name}</MenuItem>)}
              </Select>
              <Button fullWidth disabled={!formData.brachy.approvals.rttName || formData.brachy.approvals.rttSigned} onClick={() => openOtpDialog("brachy", "rtt")} sx={{ height: 52, border: `1px solid ${formData.brachy.approvals.rttSigned ? "#52c41a" : C.border}`, background: formData.brachy.approvals.rttSigned ? "#f6ffed" : "transparent", color: formData.brachy.approvals.rttSigned ? "#52c41a" : C.textMuted, ...btnStyle, fontSize: 10.5, opacity: !formData.brachy.approvals.rttName ? 0.5 : 1 }}>{formData.brachy.approvals.rttSigned ? 'Approved ✅' : 'Authorize via OTP'}</Button>
            </Box>
          </Box>
        </Box>

        {/* INTERRUPTION */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="11" title="Treatment Interruption Details" />
          {formData.brachy.interruptionHistory && formData.brachy.interruptionHistory.map((rec, idx) => (
            <Box key={idx} sx={{ p: 2, m: 2, bgcolor: C.bgSecondary, border: `1px dashed ${C.border}` }}>
              <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, mb: 1, color: C.textSecond }}>
                Record {idx + 1} (Added on {new Date(rec.savedAt).toLocaleDateString()})
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Continue Treatment: <span style={{ color: C.textPrimary }}>{rec.continueTreatment || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Reason: <span style={{ color: C.textPrimary }}>{rec.interruptReason || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Interrupted Date: <span style={{ color: C.textPrimary }}>{rec.interruptedDate || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Resume Date: <span style={{ color: C.textPrimary }}>{rec.resumeDate || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Completion Date: <span style={{ color: C.textPrimary }}>{rec.completionDate || "-"}</span></Typography>
              </Box>
            </Box>
          ))}
          <FieldRow label="Continue with treatment?"><Box sx={{ display: "flex", flexWrap: "wrap" }}>{["Stop the treatment", "Suspend the treatment", "Continue with the same treatment"].map(opt => <CustomRadio key={opt} label={opt} value={opt} checked={formData.brachy.interruption.continueTreatment === opt} onChange={e => handleUpdate("brachy", "interruption", "continueTreatment", e.target.value)} />)}</Box></FieldRow>
          <FieldRow label="Justification" nested><TextField fullWidth placeholder="Open text box" sx={inputStyle} size="small" value={formData.brachy.interruption.interruptReason} onChange={e => handleUpdate("brachy", "interruption", "interruptReason", e.target.value)} /></FieldRow>
          <FieldRow label="Brachytherapy Interrupted date"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.interruption.interruptedDate} onChange={e => handleUpdate("brachy", "interruption", "interruptedDate", e.target.value)} /></FieldRow>
          <FieldRow label="Resume date"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.interruption.resumeDate} onChange={e => handleUpdate("brachy", "interruption", "resumeDate", e.target.value)} /></FieldRow>
          <FieldRow label="Days Delayed"><TextField disabled size="small" sx={{ ...inputStyle, maxWidth: 100 }} value={calculateDelayedDays(formData.brachy.interruption.interruptedDate, formData.brachy.interruption.resumeDate)} /></FieldRow>
          <FieldRow label="Radiotherapy Completion Date"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.interruption.completionDate} onChange={e => handleUpdate("brachy", "interruption", "completionDate", e.target.value)} /></FieldRow>
          <Box sx={{ p: 2, display: "flex", justifyContent: "flex-end" }}>
            <Button variant="outlined" size="small" sx={{ ...btnStyle, borderColor: C.textPrimary, color: C.textPrimary }} onClick={handleAddInterruptionRecord}>+ Add Interruption Record</Button>
          </Box>
        </Box>

        {/* FOLLOW UP */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <SectionHeader num="12" title="Follow Up" />
          {formData.brachy.followUpHistory && formData.brachy.followUpHistory.map((rec, idx) => (
            <Box key={idx} sx={{ p: 2, m: 2, bgcolor: C.bgSecondary, border: `1px dashed ${C.border}` }}>
              <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, mb: 1, color: C.textSecond }}>
                Record {idx + 1} (Added on {new Date(rec.savedAt).toLocaleDateString()})
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1 }}>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Date: <span style={{ color: C.textPrimary }}>{rec.date || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Time: <span style={{ color: C.textPrimary }}>{rec.time || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Imaging Advised: <span style={{ color: C.textPrimary }}>{rec.imagingAdvised || "-"} {rec.imagingAdvisedOther ? `(${rec.imagingAdvisedOther})` : ""}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Post Completion Plan: <span style={{ color: C.textPrimary }}>{rec.postCompletionPlan || "-"}</span></Typography>
                <Typography sx={{ fontSize: 11, color: C.textMuted }}>Advice: <span style={{ color: C.textPrimary }}>{rec.adviceOnCompletion || "-"}</span></Typography>
              </Box>
            </Box>
          ))}
          <FieldRow label="Follow up date"><TextField type="date" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.followUp.date} onChange={e => handleUpdate("brachy", "followUp", "date", e.target.value)} /></FieldRow>
          <FieldRow label="Follow up time"><TextField type="time" sx={{ ...inputStyle, maxWidth: 200 }} size="small" value={formData.brachy.followUp.time} onChange={e => handleUpdate("brachy", "followUp", "time", e.target.value)} /></FieldRow>
          <FieldRow label="Imaging Advised">
            <Select size="small" displayEmpty value={formData.brachy.followUp.imagingAdvised} onChange={e => handleUpdate("brachy", "followUp", "imagingAdvised", e.target.value)} sx={{ ...inputStyle, width: "100%", maxWidth: 300 }}>
              <MenuItem value=""><em>Select Imaging</em></MenuItem>
              {["CT", "MRI", "PET-CT", "USG", "X-Ray", "Other"].map(opt => <MenuItem key={opt} value={opt}>{opt}</MenuItem>)}
            </Select>
          </FieldRow>
          {formData.brachy.followUp.imagingAdvised === "Other" && (
            <FieldRow label="Specify Other Imaging" nested><TextField fullWidth placeholder="Enter imaging name" sx={inputStyle} size="small" value={formData.brachy.followUp.imagingAdvisedOther} onChange={e => handleUpdate("brachy", "followUp", "imagingAdvisedOther", e.target.value)} /></FieldRow>
          )}
          <FieldRow label="Post completion treatment plan"><TextField fullWidth placeholder="Free text box" sx={inputStyle} size="small" value={formData.brachy.followUp.postCompletionPlan} onChange={e => handleUpdate("brachy", "followUp", "postCompletionPlan", e.target.value)} /></FieldRow>
          <FieldRow label="Advice on completion"><TextField fullWidth placeholder="Free text box" sx={inputStyle} size="small" value={formData.brachy.followUp.adviceOnCompletion} onChange={e => handleUpdate("brachy", "followUp", "adviceOnCompletion", e.target.value)} /></FieldRow>
          <Box sx={{ p: 2, display: "flex", justifyContent: "flex-end" }}>
            <Button variant="outlined" size="small" sx={{ ...btnStyle, borderColor: C.textPrimary, color: C.textPrimary }} onClick={handleAddFollowUpRecord}>+ Add Follow Up Record</Button>
          </Box>
        </Box>

        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 4, pt: 3, borderTop: `1px solid ${C.border}` }}>
          <Button variant="outlined" sx={{ ...btnStyle, borderColor: C.border, color: C.black }} onClick={() => setActiveTab("ebrt")}>← Back</Button>
          <Box sx={{ display: "flex", gap: 2 }}>
            <Button variant="outlined" sx={{ ...btnStyle, borderColor: C.border, color: C.black }} onClick={() => saveTab("brachy")}>Save draft</Button>
            <Button variant="contained" sx={{ ...btnStyle, bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" } }} onClick={() => setActiveTab("discharge")}>Continue to Discharge →</Button>
          </Box>
        </Box>
      </Box>
    );
  };

  // ─── DISCHARGE SUMMARY (D) ───────────────────────────────────────────
  const renderDischarge = () => {
    const handleGenerateSummary = async () => {
      setIsGeneratingSummary(true);
      try {
        const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/generate-radiotherapy-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ formData })
        });
        if (res.ok) {
          const data = await res.json();
          handleUpdate("discharge", "summaryParagraph", null, data.summary || "");
        } else {
          alert("Failed to generate summary.");
        }
      } catch (err) {
        console.error("Generate summary error:", err);
        alert("An error occurred while generating the summary.");
      } finally {
        setIsGeneratingSummary(false);
      }
    };

    const handleGenerateToxicitySummary = async () => {
      setIsGeneratingToxicitySummary(true);
      try {
        const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/generate-toxicity-summary`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId })
        });
        if (res.ok) {
          const data = await res.json();
          handleUpdate("discharge", "toxicitySummaryParagraph", null, data.summary || "");
        } else {
          alert("Failed to generate toxicity summary.");
        }
      } catch (err) {
        console.error("Generate toxicity summary error:", err);
        alert("An error occurred while generating the toxicity summary.");
      } finally {
        setIsGeneratingToxicitySummary(false);
      }
    };

    return (
      <Box>
        <Box sx={{ mb: 4, pb: 2, borderBottom: `1px solid ${C.black}` }}>
          <Typography sx={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted, mb: 1 }}>RT — Part G</Typography>
          <Typography variant="h5" sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, mb: 1 }}>Discharge Summary</Typography>
          <Typography sx={{ fontSize: 13, color: C.textSecond, maxWidth: 760, lineHeight: 1.6 }}>Timely, comprehensive documentation of discharge information following radiotherapy — mostly auto-populated from Parts A, B and C.</Typography>
        </Box>

        {/* SECTION 1: PRIMARY DETAILS */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <Box sx={{ bgcolor: C.black, p: 1.5 }}>
            <Typography sx={{ color: C.white, fontSize: 13, fontWeight: FW_MEDIUM, textTransform: "uppercase" }}>Primary Details</Typography>
          </Box>
          <Box sx={{ p: 2, display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, columnGap: 4 }}>
            {/* left column fields */}
            <Box>
              {["Name", "Age", "Gender", "Weight", "Co-morbidities", "Contact No."].map(k => {
                const val = formData.discharge.primary[k] || "";
                return (
                  <Box key={k} sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>{k}</Typography>
                    <TextField size="small" sx={{ ...inputStyle, bgcolor: C.white }} placeholder="Enter details" value={val} onChange={(e) => { const updated = { ...formData.discharge.primary, [k]: e.target.value }; handleUpdate("discharge", "primary", null, updated); }} />
                  </Box>
                );
              })}
            </Box>
            {/* right column fields */}
            <Box>
              {["TNM Staging", "Laterality", "Histopathology", "Intent", "Role of Radiotherapy"].map(k => {
                const val = formData.discharge.primary[k] || "";
                return (
                  <Box key={k} sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>{k}</Typography>
                    <TextField size="small" sx={{ ...inputStyle, bgcolor: C.white }} placeholder="Enter details" value={val} onChange={(e) => { const updated = { ...formData.discharge.primary, [k]: e.target.value }; handleUpdate("discharge", "primary", null, updated); }} />
                  </Box>
                );
              })}
            </Box>
          </Box>
        </Box>

        {/* SECTION 2: INTERRUPTION & FOLLOW UP */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <Box sx={{ bgcolor: C.black, p: 1.5 }}>
            <Typography sx={{ color: C.white, fontSize: 13, fontWeight: FW_MEDIUM, textTransform: "uppercase" }}>Treatment Interruption & Follow Up Details</Typography>
          </Box>
          <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 3 }}>

            {/* EBRT */}
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.black, mb: 1, textTransform: "uppercase" }}>EBRT Module Data</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, columnGap: 4 }}>
                {/* Interruption */}
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, color: C.textSecond, mb: 1 }}>Interruption</Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Reason</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.ebrt.interruption?.interruptReason || ""} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Interrupted Date</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.ebrt.interruption?.interruptedDate || ""} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Resume Date</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.ebrt.interruption?.resumeDate || ""} />
                  </Box>
                </Box>
                {/* Follow Up */}
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, color: C.textSecond, mb: 1 }}>Follow Up Plan</Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Date</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.ebrt.followUp?.date || ""} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Imaging Advised</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.ebrt.followUp?.imagingAdvised || ""} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Advice</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.ebrt.followUp?.adviceOnCompletion || ""} />
                  </Box>
                </Box>
              </Box>
            </Box>

            {/* BRACHY */}
            <Box>
              <Typography sx={{ fontSize: 13, fontWeight: FW_MEDIUM, color: C.black, mb: 1, textTransform: "uppercase", pt: 2, borderTop: `1px solid ${C.border}` }}>Brachytherapy Module Data</Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, columnGap: 4 }}>
                {/* Interruption */}
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, color: C.textSecond, mb: 1 }}>Interruption</Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Reason</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.brachy.interruption?.interruptReason || ""} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Interrupted Date</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.brachy.interruption?.interruptedDate || ""} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Resume Date</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.brachy.interruption?.resumeDate || ""} />
                  </Box>
                </Box>
                {/* Follow Up */}
                <Box>
                  <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, color: C.textSecond, mb: 1 }}>Follow Up Plan</Typography>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Date</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.brachy.followUp?.date || ""} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Imaging Advised</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.brachy.followUp?.imagingAdvised || ""} />
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: "150px 1fr", py: 1.5, borderBottom: `1px solid #eee` }}>
                    <Typography sx={{ fontSize: 13, color: C.black, display: "flex", alignItems: "center" }}>Advice</Typography>
                    <TextField disabled size="small" sx={{ ...inputStyle, bgcolor: C.bgSecondary }} value={formData.brachy.followUp?.adviceOnCompletion || ""} />
                  </Box>
                </Box>
              </Box>
            </Box>

          </Box>
        </Box>

        {/* SECTION 3: RADIOTHERAPY SUMMARY / BRACHYTHERAPY */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <Box sx={{ bgcolor: C.black, p: 1.5 }}>
            <Typography sx={{ color: C.white, fontSize: 13, fontWeight: FW_MEDIUM, textTransform: "uppercase" }}>Radiotherapy Summary / Brachytherapy</Typography>
          </Box>
          <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ display: "flex", justifyContent: "flex-end", alignItems: "center", mb: 1 }}>
              <Button
                variant="outlined"
                size="small"
                sx={{ ...btnStyle, borderColor: C.black, color: C.black }}
                onClick={handleGenerateSummary}
                disabled={isGeneratingSummary}
              >
                {isGeneratingSummary ? "Generating..." : "✨ Auto-Generate Summary"}
              </Button>
            </Box>
            <TextField
              multiline
              minRows={6}
              fullWidth
              placeholder="Generate or type the narrative summary here..."
              sx={{
                ...inputStyle,
                "& .MuiOutlinedInput-root": { p: 1.5, fontSize: 13, lineHeight: 1.6 }
              }}
              value={formData.discharge.summaryParagraph || ""}
              onChange={(e) => handleUpdate("discharge", "summaryParagraph", null, e.target.value)}
            />
          </Box>
        </Box>

        {/* SECTION 4: TOXICITY SUMMARY */}
        <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
          <Box sx={{ bgcolor: C.black, p: 1.5 }}>
            <Typography sx={{ color: C.white, fontSize: 13, fontWeight: FW_MEDIUM, textTransform: "uppercase" }}>Toxicity Summary</Typography>
          </Box>
          <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2 }}>
            <Box sx={{ display: "flex", justifyContent: "flex-end", alignItems: "center", mb: 1 }}>
              <Button
                variant="outlined"
                size="small"
                sx={{ ...btnStyle, borderColor: C.black, color: C.black }}
                onClick={handleGenerateToxicitySummary}
                disabled={isGeneratingToxicitySummary}
              >
                {isGeneratingToxicitySummary ? "Generating..." : "✨ Auto-Generate Toxicity Summary"}
              </Button>
            </Box>
            <TextField
              multiline
              minRows={4}
              fullWidth
              placeholder="Generate or type the narrative toxicity summary here..."
              sx={{
                ...inputStyle,
                "& .MuiOutlinedInput-root": { p: 1.5, fontSize: 13, lineHeight: 1.6 }
              }}
              value={formData.discharge.toxicitySummaryParagraph || ""}
              onChange={(e) => handleUpdate("discharge", "toxicitySummaryParagraph", null, e.target.value)}
            />
          </Box>
        </Box>

        <Box sx={{ display: "flex", justifyContent: "space-between", mt: 4, pt: 3, borderTop: `1px solid ${C.border}` }}>
          <Button variant="outlined" sx={{ ...btnStyle, borderColor: C.border, color: C.black }} onClick={() => window.print()}>Print</Button>
          <Button variant="contained" sx={{ ...btnStyle, bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" } }} onClick={() => saveTab("discharge")}>Save Discharge Summary</Button>
        </Box>
      </Box>
    );
  };

  const suspendedMessages = [];
  if (formData.ebrt?.interruption?.continueTreatment === "Suspend the treatment" && formData.ebrt?.interruption?.resumeDate) {
    suspendedMessages.push(`EBRT treatment is postponed and will resume on ${new Date(formData.ebrt.interruption.resumeDate).toLocaleDateString()}`);
  }
  if (formData.brachy?.interruption?.continueTreatment === "Suspend the treatment" && formData.brachy?.interruption?.resumeDate) {
    suspendedMessages.push(`Brachytherapy treatment is postponed and will resume on ${new Date(formData.brachy.interruption.resumeDate).toLocaleDateString()}`);
  }

  return (
    <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, background: C.bgPrimary, height: { xs: "auto", md: "calc(100vh - 140px)" }, minHeight: { xs: "calc(100vh - 140px)", md: "auto" }, overflow: { xs: "visible", md: "hidden" }, fontFamily: FONT }}>
      <Box sx={{ overflowY: { xs: "visible", md: "auto" }, height: { xs: "auto", md: "100%" }, borderRight: { md: `1px solid ${C.border}` } }}>
        {renderSidebar()}
      </Box>
      <Box sx={{ flex: 1, p: { xs: 2, md: 4 }, overflowY: { xs: "visible", md: "auto" }, height: { xs: "auto", md: "100%" } }}>
        {suspendedMessages.length > 0 && (
          <Box sx={{ bgcolor: "#fff3e0", color: "#e65100", p: 2, mb: 3, borderRadius: 1, border: "1px solid #ff9800", display: "flex", flexDirection: "column", gap: 0.5 }}>
            {suspendedMessages.map((msg, idx) => (
              <Typography key={idx} sx={{ fontWeight: FW_MEDIUM, fontSize: 13, display: "flex", alignItems: "center", gap: 1 }}>
                ⚠️ Warning: {msg}.
              </Typography>
            ))}
          </Box>
        )}
        {activeTab === "clinical-summary" && (
          <Box>
            <ClinicalSummaryTab
              patientId={patientId}
              doctorId={doctorId}
            />
          </Box>
        )}
        {activeTab === "common" && renderCommon()}
        {activeTab === "procedure" && (
          <RadiationTherapyWorkflow
            patientId={patientId}
            doctorId={doctorId}
            excludeTabs={["sessions", "qa", "notes", "summary", "staff"]}
            showFormTabs={true}
          />
        )}
        {activeTab === "ebrt" && renderEBRT()}
        {activeTab === "brachy" && renderBrachy()}
        {activeTab === "dicom" && (
          <Box>
            <Box sx={{ mb: 4, pb: 2, borderBottom: `1px solid ${C.black}` }}>
              <Typography sx={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: C.textMuted, mb: 1 }}>RT — Imaging</Typography>
              <Typography variant="h5" sx={{ fontFamily: FONT, fontWeight: FW_LIGHT, mb: 1 }}>Imaging Studies</Typography>
              <Typography sx={{ fontSize: 13, color: C.textSecond, maxWidth: 760, lineHeight: 1.6 }}>View DICOM images and studies.</Typography>
            </Box>
            <Box sx={{ mb: 3, border: `1px solid ${C.border}` }}>
              <Box sx={{ p: 2 }}>
                <DICOMViewer patientId={patientId} />
              </Box>
            </Box>
          </Box>
        )}
        {activeTab === "qa" && (
          <RadiationTherapyWorkflow
            patientId={patientId}
            doctorId={doctorId}
            excludeTabs={["patient", "baseline", "intent", "setup", "simulation", "treatment", "sessions", "imaging", "notes", "summary", "staff"]}
            defaultTab="qa"
            showFormTabs={true}
            hideVoiceDictation={true}
          />
        )}
        {activeTab === "summary-staff" && (
          <RadiationTherapyWorkflow
            patientId={patientId}
            doctorId={doctorId}
            excludeTabs={["patient", "baseline", "intent", "setup", "simulation", "treatment", "sessions", "imaging", "qa", "notes"]}
            defaultTab="summary"
            showFormTabs={true}
            hideVoiceDictation={true}
          />
        )}
        {activeTab === "discharge" && renderDischarge()}
        {activeTab === "referrals" && renderReferrals()}
        {activeTab === "total-discharge" && (
          <DischargeSummary
            patientId={patientId}
            doctorId={doctorId}
          />
        )}
      </Box>

      {/* ─── Patient Referrals Snackbar ─────────────────────────────────── */}
      <Snackbar
        open={!!referralSnack}
        autoHideDuration={4000}
        onClose={() => setReferralSnack("")}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert
          severity={referralSnack.toLowerCase().includes("fail") || referralSnack.toLowerCase().includes("please") ? "error" : "success"}
          sx={{ fontFamily: FONT, fontSize: 13 }}
          onClose={() => setReferralSnack("")}
        >
          {referralSnack}
        </Alert>
      </Snackbar>

      {/* ─── OTP Authorization Dialog (shared by EBRT & Brachy) ─────────── */}
      <Dialog open={!!otpDialog} onClose={closeOtpDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 16, fontWeight: FW_NORMAL }}>
          Authorize {otpDialog?.doctorLabel}
        </DialogTitle>
        <DialogContent>
          {otpStep === "send" ? (
            <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, mt: 1 }}>
              A one-time password will be sent to <strong>{otpDialog?.doctorLabel}</strong> to confirm their authorization. Click &quot;Send OTP&quot; to proceed.
            </Typography>
          ) : (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, mb: 2 }}>
                An OTP has been sent to <strong>{otpDialog?.doctorLabel}</strong>. Enter the code below to complete authorization.
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
                sx={inputStyle}
                size="small"
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
              sx={{ fontFamily: FONT, textTransform: "none", background: C.black, "&:hover": { background: "#1a1a1a" }, ...btnStyle }}
            >
              {otpSending ? "Sending…" : "Send OTP"}
            </Button>
          ) : (
            <Button
              onClick={handleVerifyOtp}
              disabled={!otpInput.trim()}
              variant="contained"
              sx={{ fontFamily: FONT, textTransform: "none", background: C.black, "&:hover": { background: "#1a1a1a" }, ...btnStyle }}
            >
              Verify & Approve
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <RadiotherapyProtocolSelector
        open={protocolDialogOpen}
        onClose={() => setProtocolDialogOpen(false)}
        patientId={patientId}
        doctorId={doctorId}
        apiBaseUrl={`${import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/"}`}
        onApplied={handleProtocolApplied}
      />
    </Box>
  );
};

export default RadiotherapyRecord;

