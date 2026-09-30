// Dosing.jsx
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

/* ─── Presentational helpers ─────────────────────────────── */
const Marker = ({ s = "rv" }) => {
  const M = {
    cr: { rotate: 45, borderRadius: 0, background: C.black },
    rv: {
      borderRadius: "50%",
      border: `1.5px solid ${C.black}`,
      background: `linear-gradient(90deg,${C.black} 50%,transparent 50%)`,
    },
    ms: { borderRadius: "50%", border: `1.5px dashed ${C.black}` },
    in: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
    ok: { borderRadius: "50%", background: C.black },
  };
  return (
    <Box
      sx={{ width: 11, height: 11, mt: 0.6, flexShrink: 0, ...(M[s] || M.rv) }}
    />
  );
};

const InfoRow = ({ label, value }) => (
  <Box
    sx={{
      display: "flex",
      gap: 1,
      py: 0.4,
      borderBottom: `1px solid ${C.mist}`,
    }}
  >
    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 140 }) }}>
      {label}
    </Typography>
    <Typography
      sx={{
        ...os({ fontSize: 11, color: C.charcoal, fontWeight: FW_REGULAR, flex: 1 }),
      }}
    >
      {value}
    </Typography>
  </Box>
);

/* ─── Main component ─────────────────────────────────────── */
export default function Dosing({
  patientId,
  doctorId,
  specialty,
  patientName,
  onClose,
}) {
  const [data, setData]           = useState(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [generated, setGenerated] = useState(false);

  // Editable live inputs. Seeded from the backend on Generate; overridable.
  const [h, setH]     = useState(158);
  const [w, setW]     = useState(64);
  const [cr, setCr]   = useState(0.8);
  const [age, setAge] = useState(52);
  const [sex, setSex] = useState("F");

  /* ── Generate (reads saved strategy on the backend) ─────── */
  const handleGenerate = async () => {
    if (!patientId || !doctorId) {
      setError("Select a patient and a doctor first.");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);

    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/ai-legacy/generate_dosing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            patient_id: patientId,
            doctor_id:  doctorId,
            specialty:  specialty || null,
          }),
        }
      );

      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }

      const json = await res.json();
      setData(json);
      setGenerated(true);

      // Seed the live inputs from the backend; keep current values if null.
      const ins = json.inputs || {};
      if (typeof ins.height_cm === "number" && ins.height_cm > 0) setH(ins.height_cm);
      if (typeof ins.weight_kg === "number" && ins.weight_kg > 0) setW(ins.weight_kg);
      if (typeof ins.creatinine_mg_dl === "number" && ins.creatinine_mg_dl > 0) setCr(ins.creatinine_mg_dl);
      if (typeof ins.age === "number" && ins.age > 0) setAge(ins.age);
      if (ins.sex === "M" || ins.sex === "F") setSex(ins.sex);
    } catch (err) {
      console.error("[Dosing] fetch failed:", err);
      setError(err.message || "Failed to load dosing inputs.");
    } finally {
      setLoading(false);
    }
  };

  /* ── Guard — no patient / doctor selected ───────────────── */
  if (!patientId || !doctorId) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
          Select a patient to view dosing.
        </Typography>
      </Box>
    );
  }

  /* ── Live-derived values ───────────────────────────────── */
  const bsa  = Math.sqrt(h * w / 3600);
  const crcl = ((140 - age) * w) / (72 * cr) * (sex === "F" ? 0.85 : 1);

  const calc = (drug) => {
    if (drug.basis === "bsa")  return `${Math.round(drug.multiplier * bsa)} mg`;
    if (drug.basis === "auc")  return `${Math.round(drug.multiplier * (Math.min(crcl, 125) + 25))} mg`;
    if (drug.basis === "kg")   return `${Math.round(drug.multiplier * w)} mg`;
    if (drug.basis === "flat") return `${drug.multiplier} mg`;
    return "—";
  };

  const basis = (drug) => {
    if (drug.basis === "bsa")  return `${drug.multiplier} × ${bsa.toFixed(2)} m²`;
    if (drug.basis === "auc")  return `${drug.multiplier} × (${Math.round(Math.min(crcl, 125))} + 25)`;
    if (drug.basis === "kg")   return `${drug.multiplier} × ${w} kg`;
    if (drug.basis === "flat") return "Flat dose";
    return "—";
  };

  /* ── Safe destructuring ────────────────────────────────── */
  const hero          = data?.hero          || {};
  const warnings      = data?.warnings      || [];
  const regimens      = data?.regimens      || [];
  const cumulative    = data?.cumulative    || [];
  const interactions  = data?.interactions  || [];
  const savedStrategy = data?.saved_strategy;

  /* ── Render ────────────────────────────────────────────── */
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap"
        rel="stylesheet"
      />

      {/* ── Header bar: generate button ─────────────────────── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          pb: 2,
          mb: 3,
          borderBottom: `1px solid ${C.mist}`,
          flexWrap: "wrap",
        }}
      >
        <Typography
          sx={{
            ...os({
              fontSize: 11,
              color: C.ash,
              letterSpacing: "0.1em",
              textTransform: "uppercase",
            }),
          }}
        >
          {patientName ? `${patientName} / Dosing` : "Dosing"}
        </Typography>

        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <Button
            onClick={handleGenerate}
            disabled={loading}
            variant="outlined"
            size="small"
            sx={{
              fontFamily: FONT,
              fontWeight: 600,
              fontSize: 11,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: C.black,
              borderColor: C.black,
              px: 2,
              py: 0.5,
              minWidth: "auto",
              "&:hover": {
                backgroundColor: C.black,
                color: C.white,
                borderColor: C.black,
              },
              "&.Mui-disabled": { color: C.ash, borderColor: C.mist },
            }}
          >
            {loading ? "Loading…" : generated ? "Reload inputs" : "Generate Dosing"}
          </Button>

          {onClose && (
            <Button
              onClick={onClose}
              variant="text"
              size="small"
              sx={{
                fontFamily: FONT,
                fontWeight: 600,
                fontSize: 11,
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: C.ash,
                px: 1.5,
                py: 0.5,
                minWidth: "auto",
                "&:hover": { color: C.black, backgroundColor: "transparent" },
              }}
            >
              Close
            </Button>
          )}
        </Box>
      </Box>

      {/* ── Saved strategy banner ──────────────────────────── */}
      {savedStrategy && (
        <Box
          sx={{
            p: 1.5,
            mb: 3,
            border: `1px solid ${C.mist}`,
            background: C.ghost,
            borderLeft: `2px solid ${C.black}`,
          }}
        >
          <Typography
            sx={{
              ...os({
                fontSize: 10,
                color: C.ash,
                textTransform: "uppercase",
                letterSpacing: "0.1em",
                mb: 0.5,
              }),
            }}
          >
            Scoped to saved strategy
          </Typography>
          <Typography
            sx={{ ...os({ fontSize: 12, color: C.charcoal, fontWeight: FW_REGULAR }) }}
          >
            {savedStrategy}
          </Typography>
        </Box>
      )}

      {/* ── Loading ────────────────────────────────────────── */}
      {loading && (
        <Box
          sx={{
            p: 6,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 2,
          }}
        >
          <CircularProgress size={22} sx={{ color: C.black }} />
          <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>
            Loading dosing inputs and regimen definitions…
          </Typography>
        </Box>
      )}

      {/* ── Error ──────────────────────────────────────────── */}
      {!loading && error && (
        <Box
          sx={{
            p: 2,
            mb: 3,
            border: "1px solid #ffcdd2",
            background: "#fce4ec",
          }}
        >
          <Typography
            sx={{ ...os({ fontSize: 12, color: "#c62828", fontWeight: FW_REGULAR }) }}
          >
            {error}
          </Typography>
        </Box>
      )}

      {/* ── Empty state ────────────────────────────────────── */}
      {!loading && !error && !data && (
        <Box
          sx={{
            p: 6,
            textAlign: "center",
            border: `1px dashed ${C.mist}`,
            background: C.ghost,
          }}
        >
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: 1 }) }}>
            No dosing inputs loaded yet.
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
            Click <b>Generate Dosing</b> above to load the inputs and regimen
            definitions for the saved strategy.
          </Typography>
        </Box>
      )}

      {/* ── Main content (rendered only when data is present) ─ */}
      {!loading && !error && data && (
        <>
          {/* Hero */}
          <Box sx={{ pb: 3, mb: 3, borderBottom: `1px solid ${C.mist}` }}>
            <Typography
              sx={{
                ...os({
                  fontSize: 11,
                  color: C.ash,
                  letterSpacing: "0.1em",
                  textTransform: "uppercase",
                  mb: 1,
                }),
              }}
            >
              {hero.eyebrow || (patientName ? `${patientName} / Dosing` : "Dosing")}
            </Typography>
            <Typography
              sx={{
                ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }),
              }}
            >
              {hero.headline ||
                `BSA ${bsa.toFixed(2)} m² and CrCl ${Math.round(
                  crcl
                )} mL/min today. Every dose shows its inputs; nothing is applied automatically.`}
            </Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}>
              {hero.subtitle ||
                "The engine calculates and explains. You and the pharmacist prescribe."}
            </Typography>
          </Box>

          {/* Warnings */}
          {warnings.length > 0 && (
            <Box sx={{ mb: 3 }}>
              {warnings.map((x, i) => (
                <Box
                  key={i}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "22px 1fr",
                    gap: 1.5,
                    py: 1.2,
                    borderBottom: `1px solid ${C.mist}`,
                  }}
                >
                  <Marker s={x.status} />
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.black }) }}>
                      {x.title}
                    </Typography>
                    {x.sub && (
                      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
                        {x.sub}
                      </Typography>
                    )}
                    {x.source && (
                      <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.3 }) }}>
                        source: {x.source}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* Inputs */}
          <Box sx={{ my: 3 }}>
            <Typography
              sx={{
                ...os({
                  fontSize: 11,
                  color: C.black,
                  fontWeight: FW_REGULAR,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  mb: 1.5,
                }),
              }}
            >
              Inputs
            </Typography>
            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
              {[
                ["Height (cm)", h, setH],
                ["Weight (kg)", w, setW],
                ["Creatinine (mg/dL)", cr, setCr],
                ["Age (years)", age, setAge],
              ].map(([l, v, set]) => (
                <Box key={l}>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.1em",
                        mb: 0.5,
                      }),
                    }}
                  >
                    {l}
                  </Typography>
                  <Box
                    component="input"
                    type="number"
                    value={v}
                    onChange={(e) => set(parseFloat(e.target.value) || 0)}
                    sx={{
                      fontFamily: FONT,
                      fontWeight: FW_LIGHT,
                      fontSize: 12,
                      border: `1px solid ${C.mist}`,
                      px: 1.5,
                      py: 0.6,
                      width: 120,
                      background: C.white,
                    }}
                  />
                </Box>
              ))}

              <Box>
                <Typography
                  sx={{
                    ...os({
                      fontSize: 10,
                      color: C.ash,
                      textTransform: "uppercase",
                      letterSpacing: "0.1em",
                      mb: 0.5,
                    }),
                  }}
                >
                  Sex
                </Typography>
                <Box
                  component="select"
                  value={sex}
                  onChange={(e) => setSex(e.target.value)}
                  sx={{
                    fontFamily: FONT,
                    fontWeight: FW_LIGHT,
                    fontSize: 12,
                    border: `1px solid ${C.mist}`,
                    px: 1.5,
                    py: 0.6,
                    width: 120,
                    background: C.white,
                  }}
                >
                  <option value="F">Female</option>
                  <option value="M">Male</option>
                </Box>
              </Box>
            </Box>
          </Box>

          {/* BSA + CrCl */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 3,
              mb: 3,
            }}
          >
            <Box>
              <Typography
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.black,
                    fontWeight: FW_REGULAR,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    mb: 1,
                  }),
                }}
              >
                Body surface area (Mosteller)
              </Typography>
              <Typography sx={{ ...os({ fontSize: 28, color: C.black }) }}>
                {bsa.toFixed(2)} m²
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>
                √(height × weight ÷ 3600) · {h} cm, {w} kg
              </Typography>
            </Box>
            <Box>
              <Typography
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.black,
                    fontWeight: FW_REGULAR,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    mb: 1,
                  }),
                }}
              >
                Creatinine clearance (Cockcroft–Gault)
              </Typography>
              <Typography sx={{ ...os({ fontSize: 28, color: C.black }) }}>
                {Math.round(crcl)} mL/min
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>
                (140 − age) × weight ÷ (72 × creatinine) × {sex === "F" ? "0.85" : "1.0"} · actual body weight
              </Typography>
            </Box>
          </Box>

          {/* Regimens */}
          {regimens.length === 0 ? (
            <Box
              sx={{
                p: 3,
                mb: 3,
                border: `1px dashed ${C.mist}`,
                background: C.ghost,
                textAlign: "center",
              }}
            >
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.5 }) }}>
                No regimen to dose yet.
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                The saved strategy does not have a dosed regimen yet — for example,
                a surgery-first strategy awaits post-surgical pathology. Complete the
                prior step, then reload this panel.
              </Typography>
            </Box>
          ) : (
            regimens.map((regimen) => (
              <Box key={regimen.name} sx={{ mb: 3 }}>
                <Typography
                  sx={{
                    ...os({
                      fontSize: 11,
                      color: C.black,
                      fontWeight: FW_REGULAR,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      mb: 0.5,
                    }),
                  }}
                >
                  {regimen.name}
                </Typography>
                {regimen.note && (
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 1.5 }) }}>
                    {regimen.note}
                  </Typography>
                )}
                <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                  <Box component="thead">
                    <Box component="tr">
                      {["Drug", "Standard", "Basis", "Calculated"].map((hh) => (
                        <Box
                          component="th"
                          key={hh}
                          sx={{
                            textAlign: "left",
                            fontSize: 10,
                            fontWeight: FW_LIGHT,
                            color: C.ash,
                            textTransform: "uppercase",
                            letterSpacing: "0.08em",
                            py: 1,
                            borderBottom: `1px solid ${C.black}`,
                          }}
                        >
                          {hh}
                        </Box>
                      ))}
                    </Box>
                  </Box>
                  <Box component="tbody">
                    {regimen.drugs.map((drug, i) => (
                      <Box component="tr" key={i}>
                        <Box
                          component="td"
                          sx={{
                            fontSize: 12,
                            color: C.charcoal,
                            py: 1.2,
                            borderBottom: `1px solid ${C.mist}`,
                          }}
                        >
                          {drug.name}
                        </Box>
                        <Box
                          component="td"
                          sx={{
                            fontSize: 12,
                            color: C.charcoal,
                            py: 1.2,
                            borderBottom: `1px solid ${C.mist}`,
                          }}
                        >
                          {drug.standard}
                        </Box>
                        <Box
                          component="td"
                          sx={{
                            fontSize: 11,
                            color: C.ash,
                            py: 1.2,
                            borderBottom: `1px solid ${C.mist}`,
                          }}
                        >
                          {basis(drug)}
                        </Box>
                        <Box
                          component="td"
                          sx={{
                            fontSize: 12,
                            color: C.black,
                            fontWeight: FW_REGULAR,
                            py: 1.2,
                            borderBottom: `1px solid ${C.mist}`,
                          }}
                        >
                          {calc(drug)}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                </Box>
              </Box>
            ))
          )}

          {/* Cumulative exposure */}
          {cumulative.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.black,
                    fontWeight: FW_REGULAR,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    mb: 1.5,
                  }),
                }}
              >
                Cumulative exposure
              </Typography>
              {cumulative.map((row, i) => (
                <InfoRow
                  key={i}
                  label={row.drug}
                  value={`${row.now}${row.note ? ` · ${row.note}` : ""}`}
                />
              ))}
            </Box>
          )}

          {/* Interactions */}
          {interactions.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.black,
                    fontWeight: FW_REGULAR,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    mb: 1.5,
                  }),
                }}
              >
                Interactions and polypharmacy
              </Typography>
              {interactions.map((x, i) => (
                <Box
                  key={i}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "22px 1fr",
                    gap: 1.5,
                    py: 1.2,
                    borderBottom: `1px solid ${C.mist}`,
                  }}
                >
                  <Marker s={x.status} />
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.black }) }}>
                      {x.title}
                    </Typography>
                    {x.detail && (
                      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
                        {x.detail}
                      </Typography>
                    )}
                    {x.source && (
                      <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.3 }) }}>
                        source: {x.source}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </>
      )}
    </motion.div>
  );
}