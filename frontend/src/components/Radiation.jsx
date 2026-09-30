import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Box, Typography } from "@mui/material";
import { motion } from "framer-motion";

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

const stripDoseUnit = (v) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s || s === "Not documented") return null;
  return s.replace(/\s*c?gy\s*$/i, "").trim();
};

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

const SectionHeader = ({ children, sub }) => (
  <Box sx={{ pb: 1.25, mb: 1.5, borderBottom: `1px solid ${C.mist}` }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em" }) }}>
      {children}
    </Typography>
    {sub && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>{sub}</Typography>}
  </Box>
);

const Hero = ({ hero }) => (
  <Box sx={{ pb: 3, mb: 3, borderBottom: `1px solid ${C.mist}` }}>
    <Typography sx={{ ...os({ fontSize: 11, color: C.ash, letterSpacing: "0.1em", textTransform: "uppercase", mb: 1 }) }}>
      {hero.patientLabel}
    </Typography>
    <Typography sx={{ ...os({ fontSize: 22, color: C.black, lineHeight: 1.3, mb: 1.5 }) }}>
      {hero.headline}
    </Typography>
    <Typography sx={{ ...os({ fontSize: 13, color: C.ash, maxWidth: "60ch" }) }}>
      {hero.sub}
    </Typography>
  </Box>
);

const TwoColTable = ({ rows }) => {
  if (!rows || !rows.length) return null;
  return (
    <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", mb: 3 }}>
      <Box component="tbody">
        {rows.map(([k, v], i) => (
          <Box component="tr" key={`${k}-${i}`}>
            <Box component="td" sx={{ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.06em", py: 1.2, pr: 2, borderBottom: `1px solid ${C.mist}`, verticalAlign: "top", width: "26%" }}>{k}</Box>
            <Box component="td" sx={{ fontSize: 12, color: C.black, py: 1.2, borderBottom: `1px solid ${C.mist}`, verticalAlign: "top", lineHeight: 1.6, whiteSpace: "pre-wrap" }}>{v}</Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

const MultiColTable = ({ headers, rows }) => {
  if (!rows || !rows.length) return null;
  return (
    <Box component="table" sx={{ width: "100%", borderCollapse: "collapse", mb: 3 }}>
      <Box component="thead">
        <Box component="tr">
          {headers.map((h) => (
            <Box component="th" key={h} sx={{ textAlign: "left", fontSize: 10, fontWeight: FW_LIGHT, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em", py: 1, pr: 2, borderBottom: `1px solid ${C.black}`, whiteSpace: "nowrap" }}>{h}</Box>
          ))}
        </Box>
      </Box>
      <Box component="tbody">
        {rows.map((r, i) => (
          <Box component="tr" key={i}>
            {r.map((cell, j) => (
              <Box component="td" key={j} sx={{ fontSize: 12, color: j === 0 ? C.charcoal : C.black, py: 1.2, pr: 2, borderBottom: `1px solid ${C.mist}`, verticalAlign: "top", lineHeight: 1.55 }}>{cell}</Box>
            ))}
          </Box>
        ))}
      </Box>
    </Box>
  );
};

const PreRadiotherapyContextBlock = ({ rows }) => {
  if (!rows || !rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Pre-radiotherapy context</SectionHeader>
      <MultiColTable headers={["Item", "Finding", "Basis"]} rows={rows.map((r) => [r.item, r.finding, r.basis])} />
    </Box>
  );
};

const PrescriptionBlock = ({ data }) => {
  if (!data) return null;
  const rows = [
    ["Intent", data.intent],
    ["Setting", data.setting],
    ["Technique", data.technique],
    ["Machine", data.machine],
    ["Total dose", data.totalDose],
    ["Fractions", data.totalFractions],
    ["Dose / fraction", data.dosePerFraction],
    ["Schedule", data.schedule],
    ["Boost", data.boost],
    ["Start", data.startDate],
    ["End", data.endDate],
    ["Planning system", data.planningSystem],
    ["Dose algorithm", data.doseAlgorithm],
    ["Dose grid", data.doseGridMm],
    ["Consent", data.consentTaken && data.consentDate && data.consentDate !== "Not documented" ? `${data.consentTaken} — ${data.consentDate}` : data.consentTaken],
  ].filter(([, v]) => v && v !== "Not documented");
  if (!rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Prescription</SectionHeader>
      <TwoColTable rows={rows} />
    </Box>
  );
};

const TargetsBlock = ({ targets }) => {
  if (!targets || !targets.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Target volumes</SectionHeader>
      <MultiColTable headers={["Volume", "Type", "Volume (cc)", "Prescribed dose"]} rows={targets.map((t) => [t.name, t.type, t.volumeCc, t.prescribedDose])} />
    </Box>
  );
};

const OarsBlock = ({ oars }) => {
  if (!oars || !oars.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader sub="Institutional limits the plan is targeting — not achieved values.">Organs at risk — constraints</SectionHeader>
      <MultiColTable
        headers={["Organ", "Mean limit", "Max limit", "Status"]}
        rows={oars.map((o) => [
          o.organ,
          o.meanLimit,
          o.maxLimit,
          o.status && o.status !== "Not documented" ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
              <Marker s={o.status === "Safe" ? "ok" : o.status === "Not Safe" ? "cr" : "rv"} />
              <span>{o.status}</span>
            </Box>
          ) : "Not documented",
        ])}
      />
    </Box>
  );
};

const SetupBlock = ({ setup, simulation }) => {
  if (!setup && !simulation) return null;
  const rows = [];
  if (setup) {
    [
      ["Immobilisation", setup.immobilisation],
      ["Position", setup.position],
      ["Orientation", setup.orientation],
      ["Mould room", setup.mouldRoomDate],
      ["Technician", setup.technician],
      ["Tattoos", setup.tattoos],
      ["Laser marks", setup.laserMarks],
      ["Verification", setup.verification],
      ["Setup notes", setup.notes],
    ].forEach(([k, v]) => { if (v && v !== "Not documented") rows.push([k, v]); });
  }
  if (simulation) {
    [
      ["Simulation date", simulation.date],
      ["Imaging", simulation.type],
      ["Slice thickness", simulation.sliceThickness],
      ["Contrast", simulation.contrast],
      ["Simulation notes", simulation.notes],
    ].forEach(([k, v]) => { if (v && v !== "Not documented") rows.push([k, v]); });
  }
  if (!rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Setup and simulation</SectionHeader>
      <TwoColTable rows={rows} />
    </Box>
  );
};

const BeamsBlock = ({ beams }) => {
  if (!beams || !beams.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Beam parameters</SectionHeader>
      <MultiColTable
        headers={["Field", "Energy", "Gantry", "Collimator", "Field size", "SSD", "Wedge", "MU / fx"]}
        rows={beams.map((b) => [b.field, b.energy, b.gantry, b.collimator, b.fieldSize, b.ssd, b.wedge, b.muPerFraction])}
      />
    </Box>
  );
};

const WorkflowBlock = ({ steps }) => {
  if (!Array.isArray(steps) || !steps.length) return null;
  const marker = (s) => s === "done" ? "ok" : s === "in_progress" ? "rv" : "in";
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Workflow</SectionHeader>
      {steps.map((s, i) => (
        <Box key={i} sx={{ display: "grid", gridTemplateColumns: "22px 28% 1fr", gap: 1.5, py: 1.2, borderBottom: `1px solid ${C.mist}`, alignItems: "baseline" }}>
          <Marker s={marker(s.status)} />
          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, fontWeight: FW_REGULAR }) }}>{s.step}</Typography>
          <Typography sx={{ ...os({ fontSize: 12, color: C.black, lineHeight: 1.55 }) }}>{s.detail}</Typography>
        </Box>
      ))}
    </Box>
  );
};

const DeliveryBlock = ({ data }) => {
  if (!data) return null;
  const deliveredFrac = data.deliveredFractions;
  const totalFrac = data.totalFractions;
  const deliveredDose = stripDoseUnit(data.deliveredDoseGy);
  const totalDose = stripDoseUnit(data.totalDoseGy);
  const fractionsText = deliveredFrac && totalFrac ? `${deliveredFrac} of ${totalFrac}` : null;
  const cumulativeText = deliveredDose && totalDose ? `${deliveredDose} / ${totalDose} Gy` : null;
  const summaryRows = [
    ["Started", data.startDate],
    ["Ends (planned)", data.endDate],
    ["Fractions", fractionsText],
    ["Cumulative dose", cumulativeText],
    ["Machine", data.machine],
  ].filter(([, v]) => v && v !== "Not documented");
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  if (!summaryRows.length && !sessions.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Delivery</SectionHeader>
      <TwoColTable rows={summaryRows} />
      {sessions.length > 0 && (
        <MultiColTable
          headers={["Date", "Fx", "Dose", "Shift X / Y / Z", "Beam-on", "Notes"]}
          rows={sessions.map((s) => [
            s.date || "—",
            s.fraction || "—",
            s.dose || "—",
            s.shift || "—",
            s.durationMin && s.durationMin !== "Not documented" ? `${s.durationMin} min` : "—",
            s.notes || "",
          ])}
        />
      )}
    </Box>
  );
};

const ApprovalsBlock = ({ data }) => {
  if (!data) return null;
  const rows = [
    ["Consent", data.consentTaken && data.consentDate && data.consentDate !== "Not documented" ? `${data.consentTaken} — ${data.consentDate}` : data.consentTaken],
    ["RO", data.roName && typeof data.roSigned === "boolean" ? `${data.roName} — ${data.roSigned ? "signed" : "not signed"}` : data.roName],
    ["MP", data.mpName && typeof data.mpSigned === "boolean" ? `${data.mpName} — ${data.mpSigned ? "signed" : "not signed"}` : data.mpName],
    ["RTT", data.rttName && typeof data.rttSigned === "boolean" ? `${data.rttName} — ${data.rttSigned ? "signed" : "not signed"}` : data.rttName],
    ["Peer review", data.peerReview],
  ].filter(([, v]) => v && v !== "Not documented");
  if (!rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Approvals and consent</SectionHeader>
      <TwoColTable rows={rows} />
    </Box>
  );
};

const AdverseEventsBlock = ({ events }) => {
  if (!Array.isArray(events) || !events.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Adverse events</SectionHeader>
      {events.map((e, i) => (
        <Box key={i} sx={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 1.5, py: 1.2, borderBottom: `1px solid ${C.mist}` }}>
          <Marker s={e.anticipated ? "in" : "rv"} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 12, color: C.black, fontWeight: FW_REGULAR }) }}>
              {e.event}{e.grade && e.grade !== "Not documented" ? ` — ${e.grade}` : ""}{e.anticipated ? " (anticipated)" : ""}
            </Typography>
            {e.date && e.date !== "Not documented" && (
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>{e.date}</Typography>
            )}
            {e.management && e.management !== "Not documented" && (
              <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.5, lineHeight: 1.55 }) }}>{e.management}</Typography>
            )}
          </Box>
        </Box>
      ))}
    </Box>
  );
};

const AdaptiveBlock = ({ data }) => {
  if (!data || !data.flag) return null;
  return (
    <Box sx={{ mb: 4, border: `1px solid ${C.mist}`, borderLeft: `2px solid ${C.black}`, background: C.ghost, px: 1.75, py: 1.5 }}>
      <Typography sx={{ ...os({ fontSize: 11, color: C.black, fontWeight: FW_REGULAR, textTransform: "uppercase", letterSpacing: "0.08em", mb: 1 }) }}>Adaptive review</Typography>
      {data.reason && data.reason !== "Not documented" && (
        <Typography sx={{ ...os({ fontSize: 12, color: C.black, lineHeight: 1.6, mb: 0.5 }) }}>{data.reason}</Typography>
      )}
      {data.recommend && data.recommend !== "Not documented" && (
        <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{data.recommend}</Typography>
      )}
    </Box>
  );
};

const FollowUpBlock = ({ data }) => {
  if (!data) return null;
  const dateText = data.date && data.date !== "Not documented"
    ? data.time && data.time !== "Not documented" ? `${data.date} at ${data.time}` : data.date
    : null;
  const rows = [
    ["Date", dateText],
    ["Imaging advised", data.imagingAdvised],
    ["Plan", data.plan],
    ["Advice", data.advice],
  ].filter(([, v]) => v && v !== "Not documented");
  if (!rows.length) return null;
  return (
    <Box sx={{ mb: 4 }}>
      <SectionHeader>Follow-up</SectionHeader>
      <TwoColTable rows={rows} />
    </Box>
  );
};

export default function Radiation({
  patientId = null,
  doctorId = null,
  hospitalId = null,
  patientName = null,
  apiBaseUrl = API_BASE_URL,
}) {
  const [record, setRecord] = useState(null);
  const [recordLoading, setRecordLoading] = useState(false);
  const [recordError, setRecordError] = useState(null);

  const [context, setContext] = useState(null);
  const [contextLoading, setContextLoading] = useState(false);
  const [contextError, setContextError] = useState(null);

  const [oars, setOars] = useState(null);
  const [oarsLoading, setOarsLoading] = useState(false);
  const [oarsError, setOarsError] = useState(null);

  const recordAbortRef = useRef(null);
  const contextAbortRef = useRef(null);
  const oarsAbortRef = useRef(null);

  const base = (apiBaseUrl || "").replace(/\/+$/, "");

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (doctorId) params.set("doctor_id", doctorId);
    if (hospitalId) params.set("hospital_id", hospitalId);
    return params.toString() ? `?${params.toString()}` : "";
  }, [doctorId, hospitalId]);

  useEffect(() => {
    if (!patientId) { setRecord(null); setRecordLoading(false); return; }
    if (recordAbortRef.current) recordAbortRef.current.abort();
    const controller = new AbortController();
    recordAbortRef.current = controller;
    setRecordLoading(true);
    setRecordError(null);
    fetch(`${base}/hms/users/ai-legacy/radiation/record/${encodeURIComponent(patientId)}${query}`, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GET failed: ${res.status}`);
        return res.json();
      })
      .then((json) => { if (!controller.signal.aborted) setRecord(json); })
      .catch((err) => { if (err?.name === "AbortError") return; setRecordError(err.message || "Failed to load radiation record"); })
      .finally(() => { if (!controller.signal.aborted) setRecordLoading(false); });
    return () => controller.abort();
  }, [base, patientId, query]);

  useEffect(() => {
    if (!patientId) { setContext(null); return; }
    if (contextAbortRef.current) contextAbortRef.current.abort();
    const controller = new AbortController();
    contextAbortRef.current = controller;
    setContextLoading(true);
    setContextError(null);
    fetch(`${base}/hms/users/ai-legacy/radiation/context/${encodeURIComponent(patientId)}${query}`, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GET failed: ${res.status}`);
        return res.json();
      })
      .then((json) => { if (!controller.signal.aborted) setContext(json); })
      .catch((err) => { if (err?.name === "AbortError") return; setContextError(err.message || "Failed to load pre-radiotherapy context"); })
      .finally(() => { if (!controller.signal.aborted) setContextLoading(false); });
    return () => controller.abort();
  }, [base, patientId, query]);

  useEffect(() => {
    if (!patientId) { setOars(null); return; }
    if (oarsAbortRef.current) oarsAbortRef.current.abort();
    const controller = new AbortController();
    oarsAbortRef.current = controller;
    setOarsLoading(true);
    setOarsError(null);
    fetch(`${base}/hms/users/ai-legacy/radiation/oars/${encodeURIComponent(patientId)}${query}`, { signal: controller.signal, headers: { Accept: "application/json" } })
      .then(async (res) => {
        if (res.status === 404) return null;
        if (!res.ok) throw new Error(`GET failed: ${res.status}`);
        return res.json();
      })
      .then((json) => { if (!controller.signal.aborted) setOars(json); })
      .catch((err) => { if (err?.name === "AbortError") return; setOarsError(err.message || "Failed to load OAR constraints"); })
      .finally(() => { if (!controller.signal.aborted) setOarsLoading(false); });
    return () => controller.abort();
  }, [base, patientId, query]);

  const hero = useMemo(() => {
    if (record?.hero) {
      return {
        patientLabel: record.hero.patientLabel || (patientName ? `${patientName} / Radiation` : "Radiation"),
        headline: record.hero.headline || "Radiation review.",
        sub: record.hero.sub || "Prescription, delivery, and follow-up in one view.",
      };
    }
    return {
      patientLabel: patientName ? `${patientName} / Radiation` : "Radiation",
      headline: recordLoading ? "Loading radiation record…" : "Radiation review.",
      sub: "Prescription, delivery, and follow-up in one view.",
    };
  }, [record, patientName, recordLoading]);

  const oarRows = oars?.oars && oars.oars.length ? oars.oars : record?.organs_at_risk || [];

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} style={{ fontFamily: FONT, color: C.black }}>
      <link href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap" rel="stylesheet" />
      <Box sx={{ width: "100%" }}>
        <Hero hero={hero} />

        {recordError && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mb: 2 }) }}>Could not load the radiation record — {recordError}</Typography>}

        {contextLoading && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 3, fontStyle: "italic" }) }}>Loading pre-radiotherapy context…</Typography>}
        {contextError && !contextLoading && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mb: 3 }) }}>Could not load pre-radiotherapy context — {contextError}</Typography>}
        {context?.context && <PreRadiotherapyContextBlock rows={context.context} />}

        {record?.prescription && <PrescriptionBlock data={record.prescription} />}
        {record?.targets && <TargetsBlock targets={record.targets} />}

        {oarsLoading && <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 3, fontStyle: "italic" }) }}>Loading OAR constraints…</Typography>}
        {oarsError && !oarsLoading && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mb: 3 }) }}>Could not load OAR constraints — {oarsError}</Typography>}
        {oarRows.length > 0 && <OarsBlock oars={oarRows} />}

        {record && (record.setup || record.simulation) && <SetupBlock setup={record.setup} simulation={record.simulation} />}
        {record?.beams && <BeamsBlock beams={record.beams} />}
        {record?.workflow && <WorkflowBlock steps={record.workflow} />}
        {record?.delivery && <DeliveryBlock data={record.delivery} />}
        {record?.approvals && <ApprovalsBlock data={record.approvals} />}
        {record?.adaptive && <AdaptiveBlock data={record.adaptive} />}
        {record?.adverseEvents && <AdverseEventsBlock events={record.adverseEvents} />}
        {record?.followUp && <FollowUpBlock data={record.followUp} />}
      </Box>
    </motion.div>
  );
}