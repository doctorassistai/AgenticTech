import React, {
  useState,
  useEffect
} from "react";

import {
  Box,
  Button,
  Paper,
  Typography,
  CircularProgress
} from "@mui/material";

import MedicationPanel
from "./MedicationPanel";

export default function MedicationWidget({

  doctorId,
  patientId,
  analyzedDictation

}) {

  // ============================================
  // API
  // ============================================

  const API_BASE_URL =
    "https://doctorassist.ai/api";

  // ============================================
  // STATES
  // ============================================

  const [loading, setLoading] =
    useState(false);

  const [medicationData, setMedicationData] =
    useState(null);

  const [transcript, setTranscript] =
    useState("");
useEffect(() => {

  const existingMedicationData =

    window.DOCTOR_ASSIST_DATA
      ?.medications;

  if (existingMedicationData) {

    setMedicationData(
      existingMedicationData
    );
  }

}, []);
  // ============================================
  // LIVE TRANSCRIPTION
  // ============================================

  useEffect(() => {

  const syncTranscript = () => {

    const latestTranscript =

      window.DOCTOR_ASSIST_DATA
        ?.transcript || "";

    setTranscript(
      latestTranscript
    );
  };

  // Initial load once
  syncTranscript();

  // Event-based update
  window.addEventListener(
    "doctorassist-transcript-update",
    syncTranscript
  );

  return () => {

    window.removeEventListener(
      "doctorassist-transcript-update",
      syncTranscript
    );
  };

}, []);

  // ============================================
  // ORCHESTRATION API
  // ============================================
  
  const runDictationFeatureWithText =
    async (

      nodeId,
      dictationText,
      analyzedJson

    ) => {

      try {

        const res =
          await fetch(

            `${API_BASE_URL}/hms/users/orchestration/generate_documentation_with_suggestions`,

            {

              method: "POST",

              headers: {
                "Content-Type":
                  "application/json"
              },

              body: JSON.stringify({

                doctor_id:
                  doctorId,

                patient_id:
                  patientId,

                feature_id:
                  nodeId,

                dictation:
                  dictationText,

                output_json:

                  analyzedJson ??

                  analyzedDictation ??

                  null
              })
            }
          );

        const json =
          await res.json();

        console.log(
          "MEDICATION RESPONSE:",
          json
        );

        return (
          json?.finaloutput ??
          null
        );

      } catch (err) {

        console.error(err);

        return null;
      }
    };

  // ============================================
  // GENERATE MEDICATION
  // ============================================

  const generateMedication =
    async () => {

      if (
        !transcript.trim()
      ) {

        alert(
          "No transcription found"
        );

        return;
      }

      try {

        setLoading(true);

        const result =

          await runDictationFeatureWithText(

            "documentation-medication-analysis",

            transcript,

            null
          );

        if (!result) {

          alert(
            "Medication generation failed"
          );

          return;
        }

        // ============================================
        // SET LOCAL STATE
        // ============================================

        setMedicationData(
          result
        );

        // ============================================
        // SAVE TO GLOBAL
        // ============================================

        window.DOCTOR_ASSIST_DATA
          .medications =
            result;

        console.log(

          "GLOBAL MEDICATION DATA:",

          window.DOCTOR_ASSIST_DATA
            .medications
        );

      } catch (err) {

        console.error(err);

        alert(
          "Medication generation failed"
        );

      } finally {

        setLoading(false);
      }
    };

  // ============================================
  // UI
  // ============================================

  return (

    <Box
      sx={{

        display: "flex",

        flexDirection: "column",

        gap: 2
      }}
    >

      {/* ============================================
          HEADER
      ============================================ */}

      <Box
        sx={{

          display: "flex",

          alignItems: "center",

          justifyContent:
            "space-between"
        }}
      >

        <Typography
          sx={{

            fontSize: 15,

            fontWeight: 600
          }}
        >
          Medication Analysis
        </Typography>

      </Box>

      {/* ============================================
          BUTTON
      ============================================ */}

      <Button

        variant="contained"

        onClick={
          generateMedication
        }

        disabled={loading}

        sx={{

          alignSelf:
            "flex-start",

          borderRadius:
            "10px",

          textTransform:
            "none",

          px: 3,

          py: 1.2,

          fontWeight: 600,

          background:
            "#111827",

          "&:hover": {

            background:
              "#000"
          }
        }}
      >

        {

          loading ? (

            <CircularProgress

              size={18}

              sx={{
                color: "#fff"
              }}
            />

          ) : (

            "Generate Medication"
          )
        }

      </Button>

      {/* ============================================
          OUTPUT
      ============================================ */}

      {

        medicationData && (

          <Paper
            sx={{

              p: 2,

              borderRadius: 3,

              border:
                "1px solid #e5e7eb",

              background:
                "#fff"
            }}
          >

            <MedicationPanel

              data={
                medicationData
              }

              transcript={
                transcript
              }

              diagnosisText={
                transcript
              }

              metadata={{

                doctor_id:
                  doctorId,

                patient_id:
                  patientId
              }}

              onSave={(data) => {

                console.log(

                  "Medication Saved:",

                  data
                );
              }}
            />

          </Paper>
        )
      }

    </Box>
  );
}