// shared/transcribeMerge.js — AI-autofill merge helpers for the Onco-Pathology module
//
// Shared logic for the "dictate → transcribe → LLM structure → merge into form"
// flow used by the Grossing, Synoptic, and TNM tabs. Modeled on the safeMerge
// helper in AnaesthesiaRecord.jsx: never overwrite an existing value with a
// blank/empty incoming value, and union-merge arrays.
//
// Adds enum coercion: LLM dictation returns free text ("formalin", "grey white")
// that won't exactly match a MUI <Select> option string, so the dropdown renders
// blank. coerceEnum snaps the incoming value to the closest canonical option.

// Normalize for loose comparison: lowercase, strip everything non-alphanumeric.
const canon = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Snap a free-text value to its canonical dropdown option.
 * Exact (normalized) match first, then a contained-substring fallback.
 * Returns "" when nothing matches — a <Select> can only hold a valid option,
 * so an unmatched value (e.g. a long descriptive phrase) is dropped rather than
 * passed through, which would trigger MUI's out-of-range warning and show blank
 * anyway. The pathologist then picks the correct option manually.
 *
 * @param {string} value   incoming value from the LLM
 * @param {string[]} options  the canonical option list for this field
 */
export const coerceEnum = (value, options) => {
  if (!options || value == null || value === "") return value;
  const target = canon(value);
  if (!target) return "";
  const exact = options.find((o) => canon(o) === target);
  if (exact) return exact;
  // Fallback: option contained in the phrase, or phrase contained in an option.
  const loose = options.find((o) => {
    const c = canon(o);
    return c.length >= 3 && (target.includes(c) || c.includes(target));
  });
  return loose || "";
};

/**
 * Extract the numeric part of a free-text value ("22 hours" → "22",
 * "4.5 cm" → "4.5"). A number <input> rejects any non-numeric characters and
 * logs an out-of-range warning, so unit words must be stripped. Returns "" when
 * no number is present.
 *
 * @param {string|number} value
 */
export const coerceNumber = (value) => {
  if (value == null || value === "") return "";
  if (typeof value === "number") return value;
  const m = String(value).match(/-?\d+(\.\d+)?/);
  return m ? m[0] : "";
};

/**
 * Merge LLM-structured data into the current form state without clobbering
 * existing values with blanks.
 *
 *   • incoming empty ("", null, undefined, []) → keep previous value
 *   • both arrays → union-merge (dedup)
 *   • field listed in enumFields → coerce to its canonical option (or "")
 *   • field listed in numberFields → strip units to a bare number (or "")
 *   • otherwise → take the incoming value
 *
 * @param {object} prev        current form state
 * @param {object} incoming    LLM-structured data
 * @param {Object<string,string[]>} [enumFields]   fieldKey → option list
 * @param {string[]} [numberFields]  keys that must hold a bare number
 */
export const safeMerge = (prev, incoming, enumFields = {}, numberFields = []) => {
  const next = { ...prev };
  Object.entries(incoming || {}).forEach(([k, v]) => {
    const incomingEmpty =
      v === undefined || v === null || v === "" || (Array.isArray(v) && v.length === 0);
    if (incomingEmpty) return;
    if (Array.isArray(next[k]) && Array.isArray(v)) {
      next[k] = Array.from(new Set([...next[k], ...v]));
    } else if (enumFields[k]) {
      next[k] = coerceEnum(v, enumFields[k]);
    } else if (numberFields.includes(k)) {
      next[k] = coerceNumber(v);
    } else {
      next[k] = v;
    }
  });
  return next;
};

/**
 * Convert a dictated date-time phrase into the local `YYYY-MM-DDTHH:MM` format
 * a `datetime-local` input expects. Handles full ISO-ish datetimes, date-only,
 * 12/24-hour times, "midnight"/"noon", and "today"/"yesterday"/"tonight" day
 * anchors. Returns "" when nothing usable is stated — the field is then left for
 * manual entry rather than writing a malformed timestamp.
 *
 * @param {string} value  model-extracted datetime text ("2026-09-01 20:00",
 *                        "8pm", "8:30 pm", "yesterday 6am", "20:00", "noon")
 * @param {Date} [now]    anchor for relative-day phrases (defaults to now)
 */
export const coerceDateTime = (value, now = new Date()) => {
  if (!value) return "";
  const text = String(value).trim();
  if (!text) return "";

  // Full local datetime: 2026-09-01[T ]20:00(:ss)?
  const full = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (full) {
    const [, y, mo, d, hh, mi] = full;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}T${hh.padStart(2, "0")}:${mi}`;
  }

  // Relative-day anchor before resolving a bare time.
  let dayOffset = 0;
  const lower = text.toLowerCase();
  if (/\byesterday\b|\blast night\b/.test(lower)) dayOffset = -1;
  const anchor = new Date(now.getTime() + dayOffset * 86400000);

  let hour = null;
  let minute = 0;
  if (/midnight/.test(lower)) {
    hour = 0;
  } else if (/noon/.test(lower)) {
    hour = 12;
  } else {
    const ampm = text.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i);
    if (ampm) {
      let h = parseInt(ampm[1], 10);
      minute = ampm[2] ? parseInt(ampm[2], 10) : 0;
      if (/pm/i.test(ampm[3]) && h < 12) h += 12;
      if (/am/i.test(ampm[3]) && h === 12) h = 0;
      hour = h;
    } else {
      const h24 = text.match(/(?:^|\s)([01]?\d|2[0-3]):([0-5]\d)(?:\s|$)/);
      if (h24) {
        hour = parseInt(h24[1], 10);
        minute = parseInt(h24[2], 10);
      }
    }
  }
  if (hour == null) return "";

  const y = anchor.getFullYear();
  const mo = String(anchor.getMonth() + 1).padStart(2, "0");
  const d = String(anchor.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
};

export default safeMerge;
