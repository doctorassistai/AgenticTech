// shared/finalReportPdf.js — the printable final microbiology report.
//
// Lays the case out the way a laboratory report reads: letterhead, patient /
// request box, the specimens, the results recorded against each of them, then
// the microbiologist's report, diagnosis, stewardship and authorisation.
//
// The per-specimen results are rendered with the same summarizers the tracks use
// for their preliminary reports (shared/resultSummaries.js), so what the
// preliminary said and what the final report prints cannot drift apart.
//
// jsPDF primitives follow the house pattern already used by dashboard.jsx
// (downloadPDF: letterhead + patient box + drawTable) and
// surgical-oncology/DischargeSummaryTab.jsx (grey section bands + labelled
// rows), so documents across the app read as one family.
//
// Pure: takes the stored sections and returns a jsPDF document. The caller saves it.

import { jsPDF } from "jspdf";
import { DIRECT_EXAM_TYPES_BY_VALUE, PGX_CASE_TYPE, pgxTestsFor } from "../constants";
import {
  summarizeExam,
  summarizeNaatOrder,
  summarizeSerologyOrder,
  summarizeMycoIsolate,
  summarizeGenomics,
} from "./resultSummaries";
import {
  pgxReportRows,
  pgxLimitations,
  pgxCarriedForwardRows,
  pgxCarriedForwardConflicts,
} from "./genomics";

// Letterhead. Same institution line the rest of the app prints; change here to
// re-brand every microbiology report.
const HOSPITAL = "DoctorAssist.ai";
const DEPARTMENT = "Department of Microbiology";

// ── Page geometry (mm, A4 portrait) ──────────────────────────────────────────
const MARGIN_X = 14;
const MARGIN_TOP = 18;
const MARGIN_BOTTOM = 20;
const USABLE = 210 - MARGIN_X * 2;   // 182
const LABEL_W = 46;                  // label column in a labelled row
const LINE_H = 4.4;

const asText = (v) => (v === undefined || v === null ? "" : String(v).trim());

// "2026-09-01T08:30" → "01-Sep-2026 08:30". Collection time is clinically
// meaningful on a microbiology report, so the date alone is not enough.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const fmtDateTime = (value) => {
  const raw = asText(value);
  if (!raw) return "";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;   // keep whatever was typed
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// ── Per-specimen results, assembled from the recorded tracks ─────────────────

const cultureLines = (workup) => {
  const out = [];
  (workup?.reads || []).forEach((r) => {
    if (!r.plate_growth) return;
    const bits = [r.read_at ? `${r.label || "Read"} (${fmtDateTime(r.read_at)})` : (r.label || "Read"), r.plate_growth];
    const qty = r.quantity_urine || r.quantity_semi;
    if (qty) bits.push(qty);
    if (r.mixed_growth) bits.push(r.mixed_growth);
    if (r.contamination && r.contamination !== "No") bits.push(`contamination ${String(r.contamination).toLowerCase()}`);
    if (r.blood_positive) bits.push(`blood culture positive${r.blood_ttp_hours ? ` — TTP ${r.blood_ttp_hours} h` : ""}`);
    out.push(bits.join(" · "));
  });
  (workup?.isolates || []).forEach((iso) => {
    if (!iso.organism) return;
    const bits = [iso.organism];
    if (iso.id_method) bits.push(iso.id_method);
    if (iso.confidence && iso.confidence !== "Acceptable") bits.push(`ID ${String(iso.confidence).toLowerCase()}`);
    if (iso.significance) bits.push(iso.significance);
    const flags = Array.isArray(iso.ast?.resistance_flags) ? iso.ast.resistance_flags.filter(Boolean) : [];
    if (flags.length) bits.push(flags.join(", "));
    if (iso.ast?.no_ast_reason) bits.push(`AST not performed — ${iso.ast.no_ast_reason}`);
    out.push(bits.join(" · "));
  });
  return out;
};

// [label, value] rows for one specimen, in track order. Nothing recorded means
// no row — an empty track is never printed as "not done".
const resultsForSpecimen = (specimenId, ctx) => {
  const rows = [];

  ((ctx.directExamination || {})[specimenId]?.exams || []).forEach((e) => {
    const text = summarizeExam(e.exam_type, e.result);
    if (!text) return;
    const label = DIRECT_EXAM_TYPES_BY_VALUE[e.exam_type]?.label || "Direct exam";
    rows.push([label, text, e.examined_at ? fmtDateTime(e.examined_at) : ""]);
  });

  cultureLines((ctx.cultureWorkup || {})[specimenId]).forEach((text) => {
    rows.push(["Culture", text, ""]);
  });

  ((ctx.molecular || {})[specimenId]?.orders || []).forEach((o) => {
    const text = summarizeNaatOrder(o);
    if (text) rows.push(["Molecular / NAAT", text, o.result?.result_datetime ? fmtDateTime(o.result.result_datetime) : ""]);
  });

  ((ctx.serology || {})[specimenId]?.orders || []).forEach((o) => {
    const text = summarizeSerologyOrder(o);
    if (text) rows.push(["Serology / antigen", text, o.result?.result_datetime ? fmtDateTime(o.result.result_datetime) : ""]);
  });

  ((ctx.mycobacteriology || {})[specimenId]?.isolates || []).forEach((iso) => {
    rows.push(["Mycobacteriology", summarizeMycoIsolate(iso), ""]);
  });

  // Tab 15 — pathogen genomics. Reported against the specimen like every other
  // track. Genomic resistance is PREDICTED, and the label says so, because it is
  // not measured the way the AST rows above it are.
  const gx = (ctx.pathogenGenomics || {})[specimenId] || {};

  const wgs = gx.wgs;
  if (wgs) {
    const text = summarizeGenomics("wgs", wgs);
    if (text) rows.push(["WGS (predicted)", text, wgs.result_received_at ? fmtDateTime(wgs.result_received_at) : ""]);
  }

  (gx.targeted?.orders || []).forEach((o) => {
    const text = summarizeGenomics("targeted", o);
    if (text) rows.push(["Targeted panel (predicted)", text, o.result_received_at ? fmtDateTime(o.result_received_at) : ""]);
  });

  const tngs = gx.tngs;
  if (tngs) {
    const text = summarizeGenomics("tngs", tngs);
    if (text) rows.push(["tNGS-TB (predicted)", text, tngs.result_received_at ? fmtDateTime(tngs.result_received_at) : ""]);
  }

  const mngs = gx.mngs;
  if (mngs) {
    const text = summarizeGenomics("mngs", mngs);
    if (text) rows.push(["mNGS", text, mngs.result_received_at ? fmtDateTime(mngs.result_received_at) : ""]);
  }

  return rows;
};

// ── Document ─────────────────────────────────────────────────────────────────

export function buildFinalReportPdf({
  caseRegister = {},
  finalReport = {},
  directExamination = {},
  cultureWorkup = {},
  molecular = {},
  serology = {},
  mycobacteriology = {},
  pathogenGenomics = {},   // Tab 15 — reported per specimen with the other tracks
  humanGenomics = {},      // Tab 16 — reported once, case-level, not per specimen
  carriedForward = [],     // Tab 16 register — findings established by EARLIER cases
  reportedAstRows = [],
  doctorName = "",
  caseId = "",
  signedOutAt = "",
} = {}) {
  const doc = new jsPDF("p", "mm", "a4");
  const pageH = doc.internal.pageSize.getHeight();
  let y = MARGIN_TOP;

  // ── primitives ──
  const ensure = (h) => {
    if (y + h > pageH - MARGIN_BOTTOM) {
      doc.addPage();
      y = MARGIN_TOP;
    }
  };

  const section = (title) => {
    ensure(14);
    y += 3;
    doc.setFillColor(238, 238, 238);
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_X, y, USABLE, 8, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(0);
    doc.text(String(title).toUpperCase(), MARGIN_X + 3, y + 5.5);
    y += 8;
  };

  // A sub-heading inside a section: smaller than a section band and in sentence
  // case rather than uppercase, so it reads as a label rather than a new part of
  // the report. Used by the two PGx blocks, whose distinction is the safety
  // feature — one is what this case established, the other is what it did not.
  const subhead = (text) => {
    ensure(7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(0);
    doc.text(String(text), MARGIN_X, y + 4);
    y += 5.5;
  };

  const labelledRow = (label, value) => {
    const text = asText(value);
    if (!text) return false;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(text, USABLE - LABEL_W - 6);
    const rowH = Math.max(7, LINE_H * lines.length + 3);
    ensure(rowH);
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_X, y, USABLE, rowH, "S");
    doc.line(MARGIN_X + LABEL_W, y, MARGIN_X + LABEL_W, y + rowH);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(60);
    doc.text(String(label), MARGIN_X + 2.5, y + 4.8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(0);
    doc.text(lines, MARGIN_X + LABEL_W + 2.5, y + 4.8);
    y += rowH;
    return true;
  };

  const para = (text) => {
    const t = asText(text);
    if (!t) return;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(0);
    const lines = doc.splitTextToSize(t, USABLE - 6);
    const h = LINE_H * lines.length + 4;
    ensure(h);
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_X, y, USABLE, h, "S");
    doc.text(lines, MARGIN_X + 3, y + 5);
    y += h;
  };

  const table = (headers, rows, widths) => {
    if (!rows.length) return;
    const pad = 2;
    const drawHead = () => {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.setTextColor(0);
      doc.setFillColor(246, 246, 246);
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      let x = MARGIN_X;
      headers.forEach((h, i) => {
        doc.rect(x, y, widths[i], 7, "FD");
        doc.text(String(h), x + pad, y + 4.7);
        x += widths[i];
      });
      y += 7;
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
    };
    ensure(14);
    drawHead();
    rows.forEach((row) => {
      const cells = row.map((c) => asText(c));
      const lineCounts = cells.map((c, i) => doc.splitTextToSize(c, widths[i] - pad * 2).length || 1);
      const rowH = Math.max(6.5, Math.max(...lineCounts) * LINE_H + 3);
      if (y + rowH > pageH - MARGIN_BOTTOM) {
        doc.addPage();
        y = MARGIN_TOP;
        drawHead();
      }
      doc.setDrawColor(0);
      doc.setLineWidth(0.2);
      let x = MARGIN_X;
      cells.forEach((c, i) => {
        doc.rect(x, y, widths[i], rowH, "S");
        doc.text(doc.splitTextToSize(c, widths[i] - pad * 2), x + pad, y + 4.4);
        x += widths[i];
      });
      y += rowH;
    });
    y += 3;
  };

  // A specimen's heading band, lighter than a section band so the nesting reads.
  const specimenBand = (specimen) => {
    const bits = [specimen.specimen_id, specimen.specimen_type, specimen.site_of_collection].filter(Boolean);
    const when = fmtDateTime(specimen.collection_datetime);
    ensure(9);
    doc.setFillColor(248, 248, 248);
    doc.setDrawColor(0);
    doc.setLineWidth(0.2);
    doc.rect(MARGIN_X, y, USABLE, 7, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setTextColor(0);
    doc.text(bits.join("  ·  "), MARGIN_X + 2.5, y + 4.7);
    if (when) {
      doc.setFont("helvetica", "normal");
      doc.setTextColor(90);
      doc.text(`Collected ${when}`, MARGIN_X + USABLE - 2.5, y + 4.7, { align: "right" });
    }
    y += 7;
    doc.setTextColor(0);
  };

  // ── letterhead ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.setTextColor(0);
  doc.text(HOSPITAL, MARGIN_X, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9.5);
  doc.setTextColor(90);
  doc.text(DEPARTMENT, MARGIN_X, y + 5.5);
  doc.setDrawColor(0);
  doc.setLineWidth(0.5);
  doc.line(MARGIN_X, y + 9, MARGIN_X + USABLE, y + 9);
  y += 15;

  // ── patient / request box ──
  const patient = caseRegister.patient || {};
  const request = caseRegister.request || {};
  const status = asText(finalReport.report_status) || "Draft";
  const pairs = [
    [["Patient", patient.patient_name], ["Case ID", caseId]],
    [["MRN / ID", patient.mrn || patient.patient_id], ["Case type", caseRegister.case_type]],
    [["Sex", patient.sex], ["Requested by", request.requesting_clinician]],
    [["Ward / OPD", request.ward_or_opd], ["Department", request.requesting_department]],
    [["Requested", fmtDateTime(request.request_datetime)], ["Priority", request.priority]],
    [["Specimens", String((caseRegister.specimens || []).length || "")], ["Report status", status]],
  ].filter(([a, b]) => asText(a?.[1]) || asText(b?.[1]));

  if (pairs.length) {
    const rowH = 6;
    const boxH = pairs.length * rowH + 3;
    ensure(boxH + 4);
    const colW = USABLE / 2;
    doc.setDrawColor(0);
    doc.setLineWidth(0.3);
    doc.rect(MARGIN_X, y, USABLE, boxH, "S");
    doc.setFontSize(8.5);
    let ry = y + 1.5;
    pairs.forEach(([a, b]) => {
      const cell = (pair, x0) => {
        if (!pair || !asText(pair[1])) return;
        doc.setFont("helvetica", "bold");
        doc.setTextColor(70);
        doc.text(String(pair[0]), x0, ry + 4);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(0);
        doc.text(doc.splitTextToSize(asText(pair[1]), colW - 43)[0] || "", x0 + 30, ry + 4);
      };
      cell(a, MARGIN_X + 3);
      cell(b, MARGIN_X + colW + 3);
      ry += rowH;
    });
    y += boxH + 6;
  }

  // ── title ──
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12.5);
  doc.setTextColor(0);
  // A pure PGx case is not an infection report — heading it as one would promise
  // an infection conclusion the document does not contain. A Combined case keeps
  // the microbiology heading, since it does carry an infection side.
  const reportTitle = caseRegister.case_type === PGX_CASE_TYPE
    ? "PHARMACOGENOMICS REPORT"
    : "MICROBIOLOGY REPORT";
  doc.text(status === "Final" ? `FINAL ${reportTitle}` : `${reportTitle} (DRAFT)`, 105, y, { align: "center" });
  y += 4.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text(`Generated ${fmtDateTime(new Date().toISOString())}`, 105, y, { align: "center" });
  y += 3;

  // ── specimens ──
  const specimens = Array.isArray(caseRegister.specimens) ? caseRegister.specimens : [];
  if (specimens.length) {
    section("Specimens");
    table(
      ["Specimen ID", "Type", "Site", "Collected", "Received"],
      specimens.map((sp) => [
        sp.specimen_id,
        sp.specimen_type,
        sp.site_of_collection,
        fmtDateTime(sp.collection_datetime),
        fmtDateTime(sp.received_datetime),
      ]),
      [32, 40, 40, 35, 35],
    );
  }

  // ── results per specimen ──
  const ctx = { directExamination, cultureWorkup, molecular, serology, mycobacteriology, pathogenGenomics };
  const withResults = specimens.filter((sp) => resultsForSpecimen(sp.specimen_id, ctx).length > 0);
  if (withResults.length) {
    section("Results");
    withResults.forEach((sp) => {
      specimenBand(sp);
      resultsForSpecimen(sp.specimen_id, ctx).forEach(([label, value, at]) => {
        labelledRow(at ? `${label} (${at})` : label, value);
      });
    });
    y += 3;
  }

  // ── organisms reported ──
  const organisms = Array.isArray(finalReport.organisms) ? finalReport.organisms.filter((o) => asText(o.organism) || asText(o.quantity) || asText(o.significance)) : [];
  if (organisms.length) {
    section("Organisms reported");
    table(
      ["Species", "Quantity / count", "Significance"],
      organisms.map((o) => [o.organism, o.quantity, o.significance]),
      [92, 45, 45],
    );
  }

  // ── reported-only AST ──
  if (reportedAstRows.length) {
    section("Antimicrobial susceptibility (reported)");
    table(
      ["Organism", "Family", "Antibiotic", "Result"],
      reportedAstRows.map((r) => [r.organism, r.family, r.antibiotic, r.interpretation]),
      [58, 38, 54, 32],
    );
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    const note = doc.splitTextToSize("Reported antibiotics only — CLSI M100 cascade applied; intrinsic and first-line-susceptible suppressed rows are excluded.", USABLE);
    ensure(LINE_H * note.length + 2);
    doc.text(note, MARGIN_X, y + 2);
    y += LINE_H * note.length + 4;
    doc.setTextColor(0);
  }

  // ── pharmacogenomics (Tab 16) ──
  // Case-level, not per specimen: a pharmacogenomic result is a property of the
  // patient, so it prints once beside the infection report rather than against
  // whichever specimen happened to be collected.
  //
  // TWO BLOCKS, and the split is the safety feature. "Established by this case" is
  // what this report issues; "Carried forward" is what an EARLIER case established
  // and this one did not re-test. A genotype does not change, so a carried-forward
  // result is still true — but a reader must never take it for a fresh finding, and
  // must never read an empty first block as "nothing is wrong with this patient".
  // That is why the empty case says so in words.
  //
  // Gated on the case carrying PGx at all — the case type, a PGx order, or PGx
  // content. A blood culture for a patient with a known DPYD result deliberately
  // prints nothing: the register belongs to the PGx half, not to every report in
  // the module.
  const pgxCase = caseRegister?.case_type === PGX_CASE_TYPE;
  const pgxOrdered = (caseRegister?.specimens || []).some(
    (sp) => pgxTestsFor(sp?.tests_ordered).length > 0,
  );
  // pgxReportRows covers genes, HLA and G6PD, so an empty array is exactly "this
  // case holds no PGx content" — the same test hasPgxContent makes.
  const pgxRows = pgxReportRows(humanGenomics);
  const pgxCarried = pgxCarriedForwardRows(carriedForward);

  if (pgxCase || pgxOrdered || pgxRows.length > 0) {
    section("Pharmacogenomics");

    subhead("Established by this case");
    if (pgxRows.length) {
      table(
        ["Gene / allele", "Genotype", "Result", "Action"],
        pgxRows.map((r) => [r.label, r.genotype, r.result, r.action]),
        [40, 42, 38, 62],
      );
    } else {
      // Stated rather than left blank. A pre-emptive PGx case with nothing new to
      // report is the NORMAL outcome, and a silently missing block reads as a
      // missing result rather than as a case that had none.
      para("No new pharmacogenomic testing on this case.");
    }

    if (pgxCarried.length) {
      subhead("Carried forward — previously established, not re-tested on this case");
      table(
        ["Gene / allele", "Genotype", "Result", "Action", "Established"],
        pgxCarried,
        [30, 32, 30, 52, 38],
      );
      para(
        "These results were established on earlier cases for this patient. "
        + "Pharmacogenomic genotype does not change over time, so they remain valid and "
        + "are not affected by this specimen. They were not re-tested here.",
      );
      // A disagreement is printed, never resolved: the report's job is to say the
      // two records conflict, not to decide which assay was wrong.
      pgxCarriedForwardConflicts(carriedForward).forEach((note) => para(note));
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(110);
    pgxLimitations(humanGenomics).forEach((note) => {
      const lines = doc.splitTextToSize(note, USABLE);
      ensure(LINE_H * lines.length + 2);
      doc.text(lines, MARGIN_X, y + 2);
      y += LINE_H * lines.length + 1.5;
    });
    y += 2.5;
    doc.setTextColor(0);
  }

  // ── final diagnosis ──
  const dx = finalReport.diagnosis || {};
  const dxRows = [
    ["Infection site", dx.infection_site],
    ["Acquisition", dx.acquisition],
    ["Onset date", dx.onset_date],
    ["Device-associated", dx.device_associated],
    ["Device detail", dx.device_detail],
    ["Diagnostic certainty", dx.certainty],
    ["Causative organism", dx.causative_organism],
    ["Primary diagnosis", dx.primary],
  ];
  const secondary = (Array.isArray(dx.secondary) ? dx.secondary : []).map((s) => asText(s.text)).filter(Boolean);
  if (dxRows.some(([, v]) => asText(v)) || secondary.length) {
    section("Final diagnosis");
    dxRows.forEach(([label, value]) => labelledRow(label, value));
    if (secondary.length) labelledRow("Secondary diagnoses", secondary.map((s, i) => `${i + 1}. ${s}`).join("\n"));
  }

  // ── report text, comments, coding ──
  const comments = finalReport.comments || {};
  const selected = (Array.isArray(comments.selected) ? comments.selected : []).filter(Boolean);
  const hasReport = asText(finalReport.report_body) || selected.length || asText(comments.note) || asText(finalReport.resistance_mechanisms);
  if (hasReport) {
    section("Report");
    para(finalReport.report_body);
    if (selected.length) {
      labelledRow("Comments", selected.map((c, i) => `${i + 1}. ${c}`).join("\n"));
    }
    labelledRow("Additional comment", comments.note);
    labelledRow("Resistance mechanisms", finalReport.resistance_mechanisms);
  }

  const icd = finalReport.icd10 || {};
  if (asText(icd.organism_code) || asText(icd.site_code)) {
    section("Coding");
    labelledRow("ICD-10 organism", icd.organism_code);
    labelledRow("ICD-10 site", icd.site_code);
  }

  // ── stewardship ──
  const st = finalReport.stewardship || {};
  const stRows = [
    ["Stewardship review", st.reviewed],
    ["Final therapy recommendation", st.final_recommendation],
    ["Planned duration", st.duration],
    ["IV to oral switch", st.iv_to_oral],
    ["De-escalation decision", st.de_escalation],
    ["Restricted antimicrobial approval", st.restricted_approval],
  ];
  if (stRows.some(([, v]) => asText(v))) {
    section("Antimicrobial stewardship");
    stRows.forEach(([label, value]) => labelledRow(label, value));
  }

  // ── authorisation ──
  section("Authorisation");
  const reviewer = finalReport.reviewer || {};
  const confirmation = finalReport.confirmation || {};
  labelledRow("Reported by", reviewer.name || doctorName);
  labelledRow("Credentials", reviewer.credentials);
  labelledRow("Confirmed by", confirmation.confirmed_by);
  labelledRow("Confirmed at", fmtDateTime(confirmation.confirmed_at));
  if (signedOutAt) labelledRow("Signed out at", fmtDateTime(signedOutAt));

  ensure(26);
  y += 8;
  const half = USABLE / 2 - 6;
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  doc.line(MARGIN_X, y, MARGIN_X + half, y);
  doc.line(MARGIN_X + USABLE - half, y, MARGIN_X + USABLE, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(110);
  doc.text("Microbiologist — signature", MARGIN_X, y + 4);
  doc.text("Date", MARGIN_X + USABLE - half, y + 4);
  y += 10;
  doc.setTextColor(0);

  // ── footers, once the page count is known ──
  const total = doc.getNumberOfPages();
  for (let p = 1; p <= total; p += 1) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.setDrawColor(200);
    doc.setLineWidth(0.2);
    doc.line(MARGIN_X, pageH - 14, MARGIN_X + USABLE, pageH - 14);
    doc.text(`${HOSPITAL} — ${DEPARTMENT}`, MARGIN_X, pageH - 10);
    doc.text(`Page ${p} of ${total}`, MARGIN_X + USABLE, pageH - 10, { align: "right" });
    if (caseId) doc.text(`Case ${caseId}`, MARGIN_X + USABLE / 2, pageH - 10, { align: "center" });
  }

  return doc;
}

// Filename for the saved report: patient name when known, else the case id.
export function finalReportFilename(caseRegister = {}, caseId = "") {
  const name = asText((caseRegister.patient || {}).patient_name) || asText(caseId) || "case";
  return `Microbiology_Report_${name.replace(/[^\w.-]+/g, "_")}.pdf`;
}

export default { buildFinalReportPdf, finalReportFilename };
