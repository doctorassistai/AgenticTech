import React, { useState, useRef, useEffect } from "react";
import {
  Box,
  Typography,
  IconButton,
  Tooltip,
  Chip,
  Tabs,
  Tab,
  Collapse,
  CircularProgress,
} from "@mui/material";
import {
  CloseRounded,
  PictureAsPdfRounded,
  EditRounded,
  DeleteRounded,
  SaveRounded,
  CheckCircleRounded,
  WarningAmberRounded,
  LocalHospitalRounded,
  AccessTimeRounded,
  RestaurantRounded,
  FitnessCenterRounded,
  EventNoteRounded,
  NotificationsActiveRounded,
  MedicationRounded,
  CalendarMonthRounded,
  KeyboardArrowDownRounded,
  KeyboardArrowUpRounded,
  RefreshRounded,
  TranslateRounded,
} from "@mui/icons-material";

// ── Design tokens ─────────────────────────────────────────────────────────────
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
  white: "#ffffff",
  danger: "#c62828",
  dangerLight: "#ffebee",
  warn: "#e65100",
  warnLight: "#fff3e0",
  success: "#2e7d32",
  successLight: "#e8f5e9",
};

const os = (extra = {}) => ({ fontFamily: FONT, fontWeight: FW, ...extra });

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

// ── Language options ──────────────────────────────────────────────────────────
const LANGUAGES = [
  { code: "English",   label: "English",    native: "English" },
  { code: "Malayalam", label: "Malayalam",  native: "മലയാളം" },
  { code: "Hindi",     label: "Hindi",      native: "हिन्दी" },
  { code: "Tamil",     label: "Tamil",      native: "தமிழ்" },
  { code: "Kannada",   label: "Kannada",    native: "ಕನ್ನಡ" },
  { code: "Telugu",    label: "Telugu",     native: "తెలుగు" },
  { code: "Bengali",   label: "Bengali",    native: "বাংলা" },
  { code: "Marathi",   label: "Marathi",    native: "मराठी" },
  { code: "Arabic",    label: "Arabic",     native: "العربية" },
];

// ── Section config ────────────────────────────────────────────────────────────
const SECTION_META = {
  welcome_message:        { label: "Welcome",              icon: <CheckCircleRounded sx={{ fontSize: 16 }} />,        color: C.success },
  condition_explanation:  { label: "Your Condition",       icon: <LocalHospitalRounded sx={{ fontSize: 16 }} />,      color: C.smoke },
  medications_section:    { label: "Your Medications",     icon: <MedicationRounded sx={{ fontSize: 16 }} />,         color: C.charcoal },
  daily_schedule_table:   { label: "Daily Schedule",       icon: <AccessTimeRounded sx={{ fontSize: 16 }} />,         color: C.charcoal },
  top_dos:                { label: "What To Do",           icon: <FitnessCenterRounded sx={{ fontSize: 16 }} />,      color: C.success },
  top_donts:              { label: "What To Avoid",        icon: <WarningAmberRounded sx={{ fontSize: 16 }} />,       color: C.warn },
  appointments_and_tests: { label: "Appointments & Tests", icon: <CalendarMonthRounded sx={{ fontSize: 16 }} />,      color: C.charcoal },
  warning_signs:          { label: "Warning Signs",        icon: <NotificationsActiveRounded sx={{ fontSize: 16 }} />, color: C.danger },
  questions_for_doctor:   { label: "Questions for Doctor", icon: <EventNoteRounded sx={{ fontSize: 16 }} />,          color: C.charcoal },
  quick_reference_card:   { label: "Quick Reference",      icon: <RestaurantRounded sx={{ fontSize: 16 }} />,         color: C.charcoal },
};

const SECTION_ORDER = [
  "welcome_message", "condition_explanation", "medications_section",
  "daily_schedule_table", "top_dos", "top_donts",
  "appointments_and_tests", "warning_signs",
  "questions_for_doctor", "quick_reference_card",
];

// ── HTML-based PDF generator (Unicode / Malayalam safe) ───────────────────────
const generateEducationPDF = ({ pkg, patientName = "Patient", generatedAt, language = "English" }) => {

  const escapeHtml = (str) => String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const renderValue = (value) => {
    if (!value) return "";
    if (typeof value === "string") {
      return `<p>${escapeHtml(value)}</p>`;
    }
    if (Array.isArray(value)) {
      const items = value.map((item) => {
        const text = typeof item === "string"
          ? item
          : item.do || item.dont || item.what || item.drug_name || item.symptom || JSON.stringify(item);
        const sub = item?.why || item?.reason || item?.dose_instruction || item?.action || "";
        return `<li>${escapeHtml(text)}${sub ? `<span class="sub">${escapeHtml(sub)}</span>` : ""}</li>`;
      });
      return `<ul>${items.join("")}</ul>`;
    }
    if (typeof value === "object") {
      // Handle warning_signs object specially
      if (value.go_to_er_now || value.call_doctor_today || value.mention_next_visit) {
        const tiers = [
          { key: "go_to_er_now",       label: "🚨 Go To Emergency Room Now", cls: "tier-er" },
          { key: "call_doctor_today",  label: "📞 Call Your Doctor Today",   cls: "tier-call" },
          { key: "mention_next_visit", label: "📋 Mention at Next Visit",    cls: "tier-note" },
        ];
        return tiers.map(({ key, label, cls }) => {
          const items = value[key];
          if (!items?.length) return "";
          return `
            <div class="warning-tier ${cls}">
              <div class="tier-label">${label}</div>
              <ul>
                ${items.map(s => {
                  const text = s.symptom || s;
                  const action = s.action || "";
                  return `<li>${escapeHtml(text)}${action ? `<span class="sub">${escapeHtml(action)}</span>` : ""}</li>`;
                }).join("")}
              </ul>
            </div>`;
        }).join("");
      }
      // Handle daily_schedule_table
      if (value.morning || value.afternoon || value.evening || value.bedtime || value.as_needed) {
        const slots = [
          { key: "morning",   icon: "🌅" },
          { key: "afternoon", icon: "☀️" },
          { key: "evening",   icon: "🌆" },
          { key: "bedtime",   icon: "🌙" },
          { key: "as_needed", icon: "💊" },
        ];
        return `<div class="schedule-grid">${slots.map(({ key, icon }) => {
          const val = value[key];
          if (!val || (Array.isArray(val) && val.length === 0)) return "";
          const display = typeof val === "string"
            ? `<p>${escapeHtml(val)}</p>`
            : Array.isArray(val)
              ? `<ul>${val.map(v => `<li>${escapeHtml(typeof v === "object" ? `${v.drugs?.join(", ") || ""} ${v.time_suggestion || ""}` : v)}</li>`).join("")}</ul>`
              : `<p>${escapeHtml(JSON.stringify(val))}</p>`;
          return `<div class="slot"><div class="slot-title">${icon} ${key.replace("_", " ")}</div>${display}</div>`;
        }).join("")}</div>`;
      }
      // Handle medications array
      if (Array.isArray(value)) {
        return renderValue(value);
      }
      // Generic object
      return `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
    }
    return "";
  };

  // Medications special rendering
  const renderMedications = (meds) => {
    if (!Array.isArray(meds)) return renderValue(meds);
    return meds.map((m) => `
      <div class="med-card ${m.high_alert ? "high-alert" : ""}">
        <div class="med-name">${escapeHtml(m.drug_name || "")}
          ${m.brand_name ? `<span class="brand">${escapeHtml(m.brand_name)}</span>` : ""}
          ${m.high_alert ? `<span class="badge-alert">HIGH ALERT</span>` : ""}
        </div>
        ${m.plain_explanation ? `<p>${escapeHtml(m.plain_explanation)}</p>` : ""}
        ${m.dose_instruction ? `<p>💊 ${escapeHtml(m.dose_instruction)}</p>` : ""}
        ${m.timing_instruction ? `<p>⏰ ${escapeHtml(m.timing_instruction)}</p>` : ""}
        ${m.key_warnings?.length ? `<div class="med-warnings">${m.key_warnings.map(w => `<div>⚠️ ${escapeHtml(w)}</div>`).join("")}</div>` : ""}
      </div>
    `).join("");
  };

  const sections = [
    { key: "welcome_message",        title: "Welcome" },
    { key: "condition_explanation",  title: "Your Condition" },
    { key: "medications_section",    title: "Your Medications", renderer: renderMedications },
    { key: "daily_schedule_table",   title: "Daily Schedule" },
    { key: "top_dos",                title: "What To Do" },
    { key: "top_donts",              title: "What To Avoid" },
    { key: "appointments_and_tests", title: "Appointments & Tests" },
    { key: "warning_signs",          title: "Warning Signs" },
    { key: "questions_for_doctor",   title: "Questions for Your Doctor" },
    { key: "quick_reference_card",   title: "Quick Reference Card" },
  ];

  // Google Fonts import for Noto Sans family (covers most Indic scripts)
  const fontImport = `
    @import url('https://fonts.googleapis.com/css2?family=Noto+Sans:wght@300;400;600&family=Noto+Sans+Malayalam:wght@300;400;600&family=Noto+Sans+Devanagari:wght@300;400;600&family=Noto+Sans+Tamil:wght@300;400;600&family=Noto+Sans+Kannada:wght@300;400;600&family=Noto+Sans+Telugu:wght@300;400;600&family=Noto+Sans+Bengali:wght@300;400;600&family=Noto+Sans+Arabic:wght@300;400;600&display=swap');
  `;

  const html = `<!DOCTYPE html>
<html lang="${language}">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Patient Education — ${escapeHtml(patientName)}</title>
  <style>
    ${fontImport}

    * { box-sizing: border-box; margin: 0; padding: 0; }

    body {
      font-family: 'Noto Sans Malayalam', 'Noto Sans Devanagari', 'Noto Sans Tamil',
                   'Noto Sans Kannada', 'Noto Sans Telugu', 'Noto Sans Bengali',
                   'Noto Sans Arabic', 'Noto Sans', Arial, sans-serif;
      font-weight: 300;
      font-size: 13px;
      color: #1a1a1a;
      line-height: 1.75;
      padding: 32px 40px;
      max-width: 800px;
      margin: 0 auto;
    }

    /* Header */
    .pdf-header {
      background: #0a0a0a;
      color: #fff;
      padding: 14px 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin: -32px -40px 24px;
    }
    .pdf-header h1 { font-size: 13px; font-weight: 600; letter-spacing: 0.03em; }
    .pdf-header .gen-date { font-size: 10px; color: #a8a8a8; }

    /* Patient banner */
    .patient-banner {
      background: #f2f2f2;
      border: 1px solid #e8e8e8;
      padding: 10px 14px;
      margin-bottom: 24px;
      border-radius: 3px;
    }
    .patient-banner .name { font-size: 14px; font-weight: 600; color: #1a1a1a; }
    .patient-banner .meta { font-size: 11px; color: #7a7a7a; margin-top: 2px; }

    /* Sections */
    .section { margin-bottom: 20px; page-break-inside: avoid; }
    .section-title {
      background: #1a1a1a;
      color: #fff;
      padding: 7px 12px;
      font-size: 10px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.07em;
      margin-bottom: 12px;
    }
    .section-body { padding: 0 4px; }

    p { margin-bottom: 6px; }
    ul { padding-left: 18px; margin-bottom: 6px; }
    li { margin-bottom: 5px; }
    .sub { display: block; font-size: 11px; color: #7a7a7a; margin-top: 2px; margin-left: 4px; }

    /* Medications */
    .med-card {
      border: 1px solid #e8e8e8;
      border-radius: 3px;
      padding: 12px 14px;
      margin-bottom: 10px;
      background: #f2f2f2;
      page-break-inside: avoid;
    }
    .med-card.high-alert { background: #fff3e0; border-color: #e65100; }
    .med-name { font-size: 13px; font-weight: 600; color: #1a1a1a; margin-bottom: 6px; }
    .brand {
      font-size: 10px; font-weight: 300; background: #e8e8e8;
      padding: 1px 6px; border-radius: 2px; margin-left: 8px; vertical-align: middle;
    }
    .badge-alert {
      font-size: 10px; font-weight: 600; color: #e65100;
      border: 1px solid #e65100; padding: 1px 6px;
      border-radius: 2px; margin-left: 8px; vertical-align: middle;
    }
    .med-warnings { margin-top: 8px; }
    .med-warnings div { font-size: 11px; color: #c62828; margin-bottom: 3px; }

    /* Schedule grid */
    .schedule-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    .slot {
      border: 1px solid #e8e8e8;
      border-radius: 3px;
      padding: 10px 12px;
      background: #f2f2f2;
    }
    .slot-title {
      font-size: 10px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #7a7a7a;
      margin-bottom: 6px;
    }

    /* Warning signs */
    .warning-tier {
      border-radius: 3px;
      padding: 12px 14px;
      margin-bottom: 10px;
      page-break-inside: avoid;
    }
    .tier-er   { background: #ffebee; border: 1px solid #c62828; }
    .tier-call { background: #fff3e0; border: 1px solid #e65100; }
    .tier-note { background: #f2f2f2; border: 1px solid #d4d4d4; }
    .tier-label {
      font-size: 11px;
      font-weight: 600;
      margin-bottom: 8px;
    }
    .tier-er .tier-label   { color: #c62828; }
    .tier-call .tier-label { color: #e65100; }
    .tier-note .tier-label { color: #4a4a4a; }

    pre { font-family: monospace; font-size: 11px; color: #4a4a4a; white-space: pre-wrap; word-break: break-word; }

    /* Footer */
    .pdf-footer {
      margin-top: 32px;
      padding-top: 12px;
      border-top: 1px solid #e8e8e8;
      text-align: center;
      font-size: 10px;
      color: #a8a8a8;
    }

    @media print {
      body { padding: 0; max-width: 100%; }
      .pdf-header { margin: 0 0 24px; }
      .no-print { display: none !important; }
      .section { page-break-inside: avoid; }
    }
  </style>
</head>
<body>

  <div class="pdf-header">
    <h1>DoctorAssist.AI — Patient Education Package</h1>
    <div class="gen-date">Generated: ${escapeHtml(generatedAt ? new Date(generatedAt).toLocaleString() : new Date().toLocaleString())}</div>
  </div>

  <div class="patient-banner">
    <div class="name">${escapeHtml(patientName)}</div>
    <div class="meta">Language: ${escapeHtml(language)}</div>
  </div>

  ${sections
    .filter(({ key }) => pkg[key] != null)
    .map(({ key, title, renderer }) => {
      const value = pkg[key];
      const body = renderer ? renderer(value) : renderValue(value);
      return `
        <div class="section">
          <div class="section-title">${escapeHtml(title)}</div>
          <div class="section-body">${body}</div>
        </div>`;
    }).join("")}

  <div class="pdf-footer">
    DoctorAssist.AI Patient Education — ${escapeHtml(patientName)}
  </div>

  <script>
    // Auto-print after fonts load
    document.fonts.ready.then(() => {
      setTimeout(() => window.print(), 300);
    });
  </script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (!win) {
    alert("Popup blocked. Please allow popups to download the PDF.");
    return;
  }
  win.document.open();
  win.document.write(html);
  win.document.close();
};

// ── Section shell with collapse / edit / remove ────────────────────────────────
const SectionShell = ({ sectionKey, children, onRemove, onEdit, isEditing }) => {
  const meta = SECTION_META[sectionKey] || { label: sectionKey, icon: null, color: C.charcoal };
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Box sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", overflow: "hidden", background: C.white }}>
      <Box
        sx={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          px: 2.5, py: 1.5, background: C.ghost,
          borderBottom: collapsed ? "none" : `1px solid ${C.fog}`,
          cursor: "pointer",
        }}
        onClick={() => setCollapsed(v => !v)}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box sx={{ color: meta.color }}>{meta.icon}</Box>
          <Typography sx={{ ...os({ fontSize: 13, color: C.ink, letterSpacing: "0.02em" }) }}>
            {meta.label}
          </Typography>
        </Box>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }} onClick={e => e.stopPropagation()}>
          <Tooltip title={isEditing ? "Editing..." : "Edit section"}>
            <IconButton size="small" onClick={onEdit}
              sx={{ width: 26, height: 26, borderRadius: "2px", color: isEditing ? C.charcoal : C.ash, border: `1px solid ${isEditing ? C.mist : "transparent"}`, "&:hover": { background: C.fog, color: C.ink } }}>
              <EditRounded sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Remove section">
            <IconButton size="small" onClick={onRemove}
              sx={{ width: 26, height: 26, borderRadius: "2px", color: C.ash, "&:hover": { background: C.dangerLight, color: C.danger } }}>
              <DeleteRounded sx={{ fontSize: 13 }} />
            </IconButton>
          </Tooltip>
          <IconButton size="small" onClick={() => setCollapsed(v => !v)}
            sx={{ width: 26, height: 26, borderRadius: "2px", color: C.ash }}>
            {collapsed ? <KeyboardArrowDownRounded sx={{ fontSize: 15 }} /> : <KeyboardArrowUpRounded sx={{ fontSize: 15 }} />}
          </IconButton>
        </Box>
      </Box>
      <Collapse in={!collapsed}>
        <Box sx={{ p: { xs: 2, sm: 2.5 } }}>{children}</Box>
      </Collapse>
    </Box>
  );
};

// ── Text content renderer ─────────────────────────────────────────────────────
const TextContent = ({ value }) => {
  if (!value) return null;
  if (typeof value === "string") {
    return <Typography sx={{ ...os({ fontSize: 13, color: C.charcoal, lineHeight: 1.75 }) }}>{value}</Typography>;
  }
  if (Array.isArray(value)) {
    return (
      <Box component="ul" sx={{ pl: 2.5, m: 0 }}>
        {value.map((item, i) => (
          <Box component="li" key={i} sx={{ ...os({ fontSize: 13, color: C.charcoal, mb: 0.75, lineHeight: 1.65 }) }}>
            {typeof item === "string" ? item : item.do || item.dont || item.what || item.drug_name || item.symptom || JSON.stringify(item)}
            {(item.why || item.reason || item.dose_instruction || item.action) && (
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash, mt: 0.25 }) }}>
                {item.why || item.reason || item.dose_instruction || item.action}
              </Typography>
            )}
          </Box>
        ))}
      </Box>
    );
  }
  return <pre style={{ fontFamily: FONT, fontSize: 12, color: C.smoke, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{JSON.stringify(value, null, 2)}</pre>;
};

// ── Medications card list ─────────────────────────────────────────────────────
const MedicationsContent = ({ meds }) => {
  if (!Array.isArray(meds)) return <TextContent value={meds} />;
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {meds.map((m, i) => (
        <Box key={i} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2, background: m.high_alert ? C.warnLight : C.ghost }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1, flexWrap: "wrap" }}>
            <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{m.drug_name}</Typography>
            {m.brand_name && <Chip label={m.brand_name} size="small" sx={{ fontSize: 10, height: 18, background: C.fog }} />}
            {m.high_alert && <Chip label="HIGH ALERT" size="small" sx={{ fontSize: 10, height: 18, background: C.warnLight, color: C.warn, border: `1px solid ${C.warn}` }} />}
          </Box>
          {m.plain_explanation && <Typography sx={{ ...os({ fontSize: 12, color: C.charcoal, mb: 0.5 }) }}>{m.plain_explanation}</Typography>}
          {m.dose_instruction && <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>💊 {m.dose_instruction}</Typography>}
          {m.timing_instruction && <Typography sx={{ ...os({ fontSize: 12, color: C.smoke }) }}>⏰ {m.timing_instruction}</Typography>}
          {m.key_warnings?.length > 0 && (
            <Box sx={{ mt: 1 }}>
              {m.key_warnings.map((w, j) => (
                <Typography key={j} sx={{ ...os({ fontSize: 11, color: C.danger }) }}>⚠️ {w}</Typography>
              ))}
            </Box>
          )}
        </Box>
      ))}
    </Box>
  );
};

// ── Schedule table ────────────────────────────────────────────────────────────
const ScheduleContent = ({ schedule }) => {
  if (!schedule) return null;
  const slots = ["morning", "afternoon", "evening", "bedtime", "as_needed"];
  const icons = { morning: "🌅", afternoon: "☀️", evening: "🌆", bedtime: "🌙", as_needed: "💊" };
  return (
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", sm: "repeat(2, 1fr)", md: "repeat(3, 1fr)" }, gap: 1.5 }}>
      {slots.map(slot => {
        const val = schedule[slot];
        if (!val || (Array.isArray(val) && val.length === 0)) return null;
        return (
          <Box key={slot} sx={{ border: `1px solid ${C.fog}`, borderRadius: "4px", p: 2, background: C.ghost }}>
            <Typography sx={{ ...os({ fontSize: 11, color: C.ash, textTransform: "uppercase", letterSpacing: "0.07em", mb: 1 }) }}>
              {icons[slot]} {slot.replace("_", " ")}
            </Typography>
            <TextContent value={
              typeof val === "string" ? val
              : Array.isArray(val) ? val.map(v => typeof v === "object" ? `${v.drugs?.join(", ") || ""} ${v.time_suggestion || ""}` : v)
              : val
            } />
          </Box>
        );
      })}
    </Box>
  );
};

// ── Warning signs 3-tier ──────────────────────────────────────────────────────
const WarningContent = ({ signs }) => {
  if (!signs) return null;
  const tiers = [
    { key: "go_to_er_now",       label: "🚨 Go To Emergency Room Now",  bg: C.dangerLight, border: C.danger, color: C.danger },
    { key: "call_doctor_today",  label: "📞 Call Your Doctor Today",    bg: C.warnLight,   border: C.warn,   color: C.warn },
    { key: "mention_next_visit", label: "📋 Mention at Next Visit",     bg: C.ghost,       border: C.mist,   color: C.smoke },
  ];
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
      {tiers.map(({ key, label, bg, border, color }) => {
        const items = signs[key];
        if (!items?.length) return null;
        return (
          <Box key={key} sx={{ border: `1px solid ${border}`, borderRadius: "4px", p: 2, background: bg }}>
            <Typography sx={{ ...os({ fontSize: 12, color, mb: 1, letterSpacing: "0.03em" }) }}>{label}</Typography>
            {items.map((s, i) => (
              <Box key={i} sx={{ mb: 0.75 }}>
                <Typography sx={{ ...os({ fontSize: 13, color: C.ink }) }}>{s.symptom || s}</Typography>
                {s.action && <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>{s.action}</Typography>}
              </Box>
            ))}
          </Box>
        );
      })}
    </Box>
  );
};

// ── Section content router ────────────────────────────────────────────────────
const renderSectionContent = (key, value) => {
  if (key === "medications_section")  return <MedicationsContent meds={value} />;
  if (key === "daily_schedule_table") return <ScheduleContent schedule={value} />;
  if (key === "warning_signs")        return <WarningContent signs={value} />;
  return <TextContent value={value} />;
};

// ── Edit overlay ──────────────────────────────────────────────────────────────
const EditOverlay = ({ sectionKey, value, onSave, onCancel }) => {
  const [draft, setDraft] = useState(
    typeof value === "string" ? value : JSON.stringify(value, null, 2)
  );
  const isJson = typeof value !== "string";

  const handleSave = () => {
    if (isJson) {
      try { onSave(JSON.parse(draft)); }
      catch { alert("Invalid JSON. Please fix before saving."); }
    } else {
      onSave(draft);
    }
  };

  return (
    <Box sx={{ border: `1px solid ${C.charcoal}`, borderRadius: "4px", overflow: "hidden" }}>
      <Box sx={{ px: 2, py: 1.5, background: C.ink, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography sx={{ ...os({ fontSize: 12, color: C.white, letterSpacing: "0.04em" }) }}>
          Editing: {SECTION_META[sectionKey]?.label || sectionKey}
          {isJson && <span style={{ color: C.silver, marginLeft: 8 }}>— JSON mode</span>}
        </Typography>
        <Box sx={{ display: "flex", gap: 0.75 }}>
          <Box component="button" onClick={onCancel}
            sx={{ px: 2, py: 0.5, borderRadius: "2px", border: `1px solid ${C.ash}`, background: "transparent", color: C.silver, fontFamily: FONT, fontSize: 11, cursor: "pointer", "&:hover": { background: "rgba(255,255,255,0.08)" } }}>
            Cancel
          </Box>
          <Box component="button" onClick={handleSave}
            sx={{ px: 2, py: 0.5, borderRadius: "2px", border: "none", background: C.white, color: C.black, fontFamily: FONT, fontSize: 11, cursor: "pointer", display: "flex", alignItems: "center", gap: 0.5 }}>
            <SaveRounded sx={{ fontSize: 12 }} /> Save
          </Box>
        </Box>
      </Box>
      <textarea
        value={draft}
        onChange={e => setDraft(e.target.value)}
        style={{
          width: "100%", minHeight: 200, padding: "12px 14px",
          border: "none", background: "#f9f9f9",
          fontFamily: isJson ? "monospace" : FONT,
          fontSize: 13, color: C.ink, resize: "vertical", outline: "none",
          boxSizing: "border-box",
        }}
      />
    </Box>
  );
};

// ── Language selector dropdown ─────────────────────────────────────────────────
const LanguageSelector = ({ value, onChange, disabled }) => (
  <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
    <TranslateRounded sx={{ fontSize: 14, color: C.ash }} />
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      disabled={disabled}
      style={{
        fontFamily: FONT,
        fontSize: 12,
        padding: "5px 8px",
        border: `1px solid ${C.fog}`,
        borderRadius: "2px",
        background: C.white,
        color: C.ink,
        cursor: disabled ? "not-allowed" : "pointer",
        outline: "none",
        appearance: "none",
        WebkitAppearance: "none",
        paddingRight: 24,
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath d='M0 0l5 6 5-6z' fill='%237a7a7a'/%3E%3C/svg%3E")`,
        backgroundRepeat: "no-repeat",
        backgroundPosition: "right 8px center",
        minWidth: 130,
      }}
    >
      {LANGUAGES.map(l => (
        <option key={l.code} value={l.code}>
          {l.native} ({l.label})
        </option>
      ))}
    </select>
  </Box>
);

// ── Main component ────────────────────────────────────────────────────────────
export default function PatientEducation({
  open,
  onClose,
  patientId,
  doctorId,
  patientName = "Patient",
}) {
  const [loading, setLoading]         = useState(false);
  const [pkg, setPkg]                 = useState(null);
  const [meta, setMeta]               = useState({});
  const [removedKeys, setRemovedKeys] = useState(new Set());
  const [editingKey, setEditingKey]   = useState(null);
  const [tab, setTab]                 = useState(0);
  const [error, setError]             = useState(null);
  const [language, setLanguage]       = useState("Malayalam");

  const visibleKeys = SECTION_ORDER.filter(k => !removedKeys.has(k) && pkg?.[k] != null);

  useEffect(() => {
  if (open && patientId && doctorId) {
    setPkg(null);
    setError(null);
    setRemovedKeys(new Set());
    setEditingKey(null);
    setTab(0);
    // fetchEducation() removed intentionally —
    // the language picker screen should show first.
    // The user selects a language, then clicks "Generate Package",
    // which calls generateFresh() and POSTs that exact language.
  }
}, [open, patientId, doctorId]);
  const fetchEducation = async () => {
    setLoading(true);
    setError(null);
    setPkg(null);
    try {
      const res = await fetch(
        `${API_BASE_URL}hms/users/ai-legacy/patient-education/${patientId}/latest?doctor_id=${doctorId}`
      );
      if (res.ok) {
        const data = await res.json();
        setPkg(data.education_package || {});
        setMeta({
          language: data.language,
          generated_at: data.generated_at,
          reading_level: data.reading_level,
        });
      }
      // if not ok, just fall through — language picker screen will show
    } catch {
      // network error — silently show the language picker
    } finally {
      setLoading(false);
    }
  };

  const generateFresh = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE_URL}hms/users/ai-legacy/patient-education/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          patient_id: patientId,
          doctor_id: doctorId,
          language,
          reading_level: "simple",
          include_intermediates: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Generation failed");
      setPkg(data.education_package || {});
      setMeta({ language: data.language, generated_at: data.generated_at });
    } catch (e) {
      setError(e.message || "Generation failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleSectionEdit = (key, newValue) => {
    setPkg(prev => ({ ...prev, [key]: newValue }));
    setEditingKey(null);
  };

  const handleRemove = (key) => {
    setRemovedKeys(prev => new Set([...prev, key]));
    if (editingKey === key) setEditingKey(null);
  };

  const handleDownloadPDF = () => {
    if (!pkg) return;
    const filteredPkg = {};
    visibleKeys.forEach(k => { filteredPkg[k] = pkg[k]; });
    generateEducationPDF({
      pkg: filteredPkg,
      patientName,
      generatedAt: meta.generated_at,
      language: meta.language || language,
    });
  };

  if (!open) return null;

  return (
    <>
      {/* Backdrop */}
      <Box onClick={onClose} sx={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", zIndex: 4000 }} />

      {/* Modal */}
      <Box sx={{ position: "fixed", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", zIndex: 4001, p: 2, pointerEvents: "none" }}>
        <Box sx={{
          background: C.white,
          border: `1px solid ${C.fog}`,
          borderRadius: "4px",
          boxShadow: "0 24px 64px rgba(0,0,0,0.18)",
          width: "100%",
          maxWidth: 920,
          maxHeight: "92vh",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          pointerEvents: "auto",
        }}>

          {/* ── Header ─────────────────────────────────────────────────── */}
          <Box sx={{
            px: 3, py: 2,
            borderBottom: `1px solid ${C.fog}`,
            background: C.ghost,
            display: "flex", alignItems: "flex-start", justifyContent: "space-between",
            flexShrink: 0,
            gap: 2,
          }}>
            <Box>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 0.5 }}>
                <LocalHospitalRounded sx={{ fontSize: 18, color: C.smoke }} />
                <Typography sx={{ ...os({ fontSize: 15, color: C.ink, letterSpacing: "0.02em" }) }}>
                  Patient Education Package
                </Typography>
              </Box>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                {patientName}
                {meta.language && ` · ${meta.language}`}
                {meta.reading_level && ` · ${meta.reading_level} reading level`}
                {meta.generated_at && ` · Generated ${new Date(meta.generated_at).toLocaleString()}`}
              </Typography>
            </Box>

            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexShrink: 0, mt: 0.25, flexWrap: "wrap", justifyContent: "flex-end" }}>

              {/* ── Language selector ── */}
              {!pkg && !loading && (
                <LanguageSelector value={language} onChange={setLanguage} disabled={loading} />
              )}

              {/* ── Regenerate (shows language selector inline when pkg exists) ── */}
              {pkg && !loading && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <LanguageSelector value={language} onChange={setLanguage} disabled={loading} />
                  <Tooltip title="Regenerate with selected language">
                    <IconButton
                      size="small"
                      onClick={generateFresh}
                      disabled={loading}
                      sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.fog}`, color: C.ash, "&:hover": { background: C.fog, color: C.ink } }}
                    >
                      <RefreshRounded sx={{ fontSize: 15 }} />
                    </IconButton>
                  </Tooltip>
                </Box>
              )}

              {/* ── Download PDF ── */}
              <Tooltip title="Opens print dialog — works with Malayalam & all scripts">
                <Box
                  component="button"
                  onClick={handleDownloadPDF}
                  disabled={!pkg || loading}
                  sx={{
                    display: "flex", alignItems: "center", gap: 0.75,
                    px: 2, py: 0.85, borderRadius: "2px",
                    border: "none", background: C.black, color: C.white,
                    fontFamily: FONT, fontSize: 11, cursor: "pointer",
                    opacity: (!pkg || loading) ? 0.4 : 1,
                    "&:hover": { background: C.charcoal },
                    transition: "background 0.15s",
                  }}
                >
                  <PictureAsPdfRounded sx={{ fontSize: 14 }} />
                  Download PDF
                </Box>
              </Tooltip>

              {/* ── Close ── */}
              <IconButton
                size="small"
                onClick={onClose}
                sx={{ width: 32, height: 32, borderRadius: "2px", border: `1px solid ${C.fog}`, color: C.ash, "&:hover": { background: C.fog } }}
              >
                <CloseRounded sx={{ fontSize: 15 }} />
              </IconButton>
            </Box>
          </Box>

          {/* ── Sub-tabs ──────────────────────────────────────────────── */}
          <Box sx={{ px: 3, borderBottom: `1px solid ${C.fog}`, flexShrink: 0 }}>
            <Tabs
              value={tab}
              onChange={(_, v) => setTab(v)}
              sx={{
                "& .MuiTab-root": {
                  textTransform: "none", fontWeight: 300, fontFamily: FONT,
                  fontSize: 12, minWidth: "auto", px: 2, color: C.ash,
                  letterSpacing: "0.04em",
                  "&.Mui-selected": { color: C.ink, fontWeight: 400 },
                },
                "& .MuiTabs-indicator": { background: C.black, height: 1.5 },
                minHeight: 38,
              }}
            >
              <Tab label="Education Document" />
              <Tab label="Medications" />
              <Tab label="Schedule" />
              <Tab label="Warning Signs" />
            </Tabs>
          </Box>

          {/* ── Body ──────────────────────────────────────────────────── */}
          <Box sx={{ flex: 1, overflowY: "auto", p: { xs: 2, sm: 3 } }}>

            {/* Loading */}
            {loading && (
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 10, gap: 2 }}>
                <CircularProgress size={32} sx={{ color: C.charcoal }} />
                <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>
                  Generating patient education package in {language}…
                </Typography>
                <Typography sx={{ ...os({ fontSize: 11, color: C.silver }) }}>
                  Running 5 AI agents — medication education, schedule, follow-up, dos &amp; don'ts, and narrative assembly
                </Typography>
              </Box>
            )}

            {/* Pre-generation language picker (no pkg yet, not loading) */}
            {!loading && !pkg && !error && (
              <Box sx={{
                display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
                py: 10, gap: 3,
              }}>
                <LocalHospitalRounded sx={{ fontSize: 40, color: C.mist }} />
                <Typography sx={{ ...os({ fontSize: 14, color: C.ink }) }}>
                  Generate a patient education package
                </Typography>
                <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <Typography sx={{ ...os({ fontSize: 12, color: C.ash }) }}>Select language</Typography>
                  <LanguageSelector value={language} onChange={setLanguage} disabled={false} />
                  <Box
                    component="button"
                    onClick={generateFresh}
                    sx={{
                      px: 4, py: 1.25, borderRadius: "2px",
                      border: "none", background: C.black, color: C.white,
                      fontFamily: FONT, fontSize: 12, cursor: "pointer",
                      "&:hover": { background: C.charcoal },
                      transition: "background 0.15s",
                      mt: 1,
                    }}
                  >
                    Generate Package
                  </Box>
                </Box>
              </Box>
            )}

            {/* Error */}
            {!loading && error && (
              <Box sx={{ border: `1px solid ${C.danger}`, borderRadius: "4px", p: 3, background: C.dangerLight, textAlign: "center" }}>
                <Typography sx={{ ...os({ fontSize: 13, color: C.danger, mb: 1 }) }}>{error}</Typography>
                <Box component="button" onClick={generateFresh}
                  sx={{ px: 3, py: 1, borderRadius: "2px", border: "none", background: C.black, color: C.white, fontFamily: FONT, fontSize: 12, cursor: "pointer" }}>
                  Try Again
                </Box>
              </Box>
            )}

            {/* Content */}
            {!loading && pkg && (
              <>
                {/* Tab 0: Full document */}
                {tab === 0 && (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                    {removedKeys.size > 0 && (
                      <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1.25, border: `1px solid ${C.mist}`, borderRadius: "4px", background: C.ghost, flexWrap: "wrap" }}>
                        <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>Removed sections:</Typography>
                        {[...removedKeys].map(k => (
                          <Chip key={k} label={SECTION_META[k]?.label || k} size="small"
                            onDelete={() => setRemovedKeys(prev => { const s = new Set(prev); s.delete(k); return s; })}
                            sx={{ fontSize: 10, height: 20, background: C.fog }} />
                        ))}
                      </Box>
                    )}
                    {visibleKeys.map(key => (
                      <SectionShell
                        key={key}
                        sectionKey={key}
                        onRemove={() => handleRemove(key)}
                        onEdit={() => setEditingKey(editingKey === key ? null : key)}
                        isEditing={editingKey === key}
                      >
                        {editingKey === key
                          ? <EditOverlay sectionKey={key} value={pkg[key]} onSave={v => handleSectionEdit(key, v)} onCancel={() => setEditingKey(null)} />
                          : renderSectionContent(key, pkg[key])
                        }
                      </SectionShell>
                    ))}
                  </Box>
                )}

                {/* Tab 1: Medications */}
                {tab === 1 && (
                  <Box>
                    {pkg.medications_section
                      ? <MedicationsContent meds={pkg.medications_section} />
                      : <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No medication data available.</Typography>
                    }
                  </Box>
                )}

                {/* Tab 2: Schedule */}
                {tab === 2 && (
                  <Box>
                    {pkg.daily_schedule_table
                      ? <ScheduleContent schedule={pkg.daily_schedule_table} />
                      : <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No schedule data available.</Typography>
                    }
                  </Box>
                )}

                {/* Tab 3: Warning signs */}
                {tab === 3 && (
                  <Box>
                    {pkg.warning_signs
                      ? <WarningContent signs={pkg.warning_signs} />
                      : <Typography sx={{ ...os({ fontSize: 13, color: C.ash }) }}>No warning signs available.</Typography>
                    }
                  </Box>
                )}
              </>
            )}
          </Box>

          {/* ── Footer ────────────────────────────────────────────────── */}
          {pkg && !loading && (
            <Box sx={{
              px: 3, py: 2,
              borderTop: `1px solid ${C.fog}`,
              background: C.ghost,
              display: "flex", alignItems: "center", justifyContent: "space-between",
              flexWrap: "wrap", gap: 2,
              flexShrink: 0,
            }}>
              <Typography sx={{ ...os({ fontSize: 11, color: C.ash }) }}>
                {visibleKeys.length} section{visibleKeys.length !== 1 ? "s" : ""} visible
                {removedKeys.size > 0 && ` · ${removedKeys.size} removed`}
                {` · ${meta.language || language}`}
              </Typography>
              <Box
                component="button"
                onClick={handleDownloadPDF}
                sx={{
                  display: "flex", alignItems: "center", gap: 0.75,
                  px: 3, py: 1, borderRadius: "2px",
                  border: "none", background: C.black, color: C.white,
                  fontFamily: FONT, fontSize: 12, cursor: "pointer",
                  "&:hover": { background: C.charcoal },
                  transition: "background 0.15s",
                }}
              >
                <PictureAsPdfRounded sx={{ fontSize: 15 }} />
                Download Patient PDF
              </Box>
            </Box>
          )}
        </Box>
      </Box>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}