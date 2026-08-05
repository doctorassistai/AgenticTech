/**
 * DischargeValidationPanel.jsx
 * ─────────────────────────────────────────────────────────────────────────────
 * Discharge Validation Panel — Evidence-Based Multi-Agent Audit UI  v4.0.0
 *
 * Renders the output of POST /discharge-validation (v4.0.0 backend)
 *
 * Sections rendered:
 *   • Dashboard summary (approved banner, quality gate, scores, issue counts, priority actions)
 *   • Issues panel (Critical / Major / Moderate / Minor cards)
 *   • Clinical narrative (disease timeline + findings comparison)
 *   • Agent detail tabs: VA1 (dual-agent) · VA2–VA6 · VA8–VA11
 *
 * NEW in v4.0.0:
 *   • VA1 tab: shows VA1A ordered list + VA1B verification summary + all result/pending sections
 *   • VA8  tab: Safety & Allergy (allergy flags, drug toxicity, devices, HAC)
 *   • VA9  tab: Coding & Billing (ICD-10, DRG, CC/MCC, CDI queries)
 *   • VA10 tab: Insurance Documents (pre-auth, LoS, medical necessity, claims package)
 *   • VA11 tab: Post-Discharge Monitoring (Day-2/7/30 questions, escalation triggers, risk)
 *   • Quality Gate panel (P8 hard blocks)
 *   • Expanded scores (10 dimensions)
 *   • BPMH gap card in VA2
 *   • Social environment domain in VA5
 *
 * Usage:
 *   <DischargeValidationPanel doctorId={doctorId} patientId={patientId} specialty={specialty} />
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useCallback } from "react";
import {
  Box,
  Typography,
  IconButton,
  Collapse,
  CircularProgress,
  Tooltip,
} from "@mui/material";
import {
  BiotechRounded,
  CheckCircleRounded,
  CancelRounded,
  WarningAmberRounded,
  ErrorRounded,
  InfoRounded,
  ExpandMoreRounded,
  ExpandLessRounded,
  ScienceRounded,
  MedicationRounded,
  AssignmentRounded,
  LocalHospitalRounded,
  RecommendRounded,
  TrackChangesRounded,
  FiberManualRecordRounded,
  PriorityHighRounded,
  TimelineRounded,
  CompareArrowsRounded,
  SecurityRounded,
  CodeRounded,
  DescriptionRounded,
  MonitorHeartRounded,
  VerifiedRounded,
  BlockRounded,
  HomeRounded,
  PersonRounded,
} from "@mui/icons-material";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ── Design tokens ─────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;
const C = {
  black: "#0a0a0a",
  ink: "#1a1a1a",
  charcoal: "#2e2e2e",
  smoke: "#4a4a4a",
  ash: "#7a7a7a",
  silver: "#a8a8a8",
  mist: "#d4d4d4",
  fog: "#e8e8e8",
  ghost: "#f2f2f2",
  white: "#ffffff",
  warn: "#b45309",
  warnBg: "#fffbeb",
  warnBorder: "#fde68a",
  ok: "#166534",
  okBg: "#f0fdf4",
  okBorder: "#bbf7d0",
  blue: "#1e3a5f",
  blueBg: "#eff6ff",
  blueBorder: "#bfdbfe",
  critical: "#991b1b",
  criticalBg: "#fff1f2",
  criticalBorder: "#fecdd3",
  major: "#9a3412",
  majorBg: "#fff7ed",
  majorBorder: "#fed7aa",
  moderate: "#854d0e",
  moderateBg: "#fefce8",
  moderateBorder: "#fef08a",
  minor: "#1e40af",
  minorBg: "#eff6ff",
  minorBorder: "#bfdbfe",
  purple: "#5b21b6",
  purpleBg: "#f5f3ff",
  purpleBorder: "#ddd6fe",
  teal: "#0f766e",
  tealBg: "#f0fdfa",
  tealBorder: "#99f6e4",
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

// ── Severity config ───────────────────────────────────────────────────────────
const SEVERITY = {
  Critical: { color: C.critical, bg: C.criticalBg, border: C.criticalBorder, icon: <ErrorRounded sx={{ fontSize: 14 }} /> },
  Major:    { color: C.major,    bg: C.majorBg,    border: C.majorBorder,    icon: <WarningAmberRounded sx={{ fontSize: 14 }} /> },
  Moderate: { color: C.moderate, bg: C.moderateBg, border: C.moderateBorder, icon: <InfoRounded sx={{ fontSize: 14 }} /> },
  Minor:    { color: C.minor,    bg: C.minorBg,    border: C.minorBorder,    icon: <FiberManualRecordRounded sx={{ fontSize: 12 }} /> },
};

const URGENCY = {
  Immediate:          { color: C.critical, bg: C.criticalBg, border: C.criticalBorder },
  "Within 24h":       { color: C.major,    bg: C.majorBg,    border: C.majorBorder },
  "Before discharge": { color: C.warn,     bg: C.warnBg,     border: C.warnBorder },
};

// ── Shared primitives ─────────────────────────────────────────────────────────
const Label = ({ children, sx = {} }) => (
  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.5 }), ...sx }}>
    {children}
  </Typography>
);

const Value = ({ children, sx = {} }) => (
  <Typography sx={{ ...os({ fontSize: 13, color: C.ink, lineHeight: 1.5 }), ...sx }}>
    {children || "—"}
  </Typography>
);

const SectionDivider = ({ label }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, my: 2 }}>
    <Box sx={{ flex: 1, height: 1, background: C.fog }} />
    {label && (
      <Typography sx={{ ...os({ fontSize: 10, color: C.silver, letterSpacing: "0.1em", textTransform: "uppercase" }) }}>
        {label}
      </Typography>
    )}
    <Box sx={{ flex: 1, height: 1, background: C.fog }} />
  </Box>
);

// ── Score bar ─────────────────────────────────────────────────────────────────
const ScoreBar = ({ label, value }) => {
  const pct   = Math.round((value || 0) * 100);
  const isHigh = pct >= 80;
  const isMed  = pct >= 50 && pct < 80;
  const color  = isHigh ? C.ok : isMed ? C.warn : C.critical;
  const bg     = isHigh ? C.okBg : isMed ? C.warnBg : C.criticalBg;
  const border = isHigh ? C.okBorder : isMed ? C.warnBorder : C.criticalBorder;
  return (
    <Box sx={{ p: 1.5, background: bg, border: `1px solid ${border}`, borderRadius: "3px" }}>
      <Label sx={{ color: C.ash, mb: 0.25 }}>{label.replace(/_/g, " ")}</Label>
      <Typography sx={{ ...os({ fontSize: 16, color, fontWeight: 400 }) }}>{pct}%</Typography>
      <Box sx={{ height: 3, background: border, borderRadius: "2px", mt: 0.5, overflow: "hidden" }}>
        <Box sx={{ height: "100%", width: `${pct}%`, background: color, borderRadius: "2px", transition: "width 0.6s ease" }} />
      </Box>
    </Box>
  );
};

// ── Issue card ────────────────────────────────────────────────────────────────
const IssueCard = ({ issue }) => {
  const [open, setOpen] = useState(false);
  const sev = SEVERITY[issue.severity] || SEVERITY.Minor;
  return (
    <Box sx={{ border: `1px solid ${sev.border}`, borderRadius: "3px", mb: 1, overflow: "hidden", background: sev.bg }}>
      <Box
        onClick={() => setOpen(p => !p)}
        sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", px: 1.75, py: 1.25, cursor: "pointer" }}
      >
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1, flex: 1 }}>
          <Box sx={{ color: sev.color, mt: 0.15, flexShrink: 0 }}>{sev.icon}</Box>
          <Box>
            <Typography sx={{ ...os({ fontSize: 12, color: sev.color }) }}>{issue.description}</Typography>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.25 }) }}>
              {issue.category}{issue.date && issue.date !== "unknown" ? ` · ${issue.date}` : ""}
              {issue.source_document ? ` · ${issue.source_document}` : ""}
            </Typography>
          </Box>
        </Box>
        <IconButton size="small" sx={{ p: 0.25, color: C.ash, flexShrink: 0 }}>
          {open ? <ExpandLessRounded sx={{ fontSize: 15 }} /> : <ExpandMoreRounded sx={{ fontSize: 15 }} />}
        </IconButton>
      </Box>
      <Collapse in={open}>
        <Box sx={{ px: 1.75, pb: 1.5, borderTop: `1px solid ${sev.border}` }}>
          {issue.evidence && (
            <Box sx={{ mt: 1 }}>
              <Label>Evidence</Label>
              <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.6, fontStyle: "italic" }) }}>
                "{issue.evidence}"
              </Typography>
            </Box>
          )}
          {issue.recommendation && (
            <Box sx={{ mt: 1 }}>
              <Label>Recommendation</Label>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ink, lineHeight: 1.5 }) }}>
                → {issue.recommendation}
              </Typography>
            </Box>
          )}
          {issue.confidence_score !== undefined && (
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.75 }) }}>
              Confidence: {Math.round((issue.confidence_score || 0) * 100)}%
            </Typography>
          )}
        </Box>
      </Collapse>
    </Box>
  );
};

// ── Collapsible section ───────────────────────────────────────────────────────
const Section = ({ title, icon, count, defaultOpen = true, children, countColor = C.ash }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{ mb: 2 }}>
      <Box
        onClick={() => setOpen(p => !p)}
        sx={{ display: "flex", alignItems: "center", gap: 1, cursor: "pointer", mb: open ? 1 : 0, py: 0.5 }}
      >
        <Box sx={{ color: C.ash }}>{icon}</Box>
        <Typography sx={{ ...os({ fontSize: 11, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em", flex: 1 }) }}>
          {title}
        </Typography>
        {count !== undefined && (
          <Typography sx={{ ...os({ fontSize: 10, color: countColor }) }}>{count}</Typography>
        )}
        <IconButton size="small" sx={{ p: 0.25, color: C.ash }}>
          {open ? <ExpandLessRounded sx={{ fontSize: 14 }} /> : <ExpandMoreRounded sx={{ fontSize: 14 }} />}
        </IconButton>
      </Box>
      <Collapse in={open}>{children}</Collapse>
    </Box>
  );
};

// ── Data table ────────────────────────────────────────────────────────────────
const DataTable = ({ columns, rows, emptyText = "None documented." }) => {
  if (!rows || rows.length === 0) {
    return <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>{emptyText}</Typography>;
  }
  return (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", overflow: "hidden" }}>
      <Box sx={{ display: "grid", gridTemplateColumns: `repeat(${columns.length}, 1fr)`, background: C.ghost, borderBottom: `1px solid ${C.fog}` }}>
        {columns.map(col => (
          <Box key={col.key} sx={{ px: 1.5, py: 0.75 }}>
            <Label sx={{ mb: 0 }}>{col.label}</Label>
          </Box>
        ))}
      </Box>
      {rows.map((row, i) => (
        <Box
          key={i}
          sx={{
            display: "grid",
            gridTemplateColumns: `repeat(${columns.length}, 1fr)`,
            borderBottom: i < rows.length - 1 ? `1px solid ${C.fog}` : "none",
            "&:hover": { background: C.ghost },
            transition: "background 0.1s",
          }}
        >
          {columns.map(col => (
            <Box key={col.key} sx={{ px: 1.5, py: 1 }}>
              <Typography sx={{ ...os({ fontSize: 11, color: col.color ? col.color(row[col.key]) : C.charcoal, lineHeight: 1.5 }) }}>
                {row[col.key] ?? "—"}
              </Typography>
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
};

// ── Bullet list ───────────────────────────────────────────────────────────────
const BulletList = ({ items, emptyText = "None documented.", color = C.charcoal }) => {
  if (!items || items.length === 0)
    return <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>{emptyText}</Typography>;
  return (
    <Box>
      {items.map((item, i) => (
        <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.5 }}>
          <Box sx={{ width: 4, height: 4, borderRadius: "50%", background: C.mist, mt: 0.7, flexShrink: 0 }} />
          <Typography sx={{ ...os({ fontSize: 12, color, lineHeight: 1.55 }) }}>
            {typeof item === "string" ? item : JSON.stringify(item)}
          </Typography>
        </Box>
      ))}
    </Box>
  );
};

// ── Status badge ──────────────────────────────────────────────────────────────
const StatusBadge = ({ value }) => {
  const v = (value || "").toLowerCase();
  const map = {
    normal: { color: C.ok, bg: C.okBg },
    resolved: { color: C.ok, bg: C.okBg },
    abnormal: { color: C.warn, bg: C.warnBg },
    critical: { color: C.critical, bg: C.criticalBg },
    pending: { color: C.blue, bg: C.blueBg },
    not_documented: { color: C.ash, bg: C.ghost },
    unknown: { color: C.ash, bg: C.ghost },
    green: { color: C.ok, bg: C.okBg },
    amber: { color: C.warn, bg: C.warnBg },
    red: { color: C.critical, bg: C.criticalBg },
    high: { color: C.critical, bg: C.criticalBg },
    medium: { color: C.warn, bg: C.warnBg },
    low: { color: C.ok, bg: C.okBg },
    ready: { color: C.ok, bg: C.okBg },
    incomplete: { color: C.warn, bg: C.warnBg },
  };
  const style = map[v] || { color: C.smoke, bg: C.fog };
  return (
    <Box sx={{ display: "inline-block", px: 1, py: 0.15, borderRadius: "2px", background: style.bg }}>
      <Typography sx={{ ...os({ fontSize: 10, color: style.color, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
        {value || "—"}
      </Typography>
    </Box>
  );
};

// ── Info row (key/value pair) ─────────────────────────────────────────────────
const InfoRow = ({ label, value, valueColor }) => (
  <Box sx={{ display: "flex", gap: 1, mb: 0.5, alignItems: "flex-start" }}>
    <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", minWidth: 130, mt: 0.2 }) }}>
      {label}
    </Typography>
    <Typography sx={{ ...os({ fontSize: 11, color: valueColor || C.charcoal, lineHeight: 1.5, flex: 1 }) }}>
      {value || "—"}
    </Typography>
  </Box>
);

// ═══════════════════════════════════════════════════════════════
// VA1 — Investigation Tab (DUAL-AGENT: VA1A + VA1B)
// ═══════════════════════════════════════════════════════════════
const VA1Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;

  const orderedInvs   = report.VA1A_ordered_investigations || [];
  const resultedInvs  = report.VA1B_resulted_investigations || [];
  const pendingInvs   = report.VA1B_pending_investigations || [];
  const abnormalVals  = report.VA1B_abnormal_values || [];
  const trends        = report.VA1B_investigation_trends || [];
  const comparison    = report.VA1B_findings_comparison || [];
  const concerns      = report.VA1B_active_concerns || [];
  const verifSum      = report.verification_summary || {};
  const issues        = report.issues || [];

  return (
    <Box>
      {/* Dual-agent verification banner */}
      <Box sx={{ border: `1px solid ${C.blueBorder}`, borderRadius: "3px", p: 1.5, mb: 2, background: C.blueBg, display: "flex", gap: 1.5, alignItems: "flex-start" }}>
        <VerifiedRounded sx={{ fontSize: 16, color: C.blue, flexShrink: 0, mt: 0.15 }} />
        <Box>
          <Typography sx={{ ...os({ fontSize: 11, color: C.blue }) }}>Dual-Agent Investigation Verification (VA1A → VA1B)</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1, mt: 0.75 }}>
            {[
              { label: "Orders found (VA1A)", val: verifSum.total_orders_extracted_by_VA1A ?? orderedInvs.length },
              { label: "Results verified (VA1B)", val: verifSum.orders_with_results_found ?? resultedInvs.length },
              { label: "Genuinely pending", val: verifSum.orders_genuinely_pending ?? pendingInvs.length },
            ].map(({ label, val }) => (
              <Box key={label}>
                <Label sx={{ color: C.blue }}>{label}</Label>
                <Typography sx={{ ...os({ fontSize: 16, color: C.blue, fontWeight: 400 }) }}>{val}</Typography>
              </Box>
            ))}
          </Box>
          {verifSum.verification_note && (
            <Typography sx={{ ...os({ fontSize: 10, color: C.blue, mt: 0.75, fontStyle: "italic" }) }}>
              {verifSum.verification_note}
            </Typography>
          )}
        </Box>
      </Box>

      {/* VA1A — Ordered investigations */}
      <Section title="VA1A · All Orders Extracted" icon={<AssignmentRounded sx={{ fontSize: 14 }} />} count={orderedInvs.length} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "test_name",    label: "Test" },
            { key: "order_type",   label: "Type" },
            { key: "ordered_date", label: "Date" },
            { key: "source_document", label: "Source" },
          ]}
          rows={orderedInvs}
          emptyText="No orders extracted."
        />
        {orderedInvs.length > 0 && (
          <Box sx={{ mt: 1 }}>
            {orderedInvs.filter(o => o.order_text).slice(0, 5).map((o, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.25, mb: 0.5, background: C.ghost }}>
                <Label>{o.test_name} · {o.ordered_in_field}</Label>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, fontStyle: "italic" }) }}>
                  "{o.order_text}"
                </Typography>
              </Box>
            ))}
          </Box>
        )}
      </Section>

      <SectionDivider />

      {/* VA1B — Resulted investigations */}
      <Section title="VA1B · Resulted Investigations" icon={<ScienceRounded sx={{ fontSize: 14 }} />} count={resultedInvs.length}>
        <DataTable
          columns={[
            { key: "test",   label: "Test" },
            { key: "result", label: "Result" },
            { key: "unit",   label: "Unit" },
            { key: "date",   label: "Date" },
            { key: "status", label: "Status", color: v => v === "abnormal" || v === "critical" ? C.critical : C.ok },
          ]}
          rows={resultedInvs}
        />
      </Section>

      <SectionDivider />

      <Section title="Pending Investigations" icon={<TrackChangesRounded sx={{ fontSize: 14 }} />} count={pendingInvs.length} countColor={C.warn}>
        {pendingInvs.length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No pending investigations.</Typography>
          : pendingInvs.map((p, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.warnBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.warnBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>{p.test}</Typography>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.25 }) }}>
                  Ordered: {p.ordered_date || "unknown"} · {p.source_document}
                </Typography>
                {p.reason_pending && (
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.15, fontStyle: "italic" }) }}>
                    {p.reason_pending}
                  </Typography>
                )}
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Abnormal Values" icon={<WarningAmberRounded sx={{ fontSize: 14 }} />} count={abnormalVals.length} countColor={C.critical}>
        <DataTable
          columns={[
            { key: "test",                  label: "Test" },
            { key: "value",                 label: "Value" },
            { key: "flag",                  label: "Flag", color: () => C.critical },
            { key: "management_documented", label: "Managed", color: v => v === "Yes" ? C.ok : C.critical },
          ]}
          rows={(abnormalVals).map(r => ({ ...r, management_documented: r.management_documented ? "Yes" : "No" }))}
        />
      </Section>

      <SectionDivider />

      <Section title="Investigation Trends" icon={<TimelineRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        {trends.length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No serial trends documented.</Typography>
          : trends.map((t, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.white }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{t.test}</Typography>
                  <StatusBadge value={t.direction} />
                </Box>
                <BulletList items={(t.data_points || []).map(d => `${d.date}: ${d.value} ${d.unit || ""}`)} color={C.smoke} />
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Findings Comparison" icon={<CompareArrowsRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "parameter",      label: "Parameter" },
            { key: "earliest_value", label: "Earliest" },
            { key: "latest_value",   label: "Latest" },
            { key: "change",         label: "Change" },
          ]}
          rows={comparison}
        />
      </Section>

      <SectionDivider />

      <Section title="Active Concerns" icon={<PriorityHighRounded sx={{ fontSize: 14 }} />} countColor={C.critical}>
        <BulletList items={(concerns).map(c => c.concern)} emptyText="No active evidence-based concerns." color={C.warn} />
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={issues.length} countColor={C.critical}>
        {issues.length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : issues.map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA2 — Medication Tab (enhanced: BPMH gap)
// ═══════════════════════════════════════════════════════════════
const VA2Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  const bpmh = report.bpmh_gap_noted || {};
  return (
    <Box>
      {/* BPMH gap card */}
      <Box sx={{
        border: `1px solid ${bpmh.bpmh_documented ? C.okBorder : C.warnBorder}`,
        borderRadius: "3px", p: 1.5, mb: 2,
        background: bpmh.bpmh_documented ? C.okBg : C.warnBg,
        display: "flex", gap: 1.5, alignItems: "flex-start",
      }}>
        <PersonRounded sx={{ fontSize: 16, color: bpmh.bpmh_documented ? C.ok : C.warn, flexShrink: 0 }} />
        <Box sx={{ flex: 1 }}>
          <Label sx={{ color: bpmh.bpmh_documented ? C.ok : C.warn }}>Best Possible Medication History (BPMH)</Label>
          <Typography sx={{ ...os({ fontSize: 11, color: bpmh.bpmh_documented ? C.ok : C.warn }) }}>
            {bpmh.bpmh_documented ? "✓ Documented" : "✗ Not documented — reconciliation gap"}
          </Typography>
          {bpmh.gap_note && (
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.25, lineHeight: 1.5 }) }}>{bpmh.gap_note}</Typography>
          )}
          {bpmh.bpmh_source && bpmh.bpmh_documented && (
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>Source: {bpmh.bpmh_source}</Typography>
          )}
        </Box>
        <Box sx={{ px: 1, py: 0.25, borderRadius: "2px", background: bpmh.chronic_medications_identifiable ? C.okBorder : C.warnBorder }}>
          <Typography sx={{ ...os({ fontSize: 9, color: bpmh.chronic_medications_identifiable ? C.ok : C.warn, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
            Chronic Meds {bpmh.chronic_medications_identifiable ? "Identifiable" : "Unknown"}
          </Typography>
        </Box>
      </Box>

      <Section title="Documented Medications" icon={<MedicationRounded sx={{ fontSize: 14 }} />} count={report.documented_medications?.length}>
        <DataTable
          columns={[
            { key: "drug",            label: "Drug" },
            { key: "dose",            label: "Dose" },
            { key: "route",           label: "Route" },
            { key: "frequency",       label: "Frequency" },
            { key: "first_seen_date", label: "First Seen" },
          ]}
          rows={report.documented_medications}
        />
      </Section>

      <SectionDivider />

      <Section title="High-Risk Medications" icon={<WarningAmberRounded sx={{ fontSize: 14 }} />} count={report.high_risk_medications_documented?.length} countColor={C.warn} defaultOpen>
        {(!report.high_risk_medications_documented || report.high_risk_medications_documented.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>None identified.</Typography>
          : report.high_risk_medications_documented.map((m, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.warnBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.warnBg }}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>{m.drug}</Typography>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.warn }) }}>{m.risk_class}</Typography>
                </Box>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>
                  Monitoring: {m.monitoring_documented ? "✓ Documented" : "✗ Not documented"}
                  &nbsp;·&nbsp;Discharge instruction: {m.discharge_instruction_present ? "✓" : "✗"}
                </Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Medications Stopped" icon={<FiberManualRecordRounded sx={{ fontSize: 13 }} />} count={report.medications_stopped?.length} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "drug",                 label: "Drug" },
            { key: "last_documented_date", label: "Last Seen" },
            { key: "reason_for_stopping",  label: "Reason" },
          ]}
          rows={report.medications_stopped}
          emptyText="No medications identified as stopped."
        />
      </Section>

      <SectionDivider />

      <Section title="Dose Changes" icon={<CompareArrowsRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "drug",             label: "Drug" },
            { key: "change_from",      label: "From" },
            { key: "change_to",        label: "To" },
            { key: "date_of_change",   label: "Date" },
            { key: "reason_documented",label: "Reason", color: v => v === "Yes" ? C.ok : C.warn },
          ]}
          rows={(report.dose_changes || []).map(r => ({ ...r, reason_documented: r.reason_documented ? "Yes" : "No" }))}
          emptyText="No dose changes documented."
        />
      </Section>

      <SectionDivider />

      <Section title="IV → Oral Switch" icon={<TrackChangesRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "drug",      label: "Drug" },
            { key: "iv_date",   label: "IV Date" },
            { key: "oral_date", label: "Oral Date" },
          ]}
          rows={report.iv_to_oral_switch}
          emptyText="No IV-to-oral switches documented."
        />
      </Section>

      <SectionDivider />

      <Section title="PRN Medications" icon={<MedicationRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "drug",                label: "Drug" },
            { key: "indication",          label: "Indication" },
            { key: "max_dose_documented", label: "Max Dose", color: v => v === "Yes" ? C.ok : C.warn },
          ]}
          rows={(report.prn_medications || []).map(r => ({ ...r, max_dose_documented: r.max_dose_documented ? "Yes" : "No" }))}
          emptyText="No PRN medications documented."
        />
      </Section>

      <SectionDivider />

      <Section title="Medication Trends" icon={<TimelineRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        {(!report.medication_trends || report.medication_trends.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No trend data.</Typography>
          : report.medication_trends.map((t, i) => (
              <Typography key={i} sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.7, mb: 0.5 }) }}>
                {t.summary || JSON.stringify(t)}
              </Typography>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA3 — Procedure Tab
// ═══════════════════════════════════════════════════════════════
const VA3Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  return (
    <Box>
      <Section title="Procedures Classified" icon={<AssignmentRounded sx={{ fontSize: 14 }} />} count={report.procedures_classified?.length}>
        <DataTable
          columns={[
            { key: "name",           label: "Procedure" },
            { key: "classification", label: "Type" },
            { key: "date",           label: "Date" },
            { key: "source_document",label: "Source" },
          ]}
          rows={report.procedures_classified}
        />
      </Section>

      <SectionDivider />

      <Section title="Surgical Documentation Audit" icon={<LocalHospitalRounded sx={{ fontSize: 14 }} />}>
        {(!report.surgical_documentation_audit || report.surgical_documentation_audit.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No surgical procedures to audit.</Typography>
          : report.surgical_documentation_audit.map((p, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.white }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.ink, mb: 0.75 }) }}>{p.procedure} · {p.date}</Typography>
                {[
                  { label: "Pre-op Assessment",   val: p.pre_op_assessment_documented },
                  { label: "Operative Note",       val: p.operative_note_documented },
                  { label: "Post-op Monitoring",   val: p.post_op_monitoring_documented },
                ].map(({ label, val }) => (
                  <Box key={label} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.4 }}>
                    {val
                      ? <CheckCircleRounded sx={{ fontSize: 13, color: C.ok }} />
                      : <CancelRounded sx={{ fontSize: 13, color: C.critical }} />
                    }
                    <Typography sx={{ ...os({ fontSize: 11, color: val ? C.ok : C.critical }) }}>{label}</Typography>
                  </Box>
                ))}
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Specimens Tracking" icon={<ScienceRounded sx={{ fontSize: 14 }} />}>
        <DataTable
          columns={[
            { key: "specimen_type",               label: "Specimen" },
            { key: "sent_from_procedure",         label: "From" },
            { key: "histopath_result_documented", label: "Result In", color: v => v === "Yes" ? C.ok : C.warn },
            { key: "result",                      label: "Findings" },
          ]}
          rows={(report.specimens_tracking || []).map(r => ({
            ...r,
            histopath_result_documented: r.histopath_result_documented ? "Yes" : "No",
          }))}
          emptyText="No specimens tracked."
        />
      </Section>

      <SectionDivider />

      <Section title="Complications Documented" icon={<WarningAmberRounded sx={{ fontSize: 14 }} />} countColor={C.critical}>
        {(!report.complications_documented || report.complications_documented.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No complications documented.</Typography>
          : report.complications_documented.map((c, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.criticalBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.criticalBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.critical }) }}>{c.complication}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>
                  Managed: {c.management_documented ? "✓" : "✗"} · {c.date}
                </Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Imaging Results Summary" icon={<ScienceRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "study",       label: "Study" },
            { key: "key_finding", label: "Key Finding" },
            { key: "date",        label: "Date" },
          ]}
          rows={report.imaging_results_summary}
          emptyText="No imaging results."
        />
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA4 — Consistency Tab
// ═══════════════════════════════════════════════════════════════
const VA4Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  return (
    <Box>
      <Section title="Diagnoses Accuracy" icon={<LocalHospitalRounded sx={{ fontSize: 14 }} />} count={report.diagnoses_accuracy?.length}>
        {(!report.diagnoses_accuracy || report.diagnoses_accuracy.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No diagnoses assessed.</Typography>
          : report.diagnoses_accuracy.map((d, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "flex-start", gap: 1.5, border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: d.supported_by_timeline ? C.okBg : C.criticalBg }}>
                {d.supported_by_timeline
                  ? <CheckCircleRounded sx={{ fontSize: 14, color: C.ok, mt: 0.15 }} />
                  : <CancelRounded sx={{ fontSize: 14, color: C.critical, mt: 0.15 }} />
                }
                <Box>
                  <Typography sx={{ ...os({ fontSize: 12, color: d.supported_by_timeline ? C.ok : C.critical }) }}>{d.diagnosis}</Typography>
                  {!d.supported_by_timeline && (
                    <Typography sx={{ ...os({ fontSize: 11, color: C.critical, mt: 0.25 }) }}>Not supported by timeline</Typography>
                  )}
                </Box>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Factual Errors" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.factual_errors?.length} countColor={C.critical}>
        {(!report.factual_errors || report.factual_errors.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No factual errors identified.</Typography>
          : report.factual_errors.map((e, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.criticalBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.criticalBg }}>
                <Label sx={{ color: C.critical }}>{e.field}</Label>
                <Typography sx={{ ...os({ fontSize: 11, color: C.critical }) }}>Summary states: "{e.discharge_summary_states}"</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ink, mt: 0.35 }) }}>Timeline shows: "{e.timeline_shows}"</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Events Missing from Summary" icon={<WarningAmberRounded sx={{ fontSize: 14 }} />} count={report.documented_events_missing_from_summary?.length} countColor={C.warn} defaultOpen>
        {(!report.documented_events_missing_from_summary || report.documented_events_missing_from_summary.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No missing events identified.</Typography>
          : report.documented_events_missing_from_summary.map((ev, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.warnBorder}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: C.warnBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>{ev.event}</Typography>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.25 }) }}>{ev.source_document} · {ev.date}</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Nursing Observations" icon={<FiberManualRecordRounded sx={{ fontSize: 13 }} />} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "observation",      label: "Observation" },
            { key: "in_discharge_summary", label: "In Summary", color: v => v === "Yes" ? C.ok : C.warn },
            { key: "date",             label: "Date" },
          ]}
          rows={(report.nursing_observations_captured || []).map(o => ({
            ...o,
            in_discharge_summary: o.in_discharge_summary ? "Yes" : "No",
          }))}
          emptyText="No nursing observations extracted."
        />
      </Section>

      <SectionDivider />

      <Section title="Positive Findings" icon={<CheckCircleRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        <BulletList items={report.positive_findings} emptyText="No positive findings noted." color={C.ok} />
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA5 — Readiness Tab (enhanced: social domain)
// ═══════════════════════════════════════════════════════════════
const VA5Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  const verdict  = report.discharge_appropriateness || {};
  const stability = report.clinical_stability_score || {};
  const social   = report.social_environment_domain || {};
  const verdictColor =
    verdict.verdict === "Appropriate" ? C.ok :
    verdict.verdict === "Premature"   ? C.critical : C.ash;

  const socialColor =
    social.social_domain_score === "GREEN" ? C.ok :
    social.social_domain_score === "AMBER" ? C.warn :
    social.social_domain_score === "RED"   ? C.critical : C.ash;

  return (
    <Box>
      {/* Verdict card */}
      <Box sx={{
        border: `1px solid ${verdictColor === C.ok ? C.okBorder : verdictColor === C.critical ? C.criticalBorder : C.fog}`,
        borderRadius: "4px", p: 2, mb: 2,
        background: verdictColor === C.ok ? C.okBg : verdictColor === C.critical ? C.criticalBg : C.ghost,
        display: "flex", gap: 1.5, alignItems: "flex-start",
      }}>
        {verdictColor === C.ok
          ? <CheckCircleRounded sx={{ fontSize: 20, color: C.ok, flexShrink: 0 }} />
          : <WarningAmberRounded sx={{ fontSize: 20, color: verdictColor, flexShrink: 0 }} />
        }
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: verdictColor }) }}>
            Discharge: {verdict.verdict || "Cannot determine"}
          </Typography>
          {verdict.rationale && (
            <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mt: 0.5, lineHeight: 1.5 }) }}>{verdict.rationale}</Typography>
          )}
          {stability.score !== undefined && (
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}>
              Clinical Stability Score: {stability.score}/10 · {stability.basis}
            </Typography>
          )}
          {verdict.evidence_count !== undefined && (
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>
              Evidence sources used: {verdict.evidence_count}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Social environment domain */}
      <Box sx={{
        border: `1px solid ${social.social_domain_score ? (socialColor === C.ok ? C.okBorder : socialColor === C.warn ? C.warnBorder : C.criticalBorder) : C.fog}`,
        borderRadius: "3px", p: 1.5, mb: 2,
        background: social.social_domain_score ? (socialColor === C.ok ? C.okBg : socialColor === C.warn ? C.warnBg : C.criticalBg) : C.ghost,
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <HomeRounded sx={{ fontSize: 15, color: socialColor || C.ash }} />
          <Label sx={{ mb: 0, color: socialColor || C.ash }}>Social Environment Domain</Label>
          {social.social_domain_score && <StatusBadge value={social.social_domain_score} />}
        </Box>
        {[
          { label: "Home Environment Assessed", val: social.home_environment_assessed, evidence: social.home_environment_evidence },
          { label: "Family / Carer Support",    val: social.family_carer_support_confirmed, evidence: social.family_carer_evidence },
          { label: "Equipment Arranged",        val: social.equipment_arranged, evidence: social.equipment_evidence },
          { label: "Social Worker Involved",    val: social.social_worker_involved, evidence: social.social_worker_evidence },
          { label: "Community Nursing",         val: social.community_nursing_arranged, evidence: social.community_nursing_evidence },
        ].map(({ label, val, evidence }) => (
          <Box key={label} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            {val
              ? <CheckCircleRounded sx={{ fontSize: 12, color: C.ok }} />
              : <CancelRounded sx={{ fontSize: 12, color: val === false ? C.warn : C.mist }} />
            }
            <Typography sx={{ ...os({ fontSize: 11, color: val ? C.ok : C.ash }) }}>{label}</Typography>
            {evidence && evidence !== "not_documented" && (
              <Typography sx={{ ...os({ fontSize: 10, color: C.silver, fontStyle: "italic", ml: 0.5 }) }}>— {evidence}</Typography>
            )}
          </Box>
        ))}
        {social.social_domain_note && (
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.75, fontStyle: "italic" }) }}>
            {social.social_domain_note}
          </Typography>
        )}
      </Box>

      <Section title="Vitals Near Discharge" icon={<LocalHospitalRounded sx={{ fontSize: 14 }} />}>
        <DataTable
          columns={[
            { key: "parameter",          label: "Parameter" },
            { key: "value",              label: "Value" },
            { key: "unit",               label: "Unit" },
            { key: "within_normal_range",label: "Normal", color: v => v === "Yes" ? C.ok : C.critical },
            { key: "date",               label: "Date" },
          ]}
          rows={(report.vital_signs_documented_near_discharge || []).map(r => ({
            ...r,
            within_normal_range: r.within_normal_range ? "Yes" : "No",
          }))}
          emptyText="No vitals documented near discharge."
        />
      </Section>

      <SectionDivider />

      <Section title="Lab Values Near Discharge" icon={<ScienceRounded sx={{ fontSize: 14 }} />}>
        <DataTable
          columns={[
            { key: "test",   label: "Test" },
            { key: "value",  label: "Value" },
            { key: "unit",   label: "Unit" },
            { key: "status", label: "Status", color: v => v === "normal" ? C.ok : v === "critical" ? C.critical : C.warn },
            { key: "date",   label: "Date" },
          ]}
          rows={report.lab_values_documented_near_discharge}
          emptyText="No lab values documented near discharge."
        />
      </Section>

      <SectionDivider />

      <Section title="Symptom Control" icon={<CheckCircleRounded sx={{ fontSize: 14 }} />} defaultOpen>
        {(!report.symptom_control_evidence || report.symptom_control_evidence.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>Not documented.</Typography>
          : report.symptom_control_evidence.map((s, i) => (
              <Box key={i} sx={{ display: "flex", gap: 1, alignItems: "flex-start", mb: 0.75 }}>
                {s.controlled
                  ? <CheckCircleRounded sx={{ fontSize: 14, color: C.ok, mt: 0.2 }} />
                  : <CancelRounded sx={{ fontSize: 14, color: C.warn, mt: 0.2 }} />
                }
                <Box>
                  <Typography sx={{ ...os({ fontSize: 12, color: s.controlled ? C.ok : C.warn }) }}>{s.symptom}</Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{s.evidence}</Typography>
                </Box>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Devices Documented" icon={<AssignmentRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "device", label: "Device" },
            { key: "status", label: "Status" },
            { key: "date",   label: "Date" },
          ]}
          rows={report.devices_documented}
          emptyText="No device entries documented."
        />
      </Section>

      <SectionDivider />

      <Section title="Mobility Status" icon={<RecommendRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        {!report.mobility_status_documented || !report.mobility_status_documented.documented
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>Mobility not documented.</Typography>
          : (
              <Box sx={{ border: `1px solid ${C.okBorder}`, borderRadius: "3px", p: 1.5, background: C.okBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.ok }) }}>{report.mobility_status_documented.status}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>{report.mobility_status_documented.evidence}</Typography>
              </Box>
            )
        }
      </Section>

      <SectionDivider />

      <Section title="Deterioration Events" icon={<ErrorRounded sx={{ fontSize: 14 }} />} countColor={C.critical} defaultOpen>
        {(!report.deterioration_events_documented || report.deterioration_events_documented.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No deterioration events documented.</Typography>
          : report.deterioration_events_documented.map((ev, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.criticalBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.criticalBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.critical }) }}>{ev.event}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>{ev.date} · {ev.source_document}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: ev.management_documented ? C.ok : C.critical, mt: 0.25 }) }}>
                  Management: {ev.management_documented ? ev.management_evidence : "✗ Not documented"}
                </Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA6 — Follow-Up Tab
// ═══════════════════════════════════════════════════════════════
const VA6Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  const edu  = report.patient_education_documented || {};
  const redf = report.red_flag_symptoms_documented || {};
  return (
    <Box>
      <Section title="Documented Follow-Up Plans" icon={<RecommendRounded sx={{ fontSize: 14 }} />} count={report.documented_followup_plans?.length}>
        {(!report.documented_followup_plans || report.documented_followup_plans.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No follow-up plans documented.</Typography>
          : report.documented_followup_plans.map((p, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.okBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.okBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.ok }) }}>{p.specialty_or_service}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.25 }) }}>{p.purpose} · {p.timeframe}</Typography>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.25 }) }}>{p.source_document} · {p.date}</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Guideline-Required Follow-Up" icon={<AssignmentRounded sx={{ fontSize: 14 }} />}>
        <DataTable
          columns={[
            { key: "diagnosis",            label: "Diagnosis" },
            { key: "required_followup",    label: "Required Follow-Up" },
            { key: "guideline",            label: "Guideline" },
            { key: "documented_in_timeline",label: "Documented", color: v => v === "Yes" ? C.ok : C.warn },
          ]}
          rows={(report.guideline_required_followup_for_confirmed_diagnoses || []).map(r => ({
            ...r,
            documented_in_timeline: r.documented_in_timeline ? "Yes" : "No",
          }))}
          emptyText="No guideline follow-up requirements identified."
        />
      </Section>

      <SectionDivider />

      <Section title="Pending Investigations for Review" icon={<TrackChangesRounded sx={{ fontSize: 14 }} />} countColor={C.warn}>
        {(!report.pending_investigations_requiring_review || report.pending_investigations_requiring_review.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>None.</Typography>
          : report.pending_investigations_requiring_review.map((p, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.warnBorder}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: C.warnBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>{p.test}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>{p.action_required}</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Missing Critical Follow-Up" icon={<WarningAmberRounded sx={{ fontSize: 14 }} />} countColor={C.critical}>
        {(!report.missing_critical_followup || report.missing_critical_followup.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No missing critical follow-up identified.</Typography>
          : report.missing_critical_followup.map((m, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.criticalBorder}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: C.criticalBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.critical }) }}>{m.followup}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>{m.reason_required} · {m.diagnosis}</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5, mb: 2 }}>
        <Box sx={{ border: `1px solid ${edu.documented ? C.okBorder : C.warnBorder}`, borderRadius: "3px", p: 1.5, background: edu.documented ? C.okBg : C.warnBg }}>
          <Label>Patient Education</Label>
          {edu.documented
            ? <><CheckCircleRounded sx={{ fontSize: 13, color: C.ok }} /><Typography sx={{ ...os({ fontSize: 11, color: C.ok, display: "inline", ml: 0.5 }) }}>Documented</Typography></>
            : <Typography sx={{ ...os({ fontSize: 11, color: C.warn }) }}>✗ Not documented</Typography>
          }
          {edu.topics_covered?.length > 0 && <BulletList items={edu.topics_covered} color={C.ok} />}
        </Box>
        <Box sx={{ border: `1px solid ${redf.documented ? C.okBorder : C.warnBorder}`, borderRadius: "3px", p: 1.5, background: redf.documented ? C.okBg : C.warnBg }}>
          <Label>Red Flag Symptoms</Label>
          {redf.documented
            ? <><CheckCircleRounded sx={{ fontSize: 13, color: C.ok }} /><Typography sx={{ ...os({ fontSize: 11, color: C.ok, display: "inline", ml: 0.5 }) }}>Documented</Typography></>
            : <Typography sx={{ ...os({ fontSize: 11, color: C.warn }) }}>✗ Not documented</Typography>
          }
          {redf.symptoms_listed?.length > 0 && <BulletList items={redf.symptoms_listed} color={C.ok} />}
        </Box>
      </Box>

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA8 — Safety & Allergy Tab  (NEW)
// ═══════════════════════════════════════════════════════════════
const VA8Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  return (
    <Box>
      <Section title="Allergy Flags" icon={<SecurityRounded sx={{ fontSize: 14 }} />} count={report.allergy_flags?.length} countColor={C.critical} defaultOpen>
        {(!report.allergy_flags || report.allergy_flags.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No allergy concerns identified.</Typography>
          : report.allergy_flags.map((f, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.criticalBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.criticalBg }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.critical }) }}>{f.drug_or_substance || "Unknown substance"}</Typography>
                  <StatusBadge value={f.type?.replace(/_/g, " ")} />
                </Box>
                <InfoRow label="Reaction" value={f.reaction_documented} />
                <InfoRow label="Allergy Documented" value={f.allergy_documented_in_record ? "Yes" : "No"} valueColor={f.allergy_documented_in_record ? C.ok : C.critical} />
                {f.action_required && (
                  <Box sx={{ mt: 0.75, p: 0.75, background: C.warnBg, borderRadius: "2px", border: `1px solid ${C.warnBorder}` }}>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.warn }) }}>→ {f.action_required}</Typography>
                  </Box>
                )}
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.5 }) }}>{f.source_document} · {f.date}</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Drug Toxicity Flags" icon={<WarningAmberRounded sx={{ fontSize: 14 }} />} count={report.drug_toxicity_flags?.length} countColor={C.warn}>
        {(!report.drug_toxicity_flags || report.drug_toxicity_flags.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No drug toxicity concerns identified.</Typography>
          : report.drug_toxicity_flags.map((f, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.warnBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.warnBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>{f.drug}</Typography>
                <InfoRow label="Toxicity Indicator" value={f.toxicity_indicator} />
                <InfoRow label="Clinical Evidence" value={f.lab_or_clinical_evidence} />
                {f.recommendation && (
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ink, mt: 0.5 }) }}>→ {f.recommendation}</Typography>
                )}
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.5 }) }}>{f.source_document} · {f.date}</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Inappropriate Device Flags" icon={<TrackChangesRounded sx={{ fontSize: 14 }} />} count={report.inappropriate_device_flags?.length} countColor={C.warn}>
        {(!report.inappropriate_device_flags || report.inappropriate_device_flags.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No device concerns identified.</Typography>
          : report.inappropriate_device_flags.map((f, i) => {
              const flagColor = f.flag === "review_required" ? C.warn : f.flag === "within_guideline" ? C.ok : C.ash;
              return (
                <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.white }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{f.device}</Typography>
                    <StatusBadge value={f.flag?.replace(/_/g, " ")} />
                  </Box>
                  <InfoRow label="Insertion Date"   value={f.insertion_date} />
                  <InfoRow label="Days In Situ"     value={f.days_in_situ} />
                  <InfoRow label="Guideline Threshold" value={f.guideline_threshold} />
                  <InfoRow label="Last Review"      value={f.last_review_documented ? "Documented" : "Not documented"} valueColor={f.last_review_documented ? C.ok : C.warn} />
                </Box>
              );
            })
        }
      </Section>

      <SectionDivider />

      <Section title="Hospital-Acquired Conditions" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.hospital_acquired_conditions?.length} countColor={C.critical}>
        {(!report.hospital_acquired_conditions || report.hospital_acquired_conditions.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No hospital-acquired conditions documented.</Typography>
          : report.hospital_acquired_conditions.map((c, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.criticalBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.criticalBg }}>
                <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.critical }) }}>{c.condition?.replace(/_/g, " ")}</Typography>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash }) }}>{c.date_first_documented}</Typography>
                </Box>
                <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, fontStyle: "italic", mb: 0.5 }) }}>"{c.evidence}"</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: c.management_documented ? C.ok : C.critical }) }}>
                  Management: {c.management_documented ? c.management_evidence : "✗ Not documented"}
                </Typography>
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>{c.source_document}</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA9 — Coding & Billing Tab  (NEW)
// ═══════════════════════════════════════════════════════════════
const VA9Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  const drg = report.drg_band || {};
  return (
    <Box>
      {/* DRG summary card */}
      {drg.estimated_drg && (
        <Box sx={{ border: `1px solid ${C.blueBorder}`, borderRadius: "3px", p: 1.5, mb: 2, background: C.blueBg }}>
          <Label sx={{ color: C.blue }}>DRG Estimate</Label>
          <Typography sx={{ ...os({ fontSize: 13, color: C.blue, fontWeight: 400 }) }}>{drg.estimated_drg}</Typography>
          {drg.drg_note && <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.25 }) }}>{drg.drg_note}</Typography>}
          {drg.expected_los_band && (
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.25 }) }}>Expected LoS: {drg.expected_los_band}</Typography>
          )}
        </Box>
      )}

      <Section title="ICD-10 Codes" icon={<CodeRounded sx={{ fontSize: 14 }} />} count={report.suggested_icd10_codes?.length} defaultOpen>
        {(!report.suggested_icd10_codes || report.suggested_icd10_codes.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No codes suggested.</Typography>
          : report.suggested_icd10_codes.map((c, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: C.white }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
                  <Box sx={{ px: 1, py: 0.2, background: C.black, borderRadius: "2px" }}>
                    <Typography sx={{ ...os({ fontSize: 11, color: C.white, fontFamily: "monospace", letterSpacing: "0.05em" }) }}>
                      {c.code}
                    </Typography>
                  </Box>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ink, flex: 1 }) }}>{c.description}</Typography>
                  <StatusBadge value={c.code_type} />
                </Box>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, fontStyle: "italic" }) }}>"{c.evidence}"</Typography>
                <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>
                  {c.source_document} · POI: {c.poi_indicator}
                </Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Procedure Codes" icon={<AssignmentRounded sx={{ fontSize: 14 }} />} count={report.suggested_procedure_codes?.length} defaultOpen={false}>
        <DataTable
          columns={[
            { key: "code",        label: "Code" },
            { key: "description", label: "Description" },
            { key: "procedure",   label: "Procedure" },
            { key: "date",        label: "Date" },
          ]}
          rows={report.suggested_procedure_codes}
          emptyText="No procedure codes suggested."
        />
      </Section>

      <SectionDivider />

      <Section title="CC / MCC Captured" icon={<PriorityHighRounded sx={{ fontSize: 14 }} />} count={report.cc_mcc_captured?.length} defaultOpen>
        {(!report.cc_mcc_captured || report.cc_mcc_captured.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No CC/MCC identified.</Typography>
          : report.cc_mcc_captured.map((c, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.warnBorder}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: C.warnBg }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.25 }}>
                  <Box sx={{ px: 0.75, py: 0.1, background: C.warn, borderRadius: "2px" }}>
                    <Typography sx={{ ...os({ fontSize: 9, color: C.white, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>{c.cc_or_mcc}</Typography>
                  </Box>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.warn }) }}>{c.condition}</Typography>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.ash, fontFamily: "monospace" }) }}>{c.icd10_code}</Typography>
                </Box>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, fontStyle: "italic" }) }}>"{c.evidence}"</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="HAC Exclusion Review" icon={<BlockRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        {(!report.hac_exclusion_review || report.hac_exclusion_review.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No HAC review items.</Typography>
          : report.hac_exclusion_review.map((h, i) => (
              <Box key={i} sx={{ border: `1px solid ${h.hac_flag ? C.criticalBorder : C.fog}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: h.hac_flag ? C.criticalBg : C.white }}>
                <Box sx={{ display: "flex", justifyContent: "space-between" }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: h.hac_flag ? C.critical : C.ink }) }}>{h.condition}</Typography>
                  <StatusBadge value={`POI: ${h.poi_indicator}`} />
                </Box>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.25, fontStyle: "italic" }) }}>{h.poi_evidence}</Typography>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="CDI Physician Queries" icon={<InfoRounded sx={{ fontSize: 14 }} />} count={report.cdi_queries?.length} countColor={C.blue} defaultOpen>
        {(!report.cdi_queries || report.cdi_queries.length === 0)
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No CDI queries identified.</Typography>
          : report.cdi_queries.map((q, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.blueBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.blueBg }}>
                <Label sx={{ color: C.blue }}>{q.query_type}</Label>
                <Typography sx={{ ...os({ fontSize: 12, color: C.blue }) }}>{q.question}</Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mt: 0.25 }) }}>{q.reason}</Typography>
                <Box sx={{ mt: 0.5, px: 0.75, py: 0.2, background: C.blueBorder, borderRadius: "2px", display: "inline-block" }}>
                  <Typography sx={{ ...os({ fontSize: 9, color: C.blue, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
                    Impact: {q.impact}
                  </Typography>
                </Box>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA10 — Insurance Documents Tab  (NEW)
// ═══════════════════════════════════════════════════════════════
const VA10Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  const preauth  = report.preauth_summary || {};
  const medLetter = report.medical_necessity_letter || {};
  const payerFmt = report.discharge_summary_payer_format || {};
  const claims   = report.claims_package_elements || {};
  const losItems = report.los_justification || [];
  const claimsReady = claims.claims_readiness;

  return (
    <Box>
      {/* Claims readiness banner */}
      <Box sx={{
        border: `1px solid ${claimsReady === "ready" ? C.okBorder : claimsReady === "incomplete" ? C.warnBorder : C.fog}`,
        borderRadius: "3px", p: 1.5, mb: 2,
        background: claimsReady === "ready" ? C.okBg : claimsReady === "incomplete" ? C.warnBg : C.ghost,
        display: "flex", alignItems: "center", gap: 1.5,
      }}>
        <DescriptionRounded sx={{ fontSize: 16, color: claimsReady === "ready" ? C.ok : C.warn, flexShrink: 0 }} />
        <Box sx={{ flex: 1 }}>
          <Label sx={{ color: claimsReady === "ready" ? C.ok : C.warn }}>Claims Package Status</Label>
          <StatusBadge value={claimsReady} />
        </Box>
        {claims.missing_elements?.length > 0 && (
          <Box>
            <Label>Missing</Label>
            <BulletList items={claims.missing_elements} color={C.warn} />
          </Box>
        )}
      </Box>

      <Section title="Pre-Auth Summary" icon={<AssignmentRounded sx={{ fontSize: 14 }} />} defaultOpen>
        {!preauth.admission_justification
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>Not available.</Typography>
          : (
              <Box>
                <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.white }}>
                  <Label>Admission Justification</Label>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, lineHeight: 1.6 }) }}>{preauth.admission_justification}</Typography>
                </Box>
                <InfoRow label="Principal Procedure" value={preauth.principal_procedure} />
                <InfoRow label="Clinical Urgency" value={preauth.clinical_urgency} />
                {preauth.supporting_evidence?.length > 0 && (
                  <Box sx={{ mt: 0.75 }}>
                    <Label>Supporting Evidence</Label>
                    <BulletList items={preauth.supporting_evidence} color={C.charcoal} />
                  </Box>
                )}
              </Box>
            )
        }
      </Section>

      <SectionDivider />

      <Section title="Length of Stay Justification" icon={<TimelineRounded sx={{ fontSize: 14 }} />} count={losItems.length} defaultOpen={false}>
        {losItems.length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No LoS justification available.</Typography>
          : losItems.map((d, i) => (
              <Box key={i} sx={{ display: "flex", gap: 0, mb: 0 }}>
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mr: 2, flexShrink: 0 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: C.blue, mt: 1.5, flexShrink: 0, border: `2px solid ${C.white}`, boxShadow: `0 0 0 1px ${C.blueBorder}` }} />
                  <Box sx={{ flex: 1, width: 1, background: C.fog, mt: 0.5 }} />
                </Box>
                <Box sx={{ flex: 1, pb: 1.5 }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.blue }) }}>{d.day}</Typography>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ink, mt: 0.15 }) }}>{d.rationale}</Typography>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.15, fontStyle: "italic" }) }}>"{d.evidence}"</Typography>
                </Box>
              </Box>
            ))
        }
      </Section>

      <SectionDivider />

      <Section title="Medical Necessity Letter" icon={<DescriptionRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        {!medLetter.patient_summary
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>Not available.</Typography>
          : (
              <Box>
                {[
                  { label: "Patient Summary",     val: medLetter.patient_summary },
                  { label: "Diagnosis",           val: medLetter.diagnosis },
                  { label: "Treatment Provided",  val: medLetter.treatment_provided },
                  { label: "Clinical Necessity",  val: medLetter.clinical_necessity },
                  { label: "Outcome",             val: medLetter.outcome },
                ].map(({ label, val }) => (
                  <Box key={label} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: C.white }}>
                    <Label>{label}</Label>
                    <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, lineHeight: 1.55 }) }}>{val || "—"}</Typography>
                  </Box>
                ))}
                {medLetter.physician_statement_note && (
                  <Box sx={{ p: 1, background: C.warnBg, borderRadius: "2px", border: `1px solid ${C.warnBorder}` }}>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.warn }) }}>⚠ {medLetter.physician_statement_note}</Typography>
                  </Box>
                )}
              </Box>
            )
        }
      </Section>

      <SectionDivider />

      <Section title="Payer-Format Summary" icon={<DescriptionRounded sx={{ fontSize: 14 }} />} defaultOpen={false}>
        {!payerFmt.reason_for_admission
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>Not available.</Typography>
          : (
              <Box>
                <InfoRow label="Reason for Admission" value={payerFmt.reason_for_admission} />
                <InfoRow label="Discharge Condition"  value={payerFmt.discharge_condition} />
                <InfoRow label="Follow-up Plan"       value={payerFmt.followup_plan} />
                {payerFmt.final_diagnoses?.length > 0 && (
                  <>
                    <Label sx={{ mt: 0.75 }}>Final Diagnoses</Label>
                    <BulletList items={payerFmt.final_diagnoses} color={C.charcoal} />
                  </>
                )}
                {payerFmt.procedures_performed?.length > 0 && (
                  <>
                    <Label sx={{ mt: 0.75 }}>Procedures Performed</Label>
                    <BulletList items={payerFmt.procedures_performed} color={C.charcoal} />
                  </>
                )}
                {payerFmt.discharge_medications?.length > 0 && (
                  <>
                    <Label sx={{ mt: 0.75 }}>Discharge Medications</Label>
                    <BulletList items={payerFmt.discharge_medications} color={C.charcoal} />
                  </>
                )}
                {payerFmt.pending_results?.length > 0 && (
                  <>
                    <Label sx={{ mt: 0.75 }}>Pending Results</Label>
                    <BulletList items={payerFmt.pending_results} color={C.warn} />
                  </>
                )}
              </Box>
            )
        }
      </Section>

      <SectionDivider />

      <Section title="Claims Package Checklist" icon={<CheckCircleRounded sx={{ fontSize: 14 }} />} defaultOpen>
        {[
          { label: "Patient Demographics",  val: claims.patient_demographics_available },
          { label: "ICD-10 Codes",          val: claims.icd10_codes_available },
          { label: "Procedure Codes",        val: claims.procedure_codes_available },
          { label: "Discharge Summary",      val: claims.discharge_summary_available },
          { label: "Operative Notes",        val: claims.operative_notes_available },
          { label: "Lab Reports",            val: claims.lab_reports_available },
          { label: "Imaging Reports",        val: claims.imaging_reports_available },
        ].map(({ label, val }) => (
          <Box key={label} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}>
            {val === true
              ? <CheckCircleRounded sx={{ fontSize: 13, color: C.ok }} />
              : val === false
              ? <CancelRounded sx={{ fontSize: 13, color: C.critical }} />
              : <FiberManualRecordRounded sx={{ fontSize: 11, color: C.mist }} />
            }
            <Typography sx={{ ...os({ fontSize: 11, color: val === true ? C.ok : val === false ? C.critical : C.ash }) }}>
              {label}
            </Typography>
          </Box>
        ))}
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// VA11 — Post-Discharge Monitoring Tab  (NEW)
// ═══════════════════════════════════════════════════════════════
const QuestionList = ({ questions, emptyText }) => {
  const [open, setOpen] = useState(null);
  if (!questions || questions.length === 0)
    return <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>{emptyText}</Typography>;
  return (
    <Box>
      {questions.map((q, i) => (
        <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "3px", mb: 0.75, overflow: "hidden" }}>
          <Box
            onClick={() => setOpen(open === i ? null : i)}
            sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", px: 1.5, py: 1, cursor: "pointer", background: open === i ? C.ghost : C.white }}
          >
            <Box sx={{ display: "flex", gap: 1, flex: 1, alignItems: "flex-start" }}>
              <Box sx={{ width: 18, height: 18, borderRadius: "50%", background: C.black, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, mt: 0.1 }}>
                <Typography sx={{ ...os({ fontSize: 9, color: C.white, fontWeight: 500 }) }}>{i + 1}</Typography>
              </Box>
              <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{q.question}</Typography>
            </Box>
            <IconButton size="small" sx={{ p: 0.25, color: C.ash }}>
              {open === i ? <ExpandLessRounded sx={{ fontSize: 14 }} /> : <ExpandMoreRounded sx={{ fontSize: 14 }} />}
            </IconButton>
          </Box>
          <Collapse in={open === i}>
            <Box sx={{ px: 1.5, pb: 1.25, borderTop: `1px solid ${C.fog}`, background: C.white }}>
              {q.rationale && (
                <Box sx={{ mt: 0.75 }}>
                  <Label>Rationale</Label>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal }) }}>{q.rationale}</Typography>
                </Box>
              )}
              {q.escalation_if && (
                <Box sx={{ mt: 0.75 }}>
                  <Label>Escalate If</Label>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.warn }) }}>{q.escalation_if}</Typography>
                </Box>
              )}
              {q.escalation_action && (
                <Box sx={{ mt: 0.5, px: 0.75, py: 0.35, background: C.criticalBg, borderRadius: "2px", border: `1px solid ${C.criticalBorder}`, display: "inline-block" }}>
                  <Typography sx={{ ...os({ fontSize: 9, color: C.critical, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
                    → {q.escalation_action}
                  </Typography>
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      ))}
    </Box>
  );
};

const VA11Panel = ({ report }) => {
  if (!report) return <Typography sx={os({ fontSize: 12, color: C.silver })}>No data.</Typography>;
  const risk = report.readmission_risk_indicators || {};
  const riskColor =
    risk.overall_risk_level === "High"   ? C.critical :
    risk.overall_risk_level === "Medium" ? C.warn : C.ok;
  const riskBg =
    risk.overall_risk_level === "High"   ? C.criticalBg :
    risk.overall_risk_level === "Medium" ? C.warnBg : C.okBg;
  const riskBorder =
    risk.overall_risk_level === "High"   ? C.criticalBorder :
    risk.overall_risk_level === "Medium" ? C.warnBorder : C.okBorder;

  return (
    <Box>
      {/* Readmission risk card */}
      {risk.overall_risk_level && (
        <Box sx={{ border: `1px solid ${riskBorder}`, borderRadius: "4px", p: 2, mb: 2, background: riskBg }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <MonitorHeartRounded sx={{ fontSize: 18, color: riskColor }} />
            <Typography sx={{ ...os({ fontSize: 14, color: riskColor }) }}>
              Readmission Risk: {risk.overall_risk_level}
            </Typography>
          </Box>
          {risk.risk_score_basis && (
            <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, mb: 0.75, lineHeight: 1.5 }) }}>{risk.risk_score_basis}</Typography>
          )}
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 1.5 }}>
            {risk.primary_risk_factors?.length > 0 && (
              <Box>
                <Label sx={{ color: C.critical }}>Risk Factors</Label>
                <BulletList items={risk.primary_risk_factors} color={riskColor} />
              </Box>
            )}
            {risk.protective_factors?.length > 0 && (
              <Box>
                <Label sx={{ color: C.ok }}>Protective Factors</Label>
                <BulletList items={risk.protective_factors} color={C.ok} />
              </Box>
            )}
          </Box>
          {risk.recommended_monitoring_level && (
            <Box sx={{ mt: 0.75, px: 1, py: 0.3, background: riskBorder, borderRadius: "2px", display: "inline-block" }}>
              <Typography sx={{ ...os({ fontSize: 9, color: riskColor, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
                Monitoring: {risk.recommended_monitoring_level}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* High-risk flags */}
      {(report.high_risk_flags || []).length > 0 && (
        <>
          <Section title="High-Risk Flags" icon={<PriorityHighRounded sx={{ fontSize: 14 }} />} count={report.high_risk_flags?.length} countColor={C.critical} defaultOpen>
            {report.high_risk_flags.map((f, i) => {
              const fc = f.risk_level === "High" ? C.critical : f.risk_level === "Medium" ? C.warn : C.ok;
              return (
                <Box key={i} sx={{ display: "flex", gap: 1.5, border: `1px solid ${C.fog}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: C.white }}>
                  <Box sx={{ px: 0.75, py: 0.2, background: fc, borderRadius: "2px", alignSelf: "flex-start", flexShrink: 0 }}>
                    <Typography sx={{ ...os({ fontSize: 9, color: C.white, textTransform: "uppercase", letterSpacing: "0.05em" }) }}>{f.risk_level}</Typography>
                  </Box>
                  <Box>
                    <Typography sx={{ ...os({ fontSize: 12, color: C.ink }) }}>{f.risk_factor}</Typography>
                    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.15 }) }}>{f.basis} · {f.monitoring_note}</Typography>
                  </Box>
                </Box>
              );
            })}
          </Section>
          <SectionDivider />
        </>
      )}

      {/* Escalation triggers */}
      {(report.escalation_triggers || []).length > 0 && (
        <>
          <Section title="Escalation Triggers" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.escalation_triggers?.length} countColor={C.critical} defaultOpen>
            {report.escalation_triggers.map((t, i) => (
              <Box key={i} sx={{ border: `1px solid ${C.criticalBorder}`, borderRadius: "3px", p: 1.25, mb: 0.75, background: C.criticalBg }}>
                <Typography sx={{ ...os({ fontSize: 12, color: C.critical }) }}>{t.trigger}</Typography>
                <Typography sx={{ ...os({ fontSize: 10, color: C.ash, mt: 0.25 }) }}>Related to: {t.related_to}</Typography>
                <Box sx={{ display: "flex", gap: 1, mt: 0.5 }}>
                  <Box sx={{ px: 0.75, py: 0.1, background: C.critical, borderRadius: "2px" }}>
                    <Typography sx={{ ...os({ fontSize: 9, color: C.white, textTransform: "uppercase", letterSpacing: "0.05em" }) }}>{t.action}</Typography>
                  </Box>
                  <Typography sx={{ ...os({ fontSize: 9, color: C.ash, alignSelf: "center" }) }}>{t.communication_channel}</Typography>
                </Box>
              </Box>
            ))}
          </Section>
          <SectionDivider />
        </>
      )}

      {/* Day-2/7/30 question sets */}
      <Section title="Day-2 Follow-Up Questions" icon={<RecommendRounded sx={{ fontSize: 14 }} />} count={report.day2_questions?.length} defaultOpen>
        <QuestionList questions={report.day2_questions} emptyText="No Day-2 questions generated." />
      </Section>

      <SectionDivider />

      <Section title="Day-7 Follow-Up Questions" icon={<RecommendRounded sx={{ fontSize: 14 }} />} count={report.day7_questions?.length} defaultOpen={false}>
        <QuestionList questions={report.day7_questions} emptyText="No Day-7 questions generated." />
      </Section>

      <SectionDivider />

      <Section title="Day-30 Survey Questions" icon={<RecommendRounded sx={{ fontSize: 14 }} />} count={report.day30_questions?.length} defaultOpen={false}>
        <QuestionList questions={report.day30_questions} emptyText="No Day-30 questions generated." />
      </Section>

      <SectionDivider />

      <Section title="Issues" icon={<ErrorRounded sx={{ fontSize: 14 }} />} count={report.issues?.length} countColor={C.critical}>
        {(report.issues || []).length === 0
          ? <Typography sx={{ ...os({ fontSize: 12, color: C.silver }), pl: 0.5 }}>No issues identified.</Typography>
          : (report.issues || []).map((iss, i) => <IssueCard key={i} issue={iss} />)
        }
      </Section>
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// AGENT TABS DEFINITION  (v4 — 10 tabs)
// ═══════════════════════════════════════════════════════════════
const AGENT_TABS = [
  { id: "VA1",  label: "Investigations", icon: <ScienceRounded sx={{ fontSize: 13 }} />,       panel: (r) => <VA1Panel  report={r} />, reportKey: "VA1_investigation" },
  { id: "VA2",  label: "Medications",    icon: <MedicationRounded sx={{ fontSize: 13 }} />,    panel: (r) => <VA2Panel  report={r} />, reportKey: "VA2_medication" },
  { id: "VA3",  label: "Procedures",     icon: <AssignmentRounded sx={{ fontSize: 13 }} />,    panel: (r) => <VA3Panel  report={r} />, reportKey: "VA3_procedure" },
  { id: "VA4",  label: "Consistency",    icon: <CompareArrowsRounded sx={{ fontSize: 13 }} />, panel: (r) => <VA4Panel  report={r} />, reportKey: "VA4_consistency" },
  { id: "VA5",  label: "Readiness",      icon: <LocalHospitalRounded sx={{ fontSize: 13 }} />, panel: (r) => <VA5Panel  report={r} />, reportKey: "VA5_readiness" },
  { id: "VA6",  label: "Follow-Up",      icon: <RecommendRounded sx={{ fontSize: 13 }} />,     panel: (r) => <VA6Panel  report={r} />, reportKey: "VA6_followup" },
  { id: "VA8",  label: "Safety",         icon: <SecurityRounded sx={{ fontSize: 13 }} />,      panel: (r) => <VA8Panel  report={r} />, reportKey: "VA8_safety_allergy" },
  { id: "VA9",  label: "Coding",         icon: <CodeRounded sx={{ fontSize: 13 }} />,          panel: (r) => <VA9Panel  report={r} />, reportKey: "VA9_coding_billing" },
  { id: "VA10", label: "Insurance",      icon: <DescriptionRounded sx={{ fontSize: 13 }} />,   panel: (r) => <VA10Panel report={r} />, reportKey: "VA10_insurance_documents" },
  { id: "VA11", label: "Post-DC",        icon: <MonitorHeartRounded sx={{ fontSize: 13 }} />,  panel: (r) => <VA11Panel report={r} />, reportKey: "VA11_post_discharge" },
];

// ═══════════════════════════════════════════════════════════════
// QUALITY GATE PANEL (P8)
// ═══════════════════════════════════════════════════════════════
const QualityGatePanel = ({ gate }) => {
  if (!gate) return null;
  const isBlocked = gate.hard_block_active;
  return (
    <Box sx={{
      border: `1px solid ${isBlocked ? C.criticalBorder : C.okBorder}`,
      borderRadius: "3px", p: 1.75, mb: 2,
      background: isBlocked ? C.criticalBg : C.okBg,
    }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
        {isBlocked
          ? <BlockRounded sx={{ fontSize: 15, color: C.critical }} />
          : <CheckCircleRounded sx={{ fontSize: 15, color: C.ok }} />
        }
        <Typography sx={{ ...os({ fontSize: 11, color: isBlocked ? C.critical : C.ok, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
          P8 Quality Gate — {isBlocked ? "Hard Block Active" : "Passed"}
        </Typography>
      </Box>
      {gate.blocks_triggered?.length > 0 && (
        <Box>
          {gate.blocks_triggered.map((b, i) => (
            <Box key={i} sx={{ display: "flex", gap: 0.75, mb: 0.4 }}>
              <CancelRounded sx={{ fontSize: 11, color: C.critical, mt: 0.2, flexShrink: 0 }} />
              <Typography sx={{ ...os({ fontSize: 11, color: C.critical }) }}>
                {b.replace(/_/g, " ")}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
      {gate.gate_notes && (
        <Typography sx={{ ...os({ fontSize: 10, color: isBlocked ? C.critical : C.ok, mt: 0.5, fontStyle: "italic" }) }}>
          {gate.gate_notes}
        </Typography>
      )}
    </Box>
  );
};

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════
export default function DischargeValidationPanel({ doctorId, patientId, specialty }) {
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState(null);
  const [data, setData]         = useState(null);
  const [mainTab, setMainTab]   = useState(0); // 0=Summary 1=Issues 2=Narrative 3=Agents
  const [agentTab, setAgentTab] = useState(0);

  const runValidation = useCallback(async () => {
    if (!doctorId || !patientId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/discharge-validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id:  doctorId,
          specialty:  specialty || "General Medicine",
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setData(await res.json());
    } catch (e) {
      setError(e.message || "Validation failed");
    } finally {
      setLoading(false);
    }
  }, [doctorId, patientId, specialty]);

  // ── Pre-run state ──────────────────────────────────────────────────────────
  if (!data && !loading && !error) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "flex-end" }}>
        <Tooltip title="Run evidence-based multi-agent audit of the discharge summary">
          <Box
            component="button"
            type="button"
            onClick={runValidation}
            sx={{
              display: "flex", alignItems: "center", gap: 1,
              px: 2.5, py: 1.1, borderRadius: "2px",
              fontSize: 12, fontFamily: FONT, fontWeight: 300, letterSpacing: "0.06em",
              background: C.black, color: C.white, border: `1px solid ${C.black}`,
              cursor: "pointer", transition: "all 0.15s",
              "&:hover": { background: C.charcoal },
            }}
          >
            <BiotechRounded sx={{ fontSize: 15 }} />
            Run Deep Agent Audit
          </Box>
        </Tooltip>
      </Box>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const approved    = data?.approved_for_clinical_use;
  const counts      = data?.issue_counts    || {};
  const scores      = data?.scores          || {};
  const catIssues   = data?.categorised_issues || { Critical: [], Major: [], Moderate: [], Minor: [] };
  const actions     = data?.priority_action_list || [];
  const narrative   = data?.disease_timeline_narrative || [];
  const comparison  = data?.findings_comparison_table || [];
  const agentReps   = data?.agent_reports   || {};
  const qGate       = data?.quality_gate_status;
  const activeCrit  = data?.active_critical_concerns || [];

  const MAIN_TABS = ["Summary", "Issues", "Narrative", "Agent Reports"];

  return (
    <Box sx={{ fontFamily: FONT, fontWeight: FW }}>

      {/* ── Topbar ──────────────────────────────────────────────────────────── */}
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 2.5, flexWrap: "wrap", gap: 1.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <BiotechRounded sx={{ fontSize: 16, color: C.ash }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>Deep Agent Audit</Typography>
          <Typography sx={{ ...os({ fontSize: 9, color: C.silver, mt: 0.2 }) }}>v4.0.0 · 11 agents</Typography>
          {data && !loading && (
            <Box sx={{
              display: "inline-flex", alignItems: "center", gap: 0.75,
              px: 1.25, py: 0.3, borderRadius: "2px",
              background: approved ? C.okBg : C.criticalBg,
              border: `1px solid ${approved ? C.okBorder : C.criticalBorder}`,
            }}>
              {approved
                ? <CheckCircleRounded sx={{ fontSize: 13, color: C.ok }} />
                : <CancelRounded sx={{ fontSize: 13, color: C.critical }} />
              }
              <Typography sx={{ ...os({ fontSize: 10, color: approved ? C.ok : C.critical, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
                {approved ? "Approved for clinical use" : "Requires review"}
              </Typography>
            </Box>
          )}
        </Box>
        <Tooltip title={data ? "Re-run audit" : "Run audit"}>
          <Box
            component="button"
            type="button"
            onClick={runValidation}
            disabled={loading}
            sx={{
              display: "flex", alignItems: "center", gap: 0.75,
              px: 2, py: 0.85, borderRadius: "2px",
              fontSize: 11, fontFamily: FONT, fontWeight: 300, letterSpacing: "0.05em",
              background: loading ? C.ghost : C.black,
              color: loading ? C.ash : C.white,
              border: `1px solid ${loading ? C.fog : C.black}`,
              cursor: loading ? "not-allowed" : "pointer",
              transition: "all 0.15s",
              "&:hover:not(:disabled)": { background: C.charcoal },
            }}
          >
            {loading ? <CircularProgress size={12} sx={{ color: C.ash }} /> : <BiotechRounded sx={{ fontSize: 14 }} />}
            {loading ? "Running audit…" : data ? "Re-run Audit" : "Run Deep Agent Audit"}
          </Box>
        </Tooltip>
      </Box>

      {/* ── Loading ──────────────────────────────────────────────────────────── */}
      {loading && (
        <Box>
          <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2.5, mb: 2, background: C.ghost }}>
            <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mb: 1 }) }}>Running 11-agent validation pipeline v4.0.0…</Typography>
            {[
              "VA1A · Investigation Order Extractor",
              "VA1B · Investigation Result Verifier",
              "VA2  · Medication Reconciliation (+ BPMH)",
              "VA3  · Procedure / Surgery",
              "VA4  · Clinical Consistency",
              "VA5  · Discharge Readiness (+ Social Domain)",
              "VA6  · Follow-Up Planning",
              "VA7  · Final Audit (+ P8 Quality Gate)",
              "VA8  · Safety & Allergy  ⬆ NEW",
              "VA9  · Coding & Billing  ⬆ NEW",
              "VA10 · Insurance Documents  ⬆ NEW",
              "VA11 · Post-Discharge Monitoring  ⬆ NEW",
            ].map((a, i) => (
              <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
                <CircularProgress size={8} sx={{ color: C.mist }} />
                <Typography sx={{ ...os({ fontSize: 11, color: a.includes("NEW") ? C.blue : C.silver }) }}>{a}</Typography>
              </Box>
            ))}
          </Box>
          {[80, 60, 90, 50].map((w, i) => (
            <Box key={i} sx={{ height: 14, width: `${w}%`, background: C.fog, borderRadius: "2px", mb: 1,
              animation: "pulse 1.4s ease-in-out infinite",
              "@keyframes pulse": { "0%,100%": { opacity: 0.5 }, "50%": { opacity: 1 } },
            }} />
          ))}
        </Box>
      )}

      {/* ── Error ────────────────────────────────────────────────────────────── */}
      {error && !loading && (
        <Box sx={{ p: 2.5, border: `1px solid ${C.criticalBorder}`, borderRadius: "4px", background: C.criticalBg, display: "flex", gap: 1.5 }}>
          <ErrorRounded sx={{ fontSize: 18, color: C.critical, flexShrink: 0 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 13, color: C.critical, mb: 0.5 }) }}>Audit failed</Typography>
            <Typography sx={{ ...os({ fontSize: 11, color: C.critical }) }}>{error}</Typography>
          </Box>
        </Box>
      )}

      {/* ── Main content ────────────────────────────────────────────────────── */}
      {data && !loading && (
        <>
          {/* Issue count strip */}
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden", mb: 2.5 }}>
            {[
              { label: "Critical", val: counts.Critical || 0, color: C.critical, bg: C.criticalBg },
              { label: "Major",    val: counts.Major    || 0, color: C.major,    bg: C.majorBg },
              { label: "Moderate", val: counts.Moderate || 0, color: C.moderate, bg: C.moderateBg },
              { label: "Minor",    val: counts.Minor    || 0, color: C.minor,    bg: C.minorBg },
              { label: "Total",    val: counts.Total    || 0, color: C.ink,      bg: C.ghost },
            ].map((item, i, arr) => (
              <Box key={item.label} sx={{ p: 1.5, background: item.bg, borderRight: i < arr.length - 1 ? `1px solid ${C.fog}` : "none", textAlign: "center" }}>
                <Typography sx={{ ...os({ fontSize: 18, color: item.color, fontWeight: item.val > 0 ? 400 : 300 }) }}>{item.val}</Typography>
                <Label sx={{ mb: 0, textAlign: "center" }}>{item.label}</Label>
              </Box>
            ))}
          </Box>

          {/* Main tab strip */}
          <Box sx={{ display: "flex", borderBottom: `1px solid ${C.fog}`, mb: 2.5 }}>
            {MAIN_TABS.map((label, i) => (
              <Box
                key={label}
                component="button"
                type="button"
                onClick={() => setMainTab(i)}
                sx={{
                  px: 2.5, py: 1, border: "none", background: "none",
                  fontFamily: FONT, fontSize: 12, fontWeight: mainTab === i ? 400 : 300,
                  color: mainTab === i ? C.ink : C.ash, cursor: "pointer",
                  borderBottom: mainTab === i ? `2px solid ${C.black}` : "2px solid transparent",
                  mb: "-1px", transition: "color 0.15s", letterSpacing: "0.04em",
                }}
              >
                {label}
              </Box>
            ))}
          </Box>

          {/* ── Tab 0: Summary ──────────────────────────────────────────────── */}
          {mainTab === 0 && (
            <Box>
              {/* P8 Quality Gate */}
              <QualityGatePanel gate={qGate} />

              {/* Audit conclusion */}
              {data.audit_conclusion && (
                <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2, mb: 2.5, background: C.ghost }}>
                  <Label sx={{ mb: 0.75 }}>Audit Conclusion</Label>
                  <Typography sx={{ ...os({ fontSize: 13, color: C.ink, lineHeight: 1.6 }) }}>{data.audit_conclusion}</Typography>
                  {data.validated_at && (
                    <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.75 }) }}>
                      Validated: {new Date(data.validated_at).toLocaleString()} · v{data.version} · {data.processing_time_ms}ms
                    </Typography>
                  )}
                </Box>
              )}

              {/* Scores — 10 dimensions */}
              

              {/* Priority Actions */}
              {actions.length > 0 && (
                <>
                  <SectionDivider label="Priority Actions" />
                  <Box>
                    {actions.map((act, i) => {
                      const urg = URGENCY[act.urgency] || URGENCY["Before discharge"];
                      return (
                        <Box
                          key={i}
                          sx={{ display: "flex", gap: 1.5, border: `1px solid ${urg.border}`, borderRadius: "3px", p: 1.5, mb: 1, background: urg.bg }}
                        >
                          <Box sx={{ width: 22, height: 22, borderRadius: "50%", background: urg.color, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                            <Typography sx={{ ...os({ fontSize: 10, color: C.white, fontWeight: 600 }) }}>{act.rank}</Typography>
                          </Box>
                          <Box sx={{ flex: 1 }}>
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mb: 0.25 }}>
                              <Typography sx={{ ...os({ fontSize: 12, color: urg.color }) }}>{act.action}</Typography>
                              <Box sx={{ px: 0.75, py: 0.1, borderRadius: "2px", background: urg.color }}>
                                <Typography sx={{ ...os({ fontSize: 9, color: C.white, textTransform: "uppercase", letterSpacing: "0.06em" }) }}>
                                  {act.urgency}
                                </Typography>
                              </Box>
                            </Box>
                            {act.evidence && (
                              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, fontStyle: "italic" }) }}>"{act.evidence}"</Typography>
                            )}
                            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>{act.agent}</Typography>
                          </Box>
                        </Box>
                      );
                    })}
                  </Box>
                </>
              )}

              {/* Active critical concerns */}
              {activeCrit.length > 0 && (
                <>
                  <SectionDivider label="Active Critical Concerns" />
                  {activeCrit.map((c, i) => (
                    <Box key={i} sx={{ border: `1px solid ${C.criticalBorder}`, borderRadius: "3px", p: 1.5, mb: 1, background: C.criticalBg }}>
                      <Typography sx={{ ...os({ fontSize: 12, color: C.critical }) }}>{c.concern}</Typography>
                      {c.evidence && (
                        <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25, fontStyle: "italic" }) }}>"{c.evidence}"</Typography>
                      )}
                      <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>{c.source_document} · {c.date}</Typography>
                    </Box>
                  ))}
                </>
              )}
            </Box>
          )}

          {/* ── Tab 1: Issues ───────────────────────────────────────────────── */}
          {mainTab === 1 && (
            <Box>
              {["Critical", "Major", "Moderate", "Minor"].map(sev => {
                const issues = catIssues[sev] || [];
                if (issues.length === 0) return null;
                const s = SEVERITY[sev];
                return (
                  <Box key={sev} sx={{ mb: 2.5 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
                      <Box sx={{ color: s.color }}>{s.icon}</Box>
                      <Typography sx={{ ...os({ fontSize: 11, color: s.color, textTransform: "uppercase", letterSpacing: "0.08em" }) }}>
                        {sev} ({issues.length})
                      </Typography>
                    </Box>
                    {issues.map((iss, i) => <IssueCard key={i} issue={iss} />)}
                  </Box>
                );
              })}
              {Object.values(catIssues).every(arr => !arr || arr.length === 0) && (
                <Box sx={{ py: 6, textAlign: "center" }}>
                  <CheckCircleRounded sx={{ fontSize: 36, color: C.okBorder, mb: 1 }} />
                  <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No issues identified.</Typography>
                </Box>
              )}
            </Box>
          )}

          {/* ── Tab 2: Narrative ────────────────────────────────────────────── */}
          {mainTab === 2 && (
            <Box>
              {narrative.length > 0 && (
                <>
                  <SectionDivider label="Disease Timeline" />
                  {narrative.map((ev, i) => (
                    <Box key={i} sx={{ display: "flex", gap: 0, mb: 0 }}>
                      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", mr: 2, flexShrink: 0 }}>
                        <Box sx={{ width: 8, height: 8, borderRadius: "50%", background: C.charcoal, mt: 1.5, flexShrink: 0, border: `2px solid ${C.white}`, boxShadow: `0 0 0 1px ${C.mist}` }} />
                        <Box sx={{ flex: 1, width: 1, background: C.fog, mt: 0.5 }} />
                      </Box>
                      <Box sx={{ flex: 1, pb: 2 }}>
                        <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>{ev.date}</Typography>
                        <Typography sx={{ ...os({ fontSize: 13, color: C.ink, mt: 0.25 }) }}>{ev.event}</Typography>
                        {ev.significance && (
                          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>{ev.significance}</Typography>
                        )}
                        <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>{ev.source_document}</Typography>
                      </Box>
                    </Box>
                  ))}
                </>
              )}

              {comparison.length > 0 && (
                <>
                  <SectionDivider label="Findings Comparison — Admission vs Discharge" />
                  <DataTable
                    columns={[
                      { key: "parameter",    label: "Parameter" },
                      { key: "on_admission", label: "Admission" },
                      { key: "at_discharge", label: "Discharge" },
                      { key: "trajectory",   label: "Trajectory" },
                    ]}
                    rows={comparison}
                    emptyText="No comparison data."
                  />
                </>
              )}

              {narrative.length === 0 && comparison.length === 0 && (
                <Typography sx={{ ...os({ fontSize: 13, color: C.ash, textAlign: "center", py: 4 }) }}>No narrative data available.</Typography>
              )}
            </Box>
          )}

          {/* ── Tab 3: Agent Reports ────────────────────────────────────────── */}
          {mainTab === 3 && (
            <Box>
              {/* Agent sub-tab strip — scrollable */}
              <Box sx={{ display: "flex", flexWrap: "wrap", borderBottom: `1px solid ${C.fog}`, mb: 2, overflowX: "auto" }}>
                {AGENT_TABS.map((tab, i) => {
                  const isNew = ["VA8", "VA9", "VA10", "VA11"].includes(tab.id);
                  return (
                    <Box
                      key={tab.id}
                      component="button"
                      type="button"
                      onClick={() => setAgentTab(i)}
                      sx={{
                        display: "flex", alignItems: "center", gap: 0.6,
                        px: 1.5, py: 0.85, border: "none", background: "none",
                        fontFamily: FONT, fontSize: 11, fontWeight: agentTab === i ? 400 : 300,
                        color: agentTab === i ? C.ink : C.ash, cursor: "pointer",
                        borderBottom: agentTab === i ? `2px solid ${C.black}` : "2px solid transparent",
                        mb: "-1px", transition: "color 0.15s", letterSpacing: "0.04em",
                        flexShrink: 0,
                        position: "relative",
                      }}
                    >
                      <Box sx={{ color: agentTab === i ? C.ink : C.silver }}>{tab.icon}</Box>
                      {tab.id} · {tab.label}
                      {isNew && (
                        <Box sx={{
                          ml: 0.5, px: 0.5, py: 0, background: C.blue, borderRadius: "2px",
                          display: "inline-flex", alignItems: "center",
                        }}>
                          <Typography sx={{ ...os({ fontSize: 7, color: C.white, letterSpacing: "0.05em" }) }}>NEW</Typography>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Box>

              {/* Active agent panel */}
              {(() => {
                const tab = AGENT_TABS[agentTab];
                return tab.panel(agentReps[tab.reportKey]);
              })()}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}