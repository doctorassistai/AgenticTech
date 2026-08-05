window.process = window.process || { env: {} };

import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";

import PatientSummary from "./PatientSummary";
import OnboardingPopup from "./OnboardingPopup";
import { THEMES } from "../dashboard/themes";

(function () {
  window.PatientWidget = {
    init: function ({
      patientId,
      doctorId,
      containerId,
    }) {
      const container =
        document.getElementById(containerId) || document.body;

      // Create root
      const rootDiv = document.createElement("div");
      rootDiv.id = "patient-widget-root";

      rootDiv.style.position = "relative";
      rootDiv.style.width = "100%";
      rootDiv.style.minHeight = "500px";

      container.appendChild(rootDiv);

      const root = createRoot(rootDiv);

      function Widget() {
        const [position, setPosition] = useState({
          x: 0,
          y: 0,
        });

        const [size, setSize] = useState({
          width: 1000,
          height: 500,
        });

        const [showOnboarding, setShowOnboarding] =

          useState(false);


        const [summaryTrigger, setSummaryTrigger] =
          useState(0);

        const [theme, setTheme] = useState(THEMES.BlackWhite);

        const dragRef = useRef(false);
        const resizeRef = useRef(false);

        useEffect(() => {
          setPosition({
            x: 50,
            y: 20,
          });
        }, []);

        // ==========================
        // THEME
        // ==========================

        useEffect(() => {
          (async () => {
            try {
              const res = await fetch(
                `https://doctorassist.ai/api/hms/users/data/context/doctor/theme/${doctorId}`
              );
              if (!res.ok) throw new Error();
              const response = await res.json();

              const themeName = response.theme_name || "BlackWhite";
              localStorage.setItem("theme", themeName);
              setTheme(THEMES[themeName] || THEMES.BlackWhite);
            } catch {
              setTheme(THEMES.BlackWhite);
            }
          })();
        }, [doctorId]);

        const T = {
          bg: theme.bg,
          bgAlt: theme.bgAlt,
          bgTert: theme.bgTert,
          text: theme.text,
          textSec: theme.textSec,
          textMuted: theme.textMuted,
          border: theme.border,
          borderStr: theme.borderStr,
          accent: theme.accent,
          accentHover: theme.accentHover,
          success: theme.success,
          warning: theme.warning,
          danger: theme.danger,
          font: theme.font || "'Open Sans', sans-serif",
        };

        // ==========================
        // DRAG
        // ==========================

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
          if (!dragRef.current) return;

          const rect =
            rootDiv.getBoundingClientRect();

          setPosition({
            x:
              e.clientX -
              rect.left -
              size.width / 2,

            y:
              e.clientY -
              rect.top -
              20,
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

        // ==========================
        // RESIZE
        // ==========================

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
          if (!resizeRef.current) return;

          const rect =
            rootDiv.getBoundingClientRect();

          setSize({
            width: Math.max(
              350,
              e.clientX -
                rect.left -
                position.x
            ),

            height: Math.max(
              350,
              e.clientY -
                rect.top -
                position.y
            ),
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

        return (
          <div
            style={{
              position: "absolute",
              top: position.y,
              left: position.x,
              width: size.width,
              height: size.height,
              background: T.bg,
              borderRadius: "14px",
              boxShadow:
                "0 10px 30px rgba(0,0,0,0.15)",
              border: `1px solid ${T.border}`,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              fontFamily: T.font,
            }}
          >
            {/* HEADER */}
            <div
              onMouseDown={startDrag}
              style={{
                padding: "10px 14px",
                cursor: "move",
                background:
                  `linear-gradient(135deg,${T.bgAlt},${T.bg})`,
                borderBottom:
                  `1px solid ${T.border}`,
                fontWeight: "600",
                fontSize: "13px",
                color: T.text,
              }}
            >
              Patient Summary
            </div>

            {/* ONBOARDING BAR */}
            <div
              style={{
                padding: "10px 14px",
                borderBottom:
                  `1px solid ${T.border}`,
                background: T.bgAlt,
              }}
            >
              <button
                onClick={() =>
                  setShowOnboarding(true)
                }
                style={{
                  background: T.accent,
                  color: T.bg,
                  border: "none",
                  borderRadius: "8px",
                  padding: "10px 16px",
                  cursor: "pointer",
                  fontWeight: 600,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = T.accentHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = T.accent;
                }}
              >
                Generate Onboarding Summary
              </button>
            </div>

            {/* PATIENT SUMMARY */}
            <div
              style={{
                flex: 1,
                overflow: "auto",
              }}
            >
              <PatientSummary
                patientId={patientId}
                trigger={summaryTrigger}
              />
            </div>

            {/* FOOTER */}
            <div
              style={{
                padding: "6px",
                fontSize: "11px",
                textAlign: "center",
                borderTop:
                  `1px solid ${T.border}`,
                background: T.bgAlt,
                color: T.textMuted,
              }}
            >
              Powered by{" "}
              <span
                style={{
                  fontWeight: "600",
                  color: T.text,
                }}
              >
                DoctorAssist.Ai
              </span>
            </div>

            {/* RESIZE HANDLE */}
            <div
              onMouseDown={startResize}
              style={{
                position: "absolute",
                width: "14px",
                height: "14px",
                bottom: 0,
                right: 0,
                cursor: "nwse-resize",
                background:
                  `linear-gradient(135deg, transparent 50%, ${T.borderStr} 50%)`,
              }}
            />

            {/* ONBOARDING POPUP */}
            <OnboardingPopup
              open={showOnboarding}
              onClose={() =>
                setShowOnboarding(false)
              }

              doctorId={doctorId}

              patientId={patientId}

              onSuccess={() =>
                setSummaryTrigger(
                  prev => prev + 1
                )
              }

              theme={T}
            />
          </div>
        );
      }

      root.render(<Widget />);
    },
  };
})();