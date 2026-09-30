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
  Divider,
  IconButton,
  Snackbar,
  TextField,
  Typography,
} from "@mui/material";
import {
  Add,
  CheckCircleOutline,
  Close,
  EditOutlined,
  ExpandLess,
  ExpandMore,
  FileDownloadOutlined,
  PlayArrow,
  SaveOutlined,
  PowerSettingsNew,
  Search,
} from "@mui/icons-material";

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api";

const SKILL_BASE =
  `${API_BASE_URL.replace(/\/+$/, "")}` +
  `/hms/users/ai-legacy/radiotherapyagents/skills/radiation-oncology`;

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

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function unwrap(response) {
  return response?.data ?? response;
}

function normalize(value) {
  return String(value ?? "")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function statusMeta(status) {
  const s = String(status || "neutral").toLowerCase();

  if (s === "ok" || s === "verified") {
    return { label: "Verified", color: C.ok, bg: C.okBg };
  }

  if (s === "watch") {
    return { label: "Watch", color: C.watch, bg: C.watchBg };
  }

  if (s === "alert") {
    return { label: "Alert", color: C.alert, bg: C.alertBg };
  }

  return { label: "Not available", color: C.neutral, bg: "#f7f7f7" };
}

function logRequest(label, url, options = {}) {
  console.groupCollapsed(`🚀 [RADIATION SKILL → BACKEND] ${label}`);
  console.log("URL:", url);
  console.log("Method:", options.method || "GET");
  console.log("Payload:", options.body ? JSON.parse(options.body) : null);
  console.groupEnd();
}

function logResponse(label, url, response, data) {
  console.groupCollapsed(`📥 [BACKEND → RADIATION SKILL] ${label}`);
  console.log("URL:", url);
  console.log("HTTP:", response.status);
  console.log("OK:", response.ok);
  console.log("Response:", data);
  console.groupEnd();
}

function logError(label, url, error) {
  console.groupCollapsed(`❌ [RADIATION SKILL API ERROR] ${label}`);
  console.log("URL:", url);
  console.error(error);
  console.groupEnd();
}

async function parseResponse(response) {
  const contentType = response.headers.get("content-type") || "";

  if (contentType.includes("application/json")) {
    return response.json();
  }

  return response.text();
}

async function throwIfNotOk(response, data) {
  if (response.ok) return;

  const detail = data?.detail;

  if (Array.isArray(detail)) {
    throw new Error(
      detail
        .map((item) => item?.msg || JSON.stringify(item))
        .join("; ")
    );
  }

  if (detail && typeof detail === "object") {
    throw new Error(JSON.stringify(detail));
  }

  throw new Error(
    detail ||
      data?.message ||
      `Request failed with HTTP ${response.status}`
  );
}

export default function RadiationOncologySkillPanel({
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

  const [skillName, setSkillName] = useState(
    "Radiation Oncology Intelligence Skill"
  );
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
      logResponse(
        "Configuration response",
        configUrl,
        configResponse,
        configData
      );
      await throwIfNotOk(configResponse, configData);

      const catalogPayload = unwrap(catalogData);
      const configPayload = unwrap(configData);

      const modules = safeArray(catalogPayload?.modules);

      setCatalog(modules);
      setConfiguration(configPayload);

      setSelectedIds(
        safeArray(configPayload?.enabled_parameters)
      );

      setOverrides(
        configPayload?.parameter_overrides || {}
      );

      setCustomParameters(
        safeArray(configPayload?.custom_parameters)
      );

      setSkillName(
        configPayload?.skill_name ||
          "Radiation Oncology Intelligence Skill"
      );

      setActive(Boolean(configPayload?.active));

      const initialExpanded = {};
      modules.forEach((module) => {
        initialExpanded[module.module_id] = true;
      });
      setExpandedModules(initialExpanded);

      console.groupCollapsed("🧠 [RADIATION SKILL STATE] Loaded");
      console.log("Modules:", modules);
      console.log("Configuration:", configPayload);
      console.log("Selected IDs:", configPayload?.enabled_parameters);
      console.log("Overrides:", configPayload?.parameter_overrides);
      console.log("Custom parameters:", configPayload?.custom_parameters);
      console.groupEnd();
    } catch (error) {
      logError("Load Skill", SKILL_BASE, error);
      showMessage(error.message || "Failed to load Radiation Oncology Skill.", "error");
    } finally {
      setLoading(false);
    }
  }, [doctorId, showMessage]);

  useEffect(() => {
    if (open) {
      loadSkill();
    }
  }, [open, loadSkill]);

  const allParameters = useMemo(
    () =>
      catalog.flatMap((module) =>
        safeArray(module.parameters).map((parameter) => ({
          ...parameter,
          module_id: parameter.module_id || module.module_id,
          module_name:
            parameter.module_name || module.module_name,
        }))
      ),
    [catalog]
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
    setSelectedIds((previous) => {
      const next = previous.includes(parameterId)
        ? previous.filter((id) => id !== parameterId)
        : [...previous, parameterId];

      console.log("📝 [RADIATION SKILL] Selection changed:", next);
      return next;
    });
  };

  const selectModule = (module) => {
    const ids = safeArray(module.parameters)
      .map((p) => p.id)
      .filter(Boolean);

    setSelectedIds((previous) => {
      const current = new Set(previous);
      ids.forEach((id) => current.add(id));
      const next = [...current];
      console.log(
        `📝 [RADIATION SKILL] Selected module ${module.module_name}:`,
        next
      );
      return next;
    });
  };

  const clearModule = (module) => {
    const ids = new Set(
      safeArray(module.parameters).map((p) => p.id)
    );

    setSelectedIds((previous) => {
      const next = previous.filter((id) => !ids.has(id));
      console.log(
        `📝 [RADIATION SKILL] Cleared module ${module.module_name}:`,
        next
      );
      return next;
    });
  };

  const toggleModule = (moduleId) => {
    setExpandedModules((previous) => ({
      ...previous,
      [moduleId]: !previous[moduleId],
    }));
  };

  const saveConfiguration = async () => {
    if (!doctorId) {
      showMessage("Doctor ID is required.", "error");
      return;
    }

    const payload = {
      doctor_id: String(doctorId),
      enabled_parameters: selectedIds,
      skill_name: skillName.trim() || "Radiation Oncology Intelligence Skill",
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
      logRequest("Save configuration", url, options);
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

      console.log("💾 [RADIATION SKILL] Saved configuration:", saved);
      showMessage("Radiation Oncology Skill saved.");
    } catch (error) {
      logError("Save configuration", url, error);
      showMessage(error.message || "Failed to save Skill.", "error");
    } finally {
      setSaving(false);
    }
  };

  const openEdit = (parameter) => {
    const override = overrides?.[parameter.id] || {};

    setEditItem(parameter);
    setEditName(
      override.name ||
        parameter.name ||
        ""
    );
    setEditDescription(
      override.description ||
        parameter.description ||
        ""
    );
  };

  const saveParameterEdit = async () => {
    if (!editItem || !doctorId) return;

    const payload = {
      doctor_id: String(doctorId),
      name: editName.trim(),
      description: editDescription.trim(),
    };

    const url =
      `${SKILL_BASE}/parameters/` +
      encodeURIComponent(editItem.id);

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

      setOverrides(saved?.parameter_overrides || {});
      setConfiguration(saved);

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
      logResponse(
        "Add custom parameter response",
        url,
        response,
        data
      );
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

    const nextActive = !active;

    const payload = {
      doctor_id: String(doctorId),
      active: nextActive,
    };

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
          ? "Radiation Oncology Skill activated."
          : "Radiation Oncology Skill deactivated."
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
      showMessage(
        "Doctor ID and Patient ID are required to test the Skill.",
        "error"
      );
      return;
    }

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

    setTesting(true);

    try {
      logRequest("Test Skill", url, options);

      const started = performance.now();
      const response = await fetch(url, options);
      const data = await parseResponse(response);
      const elapsed = Math.round(performance.now() - started);

      logResponse("Test Skill response", url, response, data);
      console.log(`⏱️ [RADIATION SKILL] Test duration: ${elapsed} ms`);

      await throwIfNotOk(response, data);

      const result = unwrap(data);

      setTestResult(result);

      console.groupCollapsed("🧪 [RADIATION SKILL] Complete test result");
      console.log("Result:", result);
      console.log("Selected:", result?.selected_count);
      console.log("Matched:", result?.matched_count);
      console.log("Unmatched:", result?.unmatched_count);
      console.log("Results:", result?.results);
      console.log("Custom results:", result?.custom_results);
      console.groupEnd();

      showMessage("Radiation Oncology Skill test completed.");
    } catch (error) {
      logError("Test Skill", url, error);
      showMessage(error.message || "Failed to test Skill.", "error");
    } finally {
      setTesting(false);
    }
  };

  const exportSkill = async () => {
    if (!doctorId) {
      showMessage("Doctor ID is required.", "error");
      return;
    }

    if (!patientId) {
      showMessage(
        "Patient ID is required to export the patient-specific selected results.",
        "error"
      );
      return;
    }

    const url =
      `${SKILL_BASE}/export?doctorId=` +
      encodeURIComponent(String(doctorId)) +
      `&patientId=` +
      encodeURIComponent(String(patientId));

    setExporting(true);

    try {
      logRequest("Export Skill", url);

      const response = await fetch(url);
      if (!response.ok) {
        const data = await parseResponse(response);
        await throwIfNotOk(response, data);
      }

      const blob = await response.blob();

      console.groupCollapsed("📤 [RADIATION SKILL] Export response");
      console.log("URL:", url);
      console.log("HTTP:", response.status);
      console.log("Blob size:", blob.size);
      console.log("Content-Type:", blob.type);
      console.groupEnd();

      const downloadUrl = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = downloadUrl;
      anchor.download = "radiation_oncology_skill.md";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();

      window.URL.revokeObjectURL(downloadUrl);

      showMessage("Skill export downloaded.");
    } catch (error) {
      logError("Export Skill", url, error);
      showMessage(error.message || "Failed to export Skill.", "error");
    } finally {
      setExporting(false);
    }
  };

  const renderStatus = (status, label) => {
    const meta = statusMeta(status);

    return (
      <Box
        sx={{
          display: "inline-flex",
          alignItems: "center",
          gap: 0.7,
          px: 1,
          py: 0.35,
          border: `1px solid ${meta.color}55`,
          background: meta.bg,
          color: meta.color,
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: "0.05em",
          whiteSpace: "nowrap",
        }}
      >
        <Box
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: meta.color,
          }}
        />
        {label || meta.label}
      </Box>
    );
  };

  const testGroups = useMemo(() => {
    const resultItems = safeArray(testResult?.results);
    const customItems = safeArray(testResult?.custom_results);

    const groups = new Map();

    resultItems.forEach((item) => {
      const moduleId = item.module_id || "other";
      if (!groups.has(moduleId)) {
        groups.set(moduleId, {
          module_id: moduleId,
          module_name:
            item.module_name || "Radiation Oncology Assessment",
          rows: [],
        });
      }
      groups.get(moduleId).rows.push(item);
    });

    if (customItems.length) {
      groups.set("custom", {
        module_id: "custom",
        module_name: "Doctor Added Checks",
        rows: customItems,
      });
    }

    return [...groups.values()];
  }, [testResult]);

  const selectedSet = useMemo(
    () => new Set(selectedIds),
    [selectedIds]
  );

  return (
    <>
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="xl"
        scroll="paper"
        sx={{
          "& .MuiDialog-container": {
            alignItems: "flex-start",
            paddingTop: "2vh",
          },
        }}
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
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 2,
            }}
          >
            <Box>
              <Typography
                sx={{
                  fontFamily: FONT,
                  fontSize: 10,
                  textTransform: "uppercase",
                  letterSpacing: "0.16em",
                  color: C.muted,
                  mb: 0.5,
                }}
              >
                Radiation Oncology
              </Typography>

              <Typography
                sx={{
                  fontFamily: FONT,
                  fontSize: 22,
                  fontWeight: 500,
                  color: C.black,
                }}
              >
                Intelligence Skill
              </Typography>

              <Typography
                sx={{
                  mt: 0.4,
                  fontFamily: FONT,
                  fontSize: 12,
                  color: C.muted,
                }}
              >
                Select the existing intelligence checks this doctor wants to
                use. The Skill filters existing radiation-agent results; it
                does not create new clinical calculations.
              </Typography>
            </Box>

            <IconButton onClick={onClose}>
              <Close />
            </IconButton>
          </Box>
        </DialogTitle>

        <DialogContent
          dividers
          sx={{
            p: 0,
            background: C.bg,
          }}
        >
          {loading ? (
            <Box
              sx={{
                minHeight: 420,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <CircularProgress size={28} />
            </Box>
          ) : (
            <Box sx={{ p: 2.5 }}>
              {/* Skill configuration header */}
              <Box
                sx={{
                  display: "grid",
                  gridTemplateColumns: {
                    xs: "1fr",
                    md: "1.6fr 1fr auto",
                  },
                  gap: 1.5,
                  alignItems: "end",
                  mb: 2,
                }}
              >
                <TextField
                  size="small"
                  label="Skill Name"
                  value={skillName}
                  onChange={(event) => setSkillName(event.target.value)}
                  fullWidth
                  sx={{
                    "& .MuiInputBase-root": {
                      fontFamily: FONT,
                      fontSize: 13,
                      borderRadius: 0,
                    },
                    "& .MuiInputLabel-root": {
                      fontFamily: FONT,
                      fontSize: 12,
                    },
                  }}
                />

                <Box
                  sx={{
                    border: `1px solid ${C.border}`,
                    background: C.white,
                    px: 1.5,
                    py: 1,
                    minHeight: 40,
                  }}
                >
                  <Typography
                    sx={{
                      fontFamily: FONT,
                      fontSize: 10,
                      color: C.muted,
                      textTransform: "uppercase",
                      letterSpacing: "0.08em",
                    }}
                  >
                    Selected checks
                  </Typography>
                  <Typography
                    sx={{
                      fontFamily: MONO,
                      fontSize: 16,
                      fontWeight: 500,
                    }}
                  >
                    {selectedCount}
                  </Typography>
                </Box>

                <Box
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1,
                    height: 40,
                    px: 1.5,
                    border: `1px solid ${
                      active ? C.ok : C.border
                    }`,
                    background: active ? C.okBg : C.white,
                  }}
                >
                  <Box
                    sx={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: active ? C.ok : C.neutral,
                    }}
                  />
                  <Typography
                    sx={{
                      fontFamily: FONT,
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.05em",
                      color: active ? C.ok : C.muted,
                    }}
                  >
                    {active ? "Active" : "Inactive"}
                  </Typography>
                </Box>
              </Box>

              {/* Search + actions */}
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  alignItems: "center",
                  flexWrap: "wrap",
                  mb: 2,
                }}
              >
                <TextField
                  size="small"
                  placeholder="Search radiation checks..."
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  InputProps={{
                    startAdornment: (
                      <Search
                        sx={{
                          fontSize: 18,
                          color: C.muted,
                          mr: 0.8,
                        }}
                      />
                    ),
                  }}
                  sx={{
                    flex: 1,
                    minWidth: 240,
                    "& .MuiInputBase-root": {
                      fontFamily: FONT,
                      fontSize: 12,
                      borderRadius: 0,
                      background: C.white,
                    },
                  }}
                />

                <Button
                  variant="outlined"
                  startIcon={<Add />}
                  onClick={() => setCustomOpen(true)}
                  sx={{
                    borderRadius: 0,
                    textTransform: "none",
                    fontFamily: FONT,
                    fontSize: 11.5,
                  }}
                >
                  Add custom check
                </Button>
              </Box>

              {/* Catalog */}
              <Box
                sx={{
                  border: `1px solid ${C.border}`,
                  background: C.white,
                }}
              >
                {filteredModules.map((module) => {
                  const parameters = safeArray(module.parameters);
                  const selectedInModule = parameters.filter((p) =>
                    selectedSet.has(p.id)
                  ).length;
                  const expanded =
                    expandedModules[module.module_id] !== false;

                  return (
                    <Box
                      key={module.module_id}
                      sx={{
                        borderBottom: `1px solid ${C.border}`,
                        "&:last-child": {
                          borderBottom: 0,
                        },
                      }}
                    >
                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          px: 1.5,
                          py: 1.2,
                          background: C.panel,
                          cursor: "pointer",
                        }}
                        onClick={() =>
                          toggleModule(module.module_id)
                        }
                      >
                        <IconButton
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleModule(module.module_id);
                          }}
                        >
                          {expanded ? (
                            <ExpandLess fontSize="small" />
                          ) : (
                            <ExpandMore fontSize="small" />
                          )}
                        </IconButton>

                        <Box sx={{ flex: 1 }}>
                          <Typography
                            sx={{
                              fontFamily: FONT,
                              fontSize: 12.5,
                              fontWeight: 600,
                            }}
                          >
                            {module.num || module.module_id} ·{" "}
                            {module.module_name}
                          </Typography>

                          <Typography
                            sx={{
                              fontFamily: FONT,
                              fontSize: 10.5,
                              color: C.muted,
                              mt: 0.25,
                            }}
                          >
                            {selectedInModule}/{parameters.length} selected
                          </Typography>
                        </Box>

                        <Button
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            selectModule(module);
                          }}
                          sx={{
                            textTransform: "none",
                            fontFamily: FONT,
                            fontSize: 10.5,
                            minWidth: 0,
                          }}
                        >
                          Select all
                        </Button>

                        <Button
                          size="small"
                          onClick={(event) => {
                            event.stopPropagation();
                            clearModule(module);
                          }}
                          sx={{
                            textTransform: "none",
                            fontFamily: FONT,
                            fontSize: 10.5,
                            minWidth: 0,
                            color: C.muted,
                          }}
                        >
                          Clear
                        </Button>
                      </Box>

                      <Collapse in={expanded}>
                        <Box>
                          {parameters.map((parameter) => {
                            const checked = selectedSet.has(
                              parameter.id
                            );

                            const displayName =
                              overrides?.[parameter.id]?.name ||
                              parameter.name ||
                              parameter.backend_parameter;

                            const description =
                              overrides?.[parameter.id]?.description ||
                              parameter.description ||
                              "";

                            return (
                              <Box
                                key={parameter.id}
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 1,
                                  px: 1.5,
                                  py: 0.8,
                                  borderTop: `1px solid ${C.border}`,
                                  background: checked
                                    ? "#fcfcfc"
                                    : C.white,
                                }}
                              >
                                <Checkbox
                                  size="small"
                                  checked={checked}
                                  onChange={() =>
                                    toggleParameter(parameter.id)
                                  }
                                />

                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                  <Typography
                                    sx={{
                                      fontFamily: FONT,
                                      fontSize: 12,
                                      fontWeight: checked
                                        ? 600
                                        : 400,
                                      color: C.text,
                                    }}
                                  >
                                    {displayName}
                                  </Typography>

                                  {description && (
                                    <Typography
                                      sx={{
                                        fontFamily: FONT,
                                        fontSize: 10.5,
                                        color: C.muted,
                                        mt: 0.15,
                                      }}
                                    >
                                      {description}
                                    </Typography>
                                  )}
                                </Box>

                                <Typography
                                  sx={{
                                    fontFamily: MONO,
                                    fontSize: 9,
                                    color: "#999999",
                                    display: {
                                      xs: "none",
                                      md: "block",
                                    },
                                  }}
                                >
                                  {parameter.id}
                                </Typography>

                                <IconButton
                                  size="small"
                                  onClick={() =>
                                    openEdit(parameter)
                                  }
                                  title="Edit check"
                                >
                                  <EditOutlined
                                    sx={{ fontSize: 16 }}
                                  />
                                </IconButton>
                              </Box>
                            );
                          })}
                        </Box>
                      </Collapse>
                    </Box>
                  );
                })}

                {filteredModules.length === 0 && (
                  <Box sx={{ p: 4, textAlign: "center" }}>
                    <Typography
                      sx={{
                        fontFamily: FONT,
                        fontSize: 12,
                        color: C.muted,
                      }}
                    >
                      No radiation checks match your search.
                    </Typography>
                  </Box>
                )}
              </Box>

              {/* Custom parameters */}
              {customParameters.length > 0 && (
                <Box
                  sx={{
                    mt: 2,
                    border: `1px solid ${C.border}`,
                    background: C.white,
                  }}
                >
                  <Box
                    sx={{
                      px: 1.5,
                      py: 1.2,
                      background: C.panel,
                    }}
                  >
                    <Typography
                      sx={{
                        fontFamily: FONT,
                        fontSize: 12.5,
                        fontWeight: 600,
                      }}
                    >
                      Doctor Added Checks
                    </Typography>
                    <Typography
                      sx={{
                        fontFamily: FONT,
                        fontSize: 10.5,
                        color: C.muted,
                      }}
                    >
                      Custom checks are manual-review items. They do not
                      generate automatic clinical results.
                    </Typography>
                  </Box>

                  {customParameters.map((item) => (
                    <Box
                      key={item.id}
                      sx={{
                        px: 1.5,
                        py: 1,
                        borderTop: `1px solid ${C.border}`,
                        display: "flex",
                        alignItems: "center",
                        gap: 1,
                      }}
                    >
                      <CheckCircleOutline
                        sx={{
                          fontSize: 17,
                          color: "#777777",
                        }}
                      />

                      <Box sx={{ flex: 1 }}>
                        <Typography
                          sx={{
                            fontFamily: FONT,
                            fontSize: 12,
                            fontWeight: 500,
                          }}
                        >
                          {item.name}
                        </Typography>
                        {item.description && (
                          <Typography
                            sx={{
                              fontFamily: FONT,
                              fontSize: 10.5,
                              color: C.muted,
                            }}
                          >
                            {item.description}
                          </Typography>
                        )}
                      </Box>

                      <Typography
                        sx={{
                          fontFamily: MONO,
                          fontSize: 9,
                          color: C.muted,
                        }}
                      >
                        {item.id}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}

              {/* Test output */}
              {testResult && (
                <Box sx={{ mt: 2 }}>
                  <Box
                    sx={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      mb: 1,
                    }}
                  >
                    <Box>
                      <Typography
                        sx={{
                          fontFamily: FONT,
                          fontSize: 14,
                          fontWeight: 600,
                        }}
                      >
                        Skill Test Results
                      </Typography>
                      <Typography
                        sx={{
                          fontFamily: FONT,
                          fontSize: 10.5,
                          color: C.muted,
                        }}
                      >
                        Existing Radiation Oncology Intelligence results,
                        filtered to this Skill.
                      </Typography>
                    </Box>

                    <Box sx={{ display: "flex", gap: 1 }}>
                      <Box
                        sx={{
                          px: 1,
                          py: 0.5,
                          border: `1px solid ${C.border}`,
                          fontFamily: MONO,
                          fontSize: 10,
                        }}
                      >
                        {testResult.matched_count || 0} matched
                      </Box>

                      <Box
                        sx={{
                          px: 1,
                          py: 0.5,
                          border: `1px solid ${C.border}`,
                          fontFamily: MONO,
                          fontSize: 10,
                        }}
                      >
                        {testResult.unmatched_count || 0} unmatched
                      </Box>
                    </Box>
                  </Box>

                  {testGroups.map((group) => (
                    <Box
                      key={group.module_id}
                      sx={{
                        mb: 1.5,
                        border: `1px solid ${C.border}`,
                        background: C.white,
                        overflowX: "auto",
                      }}
                    >
                      <Typography
                        sx={{
                          px: 1.5,
                          py: 1,
                          fontFamily: FONT,
                          fontSize: 12,
                          fontWeight: 600,
                          background: C.panel,
                          borderBottom: `1px solid ${C.border}`,
                        }}
                      >
                        {group.module_name}
                      </Typography>

                      <table
                        style={{
                          width: "100%",
                          minWidth: 850,
                          borderCollapse: "collapse",
                          fontFamily: FONT,
                          fontSize: 11.5,
                        }}
                      >
                        <thead>
                          <tr>
                            {[
                              "#",
                              "Parameter",
                              "Current Finding",
                              "Reference / Expected",
                              "Status",
                              "Indication / Action",
                            ].map((heading) => (
                              <th
                                key={heading}
                                style={{
                                  textAlign: "left",
                                  padding: "9px 10px",
                                  borderBottom: `1px solid ${C.border}`,
                                  background: "#f8f8f8",
                                  color: C.muted,
                                  fontSize: 9.5,
                                  letterSpacing: "0.06em",
                                  textTransform: "uppercase",
                                  whiteSpace: "nowrap",
                                }}
                              >
                                {heading}
                              </th>
                            ))}
                          </tr>
                        </thead>

                        <tbody>
                          {group.rows.map((row, index) => (
                            <tr key={row.parameter_id || index}>
                              <td
                                style={{
                                  padding: "9px 10px",
                                  borderBottom: `1px solid ${C.border}`,
                                  color: C.muted,
                                  width: 35,
                                }}
                              >
                                {index + 1}
                              </td>

                              <td
                                style={{
                                  padding: "9px 10px",
                                  borderBottom: `1px solid ${C.border}`,
                                  fontWeight: 600,
                                  minWidth: 170,
                                }}
                              >
                                {row.parameter}
                              </td>

                              <td
                                style={{
                                  padding: "9px 10px",
                                  borderBottom: `1px solid ${C.border}`,
                                  minWidth: 220,
                                  verticalAlign: "top",
                                }}
                              >
                                {row.current_finding || "—"}
                              </td>

                              <td
                                style={{
                                  padding: "9px 10px",
                                  borderBottom: `1px solid ${C.border}`,
                                  minWidth: 200,
                                  verticalAlign: "top",
                                }}
                              >
                                {row.reference_expected || "—"}
                              </td>

                              <td
                                style={{
                                  padding: "9px 10px",
                                  borderBottom: `1px solid ${C.border}`,
                                  verticalAlign: "top",
                                }}
                              >
                                {renderStatus(
                                  row.status,
                                  row.status_label
                                )}
                              </td>

                              <td
                                style={{
                                  padding: "9px 10px",
                                  borderBottom: `1px solid ${C.border}`,
                                  minWidth: 220,
                                  verticalAlign: "top",
                                }}
                              >
                                {row.indication_action || "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Box>
                  ))}

                  {testResult.unmatched_count > 0 && (
                    <Alert severity="warning" sx={{ mt: 1 }}>
                      {testResult.unmatched_count} selected check(s) did not
                      match a row in the existing Radiation Oncology
                      Intelligence output.
                    </Alert>
                  )}
                </Box>
              )}
            </Box>
          )}
        </DialogContent>

        <DialogActions
          sx={{
            px: 2.5,
            py: 1.5,
            borderTop: `1px solid ${C.border}`,
            background: C.white,
            gap: 1,
            flexWrap: "wrap",
          }}
        >
          <Button
            onClick={exportSkill}
            disabled={exporting || !patientId}
            startIcon={
              exporting ? (
                <CircularProgress size={15} />
              ) : (
                <FileDownloadOutlined />
              )
            }
            sx={{
              mr: "auto",
              borderRadius: 0,
              textTransform: "none",
              fontFamily: FONT,
              fontSize: 11.5,
            }}
          >
            {exporting ? "Exporting…" : "Export skill.md"}
          </Button>

          <Button
            onClick={() => testSkill(false)}
            disabled={testing || !patientId}
            startIcon={
              testing ? (
                <CircularProgress size={15} />
              ) : (
                <PlayArrow />
              )
            }
            variant="outlined"
            sx={{
              borderRadius: 0,
              textTransform: "none",
              fontFamily: FONT,
              fontSize: 11.5,
            }}
          >
            {testing ? "Testing…" : "Test Skill"}
          </Button>

          <Button
            onClick={toggleActivation}
            disabled={activating}
            startIcon={<PowerSettingsNew />}
            variant="outlined"
            sx={{
              borderRadius: 0,
              textTransform: "none",
              fontFamily: FONT,
              fontSize: 11.5,
              color: active ? C.alert : C.ok,
              borderColor: active ? `${C.alert}66` : `${C.ok}66`,
            }}
          >
            {activating
              ? "Updating…"
              : active
              ? "Deactivate"
              : "Activate"}
          </Button>

          <Button
            onClick={saveConfiguration}
            disabled={saving}
            startIcon={
              saving ? (
                <CircularProgress size={15} />
              ) : (
                <SaveOutlined />
              )
            }
            variant="contained"
            sx={{
              borderRadius: 0,
              textTransform: "none",
              fontFamily: FONT,
              fontSize: 11.5,
              background: C.black,
              "&:hover": {
                background: "#2b2b2b",
              },
            }}
          >
            {saving ? "Saving…" : "Save Skill"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Edit parameter */}
      <Dialog
        open={Boolean(editItem)}
        onClose={() => setEditItem(null)}
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: {
            borderRadius: 0,
          },
        }}
      >
        <DialogTitle
          sx={{
            fontFamily: FONT,
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          Edit Radiation Check
        </DialogTitle>

        <DialogContent dividers>
          <TextField
            fullWidth
            size="small"
            label="Display Name"
            value={editName}
            onChange={(event) => setEditName(event.target.value)}
            sx={{
              mb: 2,
              "& .MuiInputBase-root": {
                fontFamily: FONT,
                borderRadius: 0,
                fontSize: 13,
              },
            }}
          />

          <TextField
            fullWidth
            multiline
            minRows={3}
            size="small"
            label="Description"
            value={editDescription}
            onChange={(event) =>
              setEditDescription(event.target.value)
            }
            sx={{
              "& .MuiInputBase-root": {
                fontFamily: FONT,
                borderRadius: 0,
                fontSize: 13,
              },
            }}
          />
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setEditItem(null)}
            sx={{
              borderRadius: 0,
              textTransform: "none",
              fontFamily: FONT,
            }}
          >
            Cancel
          </Button>

          <Button
            onClick={saveParameterEdit}
            disabled={editing}
            variant="contained"
            sx={{
              borderRadius: 0,
              textTransform: "none",
              fontFamily: FONT,
              background: C.black,
            }}
          >
            {editing ? "Saving…" : "Save changes"}
          </Button>
        </DialogActions>
      </Dialog>

      {/* Add custom check */}
      <Dialog
        open={customOpen}
        onClose={() => setCustomOpen(false)}
        fullWidth
        maxWidth="sm"
        PaperProps={{
          sx: {
            borderRadius: 0,
          },
        }}
      >
        <DialogTitle
          sx={{
            fontFamily: FONT,
            fontSize: 16,
            fontWeight: 600,
          }}
        >
          Add Custom Radiation Check
        </DialogTitle>

        <DialogContent dividers>
          <Typography
            sx={{
              fontFamily: FONT,
              fontSize: 11,
              color: C.muted,
              mb: 2,
            }}
          >
            Custom checks are stored as manual-review items. They are not
            mapped to an existing agent result and will not invent a clinical
            finding.
          </Typography>

          <TextField
            fullWidth
            size="small"
            label="Check Name"
            value={customName}
            onChange={(event) =>
              setCustomName(event.target.value)
            }
            sx={{
              mb: 2,
              "& .MuiInputBase-root": {
                fontFamily: FONT,
                borderRadius: 0,
                fontSize: 13,
              },
            }}
          />

          <TextField
            fullWidth
            multiline
            minRows={3}
            size="small"
            label="Expected / Review Description"
            value={customDescription}
            onChange={(event) =>
              setCustomDescription(event.target.value)
            }
            sx={{
              "& .MuiInputBase-root": {
                fontFamily: FONT,
                borderRadius: 0,
                fontSize: 13,
              },
            }}
          />
        </DialogContent>

        <DialogActions>
          <Button
            onClick={() => setCustomOpen(false)}
            sx={{
              borderRadius: 0,
              textTransform: "none",
              fontFamily: FONT,
            }}
          >
            Cancel
          </Button>

          <Button
            onClick={addCustomParameter}
            variant="contained"
            startIcon={<Add />}
            sx={{
              borderRadius: 0,
              textTransform: "none",
              fontFamily: FONT,
              background: C.black,
            }}
          >
            Add check
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(message)}
        autoHideDuration={3500}
        onClose={() => setMessage("")}
        anchorOrigin={{
          vertical: "bottom",
          horizontal: "right",
        }}
      >
        <Alert
          severity={messageSeverity}
          onClose={() => setMessage("")}
          variant="filled"
        >
          {message}
        </Alert>
      </Snackbar>
    </>
  );
}
