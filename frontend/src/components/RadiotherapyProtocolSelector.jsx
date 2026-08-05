import React, { useState, useMemo } from "react";
import {
  Box,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Chip,
  CircularProgress,
  TextField,
  Divider,
  Select,
  MenuItem,
  FormControlLabel,
  Checkbox,
  Grid,
} from "@mui/material";

// ─── Match the brand tokens used in RadiotherapyRecord.jsx ──────────
const FONT = '"Open Sans", sans-serif';
const FW_LIGHT = 300;
const FW_NORMAL = 400;
const FW_MEDIUM = 500;

const C = {
  black: "#000000",
  white: "#ffffff",
  bgPrimary: "#ffffff",
  bgSecondary: "#fafafa",
  bgTertiary: "#f5f5f5",
  textPrimary: "#000000",
  textSecond: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  danger: "#c62828",
};

const btnStyle = {
  fontFamily: FONT,
  fontWeight: FW_MEDIUM,
  textTransform: "none",
  borderRadius: 0,
  boxShadow: "none",
  "&:hover": { boxShadow: "none" },
};

const inputSx = {
  "& .MuiOutlinedInput-root": { borderRadius: 0, fontFamily: FONT, fontSize: 13 },
  "& .MuiInputLabel-root": { fontFamily: FONT, fontSize: 13 },
};

// ─────────────────────────────────────────────────────────────
// Shared "does this field have anything worth showing" helper
// ─────────────────────────────────────────────────────────────
const hasValue = (value) => {
  if (value == null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "object") return Object.keys(value).length > 0;
  return true;
};

// ─────────────────────────────────────────────────────────────
// Generic nested-path get/set helpers used by the editable form.
// path is an array like ["prescription", "total_dose"].
// setNested always returns a NEW object (immutable update), so it's
// safe to use directly as React state.
// ─────────────────────────────────────────────────────────────
const getNested = (obj, path) =>
  path.reduce((acc, key) => (acc == null ? acc : acc[key]), obj);

const setNested = (obj, path, value) => {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const current = obj && typeof obj === "object" ? obj : {};
  return {
    ...current,
    [head]: setNested(current[head] ?? {}, rest, value),
  };
};

// ─────────────────────────────────────────────────────────────
// Blank protocol shape — mirrors RadiotherapyProtocol pydantic model
// exactly, so nothing the backend expects is missing from the form.
// ─────────────────────────────────────────────────────────────
const emptyProtocol = () => ({
  protocol_id: "",
  protocol_name: "",
  display_name: "",
  aliases: [],
  disease_site: "",
  subsite: "",
  intent: [],
  technique: "",
  rt_type: "External Beam",
  simulation: {
    patient_position: "",
    immobilization: "",
    imaging: "",
    slice_thickness: "",
    contrast: "",
  },
  target_volumes: { gtv: "", ctv: "", ptv: "" },
  prescription: {
    total_dose: "",
    fractions: "",
    dose_per_fraction: "",
    overall_time: "",
  },
  machine: { technique: "", linac: "", energy: "" },
  igrt: { type: "", frequency: "" },
  oar_constraints: {},
  planning: { peer_review: false, adaptive: false, bolus: "" },
  qa: { physics_check: false, patient_specific_QA: false },
  followup: { first_review: "" },
  brachytherapy: {
    applicator_type: "",
    technique: "",
    dose_rate: "",
    total_dose: "",
    fractions: "",
    dose_per_fraction: "",
    number_of_implants: "",
  },
  references: [],
  version: "1.0",
  status: "Active",
});

// slugify a protocol name into a protocol_id, e.g. "Breast IMRT 40/15" -> "breast-imrt-40-15"
const slugify = (text) =>
  (text || "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// Convert the RadiotherapyProtocol shape coming back from the API
// (which may have missing sub-objects) into a fully-populated form
// object so every input is controlled from the start.
const toFormShape = (proto) => {
  const base = emptyProtocol();
  if (!proto) return base;
  return {
    ...base,
    ...proto,
    simulation: { ...base.simulation, ...(proto.simulation || {}) },
    target_volumes: { ...base.target_volumes, ...(proto.target_volumes || {}) },
    prescription: { ...base.prescription, ...(proto.prescription || {}) },
    machine: { ...base.machine, ...(proto.machine || {}) },
    igrt: { ...base.igrt, ...(proto.igrt || {}) },
    oar_constraints: { ...(proto.oar_constraints || {}) },
    planning: { ...base.planning, ...(proto.planning || {}) },
    qa: { ...base.qa, ...(proto.qa || {}) },
    followup: { ...base.followup, ...(proto.followup || {}) },
    brachytherapy: { ...base.brachytherapy, ...(proto.brachytherapy || {}) },
    aliases: proto.aliases || [],
    intent: proto.intent || [],
    references: proto.references || [],
  };
};

// Convert the form shape back into the exact payload the backend expects
// (comma-separated text fields -> arrays, numeric strings -> ints).
const toApiPayload = (form) => {
  const toArray = (v) =>
    Array.isArray(v)
      ? v
      : (v || "")
          .toString()
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);

  const toInt = (v) => (v === "" || v == null ? null : parseInt(v, 10));

  return {
    ...form,
    protocol_id: form.protocol_id || slugify(form.protocol_name),
    aliases: toArray(form.aliases),
    intent: toArray(form.intent),
    references: toArray(form.references),
    prescription: {
      ...form.prescription,
      fractions: toInt(form.prescription.fractions),
    },
    brachytherapy: {
      ...form.brachytherapy,
      fractions: toInt(form.brachytherapy.fractions),
      number_of_implants: toInt(form.brachytherapy.number_of_implants),
    },
  };
};

// ─────────────────────────────────────────────────────────────
// Small presentational helpers for the READ-ONLY view
// ─────────────────────────────────────────────────────────────
const SectionTitle = ({ children }) => (
  <Typography
    sx={{
      fontFamily: FONT,
      fontWeight: FW_MEDIUM,
      fontSize: 13,
      textTransform: "uppercase",
      letterSpacing: 0.5,
      color: C.black,
      mb: 1,
    }}
  >
    {children}
  </Typography>
);

const Field = ({ label, value }) => {
  if (!hasValue(value)) return null;
  const display = typeof value === "boolean" ? (value ? "Yes" : "No") : value;
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", py: 0.5, gap: 2 }}>
      <Typography sx={{ fontFamily: FONT, fontSize: 12.5, color: C.textMuted, whiteSpace: "nowrap" }}>
        {label}
      </Typography>
      <Typography sx={{ fontFamily: FONT, fontSize: 12.5, color: C.black, textAlign: "right" }}>
        {display}
      </Typography>
    </Box>
  );
};

// A "section" only renders (heading + divider included) if at least one
// of its fields actually has a value in READ-ONLY mode. In EDIT mode
// (isEditing=true) it always renders, since empty fields are exactly
// what the doctor is meant to fill in.
const Section = ({ title, data, isEditing, children }) => {
  if (!isEditing && !hasValue(data)) return null;
  return (
    <Box sx={{ mb: 2.5 }}>
      <SectionTitle>{title}</SectionTitle>
      <Box sx={{ px: 0.5 }}>{children}</Box>
      <Divider sx={{ mt: 2, borderColor: C.border }} />
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────
// Editable form field — renders a TextField/Select/Checkbox bound
// to formData at `path` when isEditing, otherwise falls back to the
// read-only <Field/> display. This is what powers BOTH the "Add
// Protocol" dialog and "Edit" mode of the details dialog, so the two
// never drift out of sync.
// ─────────────────────────────────────────────────────────────
const EditField = ({ label, path, formData, onChange, isEditing, type = "text", options, gridSize = 6 }) => {
  const value = getNested(formData, path);

  if (!isEditing) {
    return <Field label={label} value={value} />;
  }

  const handle = (v) => onChange(path, v);

  let control;
  if (type === "boolean") {
    control = (
      <FormControlLabel
        control={
          <Checkbox
            checked={!!value}
            onChange={(e) => handle(e.target.checked)}
            sx={{ color: C.black, "&.Mui-checked": { color: C.black } }}
          />
        }
        label={<Typography sx={{ fontFamily: FONT, fontSize: 12.5 }}>{label}</Typography>}
      />
    );
  } else if (type === "select") {
    control = (
      <TextField
        select
        fullWidth
        size="small"
        label={label}
        value={value || ""}
        onChange={(e) => handle(e.target.value)}
        sx={inputSx}
      >
        {options.map((opt) => (
          <MenuItem key={opt} value={opt} sx={{ fontFamily: FONT, fontSize: 13 }}>
            {opt}
          </MenuItem>
        ))}
      </TextField>
    );
  } else if (type === "list") {
    const display = Array.isArray(value) ? value.join(", ") : value || "";
    control = (
      <TextField
        fullWidth
        size="small"
        label={`${label} (comma separated)`}
        value={display}
        onChange={(e) => handle(e.target.value)}
        sx={inputSx}
      />
    );
  } else {
    control = (
      <TextField
        fullWidth
        size="small"
        type={type === "number" ? "number" : "text"}
        label={label}
        value={value ?? ""}
        onChange={(e) => handle(e.target.value)}
        sx={inputSx}
      />
    );
  }

  return (
    <Grid item xs={12} sm={gridSize} sx={{ mb: 1.5 }}>
      {control}
    </Grid>
  );
};

// ─────────────────────────────────────────────────────────────
// OAR Constraints editor — Dict[str, str] in the backend model, so
// it's edited as a list of (organ, constraint) rows that can grow
// or shrink freely.
// ─────────────────────────────────────────────────────────────
const OarConstraintsEditor = ({ formData, onChange }) => {
  const constraints = formData.oar_constraints || {};
  const rows = Object.entries(constraints);

  const updateRow = (index, key, val) => {
    const entries = [...rows];
    entries[index] = [key, val];
    onChange(["oar_constraints"], Object.fromEntries(entries));
  };

  const removeRow = (index) => {
    const entries = rows.filter((_, i) => i !== index);
    onChange(["oar_constraints"], Object.fromEntries(entries));
  };

  const addRow = () => {
    onChange(["oar_constraints"], { ...constraints, [`Organ ${rows.length + 1}`]: "" });
  };

  return (
    <Box>
      {rows.map(([organ, constraint], i) => (
        <Box key={i} sx={{ display: "flex", gap: 1, mb: 1, alignItems: "center" }}>
          <TextField
            size="small"
            label="Organ"
            value={organ}
            onChange={(e) => updateRow(i, e.target.value, constraint)}
            sx={{ ...inputSx, flex: 1 }}
          />
          <TextField
            size="small"
            label="Constraint"
            value={constraint}
            onChange={(e) => updateRow(i, organ, e.target.value)}
            sx={{ ...inputSx, flex: 1 }}
          />
          <IconButton onClick={() => removeRow(i)} sx={{ color: C.danger }}>
            <Typography sx={{ fontSize: 18 }}>&times;</Typography>
          </IconButton>
        </Box>
      ))}
      <Button onClick={addRow} sx={{ ...btnStyle, color: C.black, borderColor: C.black }} variant="outlined" size="small">
        + Add OAR Constraint
      </Button>
    </Box>
  );
};

// ─────────────────────────────────────────────────────────────
// Full field set for a protocol, shared by the Add dialog and the
// Edit mode of the details dialog. `isEditing` toggles inputs vs.
// read-only text; sections in edit mode are always shown (even if
// empty) so the doctor can see every fillable field.
// ─────────────────────────────────────────────────────────────
const ProtocolFieldSet = ({ formData, onChange, isEditing }) => {
  const p = formData;

  return (
    <>
      {/* Basic Information */}
      <Box sx={{ mb: 2.5 }}>
        <SectionTitle>Basic Information</SectionTitle>
        <Grid container spacing={1}>
          <EditField label="Protocol ID" path={["protocol_id"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Protocol Name" path={["protocol_name"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Display Name" path={["display_name"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Disease Site" path={["disease_site"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Subsite" path={["subsite"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Technique" path={["technique"]} {...{ formData, onChange, isEditing }} />
          <EditField
            label="RT Type"
            path={["rt_type"]}
            type="select"
            options={["External Beam", "Brachytherapy", "Combined"]}
            {...{ formData, onChange, isEditing }}
          />
          <EditField
            label="Status"
            path={["status"]}
            type="select"
            options={["Active", "Inactive", "Draft"]}
            {...{ formData, onChange, isEditing }}
          />
          <EditField label="Version" path={["version"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Aliases" path={["aliases"]} type="list" {...{ formData, onChange, isEditing }} />
          <EditField label="Intent" path={["intent"]} type="list" {...{ formData, onChange, isEditing }} />
          <EditField label="References" path={["references"]} type="list" {...{ formData, onChange, isEditing }} />
        </Grid>
        <Divider sx={{ mt: 2, borderColor: C.border }} />
      </Box>

      <Section title="Simulation" data={p.simulation} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="Patient Position" path={["simulation", "patient_position"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Immobilization" path={["simulation", "immobilization"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Imaging" path={["simulation", "imaging"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Slice Thickness" path={["simulation", "slice_thickness"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Contrast" path={["simulation", "contrast"]} {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>

      <Section title="Target Volumes" data={p.target_volumes} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="GTV" path={["target_volumes", "gtv"]} {...{ formData, onChange, isEditing }} />
          <EditField label="CTV" path={["target_volumes", "ctv"]} {...{ formData, onChange, isEditing }} />
          <EditField label="PTV" path={["target_volumes", "ptv"]} {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>

      <Section title="Prescription" data={p.prescription} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="Total Dose" path={["prescription", "total_dose"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Fractions" path={["prescription", "fractions"]} type="number" {...{ formData, onChange, isEditing }} />
          <EditField label="Dose / Fraction" path={["prescription", "dose_per_fraction"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Overall Time" path={["prescription", "overall_time"]} {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>

      <Section title="Machine" data={p.machine} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="Technique" path={["machine", "technique"]} {...{ formData, onChange, isEditing }} />
          <EditField label="LINAC" path={["machine", "linac"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Energy" path={["machine", "energy"]} {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>

      <Section title="IGRT" data={p.igrt} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="Type" path={["igrt", "type"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Frequency" path={["igrt", "frequency"]} {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>

      <Section title="OAR Constraints" data={p.oar_constraints} isEditing={isEditing}>
        {isEditing ? (
          <OarConstraintsEditor formData={formData} onChange={onChange} />
        ) : (
          Object.entries(p.oar_constraints || {}).map(([organ, constraint]) => (
            <Field key={organ} label={organ} value={constraint} />
          ))
        )}
      </Section>

      <Section title="Planning" data={p.planning} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="Peer Review" path={["planning", "peer_review"]} type="boolean" {...{ formData, onChange, isEditing }} />
          <EditField label="Adaptive Planning" path={["planning", "adaptive"]} type="boolean" {...{ formData, onChange, isEditing }} />
          <EditField label="Bolus" path={["planning", "bolus"]} {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>

      <Section title="Quality Assurance" data={p.qa} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="Physics Check" path={["qa", "physics_check"]} type="boolean" {...{ formData, onChange, isEditing }} />
          <EditField label="Patient Specific QA" path={["qa", "patient_specific_QA"]} type="boolean" {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>

      <Section title="Follow-up" data={p.followup} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="First Review" path={["followup", "first_review"]} {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>

      {/* Brachytherapy — only really relevant when rt_type includes brachy,
          but always editable so a Combined protocol can be filled fully. */}
      <Section title="Brachytherapy" data={p.brachytherapy} isEditing={isEditing}>
        <Grid container spacing={1}>
          <EditField label="Applicator" path={["brachytherapy", "applicator_type"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Technique" path={["brachytherapy", "technique"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Dose Rate" path={["brachytherapy", "dose_rate"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Total Dose" path={["brachytherapy", "total_dose"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Fractions" path={["brachytherapy", "fractions"]} type="number" {...{ formData, onChange, isEditing }} />
          <EditField label="Dose / Fraction" path={["brachytherapy", "dose_per_fraction"]} {...{ formData, onChange, isEditing }} />
          <EditField label="Number of Implants" path={["brachytherapy", "number_of_implants"]} type="number" {...{ formData, onChange, isEditing }} />
        </Grid>
      </Section>
    </>
  );
};

// ─────────────────────────────────────────────────────────────
// Add Protocol Dialog — blank form, POSTs to
// POST /radiotherapy-protocol (add_protocol) on save.
// ─────────────────────────────────────────────────────────────
const AddProtocolDialog = ({ open, onClose, apiBaseUrl, onCreated }) => {
  const [formData, setFormData] = useState(emptyProtocol());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (open) {
      setFormData(emptyProtocol());
      setError("");
    }
  }, [open]);

  const handleChange = (path, value) => {
    setFormData((prev) => setNested(prev, path, value));
  };

  const handleSave = async () => {
    if (!formData.protocol_name || !formData.disease_site || !formData.technique) {
      setError("Protocol Name, Disease Site, and Technique are required.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      const payload = toApiPayload(formData);
      const res = await fetch(`${apiBaseUrl}/hms/users/data/radiotherapy-protocol`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (res.ok && json.status === "success") {
        onCreated();
        onClose();
      } else {
        setError(json.detail || "Failed to add protocol.");
      }
    } catch (err) {
      console.error("Failed to add protocol:", err);
      setError("An error occurred while adding the protocol.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          fontFamily: FONT,
          fontWeight: FW_MEDIUM,
          bgcolor: C.black,
          color: C.white,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        Add Radiotherapy Protocol
        <IconButton onClick={onClose} sx={{ color: C.white, p: 0 }}>
          <Typography sx={{ fontSize: 20 }}>&times;</Typography>
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        {error && (
          <Box sx={{ p: 1.5, mb: 2, bgcolor: "#fff3e0", color: "#e65100", fontSize: 13, fontFamily: FONT }}>
            {error}
          </Box>
        )}
        <ProtocolFieldSet formData={formData} onChange={handleChange} isEditing={true} />
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: `1px solid ${C.border}` }}>
        <Button onClick={onClose} sx={{ ...btnStyle, color: C.textSecond }}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={saving}
          onClick={handleSave}
          sx={{ ...btnStyle, bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" } }}
        >
          {saving ? "Saving…" : "Save Protocol"}
        </Button>
      </DialogActions>
    </Dialog>
  );
};

// ─────────────────────────────────────────────────────────────
// Protocol Details Dialog — read-only by default, toggles into a
// full edit form via the "Edit" button. Save PUTs to
// PUT /radiotherapy-protocol/{protocol_id} (update_protocol).
// Never shows LLM/patient-adapted metadata (treatment intent label,
// start date, concurrent therapy, special instructions, reason for
// change, safety flags) — those only exist after /select is called.
// ─────────────────────────────────────────────────────────────
const RadiotherapyProtocolPreviewDialog = ({
  open,
  onClose,
  protocol,
  loading,
  onApply,
  applyingId,
  apiBaseUrl,
  onUpdated,
}) => {
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState(emptyProtocol());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // sync form state whenever a new protocol loads, and reset edit mode
  React.useEffect(() => {
    setFormData(toFormShape(protocol));
    setIsEditing(false);
    setError("");
  }, [protocol]);

  const p = isEditing ? formData : protocol || {};
  const references = p.references || [];

  const handleChange = (path, value) => {
    setFormData((prev) => setNested(prev, path, value));
  };

  const handleSave = async () => {
    setSaving(true);
    setError("");
    try {
      const payload = toApiPayload(formData);
      const res = await fetch(
        `${apiBaseUrl}/hms/users/data/radiotherapy-protocol/${protocol.protocol_id}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        }
      );
      const json = await res.json();
      if (res.ok && json.status === "success") {
        setIsEditing(false);
        onUpdated(); // let parent refresh the list + this dialog's data
      } else {
        setError(json.detail || "Failed to update protocol.");
      }
    } catch (err) {
      console.error("Failed to update protocol:", err);
      setError("An error occurred while updating the protocol.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancelEdit = () => {
    setFormData(toFormShape(protocol));
    setIsEditing(false);
    setError("");
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle
        sx={{
          fontFamily: FONT,
          fontWeight: FW_MEDIUM,
          bgcolor: C.black,
          color: C.white,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        {isEditing ? "Edit Radiotherapy Protocol" : "Selected Radiotherapy Protocol"}
        <IconButton onClick={onClose} sx={{ color: C.white, p: 0 }}>
          <Typography sx={{ fontSize: 20 }}>&times;</Typography>
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ p: 3 }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 6 }}>
            <CircularProgress size={28} sx={{ color: C.black }} />
          </Box>
        ) : !protocol ? (
          <Box sx={{ p: 4, textAlign: "center" }}>
            <Typography sx={{ fontFamily: FONT, color: C.textMuted, fontSize: 13 }}>
              No protocol data available.
            </Typography>
          </Box>
        ) : (
          <>
            {error && (
              <Box sx={{ p: 1.5, mb: 2, bgcolor: "#fff3e0", color: "#e65100", fontSize: 13, fontFamily: FONT }}>
                {error}
              </Box>
            )}

            {!isEditing && (
              <Box sx={{ mb: 2.5 }}>
                <Typography sx={{ fontFamily: FONT, fontWeight: FW_MEDIUM, fontSize: 16, color: C.black, mb: 0.5 }}>
                  {p.display_name || p.protocol_name}
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mb: 1.5 }}>
                  {hasValue(p.disease_site) && (
                    <Chip label={p.disease_site} size="small" sx={{ borderRadius: 0, bgcolor: C.bgTertiary }} />
                  )}
                  {hasValue(p.subsite) && (
                    <Chip label={p.subsite} size="small" sx={{ borderRadius: 0, bgcolor: C.bgTertiary }} />
                  )}
                  {(p.intent || []).map((i) => (
                    <Chip key={i} label={i} size="small" sx={{ borderRadius: 0, bgcolor: C.black, color: C.white }} />
                  ))}
                </Box>
                <Field label="Protocol Name" value={p.protocol_name} />
                <Field label="Technique" value={p.technique} />
                <Field label="RT Type" value={p.rt_type} />
                <Field label="Version" value={p.version} />
                <Field label="Status" value={p.status} />
                <Divider sx={{ mt: 2, borderColor: C.border }} />
              </Box>
            )}

            <ProtocolFieldSet formData={formData} onChange={handleChange} isEditing={isEditing} />

            {!isEditing && hasValue(references) && (
              <Box sx={{ mb: 1 }}>
                <SectionTitle>References</SectionTitle>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
                  {references.map((ref) => (
                    <Chip key={ref} label={ref} size="small" sx={{ borderRadius: 0, bgcolor: C.bgTertiary }} />
                  ))}
                </Box>
              </Box>
            )}
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ p: 2, borderTop: `1px solid ${C.border}` }}>
        {isEditing ? (
          <>
            <Button onClick={handleCancelEdit} sx={{ ...btnStyle, color: C.textSecond }}>
              Cancel
            </Button>
            <Button
              variant="contained"
              disabled={saving}
              onClick={handleSave}
              sx={{ ...btnStyle, bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" } }}
            >
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </>
        ) : (
          <>
            <Button onClick={onClose} sx={{ ...btnStyle, color: C.textSecond }}>
              Close
            </Button>
            <Button
              variant="outlined"
              onClick={() => setIsEditing(true)}
              sx={{ ...btnStyle, borderColor: C.black, color: C.black }}
            >
              Edit
            </Button>
            {protocol && (
              <Button
                variant="contained"
                disabled={applyingId === p.protocol_id}
                onClick={() => onApply(p.protocol_id)}
                sx={{ ...btnStyle, bgcolor: C.black, color: C.white, "&:hover": { bgcolor: "#333" } }}
              >
                {applyingId === p.protocol_id ? "Applying…" : "Apply Protocol"}
              </Button>
            )}
          </>
        )}
      </DialogActions>
    </Dialog>
  );
};

/**
 * RadiotherapyProtocolSelector
 *
 * Props:
 *  - open: boolean
 *  - onClose: () => void
 *  - patientId: string
 *  - doctorId: string
 *  - apiBaseUrl: string  (e.g. `${API_BASE_URL}radiotherapy-protocol`)
 *  - onApplied: (data) => void   called with { common, ebrt, brachy } after a successful select
 *
 * Matches the chemotherapy protocol-master pattern:
 *   GET  /list?patient_id=...        → protocols, each already flagged "recommended" by the backend
 *   GET  /{protocol_id}               → full protocol document, shown in the preview/edit dialog
 *   POST ""                           → add a brand-new protocol (Add Protocol button)
 *   PUT  /{protocol_id}               → update an existing protocol (Edit button in preview dialog)
 *   POST /select                      → { patientId, doctorId, protocolId } → { common, ebrt, brachy }
 */
const RadiotherapyProtocolSelector = ({
  open,
  onClose,
  patientId,
  doctorId,
  apiBaseUrl,
  onApplied,
}) => {
  const [loading, setLoading] = useState(false);
  const [applyingId, setApplyingId] = useState(null);

  const [protocols, setProtocols] = useState([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  // ── Protocol preview/edit dialog state ──
  const [selectedProtocol, setSelectedProtocol] = useState(null);
  const [protocolPreviewOpen, setProtocolPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);

  // ── Add Protocol dialog state ──
  const [addDialogOpen, setAddDialogOpen] = useState(false);

  const loadProtocols = async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (patientId) params.set("patient_id", patientId);

      const listRes = await fetch(
        `${apiBaseUrl}/hms/users/data/radiotherapy-protocol/list${params.toString() ? `?${params.toString()}` : ""}`
      );
      const listJson = await listRes.json();
      const list = listJson?.data || [];

      // Backend already flags "recommended" and pre-sorts, but sort again
      // client-side too so behavior is correct even if the backend ordering
      // ever changes — recommended first, then alphabetical.
      list.sort((a, b) => {
        if (a.recommended && !b.recommended) return -1;
        if (!a.recommended && b.recommended) return 1;
        return (a.protocol_name || "").localeCompare(b.protocol_name || "");
      });

      setProtocols(list);
    } catch (err) {
      console.error("Failed to load radiotherapy protocols:", err);
      setError("Failed to load protocols. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  React.useEffect(() => {
    if (open) loadProtocols();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Search filters the already-loaded list locally — no server round trip.
  const filteredProtocols = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return protocols;
    return protocols.filter(
      (p) =>
        (p.protocol_name || "").toLowerCase().includes(term) ||
        (p.disease_site || "").toLowerCase().includes(term)
    );
  }, [protocols, search]);

  // ── View Details: GET the full protocol document, open preview dialog ──
  const handleViewProtocol = async (protocolId) => {
    setProtocolPreviewOpen(true);
    setPreviewLoading(true);
    setSelectedProtocol(null);
    try {
      const res = await fetch(
        `${apiBaseUrl}/hms/users/data/radiotherapy-protocol/${protocolId}`
      );
      const json = await res.json();
      if (json.status === "success") {
        setSelectedProtocol(json.data);
      } else {
        setError(json.detail || "Failed to load protocol details.");
        setProtocolPreviewOpen(false);
      }
    } catch (err) {
      console.error("Failed to fetch protocol details:", err);
      setError("An error occurred while loading protocol details.");
      setProtocolPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleClosePreview = () => {
    setProtocolPreviewOpen(false);
    setSelectedProtocol(null);
  };

  // Called after a successful PUT in the preview dialog: refresh both
  // the underlying list (so card text reflects the edit) and re-fetch
  // this one protocol's full document (so the dialog shows saved data).
  const handleProtocolUpdated = async () => {
    await loadProtocols();
    if (selectedProtocol?.protocol_id) {
      await handleViewProtocol(selectedProtocol.protocol_id);
    }
  };

  // Called after a successful POST in the Add Protocol dialog.
  const handleProtocolCreated = () => {
    loadProtocols();
  };

  const handleApply = async (protocolId) => {
    setApplyingId(protocolId);
    setError("");
    try {
      const res = await fetch(`${apiBaseUrl}/hms/users/data/radiotherapy-protocol/select`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patientId, doctorId: doctorId || "", protocolId }),
      });
      const json = await res.json();
      if (json.status === "success" && json.data) {
        onApplied(json.data); // { common, ebrt, brachy }
        handleClosePreview();
        onClose();
      } else {
        setError(json.detail || "Failed to select protocol.");
      }
    } catch (err) {
      console.error("Failed to select protocol:", err);
      setError("An error occurred while selecting the protocol.");
    } finally {
      setApplyingId(null);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontWeight: FW_MEDIUM, bgcolor: C.black, color: C.white, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          Radiotherapy Protocol Master
          <IconButton onClick={onClose} sx={{ color: C.white, p: 0 }}>
            <Typography sx={{ fontSize: 20 }}>&times;</Typography>
          </IconButton>
        </DialogTitle>

        <DialogContent sx={{ p: 0 }}>
          <Box sx={{ p: 2, borderBottom: `1px solid ${C.border}`, display: "flex", gap: 1 }}>
            <TextField
              size="small"
              fullWidth
              placeholder="Search by protocol name or disease site"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ "& .MuiOutlinedInput-root": { borderRadius: 0 } }}
            />
            <Button variant="outlined" sx={{ ...btnStyle, borderColor: C.black, color: C.black, whiteSpace: "nowrap" }} onClick={loadProtocols}>
              Refresh
            </Button>
            <Button
              variant="contained"
              sx={{ ...btnStyle, bgcolor: C.black, color: C.white, whiteSpace: "nowrap", "&:hover": { bgcolor: "#333" } }}
              onClick={() => setAddDialogOpen(true)}
            >
              + Add Protocol
            </Button>
          </Box>

          {error && (
            <Box sx={{ p: 2, bgcolor: "#fff3e0", color: "#e65100", fontSize: 13, fontFamily: FONT }}>
              {error}
            </Box>
          )}

          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", p: 6 }}>
              <CircularProgress size={28} sx={{ color: C.black }} />
            </Box>
          ) : filteredProtocols.length === 0 ? (
            <Box sx={{ p: 4, textAlign: "center" }}>
              <Typography sx={{ fontFamily: FONT, color: C.textMuted, fontSize: 13 }}>
                No radiotherapy protocols found.
              </Typography>
            </Box>
          ) : (
            <Box sx={{ maxHeight: "60vh", overflowY: "auto" }}>
              {filteredProtocols.map((p) => (
                <Box
                  key={p.protocol_id}
                  sx={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 2,
                    p: 2,
                    borderBottom: `1px solid ${C.border}`,
                    bgcolor: p.recommended ? C.bgSecondary : C.white,
                    cursor: "pointer",
                    "&:hover": { bgcolor: C.bgTertiary },
                  }}
                  onClick={() => handleViewProtocol(p.protocol_id)}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5, flexWrap: "wrap" }}>
                      <Typography sx={{ fontFamily: FONT, fontWeight: FW_MEDIUM, fontSize: 14, color: C.black }}>
                        {p.protocol_name}
                      </Typography>
                      {p.recommended && (
                        <Chip
                          label="Recommended"
                          size="small"
                          sx={{ bgcolor: C.black, color: C.white, fontSize: 10.5, height: 20, borderRadius: 0 }}
                        />
                      )}
                    </Box>
                    <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.textMuted, mb: 0.5 }}>
                      {p.disease_site} · {p.technique} {p.dose ? `· ${p.dose}` : ""} {p.fractions ? `/ ${p.fractions} Fx` : ""}
                    </Typography>
                  </Box>

                  <Box sx={{ display: "flex", gap: 1, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="outlined"
                      onClick={() => handleViewProtocol(p.protocol_id)}
                      sx={{ ...btnStyle, borderColor: C.black, color: C.black, whiteSpace: "nowrap" }}
                    >
                      View Details
                    </Button>
                    <Button
                      variant="contained"
                      disabled={applyingId === p.protocol_id}
                      onClick={() => handleApply(p.protocol_id)}
                      sx={{ ...btnStyle, bgcolor: C.black, color: C.white, whiteSpace: "nowrap", "&:hover": { bgcolor: "#333" } }}
                    >
                      {applyingId === p.protocol_id ? "Applying…" : "Apply Protocol"}
                    </Button>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ p: 2, borderTop: `1px solid ${C.border}` }}>
          <Button onClick={onClose} sx={{ ...btnStyle, color: C.textSecond }}>
            Close
          </Button>
        </DialogActions>
      </Dialog>

      {/* Details dialog — read-only by default, "Edit" switches it into
          a full editable form and PUTs the change on Save. */}
      <RadiotherapyProtocolPreviewDialog
        open={protocolPreviewOpen}
        onClose={handleClosePreview}
        protocol={selectedProtocol}
        loading={previewLoading}
        onApply={handleApply}
        applyingId={applyingId}
        apiBaseUrl={apiBaseUrl}
        onUpdated={handleProtocolUpdated}
      />

      {/* Add Protocol dialog — blank form, POSTs a new protocol document. */}
      <AddProtocolDialog
        open={addDialogOpen}
        onClose={() => setAddDialogOpen(false)}
        apiBaseUrl={apiBaseUrl}
        onCreated={handleProtocolCreated}
      />
    </>
  );
};

export default RadiotherapyProtocolSelector;