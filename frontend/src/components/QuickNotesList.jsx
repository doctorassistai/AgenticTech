import React, { useState, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  IconButton,
  Chip,
  CircularProgress,
  Alert,
  Card,
  CardContent,
  CardActions,
  Tooltip,
  TextField,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Snackbar,
  Button,
} from "@mui/material";
import {
  Delete,
  Edit,
  Save,
  Cancel,
  CheckCircle,
  AccessTime,
  Search,
  Refresh,
  Warning,
  Notes,
  RemoveRedEye,
  VisibilityOff,
} from "@mui/icons-material";
import { motion, AnimatePresence } from "framer-motion";
const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// Clean glass theme
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

const priorityColors = {
  Critical: { 
    bg: "rgba(244, 67, 54, 0.12)", 
    color: "#d32f2f",
    light: "#ffebee",
  },
  Medium: { 
    bg: "rgba(255, 152, 0, 0.12)", 
    color: "#f57c00",
    light: "#fff3e0",
  },
  Normal: { 
    bg: "rgba(76, 175, 80, 0.12)", 
    color: "#388e3c",
    light: "#e8f5e9",
  },
};

const formatDate = (dateString) => {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
};

export default function QuickNotesList({ doctorId, patientId, refreshTrigger = 0 }) {
  const [quickNotes, setQuickNotes] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [editingNote, setEditingNote] = useState(null);
  const [editText, setEditText] = useState("");
  const [filters, setFilters] = useState({
    priority: "all",
    search: "",
    sortBy: "date_desc",
  });
  const [snackbar, setSnackbar] = useState({
    open: false,
    message: "",
    severity: "success",
  });
  const [expandedNotes, setExpandedNotes] = useState({});

  const showSnackbar = (message, severity = "success") => {
    setSnackbar({
      open: true,
      message,
      severity,
    });
  };

  const handleCloseSnackbar = () => {
    setSnackbar({ ...snackbar, open: false });
  };

  const toggleNoteExpansion = (noteId) => {
    setExpandedNotes(prev => ({
      ...prev,
      [noteId]: !prev[noteId]
    }));
  };

  const fetchQuickNotes = useCallback(async () => {
    if (!doctorId || !patientId) return;

    setLoading(true);
    setError(null);

    try {
      const response = await fetch(
        `${API_BASE_URL}/get_quick_notes?patient_id=${patientId}&doctor_id=${doctorId}`
      );

      if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

      const data = await response.json();
      
      if (data.status === "success" && data.quick_notes) {
        const transformedNotes = [];
        
        ["Critical", "Medium", "Normal"].forEach(priority => {
          const notesArray = data.quick_notes[priority]?.suggestions || [];
          notesArray.forEach(note => {
            transformedNotes.push({
              ...note,
              id: `${note.si_no}-${priority}`,
              text: note.note || note.text || "",
              priority,
              createdAt: note.createdAt || data.quick_notes.created_at || new Date().toISOString(),
            });
          });
        });

        setQuickNotes(transformedNotes);
        showSnackbar(`${transformedNotes.length} notes loaded`);
      } else {
        setQuickNotes([]);
        showSnackbar("No notes found", "info");
      }
    } catch (err) {
      console.error("Error:", err);
      setError("Failed to load notes");
      showSnackbar("Failed to load notes", "error");
    } finally {
      setLoading(false);
    }
  }, [doctorId, patientId]);

  useEffect(() => {
    fetchQuickNotes();
  }, [fetchQuickNotes, refreshTrigger]);

  const handleDeleteNote = async (si_no, priority) => {
    if (!window.confirm("Delete this note?")) return;

    try {
      const response = await fetch(
        `${API_BASE_URL}/delete_quick_note`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            patient_id: patientId,
            doctor_id: doctorId,
            priority: priority,
            si_no: parseInt(si_no),
          }),
        }
      );

      const data = await response.json();

      if (data.status === "success") {
        showSnackbar("Note deleted");
        setQuickNotes(prev => prev.filter(note => 
          !(note.si_no === si_no && note.priority === priority)
        ));
      } else {
        throw new Error(data.detail || "Failed to delete");
      }
    } catch (err) {
      console.error("Error:", err);
      showSnackbar("Failed to delete", "error");
    }
  };

  const handleUpdateNote = async (si_no, priority, newText) => {
    try {
      showSnackbar("Update requires backend implementation", "info");
      setEditingNote(null);
    } catch (err) {
      console.error("Error:", err);
      showSnackbar("Failed to update", "error");
    }
  };

  const startEditing = (note) => {
    setEditingNote(note.id);
    setEditText(note.text);
  };

  const cancelEditing = () => {
    setEditingNote(null);
    setEditText("");
  };

  const saveEditing = (si_no, priority) => {
    handleUpdateNote(si_no, priority, editText);
  };

  const getFilteredNotes = () => {
    if (!quickNotes) return [];

    let filtered = [...quickNotes];

    if (filters.search) {
      const searchLower = filters.search.toLowerCase();
      filtered = filtered.filter(note =>
        note.text?.toLowerCase().includes(searchLower) ||
        note.priority.toLowerCase().includes(searchLower)
      );
    }

    if (filters.priority !== "all") {
      filtered = filtered.filter(note => note.priority === filters.priority);
    }

    switch (filters.sortBy) {
      case "date_desc":
        filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
        break;
      case "date_asc":
        filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        break;
      case "priority":
        const priorityOrder = { Critical: 0, Medium: 1, Normal: 2 };
        filtered.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
        break;
      default:
        break;
    }

    return filtered;
  };

  const getStats = () => {
    if (!quickNotes) return { total: 0, critical: 0, medium: 0, normal: 0 };
    
    return {
      total: quickNotes.length,
      critical: quickNotes.filter(n => n.priority === "Critical").length,
      medium: quickNotes.filter(n => n.priority === "Medium").length,
      normal: quickNotes.filter(n => n.priority === "Normal").length,
    };
  };

  const stats = getStats();
  const filteredNotes = getFilteredNotes();

  if (loading) {
    return (
      <Box sx={{ ...glassCard, p: 6, display: "flex", justifyContent: "center", alignItems: "center", minHeight: 400 }}>
        <Box sx={{ textAlign: "center" }}>
          <CircularProgress size={60} sx={{ color: "#1f9a9b", mb: 2 }} />
          <Typography sx={{ color: "#1f9a9b", fontWeight: 600 }}>
            Loading notes...
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <>
      <Snackbar
        open={snackbar.open}
        autoHideDuration={3000}
        onClose={handleCloseSnackbar}
        anchorOrigin={{ vertical: "top", horizontal: "right" }}
      >
        <Alert 
          onClose={handleCloseSnackbar} 
          severity={snackbar.severity}
          sx={{ 
            ...glassCard,
            backdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.5)",
          }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>

      <Box sx={{ ...glassCard, p: 3 }}>
        {/* Header */}
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 4 }}>
          <Box>
            <Typography variant="h5" sx={{ 
              fontWeight: 800, 
              color: "#1f9a9b", 
              display: "flex", 
              alignItems: "center", 
              gap: 1.5,
              mb: 0.5,
            }}>
              <Notes sx={{ fontSize: 32, color: "#1f9a9b" }} />
              Quick Notes
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.6, ml: 4.5 }}>
              {stats.total} total notes • {stats.critical} critical • {stats.medium} medium • {stats.normal} normal
            </Typography>
          </Box>
          
          <Tooltip title="Refresh">
            <IconButton
              onClick={fetchQuickNotes}
              sx={{
                ...glassCard,
                width: 44,
                height: 44,
                color: "#1f9a9b",
                "&:hover": { 
                  transform: "rotate(90deg)",
                  background: "rgba(31, 154, 155, 0.1)",
                },
                transition: "all 0.3s ease",
              }}
            >
              <Refresh />
            </IconButton>
          </Tooltip>
        </Box>

        {/* Stats - Square Boxes */}
        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "repeat(2, 1fr)", sm: "repeat(4, 1fr)" }, gap: 2, mb: 4 }}>
          {Object.entries(stats).map(([key, count]) => {
            const priority = key.charAt(0).toUpperCase() + key.slice(1);
            const color = priorityColors[priority] || priorityColors.Normal;
            
            return (
              <motion.div
                key={key}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.2 }}
              >
                <Box sx={{ 
                  ...glassCard,
                  p: 2.5,
                  textAlign: "center",
                  borderRadius: "10px",
                  background: color.light,
                  border: `1px solid ${color.color}20`,
                }}>
                  <Typography variant="h3" sx={{ 
                    fontWeight: 900, 
                    color: color.color,
                    fontSize: { xs: 32, sm: 38 },
                    lineHeight: 1,
                    mb: 1,
                  }}>
                    {count}
                  </Typography>
                  <Typography variant="caption" sx={{ 
                    color: color.color, 
                    fontWeight: 700,
                    fontSize: 10,
                    letterSpacing: "0.5px",
                    textTransform: "uppercase",
                  }}>
                    {priority} {priority === "Total" ? "Notes" : ""}
                  </Typography>
                </Box>
              </motion.div>
            );
          })}
        </Box>

        {/* Filters */}
        <Box sx={{ display: "flex", gap: 2, mb: 4, flexWrap: "wrap" }}>
          <TextField
            size="small"
            placeholder="Search notes..."
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            InputProps={{
              startAdornment: <Search sx={{ mr: 1, opacity: 0.5, fontSize: 20 }} />,
              sx: {
                ...glassCard,
                background: "rgba(255, 255, 255, 0.7)",
                borderRadius: "8px",
                "& .MuiOutlinedInput-notchedOutline": {
                  border: "none",
                },
              }
            }}
            sx={{ 
              flex: 1, 
              minWidth: 200,
            }}
          />
          
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel sx={{ color: "rgba(0,0,0,0.6)" }}>Priority</InputLabel>
            <Select
              value={filters.priority}
              label="Priority"
              onChange={(e) => setFilters({ ...filters, priority: e.target.value })}
              sx={{ 
                ...glassCard,
                background: "rgba(255, 255, 255, 0.7)",
                borderRadius: "8px",
                "& .MuiOutlinedInput-notchedOutline": {
                  border: "none",
                },
              }}
            >
              <MenuItem value="all">All Priorities</MenuItem>
              <MenuItem value="Critical">Critical</MenuItem>
              <MenuItem value="Medium">Medium</MenuItem>
              <MenuItem value="Normal">Normal</MenuItem>
            </Select>
          </FormControl>
          
          <FormControl size="small" sx={{ minWidth: 140 }}>
            <InputLabel sx={{ color: "rgba(0,0,0,0.6)" }}>Sort By</InputLabel>
            <Select
              value={filters.sortBy}
              label="Sort By"
              onChange={(e) => setFilters({ ...filters, sortBy: e.target.value })}
              sx={{ 
                ...glassCard,
                background: "rgba(255, 255, 255, 0.7)",
                borderRadius: "8px",
                "& .MuiOutlinedInput-notchedOutline": {
                  border: "none",
                },
              }}
            >
              <MenuItem value="date_desc">Newest First</MenuItem>
              <MenuItem value="date_asc">Oldest First</MenuItem>
              <MenuItem value="priority">Priority</MenuItem>
            </Select>
          </FormControl>
        </Box>

        {/* Notes List */}
        <AnimatePresence>
          {error ? (
            <Alert severity="error" sx={{ mb: 3, ...glassCard, borderRadius: "10px" }}>
              {error}
            </Alert>
          ) : filteredNotes.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
            >
              <Box sx={{ 
                ...glassCard, 
                textAlign: "center", 
                p: 6,
                background: "rgba(255, 255, 255, 0.5)",
                borderRadius: "12px",
              }}>
                <Notes sx={{ fontSize: 64, mb: 2, opacity: 0.3, color: "#1f9a9b" }} />
                <Typography variant="h6" sx={{ mb: 1, fontWeight: 700, color: "#1f9a9b" }}>
                  No notes found
                </Typography>
                <Typography variant="body1" sx={{ mb: 3, opacity: 0.6 }}>
                  {filters.search || filters.priority !== "all" 
                    ? "Try different filters" 
                    : "Create your first quick note"}
                </Typography>
              </Box>
            </motion.div>
          ) : (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
              {filteredNotes.map((note, index) => {
                const isEditing = editingNote === note.id;
                const isExpanded = expandedNotes[note.id];
                const priorityStyle = priorityColors[note.priority] || priorityColors.Normal;
                const noteText = note.text || note.note || "";

                return (
                  <motion.div
                    key={note.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ delay: index * 0.05 }}
                  >
                    <Card
                      sx={{
                        ...glassCard,
                        background: priorityStyle.bg,
                        border: `1px solid ${priorityStyle.color}30`,
                        borderRadius: "12px",
                        position: "relative",
                        "&:hover": {
                          boxShadow: "0 12px 32px rgba(0,0,0,0.08)",
                          transform: "translateY(-2px)",
                        },
                        transition: "all 0.3s ease",
                      }}
                    >
                      <CardContent sx={{ p: 3 }}>
                        {/* Note header */}
                        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 2.5 }}>
                          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flex: 1 }}>
                            <Chip
                              label={note.priority}
                              size="small"
                              sx={{
                                background: priorityStyle.color,
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
                              <AccessTime fontSize="inherit" />
                              {formatDate(note.createdAt)}
                            </Typography>
                          </Box>
                          
                          <Typography variant="caption" sx={{ 
                            ...glassCard,
                            px: 1.5, 
                            py: 0.5, 
                            borderRadius: "6px",
                            fontWeight: 800,
                            fontSize: 10,
                            color: priorityStyle.color,
                            background: "rgba(255,255,255,0.5)",
                          }}>
                            #{note.si_no}
                          </Typography>
                        </Box>

                        {/* Note content */}
                        {isEditing ? (
                          <TextField
                            fullWidth
                            multiline
                            rows={3}
                            value={editText}
                            onChange={(e) => setEditText(e.target.value)}
                            sx={{
                              mb: 2,
                              "& .MuiOutlinedInput-root": {
                                ...glassCard,
                                background: "rgba(255, 255, 255, 0.7)",
                                borderRadius: "8px",
                              }
                            }}
                          />
                        ) : (
                          <>
                            <Typography
                              sx={{
                                whiteSpace: "pre-wrap",
                                lineHeight: 1.7,
                                fontSize: "0.95rem",
                                color: "rgba(0, 0, 0, 0.85)",
                                display: "-webkit-box",
                                WebkitLineClamp: isExpanded ? "unset" : 3,
                                WebkitBoxOrient: "vertical",
                                overflow: "hidden",
                                mb: 1.5,
                              }}
                            >
                              {noteText}
                            </Typography>
                            {noteText.length > 150 && (
                              <Button
                                size="small"
                                startIcon={isExpanded ? <VisibilityOff /> : <RemoveRedEye />}
                                onClick={() => toggleNoteExpansion(note.id)}
                                sx={{
                                  color: priorityStyle.color,
                                  fontSize: 11,
                                  fontWeight: 600,
                                  textTransform: "none",
                                  p: 0,
                                  minWidth: "auto",
                                  "&:hover": {
                                    background: "transparent",
                                    opacity: 0.8,
                                  }
                                }}
                              >
                                {isExpanded ? "Show Less" : "Read More"}
                              </Button>
                            )}
                          </>
                        )}
                      </CardContent>

                      {/* Actions */}
                      <CardActions sx={{ px: 3, pb: 2.5, pt: 0 }}>
                        {isEditing ? (
                          <>
                            <Tooltip title="Save">
                              <IconButton
                                size="small"
                                onClick={() => saveEditing(note.si_no, note.priority)}
                                sx={{
                                  ...glassCard,
                                  background: "rgba(76, 175, 80, 0.1)",
                                  color: "#4caf50",
                                  width: 36,
                                  height: 36,
                                  borderRadius: "8px",
                                  border: "1px solid rgba(76, 175, 80, 0.3)",
                                  "&:hover": { background: "rgba(76, 175, 80, 0.2)" },
                                }}
                              >
                                <Save fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Cancel">
                              <IconButton
                                size="small"
                                onClick={cancelEditing}
                                sx={{
                                  ...glassCard,
                                  background: "rgba(158, 158, 158, 0.1)",
                                  color: "#757575",
                                  width: 36,
                                  height: 36,
                                  borderRadius: "8px",
                                  border: "1px solid rgba(158, 158, 158, 0.3)",
                                  "&:hover": { background: "rgba(158, 158, 158, 0.2)" },
                                }}
                              >
                                <Cancel fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        ) : (
                          <>
                            <Tooltip title="Edit">
                              <IconButton
                                size="small"
                                onClick={() => startEditing(note)}
                                sx={{
                                  ...glassCard,
                                  background: "rgba(63, 182, 255, 0.1)",
                                  color: "#1f9a9b",
                                  width: 36,
                                  height: 36,
                                  borderRadius: "8px",
                                  border: "1px solid rgba(63, 182, 255, 0.3)",
                                  "&:hover": { background: "rgba(63, 182, 255, 0.2)" },
                                }}
                              >
                                <Edit fontSize="small" />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Delete">
                              <IconButton
                                size="small"
                                onClick={() => handleDeleteNote(note.si_no, note.priority)}
                                sx={{
                                  ...glassCard,
                                  background: "rgba(244, 67, 54, 0.1)",
                                  color: "#f44336",
                                  width: 36,
                                  height: 36,
                                  borderRadius: "8px",
                                  border: "1px solid rgba(244, 67, 54, 0.3)",
                                  "&:hover": { background: "rgba(244, 67, 54, 0.2)" },
                                }}
                              >
                                <Delete fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                      </CardActions>
                    </Card>
                  </motion.div>
                );
              })}
            </Box>
          )}
        </AnimatePresence>
      </Box>
    </>
  );
}