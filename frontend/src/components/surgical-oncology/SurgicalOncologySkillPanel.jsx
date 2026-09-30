import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Snackbar,
  TextField,
  Typography,
} from "@mui/material";
import {
  Add,
  Close,
  EditOutlined,
  ExpandLess,
  ExpandMore,
  FileDownloadOutlined,
  PlayArrow,
  PowerSettingsNew,
  SaveOutlined,
  Search,
} from "@mui/icons-material";

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api";

const SKILL_BASE =
  `${API_BASE_URL.replace(/\/+$/, "")}` +
  `/hms/users/ai-legacy/surgical-oncology/skills/surgical-oncology`;

const FONT = '"Open Sans", sans-serif';
const MONO = '"Space Mono", monospace';

const C = {
  black: "#111111",
  white: "#ffffff",
  bg: "#fafafa",
  panel: "#f5f5f5",
  border: "#dddddd",
  text: "#222222",
  muted: "#707070",
  ok: "#276738",
  watch: "#8a6d1c",
  alert: "#b03d2b",
  neutral: "#666666",
  okBg: "#f2f9f4",
  watchBg: "#fdfaf0",
  alertBg: "#fdf4f2",
};

const safeArray = (value) => (Array.isArray(value) ? value : []);
const unwrap = (response) => response?.data ?? response;

const normalize = (value) =>
  String(value ?? "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

function statusMeta(status) {
  const s = String(status || "neutral").toLowerCase();
  if (s === "ok") return { label: "Verified", color: C.ok, bg: C.okBg };
  if (s === "watch") return { label: "Watch", color: C.watch, bg: C.watchBg };
  if (s === "alert" || s === "flag")
    return { label: s === "flag" ? "Flagged" : "Alert", color: C.alert, bg: C.alertBg };
  return { label: "Not available", color: C.neutral, bg: "#f7f7f7" };
}

function logRequest(label, url, options = {}, extra = null) {
  console.groupCollapsed(`🚀 [SURGICAL SKILL → BACKEND] ${label}`);
  console.log("URL:", url);
  console.log("Method:", options.method || "GET");
  console.log("Payload:", options.body ? JSON.parse(options.body) : null);
  if (extra) console.log("Resolved data:", extra);
  console.groupEnd();
}

function logResponse(label, url, response, data) {
  console.groupCollapsed(`📥 [BACKEND → SURGICAL SKILL] ${label}`);
  console.log("URL:", url);
  console.log("HTTP:", response.status);
  console.log("OK:", response.ok);
  console.log("Response:", data);
  console.groupEnd();
}

function logError(label, url, error) {
  console.groupCollapsed(`❌ [SURGICAL SKILL API ERROR] ${label}`);
  console.log("URL:", url);
  console.error(error);
  console.groupEnd();
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  return contentType.includes("application/json")
    ? response.json()
    : response.text();
}

async function throwIfNotOk(response, data) {
  if (response.ok) return;
  const detail = data?.detail;
  if (Array.isArray(detail)) {
    throw new Error(detail.map((x) => x?.msg || JSON.stringify(x)).join("; "));
  }
  if (detail && typeof detail === "object") throw new Error(JSON.stringify(detail));
  throw new Error(detail || data?.message || `Request failed with HTTP ${response.status}`);
}

function JsonOutput({ value }) {
  return (
    <Box
      component="pre"
      sx={{
        m: 0,
        p: 1.5,
        background: "#f7f7f7",
        border: `1px solid ${C.border}`,
        overflow: "auto",
        maxHeight: 360,
        fontFamily: MONO,
        fontSize: 10.5,
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}
    >
      {JSON.stringify(value ?? {}, null, 2)}
    </Box>
  );
}

export default function SurgicalOncologySkillPanel({
  open,
  onClose,
  patientId,
  doctorId,
}) {
  const [catalog, setCatalog] = useState([]);
  const [configuration, setConfiguration] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [customParameters, setCustomParameters] = useState([]);
  const [skillName, setSkillName] = useState("Surgical Oncology Intelligence Skill");
  const [active, setActive] = useState(false);

  const [search, setSearch] = useState("");
  const [expandedModules, setExpandedModules] = useState({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [activating, setActivating] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  const [editItem, setEditItem] = useState(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editing, setEditing] = useState(false);

  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customDescription, setCustomDescription] = useState("");

  const [message, setMessage] = useState("");
  const [messageSeverity, setMessageSeverity] = useState("success");

  const showMessage = useCallback((text, severity = "success") => {
    setMessage(text);
    setMessageSeverity(severity);
  }, []);

  const loadSkill = useCallback(async () => {
    if (!doctorId) return;
    setLoading(true);

    try {
      const catalogUrl = `${SKILL_BASE}/catalog`;
      const configUrl =
        `${SKILL_BASE}/configuration?doctorId=` +
        encodeURIComponent(String(doctorId));

      logRequest("Load catalog", catalogUrl);
      const catalogResponse = await fetch(catalogUrl);
      const catalogData = await parseResponse(catalogResponse);
      logResponse("Catalog response", catalogUrl, catalogResponse, catalogData);
      await throwIfNotOk(catalogResponse, catalogData);

      logRequest("Load doctor configuration", configUrl);
      const configResponse = await fetch(configUrl);
      const configData = await parseResponse(configResponse);
      logResponse("Configuration response", configUrl, configResponse, configData);
      await throwIfNotOk(configResponse, configData);

      const catalogPayload = unwrap(catalogData);
      const configPayload = unwrap(configData);
      const modules = safeArray(catalogPayload?.modules);

      setCatalog(modules);
      setConfiguration(configPayload);
      setSelectedIds(safeArray(configPayload?.enabled_parameters));
      setOverrides(configPayload?.parameter_overrides || {});
      setCustomParameters(safeArray(configPayload?.custom_parameters));
      setSkillName(configPayload?.skill_name || "Surgical Oncology Intelligence Skill");
      setActive(Boolean(configPayload?.active));

      const expanded = {};
      modules.forEach((module) => {
        expanded[module.module_id] = true;
      });
      setExpandedModules(expanded);

      console.groupCollapsed("🧠 [SURGICAL SKILL STATE] Loaded");
      console.log("Modules:", modules);
      console.log("Configuration:", configPayload);
      console.log("Selected IDs:", configPayload?.enabled_parameters);
      console.log("Selected parameter definitions:", configPayload?.selected_parameter_definitions);
      console.log("Overrides:", configPayload?.parameter_overrides);
      console.log("Custom parameters:", configPayload?.custom_parameters);
      console.groupEnd();
    } catch (error) {
      logError("Load Skill", SKILL_BASE, error);
      showMessage(error.message || "Failed to load Surgical Oncology Skill.", "error");
    } finally {
      setLoading(false);
    }
  }, [doctorId, showMessage]);

  useEffect(() => {
    if (open) loadSkill();
  }, [open, loadSkill]);

  const allParameters = useMemo(
    () =>
      catalog.flatMap((module) =>
        safeArray(module.parameters).map((parameter) => ({
          ...parameter,
          module_id: parameter.module_id || module.module_id,
          module_name: parameter.module_name || module.module_name,
        }))
      ),
    [catalog]
  );

  const selectedDefinitions = useMemo(
    () => allParameters.filter((p) => selectedIds.includes(p.id)),
    [allParameters, selectedIds]
  );

  const filteredModules = useMemo(() => {
    const query = normalize(search);
    if (!query) return catalog;

    return catalog
      .map((module) => ({
        ...module,
        parameters: safeArray(module.parameters).filter((parameter) =>
          normalize(
            `${parameter.name} ${parameter.backend_parameter || ""}`
          ).includes(query)
        ),
      }))
      .filter((module) => module.parameters.length > 0);
  }, [catalog, search]);

  const selectedCount = selectedIds.length + customParameters.length;

  const toggleParameter = (parameterId) => {
    setSelectedIds((previous) =>
      previous.includes(parameterId)
        ? previous.filter((id) => id !== parameterId)
        : [...previous, parameterId]
    );
  };

  const selectModule = (module) => {
    const ids = safeArray(module.parameters).map((p) => p.id).filter(Boolean);
    setSelectedIds((previous) => [...new Set([...previous, ...ids])]);
  };

  const clearModule = (module) => {
    const ids = new Set(safeArray(module.parameters).map((p) => p.id));
    setSelectedIds((previous) => previous.filter((id) => !ids.has(id)));
  };

  const toggleModule = (moduleId) => {
    setExpandedModules((previous) => ({
      ...previous,
      [moduleId]: !previous[moduleId],
    }));
  };

  const saveConfiguration = useCallback(async ({silent = false} = {}) => {
    if (!doctorId) {
      if (!silent) showMessage("Doctor ID is required.", "error");
      return null;
    }

    const payload = {
      doctor_id: String(doctorId),
      enabled_parameters: selectedIds,
      selected_parameter_definitions: selectedDefinitions,
      skill_name: skillName.trim() || "Surgical Oncology Intelligence Skill",
      active,
      parameter_overrides: overrides,
      custom_parameters: customParameters,
    };

    const url = `${SKILL_BASE}/configuration`;
    const options = {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };

    setSaving(true);
    try {
      logRequest("Save configuration", url, options, selectedDefinitions);

      const response = await fetch(url, options);
      const data = await parseResponse(response);
      logResponse("Save configuration response", url, response, data);
      await throwIfNotOk(response, data);

      const saved = unwrap(data);
      setConfiguration(saved);
      setSelectedIds(safeArray(saved?.enabled_parameters));
      setOverrides(saved?.parameter_overrides || {});
      setCustomParameters(safeArray(saved?.custom_parameters));
      setActive(Boolean(saved?.active));

      console.groupCollapsed("💾 [SURGICAL SKILL] COMPLETE SAVED CONFIGURATION");
      console.log("Configuration:", saved);
      console.log("Selected parameter definitions:", saved?.selected_parameter_definitions);
      console.log("Selected IDs:", saved?.enabled_parameters);
      console.groupEnd();

      if (!silent) showMessage("Surgical Oncology Skill saved.");
      return saved;
    } catch (error) {
      logError("Save configuration", url, error);
      if (!silent) showMessage(error.message || "Failed to save Skill.", "error");
      throw error;
    } finally {
      setSaving(false);
    }
  }, [
    doctorId,
    selectedIds,
    selectedDefinitions,
    skillName,
    active,
    overrides,
    customParameters,
    showMessage,
  ]);

  const openEdit = (parameter) => {
    const override = overrides?.[parameter.id] || {};
    setEditItem(parameter);
    setEditName(override.name || parameter.name || "");
    setEditDescription(override.description || parameter.description || "");
  };

  const saveParameterEdit = async () => {
    if (!editItem || !doctorId) return;

    const payload = {
      doctor_id: String(doctorId),
      name: editName.trim(),
      description: editDescription.trim(),
    };
    const url = `${SKILL_BASE}/parameters/${encodeURIComponent(editItem.id)}`;
    const options = {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };

    setEditing(true);
    try {
      logRequest("Edit parameter", url, options);
      const response = await fetch(url, options);
      const data = await parseResponse(response);
      logResponse("Edit parameter response", url, response, data);
      await throwIfNotOk(response, data);

      const saved = unwrap(data);
      setConfiguration(saved);
      setOverrides(saved?.parameter_overrides || {});
      setEditItem(null);
      showMessage("Parameter updated.");
    } catch (error) {
      logError("Edit parameter", url, error);
      showMessage(error.message || "Failed to edit parameter.", "error");
    } finally {
      setEditing(false);
    }
  };

  const addCustomParameter = async () => {
    if (!doctorId) return;
    if (!customName.trim()) {
      showMessage("Enter a custom check name.", "error");
      return;
    }

    const payload = {
      doctor_id: String(doctorId),
      name: customName.trim(),
      description: customDescription.trim(),
    };
    const url = `${SKILL_BASE}/parameters/custom`;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };

    try {
      logRequest("Add custom parameter", url, options);
      const response = await fetch(url, options);
      const data = await parseResponse(response);
      logResponse("Add custom parameter response", url, response, data);
      await throwIfNotOk(response, data);

      const saved = unwrap(data);
      setConfiguration(saved);
      setSelectedIds(safeArray(saved?.enabled_parameters));
      setOverrides(saved?.parameter_overrides || {});
      setCustomParameters(safeArray(saved?.custom_parameters));
      setActive(Boolean(saved?.active));
      setCustomOpen(false);
      setCustomName("");
      setCustomDescription("");
      showMessage("Custom manual-review check added.");
    } catch (error) {
      logError("Add custom parameter", url, error);
      showMessage(error.message || "Failed to add custom check.", "error");
    }
  };

  const toggleActivation = async () => {
    if (!doctorId) return;

    const payload = { doctor_id: String(doctorId), active: !active };
    const url = `${SKILL_BASE}/activation`;
    const options = {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    };

    setActivating(true);
    try {
      logRequest("Toggle activation", url, options);
      const response = await fetch(url, options);
      const data = await parseResponse(response);
      logResponse("Activation response", url, response, data);
      await throwIfNotOk(response, data);

      const saved = unwrap(data);
      setConfiguration(saved);
      setActive(Boolean(saved?.active));
      setSelectedIds(safeArray(saved?.enabled_parameters));
      setOverrides(saved?.parameter_overrides || {});
      setCustomParameters(safeArray(saved?.custom_parameters));

      showMessage(
        saved?.active
          ? "Surgical Oncology Skill activated."
          : "Surgical Oncology Skill deactivated."
      );
    } catch (error) {
      logError("Toggle activation", url, error);
      showMessage(error.message || "Failed to change activation.", "error");
    } finally {
      setActivating(false);
    }
  };

  const testSkill = async (forceRegenerate = false) => {
    if (!doctorId || !patientId) {
      showMessage("Doctor ID and Patient ID are required to test the Skill.", "error");
      return;
    }

    setTesting(true);
    try {
      // Important: test the CURRENT UI selection, not stale saved configuration.
      // Saving first also creates the configuration version against which the test
      // output is persisted.
      await saveConfiguration({ silent: true });

      const payload = {
        doctor_id: String(doctorId),
        patient_id: String(patientId),
        force_regenerate: Boolean(forceRegenerate),
      };
      const url = `${SKILL_BASE}/test`;
      const options = {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      };

      logRequest("Test Skill", url, options);
      const started = performance.now();
      const response = await fetch(url, options);
      const data = await parseResponse(response);
      const elapsed = Math.round(performance.now() - started);
      logResponse("Test Skill response", url, response, data);
      console.log(`⏱️ [SURGICAL SKILL] Test duration: ${elapsed} ms`);
      await throwIfNotOk(response, data);

      const result = unwrap(data);
      setTestResult(result);

      console.groupCollapsed("🧪 [SURGICAL SKILL] COMPLETE PATIENT OUTPUT");
      console.log("Result:", result);
      console.log("Selected:", result?.selected_count);
      console.log("Matched:", result?.matched_count);
      console.log("Unmatched:", result?.unmatched_count);
      console.log("FULL selected results:", result?.results);
      console.log("FULL custom results:", result?.custom_results);
      console.groupEnd();

      showMessage("Surgical Oncology Skill test completed.");
    } catch (error) {
      logError("Test Skill", `${SKILL_BASE}/test`, error);
      showMessage(error.message || "Failed to test Skill.", "error");
    } finally {
      setTesting(false);
    }
  };

  const exportSkill = async () => {
    if (!doctorId || !patientId) {
      showMessage("Doctor ID and Patient ID are required to export the Skill.", "error");
      return;
    }

    setExporting(true);
    const url =
      `${SKILL_BASE}/export?doctorId=` +
      encodeURIComponent(String(doctorId)) +
      `&patientId=` +
      encodeURIComponent(String(patientId));

    try {
      logRequest("Export Skill", url);
      const response = await fetch(url);

      if (!response.ok) {
        const data = await parseResponse(response);
        await throwIfNotOk(response, data);
      }

      const blob = await response.blob();

      console.groupCollapsed("📤 [SURGICAL SKILL] Export response");
      console.log("URL:", url);
      console.log("HTTP:", response.status);
      console.log("Blob size:", blob.size);
      console.log("Content-Type:", blob.type);
      console.groupEnd();

      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = downloadUrl;
      anchor.download = "surgical_oncology_skill.md";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.URL.revokeObjectURL(downloadUrl);

      showMessage("Complete Skill export downloaded.");
    } catch (error) {
      logError("Export Skill", url, error);
      showMessage(error.message || "Failed to export Skill.", "error");
    } finally {
      setExporting(false);
    }
  };

  const testGroups = useMemo(() => {
    const groups = new Map();

    safeArray(testResult?.results).forEach((item) => {
      const moduleId = item.module_id || "other";
      if (!groups.has(moduleId)) {
        groups.set(moduleId, {
          module_id: moduleId,
          module_name: item.module_name || "Surgical Oncology Assessment",
          rows: [],
        });
      }
      groups.get(moduleId).rows.push(item);
    });

    const custom = safeArray(testResult?.custom_results);
    if (custom.length) {
      groups.set("custom", {
        module_id: "custom",
        module_name: "Doctor Added Checks",
        rows: custom,
      });
    }

    return [...groups.values()];
  }, [testResult]);

  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="xl"
        scroll="paper"
        PaperProps={{
          sx: {
            borderRadius: 0,
            border: `1px solid ${C.border}`,
            maxHeight: "96vh",
          },
        }}
      >
        <DialogTitle
          sx={{
            px: 3,
            py: 2,
            borderBottom: `1px solid ${C.border}`,
            fontFamily: FONT,
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
            <Box>
              <Typography sx={{ fontFamily: FONT, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.16em", color: C.muted, mb: 0.5 }}>
                Surgical Oncology
              </Typography>
              <Typography sx={{ fontFamily: FONT, fontSize: 22, fontWeight: 500, color: C.black }}>
                Intelligence Skill
              </Typography>
              <Typography sx={{ mt: 0.4, fontFamily: FONT, fontSize: 12, color: C.muted }}>
                Select existing surgical-intelligence checks for this doctor. The Skill filters the
                existing 12-agent output; it does not create a second clinical engine.
              </Typography>
            </Box>
            <IconButton onClick={onClose}><Close /></IconButton>
          </Box>
        </DialogTitle>

        <DialogContent dividers sx={{ p: 0, background: C.bg }}>
          {loading ? (
            <Box sx={{ minHeight: 420, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <CircularProgress size={28} />
            </Box>
          ) : (
            <Box sx={{ p: 2.5 }}>
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: { xs: "1fr", md: "1.6fr 1fr auto" },
                  gap: 1.5,
                  alignItems: "end",
                  mb: 2,
                }}
              >
                <TextField
                  size="small"
                  label="Skill Name"
                  value={skillName}
                  onChange={(e) => setSkillName(e.target.value)}
                  fullWidth
                  sx={{
                    "& .MuiInputBase-root": { fontFamily: FONT, fontSize: 13, borderRadius: 0 },
                    "& .MuiInputLabel-root": { fontFamily: FONT, fontSize: 12 },
                  }}
                />

                <Box sx={{ border: `1px solid ${C.border}`, background: C.white, px: 1.5, py: 1, minHeight: 40 }}>
                  <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.muted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                    Selected checks
                  </Typography>
                  <Typography sx={{ fontFamily: MONO, fontSize: 16, fontWeight: 500 }}>
                    {selectedCount}
                  </Typography>
                </Box>

                <Box sx={{ display: "flex", alignItems: "center", gap: 1, height: 40, px: 1.5, border: `1px solid ${active ? C.ok : C.border}`, background: active ? C.okBg : C.white }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: "50%", background: active ? C.ok : C.neutral }} />
                  <Typography sx={{ fontFamily: FONT, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: active ? C.ok : C.muted }}>
                    {active ? "Active" : "Inactive"}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ display: "flex", gap: 1, alignItems: "center", flexWrap: "wrap", mb: 2 }}>
                <TextField
                  size="small"
                  placeholder="Search surgical checks..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  InputProps={{ startAdornment: <Search sx={{ fontSize: 18, color: C.muted, mr: 0.8 }} /> }}
                  sx={{
                    flex: 1,
                    minWidth: 240,
                    "& .MuiInputBase-root": { fontFamily: FONT, fontSize: 12, borderRadius: 0, background: C.white },
                  }}
                />

                <Button
                  variant="outlined"
                  startIcon={<Add />}
                  onClick={() => setCustomOpen(true)}
                  sx={{ borderRadius: 0, textTransform: "none", fontFamily: FONT, fontSize: 11.5 }}
                >
                  Add custom check
                </Button>

                <Button
                  variant="outlined"
                  onClick={() => setSelectedIds(allParameters.map((p) => p.id))}
                  sx={{ borderRadius: 0, textTransform: "none", fontFamily: FONT, fontSize: 11.5 }}
                >
                  Select all
                </Button>

                <Button
                  variant="outlined"
                  onClick={() => setSelectedIds([])}
                  sx={{ borderRadius: 0, textTransform: "none", fontFamily: FONT, fontSize: 11.5 }}
                >
                  Clear
                </Button>
              </Box>

              {filteredModules.map((module) => {
                const ids = safeArray(module.parameters).map((p) => p.id);
                const moduleSelected = ids.filter((id) => selectedSet.has(id)).length;
                const expanded = expandedModules[module.module_id] !== false;

                return (
                  <Box key={module.module_id} sx={{ mb: 1.5, border: `1px solid ${C.border}`, background: C.white }}>
                    <Box
                      sx={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 1,
                        px: 1.5,
                        py: 1,
                        background: C.panel,
                        borderBottom: expanded ? `1px solid ${C.border}` : "none",
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>
                          {module.num} · {module.module_name}
                        </Typography>
                        <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>
                          {moduleSelected}/{ids.length} selected
                        </Typography>
                      </Box>

                      <Box sx={{ display: "flex", gap: 0.5, alignItems: "center" }}>
                        <Button size="small" onClick={() => selectModule(module)} sx={{ minWidth: 0, fontFamily: FONT, fontSize: 10, textTransform: "none" }}>
                          Select module
                        </Button>
                        <Button size="small" onClick={() => clearModule(module)} sx={{ minWidth: 0, fontFamily: FONT, fontSize: 10, textTransform: "none" }}>
                          Clear
                        </Button>
                        <IconButton size="small" onClick={() => toggleModule(module.module_id)}>
                          {expanded ? <ExpandLess /> : <ExpandMore />}
                        </IconButton>
                      </Box>
                    </Box>

                    <Collapse in={expanded}>
                      <Box sx={{ p: 1 }}>
                        {safeArray(module.parameters).map((parameter, index) => {
                          const selected = selectedSet.has(parameter.id);
                          const override = overrides?.[parameter.id] || {};
                          const displayName = override.name || parameter.name;

                          return (
                            <Box
                              key={parameter.id}
                              sx={{
                                display: "grid",
                                gridTemplateColumns: "auto 1fr auto",
                                gap: 1,
                                alignItems: "center",
                                px: 1,
                                py: 0.8,
                                borderBottom: index < module.parameters.length - 1 ? `1px solid ${C.border}` : "none",
                              }}
                            >
                              <Checkbox
                                size="small"
                                checked={selected}
                                onChange={() => toggleParameter(parameter.id)}
                              />
                              <Box sx={{ minWidth: 0 }}>
                                <Typography sx={{ fontFamily: FONT, fontSize: 12, color: C.text, fontWeight: selected ? 600 : 400 }}>
                                  {displayName}
                                </Typography>
                                <Typography sx={{ fontFamily: MONO, fontSize: 9.5, color: C.muted }}>
                                  {parameter.id} · backend: {parameter.backend_parameter}
                                </Typography>
                                {(override.description || parameter.description) && (
                                  <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: C.muted, mt: 0.25 }}>
                                    {override.description || parameter.description}
                                  </Typography>
                                )}
                              </Box>
                              <Button
                                size="small"
                                startIcon={<EditOutlined sx={{ fontSize: 14 }} />}
                                onClick={() => openEdit(parameter)}
                                sx={{ fontFamily: FONT, fontSize: 10, textTransform: "none", minWidth: 0 }}
                              >
                                Edit
                              </Button>
                            </Box>
                          );
                        })}
                      </Box>
                    </Collapse>
                  </Box>
                );
              })}

              {customParameters.length > 0 && (
                <Box sx={{ mt: 2, border: `1px solid ${C.border}`, background: C.white }}>
                  <Box sx={{ px: 1.5, py: 1, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
                    <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>
                      Doctor Added Checks
                    </Typography>
                    <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.muted }}>
                      Manual review only — no clinical result is fabricated.
                    </Typography>
                  </Box>
                  {customParameters.map((item, index) => (
                    <Box key={item.id} sx={{ px: 1.5, py: 1, borderBottom: index < customParameters.length - 1 ? `1px solid ${C.border}` : "none" }}>
                      <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: 500 }}>{item.name}</Typography>
                      <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: C.muted }}>
                        {item.id} · {item.description || "Doctor-defined review"}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {testResult && (
                <Box sx={{ mt: 2.5, borderTop: `1px solid ${C.border}`, pt: 2 }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, mb: 1 }}>
                    <Box>
                      <Typography sx={{ fontFamily: FONT, fontSize: 13, fontWeight: 600 }}>
                        Patient-specific test output
                      </Typography>
                      <Typography sx={{ fontFamily: FONT, fontSize: 10.5, color: C.muted }}>
                        Complete original backend row is preserved under <code>output</code>.
                      </Typography>
                    </Box>
                    <Typography sx={{ fontFamily: MONO, fontSize: 10, color: C.muted }}>
                      {testResult.matched_count || 0}/{testResult.selected_count || 0} matched
                    </Typography>
                  </Box>

                  {testGroups.map((group) => (
                    <Box key={group.module_id} sx={{ mb: 1.5, border: `1px solid ${C.border}`, background: C.white }}>
                      <Box sx={{ px: 1.5, py: 0.9, background: C.panel, borderBottom: `1px solid ${C.border}` }}>
                        <Typography sx={{ fontFamily: FONT, fontSize: 11.5, fontWeight: 600 }}>
                          {group.module_name}
                        </Typography>
                      </Box>

                      {group.rows.map((row) => (
                        <TestResultRow key={row.parameter_id} row={row} />
                      ))}
                    </Box>
                  ))}

                  {Number(testResult.unmatched_count || 0) > 0 && (
                    <Alert severity="warning" sx={{ mt: 1, fontFamily: FONT }}>
                      {testResult.unmatched_count} selected check(s) did not match an existing Surgical Oncology dashboard row.
                    </Alert>
                  )}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions sx={{ px: 2.5, py: 1.5, borderTop: `1px solid ${C.border}`, background: C.white, gap: 1, flexWrap: "wrap" }}>
          <Button
            onClick={exportSkill}
            disabled={exporting || !patientId}
            startIcon={exporting ? <CircularProgress size={15} /> : <FileDownloadOutlined />}
            sx={{ mr: "auto", borderRadius: 0, textTransform: "none", fontFamily: FONT, fontSize: 11.5 }}
          >
            {exporting ? "Exporting…" : "Export complete skill.md"}
          </Button>

          <Button
            onClick={() => testSkill(false)}
            disabled={testing || saving || !patientId}
            startIcon={testing ? <CircularProgress size={15} /> : <PlayArrow />}
            variant="outlined"
            sx={{ borderRadius: 0, textTransform: "none", fontFamily: FONT, fontSize: 11.5 }}
          >
            {testing ? "Testing…" : "Test Skill"}
          </Button>

          <Button
            onClick={saveConfiguration}
            disabled={saving}
            startIcon={saving ? <CircularProgress size={15} /> : <SaveOutlined />}
            variant="contained"
            sx={{ borderRadius: 0, textTransform: "none", fontFamily: FONT, fontSize: 11.5, background: C.black, "&:hover": { background: "#222" } }}
          >
            {saving ? "Saving…" : "Save"}
          </Button>

          <Button
            onClick={toggleActivation}
            disabled={activating}
            startIcon={<PowerSettingsNew />}
            variant="outlined"
            sx={{ borderRadius: 0, textTransform: "none", fontFamily: FONT, fontSize: 11.5, color: active ? C.alert : C.ok, borderColor: active ? `${C.alert}66` : `${C.ok}66` }}
          >
            {activating ? "Updating…" : active ? "Deactivate" : "Activate"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={Boolean(editItem)} onClose={() => setEditItem(null)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 17 }}>Edit Skill Parameter</DialogTitle>
        <DialogContent dividers>
          <TextField fullWidth size="small" label="Parameter name" value={editName} onChange={(e) => setEditName(e.target.value)} sx={{ mb: 2, "& .MuiInputBase-root": { fontFamily: FONT, borderRadius: 0 } }} />
          <TextField fullWidth multiline minRows={3} size="small" label="Description" value={editDescription} onChange={(e) => setEditDescription(e.target.value)} sx={{ "& .MuiInputBase-root": { fontFamily: FONT, borderRadius: 0 } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditItem(null)} sx={{ fontFamily: FONT, textTransform: "none" }}>Cancel</Button>
          <Button onClick={saveParameterEdit} disabled={editing} variant="contained" sx={{ fontFamily: FONT, textTransform: "none", background: C.black }}>
            {editing ? "Saving…" : "Save changes"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={customOpen} onClose={() => setCustomOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 17 }}>Add Custom Surgical Check</DialogTitle>
        <DialogContent dividers>
          <TextField fullWidth size="small" label="Check name" value={customName} onChange={(e) => setCustomName(e.target.value)} sx={{ mb: 2, "& .MuiInputBase-root": { fontFamily: FONT, borderRadius: 0 } }} />
          <TextField fullWidth multiline minRows={3} size="small" label="Description / review instruction" value={customDescription} onChange={(e) => setCustomDescription(e.target.value)} sx={{ "& .MuiInputBase-root": { fontFamily: FONT, borderRadius: 0 } }} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCustomOpen(false)} sx={{ fontFamily: FONT, textTransform: "none" }}>Cancel</Button>
          <Button onClick={addCustomParameter} variant="contained" sx={{ fontFamily: FONT, textTransform: "none", background: C.black }}>
            Add check
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(message)}
        autoHideDuration={3500}
        onClose={() => setMessage("")}
        message={message}
      />
    </>
  );
}

function TestResultRow({ row }) {
  const [open, setOpen] = useState(false);
  const meta = statusMeta(row.status);

  return (
    <Box sx={{ borderBottom: `1px solid ${C.border}` }}>
      <Box sx={{ p: 1.5 }}>
        <Box sx={{ display: "grid", gridTemplateColumns: "1.2fr 1.7fr 0.9fr", gap: 1.5 }}>
          <Box>
            <Typography sx={{ fontFamily: MONO, fontSize: 9.5, color: C.muted }}>
              {row.parameter_id}
            </Typography>
            <Typography sx={{ fontFamily: FONT, fontSize: 12, fontWeight: 600 }}>
              {row.parameter}
            </Typography>
          </Box>

          <Box>
            <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.muted, mb: 0.35 }}>
              Current finding
            </Typography>
            <Typography sx={{ fontFamily: FONT, fontSize: 11.5 }}>
              {row.current_finding || "Not available"}
            </Typography>
          </Box>

          <Box>
            <Typography sx={{ fontFamily: FONT, fontSize: 10, color: C.muted, mb: 0.35 }}>
              Status
            </Typography>
            <Box sx={{ display: "inline-flex", alignItems: "center", gap: 0.7, px: 1, py: 0.35, border: `1px solid ${meta.color}55`, background: meta.bg, color: meta.color, fontFamily: FONT, fontSize: 10, fontWeight: 600, textTransform: "uppercase" }}>
              <Box sx={{ width: 6, height: 6, borderRadius: "50%", background: meta.color }} />
              {row.status_label || meta.label}
            </Box>
          </Box>
        </Box>

        <Box sx={{ mt: 1 }}>
          <Button
            size="small"
            onClick={() => setOpen((v) => !v)}
            endIcon={open ? <ExpandLess /> : <ExpandMore />}
            sx={{ p: 0, fontFamily: FONT, fontSize: 10, textTransform: "none" }}
          >
            {open ? "Hide complete backend output" : "View complete backend output"}
          </Button>
        </Box>

        <Collapse in={open}>
          <Box sx={{ mt: 1 }}>
            <JsonOutput value={row.output} />
          </Box>
        </Collapse>
      </Box>
    </Box>
  );
}
