import React, { useState, useMemo } from "react";
import {
  Box,
  Typography,
  Button,
  TextField,
  Select,
  MenuItem,
  Autocomplete,
  IconButton,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableCell,
  TableContainer,
} from "@mui/material";
import { Add, Remove, CloseRounded } from "@mui/icons-material";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

// ─── Protocol quick-fill dictionary (used when typing a known protocol name) ──
const PROTOCOL_DICTIONARY = {
  "FOLFOX": [
    { id: 1, name: "Oxaliplatin", type: "systemic", dose: "85", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "d5", volume: "250", duration: "120", instructions: "Given concurrently with Leucovorin" },
    { id: 2, name: "Leucovorin", type: "systemic", dose: "400", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "d5", volume: "250", duration: "120", instructions: "Given concurrently with Oxaliplatin" },
    { id: 3, name: "Fluorouracil (Bolus)", type: "systemic", dose: "400", unit: "m2", maxDose: "", route: "iv", adminType: "bolus", frequency: "od", diluent: "ns", volume: "50", duration: "stat", instructions: "Give over 5 mins" },
    { id: 4, name: "Fluorouracil (Infusion)", type: "systemic", dose: "2400", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "ns", volume: "500", duration: "46", instructions: "Continuous infusion over 46 hours via pump" }
  ],
  "CHOP": [
    { id: 1, name: "Cyclophosphamide", type: "systemic", dose: "750", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "ns", volume: "250", duration: "60", instructions: "" },
    { id: 2, name: "Doxorubicin", type: "systemic", dose: "50", unit: "m2", maxDose: "", route: "iv", adminType: "bolus", frequency: "od", diluent: "ns", volume: "50", duration: "15", instructions: "Push slowly" },
    { id: 3, name: "Vincristine", type: "systemic", dose: "1.4", unit: "m2", maxDose: "2", route: "iv", adminType: "bolus", frequency: "od", diluent: "ns", volume: "50", duration: "10", instructions: "Max dose 2mg" },
    { id: 4, name: "Prednisolone", type: "systemic", dose: "100", unit: "mg", maxDose: "", route: "oral", adminType: "bolus", frequency: "od", diluent: "", volume: "", duration: "", instructions: "Days 1-5" }
  ],
  "AC-T": [
    { id: 1, name: "Doxorubicin", type: "systemic", dose: "60", unit: "m2", maxDose: "", route: "iv", adminType: "bolus", frequency: "od", diluent: "ns", volume: "50", duration: "15", instructions: "" },
    { id: 2, name: "Cyclophosphamide", type: "systemic", dose: "600", unit: "m2", maxDose: "", route: "iv", adminType: "infusion", frequency: "od", diluent: "ns", volume: "250", duration: "60", instructions: "" }
  ]
};

const hasValueLocal = (value) => {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  if (typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) return false;
  return true;
};

// ─── Add / Edit Protocol form helpers ──────────────────────────────────
const splitCsv = (str) => (str || "").split(",").map(s => s.trim()).filter(Boolean);

const emptyDrugRow = () => ({
  id: Date.now() + Math.random(),
  name: "", dose: "", unit: "m2", route: "iv", day: "1", adminType: "infusion", duration: ""
});

const emptyRuleRow = () => ({ id: Date.now() + Math.random(), key: "", value: "" });

const emptyProtocolForm = () => ({
  protocol_id: "",
  protocol_name: "",
  display_name: "",
  aliases: "",
  disease_sites: "",
  histology: "",
  intent: "",
  regimen_type: "",
  standard_cycles: "",
  cycle_interval_days: "",
  drug_schedule: [emptyDrugRow()],
  premedications: "",
  hydration: "",
  supportive_care: "",
  dose_adjustment_rules: [emptyRuleRow()],
  laboratory_requirements: "",
  references: "",
  version: "1.0",
  status: "active",
});

// Raw protocol_master document → editable form state
const protocolDocToFormState = (doc) => ({
  protocol_id: doc.protocol_id || "",
  protocol_name: doc.protocol_name || "",
  display_name: doc.display_name || "",
  aliases: (doc.aliases || []).join(", "),
  disease_sites: (doc.disease_sites || []).join(", "),
  histology: Array.isArray(doc.histology) ? doc.histology.join(", ") : (doc.histology || ""),
  intent: (doc.intent || []).join(", "),
  regimen_type: doc.regimen_type || "",
  standard_cycles: doc.standard_cycles != null ? String(doc.standard_cycles) : "",
  cycle_interval_days: doc.cycle_interval_days != null ? String(doc.cycle_interval_days) : "",
  drug_schedule: (doc.drug_schedule && doc.drug_schedule.length > 0)
    ? doc.drug_schedule.map((d, i) => ({
        id: Date.now() + i,
        name: d.name || "", dose: d.dose || "", unit: d.unit || "",
        route: d.route || "", day: d.day || "", adminType: d.adminType || "", duration: d.duration || ""
      }))
    : [emptyDrugRow()],
  premedications: (doc.premedications || []).join(", "),
  hydration: (doc.hydration || []).join(", "),
  supportive_care: (doc.supportive_care || []).join(", "),
  dose_adjustment_rules: (doc.dose_adjustment_rules && Object.keys(doc.dose_adjustment_rules).length > 0)
    ? Object.entries(doc.dose_adjustment_rules).map(([k, v], i) => ({
        id: Date.now() + i, key: k, value: typeof v === "object" ? JSON.stringify(v) : String(v)
      }))
    : [emptyRuleRow()],
  laboratory_requirements: (doc.laboratory_requirements || []).join(", "),
  references: (doc.references || []).join(", "),
  version: doc.version || "1.0",
  status: doc.status || "active",
});

// Editable form state → payload matching the backend ProtocolMaster model
const formStateToProtocolDoc = (form) => ({
  protocol_id: form.protocol_id.trim(),
  protocol_name: form.protocol_name.trim(),
  display_name: form.display_name.trim() || form.protocol_name.trim(),
  aliases: splitCsv(form.aliases),
  disease_sites: splitCsv(form.disease_sites),
  histology: form.histology.trim() || null,
  intent: splitCsv(form.intent),
  regimen_type: form.regimen_type.trim(),
  standard_cycles: form.standard_cycles ? parseInt(form.standard_cycles, 10) : null,
  cycle_interval_days: parseInt(form.cycle_interval_days, 10) || 0,
  drug_schedule: form.drug_schedule
    .filter(d => d.name.trim())
    .map(d => ({
      name: d.name.trim(),
      dose: d.dose.trim(),
      unit: d.unit.trim(),
      route: d.route.trim(),
      day: d.day.trim(),
      adminType: d.adminType.trim() || null,
      duration: d.duration.trim() || null,
    })),
  premedications: splitCsv(form.premedications),
  hydration: splitCsv(form.hydration),
  supportive_care: splitCsv(form.supportive_care),
  dose_adjustment_rules: form.dose_adjustment_rules
    .filter(r => r.key.trim())
    .reduce((acc, r) => { acc[r.key.trim()] = r.value; return acc; }, {}),
  laboratory_requirements: splitCsv(form.laboratory_requirements),
  references: splitCsv(form.references),
  version: form.version.trim() || "1.0",
  status: form.status || "active",
});

/**
 * ProtocolMasterTab
 *
 * Encapsulates the entire "Part A — Protocol Master" section of the
 * OPRecord chemotherapy workflow: intent/protocol/cycle fields, the
 * protocol library browser dialog, the protocol detail/adaptation
 * dialog, and the AI regimen-suggestion flow.
 *
 * Shared style constants and small presentational components are passed
 * in as props so this file doesn't need to duplicate them.
 */
const ProtocolMasterTab = ({
  // data
  formData,
  setFormData,
  handleUpdate,
  dbCycles,
  treatment,
  setTreatment,
  patientId,
  doctorId,

  // shared presentational components
  SectionHeader,
  FieldRow,
  CustomRadio,
  ProtocolHistoryTable,
  FieldLine,

  // shared style objects/constants
  btnStyle,
  inputStyle,
  invThSx,
  invTdSx,
  C,
  FONT,
  FW_MEDIUM,
}) => {
  const [regimenSuggestion, setRegimenSuggestion] = useState(null);
  const [regimenSuggestLoading, setRegimenSuggestLoading] = useState(false);
  const [regimenSuggestError, setRegimenSuggestError] = useState(null);

  const [protocolDialogOpen, setProtocolDialogOpen] = useState(false);
  const [protocolDetailOpen, setProtocolDetailOpen] = useState(false);
  const [protocolDetailLoading, setProtocolDetailLoading] = useState(false);
  const [protocolDetailData, setProtocolDetailData] = useState(null); // full protocol_master doc
  const [protocolAdaptation, setProtocolAdaptation] = useState(null); // { clinicalContext, llmOutput, adaptedRegimen }
  const [protocolDetailError, setProtocolDetailError] = useState(null);
  const [protocolList, setProtocolList] = useState([]);
  const [protocolLoading, setProtocolLoading] = useState(false);
  const [protocolSearch, setProtocolSearch] = useState("");
  const [protocolSelecting] = useState(null);

  // ── Add / Edit Protocol form ──────────────────────────────────────
  const [protocolFormDialogOpen, setProtocolFormDialogOpen] = useState(false);
  const [protocolFormMode, setProtocolFormMode] = useState("add"); // "add" | "edit"
  const [protocolForm, setProtocolForm] = useState(emptyProtocolForm());
  const [protocolSaving, setProtocolSaving] = useState(false);
  const [protocolSaveError, setProtocolSaveError] = useState(null);
  const [protocolSaveSuccessMsg, setProtocolSaveSuccessMsg] = useState(null);

  const sectionLabelSx = { fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 };

  const mergedProtocolView = useMemo(() => {
    const master = protocolDetailData || {};
    const adapted = protocolAdaptation?.adaptedRegimen || {};
    if (Object.keys(master).length === 0 && Object.keys(adapted).length === 0) return null;

    return {
      protocolName: adapted.selectedProtocol || master.protocol_name,
      displayName: master.display_name,
      protocolId: master.protocol_id,
      diseaseSites: master.disease_sites,
      histology: master.histology,
      treatmentIntent: adapted.treatmentIntent || (Array.isArray(master.intent) ? master.intent.join(", ") : master.intent),
      regimenType: master.regimen_type,
      standardCycles: adapted.plannedCycles || master.standard_cycles,
      cycleIntervalDays: adapted.daysBetweenCycles || master.cycle_interval_days,
      version: master.version,
      status: master.status,
      startDate: adapted.startDate,
      concurrentTherapy: adapted.concurrentTherapy,
      reasonForChange: adapted.reasonForChange,
      safetyFlags: adapted.safetyFlags,
      drugSchedule: (adapted.drugs && adapted.drugs.length > 0) ? adapted.drugs : master.drug_schedule,
      premedications: master.premedications,
      hydration: master.hydration,
      supportiveCare: master.supportive_care,
      laboratoryRequirements: master.laboratory_requirements,
      references: master.references,
      doseAdjustmentRules: master.dose_adjustment_rules,
      doseAdjustments: adapted.doseAdjustments,
    };
  }, [protocolDetailData, protocolAdaptation]);

  const fetchRegimenSuggestion = async () => {
    setRegimenSuggestLoading(true);
    setRegimenSuggestError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/extract-regimen-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId })
      });
      const json = await res.json();
      if (json.status === "success") {
        setRegimenSuggestion(json.data || null);
      } else {
        setRegimenSuggestError(json.detail || "Could not extract regimen fields.");
      }
    } catch (err) {
      console.error("[ProtocolMasterTab] Regimen suggestion failed:", err);
      setRegimenSuggestError("Network error while fetching suggestion.");
    } finally {
      setRegimenSuggestLoading(false);
    }
  };

  const openProtocolBrowser = async () => {
    setProtocolDialogOpen(true);
    setProtocolLoading(true);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/data/protocol_master/protocol-master/list?patient_id=${patientId}`
      );
      const json = await res.json();
      if (json.status === "success") setProtocolList(json.data);
    } catch (err) {
      console.error("Failed to load protocol list:", err);
    } finally {
      setProtocolLoading(false);
    }
  };

  const viewProtocolDetail = async (protocolId) => {
    setProtocolDetailOpen(true);
    setProtocolDetailLoading(true);
    setProtocolDetailError(null);
    setProtocolDetailData(null);
    setProtocolAdaptation(null);
    try {
      const [detailRes, selectRes] = await Promise.all([
        fetch(`${API_BASE_URL}hms/users/data/protocol_master/protocol-master/${protocolId}`).then(r => r.json()),
        fetch(`${API_BASE_URL}hms/users/data/protocol_master/protocol-master/select`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ patientId, doctorId, protocolId })
        }).then(r => r.json())
      ]);

      if (detailRes.status === "success") setProtocolDetailData(detailRes.data);
      if (selectRes.status === "success") {
        setProtocolAdaptation(selectRes);
      } else {
        setProtocolDetailError(selectRes.detail || "Could not run LLM adaptation.");
      }
    } catch (err) {
      console.error("Protocol detail fetch failed:", err);
      setProtocolDetailError("Network error loading protocol details.");
    } finally {
      setProtocolDetailLoading(false);
    }
  };

  const applyProtocolData = (s) => {
    const formatDateForInput = (dateStr) => {
      if (!dateStr) return dateStr;
      const parts = dateStr.split('-');
      if (parts.length === 3 && parts[0].length === 2 && parts[1].length === 2 && parts[2].length === 4) {
        return `${parts[2]}-${parts[1]}-${parts[0]}`;
      }
      return dateStr;
    };
    setFormData(prev => ({
      ...prev,
      partA: {
        ...prev.partA,
        intent: s.treatmentIntent || prev.partA.intent,
        protocolName: s.selectedProtocol || prev.partA.protocolName,
        chemoType: s.typeOfChemotherapy || s.chemoType || prev.partA.chemoType,
        startDate: formatDateForInput(s.startDate) || prev.partA.startDate,
        cycles: s.plannedCycles ? String(s.plannedCycles) : prev.partA.cycles,
        daysBetween: s.daysBetweenCycles ? String(s.daysBetweenCycles) : prev.partA.daysBetween,
        protocolDetails: s.protocolDetails || prev.partA.protocolDetails,
        doseAdjustments: s.doseAdjustments || prev.partA.doseAdjustments,
        concurrentTherapy: s.concurrentTherapy || prev.partA.concurrentTherapy,
        protocolMasterRef: s.protocolMasterRef || prev.partA.protocolMasterRef,
        drugs: (s.drugs && s.drugs.length > 0)
          ? s.drugs.map((d, i) => ({ id: Date.now() + i, ...d }))
          : prev.partA.drugs
      }
    }));
    setProtocolDialogOpen(false);
    setProtocolDetailOpen(false);
  };

  // ── Add / Edit Protocol handlers ──────────────────────────────────
  const openAddProtocolForm = () => {
    setProtocolForm(emptyProtocolForm());
    setProtocolFormMode("add");
    setProtocolSaveError(null);
    setProtocolSaveSuccessMsg(null);
    setProtocolFormDialogOpen(true);
  };

  const openEditProtocolForm = () => {
    if (!protocolDetailData) return;
    setProtocolForm(protocolDocToFormState(protocolDetailData));
    setProtocolFormMode("edit");
    setProtocolSaveError(null);
    setProtocolSaveSuccessMsg(null);
    setProtocolFormDialogOpen(true);
  };

  const updateProtocolFormField = (field, value) => setProtocolForm(prev => ({ ...prev, [field]: value }));

  const updateDrugRow = (index, field, value) => {
    setProtocolForm(prev => {
      const rows = [...prev.drug_schedule];
      rows[index] = { ...rows[index], [field]: value };
      return { ...prev, drug_schedule: rows };
    });
  };
  const addDrugRow = () => setProtocolForm(prev => ({ ...prev, drug_schedule: [...prev.drug_schedule, emptyDrugRow()] }));
  const removeDrugRow = (index) => setProtocolForm(prev => ({ ...prev, drug_schedule: prev.drug_schedule.filter((_, i) => i !== index) }));

  const updateRuleRow = (index, field, value) => {
    setProtocolForm(prev => {
      const rows = [...prev.dose_adjustment_rules];
      rows[index] = { ...rows[index], [field]: value };
      return { ...prev, dose_adjustment_rules: rows };
    });
  };
  const addRuleRow = () => setProtocolForm(prev => ({ ...prev, dose_adjustment_rules: [...prev.dose_adjustment_rules, emptyRuleRow()] }));
  const removeRuleRow = (index) => setProtocolForm(prev => ({ ...prev, dose_adjustment_rules: prev.dose_adjustment_rules.filter((_, i) => i !== index) }));

  const saveProtocol = async () => {
    setProtocolSaveError(null);

    if (!protocolForm.protocol_id.trim() || !protocolForm.protocol_name.trim() || !protocolForm.regimen_type.trim() || !protocolForm.cycle_interval_days) {
      setProtocolSaveError("Protocol ID, Protocol Name, Regimen Type, and Cycle Interval (days) are required.");
      return;
    }

    const payload = formStateToProtocolDoc(protocolForm);

    if (payload.drug_schedule.length === 0) {
      setProtocolSaveError("Add at least one drug with a name in the Drug Schedule.");
      return;
    }

    setProtocolSaving(true);
    try {
      const isAdd = protocolFormMode === "add";
      const url = isAdd
        ? `${API_BASE_URL}hms/users/data/protocol_master/protocol-master`
        : `${API_BASE_URL}hms/users/data/protocol_master/protocol-master/${encodeURIComponent(payload.protocol_id)}`;
      const method = isAdd ? "POST" : "PUT";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || json.status === "error") {
        setProtocolSaveError(json.detail || `Failed to ${isAdd ? "add" : "update"} protocol.`);
        return;
      }

      setProtocolSaveSuccessMsg(isAdd ? "Protocol added successfully." : "Protocol updated successfully.");

      // Refresh the library list behind the dialog, if open
      if (protocolDialogOpen) openProtocolBrowser();
      // Refresh the detail view if we just edited the protocol currently being viewed
      if (!isAdd && protocolDetailOpen) viewProtocolDetail(payload.protocol_id);

      setTimeout(() => {
        setProtocolFormDialogOpen(false);
        setProtocolSaveSuccessMsg(null);
      }, 1000);
    } catch (err) {
      console.error("Failed to save protocol:", err);
      setProtocolSaveError("Network error while saving protocol.");
    } finally {
      setProtocolSaving(false);
    }
  };

  const applyRegimenSuggestion = () => {
    const s = regimenSuggestion;
    if (!s) return;
    setFormData(prev => ({
      ...prev,
      partA: {
        ...prev.partA,
        intent: s.treatmentIntent || prev.partA.intent,
        protocolName: s.selectedProtocol || prev.partA.protocolName,
        startDate: s.startDate || prev.partA.startDate,
        cycles: s.plannedCycles ? String(s.plannedCycles) : prev.partA.cycles,
        daysBetween: s.daysBetweenCycles ? String(s.daysBetweenCycles) : prev.partA.daysBetween,
        protocolDetails: s.protocolDetails || prev.partA.protocolDetails,
        doseAdjustments: s.doseAdjustments || prev.partA.doseAdjustments,
        concurrentTherapy: s.concurrentTherapy || prev.partA.concurrentTherapy,
        reasonForChange: s.reasonForChange || prev.partA.reasonForChange,
        protocolMasterRef: s.protocolMasterRef || prev.partA.protocolMasterRef,
        drugs: (s.drugs && s.drugs.length > 0) ? s.drugs.map((d, i) => ({ id: Date.now() + i, ...d })) : prev.partA.drugs
      }
    }));
  };

  return (
    <Box>
      <SectionHeader num="Part A" title="Defining Systemic Therapy Protocol" />
      <ProtocolHistoryTable dbCycles={dbCycles} completedCycles={treatment?.completedCycles || 0} />

      {/* AI Suggest / Browse buttons */}
      <Box sx={{ display: "flex", justifyContent: "flex-end", px: 3, pt: 2 }}>
        <Button
          variant="contained" size="small"
          sx={{ ...btnStyle, background: C.black, color: C.white, mr: 1 }}
          onClick={openProtocolBrowser}
        >
          Browse Protocol Library
        </Button>
        <Button
          variant="outlined" size="small"
          sx={{ borderColor: C.black, color: C.black, textTransform: "none", "&:hover": { background: C.bgSecondary } }}
          onClick={fetchRegimenSuggestion}
          disabled={regimenSuggestLoading}
        >
          {regimenSuggestLoading ? "Analyzing patient history…" : "Suggest Regimen (AI)"}
        </Button>
      </Box>

      {regimenSuggestError && (
        <Box sx={{ mx: 3, mt: 2, p: 2, border: "1px solid #d32f2f", background: "#fdecea", fontSize: 13, color: "#d32f2f" }}>
          {regimenSuggestError}
        </Box>
      )}

      {regimenSuggestion && (
        <Box sx={{ mx: 3, mt: 2, p: 2, border: `1px solid ${C.border}`, background: "#f7f9fc" }}>
          <Typography sx={{ fontSize: 12, fontWeight: FW_MEDIUM, mb: 1 }}>
            AI-suggested — please review before saving
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: C.textSecond, mb: 1 }}>
            {regimenSuggestion.selectedProtocol || "No protocol identified"}
            {regimenSuggestion.protocolDetails ? ` · ${regimenSuggestion.protocolDetails}` : ""}
          </Typography>
          {regimenSuggestion.safetyFlags?.length > 0 && (
            <Box sx={{ mb: 1 }}>
              {regimenSuggestion.safetyFlags.map((f, i) => (
                <Typography key={i} sx={{ fontSize: 12, color: "#b71c1c" }}>⚠ {f}</Typography>
              ))}
            </Box>
          )}
          {regimenSuggestion.drugs?.length > 0 && (
            <Typography sx={{ fontSize: 11, color: C.textMuted, mb: 1 }}>
              {regimenSuggestion.drugs.length} drug(s) found: {regimenSuggestion.drugs.map(d => d.name).filter(Boolean).join(", ")}
            </Typography>
          )}
          <Button size="small" variant="contained" sx={{ ...btnStyle, background: C.black, color: C.white }} onClick={applyRegimenSuggestion}>
            Apply Suggestion
          </Button>
        </Box>
      )}

      {/* ── Protocol Library Dialog ── */}
      <Dialog open={protocolDialogOpen} onClose={() => setProtocolDialogOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.black, color: C.white }}>
          Protocol Library
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Button
              size="small"
              variant="outlined"
              startIcon={<Add fontSize="small" />}
              onClick={openAddProtocolForm}
              sx={{ borderColor: C.white, color: C.white, textTransform: "none", "&:hover": { borderColor: C.white, background: "rgba(255,255,255,0.1)" } }}
            >
              Add Protocol
            </Button>
            <IconButton size="small" onClick={() => setProtocolDialogOpen(false)} sx={{ color: C.white }}>
              <CloseRounded />
            </IconButton>
          </Box>
        </DialogTitle>
        <DialogContent sx={{ p: 2 }}>
          <TextField
            fullWidth size="small" placeholder="Search protocols, drugs, or disease site..."
            value={protocolSearch}
            onChange={e => setProtocolSearch(e.target.value)}
            sx={{ ...inputStyle, mb: 2 }}
          />
          {protocolLoading ? (
            <Typography sx={{ fontSize: 13, color: C.textMuted, textAlign: "center", py: 4 }}>
              Loading protocols...
            </Typography>
          ) : protocolList.length === 0 ? (
            <Typography sx={{ fontSize: 13, color: C.textMuted, textAlign: "center", py: 4 }}>
              No protocols found. Make sure the protocol_master collection has been seeded.
            </Typography>
          ) : (
            <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 1.5 }}>
              {protocolList
                .filter(p =>
                  !protocolSearch ||
                  p.protocol_name.toLowerCase().includes(protocolSearch.toLowerCase()) ||
                  (p.drug_names || []).some(d => d.toLowerCase().includes(protocolSearch.toLowerCase())) ||
                  (p.disease_sites || []).some(d => d.toLowerCase().includes(protocolSearch.toLowerCase()))
                )
                .map(p => (
                  <Box
                    key={p.protocol_id}
                    onClick={() => viewProtocolDetail(p.protocol_id)}
                    sx={{
                      border: `1px solid ${p.recommended ? C.black : C.border}`,
                      background: p.recommended ? "#fafafa" : C.white,
                      p: 1.75, cursor: "pointer", position: "relative",
                      opacity: protocolSelecting === p.protocol_id ? 0.5 : 1,
                      "&:hover": { borderColor: C.black, boxShadow: "0 2px 8px rgba(0,0,0,0.08)" }
                    }}
                  >
                    {p.recommended && (
                      <Typography sx={{ position: "absolute", top: -8, right: 8, fontSize: 9.5, background: C.black, color: C.white, px: 0.75, py: 0.25 }}>
                        RECOMMENDED
                      </Typography>
                    )}
                    <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 0.5 }}>{p.protocol_name}</Typography>
                    <Typography sx={{ fontSize: 11.5, color: C.textMuted, mb: 0.75 }}>
                      {(p.disease_sites || []).join(", ")}
                    </Typography>
                    <Typography sx={{ fontSize: 11.5, color: C.textSecond, mb: 0.5 }}>
                      {(p.drug_names || []).join(" + ")}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: C.textMuted }}>
                      {p.standard_cycles} cycles · every {p.cycle_interval_days} days
                      {(p.intent || []).length ? ` · ${p.intent[0]}` : ""}
                    </Typography>
                    {p.references && p.references.length > 0 && (
                      <Typography sx={{ fontSize: 10, color: C.textMuted, mt: 0.5, fontStyle: "italic" }}>
                        Ref: {p.references.join(", ")}
                      </Typography>
                    )}
                    {protocolSelecting === p.protocol_id && (
                      <Typography sx={{ fontSize: 11, color: C.black, mt: 1, fontStyle: "italic" }}>Applying...</Typography>
                    )}
                  </Box>
                ))}
            </Box>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Protocol Detail / AI Adaptation Dialog ── */}
      <Dialog open={protocolDetailOpen} onClose={() => setProtocolDetailOpen(false)} maxWidth="lg" fullWidth>
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.black, color: C.white }}>
          {protocolDetailData?.display_name || protocolDetailData?.protocol_name || "Protocol Details"}
          <IconButton size="small" onClick={() => setProtocolDetailOpen(false)} sx={{ color: C.white }}>
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          {protocolDetailLoading ? (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography sx={{ fontSize: 13, color: C.textMuted }}>
                Loading protocol & running AI adaptation…
              </Typography>
            </Box>
          ) : protocolDetailError && !mergedProtocolView ? (
            <Box sx={{ p: 3 }}>
              <Typography sx={{ fontSize: 13, color: "#d32f2f" }}>{protocolDetailError}</Typography>
            </Box>
          ) : mergedProtocolView ? (
            <Box>
              <Typography sx={{ fontSize: 15, fontWeight: 700, mb: 2.5, fontFamily: FONT, color: C.black }}>
                Selected Chemotherapy Protocol
              </Typography>

              {protocolDetailError && (
                <Box sx={{ mb: 2.5, p: 1.5, border: "1px solid #ff9800", background: "#fff3e0" }}>
                  <Typography sx={{ fontSize: 12, color: "#e65100" }}>{protocolDetailError}</Typography>
                </Box>
              )}

              {/* Basic Information */}
              <Box sx={{ mb: 3 }}>
                <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1.25 }}>
                  Basic Information
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.85 }}>
                  {hasValueLocal(mergedProtocolView.protocolName) && <FieldLine label="Protocol Name" value={mergedProtocolView.protocolName} />}
                  {hasValueLocal(mergedProtocolView.displayName) && <FieldLine label="Display Name" value={mergedProtocolView.displayName} />}
                  {hasValueLocal(mergedProtocolView.protocolId) && <FieldLine label="Protocol ID" value={mergedProtocolView.protocolId} />}
                  {hasValueLocal(mergedProtocolView.diseaseSites) && (
                    <FieldLine label="Disease Site(s)" value={Array.isArray(mergedProtocolView.diseaseSites) ? mergedProtocolView.diseaseSites.join(", ") : mergedProtocolView.diseaseSites} />
                  )}
                  {hasValueLocal(mergedProtocolView.histology) && <FieldLine label="Histology" value={mergedProtocolView.histology} />}
                  {hasValueLocal(mergedProtocolView.treatmentIntent) && <FieldLine label="Treatment Intent" value={mergedProtocolView.treatmentIntent} />}
                  {hasValueLocal(mergedProtocolView.regimenType) && <FieldLine label="Regimen Type" value={mergedProtocolView.regimenType} />}
                  {hasValueLocal(mergedProtocolView.standardCycles) && <FieldLine label="Standard Cycles" value={mergedProtocolView.standardCycles} />}
                  {hasValueLocal(mergedProtocolView.cycleIntervalDays) && <FieldLine label="Cycle Interval (Days)" value={`Every ${mergedProtocolView.cycleIntervalDays} days`} />}
                  {hasValueLocal(mergedProtocolView.version) && <FieldLine label="Version" value={mergedProtocolView.version} />}
                  {hasValueLocal(mergedProtocolView.status) && <FieldLine label="Status" value={mergedProtocolView.status} />}
                  {hasValueLocal(mergedProtocolView.startDate) && <FieldLine label="Start Date" value={mergedProtocolView.startDate} />}
                  {hasValueLocal(mergedProtocolView.concurrentTherapy) && <FieldLine label="Concurrent Therapy" value={mergedProtocolView.concurrentTherapy} />}
                  {hasValueLocal(mergedProtocolView.reasonForChange) && <FieldLine label="Reason for Change" value={mergedProtocolView.reasonForChange} />}
                </Box>
              </Box>

              {/* Safety Flags */}
              {hasValueLocal(mergedProtocolView.safetyFlags) && (
                <Box sx={{ mb: 3, p: 1.5, border: "1px solid #ff9800", background: "#fff3e0" }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", color: "#e65100", mb: 0.5 }}>
                    Safety Flags
                  </Typography>
                  {mergedProtocolView.safetyFlags.map((f, i) => (
                    <Typography key={i} sx={{ fontSize: 12.5, color: "#e65100", fontFamily: FONT }}>⚠ {f}</Typography>
                  ))}
                </Box>
              )}

              {/* Drug Schedule */}
              {hasValueLocal(mergedProtocolView.drugSchedule) && (() => {
                const drugs = mergedProtocolView.drugSchedule;
                const showAdmin = drugs.some(d => hasValueLocal(d.adminType));
                const showDuration = drugs.some(d => hasValueLocal(d.duration));
                return (
                  <Box sx={{ mb: 3 }}>
                    <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1.25 }}>
                      Drug Schedule
                    </Typography>
                    <TableContainer sx={{ border: `1px solid ${C.border}` }}>
                      <Table size="small">
                        <TableHead sx={{ background: C.bgSecondary }}>
                          <TableRow>
                            <TableCell sx={invThSx}>Drug</TableCell>
                            <TableCell sx={invThSx}>Dose</TableCell>
                            <TableCell sx={invThSx}>Unit</TableCell>
                            <TableCell sx={invThSx}>Route</TableCell>
                            <TableCell sx={invThSx}>Day</TableCell>
                            {showAdmin && <TableCell sx={invThSx}>Admin Type</TableCell>}
                            {showDuration && <TableCell sx={invThSx}>Duration</TableCell>}
                          </TableRow>
                        </TableHead>
                        <TableBody>
                          {drugs.map((d, i) => (
                            <TableRow key={i}>
                              <TableCell sx={invTdSx}>{hasValueLocal(d.name) ? d.name : "—"}</TableCell>
                              <TableCell sx={invTdSx}>{hasValueLocal(d.dose) ? d.dose : "—"}</TableCell>
                              <TableCell sx={invTdSx}>{hasValueLocal(d.unit) ? d.unit : "—"}</TableCell>
                              <TableCell sx={invTdSx}>{hasValueLocal(d.route) ? d.route : "—"}</TableCell>
                              <TableCell sx={invTdSx}>{hasValueLocal(d.day) ? d.day : "—"}</TableCell>
                              {showAdmin && <TableCell sx={invTdSx}>{hasValueLocal(d.adminType) ? d.adminType : "—"}</TableCell>}
                              {showDuration && <TableCell sx={invTdSx}>{hasValueLocal(d.duration) ? `${d.duration} min` : "—"}</TableCell>}
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </TableContainer>
                  </Box>
                );
              })()}

              {/* Simple bullet-list sections */}
              {[
                { key: "premedications", label: "Premedications" },
                { key: "hydration", label: "Hydration" },
                { key: "supportiveCare", label: "Supportive Care" },
                { key: "laboratoryRequirements", label: "Laboratory Requirements" },
                { key: "references", label: "References" },
              ].map(section => hasValueLocal(mergedProtocolView[section.key]) && (
                <Box key={section.key} sx={{ mb: 3 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>
                    {section.label}
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {mergedProtocolView[section.key].map((item, i) => (
                      <Typography key={i} component="li" sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>
                        {item}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              ))}

              {/* Dose Adjustment Rules (object from protocol master) */}
              {hasValueLocal(mergedProtocolView.doseAdjustmentRules) && (
                <Box sx={{ mb: 3 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>
                    Dose Adjustment Rules
                  </Typography>
                  <Box component="ul" sx={{ m: 0, pl: 2.5 }}>
                    {Object.entries(mergedProtocolView.doseAdjustmentRules).map(([k, v]) => (
                      <Typography key={k} component="li" sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>
                        <b>{k}:</b> {typeof v === "object" ? JSON.stringify(v) : v}
                      </Typography>
                    ))}
                  </Box>
                </Box>
              )}

              {/* AI-suggested free-text dose adjustments (patient-specific) */}
              {hasValueLocal(mergedProtocolView.doseAdjustments) && (
                <Box sx={{ mb: 1 }}>
                  <Typography sx={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.08em", color: C.textMuted, mb: 1 }}>
                    Dose Adjustments (Patient-Specific)
                  </Typography>
                  <Typography sx={{ fontSize: 12.5, color: C.textPrimary, fontFamily: FONT }}>
                    {mergedProtocolView.doseAdjustments}
                  </Typography>
                </Box>
              )}
            </Box>
          ) : (
            <Box sx={{ p: 3 }}>
              <Typography sx={{ fontSize: 13, color: C.textMuted }}>No protocol data available.</Typography>
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${C.border}`, p: 2 }}>
          <Button onClick={() => setProtocolDetailOpen(false)} sx={{ color: C.textSecond }}>Cancel</Button>
          <Button
            variant="outlined"
            disabled={!protocolDetailData || protocolDetailLoading}
            onClick={openEditProtocolForm}
            sx={{ ...btnStyle, borderColor: C.black, color: C.black, "&:hover": { background: C.bgSecondary, borderColor: C.black } }}
          >
            Edit Protocol
          </Button>
          <Button
            variant="contained"
            disabled={!protocolAdaptation?.adaptedRegimen}
            onClick={() => applyProtocolData(protocolAdaptation.adaptedRegimen)}
            sx={{ ...btnStyle, background: C.black, color: C.white }}
          >
            Apply to Treatment Plan
          </Button>
        </DialogActions>
      </Dialog>

      {/* ── Add / Edit Protocol Form Dialog ── */}
      <Dialog
        open={protocolFormDialogOpen}
        onClose={() => { if (!protocolSaving) setProtocolFormDialogOpen(false); }}
        maxWidth="lg"
        fullWidth
      >
        <DialogTitle sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: C.black, color: C.white }}>
          {protocolFormMode === "add" ? "Add New Protocol" : `Edit Protocol — ${protocolForm.protocol_name || protocolForm.protocol_id}`}
          <IconButton size="small" onClick={() => setProtocolFormDialogOpen(false)} sx={{ color: C.white }} disabled={protocolSaving}>
            <CloseRounded />
          </IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 3 }}>
          {protocolSaveError && (
            <Box sx={{ mb: 2, p: 1.5, border: "1px solid #d32f2f", background: "#fdecea", fontSize: 12.5, color: "#d32f2f" }}>
              {protocolSaveError}
            </Box>
          )}
          {protocolSaveSuccessMsg && (
            <Box sx={{ mb: 2, p: 1.5, border: "1px solid #4caf50", background: "#e8f5e9", fontSize: 12.5, color: "#2e7d32" }}>
              ✓ {protocolSaveSuccessMsg}
            </Box>
          )}

          {/* Basic Information */}
          <Typography sx={sectionLabelSx}>Basic Information</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5, mb: 2.5 }}>
            <TextField
              label="Protocol ID *"
              size="small"
              sx={inputStyle}
              value={protocolForm.protocol_id}
              disabled={protocolFormMode === "edit"}
              onChange={e => updateProtocolFormField("protocol_id", e.target.value)}
              placeholder="e.g. folfox-6"
              helperText={protocolFormMode === "edit" ? "Protocol ID cannot be changed once created" : "Unique, e.g. lowercase-hyphenated"}
            />
            <TextField label="Protocol Name *" size="small" sx={inputStyle} value={protocolForm.protocol_name} onChange={e => updateProtocolFormField("protocol_name", e.target.value)} placeholder="e.g. FOLFOX-6" />
            <TextField label="Display Name" size="small" sx={inputStyle} value={protocolForm.display_name} onChange={e => updateProtocolFormField("display_name", e.target.value)} placeholder="Defaults to Protocol Name" />
            <TextField label="Regimen Type *" size="small" sx={inputStyle} value={protocolForm.regimen_type} onChange={e => updateProtocolFormField("regimen_type", e.target.value)} placeholder="e.g. Cytotoxic Combination" />
            <TextField label="Standard Cycles" type="number" size="small" sx={inputStyle} value={protocolForm.standard_cycles} onChange={e => updateProtocolFormField("standard_cycles", e.target.value)} />
            <TextField label="Cycle Interval (Days) *" type="number" size="small" sx={inputStyle} value={protocolForm.cycle_interval_days} onChange={e => updateProtocolFormField("cycle_interval_days", e.target.value)} />
            <TextField label="Version" size="small" sx={inputStyle} value={protocolForm.version} onChange={e => updateProtocolFormField("version", e.target.value)} />
            <Select size="small" sx={inputStyle} value={protocolForm.status} onChange={e => updateProtocolFormField("status", e.target.value)}>
              <MenuItem value="active">Active</MenuItem>
              <MenuItem value="inactive">Inactive</MenuItem>
              <MenuItem value="draft">Draft</MenuItem>
            </Select>
          </Box>

          <Typography sx={sectionLabelSx}>Classification</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5, mb: 2.5 }}>
            <TextField label="Disease Sites" size="small" sx={inputStyle} value={protocolForm.disease_sites} onChange={e => updateProtocolFormField("disease_sites", e.target.value)} placeholder="Comma separated, e.g. Colorectal, Gastric" />
            <TextField label="Histology" size="small" sx={inputStyle} value={protocolForm.histology} onChange={e => updateProtocolFormField("histology", e.target.value)} placeholder="e.g. Adenocarcinoma" />
            <TextField label="Intent" size="small" sx={inputStyle} value={protocolForm.intent} onChange={e => updateProtocolFormField("intent", e.target.value)} placeholder="Comma separated, e.g. Adjuvant, Palliative" />
            <TextField label="Aliases" size="small" sx={inputStyle} value={protocolForm.aliases} onChange={e => updateProtocolFormField("aliases", e.target.value)} placeholder="Comma separated alternate names" />
          </Box>

          {/* Drug Schedule */}
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
            <Typography sx={sectionLabelSx}>Drug Schedule *</Typography>
            <Button size="small" startIcon={<Add fontSize="small" />} onClick={addDrugRow} sx={{ ...btnStyle, border: `1px solid ${C.border}`, color: C.black }}>
              Add Drug
            </Button>
          </Box>
          <Box sx={{ mb: 2.5, display: "flex", flexDirection: "column", gap: 1, overflowX: "auto" }}>
            <Box sx={{ minWidth: 820, display: "flex", gap: 1, p: 1, background: C.bgSecondary, border: `1px solid ${C.border}`, fontWeight: FW_MEDIUM, fontSize: 11.5 }}>
              <Box sx={{ flex: 1.6 }}>Name</Box>
              <Box sx={{ flex: 0.9 }}>Dose</Box>
              <Box sx={{ flex: 0.9 }}>Unit</Box>
              <Box sx={{ flex: 0.9 }}>Route</Box>
              <Box sx={{ flex: 0.6 }}>Day</Box>
              <Box sx={{ flex: 1 }}>Admin Type</Box>
              <Box sx={{ flex: 0.8 }}>Duration</Box>
              <Box sx={{ width: 36 }} />
            </Box>
            {protocolForm.drug_schedule.map((d, index) => (
              <Box key={d.id} sx={{ minWidth: 820, display: "flex", gap: 1, alignItems: "center" }}>
                <Box sx={{ flex: 1.6 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={d.name} onChange={e => updateDrugRow(index, "name", e.target.value)} placeholder="Drug name" /></Box>
                <Box sx={{ flex: 0.9 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={d.dose} onChange={e => updateDrugRow(index, "dose", e.target.value)} placeholder="Dose" /></Box>
                <Box sx={{ flex: 0.9 }}>
                  <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={d.unit} onChange={e => updateDrugRow(index, "unit", e.target.value)}>
                    <MenuItem value=""><em>-</em></MenuItem>
                    <MenuItem value="m2">mg/m²</MenuItem>
                    <MenuItem value="kg">mg/kg</MenuItem>
                    <MenuItem value="auc">AUC</MenuItem>
                    <MenuItem value="mg">mg (flat)</MenuItem>
                    <MenuItem value="mcg">mcg</MenuItem>
                  </Select>
                </Box>
                <Box sx={{ flex: 0.9 }}>
                  <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={d.route} onChange={e => updateDrugRow(index, "route", e.target.value)}>
                    <MenuItem value=""><em>-</em></MenuItem>
                    <MenuItem value="iv">IV</MenuItem>
                    <MenuItem value="oral">Oral</MenuItem>
                    <MenuItem value="sc">SC</MenuItem>
                  </Select>
                </Box>
                <Box sx={{ flex: 0.6 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={d.day} onChange={e => updateDrugRow(index, "day", e.target.value)} placeholder="1" /></Box>
                <Box sx={{ flex: 1 }}>
                  <Select fullWidth size="small" sx={{ ...inputStyle, m: 0 }} displayEmpty value={d.adminType} onChange={e => updateDrugRow(index, "adminType", e.target.value)}>
                    <MenuItem value=""><em>-</em></MenuItem>
                    <MenuItem value="bolus">Bolus</MenuItem>
                    <MenuItem value="infusion">Infusion</MenuItem>
                  </Select>
                </Box>
                <Box sx={{ flex: 0.8 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={d.duration} onChange={e => updateDrugRow(index, "duration", e.target.value)} placeholder="min" /></Box>
                <Box sx={{ width: 36, display: "flex", justifyContent: "center" }}>
                  <IconButton size="small" onClick={() => removeDrugRow(index)} sx={{ color: C.black }}><Remove fontSize="small" /></IconButton>
                </Box>
              </Box>
            ))}
          </Box>

          <Typography sx={sectionLabelSx}>Supportive Care</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5, mb: 2.5 }}>
            <TextField label="Premedications" size="small" sx={inputStyle} value={protocolForm.premedications} onChange={e => updateProtocolFormField("premedications", e.target.value)} placeholder="Comma separated" />
            <TextField label="Hydration" size="small" sx={inputStyle} value={protocolForm.hydration} onChange={e => updateProtocolFormField("hydration", e.target.value)} placeholder="Comma separated" />
            <TextField label="Supportive Care" size="small" sx={inputStyle} value={protocolForm.supportive_care} onChange={e => updateProtocolFormField("supportive_care", e.target.value)} placeholder="Comma separated" />
            <TextField label="Laboratory Requirements" size="small" sx={inputStyle} value={protocolForm.laboratory_requirements} onChange={e => updateProtocolFormField("laboratory_requirements", e.target.value)} placeholder="Comma separated" />
          </Box>

          {/* Dose Adjustment Rules */}
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1 }}>
            <Typography sx={sectionLabelSx}>Dose Adjustment Rules</Typography>
            <Button size="small" startIcon={<Add fontSize="small" />} onClick={addRuleRow} sx={{ ...btnStyle, border: `1px solid ${C.border}`, color: C.black }}>
              Add Rule
            </Button>
          </Box>
          <Box sx={{ mb: 2.5, display: "flex", flexDirection: "column", gap: 1 }}>
            {protocolForm.dose_adjustment_rules.map((r, index) => (
              <Box key={r.id} sx={{ display: "flex", gap: 1, alignItems: "center" }}>
                <Box sx={{ flex: 1 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={r.key} onChange={e => updateRuleRow(index, "key", e.target.value)} placeholder="Condition, e.g. renal_impairment" /></Box>
                <Box sx={{ flex: 2 }}><TextField fullWidth size="small" sx={{ ...inputStyle, m: 0 }} value={r.value} onChange={e => updateRuleRow(index, "value", e.target.value)} placeholder="Adjustment, e.g. Reduce dose by 25% if CrCl < 50" /></Box>
                <Box sx={{ width: 36, display: "flex", justifyContent: "center" }}>
                  <IconButton size="small" onClick={() => removeRuleRow(index)} sx={{ color: C.black }}><Remove fontSize="small" /></IconButton>
                </Box>
              </Box>
            ))}
          </Box>

          <Typography sx={sectionLabelSx}>References</Typography>
          <TextField fullWidth multiline rows={2} size="small" sx={inputStyle} value={protocolForm.references} onChange={e => updateProtocolFormField("references", e.target.value)} placeholder="Comma separated citations / links" />
        </DialogContent>
        <DialogActions sx={{ borderTop: `1px solid ${C.border}`, p: 2 }}>
          <Button onClick={() => setProtocolFormDialogOpen(false)} disabled={protocolSaving} sx={{ color: C.textSecond }}>Cancel</Button>
          <Button
            variant="contained"
            onClick={saveProtocol}
            disabled={protocolSaving}
            sx={{ ...btnStyle, background: C.black, color: C.white }}
          >
            {protocolSaving ? "Saving…" : (protocolFormMode === "add" ? "Add Protocol" : "Save Changes")}
          </Button>
        </DialogActions>
      </Dialog>

      <FieldRow label="Intent of Treatment">
        <Autocomplete
          freeSolo
          options={["Curative", "Adjuvant", "Neoadjuvant", "Definitive", "Palliative", "Salvage", "Prophylactic"]}
          value={formData.partA.intent}
          onChange={(e, newValue) => handleUpdate("partA", "intent", newValue)}
          onInputChange={(e, newInputValue) => handleUpdate("partA", "intent", newInputValue)}
          renderInput={(params) => <TextField {...params} size="small" sx={inputStyle} placeholder="Select or type intent" />}
        />
      </FieldRow>
      <FieldRow label="Type of Chemotherapy">
        <Autocomplete
          freeSolo
          options={[
            "Cytotoxic Chemotherapy",
            "Targeted Therapy",
            "Immunotherapy",
            "Hormonal Therapy",
            "Chemo-Immunotherapy Combination",
            "Chemo-Targeted Combination",
            "Mixed Modality"
          ]}
          value={formData.partA.chemoType || ""}
          onChange={(e, newValue) => handleUpdate("partA", "chemoType", newValue)}
          onInputChange={(e, newInputValue) => handleUpdate("partA", "chemoType", newInputValue)}
          renderInput={(params) => <TextField {...params} size="small" sx={inputStyle} placeholder="Select or type type of chemotherapy" />}
        />
      </FieldRow>
      <FieldRow label="Protocol Name">
        <Autocomplete
          freeSolo
          options={["FOLFOX", "CHOP", "AC-T", "Other"]}
          value={formData.partA.protocolName}
          onInputChange={(event, newInputValue) => {
            handleUpdate("partA", "protocolName", newInputValue);
            if (PROTOCOL_DICTIONARY[newInputValue]) {
              const templateDrugs = PROTOCOL_DICTIONARY[newInputValue].map((d, i) => ({ ...d, id: Date.now() + i }));
              setFormData(prev => {
                const currentDrugs = prev.partA.drugs;
                const isEmpty = !currentDrugs || currentDrugs.length === 0 || (currentDrugs.length === 1 && !currentDrugs[0].name);
                if (isEmpty) {
                  return {
                    ...prev,
                    partA: { ...prev.partA, drugs: templateDrugs }
                  };
                }
                return prev;
              });
            }
          }}
          renderInput={(params) => <TextField {...params} fullWidth size="small" sx={inputStyle} placeholder="e.g., AC-T" />}
        />
      </FieldRow>
      <FieldRow label="Start Date of Protocol">
        <TextField type="date" fullWidth size="small" sx={inputStyle} value={formData.partA.startDate} onChange={e => handleUpdate("partA", "startDate", e.target.value)} />
      </FieldRow>
      <FieldRow label="Number of Cycles">
        <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
          <IconButton
            onClick={() => {
              let current = parseInt(formData.partA.cycles) || 1;
              if (current <= 1) return;

              const cycleData = dbCycles?.[String(current)];
              if (current <= (treatment?.completedCycles || 0)) {
                if (!window.confirm(`Caution: Cycle ${current} is already marked as completed and contains medical data. Are you sure you want to remove it?`)) return;
              } else if (cycleData) {
                const hasDraftData = Object.values(cycleData).some(section => Object.values(section).some(v => v !== "" && v !== false));
                if (hasDraftData) {
                  if (!window.confirm(`Caution: Cycle ${current} has some drafted data. Are you sure you want to remove it?`)) return;
                }
              }

              handleUpdate("partA", "cycles", String(current - 1));
            }}
            size="small"
            sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}
          >
            <Remove fontSize="small" />
          </IconButton>

          <TextField type="number" size="small" sx={{ ...inputStyle, width: 80, m: 0, '& input': { textAlign: 'center' } }} value={formData.partA.cycles || ""} onChange={e => {
            const newCyclesStr = e.target.value;
            const newCycles = parseInt(newCyclesStr);
            handleUpdate("partA", "cycles", newCyclesStr);
            if (!isNaN(newCycles)) {
              setTreatment(prev => {
                const updates = { plannedCycles: newCycles };
                const wasCompleted = (prev.completedCycles || 0) >= (prev.plannedCycles || 1) || prev.status === "all_cycles_completed" || prev.treatmentCompleted;
                if (wasCompleted && (prev.completedCycles || 0) < newCycles) {
                  updates.currentCycle = (prev.completedCycles || 0) + 1;
                  updates.status = `cycle_${updates.currentCycle}_in_progress`;
                  updates.treatmentCompleted = false;
                }
                return { ...prev, ...updates };
              });
            }
          }} />

          <IconButton
            onClick={() => {
              let current = parseInt(formData.partA.cycles) || 0;
              const newCycles = current + 1;
              handleUpdate("partA", "cycles", String(newCycles));
              setTreatment(prev => {
                const updates = { plannedCycles: newCycles };
                const wasCompleted = (prev.completedCycles || 0) >= (prev.plannedCycles || 1) || prev.status === "all_cycles_completed" || prev.treatmentCompleted;
                if (wasCompleted && (prev.completedCycles || 0) < newCycles) {
                  updates.currentCycle = (prev.completedCycles || 0) + 1;
                  updates.status = `cycle_${updates.currentCycle}_in_progress`;
                  updates.treatmentCompleted = false;
                }
                return { ...prev, ...updates };
              });
            }}
            size="small"
            sx={{ border: `1px solid ${C.border}`, borderRadius: 1 }}
          >
            <Add fontSize="small" />
          </IconButton>
        </Box>
      </FieldRow>
      <FieldRow label="Days Between Cycles">
        <Select fullWidth size="small" sx={inputStyle} displayEmpty value={formData.partA.daysBetween} onChange={e => handleUpdate("partA", "daysBetween", e.target.value)}>
          <MenuItem value=""><em>Select interval</em></MenuItem>
          {[...Array(42).keys()].map(i => (
            <MenuItem key={i + 1} value={i + 1}>{i + 1} days</MenuItem>
          ))}
        </Select>
      </FieldRow>
      <FieldRow label="Protocol Details">
        <TextField fullWidth multiline rows={3} sx={inputStyle} placeholder="Drug combination, route, schedule, cycles" value={formData.partA.protocolDetails} onChange={e => handleUpdate("partA", "protocolDetails", e.target.value)} />
      </FieldRow>
      <FieldRow label="Dose Adjustments">
        <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Adjustments for organ function, comorbidities, or performance status" value={formData.partA.doseAdjustments} onChange={e => handleUpdate("partA", "doseAdjustments", e.target.value)} />
      </FieldRow>
      <FieldRow label="Concurrent Therapy Plans">
        <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Radiation, surgery, or other concurrent treatments" value={formData.partA.concurrentTherapy} onChange={e => handleUpdate("partA", "concurrentTherapy", e.target.value)} />
      </FieldRow>
      <FieldRow label="Reason for Regimen Change" tag="If switching from a prior plan">
        <Select fullWidth size="small" sx={inputStyle} displayEmpty value={formData.partA.reasonForChange} onChange={e => handleUpdate("partA", "reasonForChange", e.target.value)}>
          <MenuItem value=""><em>Not applicable / first-line regimen</em></MenuItem>
          <MenuItem value="progression">Disease Progression</MenuItem>
          <MenuItem value="poor-response">Poor / Inadequate Response</MenuItem>
          <MenuItem value="toxicity">Toxicity / Intolerance</MenuItem>
          <MenuItem value="comorbidity">New / Worsening Comorbidity</MenuItem>
          <MenuItem value="lab-parameters">Abnormal Lab Parameters (Renal / Hepatic / Marrow)</MenuItem>
          <MenuItem value="drug-unavailability">Drug Unavailability / Shortage</MenuItem>
          <MenuItem value="cost-access">Cost / Access Constraints</MenuItem>
          <MenuItem value="patient-choice">Patient Choice</MenuItem>
          <MenuItem value="physician-preference">Physician / Tumor Board Preference</MenuItem>
          <MenuItem value="protocol-update">Institutional Protocol Update</MenuItem>
          <MenuItem value="other">Other</MenuItem>
        </Select>
      </FieldRow>
      <FieldRow label="Protocol Master Reference" tag="Institutional formulary link">
        <TextField fullWidth size="small" sx={{ ...inputStyle, backgroundColor: C.bgSecondary }} placeholder="Auto-filled from protocol library" value={formData.partA.protocolMasterRef} onChange={e => handleUpdate("partA", "protocolMasterRef", e.target.value)} />
      </FieldRow>
    </Box>
  );
};

export default ProtocolMasterTab;
export { PROTOCOL_DICTIONARY };