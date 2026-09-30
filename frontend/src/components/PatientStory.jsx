// PatientStory.jsx
import React, { useState } from "react";
import { Box, Typography, CircularProgress, Button } from "@mui/material";
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
  offwhite: "#f5f5f5",
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

/* ============================================================
   PRESENTATIONAL HELPERS
   ============================================================ */

const Badge = ({ label }) => (
  <Box
    sx={{
      display: "inline-flex",
      alignItems: "center",
      gap: 0.75,
      px: 1.5,
      py: 0.5,
      background: C.ghost,
      border: `1px solid ${C.mist}`,
    }}
  >
    <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: C.ash }} />
    <Typography
      sx={{
        ...os({
          fontSize: 10,
          color: C.charcoal,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
        }),
      }}
    >
      {label}
    </Typography>
  </Box>
);

const InfoRow = ({ label, value }) => (
  <Box
    sx={{
      display: "flex",
      gap: 1,
      py: 0.4,
      borderBottom: `1px solid ${C.mist}`,
    }}
  >
    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, minWidth: 110 }) }}>
      {label}
    </Typography>
    <Typography
      sx={{
        ...os({ fontSize: 11, color: C.charcoal, fontWeight: FW_REGULAR }),
      }}
    >
      {value || "—"}
    </Typography>
  </Box>
);

const Strip = ({ text }) => (
  <Box
    sx={{
      px: 1.5,
      py: 1,
      mt: 1,
      background: C.ghost,
      border: `1px solid ${C.mist}`,
      borderLeft: `2px solid ${C.charcoal}`,
    }}
  >
    <Typography
      sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6 }) }}
    >
      {text}
    </Typography>
  </Box>
);

const MARK = {
  cr: { rotate: 45, borderRadius: 0, width: 9, height: 9, background: C.black },
  rv: {
    borderRadius: "50%",
    border: `1.5px solid ${C.black}`,
    background: `linear-gradient(90deg,${C.black} 50%,transparent 50%)`,
  },
  ms: { borderRadius: "50%", border: `1.5px dashed ${C.black}` },
  in: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
};

const Marker = ({ s = "in" }) => (
  <Box sx={{ width: 11, height: 11, mt: 0.6, flexShrink: 0, ...MARK[s] }} />
);

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function PatientStory({
  patientId,
  doctorId,
  appointmentId, // optional — reserved for future use
  patientName,   // optional — used only for friendly fallbacks
  specialty,     // optional — defaults to backend's doctor_specialty
  onClose,       // optional — called by any "close" affordance you add
}) {
  const [story, setStory]       = useState(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [hasGenerated, setHasGenerated] = useState(false);

  /* ----------------------------------------------------------
     GENERATE — runs the fetch only when the user clicks the button
     ---------------------------------------------------------- */
  const handleGenerate = async () => {
    if (!patientId || !doctorId) {
      setError("Select a patient and a doctor first.");
      return;
    }

    setLoading(true);
    setError("");
    setStory(null);

    try {
      // Build the URL exactly matching the FastAPI route:
      //   GET /patient-story/{patient_id}?doctor_id=...&specialty=...
      const url = new URL(
        `${API_BASE_URL}hms/users/ai-legacy/patient-story/${encodeURIComponent(patientId)}`
      );
      url.searchParams.set("doctor_id", doctorId);
      if (specialty) url.searchParams.set("specialty", specialty);

      const res = await fetch(url.toString(), {
        method: "GET",
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(
          text || `Failed to load patient story (HTTP ${res.status})`
        );
      }

      const json = await res.json();
      setStory(json);
      setHasGenerated(true);
    } catch (err) {
      console.error("[PatientStory] fetch failed:", err);
      setError(err.message || "Failed to load patient story.");
      setStory(null);
    } finally {
      setLoading(false);
    }
  };

  /* ----------------------------------------------------------
     GUARD STATE — no patient / doctor selected
     ---------------------------------------------------------- */
  if (!patientId || !doctorId) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
          Select a patient to view their story.
        </Typography>
      </Box>
    );
  }

  /* ----------------------------------------------------------
     DESTRUCTURE THE PAYLOAD (only when story exists)
     ---------------------------------------------------------- */
  const storyData = story
    ? (() => {
        const {
          hero = {},
          identity = [],
          clinically_relevant = [],
          lens = { specialty: specialty || "Medical Oncology", items: [] },
          journey = [],
          current_disease = [],
          treatment_history = [],
          context = [],
        } = story;
        return {
          hero,
          identity,
          clinically_relevant,
          lens,
          journey,
          current_disease,
          treatment_history,
          context,
        };
      })()
    : null;

  /* ----------------------------------------------------------
     RENDER
     ---------------------------------------------------------- */
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

      {/* ── GENERATE BUTTON (always visible at the top) ─────── */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          pb: 2,
          mb: 3,
          borderBottom: `1px solid ${C.mist}`,
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
          {patientName ? `${patientName} / Patient story` : "Patient story"}
        </Typography>

        <Box sx={{ display: "flex", gap: 1 }}>
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
              "&.Mui-disabled": {
                color: C.ash,
                borderColor: C.mist,
              },
            }}
          >
            {loading
              ? "Generating…"
              : hasGenerated
              ? "Regenerate"
              : "Generate Story"}
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

      {/* ── LOADING STATE ───────────────────────────────────── */}
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
            Building patient story…
          </Typography>
        </Box>
      )}

      {/* ── ERROR STATE ─────────────────────────────────────── */}
      {!loading && error && (
        <Box sx={{ pb: 4 }}>
          <Box
            sx={{
              p: 2,
              border: "1px solid #ffcdd2",
              background: "#fce4ec",
            }}
          >
            <Typography
              sx={{
                ...os({ fontSize: 12, color: "#c62828", fontWeight: FW_REGULAR }),
              }}
            >
              {error}
            </Typography>
          </Box>
        </Box>
      )}

      {/* ── EMPTY STATE — before first generation ───────────── */}
      {!loading && !error && !story && (
        <Box
          sx={{
            p: 6,
            textAlign: "center",
            border: `1px dashed ${C.mist}`,
            background: C.ghost,
          }}
        >
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: 1 }) }}>
            No patient story generated yet.
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 3 }) }}>
            Click <b>Generate Story</b> above to build one from the patient's record.
          </Typography>
        </Box>
      )}

      {/* ── STORY CONTENT (rendered only when story exists) ─── */}
      {!loading && !error && storyData && (
        <>
          {/* ── HERO ──────────────────────────────────────── */}
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
              {storyData.hero.eyebrow || "Patient story"}
            </Typography>
            <Typography
              sx={{
                ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }),
              }}
            >
              {storyData.hero.headline || "Clinical picture and treatment planning."}
            </Typography>
            <Typography
              sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}
            >
              {storyData.hero.why_here || "Referred for clinical review."}
            </Typography>
          </Box>

          {/* ── IDENTITY STRIP ────────────────────────────── */}
          {storyData.identity.length > 0 && (
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(6,1fr)" },
                gap: 2,
                mb: 4,
              }}
            >
              {storyData.identity.map((it) => (
                <Box key={it.key}>
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
                    {it.key}
                  </Typography>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 12,
                        color: C.black,
                        fontWeight: FW_REGULAR,
                      }),
                    }}
                  >
                    {it.value || "—"}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}

          {/* ── CLINICALLY RELEVANT ───────────────────────── */}
          {storyData.clinically_relevant.length > 0 && (
            <Box sx={{ mb: 4 }}>
              <Typography
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.black,
                    fontWeight: FW_REGULAR,
                    textTransform: "uppercase",
                    letterSpacing: "0.08em",
                    mb: 2,
                  }),
                }}
              >
                Clinically relevant
              </Typography>
              <Box>
                {storyData.clinically_relevant.map((r, i) => (
                  <Box
                    key={i}
                    sx={{
                      display: "grid",
                      gridTemplateColumns: "22px 1fr",
                      gap: 1.5,
                      py: 1.5,
                      borderTop: i === 0 ? `1px solid ${C.mist}` : "none",
                      borderBottom: `1px solid ${C.mist}`,
                    }}
                  >
                    <Marker s={r.severity || "in"} />
                    <Box>
                      <Typography
                        sx={{
                          ...os({ fontSize: 13, color: C.black, lineHeight: 1.5 }),
                        }}
                      >
                        {r.text}
                      </Typography>
                      {r.source && (
                        <Typography
                          sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.5 }) }}
                        >
                          source: {r.source}
                        </Typography>
                      )}
                    </Box>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* ── LENS ──────────────────────────────────────── */}
          {storyData.lens.items?.length > 0 && (
            <Box sx={{ mb: 4 }}>
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
                Through the{" "}
                {storyData.lens.specialty || specialty || "Medical Oncology"} lens
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 2 }) }}>
                {storyData.lens.intro ||
                  "Same patient story; emphasis changes with the specialty selected at the top."}
              </Typography>
              {storyData.lens.items.map((it, i) => (
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
                  <Marker s="in" />
                  <Box>
                    <Typography
                      sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}
                    >
                      {it.text}
                    </Typography>
                    {it.source && (
                      <Typography
                        sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.5 }) }}
                      >
                        source: {it.source}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* ── JOURNEY ───────────────────────────────────── */}
          {storyData.journey.length > 0 && (
            <Box sx={{ mb: 4 }}>
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
                Cancer journey
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 2 }) }}>
                Symptom → work-up → suspicion → diagnosis → staging → treatment → now.
              </Typography>
              <Box sx={{ pl: 2, borderLeft: `1px solid ${C.black}` }}>
                {storyData.journey.map((j, i) => (
                  <Box key={i} sx={{ position: "relative", pb: 2, pl: 2 }}>
                    <Box
                      sx={{
                        position: "absolute",
                        left: -24,
                        top: 6,
                        width: 11,
                        height: 11,
                        borderRadius: "50%",
                        background: j.now ? C.black : C.white,
                        border: `1px solid ${C.black}`,
                      }}
                    />
                    <Typography sx={{ ...os({ fontSize: 10, color: C.ash }) }}>
                      {j.date || "—"}
                    </Typography>
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 12,
                          color: C.black,
                          fontWeight: FW_REGULAR,
                        }),
                      }}
                    >
                      {j.stage || "Event"}
                    </Typography>
                    <Typography
                      sx={{
                        ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6 }),
                      }}
                    >
                      {j.detail}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}

          {/* ── CURRENT DISEASE + TREATMENT HISTORY ───────── */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" },
              gap: 4,
              mb: 4,
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
                    mb: 2,
                  }),
                }}
              >
                Current disease
              </Typography>
              {storyData.current_disease.map((row, i) => (
                <InfoRow key={i} label={row.label} value={row.value} />
              ))}
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
                    mb: 2,
                  }),
                }}
              >
                Treatment history
              </Typography>
              {storyData.treatment_history.map((row, i) => (
                <InfoRow key={i} label={row.label} value={row.value} />
              ))}
            </Box>
          </Box>

          {/* ── PATIENT CONTEXT ───────────────────────────── */}
          {storyData.context.length > 0 && (
            <Box>
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
                Patient context
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 2 }) }}>
                Shown as "Not documented" when absent, never assumed.
              </Typography>
              {storyData.context.map((row, i) => (
                <InfoRow key={i} label={row.label} value={row.value} />
              ))}
            </Box>
          )}
        </>
      )}
    </motion.div>
  );
}