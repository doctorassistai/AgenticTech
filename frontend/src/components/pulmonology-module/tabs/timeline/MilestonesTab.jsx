import React from "react";
import Section from "../../components/Section";
import { usePulmonology } from "../../context/PulmonologyContext";

/**
 * MilestonesTab — Key Milestones Panel
 */
const MilestonesTab = () => {
  const { formData } = usePulmonology();
  const milestones = formData.milestones || [];

  return (
    <div>
      <div style={{ borderLeft: "3px solid #000", backgroundColor: "#f5f5f5", padding: "10px 14px", marginBottom: "16px" }}>
        <h4 style={{ fontSize: "10px", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "#000", marginBottom: "2px" }}>
          Key Milestones Summary
        </h4>
        <p style={{ fontSize: "12px", color: "#444" }}>Longitudinal milestone tracking across the patient care journey.</p>
      </div>

      <Section title="Milestone Table">
        {milestones.length === 0 ? (
          <div style={{ padding: "20px", textAlign: "center", color: "#888888", fontStyle: "italic", fontSize: "12.5px" }}>
            No key milestones recorded for this patient yet.
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Date", "Milestone", "FEV1 %", "Action Taken"].map(h => (
                  <th key={h} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #e0e0e0", backgroundColor: "#f5f5f5", color: "#000" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {milestones.map((m, idx) => (
                <tr key={idx}>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #e0e0e0" }}>{m.date || "—"}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #e0e0e0" }}>{m.title || m.milestone || "—"}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #e0e0e0" }}>{m.fev1 ? `${m.fev1}%` : "—"}</td>
                  <td style={{ padding: "8px 10px", borderBottom: "1px solid #e0e0e0" }}>{m.action || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
};

export default MilestonesTab;
