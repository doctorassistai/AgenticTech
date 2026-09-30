import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

const O2CloseTab = () => {
  const { formData, updateField } = usePulmonology();
  const complianceStr = formData.o2_compliance_hrs
    ? `${formData.o2_compliance_hrs} hrs ${Number(formData.o2_compliance_hrs) >= 4 ? "(goal met)" : "(sub-target)"}`
    : "Pending session download";

  const isSigned = !!formData.o2_close_signed;

  return (
    <div>
      <Section title="Post-Night Review">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="MORNING SPO2 (OFF DEVICE)" name="o2_morn_spo2" placeholder="e.g. 90%" />
          <FormField label="OVERNIGHT COMPLIANCE" name="o2_overnight_comp" type="derived" derivedValue={complianceStr} />
          <FormField label="MORNING SYMPTOMS" name="o2_morn_symp" placeholder="e.g. Mild headache, otherwise well" />
          <FormField label="LEAK EVENTS" name="o2_leak_events" placeholder="e.g. 1 (04:30, resolved)" />
          <FormField label="NEXT REVIEW DATE" name="o2_next_review" type="date" />
        </div>
      </Section>

      <Section title="Session Closeout">
        <div style={{ border: "1px solid #e0e0e0", background: isSigned ? "#f0fdf4" : "#f5f5f5", padding: "14px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: "12px", fontWeight: 600, color: isSigned ? "#166534" : "#666666" }}>
            {isSigned 
              ? `Signed by ${formData.o2_close_signed_by || "Respiratory Therapist"} · ${formData.o2_close_signed_at || ""}`
              : "Pending Session Sign-Off"}
          </div>
          {!isSigned ? (
            <button
              type="button"
              onClick={() => {
                const now = new Date().toLocaleString();
                updateField("o2_close_signed", true);
                updateField("o2_close_signed_by", formData.team_rt || "Respiratory Therapist");
                updateField("o2_close_signed_at", now);
              }}
              style={{ padding: "6px 14px", background: "#000000", color: "#ffffff", border: "none", fontSize: "12px", cursor: "pointer" }}
            >
              Sign Off Session
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                updateField("o2_close_signed", false);
                updateField("o2_close_signed_by", "");
                updateField("o2_close_signed_at", "");
              }}
              style={{ padding: "4px 10px", background: "transparent", color: "#dc2626", border: "1px solid #dc2626", fontSize: "11px", cursor: "pointer" }}
            >
              Unlock
            </button>
          )}
        </div>
      </Section>
    </div>
  );
};

export default O2CloseTab;
