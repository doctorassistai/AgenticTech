import { useState } from "react";

// Change if your backend is on another host, e.g. "https://doctorassist.ai/api/hms/users/epic"
const API_BASE = "/api/hms/users/epic";
const SAMPLE_ID = "erXuFYUfucBZaryVksYEcMg3"; // Epic sandbox test patient (Camila Lopez)

const styles = {
  page: { maxWidth: 960, margin: "0 auto", padding: 24, fontFamily: "system-ui, sans-serif", color: "#1f2937" },
  row: { display: "flex", gap: 8, marginBottom: 16 },
  input: { flex: 1, padding: "10px 12px", fontSize: 15, border: "1px solid #cbd5e1", borderRadius: 8 },
  button: { padding: "10px 18px", fontSize: 15, border: "none", borderRadius: 8, background: "#2563eb", color: "#fff", cursor: "pointer" },
  ghost: { padding: "6px 12px", fontSize: 13, border: "1px solid #cbd5e1", borderRadius: 8, background: "#fff", color: "#1f2937", cursor: "pointer" },
  card: { border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 16, background: "#fff" },
  h2: { fontSize: 16, margin: "0 0 10px", color: "#0f172a" },
  table: { width: "100%", borderCollapse: "collapse", fontSize: 14 },
  th: { textAlign: "left", padding: "6px 8px", borderBottom: "1px solid #e2e8f0", color: "#475569", fontWeight: 600 },
  td: { padding: "6px 8px", borderBottom: "1px solid #f1f5f9", verticalAlign: "top" },
  error: { background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", padding: 12, borderRadius: 8, marginBottom: 16 },
  muted: { color: "#64748b", fontSize: 14 },
};

const fmtReading = (r) =>
  !r ? "-" : r.systolic != null ? `${r.systolic}/${r.diastolic} ${r.unit || ""}` : `${r.value ?? "-"} ${r.unit || ""}`;

function Section({ title, count, children }) {
  return (
    <div style={styles.card}>
      <h2 style={styles.h2}>{title}{count != null ? ` (${count})` : ""}</h2>
      {children}
    </div>
  );
}

function Table({ columns, rows }) {
  if (!rows || rows.length === 0) return <div style={styles.muted}>No data</div>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={styles.table}>
        <thead>
          <tr>{columns.map(([h]) => <th key={h} style={styles.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map(([h, get]) => <td key={h} style={styles.td}>{get(row) ?? "-"}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const obsRows = (obj) =>
  Object.entries(obj || {}).map(([name, v]) => ({ name, latest: v.latest, previous: v.previous?.length || 0 }));

const obsColumns = [
  ["Name", (r) => r.name],
  ["Latest", (r) => fmtReading(r.latest)],
  ["Date", (r) => r.latest?.date],
  ["Earlier readings", (r) => r.previous],
];

export default function EpicPatientLookup() {
  const [fhirId, setFhirId] = useState(SAMPLE_ID);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [showRaw, setShowRaw] = useState(false);

  async function load() {
    const id = fhirId.trim();
    if (!id) {
      setError("Enter a FHIR patient ID first.");
      return;
    }
    setLoading(true);
    setError("");
    setData(null);
    try {
      const res = await fetch(`${API_BASE}/test/fhir/${encodeURIComponent(id)}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.detail || `Request failed (${res.status})`);
      setData(body);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const p = data?.patient;

  return (
    <div style={styles.page}>
      <h1 style={{ fontSize: 22, marginBottom: 16 }}>Epic patient lookup</h1>

      <div style={styles.row}>
        <input
          style={styles.input}
          value={fhirId}
          onChange={(e) => setFhirId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !loading && load()}
          placeholder="Epic FHIR patient ID"
        />
        <button style={{ ...styles.button, opacity: loading ? 0.6 : 1 }} onClick={load} disabled={loading}>
          {loading ? "Loading..." : "Get data"}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      {data && (
        <>
          <Section title="Patient">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 8, fontSize: 14 }}>
              <div><b>Name:</b> {p?.name || "-"}</div>
              <div><b>Gender:</b> {p?.gender || "-"}</div>
              <div><b>Birth date:</b> {p?.birth_date || "-"}</div>
              <div><b>Age:</b> {p?.age ?? "-"}</div>
              <div><b>Phone:</b> {p?.phone || "-"}</div>
              <div><b>MRN:</b> {p?.mrn || "-"}</div>
              <div style={{ gridColumn: "1 / -1" }}><b>Address:</b> {p?.address || "-"}</div>
            </div>
          </Section>

          <Section title="Conditions" count={data.conditions?.length || 0}>
            <Table columns={[["Condition", (r) => r.name], ["Status", (r) => r.status], ["Onset", (r) => r.onset]]} rows={data.conditions} />
          </Section>

          <Section title="Medications" count={data.medications?.length || 0}>
            <Table columns={[["Medication", (r) => r.name], ["Status", (r) => r.status], ["Prescribed", (r) => r.prescribed_on]]} rows={data.medications} />
          </Section>

          <Section title="Allergies" count={data.allergies?.length || 0}>
            <Table columns={[["Substance", (r) => r.substance], ["Status", (r) => r.status], ["Criticality", (r) => r.criticality]]} rows={data.allergies} />
          </Section>

          <Section title="Vitals" count={Object.keys(data.vitals || {}).length}>
            <Table columns={obsColumns} rows={obsRows(data.vitals)} />
          </Section>

          <Section title="Labs" count={Object.keys(data.labs || {}).length}>
            <Table columns={obsColumns} rows={obsRows(data.labs)} />
          </Section>

          <Section title="Immunizations" count={data.immunizations?.length || 0}>
            <Table columns={[["Vaccine", (r) => r.vaccine], ["Date", (r) => r.date], ["Status", (r) => r.status]]} rows={data.immunizations} />
          </Section>

          <Section title="Procedures" count={data.procedures?.length || 0}>
            <Table columns={[["Procedure", (r) => r.name], ["Date", (r) => r.date], ["Status", (r) => r.status], ["Reason", (r) => r.reason]]} rows={data.procedures} />
          </Section>

          <Section title="Encounters" count={data.encounters?.length || 0}>
            <Table columns={[["Type", (r) => r.type], ["Class", (r) => r.class], ["Start", (r) => r.start], ["End", (r) => r.end], ["Reason", (r) => r.reason]]} rows={data.encounters} />
          </Section>

          <Section title="Diagnostic reports" count={data.diagnostic_reports?.length || 0}>
            <Table columns={[["Report", (r) => r.name], ["Date", (r) => r.date], ["Status", (r) => r.status], ["Results", (r) => r.result_count]]} rows={data.diagnostic_reports} />
          </Section>

          <Section title="Care plans" count={data.care_plans?.length || 0}>
            <Table columns={[["Plan", (r) => r.name], ["Status", (r) => r.status], ["Start", (r) => r.start], ["Activities", (r) => (r.activities || []).join(", ")]]} rows={data.care_plans} />
          </Section>

          {data.errors && Object.keys(data.errors).length > 0 && (
            <Section title="Categories Epic did not return">
              <Table
                columns={[["Category", (r) => r.name], ["HTTP status", (r) => r.status ?? "network"]]}
                rows={Object.entries(data.errors).map(([name, e]) => ({ name, status: e.status }))}
              />
            </Section>
          )}

          <button style={styles.ghost} onClick={() => setShowRaw((s) => !s)}>
            {showRaw ? "Hide raw JSON" : "Show raw JSON"}
          </button>
          {showRaw && (
            <pre style={{ background: "#0f172a", color: "#e2e8f0", padding: 16, borderRadius: 8, overflow: "auto", fontSize: 12, marginTop: 12 }}>
              {JSON.stringify(data, null, 2)}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
