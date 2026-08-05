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

import InvestigationPanel
from "./InvestigationPanel";

export default function InvestigationWidget({

  doctorId,
  patientId,
  analyzedDictation

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
    investigationData,
    setInvestigationData
  ] = useState(null);

  const [transcript, setTranscript] =
    useState("");
useEffect(() => {

  const existingInvestData =

    window.DOCTOR_ASSIST_DATA
      ?.investigations;

  if (existingInvestData) {

    setInvestigationData(
      existingInvestData
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
  // GENERATE INVESTIGATION
  // =====================================

  const runInvestigation =
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

                  "documentation-investigation-notes",

                dictation:
                  transcript,

                output_json:

                  analyzedDictation ??

                  null
              })
            }
          );

        const json =
          await res.json();

        console.log(

          "INVESTIGATION RESPONSE:",

          json
        );

        const result =

          json?.finaloutput ??

          null;

        if (!result) {

          alert(

            "Investigation generation failed"
          );

          return;
        }

        // =====================================
        // LOCAL STATE
        // =====================================

        setInvestigationData(
          result
        );

        // =====================================
        // GLOBAL SAVE STATE
        // =====================================

        window.DOCTOR_ASSIST_DATA
          .investigations =
            result;

        console.log(

          "GLOBAL INVESTIGATION DATA:",

          window.DOCTOR_ASSIST_DATA
            .investigations
        );

      } catch (err) {

        console.error(err);

        alert(
          "Investigation generation failed"
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
        Investigation Analysis
      </Typography>

      {/* =====================================
          BUTTON
      ===================================== */}

      <Button

        variant="contained"

        onClick={
          runInvestigation
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

            "Generate Investigation"
          )
        }

      </Button>

      {/* =====================================
          OUTPUT
      ===================================== */}

      {

        investigationData && (

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

            <InvestigationPanel

              data={
                investigationData
              }

              onSave={(data) => {

                console.log(

                  "Investigation Saved:",

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