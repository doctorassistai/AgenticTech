import React, { useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { usePulmonology } from "../../context/PulmonologyContext";

export default function EquipmentDMETab() {
  const { formData = {}, updateField } = usePulmonology();

  // Auto-suggest DME Orders based on upstream Airway Management
  useEffect(() => {
    const hasO2 = formData.air_o2_device && !formData.air_o2_device.toLowerCase().includes("none") && !formData.air_o2_device.toLowerCase().includes("room air");
    if (hasO2 && !formData.disp_dme_o2_ordered) {
      updateField("disp_dme_o2_ordered", true);
    }
    if (formData.air_niv_mode && !formData.disp_dme_niv_ordered) {
      updateField("disp_dme_niv_ordered", true);
    }
  }, [formData.air_o2_device, formData.air_niv_mode, formData.disp_dme_o2_ordered, formData.disp_dme_niv_ordered, updateField]);

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
          Equipment &amp; DME Orders
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          Durable Medical Equipment requisitions, home oxygen setup, non-invasive ventilator delivery, and vendor confirmations.
        </p>
      </div>

      {/* Durable Medical Equipment Orders */}
      <Section title="Durable Medical Equipment (DME) Orders & Requisition" note="Ensure home respiratory equipment is confirmed prior to discharge">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField
            label="HOME OXYGEN CONCENTRATOR"
            name="disp_dme_o2_concentrator"
            type="select"
            options={[
              "Not Needed",
              "Ordered — Stationary Concentrator (5L/min)",
              "Ordered — High-Flow Concentrator (10L/min)",
              "Patient Already Has Stationary Unit",
            ]}
          />
          <FormField
            label="PORTABLE OXYGEN MODALITY"
            name="disp_dme_o2_portable"
            type="select"
            options={[
              "Not Needed",
              "E-Cylinders with Conserving Regulator",
              "Portable Oxygen Concentrator (POC)",
              "Liquid Oxygen Unit",
              "Patient Already Has Portable O2",
            ]}
          />
          <FormField
            label="NON-INVASIVE VENTILATOR (NIV/BiPAP)"
            name="disp_dme_niv_device"
            type="select"
            options={[
              "Not Needed",
              "Ordered — BiPAP S/T Home Machine",
              "Ordered — Auto-CPAP Machine",
              "Ordered — AVAPS Device",
              "Patient Already Has Device",
            ]}
          />
          <FormField
            label="NIV MASK TYPE ORDERED"
            name="disp_dme_niv_mask"
            type="select"
            options={[
              "Not Applicable",
              "Full Face Mask (Size M)",
              "Full Face Mask (Size L)",
              "Nasal Mask (Size M)",
              "Nasal Pillows",
              "Total Face Mask",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "16px" }}>
          <FormField
            label="COMPRESSOR / MESH NEBULIZER"
            name="disp_dme_nebulizer"
            type="select"
            options={[
              "Not Needed",
              "Ordered — Tabletop Compressor Nebulizer",
              "Ordered — Portable Mesh Nebulizer",
              "Patient Already Has Nebulizer",
            ]}
          />
          <FormField
            label="MOBILITY AID / ASSISTIVE DEVICE"
            name="disp_dme_mobility_aid"
            type="select"
            options={[
              "None",
              "Standard Walker",
              "Four-Wheel Rollator with Seat",
              "Lightweight Wheelchair",
              "Single-Point Cane",
            ]}
          />
          <FormField
            label="DME SUPPLIER / VENDOR COMPANY"
            name="disp_dme_supplier"
            placeholder="e.g. Reliable Respiratory Services Ltd."
          />
          <FormField
            label="CONFIRMED DELIVERY DATE"
            name="disp_dme_delivery_date"
            type="date"
          />
        </div>
      </Section>

      {/* Verification & Setup Status */}
      <Section title="In-Home Equipment Delivery & Setup Verification" note="Confirms active patient readiness before departure">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField
            label="DELIVERY CONFIRMATION STATUS"
            name="disp_dme_status"
            type="select"
            options={["", "Delivered & Set up at Patient Residence", "Scheduled for Delivery Before Discharge", "Patient Self-Providing", "Pending Vendor Authorization"]}
          />
          <FormField
            label="BACKUP O2 CYLINDERS PROVIDED"
            name="disp_dme_backup_o2"
            type="select"
            options={["Not Applicable", "Yes — 2+ E-tanks with regulator on site", "Pending Delivery", "No backup requested"]}
          />
          <FormField
            label="VENDOR 24/7 SUPPORT CONTACT"
            name="disp_dme_contact"
            placeholder="e.g. 1-800-555-RESP (Dispatch)"
          />
        </div>
      </Section>
    </div>
  );
}
