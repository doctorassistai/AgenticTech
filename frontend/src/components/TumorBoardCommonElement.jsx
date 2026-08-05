import React, { useState, useEffect } from "react";
import { Box, Typography, Button, TextField, Radio, RadioGroup, FormControlLabel } from "@mui/material";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

// Basic styling constants matching OPRecord
const C = {
  black: "#000000",
  white: "#ffffff",
  textPrimary: "#000000",
  textMuted: "#888888",
  border: "#e0e0e0",
};

const inputStyle = {
  "& .MuiOutlinedInput-root": {
    borderRadius: 0,
    background: "#fff",
    fontSize: 13,
  },
  "& .MuiOutlinedInput-notchedOutline": {
    borderColor: C.border,
  },
  "& .MuiOutlinedInput-root:hover .MuiOutlinedInput-notchedOutline": {
    borderColor: C.black,
  },
  "& .MuiOutlinedInput-root.Mui-focused .MuiOutlinedInput-notchedOutline": {
    borderColor: C.black,
    borderWidth: 1,
  },
};

const CustomRadio = ({ label, value, checked, onChange }) => (
  <Box
    onClick={() => onChange(value)}
    sx={{
      display: "inline-flex",
      alignItems: "center",
      cursor: "pointer",
      border: `1px solid ${checked ? C.black : C.border}`,
      background: checked ? C.black : C.white,
      px: 1.5,
      py: 0.5,
      transition: "all 0.2s",
      "&:hover": { borderColor: C.black },
    }}
  >
    <Typography sx={{ fontSize: 13, color: checked ? C.white : C.textPrimary, userSelect: "none" }}>
      {label}
    </Typography>
  </Box>
);

const FieldRow = ({ label, children }) => (
  <Box sx={{ display: "flex", borderBottom: `1px solid ${C.border}`, minHeight: 40, alignItems: "stretch" }}>
    <Box sx={{ width: "35%", p: 1.5, display: "flex", alignItems: "center" }}>
      <Typography sx={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{label}</Typography>
    </Box>
    <Box sx={{ flex: 1, p: 1.5, display: "flex", alignItems: "center" }}>
      {children}
    </Box>
  </Box>
);

export default function TumorBoardCommonElement({
  patientId,
  doctorId,
  planData,
  tbFollowed,
  onTbFollowedChange,
  tbNotFollowedReason,
  onTbNotFollowedReasonChange,
  assignTb,
  onAssignTbChange,
  scheduleDate,
  onScheduleDateChange,
  question,
  onQuestionChange,
  hideSaveButton = false,
  onSaveData
}) {
  // Use controlled props if provided, otherwise fallback to local state
  const [localAssignTb, setLocalAssignTb] = useState("no");
  const [localScheduleDate, setLocalScheduleDate] = useState("");
  const [localQuestion, setLocalQuestion] = useState("");

  const [localTbFollowed, setLocalTbFollowed] = useState("yes");
  const [localTbNotFollowedReason, setLocalTbNotFollowedReason] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(null);

  const [localSaving, setLocalSaving] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);

  const [fetchedPlanData, setFetchedPlanData] = useState(null);

  useEffect(() => {
    if (planData === undefined && patientId) {
      fetch(`${API_BASE_URL}hms/users/data/context/get-tumor-board-plan?patientId=${patientId}`)
        .then(res => res.json())
        .then(res => {
          if (res?.status === "success" && res?.data) {
            setFetchedPlanData(res.data);
          }
        })
        .catch(err => console.error("Failed to fetch tumor board plan:", err));
    }
  }, [patientId, planData]);

  const activePlanData = planData !== undefined ? planData : fetchedPlanData;

  const isAssignTb = assignTb !== undefined ? assignTb : localAssignTb;
  const isScheduleDate = scheduleDate !== undefined ? scheduleDate : localScheduleDate;
  const isQuestion = question !== undefined ? question : localQuestion;
  const isTbFollowed = tbFollowed !== undefined ? tbFollowed : localTbFollowed;
  const isTbNotFollowedReason = tbNotFollowedReason !== undefined ? tbNotFollowedReason : localTbNotFollowedReason;

  const handleAssignTbChange = (val) => onAssignTbChange ? onAssignTbChange(val) : setLocalAssignTb(val);
  const handleScheduleDateChange = (val) => onScheduleDateChange ? onScheduleDateChange(val) : setLocalScheduleDate(val);
  const handleQuestionChange = (val) => onQuestionChange ? onQuestionChange(val) : setLocalQuestion(val);
  const handleTbFollowedChange = (val) => onTbFollowedChange ? onTbFollowedChange(val) : setLocalTbFollowed(val);
  const handleTbNotFollowedReasonChange = (val) => onTbNotFollowedReasonChange ? onTbNotFollowedReasonChange(val) : setLocalTbNotFollowedReason(val);

  const handleSave = async () => {
    if (isAssignTb !== "yes") return;
    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}hms/users/data/context/tumor-board/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          schedule_date: isScheduleDate,
          question: isQuestion,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to assign patient to tumor board");
      }

      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLocalSave = async () => {
    if (!onSaveData) return;
    setLocalSaving(true);
    setLocalSaved(false);
    try {
      await onSaveData();
      setLocalSaved(true);
      setTimeout(() => setLocalSaved(false), 3000);
    } catch (err) {
      console.error(err);
    } finally {
      setLocalSaving(false);
    }
  };

  return (
    <Box sx={{ border: `1px solid ${C.border}`, mb: 3 }}>
      {/* Plan Data Display */}
      {activePlanData ? (
        <Box sx={{ p: 2, display: "flex", flexDirection: "column", gap: 2, borderBottom: `1px solid ${C.border}` }}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
            <Box>
              <Typography sx={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" }}>Primary Diagnosis</Typography>
              <Typography sx={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{activePlanData.care_pathway_plan?.primary_diagnosis || "N/A"}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" }}>Cancer Stage</Typography>
              <Typography sx={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{activePlanData.care_pathway_plan?.cancer_stage || "N/A"}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" }}>Treatment Intent</Typography>
              <Typography sx={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{activePlanData.care_pathway_plan?.overall_treatment_intent || "N/A"}</Typography>
            </Box>
            <Box>
              <Typography sx={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" }}>Status</Typography>
              <Typography sx={{ fontSize: 13, color: C.textPrimary, fontWeight: 500 }}>{activePlanData.status || "N/A"}</Typography>
            </Box>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" }}>MDT Basis Summary</Typography>
            <Typography sx={{ fontSize: 13, color: C.textPrimary }}>{activePlanData.care_pathway_plan?.mdt_basis_summary || "N/A"}</Typography>
          </Box>

          <Box>
            <Typography sx={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase" }}>Sequence Rationale</Typography>
            <Typography sx={{ fontSize: 13, color: C.textPrimary }}>{activePlanData.care_pathway_plan?.sequence_rationale || "N/A"}</Typography>
          </Box>

          {activePlanData.care_pathway_plan?.safety_flags?.length > 0 && (
            <Box>
              <Typography sx={{ fontSize: 11, color: "red", textTransform: "uppercase" }}>Safety Flags</Typography>
              <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: C.textPrimary }}>
                {activePlanData.care_pathway_plan.safety_flags.map((flag, idx) => (
                  <li key={idx}>{flag}</li>
                ))}
              </ul>
            </Box>
          )}

          {activePlanData.care_pathway_plan?.steps?.length > 0 && (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontSize: 11, color: C.textMuted, textTransform: "uppercase", mb: 1 }}>Pathway Steps</Typography>
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                {activePlanData.care_pathway_plan.steps.map(step => (
                  <Box key={step.step_number} sx={{ p: 1.5, border: `1px solid ${C.border}`, borderRadius: 1, bgcolor: "#fafafa" }}>
                    <Typography sx={{ fontSize: 12, fontWeight: "bold" }}>Step {step.step_number}: {step.phase_name} ({step.status})</Typography>
                    <Typography sx={{ fontSize: 12, mt: 0.5 }}><b>Treatment:</b> {step.treatment_type}</Typography>
                    <Typography sx={{ fontSize: 12 }}><b>Duration:</b> {step.estimated_duration} | <b>Timing:</b> {step.timing_rules}</Typography>
                    <Typography sx={{ fontSize: 12 }}><b>Rationale:</b> {step.rationale}</Typography>
                    {step.status_reason && <Typography sx={{ fontSize: 12 }}><b>Status Reason:</b> {step.status_reason}</Typography>}
                  </Box>
                ))}
              </Box>
            </Box>
          )}
        </Box>
      ) : (
        <Box sx={{ p: 2, borderBottom: `1px solid ${C.border}` }}>
          <Typography sx={{ fontSize: 13, color: C.textMuted }}>No Tumor Board Plan data available.</Typography>
        </Box>
      )}

      {/* Past Decision Followed */}
      <FieldRow label="Past Tumor Board Decision Followed">
        <Box sx={{ display: "flex", gap: 1 }}>
          <CustomRadio label="Yes" value="yes" checked={isTbFollowed === "yes"} onChange={handleTbFollowedChange} />
          <CustomRadio label="No" value="no" checked={isTbFollowed === "no"} onChange={handleTbFollowedChange} />
        </Box>
      </FieldRow>
      {isTbFollowed === "no" && (
        <FieldRow label="If No, Reason">
          <TextField fullWidth multiline rows={2} sx={inputStyle} placeholder="Enter reason" value={isTbNotFollowedReason} onChange={e => handleTbNotFollowedReasonChange(e.target.value)} />
        </FieldRow>
      )}

      <FieldRow label="Assign Patient to Tumor Board">
        <Box sx={{ display: "flex", gap: 1 }}>
          <CustomRadio label="Yes" value="yes" checked={isAssignTb === "yes"} onChange={handleAssignTbChange} />
          <CustomRadio label="No" value="no" checked={isAssignTb === "no"} onChange={handleAssignTbChange} />
        </Box>
      </FieldRow>

      {isAssignTb === "yes" && (
        <>
          <FieldRow label="Schedule Date">
            <TextField
              type="date"
              fullWidth
              size="small"
              sx={inputStyle}
              value={isScheduleDate}
              onChange={(e) => handleScheduleDateChange(e.target.value)}
            />
          </FieldRow>
          <FieldRow label="Question for Tumor Board Discussion">
            <TextField
              fullWidth
              multiline
              rows={3}
              sx={inputStyle}
              placeholder="Mention reason and question for tumor board discussion"
              value={isQuestion}
              onChange={(e) => handleQuestionChange(e.target.value)}
            />
          </FieldRow>

          {!hideSaveButton && (
            <Box sx={{ p: 1.5, display: "flex", justifyContent: "flex-end", borderTop: `1px solid ${C.border}` }}>
              {error && <Typography sx={{ color: "red", fontSize: 12, mr: 2, alignSelf: "center" }}>{error}</Typography>}
              {saved && <Typography sx={{ color: "green", fontSize: 12, mr: 2, alignSelf: "center" }}>Assigned Successfully!</Typography>}
              <Button
                variant="contained"
                onClick={handleSave}
                disabled={saving}
                sx={{
                  bgcolor: C.black,
                  color: C.white,
                  textTransform: "none",
                  fontSize: 13,
                  "&:hover": { bgcolor: "#333" },
                }}
              >
                {saving ? "Saving..." : "Assign to Tumor Board"}
              </Button>
            </Box>
          )}
        </>
      )}
      
      {onSaveData && (
        <Box sx={{ p: 1.5, display: "flex", justifyContent: "flex-end", alignItems: "center", borderTop: `1px solid ${C.border}` }}>
          {localSaved && <Typography sx={{ color: "green", fontSize: 12, mr: 2 }}>Saved Successfully!</Typography>}
          <Button
            variant="contained"
            onClick={handleLocalSave}
            disabled={localSaving}
            sx={{
              bgcolor: C.black,
              color: C.white,
              textTransform: "none",
              fontSize: 13,
              "&:hover": { bgcolor: "#333" },
            }}
          >
            {localSaving ? "Saving..." : "Save Tumor Board Details"}
          </Button>
        </Box>
      )}
    </Box>
  );
}
