import React, { useState, useEffect } from "react";
import {
  Box, Typography, TextField, Select, MenuItem, FormControl, InputLabel,
  Checkbox, FormControlLabel, Button, Snackbar, Alert,
} from "@mui/material";
import { SaveRounded } from "@mui/icons-material";
import {
  C, FONT, FW_NORMAL, FW_BOLD, inputSx, fieldLabelSx, saveBtnSx, outlineBtnSx,
} from "./surgical-oncology/shared/designTokens";
import { SectionBox, FG, ROInput, StatusBadge } from "./surgical-oncology/shared/FormComponents";
import { getPatientInfo, getDoctorsByHospital, request, CONTEXT_BASE } from "./shared/api";

// ─── Referral Tab API Calls ──────────────────────────────────────────────────
const createReferral = (payload) => {
  return request(`${CONTEXT_BASE}/nurse_note/referral/create`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
};

const getReferrals = (patientId, doctorId) => {
  return request(`${CONTEXT_BASE}/nurse_note/referral/${patientId}/${doctorId}`);
};

// PATIENT REFERRALS TAB
// ─────────────────────────────────────────────────────────────────────────────
const PatientReferralsTab = ({ patientId, doctorId, doctorName, hospitalId }) => {
  const [doctorsList, setDoctorsList] = useState([]);
  const [specializations, setSpecializations] = useState([]);
  const [selectedSpec, setSelectedSpec] = useState("");
  const [filteredDoctors, setFilteredDoctors] = useState([]);
  const [referralsList, setReferralsList] = useState([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isOutsideDoctor, setIsOutsideDoctor] = useState(false);
  const [snack, setSnack] = useState({ open: false, message: "", severity: "success" });

  const [f, setF] = useState({
    patient_id: patientId || "",
    patient_name: "",
    doctor_id: doctorId || "",
    hospital_id: hospitalId || "",
    from_doctor_id: doctorId || "",
    from_doctor_name: doctorName || "",
    from_doctor_speciality: "Surgical Oncology",
    to_doctor_id: "",
    to_doctor_name: "",
    to_doctor_hospital: "",
    to_doctor_speciality: "",
    reason_for_referral: "",
    additional_notes: "",
    referred_by_nurse: "",
    nurse_signed: false,
    date: new Date().toISOString().split("T")[0],
  });

  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const QUICK_REASONS = [
    "Post-operative specialized care",
    "Cardiology evaluation & pre-op fitness",
    "Nephrology consultation for elevated creatinine",
    "Oncology Multi-Disciplinary Team (MDT) review",
    "Histopathology / Biopsy second opinion",
    "Pain & Palliative Management",
  ];

  // Auto-populate patient details
  useEffect(() => {
    if (patientId) {
      getPatientInfo(patientId)
        .then(info => {
          setF(p => ({
            ...p,
            patient_id: patientId,
            patient_name: info?.patient_name || info?.name || p.patient_name,
          }));
        })
        .catch(err => console.error("[PatientReferralsTab] patient info error:", err));
    }
  }, [patientId]);

  useEffect(() => {
    if (doctorId) {
      setF(p => ({
        ...p,
        doctor_id: doctorId,
        from_doctor_id: doctorId,
        from_doctor_name: doctorName || p.from_doctor_name,
      }));
    }
  }, [doctorId, doctorName]);

  // Load hospital doctors & derive specializations
  useEffect(() => {
    if (!hospitalId) return;
    getDoctorsByHospital(hospitalId)
      .then(res => {
        if (Array.isArray(res)) {
          setDoctorsList(res);
          const specs = Array.from(new Set(res.map(d => d.specialization).filter(Boolean)));
          setSpecializations(specs);
        }
      })
      .catch(err => console.error("[PatientReferralsTab] hospital doctors fetch error:", err));
  }, [hospitalId]);

  // Load existing referrals for patient
  const fetchReferrals = () => {
    if (!patientId || !doctorId) return;
    setLoading(true);
    getReferrals(patientId, doctorId)
      .then(res => {
        if (res?.referrals) {
          setReferralsList(res.referrals);
        }
      })
      .catch(err => console.error("[PatientReferralsTab] referrals fetch error:", err))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchReferrals();
  }, [patientId, doctorId]);

  // Filter doctors by specialization selection
  const handleSpecSelect = (spec) => {
    setSelectedSpec(spec);
    set("to_doctor_speciality", spec);
    set("to_doctor_id", "");
    set("to_doctor_name", "");
    if (spec) {
      const filtered = doctorsList.filter(d => d.specialization === spec);
      setFilteredDoctors(filtered);
    } else {
      setFilteredDoctors(doctorsList);
    }
  };

  const handleDoctorSelect = (docId) => {
    const doc = doctorsList.find(d => (d.sys_user_id || d.id || d.doctor_id) === docId);
    if (doc) {
      setF(p => ({
        ...p,
        to_doctor_id: doc.sys_user_id || doc.id || doc.doctor_id || docId,
        to_doctor_name: doc.name || doc.doctor_name || "",
        to_doctor_speciality: doc.specialization || p.to_doctor_speciality,
        to_doctor_hospital: doc.hospital_name || p.to_doctor_hospital || "Main Hospital",
      }));
    } else {
      set("to_doctor_id", docId);
    }
  };

  const handleSubmit = async () => {
    if (!f.to_doctor_name) {
      setSnack({ open: true, message: "Please select or type target doctor's name.", severity: "error" });
      return;
    }
    if (!f.reason_for_referral) {
      setSnack({ open: true, message: "Please enter the reason for referral.", severity: "error" });
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...f,
        hospital_id: hospitalId || f.hospital_id,
        reason: f.reason_for_referral,
      };
      await createReferral(payload);
      setSnack({ open: true, message: "Referral submitted successfully!", severity: "success" });

      // Reset form
      setF(p => ({
        ...p,
        to_doctor_id: "",
        to_doctor_name: "",
        to_doctor_hospital: "",
        to_doctor_speciality: "",
        reason_for_referral: "",
        additional_notes: "",
        referred_by_nurse: "",
        nurse_signed: false,
        reason: "",
      }));
      setSelectedSpec("");
      setIsOutsideDoctor(false);
      fetchReferrals();
    } catch (err) {
      console.error("[PatientReferralsTab] submit error:", err);
      setSnack({ open: true, message: "Failed to submit referral. Please try again.", severity: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Box sx={{ fontFamily: FONT }}>
      {/* Overview & Quick Info Banner */}
      <SectionBox title="Patient Referral Management">
        <FG cols={3}>
          <ROInput label="Patient ID" value={f.patient_id} />
          <ROInput label="Patient Name" value={f.patient_name || "-"} />
          <ROInput label="Referring Doctor (From)" value={f.from_doctor_name || "-"} />
        </FG>
      </SectionBox>

      {/* Main Grid: Left Panel (Specialization Chips & Referral History) | Right Panel (Referral Form) */}
      <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "340px 1fr" }, gap: 2.5, mt: 2 }}>

        {/* Left Side: Specialization Filters & Past Referrals */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>

          {/* Hospital Specializations Chips / Quick Fill Buttons */}
          <Box sx={{ background: C.white, p: 2, border: `1px solid ${C.border}`, borderRadius: 1 }}>
            <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, fontFamily: FONT, mb: 1, textTransform: "uppercase", color: C.textPrimary }}>
              Hospital Specializations
            </Typography>
            <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mb: 1.5 }}>
              Click a specialization button to filter doctors:
            </Typography>

            <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
              <Button
                size="small"
                variant={selectedSpec === "" ? "contained" : "outlined"}
                onClick={() => handleSpecSelect("")}
                sx={{
                  fontSize: 11, fontFamily: FONT, textTransform: "none", py: 0.3, px: 1,
                  background: selectedSpec === "" ? C.black : "transparent",
                  color: selectedSpec === "" ? C.white : C.textSecond,
                  borderColor: C.border,
                  "&:hover": { background: selectedSpec === "" ? "#222" : C.bgSecondary }
                }}
              >
                All Specializations
              </Button>
              {specializations.map(spec => (
                <Button
                  key={spec}
                  size="small"
                  variant={selectedSpec === spec ? "contained" : "outlined"}
                  onClick={() => handleSpecSelect(spec)}
                  sx={{
                    fontSize: 11, fontFamily: FONT, textTransform: "none", py: 0.3, px: 1,
                    background: selectedSpec === spec ? C.black : "transparent",
                    color: selectedSpec === spec ? C.white : C.textSecond,
                    borderColor: C.border,
                    "&:hover": { background: selectedSpec === spec ? "#222" : C.bgSecondary }
                  }}
                >
                  {spec}
                </Button>
              ))}
              {specializations.length === 0 && (
                <Typography sx={{ fontSize: 11, color: C.textMuted, fontStyle: "italic" }}>
                  No hospital specializations retrieved.
                </Typography>
              )}
            </Box>

            {/* Switch for Outside Referral */}
            <Box sx={{ mt: 2, pt: 1.5, borderTop: `1px dashed ${C.border}` }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={isOutsideDoctor}
                    onChange={e => {
                      setIsOutsideDoctor(e.target.checked);
                      if (e.target.checked) {
                        set("to_doctor_id", "");
                        set("to_doctor_name", "");
                        set("to_doctor_hospital", "");
                      }
                    }}
                    size="small"
                  />
                }
                label={
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, fontWeight: FW_NORMAL }}>
                    Refer to Outside Hospital / Doctor
                  </Typography>
                }
              />
            </Box>
          </Box>

          {/* Referral History Card */}
          <Box sx={{ background: C.white, p: 2, border: `1px solid ${C.border}`, borderRadius: 1, flex: 1 }}>
            <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: 1.5 }}>
              <Typography sx={{ fontSize: 13, fontWeight: FW_BOLD, fontFamily: FONT, textTransform: "uppercase", color: C.textPrimary }}>
                Referral History ({referralsList.length})
              </Typography>
              <Button size="small" onClick={fetchReferrals} sx={{ fontSize: 10, textTransform: "none", color: C.textMuted }}>
                Refresh
              </Button>
            </Box>

            {loading ? (
              <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, fontStyle: "italic" }}>
                Loading referral history...
              </Typography>
            ) : referralsList.length === 0 ? (
              <Box sx={{ p: 2, textAlign: "center", background: C.bgSecondary, border: `1px dashed ${C.border}` }}>
                <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
                  No referrals logged for this patient yet.
                </Typography>
              </Box>
            ) : (
              <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, maxHeight: 420, overflowY: "auto", pr: 0.5 }}>
                {referralsList.map((ref, idx) => (
                  <Box key={ref._id || idx} sx={{ p: 1.5, border: `1px solid ${C.border}`, background: C.bgSecondary, borderRadius: 1 }}>
                    <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.5 }}>
                      <Typography sx={{ fontSize: 11, fontWeight: FW_BOLD, fontFamily: FONT, color: C.textPrimary }}>
                        To: {ref.to_doctor_name || "Doctor"} ({ref.to_doctor_speciality || "General"})
                      </Typography>
                      <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>
                        {ref.date || ref.created_at?.split("T")[0] || "Recent"}
                      </Typography>
                    </Box>
                    {ref.to_doctor_hospital && (
                      <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT, mb: 0.5 }}>
                        Hospital: {ref.to_doctor_hospital}
                      </Typography>
                    )}
                    <Typography sx={{ fontSize: 11, color: C.textSecond, fontFamily: FONT, mb: 0.5 }}>
                      <strong>Reason:</strong> {ref.reason_for_referral || ref.reason || "-"}
                    </Typography>
                    {ref.additional_notes && (
                      <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT, fontStyle: "italic", mb: 0.5 }}>
                        Notes: {ref.additional_notes}
                      </Typography>
                    )}
                    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mt: 1, pt: 0.5, borderTop: `1px solid ${C.border}` }}>
                      <Typography sx={{ fontSize: 10, color: C.textMuted, fontFamily: FONT }}>
                        Nurse: {ref.referred_by_nurse || "Assigned Nurse"}
                      </Typography>
                      <StatusBadge status={ref.nurse_signed ? "Signed" : "Pending Signature"} />
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>
        </Box>

        {/* Right Side: Create Referral Form */}
        <Box sx={{ background: C.white, p: 2.5, border: `1px solid ${C.border}`, borderRadius: 1 }}>
          <Typography sx={{ fontSize: 14, fontWeight: FW_BOLD, fontFamily: FONT, mb: 2, textTransform: "uppercase", color: C.textPrimary }}>
            Initiate New Referral Letter
          </Typography>

          <SectionBox title="Target Specialist Information">
            {!isOutsideDoctor ? (
              <FG cols={2}>
                <FormControl size="small" fullWidth sx={inputSx}>
                  <InputLabel shrink sx={fieldLabelSx}>Specialization</InputLabel>
                  <Select
                    value={selectedSpec}
                    onChange={e => handleSpecSelect(e.target.value)}
                    displayEmpty
                    notched
                    label="Specialization"
                  >
                    <MenuItem value="" sx={{ fontFamily: FONT, fontSize: 13 }}>
                      <em>Select Specialization</em>
                    </MenuItem>
                    {specializations.map(s => (
                      <MenuItem key={s} value={s} sx={{ fontFamily: FONT, fontSize: 13 }}>{s}</MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <FormControl size="small" fullWidth sx={inputSx}>
                  <InputLabel shrink sx={fieldLabelSx}>Select Doctor *</InputLabel>
                  <Select
                    value={f.to_doctor_id}
                    onChange={e => handleDoctorSelect(e.target.value)}
                    displayEmpty
                    notched
                    label="Select Doctor *"
                  >
                    <MenuItem value="" sx={{ fontFamily: FONT, fontSize: 13 }}>
                      <em>Select Doctor</em>
                    </MenuItem>
                    {(selectedSpec ? filteredDoctors : doctorsList).map(doc => (
                      <MenuItem key={doc.sys_user_id || doc.id || doc.doctor_id} value={doc.sys_user_id || doc.id || doc.doctor_id} sx={{ fontFamily: FONT, fontSize: 13 }}>
                        {doc.name || doc.doctor_name} ({doc.specialization || "General"})
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>

                <TextField
                  label="Target Doctor Name"
                  value={f.to_doctor_name}
                  onChange={e => set("to_doctor_name", e.target.value)}
                  size="small"
                  sx={inputSx}
                  fullWidth
                  placeholder="Doctor Name"
                />

                <TextField
                  label="Hospital Name"
                  value={f.to_doctor_hospital}
                  onChange={e => set("to_doctor_hospital", e.target.value)}
                  size="small"
                  sx={inputSx}
                  fullWidth
                  placeholder="Hospital Name"
                />
              </FG>
            ) : (
              <FG cols={2}>
                <TextField
                  label="Target Doctor Name *"
                  value={f.to_doctor_name}
                  onChange={e => set("to_doctor_name", e.target.value)}
                  size="small"
                  sx={inputSx}
                  fullWidth
                  placeholder="e.g. Dr. Robert Vance"
                />
                <TextField
                  label="Specialization"
                  value={f.to_doctor_speciality}
                  onChange={e => set("to_doctor_speciality", e.target.value)}
                  size="small"
                  sx={inputSx}
                  fullWidth
                  placeholder="e.g. Surgical Gastroenterology"
                />
                <TextField
                  label="Outside Hospital Name"
                  value={f.to_doctor_hospital}
                  onChange={e => set("to_doctor_hospital", e.target.value)}
                  size="small"
                  sx={{ ...inputSx, gridColumn: "1/-1" }}
                  fullWidth
                  placeholder="e.g. Apollo Cancer Institute, Chennai"
                />
              </FG>
            )}
          </SectionBox>

          <SectionBox title="Referral Details & Clinical Context">
            <Box sx={{ mb: 2 }}>
              <TextField
                label="Reason for Referral *"
                value={f.reason_for_referral}
                onChange={e => set("reason_for_referral", e.target.value)}
                size="small"
                multiline
                rows={3}
                sx={inputSx}
                fullWidth
                placeholder="State the clinical diagnosis, purpose of referral, and requested intervention/opinion..."
              />

              {/* Quick Fill Preset Buttons */}
              <Box sx={{ mt: 1 }}>
                <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mb: 0.5 }}>
                  Quick Fill Reason Suggestions:
                </Typography>
                <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                  {QUICK_REASONS.map(r => (
                    <Button
                      key={r}
                      size="small"
                      variant="outlined"
                      onClick={() => set("reason_for_referral", f.reason_for_referral ? `${f.reason_for_referral}; ${r}` : r)}
                      sx={{
                        fontSize: 10, fontFamily: FONT, textTransform: "none", py: 0.2, px: 0.8,
                        borderColor: C.border, color: C.textSecond,
                        "&:hover": { background: C.bgSecondary }
                      }}
                    >
                      + {r}
                    </Button>
                  ))}
                </Box>
              </Box>
            </Box>

            <TextField
              label="Additional Notes / Clinical History Summary"
              value={f.additional_notes}
              onChange={e => set("additional_notes", e.target.value)}
              size="small"
              multiline
              rows={3}
              sx={inputSx}
              fullWidth
              placeholder="Include pertinent investigations, vitals, allergies, or urgent instructions..."
            />
          </SectionBox>

          <SectionBox title="Nurse Sign-off & Verification">
            <FG cols={2}>
              <TextField
                label="Referred By Nurse (Name / ID)"
                value={f.referred_by_nurse}
                onChange={e => set("referred_by_nurse", e.target.value)}
                size="small"
                sx={inputSx}
                fullWidth
                placeholder="Enter Nurse Name or Staff ID"
              />
              <TextField
                label="Date of Referral"
                type="date"
                value={f.date}
                onChange={e => set("date", e.target.value)}
                size="small"
                sx={inputSx}
                fullWidth
                InputLabelProps={{ shrink: true }}
              />
            </FG>
            <Box sx={{ mt: 1.5 }}>
              <FormControlLabel
                control={
                  <Checkbox
                    checked={f.nurse_signed}
                    onChange={e => set("nurse_signed", e.target.checked)}
                    size="small"
                  />
                }
                label={
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, fontWeight: FW_BOLD }}>
                    Nurse Verification Signed & Validated
                  </Typography>
                }
              />
            </Box>
          </SectionBox>

          {/* Action Buttons */}
          <Box sx={{ display: "flex", gap: 1.5, mt: 3 }}>
            <Button
              sx={{ ...saveBtnSx, minWidth: 160 }}
              disabled={submitting}
              onClick={handleSubmit}
            >
              <SaveRounded sx={{ mr: 0.5, fontSize: 14 }} />
              {submitting ? "Submitting..." : "Submit Referral Letter"}
            </Button>

            <Button
              sx={outlineBtnSx}
              onClick={() => {
                setF(p => ({
                  ...p,
                  to_doctor_id: "",
                  to_doctor_name: "",
                  to_doctor_hospital: "",
                  to_doctor_speciality: "",
                  reason_for_referral: "",
                  additional_notes: "",
                  referred_by_nurse: "",
                  nurse_signed: false,
                  reason: "",
                }));
                setSelectedSpec("");
                setIsOutsideDoctor(false);
              }}
            >
              Reset Form
            </Button>
          </Box>
        </Box>
      </Box>

      <Snackbar
        open={snack.open}
        autoHideDuration={4000}
        onClose={() => setSnack(p => ({ ...p, open: false }))}
        anchorOrigin={{ vertical: "top", horizontal: "center" }}
      >
        <Alert severity={snack.severity} sx={{ fontFamily: FONT, fontSize: 13 }}>
          {snack.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default PatientReferralsTab;
