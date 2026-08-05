import { useState, useEffect } from "react";

const BASE = "https://doctorassist.ai//api/insurance";

const CopyIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const CheckIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="20 6 9 17 4 12" />
  </svg>
);

export default function FieldOfficersList() {
  const [officers, setOfficers]   = useState([]);
  const [avail, setAvail]         = useState({});   // { [userId]: availability record }
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError]         = useState("");
  const [passwords, setPasswords] = useState({});
  const [copiedId, setCopiedId]   = useState(null);

  // leave modal state
  const [leaveModal, setLeaveModal] = useState(null);  // { userId, fullName } or null
  const [leaveFrom, setLeaveFrom]   = useState("");
  const [leaveTo, setLeaveTo]       = useState("");
  const [leaveReason, setLeaveReason] = useState("");
  const [leaveLoading, setLeaveLoading] = useState(false);

  // delete confirm
  const [deleteId, setDeleteId] = useState(null);

  useEffect(() => {
    fetch(`${BASE}/api/hms/users/field-officers`)
      .then(r => r.json())
      .then(d => setOfficers(d.data || []))
      .catch(() => setError("Failed to load field officers."));

    fetch(`${BASE}/app/availability/all`)
      .then(r => r.json())
      .then(d => {
        const map = {};
        (d.officers || []).forEach(o => { map[o.userId] = o; });
        setAvail(map);
      })
      .catch(() => {});
  }, []);

  const resetPassword = async (id) => {
    setLoadingId(id);
    setError("");
    setPasswords(prev => ({ ...prev, [id]: null }));
    try {
      const res = await fetch(`${BASE}/api/hms/users/reset-password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: id }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const data = await res.json();
      if (data.new_password) {
        setPasswords(prev => ({ ...prev, [id]: data.new_password }));
      } else {
        throw new Error(data.message || "No password returned.");
      }
    } catch (err) {
      setError("Reset failed: " + err.message);
    } finally {
      setLoadingId(null);
    }
  };

  const copyPassword = (id) => {
    const pwd = passwords[id];
    if (!pwd) return;
    navigator.clipboard.writeText(pwd).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  const openLeaveModal = (o) => {
    setLeaveModal({ userId: o.sys_user_id || o._id, fullName: o.full_name });
    setLeaveFrom("");
    setLeaveTo("");
    setLeaveReason("");
  };

  const submitLeave = async () => {
    if (!leaveFrom || !leaveTo) { setError("Select both dates."); return; }
    if (leaveTo < leaveFrom)   { setError("End date must be after start."); return; }
    setLeaveLoading(true);
    setError("");
    try {
      const res = await fetch(`${BASE}/app/availability/leave`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId:   leaveModal.userId,
          fromDate: leaveFrom,
          toDate:   leaveTo,
          reason:   leaveReason,
        }),
      });
      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      // update local avail state
      setAvail(prev => ({
        ...prev,
        [leaveModal.userId]: {
          ...(prev[leaveModal.userId] || {}),
          status:      "Unavailable",
          leaveFrom,
          leaveTo,
          leaveReason,
        }
      }));
      setLeaveModal(null);
    } catch (err) {
      setError("Leave failed: " + err.message);
    } finally {
      setLeaveLoading(false);
    }
  };

  const clearLeave = async (userId) => {
    try {
      await fetch(`${BASE}/app/availability/leave/${userId}`, { method: "DELETE" });
      setAvail(prev => ({
        ...prev,
        [userId]: { ...(prev[userId] || {}), status: "Available", leaveFrom: null, leaveTo: null }
      }));
    } catch {
      setError("Failed to clear leave.");
    }
  };

  const deleteOfficer = async (id) => {
    try {
      await fetch(`${BASE}/api/hms/users/${id}`, { method: "DELETE" });
      setOfficers(prev => prev.filter(o => (o.sys_user_id || o._id) !== id));
    } catch {
      setError("Delete failed.");
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header">
        <div className="panel-title">Field Officers</div>
      </div>

      {error && (
        <div style={{
          background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5",
          borderRadius: 6, padding: "10px 14px", margin: "10px 0", fontSize: 14,
        }}>
          ⚠️ {error}
          <button onClick={() => setError("")} style={{ float: "right", background: "none", border: "none", cursor: "pointer", color: "#b91c1c" }}>✕</button>
        </div>
      )}

      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#f1f5f9" }}>
            <th style={th}>Name</th>
            <th style={th}>Username</th>
            <th style={th}>Mobile</th>
            <th style={th}>Status</th>
            <th style={th}>New Password</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {officers.length === 0 && (
            <tr>
              <td colSpan={6} style={{ textAlign: "center", padding: 20, color: "#94a3b8" }}>
                No field officers found.
              </td>
            </tr>
          )}
          {officers.map((o) => {
            const userId = o.sys_user_id || o._id;
            const rec    = avail[userId] || {};
            const onLeave = rec.status === "Unavailable" && rec.leaveFrom;

            return (
              <tr key={o._id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                <td style={td}>{o.full_name}</td>
                <td style={td}>{o.username}</td>
                <td style={td}>{o.phone_number}</td>

                {/* Status */}
                <td style={td}>
                  {rec.status ? (
                    <span style={{
                      display: "inline-block",
                      padding: "2px 10px",
                      borderRadius: 12,
                      fontSize: 12,
                      fontWeight: 600,
                      background: rec.status === "Available" ? "#dcfce7" : "#fee2e2",
                      color:      rec.status === "Available" ? "#16a34a" : "#b91c1c",
                    }}>
                      {rec.status}
                      {onLeave && ` (${rec.leaveFrom} → ${rec.leaveTo})`}
                    </span>
                  ) : (
                    <span style={{ color: "#cbd5e1", fontSize: 12 }}>—</span>
                  )}
                </td>

                {/* Password */}
                <td style={td}>
                  {passwords[o._id] ? (
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <code style={{
                        background: "#f1f5f9", padding: "3px 8px",
                        borderRadius: 4, fontSize: 13,
                      }}>
                        {passwords[o._id]}
                      </code>
                      <button onClick={() => copyPassword(o._id)} style={iconBtn(copiedId === o._id)}>
                        {copiedId === o._id ? <CheckIcon /> : <CopyIcon />}
                      </button>
                    </span>
                  ) : (
                    <span style={{ color: "#cbd5e1", fontSize: 13 }}>—</span>
                  )}
                </td>

                {/* Actions */}
                <td style={{ ...td, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {/* Reset Password */}
                  <button
                    onClick={() => resetPassword(o._id)}
                    disabled={loadingId === o._id}
                    style={actionBtn("#3b82f6", loadingId === o._id)}
                  >
                    {loadingId === o._id ? "Resetting…" : "Reset Pwd"}
                  </button>

                  {/* Mark Leave */}
                  {!onLeave ? (
                    <button onClick={() => openLeaveModal(o)} style={actionBtn("#f59e0b")}>
                      Mark Leave
                    </button>
                  ) : (
                    <button onClick={() => clearLeave(userId)} style={actionBtn("#16a34a")}>
                      Clear Leave
                    </button>
                  )}

                  {/* Delete */}
                  {deleteId === userId ? (
                    <>
                      <button onClick={() => deleteOfficer(userId)} style={actionBtn("#dc2626")}>Confirm</button>
                      <button onClick={() => setDeleteId(null)} style={actionBtn("#64748b")}>Cancel</button>
                    </>
                  ) : (
                    <button onClick={() => setDeleteId(userId)} style={actionBtn("#dc2626")}>Delete</button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Leave Modal */}
      {leaveModal && (
        <div style={overlay}>
          <div style={modal}>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 16 }}>
              Mark Leave — {leaveModal.fullName}
            </div>

            <label style={lbl}>From Date</label>
            <input type="date" value={leaveFrom} onChange={e => setLeaveFrom(e.target.value)} style={input} />

            <label style={lbl}>To Date</label>
            <input type="date" value={leaveTo} onChange={e => setLeaveTo(e.target.value)} style={input} />

            <label style={lbl}>Reason (optional)</label>
            <input
              type="text"
              value={leaveReason}
              onChange={e => setLeaveReason(e.target.value)}
              placeholder="e.g. Medical leave"
              style={input}
            />

            <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
              <button onClick={submitLeave} disabled={leaveLoading} style={actionBtn("#f59e0b", leaveLoading)}>
                {leaveLoading ? "Saving…" : "Confirm Leave"}
              </button>
              <button onClick={() => setLeaveModal(null)} style={actionBtn("#64748b")}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── styles ────────────────────────────────────────────────────────────────────

const th = { textAlign: "left", padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#475569" };
const td = { padding: "10px 12px", fontSize: 14, color: "#1e293b" };

const actionBtn = (bg, disabled = false) => ({
  background: disabled ? "#94a3b8" : bg,
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "5px 12px",
  cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 12,
  fontWeight: 500,
  whiteSpace: "nowrap",
});

const iconBtn = (active) => ({
  background: "none",
  border: "1px solid #cbd5e1",
  borderRadius: 5,
  padding: "3px 6px",
  cursor: "pointer",
  color: active ? "#16a34a" : "#64748b",
  display: "flex",
  alignItems: "center",
});

const overlay = {
  position: "fixed", inset: 0,
  background: "rgba(0,0,0,0.4)",
  display: "flex", alignItems: "center", justifyContent: "center",
  zIndex: 1000,
};

const modal = {
  background: "#fff",
  borderRadius: 10,
  padding: 24,
  width: 360,
  boxShadow: "0 10px 40px rgba(0,0,0,0.2)",
};

const lbl = { display: "block", fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 4, marginTop: 12 };
const input = { width: "100%", border: "1px solid #cbd5e1", borderRadius: 6, padding: "7px 10px", fontSize: 14, boxSizing: "border-box" };