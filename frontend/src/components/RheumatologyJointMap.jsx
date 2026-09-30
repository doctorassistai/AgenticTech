import React, { useState, useEffect, useMemo, useCallback } from "react";
import { Box, Typography, Chip } from "@mui/material";
import { RefreshRounded, SaveRounded, AutoAwesomeRounded } from "@mui/icons-material";
import { THEMES } from "../dashboard/themes";
import { announceRheumContextUpdate, subscribeRheumContextUpdate } from "../dashboard/rheumatologyContextBus";
import skeletonImage from "../assets/skeleton-vascular-front.png";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

const themeName = localStorage.getItem("theme") || "PurpleWhite";
const theme = THEMES[themeName] || THEMES.PurpleWhite;
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
  white: theme.bg, ghost: theme.bgAlt, fog: theme.bgTert,
  black: theme.text, ink: theme.text, charcoal: theme.textSec,
  smoke: theme.textSec, ash: theme.textMuted, silver: theme.textMuted,
  mist: theme.border, border: theme.borderStr,
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });
const card = { background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" };

const actionButton = {
  px: 2.5, py: 1.1, borderRadius: "2px", fontSize: 12, fontWeight: 400,
  fontFamily: FONT, textTransform: "none", letterSpacing: "0.06em",
  background: C.black, color: C.white, border: "none", cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center", gap: 0.75,
  transition: "background 0.18s ease",
  "&:hover": { background: C.charcoal }, "&:disabled": { opacity: 0.4, cursor: "not-allowed" },
};

const inputSx = {
  width: "100%", padding: "10px 14px", border: `1px solid ${C.mist}`,
  borderRadius: "2px", background: C.white, fontFamily: FONT, fontSize: "13px",
  fontWeight: 300, color: C.ink, outline: "none", boxSizing: "border-box",
};

const Field = ({ label, children }) => (
  <Box sx={{ mb: 2 }}>
    <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
      {label}
    </Typography>
    {children}
  </Box>
);
// ─── Canonical 28-joint vocabulary — MUST match JOINT_IDS in
// rheumatology_joint_map_api.py exactly. xPct/yPct are percentages (0-100)
// of the background image's width/height — measured off the uploaded reference image.
// NOTE: image is a front view, so the patient's own left arm/leg appears on the RIGHT side of the picture.
const JOINTS = [
  { id: "shoulder_L", label: "Left Shoulder", xPct: 66.7, yPct: 18.5 },
  { id: "shoulder_R", label: "Right Shoulder", xPct: 32.7, yPct: 18.2 },
  { id: "elbow_L", label: "Left Elbow", xPct: 73.0, yPct: 36.0 },
  { id: "elbow_R", label: "Right Elbow", xPct: 27.3, yPct: 35.7 },
  { id: "wrist_L", label: "Left Wrist", xPct: 78.0, yPct: 48.5 },
  { id: "wrist_R", label: "Right Wrist", xPct: 20.3, yPct: 48.7 },
  { id: "mcp1_L", label: "Left MCP 1", xPct: 84.3, yPct: 52.0 },
  { id: "mcp2_L", label: "Left MCP 2", xPct: 83.0, yPct: 54.1 },
  { id: "mcp3_L", label: "Left MCP 3", xPct: 80.0, yPct: 54.7 },
  { id: "mcp4_L", label: "Left MCP 4", xPct: 78.3, yPct: 54.1 },
  { id: "mcp5_L", label: "Left MCP 5", xPct: 75.7, yPct: 53.9 },
  { id: "mcp1_R", label: "Right MCP 1", xPct: 14.3, yPct: 52.6 },
  { id: "mcp2_R", label: "Right MCP 2", xPct: 16.3, yPct: 55.1 },
  { id: "mcp3_R", label: "Right MCP 3", xPct: 19.0, yPct: 55.7 },
  { id: "mcp4_R", label: "Right MCP 4", xPct: 21.0, yPct: 55.5 },
  { id: "mcp5_R", label: "Right MCP 5", xPct: 24.0, yPct: 54.3 },
  { id: "pip1_L", label: "Left PIP 1", xPct: 87.0, yPct: 54.9 },
  { id: "pip2_L", label: "Left PIP 2", xPct: 85.3, yPct: 58.7 },
  { id: "pip3_L", label: "Left PIP 3", xPct: 82.0, yPct: 58.9 },
  { id: "pip4_L", label: "Left PIP 4", xPct: 79.0, yPct: 58.9 },
  { id: "pip5_L", label: "Left PIP 5", xPct: 76.0, yPct: 58.0 },
  { id: "pip1_R", label: "Right PIP 1", xPct: 12.3, yPct: 54.7 },
  { id: "pip2_R", label: "Right PIP 2", xPct: 13.7, yPct: 58.7 },
  { id: "pip3_R", label: "Right PIP 3", xPct: 17.7, yPct: 59.3 },
  { id: "pip4_R", label: "Right PIP 4", xPct: 21.7, yPct: 58.7 },
  { id: "pip5_R", label: "Right PIP 5", xPct: 25.0, yPct: 57.0 },
  { id: "knee_L", label: "Left Knee", xPct: 60.0, yPct: 72.6 },
  { id: "knee_R", label: "Right Knee", xPct: 40.7, yPct: 73.5 },
];

const JOINT_IDS = JOINTS.map((j) => j.id);

// Set to true temporarily to click the image and log xPct/yPct in the console for recalibration.
const CALIBRATION_MODE = false;

const STATUS_CYCLE = ["none", "tender", "swollen", "tender_swollen"];
const STATUS_COLOR = {
  none: "#ffffff",
  tender: "#f2c14e",
  swollen: "#d64545",
  tender_swollen: "#7b4fa3",
};
const STATUS_LABEL = {
  none: "Unaffected",
  tender: "Tender",
  swollen: "Swollen",
  tender_swollen: "Tender + Swollen",
};

const ENTHESITIS_SITES = [
  "Lateral epicondyle (L)", "Lateral epicondyle (R)",
  "Medial epicondyle (L)", "Medial epicondyle (R)",
  "Achilles insertion (L)", "Achilles insertion (R)",
  "Plantar fascia insertion (L)", "Plantar fascia insertion (R)",
  "Greater trochanter (L)", "Greater trochanter (R)",
  "Patellar tendon insertion (L)", "Patellar tendon insertion (R)",
];

const AXIAL_OPTIONS = ["Yes", "No", "Uncertain"];
const EMPTY_MAP = {
  joints: {},
  enthesitis_sites: [],
  dactylitis_digits: [],
  axial_involvement: "",
  rom_limitation: "",
  pain_severity: "",
  functional_impact: "",
};

// Merge extracted joints safely — only accept known joint IDs and known statuses,
// so a malformed backend response can't silently corrupt the map.
const mergeJoints = (prevJoints, extractedJoints) => {
  if (!extractedJoints || typeof extractedJoints !== "object") return prevJoints;
  const merged = { ...prevJoints };
  Object.entries(extractedJoints).forEach(([jointId, status]) => {
    if (!JOINT_IDS.includes(jointId)) return;
    if (!STATUS_CYCLE.includes(status)) return;
    if (status === "none") delete merged[jointId];
    else merged[jointId] = status;
  });
  return merged;
};

export default function RheumatologyJointMap({ doctorId, patientId, patientName, dictationText, dictationTrigger }) {
  const [manualDictation, setManualDictation] = useState("");
  const [jointMap, setJointMap] = useState(EMPTY_MAP);
  const [intakeRef, setIntakeRef] = useState(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [hoveredJoint, setHoveredJoint] = useState(null);

  const loadIntakeRef = useCallback(async () => {
    if (!patientId || !doctorId) return;
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-joint-map/latest-intake/${patientId}/${doctorId}`);
      const json = await res.json();
      if (json?.status === "success") setIntakeRef(json.data);
    } catch (err) {
      console.error("Failed to load intake reference for joint map:", err);
    }
  }, [patientId, doctorId]);

  useEffect(() => {
    loadIntakeRef();
    return subscribeRheumContextUpdate(loadIntakeRef);
  }, [loadIntakeRef]);

  const cycleJoint = (jointId) => {
    setJointMap((prev) => {
      const current = prev.joints[jointId] || "none";
      const nextIdx = (STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length;
      const nextStatus = STATUS_CYCLE[nextIdx];
      const joints = { ...prev.joints };
      if (nextStatus === "none") delete joints[jointId];
      else joints[jointId] = nextStatus;
      return { ...prev, joints };
    });
  };

  const toggleEnthesitis = (site) => {
    setJointMap((prev) => {
      const has = prev.enthesitis_sites.includes(site);
      return { ...prev, enthesitis_sites: has ? prev.enthesitis_sites.filter((s) => s !== site) : [...prev.enthesitis_sites, site] };
    });
  };

  const updateField = (key, value) => setJointMap((prev) => ({ ...prev, [key]: value }));

  const counts = useMemo(() => {
    const values = Object.values(jointMap.joints);
    const tender = values.filter((v) => v === "tender" || v === "tender_swollen").length;
    const swollen = values.filter((v) => v === "swollen" || v === "tender_swollen").length;
    return { tender, swollen };
  }, [jointMap.joints]);

  // textOverride lets this be called either from the main Clinical Dictation
  // "Re-extract" button (passes dictationText) or from the local exam
  // dictation box (passes manualDictation).
  const handleAnalyzeDictation = async (textOverride) => {
    const text = (textOverride ?? manualDictation ?? "").trim();
    if (!text) return;
    setExtracting(true);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-joint-map/extract-fields`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ doctor_id: doctorId, patient_id: patientId, dictation: text }),
      });
      const json = await res.json();
      if (json?.status === "success") {
        const out = json.finaloutput || {};
        setJointMap((prev) => ({
          ...prev,
          ...out,
          joints: mergeJoints(prev.joints, out.joints),
        }));
      }
    } catch (err) {
      console.error("Joint map extract-fields failed:", err);
    } finally {
      setExtracting(false);
    }
  };

  // Auto-extract whenever a new dictation lands from the main Clinical Dictation panel —
  // same pattern as RheumatologyIntakeForm, so Joint Mapping stays in sync with the
  // consultation dictation without the doctor re-typing anything here.
  useEffect(() => {
    if (!dictationTrigger || !dictationText?.trim()) return;
    handleAnalyzeDictation(dictationText);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dictationTrigger]);

  const handleSave = async () => {
    setSaving(true);
    setSaveMsg("");
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/rheumatology-joint-map/save`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId, jointMap }),
      });
      const json = await res.json();
      if (!res.ok || json?.status !== "success") throw new Error(json?.detail || json?.message || "Save failed");
      setSaveMsg("✅ Joint map saved");
      window.dispatchEvent(new Event("refreshRheumatologyJointMapHistory"));
      announceRheumContextUpdate("joint-map");
    } catch (err) {
      console.error("Joint map save failed:", err);
      setSaveMsg(`❌ ${err.message || "Save failed"}`);
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(""), 3000);
    }
  };

  return (
    <Box sx={{ ...card, overflow: "hidden" }}>
      <Box sx={{ px: 3, py: 2.5, borderBottom: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1.5 }}>
        <Box>
          <Typography sx={{ ...os({ fontSize: 14, color: C.ink, letterSpacing: "0.02em" }) }}>Joint & Symptom Mapping</Typography>
          <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.4 }) }}>
            {patientName ? `28-joint exam — ${patientName}` : "28-joint exam"}
          </Typography>
        </Box>
        <Chip label="Module 2 · Joint Mapping" size="small" sx={{ background: C.black, color: C.white, fontWeight: 300, fontSize: 10, letterSpacing: "0.04em", borderRadius: "2px", height: 22 }} />
      </Box>

      {intakeRef?.affected_joints?.length > 0 && (
        <Box sx={{ mx: 3, mt: 2, p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}` }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>From Intake (reference only)</Typography>
          <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>
            {[intakeRef.joint_distribution, intakeRef.joint_symmetry].filter(Boolean).join(" · ")}
            {intakeRef.affected_joints?.length > 0 && ` — ${intakeRef.affected_joints.join(", ")}`}
          </Typography>
        </Box>
      )}

      {/* Source Dictation — from the main Clinical Dictation panel (same pattern as Intake) */}
      <Box sx={{ px: 3, pt: 2.5 }}>
        <Box sx={{
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2,
          p: 1.5, borderRadius: "2px", background: C.ghost, border: `1px solid ${C.fog}`,
        }}>
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ ...os({ fontSize: 10, color: C.silver, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.5 }) }}>
              Source Dictation
            </Typography>
            <Typography sx={{
              ...os({ fontSize: 12, color: dictationText ? C.charcoal : C.ash }),
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
            }}>
              {dictationText ? dictationText : "No dictation recorded yet — use Clinical Dictation on the Clinical tab."}
            </Typography>
          </Box>
          <Box
            component="button"
            type="button"
            onClick={() => handleAnalyzeDictation(dictationText)}
            disabled={extracting || !dictationText?.trim()}
            sx={{ ...actionButton, minWidth: 140, flexShrink: 0 }}
          >
            {extracting ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {extracting ? "Analyzing..." : "Re-extract"}
          </Box>
        </Box>
      </Box>

      {/* Manual / additional exam dictation — for joint-exam-specific findings not captured
          in the general clinical dictation (e.g. dictated during the physical exam itself) */}
      <Box sx={{ px: 3, pt: 2 }}>
        <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 0.75 }) }}>
          Additional Exam Dictation (optional)
        </Typography>
        <textarea
          placeholder="Dictate exam findings — e.g. 'bilateral wrists and MCPs tender and swollen, left knee swollen, Achilles insertion tender on the right'..."
          value={manualDictation}
          onChange={(e) => setManualDictation(e.target.value)}
          style={{ ...inputSx, minHeight: 80, resize: "vertical" }}
        />
        <Box sx={{ display: "flex", justifyContent: "flex-end", mt: 1.5 }}>
          <Box component="button" type="button" onClick={() => handleAnalyzeDictation(manualDictation)} disabled={extracting || !manualDictation.trim()} sx={{ ...actionButton, minWidth: 200 }}>
            {extracting ? <RefreshRounded sx={{ fontSize: 15, animation: "spin 1s linear infinite" }} /> : <AutoAwesomeRounded sx={{ fontSize: 15 }} />}
            {extracting ? "Analyzing..." : "Analyze Dictation"}
          </Box>
        </Box>
      </Box>

      {/* Anatomical image + joint overlay */}
      <Box sx={{ p: 3, display: "flex", gap: 3, flexWrap: "wrap" }}>
        <Box sx={{ flex: "0 0 auto" }}>
          <Box
            sx={{ position: "relative", width: 300, height: 520, overflow: "hidden", background: "#ffffff" }}
            onClick={(e) => {
              if (!CALIBRATION_MODE) return;
              const rect = e.currentTarget.getBoundingClientRect();
              const xPct = ((e.clientX - rect.left) / rect.width) * 100;
              const yPct = ((e.clientY - rect.top) / rect.height) * 100;
              console.log(`xPct: ${xPct.toFixed(1)}, yPct: ${yPct.toFixed(1)}`);
            }}
          >
            <Box component="img" src={skeletonImage} alt="Anatomical reference"
              sx={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
            />
            {!CALIBRATION_MODE && JOINTS.map((j) => {
              const status = jointMap.joints[j.id] || "none";
              const size = hoveredJoint === j.id ? 18 : 14;
              return (
                <Box
                  key={j.id}
                  onClick={(e) => { e.stopPropagation(); cycleJoint(j.id); }}
                  onMouseEnter={() => setHoveredJoint(j.id)}
                  onMouseLeave={() => setHoveredJoint(null)}
                  sx={{
                    position: "absolute", left: `${j.xPct}%`, top: `${j.yPct}%`,
                    width: size, height: size, borderRadius: "50%", transform: "translate(-50%, -50%)",
                    background: STATUS_COLOR[status], border: `${status === "none" ? 1 : 1.5}px solid ${C.ink}`,
                    cursor: "pointer", transition: "width 0.1s, height 0.1s", zIndex: 2,
                  }}
                />
              );
            })}
          </Box>
          {hoveredJoint && (
            <Typography sx={{ ...os({ fontSize: 11, color: C.charcoal, textAlign: "center", mt: 1 }) }}>
              {JOINTS.find((j) => j.id === hoveredJoint)?.label} — {STATUS_LABEL[jointMap.joints[hoveredJoint] || "none"]}
            </Typography>
          )}
          {CALIBRATION_MODE && (
            <Typography sx={{ ...os({ fontSize: 10, color: "#d32f2f", mt: 1 }) }}>
              Calibration mode on — click the image, read x/y from the console, paste into JOINTS.
            </Typography>
          )}
        </Box>

        <Box sx={{ flex: "1 1 260px", minWidth: 240 }}>
          <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>Legend — click a joint to cycle</Typography>
          {STATUS_CYCLE.map((s) => (
            <Box key={s} sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.75 }}>
              <Box sx={{ width: 14, height: 14, borderRadius: "50%", background: STATUS_COLOR[s], border: `1px solid ${C.ink}` }} />
              <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal }) }}>{STATUS_LABEL[s]}</Typography>
            </Box>
          ))}
          <Box sx={{ mt: 2, display: "flex", gap: 3 }}>
            <Box>
              <Typography sx={{ ...os({ fontSize: 20, color: C.ink }) }}>{counts.tender}</Typography>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Tender Joint Count</Typography>
            </Box>
            <Box>
              <Typography sx={{ ...os({ fontSize: 20, color: C.ink }) }}>{counts.swollen}</Typography>
              <Typography sx={{ ...os({ fontSize: 10, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em" }) }}>Swollen Joint Count</Typography>
            </Box>
          </Box>
          <Typography sx={{ ...os({ fontSize: 10, color: C.silver, mt: 1 }) }}>
            (28-joint count — feeds DAS28 in a future module)
          </Typography>
        </Box>
      </Box>

      {/* Additional fields */}
      <Box sx={{ px: 3, pb: 1 }}>
        <Field label="Enthesitis Sites">
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
            {ENTHESITIS_SITES.map((site) => {
              const active = jointMap.enthesitis_sites.includes(site);
              return (
                <Chip
                  key={site}
                  label={site}
                  onClick={() => toggleEnthesitis(site)}
                  size="small"
                  sx={{
                    fontSize: 11, borderRadius: "2px", cursor: "pointer",
                    background: active ? C.black : C.ghost,
                    color: active ? C.white : C.charcoal,
                    border: `1px solid ${active ? C.black : C.mist}`,
                  }}
                />
              );
            })}
          </Box>
        </Field>

        <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 2, columnGap: 3 }}>
          <Field label="Dactylitis Digits">
            <input
              style={inputSx}
              placeholder="Comma-separated, e.g. right 3rd finger, left 2nd toe"
              value={jointMap.dactylitis_digits.join(", ")}
              onChange={(e) => updateField("dactylitis_digits", e.target.value.split(",").map((s) => s.trim()).filter(Boolean))}
            />
          </Field>
          <Field label="Axial Involvement">
            <select style={inputSx} value={jointMap.axial_involvement} onChange={(e) => updateField("axial_involvement", e.target.value)}>
              <option value="">—</option>
              {AXIAL_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
          </Field>

          <Box sx={{ gridColumn: { md: "1 / -1" } }}>
            <Field label="Range-of-Motion Limitation">
              <input style={inputSx} value={jointMap.rom_limitation} onChange={(e) => updateField("rom_limitation", e.target.value)} />
            </Field>
          </Box>

          <Field label={`Pain Severity — ${jointMap.pain_severity === "" ? "not set" : jointMap.pain_severity}`}>
            <input type="range" min={0} max={10} value={jointMap.pain_severity === "" ? 0 : jointMap.pain_severity} onChange={(e) => updateField("pain_severity", Number(e.target.value))} style={{ width: "100%" }} />
          </Field>
          <Field label="Functional Impact">
            <input style={inputSx} value={jointMap.functional_impact} onChange={(e) => updateField("functional_impact", e.target.value)} />
          </Field>
        </Box>
      </Box>

      {/* Footer */}
      <Box sx={{ px: 3, py: 2, borderTop: `1px solid ${C.fog}`, background: C.ghost, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 1.5 }}>
        {saveMsg && <Typography sx={{ ...os({ fontSize: 12, color: saveMsg.includes("✅") ? "#2e7d32" : "#d32f2f" }) }}>{saveMsg}</Typography>}
        <Box component="button" type="button" onClick={handleSave} disabled={saving} sx={{ ...actionButton, minWidth: 160 }}>
          <SaveRounded sx={{ fontSize: 15 }} /> {saving ? "Saving..." : "Save Joint Map"}
        </Box>
      </Box>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </Box>
  );
}