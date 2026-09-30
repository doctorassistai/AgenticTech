// DICOMViewer.jsx
import React, { useState, useEffect, useMemo } from "react";
import { Box, Typography, CircularProgress, Modal } from "@mui/material";
import {
  Close,
  Refresh,
  OpenInNew,
  CalendarToday,
} from "@mui/icons-material";

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
  tileDark: "#3a3a3a",
};

const os = (extra = {}) => ({
  fontFamily: FONT,
  fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased",
  ...extra,
});

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const DOCUMENT_TYPES = [
  "MRI", "CT", "X-ray", "PET scan", "Echocardiogram", "Endoscopy report",
];

// ─── Helpers ─────────────────────────────────────────────────────────────────
const formatShortDate = (dateString) => {
  if (!dateString) return "";
  const d = new Date(dateString);
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

// Map document_type → 2–4 char badge (PATH, PET, CT, MRI, …)
const toBadge = (type) => {
  if (!type) return "IMG";
  const t = type.toUpperCase();
  if (t.includes("PET")) return "PET";
  if (t.includes("MRI")) return "MRI";
  if (t.includes("CT")) return "CT";
  if (t.includes("X")) return "X-RAY";
  if (t.includes("ECHO")) return "ECHO";
  if (t.includes("ENDO")) return "ENDO";
  if (t.includes("PATH")) return "PATH";
  return t.slice(0, 4);
};

// Short label shown on the caption line
const shortLabel = (type) => {
  if (!type) return "Study";
  return type
    .replace(" scan", "")
    .replace(" report", "")
    .replace("Echocardiogram", "Echo");
};

// ─── Placeholder scan pattern (SVG) ──────────────────────────────────────────
const ScanPlaceholder = ({ variant = "rings" }) => (
  <svg
    viewBox="0 0 200 200"
    preserveAspectRatio="xMidYMid slice"
    style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
  >
    <defs>
      <radialGradient id="fade" cx="50%" cy="50%" r="60%">
        <stop offset="0%" stopColor="#fefefe" />
        <stop offset="100%" stopColor="#eaeaea" />
      </radialGradient>
    </defs>
    <rect width="200" height="200" fill="url(#fade)" />
    {/* concentric rings */}
    {[80, 66, 52, 38, 24].map((r, i) => (
      <circle
        key={i}
        cx="100"
        cy="100"
        r={r}
        fill="none"
        stroke="#c8c8c8"
        strokeWidth="1.2"
      />
    ))}
    {/* center dot */}
    <circle cx="100" cy="100" r="2" fill="#b5b5b5" />
    {/* optional dashed highlight */}
    {variant === "highlight" && (
      <circle
        cx="150"
        cy="130"
        r="18"
        fill="none"
        stroke="#111"
        strokeWidth="1.5"
        strokeDasharray="4 3"
      />
    )}
  </svg>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const DICOMViewer = ({ patientId }) => {
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const [selectedStudy, setSelectedStudy] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  /* ── Fetch all studies ────────────────────────────────────────── */
  const loadAllStudies = async () => {
    if (!patientId) { setError("Patient ID not specified"); return; }
    setLoading(true);
    setError("");
    try {
      // Preferred: single call, no type filter
      const url = `${API_BASE_URL}hms/dicom/patient-documents/?patient_id=${patientId}`;
      const res = await fetch(url);

      if (res.ok) {
        const data = await res.json();
        const files = data.files || [];
        setStudies(
          files
            .map((f) => ({
              ...f,
              document_type: f.document_type || f.modality || "Other",
            }))
            .sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at))
        );
        return;
      }

      // Fallback: loop per type
      const results = await Promise.all(
        DOCUMENT_TYPES.map(async (type) => {
          try {
            const u = `${API_BASE_URL}hms/dicom/patient-documents/?patient_id=${patientId}&document_type=${encodeURIComponent(type)}`;
            const r = await fetch(u);
            if (!r.ok) return [];
            const j = await r.json();
            return (j.files || []).map((f) => ({ ...f, document_type: type }));
          } catch { return []; }
        })
      );
      setStudies(
        results.flat().sort((a, b) => new Date(a.uploaded_at) - new Date(b.uploaded_at))
      );
    } catch (err) {
      console.error("Error loading studies:", err);
      setError("Failed to load imaging studies. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadAllStudies(); /* eslint-disable-next-line */ }, [patientId]);

  /* ── Actions ──────────────────────────────────────────────────── */
  const handleOpenViewer = (study) => { setSelectedStudy(study); setModalOpen(true); };
  const handleCloseModal = () => { setModalOpen(false); setSelectedStudy(null); };
  const openInNewTab = () => {
    if (selectedStudy) {
      window.open(
        `http://143.110.187.180:3000/viewer/${selectedStudy.study_uid}`,
        "_blank",
        "width=1200,height=800,scrollbars=yes,resizable=yes"
      );
      handleCloseModal();
    }
  };

  const total = studies.length;

  /* ── Render ───────────────────────────────────────────────────── */
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* ─── Section header ─────────────────────────────────────── */}
      <Box
        sx={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          mb: 2, pb: 1.5, flexWrap: "wrap", gap: 1.5,
        }}
      >
        <Typography
          sx={{
            ...os({
              fontSize: 11, color: C.ash,
              letterSpacing: "0.18em", textTransform: "uppercase",
              fontWeight: FW_REGULAR,
            }),
          }}
        >
          All studies, in order
        </Typography>

        <Box
          component="button"
          onClick={loadAllStudies}
          disabled={loading}
          sx={{
            width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: `1px solid ${C.mist}`,
            cursor: loading ? "not-allowed" : "pointer",
            color: C.ash, transition: "all 0.2s",
            opacity: loading ? 0.4 : 1,
            "&:hover": loading ? {} : { background: C.ghost, borderColor: C.black, color: C.black },
          }}
        >
          {loading
            ? <CircularProgress size={12} thickness={2} sx={{ color: C.ash }} />
            : <Refresh sx={{ fontSize: 13 }} />}
        </Box>
      </Box>

      {/* ─── Error ──────────────────────────────────────────────── */}
      {error && (
        <Box
          sx={{
            px: 1.5, py: 1, mb: 2,
            background: C.ghost,
            border: `1px solid ${C.mist}`,
            borderLeft: `2px solid ${C.charcoal}`,
          }}
        >
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6 }) }}>
            {error}
          </Typography>
        </Box>
      )}

      {/* ─── Loading ────────────────────────────────────────────── */}
      {loading && total === 0 && (
        <Box sx={{ py: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <CircularProgress size={20} thickness={1.5} sx={{ color: C.black }} />
          <Typography
            sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.08em", textTransform: "uppercase" }) }}
          >
            Loading imaging studies…
          </Typography>
        </Box>
      )}

      {/* ─── Empty ──────────────────────────────────────────────── */}
      {!loading && total === 0 && !error && (
        <Box sx={{ py: 6, textAlign: "center" }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ash, letterSpacing: "0.05em" }) }}>
            No imaging studies found for this patient
          </Typography>
        </Box>
      )}

      {/* ─── Film strip ─────────────────────────────────────────── */}
      {total > 0 && (
        <Box
          sx={{
            display: "flex",
            gap: 1.5,
            overflowX: "auto",
            overflowY: "hidden",
            pb: 1.5,
            "&::-webkit-scrollbar": { height: 6 },
            "&::-webkit-scrollbar-thumb": { background: C.mist },
            "&::-webkit-scrollbar-track": { background: "transparent" },
          }}
        >
          {studies.map((study, i) => {
            const badge = toBadge(study.document_type);
            const label = shortLabel(study.document_type);
            const date = formatShortDate(study.uploaded_at);
            const variant = i % 3 === 1 ? "highlight" : "rings"; // sprinkle accents

            return (
              <Box
                key={study.study_uid || i}
                onClick={() => handleOpenViewer(study)}
                sx={{
                  flex: "0 0 auto",
                  width: 148,
                  cursor: "pointer",
                  transition: "transform 0.15s ease",
                  "&:hover": { transform: "translateY(-2px)" },
                  "&:hover .strip-caption": { background: "#000" },
                }}
              >
                {/* Thumbnail */}
                <Box
                  sx={{
                    position: "relative",
                    width: 148,
                    height: 148,
                    background: C.offwhite,
                    border: `1px solid ${C.mist}`,
                    overflow: "hidden",
                  }}
                >
                  <ScanPlaceholder variant={variant} />

                  {/* Type badge top-right */}
                  <Box
                    sx={{
                      position: "absolute",
                      top: 8,
                      right: 8,
                      px: 1,
                      py: 0.3,
                      background: C.black,
                      color: C.white,
                    }}
                  >
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 9,
                          fontWeight: 600,
                          letterSpacing: "0.1em",
                        }),
                      }}
                    >
                      {badge}
                    </Typography>
                  </Box>
                </Box>

                {/* Caption strip */}
                <Box
                  className="strip-caption"
                  sx={{
                    background: C.tileDark,
                    color: C.white,
                    px: 1.25,
                    py: 0.9,
                    minHeight: 46,
                    display: "flex",
                    alignItems: "center",
                    transition: "background 0.2s",
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 11,
                        color: C.white,
                        lineHeight: 1.35,
                        fontWeight: FW_REGULAR,
                      }),
                    }}
                  >
                    {label}
                    {date ? ` · ${date}` : ""}
                  </Typography>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* ─── Helper line ────────────────────────────────────────── */}
      {total > 0 && (
        <Typography
          sx={{
            ...os({
              fontSize: 11,
              color: C.ash,
              mt: 1.5,
              lineHeight: 1.6,
              fontWeight: FW_LIGHT,
            }),
          }}
        >
          Click any study to open the full image in the DICOM viewer.
        </Typography>
      )}

      {/* ─── Modal ──────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Box
          sx={{
            width: 400, mx: 2,
            background: C.white,
            border: `1px solid ${C.black}`,
            p: 3, fontFamily: FONT, outline: "none",
          }}
        >
          {/* Header */}
          <Box
            sx={{
              display: "flex", justifyContent: "space-between", alignItems: "center",
              mb: 2.5, pb: 2, borderBottom: `1px solid ${C.mist}`,
            }}
          >
            <Box>
              <Typography
                sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.12em", textTransform: "uppercase", mb: 0.3 }) }}
              >
                DICOM Viewer
              </Typography>
              <Typography sx={{ ...os({ fontSize: 13, color: C.black, fontWeight: FW_REGULAR }) }}>
                Open imaging study
              </Typography>
            </Box>
            <Box
              component="button"
              onClick={handleCloseModal}
              sx={{
                width: 30, height: 30, display: "flex", alignItems: "center", justifyContent: "center",
                background: "transparent", border: `1px solid ${C.mist}`,
                cursor: "pointer", color: C.ash, transition: "all 0.2s",
                "&:hover": { background: C.ghost, borderColor: C.black, color: C.black },
              }}
            >
              <Close sx={{ fontSize: 13 }} />
            </Box>
          </Box>

          {selectedStudy && (
            <>
              {/* Meta box */}
              <Box
                sx={{
                  px: 1.5, py: 1, mb: 2.5,
                  background: C.ghost, border: `1px solid ${C.mist}`,
                }}
              >
                <Typography
                  sx={{ ...os({ fontSize: 10, color: C.ash, letterSpacing: "0.08em", textTransform: "uppercase", mb: 0.4 }) }}
                >
                  {selectedStudy.document_type} · {formatShortDate(selectedStudy.uploaded_at)}
                </Typography>
                <Typography
                  sx={{ ...os({ fontSize: 11, color: C.charcoal, fontFamily: "monospace", wordBreak: "break-all" }) }}
                >
                  {selectedStudy.study_uid}
                </Typography>
              </Box>

              {/* Actions */}
              <Box sx={{ display: "flex", gap: 1 }}>
                <Box
                  component="button"
                  onClick={openInNewTab}
                  sx={{
                    flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 0.75,
                    fontFamily: FONT, fontWeight: FW_REGULAR, fontSize: 11,
                    color: C.white, background: C.black,
                    border: `1px solid ${C.black}`,
                    px: 2, py: 0.9, cursor: "pointer",
                    letterSpacing: "0.05em", textTransform: "uppercase",
                    transition: "all 0.2s",
                    "&:hover": { background: C.charcoal },
                  }}
                >
                  <OpenInNew sx={{ fontSize: 12 }} />
                  Open Viewer
                </Box>

                <Box
                  component="button"
                  onClick={handleCloseModal}
                  sx={{
                    display: "inline-flex", alignItems: "center", justifyContent: "center",
                    fontFamily: FONT, fontWeight: FW_REGULAR, fontSize: 11,
                    color: C.black, background: "transparent",
                    border: `1px solid ${C.mist}`,
                    px: 2, py: 0.9, cursor: "pointer",
                    letterSpacing: "0.05em", textTransform: "uppercase",
                    transition: "all 0.2s",
                    "&:hover": { background: C.ghost, borderColor: C.black },
                  }}
                >
                  Cancel
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Modal>
    </>
  );
};

export default DICOMViewer;