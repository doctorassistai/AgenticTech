import { useState, useEffect, useMemo } from "react";

const BASE = "https://doctorassist.ai/api/insurance";

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

const ChartIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 17 9 11 13 15 21 5" />
    <polyline points="14 5 21 5 21 12" />
  </svg>
);

/* ── Lightweight dependency-free SVG line chart ──────────────────────────
   Draws two cumulative lines (Assigned / Generated) over a date axis.
   No charting library required. */
function LineChartSVG({ data }) {
  const width = 640;
  const height = 260;
  const padL = 44, padR = 16, padT = 16, padB = 34;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  if (!data || data.length === 0) {
    return (
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center",
        height, color: "#94a3b8", fontSize: 13,
      }}>
        No timeline data yet — assign a case and generate a report to see trends.
      </div>
    );
  }

  const maxVal = Math.max(
    1,
    ...data.map(d => Math.max(d.assigned_cumulative, d.generated_cumulative))
  );

  const xFor = (i) => data.length === 1
    ? padL + innerW / 2
    : padL + (i / (data.length - 1)) * innerW;
  const yFor = (v) => padT + innerH - (v / maxVal) * innerH;

  const pathFor = (key) =>
    data.map((d, i) => `${i === 0 ? "M" : "L"} ${xFor(i)} ${yFor(d[key])}`).join(" ");

  // Show at most 5 evenly-spaced date labels so it doesn't get crowded
  const labelIdxs = new Set();
  const step = Math.max(1, Math.floor((data.length - 1) / 4));
  for (let i = 0; i < data.length; i += step) labelIdxs.add(i);
  labelIdxs.add(data.length - 1);

  // Y-axis gridlines (0, mid, max)
  const yTicks = [0, Math.round(maxVal / 2), maxVal];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} style={{ overflow: "visible" }}>
      {/* Gridlines + Y labels */}
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={padL} x2={width - padR} y1={yFor(t)} y2={yFor(t)}
            stroke="#e2e8f0" strokeWidth={1} />
          <text x={padL - 8} y={yFor(t) + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
            {t}
          </text>
        </g>
      ))}

      {/* X labels */}
      {data.map((d, i) => labelIdxs.has(i) && (
        <text key={i} x={xFor(i)} y={height - padB + 16} textAnchor="middle" fontSize="9" fill="#94a3b8">
          {d.date.slice(5)}
        </text>
      ))}

      {/* Generated line (drawn first so Assigned sits on top if overlapping) */}
      <path d={pathFor("generated_cumulative")} fill="none" stroke="#16a34a" strokeWidth={2} />
      {/* Assigned line */}
      <path d={pathFor("assigned_cumulative")} fill="none" stroke="#3b82f6" strokeWidth={2} />

      {/* Dots with native tooltips */}
      {data.map((d, i) => (
        <g key={`pts-${i}`}>
          <circle cx={xFor(i)} cy={yFor(d.assigned_cumulative)} r={3} fill="#3b82f6">
            <title>{`${d.date} — Assigned: ${d.assigned_cumulative}`}</title>
          </circle>
          <circle cx={xFor(i)} cy={yFor(d.generated_cumulative)} r={3} fill="#16a34a">
            <title>{`${d.date} — Generated: ${d.generated_cumulative}`}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}

function StatsModal({ onClose }) {
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [stats, setStats]     = useState(null);

  // NEW: date range state
  const [rangeMode, setRangeMode] = useState("all");   // "all" | "today" | "yesterday" | "custom"
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd]     = useState("");

  const fetchStats = () => {
    setLoading(true);
    setError("");

    const params = new URLSearchParams();
    if (rangeMode !== "all") params.set("range", rangeMode);
    if (rangeMode === "custom") {
      if (!customStart || !customEnd) {
        setLoading(false);
        setError("Pick both a start and end date for custom range.");
        return;
      }
      params.set("start_date", customStart);
      params.set("end_date", customEnd);
    }

    fetch(`${BASE}/web/doctors/stats?${params.toString()}`)
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => setError("Failed to load stats."))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeMode]);   // custom range fetches on button click, not on every keystroke

  const rows = useMemo(() => {
    if (!stats?.doctors) return [];
    return [...stats.doctors].sort((a, b) => b.assigned_count - a.assigned_count);
  }, [stats]);

  // NEW: flatten doctor_daily into rows for the breakdown table
  const dailyRows = useMemo(() => {
    if (!stats?.doctor_daily) return [];
    const nameMap = Object.fromEntries((stats.doctors || []).map(d => [d.doctor_id, d.name]));
    const out = [];
    for (const [docId, days] of Object.entries(stats.doctor_daily)) {
      for (const [day, counts] of Object.entries(days)) {
        out.push({
          doctor_id: docId,
          name: nameMap[docId] || docId,
          date: day,
          assigned: counts.assigned,
          generated: counts.generated,
        });
      }
    }
    // sort by date desc, then doctor name
    return out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));
  }, [stats]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 10, width: "100%", maxWidth: 820, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.25)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid #e2e8f0" }}>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#0f172a" }}>Doctor Report Stats</div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
              Cases assigned vs. reports generated (PDF / Word / Formatted Word)
            </div>
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", fontSize: 18, color: "#64748b", lineHeight: 1, padding: 4 }}>✕</button>
        </div>

        <div style={{ padding: "18px 20px" }}>
          {/* NEW: date range controls */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            {["all", "today", "yesterday", "custom"].map(mode => (
              <button
                key={mode}
                onClick={() => setRangeMode(mode)}
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500,
                  border: rangeMode === mode ? "1px solid #3b82f6" : "1px solid #cbd5e1",
                  background: rangeMode === mode ? "#eff6ff" : "#fff",
                  color: rangeMode === mode ? "#1d4ed8" : "#334155",
                  cursor: "pointer", textTransform: "capitalize",
                }}
              >
                {mode === "all" ? "All time" : mode}
              </button>
            ))}

            {rangeMode === "custom" && (
              <>
                <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                  style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }} />
                <span style={{ fontSize: 12, color: "#64748b" }}>to</span>
                <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                  style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #cbd5e1", fontSize: 12 }} />
                <button onClick={fetchStats}
                  style={{ padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500, border: "none", background: "#3b82f6", color: "#fff", cursor: "pointer" }}>
                  Apply
                </button>
              </>
            )}
          </div>

          {loading && <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontSize: 13 }}>Loading stats…</div>}

          {error && (
            <div style={{ background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 6, padding: "10px 14px", fontSize: 13, marginBottom: 14 }}>
              ⚠️ {error}
            </div>
          )}

          {!loading && !error && stats && (
            <>
              <div style={{ display: "flex", gap: 20, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#334155" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#3b82f6", display: "inline-block" }} />
                  Assigned (total: {stats.totals?.assigned ?? 0})
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#334155" }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#16a34a", display: "inline-block" }} />
                  Generated (total: {stats.totals?.generated ?? 0})
                </div>
              </div>

              <div style={{ border: "1px solid #e2e8f0", borderRadius: 8, padding: "12px 8px 4px" }}>
                <LineChartSVG data={stats.timeline} />
              </div>

              {/* Per-doctor summary (respects selected range) */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Per-doctor breakdown {rangeMode !== "all" && `— ${rangeMode}`}
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={th}>Doctor</th>
                      <th style={{ ...th, textAlign: "right" }}>Assigned</th>
                      <th style={{ ...th, textAlign: "right" }}>Generated</th>
                      <th style={{ ...th, textAlign: "right" }}>Completion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 13 }}>No cases in this range.</td></tr>
                    )}
                    {rows.map(r => {
                      const pct = r.assigned_count > 0 ? Math.round((r.generated_count / r.assigned_count) * 100) : 0;
                      return (
                        <tr key={r.doctor_id} style={{ borderBottom: "1px solid #e2e8f0" }}>
                          <td style={td}>{r.name}</td>
                          <td style={{ ...td, textAlign: "right" }}>{r.assigned_count}</td>
                          <td style={{ ...td, textAlign: "right" }}>{r.generated_count}</td>
                          <td style={{ ...td, textAlign: "right" }}>
                            <span style={{ fontSize: 12, fontWeight: 600, color: pct >= 70 ? "#16a34a" : pct >= 40 ? "#d97706" : "#dc2626" }}>{pct}%</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* NEW: per-doctor per-day breakdown table */}
              <div style={{ marginTop: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: "0.04em" }}>
                  Daily breakdown
                </div>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr style={{ background: "#f1f5f9" }}>
                      <th style={th}>Date</th>
                      <th style={th}>Doctor</th>
                      <th style={{ ...th, textAlign: "right" }}>Assigned</th>
                      <th style={{ ...th, textAlign: "right" }}>Generated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyRows.length === 0 && (
                      <tr><td colSpan={4} style={{ textAlign: "center", padding: 20, color: "#94a3b8", fontSize: 13 }}>No activity in this range.</td></tr>
                    )}
                    {dailyRows.map((r, i) => (
                      <tr key={`${r.doctor_id}-${r.date}-${i}`} style={{ borderBottom: "1px solid #e2e8f0" }}>
                        <td style={td}>{r.date}</td>
                        <td style={td}>{r.name}</td>
                        <td style={{ ...td, textAlign: "right" }}>{r.assigned}</td>
                        <td style={{ ...td, textAlign: "right" }}>{r.generated}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DoctorsList() {
  const [doctors, setDoctors]     = useState([]);
  const [loadingId, setLoadingId] = useState(null);
  const [error, setError]         = useState("");
  const [passwords, setPasswords] = useState({});
  const [copiedId, setCopiedId]   = useState(null);
  const [deleteId, setDeleteId]   = useState(null);
  const [statsOpen, setStatsOpen] = useState(false);

  useEffect(() => {
    fetch(`${BASE}/api/hms/users/doctors`)
      .then(r => r.json())
      .then(d => setDoctors(d.data || []))
      .catch(() => setError("Failed to load doctors."));
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

  const deleteDoctor = async (id) => {
    try {
      await fetch(`${BASE}/api/hms/users/${id}`, { method: "DELETE" });
      setDoctors(prev => prev.filter(d => d._id !== id));
    } catch {
      setError("Delete failed.");
    } finally {
      setDeleteId(null);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="panel-title">Auditing Doctors</div>
        <button
          onClick={() => setStatsOpen(true)}
          style={{
            display: "flex", alignItems: "center", gap: 6,
            background: "#fff", border: "1px solid #cbd5e1", borderRadius: 6,
            padding: "6px 12px", fontSize: 12, fontWeight: 500, color: "#334155",
            cursor: "pointer",
          }}
        >
          <ChartIcon /> View Stats
        </button>
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
            <th style={th}>Email</th>
            <th style={th}>New Password</th>
            <th style={th}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {doctors.length === 0 && (
            <tr>
              <td colSpan={5} style={{ textAlign: "center", padding: 20, color: "#94a3b8" }}>
                No doctors found.
              </td>
            </tr>
          )}
          {doctors.map((d) => (
            <tr key={d._id} style={{ borderBottom: "1px solid #e2e8f0" }}>
              <td style={td}>{d.full_name}</td>
              <td style={td}>{d.username}</td>
              <td style={td}>{d.email || "—"}</td>

              <td style={td}>
                {passwords[d._id] ? (
                  <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <code style={{ background: "#f1f5f9", padding: "3px 8px", borderRadius: 4, fontSize: 13 }}>
                      {passwords[d._id]}
                    </code>
                    <button onClick={() => copyPassword(d._id)} style={iconBtn(copiedId === d._id)}>
                      {copiedId === d._id ? <CheckIcon /> : <CopyIcon />}
                    </button>
                  </span>
                ) : (
                  <span style={{ color: "#cbd5e1", fontSize: 13 }}>—</span>
                )}
              </td>

              <td style={{ ...td, display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  onClick={() => resetPassword(d._id)}
                  disabled={loadingId === d._id}
                  style={actionBtn("#3b82f6", loadingId === d._id)}
                >
                  {loadingId === d._id ? "Resetting…" : "Reset Pwd"}
                </button>

                {deleteId === d._id ? (
                  <>
                    <button onClick={() => deleteDoctor(d._id)} style={actionBtn("#dc2626")}>Confirm</button>
                    <button onClick={() => setDeleteId(null)} style={actionBtn("#64748b")}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => setDeleteId(d._id)} style={actionBtn("#dc2626")}>Delete</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {statsOpen && <StatsModal onClose={() => setStatsOpen(false)} />}
    </div>
  );
}

const th = { textAlign: "left", padding: "10px 12px", fontSize: 13, fontWeight: 600, color: "#475569" };
const td = { padding: "10px 12px", fontSize: 14, color: "#1e293b" };

const actionBtn = (bg, disabled = false) => ({
  background: disabled ? "#94a3b8" : bg,
  color: "#fff", border: "none", borderRadius: 6,
  padding: "5px 12px", cursor: disabled ? "not-allowed" : "pointer",
  fontSize: 12, fontWeight: 500, whiteSpace: "nowrap",
});

const iconBtn = (active) => ({
  background: "none", border: "1px solid #cbd5e1", borderRadius: 5,
  padding: "3px 6px", cursor: "pointer",
  color: active ? "#16a34a" : "#64748b",
  display: "flex", alignItems: "center",
});