  import React, { useState, useEffect, useRef } from 'react';
  import { GoogleMap, Marker, InfoWindow, useLoadScript } from "@react-google-maps/api";
  import ambulanceIcon from "../assets/ambulance.png";
  import { useLocation } from "react-router-dom";
  import {  useNavigate } from "react-router-dom";
  import {
    Bell, Activity, Heart, Thermometer,
    Wind, Droplet, Clock, MapPin,
    X, RefreshCw
  } from 'lucide-react';

  /* ─── THEME TOKENS ─── */
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
    green: "#10b981",
  };

  const SIDEBAR_WIDTH = "260px";
  const API_BASE_URL = import.meta.env.VITE_BACKEND_URL || "https://doctorassist.ai/api";
  /* ─── STATIC VITALS PROFILES (one per ambulance slot, cycles if more ambulances) ─── */
  const STATIC_VITALS = [
    {
      hr: "---", spo2: "---", bp: "---", rr: "---", temp: "---", glucose: "---",
      hrTrend: "", spo2Trend: "", bpTrend: "",
      rrTrend: "", tempTrend: "", glucoseTrend: "",
      hrUp: true, spo2Up: false, bpUp: true, rrUp: true, tempUp: null, glucoseUp: true,
      riskScore: 88,
      hospitals: [
        { rank: 1, name: "Narayana Health — Hyderabad", meta: "Cath Lab Ready · ICU: 3 beds · 5G", eta: "4m", ins: "Covered" },
        { rank: 2, name: "KIMS Hospital", meta: "Cardiology ready · ICU: 1 bed", eta: "7m", ins: "Covered" },
        { rank: 3, name: "Apollo Hospitals", meta: "Cardio dept. occupied", eta: "11m", ins: "Partial" },
      ],
      aiDecision: "Cath lab at Narayana Health pre-activated. AMB-047 rerouted via Tank Bund Road — saves 2m 20s. Aspirin & Heparin protocol initiated. Records sent to Dr. Venugopal.",
    },
    {
      hr: "--", spo2: "--", bp: "--", rr: "--", temp: "---", glucose: "---",
      hrTrend: "↓ Bradycardia", spo2Trend: "↓ Critical", bpTrend: "↓ Low",
      rrTrend: "↑ Tachypnea", tempTrend: "↓ Hypothermia", glucoseTrend: "↓ Low",
      hrUp: false, spo2Up: false, bpUp: false, rrUp: true, tempUp: false, glucoseUp: false,
      riskScore: 97,
      hospitals: [
        { rank: 1, name: "Apollo Hospitals", meta: "Trauma Bay Ready · ICU: 5 beds", eta: "3m", ins: "Covered" },
        { rank: 2, name: "Narayana Health", meta: "Cardio ICU available · 5G", eta: "6m", ins: "Covered" },
        { rank: 3, name: "Yashoda Hospital", meta: "ICU: 2 beds", eta: "9m", ins: "Partial" },
      ],
      aiDecision: "Cardiac Arrest protocol active. CPR guidance pushed to EMT. Defib standby ordered. ACLS protocol streaming via 5G. AED data captured and relayed.",
    },
    {
      hr: 95, spo2: 99, bp: 178, rr: 18, temp: "38.2", glucose: 140,
      hrTrend: "↑ Elevated", spo2Trend: "→ Normal", bpTrend: "↑ Hypertensive",
      rrTrend: "→ Normal", tempTrend: "↑ Low Fever", glucoseTrend: "↑ Borderline",
      hrUp: true, spo2Up: null, bpUp: true, rrUp: null, tempUp: true, glucoseUp: true,
      riskScore: 73,
      hospitals: [
        { rank: 1, name: "Osmania General Hospital", meta: "OB Ward Pre-alerted · ICU: 2 beds", eta: "5m", ins: "Covered" },
        { rank: 2, name: "KIMS Hospital", meta: "OB specialist on standby", eta: "8m", ins: "Covered" },
        { rank: 3, name: "Gandhi Hospital", meta: "Limited OB capacity", eta: "12m", ins: "Not Covered" },
      ],
      aiDecision: "Eclampsia: MgSO4 protocol auto-initiated. OB specialist Dr. Kavitha connected. Osmania Hospital OB ward pre-alerted. BP monitoring every 2 min.",
    },
    {
      hr: 130, spo2: 91, bp: 85, rr: 32, temp: "35.8", glucose: 52,
      hrTrend: "↑ Tachycardia", spo2Trend: "↓ Low", bpTrend: "↓ Shock",
      rrTrend: "↑ Severe", tempTrend: "↓ Hypothermia", glucoseTrend: "↓ Hypoglycemia",
      hrUp: true, spo2Up: false, bpUp: false, rrUp: true, tempUp: false, glucoseUp: false,
      riskScore: 95,
      hospitals: [
        { rank: 1, name: "KIMS Hospital", meta: "Trauma Bay 2 Ready · O-neg blood pre-ordered", eta: "4m", ins: "Covered" },
        { rank: 2, name: "Apollo Hospitals", meta: "Trauma surgeon on call", eta: "7m", ins: "Covered" },
        { rank: 3, name: "Narayana Health", meta: "CT scanner reserved", eta: "10m", ins: "Partial" },
      ],
      aiDecision: "Polytrauma: O-negative blood pre-ordered at KIMS. Trauma bay 2 allocated. CT scanner reserved. Paperless intake transmitted. Glucose correction in progress.",
    },
    {
      hr: 76, spo2: 98, bp: 125, rr: 16, temp: "37.0", glucose: 108,
      hrTrend: "→ Normal", spo2Trend: "→ Normal", bpTrend: "→ Normal",
      rrTrend: "→ Normal", tempTrend: "→ Normal", glucoseTrend: "→ Normal",
      hrUp: null, spo2Up: null, bpUp: null, rrUp: null, tempUp: null, glucoseUp: null,
      riskScore: 22,
      hospitals: [
        { rank: 1, name: "Gandhi Hospital", meta: "General ward available", eta: "6m", ins: "Covered" },
        { rank: 2, name: "Niloufer Hospital", meta: "OPD ready", eta: "9m", ins: "Covered" },
        { rank: 3, name: "NIMS Hospital", meta: "Specialist consult available", eta: "13m", ins: "Partial" },
      ],
      aiDecision: "Vitals within normal range. Routine transfer protocol. Patient stable — no emergency pre-activation required. Records transmitted to receiving ward.",
    },
    {
      hr: 102, spo2: 93, bp: 148, rr: 24, temp: "39.1", glucose: 185,
      hrTrend: "↑ Elevated", spo2Trend: "↓ Borderline", bpTrend: "↑ High",
      rrTrend: "↑ Tachypnea", tempTrend: "↑ Fever", glucoseTrend: "↑ High",
      hrUp: true, spo2Up: false, bpUp: true, rrUp: true, tempUp: true, glucoseUp: true,
      riskScore: 81,
      hospitals: [
        { rank: 1, name: "Yashoda Hospital", meta: "Diabetic ICU · Endocrine on call", eta: "5m", ins: "Covered" },
        { rank: 2, name: "Apollo Hospitals", meta: "Endocrinology available", eta: "8m", ins: "Covered" },
        { rank: 3, name: "KIMS Hospital", meta: "General ICU: 1 bed", eta: "11m", ins: "Not Covered" },
      ],
      aiDecision: "Diabetic emergency: Insulin protocol auto-initiated. Endocrinologist Dr. Reddy notified. Yashoda Diabetic ICU pre-alerted. IV saline commenced by EMT.",
    },
    {
      hr: 88, spo2: 96, bp: 135, rr: 19, temp: "37.8", glucose: 165,
      hrTrend: "→ Normal", spo2Trend: "→ Normal", bpTrend: "↑ Borderline",
      rrTrend: "→ Normal", tempTrend: "↑ Mild Fever", glucoseTrend: "↑ Elevated",
      hrUp: null, spo2Up: null, bpUp: true, rrUp: null, tempUp: true, glucoseUp: true,
      riskScore: 45,
      hospitals: [
        { rank: 1, name: "NIMS Hospital", meta: "General ward ready", eta: "7m", ins: "Covered" },
        { rank: 2, name: "Gandhi Hospital", meta: "Physician on call", eta: "10m", ins: "Covered" },
        { rank: 3, name: "Osmania General", meta: "Ward available", eta: "14m", ins: "Partial" },
      ],
      aiDecision: "Moderate risk: Vitals monitored. Mild hypertension and fever detected. Oral hydration recommended. Physician pre-alerted at NIMS. No emergency protocol triggered.",
    },
    {
      hr: 145, spo2: 86, bp: 70, rr: 36, temp: "34.9", glucose: 42,
      hrTrend: "↑ Severe Tachy", spo2Trend: "↓ Critical", bpTrend: "↓ Severe Shock",
      rrTrend: "↑ Critical", tempTrend: "↓ Severe Hypo", glucoseTrend: "↓ Severe Hypo",
      hrUp: true, spo2Up: false, bpUp: false, rrUp: true, tempUp: false, glucoseUp: false,
      riskScore: 99,
      hospitals: [
        { rank: 1, name: "Apollo Hospitals", meta: "ECMO standby · ICU: 4 beds · 5G", eta: "3m", ins: "Covered" },
        { rank: 2, name: "Narayana Health", meta: "Cardiac ICU: 2 beds", eta: "5m", ins: "Covered" },
        { rank: 3, name: "KIMS Hospital", meta: "Trauma ICU available", eta: "8m", ins: "Partial" },
      ],
      aiDecision: "CRITICAL: Multi-organ failure risk. ECMO team on standby at Apollo. All available protocols active. O-neg blood + plasma en route. Specialist patch active via 5G.",
    },
  ];

  /* ─── INLINE STYLES ─── */
  const S = {
    layout: {
      display: "flex",
      flexDirection: "column",
      height: "100vh",
      background: T.bg,
      fontFamily: "'Open Sans', sans-serif",
      fontWeight: 300,
      WebkitFontSmoothing: "antialiased",
      color: T.text,
      overflow: "hidden",
    },  modalOverlay: {
      position: "fixed",
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: "rgba(0,0,0,0.8)",
      zIndex: 1000,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
    },
    modalContainer: {
      background: T.bg,
      width: "90%",
      maxWidth: "700px",
      maxHeight: "85vh",
      borderRadius: "0px",
      border: `1px solid ${T.border}`,
      display: "flex",
      flexDirection: "column",
      overflow: "hidden",
    },
    modalHeader: {
      padding: "1rem 1.5rem",
      borderBottom: `1px solid ${T.border}`,
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      background: T.bgAlt,
    },
    modalTitle: {
      fontSize: "0.75rem",
      fontWeight: 400,
      letterSpacing: "0.15em",
      textTransform: "uppercase",
      color: T.text,
    },
    modalClose: {
      cursor: "pointer",
      fontSize: "1.2rem",
      color: T.textMuted,
      border: "none",
      background: "none",
    },
    modalBody: {
      flex: 1,
      overflowY: "auto",
      padding: "1.5rem",
    },
    modalFooter: {
      padding: "1rem 1.5rem",
      borderTop: `1px solid ${T.border}`,
      display: "flex",
      justifyContent: "space-between",
      gap: "10px",
    },
    modalButton: {
      padding: "8px 16px",
      background: T.text,
      color: T.bg,
      border: "none",
      fontSize: "0.7rem",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      cursor: "pointer",
      fontWeight: 400,
    },
    modalButtonSecondary: {
      padding: "8px 16px",
      background: T.bg,
      color: T.text,
      border: `1px solid ${T.border}`,
      fontSize: "0.7rem",
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      cursor: "pointer",
      fontWeight: 400,
    },
    formSection: {
      marginBottom: "1.5rem",
    },
    formSectionTitle: {
      fontSize: "0.7rem",
      fontWeight: 400,
      letterSpacing: "0.12em",
      textTransform: "uppercase",
      color: T.text,
      marginBottom: "1rem",
      paddingBottom: "0.5rem",
      borderBottom: `1px solid ${T.border}`,
    },
    formRow: {
      marginBottom: "1rem",
    },
    formLabel: {
      display: "block",
      fontSize: "0.65rem",
      color: T.textSec,
      marginBottom: "4px",
      letterSpacing: "0.05em",
    },
    formInput: {
      width: "100%",
      padding: "8px 10px",
      border: `1px solid ${T.border}`,
      background: T.bg,
      fontSize: "0.7rem",
      color: T.text,
      outline: "none",
    },
    formSelect: {
      width: "100%",
      padding: "8px 10px",
      border: `1px solid ${T.border}`,
      background: T.bg,
      fontSize: "0.7rem",
      color: T.text,
    },
    formTextarea: {
      width: "100%",
      padding: "8px 10px",
      border: `1px solid ${T.border}`,
      background: T.bg,
      fontSize: "0.7rem",
      color: T.text,
      minHeight: "60px",
    },
    stepIndicator: {
      display: "flex",
      justifyContent: "center",
      gap: "20px",
      marginBottom: "1.5rem",
      padding: "0 1rem",
    },
    stepDot: {
      width: "30px",
      height: "30px",
      borderRadius: "50%",
      border: `1px solid ${T.border}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: "0.7rem",
      color: T.textMuted,
    },
    stepDotActive: {
      borderColor: T.text,
      color: T.text,
      background: T.bgAlt,
    },
    stepDotCompleted: {
      background: T.text,
      color: T.bg,
      borderColor: T.text,
    },
    stepLabel: {
      fontSize: "0.55rem",
      color: T.textMuted,
      textAlign: "center",
      marginTop: "4px",
      letterSpacing: "0.05em",
    },
    stepWrapper: {
      textAlign: "center",
    },
    topbar: {
      height: "52px",
      background: T.bg,
      borderBottom: `1px solid ${T.border}`,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 2rem",
      flexShrink: 0,
      position: "relative",
      zIndex: 100,
    },
    topbarLeft: { display: "flex", alignItems: "center", gap: "20px" },
    brandName: {
      fontWeight: 400,
      fontSize: "0.9rem",
      letterSpacing: "-0.01em",
      color: T.text,
      margin: 0,
    },
    govBadge: {
      padding: "2px 8px",
      border: `1px solid ${T.border}`,
      fontSize: "0.58rem",
      letterSpacing: "0.15em",
      color: T.textMuted,
      fontWeight: 400,
      textTransform: "uppercase",
    },
    topbarCenter: {
      position: "absolute",
      left: "50%",
      transform: "translateX(-50%)",
      textAlign: "center",
    },
    topbarTitle: {
      fontSize: "0.75rem",
      fontWeight: 400,
      color: T.text,
      letterSpacing: "0.05em",
      textTransform: "uppercase",
      margin: 0,
    },
    topbarSub: {
      fontSize: "0.6rem",
      color: T.textMuted,
      letterSpacing: "0.1em",
      textTransform: "uppercase",
      marginTop: "1px",
    },
    topbarRight: { display: "flex", alignItems: "center", gap: "16px" },
    tbStat: { textAlign: "center" },
    tbStatVal: { fontSize: "1rem", fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1 },
    tbStatLbl: { fontSize: "0.55rem", letterSpacing: "0.12em", color: T.textMuted, textTransform: "uppercase", marginTop: "1px" },
    tbSep: { width: "1px", height: "24px", background: T.border },
    clock: { fontSize: "0.82rem", fontWeight: 400, letterSpacing: "0.05em", color: T.text },
    date: { fontSize: "0.6rem", color: T.textMuted, letterSpacing: "0.05em", textAlign: "right" },
    alertBell: { position: "relative", cursor: "pointer", padding: "6px", display: "flex", alignItems: "center" },
    alertCount: {
      position: "absolute", top: "2px", right: "2px",
      background: T.text, borderRadius: "50%",
      width: "13px", height: "13px",
      fontSize: "0.5rem", fontWeight: 400,
      display: "flex", alignItems: "center", justifyContent: "center",
      color: T.bg,
    },
    main: {
      flex: 1,
      display: "grid",
  gridTemplateColumns: `${SIDEBAR_WIDTH} 1fr`,
      overflow: "hidden",
    },
    leftPanel: {
      background: T.bg,
      borderRight: `1px solid ${T.border}`,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
    },
    panelSection: {
      padding: "1rem 1.25rem",
      borderBottom: `1px solid ${T.border}`,
    },
    panelLabel: {
      fontSize: "0.58rem",
      letterSpacing: "0.2em",
      color: T.textMuted,
      marginBottom: "0.75rem",
      fontWeight: 400,
      textTransform: "uppercase",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    },
    panelLabelBadge: {
      fontSize: "0.55rem",
      padding: "1px 6px",
      border: `1px solid ${T.border}`,
      color: T.textMuted,
      fontWeight: 400,
      letterSpacing: "0.1em",
    },
    agentList: { display: "flex", flexDirection: "column", gap: "4px" },
    agentItem: {
      padding: "0.55rem 0.75rem",
      border: `1px solid ${T.border}`,
      background: T.bgAlt,
      display: "flex",
      alignItems: "center",
      gap: "8px",
      cursor: "pointer",
      transition: "background 0.15s",
    },
    agentDot: { width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0 },
    agentInfo: { flex: 1 },
    agentName: { fontSize: "0.68rem", fontWeight: 400, color: T.text, letterSpacing: "0.02em" },
    agentTask: { fontSize: "0.62rem", color: T.textMuted, marginTop: "1px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "140px" },
    agentLoad: { fontSize: "0.65rem", color: T.textSec, fontWeight: 400 },
    ambList: { display: "flex", flexDirection: "column", gap: "4px" },
    ambCard: {
      padding: "0.75rem 0.85rem",
      border: `1px solid ${T.border}`,
      background: T.bg,
      cursor: "pointer",
      transition: "background 0.15s",
      position: "relative",
      overflow: "hidden",
      borderLeft: `2px solid ${T.border}`,
      marginBottom: "6px",
    },
    ambCardActive: {
      background: T.bgAlt,
      borderColor: T.text,
      borderLeft: `2px solid ${T.text}`,
    },
    criticalBorder: { borderLeft: `2px solid ${T.text}` },
    enrouteBorder: { borderLeft: `2px solid ${T.textSec}` },
    stableBorder: { borderLeft: `2px solid ${T.textMuted}` },
    standbyBorder: { borderLeft: `2px solid ${T.border}` },
    ambHeader: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "3px" },
    ambId: { fontSize: "0.8rem", fontWeight: 400, color: T.text, letterSpacing: "0.02em" },
    ambCondition: { fontSize: "0.68rem", color: T.textSec, marginBottom: "3px" },
    ambDetail: { fontSize: "0.62rem", color: T.textMuted, display: "flex", justifyContent: "space-between", alignItems: "center" },
    statusTag: {
      padding: "1px 5px",
      fontSize: "0.55rem",
      fontWeight: 400,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      border: `1px solid ${T.border}`,
    },
    badge: {
      padding: "0.2rem 0.5rem",
      fontSize: "0.6rem",
      fontWeight: 400,
      textTransform: "uppercase",
      letterSpacing: "0.08em",
      border: `1px solid ${T.border}`,
      display: "inline-block",
      color: T.textSec,
    },
    centerPanel: { display: "flex", flexDirection: "column", overflow: "hidden" },
    mapArea: { flex: 1, position: "relative", background: T.bgTert, overflow: "hidden", borderBottom: `1px solid ${T.border}` },
    mapCanvas: { width: "100%", height: "100%", display: "block" },
    mapControls: {
      position: "absolute", top: "12px", left: "12px",
      display: "flex", flexDirection: "column", gap: "4px",
    },
    mapBtn: {
      width: "28px", height: "28px",
      background: T.bg,
      border: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", justifyContent: "center",
      cursor: "pointer",
      color: T.text,
      fontSize: "0.72rem",
      fontWeight: 400,
      fontFamily: "'Open Sans', sans-serif",
      transition: "background 0.15s",
    },
    mapStatsBar: {
      position: "absolute", top: "12px", right: "12px",
      display: "flex", flexDirection: "column", gap: "4px",
    },
    mapStatPill: {
      background: "rgba(255,255,255,0.95)",
      border: `1px solid ${T.border}`,
      padding: "6px 10px",
      display: "flex", alignItems: "center", gap: "8px",
      minWidth: "130px",
    },
    mspDot: { width: "6px", height: "6px", borderRadius: "50%", flexShrink: 0, background: T.text },
    mspVal: { fontSize: "0.9rem", fontWeight: 400, letterSpacing: "-0.02em", lineHeight: 1, color: T.text },
    mspLbl: { fontSize: "0.58rem", color: T.textMuted, letterSpacing: "0.08em", textTransform: "uppercase" },
    mapLegend: {
      position: "absolute", bottom: "12px", left: "12px",
      background: "rgba(255,255,255,0.95)",
      border: `1px solid ${T.border}`,
      padding: "8px 12px",
    },
    legendItem: {
      display: "flex", alignItems: "center", gap: "7px",
      fontSize: "0.62rem", color: T.textMuted,
      marginBottom: "4px",
      textTransform: "uppercase", letterSpacing: "0.05em",
    },
    legendDot: { width: "7px", height: "7px", borderRadius: "50%", border: `1px solid ${T.border}` },
    bottomBar: {
    height: "0px",
      borderTop: `1px solid ${T.border}`,
      background: T.bg,
      display: "grid",
      gridTemplateColumns: "repeat(5, 1fr)",
      gap: "1px",
      flexShrink: 0,
      background: T.border,
    },
    bbCell: {
      background: T.bg,
      padding: "0.875rem 1rem",
      position: "relative",
      overflow: "hidden",
    },
    bbTitle: {
      fontSize: "0.58rem",
      letterSpacing: "0.15em",
      color: T.textMuted,
      marginBottom: "0.5rem",
      fontWeight: 400,
      textTransform: "uppercase",
    },
    vitalsSparklines: { display: "flex", flexDirection: "column", gap: "4px" },
    vsRow: { display: "flex", alignItems: "center", gap: "6px", fontSize: "0.65rem" },
    vsId: { fontSize: "0.65rem", fontWeight: 400, width: "40px", color: T.textSec },
    vsVal: { width: "32px", fontWeight: 400, fontSize: "0.72rem", color: T.text },
    vsBarWrap: { flex: 1, height: "2px", background: T.bgTert, overflow: "hidden" },
    vsBarFill: { height: "100%", background: T.text, transition: "width 1s ease" },
    chartBars: { display: "flex", alignItems: "flex-end", gap: "2px", height: "40px" },
    chartBar: { flex: 1, background: T.bgTert, borderRadius: "1px 1px 0 0", transition: "height 0.5s ease" },
    chartBarActive: { background: T.text },
    aiTodayItem: {
      display: "flex", justifyContent: "space-between",
      fontSize: "0.68rem", color: T.textSec,
      padding: "3px 0",
      borderBottom: `1px solid ${T.border}`,
    },
    rightPanel: {
      background: T.bg,
      borderLeft: `1px solid ${T.border}`,
      overflowY: "auto",
      display: "flex",
      flexDirection: "column",
    },
    patientHero: {
      padding: "1rem 1.25rem",
      borderBottom: `1px solid ${T.border}`,
      background: T.bgAlt,
    },
    patientName: { fontSize: "1rem", fontWeight: 400, color: T.text, letterSpacing: "-0.01em", marginBottom: "2px" },
    patientMeta: { fontSize: "0.68rem", color: T.textMuted, letterSpacing: "0.02em" },
    patientInsurance: { fontSize: "0.62rem", color: T.textMuted, marginTop: "6px" },
    patientRisk: { display: "flex", alignItems: "center", gap: "8px", marginTop: "10px" },
    riskLabel: { fontSize: "0.58rem", color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase" },
    riskBarWrap: { flex: 1, height: "3px", background: T.bgTert, overflow: "hidden" },
    riskBarFill: { height: "100%", background: T.text },
    riskScore: { fontSize: "0.82rem", fontWeight: 400, color: T.text },
    vitalsGrid: {
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: "1px",
      background: T.border,
      borderBottom: `1px solid ${T.border}`,
    },
    vitalBox: {
      background: T.bg,
      padding: "0.75rem 1rem",
      position: "relative",
    },
    vbLabel: { fontSize: "0.58rem", letterSpacing: "0.12em", color: T.textMuted, marginBottom: "3px", textTransform: "uppercase" },
    vbValue: { fontSize: "1.4rem", fontWeight: 300, letterSpacing: "-0.04em", lineHeight: 1, color: T.text },
    vbUnit: { fontSize: "0.62rem", color: T.textMuted },
    vbTrend: { fontSize: "0.62rem", marginTop: "2px", fontWeight: 400 },
    ecgContainer: {
      padding: "0.75rem 1.25rem",
      borderBottom: `1px solid ${T.border}`,
      background: T.bgAlt,
    },
    ecgLabel: { fontSize: "0.58rem", letterSpacing: "0.12em", color: T.textMuted, marginBottom: "6px", textTransform: "uppercase" },
    ecgSvg: { width: "100%", height: "40px" },
    hospList: { padding: "0.875rem 1.25rem", borderBottom: `1px solid ${T.border}` },
    hospItem: {
      display: "flex", alignItems: "center", gap: "10px",
      padding: "7px 0",
      borderBottom: `1px solid ${T.border}`,
    },
    hospRank: { fontSize: "0.9rem", fontWeight: 300, color: T.textMuted, width: "14px" },
    hospInfo: { flex: 1 },
    hospName: { fontSize: "0.72rem", fontWeight: 400, color: T.text },
    hospMeta: { fontSize: "0.62rem", color: T.textMuted, marginTop: "1px" },
    hospEta: { fontSize: "0.82rem", fontWeight: 400, color: T.text, textAlign: "right" },
    hospIns: { fontSize: "0.58rem", color: T.textMuted, textAlign: "right" },
    agentDecision: {
      margin: "0.875rem 1.25rem",
      padding: "0.75rem",
      background: T.bgAlt,
      border: `1px solid ${T.border}`,
      borderLeft: `2px solid ${T.text}`,
    },
    adLabel: {
      fontSize: "0.58rem", letterSpacing: "0.12em", color: T.textMuted,
      marginBottom: "4px", fontWeight: 400, textTransform: "uppercase",
      display: "flex", alignItems: "center", gap: "6px",
    },
    adAutoChip: {
      fontSize: "0.55rem", padding: "1px 6px",
      border: `1px solid ${T.border}`,
      color: T.textSec, fontWeight: 400, letterSpacing: "0.05em",
    },
    adText: { fontSize: "0.72rem", color: T.textSec, lineHeight: 1.6 },
    aiFeed: { padding: "0.875rem 1.25rem", flex: 1 },
    aifLabel: {
      fontSize: "0.58rem", letterSpacing: "0.15em", color: T.textMuted,
      marginBottom: "0.5rem", fontWeight: 400, textTransform: "uppercase",
      display: "flex", alignItems: "center", justifyContent: "space-between",
    },
    aifBadge: {
      fontSize: "0.55rem", padding: "1px 6px",
      border: `1px solid ${T.border}`,
      color: T.textMuted, fontWeight: 400,
    },
    aifEntry: {
      padding: "0.5rem 0.625rem",
      marginBottom: "4px",
      borderLeft: "2px solid",
      fontSize: "0.68rem",
      background: T.bgAlt,
      lineHeight: 1.5,
      color: T.textSec,
    },
    aifTime: { fontSize: "0.58rem", color: T.textMuted, marginBottom: "2px", letterSpacing: "0.05em" },
    notifDrawer: {
      position: "fixed", top: "52px", right: 0,
      width: "300px", height: "calc(100% - 52px)",
      background: T.bg,
      borderLeft: `1px solid ${T.border}`,
      zIndex: 150,
      transition: "transform 0.3s ease",
      overflowY: "auto",
    },
    ndHeader: {
      padding: "1rem 1.25rem",
      borderBottom: `1px solid ${T.border}`,
      display: "flex", alignItems: "center", justifyContent: "space-between",
      background: T.bgAlt,
      position: "sticky", top: 0, zIndex: 10,
    },
    ndTitle: { fontSize: "0.72rem", fontWeight: 400, color: T.text, textTransform: "uppercase", letterSpacing: "0.1em" },
    ndClose: { cursor: "pointer", color: T.textMuted, fontSize: "1.1rem", lineHeight: 1, background: "none", border: "none" },
    ndEntry: { padding: "0.875rem 1.25rem", borderBottom: `1px solid ${T.border}`, cursor: "pointer" },
    ndEntryType: { fontSize: "0.58rem", letterSpacing: "0.12em", fontWeight: 400, marginBottom: "3px", textTransform: "uppercase" },
    ndEntryMsg: { fontSize: "0.72rem", color: T.textSec, lineHeight: 1.5 },
    ndEntryTime: { fontSize: "0.6rem", color: T.textMuted, marginTop: "3px" },
    agentOverlay: {
      position: "absolute", inset: 0,
      background: "rgba(255,255,255,0.92)",
      zIndex: 200,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    },
    agentOverlayInner: { textAlign: "center", maxWidth: "360px", padding: "2rem" },
    aoSpinner: {
      width: "36px", height: "36px",
      border: `1px solid ${T.border}`,
      borderTopColor: T.text,
      borderRadius: "50%",
      animation: "spin 0.8s linear infinite",
      margin: "0 auto 1.25rem",
    },
    aoTitle: { fontSize: "0.82rem", fontWeight: 400, letterSpacing: "0.2em", textTransform: "uppercase", marginBottom: "6px", color: T.text },
    aoSub: { fontSize: "0.72rem", color: T.textMuted, marginBottom: "1.5rem", lineHeight: 1.7 },
    aoSteps: { display: "flex", flexDirection: "column", gap: "4px", textAlign: "left", width: "100%" },
    aoStep: {
      display: "flex", alignItems: "center", gap: "8px",
      fontSize: "0.68rem", color: T.textSec,
      padding: "5px 8px", border: `1px solid ${T.border}`, background: T.bgAlt,
    },
    aoStepDot: { width: "5px", height: "5px", borderRadius: "50%", background: T.text, flexShrink: 0 },
  };

  /* ─── STATUS HELPERS ─── */
  const getAmbBorderStyle = (status) => {
    if (status === "critical") return { borderLeft: `2px solid ${T.text}` };
    if (status === "enroute") return { borderLeft: `2px solid ${T.textSec}` };
    if (status === "stable") return { borderLeft: `2px solid ${T.textMuted}` };
    return { borderLeft: `2px solid ${T.border}` };
  };

  const getStatusTagStyle = (status) => {
    if (status === "critical") return { ...S.statusTag, borderColor: T.text, color: T.text };
    if (status === "enroute") return { ...S.statusTag, borderColor: T.textSec, color: T.textSec };
    if (status === "stable") return { ...S.statusTag, borderColor: T.textMuted, color: T.textMuted };
    return { ...S.statusTag, color: T.textMuted };
  };

  const getAiFeedStyle = (type) => {
    if (type === "crit") return { ...S.aifEntry, borderLeftColor: T.text };
    if (type === "warn") return { ...S.aifEntry, borderLeftColor: T.textSec };
    if (type === "info") return { ...S.aifEntry, borderLeftColor: T.textMuted };
    return { ...S.aifEntry, borderLeftColor: T.border };
  };
  // ✅ ADD THIS FUNCTION RIGHT HERE
  const calculateDistance = (lat1, lon1, lat2, lon2) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return null;
    
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    const distance = R * c;
    return distance.toFixed(1);
  };
  /* ─── STATIC DATA ─── */
const agents = [
  { name: "Dispatch Agent", task: "Optimising AMB-047 route", load: "87%" },
  { name: "Clinical Agent", task: "STEMI protocol — Pt. Rajan", load: "92%" },
  { name: "Routing Agent", task: "6 corridors active", load: "74%" },
  { name: "Insurance Agent", task: "3 verifications pending", load: "45%" },
  { name: "Memory Agent", task: "Loading 4 patient histories", load: "61%" },
  { name: "Comms Agent", task: "Specialist relay active", load: "33%" },
  { name: "5G Monitor Agent", task: "Streaming 8 vitals feeds", load: "99%" },
];


  // ↓↓↓ ADD THIS NEW CODE ↓↓↓
  const agentStepMap = {
  "Dispatch Agent": [
    "Parsing emergency call metadata",
    "Locating nearest available ambulance",
    "Calculating optimal route",
    "Optimising route",
    "Dispatching to location"
  ],
  "Clinical Agent": [
    "Analyzing patient vitals",
    "Running STEMI protocol assessment",
    "Checking drug interactions",
    "Preparing clinical recommendations",
    "STEMI protocol active"
  ],
  "Routing Agent": [
    "Analyzing traffic patterns",
    "Checking road closures",
    "Calculating fastest routes",
    "Active corridors: 6",
    "Routing complete"
  ],
  "Insurance Agent": [
    "Verifying insurance details",
    "Checking policy coverage",
    "Processing claim eligibility",
    "Insurance verified"
  ],
  "Memory Agent": [
    "Loading patient history",
    "Checking previous conditions",
    "Analyzing medication history",
    "Memory data loaded"
  ],
  "Comms Agent": [
    "Establishing communication link",
    "Notifying hospital staff",
    "Sending patient data",
    "Communication active"
  ],
  "5G Monitor Agent": [
    "Initializing 5G connection",
    "Streaming vital signs",
    "Monitoring data flow",
    "5G link stable"
  ]
};
  const aiActions = [
    { type: "auto", msg: "Route recalculated for AMB-047 → Tank Bund Road" },
    { type: "auto", msg: "Cath lab pre-activated — Narayana Health" },
    { type: "crit", msg: "SpO2 ↓ 88% — AMB-055 · Ventilation initiated" },
    { type: "auto", msg: "Insurance verified — Star Health · AMB-047" },
    { type: "warn", msg: "BP 178 — AMB-039 Eclampsia · OB alert sent" },
    { type: "auto", msg: "Patient memory loaded — 3 prior events · AMB-033" },
    { type: "info", msg: "5G vitals stream active — 8 ambulances online" },
    { type: "auto", msg: "ER bed pre-allocated — Narayana ICU Bay 3" },
    { type: "auto", msg: "Paperless intake auto-completed — AMB-019" },
    { type: "warn", msg: "Traffic delay — AMB-041 · Route updated +2m" },
    { type: "auto", msg: "Specialist relay — Dr. Reddy connected to AMB-055" },
    { type: "crit", msg: "Cardiac arrest protocol — AMB-055 · CPR guidance active" },
    { type: "auto", msg: "Green corridor req. — 4 signals cleared · AMB-047" },
    { type: "auto", msg: "Blood glucose alert — 218 mg/dL · Insulin protocol" },
  ];

  /* ─── MAIN COMPONENT ─── */
  function CustomerCarePatientProfile() {
    const [activePatient, setActivePatient] = useState(0);
    const [ambulanceDetails, setAmbulanceDetails] = useState({});
    const [heatMode, setHeatMode] = useState(false);
    const [ambulances, setAmbulances] = useState([]);
    const [activeMarker, setActiveMarker] = useState(null);
    const [notifOpen, setNotifOpen] = useState(false);
    const [agentOverlay, setAgentOverlay] = useState(false);
    const [mapTick, setMapTick] = useState(0);
    const [ecgT, setEcgT] = useState(0);
    const [feedIdx, setFeedIdx] = useState(0);
    const [currentTime, setCurrentTime] = useState(new Date());
    const [requestStatus, setRequestStatus] = useState({});
    const [showIntakeModal, setShowIntakeModal] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [agenticAnalysisData, setAgenticAnalysisData] = useState(null);      // ← ADD THIS
  const [agenticAnalysisLoaded, setAgenticAnalysisLoaded] = useState(false); // ← ADD THIS
      const [notifications, setNotifications] = useState([]);
    const [lastAgenticData, setLastAgenticData] = useState(null);

  const [currentAgent, setCurrentAgent] = useState(null);
  const [agentSteps, setAgentSteps] = useState([]);
  const location = useLocation();
  const navigate = useNavigate();
  const patient = location.state?.patient;
    // Convert agentic API response to notification format
  const extractNotificationsFromAgentic = (agenticData) => {
    if (!agenticData) return [];
    
    const notificationsList = [];
    const now = new Date();
    const timeStr = now.toLocaleTimeString("en-IN", { hour12: false });
    
    // 1. Triage alert based on severity (from root level)
    if (agenticData.triage_level === "RED") {
      notificationsList.push({
        type: "CRITICAL ALERT",
        msg: `TRIAGE RED: ${agenticData.emergency_type} emergency - ${agenticData.primary_action_now}`,
        time: timeStr,
        severity: "critical"
      });
    } else if (agenticData.triage_level === "ORANGE") {
      notificationsList.push({
        type: "URGENT ALERT",
        msg: `Triage ORANGE: ${agenticData.emergency_type} - ${agenticData.primary_action_now}`,
        time: timeStr,
        severity: "urgent"
      });
    }
    
    // 2. Clinical alerts from clinical_result.hospital_pre_alerts
    if (agenticData.clinical_result?.hospital_pre_alerts) {
      agenticData.clinical_result.hospital_pre_alerts.forEach(alert => {
        notificationsList.push({
          type: alert.alert?.toUpperCase() || "CLINICAL ALERT",
          msg: `${alert.specialist} needed - ${alert.preparation}`,
          time: timeStr,
          department: alert.department,
          severity: alert.urgency?.toLowerCase() || "immediate"
        });
      });
    }
    
    // 3. Protocol activation
    if (agenticData.clinical_result?.protocol_activated) {
      const protocol = agenticData.clinical_result.protocol_activated;
      notificationsList.push({
        type: "PROTOCOL ACTIVATED",
        msg: `${protocol.protocol_name} (${protocol.protocol_code}) - ${protocol.steps[0]?.action || 'Protocol initiated'}`,
        time: timeStr,
        severity: "critical"
      });
    }
    
    // 4. Most alarming vital
    if (agenticData.clinical_result?.most_alarming_vital) {
      const vital = agenticData.clinical_result.most_alarming_vital;
      notificationsList.push({
        type: "VITAL ALERT",
        msg: `${vital.vital}: ${vital.value} - ${vital.immediate_action}`,
        time: timeStr,
        severity: "critical"
      });
    }
    
    // 5. Insurance status (from root level hospital_dashboard_card)
    if (agenticData.hospital_dashboard_card?.insurance_badge) {
      const badge = agenticData.hospital_dashboard_card.insurance_badge;
      notificationsList.push({
        type: "INSURANCE STATUS",
        msg: badge === "✅ CASHLESS APPROVED" 
          ? "Cashless admission approved - Insurance verified successfully"
          : `Insurance: ${badge}`,
        time: timeStr,
        severity: "info"
      });
    }
    
    // 6. Memory/History alerts
    if (agenticData.memory_result?.chronic_condition_analysis?.length > 0) {
      agenticData.memory_result.chronic_condition_analysis.forEach(condition => {
        notificationsList.push({
          type: "MEDICAL HISTORY",
          msg: `${condition.condition} - ${condition.emergency_impact}`,
          time: timeStr,
          severity: "warning"
        });
      });
    }
    
    // 7. Blood group requirement
    if (agenticData.memory_result?.blood_group_management?.blood_products_likely_needed) {
      const bg = agenticData.memory_result.blood_group_management;
      notificationsList.push({
        type: "BLOOD BANK ALERT",
        msg: `Blood group ${bg.blood_group} - ${bg.blood_bank_instruction} (${bg.units_to_prepare})`,
        time: timeStr,
        severity: "urgent"
      });
    }
    
    // 8. Injury assessment from clinical_result
    if (agenticData.clinical_result?.injury_assessment) {
      agenticData.clinical_result.injury_assessment.forEach(injury => {
        if (injury.severity === "Severe" || injury.severity === "Critical") {
          notificationsList.push({
            type: "INJURY ALERT",
            msg: `${injury.injury}: ${injury.severity} - ${injury.immediate_action}`,
            time: timeStr,
            severity: injury.severity === "Critical" ? "critical" : "urgent"
          });
        }
      });
    }
    
    // 9. Neurological assessment
    if (agenticData.clinical_result?.neurological_assessment) {
      const neuro = agenticData.clinical_result.neurological_assessment;
      if (neuro.neuro_risk === "High" || neuro.neuro_risk === "Critical") {
        notificationsList.push({
          type: "NEUROLOGICAL ALERT",
          msg: `GCS ${neuro.gcs_total}/15 - ${neuro.gcs_interpretation}. ${neuro.immediate_neuro_action}`,
          time: timeStr,
          severity: "critical"
        });
      }
    }
    
    // 10. Dashboard alert from root level
    if (agenticData.hospital_dashboard_card?.clinical_alert) {
      notificationsList.push({
        type: "DASHBOARD ALERT",
        msg: agenticData.hospital_dashboard_card.clinical_alert,
        time: timeStr,
        severity: "urgent"
      });
    }
    
    // 11. Memory note from dashboard
    if (agenticData.hospital_dashboard_card?.memory_note) {
      notificationsList.push({
        type: "PATIENT NOTE",
        msg: agenticData.hospital_dashboard_card.memory_note,
        time: timeStr,
        severity: "info"
      });
    }
    
    // Limit to most recent 15 notifications
    return notificationsList.slice(0, 15);
  };
  // Fetch agentic data when patient is loaded

    const [intakeFormData, setIntakeFormData] = useState({
      heartRate: "", systolicBP: "", diastolicBP: "", spo2: "", respiratoryRate: "", temperature: "",
      consciousnessLevel: "", gcsEye: "", gcsVerbal: "", gcsMotor: "", pupilReaction: "",
      injuryType: "", externalBleeding: "", internalBleeding: "", fractureSuspected: "", burnInjury: "",
      chestPain: "", breathingDifficulty: "", lossOfConsciousness: "", seizures: "", vomiting: "", clinicalNotes: "",
      medicalConditions: "", chronicIllness: "", chronicIllnessDetails: "", currentMeds: "", medDosage: "",
      medFrequency: "", lastDoseTaken: "", drugAllergies: "", drugAllergiesDetails: "", foodAllergies: "",
      foodAllergiesDetails: "", otherAllergies: "", previousSurgeries: "", surgeryType: "", surgeryDate: "",
      bloodGroup: "", pregnancyStatus: "", familyHistory: "", idType: "", idNumber: "", insuranceAvailable: "",
      providerName: "", policyNumber: "", policyHolderName: "", relationshipToPatient: "", policyValid: "",
      emergencyCoverage: "", coverageLimit: "", cashlessFacility: "", preAuthRequired: "", preAuthStatus: "",
      insuranceContact: "", insuranceRemarks: "",
    });

  // ✅ PASTE THIS CODE RIGHT HERE ✅
  const ecgLineRef = useRef(null);

  const { isLoaded } = useLoadScript({
    googleMapsApiKey: "AIzaSyA3VwLT1IQxhUeGKxKstHw-dZ2uJ4Hta7w",
  });
  // ✅ END OF PASTED CODE ✅


  // ✅ GET INCIDENT LOCATION FROM location STRING
  const incidentLocation =
    patient?.accidentDetails?.location || "";

  const [incidentLat, incidentLng] =
    incidentLocation.split(",").map(coord => parseFloat(coord.trim()));


    /* ECG wave function */
    const ecgY = (t) => {
      const p = t % 80;
      if (p < 10) return 20;
      if (p === 12) return 16;
      if (p === 13) return 4;
      if (p === 14) return 36;
      if (p === 15) return 6;
      if (p === 16) return 14;
      if (p === 17) return 18;
      if (p < 30) return 20 + Math.sin(p * 0.3) * 1.5;
      return 20;
    };

    useEffect(() => {
      const clockInterval = setInterval(() => setCurrentTime(new Date()), 1000);
      const mapInterval = setInterval(() => setMapTick((t) => t + 1), 800);
      const ecgInterval = setInterval(() => setEcgT((t) => t + 1), 50);
      const feedInterval = setInterval(() => setFeedIdx((i) => (i + 1) % aiActions.length), 2400);
      return () => {
        clearInterval(clockInterval);
        clearInterval(mapInterval);
        clearInterval(ecgInterval);
        clearInterval(feedInterval);
      };
    }, []);

  useEffect(() => {
    const fetchAmbulances = async () => {
  try {
    const res = await fetch(
      "https://doctorassist.ai/api/hms/users/ambulance/active-with-location"
    );

    const data = await res.json();
    if (!data || !data.data) {
      console.log("Invalid API response", data);
      return;
    }
    console.log("ACTIVE AMBULANCES:", data);

    // Get incident location from patient
    const incidentLat = parseFloat(patient?.accidentDetails?.latitude);
    const incidentLng = parseFloat(patient?.accidentDetails?.longitude);

   const onlineAmbulances = (data.data || []).filter(a => a.is_online === true);

    // STEP 1: fetch accepted patients for every online ambulance driver (in parallel)
    const acceptedByDriver = await Promise.all(
      onlineAmbulances.map(async (a) => {
        try {
          const acceptCheckRes = await fetch(
            `https://doctorassist.ai/api/hms/users/ambulance/ambulance/get-accepted-patients/${a.driverId}`
          );
          const acceptData = await acceptCheckRes.json();
          const patients =
            acceptData.status === "success" && acceptData.patients
              ? acceptData.patients
              : [];
          return { driverId: a.driverId, patients };
        } catch (err) {
          console.log(`Error fetching accepted patients for driver ${a.driverId}:`, err);
          return { driverId: a.driverId, patients: [] };
        }
      })
    );

    // STEP 2: collect every unique patient_id across all drivers into one list
    const allPatientIds = Array.from(
      new Set(
        acceptedByDriver.flatMap((d) => d.patients.map((p) => p.patient_id))
      )
    );

    // STEP 3: single batched completed-status lookup — replaces the old
    // per-patient get-completed-incident/{id} loop entirely
    let completedStatusMap = {};
    if (allPatientIds.length > 0) {
      try {
        const batchRes = await fetch(
          "https://doctorassist.ai/api/hms/users/ambulance/ambulance/get-completed-incidents-batch",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ patient_ids: allPatientIds }),
          }
        );
        const batchData = await batchRes.json();
        if (batchData.status === "success" && batchData.statuses) {
          completedStatusMap = batchData.statuses;
        }
      } catch (err) {
        console.log("Batch completed-status check error:", err);
      }
    }

    // STEP 4: build the ambulance list from the batch results — no more
    // per-patient network calls here
    const ambulancesWithBusyCheck = onlineAmbulances.map((a) => {
      const driverAccepted = acceptedByDriver.find((d) => d.driverId === a.driverId);
      let isBusy = false;
      let busyWithPatient = null;

      if (driverAccepted) {
        for (const p of driverAccepted.patients) {
          const isCompleted = completedStatusMap[p.patient_id] === "completed";
          if (!isCompleted) {
            isBusy = true;
            busyWithPatient = p;
            console.log("🔴 BUSY AMBULANCE:", {
              ambulance: a.vehicleId,
              driver: a.driverName,
              patient: p.patient_id,
              patientName: p.patient_data?.fullName || p.patient_name
            });
            break;
          }
        }
      }

      let distanceKm = null;
      let etaMinutes = "5m";
      const ambLat = a.latitude || a.location?.coordinates?.[1];
      const ambLng = a.longitude || a.location?.coordinates?.[0];

      if (incidentLat != null && incidentLng != null && ambLat != null && ambLng != null) {
        distanceKm = calculateDistance(
          parseFloat(incidentLat),
          parseFloat(incidentLng),
          parseFloat(ambLat),
          parseFloat(ambLng)
        );
        if (distanceKm) {
          const etaMin = Math.round(parseFloat(distanceKm) / 30 * 60);
          etaMinutes = `${etaMin} min`;
        }
      }

      return {
        id: a.vehicleId,
        driverName: a.driverName,
        driverId: a.driverId,
        vehicleNumber: a.vehicleNumber,
        vehicleId: a.vehicleId,
        latitude: ambLat,
        longitude: ambLng,
        originalStatus: a.is_active ? "active" : "standby",
        status: a.is_active ? "active" : "standby",
        distanceKm: distanceKm !== null ? `${distanceKm} km` : "Location unavailable",
        eta: etaMinutes,
        location: "Live",
        isBusy: isBusy,
        busyWithPatientName: busyWithPatient?.patient_data?.fullName || busyWithPatient?.patient_name || "Unknown Patient",
        busyWithPatient: busyWithPatient
      };
    });

    setAmbulances(ambulancesWithBusyCheck);
  } catch (err) {
    console.log("Error:", err);
  }
};
    fetchAmbulances();
    const interval = setInterval(fetchAmbulances, 5000);
    return () => clearInterval(interval);
  }, [patient]); // ← IMPORTANT: Add patient as dependency

  useEffect(() => {
    if (ecgLineRef.current) {
      const pts = [];
      const y = 50; // fixed horizontal line position

      for (let x = 0; x < 260; x += 3) {
        pts.push(`${x},${y}`);
      }

      ecgLineRef.current.setAttribute("points", pts.join(" "));
    }
  }, [ecgT]);
    // Load existing agentic results from DATABASE when page loads
  useEffect(() => {
  const fetchExistingAgenticResults = async () => {
      if (!patient?.patient_id) return;
      
      try {
        console.log("🔍 Checking database for existing agentic results for patient:", patient.patient_id);
        
        const response = await fetch(
          `${API_BASE_URL}/hms/users/ai-legacy/patient-intake/analyze/latest/${patient.patient_id}`,
          {
            method: "GET",
            headers: {
              "Content-Type": "application/json"
            }
          }
        );
        
        const result = await response.json();
        
        if (response.ok && result.status === "success") {
          console.log("📦 Loaded existing agentic results from DATABASE:", result);
          
          // Set the agentic analysis data
          setAgenticAnalysisData(result);
          setAgenticAnalysisLoaded(true);
          
          // Extract notifications from the result
          const dynamicNotifications = extractNotificationsFromAgentic(result);
          setNotifications(dynamicNotifications);
          
          console.log("✅ Loaded", dynamicNotifications.length, "notifications from database");
        } else {
          console.log("📭 No existing agentic results found in database for this patient");
          console.log("Response:", result);
        }
      } catch (error) {
        console.error("❌ Failed to fetch existing agentic results from database:", error);
      }
    };
    
    fetchExistingAgenticResults();
  }, [patient?.patient_id]);
    // Add this useEffect to log when patient data changes
  useEffect(() => {
    console.log("🔄 CustomerCarePatientProfile mounted/updated");
    console.log("Current patient from location:", patient);
    
    if (!patient) {
      console.warn("⚠️ No patient data received! Check if navigation is passing the state correctly.");
    } else {
      console.log("✅ Patient data received successfully!");
      console.log("Patient details:", {
        id: patient.patient_id,
        name: patient.fullName,
        phone: patient.phoneNumber,
        accidentLocation: patient.accidentDetails?.location,
        latitude: patient.accidentDetails?.latitude,
        longitude: patient.accidentDetails?.longitude,
        accidentType: patient.accidentDetails?.accidentType,
        condition: patient.accidentDetails?.condition
      });
    }
  }, [patient]);

    const activeCount = ambulances.filter((a) => a.status !== "standby").length;
    const criticalCount = ambulances.filter((a) => a.status === "critical").length;
    const enrouteCount = ambulances.filter((a) => a.status === "enroute").length;

    const showAgentOverlay = () => {
      setAgentOverlay(true);
      setTimeout(() => setAgentOverlay(false), 5000);
    };

  const handleRequestSent = async (ambulance) => {
  try {
    if (!patient) {
      alert("No patient selected");
      return;
    }

    console.log("🚑 DISPATCHING AMBULANCE:");
    console.log("Patient:", patient);
    console.log("Ambulance:", ambulance);

    // Show agent overlay (your existing animation)
    showAgentOverlay();

    // Make API call to dispatch patient to this specific ambulance
    const payload = {
      patient_id: patient.patient_id || patient.id,
      driver_id: ambulance.driverId,
      driver_name: ambulance.driverName,
      ambulance_id: ambulance.vehicleId,
      ambulance_number: ambulance.vehicleNumber,
      assigned_at: new Date().toISOString(),
      status: "dispatched",
      patient_data: {
        fullName: patient.fullName || patient.patient_name,
        age: patient.age,
        gender: patient.gender,
        phoneNumber: patient.phoneNumber,
        accidentDetails: patient.accidentDetails,
        emergencyContact: patient.emergencyContact,
        address: patient.address
      }
    };

    console.log("📤 DISPATCH PAYLOAD:", payload);

    const res = await fetch(
      "https://doctorassist.ai/api/hms/users/ambulance/ambulance/dispatch-patient",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      }
    );

    const data = await res.json();

    if (res.ok) {
      setRequestStatus(prev => ({
        ...prev,
        [ambulance.id]: true
      }));
      
      console.log(`✅ Patient dispatched to ${ambulance.driverName} successfully`);
      alert(`Patient dispatched to ${ambulance.driverName} successfully!`);
      
    } else {
      alert(data.message || "Dispatch failed");
    }

  } catch (err) {
    console.error("❌ Error dispatching ambulance:", err);
    alert("Error dispatching ambulance: " + err.message);
  }
};
    const handleIntakeChange = (field, value) => {
      setIntakeFormData(prev => ({ ...prev, [field]: value }));
    };

    const handleNextStep = () => {
      setCurrentStep(prev => prev + 1);
    };

    const handlePrevStep = () => {
      setCurrentStep(prev => prev - 1);
    };

  const handleSubmitIntake = async () => {
    console.log("Submitting intake form:", intakeFormData);
    
    // Get patient_id from the patient object
    const patientId = patient?.patient_id || patient?.id;
    
    if (!patientId) {
      alert("Patient ID not found. Cannot save assessment.");
      console.error("No patient ID available:", patient);
      return;
    }
    
    // Prepare the data structure for API
    const payload = {
      patient_id: patientId,
      vitals: {
        heartRate: intakeFormData.heartRate,
        systolicBP: intakeFormData.systolicBP,
        diastolicBP: intakeFormData.diastolicBP,
        spo2: intakeFormData.spo2,
        respiratoryRate: intakeFormData.respiratoryRate,
        temperature: intakeFormData.temperature
      },
      neurological: {
        consciousnessLevel: intakeFormData.consciousnessLevel,
        gcsEye: intakeFormData.gcsEye,
        gcsVerbal: intakeFormData.gcsVerbal,
        gcsMotor: intakeFormData.gcsMotor,
        pupilReaction: intakeFormData.pupilReaction
      },
      injury: {
        injuryType: intakeFormData.injuryType,
        externalBleeding: intakeFormData.externalBleeding,
        internalBleeding: intakeFormData.internalBleeding,
        fractureSuspected: intakeFormData.fractureSuspected,
        burnInjury: intakeFormData.burnInjury
      },
      criticalSymptoms: {
        chestPain: intakeFormData.chestPain,
        breathingDifficulty: intakeFormData.breathingDifficulty,
        lossOfConsciousness: intakeFormData.lossOfConsciousness,
        seizures: intakeFormData.seizures,
        vomiting: intakeFormData.vomiting,
        clinicalNotes: intakeFormData.clinicalNotes
      },
      medicalBackground: {
        medicalConditions: intakeFormData.medicalConditions,
        chronicIllness: intakeFormData.chronicIllness,
        chronicIllnessDetails: intakeFormData.chronicIllnessDetails
      },
      medications: {
        currentMeds: intakeFormData.currentMeds,
        medDosage: intakeFormData.medDosage,
        medFrequency: intakeFormData.medFrequency,
        lastDoseTaken: intakeFormData.lastDoseTaken
      },
      allergies: {
        drugAllergies: intakeFormData.drugAllergies,
        drugAllergiesDetails: intakeFormData.drugAllergiesDetails,
        foodAllergies: intakeFormData.foodAllergies,
        foodAllergiesDetails: intakeFormData.foodAllergiesDetails,
        otherAllergies: intakeFormData.otherAllergies
      },
      surgicalHistory: {
        previousSurgeries: intakeFormData.previousSurgeries,
        surgeryType: intakeFormData.surgeryType,
        surgeryDate: intakeFormData.surgeryDate
      },
      additionalMedicalInfo: {
        bloodGroup: intakeFormData.bloodGroup,
        pregnancyStatus: intakeFormData.pregnancyStatus,
        familyHistory: intakeFormData.familyHistory
      },
      identification: {
        idType: intakeFormData.idType,
        idNumber: intakeFormData.idNumber
      },
      insuranceDetails: {
        insuranceAvailable: intakeFormData.insuranceAvailable,
        providerName: intakeFormData.providerName,
        policyNumber: intakeFormData.policyNumber,
        policyHolderName: intakeFormData.policyHolderName,
        relationshipToPatient: intakeFormData.relationshipToPatient
      },
      coverageDetails: {
        policyValid: intakeFormData.policyValid,
        emergencyCoverage: intakeFormData.emergencyCoverage,
        coverageLimit: intakeFormData.coverageLimit,
        cashlessFacility: intakeFormData.cashlessFacility
      },
      authorization: {
        preAuthRequired: intakeFormData.preAuthRequired,
        preAuthStatus: intakeFormData.preAuthStatus
      },
      contactNotes: {
        insuranceContact: intakeFormData.insuranceContact,
        insuranceRemarks: intakeFormData.insuranceRemarks
      },
      assessment_date: new Date().toISOString().split('T')[0],
      assessment_time: new Date().toLocaleTimeString()
    };
    
    try {
      const token = localStorage.getItem('access_token');
      const response = await fetch(`${API_BASE_URL}hms/users/data/context/patient-intake/save`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': token ? `Bearer ${token}` : ''
        },
        body: JSON.stringify(payload)
      });
      
      const result = await response.json();
      
      if (response.ok) {
        alert("Patient intake assessment saved successfully!");
        setShowIntakeModal(false);
        setCurrentStep(1);
        // Reset form data if needed
        setIntakeFormData({
          heartRate: "", systolicBP: "", diastolicBP: "", spo2: "", respiratoryRate: "", temperature: "",
          consciousnessLevel: "", gcsEye: "", gcsVerbal: "", gcsMotor: "", pupilReaction: "",
          injuryType: "", externalBleeding: "", internalBleeding: "", fractureSuspected: "", burnInjury: "",
          chestPain: "", breathingDifficulty: "", lossOfConsciousness: "", seizures: "", vomiting: "", clinicalNotes: "",
          medicalConditions: "", chronicIllness: "", chronicIllnessDetails: "", currentMeds: "", medDosage: "",
          medFrequency: "", lastDoseTaken: "", drugAllergies: "", drugAllergiesDetails: "", foodAllergies: "",
          foodAllergiesDetails: "", otherAllergies: "", previousSurgeries: "", surgeryType: "", surgeryDate: "",
          bloodGroup: "", pregnancyStatus: "", familyHistory: "", idType: "", idNumber: "", insuranceAvailable: "",
          providerName: "", policyNumber: "", policyHolderName: "", relationshipToPatient: "", policyValid: "",
          emergencyCoverage: "", coverageLimit: "", cashlessFacility: "", preAuthRequired: "", preAuthStatus: "",
          insuranceContact: "", insuranceRemarks: "",
        });
      } else {
        alert(result.detail || "Failed to save assessment");
      }
    } catch (error) {
      console.error("Error saving intake:", error);
      alert("Network error. Please try again.");
    }
  };
    /* ─── DERIVE ACTIVE AMBULANCE & ITS VITALS PROFILE ─── */
    const amb = ambulances[activePatient] || {};
    // Cycle through STATIC_VITALS so every ambulance gets a unique profile
    const vitals = STATIC_VITALS[activePatient % STATIC_VITALS.length];

    return (
      <div style={S.layout}>
        <style>{`
          @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
          * { box-sizing: border-box; }
          ::selection { background: #000; color: #fff; }
          @keyframes spin { to { transform: rotate(360deg); } }
          @keyframes tdot {
            0%,100% { opacity: 0.3; transform: translateY(0); }
            50% { opacity: 1; transform: translateY(-2px); }
          }
          .thinking-dots span { display: inline-block; animation: tdot 1.2s ease-in-out infinite; }
          .thinking-dots span:nth-child(2) { animation-delay: 0.2s; }
          .thinking-dots span:nth-child(3) { animation-delay: 0.4s; }
          .pp-amb-card:hover { background: #fafafa !important; }
          .pp-agent-item:hover { background: #f5f5f5 !important; }
          .pp-map-btn:hover { background: #fafafa !important; }
          .pp-notif-entry:hover { background: #fafafa !important; }
          ::-webkit-scrollbar { width: 3px; }
          ::-webkit-scrollbar-track { background: transparent; }
          ::-webkit-scrollbar-thumb { background: #e0e0e0; }
          .gm-style img[src*="ambulance"] {
    filter: brightness(0) saturate(100%) invert(12%) sepia(98%) saturate(5000%) hue-rotate(0deg) brightness(100%) contrast(120%);
  }
        `}</style>

      

        {/* ═══════════════ MAIN ═══════════════ */}
        <div style={S.main}>

          {/* ─── LEFT PANEL ─── */}
          <div style={S.leftPanel}>

            {/* Agent Network */}
            <div style={S.panelSection}>
              <div style={S.panelLabel}>
                Smart Hospital Routine agent
                <span style={S.panelLabelBadge}>Live</span>
              </div>
              <div style={S.agentList}>
                {agents && agents.length > 0 && agents.map((agent, idx) => (
  <div
    key={idx}
    className="pp-agent-item"
    style={S.agentItem}
  >
                    <div style={{ ...S.agentDot, background: T.text }} />
                    <div style={S.agentInfo}>
                      <div style={S.agentName}>{agent.name}</div>
                      <div style={S.agentTask}>
                        {agent.task}
                        <span className="thinking-dots"><span>.</span><span>.</span><span>.</span></span>
                      </div>
                    </div>
                    <div style={S.agentLoad}>{agent.load}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Fleet Status */}
            <div style={{ ...S.panelSection, flex: 1, borderBottom: "none" }}>
              <div style={S.panelLabel}>
                Fleet Status
                <span style={{ fontSize: "0.58rem", color: T.textMuted }}>{ambulances.length} units</span>
              </div>
              <div style={S.ambList}>
  {ambulances.length === 0 ? (
    <div style={{
      padding: "2rem 1rem",
      textAlign: "center",
      border: `1px solid ${T.border}`,
      background: T.bgAlt
    }}>
      <div style={{
        width: "24px",
        height: "24px",
        border: `2px solid ${T.border}`,
        borderTopColor: T.text,
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite",
        margin: "0 auto 10px auto"
      }} />
      <div style={{ fontSize: "0.7rem", color: T.textMuted, letterSpacing: "0.05em" }}>
        LOADING AMBULANCE...
      </div>
      <div style={{ fontSize: "0.6rem", color: T.textMuted, marginTop: "4px" }}>
        Please wait
      </div>
    </div>
  ) : (
    ambulances.map((a, idx) => (
      <div
        key={idx}
        className="pp-amb-card"
        style={{
          ...S.ambCard,
          ...getAmbBorderStyle(a.status),
          ...(idx === activePatient ? S.ambCardActive : {}),
        }}
        onClick={() => setActivePatient(idx)}
      >
        {/* Header */}
        <div style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: "8px",
          borderBottom: `1px solid ${T.border}`,
          paddingBottom: "4px"
        }}>
          <div style={{ fontSize: "0.75rem", fontWeight: 600, color: T.text, letterSpacing: "0.3px" }}>
            {a.vehicleNumber || "N/A"}
          </div>
          <div style={{ 
            display: "flex",
            gap: "6px",
            alignItems: "center"
          }}>
            {/* Original Status */}
            <div style={{ ...getStatusTagStyle(a.status), fontSize: "0.55rem", padding: "2px 6px" }}>
              {a.status.toUpperCase()}
            </div>
            
            {/* BUSY Badge - only shown if ambulance is busy */}
            {a.isBusy && (
              <div style={{ 
                fontSize: "0.55rem", 
                padding: "2px 6px",
                backgroundColor: "#dc2626",
                color: "#fff",
                border: "none",
                borderRadius: "3px",
                fontWeight: 500
              }}>
                BUSY
              </div>
            )}
          </div>
        </div>

        {/* Driver Name */}
        <div style={{ fontSize: "0.7rem", fontWeight: 500, color: T.textSec, marginBottom: "6px" }}>
          Ambulance Crew: {a.driverName || a.id}
        </div>

        {/* Vehicle ID | Driver ID */}
        <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "0.6rem", color: T.textMuted }}>
          <span>Vehicle ID: {a.vehicleId || "N/A"}</span>
          <span>Crew ID: {a.driverId || "N/A"}</span>
        </div>

        {/* Mobile */}
        <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "6px", display: "flex", alignItems: "center", gap: "5px" }}>
          <span>Mobile: {a.mobileNo || "N/A"}</span>
        </div>

        {/* Distance and ETA */}
        <div style={{ 
          display: "flex", 
          justifyContent: "space-between", 
          alignItems: "center",
          marginBottom: "8px",
          padding: "4px 0",
          borderTop: `1px solid ${T.border}`,
          borderBottom: `1px solid ${T.border}`
        }}>
          <span style={{ fontSize: "0.6rem", color: T.textMuted }}>DISTANCE</span>
          <span style={{ 
            fontWeight: 700, 
            fontSize: "0.85rem", 
            color: T.text,
            letterSpacing: "0.5px"
          }}>{a.distanceKm || "Calculating..."}</span>
        </div>

        {/* Dispatch Button */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (!a.isBusy) {
              handleRequestSent(a);
            } else {
              alert(`🚫 Ambulance ${a.vehicleNumber} is currently BUSY!\nAttending to patient: ${a.busyWithPatient?.patient_name || 'Unknown'}\nCannot dispatch another ambulance.`);
            }
          }}
          disabled={a.isBusy || requestStatus[a.id]}
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "6px 12px",
            backgroundColor: a.isBusy ? "#dc2626" : (requestStatus[a.id] ? "#4a4a4a" : T.text),
            color: T.bg,
            border: `1px solid ${T.borderStr}`,
            borderRadius: "3px",
            fontSize: "0.65rem",
            fontWeight: 500,
            cursor: (a.isBusy || requestStatus[a.id]) ? "not-allowed" : "pointer",
            opacity: (a.isBusy || requestStatus[a.id]) ? 0.6 : 1,
            transition: "all 0.2s ease",
          }}
          onMouseEnter={(e) => { 
            if (!a.isBusy && !requestStatus[a.id]) {
              e.target.style.backgroundColor = T.textSec;
            }
          }}
          onMouseLeave={(e) => { 
            if (!a.isBusy && !requestStatus[a.id]) {
              e.target.style.backgroundColor = T.text;
            }
          }}
        >
          {a.isBusy ? "🚫 BUSY" : (requestStatus[a.id] ? "✓ Request Sent" : "Dispatch Ambulance")}
        </button>
      </div>
    ))
  )}
</div>
            </div>
          </div>

          {/* ─── CENTER PANEL ─── */}
          <div style={S.centerPanel}>

            {/* Map */}
            <div style={S.mapArea}>
              <div style={{ width: "100%", height: "100%" }}>
                {!isLoaded ? (
                  <div style={{ padding: "20px" }}>Loading Map...</div>
                ) : (
                  // ADD this import at the top (or use any icon URL you prefer)
  // You can use a simple red dot SVG as data URI for the incident marker

  // CHANGE the GoogleMap section — replace the existing GoogleMap block:
  <GoogleMap
    mapContainerStyle={{ width: "100%", height: "100%" }}
    center={{
      lat: Number(incidentLat),
      lng: Number(incidentLng)
    }}
    zoom={12}
    options={{
      streetViewControl: false
    }}
  >

    {/* 🚨 INCIDENT */}
  <Marker
    key={`incident-${incidentLat}-${incidentLng}`}
    position={{
      lat: Number(incidentLat),
      lng: Number(incidentLng)
    }}
    zIndex={99999}
    onMouseOver={() => setActiveMarker("incident")}
    onMouseOut={() => setActiveMarker(null)}
    icon={{
      path: window.google.maps.SymbolPath.CIRCLE,
      fillColor: "#ff0000",
      fillOpacity: 1,
      strokeColor: "#000000",
      strokeWeight: 2,
      scale: 12
    }}
  >
    {activeMarker === "incident" && (
      <InfoWindow
        position={{
          lat: Number(incidentLat),
          lng: Number(incidentLng)
        }}
        onCloseClick={() => setActiveMarker(null)}
      >
        <div style={{ padding: "5px", minWidth: "180px" }}>
          <h4 style={{ margin: 0, color: "red" }}>
            🚨 Incident Location
          </h4>

          <p style={{ margin: "5px 0" }}>
            <strong>Latitude:</strong> {incidentLat}
          </p>

          <p style={{ margin: "5px 0" }}>
            <strong>Longitude:</strong> {incidentLng}
          </p>
        </div>
      </InfoWindow>
    )}
  </Marker>

  {/* 🚑 AMBULANCES */}
  {ambulances.map((amb, idx) => (
    <Marker
      key={idx}
      position={{
        lat: Number(amb.latitude),
        lng: Number(amb.longitude)
      }}
      onMouseOver={() => setActiveMarker(`ambulance-${idx}`)}
      onMouseOut={() => setActiveMarker(null)}
      icon={{
        url: ambulanceIcon,
        scaledSize: new window.google.maps.Size(40, 40),
        // This adds a red tint overlay
        opacity: 1,
      }}
    >
      {activeMarker === `ambulance-${idx}` && (
        <InfoWindow
          position={{
            lat: Number(amb.latitude),
            lng: Number(amb.longitude)
          }}
          onCloseClick={() => setActiveMarker(null)}
        >
          <div style={{ padding: "8px", minWidth: "200px" }}>
            <h4 style={{ margin: "0 0 8px 0", color: "#d32f2f" }}>
              🚑 Ambulance {amb.vehicleNumber || "N/A"}
            </h4>
            
            <div style={{ marginBottom: "6px", fontSize: "12px" }}>
              <strong>Ambulance Crew:</strong> {amb.driverName || "N/A"}
            </div>
            
            
            <div style={{ marginBottom: "6px", fontSize: "12px" }}>
              <strong>Status:</strong> 
              <span style={{ 
                marginLeft: "5px",
                padding: "2px 6px",
                background: amb.status === "critical" ? "#ffebee" : "#e8f5e9",
                color: amb.status === "critical" ? "#c62828" : "#2e7d32",
                borderRadius: "3px",
                fontSize: "10px",
                fontWeight: "bold"
              }}>
                {amb.status?.toUpperCase() || "STANDBY"}
              </span>
            </div>
            
            <div style={{ marginBottom: "6px", fontSize: "12px" }}>
              <strong>Distance:</strong> {amb.distanceKm || "Calculating..."}
            </div>
            
            
          </div>
        </InfoWindow>
      )}
    </Marker>
  ))}

  </GoogleMap>
                )}
              </div>

              {/* Map Controls */}
              <div style={S.mapControls}>
                {["+", "−", "⟳", "⊞"].map((lbl, i) => (
                  <div key={i} className="pp-map-btn" style={S.mapBtn}>{lbl}</div>
                ))}
                <div
                  className="pp-map-btn"
                  style={{ ...S.mapBtn, fontWeight: heatMode ? 400 : 300, borderColor: heatMode ? T.text : T.border }}
                  onClick={() => setHeatMode(!heatMode)}
                >
                  HTM
                </div>
              </div>

              


              {/* Agent Overlay */}
          {agentOverlay && currentAgent && (
    <div style={S.agentOverlay}>
      <div style={S.agentOverlayInner}>
        <div style={S.aoSpinner} />
        <div style={S.aoTitle}>{currentAgent.name}</div>
        <div style={S.aoSub}>
          Multi-agent orchestration in progress<br />
          across 7 autonomous systems
        </div>
        <div style={S.aoSteps}>
       {currentAgent && currentAgent.steps && currentAgent.steps.length > 0 && currentAgent.steps.slice(0, (currentAgent.currentStep || 0) + 1).map((step, i) => (
  <div key={i} style={{
    ...S.aoStep,
    opacity: i <= currentAgent.currentStep ? 1 : 0.5,
    borderLeft: i === currentAgent.currentStep ? `2px solid ${T.text}` : `1px solid ${T.border}`
  }}>
              <div style={S.aoStepDot} />
              {step}
              {i === currentAgent.currentStep && (
                <span style={{ marginLeft: "auto", fontSize: "0.55rem", color: T.textMuted }}>
                  Processing...
                </span>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )}
            </div>

            {/* Bottom bar */}
            <div style={S.bottomBar}>
              {(ambulances.slice(0, 3) || []).map((a, idx) => {
                if (!a) return null;
                const v = STATIC_VITALS[idx % STATIC_VITALS.length];
              
              })}

            

            
            </div>
          </div>

          {/* ─── RIGHT PANEL — fully driven by activePatient + vitals ─── */}
                {/* ─── RIGHT PANEL — fully driven by activePatient + vitals ─── */}
          
        </div>  {/* This closes the main div that contains left, center, and right panels */}

        {/* ═══════════════ NOTIFICATION DRAWER ═══════════════ */}

        {/* ═══════════════ NOTIFICATION DRAWER ═══════════════ */}
  {/* ═══════════════ NOTIFICATION DRAWER - AGENTIC ANALYSIS DATA ═══════════════ */}
  <div style={{
    ...S.notifDrawer,
    transform: notifOpen ? "translateX(0)" : "translateX(100%)",
    width: "420px",
  }}>
    <div style={S.ndHeader}>
      <span style={S.ndTitle}>AGENTIC ANALYSIS DASHBOARD</span>
      <button onClick={() => setNotifOpen(false)} style={S.ndClose}>×</button>
    </div>
    
    <div style={{ overflowY: "auto", height: "calc(100% - 60px)" }}>
      {!agenticAnalysisData ? (
        <div style={{ padding: "2rem", textAlign: "center", color: T.textMuted, fontSize: "0.7rem" }}>
          Loading agentic analysis...
        </div>
      ) : (
        <>
          {/* PATIENT HEADER */}
          <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}`, background: T.bgAlt }}>
            <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "4px" }}>
              PATIENT DETAILS
            </div>
            <div style={{ fontSize: "0.85rem", fontWeight: 500, color: T.text }}>
              ID: {agenticAnalysisData.patient_id}
            </div>
            <div style={{ fontSize: "0.7rem", color: T.textSec, marginTop: "2px" }}>
              Assessment: {agenticAnalysisData.assessment_id?.slice(0, 8)}...
            </div>
            <div style={{ fontSize: "0.6rem", color: T.textMuted, marginTop: "4px" }}>
              Processed: {new Date(agenticAnalysisData.processed_at).toLocaleString()}
            </div>
          </div>

          {/* TRIAGE & STATUS */}
          <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
            <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
              TRIAGE STATUS
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
              <span style={{ fontSize: "0.7rem", color: T.textSec }}>Level:</span>
              <span style={{ fontSize: "0.8rem", fontWeight: 600, color: T.text, padding: "2px 8px", border: `1px solid ${T.border}`, background: T.bgAlt }}>
                {agenticAnalysisData.triage_level || "N/A"}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
              <span style={{ fontSize: "0.7rem", color: T.textSec }}>Severity:</span>
              <span style={{ fontSize: "0.75rem", fontWeight: 500, color: T.text }}>{agenticAnalysisData.severity || "N/A"}</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 0" }}>
              <span style={{ fontSize: "0.7rem", color: T.textSec }}>Emergency Type:</span>
              <span style={{ fontSize: "0.75rem", color: T.text }}>{agenticAnalysisData.emergency_type || "N/A"}</span>
            </div>
            <div style={{ marginTop: "8px", padding: "6px", background: T.bgAlt, border: `1px solid ${T.border}` }}>
              <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>PRIMARY ACTION</div>
              <div style={{ fontSize: "0.68rem", color: T.textSec }}>{agenticAnalysisData.primary_action_now || "N/A"}</div>
            </div>
          </div>
    {/* DASHBOARD NARRATIVE */}
          {agenticAnalysisData.dashboard_narrative && (
            <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
                CLINICAL SUMMARY
              </div>
              <div style={{ fontSize: "0.68rem", color: T.textSec, lineHeight: 1.5, textAlign: "justify" }}>
                {agenticAnalysisData.dashboard_narrative}
              </div>
            </div>
          )}
      {/* HOSPITAL DASHBOARD CARD */}
          {agenticAnalysisData.hospital_dashboard_card && (
            <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
                DASHBOARD ALERTS
              </div>
              <div style={{ marginBottom: "6px", fontSize: "0.68rem", color: T.text }}>
                <span style={{ fontWeight: 500 }}>Triage:</span> {agenticAnalysisData.hospital_dashboard_card.triage_badge}
              </div>
              <div style={{ marginBottom: "6px", fontSize: "0.68rem", color: T.text }}>
                <span style={{ fontWeight: 500 }}>Insurance:</span> {agenticAnalysisData.hospital_dashboard_card.insurance_badge}
              </div>
              <div style={{ marginBottom: "6px", fontSize: "0.68rem", color: T.textSec }}>
                <span style={{ fontWeight: 500 }}>Alert:</span> {agenticAnalysisData.hospital_dashboard_card.clinical_alert}
              </div>
              <div style={{ marginBottom: "6px", fontSize: "0.68rem", color: T.textSec }}>
                <span style={{ fontWeight: 500 }}>Drug Warning:</span> {agenticAnalysisData.hospital_dashboard_card.drug_warning}
              </div>
            </div>
          )}
          {/* CLINICAL ASSESSMENT */}
          {agenticAnalysisData.clinical_result && (
            <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
                CLINICAL ASSESSMENT
              </div>
              
              {/* Triage Rationale */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>TRIAGE RATIONALE</div>
                <div style={{ fontSize: "0.68rem", color: T.textSec, lineHeight: 1.4 }}>
                  {agenticAnalysisData.clinical_result.triage?.rationale || "Not available"}
                </div>
              </div>

              {/* Haemodynamic Status */}
              <div style={{ marginBottom: "12px" }}>
                <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>HAEMODYNAMIC STATUS</div>
                <div style={{ fontSize: "0.68rem", color: T.textSec }}>
                  Shock Index: {agenticAnalysisData.clinical_result.haemodynamic_status?.shock_index || "N/A"}
                </div>
                <div style={{ fontSize: "0.68rem", color: T.textSec }}>
                  MAP: {agenticAnalysisData.clinical_result.haemodynamic_status?.map || "N/A"} mmHg
                </div>
                <div style={{ fontSize: "0.68rem", color: T.textSec }}>
                  ATLS Class: {agenticAnalysisData.clinical_result.haemodynamic_status?.atls_shock_class || "N/A"}
                </div>
                <div style={{ fontSize: "0.68rem", color: T.textSec }}>
                  Resuscitation: {agenticAnalysisData.clinical_result.haemodynamic_status?.resuscitation_strategy || "N/A"}
                </div>
              </div>

              {/* Neurological */}
            {/* NEUROLOGICAL - Add this line */}
  <div style={{ marginBottom: "12px" }}>
    <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>NEUROLOGICAL</div>
    <div style={{ fontSize: "0.68rem", color: T.textSec }}>
      GCS Total: {agenticAnalysisData.clinical_result.neurological_assessment?.gcs_total || "N/A"}/15
    </div>
    <div style={{ fontSize: "0.68rem", color: T.textSec }}>
      Intubation: {agenticAnalysisData.clinical_result.neurological_assessment?.intubation_indicated || "N/A"}
    </div>
    {/* ADD THIS LINE */}
    
  </div>

              {/* Vital Analysis */}
            {/* VITAL ANALYSIS - Show all 5 vitals */}
  {agenticAnalysisData.clinical_result.vital_analysis && (
    <div style={{ marginBottom: "12px" }}>
      <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>VITAL ANALYSIS</div>
      {agenticAnalysisData.clinical_result.vital_analysis.map((vital, idx) => (
        <div key={idx} style={{ fontSize: "0.65rem", color: T.textSec, marginBottom: "2px" }}>
          {vital.vital}: {vital.classification} - {vital.intervention}
        </div>
      ))}
    </div>
  )}
              {/* Imaging Orders */}
              {agenticAnalysisData.clinical_result.imaging_orders && (
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>IMAGING ORDERS</div>
                  <div style={{ fontSize: "0.65rem", color: T.textSec }}>
                    {agenticAnalysisData.clinical_result.imaging_orders.join(", ")}
                  </div>
                </div>
              )}

              {/* Primary Diagnosis */}
              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>PRIMARY DIAGNOSIS</div>
                <div style={{ fontSize: "0.68rem", color: T.textSec, fontWeight: 500 }}>
                  {agenticAnalysisData.clinical_result.primary_diagnosis || "N/A"}
                </div>
              </div>
            </div>
          )}
  {agenticAnalysisData.memory_result?.medication_safety_review?.drug_interactions && (
    <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
        DRUG INTERACTIONS
      </div>
      {agenticAnalysisData.memory_result.medication_safety_review.drug_interactions.slice(0, 5).map((interaction, idx) => (
        <div key={idx} style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec, padding: "4px", background: T.bgAlt }}>
          <strong>{interaction.emergency_drug}:</strong> {interaction.clinical_effect}
        </div>
      ))}
      {agenticAnalysisData.memory_result.medication_safety_review.drug_interactions.length > 5 && (
        <div style={{ fontSize: "0.55rem", color: T.textMuted, marginTop: "4px" }}>
          +{agenticAnalysisData.memory_result.medication_safety_review.drug_interactions.length - 5} more interactions
        </div>
      )}
    </div>
  )}

  {/* SAFE DRUG LIST */}
  {agenticAnalysisData.memory_result?.allergy_safety_analysis?.safe_drug_list && (
    <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
        SAFE DRUGS FOR EMERGENCY
      </div>
      {Object.entries(agenticAnalysisData.memory_result.allergy_safety_analysis.safe_drug_list).map(([category, drugs], idx) => (
        <div key={idx} style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
          <strong>{category.toUpperCase()}:</strong> {Array.isArray(drugs) ? drugs.join(", ") : drugs}
        </div>
      ))}
    </div>
  )}
          {/* INSURANCE RESULTS */}
          {agenticAnalysisData.insurance_result && (
            <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
                INSURANCE VERIFICATION
              </div>
              
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: "0.68rem", color: T.textSec }}>Provider:</span>
                <span style={{ fontSize: "0.68rem", color: T.text }}>{agenticAnalysisData.insurance_result.policy_verification?.provider || "N/A"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: "0.68rem", color: T.textSec }}>Policy Number:</span>
                <span style={{ fontSize: "0.68rem", color: T.text }}>{agenticAnalysisData.insurance_result.policy_verification?.policy_number || "N/A"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: "0.68rem", color: T.textSec }}>Policy Holder:</span>
                <span style={{ fontSize: "0.68rem", color: T.text }}>{agenticAnalysisData.insurance_result.policy_verification?.policy_holder || "N/A"}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: "0.68rem", color: T.textSec }}>Status:</span>
                <span style={{ fontSize: "0.68rem", color: T.text, fontWeight: 500 }}>
                  {agenticAnalysisData.insurance_result.overall_status || "N/A"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: "0.68rem", color: T.textSec }}>Coverage Limit:</span>
                <span style={{ fontSize: "0.68rem", color: T.text }}>
                  {agenticAnalysisData.insurance_result.financial_summary?.coverage_limit || "N/A"}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 0" }}>
                <span style={{ fontSize: "0.68rem", color: T.textSec }}>Estimated Treatment:</span>
                <span style={{ fontSize: "0.68rem", color: T.text }}>
                  {agenticAnalysisData.insurance_result.financial_summary?.estimated_treatment_min?.toLocaleString()} - {agenticAnalysisData.insurance_result.financial_summary?.estimated_treatment_max?.toLocaleString()}
                </span>
              </div>
              <div style={{ fontSize: "0.68rem", color: T.textSec, marginTop: "8px", padding: "6px", background: T.bgAlt, border: `1px solid ${T.border}` }}>
                {agenticAnalysisData.insurance_result.insurance_remarks || "N/A"}
              </div>
              
              {/* Flagged Issues */}
              {agenticAnalysisData.insurance_result.flagged_issues?.length > 0 && (
                <div style={{ marginTop: "8px" }}>
                  <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>FLAGGED ISSUES</div>
                  {agenticAnalysisData.insurance_result.flagged_issues.map((issue, idx) => (
                    <div key={idx} style={{ fontSize: "0.62rem", color: T.textSec, marginBottom: "4px", padding: "4px", background: T.bgAlt }}>
                      {issue.issue} - {issue.workaround}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
  {/* CASHless PROTOCOL DETAILS */}
  {agenticAnalysisData.insurance_result?.cashless_protocol && (
    <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
        CASHLESS PROTOCOL
      </div>
      <div style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
        <strong>Decision:</strong> {agenticAnalysisData.insurance_result.cashless_protocol.cashless_decision}
      </div>
      <div style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
        <strong>TPA Contact:</strong> {agenticAnalysisData.insurance_result.cashless_protocol.tpa_contact}
      </div>
      <div style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
        <strong>Documents Needed:</strong> {agenticAnalysisData.insurance_result.cashless_protocol.documents_needed_now?.join(", ")}
      </div>
      <div style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
        <strong>Activation Steps:</strong>
        <ol style={{ margin: "4px 0 0 16px", padding: 0 }}>
          {agenticAnalysisData.insurance_result.cashless_protocol.activation_steps?.map((step, idx) => (
            <li key={idx} style={{ fontSize: "0.6rem", marginBottom: "2px" }}>{step}</li>
          ))}
        </ol>
      </div>
    </div>
  )}

  {/* PRE-AUTHORIZATION DETAILS */}
  {agenticAnalysisData.insurance_result?.pre_authorization && (
    <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
        PRE-AUTHORIZATION
      </div>
      <div style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
        <strong>Reference:</strong> {agenticAnalysisData.insurance_result.pre_authorization.preauth_reference}
      </div>
      <div style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
        <strong>Total Authorized:</strong> {agenticAnalysisData.insurance_result.pre_authorization.total_authorized_amount}
      </div>
      <div style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
        <strong>Validity:</strong> {agenticAnalysisData.insurance_result.pre_authorization.validity_hours} hours
      </div>
      <div style={{ marginBottom: "6px", fontSize: "0.62rem", color: T.textSec }}>
        <strong>Pre-auth Required:</strong> {agenticAnalysisData.insurance_result.pre_authorization.preauth_required}
      </div>
    </div>
  )}

  {/* BILLING TEAM INSTRUCTIONS */}
  {/* BILLING TEAM INSTRUCTIONS */}
  {agenticAnalysisData.insurance_result?.billing_team_instruction && 
  Array.isArray(agenticAnalysisData.insurance_result.billing_team_instruction) && (
    <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
      <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
        BILLING TEAM INSTRUCTIONS
      </div>
      <ol style={{ margin: 0, paddingLeft: "16px" }}>
        {agenticAnalysisData.insurance_result.billing_team_instruction.map((instruction, idx) => (
          <li key={idx} style={{ fontSize: "0.6rem", color: T.textSec, marginBottom: "4px" }}>{instruction}</li>
        ))}
      </ol>
    </div>
  )}

          {/* MEMORY / MEDICATION RESULTS */}
          {agenticAnalysisData.memory_result && (
            <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
                MEDICAL HISTORY
              </div>
              
              {/* Chronic Conditions */}
              {agenticAnalysisData.memory_result.chronic_condition_analysis?.length > 0 && (
                <div style={{ marginBottom: "10px" }}>
                  <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>CHRONIC CONDITIONS</div>
                  {agenticAnalysisData.memory_result.chronic_condition_analysis.map((cond, idx) => (
                    <div key={idx} style={{ fontSize: "0.65rem", color: T.textSec, marginBottom: "4px" }}>
                      {cond.condition}: {cond.trauma_modification?.substring(0, 100)}...
                    </div>
                  ))}
                </div>
              )}

              {/* Medications */}
              <div style={{ marginBottom: "10px" }}>
                <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>CURRENT MEDICATIONS</div>
                <div style={{ fontSize: "0.68rem", color: T.textSec }}>
                  {agenticAnalysisData.memory_result.medication_safety_review?.medications_recorded || "None"}
                </div>
                <div style={{ fontSize: "0.62rem", color: T.textMuted }}>
                  Dose: {agenticAnalysisData.memory_result.medication_safety_review?.dose} | Frequency: {agenticAnalysisData.memory_result.medication_safety_review?.frequency}
                </div>
                <div style={{ fontSize: "0.62rem", color: T.textMuted }}>
                  Last Dose: {agenticAnalysisData.memory_result.medication_safety_review?.last_dose}
                </div>
              </div>

              {/* Allergies */}
              <div style={{ marginBottom: "10px" }}>
                <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>ALLERGIES</div>
                <div style={{ fontSize: "0.68rem", color: T.textSec }}>
                  Drug: {agenticAnalysisData.memory_result.allergy_safety_analysis?.drug_allergy_status}
                  {agenticAnalysisData.memory_result.allergy_safety_analysis?.drug_allergy_details && ` (${agenticAnalysisData.memory_result.allergy_safety_analysis.drug_allergy_details})`}
                </div>
                <div style={{ fontSize: "0.68rem", color: T.textSec }}>
                  Food: {agenticAnalysisData.memory_result.allergy_safety_analysis?.food_allergy_status}
                </div>
              </div>

              {/* Blood Group */}
              <div style={{ marginBottom: "8px" }}>
                <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>BLOOD GROUP</div>
                <div style={{ fontSize: "0.7rem", color: T.text, fontWeight: 500 }}>
                  {agenticAnalysisData.memory_result.blood_group_management?.blood_group || "N/A"}
                </div>
                {agenticAnalysisData.memory_result.blood_group_management?.blood_products_likely_needed && (
                  <div style={{ fontSize: "0.62rem", color: T.textSec, marginTop: "2px" }}>
                    MTP Triggered: Yes - {agenticAnalysisData.memory_result.blood_group_management.mtp_trigger_rationale}
                  </div>
                )}
              </div>

              {/* Family History */}
              {agenticAnalysisData.memory_result.family_history_risk?.family_history_recorded !== "None recorded" && (
                <div style={{ marginBottom: "8px" }}>
                  <div style={{ fontSize: "0.6rem", color: T.textMuted, marginBottom: "3px" }}>FAMILY HISTORY</div>
                  <div style={{ fontSize: "0.65rem", color: T.textSec }}>
                    {agenticAnalysisData.memory_result.family_history_risk.family_history_recorded}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* CRITICAL ACTION CHECKLIST */}
          {agenticAnalysisData.synthesis_result?.critical_action_checklist && (
            <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
                CRITICAL ACTIONS ({agenticAnalysisData.synthesis_result.critical_action_checklist.length})
              </div>
              {agenticAnalysisData.synthesis_result.critical_action_checklist.map((action, idx) => (
                <div key={idx} style={{ 
                  marginBottom: "8px", 
                  padding: "8px",
                  borderLeft: `2px solid ${idx < 3 ? "#000000" : T.border}`,
                  background: T.bgAlt
                }}>
                  <div style={{ fontSize: "0.6rem", color: T.textMuted }}>ACTION {action.rank}</div>
                  <div style={{ fontSize: "0.68rem", color: T.textSec, lineHeight: 1.4, fontWeight: idx < 3 ? 500 : 400 }}>
                    {action.action}
                  </div>
                  <div style={{ fontSize: "0.55rem", color: T.textMuted, marginTop: "3px" }}>
                    By: {action.responsible} | Within: {action.timeframe}
                  </div>
                  {action.consequence_if_delayed && (
                    <div style={{ fontSize: "0.55rem", color: T.textMuted, marginTop: "2px" }}>
                      Risk: {action.consequence_if_delayed}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* INTEGRATED RISKS */}
          {agenticAnalysisData.synthesis_result?.integrated_risk_summary && (
            <div style={{ padding: "1rem 1.25rem", borderBottom: `1px solid ${T.border}` }}>
              <div style={{ fontSize: "0.65rem", color: T.textMuted, letterSpacing: "0.1em", marginBottom: "8px" }}>
                IDENTIFIED RISKS
              </div>
              {agenticAnalysisData.synthesis_result.integrated_risk_summary.map((risk, idx) => (
                <div key={idx} style={{ marginBottom: "12px", padding: "6px", background: T.bgAlt }}>
                  <div style={{ fontSize: "0.7rem", fontWeight: 500, color: T.text }}>{risk.risk}</div>
                  <div style={{ fontSize: "0.62rem", color: T.textMuted, marginTop: "2px" }}>
                    Severity: {risk.severity}
                  </div>
                  <div style={{ fontSize: "0.62rem", color: T.textSec, marginTop: "2px" }}>
                    Mitigation: {risk.mitigation}
                  </div>
                </div>
              ))}
            </div>
          )}

      
    

          {/* FOOTER - Confidence & Timing */}
          {/* DRUG INTERACTIONS & SAFETY */}




        </>
      )}
    </div>
  </div>
              {/* MODAL */}
            {/* MODAL */}
        {showIntakeModal && (
          <div style={S.modalOverlay}>
            <div style={S.modalContainer}>
              <div style={S.modalHeader}>
                <span style={S.modalTitle}>Smart Patient Intake & Analysis Platform</span>
                <button onClick={() => setShowIntakeModal(false)} style={S.modalClose}>×</button>
              </div>
              
              <div style={S.stepIndicator}>
                <div style={S.stepWrapper}>
                  <div style={{...S.stepDot, ...(currentStep > 1 ? S.stepDotCompleted : {}), ...(currentStep === 1 ? S.stepDotActive : {})}}>1</div>
                  <div style={S.stepLabel}>Clinical</div>
                </div>
                <div style={S.stepWrapper}>
                  <div style={{...S.stepDot, ...(currentStep > 2 ? S.stepDotCompleted : {}), ...(currentStep === 2 ? S.stepDotActive : {})}}>2</div>
                  <div style={S.stepLabel}>Medical History</div>
                </div>
                <div style={S.stepWrapper}>
                  <div style={{...S.stepDot, ...(currentStep === 3 ? S.stepDotActive : {})}}>3</div>
                  <div style={S.stepLabel}>Insurance</div>
                </div>
              </div>
              
              <div style={S.modalBody}>
                {currentStep === 1 && (
                  <>
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Vitals</div>
                      <div style={S.formRow}>
                        <label style={S.formLabel}>Heart Rate (bpm)</label>
                        <input style={S.formInput} type="number" value={intakeFormData.heartRate} onChange={(e) => handleIntakeChange("heartRate", e.target.value)} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Systolic BP (mmHg)</label>
                          <input style={S.formInput} type="number" value={intakeFormData.systolicBP} onChange={(e) => handleIntakeChange("systolicBP", e.target.value)} />
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Diastolic BP (mmHg)</label>
                          <input style={S.formInput} type="number" value={intakeFormData.diastolicBP} onChange={(e) => handleIntakeChange("diastolicBP", e.target.value)} />
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>SpO2 (%)</label>
                          <input style={S.formInput} type="number" value={intakeFormData.spo2} onChange={(e) => handleIntakeChange("spo2", e.target.value)} />
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Respiratory Rate</label>
                          <input style={S.formInput} type="number" value={intakeFormData.respiratoryRate} onChange={(e) => handleIntakeChange("respiratoryRate", e.target.value)} />
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Temperature (C)</label>
                          <input style={S.formInput} value={intakeFormData.temperature} onChange={(e) => handleIntakeChange("temperature", e.target.value)} />
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Consciousness & Neurological Status</div>
                      <div style={S.formRow}>
                        <label style={S.formLabel}>Consciousness Level</label>
                        <select style={S.formSelect} value={intakeFormData.consciousnessLevel} onChange={(e) => handleIntakeChange("consciousnessLevel", e.target.value)}>
                          <option value="" disabled selected>Select</option>
                          <option>Alert</option>
                          <option>Verbal Response</option>
                          <option>Pain Response</option>
                          <option>Unresponsive</option>
                        </select>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>GCS - Eye</label>
                          <select style={S.formSelect} value={intakeFormData.gcsEye} onChange={(e) => handleIntakeChange("gcsEye", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>1</option>
                            <option>2</option>
                            <option>3</option>
                            <option>4</option>
                          </select>
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>GCS - Verbal</label>
                          <select style={S.formSelect} value={intakeFormData.gcsVerbal} onChange={(e) => handleIntakeChange("gcsVerbal", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>1</option>
                            <option>2</option>
                            <option>3</option>
                            <option>4</option>
                            <option>5</option>
                          </select>
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>GCS - Motor</label>
                          <select style={S.formSelect} value={intakeFormData.gcsMotor} onChange={(e) => handleIntakeChange("gcsMotor", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>1</option>
                            <option>2</option>
                            <option>3</option>
                            <option>4</option>
                            <option>5</option>
                            <option>6</option>
                          </select>
                        </div>
                      </div>
                      <div style={S.formRow}>
                        <label style={S.formLabel}>Pupil Reaction</label>
                        <select style={S.formSelect} value={intakeFormData.pupilReaction} onChange={(e) => handleIntakeChange("pupilReaction", e.target.value)}>
                          <option value="" disabled selected>Select</option>
                          <option>Normal</option>
                          <option>Dilated</option>
                          <option>Unequal</option>
                        </select>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Injury & Symptoms</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Type of Injury</label>
                          <select style={S.formSelect} value={intakeFormData.injuryType} onChange={(e) => handleIntakeChange("injuryType", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Head</option>
                            <option>Chest</option>
                            <option>Abdomen</option>
                            <option>Limb</option>
                            <option>Multiple</option>
                          </select>
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>External Bleeding</label>
                          <select style={S.formSelect} value={intakeFormData.externalBleeding} onChange={(e) => handleIntakeChange("externalBleeding", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>None</option>
                            <option>Mild</option>
                            <option>Moderate</option>
                            <option>Severe</option>
                          </select>
                        </div>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px" }}>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Internal Bleeding Suspected</label>
                          <select style={S.formSelect} value={intakeFormData.internalBleeding} onChange={(e) => handleIntakeChange("internalBleeding", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Fracture Suspected</label>
                          <select style={S.formSelect} value={intakeFormData.fractureSuspected} onChange={(e) => handleIntakeChange("fractureSuspected", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Burn Injury</label>
                          <select style={S.formSelect} value={intakeFormData.burnInjury} onChange={(e) => handleIntakeChange("burnInjury", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Critical Symptoms</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>Chest Pain</label>
                          <select style={S.formSelect} value={intakeFormData.chestPain} onChange={(e) => handleIntakeChange("chestPain", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Breathing Difficulty</label>
                          <select style={S.formSelect} value={intakeFormData.breathingDifficulty} onChange={(e) => handleIntakeChange("breathingDifficulty", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Loss of Consciousness</label>
                          <select style={S.formSelect} value={intakeFormData.lossOfConsciousness} onChange={(e) => handleIntakeChange("lossOfConsciousness", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Seizures</label>
                          <select style={S.formSelect} value={intakeFormData.seizures} onChange={(e) => handleIntakeChange("seizures", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Vomiting</label>
                          <select style={S.formSelect} value={intakeFormData.vomiting} onChange={(e) => handleIntakeChange("vomiting", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                      </div>
                      <div style={S.formRow}>
                        <label style={S.formLabel}>Notes / Observations</label>
                        <textarea style={S.formTextarea} value={intakeFormData.clinicalNotes} onChange={(e) => handleIntakeChange("clinicalNotes", e.target.value)} />
                      </div>
                    </div>
                  </>
                )}
                
                {currentStep === 2 && (
                  <>
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Basic Medical Background</div>
                      <div style={S.formRow}>
                        <label style={S.formLabel}>Known Medical Conditions</label>
                        <input style={S.formInput} placeholder="Diabetes, Hypertension, Heart Disease, Asthma" value={intakeFormData.medicalConditions} onChange={(e) => handleIntakeChange("medicalConditions", e.target.value)} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "10px" }}>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Chronic Illness</label>
                          <select style={S.formSelect} value={intakeFormData.chronicIllness} onChange={(e) => handleIntakeChange("chronicIllness", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div style={S.formRow}>
                          <label style={S.formLabel}>Chronic Illness Details</label>
                          <input style={S.formInput} value={intakeFormData.chronicIllnessDetails} onChange={(e) => handleIntakeChange("chronicIllnessDetails", e.target.value)} />
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Medications</div>
                      <div style={S.formRow}>
                        <label style={S.formLabel}>Current Medications Name</label>
                        <input style={S.formInput} value={intakeFormData.currentMeds} onChange={(e) => handleIntakeChange("currentMeds", e.target.value)} />
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>Dosage</label>
                          <input style={S.formInput} value={intakeFormData.medDosage} onChange={(e) => handleIntakeChange("medDosage", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Frequency</label>
                          <input style={S.formInput} placeholder="OD, BID, TID" value={intakeFormData.medFrequency} onChange={(e) => handleIntakeChange("medFrequency", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Last Dose Taken</label>
                          <input style={S.formInput} type="datetime-local" value={intakeFormData.lastDoseTaken} onChange={(e) => handleIntakeChange("lastDoseTaken", e.target.value)} />
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Allergies</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>Drug Allergies</label>
                          <select style={S.formSelect} value={intakeFormData.drugAllergies} onChange={(e) => handleIntakeChange("drugAllergies", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Drug Allergy Details</label>
                          <input style={S.formInput} value={intakeFormData.drugAllergiesDetails} onChange={(e) => handleIntakeChange("drugAllergiesDetails", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Food Allergies</label>
                          <select style={S.formSelect} value={intakeFormData.foodAllergies} onChange={(e) => handleIntakeChange("foodAllergies", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Food Allergy Details</label>
                          <input style={S.formInput} value={intakeFormData.foodAllergiesDetails} onChange={(e) => handleIntakeChange("foodAllergiesDetails", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Other Allergies</label>
                          <input style={S.formInput} value={intakeFormData.otherAllergies} onChange={(e) => handleIntakeChange("otherAllergies", e.target.value)} />
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Surgical History</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr 2fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>Previous Surgeries</label>
                          <select style={S.formSelect} value={intakeFormData.previousSurgeries} onChange={(e) => handleIntakeChange("previousSurgeries", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Surgery Type</label>
                          <input style={S.formInput} value={intakeFormData.surgeryType} onChange={(e) => handleIntakeChange("surgeryType", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Surgery Date</label>
                          <input style={S.formInput} type="date" value={intakeFormData.surgeryDate} onChange={(e) => handleIntakeChange("surgeryDate", e.target.value)} />
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Additional Medical Info</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>Blood Group</label>
                          <select style={S.formSelect} value={intakeFormData.bloodGroup} onChange={(e) => handleIntakeChange("bloodGroup", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>A+</option>
                            <option>A-</option>
                            <option>B+</option>
                            <option>B-</option>
                            <option>O+</option>
                            <option>O-</option>
                            <option>AB+</option>
                            <option>AB-</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Pregnancy Status</label>
                          <select style={S.formSelect} value={intakeFormData.pregnancyStatus} onChange={(e) => handleIntakeChange("pregnancyStatus", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Not Applicable</option>
                            <option>1st Trimester</option>
                            <option>2nd Trimester</option>
                            <option>3rd Trimester</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Family Medical History</label>
                          <textarea style={S.formTextarea} value={intakeFormData.familyHistory} onChange={(e) => handleIntakeChange("familyHistory", e.target.value)} />
                        </div>
                      </div>
                    </div>
                  </>
                )}
                
                {currentStep === 3 && (
                  <>
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Identification</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>ID Type</label>
                          <select style={S.formSelect} value={intakeFormData.idType} onChange={(e) => handleIntakeChange("idType", e.target.value)}>
                            <option value="" disabled selected>Select ID Type</option>
                            <option>Aadhaar</option>
                            <option>Passport</option>
                            <option>Other</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>ID Number</label>
                          <input style={S.formInput} value={intakeFormData.idNumber} onChange={(e) => handleIntakeChange("idNumber", e.target.value)} />
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Insurance Details</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>Insurance Available</label>
                          <select style={S.formSelect} value={intakeFormData.insuranceAvailable} onChange={(e) => handleIntakeChange("insuranceAvailable", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Provider Name</label>
                          <input style={S.formInput} value={intakeFormData.providerName} onChange={(e) => handleIntakeChange("providerName", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Policy Number</label>
                          <input style={S.formInput} value={intakeFormData.policyNumber} onChange={(e) => handleIntakeChange("policyNumber", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Policy Holder Name</label>
                          <input style={S.formInput} value={intakeFormData.policyHolderName} onChange={(e) => handleIntakeChange("policyHolderName", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Relationship to Patient</label>
                          <input style={S.formInput} value={intakeFormData.relationshipToPatient} onChange={(e) => handleIntakeChange("relationshipToPatient", e.target.value)} />
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Coverage Details</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>Policy Valid</label>
                          <select style={S.formSelect} value={intakeFormData.policyValid} onChange={(e) => handleIntakeChange("policyValid", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                            <option>Unknown</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Emergency Coverage</label>
                          <select style={S.formSelect} value={intakeFormData.emergencyCoverage} onChange={(e) => handleIntakeChange("emergencyCoverage", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                            <option>Unknown</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Coverage Limit</label>
                          <input style={S.formInput} placeholder="Amount" value={intakeFormData.coverageLimit} onChange={(e) => handleIntakeChange("coverageLimit", e.target.value)} />
                        </div>
                        <div>
                          <label style={S.formLabel}>Cashless Facility</label>
                          <select style={S.formSelect} value={intakeFormData.cashlessFacility} onChange={(e) => handleIntakeChange("cashlessFacility", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Authorization</div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
                        <div>
                          <label style={S.formLabel}>Pre-Authorization Required</label>
                          <select style={S.formSelect} value={intakeFormData.preAuthRequired} onChange={(e) => handleIntakeChange("preAuthRequired", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Yes</option>
                            <option>No</option>
                          </select>
                        </div>
                        <div>
                          <label style={S.formLabel}>Pre-Authorization Status</label>
                          <select style={S.formSelect} value={intakeFormData.preAuthStatus} onChange={(e) => handleIntakeChange("preAuthStatus", e.target.value)}>
                            <option value="" disabled selected>Select</option>
                            <option>Pending</option>
                            <option>Approved</option>
                            <option>Not Required</option>
                          </select>
                        </div>
                      </div>
                    </div>
                    
                    <div style={S.formSection}>
                      <div style={S.formSectionTitle}>Contact & Notes</div>
                      <div style={S.formRow}>
                        <label style={S.formLabel}>Insurance Contact Number</label>
                        <input style={S.formInput} value={intakeFormData.insuranceContact} onChange={(e) => handleIntakeChange("insuranceContact", e.target.value)} />
                      </div>
                      <div style={S.formRow}>
                        <label style={S.formLabel}>Remarks</label>
                        <textarea style={S.formTextarea} value={intakeFormData.insuranceRemarks} onChange={(e) => handleIntakeChange("insuranceRemarks", e.target.value)} />
                      </div>
                    </div>
                  </>
                )}
              </div>
              
              <div style={S.modalFooter}>
                <div>
                  {currentStep > 1 && (
                    <button onClick={handlePrevStep} style={S.modalButtonSecondary}>Back</button>
                  )}
                </div>
                <div>
                  {currentStep < 3 ? (
                    <button onClick={handleNextStep} style={S.modalButton}>Next</button>
                  ) : (
                    <button onClick={handleSubmitIntake} style={S.modalButton}>Submit</button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  export default CustomerCarePatientProfile;