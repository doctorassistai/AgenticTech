// tabs/CaseRegistryTab.jsx — Case Registry / Accessioning
//
// First tab of the Onco-Pathology workflow. Creates or updates a pathology
// case: case information, patient demographics, and clinical indication.
// Supports referral-PDF upload + AI extraction and visit-summary generation.
//
// Ported from templates/pathology_pp.html #case-registry (loadCaseInformation,
// generateOverallSummary, referral upload, extractFromReferral, save-case-register).

import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
} from "@mui/material";
import {
  SaveRounded, UploadFileRounded, AutoAwesomeRounded, DescriptionRounded,
  CheckCircleRounded, CloseRounded,
} from "@mui/icons-material";
import {
  C, FONT, FW_LIGHT, FW_NORMAL, inputSx, saveBtnSx, outlineBtnSx,
} from "../../surgical-oncology/shared/designTokens";
import { SectionBox, FG, FieldLabel, Sel } from "../../surgical-oncology/shared/FormComponents";
import { DEPARTMENTS, SEX_OPTIONS } from "../constants";
import {
  getAccessionId, getPatientInfo, getVisitSummary,
  uploadDocument, processReferralLetters,
} from "../shared/api";

const EMPTY = {
  accession_id: "",
  date_received: "",
  ordering_clinician: "",
  department: "",
  patient_name: "",
  mrn: "",
  dob: "",
  sex: "",
  clinical_indication: "",
};

export default function CaseRegistryTab({
  patientId,
  doctorId,
  doctorName,
  hospitalId,
  caseId,
  initialData,
  onSave,
}) {
  const [f, setF] = useState({ ...EMPTY, ...(initialData || {}) });
  const [isSaving, setIsSaving] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState(null);
  const [notice, setNotice] = useState("");
  const fileInputRef = useRef(null);

  const set = (key) => (val) => setF((prev) => ({ ...prev, [key]: val }));
  const onInput = (key) => (e) => set(key)(e.target.value);

  // ─── Re-merge when the loaded case changes ────────────────────────────────
  useEffect(() => {
    setF({ ...EMPTY, ...(initialData || {}) });
  }, [caseId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Prefill for a NEW case (no case_id yet) ──────────────────────────────
  // Autofill accession ID always; demographics + ordering clinician only when
  // the field is still empty so we never clobber user/loaded values.
  useEffect(() => {
    if (!patientId) return;
    let cancelled = false;

    getAccessionId(patientId)
      .then((r) => {
        if (!cancelled && r?.accession_id) {
          setF((prev) => (prev.accession_id ? prev : { ...prev, accession_id: r.accession_id }));
        }
      })
      .catch((err) => console.error("[CaseRegistryTab] accession id:", err));

    // Only prefill demographics for a brand-new case.
    if (!caseId) {
      getPatientInfo(patientId)
        .then((info) => {
          if (cancelled || !info) return;
          setF((prev) => ({
            ...prev,
            patient_name: prev.patient_name || info.patient_name || "",
            mrn: prev.mrn || info.mrn || "",
            dob: prev.dob || info.dob || "",
            sex: prev.sex || (info.sex || "").toLowerCase(),
            department: prev.department || info.department || "",
            ordering_clinician: prev.ordering_clinician || info.ordering_clinician || doctorName || "",
          }));
        })
        .catch((err) => console.error("[CaseRegistryTab] patient info:", err));
    }

    return () => { cancelled = true; };
  }, [patientId, caseId, doctorName]);

  // ─── Generate clinical indication from the visit summary ──────────────────
  const handleGenerate = useCallback(async () => {
    if (!patientId) return;
    setIsGenerating(true);
    setNotice("");
    try {
      const r = await getVisitSummary(patientId);
      if (r?.overall_summary) {
        set("clinical_indication")(r.overall_summary);
        setNotice("Clinical indication generated from visit summary.");
      } else {
        setNotice("No visit summary available for this patient.");
      }
    } catch (err) {
      console.error("[CaseRegistryTab] generate:", err);
      setNotice("Failed to generate summary.");
    } finally {
      setIsGenerating(false);
    }
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Upload referral PDF ──────────────────────────────────────────────────
  const handleFilePick = () => fileInputRef.current?.click();

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setNotice("");
    try {
      const r = await uploadDocument({
        file, doctorId, patientId, hospitalId, docType: "referral",
      });
      setUploadedFile({ name: file.name, url: r.file_url });
      setNotice("Referral uploaded. Click “Extract from Referral” to auto-fill.");
    } catch (err) {
      console.error("[CaseRegistryTab] upload:", err);
      setNotice("Referral upload failed.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // ─── Extract clinical indication from uploaded referral(s) ────────────────
  const handleExtract = useCallback(async () => {
    if (!patientId) return;
    setIsExtracting(true);
    setNotice("");
    try {
      const r = await processReferralLetters(patientId);
      const first = (r?.results || []).find((x) => x?.llm_output?.overall_summary);
      if (first) {
        set("clinical_indication")(first.llm_output.overall_summary);
        setNotice("Clinical indication extracted from referral.");
      } else {
        setNotice("No referral letters found to extract from. Upload a referral PDF first.");
      }
    } catch (err) {
      console.error("[CaseRegistryTab] extract:", err);
      setNotice("Failed to extract from referral.");
    } finally {
      setIsExtracting(false);
    }
  }, [patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Save / create case ───────────────────────────────────────────────────
  const handleSubmit = async () => {
    setIsSaving(true);
    try {
      await onSave("case-register", { ...f });
    } finally {
      setIsSaving(false);
    }
  };

  const busy = isGenerating || isExtracting || isUploading;

  return (
    <Box sx={{ fontFamily: FONT }}>
      {/* AI panel — referral upload */}
      <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2.5, mb: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
          <AutoAwesomeRounded sx={{ fontSize: 18, color: C.black }} />
          <Typography sx={{ fontSize: 13, fontWeight: FW_NORMAL, fontFamily: FONT, textTransform: "uppercase", letterSpacing: "0.1em" }}>
            AI-Powered Case Creation
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, mb: 1.75 }}>
          Upload a requisition form or referral letter to auto-extract the clinical indication.
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
          <input
            ref={fileInputRef}
            type="file"
            accept="application/pdf"
            style={{ display: "none" }}
            onChange={handleFileChange}
          />
          <Button sx={outlineBtnSx} onClick={handleFilePick} disabled={isUploading}>
            {isUploading
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
              : <UploadFileRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            Upload Referral PDF
          </Button>
          {uploadedFile && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, fontSize: 12, color: C.textSecond, fontFamily: FONT }}>
              <CheckCircleRounded sx={{ fontSize: 15, color: C.black }} />
              <DescriptionRounded sx={{ fontSize: 15 }} />
              {uploadedFile.name}
            </Box>
          )}
        </Box>
      </Box>

      {/* Case Information */}
      <SectionBox title="Case Information">
        <FG cols={2}>
          <Box>
            <FieldLabel>Accession ID</FieldLabel>
            <TextField
              value={f.accession_id}
              size="small"
              fullWidth
              InputProps={{ readOnly: true }}
              placeholder="Auto-generated"
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Date Received</FieldLabel>
            <TextField
              type="datetime-local"
              value={f.date_received}
              onChange={onInput("date_received")}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Ordering Clinician</FieldLabel>
            <TextField
              value={f.ordering_clinician}
              onChange={onInput("ordering_clinician")}
              size="small"
              fullWidth
              placeholder="Referring doctor"
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Department</FieldLabel>
            <Sel
              label="Department"
              options={DEPARTMENTS}
              value={f.department}
              onChange={set("department")}
            />
          </Box>
        </FG>
      </SectionBox>

      {/* Patient Demographics */}
      <SectionBox title="Patient Demographics">
        <FG cols={2}>
          <Box>
            <FieldLabel>Patient Name</FieldLabel>
            <TextField
              value={f.patient_name}
              onChange={onInput("patient_name")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Medical Record Number (MRN)</FieldLabel>
            <TextField
              value={f.mrn}
              onChange={onInput("mrn")}
              size="small"
              fullWidth
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Date of Birth</FieldLabel>
            <TextField
              type="date"
              value={f.dob}
              onChange={onInput("dob")}
              size="small"
              fullWidth
              InputLabelProps={{ shrink: true }}
              sx={inputSx}
            />
          </Box>
          <Box>
            <FieldLabel>Sex</FieldLabel>
            <Sel
              label="Sex"
              options={SEX_OPTIONS}
              value={f.sex}
              onChange={set("sex")}
            />
          </Box>
        </FG>
      </SectionBox>

      {/* Clinical History */}
      <SectionBox title="Clinical History">
        <FieldLabel>Clinical Indication / Provisional Diagnosis</FieldLabel>
        <TextField
          value={f.clinical_indication}
          onChange={onInput("clinical_indication")}
          size="small"
          fullWidth
          multiline
          minRows={4}
          placeholder="Clinical presentation, symptoms, imaging findings..."
          sx={inputSx}
        />
        <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap" }}>
          <Button sx={outlineBtnSx} onClick={handleGenerate} disabled={busy}>
            {isGenerating
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
              : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            Generate
          </Button>
          <Button sx={outlineBtnSx} onClick={handleExtract} disabled={busy}>
            {isExtracting
              ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} />
              : <DescriptionRounded sx={{ mr: 0.75, fontSize: 16 }} />}
            Extract from Referral
          </Button>
        </Box>
      </SectionBox>

      {/* Notice + Save */}
      {notice && (
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, px: 1.5, py: 1, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
          <Typography sx={{ fontSize: 12, color: C.textSecond, fontFamily: FONT, flex: 1 }}>{notice}</Typography>
          <IconButton size="small" onClick={() => setNotice("")} sx={{ color: C.textMuted, p: 0.25 }}>
            <CloseRounded sx={{ fontSize: 15 }} />
          </IconButton>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-start" }}>
        <Button sx={saveBtnSx} onClick={handleSubmit} disabled={isSaving}>
          {isSaving
            ? <CircularProgress size={14} sx={{ mr: 1, color: C.white }} />
            : <SaveRounded sx={{ mr: 0.75, fontSize: 16 }} />}
          {caseId ? "Save Case" : "Create Case & Continue"}
        </Button>
      </Box>
    </Box>
  );
}
