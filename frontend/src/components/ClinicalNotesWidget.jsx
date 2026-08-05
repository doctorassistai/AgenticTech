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

import {
  BrowserRouter
} from "react-router-dom";

import ClinicalNotePanel
from "./ClinicalNotesPanel";

export default function ClinicalNotesWidget({

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

  const [clinicalData, setClinicalData] =
    useState(null);

  const [transcript, setTranscript] =
    useState("");

  // =====================================
  // LIVE TRANSCRIPT
  // =====================================


  useEffect(() => {

  const existingclinicalData =

    window.DOCTOR_ASSIST_DATA
      ?.clinical_notes;

  if (existingclinicalData) {

    setClinicalData(
      existingclinicalData
    );
  }

}, []);

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
  // GENERATE CLINICAL NOTES
  // =====================================

  const generateClinicalNotes =
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

                  "documentation-clinical-notes",

                dictation:
                  transcript
              })
            }
          );

        const json =
          await response.json();

        console.log(

          "CLINICAL NOTES RESPONSE:",

          json
        );

        const output =

          json?.finaloutput ||

          json;

        // =====================================
        // LOCAL STATE
        // =====================================

        setClinicalData(
          output
        );

        // =====================================
        // GLOBAL SAVE STATE
        // =====================================

        window.DOCTOR_ASSIST_DATA
          .clinical_notes =
            output;

        console.log(

          "GLOBAL CLINICAL NOTES:",

          window.DOCTOR_ASSIST_DATA
            .clinical_notes
        );

      } catch (err) {

        console.error(err);

        alert(

          "Clinical Notes generation failed"
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
          Clinical Notes
        </Typography>

      </Box>

      {/* =====================================
          BUTTON
      ===================================== */}

      <Button

        variant="contained"

        onClick={
          generateClinicalNotes
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

            "Generate Clinical Notes"
          )
        }

      </Button>

      {/* =====================================
          OUTPUT
      ===================================== */}

      {

        clinicalData && (

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

            <BrowserRouter>

              <ClinicalNotePanel

                data={
                  clinicalData
                }

                metadata={{

                  doctor_id:
                    doctorId,

                  patient_id:
                    patientId
                }}

                onSave={(data) => {

                  console.log(

                    "Clinical Notes Saved:",

                    data
                  );

                  // =====================================
                  // UPDATE GLOBAL SAVE STATE
                  // =====================================

                  window
                    .DOCTOR_ASSIST_DATA
                    .clinical_notes =
                      data;
                }}
              />

            </BrowserRouter>

          </Paper>
        )
      }

    </Box>
  );
}