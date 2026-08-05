import React, { useState } from "react";
import { Box, Typography, Tabs, Tab, Chip } from "@mui/material";
import {
  RefreshRounded,
  CheckCircleRounded,
  ErrorRounded,
  ExpandMoreRounded,
  ExpandLessRounded,
  BiotechRounded,
  ScienceRounded,
  MedicalServicesRounded,
  AssignmentRounded,
  WarningAmberRounded,
  FiberManualRecordRounded,
  ArrowForwardRounded,
} from "@mui/icons-material";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── Design tokens ────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW   = 300;

const C = {
  black:    "#0a0a0a", ink:      "#1a1a1a", charcoal: "#2e2e2e",
  smoke:    "#4a4a4a", ash:      "#7a7a7a", silver:   "#a8a8a8",
  mist:     "#d4d4d4", fog:      "#e8e8e8", ghost:    "#f2f2f2",
  white:    "#ffffff", success:  "#2e7d32", error:    "#d32f2f",
  warn:     "#e65100",
};

const os  = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const card = {
  background: C.white, border: `1px solid ${C.fog}`,
  borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
};

const actionButton = {
  px: 2.5, py: 1.1, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.06em",
  background: C.black, color: C.white, border: "none", cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 0.75,
  transition: "background 0.18s ease",
  "&:hover": { background: C.charcoal }, "&:active": { background: C.ink },
  "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};

const ghostButton = {
  px: 2, py: 0.9, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.04em",
  background: "transparent", color: C.charcoal, border: `1px solid ${C.mist}`,
  cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 0.5,
  transition: "all 0.15s ease",
  "&:hover": { borderColor: C.smoke, background: C.ghost },
};

const tabSx = {
  "& .MuiTab-root": {
    textTransform: "none", fontWeight: 300, fontFamily: FONT, fontSize: 12,
    minWidth: "auto", px: { xs: 1.5, sm: 2 }, color: C.ash, letterSpacing: "0.04em",
    "&.Mui-selected": { color: C.ink, fontWeight: 400 },
  },
  "& .MuiTabs-indicator": { background: C.black, height: 1.5 },
  "& .MuiTabs-scrollButtons": { display: "flex" },
  borderBottom: `1px solid ${C.fog}`,
};

// ─── Tiny typography helpers ───────────────────────────────────────────────────
const Label = ({ children }) => (
  <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.4 }) }}>
    {children}
  </Typography>
);

const urgencyColor = (u = "") => {
  const l = u.toLowerCase();
  if (l === "immediate" || l === "urgent") return C.error;
  if (l === "routine" || l === "recommended") return C.warn;
  return C.ash;
};

const tierColor = (t = "") => {
  if (t === "Tier I")  return C.success;
  if (t === "Tier II") return C.warn;
  return C.ash;
};

// ═══════════════════════════════════════════════════════════════════════════════
// UNIVERSAL VALUE RENDERER
// Handles any shape the LLM can produce:
//   • null / undefined → "—"
//   • string / number / boolean → plain text
//   • string[] → bullet list
//   • object[] → each object rendered as a mini key-value card
//   • plain object → key-value rows
//   • deeply nested combos → recursive
// ═══════════════════════════════════════════════════════════════════════════════

const renderValue = (value, depth = 0) => {
  // ── null / undefined ──────────────────────────────────────────────────────
  if (value === null || value === undefined) {
    return (
      <Typography sx={{ ...os({ fontSize: 13, color: C.silver }) }}>—</Typography>
    );
  }

  // ── primitives ────────────────────────────────────────────────────────────
  if (typeof value !== "object") {
    return (
      <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.6 }) }}>
        {String(value)}
      </Typography>
    );
  }

  // ── arrays ────────────────────────────────────────────────────────────────
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <Typography sx={{ ...os({ fontSize: 13, color: C.silver }) }}>—</Typography>;
    }

    // Array of primitives → compact pill list
    const allPrimitive = value.every((v) => typeof v !== "object" || v === null);
    if (allPrimitive) {
      return (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 0.5 }}>
          {value.map((item, i) => (
            <Box key={i} sx={{
              px: 1.25, py: 0.3,
              border: `1px solid ${C.fog}`, borderRadius: "2px",
              background: C.white,
            }}>
              <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>
                {item === null || item === undefined ? "—" : String(item)}
              </Typography>
            </Box>
          ))}
        </Box>
      );
    }

    // Array of objects → each as a card
    return (
      <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, mt: 0.5 }}>
        {value.map((item, i) => (
          <Box key={i} sx={{
            p: 2, border: `1px solid ${C.fog}`, borderRadius: "4px",
            background: depth === 0 ? C.white : C.ghost,
          }}>
            {typeof item !== "object" || item === null
              ? <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>{String(item)}</Typography>
              : renderValue(item, depth + 1)}
          </Box>
        ))}
      </Box>
    );
  }

  // ── plain object ──────────────────────────────────────────────────────────
  const entries = Object.entries(value).filter(([, v]) => v !== null && v !== undefined && v !== "");
  if (entries.length === 0) {
    return <Typography sx={{ ...os({ fontSize: 13, color: C.silver }) }}>—</Typography>;
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {entries.map(([key, val], i) => {
        const isLastRow = i === entries.length - 1;
        const isComplex = typeof val === "object" && val !== null;

        return (
          <Box
            key={key}
            sx={{
              display: isComplex ? "flex" : "grid",
              gridTemplateColumns: isComplex ? undefined : "minmax(130px, 30%) 1fr",
              flexDirection: isComplex ? "column" : undefined,
              gap: isComplex ? 0.5 : 1.5,
              py: 1,
              borderBottom: isLastRow ? "none" : `1px solid ${C.fog}`,
            }}
          >
            {/* Key */}
            <Typography sx={{
              ...os({
                fontSize: 11, color: C.ash, flexShrink: 0,
                textTransform: "capitalize", letterSpacing: "0.02em",
              }),
            }}>
              {key.replace(/_/g, " ")}
            </Typography>

            {/* Value */}
            <Box sx={{ flex: 1 }}>
              {renderValue(val, depth + 1)}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
};

// ─── Collapsible section ──────────────────────────────────────────────────────
const CollapsibleSection = ({ title, count, children, defaultOpen = true, accent }) => {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Box sx={{
      mb: 1.5,
      border: `1px solid ${C.fog}`,
      borderRadius: "4px",
      overflow: "hidden",
      borderLeft: accent ? `3px solid ${accent}` : undefined,
    }}>
      <Box
        onClick={() => setOpen((p) => !p)}
        sx={{
          px: 2.5, py: 1.5, background: C.ghost,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer", "&:hover": { background: C.fog }, transition: "background 0.14s",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{title}</Typography>
          {count != null && (
            <Box sx={{ background: C.mist, borderRadius: "2px", px: 1, py: 0.2 }}>
              <Typography sx={{ ...os({ fontSize: 10, color: C.smoke }) }}>{count}</Typography>
            </Box>
          )}
        </Box>
        {open
          ? <ExpandLessRounded sx={{ fontSize: 16, color: C.ash }} />
          : <ExpandMoreRounded sx={{ fontSize: 16, color: C.ash }} />}
      </Box>
      {open && <Box sx={{ p: 2.5 }}>{children}</Box>}
    </Box>
  );
};

// ─── Metric strip ─────────────────────────────────────────────────────────────
const MetricStrip = ({ items }) => (
  <Box sx={{
    display: "grid",
    gridTemplateColumns: { xs: "1fr 1fr", sm: `repeat(${items.length}, 1fr)` },
    border: `1px solid ${C.fog}`, borderRadius: "4px",
    overflow: "hidden", mb: 2,
  }}>
    {items.map((item, i) => (
      <Box key={item.label} sx={{
        p: 2.5,
        borderRight: i < items.length - 1 ? `1px solid ${C.fog}` : "none",
        "&:hover": { background: C.ghost }, transition: "background 0.14s",
      }}>
        <Label>{item.label}</Label>
        <Typography sx={{ ...os({ fontSize: 16, color: item.color || C.ink, mt: 0.5 }) }}>
          {item.value ?? "—"}
        </Typography>
        {item.sub && (
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 0.25 }) }}>{item.sub}</Typography>
        )}
      </Box>
    ))}
  </Box>
);

// ─── SmallChip ────────────────────────────────────────────────────────────────
const SmallChip = ({ label, bg, color, border }) => (
  <Chip label={label} size="small" sx={{
    fontSize: 10, height: 20, fontFamily: FONT, borderRadius: "2px",
    background: bg || C.ghost, color: color || C.smoke,
    border: `1px solid ${border || C.fog}`,
  }} />
);

// ═══════════════════════════════════════════════════════════════════════════════
// TAB PANELS
// ═══════════════════════════════════════════════════════════════════════════════

// ── Overview ─────────────────────────────────────────────────────────────────
const OverviewPanel = ({ data }) => {
  const agents   = data.agents_completed || [];
  const errors   = data.errors || [];
  const timings  = data.agent_timings || {};

  return (
    <Box>
      <MetricStrip items={[
        { label: "Session ID",     value: data.session_id?.slice(-14) || "—" },
        { label: "Phase",          value: data.phase_detected?.toUpperCase() || "—" },
        { label: "Documents",      value: data.documents_analyzed ?? "—" },
        { label: "Agents Run",     value: agents.length || "—" },
        { label: "Cycles",         value: data.orchestration_cycles ?? "—" },
        { label: "Processing",     value: data.processing_time_ms ? `${(data.processing_time_ms / 1000).toFixed(1)}s` : "—" },
      ]} />

      {agents.length > 0 && (
        <CollapsibleSection title="Agents Completed" count={agents.length} defaultOpen={false}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {agents.map((a) => (
              <Box key={a} sx={{
                px: 1.5, py: 0.4,
                border: `1px solid ${C.fog}`, borderRadius: "2px",
                background: C.white, display: "flex", alignItems: "center", gap: 0.75,
              }}>
                <CheckCircleRounded sx={{ fontSize: 11, color: C.success }} />
                <Typography sx={{ ...os({ fontSize: 11, color: C.smoke }) }}>{a}</Typography>
              </Box>
            ))}
          </Box>
        </CollapsibleSection>
      )}

      {errors.length > 0 && (
        <CollapsibleSection title="Errors" count={errors.length} defaultOpen accent={C.error}>
          {errors.map((e, i) => (
            <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.75 }}>
              <ErrorRounded sx={{ fontSize: 14, color: C.error, flexShrink: 0, mt: 0.1 }} />
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{String(e)}</Typography>
            </Box>
          ))}
        </CollapsibleSection>
      )}
    </Box>
  );
};

// ── Phase Intelligence ────────────────────────────────────────────────────────
const PhaseIntelligencePanel = ({ data }) => {
  if (!data) return <EmptySection />;
  const {
    phase, phase_reasoning, data_quality_score,
    data_quality_notes, molecular_data_confidence,
    entity_classification = {}, clinical_gap_analysis = {},
    pretest_clinical_summary = {},
  } = data;

  const qColor =
    data_quality_score >= 75 ? C.success :
    data_quality_score >= 45 ? C.warn : C.error;

  const classEntries = Object.entries(entity_classification)
    .filter(([, v]) => typeof v === "number" && v > 0)
    .sort((a, b) => b[1] - a[1]);

  return (
    <Box>
      <MetricStrip items={[
        { label: "Phase",               value: phase?.toUpperCase() || "—" },
        { label: "Data Quality",        value: data_quality_score != null ? `${data_quality_score} / 100` : "—", color: qColor },
        { label: "Mol. Confidence",     value: molecular_data_confidence
            ? molecular_data_confidence.charAt(0).toUpperCase() + molecular_data_confidence.slice(1)
            : "—" },
      ]} />

      {phase_reasoning && (
        <Box sx={{ mb: 1.5, p: 2.5, background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "4px" }}>
          <Label>Phase Reasoning</Label>
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7 }) }}>{phase_reasoning}</Typography>
        </Box>
      )}

      {data_quality_notes && (
        <Box sx={{ mb: 1.5, p: 2.5, background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "4px" }}>
          <Label>Data Quality Notes</Label>
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7 }) }}>{data_quality_notes}</Typography>
        </Box>
      )}

      {Object.keys(pretest_clinical_summary).length > 0 && (
        <CollapsibleSection title="Clinical Summary" defaultOpen>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "repeat(3, 1fr)" }, gap: 2 }}>
            {Object.entries(pretest_clinical_summary).map(([k, v]) => (
              <Box key={k}>
                <Label>{k.replace(/_/g, " ")}</Label>
                {renderValue(v)}
              </Box>
            ))}
          </Box>
        </CollapsibleSection>
      )}

      {classEntries.length > 0 && (
        <CollapsibleSection title="Entity Classification" count={classEntries.length} defaultOpen={false}>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {classEntries.map(([key, count]) => (
              <Box key={key} sx={{
                display: "flex", alignItems: "center", gap: 0.75,
                border: `1px solid ${C.fog}`, borderRadius: "2px",
                px: 1.5, py: 0.5, background: C.white,
              }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.smoke }) }}>
                  {key.replace(/_/g, " ")}
                </Typography>
                <Box sx={{ background: C.fog, borderRadius: "2px", px: 0.75 }}>
                  <Typography sx={{ ...os({ fontSize: 10, color: C.charcoal }) }}>{count}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </CollapsibleSection>
      )}

      {/* Gap analysis */}
      {(clinical_gap_analysis?.missing_critical_tests?.length > 0 ||
        clinical_gap_analysis?.recommended_next_tests?.length > 0 ||
        clinical_gap_analysis?.data_gaps_affecting_therapy?.length > 0) && (
        <CollapsibleSection title="Clinical Gap Analysis" defaultOpen={false}>
          {clinical_gap_analysis.missing_critical_tests?.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Label>Missing Critical Tests</Label>
              <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 0.75 }}>
                {clinical_gap_analysis.missing_critical_tests.map((t, i) => (
                  <Box key={i} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <WarningAmberRounded sx={{ fontSize: 13, color: C.warn, flexShrink: 0 }} />
                    <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>
                      {typeof t === "object" ? renderValue(t) : String(t)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {clinical_gap_analysis.recommended_next_tests?.length > 0 && (
            <Box sx={{ mb: 2 }}>
              <Label>Recommended Next Tests</Label>
              <Box sx={{ mt: 0.75, display: "flex", flexDirection: "column", gap: 1 }}>
                {clinical_gap_analysis.recommended_next_tests.map((t, i) => (
                  <Box key={i} sx={{ p: 2, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.white }}>
                    {typeof t === "object" && t !== null ? (
                      <>
                        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 0.75 }}>
                          <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                            {t.test || t.name || "Test"}
                          </Typography>
                          {t.priority && (
                            <SmallChip
                              label={t.priority}
                              bg={t.priority === "urgent" ? "#fbe9e7" : C.ghost}
                              color={urgencyColor(t.priority)}
                            />
                          )}
                        </Box>
                        {t.rationale && (
                          <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>{t.rationale}</Typography>
                        )}
                      </>
                    ) : (
                      <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>{String(t)}</Typography>
                    )}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
          {clinical_gap_analysis.data_gaps_affecting_therapy?.length > 0 && (
            <Box>
              <Label>Data Gaps Affecting Therapy</Label>
              <Box sx={{ mt: 0.75 }}>
                {clinical_gap_analysis.data_gaps_affecting_therapy.map((g, i) => (
                  <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.75 }}>
                    <FiberManualRecordRounded sx={{ fontSize: 8, color: C.ash, mt: 0.6, flexShrink: 0 }} />
                    <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>
                      {typeof g === "object" ? renderValue(g) : String(g)}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </CollapsibleSection>
      )}
    </Box>
  );
};

// ── Molecular Extraction ──────────────────────────────────────────────────────
const MolecularExtractionPanel = ({ extraction, inventory }) => {
  if (!extraction) return <EmptySection />;

  return (
    <Box>
      <MetricStrip items={[
        {
          label: "Molecular Data",
          value: extraction.has_molecular_data ? "Present" : "Absent",
          color: extraction.has_molecular_data ? C.success : C.ash,
        },
        { label: "Entities Found", value: extraction.entity_count ?? 0 },
        {
          label: "Confidence",
          value: extraction.molecular_data_confidence
            ? extraction.molecular_data_confidence.charAt(0).toUpperCase() + extraction.molecular_data_confidence.slice(1)
            : "—",
        },
      ]} />

      {extraction.extraction_summary && (
        <Box sx={{ mb: 1.5, p: 2.5, background: C.ghost, border: `1px solid ${C.fog}`, borderRadius: "4px" }}>
          <Label>Summary</Label>
          <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.7 }) }}>
            {extraction.extraction_summary}
          </Typography>
        </Box>
      )}

      {extraction.key_actionable_findings?.length > 0 && (
        <CollapsibleSection
          title="Key Actionable Findings"
          count={extraction.key_actionable_findings.length}
          defaultOpen
        >
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {extraction.key_actionable_findings.map((f, i) => {
              const finding = typeof f === "object" ? f : { finding: String(f) };
              return (
                <Box key={i} sx={{
                  p: 2, border: `1px solid ${C.fog}`, borderRadius: "4px",
                  background: C.white,
                  borderLeft: `3px solid ${urgencyColor(finding.urgency)}`,
                }}>
                  <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, mb: 0.75 }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                      {finding.finding || finding.name || "Finding"}
                    </Typography>
                    <Box sx={{ display: "flex", gap: 0.75, flexShrink: 0, flexWrap: "wrap" }}>
                      {finding.urgency && (
                        <SmallChip
                          label={finding.urgency}
                          bg={finding.urgency === "immediate" ? "#fbe9e7" : "#fff3e0"}
                          color={urgencyColor(finding.urgency)}
                        />
                      )}
                      {finding.evidence_tier && (
                        <SmallChip label={finding.evidence_tier} color={tierColor(finding.evidence_tier)} />
                      )}
                    </Box>
                  </Box>
                  {finding.therapy_impact && (
                    <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.75 }}>
                      <ArrowForwardRounded sx={{ fontSize: 13, color: C.ash, mt: 0.2, flexShrink: 0 }} />
                      <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>{finding.therapy_impact}</Typography>
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        </CollapsibleSection>
      )}

      {inventory?.length > 0 && (
        <CollapsibleSection title="Molecular Inventory" count={inventory.length} defaultOpen={false}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
            {inventory.map((item, i) => {
              const it = typeof item === "object" ? item : { entity_name: String(item) };
              return (
                <Box key={i} sx={{
                  p: 2.5, border: `1px solid ${C.fog}`, borderRadius: "4px",
                  background: C.white,
                  "&:hover": { background: C.ghost }, transition: "background 0.14s",
                }}>
                  <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1, mb: 1.5 }}>
                    <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                      {it.entity_name || it.name || "Entity"}
                      {it.gene && it.gene !== it.entity_name && (
                        <Box component="span" sx={{ color: C.ash, fontSize: 12, ml: 0.75 }}>({it.gene})</Box>
                      )}
                    </Typography>
                    <Box sx={{ display: "flex", gap: 0.75, flexShrink: 0, flexWrap: "wrap" }}>
                      {it.category && (
                        <SmallChip label={String(it.category).replace(/_/g, " ")} />
                      )}
                      {it.actionability && (
                        <SmallChip
                          label={it.actionability}
                          bg={it.actionability === "immediate" ? "#fbe9e7" : C.ghost}
                          color={urgencyColor(it.actionability)}
                        />
                      )}
                    </Box>
                  </Box>
                  <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 1.5 }}>
                    {[
                      ["result_value",          "Result"],
                      ["clinical_significance",  "Clinical Significance"],
                      ["therapy_relevance",      "Therapy Relevance"],
                      ["source_document",        "Source Document"],
                    ].map(([key, lbl]) => it[key] ? (
                      <Box key={key}>
                        <Label>{lbl}</Label>
                        {renderValue(it[key])}
                      </Box>
                    ) : null)}
                  </Box>
                </Box>
              );
            })}
          </Box>
        </CollapsibleSection>
      )}
    </Box>
  );
};

// ── Clinical Context ───────────────────────────────────────────────────────────
const ClinicalContextPanel = ({ context }) => {
  if (!context) return <EmptySection />;
  const fields = [
    ["demographics_and_stage", "Demographics & Stage"],
    ["histology",              "Histology"],
    ["prior_therapy",          "Prior Therapy"],
    ["fitness",                "Fitness & Performance"],
  ];
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr" }, gap: 2 }}>
      {fields.map(([key, lbl]) => {
        const val = context[key];
        if (!val) return null;
        return (
          <Box key={key} sx={{
            p: 2.5, border: `1px solid ${C.fog}`, borderRadius: "4px",
            background: C.white,
            "&:hover": { borderColor: C.mist, background: C.ghost }, transition: "all 0.15s",
          }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5, pb: 1.5, borderBottom: `1px solid ${C.fog}` }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.smoke, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>
                {lbl}
              </Typography>
              <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: C.charcoal }} />
            </Box>
            {renderValue(val)}
          </Box>
        );
      })}
    </Box>
  );
};

// ── Test Menu ─────────────────────────────────────────────────────────────────
const TestMenuPanel = ({ menu }) => {
  if (!menu) return <EmptySection />;
  const tests = [
    ["genomic_tests",    "Genomic Tests"],
    ["transcriptomic",   "Transcriptomic"],
    ["proteomic_ihc",    "Proteomic / IHC"],
    ["immune_profiling", "Immune Profiling"],
    ["single_cell",      "Single Cell"],
    ["germline",         "Germline"],
    ["liquid_biopsy",    "Liquid Biopsy"],
    ["epigenetic",       "Epigenetic"],
  ];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {tests.map(([key, lbl]) => {
        const val = menu[key];
        if (!val) return null;
        return (
          <CollapsibleSection key={key} title={lbl} defaultOpen={false}>
            {renderValue(val)}
          </CollapsibleSection>
        );
      })}
    </Box>
  );
};

// ── Therapy Report ─────────────────────────────────────────────────────────────
const TherapyReportPanel = ({ report }) => {
  if (!report) return <EmptySection />;
  const sections = [
    ["oncologist_briefing", "Oncologist Briefing",  true],
    ["personalised_report", "Personalised Report",  false],
    ["evidence_grades",     "Evidence Grades",       false],
    ["patient_summary",     "Patient Summary",       false],
    ["therapy_ranked",      "Ranked Therapy List",   false],
    ["combination_regimen", "Combination Regimen",   false],
    ["resistance_analysis", "Resistance Analysis",   false],
    ["tme_analysis",        "TME Analysis",          false],
    ["trial_matches",       "Clinical Trial Matches",false],
    ["safety",              "Safety",                false],
    ["cellular_therapy",    "Cellular Therapy",      false],
    ["audit_trail",         "Audit Trail",           false],
  ];
  return (
    <Box>
      {sections.map(([key, lbl, defOpen]) => {
        const val = report[key];
        if (!val) return null;
        return (
          <CollapsibleSection key={key} title={lbl} defaultOpen={defOpen}>
            {renderValue(val)}
          </CollapsibleSection>
        );
      })}
    </Box>
  );
};

// ── Empty / Loading helpers ────────────────────────────────────────────────────
const EmptySection = () => (
  <Box sx={{ py: 4, textAlign: "center" }}>
    <Typography sx={{ ...os({ fontSize: 13, color: C.silver }) }}>No data for this section</Typography>
  </Box>
);

const LoadingState = ({ phase }) => (
  <Box sx={{ py: 5, display: "flex", flexDirection: "column", alignItems: "center", gap: 2.5 }}>
    <RefreshRounded sx={{
      fontSize: 32, color: C.ash,
      animation: "genomicsSpin 1s linear infinite",
      "@keyframes genomicsSpin": {
        "0%": { transform: "rotate(0deg)" },
        "100%": { transform: "rotate(360deg)" },
      },
    }} />
    <Box sx={{ textAlign: "center" }}>
      <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal }) }}>
        Running {phase === "pretest" ? "Pre-Test" : "Full"} Genomic Analysis
      </Typography>
      <Typography sx={{ ...os({ fontSize: 11, color: C.silver, mt: 0.5 }) }}>
        PhaseDetectorAgent · OrchestratorAgent · SpecialistAgents
      </Typography>
    </Box>
    <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", justifyContent: "center" }}>
      {["P1–P4", "T1–T8", ...(phase === "full" ? ["M1–M9", "D1–D10", "O1–O7"] : [])].map((lbl) => (
        <Box key={lbl} sx={{
          px: 1.5, py: 0.5,
          border: `1px solid ${C.fog}`, borderRadius: "2px", background: C.white,
          animation: "genomicsPulse 1.6s ease-in-out infinite",
          "@keyframes genomicsPulse": {
            "0%,100%": { opacity: 0.35 }, "50%": { opacity: 1 },
          },
        }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash, letterSpacing: "0.06em" }) }}>{lbl}</Typography>
        </Box>
      ))}
    </Box>
  </Box>
);

const EmptyState = () => (
  <Box sx={{ py: 6, textAlign: "center" }}>
    <BiotechRounded sx={{ fontSize: 36, color: C.mist, mb: 2 }} />
    <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No analysis results yet</Typography>
    <Typography sx={{ ...os({ fontSize: 12, color: C.silver, mt: 0.5 }) }}>
      Run Pre-Test or Full Analysis to see results
    </Typography>
  </Box>
);

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════════════════════
export default function GenomicsPanel({ patientId, doctorId }) {
  const [loading,      setLoading]      = useState(false);
  const [activePhase,  setActivePhase]  = useState(null);
  const [responseData, setResponseData] = useState(null);
  const [error,        setError]        = useState(null);
  const [tab,          setTab]          = useState(0);

  const runAnalysis = async (phaseHint) => {
    setLoading(true);
    setActivePhase(phaseHint);
    setError(null);
    setResponseData(null);
    setTab(0);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/genomics/analyse`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id:            patientId,
          doctor_id:             doctorId,
          specialty:             "Oncology",
          phase_hint:            phaseHint,
          include_intermediates: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail || "Analysis failed");
      setResponseData(data);
    } catch (err) {
      setError(err.message || "Unexpected error");
    } finally {
      setLoading(false);
    }
  };

  // ── Tab definitions (only show when data present) ──────────────────────────
  const tabDefs = [
    
    { label: "Molecular",          show: !!responseData?.molecular_extraction?.has_molecular_data },
    { label: "Clinical Context",   show: !!responseData?.clinical_context },
    { label: "Precision Test",          show: !!responseData?.recommended_test_menu },
    { label: "Therapy Report",     show: !!responseData?.therapy_report },
  ].filter((t) => t.always || t.show);

  const activeTabLabel = tabDefs[tab]?.label ?? "Overview";

  // Guard tab index against disappearing tabs after new run
  const safeTab = Math.min(tab, tabDefs.length - 1);

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <Box sx={{
        px: { xs: 2.5, sm: 3 }, py: 2,
        borderBottom: `1px solid ${C.fog}`, background: C.ghost,
        display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        gap: 2, flexWrap: "wrap",
      }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>
            Genomic Analysis
          </Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            POIS v4 · AI-powered precision oncology pipeline
          </Typography>
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", flexShrink: 0 }}>
          <Box component="button" disabled={loading} onClick={() => runAnalysis("pretest")}
            sx={{ ...ghostButton, opacity: loading ? 0.5 : 1 }}>
            <BiotechRounded sx={{ fontSize: 14 }} />
            Pre-Test
          </Box>
          <Box component="button" disabled={loading} onClick={() => runAnalysis("full")}
            sx={{ ...actionButton, opacity: loading ? 0.5 : 1 }}>
            <ScienceRounded sx={{ fontSize: 14 }} />
            Full Analysis
          </Box>
        </Box>
      </Box>

      {/* ── Status bar ─────────────────────────────────────────────────────── */}
      {responseData && !loading && (
        <Box sx={{
          px: { xs: 2.5, sm: 3 }, py: 1.25,
          borderBottom: `1px solid ${C.fog}`, background: C.white,
          display: "flex", alignItems: "center",
          justifyContent: "space-between", gap: 2, flexWrap: "wrap",
        }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <CheckCircleRounded sx={{ fontSize: 15, color: C.success }} />
            <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
              {responseData.phase_detected === "full" ? "Full" : "Pre-Test"} analysis complete
              {responseData.agents_completed?.length ? ` · ${responseData.agents_completed.length} agents` : ""}
              {responseData.orchestration_cycles ? ` · ${responseData.orchestration_cycles} cycles` : ""}
              {responseData.processing_time_ms ? ` · ${(responseData.processing_time_ms / 1000).toFixed(1)}s` : ""}
            </Typography>
          </Box>
          <Box sx={{ display: "flex", gap: 0.75 }}>
            <SmallChip label={responseData.phase_detected === "full" ? "Full Pipeline" : "Pretest Only"} />
            <SmallChip label={responseData.version?.split("-").slice(-2).join("-") || "v4"} color={C.silver} />
          </Box>
        </Box>
      )}

      {/* ── Error ──────────────────────────────────────────────────────────── */}
      {error && !loading && (
        <Box sx={{
          mx: 3, mt: 3, mb: 1, p: 2.5,
          border: "1px solid #ffcdd2", borderRadius: "4px", background: "#fbe9e7",
          display: "flex", alignItems: "flex-start", gap: 1.5,
        }}>
          <ErrorRounded sx={{ fontSize: 16, color: C.error, flexShrink: 0, mt: 0.1 }} />
          <Box>
            <Typography sx={{ ...os({ fontSize: 12, color: C.error }) }}>Analysis failed</Typography>
            <Typography sx={{ ...os({ fontSize: 12, color: "#c62828", mt: 0.25 }) }}>{error}</Typography>
          </Box>
        </Box>
      )}

      {/* ── Loading ────────────────────────────────────────────────────────── */}
      {loading && (
        <Box sx={{ px: { xs: 2.5, sm: 3 }, py: 2 }}>
          <LoadingState phase={activePhase} />
        </Box>
      )}

      {/* ── Empty ──────────────────────────────────────────────────────────── */}
      {!loading && !responseData && !error && <EmptyState />}

      {/* ── Results ────────────────────────────────────────────────────────── */}
      {!loading && responseData && (
        <>
          <Tabs
            value={safeTab}
            onChange={(_, v) => setTab(v)}
            variant="scrollable" scrollButtons="auto" allowScrollButtonsMobile
            sx={{ ...tabSx, px: 3 }}
          >
            {tabDefs.map((t) => <Tab key={t.label} label={t.label} />)}
          </Tabs>

          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            {activeTabLabel === "Overview"           && <OverviewPanel data={responseData} />}
            {activeTabLabel === "Phase Intelligence" && <PhaseIntelligencePanel data={responseData.phase_intelligence} />}
            {activeTabLabel === "Molecular"          && (
              <MolecularExtractionPanel
                extraction={responseData.molecular_extraction}
                inventory={
                  responseData.phase_intelligence?.molecular_inventory ||
                  responseData.intermediate?.molecular_results_full?.raw_molecular_entities
                }
              />
            )}
            {activeTabLabel === "Clinical Context"   && <ClinicalContextPanel context={responseData.clinical_context} />}
            {activeTabLabel === "Precision Test"          && <TestMenuPanel menu={responseData.recommended_test_menu} />}
            {activeTabLabel === "Therapy Report"     && <TherapyReportPanel report={responseData.therapy_report} />}
          </Box>
        </>
      )}
    </Box>
  );
}