import React, { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  Paper,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";

import {
  Add,
  CheckCircle,
  ExpandMore,
  ChevronRight,   
  Close,
  CloudDownload,
  Edit,
  PlayArrow,
  Refresh,
  Save,
  Search,
  ToggleOff,
  ToggleOn,
} from "@mui/icons-material";


// ============================================================
// API
// ============================================================

const API_BASE_URL =
  import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

const SKILL_BASE = `${API_BASE_URL.replace(/\/+$/, "")}/hms/users/ai-legacy/chemotherapy-intelligence/skills/chemotherapy`;

// ============================================================
// API DEBUG LOGGER
// ============================================================

function safeJsonParse(value) {
  if (!value) return null;
  try { return JSON.parse(value); } catch { return value; }
}

function logApiRequest(label, url, options = {}) {
  console.groupCollapsed(`🚀 [CHEMO SKILL → BACKEND] ${label}`);
  console.log("URL:", url);
  console.log("Method:", options.method || "GET");
  console.log("Headers:", options.headers || {});
  console.log("Payload:", safeJsonParse(options.body));
  console.groupEnd();
}

function logApiResponse(label, url, response, data) {
  console.groupCollapsed(`📥 [BACKEND → CHEMO SKILL] ${label}`);
  console.log("URL:", url);
  console.log("HTTP Status:", response.status);
  console.log("OK:", response.ok);
  console.log("Response:", data);
  console.groupEnd();
}

function logApiError(label, url, error) {
  console.groupCollapsed(`❌ [CHEMO SKILL API ERROR] ${label}`);
  console.log("URL:", url);
  console.error("Error:", error);
  console.groupEnd();
}

function logSkillState(label, state) {
  console.groupCollapsed(`🧠 [CHEMO SKILL STATE] ${label}`);
  Object.entries(state || {}).forEach(([key, value]) => console.log(`${key}:`, value));
  console.groupEnd();
}



// ============================================================
// THEME
// ============================================================

const theme = {
  bg: "#ffffff",
  bgPanel: "#fafafa",
  bgRaise: "#f5f5f5",
  line: "#e0e0e0",
  lineSoft: "#eeeeee",

  ink: "#171717",
  inkDim: "#3d3d3d",
  inkMute: "#777777",

  primary: "#37474f",
  primaryHover: "#263238",

  ok: "#2e7d32",
  okBg: "#e8f5e9",

  watch: "#b78103",
  watchBg: "#fff8e1",

  alert: "#c62828",
  alertBg: "#ffebee",

  flag: "#1565c0",
  flagBg: "#e3f2fd",

  custom: "#6a1b9a",
  customBg: "#f3e5f5",

  fontSans: '"Open Sans", sans-serif',
  fontMono: '"Space Mono", monospace'
};


// ============================================================
// HELPERS
// ============================================================

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function getApiData(response) {
  return response?.data ?? response;
}

function normalizeModules(catalog) {
  if (!catalog) return [];

  if (Array.isArray(catalog.modules)) {
    return catalog.modules;
  }

  if (Array.isArray(catalog.data?.modules)) {
    return catalog.data.modules;
  }

  if (Array.isArray(catalog.parameters)) {
    return [
      {
        module_id: "all",
        module_name: "Chemotherapy Checks",
        parameters: catalog.parameters,
      },
    ];
  }

  if (Array.isArray(catalog.data?.parameters)) {
    return [
      {
        module_id: "all",
        module_name: "Chemotherapy Checks",
        parameters: catalog.data.parameters,
      },
    ];
  }

  return [];
}

function normalizeParameters(module) {
  return safeArray(
    module?.parameters ||
      module?.checks ||
      module?.items ||
      module?.skill_parameters
  );
}

function flattenCatalog(catalog) {
  const modules = normalizeModules(catalog);

  const output = [];

  modules.forEach((module, moduleIndex) => {
    const moduleId =
      module?.module_id ??
      module?.id ??
      module?.moduleId ??
      String(moduleIndex + 1);

    const moduleName =
      module?.module_name ??
      module?.title ??
      module?.name ??
      `Module ${moduleIndex + 1}`;

    normalizeParameters(module).forEach((parameter) => {
      if (!parameter?.id) return;

      output.push({
        ...parameter,
        id: parameter.id,
        module_id: parameter.module_id ?? moduleId,
        module_name: parameter.module_name ?? moduleName,
      });
    });
  });

  return output;
}

function normalizeCatalog(catalog) {
  const modules = normalizeModules(catalog);

  return modules.map((module, index) => {
    const moduleId =
      module?.module_id ??
      module?.id ??
      module?.moduleId ??
      String(index + 1);

    const moduleName =
      module?.module_name ??
      module?.title ??
      module?.name ??
      `Module ${index + 1}`;

    return {
      ...module,
      module_id: moduleId,
      module_name: moduleName,
      parameters: normalizeParameters(module).map((parameter) => ({
        ...parameter,
        module_id: parameter.module_id ?? moduleId,
        module_name: parameter.module_name ?? moduleName,
      })),
    };
  });
}

function getParameterName(parameter, overrides) {
  return (
    overrides?.[parameter.id]?.name ||
    parameter?.name ||
    parameter?.parameter ||
    "Unnamed check"
  );
}

function getParameterDescription(parameter, overrides) {
  return (
    overrides?.[parameter.id]?.description ||
    parameter?.description ||
    ""
  );
}

function getStatusMeta(status) {
  const value = String(status || "neutral").toLowerCase();

  if (value === "ok" || value === "verified") {
    return {
      label: "Verified",
      color: theme.ok,
      background: theme.okBg,
    };
  }

  if (value === "watch") {
    return {
      label: "Watch",
      color: theme.watch,
      background: theme.watchBg,
    };
  }

  if (value === "flag") {
    return {
      label: "Flagged",
      color: theme.flag,
      background: theme.flagBg,
    };
  }

  if (value === "alert" || value === "stop") {
    return {
      label: value.toUpperCase(),
      color: theme.alert,
      background: theme.alertBg,
    };
  }

  return {
    label:
      value === "not_available"
        ? "Not available"
        : value === "not_applicable"
        ? "Not applicable"
        : "Neutral",
    color: theme.inkMute,
    background: theme.bgRaise,
  };
}


// ============================================================
// MAIN COMPONENT
// ============================================================

export default function ChemotherapySkillPanel({
  open,
  onClose,
  patientId,
  doctorId,
  treatmentId,
  cycleNum,
}) {
  // ----------------------------------------------------------
  // DATA
  // ----------------------------------------------------------

  const [catalog, setCatalog] = useState([]);
  const [allParameters, setAllParameters] = useState([]);

  const [enabledParameters, setEnabledParameters] = useState([]);

  const [parameterOverrides, setParameterOverrides] = useState({});

  const [customParameters, setCustomParameters] = useState([]);

  const [skillName, setSkillName] = useState(
    "My Chemotherapy Skill"
  );

  const [active, setActive] = useState(false);

  const [version, setVersion] = useState(1);

  // ----------------------------------------------------------
  // UI
  // ----------------------------------------------------------

  const [searchText, setSearchText] = useState("");

  const [expandedModules, setExpandedModules] = useState({});

  const [loading, setLoading] = useState(false);

  const [saving, setSaving] = useState(false);

  const [testing, setTesting] = useState(false);

  const [activating, setActivating] = useState(false);

  const [error, setError] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  const [testResults, setTestResults] = useState(null);

  // ----------------------------------------------------------
  // EDIT DIALOG
  // ----------------------------------------------------------

  const [editDialogOpen, setEditDialogOpen] = useState(false);

  const [editingParameter, setEditingParameter] = useState(null);

  const [editName, setEditName] = useState("");

  const [editDescription, setEditDescription] = useState("");

  const [editSaving, setEditSaving] = useState(false);

  // ----------------------------------------------------------
  // CUSTOM PARAMETER DIALOG
  // ----------------------------------------------------------

  const [customDialogOpen, setCustomDialogOpen] = useState(false);

  const [customName, setCustomName] = useState("");

  const [customDescription, setCustomDescription] = useState("");

  const [customSaving, setCustomSaving] = useState(false);


  // ==========================================================
  // FETCH CATALOG + CONFIGURATION
  // ==========================================================

  useEffect(() => {
    if (!open || !doctorId) return;

    loadSkill();
  }, [open, doctorId]);


  async function loadSkill() {
    setLoading(true); setError(""); setSuccessMessage("");
    const catalogUrl = `${SKILL_BASE}/catalog`;
    const configurationUrl = `${SKILL_BASE}/configuration?doctorId=${encodeURIComponent(doctorId)}`;
    try {
      console.log("==========================================================");
      console.log("🧪 CHEMOTHERAPY SKILL - LOAD START");
      logApiRequest("LOAD CATALOG", catalogUrl);
      logApiRequest("LOAD CONFIGURATION", configurationUrl);
      const [catalogResponse, configurationResponse] = await Promise.all([fetch(catalogUrl), fetch(configurationUrl)]);
      const catalogJson = await catalogResponse.json();
      const configurationJson = await configurationResponse.json();
      logApiResponse("LOAD CATALOG", catalogUrl, catalogResponse, catalogJson);
      logApiResponse("LOAD CONFIGURATION", configurationUrl, configurationResponse, configurationJson);
      if (!catalogResponse.ok) throw new Error("Failed to load chemotherapy Skill catalog.");
      if (!configurationResponse.ok) throw new Error("Failed to load doctor Skill configuration.");
      const catalogData = getApiData(catalogJson);
      const configurationData = getApiData(configurationJson);
      const normalizedModules = normalizeCatalog(catalogData);
      const flattened = flattenCatalog(catalogData);
      console.log("📦 Catalog data:", catalogData);
      console.log("⚙️ Configuration data:", configurationData);
      console.log("📚 Normalized modules:", normalizedModules);
      console.log("📋 Flattened parameters:", flattened);
      setCatalog(normalizedModules); setAllParameters(flattened);
      setEnabledParameters(safeArray(configurationData?.enabled_parameters));
      setParameterOverrides(configurationData?.parameter_overrides || {});
      setCustomParameters(safeArray(configurationData?.custom_parameters));
      setSkillName(configurationData?.skill_name || "My Chemotherapy Skill");
      setActive(Boolean(configurationData?.active)); setVersion(configurationData?.version || 1);
      const initialExpanded = {}; normalizedModules.forEach((module) => { initialExpanded[module.module_id] = true; });
      setExpandedModules(initialExpanded); setTestResults(null);
    } catch (err) {
      logApiError("LOAD SKILL", SKILL_BASE, err);
      console.error("Chemotherapy Skill load error:", err);
      setError(err?.message || "Unable to load Chemotherapy Skill.");
    } finally { setLoading(false); }
  }


  // ==========================================================
  // COUNTS
  // ==========================================================

  const selectedCount = enabledParameters.length;

  const totalCount = allParameters.length;

  const customCount = customParameters.length;


  // ==========================================================
  // SEARCH
  // ==========================================================

  const normalizedSearch =
    searchText.trim().toLowerCase();

  const filteredCatalog = useMemo(() => {
    if (!normalizedSearch) {
      return catalog;
    }

    return catalog
      .map((module) => {
        const filteredParameters =
          safeArray(module.parameters).filter(
            (parameter) => {
              const name = getParameterName(
                parameter,
                parameterOverrides
              ).toLowerCase();

              const description =
                getParameterDescription(
                  parameter,
                  parameterOverrides
                ).toLowerCase();

              const backendParameter = String(
                parameter.backend_parameter || ""
              ).toLowerCase();

              return (
                name.includes(normalizedSearch) ||
                description.includes(
                  normalizedSearch
                ) ||
                backendParameter.includes(
                  normalizedSearch
                ) ||
                String(
                  parameter.id
                )
                  .toLowerCase()
                  .includes(normalizedSearch)
              );
            }
          );

        return {
          ...module,
          parameters: filteredParameters,
        };
      })
      .filter(
        (module) =>
          safeArray(module.parameters).length > 0
      );
  }, [
    catalog,
    normalizedSearch,
    parameterOverrides,
  ]);


  // ==========================================================
  // TOGGLE PARAMETER
  // ==========================================================

  function toggleParameter(parameterId) {
    setEnabledParameters((previous) => {
      if (previous.includes(parameterId)) {
        return previous.filter(
          (id) => id !== parameterId
        );
      }

      return [
        ...previous,
        parameterId,
      ];
    });
  }


  // ==========================================================
  // MODULE SELECT / CLEAR
  // ==========================================================

  function toggleModule(module) {
    const ids = safeArray(module.parameters)
      .map((parameter) => parameter.id)
      .filter(Boolean);

    const allSelected = ids.every((id) =>
      enabledParameters.includes(id)
    );

    setEnabledParameters((previous) => {
      if (allSelected) {
        return previous.filter(
          (id) => !ids.includes(id)
        );
      }

      const next = [...previous];

      ids.forEach((id) => {
        if (!next.includes(id)) {
          next.push(id);
        }
      });

      return next;
    });
  }


  function selectAll() {
    const ids = allParameters.map((parameter) => parameter.id);
    console.log("☑️ SELECT ALL parameters:", ids);
    setEnabledParameters(ids);
  }


  function clearAll() {
    console.log("☐ CLEAR ALL parameters");
    setEnabledParameters([]);
  }


  // ==========================================================
  // EXPAND / COLLAPSE
  // ==========================================================

  function toggleModuleExpanded(moduleId) {
    setExpandedModules((previous) => ({
      ...previous,
      [moduleId]: !previous[moduleId],
    }));
  }


  // ==========================================================
  // SAVE
  // ==========================================================

  async function saveConfiguration() {
    if (!doctorId) { setError("Doctor ID is required."); return; }
    setSaving(true); setError(""); setSuccessMessage("");
    const url = `${SKILL_BASE}/configuration`;
    const payload = { doctor_id: String(doctorId), skill_name: skillName, enabled_parameters: enabledParameters, parameter_overrides: parameterOverrides, custom_parameters: customParameters, active };
    try {
      logSkillState("BEFORE SAVE", { doctorId, skillName, enabledParameters, parameterOverrides, customParameters, active, version });
      logApiRequest("SAVE CONFIGURATION", url, { method:"PUT", headers:{"Content-Type":"application/json"}, body:JSON.stringify(payload) });
      const response = await fetch(url,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const json = await response.json();
      logApiResponse("SAVE CONFIGURATION", url, response, json);
      if (!response.ok || json?.success === false) {
        const detail=json?.detail; let message="Failed to save Chemotherapy Skill configuration.";
        if(typeof detail==="string") message=detail; else if(Array.isArray(detail)) message=detail.map(x=>`${x?.loc?.join(" → ")||"request"}: ${x?.msg||"Invalid value"}`).join("\n"); else if(detail&&typeof detail==="object") message=JSON.stringify(detail,null,2);
        throw new Error(message);
      }
      const saved=getApiData(json); console.log("💾 Saved configuration:",saved); if(saved?.version) setVersion(saved.version);
      setSuccessMessage("Chemotherapy Skill configuration saved successfully.");
    } catch(err){ logApiError("SAVE CONFIGURATION",url,err); console.error("Chemotherapy Skill save error:",err); setError(err?.message||"Failed to save Skill configuration."); }
    finally{setSaving(false);}
  }


  // ==========================================================
  // EDIT PARAMETER
  // ==========================================================

  function openEditDialog(parameter) {
    setEditingParameter(parameter);

    setEditName(
      getParameterName(
        parameter,
        parameterOverrides
      )
    );

    setEditDescription(
      getParameterDescription(
        parameter,
        parameterOverrides
      )
    );

    setEditDialogOpen(true);
  }


  function closeEditDialog() {
    if (editSaving) return;

    setEditDialogOpen(false);
    setEditingParameter(null);
    setEditName("");
    setEditDescription("");
  }


  async function saveParameterEdit() {
    if (!editingParameter?.id || !doctorId) return;
    if (!editName.trim()) { setError("Parameter name cannot be empty."); return; }
    setEditSaving(true); setError("");
    const url=`${SKILL_BASE}/parameters/${encodeURIComponent(editingParameter.id)}`;
    const payload={doctor_id:String(doctorId),parameter_id:editingParameter.id,name:editName.trim(),description:editDescription.trim()};
    try {
      logApiRequest("EDIT PARAMETER",url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const response=await fetch(url,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const json=await response.json(); logApiResponse("EDIT PARAMETER",url,response,json);
      if(!response.ok||json?.success===false) throw new Error(typeof json?.detail==="string"?json.detail:JSON.stringify(json?.detail||json,null,2));
      console.log("✏️ Updated parameter:",getApiData(json));
      setParameterOverrides(previous=>({...previous,[editingParameter.id]:{...(previous[editingParameter.id]||{}),name:editName.trim(),description:editDescription.trim()}}));
      setSuccessMessage("Parameter updated successfully."); closeEditDialog();
    } catch(err){logApiError("EDIT PARAMETER",url,err);console.error("Parameter edit error:",err);setError(err?.message||"Failed to update parameter.");}
    finally{setEditSaving(false);}
  }


  // ==========================================================
  // CUSTOM PARAMETER
  // ==========================================================

  function openCustomDialog() {
    setCustomName("");
    setCustomDescription("");
    setCustomDialogOpen(true);
  }


  function closeCustomDialog() {
    if (customSaving) return;

    setCustomDialogOpen(false);
    setCustomName("");
    setCustomDescription("");
  }


  async function addCustomParameter() {
    if(!doctorId){setError("Doctor ID is required.");return;}
    if(!customName.trim()){setError("Custom check name is required.");return;}
    if(!customDescription.trim()){setError("Custom check description is required.");return;}
    setCustomSaving(true);setError("");
    const url=`${SKILL_BASE}/parameters/custom`;
    const payload={doctor_id:String(doctorId),name:customName.trim(),description:customDescription.trim()};
    try{
      logApiRequest("ADD CUSTOM PARAMETER",url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const json=await response.json();logApiResponse("ADD CUSTOM PARAMETER",url,response,json);
      if(!response.ok||json?.success===false) throw new Error(typeof json?.detail==="string"?json.detail:JSON.stringify(json?.detail||json,null,2));
      const created=getApiData(json);console.log("➕ Created custom parameter:",created);if(created)setCustomParameters(previous=>[...previous,created]);
      setSuccessMessage("Custom checking point added.");closeCustomDialog();
    }catch(err){logApiError("ADD CUSTOM PARAMETER",url,err);console.error("Custom parameter error:",err);setError(err?.message||"Failed to add custom parameter.");}
    finally{setCustomSaving(false);}
  }


  // ==========================================================
  // REMOVE CUSTOM PARAMETER
  // ==========================================================

  function removeCustomParameter(customId) {
    setCustomParameters((previous) =>
      previous.filter(
        (item) => item.id !== customId
      )
    );

    setSuccessMessage(
      "Custom checking point removed. Click Save to persist the change."
    );
  }


  // ==========================================================
  // ACTIVATE / DEACTIVATE
  // ==========================================================

  async function toggleActivation() {
    if(!doctorId){setError("Doctor ID is required.");return;}
    setActivating(true);setError("");setSuccessMessage("");
    const nextActive=!active;const url=`${SKILL_BASE}/activation`;const payload={doctor_id:String(doctorId),active:nextActive};
    try{
      logApiRequest(nextActive?"ACTIVATE SKILL":"DEACTIVATE SKILL",url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});const json=await response.json();
      logApiResponse(nextActive?"ACTIVATE SKILL":"DEACTIVATE SKILL",url,response,json);
      if(!response.ok||json?.success===false) throw new Error(typeof json?.detail==="string"?json.detail:JSON.stringify(json?.detail||json,null,2));
      console.log("🔘 Activation result:",getApiData(json));setActive(nextActive);setSuccessMessage(nextActive?"Chemotherapy Skill activated.":"Chemotherapy Skill deactivated.");
    }catch(err){logApiError(nextActive?"ACTIVATE SKILL":"DEACTIVATE SKILL",url,err);console.error("Skill activation error:",err);setError(err?.message||"Failed to change Skill activation.");}
    finally{setActivating(false);}
  }


  // ==========================================================
  // TEST SKILL
  // ==========================================================

  async function testSkill(forceRegenerate = false) {
    if(!doctorId){setError("Doctor ID is required.");return;}
    if(!patientId){setError("Patient ID is required to test the Skill.");return;}
    if(enabledParameters.length===0){setError("Select at least one predefined check before testing.");return;}
    setTesting(true);setError("");setSuccessMessage("");
    const url=`${SKILL_BASE}/test`;
    const payload={doctor_id:String(doctorId),patient_id:String(patientId),treatment_id:treatmentId!==undefined&&treatmentId!==null&&treatmentId!==""?String(treatmentId):null,cycle_num:cycleNum!==undefined&&cycleNum!==null&&cycleNum!==""?String(cycleNum):null,force_regenerate:Boolean(forceRegenerate)};
    try{
      console.log("==========================================================");console.log("🧪 CHEMOTHERAPY SKILL TEST");console.log("==========================================================");
      logSkillState("TEST INPUT / FRONTEND STATE",{doctorId,patientId,treatmentId,cycleNum,forceRegenerate,skillName,enabledParameters,parameterOverrides,customParameters,active,version});
      logApiRequest("TEST CHEMOTHERAPY SKILL",url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      console.log("📤 Exact JSON sent:",JSON.stringify(payload,null,2));
      const started=performance.now();const response=await fetch(url,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      console.log(`⏱️ Backend request duration: ${Math.round(performance.now()-started)} ms`);
      const responseText=await response.text();let json;try{json=responseText?JSON.parse(responseText):null;}catch{json=responseText;}
      logApiResponse("TEST CHEMOTHERAPY SKILL",url,response,json);console.log("📥 Exact raw backend response:",responseText);
      if(!response.ok||json?.success===false){
        const detail=json?.detail;let message="Failed to test Chemotherapy Skill.";
        if(typeof detail==="string")message=detail;else if(Array.isArray(detail))message=detail.map(x=>`${x?.loc?.join(" → ")||"request"}: ${x?.msg||"Invalid value"}`).join("\n");else if(detail&&typeof detail==="object")message=JSON.stringify(detail,null,2);else if(json&&typeof json==="object")message=JSON.stringify(json,null,2);
        throw new Error(message);
      }
      const result=getApiData(json);
      console.log("==========================================================");console.log("✅ CHEMOTHERAPY SKILL TEST RESULT");console.log("==========================================================");
      console.log("📦 Complete parsed result:",result);console.log("📋 Results:",result?.results);console.log("🎯 Selected count:",result?.selected_count);console.log("✅ Matched count:",result?.matched_count);console.log("⚠️ Unmatched count:",result?.unmatched_count);console.log("❓ Unmatched IDs:",result?.unmatched_parameter_ids);
      if(Array.isArray(result?.results)){console.groupCollapsed(`📊 Backend Skill Results (${result.results.length})`);result.results.forEach((item,i)=>console.log(`Result ${i+1}:`,item));console.groupEnd();}
      if(result?.chemotherapy_report){console.groupCollapsed("🧬 COMPLETE CHEMOTHERAPY BACKEND REPORT");console.log(result.chemotherapy_report);console.groupEnd();}
      setTestResults(result);setSuccessMessage("Skill test completed using the chemotherapy backend output.");
    }catch(err){logApiError("TEST CHEMOTHERAPY SKILL",url,err);console.error("Skill test error:",err);setError(err?.message||"Failed to test Chemotherapy Skill.");}
    finally{setTesting(false);}
  }


  // ==========================================================
  // EXPORT skill.md
  // ==========================================================

  async function exportSkill() {
    if(!doctorId){setError("Doctor ID is required.");return;}
    if(!patientId){setError("Patient ID is required to export the Skill.");return;}
    setError("");
    const exportUrl=`${SKILL_BASE}/export?doctorId=${encodeURIComponent(doctorId)}&patientId=${encodeURIComponent(patientId)}&treatmentId=${encodeURIComponent(treatmentId||"")}&cycleNum=${encodeURIComponent(cycleNum||"")}`;
    try{
      logSkillState("EXPORT INPUT",{doctorId,patientId,treatmentId,cycleNum,enabledParameters,customParameters});
      logApiRequest("EXPORT SKILL.MD",exportUrl);
      const response=await fetch(exportUrl);
      if(!response.ok){const errorText=await response.text();let errorJson;try{errorJson=errorText?JSON.parse(errorText):null;}catch{errorJson=errorText;}logApiResponse("EXPORT SKILL.MD ERROR",exportUrl,response,errorJson);throw new Error(typeof errorJson?.detail==="string"?errorJson.detail:JSON.stringify(errorJson||"Failed to export skill.md.",null,2));}
      const blob=await response.blob();console.log("📄 Export blob:",blob);console.log("📄 Export size:",blob.size,"bytes");console.log("📄 Export type:",blob.type);logApiResponse("EXPORT SKILL.MD",exportUrl,response,{type:blob.type,size:blob.size});
      const url=window.URL.createObjectURL(blob);const anchor=document.createElement("a");anchor.href=url;anchor.download="skill.md";document.body.appendChild(anchor);anchor.click();anchor.remove();window.URL.revokeObjectURL(url);setSuccessMessage("skill.md exported successfully.");
    }catch(err){logApiError("EXPORT SKILL.MD",exportUrl,err);console.error("Skill export error:",err);setError(err?.message||"Failed to export skill.md.");}
  }


  // ==========================================================
  // MODULE COUNTS
  // ==========================================================

  function getModuleSelectedCount(module) {
    return safeArray(module.parameters).filter(
      (parameter) =>
        enabledParameters.includes(
          parameter.id
        )
    ).length;
  }


  // ==========================================================
  // RENDER PARAMETER
  // ==========================================================

  function renderParameter(parameter) {
    const selected =
      enabledParameters.includes(
        parameter.id
      );

    const displayName =
      getParameterName(
        parameter,
        parameterOverrides
      );

    const description =
      getParameterDescription(
        parameter,
        parameterOverrides
      );

    return (
      <Box
        key={parameter.id}
        sx={{
          display: "flex",
          alignItems: "flex-start",
          gap: 1,
          px: 1.5,
          py: 1.1,
          borderBottom:
            `1px solid ${theme.lineSoft}`,
          backgroundColor: selected
            ? "#f8fbfc"
            : "#ffffff",
          transition:
            "background-color 0.15s ease",
          "&:hover": {
            backgroundColor: "#f5f7f8",
          },
        }}
      >
        <Checkbox
          checked={selected}
          onChange={() =>
            toggleParameter(parameter.id)
          }
          size="small"
          sx={{
            mt: -0.35,
            color: theme.primary,
            "&.Mui-checked": {
              color: theme.primary,
            },
          }}
        />

        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
            sx={{ mb: 0.2 }}
          >
            <Typography
              sx={{
                fontFamily: theme.fontSans,
                fontSize: 13,
                fontWeight: 600,
                color: theme.ink,
              }}
            >
              {displayName}
            </Typography>

            {parameter.id && (
              <Typography
                sx={{
                  fontFamily: theme.fontMono,
                  fontSize: 9,
                  color: theme.inkMute,
                }}
              >
                {parameter.id}
              </Typography>
            )}
          </Stack>

          {description && (
            <Typography
              sx={{
                fontFamily: theme.fontSans,
                fontSize: 11,
                lineHeight: 1.5,
                color: theme.inkMute,
              }}
            >
              {description}
            </Typography>
          )}
        </Box>

        <Tooltip title="Edit this check">
          <IconButton
            size="small"
            onClick={() =>
              openEditDialog(parameter)
            }
            sx={{
              color: theme.inkMute,
              "&:hover": {
                color: theme.primary,
                backgroundColor:
                  theme.bgRaise,
              },
            }}
          >
            <Edit sx={{ fontSize: 17 }} />
          </IconButton>
        </Tooltip>
      </Box>
    );
  }


  // ==========================================================
  // RENDER TEST RESULT
  // ==========================================================

  function renderTestResults() {
    if (!testResults) return null;

    const results =
      safeArray(testResults.results);

    const unmatched =
      safeArray(
        testResults.unmatched_parameter_ids
      );

    return (
      <Paper
        elevation={0}
        sx={{
          mt: 2,
          border:
            `1px solid ${theme.line}`,
          borderRadius: 2,
          overflow: "hidden",
          backgroundColor: "#ffffff",
        }}
      >
        <Box
          sx={{
            px: 2,
            py: 1.4,
            backgroundColor: theme.bgPanel,
            borderBottom:
              `1px solid ${theme.line}`,
          }}
        >
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Box>
              <Typography
                sx={{
                  fontFamily: theme.fontSans,
                  fontSize: 14,
                  fontWeight: 700,
                  color: theme.ink,
                }}
              >
                Skill Test Results
              </Typography>

              <Typography
                sx={{
                  mt: 0.25,
                  fontFamily: theme.fontSans,
                  fontSize: 11,
                  color: theme.inkMute,
                }}
              >
                Actual results returned by the
                existing chemotherapy backend
              </Typography>
            </Box>

            <Stack
              direction="row"
              spacing={0.7}
            >
              <Chip
                size="small"
                label={`${testResults.selected_count || 0} selected`}
              />

              <Chip
                size="small"
                label={`${testResults.matched_count || 0} matched`}
                sx={{
                  backgroundColor:
                    theme.okBg,
                  color: theme.ok,
                }}
              />

              {testResults.unmatched_count > 0 && (
                <Chip
                  size="small"
                  label={`${testResults.unmatched_count} unmatched`}
                  sx={{
                    backgroundColor:
                      theme.watchBg,
                    color: theme.watch,
                  }}
                />
              )}
            </Stack>
          </Stack>
        </Box>

        {results.length === 0 ? (
          <Box sx={{ p: 2 }}>
            <Alert severity="info">
              No matching backend results were
              returned for the selected checks.
            </Alert>
          </Box>
        ) : (
          <Box>
            {results.map(
              (result, index) => {
                const status =
                  getStatusMeta(
                    result.status
                  );

                return (
                  <Box
                    key={
                      `${result.parameter_id}-${index}`
                    }
                    sx={{
                      px: 2,
                      py: 1.5,
                      borderBottom:
                        index <
                        results.length - 1
                          ? `1px solid ${theme.lineSoft}`
                          : "none",
                    }}
                  >
                    <Stack
                      direction="row"
                      justifyContent="space-between"
                      alignItems="flex-start"
                      spacing={2}
                    >
                      <Box sx={{ flex: 1 }}>
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          sx={{ mb: 0.4 }}
                        >
                          <Typography
                            sx={{
                              fontFamily:
                                theme.fontSans,
                              fontSize: 13,
                              fontWeight: 700,
                              color:
                                theme.ink,
                            }}
                          >
                            {result.parameter}
                          </Typography>

                          <Chip
                            size="small"
                            label={
                              status.label
                            }
                            sx={{
                              height: 22,
                              fontSize: 10,
                              fontWeight: 700,
                              color:
                                status.color,
                              backgroundColor:
                                status.background,
                            }}
                          />
                        </Stack>

                        <Typography
                          sx={{
                            fontFamily:
                              theme.fontSans,
                            fontSize: 10,
                            color:
                              theme.inkMute,
                            mb: 0.9,
                          }}
                        >
                          {result.module_name ||
                            "Chemotherapy"}
                        </Typography>

                        <ResultField
                          label="Current finding"
                          value={
                            result.current_finding
                          }
                        />

                        <ResultField
                          label="Reference / expected"
                          value={
                            result.reference_expected
                          }
                        />

                        <ResultField
                          label="Indication / action"
                          value={
                            result.indication_action
                          }
                        />
                      </Box>
                    </Stack>
                  </Box>
                );
              }
            )}
          </Box>
        )}

        {unmatched.length > 0 && (
          <Box
            sx={{
              px: 2,
              py: 1.4,
              backgroundColor:
                theme.watchBg,
              borderTop:
                `1px solid ${theme.line}`,
            }}
          >
            <Typography
              sx={{
                fontFamily: theme.fontSans,
                fontSize: 11,
                fontWeight: 700,
                color: theme.watch,
              }}
            >
              Backend results not found for:
            </Typography>

            <Typography
              sx={{
                mt: 0.4,
                fontFamily: theme.fontMono,
                fontSize: 10,
                color: theme.inkDim,
              }}
            >
              {unmatched.join(", ")}
            </Typography>
          </Box>
        )}
      </Paper>
    );
  }


  // ==========================================================
  // NO DOCTOR
  // ==========================================================

  if (!doctorId) {
    return (
      <Dialog
        open={open}
        onClose={onClose}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>
          Chemotherapy Skill
        </DialogTitle>

        <DialogContent>
          <Alert severity="warning">
            Doctor ID is required to configure
            the Chemotherapy Skill.
          </Alert>
        </DialogContent>

        <DialogActions>
          <Button onClick={onClose}>
            Close
          </Button>
        </DialogActions>
      </Dialog>
    );
  }


  // ==========================================================
  // MAIN DIALOG
  // ==========================================================

  return (
    <>
      <Dialog
  open={open}
  onClose={
    saving ||
    testing ||
    activating
      ? undefined
      : onClose
  }
  fullWidth
  maxWidth="xl"
  sx={{
    "& .MuiDialog-container": {
      alignItems: "flex-start",
      paddingTop: "2vh",
    },
  }}
  PaperProps={{
    sx: {
      height: "94vh",
      maxHeight: "94vh",
      borderRadius: 2,
      overflow: "hidden",
      backgroundColor: theme.bg,
    },
  }}
>
        {/* ================================================== */}
        {/* HEADER */}
        {/* ================================================== */}

        <DialogTitle
          sx={{
            p: 0,
            borderBottom:
              `1px solid ${theme.line}`,
          }}
        >
          <Box
            sx={{
              px: 2.5,
              py: 1.7,
            }}
          >
            <Stack
              direction="row"
              alignItems="center"
              justifyContent="space-between"
              spacing={2}
            >
              <Box>
                <Typography
                  sx={{
                    fontFamily:
                      theme.fontSans,
                    fontSize: 18,
                    fontWeight: 700,
                    color: theme.ink,
                  }}
                >
                  Chemotherapy Skill
                </Typography>

                <Typography
                  sx={{
                    mt: 0.25,
                    fontFamily:
                      theme.fontSans,
                    fontSize: 11,
                    color: theme.inkMute,
                  }}
                >
                  Configure the chemotherapy
                  checks used by this doctor
                </Typography>
              </Box>

              <IconButton
                onClick={onClose}
                disabled={
                  saving ||
                  testing ||
                  activating
                }
              >
                <Close />
              </IconButton>
            </Stack>

            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              sx={{ mt: 1.5 }}
            >
              <TextField
                value={skillName}
                onChange={(event) =>
                  setSkillName(
                    event.target.value
                  )
                }
                size="small"
                label="Skill Name"
                sx={{
                  width: 360,
                  "& .MuiInputBase-root": {
                    fontSize: 13,
                  },
                }}
              />

              <Chip
                label={`${selectedCount} / ${totalCount} selected`}
                sx={{
                  fontWeight: 700,
                  backgroundColor:
                    selectedCount > 0
                      ? theme.flagBg
                      : theme.bgRaise,
                  color:
                    selectedCount > 0
                      ? theme.flag
                      : theme.inkMute,
                }}
              />

              {customCount > 0 && (
                <Chip
                  label={`${customCount} custom`}
                  sx={{
                    fontWeight: 700,
                    backgroundColor:
                      theme.customBg,
                    color: theme.custom,
                  }}
                />
              )}

              <Chip
                label={`v${version}`}
                size="small"
                variant="outlined"
              />

              <Chip
                icon={
                  active ? (
                    <ToggleOn />
                  ) : (
                    <ToggleOff />
                  )
                }
                label={
                  active
                    ? "Active"
                    : "Inactive"
                }
                sx={{
                  fontWeight: 700,
                  color: active
                    ? theme.ok
                    : theme.inkMute,
                  backgroundColor:
                    active
                      ? theme.okBg
                      : theme.bgRaise,
                }}
              />
            </Stack>
          </Box>
        </DialogTitle>


        {/* ================================================== */}
        {/* TOOLBAR */}
        {/* ================================================== */}

        <Box
          sx={{
            px: 2.5,
            py: 1.2,
            borderBottom:
              `1px solid ${theme.line}`,
            backgroundColor:
              theme.bgPanel,
          }}
        >
          <Stack
            direction="row"
            spacing={1}
            alignItems="center"
          >
            <TextField
              value={searchText}
              onChange={(event) =>
                setSearchText(
                  event.target.value
                )
              }
              size="small"
              placeholder="Search checks..."
              InputProps={{
                startAdornment: (
                  <Search
                    sx={{
                      mr: 0.7,
                      color:
                        theme.inkMute,
                      fontSize: 19,
                    }}
                  />
                ),
              }}
              sx={{
                flex: 1,
                maxWidth: 520,
                "& .MuiInputBase-root": {
                  fontSize: 12,
                  backgroundColor:
                    "#ffffff",
                },
              }}
            />

            <Button
              size="small"
              variant="outlined"
              onClick={selectAll}
              disabled={
                loading ||
                allParameters.length === 0
              }
              sx={{
                textTransform: "none",
                fontSize: 11,
              }}
            >
              Select All
            </Button>

            <Button
              size="small"
              variant="outlined"
              onClick={clearAll}
              disabled={
                loading ||
                selectedCount === 0
              }
              sx={{
                textTransform: "none",
                fontSize: 11,
              }}
            >
              Clear All
            </Button>

            <Button
              size="small"
              variant="outlined"
              startIcon={<Add />}
              onClick={openCustomDialog}
              sx={{
                textTransform: "none",
                fontSize: 11,
              }}
            >
              Add Custom Check
            </Button>

            <Box sx={{ flex: 1 }} />

            <Tooltip title="Reload catalog and configuration">
                <span>
                    <IconButton
                    size="small"
                    onClick={loadSkill}
                    disabled={loading}
                    >
                    {loading ? (
                        <CircularProgress size={17} />
                    ) : (
                        <Refresh sx={{ fontSize: 18 }} />
                    )}
                    </IconButton>
                </span>
                </Tooltip>
          </Stack>
        </Box>


        {/* ================================================== */}
        {/* ALERTS */}
        {/* ================================================== */}

        {(error || successMessage) && (
          <Box sx={{ px: 2.5, pt: 1.2 }}>
            {error && (
              <Alert
                severity="error"
                onClose={() =>
                  setError("")
                }
                sx={{
                  mb: successMessage
                    ? 0.8
                    : 0,
                  fontSize: 12,
                }}
              >
                {error}
              </Alert>
            )}

            {successMessage && (
              <Alert
                severity="success"
                onClose={() =>
                  setSuccessMessage("")
                }
                sx={{
                  fontSize: 12,
                }}
              >
                {successMessage}
              </Alert>
            )}
          </Box>
        )}


        {/* ================================================== */}
        {/* CONTENT */}
        {/* ================================================== */}

        <DialogContent
          sx={{
            p: 2.5,
            backgroundColor:
              theme.bg,
            overflowY: "auto",
          }}
        >
          {loading ? (
            <Box
              sx={{
                minHeight: 400,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexDirection: "column",
                gap: 1.5,
              }}
            >
              <CircularProgress
                size={30}
              />

              <Typography
                sx={{
                  fontFamily:
                    theme.fontSans,
                  fontSize: 12,
                  color: theme.inkMute,
                }}
              >
                Loading Chemotherapy Skill...
              </Typography>
            </Box>
          ) : (
            <>
              {/* ================================================= */}
              {/* PREDEFINED PARAMETERS */}
              {/* ================================================= */}

              <Stack spacing={1.2}>
                {filteredCatalog.map(
                  (module) => {
                    const parameters =
                      safeArray(
                        module.parameters
                      );

                    const selectedInModule =
                      getModuleSelectedCount(
                        module
                      );

                    const allModuleSelected =
                      parameters.length > 0 &&
                      selectedInModule ===
                        parameters.length;

                    const expanded =
                      Boolean(
                        expandedModules[
                          module.module_id
                        ]
                      );

                    return (
                      <Paper
                        key={
                          module.module_id
                        }
                        elevation={0}
                        sx={{
                          border:
                            `1px solid ${theme.line}`,
                          borderRadius: 2,
                          overflow:
                            "hidden",
                        }}
                      >
                        {/* Module header */}

                        <Box
                          sx={{
                            px: 1.5,
                            py: 1.2,
                            backgroundColor:
                              theme.bgPanel,
                            display: "flex",
                            alignItems:
                              "center",
                            gap: 1,
                          }}
                        >
                          <IconButton
                            size="small"
                            onClick={() =>
                              toggleModuleExpanded(
                                module.module_id
                              )
                            }
                          >
                            {expanded ? (
                              <ExpandMore
                                sx={{
                                  fontSize: 20,
                                }}
                              />
                            ) : (
                              <ChevronRight
                                sx={{
                                  fontSize: 20,
                                }}
                              />
                            )}
                          </IconButton>

                          <Box
                            sx={{
                              flex: 1,
                              minWidth: 0,
                            }}
                          >
                            <Typography
                              sx={{
                                fontFamily:
                                  theme.fontSans,
                                fontSize: 13,
                                fontWeight: 700,
                                color:
                                  theme.ink,
                              }}
                            >
                              {module.module_name}
                            </Typography>

                            <Typography
                              sx={{
                                mt: 0.2,
                                fontFamily:
                                  theme.fontSans,
                                fontSize: 10,
                                color:
                                  theme.inkMute,
                              }}
                            >
                              {selectedInModule} of{" "}
                              {parameters.length}{" "}
                              selected
                            </Typography>
                          </Box>

                          <Chip
                            size="small"
                            label={`${selectedInModule}/${parameters.length}`}
                            sx={{
                              fontSize: 10,
                              fontWeight: 700,
                              backgroundColor:
                                selectedInModule >
                                0
                                  ? theme.flagBg
                                  : theme.bgRaise,
                              color:
                                selectedInModule >
                                0
                                  ? theme.flag
                                  : theme.inkMute,
                            }}
                          />

                          <Button
                            size="small"
                            onClick={() =>
                              toggleModule(
                                module
                              )
                            }
                            sx={{
                              minWidth: 85,
                              textTransform:
                                "none",
                              fontSize: 10,
                            }}
                          >
                            {allModuleSelected
                              ? "Clear"
                              : "Select All"}
                          </Button>
                        </Box>

                        <Collapse
                          in={expanded}
                          timeout="auto"
                          unmountOnExit
                        >
                          <Divider />

                          {parameters.map(
                            renderParameter
                          )}
                        </Collapse>
                      </Paper>
                    );
                  }
                )}

                {/* ================================================= */}
                {/* CUSTOM PARAMETERS */}
                {/* ================================================= */}

                {customParameters.length >
                  0 && (
                  <Paper
                    elevation={0}
                    sx={{
                      border:
                        `1px solid ${theme.line}`,
                      borderRadius: 2,
                      overflow:
                        "hidden",
                    }}
                  >
                    <Box
                      sx={{
                        px: 1.5,
                        py: 1.3,
                        backgroundColor:
                          theme.customBg,
                        borderBottom:
                          `1px solid ${theme.line}`,
                      }}
                    >
                      <Stack
                        direction="row"
                        justifyContent="space-between"
                        alignItems="center"
                      >
                        <Box>
                          <Typography
                            sx={{
                              fontFamily:
                                theme.fontSans,
                              fontSize: 13,
                              fontWeight: 700,
                              color:
                                theme.custom,
                            }}
                          >
                            Doctor Added Checks
                          </Typography>

                          <Typography
                            sx={{
                              mt: 0.2,
                              fontFamily:
                                theme.fontSans,
                              fontSize: 10,
                              color:
                                theme.inkMute,
                            }}
                          >
                            Custom checklist points
                            defined by the doctor
                          </Typography>
                        </Box>

                        <Chip
                          size="small"
                          label={`${customParameters.length} custom`}
                          sx={{
                            backgroundColor:
                              "#ffffff",
                            color:
                              theme.custom,
                            fontWeight: 700,
                          }}
                        />
                      </Stack>
                    </Box>

                    {customParameters.map(
                      (item, index) => (
                        <Box
                          key={
                            item.id ||
                            `custom-${index}`
                          }
                          sx={{
                            px: 1.5,
                            py: 1.2,
                            display: "flex",
                            alignItems:
                              "flex-start",
                            gap: 1.2,
                            borderBottom:
                              index <
                              customParameters.length -
                                1
                                ? `1px solid ${theme.lineSoft}`
                                : "none",
                          }}
                        >
                          <CheckCircle
                            sx={{
                              mt: 0.2,
                              fontSize: 18,
                              color:
                                theme.custom,
                            }}
                          />

                          <Box
                            sx={{
                              flex: 1,
                            }}
                          >
                            <Stack
                              direction="row"
                              spacing={1}
                              alignItems="center"
                            >
                              <Typography
                                sx={{
                                  fontFamily:
                                    theme.fontSans,
                                  fontSize: 13,
                                  fontWeight: 600,
                                  color:
                                    theme.ink,
                                }}
                              >
                                {item.name}
                              </Typography>

                              <Chip
                                size="small"
                                label="Manual review"
                                sx={{
                                  height: 20,
                                  fontSize: 9,
                                  color:
                                    theme.custom,
                                  backgroundColor:
                                    theme.customBg,
                                }}
                              />
                            </Stack>

                            <Typography
                              sx={{
                                mt: 0.3,
                                fontFamily:
                                  theme.fontSans,
                                fontSize: 11,
                                lineHeight: 1.5,
                                color:
                                  theme.inkMute,
                              }}
                            >
                              {
                                item.description
                              }
                            </Typography>
                          </Box>

                          <IconButton
                            size="small"
                            onClick={() =>
                              removeCustomParameter(
                                item.id
                              )
                            }
                            sx={{
                              color:
                                theme.inkMute,
                              "&:hover": {
                                color:
                                  theme.alert,
                                backgroundColor:
                                  theme.alertBg,
                              },
                            }}
                          >
                            <Close
                              sx={{
                                fontSize: 17,
                              }}
                            />
                          </IconButton>
                        </Box>
                      )
                    )}
                  </Paper>
                )}

                {/* No search results */}

                {filteredCatalog.length ===
                  0 &&
                  customParameters.length ===
                    0 && (
                    <Alert severity="info">
                      No chemotherapy checks match
                      your search.
                    </Alert>
                  )}
              </Stack>

              {/* ================================================= */}
              {/* TEST RESULTS */}
              {/* ================================================= */}

              {renderTestResults()}
            </>
          )}
        </DialogContent>


        {/* ================================================== */}
        {/* FOOTER */}
        {/* ================================================== */}

        <DialogActions
          sx={{
            px: 2.5,
            py: 1.5,
            borderTop:
              `1px solid ${theme.line}`,
            backgroundColor:
              theme.bgPanel,
          }}
        >
          <Box
            sx={{
              flex: 1,
              display: "flex",
              alignItems: "center",
              gap: 1,
            }}
          >
            <Typography
              sx={{
                fontFamily:
                  theme.fontSans,
                fontSize: 11,
                color: theme.inkMute,
              }}
            >
              {selectedCount} predefined
              checks
              {customCount > 0
                ? ` + ${customCount} custom`
                : ""}
            </Typography>
          </Box>

          <Button
            variant="outlined"
            startIcon={<CloudDownload />}
            onClick={exportSkill}
            disabled={
              loading ||
              saving ||
              totalCount === 0
            }
            sx={{
              textTransform: "none",
              fontSize: 11,
            }}
          >
            Export skill.md
          </Button>

          <Button
            variant="outlined"
            startIcon={<PlayArrow />}
            onClick={() =>
              testSkill(false)
            }
            disabled={
              loading ||
              testing ||
              saving ||
              selectedCount === 0 ||
              !patientId
            }
            sx={{
              textTransform: "none",
              fontSize: 11,
            }}
          >
            {testing ? (
              <>
                <CircularProgress
                  size={15}
                  sx={{ mr: 1 }}
                />
                Testing...
              </>
            ) : (
              "Test Skill"
            )}
          </Button>

          <Button
            variant="outlined"
            startIcon={
              active ? (
                <ToggleOff />
              ) : (
                <ToggleOn />
              )
            }
            onClick={toggleActivation}
            disabled={
              loading ||
              saving ||
              activating ||
              selectedCount === 0
            }
            sx={{
              textTransform: "none",
              fontSize: 11,
              color: active
                ? theme.alert
                : theme.ok,
              borderColor: active
                ? theme.alert
                : theme.ok,
            }}
          >
            {activating
              ? "Updating..."
              : active
              ? "Deactivate"
              : "Activate"}
          </Button>

          <Button
            variant="contained"
            startIcon={<Save />}
            onClick={saveConfiguration}
            disabled={
              loading ||
              saving ||
              testing
            }
            sx={{
              textTransform: "none",
              fontSize: 11,
              backgroundColor:
                theme.primary,
              "&:hover": {
                backgroundColor:
                  theme.primaryHover,
              },
            }}
          >
            {saving
              ? "Saving..."
              : "Save Skill"}
          </Button>
        </DialogActions>
      </Dialog>


      {/* ====================================================== */}
      {/* EDIT PARAMETER DIALOG */}
      {/* ====================================================== */}

      <Dialog
        open={editDialogOpen}
        onClose={closeEditDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle
          sx={{
            fontFamily:
              theme.fontSans,
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          Edit Checking Point
        </DialogTitle>

        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              fullWidth
              label="Check Name"
              value={editName}
              onChange={(event) =>
                setEditName(
                  event.target.value
                )
              }
              disabled={editSaving}
            />

            <TextField
              fullWidth
              multiline
              minRows={4}
              label="Description"
              value={editDescription}
              onChange={(event) =>
                setEditDescription(
                  event.target.value
                )
              }
              disabled={editSaving}
            />

            {editingParameter && (
              <Box
                sx={{
                  p: 1.2,
                  backgroundColor:
                    theme.bgPanel,
                  border:
                    `1px solid ${theme.line}`,
                  borderRadius: 1,
                }}
              >
                <Typography
                  sx={{
                    fontFamily:
                      theme.fontMono,
                    fontSize: 10,
                    color:
                      theme.inkMute,
                  }}
                >
                  ID:{" "}
                  {editingParameter.id}
                </Typography>

                <Typography
                  sx={{
                    mt: 0.4,
                    fontFamily:
                      theme.fontMono,
                    fontSize: 10,
                    color:
                      theme.inkMute,
                  }}
                >
                  Backend parameter:{" "}
                  {editingParameter.backend_parameter ||
                    "—"}
                </Typography>
              </Box>
            )}
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={closeEditDialog}
            disabled={editSaving}
            sx={{
              textTransform: "none",
            }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            onClick={saveParameterEdit}
            disabled={
              editSaving ||
              !editName.trim()
            }
            sx={{
              textTransform: "none",
              backgroundColor:
                theme.primary,
              "&:hover": {
                backgroundColor:
                  theme.primaryHover,
              },
            }}
          >
            {editSaving
              ? "Saving..."
              : "Save Changes"}
          </Button>
        </DialogActions>
      </Dialog>


      {/* ====================================================== */}
      {/* CUSTOM PARAMETER DIALOG */}
      {/* ====================================================== */}

      <Dialog
        open={customDialogOpen}
        onClose={closeCustomDialog}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle
          sx={{
            fontFamily:
              theme.fontSans,
            fontWeight: 700,
            fontSize: 16,
          }}
        >
          Add Custom Checking Point
        </DialogTitle>

        <DialogContent>
          <Alert
            severity="info"
            sx={{
              mb: 2,
              fontSize: 11,
            }}
          >
            Custom checks are doctor-defined manual
            review points. They do not create new
            clinical calculation logic in the existing
            chemotherapy backend.
          </Alert>

          <Stack spacing={2}>
            <TextField
              fullWidth
              label="Check Name"
              placeholder="e.g. Previous chemotherapy intolerance"
              value={customName}
              onChange={(event) =>
                setCustomName(
                  event.target.value
                )
              }
              disabled={customSaving}
            />

            <TextField
              fullWidth
              multiline
              minRows={4}
              label="Description"
              placeholder="Describe what the doctor wants reviewed."
              value={customDescription}
              onChange={(event) =>
                setCustomDescription(
                  event.target.value
                )
              }
              disabled={customSaving}
            />
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button
            onClick={closeCustomDialog}
            disabled={customSaving}
            sx={{
              textTransform: "none",
            }}
          >
            Cancel
          </Button>

          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={addCustomParameter}
            disabled={
              customSaving ||
              !customName.trim() ||
              !customDescription.trim()
            }
            sx={{
              textTransform: "none",
              backgroundColor:
                theme.primary,
              "&:hover": {
                backgroundColor:
                  theme.primaryHover,
              },
            }}
          >
            {customSaving
              ? "Adding..."
              : "Add Check"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}


// ============================================================
// SMALL RESULT FIELD COMPONENT
// ============================================================

function ResultField({ label, value }) {
  if (
    value === undefined ||
    value === null ||
    value === ""
  ) {
    return null;
  }

  return (
    <Box sx={{ mb: 0.7 }}>
      <Typography
        component="span"
        sx={{
          fontFamily:
            theme.fontSans,
          fontSize: 10,
          fontWeight: 700,
          color: theme.inkDim,
        }}
      >
        {label}:{" "}
      </Typography>

      <Typography
        component="span"
        sx={{
          fontFamily:
            theme.fontSans,
          fontSize: 10,
          lineHeight: 1.5,
          color: theme.inkMute,
        }}
      >
        {String(value)}
      </Typography>
    </Box>
  );
}