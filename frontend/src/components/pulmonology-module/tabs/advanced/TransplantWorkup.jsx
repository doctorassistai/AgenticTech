import React, { useState, useMemo, useEffect } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";
import TxCloseTab from "../discharge/TransplantCloseUpdate";

// --- Shared Styles ---
const tableStyle = { width: "100%", borderCollapse: "collapse" };
const thStyle = {
  fontSize: "10.5px",
  fontWeight: 600,
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  textAlign: "left",
  padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0",
  backgroundColor: "#f5f5f5",
  color: "#000",
};
const tdStyle = {
  fontSize: "13px",
  padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0",
  verticalAlign: "top",
  color: "#000",
};
const inputStyle = {
  width: "100%",
  padding: "6px 8px",
  fontSize: "12px",
  border: "1px solid #ccc",
  boxSizing: "border-box",
  marginTop: "4px",
};
const labelStyle = {
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  color: "#888",
};

// --- Pure Helper Calculators, Patient Reconciliation & ISHLT Scoring ---
import {
  calcAge,
  calcBmi,
  calcBode,
  calcGap,
  reconcilePatientTransplantData,
  getTransplantRecommendation,
} from "./transplantHelpers.js";

export {
  calcAge,
  calcBmi,
  calcBode,
  calcGap,
  reconcilePatientTransplantData,
  getTransplantRecommendation,
};

// ─── Sub-tab 1: Progress Overview ───────────────────────────────────────────
const TxOverviewTab = () => {
  const { formData, updateField } = usePulmonology();
  const workupKeys = [
    "tx_wk_blood",
    "tx_wk_hla",
    "tx_wk_6mwt",
    "tx_wk_cardiac",
    "tx_wk_infection",
    "tx_wk_listed",
  ];
  const completedSteps = workupKeys.filter((k) => Boolean(formData[k])).length;

  return (
    <div>
      <Section title="Workup Status & Overall Disposition">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <FormField
            label="OVERALL EVALUATION STATUS"
            name="tx_overall_status"
            type="select"
            options={["Not started", "In progress — workup pending", "Complete — referred", "Listed on waitlist", "On hold / Contraindicated"]}
          />
          <FormField
            label="PROGRESS SUMMARY"
            name="tx_progress_summary"
            type="derived"
            derivedValue={`${completedSteps} of ${workupKeys.length} workup stages completed`}
          />
        </div>
      </Section>

      <Section title="Workup Checklist" note="Check each item as verified to update progress">
        <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "16px" }}>
          {[
            { id: "tx_wk_blood", label: "Blood group typing" },
            { id: "tx_wk_hla", label: "HLA typing done" },
            { id: "tx_wk_6mwt", label: "6MWT & CPET completed" },
            { id: "tx_wk_cardiac", label: "Cardiac evaluation cleared" },
            { id: "tx_wk_infection", label: "Infection screen complete" },
            { id: "tx_wk_listed", label: "Patient listed on waitlist" },
          ].map((item) => {
            const isChecked = Boolean(formData[item.id]);
            return (
              <label
                key={item.id}
                style={{
                  fontSize: "11px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  padding: "6px 10px",
                  border: "1px solid",
                  borderColor: isChecked ? "#81c784" : "#e0e0e0",
                  background: isChecked ? "#f0fdf4" : "#fff",
                  cursor: "pointer",
                  userSelect: "none",
                }}
              >
                <input
                  type="checkbox"
                  checked={isChecked}
                  onChange={(e) => updateField(item.id, e.target.checked)}
                  style={{ accentColor: "#2e7d32" }}
                />
                {item.label}
              </label>
            );
          })}
        </div>
      </Section>

      <Section title="Transplant Rationale & Summary">
        <FormField
          label="CLINICAL SUMMARY / TRANSPLANT RATIONALE"
          name="tx_summary"
          type="textarea"
          placeholder="Document diagnosis trajectory, disease acceleration, and specific factors prompting transplant evaluation..."
        />
      </Section>
    </div>
  );
};

// ─── Sub-tab 2: Eligibility Criteria ────────────────────────────────────────
const renderStatusBadge = (category, label) => {
  const styles = {
    listing: { background: "#fee2e2", color: "#b91c1c", border: "1px solid #fca5a5" },
    referral: { background: "#ffedd5", color: "#c2410c", border: "1px solid #fdba74" },
    normal: { background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" },
    pending: { background: "#f1f5f9", color: "#475569", border: "1px solid #cbd5e1" },
  };
  const current = styles[category] || styles.pending;
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 9px",
        borderRadius: "12px",
        fontSize: "11px",
        fontWeight: 600,
        ...current,
      }}
    >
      {label}
    </span>
  );
};

const EligibilityTab = () => {
  const { formData, updateField, updateFields, patientId } = usePulmonology();
  const [syncTick, setSyncTick] = useState(0);

  // Listen for background procedure completions or storage sync events
  useEffect(() => {
    const handleRefresh = () => setSyncTick((t) => t + 1);
    window.addEventListener("storage", handleRefresh);
    window.addEventListener("pulm_procedure_data_sync", handleRefresh);
    window.addEventListener("pulm_procedure_completed", handleRefresh);
    return () => {
      window.removeEventListener("storage", handleRefresh);
      window.removeEventListener("pulm_procedure_data_sync", handleRefresh);
      window.removeEventListener("pulm_procedure_completed", handleRefresh);
    };
  }, []);

  // Dynamically reconcile patient data from active patient ID, encounter state, procedure logs & localStorage
  const reconciled = useMemo(() => {
    return reconcilePatientTransplantData(formData, patientId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formData, patientId, syncTick]);

  // Auto-sync reconciled variables to context state so other transplant components have latest data
  useEffect(() => {
    if (reconciled.updatesToSync && Object.keys(reconciled.updatesToSync).length > 0) {
      if (typeof updateFields === "function") {
        updateFields(reconciled.updatesToSync);
      } else if (typeof updateField === "function") {
        Object.entries(reconciled.updatesToSync).forEach(([k, v]) => updateField(k, v));
      }
    }
  }, [reconciled.updatesToSync, updateFields, updateField]);

  // Dynamic 2021 ISHLT Recommendation based on reconciled multi-source data
  const recommendation = useMemo(() => {
    return getTransplantRecommendation({
      primaryDx: reconciled.primaryDx !== "Not specified" ? reconciled.primaryDx : "",
      scoreBode: reconciled.bode !== "Not calculated" ? reconciled.bode : "",
      scoreGap: reconciled.gap !== "Not calculated" ? reconciled.gap : "",
      sixMwtM: !isNaN(reconciled.sixMwtNum) ? reconciled.sixMwtNum : null,
      fev1Pct: !isNaN(reconciled.fev1Num) ? reconciled.fev1Num : null,
      pao2: !isNaN(reconciled.pao2Num) ? reconciled.pao2Num : null,
      paco2: !isNaN(reconciled.paco2Num) ? reconciled.paco2Num : null,
      dlcoPct: !isNaN(reconciled.dlcoNum) ? reconciled.dlcoNum : null,
    });
  }, [reconciled]);

  return (
    <div>
      {/* Auto-Calculated Suggestion Banner */}
      {recommendation ? (
        <div
          style={{
            border: `1px solid ${recommendation.border}`,
            backgroundColor: recommendation.bg,
            padding: "14px 18px",
            marginBottom: "18px",
            borderRadius: "2px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "4px" }}>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                backgroundColor: recommendation.color,
                color: "#ffffff",
                padding: "2px 8px",
                borderRadius: "2px",
              }}
            >
              {recommendation.badge}
            </span>
            <span style={{ fontSize: "13px", fontWeight: 600, color: recommendation.color }}>
              {recommendation.title}
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "12px", color: "#333333", lineHeight: "1.4" }}>
            {recommendation.message}
          </p>
        </div>
      ) : (
        <div
          style={{
            border: "1px solid #e0e0e0",
            backgroundColor: "#fbfbfb",
            padding: "12px 16px",
            marginBottom: "18px",
            fontSize: "12px",
            color: "#666666",
          }}
        >
          <b>ISHLT 2021 Decision Support:</b> When disease scores (BODE ≥ 5/7 for COPD, GAP Stage II/III for ILD, FEV1 &lt; 25%, PaO2 &lt; 55 mmHg, or 6MWT &lt; 250m) are recorded, guidance recommendations will appear here automatically.
        </div>
      )}

      <Section
        title="Shared Clinical Biomarkers (Pulmonology Context)"
        note="Auto-populated from Intake, Diagnostics, Completed Procedures & Patient Caches without duplicate entry"
      >
        {/* Patient Synchronization Status Bar */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "8px 12px",
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderBottom: "none",
            fontSize: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontWeight: 600, color: "#1e293b" }}>
              Active Patient:{" "}
              {reconciled.activePatientId ? (
                <code style={{ background: "#e2e8f0", padding: "2px 6px", borderRadius: "3px", fontWeight: 700 }}>
                  {reconciled.activePatientId}
                </code>
              ) : (
                <span style={{ color: "#64748b" }}>Current Encounter</span>
              )}
            </span>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
                color: "#059669",
                background: "#ecfdf5",
                border: "1px solid #a7f3d0",
                padding: "2px 8px",
                borderRadius: "10px",
                fontWeight: 600,
              }}
            >
              ● Live Multi-Source Synchronized
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSyncTick((t) => t + 1)}
            style={{
              background: "#fff",
              border: "1px solid #cbd5e1",
              borderRadius: "4px",
              padding: "3px 8px",
              fontSize: "11px",
              cursor: "pointer",
              color: "#334155",
            }}
          >
            ↻ Refresh Latest Values
          </button>
        </div>

        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Biomarker / Score</th>
              <th style={thStyle}>Transplant Cutoff (ISHLT)</th>
              <th style={thStyle}>Current Patient Value</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {/* 1. Primary Diagnosis */}
            <tr>
              <td style={tdStyle}><b>Primary Diagnosis</b></td>
              <td style={tdStyle}>COPD, ILD, Bronchiectasis, IPAH</td>
              <td style={tdStyle}><b>{reconciled.primaryDx}</b></td>
              <td style={tdStyle}>
                {reconciled.primaryDx !== "Not specified"
                  ? renderStatusBadge("normal", "✓ Indication Profiled")
                  : renderStatusBadge("pending", "Pending Intake")}
              </td>
            </tr>

            {/* 2. BODE Index (COPD) */}
            <tr>
              <td style={tdStyle}><b>BODE Index (COPD)</b></td>
              <td style={tdStyle}>≥5 (referral); ≥7 (listing)</td>
              <td style={tdStyle}><b>{reconciled.bode}</b></td>
              <td style={tdStyle}>
                {(() => {
                  if (reconciled.bode === "Not calculated") {
                    return renderStatusBadge("pending", "Pending Calc");
                  }
                  const pts = parseInt(reconciled.bode, 10);
                  if (pts >= 7) return renderStatusBadge("listing", "🚨 Listing Zone (≥7)");
                  if (pts >= 5) return renderStatusBadge("referral", "⚠️ Referral Zone (5–6)");
                  return renderStatusBadge("normal", "✓ Compensated (0–4)");
                })()}
              </td>
            </tr>

            {/* 3. GAP Stage (ILD) */}
            <tr>
              <td style={tdStyle}><b>GAP Stage (ILD)</b></td>
              <td style={tdStyle}>Stage II (referral); Stage III (listing)</td>
              <td style={tdStyle}><b>{reconciled.gap}</b></td>
              <td style={tdStyle}>
                {(() => {
                  if (reconciled.gap === "Not calculated") {
                    return renderStatusBadge("pending", "Pending Calc");
                  }
                  if (reconciled.gap.includes("Stage III")) return renderStatusBadge("listing", "🚨 Listing Zone (Stage III)");
                  if (reconciled.gap.includes("Stage II")) return renderStatusBadge("referral", "⚠️ Referral Zone (Stage II)");
                  return renderStatusBadge("normal", "✓ Low Risk (Stage I)");
                })()}
              </td>
            </tr>

            {/* 4. FEV1 (% predicted) */}
            <tr>
              <td style={tdStyle}><b>FEV1 (% predicted)</b></td>
              <td style={tdStyle}>&lt;25% predicted or rapid decline</td>
              <td style={tdStyle}><b>{reconciled.fev1}</b></td>
              <td style={tdStyle}>
                {(() => {
                  if (isNaN(reconciled.fev1Num)) {
                    return renderStatusBadge("pending", "Pending PFT");
                  }
                  if (reconciled.fev1Num < 25) return renderStatusBadge("listing", `🚨 Severe Obstruction (<25%) — Listing Zone`);
                  if (reconciled.fev1Num <= 35) return renderStatusBadge("referral", `⚠️ Referral Zone (25–35%)`);
                  return renderStatusBadge("normal", `✓ Monitored (${reconciled.fev1Num}%)`);
                })()}
              </td>
            </tr>

            {/* 5. 6-Minute Walk Distance */}
            <tr>
              <td style={tdStyle}><b>6-Minute Walk Distance</b></td>
              <td style={tdStyle}>&lt;250 m or desaturation &lt;88%</td>
              <td style={tdStyle}><b>{reconciled.sixMwt}</b></td>
              <td style={tdStyle}>
                {(() => {
                  if (isNaN(reconciled.sixMwtNum)) {
                    return renderStatusBadge("pending", "Pending 6MWT");
                  }
                  if (reconciled.sixMwtNum < 250) return renderStatusBadge("listing", `🚨 Marked Impairment (<250m)`);
                  if (reconciled.sixMwtNum < 350) return renderStatusBadge("referral", `⚠️ Moderate Impairment (${reconciled.sixMwtNum}m)`);
                  return renderStatusBadge("normal", `✓ Adequate Functional Reserve (≥350m)`);
                })()}
              </td>
            </tr>

            {/* 6. Arterial PaO2 (Room Air) */}
            <tr>
              <td style={tdStyle}><b>Arterial PaO2 (Room Air)</b></td>
              <td style={tdStyle}>&lt;55–60 mmHg (Refractory Hypoxemia)</td>
              <td style={tdStyle}><b>{reconciled.pao2}</b></td>
              <td style={tdStyle}>
                {(() => {
                  if (isNaN(reconciled.pao2Num)) {
                    return renderStatusBadge("pending", "Pending ABG");
                  }
                  if (reconciled.pao2Num < 55) return renderStatusBadge("listing", `🚨 Severe Hypoxemia (<55) — Listing Zone`);
                  if (reconciled.pao2Num <= 60) return renderStatusBadge("referral", `⚠️ Referral Zone (55–60 mmHg)`);
                  return renderStatusBadge("normal", `✓ Adequate Oxygenation (${reconciled.pao2Num} mmHg)`);
                })()}
              </td>
            </tr>

            {/* 7. Arterial PaCO2 */}
            <tr>
              <td style={tdStyle}><b>Arterial PaCO2</b></td>
              <td style={tdStyle}>&gt;50 mmHg (Progressive Hypercapnia)</td>
              <td style={tdStyle}><b>{reconciled.paco2}</b></td>
              <td style={tdStyle}>
                {(() => {
                  if (isNaN(reconciled.paco2Num)) {
                    return renderStatusBadge("pending", "Pending ABG");
                  }
                  if (reconciled.paco2Num > 50) return renderStatusBadge("referral", `⚠️ Hypercapnia (>50) — Referral Zone`);
                  return renderStatusBadge("normal", `✓ Eucapnic / Compensated (${reconciled.paco2Num} mmHg)`);
                })()}
              </td>
            </tr>

            {/* 8. DLCO (% predicted) */}
            <tr>
              <td style={tdStyle}><b>DLCO (% predicted)</b></td>
              <td style={tdStyle}>&lt;30–35% predicted (Severe Diffusion Deficit)</td>
              <td style={tdStyle}><b>{reconciled.dlco}</b></td>
              <td style={tdStyle}>
                {(() => {
                  if (isNaN(reconciled.dlcoNum)) {
                    return renderStatusBadge("pending", "Pending DLCO");
                  }
                  if (reconciled.dlcoNum < 35) return renderStatusBadge("listing", `🚨 Severe Deficit (<35%) — Listing Zone`);
                  if (reconciled.dlcoNum <= 50) return renderStatusBadge("referral", `⚠️ Referral Zone (35–50%)`);
                  return renderStatusBadge("normal", `✓ Preserved Gas Transfer (${reconciled.dlcoNum}%)`);
                })()}
              </td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="Transplant Evaluation Notes & Psychosocial Screening">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <FormField
            label="COMORBIDITY & ORGAN CLEARANCE NOTES"
            name="tx_comorbidity_notes"
            type="textarea"
            placeholder="Document cardiac cath clearance, renal function, bone density, osteoporosis, GI reflux..."
          />
          <FormField
            label="PSYCHOSOCIAL ASSESSMENT"
            name="tx_psychosocial_assessment"
            type="textarea"
            placeholder="Primary caregiver support, adherence track record, mental health clearance, substance abstinence..."
          />
        </div>
      </Section>
    </div>
  );
};

// ─── Sub-tab 3: Lung Donor Evaluation & Compatibility Metrics ──────────────
const LungDonorManager = () => {
  const { formData, updateField } = usePulmonology();
  const donors = formData.tx_donors_list || [];
  const recipientTlc = parseFloat(formData.tx_tlc_pred) || 5.2;
  const recipientBlood = formData.tx_blood_type || "";

  const [newDonor, setNewDonor] = useState({
    name: "",
    type: "DBD (Brain Death)",
    bloodType: "A Positive",
    sex: "Male",
    heightCm: "175",
    pao2Fio2: "380",
    smokingPackYrs: "0",
    bronchFinding: "Clear normal airways",
    cxrFinding: "Clear lung fields bilaterally",
  });

  const addDonor = () => {
    if (!newDonor.name) return;

    // Estimate donor pTLC using European Respiratory Society (ERS) height formula:
    // Males: TLC = (0.0799 * height) - 7.08; Females: TLC = (0.0660 * height) - 5.79
    const h = parseFloat(newDonor.heightCm) || 175;
    const estTlc =
      newDonor.sex === "Female"
        ? Math.max(3.0, 0.066 * h - 5.79)
        : Math.max(3.5, 0.0799 * h - 7.08);

    const sizeRatio = recipientTlc > 0 ? Math.round((estTlc / recipientTlc) * 100) : 100;
    const pf = parseFloat(newDonor.pao2Fio2) || 300;

    let oxygenationQuality = "Ideal (>300)";
    if (pf < 250) oxygenationQuality = "Marginal / EVLP Candidate (<250)";
    else if (pf <= 300) oxygenationQuality = "Extended Criteria (250-300)";

    const d = {
      ...newDonor,
      id: Date.now().toString(),
      donorTlc: estTlc.toFixed(2),
      sizeRatio: `${sizeRatio}%`,
      oxygenationQuality,
      compatibility: "Pending Evaluation",
      status: "Offer Under Review",
    };

    updateField("tx_donors_list", [...donors, d]);
    setNewDonor({
      name: "",
      type: "DBD (Brain Death)",
      bloodType: "A Positive",
      sex: "Male",
      heightCm: "175",
      pao2Fio2: "380",
      smokingPackYrs: "0",
      bronchFinding: "Clear normal airways",
      cxrFinding: "Clear lung fields bilaterally",
    });
  };

  const checkEligibility = (id) => {
    const updated = donors.map((d) => {
      if (d.id === id) {
        // ABO compatibility check
        let isAboCompat = true;
        if (recipientBlood && d.bloodType) {
          if (recipientBlood.includes("O") && !d.bloodType.includes("O")) isAboCompat = false;
          else if (recipientBlood.includes("A") && d.bloodType.includes("B") && !recipientBlood.includes("AB"))
            isAboCompat = false;
          else if (recipientBlood.includes("B") && d.bloodType.includes("A") && !recipientBlood.includes("AB"))
            isAboCompat = false;
        }

        const pf = parseFloat(d.pao2Fio2) || 300;
        const size = parseInt(d.sizeRatio, 10) || 100;
        const isSizeAcceptable = size >= 75 && size <= 125;

        let verdict = "Compatible & Cleared";
        if (!isAboCompat) verdict = "ABO Incompatible (Contraindicated)";
        else if (!isSizeAcceptable) verdict = `Size Mismatch Warning (${size}%)`;
        else if (pf < 250) verdict = "Marginal Oxygenation (EVLP Required)";

        return { ...d, compatibility: verdict, status: isAboCompat ? "Evaluated" : "Declined" };
      }
      return d;
    });
    updateField("tx_donors_list", updated);
  };

  const setPrimaryDonor = (donor) => {
    updateField("tx_primary_donor_name", donor.name);
    updateField("tx_donor_type", donor.type);
    updateField("tx_donor_blood", donor.bloodType);
    updateField("tx_donor_pao2_fio2", donor.pao2Fio2);
    updateField("tx_donor_size_ratio", donor.sizeRatio);
    updateField("tx_donor_tlc", donor.donorTlc);
    updateField("tx_donor_smoking", `${donor.smokingPackYrs} pack-years`);
    updateField("tx_donor_bronch", donor.bronchFinding);
    updateField("tx_donor_cxr", donor.cxrFinding);
    updateField("tx_donor_compat_status", donor.compatibility || "Compatible");
    updateField("tx_donor_workup_status", "Selected Primary Donor");
  };

  const removeDonor = (id) => {
    updateField(
      "tx_donors_list",
      donors.filter((d) => d.id !== id)
    );
  };

  return (
    <div>
      <Section
        title="Manage Potential Lung Donors (Offers & Tracking)"
        note="Record donor offers, compute pTLC sizing geometry, oxygenation challenge, and ABO compatibility"
      >
        <div style={{ marginBottom: "16px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1.2fr 1.2fr 1fr 0.8fr 0.8fr 1fr 1fr auto",
              gap: "8px",
              marginBottom: "12px",
            }}
          >
            <div>
              <label style={labelStyle}>DONOR ID / NAME</label>
              <input
                type="text"
                placeholder="e.g. UNOS-DN-4821"
                value={newDonor.name}
                onChange={(e) => setNewDonor({ ...newDonor, name: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>DONOR TYPE</label>
              <select
                value={newDonor.type}
                onChange={(e) => setNewDonor({ ...newDonor, type: e.target.value })}
                style={inputStyle}
              >
                <option>DBD (Brain Death)</option>
                <option>DCD (Circulatory Death III)</option>
                <option>Extended Criteria Donor</option>
                <option>Living Lobar Donor</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>BLOOD GROUP</label>
              <select
                value={newDonor.bloodType}
                onChange={(e) => setNewDonor({ ...newDonor, bloodType: e.target.value })}
                style={inputStyle}
              >
                <option>O Positive</option>
                <option>O Negative</option>
                <option>A Positive</option>
                <option>A Negative</option>
                <option>B Positive</option>
                <option>B Negative</option>
                <option>AB Positive</option>
                <option>AB Negative</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>SEX</label>
              <select
                value={newDonor.sex}
                onChange={(e) => setNewDonor({ ...newDonor, sex: e.target.value })}
                style={inputStyle}
              >
                <option>Male</option>
                <option>Female</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>HEIGHT (CM)</label>
              <input
                type="number"
                placeholder="175"
                value={newDonor.heightCm}
                onChange={(e) => setNewDonor({ ...newDonor, heightCm: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>PaO2/FiO2 (mmHg)</label>
              <input
                type="number"
                placeholder="380"
                value={newDonor.pao2Fio2}
                onChange={(e) => setNewDonor({ ...newDonor, pao2Fio2: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div>
              <label style={labelStyle}>SMOKING (PK-YR)</label>
              <input
                type="number"
                placeholder="0"
                value={newDonor.smokingPackYrs}
                onChange={(e) => setNewDonor({ ...newDonor, smokingPackYrs: e.target.value })}
                style={inputStyle}
              />
            </div>
            <div style={{ display: "flex", alignItems: "flex-end" }}>
              <button
                type="button"
                onClick={addDonor}
                style={{
                  background: "#000000",
                  color: "#ffffff",
                  border: "none",
                  padding: "8px 12px",
                  fontSize: "11px",
                  cursor: "pointer",
                  fontWeight: 600,
                  height: "30px",
                }}
              >
                + Add Donor
              </button>
            </div>
          </div>

          {donors.length === 0 ? (
            <div
              style={{
                padding: "14px",
                textAlign: "center",
                color: "#888",
                fontStyle: "italic",
                fontSize: "12px",
                background: "#fdfdfd",
                border: "1px dashed #e0e0e0",
              }}
            >
              No donor offers registered. Enter donor metrics above to evaluate compatibility, pTLC size matching, and oxygenation quality.
            </div>
          ) : (
            <div style={{ border: "1px solid #e0e0e0", overflow: "hidden" }}>
              {donors.map((d) => {
                const isSelected = formData.tx_primary_donor_name === d.name;
                const isWarning =
                  d.compatibility.includes("Incompatible") ||
                  d.compatibility.includes("Warning") ||
                  d.compatibility.includes("Marginal");
                return (
                  <div
                    key={d.id}
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "10px 14px",
                      borderBottom: "1px solid #e0e0e0",
                      fontSize: "12px",
                      background: isSelected ? "#f0fdf4" : "#ffffff",
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                        <b style={{ fontSize: "13px" }}>{d.name}</b>
                        <span style={{ fontSize: "10.5px", color: "#666" }}>({d.type})</span>
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "1px 6px",
                            background: "#f0f0f0",
                            borderRadius: "2px",
                            fontWeight: 600,
                          }}
                        >
                          Blood: {d.bloodType}
                        </span>
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "1px 6px",
                            background: "#e3f2fd",
                            color: "#1565c0",
                            borderRadius: "2px",
                            fontWeight: 600,
                          }}
                        >
                          pTLC: {d.donorTlc} L (Size Fit: {d.sizeRatio})
                        </span>
                        <span
                          style={{
                            fontSize: "10px",
                            padding: "1px 6px",
                            background: parseFloat(d.pao2Fio2) >= 300 ? "#e8f5e9" : "#fff3e0",
                            color: parseFloat(d.pao2Fio2) >= 300 ? "#2e7d32" : "#e65100",
                            borderRadius: "2px",
                            fontWeight: 600,
                          }}
                        >
                          PaO2/FiO2: {d.pao2Fio2} mmHg ({d.oxygenationQuality})
                        </span>
                        {isSelected && (
                          <span
                            style={{
                              background: "#2e7d32",
                              color: "#fff",
                              padding: "2px 8px",
                              borderRadius: "2px",
                              fontSize: "10px",
                              fontWeight: 700,
                            }}
                          >
                            SELECTED PRIMARY
                          </span>
                        )}
                      </div>
                      <div
                        style={{
                          color: isWarning ? "#c62828" : "#2e7d32",
                          marginTop: "4px",
                          fontSize: "11px",
                          fontWeight: 500,
                        }}
                      >
                        Status: {d.status} | Compatibility: {d.compatibility}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <button
                        type="button"
                        onClick={() => checkEligibility(d.id)}
                        style={{
                          background: "#f5f5f5",
                          border: "1px solid #ccc",
                          padding: "4px 10px",
                          fontSize: "11px",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        Check Compatibility
                      </button>
                      <button
                        type="button"
                        onClick={() => setPrimaryDonor(d)}
                        style={{
                          background: isSelected ? "#2e7d32" : "#000000",
                          color: "#ffffff",
                          border: "none",
                          padding: "4px 12px",
                          fontSize: "11px",
                          cursor: "pointer",
                          fontWeight: 600,
                        }}
                      >
                        {isSelected ? "Selected" : "Choose"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeDonor(d.id)}
                        style={{
                          background: "none",
                          border: "none",
                          color: "#888888",
                          cursor: "pointer",
                          fontSize: "16px",
                          padding: "0 6px",
                          fontWeight: 700,
                        }}
                      >
                        x
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Primary Selected Donor — Functional & Physiologic Metrics"
        note="Detailed physiological clearance and anatomical sizing parameters"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
          <FormField label="PRIMARY DONOR IDENTIFIER" name="tx_primary_donor_name" placeholder="No donor selected..." />
          <FormField
            label="DONOR CLASSIFICATION"
            name="tx_donor_type"
            type="select"
            options={["", "DBD (Standard Criteria)", "DCD (Circulatory Death III)", "Extended Criteria Donor", "Living-Donor Lobar"]}
          />
          <FormField
            label="DONOR BLOOD GROUP"
            name="tx_donor_blood"
            type="select"
            options={["", "O Positive", "O Negative", "A Positive", "A Negative", "B Positive", "B Negative", "AB Positive", "AB Negative"]}
          />
          <FormField
            label="DONOR WORKUP / SELECTION STATUS"
            name="tx_donor_workup_status"
            type="select"
            options={["", "Initial Screening", "Under EVLP Evaluation", "Selected Primary Donor", "Cleared for Implantation", "Declined / Ruled Out"]}
          />
          <FormField label="PaO2 / FiO2 RATIO (100% O2 + 5 PEEP)" name="tx_donor_pao2_fio2" placeholder="e.g. 380 mmHg (>300 ideal)" />
          <FormField label="DONOR pTLC (LITERS)" name="tx_donor_tlc" placeholder="e.g. 5.4 L" />
          <FormField label="pTLC SIZE MATCH RATIO (%)" name="tx_donor_size_ratio" placeholder="e.g. 104% (Target 80-120%)" />
          <FormField label="DONOR SMOKING HISTORY" name="tx_donor_smoking" placeholder="e.g. 10 pack-years" />
          <FormField
            label="DONOR BRONCHOSCOPY FINDING"
            name="tx_donor_bronch"
            type="select"
            options={[
              "",
              "Clear normal tracheobronchial tree",
              "Minimal serous secretions — suctioned clear",
              "Copious purulent secretions (Gram negative / MRSA risk)",
              "Gastric aspiration / particulate matter in airways",
              "Significant airway mucosal erythema / trauma",
            ]}
          />
          <FormField
            label="DONOR CHEST RADIOGRAPH (CXR / CT)"
            name="tx_donor_cxr"
            type="select"
            options={[
              "",
              "Clear lung fields bilaterally",
              "Unilateral basilar contusion / opacity",
              "Neurogenic pulmonary edema",
              "Aspiration consolidation",
              "Bilateral diffuse opacities (Severe injury)",
            ]}
          />
          <FormField
            label="EX VIVO LUNG PERFUSION (EVLP)"
            name="tx_donor_evlp"
            type="select"
            options={[
              "",
              "Not Indicated — Standard Criteria Lung",
              "EVLP Indicated — Marginal Oxygenation (PaO2/FiO2 < 250)",
              "EVLP Indicated — DCD Category III Prolonged Warm Ischemia",
              "EVLP Completed — Successful Reconditioning & Clearance",
              "EVLP Failed — Discard Organ",
            ]}
          />
          <FormField label="COLD ISCHEMIC TIME (HOURS)" name="tx_donor_cit" placeholder="e.g. 5.5 hours (Target <6-8h)" />
        </div>
      </Section>

      <Section
        title="Immunological Compatibility & Viral Risk Pairing"
        note="ABO crossmatching, HLA donor-specific antibodies, and cytomegalovirus surveillance"
      >
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField
            label="ABO COMPATIBILITY STATUS"
            name="tx_donor_compat_status"
            type="select"
            options={["", "Identical", "Compatible", "Incompatible — Contraindicated"]}
          />
          <FormField
            label="VIRTUAL CROSSMATCH & HLA DSA"
            name="tx_donor_crossmatch"
            type="select"
            options={[
              "",
              "Negative — No Donor Specific Antibodies",
              "Positive DSA (Low MFI < 2000)",
              "Positive DSA (High MFI > 5000 — Desensitization Required)",
            ]}
          />
          <FormField
            label="CMV SEROSTATUS PAIRING"
            name="tx_donor_cmv_pairing"
            type="select"
            options={[
              "",
              "D+ / R- (High Risk — 6-12 mo Valganciclovir Prophylaxis)",
              "D+ / R+ (Moderate Risk — 3-6 mo Prophylaxis)",
              "D- / R+ (Moderate Risk — Prophylaxis / Monitoring)",
              "D- / R- (Low Risk — No Prophylaxis Needed)",
            ]}
          />
          <FormField
            label="DONOR BRONCHIAL ASPIRATE CULTURE"
            name="tx_donor_cultures"
            type="select"
            options={[
              "",
              "Pending microbiology",
              "Gram Stain Negative / Normal Flora",
              "MRSA Positive (Targeted vancomycin/linezolid)",
              "Pseudomonas aeruginosa (Antipseudomonal cover)",
              "Klebsiella pneumoniae / Gram negative rod",
              "Candida albicans present",
              "Aspergillus species identified",
            ]}
          />
          <FormField
            label="EBV & VIRAL SCREENING"
            name="tx_donor_ebv_status"
            type="select"
            options={["", "Negative", "Donor Positive / Recipient Negative (PTLD Risk)", "Both Positive", "Pending"]}
          />
          <FormField
            label="DESENSITIZATION REQUISITION"
            name="tx_donor_desens"
            type="select"
            options={["", "Not Indicated", "Plasmapheresis + IVIG Protocol", "Rituximab Adjuvant", "Bortezomib Protocol"]}
          />
        </div>
      </Section>
    </div>
  );
};

// ─── Sub-tab 4: Allocation & Waitlist ───────────────────────────────────────
const AllocationTab = () => (
  <div>
    <Section title="Transplant Referral & Listing Details">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
        <FormField label="REFERRAL DATE" name="tx_referral_date" type="date" />
        <FormField label="REFERRAL CENTRE" name="tx_referral_center" placeholder="e.g. AIIMS Transplant Centre" />
        <FormField
          label="WAITLIST / CANDIDACY STATUS"
          name="tx_listing_status"
          type="select"
          options={["Not referred", "Under formal evaluation", "Listed — active", "Listed — temporarily inactive", "Transplanted", "Delisted / declined"]}
        />
        <FormField
          label="ABO BLOOD GROUP"
          name="tx_blood_type"
          type="select"
          options={["", "O Positive", "O Negative", "A Positive", "A Negative", "B Positive", "B Negative", "AB Positive", "AB Negative"]}
        />
        <FormField label="HLA TYPING COMPLETE?" name="tx_hla_done" type="checkbox" placeholder="HLA typing verified" />
        <FormField label="PREDICTED TOTAL LUNG CAPACITY" name="tx_tlc_pred" placeholder="e.g. 5.2 L (for donor size matching)" />
        <FormField label="LUNG ALLOCATION SCORE (LAS)" name="tx_las" placeholder="e.g. 46.5" />
        <FormField
          label="PROCEDURE TYPE PLANNED"
          name="tx_type_decision"
          type="select"
          options={["Not decided", "Bilateral sequential lung transplant", "Single lung transplant", "Living-donor lobar"]}
        />
      </div>
    </Section>

    <Section title="Transplant Modality Guidance">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div style={{ padding: "12px", background: "#fafafa", border: "1px solid #e0e0e0" }}>
          <p style={{ fontSize: "12.5px", color: "#000", margin: "0 0 6px", fontWeight: 600 }}>
            Bilateral Sequential (Preferred for COPD & Suppurative Diseases):
          </p>
          <ul style={{ paddingLeft: "18px", fontSize: "12px", color: "#444", margin: 0, lineHeight: "1.5" }}>
            <li>Superior long-term survival in younger recipients</li>
            <li>Eliminates native lung hyperinflation and malignancy risk</li>
            <li>Mandatory for bronchiectasis / cystic fibrosis (infection control)</li>
          </ul>
        </div>
        <div style={{ padding: "12px", background: "#fafafa", border: "1px solid #e0e0e0" }}>
          <p style={{ fontSize: "12.5px", color: "#000", margin: "0 0 6px", fontWeight: 600 }}>
            Single Lung Transplant (Selected ILD / Older Recipients):
          </p>
          <ul style={{ paddingLeft: "18px", fontSize: "12px", color: "#444", margin: 0, lineHeight: "1.5" }}>
            <li>Shorter surgical and bypass time</li>
            <li>Maximizes scarce donor organ pool</li>
            <li>Acceptable option in older idiopathic pulmonary fibrosis patients</li>
          </ul>
        </div>
      </div>
    </Section>
  </div>
);

// ─── Sub-tab 4: Immunosuppression ───────────────────────────────────────────
const EMPTY_REJECTION = { date: "", type: "", grade: "", treatment: "", outcome: "" };

const ImmunoTab = () => {
  const { formData, updateField } = usePulmonology();
  const rejectionLog = formData.immuno_rejection_log || [];
  const [newRow, setNewRow] = useState(EMPTY_REJECTION);

  const handleAddRejection = () => {
    if (!newRow.date) return;
    updateField("immuno_rejection_log", [
      ...rejectionLog,
      { ...newRow, id: Date.now().toString() },
    ]);
    setNewRow(EMPTY_REJECTION);
  };

  const handleDeleteRejection = (id) => {
    updateField(
      "immuno_rejection_log",
      rejectionLog.filter((r) => r.id !== id)
    );
  };

  return (
    <div>
      <Section title="Post-Transplant Maintenance Regimen" note="Triple-therapy maintenance protocol">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="PRIMARY IMMUNOSUPPRESSION REGIMEN" name="immuno_regimen" placeholder="e.g. Tacrolimus + MMF + Prednisolone" />
          <FormField label="TACROLIMUS TROUGH LEVEL (ng/mL)" name="immuno_tac_level" type="number" placeholder="e.g. 9.4 (target 8–12)" />
          <FormField label="LAST LEVEL DATE" name="immuno_tac_level_date" type="date" />
          <FormField
            label="TACROLIMUS DOSE ADJUSTMENT"
            name="immuno_tac_adj"
            type="select"
            options={["No change — therapeutic", "Dose increased", "Dose decreased", "Formulation switched (Advagraf/Prograf)"]}
          />
          <FormField label="MYCOPHENOLATE (MMF) DOSE" name="immuno_mmf_dose" placeholder="e.g. 1000mg BD" />
          <FormField label="PREDNISOLONE DOSE" name="immuno_pred_dose" placeholder="e.g. 5mg OD" />
        </div>
      </Section>

      <Section title="Rejection Episodes Log" note="Track acute cellular or antibody-mediated rejection events">
        <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1.2fr 1.2fr 1.5fr 1fr 36px",
              gap: "8px",
              padding: "8px 12px",
              background: "#f5f5f5",
              borderBottom: "1px solid #e0e0e0",
            }}
          >
            {["Date", "Type", "Grade", "Treatment", "Outcome", ""].map((h, i) => (
              <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>
                {h}
              </span>
            ))}
          </div>

          {rejectionLog.length === 0 ? (
            <div style={{ padding: "16px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
              No rejection episodes logged.
            </div>
          ) : (
            rejectionLog.map((row) => (
              <div
                key={row.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1.2fr 1.2fr 1.5fr 1fr 36px",
                  gap: "8px",
                  padding: "8px 12px",
                  fontSize: "12px",
                  borderBottom: "1px solid #f0f0f0",
                  alignItems: "center",
                }}
              >
                <span>{row.date}</span>
                <span>{row.type}</span>
                <span style={{ fontWeight: 600, color: "#d32f2f" }}>{row.grade}</span>
                <span>{row.treatment}</span>
                <span>{row.outcome}</span>
                <button
                  onClick={() => handleDeleteRejection(row.id)}
                  style={{
                    background: "none",
                    border: "none",
                    color: "#888",
                    cursor: "pointer",
                    fontSize: "14px",
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>

        {/* Add Row Staging */}
        <div style={{ padding: "12px", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
          <div style={{ fontSize: "10.5px", fontWeight: 700, textTransform: "uppercase", color: "#666", marginBottom: "8px" }}>
            + Log Rejection Episode
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.2fr 1.5fr 1fr", gap: "8px" }}>
            <input
              type="date"
              value={newRow.date}
              onChange={(e) => setNewRow({ ...newRow, date: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="e.g. Acute Cellular"
              value={newRow.type}
              onChange={(e) => setNewRow({ ...newRow, type: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="e.g. ISHLT A2B1"
              value={newRow.grade}
              onChange={(e) => setNewRow({ ...newRow, grade: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="e.g. Pulse methylpred 1g x 3d"
              value={newRow.treatment}
              onChange={(e) => setNewRow({ ...newRow, treatment: e.target.value })}
              style={inputStyle}
            />
            <input
              type="text"
              placeholder="e.g. Resolved / Baseline FEV1"
              value={newRow.outcome}
              onChange={(e) => setNewRow({ ...newRow, outcome: e.target.value })}
              style={inputStyle}
            />
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "10px" }}>
            <button
              onClick={handleAddRejection}
              style={{
                padding: "6px 16px",
                background: "#000",
                color: "#fff",
                border: "none",
                fontSize: "11.5px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              Add Rejection Entry
            </button>
          </div>
        </div>
      </Section>

      <Section title="Immunosuppression & Rejection Surveillance Notes">
        <FormField
          label="ADDITIONAL MONITORING NOTES"
          name="immuno_notes"
          type="textarea"
          placeholder="Document surveillance bronchoscopy (transbronchial biopsy) findings, CMV prophylaxis, side effects..."
        />
      </Section>
    </div>
  );
};

// ─── Main Container ────────────────────────────────────────────────────────
export default function TransplantWorkup() {
  return (
    <div>
      <div
        style={{
          borderLeft: "3px solid #000",
          background: "#fff",
          padding: "12px 16px",
          border: "1px solid #e0e0e0",
          borderLeftWidth: "3px",
          marginBottom: "16px",
        }}
      >
        <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
          Lung Transplant Candidacy &amp; Comprehensive Workup
        </h4>
        <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
          ISHLT 2021 consensus criteria, multi-disciplinary workup tracking, allocation data, post-Tx immunosuppression, and committee recommendation.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <VoiceDictationPanel section="Transplant Candidacy & Donor Evaluation" />
        <TxOverviewTab />
        <EligibilityTab />
        <LungDonorManager />
        <AllocationTab />
        <ImmunoTab />
        <TxCloseTab />
      </div>
    </div>
  );
}

