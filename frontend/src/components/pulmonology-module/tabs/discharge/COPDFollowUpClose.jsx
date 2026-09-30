import React from "react";
import Section from "../../components/Section";
import { usePulmonology } from "../../context/PulmonologyContext";

const CloseTab = () => {
  const { formData, updateField } = usePulmonology();
  const isSigned = !!formData.copd_close_signed;

  return (
    <div>
      <Section title="Visit Closeout">
        <div style={{ border: "1px solid #e0e0e0", background: isSigned ? "#f0fdf4" : "#f5f5f5", padding: "16px 20px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: isSigned ? "#166534" : "#666666" }}>
            {isSigned
              ? `Signed & Finalized by ${formData.copd_close_signed_by || "Attending Pulmonologist"} · ${formData.copd_close_signed_at || ""}`
              : "Pending sign-off — Pulmonology OPD Visit"}
          </div>

          <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
            {!isSigned ? (
              <button
                type="button"
                onClick={() => {
                  const now = new Date().toLocaleString();
                  updateField("copd_close_signed", true);
                  updateField("copd_close_signed_by", formData.team_pulmonologist || "Attending Pulmonologist");
                  updateField("copd_close_signed_at", now);
                }}
                style={{
                  fontFamily: '"Open Sans", sans-serif',
                  fontSize: "12px",
                  fontWeight: 500,
                  padding: "8px 18px",
                  border: "none",
                  background: "#000000",
                  color: "#ffffff",
                  cursor: "pointer",
                }}
              >
                Sign & Close Visit
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  updateField("copd_close_signed", false);
                  updateField("copd_close_signed_by", "");
                  updateField("copd_close_signed_at", "");
                }}
                style={{
                  fontFamily: '"Open Sans", sans-serif',
                  fontSize: "12px",
                  fontWeight: 500,
                  padding: "6px 14px",
                  border: "1px solid #dc2626",
                  background: "transparent",
                  color: "#dc2626",
                  cursor: "pointer",
                }}
              >
                Reopen Visit
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                updateField("copd_close_draft_saved_at", now);
                alert("Visit draft saved at " + now);
              }}
              style={{
                fontFamily: '"Open Sans", sans-serif',
                fontSize: "12px",
                fontWeight: 500,
                padding: "8px 18px",
                border: "1px solid #000000",
                background: "#ffffff",
                color: "#000000",
                cursor: "pointer",
              }}
            >
              {formData.copd_close_draft_saved_at ? `Draft Saved (${formData.copd_close_draft_saved_at})` : "Save Draft"}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default CloseTab;
