import React, { useState, useMemo, useRef, useCallback } from "react";

/* ─── THEME (mirrors the tokens already used in Dashboard.css / PDFEditorPage) ── */
const T = {
  bg: "var(--bg)",
  bgAlt: "var(--bg3, #fafafa)",
  bgTert: "var(--bg2, var(--bg3, #f4f4f2))",
  text: "var(--text)",
  textSec: "color-mix(in srgb, var(--text) 85%, var(--muted))",
  textMuted: "var(--muted)",
  border: "var(--border)",
  borderMid: "color-mix(in srgb, var(--border) 60%, var(--muted))",
  accent: "var(--accent)",
  success: "var(--green)",
  warn: "var(--amber)",
  danger: "var(--red)",
  blue: "var(--blue)",
  purple: "var(--purple)",
};

/* ─── EVENT TYPE META ────────────────────────────────────────────────── */
const EVENT_TYPE_META = {
  symptom_onset: { label: "Symptom Onset", color: T.warn },
  first_consultation: { label: "First Consultation", color: T.blue },
  investigation: { label: "Investigation", color: T.purple },
  diagnosis: { label: "Diagnosis", color: T.danger },
  admission: { label: "Admission", color: T.accent },
  treatment_procedure: { label: "Treatment / Procedure", color: T.success },
  discharge: { label: "Discharge", color: T.accent },
  claim_submission: { label: "Claim Submission", color: T.textSec },
  other_dated_event: { label: "Other Event", color: T.textMuted },
};
function eventMeta(type) {
  return EVENT_TYPE_META[type] || { label: humanizeType(type || "Event"), color: T.textMuted };
}

/* ─── AGENT LABELS (local copy — kept in sync manually with PDFEditorPage.jsx) ── */
const AGENT_LABELS = {
  ped: "PED",
  billing: "Billing",
  clinical_genuineness: "Clinical Genuineness",
  hospital_record_integrity: "Hospital Record Integrity",
  accident_rta: "Accident / RTA",
  death: "Death",
  medical_necessity: "Medical Necessity",
  hospital_verification: "Hospital Verification",
  high_value_claim: "High-Value Claim",
  employee_verification: "Employee Verification",
  bill_verification: "Bill Verification",
  identity: "Identity",
  policy_coverage: "Policy / Coverage",
  timeline: "Timeline",
  geo_visit: "Geo-Visit",
};

/* ─── HELPERS ────────────────────────────────────────────────────────── */
function humanizeType(str) {
  if (!str) return "";
  return str
    .split("_")
    .map(w => (w ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(" ");
}

function formatDate(dateStr) {
  if (!dateStr) return null;
  const parts = dateStr.split("-");
  if (parts.length !== 3) return dateStr;
  const [y, m, d] = parts;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mi = parseInt(m, 10) - 1;
  if (Number.isNaN(mi) || mi < 0 || mi > 11) return dateStr;
  return `${parseInt(d, 10)} ${months[mi]} ${y}`;
}

/* Groups consecutive timeline entries that share the same date (dated events
   are already emitted in chronological order by the backend). Undated
   events are handled separately by the caller. */
function groupConsecutiveByDate(entries) {
  const groups = [];
  let current = null;
  entries.forEach(entry => {
    if (!current || current.date !== entry.date) {
      current = { date: entry.date, items: [] };
      groups.push(current);
    }
    current.items.push(entry);
  });
  return groups;
}

/* Conflict detection — no LLM call, purely deterministic over data already
   present. Two timeline entries are considered a genuine "same real-world
   event, conflicting record" pair when they share:
     - the same event_type (e.g. both "admission")
     - a flag with the same type AND the same explanation text
   Matching on (type + explanation) rather than just type avoids false
   positives from generic flags (e.g. CHRONOLOGICALLY_IMPOSSIBLE_DATE) that
   get attached to many unrelated event types for different reasons. */
function detectConflictSiblings(timeline) {
  const buckets = {}; // key -> Set(index)
  timeline.forEach((ev, idx) => {
    (ev.flags || []).forEach(f => {
      if (f.type && /CONFLICT|INCONSISTEN|IMPOSSIBLE/i.test(f.type)) {
        const key = `${ev.event_type}::${f.type}::${f.explanation}`;
        (buckets[key] = buckets[key] || new Set()).add(idx);
      }
    });
  });
  const siblings = {}; // idx -> Set(idx)
  Object.values(buckets).forEach(set => {
    if (set.size >= 2) {
      set.forEach(i => {
        siblings[i] = siblings[i] || new Set();
        set.forEach(j => { if (j !== i) siblings[i].add(j); });
      });
    }
  });
  const result = {};
  Object.entries(siblings).forEach(([i, set]) => {
    result[i] = [...set].sort((a, b) => a - b);
  });
  return result;
}

/* ─── FLAG PANEL ─────────────────────────────────────────────────────── */
function FlagPanel({ flags }) {
  return (
    <div style={{ marginTop: 8, border: `1px solid ${T.border}`, borderRadius: 6, overflow: "hidden" }}>
      {flags.map((f, fi) => (
        <div
          key={fi}
          style={{
            padding: "7px 10px",
            borderBottom: fi === flags.length - 1 ? "none" : `1px solid ${T.bgTert}`,
            background: T.bg,
          }}
        >
          <div style={{ fontSize: 9.5, color: T.textMuted, marginBottom: 3, textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {AGENT_LABELS[f.agent] || humanizeType(f.agent)} · <strong style={{ color: T.text }}>{humanizeType(f.type)}</strong>
          </div>
          <div style={{ fontSize: 11, color: T.textSec, lineHeight: 1.45 }}>{f.explanation}</div>
        </div>
      ))}
    </div>
  );
}

/* ─── CONFLICT SIBLINGS PANEL ────────────────────────────────────────── */
function ConflictPanel({ siblingIdxs, timeline, onJump }) {
  return (
    <div style={{
      marginTop: 8, border: `1px solid ${T.danger}`, borderRadius: 6, overflow: "hidden",
      background: "color-mix(in srgb, var(--red) 6%, var(--bg))",
    }}>
      <div style={{ padding: "6px 10px", fontSize: 9.5, color: T.danger, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        Conflicts with {siblingIdxs.length} other entr{siblingIdxs.length === 1 ? "y" : "ies"} for this event
      </div>
      {siblingIdxs.map(sIdx => {
        const sib = timeline[sIdx];
        return (
          <button
            key={sIdx}
            onClick={() => onJump(sIdx)}
            style={{
              display: "block", width: "100%", textAlign: "left",
              padding: "7px 10px", border: "none", borderTop: `1px solid color-mix(in srgb, var(--red) 20%, var(--border))`,
              background: "transparent", cursor: "pointer", fontFamily: "inherit",
            }}
          >
            <div style={{ fontSize: 10.5, color: T.danger, fontWeight: 600 }}>
              {sib.date ? formatDate(sib.date) : "Undated"} — jump ↓
            </div>
            <div style={{ fontSize: 11, color: T.textSec, marginTop: 1 }}>{sib.description}</div>
          </button>
        );
      })}
    </div>
  );
}

/* ─── TIMELINE NODE ──────────────────────────────────────────────────── */
function TimelineNode({
  event, idx, isLastInVisibleList, conflicts, timeline, flagsOpen, onToggleFlags,
  conflictOpen, onToggleConflict, onOpenSource, onJump, highlighted, registerRef,
}) {
  const meta = eventMeta(event.event_type);
  const flagCount = (event.flags || []).length;
  const siblingIdxs = conflicts[idx];
  const hasConflict = !!siblingIdxs && siblingIdxs.length > 0;

  return (
    <div
      ref={el => registerRef(idx, el)}
      style={{
        display: "flex", gap: 12,
        background: highlighted ? "color-mix(in srgb, var(--accent) 8%, transparent)" : "transparent",
        transition: "background 0.4s ease",
        borderRadius: 6,
      }}
    >
      {/* connector column */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: 18, flexShrink: 0 }}>
        <div style={{
          width: 12, height: 12, borderRadius: "50%", marginTop: 5, flexShrink: 0,
          background: hasConflict ? T.danger : meta.color,
          boxShadow: hasConflict ? "0 0 0 3px color-mix(in srgb, var(--red) 22%, transparent)" : "none",
        }} />
        {!isLastInVisibleList && (
          <div style={{ flex: 1, width: 2, minHeight: 14, marginTop: 2, background: hasConflict ? T.danger : T.border }} />
        )}
      </div>

      {/* card */}
      <div style={{ flex: 1, minWidth: 0, paddingBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4, flexWrap: "wrap" }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: meta.color }}>
            {meta.label}
          </span>
          {hasConflict && (
            <span style={{
              fontSize: 9, padding: "2px 7px", borderRadius: 10, fontWeight: 700,
              background: "color-mix(in srgb, var(--red) 14%, var(--bg))", color: T.danger,
            }}>
              ⚠ conflicting record
            </span>
          )}
          {event.source && event.source.verified === false && (
            <span style={{ fontSize: 9, color: T.warn }} title="Source quote could not be verified against the document">
              ⚠ unverified source
            </span>
          )}
        </div>

        <div style={{ fontSize: 12.5, color: T.text, lineHeight: 1.5, marginBottom: 6 }}>
          {event.description}
        </div>

        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          {event.source?.file_name && (
            <button
              type="button"
              onClick={() => onOpenSource(event.source.file_name, event.source.page_number)}
              title={event.source.quote || ""}
              style={{
                fontSize: 10, padding: "2px 8px", borderRadius: 4,
                border: `1px solid ${event.source.verified === false ? T.warn : T.border}`,
                background: T.bg, color: T.textSec, cursor: "pointer", fontFamily: "inherit",
              }}
            >
              {event.source.file_name}{event.source.page_number ? `, pg ${event.source.page_number}` : ""}
            </button>
          )}

          {flagCount > 0 && (
            <button
              type="button"
              onClick={() => onToggleFlags(idx)}
              style={{
                fontSize: 10, padding: "2px 9px", borderRadius: 10, border: "none",
                background: flagsOpen ? T.accent : T.bgTert,
                color: flagsOpen ? "#fff" : T.textSec,
                cursor: "pointer", fontFamily: "inherit", fontWeight: 600,
              }}
            >
              {flagsOpen ? "▲" : "▼"} {flagCount} flag{flagCount === 1 ? "" : "s"}
            </button>
          )}

          {hasConflict && (
            <button
              type="button"
              onClick={() => onToggleConflict(idx)}
              style={{
                fontSize: 10, padding: "2px 9px", borderRadius: 10,
                border: `1px solid ${T.danger}`,
                background: conflictOpen ? T.danger : "transparent",
                color: conflictOpen ? "#fff" : T.danger,
                cursor: "pointer", fontFamily: "inherit", fontWeight: 700,
              }}
            >
              {conflictOpen ? "▲" : "▼"} view conflict ({siblingIdxs.length})
            </button>
          )}
        </div>

        {flagsOpen && flagCount > 0 && <FlagPanel flags={event.flags} />}
        {conflictOpen && hasConflict && (
          <ConflictPanel siblingIdxs={siblingIdxs} timeline={timeline} onJump={onJump} />
        )}
      </div>
    </div>
  );
}

/* ─── DATE GROUP HEADER ──────────────────────────────────────────────── */
function DateHeader({ date }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, margin: "4px 0 10px 0" }}>
      <div style={{
        fontSize: 11, fontWeight: 700, color: T.text, background: T.bgTert,
        padding: "4px 10px", borderRadius: 6, whiteSpace: "nowrap",
      }}>
        {formatDate(date)}
      </div>
      <div style={{ flex: 1, height: 1, background: T.border }} />
    </div>
  );
}

/* ─── LEGEND ─────────────────────────────────────────────────────────── */
function Legend({ typesPresent }) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 12, padding: "8px 0 14px" }}>
      {typesPresent.map(type => {
        const meta = eventMeta(type);
        return (
          <div key={type} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: meta.color }} />
            <span style={{ fontSize: 10, color: T.textMuted }}>{meta.label}</span>
          </div>
        );
      })}
      <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: T.danger, boxShadow: "0 0 0 2px color-mix(in srgb, var(--red) 22%, transparent)" }} />
        <span style={{ fontSize: 10, color: T.textMuted }}>Conflicting record</span>
      </div>
    </div>
  );
}

/* ─── MAIN COMPONENT ─────────────────────────────────────────────────── */
export default function ClaimStoryMap({ agenticInvestigation, onOpenSource }) {
  const [expandedFlags, setExpandedFlags] = useState(() => new Set());
  const [expandedConflicts, setExpandedConflicts] = useState(() => new Set());
  const [narrativeOpen, setNarrativeOpen] = useState(false);
  const [highlightedIdx, setHighlightedIdx] = useState(null);
  const nodeRefs = useRef({});

  const claimStory = agenticInvestigation?.agents?.claim_story;
  const result = claimStory?.result;
  const timeline = result?.timeline || [];

  const conflicts = useMemo(() => detectConflictSiblings(timeline), [timeline]);

  const { dated, undated } = useMemo(() => {
    const d = [], u = [];
    timeline.forEach((ev, idx) => {
      (ev.date ? d : u).push({ ...ev, _idx: idx });
    });
    return { dated: d, undated: u };
  }, [timeline]);

  const dateGroups = useMemo(() => groupConsecutiveByDate(dated), [dated]);

  const typesPresent = useMemo(
    () => [...new Set(timeline.map(e => e.event_type))],
    [timeline]
  );

  const conflictCount = Object.keys(conflicts).length;
  const flaggedCount = timeline.filter(e => (e.flags || []).length > 0).length;

  const registerRef = useCallback((idx, el) => { nodeRefs.current[idx] = el; }, []);

  const scrollToIndex = useCallback((idx) => {
    const el = nodeRefs.current[idx];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedIdx(idx);
    setTimeout(() => setHighlightedIdx(h => (h === idx ? null : h)), 1600);
  }, []);

  const toggleFlags = useCallback((idx) => {
    setExpandedFlags(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }, []);

  const toggleConflict = useCallback((idx) => {
    setExpandedConflicts(prev => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  }, []);

  const flaggableIdxs = useMemo(() => timeline.map((e, i) => (e.flags?.length ? i : null)).filter(i => i !== null), [timeline]);
  const allFlagsOpen = flaggableIdxs.length > 0 && flaggableIdxs.every(i => expandedFlags.has(i));
  const toggleAllFlags = () => setExpandedFlags(allFlagsOpen ? new Set() : new Set(flaggableIdxs));

  /* ── empty / error / not-run states ── */
  if (!agenticInvestigation || !claimStory) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", background: T.bg, border: `1px dashed ${T.border}`, borderRadius: 8 }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>🗺️</div>
        <div style={{ fontSize: 13, color: T.textSec, marginBottom: 6 }}>No claim story yet</div>
        <div style={{ fontSize: 11, color: T.textMuted }}>
          Run the investigation from the <strong>Investigation Review</strong> tab to generate the claim timeline.
        </div>
      </div>
    );
  }

  if (claimStory.status === "error") {
    return (
      <div style={{ padding: "16px 18px", border: `1px solid ${T.danger}`, borderRadius: 8, fontSize: 12, color: T.danger }}>
        Claim story generation failed: {claimStory.error || "unknown error"}
      </div>
    );
  }

  if (result?.status !== "ok" || timeline.length === 0) {
    return (
      <div style={{ padding: "40px 20px", textAlign: "center", background: T.bg, border: `1px dashed ${T.border}`, borderRadius: 8 }}>
        <div style={{ fontSize: 13, color: T.textSec }}>No timeline events were extracted for this claim.</div>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 4, gap: 12, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 11, color: T.textMuted, letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 4 }}>
            Claim Story
          </div>
          <div style={{ fontSize: 11, color: T.textSec }}>
            {timeline.length} events · {dateGroups.length} dated day{dateGroups.length === 1 ? "" : "s"}
            {undated.length > 0 && ` · ${undated.length} undated`}
            {flaggedCount > 0 && ` · ${flaggedCount} flagged`}
            {conflictCount > 0 && (
              <span style={{ color: T.danger, fontWeight: 600 }}> · {conflictCount} entries in conflict</span>
            )}
            {result.confidence && ` · confidence: ${result.confidence}`}
          </div>
        </div>
        {flaggableIdxs.length > 0 && (
          <button
            onClick={toggleAllFlags}
            style={{
              padding: "6px 12px", borderRadius: 5, border: `1px solid ${T.border}`,
              background: T.bg, color: T.textSec, fontFamily: "inherit", fontSize: 11, cursor: "pointer",
            }}
          >
            {allFlagsOpen ? "Collapse all flags" : "Expand all flags"}
          </button>
        )}
      </div>

      {/* Narrative summary */}
      {result.narrative_summary && (
        <div style={{ margin: "10px 0 14px", padding: "10px 12px", background: T.bgTert, borderRadius: 6, borderLeft: `3px solid ${T.borderMid}` }}>
          <div
            style={{
              fontSize: 11.5, color: T.textSec, lineHeight: 1.55,
              display: "-webkit-box",
              WebkitLineClamp: narrativeOpen ? "unset" : 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {result.narrative_summary}
          </div>
          <button
            onClick={() => setNarrativeOpen(o => !o)}
            style={{
              marginTop: 6, background: "none", border: "none", cursor: "pointer",
              color: T.accent, fontSize: 10.5, fontFamily: "inherit", padding: 0, fontWeight: 600,
            }}
          >
            {narrativeOpen ? "Show less ▲" : "Show full narrative ▼"}
          </button>
        </div>
      )}

      <Legend typesPresent={typesPresent} />

      {/* Dated route map */}
      {dateGroups.map((group, gi) => (
        <div key={group.date + gi}>
          <DateHeader date={group.date} />
          {group.items.map((event, ii) => {
            const idx = event._idx;
            const isLast = gi === dateGroups.length - 1 && ii === group.items.length - 1;
            return (
              <TimelineNode
                key={idx}
                event={event}
                idx={idx}
                isLastInVisibleList={isLast}
                conflicts={conflicts}
                timeline={timeline}
                flagsOpen={expandedFlags.has(idx)}
                onToggleFlags={toggleFlags}
                conflictOpen={expandedConflicts.has(idx)}
                onToggleConflict={toggleConflict}
                onOpenSource={onOpenSource}
                onJump={scrollToIndex}
                highlighted={highlightedIdx === idx}
                registerRef={registerRef}
              />
            );
          })}
        </div>
      ))}

      {/* Undated lane — kept visually distinct, not chronologically ordered */}
      {undated.length > 0 && (
        <div style={{ marginTop: 12, paddingTop: 14, borderTop: `1px dashed ${T.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: T.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
              Undated Events
            </span>
            <span style={{ fontSize: 10, color: T.textMuted }}>
              (no exact date in source documents — order not chronological)
            </span>
          </div>
          {undated.map((event, ii) => {
            const idx = event._idx;
            const isLast = ii === undated.length - 1;
            return (
              <TimelineNode
                key={idx}
                event={event}
                idx={idx}
                isLastInVisibleList={isLast}
                conflicts={conflicts}
                timeline={timeline}
                flagsOpen={expandedFlags.has(idx)}
                onToggleFlags={toggleFlags}
                conflictOpen={expandedConflicts.has(idx)}
                onToggleConflict={toggleConflict}
                onOpenSource={onOpenSource}
                onJump={scrollToIndex}
                highlighted={highlightedIdx === idx}
                registerRef={registerRef}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}