window.process = window.process || { env: {} };

import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import PatientPortal from "../patient_portal/PatientPortal.jsx";

(function () {
  window.PatientPortalWidget = {
    init: function ({ containerId, hospitalId }) {
      const container = document.getElementById(containerId) || document.body;

      // Prevent duplicate mount
      if (container.querySelector("#patient-portal-widget-root")) return;

      const rootDiv = document.createElement("div");
      rootDiv.id = "patient-portal-widget-root";
      rootDiv.style.position = "relative";
      rootDiv.style.width = "100%";
      rootDiv.style.minHeight = "600px";
      container.appendChild(rootDiv);

      const root = createRoot(rootDiv);

      function WidgetWrapper() {
        return <PatientPortal hospitalId={hospitalId} standalone={false} />;
      }

      root.render(<WidgetWrapper />);
    },
  };
})();