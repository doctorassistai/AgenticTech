import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

const TxCloseTab = () => {
  const { formData, updateField } = usePulmonology();
  const listingStatus = formData.tx_listing_status || "Workup in progress — not yet listed";
  const isSaved = !!formData.tx_close_saved_at;

  return (
    <div>
      <Section title="Transplant Workup Status & Closeout">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "20px" }}>
          <FormField
            label="FINAL MULTIDISCIPLINARY COMMITTEE RECOMMENDATION"
            name="tx_committee_rec"
            type="select"
            options={[
              "",
              "Approved — List for Bilateral Lung Transplant",
              "Approved — List for Single Lung Transplant",
              "Deferred — Optimize Reversible Factors & Re-evaluate (3 mo)",
              "Deferred — Pulmonary Rehabilitation Conditioning",
              "Not Recommended — Absolute Medical Contraindication",
              "Patient Declined Listing at this time",
            ]}
          />
          <FormField
            label="LISTING STATUS"
            name="tx_listing_status"
            type="select"
            options={[
              "Workup in progress — not yet listed",
              "Active on UNOS / National Registry",
              "Inactive (Hold / Medical Optimization)",
              "Transplanted — Post-Tx Followup",
              "Removed from Waitlist",
            ]}
          />
          <FormField
            label="NEXT MULTIDISCIPLINARY REVIEW"
            name="tx_next_mdt_date"
            type="date"
          />
        </div>

        <div style={{ border: "1px solid #e0e0e0", background: isSaved ? "#f0fdf4" : "#f5f5f5", padding: "16px 20px" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase", color: isSaved ? "#166534" : "#555555" }}>
            Current Status: {listingStatus} {isSaved ? `· Updated ${formData.tx_close_saved_at}` : ""}
          </div>
          <div style={{ display: "flex", gap: "10px", marginTop: "14px" }}>
            <button
              type="button"
              onClick={() => {
                const now = new Date().toLocaleString();
                updateField("tx_close_saved_at", now);
                alert("Transplant Workup summary updated successfully!");
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
              Update & Save Workup
            </button>
            <button
              type="button"
              onClick={() => {
                const now = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
                updateField("tx_close_draft_saved_at", now);
                alert("Draft saved at " + now);
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
              {formData.tx_close_draft_saved_at ? `Draft Saved (${formData.tx_close_draft_saved_at})` : "Save Draft"}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default TxCloseTab;
