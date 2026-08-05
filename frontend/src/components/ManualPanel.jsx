import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from "@mui/material";
import {
  AddRounded,
  EditRounded,
  DeleteOutlineRounded,
  CheckRounded,
  ContentCopyRounded,
  CloseRounded,
  SaveRounded,
  RefreshRounded,
  SearchRounded,
  MedicationRounded,
  AddCircleOutlineRounded,
} from "@mui/icons-material";

// ─── Config ───────────────────────────────────────────────────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;
const C = {
  black: "#0a0a0a",
  ink: "#1a1a1a",
  charcoal: "#2e2e2e",
  smoke: "#4a4a4a",
  ash: "#7a7a7a",
  silver: "#a8a8a8",
  mist: "#d4d4d4",
  fog: "#e8e8e8",
  ghost: "#f2f2f2",
  white: "#ffffff",
  blue: "#e8f0fe",
  blueDark: "#1a56db",
  blueMid: "#3b82f6",
  green: "#e6f4ea",
  greenDark: "#1e7e34",
  greenMid: "#2e7d32",
  amber: "#fff8e1",
  amberDark: "#f59f00",
};
const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ─── Section Suggestions ──────────────────────────────────────────────────────
const SUGGESTIONS = {
  chief_complaint: [
    "Fever", "Headache", "Cough", "Cold", "Sore throat", "Body ache",
    "Chest pain", "Breathlessness", "Abdominal pain", "Nausea", "Vomiting",
    "Diarrhea", "Constipation", "Fatigue", "Dizziness", "Palpitations",
    "Back pain", "Joint pain", "Skin rash", "Swelling", "Weight loss",
    "Weight gain", "Loss of appetite", "Burning micturition", "Leg pain",
    "Eye pain", "Ear pain", "Nasal discharge", "Sneezing", "Insomnia",
  ],
  medical_history: [
    "Hypertension", "Type 2 Diabetes Mellitus", "Type 1 Diabetes Mellitus",
    "Asthma", "COPD", "Coronary Artery Disease", "Hypothyroidism",
    "Hyperthyroidism", "Chronic Kidney Disease", "Epilepsy", "Migraine",
    "Osteoarthritis", "Rheumatoid Arthritis", "GERD", "Peptic Ulcer Disease",
    "Anemia", "Obesity", "Hyperlipidemia", "Atrial Fibrillation",
    "Heart Failure", "Stroke", "Depression", "Anxiety Disorder",
    "Tuberculosis", "Hepatitis B", "Hepatitis C", "HIV", "Malaria",
    "Typhoid", "No significant medical history",
  ],
  history_present_illness: [
    "Sudden onset", "Gradual onset", "Worsening over time", "Improving",
    "Intermittent", "Continuous", "Acute onset", "Chronic duration",
    "Associated with exertion", "At rest", "Relieved by medication",
    "Not relieved by medication", "Aggravated by food", "Relieved by food",
    "Associated with fever", "Associated with chills", "Radiating to",
    "No radiation", "Severity: mild", "Severity: moderate", "Severity: severe",
    "Duration: since morning", "Duration: since 2 days", "Duration: since 1 week",
    "Duration: since 1 month", "No prior episodes", "Recurrent episodes",
  ],
  physical_examination: [
    "Conscious and oriented", "Well-nourished", "Moderately built",
    "Pallor present", "No pallor", "Icterus present", "No icterus",
    "Cyanosis absent", "Clubbing absent", "Lymphadenopathy absent",
    "Edema absent", "Edema bilateral feet", "Chest: clear to auscultation",
    "Chest: wheeze present", "Chest: crepitations present",
    "Abdomen: soft, non-tender", "Abdomen: tender epigastrium",
    "Abdomen: hepatomegaly", "Abdomen: splenomegaly",
    "CNS: no focal deficits", "CVS: S1 S2 normal", "No murmur",
    "Throat: congested", "Throat: normal", "Tonsils: enlarged",
  ],
  vital_signs: [
    "BP: 120/80 mmHg", "BP: 130/90 mmHg", "BP: 140/90 mmHg",
    "BP: 150/100 mmHg", "BP: 100/60 mmHg", "HR: 72 bpm", "HR: 88 bpm",
    "HR: 100 bpm", "HR: 110 bpm", "HR: 60 bpm", "RR: 18/min", "RR: 22/min",
    "Temp: 37.0°C (Afebrile)", "Temp: 38.0°C", "Temp: 38.5°C", "Temp: 39.0°C",
    "SpO2: 99% (Room Air)", "SpO2: 97% (Room Air)", "SpO2: 94% (Room Air)",
    "Weight: 60 kg", "Weight: 70 kg", "Weight: 80 kg",
    "Height: 165 cm", "BMI: 22.5 kg/m²",
  ],
  allergies: [
    "No known drug allergies (NKDA)", "Penicillin — rash",
    "Sulfonamides — rash", "NSAIDs — gastric upset", "Aspirin — bronchospasm",
    "Codeine — nausea", "Latex allergy", "Peanut allergy",
    "Dust allergy", "Pollen allergy", "Seafood allergy",
    "Egg allergy", "Milk allergy", "Contrast dye allergy",
  ],
  social_history: [
    "Non-smoker", "Smoker — 10 pack years", "Ex-smoker",
    "Non-alcoholic", "Occasional alcohol use", "Regular alcohol use",
    "No recreational drug use", "Sedentary lifestyle", "Active lifestyle",
    "Office worker", "Manual laborer", "Retired",
    "Married", "Single", "Lives alone", "Lives with family",
    "Good dietary habits", "High salt diet", "High fat diet",
    "No significant travel history",
  ],
  family_history: [
    "No significant family history", "Father: Hypertension",
    "Father: Diabetes", "Mother: Hypertension", "Mother: Diabetes",
    "Father: CAD", "Mother: CAD", "Family history of cancer",
    "Family history of Tuberculosis", "Family history of stroke",
    "Sibling: Asthma", "Family history of thyroid disorder",
    "Family history of epilepsy", "Family history of mental illness",
  ],
  diagnosis: [
    "Viral fever", "Bacterial infection", "Upper respiratory tract infection (URTI)",
    "Lower respiratory tract infection (LRTI)", "Community-acquired pneumonia",
    "Type 2 Diabetes Mellitus — uncontrolled", "Hypertension — stage 1",
    "Hypertension — stage 2", "Acute gastroenteritis", "Acute bronchitis",
    "Bronchial asthma — acute exacerbation", "GERD", "Peptic ulcer disease",
    "Urinary tract infection (UTI)", "Migraine", "Tension headache",
    "Iron deficiency anemia", "Hypothyroidism", "Dengue fever",
    "Malaria", "Typhoid fever", "COVID-19", "Anxiety disorder",
    "Depression", "Osteoarthritis — knee", "Lumbar spondylosis",
  ],
  additional_notes: [
    "Patient advised rest", "Dietary modifications advised",
    "Hydration advised — 2–3 L/day", "Avoid spicy food",
    "Avoid NSAIDs", "Avoid cold drinks", "Steam inhalation advised",
    "Saline nasal drops advised", "Warm salt water gargling advised",
    "Blood pressure monitoring at home", "Blood glucose monitoring advised",
    "Weight reduction advised", "Smoking cessation counseling given",
    "Alcohol cessation advised", "Physiotherapy referral given",
    "Ophthalmology referral given", "Cardiology referral given",
    "Patient educated about condition", "Prognosis explained",
  ],
  investigation: [
    "CBC (Complete Blood Count)", "ESR", "CRP", "Blood Culture & Sensitivity",
    "Urine Routine & Microscopy", "Urine Culture & Sensitivity",
    "Random Blood Sugar (RBS)", "Fasting Blood Sugar (FBS)",
    "HbA1c", "Lipid Profile", "LFT (Liver Function Tests)",
    "RFT (Renal Function Tests)", "Serum Electrolytes", "Thyroid Profile (T3/T4/TSH)",
    "ECG", "Chest X-Ray (PA view)", "USG Abdomen & Pelvis",
    "2D Echocardiogram", "CT Scan Head (plain)", "MRI Brain",
    "Serology: Dengue NS1 Antigen + IgM", "Widal Test",
    "Malaria Antigen Test (RDT)", "COVID-19 RT-PCR",
    "Sputum AFB (× 3 samples)", "Mantoux Test",
    "PT/INR", "APTT", "Serum Ferritin", "Peripheral Blood Smear",
  ],
  procedures: [
    "IV access secured", "IV Fluids: NS 500ml over 4 hours",
    "IV Fluids: RL 1L over 8 hours", "Nebulization with Salbutamol",
    "Nebulization with Ipratropium + Salbutamol",
    "Wound dressing done", "Suturing done under LA",
    "Foley's catheter inserted", "Ryle's tube inserted",
    "Oxygen by nasal cannula @ 2 L/min",
    "Oxygen by face mask @ 6 L/min",
    "Lumbar puncture done", "Pleural tapping done",
    "Ascitic tapping done", "ECG done",
    "Blood transfusion ordered", "Injection site: IM gluteal",
    "Peak flow measurement done",
  ],
  follow_up: [
    "Review after 3 days", "Review after 5 days", "Review after 1 week",
    "Review after 2 weeks", "Review after 1 month",
    "Review with investigation reports", "Review if symptoms worsen",
    "SOS visit if fever >39°C", "Return immediately if breathlessness",
    "Monitor BP daily and record", "Monitor blood sugar daily",
    "Follow-up with specialist as advised", "No follow-up needed if symptoms resolve",
    "Teleconsultation available if needed",
  ],
};

// ─── Section Definitions ──────────────────────────────────────────────────────
const LEFT_SECTIONS = [
  { id: "chief_complaint",           label: "Chief Complaint",              placeholder: "e.g. Fever for 3 days, headache..." },
  { id: "medical_history",           label: "Medical History",              placeholder: "e.g. Hypertension, Diabetes mellitus..." },
  { id: "history_present_illness",   label: "History of Present Illness",   placeholder: "Describe onset, duration, severity..." },
  { id: "physical_examination",      label: "Physical Examination",         placeholder: "General appearance, systemic exam findings..." },
  { id: "vital_signs",               label: "Vital Signs",                  placeholder: "BP, HR, RR, Temp, SpO2, Weight..." },
  { id: "allergies",                 label: "Allergies",                    placeholder: "Drug / food / environmental allergies..." },
  { id: "social_history",            label: "Social History",               placeholder: "Smoking, alcohol, occupation, lifestyle..." },
  { id: "family_history",            label: "Family History",               placeholder: "Relevant family medical conditions..." },
  { id: "diagnosis",                 label: "Diagnosis",                    placeholder: "Working or confirmed diagnosis..." },
  { id: "additional_notes",          label: "Additional Notes",             placeholder: "Any other relevant clinical information..." },
];

const RIGHT_SECTIONS = [
  { id: "rx",           label: "Rx — Prescriptions", placeholder: "Drug name, dose, frequency, route, duration...", multi: true },
  { id: "investigation",label: "Investigations",      placeholder: "CBC, LFT, RFT, X-Ray, MRI, ECG...",            multi: true },
  { id: "procedures",   label: "Procedures",          placeholder: "Planned or completed procedures...",            multi: true },
  { id: "follow_up",    label: "Follow Up",           placeholder: "Review in X days, instructions...",            multi: false },
];

const ALL_SECTIONS = [...LEFT_SECTIONS, ...RIGHT_SECTIONS];

// ─── Build letterpad text from entries ───────────────────────────────────────
function buildLetterpadText(entries) {
  if (entries.length === 0) return "";
  const grouped = {};
  entries.forEach((e) => {
    if (!grouped[e.sectionId]) grouped[e.sectionId] = [];
    grouped[e.sectionId].push(e.text);
  });
  const lines = [];
  ALL_SECTIONS.forEach((sec) => {
    const items = grouped[sec.id];
    if (!items || items.length === 0) return;
    lines.push(`${sec.label.toUpperCase()}`);
    if (sec.id === "rx") {
      lines.push(`  ${"#".padEnd(3)} ${"Drug/Generic".padEnd(22)} ${"Brand".padEnd(18)} ${"Dose".padEnd(10)} ${"Frequency".padEnd(12)} ${"Duration".padEnd(12)} Notes`);
      lines.push(`  ${"-".repeat(95)}`);
      items.forEach((item, idx) => {
        const parts = item.split("|");
        if (parts.length >= 4) {
          const [generic = "", brand = "", dose = "", freq = "", duration = "", notes = ""] = parts;
          lines.push(`  ${String(idx + 1).padEnd(3)} ${generic.padEnd(22)} ${brand.padEnd(18)} ${dose.padEnd(10)} ${freq.padEnd(12)} ${duration.padEnd(12)} ${notes}`);
        } else {
          lines.push(`  ${String(idx + 1).padEnd(3)} ${item}`);
        }
      });
    } else {
      items.forEach((item) => lines.push(`  • ${item}`));
    }
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

// ─── Parse Rx text into structured object ─────────────────────────────────────
function parseRxText(text) {
  if (text.includes("|")) {
    const parts = text.split("|").map((s) => s.trim());
    return {
      generic: parts[0] || "",
      brand: parts[1] || "",
      dose: parts[2] || "",
      freq: parts[3] || "",
      duration: parts[4] || "",
      notes: parts[5] || "",
      raw: text,
    };
  }
  return { raw: text, generic: text };
}

// ─── Rx Structured Row ────────────────────────────────────────────────────────
function RxRow({ entry, index, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false);
  const parsed = parseRxText(entry.text);
  const isStructured = entry.text.includes("|");
  const [form, setForm] = useState({
    generic: parsed.generic || "",
    brand: parsed.brand || "",
    dose: parsed.dose || "",
    freq: parsed.freq || "",
    duration: parsed.duration || "",
    notes: parsed.notes || "",
  });

  const saveEdit = () => {
    const structured = `${form.generic}|${form.brand}|${form.dose}|${form.freq}|${form.duration}|${form.notes}`;
    onEdit(entry.id, structured);
    setEditing(false);
  };

  if (editing) {
    return (
      <tr style={{ background: "#fffde7" }}>
        {["generic","brand","dose","freq","duration","notes"].map((field) => (
          <td key={field} style={{ padding: "4px 6px", borderBottom: "1px solid #e8e8e8" }}>
            <input
              value={form[field]}
              onChange={(e) => setForm((p) => ({ ...p, [field]: e.target.value }))}
              style={{
                width: "100%", border: `1px solid ${C.blueMid}`,
                borderRadius: 2, padding: "3px 6px",
                fontFamily: FONT, fontSize: 12, color: C.ink,
                outline: "none", minWidth: 50,
              }}
            />
          </td>
        ))}
        <td style={{ padding: "4px 6px", borderBottom: "1px solid #e8e8e8", whiteSpace: "nowrap" }}>
          <IconButton size="small" onClick={saveEdit} sx={{ width: 22, height: 22, color: C.greenMid }}>
            <CheckRounded sx={{ fontSize: 13 }} />
          </IconButton>
          <IconButton size="small" onClick={() => setEditing(false)} sx={{ width: 22, height: 22, color: C.silver }}>
            <CloseRounded sx={{ fontSize: 13 }} />
          </IconButton>
        </td>
      </tr>
    );
  }

  return (
    <tr
      style={{ background: index % 2 === 0 ? C.white : "#f9fbff" }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "#eef3ff"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = index % 2 === 0 ? C.white : "#f9fbff"; }}
    >
      <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef3ff", fontFamily: FONT, fontSize: 12.5, fontWeight: 500, color: C.ink }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
          <Box sx={{ width: 18, height: 18, borderRadius: "50%", background: C.blueDark, color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 9, fontWeight: 700, flexShrink: 0 }}>
            {index + 1}
          </Box>
          {isStructured ? parsed.generic : entry.text}
        </Box>
      </td>
      {isStructured && (
        <>
          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef3ff", fontFamily: FONT, fontSize: 12, color: C.smoke }}>{parsed.brand || "—"}</td>
          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef3ff", fontFamily: FONT, fontSize: 12, color: C.charcoal, fontWeight: 500 }}>{parsed.dose || "—"}</td>
          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef3ff" }}>
            <Box sx={{ display: "inline-flex", px: 1, py: 0.25, borderRadius: "10px", background: C.blue, color: C.blueDark, fontSize: 11, fontFamily: FONT, fontWeight: 500 }}>
              {parsed.freq || "—"}
            </Box>
          </td>
          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef3ff", fontFamily: FONT, fontSize: 12, color: C.smoke }}>{parsed.duration || "—"}</td>
          <td style={{ padding: "7px 10px", borderBottom: "1px solid #eef3ff", fontFamily: FONT, fontSize: 11, color: C.ash }}>{parsed.notes || "—"}</td>
        </>
      )}
      {!isStructured && (
        <td colSpan={5} style={{ padding: "7px 10px", borderBottom: "1px solid #eef3ff", fontFamily: FONT, fontSize: 11, color: C.ash, fontStyle: "italic" }}>
          (Free text — click edit to structure)
        </td>
      )}
      <td style={{ padding: "7px 6px", borderBottom: "1px solid #eef3ff", whiteSpace: "nowrap" }}>
        <IconButton size="small" onClick={() => { setForm({ generic: parsed.generic || "", brand: parsed.brand || "", dose: parsed.dose || "", freq: parsed.freq || "", duration: parsed.duration || "", notes: parsed.notes || "" }); setEditing(true); }} sx={{ width: 22, height: 22, color: C.silver, "&:hover": { color: C.blueMid } }}>
          <EditRounded sx={{ fontSize: 12 }} />
        </IconButton>
        <IconButton size="small" onClick={() => onDelete(entry.id)} sx={{ width: 22, height: 22, color: C.silver, "&:hover": { color: "#d32f2f" } }}>
          <DeleteOutlineRounded sx={{ fontSize: 12 }} />
        </IconButton>
      </td>
    </tr>
  );
}

// ─── Rx Panel ─────────────────────────────────────────────────────────────────
function RxPanel({
  entries, onEdit, onDelete, onOpenPopup, medicationCards, onAddFromSuggestion,
  allMedications, medicationSearch, setMedicationSearch, filteredMedications
}) {
  const rxEntries = entries.filter((e) => e.sectionId === "rx");

  return (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.white, overflow: "hidden" }}>
      {/* Header */}
      <Box sx={{ px: 2, py: 1.25, background: "linear-gradient(135deg, #1a56db08 0%, #eef3ff 100%)", borderBottom: `2px solid ${C.blueDark}22`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <MedicationRounded sx={{ fontSize: 16, color: C.blueDark }} />
          <Typography sx={{ ...os({ fontSize: 12, color: C.ink, fontWeight: 600 }) }}>
            Rx — Prescriptions
          </Typography>
          {rxEntries.length > 0 && (
            <Box sx={{ background: C.blue, color: C.blueDark, border: `1px solid #c7d9fb`, borderRadius: "10px", px: 1, fontSize: 10, fontFamily: FONT, fontWeight: 600 }}>
              {rxEntries.length}
            </Box>
          )}
        </Box>
        <Box component="button" type="button" onClick={onOpenPopup} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1.5, py: 0.5, border: `1px solid ${C.blueMid}`, borderRadius: "2px", background: C.white, color: C.blueDark, fontFamily: FONT, fontSize: 11, fontWeight: 500, cursor: "pointer", "&:hover": { background: C.blue }, transition: "all 0.12s" }}>
          <AddRounded sx={{ fontSize: 13 }} />
          Add Rx
        </Box>
      </Box>

      {/* Medication search */}
      <Box sx={{ p: 1.5, borderBottom: `1px solid ${C.fog}` }}>
        <input
          value={medicationSearch}
          onChange={(e) => setMedicationSearch(e.target.value)}
          placeholder="Search medication..."
          style={{ width: "100%", padding: "8px 12px", border: "1px solid #ddd", borderRadius: "4px", fontFamily: FONT, boxSizing: "border-box" }}
        />
      </Box>

      {medicationSearch && filteredMedications.length > 0 && (
        <Box sx={{ maxHeight: 250, overflowY: "auto", borderBottom: `1px solid ${C.fog}` }}>
          {filteredMedications.map((med, index) => (
            <Box key={index} sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", p: 1, borderBottom: "1px solid #eee" }}>
              <Box>
                <Typography fontSize={12}>{med.generic_name}</Typography>
                <Typography fontSize={11} color="text.secondary">{med.brand_name}</Typography>
              </Box>
              <Box component="button" type="button" onClick={() => {
                const rxText = [med.generic_name || "", med.brand_name || "", med.strength || "", med.frequency || "", med.duration || "", med.instructions || ""].join("|");
                onAddFromSuggestion("rx", rxText);
                setMedicationSearch("");
              }} sx={{ px: 1.5, py: 0.5, border: "none", borderRadius: "2px", background: C.blueDark, color: "#fff", cursor: "pointer" }}>
                Add
              </Box>
            </Box>
          ))}
        </Box>
      )}

      {/* Table or empty state */}
      {rxEntries.length === 0 ? (
        <Box sx={{ px: 3, py: 3, textAlign: "center", borderBottom: `1px solid ${C.fog}` }}>
          <MedicationRounded sx={{ fontSize: 28, color: C.mist, mb: 1 }} />
          <Typography sx={{ ...os({ fontSize: 12, color: C.silver }) }}>No prescriptions added yet</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.mist, mt: 0.5 }) }}>Click "Add Rx" or pick from AI suggestions below</Typography>
        </Box>
      ) : (
        <Box sx={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#f0f4ff" }}>
                {["Drug / Generic", "Brand", "Dose / Strength", "Frequency", "Duration", "Notes / Instructions", ""].map((h) => (
                  <th key={h} style={{ padding: "7px 10px", borderBottom: `2px solid ${C.blueDark}33`, fontFamily: FONT, fontSize: 10, fontWeight: 600, color: C.blueDark, textAlign: "left", textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rxEntries.map((entry, idx) => (
                <RxRow key={entry.id} entry={entry} index={idx} onEdit={onEdit} onDelete={onDelete} />
              ))}
            </tbody>
          </table>
        </Box>
      )}

      {/* AI Suggested */}
      {medicationCards.length > 0 && (
        <Box sx={{ borderTop: `1px solid ${C.fog}`, p: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: "#f59f00" }} />
            <Typography sx={{ ...os({ fontSize: 10, color: C.amberDark, textTransform: "uppercase", letterSpacing: "0.08em", fontWeight: 600 }) }}>
              AI Suggested — tap to add
            </Typography>
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 0.75 }}>
            {medicationCards.map((item, index) => (
              <SuggestedMedCard key={index} item={item} onAdd={onAddFromSuggestion} />
            ))}
          </Box>
        </Box>
      )}
    </Box>
  );
}

// ─── Suggested Med Card ────────────────────────────────────────────────────────
function SuggestedMedCard({ item, onAdd }) {
  const [expanded, setExpanded] = useState(false);
  const d = item.data;

  return (
    <Box sx={{ border: `1px solid ${C.amberDark}33`, borderRadius: "6px", background: C.amber, overflow: "hidden" }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, cursor: "pointer" }} onClick={() => setExpanded((p) => !p)}>
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ ...os({ fontSize: 12.5, fontWeight: 600, color: C.ink }), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {d["Generic Name"]}
          </Typography>
          <Box sx={{ display: "flex", gap: 0.75, mt: 0.25, flexWrap: "wrap" }}>
            {d["Strength"] && <Typography sx={{ ...os({ fontSize: 11, color: C.smoke }) }}>{d["Strength"]}</Typography>}
            {d["Frequency"] && <Box sx={{ background: C.amberDark + "22", color: C.amberDark, borderRadius: "8px", px: 0.75, fontSize: 10, fontFamily: FONT, fontWeight: 600 }}>{d["Frequency"]}</Box>}
            {d["Duration"] && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{d["Duration"]}</Typography>}
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash }) }}>{(item.score * 100).toFixed(0)}% match</Typography>
          <Box component="button" type="button" onClick={(e) => {
            e.stopPropagation();
            const rxText = [d["Generic Name"] || "", d["Brand Name (Common)"] || "", d["Strength"] || "", d["Frequency"] || "", d["Duration"] || "", d["Condition / Indication"] || ""].join("|");
            onAdd("rx", rxText);
          }} sx={{ display: "flex", alignItems: "center", gap: 0.4, px: 1.25, py: 0.4, border: "none", borderRadius: "2px", background: C.amberDark, color: C.white, fontFamily: FONT, fontSize: 11, fontWeight: 500, cursor: "pointer", "&:hover": { background: "#e08e00" }, transition: "background 0.12s" }}>
            <AddCircleOutlineRounded sx={{ fontSize: 12 }} />
            Add
          </Box>
        </Box>
      </Box>
      {expanded && (
        <Box sx={{ px: 1.5, pb: 1.25, borderTop: `1px solid ${C.amberDark}22` }}>
          <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 8 }}>
            <tbody>
              {[["Brand", d["Brand Name (Common)"]], ["Condition", d["Condition / Indication"]], ["Route", d["Route"]], ["Instructions", d["Instructions / Notes"]]].filter(([, v]) => v).map(([label, value]) => (
                <tr key={label}>
                  <td style={{ padding: "3px 0", fontFamily: FONT, fontSize: 10.5, color: C.ash, fontWeight: 600, width: 90, verticalAlign: "top" }}>{label}</td>
                  <td style={{ padding: "3px 0", fontFamily: FONT, fontSize: 11, color: C.charcoal }}>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      )}
    </Box>
  );
}

// ─── Entry Popup ──────────────────────────────────────────────────────────────
function EntryPopup({ open, section, entries, onClose, onAdd, onDelete, onEdit }) {
  const [value, setValue] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const inputRef = useRef(null);
  const searchRef = useRef(null);
  const [rxForm, setRxForm] = useState({ generic: "", brand: "", dose: "", freq: "", duration: "", notes: "" });

  useEffect(() => {
    if (open) {
      setValue("");
      setEditingId(null);
      setSearchQuery("");
      setRxForm({ generic: "", brand: "", dose: "", freq: "", duration: "", notes: "" });
      setTimeout(() => searchRef.current?.focus(), 120);
    }
  }, [open, section?.id]);

  if (!section) return null;
  const isRx = section.id === "rx";

  const suggestions = SUGGESTIONS[section.id] || [];
  const addedTexts = new Set(entries.filter((e) => e.sectionId === section.id).map((e) => e.text));
  const filteredSuggestions = suggestions.filter((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));

  const handleAdd = (text) => {
    const t = (text || value).trim();
    if (!t) return;
    onAdd(section.id, t);
    if (!text) { setValue(""); inputRef.current?.focus(); }
  };

  const handleAddRxForm = () => {
    if (!rxForm.generic.trim()) return;
    const rxText = [rxForm.generic, rxForm.brand, rxForm.dose, rxForm.freq, rxForm.duration, rxForm.notes].join("|");
    onAdd(section.id, rxText);
    setRxForm({ generic: "", brand: "", dose: "", freq: "", duration: "", notes: "" });
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleAdd(); }
    if (e.key === "Escape") onClose();
  };

  const startEdit = (entry) => { setEditingId(entry.id); setEditValue(entry.text); };
  const confirmEdit = (id) => { if (editValue.trim()) onEdit(id, editValue.trim()); setEditingId(null); };

  const sectionEntries = entries.filter((e) => e.sectionId === section.id);

  return (
    <Dialog open={open} onClose={onClose} maxWidth={isRx ? "md" : "sm"} fullWidth PaperProps={{ sx: { borderRadius: "4px", boxShadow: "0 20px 40px rgba(0,0,0,0.14)", border: `1px solid ${C.fog}`, fontFamily: FONT } }}>
      <DialogTitle sx={{ px: 3, py: 2, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 15, color: C.ink }) }}>{section.label}</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.3 }) }}>
            {isRx ? "Fill structured form or search suggestions" : "Search suggestions or type custom entry"}
          </Typography>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: C.ash, border: `1px solid ${C.fog}`, borderRadius: "2px" }}>
          <CloseRounded sx={{ fontSize: 16 }} />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ px: 3, py: 2.5, display: "flex", flexDirection: "column", gap: 2 }}>
        {/* Rx Structured Quick-Add */}
        {isRx && (
          <Box>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 }) }}>Quick Structured Entry</Typography>
            <Box sx={{ border: `1px solid ${C.mist}`, borderRadius: "4px", overflow: "hidden" }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr", gap: 0, borderBottom: `1px solid ${C.fog}`, background: "#f0f4ff" }}>
                {["Drug / Generic *", "Brand Name", "Dose", "Frequency", "Duration"].map((h) => (
                  <Box key={h} sx={{ px: 1.25, py: 0.75, borderRight: `1px solid ${C.fog}`, "&:last-child": { borderRight: "none" } }}>
                    <Typography sx={{ ...os({ fontSize: 9.5, color: C.blueDark, textTransform: "uppercase", letterSpacing: "0.06em", fontWeight: 600 }) }}>{h}</Typography>
                  </Box>
                ))}
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1.5fr 1fr 1fr 1fr", gap: 0 }}>
                {[["generic", "e.g. Paracetamol"], ["brand", "e.g. Crocin"], ["dose", "500mg"], ["freq", "TID"], ["duration", "5 days"]].map(([field, ph]) => (
                  <Box key={field} sx={{ borderRight: `1px solid ${C.fog}`, "&:last-child": { borderRight: "none" } }}>
                    <input value={rxForm[field]} onChange={(e) => setRxForm((p) => ({ ...p, [field]: e.target.value }))} placeholder={ph} onKeyDown={(e) => { if (e.key === "Enter") handleAddRxForm(); }} style={{ width: "100%", border: "none", padding: "8px 12px", fontFamily: FONT, fontSize: 12.5, fontWeight: 400, color: C.ink, background: "transparent", outline: "none", boxSizing: "border-box" }} />
                  </Box>
                ))}
              </Box>
              <Box sx={{ px: 1.5, py: 1, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", gap: 1 }}>
                <input value={rxForm.notes} onChange={(e) => setRxForm((p) => ({ ...p, notes: e.target.value }))} placeholder="Notes / Instructions (e.g. after food, empty stomach...)" style={{ flex: 1, border: `1px solid ${C.fog}`, borderRadius: 2, padding: "5px 10px", fontFamily: FONT, fontSize: 12, fontWeight: 300, color: C.ink, outline: "none", background: C.white }} />
                <Box component="button" type="button" onClick={handleAddRxForm} disabled={!rxForm.generic.trim()} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 2, py: 0.75, border: "none", borderRadius: "2px", background: rxForm.generic.trim() ? C.blueMid : C.mist, color: rxForm.generic.trim() ? C.white : C.silver, fontFamily: FONT, fontSize: 12, fontWeight: 400, cursor: rxForm.generic.trim() ? "pointer" : "not-allowed", transition: "all 0.14s", flexShrink: 0 }}>
                  <AddRounded sx={{ fontSize: 14 }} />
                  Add Row
                </Box>
              </Box>
            </Box>
          </Box>
        )}

        {/* Existing entries */}
        {sectionEntries.length > 0 && (
          <Box>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 }) }}>Added ({sectionEntries.length})</Typography>
            <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
              {sectionEntries.map((entry, idx) => (
                <Box key={entry.id} sx={{ display: "flex", alignItems: "flex-start", gap: 1, px: 2, py: 1, borderBottom: idx < sectionEntries.length - 1 ? `1px solid ${C.fog}` : "none", "&:hover": { background: C.ghost }, transition: "background 0.12s" }}>
                  <Box sx={{ width: 5, height: 5, borderRadius: "50%", background: C.blueMid, mt: 1, flexShrink: 0 }} />
                  {editingId === entry.id ? (
                    <Box sx={{ flex: 1, display: "flex", gap: 1 }}>
                      <textarea value={editValue} onChange={(e) => setEditValue(e.target.value)} autoFocus rows={2} style={{ flex: 1, padding: "6px 8px", border: `1px solid ${C.blueMid}`, borderRadius: "2px", fontFamily: FONT, fontSize: "13px", fontWeight: 300, color: C.ink, resize: "vertical", outline: "none" }} />
                      <IconButton size="small" onClick={() => confirmEdit(entry.id)} sx={{ color: "#2e7d32", width: 26, height: 26, mt: 0.5 }}>
                        <CheckRounded sx={{ fontSize: 14 }} />
                      </IconButton>
                    </Box>
                  ) : (
                    <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.5, flex: 1 }) }}>
                      {entry.text.includes("|") ? entry.text.split("|").filter(Boolean).join(" · ") : entry.text}
                    </Typography>
                  )}
                  {editingId !== entry.id && (
                    <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>
                      <IconButton size="small" onClick={() => startEdit(entry)} sx={{ width: 24, height: 24, color: C.silver, "&:hover": { color: C.blueMid } }}>
                        <EditRounded sx={{ fontSize: 13 }} />
                      </IconButton>
                      <IconButton size="small" onClick={() => onDelete(entry.id)} sx={{ width: 24, height: 24, color: C.silver, "&:hover": { color: "#d32f2f" } }}>
                        <DeleteOutlineRounded sx={{ fontSize: 13 }} />
                      </IconButton>
                    </Box>
                  )}
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* Suggestions */}
        {suggestions.length > 0 && (
          <Box>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 }) }}>Quick Add — Suggestions</Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, border: `1px solid ${C.mist}`, borderRadius: "4px", px: 1.5, py: 0.75, mb: 1.25, background: C.white, "&:focus-within": { borderColor: C.blueMid }, transition: "border-color 0.15s" }}>
              <SearchRounded sx={{ fontSize: 15, color: C.silver, flexShrink: 0 }} />
              <input ref={searchRef} value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder={`Search ${section.label.toLowerCase()}...`} style={{ flex: 1, border: "none", outline: "none", fontFamily: FONT, fontSize: "13px", fontWeight: 300, color: C.ink, background: "transparent" }} />
              {searchQuery && (
                <IconButton size="small" onClick={() => setSearchQuery("")} sx={{ width: 18, height: 18, color: C.silver }}>
                  <CloseRounded sx={{ fontSize: 12 }} />
                </IconButton>
              )}
            </Box>
            <Box sx={{ maxHeight: 160, overflowY: "auto", display: "flex", flexWrap: "wrap", gap: 0.75, pr: 0.5, "&::-webkit-scrollbar": { width: 4 }, "&::-webkit-scrollbar-thumb": { background: C.mist, borderRadius: 2 } }}>
              {filteredSuggestions.length === 0 ? (
                <Typography sx={{ ...os({ fontSize: 12, color: C.silver, py: 1 }) }}>No suggestions match "{searchQuery}"</Typography>
              ) : (
                filteredSuggestions.map((s) => {
                  const isAdded = addedTexts.has(s);
                  return (
                    <Box key={s} onClick={() => !isAdded && handleAdd(s)} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1.25, py: 0.5, border: isAdded ? `1px solid #c7d9fb` : `1px solid ${C.fog}`, borderRadius: "20px", background: isAdded ? C.blue : C.white, color: isAdded ? C.blueDark : C.charcoal, fontFamily: FONT, fontSize: "12px", fontWeight: isAdded ? 500 : 300, cursor: isAdded ? "default" : "pointer", userSelect: "none", transition: "all 0.12s", "&:hover": !isAdded ? { background: C.blue, borderColor: "#c7d9fb", color: C.blueDark } : {} }}>
                      {isAdded ? <CheckRounded sx={{ fontSize: 11, color: C.blueDark }} /> : <AddRounded sx={{ fontSize: 11, color: C.silver }} />}
                      {s}
                    </Box>
                  );
                })
              )}
            </Box>
          </Box>
        )}

        {/* Custom entry (non-Rx) */}
        {!isRx && (
          <Box>
            <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 }) }}>Custom Entry</Typography>
            <Box sx={{ border: `1px solid ${C.mist}`, borderRadius: "4px", overflow: "hidden", "&:focus-within": { borderColor: C.smoke }, transition: "border-color 0.15s" }}>
              <textarea ref={inputRef} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={handleKeyDown} placeholder={section.placeholder} rows={3} style={{ width: "100%", padding: "10px 14px", border: "none", background: C.white, fontFamily: FONT, fontSize: "13px", fontWeight: 300, color: C.ink, resize: "none", outline: "none", boxSizing: "border-box", lineHeight: 1.6, display: "block" }} />
              <Box sx={{ px: 1.5, py: 1, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>Enter to add · Shift+Enter for newline</Typography>
                <Box component="button" type="button" onClick={() => handleAdd()} disabled={!value.trim()} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 2, py: 0.7, border: "none", borderRadius: "2px", background: value.trim() ? C.blueMid : C.mist, color: value.trim() ? C.white : C.silver, fontFamily: FONT, fontSize: 12, fontWeight: 400, cursor: value.trim() ? "pointer" : "not-allowed", transition: "all 0.14s" }}>
                  <AddRounded sx={{ fontSize: 14 }} />
                  Add
                </Box>
              </Box>
            </Box>
          </Box>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost }}>
        <Box component="button" type="button" onClick={onClose} sx={{ px: 2.5, py: 0.9, border: `1px solid ${C.mist}`, borderRadius: "2px", background: C.white, color: C.charcoal, fontFamily: FONT, fontSize: 12, cursor: "pointer", "&:hover": { background: C.ghost } }}>
          Done
        </Box>
      </DialogActions>
    </Dialog>
  );
}

// ─── Section Row ──────────────────────────────────────────────────────────────
function SectionRow({ section, count, onClick }) {
  return (
    <Box onClick={onClick} sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", px: 1.5, py: 1, cursor: "pointer", borderBottom: `1px solid ${C.fog}`, "&:last-child": { borderBottom: "none" }, "&:hover": { background: C.blue }, transition: "background 0.12s", gap: 1 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, minWidth: 0 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: "50%", flexShrink: 0, background: count > 0 ? C.blueMid : C.mist, transition: "background 0.15s" }} />
        <Typography sx={{ ...os({ fontSize: 12.5, color: C.charcoal }), whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
          {section.label}
        </Typography>
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0 }}>
        {count > 0 && (
          <Box sx={{ background: C.blue, color: C.blueDark, border: `1px solid #c7d9fb`, borderRadius: "10px", px: 0.9, py: 0.1, fontSize: 11, fontFamily: FONT, fontWeight: 500, minWidth: 20, textAlign: "center" }}>
            {count}
          </Box>
        )}
        <AddRounded sx={{ fontSize: 15, color: count > 0 ? C.blueMid : C.silver }} />
      </Box>
    </Box>
  );
}

// ─── Side Panel ───────────────────────────────────────────────────────────────
function SidePanel({ title, sections, entryCounts, onSectionClick }) {
  return (
    <Box sx={{ width: { xs: "100%", md: 210 }, flexShrink: 0, border: `1px solid ${C.fog}`, borderRadius: "4px", background: C.white, overflow: "hidden", alignSelf: "flex-start" }}>
      <Box sx={{ px: 1.5, py: 1.25, borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.08em" }) }}>
          {title}
        </Typography>
      </Box>
      {sections.map((s) => (
        <SectionRow key={s.id} section={s} count={entryCounts[s.id] || 0} onClick={() => onSectionClick(s)} />
      ))}
    </Box>
  );
}

// ─── Main ManualPanel ─────────────────────────────────────────────────────────
export default function ManualPanel({ onTranscribe, doctorId, patientId }) {
  const [entries, setEntries] = useState([]);
  const [popupSection, setPopupSection] = useState(null);
  const [manualText, setManualText] = useState("");
  // Track whether the user has manually edited the textarea (to avoid overwriting their edits)
  const [userEditedText, setUserEditedText] = useState(false);
  const [isSynced, setIsSynced] = useState(false);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveOk, setSaveOk] = useState(false);
  const [loading, setLoading] = useState(false);
  const [medicationCards, setMedicationCards] = useState([]);
  const [allMedications, setAllMedications] = useState([]);
  const [medicationSearch, setMedicationSearch] = useState("");
  const textareaRef = useRef(null);

  console.log(doctorId);

  // ── Load from DB ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!doctorId || !patientId) return;
    const load = async () => {
      setLoading(true);
      try {
        const res = await fetch(`${API_BASE_URL}hms/users/data/context/manual_note/get/${patientId}/${doctorId}`);
        if (!res.ok) return;
        const json = await res.json();
        if (json?.entries && Array.isArray(json.entries)) {
          setEntries(json.entries);
          // Rebuild textarea from loaded entries
          setManualText(buildLetterpadText(json.entries));
          setUserEditedText(false);
        }
        if (json?.manual_text && (!json.entries || json.entries.length === 0)) {
          setManualText(json.manual_text);
          setIsSynced(true);
        }
      } catch (_) {}
      finally { setLoading(false); }
    };
    load();
  }, [doctorId, patientId]);

  // ── Load all medications ──────────────────────────────────────────────────
  useEffect(() => {
    if (!doctorId) return;
    const loadAllMedications = async () => {
      try {
        const response = await fetch(`${API_BASE_URL}hms/users/speciality/all_medications/${doctorId}`);
        const data = await response.json();
        setAllMedications(Array.isArray(data) ? data : []);
      } catch (err) {
        console.error(err);
        setAllMedications([]);
      }
    };
    loadAllMedications();
  }, [doctorId]);

  // ── KEY FIX: Rebuild textarea whenever entries change ─────────────────────
  useEffect(() => {
    if (entries.length === 0) return;
    const rebuilt = buildLetterpadText(entries);
    setManualText(rebuilt);
    setIsSynced(false);
    setUserEditedText(false);
  }, [entries]);

  // ── Fetch medication suggestions for diagnosis ───────────────────────────
  const fetchMedications = async (diagnosis) => {
    console.log("doctorId =", doctorId);
    try {
      const response = await fetch(`${API_BASE_URL}hms/users/speciality/search_medical_rag`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, query: diagnosis, top_k: 5 }),
      });
      const data = await response.json();
      console.log(data);
      setMedicationCards(data.results || []);
    } catch (error) {
      console.error(error);
    }
  };

  // ── Save to DB ────────────────────────────────────────────────────────────
  const saveToDb = useCallback(async () => {
    if (!doctorId || !patientId) return;
    setSaving(true);
    try {
      await fetch(`${API_BASE_URL}hms/users/data/context/manual_note/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, entries, manual_text: manualText }),
      });
      setSaveOk(true);
      setIsSynced(true);
      setTimeout(() => setSaveOk(false), 2000);
    } catch (_) {}
    finally { setSaving(false); }
  }, [doctorId, patientId, entries, manualText]);

  // ── CRUD ──────────────────────────────────────────────────────────────────
  const handleAdd = (sectionId, text) => {
    setEntries((prev) => [...prev, { id: `${sectionId}_${Date.now()}`, sectionId, text }]);
    if (sectionId === "diagnosis") fetchMedications(text);
  };

  const handleDelete = (id) => {
    setEntries((prev) => {
      const updated = prev.filter((e) => e.id !== id);
      // If all entries gone, clear textarea
      if (updated.length === 0) setManualText("");
      return updated;
    });
  };

  const handleEdit = (id, newText) => {
    setEntries((prev) => prev.map((e) => (e.id === id ? { ...e, text: newText } : e)));
  };

  // ── Copy ──────────────────────────────────────────────────────────────────
  const handleCopy = () => {
    if (!manualText.trim()) return;
    navigator.clipboard.writeText(manualText).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  // ── Process ───────────────────────────────────────────────────────────────
  const handleProcess = () => {
    if (!manualText.trim()) return;
    saveToDb();
    if (onTranscribe) onTranscribe({ dictation: manualText, output_json: null });
  };

  // ── Filtered medications ──────────────────────────────────────────────────
  const filteredMedications = allMedications
    .filter((med) => {
      const search = medicationSearch.toLowerCase();
      return med.generic_name?.toLowerCase().includes(search) || med.brand_name?.toLowerCase().includes(search);
    })
    .slice(0, 20);

  const entryCounts = {};
  ALL_SECTIONS.forEach((s) => { entryCounts[s.id] = entries.filter((e) => e.sectionId === s.id).length; });
  const totalEntries = entries.length;

  const rightPanelSections = RIGHT_SECTIONS.filter((s) => s.id !== "rx");

  return (
    <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" }, gap: 2, alignItems: { xs: "stretch", md: "flex-start" }, width: "100%" }}>

      {/* Left panel */}
      <SidePanel
        title="Clinical History"
        sections={LEFT_SECTIONS}
        entryCounts={entryCounts}
        onSectionClick={(s) => setPopupSection(s)}
      />

      {/* Center */}
      <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1.5 }}>

        {/* Toolbar */}
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
            {loading ? "Loading saved note..." : totalEntries === 0 ? "Click any section to add entries" : `${totalEntries} entr${totalEntries === 1 ? "y" : "ies"} · ${isSynced ? "Saved" : "Unsaved changes"}`}
          </Typography>
          <Box sx={{ display: "flex", gap: 0.75 }}>
            <Tooltip title={copied ? "Copied!" : "Copy note"}>
              <IconButton size="small" onClick={handleCopy} disabled={!manualText} sx={{ width: 28, height: 28, borderRadius: "2px", border: `1px solid ${C.fog}`, color: copied ? "#2e7d32" : C.ash }}>
                {copied ? <CheckRounded sx={{ fontSize: 14 }} /> : <ContentCopyRounded sx={{ fontSize: 14 }} />}
              </IconButton>
            </Tooltip>
            <Tooltip title={saving ? "Saving..." : saveOk ? "Saved!" : "Save note"}>
              <IconButton size="small" onClick={saveToDb} sx={{ width: 28, height: 28, borderRadius: "2px", border: `1px solid ${C.fog}`, color: saveOk ? "#2e7d32" : C.ash }}>
                {saving ? <RefreshRounded sx={{ fontSize: 14, animation: "spin 1s linear infinite" }} /> : saveOk ? <CheckRounded sx={{ fontSize: 14 }} /> : <SaveRounded sx={{ fontSize: 14 }} />}
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {/* Letterpad */}
        <Box sx={{ border: `1px solid ${C.mist}`, borderRadius: "4px", overflow: "hidden", background: C.white, boxShadow: "0 2px 8px rgba(0,0,0,0.06)" }}>
          {/* Header */}
          <Box sx={{ px: 3, py: 2, borderBottom: `2px solid #1a56db22`, background: "linear-gradient(135deg, #eef3ff 0%, #f8faff 100%)", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
            <Box>
              <Typography sx={{ ...os({ fontSize: 15, color: C.ink, letterSpacing: "0.02em", fontWeight: 500 }) }}>DoctorAssist.AI</Typography>
              <Typography sx={{ ...os({ fontSize: 10.5, color: C.ash, letterSpacing: "0.04em" }) }}>Clinical Consultation Note</Typography>
            </Box>
            <Box sx={{ textAlign: "right" }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                {new Date().toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "long", day: "numeric" })}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.75, mt: 0.5, justifyContent: "flex-end" }}>
                <Box sx={{ background: "#e8f0fe", color: "#1a56db", border: "1px solid #c7d9fb", borderRadius: "10px", px: 1.2, py: 0.15, fontSize: 10, fontFamily: FONT }}>MANUAL</Box>
              </Box>
            </Box>
          </Box>

          {/* Lined textarea */}
          <Box sx={{ display: "flex", position: "relative" }}>
            <Box sx={{ width: 3, flexShrink: 0, background: "#e8344020", borderRight: "1.5px solid #e834401a", minHeight: 280 }} />
            <Box sx={{ flex: 1, position: "relative" }}>
              <textarea
                ref={textareaRef}
                value={manualText}
                onChange={(e) => {
                  setManualText(e.target.value);
                  setIsSynced(false);
                  setUserEditedText(true);
                }}
                placeholder={"Click sections on the left and right panels to add entries.\n\nCHIEF COMPLAINT\n  • Fever for 3 days\n\nDIAGNOSIS\n  • Viral fever\n\nRx — PRESCRIPTIONS\n  #   Drug/Generic           Brand              Dose       Frequency    Duration     Notes\n  --- -----------------------------------------------------------------------\n  1   Paracetamol            Crocin             500mg      TID          5 days       After food"}
                rows={14}
                style={{
                  width: "100%", padding: "16px 20px",
                  border: "none",
                  background: "repeating-linear-gradient(transparent, transparent 27px, #e8f0fe44 28px)",
                  fontFamily: '"Courier New", Courier, monospace',
                  fontSize: "12.5px", fontWeight: 400, color: C.ink,
                  resize: "vertical", outline: "none",
                  boxSizing: "border-box", lineHeight: "28px",
                  display: "block", minHeight: 280,
                }}
              />
            </Box>
          </Box>

          {/* Footer */}
          <Box sx={{ px: 3, py: 1.5, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1 }}>
            <Typography sx={{ ...os({ fontSize: 10.5, color: C.silver }) }}>
              {manualText.trim() ? `${manualText.split("\n").filter((l) => l.trim()).length} lines · ${manualText.length} chars` : "Empty note"}
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Box component="button" type="button" onClick={saveToDb} disabled={saving || !manualText.trim()} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 2, py: 0.75, border: `1px solid ${C.mist}`, borderRadius: "2px", background: C.white, color: C.smoke, fontFamily: FONT, fontSize: 11, cursor: manualText.trim() ? "pointer" : "not-allowed", "&:hover": manualText.trim() ? { background: C.fog } : {} }}>
                <SaveRounded sx={{ fontSize: 13 }} />
                Save Draft
              </Box>
              <Box component="button" type="button" onClick={handleProcess} disabled={!manualText.trim()} sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 2.5, py: 0.75, border: "none", borderRadius: "2px", background: manualText.trim() ? "#1a56db" : C.mist, color: manualText.trim() ? C.white : C.silver, fontFamily: FONT, fontSize: 12, fontWeight: 400, cursor: manualText.trim() ? "pointer" : "not-allowed", transition: "background 0.15s", "&:hover": manualText.trim() ? { background: "#1445b8" } : {} }}>
                Process Note →
              </Box>
            </Box>
          </Box>
        </Box>

        {/* Rx Panel */}
        <RxPanel
          entries={entries}
          onEdit={handleEdit}
          onDelete={handleDelete}
          onOpenPopup={() => setPopupSection(RIGHT_SECTIONS.find((s) => s.id === "rx"))}
          medicationCards={medicationCards}
          onAddFromSuggestion={handleAdd}
          allMedications={allMedications}
          medicationSearch={medicationSearch}
          setMedicationSearch={setMedicationSearch}
          filteredMedications={filteredMedications}
        />
      </Box>

      {/* Right panel */}
      <SidePanel
        title="Rx & Investigations"
        sections={rightPanelSections}
        entryCounts={entryCounts}
        onSectionClick={(s) => setPopupSection(s)}
      />

      {/* Entry Popup */}
      <EntryPopup
        open={Boolean(popupSection)}
        section={popupSection}
        entries={entries}
        onClose={() => setPopupSection(null)}
        onAdd={handleAdd}
        onDelete={handleDelete}
        onEdit={handleEdit}
      />

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}