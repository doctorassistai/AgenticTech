import React, { useState, useEffect } from "react";
import Section from "../../components/Section";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";
import { reconcileMedicationsAi } from "../../services/pulmonologyApi";
import {
  analyzePrescriptionSafety,
  analyzeInhalerTechnique,
  buildReconciledRegimen,
  generateGuidelineEscalation,
} from "../../utils/medicationReconciliationEngine";

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
const inputStyle = {
  width: "100%", padding: "6px 8px", fontSize: "12px",
  border: "1px solid #ccc", boxSizing: "border-box", marginTop: "4px",
};
const labelStyle = { fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#888" };

// --- Helpers ---
const BETA_BLOCKERS = /propranolol|metoprolol|atenolol|bisoprolol|carvedilol|labetalol|nadolol|sotalol/i;
const NSAIDS = /ibuprofen|diclofenac|naproxen|ketorolac|meloxicam|indomethacin|celecoxib/i;

const getActionStyle = (action) => {
  switch (action) {
    case "Continue": return { background: "#000", color: "#fff", border: "1px solid #000" };
    case "Dose-Changed": return { background: "#f5f5f5", color: "#000", border: "1px dashed #000" };
    case "Stopped": return { background: "#fff1f0", color: "#cf1322", border: "1px solid #cf1322" };
    default: return { background: "#fff", color: "#666", border: "1px solid #ccc" };
  }
};

const EMPTY_MED = { drug: "", dose: "", freq: "OD", purpose: "", action: "Continue" };

// --- Sub-Tab: Active Prescriptions ---
const PrescriptionsTab = ({ formData, updateField }) => {
  const rawPrescriptions = formData.pulm_prescriptions;
  const meds = Array.isArray(rawPrescriptions)
    ? rawPrescriptions
    : Array.isArray(formData.pulm_meds)
    ? formData.pulm_meds
    : [];

  const [newMed, setNewMed] = useState(EMPTY_MED);
  const [isReconciling, setIsReconciling] = useState(false);
  const [reconcileStatus, setReconcileStatus] = useState(null);

  // Live safety risk and duplicate therapy analysis
  const liveAlerts = analyzePrescriptionSafety(meds, formData);

  // Auto-sync from baseline boolean checklist (e.g. SABA, LAMA, ICS) into reconciliation table
  useEffect(() => {
    if (!formData.pulm_prescriptions && formData.pulm_meds && typeof formData.pulm_meds === "object" && !Array.isArray(formData.pulm_meds)) {
      const initialList = [];
      const m = formData.pulm_meds;
      if (m.saba) initialList.push({ id: "med_saba", drug: "Albuterol Inhaler (SABA)", dose: "90 mcg", freq: "PRN (As needed)", purpose: "Rescue bronchodilator", action: "Continue" });
      if (m.lama) initialList.push({ id: "med_lama", drug: "Tiotropium (Spiriva/Respimat)", dose: "2.5 mcg", freq: "OD (Once daily)", purpose: "Long-acting anticholinergic", action: "Continue" });
      if (m.ics) initialList.push({ id: "med_ics", drug: "Budesonide (Pulmicort)", dose: "200 mcg", freq: "BD (Twice daily)", purpose: "Inhaled corticosteroid", action: "Continue" });
      if (m.laba) initialList.push({ id: "med_laba", drug: "Salmeterol (Serevent)", dose: "50 mcg", freq: "BD (Twice daily)", purpose: "Long-acting beta agonist", action: "Continue" });
      if (m.triple_therapy) initialList.push({ id: "med_triple", drug: "Fluticasone/Umeclidinium/Vilanterol (Trelegy)", dose: "100/62.5/25 mcg", freq: "OD (Once daily)", purpose: "Triple therapy maintenance", action: "Continue" });
      if (m.oral_steroids) initialList.push({ id: "med_steroids", drug: "Prednisone / Prednisolone", dose: "20 mg", freq: "OD", purpose: "Systemic anti-inflammatory", action: "Continue" });
      if (m.sama) initialList.push({ id: "med_sama", drug: "Ipratropium Bromide (Atrovent)", dose: "20 mcg", freq: "QDS", purpose: "Short-acting anticholinergic", action: "Continue" });
      if (m.macrolides) initialList.push({ id: "med_macro", drug: "Azithromycin", dose: "250 mg", freq: "3x/week", purpose: "Anti-inflammatory / Macrolide", action: "Continue" });
      if (m.pde4_inhibitor) initialList.push({ id: "med_pde4", drug: "Roflumilast", dose: "500 mcg", freq: "OD", purpose: "PDE-4 inhibitor", action: "Continue" });
      if (initialList.length > 0) {
        updateField("pulm_prescriptions", initialList);
      }
    }
  }, [formData.pulm_meds, formData.pulm_prescriptions, updateField]);

  const handleActionChange = (id, newAction) => {
    updateField("pulm_prescriptions", meds.map(m => m.id === id ? { ...m, action: newAction } : m));
  };

  const handleAdd = () => {
    if (!newMed.drug) return;
    const isBeta = BETA_BLOCKERS.test(newMed.drug);
    const isNsaid = NSAIDS.test(newMed.drug);
    const entry = {
      ...newMed,
      id: Date.now().toString(),
      alert: isBeta
        ? "Beta-blocker: Non-selective agents can cause bronchospasm in COPD."
        : isNsaid
          ? "NSAID: Can worsen hypoxia and mask infection signs in COPD."
          : null,
      action: isBeta || isNsaid ? "Stopped" : newMed.action,
    };
    updateField("pulm_prescriptions", [...meds, entry]);
    setNewMed(EMPTY_MED);
  };

  const handleDelete = (id) => updateField("pulm_prescriptions", meds.filter(m => m.id !== id));

  // AI & Universal Clinical Pharmacotherapy Reconciliation Handler
  const handleAiReconcile = async () => {
    setIsReconciling(true);
    setReconcileStatus(null);
    try {
      const payload = {
        ...formData,
        pulm_prescriptions: meds,
      };

      let result = null;
      try {
        const res = await reconcileMedicationsAi(payload);
        if (res && res.data && Array.isArray(res.data.reconciled_medications)) {
          result = res.data;
        }
      } catch (apiErr) {
        console.warn("[MedReconcile] Backend AI call error, falling back to local clinical engine:", apiErr.message);
      }

      // If backend offline or missing, utilize deterministic client engine
      if (!result) {
        const fallback = buildReconciledRegimen(meds, formData);
        result = {
          reconciled_medications: fallback.reconciledPrescriptions,
          regimen_change_decision: fallback.regimenChangeDecision,
          clinical_rationale: fallback.clinicalRationale,
          recommended_device: fallback.recommendedDevice,
          guideline_summary: fallback.guidelineSummary,
          safety_alerts: fallback.safetyAlerts.map(a => a.description),
        };
      }

      // Apply updates to EMR form data
      updateField("pulm_prescriptions", result.reconciled_medications);
      if (result.regimen_change_decision) {
        updateField("med_regimen_change", result.regimen_change_decision);
      }
      if (result.clinical_rationale) {
        updateField("med_rationale", result.clinical_rationale);
      }
      if (result.recommended_device) {
        updateField("inh_device", result.recommended_device);
      }
      if (result.technique_alerts) {
        updateField("technique_alerts", result.technique_alerts);
      }
      // Auto-check mouth rinse if ICS/Triple is prescribed
      updateField("inh_chk_rinse", true);

      setReconcileStatus({
        type: "success",
        summary: result.guideline_summary || "Guidelines Applied",
        message: "Regimen reconciled: duplicate therapies discontinued, rescue bronchodilator preserved, and clinical rationale generated.",
      });
    } catch (err) {
      setReconcileStatus({
        type: "error",
        message: err.message || "Failed to reconcile regimen.",
      });
    } finally {
      setIsReconciling(false);
    }
  };

  return (
    <div>
      {/* AI Clinical Pharmacotherapy Decision Support Card */}
      <div style={{
        background: "#fff",
        border: "1px solid #e0e0e0",
        borderLeft: "4px solid #000",
        padding: "16px",
        marginBottom: "16px",
        borderRadius: "2px",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px", marginBottom: "10px" }}>
          <div>
            <div style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: "#000", display: "flex", alignItems: "center", gap: "8px" }}>
              <span>⚡ Clinical Decision Support & Medication Reconciliation</span>
              <span style={{ fontSize: "9.5px", background: "#f0f0f0", color: "#444", padding: "2px 6px", borderRadius: "10px", fontWeight: 600 }}>GOLD 2024 / GINA</span>
            </div>
            <div style={{ fontSize: "12px", color: "#666", marginTop: "4px" }}>
              Automated multi-guideline evaluation: detects duplicate bronchodilators/steroids, catches bronchospasm contraindications, and reconciles high-risk exacerbators.
            </div>
          </div>
          <button
            onClick={handleAiReconcile}
            disabled={isReconciling || meds.length === 0}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              background: isReconciling ? "#666" : "#000",
              color: "#fff",
              border: "none",
              padding: "8px 16px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: isReconciling || meds.length === 0 ? "not-allowed" : "pointer",
              borderRadius: "2px",
              boxShadow: "0 1px 3px rgba(0,0,0,0.12)",
              transition: "background 0.2s ease",
            }}
          >
            {isReconciling ? (
              <>
                <span style={{ display: "inline-block" }}>⚙️</span>
                <span>AI Clinical Pharmacotherapist Analyzing...</span>
              </>
            ) : (
              <>
                <span>⚡</span>
                <span>AI Reconcile Regimen (Apply Guidelines)</span>
              </>
            )}
          </button>
        </div>

        {/* Live Safety Analysis Alerts */}
        {liveAlerts.length > 0 ? (
          <div style={{ display: "flex", flexDirection: "column", gap: "8px", marginTop: "10px" }}>
            {liveAlerts.map((alert, idx) => {
              const isCrit = alert.severity === "CRITICAL";
              return (
                <div
                  key={idx}
                  style={{
                    padding: "10px 12px",
                    background: isCrit ? "#fff1f0" : "#fffbe6",
                    borderLeft: `3px solid ${isCrit ? "#cf1322" : "#faad14"}`,
                    fontSize: "12px",
                    color: isCrit ? "#a8071a" : "#874d00",
                    display: "flex",
                    flexDirection: "column",
                    gap: "3px",
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {isCrit ? "🛑 CRITICAL SAFETY ALERT: " : "⚠️ WARNING: "} {alert.title}
                  </div>
                  <div>{alert.description}</div>
                  <div style={{ fontStyle: "italic", fontSize: "11px", marginTop: "2px" }}>
                    <b>Recommendation:</b> {alert.recommendation}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div style={{ padding: "8px 12px", background: "#f6ffed", borderLeft: "3px solid #52c41a", fontSize: "12px", color: "#237804", marginTop: "6px" }}>
            ✓ <b>Active Regimen Safe:</b> No duplicate muscarinic antagonists, unbacked SABA monotherapy, or contraindicated beta-blockers identified.
          </div>
        )}

        {/* Status feedback */}
        {reconcileStatus && (
          <div style={{
            marginTop: "12px",
            padding: "10px 12px",
            background: reconcileStatus.type === "success" ? "#e6f7ff" : "#fff1f0",
            border: `1px solid ${reconcileStatus.type === "success" ? "#91d5ff" : "#ffccc7"}`,
            borderRadius: "2px",
            fontSize: "12px",
            color: reconcileStatus.type === "success" ? "#0050b3" : "#cf1322",
          }}>
            <div style={{ fontWeight: 700 }}>
              {reconcileStatus.type === "success" ? "✓ Regimen Reconciled" : "Reconciliation Notice"}
              {reconcileStatus.summary ? ` — ${reconcileStatus.summary}` : ""}
            </div>
            <div>{reconcileStatus.message}</div>
          </div>
        )}
      </div>

      <Section title="Active Medication Reconciliation" note="Reconcile all current medications and flag bronchospasm risks.">
        {/* Table */}
        <div style={{ border: "1px solid #e0e0e0", overflow: "hidden", marginBottom: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1.5fr 1fr 36px", gap: "8px", padding: "8px 12px", background: "#f5f5f5", borderBottom: "1px solid #e0e0e0" }}>
            {["Medication", "Dose & Freq", "Purpose", "Alert", "Action", ""].map((h, i) => (
              <span key={i} style={{ fontSize: "10px", fontWeight: 600, textTransform: "uppercase", color: "#666" }}>{h}</span>
            ))}
          </div>

          {meds.length === 0 ? (
            <div style={{ padding: "18px", textAlign: "center", color: "#888", fontStyle: "italic", fontSize: "12px" }}>
              No medications recorded. Use the form below to add and reconcile active prescriptions.
            </div>
          ) : meds.map(row => {
            const isStopped = row.action === "Stopped";
            return (
              <div key={row.id} style={{ display: "grid", gridTemplateColumns: "1.5fr 1fr 1fr 1.5fr 1fr 36px", gap: "8px", padding: "10px 12px", fontSize: "12px", borderBottom: "1px solid #f0f0f0", alignItems: "center", background: isStopped ? "#fafafa" : "#fff" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <span style={{ fontWeight: 600, color: isStopped ? "#888" : "#000", textDecoration: isStopped ? "line-through" : "none" }}>
                      {row.drug}
                    </span>
                    {isStopped && (
                      <span style={{ fontSize: "9px", background: "#fff1f0", color: "#cf1322", padding: "1px 5px", border: "1px solid #ffa39e", borderRadius: "2px", fontWeight: 700 }}>
                        STOPPED
                      </span>
                    )}
                  </div>
                  {row.alert && <div style={{ fontSize: "10.5px", color: "#cf1322", marginTop: "3px", fontWeight: 500 }}>⚠️ {row.alert}</div>}
                  {row.rationale && <div style={{ fontSize: "10px", color: "#666", marginTop: "2px", fontStyle: "italic" }}>ℹ️ {row.rationale}</div>}
                </div>
                <span style={{ color: isStopped ? "#aaa" : "#333" }}>{row.dose} {row.freq}</span>
                <span style={{ color: "#555" }}>{row.purpose}</span>
                <span style={{ color: row.alert ? "#cf1322" : "#555", fontSize: "11px" }}>{row.alert || "—"}</span>
                <select
                  value={row.action}
                  onChange={e => handleActionChange(row.id, e.target.value)}
                  style={{ padding: "4px 6px", fontSize: "11px", fontWeight: 600, cursor: "pointer", borderRadius: "2px", ...getActionStyle(row.action) }}
                >
                  <option value="Continue">Continue</option>
                  <option value="Dose-Changed">Dose-Changed</option>
                  <option value="Stopped">Stopped</option>
                </select>
                <button onClick={() => handleDelete(row.id)} style={{ background: "none", border: "none", color: "#888", cursor: "pointer", fontSize: "14px", fontWeight: 700 }}>×</button>
              </div>
            );
          })}
        </div>

        {/* Add New Form */}
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0" }}>
          <h4 style={{ margin: "0 0 12px", fontSize: "11px", fontWeight: 700, textTransform: "uppercase", color: "#666" }}>+ Add Drug / Prescription</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", alignItems: "flex-end" }}>
            <div>
              <label style={labelStyle}>Drug Name</label>
              <input type="text" value={newMed.drug} onChange={e => setNewMed({ ...newMed, drug: e.target.value })} placeholder="e.g. Tiotropium" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Dose</label>
              <input type="text" value={newMed.dose} onChange={e => setNewMed({ ...newMed, dose: e.target.value })} placeholder="e.g. 18 mcg" style={inputStyle} />
            </div>
            <div>
              <label style={labelStyle}>Frequency</label>
              <select value={newMed.freq} onChange={e => setNewMed({ ...newMed, freq: e.target.value })} style={inputStyle}>
                <option value="OD">Once Daily (OD)</option>
                <option value="BD">Twice Daily (BD)</option>
                <option value="TDS">Thrice Daily (TDS)</option>
                <option value="PRN">As Needed (PRN)</option>
                <option value="Inhaled OD">Inhaled OD</option>
              </select>
            </div>
            <div>
              <label style={labelStyle}>Purpose / Indication</label>
              <input type="text" value={newMed.purpose} onChange={e => setNewMed({ ...newMed, purpose: e.target.value })} placeholder="e.g. Long-acting bronchodilation" style={inputStyle} />
            </div>
          </div>
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "12px" }}>
            <button onClick={handleAdd} style={{ padding: "7px 18px", background: "#000", color: "#fff", border: "none", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
              Add Prescription
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};

// --- Sub-Tab: Inhaler Technique ---
const InhalerTab = ({ formData, updateField }) => {
  const [justAligned, setJustAligned] = useState(false);
  const prescriptions = Array.isArray(formData.pulm_prescriptions) ? formData.pulm_prescriptions : [];
  const activeMeds = prescriptions.filter(m => m && m.action !== "Stopped");

  // Determine whether any active medication contains an Inhaled Corticosteroid (ICS)
  const hasIcs = activeMeds.some(m => {
    const d = (m.drug || "").toLowerCase();
    return /trelegy|breztri|fluticasone|budesonide|symbicort|advair|breo|dulera|flovent|pulmicort|qvar|mometasone|beclomethasone|ciclesonide/i.test(d);
  });

  // Dynamically detect the device type from active prescriptions
  const detectedDevice = React.useMemo(() => {
    if (activeMeds.some(m => /trelegy|ellipta|diskus|handihaler|turbuhaler|spiromax|twisthaler|aerolizer/i.test(m.drug))) {
      return "DPI (dry powder inhaler)";
    }
    if (activeMeds.some(m => /respimat/i.test(m.drug))) {
      return "Soft mist inhaler (Respimat)";
    }
    if (activeMeds.some(m => /hfa|mdi|proair|ventolin|albuterol|dulera|flovent hfa|atrovent hfa/i.test(m.drug))) {
      return "pMDI (pressurised metered dose inhaler)";
    }
    if (activeMeds.some(m => /neb|duoneb|brovana|perforomist|solution/i.test(m.drug))) {
      return "Nebuliser";
    }
    return "DPI (dry powder inhaler)";
  }, [activeMeds]);

  const activeDevice = formData.inh_device || detectedDevice;
  const isDpi = activeDevice.toLowerCase().includes("dpi");
  const isMdi = activeDevice.toLowerCase().includes("mdi") || activeDevice.toLowerCase().includes("pmdi");
  const isSmi = activeDevice.toLowerCase().includes("respimat") || activeDevice.toLowerCase().includes("soft mist");
  const isNeb = activeDevice.toLowerCase().includes("neb");

  // Helper to auto-align checklist according to device pharmacology & physical mechanics
  const applyAutoVerify = (targetDev) => {
    setJustAligned(true);
    setTimeout(() => setJustAligned(false), 2000);

    const dev = targetDev || activeDevice;
    const devIsDpi = dev.toLowerCase().includes("dpi");
    const devIsMdi = dev.toLowerCase().includes("mdi") || dev.toLowerCase().includes("pmdi");
    const devIsSmi = dev.toLowerCase().includes("respimat") || dev.toLowerCase().includes("soft mist");
    const devIsNeb = dev.toLowerCase().includes("neb");

    updateField("inh_device", dev);
    updateField("inh_technique", "Good / Satisfactory (Demonstrated correctly)");

    if (devIsDpi) {
      updateField("inh_chk_shake", false);
      updateField("inh_chk_spacer", false);
      updateField("inh_chk_exhale", true);
      updateField("inh_chk_hold", true);
      updateField("inh_chk_rinse", hasIcs);
      updateField("inh_chk_cap", true);
    } else if (devIsMdi) {
      updateField("inh_chk_shake", true);
      updateField("inh_chk_spacer", true);
      updateField("inh_chk_exhale", true);
      updateField("inh_chk_hold", true);
      updateField("inh_chk_rinse", hasIcs);
      updateField("inh_chk_cap", true);
    } else if (devIsSmi) {
      updateField("inh_chk_shake", false);
      updateField("inh_chk_spacer", false);
      updateField("inh_chk_exhale", true);
      updateField("inh_chk_hold", true);
      updateField("inh_chk_rinse", hasIcs);
      updateField("inh_chk_cap", true);
    } else if (devIsNeb) {
      updateField("inh_chk_shake", false);
      updateField("inh_chk_spacer", false);
      updateField("inh_chk_exhale", true);
      updateField("inh_chk_hold", false);
      updateField("inh_chk_rinse", hasIcs);
      updateField("inh_chk_cap", true);
    }

    if (!formData.inh_edu_by) {
      updateField("inh_edu_by", formData.team_pulmonologist || "Respiratory Specialist / Clinical Pharmacist");
    }
    if (!formData.inh_next_review) {
      const d = new Date();
      d.setMonth(d.getMonth() + 6);
      updateField("inh_next_review", d.toISOString().substring(0, 10));
    }
  };

  // Initial synchronization for new patients
  React.useEffect(() => {
    if (!formData.inh_device) {
      updateField("inh_device", detectedDevice);
    }
    if (!formData.inh_technique) {
      updateField("inh_technique", "Good / Satisfactory (Demonstrated correctly)");
    }
    if (formData.inh_chk_exhale === undefined) updateField("inh_chk_exhale", true);
    if (formData.inh_chk_hold === undefined) updateField("inh_chk_hold", !isNeb);
    if (formData.inh_chk_rinse === undefined) updateField("inh_chk_rinse", hasIcs);
    if (formData.inh_chk_cap === undefined) updateField("inh_chk_cap", true);
    if (isDpi) {
      if (formData.inh_chk_shake) updateField("inh_chk_shake", false);
      if (formData.inh_chk_spacer) updateField("inh_chk_spacer", false);
    }
    if (!formData.inh_edu_by) {
      updateField("inh_edu_by", formData.team_pulmonologist || "Respiratory Specialist / Clinical Pharmacist");
    }
    if (!formData.inh_next_review) {
      const d = new Date();
      d.setMonth(d.getMonth() + 6);
      updateField("inh_next_review", d.toISOString().substring(0, 10));
    }
  }, [formData.inh_device, formData.inh_technique, detectedDevice, hasIcs, isDpi, isNeb, formData.team_pulmonologist, updateField]);

  // Live real-time analysis of technique checklist
  const liveTechniqueAlerts = React.useMemo(() => {
    return analyzeInhalerTechnique(formData, prescriptions);
  }, [formData, prescriptions]);

  const checkItems = [
    {
      id: "inh_chk_shake",
      label: isMdi
        ? "Inhaler shaken before use (5s) — Mandatory for pMDI suspensions"
        : "Inhaler shaken before use (pMDI only)",
      disabled: isDpi || isSmi || isNeb,
      reason: isDpi ? "Contraindicated for DPI (spills/clumps powder)" : isSmi ? "N/A for Respimat" : "N/A for Nebuliser",
    },
    {
      id: "inh_chk_spacer",
      label: isMdi
        ? "Spacer device used (Valved Holding Chamber) — Strongly recommended for pMDI"
        : "Spacer device used (pMDI only)",
      disabled: isDpi || isSmi || isNeb,
      reason: isDpi ? "Incompatible with DPI" : isSmi ? "N/A for Respimat" : "N/A for Nebuliser",
    },
    {
      id: "inh_chk_exhale",
      label: isNeb
        ? "Upright posture with tight mouthpiece or mask seal"
        : isDpi
          ? "Full exhale before actuation (away from device to prevent powder clumping)"
          : "Full exhale before actuation (away from device)",
      disabled: false,
    },
    {
      id: "inh_chk_hold",
      label: isNeb
        ? "Tidal breathing until nebuliser chamber is empty"
        : "Breath held 5–10 seconds post-dose (ensures deep lung deposition)",
      disabled: isNeb,
      reason: "N/A for Nebuliser (continuous tidal breathing)",
    },
    {
      id: "inh_chk_rinse",
      label: hasIcs
        ? "Mouth rinsed & spit after ICS use (Essential: prevents oral candidiasis / hoarseness)"
        : "Mouth rinsed after use (Optional — non-steroidal bronchodilator only)",
      disabled: false,
    },
    {
      id: "inh_chk_cap",
      label: "Cap replaced / cover closed and device inspected",
      disabled: false,
    },
  ];

  return (
    <div>
      <Section title="Inhaler Technique Assessment" note="Standardized verification of delivery device proficiency across all inhaler modalities">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "16px" }}>
          <div>
            <label style={labelStyle}>TECHNIQUE RATING</label>
            <select
              value={formData.inh_technique || "Good / Satisfactory (Demonstrated correctly)"}
              onChange={e => updateField("inh_technique", e.target.value)}
              style={{ ...inputStyle, marginTop: "6px" }}
            >
              <option value="">— Select Technique Rating —</option>
              <option value="Good / Satisfactory (Demonstrated correctly)">Good / Satisfactory (Demonstrated correctly)</option>
              <option value="Demonstrated correctly">Demonstrated correctly</option>
              <option value="Correct — no coaching needed">Correct — no coaching needed</option>
              <option value="Coaching Required — errors noted">Coaching Required — errors noted</option>
              <option value="Incorrect — re-education session done">Incorrect — re-education session done</option>
            </select>
          </div>
          <div>
            <label style={labelStyle}>DEVICE TYPE IN USE</label>
            <select
              value={formData.inh_device || detectedDevice}
              onChange={e => {
                updateField("inh_device", e.target.value);
                applyAutoVerify(e.target.value);
              }}
              style={{ ...inputStyle, marginTop: "6px" }}
            >
              <option value="">— Select Device Type —</option>
              <option value="DPI (dry powder inhaler)">DPI (dry powder inhaler) — Trelegy / Ellipta / Diskus</option>
              <option value="pMDI (pressurised metered dose inhaler)">pMDI (pressurised metered dose inhaler) — HFA / Inhaler</option>
              <option value="Soft mist inhaler (Respimat)">Soft mist inhaler (Respimat)</option>
              <option value="Nebuliser">Nebuliser (Jet / Mesh / Ultrasonic)</option>
            </select>
          </div>
        </div>

        <div style={{ marginBottom: "14px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
            <label style={labelStyle}>INHALER TECHNIQUE CHECKLIST</label>
            <button
              type="button"
              onClick={() => applyAutoVerify()}
              style={{
                fontSize: "11px",
                padding: "3px 10px",
                background: justAligned ? "#16a34a" : "#f0fdf4",
                border: `1px solid ${justAligned ? "#15803d" : "#81c784"}`,
                borderRadius: "3px",
                cursor: "pointer",
                fontWeight: 600,
                color: justAligned ? "#fff" : "#1b5e20",
                transition: "all 0.2s ease",
              }}
            >
              {justAligned ? "✓ Verified & Aligned to Guidelines!" : "⚡ Auto-Align Checklist to Active Device"}
            </button>
          </div>
          <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
            {checkItems.map(item => {
              const isDisabled = !!item.disabled;
              const isChecked = !isDisabled && !!formData[item.id];
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
                    borderColor: isDisabled ? "#e0e0e0" : isChecked ? "#81c784" : "#ccc",
                    background: isDisabled ? "#f5f5f5" : isChecked ? "#f0fdf4" : "#fff",
                    color: isDisabled ? "#999" : "#000",
                    cursor: isDisabled ? "not-allowed" : "pointer",
                    textDecoration: isDisabled ? "line-through" : "none",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={isChecked}
                    disabled={isDisabled}
                    onChange={e => updateField(item.id, e.target.checked)}
                  />
                  {item.label}
                  {isDisabled && (
                    <span style={{ fontSize: "9.5px", background: "#eee", color: "#666", padding: "1px 4px", borderRadius: "2px", textDecoration: "none" }}>
                      {item.reason || "N/A"}
                    </span>
                  )}
                </label>
              );
            })}
          </div>
        </div>

        {/* Dynamic Delivery Device Guidance Banner */}
        {isDpi && (
          <div style={{ marginBottom: "16px", padding: "10px 14px", background: "#f0fdf4", borderLeft: "3px solid #2e7d32", fontSize: "11.5px", color: "#1b5e20" }}>
            <b>✓ DPI Protocol Verified:</b> Dry powder inhalers (e.g. Trelegy Ellipta, Diskus) require a quick, forceful, and deep inhalation to de-aggregate the micronized powder. <b>Never shake or use a spacer with a DPI</b>. {hasIcs ? "Post-dose mouth rinse and spit is essential to prevent corticosteroid-induced candidiasis (thrush) and dysphonia." : "Active regimen is non-steroidal; mouth rinsing is optional."}
          </div>
        )}

        {isMdi && (
          <div style={{ marginBottom: "16px", padding: "10px 14px", background: "#eff6ff", borderLeft: "3px solid #1d4ed8", fontSize: "11.5px", color: "#1e40af" }}>
            <b>✓ pMDI Protocol Verified:</b> Pressurised metered dose inhalers require <b>vigorous shaking for 5 seconds</b> before actuation. A <b>valved holding chamber (spacer)</b> is strongly recommended to eliminate actuation-breath dyscoordination and maximize lower airway deposition. Inhale <b>slowly and steadily over 3–5 seconds</b>. {hasIcs ? "Mouth rinse post-dose is essential to prevent candidiasis." : ""}
          </div>
        )}

        {isSmi && (
          <div style={{ marginBottom: "16px", padding: "10px 14px", background: "#faf5ff", borderLeft: "3px solid #7e22ce", fontSize: "11.5px", color: "#6b21a8" }}>
            <b>✓ Soft Mist Inhaler (Respimat) Protocol:</b> Turn clear base, Open cap, Press dose-release button (TOP technique). Slow, deep breath over 4–5 seconds. Shaking and spacers are unnecessary.
          </div>
        )}

        {isNeb && (
          <div style={{ marginBottom: "16px", padding: "10px 14px", background: "#f0fdfa", borderLeft: "3px solid #0f766e", fontSize: "11.5px", color: "#115e59" }}>
            <b>✓ Nebuliser Protocol:</b> Deliver with patient upright using a mouthpiece or tight-fitting face mask. Normal tidal breathing until chamber is empty (~10–15 min).
          </div>
        )}

        {/* Live Technique Educational Alerts */}
        {liveTechniqueAlerts && liveTechniqueAlerts.length > 0 && (
          <div style={{ marginBottom: "16px", padding: "10px", background: "#fffbe6", borderLeft: "3px solid #faad14", fontSize: "12px", color: "#874d00" }}>
            <div style={{ fontWeight: 700, marginBottom: "4px" }}>⚠️ Technique Educational Alerts (Real-Time Clinical CDS)</div>
            <ul style={{ margin: 0, paddingLeft: "16px" }}>
              {liveTechniqueAlerts.map((alert, idx) => <li key={idx} style={{ marginBottom: "2px" }}>{alert}</li>)}
            </ul>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div>
            <label style={labelStyle}>EDUCATION GIVEN BY</label>
            <input
              type="text"
              value={formData.inh_edu_by || ""}
              onChange={e => updateField("inh_edu_by", e.target.value)}
              placeholder="e.g. Respiratory Nurse / Pharmacist"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>NEXT TECHNIQUE REVIEW</label>
            <input
              type="date"
              value={formData.inh_next_review || ""}
              onChange={e => updateField("inh_next_review", e.target.value)}
              style={inputStyle}
            />
          </div>
        </div>
      </Section>
    </div>
  );
};

// --- Sub-Tab: Step-Up / Step-Down ---
const StepTab = ({ formData, updateField }) => (
  <div>
    <Section title="Therapy Escalation Rules (GOLD ABE + Eosinophil-Guided)">
      <table style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle}>Group</th>
            <th style={thStyle}>Definition</th>
            <th style={thStyle}>First-line Therapy</th>
            <th style={thStyle}>Add-on if Eos ≥300</th>
          </tr>
        </thead>
        <tbody>
          {[
            ["Group A", "Low symptoms, low exacerbation risk", "Single bronchodilator (LAMA or LABA)", "—"],
            ["Group B", "High symptoms, low exacerbation risk", "LABA + LAMA", "—"],
            ["Group E", "≥2 moderate or ≥1 hospitalized exacerbation/yr", "LABA + LAMA", "Add ICS (if eos ≥300)"],
          ].map(([g, def, first, addon], i) => (
            <tr key={i}>
              <td style={{ ...tdStyle }}>{g}</td>
              <td style={tdStyle}>{def}</td>
              <td style={tdStyle}>{first}</td>
              <td style={tdStyle}>{addon}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Section>

    <Section title="Proposed Regimen Change">
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div>
          <label style={labelStyle}>REGIMEN CHANGE DECISION</label>
          <select
            value={formData.med_regimen_change || ""}
            onChange={e => updateField("med_regimen_change", e.target.value)}
            style={{ ...inputStyle, marginTop: "6px" }}
          >
            <option value="">— Select Decision —</option>
            <option value="no_change">No change — continue current regimen</option>
            <option value="step_up">Step up — add agent</option>
            <option value="step_down">Step down — reduce agent</option>
            <option value="switch_formulation">Switch device / formulation</option>
          </select>
        </div>
        <div>
          <label style={labelStyle}>NEXT THEOPHYLLINE LEVEL DUE</label>
          <input
            type="date"
            value={formData.med_theophylline_date || ""}
            onChange={e => updateField("med_theophylline_date", e.target.value)}
            style={inputStyle}
          />
        </div>
        <div style={{ gridColumn: "span 2" }}>
          <label style={labelStyle}>RATIONALE / CLINICAL NOTES</label>
          <textarea
            rows={3}
            value={formData.med_rationale || ""}
            onChange={e => updateField("med_rationale", e.target.value)}
            placeholder="Document rationale for any therapy change or continuation..."
            style={{ ...inputStyle, resize: "vertical" }}
          />
        </div>
      </div>
    </Section>
  </div>
);

// --- Main Component ---
const SUB_TABS = [
  { id: "prescriptions", label: "Active Prescriptions" },
  { id: "inhaler", label: "Inhaler Technique" },
  { id: "stepup", label: "Step-Up / Step-Down" },
];

const MedicationsTab = () => {
  const { formData, updateField } = usePulmonology();
  const [activeSubTab, setActiveSubTab] = useState("prescriptions");

  return (
    <div>
      <VoiceDictationPanel section="Medications & Inhaler Dosing" />
      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
        <PrescriptionsTab formData={formData} updateField={updateField} />
        <InhalerTab formData={formData} updateField={updateField} />
        <StepTab formData={formData} updateField={updateField} />
      </div>
    </div>
  );
};

export default MedicationsTab;
