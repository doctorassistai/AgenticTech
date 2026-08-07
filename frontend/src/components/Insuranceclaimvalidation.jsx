import React, { useState, useEffect, useCallback } from "react";

import {
  Download, Edit3, X, Check, AlertCircle, RefreshCw,
  FileText, ChevronDown, ChevronUp, Stethoscope, ClipboardList,
  FlaskConical, Scissors, ShieldCheck, PlayCircle, CheckCircle2,
} from "lucide-react";

import { THEMES } from "../dashboard/themes";

const API_BASE_URL = "https://doctorassist.ai/api/";

// Backend contract (see insurance_claim_validation.py):
//   POST  {API_BASE_URL}internal/run-claim-validation   { patient_id, doctor_id }
//     -> returns { patient_id, doctor_id, visit_date_evaluated, claim: {...}, ... }
//
//   POST  {API_BASE_URL}internal/finalize-claim-validation   { patient_id, doctor_id,
//        visit_date_evaluated, claim: {...}, doctor_reviewed: true,
//        finalized: true, finalized_at }
const RUN_VALIDATION_ENDPOINT = `${API_BASE_URL}hms/users/ai-legacy/internal/run-claim-validation`;
const FINAL_SAVE_ENDPOINT = `${API_BASE_URL}hms/users/data/context/finalize-claim-validation`;

/* ─── THEME TOKENS ─── */
const themeName = localStorage.getItem("theme") || "BlackWhite";
const theme = THEMES[themeName] || THEMES.BlackWhite;

const T = {
  bg: theme.bg,
  bgAlt: theme.bgAlt,
  bgTert: theme.bgTert,
  text: theme.text,
  sec: theme.sec,
  textSec: theme.textSec,
  textMuted: theme.textMuted,
  border: theme.border,
  borderStr: theme.borderStr,
  accent: theme.accent,
};

/* ─── STYLES ─── */
const S = {
  page: {
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    color: T.text,
    background: T.bg,
    maxWidth: 1200,
    margin: "0 auto",
    padding: "1.5rem",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    flexWrap: "wrap",
    gap: "1rem",
    marginBottom: "1.5rem",
    paddingBottom: "1.25rem",
    borderBottom: `1px solid ${T.border}`,
  },
  eyebrow: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    color: T.textMuted,
    display: "block",
    marginBottom: "0.25rem",
  },
  title: {
    fontSize: "1.35rem",
    fontWeight: 300,
    letterSpacing: "-0.02em",
    color: T.text,
    margin: 0,
  },
  metaLine: {
    fontSize: "0.72rem",
    color: T.textMuted,
    marginTop: "0.35rem",
  },
  actions: {
    display: "flex",
    gap: "0.5rem",
    flexWrap: "wrap",
  },
  btn: {
    padding: "0.5rem 0.9rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.text,
    fontSize: "0.72rem",
    fontWeight: 400,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    transition: "all 0.15s",
  },
  btnPrimary: {
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
  },
  btnFinal: {
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    fontWeight: 600,
  },
  btnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },
  card: {
    border: `1px solid ${T.border}`,
    marginBottom: "1.25rem",
    background: T.bg,
    borderRadius: "4px",
    overflow: "hidden",
  },
  cardHeader: {
    padding: "0.85rem 1.25rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
  },
  cardHeaderTitle: {
    fontSize: "0.72rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.text,
    display: "flex",
    alignItems: "center",
    gap: "8px",
    margin: 0,
  },
  cardBody: {
    padding: "1.1rem 1.25rem",
  },
  fieldRow: {
    display: "grid",
    gridTemplateColumns: "180px 1fr",
    gap: "0.5rem 1rem",
    padding: "0.55rem 0",
    borderBottom: `1px solid ${T.border}`,
    alignItems: "start",
  },
  fieldLabel: {
    fontSize: "0.62rem",
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    color: T.textMuted,
    paddingTop: "0.35rem",
  },
  fieldValue: {
    fontSize: "0.82rem",
    color: T.textSec,
    lineHeight: 1.55,
  },
  input: {
    width: "100%",
    padding: "0.45rem 0.6rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.text,
    fontSize: "0.8rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    outline: "none",
    borderRadius: "2px",
  },
  textarea: {
    width: "100%",
    padding: "0.5rem 0.6rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.text,
    fontSize: "0.8rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    outline: "none",
    resize: "vertical",
    lineHeight: 1.5,
    borderRadius: "2px",
  },
  select: {
    width: "100%",
    padding: "0.45rem 0.6rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.text,
    fontSize: "0.8rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    outline: "none",
    cursor: "pointer",
    borderRadius: "2px",
  },
  badge: {
    padding: "0.2rem 0.55rem",
    fontSize: "0.62rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    border: `1px solid ${T.border}`,
    display: "inline-block",
    whiteSpace: "nowrap",
    borderRadius: "2px",
  },
  /* ─── TABLE STYLES ─── */
  tableWrap: {
    overflowX: "auto",
    marginTop: "0.5rem",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: "0.78rem",
  },
  th: {
    textAlign: "left",
    padding: "0.6rem 0.8rem",
    borderBottom: `2px solid ${T.border}`,
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: T.textMuted,
    fontWeight: 400,
    background: T.bgAlt,
  },
  td: {
    padding: "0.6rem 0.8rem",
    borderBottom: `1px solid ${T.border}`,
    color: T.textSec,
    verticalAlign: "middle",
    lineHeight: 1.4,
  },
  statusBadge: {
    padding: "0.15rem 0.5rem",
    fontSize: "0.58rem",
    fontWeight: 400,
    textTransform: "uppercase",
    letterSpacing: "0.06em",
    borderRadius: "2px",
    display: "inline-block",
    border: `1px solid ${T.border}`,
  },
  statusApproved: {
    borderColor: "#2e7d32",
    color: "#2e7d32",
  },
  statusRejected: {
    borderColor: "#c62828",
    color: "#c62828",
  },
  statusPending: {
    borderColor: "#e65100",
    color: "#e65100",
  },
  claimRemarksBillable: {
    borderColor: "#2e7d32",
    color: "#2e7d32",
  },
  claimRemarksNonBillable: {
    borderColor: T.border,
    color: T.textMuted,
  },
  itemCard: {
    border: `1px solid ${T.border}`,
    marginBottom: "0.75rem",
    borderRadius: "3px",
  },
  itemHeader: {
    padding: "0.65rem 1rem",
    background: T.bgAlt,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: "0.75rem",
    cursor: "pointer",
  },
  itemName: {
    fontSize: "0.8rem",
    fontWeight: 400,
    color: T.text,
  },
  itemBody: {
    padding: "0.9rem 1rem",
  },
  toggleWrap: {
    display: "flex",
    gap: "0.4rem",
  },
  toggleBtn: {
    padding: "0.3rem 0.7rem",
    fontSize: "0.68rem",
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.textMuted,
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    borderRadius: "2px",
  },
  toggleBtnActive: {
    background: T.text,
    color: T.bg,
    borderColor: T.text,
  },
  listBlock: {
    fontSize: "0.8rem",
    color: T.textSec,
    lineHeight: 1.7,
  },
  emptyState: {
    padding: "2rem",
    textAlign: "center",
    color: T.textMuted,
    fontSize: "0.8rem",
  },
  centerState: {
    padding: "3rem 1rem",
    textAlign: "center",
    color: T.textMuted,
    fontSize: "0.82rem",
  },
  finalizedBanner: {
    display: "flex",
    alignItems: "center",
    gap: "8px",
    padding: "0.65rem 1rem",
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    fontSize: "0.75rem",
    color: T.textSec,
    marginBottom: "1.25rem",
    borderRadius: "3px",
  },
};

const CLAIM_STATUS_OPTIONS = [
  "Approved", "Partially Approved", "Requires Additional Information", "Not Supported",
];
const STATUS_OPTIONS = ["Approved", "Rejected", "Pending Documentation"];
const BILLABLE_STATUS_OPTIONS = ["Billable", "Non-Billable", "Requires Additional Documentation"];

/* ─── HELPERS ─── */
function claimStatusBadgeStyle(status) {
  const map = {
    "Approved": { borderColor: "#2e7d32", color: "#2e7d32" },
    "Partially Approved": { borderColor: "#e65100", color: "#e65100" },
    "Requires Additional Information": { borderColor: T.border, color: T.textMuted },
    "Not Supported": { borderColor: "#c62828", color: "#c62828" },
  };
  return { ...S.badge, ...(map[status] || map["Requires Additional Information"]) };
}

function statusBadgeStyle(status) {
  const map = {
    "Approved": S.statusApproved,
    "Rejected": S.statusRejected,
    "Pending Documentation": S.statusPending,
  };
  return { ...S.statusBadge, ...(map[status] || S.statusPending) };
}

function boolBadgeStyle(flag) {
  return { ...S.badge, borderColor: flag ? "#2e7d32" : T.border, color: flag ? "#2e7d32" : T.textMuted };
}

function listToText(list) {
  return Array.isArray(list) ? list.filter(Boolean).join("\n") : "";
}
function textToList(text) {
  return (text || "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

function getStatusColor(status) {
  const map = {
    "Approved": "#2e7d32",
    "Rejected": "#c62828",
    "Pending Documentation": "#e65100",
  };
  return map[status] || T.textMuted;
}

/* ─── TOAST ─── */
function Toast({ message, type, onClose }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [message]);

  if (!message) return null;
  const isErr = type === "error";
  return (
    <div style={{
      position: "fixed", bottom: 24, right: 24, zIndex: 1000,
      display: "flex", alignItems: "center", gap: "10px",
      background: T.bg, border: `1px solid ${T.borderStr}`,
      borderLeft: `2px solid ${T.borderStr}`,
      padding: "0.75rem 1rem",
      fontSize: "0.78rem", fontWeight: 300, color: T.text,
      boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
      maxWidth: 360,
      fontFamily: "'Open Sans', sans-serif",
      borderRadius: "3px",
    }}>
      {isErr ? <AlertCircle size={13} color={T.textMuted} /> : <Check size={13} color={T.text} />}
      <span style={{ flex: 1 }}>{message}</span>
      <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: T.textMuted, padding: "2px", display: "flex" }}>
        <X size={12} />
      </button>
    </div>
  );
}

/* ─── SMALL EDIT PRIMITIVES ─── */
function Field({ label, editing, children, value }) {
  return (
    <div style={S.fieldRow}>
      <span style={S.fieldLabel}>{label}</span>
      {editing ? <div>{children}</div> : <div style={S.fieldValue}>{value || "—"}</div>}
    </div>
  );
}

function BoolToggle({ value, onChange }) {
  return (
    <div style={S.toggleWrap}>
      <button
        type="button"
        style={{ ...S.toggleBtn, ...(value ? S.toggleBtnActive : {}) }}
        onClick={() => onChange(true)}
      >Yes</button>
      <button
        type="button"
        style={{ ...S.toggleBtn, ...(!value ? S.toggleBtnActive : {}) }}
        onClick={() => onChange(false)}
      >No</button>
    </div>
  );
}

/* ─── INVESTIGATION TABLE ROW ─── */
function InvestigationTableRow({ item, idx, editing, onUpdate }) {
  const set = (key, val) => onUpdate({ ...item, [key]: val });

  return (
    <tr>
      <td style={S.td}>
        {editing ? (
          <input style={S.input} value={item.test_name || ""} onChange={(e) => set("test_name", e.target.value)} />
        ) : (
          <span style={{ fontWeight: 400 }}>{item.test_name || "—"}</span>
        )}
      </td>
      <td style={S.td}>
        {editing ? (
          <select style={S.select} value={item.claim_remarks || ""} onChange={(e) => set("claim_remarks", e.target.value)}>
            <option value="Billable Test under Insurance">Billable Test under Insurance</option>
            <option value="Non Billable Test Insurance">Non Billable Test Insurance</option>
          </select>
        ) : (
          <span style={{
            ...S.statusBadge,
            ...(item.claim_remarks === "Billable Test under Insurance" ? S.claimRemarksBillable : S.claimRemarksNonBillable)
          }}>
            {item.claim_remarks || "—"}
          </span>
        )}
      </td>
      <td style={S.td}>
        {editing ? (
          <textarea style={{ ...S.textarea, minHeight: 40, fontSize: "0.7rem" }} value={item.system_remarks || ""} onChange={(e) => set("system_remarks", e.target.value)} />
        ) : (
          <span style={{ fontSize: "0.72rem" }}>{item.system_remarks || "—"}</span>
        )}
      </td>
      <td style={S.td}>
        {editing ? (
          <select style={S.select} value={item.status || ""} onChange={(e) => set("status", e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <span style={statusBadgeStyle(item.status)}>{item.status || "—"}</span>
        )}
      </td>
      <td style={S.td}>
        {editing ? (
          <input style={S.input} value={item.reason_for_rejection || ""} onChange={(e) => set("reason_for_rejection", e.target.value)} />
        ) : (
          <span style={{ fontSize: "0.72rem", color: item.reason_for_rejection ? "#c62828" : T.textMuted }}>
            {item.reason_for_rejection || "—"}
          </span>
        )}
      </td>
    </tr>
  );
}

/* ─── PROCEDURE TABLE ROW ─── */
function ProcedureTableRow({ item, idx, editing, onUpdate }) {
  const set = (key, val) => onUpdate({ ...item, [key]: val });

  return (
    <tr>
      <td style={S.td}>
        {editing ? (
          <input style={S.input} value={item.procedure_name || ""} onChange={(e) => set("procedure_name", e.target.value)} />
        ) : (
          <span style={{ fontWeight: 400 }}>{item.procedure_name || "—"}</span>
        )}
      </td>
      <td style={S.td}>
        {editing ? (
          <select style={S.select} value={item.claim_remarks || ""} onChange={(e) => set("claim_remarks", e.target.value)}>
            <option value="Billable Test under Insurance">Billable Test under Insurance</option>
            <option value="Non Billable Test Insurance">Non Billable Test Insurance</option>
          </select>
        ) : (
          <span style={{
            ...S.statusBadge,
            ...(item.claim_remarks === "Billable Test under Insurance" ? S.claimRemarksBillable : S.claimRemarksNonBillable)
          }}>
            {item.claim_remarks || "—"}
          </span>
        )}
      </td>
      <td style={S.td}>
        {editing ? (
          <textarea style={{ ...S.textarea, minHeight: 40, fontSize: "0.7rem" }} value={item.system_remarks || ""} onChange={(e) => set("system_remarks", e.target.value)} />
        ) : (
          <span style={{ fontSize: "0.72rem" }}>{item.system_remarks || "—"}</span>
        )}
      </td>
      <td style={S.td}>
        {editing ? (
          <select style={S.select} value={item.status || ""} onChange={(e) => set("status", e.target.value)}>
            {STATUS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        ) : (
          <span style={statusBadgeStyle(item.status)}>{item.status || "—"}</span>
        )}
      </td>
      <td style={S.td}>
        {editing ? (
          <input style={S.input} value={item.reason_for_rejection || ""} onChange={(e) => set("reason_for_rejection", e.target.value)} />
        ) : (
          <span style={{ fontSize: "0.72rem", color: item.reason_for_rejection ? "#c62828" : T.textMuted }}>
            {item.reason_for_rejection || "—"}
          </span>
        )}
      </td>
    </tr>
  );
}

/* ─── MAIN COMPONENT ─── */
export default function InsuranceClaimValidation({ doctorId: doctorIdProp, patientId: patientIdProp }) {

  const query = new URLSearchParams(window.location.search);
  const doctorId = doctorIdProp || query.get("doctor_id");
  const patientId = patientIdProp || query.get("patient_id");

  const [loading, setLoading] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [editing, setEditing] = useState(false);
  const [finalized, setFinalized] = useState(false);
  const [response, setResponse] = useState(null);
  const [claim, setClaim] = useState(null);
  const [toast, setToast] = useState({ message: "", type: "" });

  const runValidation = useCallback(async () => {
    if (!doctorId || !patientId) {
      setToast({ message: "Doctor ID and Patient ID are required.", type: "error" });
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(RUN_VALIDATION_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed to run claim validation.");
      setResponse(data);
      setClaim(data.claim);
      setEditing(false);
      setFinalized(false);
      setToast({ message: "Claim validation complete.", type: "success" });
    } catch (err) {
      setToast({ message: err.message || "Failed to run claim validation.", type: "error" });
    } finally {
      setLoading(false);
    }
  }, [doctorId, patientId]);

  const updateClaimField = (key, value) => setClaim((prev) => ({ ...prev, [key]: value }));

  const updateInvestigation = (idx, updated) => {
    setClaim((prev) => {
      const next = [...(prev.investigations || [])];
      next[idx] = updated;
      return { ...prev, investigations: next };
    });
  };

  const updateProcedure = (idx, updated) => {
    setClaim((prev) => {
      const next = [...(prev.procedures || [])];
      next[idx] = updated;
      return { ...prev, procedures: next };
    });
  };

  const handleFinalSave = async () => {
    if (!claim) return;
    setFinalizing(true);
    try {
      const payload = {
        patient_id: patientId,
        doctor_id: doctorId,
        visit_date_evaluated: response?.visit_date_evaluated,
        claim,
        doctor_reviewed: true,
        finalized: true,
        finalized_at: new Date().toISOString(),
      };
      const res = await fetch(FINAL_SAVE_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Failed to save the claim.");
      setResponse((prev) => ({ ...prev, claim }));
      setEditing(false);
      setFinalized(true);
      setToast({ message: "Claim saved.", type: "success" });
    } catch (err) {
      setToast({ message: err.message || "Failed to save the claim.", type: "error" });
    } finally {
      setFinalizing(false);
    }
  };

  const handleDownloadPdf = () => {
    window.print();
  };

  const cancelEdit = () => {
    setClaim(response?.claim || null);
    setEditing(false);
  };

  if (!doctorId || !patientId) {
    return (
      <div style={S.page}>
        <div style={S.centerState}>Missing doctor_id / patient_id in the URL.</div>
      </div>
    );
  }

  return (
    <div style={S.page} id="claim-validation-print-root">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        .icv-btn:hover { background: ${T.bgAlt} !important; }
        .icv-btn-primary:hover { opacity: 0.85; }
        @media print {
          body * { visibility: hidden; }
          #claim-validation-print-root, #claim-validation-print-root * { visibility: visible; }
          #claim-validation-print-root { position: absolute; left: 0; top: 0; width: 100%; padding: 0; }
          .icv-no-print { display: none !important; }
        }
      `}</style>

      <div style={S.headerRow}>
        <div>
          <span style={S.eyebrow}>Insurance Claim Validation</span>
          <h1 style={S.title}>
            {claim?.primary_diagnosis?.diagnosis || "Claim Review"}
          </h1>
          <div style={S.metaLine}>
            Patient {patientId} · Visit {response?.visit_date_evaluated || "—"}
            {claim?.claim_status && (
              <> · <span style={claimStatusBadgeStyle(claim.claim_status)}>{claim.claim_status}</span></>
            )}
          </div>
        </div>

        <div style={{ ...S.actions }} className="icv-no-print">
          <button
            className="icv-btn"
            style={{ ...S.btn, ...(loading ? S.btnDisabled : {}) }}
            onClick={runValidation}
            disabled={loading}
          >
            {claim ? <RefreshCw size={13} /> : <PlayCircle size={13} />}
            {loading ? "Validating…" : claim ? "Re-run Validation" : "Generate Validation"}
          </button>

          {claim && !editing && (
            <button className="icv-btn" style={S.btn} onClick={() => setEditing(true)}>
              <Edit3 size={13} /> Edit
            </button>
          )}

          {claim && editing && (
            <button className="icv-btn" style={S.btn} onClick={cancelEdit}>
              <X size={13} /> Cancel
            </button>
          )}

          {claim && (
            <button className="icv-btn" style={S.btn} onClick={handleDownloadPdf}>
              <Download size={13} /> Download PDF
            </button>
          )}

          {claim && (
            <button
              className="icv-btn icv-btn-primary"
              style={{ ...S.btn, ...S.btnFinal, ...(finalizing ? S.btnDisabled : {}) }}
              onClick={handleFinalSave}
              disabled={finalizing}
            >
              <CheckCircle2 size={13} /> {finalizing ? "Saving…" : "Final Save"}
            </button>
          )}
        </div>
      </div>

      {finalized && (
        <div style={S.finalizedBanner}>
          <CheckCircle2 size={13} color={T.text} />
          This claim has been saved.
        </div>
      )}

      {loading && !claim && (
        <div style={S.centerState}>Running claim validation…</div>
      )}

      {!loading && !claim && (
        <div style={S.centerState}>No validated claim yet. Click "Generate Validation" to run it.</div>
      )}

      {claim && (
        <>
          {/* ── PATIENT SUMMARY ── */}
          <div style={S.card}>
            <div style={S.cardHeader}>
              <p style={S.cardHeaderTitle}><Stethoscope size={13} /> Patient Summary</p>
            </div>
            <div style={S.cardBody}>
              <Field label="Primary Complaint" editing={editing} value={claim.patient_summary?.primary_complaint}>
                <input style={S.input} value={claim.patient_summary?.primary_complaint || ""} onChange={(e) => updateClaimField("patient_summary", { ...claim.patient_summary, primary_complaint: e.target.value })} />
              </Field>
              <Field label="Duration of Symptoms" editing={editing} value={claim.patient_summary?.duration_of_symptoms}>
                <input style={S.input} value={claim.patient_summary?.duration_of_symptoms || ""} onChange={(e) => updateClaimField("patient_summary", { ...claim.patient_summary, duration_of_symptoms: e.target.value })} />
              </Field>
              <Field label="Past Medical History" editing={editing} value={claim.patient_summary?.relevant_past_medical_history}>
                <input style={S.input} value={claim.patient_summary?.relevant_past_medical_history || ""} onChange={(e) => updateClaimField("patient_summary", { ...claim.patient_summary, relevant_past_medical_history: e.target.value })} />
              </Field>
              <Field label="Physician Assessment" editing={editing} value={claim.patient_summary?.physician_assessment}>
                <input style={S.input} value={claim.patient_summary?.physician_assessment || ""} onChange={(e) => updateClaimField("patient_summary", { ...claim.patient_summary, physician_assessment: e.target.value })} />
              </Field>
              <Field label="Clinical Justification" editing={editing} value={claim.patient_summary?.clinical_justification}>
                <input style={S.input} value={claim.patient_summary?.clinical_justification || ""} onChange={(e) => updateClaimField("patient_summary", { ...claim.patient_summary, clinical_justification: e.target.value })} />
              </Field>
            </div>
          </div>

          {/* ── PRIMARY DIAGNOSIS ── */}
          <div style={S.card}>
            <div style={S.cardHeader}>
              <p style={S.cardHeaderTitle}><ClipboardList size={13} /> Primary Diagnosis</p>
              <span style={boolBadgeStyle(claim.primary_diagnosis?.diagnosis_supported)}>
                {claim.primary_diagnosis?.diagnosis_supported ? "Supported" : "Not Supported"}
              </span>
            </div>
            <div style={S.cardBody}>
              <Field label="Diagnosis" editing={editing} value={claim.primary_diagnosis?.diagnosis}>
                <input style={S.input} value={claim.primary_diagnosis?.diagnosis || ""} onChange={(e) => updateClaimField("primary_diagnosis", { ...claim.primary_diagnosis, diagnosis: e.target.value })} />
              </Field>
              <Field label="ICD-10 Code" editing={editing} value={claim.primary_diagnosis?.icd10_code}>
                <input style={S.input} value={claim.primary_diagnosis?.icd10_code || ""} onChange={(e) => updateClaimField("primary_diagnosis", { ...claim.primary_diagnosis, icd10_code: e.target.value })} />
              </Field>
              <Field label="Confidence" editing={editing} value={claim.primary_diagnosis?.diagnosis_confidence}>
                <select style={S.select} value={claim.primary_diagnosis?.diagnosis_confidence || ""} onChange={(e) => updateClaimField("primary_diagnosis", { ...claim.primary_diagnosis, diagnosis_confidence: e.target.value })}>
                  <option value="">—</option>
                  <option value="High">High</option>
                  <option value="Moderate">Moderate</option>
                  <option value="Low">Low</option>
                </select>
              </Field>
              <Field label="Diagnosis Support" editing={editing} value={claim.primary_diagnosis?.diagnosis_support}>
                <textarea style={{ ...S.textarea, minHeight: 80 }} value={claim.primary_diagnosis?.diagnosis_support || ""} onChange={(e) => updateClaimField("primary_diagnosis", { ...claim.primary_diagnosis, diagnosis_support: e.target.value })} />
              </Field>
            </div>
          </div>

          {/* ── SECONDARY DIAGNOSES ── */}
          {claim.secondary_diagnoses && claim.secondary_diagnoses.length > 0 && (
            <div style={S.card}>
              <div style={S.cardHeader}>
                <p style={S.cardHeaderTitle}>Secondary Diagnoses</p>
                <span style={S.metaLine}>{claim.secondary_diagnoses.length} item(s)</span>
              </div>
              <div style={S.cardBody}>
                {claim.secondary_diagnoses.map((diag, idx) => (
                  <div key={idx} style={{ ...S.fieldRow, borderBottom: idx < claim.secondary_diagnoses.length - 1 ? `1px solid ${T.border}` : "none" }}>
                    <span style={S.fieldLabel}>Diagnosis {idx + 1}</span>
                    <div style={S.fieldValue}>
                      <strong>{diag.diagnosis}</strong>
                      {diag.description && <span> — {diag.description}</span>}
                      {diag.icd10_code && <span style={{ ...S.badge, marginLeft: "8px", fontSize: "0.6rem" }}>{diag.icd10_code}</span>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── INVESTIGATIONS TABLE ── */}
          <div style={S.card}>
            <div style={S.cardHeader}>
              <p style={S.cardHeaderTitle}><FlaskConical size={13} /> Investigations</p>
              <span style={S.metaLine}>{(claim.investigations || []).length} item(s)</span>
            </div>
            <div style={S.cardBody}>
              {(claim.investigations || []).length === 0 ? (
                <div style={S.emptyState}>No investigations ordered in this visit.</div>
              ) : (
                <div style={S.tableWrap}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Test Name</th>
                        <th style={S.th}>Claim Remarks</th>
                        <th style={S.th}>System Remarks</th>
                        <th style={S.th}>Status</th>
                        <th style={S.th}>Reason for Rejection</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claim.investigations.map((item, idx) => (
                        <InvestigationTableRow
                          key={idx}
                          item={item}
                          idx={idx}
                          editing={editing}
                          onUpdate={(updated) => updateInvestigation(idx, updated)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── PROCEDURES TABLE ── */}
          <div style={S.card}>
            <div style={S.cardHeader}>
              <p style={S.cardHeaderTitle}><Scissors size={13} /> Procedures</p>
              <span style={S.metaLine}>{(claim.procedures || []).length} item(s)</span>
            </div>
            <div style={S.cardBody}>
              {(claim.procedures || []).length === 0 ? (
                <div style={S.emptyState}>No procedures documented in this visit.</div>
              ) : (
                <div style={S.tableWrap}>
                  <table style={S.table}>
                    <thead>
                      <tr>
                        <th style={S.th}>Procedure Name</th>
                        <th style={S.th}>Claim Remarks</th>
                        <th style={S.th}>System Remarks</th>
                        <th style={S.th}>Status</th>
                        <th style={S.th}>Reason for Rejection</th>
                      </tr>
                    </thead>
                    <tbody>
                      {claim.procedures.map((item, idx) => (
                        <ProcedureTableRow
                          key={idx}
                          item={item}
                          idx={idx}
                          editing={editing}
                          onUpdate={(updated) => updateProcedure(idx, updated)}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── RETURN NOTES FROM SYSTEM ── */}
          {claim.return_notes_from_system && claim.return_notes_from_system.length > 0 && (
            <div style={S.card}>
              <div style={S.cardHeader}>
                <p style={S.cardHeaderTitle}><FileText size={13} /> Return Notes From System</p>
                <span style={S.metaLine}>{claim.return_notes_from_system.length} note(s)</span>
              </div>
              <div style={S.cardBody}>
                {claim.return_notes_from_system.map((note, idx) => (
                  <div key={idx} style={{ 
                    ...S.fieldRow, 
                    borderBottom: idx < claim.return_notes_from_system.length - 1 ? `1px solid ${T.border}` : "none",
                    gridTemplateColumns: "1fr"
                  }}>
                    <div style={{ fontSize: "0.82rem", color: T.textSec, lineHeight: 1.6 }}>
                      {typeof note === 'string' ? note : (
                        <>
                          <strong>{note.issue || "Issue"}</strong>
                          {note.suggestion && <div style={{ marginTop: "0.3rem" }}>💡 {note.suggestion}</div>}
                          {note.recommended_evidence && <div style={{ marginTop: "0.2rem", fontSize: "0.72rem", color: T.textMuted }}>📋 {note.recommended_evidence}</div>}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── DECISION SUMMARY ── */}
          
        </>
      )}

      <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: "", type: "" })} />
    </div>
  );
}