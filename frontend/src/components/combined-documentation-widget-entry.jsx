window.process =
  window.process || {
    env: {}
  };

import React from "react";

import {
  createRoot
} from "react-dom/client";

import CombinedDocumentationWidget
from "./CombinedDocumentationWidget";

(function () {

  window.CombinedDocumentationWidget = {

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
          "#combined-documentation-widget-root"
        )

      ) return;

      // ROOT DIV

      const rootDiv =
        document.createElement("div");

      rootDiv.id =
        "combined-documentation-widget-root";

      rootDiv.style.width = "100%";

      container.appendChild(rootDiv);

      const root =
        createRoot(rootDiv);

      root.render(

        <CombinedDocumentationWidget

          doctorId={doctorId}

          patientId={patientId}

        />

      );
    }
  };

})();