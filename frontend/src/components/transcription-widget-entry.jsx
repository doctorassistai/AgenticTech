window.process = window.process || { env: {} };

import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import GlassTranscriptionPanel from "./GlassTranscriptionPanel";

(function () {
  window.TranscriptionWidget = {
    init: function ({
      containerId,
      doctorId,
      patientId,
      onTranscribe,
    }) {
      const container =
        document.getElementById(containerId) || document.body;

      // Prevent duplicate mount
      if (container.querySelector("#transcription-widget-root")) return;

      const rootDiv = document.createElement("div");
      rootDiv.id = "transcription-widget-root";

      // ✅ Inline container (NOT popup)
      rootDiv.style.position = "relative";
      rootDiv.style.width = "100%";
      rootDiv.style.minHeight = "520px";

      container.appendChild(rootDiv);

      const root = createRoot(rootDiv);

      function Widget() {
        const [position, setPosition] = useState({ x: 40, y: 20 });
        const [size, setSize] = useState({ width: 540, height: 540 });

        const dragRef = useRef(false);
        const resizeRef = useRef(false);

        // Optional: keep inside bounds
        const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

        // ───────── DRAG ─────────
        const startDrag = () => {
          dragRef.current = true;
          document.addEventListener("mousemove", onDrag);
          document.addEventListener("mouseup", stopDrag);
        };

        const onDrag = (e) => {
          if (!dragRef.current) return;

          const rect = rootDiv.getBoundingClientRect();

          const newX = e.clientX - rect.left - size.width / 2;
          const newY = e.clientY - rect.top - 20;

          setPosition({
            x: clamp(newX, 0, rect.width - size.width),
            y: clamp(newY, 0, rect.height - size.height),
          });
        };

        const stopDrag = () => {
          dragRef.current = false;
          document.removeEventListener("mousemove", onDrag);
          document.removeEventListener("mouseup", stopDrag);
        };

        // ───────── RESIZE ─────────
        const startResize = (e) => {
          e.preventDefault();
          resizeRef.current = true;

          document.addEventListener("mousemove", onResize);
          document.addEventListener("mouseup", stopResize);
        };

        const onResize = (e) => {
          if (!resizeRef.current) return;

          const rect = rootDiv.getBoundingClientRect();

          const newWidth = e.clientX - rect.left - position.x;
          const newHeight = e.clientY - rect.top - position.y;

          setSize({
            width: clamp(newWidth, 400, rect.width),
            height: clamp(newHeight, 420, 900),
          });
        };

        const stopResize = () => {
          resizeRef.current = false;
          document.removeEventListener("mousemove", onResize);
          document.removeEventListener("mouseup", stopResize);
        };

        // Optional: center on load
        useEffect(() => {
          const rect = rootDiv.getBoundingClientRect();
          setPosition({
            x: rect.width / 2 - 270,
            y: 20,
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
              background: "#ffffff",
              borderRadius: "16px",
              boxShadow: "0 12px 40px rgba(0,0,0,0.15)",
              border: "1px solid #e5e7eb",
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
              transition: "box-shadow 0.2s ease",
            }}
          >
            {/* 🔝 Header (Drag Handle) */}
            <div
              onMouseDown={startDrag}
              style={{
                padding: "10px 14px",
                cursor: "move",
                background: "linear-gradient(135deg, #f8fafc, #ffffff)",
                borderBottom: "1px solid #eee",
                fontWeight: "600",
                fontSize: "13px",
                userSelect: "none",
              }}
            >
              🎤 Transcription Panel
            </div>

            {/* 📄 Content */}
            <div
              style={{
                flex: 1,
                overflow: "auto",
                padding: "10px",
                background: "#fafafa",
              }}
            >
              <GlassTranscriptionPanel
                doctorId={doctorId}
                patientId={patientId}
                onTranscribe={onTranscribe}
              />
            </div>

            {/* 🔻 Footer */}
            <div
              style={{
                padding: "6px",
                fontSize: "11px",
                textAlign: "center",
                borderTop: "1px solid #eee",
                background: "#fff",
                color: "#666",
              }}
            >
              Powered by{" "}
              <span style={{ fontWeight: "600", color: "#111" }}>
                doctorassist.ai
              </span>
            </div>

            {/* 🔲 Resize Handle */}
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
                  "linear-gradient(135deg, transparent 50%, #cbd5e1 50%)",
              }}
            />
          </div>
        );
      }

      root.render(<Widget />);
    },
  };
})();