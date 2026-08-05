import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Chip,
  Collapse,
  IconButton,
  Tooltip,
  Tab,
  Tabs,
} from "@mui/material";
import {
  WarningAmberRounded,
  ExpandMore,
  ExpandLess,
  RefreshRounded,
  ErrorOutline,
  Healing,
  Assignment,
  Biotech,
  Science,
  MonitorHeart,
  ReportProblem,
  Description,
  Timeline,
  LocalHospital,
} from "@mui/icons-material";

// ─── Design Tokens (exact match from DoctorDashboard) ────────────────────────
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
};

const os = (extra = {}) => ({
  fontFamily: FONT,
  fontWeight: FW,
  ...extra,
});

const sectionCard = {
  background: C.white,
  border: `1px solid ${C.fog}`,
  borderRadius: "4px",
  overflow: "hidden",
};

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── Section Header (exact match from Dashboard) ──────────────────────────────
const SectionHeader = ({ children, sub, action, icon }) => (
  <Box
    sx={{
      px: { xs: 2.5, sm: 3 },
      pt: { xs: 2.5, sm: 3 },
      pb: 2,
      borderBottom: `1px solid ${C.fog}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 2,
      flexWrap: "wrap",
    }}
  >
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
      {icon && (
        <Box sx={{ color: C.ash, display: "flex", alignItems: "center" }}>
          {icon}
        </Box>
      )}
      <Box>
        <Typography
          sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}
        >
          {children}
        </Typography>
        {sub && (
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {sub}
          </Typography>
        )}
      </Box>
    </Box>
    {action && <Box sx={{ flexShrink: 0 }}>{action}</Box>}
  </Box>
);

// ─── Concerning Values Table ──────────────────────────────────────────────────
const ConcerningValuesTable = ({ values }) => {
  if (!values || values.length === 0) return null;
  return (
    <Box sx={{ mt: 1.5, overflowX: "auto" }}>
      <Typography
        sx={{
          ...os({
            fontSize: 10,
            color: C.smoke,
            fontWeight: 400,
            textTransform: "uppercase",
            letterSpacing: "0.07em",
            mb: 0.75,
          }),
        }}
      >
        Concerning Values
      </Typography>
      <Box
        component="table"
        sx={{
          width: "100%",
          borderCollapse: "collapse",
          border: `1px solid ${C.fog}`,
          borderRadius: "2px",
          overflow: "hidden",
          fontFamily: FONT,
          fontWeight: FW,
        }}
      >
        <Box component="thead">
          <Box component="tr" sx={{ background: C.ghost }}>
            <Box
              component="th"
              sx={{
                ...os({
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  textAlign: "left",
                  px: 2,
                  py: 1,
                  borderBottom: `1px solid ${C.fog}`,
                  fontWeight: 400,
                }),
              }}
            >
              #
            </Box>
            <Box
              component="th"
              sx={{
                ...os({
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  textAlign: "left",
                  px: 2,
                  py: 1,
                  borderBottom: `1px solid ${C.fog}`,
                  fontWeight: 400,
                }),
              }}
            >
              Finding
            </Box>
          </Box>
        </Box>
        <Box component="tbody">
          {values.map((val, idx) => (
            <Box
              component="tr"
              key={idx}
              sx={{
                borderBottom:
                  idx < values.length - 1 ? `1px solid ${C.fog}` : "none",
                "&:hover": { background: C.ghost },
                transition: "background 0.12s",
              }}
            >
              <Box
                component="td"
                sx={{
                  ...os({
                    fontSize: 11,
                    color: C.silver,
                    px: 2,
                    py: 1,
                    verticalAlign: "top",
                    width: 32,
                  }),
                }}
              >
                {idx + 1}
              </Box>
              <Box
                component="td"
                sx={{
                  ...os({
                    fontSize: 12,
                    color: C.charcoal,
                    px: 2,
                    py: 1,
                    lineHeight: 1.5,
                    verticalAlign: "top",
                  }),
                }}
              >
                {val}
              </Box>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const TriageAssessment = ({
  data: propData,
  patientId,
  doctorId,
  refreshTrigger = 0,
}) => {
  const [data, setData] = useState(propData || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [debugInfo, setDebugInfo] = useState(null);
  const [activeTab, setActiveTab] = useState(0);
  const [expandedSections, setExpandedSections] = useState({
    redFlags: true,
    immediateActions: true,
    abcde: true,
    differentials: true,
    riskScores: false,
    triageNote: false,
    clinicalFindings: false,
    triageSummary: false,
  });

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({ ...prev, [section]: !prev[section] }));
  };

  const fetchTriageAssessment = async () => {
    if (propData) {
      setData(propData);
      return;
    }
    if (!patientId) {
      setError("No patient ID provided");
      return;
    }
    setLoading(true);
    setError(null);
    setDebugInfo(null);
    try {
      const url = `${API_BASE_URL}hms/users/data/context/get_latest_simple_triage/${patientId}`;
      const response = await fetch(url, {
        method: "GET",
        headers: { "Content-Type": "application/json" },
      });
      setDebugInfo((prev) => ({ ...prev, status: response.status }));
      if (response.status === 404) {
        setError("No triage assessment available. Please run triage assessment first.");
        setData(null);
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      const result = await response.json();
      setDebugInfo((prev) => ({ ...prev, result }));
      let triageData = null;
      if (result.status === "success" && result.data) {
        triageData = result.data;
      } else if (result.data && !result.status) {
        triageData = result.data;
      } else if (result.triage_level || result.red_flags) {
        triageData = result;
      } else {
        setError("Invalid response format from server");
        setData(null);
        return;
      }
      if (triageData) {
        setData(triageData);
        setError(null);
      } else {
        setError("No triage assessment available");
        setData(null);
      }
    } catch (err) {
      setError(err.message || "Failed to load triage assessment");
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!propData) {
      fetchTriageAssessment();
    }
  }, [patientId, refreshTrigger, propData]);

  useEffect(() => {
    if (propData) {
      setData(propData);
      setError(null);
    }
  }, [propData]);

  // ─── Data extraction with fallbacks ────────────────────────────────────────
  const getLevelLabel = (level) => {
    const labels = {
      1: "Resuscitation",
      2: "Emergent",
      3: "Urgent",
      4: "Semi-urgent",
      5: "Non-urgent",
    };
    return labels[level] || "Unknown";
  };

  const triageLevel =
    data?.triage_level ||
    data?.classification_detail?.triage_level ||
    1;
  const triageLabel =
    data?.triage_level_label ||
    data?.classification_detail?.triage_level_label ||
    getLevelLabel(triageLevel);
  const zone =
    data?.zone || data?.classification_detail?.zone || "Resuscitation Bay";
  const zoneColor =
    data?.zone_color || data?.classification_detail?.zone_color || "Red";
  const targetTime =
    data?.target_time_minutes ||
    data?.classification_detail?.target_time_minutes ||
    5;
  const disposition =
    data?.clinical_disposition ||
    data?.classification_detail?.clinical_disposition_recommendation ||
    "Admit";

  const redFlagsData = data?.red_flags || {};
  const redFlagsList = redFlagsData.red_flags || [];
  const cannotMissDiagnoses = redFlagsData.cannot_miss_diagnoses || [];
  const immediateActionsList = data?.immediate_actions || [];
  const abcdeData = data?.abcde || {};
  const differentialsData = data?.differentials || {};
  const differentialsList = differentialsData.differentials || [];
  const workingDiagnosis = differentialsData.working_diagnosis || {};
  const riskScoresData = data?.risk_scores || {};
  const triageNarrative = data?.triage_narrative || {};
  const oneLiner = triageNarrative.one_liner || "";
  const triageNote = triageNarrative.triage_note || "";
  const monitoringPlan = data?.monitoring_plan || {};
  const clinicalFindings = data?.clinical_findings || {};
  const transferDecision = data?.transfer_decision || {};
  const referralsNeeded = data?.referrals_needed || [];
  const riskAnalysis = data?.risk_analysis || {};
  const dispositionPlan = data?.disposition_plan || "";
  const triageSummary = data?.triage_summary || "";
  const whyThisLevel = data?.why_this_level || "";
  const whyThisStandard = data?.why_this_standard || "";
  const triageStandard =
    data?.triage_standard || data?.triage_standard_used || "ESI";
  const triageCategory = data?.triage_category || "";
  const appointmentId = data?.appointment_id || "";

  // ─── Loading state ─────────────────────────────────────────────────────────
  if (loading) {
    return (
      <Box sx={{ ...sectionCard, p: 4, textAlign: "center" }}>
        <Box
          sx={{ display: "inline-flex", alignItems: "center", gap: 1 }}
        >
          <Box
            sx={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: `2px solid ${C.mist}`,
              borderTopColor: C.charcoal,
              animation: "spin 0.8s linear infinite",
              "@keyframes spin": { to: { transform: "rotate(360deg)" } },
            }}
          />
          <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
            Loading triage assessment...
          </Typography>
        </Box>
      </Box>
    );
  }

  // ─── Error / empty state ───────────────────────────────────────────────────
  if (error || !data) {
    return (
      <Box sx={{ ...sectionCard }}>
        <Box sx={{ p: 4, textAlign: "center" }}>
          <ReportProblem sx={{ fontSize: 36, color: C.mist, mb: 1.5 }} />
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, mb: 0.5 }) }}>
            No Triage Assessment Available
          </Typography>
          <Typography sx={{ ...os({ fontSize: 12, color: C.ash, mb: 2 }) }}>
            {error || "Please run triage assessment to see results"}
          </Typography>
       
          <Box
            component="button"
            onClick={fetchTriageAssessment}
            sx={{
              px: 3,
              py: 1,
              borderRadius: "2px",
              fontSize: 12,
              fontWeight: 400,
              fontFamily: FONT,
              textTransform: "none",
              background: C.black,
              color: C.white,
              border: "none",
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 1,
              transition: "background 0.18s",
              "&:hover": { background: C.charcoal },
            }}
          >
            <RefreshRounded sx={{ fontSize: 14 }} />
            Refresh / Check Again
          </Box>
        </Box>
      </Box>
    );
  }

  // ─── Tab 1: Plan ───────────────────────────────────────────────────────────
  const renderTab1 = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

      {/* Triage Summary */}
      {triageSummary && (
        <Box sx={sectionCard}>
          <SectionHeader
            icon={<Description sx={{ fontSize: 16, color: C.ash }} />}
            sub="AI-generated clinical summary"
            action={
              <IconButton
                size="small"
                onClick={() => toggleSection("triageSummary")}
              >
                {expandedSections.triageSummary ? (
                  <ExpandLess sx={{ fontSize: 16, color: C.ash }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 16, color: C.ash }} />
                )}
              </IconButton>
            }
          >
            Triage Summary
          </SectionHeader>
          <Collapse in={expandedSections.triageSummary}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography
                sx={{
                  ...os({
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: C.charcoal,
                  }),
                }}
              >
                {triageSummary}
              </Typography>
              {(whyThisLevel || whyThisStandard) && (
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    background: C.ghost,
                    borderRadius: "2px",
                    border: `1px solid ${C.fog}`,
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.75,
                        fontWeight: 400,
                      }),
                    }}
                  >
                    Clinical Reasoning
                  </Typography>
                  {whyThisLevel && (
                    <Typography
                      sx={{ ...os({ fontSize: 11, color: C.smoke, mb: 0.5 }) }}
                    >
                      • {whyThisLevel}
                    </Typography>
                  )}
                  {whyThisStandard && (
                    <Typography sx={{ ...os({ fontSize: 11, color: C.smoke }) }}>
                      • {whyThisStandard}
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      )}

      {/* Risk Analysis */}
      {riskAnalysis.level && (
        <Box sx={sectionCard}>
          <Box
            sx={{
              px: { xs: 2.5, sm: 3 },
              pt: { xs: 2.5, sm: 3 },
              pb: 2,
              borderBottom: `1px solid ${C.fog}`,
            }}
          >
            <Typography
              sx={{
                ...os({
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  fontWeight: 400,
                }),
              }}
            >
              Risk Analysis
            </Typography>
          </Box>
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography
              sx={{
                ...os({
                  fontSize: 13,
                  fontWeight: 400,
                  color: C.ink,
                  mb: 1,
                }),
              }}
            >
              Risk Level: {riskAnalysis.level}
            </Typography>
            {riskAnalysis.reasoning && (
              <Typography
                sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 1 }) }}
              >
                {riskAnalysis.reasoning}
              </Typography>
            )}
            {riskAnalysis.deterioration_risk && (
              <Box
                sx={{
                  mt: 1,
                  pt: 1.5,
                  borderTop: `1px solid ${C.fog}`,
                }}
              >
                <Typography
                  sx={{
                    ...os({ fontSize: 11, color: C.smoke, fontStyle: "italic" }),
                  }}
                >
                  {riskAnalysis.deterioration_risk}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Disposition Plan */}
      {dispositionPlan && (
        <Box sx={sectionCard}>
          <Box
            sx={{
              px: { xs: 2.5, sm: 3 },
              pt: { xs: 2.5, sm: 3 },
              pb: 2,
              borderBottom: `1px solid ${C.fog}`,
            }}
          >
            <Typography
              sx={{
                ...os({
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  fontWeight: 400,
                }),
              }}
            >
              Disposition Plan
            </Typography>
          </Box>
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography
              sx={{ ...os({ fontSize: 14, fontWeight: 400, color: C.ink }) }}
            >
              {dispositionPlan}
            </Typography>
            {disposition === "Admit" && (
              <Typography
                sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.5 }) }}
              >
                Patient requires admission
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Monitoring Plan */}
      {monitoringPlan.vital_signs_frequency && (
        <Box sx={sectionCard}>
          <Box
            sx={{
              px: { xs: 2.5, sm: 3 },
              pt: { xs: 2.5, sm: 3 },
              pb: 2,
              borderBottom: `1px solid ${C.fog}`,
            }}
          >
            <Typography
              sx={{
                ...os({
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  fontWeight: 400,
                }),
              }}
            >
              Monitoring Plan
            </Typography>
          </Box>
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)" },
                gap: 2,
                mb: 2,
              }}
            >
              <Box>
                <Typography
                  sx={{
                    ...os({
                      fontSize: 10,
                      color: C.ash,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      mb: 0.5,
                    }),
                  }}
                >
                  Vital Signs Frequency
                </Typography>
                <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                  {monitoringPlan.vital_signs_frequency}
                </Typography>
              </Box>
              {monitoringPlan.reassessment_timing && (
                <Box>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.5,
                      }),
                    }}
                  >
                    Reassessment
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>
                    {monitoringPlan.reassessment_timing}
                  </Typography>
                </Box>
              )}
            </Box>

            {monitoringPlan.specific_parameters_to_watch &&
              monitoringPlan.specific_parameters_to_watch.length > 0 && (
                <Box sx={{ mb: 2 }}>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.75,
                      }),
                    }}
                  >
                    Parameters to Watch
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {monitoringPlan.specific_parameters_to_watch.map(
                      (param, idx) => (
                        <Chip
                          key={idx}
                          label={param}
                          size="small"
                          sx={{
                            fontSize: 11,
                            background: C.ghost,
                            color: C.smoke,
                            border: `1px solid ${C.fog}`,
                            borderRadius: "2px",
                            ...os(),
                          }}
                        />
                      )
                    )}
                  </Box>
                </Box>
              )}

            {monitoringPlan.escalation_triggers && (
              <Box
                sx={{
                  pt: 1.5,
                  borderTop: `1px solid ${C.fog}`,
                }}
              >
                <Typography
                  sx={{
                    ...os({
                      fontSize: 10,
                      color: C.ash,
                      textTransform: "uppercase",
                      letterSpacing: "0.07em",
                      mb: 0.75,
                    }),
                  }}
                >
                  Escalation Triggers
                </Typography>
                {Array.isArray(monitoringPlan.escalation_triggers) &&
                  monitoringPlan.escalation_triggers.map((trigger, idx) => (
                    <Typography
                      key={idx}
                      sx={{
                        ...os({ fontSize: 11, color: C.smoke, ml: 1, mb: 0.25 }),
                      }}
                    >
                      • {trigger}
                    </Typography>
                  ))}
                {typeof monitoringPlan.escalation_triggers === "string" && (
                  <Typography
                    sx={{ ...os({ fontSize: 11, color: C.smoke, ml: 1 }) }}
                  >
                    • {monitoringPlan.escalation_triggers}
                  </Typography>
                )}
              </Box>
            )}
          </Box>
        </Box>
      )}

      {/* Transfer Decision */}
      {transferDecision.required !== undefined && (
        <Box sx={sectionCard}>
          <Box
            sx={{
              px: { xs: 2.5, sm: 3 },
              pt: { xs: 2.5, sm: 3 },
              pb: 2,
              borderBottom: `1px solid ${C.fog}`,
            }}
          >
            <Typography
              sx={{
                ...os({
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  fontWeight: 400,
                }),
              }}
            >
              Transfer Decision
            </Typography>
          </Box>
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            <Typography
              sx={{ ...os({ fontSize: 13, fontWeight: 400, color: C.ink, mb: 0.5 }) }}
            >
              {transferDecision.required
                ? "Transfer Required"
                : "No Transfer Required"}
            </Typography>
            {transferDecision.destination && (
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mb: 0.25 }) }}>
                Destination: {transferDecision.destination}
              </Typography>
            )}
            {transferDecision.reason && (
              <Typography sx={{ ...os({ fontSize: 11, color: C.smoke }) }}>
                Reason: {transferDecision.reason}
              </Typography>
            )}
          </Box>
        </Box>
      )}

      {/* Referrals */}
      {referralsNeeded.length > 0 && (
        <Box sx={sectionCard}>
          <Box
            sx={{
              px: { xs: 2.5, sm: 3 },
              pt: { xs: 2.5, sm: 3 },
              pb: 2,
              borderBottom: `1px solid ${C.fog}`,
            }}
          >
            <Typography
              sx={{
                ...os({
                  fontSize: 10,
                  color: C.ash,
                  textTransform: "uppercase",
                  letterSpacing: "0.07em",
                  fontWeight: 400,
                }),
              }}
            >
              Referrals Needed
            </Typography>
          </Box>
          <Box sx={{ p: { xs: 2, sm: 3 } }}>
            <Box
              sx={{
                display: "grid",
                gridTemplateColumns: {
                  xs: "1fr",
                  sm: "repeat(2, 1fr)",
                  md: "repeat(3, 1fr)",
                },
                gap: 1.5,
              }}
            >
              {referralsNeeded.map((referral, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 1.5,
                    background: C.ghost,
                    borderRadius: "2px",
                    border: `1px solid ${C.fog}`,
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 12,
                        fontWeight: 400,
                        color: C.ink,
                        mb: 0.25,
                      }),
                    }}
                  >
                    {referral.specialty || referral}
                  </Typography>
                  {referral.urgency && (
                    <Typography
                      sx={{ ...os({ fontSize: 10, color: C.ash, mb: 0.25 }) }}
                    >
                      Urgency: {referral.urgency}
                    </Typography>
                  )}
                  {referral.reason && (
                    <Typography
                      sx={{ ...os({ fontSize: 10, color: C.smoke }) }}
                    >
                      {referral.reason}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}

      {/* Full Triage Note */}
      {triageNote && (
        <Box sx={sectionCard}>
          <SectionHeader
            icon={<Description sx={{ fontSize: 16, color: C.ash }} />}
            sub="Complete triage documentation"
            action={
              <IconButton
                size="small"
                onClick={() => toggleSection("triageNote")}
              >
                {expandedSections.triageNote ? (
                  <ExpandLess sx={{ fontSize: 16, color: C.ash }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 16, color: C.ash }} />
                )}
              </IconButton>
            }
          >
            Full Triage Note
          </SectionHeader>
          <Collapse in={expandedSections.triageNote}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              <Typography
                sx={{
                  ...os({
                    fontSize: 12,
                    lineHeight: 1.7,
                    color: C.charcoal,
                    whiteSpace: "pre-wrap",
                  }),
                }}
              >
                {triageNote}
              </Typography>
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );

  // ─── Tab 2: Immediate ──────────────────────────────────────────────────────
  const renderTab2 = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

      {/* Red Flags */}
      {redFlagsList.length > 0 && (
        <Box sx={sectionCard}>
          <SectionHeader
            icon={<ErrorOutline sx={{ fontSize: 16, color: C.ash }} />}
            sub="Critical findings requiring immediate attention"
            action={
              <IconButton
                size="small"
                onClick={() => toggleSection("redFlags")}
              >
                {expandedSections.redFlags ? (
                  <ExpandLess sx={{ fontSize: 16, color: C.ash }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 16, color: C.ash }} />
                )}
              </IconButton>
            }
          >
            Red Flags ({redFlagsList.length})
          </SectionHeader>
          <Collapse in={expandedSections.redFlags}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              {redFlagsList.map((flag, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 2,
                    mb: 1.5,
                    background: C.ghost,
                    borderRadius: "2px",
                    borderLeft: `3px solid ${C.charcoal}`,
                    "&:last-child": { mb: 0 },
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 13,
                        fontWeight: 400,
                        color: C.ink,
                        mb: 0.5,
                      }),
                    }}
                  >
                    {flag.flag || flag}
                  </Typography>
                  {flag.category && (
                    <Box
                      sx={{
                        display: "flex",
                        gap: 2,
                        flexWrap: "wrap",
                        mb: 0.5,
                      }}
                    >
                      <Typography
                        sx={{ ...os({ fontSize: 11, color: C.ash }) }}
                      >
                        Category: {flag.category}
                      </Typography>
                      {flag.severity && (
                        <Typography
                          sx={{ ...os({ fontSize: 11, color: C.smoke }) }}
                        >
                          Severity: {flag.severity}
                        </Typography>
                      )}
                    </Box>
                  )}
                  {flag.evidence_basis && (
                    <Typography
                      sx={{
                        ...os({ fontSize: 10, color: C.ash, mb: 0.5 }),
                      }}
                    >
                      Evidence: {flag.evidence_basis}
                    </Typography>
                  )}
                  {flag.required_response && (
                    <Typography
                      sx={{
                        ...os({ fontSize: 11, color: C.smoke, mt: 0.5 }),
                      }}
                    >
                      Response: {flag.required_response}{" "}
                      {flag.response_timeframe &&
                        `(${flag.response_timeframe})`}
                    </Typography>
                  )}
                </Box>
              ))}

              {cannotMissDiagnoses.length > 0 && (
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    background: C.ghost,
                    borderRadius: "2px",
                    border: `1px solid ${C.fog}`,
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        fontWeight: 400,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.75,
                      }),
                    }}
                  >
                    Cannot Miss Diagnoses
                  </Typography>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                    {cannotMissDiagnoses.map((dx, idx) => (
                      <Chip
                        key={idx}
                        label={dx}
                        size="small"
                        sx={{
                          fontSize: 11,
                          background: C.white,
                          color: C.charcoal,
                          border: `1px solid ${C.mist}`,
                          borderRadius: "2px",
                          ...os(),
                        }}
                      />
                    ))}
                  </Box>
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      )}

      {/* Immediate Actions */}
      {immediateActionsList.length > 0 && (
        <Box sx={sectionCard}>
          <SectionHeader
            icon={<Healing sx={{ fontSize: 16, color: C.ash }} />}
            sub="Time-critical interventions required"
            action={
              <IconButton
                size="small"
                onClick={() => toggleSection("immediateActions")}
              >
                {expandedSections.immediateActions ? (
                  <ExpandLess sx={{ fontSize: 16, color: C.ash }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 16, color: C.ash }} />
                )}
              </IconButton>
            }
          >
            Immediate Actions ({immediateActionsList.length})
          </SectionHeader>
          <Collapse in={expandedSections.immediateActions}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              {immediateActionsList.map((action, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 2,
                    mb: 1.5,
                    background: C.ghost,
                    borderRadius: "2px",
                    borderLeft: `3px solid ${C.ink}`,
                    "&:last-child": { mb: 0 },
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 13,
                        fontWeight: 400,
                        color: C.ink,
                        mb: 0.5,
                      }),
                    }}
                  >
                    {action.action || action}
                  </Typography>
                  {(action.priority || action.who) && (
                    <Box sx={{ display: "flex", gap: 2, flexWrap: "wrap" }}>
                      {action.priority && (
                        <Typography
                          sx={{ ...os({ fontSize: 11, color: C.ash }) }}
                        >
                          Priority: {action.priority}
                        </Typography>
                      )}
                      {action.who && (
                        <Typography
                          sx={{ ...os({ fontSize: 11, color: C.ash }) }}
                        >
                          By: {action.who}
                        </Typography>
                      )}
                    </Box>
                  )}
                  {action.rationale && (
                    <Typography
                      sx={{
                        ...os({ fontSize: 11, color: C.smoke, mt: 0.5 }),
                      }}
                    >
                      Rationale: {action.rationale}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          </Collapse>
        </Box>
      )}

      {/* ABCDE Assessment */}
      {abcdeData && Object.keys(abcdeData).length > 0 && (
        <Box sx={sectionCard}>
          <SectionHeader
            icon={<Assignment sx={{ fontSize: 16, color: C.ash }} />}
            sub="Systematic primary survey"
            action={
              <IconButton
                size="small"
                onClick={() => toggleSection("abcde")}
              >
                {expandedSections.abcde ? (
                  <ExpandLess sx={{ fontSize: 16, color: C.ash }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 16, color: C.ash }} />
                )}
              </IconButton>
            }
          >
            ABCDE Assessment
          </SectionHeader>
          <Collapse in={expandedSections.abcde}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "repeat(2, 1fr)" },
                  gap: 1.5,
                }}
              >
                {Object.entries(abcdeData).map(([key, value]) => {
                  if (key === "abcde_summary" || !value?.status) return null;
                  const displayName = key
                    .replace(/^[A-Z]_/, "")
                    .replace(/_/g, " ")
                    .toUpperCase();
                  return (
                    <Box
                      key={key}
                      sx={{
                        p: 1.5,
                        background: C.ghost,
                        borderRadius: "2px",
                        border: `1px solid ${C.fog}`,
                        borderLeft: `3px solid ${C.charcoal}`,
                      }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          mb: 0.5,
                        }}
                      >
                        <Typography
                          sx={{
                            ...os({
                              fontSize: 11,
                              fontWeight: 400,
                              color: C.smoke,
                              textTransform: "uppercase",
                              letterSpacing: "0.06em",
                            }),
                          }}
                        >
                          {displayName}
                        </Typography>
                        <Typography
                          sx={{
                            ...os({
                              fontSize: 11,
                              color: C.ink,
                              fontWeight: 400,
                            }),
                          }}
                        >
                          {value.status}
                        </Typography>
                      </Box>
                      {value.rationale && (
                        <Typography
                          sx={{ ...os({ fontSize: 11, color: C.smoke }) }}
                        >
                          {value.rationale}
                        </Typography>
                      )}
                      {value.interventions &&
                        value.interventions.length > 0 && (
                          <Typography
                            sx={{
                              ...os({ fontSize: 10, color: C.ash, mt: 0.5 }),
                            }}
                          >
                            Interventions: {value.interventions.join(", ")}
                          </Typography>
                        )}
                    </Box>
                  );
                })}
              </Box>

              {abcdeData.abcde_summary && (
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    background: C.ghost,
                    borderRadius: "2px",
                    border: `1px solid ${C.fog}`,
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.5,
                      }),
                    }}
                  >
                    Summary
                  </Typography>
                  <Typography
                    sx={{ ...os({ fontSize: 12, fontWeight: 400, color: C.ink, mb: 0.5 }) }}
                  >
                    {abcdeData.abcde_summary.overall_stability || "Stable"}
                  </Typography>
                  {abcdeData.abcde_summary.rationale && (
                    <Typography
                      sx={{ ...os({ fontSize: 11, color: C.smoke }) }}
                    >
                      {abcdeData.abcde_summary.rationale}
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );

  // ─── Tab 3: Diagnostics ────────────────────────────────────────────────────
  const renderTab3 = () => (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>

      {/* Differentials */}
      {differentialsList.length > 0 && (
        <Box sx={sectionCard}>
          <SectionHeader
            icon={<Biotech sx={{ fontSize: 16, color: C.ash }} />}
            sub="AI-generated diagnostic considerations"
            action={
              <IconButton
                size="small"
                onClick={() => toggleSection("differentials")}
              >
                {expandedSections.differentials ? (
                  <ExpandLess sx={{ fontSize: 16, color: C.ash }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 16, color: C.ash }} />
                )}
              </IconButton>
            }
          >
            Top Differentials
          </SectionHeader>
          <Collapse in={expandedSections.differentials}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              {differentialsList.slice(0, 5).map((diff, idx) => (
                <Box
                  key={idx}
                  sx={{
                    p: 2,
                    mb: 1.5,
                    background: C.ghost,
                    borderRadius: "2px",
                    borderLeft: `3px solid ${C.charcoal}`,
                    "&:last-child": { mb: 0 },
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 13,
                        fontWeight: 400,
                        color: C.ink,
                        mb: 0.5,
                      }),
                    }}
                  >
                    {diff.rank ? `#${diff.rank}: ` : ""}
                    {diff.diagnosis || diff}
                  </Typography>
                  {(diff.probability || diff.urgency_tier) && (
                    <Box
                      sx={{
                        display: "flex",
                        gap: 2,
                        flexWrap: "wrap",
                        mb: 0.5,
                      }}
                    >
                      {diff.probability && (
                        <Typography
                          sx={{ ...os({ fontSize: 11, color: C.ash }) }}
                        >
                          Probability:{" "}
                          {Math.round((diff.probability || 0) * 100)}%
                        </Typography>
                      )}
                      {diff.urgency_tier && (
                        <Typography
                          sx={{ ...os({ fontSize: 11, color: C.smoke }) }}
                        >
                          Urgency: {diff.urgency_tier}
                        </Typography>
                      )}
                    </Box>
                  )}
                  {diff.supporting_evidence &&
                    diff.supporting_evidence.length > 0 && (
                      <Typography
                        sx={{
                          ...os({
                            fontSize: 10,
                            color: C.ash,
                            mb: 0.5,
                          }),
                        }}
                      >
                        Evidence: {diff.supporting_evidence.join("; ")}
                      </Typography>
                    )}
                  {diff.key_exclusion_test && (
                    <Typography
                      sx={{ ...os({ fontSize: 11, color: C.smoke }) }}
                    >
                      Key test: {diff.key_exclusion_test}
                    </Typography>
                  )}
                  {diff.consequence_if_missed && (
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 10,
                          color: C.charcoal,
                          mt: 0.5,
                          fontStyle: "italic",
                        }),
                      }}
                    >
                      Consequence if missed: {diff.consequence_if_missed}
                    </Typography>
                  )}
                </Box>
              ))}

              {workingDiagnosis.diagnosis && (
                <Box
                  sx={{
                    mt: 2,
                    p: 2,
                    background: C.ghost,
                    borderRadius: "2px",
                    border: `1px solid ${C.fog}`,
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.5,
                      }),
                    }}
                  >
                    Working Diagnosis
                  </Typography>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 14,
                        fontWeight: 400,
                        color: C.ink,
                        mb: 0.5,
                      }),
                    }}
                  >
                    {workingDiagnosis.diagnosis}
                  </Typography>
                  {workingDiagnosis.confidence && (
                    <Typography
                      sx={{ ...os({ fontSize: 11, color: C.ash }) }}
                    >
                      Confidence:{" "}
                      {Math.round((workingDiagnosis.confidence || 0) * 100)}%
                    </Typography>
                  )}
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      )}

      {/* Risk Scores */}
      {riskScoresData && Object.keys(riskScoresData).length > 0 && (
        <Box sx={sectionCard}>
          <SectionHeader
            icon={<Science sx={{ fontSize: 16, color: C.ash }} />}
            sub="Clinical prediction scores"
            action={
              <IconButton
                size="small"
                onClick={() => toggleSection("riskScores")}
              >
                {expandedSections.riskScores ? (
                  <ExpandLess sx={{ fontSize: 16, color: C.ash }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 16, color: C.ash }} />
                )}
              </IconButton>
            }
          >
            Risk Scores
          </SectionHeader>
          <Collapse in={expandedSections.riskScores}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "repeat(2, 1fr)",
                    sm: "repeat(4, 1fr)",
                  },
                  gap: 1.5,
                }}
              >
                {riskScoresData.news2 && (
                  <Box
                    sx={{
                      p: 1.5,
                      background: C.ghost,
                      borderRadius: "2px",
                      border: `1px solid ${C.fog}`,
                      textAlign: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 10,
                          color: C.ash,
                          textTransform: "uppercase",
                          letterSpacing: "0.07em",
                        }),
                      }}
                    >
                      NEWS2
                    </Typography>
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 20,
                          fontWeight: 400,
                          color: C.ink,
                        }),
                      }}
                    >
                      {riskScoresData.news2.estimated_score ||
                        riskScoresData.news2.score ||
                        "—"}
                    </Typography>
                    {riskScoresData.news2.risk_band && (
                      <Typography
                        sx={{ ...os({ fontSize: 10, color: C.smoke }) }}
                      >
                        {riskScoresData.news2.risk_band}
                      </Typography>
                    )}
                  </Box>
                )}
                {riskScoresData.qsofa && (
                  <Box
                    sx={{
                      p: 1.5,
                      background: C.ghost,
                      borderRadius: "2px",
                      border: `1px solid ${C.fog}`,
                      textAlign: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 10,
                          color: C.ash,
                          textTransform: "uppercase",
                          letterSpacing: "0.07em",
                        }),
                      }}
                    >
                      qSOFA
                    </Typography>
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 20,
                          fontWeight: 400,
                          color: C.ink,
                        }),
                      }}
                    >
                      {riskScoresData.qsofa.score || "—"}
                    </Typography>
                    {riskScoresData.qsofa.sepsis_risk && (
                      <Typography
                        sx={{ ...os({ fontSize: 10, color: C.smoke }) }}
                      >
                        {riskScoresData.qsofa.sepsis_risk}
                      </Typography>
                    )}
                  </Box>
                )}
                {riskScoresData.heart_score && (
                  <Box
                    sx={{
                      p: 1.5,
                      background: C.ghost,
                      borderRadius: "2px",
                      border: `1px solid ${C.fog}`,
                      textAlign: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 10,
                          color: C.ash,
                          textTransform: "uppercase",
                          letterSpacing: "0.07em",
                        }),
                      }}
                    >
                      HEART Score
                    </Typography>
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 20,
                          fontWeight: 400,
                          color: C.ink,
                        }),
                      }}
                    >
                      {riskScoresData.heart_score.score || "—"}
                    </Typography>
                    {riskScoresData.heart_score.risk && (
                      <Typography
                        sx={{ ...os({ fontSize: 10, color: C.smoke }) }}
                      >
                        {riskScoresData.heart_score.risk}
                      </Typography>
                    )}
                  </Box>
                )}
                {riskScoresData.esi && (
                  <Box
                    sx={{
                      p: 1.5,
                      background: C.ghost,
                      borderRadius: "2px",
                      border: `1px solid ${C.fog}`,
                      textAlign: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 10,
                          color: C.ash,
                          textTransform: "uppercase",
                          letterSpacing: "0.07em",
                        }),
                      }}
                    >
                      ESI Level
                    </Typography>
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 20,
                          fontWeight: 400,
                          color: C.ink,
                        }),
                      }}
                    >
                      {riskScoresData.esi.level || "—"}
                    </Typography>
                    {riskScoresData.esi.level_label && (
                      <Typography
                        sx={{ ...os({ fontSize: 10, color: C.smoke }) }}
                      >
                        {riskScoresData.esi.level_label}
                      </Typography>
                    )}
                  </Box>
                )}
                {riskScoresData.mts && (
                  <Box
                    sx={{
                      p: 1.5,
                      background: C.ghost,
                      borderRadius: "2px",
                      border: `1px solid ${C.fog}`,
                      textAlign: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 10,
                          color: C.ash,
                          textTransform: "uppercase",
                          letterSpacing: "0.07em",
                        }),
                      }}
                    >
                      MTS Priority
                    </Typography>
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 20,
                          fontWeight: 400,
                          color: C.ink,
                        }),
                      }}
                    >
                      {riskScoresData.mts.priority || "—"}
                    </Typography>
                    {riskScoresData.mts.target_time_minutes && (
                      <Typography
                        sx={{ ...os({ fontSize: 10, color: C.smoke }) }}
                      >
                        Target: {riskScoresData.mts.target_time_minutes} min
                      </Typography>
                    )}
                  </Box>
                )}
                {riskScoresData.ctas && (
                  <Box
                    sx={{
                      p: 1.5,
                      background: C.ghost,
                      borderRadius: "2px",
                      border: `1px solid ${C.fog}`,
                      textAlign: "center",
                    }}
                  >
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 10,
                          color: C.ash,
                          textTransform: "uppercase",
                          letterSpacing: "0.07em",
                        }),
                      }}
                    >
                      CTAS Level
                    </Typography>
                    <Typography
                      sx={{
                        ...os({
                          fontSize: 20,
                          fontWeight: 400,
                          color: C.ink,
                        }),
                      }}
                    >
                      {riskScoresData.ctas.level || "—"}
                    </Typography>
                    {riskScoresData.ctas.target_time_minutes && (
                      <Typography
                        sx={{ ...os({ fontSize: 10, color: C.smoke }) }}
                      >
                        Target: {riskScoresData.ctas.target_time_minutes} min
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
              {riskScoresData.primary_standard_selected && (
                <Box
                  sx={{
                    mt: 2,
                    p: 1.5,
                    background: C.ghost,
                    borderRadius: "2px",
                    border: `1px solid ${C.fog}`,
                    textAlign: "center",
                  }}
                >
                  <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                    Primary Standard: {riskScoresData.primary_standard_selected}
                  </Typography>
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      )}

      {/* Clinical Findings */}
      {clinicalFindings && Object.keys(clinicalFindings).length > 0 && (
        <Box sx={sectionCard}>
          <SectionHeader
            icon={<MonitorHeart sx={{ fontSize: 16, color: C.ash }} />}
            sub="Vitals and complaint analysis"
            action={
              <IconButton
                size="small"
                onClick={() => toggleSection("clinicalFindings")}
              >
                {expandedSections.clinicalFindings ? (
                  <ExpandLess sx={{ fontSize: 16, color: C.ash }} />
                ) : (
                  <ExpandMore sx={{ fontSize: 16, color: C.ash }} />
                )}
              </IconButton>
            }
          >
            Clinical Findings
          </SectionHeader>
          <Collapse in={expandedSections.clinicalFindings}>
            <Box sx={{ p: { xs: 2, sm: 3 } }}>

              {/* History Analysis */}
              {clinicalFindings.history_analysis && (
                <Box
                  sx={{
                    mb: 2,
                    p: 2,
                    background: C.ghost,
                    borderRadius: "2px",
                    border: `1px solid ${C.fog}`,
                  }}
                >
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.5,
                      }),
                    }}
                  >
                    History Analysis
                  </Typography>
                  <Typography sx={{ ...os({ fontSize: 11, color: C.smoke }) }}>
                    {clinicalFindings.history_analysis}
                  </Typography>
                </Box>
              )}

              {/* Vitals Analysis */}
              {clinicalFindings.vitals_analysis && (
                <Box sx={{ mb: 2 }}>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.75,
                        fontWeight: 400,
                      }),
                    }}
                  >
                    Vitals Analysis
                  </Typography>
                  <Typography
                    sx={{
                      ...os({ fontSize: 11, color: C.smoke, mb: 1, lineHeight: 1.6 }),
                    }}
                  >
                    {clinicalFindings.vitals_analysis.findings ||
                      clinicalFindings.vitals_analysis}
                  </Typography>

                  {/* Vitals Trends */}
                  {clinicalFindings.vitals_analysis.trends && (
                    <Box
                      sx={{
                        mt: 1,
                        p: 2,
                        background: C.ghost,
                        borderRadius: "2px",
                        border: `1px solid ${C.fog}`,
                        mb: 1.5,
                      }}
                    >
                      <Typography
                        sx={{
                          ...os({
                            fontSize: 10,
                            color: C.ash,
                            textTransform: "uppercase",
                            letterSpacing: "0.07em",
                            mb: 0.5,
                          }),
                        }}
                      >
                        Vitals Trends
                      </Typography>
                      <Typography
                        sx={{ ...os({ fontSize: 11, color: C.smoke }) }}
                      >
                        {clinicalFindings.vitals_analysis.trends}
                      </Typography>
                    </Box>
                  )}

                  {/* ── Concerning Values as Table ── */}
                  {clinicalFindings.vitals_analysis.concerning_values &&
                    clinicalFindings.vitals_analysis.concerning_values.length >
                      0 && (
                      <ConcerningValuesTable
                        values={clinicalFindings.vitals_analysis.concerning_values}
                      />
                    )}
                </Box>
              )}

              {/* Complaint Analysis */}
              {clinicalFindings.complaint_analysis && (
                <Box sx={{ mb: 2 }}>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 10,
                        color: C.ash,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                        mb: 0.75,
                        fontWeight: 400,
                      }),
                    }}
                  >
                    Complaint Analysis
                  </Typography>
                  <Typography
                    sx={{ ...os({ fontSize: 11, color: C.smoke, lineHeight: 1.6 }) }}
                  >
                    {clinicalFindings.complaint_analysis}
                  </Typography>
                </Box>
              )}
            </Box>
          </Collapse>
        </Box>
      )}
    </Box>
  );

  // ─── Final Render ──────────────────────────────────────────────────────────
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>

      {/* ── Header: Triage Level ── */}
      <Box sx={{ ...sectionCard }}>
        <Box
          sx={{
            p: { xs: 2.5, sm: 3 },
            background: C.ghost,
            borderBottom: `1px solid ${C.fog}`,
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              mb: 1.5,
              flexWrap: "wrap",
            }}
          >
            <WarningAmberRounded sx={{ color: C.charcoal, fontSize: 28 }} />
            <Box>
              <Typography
                sx={{
                  ...os({
                    fontSize: 10,
                    color: C.ash,
                    letterSpacing: "0.08em",
                    textTransform: "uppercase",
                  }),
                }}
              >
                Triage Level
              </Typography>
              <Typography
                sx={{
                  ...os({
                    fontSize: { xs: 20, sm: 26 },
                    fontWeight: 400,
                    color: C.ink,
                    letterSpacing: "-0.3px",
                  }),
                }}
              >
                Level {triageLevel} — {triageLabel}
              </Typography>
            </Box>
          </Box>

          {/* Quick Stats Grid */}
          <Box
            sx={{
              display: "grid",
              gridTemplateColumns: {
                xs: "repeat(2, 1fr)",
                sm: "repeat(4, 1fr)",
              },
              gap: 2,
              mt: 2,
            }}
          >
            <Box>
              <Typography
                sx={{
                  ...os({
                    fontSize: 10,
                    color: C.ash,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }),
                }}
              >
                Zone
              </Typography>
              <Typography
                sx={{ ...os({ fontSize: 13, fontWeight: 400, color: C.ink }) }}
              >
                {zone}
              </Typography>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                ({zoneColor})
              </Typography>
            </Box>
            <Box>
              <Typography
                sx={{
                  ...os({
                    fontSize: 10,
                    color: C.ash,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }),
                }}
              >
                Target Time
              </Typography>
              <Typography
                sx={{
                  ...os({
                    fontSize: 18,
                    fontWeight: 400,
                    color: C.ink,
                  }),
                }}
              >
                {targetTime} min
              </Typography>
            </Box>
            <Box>
              <Typography
                sx={{
                  ...os({
                    fontSize: 10,
                    color: C.ash,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }),
                }}
              >
                Disposition
              </Typography>
              <Typography
                sx={{ ...os({ fontSize: 13, fontWeight: 400, color: C.ink }) }}
              >
                {disposition}
              </Typography>
            </Box>
            <Box>
              <Typography
                sx={{
                  ...os({
                    fontSize: 10,
                    color: C.ash,
                    textTransform: "uppercase",
                    letterSpacing: "0.07em",
                  }),
                }}
              >
                Triage Standard
              </Typography>
              <Typography
                sx={{ ...os({ fontSize: 13, fontWeight: 400, color: C.ink }) }}
              >
                {triageStandard}
              </Typography>
            </Box>
          </Box>

          {/* Metadata Row */}
          {(triageCategory || appointmentId) && (
            <Box
              sx={{
                display: "flex",
                gap: 2,
                mt: 2,
                pt: 1.5,
                borderTop: `1px solid ${C.fog}`,
                flexWrap: "wrap",
              }}
            >
              {triageCategory && (
                <Box>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 9,
                        color: C.silver,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                      }),
                    }}
                  >
                    Category
                  </Typography>
                  <Typography
                    sx={{ ...os({ fontSize: 11, color: C.smoke }) }}
                  >
                    {triageCategory}
                  </Typography>
                </Box>
              )}
              {appointmentId && (
                <Box>
                  <Typography
                    sx={{
                      ...os({
                        fontSize: 9,
                        color: C.silver,
                        textTransform: "uppercase",
                        letterSpacing: "0.07em",
                      }),
                    }}
                  >
                    Appointment ID
                  </Typography>
                  <Typography
                    sx={{ ...os({ fontSize: 11, color: C.smoke }) }}
                  >
                    {appointmentId}
                  </Typography>
                </Box>
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* ── One Liner ── */}
      {oneLiner && (
        <Box
          sx={{
            ...sectionCard,
            borderLeft: `3px solid ${C.charcoal}`,
          }}
        >
          <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
            <Typography
              sx={{
                ...os({
                  fontSize: 13,
                  fontStyle: "italic",
                  color: C.charcoal,
                  lineHeight: 1.6,
                }),
              }}
            >
              "{oneLiner}"
            </Typography>
          </Box>
        </Box>
      )}

      {/* ── Tabs ── */}
      <Box sx={{ ...sectionCard }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant="fullWidth"
          sx={{
            borderBottom: `1px solid ${C.fog}`,
            "& .MuiTab-root": {
              fontFamily: FONT,
              fontSize: 12,
              fontWeight: 300,
              textTransform: "none",
              letterSpacing: "0.04em",
              minHeight: 44,
              color: C.ash,
              "&.Mui-selected": {
                color: C.ink,
                fontWeight: 400,
              },
            },
            "& .MuiTabs-indicator": {
              backgroundColor: C.black,
              height: 1.5,
            },
          }}
        >
          <Tab
            icon={<LocalHospital sx={{ fontSize: 15 }} />}
            iconPosition="start"
            label="Plan"
          />
          <Tab
            icon={<Timeline sx={{ fontSize: 15 }} />}
            iconPosition="start"
            label="Immediate"
          />
          <Tab
            icon={<Science sx={{ fontSize: 15 }} />}
            iconPosition="start"
            label="Diagnostics"
          />
        </Tabs>

        <Box sx={{ p: { xs: 2, sm: 2.5 } }}>
          {activeTab === 0 && renderTab1()}
          {activeTab === 1 && renderTab2()}
          {activeTab === 2 && renderTab3()}
        </Box>
      </Box>
    </Box>
  );
};

export default TriageAssessment;