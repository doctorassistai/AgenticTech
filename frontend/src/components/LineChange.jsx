import React from "react";
import { Box, Typography } from "@mui/material";
import { motion } from "framer-motion";

const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = { black: "#000000", charcoal: "#444444", ash: "#888888", mist: "#e0e0e0", ghost: "#fafafa", white: "#ffffff" };
const os = (x = {}) => ({ fontFamily: FONT, fontWeight: FW_LIGHT, WebkitFontSmoothing: "antialiased", ...x });

const Strip = ({ text }) => (
  <Box sx={{ px: 1.5, py: 1, mt: 1, background: C.ghost, border: `1px solid ${C.mist}`, borderLeft: `2px solid ${C.charcoal}` }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6 }) }}>{text}</Typography>
  </Box>
);

const Marker = ({ s = "in" }) => {
  const M = {
    ok: { borderRadius: "50%", background: C.black },
    rv: { borderRadius: "50%", border: `1.5px solid ${C.black}`, background: `linear-gradient(90deg, ${C.black} 50%, transparent 50%)` },
    cr: { transform: "rotate(45deg)", background: C.black },
    ms: { borderRadius: "50%", border: `1.5px dashed ${C.black}` },
    in: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
  };
  return <Box sx={{ width: 11, height: 11, mt: 0.6, flexShrink: 0, ...M[s] }} />;
};

const changed = [
  { s: "cr", t: "Disease", sub: "Progression from nadir (RECIST suggestion) and CEA rising since July." },
  { s: "cr", t: "Toxicity", sub: "Grade 2 neuropathy at 810 mg/m² oxaliplatin." },
  { s: "rv", t: "Reserve", sub: "ECOG 0 → 1, weight −5.4%, albumin 4.1 → 3.6." },
];

const options = [
  ["Continue current regimen", "Not supported by progression; oxaliplatin limited by neuropathy", ""],
  ["Switch to FOLFIRI + bevacizumab", "Second line with VEGF inhibition continued beyond progression", "ML18147"],
  ["FOLFIRI + other anti-VEGF agent", "Alternative second-line combinations", "ESMO-CRC"],
  ["Refer to MDT for liver-directed therapy", "Liver-only disease; resectability and local options reassessed", ""],
  ["Clinical trial", "KRAS G12D-directed trials: registry search shows 1 open study", "TRIAL"],
];

const excluded = [
  "Anti-EGFR (KRAS mutant)",
  "Checkpoint inhibitor monotherapy (MSS)",
  "KRAS G12C inhibitors (not G12C)",
];

const reserve = [
  ["ECOG", "0 → 1"],
  ["Weight", "74 → 70 kg"],
  ["Albumin", "4.1 → 3.6 g/dL"],
  ["ANC", "Recovered to 2,100"],
  ["Organ function", "Renal and hepatic normal"],
];

export default function LineChange() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Hero */}
      <Box sx={{ pb: 3, mb: 3, borderBottom: `1px solid ${C.mist}` }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase", mb: 1 }) }}>
          Joseph Mathew / Line change
        </Typography>
        <Typography sx={{ ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }) }}>
          First line has stopped working and oxaliplatin is limited by neuropathy. Second-line options exclude anti-EGFR and checkpoint monotherapy.
        </Typography>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}>
          What changed since the last decision, and the options that remain.
        </Typography>
      </Box>

      {/* What changed */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
          What changed since the last decision
        </Typography>
        {changed.map((c, i) => (
          <Box
            key={i}
            sx={{
              display: "grid",
              gridTemplateColumns: "22px 1fr",
              gap: 1.5,
              py: 1.2,
              borderTop: i === 0 ? `1px solid ${C.mist}` : "none",
              borderBottom: `1px solid ${C.mist}`,
            }}
          >
            <Marker s={c.s} />
            <Box>
              <Typography sx={{ ...os({ fontSize: 12, color: C.black, fontWeight: FW_REGULAR }) }}>{c.t}</Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.3, lineHeight: 1.6 }) }}>{c.sub}</Typography>
            </Box>
          </Box>
        ))}
      </Box>

      {/* Options */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
          Options
        </Typography>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 1.5 }) }}>
          Linked to evidence; ordered as the guideline presents them, not ranked by the system.
        </Typography>
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
          <Box component="thead">
            <Box component="tr">
              {["Option", "Consideration", "Evidence"].map((h) => (
                <Box
                  component="th"
                  key={h}
                  sx={{
                    textAlign: "left",
                    fontWeight: FW_LIGHT,
                    fontSize: 10,
                    color: C.ash,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    py: 1,
                    borderBottom: `1px solid ${C.black}`,
                  }}
                >
                  {h}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {options.map((o, i) => (
              <Box component="tr" key={i}>
                <Box component="td" sx={{ fontSize: 12, color: C.black, fontWeight: FW_REGULAR, py: 1.5, borderBottom: `1px solid ${C.mist}`, verticalAlign: "top", minWidth: 240 }}>
                  {o[0]}
                </Box>
                <Box component="td" sx={{ fontSize: 11, color: C.charcoal, py: 1.5, borderBottom: `1px solid ${C.mist}`, verticalAlign: "top" }}>
                  {o[1]}
                </Box>
                <Box component="td" sx={{ fontSize: 11, color: C.ash, py: 1.5, borderBottom: `1px solid ${C.mist}`, verticalAlign: "top" }}>
                  {o[2] ? (
                    <Box
                      component="span"
                      sx={{
                        textDecoration: "underline",
                        textDecorationColor: C.mist,
                        textUnderlineOffset: "3px",
                        cursor: "pointer",
                        "&:hover": { color: C.black },
                      }}
                    >
                      {o[2]}
                    </Box>
                  ) : (
                    "—"
                  )}
                </Box>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Excluded + Reserve */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 4, mb: 4 }}>
        {/* Excluded */}
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
            Excluded by biology
          </Typography>
          {excluded.map((t, i) => (
            <Box
              key={i}
              sx={{
                display: "grid",
                gridTemplateColumns: "22px 1fr",
                gap: 1.5,
                py: 1.2,
                borderTop: i === 0 ? `1px solid ${C.mist}` : "none",
                borderBottom: `1px solid ${C.mist}`,
              }}
            >
              <Marker s="ms" />
              <Typography sx={{ ...os({ fontSize: 12, color: C.black }) }}>{t}</Typography>
            </Box>
          ))}
        </Box>

        {/* Reserve */}
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
            Operational reserve
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 1.5 }) }}>
            Trends, not one ECOG score.
          </Typography>
          {reserve.map(([k, v], i) => (
            <Box key={i} sx={{ display: "flex", gap: 1, py: 0.5, borderBottom: `1px solid ${C.mist}` }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 140 }) }}>{k}</Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{v}</Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* Pre-irinotecan alert */}
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: "22px 1fr",
          gap: 1.5,
          py: 1.5,
          borderTop: `1px solid ${C.mist}`,
          borderBottom: `1px solid ${C.mist}`,
          mb: 4,
        }}
      >
        <Marker s="rv" />
        <Box>
          <Typography sx={{ ...os({ fontSize: 12, color: C.black }) }}>
            Before irinotecan: UGT1A1 not tested.
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
            Order now so the result is back before cycle 1 of second line.
          </Typography>
        </Box>
      </Box>

      {/* Actions */}
      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mb: 3 }}>
        <Box
          component="button"
          sx={{
            fontFamily: FONT,
            fontWeight: FW_REGULAR,
            fontSize: 11,
            color: C.white,
            background: C.black,
            border: `1px solid ${C.black}`,
            px: 2.5,
            py: 1,
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          Re-simulate at tumour board
        </Box>
        <Box
          component="button"
          sx={{
            fontFamily: FONT,
            fontWeight: FW_REGULAR,
            fontSize: 11,
            color: C.black,
            background: "transparent",
            border: `1px solid ${C.mist}`,
            px: 2.5,
            py: 1,
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            "&:hover": { borderColor: C.black, background: C.ghost },
          }}
        >
          Record decision
        </Box>
      </Box>

      <Strip text="Research only — Sensor and computer-vision functional scoring (gait, movement, voice, accelerometry) is available in the research lab only." />
    </motion.div>
  );
}