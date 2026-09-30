import React, { useState } from "react";
import Section from "../../components/Section";
import FormField from "../../components/FormField";
import VoiceDictationPanel from "../../components/VoiceDictationPanel";
import { useNephrology } from "../../context/NephrologyContext";
import { generatePhenotype } from "../../services/nephrologyApi";

const URINE_DICTATION_FIELDS = [
  { k: "v2_urine_blood_dip", label: "Dipstick Blood", type: "select", options: ["Negative", "Trace", "1+", "2+", "3+"] },
  { k: "v2_urine_leuk_est", label: "Leukocyte Esterase", type: "select", options: ["Negative", "Trace", "1+", "2+", "3+"] },
  { k: "v2_urine_nitrite", label: "Nitrites", type: "select", options: ["Negative", "Positive"] },
  { k: "v2_urine_protein", label: "Urine Protein", type: "select", options: ["Negative", "Trace", "1+", "2+", "3+", "4+"] },
  { k: "v2_urine_albumin", label: "Urine Albumin", type: "select", options: ["Normal", "Trace", "1+", "2+", "3+", "4+", "Microalbuminuria", "Macroalbuminuria"] },
  { k: "v2_urine_rbc", label: "Urine RBC per HPF", type: "text" },
  { k: "v2_urine_wbc", label: "Urine WBC per HPF", type: "text" },
  { k: "v2_urine_casts", label: "Urine Casts", type: "select", options: ["None", "Hyaline", "RBC Casts", "WBC Casts", "Muddy Brown", "Granular"] },
  { k: "v2_urine_upcr", label: "Protein/Creatinine Ratio", type: "number" },
  { k: "v2_urine_uacr", label: "Albumin/Creatinine Ratio", type: "number" },
];

const URINE_FIELD_ALIASES = {
  v2_urine_upcr: ["protein/creatinine ratio", "protein creatinine ratio", "protein to creatinine ratio", "upcr", "pcr"],
  v2_urine_uacr: ["albumin/creatinine ratio", "albumin creatinine ratio", "albumin to creatinine ratio", "uacr", "acr"],
  v2_urine_blood_dip: ["dipstick blood", "blood on dipstick", "blood dipstick", "hemoglobin dipstick", "blood"],
  v2_urine_leuk_est: ["leukocyte esterase", "le", "leuk esterase"],
  v2_urine_nitrite: ["nitrites", "nitrite"],
  v2_urine_protein: ["urine protein", "protein"],
  v2_urine_albumin: ["urine albumin", "albumin"],
  v2_urine_rbc: ["red blood cells", "red blood cell", "rbc"],
  v2_urine_wbc: ["white blood cells", "white blood cell", "wbc", "pus cells"],
  v2_urine_casts: ["urine casts", "casts", "cast"],
};

const URINE_FIELD_LABELS = {
  v2_urine_upcr: "Protein/Creatinine Ratio",
  v2_urine_uacr: "Albumin/Creatinine Ratio",
  v2_urine_blood_dip: "Dipstick Blood",
  v2_urine_leuk_est: "Leukocyte Esterase",
  v2_urine_nitrite: "Nitrites",
  v2_urine_protein: "Protein",
  v2_urine_albumin: "Albumin",
  v2_urine_rbc: "RBC",
  v2_urine_wbc: "WBC",
  v2_urine_casts: "Casts",
};

const normalizeText = (value) => String(value || "")
  .toLowerCase()
  .replace(/[^a-z0-9.]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const spokenNumber = (value) => {
  const text = normalizeText(value);
  const numericRange = text.match(/([-+]?\d+(?:\.\d+)?)\s+to\s+([-+]?\d+(?:\.\d+)?)/);
  if (numericRange) return `${numericRange[1]}-${numericRange[2]}`;
  const direct = text.match(/[-+]?\d+(?:\.\d+)?/);
  if (direct) return direct[0];
  const words = {
    zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
    sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
    thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
    eighty: 80, ninety: 90,
  };
  const point = text.match(/([a-z]+)\s+point\s+([a-z]+)/);
  if (point && words[point[1]] !== undefined && words[point[2]] !== undefined) {
    return `${words[point[1]]}.${words[point[2]]}`;
  }
  const wordRange = text.match(/([a-z]+)\s+to\s+([a-z]+)/);
  if (wordRange && words[wordRange[1]] !== undefined && words[wordRange[2]] !== undefined) {
    return `${words[wordRange[1]]}-${words[wordRange[2]]}`;
  }
  const firstWord = text.match(/[a-z]+/);
  return firstWord && words[firstWord[0]] !== undefined ? String(words[firstWord[0]]) : "";
};

const findFieldSegments = (transcript) => {
  const text = normalizeText(transcript);
  const matches = [];
  Object.entries(URINE_FIELD_ALIASES).forEach(([field, aliases]) => {
    aliases.forEach((alias) => {
      const normalizedAlias = normalizeText(alias);
      const index = text.indexOf(normalizedAlias);
      if (index >= 0) matches.push({ field, index, end: index + normalizedAlias.length });
    });
  });
  return matches
    .sort((first, second) => first.index - second.index || second.end - first.end)
    .filter((match, index, all) => !index || match.index >= all[index - 1].end);
};

const parseUrineDictation = (transcript) => {
  const text = normalizeText(transcript);
  const matches = findFieldSegments(text);
  const parsed = {};
  matches.forEach((match, index) => {
    const nextIndex = matches[index + 1]?.index || text.length;
    const valueText = text.slice(match.end, nextIndex).replace(/^(is|of|was|shows|showing|at|equals?)\s+/, "").trim();
    if (!valueText) return;

    if (["v2_urine_rbc", "v2_urine_wbc", "v2_urine_upcr", "v2_urine_uacr"].includes(match.field)) {
      const value = spokenNumber(valueText);
      if (value) parsed[match.field] = value;
      return;
    }

    if (["v2_urine_protein", "v2_urine_blood_dip", "v2_urine_leuk_est"].includes(match.field)) {
      const scale = valueText.match(/negative|trace|[1-4]\s*\+|one\s+plus|two\s+plus|three\s+plus|four\s+plus|[1-4]\s+plus/);
      if (scale) {
        const val = scale[0];
        if (val.includes("negative")) parsed[match.field] = "Negative";
        else if (val.includes("trace")) parsed[match.field] = "Trace";
        else if (val.includes("1") || val.includes("one")) parsed[match.field] = "1+";
        else if (val.includes("2") || val.includes("two")) parsed[match.field] = "2+";
        else if (val.includes("3") || val.includes("three")) parsed[match.field] = "3+";
        else if (val.includes("4") || val.includes("four")) parsed[match.field] = "4+";
      }
      return;
    }

    if (match.field === "v2_urine_nitrite") {
      const val = valueText.match(/negative|positive/);
      if (val) {
        parsed[match.field] = val[0] === "negative" ? "Negative" : "Positive";
      }
      return;
    }

    if (match.field === "v2_urine_albumin") {
      const scale = valueText.match(/macroalbuminuria|microalbuminuria|normal|trace|[1-4]\s*\+|one\s+plus|two\s+plus|three\s+plus|four\s+plus|[1-4]\s+plus/);
      if (scale) {
        const val = scale[0];
        if (val.includes("macro")) parsed[match.field] = "Macroalbuminuria";
        else if (val.includes("micro")) parsed[match.field] = "Microalbuminuria";
        else if (val.includes("normal")) parsed[match.field] = "Normal";
        else if (val.includes("trace")) parsed[match.field] = "Trace";
        else if (val.includes("1") || val.includes("one")) parsed[match.field] = "1+";
        else if (val.includes("2") || val.includes("two")) parsed[match.field] = "2+";
        else if (val.includes("3") || val.includes("three")) parsed[match.field] = "3+";
        else if (val.includes("4") || val.includes("four")) parsed[match.field] = "4+";
      }
      return;
    }

    if (match.field === "v2_urine_casts") {
      const castMatch = text.match(/rbc casts|wbc casts|muddy brown|hyaline|granular|none/);
      if (castMatch) {
        const val = castMatch[0];
        if (val === "rbc casts") parsed[match.field] = "RBC Casts";
        else if (val === "wbc casts") parsed[match.field] = "WBC Casts";
        else if (val === "muddy brown") parsed[match.field] = "Muddy Brown";
        else if (val === "hyaline") parsed[match.field] = "Hyaline";
        else if (val === "granular") parsed[match.field] = "Granular";
        else if (val === "none") parsed[match.field] = "None";
      }
      return;
    }
  });
  return parsed;
};

const UrineIntelTab = () => {
  const { formData, updateField } = useNephrology();
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const result = await generatePhenotype(formData);
      if (result?.data?.v2_urine_phenotype) {
        updateField("v2_urine_phenotype", result.data.v2_urine_phenotype);
      }
    } catch (err) {
      console.error("Failed to generate phenotype:", err);
    } finally {
      setIsGenerating(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <VoiceDictationPanel
        section="Urinalysis and Urine Phenotype"
        fields={URINE_DICTATION_FIELDS}
        transformStructuredValues={({ transcript }) => parseUrineDictation(transcript)}
      />
      <Section title="Urine Intelligence" note="Don't treat urinalysis as isolated laboratory values. Build a Urine Phenotype.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "20px", marginBottom: "20px" }}>
          <FormField label="Dipstick Blood" name="v2_urine_blood_dip" type="select" options={["", "Negative", "Trace", "1+", "2+", "3+"]} />
          <FormField label="Leukocyte Esterase" name="v2_urine_leuk_est" type="select" options={["", "Negative", "Trace", "1+", "2+", "3+"]} />
          <FormField label="Nitrites" name="v2_urine_nitrite" type="select" options={["", "Negative", "Positive"]} />
          <FormField label="Protein/Creatinine Ratio" name="v2_urine_upcr" type="number" />
          <FormField label="Albumin/Creatinine Ratio" name="v2_urine_uacr" type="number" />
          <FormField label="Protein" name="v2_urine_protein" type="select" options={["", "Negative", "Trace", "1+", "2+", "3+", "4+"]} />
          <FormField label="Albumin" name="v2_urine_albumin" type="select" options={["", "Normal", "Trace", "1+", "2+", "3+", "4+", "Microalbuminuria", "Macroalbuminuria"]} />
          <FormField label="RBC" name="v2_urine_rbc" type="text" />
          <FormField label="WBC" name="v2_urine_wbc" type="text" />
          <FormField label="Casts" name="v2_urine_casts" type="select" options={["", "None", "Hyaline", "RBC Casts", "WBC Casts", "Muddy Brown", "Granular"]} />
        </div>

        <div style={{ padding: "16px", background: "#f9f9f9", border: "1px dashed #ccc", marginBottom: "16px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "16px" }}>
            <div>
              <h4 style={{ margin: "0 0 6px 0", fontSize: "13px", color: "#333" }}>AI Urine Phenotype Correlator</h4>
              <p style={{ margin: "0", fontSize: "12px", color: "#666" }}>
                The system correlates urine findings with Serum biomarkers, Clinical history, Imaging, Autoimmune tests, Kidney function, and Medication exposure.
              </p>
            </div>
            <button 
              onClick={handleGenerate}
              disabled={isGenerating}
              style={{ background: "#ffffff", color: "#000000", border: "1px solid #cccccc", padding: "6px 12px", fontSize: "11px", borderRadius: "3px", cursor: "pointer", marginLeft: "16px", whiteSpace: "nowrap" }}
            >
              {isGenerating ? "Generating..." : "Generate AI Phenotype"}
            </button>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "12px" }}>
            <FormField label="Detected Phenotype" name="v2_urine_phenotype" type="select" options={[
              "",
              "Glomerular Process (Proteinuria + hematuria + RBC casts)",
              "Nephrotic Syndrome (Heavy proteinuria + hypoalbuminemia + edema)",
              "Interstitial Nephritis (Pyuria + medication exposure)",
              "Benign / Normal",
              "Isolated Proteinuria",
              "Isolated Hematuria"
            ]} />
          </div>
        </div>
      </Section>
    </div>
  );
};

export default UrineIntelTab;
