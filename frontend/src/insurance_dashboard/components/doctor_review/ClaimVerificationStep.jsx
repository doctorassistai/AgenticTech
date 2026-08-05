// ClaimVerificationStep.jsx
// Step 1: Doctor verifies all claim details field by field

import { useState } from "react";

const CATEGORY_META = {
  identity:  { label: "Identity",    icon: "👤", color: "#1D4ED8", bg: "#EFF6FF", border: "#BFDBFE" },
  policy:    { label: "Policy",      icon: "📋", color: "#0F766E", bg: "#F0FDFA", border: "#99F6E4" },
  claim:     { label: "Claim",       icon: "📄", color: "#7C3AED", bg: "#FAF5FF", border: "#DDD6FE" },
  hospital:  { label: "Hospital",    icon: "🏥", color: "#BE185D", bg: "#FDF2F8", border: "#FBCFE8" },
  accident:  { label: "Accident",    icon: "⚠️",  color: "#C2410C", bg: "#FFF7ED", border: "#FED7AA" },
  death:     { label: "Death",       icon: "📌", color: "#374151", bg: "#F9FAFB", border: "#E5E7EB" },
  financial: { label: "Financial",   icon: "💰", color: "#15803D", bg: "#F0FDF4", border: "#BBF7D0" },
};

const PRIORITY_COLOR = {
  Critical: "#DC2626", High: "#EA580C", Urgent: "#BE185D", Normal: "#6B7280",
};

function FieldVerifyRow({ field, value, onToggle }) {
  const isVerified = value === true;
  const isRejected = value === false;

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 16px",
      borderBottom: "1px solid #F1F5F9",
      background: isVerified ? "#F0FDF4" : isRejected ? "#FFF5F5" : "#fff",
      transition: "background 0.2s",
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 2 }}>
          {field.label}
        </div>
        <div style={{ fontSize: 13, color: "#1E293B", wordBreak: "break-word", lineHeight: 1.5 }}>
          {field.value || <span style={{ color: "#CBD5E1", fontStyle: "italic" }}>—</span>}
        </div>
      </div>

      {/* Tick / Cross toggle */}
      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
        {/* Tick */}
        <button
          onClick={() => onToggle(field.key, "field", isVerified ? null : true)}
          title="Verify"
          style={{
            width: 32, height: 32, borderRadius: 8, border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: isVerified ? "#16A34A" : "#F1F5F9",
            color: isVerified ? "#fff" : "#94A3B8",
            transition: "all 0.15s",
            boxShadow: isVerified ? "0 2px 8px rgba(22,163,74,0.3)" : "none",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <polyline points="20,6 9,17 4,12"/>
          </svg>
        </button>
        {/* Cross */}
        <button
          onClick={() => onToggle(field.key, "field", isRejected ? null : false)}
          title="Dispute"
          style={{
            width: 32, height: 32, borderRadius: 8, border: "none", cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: isRejected ? "#DC2626" : "#F1F5F9",
            color: isRejected ? "#fff" : "#94A3B8",
            transition: "all 0.15s",
            boxShadow: isRejected ? "0 2px 8px rgba(220,38,38,0.3)" : "none",
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
    </div>
  );
}

function CategorySection({ cat, fields, verifState, onToggle }) {
  const [open, setOpen] = useState(true);
  const meta = CATEGORY_META[cat] || { label: cat, icon: "📌", color: "#374151", bg: "#F9FAFB", border: "#E5E7EB" };
  const verified = fields.filter(f => verifState.fields?.[f.key] === true).length;
  const disputed = fields.filter(f => verifState.fields?.[f.key] === false).length;
  const reviewed = verified + disputed;

  return (
    <div style={{
      marginBottom: 10,
      border: `1px solid ${meta.border}`,
      borderRadius: 12,
      overflow: "hidden",
      boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
    }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 10,
          padding: "11px 16px", background: meta.bg, border: "none",
          cursor: "pointer", textAlign: "left",
        }}
      >
        <span style={{ fontSize: 17 }}>{meta.icon}</span>
        <span style={{ flex: 1, fontSize: 12, fontWeight: 700, color: meta.color }}>{meta.label}</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {verified > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "#DCFCE7", color: "#166534" }}>✓ {verified}</span>
          )}
          {disputed > 0 && (
            <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 99, background: "#FEE2E2", color: "#991B1B" }}>✗ {disputed}</span>
          )}
          <span style={{ fontSize: 10, color: "#94A3B8" }}>{reviewed}/{fields.length}</span>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={meta.color} strokeWidth="2.5" strokeLinecap="round"
            style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>
            <polyline points="6,9 12,15 18,9"/>
          </svg>
        </div>
      </button>
      {open && fields.map(field => (
        <FieldVerifyRow
          key={field.key}
          field={field}
          value={verifState.fields?.[field.key]}
          onToggle={onToggle}
        />
      ))}
    </div>
  );
}

export default function ClaimVerificationStep({
  detail,
  verifState,
  onToggle,
  onSubmit,        // for Critical priority — final submit
  onSubmitContinue, // for non-critical — goes to next step
  submitting,
}) {
  const isCritical = detail?.priority === "Critical";
  const fields = detail?.claimFields || [];

  // Group by category
  const byCategory = {};
  for (const f of fields) {
    if (!byCategory[f.category]) byCategory[f.category] = [];
    byCategory[f.category].push(f);
  }

  const totalFields = fields.length;
  const verifiedCount = Object.values(verifState.fields || {}).filter(v => v === true).length;
  const disputedCount = Object.values(verifState.fields || {}).filter(v => v === false).length;
  const reviewedCount = verifiedCount + disputedCount;
  const pct = totalFields > 0 ? Math.round((reviewedCount / totalFields) * 100) : 0;
  const allReviewed = reviewedCount === totalFields;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      {/* Step header */}
      <div style={{
        padding: "14px 20px 12px",
        background: "#fff",
        borderBottom: "1px solid #E2E8F0",
        flexShrink: 0,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "linear-gradient(135deg, #1D4ED8, #7C3AED)",
            display: "flex", alignItems: "center", justifyContent: "center",
            color: "#fff", fontSize: 12, fontWeight: 800, flexShrink: 0,
          }}>1</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: "#0F172A" }}>Claim Data Verification</div>
            <div style={{ fontSize: 11, color: "#64748B" }}>
              Review each field and mark ✓ verified or ✗ disputed
              {isCritical && (
                <span style={{ marginLeft: 8, padding: "2px 8px", borderRadius: 99, background: "#FEE2E2", color: "#DC2626", fontWeight: 700, fontSize: 10 }}>
                  ⚡ CRITICAL — Direct Submit
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Progress bar */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 6, background: "#E2E8F0", borderRadius: 99, overflow: "hidden" }}>
            <div style={{
              height: "100%", borderRadius: 99,
              width: `${pct}%`,
              background: disputedCount > 0 ? "linear-gradient(90deg,#16A34A,#F59E0B)" : "linear-gradient(90deg,#1D4ED8,#16A34A)",
              transition: "width 0.3s ease",
            }} />
          </div>
          <span style={{ fontSize: 11, color: "#64748B", flexShrink: 0, minWidth: 80, textAlign: "right" }}>
            {reviewedCount}/{totalFields} reviewed
          </span>
          {verifiedCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: "#DCFCE7", color: "#166534", fontWeight: 700 }}>✓ {verifiedCount}</span>
          )}
          {disputedCount > 0 && (
            <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 99, background: "#FEE2E2", color: "#991B1B", fontWeight: 700 }}>✗ {disputedCount}</span>
          )}
        </div>
      </div>

      {/* Scrollable fields */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 20px" }}>
        {detail?.description && (
          <div style={{
            marginBottom: 12, padding: "12px 14px",
            background: "#F8FAFC", borderRadius: 10, border: "1px solid #E2E8F0",
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
              Claim Description
            </div>
            <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.6 }}>{detail.description}</div>
          </div>
        )}
        {Object.entries(byCategory).map(([cat, catFields]) => (
          <CategorySection
            key={cat}
            cat={cat}
            fields={catFields}
            verifState={verifState}
            onToggle={onToggle}
          />
        ))}
      </div>

      {/* Footer action */}
      <div style={{
        padding: "14px 20px",
        background: "#fff",
        borderTop: "1px solid #E2E8F0",
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}>
        {disputedCount > 0 && (
          <div style={{
            flex: 1, fontSize: 11, color: "#92400E",
            background: "#FEF3C7", borderRadius: 8,
            padding: "7px 11px", border: "1px solid #FDE68A",
          }}>
            ⚠ {disputedCount} field{disputedCount !== 1 ? "s" : ""} disputed
          </div>
        )}
        {disputedCount === 0 && <div style={{ flex: 1 }} />}

        {isCritical ? (
          <button
            onClick={onSubmit}
            disabled={submitting}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "11px 24px", borderRadius: 10, border: "none",
              background: submitting ? "#94A3B8" : "linear-gradient(135deg,#1D4ED8,#7C3AED)",
              color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              boxShadow: submitting ? "none" : "0 4px 14px rgba(29,78,216,0.3)",
            }}
          >
            {submitting ? (
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 0.7s linear infinite" }} />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <polyline points="20,6 9,17 4,12"/>
              </svg>
            )}
            Submit Verification
          </button>
        ) : (
          <button
            onClick={onSubmitContinue}
            disabled={submitting}
            style={{
              display: "flex", alignItems: "center", gap: 8,
              padding: "11px 24px", borderRadius: 10, border: "none",
              background: submitting ? "#94A3B8" : "linear-gradient(135deg,#1D4ED8,#16A34A)",
              color: "#fff", fontSize: 13, fontWeight: 700,
              cursor: submitting ? "not-allowed" : "pointer",
              boxShadow: submitting ? "none" : "0 4px 14px rgba(29,78,216,0.25)",
            }}
          >
            {submitting ? (
              <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", animation: "spin 0.7s linear infinite" }} />
            ) : null}
            Submit & Continue
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="5" y1="12" x2="19" y2="12"/><polyline points="12,5 19,12 12,19"/>
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}