// shared/capValidation.js — CAP protocol validation (pure, deterministic)
//
// Ported from templates/pathology.py endpoints /validate-cap-pathology and
// /pathology/validate-cap. Despite the old backend's "engine: llama-..."
// metadata label, NO AI is involved — these are plain rule checks. Kept on the
// frontend as pure functions; results are derived on demand (never persisted).
//
// Each function returns an array of result items:
//   { level: "ok" | "warning" | "error" | "info", title, message }
// The dialog renders these as MUI alerts.

// ─── helpers ─────────────────────────────────────────────────────────────────
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const isBlank = (v) => v === null || v === undefined || String(v).trim() === "";

// Band a margin distance (cm) into a message. `label` names the margin.
function marginBand(label, value) {
  const n = num(value);
  if (n === null) return { level: "info", title: `${label} Margin`, message: `${label} margin not provided.` };
  if (n < 0.1) return { level: "error", title: `${label} Margin`, message: `${label} margin (${n} cm) is extremely close — possible involvement.` };
  if (n < 1) return { level: "warning", title: `${label} Margin`, message: `${label} margin (${n} cm) — narrow margin (<1 cm).` };
  return { level: "ok", title: `${label} Margin`, message: `${label}: ${n} cm (adequate).` };
}

// ─── Grossing Bench: fixation quality + margin adequacy ──────────────────────
// Mirrors POST /validate-cap-pathology.
export function validateGrossingCAP(g = {}) {
  const results = [];

  // Fixation (CAP/ASCO recommendation: 6–72 h in 10% NBF)
  const fixative = g.fixative_used;
  const duration = num(g.fixation_duration);
  const fixNotes = [];
  let fixLevel = "ok";

  if (fixative === "Fresh (Not Fixed)") {
    fixLevel = "warning";
    fixNotes.push("Specimen received unfixed — immediate fixation required for optimal IHC.");
  }
  if (fixative === "Alcohol") {
    fixLevel = "warning";
    fixNotes.push("Alcohol fixation can compromise DNA/RNA extraction for molecular testing.");
  }
  if (duration !== null) {
    if (duration < 6) {
      fixLevel = "warning";
      fixNotes.push(`Fixation duration is only ${duration} hours. Minimum 6 hours required for adequate nuclear detail.`);
    }
    if (duration < 12) {
      fixNotes.push("CAP recommends ≥12 hours fixation for optimal immunohistochemistry (IHC).");
    }
    if (duration > 72) {
      fixLevel = "warning";
      fixNotes.push("Prolonged fixation (>72 hours) may reduce antigenicity for IHC markers.");
    }
  }

  results.push(
    fixLevel === "warning"
      ? { level: "warning", title: "Fixation Alert", message: fixNotes.join("\n") }
      : { level: "ok", title: "Fixation Acceptable", message: "Fixation parameters meet CAP recommendations." }
  );

  // Margins (report closest margin in cm)
  results.push(marginBand("Proximal", g.proximal_margin));
  results.push(marginBand("Distal", g.distal_margin));
  results.push(marginBand("Radial/Circumferential", g.radial_margin));
  if (!isBlank(g.other_margins)) {
    results.push({ level: "info", title: "Other Margins", message: String(g.other_margins) });
  }

  return results;
}

// ─── Synoptic Report: node count, margins, grade, checklist completeness ─────
// Mirrors POST /pathology/validate-cap, but the required/optional checklist is
// derived from the site SCHEMA (fields flagged `required`) rather than a
// hardcoded list — respecting the user-owned schema design.
export function validateSynopticCAP(schema, s = {}) {
  const results = [];

  // 1. Node count (CAP colorectal: ≥12)
  const totalNodes = num(s.total_nodes_examined);
  if (totalNodes !== null && totalNodes >= 12) {
    results.push({ level: "ok", title: "Node Count Adequate", message: `${totalNodes} lymph nodes examined meets CAP recommendation (≥12).` });
  } else {
    results.push({ level: "warning", title: "Insufficient Node Count", message: `Only ${totalNodes ?? 0} nodes examined. CAP recommends examining ≥12 lymph nodes for accurate staging.` });
  }

  // Consistency: positive nodes must not exceed examined nodes.
  const posNodes = num(s.positive_nodes);
  if (totalNodes !== null && posNodes !== null && posNodes > totalNodes) {
    results.push({ level: "error", title: "Node Count Inconsistent", message: `Positive nodes (${posNodes}) exceed total examined (${totalNodes}).` });
  }

  // 2. Margins (status → distance banding). "Involved" = R1 resection.
  const marginStatus = (label, status, distance) => {
    if (isBlank(status)) return { level: "info", title: `${label} Margin`, message: `${label}: margin status not provided.` };
    if (status === "Involved by invasive carcinoma") {
      return { level: "error", title: `${label} Margin`, message: `${label}: margin involved — indicates R1 resection.` };
    }
    return marginBand(label, distance);
  };
  results.push(marginStatus("Proximal", s.proximal_margin_status, s.proximal_margin_distance_cm));
  results.push(marginStatus("Distal", s.distal_margin_status, s.distal_margin_distance_cm));

  // 3. Grade interpretation
  const grade = s.grade;
  if (!isBlank(grade)) {
    if (/poorly/i.test(grade) || /\bG3\b/.test(grade) || /\bG4\b/.test(grade)) {
      results.push({ level: "warning", title: "Histologic Grade", message: "High-grade tumor — associated with worse prognosis." });
    } else {
      results.push({ level: "info", title: "Histologic Grade", message: "Grade is within low-to-moderate range." });
    }
  }

  // 4. CAP checklist completeness — derived from schema `required` flags.
  const missingRequired = [];
  const complete = [];
  if (schema && Array.isArray(schema.sections)) {
    schema.sections.forEach((sec) => {
      (sec.fields || []).forEach((fld) => {
        if (!fld.required) return;
        if (isBlank(s[fld.key])) missingRequired.push(fld.label);
        else complete.push(fld.label);
      });
    });
  }

  if (missingRequired.length === 0) {
    results.push({ level: "ok", title: "CAP Checklist Complete", message: `All ${complete.length} required elements completed.` });
  } else {
    results.push({
      level: "error",
      title: `CAP Checklist Incomplete (${missingRequired.length} missing)`,
      message: missingRequired.map((l) => `❌ ${l} — required, missing`).join("\n"),
    });
  }

  return results;
}
