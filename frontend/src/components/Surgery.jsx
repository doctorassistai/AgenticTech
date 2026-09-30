import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { motion } from "framer-motion";

/* ------------------------------------------------------------------ */
/*  Brand tokens                                                       */
/* ------------------------------------------------------------------ */
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_REGULAR = 400;
const C = {
  black: "#000000",
  charcoal: "#444444",
  ash: "#888888",
  mist: "#e0e0e0",
  ghost: "#fafafa",
  white: "#ffffff",
};
const os = (x = {}) => ({
  fontFamily: FONT,
  fontWeight: FW_LIGHT,
  WebkitFontSmoothing: "antialiased",
  ...x,
});

const API_BASE_URL =
  (typeof import.meta !== "undefined" &&
    import.meta.env &&
    import.meta.env.VITE_BACKEND_URL) ||
  "https://doctorassist.ai/api/";

/* ------------------------------------------------------------------ */
/*  Marker                                                             */
/* ------------------------------------------------------------------ */
const Marker = ({ s = "in" }) => {
  const M = {
    ok: { borderRadius: "50%", background: C.black },
    cr: { transform: "rotate(45deg)", background: C.black },
    rv: {
      borderRadius: "50%",
      border: `1.5px solid ${C.black}`,
      background: `linear-gradient(90deg, ${C.black} 50%, transparent 50%)`,
    },
    ms: { borderRadius: "50%", border: `1.5px dashed ${C.black}` },
    in: { borderRadius: "50%", border: `1.5px solid ${C.mist}` },
  };
  return <Box sx={{ width: 11, height: 11, mt: 0.6, flexShrink: 0, ...M[s] }} />;
};

/* ------------------------------------------------------------------ */
/*  Section header — matches the static look                           */
/* ------------------------------------------------------------------ */
const SectionHeader = ({ children, sub }) => (
  <Box sx={{ mb: 1.5 }}>
    <Typography
      sx={{
        ...os({
          fontSize: 11,
          color: C.black,
          fontWeight: FW_REGULAR,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }),
      }}
    >
      {children}
    </Typography>
    {sub && (
      <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>
        {sub}
      </Typography>
    )}
  </Box>
);

/* ------------------------------------------------------------------ */
/*  Hero                                                               */
/* ------------------------------------------------------------------ */
const Hero = ({ hero }) => (
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
      {hero.patientLabel}
    </Typography>
    <Typography
      sx={{ ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }) }}
    >
      {hero.headline}
    </Typography>
    <Typography sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}>
      {hero.sub}
    </Typography>
  </Box>
);

/* ------------------------------------------------------------------ */
/*  Universal 3-column table (Item / Finding / Basis)                  */
/* ------------------------------------------------------------------ */
const ReadinessTable = ({ rows }) => {
  if (!rows || !rows.length) return null;
  return (
    <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", mb: 3 }}>
      <Box component="thead">
        <Box component="tr">
          {["Item", "Finding", "Basis"].map((h) => (
            <Box
              component="th"
              key={h}
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
              {h}
            </Box>
          ))}
        </Box>
      </Box>
      <Box component="tbody">
        {rows.map((r, i) => (
          <Box component="tr" key={`${r.item}-${i}`}>
            <Box
              component="td"
              sx={{
                fontSize: 12,
                color: C.charcoal,
                py: 1.2,
                pr: 2,
                borderBottom: `1px solid ${C.mist}`,
                verticalAlign: "top",
                width: "26%",
              }}
            >
              {r.item}
            </Box>
            <Box
              component="td"
              sx={{
                fontSize: 12,
                color: C.black,
                py: 1.2,
                pr: 2,
                borderBottom: `1px solid ${C.mist}`,
                verticalAlign: "top",
                lineHeight: 1.55,
              }}
            >
              {r.finding}
            </Box>
            <Box
              component="td"
              sx={{
                fontSize: 10,
                color: C.ash,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                py: 1.2,
                borderBottom: `1px solid ${C.mist}`,
                verticalAlign: "top",
                width: "22%",
              }}
            >
              {r.basis}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Universal 2-column table (Label / Value) — for the record blocks   */
/* ------------------------------------------------------------------ */
const TwoColTable = ({ rows }) => {
  if (!rows || !rows.length) return null;
  return (
    <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", mb: 3 }}>
      <Box component="tbody">
        {rows.map(([k, v], i) => (
          <Box component="tr" key={`${k}-${i}`}>
            <Box
              component="td"
              sx={{
                fontSize: 10,
                color: C.ash,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                py: 1.2,
                pr: 2,
                borderBottom: `1px solid ${C.mist}`,
                verticalAlign: "top",
                width: "26%",
              }}
            >
              {k}
            </Box>
            <Box
              component="td"
              sx={{
                fontSize: 12,
                color: C.black,
                py: 1.2,
                borderBottom: `1px solid ${C.mist}`,
                verticalAlign: "top",
                lineHeight: 1.6,
                whiteSpace: "pre-wrap",
              }}
            >
              {v}
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Pre-surgery details block                                          */
/* ------------------------------------------------------------------ */
const PreSurgeryDetailsBlock = ({ rows }) => {
  if (!rows || !rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Pre-surgery details</SectionHeader>
      <ReadinessTable rows={rows} />
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Readiness block                                                    */
/* ------------------------------------------------------------------ */
const ReadinessBlock = ({ rows }) => {
  if (!rows || !rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Surgical readiness</SectionHeader>
      <ReadinessTable rows={rows} />
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Operative note block                                               */
/* ------------------------------------------------------------------ */
const OperativeNoteBlock = ({ data }) => {
  if (!data) return null;
  const rows = [
    ["Procedure", data.procedure],
    ["Approach", data.approach],
    ["Laterality", data.laterality],
    ["Surgeon", data.surgeon],
    ["Assistant", data.assistant],
    ["Date", data.date],
    ["Start / end", data.startTime && data.endTime
      ? `${data.startTime} → ${data.endTime}` : null],
    ["Duration", data.duration],
    ["Findings", data.findings],
    ["Procedure details", data.procedure_details],
    ["Blood loss", data.blood_loss],
    ["Transfusion", data.transfusion],
    ["Specimens", data.specimens],
    ["Drains", data.drains],
    ["Intent", data.intent],
    ["Complications", data.complications],
  ].filter(([, v]) => v && v !== "Not documented");

  if (!rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Operative record</SectionHeader>
      <TwoColTable rows={rows} />
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Anaesthesia block                                                  */
/* ------------------------------------------------------------------ */
const AnaesthesiaBlock = ({ data }) => {
  if (!data) return null;
  const rows = [
    ["Mode", data.mode],
    ["Monitors", Array.isArray(data.monitors) ? data.monitors.join(", ") : data.monitors],
    ["Airway", data.airway],
    ["Induction", data.induction],
    ["Maintenance", data.maintenance],
    ["Ventilation", data.ventilation],
    ["Fluids", data.fluids],
    ["Blood products", data.blood_products],
    ["Vasoactives", data.vasoactives],
    ["Reversal", data.reversal],
    ["Extubation", data.extubation],
    ["Post-op condition", data.post_op_condition],
  ].filter(([, v]) => v && v !== "Not documented");

  const vitals = data.recovery_vitals || {};
  const vitalEntries = ["PR", "BP", "SpO2", "RR", "Temp"]
    .map((k) => [k, vitals[k]])
    .filter(([, v]) => v && v !== "Not documented");

  if (!rows.length && !vitalEntries.length) return null;

  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Anaesthesia record</SectionHeader>
      <TwoColTable rows={rows} />
      {vitalEntries.length > 0 && (
        <TwoColTable
          rows={[
            [
              "Recovery vitals",
              vitalEntries.map(([k, v]) => `${k} ${v}`).join(" · "),
            ],
          ]}
        />
      )}
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Pathology block                                                    */
/* ------------------------------------------------------------------ */
const PathologyBlock = ({ data }) => {
  if (!data || !data.available) return null;

  const staging = data.staging || {};
  const stagingLine = ["pT", "pN", "pM"]
    .map((k) => staging[k])
    .filter((v) => v && v !== "Not documented")
    .join(" ");

  const rows = [
    ["Specimen", data.specimen],
    ["Diagnosis", data.diagnosis],
    ["Histology", data.histology],
    ["Staging", stagingLine || null],
    ["Stage group", staging.group],
    ["Nodes examined", data.nodes_examined],
    ["Nodes positive", data.nodes_positive],
    ["Resection", data.resection],
    ["Margins", data.margins],
    ["Margin distance", data.margin_distance],
    ["LVI", data.lvi],
    ["PNI", data.pni],
    ["Biomarkers", data.biomarkers],
    ["Report date", data.report_date],
    ["Notes", data.notes],
  ].filter(([, v]) => v && v !== "Not documented");

  if (!rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Pathology</SectionHeader>
      <TwoColTable rows={rows} />
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Recovery block                                                     */
/* ------------------------------------------------------------------ */
const RecoveryBlock = ({ data }) => {
  if (!data) return null;

  const complicationsText = data.has_complications
    ? (data.complications || []).join(", ")
    : "None";

  const readmit = [data.readmit_30, data.readmit_90].filter(
    (v) => v && v !== "Not documented"
  );
  const mortality = [data.mortality_30, data.mortality_90].filter(
    (v) => v && v !== "Not documented"
  );

  const rows = [
    ["Complications", complicationsText],
    ["Clavien-Dindo", data.clavien_dindo],
    ["Readmit 30 / 90 d", readmit.length ? readmit.join(" / ") : null],
    ["Mortality 30 / 90 d", mortality.length ? mortality.join(" / ") : null],
    ["Post-op plan", data.post_op_plan],
    ["Analgesia", data.analgesia_plan],
    ["Diet", data.diet],
    ["VTE prophylaxis", data.vte_prophylaxis],
    ["Drain care", data.drain_care],
  ].filter(([, v]) => v && v !== "Not documented");

  const milestones = Array.isArray(data.milestones) ? data.milestones : [];
  if (!rows.length && !milestones.length) return null;

  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Post-operative recovery</SectionHeader>
      <TwoColTable rows={rows} />
      {milestones.map((m, i) => (
        <TwoColTable
          key={i}
          rows={[[m.day || `Day ${i}`, m.event || ""]]}
        />
      ))}
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Adjuvant decision block                                            */
/* ------------------------------------------------------------------ */
const AdjuvantBlock = ({ data }) => {
  if (!data || !data.indicated) return null;
  const rows = [
    ["Indicated", "Yes"],
    ["Modality", data.modality],
    ["Basis", data.basis],
    ["Next module", data.next_module],
    ["Owner", data.owner],
    ["MDT review", data.mdt_review],
  ].filter(([, v]) => v && v !== "Not documented");

  if (!rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Adjuvant decision</SectionHeader>
      <TwoColTable rows={rows} />
    </Box>
  );
};

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */
export default function Surgery({
  patientId = null,
  doctorId = null,
  patientName = null,
  apiBaseUrl = API_BASE_URL,
}) {
  /* Record — auto-fetched */
  const [record, setRecord] = useState(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState(null);

  /* Pre-surgery details — auto-fetched */
  const [presurgery, setPresurgery] = useState(null);
  const [presurgeryLoading, setPresurgeryLoading] = useState(false);
  const [presurgeryError, setPresurgeryError] = useState(null);

  /* Readiness — behind the button */
  const [readiness, setReadiness] = useState(null);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [readinessError, setReadinessError] = useState(null);

  const recordAbortRef = useRef(null);
  const presurgeryAbortRef = useRef(null);
  const readinessAbortRef = useRef(null);

  const base = (apiBaseUrl || "").replace(/\/+$/, "");
  const query = doctorId ? `?doctor_id=${encodeURIComponent(doctorId)}` : "";

  /* -------- Auto-fetch surgical record -------- */
  useEffect(() => {
    if (!patientId) {
      setRecord(null);
      setRecordLoading(false);
      return;
    }
    if (recordAbortRef.current) recordAbortRef.current.abort();
    const controller = new AbortController();
    recordAbortRef.current = controller;

    setRecordLoading(true);
    setRecordError(null);

    fetch(
      `${base}/hms/users/ai-legacy/surgery/record/${encodeURIComponent(
        patientId
      )}${query}`,
      { signal: controller.signal, headers: { Accept: "application/json" } }
    )
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GET failed: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!controller.signal.aborted) setRecord(json);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setRecordError(err.message || "Failed to load surgical record");
      })
      .finally(() => {
        if (!controller.signal.aborted) setRecordLoading(false);
      });

    return () => controller.abort();
  }, [base, patientId, query]);

  /* -------- Auto-fetch pre-surgery details -------- */
  useEffect(() => {
    if (!patientId) {
      setPresurgery(null);
      return;
    }
    if (presurgeryAbortRef.current) presurgeryAbortRef.current.abort();
    const controller = new AbortController();
    presurgeryAbortRef.current = controller;

    setPresurgeryLoading(true);
    setPresurgeryError(null);

    fetch(
      `${base}/hms/users/ai-legacy/surgery/presurgery-details/${encodeURIComponent(
        patientId
      )}${query}`,
      { signal: controller.signal, headers: { Accept: "application/json" } }
    )
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GET failed: ${res.status}`);
        return res.json();
      })
      .then((json) => {
        if (!controller.signal.aborted) setPresurgery(json);
      })
      .catch((err) => {
        if (err?.name === "AbortError") return;
        setPresurgeryError(err.message || "Failed to load pre-surgery details");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPresurgeryLoading(false);
      });

    return () => controller.abort();
  }, [base, patientId, query]);

  /* -------- Manual readiness fetch -------- */
  const fetchReadiness = useCallback(async () => {
    if (!patientId || readinessLoading) return;
    if (readinessAbortRef.current) readinessAbortRef.current.abort();
    const controller = new AbortController();
    readinessAbortRef.current = controller;

    setReadinessLoading(true);
    setReadinessError(null);

    try {
      const res = await fetch(
        `${base}/hms/users/ai-legacy/surgery/readiness/${encodeURIComponent(
          patientId
        )}${query}`,
        { signal: controller.signal, headers: { Accept: "application/json" } }
      );
      if (!res.ok) throw new Error(`GET failed: ${res.status}`);
      const json = await res.json();
      setReadiness(Array.isArray(json.readiness) ? json.readiness : []);
    } catch (err) {
      if (err?.name === "AbortError") return;
      setReadinessError(err.message || "Failed to load readiness");
    } finally {
      setReadinessLoading(false);
    }
  }, [base, patientId, query, readinessLoading]);

  /* -------- Reset readiness when patient changes -------- */
  useEffect(() => {
    setReadiness(null);
    setReadinessError(null);
    setReadinessLoading(false);
    if (readinessAbortRef.current) readinessAbortRef.current.abort();
  }, [patientId]);

  /* -------- Derived hero -------- */
  const hero = useMemo(() => {
    if (record?.hero) {
      return {
        patientLabel:
          record.hero.patientLabel ||
          (patientName ? `${patientName} / Surgery` : "Surgery"),
        headline: record.hero.headline || "Surgical review.",
        sub:
          record.hero.sub ||
          "Imaging facts are separated from what needs surgical judgement.",
      };
    }
    return {
      patientLabel: patientName ? `${patientName} / Surgery` : "Surgery",
      headline: recordLoading ? "Loading surgical record…" : "Surgical review.",
      sub: "Imaging facts are separated from what needs surgical judgement.",
    };
  }, [record, patientName, recordLoading]);

  const hasRecord = Boolean(record?.has_surgical_record);

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.2 }}
      style={{ fontFamily: FONT, color: C.black }}
    >
      <link
        href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap"
        rel="stylesheet"
      />

      <Box sx={{ width: "100%" }}>
        <Hero hero={hero} />

        {recordError && (
          <Typography
            sx={{ ...os({ fontSize: 11, color: C.charcoal, mb: 2 }) }}
          >
            Could not load the surgical record — {recordError}
          </Typography>
        )}

        {/* Pre-surgery details — always auto-loaded */}
        {presurgeryLoading && (
          <Typography
            sx={{
              ...os({
                fontSize: 11,
                color: C.ash,
                mb: 3,
                fontStyle: "italic",
              }),
            }}
          >
            Loading pre-surgery context…
          </Typography>
        )}

        {presurgeryError && !presurgeryLoading && (
          <Typography
            sx={{ ...os({ fontSize: 11, color: C.charcoal, mb: 3 }) }}
          >
            Could not load pre-surgery details — {presurgeryError}
          </Typography>
        )}

        {presurgery?.details && presurgery.details.length > 0 && (
          <PreSurgeryDetailsBlock rows={presurgery.details} />
        )}

        {/* Readiness — behind the button */}
        {!readiness && !readinessLoading && (
          <Box sx={{ mb: 4 }}>
            <Box
              component="button"
              onClick={fetchReadiness}
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
              Check readiness
            </Box>
          </Box>
        )}

        {readinessLoading && (
          <Typography
            sx={{
              ...os({
                fontSize: 11,
                color: C.ash,
                mb: 3,
                fontStyle: "italic",
              }),
            }}
          >
            Reading the graph…
          </Typography>
        )}

        {readinessError && !readinessLoading && (
          <Box sx={{ mb: 3 }}>
            <Typography
              sx={{ ...os({ fontSize: 11, color: C.charcoal, mb: 1 }) }}
            >
              Could not load readiness — {readinessError}
            </Typography>
            <Box
              component="button"
              onClick={fetchReadiness}
              sx={{
                ...os({
                  fontSize: 11,
                  color: C.black,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }),
                border: `1px solid ${C.mist}`,
                background: C.white,
                px: 2,
                py: 0.75,
                cursor: "pointer",
              }}
            >
              Retry
            </Box>
          </Box>
        )}

        {readiness && readiness.length > 0 && (
          <ReadinessBlock rows={readiness} />
        )}

        {/* Surgical record blocks — auto-populated when data exists */}
        {hasRecord && (
          <>
            <OperativeNoteBlock data={record.operative_record} />
            <AnaesthesiaBlock data={record.anaesthesia_record} />
            <PathologyBlock data={record.pathology} />
            <RecoveryBlock data={record.recovery} />
            <AdjuvantBlock data={record.adjuvant_decision} />
          </>
        )}
      </Box>
    </motion.div>
  );
}