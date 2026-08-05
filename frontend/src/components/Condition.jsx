import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  IconButton,
  Tooltip,
  CircularProgress,
  Alert,
  TextField,
  InputAdornment,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  useTheme
} from "@mui/material";
import {
  Close,
  Search,
  LocalHospital,
  CalendarMonth,
  AccessTime,
  MedicalServices,
  Save
} from "@mui/icons-material";
import { motion, AnimatePresence } from "framer-motion";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* UUID generator */
const uuid = () =>
  crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).substring(2, 15);

const Condition = ({ patientId, doctorId, open, onClose }) => {
  const [conditions, setConditions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [savingId, setSavingId] = useState(null);
  const theme = useTheme();

  useEffect(() => {
    if (open && patientId && doctorId) {
      fetchConditions();
    }
  }, [open, patientId, doctorId]);

  const fetchConditions = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/conditions?doctor_id=${doctorId}&patient_id=${patientId}`
      );

      const data = await res.json();

      if (data.status === "success" && Array.isArray(data.conditions)) {
        setConditions(
          data.conditions.sort(
            (a, b) => new Date(b.created_at) - new Date(a.created_at)
          )
        );
      } else {
        throw new Error("Failed to fetch conditions");
      }
    } catch (err) {
      setError(err.message || "Something went wrong");
    } finally {
      setLoading(false);
    }
  };


  /* YYYY-MM-DD */
  const toDateOnly = (value) =>
    new Date(value).toISOString().split("T")[0];

  const filteredConditions = conditions.filter(c =>
    searchTerm === "" ||
    c.condition.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const formatDate = date =>
    new Date(date).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric"
    });

  const formatTime = date =>
    new Date(date).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit"
    });

  const getSeverityColor = text => {
    const t = text.toLowerCase();
    if (t.match(/cancer|severe|critical/)) return theme.palette.error.main;
    if (t.match(/mild|moderate/)) return theme.palette.warning.main;
    if (t.match(/normal|stable|healthy/)) return theme.palette.success.main;
    return theme.palette.info.main;
  };

  /* 💾 SAVE → BOTH MEDICAL & CURRENT CONTEXT */
  const handleSaveCondition = async (condition) => {
    setSavingId(condition.created_at);

    const date = toDateOnly(condition.report_date || condition.created_at);
    const conditionObj = {
      id: uuid(),
      text: condition.condition
    };

    const medicalPayload = {
      doctor_id: String(doctorId),
      patient_id: String(patientId),
      current_context: [
        {
          date,
          conditions: [conditionObj]
        }
      ]
    };

    const currentPayload = {
      doctor_id: String(doctorId),
      patient_id: String(patientId),
      contexts: [
        {
          date,
          current_condition: [conditionObj]
        }
      ]
    };

    try {
      const [medicalRes, currentRes] = await Promise.all([
        fetch(
          `${API_BASE_URL}hms/users/data/context/medical_context_save`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(medicalPayload)
          }
        ),
        fetch(
          `${API_BASE_URL}hms/users/data/context/current_context_save`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(currentPayload)
          }
        )
      ]);

      if (!medicalRes.ok || !currentRes.ok) {
        const err1 = !medicalRes.ok && await medicalRes.json();
        const err2 = !currentRes.ok && await currentRes.json();
        console.error("Medical error:", err1);
        console.error("Current error:", err2);
        throw new Error("Save failed");
      }
    } catch (err) {
      alert("Failed to save condition");
    } finally {
      setSavingId(null);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            style={{ height: "90vh", display: "flex", flexDirection: "column" }}
          >
            {/* HEADER */}
            <DialogTitle
              sx={{
                background: "linear-gradient(135deg,#667eea,#764ba2)",
                color: "white",
                display: "flex",
                justifyContent: "space-between"
              }}
            >
              <Box display="flex" alignItems="center" gap={2}>
                <LocalHospital />
                <Typography fontWeight={700}>Patient Conditions</Typography>
              </Box>
              <IconButton onClick={onClose} sx={{ color: "white" }}>
                <Close />
              </IconButton>
            </DialogTitle>

            {/* SEARCH */}
            <Box p={2}>
              <TextField
                fullWidth
                size="small"
                placeholder="Search conditions..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <Search />
                    </InputAdornment>
                  )
                }}
              />
            </Box>

            {/* CONTENT */}
            <DialogContent sx={{ flex: 1, p: 0 }}>
              {loading ? (
                <Box display="flex" justifyContent="center" mt={4}>
                  <CircularProgress />
                </Box>
              ) : error ? (
                <Alert severity="error">{error}</Alert>
              ) : (
                <TableContainer component={Paper} sx={{ boxShadow: "none" }}>
                  <Table stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell>Status</TableCell>
                        <TableCell>Condition</TableCell>
                        <TableCell>Document</TableCell>
                        <TableCell>Report Date</TableCell>
                        <TableCell>Recorded</TableCell>
                        <TableCell align="center">Save</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {filteredConditions.map((c, i) => (
                        <TableRow key={i}>
                          <TableCell>
                            <Box
                              sx={{
                                width: 12,
                                height: 12,
                                borderRadius: "50%",
                                background: getSeverityColor(c.condition)
                              }}
                            />
                          </TableCell>

                          <TableCell>{c.condition}</TableCell>

                          <TableCell>
                            <Chip
                              icon={<MedicalServices fontSize="small" />}
                              label={c.doc_type.replace("_", " ").toUpperCase()}
                              size="small"
                            />
                          </TableCell>

                          <TableCell>
                            <CalendarMonth fontSize="small" />{" "}
                            {formatDate(c.report_date)}
                          </TableCell>

                          <TableCell>
                            <AccessTime fontSize="small" />{" "}
                            {formatTime(c.created_at)}
                          </TableCell>

                          <TableCell align="center">
                            <Tooltip title="Save to Medical & Current Context">
                              <span>
                                <IconButton
                                  onClick={() => handleSaveCondition(c)}
                                  disabled={savingId === c.created_at}
                                  color="primary"
                                >
                                  {savingId === c.created_at ? (
                                    <CircularProgress size={18} />
                                  ) : (
                                    <Save />
                                  )}
                                </IconButton>
                              </span>
                            </Tooltip>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
            </DialogContent>

            <Divider />
            <Box p={2} display="flex" justifyContent="space-between">
              <Typography variant="caption">
                Showing {filteredConditions.length} of {conditions.length}
              </Typography>
            </Box>
          </motion.div>
        )}
      </AnimatePresence>
    </Dialog>
  );
};

export default Condition;
