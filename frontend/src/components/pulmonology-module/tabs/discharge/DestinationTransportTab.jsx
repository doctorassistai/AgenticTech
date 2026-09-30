import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

export default function DestinationTransportTab() {
  const { formData = {} } = usePulmonology();

  const isFacilityTransfer =
    formData.disp_destination === "Skilled Nursing Facility (SNF)" ||
    formData.disp_destination === "Long-Term Acute Care Hospital (LTACH)" ||
    formData.disp_destination === "Inpatient Rehabilitation Facility (IRF)" ||
    formData.disp_destination === "Transfer to Higher Acuity / ICU";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      {/* Header Banner */}
      <div
        style={{
          borderLeft: "3px solid #000",
          background: "#fff",
          padding: "12px 16px",
          border: "1px solid #e0e0e0",
          borderLeftWidth: "3px",
        }}
      >
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Destination &amp; Transport Logistics
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Coordinates post-acute level of care, transport modality, medical escort, and receiving facility handoff.
        </p>
      </div>

      {/* Post-Acute Disposition & Destination Level */}
      <Section title="Post-Acute Disposition & Destination Level" note="Defines receiving care facility and transfer coordination">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField
            label="DISCHARGE DESTINATION"
            name="disp_destination"
            type="select"
            options={[
              "",
              "Home (Self-Care)",
              "Home with Home Health (Nursing / RT)",
              "Skilled Nursing Facility (SNF)",
              "Long-Term Acute Care Hospital (LTACH)",
              "Inpatient Rehabilitation Facility (IRF)",
              "Home Hospice / Palliative Care",
              "Inpatient Hospice Unit",
              "Transfer to Higher Acuity / ICU",
            ]}
          />
          <FormField
            label="TRANSPORTATION METHOD"
            name="disp_transport_mode"
            type="select"
            options={[
              "",
              "Self / Family Transport (Private Vehicle)",
              "Wheelchair Van Service",
              "Ambulance (BLS with Supplemental O2)",
              "Ambulance (ALS with Ventilator/NIV)",
              "Critical Care Air Transport",
            ]}
          />
          <FormField
            label="TRANSPORT OXYGEN REQUIREMENT"
            name="disp_transport_o2"
            type="select"
            options={[
              "",
              "Room air — No O2 required",
              "Continuous O2 via portable tank",
              "Continuous NIV / Mechanical ventilator",
            ]}
          />
        </div>

        {/* Conditionally rendered facility fields */}
        {isFacilityTransfer && (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
            <FormField
              label="RECEIVING / ACCEPTING FACILITY NAME"
              name="disp_accepting_facility"
              placeholder="e.g. Metro Pulmonary Rehabilitation Institute"
            />
            <FormField
              label="ACCEPTING PHYSICIAN / SERVICE NAME"
              name="disp_accepting_provider"
              placeholder="e.g. Dr. Jane Doe (Medical Director / Pulmonologist)"
            />
          </div>
        )}

        {formData.disp_destination === "Transfer to Higher Acuity / ICU" && (
          <FormField
            label="CLINICAL RATIONALE FOR HIGHER ACUITY TRANSFER"
            name="disp_transfer_reason"
            type="textarea"
            placeholder="Document acute decompensation, refractory hypercapnic acidosis, hemodynamic instability, or intubation requirement..."
          />
        )}
      </Section>

      {/* Escort & Supervision Requirements */}
      <Section title="Medical Escort & Special En-Route Considerations" note="En-route airway monitoring and nursing requirements">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField
            label="MEDICAL ESCORT REQUIRED"
            name="disp_escort_needed"
            type="select"
            options={["", "No — Accompanied by family/caregiver", "Yes — Basic EMT / Paramedic", "Yes — Critical Care Transport Nurse / RT"]}
          />
          <FormField
            label="EN-ROUTE MONITORING TARGET"
            name="disp_escort_monitoring"
            placeholder="e.g. Continuous SpO2 >= 90%, vitals q15min"
          />
          <FormField
            label="CONFIRMED PICKUP TIME / ETA"
            name="disp_transport_eta"
            placeholder="e.g. 14:30 today / Scheduled for tomorrow AM"
          />
        </div>
      </Section>
    </div>
  );
}
