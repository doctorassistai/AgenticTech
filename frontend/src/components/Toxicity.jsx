// Toxicity.jsx
import React, { useState } from "react";
import { Box, Typography, Button, CircularProgress } from "@mui/material";
import { motion } from "framer-motion";

const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = { black: "#000000", charcoal: "#444444", ash: "#888888", mist: "#e0e0e0", ghost: "#fafafa", white: "#ffffff" };
const os = (x = {}) => ({ fontFamily: FONT, fontWeight: FW_LIGHT, WebkitFontSmoothing: "antialiased", ...x });

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

/* ─── Presentational ─── */
const Strip = ({ text }) => (
  <Box sx={{ px: 1.5, py: 1, mt: 1, background: C.ghost, border: `1px solid ${C.mist}`, borderLeft: `2px solid ${C.charcoal}` }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6 }) }}>{text}</Typography>
  </Box>
);

const GRADE_SHADE = ["#ffffff", "#d9d9d9", "#9a9a9a", "#4d4d4d", "#000000"];
const GradeCells = ({ g }) => (
  <Box sx={{ display: "inline-flex", gap: 0.4 }} title={`Grades: ${g.join(", ")}`}>
    {g.map((v, i) => (
      <Box
        key={i}
        sx={{
          width: 18, height: 18,
          border: `1px solid ${v === 0 ? C.mist : C.black}`,
          background: GRADE_SHADE[v],
        }}
        title={`Grade ${v}`}
      />
    ))}
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

const MODALITY_LABEL = {
  chemo: "Chemo",
  radiation: "Radiation",
  surgery: "Surgery",
  immuno: "Immuno",
  endocrine: "Endocrine",
};

export default function Toxicity({
  patientId,
  doctorId,
  hospitalId,
  patientName,
  onClose,
}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState(false);

  const [anc, setAnc] = useState(1100);
  const [plt, setPlt] = useState(120000);

  const handleGenerate = async () => {
    if (!patientId || !doctorId) {
      setError("Select a patient and a doctor first.");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);

    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/generate_toxicity`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          hospital_id: hospitalId || null,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => "");
        throw new Error(t || `HTTP ${res.status}`);
      }
      const json = await res.json();
      setData(json);
      setGenerated(true);

      const ga = json.grading_assistant || {};
      if (typeof ga.anc === "number") setAnc(ga.anc);
      if (typeof ga.plt === "number") setPlt(ga.plt);
    } catch (err) {
      console.error("[Toxicity] fetch failed:", err);
      setError(err.message || "Failed to load toxicity data.");
    } finally {
      setLoading(false);
    }
  };

  if (!patientId || !doctorId) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
          Select a patient to view toxicity.
        </Typography>
      </Box>
    );
  }

  const hero     = data?.hero || {};
  const tox      = data?.tox || [];
  const similar  = data?.similar_patients || {};
  const counts   = data?.source_counts || {};

  const gA = anc >= 1500 ? (anc < 2000 ? 1 : 0) : anc >= 1000 ? 2 : anc >= 500 ? 3 : 4;
  const gP = plt >= 150000 ? 0 : plt >= 75000 ? 1 : plt >= 50000 ? 2 : plt >= 25000 ? 3 : 4;

  const worst = tox.length > 0
    ? tox.reduce((a, b) => (b.now > a.now ? b : a), tox[0])
    : null;
  const worsening = tox.filter(t => /Worsening|New/.test(t.st)).length;

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />

      {/* Header */}
      <Box sx={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 2, pb: 2, mb: 3, borderBottom: `1px solid ${C.mist}`, flexWrap: "wrap",
      }}>
        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase" }) }}>
          {patientName ? `${patientName} / Toxicity` : "Toxicity"}
        </Typography>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button
            onClick={handleGenerate}
            disabled={loading}
            variant="outlined" size="small"
            sx={{
              fontFamily: FONT, fontWeight: 600, fontSize: 11, letterSpacing: "0.08em",
              textTransform: "uppercase", color: C.black, borderColor: C.black,
              px: 2, py: 0.5, minWidth: "auto",
              "&:hover": { backgroundColor: C.black, color: C.white, borderColor: C.black },
              "&.Mui-disabled": { color: C.ash, borderColor: C.mist },
            }}
          >
            {loading ? "Loading…" : generated ? "Reload" : "Generate Toxicity"}
          </Button>
          {onClose && (
            <Button
              onClick={onClose} variant="text" size="small"
              sx={{
                fontFamily: FONT, fontWeight: 600, fontSize: 11, letterSpacing: "0.08em",
                textTransform: "uppercase", color: C.ash, px: 1.5, py: 0.5, minWidth: "auto",
                "&:hover": { color: C.black, backgroundColor: "transparent" },
              }}
            >
              Close
            </Button>
          )}
        </Box>
      </Box>

      {/* Loading */}
      {loading && (
        <Box sx={{ p: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <CircularProgress size={22} sx={{ color: C.black }} />
          <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>
            Loading toxicity data from chemo, radiation, and surgery records…
          </Typography>
        </Box>
      )}

      {/* Error */}
      {!loading && error && (
        <Box sx={{ p: 2, mb: 3, border: "1px solid #ffcdd2", background: "#fce4ec" }}>
          <Typography sx={{ ...os({ fontSize: 12, color: "#c62828" }) }}>{error}</Typography>
        </Box>
      )}

      {/* Empty */}
      {!loading && !error && !data && (
        <Box sx={{ p: 6, textAlign: "center", border: `1px dashed ${C.mist}`, background: C.ghost }}>
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: 1 }) }}>
            No toxicity data loaded yet.
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
            Click <b>Generate Toxicity</b> to merge chemo, radiation, and surgical records.
          </Typography>
        </Box>
      )}

      {/* Content */}
      {!loading && !error && data && (
        <>
          {/* Hero */}
          <Box sx={{ pb: 3, mb: 3, borderBottom: `1px solid ${C.mist}` }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase", mb: 1 }) }}>
              {hero.eyebrow || (patientName ? `${patientName} / Toxicity` : "Toxicity")}
            </Typography>
            <Typography sx={{ ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }) }}>
              {hero.headline || (worst
                ? `Worst current toxicity: ${worst.event.toLowerCase()}, grade ${worst.now}. ${worsening} events are ongoing or worsening.`
                : "No treatment-related toxicity recorded.")}
            </Typography>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}>
              {hero.subtitle || "Graded by CTCAE v5.0, tracked over time and cumulatively, and linked to the likely cause."}
            </Typography>
          </Box>

          {/* Source summary */}
          {data.source_counts && (
            <Box sx={{ mb: 3, display: "flex", gap: 3, flexWrap: "wrap" }}>
              {[
                ["Chemo events", counts.chemo],
                ["Radiation events", counts.radiation],
                ["Surgery events", counts.surgery],
                ["Merged", counts.merged],
              ].map(([k, v]) => (
                <Box key={k}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", mb: 0.25 }) }}>
                    {k}
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 18, color: C.black, lineHeight: 1.1 }) }}>
                    {v ?? 0}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {/* Toxicity by event */}
          {tox.length > 0 && (
            <Box sx={{ mb: 4 }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }) }}>
                Toxicity by event
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 2 }) }}>
                Squares show grade across the last five assessments; darker is higher. All modalities are shown together. Likely cause and next action are resolved by the AI from the cycle's regimen and the CTCAE event profile.
              </Typography>

              <Box component="table" sx={{ width: "100%", borderCollapse: "collapse" }}>
                <Box component="thead">
                  <Box component="tr">
                    {["Event", "Modality", "Likely cause", "Onset", "Trajectory", "Now", "Next action", "Status"].map((h) => (
                      <Box
                        component="th"
                        key={h}
                        sx={{
                          textAlign: "left", fontWeight: FW_LIGHT, fontSize: 10,
                          color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em",
                          py: 1, borderBottom: `1px solid ${C.black}`,
                        }}
                      >
                        {h}
                      </Box>
                    ))}
                  </Box>
                </Box>
                <Box component="tbody">
                  {tox.map((t, i) => {
                    const isWorse = /Worsening|New/.test(t.st);
                    return (
                      <Box component="tr" key={i} sx={{ background: isWorse ? C.ghost : "transparent" }}>
                        <Box component="td" sx={{ fontSize: 12, color: C.black, py: 1.2, borderBottom: `1px solid ${C.mist}`, fontWeight: FW_REGULAR }}>
                          {t.event}
                        </Box>
                        <Box component="td" sx={{ fontSize: 11, color: C.charcoal, py: 1.2, borderBottom: `1px solid ${C.mist}` }}>
                          {MODALITY_LABEL[t.modality] || t.modality || "—"}
                        </Box>
                        <Box component="td" sx={{ fontSize: 11, color: C.charcoal, py: 1.2, borderBottom: `1px solid ${C.mist}` }}>
                          {t.drug || "Not documented"}
                          {t.cause_confidence === "low" && (
                            <Typography component="span" sx={{ ...os({ fontSize: 9, color: C.ash, ml: 0.5 }) }}>
                              (low conf.)
                            </Typography>
                          )}
                        </Box>
                        <Box component="td" sx={{ fontSize: 11, color: C.ash, py: 1.2, borderBottom: `1px solid ${C.mist}` }}>
                          {t.onset || "—"}
                        </Box>
                        <Box component="td" sx={{ py: 1.2, borderBottom: `1px solid ${C.mist}` }}>
                          <GradeCells g={t.g} />
                        </Box>
                        <Box component="td" sx={{ fontSize: 12, color: C.black, py: 1.2, borderBottom: `1px solid ${C.mist}`, fontWeight: FW_REGULAR }}>
                          Grade {t.now}
                        </Box>
                        <Box component="td" sx={{ fontSize: 11, color: C.charcoal, py: 1.2, borderBottom: `1px solid ${C.mist}` }}>
                          {t.action || "—"}
                        </Box>
                        <Box component="td" sx={{ fontSize: 11, color: isWorse ? C.black : C.ash, py: 1.2, borderBottom: `1px solid ${C.mist}`, fontWeight: isWorse ? FW_REGULAR : FW_LIGHT }}>
                          {t.st}
                        </Box>
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </Box>
          )}

          {/* Grading assistant + Similar patients */}
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 4 }}>
            <Box>
              <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
                Grading assistant
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 2 }) }}>
                Suggests a CTCAE grade; you confirm.
              </Typography>

              <Box sx={{ display: "flex", gap: 2, mb: 2 }}>
                <Box>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", mb: 0.5 }) }}>
                    ANC /µL
                  </Typography>
                  <Box
                    component="input"
                    type="number"
                    value={anc}
                    onChange={(e) => setAnc(parseInt(e.target.value, 10) || 0)}
                    sx={{
                      fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 12,
                      border: `1px solid ${C.mist}`, px: 1.5, py: 0.6,
                      width: 120, background: C.white, outline: "none",
                      "&:focus": { borderColor: C.black },
                    }}
                  />
                </Box>
                <Box>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.1em", mb: 0.5 }) }}>
                    Platelets /µL
                  </Typography>
                  <Box
                    component="input"
                    type="number"
                    value={plt}
                    onChange={(e) => setPlt(parseInt(e.target.value, 10) || 0)}
                    sx={{
                      fontFamily: FONT, fontWeight: FW_LIGHT, fontSize: 12,
                      border: `1px solid ${C.mist}`, px: 1.5, py: 0.6,
                      width: 140, background: C.white, outline: "none",
                      "&:focus": { borderColor: C.black },
                    }}
                  />
                </Box>
              </Box>

              {[
                { s: gA >= 3 ? "cr" : gA ? "rv" : "ok", t: `Neutrophil count decreased: grade ${gA}` },
                { s: gP >= 3 ? "cr" : gP ? "rv" : "ok", t: `Platelet count decreased: grade ${gP}` },
              ].map((r, i) => (
                <Box key={i} sx={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 1.5, py: 1.2, borderBottom: `1px solid ${C.mist}` }}>
                  <Marker s={r.s} />
                  <Typography sx={{ ...os({ fontSize: 12, color: C.black }) }}>{r.t}</Typography>
                </Box>
              ))}
            </Box>

            <Box>
              <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1.5 }) }}>
                Similar patients
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 1.5 }) }}>
                {similar.n > 0
                  ? `${similar.n} de-identified patients, institutional registry.`
                  : "No cohort available."}
              </Typography>
              {similar.text && (
                <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.7, mb: 1.5 }) }}>
                  {similar.text}
                </Typography>
              )}
              <Strip text={similar.caution || "Registry association only, not a recommendation."} />
            </Box>
          </Box>

          <Strip text="CTCAE v5.0 grades: 1 Mild · 2 Moderate · 3 Severe · 4 Life-threatening · 5 Death." />
        </>
      )}
    </motion.div>
  );
}