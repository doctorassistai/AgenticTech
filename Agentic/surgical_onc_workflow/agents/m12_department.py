"""m12 - Department Analytics and Operations.

Zooms OUT from the single patient to theatre / ward / cohort-level performance: OR
utilization, waiting list, case-duration analytics, cancellation and bed-occupancy
prediction, registry, and benchmarking.

IMPORTANT BOUNDARY: this dashboard pipeline loads ONE patient's record (read-only).
Cohort STATISTICS proper — waiting-list depth, ward occupancy, cancellation RATES,
benchmark norms — are NOT derivable from a single case, and the 'never fabricate' rule
forbids inventing them, so those rows report 'Not available - requires department-level
data' with only the operational TARGET filled in `reference`. But several rows have a
REAL single-case (or theatre-day) contribution the record CAN answer honestly:

  - Operating Room Utilization: the theatre-booking collection (`ot_room_bookings`) IS
    department-scoped (keyed by room + date across ALL patients), so `or_utilization`
    (data_sources.summarize_or_utilization) gives a REAL load for THIS case's theatre on
    its surgery day — case count, booked/idle minutes, span, in-window OCCUPANCY %, util %
    vs an ASSUMED 8h day, double-booking flag, and the day's position in time vs `today`
    (when / days_ago). Resource Utilization reuses this as its theatre component.
  - Surgical Waiting List Optimization: `case_scheduling.wait_days` — this case's
    listed→surgery interval, GATED by `listing_reliable` (a same-day/retrospective booking
    entry is flagged, not reported as a real 0-day wait). A single-case point, not depth.
  - Cancellation Prediction: `case_scheduling` postpone/cancel track record (isPostponed,
    postpone_count, reason, status) + the `or_utilization.double_booked` conflict — a
    concrete disruption/risk signal for THIS case, not a cohort rate.
  - Case Duration Analytics + Surgical Oncology Registry: this case's own duration / entry.

DATE-AWARENESS: `state['today']` (server date, from data_sources) is threaded into both
summaries so a theatre day / surgery date two weeks in the past reads as a historical
record (past tense, no forward actions), not as a live, present-tense event.

DESIGN (user decision — m7-style reasoning, via base._reasoning_license):
  m12 is DECISION SUPPORT, not transcription — but with a twist unique to this module.
  Because it is COHORT-level over a single-patient load, the pure-cohort FINDINGS (bed
  occupancy, benchmark dashboards, department score) are honestly 'Not available' — yet
  the Reference/Expected column must STILL show the operational target (occupancy <90%,
  unit vs national benchmark) and `action` the concrete next step, so even an unanswerable
  cohort row teaches WHAT the benchmark is. HARD BOUNDARY (same as m7): every case fact
  (wait days, duration, postpone record, theatre load, outcome) comes STRICTLY from the
  record / booking collections and is never invented; only the operational benchmark in
  `reference` is trained knowledge.

Sources (all read-only):
  - today            : server calendar date (state['today']) — anchors past/today/upcoming.
  - booking          : otRoom, surgeryDate, caseStatus, procedureName (the case's OT footprint).
  - or_utilization   : deterministic theatre-day load for THIS case's OT (data_sources.
                       summarize_or_utilization over ot_room_bookings) — the ONE real
                       department-scoped metric (cases, booked/idle minutes, in-window
                       occupancy %, util % vs an assumed 8h day, double-booked flag, and
                       when/days_ago vs today). {} if the case has no room/date.
  - case_scheduling  : deterministic scheduling facts (data_sources.summarize_case_scheduling)
                       — wait_days (listed→surgery) with listing_reliable gate, surgery_days_ago,
                       lifecycle status, acuity, and the postpone/cancellation track record.
  - management       : operationStartTime/EndTime, duration (case-duration sliver).
  - post_op          : complications, mortality (this case's contribution to registry/benchmark).
  - discharge        : admissionDate / dischargeDate (LOS sliver - empty until discharged).
"""

from typing import Any, Dict

from .base import BaseDashboardAgent


class DepartmentAgent(BaseDashboardAgent):
    MODULE_ID = "m12"
    TITLE = "Department Analytics & Operations"
    PARAMETERS = [
        "Operating Room Utilization",
        "Surgical Waiting List Optimization",
        "Case Duration Analytics",
        "Cancellation Prediction",
        "Bed Occupancy Prediction",
        "Resource Utilization Dashboard",
        "Surgical Oncology Registry",
        "Quality Benchmark Dashboard",
        "Outcome Benchmarking",
        "Surgical Department Performance Score",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        mgmt = active.get("management") or {}
        post_op = active.get("post_op") or {}
        discharge = active.get("discharge") or {}

        return {
            # server 'today' — lets the agent place the theatre day / surgery date as past,
            # today, or upcoming (or_utilization.days_ago / case_scheduling.surgery_days_ago
            # carry the resolved offsets) instead of reading every date present-tense.
            "today": state.get("today", ""),

            # --- this case's OT / operational footprint ---
            "procedureName": booking.get("procedureName", ""),
            "otRoom": booking.get("otRoom", ""),
            "surgeryDate": booking.get("surgeryDate", ""),
            "caseStatus": booking.get("caseStatus", ""),

            # --- REAL theatre-day OR load (deterministic, department-scoped) ---
            # `or_utilization` = data_sources.summarize_or_utilization over the
            # ot_room_bookings collection for THIS case's otRoom + surgeryDate, across ALL
            # patients. Exact numbers already computed (cases, booked/idle minutes, span,
            # in-window occupancy %, util % vs an ASSUMED 8h day, double-booked flag, and
            # when/days_ago vs today) — the agent reports them, it does NOT recompute. {}
            # when the case was never scheduled to a room/date.
            "or_utilization": state.get("or_utilization") or {},

            # --- REAL single-case scheduling facts (deterministic) ---
            # `case_scheduling` = data_sources.summarize_case_scheduling(active, today):
            # wait_days (listed→surgery) with a listing_reliable gate (a same-day/retrospective
            # booking entry is flagged rather than reported as a real 0-day wait), surgery_days_ago,
            # lifecycle status, acuity (caseStatus), and the postpone / cancellation track record
            # (isPostponed, postpone_count, reason). Feeds the Waiting List and Cancellation
            # Prediction rows with a real single-case data point — NOT a cohort statistic.
            "case_scheduling": state.get("case_scheduling") or {},

            # --- case-duration sliver ---
            "operationStartTime": mgmt.get("operationStartTime", ""),
            "operationEndTime": mgmt.get("operationEndTime", ""),
            "duration": mgmt.get("duration", ""),

            # --- this case's contribution to registry / benchmarking ---
            "complications": post_op.get("complications", []),
            "clavienDindo": post_op.get("clavienDindo", ""),
            "mortality30": post_op.get("mortality30", ""),
            "mortality90": post_op.get("mortality90", ""),

            # --- length-of-stay sliver (empty until discharged) ---
            "admissionDate": discharge.get("admissionDate", ""),
            "dischargeDate": discharge.get("dischargeDate", ""),
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m12 specifically (IMPORTANT — read this carefully): this is the DEPARTMENT / OPERATIONS "
            "module, which is COHORT-level, but this pipeline only loaded ONE patient's record. For the pure "
            "cohort rows you therefore CANNOT compute department statistics (waiting-list DEPTH, ward occupancy, "
            "cancellation RATES, benchmark norms) — that data is not here, and you must NOT invent it. So for "
            "every such cohort/department row set finding='Not available — requires department-level data' "
            "(status neutral). BUT — and this is the whole point — you must STILL fill 'reference' with the "
            "operational TARGET/benchmark for that metric and 'action'='Connect department-level analytics feed', "
            "so the Reference/Expected column shows WHAT the benchmark is even when this single record can't "
            "answer it. SEVERAL rows DO have a real, record-grounded finding you MUST use (do NOT mark these "
            "'Not available' when their source is populated): Operating Room Utilization (`or_utilization`), "
            "Surgical Waiting List Optimization (`case_scheduling.wait_days`), Cancellation Prediction "
            "(`case_scheduling` postpone/cancel record + `or_utilization.double_booked`), Case Duration "
            "Analytics, and Surgical Oncology Registry. These are single-case / single-theatre data points, "
            "NOT cohort statistics — say so.\n\n"
            "DATE CONTEXT (IMPORTANT): `today` in DATA is the current server date. The theatre day and the "
            "surgery date are frequently in the PAST relative to today (a completed case). Use `or_utilization."
            "when`/`days_ago` and `case_scheduling.surgery_days_ago` to write findings in the correct tense — a "
            "day that already happened is a RETROSPECTIVE record ('… days ago, on <date>'), so do NOT phrase it as "
            "live or recommend forward scheduling actions on it. Only a case that is TODAY or UPCOMING gets "
            "forward-planning actions.\n\n"
            "PARAMETER GUIDANCE — [finding source] · reference=[operational target, ALWAYS filled] · judge→[pill/action]:\n"
            "- Operating Room Utilization: USE `or_utilization` (already computed for THIS case's theatre on its "
            "surgery day, across ALL patients — do NOT recompute or invent). If it is empty ({}), finding='Not "
            "available — this case has no theatre/date scheduled', neutral, action='Schedule the case to an OT "
            "room'. FIRST place the day in time from `when`/`days_ago`: when='past' (days_ago>0) is a HISTORICAL "
            "record — describe what happened in the PAST tense (e.g. '<days_ago> days ago, on <date>') and do NOT "
            "recommend forward scheduling for it; when='today'/'upcoming' is where forward planning actions apply. "
            "LEAD the finding with in-window OCCUPANCY, not the assumed-8h figure: '<cases> case(s) in <otRoom> on "
            "<date> (<completed> completed, <reserved> reserved) — theatre in use <total_booked_hm> of the "
            "<span_hm> it was open (<earliest_start>–<latest_end>), <occupancy_pct>% occupancy, <idle_hm> idle'. "
            "You MAY add the assumed-day load as a SECONDARY, clearly-caveated note ('~<total_booked_hm> booked ≈ "
            "<utilization_pct>% of an assumed <standard_day_hours>h list') — but NEVER headline the "
            "utilization_pct, and explicitly note it can exceed 100% simply because the list ran longer than the "
            "assumed day (it is a planning proxy, not measured occupancy). Also note 'reserved' cases' end-times "
            "are hourly estimates. reference='Theatre occupancy 80-90% of the working list; no double-booking'. "
            "judge on OCCUPANCY: 'Normal'(ok) if occupancy_pct is high (~75%+) with no double-booking — a busy "
            "list is GOOD, so do NOT tell a well-used theatre to 'fill idle time'; 'Review'(watch) only if "
            "double_booked is true (action='Resolve overlapping bookings in <otRoom>') OR the theatre sat largely "
            "idle (low occupancy) AND when≠'past' (action='Optimise theatre scheduling to fill idle time'). For a "
            "past, well-used day with no conflict, action='No action — retrospective utilisation on record'.\n"
            "- Surgical Waiting List Optimization: USE `case_scheduling`. GATE on `listing_reliable`: it is true "
            "only when the booking was entered BEFORE the surgery day (wait_days>0), i.e. a real waiting interval. "
            "If listing_reliable is true, report it: '<wait_days> days from listing (<listed_date>) to surgery "
            "(<surgery_date>)', and factor acuity (an Emergency case is expected to be short; the 21-day target "
            "applies to Elective disease). If listing_reliable is FALSE (wait_days is 0 or negative — the booking "
            "was entered on/after the surgery day, so the listing date is just the data-entry date), do NOT report "
            "a '0-day wait' as on-target — finding='Waiting time not captured — booking entered on the day of "
            "surgery (retrospective entry), so listing→surgery interval is not a real wait', status neutral, "
            "action='Record decision-to-treat date to measure true waiting time'. If wait_days is null, "
            "finding='Not available — surgery date not scheduled', action='Schedule the case'. NOTE this is ONE "
            "case's interval, NOT the department's waiting-list depth. reference='Time-to-surgery <21 days for "
            "resectable/elective disease'. judge→'Normal'(ok) if a reliable elective wait is within ~21 days (or "
            "an emergency was done promptly); 'Review'(watch) if a reliable elective wait is well beyond 21 days "
            "(action='Review waiting-list priority').\n"
            "- Case Duration Analytics: THIS CASE's duration IS available — report duration (or compute from "
            "operationStartTime→EndTime). reference='Within ±20% of expected time for the procedure'. judge→"
            "'Normal'(ok) if plausible/within range; 'Review'(watch) if markedly prolonged; 'Not available' only if "
            "no times recorded. (A cohort distribution is not available, but the single-case duration is.)\n"
            "- Cancellation Prediction: USE `case_scheduling` + `or_utilization.double_booked` — a real "
            "disruption/RISK signal for THIS case (not a cohort rate). If status is 'Cancelled', finding names "
            "it with cancellation_reason (alert). If is_postponed / postpone_count>0, finding='Postponed "
            "<postpone_count>× (reason: \"<postpone_reason>\")' — ALWAYS quote postpone_reason as the recorded "
            "reason text so a terse entry like \"Today\" reads as the reason given, NOT as when it happened (the "
            "postponement is a PAST disruption; use surgery_days_ago for when the case sat). If or_utilization is "
            "populated and double_booked is true, that theatre conflict is a forward on-day-cancellation RISK "
            "(watch, action='Resolve overlapping bookings'). If the case is Completed with no postpone and no "
            "conflict, finding='Completed as scheduled — no cancellation/postponement' (ok). NOTE the "
            "department-wide cancellation RATE is still not available. reference='On-day cancellation rate "
            "minimized; no repeat postponements'.\n"
            "- Bed Occupancy Prediction: cohort → 'Not available' (there is no ward/bed-occupancy data in this "
            "record; you MAY note this case occupies one bed for its admission if admissionDate is present). "
            "reference='Bed occupancy <90%'. judge→neutral, action='Connect analytics feed'.\n"
            "- Resource Utilization Dashboard: the THEATRE-resource component IS available from `or_utilization` "
            "— report the theatre load for the day (<cases> cases, <total_booked_hm> booked of <span_hm> open, "
            "<occupancy_pct>% occupancy, <idle_hm> idle in <otRoom>) as the theatre-utilization component, in the "
            "correct tense for `when` (past = what happened), and state that STAFF and EQUIPMENT utilization are "
            "'Not available — require department-level data'. If or_utilization is empty, the whole row is 'Not "
            "available'. reference='Staff / theatre / equipment optimally utilized'. judge→'Normal'(ok) if "
            "theatre occupancy is reasonable; 'Review'(watch) if the theatre sat largely idle or is double-booked; "
            "action='Connect staff/equipment analytics feed' for the missing components.\n"
            "- Surgical Oncology Registry: THIS CASE as a registry entry IS available — one line: procedure + date + "
            "stage/outcome. reference='Case captured in oncology registry'. judge→'Complete'(ok) once the entry is "
            "populated.\n"
            "- Quality Benchmark Dashboard: needs benchmark norms → 'Not available' (may state this case's quality "
            "metrics but not a benchmark comparison). reference='Unit metrics vs national benchmark'. judge→neutral, "
            "action='Connect analytics feed'.\n"
            "- Outcome Benchmarking: needs cohort norms → 'Not available' (may state this case's outcome: complication "
            "grade, mortality No/No). reference='Risk-adjusted outcomes vs peer units'. judge→neutral, action='Connect "
            "analytics feed'.\n"
            "- Surgical Department Performance Score: cohort composite → 'Not available' (the OR-utilization "
            "component above is one real input, but a department score needs the full cohort). reference="
            "'Composite department performance vs target'. judge→neutral, action='Connect analytics feed'.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
