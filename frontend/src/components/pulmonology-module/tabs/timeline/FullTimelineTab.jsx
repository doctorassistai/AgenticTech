import React from "react";
import Section from "../../components/Section";
import { usePulmonology } from "../../context/PulmonologyContext";

/**
 * FullTimelineTab — Dynamic Patient Timeline Panel
 */
const FullTimelineTab = () => {
  const { formData, setActiveTab } = usePulmonology();
  const events = formData.timeline_events || [];

  return (
    <div>
      <div style={{ borderLeft: "3px solid #000", backgroundColor: "#f5f5f5", padding: "10px 14px", marginBottom: "16px" }}>
        <h4 style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#000", marginBottom: "2px" }}>
          Complete Patient Timeline
        </h4>
        <p style={{ fontSize: "12px", color: "#444" }}>Chronological event trajectory derived from clinical encounters.</p>
      </div>

      {events.length === 0 ? (
        <div style={{ padding: "24px", textAlign: "center", color: "#888888", border: "1px dashed #cccccc", background: "#fafafa", fontSize: "12.5px" }}>
          No historical timeline events recorded for this patient.
        </div>
      ) : (
        <div style={{ position: "relative", paddingLeft: "24px", borderLeft: "2px solid #e0e0e0", margin: "6px 0 16px 10px" }}>
          {events.map((ev, i) => (
            <div
              key={i}
              onClick={() => ev.target && setActiveTab(ev.target)}
              style={{ position: "relative", marginBottom: "18px", cursor: ev.target ? "pointer" : "default" }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "-31px",
                  top: "3px",
                  width: "10px",
                  height: "10px",
                  borderRadius: "50%",
                  backgroundColor: ev.isNow ? "#000" : "#fff",
                  border: "2px solid #000",
                }}
              />
              <div style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: "#888" }}>
                {ev.date}
              </div>
              <div style={{ fontSize: "12.5px", fontWeight: 600, color: "#000" }}>{ev.title}</div>
              <div style={{ fontSize: "11px", color: "#444" }}>{ev.desc}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default FullTimelineTab;
