import React, { useState } from "react";

import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
  Box,
} from "@mui/material";

function OnboardingPopup({
  open,
  onClose,
  doctorId,
  patientId,
  onSuccess,
  theme,
}) {
  const API_BASE_URL = "https://doctorassist.ai/api/";

  const [loading, setLoading] =
    useState(false);

  const [status, setStatus] =
    useState(null);

  // ============================================
  // CHECK STATUS
  // ============================================

  const checkOnboardingStatus =
    async () => {
      try {
        const response =
          await fetch(
            `${API_BASE_URL}hms/users/data/context/status/summary/${patientId}/${doctorId}`
          );

        const json =
          await response.json();

        console.log(
          "ONBOARDING STATUS:",
          json
        );

        return json?.status;
      } catch (err) {
        console.error(err);
        return null;
      }
    };

  // ============================================
  // START ONBOARDING
  // ============================================

  const startOnboarding =
    async () => {
      try {
        setLoading(true);
        setStatus("processing");

        const res =
          await fetch(
            `${API_BASE_URL}hms/users/ai-legacy/clinical-reasoning-summary`,
            {
              method: "POST",
              headers: {
                "Content-Type":
                  "application/json",
              },
              body: JSON.stringify({
                patient_id:
                  patientId,
                doctor_id:
                  doctorId,
              }),
            }
          );

        const json =
          await res.json();

        console.log(
          "ONBOARDING RESPONSE:",
          json
        );

        const interval =
  setInterval(async () => {

    const currentStatus =
      await checkOnboardingStatus();

    console.log(
      "CURRENT STATUS:",
      currentStatus
    );

    // SUCCESS
    if (
      currentStatus ===
      "completed"
    ) {

      clearInterval(
        interval
      );

      try {

        await fetch(
          `${API_BASE_URL}hms/users/data/context/verify-patient-summary`,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",
            },

            body: JSON.stringify({
              patient_id:
                patientId,

              doctor_id:
                doctorId,

              tag:
                "patient_summary",
            }),
          }
        );

      } catch (err) {

        console.error(
          "Verify patient summary failed:",
          err
        );

      }

      setStatus(
        "completed"
      );

      setLoading(
        false
      );

      setTimeout(() => {

        onSuccess?.();

      }, 3000);
    }

    // FAILED
    else if (
      currentStatus ===
      "failed"
    ) {

      console.log(
        "STOPPING POLLING"
      );

      clearInterval(
        interval
      );

      setStatus(
        "failed"
      );

      setLoading(
        false
      );
    }

  }, 15000);
      } catch (err) {
        console.error(
          "Onboarding failed:",
          err
        );

        setLoading(false);

        setStatus("failed");
      }
    };

  const handleClose = () => {
    if (!loading) {
      setStatus(null);
      onClose();
    }
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
      maxWidth="sm"
      fullWidth
      PaperProps={{
        sx: {
          background: theme.bg,
          border: `1px solid ${theme.border}`,
        },
      }}
    >
      <DialogTitle
        sx={{
          background: theme.bgAlt,
          color: theme.text,
          borderBottom: `1px solid ${theme.border}`,
        }}
      >
        Patient Onboarding Summary
      </DialogTitle>

      <DialogContent
        sx={{
          background: theme.bg,
        }}
      >
        <Box
          sx={{
            py: 2,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <Typography sx={{ color: theme.text }}>
            Generate AI-powered onboarding
            summary for this patient.
          </Typography>

          {loading && (
            <Box
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 2,
              }}
            >
              <CircularProgress
                size={24}
                sx={{ color: theme.accent }}
              />

              <Typography sx={{ color: theme.textMuted }}>
                Processing onboarding...
              </Typography>
            </Box>
          )}

          {status ===
            "completed" && (
            <Typography
              sx={{
                color: theme.success,
                fontWeight: 600,
              }}
            >
              Onboarding completed
              successfully.
            </Typography>
          )}

          {status === "failed" && (
            <Typography
              sx={{
                color: theme.danger,
                fontWeight: 600,
              }}
            >
              No data available for this patient.
            </Typography>
          )}
        </Box>
      </DialogContent>

      <DialogActions
        sx={{
          background: theme.bg,
          borderTop: `1px solid ${theme.border}`,
        }}
      >
        <Button
          onClick={handleClose}
          disabled={loading}
          sx={{
            color: theme.textMuted,
            "&:hover": {
              background: theme.bgAlt,
            },
          }}
        >
          Close
        </Button>

        <Button
          variant="contained"
          disabled={loading}
          onClick={startOnboarding}
          sx={{
            background: theme.accent,
            color: theme.bg,

            "&:hover": {
              background: theme.accentHover,
            },
          }}
        >
          {loading
            ? "Processing..."
            : "Start Onboarding"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default OnboardingPopup;