import React, { useEffect, useState } from "react";
import {
  Box,
  Typography,
  CircularProgress,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";

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

// ─── Helpers ──────────────────────────────────────────────────────────────────
const formatLabel = (text) => {
  if (!text) return "";
  const formatted = text.replaceAll("_", " ");
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

const formatValue = (value) => {
  if (!value) return value;
  const str = value.toString().trim();
  return str.charAt(0).toUpperCase() + str.slice(1);
};

// ─── Main Component ───────────────────────────────────────────────────────────
export default function AssertionNew({ doctorId, patientId }) {
  const [assertions, setAssertions]       = useState([]);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState(null);
  const [openDictations, setOpenDictations] = useState({});

  const API_BASE = import.meta.env.VITE_BACKEND_URL;

  const fetchAssertions = async () => {
    if (!patientId) return;
    setLoading(true);
    setError(null);
    try {
      const url = `${API_BASE}hms/users/data/context/get_assertions_by_patient?patient_id=${patientId}`;
      const res  = await fetch(url);
      const data = await res.json();

      if (data.status === "success") {
        const normalized = [];
        data.data.forEach((record) => {
          if (record.type) {
            normalized.push(record);
          }
          if (record.processed_data?.length > 0) {
            const content = record.processed_data[0].content;
            normalized.push({
              id:           record.id + "_full",
              type:         "full_content",
              data:         content,
              created_at:   record.created_at,
              dictation_id: record.id,
            });
          }
        });
        setAssertions(normalized);
      } else {
        setError("Failed to load assertions");
      }
    } catch (err) {
      console.error("Assertion fetch error:", err);
      setError("Network error while fetching assertions");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchAssertions(); }, [patientId]);

  const groupedByDictation = assertions.reduce((acc, item) => {
    const groupKey = item.dictation_id || item.conversation_id;
    if (!groupKey) return acc;
    if (!acc[groupKey]) acc[groupKey] = [];
    acc[groupKey].push(item);
    return acc;
  }, {});

  // ─── Loading ──────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Box sx={{ py: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
        <CircularProgress size={20} thickness={1.5} sx={{ color: C.black }} />
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.08em", textTransform: "uppercase" }) }}>
          Loading assertions...
        </Typography>
      </Box>
    );
  }

  // ─── Error ────────────────────────────────────────────────────────────────
  if (error) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mb: 2 }) }}>{error}</Typography>
        <Box
          component="button"
          onClick={fetchAssertions}
          sx={{
            fontFamily: FONT, fontWeight: FW_REGULAR, fontSize: 11,
            color: C.black, background: "transparent",
            border: `1px solid ${C.mist}`,
            px: 2.5, py: 0.9, cursor: "pointer",
            letterSpacing: "0.05em", textTransform: "uppercase",
            transition: "all 0.2s",
            "&:hover": { background: C.ghost, borderColor: C.black },
          }}
        >
          <RefreshIcon sx={{ fontSize: 12, mr: 0.5, verticalAlign: "middle" }} />
          Retry
        </Box>
      </Box>
    );
  }

  // ─── Empty ────────────────────────────────────────────────────────────────
  if (!loading && assertions.length === 0) {
    return (
      <Box sx={{ py: 6, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.ash, letterSpacing: "0.05em" }) }}>
          No assertions found for this patient
        </Typography>
      </Box>
    );
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  return (
    <>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <Box sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        mb: 2.5, pb: 2, borderBottom: `1px solid ${C.mist}`,
        flexWrap: "wrap", gap: 1,
      }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.12em", textTransform: "uppercase", mb: 0.4 }) }}>
            Patient Assertions
          </Typography>
          <Typography sx={{ ...os({ fontSize: 13, color: C.black, fontWeight: FW_REGULAR }) }}>
            {Object.keys(groupedByDictation).length} session{Object.keys(groupedByDictation).length !== 1 ? "s" : ""}
          </Typography>
        </Box>

        <Box
          component="button"
          onClick={fetchAssertions}
          sx={{
            width: 32, height: 32, display: "flex", alignItems: "center", justifyContent: "center",
            background: "transparent", border: `1px solid ${C.mist}`,
            cursor: "pointer", color: C.ash, transition: "all 0.2s",
            "&:hover": { background: C.ghost, borderColor: C.black, color: C.black },
          }}
        >
          <RefreshIcon sx={{ fontSize: 13 }} />
        </Box>
      </Box>

      {/* Dictation groups */}
      {Object.keys(groupedByDictation).map((dictationId) => {
        const items  = groupedByDictation[dictationId];
        const isOpen = openDictations[dictationId];

        return (
          <Box key={dictationId} sx={{ mb: 1.5, border: `1px solid ${C.mist}`, transition: "border-color 0.2s", "&:hover": { borderColor: C.black } }}>

            {/* ─── Collapsible header ──────────────────────────────────── */}
            <Box
              onClick={() =>
                setOpenDictations((prev) => ({ ...prev, [dictationId]: !prev[dictationId] }))
              }
              sx={{
                px: 2, py: 1.5,
                display: "flex", alignItems: "center", justifyContent: "space-between",
                cursor: "pointer",
                background: isOpen ? C.ghost : C.white,
                borderBottom: isOpen ? `1px solid ${C.mist}` : "none",
                transition: "background 0.15s",
                "&:hover": { background: C.ghost },
                userSelect: "none",
              }}
            >
              <Box>
                <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, letterSpacing: "0.05em", textTransform: "uppercase" }) }}>
                  Patient Assertions
                </Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
                  {new Date(items[0].created_at).toLocaleString("en-GB", {
                    day: "2-digit", month: "short", year: "numeric",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </Typography>
              </Box>

              <ExpandMoreIcon
                sx={{
                  fontSize: 14, color: C.ash,
                  transition: "transform 0.2s",
                  transform: isOpen ? "rotate(180deg)" : "rotate(0deg)",
                }}
              />
            </Box>

            {/* ─── Collapsible content ─────────────────────────────────── */}
            {isOpen && (
              <Box sx={{ px: 2, py: 2 }}>
                {Object.entries(
                  items.reduce((acc, item) => {
                    if (!acc[item.type]) acc[item.type] = [];
                    acc[item.type].push(item);
                    return acc;
                  }, {})
                ).map(([type, typeItems]) => (
                  <Box key={type} sx={{ mb: 2.5, pb: 2.5, borderBottom: `1px solid ${C.mist}`, "&:last-child": { borderBottom: "none", mb: 0, pb: 0 } }}>

                    {/* Type label */}
                    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", mb: 1.5 }) }}>
                      {formatLabel(type)}
                    </Typography>

                    {typeItems.map((item) => (
                      <Box key={item.id} sx={{ mb: 2, "&:last-child": { mb: 0 } }}>

                        {/* Data fields */}
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 0 }}>
                          {Object.entries(item.data).map(([key, value]) => {
                            if (!value) return null;

                            // Array values
                            if (Array.isArray(value)) {
                              return (
                                <Box key={key} sx={{ display: "flex", gap: 1, py: 0.75, borderBottom: `1px solid ${C.mist}`, flexWrap: "wrap", alignItems: "flex-start" }}>
                                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 120, letterSpacing: "0.03em" }) }}>
                                    {formatLabel(key)}
                                  </Typography>
                                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                                    {value.map((val, index) => (
                                      <Box
                                        key={index}
                                        sx={{
                                          px: 1.25, py: 0.3,
                                          border: `1px solid ${C.mist}`,
                                          background: C.ghost,
                                        }}
                                      >
                                        <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontWeight: FW_REGULAR }) }}>
                                          {formatValue(val)}
                                        </Typography>
                                      </Box>
                                    ))}
                                  </Box>
                                </Box>
                              );
                            }

                            // Object values
                            if (typeof value === "object") {
                              return (
                                <Box key={key} sx={{ py: 0.75, borderBottom: `1px solid ${C.mist}` }}>
                                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.03em", mb: 0.5 }) }}>
                                    {formatLabel(key)}
                                  </Typography>
                                  {Object.entries(value).map(([subKey, subVal]) => (
                                    <Box key={subKey} sx={{ display: "flex", gap: 1, ml: 1.5, mb: 0.4 }}>
                                      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 100 }) }}>
                                        {formatLabel(subKey)}
                                      </Typography>
                                      <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontWeight: FW_REGULAR }) }}>
                                        {formatValue(subVal)}
                                      </Typography>
                                    </Box>
                                  ))}
                                </Box>
                              );
                            }

                            // Normal string / number
                            return (
                              <Box key={key} sx={{ display: "flex", gap: 1, py: 0.75, borderBottom: `1px solid ${C.mist}` }}>
                                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 120, letterSpacing: "0.03em" }) }}>
                                  {formatLabel(key)}
                                </Typography>
                                <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontWeight: FW_REGULAR }) }}>
                                  {formatValue(value)}
                                </Typography>
                              </Box>
                            );
                          })}
                        </Box>

                        {/* Timestamp */}
                        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 1, letterSpacing: "0.03em" }) }}>
                          {new Date(item.created_at).toLocaleString()}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        );
      })}
    </>
  );
} 