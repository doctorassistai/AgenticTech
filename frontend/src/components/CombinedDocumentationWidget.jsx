
import React, {
  useState
} from "react";

import {
  Box,
  Tabs,
  Tab,
  Paper,
  Typography
} from "@mui/material";

import MedicationWidget
from "./MedicationWidget";

import InvestigationWidget
from "./InvestigationWidget";

import ClinicalNotesWidget
from "./ClinicalNotesWidget";

import DocumentTreatmentPlanWidget
from "./DocumentTreatmentPlanWidget";
import SaveSessionWidget from "./save-session-widget-entry";
export default function CombinedDocumentationWidget({

  doctorId,
  patientId

}) {

  const [tab, setTab] =
    useState(0);

  return (

    <Paper
      sx={{
        borderRadius: 4,
        overflow: "hidden",
        border:
          "1px solid #e5e7eb",
        background: "#ffffff",
        boxShadow:
          "0 10px 30px rgba(0,0,0,0.06)"
      }}
    >

      {/* HEADER */}

      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom:
            "1px solid #e5e7eb",
          background:
            "linear-gradient(180deg,#ffffff,#fafafa)"
        }}
      >

        <Typography
          sx={{
            fontSize: 18,
            fontWeight: 700,
            color: "#111827"
          }}
        >
          Documentation Workspace
        </Typography>

        <Typography
          sx={{
            fontSize: 13,
            color: "#6b7280",
            mt: 0.5
          }}
        >
          Unified clinical documentation
          workflow for medication,
          investigations, clinical
          notes, and treatment plans.
        </Typography>

      </Box>

      {/* TABS */}

      <Tabs
        value={tab}
        onChange={(_, v) =>
          setTab(v)
        }
        variant="scrollable"
        scrollButtons="auto"
        sx={{

          px: 2,

          borderBottom:
            "1px solid #e5e7eb",

          background: "#fff",

          "& .MuiTab-root": {

            textTransform: "none",

            fontWeight: 600,

            fontSize: 13,

            minHeight: 56,

            color: "#6b7280"
          },

          "& .Mui-selected": {

            color:
              "#111827 !important"
          },

          "& .MuiTabs-indicator": {

            background: "#111827",

            height: 3,

            borderRadius: 999
          }
        }}
      >

        <Tab
          label="Medication"
        />

        <Tab
          label="Investigation"
        />

        <Tab
          label="Clinical Notes"
        />

        <Tab
          label="Treatment Plan"
        />

      </Tabs>

      {/* CONTENT */}

      <Box sx={{ display: tab === 0 ? "block" : "none" }}>
  <MedicationWidget
    doctorId={doctorId}
    patientId={patientId}
  />
</Box>

<Box sx={{ display: tab === 1 ? "block" : "none" }}>
  <InvestigationWidget
    doctorId={doctorId}
    patientId={patientId}
  />
</Box>

<Box sx={{ display: tab === 2 ? "block" : "none" }}>
  <ClinicalNotesWidget
    doctorId={doctorId}
    patientId={patientId}
  />
</Box>

<Box sx={{ display: tab === 3 ? "block" : "none" }}>
  <DocumentTreatmentPlanWidget
    doctorId={doctorId}
    patientId={patientId}
  />
</Box>

{/* SAVE SESSION */}

<Box
  sx={{
    p: 3,
    borderTop: "1px solid #e5e7eb",
    background: "#fafafa"
  }}
>
  <SaveSessionWidget
    doctorId={doctorId}
    patientId={patientId}
  />
</Box>

      {/* FOOTER */}

      <Box
        sx={{
          px: 3,
          py: 1.5,
          borderTop:
            "1px solid #e5e7eb",
          background: "#fff",
          textAlign: "center",
          fontSize: 12,
          color: "#6b7280"
        }}
      >

        Powered by

        <Box
          component="span"
          sx={{
            fontWeight: 700,
            color: "#111827",
            ml: 0.5
          }}
        >
          doctorassist.ai
        </Box>

      </Box>

    </Paper>
  );
}

