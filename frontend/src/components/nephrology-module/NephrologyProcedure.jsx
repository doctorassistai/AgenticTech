import React, { useState, useEffect, useContext } from "react";
import { NephrologyContext, NephrologyProvider, useNephrology } from "./context/NephrologyContext";
import Section from "./components/Section";
import FormField from "./components/FormField";
import { saveNephrologySession, updateNephrologySession } from "./services/nephrologyApi";

import HemodialysisGuide from "./tabs/procedures/HemodialysisGuide";
import AVFistulaGuide from "./tabs/procedures/AVFistulaGuide";
import TransplantGuide from "./tabs/procedures/TransplantGuide";
import RenalBiopsyGuide from "./tabs/procedures/RenalBiopsyGuide";
import PdCatheterGuide from "./tabs/procedures/PdCatheterGuide";

import VoiceDictationPanel from "./components/VoiceDictationPanel";
import { procedureFieldsFor, resolveProcedureCategoryAndType } from "./components/procedureDictation";

/**
 * CommonProcedureFields Component
 * Standardized documentation required across all nephrology surgical & interventional procedures.
 */
const CommonProcedureFields = ({ category, setCategory, procType, setProcType }) => {
  const { formData, updateField } = useNephrology();

  // Auto-calculate duration when start & end time change
  const startTime = formData["proc_time_start"] || "";
  const endTime = formData["proc_time_end"] || "";

  useEffect(() => {
    if (startTime && endTime) {
      const [sh, sm] = startTime.split(":").map(Number);
      const [eh, em] = endTime.split(":").map(Number);
      if (!isNaN(sh) && !isNaN(eh)) {
        let diffMins = (eh * 60 + em) - (sh * 60 + sm);
        if (diffMins < 0) diffMins += 24 * 60; // crossover midnight
        const hrs = Math.floor(diffMins / 60);
        const mins = diffMins % 60;
        updateField("proc_duration", `${hrs}h ${mins}m (${diffMins} mins)`);
      }
    }
  }, [startTime, endTime]);

  const categories = [
    { label: "Hemodialysis & Extracorporeal Therapies", value: "hd" },
    { label: "Vascular Access & Interventions", value: "access" },
    { label: "Kidney Transplantation Operative Suite", value: "transplant" },
    { label: "Interventional Nephrology / Renal Biopsy", value: "interventional" },
  ];

  const procedureTypesByCategory = {
    hd: [
      { label: "Chronic Maintenance Hemodialysis", value: "hd_maintenance" },
      { label: "Acute Inpatient Hemodialysis / SLED", value: "hd_acute" },
      { label: "Continuous Renal Replacement Therapy (CRRT)", value: "crrt" },
      { label: "Peritoneal Dialysis Catheter Insertion", value: "pd_catheter" },
    ],
    access: [
      { label: "Radiocephalic AV Fistula Creation (Brescia-Cimino)", value: "avf_radiocephalic" },
      { label: "Brachiocephalic / Brachiobasilic AVF Creation", value: "avf_brachiocephalic" },
      { label: "AV Graft Placement (PTFE)", value: "avg_placement" },
      { label: "Tunneled Hemodialysis Catheter (Permcath)", value: "permcath" },
      { label: "Temporary Dual-Lumen Dialysis Line (IJ / Femoral)", value: "temp_line" },
      { label: "AV Access Fistulogram & Balloon Angioplasty (PTA)", value: "fistulogram" },
      { label: "AV Access Surgical / Pharmaco-Mechanical Thrombectomy", value: "thrombectomy" },
    ],
    transplant: [
      { label: "Kidney Transplant Recipient Operation (Allograft Implantation)", value: "tx_living" },
      { label: "Deceased Donor Kidney Transplant Recipient Operation", value: "tx_deceased" },
      { label: "Donor Nephrectomy (Laparoscopic / Open)", value: "tx_donor_nephrectomy" },
    ],
    interventional: [
      { label: "Percutaneous Ultrasound-Guided Renal Biopsy (Native / Allograft)", value: "renal_biopsy" },
      { label: "AV Access Fistulogram & Angioplasty (PTA)", value: "fistulogram" },
      { label: "AV Access Surgical Thrombectomy", value: "thrombectomy" },
    ],
  };

  const checklistItems = [
    { id: "chk_id", label: "Identity verified" },
    { id: "chk_consent", label: "Consent signed" },
    { id: "chk_site", label: "Site marked" },
    { id: "chk_allergies", label: "Allergies reviewed" },
    { id: "chk_anticoag", label: "Anticoagulant status reviewed" },
    { id: "chk_iv", label: "IV access secured" },
    { id: "chk_monitor", label: "Monitoring attached" },
    { id: "chk_timeout", label: "Time-out completed" },
  ];

  // Ensure procType is always valid for the active category so dropdown never gets stuck on "— select —"
  useEffect(() => {
    const validTypes = procedureTypesByCategory[category] || [];
    const isValid = validTypes.some((p) => p.value === procType);
    if (!isValid && validTypes.length > 0) {
      const defaultType = validTypes[0].value;
      setProcType(defaultType);
      updateField("proc_type", defaultType);
    }
  }, [category, procType, setProcType, updateField]);

  return (
    <Section title="COMMON PROCEDURE RECORD FIELDS" variant="light" style={{ marginBottom: "20px" }}>
      {/* Category & Type */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
        <FormField
          label="PROCEDURE CATEGORY"
          name="proc_category"
          type="select"
          options={categories}
          value={category}
          onChange={(val) => {
            setCategory(val);
            updateField("proc_category", val);
            const firstType = (procedureTypesByCategory[val] || [])[0]?.value || "";
            setProcType(firstType);
            updateField("proc_type", firstType);
          }}
        />

        <FormField
          label="PROCEDURE TYPE"
          name="proc_type"
          type="select"
          options={procedureTypesByCategory[category] || []}
          value={procType}
          onChange={(val) => {
            setProcType(val);
            updateField("proc_type", val);
          }}
        />
      </div>

      {/* Date, Time, Duration */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
        <FormField label="DATE OF PROCEDURE" name="proc_date" type="date" />
        <FormField label="TIME — START" name="proc_time_start" type="time" />
        <FormField label="TIME — END" name="proc_time_end" type="time" />
        <FormField label="DURATION (End - Start)" name="proc_duration" type="derived" placeholder="Calculated automatically" />
      </div>

      {/* Diagnoses & Indication */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
        <FormField label="PRE-OPERATIVE DIAGNOSIS" name="proc_preop_diag" placeholder="e.g. End-Stage Renal Disease on HD / Acute Kidney Injury KDIGO 3" />
        <FormField label="POST-OPERATIVE DIAGNOSIS" name="proc_postop_diag" placeholder="e.g. Functioning Radiocephalic AV Fistula / Left IJ Permcath in situ" />
      </div>

      <div style={{ marginBottom: "18px" }}>
        <FormField
          label="INDICATION / CLINICAL REASON"
          name="proc_indication"
          type="textarea"
          placeholder="Document the primary diagnosis, clinical indication, urgent triggers, or lab findings necessitating this procedure..."
        />
      </div>

      {/* Consent & Discussions */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
        <div>
          <label style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#374151", display: "block", marginBottom: "8px" }}>
            INFORMED CONSENT OBTAINED
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            {["Yes", "No"].map((opt) => (
              <label
                key={opt}
                style={{
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  padding: "6px 16px",
                  border: "1px solid #d1d5db",
                  borderRadius: "3px",
                  background: formData["proc_consent"] === opt ? "#f3f4f6" : "#ffffff",
                  fontWeight: formData["proc_consent"] === opt ? 600 : 400,
                }}
              >
                <input
                  type="radio"
                  name="proc_consent"
                  value={opt}
                  checked={formData["proc_consent"] === opt}
                  onChange={(e) => updateField("proc_consent", e.target.value)}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>

        <div>
          <label style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#374151", display: "block", marginBottom: "8px" }}>
            RISK/BENEFIT DISCUSSION DOCUMENTED
          </label>
          <div style={{ display: "flex", gap: "12px" }}>
            {["Yes", "No"].map((opt) => (
              <label
                key={opt}
                style={{
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  padding: "6px 16px",
                  border: "1px solid #d1d5db",
                  borderRadius: "3px",
                  background: formData["proc_risk_disc"] === opt ? "#f3f4f6" : "#ffffff",
                  fontWeight: formData["proc_risk_disc"] === opt ? 600 : 400,
                }}
              >
                <input
                  type="radio"
                  name="proc_risk_disc"
                  value={opt}
                  checked={formData["proc_risk_disc"] === opt}
                  onChange={(e) => updateField("proc_risk_disc", e.target.value)}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>
      </div>

      {/* Staff & Physician */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
        <FormField
          label="ANAESTHESIA TYPE"
          name="proc_anaesthesia"
          type="select"
          options={["— select —", "Local Anaesthesia", "Conscious Sedation", "Regional Block / Brachial Plexus", "General Anaesthesia", "None"]}
        />
        <FormField label="PERFORMING PHYSICIAN / OPERATOR" name="proc_operator" placeholder="Enter physician name" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
        <FormField label="OPERATOR QUALIFICATION / SPECIALTY" name="proc_qualification" placeholder="Consultant Nephrologist / Vascular Surgeon / Transplant Surgeon" />
        <FormField label="ASSISTING STAFF / NURSES" name="proc_assisting_staff" placeholder="Enter surgical assistants, scrub nurses..." />
      </div>

      {/* Laterality & Position */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
        <div>
          <label style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#374151", display: "block", marginBottom: "8px" }}>
            SIDE / LATERALITY
          </label>
          <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
            {["Left", "Right", "Bilateral", "Midline", "N/A"].map((opt) => (
              <label
                key={opt}
                style={{
                  fontSize: "13px",
                  display: "flex",
                  alignItems: "center",
                  gap: "6px",
                  cursor: "pointer",
                  border: "1px solid #d1d5db",
                  padding: "6px 14px",
                  borderRadius: "3px",
                  background: formData["proc_side"] === opt ? "#f3f4f6" : "#ffffff",
                  fontWeight: formData["proc_side"] === opt ? 600 : 400,
                }}
              >
                <input
                  type="radio"
                  name="proc_side"
                  value={opt}
                  checked={formData["proc_side"] === opt}
                  onChange={(e) => updateField("proc_side", e.target.value)}
                />
                {opt}
              </label>
            ))}
          </div>
        </div>

        <FormField
          label="PATIENT POSITION"
          name="proc_position"
          type="select"
          options={["— select —", "Supine", "Prone (Native Biopsy)", "Semi-Fowler", "Left Lateral Decubitus", "Right Lateral Decubitus"]}
        />
      </div>

      {/* Pre-Procedure Checklist */}
      <div style={{ marginBottom: "18px" }}>
        <label style={{ fontSize: "11.5px", fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: "#374151", display: "block", marginBottom: "8px" }}>
          PRE-PROCEDURE WHO SAFETY CHECKLIST
        </label>
        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
          {checklistItems.map((item) => {
            const isChecked = !!formData[item.id];
            return (
              <label
                key={item.id}
                style={{
                  fontSize: "12.5px",
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "8px 14px",
                  border: "1px solid #d1d5db",
                  borderRadius: "3px",
                  background: isChecked ? "#f0fdf4" : "#ffffff",
                  borderColor: isChecked ? "#16a34a" : "#d1d5db",
                  cursor: "pointer",
                  fontWeight: isChecked ? 600 : 400,
                  transition: "all 0.15s ease",
                }}
              >
                <input
                  type="checkbox"
                  style={{ width: "16px", height: "16px", cursor: "pointer" }}
                  checked={isChecked}
                  onChange={(e) => updateField(item.id, e.target.checked)}
                />
                {item.label}
              </label>
            );
          })}
        </div>
      </div>

      {/* Pain & Sedation */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px" }}>
        <FormField label="PRE-PROCEDURE VAS PAIN SCORE (0–10)" name="proc_pain_score" placeholder="e.g. 0" />
        <FormField
          label="SEDATION LEVEL (RAMSAY)"
          name="proc_ramsay_score"
          type="select"
          options={[
            "— select —",
            "Level 1: Anxious / Restless",
            "Level 2: Cooperative / Oriented / Tranquil",
            "Level 3: Responds to commands only",
            "Level 4: Brisk response to light touch",
            "Level 5: Sluggish response to light touch",
            "Level 6: No response",
          ]}
        />
      </div>
    </Section>
  );
};

const ALLOWED_TRACKS = [
  "dialysis_rrt",
  "transplant",
  "diagnostics",
  "aki_hosp",
  "ckd_mgmt",
  "intake_baseline",
  "longitudinal_ops",
  "decision_support",
  "procedures",
];

const getProcedureTrack = (cat, type, propTrack) => {
  // If explicitly provided via props and not generic intake_baseline
  if (propTrack && ALLOWED_TRACKS.includes(propTrack) && propTrack !== "intake_baseline" && propTrack !== "procedures") {
    return propTrack;
  }

  // 1. Kidney Transplantation Operative Suite
  if (cat === "transplant" || type?.startsWith("tx")) {
    return "transplant";
  }

  // 2. Interventional Nephrology / Renal Biopsy / Diagnostics
  if (cat === "interventional" || type === "renal_biopsy" || type === "biopsy") {
    return "diagnostics";
  }

  // 3. Hemodialysis, CRRT, Peritoneal Dialysis, AV Fistula, Permcath, and vascular access interventions
  if (
    cat === "hd" ||
    cat === "access" ||
    type?.startsWith("hd") ||
    type?.startsWith("avf") ||
    type?.startsWith("avg") ||
    type === "crrt" ||
    type === "pd_catheter" ||
    type === "permcath" ||
    type === "temp_line" ||
    type === "fistulogram" ||
    type === "thrombectomy"
  ) {
    return "dialysis_rrt";
  }

  return "dialysis_rrt";
};

/**
 * NephrologyProcedureInner Component
 * Master Procedure Notes Record that dynamically renders common and procedure-specific sections.
 */
const NephrologyProcedureInner = ({ patientId, doctorId, track: propTrack, sessionId: incomingSessionId, onSaveProcedureNote }) => {
  const {
    formData,
    updateField,
    sessionStatus,
    setSessionStatus,
    track: contextTrack,
    sessionId: contextSessionId,
    setSessionId: contextSetSessionId,
    setHistoricalSessions,
  } = useNephrology();

  const [category, setCategory] = useState(formData["proc_category"] || "hd");
  const [procType, setProcType] = useState(formData["proc_type"] || "hd_maintenance");
  const [activeSessionId, setActiveSessionId] = useState(
    incomingSessionId || contextSessionId || formData["proc_session_id"] || ""
  );
  const [isSaving, setIsSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState(null);
  const [savedTrack, setSavedTrack] = useState("");

  // Sync state if formData changes externally
  useEffect(() => {
    if (formData["proc_category"] && formData["proc_category"] !== category) {
      setCategory(formData["proc_category"]);
    }
    if (formData["proc_type"] && formData["proc_type"] !== procType) {
      setProcType(formData["proc_type"]);
    }
    if (formData["proc_session_id"] && formData["proc_session_id"] !== activeSessionId) {
      setActiveSessionId(formData["proc_session_id"]);
    }
  }, [formData["proc_category"], formData["proc_type"], formData["proc_session_id"]]);

  const resolvedTrack = getProcedureTrack(category, procType, propTrack);

  const handleSaveNote = async () => {
    setIsSaving(true);
    try {
      const resolvedPatientId = patientId || formData["patient_id"] || "PID-PROC";
      const resolvedDoctorId = doctorId || formData["doctor_id"] || "DOC-PROC";
      const dataToSave = {
        ...formData,
        proc_category: category,
        proc_type: procType,
        proc_track: resolvedTrack,
        proc_saved_at: new Date().toISOString(),
      };

      if (onSaveProcedureNote) {
        await onSaveProcedureNote(formData);
        if (setHistoricalSessions) {
          const newSession = {
            session_id: activeSessionId || `proc_${Date.now()}`,
            patient_id: resolvedPatientId,
            doctor_id: resolvedDoctorId,
            track: resolvedTrack,
            tab: procType || category,
            data: dataToSave,
            created_at: new Date().toISOString(),
          };
          setHistoricalSessions((prev) => [newSession, ...(prev || [])]);
        }
      } else {
        if (activeSessionId) {
          await updateNephrologySession(activeSessionId, dataToSave, resolvedPatientId, resolvedDoctorId);
          if (setHistoricalSessions) {
            setHistoricalSessions((prev) =>
              (prev || []).map((s) =>
                s.session_id === activeSessionId
                  ? { ...s, data: { ...s.data, ...dataToSave }, track: resolvedTrack, tab: procType || category }
                  : s
              )
            );
          }
        } else {
          const res = await saveNephrologySession({
            patient_id: resolvedPatientId,
            doctor_id: resolvedDoctorId,
            track: resolvedTrack,
            tab: procType || category,
            data: dataToSave,
          });
          const createdSessionId = res?.session_id || `proc_${Date.now()}`;
          if (res?.session_id) {
            setActiveSessionId(res.session_id);
            if (contextSetSessionId) contextSetSessionId(res.session_id);
            updateField("proc_session_id", res.session_id);
          }
          if (setHistoricalSessions) {
            const newSession = {
              session_id: createdSessionId,
              patient_id: resolvedPatientId,
              doctor_id: resolvedDoctorId,
              track: resolvedTrack,
              tab: procType || category,
              data: dataToSave,
              created_at: new Date().toISOString(),
            };
            setHistoricalSessions((prev) => [newSession, ...(prev || [])]);
          }
        }
      }
      setLastSaved(new Date());
      setSavedTrack(resolvedTrack);
      alert(`Procedure Note successfully saved under track [${resolvedTrack}].`);
    } catch (err) {
      console.error("Save procedure error:", err);
      alert(`Could not save procedure note: ${err.message}`);
    } finally {
      setIsSaving(false);
    }
  };

  // Determine procedure specific view
  const renderSpecificFields = () => {
    if (procType === "pd_catheter") {
      return <PdCatheterGuide />;
    } else if (procType === "renal_biopsy" || (category === "interventional" && (!procType || procType.includes("biopsy")))) {
      return <RenalBiopsyGuide />;
    } else if (category === "hd" || procType?.startsWith("hd") || procType === "crrt") {
      return <HemodialysisGuide />;
    } else if (
      category === "access" ||
      procType?.startsWith("avf") ||
      procType?.startsWith("avg") ||
      procType?.includes("cath") ||
      procType === "temp_line" ||
      procType === "fistulogram" ||
      procType === "thrombectomy"
    ) {
      return <AVFistulaGuide />;
    } else if (category === "transplant" || procType?.startsWith("tx")) {
      return <TransplantGuide />;
    }

    return (
      <div style={{ padding: "30px", background: "#f9f9f9", border: "1px solid #e0e0e0", textAlign: "center", color: "#888888", fontSize: "12px" }}>
        Please select a Procedure Category and Procedure Type above to load its clinical record.
      </div>
    );
  };

  return (
    <div style={{ background: "#ffffff", padding: "24px 36px", width: "100%", boxSizing: "border-box", minHeight: "100vh" }}>
      {/* Top Action Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", borderBottom: "2px solid #000000", paddingBottom: "16px" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <h2 style={{ fontSize: "21px", fontWeight: 700, color: "#111827", margin: 0, letterSpacing: "-0.01em" }}>
              DoctorAssist.AI Nephrology Procedure Notes
            </h2>
            <span style={{ fontSize: "11px", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", padding: "4px 10px", background: "#000000", color: "#ffffff", borderRadius: "2px" }}>
              Operative Record
            </span>
          </div>
          <p style={{ fontSize: "12.5px", color: "#6b7280", margin: "4px 0 0 0" }}>
            Comprehensive Interventional & Surgical Documentation System
          </p>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {lastSaved && (
            <span style={{ fontSize: "12px", color: "#16a34a", fontWeight: 600 }}>
              ✓ Saved {lastSaved.toLocaleTimeString()} [{savedTrack}]
            </span>
          )}
          <button
            type="button"
            onClick={handleSaveNote}
            disabled={isSaving}
            style={{
              padding: "9px 24px",
              background: "#000000",
              color: "#ffffff",
              border: "1px solid #000000",
              fontSize: "13px",
              fontWeight: 600,
              cursor: isSaving ? "wait" : "pointer",
              borderRadius: "2px",
              letterSpacing: "0.02em",
            }}
          >
            {isSaving ? "Saving..." : "Save Procedure Note"}
          </button>
        </div>
      </div>

      {/* Voice Dictation & AI Auto-fill Panel */}
      <VoiceDictationPanel
        section={`Nephrology Operative Record — ${procType || category}`}
        fields={procedureFieldsFor(category, procType)}
        transformStructuredValues={({ values, transcript }) => {
          const resolved = resolveProcedureCategoryAndType(
            values.proc_category,
            values.proc_type,
            transcript || `${values.proc_preop_diag || ""} ${values.proc_postop_diag || ""} ${values.proc_indication || ""}`
          );
          return {
            ...values,
            proc_category: resolved.category,
            proc_type: resolved.procType,
          };
        }}
        onStructured={({ values, transcript }) => {
          const resolved = resolveProcedureCategoryAndType(
            values.proc_category,
            values.proc_type,
            transcript || `${values.proc_preop_diag || ""} ${values.proc_postop_diag || ""} ${values.proc_indication || ""}`
          );
          if (resolved.category) {
            setCategory(resolved.category);
            updateField("proc_category", resolved.category);
          }
          if (resolved.procType) {
            setProcType(resolved.procType);
            updateField("proc_type", resolved.procType);
          }
        }}
      />

      {/* 1. Common Universal Procedure Fields */}
      <CommonProcedureFields
        category={category}
        setCategory={setCategory}
        procType={procType}
        setProcType={setProcType}
      />

      {/* 2. Procedure-Specific Fields */}
      <Section title="PROCEDURE-SPECIFIC OPERATIVE RECORD" variant="dark">
        {renderSpecificFields()}
      </Section>

      {/* 3. Post-Procedure Recovery, Disposition & Sign-off */}
      <Section title="POST-PROCEDURE RECOVERY, DISPOSITION & SIGN-OFF" variant="light" style={{ marginTop: "24px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="POST-PROCEDURE VAS PAIN SCORE (0–10)" name="proc_post_pain" placeholder="e.g. 1" />
          <FormField
            label="IMMEDIATE RECOVERY STATUS"
            name="proc_recovery_status"
            type="select"
            options={["Stable & Alert — Vitals within normal limits", "Under Active Observation", "Hemodynamically Unstable — Resuscitation Active"]}
          />
          <FormField
            label="PATIENT DISPOSITION"
            name="proc_disposition"
            type="select"
            options={[
              "Discharged Home (Outpatient procedure)",
              "Transferred to Hemodialysis Unit",
              "Transferred to Inpatient Nephrology Ward",
              "Transferred to Post-Anesthesia Care Unit (PACU)",
              "Transferred to Intensive Care Unit (ICU)",
            ]}
          />
          <FormField
            label="PROCEDURAL COMPLICATIONS"
            name="proc_complications"
            type="select"
            options={[
              "None — Procedure completed without complications",
              "Minor bleeding controlled with pressure",
              "Hematoma at puncture/incision site",
              "Transient hypotension responding to fluid bolus",
              "Arrhythmia / vasovagal episode",
              "Vessel spasm resolved with vasodilator",
              "Other (documented in notes)",
            ]}
          />
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "18px 24px", marginBottom: "18px" }}>
          <FormField label="PHYSICIAN DIGITAL SIGN-OFF (OPERATOR NAME)" name="proc_signoff_name" placeholder="Dr. Enter Full Name, MD" />
          <FormField label="SIGN-OFF DATE & TIME" name="proc_signoff_datetime" placeholder="e.g. 2026-09-08 20:30" />
        </div>

        <FormField
          label="POST-PROCEDURE ORDERS & INSTRUCTIONS"
          name="proc_post_orders"
          type="textarea"
          placeholder="Document post-procedure orders: wound dressing instructions, pain medications, anticoagulant resumption timeline, emergency contact numbers..."
        />
      </Section>
    </div>
  );
};

/**
 * Main Export: NephrologyProcedure Component
 * Provides clean fallback to NephrologyProvider if mounted as a standalone Procedure Notes route,
 * or attaches directly to an active context if rendered inside an existing provider.
 */
export default function NephrologyProcedure(props) {
  const context = useContext(NephrologyContext);

  if (!context || !context.setFormData) {
    return (
      <NephrologyProvider initialPatientId={props.patientId} initialDoctorId={props.doctorId}>
        <NephrologyProcedureInner {...props} />
      </NephrologyProvider>
    );
  }

  return <NephrologyProcedureInner {...props} />;
}
