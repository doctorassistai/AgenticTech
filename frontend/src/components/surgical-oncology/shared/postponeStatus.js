// shared/postponeStatus.js — Derived "postponed" state for a booking document.
//
// "Postponed" is treated as a DISPLAY concern derived from the booking date, not a
// permanent stored status. Two independent signals come out of this helper:
//   1. isPostponed — was this case ever postponed? (persists via booking.isPostponed)
//   2. isFuture    — is the rescheduled date still in the future? (still deferred)
//
// Callers use isFuture for the live warning + soft-gate, and isPostponed for the
// persistent "Was Postponed" history marker once the date has arrived.

/**
 * Derive postponement info from a full booking document.
 * Accepts either the full doc ({ status, booking: {...} }) or a raw booking object.
 * @param {object} bookingDoc
 * @returns {{
 *   isPostponed: boolean,
 *   isFuture: boolean,
 *   newDate: string,
 *   originalDate: string,
 *   reason: string,
 * }}
 */
export function getPostponeInfo(bookingDoc) {
  // Support both the full document shape and a bare booking object (including worklist rows).
  const b = bookingDoc?.fullBooking || bookingDoc?.booking || bookingDoc || {};
  const status = bookingDoc?.status || b?.status;

  // A finished case (Completed/Cancelled) is no longer "postponed" even if the
  // isPostponed flag persists in the DB — the deferral has been resolved.
  const isResolved = status === "Completed" || status === "Cancelled";
  const isPostponed = !isResolved && (status === "Postponed" || b.isPostponed === true);
  const newDate = b.surgeryDate || b.date || bookingDoc?.date || "";
  const originalDate = b.originalSurgeryDate || "";
  const reason = b.postponeReason || "";
  const postponeCount = b.postponeHistory ? b.postponeHistory.length : (b.originalSurgeryDate ? 1 : 0);

  // Date-only comparison: extract local YYYY-MM-DD to avoid UTC offset bugs.
  // A resolved case is never "future" — this drives the soft-gate.
  let isFuture = false;
  if (!isResolved && newDate) {
    const today = new Date();
    const y = today.getFullYear();
    const m = String(today.getMonth() + 1).padStart(2, '0');
    const d = String(today.getDate()).padStart(2, '0');
    const todayStr = `${y}-${m}-${d}`;
    
    // newDate is typically YYYY-MM-DD from the date picker
    const newDateStr = newDate.substring(0, 10);
    isFuture = newDateStr > todayStr;
  }

  return { isPostponed, isFuture, newDate, originalDate, reason, postponeCount };
}

export default getPostponeInfo;
