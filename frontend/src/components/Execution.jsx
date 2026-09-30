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
    in: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
  };
  return <Box sx={{ width: 11, height: 11, mt: 0.6, flexShrink: 0, ...M[s] }} />;
};

const precycle = [
  ["ok", "ANC 2,100 /µL", "LAB2"],
  ["ok", "Platelets 1.4 lakh /µL", "LAB2"],
  ["ok", "Creatinine 1.0 mg/dL", "LAB2"],
  ["rv", "BP 152/94 on amlodipine", "OPD2"],
  ["ok", "Urine protein 1+", "LAB2"],
  ["rv", "Neuropathy grade 2 persisting", "APP"],
  ["cr", "Restaging suggests progression: cycle 11 on hold for line decision", "CT2"],
  ["rv", "Weight −5.4%: recalculate BSA", "LAB2"],
];

const lines = [
  ["Line 1", "FOLFOX + bevacizumab", "06 Apr 2026", "Ongoing", "Intended: 6 months induction then 5-FU/bevacizumab maintenance", "Actual: full FOLFOX continued; oxaliplatin reduced at cycle 9", "Best response PR (Jun)"],
];

const ledger = [
  ["C1", "06 Apr", "85", "100%", "—"],
  ["C2", "20 Apr", "85", "100%", "—"],
  ["C3", "04 May", "85", "100%", "—"],
  ["C4", "18 May", "85", "100%", "—"],
  ["C5", "01 Jun", "85", "100%", "—"],
  ["C6", "15 Jun", "85", "100%", "—"],
  ["C7", "29 Jun", "85", "100%", "ANC 820 day 14"],
  ["C8", "20 Jul", "85", "100%", "Delayed 7 days, G-CSF added"],
  ["C9", "03 Aug", "65", "76%", "Neuropathy grade 2"],
  ["C10", "31 Aug", "65", "76%", "Delayed 14 days (patient travel)"],
];

export default function Execution() {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Hero */}
      <Box sx={{ pb: 3, mb: 3, borderBottom: `1px solid ${C.mist}` }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase", mb: 1 }) }}>
          Joseph Mathew / Execution
        </Typography>
        <Typography sx={{ ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }) }}>
          Cycle 11 is on hold. Counts allow it, but restaging suggests progression.
        </Typography>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}>
          Pre-cycle check, dose ledger and the actual line of therapy against the intended one.
        </Typography>
      </Box>

      {/* Flow */}
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
          Cycle flow
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
          {["Plan", "Order", "Administration", "Toxicity monitoring", "Response assessment", "Next visit"].map((s, i, arr) => (
            <React.Fragment key={s}>
              <Box
                sx={{
                  px: 1.5, py: 0.8,
                  border: `1px solid ${i < 4 ? C.black : i === 4 ? C.black : C.mist}`,
                  background: i === 4 ? C.black : C.white,
                  color: i === 4 ? C.white : C.charcoal,
                  fontSize: 11,
                }}
              >
                {s}
              </Box>
              {i < arr.length - 1 && <Box sx={{ width: 16, height: 1, background: C.black }} />}
            </React.Fragment>
          ))}
        </Box>
      </Box>

      {/* Pre-cycle check */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
          Pre-cycle check: cycle 11
        </Typography>
        {precycle.map((row, i) => (
          <Box
            key={i}
            sx={{
              display: "grid",
              gridTemplateColumns: "22px 1fr auto",
              gap: 1.5,
              py: 1.2,
              borderTop: i === 0 ? `1px solid ${C.mist}` : "none",
              borderBottom: `1px solid ${C.mist}`,
              alignItems: "flex-start",
            }}
          >
            <Marker s={row[0]} />
            <Typography sx={{ ...os({ fontSize: 12, color: C.black }) }}>{row[1]}</Typography>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
              {row[0] === "ok" ? "Verified" : row[0] === "rv" ? "Needs review" : row[0] === "cr" ? "Critical" : "Info"}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Lines of therapy */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
          Lines of therapy
        </Typography>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 1.5 }) }}>
          Actual treatment recorded against the original intent.
        </Typography>
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
          <Box component="thead">
            <Box component="tr">
              {["Line", "Regimen", "Start", "Status", "Intended", "Actual", "Best response"].map((h) => (
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
            {lines.map((r, i) => (
              <Box component="tr" key={i}>
                {r.map((c, j) => (
                  <Box
                    component="td"
                    key={j}
                    sx={{
                      fontSize: 11,
                      color: j === 0 ? C.black : C.charcoal,
                      fontWeight: j === 0 ? FW_REGULAR : FW_LIGHT,
                      py: 1.2,
                      borderBottom: `1px solid ${C.mist}`,
                      verticalAlign: "top",
                    }}
                  >
                    {c}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* Dose ledger */}
      <Box sx={{ mb: 4 }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
          Oxaliplatin dose ledger
        </Typography>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 2 }) }}>
          mg/m² per cycle and percentage of standard.
        </Typography>

        {/* Bar chart */}
        <Box sx={{ display: "flex", alignItems: "flex-end", gap: 1, height: 120, mb: 2, px: 1 }}>
          {ledger.map((row) => {
            const h = parseInt(row[2], 10);
            const isFull = row[3] === "100%";
            return (
              <Box key={row[0]} sx={{ flex: 1, textAlign: "center", fontSize: 10, color: C.ash }}>
                <Box
                  sx={{
                    height: h,
                    background: isFull ? C.black : C.mist,
                    mb: 0.5,
                  }}
                  title={`${row[0]}: ${row[2]} mg/m² (${row[3]})`}
                />
                {row[0]}
              </Box>
            );
          })}
        </Box>

        {/* Ledger table */}
        <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
          <Box component="thead">
            <Box component="tr">
              {["Cycle", "Date", "Oxaliplatin (mg/m²)", "% standard", "Event"].map((h) => (
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
            {ledger.map((r, i) => (
              <Box component="tr" key={i} sx={{ background: r[4] !== "—" ? C.ghost : "transparent" }}>
                {r.map((c, j) => (
                  <Box
                    component="td"
                    key={j}
                    sx={{
                      fontSize: 11,
                      color: j === 0 ? C.black : C.charcoal,
                      fontWeight: j === 0 ? FW_REGULAR : FW_LIGHT,
                      py: 1.2,
                      borderBottom: `1px solid ${C.mist}`,
                    }}
                  >
                    {c}
                  </Box>
                ))}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      <Strip text="Cumulative oxaliplatin 810 mg/m² with grade 2 neuropathy. Bevacizumab 50 mg/kg with grade 2 hypertension and urine protein 1+." />
    </motion.div>
  );
}