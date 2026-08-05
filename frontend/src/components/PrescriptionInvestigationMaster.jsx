import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Card,
  CardContent,
  TextField,
  MenuItem,
  Button,
  Paper,
  Checkbox,
  FormControlLabel,
  Stack,
  Chip,
  Divider,
  Alert
} from "@mui/material";

import MedicationPanel from "./MedicationPanel";
import InvestigationPanel from "./InvestigationPanel";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/+$/, "");

export default function PrescriptionInvestigationMaster({ metadata }) {
  const [diagnosis, setDiagnosis] = useState("");
  const [templates, setTemplates] = useState([]);
  const [selectedItems, setSelectedItems] = useState([]);
  const [medData, setMedData] = useState({ prescriptions: [] });
  const [invData, setInvData] = useState({ investigation_orders: [] });
  const [validationWarnings, setValidationWarnings] = useState([]);

  const doctor_id = metadata?.doctor_id;
  const patient_id = metadata?.patient_id;

  // --------------------------------------------------
  // 1️⃣ Fetch Templates Based on Diagnosis
  // --------------------------------------------------
  useEffect(() => {
    if (!diagnosis) return;

    fetch(
      `${API_BASE_URL}/templates?diagnosis=${diagnosis}&doctor_id=${doctor_id}`
    )
      .then((res) => res.json())
      .then((data) => setTemplates(data.templates || []))
      .catch((err) => console.error("Template fetch error:", err));
  }, [diagnosis, doctor_id]);

  // --------------------------------------------------
  // 2️⃣ Toggle Template Item Selection
  // --------------------------------------------------
  const toggleItem = (item) => {
    const exists = selectedItems.find(
      (i) => JSON.stringify(i) === JSON.stringify(item)
    );

    if (exists) {
      setSelectedItems(
        selectedItems.filter(
          (i) => JSON.stringify(i) !== JSON.stringify(item)
        )
      );
    } else {
      setSelectedItems([...selectedItems, item]);
    }
  };

  // --------------------------------------------------
  // 3️⃣ Basic Rule-Based Validation
  // --------------------------------------------------
  const runBasicValidation = (newMeds) => {
    const warnings = [];

    newMeds.forEach((med) => {
      if (
        medData.prescriptions.some(
          (existing) =>
            existing.generic_name &&
            existing.generic_name === med.generic_name
        )
      ) {
        warnings.push(`Duplicate medication detected: ${med.medication}`);
      }

      if (
        medData.prescriptions.some(
          (existing) =>
            existing.medication === med.medication &&
            existing.route !== med.route
        )
      ) {
        warnings.push(`Route conflict detected for ${med.medication}`);
      }
    });

    return warnings;
  };

  // --------------------------------------------------
  // 4️⃣ Apply Template Selection
  // --------------------------------------------------
  const applyTemplate = () => {
    const newMeds = selectedItems
      .filter((i) => i.type === "med")
      .map((i) => i.data);

    const newInvs = selectedItems
      .filter((i) => i.type === "inv")
      .map((i) => i.data);

    const warnings = runBasicValidation(newMeds);
    setValidationWarnings(warnings);

    if (newMeds.length) {
      setMedData((prev) => ({
        ...prev,
        prescriptions: [...prev.prescriptions, ...newMeds]
      }));
    }

    if (newInvs.length) {
      setInvData((prev) => ({
        ...prev,
        investigation_orders: [
          ...prev.investigation_orders,
          ...newInvs
        ]
      }));
    }

    setSelectedItems([]);
  };

  // --------------------------------------------------
  // UI
  // --------------------------------------------------
  return (
    <Box sx={{ p: 3, maxWidth: 1400, mx: "auto" }}>
      {/* Diagnosis Selector */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Typography variant="h6" fontWeight={600} gutterBottom>
            Diagnosis Selection
          </Typography>

          <TextField
            label="Diagnosis / Condition"
            fullWidth
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="Enter diagnosis to fetch templates"
          />
        </CardContent>
      </Card>

      {/* Template Panel */}
      {templates.length > 0 && (
        <Card sx={{ mb: 3 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={600} gutterBottom>
              Condition-Based Templates
            </Typography>

            {templates.map((template) => (
              <Paper key={template.template_id} sx={{ p: 2, mb: 2 }}>
                <Stack direction="row" spacing={2} alignItems="center">
                  <Typography fontWeight={600}>
                    {template.template_name}
                  </Typography>
                  <Chip
                    label={template.condition}
                    size="small"
                    color="primary"
                  />
                </Stack>

                <Divider sx={{ my: 1 }} />

                {/* Medications */}
                {template.medications?.map((med, idx) => (
                  <FormControlLabel
                    key={`med-${idx}`}
                    control={
                      <Checkbox
                        onChange={() =>
                          toggleItem({ type: "med", data: med })
                        }
                      />
                    }
                    label={`Medication: ${med.medication}`}
                  />
                ))}

                {/* Investigations */}
                {template.investigations?.map((inv, idx) => (
                  <FormControlLabel
                    key={`inv-${idx}`}
                    control={
                      <Checkbox
                        onChange={() =>
                          toggleItem({ type: "inv", data: inv })
                        }
                      />
                    }
                    label={`Investigation: ${inv.investigation_name}`}
                  />
                ))}
              </Paper>
            ))}

            <Button
              variant="contained"
              disabled={selectedItems.length === 0}
              onClick={applyTemplate}
            >
              Add to My List
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Validation Warnings */}
      {validationWarnings.length > 0 && (
        <Alert severity="warning" sx={{ mb: 3 }}>
          {validationWarnings.map((w, idx) => (
            <div key={idx}>{w}</div>
          ))}
        </Alert>
      )}

      {/* Integrated Panels */}
      <MedicationPanel
        data={medData}
        metadata={{ doctor_id, patient_id }}
        onSave={(data) => setMedData(data)}
      />

      <Box sx={{ mt: 4 }} />

      <InvestigationPanel
        data={invData}
        onSave={(data) => setInvData(data)}
      />
    </Box>
  );
}
