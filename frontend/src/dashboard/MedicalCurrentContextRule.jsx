import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import logo from "../assets/lodo_only.png";
import {
  Home, Settings, Bed, MessageCircle, Calendar, Activity,
  LogOut, UserPlus, Shield, Brain, Stethoscope, ClipboardList,
  Gauge, Sparkles, Target, FileText, CheckCircle, Plus, Notebook,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─────────────────────────────────────────
   THEME TOKENS
───────────────────────────────────────── */
const T = {
  bg:        "#ffffff",
  bgAlt:     "#fafafa",
  bgTert:    "#f5f5f5",
  text:      "#000000",
  textSec:   "#444444",
  textMuted: "#888888",
  border:    "#e0e0e0",
  borderStr: "#000000",
  font:      "'Open Sans', sans-serif",
};

const SIDEBAR_W = "240px";

/* ─────────────────────────────────────────
   GLOBAL CSS
───────────────────────────────────────── */
const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  ::selection { background: #000; color: #fff; }
  body, html { font-family: ${T.font}; font-weight: 300; background: ${T.bg}; color: ${T.text}; -webkit-font-smoothing: antialiased; }
  input, select, textarea, button { font-family: ${T.font}; font-weight: 300; }

  .da-nav-btn { transition: background 0.15s, color 0.15s; }
  .da-nav-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }
  .da-nav-btn.da-active { background: ${T.bgAlt} !important; color: ${T.text} !important; font-weight: 400 !important; border-left-color: ${T.borderStr} !important; }

  .da-btn-primary:hover { background: transparent !important; color: ${T.text} !important; }
  .da-btn-outline:hover { border-color: ${T.borderStr} !important; color: ${T.text} !important; }
  .da-btn-ghost:hover   { background: ${T.bgAlt} !important; }

  .da-tab-btn { transition: all 0.15s; cursor: pointer; }
  .da-tab-btn:hover { background: ${T.bgAlt} !important; color: ${T.text} !important; }

  .da-cat-row:hover { background: ${T.bgAlt} !important; }
  .da-sidebar-scroll::-webkit-scrollbar { display: none; }
  .da-sidebar-scroll { -ms-overflow-style: none; scrollbar-width: none; }

  .da-list-scroll { max-height: 520px; overflow-y: auto; }
  .da-list-scroll::-webkit-scrollbar { width: 3px; }
  .da-list-scroll::-webkit-scrollbar-thumb { background: ${T.border}; }

  .da-textarea {
    width: 100%; padding: 0.75rem 0.875rem;
    border: 1px solid ${T.border}; background: ${T.bg};
    font-family: 'Courier New', monospace; font-weight: 300;
    font-size: 0.78rem; color: ${T.text};
    outline: none; resize: vertical; line-height: 1.6;
    transition: border-color 0.15s;
  }
  .da-textarea:focus { border-color: ${T.borderStr}; }

  .da-input {
    width: 100%; height: 40px; padding: 0 0.875rem;
    border: 1px solid ${T.border}; background: ${T.bg};
    font-family: ${T.font}; font-weight: 300;
    font-size: 0.82rem; color: ${T.text};
    outline: none; transition: border-color 0.15s;
  }
  .da-input:focus { border-color: ${T.borderStr}; }
  .da-input::placeholder { color: #bbb; }

  @keyframes da-fadeup { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }
  .da-fadein { animation: da-fadeup 0.18s ease; }
`;

/* ─────────────────────────────────────────
   SHARED STYLE SNIPPETS
───────────────────────────────────────── */
const S = {
  secLabel: {
    fontSize: "0.6rem", textTransform: "uppercase",
    letterSpacing: "0.18em", color: T.textMuted,
    fontWeight: 400, display: "block", marginBottom: "0.2rem",
  },
  btnPrimary: {
    padding: "0.55rem 1.25rem",
    background: T.text, color: T.bg,
    border: `1px solid ${T.text}`,
    fontSize: "0.75rem", fontWeight: 400,
    cursor: "pointer", fontFamily: T.font,
    transition: "all 0.15s",
    display: "inline-flex", alignItems: "center", gap: "6px",
    letterSpacing: "0.04em",
  },
  btnOutline: {
    padding: "0.55rem 1.25rem",
    background: T.bg, color: T.textSec,
    border: `1px solid ${T.border}`,
    fontSize: "0.75rem", fontWeight: 300,
    cursor: "pointer", fontFamily: T.font,
    transition: "all 0.15s",
    display: "inline-flex", alignItems: "center", gap: "6px",
  },
  card: {
    background: T.bg, border: `1px solid ${T.border}`,
    padding: "1.5rem",
  },
  cardHeader: {
    display: "flex", alignItems: "center", gap: "10px",
    paddingBottom: "1rem", marginBottom: "1.25rem",
    borderBottom: `1px solid ${T.border}`,
  },
};

/* ─────────────────────────────────────────
   MAIN COMPONENT
───────────────────────────────────────── */
const MedicalCurrentContextRule = () => {
  const location   = useLocation();
  const navigate   = useNavigate();
  const currentPath = location.pathname;
  const queryParams = new URLSearchParams(location.search);
  let doctorId = queryParams.get("doctor_id");

  if (!doctorId) {
    const match = location.search.match(/doctor_id=([^&]+)/);
    if (match) doctorId = match[1];
  }

  /* ── state ── */
  const [medicalCategoriesList, setMedicalCategoriesList] = useState([]);
  const [currentCategoriesList, setCurrentCategoriesList] = useState([]);
  const [showNewMedicalInput,   setShowNewMedicalInput]   = useState(false);
  const [showNewCurrentInput,   setShowNewCurrentInput]   = useState(false);
  const [newMedicalCategory,    setNewMedicalCategory]    = useState("");
  const [newCurrentCategory,    setNewCurrentCategory]    = useState("");
  const [doctorName,            setDoctorName]            = useState("");
  const [doctorSpeciality,      setDoctorSpeciality]      = useState("");
  const [medicalCategoryRules,  setMedicalCategoryRules]  = useState({});
  const [currentCategoryRules,  setCurrentCategoryRules]  = useState({});
  const [doctorMedicalRulesCache, setDoctorMedicalRulesCache] = useState({});
  const [doctorCurrentRulesCache, setDoctorCurrentRulesCache] = useState({});
  const [focusedField,          setFocusedField]          = useState(null);
  const [activeTab,             setActiveTab]             = useState("medical");
  const [authChecked,           setAuthChecked]           = useState(false);
  const [formData, setFormData] = useState({
    specialty: "", medicalOutputCategories: [], currentOutputCategories: [],
    medicalCategoryRules: {}, currentCategoryRules: {}, isActive: false,
  });

  const medicalScrollRef = useRef(null);
  const currentScrollRef = useRef(null);

  /* ── auth ── */
  useEffect(() => {
    if (!doctorId) { navigate("/login"); return; }
    fetch(`${API_BASE_URL}/hms/users/doctors/verify`, { credentials: "include" })
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(data => { if (doctorId !== data.doctor.sys_user_id) navigate("/login"); })
      .catch(() => navigate("/login"))
      .finally(() => setAuthChecked(true));
  }, [doctorId, navigate]);

  /* ── doctor details ── */
  useEffect(() => {
    if (!doctorId) return;
    fetch(`${API_BASE_URL}/hms/users/speciality/users/patient/get_doctor_details`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ doctor_id: doctorId }),
    })
      .then(r => r.json())
      .then(d => { if (d.status === "success") { setDoctorName(d.doctor_name); setDoctorSpeciality(d.doctor_speciality); } })
      .catch(console.error);
  }, [doctorId]);

  /* ── load rules ── */
  useEffect(() => {
    if (!doctorId || !doctorSpeciality) return;
    const load = async () => {
      try {
        const drRes  = await fetch(`${API_BASE_URL}/hms/users/data/context/get_DoctorMedicalCurrentRule/${doctorId}`, { credentials: "include" });
        const drData = await drRes.json();

        if (drData.status === "success") {
          const rule = drData.data;
          const mCats  = rule.medical_context.map(i => i.medical_output_category);
          const mRules = Object.fromEntries(rule.medical_context.map(i => [i.medical_output_category, i.rule_text]));
          const cCats  = rule.current_context.map(i => i.current_output_category);
          const cRules = Object.fromEntries(rule.current_context.map(i => [i.current_output_category, i.rule_text]));

          const adminRes  = await fetch(`${API_BASE_URL}/hms/users/data/context/get_MedicalCurrentAdminRules`, { credentials: "include" });
          const adminData = await adminRes.json();
          if (adminData.status === "success") {
            const m = adminData.data.find(r => r.speciality === doctorSpeciality);
            if (m) {
              const aMCats = m.medical_context.map(i => i.medical_output_category);
              const aCCats = m.current_context.map(i => i.current_output_category);
              setMedicalCategoriesList([...new Set([...aMCats, ...mCats])]);
              setCurrentCategoriesList([...new Set([...aCCats, ...cCats])]);
            }
          }
          setMedicalCategoryRules(mRules); setCurrentCategoryRules(cRules);
          setDoctorMedicalRulesCache(mRules); setDoctorCurrentRulesCache(cRules);
          setFormData({ specialty: rule.speciality || "", medicalOutputCategories: mCats, currentOutputCategories: cCats, medicalCategoryRules: mRules, currentCategoryRules: cRules, isActive: rule.is_active ?? true });
          return;
        }

        const adminRes  = await fetch(`${API_BASE_URL}/hms/users/data/context/get_MedicalCurrentAdminRules`, { credentials: "include" });
        const adminData = await adminRes.json();
        if (adminData.status === "success") {
          const m = adminData.data.find(r => r.speciality === doctorSpeciality);
          if (!m) return;
          const mCats  = m.medical_context.map(i => i.medical_output_category);
          const mRules = Object.fromEntries(m.medical_context.map(i => [i.medical_output_category, i.rule_text]));
          const cCats  = m.current_context.map(i => i.current_output_category);
          const cRules = Object.fromEntries(m.current_context.map(i => [i.current_output_category, i.rule_text]));
          setMedicalCategoriesList(mCats); setCurrentCategoriesList(cCats);
          setMedicalCategoryRules(mRules); setCurrentCategoryRules(cRules);
          setFormData({ specialty: m.speciality || "", medicalOutputCategories: mCats, currentOutputCategories: cCats, medicalCategoryRules: mRules, currentCategoryRules: cRules, isActive: true });
        }
      } catch (e) { console.error(e); }
    };
    load();
  }, [doctorId, doctorSpeciality]);

  useEffect(() => { if (medicalScrollRef.current) medicalScrollRef.current.scrollTop = medicalScrollRef.current.scrollHeight; }, [medicalCategoriesList]);
  useEffect(() => { if (currentScrollRef.current) currentScrollRef.current.scrollTop = currentScrollRef.current.scrollHeight; }, [currentCategoriesList]);

  /* ── handlers ── */
  const handleLogout = async () => {
    try { await fetch(`${API_BASE_URL}/hms/users/auth/logout`, { method: "POST", credentials: "include" }); }
    finally { navigate("/login"); }
  };

  const handleMedicalRuleChange = (cat, val) => {
    setMedicalCategoryRules(p => ({ ...p, [cat]: val }));
    setFormData(p => ({ ...p, medicalCategoryRules: { ...p.medicalCategoryRules, [cat]: val } }));
    setDoctorMedicalRulesCache(p => ({ ...p, [cat]: val }));
  };
  const handleCurrentRuleChange = (cat, val) => {
    setCurrentCategoryRules(p => ({ ...p, [cat]: val }));
    setFormData(p => ({ ...p, currentCategoryRules: { ...p.currentCategoryRules, [cat]: val } }));
    setDoctorCurrentRulesCache(p => ({ ...p, [cat]: val }));
  };

  const handleAddMedicalCategory = () => {
    const cat = newMedicalCategory.trim(); if (!cat) return;
    setMedicalCategoriesList(p => [...p, cat]);
    setMedicalCategoryRules(p => ({ ...p, [cat]: "" }));
    setDoctorMedicalRulesCache(p => ({ ...p, [cat]: "" }));
    setFormData(p => ({ ...p, medicalOutputCategories: [...p.medicalOutputCategories, cat], medicalCategoryRules: { ...p.medicalCategoryRules, [cat]: "" } }));
    setNewMedicalCategory(""); setShowNewMedicalInput(false);
    setTimeout(() => { if (medicalScrollRef.current) medicalScrollRef.current.scrollTop = medicalScrollRef.current.scrollHeight; }, 100);
  };
  const handleAddCurrentCategory = () => {
    const cat = newCurrentCategory.trim(); if (!cat) return;
    setCurrentCategoriesList(p => [...p, cat]);
    setCurrentCategoryRules(p => ({ ...p, [cat]: "" }));
    setDoctorCurrentRulesCache(p => ({ ...p, [cat]: "" }));
    setFormData(p => ({ ...p, currentOutputCategories: [...p.currentOutputCategories, cat], currentCategoryRules: { ...p.currentCategoryRules, [cat]: "" } }));
    setNewCurrentCategory(""); setShowNewCurrentInput(false);
  };

  const handleMedicalCategoryChange = async (cat) => {
    const isSelected = formData.medicalOutputCategories.includes(cat);
    if (isSelected) {
      const updated = formData.medicalOutputCategories.filter(c => c !== cat);
      setFormData(p => ({ ...p, medicalOutputCategories: updated }));
    } else {
      let ruleText = "";
      try {
        const res  = await fetch(`${API_BASE_URL}/hms/users/data/context/get_MedicalCurrentAdminRules`, { credentials: "include" });
        const data = await res.json();
        if (data.status === "success") {
          const m = data.data.find(r => r.speciality === doctorSpeciality);
          ruleText = m?.medical_context.find(i => i.medical_output_category === cat)?.rule_text || "";
        }
      } catch {}
      const rule = doctorMedicalRulesCache[cat] ?? ruleText;
      const updatedRules = { ...formData.medicalCategoryRules, [cat]: rule };
      setMedicalCategoryRules(updatedRules);
      setFormData(p => ({ ...p, medicalOutputCategories: [...p.medicalOutputCategories, cat], medicalCategoryRules: updatedRules }));
    }
  };
  const handleCurrentCategoryChange = async (cat) => {
    const isSelected = formData.currentOutputCategories.includes(cat);
    if (isSelected) {
      setFormData(p => ({ ...p, currentOutputCategories: p.currentOutputCategories.filter(c => c !== cat) }));
    } else {
      let ruleText = "";
      try {
        const res  = await fetch(`${API_BASE_URL}/hms/users/data/context/get_MedicalCurrentAdminRules`, { credentials: "include" });
        const data = await res.json();
        if (data.status === "success") {
          const m = data.data.find(r => r.speciality === doctorSpeciality);
          ruleText = m?.current_context.find(i => i.current_output_category === cat)?.rule_text || "";
        }
      } catch {}
      const rule = doctorCurrentRulesCache[cat] ?? formData.currentCategoryRules?.[cat] ?? ruleText;
      const updatedRules = { ...formData.currentCategoryRules, [cat]: rule };
      setCurrentCategoryRules(updatedRules);
      setFormData(p => ({ ...p, currentOutputCategories: [...p.currentOutputCategories, cat], currentCategoryRules: updatedRules }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const payload = {
        doctor_id: doctorId, speciality: doctorSpeciality,
        medical_context: formData.medicalOutputCategories.map(cat => ({ medical_output_category: cat, rule_text: formData.medicalCategoryRules[cat] || "" })),
        current_context: formData.currentOutputCategories.map(cat => ({ current_output_category: cat, rule_text: formData.currentCategoryRules[cat] || "" })),
        is_active: formData.isActive,
      };
      const res = await fetch(`${API_BASE_URL}/hms/users/data/context/save_DoctorMedicalCurrentRule`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        credentials: "include", body: JSON.stringify(payload),
      });
      if (res.ok) alert("Configuration saved successfully.");
      else alert("Failed to save configuration.");
    } catch (e) { console.error(e); alert("Something went wrong."); }
  };

  if (!authChecked) return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, fontSize: "0.78rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.15em" }}>
      Verifying session…
    </div>
  );
  if (!doctorId) return (
    <div style={{ height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: T.font, fontSize: "0.82rem", color: T.text }}>
      Doctor ID missing. Please log in again.
    </div>
  );

  const navItems = [
    { label: "Dashboard",                         icon: <Home size={14} />,         onClick: () => navigate(`/doctor-dashboard?doctor_id=${doctorId}`) },
    { label: "Medical Context Skills",      icon: <Calendar size={14} />,     active: currentPath.includes("medical-current-context-rule"), onClick: () => navigate(`/medical-current-context-rule-settings?doctor_id=${doctorId}`) },
    { label: "Structured Note Skills",      icon: <Notebook size={14} />,     onClick: () => navigate(`/structured-note-instructions-settings?doctor_id=${doctorId}`) },
    { label: "Guidelines Skills",               icon: <FileText size={14} />,     onClick: () => navigate(`/guidelines-settings?doctor_id=${doctorId}`) },
  ];

  /* ── Category section renderer ── */
  const renderCategorySection = (type) => {
    const isMedical   = type === "medical";
    const categories  = isMedical ? medicalCategoriesList        : currentCategoriesList;
    const selected    = isMedical ? formData.medicalOutputCategories : formData.currentOutputCategories;
    const rules       = isMedical ? medicalCategoryRules         : currentCategoryRules;
    const scrollRef   = isMedical ? medicalScrollRef             : currentScrollRef;
    const showNew     = isMedical ? showNewMedicalInput          : showNewCurrentInput;
    const newVal      = isMedical ? newMedicalCategory           : newCurrentCategory;
    const setShowNew  = isMedical ? setShowNewMedicalInput       : setShowNewCurrentInput;
    const setNewVal   = isMedical ? setNewMedicalCategory        : setNewCurrentCategory;
    const onAdd       = isMedical ? handleAddMedicalCategory     : handleAddCurrentCategory;
    const onChange    = isMedical ? handleMedicalCategoryChange  : handleCurrentCategoryChange;
    const onRuleChange = isMedical ? handleMedicalRuleChange     : handleCurrentRuleChange;
    const fieldPrefix = isMedical ? "medical" : "current";
    const sectionTitle = isMedical ? "Medical Output Categories" : "Current Output Categories";
    const sectionSub   = isMedical ? "Select categories and define rules for each medical context" : "Select categories and define rules for each current patient context";
    const Icon         = isMedical ? ClipboardList : Gauge;

    return (
      <div style={{ ...S.card, marginBottom: "1.5rem" }} className="da-fadein">
        {/* header */}
        <div style={S.cardHeader}>
          <div style={{ width: 36, height: 36, background: T.bgAlt, border: `1px solid ${T.border}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
            <Icon size={16} color={T.textMuted} />
          </div>
          <div>
            <p style={{ fontSize: "0.9rem", fontWeight: 400, color: T.text, margin: 0 }}>{sectionTitle}</p>
            <p style={{ fontSize: "0.7rem", color: T.textMuted, margin: "2px 0 0", fontWeight: 300 }}>{sectionSub}</p>
          </div>
          <span style={{ marginLeft: "auto", ...S.secLabel, margin: 0 }}>{selected.length} selected</span>
        </div>

        {/* list */}
        <div style={{ border: `1px solid ${T.border}`, background: T.bgAlt }}>
          {/* list header */}
          <div style={{ padding: "0.65rem 1rem", borderBottom: `1px solid ${T.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontSize: "0.65rem", textTransform: "uppercase", letterSpacing: "0.12em", color: T.textMuted }}>
              Available Categories ({categories.length})
            </span>
          </div>

          {/* scrollable category rows */}
          <div ref={scrollRef} className="da-list-scroll" style={{ background: T.bg }}>
            {categories.map((cat, i) => {
              const isSelected = selected.includes(cat);
              return (
                <div key={i} style={{
                  borderBottom: `1px solid ${T.border}`,
                  background: isSelected ? T.bgAlt : T.bg,
                  transition: "background 0.15s",
                }}>
                  {/* checkbox row */}
                  <div className="da-cat-row"
                    style={{ display: "flex", alignItems: "center", gap: "10px", padding: "0.75rem 1rem", cursor: "pointer" }}
                    onClick={() => onChange(cat)}>
                    <input type="checkbox" checked={isSelected} onChange={() => onChange(cat)}
                      style={{ width: 15, height: 15, cursor: "pointer", accentColor: T.text, flexShrink: 0 }} />
                    <span style={{ fontSize: "0.82rem", fontWeight: isSelected ? 400 : 300, color: T.text, flex: 1 }}>
                      {cat}
                    </span>
                    {isSelected && <CheckCircle size={13} color={T.textMuted} />}
                  </div>

                  {/* rule textarea — shown when selected */}
                  {isSelected && (
                    <div style={{ padding: "0 1rem 1rem 2.5rem", background: T.bgAlt }}>
                      <div style={{ borderLeft: `2px solid ${T.borderStr}`, paddingLeft: "0.875rem" }}>
                        <label style={{ ...S.secLabel, marginBottom: "0.35rem", display: "block" }}>
                          Rule definition for {cat}
                        </label>
                        <textarea
                          className="da-textarea"
                          rows={5}
                          value={rules[cat] || formData[`${fieldPrefix}CategoryRules`]?.[cat] || ""}
                          onChange={e => onRuleChange(cat, e.target.value)}
                          onFocus={() => setFocusedField(`${fieldPrefix}-${cat}`)}
                          onBlur={() => setFocusedField(null)}
                          placeholder={`Define specific rules for ${cat}…`}
                          style={{ borderColor: focusedField === `${fieldPrefix}-${cat}` ? T.borderStr : T.border }}
                        />
                        <p style={{ fontSize: "0.65rem", color: T.textMuted, marginTop: "0.35rem", fontStyle: "italic", fontWeight: 300 }}>
                          Example: For {cat}, specify clinical criteria, required assessments, and protocols.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* add category */}
          <div style={{ borderTop: `1px dashed ${T.border}`, padding: "1rem" }}>
            {!showNew ? (
              <button className="da-btn-outline" style={{ ...S.btnOutline, width: "100%", justifyContent: "center" }}
                onClick={() => setShowNew(true)}>
                <Plus size={13} /> Add New Category
              </button>
            ) : (
              <div>
                <input className="da-input" style={{ marginBottom: "0.75rem" }}
                  type="text" value={newVal} autoFocus
                  onChange={e => setNewVal(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onAdd(); } }}
                  placeholder="Enter new category name…" />
                <div style={{ display: "flex", gap: "0.625rem", justifyContent: "flex-end" }}>
                  <button className="da-btn-outline" style={S.btnOutline}
                    onClick={() => { setShowNew(false); setNewVal(""); }}>
                    Cancel
                  </button>
                  <button className="da-btn-primary" style={S.btnPrimary} onClick={onAdd}>
                    Add Category
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <>
      <style>{CSS}</style>
      <div style={{ display: "flex", minHeight: "100vh", background: T.bg, fontFamily: T.font, fontWeight: 300, color: T.text }}>

        {/* ══════════ SIDEBAR ══════════ */}
        <aside style={{
          width: SIDEBAR_W, minHeight: "100vh",
          position: "fixed", top: 0, left: 0, bottom: 0, zIndex: 100,
          background: T.bg, borderRight: `1px solid ${T.border}`,
          display: "flex", flexDirection: "column",
        }}>
          {/* brand */}
          <div style={{ padding: "1.5rem 1.5rem 1rem", borderBottom: `1px solid ${T.border}`, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "1.25rem" }}>
              
              <span style={{ fontSize: "0.9rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text }}>Doctorassist.AI</span>
            </div>
            <span style={S.secLabel}>Physician</span>
            <p style={{ fontSize: "0.85rem", fontWeight: 400, color: T.text, margin: 0 }}>{doctorName || "Loading…"}</p>
            <p style={{ fontSize: "0.7rem", color: T.textMuted, marginTop: "2px" }}>{doctorSpeciality || "—"}</p>
          </div>

          {/* nav */}
          <nav className="da-sidebar-scroll" style={{ flex: 1, overflowY: "auto", padding: "0.75rem 0" }}>
            <span style={{ fontSize: "0.58rem", textTransform: "uppercase", letterSpacing: "0.15em", color: T.textMuted, padding: "0.5rem 1.25rem", display: "block" }}>Settings</span>
            {navItems.map((item, i) => (
              <button key={i} className={`da-nav-btn${item.active ? " da-active" : ""}`}
                onClick={item.onClick}
                style={{
                  width: "100%", background: "transparent", border: "none",
                  textAlign: "left", padding: "0.55rem 1.25rem",
                  fontSize: "0.78rem", fontWeight: item.active ? 400 : 300,
                  color: item.active ? T.text : T.textSec,
                  cursor: "pointer", display: "flex", alignItems: "flex-start", gap: "10px",
                  fontFamily: T.font, transition: "all 0.15s", lineHeight: 1.4,
                  borderLeft: item.active ? `2px solid ${T.borderStr}` : "2px solid transparent",
                }}>
                <span style={{ flexShrink: 0, marginTop: "2px" }}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            ))}
          </nav>

          {/* logout */}
          <div style={{ padding: "1rem 1.25rem", borderTop: `1px solid ${T.border}`, flexShrink: 0 }}>
            <button className="da-btn-outline" style={{ ...S.btnOutline, width: "100%", justifyContent: "center" }} onClick={handleLogout}>
              <LogOut size={13} /> Logout
            </button>
          </div>
        </aside>

        {/* ══════════ MAIN ══════════ */}
        <main style={{ marginLeft: SIDEBAR_W, flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>

          {/* top bar */}
          <div style={{
            position: "sticky", top: 0, zIndex: 50,
            background: T.bg, borderBottom: `1px solid ${T.border}`,
            padding: "0.875rem 2rem",
            display: "flex", justifyContent: "space-between", alignItems: "center",
          }}>
            <div>
              <span style={S.secLabel}>Clinical Configuration</span>
              <h1 style={{ fontSize: "1rem", fontWeight: 400, letterSpacing: "-0.01em", color: T.text, margin: 0 }}>
                Medical Current Context Instructions
              </h1>
            </div>
            <button className="da-btn-primary" style={S.btnPrimary}
              onClick={() => navigate(`/register-patient?doctor_id=${doctorId}`)}>
              <UserPlus size={13} /> Register Patient →
            </button>
          </div>

          {/* body */}
          <div style={{ padding: "1.5rem 2rem", flex: 1 }}>

            {/* specialty + stat strip */}
            <div style={{ border: `1px solid ${T.border}`, background: T.bgAlt, padding: "1rem 1.25rem", marginBottom: "1.5rem", display: "flex", gap: "1px", flexWrap: "wrap" }}>
              {[
                { label: "Specialty",          val: doctorSpeciality || "Not Set" },
                { label: "Medical Categories", val: formData.medicalOutputCategories.length },
                { label: "Current Categories", val: formData.currentOutputCategories.length },
                { label: "Status",             val: formData.isActive ? "Active" : "Inactive" },
              ].map(({ label, val }) => (
                <div key={label} style={{ background: T.bg, padding: "0.875rem 1.25rem", flex: "1 1 140px", minWidth: 130 }}>
                  <span style={S.secLabel}>{label}</span>
                  <p style={{ fontSize: "0.95rem", fontWeight: 400, color: T.text, margin: 0 }}>{val}</p>
                </div>
              ))}
            </div>

            {/* tab bar */}
            <div style={{ display: "flex", borderBottom: `1px solid ${T.border}`, marginBottom: "1.5rem" }}>
              {[
                { key: "medical",  label: "Medical Context",  Icon: Brain  },
                { key: "current",  label: "Current Context",  Icon: Target },
              ].map(({ key, label, Icon }) => (
                <button key={key} className="da-tab-btn"
                  onClick={() => setActiveTab(key)}
                  style={{
                    padding: "0.75rem 1.25rem",
                    background: activeTab === key ? T.bg : T.bgAlt,
                    border: "none",
                    borderBottom: activeTab === key ? `2px solid ${T.borderStr}` : "2px solid transparent",
                    fontSize: "0.78rem", fontWeight: activeTab === key ? 400 : 300,
                    color: activeTab === key ? T.text : T.textMuted,
                    display: "inline-flex", alignItems: "center", gap: "6px",
                    fontFamily: T.font, cursor: "pointer", marginBottom: "-1px",
                  }}>
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            {/* form */}
            <form onSubmit={handleSubmit}>

              {activeTab === "medical" && renderCategorySection("medical")}
              {activeTab === "current" && renderCategorySection("current")}

              {/* action bar */}
              <div style={{ border: `1px solid ${T.border}`, background: T.bgAlt, padding: "1rem 1.25rem", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "0.875rem" }}>

                {/* left: toggle + counts */}
                <div style={{ display: "flex", alignItems: "center", gap: "1.5rem", flexWrap: "wrap" }}>

                  {/* status toggle */}
                  <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
                    <span style={{ fontSize: "0.75rem", color: T.textSec, fontWeight: 300 }}>Rule Status:</span>
                    <div style={{ position: "relative", width: 44, height: 24, cursor: "pointer" }} onClick={() => setFormData(p => ({ ...p, isActive: !p.isActive }))}>
                      <div style={{
                        position: "absolute", inset: 0,
                        background: formData.isActive ? T.text : T.border,
                        transition: "background 0.2s",
                      }} />
                      <div style={{
                        position: "absolute", width: 18, height: 18, top: 3,
                        left: formData.isActive ? 23 : 3,
                        background: T.bg, transition: "left 0.2s",
                      }} />
                    </div>
                    <span style={{ fontSize: "0.7rem", textTransform: "uppercase", letterSpacing: "0.1em", color: T.textMuted }}>
                      {formData.isActive ? "Active" : "Inactive"}
                    </span>
                  </div>

                  {/* counts */}
                  <div style={{ display: "flex", gap: "1.25rem", paddingLeft: "1.25rem", borderLeft: `1px solid ${T.border}` }}>
                    {[
                      { label: "Medical", val: formData.medicalOutputCategories.length },
                      { label: "Current", val: formData.currentOutputCategories.length },
                    ].map(({ label, val }) => (
                      <div key={label} style={{ textAlign: "center" }}>
                        <p style={{ fontSize: "0.6rem", color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 2px" }}>{label}</p>
                        <p style={{ fontSize: "1.1rem", fontWeight: 300, letterSpacing: "-0.03em", color: T.text, margin: 0 }}>{val}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* right: nav buttons */}
                <div style={{ display: "flex", gap: "0.625rem" }}>
                  {activeTab === "current" && (
                    <button type="button" className="da-btn-outline" style={S.btnOutline}
                      onClick={() => setActiveTab("medical")}>
                      ← Back
                    </button>
                  )}
                  {activeTab === "medical" && (
                    <button type="button" className="da-btn-primary" style={S.btnPrimary}
                      onClick={() => setActiveTab("current")}>
                      Next →
                    </button>
                  )}
                  {activeTab === "current" && (
                    <button type="submit" className="da-btn-primary" style={S.btnPrimary}>
                      <CheckCircle size={13} /> Save Configuration
                    </button>
                  )}
                </div>
              </div>

            </form>
          </div>
        </main>
      </div>
    </>
  );
};

export default MedicalCurrentContextRule;