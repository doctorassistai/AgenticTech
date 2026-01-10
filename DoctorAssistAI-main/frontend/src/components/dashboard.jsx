import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Box,
  Drawer,
  List,
  ListItemButton,
  ListItemText,
  ListItemIcon,
  Typography,
  IconButton,
  Avatar,
  Divider,
  useTheme,
  useMediaQuery,
  Chip,
  Tooltip,
  
} from "@mui/material";
import { WarningAmberRounded } from "@mui/icons-material";
import {
  // ... your existing imports ...
  EditRounded,  // Add this
  // ... rest of your imports ...
} from "@mui/icons-material";
import {
  // ... your existing imports
  MessageRounded, // Add this
  CloseRounded, 
  ImageRounded  // Add this if not already imported
} from "@mui/icons-material";
import {
  MenuRounded,
  AccountCircleRounded,
  Close,
  DashboardRounded,
  AddRounded,
  RefreshRounded,
  MoreVertRounded,
  TabRounded,
  ViewModuleRounded,
  HeightRounded,
} from "@mui/icons-material";
import { Menu, MenuItem, Checkbox, Tabs, Tab } from "@mui/material";
import {
  DndContext,
  closestCenter,
} from "@dnd-kit/core";
import { useLocation, useNavigate } from "react-router-dom";

import {
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";

import { CSS } from "@dnd-kit/utilities";
import Notification from "./Notification";
import CanvasRenderer from "./CanvasRenderer";
import GlassTranscriptionPanel from "./GlassTranscriptionPanel";
import QuickNote from "./QuickNote";
import QuickNotesList from "./QuickNotesList";
// Add this with your other imports
import DICOMViewer from "./DICOMViewer"; // Make sure the path is correct
// 👉 Update path if needed
const LogoSource = "frontend/src/assets/lodo only.png";
const brandGradint =
  "linear-gradient(135deg, #0a3cff 0%, #1ccfc9 50%, #3fb6ff 100%)";

const brandGradient =
  "linear-gradient(135deg, #0ddcd5ff 0%, #0a88a7ff 50%, #04eb83ff 100%)";
const accentGradient = "linear-gradient(135deg, #667eea 0%, #764ba2 100%)";
const stableHeightVariant = (id) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return (Math.abs(hash) % 3) + 1;
};

// Enhanced liquid glass effect
const liquidGlass = {
  position: "relative",
  borderRadius: 18,

  /* Deeper smoke */
  background: "rgba(230, 232, 238, 0.3)",

  backdropFilter: "blur(8px) saturate(105%)",
  WebkitBackdropFilter: "blur(8px) saturate(105%)",

  boxShadow: `
    0 14px 50px rgba(0,0,0,0.18),
    inset 0 1px 0 rgba(255,255,255,0.30),
    inset 0 -1px 0 rgba(0,0,0,0.18)
  `,

  border: "0px solid rgba(255,255,255,0.22)",
  overflow: "hidden",

  /* Smoky gradient wash */
  "&::before": {
    content: '""',
    position: "absolute",
    inset: 0,
    background: `
      radial-gradient(circle at 20% 15%, rgba(255,255,255,0.25), transparent 45%),
      linear-gradient(180deg, rgba(255,255,255,0.12), rgba(0,0,0,0.05))
    `,
    pointerEvents: "none",
  },

  /* Inner rim */
  "&::after": {
    content: '""',
    position: "absolute",
    inset: 0,
    borderRadius: "inherit",
    boxShadow: "inset 0 0 0 1px rgba(0,0,0,0.12)",
    pointerEvents: "none",
  },
};


const glassCard = {
  ...liquidGlass,

  "&::before, &::after": {
    pointerEvents: "none",
  },

  "& > *": {
    position: "relative",
    zIndex: 1,
  },

  /* Prevent children from inheriting glass */
  "& .canvas-root, & .canvas-root *": {
    backdropFilter: "none !important",
    WebkitBackdropFilter: "none !important",
    background: "transparent !important",
  },
};




const actionButton = {
  px: 2.2,
  py: 1,
  borderRadius: 10,
  fontSize: 13,
  fontWeight: 700,
  textTransform: "none",
  letterSpacing: "0.02em",
  background: brandGradient,
  color: "#fff",
  boxShadow: "0 6px 20px rgba(63,182,255,0.25)",
  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
  border: "none",
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 0.5,
  "&:hover": {
    transform: "translateY(-2px)",
    boxShadow: "0 10px 28px rgba(63,182,255,0.35)",
  },
  "&:active": {
    transform: "translateY(0)",
  },
  "&:disabled": {
    opacity: 0.6,
    cursor: "not-allowed",
    transform: "none",
  },
};

const cardVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: { 
    opacity: 1, 
    y: 0,
    scale: 1,
    transition: {
      duration: 0.4,
      ease: [0.4, 0, 0.2, 1]
    }
  },
  hover: {
    y: -4,
    scale: 1.01,
    boxShadow: "0 20px 40px rgba(63,182,255,0.15)",
    transition: {
      duration: 0.2,
      ease: "easeOut"
    }
  }
};
function DraggableNodeItem({ node, children }) {
  const { attributes, listeners, setNodeRef, transform, transition } =
    useSortable({ id: node.node_id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

export default function DoctorDashboard() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const isTablet = useMediaQuery(theme.breakpoints.down("lg"));
  const gridRef = useRef(null);
const [currentDictation, setCurrentDictation] = useState("");
const prevDictationRef = useRef("");
const [doctorName, setDoctorName] = useState("");
const [doctorSpeciality, setDoctorSpeciality] = useState("");
const [dicomViewerEnabled, setDicomViewerEnabled] = useState(true);
const location = useLocation();
const navigate = useNavigate();
  const [showNotesList, setShowNotesList] = useState(false);
 const [quickNoteEnabled, setQuickNoteEnabled] = useState(true);
const query = new URLSearchParams(location.search);
const doctorId = query.get("doctor_id");
const patientId = query.get("patient_id");
const [open, setOpen] = useState(false);

  const [enabledNodes, setEnabledNodes] = useState([]);
  const [reloadingNode, setReloadingNode] = useState(null);
  const [tabAnchor, setTabAnchor] = useState(null);
  const [selectedTabNodes, setSelectedTabNodes] = useState([]);
  const [activeTabIndex, setActiveTabIndex] = useState(0);
  const [nodeData, setNodeData] = useState({});
  const [cardHeights, setCardHeights] = useState({});
const handleDragEnd = (event) => {
  const { active, over } = event;
  if (!over || active.id === over.id) return;

  setEnabledNodes((items) => {
    const oldIndex = items.findIndex((n) => n.node_id === active.id);
    const newIndex = items.findIndex((n) => n.node_id === over.id);

    const updated = [...items];
    const [moved] = updated.splice(oldIndex, 1);
    updated.splice(newIndex, 0, moved);

    return updated;
  });
};

const handleSave = async () => {
  try {
    const features = enabledNodes
      .filter(n => n.requires_dictation)
      .map(n => ({
        [n.node_id]: nodeData[n.node_id] || {}
      }));

    const payload = {
      doctor_id: doctorId,
      patient_id: patientId,
      dictation: currentDictation,
      features,
      timestamp: new Date().toISOString()
    };

    console.log("Final Save Payload:", payload);

    await fetch(
      "https://demo.doctorassist.ai/api/hms/users/orchestration/save-session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      }
    );

    alert("Session saved successfully");
  } catch (err) {
    console.error("Save failed:", err);
    alert("Failed to save session");
  }
};


const fetchPatientProfileDefinition = async () => {
  try {
    const res = await fetch(
      "https://demo.doctorassist.ai/api/hms/users/orchestration/doctor_patient_features/DOC-e766c8ed-d6d4-481f-8ef9-8a63d4bd92e1"
    );
    const json = await res.json();
    return json?.features || [];
  } catch (error) {
    console.error("Error loading patient profile definition:", error);
    return [];
  }
};
useEffect(() => {
  const fetchDoctorDetails = async () => {
    try {
      const res = await fetch(
        "https://demo.doctorassist.ai/api/hms/users/speciality/users/patient/get_doctor_details",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            doctor_id: doctorId
          })
        }
      );

      const data = await res.json();

      if (data.status === "success") {
        setDoctorName(data.doctor_name);
        setDoctorSpeciality(data.doctor_speciality);
      }
    } catch (err) {
      console.error("Failed loading doctor profile:", err);
    }
  };

  fetchDoctorDetails();
}, []);

  // ---------------- FETCH FEATURE DATA ----------------
  const fetchFeatureData = async (nodeId) => {
    const node = enabledNodes.find(n => n.node_id === nodeId);

if (node?.requires_dictation && !currentDictation.trim()) {
  console.warn("Skipping — dictation missing:", nodeId);
  return null;
}
  try {
    const res = await fetch(
      "https://demo.doctorassist.ai/api/hms/users/orchestration/execute-feature-db",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
 patient_id: patientId,
          doctor_id: doctorId,
  feature_id: nodeId,
  ...(node?.requires_dictation && { current_dictation: currentDictation }),
}),

      }
    );

    const json = await res.json();

    // 🧬 Patient Profile adapter
    if (nodeId === "patient-profile") {
      return json?.data?.profile_retrieved?.profile_data || null;
    }

    // 🧠 Default behavior for all other features
    return json?.analysis_result?.data || null;

  } catch (error) {
    console.error("Error fetching node data:", error);
    return null;
  }
};

const getAlertState = () => {
  let critical = 0;
  let warning = 0;

  enabledNodes.forEach((node) => {
    const data = nodeData[node.node_id];
    if (!data) {
      warning++;
    }
    
  });

  if (critical > 0) return { level: "critical", count: critical };
  if (warning > 0) return { level: "warning", count: warning };
  return { level: "ok", count: 0 };
};

const alertState = getAlertState();
const executedDictationsRef = useRef(new Set());

useEffect(() => {
  const text = currentDictation.trim();
  if (!text) return;

  if (executedDictationsRef.current.has(text)) return;

  executedDictationsRef.current.add(text);

  // snapshot of nodes at this moment
  const nodes = [...enabledNodes];

  nodes.forEach(node => {
    if (node.requires_dictation) {
      reloadSingleNode(node.node_id);
    }
  });
}, [currentDictation]); 

  // ---------------- FETCH FEATURES ----------------
  useEffect(() => {
    const load = async () => {
      try {
        const [featureRes, patientDefs] = await Promise.all([
  fetch(`https://demo.doctorassist.ai/api/hms/users/orchestration/get-doctor-features/${doctorId}`),
  fetchPatientProfileDefinition(),
]);

const json = await featureRes.json();
if (json.status !== "success") return;
console.log("fgh",patientDefs)
const patientProfileIds = new Set(
  patientDefs.map(p => String(p.feature_id).trim().toLowerCase())
);


const nodes = json.features
  .filter((f) => f.enabled)
  .map((f) => {
    const isPatientProfile = patientProfileIds.has(
  String(f.feature_id).trim().toLowerCase()
);

    console.log("Feature", f.feature_name, "isPatientProfile:", isPatientProfile);
    const displayMode = isPatientProfile ? "profile" : null;

    const trigger = isPatientProfile
      ? { type: "page-reload" }    // 🔥 force auto-load
      : f.trigger;

    const requiresDictation = [
  "documentation-medication-analysis",
  "documentation-clinical-notes",
  "documentation-investigation-notes",
  "documentation-treatment-summary",
  "documentation-treatment-plan"
].includes(String(f.feature_id).trim().toLowerCase());

return {
  node_id: f.feature_id,
  node_name: f.feature_name,
  category: f.category,
  priority: f.priority,
  display_mode: displayMode,
  requires_dictation: requiresDictation,   // 👈 NEW
  heightVariant: stableHeightVariant(f.feature_id),
  components: [
    {
      type: f.display_method,
      title: f.feature_name,
      data: null,
      trigger: trigger,
      display_mode: displayMode,
    },
  ],
};

  });

if (patientProfileIds.has("patient-profile")) {
  const alreadyExists = nodes.some(
    n => String(n.node_id).trim().toLowerCase() === "patient-profile"
  );

  if (!alreadyExists) {
    nodes.unshift({
      node_id: "patient-profile",
      node_name: "Patient Profile",
      category: "patient-data",
      priority: "high",
      display_mode: "profile",
      heightVariant: stableHeightVariant("patient-profile"),
      components: [
        {
          type: "profile",
          title: "Patient Profile",
          data: null,
          trigger: { type: "page-reload" },   // auto-load
          display_mode: "profile",
        },
      ],
    });
  }
}
        setEnabledNodes(nodes);
        
        // Load data for all nodes with page-reload trigger
        nodes.forEach(async (node) => {
          const trigger = node.components[0].trigger;
          if (trigger?.type === "page-reload") {
  if (node.requires_dictation && !currentDictation.trim()) return;
  const data = await fetchFeatureData(node.node_id);

            setNodeData(prev => ({
              ...prev,
              [node.node_id]: data
            }));
          }
        });

      } catch (error) {
        console.error("Error loading features:", error);
      }
    };
    load();
  }, []);

  const reloadSingleNode = async (nodeId) => {
    setReloadingNode(nodeId);
    try {
      const data = await fetchFeatureData(nodeId);
      setNodeData(prev => ({
        ...prev,
        [nodeId]: data
      }));
    } catch (error) {
      console.error("Error reloading node:", error);
    } finally {
      setTimeout(() => setReloadingNode(null), 500);
    }
  };

  const handleRemoveTab = (nodeId, e) => {
    e.stopPropagation();
    const newTabs = selectedTabNodes.filter((n) => n.node_id !== nodeId);
    setSelectedTabNodes(newTabs);
    
    if (newTabs.length > 0 && activeTabIndex >= newTabs.length) {
      setActiveTabIndex(newTabs.length - 1);
    }
  };

  // Get active tab node with current data
  const getActiveTabNode = () => {
    if (selectedTabNodes.length === 0 || activeTabIndex >= selectedTabNodes.length) {
      return null;
    }
    const node = selectedTabNodes[activeTabIndex];
    const currentData = nodeData[node.node_id] || null;
    
    return {
      ...node,
      components: [{
        ...node.components[0],
        data: currentData
      }]
    };
  };

  const isTabNode = (nodeId) => {
    return selectedTabNodes.some(tab => tab.node_id === nodeId);
  };

  const getNonTabNodes = () => {
    return enabledNodes.map(node => {
      const currentData = nodeData[node.node_id] || null;
      return {
        ...node,
        components: [{
          ...node.components[0],
          data: currentData
        }]
      };
    }).filter(node => !isTabNode(node.node_id));
  };

  const getPriorityColor = (priority) => {
    switch(priority) {
      case 'high': return '#ff6b6b';
      case 'medium': return '#ffd93d';
      case 'low': return '#6bcf7f';
      default: return '#3fb6ff';
    }
  };

  const getHeightStyle = (heightVariant) => {
    switch(heightVariant) {
      case 1: return { minHeight: 300, height: 'auto' };
      case 2: return { minHeight: 380, height: 'auto' };
      case 3: return { minHeight: 460, height: 'auto' };
      default: return { minHeight: 340, height: 'auto' };
    }
  };

  // Split nodes into two columns for masonry layout
  const getMasonryColumns = () => {
    const nodes = getNonTabNodes();
    const column1 = [];
    const column2 = [];
    
    // Simple algorithm: alternate placement based on cumulative height
    let col1Height = 0;
    let col2Height = 0;
    
    nodes.forEach((node, index) => {
      const nodeHeight = node.heightVariant;
      
      if (col1Height <= col2Height) {
        column1.push({ ...node, column: 1 });
        col1Height += nodeHeight;
      } else {
        column2.push({ ...node, column: 2 });
        col2Height += nodeHeight;
      }
    });
    
    return { column1, column2 };
  };

  const { column1, column2 } = getMasonryColumns();
  const showCombinedTab = selectedTabNodes.length > 0;

  return (
    <Box
  sx={{
    height: "100vh",
    display: "flex",
    overflow: "hidden",   // ✅ goes here, NOT in the logo box
background: `
  radial-gradient(circle at 18% 14%, rgba(30, 104, 165, 0.63) 0%, transparent 42%),
  radial-gradient(circle at 82% 18%, rgba(20, 146, 160, 0.62) 0%, transparent 38%),
  radial-gradient(circle at 50% 88%, rgba(45, 175, 171, 0.63) 0%, transparent 40%),
  linear-gradient(135deg, #eef3f8 0%, #e3edf4 45%, #d6e2ec 100%)
`,

filter: "saturate(0.96) contrast(1.04)",



    backdropFilter: "blur(12px) saturate(105%)",

    backgroundAttachment: "fixed",
  }}
>
    <Notification doctorId={doctorId} patientId={patientId} />
    {/* TOGGLE MENU BUTTON */}
<motion.div
  initial={{ opacity: 0 }}
  animate={{ opacity: 1 }}
  transition={{ delay: 0.2 }}
>
  <IconButton
    onClick={() => setOpen(prev => !prev)}
    sx={{
      position: "fixed",
      top: 16,
      left: 16,
      zIndex: 1400,
      ...glassCard,
      width: 44,
      height: 44,
    }}
  >
    {open ? <Close /> : <MenuRounded />}
  </IconButton>
</motion.div>


      {/* SIDEBAR */}
      <Drawer
  open={open}
  variant="temporary"
  onClose={() => setOpen(false)}
  sx={{
    width: 260,
    flexShrink: 0,

    // 🔥 Completely remove from layout
    position: "fixed",
    top: 0,
    left: 0,
    height: "100vh",

"& .MuiDrawer-paper": {
  width: 260,
  height: "100vh",
  borderRadius: 0,

  background: "rgba(255,255,255,0.55)",
  backdropFilter: "blur(26px) saturate(160%)",
  WebkitBackdropFilter: "blur(26px) saturate(160%)",

  borderRight: "1px solid rgba(255,255,255,0.4)",
  boxShadow: "8px 0 30px rgba(31,38,135,0.12)",
},


    // 💀 Kill MUI spacer entirely
    "& .MuiDrawer-docked": {
      display: "none",
    },
  }}
>


        {/* LOGO */}
    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, p: 2 }}>


          <Box
            component="img"
            src={LogoSource}
            sx={{ 
              width: 36, 
              height: 36,
              filter: "drop-shadow(0 4px 12px rgba(63,182,255,0.2))"
            }}
          />
          <Box>
            <Typography fontWeight={900} fontSize={15}>
              DOCTOR<span style={{ color: "#1f9a9b" }}>ASSIST.AI</span>
            </Typography>
            <Typography fontSize={10} sx={{ opacity: 0.6, letterSpacing: "0.5px" }}>
              Smart Dashboard
            </Typography>
          </Box>
        </Box>

        <Divider sx={{ opacity: 0.1, mx: 2 }} />

        {/* QUICK STATS */}
        <Box sx={{ p: 2.5 }}>
          <Box sx={{ 
            background: "linear-gradient(135deg, rgba(28,207,201,0.05) 0%, rgba(63,182,255,0.05) 100%)", 
            borderRadius: 3, 
            p: 2,
            border: "1px solid rgba(63,182,255,0.1)",
          }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
              <Typography fontSize={11} sx={{ opacity: 0.7 }}>
                Modules
              </Typography>
              <Chip
                label={enabledNodes.length}
                size="small"
                sx={{
                  height: 20,
                  fontSize: 10,
                  fontWeight: 700,
                  background: brandGradient,
                  color: "#fff",
                }}
              />
            </Box>
            {selectedTabNodes.length > 0 && (
              <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <Typography fontSize={11} sx={{ opacity: 0.7 }}>
                  In Tabs
                </Typography>
                <Typography fontSize={11} fontWeight={600} sx={{ color: "#3fb6ff" }}>
                  {selectedTabNodes.length}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>

        {/* NODES LIST */}
        <Box sx={{ px: 2, py: 1, flex: 1 }}>
          <Typography fontSize={12} sx={{ opacity: 0.7, mb: 1.5, fontWeight: 600 }}>
            Medical Modules
          </Typography>
          <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
  <SortableContext
    items={enabledNodes.map((n) => n.node_id)}
    strategy={verticalListSortingStrategy}
  >
    <List sx={{ px: 0, background: "transparent" }}>
      {enabledNodes.map((n, index) => {

              const isSelected = isTabNode(n.node_id);
                 
              return (
                
                 <DraggableNodeItem node={n} key={n.node_id}>

                <motion.div
                  key={n.node_id}
                  initial={{ x: -10, opacity: 0 }}
                  animate={{ x: 0, opacity: 1 }}
                  transition={{ delay: index * 0.03 }}
                >
                  
                 <ListItemButton
  sx={{
    borderRadius: 2,
    mb: 0.75,
    py: 1.25,

    background: "rgba(255,255,255,0.25)",
    backdropFilter: "blur(10px)",
    WebkitBackdropFilter: "blur(10px)",

    border: isSelected
      ? "1px solid rgba(63,182,255,0.5)"
      : "1px solid rgba(255,255,255,0.25)",

    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",

    "&:hover": {
      background: "rgba(255,255,255,0.35)",
      boxShadow: "0 6px 20px rgba(63,182,255,0.15)",
      transform: "translateY(-1px)",
    },

    transition: "all 0.25s ease",
  }}
>
  

                    <ListItemIcon sx={{ minWidth: 36 }}>
                      <Box
                        sx={{
                          width: 32,
                          height: 32,
                          borderRadius: 2,
                          background: isSelected ? brandGradient : "rgba(63,182,255,0.1)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          color: isSelected ? "#fff" : "#3fb6ff",
                          boxShadow: isSelected ? "0 4px 12px rgba(63,182,255,0.3)" : "none",
                        }}
                      >
                        <AccountCircleRounded fontSize="small" />
                      </Box>
                    </ListItemIcon>
                    <ListItemText 
                      primary={
                        <Typography fontSize={13} fontWeight={500}>
                          {n.node_name}
                        </Typography>
                      }
                      primaryTypographyProps={{
                        sx: {
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }
                      }}
                    />
                    {isSelected && (
                      <TabRounded sx={{ fontSize: 14, color: "#3fb6ff" }} />
                    )}
                  </ListItemButton>

                </motion.div>
</DraggableNodeItem>
              );
              })}
    </List>
  </SortableContext>
</DndContext>
<Box sx={{ mt: 3, mb: 2 }}>
            <Typography fontSize={12} sx={{ opacity: 0.7, mb: 1.5, fontWeight: 600 }}>
              Additional Features
            </Typography>
            <motion.div
              initial={{ x: -10, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              transition={{ delay: enabledNodes.length * 0.03 + 0.1 }}
            >
              <ListItemButton
                sx={{
                  borderRadius: 2,
                  py: 1.25,
                  background: "rgba(255,255,255,0.25)",
                  backdropFilter: "blur(10px)",
                  WebkitBackdropFilter: "blur(10px)",
                  border: quickNoteEnabled 
                    ? "1px solid rgba(63,182,255,0.5)" 
                    : "1px solid rgba(255,255,255,0.25)",
                  boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
                  "&:hover": {
                    background: "rgba(255,255,255,0.35)",
                    boxShadow: "0 6px 20px rgba(63,182,255,0.15)",
                    transform: "translateY(-1px)",
                  },
                  transition: "all 0.25s ease",
                }}
                onClick={() => setQuickNoteEnabled(!quickNoteEnabled)}
              >
                <ListItemIcon sx={{ minWidth: 36 }}>
                  <Box
                    sx={{
                      width: 32,
                      height: 32,
                      borderRadius: 2,
                      background: quickNoteEnabled ? brandGradient : "rgba(63,182,255,0.1)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      color: quickNoteEnabled ? "#fff" : "#3fb6ff",
                      boxShadow: quickNoteEnabled ? "0 4px 12px rgba(63,182,255,0.3)" : "none",
                    }}
                  >
                    {/* Import Edit from @mui/icons-material */}
                    <EditRounded fontSize="small" />
                  </Box>
                </ListItemIcon>
                <ListItemText 
                  primary={
                    <Typography fontSize={13} fontWeight={500}>
                      Quick Notes
                    </Typography>
                  }
                  secondary={
                    <Typography fontSize={10} sx={{ opacity: 0.6 }}>
                      {quickNoteEnabled ? "Enabled" : "Disabled"}
                    </Typography>
                  }
                />
                <Box
                  sx={{
                    width: 20,
                    height: 20,
                    borderRadius: "50%",
                    background: quickNoteEnabled ? "#6bcf7f" : "#ff6b6b",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 10,
                    color: "#fff",
                    fontWeight: 700,
                  }}
                >
                  {quickNoteEnabled ? "ON" : "OFF"}
                </Box>
              </ListItemButton>
            </motion.div>
            <motion.div
  initial={{ x: -10, opacity: 0 }}
  animate={{ x: 0, opacity: 1 }}
  transition={{ delay: enabledNodes.length * 0.03 + 0.15 }}
>
  <ListItemButton
    sx={{
      borderRadius: 2,
      py: 1.25,
      background: "rgba(255,255,255,0.25)",
      backdropFilter: "blur(10px)",
      WebkitBackdropFilter: "blur(10px)",
      border: dicomViewerEnabled 
        ? "1px solid rgba(156, 39, 176, 0.5)" 
        : "1px solid rgba(255,255,255,0.25)",
      boxShadow: "inset 0 1px 0 rgba(255,255,255,0.5)",
      "&:hover": {
        background: "rgba(255,255,255,0.35)",
        boxShadow: "0 6px 20px rgba(156, 39, 176, 0.15)",
        transform: "translateY(-1px)",
      },
      transition: "all 0.25s ease",
    }}
    onClick={() => setDicomViewerEnabled(!dicomViewerEnabled)}
  >
    <ListItemIcon sx={{ minWidth: 36 }}>
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: 2,
          background: dicomViewerEnabled ? "linear-gradient(135deg, #9c27b0 0%, #673ab7 100%)" : "rgba(156, 39, 176, 0.1)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: dicomViewerEnabled ? "#fff" : "#9c27b0",
          boxShadow: dicomViewerEnabled ? "0 4px 12px rgba(156, 39, 176, 0.3)" : "none",
        }}
      >
        <ImageRounded fontSize="small" />
      </Box>
    </ListItemIcon>
    <ListItemText 
      primary={
        <Typography fontSize={13} fontWeight={500}>
          DICOM Viewer
        </Typography>
      }
      secondary={
        <Typography fontSize={10} sx={{ opacity: 0.6 }}>
          {dicomViewerEnabled ? "Enabled" : "Disabled"}
        </Typography>
      }
    />
    <Box
      sx={{
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: dicomViewerEnabled ? "#6bcf7f" : "#ff6b6b",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 10,
        color: "#fff",
        fontWeight: 700,
      }}
    >
      {dicomViewerEnabled ? "ON" : "OFF"}
    </Box>
  </ListItemButton>
</motion.div>
          </Box>
        </Box>
        
        {/* ADD TABS BUTTON */}
        <Box sx={{ px: 2, mt: 2, pb: 2 }}>
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Box
              component="button"
              onClick={(e) => setTabAnchor(e.currentTarget)}
              sx={{
                ...actionButton,
                width: "100%",
                py: 1.25,
                borderRadius: 3,
                fontSize: 13,
              }}
            >
              <AddRounded sx={{ fontSize: 16 }} />
              Combine Modules
            </Box>
          </motion.div>
        </Box>

        {/* DOCTOR PROFILE */}
        {/* DOCTOR PROFILE */}
<Box sx={{ p: 2.5 }}>
  <Box
    sx={{
      ...glassCard,
      p: 2,
      borderRadius: 3,
      display: "flex",
      alignItems: "center",
      gap: 1.5,
      border: "1px solid rgba(255, 255, 255, 0.9)",
    }}
  >
    <Avatar
      sx={{
        width: 40,
        height: 40,
        background: brandGradient,
        boxShadow: "0 4px 12px rgba(63,182,255,0.3)",
        fontWeight: 700,
        fontSize: 14,
      }}
    >
      {doctorName ? doctorName[0] : "D"}
    </Avatar>

    <Box sx={{ flex: 1 }}>
      <Typography fontWeight={700} fontSize={13}>
        {doctorName || "Loading..."}
      </Typography>

      <Typography fontSize={10} sx={{ opacity: 0.6 }}>
        {doctorSpeciality || "Loading speciality..."}
      </Typography>
    </Box>
  </Box>
</Box>

        
      </Drawer>

      {/* MAIN CONTENT */}
{/* MAIN CONTENT */}
<Box
  sx={{
    flex: 1,
    ml: open ? "260px" : 0,
    height: "100vh",
    overflowY: "auto",
    p: { xs: 2, md: 3 },

    /* 🔥 This makes all Canvas content glass */
   "& .canvas-root .MuiPaper-root": {
  background: "transparent !important",
  backdropFilter: "none",
  WebkitBackdropFilter: "none",
  boxShadow: "none",
  border: "none",
},


    "& .canvas-root .MuiTableContainer-root": {
      background: "transparent !important",
    },

    "& .canvas-root .MuiCard-root": {
      background: "transparent !important",
    },

    "& .canvas-root .recharts-surface": {
      background: "transparent !important",
    },
  }}
>




        
        {/* HEADER */}
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <Box sx={{ 
            ...glassCard, 
            p: 3, 
            borderRadius: 3, 
            mb: 4,
          }}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 2 }}>
              <Box sx={{ flex: 1, minWidth: 280 }}>
               <Typography
  sx={{
    fontSize: { xs: 24, md: 30 },
    fontWeight: 900,
    letterSpacing: "-0.5px",
    background: brandGradint,
    WebkitBackgroundClip: "text",
    WebkitTextFillColor: "transparent",
    textShadow: "0 2px 8px rgba(63,182,255,0.25)",
    mb: 0.5,
    lineHeight: 1.2,
  }}
>
  Medical Dashboard
</Typography>

                <Typography sx={{ opacity: 0.7, fontSize: 14 }}>
                  {selectedTabNodes.length > 0 
                    ? `${selectedTabNodes.length} modules combined for focused analysis` 
                    : "Real-time patient monitoring with adaptive layout"}
                </Typography>
              </Box>
              
              {/* DASHBOARD INFO */}
              <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>

  {/* 🔔 ALERT INDICATOR */}
  <Tooltip
    title={
      alertState.level === "critical"
        ? `${alertState.count} high-priority modules need attention`
        : alertState.level === "warning"
        ? `${alertState.count} modules awaiting data`
        : "All systems healthy"
    }
  >
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        gap: 0.75,
        px: 1.5,
        py: 0.6,
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 700,
        cursor: "default",
        background:
          alertState.level === "critical"
            ? "rgba(255, 77, 79, 0.12)"
            : alertState.level === "warning"
            ? "rgba(255, 193, 7, 0.15)"
            : "rgba(107, 207, 127, 0.15)",
        color:
          alertState.level === "critical"
            ? "#ff4d4f"
            : alertState.level === "warning"
            ? "#fbc02d"
            : "#6bcf7f",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.5)",
      }}
    >
      <WarningAmberRounded
        sx={{
          fontSize: 16,
          animation:
            alertState.level !== "ok"
              ? "pulseAlert 1.5s infinite"
              : "none",
          "@keyframes pulseAlert": {
            "0%": { transform: "scale(1)", opacity: 1 },
            "50%": { transform: "scale(1.15)", opacity: 0.7 },
            "100%": { transform: "scale(1)", opacity: 1 },
          },
        }}
      />
      {alertState.level === "ok" ? "Healthy" : `${alertState.count} Alerts`}
    </Box>
  </Tooltip>
<Tooltip title="View Quick Notes">
                  <IconButton
                    onClick={() => setShowNotesList(true)}
                    sx={{
                      background: "rgba(255, 193, 7, 0.1)",
                      color: "#ff9800",
                      width: 36,
                      height: 36,
                      border: "1px solid rgba(255, 193, 7, 0.3)",
                      "&:hover": {
                        background: "rgba(255, 193, 7, 0.2)",
                        transform: "scale(1.05)",
                      },
                      transition: "all 0.2s ease",
                    }}
                  >
                    <MessageRounded />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Masonry layout adapts to content height">
                  <Chip
                    icon={<ViewModuleRounded />}
                    label="Adaptive Layout"
                    size="small"
                    sx={{
                      background: "rgba(63,182,255,0.08)",
                      color: "#3fb6ff",
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  />
                </Tooltip>
                {selectedTabNodes.length > 0 && (
                  <Chip
                    icon={<TabRounded />}
                    label={`${selectedTabNodes.length} Combined`}
                    size="small"
                    sx={{
                      background: "rgba(28,207,201,0.1)",
                      color: "#1ccfc9",
                      fontWeight: 600,
                      fontSize: 12,
                    }}
                  />
                )}
              </Box>
            </Box>
          </Box>
        </motion.div>

        {/* TAB SELECTION MENU */}
        <Menu
          anchorEl={tabAnchor}
          open={Boolean(tabAnchor)}
          onClose={() => setTabAnchor(null)}
          PaperProps={{
            sx: {
              ...glassCard,
              minWidth: 260,
              maxHeight: 400,
              borderRadius: 3,
              p: 1,
            }
          }}
        >
          <Typography sx={{ px: 2, py: 1.5, fontWeight: 700, fontSize: 13, color: "#3fb6ff" }}>
            Select Modules to Combine
          </Typography>
          <Divider sx={{ opacity: 0.1, my: 1 }} />
          <Box sx={{ maxHeight: 300, overflow: "auto", px: 1 }}>
            {enabledNodes.map((node) => {
              const selected = selectedTabNodes.some((n) => n.node_id === node.node_id);

              return (
                <MenuItem
                  key={node.node_id}
                  onClick={() => {
                    setSelectedTabNodes((prev) => {
                      const exists = prev.some((n) => n.node_id === node.node_id);
                      return exists
                        ? prev.filter((n) => n.node_id !== node.node_id)
                        : [...prev, node];
                    });
                  }}
                  sx={{ 
                    py: 1.25, 
                    borderRadius: 2,
                    mb: 0.5,
                    "&:hover": {
                      background: "rgba(63,182,255,0.04)",
                    }
                  }}
                >
                  <Checkbox 
                    checked={selected} 
                    size="small"
                    sx={{ 
                      color: "#3fb6ff",
                      '&.Mui-checked': {
                        color: "#3fb6ff",
                      }
                    }}
                  />
                  <ListItemText 
                    primary={node.node_name} 
                    primaryTypographyProps={{
                      fontWeight: selected ? 600 : 500,
                      fontSize: 13,
                    }}
                  />
                </MenuItem>
              );
            })}
          </Box>
          <Divider sx={{ opacity: 0.1, my: 1 }} />
          <Box sx={{ p: 1.5, display: 'flex', justifyContent: 'space-between', gap: 1 }}>
            <Box
              component="button"
              onClick={() => {
                setSelectedTabNodes([]);
                setActiveTabIndex(0);
              }}
              sx={{
                px: 2.5,
                py: 0.8,
                borderRadius: 2,
                fontSize: 12,
                fontWeight: 600,
                background: "rgba(255,0,0,0.05)",
                color: "#f44336",
                border: "1px solid rgba(255,0,0,0.1)",
                cursor: "pointer",
                transition: "all 0.2s",
                "&:hover": {
                  background: "rgba(255,0,0,0.1)",
                }
              }}
            >
              Clear
            </Box>
            <Box
              component="button"
              onClick={() => setTabAnchor(null)}
              sx={{
                ...actionButton,
                px: 2.5,
                py: 0.8,
                fontSize: 12,
              }}
            >
              Apply
            </Box>
          </Box>
        </Menu>

        {/* MASONRY LAYOUT - Smart 2-column layout that fills gaps */}
<Box
  ref={gridRef}
  sx={{
    display: "grid",
    gap: { xs: 2, md: 3, xl: 4 },

    gridTemplateColumns: {
      xs: "1fr",                                // phones
      sm: "repeat(2, 1fr)",                     // tablets
      md: "repeat(auto-fit, minmax(320px, 1fr))", // small laptops
      lg: "repeat(auto-fit, minmax(360px, 1fr))", // normal desktops
      xl: "repeat(auto-fit, minmax(420px, 1fr))", // large monitors
    },

    alignItems: "start",
  }}
>

   
          {/* COMBINED TAB CARD - Always spans 2 columns */}
          {showCombinedTab && (
            <Box
              sx={{
                gridColumn: "1 / -1",
              }}
            >
              <motion.div
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                whileHover="hover"
              >
                <Box
                  sx={{
                    ...glassCard,
                    borderRadius: 3,
                    p: 3,
                    minHeight: 420,
                    display: "flex",
                    flexDirection: "column",
                  }}
                  
                >
                  
                  {/* Tab Group Header */}
                  <Box sx={{ 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "space-between",
                    mb: 3,
                  }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                      <Box sx={{ 
                        width: 44, 
                        height: 44, 
                        borderRadius: 3,
                        background: brandGradient,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        fontWeight: 700,
                        fontSize: 18,
                        boxShadow: "0 6px 20px rgba(63,182,255,0.3)",
                      }}>
                        <TabRounded />
                      </Box>
                      <Box>
                        <Typography sx={{ fontSize: 17, fontWeight: 900, color: "#3fb6ff" }}>
                          Combined Workspace
                        </Typography>
                        <Typography sx={{ fontSize: 12, opacity: 0.6 }}>
                          Switch between {selectedTabNodes.length} modules
                        </Typography>
                      </Box>
                    </Box>
                    
                    <IconButton
                      onClick={(e) => setTabAnchor(e.currentTarget)}
                      sx={{
                        background: "rgba(63,182,255,0.1)",
                        color: "#3fb6ff",
                        "&:hover": {
                          background: "rgba(63,182,255,0.2)",
                        }
                      }}
                    >
                      <AddRounded />
                    </IconButton>
                  </Box>

                  {/* Tabs Navigation */}
                  <Box sx={{ mb: 3 }}>
                    <Tabs
                      value={activeTabIndex}
                      onChange={(e, newValue) => setActiveTabIndex(newValue)}
                      variant="scrollable"
                      scrollButtons="auto"
                      sx={{
                        minHeight: 40,
                        '& .MuiTab-root': {
                          fontWeight: 600,
                          fontSize: 12,
                          textTransform: "none",
                          minHeight: 40,
                          minWidth: "auto",
                          px: 2,
                          py: 0.5,
                          borderRadius: 2,
                          mr: 1,
                          '&.Mui-selected': {
                            background: "rgba(63,182,255,0.1)",
                            color: "#3fb6ff",
                          },
                          '&:hover': {
                            background: "rgba(63,182,255,0.05)",
                          }
                        },
                        '& .MuiTabs-indicator': {
                          display: "none",
                        }
                      }}
                    >
                      {selectedTabNodes.map((tabNode, index) => (
                        <Tab 
                          key={tabNode.node_id} 
                          label={
                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                              <Box sx={{ 
                                fontSize: 10,
                                fontWeight: 700,
                                background: activeTabIndex === index ? "#3fb6ff" : "rgba(63,182,255,0.1)",
                                color: activeTabIndex === index ? "#fff" : "#3fb6ff",
                                width: 20,
                                height: 20,
                                borderRadius: "50%",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}>
                                {index + 1}
                              </Box>
                              <Box sx={{ 
                                maxWidth: 100,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap"
                              }}>
                                {tabNode.node_name}
                              </Box>
                              <IconButton
                                size="small"
                                onClick={(e) => handleRemoveTab(tabNode.node_id, e)}
                                sx={{
                                  width: 18,
                                  height: 18,
                                  ml: 0.5,
                                  opacity: 0.5,
                                  '&:hover': {
                                    opacity: 1,
                                    background: "rgba(255,0,0,0.1)",
                                    color: "#f44336",
                                  }
                                }}
                              >
                                <Close sx={{ fontSize: 10 }} />
                              </IconButton>
                            </Box>
                          }
                        />
                      ))}
                    </Tabs>
                  </Box>

                  {/* Active Tab Content */}
                  <Box sx={{ flex: 1 }}>
                    <AnimatePresence mode="wait">
                      {getActiveTabNode() && (
                        <motion.div
                          key={activeTabIndex}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          transition={{ duration: 0.2 }}
                          style={{ height: "100%", display: "flex", flexDirection: "column" }}
                        >
                          {(() => {
                            const activeNode = getActiveTabNode();
                            const comp = activeNode.components[0];
                            const trigger = comp.trigger || {};
                            const showButton = trigger.type === "button-click";

                            return (
                              <>
                                {/* Active Tab Header */}
                                <Box sx={{ 
                                  display: "flex", 
                                  alignItems: "center", 
                                  justifyContent: "space-between",
                                  mb: 3,
                                  p: 2.5,
                                  borderRadius: 2,
                                  background: "rgba(63,182,255,0.05)",
                                  border: "1px solid rgba(63,182,255,0.1)",
                                }}>
                                  <Box sx={{ flex: 1, minWidth: 0 }}>
                                    <Typography sx={{ 
                                      fontSize: 15, 
                                      fontWeight: 700, 
                                      color: "#3fb6ff",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                      whiteSpace: "nowrap",
                                      mb: 0.5,
                                    }}>
                                      {activeNode.node_name}
                                    </Typography>
                                    <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                                      <Typography sx={{ fontSize: 11, opacity: 0.6 }}>
                                        Module {activeTabIndex + 1} of {selectedTabNodes.length}
                                      </Typography>
                                      <Box sx={{ 
                                        width: 4, 
                                        height: 4, 
                                        borderRadius: "50%", 
                                        background: comp.data ? "#6bcf7f" : "#ffd93d" 
                                      }} />
                                      <Typography sx={{ fontSize: 11, opacity: 0.6 }}>
                                        {comp.data ? "Data ready" : "Click Run"}
                                      </Typography>
                                    </Box>
                                  </Box>
                                  
                                  {showButton && (
                                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                                      <Box
                                        component="button"
                                        onClick={() => reloadSingleNode(activeNode.node_id)}
                                        disabled={reloadingNode === activeNode.node_id}
                                        sx={{
                                          ...actionButton,
                                          px: 2,
                                          py: 0.75,
                                          fontSize: 12,
                                          opacity: reloadingNode === activeNode.node_id ? 0.7 : 1,
                                          pointerEvents: reloadingNode === activeNode.node_id ? "none" : "auto",
                                          display: "flex",
                                          alignItems: "center",
                                          gap: 0.5,
                                        }}
                                      >
                                        {reloadingNode === activeNode.node_id ? (
                                          <>
                                            <RefreshRounded sx={{ 
                                              fontSize: 14, 
                                              animation: "spin 1s linear infinite",
                                              "@keyframes spin": {
                                                "0%": { transform: "rotate(0deg)" },
                                                "100%": { transform: "rotate(360deg)" }
                                              }
                                            }} />
                                            Running...
                                          </>
                                        ) : (
                                          <>
                                            <RefreshRounded sx={{ fontSize: 14 }} />
                                            {trigger.button_label || "Run"}
                                          </>
                                        )}
                                      </Box>
                                    </motion.div>
                                  )}
                                </Box>

                                {/* Content Area */}
                                <Box sx={{ 
                                  flex: 1,
                                  minHeight: 250,
                                }}>
                      <Box
  className="canvas-scope"
  sx={{
    /* Only control normal text */
    "& .canvas-root": {
      color: "#0f172a",
    },

    "& .canvas-root p, \
       & .canvas-root span, \
       & .canvas-root td, \
       & .canvas-root th, \
       & .canvas-root div, \
       & .canvas-root label": {
      color: "#0f172a",
      WebkitTextFillColor: "#0f172a",
    },

    /* Protect charts & graphics */
    "& .canvas-root svg, & .canvas-root canvas": {
      color: "unset",
      WebkitTextFillColor: "unset",
    },
  }}
>

  <CanvasRenderer components={[comp]} />
</Box>


                                </Box>
                              </>
                            );
                          })()}
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </Box>
                </Box>
              </motion.div>
            </Box>
          )}

          {/* MASONRY COLUMN 1 */}
          <Box sx={{ 
            display: "flex", 
            flexDirection: "column", 

 gap: { xs: 2, md: 3, xl: 4 },
          }}>
            {column1.map((node, index) => {
              const comp = node.components[0];
              const trigger = comp.trigger || {};
              const showButton = trigger.type === "button-click";
              const heightStyle = getHeightStyle(node.heightVariant);

              return (
                <motion.div
                  key={node.node_id}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  whileHover="hover"
                  transition={{ delay: index * 0.1 }}
                >
                  <Box
                    sx={{
                      ...glassCard,
                      borderRadius: 3,
                      p: 2.5,
                      ...heightStyle,
                      display: "flex",
                      flexDirection: "column",
                      transition: "all 0.3s",
                    }}
                  >
                    {/* Card Header */}
                    <Box sx={{ 
                      display: "flex", 
                      alignItems: "flex-start", 
                      justifyContent: "space-between",
                      mb: 2,
                    }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                          <Box sx={{ 
                            width: 36, 
                            height: 36, 
                            borderRadius: 2,
                            background: "rgba(63,182,255,0.1)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#3fb6ff",
                          }}>
                            <AccountCircleRounded fontSize="small" />
                          </Box>
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                          <Typography
  sx={{
    fontSize: { xs: 15, md: 16.5 },
    fontWeight: 800,
    letterSpacing: "-0.2px",
    lineHeight: 1.15,
    color: "#1f9a9b",
    textShadow: "0 1px 6px rgba(63,182,255,0.35)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }}
>
  {node.node_name}
</Typography>

                            <Typography sx={{ 
                              fontSize: 10, 
                              opacity: 0.6,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}>
                              {node.category}
                            </Typography>
                          </Box>
                        </Box>
                        
                        {/* Status Bar */}
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5 }}>
                          
                          <Box sx={{ 
                            width: 5, 
                            height: 5, 
                            borderRadius: "50%", 
                            background: comp.data ? "#6bcf7f" : "#ffd93d",
                            animation: !comp.data ? "pulse 2s infinite" : "none",
                            "@keyframes pulse": {
                              "0%": { opacity: 1 },
                              "50%": { opacity: 0.3 },
                              "100%": { opacity: 1 }
                            }
                          }} />
                          <Typography sx={{ fontSize: 10, opacity: 0.6 }}>
                            {comp.data ? "Updated" : "Pending"}
                          </Typography>
                        </Box>
                      </Box>
                      
                      {/* Action Buttons */}
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        {showButton && (
                          <Tooltip title={trigger.button_label || "Run analysis"}>
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <IconButton
                                onClick={() => reloadSingleNode(node.node_id)}
                                disabled={reloadingNode === node.node_id}
                                sx={{
                                  background: "rgba(63,182,255,0.1)",
                                  color: "#3fb6ff",
                                  width: 32,
                                  height: 32,
                                  opacity: reloadingNode === node.node_id ? 0.7 : 1,
                                }}
                              >
                                {reloadingNode === node.node_id ? (
                                  <RefreshRounded sx={{ fontSize: 14, animation: "spin 1s linear infinite" }} />
                                ) : (
                                  <RefreshRounded sx={{ fontSize: 14 }} />
                                )}
                              </IconButton>
                            </motion.div>
                          </Tooltip>
                        )}
                      </Box>
                    </Box>

                    {/* Content Area */}
                    <Box sx={{ 
                      flex: 1,
                      mt: 2,
                       
                    }}>
                <Box
  className="canvas-scope"
  sx={{
    /* Only control normal text */
    "& .canvas-root": {
      color: "#0f172a",
    },

    "& .canvas-root p, \
       & .canvas-root span, \
       & .canvas-root td, \
       & .canvas-root th, \
       & .canvas-root div, \
       & .canvas-root label": {
      color: "#0f172a",
      WebkitTextFillColor: "#0f172a",
    },

    /* Protect charts & graphics */
    "& .canvas-root svg, & .canvas-root canvas": {
      color: "unset",
      WebkitTextFillColor: "unset",
    },
  }}
>

  <CanvasRenderer components={[comp]} />
</Box>


                    </Box>
                  </Box>
                </motion.div>
              );
            })}
          </Box>

          {/* MASONRY COLUMN 2 */}
          <Box sx={{ 
            display: "flex", 
            flexDirection: "column", 
            gap: 3,
 gap: { xs: 2, md: 3, xl: 4 },

          }}>
            {column2.map((node, index) => {
              const comp = node.components[0];
              const trigger = comp.trigger || {};
              const showButton = trigger.type === "button-click";
              const heightStyle = getHeightStyle(node.heightVariant);

              return (
                <motion.div
                  key={node.node_id}
                  variants={cardVariants}
                  initial="hidden"
                  animate="visible"
                  whileHover="hover"
                  transition={{ delay: index * 0.1 + 0.05 }}
                >
                  <Box
                    sx={{
                      ...glassCard,
                      borderRadius: 3,
                      p: 2.5,
                      ...heightStyle,
                      display: "flex",
                      flexDirection: "column",
                      transition: "all 0.3s",
                    }}
                  >
                    
                    {/* Card Header */}
                    <Box sx={{ 
                      display: "flex", 
                      alignItems: "flex-start", 
                      justifyContent: "space-between",
                      mb: 2,
                    }}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1 }}>
                          <Box sx={{ 
                            width: 36, 
                            height: 36, 
                            borderRadius: 2,
                            background: "rgba(63,182,255,0.1)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "#3fb6ff",
                          }}>
                            <AccountCircleRounded fontSize="small" />
                          </Box>
                          
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                             <Typography
  sx={{
    fontSize: { xs: 15, md: 16.5 },
    fontWeight: 800,
    letterSpacing: "-0.2px",
    lineHeight: 1.15,
    color: "#1f9a9b",
    textShadow: "0 1px 6px rgba(63,182,255,0.35)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  }}
>
  {node.node_name}
</Typography>
                             
                            <Typography sx={{ 
                              fontSize: 10, 
                              opacity: 0.6,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}>
                              {node.category}
                            </Typography>
                          </Box>
                        </Box>
                        
                        {/* Status Bar */}
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1.5 }}>
                          <Chip
                            label={node.priority}
                            size="small"
                            sx={{
                              height: 18,
                              fontSize: 9,
                              fontWeight: 600,
                              background: `rgba(${getPriorityColor(node.priority).replace('#', '')}, 0.1)`,
                              color: getPriorityColor(node.priority),
                              textTransform: "uppercase",
                            }}
                          />
                          <Box sx={{ 
                            width: 5, 
                            height: 5, 
                            borderRadius: "50%", 
                            background: comp.data ? "#6bcf7f" : "#ffd93d",
                            animation: !comp.data ? "pulse 2s infinite" : "none",
                          }} />
                          <Typography sx={{ fontSize: 10, opacity: 0.6 }}>
                            {comp.data ? "Updated" : "Pending"}
                          </Typography>
                        </Box>
                      </Box>
                      
                      {/* Action Buttons */}
                      <Box sx={{ display: "flex", gap: 0.5 }}>
                        {showButton && (
                          <Tooltip title={trigger.button_label || "Run analysis"}>
                            <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                              <IconButton
                                onClick={() => reloadSingleNode(node.node_id)}
                                disabled={reloadingNode === node.node_id}
                                sx={{
                                  background: "rgba(63,182,255,0.1)",
                                  color: "#3fb6ff",
                                  width: 32,
                                  height: 32,
                                  opacity: reloadingNode === node.node_id ? 0.7 : 1,
                                }}
                              >
                                {reloadingNode === node.node_id ? (
                                  <RefreshRounded sx={{ fontSize: 14, animation: "spin 1s linear infinite" }} />
                                ) : (
                                  <RefreshRounded sx={{ fontSize: 14 }} />
                                )}
                              </IconButton>
                            </motion.div>
                          </Tooltip>
                        )}
                      </Box>
                    </Box>

                    {/* Content Area */}
                    <Box sx={{ 
                      flex: 1,
                      mt: 2,
                       
                    }}>
                  <Box
  className="canvas-scope"
  sx={{
    /* Only control normal text */
    "& .canvas-root": {
      color: "#0f172a",
    },

    "& .canvas-root p, \
       & .canvas-root span, \
       & .canvas-root td, \
       & .canvas-root th, \
       & .canvas-root div, \
       & .canvas-root label": {
      color: "#0f172a",
      WebkitTextFillColor: "#0f172a",
    },

    /* Protect charts & graphics */
    "& .canvas-root svg, & .canvas-root canvas": {
      color: "unset",
      WebkitTextFillColor: "unset",
    },
  }}
>

  <CanvasRenderer components={[comp]} />
</Box>


                    </Box>
                  </Box>
                </motion.div>
              );
            })}
            {/* TRANSCRIPTION MODULE — appears after endpoint nodes */}
<motion.div
  variants={cardVariants}
  initial="hidden"
  animate="visible"
  whileHover="hover"
  style={{ gridColumn: "1 / -1" }}   // 🔥 THIS is the key
>
  <Box
    sx={{
      ...glassCard,
      borderRadius: 3,
      p: 2.5,
      minHeight: 280,
      display: "flex",
      flexDirection: "column",
    }}
  >
    <GlassTranscriptionPanel onTranscribe={setCurrentDictation} doctorId={doctorId} patientId={patientId} />

  </Box>
</motion.div>
{dicomViewerEnabled && (
  <motion.div
    variants={cardVariants}
    initial="hidden"
    animate="visible"
    whileHover="hover"
    style={{ gridColumn: "1 / -1" }}
  >
    <Box
      sx={{
        ...glassCard,
        borderRadius: 3,
        p: 2.5,
        minHeight: 500,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Box sx={{ 
        display: "flex", 
        alignItems: "center", 
        justifyContent: "space-between",
        mb: 2,
        p: 2,
        borderRadius: 2,
        background: "rgba(156, 39, 176, 0.05)",
        border: "1px solid rgba(156, 39, 176, 0.1)",
      }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ 
            width: 40, 
            height: 40, 
            borderRadius: 2,
            background: "linear-gradient(135deg, #9c27b0 0%, #673ab7 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            boxShadow: "0 6px 20px rgba(156, 39, 176, 0.3)",
          }}>
            <ImageRounded />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 18, fontWeight: 800, color: "#7b1fa2" }}>
              DICOM Imaging Studies
            </Typography>
            <Typography sx={{ fontSize: 12, opacity: 0.6 }}>
              View and analyze medical imaging studies
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Tooltip title="Toggle DICOM Viewer">
            <IconButton
              onClick={() => setDicomViewerEnabled(false)}
              sx={{
                background: "rgba(156, 39, 176, 0.1)",
                color: "#9c27b0",
                width: 32,
                height: 32,
                "&:hover": {
                  background: "rgba(156, 39, 176, 0.2)",
                }
              }}
            >
              <Close fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
      
      {/* DICOM Viewer Component */}
      <Box sx={{ flex: 1, mt: 2 }}>
        <DICOMViewer patientId={patientId} />
      </Box>
    </Box>
  </motion.div>
)}

          </Box>
          
        </Box>

        {/* EMPTY STATE */}
        {enabledNodes.length === 0 && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <Box sx={{ 
              ...glassCard, 
              borderRadius: 3, 
              p: 6, 
              textAlign: "center",
              mt: 4,
            }}>
              <Box sx={{ 
                width: 70, 
                height: 70, 
                borderRadius: "50%",
                background: "rgba(63,182,255,0.1)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 20px",
                color: "#3fb6ff",
              }}>
                <DashboardRounded sx={{ fontSize: 36 }} />
              </Box>
              <Typography sx={{ fontSize: 20, fontWeight: 900, mb: 1.5, color: "#3fb6ff" }}>
                No Active Modules
              </Typography>
              <Typography sx={{ opacity: 0.7, maxWidth: 400, margin: "0 auto", mb: 4, fontSize: 14 }}>
                Add medical modules to begin monitoring and analysis
              </Typography>
              <Box
                component="button"
                sx={{
                  ...actionButton,
                  px: 3.5,
                  py: 1.25,
                  fontSize: 14,
                }}
              >
                <AddRounded sx={{ mr: 1 }} />
                Add First Module
              </Box>
            </Box>
          </motion.div>
        )}
      </Box>
      <motion.div
  initial={{ y: 60, opacity: 0 }}
  animate={{ y: 0, opacity: 1 }}
  transition={{ delay: 0.5 }}
  style={{
    position: "fixed",
    bottom: 24,
    right: 24,
    zIndex: 1500,
  }}
>
  <Box
    component="button"
    onClick={handleSave}
    sx={{
      ...actionButton,
      px: 3,
      py: 1.25,
      borderRadius: 3,
      fontSize: 14,
      boxShadow: "0 12px 40px rgba(63,182,255,0.4)",
    }}
  >
    💾 Save Session
  </Box>
</motion.div>
{quickNoteEnabled && (
  <motion.div
    initial={{ opacity: 0, x: 50 }}
    animate={{ opacity: 1, x: 0 }}
    transition={{ delay: 0.7 }}
    style={{
      position: "fixed",
      right: 24,
      top: "50%",
      transform: "translateY(-50%)",
      zIndex: 1490, // Slightly below Save button
    }}
  >
    <QuickNote
      onSave={(note) => {
        // Handle saving quick notes
        console.log("Quick note saved:", note);
        // You might want to show a toast or save to backend
        alert(`Quick note saved with priority: ${note.priority}`);
      }}
    />
  </motion.div>
)}
      {/* Quick Notes List Modal */}
           {/* Quick Notes List Modal */}
      <AnimatePresence>
        {showNotesList && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowNotesList(false)}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: "rgba(0, 0, 0, 0.5)",
                backdropFilter: "blur(4px)",
                zIndex: 2000,
              }}
            />
            
            {/* Modal Content - FIXED with CSS Grid for perfect centering */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 2001,
                display: "grid",
                placeItems: "center",
                padding: "20px",
                pointerEvents: "none",
              }}
            >
              <Box
                sx={{
                  ...glassCard,
                  borderRadius: 3,
                  overflow: "hidden",
                  display: "flex",
                  flexDirection: "column",
                  maxHeight: "90vh",
                  width: "100%",
                  maxWidth: "1200px",
                  pointerEvents: "auto",
                }}
              >
                {/* Modal Header */}
                <Box
                  sx={{
                    p: 3,
                    borderBottom: "1px solid rgba(255, 255, 255, 0.2)",
                    background: "rgba(255, 255, 255, 0.1)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                  }}
                >
                  <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
                    <Box
                      sx={{
                        width: 44,
                        height: 44,
                        borderRadius: 3,
                        background: "linear-gradient(135deg, #ff9800 0%, #ff5722 100%)",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        color: "#fff",
                        boxShadow: "0 6px 20px rgba(255, 152, 0, 0.3)",
                      }}
                    >
                      <MessageRounded />
                    </Box>
                    <Box>
                      <Typography
                        sx={{
                          fontSize: 20,
                          fontWeight: 900,
                          color: "#ff9800",
                          letterSpacing: "-0.5px",
                        }}
                      >
                        Quick Notes
                      </Typography>
                      <Typography sx={{ fontSize: 12, opacity: 0.7 }}>
                        View and manage all your quick notes
                      </Typography>
                    </Box>
                  </Box>
                  
                  <IconButton
                    onClick={() => setShowNotesList(false)}
                    sx={{
                      background: "rgba(255, 255, 255, 0.2)",
                      color: "#fff",
                      "&:hover": {
                        background: "rgba(255, 255, 255, 0.3)",
                      },
                    }}
                  >
                    <CloseRounded />
                  </IconButton>
                </Box>

                {/* Modal Content */}
                <Box sx={{ 
                  flex: 1, 
                  overflow: "auto", 
                  p: 3,
                }}>
                  {doctorId && patientId ? (
                    <QuickNotesList
                      doctorId={doctorId}
                      patientId={patientId}
                      refreshTrigger={showNotesList ? 1 : 0}
                    />
                  ) : (
                    <Box
                      sx={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        py: 8,
                        opacity: 0.5,
                      }}
                    >
                      <MessageRounded sx={{ fontSize: 60, mb: 2 }} />
                      <Typography variant="h6" sx={{ mb: 1 }}>
                        No patient/doctor data
                      </Typography>
                      <Typography variant="body2">
                        Please ensure you're viewing a patient record
                      </Typography>
                    </Box>
                  )}
                </Box>

                {/* Modal Footer */}
                <Box
                  sx={{
                    p: 2,
                    borderTop: "1px solid rgba(255, 255, 255, 0.2)",
                    background: "rgba(255, 255, 255, 0.05)",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <Typography variant="caption" sx={{ opacity: 0.6 }}>
                    Click outside or press ESC to close
                  </Typography>
                  <Box
                    component="button"
                    onClick={() => setShowNotesList(false)}
                    sx={{
                      px: 2.5,
                      py: 0.8,
                      borderRadius: 2,
                      fontSize: 12,
                      fontWeight: 600,
                      background: "rgba(255, 152, 0, 0.1)",
                      color: "#ff9800",
                      border: "1px solid rgba(255, 152, 0, 0.3)",
                      cursor: "pointer",
                      transition: "all 0.2s",
                      "&:hover": {
                        background: "rgba(255, 152, 0, 0.2)",
                      },
                    }}
                  >
                    Close
                  </Box>
                </Box>
              </Box>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </Box>
  );
}
    