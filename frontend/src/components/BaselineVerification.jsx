// BaselineVerification.jsx
import React, { useState } from "react";
import { Box, Typography, Button, CircularProgress } from "@mui/material";
import { motion, AnimatePresence } from "framer-motion";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";

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
   PRESENTATIONAL HELPERS (unchanged from your original)
   ============================================================ */

const Section = ({ title, count, children, defaultOpen = false }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box
      sx={{
        border: `1px solid ${C.mist}`,
        mb: 1.5,
        "&:hover": { borderColor: C.black },
        transition: "border-color 0.2s",
      }}
    >
      <Box
        onClick={() => setOpen((v) => !v)}
        sx={{
          px: 2,
          py: 1.5,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          cursor: "pointer",
          background: open ? C.ghost : C.white,
          borderBottom: open ? `1px solid ${C.mist}` : "none",
          userSelect: "none",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography
            sx={{
              ...os({
                fontSize: 11,
                color: C.black,
                fontWeight: FW_REGULAR,
                letterSpacing: "0.05em",
                textTransform: "uppercase",
              }),
            }}
          >
            {title}
          </Typography>
          {count > 0 && (
            <Box
              sx={{
                background: C.offwhite,
                border: `1px solid ${C.mist}`,
                px: 1,
                py: 0.1,
              }}
            >
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash }) }}>
                {count}
              </Typography>
            </Box>
          )}
        </Box>
        {open ? (
          <ExpandLessIcon sx={{ fontSize: 14, color: C.ash }} />
        ) : (
          <ExpandMoreIcon sx={{ fontSize: 14, color: C.ash }} />
        )}
      </Box>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            style={{ overflow: "hidden" }}
          >
            <Box sx={{ px: 2, py: 2 }}>{children}</Box>
          </motion.div>
        )}
      </AnimatePresence>
    </Box>
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
      sx={{ ...os({ fontSize: 11, color: C.charcoal, fontWeight: FW_REGULAR }) }}
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
  ok: { borderRadius: "50%", background: C.black },
  rv: {
    borderRadius: "50%",
    border: `1.5px solid ${C.black}`,
    background: `linear-gradient(90deg,${C.black} 50%,transparent 50%)`,
  },
  cr: { rotate: 45, borderRadius: 0, background: C.black },
  ms: { borderRadius: "50%", border: `1.5px dashed ${C.black}` },
  in: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
};

const Marker = ({ s = "in" }) => (
  <Box
    sx={{
      width: 11,
      height: 11,
      mt: 0.6,
      flexShrink: 0,
      ...(MARK[s] || MARK.in),
    }}
  />
);

/* Shared style for the action buttons inside "Needs verification" / "Missing" */
const actionBtnSx = {
  mt: 1,
  fontFamily: FONT,
  fontWeight: FW_REGULAR,
  fontSize: 10,
  color: C.black,
  background: "transparent",
  border: `1px solid ${C.mist}`,
  px: 1.5,
  py: 0.6,
  cursor: "pointer",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  "&:hover": { borderColor: C.black, background: C.ghost },
};

/* ============================================================
   MAIN COMPONENT
   ============================================================ */

export default function BaselineVerification({
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
    setData(null);

    try {
      const url = new URL(
        `${API_BASE_URL}hms/users/ai-legacy/baseline-verification/${encodeURIComponent(patientId)}`
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
          text || `Failed to load baseline verification (HTTP ${res.status})`
        );
      }

      const json = await res.json();
      setData(json);
      setGenerated(true);
    } catch (err) {
      console.error("[BaselineVerification] fetch failed:", err);
      setError(err.message || "Failed to load baseline verification.");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  /* ----------------------------------------------------------
     GUARD — no patient / doctor selected
     ---------------------------------------------------------- */
  if (!patientId || !doctorId) {
    return (
      <Box sx={{ p: 4, textAlign: "center" }}>
        <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
          Select a patient to view baseline & verification.
        </Typography>
      </Box>
    );
  }

  /* ----------------------------------------------------------
     DESTRUCTURE — only when data exists
     ---------------------------------------------------------- */
  const hero      = data?.hero                || {};
  const counters  = data?.counters            || {};
  const readiness = data?.readiness           || [];
  const needs     = data?.needs_verification  || [];
  const missing   = data?.missing_important   || [];
  const changes   = data?.changes             || [];
  const verified  = data?.verified            || [];
  const conflicts = data?.conflicts           || [];
  const values    = data?.values              || [];
  const geriatric = data?.geriatric           || {};
  const sequence  = data?.verification_sequence || "";

  const countersList = [
    ["Verified",                    counters.verified                    || 0],
    ["Needs verification",          counters.needs_verification          || 0],
    ["Missing but important",       counters.missing_important           || 0],
    ["Clinically relevant change",  counters.clinically_relevant_change  || 0],
  ];

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

      {/* ── GENERATE BUTTON BAR ─────────────────────────────── */}
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
          {patientName
            ? `${patientName} / Baseline & verification`
            : "Baseline & verification"}
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
              : generated
              ? "Regenerate"
              : "Generate Verification"}
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

      {/* ── LOADING ─────────────────────────────────────────── */}
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
            Verifying baseline…
          </Typography>
        </Box>
      )}

      {/* ── ERROR ───────────────────────────────────────────── */}
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

      {/* ── EMPTY STATE — before first generation ───────────── */}
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
            No verification generated yet.
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
            Click <b>Generate Verification</b> above to build it from the
            patient's record.
          </Typography>
        </Box>
      )}

      {/* ── MAIN CONTENT — only when data is loaded ─────────── */}
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
              {hero.eyebrow || "Baseline & verification"}
            </Typography>
            <Typography
              sx={{
                ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }),
              }}
            >
              {hero.headline || "Baseline and verification status."}
            </Typography>
            <Typography
              sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}
            >
              {hero.subtitle ||
                "What is confirmed now, what is uncertain, and is the patient characterised enough to decide?"}
            </Typography>
          </Box>

          {/* Readiness counters */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: { xs: "1fr 1fr", md: "repeat(4,1fr)" },
              gap: 2,
              mb: 3,
            }}
          >
            {countersList.map(([k, v]) => (
              <Box key={k}>
                <Typography
                  sx={{ ...os({ fontSize: 34, color: C.black, lineHeight: 1.1 }) }}
                >
                  {v}
                </Typography>
                <Typography
                  sx={{
                    ...os({
                      fontSize: 11,
                      color: C.ash,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                      mt: 0.5,
                    }),
                  }}
                >
                  {k}
                </Typography>
              </Box>
            ))}
          </Box>

          {/* Baseline readiness */}
          <Section title="Baseline readiness" count={readiness.length} defaultOpen>
            {readiness.map((row, i) => (
              <Box
                key={i}
                sx={{
                  display: "grid",
                  gridTemplateColumns: "20px 1fr",
                  gap: 1.5,
                  py: 1,
                  borderBottom:
                    i < readiness.length - 1 ? `1px solid ${C.mist}` : "none",
                }}
              >
                <Marker s={row.status || "in"} />
                <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                  {row.checkpoint}
                </Typography>
              </Box>
            ))}
          </Section>

          {/* Needs verification */}
          {needs.length > 0 && (
            <Section title="Needs verification" count={needs.length} defaultOpen>
              {needs.map((x, i) => (
                <Box
                  key={i}
                  sx={{
                    mb: 2,
                    pb: 2,
                    borderBottom:
                      i < needs.length - 1 ? `1px solid ${C.mist}` : "none",
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 13,
                        color: C.black,
                        fontWeight: FW_REGULAR,
                        mb: 0.5,
                      }),
                    }}
                  >
                    {x.title}
                  </Typography>
                  <Typography
                    sx={{ ...os({ fontSize: 11, color: C.ash, lineHeight: 1.7 }) }}
                  >
                    {x.why}
                  </Typography>
                  {x.action && (
                    <Box component="button" sx={actionBtnSx}>
                      {x.action}
                    </Box>
                  )}
                  {x.source && (
                    <Typography
                      sx={{ ...os({ fontSize: 10, color: C.ash, mt: 1 }) }}
                    >
                      source: {x.source}
                    </Typography>
                  )}
                </Box>
              ))}
            </Section>
          )}

          {/* Missing but important */}
          {missing.length > 0 && (
            <Section title="Missing but important" count={missing.length}>
              {missing.map((x, i) => (
                <Box
                  key={i}
                  sx={{
                    mb: 2,
                    pb: 2,
                    borderBottom:
                      i < missing.length - 1 ? `1px solid ${C.mist}` : "none",
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 13,
                        color: C.black,
                        fontWeight: FW_REGULAR,
                        mb: 0.5,
                      }),
                    }}
                  >
                    {x.title}
                  </Typography>
                  <Typography
                    sx={{ ...os({ fontSize: 11, color: C.ash, lineHeight: 1.7 }) }}
                  >
                    {x.why}
                  </Typography>
                  {x.action && (
                    <Box component="button" sx={actionBtnSx}>
                      {x.action}
                    </Box>
                  )}
                  {x.source && (
                    <Typography
                      sx={{ ...os({ fontSize: 10, color: C.ash, mt: 1 }) }}
                    >
                      source: {x.source}
                    </Typography>
                  )}
                </Box>
              ))}
            </Section>
          )}

          {/* Clinically relevant change */}
          {changes.length > 0 && (
            <Section title="Clinically relevant change" count={changes.length}>
              {changes.map((x, i) => (
                <Box key={i} sx={{ mb: i < changes.length - 1 ? 2 : 0 }}>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 13,
                        color: C.black,
                        fontWeight: FW_REGULAR,
                        mb: 0.5,
                      }),
                    }}
                  >
                    {x.title}
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                    {x.why}
                  </Typography>
                  {x.source && (
                    <Typography
                      sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.5 }) }}
                    >
                      source: {x.source}
                    </Typography>
                  )}
                </Box>
              ))}
            </Section>
          )}

          {/* Verified */}
          {verified.length > 0 && (
            <Section title="Verified" count={verified.length}>
              {verified.map((row, i) => (
                <Box
                  key={i}
                  sx={{
                    display: "grid",
                    gridTemplateColumns: "20px 1fr",
                    gap: 1.5,
                    py: 1,
                    borderBottom:
                      i < verified.length - 1 ? `1px solid ${C.mist}` : "none",
                  }}
                >
                  <Marker s="ok" />
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
                      {row.text}
                    </Typography>
                    {row.source && (
                      <Typography
                        sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.3 }) }}
                      >
                        source: {row.source}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Section>
          )}

          {/* Conflicts */}
          {conflicts.length > 0 && (
            <Section
              title="Consistency check across documents"
              count={conflicts.length}
              defaultOpen
            >
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 2 }) }}>
                Shown as items to verify, not as AI conclusions.
              </Typography>
              {conflicts.map((c, i) => (
                <Box
                  key={i}
                  sx={{
                    mb: 1.5,
                    pb: 1.5,
                    borderBottom:
                      i < conflicts.length - 1 ? `1px solid ${C.mist}` : "none",
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 11,
                        color: C.ash,
                        textDecoration: "line-through",
                      }),
                    }}
                  >
                    {c.a}
                  </Typography>
                  <Typography
                    sx={{ ...os({ fontSize: 12, color: C.black, mt: 0.5 }) }}
                  >
                    {c.b}
                  </Typography>
                  {(c.source_a || c.source_b) && (
                    <Typography
                      sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.5 }) }}
                    >
                      sources: {c.source_a} · {c.source_b}
                    </Typography>
                  )}
                </Box>
              ))}
            </Section>
          )}

          {/* Current clinical baseline */}
          {values.length > 0 && (
            <Section title="Current clinical baseline" count={values.length} defaultOpen>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 2 }) }}>
                Every value shows its date; old values are never used silently.
              </Typography>
              {values.map((row, i) => (
                <InfoRow key={i} label={row.label} value={row.value} />
              ))}
            </Section>
          )}

          {/* Geriatric & functional domains */}
          <Section title="Geriatric and functional domains">
            <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
              {geriatric.text || "Not documented"}
            </Typography>
            {geriatric.source && (
              <Typography
                sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.5 }) }}
              >
                source: {geriatric.source}
              </Typography>
            )}
          </Section>

          {/* Footer strip */}
          <Strip
            text={
              sequence
                ? `Verification sequence: ${sequence}`
                : "Verification sequence: History → Identity → Extent → Pathology & biomarkers → Clinical status → Function → Comorbidity & medicines → Labs & organ function → Prior exposure → Prerequisites → Contradictions → Missing data → Evidence → Readiness"
            }
          />
        </>
      )}
    </motion.div>
  );
}