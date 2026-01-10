import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  Chip,
  CircularProgress,
  Alert,
  Modal,
  Card,
  CardContent,
  CardActions,
  IconButton,
  Tooltip,
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

// Glass theme styling
const glassCard = {
  background: "rgba(255, 255, 255, 0.85)",
  backdropFilter: "blur(16px)",
  WebkitBackdropFilter: "blur(16px)",
  borderRadius: "12px",
  border: "1px solid rgba(255, 255, 255, 0.5)",
  boxShadow: "0 8px 32px rgba(31, 38, 135, 0.1)",
  position: "relative",
  overflow: "hidden",
  "&::before": {
    content: '""',
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "1px",
    background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)",
  },
};

const getTypeBadgeColor = (type) => {
  const typeLower = (type || "").toLowerCase();
  switch (typeLower) {
    case "mri":
      return { bg: "rgba(156, 39, 176, 0.1)", color: "#7b1fa2", border: "rgba(156, 39, 176, 0.3)" };
    case "ct":
      return { bg: "rgba(33, 150, 243, 0.1)", color: "#1976d2", border: "rgba(33, 150, 243, 0.3)" };
    case "x-ray":
      return { bg: "rgba(255, 193, 7, 0.1)", color: "#ff8f00", border: "rgba(255, 193, 7, 0.3)" };
    case "pet scan":
      return { bg: "rgba(233, 30, 99, 0.1)", color: "#c2185b", border: "rgba(233, 30, 99, 0.3)" };
    case "echocardiogram":
      return { bg: "rgba(76, 175, 80, 0.1)", color: "#388e3c", border: "rgba(76, 175, 80, 0.3)" };
    case "endoscopy report":
      return { bg: "rgba(255, 87, 34, 0.1)", color: "#d84315", border: "rgba(255, 87, 34, 0.3)" };
    default:
      return { bg: "rgba(158, 158, 158, 0.1)", color: "#616161", border: "rgba(158, 158, 158, 0.3)" };
  }
};

const formatDate = (dateString) => {
  return new Date(dateString).toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

const DICOMViewer = ({ patientId }) => {
  const [documentType, setDocumentType] = useState("");
  const [studies, setStudies] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selectedStudy, setSelectedStudy] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);

  const documentTypes = [
    "MRI",
    "CT",
    "X-ray",
    "PET scan",
    "Echocardiogram",
    "Endoscopy report"
  ];

  const loadStudies = async () => {
    if (!patientId) {
      setError("Patient ID not specified");
      return;
    }

    if (!documentType) {
      setError("Please select a document type");
      return;
    }

    setLoading(true);
    setError("");
    
    try {
      const url = `https://demo.doctorassist.ai/api/hms/dicom/patient-documents/?patient_id=${patientId}&document_type=${encodeURIComponent(documentType)}`;
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error("Failed to fetch studies");
      }
      
      const data = await response.json();
      const files = data.files || [];
      
      // Sort by uploaded_at descending
      files.sort((a, b) => new Date(b.uploaded_at) - new Date(a.uploaded_at));
      setStudies(files);
      
      if (files.length === 0) {
        setError(`No studies found for type "${documentType}"`);
      }
    } catch (err) {
      console.error("Error loading studies:", err);
      setError("Failed to load studies. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleOpenViewer = (study) => {
    setSelectedStudy(study);
    setModalOpen(true);
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setSelectedStudy(null);
  };

  const openInNewTab = () => {
    if (selectedStudy) {
      const viewerURL = `http://143.110.187.180:3000/viewer/${selectedStudy.study_uid}`;
      window.open(viewerURL, "_blank", "width=1200,height=800,scrollbars=yes,resizable=yes");
      handleCloseModal();
    }
  };

  useEffect(() => {
    if (studies.length === 0 && !documentType) {
      setStudies([]);
    }
  }, [documentType]);

  return (
    <>
      {/* Main Component */}
      <Box sx={{ ...glassCard, p: 3, mb: 3 }}>
        {/* Header */}
        <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, justifyContent: "space-between", alignItems: "center", mb: 4, gap: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <Box sx={{ 
              width: 48, 
              height: 48, 
              borderRadius: 2,
              background: "linear-gradient(135deg, #1f9a9b 0%, #0a88a7 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              boxShadow: "0 6px 20px rgba(31,154,155,0.3)",
            }}>
              <Image sx={{ fontSize: 28 }} />
            </Box>
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: "#1f9a9b", lineHeight: 1.2 }}>
                DICOM Imaging Studies
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7, mt: 0.5 }}>
                View and analyze medical imaging studies
              </Typography>
            </Box>
          </Box>

          {/* Controls */}
          <Box sx={{ display: "flex", gap: 2, alignItems: "center", flexWrap: "wrap" }}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel sx={{ color: "rgba(0,0,0,0.6)" }}>Document Type</InputLabel>
              <Select
                value={documentType}
                label="Document Type"
                onChange={(e) => setDocumentType(e.target.value)}
                sx={{ 
                  ...glassCard,
                  background: "rgba(255, 255, 255, 0.7)",
                  borderRadius: "8px",
                  "& .MuiOutlinedInput-notchedOutline": { border: "none" },
                }}
              >
                <MenuItem value="">
                  <em>All Document Types</em>
                </MenuItem>
                {documentTypes.map((type) => (
                  <MenuItem key={type} value={type}>{type}</MenuItem>
                ))}
              </Select>
            </FormControl>
            
            <Tooltip title="Load imaging studies">
              <Button
                variant="contained"
                onClick={loadStudies}
                disabled={loading || !documentType}
                startIcon={loading ? <CircularProgress size={20} /> : <Refresh />}
                sx={{
                  background: "linear-gradient(135deg, #4caf50 0%, #2e7d32 100%)",
                  color: "#fff",
                  borderRadius: "8px",
                  px: 3,
                  py: 1,
                  "&:hover": {
                    background: "linear-gradient(135deg, #43a047 0%, #1b5e20 100%)",
                    transform: "translateY(-2px)",
                    boxShadow: "0 6px 20px rgba(76,175,80,0.3)",
                  },
                  transition: "all 0.3s ease",
                }}
              >
                {loading ? "Loading..." : "Load Studies"}
              </Button>
            </Tooltip>
          </Box>
        </Box>

        {/* Error Display */}
        {error && (
          <Alert 
            severity="error" 
            sx={{ 
              mb: 3, 
              ...glassCard,
              borderRadius: "10px",
              background: "rgba(244, 67, 54, 0.1)",
              border: "1px solid rgba(244, 67, 54, 0.3)",
            }}
          >
            {error}
          </Alert>
        )}

        {/* Studies Container */}
        <Box sx={{ mt: 3 }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 8 }}>
              <CircularProgress size={60} sx={{ color: "#1f9a9b" }} />
            </Box>
          ) : studies.length === 0 ? (
            <Box sx={{ 
              ...glassCard, 
              textAlign: "center", 
              py: 8,
              background: "rgba(255, 255, 255, 0.5)",
              borderRadius: "12px",
            }}>
              <Image sx={{ fontSize: 64, mb: 2, opacity: 0.3, color: "#1f9a9b" }} />
              <Typography variant="h6" sx={{ mb: 1, fontWeight: 700, color: "#1f9a9b" }}>
                No imaging studies found
              </Typography>
              <Typography variant="body1" sx={{ mb: 3, opacity: 0.6 }}>
                {documentType 
                  ? `No studies found for "${documentType}"`
                  : "Select a document type and click 'Load Studies'"}
              </Typography>
            </Box>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              {studies.map((study, index) => {
                const badgeColor = getTypeBadgeColor(documentType);
                const viewerURL = `http://143.110.187.180:3000/viewer/${study.study_uid}`;

                return (
                  <Card
                    key={study.study_uid}
                    sx={{
                      ...glassCard,
                      background: badgeColor.bg,
                      border: `1px solid ${badgeColor.border}`,
                      borderRadius: "12px",
                      "&:hover": {
                        boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
                        transform: "translateY(-2px)",
                      },
                      transition: "all 0.3s ease",
                    }}
                  >
                    <CardContent sx={{ p: 3 }}>
                      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 2.5 }}>
                        <Box sx={{ flex: 1 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                            <Chip
                              label={documentType}
                              size="small"
                              sx={{
                                background: badgeColor.color,
                                color: "#fff",
                                fontWeight: 700,
                                fontSize: 11,
                                height: 24,
                                px: 1.5,
                                borderRadius: "6px",
                              }}
                            />
                            <Typography variant="caption" sx={{ 
                              opacity: 0.7, 
                              display: "flex", 
                              alignItems: "center", 
                              gap: 0.5,
                              fontSize: 11,
                            }}>
                              <CalendarToday fontSize="inherit" />
                              {formatDate(study.uploaded_at)}
                            </Typography>
                          </Box>
                          <Typography variant="body2" sx={{ 
                            display: "flex", 
                            alignItems: "center", 
                            gap: 0.5,
                            opacity: 0.8,
                            fontSize: 12,
                          }}>
                            <Description fontSize="inherit" />
                            Study UID: {study.study_uid}
                          </Typography>
                        </Box>
                      </Box>
                    </CardContent>
                    
                    <CardActions sx={{ px: 3, pb: 2.5, pt: 0 }}>
                      <Tooltip title="Open DICOM Viewer">
                        <Button
                          size="small"
                          startIcon={<Visibility />}
                          onClick={() => handleOpenViewer(study)}
                          sx={{
                            ...glassCard,
                            background: "rgba(33, 150, 243, 0.1)",
                            color: "#1976d2",
                            borderRadius: "8px",
                            border: "1px solid rgba(33, 150, 243, 0.3)",
                            px: 2,
                            py: 0.5,
                            "&:hover": {
                              background: "rgba(33, 150, 243, 0.2)",
                            },
                          }}
                        >
                          Open Viewer
                        </Button>
                      </Tooltip>
                    </CardActions>
                  </Card>
                );
              })}
            </Box>
          )}
        </Box>
      </Box>

      {/* Viewer Modal */}
      <Modal
        open={modalOpen}
        onClose={handleCloseModal}
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backdropFilter: "blur(4px)",
        }}
      >
        <Box sx={{
          ...glassCard,
          width: 400,
          p: 4,
          mx: 2,
          textAlign: "center",
        }}>
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 3 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, color: "#1f9a9b" }}>
              Open DICOM Viewer
            </Typography>
            <IconButton
              size="small"
              onClick={handleCloseModal}
              sx={{
                ...glassCard,
                width: 32,
                height: 32,
                color: "#666",
                "&:hover": { background: "rgba(0,0,0,0.05)" },
              }}
            >
              <Close />
            </IconButton>
          </Box>
          
          {selectedStudy && (
            <>
              <Typography variant="body2" sx={{ 
                mb: 4, 
                color: "#666",
                background: "rgba(0,0,0,0.02)",
                p: 2,
                borderRadius: "8px",
                fontFamily: "monospace",
                fontSize: 12,
              }}>
                Study UID: {selectedStudy.study_uid}
              </Typography>
              
              <Box sx={{ display: "flex", justifyContent: "center", gap: 2 }}>
                <Tooltip title="Open in new tab">
                  <Button
                    variant="contained"
                    onClick={openInNewTab}
                    startIcon={<OpenInNew />}
                    sx={{
                      background: "linear-gradient(135deg, #2196f3 0%, #0d47a1 100%)",
                      color: "#fff",
                      borderRadius: "8px",
                      px: 3,
                      py: 1,
                      "&:hover": {
                        background: "linear-gradient(135deg, #1976d2 0%, #0a2d5c 100%)",
                        transform: "translateY(-2px)",
                        boxShadow: "0 6px 20px rgba(33,150,243,0.3)",
                      },
                      transition: "all 0.3s ease",
                    }}
                  >
                    Open Viewer
                  </Button>
                </Tooltip>
                
                <Button
                  variant="outlined"
                  onClick={handleCloseModal}
                  sx={{
                    borderRadius: "8px",
                    px: 3,
                    py: 1,
                    borderColor: "rgba(0,0,0,0.1)",
                    color: "#666",
                    "&:hover": {
                      borderColor: "rgba(0,0,0,0.2)",
                      background: "rgba(0,0,0,0.02)",
                    },
                  }}
                >
                  Cancel
                </Button>
              </Box>
            </>
          )}
        </Box>
      </Modal>
    </>
  );
};

export default DICOMViewer;