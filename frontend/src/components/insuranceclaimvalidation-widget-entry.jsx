window.process = window.process || { env: {} };

import React from "react";
import { createRoot } from "react-dom/client";

import InsuranceClaimValidation from "./Insuranceclaimvalidation";
import { THEMES } from "../dashboard/themes";

(function () {
  window.InsuranceClaimValidationWidget = {
    init({
      patientId,
      doctorId,
      containerId,
    }) {

      const container =
        document.getElementById(containerId) || document.body;

      const rootDiv = document.createElement("div");

      rootDiv.style.width = "100%";
      rootDiv.style.height = "100%";
      rootDiv.style.minHeight = "700px";

      container.appendChild(rootDiv);

      const root = createRoot(rootDiv);

      root.render(
        <InsuranceClaimValidation
          patientId={patientId}
          doctorId={doctorId}
        />
      );
    },
  };
})();