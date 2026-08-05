import React, { useState, useEffect } from "react";
import {
  Box,
  TextField,
  Select,
  MenuItem,
  IconButton,
  Button,
  Chip,
  Paper,
  Typography,
  FormControl,
  InputLabel,
  Dialog,
  DialogContent,
  DialogTitle,
  DialogActions
} from "@mui/material";
import {
  AddRounded,
  DeleteRounded,
  PictureAsPdfRounded,
  ScienceOutlined,
  LocalHospitalOutlined,
  Visibility,
  Close
} from "@mui/icons-material";
import jsPDF from "jspdf";
import { THEMES } from "../dashboard/themes";
/*
Add to index.html:
<link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet">
*/

const CATEGORY_OPTIONS    = ["Lab", "Imaging", "Other"];
const FASTING_OPTIONS     = ["Yes", "No", "Not specified"];
const PRIORITY_OPTIONS    = ["Routine", "Urgent", "STAT"];
const APPROPRIATENESS_OPTIONS = ["standard", "advanced", "unnecessary"];

const emptyInvestigation = {
  investigation_name:   "",
  parameters: [],
  category:             "",
  subcategory:          "",
  standard_indications: "",
  sample_type:          "",
  fasting_required:     "Not specified",
  priority:             "Routine",
  loinc_code:           "",
  loinc_name:           "",
  appropriateness_flag: "",
  flag_reason:          ""
};

// ─── PDF colour palette (monochrome) — UNCHANGED, PDF stays monochrome ──────
const C = {
  black:       [0,   0,   0  ],
  white:       [255, 255, 255],
  gray100:     [245, 245, 245],   // lightest tint – section backgrounds
  gray200:     [230, 230, 230],   // alternating row fill
  gray400:     [180, 180, 180],   // borders / rules
  gray600:     [110, 110, 110],   // muted labels
  gray800:     [45,  45,  45 ],   // body text
};

export default function InvestigationPanel({ data, onSave }) {
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";


const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme =  THEMES.PurpleWhite;
  // ─── Semantic theme tokens ─────────────────────────────────────────────
  const T = {
    bgPrimary: theme.bg,
    bgSecondary: theme.bgAlt,
    bgTertiary: theme.bgTert,

    textPrimary: theme.text,
    textSecondary: theme.textSec,
    textMuted: theme.textMuted,

    border: theme.border,
    borderStrong: theme.borderStr,

    accent: theme.accent,
    accentHover: theme.accentHover ?? theme.accent,
    accentInv: theme.bg,
  };

  const APPROPRIATENESS_COLORS = {
    standard:    { bg: T.bgPrimary,  text: T.textPrimary, border: T.border },
    advanced:    { bg: T.bgTertiary, text: T.textPrimary, border: T.borderStrong },
    unnecessary: { bg: T.accent,     text: T.accentInv,   border: T.accent }
  };

  const PRIORITY_COLORS = {
    Routine: { bg: T.bgPrimary,  text: T.textPrimary, border: T.border },
    Urgent:  { bg: T.bgTertiary, text: T.textPrimary, border: T.borderStrong },
    STAT:    { bg: T.accent,     text: T.accentInv,   border: T.accent }
  };

  const CATEGORY_COLORS = {
    Lab:     { bg: T.bgSecondary, icon: T.textPrimary },
    Imaging: { bg: T.bgSecondary, icon: T.textSecondary },
    Other:   { bg: T.bgSecondary, icon: T.textMuted }
  };

  const fieldSx = {
    "& .MuiOutlinedInput-root": {
      borderRadius: 0,
      fontFamily: "'Open Sans', sans-serif",
      fontWeight: 300,
      fontSize: "0.82rem",
      backgroundColor: T.bgPrimary,
      "& fieldset": { borderColor: T.border, borderWidth: "1px" },
      "&:hover fieldset": { borderColor: T.borderStrong },
      "&.Mui-focused fieldset": { borderColor: T.accent, borderWidth: "1px" }
    },
    "& .MuiInputLabel-root": {
      fontFamily: "'Open Sans', sans-serif",
      fontWeight: 300,
      fontSize: "0.78rem",
      color: T.textMuted,
      "&.Mui-focused": { color: T.accent }
    }
  };

  const getQueryParams = () => {
    const s = new URLSearchParams(window.location.search);
    return { doctor_id: s.get("doctor_id"), patient_id: s.get("patient_id") };
  };
  const { doctor_id, patient_id } = getQueryParams();

  const [investigations,  setInvestigations]  = useState([]);
  const [doctorInfo,      setDoctorInfo]       = useState({ name: "", specialization: "", hospital_name: "" });
  const [patientInfo,     setPatientInfo]      = useState({ patient_name: "", hms_id: "", age: "", gender: "" });
  const [previewOpen,     setPreviewOpen]      = useState(false);
  const [pdfUrl,          setPdfUrl]           = useState("");
  const [previewLoading,  setPreviewLoading]   = useState(false);

  const initializedRef = React.useRef(false);

  useEffect(() => {
    if (!initializedRef.current && data?.investigation_orders?.length > 0) {
      setInvestigations(
        data.investigation_orders.map(inv => ({
          investigation_name:   inv.investigation_name   || "",
           parameters: inv.parameters || [], 
          category:             inv.category             || "",
          subcategory:          inv.subcategory          || "",
          standard_indications: inv.standard_indications || "",
          sample_type:          inv.sample_type          || "",
          fasting_required:     inv.fasting_required     || "Not specified",
          priority:             inv.priority             || "Routine",
          loinc_code:           inv.loinc_code           || "",
          loinc_name:           inv.loinc_name           || "",
          appropriateness_flag: inv.appropriateness_flag || "",
          flag_reason:          inv.flag_reason          || ""
        }))
      );
      initializedRef.current = true;
    }
  }, [data]);

  useEffect(() => {
    if (!doctor_id) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/hms/users/data/context/get-doctor-info?sys_user_id=${doctor_id}`);
        if (!res.ok) throw new Error();
        setDoctorInfo(await res.json());
      } catch { console.error("Error fetching doctor info"); }
    })();
  }, [doctor_id]);

  useEffect(() => {
    if (!patient_id) return;
    (async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/hms/users/data/context/get-patient-info?patient_id=${patient_id}`);
        if (!res.ok) throw new Error();
        const r = await res.json();
        setPatientInfo({ patient_name: r.patient_name || "", hms_id: r.hms_id || "", age: r.age || "", gender: r.gender || "" });
      } catch { console.error("Error fetching patient info"); }
    })();
  }, [patient_id]);

  useEffect(() => { if (onSave) onSave({ investigation_orders: investigations }); }, [investigations]);

  const handleChange = (idx, field, val) => {
    const u = [...investigations]; u[idx][field] = val; setInvestigations(u);
  };
  const handleAdd    = ()    => setInvestigations([...investigations, { ...emptyInvestigation }]);
  const handleDelete = (idx) => setInvestigations(investigations.filter((_, i) => i !== idx));

  // ─── PDF GENERATION (UNCHANGED — remains monochrome, uses C palette) ────
  const generatePDFBlob = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4", compress: true });
    const PW = doc.internal.pageSize.getWidth();   // 297
    const PH = doc.internal.pageSize.getHeight();  // 210
    const M  = 14;   // margin
    const CW = PW - M * 2;
    let y = M;

    // ── helpers ──────────────────────────────────────────────────────────────
    const fill  = col => doc.setFillColor(...col);
    const ink   = col => doc.setTextColor(...col);
    const rule  = col => doc.setDrawColor(...col);
    const lw    = w   => doc.setLineWidth(w);
    const font  = (style, size) => { doc.setFont("helvetica", style); doc.setFontSize(size); };

    const text = (str, x, ty, { size = 9, style = "normal", color = C.gray800, align = "left", maxW = null } = {}) => {
      font(style, size);
      ink(color);
      const s = maxW ? doc.splitTextToSize(String(str), maxW)[0] : String(str);
      if      (align === "center") doc.text(s, x, ty, { align: "center" });
      else if (align === "right")  doc.text(s, x, ty, { align: "right" });
      else                         doc.text(s, x, ty);
    };

    // filled rectangle (no border)
    const fillRect = (x, ry, w, h, color) => {
      fill(color); doc.rect(x, ry, w, h, "F");
    };

    // outlined rectangle (no fill)
    const strokeRect = (x, ry, w, h, color, width = 0.25) => {
      rule(color); lw(width); doc.rect(x, ry, w, h, "S");
    };

    // horizontal rule
    const hRule = (ry, x1 = M, x2 = PW - M, color = C.gray400, width = 0.25) => {
      rule(color); lw(width); doc.line(x1, ry, x2, ry);
    };

    // label + value pair (stacked, small label above value)
    const labelValue = (label, value, x, ly, valueSize = 9) => {
      text(label, x, ly,      { size: 6, style: "normal", color: C.gray600 });
      text(value || "—", x, ly + 5, { size: valueSize, style: "normal", color: C.gray800 });
    };

    // pill badge (priority / flag)
    const badge = (label, x, by, fillColor, textColor, borderColor) => {
      font("normal", 6.5);
      const tw = doc.getTextWidth(label);
      const bw = tw + 5, bh = 4.5;
      fill(fillColor);   doc.rect(x, by, bw, bh, "F");
      rule(borderColor); lw(0.3); doc.rect(x, by, bw, bh, "S");
      ink(textColor);
      doc.text(label, x + bw / 2, by + 3.1, { align: "center" });
      return bw + 2;
    };

    // priority badge colours (monochrome)
    const priorityBadge = (priority, x, by) => {
      if (priority === "STAT")
        return badge(priority, x, by, C.black, C.white, C.black);
      if (priority === "Urgent")
        return badge(priority, x, by, C.gray200, C.black, C.gray600);
      return badge(priority, x, by, C.white, C.black, C.gray400);
    };

    // appropriateness badge colours
    const appBadge = (flag, x, by) => {
      if (!flag) return 0;
      const lbl = flag.toUpperCase();
      if (flag === "unnecessary")
        return badge(lbl, x, by, C.black, C.white, C.black);
      if (flag === "advanced")
        return badge(lbl, x, by, C.gray200, C.black, C.gray600);
      return badge(lbl, x, by, C.white, C.black, C.gray400);
    };

    // new page guard
    const needPage = (needed) => {
      if (y + needed > PH - M - 10) {
        doc.addPage(); y = M; return true;
      }
      return false;
    };

    // ── HEADER ───────────────────────────────────────────────────────────────
    // Top black bar
    fillRect(0, 0, PW, 7, C.black);

    // Hospital name
    text(
      (doctorInfo.hospital_name || "HOSPITAL NAME").toUpperCase(),
      PW / 2, 16,
      { size: 15, style: "bold", color: C.black, align: "center" }
    );

    // Thin rule under hospital name
    hRule(20, M, PW - M, C.gray400, 0.3);

    y = 25;

    // ── DOCUMENT TITLE BAND ───────────────────────────────────────────────────
    fillRect(M, y, CW, 10, C.black);
    text("INVESTIGATION ORDER FORM", M + 4, y + 6.5,
      { size: 11, style: "bold", color: C.white });

    const orderDate = new Date().toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
    const orderMeta = `Order #: ${Math.floor(Math.random() * 1000000)}   |   ${orderDate}`;
    text(orderMeta, PW - M - 2, y + 6.5,
      { size: 7, style: "normal", color: C.gray200, align: "right" });

    y += 13;

    // ── PATIENT INFO BLOCK ────────────────────────────────────────────────────
    text("PATIENT INFORMATION", M, y, { size: 7, style: "bold", color: C.gray600 });
    y += 3;
    fillRect(M, y, CW, 22, C.gray100);
    strokeRect(M, y, CW, 22, C.gray400, 0.25);

    // Row 1
    labelValue("PATIENT NAME",      patientInfo.patient_name || "—",  M + 3,  y + 5);
    labelValue("MRN / PATIENT ID",  patientInfo.hms_id       || "—",  M + 65, y + 5);
    labelValue("AGE / GENDER",
      patientInfo.age && patientInfo.gender ? `${patientInfo.age} / ${patientInfo.gender}` : "—",
      M + 120, y + 5);
    labelValue("DEPARTMENT",
      doctorInfo.specialization ? doctorInfo.specialization.toUpperCase() : "—",
      M + 175, y + 5);

    // Row 2
    labelValue("ORDERING PHYSICIAN",
      doctorInfo.name ? `Dr. ${doctorInfo.name}${doctorInfo.specialization ? ` (${doctorInfo.specialization})` : ""}` : "—",
      M + 3, y + 13);
    labelValue("ORDER DATE & TIME",
      new Date().toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      M + 65, y + 13);

    y += 26;

    // ── CLINICAL DIAGNOSIS BLOCK ──────────────────────────────────────────────
    text("CLINICAL DIAGNOSIS", M, y, { size: 7, style: "bold", color: C.gray600 });
    y += 3;
    strokeRect(M, y, CW, 18, C.gray400, 0.25);
    labelValue("PROVISIONAL DIAGNOSIS", "____________________________________________________________", M + 3, y + 4, 8);
    labelValue("CONFIRMED DIAGNOSIS",   "____________________________________________________________", M + 3, y + 12, 8);
    y += 22;

    // ── INVESTIGATION TABLE ───────────────────────────────────────────────────
    text("INVESTIGATION LIST", M, y, { size: 7, style: "bold", color: C.gray600 });
    y += 3;

    // Column layout  (x positions relative to M)
    // #   | Test Name     | LOINC Code | Category | Priority | Flag | Sample / Fasting | Indication     | Flag Reason
    // 0     8               60           88         106        124    140                 170              215
    const COL = {
      num:       M + 2,
      name:      M + 8,
      loinc:     M + 60,
      category:  M + 88,
      priority:  M + 106,
      appFlag:   M + 126,
      sample:    M + 148,
      indication:M + 172,
      flagReason:M + 218,
    };
    const COL_W = {
      name:       50,
      loinc:      26,
      category:   16,
      indication: 44,
      flagReason: 40,
    };

    // Header row
    fillRect(M, y, CW, 7, C.black);
    const TH = [
      ["#",          COL.num      ],
      ["TEST NAME",  COL.name     ],
      ["LOINC",      COL.loinc    ],
      ["CAT.",       COL.category ],
      ["PRIORITY",   COL.priority ],
      ["FLAG",       COL.appFlag  ],
      ["SAMPLE / FASTING", COL.sample   ],
      ["INDICATION", COL.indication],
      ["FLAG REASON",COL.flagReason],
    ];
    TH.forEach(([label, x]) =>
      text(label, x, y + 4.8, { size: 5.5, style: "bold", color: C.white })
    );
    y += 7;

    investigations.forEach((inv, idx) => {
      const ROW_H = 11;
      needPage(ROW_H + 4);

      // Alternating fill
      if (idx % 2 === 0) fillRect(M, y, CW, ROW_H, C.gray100);
      strokeRect(M, y, CW, ROW_H, C.gray400, 0.2);

      // Left accent bar for STAT / Urgent
      if (inv.priority === "STAT") {
        fillRect(M, y, 1.5, ROW_H, C.black);
      } else if (inv.priority === "Urgent") {
        fillRect(M, y, 1.5, ROW_H, C.gray600);
      }

      const ry = y + 4.2;   // baseline for primary row text
      const ry2 = y + 7.8;  // second line if needed

      // #
      text(String(idx + 1), COL.num, ry, { size: 7, style: "bold", color: C.gray600 });

      // Test name (up to 2 lines)
      const investigationText =
  inv.parameters?.length > 0
    ? `${inv.investigation_name}\n(${inv.parameters.join(", ")})`
    : inv.investigation_name || "—";

const nameLines = doc.splitTextToSize(
  investigationText,
  COL_W.name
);
      font("normal", 7.5); ink(C.gray800);
      doc.text(nameLines[0] || "", COL.name, ry);
      if (nameLines[1]) doc.text(nameLines[1], COL.name, ry2);

      // LOINC code + name stacked
      text(inv.loinc_code  || "—",  COL.loinc, ry,  { size: 7, color: C.gray800 });
      text(inv.loinc_name  || "",   COL.loinc, ry2, { size: 6, color: C.gray600, maxW: COL_W.loinc });

      // Category
      text(inv.category    || "—",  COL.category, ry, { size: 7, color: C.gray800 });

      // Priority badge
      priorityBadge(inv.priority || "Routine", COL.priority, y + 2.5);

      // Appropriateness badge
      appBadge(inv.appropriateness_flag, COL.appFlag, y + 2.5);

      // Sample / fasting
      const sampleParts = [];
      if (inv.sample_type)                        sampleParts.push(inv.sample_type);
      if (inv.fasting_required === "Yes")         sampleParts.push("Fasting");
      else if (inv.fasting_required === "No")     sampleParts.push("Non-fasting");
      text(sampleParts.join(" · ") || "—", COL.sample, ry, { size: 6.5, color: C.gray800 });

      // Indication (2 lines)
      const indLines = doc.splitTextToSize(inv.standard_indications || "—", COL_W.indication);
      font("normal", 6.5); ink(C.gray800);
      doc.text(indLines[0] || "", COL.indication, ry);
      if (indLines[1]) doc.text(indLines[1], COL.indication, ry2);

      // Flag reason (2 lines)
      if (inv.flag_reason) {
        const frLines = doc.splitTextToSize(inv.flag_reason, COL_W.flagReason);
        font("normal", 6); ink(C.gray600);
        doc.text(frLines[0] || "", COL.flagReason, ry);
        if (frLines[1]) doc.text(frLines[1], COL.flagReason, ry2);
      }

      y += ROW_H;
    });

    // Bottom rule under table
    hRule(y, M, PW - M, C.black, 0.4);
    y += 4;

    // ── SUMMARY ROW ───────────────────────────────────────────────────────────
    needPage(10);
    const total   = investigations.length;
    const routine = investigations.filter(i => i.priority === "Routine").length;
    const urgent  = investigations.filter(i => i.priority === "Urgent").length;
    const stat    = investigations.filter(i => i.priority === "STAT").length;

    text(`Total: ${total}   Routine: ${routine}   Urgent: ${urgent}   STAT: ${stat}`,
      M, y + 4, { size: 7, style: "normal", color: C.gray600 });

    // ── SIGNATURE BLOCK ───────────────────────────────────────────────────────
    needPage(22);
    y += 10;
    hRule(y, PW - M - 55, PW - M - 5, C.black, 0.4);
    text("Physician Signature",         PW - M - 30, y + 4,  { size: 6.5, color: C.gray600, align: "center" });
    text(doctorInfo.name ? `Dr. ${doctorInfo.name}` : "",
      PW - M - 30, y + 9,  { size: 7,   color: C.gray800, align: "center" });

    // ── FOOTER (all pages) ────────────────────────────────────────────────────
    const totalPages = doc.internal.getNumberOfPages();
    for (let p = 1; p <= totalPages; p++) {
      doc.setPage(p);

      // Bottom bar
      fillRect(0, PH - 8, PW, 8, C.black);

      text("CONFIDENTIAL MEDICAL DOCUMENT — FOR INTERNAL USE ONLY",
        PW / 2, PH - 3.5, { size: 5.5, style: "normal", color: C.gray400, align: "center" });

      text(`Generated: ${new Date().toLocaleString()}`,
        M, PH - 3.5, { size: 5.5, color: C.gray400 });

      text(`Page ${p} of ${totalPages}`,
        PW - M, PH - 3.5, { size: 5.5, color: C.gray400, align: "right" });
    }

    return doc.output("blob");
  };
  // ─── end generatePDFBlob ─────────────────────────────────────────────────

  const generatePDF = () => {
    const blob = generatePDFBlob();
    const fileName = `Investigation_Order_${new Date().toISOString().split("T")[0]}_${Math.floor(Math.random() * 10000)}.pdf`;
    const url  = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = fileName;
    document.body.appendChild(link); link.click();
    document.body.removeChild(link); URL.revokeObjectURL(url);
  };

  const generatePreview = async () => {
    setPreviewLoading(true);
    try {
      const blob = generatePDFBlob();
      setPdfUrl(URL.createObjectURL(blob));
      setPreviewOpen(true);
    } catch (e) { console.error(e); }
    finally { setPreviewLoading(false); }
  };

  const handlePreviewClose = () => {
    setPreviewOpen(false);
    if (pdfUrl) { URL.revokeObjectURL(pdfUrl); setPdfUrl(""); }
  };

  // ─── UI helpers ──────────────────────────────────────────────────────────
  const getPriorityChipProps = (priority) => {
    const c = PRIORITY_COLORS[priority] || PRIORITY_COLORS["Routine"];
    return {
      label: priority, size: "small",
      sx: {
        backgroundColor: c.bg, color: c.text, border: `1px solid ${c.border}`,
        borderRadius: 0, fontFamily: "'Open Sans', sans-serif",
        fontWeight: 400, fontSize: "0.6rem", letterSpacing: "0.1em",
        textTransform: "uppercase", height: "22px"
      }
    };
  };

  const btnBase = {
    textTransform: "none", borderRadius: 0,
    fontFamily: "'Open Sans', sans-serif", fontWeight: 400,
    fontSize: "0.78rem", letterSpacing: "0.02em",
    boxShadow: "none", "&:hover": { boxShadow: "none" }
  };

  // ─── RENDER ──────────────────────────────────────────────────────────────
  return (
    <>
      {investigations.length === 0 ? (
  <Paper
    elevation={0}
    sx={{
      p: 3,
      textAlign: "center",
      border: `1px solid ${T.borderStrong}`,
      borderRadius: 0,
      backgroundColor: T.bgPrimary
    }}
  >
    <Typography
      sx={{
        fontFamily: "'Open Sans', sans-serif",
        color: T.textMuted
      }}
    >
      No investigations provided.
    </Typography>
  </Paper>
) : (
  <Paper
    elevation={0}
    sx={{
      fontFamily: "'Open Sans', sans-serif",
      fontWeight: 300,
      p: 3,
      background: T.bgPrimary,
      border: `1px solid ${T.borderStrong}`,
      borderRadius: 0
    }}
  >

          {/* Header */}
          <Box sx={{ mb: 3, pb: 1.5, borderBottom: `2px solid ${T.borderStrong}` }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
              <LocalHospitalOutlined sx={{ color: T.textPrimary, fontSize: 20 }} />
              <Typography variant="h6" sx={{
                fontFamily: "'Open Sans', sans-serif", fontWeight: 600,
                color: T.textPrimary, letterSpacing: "-0.01em", fontSize: "1.05rem"
              }}>
                Investigation Orders
              </Typography>
            </Box>
            <Typography variant="body2" sx={{
              fontFamily: "'Open Sans', sans-serif", fontWeight: 300,
              color: T.textMuted, fontSize: "0.75rem", letterSpacing: "0.02em"
            }}>
              Laboratory &amp; Diagnostic Imaging Requests
            </Typography>
          </Box>

          {/* Action buttons */}
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 3, gap: 2 }}>
            <Button startIcon={<AddRounded sx={{ fontSize: "16px !important" }} />}
              variant="outlined" onClick={handleAdd}
              sx={{ ...btnBase, borderColor: T.borderStrong, borderWidth: "1px", color: T.textPrimary,
                "&:hover": { borderColor: T.borderStrong, borderWidth: "1px", backgroundColor: T.bgTertiary, boxShadow: "none" } }}>
              Add Investigation
            </Button>
            <Box sx={{ display: "flex", gap: 1.5 }}>
              <Button startIcon={<Visibility sx={{ fontSize: "16px !important" }} />}
                variant="outlined" onClick={generatePreview} disabled={previewLoading}
                sx={{ ...btnBase, borderColor: T.borderStrong, borderWidth: "1px", color: T.textPrimary,
                  "&:hover": { borderColor: T.borderStrong, borderWidth: "1px", backgroundColor: T.bgTertiary, boxShadow: "none" } }}>
                {previewLoading ? "Generating..." : "Preview PDF"}
              </Button>
              <Button startIcon={<PictureAsPdfRounded sx={{ fontSize: "16px !important" }} />}
                variant="contained" onClick={generatePDF}
                sx={{ ...btnBase, backgroundColor: T.accent, color: T.accentInv, border: `1px solid ${T.accent}`,
                  "&:hover": { backgroundColor: T.accentHover, boxShadow: "none" } }}>
                Generate Order Form
              </Button>
            </Box>
          </Box>

          {/* Investigation cards */}
          <Box>
            {investigations.map((inv, index) => (
              <Paper key={index} elevation={0} sx={{
                mb: 1.5, p: 2,
                border: `1px solid ${T.border}`, borderRadius: 0,
                backgroundColor: index % 2 === 0 ? T.bgSecondary : T.bgPrimary,
                transition: "border-color 0.15s ease",
                "&:hover": { borderColor: T.borderStrong },
                position: "relative"
              }}>

                {/* Card header row */}
                <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                    <Box sx={{
                      width: 28, height: 28, backgroundColor: T.accent,
                      display: "flex", alignItems: "center", justifyContent: "center",
                      color: T.accentInv, fontFamily: "'Open Sans', sans-serif",
                      fontWeight: 400, fontSize: "0.75rem"
                    }}>
                      {index + 1}
                    </Box>
                    <Chip {...getPriorityChipProps(inv.priority)} />
                    {inv.fasting_required === "Yes" && (
                      <Chip label="Fasting Required" size="small"
                        icon={<ScienceOutlined sx={{ fontSize: "12px !important", color: `${T.textPrimary} !important` }} />}
                        sx={{
                          backgroundColor: T.bgTertiary, color: T.textPrimary,
                          border: `1px solid ${T.border}`, borderRadius: 0,
                          fontFamily: "'Open Sans', sans-serif", fontWeight: 400,
                          fontSize: "0.6rem", letterSpacing: "0.08em",
                          textTransform: "uppercase", height: "22px"
                        }} />
                    )}
                    {inv.appropriateness_flag && (
                      <Chip label={inv.appropriateness_flag.toUpperCase()} size="small"
                        sx={{
                          backgroundColor: APPROPRIATENESS_COLORS[inv.appropriateness_flag]?.bg || T.bgTertiary,
                          color:           APPROPRIATENESS_COLORS[inv.appropriateness_flag]?.text || T.textPrimary,
                          border: `1px solid ${APPROPRIATENESS_COLORS[inv.appropriateness_flag]?.border || T.border}`,
                          borderRadius: 0, fontFamily: "'Open Sans', sans-serif",
                          fontWeight: 400, fontSize: "0.6rem", letterSpacing: "0.1em", height: "22px"
                        }} />
                    )}
                  </Box>
                  <IconButton size="small" onClick={() => handleDelete(index)}
                    sx={{ borderRadius: 0, color: T.textPrimary, "&:hover": { backgroundColor: T.bgTertiary } }}>
                    <DeleteRounded sx={{ fontSize: 18 }} />
                  </IconButton>
                </Box>

                {/* Row 1 */}
                <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 1.5 }}>
                  <TextField label="Investigation Name" size="small" fullWidth
                    value={inv.investigation_name}
                    onChange={e => handleChange(index, "investigation_name", e.target.value)}
                    sx={fieldSx} />
                  <FormControl size="small" fullWidth sx={fieldSx}>
                    <InputLabel>Category</InputLabel>
                    <Select value={inv.category} label="Category"
                      onChange={e => handleChange(index, "category", e.target.value)}
                      sx={{ borderRadius: 0 }}>
                      {CATEGORY_OPTIONS.map(opt => (
                        <MenuItem key={opt} value={opt}
                          sx={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.82rem" }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Box sx={{ width: 7, height: 7, backgroundColor: CATEGORY_COLORS[opt]?.icon || T.textMuted }} />
                            {opt}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <TextField label="Subcategory" size="small" fullWidth
                    value={inv.subcategory}
                    onChange={e => handleChange(index, "subcategory", e.target.value)}
                    sx={fieldSx} />
                </Box>

                {/* Parameters */}
                <Box sx={{ mt: 1.5 }}>
                  <TextField
                    label="Parameters"
                    size="small"
                    fullWidth
                    value={(inv.parameters || []).join(", ")}
                    onChange={(e) =>
                      handleChange(
                        index,
                        "parameters",
                        e.target.value
                          .split(",")
                          .map((p) => p.trim())
                          .filter(Boolean)
                      )
                    }
                    placeholder="Hemoglobin, Hematocrit, WBC, Platelet Count"
                    sx={fieldSx}
                  />
                </Box>

                {/* Row 2 */}
                <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 1.5, mt: 1.5 }}>
                  <TextField label="Clinical Indications" size="small" fullWidth multiline rows={2}
                    value={inv.standard_indications}
                    onChange={e => handleChange(index, "standard_indications", e.target.value)}
                    sx={fieldSx} />
                  <FormControl size="small" fullWidth sx={fieldSx}>
                    <InputLabel>Fasting Required</InputLabel>
                    <Select value={inv.fasting_required} label="Fasting Required"
                      onChange={e => handleChange(index, "fasting_required", e.target.value)}
                      sx={{ borderRadius: 0 }}>
                      {FASTING_OPTIONS.map(opt => (
                        <MenuItem key={opt} value={opt}
                          sx={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.82rem" }}>
                          {opt}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                  <FormControl size="small" fullWidth sx={fieldSx}>
                    <InputLabel>Priority Level</InputLabel>
                    <Select value={inv.priority} label="Priority Level"
                      onChange={e => handleChange(index, "priority", e.target.value)}
                      sx={{ borderRadius: 0 }}>
                      {PRIORITY_OPTIONS.map(opt => (
                        <MenuItem key={opt} value={opt}
                          sx={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.82rem" }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Box sx={{ width: 7, height: 7,
                              backgroundColor: opt === "STAT" ? T.accent : opt === "Urgent" ? T.textSecondary : T.textMuted }} />
                            {opt}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

                {/* Row 3 */}
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 1.5 }}>
                  <TextField label="LOINC Name" size="small" fullWidth
                    value={inv.loinc_name || ""}
                    onChange={e => handleChange(index, "loinc_name", e.target.value)}
                    placeholder="e.g., Complete Blood Count" sx={fieldSx} />
                  <FormControl size="small" fullWidth sx={fieldSx}>
                    <InputLabel>Appropriateness Flag</InputLabel>
                    <Select value={inv.appropriateness_flag || ""} label="Appropriateness Flag"
                      onChange={e => handleChange(index, "appropriateness_flag", e.target.value)}
                      sx={{ borderRadius: 0 }}>
                      <MenuItem value=""
                        sx={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.82rem" }}>
                        None
                      </MenuItem>
                      {APPROPRIATENESS_OPTIONS.map(opt => (
                        <MenuItem key={opt} value={opt}
                          sx={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 300, fontSize: "0.82rem" }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <Box sx={{ width: 7, height: 7,
                              backgroundColor: opt === "unnecessary" ? T.accent : opt === "advanced" ? T.textSecondary : T.textMuted }} />
                            {opt.charAt(0).toUpperCase() + opt.slice(1)}
                          </Box>
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Box>

                {/* Flag reason */}
                {inv.appropriateness_flag && (
                  <Box sx={{ mt: 1.5 }}>
                    <TextField label="Flag Reason" size="small" fullWidth multiline rows={2}
                      value={inv.flag_reason || ""}
                      onChange={e => handleChange(index, "flag_reason", e.target.value)}
                      placeholder="Reason for appropriateness flag"
                      sx={{
                        ...fieldSx,
                        "& .MuiOutlinedInput-root": {
                          ...fieldSx["& .MuiOutlinedInput-root"],
                          backgroundColor:
                            inv.appropriateness_flag === "unnecessary" ? T.bgTertiary :
                            inv.appropriateness_flag === "advanced"    ? T.bgSecondary : T.bgPrimary
                        }
                      }} />
                  </Box>
                )}

                {/* Row 4 */}
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mt: 1.5 }}>
                  <TextField label="LOINC Code" size="small" fullWidth
                    value={inv.loinc_code || ""}
                    onChange={e => handleChange(index, "loinc_code", e.target.value)}
                    placeholder="e.g., 15074-8" sx={fieldSx} />
                  <TextField label="Sample Type" size="small" fullWidth
                    value={inv.sample_type}
                    onChange={e => handleChange(index, "sample_type", e.target.value)}
                    placeholder="e.g., Blood, Urine, CSF" sx={fieldSx} />
                </Box>
              </Paper>
            ))}
          </Box>

          {/* Summary footer */}
          <Box sx={{ mt: 2.5, p: 1.5, backgroundColor: T.bgSecondary, border: `1px solid ${T.borderStrong}` }}>
            <Typography variant="body2" sx={{
              fontFamily: "'Open Sans', sans-serif", fontWeight: 600, color: T.textPrimary,
              mb: 0.75, fontSize: "0.72rem", textTransform: "uppercase", letterSpacing: "0.1em"
            }}>
              Order Summary
            </Typography>
            <Box sx={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {[
                { label: "Total",   value: investigations.length,                                        color: T.textPrimary },
                { label: "Routine", value: investigations.filter(i => i.priority === "Routine").length,  color: T.textSecondary },
                { label: "Urgent",  value: investigations.filter(i => i.priority === "Urgent").length,   color: T.textSecondary },
                { label: "STAT",    value: investigations.filter(i => i.priority === "STAT").length,     color: T.textPrimary }
              ].map(({ label, value, color }) => (
                <Typography key={label} variant="body2" sx={{
                  fontFamily: "'Open Sans', sans-serif", fontWeight: 300,
                  color: T.textMuted, fontSize: "0.78rem"
                }}>
                  {label}: <strong style={{ fontWeight: 600, color }}>{value}</strong>
                </Typography>
              ))}
            </Box>
          </Box>
        </Paper>
      )}

      {/* PDF Preview Dialog */}
      <Dialog open={previewOpen} onClose={handlePreviewClose} maxWidth="xl" fullWidth
        PaperProps={{ sx: { width: "90vw", height: "90vh", maxWidth: "none", borderRadius: 0, border: `1px solid ${T.borderStrong}` } }}>

        <DialogTitle sx={{
          backgroundColor: T.accent, color: T.accentInv,
          display: "flex", justifyContent: "space-between", alignItems: "center",
          fontFamily: "'Open Sans', sans-serif", fontWeight: 400, fontSize: "0.9rem", py: 1.5
        }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <PictureAsPdfRounded sx={{ fontSize: 18 }} />
            <Typography variant="body1" sx={{
              fontFamily: "'Open Sans', sans-serif", fontWeight: 400, fontSize: "0.88rem"
            }}>
              PDF Preview — Investigation Order Form
            </Typography>
          </Box>
          <IconButton onClick={handlePreviewClose}
            sx={{ color: T.accentInv, borderRadius: 0, "&:hover": { backgroundColor: T.accentHover } }}>
            <Close sx={{ fontSize: 18 }} />
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ p: 0, height: "calc(100% - 64px)" }}>
          {pdfUrl
            ? <iframe src={pdfUrl} title="PDF Preview" width="100%" height="100%" style={{ border: "none" }} />
            : <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "100%" }}>
                <Typography sx={{ fontFamily: "'Open Sans', sans-serif", fontWeight: 300, color: T.textMuted }}>
                  Generating preview...
                </Typography>
              </Box>
          }
        </DialogContent>

        <DialogActions sx={{ p: 1.5, backgroundColor: T.bgSecondary, borderTop: `1px solid ${T.border}` }}>
          <Button onClick={handlePreviewClose}
            sx={{ ...btnBase, color: T.textMuted, "&:hover": { backgroundColor: T.bgTertiary, boxShadow: "none" } }}>
            Close
          </Button>
          <Button variant="contained" onClick={generatePDF}
            startIcon={<PictureAsPdfRounded sx={{ fontSize: "16px !important" }} />}
            sx={{ ...btnBase, backgroundColor: T.accent, color: T.accentInv, border: `1px solid ${T.accent}`,
              "&:hover": { backgroundColor: T.accentHover, boxShadow: "none" } }}>
            Download PDF
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}