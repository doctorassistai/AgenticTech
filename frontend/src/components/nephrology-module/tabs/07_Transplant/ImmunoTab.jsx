import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import { useNephrology } from "../../context/NephrologyContext";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { TX_DICTATION_FIELDS } from "../../components/txDictation";
import { generateTxImmuno } from "../../services/nephrologyApi";
import TransplantEncounterHistory from "../../components/TransplantEncounterHistory";

const ImmunoTab = ({ historyProps }) => {
  const { formData, updateField } = useNephrology();

  const [isGeneratingImmuno, setIsGeneratingImmuno] = useState(false);

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

  // Parse trough levels
  const parseNum = (str) => {
    if (!str) return 0;
    const matched = String(str).match(/[\d.]+/);
    return matched ? parseFloat(matched[0]) : 0;
  };

  const tacTrough = parseNum(formData.v2_tx_tac_trough);
  const cycloTrough = parseNum(formData.v2_tx_cyclo_trough);

  // Tacrolimus logic
  const hasTac = tacTrough > 0;
  const isTacToxic = hasTac && tacTrough > 12.0;
  const isTacLow = hasTac && tacTrough < 5.0;

  // Cyclosporine logic (rough benchmarks)
  const hasCyclo = cycloTrough > 0;
  const isCycloToxic = hasCyclo && cycloTrough > 300;
  const isCycloLow = hasCyclo && cycloTrough < 100;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Immunosuppression & Toxicity" fields={TX_DICTATION_FIELDS} transformStructuredValues={({ values }) => values} />
      
      {/* Safety Alerts */}
      {(isTacToxic || isCycloToxic) && (
        <div style={{ padding: "12px 16px", background: "#fff1f0", borderLeft: "4px solid #cf1322", fontSize: "12.5px", color: "#cf1322", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ CNI TOXICITY RISK:</b> {isTacToxic ? "Tacrolimus" : "Cyclosporine"} level is supratherapeutic. High risk of acute nephrotoxicity (afferent arteriole vasoconstriction). Recommend decreasing dose.
        </div>
      )}
      
      {(isTacLow || isCycloLow) && (
        <div style={{ padding: "12px 16px", background: "#fff7e6", borderLeft: "4px solid #fa8c16", fontSize: "12.5px", color: "#d46b08", borderRadius: "0 4px 4px 0" }}>
          <b>⚠ REJECTION RISK:</b> {isTacLow ? "Tacrolimus" : "Cyclosporine"} level is subtherapeutic. Patient is at high risk for acute T-cell mediated or antibody mediated rejection. Recommend increasing dose.
        </div>
      )}

      <Section title="Immunosuppression Intelligence" note="Tracking trough levels and adjusting regimens." historyProps={historyProps} historyKeys={["v2_tx_induction", "v2_tx_tac_trough", "v2_tx_cyclo_trough", "v2_tx_dose_ai"]}>
        <TransplantEncounterHistory {...historyProps} section="immuno_levels" />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
          <FormField label="Induction Regimen Used" name="v2_tx_induction" type="select" options={["", "Thymoglobulin", "Basiliximab", "Alemtuzumab", "None"]} />
          <FormField label="Current Maintenance Regimen" name="v2_tx_maintenance" type="textarea" />
        </div>

        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginBottom: "20px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Trough Level Tracking</h4>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="Tacrolimus Trough (ng/mL)" name="v2_tx_tac_trough" type="number" />
            <FormField label="Target Tacrolimus Range" name="v2_tx_tac_target" type="select" options={["", "4-6", "5-8", "8-10"]} />
            <FormField label="Cyclosporine/Sirolimus Level" name="v2_tx_cyclo_trough" type="number" />
          </div>
          <div style={{ marginTop: "16px" }}>
            <FormField label="Dose Adjustment Intelligence" name="v2_tx_dose_ai" type="select" options={[
              "",
              "In Range - Continue Current Dose",
              "Subtherapeutic - Increase Dose",
              "Supratherapeutic - Decrease Dose"
            ]} />
          </div>
        </div>
      </Section>

      <Section title="Medication Toxicity Monitor" note="Identifying adverse effects of immunosuppressants." historyProps={historyProps} historyKeys={["v2_tx_tox_cni", "v2_tx_tox_nodat", "v2_tx_tox_myelo"]}>
        <TransplantEncounterHistory {...historyProps} section="immuno_toxicity" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
          <FormField label="CNI Nephrotoxicity Suspected" name="v2_tx_tox_cni" type="select" options={["", "Yes", "No"]} />
          <FormField label="New Onset Diabetes After Transplant (NODAT)" name="v2_tx_tox_nodat" type="select" options={["", "Yes", "No"]} />
          <FormField label="Leukopenia / Myelosuppression" name="v2_tx_tox_myelo" type="select" options={["", "Yes", "No"]} />
        </div>
      </Section>

      <Section title="AI Enhancement: Immunosuppression Intelligence" note="Predictive intelligence for optimizing regimens and mitigating toxicity.">
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <h4 style={{ margin: "0 0 16px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Regimen & Toxicity Analyzer</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            <FormField label="Dose Adjustment & Mitigation Recommendations" name="v2_ai_tx_immuno" type="textarea" placeholder="Analyzes trough levels, current regimens, and toxicity markers to recommend precise dose adjustments..." />
            <button
              type="button"
              onClick={() => handleGenerate(generateTxImmuno, setIsGeneratingImmuno)}
              disabled={isGeneratingImmuno}
              style={{ background: "#000", color: "#fff", border: "none", padding: "6px 10px", fontSize: "11px", borderRadius: "3px", cursor: isGeneratingImmuno ? "wait" : "pointer", alignSelf: "flex-start", fontWeight: 600 }}
            >
              {isGeneratingImmuno ? "Analyzing..." : "⚡ Analyze Regimen"}
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
};

export default ImmunoTab;
