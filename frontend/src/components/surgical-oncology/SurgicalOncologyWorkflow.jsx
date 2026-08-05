import React, { useState, useEffect } from "react";
import { MicRounded, StopRounded } from "@mui/icons-material";
import {
  C, FONT, FW_LIGHT, FW_NORMAL, inputStyle, inputSx, thStyle, tdStyle, catStylePlain,
} from "./shared/designTokens";
import {
  SectionBox, FG, FieldLabel, ROInput, TextInput, SelectInput, CbxGroup, RdoGroup, FlagNote, PostponedBanner,
} from "./shared/FormComponents";
import { Dialog, DialogTitle, DialogContent, DialogActions, TextField, Button, Box, Typography } from "@mui/material";
import { saveSection, completeBooking, getDoctorInfo, getDoctorsByHospital, updateBooking, updateBookingStatus, getBooking } from "./shared/api";
import { getPostponeInfo } from "./shared/postponeStatus";
import { usePatientInfo } from "./shared/usePatientInfo";
import { useBookingData } from "./shared/useBookingData";
import CompletedInvestigationsPanel from "./shared/CompletedInvestigationsPanel";

// ─── Constants ───────────────────────────────────────────────────────────────
const SURGEONS = ["Dr. Smith", "Dr. Jones", "Dr. Williams", "Dr. Brown", "Dr. Taylor"];
const ANAESTHETISTS = ["Dr. Adams", "Dr. Baker", "Dr. Clark", "Dr. Davis", "Dr. Evans"];
const NURSES = ["Nurse Mary", "Nurse John", "Nurse Sarah", "Nurse David", "Nurse Emily"];

// Mock OTP codes accepted for the surgical team authorization (simulation only).
// Any of these codes validates for any doctor — placeholder until real OTP delivery is wired up.
const DEMO_OTP_CODES = ["1234", "123456", "0000", "999999", "4528", "7360", "4044", "2041", "6590"];

// Lab Investigations Section (completed uploaded reports)
const LabInvestigationsSection = ({ doctorId, patientId }) => {
  return (
    <SectionBox title="Pre-Induction Lab Investigations">
      <CompletedInvestigationsPanel patientId={patientId} doctorId={doctorId} />
    </SectionBox>
  );
};

// ─── Surgical Checklist (Part C) ─────────────────────────────────────────────
const CheckRow = ({ label, id, hasNA, f, set }) => (
  <tr>
    <td style={tdStyle}>{label}</td>
    <td style={tdStyle}>
      <div style={{ display: "flex", gap: 12 }}>
        <label style={{ fontSize: 11 }}><input type="radio" name={id} value="Yes" checked={f[`${id}_status`] === "Yes"} onChange={e => set(`${id}_status`, e.target.value)} /> Yes</label>
        <label style={{ fontSize: 11 }}><input type="radio" name={id} value="No" checked={f[`${id}_status`] === "No"} onChange={e => set(`${id}_status`, e.target.value)} /> No</label>
        {hasNA && <label style={{ fontSize: 11 }}><input type="radio" name={id} value="NA" checked={f[`${id}_status`] === "NA"} onChange={e => set(`${id}_status`, e.target.value)} /> N/A</label>}
      </div>
    </td>
    <td style={tdStyle}><input type="text" placeholder="Remarks" value={f[`${id}_remarks`] || ""} onChange={e => set(`${id}_remarks`, e.target.value)} style={{ ...inputStyle, padding: "6px 8px" }} /></td>
  </tr>
);

const SurgicalChecklistTab = ({ patientId, patientInfo, doctorInfo, doctorId, bookingId, bookingData, initialData, onSave }) => {
  const [f, setF] = useState(initialData || {});
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));

  const [surgeonList, setSurgeonList] = useState(SURGEONS.map(s => ({ value: s, label: s })));

  // ─── Voice dictation state ─────────────────────────────────────────────────
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);

  // ─── OTP authorization state (Surgical Team Authorization) ─────────────────
  // otpDialog: { num, doctorValue, doctorLabel } when open, else null.
  const [otpDialog, setOtpDialog] = useState(null);
  const [otpStep, setOtpStep] = useState("send"); // "send" → "enter"
  const [otpInput, setOtpInput] = useState("");
  const [otpError, setOtpError] = useState("");
  const [otpSending, setOtpSending] = useState(false);

  const doctorLabelFor = (val) => surgeonList.find(s => s.value === val)?.label || val || "";

  const openOtpDialog = (num) => {
    const doctorValue = f[`surgeonSigner${num}`];
    if (!doctorValue) return;
    setOtpDialog({ num, doctorValue, doctorLabel: doctorLabelFor(doctorValue) });
    setOtpStep("send");
    setOtpInput("");
    setOtpError("");
  };

  const closeOtpDialog = () => {
    setOtpDialog(null);
    setOtpStep("send");
    setOtpInput("");
    setOtpError("");
    setOtpSending(false);
  };

  const handleSendOtp = () => {
    // Simulate dispatching an OTP to the selected doctor.
    setOtpSending(true);
    setTimeout(() => {
      setOtpSending(false);
      setOtpStep("enter");
    }, 800);
  };

  const handleVerifyOtp = () => {
    if (!otpDialog) return;
    if (DEMO_OTP_CODES.includes(otpInput.trim())) {
      set(`surgicalTeamESign${otpDialog.num}`, "Yes");
      set(`surgicalTeamAuthDoctor${otpDialog.num}`, otpDialog.doctorLabel);
      closeOtpDialog();
    } else {
      setOtpError("Invalid OTP. Please try again.");
    }
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access denied or not available.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");
          const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
          const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
          const data = await res.json();
          console.log("ElevenLabs API Response:", data);
          const transcribedText = data.text || data.transcription || "";

          if (transcribedText) {
            console.log("Transcribed Text:", transcribedText);
            setTranscript(prev => prev ? prev + " " + transcribedText : transcribedText);
          }
        } catch (err) {
          console.error("Error processing audio:", err);
          alert("Error transcribing data.");
        } finally {
          setIsProcessing(false);
        }
      };
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleAutofill = async () => {
    if (!transcript) return;
    setIsAutofilling(true);
    try {
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const llmRes = await fetch(`${API_BASE_URL}hms/users/data/surgical-oncology/surgical-checklist/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript })
      });
      const llmData = await llmRes.json();
      console.log("LLM Structured Data (Surgical Checklist):", llmData);
      if (llmData.status === "success" && llmData.data) {
        setF(prev => {
          const next = { ...prev };
          Object.entries(llmData.data).forEach(([k, v]) => {
            const incomingEmpty =
              v === undefined ||
              v === null ||
              v === "" ||
              (Array.isArray(v) && v.length === 0);
            if (!incomingEmpty) {
              const existing = prev[k];
              if (Array.isArray(existing) && Array.isArray(v)) {
                // Merge array values to support multiple dictate sessions adding to lists
                next[k] = Array.from(new Set([...existing, ...v]));
              } else {
                // Overwrite scalar values with the latest dictate
                next[k] = v;
              }
            }
          });
          return next;
        });
      }
    } catch (err) {
      console.error("Error structuring data:", err);
      alert("Error structuring data.");
    } finally {
      setIsAutofilling(false);
    }
  };

  useEffect(() => {
    if (doctorInfo && doctorInfo.hospital_id) {
      getDoctorsByHospital(doctorInfo.hospital_id)
        .then(d => {
          if (Array.isArray(d)) {
            const filteredSurgeons = d.filter(doc => doc.specialization === "Surgical Oncology");
            const optsSurgeons = filteredSurgeons.map(doc => ({ value: doc.name, label: doc.name }));
            if (optsSurgeons.length > 0) {
              setSurgeonList(optsSurgeons);
            }
          }
        })
        .catch(err => console.error("[SurgicalChecklistTab] doctors fetch:", err));
    }
  }, [doctorInfo]);

  // Sync with initialData when it changes (e.g., after a refetch).
  // Merge with initialData winning so fetched values (booking / doctors_note /
  // anaesthesia checklist) always override, while voice-filled fields not
  // present in the fetched data survive the refetch.
  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setF(prev => ({ ...prev, ...initialData }));
    }
  }, [initialData]);

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
        <SectionBox title="Speech-to-Text Transcript">
          <TextInput
            label="Transcript"
            multiline
            rows={4}
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
          />
          <FlagNote>Voice autofill will update existing fields and merge multiple selections. Please review before saving.</FlagNote>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing || isAutofilling}
              style={{
                padding: "8px 16px",
                background: isRecording ? '#cf1322' : C.black,
                color: C.white,
                border: "none",
                fontFamily: FONT,
                fontSize: 12,
                cursor: (isProcessing || isAutofilling) ? "not-allowed" : "pointer",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: (isProcessing || isAutofilling) ? 0.7 : 1
              }}
            >
              {isRecording ? <StopRounded style={{ fontSize: 16 }} /> : <MicRounded style={{ fontSize: 16 }} />}
              {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
            </button>
            <button
              onClick={handleAutofill}
              disabled={isAutofilling || !transcript}
              style={{
                padding: "8px 16px", background: C.black, color: C.white, border: "none",
                fontFamily: FONT, fontSize: 12, cursor: (isAutofilling || !transcript) ? "not-allowed" : "pointer",
                borderRadius: 4, opacity: (isAutofilling || !transcript) ? 0.7 : 1
              }}
            >
              {isAutofilling ? "Autofilling..." : "AI Autofill"}
            </button>
          </div>
        </SectionBox>
      </div>
      <SectionBox title="Primary Details">
        <FG cols={3}>
          <ROInput label="Patient ID" value={patientId || ""} />
          <ROInput label="Patient Name" value={patientInfo?.name || ""} />
          <ROInput label="Age/Sex" value={patientInfo?.ageSex || ""} />
          <TextInput label="Ward/Bed" value={f.wardBed} onChange={e => set("wardBed", e.target.value)} />
          <TextInput label="Unit Name" value={f.unitName} onChange={e => set("unitName", e.target.value)} />
          <ROInput label="Treating Doctor" value={doctorInfo?.name || ""} />
        </FG>
      </SectionBox>

      <SectionBox title="Pre-Operative Assessment">
        <FG cols={3}>
          <div>
            <CbxGroup label="Viral Markers" options={["HBsAg", "HCV", "HIV", "COVID"]}
              value={f.viralMarkers || []} onChange={v => set("viralMarkers", v)} />
          </div>
          <div>
            <RdoGroup label="Insurance" name="insurance" options={["Yes", "No"]}
              value={f.insurance} onChange={v => set("insurance", v)} />
            {f.insurance === "Yes" && (
              <div style={{ marginTop: 8 }}>
                <CbxGroup label="Type of Insurance"
                  options={["State Insurance", "Private Insurance", "Ayushman Bharat"]}
                  value={f.insuranceType || []} onChange={v => set("insuranceType", v)} />
              </div>
            )}
          </div>
          <div>
            <TextInput label="ASA Physical Status Class" value={f.asaClass}
              onChange={e => set("asaClass", e.target.value)} />
          </div>
          <div>
            <RdoGroup label="High Risk MDT" name="highRiskMDT" options={["Yes", "No", "Not Applicable"]}
              value={f.highRiskMDT} onChange={v => set("highRiskMDT", v)} />
          </div>
          {f.highRiskMDT === "Yes" && (
            <div style={{ gridColumn: "1/-1" }}>
              <TextInput label="MDT Comments" value={f.mdtComments}
                multiline rows={3} onChange={e => set("mdtComments", e.target.value)}
                placeholder="Enter MDT discussion details" />
            </div>
          )}
          <div>
            <TextInput label="Blood Group" value={f.bloodGroup}
              onChange={e => set("bloodGroup", e.target.value)} />
          </div>
          <div>
            <RdoGroup label="Any Past Transfusions?" name="pastTransfusion" options={["Yes", "No"]}
              value={f.pastTransfusion} onChange={v => set("pastTransfusion", v)} />
          </div>
          {f.pastTransfusion === "Yes" && (
            <div style={{ gridColumn: "1/-1" }}>
              <FG cols={2}>
                <div>
                  <RdoGroup label="History of Transfusion Reactions?" name="transfusionReaction"
                    options={["Yes", "No"]} value={f.transfusionReaction}
                    onChange={v => set("transfusionReaction", v)} />
                </div>
                {f.transfusionReaction === "Yes" && (
                  <TextInput label="Details about Reaction" value={f.reactionDetails}
                    multiline rows={2} onChange={e => set("reactionDetails", e.target.value)}
                    placeholder="Describe transfusion reaction" />
                )}
              </FG>
            </div>
          )}
          <div style={{ gridColumn: "1/-1" }}>
            <TextInput label="Remarks (Equipment / Position / Special requirements)"
              value={f.remarks} multiline rows={3}
              onChange={e => set("remarks", e.target.value)} />
          </div>
        </FG>
      </SectionBox>

      <SectionBox title="Pre-Induction Assessment">
        <FG cols={3}>
          <TextInput label="Surgery" value={f.surgery} onChange={e => set("surgery", e.target.value)} />
          <TextInput label="Site of Surgery" value={f.surgerySite} onChange={e => set("surgerySite", e.target.value)} />
          <div>
            <TextInput label="ASA Physical Status Class" value={f.asaStatus || ""} onChange={e => set("asaStatus", e.target.value)} />
          </div>
          <div>
            <RdoGroup label="Aspiration Risk" name="aspirationRisk" options={["Yes", "No"]} value={f.aspirationRisk} onChange={v => set("aspirationRisk", v)} />
          </div>
          <div>
            <RdoGroup label="Blood Confirmed" name="bloodConfirmed" options={["Yes", "No", "Not Applicable"]} value={f.bloodConfirmed} onChange={v => set("bloodConfirmed", v)} />
          </div>
          <div>
            <CbxGroup label="Type of Surgery" options={["Primary", "Adjunct", "Reconstructive"]} value={f.surgeryType || []} onChange={v => set("surgeryType", v)} />
          </div>
          <RdoGroup label="Anaesthesia Machine Check" name="machineCheck" options={["Yes", "No"]} value={f.machineCheck} onChange={v => set("machineCheck", v)} />
          <CbxGroup label="Informed Consent" options={["Standard", "High Risk"]} value={f.informedConsent || []} onChange={v => set("informedConsent", v)} />
          <CbxGroup label="Premedication" options={["Anxiolytic", "Antisialagogues", "Analgesic", "Others"]} value={f.premedication || []} onChange={v => set("premedication", v)} />
          <div style={{ gridColumn: "1/-1" }}>
            <TextInput label="Premedication Details (Drug, Route, Dose)" value={f.premedicationDetails} multiline rows={2} onChange={e => set("premedicationDetails", e.target.value)} />
          </div>
        </FG>
      </SectionBox>

      <SectionBox title="Pre-Induction Vitals">
        <FG cols={3}>
          <div><TextInput label="BP (mmHg)" value={f.bp} onChange={e => set("bp", e.target.value)} placeholder="e.g., 120/80" /><div style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic", marginTop: 4 }}>Flag if &lt;90/50 or &gt;180/110</div></div>
          <div><TextInput label="RR (breaths/min)" type="number" value={f.rr} onChange={e => set("rr", e.target.value)} /><div style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic", marginTop: 4 }}>Flag if &lt;10 or &gt;20</div></div>
          <div><TextInput label="PR (bpm)" type="number" value={f.pr} onChange={e => set("pr", e.target.value)} /><div style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic", marginTop: 4 }}>Flag if &lt;50 or &gt;120</div></div>
          <div><TextInput label="SpO2 (%)" type="number" value={f.spo2} onChange={e => set("spo2", e.target.value)} /><div style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic", marginTop: 4 }}>Flag if &lt;95%</div></div>
          <div><TextInput label="Temperature (°C)" type="number" value={f.temperature} onChange={e => set("temperature", e.target.value)} /><div style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic", marginTop: 4 }}>Flag if &gt;100°C</div></div>
          <RdoGroup label="Consciousness Status" name="consciousness" options={["Normal", "Obtunded", "Unconscious"]} value={f.consciousness} onChange={v => set("consciousness", v)} />
        </FG>
      </SectionBox>

      {/* ── Pre-Induction Lab Investigations ── */}
      <LabInvestigationsSection patientId={patientId} doctorId={doctorId} />

      <SectionBox title="SIGN IN — Before Induction of Anaesthesia" style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={{ ...thStyle, width: "45%" }}>Verification Item</th><th style={thStyle}>Status</th><th style={thStyle}>Remarks</th></tr>
          </thead>
          <tbody>
            <tr><td colSpan={3} style={catStylePlain}>Patient Confirmation</td></tr>
            <CheckRow f={f} set={set} label="Identity verified" id="signin_identity" />
            <CheckRow f={f} set={set} label="Procedure confirmed" id="signin_procedure" />
            <CheckRow f={f} set={set} label="Side (Laterality) confirmed" id="signin_side" />
            <CheckRow f={f} set={set} label="Surgical Site Confirmed" id="signin_surgical_site" />
            <CheckRow f={f} set={set} label="Anaesthesia and Surgery consent obtained" id="signin_consent" />
            <CheckRow f={f} set={set} label="Site marked" id="signin_site" />
            <CheckRow f={f} set={set} label="Viral Markers checked" id="signin_viral" />
            <CheckRow f={f} set={set} label="Blood Confirmed (Units available)" id="signin_blood" />
            <CheckRow f={f} set={set} label="Specified Instruments available" id="signin_instruments" />
            <CheckRow f={f} set={set} label="Preparation for position" id="signin_position" />
            <CheckRow f={f} set={set} label="Anaesthesia Machine Check" id="signin_machine" />
            <CheckRow f={f} set={set} label="Pulse Oximeter on patient & functioning" id="signin_oximeter" />
            <CheckRow f={f} set={set} label="Difficult airway anticipated" id="signin_airway" />
            <CheckRow f={f} set={set} label="Aspiration risk" id="signin_aspiration" />
            <CheckRow f={f} set={set} label="Adequate starvation (Hours NPO)" id="signin_starvation" />
            <CheckRow f={f} set={set} label="Any Known Allergy?" id="signin_allergy" />
          </tbody>
        </table>
      </SectionBox>

      <SectionBox title="TIME OUT — Before Skin Incision" style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={{ ...thStyle, width: "45%" }}>Verification Item</th><th style={thStyle}>Status</th><th style={thStyle}>Remarks</th></tr>
          </thead>
          <tbody>
            <tr><td colSpan={3} style={catStylePlain}>Team Introduction & Identity</td></tr>
            <CheckRow f={f} set={set} label="Surgeons, anaesthetists, nurses introduce themselves" id="timeout_intro" />
            <CheckRow f={f} set={set} label="Patient identity confirmed" id="timeout_patient" />
            <CheckRow f={f} set={set} label="Procedure confirmed" id="timeout_procedure" />
            <CheckRow f={f} set={set} label="Side (Laterality) confirmed" id="timeout_side" />
            <tr><td colSpan={3} style={catStylePlain}>Anticipated Critical Events</td></tr>
            <tr>
              <td style={tdStyle}>From Surgical Team</td>
              <td colSpan={2} style={tdStyle}><input type="text" placeholder="Critical events / concerns" value={f.timeout_events_surgeon || ""} onChange={e => set("timeout_events_surgeon", e.target.value)} style={{ ...inputStyle, padding: "6px 8px" }} /></td>
            </tr>
            <tr>
              <td style={tdStyle}>From Anaesthesia Team</td>
              <td colSpan={2} style={tdStyle}><input type="text" placeholder="Critical events / concerns" value={f.timeout_events_anaesthesia || ""} onChange={e => set("timeout_events_anaesthesia", e.target.value)} style={{ ...inputStyle, padding: "6px 8px" }} /></td>
            </tr>
            <tr>
              <td style={tdStyle}>From Nursing Team</td>
              <td colSpan={2} style={tdStyle}><input type="text" placeholder="Critical events / concerns" value={f.timeout_events_nursing || ""} onChange={e => set("timeout_events_nursing", e.target.value)} style={{ ...inputStyle, padding: "6px 8px" }} /></td>
            </tr>
            <CheckRow f={f} set={set} label="Mop/Gauze count done and recorded" id="timeout_mop" />
            <CheckRow f={f} set={set} label="Antibiotic Prophylaxis given (Drug/Dose/Time)" id="timeout_antibiotic" />
            <CheckRow f={f} set={set} label="Essential Imaging displayed" id="timeout_imaging" />
            <CheckRow f={f} set={set} label="Check HPR / Frozen form" id="timeout_hpr" hasNA />
            <CheckRow f={f} set={set} label="Check Tourniquet application" id="timeout_tourniquet" hasNA />
            <CheckRow f={f} set={set} label="Throat pack inserted" id="timeout_throat" />
          </tbody>
        </table>
      </SectionBox>

      <SectionBox title="SIGN OUT — Before Patient Leaves OT" style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr><th style={{ ...thStyle, width: "45%" }}>Verification Item</th><th style={thStyle}>Status</th><th style={thStyle}>Remarks</th></tr>
          </thead>
          <tbody>
            <CheckRow f={f} set={set} label="Name of Procedure Recorded" id="signout_name" />
            <CheckRow f={f} set={set} label="Completion of instrument, sponge and needle counts" id="signout_count" />
            <CheckRow f={f} set={set} label="Specimen Labelled" id="signout_specimen" />
            <CheckRow f={f} set={set} label="Any Equipment problems to be addressed" id="signout_equipment" />
            <tr><td colSpan={3} style={catStylePlain}>Post Op Care Concerns</td></tr>
            <tr>
              <td style={tdStyle}>Surgical Team concerns</td>
              <td colSpan={2} style={tdStyle}><input type="text" placeholder="Post-op care concerns" value={f.signout_concerns_surgeon || ""} onChange={e => set("signout_concerns_surgeon", e.target.value)} style={{ ...inputStyle, padding: "6px 8px" }} /></td>
            </tr>
            <tr>
              <td style={tdStyle}>Anaesthesia Team concerns</td>
              <td colSpan={2} style={tdStyle}><input type="text" placeholder="Post-op care concerns" value={f.signout_concerns_anaesthesia || ""} onChange={e => set("signout_concerns_anaesthesia", e.target.value)} style={{ ...inputStyle, padding: "6px 8px" }} /></td>
            </tr>
            <tr>
              <td style={tdStyle}>Nursing Team concerns</td>
              <td colSpan={2} style={tdStyle}><input type="text" placeholder="Post-op care concerns" value={f.signout_concerns_nursing || ""} onChange={e => set("signout_concerns_nursing", e.target.value)} style={{ ...inputStyle, padding: "6px 8px" }} /></td>
            </tr>
          </tbody>
        </table>
      </SectionBox>

      <SectionBox title="Before Extubation" style={{ padding: 0 }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            <CheckRow f={f} set={set} label="Throat pack removed before extubation" id="extubation_throat" hasNA />
          </tbody>
        </table>
      </SectionBox>

      <SectionBox title="Surgical Team Authorization">
        <FG cols={3}>
          {[1, 2, 3].map(num => {
            const approved = f[`surgicalTeamESign${num}`] === "Yes";
            const selected = f[`surgeonSigner${num}`];
            return (
              <div key={`signer-${num}`} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <SelectInput
                  label={`Doctor ${num}`}
                  value={selected}
                  onChange={e => {
                    set(`surgeonSigner${num}`, e.target.value);
                    // Reset any prior authorization if the doctor is changed.
                    set(`surgicalTeamESign${num}`, "");
                    set(`surgicalTeamAuthDoctor${num}`, "");
                  }}
                  options={surgeonList}
                />
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <button
                    type="button"
                    disabled={!selected || approved}
                    onClick={() => openOtpDialog(num)}
                    style={{
                      padding: "8px 16px",
                      background: approved ? "#52c41a" : C.black,
                      color: C.white,
                      border: "none",
                      borderRadius: 4,
                      fontFamily: FONT,
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: (!selected || approved) ? "default" : "pointer",
                      opacity: !selected ? 0.5 : 1,
                      flex: 1
                    }}
                  >
                    {approved ? "Approved ✅" : "Authorize via OTP"}
                  </button>
                  {approved && (
                    <span style={{ fontSize: 12, fontFamily: FONT, color: "#52c41a", fontWeight: 500 }}>
                      Approved
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </FG>
      </SectionBox>

      {/* ─── OTP Authorization Dialog ─────────────────────────────────────── */}
      <Dialog open={!!otpDialog} onClose={closeOtpDialog} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 16, fontWeight: FW_NORMAL }}>
          Authorize {otpDialog?.doctorLabel}
        </DialogTitle>
        <DialogContent>
          {otpStep === "send" ? (
            <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, mt: 1 }}>
              A one-time password will be sent to {otpDialog?.doctorLabel} to confirm their
              authorization. Click "Send OTP" to proceed.
            </Typography>
          ) : (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontFamily: FONT, fontSize: 13, color: C.textSecond, mb: 2 }}>
                An OTP has been sent to {otpDialog?.doctorLabel}. Enter the code below to complete
                authorization.
              </Typography>
              <TextField
                autoFocus
                fullWidth
                label="Enter OTP"
                value={otpInput}
                onChange={e => { setOtpInput(e.target.value); setOtpError(""); }}
                onKeyDown={e => { if (e.key === "Enter") handleVerifyOtp(); }}
                error={!!otpError}
                helperText={otpError || " "}
                inputProps={{ inputMode: "numeric", maxLength: 6 }}
                sx={inputSx}
              />
            </Box>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={closeOtpDialog} sx={{ fontFamily: FONT, textTransform: "none", color: C.textSecond }}>
            Cancel
          </Button>
          {otpStep === "send" ? (
            <Button
              onClick={handleSendOtp}
              disabled={otpSending}
              variant="contained"
              sx={{ fontFamily: FONT, textTransform: "none", background: C.black, "&:hover": { background: "#1a1a1a" } }}
            >
              {otpSending ? "Sending…" : "Send OTP"}
            </Button>
          ) : (
            <Button
              onClick={handleVerifyOtp}
              disabled={!otpInput.trim()}
              variant="contained"
              sx={{ fontFamily: FONT, textTransform: "none", background: C.black, "&:hover": { background: "#1a1a1a" } }}
            >
              Verify & Approve
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <button onClick={() => onSave("checklist", f)} style={{ padding: "10px 24px", background: C.black, color: C.white, border: "none", fontFamily: FONT, fontSize: 12, cursor: "pointer", marginTop: 10 }}>Save Checklist</button>
    </div>
  );
};

// ─── Surgical Management (Part D) ────────────────────────────────────────────
const SurgicalManagementTab = ({ patientId, patientInfo, doctorInfo, hospitalId, initialData, onSave, bookingData, activeAnaesthesiaRecord }) => {
  const defaultTypeOfSurgery = bookingData?.booking?.surgeryType || bookingData?.booking?.typeOfSurgery || [];
  const defaultLaterality = bookingData?.booking?.laterality || "";

  let defaultAnesthesia = [];
  const mode = activeAnaesthesiaRecord?.mm?.modeAnaesthesia;
  if (mode === "General") defaultAnesthesia = ["General (GA)"];
  else if (mode === "Regional") defaultAnesthesia = ["Regional"];
  else if (mode === "Both (General + Regional)") defaultAnesthesia = ["General (GA)", "Regional"];
  else if (mode === "MAC") defaultAnesthesia = ["MAC / Sedation"];

  const [f, setF] = useState({ 
    primarySurgeon: "", 
    typeOfSurgery: Array.isArray(defaultTypeOfSurgery) ? defaultTypeOfSurgery : (defaultTypeOfSurgery ? [defaultTypeOfSurgery] : []), 
    laterality: defaultLaterality,
    typeOfAnesthesia: defaultAnesthesia, 
    woundClass: [], 
    bloodProducts: [], 
    caseStatus: [], 
    ...(initialData || {}) 
  });
  const set = (k, v) => setF(p => ({ ...p, [k]: v }));
  const [surgeonList, setSurgeonList] = useState(SURGEONS);
  const [anaesthetistList, setAnaesthetistList] = useState(ANAESTHETISTS);

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = React.useRef(null);
  const audioChunksRef = React.useRef([]);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (err) {
      console.error("Error accessing microphone:", err);
      alert("Microphone access denied or not available.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.onstop = async () => {
        setIsRecording(false);
        setIsProcessing(true);
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
        audioChunksRef.current = [];

        try {
          const formData = new FormData();
          formData.append("file", audioBlob, "recording.webm");
          const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
          const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formData });
          const data = await res.json();
          console.log("ElevenLabs API Response:", data);
          const transcribedText = data.text || data.transcription || "";

          if (transcribedText) {
            console.log("Transcribed Text:", transcribedText);
            setTranscript(prev => prev ? prev + " " + transcribedText : transcribedText);
          }
        } catch (err) {
          console.error("Error processing audio:", err);
          alert("Error transcribing data.");
        } finally {
          setIsProcessing(false);
        }
      };
      mediaRecorderRef.current.stop();
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleAutofill = async () => {
    if (!transcript) return;
    setIsAutofilling(true);
    try {
      const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
      const llmRes = await fetch(`${API_BASE_URL}hms/users/data/surgical-oncology/surgical-management/structure`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: transcript })
      });
      const llmData = await llmRes.json();
      console.log("LLM Structured Data (Surgical Management):", llmData);
      if (llmData.status === "success" && llmData.data) {
        const newData = { ...llmData.data };
        delete newData.unitName;
        delete newData.wardBed;

        // Match LLM returned names to actual dropdown names to avoid missing selections
        const matchName = (name, list) => {
          if (!name) return name;
          const target = name.toLowerCase().replace(/dr\.?\s*/g, '').trim();
          
          // Exact Match
          const exact = list.find(item => item.value.toLowerCase().replace(/dr\.?\s*/g, '').trim() === target);
          if (exact) return exact.value;
          
          // Substring Match
          const partial = list.find(item => {
            const listVal = item.value.toLowerCase().replace(/dr\.?\s*/g, '').trim();
            return listVal.includes(target) || target.includes(listVal);
          });
          if (partial) return partial.value;
          
          return name; // fallback to the original if no match
        };

        const surgeonFields = ["primarySurgeon", "assistantSurgeon1", "assistantSurgeon2", "assistantSurgeon3", "reconPrimarySurgeon", "reconAssistant1", "reconAssistant2", "reconAssistant3"];
        surgeonFields.forEach(f => {
          if (newData[f]) newData[f] = matchName(newData[f], surgeonList);
        });

        const anaesthetistFields = ["primaryAnaesthetist", "anaesthetist1", "anaesthetist2"];
        anaesthetistFields.forEach(f => {
          if (newData[f]) newData[f] = matchName(newData[f], anaesthetistList);
        });

        setF(prev => {
          const next = { ...prev };
          Object.entries(newData).forEach(([k, v]) => {
            const incomingEmpty =
              v === undefined ||
              v === null ||
              v === "" ||
              (Array.isArray(v) && v.length === 0);
            
            if (!incomingEmpty) {
              const existing = prev[k];
              if (Array.isArray(existing) && Array.isArray(v)) {
                next[k] = Array.from(new Set([...existing, ...v]));
              } else {
                next[k] = v;
              }
            }
          });
          return next;
        });
      }
    } catch (err) {
      console.error("Error structuring data:", err);
      alert("Error structuring data.");
    } finally {
      setIsAutofilling(false);
    }
  };

  useEffect(() => {
    if (initialData && Object.keys(initialData).length > 0) {
      setF(prev => ({ ...prev, ...initialData }));
    }
  }, [initialData]);

  useEffect(() => {
    if (!hospitalId) return;
    getDoctorsByHospital(hospitalId)
      .then(d => {
        if (Array.isArray(d)) {
          const filteredSurgeons = d.filter(doc => doc.specialization === "Surgical Oncology");
          const optsSurgeons = filteredSurgeons.map(doc => ({ value: doc.name, label: doc.name }));
          setSurgeonList(optsSurgeons.length > 0 ? optsSurgeons : SURGEONS.map(s => ({ value: s, label: s })));

          const filteredAnaesthetists = d.filter(doc =>
            doc.specialization === "Anaesthesia" ||
            doc.specialization === "Anesthesia" ||
            doc.specialization === "Anaesthesiology" ||
            doc.specialization === "Anesthesiology"
          );
          const optsAnaesthetists = filteredAnaesthetists.map(doc => ({ value: doc.name, label: doc.name }));
          setAnaesthetistList(optsAnaesthetists.length > 0 ? optsAnaesthetists : ANAESTHETISTS.map(a => ({ value: a, label: a })));
        }
      })
      .catch(err => console.error("[SurgicalManagementTab] doctors fetch:", err));
  }, [hospitalId]);

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
        <SectionBox title="Speech-to-Text Transcript">
          <TextInput
            label="Transcript"
            multiline
            rows={4}
            value={transcript}
            onChange={e => setTranscript(e.target.value)}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 12 }}>
            <button
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isProcessing || isAutofilling}
              style={{
                padding: "8px 16px",
                background: isRecording ? '#cf1322' : C.black,
                color: C.white,
                border: "none",
                fontFamily: FONT,
                fontSize: 12,
                cursor: (isProcessing || isAutofilling) ? "not-allowed" : "pointer",
                borderRadius: 4,
                display: "flex",
                alignItems: "center",
                gap: 8,
                opacity: (isProcessing || isAutofilling) ? 0.7 : 1
              }}
            >
              {isRecording ? <StopRounded style={{ fontSize: 16 }} /> : <MicRounded style={{ fontSize: 16 }} />}
              {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Start Recording"}
            </button>
            <button
              onClick={handleAutofill}
              disabled={isAutofilling || !transcript}
              style={{
                padding: "8px 16px", background: C.black, color: C.white, border: "none",
                fontFamily: FONT, fontSize: 12, cursor: (isAutofilling || !transcript) ? "not-allowed" : "pointer",
                borderRadius: 4, opacity: (isAutofilling || !transcript) ? 0.7 : 1
              }}
            >
              {isAutofilling ? "Autofilling..." : "AI Autofill"}
            </button>
          </div>
        </SectionBox>
      </div>
      <SectionBox title="Primary Details">
        <FG cols={3}>
          <ROInput label="Patient ID" value={patientId || ""} />
          <ROInput label="Patient Name" value={patientInfo?.name || ""} />
          <ROInput label="Age/Sex" value={patientInfo?.ageSex || ""} />
          <TextInput label="Ward/Bed" value={f.wardBed} onChange={e => set("wardBed", e.target.value)} />
          <TextInput label="Unit Name" value={f.unitName} onChange={e => set("unitName", e.target.value)} />
          <ROInput label="Treating Doctor" value={doctorInfo?.name || ""} />
        </FG>
      </SectionBox>

      <SectionBox title="Surgery Team">
        <FG cols={4}>
          <SelectInput label="Primary Surgeon" value={f.primarySurgeon} onChange={e => set("primarySurgeon", e.target.value)} options={surgeonList} />
          <SelectInput label="Assistant Surgeon 1" value={f.assistantSurgeon1} onChange={e => set("assistantSurgeon1", e.target.value)} options={surgeonList} />
          <SelectInput label="Assistant Surgeon 2" value={f.assistantSurgeon2} onChange={e => set("assistantSurgeon2", e.target.value)} options={surgeonList} />
          <SelectInput label="Assistant Surgeon 3" value={f.assistantSurgeon3} onChange={e => set("assistantSurgeon3", e.target.value)} options={surgeonList} />
          <SelectInput label="Primary Anaesthetist" value={f.primaryAnaesthetist} onChange={e => set("primaryAnaesthetist", e.target.value)} options={anaesthetistList} />
          <SelectInput label="Anaesthetist 1" value={f.anaesthetist1} onChange={e => set("anaesthetist1", e.target.value)} options={anaesthetistList} />
          <SelectInput label="Anaesthetist 2" value={f.anaesthetist2} onChange={e => set("anaesthetist2", e.target.value)} options={anaesthetistList} />
        </FG>
      </SectionBox>

      <SectionBox title="Reconstruction Team">
        <FG cols={4}>
          <SelectInput label="Primary Surgeon" value={f.reconPrimarySurgeon} onChange={e => set("reconPrimarySurgeon", e.target.value)} options={surgeonList} />
          <SelectInput label="Assistant 1" value={f.reconAssistant1} onChange={e => set("reconAssistant1", e.target.value)} options={surgeonList} />
          <SelectInput label="Assistant 2" value={f.reconAssistant2} onChange={e => set("reconAssistant2", e.target.value)} options={surgeonList} />
          <SelectInput label="Assistant 3" value={f.reconAssistant3} onChange={e => set("reconAssistant3", e.target.value)} options={surgeonList} />
        </FG>
      </SectionBox>

      <SectionBox title="Nurses">
        <FG cols={3}>
          <SelectInput label="Scrub Nurse 1" value={f.scrubNurse1} onChange={e => set("scrubNurse1", e.target.value)} options={NURSES} />
          <SelectInput label="Scrub Nurse 2" value={f.scrubNurse2} onChange={e => set("scrubNurse2", e.target.value)} options={NURSES} />
          <SelectInput label="Circulating Nurse" value={f.circulatingNurse} onChange={e => set("circulatingNurse", e.target.value)} options={NURSES} />
        </FG>
      </SectionBox>

      <SectionBox title="Duration & Timing">
        <FG cols={4}>
          <TextInput label="Operation Start Date" type="date" value={f.operationStartDate} onChange={e => set("operationStartDate", e.target.value)} />
          <TextInput label="Operation Start Time" type="time" value={f.operationStartTime} onChange={e => set("operationStartTime", e.target.value)} />
          <TextInput label="Operation End Date" type="date" value={f.operationEndDate} onChange={e => set("operationEndDate", e.target.value)} />
          <TextInput label="Operation End Time" type="time" value={f.operationEndTime} onChange={e => set("operationEndTime", e.target.value)} />
          <TextInput label="Anaesthesia Start Date" type="date" value={f.anaesthesiaStartDate} onChange={e => set("anaesthesiaStartDate", e.target.value)} />
          <TextInput label="Anaesthesia Start Time" type="time" value={f.anaesthesiaStartTime} onChange={e => set("anaesthesiaStartTime", e.target.value)} />
          <TextInput label="Anaesthesia End Date" type="date" value={f.anaesthesiaEndDate} onChange={e => set("anaesthesiaEndDate", e.target.value)} />
          <TextInput label="Anaesthesia End Time" type="time" value={f.anaesthesiaEndTime} onChange={e => set("anaesthesiaEndTime", e.target.value)} />
        </FG>
      </SectionBox>

      <SectionBox title="Operation Proposed">
        <FG cols={3}>
          <ROInput label="Unit Name" value={f.unitName} />
          <TextInput label="Name of Procedure" value={f.nameOfProcedure} onChange={e => set("nameOfProcedure", e.target.value)} />
          <TextInput label="Prophylactic Antibiotics (Name, Dose, Time)" value={f.prophylacticAntibiotics} onChange={e => set("prophylacticAntibiotics", e.target.value)} />
        </FG>
      </SectionBox>

      <SectionBox title="Surgery Performed">
        <FG cols={3}>
          <div><CbxGroup label="Type of Surgery" options={["Primary", "Adjunct", "Reconstructive", "Node Dissection"]} value={f.typeOfSurgery} onChange={v => set("typeOfSurgery", v)} /></div>
          <div><RdoGroup label="Laterality" name="laterality" options={["Right", "Left", "Bilateral", "Not Applicable"]} value={f.laterality} onChange={v => set("laterality", v)} /></div>
          <div><TextInput label="Other Name of Procedure" value={f.otherNameOfProcedure} onChange={e => set("otherNameOfProcedure", e.target.value)} /></div>
          <div><TextInput label="Approach (Open/Lap/Robotic)" value={f.approach} onChange={e => set("approach", e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><CbxGroup label="Type of Anesthesia" options={["General (GA)", "Regional", "Local (LA)", "MAC / Sedation", "Spinal", "Epidural"]} value={f.typeOfAnesthesia} onChange={v => set("typeOfAnesthesia", v)} /></div>
          <div><TextInput label="Pre-Operative Diagnosis" value={f.preOperativeDiagnosis} onChange={e => set("preOperativeDiagnosis", e.target.value)} /></div>
          <div><CbxGroup label="Case Status" options={["Minor", "Elective", "Emergency", "Re-Exploration"]} value={f.caseStatus} onChange={v => set("caseStatus", v)} /></div>
          <div><TextInput label="Skin Preparation" value={f.skinPreparation} onChange={e => set("skinPreparation", e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><CbxGroup label="Wound Class" options={["Clean", "Contaminated", "Clean-Contaminated", "Dirty"]} value={f.woundClass} onChange={v => set("woundClass", v)} /></div>
          <div style={{ gridColumn: "1/-1" }}><TextInput label="Findings" multiline rows={3} value={f.findings} onChange={e => set("findings", e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><TextInput label="Procedure including incision, ligatures, sutures" multiline rows={4} value={f.procedureDetails} onChange={e => set("procedureDetails", e.target.value)} /></div>
        </FG>
      </SectionBox>

      <SectionBox title="Blood Products & Materials">
        <FG cols={3}>
          <div><CbxGroup label="Blood Products Used" options={["PRBC", "FFP", "SDP", "RDP", "Cryoprecipitate"]} value={f.bloodProducts} onChange={v => set("bloodProducts", v)} /></div>
          <div><TextInput label="Volume of Blood Products (ml)" type="number" value={f.volumeOfBloodProducts} onChange={e => set("volumeOfBloodProducts", e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><TextInput label="Materials forwarded to Pathology" multiline rows={2} value={f.materialsForwarded} onChange={e => set("materialsForwarded", e.target.value)} /></div>
        </FG>
      </SectionBox>
      <SectionBox title="Intra-Operative Findings">
        <FG cols={3}>
          <div><TextInput label="Anatomical Site" value={f.anatomicalSite} onChange={e => set("anatomicalSite", e.target.value)} /></div>
          <div>
            <FieldLabel>Intra-Op Surgical Staging (sTNM)</FieldLabel>
            <div style={{ display: "flex", gap: 8 }}>
              <TextInput placeholder="T" value={f.stagingT} onChange={e => set("stagingT", e.target.value)} />
              <TextInput placeholder="N" value={f.stagingN} onChange={e => set("stagingN", e.target.value)} />
              <TextInput placeholder="M" value={f.stagingM} onChange={e => set("stagingM", e.target.value)} />
            </div>
          </div>
          <div><TextInput label="Blood Loss (ml)" type="number" value={f.bloodLoss} onChange={e => set("bloodLoss", e.target.value)} /></div>

          <div><TextInput label="Tumour Size (mm or cm)" placeholder="e.g., 45mm x 30mm" value={f.tumourSize} onChange={e => set("tumourSize", e.target.value)} /></div>
          <div><TextInput label="Location of Tumor" value={f.locationOfTumor} onChange={e => set("locationOfTumor", e.target.value)} /></div>
          <div><RdoGroup label="Frozen Section" name="frozen_section" options={["Yes", "No"]} value={f.frozen} onChange={v => set("frozen", v)} /></div>

          {f.frozen === "Yes" && (
            <div style={{ gridColumn: "1/-1" }}>
              <TextInput label="Frozen Section Report" multiline rows={2} value={f.frozenReport} onChange={e => set("frozenReport", e.target.value)} />
              <div style={{ fontSize: 10, color: C.textMuted, fontStyle: "italic", marginTop: 4 }}>Future: Link with Synoptic Pathology Reports</div>
            </div>
          )}

          <div style={{ gridColumn: "1/-1" }}>
            <RdoGroup label="Resection Status" name="resection_status" options={["R0", "R1", "R2"]} value={f.resection} onChange={v => set("resection", v)} />
          </div>

          <div style={{ gridColumn: "1/-1" }}>
            <CbxGroup label="Margins" options={["Clear", "Involved", "Wide", "Planned Close", "Controlled", "Contaminated", "R2 Spillage", "Debulking"]} value={f.margins} onChange={v => set("margins", v)} />
          </div>

          <div style={{ gridColumn: "1/-1" }}>
            <CbxGroup label="Drains" options={["Closed Suction", "Abdominal", "Chest", "Corrugated"]} value={f.drains} onChange={v => set("drains", v)} />
          </div>
          <div style={{ gridColumn: "1/-1" }}>
            <TextInput label="Drain Location / Details" placeholder="Specify location and type" value={f.drainDetails} onChange={e => set("drainDetails", e.target.value)} />
          </div>

          <div><RdoGroup label="Intraoperative Course" name="intra_op_course" options={["Uneventful", "Complicated"]} value={f.intraOpCourse} onChange={v => set("intraOpCourse", v)} /></div>
          <div><RdoGroup label="Intent of Procedure" name="intent_procedure" options={["Curative", "Non-Curative"]} value={f.intentOfProcedure} onChange={v => set("intentOfProcedure", v)} /></div>
          <div style={{ gridColumn: "1/-1" }}>
            <CbxGroup label="Intra-Operative Complication(s)" options={["None", "Nerve Injury", "Vascular Injury", "Organ Injury", "Haemorrhage", "Others"]} value={f.intraOpComplications} onChange={v => set("intraOpComplications", v)} />
          </div>

          <div style={{ gridColumn: "1/-1" }}>
            <TextInput label="Details of Complications" multiline rows={2} value={f.complicationDetails} onChange={e => set("complicationDetails", e.target.value)} />
          </div>

          <div><RdoGroup label="Intra-op Referral" name="intra_op_referral" options={["Yes", "No"]} value={f.intraOpReferral} onChange={v => set("intraOpReferral", v)} /></div>
          {f.intraOpReferral === "Yes" && (
            <div style={{ gridColumn: "span 2" }}>
              <TextInput label="Referral Details" value={f.referralDetails} onChange={e => set("referralDetails", e.target.value)} />
            </div>
          )}

          <div style={{ gridColumn: "1/-1" }}>
            <TextInput label="Post Op Antibiotic Protocol" multiline rows={2} value={f.postOpAntibioticProtocol} onChange={e => set("postOpAntibioticProtocol", e.target.value)} />
          </div>

          <div style={{ gridColumn: "1/-1" }}>
            <TextInput label="Additional Notes / Diagrammatic Reference" multiline rows={3} value={f.additionalNotes} onChange={e => set("additionalNotes", e.target.value)} />
          </div>
        </FG>
      </SectionBox>

      <SectionBox title="Post Op Findings">
        <FG cols={3}>
          <div style={{ gridColumn: "1/-1" }}>
            <TextInput label="Post-Operative Diagnosis" multiline rows={2} value={f.postOperativeDiagnosis} onChange={e => set("postOperativeDiagnosis", e.target.value)} />
          </div>
          <div><TextInput label="Specimen(s) sent for Histopathology" value={f.specimensSent} onChange={e => set("specimensSent", e.target.value)} /></div>
          <div><RdoGroup label="Transfer To" name="transferTo" options={["Ward", "ICU", "HDU", "PACU", "Day Care", "Discharge"]} value={f.transferTo} onChange={v => set("transferTo", v)} /></div>
          <div><RdoGroup label="DVT Prophylaxis" name="dvtProphylaxis" options={["Yes", "No"]} value={f.dvtProphylaxis} onChange={v => set("dvtProphylaxis", v)} /></div>
          <div style={{ gridColumn: "1/-1" }}><TextInput label="Diet Instructions" value={f.dietInstructions} onChange={e => set("dietInstructions", e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><TextInput label="Analgesia Plan" multiline rows={2} value={f.analgesiaPlan} onChange={e => set("analgesiaPlan", e.target.value)} /></div>
          <div style={{ gridColumn: "1/-1" }}><TextInput label="Post-Operative Plan / Specific Instructions" multiline rows={3} value={f.postOperativePlan} onChange={e => set("postOperativePlan", e.target.value)} /></div>
        </FG>
      </SectionBox>

      <button onClick={() => onSave("management", f)} style={{ padding: "10px 24px", background: C.black, color: C.white, border: "none", fontFamily: FONT, fontSize: 12, cursor: "pointer", marginTop: 10 }}>Save Management</button>
    </div>
  );
};

// ─── Main Component ──────────────────────────────────────────────────────────
const SurgicalOncologyWorkflow = ({ patientId, doctorId, onNavigateToBooking }) => {
  const [activeTab, setActiveTab] = useState(0);
  const [doctorInfo, setDoctorInfo] = useState({ name: "", specialization: "", hospital_name: "", hospital_id: "" });
  const patientInfo = usePatientInfo(patientId);

  const {
    currentBookingId,
    currentBookingData,
    isLoading,
    refetch,
    getMergedChecklist,
    getMergedManagement,
    activeAnaesthesiaRecord,
  } = useBookingData(patientId, doctorId);

  // Fetch doctor info
  useEffect(() => {
    if (!doctorId) return;
    getDoctorInfo(doctorId)
      .then(d => {
        if (d?.doctor) {
          setDoctorInfo({
            name: d.doctor.name || "",
            specialization: d.doctor.specialization || "",
            hospital_name: d.doctor.hospital_name || "",
            hospital_id: d.doctor.hospital_id || "",
          });
        }
      })
      .catch(console.error);
  }, [doctorId]);

  const [postponeDialog, setPostponeDialog] = useState({ open: false, reason: "", newDate: "" });
  const [postponeOverride, setPostponeOverride] = useState(false);

  // Derived postponement state for the active booking (see shared/postponeStatus.js).
  const postponeInfo = getPostponeInfo(currentBookingData);
  // Soft-gate: lock the checklist/management forms while a postponed case's date is
  // still in the future, unless the doctor explicitly overrides.
  const postponeGated = postponeInfo.isPostponed && postponeInfo.isFuture && !postponeOverride;
  useEffect(() => { setPostponeOverride(false); }, [currentBookingId]);

  const handlePostponeBooking = async () => {
    try {
      if (!postponeDialog.reason.trim()) { alert("Please enter a reason."); return; }
      if (!postponeDialog.newDate) { alert("Please select a new date."); return; }
      const bRes = await getBooking(currentBookingId);
      const bookingDataToUpdate = bRes.data?.booking || {};
      await updateBooking(currentBookingId, { 
        ...bookingDataToUpdate, 
        postponeReason: postponeDialog.reason, 
        originalSurgeryDate: bookingDataToUpdate.originalSurgeryDate || bookingDataToUpdate.surgeryDate,
        surgeryDate: postponeDialog.newDate,
        isPostponed: true,
        postponeHistory: [
          ...(bookingDataToUpdate.postponeHistory || []),
          {
            oldDate: bookingDataToUpdate.surgeryDate,
            newDate: postponeDialog.newDate,
            reason: postponeDialog.reason,
            timestamp: new Date().toISOString()
          }
        ]
      });
      await updateBookingStatus(currentBookingId, "Postponed");
      setPostponeDialog({ open: false, reason: "", newDate: "" });
      alert("Surgery postponed successfully.");
      refetch(); // Refresh data from server
    } catch (err) {
      console.error(err);
      alert("Failed to postpone surgery.");
    }
  };

  // ─── Simplified handleSave ──────────────────────────────────────────────
  const handleSave = async (tabKey, data) => {
    if (!currentBookingId) {
      alert("No active booking. Please create an OT Booking first.");
      return;
    }

    try {
      await saveSection(currentBookingId, tabKey, data);

      // When management is saved, mark surgery as finished
      if (tabKey === "management") {
        try {
          await completeBooking(currentBookingId);
        } catch (err) {
          console.error("Failed to mark surgery as complete:", err);
        }
      }

      alert(`${tabKey} saved successfully!`);
      refetch(); // Refresh data from server
    } catch (e) {
      console.error("Save exception:", e);
      alert(`Failed to save: ${e.message}`);
    }
  };

  const TABS = [
    { label: "Surgical Checklist", part: "OT Part C" },
    { label: "Surgical Management", part: "OT Part D" },
  ];

  return (
    <div style={{ animation: "fadeIn 0.3s ease-in-out" }}>
      <style>{`@keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }`}</style>
      <div style={{ display: "flex", minHeight: "65vh", background: C.bgPrimary, border: `1px solid ${C.border}`, fontFamily: FONT }}>

        {/* Sidebar */}
        <div style={{ width: 240, borderRight: `1px solid ${C.border}`, background: C.bgSecondary, flexShrink: 0 }}>
          {TABS.map((tab, i) => (
            <div key={i} onClick={() => setActiveTab(i)}
              style={{
                padding: "16px 20px",
                borderBottom: `1px solid ${C.border}`,
                borderLeft: activeTab === i ? `3px solid ${C.black}` : "3px solid transparent",
                background: activeTab === i ? C.black : "transparent",
                cursor: "pointer",
                transition: "all 0.15s",
              }}>
              <div style={{ fontSize: 13, fontFamily: FONT, color: activeTab === i ? C.white : C.textSecond, fontWeight: activeTab === i ? FW_NORMAL : FW_LIGHT }}>{tab.label}</div>
            </div>
          ))}
        </div>

        {/* Content */}
        <div style={{ flex: 1, padding: 24, overflowX: "hidden", overflowY: "auto", maxHeight: "80vh", position: "relative" }}>

          {isLoading ? (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(255, 255, 255, 0.4)", backdropFilter: "blur(5px)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              zIndex: 50,
            }}>
              <div style={{
                background: C.white, padding: "32px 48px", borderRadius: 8,
                boxShadow: "0 10px 30px rgba(0,0,0,0.1)", textAlign: "center",
                border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.black, marginBottom: 12 }}>
                  Loading Record...
                </div>
                <div style={{ fontSize: 13, fontFamily: FONT, color: C.textSecond, maxWidth: 300 }}>
                  Please wait while we fetch the surgical workflow details.
                </div>
              </div>
            </div>
          ) : !currentBookingId && (
            <div style={{
              position: "absolute", top: 0, left: 0, right: 0, bottom: 0,
              background: "rgba(255, 255, 255, 0.4)", backdropFilter: "blur(5px)",
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              zIndex: 50,
            }}>
              <div style={{
                background: C.white, padding: "32px 48px", borderRadius: 8,
                boxShadow: "0 10px 30px rgba(0,0,0,0.1)", textAlign: "center",
                border: `1px solid ${C.border}`,
              }}>
                <div style={{ fontSize: 18, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.black, marginBottom: 12 }}>
                  No Active Booking
                </div>
                <div style={{ fontSize: 13, fontFamily: FONT, color: C.textSecond, marginBottom: 24, maxWidth: 300 }}>
                  Please create an OT Booking for this patient before filling out the surgical workflow.
                </div>
                {onNavigateToBooking && (
                  <button onClick={onNavigateToBooking} style={{
                    padding: "10px 24px", background: C.black, color: C.white,
                    border: "none", fontFamily: FONT, fontSize: 13,
                    cursor: "pointer", borderRadius: 4, transition: "0.2s",
                  }} onMouseOver={e => e.currentTarget.style.opacity = 0.8} onMouseOut={e => e.currentTarget.style.opacity = 1}>
                    Go to Booking
                  </button>
                )}
              </div>
            </div>
          )}

          <div style={{ filter: (isLoading || !currentBookingId) ? "blur(3px)" : "none", pointerEvents: (isLoading || !currentBookingId) ? "none" : "auto", userSelect: (isLoading || !currentBookingId) ? "none" : "auto" }}>
            {currentBookingId && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 2 }}>
                <Button size="small" variant="outlined" color="warning" sx={{ fontFamily: FONT, fontSize: 12, borderRadius: 0, textTransform: 'none', px: 2 }} onClick={() => setPostponeDialog({ open: true, reason: "", newDate: currentBookingData?.booking?.surgeryDate || "" })}>
                  Postpone Surgery
                </Button>
              </Box>
            )}
            {currentBookingId && postponeInfo.isPostponed && (
              <PostponedBanner info={postponeInfo} gated={postponeGated} onOverride={() => setPostponeOverride(true)} />
            )}
            <div style={{ pointerEvents: postponeGated ? "none" : "auto", opacity: postponeGated ? 0.5 : 1 }}>
              {activeTab === 0 && (
                <SurgicalChecklistTab
                  patientId={patientId}
                  patientInfo={patientInfo}
                  doctorInfo={doctorInfo}
                  doctorId={doctorId}
                  bookingId={currentBookingId}
                  bookingData={currentBookingData}
                  initialData={getMergedChecklist()}
                  onSave={handleSave}
                />
              )}
              {activeTab === 1 && (
                <SurgicalManagementTab
                  patientId={patientId}
                  patientInfo={patientInfo}
                  doctorInfo={doctorInfo}
                  hospitalId={doctorInfo.hospital_id}
                  initialData={getMergedManagement()}
                  onSave={handleSave}
                  bookingData={currentBookingData}
                  activeAnaesthesiaRecord={activeAnaesthesiaRecord}
                />
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Postpone Booking Dialog */}
      <Dialog open={postponeDialog.open} onClose={() => setPostponeDialog({ open: false, reason: "", newDate: "" })} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontFamily: FONT, fontSize: 16, background: C.bgSecondary, borderBottom: `1px solid ${C.border}`, py: 1.5 }}>
          Postpone Surgery
        </DialogTitle>
        <DialogContent sx={{ p: 3, display: 'flex', flexDirection: 'column', gap: 2 }}>
          <TextField
            fullWidth
            size="small"
            label="New Date"
            type="date"
            InputLabelProps={{ shrink: true }}
            value={postponeDialog.newDate}
            onChange={(e) => setPostponeDialog(p => ({ ...p, newDate: e.target.value }))}
            sx={{ mt: 1 }}
          />
          <TextField
            fullWidth
            size="small"
            label="Reason for Postponement"
            multiline
            rows={3}
            value={postponeDialog.reason}
            onChange={(e) => setPostponeDialog(p => ({ ...p, reason: e.target.value }))}
          />
        </DialogContent>
        <DialogActions sx={{ p: 2, borderTop: `1px solid ${C.border}`, background: C.bgPrimary }}>
          <Button onClick={() => setPostponeDialog({ open: false, reason: "", newDate: "" })} sx={{ color: C.textSecond, fontFamily: FONT }}>Cancel</Button>
          <Button onClick={handlePostponeBooking} sx={{ background: C.black, color: C.white, fontFamily: FONT, px: 2, '&:hover': { background: '#333' } }}>Postpone</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
};

export default SurgicalOncologyWorkflow;
