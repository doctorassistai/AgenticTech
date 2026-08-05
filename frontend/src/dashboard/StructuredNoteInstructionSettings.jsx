import React, { useState, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Save, ArrowLeft, FileText, AlertCircle, CheckCircle, Notebook } from "lucide-react";
import logo from "../assets/lodo_only.png";
import { Home, Calendar, Settings, LogOut } from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;
const SIDEBAR_WIDTH = "248px";

/* ─── THEME TOKENS (matches doctorassist.ai website) ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStr: "#000000",
  accent: "#000000",
};

/* ─── STYLES ─── */
const S = {
  layout: {
    display: "flex",
    minHeight: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
  },

  /* sidebar */
  sidebar: {
    width: SIDEBAR_WIDTH,
    minHeight: "100vh",
    position: "fixed",
    left: 0,
    top: 0,
    background: T.bg,
    borderRight: `1px solid ${T.border}`,
    display: "flex",
    flexDirection: "column",
    zIndex: 200,
    overflowY: "auto",
  },
  sidebarHeader: {
    padding: "1.5rem 1.5rem 1rem",
    borderBottom: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  brandName: {
    fontWeight: 400,
    fontSize: "0.9rem",
    letterSpacing: "-0.01em",
    color: T.text,
    margin: 0,
  },
  sectionLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },
  doctorName: {
    fontSize: "0.9rem",
    fontWeight: 400,
    color: T.text,
    margin: 0,
  },
  doctorSpec: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
  },
  menuScroll: {
    flex: 1,
    overflowY: "auto",
    padding: "0.75rem 0",
  },
  navGroupLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.15em",
    color: T.textMuted,
    fontWeight: 400,
    padding: "0.5rem 0.75rem 0.25rem",
    display: "block",
  },
  navBtn: {
    width: "100%",
    background: "transparent",
    border: "none",
    textAlign: "left",
    padding: "0.55rem 1.25rem",
    fontSize: "0.78rem",
    fontWeight: 300,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    transition: "all 0.15s",
    fontFamily: "'Open Sans', sans-serif",
    borderLeft: "2px solid transparent",
  },
  navBtnActive: {
    background: T.bgAlt,
    color: T.text,
    fontWeight: 400,
    borderLeft: `2px solid ${T.accent}`,
  },
  sidebarFooter: {
    padding: "1rem 1.25rem",
    borderTop: `1px solid ${T.border}`,
    flexShrink: 0,
  },
  logoutBtn: {
    width: "100%",
    background: "transparent",
    border: `1px solid ${T.border}`,
    padding: "0.6rem 1rem",
    fontSize: "0.75rem",
    fontWeight: 400,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "8px",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.2s",
  },

  /* main */
  main: {
    flex: 1,
    marginLeft: SIDEBAR_WIDTH,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
  },

  /* top bar */
  topBar: {
    position: "sticky",
    top: 0,
    background: T.bg,
    borderBottom: `1px solid ${T.border}`,
    padding: "0.875rem 2rem",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    zIndex: 100,
  },
  topBarTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
  },
  topBarMeta: {
    fontSize: "0.72rem",
    color: T.textMuted,
  },

  /* page body */
  body: {
    padding: "2rem",
    flex: 1,
    maxWidth: "900px",
    width: "100%",
  },

  pageLabel: {
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.2em",
    color: T.textMuted,
    fontWeight: 400,
    display: "block",
    marginBottom: "0.25rem",
  },
  pageTitle: {
    fontSize: "1.4rem",
    fontWeight: 300,
    letterSpacing: "-0.02em",
    color: T.text,
    marginBottom: "0.25rem",
    margin: 0,
  },
  pageSub: {
    fontSize: "0.8rem",
    color: T.textMuted,
    marginBottom: "2rem",
    marginTop: "0.25rem",
  },

  /* doctor info bar */
  infoBar: {
    border: `1px solid ${T.border}`,
    background: T.bgAlt,
    padding: "0.875rem 1.25rem",
    display: "flex",
    alignItems: "center",
    gap: "10px",
    marginBottom: "2rem",
  },
  infoBarName: {
    fontSize: "0.82rem",
    fontWeight: 400,
    color: T.text,
    margin: 0,
  },
  infoBarSpec: {
    fontSize: "0.72rem",
    color: T.textMuted,
    margin: "2px 0 0",
  },

  /* textarea section */
  fieldSection: {
    border: `1px solid ${T.border}`,
    marginBottom: "1.5rem",
  },
  fieldHeader: {
    padding: "0.875rem 1.25rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
  },
  fieldHeaderTitle: {
    fontSize: "0.72rem",
    fontWeight: 400,
    color: T.text,
    textTransform: "uppercase",
    letterSpacing: "0.1em",
    margin: 0,
  },
  fieldHeaderMeta: {
    fontSize: "0.65rem",
    color: T.textMuted,
  },
  textarea: {
    width: "100%",
    minHeight: "320px",
    padding: "1.25rem",
    fontSize: "0.82rem",
    lineHeight: "1.7",
    color: T.textSec,
    background: T.bg,
    border: "none",
    outline: "none",
    resize: "vertical",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    display: "block",
  },

  /* save button */
  saveBtn: {
    background: T.text,
    color: T.bg,
    border: `1px solid ${T.text}`,
    padding: "0.875rem 2rem",
    fontSize: "0.78rem",
    fontWeight: 400,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontFamily: "'Open Sans', sans-serif",
    letterSpacing: "0.05em",
    transition: "all 0.2s",
    width: "100%",
    justifyContent: "center",
  },
  saveBtnDisabled: {
    opacity: 0.45,
    cursor: "not-allowed",
  },

  /* messages */
  successMsg: {
    border: `1px solid ${T.border}`,
    borderLeft: `3px solid ${T.accent}`,
    background: T.bgAlt,
    padding: "0.875rem 1.25rem",
    marginTop: "1rem",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.78rem",
    color: T.text,
    fontWeight: 400,
  },
  errorMsg: {
    border: `1px solid ${T.border}`,
    borderLeft: "3px solid #000",
    background: T.bgAlt,
    padding: "0.875rem 1.25rem",
    marginTop: "1rem",
    display: "flex",
    alignItems: "center",
    gap: "8px",
    fontSize: "0.78rem",
    color: T.text,
    fontWeight: 400,
  },

  loadingWrap: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: "240px",
    fontSize: "0.78rem",
    color: T.textMuted,
    letterSpacing: "0.1em",
    textTransform: "uppercase",
  },

  backBtn: {
    background: "transparent",
    border: `1px solid ${T.border}`,
    padding: "0.45rem 0.875rem",
    fontSize: "0.72rem",
    fontWeight: 400,
    color: T.textSec,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    gap: "6px",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
  },
};

function StructuredNoteInstructionsSettings() {
  const location = useLocation();
  const navigate = useNavigate();

  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");

  const [ruleText, setRuleText] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState("");
  const [doctorName, setDoctorName] = useState("");
  const [doctorSpeciality, setDoctorSpeciality] = useState("");

  useEffect(() => {
    if (!doctorId) return;

    const fetchExistingRule = async () => {
      setLoading(true);
      setError("");
      try {
        const doctorRes = await fetch(
          `${API_BASE_URL}hms/users/speciality/users/patient/get_doctor_details`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ doctor_id: doctorId }),
          }
        );
        const doctorData = await doctorRes.json();

        if (doctorData.status === "success") {
          const speciality = doctorData.doctor_speciality;
          setDoctorName(doctorData.doctor_name);
          setDoctorSpeciality(speciality);

          const doctorRuleRes = await fetch(
            `${API_BASE_URL}hms/users/data/context/structured-note-instructions/${doctorId}`
          );
          if (doctorRuleRes.ok) {
            const doctorRuleData = await doctorRuleRes.json();
            if (
              doctorRuleData.status === "success" &&
              doctorRuleData.instructions &&
              doctorRuleData.instructions.trim() !== ""
            ) {
              setRuleText(doctorRuleData.instructions);
              return;
            }
          }

          const ruleRes = await fetch(
            `${API_BASE_URL}hms/users/data/context/get_StructuredNoteAdminRules`
          );
          const ruleData = await ruleRes.json();
          if (ruleData.status === "success") {
            const matchedRule = ruleData.data.find(
              (item) =>
                item.speciality.toLowerCase().trim() === speciality.toLowerCase().trim()
            );
            if (matchedRule) setRuleText(matchedRule.rule_text);
          }
        }
      } catch (err) {
        setError("Failed to load instructions");
      } finally {
        setLoading(false);
      }
    };

    fetchExistingRule();
  }, [doctorId]);

  const handleSave = async () => {
    if (!doctorId) { setError("Doctor ID missing"); return; }
    setSaving(true);
    setError("");
    setSaveSuccess(false);
    try {
      const response = await fetch(
        `${API_BASE_URL}hms/users/data/context/structured-note-instructions`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ doctor_id: doctorId, instructions: ruleText }),
        }
      );
      const data = await response.json();
      if (data.status === "success") {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4000);
      } else {
        setError(data.message || "Failed to save instructions");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  /* ─── NAV SECTIONS ─── */
  const navSections = [
    {
      label: "Overview",
      items: [
        {
          label: "Dashboard",
          icon: <Home size={14} />,
          action: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`),
          key: null,
        },
      ],
    },
    {
      label: "Skills",
      items: [
        {
          label: "Medical Context Skills",
          icon: <Calendar size={14} />,
          action: () => navigate(`/medical-current-context-rule-settings?doctor_id=${doctorId}`),
          key: "context",
        },
        {
          label: "Structured Note Skills",
          icon: <Notebook size={14} />,
          action: () => {},
          key: "structured",
          active: true,
        },
        {
          label: "Guidelines Skills",
          icon: <FileText size={14} />,
          action: () => navigate(`/guidelines-settings?doctor_id=${doctorId}`),
          key: "guidelines",
        },
      ],
    },
  ];

  if (!doctorId) {
    return (
      <div style={{
        ...S.layout,
        alignItems: "center",
        justifyContent: "center",
        flexDirection: "column",
        gap: "1rem",
      }}>
        <AlertCircle size={32} color={T.textMuted} />
        <p style={{ fontSize: "0.85rem", color: T.textMuted, letterSpacing: "0.05em" }}>
          Doctor ID missing. Please access this page through the dashboard.
        </p>
        <button
          onClick={() => navigate("/login")}
          style={{ ...S.saveBtn, width: "auto", padding: "0.6rem 1.5rem" }}
        >
          Go to Login
        </button>
      </div>
    );
  }

  return (
    <div style={S.layout}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
        .da-logout:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .da-save-btn:hover:not(:disabled) { background: transparent !important; color: ${T.text} !important; }
        .da-back-btn:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .da-textarea:focus { outline: none; }
        .da-menu-scroll::-webkit-scrollbar { display: none; }
        .da-menu-scroll { -ms-overflow-style: none; scrollbar-width: none; }
      `}</style>

      {/* ═══════════ SIDEBAR ═══════════ */}
      <aside style={S.sidebar}>
        {/* Brand */}
        <div style={S.sidebarHeader}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.25rem" }}>
            <span style={S.brandName}>DoctorAssist.AI</span>
          </div>
          <span style={S.sectionLabel}>Physician</span>
          <p style={S.doctorName}>{doctorName || "Loading…"}</p>
          <p style={S.doctorSpec}>{doctorSpeciality || "—"}</p>
        </div>

        {/* Nav */}
        <div className="da-menu-scroll" style={S.menuScroll}>
          {navSections.map((sec, si) => (
            <div key={si}>
              <span style={S.navGroupLabel}>{sec.label}</span>
              {sec.items.map((item, ii) => (
                <button
                  key={ii}
                  className="da-nav-btn"
                  style={{
                    ...S.navBtn,
                    ...(item.active ? S.navBtnActive : {}),
                  }}
                  onClick={item.action}
                >
                  {item.icon}
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>

        {/* Logout */}
        <div style={S.sidebarFooter}>
          <button
            className="da-logout"
            style={S.logoutBtn}
            onClick={() => navigate("/login")}
          >
            <LogOut size={13} />
            <span>Logout</span>
          </button>
        </div>
      </aside>

      {/* ═══════════ MAIN ═══════════ */}
      <main style={S.main}>
        {/* Top bar */}
        <div style={S.topBar}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <button
              className="da-back-btn"
              style={S.backBtn}
              onClick={() => navigate(`/doctor-dashboard?doctor_id=${doctorId}`)}
            >
              <ArrowLeft size={13} />
              Back to Dashboard
            </button>
            <span style={{ color: T.border, fontSize: "0.75rem" }}>|</span>
            <span style={S.topBarTitle}>Structured Note Skills</span>
          </div>
          <span style={S.topBarMeta}>
            {ruleText.length > 0 ? `${ruleText.length} characters` : "No instructions set"}
          </span>
        </div>

        {/* Body */}
        <div style={S.body}>
          <span style={S.pageLabel}>Configuration</span>
          <h1 style={S.pageTitle}>Structured Note Instructions</h1>
          <p style={S.pageSub}>
            Configure note templates, formatting rules, and clinical reasoning structure for this physician.
          </p>

          {/* Doctor info bar */}
          <div style={S.infoBar}>
            <FileText size={14} color={T.textMuted} />
            <div>
              <p style={S.infoBarName}>
                {doctorName ? `Dr. ${doctorName}` : "Loading doctor information…"}
              </p>
              {doctorSpeciality && (
                <p style={S.infoBarSpec}>{doctorSpeciality}</p>
              )}
            </div>
          </div>

          {loading ? (
            <div style={S.loadingWrap}>
              Loading instructions…
            </div>
          ) : (
            <>
              {/* Textarea block */}
              <div style={S.fieldSection}>
                <div style={S.fieldHeader}>
                  <span style={S.fieldHeaderTitle}>Note Instructions / Rules</span>
                  <span style={S.fieldHeaderMeta}>
                    {ruleText.length} characters
                  </span>
                </div>
                <textarea
                  className="da-textarea"
                  value={ruleText}
                  onChange={(e) => {
                    setRuleText(e.target.value);
                    setSaveSuccess(false);
                  }}
                  disabled={saving}
                  placeholder={`Enter your structured note instructions here…

Examples:
— Always include patient's chief complaint in the assessment
— Format diagnosis as: Primary, Secondary, Other
— Include vital signs in every note
— List medications with dosage and frequency
— Document allergies prominently

You can write multiple lines of instructions that will guide the note structure.`}
                  style={S.textarea}
                />
              </div>

              {/* Save button */}
              <button
                className="da-save-btn"
                onClick={handleSave}
                disabled={saving}
                style={{
                  ...S.saveBtn,
                  ...(saving ? S.saveBtnDisabled : {}),
                }}
              >
                <Save size={14} />
                {saving ? "Saving…" : "Save Instructions"}
              </button>

              {/* Success */}
              {saveSuccess && (
                <div style={S.successMsg}>
                  <CheckCircle size={14} />
                  Instructions saved successfully.
                </div>
              )}

              {/* Error */}
              {error && (
                <div style={S.errorMsg}>
                  <AlertCircle size={14} />
                  {error}
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default StructuredNoteInstructionsSettings;