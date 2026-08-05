import React, { useState } from "react";
import { User, Phone, MapPin, Calendar, VenusAndMars } from "lucide-react";

export default function PatientDemographics() {
  const [patient, setPatient] = useState({
    name: "THOMAS ANDREW",
    age: "34",
    mobile: "+1 234 567 890",
    sex: "Male",
    address: "1234 Elm Street, Springfield, IL, 62704",
  });

  const handleChange = (e) => {
    const { name, value } = e.target;
    setPatient((prev) => ({ ...prev, [name]: value }));
  };

  return (
    <div style={styles.container}>
      {/* Subtle gradient overlay for depth */}
      <div style={styles.gradientOverlay} />
      
      {/* Inner reflection effect */}
      <div style={styles.innerGlow} />
      
      <h2 style={styles.title}>
        <User size={22} style={styles.icon} /> Patient Demographics
      </h2>

      <div style={styles.formGrid}>
        {/* Name */}
        <div style={styles.field}>
          <label style={styles.label}>Full Name</label>
          <input
            type="text"
            name="name"
            value={patient.name}
            onChange={handleChange}
            placeholder="Enter patient name"
            style={styles.input}
          />
        </div>

        {/* Age */}
        <div style={styles.field}>
          <label style={styles.label}>Age</label>
          <input
            type="number"
            name="age"
            value={patient.age}
            onChange={handleChange}
            placeholder="Age"
            style={styles.input}
          />
        </div>

        {/* Mobile */}
        <div style={styles.field}>
          <label style={styles.label}>Mobile Number</label>
          <input
            type="tel"
            name="mobile"
            value={patient.mobile}
            onChange={handleChange}
            placeholder="+1 234 567 890"
            style={styles.input}
          />
        </div>

        {/* Sex */}
        <div style={styles.field}>
          <label style={styles.label}>Sex</label>
          <select
            name="sex"
            value={patient.sex}
            onChange={handleChange}
            style={styles.select}
          >
            <option value="">Select</option>
            <option value="Male">Male</option>
            <option value="Female">Female</option>
            <option value="Other">Other</option>
          </select>
        </div>

        {/* Address */}
        <div style={{ ...styles.field, gridColumn: "1 / -1" }}>
          <label style={styles.label}>Address</label>
          <textarea
            name="address"
            value={patient.address}
            onChange={handleChange}
            placeholder="Enter full address"
            style={styles.textarea}
          />
        </div>
      </div>
    </div>
  );
}

/* ==================== ENHANCED GLASS STYLES ==================== */

const styles = {
  container: {
    width: "100%",
    maxWidth: "900px",
    padding: "25px",
    borderRadius: "24px",
    position: "relative",
    overflow: "hidden",

    /* Soft glass background */
    background: "rgba(255, 255, 255, 0.12)",
    backdropFilter: "blur(18px) saturate(180%)",
    WebkitBackdropFilter: "blur(18px) saturate(180%)",
    border: "1px solid rgba(255, 255, 255, 0.15)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.05)",

    fontFamily: "'SF Pro Display', 'Inter', 'Roboto', -apple-system, sans-serif",
    color: "#111",
    display: "flex",
    flexDirection: "column",
  },

  title: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "22px",
    fontWeight: 400, // soft font
    marginBottom: "28px",
    color: "#333",
  },

  icon: {
    opacity: 0.7,
  },

  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(2, 1fr)",
    gap: "20px",
  },

  field: {
    display: "flex",
    flexDirection: "column",
  },

  label: {
    fontSize: "12px",
    fontWeight: 400,
    marginBottom: "6px",
    color: "#555",
    letterSpacing: "0.2px",
  },

  input: {
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.1)",
    outline: "none",
    fontSize: "14px",
    color: "#111",
    transition: "all 0.3s ease",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)",
  },

  select: {
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.1)",
    outline: "none",
    fontSize: "14px",
    color: "#111",
    cursor: "pointer",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)",
  },

  textarea: {
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid rgba(255,255,255,0.2)",
    background: "rgba(255,255,255,0.1)",
    outline: "none",
    fontSize: "14px",
    color: "#111",
    resize: "none",
    minHeight: "100px",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.05)",
  },
};
