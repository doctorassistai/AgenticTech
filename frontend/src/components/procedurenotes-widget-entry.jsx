window.process = window.process || { env: {} };

import React from "react";
import { createRoot } from "react-dom/client";
import ProcedureNotes from "./ProcedureNotes";

(function () {
  window.ProcedureNotesWidget = {
    init: function ({ containerId, doctorId, patientId }) {
      const container =
        document.getElementById(containerId) || document.body;

      // Prevent duplicate mount
      if (container.querySelector("#procedure-notes-widget-root")) return;

      const rootDiv = document.createElement("div");
      rootDiv.id = "procedure-notes-widget-root";
      rootDiv.style.width = "100%";

      container.appendChild(rootDiv);

      const root = createRoot(rootDiv);
      root.render(
        <ProcedureNotes doctorId={doctorId} patientId={patientId} />
      );
    },
  };
})();