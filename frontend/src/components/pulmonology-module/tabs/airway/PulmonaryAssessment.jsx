import React, { useState, useMemo } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";

// --- Shared Styles ---
const tableStyle = { width: "100%", borderCollapse: "collapse" };
const thStyle = {
  fontSize: "10.5px", fontWeight: 600, letterSpacing: "0.06em",
  textTransform: "uppercase", textAlign: "left", padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0", backgroundColor: "#f5f5f5", color: "#000",
};
const tdStyle = {
  fontSize: "13px", padding: "8px 10px",
  borderBottom: "1px solid #e0e0e0", verticalAlign: "top", color: "#000",
};

// --- Helper Components ---
const Badge = ({ children, color = "default" }) => {
  const colors = {
    red: { borderColor: "#d32f2f", color: "#d32f2f", bg: "#ffebee" },
    green: { borderColor: "#2e7d32", color: "#fff", bg: "#2e7d32" },
    amber: { borderColor: "#e65100", color: "#e65100", bg: "#fff3e0" },
    default: { borderColor: "#e0e0e0", color: "#444", bg: "#f5f5f5" },
  };
  const c = colors[color] || colors.default;
  return (
    <span style={{ fontSize: "11px", padding: "3px 8px", border: `1px solid ${c.borderColor}`, backgroundColor: c.bg, color: c.color, display: "inline-block" }}>
      {children}
    </span>
  );
};

const AlertBox = ({ type = "flag", children }) => {
  const styles = {
    flag: { border: "#d32f2f", bg: "#ffebee", text: "#611a15" },
    warn: { border: "#e65100", bg: "#fff3e0", text: "#4e2a04" },
    info: { border: "#1565c0", bg: "#e3f2fd", text: "#0d3c61" },
  };
  const s = styles[type] || styles.flag;
  return (
    <div style={{ borderLeft: `3px solid ${s.border}`, backgroundColor: s.bg, padding: "10px 14px", fontSize: "12px", color: s.text, marginTop: "10px" }}>
      {children}
    </div>
  );
};

const DashCard = ({ label, value, color }) => (
  <div style={{ background: "#fff", padding: "12px", border: "1px solid #e0e0e0", textAlign: "center" }}>
    <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600, marginBottom: "4px" }}>{label}</div>
    <div style={{ fontSize: "16px", fontWeight: 700, color: color || "#000" }}>{value || "—"}</div>
  </div>
);

// --- Helper Functions ---
export const calcGoldStageFromFev1 = (val) => {
  const num = parseFloat(val);
  if (isNaN(num) || num <= 0) return null;
  if (num >= 80) return "GOLD 1";
  if (num >= 50) return "GOLD 2";
  if (num >= 30) return "GOLD 3";
  return "GOLD 4";
};

export const MMRC_OPTIONS = [
  "0 — Strenuous exercise only",
  "1 — Hurrying / mild hill",
  "2 — Slower than peers",
  "3 — Stops after 100m",
  "4 — Breathless dressing",
];

export const mapMmrcToOption = (val) => {
  if (val === undefined || val === null || val === "") return "";
  const str = String(val).trim();
  const match = MMRC_OPTIONS.find((opt) => opt.startsWith(str.charAt(0)));
  return match || str;
};

export const GOLD_STAGE_OPTIONS = [
  "GOLD 1 (FEV1 ≥80%)",
  "GOLD 2 (FEV1 50–79%)",
  "GOLD 3 (FEV1 30–49%)",
  "GOLD 4 (FEV1 <30%)",
];

export const mapGoldStageToOption = (val) => {
  if (!val) return "";
  const str = String(val).toUpperCase();
  if (str.includes("GOLD 1") || str.includes("STAGE 1") || str.includes("GRADE 1") || str === "1")
    return "GOLD 1 (FEV1 ≥80%)";
  if (str.includes("GOLD 2") || str.includes("STAGE 2") || str.includes("GRADE 2") || str === "2")
    return "GOLD 2 (FEV1 50–79%)";
  if (str.includes("GOLD 3") || str.includes("STAGE 3") || str.includes("GRADE 3") || str === "3")
    return "GOLD 3 (FEV1 30–49%)";
  if (str.includes("GOLD 4") || str.includes("STAGE 4") || str.includes("GRADE 4") || str === "4")
    return "GOLD 4 (FEV1 <30%)";
  return "";
};

// --- Sub-Tab: Clinical Review ---
const ClinicalReviewTab = ({ formData, updateField, historyProps }) => {
  const { procedures, screeningSessions, patientId } = usePulmonology();
  const exacLog = formData.copd_exac_log || [];
  const hospCount = exacLog.filter(e => (e.type || e.severity || "").toLowerCase().includes("hosp")).length;
  const outCount = exacLog.length - hospCount;
  
  const allSessions = historyProps?.sessions || [];

  // Use intake / clinical baseline fields if available, otherwise fallback to log or historical sessions
  const intakeExac = formData.exacerbations_last_year ?? formData.hx_exac_count ?? formData.pulm_exacerbations;
  const derivedExac = useMemo(() => {
    if (intakeExac !== undefined && intakeExac !== null && intakeExac !== "") {
      const hCount = formData.hospitalized_exacerbation ? ` (${formData.hospitalized_exacerbation} hospitalized)` : "";
      return `${intakeExac} exacerbations in past 12 mo${hCount}`;
    }
    if (exacLog.length > 0) {
      return `${exacLog.length} (${outCount} outpatient, ${hospCount} hospitalized)`;
    }
    for (const s of allSessions) {
      const d = s.data || {};
      const histExac = d.exacerbations_last_year ?? d.hx_exac_count ?? d.pulm_exacerbations;
      if (histExac !== undefined && histExac !== null && histExac !== "") {
        return `${histExac} exacerbations in past 12 mo (Historical)`;
      }
    }
    return "0 (None documented)";
  }, [intakeExac, formData.hospitalized_exacerbation, exacLog.length, outCount, hospCount, allSessions]);

  // Helper to extract PFT record safely
  const extractPftRecord = (d = {}, fallbackDate = "Encounter") => {
    const fev1Pct = d.pft_fev1_pct || d.pulm_current_fev1_pct || d.fev1_percent || d.pft_fev1_pred;
    const fev1 = d.pft_fev1_post || d.pft_fev1_pre || d.pft_fev1_actual || d.fev1 || d.fev1_actual;
    const fvc = d.pft_fvc_post || d.pft_fvc_pre || d.pulm_current_fvc_pct;
    let ratio = d.pft_ratio_post || d.pft_ratio_pre || d.pft_ratio;
    if (!ratio && fev1 && fvc) {
      const numFev1 = parseFloat(fev1);
      const numFvc = parseFloat(fvc);
      if (numFev1 > 0 && numFvc > 0) {
        const trueFvcL = numFvc > 10 ? (numFvc / 100) * 3.5 : numFvc;
        ratio = (numFev1 / trueFvcL).toFixed(2);
      }
    }
    const stage = d.copd_gold_stage?.split(" (")[0] || d.calc_gold_stage?.split(" (")[0] || (fev1Pct ? calcGoldStageFromFev1(fev1Pct) : null);
    
    if (fev1Pct || fev1) {
      return {
        date: d.pft_test_date || d.spiro_date || d.pulm_baseline_date || fallbackDate,
        fev1: fev1 ? `${String(fev1).replace(/[^0-9.]/g, "")} L` : "—",
        fev1_pct: fev1Pct ? `${String(fev1Pct).replace(/[^0-9.]/g, "")}%` : "—",
        ratio: ratio ? String(ratio) : "—",
        stage: stage || "—"
      };
    }
    return null;
  };

  // Collect all PFT sessions from formData, procedures, and history
  const pftList = useMemo(() => {
    const list = [];
    const seenDates = new Set();

    // 1. Current Encounter in formData
    const currentPft = extractPftRecord(formData, "Current Encounter");
    if (currentPft) {
      list.push(currentPft);
      seenDates.add(currentPft.date);
    }

    // 2. Prior test recorded in formData (from DiagnosticsOverviewTab)
    if (formData.pft_fev1_prev) {
      const priorDate = formData.diag_prior_date || "Prior Encounter";
      if (!seenDates.has(priorDate)) {
        list.push({
          date: priorDate,
          fev1: formData.pft_fev1_prev_liters ? `${formData.pft_fev1_prev_liters} L` : "—",
          fev1_pct: `${String(formData.pft_fev1_prev).replace(/[^0-9.]/g, "")}%`,
          ratio: formData.pft_ratio_prev || "—",
          stage: calcGoldStageFromFev1(formData.pft_fev1_prev) || "—"
        });
        seenDates.add(priorDate);
      }
    }

    // 3. Procedure sessions (procedures.pft or procedures.spiro)
    const procSessions = [
      ...(procedures?.pft?.sessions || []),
      ...(procedures?.spiro?.sessions || [])
    ];
    procSessions.forEach(ps => {
      const pft = extractPftRecord(ps.data || {}, ps.saved_at?.substring(0, 10) || "Procedure PFT");
      if (pft && !seenDates.has(pft.date)) {
        list.push(pft);
        seenDates.add(pft.date);
      }
    });

    // 4. Longitudinal track sessions from historyProps
    allSessions.forEach(s => {
      const d = s.data || {};
      const sDate = d.pft_test_date || s.created_at?.substring(0, 10) || "Historical";
      const pft = extractPftRecord(d, sDate);
      if (pft && !seenDates.has(pft.date)) {
        list.push(pft);
        seenDates.add(pft.date);
      }
      const nestedProc = [
        ...(s.procedures?.pft?.sessions || []),
        ...(s.procedures?.spiro?.sessions || [])
      ];
      nestedProc.forEach(nps => {
        const npft = extractPftRecord(nps.data || {}, nps.saved_at?.substring(0, 10) || sDate);
        if (npft && !seenDates.has(npft.date)) {
          list.push(npft);
          seenDates.add(npft.date);
        }
      });
    });

    // 5. LocalStorage fallback if list is still empty
    if (list.length === 0 && patientId) {
      try {
        const cached = JSON.parse(localStorage.getItem(`pulm_sync_${patientId}`) || "{}");
        const cachedPft = extractPftRecord(cached, "Saved Procedure");
        if (cachedPft) {
          list.push(cachedPft);
        }
      } catch (e) {}
    }

    return list;
  }, [formData, procedures, allSessions, patientId]);

  // Collect most recent Lab session + current formData
  const labData = useMemo(() => {
    const extractLabs = (d = {}) => {
      const eos = d.diag_eosinophil_count || d.blood_eosinophils || d.lab_eosinophils || d.copd_eosinophils;
      const ige = d.diag_serum_ige || d.lab_ige;
      const a1at = d.diag_alpha1_level || d.lab_a1at;
      const bnp = d.lab_pro_bnp || d.diag_pro_bnp;
      const feno = d.diag_feno_ppb;
      if (eos || ige || a1at || bnp || feno) {
        return {
          eos: eos !== undefined && eos !== null && eos !== "" ? parseFloat(eos) : null,
          ige: ige !== undefined && ige !== null && ige !== "" ? parseFloat(ige) : null,
          a1at: a1at !== undefined && a1at !== null && a1at !== "" ? parseFloat(a1at) : null,
          bnp: bnp !== undefined && bnp !== null && bnp !== "" ? parseFloat(bnp) : null,
          feno: feno !== undefined && feno !== null && feno !== "" ? parseFloat(feno) : null,
          date: d.pft_test_date || d.diag_last_date || "Current Encounter",
        };
      }
      return null;
    };

    const currentLabs = extractLabs(formData);
    if (currentLabs) return currentLabs;

    for (const s of allSessions) {
      const histLabs = extractLabs(s.data || {});
      if (histLabs) {
        histLabs.date = s.created_at?.substring(0, 10) || histLabs.date;
        return histLabs;
      }
    }
    return null;
  }, [formData, allSessions]);

  return (
    <div>
      <Section title="Spirometry Trend" note="Longitudinal tracking">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>FEV1</th>
              <th style={thStyle}>FEV1 % Pred.</th>
              <th style={thStyle}>FEV1/FVC</th>
              <th style={thStyle}>GOLD Stage</th>
            </tr>
          </thead>
          <tbody>
            {pftList.length > 0 ? (
              pftList.map((pft, idx) => (
                <tr key={idx}>
                  <td style={tdStyle}>{pft.date || "—"}</td>
                  <td style={tdStyle}>{pft.fev1}</td>
                  <td style={tdStyle}>{pft.fev1_pct}</td>
                  <td style={tdStyle}>{pft.ratio || "—"}</td>
                  <td style={tdStyle}>{pft.stage || "—"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: "center", color: "#888", fontStyle: "italic" }}>
                  No spirometry sessions recorded yet. Results will appear here after Diagnostics are completed.
                </td>
              </tr>
            )}
          </tbody>
        </table>

      </Section>

      <Section title="Latest PFT & Lab Results" note={labData?.date || "Current / Backend encounter"}>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Test</th>
              <th style={thStyle}>Result</th>
              <th style={thStyle}>Normal Range</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {labData ? (
              <>
                {labData.eos !== null && (
                  <tr>
                    <td style={tdStyle}>Blood Eosinophils</td>
                    <td style={tdStyle}>{labData.eos} cells/μL</td>
                    <td style={tdStyle}>&lt; 150 cells/μL</td>
                    <td style={tdStyle}>{labData.eos >= 300 ? <Badge color="red">Elevated</Badge> : <Badge color="green">Normal</Badge>}</td>
                  </tr>
                )}
                {labData.ige !== null && (
                  <tr>
                    <td style={tdStyle}>Total IgE</td>
                    <td style={tdStyle}>{labData.ige} IU/mL</td>
                    <td style={tdStyle}>&lt; 100 IU/mL</td>
                    <td style={tdStyle}>{labData.ige >= 100 ? <Badge color="red">Elevated</Badge> : <Badge color="green">Normal</Badge>}</td>
                  </tr>
                )}
                {labData.a1at !== null && (
                  <tr>
                    <td style={tdStyle}>Alpha-1 Antitrypsin</td>
                    <td style={tdStyle}>{labData.a1at} mg/dL</td>
                    <td style={tdStyle}>100–300 mg/dL</td>
                    <td style={tdStyle}>{labData.a1at < 100 ? <Badge color="red">Deficient</Badge> : <Badge color="green">Normal</Badge>}</td>
                  </tr>
                )}
                {labData.bnp !== null && (
                  <tr>
                    <td style={tdStyle}>NT-proBNP</td>
                    <td style={tdStyle}>{labData.bnp} pg/mL</td>
                    <td style={tdStyle}>&lt; 125 pg/mL</td>
                    <td style={tdStyle}>{labData.bnp >= 125 ? <Badge color="red">Elevated</Badge> : <Badge color="green">Normal</Badge>}</td>
                  </tr>
                )}
                {labData.feno !== null && (
                  <tr>
                    <td style={tdStyle}>FeNO</td>
                    <td style={tdStyle}>{labData.feno} ppb</td>
                    <td style={tdStyle}>&lt; 25 ppb</td>
                    <td style={tdStyle}>{labData.feno > 50 ? <Badge color="red">High</Badge> : labData.feno >= 25 ? <Badge color="amber">Intermediate</Badge> : <Badge color="green">Normal</Badge>}</td>
                  </tr>
                )}
              </>
            ) : (
              <tr>
                <td colSpan={4} style={{ ...tdStyle, textAlign: "center", color: "#888", fontStyle: "italic" }}>
                  No lab results recorded. Results from the Diagnostics track will appear here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>

      <Section title="Complications Review" note="Checked every visit">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="SPO2 (RESTING / EXERTIONAL)" name="copd_spo2" placeholder="e.g. 89% / 82%" />
          <FormField label="MMRC DYSPNEA SCALE" name="copd_mmrc" type="select" options={["0 — Strenuous exercise only", "1 — Hurrying / mild hill", "2 — Slower than peers", "3 — Stops after 100m", "4 — Breathless dressing"]} />
          <FormField label="CAT SCORE" name="copd_cat" placeholder="e.g. 24 / 40" />
          <FormField label="EXACERBATIONS (LAST 12 MO)" name="copd_exac" type="derived" derivedValue={derivedExac} />
          <FormField label="SPUTUM CHARACTERISTICS" name="copd_sputum" placeholder="e.g. Mucopurulent, moderate volume" />
          <FormField label="ANKLE EDEMA (COR PULMONALE)" name="copd_edema" type="select" options={["None", "Mild bilateral", "Significant"]} />
        </div>
      </Section>
    </div>
  );
};

// --- Sub-Tab: GOLD Grading ---
const GoldGradingTab = ({ formData, updateField }) => {
  const fev1Pct = formData.pft_fev1_pct || formData.pulm_current_fev1_pct || formData.fev1_percent || formData.fev1_pred;
  const stage = formData.copd_gold_stage || (formData.calc_gold_stage ? mapGoldStageToOption(formData.calc_gold_stage) : "") || (fev1Pct ? mapGoldStageToOption(calcGoldStageFromFev1(fev1Pct)) : "");
  const abeGroup = formData.copd_abe_group || (formData.calc_gold_group?.includes("E") ? "E" : formData.calc_gold_group?.includes("B") ? "B" : formData.calc_gold_group?.includes("A") ? "A" : "");
  const eos = parseFloat(formData.copd_eosinophils || formData.diag_eosinophil_count || formData.blood_eosinophils || formData.lab_eosinophils || 0);

  const therapyRec = useMemo(() => {
    if (!abeGroup) return null;
    if (abeGroup === "A") return "Single bronchodilator (LAMA or LABA). Focus on smoking cessation, exercise.";
    if (abeGroup === "B") return "Dual bronchodilation: LABA + LAMA. Consider pulmonary rehab.";
    if (abeGroup === "E" && eos >= 300) return "LABA + LAMA + ICS (triple therapy). Eosinophil-guided ICS indicated (Eos ≥300).";
    if (abeGroup === "E") return "LABA + LAMA. Consider Roflumilast / Azithromycin prophylaxis for exacerbation prevention.";
    return null;
  }, [abeGroup, eos]);

  const visitFreq = { "GOLD 1": "Annual visit", "GOLD 2": "Every 6–12 months", "GOLD 3": "Every 3–4 months", "GOLD 4": "Monthly — transplant / NIV evaluation" };

  return (
    <div>
      <Section title="GOLD Stage & ABE Classification">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
          <FormField label="CURRENT GOLD STAGE" name="copd_gold_stage" type="select" options={["GOLD 1 (FEV1 ≥80%)", "GOLD 2 (FEV1 50–79%)", "GOLD 3 (FEV1 30–49%)", "GOLD 4 (FEV1 <30%)"]} />
          <FormField label="ABE GROUP" name="copd_abe_group" type="select" options={["A", "B", "E"]} />
          <FormField label="BLOOD EOSINOPHILS (cells/mcL)" name="copd_eosinophils" placeholder="e.g. 320" />
          <FormField label="RECOMMENDED VISIT FREQUENCY" name="copd_visit_freq" type="derived" derivedValue={visitFreq[stage?.split(" (")[0]] || "Select GOLD stage"} />
        </div>

        {therapyRec && (
          <AlertBox type="info">
            <b>Therapy Recommendation (GOLD ABE + Eosinophil-Guided):</b> {therapyRec}
          </AlertBox>
        )}
      </Section>

      <Section title="GOLD Monitoring Schedule">
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Stage</th>
              <th style={thStyle}>FEV1 % Pred.</th>
              <th style={thStyle}>Visit Freq</th>
              <th style={thStyle}>Key Tests</th>
            </tr>
          </thead>
          <tbody>
            {[
              ["GOLD 1", "≥80%", "Annual", "Spirometry, symptom review"],
              ["GOLD 2", "50–79%", "6–12 months", "+ CAT / mMRC"],
              ["GOLD 3", "30–49%", "3–4 months", "+ ABG, SpO2, exacerbation risk, eosinophils"],
              ["GOLD 4", "<30%", "Monthly", "+ Oxygen/NIV reassessment, transplant referral"],
            ].map(([g, fev, freq, tests], i) => (
              <tr key={i}>
                <td style={tdStyle}>{g}</td>
                <td style={tdStyle}>{fev}</td>
                <td style={tdStyle}>{freq}</td>
                <td style={tdStyle}>{tests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>
    </div>
  );
};

// --- Sub-Tab: Exacerbation Log ---
const EMPTY_EXAC = { date: "", severity: "Moderate — outpatient", treatment: "", outcome: "Resolved" };

const ExacerbationLogTab = ({ formData, updateField }) => {
  const exacLog = formData.copd_exac_log || [];
  const [newRow, setNewRow] = useState(EMPTY_EXAC);

  const handleAdd = () => {
    if (!newRow.date) return;
    updateField("copd_exac_log", [...exacLog, { ...newRow, id: Date.now().toString() }]);
    setNewRow(EMPTY_EXAC);
  };

  const handleDelete = (id) => updateField("copd_exac_log", exacLog.filter(r => r.id !== id));

  const inputStyle = { width: "100%", padding: "6px 8px", fontSize: "12px", border: "1px solid #ccc", boxSizing: "border-box", marginTop: "4px" };
  const labelStyle = { fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#888" };

  const severityColor = { "Mild — outpatient": "#2e7d32", "Moderate — outpatient": "#e65100", "Severe — hospitalized": "#d32f2f", "Critical — ICU": "#7b1fa2" };

  return (
    <div>
      <Section title="Exacerbation History Log" note="One row per event">
        <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 2fr 1fr 36px", gap: "8px", padding: "8px 12px", background: "#f5f5f5", borderBottom: "1px solid #e0e0e0" }}>
            {["Date", "Severity", "Treatment Given", "Outcome", ""].map((h, i) => (
              <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>{h}</span>
            ))}
          </div>

          {exacLog.length === 0 ? (
            <div style={{ padding: "18px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
              No exacerbations logged yet. Use the form below to add an event.
            </div>
          ) : exacLog.map((row) => (
            <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 2fr 1fr 36px", gap: "8px", padding: "10px 12px", fontSize: "12px", borderBottom: "1px solid #f0f0f0", alignItems: "center" }}>
              <span style={{ fontWeight: 600 }}>{row.date}</span>
              <span style={{ color: severityColor[row.severity] || "#000", fontWeight: 600 }}>{row.severity}</span>
              <span style={{ color: "#555" }}>{row.treatment}</span>
              <span>{row.outcome}</span>
              <button onClick={() => handleDelete(row.id)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "14px", fontWeight: 700 }}>×</button>
            </div>
          ))}
        </div>

        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
          <h4 style={{ margin: "0 0 12px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#666" }}>+ Log New Exacerbation Event</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 2fr 1fr", gap: "12px", alignItems: "flex-end" }}>
            <div>
              <label style={labelStyle}>Date of Event</label>
              <input type="date" value={newRow.date} onChange={e => setNewRow({ ...newRow, date: e.target.value })} style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Severity</label>
              <select value={newRow.severity} onChange={e => setNewRow({ ...newRow, severity: e.target.value })} style={inputStyle}>
                <option>Mild — outpatient</option>
                <option>Moderate — outpatient</option>
                <option>Severe — hospitalized</option>
                <option>Critical — ICU</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Treatment Given</label>
              <input type="text" value={newRow.treatment} onChange={e => setNewRow({ ...newRow, treatment: e.target.value })} placeholder="e.g. Steroids + antibiotics, nebulisers" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Outcome</label>
              <select value={newRow.outcome} onChange={e => setNewRow({ ...newRow, outcome: e.target.value })} style={inputStyle}>
                <option>Resolved</option>
                <option>Ongoing</option>
                <option>Worsening</option>
              </select>
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
            <button onClick={handleAdd} style={{ padding: "7px 18px", background: "#000", color: "#fff", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Add Event
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};

// --- Main Component ---
const SUB_TABS = [
  { id: "review", label: "Clinical Review" },
  { id: "gold", label: "GOLD Grading" },
  { id: "exac", label: "Exacerbation Log" },
];

const AssessmentTab = ({ historyProps }) => {
  const { formData, updateField } = usePulmonology();
  const allSessions = historyProps?.sessions || [];

  // Exacerbations count: check copd_exac_log, formData.exacerbations_last_year, formData.hx_exac_count, or sessions
  const exacLog = formData.copd_exac_log || [];
  const rawExac = formData.exacerbations_last_year ?? formData.hx_exac_count ?? formData.pulm_exacerbations;
  let resolvedExac = exacLog.length > 0 ? exacLog.length : (rawExac !== undefined && rawExac !== null && rawExac !== "" ? rawExac : null);
  if (resolvedExac === null) {
    for (const s of allSessions) {
      const d = s.data || {};
      if (d.copd_exac_log?.length > 0) {
        resolvedExac = d.copd_exac_log.length;
        break;
      }
      const val = d.exacerbations_last_year ?? d.hx_exac_count ?? d.pulm_exacerbations;
      if (val !== undefined && val !== null && val !== "") {
        resolvedExac = val;
        break;
      }
    }
  }
  const exacNum = parseInt(resolvedExac, 10) || 0;
  const exacDisplay = resolvedExac !== null && resolvedExac !== "0" && exacNum > 0 ? `${resolvedExac}` : (resolvedExac === 0 || resolvedExac === "0" ? "0 (None)" : "None");

  // CAT score: check copd_cat, score_cat, cat
  let resolvedCat = formData.copd_cat || formData.score_cat || formData.cat;
  if (!resolvedCat) {
    for (const s of allSessions) {
      const val = s.data?.copd_cat || s.data?.score_cat || s.data?.cat;
      if (val) {
        resolvedCat = val;
        break;
      }
    }
  }
  const catDisplay = resolvedCat ? `${resolvedCat} / 40` : "—";

  // mMRC: check copd_mmrc, score_mmrc, mon_eff_mmrc, or derive from symptoms
  let resolvedMmrc = formData.copd_mmrc?.split(" — ")[0] || formData.score_mmrc || formData.mon_eff_mmrc;
  if (!resolvedMmrc && formData.pulm_symptoms) {
    const sx = formData.pulm_symptoms;
    const isRest = Array.isArray(sx) ? sx.includes("dyspnea_rest") : !!sx.dyspnea_rest;
    const isExert = Array.isArray(sx) ? sx.includes("dyspnea_exertional") : !!sx.dyspnea_exertional;
    if (isRest) resolvedMmrc = "3";
    else if (isExert) resolvedMmrc = "2";
  }
  if (!resolvedMmrc) {
    for (const s of allSessions) {
      const val = s.data?.copd_mmrc?.split(" — ")[0] || s.data?.score_mmrc || s.data?.mon_eff_mmrc;
      if (val) {
        resolvedMmrc = val;
        break;
      }
    }
  }
  const mmrcDisplay = resolvedMmrc ? `Grade ${resolvedMmrc}` : "—";

  // GOLD Stage
  const rawFev1Pct = formData.pft_fev1_pct || formData.pulm_current_fev1_pct || formData.fev1_percent || formData.fev1_pred;
  let resolvedGoldStage = formData.copd_gold_stage?.split(" (")[0] || formData.calc_gold_stage?.split(" (")[0];
  if (!resolvedGoldStage && rawFev1Pct) {
    resolvedGoldStage = calcGoldStageFromFev1(rawFev1Pct);
  }
  if (!resolvedGoldStage) {
    for (const s of allSessions) {
      const d = s.data || {};
      const val = d.copd_gold_stage?.split(" (")[0] || d.calc_gold_stage?.split(" (")[0];
      if (val) {
        resolvedGoldStage = val;
        break;
      }
      const sFev1 = d.pft_fev1_pct || d.pulm_current_fev1_pct || d.fev1_percent || d.fev1_pred;
      if (sFev1) {
        resolvedGoldStage = calcGoldStageFromFev1(sFev1);
        if (resolvedGoldStage) break;
      }
    }
  }
  const goldDisplay = resolvedGoldStage || "—";

  // Auto-synchronize missing copd_* form fields so child components have pre-selected dropdowns
  React.useEffect(() => {
    if (!formData.copd_gold_stage && resolvedGoldStage) {
      const opt = mapGoldStageToOption(resolvedGoldStage);
      if (opt) updateField("copd_gold_stage", opt);
    }
    if (!formData.copd_mmrc && resolvedMmrc) {
      const opt = mapMmrcToOption(resolvedMmrc);
      if (opt) updateField("copd_mmrc", opt);
    }
    if (!formData.copd_cat && resolvedCat) {
      updateField("copd_cat", String(resolvedCat));
    }
    if (!formData.copd_spo2 && (formData.pulm_baseline_spo2 || formData.pulm_current_spo2)) {
      updateField("copd_spo2", `${formData.pulm_baseline_spo2 || formData.pulm_current_spo2}%`);
    }
    if (!formData.copd_eosinophils) {
      const eosVal = formData.diag_eosinophil_count || formData.blood_eosinophils || formData.lab_eosinophils;
      if (eosVal) updateField("copd_eosinophils", String(eosVal));
    }
    if (!formData.copd_abe_group) {
      const groupFromScreening = formData.calc_gold_group;
      if (groupFromScreening) {
        const g = groupFromScreening.includes("E") ? "E" : groupFromScreening.includes("B") ? "B" : "A";
        updateField("copd_abe_group", g);
      } else if (exacNum >= 2) {
        updateField("copd_abe_group", "E");
      } else if (parseInt(resolvedMmrc, 10) >= 2 || parseInt(resolvedCat, 10) >= 10) {
        updateField("copd_abe_group", "B");
      } else if (resolvedMmrc || resolvedCat) {
        updateField("copd_abe_group", "A");
      }
    }
  }, [
    resolvedGoldStage,
    resolvedMmrc,
    resolvedCat,
    formData.copd_gold_stage,
    formData.copd_mmrc,
    formData.copd_cat,
    formData.copd_spo2,
    formData.copd_eosinophils,
    formData.copd_abe_group,
    formData.calc_gold_group,
    formData.pulm_baseline_spo2,
    formData.pulm_current_spo2,
    formData.diag_eosinophil_count,
    formData.blood_eosinophils,
    formData.lab_eosinophils,
    exacNum,
    updateField,
  ]);

  return (
    <div>
      <VoiceDictationPanel section="Pulmonary Assessment" />

      {/* At-a-Glance Dashboard */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", marginBottom: "16px" }}>
        <DashCard label="GOLD Stage" value={goldDisplay} color={goldDisplay.includes("3") || goldDisplay.includes("4") ? "#d32f2f" : "#000"} />
        <DashCard label="mMRC Dyspnea" value={mmrcDisplay} color={parseInt(resolvedMmrc, 10) >= 3 ? "#d32f2f" : "#000"} />
        <DashCard label="CAT Score" value={catDisplay} color={parseFloat(resolvedCat) >= 20 ? "#d32f2f" : "#000"} />
        <DashCard label="Exacerbations Logged" value={exacDisplay} color={exacNum >= 2 ? "#d32f2f" : "#2e7d32"} />
      </div>

      {/* Vertically Stacked Sections */}
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <ClinicalReviewTab formData={formData} updateField={updateField} historyProps={historyProps} />
        <GoldGradingTab formData={formData} updateField={updateField} />
        <ExacerbationLogTab formData={formData} updateField={updateField} />
      </div>
    </div>
  );
};

export default AssessmentTab;
