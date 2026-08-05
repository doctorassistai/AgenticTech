import React, { useState, useEffect, useRef } from "react";
import {
    Box,
    Card,
    CardContent,
    Typography,
    TextField,
    InputAdornment,
    IconButton,
    Chip,
    Paper,
    Stack,
    Divider,
    Alert,
    AlertTitle,
    CircularProgress,
    Button,
    Collapse,
    Menu,
    MenuItem,
    Tooltip,
    Badge,
    Avatar,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import MicIcon from "@mui/icons-material/Mic";
import MicOffIcon from "@mui/icons-material/MicOff";
import TimelineIcon from "@mui/icons-material/Timeline";
import FilterListIcon from "@mui/icons-material/FilterList";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import LocalHospitalIcon from "@mui/icons-material/LocalHospital";
import ScienceIcon from "@mui/icons-material/Science";
import MedicationIcon from "@mui/icons-material/Medication";
import ImageIcon from "@mui/icons-material/Image";
import DescriptionIcon from "@mui/icons-material/Description";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import TrendingDownIcon from "@mui/icons-material/TrendingDown";
import TrendingFlatIcon from "@mui/icons-material/TrendingFlat";
import CalendarTodayIcon from "@mui/icons-material/CalendarToday";
import PlayArrowIcon from "@mui/icons-material/PlayArrow";
import PauseIcon from "@mui/icons-material/Pause";

/* ============================================================================
   SPEECH RECOGNITION HOOK
   ============================================================================ */

const useSpeechRecognition = () => {
    const [isListening, setIsListening] = useState(false);
    const [transcript, setTranscript] = useState("");
    const recognitionRef = useRef(null);

    useEffect(() => {
        if (!("webkitSpeechRecognition" in window) && !("SpeechRecognition" in window)) {
            console.warn("Speech recognition not supported");
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        recognitionRef.current = new SpeechRecognition();
        recognitionRef.current.continuous = false;
        recognitionRef.current.interimResults = false;
        recognitionRef.current.lang = "en-US";

        recognitionRef.current.onresult = (event) => {
            const speechResult = event.results[0][0].transcript;
            setTranscript(speechResult);
            setIsListening(false);
        };

        recognitionRef.current.onerror = (event) => {
            console.error("Speech recognition error:", event.error);
            setIsListening(false);
        };

        recognitionRef.current.onend = () => {
            setIsListening(false);
        };

        return () => {
            if (recognitionRef.current) {
                recognitionRef.current.stop();
            }
        };
    }, []);

    const startListening = () => {
        if (recognitionRef.current && !isListening) {
            setTranscript("");
            recognitionRef.current.start();
            setIsListening(true);
        }
    };

    const stopListening = () => {
        if (recognitionRef.current && isListening) {
            recognitionRef.current.stop();
            setIsListening(false);
        }
    };

    return { isListening, transcript, startListening, stopListening };
};

/* ============================================================================
   EVENT TYPE CONFIGURATION
   ============================================================================ */

const EVENT_TYPES = {
    lab: {
        icon: <ScienceIcon />,
        color: "#3b82f6",
        bgColor: "#dbeafe",
        label: "Laboratory",
    },
    imaging: {
        icon: <ImageIcon />,
        color: "#8b5cf6",
        bgColor: "#ede9fe",
        label: "Imaging",
    },
    procedure: {
        icon: <LocalHospitalIcon />,
        color: "#ef4444",
        bgColor: "#fee2e2",
        label: "Procedure",
    },
    treatment: {
        icon: <MedicationIcon />,
        color: "#10b981",
        bgColor: "#d1fae5",
        label: "Treatment",
    },
    medication_change: {
        icon: <MedicationIcon />,
        color: "#f59e0b",
        bgColor: "#fef3c7",
        label: "Medication",
    },
    clinical_note: {
        icon: <DescriptionIcon />,
        color: "#6366f1",
        bgColor: "#e0e7ff",
        label: "Clinical Note",
    },
    pathology: {
        icon: <ScienceIcon />,
        color: "#ec4899",
        bgColor: "#fce7f3",
        label: "Pathology",
    },
};

/* ============================================================================
   TIMELINE EVENT CARD
   ============================================================================ */

const TimelineEventCard = ({ event, isFirst, isLast, searchTerm }) => {
    const [expanded, setExpanded] = useState(false);
    const eventConfig = EVENT_TYPES[event.type] || EVENT_TYPES.clinical_note;

    const highlightText = (text) => {
        if (!searchTerm || !text) return text;

        const regex = new RegExp(`(${searchTerm})`, "gi");
        const parts = text.split(regex);

        return parts.map((part, index) =>
            regex.test(part) ? (
                <span key={index} style={{ backgroundColor: "#fef08a", fontWeight: 700 }}>
                    {part}
                </span>
            ) : (
                part
            )
        );
    };

    return (
        <Box position="relative" pl={4} pb={isLast ? 0 : 4}>
            {/* Timeline Line */}
            {!isLast && (
                <Box
                    position="absolute"
                    left="15px"
                    top="40px"
                    bottom="0"
                    width="2px"
                    sx={{
                        background: `linear-gradient(to bottom, ${eventConfig.color}, ${eventConfig.color}50)`,
                    }}
                />
            )}

            {/* Timeline Dot */}
            <Box
                position="absolute"
                left="0"
                top="8px"
                width="32px"
                height="32px"
                borderRadius="50%"
                display="flex"
                alignItems="center"
                justifyContent="center"
                sx={{
                    backgroundColor: eventConfig.bgColor,
                    border: `3px solid ${eventConfig.color}`,
                    boxShadow: `0 0 0 4px ${eventConfig.bgColor}`,
                }}
            >
                {React.cloneElement(eventConfig.icon, {
                    sx: { fontSize: "1rem", color: eventConfig.color },
                })}
            </Box>

            {/* Event Card */}
            <Paper
                elevation={2}
                sx={{
                    borderRadius: 2,
                    overflow: "hidden",
                    borderLeft: `4px solid ${eventConfig.color}`,
                    transition: "all 0.2s",
                    "&:hover": {
                        transform: "translateX(4px)",
                        boxShadow: 4,
                    },
                }}
            >
                <Box
                    sx={{
                        backgroundColor: eventConfig.bgColor,
                        p: 1.5,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                    }}
                >
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Chip
                            size="small"
                            label={eventConfig.label}
                            sx={{
                                backgroundColor: eventConfig.color,
                                color: "#fff",
                                fontWeight: 700,
                                fontSize: "0.7rem",
                            }}
                        />
                        {event.subtype && (
                            <Chip
                                size="small"
                                label={event.subtype.toUpperCase()}
                                sx={{
                                    backgroundColor: "#fff",
                                    fontWeight: 600,
                                    fontSize: "0.65rem",
                                }}
                            />
                        )}
                        <Typography fontSize="0.75rem" color="#64748b" fontWeight={600}>
                            <CalendarTodayIcon sx={{ fontSize: "0.7rem", mr: 0.5, verticalAlign: "middle" }} />
                            {event.date}
                        </Typography>
                    </Stack>

                    <IconButton
                        size="small"
                        onClick={() => setExpanded(!expanded)}
                        sx={{ color: eventConfig.color }}
                    >
                        {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                    </IconButton>
                </Box>

                <CardContent sx={{ p: 2 }}>
                    <Typography
                        fontSize="0.9rem"
                        color="#1e293b"
                        fontWeight={600}
                        lineHeight={1.6}
                        sx={{ mb: 1 }}
                    >
                        {highlightText(event.summary)}
                    </Typography>

                    <Collapse in={expanded}>
                        {event.influenced && event.influenced.length > 0 && (
                            <Box mt={2} p={1.5} sx={{ backgroundColor: "#f8fafc", borderRadius: 1 }}>
                                <Typography fontSize="0.75rem" fontWeight={700} color="#475569" mb={0.5}>
                                    🔗 Clinical Impact (Led to):
                                </Typography>
                                {event.influenced.map((inf, idx) => (
                                    <Typography key={idx} fontSize="0.75rem" color="#64748b" sx={{ pl: 1 }}>
                                        → {highlightText(inf)}
                                    </Typography>
                                ))}
                            </Box>
                        )}

                        {event.next && (
                            <Box mt={1} p={1.5} sx={{ backgroundColor: "#fefce8", borderRadius: 1 }}>
                                <Typography fontSize="0.75rem" fontWeight={700} color="#854d0e" mb={0.5}>
                                    ⏭️ Next Event:
                                </Typography>
                                <Typography fontSize="0.75rem" color="#a16207">
                                    {highlightText(event.next)}
                                </Typography>
                            </Box>
                        )}

                        {event.data && Object.keys(event.data).length > 0 && (
                            <Box mt={1}>
                                <Button
                                    size="small"
                                    sx={{ fontSize: "0.7rem", textTransform: "none" }}
                                    onClick={() => console.log("View full details", event.data)}
                                >
                                    View Full Details →
                                </Button>
                            </Box>
                        )}
                    </Collapse>
                </CardContent>
            </Paper>
        </Box>
    );
};

/* ============================================================================
   EPISODE NARRATIVE CARD
   ============================================================================ */

const EpisodeNarrativeCard = ({ episode, searchTerm }) => {
    const [expanded, setExpanded] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const speechSynthesisRef = useRef(null);

    const highlightText = (text) => {
        if (!searchTerm || !text) return text;

        const regex = new RegExp(`(${searchTerm})`, "gi");
        const parts = text.split(regex);

        return parts.map((part, index) =>
            regex.test(part) ? (
                <span key={index} style={{ backgroundColor: "#fef08a", fontWeight: 700 }}>
                    {part}
                </span>
            ) : (
                part
            )
        );
    };

    const handleTextToSpeech = () => {
        if (!episode.narrative) return;

        if (isPlaying) {
            window.speechSynthesis.cancel();
            setIsPlaying(false);
            return;
        }

        const utterance = new SpeechSynthesisUtterance(episode.narrative);
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;

        utterance.onend = () => {
            setIsPlaying(false);
        };

        window.speechSynthesis.speak(utterance);
        setIsPlaying(true);
    };

    return (
        <Paper
            elevation={3}
            sx={{
                mb: 3,
                borderRadius: 3,
                overflow: "hidden",
                borderLeft: "6px solid #0ea5e9",
                backgroundColor: "#f0f9ff",
            }}
        >
            <Box
                sx={{
                    background: "linear-gradient(135deg, #0ea5e9 0%, #0284c7 100%)",
                    p: 2,
                    color: "#fff",
                }}
            >
                <Stack direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                        <Typography fontSize="1.1rem" fontWeight={800}>
                            Episode {episode.episode_number}
                        </Typography>
                        <Typography fontSize="0.8rem" sx={{ opacity: 0.9 }}>
                            {episode.start_date} to {episode.end_date} • {episode.duration_days} days • {episode.event_count} events
                        </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                        <Tooltip title={isPlaying ? "Stop Reading" : "Read Aloud"}>
                            <IconButton
                                size="small"
                                onClick={handleTextToSpeech}
                                sx={{
                                    backgroundColor: "rgba(255,255,255,0.2)",
                                    color: "#fff",
                                    "&:hover": { backgroundColor: "rgba(255,255,255,0.3)" },
                                }}
                            >
                                {isPlaying ? <PauseIcon /> : <PlayArrowIcon />}
                            </IconButton>
                        </Tooltip>
                        <IconButton
                            size="small"
                            onClick={() => setExpanded(!expanded)}
                            sx={{
                                backgroundColor: "rgba(255,255,255,0.2)",
                                color: "#fff",
                                "&:hover": { backgroundColor: "rgba(255,255,255,0.3)" },
                            }}
                        >
                            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                        </IconButton>
                    </Stack>
                </Stack>
            </Box>

            <CardContent sx={{ p: 3 }}>
                <Typography
                    fontSize="0.95rem"
                    color="#0c4a6e"
                    lineHeight={1.8}
                    fontWeight={500}
                    sx={{
                        fontStyle: "italic",
                        borderLeft: "3px solid #0ea5e9",
                        pl: 2,
                        py: 1,
                    }}
                >
                    {highlightText(episode.narrative)}
                </Typography>

                <Collapse in={expanded}>
                    <Divider sx={{ my: 2 }} />
                    <Typography fontSize="0.8rem" fontWeight={700} color="#075985" mb={1}>
                        Episode Summary Statistics:
                    </Typography>
                    <Stack direction="row" spacing={2} flexWrap="wrap">
                        <Chip label={`${episode.event_count} Events`} size="small" />
                        <Chip label={`${episode.duration_days} Days`} size="small" />
                    </Stack>
                </Collapse>
            </CardContent>
        </Paper>
    );
};

/* ============================================================================
   MAIN LONGITUDINAL TIMELINE COMPONENT
   ============================================================================ */

const LongitudinalPatientTimeline = ({ patientId, doctorId, trigger }) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [data, setData] = useState(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedFilters, setSelectedFilters] = useState([]);
    const [filterAnchor, setFilterAnchor] = useState(null);
    const [viewMode, setViewMode] = useState("timeline"); // timeline | episodes
    const API_BASE = import.meta.env.VITE_BACKEND_URL

    const { isListening, transcript, startListening, stopListening } = useSpeechRecognition();

    // Update search term when speech recognition completes
    useEffect(() => {
        if (transcript) {
            setSearchTerm(transcript);
        }
    }, [transcript]);

    useEffect(() => {
        if (!patientId || !doctorId || trigger === undefined) return;

        const fetchData = async () => {
            setLoading(true);
            setError(null);

            try {
                const response = await fetch(
                    `${API_BASE}hms/users/ai-legacy/clinical-reasoning-enhanced`,
                    {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            patient_id: patientId,
                            doctor_id: doctorId,
                            consultation_text: "Generate longitudinal story",
                        }),
                    }
                );

                if (!response.ok) throw new Error("Failed to fetch patient story");

                const result = await response.json();
                setData(result.longitudinal_story);
            } catch (err) {
                setError(err.message || "Something went wrong");
            } finally {
                setLoading(false);
            }
        };

        fetchData();
    }, [patientId, doctorId, trigger]);

    // Filter events based on search and type filters
    const filteredEvents = data?.timeline_events?.filter((event) => {
        const matchesSearch = !searchTerm ||
            event.summary?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            event.type?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            event.subtype?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            event.date?.toLowerCase().includes(searchTerm.toLowerCase());

        const matchesFilter = selectedFilters.length === 0 || selectedFilters.includes(event.type);

        return matchesSearch && matchesFilter;
    }) || [];

    const handleFilterClick = (event) => {
        setFilterAnchor(event.currentTarget);
    };

    const handleFilterClose = () => {
        setFilterAnchor(null);
    };

    const toggleFilter = (type) => {
        setSelectedFilters((prev) =>
            prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]
        );
    };

    /* ============================================================================
       LOADING & ERROR STATES
       ============================================================================ */

    if (loading) {
        return (
            <Box display="flex" flexDirection="column" alignItems="center" gap={2} p={4}>
                <CircularProgress size={50} />
                <Typography fontSize="1.1rem" color="#1e293b" fontWeight={700}>
                    Generating Patient Story...
                </Typography>
                <Typography fontSize="0.9rem" color="#64748b">
                    Analyzing complete medical journey with AI-powered insights
                </Typography>
            </Box>
        );
    }

    if (error) {
        return (
            <Alert severity="error" sx={{ m: 3 }}>
                <AlertTitle>Error</AlertTitle>
                {error}
            </Alert>
        );
    }

    if (!data) return null;

    const { complete_story, episode_narratives = [], insights = {} } = data;

    /* ============================================================================
       RENDER TIMELINE
       ============================================================================ */

    return (
        <Box sx={{ maxWidth: 1200, mx: "auto", p: 3, fontFamily: '"Inter", sans-serif' }}>

            {/* Header */}
            <Card elevation={3} sx={{ mb: 3, borderRadius: 3, background: "linear-gradient(135deg, #1e293b 0%, #0f172a 100%)" }}>
                <CardContent sx={{ p: 3 }}>
                    <Stack direction="row" alignItems="center" spacing={2} mb={2}>
                        <TimelineIcon sx={{ fontSize: "2rem", color: "#0ea5e9" }} />
                        <Box>
                            <Typography fontSize="1.5rem" fontWeight={800} color="#fff">
                                Longitudinal Patient Journey
                            </Typography>
                            <Typography fontSize="0.85rem" color="#cbd5e1">
                                Patient ID: {data.patient_id} • {data.total_events} Events • {data.total_episodes} Episodes
                            </Typography>
                        </Box>
                    </Stack>

                    {/* Search Bar with Voice Input */}
                    <TextField
                        fullWidth
                        placeholder="Search events (e.g., 'CT scan', 'creatinine', 'procedure')..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        InputProps={{
                            startAdornment: (
                                <InputAdornment position="start">
                                    <SearchIcon sx={{ color: "#64748b" }} />
                                </InputAdornment>
                            ),
                            endAdornment: (
                                <InputAdornment position="end">
                                    <Tooltip title={isListening ? "Stop listening" : "Voice search"}>
                                        <IconButton
                                            onClick={isListening ? stopListening : startListening}
                                            sx={{
                                                color: isListening ? "#ef4444" : "#64748b",
                                                animation: isListening ? "pulse 1.5s infinite" : "none",
                                                "@keyframes pulse": {
                                                    "0%, 100%": { opacity: 1 },
                                                    "50%": { opacity: 0.5 },
                                                },
                                            }}
                                        >
                                            {isListening ? <MicIcon /> : <MicOffIcon />}
                                        </IconButton>
                                    </Tooltip>
                                    <Tooltip title="Filter by type">
                                        <IconButton onClick={handleFilterClick} sx={{ color: "#64748b" }}>
                                            <Badge badgeContent={selectedFilters.length} color="primary">
                                                <FilterListIcon />
                                            </Badge>
                                        </IconButton>
                                    </Tooltip>
                                </InputAdornment>
                            ),
                        }}
                        sx={{
                            backgroundColor: "#fff",
                            borderRadius: 2,
                            "& .MuiOutlinedInput-root": {
                                "& fieldset": { borderColor: "#e2e8f0" },
                                "&:hover fieldset": { borderColor: "#cbd5e1" },
                                "&.Mui-focused fieldset": { borderColor: "#0ea5e9" },
                            },
                        }}
                    />

                    {/* Filter Menu */}
                    <Menu
                        anchorEl={filterAnchor}
                        open={Boolean(filterAnchor)}
                        onClose={handleFilterClose}
                    >
                        {Object.entries(EVENT_TYPES).map(([type, config]) => (
                            <MenuItem key={type} onClick={() => toggleFilter(type)}>
                                <Stack direction="row" spacing={1} alignItems="center">
                                    {React.cloneElement(config.icon, { sx: { color: config.color } })}
                                    <Typography fontSize="0.85rem">{config.label}</Typography>
                                    {selectedFilters.includes(type) && (
                                        <Typography fontSize="0.85rem" color="primary">✓</Typography>
                                    )}
                                </Stack>
                            </MenuItem>
                        ))}
                    </Menu>

                    {/* Active Filters */}
                    {selectedFilters.length > 0 && (
                        <Box mt={2} display="flex" flexWrap="wrap" gap={1}>
                            {selectedFilters.map((type) => (
                                <Chip
                                    key={type}
                                    label={EVENT_TYPES[type].label}
                                    onDelete={() => toggleFilter(type)}
                                    size="small"
                                    sx={{
                                        backgroundColor: EVENT_TYPES[type].bgColor,
                                        color: EVENT_TYPES[type].color,
                                        fontWeight: 600,
                                    }}
                                />
                            ))}
                            <Chip
                                label="Clear All"
                                onClick={() => setSelectedFilters([])}
                                size="small"
                                variant="outlined"
                            />
                        </Box>
                    )}

                    {isListening && (
                        <Alert severity="info" sx={{ mt: 2 }}>
                            <Typography fontSize="0.85rem">🎤 Listening... Speak now</Typography>
                        </Alert>
                    )}
                </CardContent>
            </Card>

            {/* Insights Summary */}
            {insights && Object.keys(insights).length > 0 && (
                <Card elevation={2} sx={{ mb: 3, borderRadius: 3, borderLeft: "6px solid #10b981" }}>
                    <CardContent sx={{ p: 2 }}>
                        <Typography fontSize="1rem" fontWeight={700} color="#166534" mb={1.5}>
                            📊 Clinical Trajectory Insights
                        </Typography>
                        <Grid container spacing={2}>
                            <Grid item xs={12} sm={6} md={3}>
                                <Paper elevation={0} sx={{ p: 1.5, backgroundColor: "#f0fdf4", borderRadius: 2, textAlign: "center" }}>
                                    <Typography fontSize="0.7rem" color="#166534" fontWeight={600}>TRAJECTORY</Typography>
                                    <Stack direction="row" alignItems="center" justifyContent="center" spacing={0.5} mt={0.5}>
                                        {insights.trajectory === "improving" && <TrendingUpIcon sx={{ color: "#10b981" }} />}
                                        {insights.trajectory === "declining" && <TrendingDownIcon sx={{ color: "#ef4444" }} />}
                                        {insights.trajectory === "stable" && <TrendingFlatIcon sx={{ color: "#64748b" }} />}
                                        <Typography fontSize="0.9rem" fontWeight={700} color="#166534">
                                            {insights.trajectory?.toUpperCase()}
                                        </Typography>
                                    </Stack>
                                </Paper>
                            </Grid>
                            <Grid item xs={12} sm={6} md={3}>
                                <Paper elevation={0} sx={{ p: 1.5, backgroundColor: "#fef3c7", borderRadius: 2, textAlign: "center" }}>
                                    <Typography fontSize="0.7rem" color="#92400e" fontWeight={600}>TREATMENT RESPONSE</Typography>
                                    <Typography fontSize="0.9rem" fontWeight={700} color="#92400e" mt={0.5}>
                                        {insights.treatment_response?.toUpperCase()}
                                    </Typography>
                                </Paper>
                            </Grid>
                            <Grid item xs={12} sm={12} md={6}>
                                <Paper elevation={0} sx={{ p: 1.5, backgroundColor: "#f0f9ff", borderRadius: 2 }}>
                                    <Typography fontSize="0.7rem" color="#075985" fontWeight={600}>CURRENT STATE</Typography>
                                    <Typography fontSize="0.8rem" color="#0c4a6e" mt={0.5}>
                                        {insights.current_state_summary}
                                    </Typography>
                                </Paper>
                            </Grid>
                        </Grid>

                        {insights.key_turning_points && insights.key_turning_points.length > 0 && (
                            <Box mt={2}>
                                <Typography fontSize="0.8rem" fontWeight={700} color="#075985" mb={0.5}>
                                    🔑 Key Turning Points:
                                </Typography>
                                {insights.key_turning_points.map((point, idx) => (
                                    <Typography key={idx} fontSize="0.75rem" color="#64748b" sx={{ pl: 1 }}>
                                        • {point}
                                    </Typography>
                                ))}
                            </Box>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Complete Story Narrative */}
            {complete_story && (
                <Card elevation={2} sx={{ mb: 3, borderRadius: 3, borderLeft: "6px solid #0ea5e9" }}>
                    <CardContent sx={{ p: 3 }}>
                        <Typography fontSize="1.1rem" fontWeight={700} color="#0c4a6e" mb={2}>
                            📖 Complete Patient Story
                        </Typography>
                        <Typography
                            fontSize="0.95rem"
                            color="#1e293b"
                            lineHeight={1.8}
                            sx={{
                                whiteSpace: "pre-line",
                                borderLeft: "4px solid #0ea5e9",
                                pl: 2,
                                py: 1,
                                backgroundColor: "#f0f9ff",
                                borderRadius: 1,
                            }}
                        >
                            {complete_story}
                        </Typography>
                    </CardContent>
                </Card>
            )}

            {/* View Mode Toggle */}
            <Stack direction="row" spacing={1} mb={2}>
                <Button
                    variant={viewMode === "timeline" ? "contained" : "outlined"}
                    onClick={() => setViewMode("timeline")}
                    size="small"
                >
                    Timeline View
                </Button>
                <Button
                    variant={viewMode === "episodes" ? "contained" : "outlined"}
                    onClick={() => setViewMode("episodes")}
                    size="small"
                >
                    Episode Narratives
                </Button>
            </Stack>

            {/* Episode Narratives View */}
            {viewMode === "episodes" && (
                <Box>
                    <Typography fontSize="1.1rem" fontWeight={700} color="#1e293b" mb={2}>
                        📚 Episode Narratives ({episode_narratives.length} Episodes)
                    </Typography>
                    {episode_narratives.map((episode) => (
                        <EpisodeNarrativeCard key={episode.episode_number} episode={episode} searchTerm={searchTerm} />
                    ))}
                </Box>
            )}

            {/* Timeline Events View */}
            {viewMode === "timeline" && (
                <Box>
                    <Typography fontSize="1.1rem" fontWeight={700} color="#1e293b" mb={2}>
                        📅 Chronological Timeline ({filteredEvents.length} Events)
                    </Typography>

                    {searchTerm && (
                        <Alert severity="info" sx={{ mb: 2 }}>
                            Showing {filteredEvents.length} events matching "{searchTerm}"
                        </Alert>
                    )}

                    {filteredEvents.length === 0 ? (
                        <Alert severity="warning">
                            No events match your search criteria. Try different keywords or clear filters.
                        </Alert>
                    ) : (
                        <Box>
                            {filteredEvents.map((event, idx) => (
                                <TimelineEventCard
                                    key={idx}
                                    event={event}
                                    isFirst={idx === 0}
                                    isLast={idx === filteredEvents.length - 1}
                                    searchTerm={searchTerm}
                                />
                            ))}
                        </Box>
                    )}
                </Box>
            )}
        </Box>
    );
};

export default LongitudinalPatientTimeline;