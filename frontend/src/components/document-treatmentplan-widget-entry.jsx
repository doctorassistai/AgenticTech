window.process = window.process || { env: {} };

import React from "react";

import { createRoot }
from "react-dom/client";

import DocumentTreatmentPlanWidget
from "./DocumentTreatmentPlanWidget";

(function () {

  window.DocumentTreatmentPlanWidget = {

    init: function ({

      containerId,
      doctorId,
      patientId

    }) {

      const container =

        document.getElementById(
          containerId
        ) || document.body;

      // Prevent duplicate mount

      if (

        container.querySelector(
          "#document-treatmentplan-widget-root"
        )

      ) return;

      // ROOT

      const rootDiv =
        document.createElement("div");

      rootDiv.id =
        "document-treatmentplan-widget-root";

      rootDiv.style.width = "100%";

      container.appendChild(rootDiv);

      const root =
        createRoot(rootDiv);

      root.render(

        <DocumentTreatmentPlanWidget

          doctorId={doctorId}

          patientId={patientId}

        />
      );
    }
  };

})();