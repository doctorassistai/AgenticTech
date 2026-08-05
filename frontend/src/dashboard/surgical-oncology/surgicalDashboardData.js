// dashboard/surgicalDashboardData.js
// Pure aggregation: turns the raw bookings array (from api.getBookings) into the
// CONFIG-shaped object the SurgicalOncologyDashboard charts/KPIs already consume.
//
// No React, no fetch — kept pure so it is trivial to reason about and test.
// Metrics backed by a real field on the booking document are computed for real.
// The full template tile set is kept visible; any tile whose backing field is not
// captured yet keeps the template's illustrative value and carries `sample:true`
// so the UI badges it — a fabricated clinical number is never shown unmarked.
// See DASHBOARD_PENDING.md for what each sample tile needs to become real.

// ─── Anatomical-site normalization ──────────────────────────────────────────
// management.anatomicalSite (and procedureName) are free-text. Map them to the
// coarse surgical-site buckets shown on the "Case Volume by Site" chart.
const SITE_RULES = [
  { bucket: "Breast", re: /breast|mastectom|lumpectom|axilla/i },
  { bucket: "Head & Neck", re: /head|neck|oral|tongue|larynx|thyroid|parotid|maxill|mandib/i },
  {
    bucket: "Gastrointestinal",
    re: /esophag|oesophag|gastr|stomach|colon|rectal|rectum|hepat|liver|pancrea|biliary|whipple|bowel|intestin|oesophagogastric|gi\b/i,
  },
  { bucket: "Gynae-Oncology", re: /uter|ovari|cervix|cervical|endometr|vulva|gynae|hysterect/i },
  { bucket: "Thoracic", re: /thorac|lung|pulmonar|mediastin|pleura/i },
  { bucket: "Urologic", re: /prostat|bladder|renal|kidney|uro|nephrect|cystect/i },
  { bucket: "Soft Tissue / Sarcoma", re: /sarcoma|soft tissue|limb|extremity|retroperiton/i },
];
const SITE_BUCKETS = SITE_RULES.map((r) => r.bucket);

export function normalizeSite(booking) {
  const hay = `${booking?.management?.anatomicalSite || ""} ${
    booking?.fullBooking?.procedureName || booking?.procedure || ""
  }`;
  for (const rule of SITE_RULES) if (rule.re.test(hay)) return rule.bucket;
  return "Other";
}

// ─── Small helpers ───────────────────────────────────────────────────────────
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const isCompleted = (bk) => bk.status === "Completed" || bk.surgery_finished === true;
const yes = (v) => String(v || "").trim().toLowerCase() === "yes";
const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

// Parse the operation date, preferring the actual op date, falling back to
// scheduled surgeryDate. Returns a Date or null (no ambient clock use here).
function opDate(bk) {
  const s = bk?.management?.operationStartDate || bk?.fullBooking?.surgeryDate || bk?.date || "";
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

// "HH:MM" -> minutes since midnight, or null.
function toMinutes(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || "").trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

// ─── Main builder ──────────────────────────────────────────────────────────
// `now` is injected (Date) so this stays pure/testable; caller passes new Date().
export function buildDashboardData(bookings, now = new Date()) {
  const list = Array.isArray(bookings) ? bookings : [];
  const completed = list.filter(isCompleted);
  const completedN = completed.length;

  // helper: completed bookings whose op month/year match `now`
  const thisMonth = completed.filter((bk) => {
    const d = opDate(bk);
    return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });

  // ── KPIs (only those backed by real fields) ──
  const withResection = completed.filter((bk) => bk?.management?.resection);
  const r0 = withResection.filter((bk) => bk.management.resection === "R0").length;

  const icu = completed.filter((bk) => /icu|hdu/i.test(bk?.management?.transferTo || "")).length;

  const transfused = completed.filter((bk) => {
    const mgmt = (bk?.management?.bloodProducts || []).length > 0;
    return mgmt;
  }).length;

  const cancelled = list.filter(
    (bk) => bk.status === "Cancelled" || bk?.fullBooking?.cancellationReason
  ).length;

  // OT Utilization: real used-minutes (actual operation start→end, which live on
  // `management`, not on ot_room_bookings whose start_time stays the scheduled
  // value) ÷ theatre capacity. Capacity is NOT stored anywhere, so we assume one
  // standard 8h session per room-day — the tile is labelled "vs 8h/room/day" and
  // read as directional, not an exact operational figure. Only room-days with at
  // least one measurable case count toward the denominator (no phantom capacity).
  const OT_SESSION_MINUTES = 480; // one standard 8h theatre session per room-day
  let otUsedMinutes = 0;
  const otRoomDays = new Set();
  completed.forEach((bk) => {
    const room = bk?.fullBooking?.otRoom || bk?.otRoom || "";
    const d = opDate(bk);
    if (!room || !d) return;
    const start = toMinutes(bk?.management?.operationStartTime);
    const end = toMinutes(bk?.management?.operationEndTime);
    if (start == null || end == null || end <= start) return;
    otUsedMinutes += end - start;
    otRoomDays.add(`${room}|${d.toDateString()}`);
  });
  const otUtilization = pct(otUsedMinutes, otRoomDays.size * OT_SESSION_MINUTES);

  // Average OT Turnover Time: the idle gap between consecutive cases in the same
  // room on the same day (start of next − end of previous). Fully real — no
  // assumed constant — built from the actual op times on `management`. Negative /
  // overlapping gaps (bad data) are skipped; a room-day with a single case
  // contributes no gap. Reported in whole minutes.
  const turnoverByRoomDay = {};
  completed.forEach((bk) => {
    const room = bk?.fullBooking?.otRoom || bk?.otRoom || "";
    const d = opDate(bk);
    if (!room || !d) return;
    const start = toMinutes(bk?.management?.operationStartTime);
    const end = toMinutes(bk?.management?.operationEndTime);
    if (start == null || end == null || end <= start) return;
    const key = `${room}|${d.toDateString()}`;
    (turnoverByRoomDay[key] = turnoverByRoomDay[key] || []).push({ start, end });
  });
  let turnoverSum = 0;
  let turnoverN = 0;
  Object.values(turnoverByRoomDay).forEach((cases) => {
    cases.sort((a, b) => a.start - b.start);
    for (let i = 1; i < cases.length; i++) {
      const gap = cases[i].start - cases[i - 1].end;
      if (gap >= 0) {
        turnoverSum += gap;
        turnoverN++;
      }
    }
  });
  const avgTurnover = turnoverN > 0 ? Math.round(turnoverSum / turnoverN) : null;

  const withPostOp = completed.filter((bk) => bk?.post_op && bk.post_op.hasComplications);
  const complics = withPostOp.filter((bk) => yes(bk.post_op.hasComplications)).length;

  // KPIs — the template tile set, in template order. Real values are computed
  // from booking data; tiles whose backing field is not captured yet carry
  // `sample:true` and a `null` value so the UI shows "None" instead of a
  // fabricated number — a clinical figure must never be invented. See
  // DASHBOARD_PENDING.md for what each sample tile needs to become real.
  const kpis = [
    { label: "Surgeries Performed (MTD)", value: String(thisMonth.length), unit: "", note: "this month", dir: "" },
    { label: "OT Utilization Rate", value: String(otUtilization), unit: "", note: "% vs 8h/room/day", dir: "" },
    avgTurnover != null
      ? { label: "Average OT Turnover Time", value: String(avgTurnover), unit: "", note: "minutes between cases", dir: "" }
      : { label: "Average OT Turnover Time", value: null, unit: "", note: "not captured yet", dir: "", sample: true },
    { label: "R0 Resection Rate", value: String(pct(r0, withResection.length)), unit: "", note: "%", dir: "" },
    { label: "30-Day Post-op Complication Rate", value: String(pct(complics, withPostOp.length)), unit: "", note: "%", dir: "" },
    { label: "Average Post-op Length of Stay", value: null, unit: "", note: "not captured yet", dir: "", sample: true },
    { label: "Reoperation Rate (30-day)", value: null, unit: "", note: "not captured yet", dir: "", sample: true },
    { label: "ICU/HDU Admission Rate (Post-op)", value: String(pct(icu, completedN)), unit: "", note: "%", dir: "" },
    { label: "Intra-op Blood Transfusion Rate", value: String(pct(transfused, completedN)), unit: "", note: "%", dir: "" },
    { label: "Case Cancellation Rate", value: String(pct(cancelled, list.length)), unit: "", note: "%", dir: "down" },
  ];

  // ── Chart 1: Case volume by site ──
  const siteCounts = {};
  completed.forEach((bk) => {
    const s = normalizeSite(bk);
    siteCounts[s] = (siteCounts[s] || 0) + 1;
  });
  const siteLabels = SITE_BUCKETS.filter((b) => siteCounts[b]);
  if (siteCounts["Other"]) siteLabels.push("Other");
  const chart1 = {
    title: "Surgical Case Volume by Site",
    note: "Completed cases, by anatomical site.",
    type: "bar",
    labels: siteLabels.length ? siteLabels : ["No data"],
    datasets: [{ label: "Cases", data: siteLabels.length ? siteLabels.map((l) => siteCounts[l]) : [0] }],
  };

  // ── Chart 2: 6-month volume trend ──
  const trendLabels = [];
  const trendData = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    trendLabels.push(MONTHS[d.getMonth()]);
    trendData.push(
      completed.filter((bk) => {
        const od = opDate(bk);
        return od && od.getMonth() === d.getMonth() && od.getFullYear() === d.getFullYear();
      }).length
    );
  }
  const chart2 = {
    title: "Surgical Volume — 6 Month Trend",
    note: "Completed case volume by month.",
    type: "line",
    labels: trendLabels,
    datasets: [{ label: "Cases", data: trendData }],
  };

  // ── Mini 1: Clavien-Dindo grades ──
  const cdOrder = ["Grade 1", "Grade 2", "Grade 3", "Grade 4", "Grade 5"];
  const cdCounts = { "Grade 1": 0, "Grade 2": 0, "Grade 3": 0, "Grade 4": 0, "Grade 5": 0 };
  completed.forEach((bk) => {
    const g = (bk?.post_op?.clavienDindo || "").trim();
    // normalize "Grade II" / "grade 2" / "2" -> "Grade 2"
    const roman = { i: 1, ii: 2, iii: 3, iv: 4, v: 5 };
    const m = /grade\s*([1-5]|iv|iii|ii|i|v)/i.exec(g) || /^([1-5])$/.exec(g);
    if (m) {
      const tok = m[1].toLowerCase();
      const n = roman[tok] || parseInt(tok, 10);
      if (n >= 1 && n <= 5) cdCounts["Grade " + n]++;
    }
  });
  const mini1 = {
    title: "Post-op Complication Grade (Clavien-Dindo)",
    note: "Graded complications among completed cases.",
    type: "bar",
    labels: ["Grade I", "Grade II", "Grade III", "Grade IV", "Grade V"],
    datasets: [{ data: cdOrder.map((g) => cdCounts[g]) }],
  };

  // ── Mini 2: Case outcome mix ──
  const outcome = { Completed: 0, "In Progress": 0, Pending: 0, Cancelled: 0 };
  list.forEach((bk) => {
    const s = bk.status || "Pending";
    if (outcome[s] === undefined) outcome[s] = 0;
    outcome[s]++;
  });
  const outcomeLabels = Object.keys(outcome).filter((k) => outcome[k] > 0);
  const mini2 = {
    title: "Case Outcome Mix",
    note: "All bookings by current status.",
    type: "doughnut",
    labels: outcomeLabels.length ? outcomeLabels : ["No data"],
    datasets: [{ data: outcomeLabels.length ? outcomeLabels.map((k) => outcome[k]) : [1] }],
  };

  // ── Mini 3: Margin status distribution ──
  const margin = { R0: 0, R1: 0, R2: 0 };
  withResection.forEach((bk) => {
    const r = bk.management.resection;
    if (margin[r] !== undefined) margin[r]++;
  });
  const mini3 = {
    title: "Margin Status Distribution",
    note: "Resection margin among completed cases.",
    type: "bar",
    labels: ["R0", "R1", "R2"],
    datasets: [{ data: [margin.R0, margin.R1, margin.R2] }],
  };

  // ── Quality & Safety (only real indicators) ──
  // Checklist compliance: fraction of answered *_status items that equal "Yes"
  // across all bookings that have a checklist.
  let checklistYes = 0;
  let checklistTotal = 0;
  list.forEach((bk) => {
    const cl = bk.checklist || {};
    Object.entries(cl).forEach(([k, v]) => {
      if (!k.endsWith("_status")) return;
      const val = String(v || "").trim();
      if (val === "" || val.toUpperCase() === "NA") return; // ignore blank / not-applicable
      checklistTotal++;
      if (val.toLowerCase() === "yes") checklistYes++;
    });
  });
  const checklistCompliance = pct(checklistYes, checklistTotal);

  const mortality30 = withPostOp.filter((bk) => yes(bk.post_op.mortality30)).length;

  // First-case punctuality: for the first case of each (room,date), did the actual
  // op start at/before the scheduled start? Only counts cases with both times.
  const firstByRoomDate = {};
  completed.forEach((bk) => {
    const room = bk?.fullBooking?.otRoom || bk?.otRoom || "";
    const d = opDate(bk);
    if (!room || !d) return;
    const key = `${room}|${d.toDateString()}`;
    const sched = toMinutes(bk?.fullBooking?.startTime);
    const actual = toMinutes(bk?.management?.operationStartTime);
    if (sched == null || actual == null) return;
    const cur = firstByRoomDate[key];
    if (!cur || sched < cur.sched) firstByRoomDate[key] = { sched, actual };
  });
  const firstCases = Object.values(firstByRoomDate);
  const onTime = firstCases.filter((f) => f.actual <= f.sched + 5).length; // 5-min grace
  const punctuality = pct(onTime, firstCases.length);

  const quality = [
    // Surgical Site Infection Rate — needs a controlled "SSI" term in
    // post_op.complications[]; today it's free text, so kept as sample (no value).
    { name: "Surgical Site Infection Rate", desc: "Infections within 30 days of surgery", value: null, target: 3, max: 15, status: "—", unit: "%", sample: true },
    // Unplanned Return to OT — needs post_op.returnToOT (not captured).
    { name: "Unplanned Return to OT (30-day)", desc: "Reoperation for a complication of the index surgery", value: null, target: 3, max: 10, status: "—", unit: "%", sample: true },
    {
      name: "Surgical Safety Checklist Compliance",
      desc: "WHO checklist items marked complete across bookings",
      value: checklistCompliance, target: 100, max: 100,
      status: checklistCompliance >= 95 ? "On Track" : "Watch", unit: "%",
    },
    // OT First-Case Punctuality — real when both scheduled & actual times exist;
    // otherwise kept as sample with no value so the tile stays visible.
    firstCases.length
      ? {
          name: "OT First-Case Start-Time Punctuality",
          desc: "First case per theatre starting on/near schedule",
          value: punctuality, target: 90, max: 100,
          status: punctuality >= 90 ? "On Track" : "Watch", unit: "%",
        }
      : { name: "OT First-Case Start-Time Punctuality", desc: "First case of the day starting on schedule", value: null, target: 90, max: 100, status: "—", unit: "%", sample: true },
    // Frozen–Final Concordance — needs the final histopath result to compare
    // frozen against; only the frozen side is captured, so kept as sample.
    { name: "Frozen Section–Final Histopathology Concordance", desc: "Agreement between intra-op and final diagnosis", value: null, target: 95, max: 100, status: "—", unit: "%", sample: true },
    {
      name: "30-Day Post-operative Mortality",
      desc: "Deaths within 30 days among cases with post-op follow-up",
      value: pct(mortality30, withPostOp.length), target: 2, max: 10,
      status: pct(mortality30, withPostOp.length) <= 2 ? "On Track" : "Watch", unit: "%",
    },
  ];

  return {
    meta: { totalBookings: list.length, completed: completedN, hasPostOpData: withPostOp.length },
    kpis,
    chart1,
    chart2,
    mini: [mini1, mini2, mini3],
    quality,
  };
}

export default buildDashboardData;
