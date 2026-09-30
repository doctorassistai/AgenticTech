import React, {
  useState,
  useEffect,
  useCallback,
} from "react";

import {
  Box,
  Button,
  Paper,
  Typography,
  CircularProgress,
} from "@mui/material";

import MedicationPanel from "./MedicationPanel";

export default function MedicationWidget({
  doctorId,
  patientId,
  analyzedDictation,
}) {
  // =====================================================
  // API
  // =====================================================

  const API_BASE_URL =
    "https://doctorassist.ai/api";

  // =====================================================
  // STATE
  // =====================================================

  const [loading, setLoading] =
    useState(false);

  const [medicationData, setMedicationData] =
    useState(null);

  const [transcript, setTranscript] =
    useState("");

  // =====================================================
  // EXISTING MEDICATION DATA
  // =====================================================

  useEffect(() => {
    const existingMedicationData =
      window.DOCTOR_ASSIST_DATA?.medications;

    if (existingMedicationData) {
      setMedicationData(
        existingMedicationData
      );
    }
  }, []);

  // =====================================================
  // API ORCHESTRATION
  // =====================================================

  const runDictationFeatureWithText =
    useCallback(
      async (
        nodeId,
        dictationText,
        analyzedJson
      ) => {
        try {
          const res = await fetch(
            `${API_BASE_URL}/hms/users/orchestration/generate_documentation_with_suggestions`,
            {
              method: "POST",

              headers: {
                "Content-Type":
                  "application/json",
              },

              body: JSON.stringify({
                doctor_id: doctorId,

                patient_id: patientId,

                feature_id: nodeId,

                dictation: dictationText,

                output_json:
                  analyzedJson ??
                  analyzedDictation ??
                  null,
              }),
            }
          );

          if (!res.ok) {
            throw new Error(
              `API Error: ${res.status}`
            );
          }

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
          console.error(
            "Medication API error:",
            err
          );

          return null;
        }
      },
      [
        doctorId,
        patientId,
        analyzedDictation,
      ]
    );

  // =====================================================
  // GENERATE MEDICATION
  // =====================================================

  const generateMedication =
    useCallback(
      async (text) => {
        const medicationTranscript =
          String(
            text ??
              window.DOCTOR_ASSIST_DATA
                ?.transcript ??
              ""
          ).trim();

        if (!medicationTranscript) {
          console.warn(
            "No transcription found for medication analysis."
          );

          return;
        }

        // Prevent duplicate generation
        // while one request is already running.
        if (loading) {
          console.log(
            "Medication analysis already running."
          );

          return;
        }

        try {
          setLoading(true);

          console.log(
            "GENERATING MEDICATION..."
          );

          console.log(
            "TRANSCRIPT:",
            medicationTranscript
          );

          const result =
            await runDictationFeatureWithText(
              "documentation-medication-analysis",

              medicationTranscript,

              null
            );

          if (!result) {
            console.error(
              "Medication generation failed."
            );

            return;
          }

          console.log(
            "GENERATED MEDICATION:",
            result
          );

          // =================================================
          // LOCAL STATE
          // =================================================

          setMedicationData(result);

          setTranscript(
            medicationTranscript
          );

          // =================================================
          // GLOBAL STATE
          // =================================================

          window.DOCTOR_ASSIST_DATA =
            window.DOCTOR_ASSIST_DATA || {};

          window.DOCTOR_ASSIST_DATA
            .medications = result;

          window.DOCTOR_ASSIST_DATA
            .transcript =
              medicationTranscript;

          console.log(
            "GLOBAL MEDICATION DATA:",
            window.DOCTOR_ASSIST_DATA
              .medications
          );
        } catch (err) {
          console.error(
            "Medication generation failed:",
            err
          );
        } finally {
          setLoading(false);
        }
      },
      [
        runDictationFeatureWithText,
        loading,
      ]
    );

  // =====================================================
  // LISTEN FOR TRANSCRIPTION
  // =====================================================

  useEffect(() => {
    const syncTranscriptAndGenerate =
      (event) => {
        // -----------------------------------------------
        // Prefer event transcript
        // -----------------------------------------------

        const eventTranscript =
          event?.detail?.transcript;

        // -----------------------------------------------
        // Fallback to global transcript
        // -----------------------------------------------

        const globalTranscript =
          window.DOCTOR_ASSIST_DATA
            ?.transcript;

        const latestTranscript =
          eventTranscript ||
          globalTranscript ||
          "";

        if (
          !String(
            latestTranscript
          ).trim()
        ) {
          return;
        }

        console.log(
          "MEDICATION WIDGET RECEIVED TRANSCRIPTION:",
          latestTranscript
        );

        setTranscript(
          latestTranscript
        );

        // -----------------------------------------------
        // AUTOMATIC MEDICATION ANALYSIS
        // -----------------------------------------------

        generateMedication(
          latestTranscript
        );
      };

    // ===================================================
    // INITIAL TRANSCRIPT
    // ===================================================

    const existingTranscript =
      window.DOCTOR_ASSIST_DATA
        ?.transcript;

    if (
      existingTranscript?.trim()
    ) {
      setTranscript(
        existingTranscript
      );
    }

    // ===================================================
    // EVENT LISTENER
    // ===================================================

    window.addEventListener(
      "doctorassist-transcript-update",
      syncTranscriptAndGenerate
    );

    return () => {
      window.removeEventListener(
        "doctorassist-transcript-update",
        syncTranscriptAndGenerate
      );
    };
  }, [
    generateMedication,
  ]);

  // =====================================================
  // MANUAL GENERATE BUTTON
  // =====================================================

  const handleManualGenerate = () => {
    const currentTranscript =
      transcript ||
      window.DOCTOR_ASSIST_DATA
        ?.transcript ||
      "";

    if (
      !String(
        currentTranscript
      ).trim()
    ) {
      console.warn(
        "No transcription available."
      );

      return;
    }

    generateMedication(
      currentTranscript
    );
  };

  // =====================================================
  // UI
  // =====================================================

  return (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {/* =================================================
          HEADER
      ================================================= */}

      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent:
            "space-between",
          gap: 2,
          flexWrap: "wrap",
        }}
      >
        <Typography
          sx={{
            fontSize: 15,
            fontWeight: 600,
          }}
        >
          Medication Analysis
        </Typography>

        {/* =============================================
            MANUAL GENERATE BUTTON
        ============================================= */}

        <Button
          variant="contained"
          onClick={
            handleManualGenerate
          }
          disabled={
            loading ||
            !transcript.trim()
          }
          sx={{
            borderRadius: "8px",
            textTransform: "none",
            px: 2.5,
            py: 1,
            fontWeight: 600,
            background:
              "#111827",

            "&:hover": {
              background:
                "#000000",
            },

            "&:disabled": {
              background:
                "#d1d5db",
              color:
                "#6b7280",
            },
          }}
        >
          {loading ? (
            <Box
              sx={{
                display: "flex",
                alignItems:
                  "center",
                gap: 1,
              }}
            >
              <CircularProgress
                size={16}
                sx={{
                  color: "#fff",
                }}
              />

              Analyzing...
            </Box>
          ) : (
            "Generate Medication"
          )}
        </Button>
      </Box>

      {/* =================================================
          AUTOMATIC PROCESSING STATUS
      ================================================= */}

      {loading && (
        <Paper
          sx={{
            p: 2,
            borderRadius: 2,
            border:
              "1px solid #e5e7eb",
            background:
              "#fafafa",
          }}
        >
          <Box
            sx={{
              display: "flex",
              alignItems:
                "center",
              gap: 1.5,
            }}
          >
            <CircularProgress
              size={18}
            />

            <Typography
              sx={{
                fontSize: 13,
                color: "#555",
              }}
            >
              Processing the
              transcription for
              medication analysis...
            </Typography>
          </Box>
        </Paper>
      )}

      {/* =================================================
          TRANSCRIPT STATUS
      ================================================= */}

      {!loading &&
        transcript.trim() &&
        !medicationData && (
          <Paper
            sx={{
              p: 2,
              borderRadius: 2,
              border:
                "1px solid #e5e7eb",
              background:
                "#fafafa",
            }}
          >
            <Typography
              sx={{
                fontSize: 12,
                color: "#666",
                mb: 0.5,
              }}
            >
              Transcription received
            </Typography>

            <Typography
              sx={{
                fontSize: 13,
                color: "#333",
              }}
            >
              Medication analysis will
              be generated automatically.
              You can also click
              "Generate Medication"
              above.
            </Typography>
          </Paper>
        )}

      {/* =================================================
          OUTPUT
      ================================================= */}

      {medicationData && (
        <Paper
          sx={{
            p: 2,
            borderRadius: 3,
            border:
              "1px solid #e5e7eb",
            background: "#fff",
          }}
        >
          <MedicationPanel
            data={medicationData}

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
                patientId,
            }}

            onSave={(data) => {
              console.log(
                "Medication Saved:",
                data
              );
            }}
          />
        </Paper>
      )}
    </Box>
  );
}

