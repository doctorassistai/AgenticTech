import React, { useState } from "react";
import {
  Pill,
  Calendar,
  Clock,
  Trash2,
  AlertCircle,
  CheckCircle,
  ChevronDown,
  ChevronUp
} from "lucide-react";

/* ==================== BASE STYLES ==================== */

const baseInput = {
  padding: "14px 16px",
  borderRadius: "12px",
  border: "1px solid rgba(255, 255, 255, 0.5)",
  background: "rgba(255, 255, 255, 0.7)",
  outline: "none",
  fontSize: "14px",
  color: "#333",
  transition: "all 0.3s ease"
};

/* ==================== COMPONENT ==================== */

export default function ActiveMedications() {
  const [medications, setMedications] = useState([
    {
      id: 1,
      name: "Metformin",
      dosage: "500 mg",
      frequency: "Twice daily",
      route: "Oral",
      startDate: "2024-01-15",
      instructions: "Take with meals",
      status: "Active",
      prescribedBy: "Dr. Smith",
      lastRefill: "2024-02-01"
    },
    {
      id: 2,
      name: "Lisinopril",
      dosage: "10 mg",
      frequency: "Once daily",
      route: "Oral",
      startDate: "2023-11-20",
      instructions: "Take in the morning",
      status: "Active",
      prescribedBy: "Dr. Johnson",
      lastRefill: "2024-02-15"
    },
    {
      id: 3,
      name: "Atorvastatin",
      dosage: "20 mg",
      frequency: "Once daily",
      route: "Oral",
      startDate: "2024-02-01",
      instructions: "Take at bedtime",
      status: "Active",
      prescribedBy: "Dr. Smith",
      lastRefill: "2024-02-10"
    },
    {
      id: 4,
      name: "Amlodipine",
      dosage: "5 mg",
      frequency: "Once daily",
      route: "Oral",
      startDate: "2023-12-05",
      instructions: "May cause mild ankle swelling",
      status: "Active",
      prescribedBy: "Dr. Patel",
      lastRefill: "2024-02-05"
    },
    {
      id: 5,
      name: "Aspirin",
      dosage: "81 mg",
      frequency: "Once daily",
      route: "Oral",
      startDate: "2022-08-10",
      instructions: "Take with food to avoid stomach upset",
      status: "Active",
      prescribedBy: "Dr. Lee",
      lastRefill: "2024-02-01"
    }
  ]);

  const [expandedId, setExpandedId] = useState(null);

  const handleDelete = (id) => {
    setMedications(medications.filter((m) => m.id !== id));
  };

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  const getDaysUntilRefill = (lastRefill) => {
    const refill = new Date(lastRefill);
    refill.setMonth(refill.getMonth() + 1);
    return Math.ceil((refill - new Date()) / (1000 * 60 * 60 * 24));
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <Pill size={22} /> Active Medications
          <span style={styles.badge}>{medications.length}</span>
        </h2>
      </div>

      <div style={styles.medicationsList}>
        {medications.map((med) => (
          <div key={med.id} style={styles.medicationCard}>
            <div
              style={styles.medicationHeader}
              onClick={() => toggleExpand(med.id)}
            >
              {med.name}
              {expandedId === med.id ? <ChevronUp /> : <ChevronDown />}
            </div>

            {expandedId === med.id && (
              <div style={styles.expandedDetails}>
                <p><strong>Dosage:</strong> {med.dosage}</p>
                <p><strong>Frequency:</strong> {med.frequency}</p>
                <p><strong>Route:</strong> {med.route}</p>
                <p><strong>Instructions:</strong> {med.instructions}</p>
                <p><strong>Prescribed By:</strong> {med.prescribedBy}</p>

                <p>
                  <strong>Next refill in:</strong>{" "}
                  <span
                    style={{
                      color:
                        getDaysUntilRefill(med.lastRefill) <= 7
                          ? "#ef4444"
                          : "#10b981",
                      fontWeight: 600
                    }}
                  >
                    {getDaysUntilRefill(med.lastRefill)} days
                  </span>
                </p>

                <button
                  style={styles.iconButton}
                  onClick={() => handleDelete(med.id)}
                >
                  <Trash2 size={18} /> Remove
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ==================== STYLES ==================== */

const styles = {
  container: {
    width: "100%",
    padding: "28px",
    borderRadius: "24px",
    background: "rgba(255, 255, 255, 0.12)",
    backdropFilter: "blur(30px) saturate(180%)",
    WebkitBackdropFilter: "blur(30px) saturate(180%)",
    border: "1px solid rgba(255, 255, 255, 0.2)",
    boxShadow: "0 8px 32px rgba(0,0,0,0.06), inset 0 1px 0 rgba(255,255,255,0.15)",
    color: "#111",
    fontFamily: "'SF Pro Display', 'Segoe UI', 'Roboto', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    display: "flex",
    flexDirection: "column",
  },

  header: {
    marginBottom: "20px",
  },

  title: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "20px",
    fontWeight: 400,
    color: "#111",
  },

  badge: {
    background: "rgba(58, 143, 254, 0.2)",
    color: "#3a8ffe",
    padding: "2px 8px",
    borderRadius: "10px",
    fontSize: "12px",
  },

  medicationsList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },

  medicationCard: {
    padding: "16px",
    borderRadius: "18px",
    background: "rgba(255, 255, 255, 0.08)",
    backdropFilter: "blur(20px) saturate(180%)",
    WebkitBackdropFilter: "blur(20px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.15)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.05), inset 0 1px 0 rgba(255,255,255,0.1)",
    cursor: "pointer",
    transition: "all 0.3s ease",
    color: "#111",
    fontFamily: "'SF Pro Display', 'Segoe UI', 'Roboto', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },

  medicationHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontWeight: 400,
    fontSize: "15px",
    color: "#111",
  },

  expandedDetails: {
    marginTop: "10px",
    lineHeight: 1.5,
    fontSize: "13px",
    color: "#333",
  },

  iconButton: {
    marginTop: "10px",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    background: "rgba(239,68,68,0.15)",
    border: "none",
    borderRadius: "10px",
    padding: "4px 10px",
    cursor: "pointer",
    fontWeight: 400,
    color: "#ef4444",
    transition: "all 0.2s ease",
  },
};

