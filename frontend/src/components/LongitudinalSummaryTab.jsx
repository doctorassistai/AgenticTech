import React, { useEffect, useState } from "react";
import { RefreshCw, ChevronDown, ChevronUp, AlertTriangle, Activity } from "lucide-react";
import { THEMES } from "../dashboard/themes";

const API_BASE_URL = "https://doctorassist.ai/api/";

/* ─────────────────────────────────────────
   THEME TOKENS  (same system as PatientSummary.jsx)
───────────────────────────────────────── */
const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const T = {
  bg: theme.bg,
  bgAlt: theme.bgAlt,
  bgTert: theme.bgTert,
  text: theme.text,
  textSec: theme.textSec,
  textMuted: theme.textMuted,
  sec: theme.sec,
  border: theme.border,
  borderStr: theme.borderStr,
  accent: theme.accent,
  accentHover: theme.accentHover,
  accentLight: theme.accentLight,
  success: theme.success,
  warning: theme.warning,
  danger: theme.danger,
  info: theme.info,
  font: theme.font || "'Open Sans', sans-serif",
};

/* ─────────────────────────────────────────
   MICRO COMPONENTS  (mirrors PatientSummary.jsx exactly so this tab
   is visually indistinguishable from its siblings)
───────────────────────────────────────── */

function Badge({ label, accent, tone }) {
  if (label === undefined || label === null || label === "") return null;
  const toneColor = tone
    ? { success: T.success, warning: T.warning, danger: T.danger, info: T.info }[tone]
    : null;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "0.18rem 0.5rem",
        border: `1px solid ${toneColor || (accent ? T.borderStr : T.border)}`,
        fontSize: "0.6rem",
        fontWeight: 400,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: toneColor || (accent ? T.text : T.textMuted),
        whiteSpace: "nowrap",
        fontFamily: T.font,
        background: T.bg,
      }}
    >
      {label}
    </span>
  );
}

function Card({ children, style }) {
  return (
    <div
      className="da-card"
      style={{
        background: T.bg,
        border: `1px solid ${T.border}`,
        padding: "1rem 1.25rem",
        transition: "border-color 0.15s",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function SecLabel({ children, right }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: "0.75rem",
      }}
    >
      <div
        style={{
          fontSize: "0.6rem",
          fontWeight: 400,
          textTransform: "uppercase",
          letterSpacing: "0.18em",
          color: T.textMuted,
          fontFamily: T.font,
        }}
      >
        {children}
      </div>
      {right}
    </div>
  );
}

function EmptyState({ msg }) {
  return (
    <div style={{ textAlign: "center", padding: "2.5rem 1.25rem", color: T.textMuted, fontSize: "0.78rem", fontWeight: 300 }}>
      <div style={{ fontSize: "1.5rem", marginBottom: "0.5rem", opacity: 0.3 }}>—</div>
      {msg || "No data available"}
    </div>
  );
}

function Divider() {
  return <div style={{ height: "1px", background: T.border, margin: "1.5rem 0" }} />;
}

function Counter({ n, label }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 90,
        background: T.bgAlt,
        border: `1px solid ${T.border}`,
        padding: "0.875rem 1rem",
        textAlign: "center",
      }}
    >
      <div style={{ fontSize: "1.4rem", fontWeight: 300, letterSpacing: "-0.04em", color: T.text, lineHeight: 1 }}>{n ?? "—"}</div>
      <div style={{ fontSize: "0.58rem", color: T.textMuted, marginTop: "0.35rem", textTransform: "uppercase", letterSpacing: "0.1em" }}>{label}</div>
    </div>
  );
}

function Callout({ label, tone, children }) {
  const toneColor = tone ? { success: T.success, warning: T.warning, danger: T.danger, info: T.info }[tone] : T.borderStr;
  return (
    <div
      style={{
        borderLeft: `2px solid ${toneColor}`,
        padding: "0.875rem 1.25rem",
        background: T.bgAlt,
        marginBottom: "1rem",
      }}
    >
      {label && (
        <span
          style={{
            fontSize: "0.6rem",
            textTransform: "uppercase",
            letterSpacing: "0.15em",
            color: T.textMuted,
            fontWeight: 400,
            display: "block",
            marginBottom: "0.35rem",
          }}
        >
          {label}
        </span>
      )}
      {children}
    </div>
  );
}

function Collapsible({ title, defaultOpen = false, count, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginBottom: "0.5rem" }}>
      <button
        className="da-link-btn"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontSize: "0.68rem",
          color: T.textMuted,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          cursor: "pointer",
          padding: 0,
        }}
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        {title}
        {count != null && <span style={{ color: T.textMuted, fontWeight: 300 }}>({count})</span>}
      </button>
      {open && <div style={{ marginTop: "0.65rem" }}>{children}</div>}
    </div>
  );
}

/* Generic table for arrays of flat-ish objects. `columns` is
   [{ key, label, render? }]. Rows missing a key simply render "—". */
function DataTable({ columns, rows, emptyMsg }) {
  if (!rows || rows.length === 0) return <EmptyState msg={emptyMsg} />;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.78rem" }}>
        <thead>
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                style={{
                  textAlign: "left",
                  padding: "0.5rem 0.75rem",
                  borderBottom: `1px solid ${T.borderStr}`,
                  fontSize: "0.6rem",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  color: T.textMuted,
                  fontWeight: 400,
                  whiteSpace: "nowrap",
                }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr className="da-tbl-row" key={ri}>
              {columns.map((c) => (
                <td
                  key={c.key}
                  style={{
                    padding: "0.55rem 0.75rem",
                    borderBottom: `1px solid ${T.border}`,
                    color: T.textSec,
                    fontWeight: 300,
                    verticalAlign: "top",
                  }}
                >
                  {c.render ? c.render(row[c.key], row) : row[c.key] ?? "—"}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* Turns snake_case / camelCase keys into "Title Case" labels */
function titleCase(key) {
  return String(key)
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/* Renders any dynamic flat/nested JSON object as label:value rows —
   used for sections whose field names are decided by the LLM per
   patient (patient_overview, baseline_assessment, ai_decision_support) */
function KeyValueGrid({ obj }) {
  if (!obj || typeof obj !== "object" || Object.keys(obj).length === 0) return <EmptyState />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: "0.75rem" }}>
      {Object.entries(obj).map(([key, value]) => {
        if (value === null || value === undefined || value === "") return null;
        return (
          <div key={key}>
            <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem" }}>
              {titleCase(key)}
            </div>
            <div style={{ fontSize: "0.8rem", color: T.text, fontWeight: 400, lineHeight: 1.5 }}>
              {renderValue(value)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderValue(value) {
  if (Array.isArray(value)) {
    if (value.length === 0) return "—";
    if (typeof value[0] === "object") {
      return (
        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
          {value.map((v, i) => (
            <div key={i} style={{ fontSize: "0.76rem", fontWeight: 300, color: T.textSec }}>
              {typeof v === "object" ? JSON.stringify(v) : String(v)}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
        {value.map((v, i) => (
          <Badge key={i} label={String(v)} accent />
        ))}
      </div>
    );
  }
  if (typeof value === "object") {
    return <KeyValueGrid obj={value} />;
  }
  return String(value);
}

/* Direction / status → tone mapping used across measurement + response
   sections so color always means the same thing throughout this tab. */
function directionTone(direction) {
  const d = (direction || "").toLowerCase();
  if (d === "improving" || d === "on_time" || d === "responder" || d === "as_prescribed") return "success";
  if (d === "worsening" || d === "delayed" || d === "non_responder" || d === "discontinued") return "danger";
  if (d === "mixed" || d === "interrupted" || d === "missed_doses") return "warning";
  return "info";
}

function urgencyTone(urgency) {
  const u = (urgency || "").toLowerCase();
  if (u === "urgent") return "danger";
  if (u === "prompt") return "warning";
  return "info";
}

/* ─────────────────────────────────────────
   SECTION: Patient Overview + Baseline Assessment
───────────────────────────────────────── */
function OverviewSection({ patientOverview, baselineAssessment, careStage }) {
  const hasOverview = patientOverview && Object.keys(patientOverview).length > 0;
  const hasBaseline = baselineAssessment && Object.keys(baselineAssessment).length > 0;
  if (!hasOverview && !hasBaseline && !careStage) return null;

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      {careStage && (
        <Callout label="Current Care Stage">
          <div style={{ fontSize: "0.88rem", color: T.text, fontWeight: 400 }}>{careStage}</div>
        </Callout>
      )}

      {hasOverview && (
        <>
          <SecLabel>Patient Overview</SecLabel>
          <Card style={{ marginBottom: hasBaseline ? "1rem" : 0 }}>
            <KeyValueGrid obj={patientOverview} />
          </Card>
        </>
      )}

      {hasBaseline && (
        <>
          <SecLabel>Baseline Assessment (Visit 0 / Day 0)</SecLabel>
          <Card>
            <KeyValueGrid obj={baselineAssessment} />
          </Card>
        </>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: Visit Timeline (with compliance)
───────────────────────────────────────── */
function VisitTimelineSection({ visits, visitCompliance }) {
  if (!visits || visits.length === 0) return null;

  const complianceByDate = {};
  (visitCompliance || []).forEach((c) => {
    complianceByDate[c.visit_date] = c;
  });

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SecLabel>Patient Journey — Visit Timeline</SecLabel>
      {visits.map((v, i) => {
        const compliance = complianceByDate[v.visit_date];
        const isLast = i === visits.length - 1;
        return (
          <div key={i} style={{ display: "flex", gap: "1rem", paddingBottom: "1.1rem" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 16 }}>
              <div style={{ width: 8, height: 8, border: `1px solid ${T.borderStr}`, background: T.bg, marginTop: 4, flexShrink: 0 }} />
              {!isLast && <div style={{ flex: 1, width: 1, background: T.border, marginTop: 4 }} />}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "0.6rem", flexWrap: "wrap" }}>
                <Badge label={v.visit_date} accent />
                <Badge label={v.visit_type} />
                {compliance?.compliance_status && (
                  <Badge label={compliance.compliance_status.replace("_", " ")} tone={directionTone(compliance.compliance_status)} />
                )}
              </div>
              <Card>
                {v.events && v.events.length > 0 ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
                    {v.events.map((e, ei) => (
                      <div key={ei} style={{ paddingBottom: ei < v.events.length - 1 ? "0.5rem" : 0, borderBottom: ei < v.events.length - 1 ? `1px solid ${T.border}` : "none" }}>
                        <div style={{ fontSize: "0.78rem", color: T.text, fontWeight: 400 }}>{e.summary}</div>
                        <div style={{ display: "flex", gap: "8px", marginTop: "3px" }}>
                          {e.event_type && <span style={{ fontSize: "0.6rem", color: T.textMuted }}>{e.event_type}</span>}
                          {e.document_type && <span style={{ fontSize: "0.6rem", color: T.textMuted }}>· {e.document_type}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ fontSize: "0.75rem", color: T.textMuted }}>No events recorded for this visit.</div>
                )}
              </Card>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: Measurement Timelines + Change-from-Baseline + Progression Matrix
───────────────────────────────────────── */
function MeasurementSection({ changeFromBaselineTable, progressionMatrix }) {
  const hasChangeTable = changeFromBaselineTable && changeFromBaselineTable.length > 0;
  const hasMatrix = progressionMatrix && Object.keys(progressionMatrix).length > 0;
  if (!hasChangeTable && !hasMatrix) return null;

  // Column order for the progression matrix: "Baseline" always first,
  // then every other visit label in the order it's first encountered
  // across parameters (each row is already chronological upstream).
  let columns = [];
  if (hasMatrix) {
    const seen = new Set();
    Object.values(progressionMatrix).forEach((row) => {
      Object.keys(row).forEach((label) => {
        if (!seen.has(label)) {
          seen.add(label);
          columns.push(label);
        }
      });
    });
    columns = columns.sort((a, b) => (a === "Baseline" ? -1 : b === "Baseline" ? 1 : 0));
  }

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SecLabel>Measurement Trends</SecLabel>

      {hasChangeTable && (
        <Card style={{ marginBottom: hasMatrix ? "1rem" : 0 }}>
          <DataTable
            emptyMsg="No repeated measurements found"
            columns={[
              { key: "parameter", label: "Parameter" },
              { key: "unit", label: "Unit" },
              { key: "baseline_value", label: "Baseline" },
              { key: "current_value", label: "Current" },
              { key: "absolute_change", label: "Δ Absolute" },
              {
                key: "percent_change",
                label: "Δ Percent",
                render: (v) => (v === null || v === undefined ? "—" : `${v > 0 ? "+" : ""}${v}%`),
              },
              {
                key: "direction",
                label: "Direction",
                render: (v) => <Badge label={v} tone={directionTone(v)} />,
              },
            ]}
            rows={changeFromBaselineTable}
          />
        </Card>
      )}

      {hasMatrix && (
        <Collapsible title="Subject Progression Matrix (parameter × visit)" defaultOpen={false}>
          <Card>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "0.76rem" }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: `1px solid ${T.borderStr}`, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, whiteSpace: "nowrap" }}>
                      Parameter
                    </th>
                    {columns.map((col) => (
                      <th
                        key={col}
                        style={{ textAlign: "left", padding: "0.5rem 0.75rem", borderBottom: `1px solid ${T.borderStr}`, fontSize: "0.6rem", textTransform: "uppercase", letterSpacing: "0.08em", color: T.textMuted, whiteSpace: "nowrap" }}
                      >
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(progressionMatrix).map(([name, row], ri) => (
                    <tr className="da-tbl-row" key={ri}>
                      <td style={{ padding: "0.55rem 0.75rem", borderBottom: `1px solid ${T.border}`, color: T.text, fontWeight: 400, whiteSpace: "nowrap" }}>{name}</td>
                      {columns.map((col) => (
                        <td key={col} style={{ padding: "0.55rem 0.75rem", borderBottom: `1px solid ${T.border}`, color: T.textSec, fontWeight: 300 }}>
                          {row[col] ?? "—"}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </Collapsible>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: Treatment Timeline + Dosing Compliance
───────────────────────────────────────── */
function TreatmentSection({ treatmentTimeline, dosingCompliance }) {
  const hasTreatment = treatmentTimeline && treatmentTimeline.length > 0;
  const hasDosing = dosingCompliance && dosingCompliance.length > 0;
  if (!hasTreatment && !hasDosing) return null;

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SecLabel>Treatment Timeline</SecLabel>
      {hasTreatment && (
        <Card style={{ marginBottom: hasDosing ? "1rem" : 0 }}>
          <DataTable
            columns={[
              { key: "visit_date", label: "Date" },
              { key: "treatment", label: "Treatment" },
              { key: "action", label: "Action", render: (v) => <Badge label={v?.replace("_", " ")} tone={directionTone(v)} /> },
              { key: "detail", label: "Detail" },
            ]}
            rows={treatmentTimeline}
          />
        </Card>
      )}

      {hasDosing && (
        <Collapsible title="Dosing Compliance" defaultOpen count={dosingCompliance.length}>
          <Card>
            <DataTable
              columns={[
                { key: "visit_date", label: "Date" },
                { key: "medication", label: "Medication" },
                { key: "adherence_percent", label: "Adherence", render: (v) => (v == null ? "—" : `${v}%`) },
                { key: "status", label: "Status", render: (v) => <Badge label={v?.replace("_", " ")} tone={directionTone(v)} /> },
                { key: "detail", label: "Detail" },
              ]}
              rows={dosingCompliance}
            />
          </Card>
        </Collapsible>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: Safety Timeline + AE Severity Matrix
───────────────────────────────────────── */
function SafetySection({ safetyTimeline, aeSeverityMatrix }) {
  const hasSafety = safetyTimeline && safetyTimeline.length > 0;
  if (!hasSafety) return null;
  const byGrade = aeSeverityMatrix?.by_severity_grade || {};

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SecLabel>Safety Timeline</SecLabel>

      {aeSeverityMatrix && Object.keys(byGrade).length > 0 && (
        <div style={{ display: "flex", gap: "0.75rem", marginBottom: "1rem", flexWrap: "wrap" }}>
          <Counter n={aeSeverityMatrix.total_events} label="Total Events" />
          <Counter n={aeSeverityMatrix.serious_event_count} label="Serious Events" />
          {Object.entries(byGrade).map(([grade, g]) => (
            <Counter key={grade} n={g.count} label={grade} />
          ))}
        </div>
      )}

      <Card>
        <DataTable
          columns={[
            { key: "visit_date", label: "Date" },
            { key: "event", label: "Event" },
            { key: "severity_grade", label: "Grade", render: (v) => <Badge label={v} tone={v && v.toLowerCase().includes("4") || v?.toLowerCase().includes("5") ? "danger" : v?.toLowerCase().includes("3") ? "warning" : "info"} /> },
            { key: "causality", label: "Causality" },
            {
              key: "serious",
              label: "Serious?",
              render: (v) => (v === true ? <Badge label="Yes" tone="danger" /> : v === false ? <Badge label="No" /> : "—"),
            },
            { key: "action_taken", label: "Action Taken" },
            { key: "outcome", label: "Outcome" },
          ]}
          rows={safetyTimeline}
        />
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: Response Summary / Efficacy Endpoints
───────────────────────────────────────── */
function ResponseSection({ responseSummary }) {
  if (!responseSummary || Object.keys(responseSummary).length === 0) return null;
  const {
    framework_used,
    overall_response,
    confidence,
    basis,
    primary_endpoint,
    secondary_endpoints,
    responder_status,
  } = responseSummary;

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SecLabel>Response Evaluation</SecLabel>
      <Card>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap", marginBottom: "0.75rem" }}>
          {overall_response && (
            <div style={{ fontSize: "1.1rem", fontWeight: 400, color: T.text }}>{overall_response}</div>
          )}
          {responder_status && <Badge label={responder_status.replace("_", " ")} tone={directionTone(responder_status)} />}
          {framework_used && <Badge label={framework_used} accent />}
          {confidence != null && <Badge label={`${Math.round(confidence * 100)}% confidence`} />}
        </div>

        {basis && <p style={{ fontSize: "0.8rem", color: T.textSec, lineHeight: 1.6, fontWeight: 300, marginBottom: "0.75rem" }}>{basis}</p>}

        {(primary_endpoint || (secondary_endpoints && secondary_endpoints.length > 0)) && (
          <div style={{ display: "flex", gap: "1.5rem", flexWrap: "wrap", paddingTop: "0.75rem", borderTop: `1px solid ${T.border}` }}>
            {primary_endpoint && (
              <div>
                <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem" }}>
                  Primary Endpoint
                </div>
                <Badge label={primary_endpoint} accent />
              </div>
            )}
            {secondary_endpoints && secondary_endpoints.length > 0 && (
              <div>
                <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.25rem" }}>
                  Secondary Endpoints
                </div>
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                  {secondary_endpoints.map((e, i) => (
                    <Badge key={i} label={e} />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: Longitudinal Reasoning (stage history + carried-forward findings)
───────────────────────────────────────── */
function LongitudinalReasoningSection({ longitudinalSummary }) {
  if (!longitudinalSummary || Object.keys(longitudinalSummary).length === 0) return null;
  const stageHistory = longitudinalSummary.stage_history || [];
  const keyFindings = longitudinalSummary.key_findings_carry_forward || [];
  if (stageHistory.length === 0 && keyFindings.length === 0) return null;

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SecLabel>Longitudinal Reasoning</SecLabel>
      <Card>
        {stageHistory.length > 0 && (
          <div style={{ marginBottom: keyFindings.length > 0 ? "1rem" : 0 }}>
            <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.5rem" }}>
              Care Stage History
            </div>
            <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {stageHistory.map((s, i) => (
                <Badge key={i} label={s.date ? `${s.stage} · ${s.date}` : s.stage} />
              ))}
            </div>
          </div>
        )}
        {keyFindings.length > 0 && (
          <div>
            <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.5rem" }}>
              Key Findings Carried Forward
            </div>
            <ul style={{ paddingLeft: "1.1rem", display: "flex", flexDirection: "column", gap: "0.35rem" }}>
              {keyFindings.map((f, i) => (
                <li key={i} style={{ fontSize: "0.78rem", color: T.textSec, fontWeight: 300, lineHeight: 1.5 }}>
                  {typeof f === "object" ? JSON.stringify(f) : f}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: Cross-Speciality Flags
───────────────────────────────────────── */
function CrossSpecialitySection({ flags }) {
  if (!flags || flags.length === 0) return null;
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SecLabel>Cross-Speciality Flags</SecLabel>
      {flags.map((f, i) => (
        <Callout key={i} tone={urgencyTone(f.urgency)} label={`${f.from_speciality || "—"} → ${f.affects_speciality || "—"}`}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "8px" }}>
            <AlertTriangle size={14} style={{ color: T.textMuted, marginTop: "2px", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "0.8rem", color: T.text, fontWeight: 400, marginBottom: "0.25rem" }}>{f.trigger}</div>
              <div style={{ fontSize: "0.76rem", color: T.textSec, fontWeight: 300, marginBottom: "0.4rem" }}>{f.question_or_action}</div>
              <Badge label={f.urgency} tone={urgencyTone(f.urgency)} />
            </div>
          </div>
        </Callout>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: AI Decision Support
───────────────────────────────────────── */
function AIDecisionSection({ aiDecisionSupport }) {
  if (!aiDecisionSupport || Object.keys(aiDecisionSupport).length === 0) return null;
  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <SecLabel right={<Activity size={12} style={{ color: T.textMuted }} />}>AI Decision Support</SecLabel>
      <Card style={{ borderLeft: `2px solid ${T.borderStr}` }}>
        <KeyValueGrid obj={aiDecisionSupport} />
      </Card>
    </div>
  );
}

/* ─────────────────────────────────────────
   SECTION: CDISC Domain Mapping (reference / technical — collapsed by default)
───────────────────────────────────────── */
function CdiscSection({ cdiscMapping }) {
  if (!cdiscMapping || Object.keys(cdiscMapping).length === 0) return null;
  const measurementDomains = cdiscMapping.measurement_domains || {};
  const treatmentDomains = cdiscMapping.treatment_domains || [];
  const disposition = cdiscMapping.disposition || {};

  return (
    <div style={{ marginBottom: "1.75rem" }}>
      <Collapsible title="CDISC Domain Mapping (SDTM)" defaultOpen={false}>
        <Card>
          {Object.keys(measurementDomains).length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.5rem" }}>
                Measurements → Domain
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                {Object.entries(measurementDomains).map(([name, code], i) => (
                  <Badge key={i} label={`${name}: ${code}`} accent />
                ))}
              </div>
            </div>
          )}

          {treatmentDomains.length > 0 && (
            <div style={{ marginBottom: Object.keys(disposition).length > 0 ? "1rem" : 0 }}>
              <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.5rem" }}>
                Treatments → Domain
              </div>
              <DataTable
                columns={[
                  { key: "treatment", label: "Treatment" },
                  { key: "domain_code", label: "Domain" },
                ]}
                rows={treatmentDomains}
              />
            </div>
          )}

          {Object.keys(disposition).length > 0 && (
            <div>
              <div style={{ fontSize: "0.58rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "0.5rem" }}>
                Disposition (DS)
              </div>
              <Badge label={disposition.status} accent />
            </div>
          )}
        </Card>
      </Collapsible>
    </div>
  );
}

/* ─────────────────────────────────────────
   ROOT: LongitudinalSummaryTab
───────────────────────────────────────── */
export default function LongitudinalSummaryTab({ patientId, doctorId, trigger }) {
  const [data, setData] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const effectiveDoctorId = doctorId || localStorage.getItem("doctor_id") || localStorage.getItem("sys_user_id") || "";

  const fetchSummary = async (forceRefresh) => {
    if (!patientId) {
      console.warn("LongitudinalSummaryTab: no patientId provided, skipping fetch");
      return;
    }
    try {
      setLoading(true);
      setError("");
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/longitudinal_summary/speciality/${patientId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: effectiveDoctorId, force_refresh: !!forceRefresh }),
      });
      const json = await res.json();
      if (res.ok && json?.clinical_trial_summary) {
        setData(json.clinical_trial_summary);
        setMeta(json.meta || {});
      } else {
        setError(json?.detail || "No longitudinal summary found for this patient.");
      }
    } catch (err) {
      setError("Failed to load longitudinal summary.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSummary(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [patientId, trigger]);

  if (loading && !data) {
    return (
      <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "280px", flexDirection: "column", gap: "1rem" }}>
        <div style={{ width: 28, height: 28, border: `1px solid ${T.border}`, borderTopColor: T.borderStr, borderRadius: "50%", animation: "da-spin 0.7s linear infinite" }} />
        <div style={{ fontSize: "0.72rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.15em", fontFamily: T.font }}>
          Building longitudinal summary…
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          padding: "1.25rem",
          border: `1px solid ${T.borderStr}`,
          background: T.bgAlt,
          fontSize: "0.82rem",
          color: T.text,
          fontFamily: T.font,
        }}
      >
        <span>{error}</span>
        <button
          className="da-action-btn"
          onClick={() => fetchSummary(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            border: `1px solid ${T.borderStr}`,
            background: T.bg,
            cursor: "pointer",
            padding: "0.4rem 0.75rem",
            fontSize: "0.72rem",
            fontFamily: T.font,
            color: T.text,
            flexShrink: 0,
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? "da-spin 0.7s linear infinite" : "none" }} />
          REFRESH
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div>
      {/* meta bar */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", marginBottom: "1.25rem", flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: "0.75rem", flexWrap: "wrap" }}>
          <Counter n={meta?.visit_count} label="Visits" />
          <Counter n={meta?.measurements_tracked?.length ?? 0} label="Measurements Tracked" />
          <Counter n={meta?.documents_analyzed} label="Documents Analyzed" />
        </div>
        <button
          className="da-action-btn"
          onClick={() => fetchSummary(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            border: `1px solid ${T.border}`,
            background: T.bg,
            cursor: "pointer",
            padding: "0.4rem 0.75rem",
            fontSize: "0.68rem",
            fontFamily: T.font,
            color: T.text,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
          }}
        >
          <RefreshCw size={12} style={{ animation: loading ? "da-spin 0.7s linear infinite" : "none" }} />
          Regenerate
        </button>
      </div>

      {meta?.generated_at && (
        <div style={{ fontSize: "0.68rem", color: T.textMuted, marginBottom: "1.5rem" }}>
          Last generated {new Date(meta.generated_at).toLocaleString()}
          {meta?.is_incremental ? " · served from cache (no new documents)" : ""}
        </div>
      )}

      <OverviewSection
        patientOverview={data.patient_overview}
        baselineAssessment={data.baseline_assessment}
        careStage={data.longitudinal_summary?.care_stage}
      />

      <VisitTimelineSection visits={data.visit_timeline} visitCompliance={data.visit_compliance} />

      <MeasurementSection
        changeFromBaselineTable={data.change_from_baseline_table}
        progressionMatrix={data.progression_matrix}
      />

      <TreatmentSection treatmentTimeline={data.treatment_timeline} dosingCompliance={data.dosing_compliance} />

      <SafetySection safetyTimeline={data.safety_timeline} aeSeverityMatrix={data.ae_severity_matrix} />

      <ResponseSection responseSummary={data.response_summary} />

      <LongitudinalReasoningSection longitudinalSummary={data.longitudinal_summary} />

      <CrossSpecialitySection flags={data.cross_speciality_flags} />

      <AIDecisionSection aiDecisionSupport={data.ai_decision_support} />

      <Divider />

      <CdiscSection cdiscMapping={data.cdisc_mapping} />

      {Object.keys(data).length === 0 && <EmptyState msg="Longitudinal summary not yet generated for this patient" />}
    </div>
  );
}