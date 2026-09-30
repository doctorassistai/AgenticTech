import React from 'react';

const AIInsightsPanel = ({ data }) => {
  return (
    <div style={{
      background: "linear-gradient(145deg, #1e1e2f 0%, #151520 100%)",
      borderRadius: "12px",
      padding: "24px",
      color: "#fff",
      boxShadow: "0 8px 32px rgba(0,0,0,0.15)",
      border: "1px solid #333",
      marginBottom: "24px"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "16px" }}>
        <div style={{ width: "24px", height: "24px", background: "#4caf50", borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px" }}>✨</div>
        <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "600", letterSpacing: "0.5px" }}>Llama 8B Clinical Insights</h3>
      </div>
      
      <div style={{ background: "rgba(255,255,255,0.05)", padding: "16px", borderRadius: "8px", marginBottom: "16px" }}>
        <h4 style={{ fontSize: "12px", textTransform: "uppercase", color: "#aaa", marginBottom: "8px", letterSpacing: "1px" }}>"What Changed?" Engine</h4>
        <p style={{ fontSize: "14px", lineHeight: "1.5", color: "#eee", margin: 0, fontStyle: "italic" }}>
          {data?.deltaSummary || "Awaiting Llama 8B backend integration. Please complete data collection fields first."}
        </p>
      </div>

      <div style={{ background: "rgba(255,255,255,0.05)", padding: "16px", borderRadius: "8px" }}>
        <h4 style={{ fontSize: "12px", textTransform: "uppercase", color: "#aaa", marginBottom: "8px", letterSpacing: "1px" }}>Etiology Differential</h4>
        <p style={{ fontSize: "14px", lineHeight: "1.5", color: "#eee", margin: 0, fontStyle: "italic" }}>
          {data?.differential || "Awaiting Llama 8B backend integration. Please complete data collection fields first."}
        </p>
      </div>
    </div>
  );
};

export default AIInsightsPanel;
