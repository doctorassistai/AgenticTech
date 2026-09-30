// NextClinicalDecision.jsx
import React, { useState } from "react";
import { Box, Typography, Button, CircularProgress } from "@mui/material";
import { motion } from "framer-motion";

const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = {
  black:    "#000",
  charcoal: "#444",
  ash:      "#888",
  mist:     "#e0e0e0",
  ghost:    "#fafafa",
  white:    "#fff",
};
const os = (x = {}) => ({
  fontFamily: FONT,
  fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased",
  ...x,
});

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

/* ─── Presentational helpers (unchanged) ─────────────────── */
const InfoRow = ({ label, value }) => (
  <Box sx={{ display:"flex", gap:1, py:0.4, borderBottom:`1px solid ${C.mist}` }}>
    <Typography sx={{ ...os({ fontSize:11, color:C.ash, minWidth:150 }) }}>{label}</Typography>
    <Typography sx={{ ...os({ fontSize:11, color:C.charcoal, fontWeight:FW_REGULAR, flex:1 }) }}>{value || "—"}</Typography>
  </Box>
);

const Marker = () => (
  <Box sx={{
    width:11, height:11, mt:0.6, borderRadius:"50%",
    border:`1.5px solid ${C.black}`,
    background:`linear-gradient(90deg,${C.black} 50%,transparent 50%)`,
    flexShrink:0,
  }} />
);

/* ─── Main component ────────────────────────────────────── */
export default function NextClinicalDecision({
  patientId,
  doctorId,
  specialty,
  patientName,
  onClose,
  onAction, // optional: (actionKey) => void — lets the parent react to button clicks
}) {
  const [data, setData]         = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [generated, setGenerated] = useState(false);

  const handleGenerate = async () => {
    if (!patientId || !doctorId) {
      setError("Select a patient and a doctor first.");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);

    try {
      const url = new URL(
        `${API_BASE_URL}hms/users/ai-legacy/next-clinical-decision/${encodeURIComponent(patientId)}`
      );
      url.searchParams.set("doctor_id", doctorId);
      if (specialty) url.searchParams.set("specialty", specialty);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(text || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setData(json);
      setGenerated(true);
    } catch (err) {
      console.error("[NextClinicalDecision] fetch failed:", err);
      setError(err.message || "Failed to load next clinical decision.");
    } finally {
      setLoading(false);
    }
  };

  if (!patientId || !doctorId) {
    return (
      <Box sx={{ p:4, textAlign:"center" }}>
        <Typography sx={{ ...os({ fontSize:13, color:C.ash }) }}>
          Select a patient to view the next clinical decision.
        </Typography>
      </Box>
    );
  }

  const hero    = data?.hero    || {};
  const fields  = data?.fields  || [];
  const points  = data?.points  || [];
  const actions = data?.actions || [];

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Generate button bar */}
      <Box sx={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        gap:2, pb:2, mb:3, borderBottom:`1px solid ${C.mist}`,
      }}>
        <Typography sx={{
          ...os({ fontSize:11, color:C.ash, letterSpacing:"0.1em", textTransform:"uppercase" }),
        }}>
          {patientName ? `${patientName} / Next clinical decision` : "Next clinical decision"}
        </Typography>

        <Box sx={{ display:"flex", gap:1 }}>
          <Button
            onClick={handleGenerate}
            disabled={loading}
            variant="outlined"
            size="small"
            sx={{
              fontFamily:FONT, fontWeight:600, fontSize:11, letterSpacing:"0.08em",
              textTransform:"uppercase", color:C.black, borderColor:C.black,
              px:2, py:0.5, minWidth:"auto",
              "&:hover":{ backgroundColor:C.black, color:C.white, borderColor:C.black },
              "&.Mui-disabled":{ color:C.ash, borderColor:C.mist },
            }}
          >
            {loading ? "Generating…" : generated ? "Regenerate" : "Generate Decision"}
          </Button>
          {onClose && (
            <Button
              onClick={onClose}
              variant="text"
              size="small"
              sx={{
                fontFamily:FONT, fontWeight:600, fontSize:11, letterSpacing:"0.08em",
                textTransform:"uppercase", color:C.ash, px:1.5, py:0.5, minWidth:"auto",
                "&:hover":{ color:C.black, backgroundColor:"transparent" },
              }}
            >
              Close
            </Button>
          )}
        </Box>
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ p:6, display:"flex", flexDirection:"column", alignItems:"center", gap:2 }}>
          <CircularProgress size={22} sx={{ color:C.black }} />
          <Typography sx={{ ...os({ fontSize:12, color:C.ash }) }}>
            Routing the next clinical decision…
          </Typography>
        </Box>
      )}

      {/* Error */}
      {!loading && error && (
        <Box sx={{ p:2, mb:3, border:"1px solid #ffcdd2", background:"#fce4ec" }}>
          <Typography sx={{ ...os({ fontSize:12, color:"#c62828", fontWeight:FW_REGULAR }) }}>
            {error}
          </Typography>
        </Box>
      )}

      {/* Empty state */}
      {!loading && !error && !data && (
        <Box sx={{
          p:6, textAlign:"center",
          border:`1px dashed ${C.mist}`, background:C.ghost,
        }}>
          <Typography sx={{ ...os({ fontSize:13, color:C.charcoal, mb:1 }) }}>
            No decision generated yet.
          </Typography>
          <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>
            Click <b>Generate Decision</b> above to route the next step.
          </Typography>
        </Box>
      )}

      {/* Main content */}
      {!loading && !error && data && (
        <>
          {/* Hero */}
          <Box sx={{ pb:3, mb:3, borderBottom:`1px solid ${C.mist}` }}>
            <Typography sx={{
              ...os({ fontSize:11, color:C.ash, letterSpacing:"0.1em", textTransform:"uppercase", mb:1 }),
            }}>
              {hero.eyebrow || "Next clinical decision"}
            </Typography>
            <Typography sx={{ ...os({ fontSize:22, color:C.black, lineHeight:1.3, mb:1.5 }) }}>
              {hero.headline}
            </Typography>
            <Typography sx={{ ...os({ fontSize:13, color:C.ash, maxWidth:"60ch" }) }}>
              {hero.subtitle || "Decision-path routing, not a treatment recommendation."}
            </Typography>
          </Box>

          {/* Fields */}
          {fields.length > 0 && (
            <Box sx={{ mb:4 }}>
              <Typography sx={{
                ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR,
                       textTransform:"uppercase", letterSpacing:"0.08em", mb:2 }),
              }}>
                Next clinical decision
              </Typography>
              {fields.map((row, i) => (
                <InfoRow key={i} label={row.label} value={row.value} />
              ))}
            </Box>
          )}

          {/* Points */}
          {points.length > 0 && (
            <Box sx={{ mb:4 }}>
              <Typography sx={{
                ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR,
                       textTransform:"uppercase", letterSpacing:"0.08em", mb:2 }),
              }}>
                Key decision points
              </Typography>
              {points.map((p, i) => (
                <Box key={i} sx={{
                  display:"grid", gridTemplateColumns:"22px 1fr", gap:1.5,
                  py:1.5, borderBottom:`1px solid ${C.mist}`,
                }}>
                  <Marker />
                  <Box>
                    <Typography sx={{ ...os({ fontSize:13, color:C.black }) }}>
                      {p.text}
                    </Typography>
                    {p.source && (
                      <Typography sx={{ ...os({ fontSize:10, color:C.ash, mt:0.3 }) }}>
                        source: {p.source}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* Actions */}
          {actions.length > 0 && (
            <Box sx={{ display:"flex", gap:1.5, flexWrap:"wrap" }}>
              {actions.map((a) => {
                const isPrimary = a.variant === "primary";
                return (
                  <Box
                    key={a.key}
                    component="button"
                    onClick={() => onAction && onAction(a.key)}
                    sx={{
                      fontFamily: FONT,
                      fontWeight: FW_REGULAR,
                      fontSize: 11,
                      color: isPrimary ? C.white : C.black,
                      background: isPrimary ? C.black : "transparent",
                      border: `1px solid ${isPrimary ? C.black : C.mist}`,
                      px: 2.5,
                      py: 1,
                      cursor: "pointer",
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      "&:hover": isPrimary
                        ? { background:"#1a1a1a", borderColor:"#1a1a1a" }
                        : { borderColor: C.black, background: C.ghost },
                    }}
                  >
                    {a.label}
                  </Box>
                );
              })}
            </Box>
          )}
        </>
      )}
    </motion.div>
  );
}