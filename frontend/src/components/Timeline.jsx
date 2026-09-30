import React from "react";
import { Box, Typography } from "@mui/material";
import { motion } from "framer-motion";

const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = { black: "#000000", charcoal: "#444444", ash: "#888888", mist: "#e0e0e0", ghost: "#fafafa", white: "#ffffff" };
const os = (x = {}) => ({ fontFamily: FONT, fontWeight: FW_LIGHT, WebkitFontSmoothing: "antialiased", ...x });

const events = [
  { d: "23 Sep 2026", t: "First consultation; baseline opened with 6 open items", c: "new" },
  { d: "12 Sep 2026", t: "PET-CT: no confirmed distant disease; liver lesion indeterminate", c: "new" },
  { d: "01 Sep 2026", t: "IHC: ER 90, PR 40, HER2 2+, Ki-67 35", c: "new" },
  { d: "25 Aug 2026", t: "Diagnosis: IDC grade 3", c: "new" },
  { d: "12 Aug 2026", t: "Mammogram BI-RADS 5", c: "new" },
  { d: "20 Jul 2026", t: "Lump noticed", c: "" },
];

const MARK = {
  worse: { transform: "rotate(45deg)", borderRadius: 0, background: C.black },
  better: { borderRadius: "50%", background: C.black },
  new: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
  "": { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
};

const Marker = ({ s = "" }) => (
  <Box sx={{ width: 11, height: 11, mt: 0.6, flexShrink: 0, ...MARK[s] }} />
);

export default function Timeline() {
  const worse = events.filter((e) => e.c === "worse").length;
  const better = events.filter((e) => e.c === "better").length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Hero */}
      <Box sx={{ pb: 3, mb: 3, borderBottom: `1px solid ${C.mist}` }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase", mb: 1 }) }}>
          Latha Varghese / Timeline
        </Typography>
        <Typography sx={{ ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }) }}>
          {worse} findings worse and {better} better across the journey. The top of the list is what changed since the last decision.
        </Typography>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}>
          Persistent memory: every event, its source and its effect on the plan.
        </Typography>
      </Box>

      {/* Events */}
      <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
        Change since the last decision
      </Typography>
      {events.map((e, i) => (
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
          <Marker s={e.c} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 12, color: C.black }) }}>{e.t}</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
              {e.d}{e.c ? ` · ${e.c}` : ""}
            </Typography>
          </Box>
        </Box>
      ))}

      {/* How it connects */}
      <Box sx={{ mt: 4 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
          How it connects
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 0 }}>
          {["Tumour", "Stage", "Treatment", "Dose", "Organ function", "Toxicity", "Continue or modify", "Response", "Next decision"].map((s, i, arr) => (
            <React.Fragment key={s}>
              <Box
                sx={{
                  px: 1.5,
                  py: 0.8,
                  border: `1px solid ${C.mist}`,
                  fontSize: 11,
                  color: C.charcoal,
                  background: C.white,
                }}
              >
                {s}
              </Box>
              {i < arr.length - 1 && <Box sx={{ width: 16, height: 1, background: C.black }} />}
            </React.Fragment>
          ))}
        </Box>
      </Box>
    </motion.div>
  );
}