window.process =
  window.process || {
    env: {}
  };

import React, {
  useState,
  useRef,
  useEffect
} from "react";

import {
  createRoot
} from "react-dom/client";

import ClinicalNotesWidget
from "./ClinicalNotesWidget";

(function () {

  window.ClinicalNotesWidget = {

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
          "#clinicalnotes-widget-root"
        )
      ) return;

      const rootDiv =
        document.createElement("div");

      rootDiv.id =
        "clinicalnotes-widget-root";

      rootDiv.style.position =
        "relative";

      rootDiv.style.width =
        "100%";

      rootDiv.style.minHeight =
        "700px";

      container.appendChild(
        rootDiv
      );

      const root =
        createRoot(rootDiv);

      function Widget() {

        const [position, setPosition] =
          useState({
            x: 40,
            y: 20
          });

        const [size, setSize] =
          useState({
            width: 1400,
            height: 900
          });

        const dragRef =
          useRef(false);

        const resizeRef =
          useRef(false);

        const clamp = (
          value,
          min,
          max
        ) =>
          Math.max(
            min,
            Math.min(max, value)
          );

        // DRAG

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

        // RESIZE

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

          setSize({

            width: clamp(
              e.clientX -
              rect.left -
              position.x,
              700,
              2000
            ),

            height: clamp(
              e.clientY -
              rect.top -
              position.y,
              500,
              1500
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

        useEffect(() => {

          const rect =
            rootDiv.getBoundingClientRect();

          setPosition({

            x:
              rect.width / 2 -
              600,

            y: 20
          });

        }, []);

        return (

          <div
            style={{

              position: "absolute",

              top: position.y,

              left: position.x,

              width: size.width,

              height: size.height,

              background: "#fff",

              borderRadius: "18px",

              overflow: "hidden",

              border:
                "1px solid #e5e7eb",

              boxShadow:
                "0 14px 40px rgba(0,0,0,0.16)",

              display: "flex",

              flexDirection: "column"
            }}
          >

            {/* HEADER */}

            <div
              onMouseDown={
                startDrag
              }
              style={{

                padding:
                  "12px 16px",

                cursor: "move",

                fontWeight: 600,

                borderBottom:
                  "1px solid #eee",

                background:
                  "#fafafa"
              }}
            >
              📝 Clinical Notes Widget
            </div>

            {/* CONTENT */}

            <div
              style={{

                flex: 1,

                overflow: "auto",

                padding: 12,

                background:
                  "#fafafa"
              }}
            >

              <ClinicalNotesWidget

                doctorId={doctorId}

                patientId={patientId}

              />

            </div>

            {/* FOOTER */}

            <div
              style={{

                padding: 6,

                textAlign:
                  "center",

                borderTop:
                  "1px solid #eee",

                background:
                  "#fff",

                fontSize: 11
              }}
            >
              Powered by
              doctorassist.ai
            </div>

            {/* RESIZE */}

            <div
              onMouseDown={
                startResize
              }
              style={{

                position:
                  "absolute",

                right: 0,

                bottom: 0,

                width: 14,

                height: 14,

                cursor:
                  "nwse-resize",

                background:
                  "linear-gradient(135deg, transparent 50%, #cbd5e1 50%)"
              }}
            />

          </div>
        );
      }

      root.render(
        <Widget />
      );
    }
  };

})();