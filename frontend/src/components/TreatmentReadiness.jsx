// TreatmentReadiness.jsx
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
const M = {
  ok:{ borderRadius:"50%", background:C.black },
  rv:{ borderRadius:"50%", border:`1.5px solid ${C.black}`,
       background:`linear-gradient(90deg,${C.black} 50%,transparent 50%)` },
  cr:{ rotate:45, borderRadius:0, background:C.black },
  in:{ borderRadius:"50%", border:`1.5px solid ${C.mist}` },
};
const Marker = ({ s = "in" }) => (
  <Box sx={{ width:11, height:11, mt:0.6, flexShrink:0, ...(M[s] || M.in) }} />
);

const LEGEND = { ok:"Verified", rv:"Needs review", cr:"Critical", in:"Information" };

const Row = ({ s, t }) => (
  <Box sx={{
    display:"grid", gridTemplateColumns:"22px 1fr auto", gap:1.5,
    py:1.2, borderBottom:`1px solid ${C.mist}`, alignItems:"flex-start",
  }}>
    <Marker s={s} />
    <Typography sx={{ ...os({ fontSize:12, color:C.black }) }}>{t}</Typography>
    <Typography sx={{
      ...os({ fontSize:10, color:C.ash, textTransform:"uppercase", letterSpacing:"0.08em" }),
    }}>
      {LEGEND[s] || ""}
    </Typography>
  </Box>
);

const Blk = ({ title, items }) => (
  <Box sx={{ mb:3 }}>
    <Typography sx={{
      ...os({ fontSize:11, color:C.black, fontWeight:FW_REGULAR,
             textTransform:"uppercase", letterSpacing:"0.08em", mb:1.5 }),
    }}>
      {title}
    </Typography>
    {items.map((row, i) => <Row key={i} s={row.status} t={row.text} />)}
  </Box>
);

/* ─── Main component ────────────────────────────────────── */
export default function TreatmentReadiness({
  patientId,
  doctorId,
  specialty,
  patientName,
  strategy,     // optional — label / id of the selected strategy
  onClose,
  onAction,
}) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
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
        `${API_BASE_URL}hms/users/ai-legacy/treatment-readiness/${encodeURIComponent(patientId)}`
      );
      url.searchParams.set("doctor_id", doctorId);
      if (specialty) url.searchParams.set("specialty", specialty);
      if (strategy)  url.searchParams.set("strategy", strategy);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setGenerated(true);
    } catch (err) {
      console.error("[TreatmentReadiness] fetch failed:", err);
      setError(err.message || "Failed to load treatment readiness.");
    } finally {
      setLoading(false);
    }
  };

  if (!patientId || !doctorId) {
    return (
      <Box sx={{ p:4, textAlign:"center" }}>
        <Typography sx={{ ...os({ fontSize:13, color:C.ash }) }}>
          Select a patient to view treatment readiness.
        </Typography>
      </Box>
    );
  }

  const hero             = data?.hero               || {};
  const counters         = data?.counters           || {};
  const diseaseReadiness = data?.disease_readiness  || [];
  const patientReadiness = data?.patient_readiness  || [];
  const treatmentRead    = data?.treatment_readiness|| [];
  const actions          = data?.actions            || [];

  const counterTiles = [
    ["Verified",                  counters.verified      || 0],
    ["Needs clinician review",    counters.needs_review  || 0],
    ["Important unresolved",      counters.critical_open || 0],
  ];

  return (
    <motion.div initial={{ opacity:0 }} animate={{ opacity:1 }} transition={{ duration:0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Generate bar */}
      <Box sx={{
        display:"flex", alignItems:"center", justifyContent:"space-between",
        gap:2, pb:2, mb:3, borderBottom:`1px solid ${C.mist}`,
      }}>
        <Typography sx={{
          ...os({ fontSize:11, color:C.ash, letterSpacing:"0.1em", textTransform:"uppercase" }),
        }}>
          {patientName ? `${patientName} / Treatment readiness` : "Treatment readiness"}
        </Typography>
        <Box sx={{ display:"flex", gap:1 }}>
          <Button
            onClick={handleGenerate}
            disabled={loading}
            variant="outlined" size="small"
            sx={{
              fontFamily:FONT, fontWeight:600, fontSize:11, letterSpacing:"0.08em",
              textTransform:"uppercase", color:C.black, borderColor:C.black,
              px:2, py:0.5, minWidth:"auto",
              "&:hover":{ backgroundColor:C.black, color:C.white, borderColor:C.black },
              "&.Mui-disabled":{ color:C.ash, borderColor:C.mist },
            }}
          >
            {loading ? "Generating…" : generated ? "Regenerate" : "Check Readiness"}
          </Button>
          {onClose && (
            <Button onClick={onClose} variant="text" size="small"
              sx={{ fontFamily:FONT, fontWeight:600, fontSize:11, letterSpacing:"0.08em",
                    textTransform:"uppercase", color:C.ash, px:1.5, py:0.5, minWidth:"auto",
                    "&:hover":{ color:C.black, backgroundColor:"transparent" } }}>
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
            Verifying readiness for the selected strategy…
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
        <Box sx={{ p:6, textAlign:"center", border:`1px dashed ${C.mist}`, background:C.ghost }}>
          <Typography sx={{ ...os({ fontSize:13, color:C.charcoal, mb:1 }) }}>
            No readiness check generated yet.
          </Typography>
          <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>
            Click <b>Check Readiness</b> above to verify the selected strategy.
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
              {hero.eyebrow || "Treatment readiness"}
            </Typography>
            <Typography sx={{ ...os({ fontSize:22, color:C.black, lineHeight:1.3, mb:1.5 }) }}>
              {hero.headline}
            </Typography>
            <Typography sx={{ ...os({ fontSize:13, color:C.ash, maxWidth:"60ch" }) }}>
              {hero.subtitle}
            </Typography>
          </Box>

          {/* Counters */}
          <Box sx={{
            display:"grid",
            gridTemplateColumns:{ xs:"1fr 1fr", md:"repeat(3,1fr)" },
            gap:2, mb:3,
          }}>
            {counterTiles.map(([k, v]) => (
              <Box key={k}>
                <Typography sx={{ ...os({ fontSize:34, color:C.black, lineHeight:1.1 }) }}>
                  {v}
                </Typography>
                <Typography sx={{
                  ...os({ fontSize:11, color:C.ash, textTransform:"uppercase",
                         letterSpacing:"0.08em", mt:0.5 }),
                }}>
                  {k}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Legend */}
          <Box sx={{ display:"flex", gap:2, flexWrap:"wrap", mb:3, fontSize:11 }}>
            {Object.entries(LEGEND).map(([k, v]) => (
              <Box key={k} sx={{ display:"flex", alignItems:"center", gap:0.75 }}>
                <Marker s={k} />
                <Typography sx={{ ...os({ fontSize:11, color:C.ash }) }}>{v}</Typography>
              </Box>
            ))}
          </Box>

          {/* Readiness blocks */}
          {diseaseReadiness.length > 0 && (
            <Blk title="Disease readiness" items={diseaseReadiness} />
          )}
          {patientReadiness.length > 0 && (
            <Blk title="Patient readiness" items={patientReadiness} />
          )}
          {treatmentRead.length > 0 && (
            <Blk title="Treatment-specific readiness" items={treatmentRead} />
          )}

          {/* Actions */}
          {actions.length > 0 && (
            <Box sx={{ display:"flex", gap:1.5, flexWrap:"wrap", mt:3 }}>
              {actions.map((a) => {
                const isPrimary = a.variant === "primary";
                return (
                  <Box
                    key={a.key}
                    component="button"
                    onClick={() => onAction && onAction(a.key, { strategy })}
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