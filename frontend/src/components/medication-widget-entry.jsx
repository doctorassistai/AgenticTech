window.process = window.process || { env: {} };

import React, {
  useState,
  useRef,
  useEffect
} from "react";

import { createRoot } from "react-dom/client";

import MedicationWidget
from "./MedicationWidget";

(function () {

  window.MedicationWidget = {

    init: function ({
      containerId,
      doctorId,
      patientId
    }) {

      const container =
        document.getElementById(containerId)
        || document.body;

      // Prevent duplicate mount
      if (
        container.querySelector(
          "#medication-widget-root"
        )
      ) return;

      // ROOT DIV
      const rootDiv =
        document.createElement("div");

      rootDiv.id =
        "medication-widget-root";

      // INLINE CONTAINER
      rootDiv.style.position = "relative";
      rootDiv.style.width = "100%";
      rootDiv.style.minHeight = "650px";

      container.appendChild(rootDiv);

      const root =
        createRoot(rootDiv);

      // =================================================
      // MAIN WIDGET
      // =================================================

      function Widget() {

        const [position, setPosition] =
          useState({
            x: 40,
            y: 20
          });

        const [size, setSize] =
          useState({
            width: 1200,
            height: 750
          });

        const dragRef = useRef(false);

        const resizeRef =
          useRef(false);

        // ============================================
        // LIMITS
        // ============================================

        const clamp = (
          value,
          min,
          max
        ) =>
          Math.max(
            min,
            Math.min(max, value)
          );

        // ============================================
        // DRAG
        // ============================================

        const startDrag = () => {

          dragRef.current = true;

          document.addEventListener(
            "mousemove",
            onDrag
          );

          document.addEventListener(
            "mouseup",
            stopDrag
          );
        };

        const onDrag = (e) => {

          if (!dragRef.current)
            return;

          const rect =
            rootDiv.getBoundingClientRect();

          const newX =
            e.clientX -
            rect.left -
            size.width / 2;

          const newY =
            e.clientY -
            rect.top -
            20;

          setPosition({

            x: clamp(
              newX,
              0,
              rect.width - size.width
            ),

            y: clamp(
              newY,
              0,
              rect.height - size.height
            )
          });
        };

        const stopDrag = () => {

          dragRef.current = false;

          document.removeEventListener(
            "mousemove",
            onDrag
          );

          document.removeEventListener(
            "mouseup",
            stopDrag
          );
        };

        // ============================================
        // RESIZE
        // ============================================

        const startResize = (e) => {

          e.preventDefault();

          resizeRef.current = true;

          document.addEventListener(
            "mousemove",
            onResize
          );

          document.addEventListener(
            "mouseup",
            stopResize
          );
        };

        const onResize = (e) => {

          if (!resizeRef.current)
            return;

          const rect =
            rootDiv.getBoundingClientRect();

          const newWidth =
            e.clientX -
            rect.left -
            position.x;

          const newHeight =
            e.clientY -
            rect.top -
            position.y;

          setSize({

            width: clamp(
              newWidth,
              700,
              1800
            ),

            height: clamp(
              newHeight,
              500,
              1200
            )
          });
        };

        const stopResize = () => {

          resizeRef.current = false;

          document.removeEventListener(
            "mousemove",
            onResize
          );

          document.removeEventListener(
            "mouseup",
            stopResize
          );
        };

        // ============================================
        // CENTER ON LOAD
        // ============================================

        useEffect(() => {

          const rect =
            rootDiv.getBoundingClientRect();

          setPosition({

            x:
              rect.width / 2 -
              500,

            y: 20
          });

        }, []);

        // ============================================
        // UI
        // ============================================

        return (

          <div
            style={{

              position: "absolute",

              top: position.y,

              left: position.x,

              width: size.width,

              height: size.height,

              background: "#ffffff",

              borderRadius: "18px",

              boxShadow:
                "0 14px 40px rgba(0,0,0,0.16)",

              border:
                "1px solid #e5e7eb",

              display: "flex",

              flexDirection: "column",

              overflow: "hidden",

              transition:
                "box-shadow 0.2s ease"
            }}
          >

            {/* HEADER */}

            <div
              onMouseDown={startDrag}
              style={{

                padding: "12px 16px",

                cursor: "move",

                background:
                  "linear-gradient(135deg,#f8fafc,#ffffff)",

                borderBottom:
                  "1px solid #eee",

                fontWeight: "600",

                fontSize: "13px",

                userSelect: "none"
              }}
            >
              💊 Medication Analysis Widget
            </div>

            {/* CONTENT */}

            <div
              style={{

                flex: 1,

                overflow: "auto",

                padding: "12px",

                background: "#fafafa"
              }}
            >

              <MedicationWidget

                doctorId={doctorId}

                patientId={patientId}

              />

            </div>

            {/* FOOTER */}

            <div
              style={{

                padding: "6px",

                fontSize: "11px",

                textAlign: "center",

                borderTop:
                  "1px solid #eee",

                background: "#fff",

                color: "#666"
              }}
            >
              Powered by{" "}

              <span
                style={{
                  fontWeight: "600",
                  color: "#111"
                }}
              >
                doctorassist.ai
              </span>
            </div>

            {/* RESIZE HANDLE */}

            <div
              onMouseDown={startResize}
              style={{

                position: "absolute",

                width: "14px",

                height: "14px",

                bottom: "0",

                right: "0",

                cursor: "nwse-resize",

                background:
                  "linear-gradient(135deg, transparent 50%, #cbd5e1 50%)"
              }}
            />

          </div>
        );
      }

      root.render(<Widget />);
    }
  };

})();