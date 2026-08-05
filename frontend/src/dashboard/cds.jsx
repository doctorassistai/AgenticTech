import React, { useState } from "react";
import { AlertCircle, CheckCircle } from "lucide-react";

export default function CDS() {
  const [alerts, setAlerts] = useState([
    {
      id: 1,
      type: "warning",
      message: "Patient has elevated blood pressure.",
    },
    {
      id: 2,
      type: "info",
      message: "Consider reviewing recent lab results.",
    },
    {
      id: 3,
      type: "success",
      message: "Medication adherence is on track.",
    },
  ]);

  return (
    <div style={styles.container}>
      <h2 style={styles.title}>Clinical Decision Support</h2>
      <div style={styles.alertsList}>
        {alerts.map((alert) => (
          <div
            key={alert.id}
            style={{
              ...styles.alertItem,
              background:
                alert.type === "warning"
                  ? "rgba(254, 202, 202, 0.2)"
                  : alert.type === "info"
                  ? "rgba(191, 219, 254, 0.2)"
                  : "rgba(209, 250, 229, 0.2)",
              borderColor:
                alert.type === "warning"
                  ? "rgba(254, 202, 202, 0.4)"
                  : alert.type === "info"
                  ? "rgba(191, 219, 254, 0.4)"
                  : "rgba(209, 250, 229, 0.4)",
            }}
          >
            <div style={styles.icon}>
              {alert.type === "warning" && <AlertCircle color="#f87171" />}
              {alert.type === "info" && <AlertCircle color="#60a5fa" />}
              {alert.type === "success" && <CheckCircle color="#34d399" />}
            </div>
            <span style={styles.message}>{alert.message}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: "100%",
    padding: "24px",
    borderRadius: "20px",
    background: "rgba(255, 255, 255, 0.12)",
    backdropFilter: "blur(18px) saturate(180%)",
    WebkitBackdropFilter: "blur(18px) saturate(180%)",
    border: "1px solid rgba(255,255,255,0.1)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.05)",
    display: "flex",
    flexDirection: "column",
    gap: "16px",
    fontFamily:
      "'SF Pro Display', 'Segoe UI', 'Roboto', 'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    color: "#222",
  },
  title: {
    fontSize: "20px",
    fontWeight: 400,
    marginBottom: "12px",
    color: "#222",
  },
  alertsList: {
    display: "flex",
    flexDirection: "column",
    gap: "12px",
  },
  alertItem: {
    display: "flex",
    alignItems: "center",
    padding: "14px 16px",
    borderRadius: "14px",
    border: "1px solid",
    fontSize: "14px",
    fontWeight: 400,
    color: "#222",
  },
  icon: {
    marginRight: "12px",
    display: "flex",
    alignItems: "center",
  },
  message: {
    flex: 1,
  },
};
