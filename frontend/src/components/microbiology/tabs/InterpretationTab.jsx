// tabs/InterpretationTab.jsx — Microbiology Tab 12: Clinical interpretation
//
// CASE-LEVEL synthesis (not keyed by specimen_id). The microbiologist reviews
// all analytical tracks together and records the medical interpretation that
// feeds Tab 14's final report.
//
// Stored shape (interpretation section):
//   interpretation = {
//     organisms: [ { key, organism, significance, concordance_exam,
//                    concordance_clinical, reasoning } ],
//     antimicrobial: { recommended, avoid, de_escalation, clsi_reference },
//     cascade_confirm: { note, confirmed_by },
//     confirmation: { name, credentials, confirmed_at },
//     advisory: { run_at, status, output } | null,   // kept after review, never auto-applied
//   }
//
// The read-only evidence panel aggregates the tracks the plan lists (Tab 3
// direct exam, Tab 5 culture workup, Tab 8 molecular, Tab 9 serology, Tab 10
// AFB/DST, Tab 11 prelims). The AI advisory sits directly beneath it — its
// output is a three-part *clinical insight brief* (what was observed / what it
// means / what to do now & in the future), rendered for reading rather than as
// suggestions to click, so it flows straight into the Organism significance
// rows that follow. AI advisory is advisory-only: its output is shown for
// review and stored under `advisory` only when the microbiologist explicitly
// saves with Save & Keep Advisory; a plain Save Interpretation drops any
// advisory. A stored advisory is re-shown in the panel on reload (tagged "kept
// for reference"), never auto-applied.
//
// The Antimicrobial & stewardship commentary section carries its own
// speech-to-text dictation strip (same pattern as Tabs 1–3): a recorded take is
// transcribed, and "AI Autofill Empty Commentary Fields" structures it into the
// section's free-text fields — empty fields only, nothing overwritten.

import React, { useEffect, useRef, useState } from "react";
import {
  Box, Typography, TextField, Button, IconButton, CircularProgress,
} from "@mui/material";
import {
  AddRounded, DeleteOutlineRounded, AutoAwesomeRounded, SaveOutlined,
  MicRounded, StopRounded, WarningRounded, ArrowForwardRounded,
} from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  SectionBox, FieldLabel, Sel,
} from "../../shared/FormComponents";
import {
  INTERPRETATION_SIGNIFICANCE_OPTIONS,
  INTERPRETATION_CONCORDANCE_EXAM_OPTIONS,
  INTERPRETATION_CONCORDANCE_CLINICAL_OPTIONS,
  genotypingPanelLabel,
} from "../constants";
import { interpretationAdvisory, structureAntimicrobialCommentary, TRANSCRIBE_URL } from "../shared/api";

const makeKey = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const displayValue = (v) =>
  Array.isArray(v) ? v.join(", ") : String(v ?? "");

// ─── AI advisory readout — "clinical insight brief" ──────────────────────────
// A pure display component for the advisory JSON. The engine returns content in
// a three-part arc — what was observed / what it means / what to do now & in the
// future. It renders strictly by presence so an older stored advisory (v1: only
// organism_assessment + de_escalation + summary) still reads cleanly, and it
// never offers click-through "apply" actions — the brief is for reading, and the
// microbiologist authors the interpretation fields themselves below it.

const microLabelSx = {
  fontSize: 10.5, textTransform: "uppercase", letterSpacing: "0.14em",
  color: C.textMuted, fontFamily: FONT, fontWeight: 600,
};

const InsightToken = ({ children }) => (
  <Typography sx={{
    fontSize: 10.5, fontFamily: FONT, letterSpacing: "0.08em", textTransform: "uppercase",
    px: 1.25, py: 0.6, border: `1px solid ${C.borderStrong}`, whiteSpace: "nowrap",
    display: "inline-block", color: C.textPrimary, background: C.white,
  }}>
    {children}
  </Typography>
);

// Headed sub-card — each stage of the arc (plus the trailing block) renders inside
// one, so every section carries a distinguishable numbered header bar.
const BriefSection = ({ index, title, children }) => (
  <Box sx={{ border: `1px solid ${C.border}`, background: C.white, mb: 1.5 }}>
    <Box sx={{
      display: "flex", alignItems: "center", gap: 1.25,
      px: 1.75, py: 1, borderBottom: `1px solid ${C.border}`, background: C.bgSecondary,
    }}>
      {index != null && (
        <Typography sx={{
          fontSize: 10, fontFamily: FONT, fontWeight: 600, letterSpacing: "0.05em",
          color: C.textMuted, border: `1px solid ${C.border}`, px: 0.6, py: 0.1, background: C.white,
        }}>
          {index}
        </Typography>
      )}
      <Typography sx={{
        fontSize: 11, textTransform: "uppercase", letterSpacing: "0.16em",
        color: C.textPrimary, fontFamily: FONT, fontWeight: 600,
      }}>
        {title}
      </Typography>
    </Box>
    <Box sx={{ p: 1.75 }}>{children}</Box>
  </Box>
);

// Titled cell used inside the auto-fit grids (recommendations, AMR findings). A
// plain-string child renders as body text; anything else (e.g. a list) passes through.
const MiniCard = ({ label, children }) => (
  <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, px: 1.5, py: 1.25, height: "100%" }}>
    <Typography sx={{ ...microLabelSx, mb: 0.75 }}>{label}</Typography>
    {typeof children === "string"
      ? <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.5 }}>{children}</Typography>
      : children}
  </Box>
);

// Compact concordance chip (label + value) shown on each organism card.
const ConcChip = ({ label, value }) => (
  <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5, border: `1px solid ${C.border}`, px: 0.85, py: 0.4, background: C.white }}>
    <Typography sx={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.1em", color: C.textMuted, fontFamily: FONT }}>{label}</Typography>
    <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textSecond, fontWeight: 600 }}>{value}</Typography>
  </Box>
);

// Monochrome bullet list for further-testing / follow-up items inside a MiniCard.
const BulletList = ({ items }) => (
  <Box component="ul" sx={{ m: 0, p: 0, listStyle: "none" }}>
    {items.map((it, i) => (
      <Box component="li" key={i} sx={{ display: "flex", gap: 0.85, alignItems: "flex-start", mb: i === items.length - 1 ? 0 : 0.5 }}>
        <Box sx={{ width: 4, height: 4, background: C.textMuted, mt: 0.7, flexShrink: 0 }} />
        <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.45 }}>{it}</Typography>
      </Box>
    ))}
  </Box>
);

const InsightBrief = ({ advisory }) => {
  const adv = (advisory && typeof advisory === "object") ? advisory : {};
  const organisms = (Array.isArray(adv.organism_assessment) ? adv.organism_assessment : [])
    .filter((o) => o && typeof o === "object" && (o.organism || o.significance || o.reasoning || o.clinical_meaning));
  const amr = (Array.isArray(adv.amr_commentary) ? adv.amr_commentary : []).filter((a) => a && typeof a === "object");
  const de = (Array.isArray(adv.de_escalation) ? adv.de_escalation : []).filter((d) => d && typeof d === "object");
  const rec = (adv.recommendations && typeof adv.recommendations === "object") ? adv.recommendations : {};
  const cascade = (adv.cascade_review && typeof adv.cascade_review === "object") ? adv.cascade_review : {};
  const missing = (Array.isArray(adv.missing_information) ? adv.missing_information : [])
    .map((m) => String(m ?? "").trim()).filter(Boolean);
  const strList = (v) => (Array.isArray(v) ? v : []).map((x) => String(x ?? "").trim()).filter(Boolean);

  const sigCounts = {};
  organisms.forEach((o) => {
    const s = String(o.significance || "").trim();
    if (s) sigCounts[s] = (sigCounts[s] || 0) + 1;
  });
  const sigTokens = Object.entries(sigCounts);

  const furtherTests = strList(rec.further_tests);
  const followUps = strList(rec.follow_up);
  const redFlags = strList(rec.red_flags);

  const nothingShown = !adv.findings_synopsis && !adv.summary
    && organisms.length === 0 && !adv.interpretation_summary
    && amr.length === 0 && de.length === 0 && missing.length === 0
    && !cascade.note && !cascade.suppressed_agents
    && !rec.therapy && !rec.avoid && !rec.infection_control
    && furtherTests.length === 0 && followUps.length === 0 && redFlags.length === 0;

  if (nothingShown) {
    return (
      <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>
        Advisory returned no structured suggestions.
      </Typography>
    );
  }

  // ── Next-steps assembly ─────────────────────────────────────────────────────
  // Labeled / list recommendations become titled mini-cards in an auto-fit grid;
  // de-escalation paths and red flags render full-width beneath so their arrows
  // and emphasis get room. `auto-fit` collapses empty tracks, so a single card
  // stretches to fill the row rather than sitting half-width.
  const doCards = [];
  if (rec.therapy) doCards.push({ key: "therapy", label: "Therapy direction", value: rec.therapy });
  if (rec.avoid) doCards.push({ key: "avoid", label: "Avoid", value: rec.avoid });
  if (furtherTests.length) doCards.push({ key: "ft", label: "Further testing", items: furtherTests });
  if (followUps.length) doCards.push({ key: "fu", label: "Follow-up", items: followUps });
  if (rec.infection_control) doCards.push({ key: "ic", label: "Infection control", value: rec.infection_control });
  const dePaths = de
    .map((d) => ({ from: String(d.from || "").trim(), to: String(d.to || "").trim(), rationale: d.rationale, caveat: d.caveat }))
    .filter((d) => d.from || d.to);
  const hasNextSteps = doCards.length > 0 || dePaths.length > 0 || redFlags.length > 0;

  const autoGrid = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 1.25 };

  return (
    <Box>
      {/* Lead takeaway */}
      {adv.summary && (
        <Box sx={{ borderLeft: `3px solid ${C.black}`, background: C.bgSecondary, px: 1.75, py: 1.25, mb: 1.75 }}>
          <Typography sx={{ fontSize: 13.5, fontFamily: FONT, color: C.textPrimary, lineHeight: 1.55 }}>{adv.summary}</Typography>
        </Box>
      )}

      {/* 01 — What was observed */}
      {(adv.findings_synopsis || sigTokens.length > 0) && (
        <BriefSection index="01" title="What was observed">
          {adv.findings_synopsis && (
            <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.55, mb: sigTokens.length ? 1.5 : 0 }}>
              {adv.findings_synopsis}
            </Typography>
          )}
          {sigTokens.length > 0 && (
            <Box>
              <Typography sx={{ ...microLabelSx, mb: 0.75 }}>Significance mix</Typography>
              <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                {sigTokens.map(([label, n]) => (
                  <InsightToken key={label}>{label}{n > 1 ? ` ×${n}` : ""}</InsightToken>
                ))}
              </Box>
            </Box>
          )}
        </BriefSection>
      )}

      {/* 02 — What it means */}
      {(organisms.length > 0 || adv.interpretation_summary || amr.length > 0) && (
        <BriefSection index="02" title="What it means">
          {organisms.length > 0 && (
            <Box sx={autoGrid}>
              {organisms.map((o, i) => (
                <Box key={i} sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, display: "flex", flexDirection: "column" }}>
                  <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 1, px: 1.25, py: 0.85, borderBottom: `1px solid ${C.border}`, background: C.white }}>
                    <Typography sx={{ fontSize: 13, fontFamily: FONT, fontWeight: 600, color: C.textPrimary }}>{o.organism || "Organism"}</Typography>
                    {o.significance && (
                      <Typography sx={{ fontSize: 9.5, fontFamily: FONT, letterSpacing: "0.1em", textTransform: "uppercase", color: C.textSecond, whiteSpace: "nowrap" }}>
                        {o.significance}
                      </Typography>
                    )}
                  </Box>
                  <Box sx={{ px: 1.25, py: 1.1 }}>
                    {(o.concordance_exam || o.concordance_clinical) && (
                      <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap", mb: (o.reasoning || o.clinical_meaning) ? 1 : 0 }}>
                        {o.concordance_exam && <ConcChip label="Exam" value={o.concordance_exam} />}
                        {o.concordance_clinical && <ConcChip label="Clinical" value={o.concordance_clinical} />}
                      </Box>
                    )}
                    {o.reasoning && <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, lineHeight: 1.5 }}>{o.reasoning}</Typography>}
                    {o.clinical_meaning && (
                      <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted, mt: o.reasoning ? 0.5 : 0, fontStyle: "italic", lineHeight: 1.5 }}>
                        {o.clinical_meaning}
                      </Typography>
                    )}
                  </Box>
                </Box>
              ))}
            </Box>
          )}
          {adv.interpretation_summary && (
            <Box sx={{ borderLeft: `3px solid ${C.black}`, background: C.bgSecondary, pl: 1.5, pr: 1.25, py: 0.85, mt: organisms.length ? 1.5 : 0 }}>
              <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.5 }}>{adv.interpretation_summary}</Typography>
            </Box>
          )}
          {amr.length > 0 && (
            <Box sx={{ mt: (organisms.length || adv.interpretation_summary) ? 1.5 : 0 }}>
              <Typography sx={{ ...microLabelSx, mb: 0.75 }}>Resistance / AMR reading</Typography>
              <Box sx={autoGrid}>
                {amr.map((a, i) => (
                  <MiniCard key={i} label={a.finding || "Finding"}>
                    {a.clinical_relevance && <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, lineHeight: 1.5 }}>{a.clinical_relevance}</Typography>}
                    {a.recommended_action && (
                      <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textMuted, mt: a.clinical_relevance ? 0.5 : 0 }}>
                        Suggested action: {a.recommended_action}
                      </Typography>
                    )}
                  </MiniCard>
                ))}
              </Box>
            </Box>
          )}
        </BriefSection>
      )}

      {/* 03 — What to do / next steps */}
      {hasNextSteps && (
        <BriefSection index="03" title="What to do / next steps">
          {doCards.length > 0 && (
            <Box sx={autoGrid}>
              {doCards.map((c) => (
                <MiniCard key={c.key} label={c.label}>
                  {c.items ? <BulletList items={c.items} /> : c.value}
                </MiniCard>
              ))}
            </Box>
          )}
          {dePaths.length > 0 && (
            <Box sx={{ mt: doCards.length ? 1.5 : 0 }}>
              <Typography sx={{ ...microLabelSx, mb: 0.75 }}>De-escalation pathway</Typography>
              {dePaths.map((d, i) => (
                <Box key={i} sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, px: 1.5, py: 1.1, mb: i === dePaths.length - 1 ? 0 : 0.75 }}>
                  <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
                    {d.from && <InsightToken>{d.from}</InsightToken>}
                    {d.from && d.to && <ArrowForwardRounded sx={{ fontSize: 16, color: C.textSecond }} />}
                    {d.to && <InsightToken>{d.to}</InsightToken>}
                  </Box>
                  {d.rationale && <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, mt: 0.6, lineHeight: 1.5 }}>{d.rationale}</Typography>}
                  {d.caveat && <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mt: 0.25 }}>Caveat: {d.caveat}</Typography>}
                </Box>
              ))}
            </Box>
          )}
          {redFlags.length > 0 && (
            <Box sx={{ mt: (doCards.length || dePaths.length) ? 1.5 : 0 }}>
              {redFlags.map((r, i) => (
                <Box key={i} sx={{ border: `1px solid ${C.borderStrong}`, background: C.white, px: 1.5, py: 1, mb: i === redFlags.length - 1 ? 0 : 0.75, display: "flex", gap: 1, alignItems: "flex-start" }}>
                  <WarningRounded sx={{ fontSize: 16, color: C.black, mt: 0.1, flexShrink: 0 }} />
                  <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ ...microLabelSx, color: C.black, mb: 0.25 }}>Red flag</Typography>
                    <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary, lineHeight: 1.5 }}>{r}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}
        </BriefSection>
      )}

      {/* 04 — Cascade review & data gaps */}
      {((cascade.note || cascade.suppressed_agents || cascade.override_justified) || missing.length > 0) && (
        <BriefSection index="04" title="Cascade review & data gaps">
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.75 }}>
            {(cascade.note || cascade.suppressed_agents || cascade.override_justified) && (
              <Box>
                <Typography sx={{ ...microLabelSx, mb: 0.75 }}>Cascade review</Typography>
                {cascade.suppressed_agents && (
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, mb: 0.4, lineHeight: 1.5 }}>
                    Suppressed: {cascade.suppressed_agents}
                  </Typography>
                )}
                {cascade.note && (
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, mb: 0.4, lineHeight: 1.5 }}>{cascade.note}</Typography>
                )}
                {cascade.override_justified && (
                  <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted, lineHeight: 1.5 }}>Override justified: {cascade.override_justified}</Typography>
                )}
              </Box>
            )}
            {missing.length > 0 && (
              <Box>
                <Typography sx={{ ...microLabelSx, mb: 0.75 }}>Would sharpen this reading</Typography>
                <Box sx={{ display: "flex", gap: 0.75, flexWrap: "wrap" }}>
                  {missing.map((m, i) => (
                    <Typography key={i} sx={{
                      fontSize: 11, fontFamily: FONT, color: C.textSecond,
                      px: 1, py: 0.5, border: `1px solid ${C.border}`, background: C.bgSecondary,
                    }}>
                      {m}
                    </Typography>
                  ))}
                </Box>
              </Box>
            )}
          </Box>
        </BriefSection>
      )}
    </Box>
  );
};

// ─── Antimicrobial & stewardship commentary dictation autofill ────────────────
// The spoken commentary is structured by the backend into the section's two
// free-text sub-objects (antimicrobial / cascade_confirm); this merge applies
// each incoming string into an EMPTY target field only — never overwrite, never
// clear, so a short or partial transcript is always a safe no-op. The section is
// entirely free text (no enums/numbers/dates), so a plain recursive fill-empty
// over string leaves is the whole rule.

function mergeIntoEmpty(target, incoming) {
  if (!target || typeof target !== "object" || Array.isArray(target)) return { next: target, applied: 0 };
  const src = incoming && typeof incoming === "object" && !Array.isArray(incoming) ? incoming : {};
  const next = { ...target };
  let applied = 0;
  Object.entries(src).forEach(([key, value]) => {
    const current = target[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      if (current && typeof current === "object" && !Array.isArray(current)) {
        const sub = mergeIntoEmpty(current, value);
        next[key] = sub.next;
        applied += sub.applied;
      }
    } else if (typeof value === "string" && value.trim() !== "" && !String(current ?? "").trim()) {
      next[key] = value.trim();
      applied += 1;
    }
  });
  return { next, applied };
}

// ─── Blank / hydration ────────────────────────────────────────────────────────

const blankForm = (doctorName) => ({
  organisms: [],
  antimicrobial: { recommended: "", avoid: "", de_escalation: "", clsi_reference: "" },
  cascade_confirm: { note: "", confirmed_by: doctorName || "" },
  confirmation: { name: doctorName || "", credentials: "", confirmed_at: "" },
  advisory: null,
});

const hydrate = (initialData, doctorName) => {
  const src = (initialData && typeof initialData === "object") ? initialData : {};
  const blank = blankForm(doctorName);
  return {
    organisms: Array.isArray(src.organisms)
      ? src.organisms.map((o) => ({
          key: o.key || makeKey(),
          organism: o.organism || "",
          significance: o.significance || "",
          concordance_exam: o.concordance_exam || "",
          concordance_clinical: o.concordance_clinical || "",
          reasoning: o.reasoning || "",
        }))
      : [],
    antimicrobial: { ...blank.antimicrobial, ...(src.antimicrobial || {}) },
    cascade_confirm: { ...blank.cascade_confirm, ...(src.cascade_confirm || {}) },
    confirmation: { ...blank.confirmation, ...(src.confirmation || {}) },
    advisory: src.advisory || null,
  };
};

// ─── Evidence aggregation (read-only) ─────────────────────────────────────────
// Pulls the confirmed/significant findings from each analytical section into a
// compact evidence summary the microbiologist reviews before writing.

const EVIDENCE_LIMIT = 6;

export default function InterpretationTab({
  doctorName,
  caseId,
  initialData,        // interpretation section
  caseRegister,       // case_register (clinical context + specimens)
  directExamination,  // Tab 3
  cultureWorkup,      // Tab 5
  molecular,          // Tab 8
  serology,           // Tab 9
  mycobacteriology,   // Tab 10
  pathogenGenomics,   // Tab 15 — read-only evidence only. The PGx track (Tab 16)
                      // informs toxicity, not infection, and is deliberately not
                      // blended into the per-organism assessment below.
  preliminaryReports, // Tab 11
  onSave,             // (tabKey, data) dispatch — "interpretation"
}) {
  const [form, setForm] = useState(() => blankForm(doctorName));
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [advisoryLoading, setAdvisoryLoading] = useState(false);
  const [advisory, setAdvisory] = useState(null);
  // True when the advisory panel is showing a previously kept run (re-surfaced
  // from the document) rather than one generated in this session.
  const [advisoryKept, setAdvisoryKept] = useState(false);

  // Antimicrobial & stewardship commentary dictation state.
  const [transcript, setTranscript] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  // Latest form snapshot for the async autofill handler to read current fields.
  const formRef = useRef(form);
  formRef.current = form;

  const specimens = Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : [];
  const clinical = caseRegister?.clinical_context || {};

  useEffect(() => {
    const next = hydrate(initialData, doctorName);
    setForm(next);
    // Re-surface a previously kept advisory into the review panel so a
    // "Save & Keep Advisory" run is not lost to the user on reload. The stored
    // record wraps the original suggestion under `output`; the panel renders the
    // same flat shape a fresh run produces.
    const stored = next.advisory;
    if (stored && typeof stored === "object") {
      setAdvisory(stored.output && typeof stored.output === "object" ? stored.output : stored);
      setAdvisoryKept(true);
    } else {
      setAdvisory(null);
      setAdvisoryKept(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  const patch = (patchObj) => setForm((prev) => ({ ...prev, ...patchObj }));
  const patchNested = (group, patchObj) =>
    setForm((prev) => ({ ...prev, [group]: { ...prev[group], ...patchObj } }));

  // ── Organism rows ──
  const addOrganism = (seed = {}) =>
    setForm((prev) => ({
      ...prev,
      organisms: [...prev.organisms, {
        key: makeKey(), organism: seed.organism || "", significance: "", concordance_exam: "",
        concordance_clinical: "", reasoning: "",
      }],
    }));

  const patchOrganism = (key, patchObj) =>
    setForm((prev) => ({
      ...prev,
      organisms: prev.organisms.map((o) => (o.key === key ? { ...o, ...patchObj } : o)),
    }));

  const removeOrganism = (key) =>
    setForm((prev) => ({ ...prev, organisms: prev.organisms.filter((o) => o.key !== key) }));

  // Seed organism rows from confirmed culture/molecular/serology/micro findings.
  const seedFromEvidence = () => {
    const seedList = [];
    (cultureWorkup && typeof cultureWorkup === "object" ? Object.values(cultureWorkup) : [])
      .forEach((block) => {
        (block?.isolates || []).forEach((iso) => {
          if (iso.organism && !seedList.some((s) => s.organism === iso.organism)) seedList.push({ organism: iso.organism });
        });
      });
    (mycobacteriology && typeof mycobacteriology === "object" ? Object.values(mycobacteriology) : [])
      .forEach((block) => {
        (block?.isolates || []).forEach((iso) => {
          if (iso.species && !seedList.some((s) => s.organism === iso.species)) seedList.push({ organism: iso.species });
        });
      });
    seedList.forEach((s) => addOrganism(s));
    if (seedList.length === 0) addOrganism({});
    setNotice("Seeded interpretation rows from confirmed culture / AFB isolates — adjust significance for each.");
  };

  const saveInterpretation = async (keepAdvisory = false) => {
    setIsSaving(true);
    setNotice("");
    try {
      // Advisory is never silently carried forward: a plain save drops it, and it
      // is written only when the user explicitly saves after a (fresh or kept)
      // run. It is the reviewed suggestion set, tagged advisory — never treated
      // as authored clinical content.
      const payload = { ...form };
      delete payload.advisory;
      if (keepAdvisory && advisory) {
        payload.advisory = { run_at: advisory.run_at, status: "reviewed — kept for reference", output: advisory };
      }
      if (form.confirmation.confirmed_at) {
        payload.confirmation.confirmed_at = form.confirmation.confirmed_at;
      } else {
        payload.confirmation.confirmed_at = new Date().toISOString();
      }
      await onSave("interpretation", payload);
    } catch (err) {
      console.error("[InterpretationTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  const runAdvisory = async () => {
    setAdvisoryLoading(true);
    setNotice("");
    setAdvisory(null);
    setAdvisoryKept(false);
    try {
      const draft = {
        organisms: form.organisms.filter((o) => o.organism),
        antimicrobial: form.antimicrobial,
        cascade_confirm: form.cascade_confirm,
      };
      const res = await interpretationAdvisory(caseId, draft);
      setAdvisory({ run_at: new Date().toISOString(), ...(res?.data || {}) });
    } catch (err) {
      console.error("[InterpretationTab] advisory error:", err);
      // Clinician-facing: names no environment variable or internal endpoint —
      // enough to act on, and the detail is in the browser console for whoever
      // supports it.
      setNotice("Could not generate the advisory. Please try again — if it keeps failing, tell your system administrator.");
    } finally {
      setAdvisoryLoading(false);
    }
  };

  // ── Antimicrobial & stewardship commentary dictation (speech → autofill) ──
  const startCommentaryRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorderRef.current = new MediaRecorder(stream);
      audioChunksRef.current = [];
      mediaRecorderRef.current.ondataavailable = (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      };
      mediaRecorderRef.current.start();
      setIsRecording(true);
    } catch (error) {
      console.error("[InterpretationTab] microphone:", error);
      setNotice("Microphone access is unavailable.");
    }
  };

  const stopCommentaryRecording = () => {
    if (!mediaRecorderRef.current || !isRecording) return;
    mediaRecorderRef.current.onstop = async () => {
      setIsRecording(false);
      setIsTranscribing(true);
      const audioBlob = new Blob(audioChunksRef.current, { type: "audio/webm" });
      audioChunksRef.current = [];
      try {
        const formData = new FormData();
        formData.append("file", audioBlob, "recording.webm");
        const response = await fetch(TRANSCRIBE_URL, { method: "POST", body: formData });
        if (!response.ok) throw new Error(`Transcription failed (${response.status})`);
        const data = await response.json();
        const text = data.text || data.transcription || "";
        if (text) setTranscript((current) => (current ? `${current} ${text}` : text));
        else setNotice("Nothing was heard — try again.");
      } catch (error) {
        console.error("[InterpretationTab] transcription:", error);
        setNotice("Commentary dictation transcription failed.");
      } finally {
        setIsTranscribing(false);
      }
    };
    mediaRecorderRef.current.stop();
    mediaRecorderRef.current.stream.getTracks().forEach((track) => track.stop());
  };

  const applyCommentaryDictation = async () => {
    const text = transcript.trim();
    if (!text || isAutofilling) return;
    setIsAutofilling(true);
    setNotice("");
    try {
      const response = await structureAntimicrobialCommentary(text);
      const incoming = response?.data;
      const snapshot = formRef.current;
      const a = mergeIntoEmpty(snapshot.antimicrobial, incoming?.antimicrobial);
      const c = mergeIntoEmpty(snapshot.cascade_confirm, incoming?.cascade_confirm);
      const applied = a.applied + c.applied;
      if (applied === 0) {
        setNotice("Dictation matched only fields that are already filled — nothing was overwritten.");
        return;
      }
      setForm((prev) => ({
        ...prev,
        antimicrobial: { ...prev.antimicrobial, ...a.next },
        cascade_confirm: { ...prev.cascade_confirm, ...c.next },
      }));
      setNotice(`Applied ${applied} dictated value${applied === 1 ? "" : "s"} to empty commentary fields.`);
    } catch (error) {
      console.error("[InterpretationTab] antimicrobial dictation structure:", error);
      setNotice("Antimicrobial dictation structuring failed.");
    } finally {
      setIsAutofilling(false);
    }
  };

  const commentaryBusy = isRecording || isTranscribing || isAutofilling;

  // ── Read-only evidence rows ──
  const evidence = [];

  // Direct exam highlights.
  (directExamination && typeof directExamination === "object" ? Object.entries(directExamination) : [])
    .forEach(([spId, block]) => {
      (block?.exams || []).forEach((e) => {
        const res = e.result || {};
        const summary = Object.entries(res)
          .filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0))
          .map(([k, v]) => `${k}: ${displayValue(v)}`)
          .join(" · ");
        if (summary) evidence.push({ source: "Direct exam", specimen: spId, line: `${e.exam_type || "exam"} — ${summary}` });
      });
    });

  // Culture isolates (organism + AST first-line outcomes).
  (cultureWorkup && typeof cultureWorkup === "object" ? Object.entries(cultureWorkup) : [])
    .forEach(([spId, block]) => {
      (block?.isolates || []).forEach((iso) => {
        if (!iso.organism) return;
        const ast = (iso.ast?.antibiotics || [])
          .filter((a) => a.interpretation)
          .map((a) => `${a.antibiotic} ${a.interpretation}`)
          .join(", ");
        evidence.push({
          source: "Culture",
          specimen: spId,
          line: `${iso.organism}${iso.significance ? ` (${iso.significance})` : ""}${ast ? ` — AST: ${ast}` : ""}`,
        });
      });
    });

  // Molecular — Detected orders.
  (molecular && typeof molecular === "object" ? Object.entries(molecular) : [])
    .forEach(([spId, block]) => {
      (block?.orders || []).forEach((o) => {
        const assay = o.assay || "";
        const q = o.result?.qualitative;
        const has = (q === "Detected") || (q === "Positive");
        if (assay && has) evidence.push({ source: "Molecular", specimen: spId, line: `${assay} — ${q}` });
      });
    });

  // Serology — Reactive / Positive orders.
  (serology && typeof serology === "object" ? Object.entries(serology) : [])
    .forEach(([spId, block]) => {
      (block?.orders || []).forEach((o) => {
        const assay = o.assay || "";
        const q = o.result?.qualitative;
        const has = q === "Reactive" || q === "Positive" || q === "Detected";
        if (assay && has) evidence.push({ source: "Serology", specimen: spId, line: `${assay} — ${q}` });
      });
    });

  // Mycobacteriology — species + DST.
  (mycobacteriology && typeof mycobacteriology === "object" ? Object.entries(mycobacteriology) : [])
    .forEach(([spId, block]) => {
      (block?.isolates || []).forEach((iso) => {
        if (!iso.species) return;
        const fl = (iso.dst?.first_line || []).filter((r) => r.result).map((r) => `${r.drug}:${r.result === "Resistant" ? "R" : "S"}`).join(", ");
        evidence.push({ source: "AFB/DST", specimen: spId, line: `${iso.species}${fl ? ` — ${fl}` : ""}` });
      });
    });

  // Pathogen genomics (Tab 15) — its own evidence block, deliberately separate
  // from the phenotypic rows above. Genomic resistance is PREDICTED, so a
  // disagreement with the AST is a finding to interpret, not a formatting choice.
  (pathogenGenomics && typeof pathogenGenomics === "object" ? Object.entries(pathogenGenomics) : [])
    .forEach(([spId, block]) => {
      const wgs = block?.wgs;
      if (wgs?.identified_species) {
        const genes = (wgs.resistance_genes || []).map((g) => g.gene_name).filter(Boolean);
        evidence.push({
          source: "WGS (predicted)",
          specimen: spId,
          line: `${wgs.identified_species}${wgs.sequence_type ? ` · ${wgs.sequence_type}` : ""}${genes.length ? ` — ${genes.join(", ")}` : ""}`,
        });
      }

      const tngs = block?.tngs;
      if (tngs?.tb_classification) {
        const res = (tngs.drug_resistance_calls || [])
          .filter((c) => c.predicted_phenotype === "Resistant")
          .map((c) => c.drug)
          .filter(Boolean);
        evidence.push({
          source: "tNGS-TB (predicted)",
          specimen: spId,
          line: `${tngs.tb_classification}${res.length ? ` — R: ${res.join(", ")}` : ""}`,
        });
      }

      const hits = (block?.mngs?.organism_hits || []).slice(0, 3).map((h) => h.taxon_name).filter(Boolean);
      if (hits.length) evidence.push({ source: "mNGS", specimen: spId, line: hits.join(", ") });

      (block?.targeted?.orders || []).forEach((o) => {
        if (!o.panel) return;
        const res = (o.mutation_rows || [])
          .filter((r) => r.predicted_phenotype === "Resistant")
          .map((r) => r.drug || r.mutation)
          .filter(Boolean);
        evidence.push({
          source: "Targeted panel (predicted)",
          specimen: spId,
          line: `${genotypingPanelLabel(o.panel)}${res.length ? ` — R: ${res.join(", ")}` : ""}`,
        });
      });
    });

  const prelimCount = Array.isArray(preliminaryReports?.versions) ? preliminaryReports.versions.length : 0;

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Medical synthesis across all tracks — review the evidence, assign per-organism significance, note concordance,
        and record antimicrobial / stewardship commentary. This feeds the Tab 14 final report.
      </Typography>

      {/* Evidence panel (read-only) */}
      <SectionBox title="Evidence across tracks (read-only)">
        <Box sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond, mb: 0.25 }}>
            Clinical context — {clinical.presenting_complaint || "no complaint recorded"}
            {clinical.antibiotics_started === "Yes" && clinical.antibiotic_name ? ` · on ${clinical.antibiotic_name}` : ""}
          </Typography>
          <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>
            {specimens.length} specimen(s) registered · {prelimCount} preliminary report(s) issued
          </Typography>
        </Box>
        {evidence.length === 0 && (
          <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
            No confirmed findings recorded yet across the analytical tabs.
          </Typography>
        )}
        {evidence.slice(0, EVIDENCE_LIMIT).map((e, i) => (
          <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.5 }}>
            <Box sx={{ width: 90, flexShrink: 0 }}>
              <Typography sx={{ fontSize: 10.5, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.04em" }}>{e.source}</Typography>
            </Box>
            <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{e.specimen} — {e.line}</Typography>
          </Box>
        ))}
        {evidence.length > EVIDENCE_LIMIT && (
          <Typography sx={{ fontSize: 11.5, color: C.textMuted, fontFamily: FONT, mt: 0.5 }}>
            … and {evidence.length - EVIDENCE_LIMIT} more (the full record is in each tab).
          </Typography>
        )}
        <Box sx={{ mt: 1, display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={seedFromEvidence} sx={{ ...outlineBtnSx, px: 2, py: 0.5, fontSize: 11 }}>
            Seed organism rows from confirmed isolates
          </Button>
        </Box>
      </SectionBox>

      {/* AI advisory assistant — clinical insight brief (advisory only) */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title="AI advisory assistant (advisory only)">
          <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
            Reads all track data and returns an advisory clinical brief — what was observed, what it means, and what
            to do now / in the future — phrased for review and for the treating clinician. Output is advisory and
            reviewed; it is never auto-written to the report, and it is stored under `advisory` only if you save
            after running.
          </Typography>
          <Box sx={{ display: "flex", gap: 1, alignItems: "center", mb: 1.5 }}>
            <Button onClick={runAdvisory} disabled={advisoryLoading || !caseId} sx={{ ...outlineBtnSx, px: 2.5 }}>
              <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 18 }} /> {advisoryLoading ? "Generating…" : "Run AI Advisory"}
            </Button>
            {advisory && (
              <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>
                generated {new Date(advisory.run_at).toLocaleString()}{advisoryKept ? " · kept for reference" : ""}
              </Typography>
            )}
          </Box>

          {advisoryLoading && (
            <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>Consulting the microbiology advisory engine…</Typography>
          )}

          {advisory && !advisoryLoading && <InsightBrief advisory={advisory} />}
        </SectionBox>
      </Box>

      {/* Organism significance */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title={`Organism significance (${form.organisms.length})`}>
          {form.organisms.length === 0 && (
            <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1 }}>
              No organism rows yet. Add one, or seed from confirmed isolates above.
            </Typography>
          )}
          {form.organisms.map((o) => (
            <Box key={o.key} sx={{ border: `1px solid ${C.border}`, mb: 1.5, p: 1.5, background: C.bgTertiary }}>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr auto" }, gap: 1, alignItems: "start" }}>
                <Box>
                  <FieldLabel>Organism</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} value={o.organism} onChange={(e) => patchOrganism(o.key, { organism: e.target.value })} />
                </Box>
                <Box>
                  <FieldLabel>Significance</FieldLabel>
                  <Sel label="Significance" options={INTERPRETATION_SIGNIFICANCE_OPTIONS} value={o.significance} onChange={(v) => patchOrganism(o.key, { significance: v })} />
                </Box>
                <Box>
                  <FieldLabel>Concordance with direct exam</FieldLabel>
                  <Sel label="Concordance (exam)" options={INTERPRETATION_CONCORDANCE_EXAM_OPTIONS} value={o.concordance_exam} onChange={(v) => patchOrganism(o.key, { concordance_exam: v })} />
                </Box>
                <IconButton size="small" onClick={() => removeOrganism(o.key)} sx={{ color: C.textSecond, "&:hover": { color: C.black }, mt: 2 }}>
                  <DeleteOutlineRounded fontSize="small" />
                </IconButton>
              </Box>
              <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1, mt: 1 }}>
                <Box>
                  <FieldLabel>Concordance with clinical picture</FieldLabel>
                  <Sel label="Concordance (clinical)" options={INTERPRETATION_CONCORDANCE_CLINICAL_OPTIONS} value={o.concordance_clinical} onChange={(v) => patchOrganism(o.key, { concordance_clinical: v })} />
                </Box>
                <Box>
                  <FieldLabel>Clinical reasoning</FieldLabel>
                  <TextField size="small" fullWidth sx={inputSx} value={o.reasoning} onChange={(e) => patchOrganism(o.key, { reasoning: e.target.value })} placeholder="Pathogen vs commensal / contaminant rationale" />
                </Box>
              </Box>
            </Box>
          ))}
          <Button onClick={() => addOrganism({})} sx={{ ...outlineBtnSx, px: 2.5 }}>
            <AddRounded sx={{ mr: 0.75, fontSize: 18 }} /> Add Organism
          </Button>
        </SectionBox>
      </Box>

      {/* Antimicrobial recommendation + cascade confirmation */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title="Antimicrobial & stewardship commentary">
          {/* Speech-to-text dictation — fills the section's empty fields only */}
          <Box sx={{ border: `1px solid ${C.border}`, background: C.bgSecondary, p: 2, mb: 2.5 }}>
            <Typography sx={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textSecond, fontFamily: FONT, mb: 1 }}>
              Speech-to-text commentary dictation
            </Typography>
            <TextField
              multiline
              minRows={2}
              fullWidth
              size="small"
              placeholder='Dictate or type the antimicrobial & stewardship commentary, e.g. "recommend ceftriaxone 1 g once daily for 7 days; avoid meropenem; de-escalate to oral once susceptible per AST; CLSI M100". Autofill fills the empty commentary fields below only — nothing already entered is overwritten or cleared.'
              value={transcript}
              onChange={(e) => setTranscript(e.target.value)}
              sx={{ ...inputSx, background: C.white }}
            />
            <Box sx={{ display: "flex", gap: 1.5, mt: 1.5, flexWrap: "wrap", alignItems: "center" }}>
              <Button
                sx={{
                  ...outlineBtnSx,
                  background: isRecording ? "#cf1322" : C.white,
                  color: isRecording ? C.white : C.black,
                  borderColor: isRecording ? "#cf1322" : C.black,
                  "&:hover": { background: isRecording ? "#a8071a" : C.bgTertiary },
                }}
                onClick={isRecording ? stopCommentaryRecording : startCommentaryRecording}
                disabled={isTranscribing || isAutofilling}
              >
                {isRecording ? <StopRounded sx={{ mr: 0.75, fontSize: 16 }} /> : <MicRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                {isTranscribing ? "Transcribing..." : isRecording ? "Stop Recording" : "Start Recording"}
              </Button>
              <Button sx={outlineBtnSx} onClick={applyCommentaryDictation} disabled={commentaryBusy || !transcript.trim()}>
                {isAutofilling ? <CircularProgress size={14} sx={{ mr: 1, color: C.black }} /> : <AutoAwesomeRounded sx={{ mr: 0.75, fontSize: 16 }} />}
                AI Autofill Empty Commentary Fields
              </Button>
            </Box>
          </Box>

          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5, mb: 1.5 }}>
            <Box>
              <FieldLabel>Recommended drug(s) + dose suggestion</FieldLabel>
              <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={form.antimicrobial.recommended} onChange={(e) => patchNested("antimicrobial", { recommended: e.target.value })} />
            </Box>
            <Box>
              <FieldLabel>Drugs to avoid (resistance / allergy)</FieldLabel>
              <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={form.antimicrobial.avoid} onChange={(e) => patchNested("antimicrobial", { avoid: e.target.value })} />
            </Box>
          </Box>
          <Box sx={{ mb: 1.5 }}>
            <FieldLabel>De-escalation / step-down note</FieldLabel>
            <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={form.antimicrobial.de_escalation} onChange={(e) => patchNested("antimicrobial", { de_escalation: e.target.value })} placeholder="e.g. switch meropenem → nitrofurantoin for uncomplicated ESBL-UTI once susceptible" />
          </Box>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr" }, gap: 1.5 }}>
            <Box>
              <FieldLabel>CLSI M100 / antibiogram reference</FieldLabel>
              <TextField size="small" fullWidth sx={inputSx} value={form.antimicrobial.clsi_reference} onChange={(e) => patchNested("antimicrobial", { clsi_reference: e.target.value })} />
            </Box>
            <Box>
              <FieldLabel>Cascade suppression note</FieldLabel>
              <TextField size="small" fullWidth sx={inputSx} value={form.cascade_confirm.note} onChange={(e) => patchNested("cascade_confirm", { note: e.target.value })} placeholder="Confirm suppressed agents / any overrides from Tab 5C" />
            </Box>
          </Box>
        </SectionBox>
      </Box>

      {/* Confirmation */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title="Microbiologist confirmation">
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr" }, gap: 1.5 }}>
            <Box>
              <FieldLabel>Name</FieldLabel>
              <TextField size="small" fullWidth sx={inputSx} value={form.confirmation.name} onChange={(e) => patchNested("confirmation", { name: e.target.value })} />
            </Box>
            <Box>
              <FieldLabel>Credentials</FieldLabel>
              <TextField size="small" fullWidth sx={inputSx} value={form.confirmation.credentials} onChange={(e) => patchNested("confirmation", { credentials: e.target.value })} />
            </Box>
            <Box>
              <FieldLabel>Confirmed at</FieldLabel>
              <TextField size="small" fullWidth type="datetime-local" sx={inputSx} value={form.confirmation.confirmed_at} onChange={(e) => patchNested("confirmation", { confirmed_at: e.target.value })} InputLabelProps={{ shrink: true }} />
            </Box>
          </Box>
        </SectionBox>
      </Box>

      {notice && (
        <Box sx={{ my: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, pb: 1 }}>
        <Button onClick={() => saveInterpretation(false)} disabled={isSaving} sx={outlineBtnSx}>
          <SaveOutlined sx={{ mr: 0.5, fontSize: 16 }} /> Save Interpretation
        </Button>
        <Button onClick={() => saveInterpretation(true)} disabled={isSaving || !advisory} sx={{ ...saveBtnSx, px: 3 }}>
          Save & Keep Advisory
        </Button>
      </Box>
    </Box>
  );
}
