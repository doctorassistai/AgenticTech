window.process = window.process || { env: {} };

import React, {
  useState
} from "react";

import { createRoot }
from "react-dom/client";

import {

  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  CircularProgress,
  Box

} from "@mui/material";

/* ============================================
   POPUP
============================================ */

function OnboardingPopup({

  open,
  onClose,
  doctorId,
  patientId,
   onSuccess

}) {

  const API_BASE_URL =
    window.PATIENT_WIDGET_API;

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
  // START
  // ============================================

  const startOnboarding =
    async () => {

      try {

        setLoading(true);

        setStatus(
          "processing"
        );

        const res =
          await fetch(

            `${API_BASE_URL}hms/users/ai-legacy/clinical-reasoning-summary`,

            {

              method: "POST",

              headers: {

                "Content-Type":
                  "application/json"
              },

              body: JSON.stringify({

                patient_id:
                  patientId,

                doctor_id:
                  doctorId
              })
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

            if (
              currentStatus ===
              "completed"
            ) {

              clearInterval(
                interval
              );

              // =========================
              // TRIGGER VERIFY SUMMARY
              // =========================
              try {

                await fetch(
                  `${API_BASE_URL}hms/users/data/context/verify-patient-summary`,
                  {

                    method: "POST",

                    headers: {
                      "Content-Type": "application/json"
                    },

                    body: JSON.stringify({

                      patient_id: patientId,

                      doctor_id: doctorId,

                      tag: "patient_summary"

                    })

                  }
                );

              } catch (err) {

                console.error(
                  "Verify patient summary failed:",
                  err
                );

              }

              // Give backend time to save summary
              setTimeout(() => {

                onSuccess?.();

              }, 3000);

              setStatus("completed");

              setLoading(false);

              setStatus(
                "completed"
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

        setStatus(
          "failed"
        );
      }
    };

  return (

    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
    >

      <DialogTitle>
        Patient Onboarding Summary
      </DialogTitle>

      <DialogContent>

        <Box
          sx={{
            py: 2,
            display: "flex",
            flexDirection: "column",
            gap: 2
          }}
        >

          <Typography>
            Generate AI-powered onboarding summary for this patient.
          </Typography>

          {

            loading && (

              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  gap: 2
                }}
              >

                <CircularProgress
                  size={24}
                />

                <Typography>
                  Processing onboarding...
                </Typography>

              </Box>
            )
          }

          {

            status ===
            "completed" && (

              <Typography
                sx={{
                  color: "green",
                  fontWeight: 600
                }}
              >
                Onboarding completed successfully.
              </Typography>
            )
          }

          {

            status ===
            "failed" && (

              <Typography
                sx={{
                  color: "red",
                  fontWeight: 600
                }}
              >
                Onboarding failed.
              </Typography>
            )
          }

        </Box>

      </DialogContent>

      <DialogActions>

        <Button
          onClick={onClose}
        >
          Close
        </Button>

        <Button

          variant="contained"

          disabled={loading}

          onClick={startOnboarding}

          sx={{
            background: "#111827",

            "&:hover": {
              background: "#000"
            }
          }}
        >
          Start Onboarding
        </Button>

      </DialogActions>

    </Dialog>
  );
}

/* ============================================
   MAIN WIDGET
============================================ */

function OnboardingWidget({

  doctorId,
  patientId

}) {

  const [open, setOpen] =
    useState(false);

  return (

    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "10px"
      }}
    >

      <button

        onClick={() =>
          setOpen(true)
        }

        style={{

          background:
            "#111827",

          color: "#fff",

          border: "none",

          borderRadius: "10px",

          padding:
            "12px 20px",

          cursor: "pointer",

          fontWeight: 600,

          fontSize: "14px"
        }}
      >
        Generate Onboarding Summary
      </button>

      <OnboardingPopup

        open={open}

        onClose={() =>
          setOpen(false)
        }

        doctorId={doctorId}

        patientId={patientId}
        onSuccess={onSuccess}

      />

    </div>
  );
}

/* ============================================
   INIT
============================================ */

(function () {

  window.PatientOnboardingWidget = {

    init: function ({

      containerId,
      doctorId,
      patientId

    }) {

      const container =

        document.getElementById(
          containerId
        ) || document.body;

      if (
        container.querySelector(
          "#patient-onboarding-widget-root"
        )
      ) return;

      const rootDiv =
        document.createElement("div");

      rootDiv.id =
        "patient-onboarding-widget-root";

      container.appendChild(
        rootDiv
      );

      const root =
        createRoot(rootDiv);

      root.render(

        <OnboardingWidget

          doctorId={doctorId}

          patientId={patientId}

        />
      );
    }
  };

})();