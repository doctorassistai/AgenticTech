window.process = window.process || { env: {} };

import React from "react";
import { createRoot } from "react-dom/client";
import TumorBoard from "./TumorBoard";

(function () {
  window.TumorBoardWidget = {
    init: function ({
      containerId,
      doctorId,
      patientId,
      doctorSpeciality,
      doctorName,
      patientName,
    }) {
      const container =
        document.getElementById(containerId) || document.body;

      // Prevent duplicate mount
      if (container.querySelector("#tumorboard-widget-root")) return;

      const rootDiv = document.createElement("div");
      rootDiv.id = "tumorboard-widget-root";
      rootDiv.style.width = "100%";

      container.appendChild(rootDiv);

      const root = createRoot(rootDiv);
      root.render(
        <TumorBoard
          doctorId={doctorId}
          patientId={patientId}
          doctorSpeciality={doctorSpeciality}
          doctorName={doctorName}
          patientName={patientName}
        />
      );
    },
  };
})();