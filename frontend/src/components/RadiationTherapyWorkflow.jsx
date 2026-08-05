import React, { useState, useRef, useEffect } from "react";
import { MicRounded, StopRounded } from "@mui/icons-material";
import LabInvestigations from "./LabInvestigations";
import ChemotherapyChart from "./ChemotherapyChart";
import SurgeryOverview from "./SurgeryOverview";

const getInvestigations = async (patientId) => {
    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
    const res = await fetch(`${API_BASE_URL}hms/users/data/context/oncology-investigations/${patientId}`);
    return res.json();
};

// Completed investigation documents carry the extracted parameter-wise values
// (parameterwise_content) but NOT the human-facing `id`; we recover `id` by
// matching document_id against the getInvestigations history.
const getCompletedInvestigationDocuments = async (patientId, doctorId) => {
    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
    const res = await fetch(`${API_BASE_URL}hms/users/data/context/oncology-investigations/completed-documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ patient_id: patientId, doctor_id: doctorId }),
    });
    return res.json();
};

const createInvestigation = async (payload) => {
    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
    const res = await fetch(`${API_BASE_URL}hms/users/data/context/oncology-investigations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error("Failed to create investigation");
    return res.json();
};

export function uploadInvestigationFile(patientId, doctorId, investigationId, file) {
    const formData = new FormData();
    formData.append("doctor_id", doctorId);
    formData.append("patient_id", patientId);
    formData.append("investigation_id", investigationId);
    formData.append("file", file);

    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
    return fetch(`${API_BASE_URL}hms/users/cm/storage/oncology-investigations/upload-file-url`, {
        method: "POST",
        body: formData,
    }).then(async r => {
        if (!r.ok) {
            const errorData = await r.json().catch(() => ({ detail: "Unknown error" }));
            throw new Error(errorData.detail || `Upload failed (${r.status})`);
        }
        return r.json();
    });
}

// ─── Design Tokens (matching ProcedureNotes) ─────────────────────────────────
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

const DoctorNameResolver = ({ doctorId, fallback }) => {
    const [name, setName] = useState("");
    const [loading, setLoading] = useState(!!doctorId);

    useEffect(() => {
        if (!doctorId) {
            setLoading(false);
            return;
        }
        const fetchDoc = async () => {
            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
                if (res.ok) {
                    const json = await res.json();
                    const docData = json?.data || json?.doctor || json;
                    const resolvedName = docData?.name || docData?.doctor_name || `${docData?.first_name || ""} ${docData?.last_name || ""}`.trim();
                    if (resolvedName && resolvedName.trim() !== "") {
                        setName(resolvedName);
                    }
                }
            } catch (err) {
                console.error("Failed to fetch doctor name", err);
            } finally {
                setLoading(false);
            }
        };
        fetchDoc();
    }, [doctorId]);

    if (loading) return "Loading doctor name...";
    return name || fallback;
};

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

const HistoryTable = ({ historyData }) => {
    const [detailsModal, setDetailsModal] = useState(null);
    const [isExpanded, setIsExpanded] = useState(false);

    if (!Array.isArray(historyData) || historyData.length === 0) return null;

    const renderModalContent = (obj) => {
        const entries = Object.entries(obj).filter(([_, v]) => v !== null && v !== undefined && v !== "");
        if (entries.length === 0) return null;

        const primitives = entries.filter(([_, v]) => typeof v !== "object");
        const objects = entries.filter(([_, v]) => typeof v === "object");

        const objectContents = objects.map(([k, v]) => {
            const childContent = renderModalContent(v);
            return { k, childContent };
        }).filter(item => item.childContent !== null);

        if (primitives.length === 0 && objectContents.length === 0) return null;

        return (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                {primitives.length > 0 && (
                    <div style={{ overflowX: "auto", borderRadius: "4px", border: `1px solid ${C.black}`, overflow: "hidden" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", background: C.white }}>
                            <tbody>
                                {primitives.map(([k, v], index, arr) => {
                                    const isLast = index === arr.length - 1;
                                    return (
                                        <tr key={k} style={{ borderBottom: isLast ? "none" : `1px solid ${C.black}` }}>
                                            <td style={{ padding: "10px 12px", fontSize: "13px", color: C.charcoal, textTransform: "capitalize", width: "35%", verticalAlign: "top", background: C.ghost, fontWeight: 600, borderRight: `1px solid ${C.black}` }}>
                                                {k.replace(/([A-Z])/g, ' $1')}
                                            </td>
                                            <td style={{ padding: "10px 12px", fontSize: "13px", color: C.charcoal, width: "65%", wordBreak: "break-word", verticalAlign: "top" }}>
                                                {String(v)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}
                {objectContents.map(({ k, childContent }) => (
                    <div key={k} style={{ display: "flex", flexDirection: "column", gap: "0", borderRadius: "4px", border: `1px solid ${C.black}`, overflow: "hidden" }}>
                        <h6 style={{ fontSize: "13px", color: C.white, background: C.black, textTransform: "capitalize", padding: "8px 12px", margin: 0, fontWeight: 600 }}>
                            {k.replace(/([A-Z])/g, ' $1')}
                        </h6>
                        <div style={{ padding: "0" }}>
                            {childContent}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div style={{ marginTop: "24px", marginBottom: "24px", border: `1px solid ${C.fog}`, background: C.white, borderRadius: "4px" }}>
            <div
                style={{
                    padding: "16px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    background: C.ghost,
                    borderBottom: isExpanded ? `1px solid ${C.fog}` : "none"
                }}
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <div style={{ fontSize: "13px", color: C.smoke, fontWeight: 600, display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ transform: isExpanded ? "rotate(90deg)" : "none", transition: "transform 0.2s", fontSize: "10px" }}>▶</span>
                    View Previous Records ({historyData.length} completed)
                </div>
                <div style={{ fontSize: "12px", color: C.ash }}>
                    Click to {isExpanded ? 'collapse' : 'expand'}
                </div>
            </div>

            {isExpanded && (
                <div style={{ overflowX: "auto" }}>
                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                        <thead>
                            <tr style={{ background: C.ghost, borderBottom: `1px solid ${C.fog}` }}>
                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px", width: "80px" }}>SNO</th>
                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Date</th>
                                <th style={{ padding: "12px 16px", textAlign: "right", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px", width: "150px" }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {historyData.map((entry, idx) => {
                                const isLast = idx === historyData.length - 1;
                                return (
                                    <tr key={idx} style={{ borderBottom: isLast ? "none" : `1px solid ${C.fog}` }}>
                                        <td style={{ padding: "16px", fontSize: "13px", color: C.silver }}>{idx + 1}</td>
                                        <td style={{ padding: "16px", fontSize: "13px", color: C.charcoal, whiteSpace: "nowrap" }}>{entry?.savedAt ? new Date(entry.savedAt).toLocaleString() : '-'}</td>
                                        <td style={{ padding: "16px", textAlign: "right" }}>
                                            <button
                                                type="button"
                                                onClick={() => setDetailsModal({ title: "Full Record Details", content: entry.data })}
                                                style={{ padding: "6px 16px", fontSize: "11px", background: C.white, border: `1px solid ${C.charcoal}`, borderRadius: "4px", cursor: "pointer", color: C.charcoal, textTransform: "uppercase", fontWeight: 600, whiteSpace: "nowrap" }}
                                            >
                                                View Details
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            )}

            {detailsModal && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ background: C.white, borderRadius: "4px", border: `1px solid ${C.black}`, width: "90%", maxWidth: "600px", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", overflow: "hidden" }}>
                        <div style={{ padding: "12px 20px", background: C.black, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h3 style={{ margin: 0, fontSize: "15px", color: C.white, textTransform: "capitalize", fontWeight: 600 }}>{detailsModal.title}</h3>
                            <button type="button" onClick={() => setDetailsModal(null)} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: C.white }}>&times;</button>
                        </div>
                        <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", background: C.white }}>
                            {renderModalContent(detailsModal.content) || (
                                <div style={{ color: C.smoke, fontSize: "13px", fontStyle: "italic", textAlign: "center", padding: "20px" }}>
                                    No filled fields available in this record.
                                </div>
                            )}
                        </div>
                        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.black}`, display: "flex", justifyContent: "flex-end", background: C.ghost }}>
                            <button type="button" onClick={() => setDetailsModal(null)} style={{ padding: "8px 16px", background: C.black, color: C.white, border: "none", borderRadius: "4px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

const LAB_CATEGORIES = ["Haematology", "Renal", "Liver", "Metabolic", "Cardiac", "Virology"];

const STANDARD_LAB_FIELDS = [
    { key: "hb", label: "Haemoglobin (Hb)", unit: "g/dL", range: "12–18", category: "Haematology" },
    { key: "pcv", label: "PCV / Haematocrit", unit: "%", range: "36–52", category: "Haematology" },
    { key: "wbc", label: "WBC Count", unit: "×10³/µL", range: "4–11", category: "Haematology" },
    { key: "platelets", label: "Platelets", unit: "×10³/µL", range: "150–400", category: "Haematology" },
    { key: "inr", label: "PT / INR", unit: "", range: "<1.5", category: "Haematology" },
    { key: "aptt", label: "aPTT", unit: "sec", range: "25–35", category: "Haematology" },
    { key: "creatinine", label: "Serum Creatinine", unit: "mg/dL", range: "0.6–1.2", category: "Renal" },
    { key: "blood_urea", label: "Blood Urea", unit: "mg/dL", range: "7–20", category: "Renal" },
    { key: "sodium", label: "Serum Na⁺", unit: "mEq/L", range: "136–145", category: "Renal" },
    { key: "potassium", label: "Serum K⁺", unit: "mEq/L", range: "3.5–5.0", category: "Renal" },
    { key: "bilirubin", label: "Total Bilirubin", unit: "mg/dL", range: "0.2–1.2", category: "Liver" },
    { key: "sgot", label: "SGOT / AST", unit: "U/L", range: "<40", category: "Liver" },
    { key: "sgpt", label: "SGPT / ALT", unit: "U/L", range: "<40", category: "Liver" },
    { key: "albumin", label: "Serum Albumin", unit: "g/dL", range: "3.5–5.0", category: "Liver" },
    { key: "rbs", label: "Random Blood Sugar", unit: "mg/dL", range: "<180", category: "Metabolic" },
    { key: "hba1c", label: "HbA1c", unit: "%", range: "<7.0", category: "Metabolic" },
    { key: "calcium", label: "Serum Calcium", unit: "mg/dL", range: "8.5–10.5", category: "Metabolic" },
    { key: "ecg", label: "ECG Result", unit: "", range: "", category: "Cardiac" },
    { key: "echo_lvef", label: "Echo LVEF", unit: "%", range: ">55", category: "Cardiac" },
    { key: "bnp", label: "BNP", unit: "pg/mL", range: "<100", category: "Cardiac" },
    { key: "hiv", label: "HIV", unit: "", range: "Negative", category: "Virology" },
    { key: "hbsag", label: "HBsAg", unit: "", range: "Negative", category: "Virology" },
    { key: "hcv", label: "HCV", unit: "", range: "Negative", category: "Virology" },
];

// ─── Standard Radiology Fields ──────────────────────────────────────────────────
const STANDARD_RAD_FIELDS = [
    { key: "ct_scan", label: "CT Scan (Computed Tomography)" },
    { key: "mri", label: "MRI (Magnetic Resonance Imaging)" },
    { key: "pet_scan", label: "PET Scan (Positron Emission Tomography)" },
    { key: "pet_ct", label: "PET-CT" },
    { key: "xray", label: "X-Ray" },
    { key: "usg", label: "Ultrasound (USG)" },
    { key: "mammography", label: "Mammography" },
    { key: "bone_scan", label: "Bone Scan" },
    { key: "spect_scan", label: "SPECT Scan" },
    { key: "fluoroscopy", label: "Fluoroscopy" },
    { key: "angiography", label: "Angiography" },
];

// Stable reference so <LabInvestigations>'s bookingData effect doesn't re-run every render.
const EMPTY_BOOKING_DATA = {};

export default function RadiationTherapyWorkflow({ patientId: propPatientId, doctorId: propDoctorId, hospitalId: propHospitalId, excludeTabs = [], defaultTab, showFormTabs = false, hideVoiceDictation = false }) {
    const searchParams = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams();
    const patientId = propPatientId || searchParams.get('patientId') || searchParams.get('patient_id');
    const doctorId = propDoctorId || searchParams.get('doctorId') || searchParams.get('doctor_id');
    const hospitalId = propHospitalId || searchParams.get('hospitalId') || searchParams.get('hospital_id');
    const [activeTab, setActiveTab] = useState(defaultTab || "patient");
    const [formData, setFormData] = useState({
        patient: { previousTreatments: [{}], allergies: [{}] },
        intent: { targetVolumes: [{}], organsAtRisk: [{}] },
        treatment: { beamParameters: [{}] },
        setup: { immobilizationDevices: [{}] },
        summary: { toxicities: [{ toxicity: "", grade: "" }] },
        staff: { staffMembers: [{ name: "", role: "", licenseNumber: "", contact: "" }] },
        sessions: { treatmentSessions: [{ date: "", time: "", machine: "", deliveredDoseGy: "", treatmentTimeMin: "", notes: "", _isNew: true }] }
    });
    const [chemoFlags, setChemoFlags] = useState(null);
    const [labDetailsModal, setLabDetailsModal] = useState(null);
    const [labUploadLoading, setLabUploadLoading] = useState(false);
    const [labUploadError, setLabUploadError] = useState(null);
    const labFileInputRef = useRef(null);
    const [fetchedDoctorName, setFetchedDoctorName] = useState("");
    const [newLabField, setNewLabField] = useState({ label: "", unit: "", range: "" });
    const [newRadField, setNewRadField] = useState({ label: "", unit: "", range: "" });
    const [labOrderStatus, setLabOrderStatus] = useState("none");
    const [radOrderStatus, setRadOrderStatus] = useState("none");
    const [investigationsHistory, setInvestigationsHistory] = useState([]);
    const [completedDocuments, setCompletedDocuments] = useState([]);
    const [expandedInvCells, setExpandedInvCells] = useState({});
    const [invViewDialog, setInvViewDialog] = useState({ open: false, data: null });
    const [valuesDialog, setValuesDialog] = useState({ open: false, inv: null });
    const [labSuggestionsLoading, setLabSuggestionsLoading] = useState(false);
    const hasFetchedAI = useRef(false);
    const [radSuggestionsLoading, setRadSuggestionsLoading] = useState(false);
    const hasFetchedRadAI = useRef(false);
    const [showReportModal, setShowReportModal] = useState(false);
    const [expandedReportSections, setExpandedReportSections] = useState({ patient: true, baseline: true, intent: true, setup: true, simulation: true, treatment: true, imaging: true });
    const [uploadingInvId, setUploadingInvId] = useState(null);
    const [patientRegDetails, setPatientRegDetails] = useState(null);
    const [isGeneratingDiagnosis, setIsGeneratingDiagnosis] = useState(false);

    const handleInvestigationUpload = async (e, inv) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const invId = inv.id;
        if (!invId) {
            alert("Investigation ID missing.");
            return;
        }

        setUploadingInvId(invId);
        try {
            await uploadInvestigationFile(patientId, doctorId, invId, file);
            alert("File uploaded successfully.");
            fetchInvestigations();
            fetchCompletedDocuments();
        } catch (err) {
            console.error(err);
            alert(err.message || "Upload failed.");
        } finally {
            setUploadingInvId(null);
            e.target.value = null;
        }
    };

    const handleGenerateDiagnosis = async () => {
        if (!patientId) {
            alert("Patient ID is missing.");
            return;
        }
        setIsGeneratingDiagnosis(true);
        try {
            const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/generate-diagnosis-summary/${patientId}`);
            if (!res.ok) {
                const errData = await res.json().catch(() => ({}));
                throw new Error(errData.detail || "Failed to generate diagnosis summary");
            }
            const json = await res.json();
            if (json.status === "success" && json.diagnosis_summary) {
                handleUpdate("patient", "diagnosis", json.diagnosis_summary);
            } else {
                alert("Could not generate summary.");
            }
        } catch (err) {
            console.error(err);
            alert("Error generating diagnosis summary: " + err.message);
        } finally {
            setIsGeneratingDiagnosis(false);
        }
    };

    // Voice Dictation State
    const [isRecording, setIsRecording] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAutofilling, setIsAutofilling] = useState(false);
    const [transcript, setTranscript] = useState("");
    const mediaRecorderRef = useRef(null);
    const audioChunksRef = useRef([]);

    const fetchLabSuggestions = async (refresh = false) => {
        if (!patientId) return;
        setLabSuggestionsLoading(true);
        try {
            const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/suggest-lab-investigations/${patientId}?refresh=${refresh}`);
            const json = await res.json();
            if (json.status === "success" && json.data) {
                const suggestion = json.data;

                setFormData(prev => {
                    const currentFields = [...(prev.baseline?.labOrderFields || STANDARD_LAB_FIELDS.map(f => ({ ...f, selected: false })))];
                    let updatedFields = currentFields;

                    if (suggestion.recommended_tests && Array.isArray(suggestion.recommended_tests)) {
                        updatedFields = currentFields.map(f => ({
                            ...f,
                            selected: suggestion.recommended_tests.includes(f.key) || f.selected
                        }));
                    }

                    return {
                        ...prev,
                        baseline: {
                            ...(prev.baseline || {}),
                            labClinicalIndication: suggestion.clinical_indication || prev.baseline?.labClinicalIndication,
                            labOrderFields: updatedFields
                        }
                    };
                });
            }
        } catch (err) {
            console.error("Failed to fetch lab AI suggestions", err);
        } finally {
            setLabSuggestionsLoading(false);
        }
    };

    const fetchRadSuggestions = async (refresh = false) => {
        if (!patientId) return;
        setRadSuggestionsLoading(true);
        try {
            const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/suggest-rad-investigations/${patientId}?refresh=${refresh}`);
            const json = await res.json();
            if (json.status === "success" && json.data) {
                const suggestion = json.data;

                setFormData(prev => {
                    const currentFields = [...(prev.baseline?.radOrderFields || STANDARD_RAD_FIELDS.map(f => ({ ...f, selected: false })))];
                    let updatedFields = currentFields;

                    if (suggestion.recommended_tests && Array.isArray(suggestion.recommended_tests)) {
                        updatedFields = currentFields.map(f => ({
                            ...f,
                            selected: suggestion.recommended_tests.includes(f.key) || f.selected
                        }));
                    }

                    return {
                        ...prev,
                        baseline: {
                            ...(prev.baseline || {}),
                            radClinicalIndication: suggestion.clinical_indication || prev.baseline?.radClinicalIndication,
                            radOrderFields: updatedFields
                        }
                    };
                });
            }
        } catch (err) {
            console.error("Failed to fetch radiology AI suggestions", err);
        } finally {
            setRadSuggestionsLoading(false);
        }
    };

    useEffect(() => {
        if (patientId) {
            if (!hasFetchedAI.current) {
                hasFetchedAI.current = true;
                fetchLabSuggestions(false);
            }
            if (!hasFetchedRadAI.current) {
                hasFetchedRadAI.current = true;
                fetchRadSuggestions(false);
            }
        }
    }, [patientId]);

    const handleUpdate = (section, field, value) => {
        setFormData(prev => ({
            ...prev,
            [section]: {
                ...(prev[section] || {}),
                [field]: value
            }
        }));
    };

    const handleArrayAdd = (section, field, initialItem) => {
        setFormData(prev => {
            const arr = prev[section]?.[field] || [];
            return {
                ...prev,
                [section]: {
                    ...(prev[section] || {}),
                    [field]: [...arr, initialItem]
                }
            };
        });
    };

    const handleArrayUpdate = (section, field, index, itemField, value) => {
        setFormData(prev => {
            const arr = [...(prev[section]?.[field] || [])];
            if (!arr[index]) {
                arr[index] = {};
            }
            arr[index] = { ...arr[index], [itemField]: value };
            return {
                ...prev,
                [section]: {
                    ...(prev[section] || {}),
                    [field]: arr
                }
            };
        });
    };

    const handleArrayRemove = (section, field, index) => {
        setFormData(prev => {
            const arr = [...(prev[section]?.[field] || [])];
            arr.splice(index, 1);
            return {
                ...prev,
                [section]: {
                    ...(prev[section] || {}),
                    [field]: arr
                }
            };
        });
    };

    const fetchInvestigations = () => {
        if (!patientId) return;
        getInvestigations(patientId)
            .then(res => {
                if (res.data) setInvestigationsHistory(res.data);
            })
            .catch(err => console.error("Failed to fetch investigations:", err));
    };

    const fetchCompletedDocuments = () => {
        if (!patientId || !doctorId) return;
        getCompletedInvestigationDocuments(patientId, doctorId)
            .then(res => {
                if (res && res.data) setCompletedDocuments(res.data);
            })
            .catch(err => console.error("Failed to fetch completed documents:", err));
    };

    useEffect(() => {
        fetchInvestigations();
        fetchCompletedDocuments();
    }, [patientId, doctorId]);

    useEffect(() => {
        if (!patientId) return;
        const fetchChemoFlags = async () => {
            console.log(`[ChemoAlert] Fetching chemo suspension details for patientId: ${patientId}`);
            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                const url = `${API_BASE_URL}hms/users/data/context/get-chemo-suspension-details/${patientId}`;
                console.log(`[ChemoAlert] API URL: ${url}`);
                const res = await fetch(url);
                const json = await res.json();
                console.log(`[ChemoAlert] API Response:`, json);
                if (json.status === "success" && json.data) {
                    console.log(`[ChemoAlert] Setting chemo flags data:`, json.data);
                    setChemoFlags(json.data);
                } else {
                    console.warn(`[ChemoAlert] Failed to get valid data from response.`);
                }
            } catch (err) {
                console.error("[ChemoAlert] Failed to fetch chemo suspension details:", err);
            }
        };
        fetchChemoFlags();
    }, [patientId]);

    // ── Fetch patient registration details ──────────────────────────────────────
    useEffect(() => {
        if (!patientId) return;
        const fetchPatientDetails = async () => {
            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                const url = `${API_BASE_URL}hms/users/data/context/get-patient-registration-details?patientId=${patientId}`;
                console.log("[PatientInfo] Fetching patient registration details:", url);
                const res = await fetch(url);
                const json = await res.json();
                console.log("[PatientInfo] API response:", json);
                if (json.status === "success" && json.data) {
                    console.log("[PatientInfo] Patient data received:", json.data);
                    setPatientRegDetails(json.data);
                } else {
                    console.warn("[PatientInfo] No patient data found or unexpected status:", json);
                }
            } catch (err) {
                console.error("[PatientInfo] Failed to fetch patient registration details:", err);
            }
        };
        fetchPatientDetails();
    }, [patientId]);

    // ── Auto-populate Patient Info fields from DB ───────────────────────────────
    useEffect(() => {
        if (!patientRegDetails) return;
        console.log("[PatientInfo] Autopopulating fields with:", patientRegDetails);

        // Case-insensitive lookup for hms_id (handles hms_id / HMS_id / hmsId etc.)
        const hmsIdKey = Object.keys(patientRegDetails).find(k => k.toLowerCase() === "hms_id");
        const hmsId = hmsIdKey ? patientRegDetails[hmsIdKey] : "";
        console.log("[PatientInfo] hms_id key found:", hmsIdKey, "-> value:", hmsId);

        // Calculate age from date_of_birth
        let calculatedAge = "";
        if (patientRegDetails.date_of_birth) {
            const dob = new Date(patientRegDetails.date_of_birth);
            const today = new Date();
            let age = today.getFullYear() - dob.getFullYear();
            const m = today.getMonth() - dob.getMonth();
            if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--;
            calculatedAge = String(age >= 0 ? age : "");
            console.log("[PatientInfo] DOB:", patientRegDetails.date_of_birth, "-> Calculated age:", calculatedAge);
        }

        // Map gender to lowercase radio value
        const genderMap = { Male: "male", Female: "female", Transgender: "transgender" };
        const sex = genderMap[patientRegDetails.gender] || "";
        console.log("[PatientInfo] Gender from DB:", patientRegDetails.gender, "-> Mapped sex:", sex);

        setFormData(prev => {
            const populated = {
                ...(prev.patient || {}),
                // Always populate directly from DB — no priority comparison
                patientId: hmsId || "",
                "pat-age": calculatedAge,
                patientName: patientRegDetails.name || "",
                sex: sex,
                contact: patientRegDetails.phone_number || ""
            };
            console.log("[PatientInfo] Final patient object set into formData:", populated);
            return {
                ...prev,
                patient: populated
            };
        });
    }, [patientRegDetails]);


    useEffect(() => {
        if (!doctorId) return;
        const fetchDocName = async () => {
            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                const res = await fetch(`${API_BASE_URL}hms/users/doctors/get_doctor/${doctorId}`);
                if (res.ok) {
                    const json = await res.json();
                    const docData = json?.data || json?.doctor || json;
                    const name = docData?.name || docData?.doctor_name || `${docData?.first_name || ""} ${docData?.last_name || ""}`.trim();
                    if (name) {
                        setFetchedDoctorName(name);
                    }
                }
            } catch (e) {
                console.error("Failed to fetch doctor name", e);
            }
        };
        fetchDocName();
    }, [doctorId]);

    const handleLabFileUpload = async (event) => {
        const file = event.target.files?.[0];
        if (!file) return;

        setLabUploadLoading(true);
        setLabUploadError(null);

        try {
            const pdfjsLib = await new Promise((resolve, reject) => {
                if (window.pdfjsLib) return resolve(window.pdfjsLib);
                const script = document.createElement("script");
                script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
                script.onload = () => {
                    window.pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
                    resolve(window.pdfjsLib);
                };
                script.onerror = reject;
                document.body.appendChild(script);
            });

            const arrayBuffer = await file.arrayBuffer();
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let fullText = "";

            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const textContent = await page.getTextContent();
                const pageText = textContent.items.map(item => item.str).join(" ");
                fullText += pageText + "\n";
            }

            console.log("Extracted PDF Text:", fullText);

            if (!fullText.trim()) {
                console.log("No text layer found. Running OCR...");

                const Tesseract = await new Promise((resolve, reject) => {
                    if (window.Tesseract) return resolve(window.Tesseract);
                    const script = document.createElement("script");
                    script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
                    script.onload = () => resolve(window.Tesseract);
                    script.onerror = reject;
                    document.body.appendChild(script);
                });

                for (let i = 1; i <= pdf.numPages; i++) {
                    const page = await pdf.getPage(i);
                    const scale = 2.0;
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement("canvas");
                    canvas.width = viewport.width;
                    canvas.height = viewport.height;
                    const context = canvas.getContext("2d");

                    await page.render({ canvasContext: context, viewport }).promise;

                    const { data: { text } } = await Tesseract.recognize(canvas, 'eng');
                    fullText += text + "\n";
                }
                console.log("OCR Extracted Text:", fullText);
            }

            if (!fullText.trim()) {
                setLabUploadError("Could not extract text or OCR from this PDF.");
                return;
            }

            const tests = [];
            const rules = [
                { name: "Hemoglobin", regex: /HEMOGLOBIN.*?([\d.]+)/i, unit: "g/dL" },
                { name: "White blood cell count", regex: /TOTAL WBC COUNT.*?([\d.]+)/i, unit: "cells/cumm" },
                { name: "Absolute Neutrophil Count (ANC)", regex: /NEUTROPHIL#.*?([\d.]+)/i, unit: "10^3/uL" },
                { name: "Platelet count", regex: /PLATELET COUNT.*?([\d.]+)/i, unit: "lakhs/cumm" },
                { name: "Lymphocytes", regex: /LYMPHOCYTE#.*?([\d.]+)/i, unit: "10^3/uL" },
                { name: "Eosinophils", regex: /EOSINOPHIL#.*?([\d.]+)/i, unit: "10^3/uL" },
                { name: "Monocytes", regex: /MONOCYTE#.*?([\d.]+)/i, unit: "10^3/uL" },
                { name: "RBC Count", regex: /RBC COUNT.*?([\d.]+)/i, unit: "millions/cumm" },
                { name: "PCV", regex: /PCV.*?([\d.]+)/i, unit: "%" },
                { name: "MCV", regex: /MCV.*?([\d.]+)/i, unit: "fL" },
                { name: "MCH", regex: /MCH.*?([\d.]+)/i, unit: "pg" },
                { name: "APTT Test", regex: /APTT TEST.*?([\d.]+)/i, unit: "Secs" },
                { name: "PT INR", regex: /PT INR.*?([\d.]+)/i, unit: "" }
            ];

            rules.forEach(rule => {
                const match = fullText.match(rule.regex);
                if (match) {
                    const finalValue = rule.unit ? `${match[1]} ${rule.unit}` : match[1];
                    tests.push({
                        testName: rule.name,
                        remarks: `Extracted: ${finalValue}`,
                        status: "Completed"
                    });
                }
            });

            if (tests.length > 0) {
                setFormData(prev => {
                    let currentLabs = [...(prev.baseline?.labInvestigations || [])];

                    if (currentLabs.length > 0) {
                        // Update the last entry instead of creating a new row
                        const lastIndex = currentLabs.length - 1;
                        currentLabs[lastIndex] = {
                            ...currentLabs[lastIndex],
                            status: "Completed",
                            extractedData: tests
                        };
                    } else {
                        // If empty, create an initial entry
                        currentLabs.push({
                            testName: "Extracted Lab Report",
                            reason: "PDF Analysis",
                            remarks: "",
                            status: "Completed",
                            extractedData: tests
                        });
                    }

                    return {
                        ...prev,
                        baseline: { ...prev.baseline, labInvestigations: currentLabs }
                    };
                });
            } else {
                setLabUploadError("Could not detect any standard lab tests in this report.");
            }

        } catch (err) {
            console.error("PDF parsing error:", err);
            setLabUploadError("Failed to read the PDF. Please try again.");
        } finally {
            setLabUploadLoading(false);
            if (labFileInputRef.current) labFileInputRef.current.value = "";
        }
    };

    const handlePrintBaselineOrder = () => {
        const printWindow = window.open('', '_blank', 'width=800,height=800');
        if (!printWindow) return;

        const patientName = formData.patient?.patientName || "Unknown Patient";
        const patientIdDisplay = formData.patient?.patientId || patientId || "";
        const date = new Date().toLocaleDateString();
        const docName = fetchedDoctorName || "Doctor";

        let testsHtml = "";
        const tests = formData.baseline?.labInvestigations || [];
        if (tests.length > 0) {
            testsHtml = tests.map(t => `
                <tr>
                    <td style="padding: 10px; border: 1px solid #ddd;">${t.testName || ""}</td>
                    <td style="padding: 10px; border: 1px solid #ddd;">${t.reason || ""}</td>
                </tr>
            `).join("");
        } else {
            testsHtml = `<tr><td colspan="2" style="padding: 10px; border: 1px solid #ddd; text-align: center;">No tests added.</td></tr>`;
        }

        const html = `
            <html>
                <head>
                    <title>Laboratory Investigation Order</title>
                    <style>
                        body { font-family: Arial, sans-serif; padding: 40px; color: #333; }
                        .header { text-align: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px; }
                        .header h1 { margin: 0; font-size: 24px; text-transform: uppercase; letter-spacing: 1px; }
                        .patient-details { display: flex; justify-content: space-between; margin-bottom: 30px; background: #f9f9f9; padding: 15px; border-radius: 4px; }
                        .patient-details div { font-size: 14px; line-height: 1.6; }
                        table { width: 100%; border-collapse: collapse; margin-top: 20px; }
                        th { background: #f0f0f0; padding: 12px; text-align: left; border: 1px solid #ddd; font-weight: bold; }
                        .footer { margin-top: 50px; text-align: right; font-size: 14px; display: flex; justify-content: space-between; align-items: flex-end; }
                        .signature { border-top: 1px solid #333; padding-top: 5px; width: 200px; text-align: center; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>Investigation Order</h1>
                        <div style="font-size: 14px; color: #666; margin-top: 5px;">Dr. ${docName}</div>
                    </div>
                    <div class="patient-details">
                        <div>
                            <strong>Patient Name:</strong> ${patientName}<br/>
                            <strong>Patient ID:</strong> ${patientIdDisplay}
                        </div>
                        <div>
                            <strong>Date:</strong> ${date}
                        </div>
                    </div>
                    <h3>Requested Tests</h3>
                    <table>
                        <thead>
                            <tr>
                                <th style="width: 40%">Test Name</th>
                                <th style="width: 60%">Reason / Instructions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${testsHtml}
                        </tbody>
                    </table>
                    <div class="footer">
                        <div style="text-align: left; color: #666; font-size: 12px;">Printed via DrAssist</div>
                        <div class="signature">Doctor's Signature</div>
                    </div>
                    <script>
                        window.onload = () => {
                            window.print();
                            setTimeout(() => window.close(), 500);
                        };
                    </script>
                </body>
            </html>
        `;

        printWindow.document.write(html);
        printWindow.document.close();
    };

    React.useEffect(() => {
        const fetchExistingRecord = async () => {
            if (!patientId || !doctorId) return false;
            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                const hospital_id_param = hospitalId || "unknown";
                const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-radiotherapy-record?patientId=${patientId}&doctorId=${doctorId}&hospitalId=${hospital_id_param}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.data && Object.keys(json.data).length > 0) {
                        setFormData(prev => {
                            const merged = { ...prev };
                            for (const key in json.data) {
                                if (json.data[key] && typeof json.data[key] === 'object' && !Array.isArray(json.data[key])) {
                                    merged[key] = { ...(merged[key] || {}), ...json.data[key] };
                                } else {
                                    merged[key] = json.data[key];
                                }
                            }
                            return merged;
                        });
                        return true;
                    }
                }
            } catch (err) {
                console.error("Failed to fetch existing record:", err);
            }
            return false;
        };

        const autoPopulate = async () => {
            if (!patientId) return;
            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                const url = `${API_BASE_URL}hms/users/data/surgical-oncology/get-patient-info?patient_id=${patientId}`;
                console.log("Calling autoPopulate URL:", url);
                const res = await fetch(url);
                if (res.ok) {
                    const data = await res.json();
                    console.log("Fetched patient data for Basic Information:", data);
                    const names = (data.patient_name || "").split(" ");
                    const firstName = names[0] || "";
                    const lastName = names.slice(1).join(" ") || "";

                    setFormData(prev => ({
                        ...prev,
                        patient: {
                            ...(prev.patient || {}),
                            patientId: patientId,
                            firstName: firstName || prev.patient?.firstName,
                            lastName: lastName || prev.patient?.lastName,
                            patientName: data.patient_name || prev.patient?.patientName || (firstName ? `${firstName} ${lastName}`.trim() : ""),
                            "pat-age": data.age || prev.patient?.["pat-age"],
                            sex: (data.gender || "").toLowerCase() || prev.patient?.sex,
                            contact: data.contact || data.phone || data.mobile || data.phone_number || prev.patient?.contact
                        }
                    }));
                }
            } catch (err) {
                console.error("autoPopulate fetch:", err);
            }
        };

        const fetchSurgeryRecord = async () => {
            if (!patientId) return;
            try {
                const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                const res = await fetch(`${API_BASE_URL}hms/users/data/context/get-patient-surgery-summary?patientId=${patientId}`);
                if (res.ok) {
                    const json = await res.json();
                    if (json.status === "success" && json.data) {
                        setFormData(prev => ({
                            ...prev,
                            surgery_import: json.data
                        }));
                    }
                }
            } catch (err) {
                console.error("Failed to fetch surgery details:", err);
            }
        };

        const initializeData = async () => {
            await fetchExistingRecord();
            autoPopulate();
            fetchSurgeryRecord();
        };

        initializeData();
    }, [patientId, doctorId, hospitalId]);

    React.useEffect(() => {
        const height = parseFloat(formData.baseline?.['phy-height']);
        const weight = parseFloat(formData.baseline?.['phy-weight']);
        if (!isNaN(height) && !isNaN(weight) && height > 0 && weight > 0) {
            const bsa = Math.sqrt((height * weight) / 3600).toFixed(2);
            if (formData.baseline?.bodySurfaceAreaM !== bsa) {
                setFormData(prev => ({
                    ...prev,
                    baseline: {
                        ...(prev.baseline || {}),
                        bodySurfaceAreaM: bsa
                    }
                }));
            }
        }
    }, [formData.baseline?.['phy-height'], formData.baseline?.['phy-weight']]);

    const imagingShiftsLength = formData.imaging?.imagingShifts?.length || 0;
    // Ensure there is ALWAYS at least one new Imaging Shift form available
    React.useEffect(() => {
        if (activeTab === "imaging") {
            setFormData(prev => {
                const shifts = prev.imaging?.imagingShifts || [];
                const hasNewForm = shifts.some(s => s._isNew);
                if (!hasNewForm) {
                    return {
                        ...prev,
                        imaging: {
                            ...(prev.imaging || {}),
                            imagingShifts: [
                                ...shifts,
                                {
                                    "date": "",
                                    "shiftXMm": "",
                                    "shiftYMm": "",
                                    "shiftZMm": "",
                                    "rotation": "",
                                    "residualErrorAfterShift": "",
                                    "session": "",
                                    "isocenterShifts": "",
                                    "_isNew": true
                                }
                            ]
                        }
                    };
                }
                return prev;
            });
        }
    }, [activeTab, imagingShiftsLength]);

    const beamParametersLength = formData.treatment?.beamParameters?.length || 0;
    // Ensure there is ALWAYS at least one Beam Parameter form available in Treatment Plan
    React.useEffect(() => {
        if (activeTab === "treatment") {
            setFormData(prev => {
                const params = prev.treatment?.beamParameters || [];
                if (params.length === 0) {
                    return {
                        ...prev,
                        treatment: {
                            ...(prev.treatment || {}),
                            beamParameters: [{}]
                        }
                    };
                }
                return prev;
            });
        }
    }, [activeTab, beamParametersLength]);

    const immobilizationDevicesLength = formData.setup?.immobilizationDevices?.length || 0;
    // Ensure there is ALWAYS at least one Immobilization Device form available in Patient Setup
    React.useEffect(() => {
        if (activeTab === "setup") {
            setFormData(prev => {
                const devices = prev.setup?.immobilizationDevices || [];
                if (devices.length === 0) {
                    return {
                        ...prev,
                        setup: {
                            ...(prev.setup || {}),
                            immobilizationDevices: [{}]
                        }
                    };
                }
                return prev;
            });
        }
    }, [activeTab, immobilizationDevicesLength]);

    const previousTreatmentsLength = formData.patient?.previousTreatments?.length || 0;
    const allergiesLength = formData.patient?.allergies?.length || 0;
    // Ensure there is ALWAYS at least one Previous Treatment and Allergy form available in Patient Info
    React.useEffect(() => {
        if (activeTab === "patient") {
            setFormData(prev => {
                const prevTreatments = prev.patient?.previousTreatments || [];
                const allergyList = prev.patient?.allergies || [];
                if (prevTreatments.length === 0 || allergyList.length === 0) {
                    return {
                        ...prev,
                        patient: {
                            ...(prev.patient || {}),
                            previousTreatments: prevTreatments.length === 0 ? [{}] : prevTreatments,
                            allergies: allergyList.length === 0 ? [{}] : allergyList
                        }
                    };
                }
                return prev;
            });
        }
    }, [activeTab, previousTreatmentsLength, allergiesLength]);

    const getCleanedFormData = () => {
        const cleaned = JSON.parse(JSON.stringify(formData));

        // Helper to check if an object is effectively empty
        const isEmptyItem = (obj) => {
            if (!obj || typeof obj !== 'object') return true;
            const { _isNew, ...rest } = obj; // Ignore _isNew flag when checking
            return Object.values(rest).every(v => v === null || v === undefined || String(v).trim() === "");
        };

        if (cleaned.sessions?.treatmentSessions) {
            cleaned.sessions.treatmentSessions = cleaned.sessions.treatmentSessions
                .filter(s => !isEmptyItem(s))
                .map(s => {
                    const { _isNew, ...rest } = s;
                    return rest;
                });
        }
        if (cleaned.imaging?.imagingShifts) {
            cleaned.imaging.imagingShifts = cleaned.imaging.imagingShifts
                .filter(s => !isEmptyItem(s))
                .map(s => {
                    const { _isNew, ...rest } = s;
                    return rest;
                });
        }

        // Filter out empty items from arrays that might be open by default
        if (cleaned.patient?.previousTreatments) {
            cleaned.patient.previousTreatments = cleaned.patient.previousTreatments.filter(item => !isEmptyItem(item));
        }
        if (cleaned.patient?.allergies) {
            cleaned.patient.allergies = cleaned.patient.allergies.filter(item => !isEmptyItem(item));
        }
        if (cleaned.intent?.targetVolumes) {
            cleaned.intent.targetVolumes = cleaned.intent.targetVolumes.filter(item => !isEmptyItem(item));
        }
        if (cleaned.intent?.organsAtRisk) {
            cleaned.intent.organsAtRisk = cleaned.intent.organsAtRisk.filter(item => !isEmptyItem(item));
        }
        if (cleaned.setup?.immobilizationDevices) {
            cleaned.setup.immobilizationDevices = cleaned.setup.immobilizationDevices.filter(item => !isEmptyItem(item));
        }
        if (cleaned.treatment?.beamParameters) {
            cleaned.treatment.beamParameters = cleaned.treatment.beamParameters.filter(item => !isEmptyItem(item));
        }

        return cleaned;
    };

    const handleTabSave = async (tabId) => {
        try {
            const cleanedData = getCleanedFormData();
            const payloadData = { ...cleanedData };
            delete payloadData.history; // Prevent backend from overwriting new history

            const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/save-radiotherapy-record`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    doctorId: doctorId || "unknown",
                    patientId: patientId || "unknown",
                    hospitalId: hospitalId || "unknown",
                    formData: payloadData,
                    isComplete: false
                })
            });
            if (res.ok) {
                alert("Tab data saved successfully!");
                // Fetch updated history to show it immediately
                try {
                    const hospital_id_param = hospitalId || "unknown";
                    const fetchRes = await fetch(`${API_BASE_URL}hms/users/data/context/get-radiotherapy-record?patientId=${patientId}&doctorId=${doctorId}&hospitalId=${hospital_id_param}`);
                    if (fetchRes.ok) {
                        const json = await fetchRes.json();
                        if (json.data && json.data.history) {
                            cleanedData.history = json.data.history;
                        }
                    }
                } catch (e) {
                    console.error("Failed to fetch updated history", e);
                }
                setFormData(prev => ({ ...cleanedData, history: cleanedData.history || prev.history }));
            } else {
                alert("Failed to save tab data.");
            }
        } catch (err) {
            console.error("Save error:", err);
            alert("Error saving tab data.");
        }
    };

    const handleSaveRecord = async () => {
        try {
            const cleanedData = getCleanedFormData();
            const payloadData = { ...cleanedData };
            delete payloadData.history; // Prevent backend from overwriting new history

            const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/save-radiotherapy-record`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    doctorId: doctorId || "unknown",
                    patientId: patientId || "unknown",
                    hospitalId: hospitalId || "unknown",
                    formData: payloadData,
                    isComplete: true
                })
            });
            if (res.ok) {
                alert("Radiotherapy complete record saved successfully!");
                setFormData({});
            } else {
                alert("Failed to save complete radiotherapy record.");
            }
        } catch (err) {
            console.error("Save error:", err);
            alert("Error saving complete record.");
        }
    };

    const allTabs = [
        { id: "patient", label: "Patient Info" },
        { id: "baseline", label: "Baseline" },
        { id: "intent", label: "Treatment Intent" },
        { id: "setup", label: "Patient Setup" },
        { id: "simulation", label: "Simulation" },
        { id: "treatment", label: "Treatment Plan" },
        { id: "sessions", label: "Sessions" },
        { id: "imaging", label: "Image Guidance" },
        { id: "qa", label: "QA" },
        { id: "notes", label: "Notes" },
        { id: "summary", label: "Summary" },
        { id: "staff", label: "Staff" }
    ];
    // Form tabs are hidden by default (standalone page). Pass showFormTabs={true} when embedding
    // inside RadiotherapyRecord.jsx to keep them visible in the procedure details section.
    const FORM_TABS = ["baseline", "intent", "setup", "simulation", "treatment", "imaging", "summary", "staff"];
    const effectiveExcludeTabs = showFormTabs
        ? excludeTabs
        : [...excludeTabs, ...FORM_TABS.filter(t => !excludeTabs.includes(t))];
    const tabs = allTabs.filter(t => !effectiveExcludeTabs.includes(t.id));

    const renderTabButton = (tab) => (
        <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
                padding: "8px 16px",
                fontSize: "13px",
                cursor: "pointer",
                borderRadius: "4px",
                border: `1px solid ${activeTab === tab.id ? C.black : 'transparent'}`,
                background: activeTab === tab.id ? C.black : 'transparent',
                color: activeTab === tab.id ? C.white : C.smoke,
                ...os({ fontWeight: activeTab === tab.id ? 600 : 400 })
            }}
        >
            {tab.label}
        </button>
    );

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
                    const formDataObj = new FormData();
                    formDataObj.append("file", audioBlob, "recording.webm");
                    const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api/";
                    const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, { method: "POST", body: formDataObj });
                    const data = await res.json();
                    const transcribedText = data.text || data.transcription || "";
                    if (transcribedText) {
                        setTranscript(transcribedText);
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
            const res = await fetch(`${API_BASE_URL}hms/users/data/context/radiotherapy-workflow/structure`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ text: transcript })
            });
            const json = await res.json();
            if (json.status === "success" && json.data) {
                console.log("LLM Autofill Data:", json.data);

                // Recursively trim string spaces and enforce lowercase for specific dropdowns
                const sanitize = (obj) => {
                    if (typeof obj === 'string') return obj.trim();
                    if (Array.isArray(obj)) return obj.map(sanitize);
                    if (typeof obj === 'object' && obj !== null) {
                        const newObj = {};
                        for (let originalKey in obj) {
                            // Normalize key to camelCase and strip spaces/underscores (e.g. "Treatment Intent" -> "treatmentIntent")
                            let cleanKey = originalKey;
                            let k = originalKey;

                            // Do not strip hyphens for baseline keys
                            if (!originalKey.startsWith('phy-') && originalKey !== 'phy_performance') {
                                cleanKey = originalKey.replace(/[^a-zA-Z0-9]/g, '');
                                k = cleanKey.charAt(0).toLowerCase() + cleanKey.slice(1);
                            }

                            let val = typeof obj[originalKey] === 'string' ? obj[originalKey].trim() : sanitize(obj[originalKey]);

                            // Ensure enums exactly match the dropdown values (lowercase)
                            if (typeof val === 'string' && ['treatmentIntent', 'treatmentSetting', 'treatmentType', 'setupVerificationMethod', 'simulationType', 'contrastUsed', 'verificationMethod', 'frequency'].includes(k)) {
                                val = val.toLowerCase();
                            }
                            // Extract just the number if AI accidentally included text like "40 Gy"
                            if (typeof val === 'string' && ['totalDose', 'dosePerFraction', 'numFractions', 'treatmentDuration', 'doseGridResolutionMm', 'sliceThicknessMm', 'shiftXMm', 'shiftYMm', 'shiftZMm', 'rotation', 'session', 'actionLevelMm', 'toleranceLevelMm'].includes(k)) {
                                const numMatch = val.match(/[-+]?[0-9]*\.?[0-9]+/);
                                if (numMatch) val = parseFloat(numMatch[0]);
                            }
                            newObj[k] = val;
                        }
                        return newObj;
                    }
                    return obj;
                };

                const cleanData = sanitize(json.data);

                setFormData(prev => {
                    const newFormData = {
                        ...prev,
                        patient: {
                            ...(prev.patient || {}),
                            ...(cleanData.patient || {}),
                            previousTreatments: (cleanData.patient?.previousTreatments && cleanData.patient.previousTreatments.length > 0) ? cleanData.patient.previousTreatments : ((prev.patient?.previousTreatments && prev.patient.previousTreatments.length > 0) ? prev.patient.previousTreatments : [{}]),
                            allergies: (cleanData.patient?.allergies && cleanData.patient.allergies.length > 0) ? cleanData.patient.allergies : ((prev.patient?.allergies && prev.patient.allergies.length > 0) ? prev.patient.allergies : [{}])
                        },
                        baseline: { ...(prev.baseline || {}), ...(cleanData.baseline || {}) },
                        intent: {
                            ...(prev.intent || {}),
                            ...(cleanData.intent || {}),
                            targetVolumes: (cleanData.intent?.targetVolumes && cleanData.intent.targetVolumes.length > 0) ? cleanData.intent.targetVolumes : ((prev.intent?.targetVolumes && prev.intent.targetVolumes.length > 0) ? prev.intent.targetVolumes : [{}]),
                            organsAtRisk: (cleanData.intent?.organsAtRisk && cleanData.intent.organsAtRisk.length > 0) ? cleanData.intent.organsAtRisk : ((prev.intent?.organsAtRisk && prev.intent.organsAtRisk.length > 0) ? prev.intent.organsAtRisk : [{}])
                        },
                        treatment: {
                            ...(prev.treatment || {}),
                            ...(cleanData.treatment || {}),
                            beamParameters: (cleanData.treatment?.beamParameters && cleanData.treatment.beamParameters.length > 0) ? cleanData.treatment.beamParameters : ((prev.treatment?.beamParameters && prev.treatment.beamParameters.length > 0) ? prev.treatment.beamParameters : [{}])
                        },
                        setup: {
                            ...(prev.setup || {}),
                            ...(cleanData.setup || {}),
                            immobilizationDevices: (cleanData.setup?.immobilizationDevices && cleanData.setup.immobilizationDevices.length > 0) ? cleanData.setup.immobilizationDevices : ((prev.setup?.immobilizationDevices && prev.setup.immobilizationDevices.length > 0) ? prev.setup.immobilizationDevices : [{}])
                        },
                        simulation: { ...(prev.simulation || {}), ...(cleanData.simulation || {}) },
                        imaging: { ...(prev.imaging || {}), ...(cleanData.imaging || {}) }
                    };

                    // Handle image guidance shifts array appending
                    if (cleanData.imaging && cleanData.imaging.imagingShifts && Array.isArray(cleanData.imaging.imagingShifts)) {
                        const currentShifts = Array.isArray(newFormData.imaging.imagingShifts) ? [...newFormData.imaging.imagingShifts] : [];
                        const newShifts = cleanData.imaging.imagingShifts.map(shift => ({
                            date: shift.date || "",
                            shiftXMm: shift.shiftXMm || "",
                            shiftYMm: shift.shiftYMm || "",
                            shiftZMm: shift.shiftZMm || "",
                            rotation: shift.rotation || "",
                            residualErrorAfterShift: shift.residualErrorAfterShift || "",
                            session: shift.session || "",
                            isocenterShifts: shift.isocenterShifts || "",
                            _isNew: true
                        }));
                        newFormData.imaging.imagingShifts = [...currentShifts, ...newShifts];
                    }

                    return newFormData;
                });
            }
        } catch (err) {
            console.error("Error structuring data:", err);
            alert("Error structuring data.");
        } finally {
            setIsAutofilling(false);
        }
    };

    return (
        <div style={{ ...card, marginTop: 16 }}>
            {/* Dictation Box — only shown when embedded in procedure details */}
            {(showFormTabs && !hideVoiceDictation) && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginBottom: '24px', padding: '16px', border: `1px solid ${C.fog}`, borderRadius: '4px', background: C.ghost }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h5 style={{ margin: 0, fontSize: '15px', color: C.charcoal, fontWeight: 600, ...os() }}>Voice Dictation</h5>
                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            disabled={isProcessing || isAutofilling}
                            style={{
                                ...primaryButtonStyle,
                                background: isRecording ? '#cf1322' : C.black,
                                display: 'flex', alignItems: 'center', gap: '8px', opacity: (isProcessing || isAutofilling) ? 0.7 : 1
                            }}
                        >
                            {isRecording ? <StopRounded style={{ fontSize: '16px' }} /> : <MicRounded style={{ fontSize: '16px' }} />}
                            {isProcessing ? "Processing..." : isRecording ? "Stop Recording" : "Transcribe"}
                        </button>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        <textarea
                            style={{ ...inputStyle, minHeight: '80px' }}
                            placeholder="Transcript will appear here..."
                            value={transcript}
                            onChange={e => setTranscript(e.target.value)}
                        ></textarea>
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={handleAutofill}
                                disabled={isAutofilling || !transcript}
                                style={{ ...primaryButtonStyle, opacity: (isAutofilling || !transcript) ? 0.7 : 1 }}
                            >
                                {isAutofilling ? "Autofilling..." : "AI Autofill"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Tabs */}
            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: 24, borderBottom: `1px solid ${C.fog}`, paddingBottom: 16 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                    {tabs.map(renderTabButton)}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", marginTop: "16px" }}>
                    <div style={{ display: "flex", gap: "12px" }}>
                        <button style={buttonStyle} onClick={() => setFormData({})}>Cancel</button>
                        <button style={primaryButtonStyle} onClick={handleSaveRecord}>Save Record</button>
                    </div>
                </div>
            </div>

            {/* Content */}
            <div style={{ background: C.white }}>
                {activeTab === "MetricaDashboard" && (
                    <div className="tab-pane-content">
                        <div>
                            <div>
                                <h5 style={headerStyle}>Patient</h5>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "MetricaApps" && (
                    <div className="tab-pane-content">
                        <div>
                            <div>
                                <h5 style={headerStyle}>Preferences & Settings</h5>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "MetricaPatients" && (
                    <div className="tab-pane-content">
                        <div>
                            <div>
                                <h5 style={headerStyle}>Patient Registration</h5>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "MetricaAuthentication" && (
                    <div className="tab-pane-content">
                        <div>
                            <div>
                                <h5 style={headerStyle}>Settings</h5>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "Metricaprogram" && (
                    <div className="tab-pane-content">
                        <div>

                        </div>

                    </div>
                )}
                {activeTab === "patient" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.patient} />

                        {chemoFlags && (chemoFlags.suspendedCycles?.length > 0 || chemoFlags.incompleteTreatmentDetails) && (
                            <div style={{ marginBottom: "20px", padding: "16px", border: "1px solid #ff4d4f", borderRadius: "4px", backgroundColor: "#fff1f0", color: "#cf1322" }}>
                                <h4 style={{ margin: "0 0 12px 0", fontSize: "16px", fontWeight: "600", display: "flex", alignItems: "center", gap: "8px" }}>
                                    <span style={{ fontSize: "20px" }}>⚠️</span> Chemotherapy Alert
                                </h4>

                                {chemoFlags.suspendedCycles?.length > 0 && (
                                    <div style={{ marginBottom: "12px" }}>
                                        <h5 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: "600" }}>Suspended/Postponed Cycles</h5>
                                        <ul style={{ margin: 0, paddingLeft: "20px", fontSize: "13px" }}>
                                            {chemoFlags.suspendedCycles.map((cycle, i) => (
                                                <li key={i} style={{ marginBottom: "4px" }}>
                                                    <strong>Cycle {cycle.cycle}</strong> - {cycle.status}: {cycle.reason}
                                                    {(cycle.fromDate || cycle.date) && ` (${cycle.fromDate || cycle.date}${cycle.untilDate ? ` to ${cycle.untilDate}` : ''})`}
                                                </li>
                                            ))}
                                        </ul>
                                    </div>
                                )}

                                {chemoFlags.incompleteTreatmentDetails && (
                                    <div>
                                        <h5 style={{ margin: "0 0 8px 0", fontSize: "14px", fontWeight: "600" }}>Treatment Not Completed As Planned</h5>
                                        <div style={{ fontSize: "13px" }}>
                                            <div><strong>Planned Cycles:</strong> {chemoFlags.incompleteTreatmentDetails.plannedCycles}</div>
                                            <div><strong>Completed Cycles:</strong> {chemoFlags.incompleteTreatmentDetails.completedCycles}</div>
                                            {chemoFlags.incompleteTreatmentDetails.reason && (
                                                <div><strong>Reason for Discontinuation:</strong> {chemoFlags.incompleteTreatmentDetails.reason}</div>
                                            )}
                                            {chemoFlags.incompleteTreatmentDetails.notes && (
                                                <div><strong>Notes:</strong> {chemoFlags.incompleteTreatmentDetails.notes}</div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        <div>
                            <h5 style={headerStyle}>Basic Information</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Patient ID</label>
                                    <input type="text" style={inputStyle} placeholder="Enter patient ID" value={formData.patient?.patientId || ""} onChange={e => handleUpdate("patient", "patientId", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <div>
                                        <label style={labelStyle}>Age</label>
                                        <input type="number" style={inputStyle} placeholder="" value={formData.patient?.["pat-age"] || ""} onChange={e => handleUpdate("patient", "pat-age", e.target.value)} />

                                    </div>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Name</label>
                                    <input type="text" style={inputStyle} placeholder="Enter patient name" value={formData.patient?.patientName || ""} onChange={e => handleUpdate("patient", "patientName", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Sex</label>
                                    <div style={{ display: "flex", gap: "20px", marginTop: "8px" }}>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <input type="radio" id="male" name="sex" value="male" checked={formData.patient?.sex === "male"} onChange={e => handleUpdate("patient", "sex", e.target.value)} />
                                            <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="male">Male</label>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <input type="radio" id="female" name="sex" value="female" checked={formData.patient?.sex === "female"} onChange={e => handleUpdate("patient", "sex", e.target.value)} />
                                            <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="female">Female</label>
                                        </div>
                                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                            <input type="radio" id="transgender" name="sex" value="transgender" checked={formData.patient?.sex === "transgender"} onChange={e => handleUpdate("patient", "sex", e.target.value)} />
                                            <label style={{ ...labelStyle, marginBottom: 0 }} htmlFor="transgender">Transgender</label>
                                        </div>
                                    </div>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Contact Number</label>
                                    <input type="tel" style={inputStyle} placeholder="Enter contact number" value={formData.patient?.[`contact`] || ""} onChange={e => handleUpdate("patient", "contact", e.target.value)} />

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Medical History</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" }}>
                                        <label style={{ ...labelStyle, marginBottom: 0 }}>Diagnosis</label>
                                        <button
                                            type="button"
                                            style={{ ...buttonStyle, background: C.black, color: C.white }}
                                            onClick={handleGenerateDiagnosis}
                                            disabled={isGeneratingDiagnosis}
                                        >
                                            {isGeneratingDiagnosis ? "Generating..." : "Generate LLM Summary"}
                                        </button>
                                    </div>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter diagnosis details" value={formData.patient?.[`diagnosis`] || ""} onChange={e => handleUpdate("patient", "diagnosis", e.target.value)}></textarea>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Previous Treatments</label>
                                    <div>
                                        {(formData.patient?.previousTreatments || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("patient", "previousTreatments", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Treatment type" value={item.treatmentType || ""} onChange={e => handleArrayUpdate("patient", "previousTreatments", index, "treatmentType", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="date" style={inputStyle} placeholder="Date" value={item.date || ""} onChange={e => handleArrayUpdate("patient", "previousTreatments", index, "date", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Outcome" value={item.outcome || ""} onChange={e => handleArrayUpdate("patient", "previousTreatments", index, "outcome", e.target.value)} />

                                                    </div>

                                                </div>

                                            </div>
                                        ))}

                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("patient", "previousTreatments", { "treatmentType": "", "date": "", "outcome": "" })}>Add Previous Treatment</button>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Allergies</label>
                                    <div>
                                        {(formData.patient?.allergies || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("patient", "allergies", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Allergen" value={item.allergen || ""} onChange={e => handleArrayUpdate("patient", "allergies", index, "allergen", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <select style={inputStyle} value={item.severity || ""} onChange={e => handleArrayUpdate("patient", "allergies", index, "severity", e.target.value)}>
                                                            <option value="">Severity</option><option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option>
                                                        </select>

                                                    </div>

                                                </div>

                                            </div>
                                        ))}

                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("patient", "allergies", { "allergen": "", "severity": "" })}>Add Allergy</button>

                                </div>

                            </div>

                        </div>

                        <div>
                            <div style={{ marginBottom: "16px" }}>
                                <ChemotherapyChart patientId={patientId} defaultExpanded={false} />
                            </div>

                            <SurgeryOverview patientId={patientId} />
                        </div>

                    </div>
                )}
                {activeTab === "baseline" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={
                            (formData.history?.baseline || []).map(entry => {
                                const { labOrderFields, labClinicalIndication, clinicalIndication,
                                    radClinicalIndication, investigationSuggestion, labInvestigations,
                                    customLabFields, radOrderFields, customRadFields,
                                    labOrder, radOrder, fields, ...filteredData } = (entry.data || {});
                                return { ...entry, data: filteredData };
                            })
                        } />
                        <div>
                            <h5 style={headerStyle}>Physical Measurements</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Height (cm)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter height" value={formData.baseline?.[`phy-height`] || ""} onChange={e => handleUpdate("baseline", "phy-height", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Weight (kg)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter weight" value={formData.baseline?.[`phy-weight`] || ""} onChange={e => handleUpdate("baseline", "phy-weight", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Body Surface Area (m²)</label>
                                    <input type="number" style={inputStyle} placeholder="BSA" value={formData.baseline?.[`bodySurfaceAreaM`] || ""} onChange={e => handleUpdate("baseline", "bodySurfaceAreaM", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Performance Status</label>
                                    <select style={inputStyle} value={formData.baseline?.[`phy_performance`] || ""} onChange={e => handleUpdate("baseline", "phy_performance", e.target.value)}>
                                        <option value="">Select status</option><option value="0">0 - Fully active</option><option value="1">1 - Restricted but ambulatory</option><option value="2">2 - Ambulatory &gt;50% of day</option><option value="3">3 - Limited self-care</option><option value="4">4 - Bedbound</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Pain Score (0-10)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter pain score" value={formData.baseline?.[`phy-painscore`] || ""} onChange={e => handleUpdate("baseline", "phy-painscore", e.target.value)} />

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Pre-Radiation Assessment *</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Blood Pressure</label>
                                    <input type="text" style={inputStyle} placeholder="e.g., 120/80 mmHg" value={formData.baseline?.[`phy-bp`] || ""} onChange={e => handleUpdate("baseline", "phy-bp", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Heart Rate</label>
                                    <input type="text" style={inputStyle} placeholder="e.g., 72 bpm" value={formData.baseline?.[`phy-hr`] || ""} onChange={e => handleUpdate("baseline", "phy-hr", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Temperature</label>
                                    <input type="text" style={inputStyle} placeholder="e.g., 36.6°C" value={formData.baseline?.[`phy-temp`] || ""} onChange={e => handleUpdate("baseline", "phy-temp", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Respiratory Rate</label>
                                    <input type="text" style={inputStyle} placeholder="e.g., 16 breaths/min" value={formData.baseline?.[`phy-rr`] || ""} onChange={e => handleUpdate("baseline", "phy-rr", e.target.value)} />

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Physical Examination</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter examination findings" value={formData.baseline?.[`physicalExamination`] || ""} onChange={e => handleUpdate("baseline", "physicalExamination", e.target.value)}></textarea>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                        <label style={{ ...labelStyle, marginBottom: 0 }}>Laboratory Investigations</label>
                                    </div>

                                    <LabInvestigations
                                        patientId={patientId}
                                        doctorId={doctorId}
                                        hospitalId={hospitalId}
                                        department="radiation"
                                        currentProcedure={`Session ${(formData.sessions?.treatmentSessions?.length || 0) + 1}`}
                                        bookingData={EMPTY_BOOKING_DATA}
                                        onChange={(data) => setFormData(prev => ({ ...prev, baseline: { ...prev.baseline, ...data } }))}
                                    />
                                </div>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "intent" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.intent} />
                        <div>
                            <h5 style={headerStyle}>Treatment Intent & Setting</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Treatment Intent</label>
                                    <select style={inputStyle} value={formData.intent?.[`treatmentIntent`] || ""} onChange={e => handleUpdate("intent", "treatmentIntent", e.target.value)}>
                                        <option value="">Select intent</option><option value="curative">Curative</option><option value="palliative">Palliative</option><option value="adjuvant">Adjuvant</option><option value="neoadjuvant">Neoadjuvant</option><option value="prophylactic">Prophylactic</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Treatment Setting</label>
                                    <select style={inputStyle} value={formData.intent?.[`treatmentSetting`] || ""} onChange={e => handleUpdate("intent", "treatmentSetting", e.target.value)}>
                                        <option value="">Select setting</option><option value="primary">Primary Site</option><option value="metastatic">Metastatic Disease</option><option value="recurrent">Recurrent Disease</option><option value="postoperative">Postoperative</option>
                                    </select>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Rationale for Treatment</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Explain rationale for radiation therapy" value={formData.intent?.[`rationaleForTreatment`] || ""} onChange={e => handleUpdate("intent", "rationaleForTreatment", e.target.value)}></textarea>

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Target Volume & Organs at Risk</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Target Volumes</label>
                                    <div>
                                        {(formData.intent?.targetVolumes || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("intent", "targetVolumes", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Volume name" value={item.volumeName || ""} onChange={e => handleArrayUpdate("intent", "targetVolumes", index, "volumeName", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <select style={inputStyle} value={item.type || ""} onChange={e => handleArrayUpdate("intent", "targetVolumes", index, "type", e.target.value)}>
                                                            <option value="">Type</option><option value="gtv">GTV</option><option value="ctv">CTV</option><option value="ptv">PTV</option><option value="itv">ITV</option>
                                                        </select>

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Volume (cc)" value={item.volumeCc || ""} onChange={e => handleArrayUpdate("intent", "targetVolumes", index, "volumeCc", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Prescribed Dose" value={item.prescribedDose || ""} onChange={e => handleArrayUpdate("intent", "targetVolumes", index, "prescribedDose", e.target.value)} />

                                                    </div>

                                                </div>

                                            </div>
                                        ))}

                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("intent", "targetVolumes", { "volumeName": "", "type": "", "volumeCc": "", "prescribedDose": "" })}>Add Target Volume</button>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Organs at Risk</label>
                                    <div>
                                        {(formData.intent?.organsAtRisk || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("intent", "organsAtRisk", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Organ name" value={item.organName || ""} onChange={e => handleArrayUpdate("intent", "organsAtRisk", index, "organName", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Max Dose (Gy)" value={item.maxDoseGy || ""} onChange={e => handleArrayUpdate("intent", "organsAtRisk", index, "maxDoseGy", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Mean Dose (Gy)" value={item.meanDoseGy || ""} onChange={e => handleArrayUpdate("intent", "organsAtRisk", index, "meanDoseGy", e.target.value)} />

                                                    </div>

                                                </div>

                                            </div>
                                        ))}

                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("intent", "organsAtRisk", { "organName": "", "maxDoseGy": "", "meanDoseGy": "" })}>Add Organ at Risk</button>

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Special Instructions</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Treatment Instructions</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter special treatment instructions" value={formData.intent?.[`treatmentInstructions`] || ""} onChange={e => handleUpdate("intent", "treatmentInstructions", e.target.value)}></textarea>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Precautions</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter special precautions" value={formData.intent?.[`precautions`] || ""} onChange={e => handleUpdate("intent", "precautions", e.target.value)}></textarea>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Emergency Instructions</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter emergency instructions" value={formData.intent?.[`emergencyInstructions`] || ""} onChange={e => handleUpdate("intent", "emergencyInstructions", e.target.value)}></textarea>

                                </div>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "setup" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.setup} />
                        <div>
                            <h5 style={headerStyle}>Mould Room Procedures</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Date of Mould Room Visit</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.setup?.[`dateOfMouldRoomVisit`] || ""} onChange={e => handleUpdate("setup", "dateOfMouldRoomVisit", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Technician</label>
                                    <input type="text" style={inputStyle} placeholder="Technician name" value={formData.setup?.[`technician`] || ""} onChange={e => handleUpdate("setup", "technician", e.target.value)} />

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Immobilization Devices</label>
                                    <div>
                                        {(formData.setup?.immobilizationDevices || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("setup", "immobilizationDevices", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Device type" value={item.deviceType || ""} onChange={e => handleArrayUpdate("setup", "immobilizationDevices", index, "deviceType", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Location/Description" value={item.locationdescription || ""} onChange={e => handleArrayUpdate("setup", "immobilizationDevices", index, "locationdescription", e.target.value)} />

                                                    </div>

                                                </div>

                                            </div>
                                        ))}

                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("setup", "immobilizationDevices", { "deviceType": "", "locationdescription": "" })}>Add Immobilization Device</button>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Mould Room Notes</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter notes from mould room visit" value={formData.setup?.[`mouldRoomNotes`] || ""} onChange={e => handleUpdate("setup", "mouldRoomNotes", e.target.value)}></textarea>

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Patient Setup</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Positioning</label>
                                    <select style={inputStyle} value={formData.setup?.[`positioning`] || ""} onChange={e => handleUpdate("setup", "positioning", e.target.value)}>
                                        <option value="">Select position</option><option value="supine">Supine</option><option value="prone">Prone</option><option value="lateral">Lateral</option><option value="other">Other</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Orientation</label>
                                    <select style={inputStyle} value={formData.setup?.[`orientation`] || ""} onChange={e => handleUpdate("setup", "orientation", e.target.value)}>
                                        <option value="">Select orientation</option><option value="headfirst">Head First</option><option value="feetfirst">Feet First</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Laser Alignment Marks</label>
                                    <input type="text" style={inputStyle} placeholder="Describe laser marks" value={formData.setup?.[`laserAlignmentMarks`] || ""} onChange={e => handleUpdate("setup", "laserAlignmentMarks", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Tattoo Information</label>
                                    <input type="text" style={inputStyle} placeholder="Tattoo locations and details" value={formData.setup?.[`tattooInformation`] || ""} onChange={e => handleUpdate("setup", "tattooInformation", e.target.value)} />

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Setup Verification Method</label>
                                    <select style={inputStyle} value={formData.setup?.[`setupVerificationMethod`] || ""} onChange={e => handleUpdate("setup", "setupVerificationMethod", e.target.value)}>
                                        <option value="">Select method</option><option value="portal">Portal Imaging</option><option value="cbct">CBCT</option><option value="mvct">MVCT</option><option value="surface">Surface Guidance</option>
                                    </select>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Setup Notes</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter patient setup notes" value={formData.setup?.[`setupNotes`] || ""} onChange={e => handleUpdate("setup", "setupNotes", e.target.value)}></textarea>

                                </div>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "simulation" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.simulation} />
                        <div>
                            <h5 style={headerStyle}>Simulation Details</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Simulation Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.simulation?.[`simulationDate`] || ""} onChange={e => handleUpdate("simulation", "simulationDate", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Simulation Type</label>
                                    <select style={inputStyle} value={formData.simulation?.[`simulationType`] || ""} onChange={e => handleUpdate("simulation", "simulationType", e.target.value)}>
                                        <option value="">Select type</option><option value="ct">CT Simulation</option><option value="mri">MRI Simulation</option><option value="pet-ct">PET-CT Simulation</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Slice Thickness (mm)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter slice thickness" value={formData.simulation?.[`sliceThicknessMm`] || ""} onChange={e => handleUpdate("simulation", "sliceThicknessMm", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Contrast Used</label>
                                    <select style={inputStyle} value={formData.simulation?.[`contrastUsed`] || ""} onChange={e => handleUpdate("simulation", "contrastUsed", e.target.value)}>
                                        <option value="">Select option</option><option value="iv">IV Contrast</option><option value="oral">Oral Contrast</option><option value="both">IV and Oral</option><option value="none">No Contrast</option>
                                    </select>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Simulation Notes</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter simulation notes" value={formData.simulation?.[`simulationNotes`] || ""} onChange={e => handleUpdate("simulation", "simulationNotes", e.target.value)}></textarea>

                                </div>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "treatment" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.treatment} />
                        <div>
                            <h5 style={headerStyle}>Treatment Details</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Treatment Type</label>
                                    <select style={inputStyle} value={formData.treatment?.[`treatmentType`] || ""} onChange={e => handleUpdate("treatment", "treatmentType", e.target.value)}>
                                        <option value="">Select treatment type</option><option value="external">External Beam Radiation</option><option value="brachy">Brachytherapy</option><option value="stereotactic">Stereotactic Radiosurgery</option><option value="imrt">IMRT</option><option value="igrt">IGRT</option><option value="vmat">VMAT</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Treatment Site</label>
                                    <input type="text" style={inputStyle} placeholder="Enter treatment site" value={formData.treatment?.[`treatmentSite`] || ""} onChange={e => handleUpdate("treatment", "treatmentSite", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Total Dose (Gy)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter total dose" value={formData.treatment?.[`totalDose`] || ""} onChange={e => handleUpdate("treatment", "totalDose", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Dose per Fraction (Gy)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter dose per fraction" value={formData.treatment?.[`dosePerFraction`] || ""} onChange={e => handleUpdate("treatment", "dosePerFraction", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Number of Fractions</label>
                                    <input type="number" style={inputStyle} placeholder="Enter number of fractions" value={formData.treatment?.[`numFractions`] || ""} onChange={e => handleUpdate("treatment", "numFractions", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Treatment Duration (weeks)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter duration in weeks" value={formData.treatment?.[`treatmentDuration`] || ""} onChange={e => handleUpdate("treatment", "treatmentDuration", e.target.value)} />

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Beam Parameters (if not from TPS Plan)</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <div>
                                        {(formData.treatment?.beamParameters || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("treatment", "beamParameters", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Field name" value={item.fieldName || ""} onChange={e => handleArrayUpdate("treatment", "beamParameters", index, "fieldName", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Energy (MV)" value={item.energyMv || ""} onChange={e => handleArrayUpdate("treatment", "beamParameters", index, "energyMv", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Gantry angle" value={item.gantryAngle || ""} onChange={e => handleArrayUpdate("treatment", "beamParameters", index, "gantryAngle", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Collimator angle" value={item.collimatorAngle || ""} onChange={e => handleArrayUpdate("treatment", "beamParameters", index, "collimatorAngle", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Field size (cm)" value={item.fieldSizeCm || ""} onChange={e => handleArrayUpdate("treatment", "beamParameters", index, "fieldSizeCm", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="SSD (cm)" value={item.ssdCm || ""} onChange={e => handleArrayUpdate("treatment", "beamParameters", index, "ssdCm", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Wedge angle" value={item.wedgeAngle || ""} onChange={e => handleArrayUpdate("treatment", "beamParameters", index, "wedgeAngle", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="MU per fraction" value={item.muPerFraction || ""} onChange={e => handleArrayUpdate("treatment", "beamParameters", index, "muPerFraction", e.target.value)} />

                                                    </div>

                                                </div>

                                            </div>
                                        ))}

                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("treatment", "beamParameters", { "fieldName": "", "energyMv": "", "gantryAngle": "", "collimatorAngle": "", "fieldSizeCm": "", "ssdCm": "", "wedgeAngle": "", "muPerFraction": "" })}>Add Beam Parameter</button>

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Beam and Plan Parameters</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Treatment Machine</label>
                                    <select style={inputStyle} value={formData.treatment?.[`treatmentMachine`] || ""} onChange={e => handleUpdate("treatment", "treatmentMachine", e.target.value)}>
                                        <option value="">Select machine</option><option value="linac1">Linac 1 - Varian TrueBeam</option><option value="linac2">Linac 2 - Elekta Versa</option><option value="cyberknife">CyberKnife</option><option value="tomotherapy">Tomotherapy</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Planning System</label>
                                    <input type="text" style={inputStyle} placeholder="e.g., Eclipse, Monaco, RayStation" value={formData.treatment?.[`planningSystem`] || ""} onChange={e => handleUpdate("treatment", "planningSystem", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Dose Calculation Algorithm</label>
                                    <input type="text" style={inputStyle} placeholder="e.g., AAA, Acuros, Monte Carlo" value={formData.treatment?.[`doseCalculationAlgorithm`] || ""} onChange={e => handleUpdate("treatment", "doseCalculationAlgorithm", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Dose Grid Resolution (mm)</label>
                                    <input type="text" style={inputStyle} placeholder="e.g., 2.5mm" value={formData.treatment?.[`doseGridResolutionMm`] || ""} onChange={e => handleUpdate("treatment", "doseGridResolutionMm", e.target.value)} />

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Plan Optimization Objectives</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter optimization objectives" value={formData.treatment?.[`planOptimizationObjectives`] || ""} onChange={e => handleUpdate("treatment", "planOptimizationObjectives", e.target.value)}></textarea>

                                </div>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "sessions" && (
                    <div className="tab-pane-content">
                        <div>
                            <div style={{ marginTop: "24px", marginBottom: "24px", border: `1px solid ${C.fog}`, background: C.white }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", borderBottom: `1px solid ${C.fog}` }}>
                                    <div style={{ fontSize: "13px", color: C.smoke, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>
                                        Session Records
                                    </div>
                                    <button type="button" style={{ ...buttonStyle, padding: "6px 12px", fontSize: "12px", background: C.white, border: `1px solid ${C.charcoal}` }} onClick={() => handleArrayAdd("sessions", "treatmentSessions", { "date": "", "time": "", "machine": "", "deliveredDoseGy": "", "treatmentTimeMin": "", "notes": "", "_isNew": true })}>
                                        + Add Session
                                    </button>
                                </div>
                                <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                            <tr style={{ background: C.ghost, borderBottom: `1px solid ${C.fog}` }}>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>SNO</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Date</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Time</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Machine</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Dose (Gy)</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Trt. Time (min)</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Notes</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(!formData.sessions?.treatmentSessions || formData.sessions.treatmentSessions.length === 0) && (
                                                <tr>
                                                    <td colSpan="8" style={{ padding: "16px", textAlign: "center", fontSize: "13px", color: C.smoke }}>No records found.</td>
                                                </tr>
                                            )}
                                            {(formData.sessions?.treatmentSessions || []).map((item, index) => {
                                                if (item._isNew) {
                                                    return (
                                                        <tr key={index} style={{ borderBottom: `1px solid ${C.fog}`, background: "#fafafa" }}>
                                                            <td colSpan="8" style={{ padding: "16px" }}>
                                                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px", alignItems: "center" }}>
                                                                    <h6 style={{ margin: 0, fontSize: "13px", color: C.charcoal }}>New Session</h6>
                                                                    <button type="button" style={{ ...buttonStyle, padding: "4px 12px", fontSize: "12px", background: C.white, border: `1px solid ${C.smoke}`, color: C.smoke }} onClick={() => handleArrayRemove("sessions", "treatmentSessions", index)}>Cancel</button>
                                                                </div>
                                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Date</label>
                                                                        <input type="date" style={inputStyle} placeholder="" value={item.date || ""} onChange={e => handleArrayUpdate("sessions", "treatmentSessions", index, "date", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Time</label>
                                                                        <input type="time" style={inputStyle} placeholder="" value={item.time || ""} onChange={e => handleArrayUpdate("sessions", "treatmentSessions", index, "time", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Machine</label>
                                                                        <select style={inputStyle} value={item.machine || ""} onChange={e => handleArrayUpdate("sessions", "treatmentSessions", index, "machine", e.target.value)}>
                                                                            <option value="">Select machine</option><option value="linac1">Linac 1</option><option value="linac2">Linac 2</option><option value="cyberknife">CyberKnife</option>
                                                                        </select>
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Delivered Dose (Gy)</label>
                                                                        <input type="number" style={inputStyle} placeholder="Enter delivered dose" value={item.deliveredDoseGy || ""} onChange={e => handleArrayUpdate("sessions", "treatmentSessions", index, "deliveredDoseGy", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Treatment Time (min)</label>
                                                                        <input type="number" style={inputStyle} placeholder="Enter treatment time" value={item.treatmentTimeMin || ""} onChange={e => handleArrayUpdate("sessions", "treatmentSessions", index, "treatmentTimeMin", e.target.value)} />
                                                                    </div>
                                                                    <div style={{ gridColumn: "1 / -1" }}>
                                                                        <label style={labelStyle}>Notes</label>
                                                                        <textarea style={{ ...inputStyle, minHeight: "60px" }} placeholder="Enter session notes" value={item.notes || ""} onChange={e => handleArrayUpdate("sessions", "treatmentSessions", index, "notes", e.target.value)}></textarea>
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }
                                                return (
                                                    <tr key={index} style={{ borderBottom: `1px solid ${C.fog}` }}>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.silver }}>{index + 1}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal, whiteSpace: "nowrap" }}>{item.date || "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.time || "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.machine || "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.deliveredDoseGy || "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.treatmentTimeMin || "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.notes || "-"}</td>
                                                        <td style={{ padding: "12px 16px" }}>
                                                            <button type="button" style={{ ...buttonStyle, padding: "4px 12px", fontSize: "12px", background: C.white, border: `1px solid ${C.charcoal}` }} onClick={() => handleArrayRemove("sessions", "treatmentSessions", index)}>Remove</button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>EBRT Delivery Summary</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Start Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.sessions?.[`startDate`] || ""} onChange={e => handleUpdate("sessions", "startDate", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>End Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.sessions?.[`endDate`] || ""} onChange={e => handleUpdate("sessions", "endDate", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Total Sessions Delivered</label>
                                    <input type="number" style={inputStyle} placeholder="Enter number of sessions" value={formData.sessions?.[`totalSessionsDelivered`] || ""} onChange={e => handleUpdate("sessions", "totalSessionsDelivered", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Total Dose Delivered (Gy)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter total dose" value={formData.sessions?.[`totalDoseDeliveredGy`] || ""} onChange={e => handleUpdate("sessions", "totalDoseDeliveredGy", e.target.value)} />

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Treatment Interruptions</label>
                                    <div>
                                        {(formData.sessions?.treatmentInterruptions || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("sessions", "treatmentInterruptions", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="date" style={inputStyle} placeholder="Start date" value={item.startDate || ""} onChange={e => handleArrayUpdate("sessions", "treatmentInterruptions", index, "startDate", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="date" style={inputStyle} placeholder="End date" value={item.endDate || ""} onChange={e => handleArrayUpdate("sessions", "treatmentInterruptions", index, "endDate", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Reason" value={item.reason || ""} onChange={e => handleArrayUpdate("sessions", "treatmentInterruptions", index, "reason", e.target.value)} />

                                                    </div>

                                                </div>

                                            </div>
                                        ))}

                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("sessions", "treatmentInterruptions", { "startDate": "", "endDate": "", "reason": "" })}>Add Treatment Interruption</button>

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Brachytherapy Delivery Summary</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Start Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.sessions?.[`brachyStartDate`] || ""} onChange={e => handleUpdate("sessions", "brachyStartDate", e.target.value)} />
                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>End Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.sessions?.[`brachyEndDate`] || ""} onChange={e => handleUpdate("sessions", "brachyEndDate", e.target.value)} />
                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Total Sessions Delivered</label>
                                    <input type="number" style={inputStyle} placeholder="Enter number of sessions" value={formData.sessions?.[`brachyTotalSessionsDelivered`] || ""} onChange={e => handleUpdate("sessions", "brachyTotalSessionsDelivered", e.target.value)} />
                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Total Dose Delivered (Gy)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter total dose" value={formData.sessions?.[`brachyTotalDoseDeliveredGy`] || ""} onChange={e => handleUpdate("sessions", "brachyTotalDoseDeliveredGy", e.target.value)} />
                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Treatment Interruptions</label>
                                    <div>
                                        {(formData.sessions?.brachyTreatmentInterruptions || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("sessions", "brachyTreatmentInterruptions", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="date" style={inputStyle} placeholder="Start date" value={item.startDate || ""} onChange={e => handleArrayUpdate("sessions", "brachyTreatmentInterruptions", index, "startDate", e.target.value)} />
                                                    </div>
                                                    <div style={{}}>
                                                        <input type="date" style={inputStyle} placeholder="End date" value={item.endDate || ""} onChange={e => handleArrayUpdate("sessions", "brachyTreatmentInterruptions", index, "endDate", e.target.value)} />
                                                    </div>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Reason" value={item.reason || ""} onChange={e => handleArrayUpdate("sessions", "brachyTreatmentInterruptions", index, "reason", e.target.value)} />
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("sessions", "brachyTreatmentInterruptions", { "startDate": "", "endDate": "", "reason": "" })}>Add Treatment Interruption</button>
                                </div>
                            </div>
                        </div>

                    </div>
                )}
                {activeTab === "imaging" && (
                    <div className="tab-pane-content">
                        <div>
                            <div style={{ marginTop: "24px", marginBottom: "24px", border: `1px solid ${C.fog}`, background: C.white }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", borderBottom: `1px solid ${C.fog}` }}>
                                    <div style={{ fontSize: "13px", color: C.smoke, textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 600 }}>
                                        Imaging Shifts
                                    </div>
                                    <button type="button" style={{ ...buttonStyle, padding: "6px 12px", fontSize: "12px", background: C.white, border: `1px solid ${C.charcoal}` }} onClick={() => handleArrayAdd("imaging", "imagingShifts", { "date": "", "shiftXMm": "", "shiftYMm": "", "shiftZMm": "", "rotation": "", "residualErrorAfterShift": "", "session": "", "isocenterShifts": "", "_isNew": true })}>
                                        + Add Shift
                                    </button>
                                </div>
                                <div style={{ overflowX: "auto" }}>
                                    <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                        <thead>
                                            <tr style={{ background: C.ghost, borderBottom: `1px solid ${C.fog}` }}>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>SNO</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Date</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Session</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Shift (X, Y, Z)</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Rotation</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Isocenter Shifts</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Residual Error</th>
                                                <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase", whiteSpace: "nowrap", letterSpacing: "0.5px" }}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {(!formData.imaging?.imagingShifts || formData.imaging.imagingShifts.length === 0) && (
                                                <tr>
                                                    <td colSpan="8" style={{ padding: "16px", textAlign: "center", fontSize: "13px", color: C.smoke }}>No records found.</td>
                                                </tr>
                                            )}
                                            {(formData.imaging?.imagingShifts || []).map((item, index) => {
                                                if (item._isNew) {
                                                    return (
                                                        <tr key={index} style={{ borderBottom: `1px solid ${C.fog}`, background: "#fafafa" }}>
                                                            <td colSpan="8" style={{ padding: "16px" }}>
                                                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "16px", alignItems: "center" }}>
                                                                    <h6 style={{ margin: 0, fontSize: "13px", color: C.charcoal }}>New Imaging Shift</h6>
                                                                    <button type="button" style={{ ...buttonStyle, padding: "4px 12px", fontSize: "12px", background: C.white, border: `1px solid ${C.smoke}`, color: C.smoke }} onClick={() => handleArrayRemove("imaging", "imagingShifts", index)}>Cancel</button>
                                                                </div>
                                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "16px" }}>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Date</label>
                                                                        <input type="date" style={inputStyle} placeholder="" value={item.date || ""} onChange={e => handleArrayUpdate("imaging", "imagingShifts", index, "date", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Session #</label>
                                                                        <input type="number" style={inputStyle} placeholder="Session number" value={item.session || ""} onChange={e => handleArrayUpdate("imaging", "imagingShifts", index, "session", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Shift X (mm)</label>
                                                                        <input type="number" style={inputStyle} placeholder="X shift" value={item.shiftXMm || ""} onChange={e => handleArrayUpdate("imaging", "imagingShifts", index, "shiftXMm", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Shift Y (mm)</label>
                                                                        <input type="number" style={inputStyle} placeholder="Y shift" value={item.shiftYMm || ""} onChange={e => handleArrayUpdate("imaging", "imagingShifts", index, "shiftYMm", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Shift Z (mm)</label>
                                                                        <input type="number" style={inputStyle} placeholder="Z shift" value={item.shiftZMm || ""} onChange={e => handleArrayUpdate("imaging", "imagingShifts", index, "shiftZMm", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Rotation (°)</label>
                                                                        <input type="number" style={inputStyle} placeholder="Rotation" value={item.rotation || ""} onChange={e => handleArrayUpdate("imaging", "imagingShifts", index, "rotation", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Isocenter Shifts</label>
                                                                        <input type="text" style={inputStyle} placeholder="Isocenter shifts" value={item.isocenterShifts || ""} onChange={e => handleArrayUpdate("imaging", "imagingShifts", index, "isocenterShifts", e.target.value)} />
                                                                    </div>
                                                                    <div style={{}}>
                                                                        <label style={labelStyle}>Residual Error after Shift</label>
                                                                        <input type="text" style={inputStyle} placeholder="Residual error" value={item.residualErrorAfterShift || ""} onChange={e => handleArrayUpdate("imaging", "imagingShifts", index, "residualErrorAfterShift", e.target.value)} />
                                                                    </div>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    );
                                                }
                                                return (
                                                    <tr key={index} style={{ borderBottom: `1px solid ${C.fog}` }}>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.silver }}>{index + 1}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal, whiteSpace: "nowrap" }}>{item.date || "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.session || "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal, whiteSpace: "nowrap" }}>{item.shiftXMm || "0"}, {item.shiftYMm || "0"}, {item.shiftZMm || "0"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.rotation ? `${item.rotation}°` : "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.isocenterShifts || "-"}</td>
                                                        <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{item.residualErrorAfterShift || "-"}</td>
                                                        <td style={{ padding: "12px 16px" }}>
                                                            <button type="button" style={{ ...buttonStyle, padding: "4px 12px", fontSize: "12px", background: C.white, border: `1px solid ${C.charcoal}` }} onClick={() => handleArrayRemove("imaging", "imagingShifts", index)}>Remove</button>
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Isocenter Shifts</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Verification Method</label>
                                    <select style={inputStyle} value={formData.imaging?.[`verificationMethod`] || ""} onChange={e => handleUpdate("imaging", "verificationMethod", e.target.value)}>
                                        <option value="">Select method</option><option value="cbct">CBCT</option><option value="mvct">MVCT</option><option value="epid">EPID</option><option value="carm">C-arm</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Frequency</label>
                                    <select style={inputStyle} value={formData.imaging?.[`frequency`] || ""} onChange={e => handleUpdate("imaging", "frequency", e.target.value)}>
                                        <option value="">Select frequency</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="first3">First 3 fractions</option><option value="asneeded">As needed</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Action Level (mm)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter action level" value={formData.imaging?.[`actionLevelMm`] || ""} onChange={e => handleUpdate("imaging", "actionLevelMm", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Tolerance Level (mm)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter tolerance level" value={formData.imaging?.[`toleranceLevelMm`] || ""} onChange={e => handleUpdate("imaging", "toleranceLevelMm", e.target.value)} />

                                </div>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "qa" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.qa} />
                        <div>
                            <h5 style={headerStyle}>Plan Quality Assurance Results</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>QA Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.qa?.[`dateOfMouldRoomVisit`] || ""} onChange={e => handleUpdate("qa", "dateOfMouldRoomVisit", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>QA Performed By</label>
                                    <input type="text" style={inputStyle} placeholder="Enter name" value={formData.qa?.[`qaPerformedBy`] || ""} onChange={e => handleUpdate("qa", "qaPerformedBy", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Measurement Device</label>
                                    <input type="text" style={inputStyle} placeholder="e.g., Matrixx, ArcCheck, Delta4" value={formData.qa?.[`measurementDevice`] || ""} onChange={e => handleUpdate("qa", "measurementDevice", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Measurement Type</label>
                                    <select style={inputStyle} value={formData.qa?.[`measurementType`] || ""} onChange={e => handleUpdate("qa", "measurementType", e.target.value)}>
                                        <option value="">Select type</option><option value="absolute">Absolute Dose</option><option value="relative">Relative Dose</option><option value="both">Both</option>
                                    </select>

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Point Dose Measurement (%)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter percentage" value={formData.qa?.[`pointDoseMeasurement`] || ""} onChange={e => handleUpdate("qa", "pointDoseMeasurement", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Gamma Pass Rate (%)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter percentage" value={formData.qa?.[`gammaPassRate`] || ""} onChange={e => handleUpdate("qa", "gammaPassRate", e.target.value)} />

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>QA Results</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter QA results and comments" value={formData.qa?.[`qaResults`] || ""} onChange={e => handleUpdate("qa", "qaResults", e.target.value)}></textarea>

                                </div>

                            </div>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Pre-Treatment QA Checklist</h5>
                            <ul style={{ paddingLeft: "24px", margin: "10px 0" }}>
                                {[
                                    { id: "planVerificationCompleted", label: "Plan verification completed" },
                                    { id: "muCalculationVerified", label: "MU calculation verified" },
                                    { id: "doseDistributionReviewed", label: "Dose distribution reviewed" },
                                    { id: "dvhConstraintsMet", label: "DVH constraints met" },
                                    { id: "physicsApprovalObtained", label: "Physics approval obtained" }
                                ].map(item => (
                                    <li key={item.id} style={{ marginBottom: "8px" }}>
                                        <label style={{ display: "inline-flex", alignItems: "center", cursor: "pointer", color: C.charcoal, fontSize: "14px", margin: 0 }}>
                                            <input
                                                type="checkbox"
                                                style={{ marginRight: "8px", cursor: "pointer" }}
                                                checked={formData.qa?.[item.id] || false}
                                                onChange={e => handleUpdate("qa", item.id, e.target.checked)}
                                            />
                                            {item.label}
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        </div>

                    </div>
                )}
                {activeTab === "notes" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.notes} />
                        <div>
                            <h5 style={headerStyle}>Radiation Review Notes</h5>
                            <div>
                                {(formData.notes?.reviewNotes?.length > 0 ? formData.notes.reviewNotes : [{}]).map((reviewNote, index) => (
                                    <div key={index} style={{ marginBottom: "24px", border: "1px solid #e8e8e8", padding: "16px", borderRadius: "4px" }}>
                                        <div>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                                <h5 style={{ ...headerStyle, margin: 0, borderBottom: "none" }}>Note {index + 1}</h5>
                                                <button type="button" style={{ ...buttonStyle, color: "red" }} onClick={() => handleArrayRemove("notes", "reviewNotes", index)}>Remove Note</button>
                                            </div>
                                            <div>
                                                <input type="date" style={inputStyle} placeholder="" value={reviewNote[`date`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "date", e.target.value)} />
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Patient Assessment</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Weight (kg)</label>
                                                    <input type="number" style={inputStyle} placeholder="Enter weight" value={reviewNote[`weightKg`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "weightKg", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Performance Status</label>
                                                    <select style={inputStyle} value={reviewNote[`performanceStatus`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "performanceStatus", e.target.value)}>
                                                        <option value="">Select status</option><option value="0">0 - Fully active</option><option value="1">1 - Restricted but ambulatory</option><option value="2">2 - Ambulatory &gt;50% of day</option><option value="3">3 - Limited self-care</option><option value="4">4 - Bedbound</option>
                                                    </select>
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Pain Score (0-10)</label>
                                                    <input type="number" style={inputStyle} placeholder="Enter pain score" value={reviewNote[`painScore010`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "painScore010", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Symptoms</label>
                                                    <input type="text" style={inputStyle} placeholder="Enter symptoms" value={reviewNote[`symptoms`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "symptoms", e.target.value)} />
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Treatment Progress</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Fractions Completed</label>
                                                    <input type="number" style={inputStyle} placeholder="Enter number of fractions" value={reviewNote[`fractionsCompleted`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "fractionsCompleted", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Dose Delivered (Gy)</label>
                                                    <input type="number" style={inputStyle} placeholder="Enter dose delivered" value={reviewNote[`doseDeliveredGy`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "doseDeliveredGy", e.target.value)} />
                                                </div>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Treatment Issues</label>
                                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter any treatment issues" value={reviewNote[`treatmentIssues`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "treatmentIssues", e.target.value)}></textarea>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Image Guidance Review</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Average Shift X (mm)</label>
                                                    <input type="number" style={inputStyle} placeholder="X shift" value={reviewNote[`shiftXMm`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "shiftXMm", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Average Shift Y (mm)</label>
                                                    <input type="number" style={inputStyle} placeholder="Y shift" value={reviewNote[`shiftYMm`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "shiftYMm", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Average Shift Z (mm)</label>
                                                    <input type="number" style={inputStyle} placeholder="Z shift" value={reviewNote[`shiftZMm`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "shiftZMm", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Setup Issues</label>
                                                    <input type="text" style={inputStyle} placeholder="Enter setup issues" value={reviewNote[`setupIssues`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "setupIssues", e.target.value)} />
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Plan Quality Assessment</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Plan Adequacy</label>
                                                    <select style={inputStyle} value={reviewNote[`planAdequacy`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "planAdequacy", e.target.value)}>
                                                        <option value="">Select assessment</option><option value="adequate">Adequate</option><option value="marginal">Marginal</option><option value="inadequate">Inadequate</option>
                                                    </select>
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Plan Changes Required</label>
                                                    <select style={inputStyle} value={reviewNote[`planChangesRequired`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "planChangesRequired", e.target.value)}>
                                                        <option value="">Select option</option><option value="yes">Yes</option><option value="no">No</option>
                                                    </select>
                                                </div>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Plan Assessment Notes</label>
                                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter plan assessment notes" value={reviewNote[`planAssessmentNotes`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "planAssessmentNotes", e.target.value)}></textarea>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Decisions & Actions</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Additional Actions</label>
                                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter additional actions" value={reviewNote[`additionalActions`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "additionalActions", e.target.value)}></textarea>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Follow-up Plan</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Next Review Date</label>
                                                    <input type="date" style={inputStyle} placeholder="" value={reviewNote[`nextReviewDate`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "nextReviewDate", e.target.value)} />
                                                </div>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Follow-up Instructions</label>
                                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter follow-up instructions" value={reviewNote[`followupInstructions`] || ""} onChange={e => handleArrayUpdate("notes", "reviewNotes", index, "followupInstructions", e.target.value)}></textarea>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("notes", "reviewNotes", { "date": "", "weightKg": "", "performanceStatus": "", "painScore010": "", "symptoms": "", "fractionsCompleted": "", "doseDeliveredGy": "", "treatmentIssues": "", "shiftXMm": "", "shiftYMm": "", "shiftZMm": "", "setupIssues": "", "planAdequacy": "", "planChangesRequired": "", "planAssessmentNotes": "", "additionalActions": "", "nextReviewDate": "", "followupInstructions": "" })}>Add Review Note</button>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Chart Round Notes</h5>
                            <div>
                                {(formData.notes?.chartRoundNotes?.length > 0 ? formData.notes.chartRoundNotes : [{}]).map((chartRoundNote, index) => (
                                    <div key={index} style={{ marginBottom: "24px", border: "1px solid #e8e8e8", padding: "16px", borderRadius: "4px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                            <h5 style={{ ...headerStyle, margin: 0, borderBottom: "none" }}>Chart Round {index + 1}</h5>
                                            <button type="button" style={{ ...buttonStyle, color: "red" }} onClick={() => handleArrayRemove("notes", "chartRoundNotes", index)}>Remove Note</button>
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                            <div style={{}}>
                                                <label style={labelStyle}>Presenter</label>
                                                <input type="text" style={inputStyle} placeholder="Enter presenter name" value={chartRoundNote[`presenter`] || ""} onChange={e => handleArrayUpdate("notes", "chartRoundNotes", index, "presenter", e.target.value)} />
                                            </div>
                                            <div style={{}}>
                                                <label style={labelStyle}>Attendees</label>
                                                <input type="text" style={inputStyle} placeholder="Enter attendees" value={chartRoundNote[`attendees`] || ""} onChange={e => handleArrayUpdate("notes", "chartRoundNotes", index, "attendees", e.target.value)} />
                                            </div>
                                            <div style={{ gridColumn: "1 / -1" }}>
                                                <label style={labelStyle}>Discussion Points</label>
                                                <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter discussion points" value={chartRoundNote[`discussionPoints`] || ""} onChange={e => handleArrayUpdate("notes", "chartRoundNotes", index, "discussionPoints", e.target.value)}></textarea>
                                            </div>
                                            <div style={{ gridColumn: "1 / -1" }}>
                                                <label style={labelStyle}>Decisions Made</label>
                                                <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter decisions made" value={chartRoundNote[`decisionsMade`] || ""} onChange={e => handleArrayUpdate("notes", "chartRoundNotes", index, "decisionsMade", e.target.value)}></textarea>
                                            </div>
                                            <div style={{ gridColumn: "1 / -1" }}>
                                                <label style={labelStyle}>Action Items</label>
                                                <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter action items" value={chartRoundNote[`actionItems`] || ""} onChange={e => handleArrayUpdate("notes", "chartRoundNotes", index, "actionItems", e.target.value)}></textarea>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("notes", "chartRoundNotes", { "presenter": "", "attendees": "", "discussionPoints": "", "decisionsMade": "", "actionItems": "" })}>Add Chart Round Note</button>

                        </div>

                    </div>
                )}
                {activeTab === "radiation_review_content" && (
                    <div className="tab-pane-content">
                        <div>
                            <h5 style={headerStyle}>Radiation Review Notes</h5>
                            <div>
                                {(formData.radiation_review_content?.reviewNotes?.length > 0 ? formData.radiation_review_content.reviewNotes : [{}]).map((reviewNote, index) => (
                                    <div key={index} style={{ marginBottom: "24px", border: "1px solid #e8e8e8", padding: "16px", borderRadius: "4px" }}>
                                        <div>
                                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                                <h5 style={{ ...headerStyle, margin: 0, borderBottom: "none" }}>Note {index + 1}</h5>
                                                <button type="button" style={{ ...buttonStyle, color: "red" }} onClick={() => handleArrayRemove("radiation_review_content", "reviewNotes", index)}>Remove Note</button>
                                            </div>
                                            <div>
                                                <input type="date" style={inputStyle} placeholder="" value={reviewNote[`date`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "date", e.target.value)} />
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Patient Assessment</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Weight (kg)</label>
                                                    <input type="number" style={inputStyle} placeholder="Enter weight" value={reviewNote[`weightKg`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "weightKg", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Performance Status</label>
                                                    <select style={inputStyle} value={reviewNote[`performanceStatus`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "performanceStatus", e.target.value)}>
                                                        <option value="">Select status</option><option value="0">0 - Fully active</option><option value="1">1 - Restricted but ambulatory</option><option value="2">2 - Ambulatory &gt;50% of day</option><option value="3">3 - Limited self-care</option><option value="4">4 - Bedbound</option>
                                                    </select>
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Pain Score (0-10)</label>
                                                    <input type="number" style={inputStyle} placeholder="Enter pain score" value={reviewNote[`painScore010`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "painScore010", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Symptoms</label>
                                                    <input type="text" style={inputStyle} placeholder="Enter symptoms" value={reviewNote[`symptoms`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "symptoms", e.target.value)} />
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Treatment Progress</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Fractions Completed</label>
                                                    <input type="number" style={inputStyle} placeholder="Enter number of fractions" value={reviewNote[`fractionsCompleted`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "fractionsCompleted", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Dose Delivered (Gy)</label>
                                                    <input type="number" style={inputStyle} placeholder="Enter dose delivered" value={reviewNote[`doseDeliveredGy`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "doseDeliveredGy", e.target.value)} />
                                                </div>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Treatment Issues</label>
                                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter any treatment issues" value={reviewNote[`treatmentIssues`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "treatmentIssues", e.target.value)}></textarea>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Image Guidance Review</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Average Shift X (mm)</label>
                                                    <input type="number" style={inputStyle} placeholder="X shift" value={reviewNote[`shiftXMm`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "shiftXMm", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Average Shift Y (mm)</label>
                                                    <input type="number" style={inputStyle} placeholder="Y shift" value={reviewNote[`shiftYMm`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "shiftYMm", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Average Shift Z (mm)</label>
                                                    <input type="number" style={inputStyle} placeholder="Z shift" value={reviewNote[`shiftZMm`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "shiftZMm", e.target.value)} />
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Setup Issues</label>
                                                    <input type="text" style={inputStyle} placeholder="Enter setup issues" value={reviewNote[`setupIssues`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "setupIssues", e.target.value)} />
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Plan Quality Assessment</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Plan Adequacy</label>
                                                    <select style={inputStyle} value={reviewNote[`planAdequacy`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "planAdequacy", e.target.value)}>
                                                        <option value="">Select assessment</option><option value="adequate">Adequate</option><option value="marginal">Marginal</option><option value="inadequate">Inadequate</option>
                                                    </select>
                                                </div>
                                                <div style={{}}>
                                                    <label style={labelStyle}>Plan Changes Required</label>
                                                    <select style={inputStyle} value={reviewNote[`planChangesRequired`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "planChangesRequired", e.target.value)}>
                                                        <option value="">Select option</option><option value="yes">Yes</option><option value="no">No</option>
                                                    </select>
                                                </div>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Plan Assessment Notes</label>
                                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter plan assessment notes" value={reviewNote[`planAssessmentNotes`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "planAssessmentNotes", e.target.value)}></textarea>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Decisions & Actions</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Additional Actions</label>
                                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter additional actions" value={reviewNote[`additionalActions`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "additionalActions", e.target.value)}></textarea>
                                                </div>
                                            </div>
                                        </div>
                                        <div>
                                            <h5 style={headerStyle}>Follow-up Plan</h5>
                                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Next Review Date</label>
                                                    <input type="date" style={inputStyle} placeholder="" value={reviewNote[`nextReviewDate`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "nextReviewDate", e.target.value)} />
                                                </div>
                                                <div style={{ gridColumn: "1 / -1" }}>
                                                    <label style={labelStyle}>Follow-up Instructions</label>
                                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter follow-up instructions" value={reviewNote[`followupInstructions`] || ""} onChange={e => handleArrayUpdate("radiation_review_content", "reviewNotes", index, "followupInstructions", e.target.value)}></textarea>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("radiation_review_content", "reviewNotes", { "date": "", "weightKg": "", "performanceStatus": "", "painScore010": "", "symptoms": "", "fractionsCompleted": "", "doseDeliveredGy": "", "treatmentIssues": "", "shiftXMm": "", "shiftYMm": "", "shiftZMm": "", "setupIssues": "", "planAdequacy": "", "planChangesRequired": "", "planAssessmentNotes": "", "additionalActions": "", "nextReviewDate": "", "followupInstructions": "" })}>Add Review Note</button>

                        </div>

                    </div>
                )}
                {activeTab === "chart_round_content" && (
                    <div className="tab-pane-content">
                        <div>
                            <h5 style={headerStyle}>Chart Round Notes</h5>
                            <div>
                                {(formData.chart_round_content?.chartRoundNotes?.length > 0 ? formData.chart_round_content.chartRoundNotes : [{}]).map((chartRoundNote, index) => (
                                    <div key={index} style={{ marginBottom: "24px", border: "1px solid #e8e8e8", padding: "16px", borderRadius: "4px" }}>
                                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                                            <h5 style={{ ...headerStyle, margin: 0, borderBottom: "none" }}>Chart Round {index + 1}</h5>
                                            <button type="button" style={{ ...buttonStyle, color: "red" }} onClick={() => handleArrayRemove("chart_round_content", "chartRoundNotes", index)}>Remove Note</button>
                                        </div>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                            <div style={{}}>
                                                <label style={labelStyle}>Presenter</label>
                                                <input type="text" style={inputStyle} placeholder="Enter presenter name" value={chartRoundNote[`presenter`] || ""} onChange={e => handleArrayUpdate("chart_round_content", "chartRoundNotes", index, "presenter", e.target.value)} />
                                            </div>
                                            <div style={{}}>
                                                <label style={labelStyle}>Attendees</label>
                                                <input type="text" style={inputStyle} placeholder="Enter attendees" value={chartRoundNote[`attendees`] || ""} onChange={e => handleArrayUpdate("chart_round_content", "chartRoundNotes", index, "attendees", e.target.value)} />
                                            </div>
                                            <div style={{ gridColumn: "1 / -1" }}>
                                                <label style={labelStyle}>Discussion Points</label>
                                                <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter discussion points" value={chartRoundNote[`discussionPoints`] || ""} onChange={e => handleArrayUpdate("chart_round_content", "chartRoundNotes", index, "discussionPoints", e.target.value)}></textarea>
                                            </div>
                                            <div style={{ gridColumn: "1 / -1" }}>
                                                <label style={labelStyle}>Decisions Made</label>
                                                <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter decisions made" value={chartRoundNote[`decisionsMade`] || ""} onChange={e => handleArrayUpdate("chart_round_content", "chartRoundNotes", index, "decisionsMade", e.target.value)}></textarea>
                                            </div>
                                            <div style={{ gridColumn: "1 / -1" }}>
                                                <label style={labelStyle}>Action Items</label>
                                                <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter action items" value={chartRoundNote[`actionItems`] || ""} onChange={e => handleArrayUpdate("chart_round_content", "chartRoundNotes", index, "actionItems", e.target.value)}></textarea>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("chart_round_content", "chartRoundNotes", { "presenter": "", "attendees": "", "discussionPoints": "", "decisionsMade": "", "actionItems": "" })}>Add Chart Round Note</button>

                        </div>

                    </div>
                )}
                {activeTab === "summary" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.summary} />
                        <div>
                            <h5 style={headerStyle}>End of Treatment Summary</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Treatment Completion Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.summary?.[`treatmentCompletionDate`] || ""} onChange={e => handleUpdate("summary", "treatmentCompletionDate", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Treatment Completed By</label>
                                    <input type="text" style={inputStyle} placeholder="Enter name" value={formData.summary?.[`treatmentCompletedBy`] || ""} onChange={e => handleUpdate("summary", "treatmentCompletedBy", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Total Dose Delivered (Gy)</label>
                                    <input type="number" style={inputStyle} placeholder="Enter total dose" value={formData.summary?.[`totalDoseDeliveredGy`] || ""} onChange={e => handleUpdate("summary", "totalDoseDeliveredGy", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Number of Fractions Delivered</label>
                                    <input type="number" style={inputStyle} placeholder="Enter number of fractions" value={formData.summary?.[`fractionsCompleted`] || ""} onChange={e => handleUpdate("summary", "fractionsCompleted", e.target.value)} />

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Treatment Outcome</label>
                                    <select style={inputStyle} value={formData.summary?.[`treatmentOutcome`] || ""} onChange={e => handleUpdate("summary", "treatmentOutcome", e.target.value)}>
                                        <option value="">Select outcome</option><option value="completed">Completed as planned</option><option value="modified">Modified during treatment</option><option value="incomplete">Incomplete</option><option value="stopped">Stopped early</option>
                                    </select>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Reason for Modification (if applicable)</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter reason for modification" value={formData.summary?.[`reasonForModificationIfApplicable`] || ""} onChange={e => handleUpdate("summary", "reasonForModificationIfApplicable", e.target.value)}></textarea>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>Toxicities at End of Treatment</label>
                                    <div>
                                        {(formData.summary?.toxicities || []).map((item, index) => (
                                            <div key={index}>
                                                <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("summary", "toxicities", index)}>Remove</button>
                                                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                                    <div style={{}}>
                                                        <input type="text" style={inputStyle} placeholder="Toxicity" value={item.toxicity || ""} onChange={e => handleArrayUpdate("summary", "toxicities", index, "toxicity", e.target.value)} />

                                                    </div>
                                                    <div style={{}}>
                                                        <select style={inputStyle} value={item.grade || ""} onChange={e => handleArrayUpdate("summary", "toxicities", index, "grade", e.target.value)}>
                                                            <option value="">Grade</option><option value="1">Grade 1</option><option value="2">Grade 2</option><option value="3">Grade 3</option><option value="4">Grade 4</option>
                                                        </select>

                                                    </div>

                                                </div>

                                            </div>
                                        ))}

                                    </div>
                                    <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("summary", "toxicities", { "toxicity": "", "grade": "" })}>Add Toxicity</button>

                                </div>
                                <div style={{ gridColumn: "1 / -1" }}>
                                    <label style={labelStyle}>End of Treatment Summary</label>
                                    <textarea style={{ ...inputStyle, minHeight: "100px" }} placeholder="Enter comprehensive end of treatment summary" value={formData.summary?.[`endOfTreatmentSummary`] || ""} onChange={e => handleUpdate("summary", "endOfTreatmentSummary", e.target.value)}></textarea>

                                </div>

                            </div>

                        </div>

                    </div>
                )}
                {activeTab === "staff" && (
                    <div className="tab-pane-content">
                        <HistoryTable historyData={formData.history?.staff} />
                        <div>
                            <h5 style={headerStyle}>Treatment Team</h5>
                            <div>
                                {(formData.staff?.staffMembers || []).map((item, index) => (
                                    <div key={index}>
                                        <button type="button" style={buttonStyle} onClick={() => handleArrayRemove("staff", "staffMembers", index)}>Remove</button>
                                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                            <div style={{}}>
                                                <label style={labelStyle}>Name</label>
                                                <input type="text" style={inputStyle} placeholder="Staff name" value={item.name || ""} onChange={e => handleArrayUpdate("staff", "staffMembers", index, "name", e.target.value)} />

                                            </div>
                                            <div style={{}}>
                                                <label style={labelStyle}>Role</label>
                                                <select style={inputStyle} value={item.role || ""} onChange={e => handleArrayUpdate("staff", "staffMembers", index, "role", e.target.value)}>
                                                    <option value="">Select role</option><option value="radiation-oncologist">Radiation Oncologist</option><option value="physicist">Medical Physicist</option><option value="dosimetrist">Dosimetrist</option><option value="therapist">Radiation Therapist</option><option value="nurse">Oncology Nurse</option>
                                                </select>

                                            </div>
                                            <div style={{}}>
                                                <label style={labelStyle}>License Number</label>
                                                <input type="text" style={inputStyle} placeholder="License number" value={item.licenseNumber || ""} onChange={e => handleArrayUpdate("staff", "staffMembers", index, "licenseNumber", e.target.value)} />

                                            </div>
                                            <div style={{}}>
                                                <label style={labelStyle}>Contact</label>
                                                <input type="text" style={inputStyle} placeholder="Contact information" value={item.contact || ""} onChange={e => handleArrayUpdate("staff", "staffMembers", index, "contact", e.target.value)} />

                                            </div>

                                        </div>

                                    </div>
                                ))}

                            </div>
                            <button type="button" style={buttonStyle} onClick={() => handleArrayAdd("staff", "staffMembers", { "name": "", "role": "", "licenseNumber": "", "contact": "" })}>Add Staff Member</button>

                        </div>

                        <div>
                            <h5 style={headerStyle}>Signatures</h5>
                            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))", gap: "16px", marginBottom: "16px" }}>
                                <div style={{}}>
                                    <label style={labelStyle}>Prescribing Physician</label>
                                    <input type="text" style={inputStyle} placeholder="Physician name" value={formData.staff?.[`prescribingPhysician`] || ""} onChange={e => handleUpdate("staff", "prescribingPhysician", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.staff?.[`prescribingPhysicianDate`] || ""} onChange={e => handleUpdate("staff", "prescribingPhysicianDate", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Physics Approval</label>
                                    <input type="text" style={inputStyle} placeholder="Physicist name" value={formData.staff?.[`physicsApproval`] || ""} onChange={e => handleUpdate("staff", "physicsApproval", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.staff?.[`physicsApprovalDate`] || ""} onChange={e => handleUpdate("staff", "physicsApprovalDate", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Dosimetrist</label>
                                    <input type="text" style={inputStyle} placeholder="Dosimetrist name" value={formData.staff?.[`dosimetrist`] || ""} onChange={e => handleUpdate("staff", "dosimetrist", e.target.value)} />

                                </div>
                                <div style={{}}>
                                    <label style={labelStyle}>Date</label>
                                    <input type="date" style={inputStyle} placeholder="" value={formData.staff?.[`dosimetristDate`] || ""} onChange={e => handleUpdate("staff", "dosimetristDate", e.target.value)} />

                                </div>

                            </div>

                        </div>

                    </div>
                )}

                {/* Save button for the active tab */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "24px", paddingTop: "16px", borderTop: `1px solid ${C.fog}` }}>
                    <button style={primaryButtonStyle} onClick={() => setShowReportModal(true)}>View Report</button>
                    <button style={primaryButtonStyle} onClick={() => handleTabSave(activeTab)}>Save {tabs.find(t => t.id === activeTab)?.label || activeTab} Tab Data</button>
                </div>
            </div>

            {invViewDialog.open && invViewDialog.data && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ background: C.white, borderRadius: "4px", border: `1px solid ${C.black}`, width: "90%", maxWidth: "600px", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", overflow: "hidden" }}>
                        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.fog}`, background: C.white, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h3 style={{ margin: 0, fontSize: "16px", color: C.charcoal, fontWeight: 600 }}>
                                Order Details
                            </h3>
                            <button type="button" onClick={() => setInvViewDialog({ open: false, data: null })} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: C.ash, padding: 0, lineHeight: 1 }}>&times;</button>
                        </div>
                        <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "24px", background: C.white }}>
                            {invViewDialog.data.clinical_indication && (
                                <div>
                                    <div style={{ fontSize: "13px", fontWeight: 600, color: C.charcoal, marginBottom: "8px" }}>Clinical Indication:</div>
                                    <div style={{ fontSize: "13px", color: C.smoke, lineHeight: "1.5" }}>
                                        {invViewDialog.data.clinical_indication}
                                    </div>
                                </div>
                            )}

                            <div>
                                <div style={{ fontSize: "13px", fontWeight: 600, color: C.charcoal, marginBottom: "8px" }}>Ordered Fields:</div>
                                {(() => {
                                    const normalizedParams = Array.isArray(invViewDialog.data.parameters)
                                        ? invViewDialog.data.parameters
                                        : typeof invViewDialog.data.parameters === 'string'
                                            ? invViewDialog.data.parameters.split(',').map(s => s.trim()).filter(Boolean).map(s => ({ label: s }))
                                            : [];

                                    if (normalizedParams.length > 0) {
                                        return (
                                            <div style={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                                                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                                    <thead>
                                                        <tr style={{ borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
                                                            <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase" }}>Field</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {normalizedParams.map((p, idx) => (
                                                            <tr key={idx} style={{ borderBottom: idx === normalizedParams.length - 1 ? "none" : `1px solid ${C.fog}` }}>
                                                                <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{p.label || p.testName || p.name || p.parameter || p.test_name || (typeof p === 'string' ? p : "—")}</td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        );
                                    } else {
                                        return (
                                            <div style={{ fontSize: "13px", color: C.smoke, fontStyle: "italic", padding: "16px", border: `1px solid ${C.fog}`, borderRadius: "4px" }}>
                                                No fields recorded
                                            </div>
                                        );
                                    }
                                })()}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {labDetailsModal && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ background: C.white, borderRadius: "4px", border: `1px solid ${C.black}`, width: "90%", maxWidth: "600px", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", overflow: "hidden" }}>
                        <div style={{ padding: "12px 20px", background: C.black, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h3 style={{ margin: 0, fontSize: "15px", color: C.white, textTransform: "capitalize", fontWeight: 600 }}>{labDetailsModal.title}</h3>
                            <button type="button" onClick={() => setLabDetailsModal(null)} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: C.white }}>&times;</button>
                        </div>
                        <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", background: C.white }}>
                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                <thead>
                                    <tr style={{ borderBottom: `1px solid ${C.fog}`, background: C.ghost }}>
                                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase" }}>Test Name</th>
                                        <th style={{ padding: "12px 16px", textAlign: "left", fontSize: "11px", color: C.smoke, fontWeight: 600, textTransform: "uppercase" }}>Result</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {Array.isArray(labDetailsModal.content) && labDetailsModal.content.map((t, idx) => (
                                        <tr key={idx} style={{ borderBottom: idx === labDetailsModal.content.length - 1 ? "none" : `1px solid ${C.fog}` }}>
                                            <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{t.testName}</td>
                                            <td style={{ padding: "12px 16px", fontSize: "13px", color: C.charcoal }}>{t.remarks.replace('Extracted: ', '')}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.black}`, display: "flex", justifyContent: "flex-end", background: C.ghost }}>
                            <button type="button" onClick={() => setLabDetailsModal(null)} style={{ ...primaryButtonStyle }}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {valuesDialog.open && valuesDialog.inv && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ background: C.white, borderRadius: "4px", border: `1px solid ${C.black}`, width: "90%", maxWidth: "800px", maxHeight: "80vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", overflow: "hidden" }}>
                        <div style={{ padding: "12px 20px", background: C.black, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h3 style={{ margin: 0, fontSize: "15px", color: C.white, textTransform: "capitalize", fontWeight: 600 }}>Extracted Values</h3>
                            <button type="button" onClick={() => setValuesDialog({ open: false, inv: null })} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: C.white }}>&times;</button>
                        </div>
                        <div style={{ padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "16px", background: C.white }}>
                            <div style={{ overflowX: "auto", border: `1px solid ${C.fog}`, borderRadius: "4px" }}>
                                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "12px", background: C.white }}>
                                    <thead>
                                        <tr style={{ background: C.ghost, textAlign: "left", color: C.smoke }}>
                                            <th style={{ padding: "10px 12px", borderBottom: `1px solid ${C.fog}`, fontWeight: 600, textTransform: "uppercase", fontSize: "11px" }}>Parameter</th>
                                            <th style={{ padding: "10px 12px", borderBottom: `1px solid ${C.fog}`, fontWeight: 600, textTransform: "uppercase", fontSize: "11px" }}>Date</th>
                                            <th style={{ padding: "10px 12px", borderBottom: `1px solid ${C.fog}`, fontWeight: 600, textTransform: "uppercase", fontSize: "11px" }}>Content</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {(valuesDialog.inv.parameterwise_content || []).length === 0 ? (
                                            <tr><td colSpan="3" style={{ padding: "16px", textAlign: "center", color: C.ash }}>No extracted values.</td></tr>
                                        ) : (valuesDialog.inv.parameterwise_content || []).map((p, i) => (
                                            <tr key={i} style={{ borderBottom: i === ((valuesDialog.inv.parameterwise_content || []).length - 1) ? "none" : `1px solid ${C.fog}` }}>
                                                <td style={{ padding: "10px 12px", color: C.charcoal }}>{p.parameter_name || "—"}</td>
                                                <td style={{ padding: "10px 12px", color: C.charcoal }}>{p.date || "—"}</td>
                                                <td style={{ padding: "10px 12px", color: C.charcoal, whiteSpace: "pre-wrap" }}>{p.content || "—"}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.black}`, display: "flex", justifyContent: "flex-end", background: C.ghost }}>
                            <button type="button" onClick={() => setValuesDialog({ open: false, inv: null })} style={{ padding: "8px 16px", background: C.black, color: C.white, border: "none", borderRadius: "4px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}>Close</button>
                        </div>
                    </div>
                </div>
            )}

            {showReportModal && (
                <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "rgba(0,0,0,0.5)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <div style={{ background: C.white, borderRadius: "4px", border: `1px solid ${C.black}`, width: "90%", maxWidth: "800px", maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: "0 20px 25px -5px rgba(0,0,0,0.1)", overflow: "hidden" }}>
                        <div style={{ padding: "16px 20px", background: C.black, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <h3 style={{ margin: 0, fontSize: "16px", color: C.white, fontWeight: 600 }}>Radiotherapy Planning Report</h3>
                            <button type="button" onClick={() => setShowReportModal(false)} style={{ background: "transparent", border: "none", fontSize: "20px", cursor: "pointer", color: C.white }}>&times;</button>
                        </div>
                        <div style={{ flex: 1, padding: "20px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "20px", background: "#fafafa" }}>
                            {[
                                { title: "Patient Info", key: "patient" },
                                { title: "Baseline", key: "baseline" },
                                { title: "Treatment Intent", key: "intent" },
                                { title: "Patient Setup", key: "setup" },
                                { title: "Simulation", key: "simulation" },
                                { title: "Treatment Plan", key: "treatment" },
                                { title: "Image Guidance", key: "imaging" }
                            ].map(section => {
                                const data = formData[section.key];
                                if (!data || Object.keys(data).length === 0) return null;

                                const entries = Object.entries(data).filter(([k, v]) => v !== null && v !== undefined && v !== "" && !['labOrderFields', 'radOrderFields', 'history'].includes(k));
                                if (entries.length === 0) return null;

                                const renderValue = (v) => {
                                    if (typeof v === 'boolean') return v ? 'Yes' : 'No';
                                    if (Array.isArray(v)) {
                                        if (v.length === 0) return '-';
                                        if (typeof v[0] === 'object') {
                                            return (
                                                <table style={{ width: "100%", borderCollapse: "collapse", marginTop: "4px" }}>
                                                    <tbody>
                                                        {v.map((item, i) => (
                                                            <tr key={i} style={{ borderBottom: i === v.length - 1 ? "none" : `1px solid ${C.fog}` }}>
                                                                <td style={{ padding: "4px 0", fontSize: "13px" }}>
                                                                    {Object.entries(item).filter(([ik, iv]) => iv !== null && iv !== "" && ik !== "_isNew").map(([ik, iv]) => `${ik.replace(/([A-Z])/g, ' $1')}: ${iv}`).join(' | ')}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            );
                                        }
                                        return v.join(', ');
                                    }
                                    if (typeof v === 'object') return JSON.stringify(v);
                                    return String(v);
                                };

                                const isExpanded = expandedReportSections[section.key];
                                return (
                                    <div key={section.key} style={{ flexShrink: 0, background: C.white, border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden" }}>
                                        <div
                                            onClick={() => setExpandedReportSections(prev => ({ ...prev, [section.key]: !prev[section.key] }))}
                                            style={{ margin: 0, padding: "10px 16px", background: C.ghost, fontSize: "14px", color: C.charcoal, borderBottom: isExpanded ? `1px solid ${C.fog}` : "none", fontWeight: 600, display: "flex", justifyContent: "space-between", alignItems: "center", cursor: "pointer", userSelect: "none" }}
                                        >
                                            {section.title}
                                            <span style={{ transform: isExpanded ? "rotate(180deg)" : "none", transition: "transform 0.2s", fontSize: "12px", color: C.smoke }}>▼</span>
                                        </div>
                                        {isExpanded && (
                                            <table style={{ width: "100%", borderCollapse: "collapse" }}>
                                                <tbody>
                                                    {entries.map(([k, v], index) => (
                                                        <tr key={k} style={{ borderBottom: index === entries.length - 1 ? "none" : `1px solid ${C.fog}` }}>
                                                            <td style={{ padding: "10px 16px", fontSize: "13px", color: C.smoke, width: "35%", verticalAlign: "top", fontWeight: 500, borderRight: `1px solid ${C.fog}`, textTransform: "capitalize" }}>
                                                                {k.replace(/([A-Z])/g, ' $1')}
                                                            </td>
                                                            <td style={{ padding: "10px 16px", fontSize: "13px", color: C.charcoal, width: "65%", wordBreak: "break-word", verticalAlign: "top" }}>
                                                                {renderValue(v)}
                                                            </td>
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{ padding: "12px 20px", borderTop: `1px solid ${C.fog}`, display: "flex", justifyContent: "flex-end", background: C.white }}>
                            <button type="button" onClick={() => setShowReportModal(false)} style={{ ...buttonStyle, background: C.ghost }}>Close</button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
}
