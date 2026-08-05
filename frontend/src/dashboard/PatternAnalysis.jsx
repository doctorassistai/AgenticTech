import React, { useState } from "react";
import { Activity, ChevronDown, ChevronUp } from "lucide-react";

export default function PatternAnalysis() {
  const [patterns] = useState([
    {
      id: 1,
      title: "Cardiology Patterns",
      description:
        "Analyzing patient heart rate trends, blood pressure, and ECG data to detect anomalies early."
    },
    {
      id: 2,
      title: "Neurology Patterns",
      description:
        "Monitoring brain activity trends and identifying early signs of neurological disorders."
    },
    {
      id: 3,
      title: "Medication Adherence",
      description:
        "Tracking patient adherence to prescribed medications and highlighting inconsistencies."
    },
    {
      id: 4,
      title: "Lab Test Trends",
      description:
        "Analyzing lab test history to identify abnormalities and correlations between results."
    }
  ]);

  const [expandedId, setExpandedId] = useState(null);

  const toggleExpand = (id) => {
    setExpandedId(expandedId === id ? null : id);
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h2 style={styles.title}>
          <Activity size={22} /> Pattern Analysis
          <span style={styles.badge}>{patterns.length}</span>
        </h2>
      </div>

      <div style={styles.list}>
        {patterns.map((p) => (
          <div
            key={p.id}
            style={styles.card}
            onClick={() => toggleExpand(p.id)}
          >
            <div style={styles.cardHeader}>
              {p.title}
              {expandedId === p.id ? <ChevronUp /> : <ChevronDown />}
            </div>

            {expandedId === p.id && (
              <div style={styles.expandedDetails}>
                <p>{p.description}</p>
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
    marginBottom: "20px"
  },

  title: {
    display: "flex",
    alignItems: "center",
    gap: "10px",
    fontSize: "20px",
    fontWeight: 400,
    color: "#111"
  },

  badge: {
    background: "rgba(58, 143, 254, 0.2)",
    color: "#3a8ffe",
    padding: "2px 8px",
    borderRadius: "10px",
    fontSize: "12px"
  },

  list: {
    display: "flex",
    flexDirection: "column",
    gap: "12px"
  },

  card: {
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
  },

  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    fontWeight: 400,
    fontSize: "15px",
    color: "#111"
  },

  expandedDetails: {
    marginTop: "10px",
    lineHeight: 1.5,
    fontSize: "14px",
    color: "#333"
  }
};
