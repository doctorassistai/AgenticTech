import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Select,
  MenuItem,
  FormControl,
  CircularProgress,
  Modal,
} from "@mui/material";
import {
  Image,
  Visibility,
  Close,
  Refresh,
  OpenInNew,
  CalendarToday,
  Description,
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
};

const os = (extra = {}) => ({
  fontFamily: FONT,
  fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased",
  ...extra,
});

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const formatDate = (dateString) =>
  new Date(dateString).toLocaleDateString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });

// ─── Main Component ───────────────────────────────────────────────────────────
const DICOMViewer = ({ patientId }) => {
  const [documentType, setDocumentType]   = useState("");
  const [studies, setStudies]             = useState([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");
  const [selectedStudy, setSelectedStudy] = useState(null);
  const [modalOpen, setModalOpen]         = useState(false);

  const documentTypes = ["MRI", "CT", "X-ray", "PET scan", "Echocardiogram", "Endoscopy report"];

  const loadStudies = async (type) => {
    if (!patientId) { setError("Patient ID not specified"); return; }
    if (!type)      { setError("Please select a document type"); setStudies([]); return; }
    setLoading(true);
    setError("");
    try {
      const url = `${API_BASE_URL}hms/dicom/patient-documents/?patient_id=${patientId}&document_type=${encodeURIComponent(type)}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to fetch studies");
      const data  = await response.json();
      const files = (data.files || []).sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
      setStudies(files);
      if (files.length === 0) setError(`No studies found for type "${type}"`);
    } catch (err) {
      console.error("Error loading studies:", err);
      setError("Failed to load studies. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDocumentTypeChange = (newType) => {
    setDocumentType(newType);
    if (newType) loadStudies(newType);
    else { setStudies([]); setError(""); }
  };

  const handleOpenViewer  = (study) => { setSelectedStudy(study); setModalOpen(true); };
  const handleCloseModal  = () => { setModalOpen(false); setSelectedStudy(null); };
  const handleRefresh     = () => { if (documentType) loadStudies(documentType); };

  const openInNewTab = () => {
    if (selectedStudy) {
      window.open(`http://143.110.187.180:3000/viewer/${selectedStudy.study_uid}`, "_blank", "width=1200,height=800,scrollbars=yes,resizable=yes");
      handleCloseModal();
    }
  };

  useEffect(() => {
    if (!documentType) { setStudies([]); setError(""); }
  }, [documentType]);

  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* ─── Header ──────────────────────────────────────────────────────── */}
      <Box sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        mb: 2.5, pb: 2, borderBottom: `1px solid ${C.mist}`,
        flexWrap: "wrap", gap: 1.5,
      }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.12em", textTransform: "uppercase", mb: 0.4 }) }}>
            DICOM Imaging Studies
          </Typography>
          <Typography sx={{ ...os({ fontSize: 13, color: C.black, fontWeight: FW_REGULAR }) }}>
            View and analyse medical imaging studies
          </Typography>
        </Box>

        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {/* Document type selector */}
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <Select
              value={documentType}
              displayEmpty
              onChange={(e) => handleDocumentTypeChange(e.target.value)}
              sx={{
                fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 11,
                color: C.black, borderRadius: 0,
                "& .MuiOutlinedInput-notchedOutline": { borderColor: C.mist, borderRadius: 0 },
                "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: C.black },
                "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderColor: C.black, borderWidth: 1 },
                "& .MuiSelect-select": { py: 0.9, letterSpacing: "0.02em" },
              }}
            >
              <MenuItem value="" sx={{ ...os({ fontSize: 11 }) }}>
                <em style={{ fontStyle: "normal", color: C.ash }}>Select document type</em>
              </MenuItem>
              {documentTypes.map((type) => (
                <MenuItem key={type} value={type} sx={{ ...os({ fontSize: 11 }) }}>
                  {type}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          {/* Refresh button */}
          <Box
            component="button"
            onClick={handleRefresh}
            disabled={loading || !documentType}
            sx={{
              width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
              background: "transparent", border: `1px solid ${C.mist}`,
              cursor: loading || !documentType ? "not-allowed" : "pointer",
              color: C.ash, transition: "all 0.2s",
              opacity: loading || !documentType ? 0.4 : 1,
              "&:hover": loading || !documentType ? {} : { background: C.ghost, borderColor: C.black, color: C.black },
            }}
          >
            {loading
              ? <CircularProgress size={13} thickness={2} sx={{ color: C.ash }} />
              : <Refresh sx={{ fontSize: 13 }} />
            }
          </Box>
        </Box>
      </Box>

      {/* ─── Error strip ─────────────────────────────────────────────────── */}
      {error && (
        <Box sx={{
          px: 1.5, py: 1, mb: 2,
          background: C.ghost,
          border: `1px solid ${C.mist}`,
          borderLeft: `2px solid ${C.charcoal}`,
        }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6 }) }}>
            {error}
          </Typography>
        </Box>
      )}

      {/* ─── Body ────────────────────────────────────────────────────────── */}
      <Box>
        {/* Loading */}
        {loading && (
          <Box sx={{ py: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
            <CircularProgress size={20} thickness={1.5} sx={{ color: C.black }} />
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.08em", textTransform: "uppercase" }) }}>
              Loading {documentType} studies...
            </Typography>
          </Box>
        )}

        {/* Empty / no selection */}
        {!loading && studies.length === 0 && !error && (
          <Box sx={{ py: 6, textAlign: "center" }}>
            <Image sx={{ fontSize: 36, color: C.mist, mb: 1.5, display: "block", mx: "auto" }} />
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash, letterSpacing: "0.05em" }) }}>
              {documentType
                ? `No ${documentType.toLowerCase()} studies found for this patient`
                : "Select a document type to view imaging studies"}
            </Typography>
          </Box>
        )}

        {/* Study cards */}
        {!loading && studies.length > 0 && (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {studies.map((study) => (
              <Box
                key={study.study_uid}
                sx={{
                  border: `1px solid ${C.mist}`,
                  transition: "border-color 0.2s",
                  "&:hover": { borderColor: C.black },
                }}
              >
                {/* Card body */}
                <Box sx={{ px: 2, py: 1.75 }}>
                  {/* Type badge + date row */}
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1, flexWrap: "wrap", gap: 1 }}>
                    <Box sx={{
                      display: "inline-block",
                      px: 1.25, py: 0.3,
                      border: `1px solid ${C.mist}`,
                      background: C.offwhite,
                    }}>
                      <Typography sx={{ ...os({ fontSize: 10, color: C.charcoal, fontWeight: FW_REGULAR, letterSpacing: "0.08em", textTransform: "uppercase" }) }}>
                        {documentType}
                      </Typography>
                    </Box>

                    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, display: "flex", alignItems: "center", gap: 0.5 }) }}>
                      <CalendarToday sx={{ fontSize: 11 }} />
                      {formatDate(study.uploaded_at)}
                    </Typography>
                  </Box>

                  {/* Study UID */}
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash, display: "flex", alignItems: "center", gap: 0.5 }) }}>
                    <Description sx={{ fontSize: 11 }} />
                    Study UID: {study.study_uid}
                  </Typography>
                </Box>

                {/* Card action row */}
                <Box sx={{ px: 2, pb: 1.75, borderTop: `1px solid ${C.mist}`, pt: 1.25 }}>
                  <Box
                    component="button"
                    onClick={() => handleOpenViewer(study)}
                    sx={{
                      display: "inline-flex", alignItems: "center", gap: 0.75,
                      fontFamily: FONT, fontWeight: FW_REGULAR, fontSize: 11,
                      color: C.black, background: "transparent",
                      border: `1px solid ${C.mist}`,
                      px: 1.5, py: 0.6, cursor: "pointer",
                      letterSpacing: "0.05em", textTransform: "uppercase",
                      transition: "all 0.2s",
                      "&:hover": { background: C.ghost, borderColor: C.black },
                    }}
                  >
                    <Visibility sx={{ fontSize: 12 }} />
                    Open Viewer
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {/* ─── Modal ───────────────────────────────────────────────────────── */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        sx={{ display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <Box sx={{
          width: 400, mx: 2,
          background: C.white,
          border: `1px solid ${C.black}`,
          p: 3,
          fontFamily: FONT,
          outline: "none",
        }}>
          {/* Modal header */}
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 2.5, pb: 2, borderBottom: `1px solid ${C.mist}` }}>
            <Box>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.12em", textTransform: "uppercase", mb: 0.3 }) }}>
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

          {/* Study UID */}
          {selectedStudy && (
            <>
              <Box sx={{ px: 1.5, py: 1, mb: 2.5, background: C.ghost, border: `1px solid ${C.mist}` }}>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, letterSpacing: "0.08em", textTransform: "uppercase", mb: 0.4 }) }}>
                  Study UID
                </Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontFamily: "monospace" }) }}>
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