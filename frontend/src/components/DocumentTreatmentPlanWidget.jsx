import React, {
  useState,
  useEffect
} from "react";

import {

  Box,
  Button,
  CircularProgress,
  Paper,
  Typography

} from "@mui/material";

import TreatmentPlan
from "./TreatmentPlan";

export default function
DocumentTreatmentPlanWidget({

  doctorId,
  patientId

}) {

  // =====================================
  // API
  // =====================================

  const API_BASE_URL =
    "https://doctorassist.ai/api";

  // =====================================
  // STATES
  // =====================================

  const [loading, setLoading] =
    useState(false);

  const [

    treatmentData,
    setTreatmentData

  ] = useState(null);

  const [

    transcript,
    setTranscript

  ] = useState("");


useEffect(() => {

  const ExitTreatmentData =

    window.DOCTOR_ASSIST_DATA
      ?.document_treatment_plan;

  if (setTreatmentData) {

    setTreatmentData(
      ExitTreatmentData
    );
  }

}, []);

  // =====================================
  // LIVE TRANSCRIPT
  // =====================================

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

  // =====================================
  // GENERATE TREATMENT PLAN
  // =====================================

  const generateTreatmentPlan =
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

        const response =
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

                  "documentation-treatment-plan",

                dictation:
                  transcript
              })
            }
          );

        const json =
          await response.json();

        console.log(

          "TREATMENT PLAN RESPONSE:",

          json
        );

        // =====================================
        // FINAL OUTPUT
        // =====================================

        const output =

          json?.finaloutput ||

          {};

        console.log(
          "FINAL OUTPUT:",
          output
        );

        // =====================================
        // LOCAL STATE
        // =====================================

        setTreatmentData(
          output
        );

        // =====================================
        // GLOBAL SAVE STATE
        // =====================================

        window.DOCTOR_ASSIST_DATA
          .document_treatment_plan =
            output;

        console.log(

          "GLOBAL TREATMENT PLAN:",

          window.DOCTOR_ASSIST_DATA
            .document_treatment_plan
        );

      } catch (err) {

        console.error(err);

        alert(

          "Treatment Plan generation failed"
        );

      } finally {

        setLoading(false);
      }
    };

  // =====================================
  // UI
  // =====================================

  return (

    <Box
      sx={{

        display: "flex",

        flexDirection: "column",

        gap: 2
      }}
    >

      {/* =====================================
          HEADER
      ===================================== */}

      <Typography
        sx={{

          fontSize: 15,

          fontWeight: 600
        }}
      >
        Treatment Plan
      </Typography>

      {/* =====================================
          BUTTON
      ===================================== */}

      <Button

        variant="contained"

        onClick={
          generateTreatmentPlan
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

            "Generate Treatment Plan"
          )
        }

      </Button>

      {/* =====================================
          OUTPUT
      ===================================== */}

      {

        treatmentData && (

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

            <TreatmentPlan

              doctorId={
                doctorId
              }

              patientId={
                patientId
              }

              treatmentObjective={
                null
              }

              dictationData={{

                "documentation-treatment-plan":

                  treatmentData
              }}

              dictationText={

                transcript || ""
              }

              onTreatmentObjectiveChange={() => {}}

              reloadTrigger={1}

              ref={null}

            />

          </Paper>
        )
      }

    </Box>
  );
}