import { defineConfig } from "vite";

import react
from "@vitejs/plugin-react";

import tailwindcss
from "@tailwindcss/vite";

export default defineConfig(() => {

  const widget =
    process.env.WIDGET || "patient";

  // =====================================
  // ENTRY FILES
  // =====================================

  const entryMap = {

    patient:
      "src/components/widget-entry.jsx",

    transcription:
      "src/components/transcription-widget-entry.jsx",

    diagnosis:
      "src/components/diagnosis-widget-entry.jsx",

    treatmentplan:
      "src/components/treatmentplan-widget-entry.jsx",

    medication:
      "src/components/medication-widget-entry.jsx",

    investigation:
      "src/components/investigation-widget-entry.jsx",

    clinicalnotes:
      "src/components/clinicalnotes-widget-entry.jsx",

    documenttreatmentplan:
      "src/components/document-treatmentplan-widget-entry.jsx",

    

    savesession:
      "src/components/save-session-widget-entry.jsx",

    combineddocumentation:
      "src/components/combined-documentation-widget-entry.jsx",
    reportupload:
      "src/components/report-upload-widget-entry.jsx",

      patientportal: 
      "src/components/patient-portal-widget-entry.jsx",

      procedurenotes:
  "src/components/procedurenotes-widget-entry.jsx",

  tumorboard:
  "src/components/tumorboard-widget-entry.jsx",
  };

  // =====================================
  // GLOBAL WINDOW NAMES
  // =====================================

  const nameMap = {

    patient:
      "PatientWidget",

    transcription:
      "TranscriptionWidget",

    diagnosis:
      "DiagnosisWidget",

    treatmentplan:
      "TreatmentPlanWidget",

    medication:
      "MedicationWidget",

    investigation:
      "InvestigationWidget",

    clinicalnotes:
      "ClinicalNotesWidget",

    documenttreatmentplan:
      "DocumentTreatmentPlanWidget",

   

    savesession:
      "SaveSessionWidget",

    combineddocumentation:
      "CombinedDocumentationWidget",
    reportupload:
      "ReportUploadWidget",

    patientportal: 
      "PatientPortalWidget",

      procedurenotes:
  "ProcedureNotesWidget",

  tumorboard:
  "TumorBoardWidget",
  };

  // =====================================
  // OUTPUT FILES
  // =====================================

  const fileMap = {

    patient:
      "patient-widget.js",

    transcription:
      "transcription-widget.js",

    diagnosis:
      "diagnosis-widget.js",

    treatmentplan:
      "treatmentplan-widget.js",

    medication:
      "medication-widget.js",

    investigation:
      "investigation-widget.js",

    clinicalnotes:
      "clinicalnotes-widget.js",

    documenttreatmentplan:
      "document-treatmentplan-widget.js",

    

    savesession:
      "save-session-widget.js",

    combineddocumentation:
      "combined-documentation-widget.js",
    reportupload:
      "report-upload-widget.js",

    patientportal: 
      "patient-portal-widget.js",
      
    procedurenotes:
  "procedure-notes-widget.js",

  tumorboard:
  "tumorboard-widget.js",
  };

  return {

    plugins: [

      react(),

      tailwindcss()
    ],

    define: {

      "process.env.NODE_ENV":
        JSON.stringify("production"),

      "process.env":
        JSON.stringify({}),

      global:
        "window"
    },

    build: {

      emptyOutDir: true,

      cssCodeSplit: false,

      lib: {

        entry:
          entryMap[widget],

        name:
          nameMap[widget],

        fileName: () =>
          fileMap[widget],

        formats: ["iife"]
      }
    },

    server: {
  allowedHosts: [
    "doctorassist.ai"
  ],
  host: true,
  port: 5173,
  strictPort: true,
  https: false,           // optional: set true if you want Vite to handle HTTPS
  hmr: {
    protocol: 'wss',      // must be wss for HTTPS pages
    host: 'doctorassist.ai',
    port: 443,            // Nginx HTTPS port
    // path: '/__vite_ws/'   // add a dedicated HMR path
  }
}
  };
});