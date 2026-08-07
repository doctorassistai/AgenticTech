import React, { useEffect, useState, useCallback } from "react";

/* =====================================================================
   LongitudinalSummaryTab
   ---------------------------------------------------------------------
   Fully data-driven oncology longitudinal case view.

   - Fetches the case-view JSON produced by the backend:
       GET {apiBaseUrl}/api/patients/{patientId}/case-view?doctor_id={doctorId}

   - DESIGN PRINCIPLE (v2 of this component): this tab shows the
     LONGITUDINAL story, not a per-visit record dump. Earlier versions
     rendered a full "Visit-by-Visit Record" block containing every raw
     field of every visit (consultation, vitals, orders, all documents,
     the AI visit_summary, etc). That has been removed.

     Instead, only the SLICES of visit data that feed a genuinely
     longitudinal/cross-visit section are pulled out and rendered —
     mirroring the static reference template's section set:
       - Clinical Snapshot        (patient_information + latest vitals)
       - Longitudinal Timeline    (longitudinal_summary.timeline)
       - Treatment Line History   (longitudinal_summary.treatment_history)
       - Response Metrics         (latest visit's visit_snapshot)
       - Toxicity / Adverse Events (visits[].adverse_events, all visits)
       - Imaging                  (visits[].uploaded_between_visits.imaging)
       - Pathology                (visits[].uploaded_between_visits.pathology)
       - Molecular / Tumor Markers (visits[].uploaded_between_visits.molecular / .tumor_markers)
       - Comparison / History     (longitudinal_summary.comparison / .history)
       - Longitudinal Overview, Disease Trajectory, Symptom Trends,
         Medication Timeline, Pending Items & Clinical Decisions

     Nothing here is hardcoded to a cancer type — every section only
     renders if the backend actually returned data for it.

   Usage:
     <LongitudinalSummaryTab
        patientId="PAT-542d5092-57e8-4a44-af68-6aebbff2d633"
        doctorId="DOC-dcf818e8-a3e0-427a-b935-98b6f602699c"
        apiBaseUrl="https://your-backend.example.com"   // optional, defaults to ""
     />
   ===================================================================== */

/* --------------------------- small helpers --------------------------- */

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

const isEmpty = (v) =>
  v === null ||
  v === undefined ||
  v === "" ||
  (Array.isArray(v) && v.length === 0) ||
  (isObj(v) && Object.keys(v).length === 0);

const fmtLabel = (key = "") =>
  String(key)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());

const fmtPrimitive = (v) => {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "boolean") return v ? "Yes" : "No";
  return String(v);
};

const fmtDate = (d) => {
  if (!d) return null;
  const dt = new Date(d);
  if (isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "2-digit" });
};

const fmtDuration = (start, end) => {
  if (!start) return null;
  const s = new Date(start);
  if (isNaN(s.getTime())) return null;
  const e = end ? new Date(end) : new Date();
  if (isNaN(e.getTime())) return null;
  const days = Math.round((e - s) / (1000 * 60 * 60 * 24));
  if (days < 0) return null;
  if (days === 0) return "Same day";
  if (days < 14) return `${days} day${days === 1 ? "" : "s"}`;
  if (days < 60) return `${(days / 7).toFixed(1)} weeks`;
  return `${(days / 30.44).toFixed(1)} months`;
};

const trendClass = (trend) => {
  if (!trend) return "";
  const t = String(trend).toLowerCase();
  if (t.includes("improv")) return "delta-down";
  if (t.includes("worsen")) return "delta-up";
  return "";
};

const importanceClass = (importance) => {
  const i = (importance || "").toLowerCase();
  if (i === "high") return "high";
  if (i === "medium") return "medium";
  return "low";
};

const sortByVisitNumber = (visits) =>
  (visits || []).slice().sort((a, b) => (a.visit_number || 0) - (b.visit_number || 0));

/* ---------------------------- primitives ---------------------------- */

function Field({ label, value, big, pos, muted }) {
  const display = fmtPrimitive(value);
  if (display === null) return null;
  const cls = ["fvalue", big ? "big" : "", pos ? "pos" : "", muted ? "muted" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="field">
      <div className="flabel">{label}</div>
      <div className={cls}>{display}</div>
    </div>
  );
}

function FieldGrid({ fields, columns = 4 }) {
  const visible = (fields || []).filter((f) => !isEmpty(f.value));
  if (visible.length === 0) return null;
  const cls = columns === 3 ? "fgrid c3" : columns === 2 ? "fgrid c2" : "fgrid";
  return (
    <div className={cls}>
      {visible.map((f, i) => (
        <Field key={f.label + i} {...f} />
      ))}
    </div>
  );
}

function Section({ id, title, meta, dashed, children }) {
  return (
    <div className="section" id={id}>
      <div className={dashed ? "section-head dashed" : "section-head"}>
        <div className="section-title">{title}</div>
        {meta ? <div className="section-meta">{meta}</div> : null}
      </div>
      <div className="section-body">{children}</div>
    </div>
  );
}

function CompWrap({ id, title, sub, children }) {
  return (
    <div className="comp-wrap" id={id}>
      <div className="comp-head">
        <div className="comp-title">{title}</div>
        {sub ? <div className="comp-sub">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Narrative({ label, text }) {
  if (isEmpty(text)) return null;
  return (
    <>
      {label ? <div className="narrative-label">{label}</div> : null}
      <div className="narrative">{text}</div>
    </>
  );
}

function AlertList({ items }) {
  if (isEmpty(items)) return null;
  return (
    <ul className="alert-list">
      {items.map((a, i) => {
        const priority = (a.priority || "").toLowerCase();
        return (
          <li key={i} className={priority === "high" ? "high" : ""}>
            {a.title}
            {priority ? <span className="section-meta"> — {fmtLabel(priority)} priority</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

/* -------- generic recursive renderer for disease-agnostic data -------
   Used to render one visit's slice of raw extracted data (e.g. its
   imaging findings, its pathology report, its adverse event record)
   without assuming any fixed shape.                                  */

function DataTree({ data, level = 0 }) {
  if (isEmpty(data)) return null;

  if (Array.isArray(data)) {
    const allPrimitive = data.every((x) => !isObj(x) && !Array.isArray(x));
    if (allPrimitive) {
      return <div className="narrative">{data.map((x) => fmtPrimitive(x)).filter(Boolean).join(", ")}</div>;
    }
    return (
      <div className="tree-array">
        {data.map((item, idx) => (
          <div className="tree-array-item" key={idx}>
            {isObj(item) || Array.isArray(item) ? (
              <DataTree data={item} level={level + 1} />
            ) : (
              <div className="narrative">{fmtPrimitive(item)}</div>
            )}
          </div>
        ))}
      </div>
    );
  }

  if (isObj(data)) {
    const entries = Object.entries(data).filter(([, v]) => !isEmpty(v));
    if (entries.length === 0) return null;
    const primitiveEntries = entries.filter(([, v]) => !isObj(v) && !Array.isArray(v));
    const nestedEntries = entries.filter(([, v]) => isObj(v) || Array.isArray(v));
    return (
      <div className="tree-node">
        {primitiveEntries.length > 0 && (
          <FieldGrid columns={3} fields={primitiveEntries.map(([k, v]) => ({ label: fmtLabel(k), value: v }))} />
        )}
        {nestedEntries.map(([k, v]) => (
          <div className="tree-sub" key={k}>
            <div className="narrative-label" style={{ marginTop: primitiveEntries.length > 0 ? 16 : 0 }}>
              {fmtLabel(k)}
            </div>
            <DataTree data={v} level={level + 1} />
          </div>
        ))}
      </div>
    );
  }

  return <div className="narrative">{fmtPrimitive(data)}</div>;
}

/* ------------------------------ tables ------------------------------ */

function GenericTable({ columns, rows, rowKey }) {
  if (isEmpty(rows)) return null;
  return (
    <div className="tablewrap">
      <table className="comp">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={rowKey ? rowKey(row, i) : i}>
              {columns.map((c) => (
                <td key={c.key} className={c.strong ? "strong" : ""}>
                  {c.render ? c.render(row) : fmtPrimitive(row[c.key]) ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------- rail -------------------------------- */

function TimelineRail({ events }) {
  if (isEmpty(events)) return null;
  return (
    <div className="rail-wrap" id="timeline">
      <div className="rail-head">
        <div className="rail-title">Longitudinal Clinical Timeline</div>
        <div className="section-meta">{events.length} timepoints</div>
      </div>
      <div className="rail-body">
        <div className="rail-line"></div>
        {events.map((e, i) => (
          <div
            key={i}
            className={
              "rail-point" +
              (i === 0 ? " baseline" : "") +
              (i === events.length - 1 ? " current" : "") +
              (importanceClass(e.importance) === "high" ? " event" : "")
            }
          >
            <div className="rail-date">{fmtDate(e.date) || "—"}</div>
            <div className="rail-dot"></div>
            <div className="rail-label">{e.title}</div>
            {e.description ? <div className="rail-stat">{e.description}</div> : null}
            {e.visit_number ? <span className="rail-flag">Visit {e.visit_number}</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------- metrics blocks --------------------------- */

const SNAPSHOT_SECTIONS = [
  ["disease_metrics", "Disease Metrics"],
  ["imaging_metrics", "Imaging Metrics"],
  ["laboratory_metrics", "Laboratory Metrics"],
  ["performance_metrics", "Performance Metrics"],
  ["treatment_metrics", "Treatment Metrics"],
  ["symptom_metrics", "Symptom Metrics"],
  ["toxicity_metrics", "Toxicity Metrics"],
  ["quality_of_life_metrics", "Quality of Life Metrics"],
];

function metricValue(entry) {
  return isObj(entry) ? entry.value : entry;
}
function metricUnit(entry) {
  return isObj(entry) ? entry.unit : null;
}

function MetricsRow({ title, metrics, trendMap, sectionKey }) {
  const names = Object.keys(metrics || {});
  if (names.length === 0) return null;
  return (
    <div className="section" style={{ marginBottom: 18 }}>
      <div className="section-head">
        <div className="section-title">{title}</div>
      </div>
      <div className="section-body" style={{ padding: 0 }}>
        <div className="metrics-row" style={{ border: "none", flexWrap: "wrap" }}>
          {names.map((name) => {
            const entry = metrics[name];
            const val = metricValue(entry);
            const unit = metricUnit(entry);
            const trendInfo = trendMap ? trendMap[`${sectionKey}.${name}`] : null;
            return (
              <div className="metric" key={name}>
                <div className="flabel">{name}</div>
                <div className="fvalue">
                  {fmtPrimitive(val)}
                  {unit ? ` ${unit}` : ""}
                </div>
                {trendInfo && trendInfo.trend ? (
                  <div className={"section-meta " + trendClass(trendInfo.trend)}>
                    {trendInfo.trend}
                    {trendInfo.percentage_change !== undefined && trendInfo.percentage_change !== null
                      ? ` (${trendInfo.percentage_change > 0 ? "+" : ""}${trendInfo.percentage_change}%)`
                      : ""}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function buildTrendMap(metricChanges) {
  const map = {};
  if (!metricChanges) return map;
  Object.entries(metricChanges).forEach(([section, rows]) => {
    (rows || []).forEach((r) => {
      map[`${section}.${r.name}`] = r;
    });
  });
  return map;
}

function MetricChangesTable({ title, sub, rows }) {
  if (isEmpty(rows)) return null;
  return (
    <CompWrap title={title} sub={sub}>
      <div className="tablewrap">
        <table className="comp">
          <thead>
            <tr>
              <th>Metric</th>
              <th>Unit</th>
              <th>Previous</th>
              <th>Current</th>
              <th>Change</th>
              <th>% Change</th>
              <th>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className="strong">{r.name}</td>
                <td>{r.unit || "—"}</td>
                <td>{fmtPrimitive(r.previous) ?? "—"}</td>
                <td>
                  {fmtPrimitive(r.current) ?? "—"}
                  {r.unit_mismatch ? (
                    <span className="section-meta"> (unit mismatch: {r.previous_unit} vs {r.current_unit})</span>
                  ) : null}
                  {r.normalized_current !== undefined && r.normalized_current !== null ? (
                    <span className="section-meta"> ≈ {r.normalized_current} {r.normalized_unit}</span>
                  ) : null}
                </td>
                <td>{fmtPrimitive(r.change) ?? "—"}</td>
                <td>
                  {r.percentage_change !== undefined && r.percentage_change !== null
                    ? `${r.percentage_change > 0 ? "+" : ""}${r.percentage_change}%`
                    : "—"}
                </td>
                <td className={trendClass(r.trend)}>{r.trend || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </CompWrap>
  );
}

/* =====================================================================
   CURATED CROSS-VISIT SECTIONS
   ---------------------------------------------------------------------
   These replace the old "Visit-by-Visit Record" full-visit dump. Each
   one pulls ONE specific slice out of every visit (never the whole
   visit object) and stacks it as a dated card/table entry — the same
   idea as the static template's per-document Radiology / Histopathology
   / IHC / Molecular cards, but driven entirely by whatever the backend
   actually populated (nothing hardcoded to a cancer type).
   ===================================================================== */

/** One dated card per visit that has data for a given raw category
 * (e.g. uploaded_between_visits.imaging / .pathology). */
function VisitDataCards({ entries }) {
  if (isEmpty(entries)) return null;
  return (
    <>
      {entries.map((e, i) => (
        <div key={i} style={{ padding: "16px 20px", borderBottom: "1px solid var(--hair)" }}>
          <div className="fvalue pos" style={{ marginBottom: 10 }}>
            Visit {e.visit_number}
            {e.date ? ` — ${fmtDate(e.date)}` : ""}
          </div>
          <DataTree data={e.data} />
        </div>
      ))}
    </>
  );
}

function ImagingSection({ entries }) {
  if (isEmpty(entries)) return null;
  return (
    <CompWrap id="imaging" title="Imaging" sub="Radiology findings extracted from each visit's imaging documents">
      <VisitDataCards entries={entries} />
    </CompWrap>
  );
}

function PathologySection({ entries }) {
  if (isEmpty(entries)) return null;
  return (
    <CompWrap
      id="pathology"
      title="Pathology"
      sub="Histopathology, cytopathology and IHC findings extracted from each visit's pathology documents"
    >
      <VisitDataCards entries={entries} />
    </CompWrap>
  );
}

function MolecularSection({ entries }) {
  if (isEmpty(entries)) return null;
  return (
    <CompWrap
      id="molecular"
      title="Molecular &amp; Tumor Markers"
      sub="Genomic testing and serum tumor marker results extracted from each visit"
    >
      {entries.map((e, i) => (
        <div key={i} style={{ padding: "16px 20px", borderBottom: "1px solid var(--hair)" }}>
          <div className="fvalue pos" style={{ marginBottom: 10 }}>
            Visit {e.visit_number}
            {e.date ? ` — ${fmtDate(e.date)}` : ""}
          </div>
          {!isEmpty(e.molecular) && (
            <>
              <div className="narrative-label">Molecular</div>
              <DataTree data={e.molecular} />
            </>
          )}
          {!isEmpty(e.tumor_markers) && (
            <>
              <div className="narrative-label" style={{ marginTop: isEmpty(e.molecular) ? 0 : 14 }}>
                Tumor Markers
              </div>
              <DataTree data={e.tumor_markers} />
            </>
          )}
        </div>
      ))}
    </CompWrap>
  );
}

/** Toxicity / adverse events, gathered across every visit. Adverse
 * event objects are freeform (whatever the extraction agent found), so
 * each is rendered as a dated card rather than forced into fixed
 * columns — but common fields (grade/attribution/action/outcome, under
 * whatever key name the LLM used) will naturally surface via DataTree. */
function ToxicitySection({ entries }) {
  if (isEmpty(entries)) return null;
  return (
    <CompWrap
      id="toxicity"
      title="Toxicity &amp; Adverse Event Assessment"
      sub="Every adverse event recorded, in the visit it was reported"
    >
      {entries.map((e, i) => (
        <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid var(--hair)" }}>
          <div className="fvalue pos" style={{ marginBottom: 8 }}>
            Visit {e.visit_number}
            {e.date ? ` — ${fmtDate(e.date)}` : ""}
          </div>
          <DataTree data={e.data} />
        </div>
      ))}
    </CompWrap>
  );
}

/* ============================== main component ============================= */

export default function LongitudinalSummaryTab({
  patientId,
  doctorId: doctorIdProp,
  apiBaseUrl = "https://doctorassist.ai/api/",
  endpoint,
  trigger,
}) {
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchCaseView = useCallback(
    async (signal) => {
      if (!patientId) {
        setLoading(false);
        setError("Missing patientId prop.");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const url =
          endpoint ||
          `${apiBaseUrl}hms/users/ai-legacy/api/patients/${encodeURIComponent(patientId)}/case-view`;
        const res = await fetch(url, { signal });
        if (!res.ok) {
          throw new Error(`Failed to load case view (HTTP ${res.status})`);
        }
        const json = await res.json();
        console.log("case: ",json);
        setRecord(json);
      } catch (e) {
        if (e.name !== "AbortError") setError(e.message || "Failed to load case view");
      } finally {
        setLoading(false);
      }
    },
    [patientId, doctorIdProp, apiBaseUrl, endpoint]
  );

  useEffect(() => {
    const controller = new AbortController();
    fetchCaseView(controller.signal);
    return () => controller.abort();
  }, [fetchCaseView, trigger]);

  const data = record?.data;
  const patientInformation = data?.patient_information || {};
  const visits = sortByVisitNumber(data?.visits || []);
  const longitudinalSummary = data?.longitudinal_summary || {};
  const latestVisit = visits.length ? visits[visits.length - 1] : null;

  const dashboard = longitudinalSummary.dashboard;
  const diseaseStatus =
    latestVisit?.disease_status || longitudinalSummary.longitudinal_overview?.latest_status;
  const comparison = longitudinalSummary.comparison;
  const trendMap = buildTrendMap(comparison?.metric_changes);
  const activeAlerts = longitudinalSummary.active_alerts?.length
    ? longitudinalSummary.active_alerts
    : dashboard?.alerts;

  /* ---- curated cross-visit slices (NOT full visit dumps) ---- */
  const toxicityEntries = [];
  const imagingEntries = [];
  const pathologyEntries = [];
  const molecularEntries = [];

  visits.forEach((v) => {
    const visit_number = v.visit_number;
    const date = v.appointment?.appointment_date;
    const upl = v.uploaded_between_visits || {};

    (v.adverse_events || []).forEach((ae) => {
      toxicityEntries.push({ visit_number, date, data: ae });
    });

    if (!isEmpty(upl.imaging)) {
      imagingEntries.push({ visit_number, date, data: upl.imaging });
    }
    if (!isEmpty(upl.pathology)) {
      pathologyEntries.push({ visit_number, date, data: upl.pathology });
    }
    if (!isEmpty(upl.molecular) || !isEmpty(upl.tumor_markers)) {
      molecularEntries.push({
        visit_number,
        date,
        molecular: upl.molecular,
        tumor_markers: upl.tumor_markers,
      });
    }
  });

  const sectionsPresent = {
    snapshot: !isEmpty(activeAlerts) || latestVisit,
    timeline: !isEmpty(longitudinalSummary.timeline),
    lines: !isEmpty(longitudinalSummary.treatment_history),
    response:
      latestVisit &&
      SNAPSHOT_SECTIONS.some(([key]) => !isEmpty(latestVisit.visit_snapshot?.[key])),
    toxicity: toxicityEntries.length > 0,
    imaging: imagingEntries.length > 0,
    pathology: pathologyEntries.length > 0,
    molecular: molecularEntries.length > 0,
    comparison: !isEmpty(comparison?.metric_changes) || !isEmpty(comparison?.overall_ai_assessment),
    history: !isEmpty(longitudinalSummary.history),
    overview: !isEmpty(longitudinalSummary.longitudinal_overview),
    trajectory: !isEmpty(longitudinalSummary.disease_trajectory),
    symptomTrends: !isEmpty(longitudinalSummary.symptom_trends),
    medTimeline: !isEmpty(longitudinalSummary.medication_timeline),
    decisionsLog: !isEmpty(longitudinalSummary.clinical_decisions_log),
    pending: !isEmpty(longitudinalSummary.pending_items),
  };

  return (
    <div className="lst-root">
      <style>{CSS_STYLES}</style>

      <div className="topbar">
        <div className="brand">
          doctor<span>assist</span> / oncology case view
        </div>
        <div className="crumb">
          home / patient profile /{" "}
          <b>{patientInformation.name || patientId || "longitudinal summary"}</b>
        </div>
      </div>

      <div className="subnav">
        {sectionsPresent.snapshot && <a href="#snapshot" data-jump="snapshot">Snapshot</a>}
        {sectionsPresent.timeline && <a href="#timeline" data-jump="timeline">Timeline</a>}
        {sectionsPresent.lines && <a href="#lines" data-jump="lines">Treatment Lines</a>}
        {sectionsPresent.response && <a href="#response" data-jump="response">Response Metrics</a>}
        {sectionsPresent.toxicity && <a href="#toxicity" data-jump="toxicity">Toxicity / AE</a>}
        {sectionsPresent.imaging && <a href="#imaging" data-jump="imaging">Imaging</a>}
        {sectionsPresent.pathology && <a href="#pathology" data-jump="pathology">Pathology</a>}
        {sectionsPresent.molecular && <a href="#molecular" data-jump="molecular">Molecular</a>}
        {sectionsPresent.comparison && <a href="#comparison" data-jump="comparison">Comparison</a>}
        {sectionsPresent.overview && <a href="#overview" data-jump="overview">Longitudinal Overview</a>}
        {sectionsPresent.pending && <a href="#pending" data-jump="pending">Pending &amp; Decisions</a>}
      </div>

      <div className="wrap">
        {loading && <div className="empty-note">Loading case view…</div>}
        {error && (
          <div className="error-box">
            Could not load the case view: {error}.{" "}
            <a href="#" onClick={(e) => { e.preventDefault(); fetchCaseView(); }}>
              Retry
            </a>
          </div>
        )}

        {!loading && !error && !data && (
          <div className="empty-note">No case view data is available yet for this patient.</div>
        )}

        {!loading && !error && data && (
          <>
            {/* ---------------- Case header ---------------- */}
            <div className="case-head">
              <div>
                <div className="ch-label">Diagnosis</div>
                <div className="ch-value strong">{latestVisit?.consultation?.diagnosis || "—"}</div>
                {diseaseStatus?.current_stage && <span className="tag dark">{diseaseStatus.current_stage}</span>}
              </div>
              <div>
                <div className="ch-label">Current Treatment</div>
                <div className="ch-value">
                  {(dashboard?.current_treatment && dashboard.current_treatment.length
                    ? dashboard.current_treatment
                    : Object.keys(latestVisit?.treatment || {})
                  )
                    .map(fmtLabel)
                    .join(", ") || "—"}
                </div>
              </div>
              <div>
                <div className="ch-label">Status</div>
                <div className="ch-value">
                  {dashboard?.current_status || diseaseStatus?.disease_state || "—"}
                </div>
              </div>
              <div>
                <div className="ch-label">Response / Direction</div>
                <div className="ch-value strong">
                  {[dashboard?.response || diseaseStatus?.clinical_response, dashboard?.overall_direction || diseaseStatus?.overall_direction]
                    .filter(Boolean)
                    .join(" / ") || "—"}
                </div>
              </div>
            </div>

            {/* ---------------- Snapshot ---------------- */}
            {sectionsPresent.snapshot && (
              <div className="snapshot" id="snapshot">
                <div className="snapshot-head">
                  <div className="section-title">Clinical Snapshot — What The Consulting Doctor Needs To Know</div>
                  <span className="section-meta" style={{ color: "#ccc" }}>
                    {fmtDate(dashboard?.last_updated || latestVisit?.appointment?.appointment_date) || ""}
                  </span>
                </div>
                <div className="snapshot-body">
                  <div>
                    <div className="narrative-label">Key Alerts</div>
                    {!isEmpty(activeAlerts) ? (
                      <AlertList items={activeAlerts} />
                    ) : (
                      <div className="fvalue muted">No active alerts.</div>
                    )}
                    {!isEmpty(dashboard?.next_action) && (
                      <>
                        <div className="narrative-label" style={{ marginTop: 14 }}>
                          Next Action
                        </div>
                        <div className="narrative">{dashboard.next_action}</div>
                      </>
                    )}
                  </div>
                  <div>
                    <div className="narrative-label">Patient Snapshot</div>
                    <div className="snap-grid">
                      <FieldGrid
                        columns={2}
                        fields={[
                          { label: "Name", value: patientInformation.name },
                          { label: "Date of Birth", value: patientInformation.date_of_birth },
                          { label: "Gender", value: patientInformation.gender },
                          { label: "Phone", value: patientInformation.phone_number },
                          { label: "Blood Group", value: patientInformation.blood_group },
                          { label: "Marital Status", value: patientInformation.marital_status },
                          { label: "Address", value: patientInformation.address },
                          { label: "Occupation", value: patientInformation.occupation },
                          { label: "Hospital ID", value: patientInformation.hospital_id },
                          { label: "HMS ID", value: patientInformation.hms_id },
                        ]}
                      />
                    </div>
                    {!isEmpty(latestVisit?.vitals) && (
                      <>
                        <div className="narrative-label" style={{ marginTop: 14 }}>
                          Latest Vitals
                        </div>
                        <DataTree data={latestVisit.vitals} />
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* ---------------- Timeline ---------------- */}
            <TimelineRail events={longitudinalSummary.timeline} />

            {/* ---------------- Treatment line history ---------------- */}
            {sectionsPresent.lines && (
              <CompWrap
                id="lines"
                title="Treatment Line History"
                sub="Every regimen with its clinical duration and reason for change"
              >
                <GenericTable
                  columns={[
                    { key: "line", label: "Line", render: (r) => (r.line !== null && r.line !== undefined ? `Line ${r.line}` : "—"), strong: true },
                    { key: "regimen", label: "Regimen" },
                    { key: "intent", label: "Intent" },
                    { key: "start_date", label: "Start", render: (r) => fmtDate(r.start_date) },
                    { key: "end_date", label: "End", render: (r) => fmtDate(r.end_date) || "Ongoing" },
                    { key: "duration", label: "Duration", render: (r) => fmtDuration(r.start_date, r.end_date) || "—" },
                    { key: "cycles_completed", label: "Cycles" },
                    { key: "status", label: "Status" },
                    { key: "reason_for_change", label: "Reason for Change" },
                  ]}
                  rows={longitudinalSummary.treatment_history}
                />
              </CompWrap>
            )}

            {/* ---------------- Response / disease metrics (latest visit) ---------------- */}
            {sectionsPresent.response && (
              <div id="response">
                {SNAPSHOT_SECTIONS.map(([key, label]) =>
                  isEmpty(latestVisit.visit_snapshot?.[key]) ? null : (
                    <MetricsRow
                      key={key}
                      title={label}
                      metrics={latestVisit.visit_snapshot[key]}
                      trendMap={trendMap}
                      sectionKey={key}
                    />
                  )
                )}
              </div>
            )}

            {/* ---------------- Toxicity / Adverse Events (cross-visit) ---------------- */}
            <ToxicitySection entries={toxicityEntries} />

            {/* ---------------- Imaging (cross-visit) ---------------- */}
            <ImagingSection entries={imagingEntries} />

            {/* ---------------- Pathology (cross-visit) ---------------- */}
            <PathologySection entries={pathologyEntries} />

            {/* ---------------- Molecular & Tumor Markers (cross-visit) ---------------- */}
            <MolecularSection entries={molecularEntries} />

            {/* ---------------- Comparison ---------------- */}
            {sectionsPresent.comparison && (
              <div id="comparison">
                {!isEmpty(comparison?.overall_ai_assessment) && (
                  <Section title="AI Longitudinal Assessment" meta={`Latest completed visit: ${longitudinalSummary.latest_completed_visit ?? "—"}`}>
                    <Narrative text={comparison.overall_ai_assessment} />
                    <FieldGrid
                      columns={3}
                      fields={[
                        { label: "Alive", value: comparison?.survival?.alive },
                        { label: "Treatment Changed", value: comparison?.treatment_modifications?.changed },
                        {
                          label: "New Adverse Events",
                          value: comparison?.safety?.new_adverse_events?.length
                            ? `${comparison.safety.new_adverse_events.length} new`
                            : "None",
                        },
                      ]}
                    />
                  </Section>
                )}

                <MetricChangesTable
                  title="Disease Metrics — Visit-over-Visit Change"
                  rows={comparison?.metric_changes?.disease_metrics}
                />
                <MetricChangesTable
                  title="Imaging Metrics — Visit-over-Visit Change"
                  rows={comparison?.metric_changes?.imaging_metrics}
                />
                <MetricChangesTable
                  title="Laboratory Metrics — Visit-over-Visit Change"
                  rows={comparison?.metric_changes?.laboratory_metrics}
                />
                <MetricChangesTable
                  title="Performance Metrics — Visit-over-Visit Change"
                  rows={comparison?.metric_changes?.performance_metrics}
                />

                {sectionsPresent.history && (
                  <CompWrap title="Comparison History" sub="Every consecutive visit-to-visit comparison on record">
                    {longitudinalSummary.history.map((h, i) => (
                      <div key={i} style={{ padding: "16px 20px", borderBottom: "1px solid var(--hair)" }}>
                        <div className="fvalue pos" style={{ marginBottom: 10 }}>
                          Visit {h.previous_visit} → Visit {h.current_visit}
                        </div>
                        {!isEmpty(h.comparison?.overall_ai_assessment) && (
                          <Narrative text={h.comparison.overall_ai_assessment} />
                        )}
                        {["disease_metrics", "imaging_metrics", "laboratory_metrics", "performance_metrics"].map(
                          (sec) =>
                            isEmpty(h.comparison?.metric_changes?.[sec]) ? null : (
                              <div key={sec} style={{ marginTop: 12 }}>
                                <div className="narrative-label">{fmtLabel(sec)}</div>
                                <GenericTable
                                  columns={[
                                    { key: "name", label: "Metric", strong: true },
                                    { key: "previous", label: "Previous" },
                                    { key: "current", label: "Current" },
                                    { key: "trend", label: "Trend" },
                                  ]}
                                  rows={h.comparison.metric_changes[sec]}
                                />
                              </div>
                            )
                        )}
                      </div>
                    ))}
                  </CompWrap>
                )}
              </div>
            )}

            {/* ---------------- Longitudinal overview ---------------- */}
            {sectionsPresent.overview && (
              <Section id="overview" title="Longitudinal Overview" meta="Baseline vs. latest completed visit, across the whole history">
                <FieldGrid
                  columns={4}
                  fields={[
                    { label: "Baseline Visit", value: longitudinalSummary.longitudinal_overview.baseline_visit },
                    { label: "Current Visit", value: longitudinalSummary.longitudinal_overview.current_visit },
                    {
                      label: "Best Response",
                      value: longitudinalSummary.longitudinal_overview.best_response?.clinical_response,
                    },
                    {
                      label: "Latest Trajectory",
                      value: longitudinalSummary.longitudinal_overview.latest_status?.overall_direction,
                    },
                  ]}
                />

                {!isEmpty(longitudinalSummary.longitudinal_overview.best_metric_improvements) && (
                  <>
                    <div className="narrative-label" style={{ marginTop: 16 }}>
                      Best Metric Improvements (vs. Baseline)
                    </div>
                    <GenericTable
                      columns={[
                        { key: "section", label: "Section", render: (r) => fmtLabel(r.section) },
                        { key: "name", label: "Metric", strong: true },
                        { key: "baseline", label: "Baseline" },
                        { key: "best_value", label: "Best Value" },
                        {
                          key: "percentage_change",
                          label: "% Change",
                          render: (r) => `${r.percentage_change > 0 ? "+" : ""}${r.percentage_change}%`,
                        },
                        { key: "visit_number", label: "Visit #" },
                      ]}
                      rows={longitudinalSummary.longitudinal_overview.best_metric_improvements}
                    />
                  </>
                )}

                {!isEmpty(longitudinalSummary.longitudinal_overview.toxicities_seen) && (
                  <>
                    <div className="narrative-label" style={{ marginTop: 16 }}>
                      All Toxicities Seen
                    </div>
                    <DataTree data={longitudinalSummary.longitudinal_overview.toxicities_seen} />
                  </>
                )}
              </Section>
            )}

            {/* ---------------- Disease trajectory ---------------- */}
            {sectionsPresent.trajectory && (
              <CompWrap title="Disease Trajectory" sub="Disease status as recorded at each visit">
                <GenericTable
                  columns={[
                    { key: "visit_number", label: "Visit #", strong: true },
                    { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
                    { key: "current_stage", label: "Stage" },
                    { key: "disease_state", label: "Disease State" },
                    { key: "clinical_response", label: "Clinical Response" },
                    { key: "overall_direction", label: "Direction" },
                  ]}
                  rows={longitudinalSummary.disease_trajectory}
                />
              </CompWrap>
            )}

            {/* ---------------- Symptom trends ---------------- */}
            {sectionsPresent.symptomTrends && (
              <CompWrap title="Symptom Trends" sub="Severity tracked across visits">
                {longitudinalSummary.symptom_trends.map((s, i) => (
                  <div key={i} style={{ padding: "14px 20px", borderBottom: "1px solid var(--hair)" }}>
                    <div className="fvalue pos" style={{ marginBottom: 8 }}>
                      {s.name} {s.overall_trend ? `— ${s.overall_trend}` : ""}
                    </div>
                    <GenericTable
                      columns={[
                        { key: "visit_number", label: "Visit #" },
                        { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
                        { key: "severity", label: "Severity" },
                        { key: "trend", label: "Trend" },
                      ]}
                      rows={s.history}
                    />
                  </div>
                ))}
              </CompWrap>
            )}

            {/* ---------------- Medication timeline ---------------- */}
            {sectionsPresent.medTimeline && (
              <CompWrap title="Medication Timeline" sub="Every drug tracked from start to stop across visits">
                <GenericTable
                  columns={[
                    { key: "drug", label: "Drug", strong: true },
                    { key: "status", label: "Status" },
                    { key: "started", label: "Started", render: (r) => fmtDate(r.started) },
                    { key: "stopped", label: "Stopped", render: (r) => fmtDate(r.stopped) },
                    {
                      key: "dose_changes",
                      label: "Dose Changes",
                      render: (r) => (r.dose_changes || []).length || "—",
                    },
                    { key: "reason_for_stop", label: "Reason for Stop" },
                  ]}
                  rows={longitudinalSummary.medication_timeline}
                />
              </CompWrap>
            )}

            {/* ---------------- Pending items & decisions log ---------------- */}
            {sectionsPresent.pending && (
              <Section id="pending" title="Pending Items &amp; Clinical Decisions">
                {!isEmpty(longitudinalSummary.pending_items) && (
                  <>
                    <div className="narrative-label">Outstanding Pending Items</div>
                    <ul className="alert-list">
                      {longitudinalSummary.pending_items.map((p, i) => (
                        <li key={i}>{p}</li>
                      ))}
                    </ul>
                  </>
                )}
                {sectionsPresent.decisionsLog && (
                  <>
                    <div className="narrative-label" style={{ marginTop: 16 }}>
                      Clinical Decisions Log
                    </div>
                    <GenericTable
                      columns={[
                        { key: "visit_number", label: "Visit #" },
                        { key: "date", label: "Date", render: (r) => fmtDate(r.date) },
                        { key: "decision", label: "Decision", strong: true },
                        { key: "reason", label: "Reason" },
                        { key: "decided_by", label: "Decided By" },
                      ]}
                      rows={longitudinalSummary.clinical_decisions_log}
                    />
                  </>
                )}
              </Section>
            )}

            <div className="footnote">
              Generated {fmtDate(record?.generated_at) || "—"} · Patient {patientInformation.patient_id || patientId}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/* ================================ CSS ================================ */
/* Theme/design unchanged from the original static template. */

const CSS_STYLES = `
@import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@200;300;400;600;700&display=swap');

.lst-root{
  --ink:#000000;
  --paper:#ffffff;
  --line:#1a1a1a;
  --hair:#e2e2e2;
  --mute:#6f6f6f;
  --faint:#a8a8a8;
  --panel:#fbfbfb;
  --panel-2:#f4f4f4;
  --panel-3:#eeeeee;
  font-family:'Open Sans', sans-serif;font-weight:300;background:var(--paper);color:var(--ink);
  -webkit-font-smoothing:antialiased;letter-spacing:.01em;
}
.lst-root *{box-sizing:border-box;}

.lst-root .topbar{display:flex;align-items:center;justify-content:space-between;padding:22px 40px;border-bottom:1px solid var(--ink);}
.lst-root .brand{font-weight:200;font-size:20px;letter-spacing:.14em;text-transform:uppercase;}
.lst-root .brand span{font-weight:700;}
.lst-root .crumb{font-size:11px;color:var(--mute);letter-spacing:.08em;text-transform:uppercase;}
.lst-root .crumb b{color:var(--ink);font-weight:400;}

.lst-root .subnav{display:flex;flex-wrap:wrap;gap:0;border-bottom:1px solid var(--ink);position:sticky;top:0;background:#fff;z-index:5;}
.lst-root .subnav a{font-size:9.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);text-decoration:none;padding:10px 14px;border-right:1px solid var(--hair);white-space:nowrap;}
.lst-root .subnav a:hover{color:var(--ink);background:var(--panel-2);}

.lst-root .wrap{max-width:1500px;margin:0 auto;padding:24px 40px 90px;}

.lst-root .case-head{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:0;border:1px solid var(--ink);margin:20px 0 18px;}
.lst-root .case-head > div{padding:18px 22px;border-right:1px solid var(--hair);}
.lst-root .case-head > div:last-child{border-right:none;}
.lst-root .ch-label{font-size:9px;letter-spacing:.18em;text-transform:uppercase;color:var(--mute);margin-bottom:6px;}
.lst-root .ch-value{font-size:16px;font-weight:200;}
.lst-root .ch-value.strong{font-weight:700;}
.lst-root .tag{display:inline-block;font-size:9px;letter-spacing:.1em;text-transform:uppercase;border:1px solid var(--ink);padding:3px 8px;margin-top:4px;}
.lst-root .tag.dark{background:var(--ink);color:#fff;}

.lst-root .snapshot{border:1px solid var(--ink);margin-bottom:18px;}
.lst-root .snapshot-head{padding:13px 20px;border-bottom:1px solid var(--ink);background:var(--ink);color:#fff;display:flex;justify-content:space-between;align-items:center;}
.lst-root .snapshot-head .section-title{color:#fff;}
.lst-root .snapshot-body{display:grid;grid-template-columns:1.2fr 1fr;gap:0;}
.lst-root .snapshot-body > div{padding:18px 22px;}
.lst-root .snapshot-body > div:first-child{border-right:1px solid var(--hair);}
.lst-root .alert-list{list-style:none;}
.lst-root .alert-list li{font-size:12.5px;line-height:1.9;padding-left:16px;position:relative;font-weight:400;}
.lst-root .alert-list li::before{content:"▲";position:absolute;left:0;font-size:8px;top:6px;}
.lst-root .alert-list li.high::before{content:"■";font-size:7px;top:6px;}
.lst-root .snap-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:14px 20px;}

.lst-root .section{border:1px solid var(--hair);margin-bottom:22px;background:var(--paper);scroll-margin-top:44px;}
.lst-root .section-head{display:flex;align-items:center;justify-content:space-between;padding:13px 20px;border-bottom:1px solid var(--hair);border-left:3px solid var(--ink);flex-wrap:wrap;gap:6px;}
.lst-root .section-head.dashed{border-left:3px dashed var(--faint);}
.lst-root .section-title{font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;}
.lst-root .section-meta{font-size:10px;color:var(--mute);letter-spacing:.05em;}
.lst-root .section-body{padding:20px;}

.lst-root .fgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:18px 24px;}
.lst-root .fgrid.c3{grid-template-columns:repeat(3,1fr);}
.lst-root .fgrid.c2{grid-template-columns:repeat(2,1fr);}
.lst-root .field{border-bottom:1px solid var(--hair);padding-bottom:10px;}
.lst-root .flabel{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);margin-bottom:6px;}
.lst-root .fvalue{font-size:14px;font-weight:400;}
.lst-root .fvalue.big{font-size:22px;font-weight:200;}
.lst-root .fvalue.muted{color:var(--faint);font-style:italic;font-weight:300;}
.lst-root .fvalue.pos{font-weight:700;}

.lst-root .narrative{font-size:13px;line-height:1.7;color:#1c1c1c;font-weight:300;}
.lst-root .narrative + .narrative{margin-top:10px;}
.lst-root .narrative-label{font-size:9px;letter-spacing:.14em;text-transform:uppercase;color:var(--mute);margin-bottom:8px;}

.lst-root .duo{display:grid;grid-template-columns:1fr 1fr;gap:22px;}
@media(max-width:1000px){
  .lst-root .duo{grid-template-columns:1fr;}
  .lst-root .fgrid{grid-template-columns:repeat(2,1fr)!important;}
  .lst-root .snapshot-body{grid-template-columns:1fr!important;}
  .lst-root .case-head{grid-template-columns:1fr!important;}
}

.lst-root .metrics-row{display:grid;grid-template-columns:repeat(6,1fr);border:1px solid var(--hair);}
.lst-root .metric{padding:16px 14px;border-right:1px solid var(--hair);}
.lst-root .metric:last-child{border-right:none;}
.lst-root .metric .flabel{margin-bottom:8px;}
.lst-root .metric .fvalue{font-size:17px;}

.lst-root .pill{display:inline-block;font-size:9px;letter-spacing:.1em;text-transform:uppercase;padding:3px 9px;border:1px solid var(--ink);}
.lst-root .pill.solid{background:var(--ink);color:#fff;}
.lst-root .pill.outline-mute{border-color:var(--faint);color:var(--mute);}

.lst-root .rail-wrap{border:1px solid var(--ink);margin-bottom:18px;}
.lst-root .rail-head{padding:14px 20px;border-bottom:1px solid var(--ink);display:flex;justify-content:space-between;align-items:center;}
.lst-root .rail-title{font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;}
.lst-root .rail-body{display:flex;overflow-x:auto;padding:26px 20px 10px;position:relative;}
.lst-root .rail-line{position:absolute;top:47px;left:20px;right:20px;height:1px;background:var(--ink);}
.lst-root .rail-point{min-width:200px;padding:0 18px;position:relative;flex:1;}
.lst-root .rail-dot{width:11px;height:11px;border-radius:50%;background:#fff;border:2px solid var(--ink);margin:0 auto 14px;position:relative;z-index:2;}
.lst-root .rail-point.current .rail-dot,.lst-root .rail-point.baseline .rail-dot{background:var(--ink);}
.lst-root .rail-point.event .rail-dot{background:#fff;border:2px solid var(--ink);box-shadow:0 0 0 3px #fff, 0 0 0 4px var(--ink);}
.lst-root .rail-date{text-align:center;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);margin-bottom:2px;}
.lst-root .rail-label{text-align:center;font-size:12px;font-weight:700;margin-bottom:8px;}
.lst-root .rail-stat{text-align:center;font-size:9px;color:var(--mute);letter-spacing:.06em;line-height:1.6;}
.lst-root .rail-flag{display:block;text-align:center;font-size:8.5px;color:var(--mute);letter-spacing:.05em;margin-top:4px;}
.lst-root .rail-resp{display:block;margin:8px auto 0;width:fit-content;font-size:9px;letter-spacing:.08em;text-transform:uppercase;padding:2px 8px;border:1px solid var(--ink);}
.lst-root .rail-resp.progress{background:var(--ink);color:#fff;}

.lst-root .comp-wrap{border:1px solid var(--ink);margin-bottom:24px;}
.lst-root .comp-head{padding:16px 20px;border-bottom:1px solid var(--ink);}
.lst-root .comp-title{font-size:11px;letter-spacing:.16em;text-transform:uppercase;font-weight:700;}
.lst-root .comp-sub{font-size:10px;color:var(--mute);margin-top:4px;letter-spacing:.04em;}
.lst-root table.comp{width:100%;border-collapse:collapse;font-size:12.5px;}
.lst-root table.comp th{text-align:left;font-size:9px;letter-spacing:.1em;text-transform:uppercase;color:var(--mute);font-weight:700;padding:12px 16px;border-bottom:1px solid var(--ink);white-space:nowrap;}
.lst-root table.comp td{padding:13px 16px;border-bottom:1px solid var(--hair);font-weight:300;white-space:nowrap;}
.lst-root table.comp tr:last-child td{border-bottom:none;}
.lst-root table.comp td.strong{font-weight:700;}
.lst-root table.comp tr.baseline td{background:var(--panel-2);}
.lst-root table.comp .delta-down{font-weight:700;}
.lst-root table.comp .delta-up{font-weight:700;font-style:italic;}
.lst-root .resp-chip{font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border:1px solid var(--ink);}
.lst-root .resp-chip.dark{background:var(--ink);color:#fff;}

.lst-root .sev{letter-spacing:2px;font-size:11px;}
.lst-root .sev b{font-weight:700;margin-left:6px;font-size:11px;letter-spacing:0;}

.lst-root .footnote{font-size:10px;color:var(--faint);letter-spacing:.03em;padding:16px 20px;border-top:1px solid var(--hair);line-height:1.6;}

.lst-root .tablewrap{overflow-x:auto;}

.lst-root .tree-node{width:100%;}
.lst-root .tree-sub{margin-top:6px;}
.lst-root .tree-array{display:flex;flex-direction:column;gap:12px;}
.lst-root .tree-array-item{border:1px solid var(--hair);padding:12px 14px;background:var(--panel);}

.lst-root .empty-note{padding:40px 0;text-align:center;color:var(--mute);font-size:13px;letter-spacing:.03em;}
.lst-root .error-box{padding:16px 20px;border:1px solid var(--ink);background:var(--panel-2);font-size:13px;margin:20px 0;}
.lst-root .error-box a{color:var(--ink);text-decoration:underline;}

.lst-root ::-webkit-scrollbar{height:6px;width:6px;}
.lst-root ::-webkit-scrollbar-thumb{background:var(--hair);}
`;