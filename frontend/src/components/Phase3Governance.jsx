import { useState, useEffect, useCallback, useRef } from "react";

// ─── FONT & BASE STYLES ────────────────────────────────────────────────────────
const FontStyle = () => (
  <style>{`
    

    * { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg: #ffffff;
      --surface: #fafafa;
      --surface2: #f5f5f5;
      --border: #e5e7eb;
      --border-light: #f0f0f0;
      --text: #0a0a0a;
      --text-secondary: #6b7280;
      --text-tertiary: #9ca3af;
      --accent: #000000;
      --font-sans: 'Open Sans', sans-serif;
      --font-mono: 'IBM Plex Mono', ui-monospace, monospace;
    }

    body { font-family: var(--font-sans); background: var(--bg); color: var(--text); }

    @keyframes spin { to { transform: rotate(360deg); } }
    @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
    .fade-in { animation: fadeIn 0.2s ease; }

    ::-webkit-scrollbar { width: 5px; height: 5px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #d1d5db; border-radius: 99px; }
  `}</style>
);

// ─── HELPERS ──────────────────────────────────────────────────────────────────
const getDoctorId = () => new URLSearchParams(window.location.search).get("doctor_id");
const API = "";

const ep = {
  // Skills
  skills:         (d, p = "") => `${API}api/hms/users/ai-legacy/governance/skills?doctor_id=${d}${p}`,
  skill:          (d, id)     => `${API}api/hms/users/ai-legacy/governance/skills/${id}?doctor_id=${d}`,
  skillTransition:(d, id)     => `${API}api/hms/users/ai-legacy/governance/skills/${id}/transition?doctor_id=${d}`,
  skillVersions:  (d, id)     => `${API}api/hms/users/ai-legacy/governance/skills/${id}/versions?doctor_id=${d}`,
  skillVersion:   (d, id, v)  => `${API}api/hms/users/ai-legacy/governance/skills/${id}/versions/${v}?doctor_id=${d}`,
  skillCompareV:  (d, id,a,b) => `${API}api/hms/users/ai-legacy/governance/skills/${id}/versions/compare/${a}/${b}?doctor_id=${d}`,
  skillRollback:  (d, id)     => `${API}api/hms/users/ai-legacy/governance/skills/${id}/rollback?doctor_id=${d}`,
  skillAudit:     (d, id)     => `${API}api/hms/users/ai-legacy/governance/skills/${id}/audit?doctor_id=${d}`,
  skillUpdate:    (d, id)     => `${API}api/hms/users/ai-legacy/governance/skills/${id}?doctor_id=${d}`,
  // Guidelines
  guidelinesRegister: (d)     => `${API}api/hms/users/ai-legacy/governance/guidelines/register?doctor_id=${d}`,
  guidelinesList:     (d)     => `${API}api/hms/users/ai-legacy/governance/guidelines?doctor_id=${d}`,
  guidelineDetect:    (d)     => `${API}api/hms/users/ai-legacy/governance/guidelines/detect?doctor_id=${d}`,
  guidelineLinkVer:   (d)     => `${API}api/hms/users/ai-legacy/governance/guidelines/link-version?doctor_id=${d}`,
  guidelineVersions:  (d,gid) => `${API}api/hms/users/ai-legacy/governance/guidelines/${gid}/versions?doctor_id=${d}`,
  guidelineCompare:   (d)     => `${API}api/hms/users/ai-legacy/governance/guidelines/compare?doctor_id=${d}`,
  comparison:         (d,cid) => `${API}api/hms/users/ai-legacy/governance/guidelines/comparisons/${cid}?doctor_id=${d}`,
  comparisonImpact:   (d,cid) => `${API}api/hms/users/ai-legacy/governance/guidelines/comparisons/${cid}/impact?doctor_id=${d}`,
  comparisonRecommend:(d,cid) => `${API}api/hms/users/ai-legacy/governance/guidelines/comparisons/${cid}/recommend?doctor_id=${d}`,
  comparisonApply:    (d,cid) => `${API}api/hms/users/ai-legacy/governance/guidelines/comparisons/${cid}/apply?doctor_id=${d}`,
  recommendations:    (d,p="")=> `${API}api/hms/users/ai-legacy/governance/guidelines/recommendations?doctor_id=${d}${p}`,
  recReview:          (d)     => `${API}api/hms/users/ai-legacy/governance/guidelines/recommendations/review?doctor_id=${d}`,
  recBulkReview:      (d)     => `${API}api/hms/users/ai-legacy/governance/guidelines/recommendations/bulk-review?doctor_id=${d}`,
  // Workflow
  workflow:           (d)     => `${API}api/hms/users/ai-legacy/governance/guidelines/upload-workflow?doctor_id=${d}`,
  // Dashboard
  dashboard:          (d)     => `${API}api/hms/users/ai-legacy/governance/dashboard?doctor_id=${d}`,
};

const STATUS_META = {
  draft:        { label: "Draft",        bg: "#f5f5f5", color: "#374151", border: "#e5e7eb" },
  under_review: { label: "Under Review", bg: "#fffbeb", color: "#d97706", border: "#fde68a" },
  approved:     { label: "Approved",     bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" },
  published:    { label: "Published",    bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" },
  archived:     { label: "Archived",     bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
  deprecated:   { label: "Deprecated",   bg: "#fef2f2", color: "#dc2626", border: "#fecaca" },
};

const SEV_META = {
  critical: { bg: "#fef2f2", color: "#dc2626", border: "#fecaca" },
  high:     { bg: "#fff7ed", color: "#ea580c", border: "#fed7aa" },
  medium:   { bg: "#fffbeb", color: "#d97706", border: "#fde68a" },
  low:      { bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" },
  none:     { bg: "#f9fafb", color: "#9ca3af", border: "#e5e7eb" },
};

const fmt = {
  date: (s) => s ? new Date(s).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—",
  dateTime: (s) => s ? new Date(s).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—",
};

async function apiFetch(url, opts = {}) {
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json", ...opts.headers },
    ...opts,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.detail || `Request failed (${res.status})`);
  }
  return res.json();
}

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const m = STATUS_META[status] || STATUS_META.draft;
  return (
    <span style={{
      fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      letterSpacing: "0.03em", textTransform: "capitalize",
    }}>{m.label}</span>
  );
}

function SevBadge({ severity }) {
  const m = SEV_META[severity] || SEV_META.none;
  return (
    <span style={{
      fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
      background: m.bg, color: m.color, border: `1px solid ${m.border}`,
      textTransform: "capitalize",
    }}>{severity || "none"}</span>
  );
}

function Spinner({ size = 20 }) {
  return <i className="ti ti-loader-2" style={{ fontSize: size, animation: "spin 1s linear infinite", display: "inline-block" }} />;
}

function EmptyState({ icon = "ti-inbox", title, sub, action }) {
  return (
    <div style={{
      padding: "3rem", textAlign: "center", color: "var(--text-secondary)",
      background: "var(--surface)", borderRadius: "10px", border: "1px solid var(--border-light)",
    }}>
      <i className={`ti ${icon}`} style={{ fontSize: "36px", display: "block", marginBottom: "10px", color: "var(--text-tertiary)" }} />
      <p style={{ fontWeight: 600, color: "var(--text)", marginBottom: "4px", fontSize: "14px" }}>{title}</p>
      {sub && <p style={{ fontSize: "12px", marginBottom: action ? "16px" : 0 }}>{sub}</p>}
      {action}
    </div>
  );
}

function Btn({ onClick, disabled, loading, children, variant = "primary", size = "md", style: extStyle = {} }) {
  const sz = size === "sm" ? { padding: "5px 12px", fontSize: "11px" } : { padding: "9px 18px", fontSize: "12px" };
  const base = {
    ...sz, fontWeight: 600, letterSpacing: "0.04em", borderRadius: "7px",
    cursor: disabled || loading ? "not-allowed" : "pointer",
    display: "inline-flex", alignItems: "center", gap: "6px",
    transition: "all 0.15s", border: "none", opacity: disabled ? 0.5 : 1,
    ...(variant === "primary"  ? { background: "#000", color: "#fff" } : {}),
    ...(variant === "ghost"    ? { background: "var(--surface2)", color: "var(--text-secondary)", border: "1px solid var(--border)" } : {}),
    ...(variant === "danger"   ? { background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca" } : {}),
    ...(variant === "success"  ? { background: "#f0fdf4", color: "#16a34a", border: "1px solid #bbf7d0" } : {}),
    ...extStyle,
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} style={base}>
      {loading ? <Spinner size={13} /> : null}
      {children}
    </button>
  );
}

function Card({ children, style: ext = {}, onClick }) {
  return (
    <div
      onClick={onClick}
      style={{
        background: "var(--bg)", border: "1px solid var(--border-light)", borderRadius: "10px",
        padding: "16px", transition: "all 0.15s",
        cursor: onClick ? "pointer" : undefined,
        ...ext,
      }}
      onMouseEnter={onClick ? e => { e.currentTarget.style.borderColor = "#000"; e.currentTarget.style.boxShadow = "0 2px 12px rgba(0,0,0,0.06)"; } : undefined}
      onMouseLeave={onClick ? e => { e.currentTarget.style.borderColor = "var(--border-light)"; e.currentTarget.style.boxShadow = "none"; } : undefined}
    >{children}</div>
  );
}

function Section({ title, icon, children, action }) {
  return (
    <div style={{ marginBottom: "20px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          {icon && <i className={`ti ${icon}`} style={{ fontSize: "14px", color: "var(--text-secondary)" }} />}
          <span style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-secondary)" }}>{title}</span>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function Modal({ title, onClose, children, width = 640 }) {
  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "16px",
    }}>
      <div style={{
        background: "var(--bg)", borderRadius: "12px", border: "1px solid var(--border)",
        width: `min(${width}px, 100%)`, maxHeight: "90vh",
        display: "flex", flexDirection: "column", boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid var(--border-light)", flexShrink: 0 }}>
          <span style={{ fontWeight: 600, fontSize: "14px" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "4px" }}>
            <i className="ti ti-x" style={{ fontSize: "18px" }} />
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto", padding: "18px" }}>{children}</div>
      </div>
    </div>
  );
}

function JsonEditor({ value, onChange, height = 280 }) {
  return (
    <textarea
      value={typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      onChange={e => onChange(e.target.value)}
      style={{
        width: "100%", height, fontFamily: "var(--font-mono)", fontSize: "11.5px", lineHeight: 1.7,
        padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "6px",
        resize: "vertical", background: "var(--surface2)", color: "var(--text)", outline: "none",
      }}
    />
  );
}

function Toast({ message, type = "success", onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, []);
  const bg = type === "error" ? "#fef2f2" : "#f0fdf4";
  const co = type === "error" ? "#dc2626" : "#16a34a";
  return (
    <div style={{
      position: "fixed", bottom: "24px", right: "24px", zIndex: 9999,
      background: bg, color: co, border: `1px solid ${co}33`,
      padding: "10px 16px", borderRadius: "8px", fontSize: "13px", fontWeight: 500,
      display: "flex", alignItems: "center", gap: "8px",
      boxShadow: "0 4px 20px rgba(0,0,0,0.1)",
      animation: "fadeIn 0.2s ease",
    }}>
      <i className={`ti ${type === "error" ? "ti-alert-circle" : "ti-circle-check"}`} />
      {message}
    </div>
  );
}

function useToast() {
  const [toast, setToast] = useState(null);
  const show = useCallback((message, type = "success") => setToast({ message, type }), []);
  const el = toast ? <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} /> : null;
  return [show, el];
}

// ─── NAV SIDEBAR ──────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { id: "dashboard",    label: "Dashboard",         icon: "ti-layout-dashboard" },
  { id: "skills",       label: "Skills",            icon: "ti-brain" },
  { id: "guidelines",   label: "Guidelines",        icon: "ti-book-2" },
  { id: "comparisons",  label: "Comparisons",       icon: "ti-git-merge" },
  { id: "recommendations", label: "Recommendations",icon: "ti-bulb" },
];

function Sidebar({ active, onNav, doctorId }) {
  return (
    <div style={{
      width: "220px", minHeight: "100vh", background: "var(--surface)", borderRight: "1px solid var(--border-light)",
      display: "flex", flexDirection: "column", flexShrink: 0,
    }}>
      <div style={{ padding: "18px 16px 14px", borderBottom: "1px solid var(--border-light)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "2px" }}>
          <div style={{ width: "28px", height: "28px", borderRadius: "6px", background: "#000", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <i className="ti ti-dna-2" style={{ fontSize: "15px", color: "#fff" }} />
          </div>
          <div>
            <p style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.02em" }}>ClinicalMind</p>
            <p style={{ fontSize: "10px", color: "var(--text-secondary)" }}>Governance</p>
          </div>
        </div>
      </div>

      <nav style={{ flex: 1, padding: "10px 8px" }}>
        {NAV_ITEMS.map(n => (
          <button
            key={n.id}
            onClick={() => onNav(n.id)}
            style={{
              width: "100%", textAlign: "left", padding: "9px 12px",
              borderRadius: "7px", marginBottom: "2px", cursor: "pointer", border: "none",
              background: active === n.id ? "#000" : "transparent",
              color: active === n.id ? "#fff" : "var(--text-secondary)",
              fontSize: "12px", fontWeight: active === n.id ? 600 : 400,
              display: "flex", alignItems: "center", gap: "9px", transition: "all 0.15s",
            }}
          >
            <i className={`ti ${n.icon}`} style={{ fontSize: "14px" }} />
            {n.label}
          </button>
        ))}
      </nav>

      <div style={{ padding: "10px 12px 16px", borderTop: "1px solid var(--border-light)" }}>
        <div style={{ padding: "8px 10px", background: "var(--surface2)", borderRadius: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
          <i className="ti ti-user-circle" style={{ fontSize: "15px", color: "var(--text-secondary)" }} />
          <div>
            <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>Doctor</p>
            <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)" }}>{doctorId?.slice(0, 16)}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ────────────────────────────────────────────────────────────────

function Dashboard({ doctorId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(() => {
    apiFetch(ep.dashboard(doctorId))
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [doctorId]);

  useEffect(() => {
    loadData();
    // ADD THIS: auto-refresh every 30 seconds
    // so new workflow results appear without manual reload
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  if (loading) return <div style={{ padding: "3rem", textAlign: "center" }}><Spinner size={28} /></div>;

  const stats = data ? [
    { label: "Total Skills",        value: data.total_skills,         icon: "ti-brain",            color: "#000" },
    { label: "Published",           value: data.published_skills,     icon: "ti-circle-check",     color: "#2563eb" },
    { label: "Under Review",        value: data.pending_reviews,      icon: "ti-eye",              color: "#d97706" },
    { label: "Draft",               value: data.draft_skills,         icon: "ti-edit",             color: "#6b7280" },
    { label: "Pending Recs",        value: data.pending_recommendations, icon: "ti-bulb",          color: "#7c3aed" },
    { label: "Pending Comparisons", value: data.pending_comparisons,  icon: "ti-git-merge",        color: "#0891b2" },
    { label: "Updated (30d)",       value: data.guidelines_updated_30d, icon: "ti-calendar-stats", color: "#059669" },
    { label: "Skills Impacted (30d)",value: data.skills_impacted_30d, icon: "ti-alert-triangle",   color: "#dc2626" },
  ] : [];

  return (
    <div className="fade-in">
      <div style={{ marginBottom: "24px" }}>
        <p style={{ fontSize: "20px", fontWeight: 700, marginBottom: "4px" }}>Governance Dashboard</p>
        <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
          Knowledge quality oversight for {doctorId}
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: "12px", marginBottom: "28px" }}>
        {stats.map(s => (
          <Card key={s.label}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "8px" }}>
              <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{s.label}</span>
              <i className={`ti ${s.icon}`} style={{ fontSize: "16px", color: s.color }} />
            </div>
            <p style={{ fontSize: "30px", fontWeight: 700, color: "var(--text)", lineHeight: 1 }}>{s.value ?? 0}</p>
          </Card>
        ))}
      </div>

      {data?.by_disease && Object.keys(data.by_disease).length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <Card>
            <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "12px", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-secondary)" }}>By Disease Type</p>
            {Object.entries(data.by_disease).slice(0, 8).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border-light)" }}>
                <span style={{ fontSize: "12px", color: "var(--text)" }}>{k}</span>
                <span style={{ fontSize: "12px", fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </Card>
          <Card>
            <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "12px", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-secondary)" }}>Skill Types</p>
            {Object.entries(data.by_skill_type || {}).map(([k, v]) => (
              <div key={k} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border-light)" }}>
                <span style={{ fontSize: "12px", color: "var(--text)", textTransform: "capitalize" }}>{k}</span>
                <span style={{ fontSize: "12px", fontWeight: 600 }}>{v}</span>
              </div>
            ))}
          </Card>
        </div>
      )}

      {data?.recent_activity?.length > 0 && (
        <div style={{ marginTop: "16px" }}>
          <Card>
            <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "12px", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-secondary)" }}>Recent Activity</p>
            {data.recent_activity.slice(0, 10).map((a, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "10px", padding: "6px 0", borderBottom: "1px solid var(--border-light)" }}>
                <i className="ti ti-activity" style={{ fontSize: "13px", color: "var(--text-tertiary)", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: "12px", color: "var(--text)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    <strong>{a.action}</strong> — {a.change_summary || a.entity_type}
                  </p>
                </div>
                <span style={{ fontSize: "10px", color: "var(--text-tertiary)", flexShrink: 0 }}>{fmt.date(a.created_at)}</span>
              </div>
            ))}
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── SKILLS MODULE ────────────────────────────────────────────────────────────

function SkillsModule({ doctorId }) {
  const [skills, setSkills]   = useState([]);
  const [total, setTotal]     = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage]       = useState(1);
  const [filters, setFilters] = useState({ skill_type: "", disease_type: "", status: "", keyword: "" });
  const [selected, setSelected] = useState(null); // skill_id
  const [view, setView]       = useState("list");  // list | detail
  const [showToast, toastEl]  = useToast();

  const loadSkills = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page, page_size: 20 });
      if (filters.skill_type)   params.set("skill_type", filters.skill_type);
      if (filters.disease_type) params.set("disease_type", filters.disease_type);
      if (filters.status)       params.set("status", filters.status);
      if (filters.keyword)      params.set("keyword", filters.keyword);
      const data = await apiFetch(ep.skills(doctorId, "&" + params.toString()));
      setSkills(data.results || []);
      setTotal(data.total || 0);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [doctorId, page, filters]);

  useEffect(() => { loadSkills(); }, [loadSkills]);

  if (view === "detail" && selected) {
    return (
      <>
        {toastEl}
        <SkillDetail
          skillId={selected}
          doctorId={doctorId}
          onBack={() => { setView("list"); setSelected(null); loadSkills(); }}
          showToast={showToast}
        />
      </>
    );
  }

  return (
    <div className="fade-in">
      {toastEl}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <p style={{ fontSize: "20px", fontWeight: 700, marginBottom: "2px" }}>Skills Library</p>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{total} skills across all types</p>
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "16px" }}>
        <input
          value={filters.keyword}
          onChange={e => { setFilters(f => ({ ...f, keyword: e.target.value })); setPage(1); }}
          placeholder="Search name, keyword, disease..."
          style={{
            flex: "1 1 220px", padding: "8px 12px", fontSize: "12px",
            border: "1px solid var(--border)", borderRadius: "7px",
            background: "var(--surface)", color: "var(--text)", outline: "none",
          }}
        />
        {[
          { key: "skill_type", opts: ["", "diagnosis", "treatment"], labels: ["All types", "Diagnosis", "Treatment"] },
          { key: "status", opts: ["", "draft", "under_review", "approved", "published", "archived", "deprecated"], labels: ["All statuses", "Draft", "Under Review", "Approved", "Published", "Archived", "Deprecated"] },
        ].map(f => (
          <select
            key={f.key}
            value={filters[f.key]}
            onChange={e => { setFilters(prev => ({ ...prev, [f.key]: e.target.value })); setPage(1); }}
            style={{
              padding: "8px 12px", fontSize: "12px", border: "1px solid var(--border)",
              borderRadius: "7px", background: "var(--surface)", color: "var(--text)",
              cursor: "pointer", outline: "none",
            }}
          >
            {f.opts.map((o, i) => <option key={o} value={o}>{f.labels[i]}</option>)}
          </select>
        ))}
        <input
          value={filters.disease_type}
          onChange={e => { setFilters(f => ({ ...f, disease_type: e.target.value })); setPage(1); }}
          placeholder="Disease type..."
          style={{ padding: "8px 12px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "7px", background: "var(--surface)", color: "var(--text)", outline: "none", width: "160px" }}
        />
      </div>

      {loading ? (
        <div style={{ padding: "3rem", textAlign: "center" }}><Spinner size={28} /></div>
      ) : skills.length === 0 ? (
        <EmptyState icon="ti-brain" title="No skills found" sub="Try adjusting your filters or upload a guideline to generate skills." />
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "12px", marginBottom: "16px" }}>
            {skills.map(s => (
              <SkillCard key={s.skill_id} skill={s} onClick={() => { setSelected(s.skill_id); setView("detail"); }} />
            ))}
          </div>
          {/* Pagination */}
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
              Showing {(page - 1) * 20 + 1}–{Math.min(page * 20, total)} of {total}
            </span>
            <div style={{ display: "flex", gap: "6px" }}>
              <Btn variant="ghost" size="sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                <i className="ti ti-chevron-left" /> Prev
              </Btn>
              <Btn variant="ghost" size="sm" disabled={page * 20 >= total} onClick={() => setPage(p => p + 1)}>
                Next <i className="ti ti-chevron-right" />
              </Btn>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function SkillCard({ skill, onClick }) {
  const isDiag = skill.skill_type === "diagnosis";
  return (
    <Card onClick={onClick}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
        <span style={{
          fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px",
          background: isDiag ? "#f0f9ff" : "#fdf4ff", color: isDiag ? "#0369a1" : "#7c3aed",
          border: `1px solid ${isDiag ? "#bae6fd" : "#e9d5ff"}`,
        }}>{isDiag ? "Diagnosis" : "Treatment"}</span>
        <StatusBadge status={skill.status} />
        <span style={{ marginLeft: "auto", fontSize: "10px", color: "var(--text-tertiary)" }}>v{skill.current_version}</span>
      </div>
      <p style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px", color: "var(--text)" }}>{skill.name}</p>
      <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px" }}>{skill.disease_type} {skill.subtype ? `· ${skill.subtype}` : ""}</p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px", marginBottom: "8px" }}>
        {(skill.trigger_keywords || []).slice(0, 5).map(k => (
          <span key={k} style={{ fontSize: "10px", padding: "1px 6px", borderRadius: "3px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-tertiary)" }}>{k}</span>
        ))}
      </div>
      <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>
        Updated {fmt.date(skill.updated_at)}
      </p>
    </Card>
  );
}

// ─── SKILL DETAIL ─────────────────────────────────────────────────────────────

function SkillDetail({ skillId, doctorId, onBack, showToast }) {
  const [skill, setSkill]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState("overview");
  const [versions, setVersions] = useState([]);
  const [audit, setAudit]     = useState([]);
  const [editBody, setEditBody] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving]   = useState(false);
  const [transitioning, setTransitioning] = useState(false);
  const [showRollback, setShowRollback]   = useState(false);
  const [rollbackTarget, setRollbackTarget] = useState("");
  const [rollbackReason, setRollbackReason] = useState("");
  const [compareA, setCompareA] = useState("");
  const [compareB, setCompareB] = useState("");
  const [compareResult, setCompareResult] = useState(null);
  const [comparingVersions, setComparingVersions] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, v, a] = await Promise.all([
        apiFetch(ep.skill(doctorId, skillId)),
        apiFetch(ep.skillVersions(doctorId, skillId)),
        apiFetch(ep.skillAudit(doctorId, skillId)),
      ]);
      setSkill(s);
      setEditBody(JSON.stringify(s.body || {}, null, 2));
      setVersions(v.versions || []);
      setAudit(a.entries || []);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setLoading(false);
    }
  }, [skillId, doctorId]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!editSummary.trim()) { showToast("Change summary is required", "error"); return; }
    let parsed;
    try { parsed = JSON.parse(editBody); } catch { showToast("Invalid JSON in skill body", "error"); return; }
    setSaving(true);
    try {
      await apiFetch(ep.skillUpdate(doctorId, skillId), {
        method: "PUT",
        body: JSON.stringify({ body: parsed, change_summary: editSummary, change_type: "manual_edit" }),
      });
      showToast("Skill updated — moved to Draft");
      setEditSummary("");
      await load();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleTransition = async (action, notes = "") => {
    setTransitioning(true);
    try {
      await apiFetch(ep.skillTransition(doctorId, skillId), {
        method: "POST",
        body: JSON.stringify({ action, notes }),
      });
      showToast(`Skill ${action.replace(/_/g, " ")}`);
      await load();
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setTransitioning(false);
    }
  };

  const handleRollback = async () => {
    if (!rollbackTarget || !rollbackReason.trim()) { showToast("Target version and reason are required", "error"); return; }
    try {
      await apiFetch(ep.skillRollback(doctorId, skillId), {
        method: "POST",
        body: JSON.stringify({ target_version: parseInt(rollbackTarget), reason: rollbackReason }),
      });
      showToast("Rolled back — new draft created");
      setShowRollback(false);
      await load();
    } catch (e) {
      showToast(e.message, "error");
    }
  };

  const handleCompareVersions = async () => {
    if (!compareA || !compareB) { showToast("Select two versions to compare", "error"); return; }
    setComparingVersions(true);
    try {
      const res = await apiFetch(ep.skillCompareV(doctorId, skillId, compareA, compareB));
      setCompareResult(res);
    } catch (e) {
      showToast(e.message, "error");
    } finally {
      setComparingVersions(false);
    }
  };

  if (loading) return <div style={{ padding: "3rem", textAlign: "center" }}><Spinner size={28} /></div>;
  if (!skill)  return <EmptyState icon="ti-alert-circle" title="Skill not found" />;

  const TRANSITIONS = {
    draft:        ["submitted_for_review", "archived"],
    under_review: ["approved", "rejected"],
    approved:     ["published", "archived"],
    published:    ["archived", "deprecated"],
    archived:     ["restored"],
    deprecated:   [],
  };
  const validActions = TRANSITIONS[skill.status] || [];

  const TABS = ["overview", "body", "versions", "audit"];

  return (
    <div className="fade-in">
      {/* Back + Header */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
        <Btn variant="ghost" size="sm" onClick={onBack}><i className="ti ti-arrow-left" /> Skills</Btn>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
            <p style={{ fontSize: "18px", fontWeight: 700 }}>{skill.name}</p>
            <StatusBadge status={skill.status} />
            <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>v{skill.current_version}</span>
          </div>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>
            {skill.disease_type} {skill.subtype ? `· ${skill.subtype}` : ""} · {skill.skill_type}
          </p>
        </div>
        {/* Lifecycle actions */}
        <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", justifyContent: "flex-end" }}>
          {validActions.map(action => {
            const v = {
              submitted_for_review: { label: "Submit for Review", variant: "primary" },
              approved:              { label: "Approve", variant: "success" },
              rejected:              { label: "Reject",  variant: "danger" },
              published:             { label: "Publish", variant: "primary" },
              archived:              { label: "Archive", variant: "ghost" },
              deprecated:            { label: "Deprecate", variant: "danger" },
              restored:              { label: "Restore", variant: "success" },
            }[action] || { label: action, variant: "ghost" };
            return (
              <Btn key={action} variant={v.variant} size="sm" loading={transitioning} onClick={() => handleTransition(action)}>
                {v.label}
              </Btn>
            );
          })}
          {versions.length > 1 && (
            <Btn variant="ghost" size="sm" onClick={() => setShowRollback(true)}>
              <i className="ti ti-history" /> Rollback
            </Btn>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border-light)", marginBottom: "16px" }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} style={{
            padding: "9px 18px", fontSize: "12px", fontWeight: tab === t ? 600 : 400,
            background: "none", border: "none", cursor: "pointer",
            borderBottom: tab === t ? "2px solid #000" : "2px solid transparent",
            color: tab === t ? "#000" : "var(--text-secondary)", marginBottom: "-1px",
            textTransform: "capitalize", letterSpacing: "0.04em",
          }}>{t}</button>
        ))}
      </div>

      {/* ── Overview ── */}
      {tab === "overview" && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
          <Card>
            <Section title="Details" icon="ti-info-circle">
              {[
                ["Type",        skill.skill_type],
                ["Disease",     skill.disease_type],
                ["Subtype",     skill.subtype],
                ["Status",      <StatusBadge status={skill.status} />],
                ["Version",     `v${skill.current_version}`],
                ["Published",   String(skill.is_latest_published)],
                ["Created",     fmt.dateTime(skill.created_at)],
                ["Updated",     fmt.dateTime(skill.updated_at)],
                ["Guideline",   skill.guideline || skill.source_guideline_id || "—"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "5px 0", borderBottom: "1px solid var(--border-light)" }}>
                  <span style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{k}</span>
                  <span style={{ fontSize: "12px", fontWeight: 500, color: "var(--text)" }}>{v}</span>
                </div>
              ))}
            </Section>
          </Card>
          <Card>
            <Section title="Trigger Keywords" icon="ti-tags">
              <div style={{ display: "flex", flexWrap: "wrap", gap: "4px" }}>
                {(skill.trigger_keywords || []).map(k => (
                  <span key={k} style={{ fontSize: "11px", padding: "2px 8px", borderRadius: "4px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>{k}</span>
                ))}
                {!(skill.trigger_keywords?.length) && <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>No keywords</p>}
              </div>
            </Section>
            {skill.confidence && Object.keys(skill.confidence).length > 0 && (
              <Section title="Confidence" icon="ti-chart-bar">
                {Object.entries(skill.confidence).map(([k, v]) => (
                  <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-secondary)" }}>{k}</span>
                    <span style={{ fontSize: "11px", fontWeight: 600 }}>{typeof v === "number" ? `${(v * 100).toFixed(0)}%` : v}</span>
                  </div>
                ))}
              </Section>
            )}
          </Card>
        </div>
      )}

      {/* ── Body Edit ── */}
      {tab === "body" && (
        <div>
          <div style={{ marginBottom: "12px" }}>
            <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "8px" }}>
              Edit the skill body JSON. Any edit creates a new version snapshot and resets status to Draft.
            </p>
            <input
              value={editSummary}
              onChange={e => setEditSummary(e.target.value)}
              placeholder="Change summary (required — describe what you changed and why)"
              style={{
                width: "100%", padding: "9px 12px", fontSize: "12px",
                border: "1px solid var(--border)", borderRadius: "7px",
                background: "var(--surface)", color: "var(--text)", outline: "none", marginBottom: "8px",
              }}
            />
            <JsonEditor value={editBody} onChange={setEditBody} height={480} />
          </div>
          <Btn onClick={handleSave} loading={saving} disabled={!editSummary.trim()}>
            <i className="ti ti-device-floppy" /> Save & Create Version
          </Btn>
        </div>
      )}

      {/* ── Versions ── */}
      {tab === "versions" && (
        <div>
          {/* Compare controls */}
          <Card style={{ marginBottom: "16px" }}>
            <p style={{ fontSize: "12px", fontWeight: 600, marginBottom: "10px" }}>Compare Two Versions</p>
            <div style={{ display: "flex", gap: "8px", alignItems: "center", flexWrap: "wrap" }}>
              {["Version A", "Version B"].map((label, i) => (
                <select
                  key={label}
                  value={i === 0 ? compareA : compareB}
                  onChange={e => i === 0 ? setCompareA(e.target.value) : setCompareB(e.target.value)}
                  style={{ padding: "7px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
                >
                  <option value="">{label}</option>
                  {versions.map(v => <option key={v.version_number} value={v.version_number}>v{v.version_number} — {v.change_type || "edit"}</option>)}
                </select>
              ))}
              <Btn size="sm" onClick={handleCompareVersions} loading={comparingVersions}>
                <i className="ti ti-git-diff" /> Compare
              </Btn>
            </div>
            {compareResult && (
              <div style={{ marginTop: "12px", padding: "12px", background: "var(--surface2)", borderRadius: "6px" }}>
                <p style={{ fontSize: "12px", fontWeight: 600, marginBottom: "8px" }}>
                  {compareResult.changed_fields_count} field(s) changed between v{compareResult.version_a} and v{compareResult.version_b}
                </p>
                {Object.entries(compareResult.changes || {}).map(([field, diff]) => (
                  <div key={field} style={{ marginBottom: "8px", padding: "8px", background: "var(--bg)", border: "1px solid var(--border)", borderRadius: "4px" }}>
                    <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)", marginBottom: "6px" }}>{field}</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                      <div>
                        <span style={{ fontSize: "10px", color: "#dc2626", fontWeight: 600 }}>BEFORE</span>
                        <pre style={{ fontSize: "10px", marginTop: "2px", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{JSON.stringify(diff.old, null, 1)}</pre>
                      </div>
                      <div>
                        <span style={{ fontSize: "10px", color: "#16a34a", fontWeight: 600 }}>AFTER</span>
                        <pre style={{ fontSize: "10px", marginTop: "2px", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>{JSON.stringify(diff.new, null, 1)}</pre>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {versions.length === 0 ? (
            <EmptyState icon="ti-git-branch" title="No version history yet" sub="Versions are created on each edit." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {versions.map(v => (
                <Card key={v.version_id} style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
                  <div style={{
                    width: "32px", height: "32px", borderRadius: "50%", background: "var(--surface2)",
                    border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                  }}>
                    <span style={{ fontSize: "11px", fontWeight: 700 }}>v{v.version_number}</span>
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
                      <StatusBadge status={v.status} />
                      <span style={{ fontSize: "10px", color: "var(--text-tertiary)", background: "var(--surface2)", padding: "1px 6px", borderRadius: "3px" }}>{v.change_type}</span>
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text)", marginBottom: "2px" }}>{v.change_summary}</p>
                    <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>
                      {fmt.dateTime(v.created_at)} {v.created_by ? `· ${v.created_by}` : ""}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Audit ── */}
      {tab === "audit" && (
        <div>
          {audit.length === 0 ? (
            <EmptyState icon="ti-clipboard-list" title="No audit entries" sub="All lifecycle events will appear here." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {audit.map((a, i) => (
                <div key={i} style={{
                  display: "flex", gap: "12px", padding: "10px 14px",
                  background: "var(--surface)", border: "1px solid var(--border-light)", borderRadius: "8px",
                }}>
                  <i className="ti ti-activity" style={{ fontSize: "14px", color: "var(--text-tertiary)", marginTop: "2px", flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "2px" }}>
                      <span style={{ fontSize: "11px", fontWeight: 600, background: "var(--surface2)", padding: "1px 7px", borderRadius: "3px", color: "var(--text)" }}>{a.action}</span>
                      {a.from_status && <><span style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>{a.from_status}</span><i className="ti ti-arrow-right" style={{ fontSize: "10px", color: "var(--text-tertiary)" }} /><span style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>{a.to_status}</span></>}
                    </div>
                    <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{a.change_summary}</p>
                    <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>{fmt.dateTime(a.created_at)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Rollback modal */}
      {showRollback && (
        <Modal title="Rollback Skill" onClose={() => setShowRollback(false)}>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Choose a version to revert to. A new version snapshot will be created and the skill moves to Draft.
          </p>
          <select
            value={rollbackTarget}
            onChange={e => setRollbackTarget(e.target.value)}
            style={{ width: "100%", padding: "8px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", marginBottom: "10px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
          >
            <option value="">— Select target version —</option>
            {versions.map(v => <option key={v.version_number} value={v.version_number}>v{v.version_number} — {v.change_summary?.slice(0, 50)}</option>)}
          </select>
          <input
            value={rollbackReason}
            onChange={e => setRollbackReason(e.target.value)}
            placeholder="Reason for rollback (required)"
            style={{ width: "100%", padding: "8px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", marginBottom: "14px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
          />
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
            <Btn variant="ghost" size="sm" onClick={() => setShowRollback(false)}>Cancel</Btn>
            <Btn variant="danger" size="sm" disabled={!rollbackTarget || !rollbackReason.trim()} onClick={handleRollback}>
              <i className="ti ti-history" /> Rollback
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── GUIDELINES MODULE ────────────────────────────────────────────────────────

function GuidelinesModule({ doctorId, onGoToComparisons }) {
  const [guidelines, setGuidelines] = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showRegister, setShowRegister] = useState(false);
  const [showLink, setShowLink]     = useState(null); // guideline_id
  const [regForm, setRegForm]       = useState({ title: "", organization: "", disease_type: "", specialty: "" });
  const [linkForm, setLinkForm]     = useState({ version: "", doc_id: "", upload_notes: "" });
  const [registering, setRegistering] = useState(false);
  const [linking, setLinking]       = useState(false);
  const [selected, setSelected]     = useState(null);
  const [versions, setVersions]     = useState([]);
  const [versLoading, setVersLoading] = useState(false);
  const [showToast, toastEl]        = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch(ep.guidelinesList(doctorId));
      setGuidelines(data.guidelines || []);
    } catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }, [doctorId]);

  useEffect(() => { load(); }, [load]);

  const loadVersions = async (gid) => {
    setVersLoading(true);
    setSelected(gid);
    try {
      const data = await apiFetch(ep.guidelineVersions(doctorId, gid));
      setVersions(data.versions || []);
    } catch (e) { showToast(e.message, "error"); }
    finally { setVersLoading(false); }
  };

  const handleRegister = async () => {
    if (!regForm.title.trim()) { showToast("Title is required", "error"); return; }
    setRegistering(true);
    try {
      await apiFetch(ep.guidelinesRegister(doctorId), {
        method: "POST",
        body: JSON.stringify(regForm),
      });
      showToast("Guideline registered");
      setShowRegister(false);
      setRegForm({ title: "", organization: "", disease_type: "", specialty: "" });
      await load();
    } catch (e) { showToast(e.message, "error"); }
    finally { setRegistering(false); }
  };

  const handleLink = async () => {
    if (!linkForm.version.trim() || !linkForm.doc_id.trim()) { showToast("Version and Doc ID are required", "error"); return; }
    setLinking(true);
    try {
      await apiFetch(ep.guidelineLinkVer(doctorId), {
        method: "POST",
        body: JSON.stringify({ guideline_id: showLink, ...linkForm }),
      });
      showToast("Version linked successfully");
      setShowLink(null);
      setLinkForm({ version: "", doc_id: "", upload_notes: "" });
      if (selected === showLink) loadVersions(showLink);
    } catch (e) { showToast(e.message, "error"); }
    finally { setLinking(false); }
  };

  return (
    <div className="fade-in">
      {toastEl}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <p style={{ fontSize: "20px", fontWeight: 700, marginBottom: "2px" }}>Guidelines</p>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>{guidelines.length} guideline families registered</p>
        </div>
        <Btn onClick={() => setShowRegister(true)}>
          <i className="ti ti-plus" /> Register Guideline
        </Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        {/* List */}
        <div>
          {loading ? (
            <div style={{ padding: "2rem", textAlign: "center" }}><Spinner /></div>
          ) : guidelines.length === 0 ? (
            <EmptyState icon="ti-book-2" title="No guidelines registered" sub="Guidelines are registered automatically when you upload a document through the pipeline. You can also register one manually." />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {guidelines.map(g => (
                <Card
                  key={g.guideline_id}
                  onClick={() => loadVersions(g.guideline_id)}
                  style={{ borderLeft: selected === g.guideline_id ? "3px solid #000" : undefined }}
                >
                  <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: "13px", fontWeight: 600, marginBottom: "3px" }}>{g.title}</p>
                      <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "6px" }}>
                        {g.organization} {g.disease_type ? `· ${g.disease_type}` : ""}
                      </p>
                      <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                        {g.current_version && (
                          <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "3px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
                            Latest: v{g.current_version}
                          </span>
                        )}
                        <span style={{ fontSize: "10px", padding: "1px 7px", borderRadius: "3px", background: "var(--surface2)", border: "1px solid var(--border)", color: "var(--text-secondary)", textTransform: "capitalize" }}>
                          {g.status}
                        </span>
                      </div>
                    </div>
                    <Btn size="sm" variant="ghost" onClick={e => { e.stopPropagation(); setShowLink(g.guideline_id); }}>
                      <i className="ti ti-link" /> Link Version
                    </Btn>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {/* Version panel */}
        <div>
          {selected ? (
            <Card>
              <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "12px", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
                Version History
              </p>
              {versLoading ? (
                <div style={{ textAlign: "center", padding: "1.5rem" }}><Spinner /></div>
              ) : versions.length === 0 ? (
                <p style={{ fontSize: "12px", color: "var(--text-tertiary)" }}>No versions linked yet.</p>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {versions.map(v => (
                    <div key={v.version_record_id} style={{
                      padding: "10px 12px", background: "var(--surface)", border: "1px solid var(--border-light)", borderRadius: "7px",
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "4px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>v{v.version}</span>
                        <span style={{
                          fontSize: "10px", fontWeight: 600, padding: "1px 7px", borderRadius: "3px",
                          background: v.gov_status === "published" ? "#eff6ff" : "var(--surface2)",
                          color: v.gov_status === "published" ? "#2563eb" : "var(--text-secondary)",
                          border: `1px solid ${v.gov_status === "published" ? "#bfdbfe" : "var(--border)"}`,
                          textTransform: "capitalize",
                        }}>{v.gov_status}</span>
                      </div>
                      <p style={{ fontSize: "10px", color: "var(--text-tertiary)", marginBottom: "4px" }}>
                        doc_id: <code style={{ fontSize: "10px", background: "var(--surface2)", padding: "0 4px", borderRadius: "3px" }}>{v.doc_id?.slice(0, 16)}...</code>
                      </p>
                      <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>
                        {fmt.date(v.created_at)} · {v.skill_ids?.length ?? 0} skills
                      </p>
                      {v.upload_notes && <p style={{ fontSize: "10px", color: "var(--text-secondary)", marginTop: "4px" }}>{v.upload_notes}</p>}
                      <div style={{ marginTop: "8px" }}>
                        <Btn size="sm" variant="ghost" onClick={() => onGoToComparisons(selected, v.doc_id)}>
                          <i className="ti ti-git-compare" /> Compare
                        </Btn>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          ) : (
            <Card style={{ padding: "2rem", textAlign: "center" }}>
              <i className="ti ti-book-2" style={{ fontSize: "28px", color: "var(--text-tertiary)", display: "block", marginBottom: "8px" }} />
              <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Select a guideline to view its versions</p>
            </Card>
          )}
        </div>
      </div>

      {/* Register modal */}
      {showRegister && (
        <Modal title="Register Guideline Family" onClose={() => setShowRegister(false)}>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Register a guideline family (e.g. "NCCN Breast Cancer Guidelines") to track multiple versions.
          </p>
          {[
            { key: "title", label: "Title *", placeholder: "e.g. NCCN Breast Cancer Guidelines 2024" },
            { key: "organization", label: "Organization", placeholder: "e.g. NCCN, ASCO, ESMO" },
            { key: "disease_type", label: "Disease Type", placeholder: "e.g. Breast Cancer" },
            { key: "specialty", label: "Specialty", placeholder: "e.g. Oncology" },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: "10px" }}>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{f.label}</label>
              <input
                value={regForm[f.key]}
                onChange={e => setRegForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{ width: "100%", padding: "8px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" }}>
            <Btn variant="ghost" size="sm" onClick={() => setShowRegister(false)}>Cancel</Btn>
            <Btn loading={registering} onClick={handleRegister} disabled={!regForm.title.trim()}>Register</Btn>
          </div>
        </Modal>
      )}

      {/* Link version modal */}
      {showLink && (
        <Modal title="Link Guideline Version" onClose={() => setShowLink(null)}>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "12px" }}>
            Link a Phase-1 processed document to this guideline as a specific version.
          </p>
          {[
            { key: "version", label: "Version *", placeholder: "e.g. 2024.1" },
            { key: "doc_id", label: "Doc ID * (from Phase-1 pipeline)", placeholder: "Paste the doc_id from Phase-1 upload" },
            { key: "upload_notes", label: "Notes", placeholder: "Optional notes" },
          ].map(f => (
            <div key={f.key} style={{ marginBottom: "10px" }}>
              <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>{f.label}</label>
              <input
                value={linkForm[f.key]}
                onChange={e => setLinkForm(p => ({ ...p, [f.key]: e.target.value }))}
                placeholder={f.placeholder}
                style={{ width: "100%", padding: "8px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
              />
            </div>
          ))}
          <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end", marginTop: "16px" }}>
            <Btn variant="ghost" size="sm" onClick={() => setShowLink(null)}>Cancel</Btn>
            <Btn loading={linking} onClick={handleLink} disabled={!linkForm.version.trim() || !linkForm.doc_id.trim()}>
              <i className="ti ti-link" /> Link Version
            </Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── COMPARISONS MODULE ───────────────────────────────────────────────────────

function ComparisonsModule({ doctorId, initialGuidelineId = "", initialDocId = "" }) {
  const [guidelines, setGuidelines]     = useState([]);
  const [selectedGid, setSelectedGid]   = useState(initialGuidelineId);
  const [versions, setVersions]         = useState([]);
  const [oldDocId, setOldDocId]         = useState("");
  const [newDocId, setNewDocId]         = useState(initialDocId);
  const [comparing, setComparing]       = useState(false);
  const [comparison, setComparison]     = useState(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [impact, setImpact]             = useState(null);
  const [recLoading, setRecLoading]     = useState(false);
  const [applying, setApplying]         = useState(false);
  const [changeFilter, setChangeFilter] = useState("");
  const [showToast, toastEl]            = useToast();

  useEffect(() => {
    apiFetch(ep.guidelinesList(doctorId)).then(d => setGuidelines(d.guidelines || [])).catch(() => {});
  }, [doctorId]);

  useEffect(() => {
    if (!selectedGid) return;
    apiFetch(ep.guidelineVersions(doctorId, selectedGid)).then(d => setVersions(d.versions || [])).catch(() => {});
  }, [selectedGid, doctorId]);

  const handleCompare = async () => {
    if (!selectedGid || !oldDocId || !newDocId) { showToast("Select guideline and both versions", "error"); return; }
    setComparing(true);
    setComparison(null);
    setImpact(null);
    try {
      const res = await apiFetch(ep.guidelineCompare(doctorId), {
        method: "POST",
        body: JSON.stringify({ guideline_id: selectedGid, old_doc_id: oldDocId, new_doc_id: newDocId }),
      });
      setComparison(res);
      showToast(`Comparison complete — ${res.total_changes} changes found`);
    } catch (e) { showToast(e.message, "error"); }
    finally { setComparing(false); }
  };

  const handleImpact = async () => {
    setImpactLoading(true);
    try {
      const res = await apiFetch(ep.comparisonImpact(doctorId, comparison.comparison_id), { method: "POST" });
      setImpact(res);
      showToast(`Impact analysis complete — ${res.total_affected} skills affected`);
    } catch (e) { showToast(e.message, "error"); }
    finally { setImpactLoading(false); }
  };

  const handleRecommend = async () => {
    setRecLoading(true);
    try {
      const res = await apiFetch(ep.comparisonRecommend(doctorId, comparison.comparison_id), { method: "POST" });
      showToast(`${res.generated} AI recommendations generated`);
    } catch (e) { showToast(e.message, "error"); }
    finally { setRecLoading(false); }
  };

  const handleApply = async () => {
    setApplying(true);
    try {
      const res = await apiFetch(ep.comparisonApply(doctorId, comparison.comparison_id), { method: "POST" });
      showToast(`Applied updates to ${res.applied} skills`);
    } catch (e) { showToast(e.message, "error"); }
    finally { setApplying(false); }
  };

  const filteredChanges = (comparison?.changes || []).filter(c =>
    !changeFilter || c.section?.includes(changeFilter) || c.change_type?.includes(changeFilter)
  );

  return (
    <div className="fade-in">
      {toastEl}
      <p style={{ fontSize: "20px", fontWeight: 700, marginBottom: "4px" }}>Guideline Comparison</p>
      <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "20px" }}>
        Compare two versions of a guideline to detect clinical changes and impact on skills
      </p>

      {/* Setup card */}
      <Card style={{ marginBottom: "20px" }}>
        <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "12px", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
          Configure Comparison
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "10px", marginBottom: "12px", flexWrap: "wrap" }}>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>Guideline Family</label>
            <select
              value={selectedGid}
              onChange={e => { setSelectedGid(e.target.value); setOldDocId(""); setNewDocId(""); }}
              style={{ width: "100%", padding: "8px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
            >
              <option value="">— Select guideline —</option>
              {guidelines.map(g => <option key={g.guideline_id} value={g.guideline_id}>{g.title}</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>Old Version (Base)</label>
            <select
              value={oldDocId}
              onChange={e => setOldDocId(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
            >
              <option value="">— Select old version —</option>
              {versions.map(v => <option key={v.doc_id} value={v.doc_id}>v{v.version} — {v.doc_id?.slice(0, 12)}…</option>)}
            </select>
          </div>
          <div>
            <label style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", display: "block", marginBottom: "4px" }}>New Version (Updated)</label>
            <select
              value={newDocId}
              onChange={e => setNewDocId(e.target.value)}
              style={{ width: "100%", padding: "8px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
            >
              <option value="">— Select new version —</option>
              {versions.map(v => <option key={v.doc_id} value={v.doc_id}>v{v.version} — {v.doc_id?.slice(0, 12)}…</option>)}
            </select>
          </div>
        </div>
        <Btn onClick={handleCompare} loading={comparing} disabled={!selectedGid || !oldDocId || !newDocId}>
          <i className="ti ti-git-merge" /> Run Comparison
        </Btn>
      </Card>

      {/* Comparison results */}
      {comparison && (
        <>
          {/* Summary strip */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: "10px", marginBottom: "16px" }}>
            {[
              { label: "Total Changes",  value: comparison.total_changes,  icon: "ti-git-diff",    color: "#000" },
              { label: "Additions",      value: comparison.additions,      icon: "ti-plus",        color: "#16a34a" },
              { label: "Removals",       value: comparison.removals,       icon: "ti-minus",       color: "#dc2626" },
              { label: "Modifications",  value: comparison.modifications,  icon: "ti-edit",        color: "#d97706" },
              { label: "Affected Skills",value: comparison.affected_skill_ids?.length ?? 0, icon: "ti-brain", color: "#7c3aed" },
            ].map(s => (
              <Card key={s.label} style={{ textAlign: "center" }}>
                <i className={`ti ${s.icon}`} style={{ fontSize: "20px", color: s.color, display: "block", marginBottom: "4px" }} />
                <p style={{ fontSize: "22px", fontWeight: 700, color: "var(--text)" }}>{s.value}</p>
                <p style={{ fontSize: "10px", color: "var(--text-tertiary)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{s.label}</p>
              </Card>
            ))}
          </div>

          {/* Actions */}
          <div style={{ display: "flex", gap: "8px", marginBottom: "16px", flexWrap: "wrap" }}>
            <Btn onClick={handleImpact} loading={impactLoading} disabled={!!impact} variant={impact ? "ghost" : "primary"}>
              <i className="ti ti-target" /> {impact ? "Impact Analysed ✓" : "Run Impact Analysis"}
            </Btn>
            {impact && (
              <Btn onClick={handleRecommend} loading={recLoading}>
                <i className="ti ti-bulb" /> Generate AI Recommendations
              </Btn>
            )}
            {impact && (
              <Btn onClick={handleApply} loading={applying} variant="success">
                <i className="ti ti-check" /> Apply Accepted Recommendations
              </Btn>
            )}
          </div>

          {/* Impact summary */}
          {impact && (
            <Card style={{ marginBottom: "16px" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, marginBottom: "12px", letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
                Impact Analysis — {impact.total_affected} Skills Affected
              </p>
              <div style={{ display: "flex", gap: "8px", marginBottom: "12px", flexWrap: "wrap" }}>
                {[
                  { label: "Critical", count: impact.critical_count, sev: "critical" },
                  { label: "High",     count: impact.high_count,     sev: "high" },
                  { label: "Medium",   count: impact.medium_count,   sev: "medium" },
                  { label: "Low",      count: impact.low_count,      sev: "low" },
                ].map(s => (
                  <div key={s.label} style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <SevBadge severity={s.sev} />
                    <span style={{ fontSize: "12px", fontWeight: 600 }}>{s.count}</span>
                  </div>
                ))}
                {impact.graph_matching_used && (
                  <span style={{ fontSize: "10px", color: "#2563eb", background: "#eff6ff", border: "1px solid #bfdbfe", padding: "1px 8px", borderRadius: "4px" }}>
                    Graph matching used
                  </span>
                )}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "260px", overflowY: "auto" }}>
                {(impact.affected_skills || []).map((s, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "10px", padding: "8px 10px", background: "var(--surface)", borderRadius: "6px", border: "1px solid var(--border-light)" }}>
                    <SevBadge severity={s.severity} />
                    <div style={{ flex: 1 }}>
                      <p style={{ fontSize: "12px", fontWeight: 600, marginBottom: "2px" }}>{s.skill_name || s.skill_id}</p>
                      <p style={{ fontSize: "10px", color: "var(--text-secondary)" }}>{s.skill_type} · {s.disease_type} {s.subtype ? `· ${s.subtype}` : ""}</p>
                      <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>Sections: {s.impact_sections?.join(", ")}</p>
                      {s.matched_biomarkers?.length > 0 && <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>Biomarkers: {s.matched_biomarkers.join(", ")}</p>}
                    </div>
                    <span style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>{(s.match_confidence * 100).toFixed(0)}% match</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* Changes list */}
          <Card>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
              <p style={{ fontSize: "12px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--text-secondary)" }}>
                All Changes ({filteredChanges.length})
              </p>
              <input
                value={changeFilter}
                onChange={e => setChangeFilter(e.target.value)}
                placeholder="Filter by section..."
                style={{ padding: "5px 10px", fontSize: "11px", border: "1px solid var(--border)", borderRadius: "5px", background: "var(--surface)", color: "var(--text)", outline: "none", width: "180px" }}
              />
            </div>
            <div style={{ maxHeight: "400px", overflowY: "auto", display: "flex", flexDirection: "column", gap: "6px" }}>
              {filteredChanges.map((c, i) => (
                <ChangeRow key={i} change={c} />
              ))}
              {filteredChanges.length === 0 && (
                <p style={{ fontSize: "12px", color: "var(--text-tertiary)", padding: "12px", textAlign: "center" }}>No changes match filter</p>
              )}
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function ChangeRow({ change }) {
  const [open, setOpen] = useState(false);
  const ct = { addition: { color: "#16a34a", icon: "ti-plus", bg: "#f0fdf4" }, removal: { color: "#dc2626", icon: "ti-minus", bg: "#fef2f2" }, modification: { color: "#d97706", icon: "ti-edit", bg: "#fffbeb" } }[change.change_type] || {};
  return (
    <div style={{ border: "1px solid var(--border-light)", borderRadius: "6px", overflow: "hidden" }}>
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: "flex", alignItems: "center", gap: "8px", padding: "8px 10px", cursor: "pointer", background: ct.bg || "var(--surface)" }}
      >
        <i className={`ti ${ct.icon}`} style={{ fontSize: "12px", color: ct.color, flexShrink: 0 }} />
        <span style={{ fontSize: "11px", fontWeight: 600, color: "var(--text)", flex: 1 }}>{change.section} {change.field_path ? `→ ${change.field_path}` : ""}</span>
        <SevBadge severity={change.severity} />
        <i className={`ti ti-chevron-${open ? "up" : "down"}`} style={{ fontSize: "12px", color: "var(--text-tertiary)" }} />
      </div>
      {open && (
        <div style={{ padding: "10px", background: "var(--bg)", borderTop: "1px solid var(--border-light)" }}>
          <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginBottom: "8px" }}>{change.description}</p>
          {change.evidence_level_change && (
            <p style={{ fontSize: "10px", color: "#7c3aed", marginBottom: "4px" }}>Evidence: {change.evidence_level_change}</p>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            {change.old_value != null && (
              <div>
                <span style={{ fontSize: "10px", color: "#dc2626", fontWeight: 600, display: "block", marginBottom: "2px" }}>REMOVED</span>
                <pre style={{ fontSize: "10px", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#fef2f2", padding: "6px", borderRadius: "4px" }}>
                  {typeof change.old_value === "string" ? change.old_value : JSON.stringify(change.old_value, null, 1)}
                </pre>
              </div>
            )}
            {change.new_value != null && (
              <div>
                <span style={{ fontSize: "10px", color: "#16a34a", fontWeight: 600, display: "block", marginBottom: "2px" }}>ADDED</span>
                <pre style={{ fontSize: "10px", color: "var(--text-secondary)", whiteSpace: "pre-wrap", wordBreak: "break-all", background: "#f0fdf4", padding: "6px", borderRadius: "4px" }}>
                  {typeof change.new_value === "string" ? change.new_value : JSON.stringify(change.new_value, null, 1)}
                </pre>
              </div>
            )}
          </div>
          {(change.biomarkers?.length > 0 || change.stages?.length > 0) && (
            <div style={{ marginTop: "6px", display: "flex", gap: "6px", flexWrap: "wrap" }}>
              {change.biomarkers?.map(b => <span key={b} style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "3px", background: "#fdf4ff", color: "#7c3aed", border: "1px solid #e9d5ff" }}>{b}</span>)}
              {change.stages?.map(s => <span key={s} style={{ fontSize: "9px", padding: "1px 6px", borderRadius: "3px", background: "#eff6ff", color: "#2563eb", border: "1px solid #bfdbfe" }}>{s}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── RECOMMENDATIONS MODULE ───────────────────────────────────────────────────

function RecommendationsModule({ doctorId }) {
  const [recs, setRecs]           = useState([]);
  const [loading, setLoading]     = useState(true);
  const [statusFilter, setFilter] = useState("pending");
  const [reviewing, setReviewing] = useState({});
  const [notes, setNotes]         = useState({});
  const [showToast, toastEl]      = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = statusFilter ? `&status=${statusFilter}` : "";
      const data = await apiFetch(ep.recommendations(doctorId, params));
      setRecs(data.recommendations || []);
    } catch (e) { showToast(e.message, "error"); }
    finally { setLoading(false); }
  }, [doctorId, statusFilter]);



  useEffect(() => {
    load();
    // ADD THIS: poll every 20 seconds when on pending filter
    // since recommendations arrive async from the Celery worker
    if (statusFilter === "pending") {
      const interval = setInterval(load, 20000);
      return () => clearInterval(interval);
    }
  }, [load, statusFilter]);

  const handleReview = async (recId, action) => {
    setReviewing(r => ({ ...r, [recId]: true }));
    try {
      await apiFetch(ep.recReview(doctorId), {
        method: "POST",
        body: JSON.stringify({ recommendation_id: recId, action, doctor_notes: notes[recId] || "" }),
      });
      showToast(`Recommendation ${action}`);
      await load();
    } catch (e) { showToast(e.message, "error"); }
    finally { setReviewing(r => ({ ...r, [recId]: false })); }
  };

  const handleBulkAccept = async () => {
    const pendingIds = recs.filter(r => r.status === "pending").map(r => r.recommendation_id);
    if (!pendingIds.length) return;
    try {
      await apiFetch(ep.recBulkReview(doctorId), {
        method: "POST",
        body: JSON.stringify({ reviews: pendingIds.map(id => ({ recommendation_id: id, action: "accepted", doctor_notes: "" })) }),
      });
      showToast(`Bulk accepted ${pendingIds.length} recommendations`);
      await load();
    } catch (e) { showToast(e.message, "error"); }
  };

  return (
    <div className="fade-in">
      {toastEl}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <p style={{ fontSize: "20px", fontWeight: 700, marginBottom: "2px" }}>AI Recommendations</p>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)" }}>Review AI-generated skill update suggestions from guideline comparisons</p>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <select
            value={statusFilter}
            onChange={e => setFilter(e.target.value)}
            style={{ padding: "8px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
          >
            {["", "pending", "accepted", "rejected", "modified"].map(s => (
              <option key={s} value={s}>{s ? s.charAt(0).toUpperCase() + s.slice(1) : "All statuses"}</option>
            ))}
          </select>
          {recs.some(r => r.status === "pending") && (
            <Btn size="sm" variant="success" onClick={handleBulkAccept}>
              <i className="ti ti-check-all" /> Accept All Pending
            </Btn>
          )}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: "3rem", textAlign: "center" }}><Spinner size={28} /></div>
      ) : recs.length === 0 ? (
        <EmptyState
          icon="ti-bulb"
          title="No recommendations"
          sub={statusFilter === "pending" ? "No pending recommendations yet. Recommendations are generated automatically when a new guideline version is uploaded." : "No recommendations with this status."}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          {recs.map(rec => (
            <RecCard
              key={rec.recommendation_id}
              rec={rec}
              reviewing={reviewing[rec.recommendation_id]}
              note={notes[rec.recommendation_id] || ""}
              onNoteChange={v => setNotes(n => ({ ...n, [rec.recommendation_id]: v }))}
              onReview={action => handleReview(rec.recommendation_id, action)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function RecCard({ rec, reviewing, note, onNoteChange, onReview }) {
  const [open, setOpen] = useState(false);
  const confPct = Math.round((rec.confidence || 0) * 100);
  const confColor = confPct >= 75 ? "#16a34a" : confPct >= 50 ? "#d97706" : "#dc2626";
  const STATUS_COLOR = {
    pending:  { bg: "#fffbeb", color: "#d97706", border: "#fde68a" },
    accepted: { bg: "#f0fdf4", color: "#16a34a", border: "#bbf7d0" },
    rejected: { bg: "#fef2f2", color: "#dc2626", border: "#fecaca" },
    modified: { bg: "#eff6ff", color: "#2563eb", border: "#bfdbfe" },
  }[rec.status] || {};

  return (
    <Card style={{ borderLeft: rec.status === "pending" ? "3px solid #d97706" : undefined }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: "12px" }}>
        <div style={{ flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "6px", flexWrap: "wrap" }}>
            <span style={{ fontSize: "10px", fontWeight: 600, padding: "2px 8px", borderRadius: "4px", background: STATUS_COLOR.bg, color: STATUS_COLOR.color, border: `1px solid ${STATUS_COLOR.border}`, textTransform: "capitalize" }}>
              {rec.status}
            </span>
            <span style={{ fontSize: "10px", background: "var(--surface2)", padding: "2px 8px", borderRadius: "4px", border: "1px solid var(--border)", color: "var(--text-secondary)" }}>
              {rec.skill_type} · {rec.section_to_update}
            </span>
            <span style={{ fontSize: "10px", fontWeight: 600, color: confColor }}>
              {confPct}% confidence
            </span>
          </div>
          <p style={{ fontSize: "13px", fontWeight: 600, marginBottom: "4px" }}>{rec.skill_name}</p>
          <p style={{ fontSize: "12px", color: "var(--text-secondary)", marginBottom: "6px" }}>{rec.recommendation_text}</p>
          <p style={{ fontSize: "10px", color: "var(--text-tertiary)" }}>{fmt.date(rec.created_at)}</p>
        </div>
        <button onClick={() => setOpen(o => !o)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary)", padding: "4px", flexShrink: 0 }}>
          <i className={`ti ti-chevron-${open ? "up" : "down"}`} style={{ fontSize: "16px" }} />
        </button>
      </div>

      {open && (
        <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid var(--border-light)" }}>
          {rec.reasoning && (
            <div style={{ marginBottom: "10px" }}>
              <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>Clinical Reasoning</p>
              <p style={{ fontSize: "12px", color: "var(--text)", lineHeight: 1.6 }}>{rec.reasoning}</p>
            </div>
          )}
          {rec.recommended_value != null && (
            <div style={{ marginBottom: "10px" }}>
              <p style={{ fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", marginBottom: "4px" }}>Recommended Value</p>
              <pre style={{ fontSize: "11px", color: "var(--text-secondary)", background: "var(--surface2)", padding: "8px", borderRadius: "6px", whiteSpace: "pre-wrap", wordBreak: "break-all" }}>
                {typeof rec.recommended_value === "string" ? rec.recommended_value : JSON.stringify(rec.recommended_value, null, 2)}
              </pre>
            </div>
          )}
          {rec.status === "pending" && (
            <div style={{ marginTop: "12px" }}>
              <input
                value={note}
                onChange={e => onNoteChange(e.target.value)}
                placeholder="Add review note (optional)..."
                style={{ width: "100%", padding: "7px 10px", fontSize: "12px", border: "1px solid var(--border)", borderRadius: "6px", marginBottom: "8px", background: "var(--surface)", color: "var(--text)", outline: "none" }}
              />
              <div style={{ display: "flex", gap: "6px" }}>
                <Btn size="sm" variant="success" loading={reviewing} onClick={() => onReview("accepted")}>
                  <i className="ti ti-check" /> Accept
                </Btn>
                <Btn size="sm" variant="danger" loading={reviewing} onClick={() => onReview("rejected")}>
                  <i className="ti ti-x" /> Reject
                </Btn>
                <Btn size="sm" variant="ghost" loading={reviewing} onClick={() => onReview("modified")}>
                  <i className="ti ti-edit" /> Accept (Modified)
                </Btn>
              </div>
            </div>
          )}
          {rec.doctor_notes && (
            <p style={{ fontSize: "11px", color: "var(--text-secondary)", marginTop: "8px", fontStyle: "italic" }}>
              Note: {rec.doctor_notes}
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

// ─── MAIN SHELL ───────────────────────────────────────────────────────────────

export default function Phase3Governance() {
  const doctorId = getDoctorId();
  const [activeNav, setActiveNav] = useState("dashboard");
  const [compGuidelineId, setCompGuidelineId] = useState("");
  const [compDocId, setCompDocId]             = useState("");

  if (!doctorId) {
    return (
      <>
        <FontStyle />
        <div style={{ padding: "2rem", fontFamily: "var(--font-sans)" }}>
          <div style={{ padding: "14px 18px", background: "#fef2f2", color: "#dc2626", border: "1px solid #fecaca", borderRadius: "8px", fontSize: "13px" }}>
            Missing doctor_id URL parameter.
          </div>
        </div>
      </>
    );
  }

  const goToComparisons = (guidelineId, docId) => {
    setCompGuidelineId(guidelineId);
    setCompDocId(docId);
    setActiveNav("comparisons");
  };

  return (
    <>
      <FontStyle />
      <div style={{ fontFamily: "var(--font-sans)", background: "var(--bg)", minHeight: "100vh" }}>

        {/* ── Internal tab bar — sits inside your product's existing layout ── */}
        <div style={{
          display: "flex", alignItems: "center", gap: "2px",
          borderBottom: "1px solid var(--border-light)",
          padding: "0 2rem",
          background: "var(--surface)",
          overflowX: "auto",
        }}>
          {NAV_ITEMS.map(n => (
            <button
              key={n.id}
              onClick={() => setActiveNav(n.id)}
              style={{
                padding: "12px 16px", fontSize: "12px", fontWeight: activeNav === n.id ? 600 : 400,
                background: "none", border: "none", cursor: "pointer",
                borderBottom: activeNav === n.id ? "2px solid #000" : "2px solid transparent",
                color: activeNav === n.id ? "#000" : "var(--text-secondary)",
                display: "flex", alignItems: "center", gap: "6px",
                whiteSpace: "nowrap", transition: "all 0.15s",
                marginBottom: "-1px",
              }}
            >
              <i className={`ti ${n.icon}`} style={{ fontSize: "13px" }} />
              {n.label}
            </button>
          ))}
        </div>

        {/* ── Page content ── */}
        <div style={{ padding: "2rem" }}>
          {activeNav === "dashboard"       && <Dashboard doctorId={doctorId} />}
          {activeNav === "skills"          && <SkillsModule doctorId={doctorId} />}
          {activeNav === "guidelines"      && <GuidelinesModule doctorId={doctorId} onGoToComparisons={goToComparisons} />}
          {activeNav === "comparisons"     && <ComparisonsModule doctorId={doctorId} initialGuidelineId={compGuidelineId} initialDocId={compDocId} />}
          {activeNav === "recommendations" && <RecommendationsModule doctorId={doctorId} />}
        </div>

      </div>
    </>
  );
}