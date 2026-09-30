import React, { useMemo } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { usePulmonology } from "../../context/PulmonologyContext";

const SUB_TABS = [
  { id: "biomarkers", label: "Eosinophils, FeNO & IgE" },
  { id: "alpha1", label: "Alpha-1 Antitrypsin Workup" },
  { id: "microbiology", label: "Sputum Microbiology & AFB" },
];

export default function BiomarkersMicrobiologyTab() {
  const { formData, updateField, setActiveTab } = usePulmonology();
  const activeSubTab = formData.subtab_biomarkers || "biomarkers";
  const setActiveSubTab = (id) => updateField("subtab_biomarkers", id);

  // Eosinophil Count Clinical Engine
  const eos = parseFloat(formData.diag_eosinophil_count);
  const eosGuidance = useMemo(() => {
    if (isNaN(eos) || eos <= 0) return null;
    if (eos >= 300) {
      return {
        level: "High",
        badge: "High Blood Eosinophils (≥300 cells/µL)",
        message: "Strong predictor of clinical response to Inhaled Corticosteroids (ICS) in COPD exacerbation reduction. In severe asthma, satisfies phenotypic eligibility for anti-IL5/IL5R (Mepolizumab, Benralizumab) or anti-IL4R (Dupilumab) biologics.",
        color: "#2e7d32",
        bg: "#f0fdf4",
        border: "#81c784",
      };
    }
    if (eos >= 100) {
      return {
        level: "Moderate",
        badge: "Moderate Blood Eosinophils (100–299 cells/µL)",
        message: "Intermediate ICS response zone. In COPD, consider adding ICS to dual bronchodilators if patient experiences ≥1 moderate exacerbation/year. Recheck count during stable state.",
        color: "#e65100",
        bg: "#fff3e0",
        border: "#ffcc80",
      };
    }
    return {
      level: "Low",
      badge: "Low Blood Eosinophils (<100 cells/µL)",
      message: "Little to no benefit expected from ICS therapy in COPD, with increased pneumonia risk. Prioritize non-steroidal dual bronchodilation (LABA + LAMA).",
      color: "#616161",
      bg: "#f5f5f5",
      border: "#cccccc",
    };
  }, [eos]);

  // FeNO Interpretation
  const feno = parseFloat(formData.diag_feno_ppb);
  const fenoGuidance = useMemo(() => {
    if (isNaN(feno) || feno <= 0) return null;
    if (feno > 50) {
      return {
        badge: "High Airway Inflammation (>50 ppb)",
        message: "Indicates active eosinophilic / Type-2 airway inflammation. Highly responsive to corticosteroid titration.",
        color: "#b71c1c",
      };
    }
    if (feno >= 25) {
      return {
        badge: "Intermediate Airway Inflammation (25–50 ppb)",
        message: "Consider in context of clinical symptoms, atopy, and current inhaled steroid compliance.",
        color: "#e65100",
      };
    }
    return {
      badge: "Normal Airway Nitric Oxide (<25 ppb)",
      message: "Eosinophilic airway inflammation is unlikely or adequately suppressed by current therapy.",
      color: "#2e7d32",
    };
  }, [feno]);

  // Alpha-1 Antitrypsin Engine
  const alpha1 = parseFloat(formData.diag_alpha1_level);
  const alpha1SevereDeficiency = !isNaN(alpha1) && alpha1 > 0 && alpha1 < 57;

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
              Specialized Pulmonary Biomarkers &amp; Microbiology
            </h4>
            <p style={{ fontSize: "11.5px", color: "#666", margin: "4px 0 0" }}>
              Blood eosinophil phenotyping for biologics, Alpha-1 antitrypsin screening, FeNO airway inflammation, and sputum culture &amp; sensitivity.
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

      {/* Quick Status Pill Bar */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: "12px",
          marginBottom: "16px",
        }}
      >
        <div style={{ background: "#fff", padding: "10px 12px", border: "1px solid #e0e0e0" }}>
          <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600 }}>Eosinophils</div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: eos >= 300 ? "#2e7d32" : "#111" }}>
            {formData.diag_eosinophil_count ? `${formData.diag_eosinophil_count} cells/µL` : "Not recorded"}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "10px 12px", border: "1px solid #e0e0e0" }}>
          <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600 }}>FeNO</div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: feno > 50 ? "#b71c1c" : "#111" }}>
            {formData.diag_feno_ppb ? `${formData.diag_feno_ppb} ppb` : "Not recorded"}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "10px 12px", border: "1px solid #e0e0e0" }}>
          <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600 }}>Alpha-1 Level</div>
          <div style={{ fontSize: "13px", fontWeight: 700, color: alpha1SevereDeficiency ? "#b71c1c" : "#111" }}>
            {formData.diag_alpha1_level ? `${formData.diag_alpha1_level} mg/dL` : "Not tested"}
          </div>
        </div>
        <div style={{ background: "#fff", padding: "10px 12px", border: "1px solid #e0e0e0" }}>
          <div style={{ fontSize: "10px", color: "#888", textTransform: "uppercase", fontWeight: 600 }}>Sputum Culture</div>
          <div style={{ fontSize: "12px", fontWeight: 700, color: (formData.diag_sputum_culture_result || "").includes("Pseudomonas") ? "#b71c1c" : "#111" }}>
            {formData.diag_sputum_culture_result ? (formData.diag_sputum_culture_result.length > 22 ? formData.diag_sputum_culture_result.substring(0, 20) + "..." : formData.diag_sputum_culture_result) : "Not recorded"}
          </div>
        </div>
      </div>

      <VoiceDictationPanel section="Biomarkers & Microbiology" />

      {/* ─── 1: Eosinophils, FeNO & IgE ──────────────────────────── */}
      <div>
        {/* Eosinophil Clinical Card */}
          {eosGuidance && (
            <div
              style={{
                border: `1px solid ${eosGuidance.border}`,
                backgroundColor: eosGuidance.bg,
                padding: "12px 16px",
                marginBottom: "16px",
                borderRadius: "2px",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: eosGuidance.color, marginBottom: "4px" }}>
                {eosGuidance.badge}
              </div>
              <p style={{ margin: 0, fontSize: "12px", color: "#333" }}>
                {eosGuidance.message}
              </p>
            </div>
          )}

          {/* FeNO Clinical Card */}
          {fenoGuidance && (
            <div
              style={{
                border: "1px solid #e0e0e0",
                backgroundColor: "#fff",
                padding: "10px 14px",
                marginBottom: "16px",
                borderLeft: `4px solid ${fenoGuidance.color}`,
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: fenoGuidance.color, marginBottom: "2px" }}>
                FeNO: {fenoGuidance.badge}
              </div>
              <p style={{ margin: 0, fontSize: "11.5px", color: "#444" }}>
                {fenoGuidance.message}
              </p>
            </div>
          )}

          <Section title="Type-2 Inflammatory Biomarkers (Asthma & COPD Phenotyping)" note="Guide biologic and steroid therapy selection">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
              <FormField
                label="BLOOD EOSINOPHIL COUNT (cells/µL)"
                name="diag_eosinophil_count"
                type="number"
                placeholder="e.g. 340"
              />
              <FormField
                label="FRACTIONAL EXHALED NITRIC OXIDE (FeNO ppb)"
                name="diag_feno_ppb"
                type="number"
                placeholder="e.g. 42"
              />
              <FormField
                label="TOTAL SERUM IgE (IU/mL)"
                name="diag_serum_ige"
                type="number"
                placeholder="e.g. 450 (Normal <100)"
              />
              <FormField
                label="SPECIFIC ASPERGILLUS IgE / PRECIPITINS"
                name="diag_aspergillus_ige"
                type="select"
                options={["", "Negative / Not tested", "Positive Specific IgE (>0.35 kU/L)", "Positive Serum Precipitins (IgG)", "ABPA Serologic Criteria Met"]}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
              <FormField
                label="BIOLOGIC AGENT CANDIDACY & TARGET SELECTION"
                name="diag_biologic_candidate"
                type="select"
                options={[
                  "",
                  "Not indicated (Mild/Moderate disease or non-T2 phenotype)",
                  "Anti-IL5 / IL5R Candidate (Mepolizumab / Benralizumab — High eosinophils)",
                  "Anti-IL4R Candidate (Dupilumab — High eosinophils and/or elevated FeNO)",
                  "Anti-IgE Candidate (Omalizumab — Atopic asthma with elevated IgE 30–1500)",
                  "Anti-TSLP Candidate (Tezepelumab — Broad T2-high or T2-low severe asthma)",
                ]}
              />
              <FormField
                label="INHALED CORTICOSTEROID (ICS) BENEFIT PROJECTION (COPD)"
                name="diag_copd_ics_response"
                type="select"
                options={[
                  "",
                  "Strong Recommendation for ICS (Eos ≥300 or history of asthma)",
                  "Consider ICS (Eos 100–299 with ≥1 moderate exacerbation/year)",
                  "Against ICS (Eos <100 or repeated severe bacterial pneumonias)",
                ]}
              />
            </div>
          </Section>
        </div>

      {/* ─── 2: Alpha-1 Antitrypsin Workup ──────────────────────── */}
      <div>
        {/* Critical Deficiency Alert Banner */}
          {alpha1SevereDeficiency && (
            <div
              style={{
                border: "1px solid #ef9a9a",
                backgroundColor: "#ffebee",
                padding: "12px 16px",
                marginBottom: "16px",
                borderRadius: "2px",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#b71c1c", marginBottom: "4px" }}>
                Critical Alpha-1 Antitrypsin Deficiency ({alpha1} mg/dL &lt; 57 mg/dL threshold)
              </div>
              <p style={{ margin: 0, fontSize: "12px", color: "#333" }}>
                Serum level is below the protective threshold of 57 mg/dL (11 µmol/L). Patient carries homozygous severe deficiency phenotype (most commonly Pi*ZZ). Order Pi-phenotyping, screen first-degree relatives, and evaluate for weekly intravenous AAT augmentation therapy.
              </p>
            </div>
          )}

          <Section title="Alpha-1 Antitrypsin Deficiency (AATD) Evaluation" note="WHO & GOLD recommend testing all COPD patients at least once">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
              <FormField
                label="SERUM ALPHA-1 LEVEL (mg/dL)"
                name="diag_alpha1_level"
                type="number"
                placeholder="e.g. 45 (Normal 100–220; <57 severe)"
              />
              <FormField
                label="PROTEASE INHIBITOR (Pi) PHENOTYPE / GENOTYPE"
                name="diag_alpha1_phenotype"
                type="select"
                options={[
                  "",
                  "Pi*MM (Normal / Wild-type)",
                  "Pi*MZ (Heterozygous carrier — intermediate risk)",
                  "Pi*SZ (Compound heterozygote — moderate deficiency)",
                  "Pi*ZZ (Homozygous severe deficiency — classic AATD)",
                  "Null / Rare variant",
                  "Test Pending",
                ]}
              />
              <FormField
                label="IV AUGMENTATION THERAPY STATUS"
                name="diag_alpha1_augmentation"
                type="select"
                options={[
                  "",
                  "Not indicated (Normal AAT levels)",
                  "Eligible & Receiving weekly infusions (Prolastin/Zemaira/Glassia)",
                  "Eligible — Pre-treatment workup in progress",
                  "Ineligible (FEV1 >80% or severe comorbidities)",
                ]}
              />
              <FormField
                label="FAMILY SCREENING STATUS"
                name="diag_alpha1_family_screen"
                type="select"
                options={["", "Not initiated", "Counseling provided", "First-degree relatives screened", "Pedigree documented"]}
              />
            </div>

            <FormField
              label="AATD CLINICAL MANAGEMENT NOTE"
              name="diag_alpha1_clinical_note"
              type="textarea"
              placeholder="Record baseline liver function tests (LFTs), hepatitis immunization, smoking cessation reinforcement, and augmentation infusion schedule..."
            />
          </Section>
        </div>

      {/* ─── 3: Sputum Microbiology & AFB ───────────────────────── */}
      <div>
        {/* Pseudomonas Alert */}
          {(formData.diag_sputum_culture_result || "").includes("Pseudomonas") && (
            <div
              style={{
                border: "1px solid #ffcc80",
                backgroundColor: "#fff8e1",
                padding: "12px 16px",
                marginBottom: "16px",
                borderRadius: "2px",
              }}
            >
              <div style={{ fontSize: "12px", fontWeight: 700, color: "#e65100", marginBottom: "4px" }}>
                Pseudomonas aeruginosa Identified in Sputum
              </div>
              <p style={{ margin: 0, fontSize: "12px", color: "#333" }}>
                Presence of P. aeruginosa is associated with accelerated FEV1 decline and increased hospital admissions in bronchiectasis and COPD. Assess whether this represents new isolation requiring eradication (oral ciprofloxacin) or chronic colonization requiring maintenance inhaled antibiotics (colistin / tobramycin).
              </p>
            </div>
          )}

          <Section title="Respiratory Sputum Microbiology & Sensitivities" note="Essential in bronchiectasis, recurrent COPD exacerbations, and cystic fibrosis">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "20px", marginBottom: "20px" }}>
              <FormField
                label="SAMPLE COLLECTION TYPE"
                name="diag_sputum_sample_type"
                type="select"
                options={["", "Spontaneous expectorated sputum", "Hypertonic saline induced sputum", "Bronchoalveolar lavage (BAL) fluid", "Endotracheal aspirate"]}
              />
              <FormField
                label="MICROSCOPIC SPECIMEN QUALITY"
                name="diag_sputum_quality"
                type="select"
                options={[
                  "",
                  "High Quality (>25 PMNs, <10 epithelial cells/LPF — Bartlett score >1)",
                  "Saliva contaminated (>10 epithelial cells/LPF — Repeat advised)",
                  "Mucopurulent / Viscid",
                  "Grossly purulent",
                  "Hemoptoic / Blood-streaked",
                ]}
              />
              <FormField
                label="PRIMARY ISOLATED MICROORGANISM"
                name="diag_sputum_culture_result"
                type="select"
                options={[
                  "Not collected / No sputum produced",
                  "Normal respiratory commensal flora",
                  "Pseudomonas aeruginosa",
                  "Haemophilus influenzae",
                  "Moraxella catarrhalis",
                  "Staphylococcus aureus (MSSA)",
                  "Staphylococcus aureus (MRSA)",
                  "Streptococcus pneumoniae",
                  "Klebsiella pneumoniae",
                  "Non-Tuberculous Mycobacteria (NTM / MAC)",
                  "Aspergillus fumigatus / Fungal isolate",
                ]}
              />
              <FormField
                label="CHRONIC COLONIZATION PATTERN"
                name="diag_sputum_colonization"
                type="select"
                options={[
                  "",
                  "First isolation (Eradication protocol indicated)",
                  "Intermittent isolation",
                  "Chronic colonization (≥3 positive cultures in 12 months)",
                  "Cleared / Eradicated on follow-up",
                ]}
              />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px", marginBottom: "20px" }}>
              <FormField
                label="AFB SMEAR & GENEXPERT MTB / RIF"
                name="diag_afb_result"
                type="select"
                options={[
                  "",
                  "AFB Smear Negative (x3 consecutive mornings)",
                  "AFB Smear Positive (Grade 1+ to 3+)",
                  "GeneXpert MTB Not Detected",
                  "GeneXpert MTB Detected — Rifampicin Sensitive",
                  "GeneXpert MTB Detected — Rifampicin Resistant (MDR-TB)",
                  "Non-Tuberculous Mycobacteria (NTM confirmed on culture)",
                ]}
              />
              <FormField
                label="FUNGAL CULTURE & ASPERGILLUS"
                name="diag_fungal_culture"
                type="select"
                options={[
                  "",
                  "No fungal growth at 4 weeks",
                  "Aspergillus fumigatus isolated",
                  "Aspergillus niger / flavus",
                  "Candida species (commensal in sputum)",
                ]}
              />
            </div>

            <FormField
              label="ANTIBIOTIC SUSCEPTIBILITIES & SENSITIVITY PROFILE"
              name="diag_sputum_sensitivities"
              type="textarea"
              placeholder="e.g. Pseudomonas aeruginosa sensitive to Ciprofloxacin, Ceftazidime, Meropenem, Tobramycin, Colistin. Resistant to Piperacillin-Tazobactam..."
            />
          </Section>
        </div>
    </div>
  );
}
