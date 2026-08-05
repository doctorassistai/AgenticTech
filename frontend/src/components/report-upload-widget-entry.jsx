window.process = window.process || {
  env: {}
};

import React from "react";

import { createRoot }
from "react-dom/client";

import ReportUpload
from "./ReportUpload";

(function () {

  window.ReportUploadWidget = {

    init: function ({
      containerId,
      doctorId,
      patientId,
      appointmentId = null,
    }) {

      // =========================
      // FIND CONTAINER
      // =========================

      const container =
        document.getElementById(containerId);

      if (!container) {

        console.error(
          "❌ ReportUploadWidget container not found"
        );

        return;
      }

      // =========================
      // PREVENT DUPLICATE MOUNT
      // =========================

      if (
        container.querySelector(
          "#report-upload-widget-root"
        )
      ) {

        console.warn(
          "⚠️ ReportUploadWidget already mounted"
        );

        return;
      }

      // =========================
      // CREATE ROOT ELEMENT
      // =========================

      const rootDiv =
        document.createElement("div");

      rootDiv.id =
        "report-upload-widget-root";

      rootDiv.style.width = "100%";

      rootDiv.style.minHeight = "100vh";

      rootDiv.style.position = "relative";

      container.appendChild(rootDiv);

      // =========================
      // CREATE REACT ROOT
      // =========================

      const root =
        createRoot(rootDiv);

      // =========================
      // RENDER COMPONENT
      // =========================

      root.render(

        <ReportUpload
          doctorId={doctorId}
          patientId={patientId}
          appointmentId={appointmentId}
          isWidget={true}
        />

      );

      console.log(
        "✅ ReportUploadWidget initialized"
      );
    },
  };

})();