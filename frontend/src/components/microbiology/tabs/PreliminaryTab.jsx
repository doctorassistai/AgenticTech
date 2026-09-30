// tabs/PreliminaryTab.jsx — Microbiology Tab 11: Preliminary & Interim Reporting
//
// READ-ONLY viewer + audit trail. Preliminaries are NOT dispatched from here —
// they are sent inline from the tab where the result originates (Tab 3 Direct
// Exam, Tab 5 Culture Workup, Tab 8 Molecular, Tab 9 Serology, Tab 10
// Mycobacteriology), each appending a versioned entry to
// preliminary_reports.versions[]. This tab renders that history, a derived
// critical/notifiable log, and a lightweight "what is still pending" readout.
// It performs no writes.
//
// The version entries are heterogeneous by source (each source tab stamps a few
// of its own fields), so the viewer renders defensively from a shared set:
//   { version, source_tab, content_type, dispatched_at, dispatched_by,
//     summary, specimen_id?, specimen_type?, result?,
//     critical?, critical_reason?, notifiable?, notifiable_reason? }

import React from "react";
import { Box, Typography } from "@mui/material";
import { C, FONT, FW_NORMAL } from "../../shared/designTokens";
import { SectionBox, FieldLabel } from "../../shared/FormComponents";
import { CULTURE_TEST_VALUES, GENOMICS_TEST_VALUES, PGX_TEST_VALUES } from "../constants";

const hasAny = (tests, family) => (Array.isArray(tests) ? tests : []).some((t) => family.includes(t));

// Does a genomics sub-record carry the finding it exists to produce? An
// identification or a determinant for WGS, an organism hit for mNGS, a drug call
// for tNGS. An array counts when non-empty, a string when non-blank.
const hasValue = (rec, ...keys) =>
  keys.some((k) => {
    const v = rec?.[k];
    return Array.isArray(v) ? v.length > 0 : !!v;
  });

// A targeted order counts as resulted once it names a panel AND records a row —
// mutations for a resistance panel, taxa for an identity panel, or a type for a
// typing run.
const targetedResulted = (targeted) =>
  (targeted?.orders || []).some(
    (o) => o.panel && (hasValue(o, "mutation_rows", "taxa_rows") || !!o.typing?.type_result)
  );

const fmtWhen = (iso) => (iso ? new Date(iso).toLocaleString() : "");

// Source-tab human label (also used to name the log entry).
const sourceLabel = (v) => {
  const map = {
    "Direct Examination": "Direct Exam",
    "Culture Workup": v.content_type === "id" ? "Culture — Organism ID" : v.content_type === "read" ? "Culture — Plate read" : "Culture Workup",
    "Molecular / NAAT": "Molecular / NAAT",
    "Serology & Antigen": "Serology & Antigen",
    Mycobacteriology: "Mycobacteriology",
    "Pathogen Genomics": "Pathogen Genomics",
  };
  return map[v.source_tab] || v.source_tab || "Report";
};

const isCriticalVersion = (v) => !!(v && (v.critical || v.notifiable));

// One aligned label/value row — the building block of every version card.
const Row = ({ label, value }) => (
  <Box sx={{ display: "flex", gap: 1.5, mb: 0.5 }}>
    <Typography
      sx={{
        fontSize: 11, fontFamily: FONT, fontWeight: FW_NORMAL, textTransform: "uppercase",
        letterSpacing: "0.1em", color: C.textMuted, flexShrink: 0, minWidth: 200, pt: 0.2,
      }}
    >
      {label}
    </Typography>
    <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
      {value}
    </Typography>
  </Box>
);

// Structured, read-only rendering of a version's summary. The source tabs join their
// field/value pairs with " · " (each pair as "Label: value"), so this viewer breaks
// that flat string back into aligned rows purely for display — no data is rewritten.
// Segments without a label (sentence-style summaries) stay full-width.
const SummaryBody = ({ summary }) => {
  if (!summary) {
    return <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>(no summary recorded)</Typography>;
  }
  const rows = String(summary)
    .split(" · ")
    .flatMap((seg) => String(seg).split("\n"))
    .map((seg) => {
      const s = seg.trim();
      const m = s.match(/^([^:]+?):\s*(.*)$/s);
      return m ? { label: m[1].trim(), value: m[2].trim() } : { label: null, value: s };
    })
    .filter((r) => r.value !== "");

  return rows.map((row, j) =>
    row.label ? (
      <Row key={j} label={row.label} value={row.value} />
    ) : (
      <Typography key={j} sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond, mb: 0.25, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
        {row.value}
      </Typography>
    )
  );
};

export default function PreliminaryTab({
  caseRegister,          // case_register (specimens + tests)
  cultureSetup,          // culture_setup (read schedule)
  cultureWorkup,         // culture_workup (isolates / AST)
  molecular,             // molecular section
  serology,              // serology section
  mycobacteriology,      // mycobacteriology section
  pathogenGenomics,      // pathogen_genomics section (Tab 15)
  humanGenomics,         // human_genomics section (Tab 16) — case-level, not per specimen
  preliminaryReports,    // preliminary_reports (versions)
}) {
  const versions = Array.isArray(preliminaryReports?.versions)
    ? [...preliminaryReports.versions].sort((a, b) => (a.version || 0) - (b.version || 0))
    : [];

  const criticalLog = versions.filter(isCriticalVersion);
  const specimens = Array.isArray(caseRegister?.specimens) ? caseRegister.specimens : [];

  // ─── Lightweight pending-items readout ─────────────────────────────────────
  // Derives, per specimen, which downstream results are still outstanding based
  // purely on the sections this viewer can see. Heuristic by design.
  const pending = [];
  specimens.forEach((sp) => {
    const label = `${sp.specimen_type || "Specimen"} ${sp.specimen_id}`;
    const tests = Array.isArray(sp.tests_ordered) ? sp.tests_ordered : [];

    // Culture: scheduled reads not yet done.
    if (hasAny(tests, CULTURE_TEST_VALUES)) {
      const setup = (cultureSetup && cultureSetup[sp.specimen_id]) || {};
      const reads = Array.isArray(setup.reads) ? setup.reads : [];
      const undone = reads.filter((r) => r.status !== "done");
      if (undone.length) pending.push(`${label}: ${undone.length} culture read${undone.length === 1 ? "" : "s"} pending (${undone.map((r) => r.label).join(", ")})`);
    }

    // Culture workup isolates needing ID / AST.
    const workup = (cultureWorkup && cultureWorkup[sp.specimen_id]) || {};
    (Array.isArray(workup.isolates) ? workup.isolates : []).forEach((iso) => {
      const astDone = iso.ast?.antibiotics?.some((a) => a.interpretation);
      if (!iso.organism) pending.push(`${label}: isolate ${iso.isolate_id} awaiting organism ID`);
      else if (iso.significance !== "Yes" && !astDone) pending.push(`${label}: ${iso.organism} — AST / significance pending`);
    });

    // Molecular orders without a recorded result.
    const mol = (molecular && molecular[sp.specimen_id]) || {};
    (Array.isArray(mol.orders) ? mol.orders : []).forEach((o) => {
      const hasResult = o.result?.qualitative || o.result?.copies_ml || o.result?.ct;
      if (o.assay && !hasResult) pending.push(`${label}: NAAT order ${o.order_id} result pending`);
    });

    // Serology orders without a recorded result.
    const sero = (serology && serology[sp.specimen_id]) || {};
    (Array.isArray(sero.orders) ? sero.orders : []).forEach((o) => {
      const hasResult = o.result?.qualitative || o.result?.quantitative;
      if (o.assay && !hasResult) pending.push(`${label}: serology order ${o.order_id} result pending`);
    });

    // Mycobacteriology isolates needing species / DST.
    const myco = (mycobacteriology && mycobacteriology[sp.specimen_id]) || {};
    (Array.isArray(myco.isolates) ? myco.isolates : []).forEach((iso) => {
      const dstRows = [...(iso.dst?.first_line || []), ...(iso.dst?.second_line || [])];
      if (!iso.species) pending.push(`${label}: myco isolate ${iso.isolate_id} awaiting speciation`);
      else if (!dstRows.some((r) => r.result)) pending.push(`${label}: ${iso.species} — DST pending`);
    });

    // Pathogen genomics (Tab 15) — specimen-keyed, so it belongs in this loop.
    // A test ordered with nothing recorded against it is outstanding work.
    if (hasAny(tests, GENOMICS_TEST_VALUES)) {
      const gen = (pathogenGenomics && pathogenGenomics[sp.specimen_id]) || {};
      const outstanding = [
        ...(tests.includes("pathogen_wgs") && !hasValue(gen.wgs, "identified_species", "resistance_genes") ? ["WGS"] : []),
        ...(tests.includes("mngs") && !hasValue(gen.mngs, "organism_hits") ? ["mNGS"] : []),
        ...(tests.includes("tngs_tb") && !hasValue(gen.tngs, "drug_resistance_calls") ? ["tNGS-TB"] : []),
        ...(hasAny(tests, ["amplicon_id", "resistance_genotyping", "typing_ipc"]) && !targetedResulted(gen.targeted)
          ? ["targeted panel"]
          : []),
      ];
      if (outstanding.length) pending.push(`${label}: ${outstanding.join(" / ")} result pending`);
    }
  });

  // Human genomics (Tab 16) is CASE-LEVEL — a lifelong property of the patient, not
  // of any one specimen — so it is checked once for the case rather than inside the
  // loop above. It has no preliminary stage by design (see Tab 16), but an ordered
  // panel with nothing recorded is still outstanding work before sign-out.
  if (specimens.some((sp) => hasAny(Array.isArray(sp.tests_ordered) ? sp.tests_ordered : [], PGX_TEST_VALUES))) {
    const hg = humanGenomics || {};
    const recorded =
      (hg.gene_results || []).some((r) => r.gene) ||
      (hg.hla_results || []).some((r) => r.allele) ||
      !!hg.g6pd?.status;
    if (!recorded) pending.push("Human genomics (PGx): panel ordered, no result recorded");
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 12, color: C.textMuted, fontFamily: FONT, mb: 2 }}>
        Read-only report history. Preliminaries are dispatched from the tab where the result originates —
        this view is the audit trail, the critical-value log, and what is still outstanding before sign-out.
      </Typography>

      {/* Version timeline */}
      <SectionBox title={`Preliminary report history (${versions.length})`}>
        {versions.length === 0 && (
          <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>
            No preliminary reports dispatched yet.
          </Typography>
        )}
        {versions.map((v, i) => (
          <Box key={i} sx={{ display: "flex", gap: 1.5, mb: 1.5 }}>
            {/* Version marker */}
            <Box sx={{ width: 44, flexShrink: 0, pt: 0.25 }}>
              <Box sx={{ border: `1px solid ${isCriticalVersion(v) ? C.black : C.border}`, background: isCriticalVersion(v) ? C.black : C.white, px: 0.75, py: 0.4, textAlign: "center" }}>
                <Typography sx={{ fontSize: 11, fontFamily: FONT, fontWeight: FW_NORMAL, color: isCriticalVersion(v) ? C.white : C.textPrimary }}>
                  v{v.version ?? i + 1}
                </Typography>
              </Box>
            </Box>
            {/* Entry body */}
            <Box sx={{ flex: 1, borderBottom: `1px solid ${C.border}`, pb: 1.25, minWidth: 0 }}>
              {/* Card header: source + flags */}
              <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap", mb: 0.75 }}>
                <Typography sx={{ fontSize: 13, fontFamily: FONT, fontWeight: FW_NORMAL, color: C.textPrimary }}>
                  {sourceLabel(v)}
                </Typography>
                {v.critical && (
                  <Typography sx={{ fontSize: 10, fontFamily: FONT, letterSpacing: "0.06em", px: 1, py: 0.25, background: C.black, color: C.white }}>
                    CRITICAL
                  </Typography>
                )}
                {v.notifiable && (
                  <Typography sx={{ fontSize: 10, fontFamily: FONT, letterSpacing: "0.06em", px: 1, py: 0.25, border: `1px solid ${C.black}`, color: C.textPrimary }}>
                    NOTIFIABLE
                  </Typography>
                )}
              </Box>

              {/* Meta: dispatched time / by / specimen — each a labeled row */}
              {fmtWhen(v.dispatched_at) && <Row label="Dispatched" value={fmtWhen(v.dispatched_at)} />}
              {v.dispatched_by && <Row label="By" value={v.dispatched_by} />}
              {v.specimen_type && <Row label="Specimen" value={v.specimen_type} />}
              {v.specimen_id && <Row label="Specimen ID" value={v.specimen_id} />}

              {/* Divider between meta and result fields */}
              <Box sx={{ borderTop: `1px solid ${C.border}`, my: 1 }} />

              {/* Result fields */}
              <SummaryBody summary={v.summary} />
              {v.critical && v.critical_reason && <Row label="Critical" value={v.critical_reason} />}
              {v.notifiable && v.notifiable_reason && <Row label="Notifiable" value={v.notifiable_reason} />}
            </Box>
          </Box>
        ))}
      </SectionBox>

      {/* Critical / notifiable log */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title={`Critical value & notifiable notification log (${criticalLog.length})`}>
          {criticalLog.length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>
              No critical or notifiable results recorded.
            </Typography>
          )}
          {criticalLog.map((v, i) => (
            <Box key={i} sx={{ display: "flex", gap: 1.5, mb: 1 }}>
              <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted, flexShrink: 0, pt: 0.15 }}>
                v{v.version}
              </Typography>
              <Box>
                <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textPrimary }}>
                  {sourceLabel(v)} · {fmtWhen(v.dispatched_at)}
                </Typography>
                <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textSecond }}>
                  {v.critical ? `Critical — ${v.critical_reason || v.summary}` : `Notifiable — ${v.notifiable_reason || v.summary}`}
                </Typography>
              </Box>
            </Box>
          ))}
        </SectionBox>
      </Box>

      {/* Pending items readout */}
      <Box sx={{ mt: 3 }}>
        <SectionBox title={`Pending before sign-out (${pending.length})`}>
          {pending.length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: C.textMuted, fontFamily: FONT }}>
              Nothing outstanding across the sections this view can see.
            </Typography>
          )}
          {pending.map((p, i) => (
            <Box key={i} sx={{ display: "flex", gap: 1, mb: 0.75 }}>
              <Typography sx={{ fontSize: 12, fontFamily: FONT, color: C.textMuted }}>•</Typography>
              <Typography sx={{ fontSize: 12.5, fontFamily: FONT, color: C.textSecond }}>{p}</Typography>
            </Box>
          ))}
          {pending.length > 0 && (
            <Typography sx={{ fontSize: 11, color: C.textMuted, fontFamily: FONT, mt: 1 }}>
              Read-out is a lightweight heuristic over the recorded sections — culture reads with no growth yet, isolates
              without ID/AST, and molecular/serology orders without results. Sign-out gating itself is Tab 14's job.
            </Typography>
          )}
        </SectionBox>
      </Box>

      {/* Read-only banner */}
      <Box sx={{ mt: 2, display: "flex", justifyContent: "flex-end" }}>
        <Typography sx={{ fontSize: 11, fontFamily: FONT, color: C.textMuted }}>
          <FieldLabel>Read-only view — no data is written from this tab</FieldLabel>
        </Typography>
      </Box>
    </Box>
  );
}
