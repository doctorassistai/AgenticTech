import React, { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const styles = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');

  .chp * { box-sizing: border-box; margin: 0; padding: 0; }

  .chp {
    font-family: 'Inter', sans-serif;
    background: #fff;
    border-radius: 16px;
    padding: 24px;
    border: 1px solid #e8eaed;
    box-shadow: 0 2px 12px rgba(0,0,0,0.06);
  }

  /* Header */
  .chp-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 20px;
  }
  .chp-title {
    font-size: 16px;
    font-weight: 600;
    color: #111;
  }
  .chp-count {
    font-size: 12px;
    color: #888;
    background: #f4f4f5;
    padding: 3px 10px;
    border-radius: 20px;
  }

  /* Tabs */
  .chp-tabs {
    display: flex;
    gap: 2px;
    background: #f4f4f5;
    border-radius: 10px;
    padding: 3px;
    margin-bottom: 18px;
  }
  .chp-tab {
    flex: 1;
    padding: 8px;
    border: none;
    background: transparent;
    border-radius: 8px;
    font-family: 'Inter', sans-serif;
    font-size: 13px;
    font-weight: 500;
    color: #888;
    cursor: pointer;
    transition: all 0.15s;
  }
  .chp-tab.active {
    background: #fff;
    color: #111;
    box-shadow: 0 1px 4px rgba(0,0,0,0.08);
  }

  /* Scroll */
  .chp-scroll {
    max-height: 380px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .chp-scroll::-webkit-scrollbar { width: 4px; }
  .chp-scroll::-webkit-scrollbar-track { background: transparent; }
  .chp-scroll::-webkit-scrollbar-thumb { background: #e0e0e0; border-radius: 4px; }

  /* Card */
  .chp-card {
    border: 1px solid #ebebeb;
    border-radius: 12px;
    padding: 14px 16px;
    transition: border-color 0.15s;
  }
  .chp-card:hover { border-color: #d0d0d0; }

  .chp-card-time {
    font-size: 11px;
    color: #aaa;
    margin-bottom: 12px;
  }

  /* Fields */
  .chp-fields {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
    gap: 8px;
  }
  .chp-field {
    background: #f9f9f9;
    border-radius: 8px;
    padding: 8px 10px;
  }
  .chp-field-key {
    font-size: 10px;
    font-weight: 600;
    color: #aaa;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    margin-bottom: 3px;
  }
  .chp-field-val {
    font-size: 13px;
    color: #333;
    word-break: break-word;
    line-height: 1.4;
  }

  /* Empty / loading */
  .chp-center {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 200px;
    color: #bbb;
    font-size: 13px;
  }
`;

function FieldBlock({ block }) {
  if (!block || Object.keys(block).length === 0) {
    return <p style={{ fontSize: 13, color: "#bbb", padding: "8px 0" }}>No data available</p>;
  }
  return (
    <div className="chp-fields">
      {Object.entries(block).map(([key, val]) => (
        <div key={key} className="chp-field">
          <div className="chp-field-key">{key.replace(/_/g, " ")}</div>
          <div className="chp-field-val">
            {typeof val === "object" ? JSON.stringify(val) : String(val)}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ContextHistoryPanel({ patientId, doctorId }) {
  const [data, setData] = useState([]);
  const [tab, setTab] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchHistory(); }, []);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/context/context/all/${patientId}/${doctorId}`
      );
      const json = await res.json();
      if (json.status === "success") setData(json.data || []);
    } catch (err) {
      console.error("Failed to fetch history", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{styles}</style>
      <div className="chp">

        <div className="chp-header">
          <span className="chp-title">Context History</span>
          <span className="chp-count">{data.length} records</span>
        </div>

        <div className="chp-tabs">
          <button className={`chp-tab ${tab === 0 ? "active" : ""}`} onClick={() => setTab(0)}>
            Current Context
          </button>
          <button className={`chp-tab ${tab === 1 ? "active" : ""}`} onClick={() => setTab(1)}>
            Medical Context
          </button>
        </div>

        <div className="chp-scroll">
          {loading ? (
            <div className="chp-center">Loading…</div>
          ) : data.length === 0 ? (
            <div className="chp-center">No records found</div>
          ) : (
            data.map((item, i) => (
              <div key={i} className="chp-card">
                <div className="chp-card-time">
                  {new Date(item.updated_at).toLocaleString()}
                </div>
                <FieldBlock
                  block={tab === 0 ? item.current_clinical_context : item.medical_clinical_context}
                />
              </div>
            ))
          )}
        </div>

      </div>
    </>
  );
}