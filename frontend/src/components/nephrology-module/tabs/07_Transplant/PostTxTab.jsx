import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { TX_DICTATION_FIELDS } from "../../components/txDictation";
import { generateTxPostRejection, generateTxPostSurvival } from "../../services/nephrologyApi";
import TransplantEncounterHistory from "../../components/TransplantEncounterHistory";

const TransplantOperativeSummary = ({ historicalSessions, formData }) => {
  // 1. Check if procedure data is available in the active session's formData
  const activeTxData =
    formData?.tx_donor_source ||
    formData?.tx_implant_site ||
    formData?.tx_cit ||
    formData?.tx_reperfusion_eval ||
    formData?.proc_category === "transplant" ||
    formData?.proc_type?.startsWith("tx")
      ? formData
      : null;

  // 2. Check historical sessions
  const txSessions = (historicalSessions || []).filter(
    (s) =>
      (s.track === "transplant" || s.track === "procedures") &&
      (s.data?.tx_implant_site ||
        s.data?.tx_donor_source ||
        s.data?.tx_cit ||
        s.data?.tx_reperfusion_eval ||
        s.tab?.startsWith("tx") ||
        s.tab === "transplant")
  );

  const latestSession = txSessions.length > 0
    ? [...txSessions].sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0))[0]
    : null;

  const d = activeTxData || latestSession?.data;
  if (!d) return null;

  const sxDate = d.proc_date || d.v2_tx_surgery_date || (latestSession?.created_at ? new Date(latestSession.created_at).toLocaleDateString() : "");
  const donorSource = d.tx_donor_source || "Documented in operative note";
  const hla = d.tx_hla_match || "—";
  const cit = d.tx_cit ? `${d.tx_cit}h` : "—";
  const wit = d.tx_wit ? `${d.tx_wit}m` : "—";
  const perfusion = d.tx_reperfusion_eval ? d.tx_reperfusion_eval.split(":")[0] : "Good";
  const zeroHour = d.tx_zero_hour_bx ? d.tx_zero_hour_bx.split("(")[0] : "—";

  return (
    <div style={{ marginBottom: "18px", border: "1px solid #16a34a", borderRadius: "4px", overflow: "hidden" }}>
      <div style={{ background: "#f0fdf4", padding: "8px 14px", fontSize: "12px", fontWeight: 700, color: "#15803d", borderBottom: "1px solid #dcfce7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>KIDNEY TRANSPLANT OPERATIVE RECORD SUMMARY</span>
        {sxDate && <span style={{ fontWeight: 500, fontSize: "11px", color: "#166534" }}>Surgery Date: {sxDate}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", padding: "12px 14px", background: "#ffffff", fontSize: "12px" }}>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Donor Source & Match</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{donorSource.split("(")[0]} {hla !== "—" ? `(${hla.split(" ")[0]})` : ""}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Ischemia Clocks (CIT / WIT)</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>CIT: {cit} | WIT: {wit}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Re-perfusion Quality</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#15803d" }}>{perfusion}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Baseline Biopsy</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{zeroHour}</div>
        </div>
      </div>
    </div>
  );
};

const PostTxTab = ({ historyProps }) => {
  const { formData, updateField, historicalSessions } = useNephrology();

  // Auto-sync procedure data into PostTxTab form inputs if not already set
  React.useEffect(() => {
    const pDate = formData.proc_date;
    if (pDate && !formData.v2_tx_surgery_date) {
      updateField("v2_tx_surgery_date", pDate);
    }
    const pCr = formData.tx_post_cr;
    if (pCr && !formData.v2_post_cr) {
      const crNum = String(pCr).match(/(\d+(?:\.\d+)?)/);
      if (crNum) updateField("v2_post_cr", crNum[1]);
    }
    const pUrine = formData.tx_urine_on_declamp || "";
    if (pUrine && !formData.v2_post_dgf) {
      if (pUrine.toLowerCase().includes("robust") || pUrine.toLowerCase().includes("immediate") || pUrine.toLowerCase().includes(">300")) {
        updateField("v2_post_dgf", "Immediate Graft Function");
      } else if (pUrine.toLowerCase().includes("delayed") || pUrine.toLowerCase().includes("oliguric")) {
        updateField("v2_post_dgf", "Delayed Graft Function (DGF)");
      }
    }
  }, [formData.proc_date, formData.tx_post_cr, formData.tx_urine_on_declamp, formData.v2_tx_surgery_date, formData.v2_post_cr, formData.v2_post_dgf, updateField]);

  const [isGeneratingRejection, setIsGeneratingRejection] = useState(false);
  const [isGeneratingSurvival, setIsGeneratingSurvival] = useState(false);

  const handleGenerate = async (apiFunc, setLoader) => {
    setLoader(true);
    try {
      const res = await apiFunc(formData);
      if (res?.data) {
        Object.entries(res.data).forEach(([k, v]) => updateField(k, v));
      }
    } catch (err) {
      console.warn("LLM generation failed:", err.message);
    } finally {
      setLoader(false);
    }
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Post-Transplant Surveillance" fields={TX_DICTATION_FIELDS} transformStructuredValues={({ values }) => values} />
      <Section title="Graft Function & Monitoring Schedule" note="Tracking allograft survival and protocol adherence." historyProps={historyProps} historyKeys={["v2_post_cr", "v2_post_egfr", "v2_post_dgf", "v2_post_proto_bx"]}>
        <TransplantEncounterHistory {...historyProps} section="post_graft" />
        <TransplantOperativeSummary historicalSessions={historicalSessions} formData={formData} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Graft Function Tracking</h4>
            <FormField label="Transplant Surgery Date" name="v2_tx_surgery_date" type="date" />
            <FormField label="Current Serum Creatinine (mg/dL)" name="v2_post_cr" type="number" />
            <FormField label="Current eGFR" name="v2_post_egfr" type="number" />
            <FormField label="Baseline Creatinine Established?" name="v2_post_base_cr" type="select" options={["", "Yes", "Pending (First 3 months)"]} />
            <FormField label="Graft Function Classification" name="v2_post_dgf" type="select" options={["", "Immediate Graft Function", "Delayed Graft Function (DGF)", "Slow Graft Function"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Routine Monitoring</h4>
            <FormField label="Monitoring Phase" name="v2_post_phase" type="select" options={["", "Intensive (<3 months)", "Intermediate (3-6 months)", "Long-term Maintenance"]} />
            <FormField label="Urine UACR & Microscopy" name="v2_post_urine" type="textarea" placeholder="Record proteinuria/hematuria..." />
            <FormField label="Protocol Biopsy Status (3mo / 12mo)" name="v2_post_proto_bx" type="select" options={["", "Not Indicated", "Pending", "Completed"]} />
          </div>
        </div>
      </Section>

      <Section title="Immunosuppression Management" note="Drug levels and adverse effect tracking." historyProps={historyProps} historyKeys={["v2_post_cni", "v2_post_cni_level", "v2_post_antimetab", "v2_post_steroid"]}>
        <TransplantEncounterHistory {...historyProps} section="post_immuno" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Maintenance Therapy</h4>
            <FormField label="Calcineurin Inhibitor (CNI)" name="v2_post_cni" type="select" options={["", "Tacrolimus", "Cyclosporine", "None"]} />
            <FormField label="CNI Trough Level (Target 5-10 ng/mL)" name="v2_post_cni_level" type="number" />
            <FormField label="Antimetabolite" name="v2_post_antimetab" type="select" options={["", "Mycophenolate", "Azathioprine", "None"]} />
            <FormField label="Steroid Maintenance" name="v2_post_steroid" type="select" options={["", "Prednisone Active", "Steroid Avoidance/Withdrawal"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Adverse Effects</h4>
            <FormField label="Drug Interactions / Toxicity" name="v2_post_toxicity" type="textarea" placeholder="Flag CNI metabolism interactions or nephrotoxicity..." />
            <FormField label="New-Onset Diabetes After Transplant (NODAT)" name="v2_post_nodat" type="select" options={["", "Negative", "Screening Due", "Positive"]} />
            <FormField label="Other Effects (Tremor, GI)" name="v2_post_ae_other" type="textarea" placeholder="List active symptoms..." />
          </div>
        </div>
      </Section>

      <Section title="Infectious Complication Monitoring" note="Surveillance for opportunistic infections post-transplant." historyProps={historyProps} historyKeys={["v2_post_inf_cmv", "v2_post_inf_bkv", "v2_post_inf_proph"]}>
        <TransplantEncounterHistory {...historyProps} section="post_infection" />
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginBottom: "20px" }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
            <div>
              <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Viral Surveillance</h4>
              <FormField label="CMV DNA PCR" name="v2_post_inf_cmv" type="textarea" placeholder="e.g., Target not detected, or copies/mL..." />
              <FormField label="BK Virus (BKV) PCR" name="v2_post_inf_bkv" type="textarea" placeholder="e.g., Blood/Urine PCR results..." />
            </div>
            <div>
              <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Prophylaxis & Other Infections</h4>
              <FormField label="Active Prophylaxis" name="v2_post_inf_proph" type="select" options={["", "Bactrim (PCP)", "Valganciclovir (CMV)", "Nystatin/Fluconazole", "None"]} />
              <FormField label="Other Infections (UTI, PCP, Fungal)" name="v2_post_inf_other" type="textarea" placeholder="Log any active opportunistic infections..." />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Rejection Diagnostic Workup & Treatment" note="Clinical indicators, biopsy, and therapeutic protocols." historyProps={historyProps} historyKeys={["v2_post_rej_suspicion", "v2_post_rej_bx", "v2_post_rej_class", "v2_post_rej_tx"]}>
        <TransplantEncounterHistory {...historyProps} section="post_rejection" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Diagnostic Workup</h4>
            <FormField label="Clinical Suspicion (Cr rise, oliguria, fever)" name="v2_post_rej_suspicion" type="textarea" placeholder="Note acute creatinine rise >25% or symptoms..." />
            <FormField label="Biomarkers (DSA & dd-cfDNA)" name="v2_post_rej_biomarkers" type="textarea" placeholder="Record Single Antigen Bead results..." />
            <FormField label="Ultrasound / Perfusion" name="v2_post_rej_us" type="select" options={["", "Normal", "Abnormal (Hydronephrosis/Collection)"]} />
            <FormField label="Biopsy & Banff Scoring" name="v2_post_rej_bx" type="textarea" placeholder="TCMR vs ABMR criteria, C4d staining..." />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Treatment Protocols</h4>
            <FormField label="Rejection Classification" name="v2_post_rej_class" type="select" options={["", "No Rejection", "TCMR (T-Cell Mediated)", "ABMR (Antibody-Mediated)", "Mixed", "Chronic Allograft Injury"]} />
            <FormField label="Active Treatment Protocol" name="v2_post_rej_tx" type="textarea" placeholder="e.g., High-dose IV steroids, Plasmapheresis, IVIG..." />
            <FormField label="Response Assessment (2-4 Weeks)" name="v2_post_rej_response" type="textarea" placeholder="Repeat Cr, DSA, or Biopsy results..." />
          </div>
        </div>
      </Section>

      <Section title="AI Enhancement: Post-Transplant Intelligence" note="Predictive models for graft survival and rejection.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Rejection Risk & Pathology Analyzer</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Rejection Risk & Pathology Analysis" name="v2_ai_post_rejection_analysis" type="textarea" placeholder="Synthesizes clinical suspicion, biomarkers, and biopsy scoring to evaluate 30-day rejection risk..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateTxPostRejection, setIsGeneratingRejection)}
                disabled={isGeneratingRejection}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingRejection ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingRejection ? "Analyzing..." : "⚡ Analyze Rejection Risk"}
              </button>
            </div>
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Long-Term Graft Survival Forecaster</h4>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              <FormField label="Graft Survival Forecast & Dosing Opt" name="v2_ai_post_survival_forecast" type="textarea" placeholder="Analyzes graft function trends and infection history to predict 5-10 year survival..." />
              <button
                type="button"
                onClick={() => handleGenerate(generateTxPostSurvival, setIsGeneratingSurvival)}
                disabled={isGeneratingSurvival}
                style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingSurvival ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
              >
                {isGeneratingSurvival ? "Forecasting..." : "⚡ Forecast Graft Survival"}
              </button>
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default PostTxTab;
