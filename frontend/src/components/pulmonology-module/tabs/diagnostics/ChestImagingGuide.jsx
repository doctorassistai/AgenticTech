import React from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";
import DICOMViewer from "../../../DICOMViewer";

const SUB_TABS = [
  { id: "hrct", label: "High-Resolution CT (HRCT)" },
  { id: "cxr", label: "Chest X-Ray (CXR)" },
  { id: "nodules", label: "Nodules & Fleischer Tracking" },
  { id: "comparison", label: "Serial Comparison & Impression" },
];

export default function ChestImagingGuide() {
  const { formData, updateField, setActiveTab } = usePulmonology();
  const activeSubTab = formData.subtab_imaging || "hrct";
  const setActiveSubTab = (id) => updateField("subtab_imaging", id);

  // Sync primary finding helper: if user selects a primary pattern here, ensure img_primary_finding matches
  const handlePatternChange = (e) => {
    updateField("img_primary_finding", e.target.value);
  };

  const patientId = formData.pt_mrn || formData.patient_id || "PT-12345";

  return (
    <div>
      {/* Header Banner */}
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
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h4 style={{ fontSize: "13px", fontWeight: 500, margin: 0, textTransform: "uppercase" }}>
              Chest Imaging &amp; Radiographic Diagnostics (CXR / HRCT)
            </h4>
            <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
              Detailed radiological evaluation: HRCT interstitial and airway patterns, emphysema quantification, nodule surveillance, and serial CXR comparisons.
            </p>
          </div>
          <button
            onClick={() => setActiveTab("diag_overview")}
            style={{
              padding: "6px 12px",
              fontSize: "11.5px",
              background: "#f5f5f5",
              color: "#333",
              border: "1px solid #ccc",
              cursor: "pointer",
              fontWeight: 500,
            }}
          >
            ← Back to Diagnostics Hub
          </button>
        </div>
      </div>

      {/* Current Core Finding Summary Card */}
      <div
        style={{
          background: "#fafafa",
          border: "1px solid #e0e0e0",
          padding: "10px 14px",
          marginBottom: "16px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "12px",
        }}
      >
        <div>
          <span style={{ color: "#666", marginRight: "6px" }}>Recorded Primary Pattern:</span>
          <b>{formData.img_primary_finding || "Not specified"}</b>
        </div>
        <div style={{ display: "flex", gap: "16px", color: "#666", fontSize: "11.5px" }}>
          <span>Last CT: <b>{formData.img_ct_date || "None"}</b></span>
          <span>Last CXR: <b>{formData.img_cxr_date || "None"}</b></span>
        </div>
      </div>

      <VoiceDictationPanel section="Chest Imaging (CXR / HRCT)" />

      <Section title="DICOM Imaging Studies">
        <DICOMViewer patientId={patientId} />
      </Section>

      {/* ─── 1: High-Resolution CT (HRCT) ───────────────────────── */}
      <Section title="High-Resolution Computed Tomography (HRCT) Protocol & Findings" note="Thin collimation (1–1.5mm) inspiratory & expiratory scanning">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
              <FormField label="DATE OF HRCT SCAN" name="img_ct_date" type="date" />
              <FormField
                label="SCAN PROTOCOL"
                name="img_ct_protocol"
                type="select"
                options={[
                  "",
                  "Volumetric HRCT (Inspiratory)",
                  "Inspiratory + Expiratory (Air-trapping)",
                  "Prone HRCT (Rule out dependent atelectasis)",
                  "CT Pulmonary Angiography (CTPA)",
                  "Low-Dose Lung Screening CT (LDCT)",
                ]}
              />
              <FormField
                label="PRIMARY RADIOLOGICAL PATTERN"
                name="img_primary_finding"
                type="select"
                options={[
                  "",
                  "Normal / Clear lung fields",
                  "Centrilobular emphysema (Upper lobe predominant)",
                  "Panacinar emphysema (Lower lobe predominant — suggest AATD)",
                  "Paraseptal emphysema / Subpleural bullae",
                  "Usual Interstitial Pneumonia (UIP: Honeycombing + Traction bronchiectasis)",
                  "Probable UIP (Reticulation + Traction bronchiectasis, no honeycombing)",
                  "Non-Specific Interstitial Pneumonia (NSIP: Basilar ground-glass)",
                  "Bronchiectasis (Cylindrical / Varicose / Cystic)",
                  "Mosaic attenuation / Small airway air trapping",
                  "Consolidation / Air bronchograms (Pneumonia / Organizing pneumonia)",
                  "Solitary pulmonary nodule / Mass lesion",
                  "Pleural thickening / Pleural effusion",
                ]}
              />
              <FormField
                label="EMPHYSEMA SEVERITY GRADE"
                name="img_ct_emphysema_pct"
                type="select"
                options={[
                  "",
                  "None (0%)",
                  "Trace / Minimal (<5%)",
                  "Mild (5–25%)",
                  "Moderate (25–50%)",
                  "Severe / Confluent (>50%)",
                ]}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "20px" }}>
              <FormField
                label="BRONCHIECTASIS MORPHOLOGY & DISTRIBUTION"
                name="img_ct_bronchiectasis_type"
                type="select"
                options={[
                  "",
                  "No bronchiectasis",
                  "Cylindrical (Tram tracks, signet-ring sign)",
                  "Varicose (Beaded appearance)",
                  "Cystic / Saccular (Clusters with air-fluid levels)",
                  "Middle lobe / Lingula predominant (Lady Windermere / NTM)",
                  "Central / Proximal (Suggests ABPA)",
                  "Lower lobe predominant",
                ]}
              />
              <FormField
                label="INTERSTITIAL FIBROSIS HALLMARKS"
                name="img_ct_fibrosis_features"
                type="select"
                options={[
                  "",
                  "No fibrosis",
                  "Subpleural honeycombing present (Definite UIP)",
                  "Traction bronchiectasis without honeycombing",
                  "Extensive ground-glass opacities (Cellular NSIP / HP)",
                  "Centrilobular ground-glass nodules (Hypersensitivity pneumonitis)",
                  "Subpleural sparing present (Favors NSIP over UIP)",
                ]}
              />
              <FormField
                label="AIRWAY MUCUS PLUGGING"
                name="img_ct_mucus_plugging"
                type="select"
                options={["", "Absent", "Subsegmental tree-in-bud opacities", "Segmental impaction", "Lobar atelectasis secondary to mucus"]}
              />
              <FormField
                label="PULMONARY ARTERY ENLARGEMENT (PA:Aorta Ratio)"
                name="img_ct_pa_aorta_ratio"
                type="select"
                options={["", "Normal (<1.0)", "Enlarged (≥1.0 — Suggests Pulmonary Hypertension)", "Severely dilated (>30mm PA diameter)"]}
              />
            </div>
          </Section>

          <Section title="HRCT Report Narrative & Key Findings" note="Formal radiologist impression and slice references">
            <FormField
              label="FORMAL HRCT RADIOLOGIST IMPRESSION"
              name="img_ct_formal_report"
              type="textarea"
              placeholder="Paste or synthesize formal radiology report: e.g. Definite UIP pattern with subpleural basilar honeycombing and traction bronchiectasis. No evidence of lymphadenopathy or pulmonary embolism..."
            />
          </Section>

      {/* ─── 2: Chest X-Ray (CXR) ───────────────────────────────── */}
      <Section title="Standard Chest Radiograph (CXR) Evaluation" note="Routine monitoring, acute exacerbation baseline, and tube position">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
              <FormField label="DATE OF CXR" name="img_cxr_date" type="date" />
              <FormField
                label="PROJECTION / POSITION"
                name="img_cxr_view"
                type="select"
                options={["", "PA & Lateral (Erect)", "AP Portable (Supine/Semi-erect)", "Lateral Decubitus", "Apical Lordotic"]}
              />
              <FormField
                label="TECHNICAL QUALITY & INSPIRATION"
                name="img_cxr_quality"
                type="select"
                options={[
                  "",
                  "Adequate (>9 posterior ribs visible)",
                  "Poor inspiration (<8 posterior ribs visible)",
                  "Rotated",
                  "Under-penetrated",
                  "Over-penetrated",
                ]}
              />
              <FormField
                label="LUNG EXPANSION / HYPERINFLATION"
                name="img_cxr_expansion"
                type="select"
                options={["", "Normal expansion", "Hyperinflated with flattened diaphragms (COPD)", "Reduced volumes (Restrictive / Splinting)"]}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px" }}>
              <FormField
                label="PARENCHYMAL INFILTRATE / CONSOLIDATION"
                name="img_cxr_infiltrate"
                type="select"
                options={[
                  "",
                  "None / Clear lung fields",
                  "Right upper lobe consolidation",
                  "Right middle lobe opacity / Silhouetted right heart border",
                  "Right lower lobe consolidation",
                  "Left upper lobe / Lingular opacity",
                  "Left lower lobe consolidation",
                  "Bilateral diffuse interstitial reticular opacities",
                  "Bilateral alveolar pulmonary edema (Batwing sign)",
                ]}
              />
              <FormField
                label="PLEURAL FLUID / BLUNTING"
                name="img_cxr_effusion"
                type="select"
                options={[
                  "",
                  "Sharp costophrenic angles bilaterally",
                  "Right costophrenic angle blunting",
                  "Left costophrenic angle blunting",
                  "Bilateral pleural effusions",
                  "Loculated / Encysted pleural collection",
                ]}
              />
              <FormField
                label="PNEUMOTHORAX VISIBILITY"
                name="img_cxr_pneumothorax"
                type="select"
                options={[
                  "",
                  "No pneumothorax visible",
                  "Small apical pneumothorax (<2cm)",
                  "Large pneumothorax (≥2cm, tube thoracostomy indicated)",
                  "Tension pneumothorax (Mediastinal shift — EMERGENCY)",
                  "Hydropneumothorax (Horizontal air-fluid level)",
                ]}
              />
              <FormField
                label="CARDIOTHORACIC RATIO (CTR)"
                name="img_cxr_ctr"
                type="select"
                options={["", "Normal (<0.50)", "Cardiomegaly (>0.50)", "Boot-shaped heart / RV prominence"]}
              />
            </div>
          </Section>

          <Section title="CXR Clinical Interpretation" note="Correlation with clinical examination">
            <FormField
              label="CXR SUMMARY & CLINICAL IMPRESSION"
              name="img_cxr_impression"
              type="textarea"
              placeholder="e.g. Hyperexpanded lungs with flattening of hemidiaphragms consistent with severe COPD. No acute focal consolidation or pneumothorax..."
            />
          </Section>

      {/* ─── 3: Pulmonary Nodules & Fleischner Tracking ─────────── */}
      <Section title="Incidental Pulmonary Nodule & Fleischner Society 2017 Guidelines" note="Risk stratification for solid & subsolid nodules">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
              <FormField
                label="NODULE DETECTION STATUS"
                name="img_nodule_status"
                type="select"
                options={["", "No pulmonary nodules detected", "Single solid nodule", "Multiple solid nodules", "Pure ground-glass nodule (pGGN)", "Part-solid nodule (subsolid)"]}
              />
              <FormField
                label="MAXIMUM AXIAL DIAMETER (mm)"
                name="img_nodule_size_mm"
                type="number"
                placeholder="e.g. 7"
              />
              <FormField
                label="ANATOMIC LOCATION"
                name="img_nodule_location"
                type="select"
                options={[
                  "",
                  "Right Upper Lobe (High malignancy risk)",
                  "Right Middle Lobe",
                  "Right Lower Lobe",
                  "Left Upper Lobe (High malignancy risk)",
                  "Left Lower Lobe",
                  "Subpleural / Fissural (Favors intrapulmonary lymph node)",
                ]}
              />
              <FormField
                label="MARGIN CHARACTERISTICS"
                name="img_nodule_margins"
                type="select"
                options={[
                  "",
                  "Smooth / Well-circumscribed (Low risk)",
                  "Lobulated (Intermediate risk)",
                  "Spiculated / Corona radiata (High malignancy risk)",
                  "Cavitary with thick wall (>15mm)",
                  "Benign calcification (Popcorn, central, concentric lamellar)",
                ]}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <FormField
                label="PATIENT RISK PROFILE (Fleischner)"
                name="img_nodule_risk_category"
                type="select"
                options={[
                  "",
                  "Low Risk (Young, non-smoker, no family history, smooth nodule)",
                  "High Risk (Heavy smoking history, older age, upper lobe, irregular margins)",
                ]}
              />
              <FormField
                label="RECOMMENDED FLEISCHNER SURVEILLANCE INTERVAL"
                name="img_nodule_fleischner_plan"
                type="select"
                options={[
                  "",
                  "No routine follow-up needed (<6mm low-risk solid)",
                  "Optional CT at 12 months (<6mm high-risk solid)",
                  "CT at 6–12 months, then consider 18–24 months (6–8mm solid)",
                  "CT at 3 months, PET-CT, or tissue biopsy (>8mm high-risk solid)",
                  "CT at 6–12 months to confirm persistence (Pure GGN ≥6mm)",
                  "CT at 3–6 months to assess solid component (Part-solid ≥6mm)",
                ]}
              />
            </div>
          </Section>

      {/* ─── 4: Serial Comparison & Impression ──────────────────── */}
      <Section title="Serial Imaging Trajectory & Longitudinal Comparison" note="Compare current imaging against prior scans">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
              <FormField
                label="OVERALL IMAGING TRAJECTORY STATUS"
                name="img_comparison_status"
                type="select"
                options={[
                  "",
                  "Stable — No interval change compared to prior study",
                  "Worsening — Progression of fibrosis / increased honeycombing",
                  "Worsening — Progressive emphysema / enlarging bullae",
                  "Acute worsening — New consolidation, effusion, or pneumothorax",
                  "Improvement — Clearing of consolidation / resolving infiltrates",
                  "First baseline imaging — No prior studies available for comparison",
                ]}
              />
              <FormField
                label="DATE OF PRIOR REFERENCE STUDY"
                name="img_prior_reference_date"
                type="date"
              />
            </div>

            <FormField
              label="SYNTHESIZED RADIOLOGICAL CLINICAL IMPRESSION"
              name="img_overall_impression"
              type="textarea"
              placeholder="Synthesize radiologic conclusions: e.g. HRCT confirms progressive UIP pattern with 15% increase in basilar honeycombing compared to 12-month prior study. No suspicious lung nodules. Suggest multidisciplinary ILD team discussion..."
            />
          </Section>
    </div>
  );
}
