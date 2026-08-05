// components/RAGInsightsPanel.jsx

import React from "react";
import { motion } from "framer-motion";
import {
  Box,
  Typography,
  Card,
  CardContent,
  Chip,
  Alert,
  AlertTitle,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Timeline,
  TimelineItem,
  TimelineSeparator,
  TimelineConnector,
  TimelineContent,
  TimelineDot,
} from "@mui/material";
import {
  ExpandMoreRounded,
  StorageRounded,
  TimelineRounded,
  AccountTreeRounded,
  InfoRounded,
} from "@mui/icons-material";

const RAGInsightsPanel = ({ ragInsights, enrichedContext, liquidGlass }) => {
  if (!ragInsights && !enrichedContext) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <Accordion sx={{ ...liquidGlass, mb: 2 }}>
        <AccordionSummary expandIcon={<ExpandMoreRounded />}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 2, width: "100%" }}>
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 3,
                background: "linear-gradient(135deg, #00d2ff 0%, #3a47d5 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "#fff",
              }}
            >
              <StorageRounded />
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="h6" sx={{ fontWeight: 300 }}>
                RAG-Enhanced Insights
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                Knowledge graph, vector search, and temporal analysis
              </Typography>
            </Box>
            <Chip
              label={`${ragInsights?.documents_retrieved || 0} Documents`}
              size="small"
              sx={{
                background: "rgba(0, 210, 255, 0.2)",
                color: "#00d2ff",
                fontWeight: 600,
              }}
            />
          </Box>
        </AccordionSummary>
        <AccordionDetails>
          {/* Key Insights */}
          {enrichedContext?.key_insights && enrichedContext.key_insights.length > 0 && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#00d2ff", fontWeight: 600 }}>
                Key Clinical Insights
              </Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                {enrichedContext.key_insights.map((insight, idx) => (
                  <Card
                    key={idx}
                    sx={{
                      background:
                        insight.clinical_significance === "critical"
                          ? "rgba(244, 67, 54, 0.1)"
                          : insight.clinical_significance === "important"
                          ? "rgba(255, 152, 0, 0.1)"
                          : "rgba(33, 150, 243, 0.1)",
                      border: `1px solid ${
                        insight.clinical_significance === "critical"
                          ? "#f44336"
                          : insight.clinical_significance === "important"
                          ? "#ff9800"
                          : "#2196f3"
                      }`,
                    }}
                  >
                    <CardContent>
                      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 1 }}>
                        <Chip
                          label={insight.clinical_significance?.toUpperCase()}
                          size="small"
                          color={
                            insight.clinical_significance === "critical"
                              ? "error"
                              : insight.clinical_significance === "important"
                              ? "warning"
                              : "info"
                          }
                          sx={{ fontWeight: 600 }}
                        />
                        <Chip label={insight.source} size="small" variant="outlined" />
                      </Box>
                      <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                        {insight.insight}
                      </Typography>
                      <Typography variant="caption" sx={{ opacity: 0.8 }}>
                        Recommendation: {insight.recommendation}
                      </Typography>
                    </CardContent>
                  </Card>
                ))}
              </Box>
            </Box>
          )}

          {/* Knowledge Graph Relationships */}
          {ragInsights?.graph_relationships && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#00d2ff", fontWeight: 600 }}>
                <AccountTreeRounded sx={{ fontSize: 18, mr: 0.5, verticalAlign: "middle" }} />
                Knowledge Graph Relationships
              </Typography>
              <Card sx={{ background: "rgba(0, 210, 255, 0.05)", border: "1px solid rgba(0, 210, 255, 0.2)" }}>
                <CardContent>
                  {ragInsights.graph_relationships.diagnoses && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Connected Diagnoses
                      </Typography>
                      <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                        {ragInsights.graph_relationships.diagnoses.map((dx, idx) => (
                          <Chip key={idx} label={dx} size="small" color="primary" />
                        ))}
                      </Box>
                    </Box>
                  )}

                  {ragInsights.graph_relationships.labs && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Recent Lab Results ({ragInsights.graph_relationships.labs.length})
                      </Typography>
                      <Timeline position="right" sx={{ p: 0 }}>
                        {ragInsights.graph_relationships.labs.slice(0, 3).map((lab, idx) => (
                          <TimelineItem key={idx}>
                            <TimelineSeparator>
                              <TimelineDot color="primary" />
                              {idx < 2 && <TimelineConnector />}
                            </TimelineSeparator>
                            <TimelineContent>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {lab.type}
                              </Typography>
                              <Typography variant="caption" sx={{ opacity: 0.7 }}>
                                {new Date(lab.date).toLocaleDateString()}
                              </Typography>
                            </TimelineContent>
                          </TimelineItem>
                        ))}
                      </Timeline>
                    </Box>
                  )}

                  {ragInsights.graph_relationships.treatments && (
                    <Box>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Treatment History ({ragInsights.graph_relationships.treatments.length})
                      </Typography>
                      <Typography variant="body2">
                        {ragInsights.graph_relationships.treatments.length} interventions documented
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>
          )}

          {/* Temporal Trends */}
          {ragInsights?.temporal_trends && (
            <Box sx={{ mb: 3 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#00d2ff", fontWeight: 600 }}>
                <TimelineRounded sx={{ fontSize: 18, mr: 0.5, verticalAlign: "middle" }} />
                Temporal Progression Analysis
              </Typography>
              <Card sx={{ background: "rgba(0, 210, 255, 0.05)", border: "1px solid rgba(0, 210, 255, 0.2)" }}>
                <CardContent>
                  {ragInsights.temporal_trends.trends && (
                    <Box>
                      <Typography variant="caption" sx={{ opacity: 0.7, display: "block", mb: 1 }}>
                        Tracked Parameters Over Time
                      </Typography>
                      <Typography variant="body2">
                        {ragInsights.temporal_trends.trends.length} data points analyzed
                      </Typography>
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Box>
          )}

          {/* Progression Indicators */}
          {enrichedContext?.progression_indicators && (
            <Box>
              <Typography variant="subtitle2" sx={{ mb: 2, color: "#00d2ff", fontWeight: 600 }}>
                Disease Progression Indicators
              </Typography>
              <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: 2 }}>
                {enrichedContext.progression_indicators.improving?.length > 0 && (
                  <Card sx={{ background: "rgba(76, 175, 80, 0.05)", border: "1px solid rgba(76, 175, 80, 0.3)" }}>
                    <CardContent>
                      <Typography variant="subtitle2" sx={{ color: "#4caf50", fontWeight: 600, mb: 1 }}>
                        ✓ Improving
                      </Typography>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {enrichedContext.progression_indicators.improving.map((item, idx) => (
                          <li key={idx}>
                            <Typography variant="body2">{item}</Typography>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {enrichedContext.progression_indicators.stable?.length > 0 && (
                  <Card sx={{ background: "rgba(33, 150, 243, 0.05)", border: "1px solid rgba(33, 150, 243, 0.3)" }}>
                    <CardContent>
                      <Typography variant="subtitle2" sx={{ color: "#2196f3", fontWeight: 600, mb: 1 }}>
                        → Stable
                      </Typography>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {enrichedContext.progression_indicators.stable.map((item, idx) => (
                          <li key={idx}>
                            <Typography variant="body2">{item}</Typography>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}

                {enrichedContext.progression_indicators.worsening?.length > 0 && (
                  <Card sx={{ background: "rgba(244, 67, 54, 0.05)", border: "1px solid rgba(244, 67, 54, 0.3)" }}>
                    <CardContent>
                      <Typography variant="subtitle2" sx={{ color: "#f44336", fontWeight: 600, mb: 1 }}>
                        ✗ Worsening
                      </Typography>
                      <ul style={{ margin: 0, paddingLeft: 20 }}>
                        {enrichedContext.progression_indicators.worsening.map((item, idx) => (
                          <li key={idx}>
                            <Typography variant="body2">{item}</Typography>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                )}
              </Box>
            </Box>
          )}

          {/* Historical Context Summary */}
          {enrichedContext?.historical_context_summary && (
            <Alert severity="info" sx={{ mt: 3 }}>
              <AlertTitle>Historical Context Summary</AlertTitle>
              <Typography variant="body2">{enrichedContext.historical_context_summary}</Typography>
            </Alert>
          )}
        </AccordionDetails>
      </Accordion>
    </motion.div>
  );
};

export default RAGInsightsPanel;