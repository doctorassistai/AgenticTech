import React, { useState, useEffect, createContext, useContext } from "react";

const FormContext = createContext();

// ─── Design Tokens (matching RadiationTherapyWorkflow) ───────────────────────
const FONT = '"Open Sans", sans-serif';
const FW = 300;

const C = {
    black: "#0a0a0a",
    ink: "#1a1a1a",
    charcoal: "#2e2e2e",
    smoke: "#4a4a4a",
    ash: "#7a7a7a",
    silver: "#a8a8a8",
    mist: "#d4d4d4",
    fog: "#e8e8e8",
    ghost: "#f2f2f2",
    white: "#ffffff"
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const card = {
    background: C.white,
    border: `1px solid ${C.fog}`,
    borderRadius: "4px",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    padding: "16px 20px"
};

const inputStyle = {
    width: "100%",
    padding: "8px 12px",
    fontSize: "13px",
    border: `1px solid ${C.mist}`,
    borderRadius: "4px",
    backgroundColor: C.white,
    color: C.ink,
    ...os(),
    boxSizing: "border-box"
};

const labelStyle = {
    fontSize: "12px",
    color: C.smoke,
    marginBottom: "6px",
    display: "block",
    fontWeight: 500,
    ...os({ fontWeight: 500 })
};

const headerStyle = {
    fontSize: "16px",
    color: C.charcoal,
    borderBottom: `1px solid ${C.fog}`,
    paddingBottom: "8px",
    marginBottom: "16px",
    marginTop: "24px",
    ...os({ fontWeight: 600 })
};

const buttonStyle = {
    padding: "8px 16px",
    fontSize: "13px",
    cursor: "pointer",
    borderRadius: "4px",
    border: "none",
    background: C.ghost,
    color: C.charcoal,
    ...os({ fontWeight: 500 }),
    display: "flex",
    alignItems: "center",
    gap: "8px"
};

const primaryButtonStyle = {
    ...buttonStyle,
    background: C.black,
    color: C.white
};

const Field = ({ label, section, field, type = "text", placeholder = "", options = [] }) => {
    const { formData, handleUpdate, currentCycle, CYCLE_SECTIONS, isReadOnly } = useContext(FormContext);

    // Cycle-aware data accessor: reads from the correct nested path
    const d = (section, field) => {
        if (CYCLE_SECTIONS.includes(section)) {
            return formData.cycles?.[String(currentCycle)]?.[section]?.[field] || "";
        }
        return formData[section]?.[field] || "";
    };

    // When read-only, apply a subtle visual style to indicate non-editable
    const roStyle = isReadOnly ? { backgroundColor: C.ghost, color: C.ash, cursor: "not-allowed" } : {};

    return (
        <div style={{ marginBottom: 16 }}>
            <label style={labelStyle}>{label}</label>
            {type === "textarea" ? (
                <textarea
                    style={{ ...inputStyle, minHeight: 80, resize: "vertical", ...roStyle }}
                    placeholder={placeholder}
                    value={d(section, field)}
                    onChange={e => handleUpdate(section, field, e.target.value)}
                    readOnly={isReadOnly}
                />
            ) : type === "select" ? (
                <select
                    style={{ ...inputStyle, ...roStyle }}
                    value={d(section, field)}
                    onChange={e => handleUpdate(section, field, e.target.value)}
                    disabled={isReadOnly}
                >
                    <option value="">Select...</option>
                    {options.map(opt => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                    {/* Support custom string values saved from OPRecord Autocomplete */}
                    {d(section, field) && !options.find(o => o.value === d(section, field)) && (
                        <option value={d(section, field)}>{d(section, field)}</option>
                    )}
                </select>
            ) : (
                <input
                    type={type}
                    style={{ ...inputStyle, ...roStyle }}
                    placeholder={placeholder}
                    value={d(section, field)}
                    onChange={e => handleUpdate(section, field, e.target.value)}
                    readOnly={isReadOnly}
                />
            )}
        </div>
    );
};

const Checkbox = ({ label, section, field, value }) => {
    const { formData, handleUpdate, currentCycle, CYCLE_SECTIONS, isReadOnly } = useContext(FormContext);

    // Cycle-aware: get the correct data object for this section
    const sectionData = CYCLE_SECTIONS.includes(section)
        ? formData.cycles?.[String(currentCycle)]?.[section]
        : formData[section];

    const isChecked = Array.isArray(sectionData?.[field])
        ? sectionData[field].includes(value)
        : sectionData?.[field] === true;

    const handleChange = (e) => {
        if (isReadOnly) return; // Prevent changes in read-only mode
        if (value !== undefined) {
            const currentArr = Array.isArray(sectionData?.[field]) ? sectionData[field] : [];
            const newArr = e.target.checked
                ? [...currentArr, value]
                : currentArr.filter(v => v !== value);
            handleUpdate(section, field, newArr);
        } else {
            handleUpdate(section, field, e.target.checked);
        }
    };

    return (
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: isReadOnly ? C.silver : C.ink, ...os(), cursor: isReadOnly ? "not-allowed" : "pointer", marginBottom: 8 }}>
            <input type="checkbox" checked={isChecked} onChange={handleChange} disabled={isReadOnly} />
            {label}
        </label>
    );
};

// ─── History Table Column Config ─────────────────────────────────────────────
// Defines which fields to display in the history table for each cycle-level section.
// Each entry: { label: "Column Header", field: "formDataFieldName" }
const HISTORY_COLUMNS = {
    details: [
        { label: "Date", field: "detailsDate" },
        { label: "Height", field: "height" },
        { label: "Weight", field: "weight" },
        { label: "Diagnosis", field: "detailsDiagnosis" }
    ],
    assessment: [
        { label: "Height", field: "height" },
        { label: "Weight", field: "weight" },
        { label: "ECOG", field: "performanceStatus" },
        { label: "Cardiac", field: "cardiacFunction" },
        { label: "Renal", field: "renalFunction" }
    ],
    regimen: [
        { label: "Intent", field: "treatmentIntent" },
        { label: "Protocol", field: "selectedProtocol" },
        { label: "Interval", field: "intervalDetails" },
        { label: "Start Date", field: "startDate" },
        { label: "Details", field: "protocolDetails" },
        { label: "Adjustments", field: "doseAdjustments" },
        { label: "Concurrent Therapy", field: "concurrentTherapy" }
    ],
    pre_chemo: [
        { label: "Labs", field: "currentLabs" },
        { label: "Vitals", field: "vitals" },
        { label: "Access", field: "venousAccess" },
        { label: "Consent", field: "informedConsent" },
        { label: "Emergency Meds", field: "emergencyMeds" }
    ],
    prep: [
        { label: "BSA", field: "bsa" },
        { label: "Calculated Dose", field: "calculatedDose" },
        { label: "Drug Name", field: "drugName" },
        { label: "Dose", field: "dosePerSqm" },
        { label: "Pharm Verif", field: "pharmacyVerification" },
        { label: "Nurse Verif", field: "nurseVerification" },
        { label: "PPE", field: "prepPPE" },
        { label: "Labeling", field: "labelingDetails" }
    ],
    admin: [
        { label: "Route", field: "adminRoute" },
        { label: "Total Dose", field: "totalDose" },
        { label: "ID Confirmed", field: "patientIdConfirmed" },
        { label: "Regimen Confirmed", field: "regimenConfirmed" },
        { label: "Pre-Meds", field: "preMedication" },
        { label: "Start", field: "startTime" },
        { label: "End", field: "endTime" },
        { label: "Observations", field: "infusionObservations" }
    ],
    cycle_admin: [
        { label: "Date", field: "cycleDate1" },
        { label: "H%", field: "cycleH1" },
        { label: "WBC", field: "cycleWbc1" },
        { label: "ANC", field: "cycleAnc1" },
        { label: "Platelets", field: "cyclePlatelets1" },
        { label: "Drugs", field: "cycleDrugs1" },
        { label: "Evaluation", field: "evaluation" },
        { label: "Remarks", field: "remarks" }
    ],
    post_chemo: [
        { label: "Monitoring", field: "monitoringPeriod" },
        { label: "Adverse Events", field: "adverseEvents" },
        { label: "Nadir", field: "nadirLabs" },
        { label: "Side Effect Mgt", field: "sideEffectMgt" },
        { label: "Adjustment/Delay", field: "doseAdjustment" }
    ],
    response: [
        { label: "Imaging", field: "interimImaging" },
        { label: "RECIST", field: "responseCriteria" },
        { label: "Tumor Board", field: "tumorBoardReview" },
        { label: "Updated Plan", field: "tumorBoardReviewDetails" }
    ]
};

// ─── CycleHistoryTable Component ─────────────────────────────────────────────
// Renders a formatted table of completed cycle data for a given section.
// Uses HISTORY_COLUMNS to pick which fields to show as columns.
const CycleHistoryTable = ({ section, formData, completedCycles }) => {
    const columns = HISTORY_COLUMNS[section];

    // If no column config defined for this section, show nothing
    if (!columns || completedCycles === 0) return null;

    // Collect rows: one per completed cycle
    const rows = Array.from({ length: completedCycles }, (_, i) => {
        const cycleNum = i + 1;
        let cycleData = formData.cycles?.[String(cycleNum)]?.[section] || {};

        // Fallback for cycle 1 missing data due to old global UI bug
        if (cycleNum === 1) {
            cycleData = {
                ...(formData.assessment || {}),
                ...(formData.details || {}),
                ...(formData.regimen || {}),
                ...(formData.pre_chemo || {}),
                ...(formData.prep || {}),
                ...(formData.admin || {}),
                ...(formData.cycle_admin || {}),
                ...(formData.post_chemo || {}),
                ...(formData.response || {}),
                ...cycleData
            };
        }

        return { cycleNum, data: cycleData };
    });

    // Table styles matching the existing design system
    const thStyle = {
        textAlign: "left",
        padding: "8px 12px",
        fontSize: 10,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        fontWeight: 600,
        color: C.ash,
        borderBottom: `1px solid ${C.fog}`,
        background: C.ghost,
        ...os({ fontWeight: 600 })
    };
    const tdStyle = {
        padding: "8px 12px",
        fontSize: 12,
        color: C.ink,
        borderBottom: `1px solid ${C.ghost}`,
        ...os(),
        whiteSpace: "nowrap"
    };

    return (
        <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                    <tr>
                        <th style={thStyle}>Cycle</th>
                        {columns.map(col => (
                            <th key={col.field} style={thStyle}>{col.label}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {rows.map(row => (
                        <tr key={row.cycleNum}>
                            <td style={{ ...tdStyle, fontWeight: 600, color: C.charcoal }}>
                                {row.cycleNum}
                            </td>
                            {columns.map(col => {
                                let val = row.data[col.field];

                                // Dynamically calculate BSA and Calculated Dose if they aren't explicitly saved
                                if (col.field === "bsa" && !val) {
                                    const details = formData.cycles?.[String(row.cycleNum)]?.details || {};
                                    const h = parseFloat(details.height || formData.assessment?.height || formData.details?.height);
                                    const w = parseFloat(details.weight || formData.assessment?.weight || formData.details?.weight);
                                    if (h && w) {
                                        val = (0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425)).toFixed(2) + " m²";
                                    }
                                } else if (col.field === "calculatedDose" && !val) {
                                    const details = formData.cycles?.[String(row.cycleNum)]?.details || {};
                                    const prep = formData.cycles?.[String(row.cycleNum)]?.prep || formData.prep || {};
                                    const h = parseFloat(details.height || formData.assessment?.height || formData.details?.height);
                                    const w = parseFloat(details.weight || formData.assessment?.weight || formData.details?.weight);
                                    const dose = parseFloat(prep.dosePerSqm || row.data.dosePerSqm);
                                    const drug = prep.drugName || row.data.drugName;
                                    if (h && w && dose) {
                                        const bsa = 0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425);
                                        val = `${drug || ""} ${(bsa * dose).toFixed(0)} mg`.trim();
                                    }
                                } else if (col.field === "totalDose" && !val) {
                                    const details = formData.cycles?.[String(row.cycleNum)]?.details || {};
                                    const prep = formData.cycles?.[String(row.cycleNum)]?.prep || formData.prep || {};
                                    const h = parseFloat(details.height || formData.assessment?.height || formData.details?.height);
                                    const w = parseFloat(details.weight || formData.assessment?.weight || formData.details?.weight);
                                    const dose = parseFloat(prep.dosePerSqm);
                                    if (h && w && dose) {
                                        const bsa = 0.007184 * Math.pow(h, 0.725) * Math.pow(w, 0.425);
                                        val = `${(bsa * dose).toFixed(0)} mg`;
                                    }
                                } else if (col.field === "vitals") {
                                    const admin = formData.cycles?.[String(row.cycleNum)]?.admin || {};
                                    const v = admin.vitals || {};
                                    let parts = [];
                                    if (v.tempPre || v.pulsePre || v.bpPre) {
                                        parts.push(`Pre: T:${v.tempPre || '-'} P:${v.pulsePre || '-'} BP:${v.bpPre || '-'}`);
                                    }
                                    if (v.tempDuring || v.pulseDuring || v.bpDuring) {
                                        parts.push(`During: T:${v.tempDuring || '-'} P:${v.pulseDuring || '-'} BP:${v.bpDuring || '-'}`);
                                    }
                                    if (v.tempPost || v.pulsePost || v.bpPost) {
                                        parts.push(`Post: T:${v.tempPost || '-'} P:${v.pulsePost || '-'} BP:${v.bpPost || '-'}`);
                                    }
                                    val = parts.length > 0 ? parts.join(" | ") : "—";
                                }

                                return (
                                    <td key={col.field} style={tdStyle} title={String(val || "")}>
                                        {Array.isArray(val)
                                            ? val.join(", ")
                                            : typeof val === "boolean"
                                                ? (val ? "Yes" : "No")
                                                : val || "—"}
                                    </td>
                                );
                            })}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};

export default function ChemotherapyWorkflow({ patientId, doctorId, hospitalId }) {
    const [activeTab, setActiveTab] = useState("summary");
    const [formData, setFormData] = useState({});
    const [isSaving, setIsSaving] = useState(false);
    const [showHistory, setShowHistory] = useState(false); // toggle for "View Previous Cycles" panel
    const [showPrevCyclesAssessment, setShowPrevCyclesAssessment] = useState(false); // toggle for previous cycles assessment
    const [resolvedHospitalId, setResolvedHospitalId] = useState(hospitalId || "");

    useEffect(() => {
        if (!hospitalId && doctorId) {
            const fetchDoctorHospital = async () => {
                try {
                    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                    const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
                    if (res.ok) {
                        const data = await res.json();
                        const docData = data?.data || data?.doctor || data;
                        if (docData?.hospital_id) {
                            setResolvedHospitalId(docData.hospital_id);
                        } else if (docData?.hospitalId) {
                            setResolvedHospitalId(docData.hospitalId);
                        }
                    }
                } catch (err) {
                    console.error("Failed to fetch doctor for hospital ID:", err);
                }
            };
            fetchDoctorHospital();
        } else if (hospitalId) {
            setResolvedHospitalId(hospitalId);
        }
    }, [doctorId, hospitalId]);

    // ─── Cycle-based workflow state ──────────────────────────────────────────────
    // currentCycle: which cycle number the clinician is viewing/editing right now
    const [currentCycle, setCurrentCycle] = useState(1);

    // treatment: metadata about the overall treatment progress
    // - plannedCycles: total cycles the physician has planned (editable on Regimen tab)
    // - currentCycle: the cycle that is currently "in progress" (unlocked for editing)
    // - completedCycles: how many cycles have been marked as completed
    // - status: descriptive string like "cycle_1_in_progress"
    // - treatmentCompleted: true once Final Summary is submitted (record becomes read-only)
    const [treatment, setTreatment] = useState({
        plannedCycles: 6,
        currentCycle: 1,
        completedCycles: 0,
        status: "cycle_1_in_progress",
        treatmentCompleted: false
    });

    // Sections that belong to the patient (shared across all cycles)
    const PATIENT_SECTIONS = ["summary", "assessment", "completion", "qa", "final_summary"];

    // Sections that belong to a specific cycle (each cycle gets its own copy)
    const CYCLE_SECTIONS = ["details", "regimen", "pre_chemo", "prep", "admin", "cycle_admin", "post_chemo", "response"];

    const handleUpdate = (section, field, value) => {
        setFormData(prev => {
            // Is this a cycle-level section? If so, store inside cycles[currentCycle]
            if (CYCLE_SECTIONS.includes(section)) {
                const cycleKey = String(currentCycle); // cycles are keyed by string: "1", "2", etc.
                const existingCycles = prev.cycles || {};
                const existingCycle = existingCycles[cycleKey] || {};
                const existingSection = existingCycle[section] || {};

                return {
                    ...prev,
                    cycles: {
                        ...existingCycles,
                        [cycleKey]: {
                            ...existingCycle,
                            [section]: {
                                ...existingSection,
                                [field]: value
                            }
                        }
                    }
                };
            }

            // Patient-level section — store flat at the top level (same as before)
            return {
                ...prev,
                [section]: {
                    ...(prev[section] || {}),
                    [field]: value
                }
            };
        });
    };

    useEffect(() => {
        const autoPopulate = async () => {
            if (!patientId) return;

            let actualCycleNum = currentCycle;

            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";

                // 1. Fetch existing chemotherapy record FIRST
                if (doctorId) {
                    const recordRes = await fetch(`${API_BASE_URL}hms/users/data/context/get-chemotherapy-record?patientId=${patientId}&doctorId=${doctorId}&hospitalId=${hospitalId || ""}`);
                    if (recordRes.ok) {
                        const recordData = await recordRes.json();
                        if (recordData.data && Object.keys(recordData.data).length > 0) {
                            setFormData(prev => ({ ...prev, ...recordData.data }));
                        }
                        if (recordData.treatment && Object.keys(recordData.treatment).length > 0) {
                            let savedPlanned = parseInt(recordData.data?.partA?.cycles) || recordData.treatment?.plannedCycles || 1;

                            // The backend deep-merges, so there might be "ghost" cycles in data.cycles that were meant to be deleted.
                            // We filter them out by ignoring anything > savedPlanned AND > completedCycles.
                            const validCycleKeys = recordData.data?.cycles ? Object.keys(recordData.data.cycles).map(Number).filter(k => k <= savedPlanned || k <= (recordData.treatment?.completedCycles || 0)) : [];
                            const actualDbCycles = validCycleKeys.length;

                            // Ensure we respect partA cycles, but never show fewer tabs than the number of valid cycles already created
                            const syncedPlannedCycles = Math.max(savedPlanned, actualDbCycles || 1);
                            setTreatment({
                                ...recordData.treatment,
                                plannedCycles: syncedPlannedCycles,
                                completedCycles: actualDbCycles > 0 ? actualDbCycles : (recordData.treatment?.completedCycles || 0)
                            });
                            if (recordData.treatment.currentCycle) {
                                actualCycleNum = recordData.treatment.currentCycle;
                            }
                            setCurrentCycle(actualCycleNum);
                        }
                    }
                }

                // 2. Fetch patient info SECOND, so it safely overrides any blank summary data that was saved in the record
                const infoRes = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-info?patient_id=${patientId}`);
                if (infoRes.ok) {
                    const data = await infoRes.json();
                    const names = (data.patient_name || "").split(" ");
                    const firstName = names[0] || "";
                    const lastName = names.slice(1).join(" ") || "";

                    setFormData(prev => {
                        const next = { ...prev };
                        const sum = { ...(next.summary || {}) };
                        sum.patientId = patientId;
                        sum.firstName = firstName || sum.firstName;
                        sum.lastName = lastName || sum.lastName;
                        sum.age = data.age || sum.age;
                        sum.sex = (data.gender || "").toLowerCase() || sum.sex;
                        next.summary = sum;

                        // Also populate current cycle details if empty
                        const cycleKey = String(actualCycleNum);
                        if (!next.cycles) next.cycles = {};
                        if (!next.cycles[cycleKey]) next.cycles[cycleKey] = {};
                        if (!next.cycles[cycleKey].details) next.cycles[cycleKey].details = {};

                        // Inherit Patient Details from the previous cycle if available
                        let prevDetails = {};
                        for (let i = actualCycleNum - 1; i >= 1; i--) {
                            if (next.cycles[String(i)] && next.cycles[String(i)].details) {
                                prevDetails = next.cycles[String(i)].details;
                                break;
                            }
                        }

                        // Combine fallback data from global sections (to recover data from old UI bug)
                        // with the previous cycle's details. Previous cycle data overrides global data.
                        const globalAss = next.assessment || {};
                        const globalDet = next.details || {};
                        const combinedDetails = { ...globalAss, ...globalDet, ...prevDetails };

                        const det = { ...(next.cycles[cycleKey].details || {}) };
                        // Copy combined details into current cycle's details, preserving any existing current data
                        Object.keys(combinedDetails).forEach(k => {
                            if (det[k] === undefined || det[k] === "") {
                                det[k] = combinedDetails[k];
                            }
                        });

                        det.detailsName = det.detailsName || (firstName + " " + lastName).trim();
                        det.age = det.age || data.age;
                        det.gender = det.gender || (data.gender || "").toLowerCase();

                        // Re-assign the deeply cloned details object back to the cycle to guarantee a React state update
                        next.cycles[cycleKey] = {
                            ...(next.cycles[cycleKey] || {}),
                            details: det
                        };

                        return next;
                    });
                }
                // 3. Fetch latest medication analysis for medsGiven
                console.log("Fetching medications for patient:", patientId);
                const medRes = await fetch(`${API_BASE_URL}hms/users/data/context/latest-events/${patientId}?feature_id=documentation-medication-analysis&limit=1`);

                if (medRes.ok) {
                    const medData = await medRes.json();
                    console.log("Medication API Response:", medData);

                    if (medData.status === "success" && medData.events && medData.events.length > 0) {
                        const latestEvent = medData.events[0];
                        if (latestEvent.finaloutput && latestEvent.finaloutput.prescriptions && latestEvent.finaloutput.prescriptions.length > 0) {

                            // Get ALL medications and join them with a comma
                            const allMedications = latestEvent.finaloutput.prescriptions
                                .map(p => p.medication)
                                .join(", ");

                            console.log("Populating Medications Given with:", allMedications);

                            setFormData(prev => {
                                // Target the current cycle's cycle_admin
                                const cycleKey = String(currentCycle);
                                const existingCycles = prev.cycles || {};
                                const existingCycle = existingCycles[cycleKey] || {};
                                const existingSection = existingCycle.cycle_admin || {};

                                // Only set if medsGiven is empty
                                if (!existingSection.medsGiven) {
                                    return {
                                        ...prev,
                                        cycles: {
                                            ...existingCycles,
                                            [cycleKey]: {
                                                ...existingCycle,
                                                cycle_admin: {
                                                    ...existingSection,
                                                    medsGiven: allMedications
                                                }
                                            }
                                        }
                                    };
                                }
                                return prev;
                            });
                        }
                    } else {
                        console.log("No medication analysis events found for this patient.");
                    }
                }

            } catch (err) {
                console.error("autoPopulate fetch:", err);
            }
        };
        autoPopulate();
    }, [patientId, doctorId, hospitalId]);


    // ─── Revert Cycle Handler ────────────────────────────────────────────────────
    // Rolls back the workflow to a previous cycle, permanently deleting all
    // cycle data that is newer than the target cycle, and syncs to backend.
    const handleRevertCycle = async (targetCycle) => {
        if (!confirm(`Are you sure you want to revert to Cycle ${targetCycle}? This will PERMANENTLY DELETE all data for Cycle ${targetCycle + 1} and beyond.`)) {
            return;
        }

        setIsSaving(true);
        try {
            // 1. Delete cycle data beyond targetCycle
            const updatedCycles = { ...(formData.cycles || {}) };
            Object.keys(updatedCycles).forEach(key => {
                const cycleNum = parseInt(key, 10);
                if (cycleNum > targetCycle) {
                    delete updatedCycles[key];
                }
            });

            // Make sure the target cycle status is marked as "in_progress"
            if (updatedCycles[String(targetCycle)]) {
                updatedCycles[String(targetCycle)] = {
                    ...updatedCycles[String(targetCycle)],
                    status: "in_progress"
                };
            }

            const newFormData = { ...formData, cycles: updatedCycles };

            // 2. Rollback treatment metadata
            const newTreatment = {
                ...treatment,
                completedCycles: targetCycle - 1, // Target cycle is now actively in-progress
                currentCycle: targetCycle,
                status: `cycle_${targetCycle}_in_progress`,
                treatmentCompleted: false
            };

            // 3. Auto-save to the backend to sync the deletion
            const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/save-chemotherapy-record`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    doctorId,
                    patientId,
                    hospitalId: resolvedHospitalId || hospitalId || "",
                    formData: newFormData,
                    treatment: newTreatment
                })
            });

            if (res.ok) {
                setFormData(newFormData);
                setTreatment(newTreatment);
                setCurrentCycle(targetCycle);
                alert(`Successfully reverted to Cycle ${targetCycle}.`);
            } else {
                alert("Failed to revert cycle. Please try again.");
            }
        } catch (err) {
            console.error("handleRevertCycle fetch:", err);
            alert("An error occurred while reverting.");
        } finally {
            setIsSaving(false);
        }
    };

    const handleSave = async () => {
        if (!patientId || !doctorId) {
            alert("Patient ID and Doctor ID are required to save.");
            return;
        }

        setIsSaving(true);
        try {
            const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/save-chemotherapy-record`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    doctorId: doctorId,
                    patientId: patientId,
                    hospitalId: resolvedHospitalId || hospitalId || "",
                    formData: formData,
                    treatment: treatment
                })
            });

            if (res.ok) {
                alert("Chemotherapy record saved successfully!");
            } else {
                alert("Failed to save chemotherapy record.");
            }
        } catch (err) {
            console.error("handleSave fetch:", err);
            alert("An error occurred while saving.");
        } finally {
            setIsSaving(false);
        }
    };

    // ─── Complete Cycle Handler ──────────────────────────────────────────────────
    // Called when the physician clicks "Complete Cycle" on the Response Assess tab.
    // This is the core workflow progression logic.
    const handleCompleteCycle = async () => {
        const cycleToComplete = currentCycle;
        const cycleKey = String(cycleToComplete);
        const nextCycleNum = cycleToComplete + 1;
        const newCompletedCount = Math.max(treatment.completedCycles, cycleToComplete);
        const allCyclesDone = newCompletedCount >= treatment.plannedCycles;

        // 1. Mark the current cycle's status as "completed" inside a new formData object
        const updatedCycles = { ...(formData.cycles || {}) };
        updatedCycles[cycleKey] = {
            ...(updatedCycles[cycleKey] || {}),
            status: "completed"
        };

        // 2. If there are more cycles to go, create an empty next cycle object
        if (!allCyclesDone) {
            const nextKey = String(nextCycleNum);
            if (!updatedCycles[nextKey]) {
                // Auto-populate Patient Details and Regimen from the completed cycle
                const prevDetails = updatedCycles[cycleKey]?.details || {};
                const prevRegimen = updatedCycles[cycleKey]?.regimen || {};
                updatedCycles[nextKey] = {
                    status: "in_progress",
                    details: { ...prevDetails },
                    regimen: { ...prevRegimen }
                };
            }
        }

        const newFormData = { ...formData, cycles: updatedCycles };

        // 3. Create the updated treatment metadata
        const newTreatment = {
            ...treatment,
            completedCycles: newCompletedCount,
            currentCycle: allCyclesDone ? treatment.currentCycle : nextCycleNum,
            status: allCyclesDone
                ? "all_cycles_completed"
                : `cycle_${nextCycleNum}_in_progress`
        };

        // Update local React state immediately
        setFormData(newFormData);
        setTreatment(newTreatment);

        // 4. Switch the view to the next cycle (or stay if all done)
        if (!allCyclesDone) {
            setCurrentCycle(nextCycleNum);
        }

        alert(
            allCyclesDone
                ? `Cycle ${treatment.currentCycle} completed! All ${treatment.plannedCycles} cycles are done. You can now fill the Completion tab.`
                : `Cycle ${treatment.currentCycle} completed! Moving to Cycle ${nextCycleNum}.`
        );

        // 5. Automatically save the new cycle progress to the backend so the user doesn't have to click Save manually!
        if (patientId && doctorId) {
            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                await fetch(`${API_BASE_URL}hms/users/data/context/save-chemotherapy-record`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        doctorId: doctorId,
                        patientId: patientId,
                        hospitalId: resolvedHospitalId || hospitalId || "",
                        formData: newFormData,
                        treatment: newTreatment
                    })
                });
            } catch (err) {
                console.error("Auto-save failed on cycle complete:", err);
            }
        }
    };

    const tabs = [
        { id: "summary", label: "Summary" },
        { id: "cycle_admin", label: "Cycle Admin" }
    ];

    // ─── Workflow Locking Logic ──────────────────────────────────────────────────
    // Determines whether a tab should be locked (unclickable)
    const isTabLocked = (tabId) => {
        // Summary is always accessible
        if (tabId === "summary") return false;

        // Cycle-level tabs: always accessible (the cycle selector handles which cycle)
        return false;
    };

    // Determines if the current view should be read-only
    // - All tabs except cycle_admin are read-only (data entry happens via OP Record)
    // - cycle_admin stays editable, but locks when viewing a completed cycle (unless unlocked)
    // - Everything is read-only once treatment is fully completed
    const isReadOnly = treatment.treatmentCompleted || (activeTab !== "cycle_admin");

    // Cycle-aware data accessor used by the Summary tab and inline JSX
    const d = (section, field) => {
        if (CYCLE_SECTIONS.includes(section)) {
            return formData.cycles?.[String(currentCycle)]?.[section]?.[field] || "";
        }
        return formData[section]?.[field] || "";
    };

    return (
        <FormContext.Provider value={{ formData, handleUpdate, currentCycle, CYCLE_SECTIONS, isReadOnly }}>
            <div style={{ ...card, marginTop: 16 }}>
                {/* Tabs */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 24, borderBottom: `1px solid ${C.fog}`, paddingBottom: 16 }}>
                    {tabs.map(tab => {
                        const locked = isTabLocked(tab.id);
                        return (
                            <button
                                key={tab.id}
                                disabled={locked}
                                onClick={() => !locked && setActiveTab(tab.id)}
                                style={{
                                    padding: "8px 16px",
                                    fontSize: "13px",
                                    cursor: locked ? "not-allowed" : "pointer",
                                    borderRadius: "4px",
                                    border: `1px solid ${activeTab === tab.id ? C.black : 'transparent'}`,
                                    background: activeTab === tab.id ? C.black : 'transparent',
                                    color: locked ? C.silver : activeTab === tab.id ? C.white : C.smoke,
                                    opacity: locked ? 0.5 : 1,
                                    ...os({ fontWeight: activeTab === tab.id ? 600 : 400 })
                                }}
                                title={locked ? `${tab.label} — Locked (complete prerequisites first)` : tab.label}
                            >
                                {tab.label}
                            </button>
                        );
                    })}

                    <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                        <button style={buttonStyle}>
                            Cancel
                        </button>
                        <button style={primaryButtonStyle} onClick={handleSave} disabled={isSaving}>
                            {isSaving ? "Saving..." : "Save Record"}
                        </button>
                    </div>
                </div>

                {/* ─── Cycle Selector ─────────────────────────────────────────────────── */}
                {/* Only show when a cycle-level tab is active */}
                {CYCLE_SECTIONS.includes(activeTab) && (
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 12,
                        marginBottom: 20,
                        padding: "12px 16px",
                        background: C.ghost,
                        borderRadius: 4,
                        border: `1px solid ${C.fog}`
                    }}>
                        <span style={{ fontSize: 12, color: C.smoke, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", ...os({ fontWeight: 600 }) }}>
                            Cycle
                        </span>
                        {/* Generate one button per planned cycle */}
                        {Array.from({ length: treatment.plannedCycles }, (_, i) => {
                            const cycleNum = i + 1;
                            // Determine this cycle's status:
                            // - "completed" if its number <= completedCycles
                            // - "in_progress" if it equals treatment.currentCycle
                            // - "locked" if it's beyond the current cycle
                            const cycleStatus = cycleNum <= treatment.completedCycles
                                ? "completed"
                                : cycleNum === treatment.currentCycle
                                    ? "in_progress"
                                    : "locked";

                            const isViewing = cycleNum === currentCycle; // is the user viewing this one?
                            const isLocked = cycleStatus === "locked";

                            return (
                                <button
                                    key={cycleNum}
                                    disabled={isLocked}
                                    onClick={() => setCurrentCycle(cycleNum)}
                                    style={{
                                        width: 36,
                                        height: 36,
                                        borderRadius: 4,
                                        fontSize: 13,
                                        fontWeight: isViewing ? 700 : 400,
                                        cursor: isLocked ? "not-allowed" : "pointer",
                                        border: isViewing
                                            ? `2px solid ${C.black}`
                                            : cycleStatus === "completed"
                                                ? `1px solid #6bd68f`
                                                : `1px solid ${C.mist}`,
                                        background: isViewing
                                            ? C.black
                                            : cycleStatus === "completed"
                                                ? "#f0faf3"
                                                : C.white,
                                        color: isViewing
                                            ? C.white
                                            : isLocked
                                                ? C.silver
                                                : C.ink,
                                        opacity: isLocked ? 0.5 : 1,
                                        ...os({ fontWeight: isViewing ? 700 : 400 }),
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "center"
                                    }}
                                    title={
                                        cycleStatus === "completed" ? `Cycle ${cycleNum} — Completed (view only)`
                                            : cycleStatus === "in_progress" ? `Cycle ${cycleNum} — In Progress (editable)`
                                                : `Cycle ${cycleNum} — Locked`
                                    }
                                >
                                    {cycleNum}
                                </button>
                            );
                        })}
                        {/* Add / Remove Cycle Buttons */}
                        <div style={{ display: "flex", gap: 4, marginLeft: 4 }}>
                            <button
                                onClick={() => {
                                    const cycleToRemove = treatment.plannedCycles;
                                    if (cycleToRemove <= 1) return; // Cannot have 0 cycles

                                    if (cycleToRemove <= treatment.completedCycles) {
                                        if (!window.confirm(`Caution: Cycle ${cycleToRemove} is already marked as completed and contains medical data. Are you sure you want to remove it?`)) {
                                            return;
                                        }
                                    } else {
                                        // Even if not completed, check if it has any drafted data
                                        const cycleData = formData.cycles?.[String(cycleToRemove)];
                                        if (cycleData) {
                                            const hasDraftData = Object.values(cycleData).some(section => Object.values(section).some(v => v !== "" && v !== false));
                                            if (hasDraftData) {
                                                if (!window.confirm(`Caution: Cycle ${cycleToRemove} has some drafted data. Are you sure you want to remove it?`)) {
                                                    return;
                                                }
                                            }
                                        }
                                    }

                                    setTreatment(prev => {
                                        const newTotal = prev.plannedCycles - 1;

                                        setFormData(old => {
                                            const nextCycles = { ...(old.cycles || {}) };
                                            delete nextCycles[String(cycleToRemove)]; // Delete the empty shell!

                                            return {
                                                ...old,
                                                cycles: nextCycles,
                                                partA: {
                                                    ...(old.partA || {}),
                                                    cycles: String(newTotal)
                                                }
                                            };
                                        });

                                        if (currentCycle === cycleToRemove) {
                                            setCurrentCycle(newTotal);
                                        }

                                        const newCompleted = prev.completedCycles >= cycleToRemove ? newTotal : prev.completedCycles;
                                        const updates = {
                                            ...prev,
                                            plannedCycles: newTotal,
                                            completedCycles: newCompleted
                                        };
                                        if (newCompleted >= newTotal) {
                                            updates.currentCycle = newTotal;
                                            updates.status = "all_cycles_completed";
                                            updates.treatmentCompleted = true;
                                        } else if (prev.currentCycle > newTotal) {
                                            updates.currentCycle = newTotal;
                                        }
                                        return updates;
                                    });
                                }}
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 4,
                                    fontSize: 18,
                                    cursor: "pointer",
                                    border: `1px dashed ${C.ash}`,
                                    background: "transparent",
                                    color: C.ash,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    transition: "all 0.2s ease"
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = "#d32f2f"; e.currentTarget.style.color = "#d32f2f"; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = C.ash; e.currentTarget.style.color = C.ash; }}
                                title="Remove last cycle"
                            >
                                -
                            </button>

                            <button
                                onClick={() => {
                                    setTreatment(prev => {
                                        const newTotal = prev.plannedCycles + 1;
                                        setFormData(old => ({
                                            ...old,
                                            partA: {
                                                ...(old.partA || {}),
                                                cycles: String(newTotal)
                                            }
                                        }));
                                        const updates = { plannedCycles: newTotal };
                                        const wasCompleted = (prev.completedCycles || 0) >= (prev.plannedCycles || 1) || prev.status === "all_cycles_completed" || prev.treatmentCompleted;
                                        if (wasCompleted && (prev.completedCycles || 0) < newTotal) {
                                            updates.currentCycle = (prev.completedCycles || 0) + 1;
                                            updates.status = `cycle_${updates.currentCycle}_in_progress`;
                                            updates.treatmentCompleted = false;
                                        }
                                        return { ...prev, ...updates };
                                    });
                                }}
                                style={{
                                    width: 36,
                                    height: 36,
                                    borderRadius: 4,
                                    fontSize: 18,
                                    cursor: "pointer",
                                    border: `1px dashed ${C.ash}`,
                                    background: "transparent",
                                    color: C.ash,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    transition: "all 0.2s ease"
                                }}
                                onMouseEnter={e => { e.currentTarget.style.borderColor = C.black; e.currentTarget.style.color = C.black; }}
                                onMouseLeave={e => { e.currentTarget.style.borderColor = C.ash; e.currentTarget.style.color = C.ash; }}
                                title="Add a Cycle"
                            >
                                +
                            </button>
                        </div>
                        {/* Status label on the right */}
                        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ fontSize: 11, color: C.ash, ...os() }}>
                                {treatment.treatmentCompleted
                                    ? `Viewing Cycle ${currentCycle} (completed — read only)`
                                    : `Editing Cycle ${currentCycle}`
                                }
                            </span>
                            {currentCycle < treatment.currentCycle && (
                                <button
                                    onClick={() => handleRevertCycle(currentCycle)}
                                    style={{
                                        background: "#ffecec",
                                        border: "1px solid #ffcccc",
                                        color: "#d32f2f",
                                        fontSize: 10,
                                        padding: "2px 6px",
                                        borderRadius: 4,
                                        cursor: "pointer",
                                        ...os({ fontWeight: 600 })
                                    }}
                                    title={`Permanently delete all cycles after Cycle ${currentCycle}`}
                                >
                                    Revert to this Cycle
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* ─── View Previous Cycles Panel ─────────────────────────────────── */}
                {/* Collapsible history panel — only shows when on a cycle-level tab and there are completed cycles */}
                {CYCLE_SECTIONS.includes(activeTab) && treatment.completedCycles > 0 && (
                    <div style={{ marginBottom: 20 }}>
                        <button
                            onClick={() => setShowHistory(!showHistory)}
                            style={{
                                ...buttonStyle,
                                width: "100%",
                                justifyContent: "space-between",
                                padding: "10px 16px",
                                background: C.white,
                                border: `1px solid ${C.fog}`,
                                fontSize: 12,
                                color: C.smoke,
                                letterSpacing: "0.03em"
                            }}
                        >
                            <span style={{ fontSize: 13, color: C.ash, fontWeight: 500 }}>{showHistory ? "▼" : "▶"} View Previous Cycles ({treatment.completedCycles} completed)</span>
                            <span style={{ fontSize: 10, color: C.ash }}>{showHistory ? "Click to collapse" : "Click to expand"}</span>
                        </button>

                        {showHistory && (
                            <div style={{
                                border: `1px solid ${C.fog}`,
                                borderTop: "none",
                                borderRadius: "0 0 4px 4px",
                                padding: 16,
                                background: C.white,
                                maxHeight: 400,
                                overflowY: "auto"
                            }}>
                                <CycleHistoryTable
                                    section={activeTab}
                                    formData={formData}
                                    completedCycles={treatment.completedCycles}
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* Content Areas */}

                {activeTab === "summary" && (
                    <div>
                        <h2 style={headerStyle}>Patient Summary</h2>
                        <p style={{ fontSize: 13, color: C.ash, marginBottom: 20 }}>Quick overview of current chemotherapy status.</p>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 16 }}>
                            {[
                                { title: "Patient Name", value: `${d("summary", "firstName")} ${d("summary", "lastName")}`.trim() || "—" },
                                { title: "Patient ID", value: d("summary", "patientId") || "—" },
                                { title: "Diagnosis", value: d("assessment", "diagnosis") || "—" },
                                { title: "Disease Stage", value: d("assessment", "diseaseStage") || "—" },
                                { title: "Selected Protocol", value: d("regimen", "selectedProtocol") || "—" },
                                { title: "Cycles Progress", value: `${treatment.completedCycles} / ${treatment.plannedCycles} Completed` },
                                { title: "Treatment Status", value: treatment?.status ? treatment.status.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase()) : "—" },
                                { title: "Current Meds (Cycle " + currentCycle + ")", value: d("cycle_admin", "medsGiven") || d("admin", "totalDose") || "—" },
                                { title: "ECOG Status", value: d("assessment", "performanceStatus") || "—" },
                                { title: "Next Due Date", value: d("summary", "nextDueDate") || "—" },
                                { title: "Active Alerts", value: d("summary", "activeAlerts") || "—" }
                            ].map((item, idx) => (
                                <div key={idx} style={{ background: C.ghost, padding: 16, borderRadius: 4, border: `1px solid ${C.fog}` }}>
                                    <h3 style={{ fontSize: 12, color: C.smoke, margin: "0 0 8px 0", textTransform: "uppercase", letterSpacing: "0.05em", ...os({ fontWeight: 600 }) }}>{item.title}</h3>
                                    <p style={{ fontSize: 14, color: C.ink, margin: 0, ...os() }}>{item.value}</p>
                                </div>
                            ))}
                        </div>

                        <h3 style={{ fontSize: 14, color: C.charcoal, marginTop: 24, marginBottom: 12, ...os({ fontWeight: 600 }) }}>Notes & Alerts</h3>
                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                            <Field label="Next Due Date" section="summary" field="nextDueDate" type="date" />
                            <Field label="Active Alerts" section="summary" field="activeAlerts" placeholder="e.g. Consent renewal due before next cycle" />
                        </div>
                        <Field label="Treatment History Notes" section="summary" field="cycleHistoryNotes" type="textarea" placeholder="Running summary of cycles completed, dates, and outcomes" />
                    </div>
                )}



                {activeTab === "cycle_admin" && (
                    <div>
                        <h2 style={headerStyle}>Cycle and Dose Administration</h2>

                        <div style={{ background: C.ghost, padding: 16, borderRadius: 4, border: `1px solid ${C.fog}`, marginBottom: 16 }}>
                            <h3 style={{ fontSize: 14, color: C.charcoal, margin: "0 0 16px 0", ...os({ fontWeight: 600 }) }}>Cycle {currentCycle}</h3>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: 16 }}>
                                <Field label="Date" section="cycle_admin" field="cycleDate1" type="date" />
                            </div>

                            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 16 }}>
                                <Field label="Hb (g/dL)" section="cycle_admin" field="cycleH1" type="number" />
                                <Field label="WBC (×10³/µL)" section="cycle_admin" field="cycleWbc1" type="number" />
                                <Field label="ANC (×10³/µL)" section="cycle_admin" field="cycleAnc1" type="number" />
                                <Field label="Platelets (×10³/µL)" section="cycle_admin" field="cyclePlatelets1" type="number" />
                            </div>

                            <Field label="Drugs" section="cycle_admin" field="cycleDrugs1" type="textarea" />
                        </div>

                        <div style={{ marginTop: 24 }}>
                            <h3 style={{ fontSize: 14, color: C.charcoal, margin: "0 0 16px 0", ...os({ fontWeight: 600 }) }}>Evaluation</h3>
                            <Field label="" section="cycle_admin" field="evaluation" type="textarea" />
                        </div>

                        <div style={{ marginTop: 24 }}>
                            <h3 style={{ fontSize: 14, color: C.charcoal, margin: "0 0 16px 0", ...os({ fontWeight: 600 }) }}>Remarks</h3>
                            <Field label="" section="cycle_admin" field="remarks" type="textarea" placeholder="Enter any cycle specific remarks, complications, or notes for the next cycle" />
                        </div>

                    </div>
                )}

            {/* ─── Complete Cycle Button ──────────────────────────────── */}
            {/* Forcing this button to always show to allow user to unblock themselves */}
            <div style={{ marginTop: 24, paddingTop: 20, borderTop: `1px solid ${C.fog}`, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8 }}>
                <button
                    onClick={handleCompleteCycle}
                    style={{
                        ...primaryButtonStyle,
                        padding: "10px 24px",
                        fontSize: 14,
                        background: "#1a8a4a",
                        color: C.white
                    }}
                >
                    ✓ Complete Cycle {currentCycle}
                </button>
                <div style={{ fontSize: 12, color: "#d32f2f", fontWeight: 500, fontStyle: "italic" }}>
                    * Please ensure you complete the Toxicity Monitoring before clicking Complete Cycle
                </div>
            </div>


            </div>
        </FormContext.Provider>
    );
}
