import React from "react";
import { Box, Typography, Chip, Divider } from "@mui/material";
import { motion } from "framer-motion";

const sampleAssertion = {
  extracted_attributes: {
    symptoms: ["Fever", "Cough", "Fatigue"],
    duration: "3 days",
    severity: "Moderate",
    associated_symptoms: ["Body ache"],
    risk_factors: ["Smoking"],
    red_flags: ["High fever"],
    pattern: "Acute onset"
  },
  symptom_clusters: {
    infectious: ["Fever", "Cough"],
    respiratory: ["Cough"],
    neurologic: [],
    systemic: ["Fatigue"]
  },
  differential_diagnosis: [
    {
      condition: "Community Acquired Pneumonia",
      scores: { CSC: 8, RFP: 6, TIPF: 7, RFCA: 5, DTC_vitals: 6, DTC_labs: 7, DTC_radiology: 8, DLS: 8, probability_percent: 72 },
      likelihood_category: "High",
      rationale: "Symptoms, vitals, and radiology strongly correlate with CAP."
    }
  ]
};

export default function AssertionFlow() {
  return (
    <Box className="canvas-root">
      <Typography fontWeight={800} fontSize={16} mb={2}>Clinical Assertion Flow</Typography>

      <Divider />

      <Section title="Extracted Attributes">
        {Object.entries(sampleAssertion.extracted_attributes).map(([k,v]) => (
          <Row key={k} label={k} value={Array.isArray(v) ? v.join(", ") : v} />
        ))}
      </Section>

      <Section title="Symptom Clusters">
        {Object.entries(sampleAssertion.symptom_clusters).map(([k,v]) => (
          <Row key={k} label={k} value={v.join(", ") || "—"} />
        ))}
      </Section>

      <Section title="Differential Diagnosis">
        {sampleAssertion.differential_diagnosis.map((d,i) => (
          <Box key={i} mb={2}>
            <Typography fontWeight={700}>{d.condition}</Typography>
            <Typography fontSize={12}>Probability: {d.scores.probability_percent}%</Typography>
            <Typography fontSize={12}>Likelihood: {d.likelihood_category}</Typography>
            <Typography fontSize={12} mt={1}>{d.rationale}</Typography>
          </Box>
        ))}
      </Section>
    </Box>
  );
}

function Section({ title, children }) {
  return (
    <Box mt={2}>
      <Typography fontWeight={700} fontSize={13} color="#3fb6ff" mb={1}>
        {title}
      </Typography>
      <Box>{children}</Box>
    </Box>
  );
}

function Row({ label, value }) {
  return (
    <Box display="flex" justifyContent="space-between" mb={0.5}>
      <Typography fontSize={12} sx={{ opacity: 0.7 }}>{label}</Typography>
      <Typography fontSize={12}>{value}</Typography>
    </Box>
  );
}
