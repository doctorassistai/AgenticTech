import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import { generatePathology } from "../../services/nephrologyApi";

const BIOPSY_DICTATION_FIELDS = [
  { k: "v2_bx_nephrotic_prot", label: "Proteinuria Status", type: "select", options: ["Normal", "Sub-nephrotic", "Nephrotic range (>3.5g/day)"] },
  { k: "v2_bx_nephrotic_alb", label: "Hypoalbuminemia", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_nephrotic_edema", label: "Edema", type: "select", options: ["Present", "Absent"] },
  { k: "v2_bx_nephrotic_lipid", label: "Hyperlipidemia", type: "select", options: ["Present", "Absent", "Yes", "No"] },
  { k: "v2_bx_gn_hema", label: "Hematuria Checked", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_gn_prot", label: "Proteinuria Checked", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_gn_func", label: "Kidney Function Checked", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_gn_comp", label: "Complement/Autoimmune Checked", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_gn_inf", label: "Infection Screened", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_gn_ai_sero", label: "Serologic Interpretation", type: "textarea" },
  { k: "v2_bx_ind_aki", label: "Unexplained AKI", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_ind_nephrotic", label: "Nephrotic Syndrome Indication", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_ind_hema", label: "Glomerular Hematuria", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_ind_rpgn", label: "Rapidly Progressive GN", type: "select", options: ["Yes", "No"] },
  { k: "v2_bx_safe_coag", label: "Coagulation Studies", type: "select", options: ["Normal", "Abnormal - Correcting", "Abnormal - Contraindicated"] },
  { k: "v2_bx_safe_bp", label: "Biopsy BP Control", type: "select", options: ["Controlled", "Uncontrolled - Needs adjustment"] },
  { k: "v2_bx_safe_consent", label: "Patient Consent", type: "select", options: ["Obtained", "Pending", "Declined"] },
  { k: "v2_bx_status", label: "Overall Biopsy Status", type: "select", options: ["Planned", "Scheduled", "Completed", "Results Ready"] },
  { k: "v2_bx_path_lm", label: "Light Microscopy Summary", type: "textarea" },
  { k: "v2_bx_path_if", label: "Immunofluorescence Summary", type: "textarea" },
  { k: "v2_bx_path_em", label: "Electron Microscopy Summary", type: "textarea" },
];

const RecentBiopsyOperativeSummary = ({ historicalSessions, formData }) => {
  const activeBxData =
    formData?.bx_site ||
    formData?.bx_needle_gauge ||
    formData?.bx_passes_total ||
    formData?.bx_path_prelim ||
    formData?.proc_category === "interventional" ||
    formData?.proc_type === "renal_biopsy"
      ? formData
      : null;

  const bxSessions = (historicalSessions || []).filter(
    (s) =>
      (s.track === "diagnostics" || s.track === "procedures") &&
      (s.data?.bx_site ||
        s.data?.bx_needle_gauge ||
        s.data?.bx_cores_lm ||
        s.data?.bx_passes_total ||
        s.tab === "renal_biopsy")
  );

  const latestSession = bxSessions.length > 0
    ? [...bxSessions].sort((a, b) => new Date(b.created_at || b.date || 0) - new Date(a.created_at || a.date || 0))[0]
    : null;

  const d = activeBxData || latestSession?.data;
  if (!d) return null;

  const bxDate = d.proc_date || (latestSession?.created_at ? new Date(latestSession.created_at).toLocaleDateString() : "");
  const targetSite = d.bx_site ? d.bx_site.split("(")[0] : "Renal Lower Pole";
  const gauge = d.bx_needle_gauge || "16G Automated";
  const passes = d.bx_passes_total ? `${d.bx_passes_total} passes` : "2 passes";
  const prelimYield = d.bx_path_prelim ? d.bx_path_prelim.split("(")[0] : "Adequate (>10 Glomeruli)";
  const usPost = d.bx_us_post_eval ? d.bx_us_post_eval.split("(")[0] : "No Hematoma";

  return (
    <div style={{ marginBottom: "18px", border: "1px solid #d97706", borderRadius: "4px", overflow: "hidden" }}>
      <div style={{ background: "#fffbeb", padding: "8px 14px", fontSize: "12px", fontWeight: 700, color: "#b45309", borderBottom: "1px solid #fef3c7", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>RECENT RENAL BIOPSY OPERATIVE RECORD</span>
        {bxDate && <span style={{ fontWeight: 500, fontSize: "11px", color: "#92400e" }}>Biopsy Date: {bxDate}</span>}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "12px", padding: "12px 14px", background: "#ffffff", fontSize: "12px" }}>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Target & Guidance</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{targetSite} (Real-Time US)</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Needle & Passes</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{gauge} ({passes})</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Preliminary Specimen Yield</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#15803d" }}>{prelimYield}</div>
        </div>
        <div>
          <div style={{ fontSize: "10.5px", color: "#64748b", textTransform: "uppercase", fontWeight: 700 }}>Post-Procedure Status</div>
          <div style={{ fontWeight: 600, marginTop: "3px", color: "#0f172a" }}>{usPost}</div>
        </div>
      </div>
    </div>
  );
};

const BiopsyGNTab = () => {
  const { formData, updateField, historicalSessions } = useNephrology();

  // Auto-sync biopsy completion into BiopsyGNTab fields
  React.useEffect(() => {
    if (formData.bx_site && !formData.v2_bx_status) {
      updateField("v2_bx_status", "Completed");
    }
    if (formData.proc_consent === "Yes" && !formData.v2_bx_safe_consent) {
      updateField("v2_bx_safe_consent", "Obtained");
    }
    if (formData.chk_timeout && !formData.v2_bx_safe_bp) {
      updateField("v2_bx_safe_bp", "Controlled");
    }
  }, [formData.bx_site, formData.proc_consent, formData.chk_timeout, formData.v2_bx_status, formData.v2_bx_safe_consent, formData.v2_bx_safe_bp, updateField]);

  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await generatePathology(formData);
      if (result?.data) {
        Object.entries(result.data).forEach(([key, value]) => {
          updateField(key, value);
        });
      }
    } catch (err) {
      console.error("Failed to extract pathology:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel section="Kidney Biopsy and Glomerular Disease" fields={BIOPSY_DICTATION_FIELDS} />
      <Section title="Nephrotic Syndrome & GN Intelligence Pathways" note="A unified pipeline for glomerular disease management.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>Nephrotic Syndrome Tracker</h4>
            <FormField label="Proteinuria Status" name="v2_bx_nephrotic_prot" type="select" options={["", "Normal", "Sub-nephrotic", "Nephrotic range (>3.5g/day)"]} />
            <div style={{ height: "8px" }} />
            <FormField label="Hypoalbuminemia" name="v2_bx_nephrotic_alb" type="select" options={["", "Yes", "No"]} />
            <div style={{ height: "8px" }} />
            <FormField label="Edema" name="v2_bx_nephrotic_edema" type="select" options={["", "Present", "Absent"]} />
            <div style={{ height: "8px" }} />
            <FormField label="Hyperlipidemia" name="v2_bx_nephrotic_lipid" type="select" options={["", "Present", "Absent"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666666", textTransform: "uppercase" }}>GN Intelligence Checklist</h4>
            <FormField label="Hematuria Checked" name="v2_bx_gn_hema" type="select" options={["", "Yes", "No"]} />
            <div style={{ height: "8px" }} />
            <FormField label="Proteinuria Checked" name="v2_bx_gn_prot" type="select" options={["", "Yes", "No"]} />
            <div style={{ height: "8px" }} />
            <FormField label="Function Checked" name="v2_bx_gn_func" type="select" options={["", "Yes", "No"]} />
            <div style={{ height: "8px" }} />
            <FormField label="Complement/Autoimmune Checked" name="v2_bx_gn_comp" type="select" options={["", "Yes", "No"]} />
            <div style={{ height: "8px" }} />
            <FormField label="Infection Screened" name="v2_bx_gn_inf" type="select" options={["", "Yes", "No"]} />
            <div style={{ height: "8px" }} />
            <FormField label="AI Serologic Result Interpretation" name="v2_bx_gn_ai_sero" type="textarea" />
          </div>
        </div>
      </Section>

      <Section title="Kidney Biopsy Operations & Management" note="Track indications, ensure safety before procedure, and manage status.">
        <RecentBiopsyOperativeSummary historicalSessions={historicalSessions} formData={formData} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Biopsy Indication Checklist</h4>
            <FormField label="Unexplained AKI" name="v2_bx_ind_aki" type="select" options={["", "Yes", "No"]} />
            <FormField label="Glomerular Hematuria" name="v2_bx_ind_hema" type="select" options={["", "Yes", "No"]} />
            <FormField label="Nephrotic Syndrome" name="v2_bx_ind_nephrotic" type="select" options={["", "Yes", "No"]} />
            <FormField label="Rapidly Progressive GN" name="v2_bx_ind_rpgn" type="select" options={["", "Yes", "No"]} />
          </div>

          <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
            <h4 style={{ margin: "0 0 10px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Pre-Biopsy Safety Checklist</h4>
            <FormField label="Coagulation Studies (PT/PTT/INR)" name="v2_bx_safe_coag" type="select" options={["", "Normal", "Abnormal - Correcting", "Abnormal - Contraindicated"]} />
            <FormField label="BP Control (<140/90)" name="v2_bx_safe_bp" type="select" options={["", "Controlled", "Uncontrolled - Needs adjustment"]} />
            <FormField label="Patient Consent" name="v2_bx_safe_consent" type="select" options={["", "Obtained", "Pending", "Declined"]} />
            <div style={{ marginTop: "10px" }}>
              <FormField label="Overall Biopsy Status" name="v2_bx_status" type="select" options={["", "Planned", "Scheduled", "Completed", "Results Ready"]} />
            </div>
          </div>
        </div>
      </Section>

      <Section title="Pathology Integration & Staging" note="Digital slide review and structured quantitative metrics.">
        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
            <h4 style={{ margin: 0, fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Digital Slide Viewer (Histology, IF, EM)</h4>
            <button style={{ background: "#000", color: "#fff", border: "none", padding: "6px 12px", fontSize: "11px", borderRadius: "3px", cursor: "pointer" }}>Launch Embedded Pathology Viewer</button>
          </div>
          <p style={{ fontSize: "11px", color: "#888", margin: "0 0 16px 0" }}>Review high-resolution WSI (Whole Slide Imaging) integrated directly from the pathology lab system.</p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
            <FormField label="Light Microscopy (LM) Summary" name="v2_bx_path_lm" />
            <FormField label="Immunofluorescence (IF) Summary" name="v2_bx_path_if" />
            <FormField label="Electron Microscopy (EM) Summary" name="v2_bx_path_em" />
          </div>
        </div>

        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px solid #e0e0e0", borderRadius: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <h4 style={{ margin: "0 0 6px 0", fontSize: "12px", color: "#666", textTransform: "uppercase" }}>Standardized Pathology Reporting Template</h4>
              <p style={{ margin: "0", fontSize: "12px", color: "#666" }}>
                AI analyzes the raw microscopy narratives above to calculate chronicity indices and determine the final glomerular diagnosis.
              </p>
            </div>
            <button 
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{ background: "#ffffff", color: "#000000", border: "1px solid #cccccc", padding: "6px 12px", fontSize: "11px", borderRadius: "3px", cursor: "pointer", marginLeft: "16px", whiteSpace: "nowrap" }}
            >
              {isGenerating ? "Extracting..." : "Run AI Pathology Extraction"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px", marginBottom: "16px" }}>
            <FormField label="% Glomerulosclerosis" name="v2_bx_quant_gs" type="number" placeholder="%" />
            <FormField label="% Interstitial Fibrosis" name="v2_bx_quant_ifta" type="number" placeholder="%" />
            <FormField label="Tubular Atrophy Score" name="v2_bx_quant_ta" type="select" options={["", "Mild (0-25%)", "Moderate (26-50%)", "Severe (>50%)"]} />
          </div>
          
          <div style={{ borderTop: "1px solid #eee", paddingTop: "16px", marginTop: "16px", display: "grid", gridTemplateColumns: "2fr 1fr", gap: "20px" }}>
            <FormField label="Final Glomerular Diagnosis" name="v2_bx_diagnosis" type="select" options={[
              "",
              "IgA Nephropathy",
              "Lupus Nephritis",
              "Membranous Nephropathy",
              "FSGS",
              "Minimal Change Disease",
              "ANCA Vasculitis",
              "Anti-GBM Disease",
              "Other"
            ]} />
            <FormField label="AI Diagnostic Confidence Score (%)" name="v2_bx_diag_conf" type="number" placeholder="e.g. 94" />
          </div>
        </div>
      </Section>
    </div>
  );
};

export default BiopsyGNTab;
