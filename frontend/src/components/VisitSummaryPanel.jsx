import React, { useEffect, useState, useRef } from "react";
import {
  Box,
  Typography,
  CircularProgress,
  IconButton,
  Tooltip,
  Divider,
  TextField,
  Chip,
  Stack,
  Button,
} from "@mui/material";

import {
  RefreshRounded,
  EditRounded,
  SaveRounded,
  CloseRounded,
  DownloadRounded,
  DeleteOutlineRounded,
  AddRounded,
  PersonRounded,
  LocalHospitalRounded,
  DescriptionRounded,
  AssignmentRounded,
  FactCheckRounded,
  EventAvailableRounded,
} from "@mui/icons-material";

import jsPDF from "jspdf";
import html2canvas from "html2canvas";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ============================================================
// DESIGN TOKENS — formal black & white clinical-record system
// ============================================================
// A printed hospital chart is the reference: black rules on white
// stock, a serif masthead for the record title, uppercase tracked
// labels for section eyebrows, and a monospaced-feeling data type
// for values. No color accent — contrast and rule-weight do all
// the work, the way a real OPD summary sheet would.

const FONT_DISPLAY = '"Georgia", "Times New Roman", serif';
const FONT = '"Open Sans", "Helvetica Neue", sans-serif';
const FONT_MONO = '"IBM Plex Mono", "Courier New", monospace';

const INK = "#0F0F0F";          // primary text / strong rules
const INK_SUB = "#5B5B5B";      // secondary text
const INK_FAINT = "#9A9A9A";    // tertiary / captions
const LINE_STRONG = "#111111";
const LINE_SOFT = "#DCDCDC";
const PAPER = "#FFFFFF";
const SURFACE = "#F6F6F5";      // faint stone-gray fill, still B/W

// ============================================================
// DEEP VALUE HELPER (for generic editing of nested data)
// ============================================================

function setDeepValue(obj, path, value) {
  if (path.length === 0) return value;
  const [key, ...rest] = path;
  if (Array.isArray(obj)) {
    const newArr = [...obj];
    newArr[key] = setDeepValue(obj[key], rest, value);
    return newArr;
  }
  return {
    ...(obj || {}),
    [key]: setDeepValue(obj ? obj[key] : undefined, rest, value),
  };
}

// ============================================================
// INLINE MARKDOWN — **bold** support
// ============================================================
// Clinicians dictate emphasis with **double asterisks**. We parse
// that into real bold spans wherever free text is rendered
// read-only. Editable fields keep the raw "**text**" so it stays
// obvious and editable as plain text.

function renderInlineMarkdown(text, keyPrefix = "b") {
  if (typeof text !== "string") return text;
  if (!text.includes("**")) return text;

  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <Box
          key={`${keyPrefix}-${i}`}
          component="strong"
          sx={{ fontWeight: 800, color: INK }}
        >
          {part.slice(2, -2)}
        </Box>
      );
    }
    return <React.Fragment key={`${keyPrefix}-${i}`}>{part}</React.Fragment>;
  });
}

// ============================================================
// SECTION META (icon + label per key)
// ============================================================

const SECTION_ICONS = {
  patient_demographics: PersonRounded,
  confirmed_diagnoses: LocalHospitalRounded,
  clinical_summary: DescriptionRounded,
  clinical_examination: FactCheckRounded,
  assessment: AssignmentRounded,
  plan: AssignmentRounded,
  next_visit: EventAvailableRounded,
};

// Two-digit record markers — a real chart numbers its sections in
// the order a clinician reads them, so the numbering is functional
// here, not decorative.
const SECTION_ORDER = [
  "patient_demographics",
  "confirmed_diagnoses",
  "clinical_summary",
  "clinical_examination",
  "assessment",
  "plan",
  "next_visit",
];

const SectionCard = ({ icon: Icon, title, index, subtitle, children, dense = false }) => (
  <Box
    sx={{
      border: `1px solid ${LINE_SOFT}`,
      borderTop: `2px solid ${LINE_STRONG}`,
      mb: 2,
      background: PAPER,
    }}
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1.2,
        px: 2.5,
        py: 1.4,
        background: SURFACE,
        borderBottom: `1px solid ${LINE_SOFT}`,
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.2 }}>
        {typeof index === "number" && (
          <Typography
            sx={{
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: INK_FAINT,
              fontWeight: 600,
              width: 18,
            }}
          >
            {String(index + 1).padStart(2, "0")}
          </Typography>
        )}
        {Icon && (
          <Box
            sx={{
              width: 26,
              height: 26,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: PAPER,
              border: `1px solid ${INK}`,
            }}
          >
            <Icon sx={{ fontSize: 14, color: INK }} />
          </Box>
        )}
        <Box>
          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 700,
              color: INK,
              textTransform: "uppercase",
              letterSpacing: "0.09em",
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: INK_SUB, mt: 0.2 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
      </Box>
    </Box>
    <Box sx={{ p: dense ? 2 : 2.5 }}>{children}</Box>
  </Box>
);

// ============================================================
// READ-ONLY VALUE RENDERER
// ============================================================

const renderValue = (value, keyPrefix = "v") => {
  if (value === null || value === undefined || value === "") return null;

  if (Array.isArray(value)) {
    return (
      <Stack spacing={1}>
        {value.map((item, index) => (
          <Box key={index} sx={{ display: "flex", gap: 1, alignItems: "flex-start" }}>
            <Box
              sx={{
                width: 4,
                height: 4,
                mt: "9px",
                flexShrink: 0,
                background: INK,
              }}
            />
            <Typography sx={{ fontFamily: FONT, fontSize: 13, lineHeight: 1.65, color: INK }}>
              {typeof item === "object"
                ? JSON.stringify(item, null, 2)
                : renderInlineMarkdown(String(item), `${keyPrefix}-${index}`)}
            </Typography>
          </Box>
        ))}
      </Stack>
    );
  }

  if (typeof value === "object") {
    return (
      <Stack spacing={1.5}>
        {Object.entries(value).map(([key, val]) => (
          <Box key={key}>
            <Typography
              sx={{
                fontFamily: FONT_MONO,
                fontSize: 9.5,
                color: INK_SUB,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                mb: 0.4,
                fontWeight: 700,
              }}
            >
              {key.replace(/_/g, " ")}
            </Typography>
            {renderValue(val, `${keyPrefix}-${key}`)}
          </Box>
        ))}
      </Stack>
    );
  }

  return (
    <Typography
      sx={{ fontFamily: FONT, fontSize: 13.5, lineHeight: 1.85, color: INK, whiteSpace: "pre-wrap" }}
    >
      {renderInlineMarkdown(String(value), keyPrefix)}
    </Typography>
  );
};

// ============================================================
// EDITABLE VALUE RENDERER (mirrors renderValue, but writable)
// ============================================================

const EditableValue = ({ value, path, onChange }) => {
  if (Array.isArray(value)) {
    return (
      <Stack spacing={1}>
        {value.map((item, index) =>
          typeof item === "object" && item !== null ? (
            <Box key={index} sx={{ border: `1px solid ${LINE_SOFT}`, p: 1.5, position: "relative" }}>
              <EditableValue value={item} path={[...path, index]} onChange={onChange} />
              <IconButton
                size="small"
                onClick={() => onChange(path, value.filter((_, i) => i !== index))}
                sx={{ position: "absolute", top: 4, right: 4, borderRadius: 0 }}
              >
                <DeleteOutlineRounded sx={{ fontSize: 15, color: INK_SUB }} />
              </IconButton>
            </Box>
          ) : (
            <Box key={index} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
              <TextField
                fullWidth
                size="small"
                value={item ?? ""}
                onChange={(e) => onChange([...path, index], e.target.value)}
                sx={{
                  "& .MuiInputBase-input": { fontFamily: FONT, fontSize: 13, color: INK },
                  "& .MuiOutlinedInput-root": {
                    borderRadius: 0,
                    "& fieldset": { borderColor: LINE_SOFT },
                    "&:hover fieldset": { borderColor: INK },
                    "&.Mui-focused fieldset": { borderColor: INK, borderWidth: "1px" },
                  },
                }}
              />
              <IconButton
                size="small"
                onClick={() => onChange(path, value.filter((_, i) => i !== index))}
                sx={{ borderRadius: 0 }}
              >
                <DeleteOutlineRounded sx={{ fontSize: 16, color: INK_SUB }} />
              </IconButton>
            </Box>
          )
        )}
        <Button
          size="small"
          startIcon={<AddRounded sx={{ fontSize: 15 }} />}
          onClick={() => onChange(path, [...value, ""])}
          sx={{
            fontFamily: FONT,
            fontSize: 11.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            alignSelf: "flex-start",
            color: INK,
            borderRadius: 0,
          }}
        >
          Add item
        </Button>
      </Stack>
    );
  }

  if (typeof value === "object" && value !== null) {
    return (
      <Stack spacing={1.5}>
        {Object.entries(value).map(([key, val]) => (
          <Box key={key}>
            <Typography
              sx={{
                fontFamily: FONT_MONO,
                fontSize: 9.5,
                color: INK_SUB,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                mb: 0.4,
                fontWeight: 700,
              }}
            >
              {key.replace(/_/g, " ")}
            </Typography>
            <EditableValue value={val} path={[...path, key]} onChange={onChange} />
          </Box>
        ))}
      </Stack>
    );
  }

  return (
    <TextField
      fullWidth
      multiline
      size="small"
      placeholder="Use **word** to bold a term"
      value={value ?? ""}
      onChange={(e) => onChange(path, e.target.value)}
      sx={{
        "& .MuiInputBase-input": { fontFamily: FONT, fontSize: 13.5, color: INK },
        "& .MuiOutlinedInput-root": {
          borderRadius: 0,
          "& fieldset": { borderColor: LINE_SOFT },
          "&:hover fieldset": { borderColor: INK },
          "&.Mui-focused fieldset": { borderColor: INK, borderWidth: "1px" },
        },
      }}
    />
  );
};

// ============================================================
// MAIN COMPONENT
// ============================================================

const VisitSummaryPanel = ({ patientId, doctorId, dictation = "" }) => {
  const [summary, setSummary] = useState(null);
  const [editedSummary, setEditedSummary] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");

  const printRef = useRef(null);

  // ============================================================
  // GENERATE VISIT SUMMARY
  // ============================================================

  const generateVisitSummary = async () => {
    if (!patientId) {
      setError("Patient ID is required.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/context/generate-visit-summary`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId || null,
          dictation: dictation || "",
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result?.detail || result?.message || "Failed to generate visit summary.");
      }

      if (result?.status !== "success") {
        throw new Error(result?.message || "Visit summary generation failed.");
      }

      setSummary(result.data || null);
      setIsEditing(false);
    } catch (err) {
      console.error("Visit summary generation failed:", err);
      setError(err?.message || "Unable to generate visit summary.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (patientId) generateVisitSummary();
  }, [patientId]);

  const handleRefresh = () => generateVisitSummary();

  // ============================================================
  // EDIT / SAVE
  // ============================================================

  const handleStartEdit = () => {
    setEditedSummary(JSON.parse(JSON.stringify(summary)));
    setIsEditing(true);
  };

  const handleCancelEdit = () => {
    setEditedSummary(null);
    setIsEditing(false);
  };

  const handleFieldChange = (path, value) => {
    setEditedSummary((prev) => setDeepValue(prev, path, value));
  };

  // NOTE: assumes a save endpoint mirroring the generate endpoint.
  // Adjust the path below if your backend uses a different route.
  const handleSaveEdit = async () => {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/update-visit-summary`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId || null,
          summary: editedSummary,
        }),
      });

      const result = await response.json().catch(() => null);

      if (!response.ok || (result && result.status && result.status !== "success")) {
        throw new Error(result?.detail || result?.message || "Failed to save changes.");
      }

      setSummary(editedSummary);
      setIsEditing(false);
    } catch (err) {
      console.error("Saving visit summary failed:", err);
      // Fall back to a local-only save so edits aren't lost, but surface the error.
      setSummary(editedSummary);
      setIsEditing(false);
      setError("Changes saved locally, but syncing to the server failed: " + (err?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  // ============================================================
  // DOWNLOAD PDF
  // ============================================================

  const handleDownloadPdf = async () => {
    if (!printRef.current) return;
    setDownloading(true);

    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
      });

      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pageWidth;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;

      let heightLeft = imgHeight;
      let position = 0;

      pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
      heightLeft -= pageHeight;

      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;
      }

      pdf.save(`visit-summary-${patientId || "patient"}.pdf`);
    } catch (err) {
      console.error("PDF generation failed:", err);
      setError("Unable to generate PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: 260,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 1.5,
          border: `1px solid ${LINE_SOFT}`,
          background: PAPER,
        }}
      >
        <CircularProgress size={24} thickness={4} sx={{ color: INK }} />
        <Typography sx={{ fontFamily: FONT, fontSize: 12, color: INK_SUB, letterSpacing: "0.03em" }}>
          Generating visit summary…
        </Typography>
      </Box>
    );
  }

  // ============================================================
  // ERROR
  // ============================================================

  if (error && !summary) {
    return (
      <Box
        sx={{
          p: 3,
          border: `1px solid ${INK}`,
          borderLeft: `4px solid ${INK}`,
          background: PAPER,
        }}
      >
        <Typography sx={{ fontFamily: FONT, fontSize: 13, color: INK, mb: 2 }}>
          {error}
        </Typography>
        <Button
          onClick={handleRefresh}
          variant="outlined"
          size="small"
          sx={{
            fontFamily: FONT,
            fontSize: 11.5,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            borderRadius: 0,
            borderColor: INK,
            color: INK,
            "&:hover": { borderColor: INK, background: SURFACE },
          }}
        >
          Retry
        </Button>
      </Box>
    );
  }

  // ============================================================
  // EMPTY
  // ============================================================

  if (!summary) {
    return (
      <Box sx={{ p: 4, textAlign: "center", border: `1px solid ${LINE_SOFT}`, background: PAPER }}>
        <Typography sx={{ fontFamily: FONT, fontSize: 13, color: INK_SUB }}>
          No visit summary available.
        </Typography>
      </Box>
    );
  }

  const displayData = isEditing ? editedSummary : summary;

  // ============================================================
  // MAIN UI
  // ============================================================

  return (
    <Box sx={{ width: "100%", background: PAPER }}>
      {/* TOOLBAR (outside the printable/report area) */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "flex-end",
          mb: 1.5,
        }}
      >
        <Stack direction="row" spacing={1}>
          {!isEditing ? (
            <>
              <Tooltip title="Edit Summary">
                <IconButton
                  size="small"
                  onClick={handleStartEdit}
                  sx={{ border: `1px solid ${INK}`, borderRadius: 0, color: INK }}
                >
                  <EditRounded sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>

              <Tooltip title="Download PDF">
                <IconButton
                  size="small"
                  onClick={handleDownloadPdf}
                  disabled={downloading}
                  sx={{ border: `1px solid ${INK}`, borderRadius: 0, color: INK }}
                >
                  {downloading ? (
                    <CircularProgress size={15} thickness={5} sx={{ color: INK }} />
                  ) : (
                    <DownloadRounded sx={{ fontSize: 17 }} />
                  )}
                </IconButton>
              </Tooltip>

              <Tooltip title="Regenerate Visit Summary">
                <IconButton
                  size="small"
                  onClick={handleRefresh}
                  sx={{ border: `1px solid ${INK}`, borderRadius: 0, color: INK }}
                >
                  <RefreshRounded sx={{ fontSize: 17 }} />
                </IconButton>
              </Tooltip>
            </>
          ) : (
            <>
              <Button
                size="small"
                startIcon={<CloseRounded sx={{ fontSize: 16 }} />}
                onClick={handleCancelEdit}
                disabled={saving}
                sx={{
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  borderRadius: 0,
                  color: INK_SUB,
                }}
              >
                Cancel
              </Button>
              <Button
                size="small"
                variant="contained"
                disableElevation
                startIcon={saving ? <CircularProgress size={13} sx={{ color: "#fff" }} /> : <SaveRounded sx={{ fontSize: 16 }} />}
                onClick={handleSaveEdit}
                disabled={saving}
                sx={{
                  fontFamily: FONT,
                  fontSize: 12,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  borderRadius: 0,
                  background: INK,
                  "&:hover": { background: "#000000" },
                }}
              >
                Save Changes
              </Button>
            </>
          )}
        </Stack>
      </Box>

      {error && summary && (
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            background: SURFACE,
            border: `1px solid ${LINE_SOFT}`,
            borderLeft: `3px solid ${INK}`,
          }}
        >
          <Typography sx={{ fontFamily: FONT, fontSize: 12, color: INK }}>{error}</Typography>
        </Box>
      )}

      {/* ============================================================ */}
      {/* PRINTABLE REPORT SHEET — the part exported to PDF            */}
      {/* ============================================================ */}
      <Box
        ref={printRef}
        sx={{
          background: PAPER,
          border: `1px solid ${LINE_SOFT}`,
          p: { xs: 2.5, sm: 4 },
        }}
      >
        {/* LETTERHEAD */}
        <Box
          sx={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            pb: 2,
            mb: 0.5,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box
              sx={{
                width: 42,
                height: 42,
                border: `2px solid ${INK}`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <LocalHospitalRounded sx={{ fontSize: 22, color: INK }} />
            </Box>
            <Box>
              <Typography
                sx={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 22,
                  fontWeight: 700,
                  color: INK,
                  letterSpacing: "0.01em",
                  lineHeight: 1.1,
                }}
              >
                OPD Visit Summary
              </Typography>
              <Typography
                sx={{
                  fontFamily: FONT,
                  fontSize: 10.5,
                  color: INK_SUB,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  mt: 0.4,
                }}
              >
                Outpatient Clinical Record
              </Typography>
            </Box>
          </Box>

          <Box sx={{ textAlign: "right" }}>
            <Typography
              sx={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: INK_SUB,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              Patient ID
            </Typography>
            <Typography
              sx={{
                fontFamily: FONT_MONO,
                fontSize: 13,
                color: INK,
                fontWeight: 700,
              }}
            >
              {patientId || "—"}
            </Typography>
            <Typography
              sx={{
                fontFamily: FONT_MONO,
                fontSize: 10.5,
                color: INK_FAINT,
                mt: 0.5,
              }}
            >
              {new Date().toLocaleDateString(undefined, {
                year: "numeric",
                month: "short",
                day: "2-digit",
              })}
            </Typography>
          </Box>
        </Box>

        {/* double rule — masthead / body divider */}
        <Box sx={{ borderTop: `2.5px solid ${INK}`, mb: "3px" }} />
        <Box sx={{ borderTop: `1px solid ${INK}`, mb: 3 }} />

        {SECTION_ORDER.map((key, idx) => {
          if (key === "patient_demographics" && (displayData.patient_demographics || isEditing)) {
            return (
              <SectionCard key={key} icon={SECTION_ICONS[key]} title="Patient" index={idx}>
                {isEditing ? (
                  <EditableValue
                    value={editedSummary.patient_demographics}
                    path={["patient_demographics"]}
                    onChange={handleFieldChange}
                  />
                ) : (
                  renderValue(summary.patient_demographics, "demo")
                )}
              </SectionCard>
            );
          }

          if (key === "confirmed_diagnoses" && (displayData.confirmed_diagnoses?.length > 0 || isEditing)) {
            return (
              <SectionCard key={key} icon={SECTION_ICONS[key]} title="Confirmed Diagnosis" index={idx}>
                {isEditing ? (
                  <EditableValue
                    value={editedSummary.confirmed_diagnoses || []}
                    path={["confirmed_diagnoses"]}
                    onChange={handleFieldChange}
                  />
                ) : (
                  <Stack direction="row" flexWrap="wrap" gap={1}>
                    {summary.confirmed_diagnoses.map((diagnosis, index) => (
                      <Chip
                        key={index}
                        label={diagnosis}
                        sx={{
                          fontFamily: FONT,
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: INK,
                          background: PAPER,
                          border: `1.3px solid ${INK}`,
                          borderRadius: 0,
                        }}
                      />
                    ))}
                  </Stack>
                )}
              </SectionCard>
            );
          }

          if (key === "clinical_summary" && (displayData.clinical_summary || isEditing)) {
            return (
              <SectionCard key={key} icon={SECTION_ICONS[key]} title="Clinical Summary" index={idx}>
                {isEditing ? (
                  <EditableValue
                    value={editedSummary.clinical_summary || ""}
                    path={["clinical_summary"]}
                    onChange={handleFieldChange}
                  />
                ) : (
                  <Typography
                    sx={{
                      fontFamily: FONT,
                      fontSize: 13.5,
                      color: INK,
                      lineHeight: 1.9,
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {renderInlineMarkdown(summary.clinical_summary, "clinsum")}
                  </Typography>
                )}
              </SectionCard>
            );
          }

          if (key === "clinical_examination" && (displayData.clinical_examination || isEditing)) {
            return (
              <SectionCard key={key} icon={SECTION_ICONS[key]} title="Clinical Examination" index={idx}>
                {isEditing ? (
                  <EditableValue
                    value={editedSummary.clinical_examination || {}}
                    path={["clinical_examination"]}
                    onChange={handleFieldChange}
                  />
                ) : (
                  renderValue(summary.clinical_examination, "exam")
                )}
              </SectionCard>
            );
          }

          if (key === "assessment" && (displayData.assessment || isEditing)) {
            return (
              <SectionCard key={key} icon={SECTION_ICONS[key]} title="Assessment" index={idx}>
                {isEditing ? (
                  <EditableValue value={editedSummary.assessment || {}} path={["assessment"]} onChange={handleFieldChange} />
                ) : (
                  renderValue(summary.assessment, "assess")
                )}
              </SectionCard>
            );
          }

          if (key === "plan" && (displayData.plan || isEditing)) {
            return (
              <SectionCard key={key} icon={SECTION_ICONS[key]} title="Plan" index={idx}>
                {isEditing ? (
                  <EditableValue value={editedSummary.plan || {}} path={["plan"]} onChange={handleFieldChange} />
                ) : (
                  renderValue(summary.plan, "plan")
                )}
              </SectionCard>
            );
          }

          if (key === "next_visit" && (displayData.next_visit || isEditing)) {
            return (
              <SectionCard key={key} icon={SECTION_ICONS[key]} title="Next Visit" index={idx}>
                {isEditing ? (
                  <EditableValue value={editedSummary.next_visit || {}} path={["next_visit"]} onChange={handleFieldChange} />
                ) : (
                  renderValue(summary.next_visit, "next")
                )}
              </SectionCard>
            );
          }

          return null;
        })}

        <Box sx={{ borderTop: `1px solid ${INK}`, mt: 1, mb: "3px" }} />
        <Box sx={{ borderTop: `2.5px solid ${INK}`, mb: 2 }} />

        <Stack direction="row" justifyContent="space-between" alignItems="flex-end">
          <Typography sx={{ fontFamily: FONT, fontSize: 9.5, color: INK_FAINT, maxWidth: 420 }}>
            
          </Typography>
          <Typography
            sx={{
              fontFamily: FONT_MONO,
              fontSize: 9.5,
              color: INK_FAINT,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Confidential — Patient Record
          </Typography>
        </Stack>
      </Box>
    </Box>
  );
};

export default VisitSummaryPanel;