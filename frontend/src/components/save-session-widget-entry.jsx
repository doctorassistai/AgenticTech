window.process = window.process || { env: {} };

import React, {
  useState
} from "react";

import {
  createRoot
} from "react-dom/client";

import {

  Box,
  Button,
  CircularProgress,
  Typography,
  Paper

} from "@mui/material";

/* ============================================
   SAVE SESSION COMPONENT
============================================ */

function SaveSessionWidget({

  doctorId,
  patientId

}) {

  const API_BASE_URL =
    "https://doctorassist.ai/api";

  const [loading, setLoading] =
    useState(false);

  const [success, setSuccess] =
    useState(false);

  // ============================================
  // SAVE SESSION
  // ============================================

  const saveSession =
    async () => {

      try {

        setLoading(true);

        setSuccess(false);

        const documents = [];

        // ============================================
        // MEDICATION
        // ============================================

        if (

          window.DOCTOR_ASSIST_DATA
            ?.medications

        ) {

          documents.push({

            status: "success",

            feature_id:
              "documentation-medication-analysis",

            feature_name:
              "Medication Analysis",

            display_method:
              "text",

            finaloutput:

              window.DOCTOR_ASSIST_DATA
                .medications,

            metadata: {

              doctor_id:
                doctorId,

              patient_id:
                patientId
            }
          });
        }

        // ============================================
        // INVESTIGATION
        // ============================================

        if (

          window.DOCTOR_ASSIST_DATA
            ?.investigations

        ) {

          documents.push({

            status: "success",

            feature_id:
              "documentation-investigation-notes",

            feature_name:
              "Investigation Notes",

            display_method:
              "text",

            finaloutput:

              window.DOCTOR_ASSIST_DATA
                .investigations,

            metadata: {

              doctor_id:
                doctorId,

              patient_id:
                patientId
            }
          });
        }

        // ============================================
        // CLINICAL NOTES
        // ============================================

        if (

          window.DOCTOR_ASSIST_DATA
            ?.clinical_notes

        ) {

          documents.push({

            status: "success",

            feature_id:
              "documentation-clinical-notes",

            feature_name:
              "Clinical Notes",

            display_method:
              "text",

            finaloutput:

              window.DOCTOR_ASSIST_DATA
                .clinical_notes,

            metadata: {

              doctor_id:
                doctorId,

              patient_id:
                patientId
            }
          });
        }

        // ============================================
        // DOCUMENT TREATMENT PLAN
        // ============================================

        if (

          window.DOCTOR_ASSIST_DATA
            ?.document_treatment_plan

        ) {

          documents.push({

            status: "success",

            feature_id:
              "documentation-treatment-plan",

            feature_name:
              "Document Treatment Plan",

            display_method:
              "text",

            finaloutput:

              window.DOCTOR_ASSIST_DATA
                .document_treatment_plan,

            metadata: {

              doctor_id:
                doctorId,

              patient_id:
                patientId
            }
          });
        }

        // ============================================
        // EMPTY CHECK
        // ============================================

        if (
          documents.length === 0
        ) {

          alert(
            "No generated documents found"
          );

          return;
        }

        console.log(
          "SAVE DOCUMENTS:",
          documents
        );

        // ============================================
        // SAVE API
        // ============================================

        const response =
          await fetch(

            `${API_BASE_URL}/hms/users/data/context/save_documentation_features_bulk`,

            {

              method: "POST",

              headers: {

                "Content-Type":
                  "application/json"
              },

              body: JSON.stringify({

                documents
              })
            }
          );

        const json =
          await response.json();

        console.log(
          "SAVE RESPONSE:",
          json
        );

        if (!response.ok) {

          throw new Error(

            json?.message ||

            "Save failed"
          );
        }

        setSuccess(true);

      } catch (err) {

        console.error(err);

        alert(
          "Save session failed"
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

        <Typography
          sx={{

            fontSize: 16,

            fontWeight: 700
          }}
        >
          Save Session
        </Typography>

        <Typography
          sx={{

            fontSize: 14,

            color: "#666"
          }}
        >
          Save generated medication,
          investigation,
          clinical notes,
          and treatment plan.
        </Typography>

        <Button

          variant="contained"

          disabled={loading}

          onClick={saveSession}

          sx={{

            width:
              "fit-content",

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

              "Save Session"
            )
          }

        </Button>

        {

          success && (

            <Typography
              sx={{

                color: "green",

                fontWeight: 600
              }}
            >
              Session saved successfully.
            </Typography>
          )
        }

      </Box>

    
  );
}
export default SaveSessionWidget;
/* ============================================
   ENTRY
============================================ */

(function () {

  window.SaveSessionWidget = {

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
          "#save-session-widget-root"
        )

      ) return;

      const rootDiv =
        document.createElement("div");

      rootDiv.id =
        "save-session-widget-root";

      container.appendChild(
        rootDiv
      );

      const root =
        createRoot(rootDiv);

      root.render(

        <SaveSessionWidget

          doctorId={doctorId}

          patientId={patientId}

        />
      );
    }
  };

})();