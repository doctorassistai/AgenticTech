"""m8 — Follow-up & Recurrence Surveillance.

The longitudinal, forward-looking module: what happens AFTER the surgical episode —
follow-up schedule, surveillance imaging, tumor-marker trend, recurrence/metastasis
watch, functional outcome, survivorship planning.

Record-grounded FINDINGS with a guideline REFERENCE (user decision — m7-style reasoning,
via base._reasoning_license): the `reference` column may name the general surveillance
standard (NCCN-style follow-up cadence, site imaging, CEA/CA19-9 interval, risk-stratified
recurrence band) as trained knowledge, but the FINDING stays STRICTLY record-grounded —
report what the record documents and say 'Not yet scheduled' / 'Not available' for anything
not yet filled in, never inventing a date, a scan, or a recurrence. Much of this block
populates only once the doctor completes the discharge & follow-up summary, so empty
follow-up fields are expected early and must read honestly (with the standard in `reference`
and the next step in `action`).

Sources (all read-only, active booking):
  - `discharge` : followUpDate, followUpClinic, dischargeAdvice (has a Follow-up section),
                  pendingReports, adjuvantPlan, conditionAtDischarge — the follow-up plan.
  - `booking` / `pac.otherHistory` : diagnosis (surveillance intent).
  - `management` : stagingT/N/M, resection, intentOfProcedure, postOperativeDiagnosis
                   (recurrence-risk basis).
  - `labs` : aggregated lab history — supplement for tumor-marker monitoring.
  - `investigation_register` : the cross-doctor order register (all ordering doctors) joined
                   to resulted values — the AUTHORITATIVE source of serial tumour markers
                   (CEA / CA 19-9 etc.), assembled per-marker by `pick_tumor_markers`.
  - `post_op` : complications carried forward as long-term monitoring items.
"""

from typing import Any, Dict

from .base import BaseDashboardAgent
from ..data_sources import pick_tumor_markers


class SurveillanceAgent(BaseDashboardAgent):
    MODULE_ID = "m8"
    TITLE = "Follow-up & Recurrence Surveillance"
    PARAMETERS = [
        "Follow-up Schedule Generator",
        "Surveillance Imaging Recommendation",
        "Tumor Marker Monitoring",
        "Local Recurrence Detection",
        "Distant Metastasis Surveillance",
        "Post-operative Functional Outcome",
        "Long-term Complication Monitoring",
        "Survivorship Care Planning",
        "Recurrence Risk Dashboard",
        "Follow-up Compliance Monitoring",
        "Outcome Trend Analysis",
        "Survivorship Dashboard",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        pac = (active.get("anaesthesia") or {}).get("pac") or {}
        mgmt = active.get("management") or {}
        post_op = active.get("post_op") or {}
        discharge = active.get("discharge") or {}
        labs = state.get("labs") or {}
        register = state.get("investigation_register") or []

        return {
            "procedureName": booking.get("procedureName", ""),
            "preOpDiagnosis": booking.get("preOpDiagnosis", ""),
            "otherHistory": pac.get("otherHistory", ""),

            # --- follow-up plan (populates once discharge summary is completed) ---
            "followUpDate": discharge.get("followUpDate", ""),
            "followUpClinic": discharge.get("followUpClinic", ""),
            "dischargeAdvice": discharge.get("dischargeAdvice", ""),
            "conditionAtDischarge": discharge.get("conditionAtDischarge", ""),
            "pendingReports": discharge.get("pendingReports", ""),
            "adjuvantPlan": discharge.get("adjuvantPlan", ""),

            # --- recurrence-risk basis (from the pathological outcome) ---
            "stagingT": mgmt.get("stagingT", ""),
            "stagingN": mgmt.get("stagingN", ""),
            "stagingM": mgmt.get("stagingM", ""),
            "resection": mgmt.get("resection", ""),
            "intentOfProcedure": mgmt.get("intentOfProcedure", ""),
            "postOperativeDiagnosis": mgmt.get("postOperativeDiagnosis", ""),

            # --- long-term complication carry-over ---
            "complications": post_op.get("complications", []),
            "complicationDescription": post_op.get("description", ""),

            # --- tumor markers / labs (trend monitoring) ---
            # `tumor_markers` = the DETERMINISTIC per-marker serial series (CEA / CA 19-9 / …)
            # assembled in Python via pick_tumor_markers from the cross-doctor investigation
            # register (resulted, dated) + the doctor's-note labs — so the agent reads a ready
            # value+trend instead of hunting the raw register. `labs` stays as a supplement.
            "tumor_markers": pick_tumor_markers(register, labs),
            "labs": labs,
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m8 specifically (CRITICAL): the `reference` may name the general guideline surveillance "
            "standard, but the FINDING stays STRICTLY record-grounded — do NOT invent a follow-up date, a "
            "scheduled scan, or a recurrence that isn't in the DATA. Much of this populates only after the "
            "doctor completes the discharge & follow-up summary, so 'Not yet scheduled' / 'Not available' are "
            "the correct, honest FINDING early — while `reference` still shows the standard and `action` the "
            "next step (this is the whole point: an unscheduled row must still show WHAT is expected).\n\n"
            "PARAMETER GUIDANCE — [finding source, record-only] · reference=[guideline standard] · judge→[pill/action]:\n"
            "- Follow-up Schedule Generator: from followUpDate + followUpClinic, or the Follow-up section of "
            "dischargeAdvice (e.g. an interval like '2-3 weeks'). reference='NCCN-style: clinic q3-6mo yr 1-3, "
            "then q6-12mo'. judge→'Complete'(ok) if an on-protocol schedule is on file; if none, finding='Not "
            "yet scheduled', neutral, action='Schedule first surveillance visit per protocol'.\n"
            "- Surveillance Imaging Recommendation: report imaging surveillance ONLY if documented in "
            "dischargeAdvice / pendingReports / adjuvantPlan. reference names the modality typical for the site "
            "(e.g. 'CT chest/abdo ± PET for esophageal') but the finding must reflect what is recorded; else "
            "finding='Not yet scheduled'. judge→'Complete'(ok) if booked; 'Pending'(watch) if due but not booked.\n"
            "- Tumor Marker Monitoring: use `tumor_markers` — the already-assembled per-marker "
            "series (each has `marker`, `count`, and `readings` = date-sorted {value, date, "
            "source}, oldest->newest). For each marker present, report the latest value with its "
            "date AND the trend across readings (rising / stable / falling; say 'single reading, "
            "no trend yet' when count is 1). Do NOT recompute from raw labs — these are the "
            "authoritative readings (they span every ordering doctor via the investigation "
            "register). reference='CEA / CA 19-9 (or site-appropriate marker) q3-6mo where "
            "applicable'. judge→'Normal'(ok) if within range / falling after resection, "
            "'Review'(watch) if rising (action='repeat + correlate with imaging'); if "
            "`tumor_markers` is empty, finding='Not available' (action='No tumour marker "
            "resulted — order the site-appropriate marker if indicated').\n"
            "- Local Recurrence Detection: report a local recurrence ONLY if documented; otherwise 'No recurrence "
            "documented'. reference='No local recurrence on surveillance'. judge→'Clear'(ok) if none; 'Critical'"
            "(alert) if detected.\n"
            "- Distant Metastasis Surveillance: same — report metastasis only if documented; else 'No metastasis "
            "documented'. reference='No distant metastasis'. judge→'Clear'(ok) if none; 'Critical'(alert) if detected.\n"
            "- Post-operative Functional Outcome: from conditionAtDischarge + dischargeAdvice (e.g. swallowing/diet "
            "progression for esophagectomy). reference='Return to baseline function'. judge→'Normal'(ok) if "
            "improving; 'Review'(watch) if impaired; 'Not available' if not documented.\n"
            "- Long-term Complication Monitoring: carry forward complications[] + description as items to monitor "
            "(e.g. post-pneumonia respiratory follow-up). reference='Active issues tracked to resolution'. "
            "judge→'Review'(watch) if an active issue to track; else 'Clear'(ok).\n"
            "- Survivorship Care Planning: from any survivorship/rehabilitation/nutrition plan in dischargeAdvice. "
            "reference='Survivorship plan (rehab / nutrition / psychosocial)'. judge→'Complete'(ok) if a plan "
            "exists; 'Not available' / action='Initiate survivorship plan' if not documented.\n"
            "- Recurrence Risk Dashboard: qualitative band (low/intermediate/high) justified by the documented "
            "pathology (stage, node status, resection) — NOT a fabricated percentage. reference='Risk-stratified "
            "by stage / nodes / margins'. judge→pill reflects the band ('Normal'/ok low, 'Review'/watch "
            "intermediate, 'Critical'/alert high).\n"
            "- Follow-up Compliance Monitoring: whether follow-up visits are being attended — only if the record "
            "tracks it; otherwise 'Not available' (no follow-up history yet). reference='Scheduled visits attended'. "
            "judge→'Complete'(ok) if compliant; 'Not available' early.\n"
            "- Outcome Trend Analysis: PREFER the `tumor_markers` series (a marker with >=2 dated "
            "readings IS a trend) — state the direction over time; add any other multi-time-point "
            "signal from labs/visits. 'Not available' only if every source has a single time point. "
            "reference='Marker/clinical trend across time points'. judge→'Normal'(ok) if stable/"
            "improving, 'Review'(watch) if worsening.\n"
            "- Survivorship Dashboard: one concise summary line — current status + next surveillance step (or 'awaiting "
            "follow-up scheduling'). reference='Surveillance on-protocol; next step defined'. judge→'Complete'(ok) "
            "if on track.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
