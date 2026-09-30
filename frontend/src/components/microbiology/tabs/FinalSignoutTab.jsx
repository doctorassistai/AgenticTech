// tabs/FinalSignoutTab.jsx — Microbiology Tab 14: Final sign-out
//
// The terminal tab: the microbiologist reviews all tracks together, composes the
// final report, confirms the interpretation, and signs out. Sign-out flips the
// case to "Signed-out" and locks every section (server-enforced).
//
// Stored shape (final_report section):
//   final_report = {
//     report_status,                // Draft | Final (only Final is signable)
//     report_body,                  // final free-text wording
//     organisms: [ { key, organism, quantity, significance } ],   // seeded from evidence
//     comments: {                   // coded comment library — reported as its own
//       selected: [ "<comment>" ],  //   block, NEVER merged into report_body
//       note,                       // free-text "additional comment"
//     },
//     diagnosis: {                  // structured clinical conclusion
//       infection_site, acquisition, onset_date,
//       device_associated, device_detail, certainty,
//       causative_organism,         // chosen from the organism rows above
//       primary,                    // diagnosis statement
//       secondary: [ { key, text } ],
//     },
//     stewardship: {                // final therapy advice issued WITH the report
//       reviewed, final_recommendation, duration,
//       iv_to_oral, de_escalation, restricted_approval,
//     },
//     icd10: { organism_code, site_code },
//     resistance_mechanisms,        // free-text notes
//     checklist: { [key]: bool },   // derived + user-confirmed readiness items
//     confirmation: { confirmed, confirmed_by, confirmed_at },
//     reviewer: { id, name, credentials, signed_out_at },
//   }
//
// Everything except the ESSENTIAL blockers is advisory: the diagnosis, coded
// comments and stewardship record are captured but do not gate sign-out.
//
// The reported-only AST table is derived READ-ONLY here by re-running the Tab 5C
// cascade engine over the stored culture isolates (intrinsic + first-line-S
// suppression applied), so the final report shows exactly what would be reported.
//
// Sign Out calls the backend /sign-out endpoint; the server enforces the ESSENTIAL
// blockers (status Final, report body, Tab 12 interpretation confirmed, critical/
// notifiable prelims dispatched).

import React, { useEffect, useMemo, useState } from "react";
import {
  Box, Typography, TextField, Button, Checkbox, FormControlLabel, IconButton,
} from "@mui/material";
import {
  AddRounded, DeleteOutlineRounded, LockRounded, PictureAsPdfRounded, SaveRounded,
} from "@mui/icons-material";
import {
  C, FONT, inputSx, saveBtnSx, outlineBtnSx,
} from "../../shared/designTokens";
import {
  SectionBox, FieldLabel, Sel, FlagNote,
} from "../../shared/FormComponents";
import {
  FINAL_REPORT_STATUS_OPTIONS,
  FINAL_INFECTION_SITE_OPTIONS,
  FINAL_ACQUISITION_OPTIONS,
  FINAL_DEVICE_ASSOCIATED_OPTIONS,
  FINAL_DIAGNOSIS_CERTAINTY_OPTIONS,
  FINAL_REPORT_COMMENT_OPTIONS,
  FINAL_STEWARDSHIP_REVIEWED_OPTIONS,
  FINAL_IV_ORAL_OPTIONS,
  ICD10_ORGANISM_CODE_OPTIONS,
  ICD10_SITE_CODE_OPTIONS,
  FINAL_CHECKLIST,
  PGX_CASE_TYPE,
  pgxTestsFor,
} from "../constants";
import {
  hasPgxContent,
  pgxReportRows,
  pgxLimitations,
  collectKnownFindings,
  pgxCarriedForwardRows,
  pgxCarriedForwardConflicts,
} from "../shared/genomics";
import { resolveAstProfile, applyCascade } from "../shared/cascade";
import { buildFinalReportPdf, finalReportFilename } from "../shared/finalReportPdf";

const makeKey = () =>
  globalThis.crypto?.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

const blankForm = (doctorName) => ({
  report_status: "Draft",
  report_body: "",
  organisms: [],
  comments: { selected: [], note: "" },
  diagnosis: {
    infection_site: "",
    acquisition: "",
    onset_date: "",
    device_associated: "",
    device_detail: "",
    certainty: "",
    causative_organism: "",
    primary: "",
    secondary: [],
  },
  stewardship: {
    reviewed: "",
    final_recommendation: "",
    duration: "",
    iv_to_oral: "",
    de_escalation: "",
    restricted_approval: "",
  },
  icd10: { organism_code: "", site_code: "" },
  resistance_mechanisms: "",
  checklist: {},
  confirmation: { confirmed: false, confirmed_by: doctorName || "", confirmed_at: "" },
  reviewer: { id: "", name: doctorName || "", credentials: "", signed_out_at: "" },
});

const hydrate = (initialData, doctorName) => {
  const src = (initialData && typeof initialData === "object") ? initialData : {};
  const blank = blankForm(doctorName);
  return {
    report_status: src.report_status || "Draft",
    report_body: src.report_body || "",
    organisms: Array.isArray(src.organisms)
      ? src.organisms.map((o) => ({ key: o.key || makeKey(), organism: o.organism || "", quantity: o.quantity || "", significance: o.significance || "" }))
      : [],
    comments: {
      selected: Array.isArray(src.comments?.selected) ? src.comments.selected : [],
      note: src.comments?.note || "",
    },
    diagnosis: {
      ...blank.diagnosis,
      ...(src.diagnosis || {}),
      secondary: Array.isArray(src.diagnosis?.secondary)
        ? src.diagnosis.secondary.map((s) => ({ key: s.key || makeKey(), text: s.text || "" }))
        : [],
    },
    stewardship: { ...blank.stewardship, ...(src.stewardship || {}) },
    icd10: { ...blank.icd10, ...(src.icd10 || {}) },
    resistance_mechanisms: src.resistance_mechanisms || "",
    checklist: { ...(src.checklist || {}) },
    confirmation: { ...blank.confirmation, ...(src.confirmation || {}) },
    reviewer: { ...blank.reviewer, ...(src.reviewer || {}) },
  };
};

// ─── Reported-only AST derivation (mirror of Tab 5C) ─────────────────────────

function reportedAstRows(cultureWorkup, caseRegister) {
  const rows = [];
  const typeBySpecimen = {};
  (Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : []).forEach((sp) => {
    if (sp.specimen_id) typeBySpecimen[sp.specimen_id] = sp.specimen_type || "";
  });
  if (!cultureWorkup || typeof cultureWorkup !== "object") return rows;
  Object.entries(cultureWorkup).forEach(([specimenId, block]) => {
    const specimenType = typeBySpecimen[specimenId] || "";
    (block?.isolates || []).forEach((iso) => {
      if (!iso.organism) return;
      const profile = resolveAstProfile(iso.organism, specimenType);
      const applied = applyCascade(profile, iso.ast?.antibiotics || [], { specimenType });
      applied.filter((r) => r.reported && r.interpretation).forEach((r) => {
        rows.push({ organism: iso.organism, family: profile.label || "", antibiotic: r.antibiotic, interpretation: r.interpretation });
      });
    });
  });
  return rows;
}

// ─── Layout helpers ──────────────────────────────────────────────────────────
// The vertical rhythm lives here and nowhere else: sections are plain siblings
// (their spacing is SECTION_GAP, which overrides SectionBox's own mb), groups
// inside a section are separated by a hairline rule, fields by the grid gap.
// That gives one clear progression — fields < groups < sections — instead of a
// mix of `mt` wrappers and the box's built-in margin.

const SECTION_GAP = { mb: 3.5 };

// Responsive field grid: one column on small screens, `cols` equal columns from
// md up — or pass `template` for an uneven split (e.g. "1fr 2fr"). minmax(0, 1fr)
// keeps a long value from blowing a column out.
const Fields = ({ cols = 2, template, children }) => (
  <Box
    sx={{
      display: "grid",
      gridTemplateColumns: template
        ? { xs: "1fr", md: template }
        : { xs: "1fr", md: `repeat(${cols}, minmax(0, 1fr))` },
      gap: 2,
    }}
  >
    {children}
  </Box>
);

// A labelled sub-block within a section — groups related fields without nesting
// another bordered box. Drop `last` on the final group so it carries no rule.
const Group = ({ title, children, last = false }) => (
  <Box sx={{ pb: last ? 0 : 2.5, mb: last ? 0 : 2.5, borderBottom: last ? "none" : `1px solid ${C.border}` }}>
    {title && (
      <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.14em", color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
        {title}
      </Typography>
    )}
    {children}
  </Box>
);

// A labelled field: the uppercase label sits above the control, as everywhere
// else in the module. `hint` is the small muted note some fields need.
const Field = ({ label, hint, children }) => (
  <Box sx={{ minWidth: 0 }}>
    <FieldLabel>{label}</FieldLabel>
    {children}
    {hint && <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 0.5 }}>{hint}</Typography>}
  </Box>
);

// A read-only figure with its caption, for the source summary.
const Stat = ({ label, children }) => (
  <Box sx={{ px: 1.5, py: 1.25, border: `1px solid ${C.border}`, background: C.bgSecondary, minWidth: 0 }}>
    <Typography sx={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.12em", color: C.textMuted, fontFamily: FONT, mb: 0.5 }}>
      {label}
    </Typography>
    <Typography sx={{ fontSize: 13, fontFamily: FONT, color: C.textPrimary }}>{children}</Typography>
  </Box>
);

// The muted "nothing here yet" line every list needs.
const Empty = ({ children }) => (
  <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 1 }}>{children}</Typography>
);

// ─── Advisory echo ────────────────────────────────────────────────────────────
// The final report draws its advisory content from the TWO tab-level briefs, one
// per half — Tab 12 owns the infection half, Tab 16 the pharmacogenomic half —
// rather than making a third model call. Each field therefore has exactly one
// source, so the report view cannot contradict the tab views, and there is no
// aggregation prompt to keep in step.
//
// Both are stored as { run_at, status, output }. Unwrap defensively: an older run
// may hold the output object directly.

const readAdvisory = (section) => {
  const stored = section && section.advisory;
  if (!stored) return null;
  const output = stored.output && typeof stored.output === "object" ? stored.output : stored;
  // The spread carries every stored field, including engine_version — kept in the
  // document for audit, deliberately not rendered. It names the model and prompt
  // revision, which is an implementation detail a report reader has no use for.
  return { ...output, run_at: stored.run_at || output.run_at || "" };
};

const advisoryList = (v) => (Array.isArray(v) ? v.filter(Boolean) : []);

// The stamp is not decoration. A brief kept from weeks ago describes a result that
// may since have changed, and a reader of the report has to be able to see that.
const AdvisoryStamp = ({ advisory }) => (
  <Box sx={{ px: 1.5, py: 1.25, mb: 1.75, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
    <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>
      Advisory only — a reading of what is recorded, not part of the report body. Answering the
      report remains the microbiologist's.
    </Typography>
    <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted, mt: 0.25 }}>
      {advisory.run_at ? `Generated ${new Date(advisory.run_at).toLocaleString()}` : "Generation time not recorded"}
    </Typography>
  </Box>
);

const AdvisoryText = ({ text }) => (
  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, lineHeight: 1.6, mb: 1.5 }}>
    {text}
  </Typography>
);

const AdvisoryList = ({ label, items, strong = false }) => {
  const list = advisoryList(items);
  if (list.length === 0) return null;
  return (
    <Box sx={{ mb: 1.5 }}>
      <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.4 }}>
        {label}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75 }}>
        {list.map((t, i) => (
          <Box key={i} sx={{ px: 1.25, py: 0.5, border: `1px solid ${strong ? C.black : C.border}`, background: C.bgTertiary }}>
            <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond }}>{t}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default function FinalSignoutTab({
  doctorId,
  doctorName,
  caseId,
  isSignedOut,
  signedOutAt,
  initialData,        // final_report section
  caseRegister,       // case_register (clinical context + specimens)
  directExamination,  // Tab 3
  cultureWorkup,      // Tab 5
  molecular,          // Tab 8
  serology,           // Tab 9
  mycobacteriology,   // Tab 10
  pathogenGenomics,   // Tab 15 — printed per specimen with the other tracks
  humanGenomics,      // Tab 16 — printed once, case-level (lifelong patient finding)
  cases,              // the patient's case list — the PGx register reads it
  preliminaryReports, // Tab 11
  interpretation,     // Tab 12
  infectionControl,   // Tab 13
  onSave,             // (tabKey, data) dispatch — "final-signout"
  onSignOut,          // () => call backend sign-out (final_report already saved)
}) {
  const [form, setForm] = useState(() => blankForm(doctorName));
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState("");

  const specimens = Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : [];

  useEffect(() => {
    setForm(hydrate(initialData, doctorName));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId]);

  // Evidence-derived readiness flags for the checklist (read-only input).
  const interpConfirmed = Boolean(interpretation?.confirmation?.name && interpretation?.confirmation?.confirmed_at);
  const prelims = Array.isArray(preliminaryReports?.versions) ? preliminaryReports.versions : [];
  const criticalPrelims = prelims.filter((v) => v.critical || v.notifiable);
  const icAlerts = Array.isArray(infectionControl?.alerts) ? infectionControl.alerts : [];
  const criticalDispatched = criticalPrelims.length === 0 || icAlerts.some((a) => a.acknowledged === "Yes" || a.notified_to || a.notified_at);

  // Derived / confirmed checklist state. Items the module cannot fully verify
  // at sign-out (windows, QC history, cascade override acceptance) are shown as
  // informational and not used to block — only the essentials gate below.
  // ── Report shape, gated on CONTENT rather than case type ───────────────────
  // A Combined case can hold an infection and a pharmacogenomic panel at once, so
  // the report follows what the case actually contains rather than what it is
  // called. A pure PGx case shows the PGx half only; a Combined case shows
  // whichever halves it has, and defaults to the infection half because its case
  // type can carry one.
  const isPgxCase = caseRegister?.case_type === PGX_CASE_TYPE;
  // A PGx ORDER with nothing entered yet still counts as carrying PGx. That is the
  // pre-emptive case — test once, prescribe later — and it is exactly the one whose
  // report has to show what an earlier case already established.
  const pgxOrdered = specimens.some((sp) => pgxTestsFor(sp?.tests_ordered).length > 0);
  const showPgx = isPgxCase || pgxOrdered || hasPgxContent(humanGenomics);
  const infectionPresent = [directExamination, cultureWorkup, molecular, serology, mycobacteriology, pathogenGenomics]
    .some((s) => s && Object.keys(s).length > 0);
  const showInfection = !isPgxCase || infectionPresent;

  // Same rows and limitations the printed PDF uses (shared/genomics.js), so the
  // recap here and the report cannot describe the same result differently.
  const pgxRows = useMemo(() => pgxReportRows(humanGenomics), [humanGenomics]);
  const pgxNotes = useMemo(() => pgxLimitations(humanGenomics), [humanGenomics]);
  // Findings established by the patient's OTHER cases, carried onto this report.
  // Computed from the case list Registration already loads, so this recap and Tab
  // 16's register cannot disagree about what is already known. `humanGenomics` is
  // the third argument only so a finding also recorded here is labelled as such.
  const carriedForward = useMemo(
    () => collectKnownFindings(cases, caseId, humanGenomics),
    [cases, caseId, humanGenomics],
  );
  const pgxCarried = useMemo(() => pgxCarriedForwardRows(carriedForward), [carriedForward]);
  const pgxConflicts = useMemo(() => pgxCarriedForwardConflicts(carriedForward), [carriedForward]);

  // The two halves' briefs, read from the section that owns each.
  const interpAdvisory = readAdvisory(interpretation);
  const pgxBrief = readAdvisory(humanGenomics);

  // PGx drug chips derive from drug_actions by action string — the same rule Tab 16
  // applies, so the report and the tab cannot disagree about which drugs to act on.
  const pgxActions = (Array.isArray(pgxBrief?.drug_actions) ? pgxBrief.drug_actions : []).filter((d) => d?.drug);
  const actionOf = (d) => String(d.action || "");
  const pgxAvoid = pgxActions.filter((d) => actionOf(d).startsWith("Avoid")).map((d) => d.drug);
  const pgxAdjust = pgxActions
    .filter((d) => /^(Reduce|Increase) starting dose/.test(actionOf(d)))
    .map((d) => d.drug);

  const checklistValues = useMemo(() => {
    const anyCultureWork = cultureWorkup && Object.keys(cultureWorkup).length > 0
      && Object.values(cultureWorkup).some((b) => (b?.isolates || []).length > 0 || (b?.reads || []).some((r) => r.plate_growth));
    return {
      ordered_tests_results: true,     // per-test result tracking is per-tab, not re-verified here
      ast_qc_passed: true,             // QC-out-of-range is surfaced per-run in Tab 5
      critical_notified: criticalDispatched,
      interpretation_confirmed: interpConfirmed,
      windows_closed: true,            // window state lives in Tab 4/5
      cascade_confirmed: true,         // cascade re-applied live above
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cultureWorkup, criticalDispatched, interpConfirmed]);

  // Server-enforced essentials — the items that actually gate sign-out here.
  // Mirrors the backend's blocker list, including the one it SKIPS: a case type
  // that never offers Tab 12 cannot satisfy the interpretation confirmation, so
  // neither side requires it (see CASE_TYPES_WITHOUT_INTERPRETATION in
  // microbiology.py). Such a case keeps the other three.
  const essentials = [
    ["status_final", form.report_status === "Final", "Report status must be Final"],
    ["body_present", String(form.report_body || "").trim() !== "", "Final report body is required"],
    ...(isPgxCase
      ? []
      : [["interp_confirmed", interpConfirmed, "Clinical interpretation must be confirmed (Tab 12)"]]),
    ["critical_dispatched", criticalDispatched, "Critical / notifiable preliminaries need a recorded dispatch (Tab 13)"],
  ];
  const essentialBlockers = essentials.filter(([, ok]) => !ok).map(([, , label]) => label);
  const readyToSign = essentialBlockers.length === 0 && form.confirmation.confirmed;

  const astRows = useMemo(() => reportedAstRows(cultureWorkup, caseRegister), [cultureWorkup, caseRegister]);

  // Causative-organism options for the structured diagnosis: the distinct names
  // already listed in the organism rows (case-insensitively deduped, first
  // spelling wins). A previously saved value that no longer matches any row is
  // kept in the list so it stays visible instead of silently rendering blank.
  const causativeOrganismOptions = useMemo(() => {
    const byKey = new Map();
    form.organisms.forEach((o) => {
      const name = String(o.organism || "").trim();
      if (name && !byKey.has(name.toLowerCase())) byKey.set(name.toLowerCase(), name);
    });
    const names = [...byKey.values()];
    const chosen = String(form.diagnosis.causative_organism || "").trim();
    if (chosen && !names.some((n) => n.toLowerCase() === chosen.toLowerCase())) names.push(chosen);
    return names;
  }, [form.organisms, form.diagnosis.causative_organism]);

  // Tab 12's antimicrobial commentary, shown read-only beside the sign-out
  // stewardship record so the microbiologist sees what was recommended before
  // recording what was finally advised.
  const interpAntimicrobial = interpretation?.antimicrobial || {};
  const interpAntimicrobialRows = [
    ["Recommended", interpAntimicrobial.recommended],
    ["Avoid", interpAntimicrobial.avoid],
    ["De-escalation", interpAntimicrobial.de_escalation],
    ["CLSI reference", interpAntimicrobial.clsi_reference],
  ].filter(([, v]) => String(v || "").trim());

  const patch = (patchObj) => setForm((prev) => ({ ...prev, ...patchObj }));
  const patchNested = (group, patchObj) =>
    setForm((prev) => ({ ...prev, [group]: { ...prev[group], ...patchObj } }));

  const patchOrganism = (key, patchObj) =>
    setForm((prev) => ({ ...prev, organisms: prev.organisms.map((o) => (o.key === key ? { ...o, ...patchObj } : o)) }));
  const addOrganism = () =>
    setForm((prev) => ({ ...prev, organisms: [...prev.organisms, { key: makeKey(), organism: "", quantity: "", significance: "" }] }));
  const removeOrganism = (key) =>
    setForm((prev) => ({ ...prev, organisms: prev.organisms.filter((o) => o.key !== key) }));

  // Coded comment library — ticking a comment writes comments.selected only; the
  // report body is never composed from it.
  const toggleComment = (comment) =>
    setForm((prev) => {
      const selected = prev.comments.selected.includes(comment)
        ? prev.comments.selected.filter((c) => c !== comment)
        : [...prev.comments.selected, comment];
      return { ...prev, comments: { ...prev.comments, selected } };
    });

  const patchSecondary = (key, text) =>
    setForm((prev) => ({
      ...prev,
      diagnosis: { ...prev.diagnosis, secondary: prev.diagnosis.secondary.map((s) => (s.key === key ? { ...s, text } : s)) },
    }));
  const addSecondary = () =>
    setForm((prev) => ({
      ...prev,
      diagnosis: { ...prev.diagnosis, secondary: [...prev.diagnosis.secondary, { key: makeKey(), text: "" }] },
    }));
  const removeSecondary = (key) =>
    setForm((prev) => ({
      ...prev,
      diagnosis: { ...prev.diagnosis, secondary: prev.diagnosis.secondary.filter((s) => s.key !== key) },
    }));

  // Seed organisms from confirmed culture isolates / myco species.
  const seedOrganisms = () => {
    const seen = new Set(form.organisms.map((o) => o.organism.toLowerCase()));
    const seeds = [];
    (cultureWorkup && typeof cultureWorkup === "object" ? Object.values(cultureWorkup) : []).forEach((b) => {
      (b?.isolates || []).forEach((iso) => {
        if (iso.organism && !seen.has(iso.organism.toLowerCase())) { seen.add(iso.organism.toLowerCase()); seeds.push({ organism: iso.organism }); }
      });
    });
    (mycobacteriology && typeof mycobacteriology === "object" ? Object.values(mycobacteriology) : []).forEach((b) => {
      (b?.isolates || []).forEach((iso) => {
        if (iso.species && !seen.has(iso.species.toLowerCase())) { seen.add(iso.species.toLowerCase()); seeds.push({ organism: iso.species }); }
      });
    });
    if (seeds.length === 0) seeds.push({});
    setForm((prev) => ({ ...prev, organisms: [...prev.organisms, ...seeds.map((s) => ({ key: makeKey(), organism: s.organism || "", quantity: "", significance: "" }))] }));
  };

  const confirm = () => {
    const already = form.confirmation.confirmed;
    setForm((prev) => ({
      ...prev,
      confirmation: already
        ? { confirmed: false, confirmed_by: doctorName || "", confirmed_at: "" }
        : { confirmed: true, confirmed_by: doctorName || doctorId || "", confirmed_at: new Date().toISOString() },
      reviewer: { ...prev.reviewer, id: doctorId || prev.reviewer.id, name: doctorName || prev.reviewer.name },
    }));
  };

  const save = async () => {
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("final-signout", form);
    } catch (err) {
      console.error("[FinalSignoutTab] save error:", err);
    } finally {
      setIsSaving(false);
    }
  };

  // Builds the printable report from what is currently on screen (the `form`
  // state, not the last saved section), so an edit made and not yet saved is
  // still what gets printed. Nothing is written back.
  const exportPdf = () => {
    setNotice("");
    try {
      const doc = buildFinalReportPdf({
        caseRegister,
        finalReport: form,
        directExamination,
        cultureWorkup,
        molecular,
        serology,
        mycobacteriology,
        pathogenGenomics,
        humanGenomics,
        carriedForward,
        reportedAstRows: astRows,
        doctorName,
        caseId,
        signedOutAt,
      });
      doc.save(finalReportFilename(caseRegister, caseId));
    } catch (err) {
      console.error("[FinalSignoutTab] PDF export error:", err);
      setNotice("Could not generate the PDF — see the browser console.");
    }
  };

  const doSignOut = async () => {
    if (!readyToSign) { setNotice("Sign-out blocked — complete the checklist, set report status Final, write the report body, and confirm."); return; }
    setIsSaving(true);
    setNotice("");
    try {
      await onSave("final-signout", { ...form, confirmation: { ...form.confirmation, confirmed: true, confirmed_at: form.confirmation.confirmed_at || new Date().toISOString() }, reviewer: { ...form.reviewer, name: doctorName || form.reviewer.name, signed_out_at: new Date().toISOString() } });
      await onSignOut();
    } catch (err) {
      console.error("[FinalSignoutTab] sign-out error:", err);
      setNotice("Sign-out failed — see server blockers.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Final report + sign-out. Review all tracks, confirm the interpretation (Tab 12), compose the report, then sign out.
        Signing out locks every section.
      </Typography>

      {/* Read-only source summaries */}
      <SectionBox title="Case summary (read-only)" style={SECTION_GAP}>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(165px, 1fr))", gap: 2 }}>
          <Stat label="Specimens">{specimens.length}</Stat>
          <Stat label="Preliminary reports issued">{prelims.length}</Stat>
          <Stat label="Critical / notifiable">{criticalPrelims.length}</Stat>
          <Stat label="Tab 13 dispatches">{icAlerts.length}</Stat>
          <Stat label="Tab 12 interpretation">
            {interpConfirmed ? `Confirmed — ${interpretation.confirmation.name}` : "Not yet confirmed"}
          </Stat>
        </Box>
      </SectionBox>

      {/* Final report composition */}
      <SectionBox title="Final report composition" style={SECTION_GAP}>
        <Group title="Report">
          {/* Status on its own row and the multi-line body on the next: a fixed
              height select beside a textarea would leave dead space beneath it. */}
          <Fields cols={3}>
            <Field label="Report status">
              <Sel label="Report status" options={FINAL_REPORT_STATUS_OPTIONS} value={form.report_status} onChange={(v) => patch({ report_status: v })} />
            </Field>
          </Fields>
          <Box sx={{ mt: 2 }}>
            <Field label="Report body">
              <TextField size="small" fullWidth multiline rows={4} sx={inputSx} value={form.report_body} onChange={(e) => patch({ report_body: e.target.value })} placeholder="Final wording — organisms, significance, susceptibility, interpretation." />
            </Field>
          </Box>
        </Group>

        <Group title="Organisms reported">
          {form.organisms.length === 0 && (
            <Empty>No organisms listed yet — add one, or seed them from the confirmed isolates.</Empty>
          )}
          {form.organisms.length > 0 && (
            // Column headers, aligned to the row grid below and hidden on small
            // screens where the rows stack and the placeholders carry the meaning.
            <Box sx={{ display: { xs: "none", md: "grid" }, gridTemplateColumns: "2fr 1fr 1fr auto", gap: 2, mb: 0.75 }}>
              {["Species", "Quantity", "Significance", ""].map((label, i) => (
                <Typography key={i} sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {label}
                </Typography>
              ))}
            </Box>
          )}
          {form.organisms.map((o) => (
            <Box key={o.key} sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", md: "2fr 1fr 1fr auto" }, gap: 2, alignItems: "center", mb: 1 }}>
              <TextField size="small" fullWidth sx={inputSx} placeholder="Species" value={o.organism} onChange={(e) => patchOrganism(o.key, { organism: e.target.value })} />
              <TextField size="small" fullWidth sx={inputSx} placeholder="Quantity" value={o.quantity} onChange={(e) => patchOrganism(o.key, { quantity: e.target.value })} />
              <TextField size="small" fullWidth sx={inputSx} placeholder="Significance" value={o.significance} onChange={(e) => patchOrganism(o.key, { significance: e.target.value })} />
              <IconButton size="small" onClick={() => removeOrganism(o.key)} sx={{ justifySelf: "end", color: C.textSecond, "&:hover": { color: C.black } }}><DeleteOutlineRounded fontSize="small" /></IconButton>
            </Box>
          ))}
          <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", mt: 1.5 }}>
            <Button onClick={addOrganism} sx={{ ...outlineBtnSx, px: 2, py: 0.5, fontSize: 11 }}><AddRounded sx={{ mr: 0.5, fontSize: 14 }} /> Add organism</Button>
            <Button onClick={seedOrganisms} sx={{ ...outlineBtnSx, px: 2, py: 0.5, fontSize: 11 }}>Seed from confirmed isolates</Button>
          </Box>
        </Group>

        <Group title="Coding & resistance" last>
          <Fields cols={2}>
            <Field label="ICD-10 organism code">
              <Sel label="ICD-10 organism" options={ICD10_ORGANISM_CODE_OPTIONS} value={form.icd10.organism_code} onChange={(v) => patchNested("icd10", { organism_code: v })} />
            </Field>
            <Field label="ICD-10 site code">
              <Sel label="ICD-10 site" options={ICD10_SITE_CODE_OPTIONS} value={form.icd10.site_code} onChange={(v) => patchNested("icd10", { site_code: v })} />
            </Field>
          </Fields>
          <Box sx={{ mt: 2 }}>
            <Field label="Resistance mechanisms">
              <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={form.resistance_mechanisms} onChange={(e) => patch({ resistance_mechanisms: e.target.value })} placeholder="e.g. ESBL, MRSA (mecA), rifampicin-resistant MTB…" />
            </Field>
          </Box>
        </Group>
      </SectionBox>

      {/* Coded report comments */}
      <SectionBox title="Report comments" style={SECTION_GAP}>
        <Group title="Standard comments">
          <Typography sx={{ fontSize: 11.5, color: C.textMuted, fontFamily: FONT, mb: 1.5 }}>
            Reported as their own block alongside the report body — they are never merged into the body text, so
            anything written above stays exactly as typed.
          </Typography>
          <Box sx={{ display: "grid", gap: 0.25 }}>
            {FINAL_REPORT_COMMENT_OPTIONS.map((comment) => {
              const checked = form.comments.selected.includes(comment);
              return (
                <FormControlLabel
                  key={comment}
                  sx={{ display: "flex", alignItems: "flex-start", mr: 0 }}
                  control={<Checkbox size="small" checked={checked} onChange={() => toggleComment(comment)} sx={{ color: checked ? C.black : C.border, pt: 0.25 }} />}
                  label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: checked ? C.textPrimary : C.textSecond }}>{comment}</Typography>}
                />
              );
            })}
          </Box>
        </Group>

        <Group title="Additional comment" last>
          <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={form.comments.note} onChange={(e) => patchNested("comments", { note: e.target.value })} placeholder="Anything the standard comment list does not cover." />
        </Group>
      </SectionBox>

      {/* Reported-only AST table */}
      {showInfection && (
      <SectionBox title={`Reported-only AST (cascade applied — ${astRows.length})`} style={SECTION_GAP}>
        {astRows.length === 0 && (
          <Empty>No reported AST rows yet — confirmed isolates with susceptible/reported results will appear here.</Empty>
        )}
        {astRows.length > 0 && (
          <Box sx={{ overflowX: "auto" }}>
            <Box sx={{ minWidth: 520 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1.5fr 1fr", px: 1, pb: 0.5, borderBottom: `1px solid ${C.border}` }}>
                {["Organism", "Family", "Antibiotic", "Result"].map((h) => (
                  <Typography key={h} sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</Typography>
                ))}
              </Box>
              {astRows.map((r, i) => (
                <Box key={i} sx={{ display: "grid", gridTemplateColumns: "2fr 1.2fr 1.5fr 1fr", px: 1, py: 0.5, borderBottom: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>{r.organism}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{r.family || "—"}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>{r.antibiotic}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>{r.interpretation}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}
        <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 1.5 }}>
          Derived live from the culture workup via the CLSI M100 cascade engine — suppressed/intrinsic-resistance rows are excluded.
        </Typography>
      </SectionBox>
      )}

      {/* Structured final diagnosis */}
      {showInfection && (
      <SectionBox title="Final diagnosis" style={SECTION_GAP}>
        <Group title="Infection">
          <Fields cols={3}>
            <Field label="Infection site">
              <Sel label="Infection site" options={FINAL_INFECTION_SITE_OPTIONS} value={form.diagnosis.infection_site} onChange={(v) => patchNested("diagnosis", { infection_site: v })} />
            </Field>
            <Field label="Acquisition">
              <Sel label="Acquisition" options={FINAL_ACQUISITION_OPTIONS} value={form.diagnosis.acquisition} onChange={(v) => patchNested("diagnosis", { acquisition: v })} />
            </Field>
            <Field label="Onset date">
              <TextField size="small" fullWidth type="date" sx={inputSx} value={form.diagnosis.onset_date} onChange={(e) => patchNested("diagnosis", { onset_date: e.target.value })} InputLabelProps={{ shrink: true }} />
            </Field>
          </Fields>
          <Box sx={{ mt: 2 }}>
            <Fields template="1fr 2fr">
              <Field label="Device-associated">
                <Sel label="Device-associated" options={FINAL_DEVICE_ASSOCIATED_OPTIONS} value={form.diagnosis.device_associated} onChange={(v) => patchNested("diagnosis", { device_associated: v })} />
              </Field>
              {form.diagnosis.device_associated && form.diagnosis.device_associated !== "None" && (
                <Field label="Device detail">
                  <TextField size="small" fullWidth sx={inputSx} value={form.diagnosis.device_detail} onChange={(e) => patchNested("diagnosis", { device_detail: e.target.value })} placeholder="Device type, insertion date, duration in situ" />
                </Field>
              )}
            </Fields>
          </Box>
        </Group>

        <Group title="Conclusion" last>
          <Fields template="1fr 2fr">
            <Field label="Diagnostic certainty">
              <Sel label="Diagnostic certainty" options={FINAL_DIAGNOSIS_CERTAINTY_OPTIONS} value={form.diagnosis.certainty} onChange={(v) => patchNested("diagnosis", { certainty: v })} />
            </Field>
            <Field
              label="Causative organism"
              hint={causativeOrganismOptions.length === 0 ? "No organism rows yet — seed or add them under Final report composition above." : undefined}
            >
              <Sel label="Causative organism" options={causativeOrganismOptions} value={form.diagnosis.causative_organism} onChange={(v) => patchNested("diagnosis", { causative_organism: v })} />
            </Field>
          </Fields>
          <Box sx={{ mt: 2 }}>
            <Field label="Primary diagnosis">
              <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={form.diagnosis.primary} onChange={(e) => patchNested("diagnosis", { primary: e.target.value })} placeholder="e.g. Healthcare-associated urinary tract infection with ESBL-producing E. coli bacteraemia" />
            </Field>
          </Box>
          <Box sx={{ mt: 2 }}>
            <FieldLabel>Secondary diagnoses</FieldLabel>
            {form.diagnosis.secondary.length === 0 && <Empty>No secondary diagnoses recorded.</Empty>}
            {form.diagnosis.secondary.map((s) => (
              <Box key={s.key} sx={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 2, alignItems: "center", mb: 1 }}>
                <TextField size="small" fullWidth sx={inputSx} placeholder="Secondary diagnosis" value={s.text} onChange={(e) => patchSecondary(s.key, e.target.value)} />
                <IconButton size="small" onClick={() => removeSecondary(s.key)} sx={{ justifySelf: "end", color: C.textSecond, "&:hover": { color: C.black } }}><DeleteOutlineRounded fontSize="small" /></IconButton>
              </Box>
            ))}
            <Button onClick={addSecondary} sx={{ ...outlineBtnSx, px: 2, py: 0.5, fontSize: 11, mt: 0.5 }}><AddRounded sx={{ mr: 0.5, fontSize: 14 }} /> Add secondary diagnosis</Button>
          </Box>
        </Group>
      </SectionBox>
      )}

      {/* Antimicrobial stewardship at sign-out */}
      {showInfection && (
      <SectionBox title="Antimicrobial stewardship at sign-out" style={SECTION_GAP}>
        <Group title="Recorded in Tab 12 (read-only)">
          <Box sx={{ px: 1.5, py: 1.25, border: `1px solid ${C.border}`, background: C.bgSecondary }}>
            {interpAntimicrobialRows.length > 0 ? (
              <Box sx={{ display: "grid", gap: 0.75 }}>
                {interpAntimicrobialRows.map(([k, v]) => (
                  <Box key={k} sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                    <Box component="span" sx={{ color: C.textMuted, mr: 0.5 }}>{k}:</Box>{v}
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>
                No antimicrobial commentary recorded in Tab 12.
              </Typography>
            )}
          </Box>
        </Group>

        <Group title="Review & route">
          <Fields cols={2}>
            <Field label="Stewardship review">
              <Sel label="Stewardship review" options={FINAL_STEWARDSHIP_REVIEWED_OPTIONS} value={form.stewardship.reviewed} onChange={(v) => patchNested("stewardship", { reviewed: v })} />
            </Field>
            <Field label="IV to oral switch">
              <Sel label="IV to oral switch" options={FINAL_IV_ORAL_OPTIONS} value={form.stewardship.iv_to_oral} onChange={(v) => patchNested("stewardship", { iv_to_oral: v })} />
            </Field>
          </Fields>
        </Group>

        <Group title="Therapy advised with this report" last>
          {/* Paired by height: the two multi-line decisions share a row, the two
              short fields share the next — so neither row leaves dead space. */}
          <Fields template="2fr 1fr">
            <Field label="Final therapy recommendation">
              <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={form.stewardship.final_recommendation} onChange={(e) => patchNested("stewardship", { final_recommendation: e.target.value })} placeholder="Agent, dose and frequency advised with this report" />
            </Field>
            <Field label="De-escalation decision (final)">
              <TextField size="small" fullWidth multiline rows={2} sx={inputSx} value={form.stewardship.de_escalation} onChange={(e) => patchNested("stewardship", { de_escalation: e.target.value })} placeholder="e.g. meropenem → nitrofurantoin once susceptible" />
            </Field>
          </Fields>
          <Box sx={{ mt: 2 }}>
            <Fields cols={2}>
              <Field label="Planned duration">
                <TextField size="small" fullWidth sx={inputSx} value={form.stewardship.duration} onChange={(e) => patchNested("stewardship", { duration: e.target.value })} placeholder="e.g. 7 days" />
              </Field>
              <Field label="Restricted antimicrobial approval">
                <TextField size="small" fullWidth sx={inputSx} value={form.stewardship.restricted_approval} onChange={(e) => patchNested("stewardship", { restricted_approval: e.target.value })} placeholder="Approval reference, if required" />
              </Field>
            </Fields>
          </Box>
          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 1.5 }}>
            The sign-out record of the therapy advised with this report. It does not write back to Tab 12.
          </Typography>
        </Group>
      </SectionBox>
      )}

      {/* AI advisory echo — the infection half, from Tab 12's brief. Its own block
          rather than blended into the report body above: the body is the signed
          record, this is a reading aid, and the two must stay distinguishable. */}
      {showInfection && interpAdvisory && (
        <SectionBox title="AI advisory — infection (read-only)" style={SECTION_GAP}>
          <AdvisoryStamp advisory={interpAdvisory} />
          {interpAdvisory.findings_synopsis && <AdvisoryText text={interpAdvisory.findings_synopsis} />}
          <AdvisoryList label="Therapy direction" items={interpAdvisory.recommendations?.therapy} />
          <AdvisoryList label="Avoid" items={interpAdvisory.recommendations?.avoid} />
          <AdvisoryList label="Further tests" items={interpAdvisory.recommendations?.further_tests} />
          <AdvisoryList label="Follow-up" items={interpAdvisory.recommendations?.follow_up} />
          <AdvisoryList label="Red flags" items={interpAdvisory.recommendations?.red_flags} strong />
          <AdvisoryList label="Infection control" items={interpAdvisory.recommendations?.infection_control} />
          {interpAdvisory.summary && <AdvisoryText text={interpAdvisory.summary} />}
          <AdvisoryList label="Missing information" items={interpAdvisory.missing_information} />
        </SectionBox>
      )}

      {/* Pharmacogenomics — the other half of the report. Read-only: the result is
          recorded in Tab 16 and the dose actions were chosen there. */}
      {showPgx && (
      <SectionBox title="Pharmacogenomics (Tab 16)" style={SECTION_GAP}>
        {/* Two blocks, and the split is the safety feature: one is what this case
            established, the other is what an earlier case did and this one did not
            re-test. A reader must never take the second for a fresh finding, and
            must never read an empty first block as "nothing is wrong here". */}
        <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 }}>
          Established by this case
        </Typography>
        {pgxRows.length === 0 ? (
          <Empty>
            No new pharmacogenomic testing on this case.
            {pgxCarried.length === 0 ? " Record it in Human Genomics (Tab 16)." : ""}
          </Empty>
        ) : (
          <Box sx={{ overflowX: "auto" }}>
            <Box sx={{ minWidth: 520 }}>
              <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.2fr 2fr", px: 1, pb: 0.5, borderBottom: `1px solid ${C.border}` }}>
                {["Gene / allele", "Genotype", "Result", "Action"].map((h) => (
                  <Typography key={h} sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</Typography>
                ))}
              </Box>
              {pgxRows.map((r, i) => (
                <Box key={i} sx={{ display: "grid", gridTemplateColumns: "1fr 1.2fr 1.2fr 2fr", px: 1, py: 0.5, borderBottom: `1px solid ${C.border}` }}>
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>{r.label}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{r.genotype}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>{r.result}</Typography>
                  <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>{r.action}</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {pgxCarried.length > 0 && (
          <Box sx={{ mt: 2 }}>
            <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textSecond, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.75 }}>
              Carried forward — previously established, not re-tested on this case
            </Typography>
            <Box sx={{ overflowX: "auto" }}>
              <Box sx={{ minWidth: 680 }}>
                <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1.1fr 1.1fr 1.8fr 1.4fr", px: 1, pb: 0.5, borderBottom: `1px solid ${C.border}` }}>
                  {["Gene / allele", "Genotype", "Result", "Action", "Established"].map((h) => (
                    <Typography key={h} sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em" }}>{h}</Typography>
                  ))}
                </Box>
                {pgxCarried.map((cells, i) => (
                  <Box key={i} sx={{ display: "grid", gridTemplateColumns: "1fr 1.1fr 1.1fr 1.8fr 1.4fr", px: 1, py: 0.5, borderBottom: `1px solid ${C.border}` }}>
                    {cells.map((cell, j) => (
                      <Typography key={j} sx={{ fontSize: 12.5, fontFamily: FONT, color: j === 0 ? C.textPrimary : C.textSecond }}>
                        {cell}
                      </Typography>
                    ))}
                  </Box>
                ))}
              </Box>
            </Box>
            <Typography sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textSecond, mt: 1, lineHeight: 1.6 }}>
              These results were established on earlier cases for this patient. Pharmacogenomic
              genotype does not change over time, so they remain valid and are not affected by
              this specimen. They were not re-tested here.
            </Typography>
            {pgxConflicts.map((n, i) => (
              <Typography
                key={i}
                sx={{ fontSize: 11.5, fontFamily: FONT, color: C.textPrimary, mt: 0.75, px: 1.25, py: 0.75, border: `1px solid ${C.black}` }}
              >
                ⚠ {n}
              </Typography>
            ))}
          </Box>
        )}

        <Box sx={{ mt: 1.5, display: "grid", gap: 0.5 }}>
          {pgxNotes.map((n, i) => (
            <Typography key={i} sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>{n}</Typography>
          ))}
        </Box>
      </SectionBox>
      )}

      {/* AI advisory echo — the pharmacogenomic half, from Tab 16's brief. Its own
          block, for the same reason as the infection one: the signed record and the
          reading aid stay distinguishable. report_note is offered as suggested
          wording — offered, never inserted. */}
      {showPgx && pgxBrief && (
        <SectionBox title="AI advisory — pharmacogenomics (read-only)" style={SECTION_GAP}>
          <AdvisoryStamp advisory={pgxBrief} />
          {pgxBrief.report_note && (
            <Box sx={{ mb: 1.5 }}>
              <Typography sx={{ fontSize: 10, fontFamily: FONT, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.08em", mb: 0.4 }}>
                Suggested report wording
              </Typography>
              <AdvisoryText text={pgxBrief.report_note} />
            </Box>
          )}
          <AdvisoryList label="Avoid" items={pgxAvoid} />
          <AdvisoryList label="Dose adjustment" items={pgxAdjust} />
          <AdvisoryList label="Safety flags" items={pgxBrief.safety_flags} strong />
          <AdvisoryList label="Not analysed — not the same as normal" items={pgxBrief.not_analysed} />
          <AdvisoryList label="Needs a human decision" items={pgxBrief.guidance_gaps} />
          <AdvisoryList label="Missing information" items={pgxBrief.missing_information} />
        </SectionBox>
      )}

      {/* Pre-sign-out checklist */}
      <SectionBox title="Pre-sign-out checklist" style={SECTION_GAP}>
        <Group title="Advisory read-out">
          <Box sx={{ display: "grid", gap: 0.25 }}>
            {FINAL_CHECKLIST.map(([key, label]) => (
              <FormControlLabel
                key={key}
                sx={{ display: "flex", alignItems: "flex-start", mr: 0 }}
                control={<Checkbox size="small" checked={Boolean(checklistValues[key])} disabled sx={{ color: checklistValues[key] ? C.black : C.border, pt: 0.25 }} />}
                label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: checklistValues[key] ? C.textPrimary : C.textSecond }}>{label}</Typography>}
              />
            ))}
          </Box>
          <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 1 }}>
            These are advisory read-outs. The essentials that gate sign-out are status Final, a report body, Tab 12
            interpretation confirmation, and a recorded dispatch for any critical/notifiable preliminary.
          </Typography>
          {essentialBlockers.length > 0 && <FlagNote>{essentialBlockers.join(" · ")}</FlagNote>}
        </Group>

        <Group title="Confirmation" last>
          <FormControlLabel
            sx={{ display: "flex", alignItems: "flex-start", mr: 0 }}
            control={<Checkbox size="small" checked={form.confirmation.confirmed} onChange={confirm} sx={{ color: form.confirmation.confirmed ? C.black : C.border, pt: 0.25 }} />}
            label={<Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>I confirm that I reviewed this report and its source findings.</Typography>}
          />
          {form.confirmation.confirmed_at && (
            <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, ml: 4, mt: 0.25 }}>
              Confirmed by {form.confirmation.confirmed_by} at {form.confirmation.confirmed_at}
            </Typography>
          )}
        </Group>
      </SectionBox>

      {/* Microbiologist / reviewer */}
      <SectionBox title="Microbiologist / reviewer" style={SECTION_GAP}>
        <Fields cols={2}>
          <Field label="Name">
            <TextField size="small" fullWidth sx={inputSx} value={form.reviewer.name} onChange={(e) => patchNested("reviewer", { name: e.target.value })} />
          </Field>
          <Field label="Credentials">
            <TextField size="small" fullWidth sx={inputSx} value={form.reviewer.credentials} onChange={(e) => patchNested("reviewer", { credentials: e.target.value })} />
          </Field>
        </Fields>
      </SectionBox>

      {isSignedOut && (
        <Box sx={{ px: 2, py: 1.25, border: `1px solid ${C.black}`, background: C.bgSecondary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>
            This case is <b>signed out</b> and locked.
            {signedOutAt ? ` Signed out ${new Date(signedOutAt).toLocaleString()}.` : ""}
          </Typography>
        </Box>
      )}

      {notice && (
        <Box sx={{ mt: 2, px: 2, py: 1.25, border: `1px solid ${C.border}`, background: C.bgTertiary }}>
          <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{notice}</Typography>
        </Box>
      )}

      {/* Export stays available on a signed-out case so an authorised report can
          be re-downloaded; saving and signing out only apply while it is open. */}
      <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1.5, flexWrap: "wrap", mt: 1, pb: 1 }}>
        <Button
          onClick={exportPdf}
          title="Prints the report exactly as shown above, including any edits not yet saved."
          sx={{ ...outlineBtnSx, px: 2.5 }}
        >
          <PictureAsPdfRounded sx={{ mr: 0.5, fontSize: 16 }} /> Export PDF
        </Button>
        {!isSignedOut && (
          <>
            <Button onClick={save} disabled={isSaving} sx={{ ...outlineBtnSx, px: 2.5 }}>
              <SaveRounded sx={{ mr: 0.5, fontSize: 16 }} /> Save Final Report
            </Button>
            <Button onClick={doSignOut} disabled={isSaving} sx={{ ...saveBtnSx, px: 3, background: C.black }}>
              <LockRounded sx={{ mr: 0.5, fontSize: 16 }} /> Sign Out & Lock Report
            </Button>
          </>
        )}
      </Box>
    </Box>
  );
}
