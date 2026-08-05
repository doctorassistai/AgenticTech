import React from "react";
import {
  Box,
  Typography,
  TextField,
  MenuItem,
  Grid,
  Paper
} from "@mui/material";

const PatientAssessmentTab = ({ patientId }) => {
  return (
    <Box>
      <Typography variant="h6" sx={{ fontWeight: 600, color: "#334155", mb: 1 }}>
        Patient Assessment and Case Registration
      </Typography>
      <Box sx={{ height: "2px", bgcolor: "#93c5fd", mb: 1.5, width: "100%" }} />
      <Typography variant="body2" sx={{ color: "#64748b", fontStyle: "italic", mb: 4 }}>
        Objective: Confirm diagnosis, disease stage, and overall treatment goal.
      </Typography>

      <Paper elevation={0} sx={{ p: 3, border: "1px solid #e2e8f0", borderRadius: 2, bgcolor: "#f8fafc" }}>
        <Grid container spacing={3}>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Patient ID"
              defaultValue={patientId}
              required
              variant="outlined"
              size="small"
            />
          </Grid>
          <Grid item xs={12} sm={6}>
            <TextField
              fullWidth
              label="Patient Name"
              required
              variant="outlined"
              size="small"
            />
          </Grid>
          
          <Grid item xs={12}>
            <TextField
              fullWidth
              label="Diagnosis"
              required
              variant="outlined"
              size="small"
            />
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              select
              fullWidth
              label="Disease Stage"
              required
              variant="outlined"
              size="small"
              defaultValue=""
            >
              <MenuItem value=""><em>Select Stage</em></MenuItem>
              <MenuItem value="stage-i">Stage I</MenuItem>
              <MenuItem value="stage-ii">Stage II</MenuItem>
              <MenuItem value="stage-iii">Stage III</MenuItem>
              <MenuItem value="stage-iv">Stage IV</MenuItem>
            </TextField>
          </Grid>

          <Grid item xs={12} sm={6}>
            <TextField
              select
              fullWidth
              label="Performance Status (ECOG/Karnofsky)"
              required
              variant="outlined"
              size="small"
              defaultValue=""
            >
              <MenuItem value=""><em>Select Status</em></MenuItem>
              <MenuItem value="ecog-0">ECOG 0</MenuItem>
              <MenuItem value="ecog-1">ECOG 1</MenuItem>
              <MenuItem value="ecog-2">ECOG 2</MenuItem>
              <MenuItem value="ecog-3">ECOG 3</MenuItem>
              <MenuItem value="ecog-4">ECOG 4</MenuItem>
            </TextField>
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Baseline Investigations"
              placeholder="CBC, renal/hepatic function, electrolytes, ECG, etc."
              variant="outlined"
            />
          </Grid>

          <Grid item xs={12}>
            <TextField
              fullWidth
              multiline
              rows={3}
              label="Multidisciplinary Tumor Board Discussion"
              variant="outlined"
            />
          </Grid>
        </Grid>
      </Paper>
    </Box>
  );
};

export default PatientAssessmentTab;
