import React, { useEffect, useState, useCallback } from "react";

const API_URL =
  "https://doctorassist.ai/api/hms/users/ai-legacy/clinical-progress";

// ─── DESIGN TOKENS (matching DoctorAssist.AI website) ───────────────────────
const T = {
  bg:           "#ffffff",
  bgAlt:        "#fafafa",
  bgTertiary:   "#f5f5f5",
  text:         "#000000",
  textSec:      "#444444",
  textMuted:    "#888888",
  border:       "1px solid #e0e0e0",
  borderStrong: "1px solid #000000",
  font:         "'Open Sans', -apple-system, sans-serif",
  fw:           300,
  fwMed:        400,
};

// ─── SHARED MICRO-COMPONENTS ─────────────────────────────────────────────────

const Label = ({ children, style }) => (
  <span style={{
    fontSize: 10, textTransform: "uppercase", letterSpacing: "0.15em",
    color: T.textMuted, fontWeight: T.fwMed, ...style,
  }}>
    {children}
  </span>
);

const SectionTitle = ({ children }) => (
  <div style={{
    display: "flex", alignItems: "center", gap: 10, marginBottom: 16,
    paddingBottom: 10, borderBottom: T.border,
  }}>
    <Label>{children}</Label>
  </div>
);

const Badge = ({ children, variant = "default" }) => {
  const variants = {
    default:  { background: T.bgTertiary, color: T.textMuted, border: T.border },
    critical: { background: "#000", color: "#fff", border: "1px solid #000" },
    concern:  { background: T.bgTertiary, color: T.text, border: "1px solid #444" },
    stable:   { background: T.bgAlt, color: T.textSec, border: T.border },
    good:     { background: T.bgAlt, color: T.text, border: T.border },
    urgent:   { background: "#000", color: "#fff", border: "1px solid #000" },
  };
  const s = variants[variant] || variants.default;
  return (
    <span style={{
      ...s, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em",
      padding: "2px 7px", fontWeight: T.fwMed, whiteSpace: "nowrap",
      fontFamily: T.font,
    }}>
      {children}
    </span>
  );
};

const variantFromFlag = (flag = "") => {
  const f = flag.toUpperCase();
  if (f.includes("CRITICAL") || f.includes("IMMEDIATE")) return "critical";
  if (f.includes("CONCERN") || f.includes("URGENT") || f.includes("POOR")) return "concern";
  if (f.includes("STABLE") || f.includes("GOOD") || f.includes("IMPROVING")) return "stable";
  return "default";
};

const Card = ({ children, style, accent }) => (
  <div style={{
    border: accent ? "1px solid #000" : T.border,
    background: T.bg, marginBottom: 12,
    borderLeft: accent ? "3px solid #000" : T.border,
    ...style,
  }}>
    {children}
  </div>
);

const CardHeader = ({ children, style }) => (
  <div style={{
    padding: "10px 14px", background: T.bgAlt,
    borderBottom: T.border, display: "flex",
    justifyContent: "space-between", alignItems: "center", ...style,
  }}>
    {children}
  </div>
);

const CardBody = ({ children, style }) => (
  <div style={{ padding: "14px 16px", ...style }}>{children}</div>
);

const Row = ({ label, value, flag, style }) => (
  <div style={{
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    padding: "7px 0", borderBottom: T.border, gap: 16, ...style,
  }}>
    <span style={{ fontSize: 12, color: T.textSec, flexShrink: 0, maxWidth: "45%" }}>{label}</span>
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "flex-end" }}>
      {flag && <Badge variant={variantFromFlag(flag)}>{flag}</Badge>}
      <span style={{ fontSize: 12, color: T.text, fontWeight: T.fwMed, textAlign: "right" }}>{value || "—"}</span>
    </div>
  </div>
);

const MDTParagraph = ({ text }) => {
  if (!text) return null;
  return (
    <div style={{
      borderLeft: "3px solid #000", paddingLeft: 14, margin: "16px 0",
      background: T.bgAlt, padding: "14px 14px 14px 16px",
    }}>
      <Label style={{ display: "block", marginBottom: 6 }}>MDT summary</Label>
      <p style={{
        fontSize: 13, color: T.textSec, lineHeight: 1.75,
        margin: 0, fontWeight: T.fw, fontStyle: "italic",
      }}>{text}</p>
    </div>
  );
};

const ConfidenceBar = ({ level, rationale }) => {
  const pct = level === "High" ? 100 : level === "Moderate" ? 60 : 30;
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5 }}>
        <Label>Interpretation confidence</Label>
        <span style={{ fontSize: 11, color: T.text, fontWeight: T.fwMed }}>{level || "—"}</span>
      </div>
      <div style={{ height: 3, background: "#e0e0e0", marginBottom: 6 }}>
        <div style={{ height: 3, background: "#000", width: `${pct}%`, transition: "width .4s" }} />
      </div>
      {rationale && (
        <p style={{ fontSize: 11, color: T.textMuted, margin: 0, lineHeight: 1.6 }}>{rationale}</p>
      )}
    </div>
  );
};

const TagList = ({ items, style }) => (
  <div style={{ display: "flex", flexWrap: "wrap", gap: 5, ...style }}>
    {(items || []).map((t, i) => (
      <span key={i} style={{
        fontSize: 10, padding: "2px 7px", border: T.border,
        color: T.textMuted, background: T.bg,
      }}>{t}</span>
    ))}
  </div>
);

const EmptyState = ({ label }) => (
  <div style={{
    padding: "28px 0", textAlign: "center",
    border: T.border, background: T.bgAlt, marginBottom: 12,
  }}>
    <span style={{ fontSize: 12, color: T.textMuted }}>{label || "No data available"}</span>
  </div>
);

// ─── TAB NAV ─────────────────────────────────────────────────────────────────

const TabNav = ({ tabs, active, onChange }) => (
  <div style={{ display: "flex", borderBottom: "1px solid #000", marginBottom: 24 }}>
    {tabs.map(t => (
      <button key={t.key} onClick={() => onChange(t.key)} style={{
        padding: "10px 20px", fontSize: 12, fontFamily: T.font,
        fontWeight: active === t.key ? T.fwMed : T.fw,
        background: active === t.key ? "#000" : "transparent",
        color: active === t.key ? "#fff" : T.textSec,
        border: "none", borderRight: T.border, cursor: "pointer",
        letterSpacing: "0.05em", transition: "all .15s",
        display: "flex", alignItems: "center", gap: 7,
      }}>
        {t.label}
        {t.count != null && (
          <span style={{
            fontSize: 10, padding: "1px 5px",
            background: active === t.key ? "rgba(255,255,255,0.25)" : T.bgTertiary,
            color: active === t.key ? "#fff" : T.textMuted,
          }}>{t.count}</span>
        )}
      </button>
    ))}
  </div>
);

// ─── OVERVIEW BAR ─────────────────────────────────────────────────────────────

const OverviewBar = ({ data }) => {
  if (!data) return null;
  const { overall_status, headline_summary, critical_flags = [], documents_analyzed, processing_time_ms } = data;
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 16px", background: "#000", color: "#fff", marginBottom: 12,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <span style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", opacity: 0.6 }}>
            Overall status
          </span>
          <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{overall_status || "—"}</span>
        </div>
        <div style={{ display: "flex", gap: 16 }}>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{documents_analyzed} docs</span>
          <span style={{ fontSize: 10, opacity: 0.5 }}>{processing_time_ms}ms</span>
        </div>
      </div>
      {headline_summary && (
        <p style={{
          fontSize: 13, color: T.textSec, lineHeight: 1.7, margin: "0 0 12px",
          padding: "12px 16px", background: T.bgAlt, border: T.border,
        }}>{headline_summary}</p>
      )}
      {critical_flags.length > 0 && (
        <div style={{ padding: "10px 14px", border: "1px solid #000", background: T.bg }}>
          <Label style={{ display: "block", marginBottom: 8 }}>Critical flags ({critical_flags.length})</Label>
          {critical_flags.map((f, i) => (
            <div key={i} style={{
              display: "flex", gap: 10, alignItems: "flex-start",
              paddingBottom: 7, marginBottom: 7, borderBottom: i < critical_flags.length - 1 ? T.border : "none",
            }}>
              <div style={{ width: 6, height: 6, background: "#000", flexShrink: 0, marginTop: 4 }} />
              <span style={{ fontSize: 12, color: T.text, lineHeight: 1.55 }}>{f}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ─── TREND TABLE (CEO view) ───────────────────────────────────────────────────

const TrendTable = ({ rows = [], columns }) => {
  if (!rows.length) return <EmptyState label="No trend data" />;
  return (
    <div style={{ overflowX: "auto", marginBottom: 20 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12, tableLayout: "fixed" }}>
        <thead>
          <tr>
            {columns.map(c => (
              <th key={c.key} style={{
                padding: "7px 10px", background: T.bgTertiary,
                border: T.border, textAlign: "left", fontSize: 10,
                textTransform: "uppercase", letterSpacing: "0.1em",
                color: T.textMuted, fontWeight: T.fwMed,
                width: c.width,
              }}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} style={{ background: i % 2 === 0 ? T.bg : T.bgAlt }}>
              {columns.map(c => (
                <td key={c.key} style={{ padding: "7px 10px", border: T.border, verticalAlign: "top" }}>
                  {c.key === "flag"
                    ? <Badge variant={variantFromFlag(row[c.key])}>{row[c.key]}</Badge>
                    : c.key === "trend"
                    ? <span style={{ fontSize: 16, color: T.text }}>{row[c.key]}</span>
                    : <span style={{ color: T.text, lineHeight: 1.45, display: "block" }}>{row[c.key] || "—"}</span>
                  }
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

// ─── TAB: RADIOLOGY ──────────────────────────────────────────────────────────

const RadiologyTab = ({ radiology, radiology_trends = [], ceo_radiology_table = [] }) => {
  if (!radiology && !radiology_trends.length) return <EmptyState label="No radiology data available" />;

  const r = radiology || {};
  const lesions = r.lesion_interpretations || [];
  const urgent  = r.urgent_radiology_actions || [];
  const next    = r.next_imaging_recommendation || {};

  return (
    <div>
      {/* Response assessment header */}
      {r.overall_response_assessment && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", border: "1px solid #000", marginBottom: 16,
          background: T.bgAlt,
        }}>
          <div>
            <Label style={{ display: "block", marginBottom: 4 }}>RECIST overall response</Label>
            <span style={{ fontSize: 18, fontWeight: T.fw, letterSpacing: "-0.02em" }}>
              {r.overall_response_assessment}
            </span>
          </div>
          <div style={{ textAlign: "right" }}>
            {r.target_lesion_sum_baseline_cm != null && (
              <div style={{ fontSize: 11, color: T.textMuted }}>
                Baseline sum: {r.target_lesion_sum_baseline_cm} cm
              </div>
            )}
            {r.target_lesion_sum_current_cm != null && (
              <div style={{ fontSize: 11, color: T.text }}>
                Current sum: {r.target_lesion_sum_current_cm} cm
              </div>
            )}
            {r.new_lesions_identified != null && (
              <Badge variant={r.new_lesions_identified ? "critical" : "stable"}>
                {r.new_lesions_identified ? "New lesions" : "No new lesions"}
              </Badge>
            )}
          </div>
        </div>
      )}

      {r.recist_summary && (
        <p style={{
          fontSize: 13, color: T.textSec, lineHeight: 1.7,
          margin: "0 0 16px", padding: "12px 14px", background: T.bgAlt, border: T.border,
        }}>{r.recist_summary}</p>
      )}

      <ConfidenceBar level={r.interpretation_confidence} rationale={r.confidence_rationale} />
      <MDTParagraph text={r.mdt_radiology_paragraph} />

      {/* Lesion-by-lesion */}
      {lesions.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Lesion interpretations ({lesions.length})</SectionTitle>
          {lesions.map((l, i) => (
            <Card key={i} accent>
              <CardHeader>
                <div>
                  <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{l.lesion_label || `Lesion ${i + 1}`}</span>
                  <span style={{ fontSize: 11, color: T.textMuted, marginLeft: 10 }}>{l.anatomical_site}</span>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  <Badge variant={variantFromFlag(l.recist_category || "")}>{l.recist_category || "NE"}</Badge>
                  {l.clinical_interpretation_type && (
                    <Badge>{l.clinical_interpretation_type.replace("_", " ")}</Badge>
                  )}
                </div>
              </CardHeader>
              <CardBody>
                {l.size_trajectory && (
                  <Row label="Size trajectory" value={l.size_trajectory} />
                )}
                {l.size_change_summary && (
                  <Row label="Change" value={l.size_change_summary} />
                )}
                {l.differential_assessment && (
                  <Row label="Assessment" value={l.differential_assessment} flag={l.differential_assessment} />
                )}
                {l.clinical_significance && (
                  <div style={{ marginTop: 10 }}>
                    <Label style={{ display: "block", marginBottom: 5 }}>Clinical significance</Label>
                    <p style={{ fontSize: 12, color: T.textSec, margin: 0, lineHeight: 1.65 }}>
                      {l.clinical_significance}
                    </p>
                  </div>
                )}
                {l.differential_rationale && (
                  <div style={{ marginTop: 10 }}>
                    <Label style={{ display: "block", marginBottom: 5 }}>Rationale</Label>
                    <p style={{ fontSize: 12, color: T.textSec, margin: 0, lineHeight: 1.65 }}>
                      {l.differential_rationale}
                    </p>
                  </div>
                )}
                {l.recommended_follow_up && (
                  <div style={{
                    marginTop: 10, padding: "8px 12px",
                    background: T.bgTertiary, borderLeft: "2px solid #000",
                  }}>
                    <Label style={{ display: "block", marginBottom: 4 }}>Recommended follow-up</Label>
                    <span style={{ fontSize: 12, color: T.text }}>{l.recommended_follow_up}</span>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Structural findings */}
      {r.structural_findings_summary && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Structural findings</SectionTitle>
          <Card>
            <CardBody>
              <p style={{ fontSize: 13, color: T.textSec, margin: 0, lineHeight: 1.7 }}>
                {r.structural_findings_summary}
              </p>
            </CardBody>
          </Card>
        </div>
      )}

      {/* Urgent actions */}
      {urgent.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Urgent actions ({urgent.length})</SectionTitle>
          {urgent.map((a, i) => (
            <div key={i} style={{
              display: "flex", gap: 14, padding: "10px 14px",
              border: "1px solid #000", marginBottom: 6, background: T.bg,
            }}>
              <div style={{ width: 8, height: 8, background: "#000", flexShrink: 0, marginTop: 4 }} />
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                  <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{a.action}</span>
                  {a.timeframe && (
                    <Badge variant={variantFromFlag(a.timeframe)}>{a.timeframe}</Badge>
                  )}
                </div>
                {a.rationale && (
                  <p style={{ fontSize: 12, color: T.textSec, margin: 0, lineHeight: 1.6 }}>{a.rationale}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Next imaging */}
      {next.modality && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Next imaging recommendation</SectionTitle>
          <Card>
            <CardHeader>
              <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{next.modality}</span>
              {next.suggested_timeframe && <Badge>{next.suggested_timeframe}</Badge>}
            </CardHeader>
            <CardBody>
              {next.clinical_question && <Row label="Clinical question" value={next.clinical_question} />}
              {next.contrast_required != null && (
                <Row label="Contrast" value={next.contrast_required ? "Required" : "Not required"} />
              )}
              {next.special_protocol && <Row label="Protocol" value={next.special_protocol} />}
            </CardBody>
          </Card>
        </div>
      )}

      {/* CEO trend table */}
      {ceo_radiology_table.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Radiology trend summary</SectionTitle>
          <TrendTable
            rows={ceo_radiology_table}
            columns={[
              { key: "parameter", label: "Lesion", width: "24%" },
              { key: "site",      label: "Site",   width: "16%" },
              { key: "first",     label: "First",  width: "11%" },
              { key: "latest",    label: "Latest", width: "11%" },
              { key: "trend",     label: "↑↓",     width: "5%"  },
              { key: "status",    label: "Status", width: "16%" },
              { key: "flag",      label: "Flag",   width: "12%" },
            ]}
          />
        </div>
      )}
    </div>
  );
};

// ─── TAB: VITALS ─────────────────────────────────────────────────────────────

const VitalsTab = ({ vitals, vitals_trends = [], ceo_vitals_table = [] }) => {
  if (!vitals && !vitals_trends.length) return <EmptyState label="No vitals data available" />;

  const v = vitals || {};
  const params  = v.parameter_interpretations || [];
  const cardiac = v.cardiac_fitness_summary || {};
  const tol     = v.treatment_tolerance || {};
  const detr    = v.deteriorating_parameters || [];
  const monitor = v.monitoring_recommendations || [];

  const fitnessVariant = (val) => {
    if (!val) return "default";
    if (val.includes("POOR"))     return "critical";
    if (val.includes("MODERATE")) return "concern";
    if (val.includes("GOOD"))     return "stable";
    return "default";
  };

  return (
    <div>
      {/* Functional reserve header */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        gap: 0, border: "1px solid #000", marginBottom: 16,
      }}>
        {[
          { label: "Functional reserve", value: v.functional_reserve_assessment },
          { label: "Cardiac fitness",    value: cardiac.overall_fitness },
          { label: "Surgery tolerance",  value: tol.surgery_tolerance },
        ].map((item, i) => (
          <div key={i} style={{
            padding: "14px 16px",
            borderRight: i < 2 ? T.border : "none",
            background: T.bgAlt,
          }}>
            <Label style={{ display: "block", marginBottom: 6 }}>{item.label}</Label>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ fontSize: 15, fontWeight: T.fw, letterSpacing: "-0.01em" }}>
                {item.value || "—"}
              </span>
              {item.value && (
                <Badge variant={fitnessVariant(item.value || "")}>{item.value}</Badge>
              )}
            </div>
          </div>
        ))}
      </div>

      {v.functional_reserve_rationale && (
        <p style={{
          fontSize: 13, color: T.textSec, lineHeight: 1.7,
          margin: "0 0 16px", padding: "12px 14px", background: T.bgAlt, border: T.border,
        }}>{v.functional_reserve_rationale}</p>
      )}

      <ConfidenceBar level={v.interpretation_confidence} rationale={v.confidence_rationale} />
      <MDTParagraph text={v.mdt_vitals_paragraph} />

      {/* Deteriorating parameters alert */}
      {detr.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Deteriorating parameters ({detr.length})</SectionTitle>
          {detr.map((d, i) => (
            <div key={i} style={{
              padding: "10px 14px", border: "1px solid #000",
              marginBottom: 6, borderLeft: "3px solid #000",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{d.parameter}</span>
                {d.urgency && <Badge variant={variantFromFlag(d.urgency)}>{d.urgency}</Badge>}
              </div>
              {d.trend && <Row label="Trend" value={d.trend} />}
              {d.clinical_concern && <Row label="Clinical concern" value={d.clinical_concern} />}
              {d.recommended_action && (
                <div style={{
                  marginTop: 8, padding: "7px 10px",
                  background: T.bgTertiary, borderLeft: "2px solid #000",
                }}>
                  <Label style={{ display: "block", marginBottom: 3 }}>Action</Label>
                  <span style={{ fontSize: 12, color: T.text }}>{d.recommended_action}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Cardiac summary */}
      {Object.keys(cardiac).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Cardiac fitness summary</SectionTitle>
          <Card>
            <CardHeader>
              <span style={{ fontSize: 13, fontWeight: T.fwMed }}>Cardiac assessment</span>
              {cardiac.overall_fitness && (
                <Badge variant={fitnessVariant(cardiac.overall_fitness)}>{cardiac.overall_fitness}</Badge>
              )}
            </CardHeader>
            <CardBody>
              {cardiac.ef_comment      && <Row label="Ejection fraction" value={cardiac.ef_comment} />}
              {cardiac.rwma_comment    && <Row label="RWMA"              value={cardiac.rwma_comment} />}
              {cardiac.diastolic_comment && <Row label="Diastolic"       value={cardiac.diastolic_comment} />}
              {cardiac.bp_hr_comment   && <Row label="BP / HR"           value={cardiac.bp_hr_comment} />}
              {cardiac.optimisation_required && (
                <div style={{ marginTop: 10, padding: "8px 12px", borderLeft: "2px solid #000", background: T.bgAlt }}>
                  <Label style={{ display: "block", marginBottom: 4 }}>Optimisation required</Label>
                  <span style={{ fontSize: 12, color: T.text }}>{cardiac.optimisation_required}</span>
                </div>
              )}
              {cardiac.cardiac_notes && (
                <p style={{ fontSize: 12, color: T.textSec, marginTop: 10, lineHeight: 1.65 }}>
                  {cardiac.cardiac_notes}
                </p>
              )}
            </CardBody>
          </Card>
        </div>
      )}

      {/* Treatment tolerance */}
      {Object.keys(tol).length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Treatment tolerance</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 0, border: T.border }}>
            {[
              { label: "Surgery",        tol: tol.surgery_tolerance,      notes: tol.surgery_notes },
              { label: "Chemotherapy",   tol: tol.chemo_tolerance,        notes: tol.chemo_notes },
              { label: "Radiotherapy",   tol: tol.radiotherapy_tolerance, notes: tol.radiotherapy_notes },
            ].map((item, i) => (
              <div key={i} style={{
                padding: "14px", borderRight: i < 2 ? T.border : "none",
              }}>
                <Label style={{ display: "block", marginBottom: 6 }}>{item.label}</Label>
                {item.tol && (
                  <Badge variant={fitnessVariant(item.tol)} style={{ marginBottom: 8, display: "inline-block" }}>
                    {item.tol}
                  </Badge>
                )}
                {item.notes && (
                  <p style={{ fontSize: 11, color: T.textSec, margin: "8px 0 0", lineHeight: 1.6 }}>
                    {item.notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Per-parameter interpretations */}
      {params.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Parameter interpretations ({params.length})</SectionTitle>
          {params.map((p, i) => (
            <Card key={i}>
              <CardHeader>
                <div>
                  <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{p.parameter}</span>
                  {p.subcategory && (
                    <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 8 }}>
                      {p.subcategory.replace("_", " ")}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {p.monitoring_priority && (
                    <Badge variant={variantFromFlag(p.monitoring_priority)}>{p.monitoring_priority}</Badge>
                  )}
                  {p.current_value && (
                    <span style={{ fontSize: 12, fontWeight: T.fwMed }}>{p.current_value}</span>
                  )}
                </div>
              </CardHeader>
              <CardBody>
                {p.clinical_meaning && <Row label="Clinical meaning" value={p.clinical_meaning} />}
                {p.trend_interpretation && <Row label="Trend" value={p.trend_interpretation} />}
                {p.treatment_relevance && <Row label="Treatment relevance" value={p.treatment_relevance} />}
                {p.specific_treatment_constrained && (
                  <Row label="Constrained treatment" value={p.specific_treatment_constrained} flag="CONCERN" />
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Monitoring recommendations */}
      {monitor.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Monitoring recommendations ({monitor.length})</SectionTitle>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr>
                  {["Parameter", "Frequency", "Escalation threshold", "Action"].map(h => (
                    <th key={h} style={{
                      padding: "7px 10px", background: T.bgTertiary, border: T.border,
                      textAlign: "left", fontSize: 10, textTransform: "uppercase",
                      letterSpacing: "0.1em", color: T.textMuted, fontWeight: T.fwMed,
                    }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {monitor.map((m, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? T.bg : T.bgAlt }}>
                    <td style={{ padding: "7px 10px", border: T.border, fontWeight: T.fwMed }}>{m.parameter}</td>
                    <td style={{ padding: "7px 10px", border: T.border, color: T.textSec }}>{m.frequency}</td>
                    <td style={{ padding: "7px 10px", border: T.border, color: T.textSec }}>{m.threshold_for_escalation}</td>
                    <td style={{ padding: "7px 10px", border: T.border, color: T.text }}>{m.escalation_action}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* CEO trend table */}
      {ceo_vitals_table.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Vitals trend summary</SectionTitle>
          <TrendTable
            rows={ceo_vitals_table}
            columns={[
              { key: "parameter", label: "Parameter", width: "24%" },
              { key: "category",  label: "Category",  width: "16%" },
              { key: "first",     label: "First",     width: "13%" },
              { key: "latest",    label: "Latest",    width: "13%" },
              { key: "trend",     label: "↑↓",        width: "5%"  },
              { key: "change",    label: "Change",    width: "17%" },
              { key: "flag",      label: "Flag",      width: "12%" },
            ]}
          />
        </div>
      )}
    </div>
  );
};

// ─── TAB: LABS ────────────────────────────────────────────────────────────────

const LabsTab = ({ labs, lab_trends = [], ceo_lab_table = [] }) => {
  if (!labs && !lab_trends.length) return <EmptyState label="No lab data available" />;

  const l = labs || {};
  const params   = l.parameter_interpretations || [];
  const organs   = l.organ_system_lab_summaries || [];
  const critical = l.critical_lab_values || [];
  const tumour   = l.tumour_marker_assessment || {};
  const missing  = l.missing_labs_clinical_impact || [];

  const organStatusVariant = (s = "") => {
    if (s.includes("CRITICAL")) return "critical";
    if (s.includes("SIGNIFICANT")) return "concern";
    if (s.includes("MILD")) return "default";
    return "stable";
  };

  return (
    <div>
      {/* Overall lab status */}
      {l.overall_lab_status && (
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "12px 16px", border: "1px solid #000", marginBottom: 16, background: T.bgAlt,
        }}>
          <div>
            <Label style={{ display: "block", marginBottom: 4 }}>Overall lab status</Label>
            <span style={{ fontSize: 18, fontWeight: T.fw, letterSpacing: "-0.02em" }}>
              {l.overall_lab_status}
            </span>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", justifyContent: "flex-end" }}>
            {l.improving_parameters?.length > 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: T.fw }}>↑ {l.improving_parameters.length}</div>
                <Label>Improving</Label>
              </div>
            )}
            {l.stable_parameters?.length > 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: T.fw }}>→ {l.stable_parameters.length}</div>
                <Label>Stable</Label>
              </div>
            )}
            {l.worsening_parameters?.length > 0 && (
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: 18, fontWeight: T.fw }}>↓ {l.worsening_parameters.length}</div>
                <Label>Worsening</Label>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Improving/worsening tags */}
      {(l.improving_parameters?.length > 0 || l.worsening_parameters?.length > 0) && (
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          gap: 0, border: T.border, marginBottom: 16,
        }}>
          {[
            { label: "Improving",  items: l.improving_parameters,  sym: "↑" },
            { label: "Stable",     items: l.stable_parameters,     sym: "→" },
            { label: "Worsening",  items: l.worsening_parameters,  sym: "↓" },
          ].map((group, gi) => (
            <div key={gi} style={{ padding: "12px 14px", borderRight: gi < 2 ? T.border : "none" }}>
              <Label style={{ display: "block", marginBottom: 8 }}>
                {group.sym} {group.label}
              </Label>
              <TagList items={group.items} />
            </div>
          ))}
        </div>
      )}

      <ConfidenceBar level={l.interpretation_confidence} rationale={l.confidence_rationale} />
      <MDTParagraph text={l.mdt_lab_paragraph} />

      {/* Critical lab values */}
      {critical.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Critical lab values ({critical.length})</SectionTitle>
          {critical.map((c, i) => (
            <div key={i} style={{
              padding: "10px 14px", border: "1px solid #000",
              marginBottom: 6, borderLeft: "3px solid #000",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{c.parameter}</span>
                <Badge variant="critical">{c.timeframe}</Badge>
              </div>
              {c.value && <Row label="Value" value={`${c.value} (threshold: ${c.threshold})`} />}
              {c.clinical_danger && <Row label="Clinical danger" value={c.clinical_danger} />}
              {c.required_action && (
                <div style={{ marginTop: 8, padding: "7px 10px", background: T.bgTertiary, borderLeft: "2px solid #000" }}>
                  <Label style={{ display: "block", marginBottom: 3 }}>Required action</Label>
                  <span style={{ fontSize: 12, color: T.text }}>{c.required_action}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Organ system summaries */}
      {organs.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Organ system summaries ({organs.length})</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            {organs.map((o, i) => (
              <Card key={i}>
                <CardHeader>
                  <span style={{ fontSize: 12, fontWeight: T.fwMed, textTransform: "capitalize" }}>
                    {(o.system || "").replace("_", " ")}
                  </span>
                  {o.status && (
                    <Badge variant={organStatusVariant(o.status)}>{o.status.replace("_", " ")}</Badge>
                  )}
                </CardHeader>
                <CardBody style={{ padding: "10px 14px" }}>
                  {o.key_parameters?.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <TagList items={o.key_parameters} />
                    </div>
                  )}
                  {o.clinical_note && (
                    <p style={{ fontSize: 12, color: T.textSec, margin: "0 0 6px", lineHeight: 1.6 }}>
                      {o.clinical_note}
                    </p>
                  )}
                  {o.treatment_constraint && (
                    <div style={{ padding: "6px 10px", borderLeft: "2px solid #000", background: T.bgAlt }}>
                      <span style={{ fontSize: 11, color: T.text }}>{o.treatment_constraint}</span>
                    </div>
                  )}
                </CardBody>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Tumour markers */}
      {tumour.present && tumour.markers?.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Tumour marker assessment</SectionTitle>
          {tumour.overall_tumour_marker_trend && (
            <div style={{ marginBottom: 10, display: "flex", gap: 8, alignItems: "center" }}>
              <Label>Overall trend:</Label>
              <Badge variant={variantFromFlag(tumour.overall_tumour_marker_trend)}>
                {tumour.overall_tumour_marker_trend}
              </Badge>
            </div>
          )}
          {tumour.markers.map((m, i) => (
            <Card key={i} accent>
              <CardHeader>
                <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{m.marker}</span>
                {m.cancer_context && <span style={{ fontSize: 11, color: T.textMuted }}>{m.cancer_context}</span>}
              </CardHeader>
              <CardBody>
                {m.trajectory && <Row label="Trajectory" value={m.trajectory} />}
                {m.velocity_comment && <Row label="Velocity" value={m.velocity_comment} />}
                {m.clinical_decision_implication && (
                  <div style={{ marginTop: 8, padding: "8px 12px", borderLeft: "2px solid #000", background: T.bgAlt }}>
                    <Label style={{ display: "block", marginBottom: 4 }}>Clinical decision</Label>
                    <span style={{ fontSize: 12, color: T.text }}>{m.clinical_decision_implication}</span>
                  </div>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Per-parameter interpretations */}
      {params.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Parameter interpretations ({params.length})</SectionTitle>
          {params.map((p, i) => (
            <Card key={i}>
              <CardHeader>
                <div>
                  <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{p.parameter}</span>
                  {p.subcategory && (
                    <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 8 }}>
                      {p.subcategory.replace("_", " ")}
                    </span>
                  )}
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {p.abnormal_flag && p.abnormal_flag !== "NORMAL" && (
                    <Badge variant={variantFromFlag(p.abnormal_flag)}>{p.abnormal_flag}</Badge>
                  )}
                  {p.current_value && (
                    <span style={{ fontSize: 12, fontWeight: T.fwMed }}>
                      {p.current_value}
                      {p.reference_range && (
                        <span style={{ fontSize: 10, color: T.textMuted, marginLeft: 4 }}>
                          [{p.reference_range}]
                        </span>
                      )}
                    </span>
                  )}
                </div>
              </CardHeader>
              <CardBody>
                {p.clinical_meaning && <Row label="Clinical meaning" value={p.clinical_meaning} />}
                {p.trend_interpretation && <Row label="Trend" value={p.trend_interpretation} />}
                {p.treatment_relevance && <Row label="Treatment relevance" value={p.treatment_relevance} />}
                {p.required_action && p.required_action !== "NONE" && (
                  <Row label="Action" value={p.required_action} flag={p.action_timeframe} />
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      {/* Missing labs */}
      {missing.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Missing labs — clinical impact ({missing.length})</SectionTitle>
          {missing.map((m, i) => (
            <div key={i} style={{
              padding: "10px 14px", border: T.border, marginBottom: 6,
              borderLeft: "2px solid #888",
            }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: T.fwMed }}>{m.parameter}</span>
                {m.urgency && <Badge variant={variantFromFlag(m.urgency)}>{m.urgency}</Badge>}
              </div>
              {m.why_needed && <Row label="Why needed" value={m.why_needed} />}
              {m.decision_blocked && <Row label="Decision blocked" value={m.decision_blocked} />}
              {m.suggested_action && (
                <div style={{ marginTop: 8, padding: "6px 10px", background: T.bgAlt, borderLeft: "2px solid #000" }}>
                  <Label style={{ display: "block", marginBottom: 3 }}>Suggested action</Label>
                  <span style={{ fontSize: 12, color: T.text }}>{m.suggested_action}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* CEO trend table */}
      {ceo_lab_table.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <SectionTitle>Lab trend summary</SectionTitle>
          <TrendTable
            rows={ceo_lab_table}
            columns={[
              { key: "parameter", label: "Parameter", width: "22%" },
              { key: "category",  label: "Category",  width: "14%" },
              { key: "first",     label: "First",     width: "12%" },
              { key: "latest",    label: "Latest",    width: "12%" },
              { key: "trend",     label: "↑↓",        width: "5%"  },
              { key: "change",    label: "Change",    width: "23%" },
              { key: "flag",      label: "Flag",      width: "12%" },
            ]}
          />
        </div>
      )}
    </div>
  );
};

// ─── MAIN EXPORT ─────────────────────────────────────────────────────────────

export default function Trend({ patientId, doctorId }) {
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);
  const [data,    setData]    = useState(null);
  const [tab,     setTab]     = useState("radiology");

  const fetchTrends = useCallback(async () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id:              patientId,
          doctor_id:               doctorId,
          specialty:               "Oncology",
          include_raw_extractions: true,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err.message || "Request failed");
    } finally {
      setLoading(false);
    }
  }, [patientId, doctorId]);



  const dv  = data?.doctor_view;
  const rad = dv?.radiology;
  const vit = dv?.vitals;
  const lab = dv?.labs;

  const tabs = [
    {
      key:   "radiology",
      label: "Radiology",
      count: (data?.ceo_radiology_table?.length || (rad?.lesion_interpretations?.length ?? 0)) || null,
    },
    {
      key:   "vitals",
      label: "Vitals",
      count: (data?.ceo_vitals_table?.length || (vit?.parameter_interpretations?.length ?? 0)) || null,
    },
    {
      key:   "labs",
      label: "Labs",
      count: (data?.ceo_lab_table?.length || (lab?.parameter_interpretations?.length ?? 0)) || null,
    },
  ];

  const root = {
    fontFamily: T.font, fontWeight: T.fw, color: T.text,
    background: T.bg, fontSize: 13, lineHeight: 1.6,
  };
if (!data && !loading && !error) {
  return (
    <div style={{ ...root, padding: 32, textAlign: "center" }}>
      <div style={{
        border: T.border,
        padding: "28px",
        background: T.bgAlt,
        maxWidth: 420,
        margin: "0 auto",
      }}>
        <Label style={{ display: "block", marginBottom: 10 }}>
          Clinical Progress Analysis
        </Label>

        <p style={{
          fontSize: 13,
          color: T.textSec,
          marginBottom: 20,
          lineHeight: 1.6,
        }}>
          Click below to run AI-powered radiology, labs, and vitals trend analysis.
        </p>

        <button
          onClick={fetchTrends}
          disabled={!patientId || !doctorId}
          style={{
            padding: "10px 18px",
            background: "#000",
            color: "#fff",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: T.font,
            letterSpacing: "0.06em",
            opacity: !patientId || !doctorId ? 0.4 : 1,
          }}
        >
          Run Analysis
        </button>

        {(!patientId || !doctorId) && (
          <p style={{
            fontSize: 11,
            color: T.textMuted,
            marginTop: 10,
          }}>
            Patient ID and Doctor ID required
          </p>
        )}
      </div>
    </div>
  );
}
  // ── Loading state ──
  if (loading) return (
    <div style={{ ...root, padding: 32 }}>
      <div style={{
        display: "flex", flexDirection: "column", gap: 16,
        borderLeft: "3px solid #000", paddingLeft: 20,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            width: 8, height: 8, background: "#000",
            animation: "pulse 1.4s infinite",
          }} />
          <span style={{ fontSize: 13, color: T.textSec }}>Extracting clinical data...</span>
        </div>
        {["Analysing radiology trends", "Processing lab values", "Evaluating vitals"].map((s, i) => (
          <div key={i} style={{
            display: "flex", alignItems: "center", gap: 12,
            opacity: 0.4 + i * 0.2,
          }}>
            <div style={{ width: 6, height: 6, background: "#ccc" }} />
            <span style={{ fontSize: 12, color: T.textMuted }}>{s}</span>
          </div>
        ))}
      </div>
      <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>
    </div>
  );

  // ── Error state ──
  if (error) return (
    <div style={{ ...root, padding: 24 }}>
      <div style={{ borderLeft: "3px solid #000", paddingLeft: 16, paddingTop: 4, paddingBottom: 4 }}>
        <Label style={{ display: "block", marginBottom: 6 }}>Error</Label>
        <p style={{ fontSize: 13, color: T.textSec, margin: "0 0 12px" }}>{error}</p>
        <button onClick={fetchTrends} style={{
          padding: "7px 16px", background: "#000", color: "#fff",
          border: "none", cursor: "pointer", fontSize: 12,
          fontFamily: T.font, letterSpacing: "0.05em",
        }}>
          Retry
        </button>
      </div>
    </div>
  );

  // ── Empty state ──
  if (!data) return (
    <div style={{ ...root, padding: 24 }}>
      <EmptyState label={
        !patientId || !doctorId
          ? "Patient ID and Doctor ID required"
          : "No clinical data found"
      } />
    </div>
  );

  return (
    <div style={root}>
      {/* Top bar */}
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 0", marginBottom: 20, borderBottom: "1px solid #000",
      }}>
        <div>
          <Label style={{ display: "block", marginBottom: 2 }}>Clinical progress</Label>
          <span style={{ fontSize: 15, fontWeight: T.fwMed, letterSpacing: "-0.01em" }}>
            Doctor view
          </span>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
          {data.generated_at && (
            <span style={{ fontSize: 11, color: T.textMuted }}>
              {new Date(data.generated_at).toLocaleString()}
            </span>
          )}
          <button onClick={fetchTrends} style={{
            padding: "5px 12px", background: "transparent", border: T.border,
            cursor: "pointer", fontSize: 11, fontFamily: T.font,
            color: T.textSec, letterSpacing: "0.05em",
          }}>
            Refresh
          </button>
        </div>
      </div>

      {/* Overview */}
      <OverviewBar data={data} />

      {/* Tabs */}
      <TabNav tabs={tabs} active={tab} onChange={setTab} />

      {/* Tab content */}
      {tab === "radiology" && (
        <RadiologyTab
          radiology={rad}
          radiology_trends={data.radiology_trends}
          ceo_radiology_table={data.ceo_radiology_table}
        />
      )}
      {tab === "vitals" && (
        <VitalsTab
          vitals={vit}
          vitals_trends={data.vitals_trends}
          ceo_vitals_table={data.ceo_vitals_table}
        />
      )}
      {tab === "labs" && (
        <LabsTab
          labs={lab}
          lab_trends={data.lab_trends}
          ceo_lab_table={data.ceo_lab_table}
        />
      )}
    </div>
  );
}