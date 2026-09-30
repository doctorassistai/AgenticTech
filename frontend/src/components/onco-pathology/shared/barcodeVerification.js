// shared/barcodeVerification.js — Voluntary bypass for the barcode image gates
//
// The Grossing → Staining tabs each gate a form on an uploaded barcode image
// matching the expected item. Sometimes the barcode genuinely cannot be read
// (smudged, torn, misprinted) even though the physical label is correct. This
// helper is the one place that models the doctor's escape hatch: an explicit,
// auditable BYPASS.
//
// A bypass is a verification entry like any other, appended to the same
// append-only list — it never rewrites a failed attempt. It carries
// result "bypassed" so downstream code can tell "not verified, doctor decided
// to proceed" apart from "not verified, still locked". The record honestly says
// the barcode was NOT machine-verified, plus who, when and why.

export const BYPASS_RESULT = "bypassed";

// A bypass decision attached to one item's verification list. Callers spread the
// item's own id onto it (container_id / cassette_id / event_id / stain_id), the
// same way a backend verification response already carries its target id.
export const makeBypassRecord = (staff = {}, reason = "") => ({
  result: BYPASS_RESULT,
  bypassed: true,
  reason: reason || "",
  bypassed_by: {
    staff_id: staff.staff_id || "",
    name: staff.name || "",
  },
  bypassed_at: new Date().toISOString(),
});

// Read the latest verification entry for one item and classify it. `unlocked`
// is what every gate should test — a match OR an explicit bypass lets the form
// proceed; anything else (mismatch, unreadable, nothing yet) stays locked.
export const verificationState = (verifications = []) => {
  const list = Array.isArray(verifications) ? verifications : [];
  const latest = list[list.length - 1];
  const matched = latest?.result === "matched";
  const bypassed = latest?.result === BYPASS_RESULT;
  return {
    latest,
    matched,
    bypassed,
    failed: !!latest && !matched && !bypassed,
    unlocked: matched || bypassed,
  };
};
