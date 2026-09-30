"""m3 — Surgical Safety & Intraoperative Intelligence.

Maps the WHO safety checklist + the management (operative) record + anaesthesia
monitoring onto the 12 safety/intraoperative parameters.

NOTE on 'Prediction' parameters: several rows are named "… Prediction" (blood,
duration, intraoperative risk). In a completed record these are reported as the
DOCUMENTED / actual values (e.g. actual duration, actual blood loss, the risks the
team flagged at time-out) — never a fabricated forecast. If the case isn't done yet,
they fall back to whatever was planned, else 'Not available'.

DESIGN (user decision — m7-style reasoning, via base._reasoning_license):
  m3 is DECISION SUPPORT, not transcription. Each safety row names the expected STANDARD
  in `reference` (WHO checklist complete, antibiotic within 60 min of incision, VTE
  mechanical+pharmacological, cross-match confirmed pre-incision) and judges the finding
  against it, rather than echoing a bare fact. HARD BOUNDARY (same as m7): the case facts
  — checklist items, timings, blood loss, complications — come STRICTLY from the record;
  only the general safety standard in `reference` is trained knowledge; 'prediction' rows
  still report DOCUMENTED values, never forecasts.
"""

from typing import Any, Dict

from .base import BaseDashboardAgent
from ..data_sources import summarize_checklist

# WHO checklist prefixes we surface (top-level `checklist` object).
_WHO_PREFIXES = ("signin_", "timeout_", "signout_", "extubation_")


class SafetyAgent(BaseDashboardAgent):
    MODULE_ID = "m3"
    TITLE = "Surgical Safety & Intraoperative Intelligence"
    PARAMETERS = [
        "WHO Surgical Safety Checklist",
        "Procedure Verification",
        "Implant & Device Verification",
        "Blood Requirement Prediction",
        "Antibiotic Prophylaxis",
        "VTE Prophylaxis",
        "Intraoperative Risk Prediction",
        "Surgical Duration Prediction",
        "Intraoperative Complication",
        "Critical Structure Risk Alerts",
        "Intraoperative Documentation",
        "Surgical Workflow Dashboard",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        note = active.get("doctors_note") or {}
        checklist = active.get("checklist") or {}
        mgmt = active.get("management") or {}
        mm = (active.get("anaesthesia") or {}).get("mm") or {}

        who = {k: v for k, v in checklist.items() if str(k).startswith(_WHO_PREFIXES)}

        return {
            # --- WHO safety checklist ---
            # `checklist_summary` carries the DETERMINISTIC per-phase tallies (yes/no/na/blank,
            # expected, critical 'No's, free-text concerns) computed in Python via
            # summarize_checklist so the agent never miscounts the raw `${id}_status` blob
            # (blanks / NA / free-text fields previously made it default to 'pending'). This is
            # a CUSTOM checklist aligned to the WHO Surgical Safety Checklist. m3 is intra-op
            # scope, so it reports ALL THREE phases (Sign In / Time Out / Sign Out). The raw
            # `who_checklist` stays only as a supplementary lookup for individual item remarks.
            "checklist_summary": summarize_checklist(checklist),
            "who_checklist": who,
            "bloodConfirmed": note.get("bloodConfirmed", booking.get("bloodConfirmed", "")),
            "machineCheck": note.get("machineCheck", booking.get("machineCheck", "")),

            # --- prophylaxis ---
            "prophylacticAntibiotics": mgmt.get("prophylacticAntibiotics", ""),
            "postOpAntibioticProtocol": mgmt.get("postOpAntibioticProtocol", ""),
            "dvtProphylaxis": mgmt.get("dvtProphylaxis", ""),

            # --- blood ---
            "bloodProducts": mgmt.get("bloodProducts", []),
            "volumeOfBloodProducts": mgmt.get("volumeOfBloodProducts", ""),
            "bloodLoss": mgmt.get("bloodLoss", ""),

            # --- duration / timings ---
            "duration": booking.get("duration", ""),
            "operationStartTime": mgmt.get("operationStartTime", ""),
            "operationEndTime": mgmt.get("operationEndTime", ""),
            "anaesthesiaStartTime": mgmt.get("anaesthesiaStartTime", ""),
            "anaesthesiaEndTime": mgmt.get("anaesthesiaEndTime", ""),

            # --- intraop course / complications / critical structures ---
            "intraOpCourse": mgmt.get("intraOpCourse", ""),
            "intraOpComplications": mgmt.get("intraOpComplications", []),
            "complicationDetails": mgmt.get("complicationDetails", ""),
            "findings": mgmt.get("findings", ""),

            # --- documentation completeness ---
            "procedureDetails": mgmt.get("procedureDetails", ""),
            "additionalNotes": mgmt.get("additionalNotes", ""),
            "approach": mgmt.get("approach", ""),

            # --- monitoring / workflow ---
            "modeAnaesthesia": mm.get("modeAnaesthesia", ""),
            "monitors": mm.get("monitors", []),
            "typeOfAnesthesia": mgmt.get("typeOfAnesthesia", []),
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m3 specifically: the facts (checklist items, timings, blood loss, complications) come "
            "STRICTLY from the DATA; 'prediction' rows report the DOCUMENTED / actual value, never a "
            "forecast. Judge each safety element against its standard.\n\n"
            "PARAMETER GUIDANCE — [finding source] · reference=[standard] · judge→[pill/action]. "
            "'Not available' finding only if the source is empty (still fill reference + action):\n"
            "- WHO Surgical Safety Checklist: use `checklist_summary` — the AUTHORITATIVE, "
            "already-counted tallies (do NOT recount the raw `who_checklist` keys; blanks / NA / "
            "free-text concern fields are NOT 'No'). It is a CUSTOM checklist aligned to the WHO "
            "Surgical Safety Checklist. m3 is intra-operative, so report ALL THREE WHO phases from "
            "`checklist_summary.phases` — Sign In (phase_id 'signin'), Time Out ('timeout'), Sign "
            "Out ('signout') — each as '<yes> of <expected> confirmed' using its exact integers "
            "(NA items are excluded from `expected`). Name any `no_items` per phase, and note any "
            "`freetext_concerns` the team recorded. A phase whose items are all blank was simply "
            "not yet reached/recorded (`performed` false) — report it as 'not yet performed', NOT "
            "as a failure. reference='Custom checklist aligned to WHO Surgical Safety Checklist — "
            "all three phases completed in theatre'. judge→'Critical'(alert) if `critical_no` is "
            "non-empty (a safety-critical item — consent, cross-match, viral status, site marking, "
            "laterality, antibiotic, mop/instrument count — answered 'No'); 'Review'(watch) if any "
            "other item is 'No' or a performed phase has unconfirmed (blank) items, action naming "
            "them; 'Complete'(ok) if `all_clear` (every expected item confirmed Yes/NA across all "
            "phases with no 'No'); 'Pending'(watch) 'Not yet started' if `checklist_summary.started` "
            "is false.\n"
            "- Procedure Verification: signin_procedure/side/site + timeout_procedure. reference='Correct "
            "patient/site/procedure confirmed'. judge→'Complete'/'Concordant'(ok) when verified.\n"
            "- Implant & Device Verification: only if an implant/device is documented; a resection with no implants "
            "=> finding='No implant/device used'. reference='Implants counted & verified if used'. judge→'Noted'"
            "(neutral) when none used (nothing to verify); 'Complete'(ok) if a device is documented and verified.\n"
            "- Blood Requirement Prediction: signin_blood remarks (units cross-matched) + bloodProducts + "
            "bloodConfirmed; note actual bloodLoss / volumeOfBloodProducts if present. reference='Cross-match "
            "confirmed pre-incision'. judge→'Complete'(ok) if cross-match confirmed; 'Review'(watch) if blood "
            "need is outstanding.\n"
            "- Antibiotic Prophylaxis: prophylacticAntibiotics + timeout_antibiotic status. reference='Within 60 "
            "min of incision'. judge→'Complete'(ok) when given/confirmed on time; 'Review'(watch) if timing "
            "unclear.\n"
            "- VTE Prophylaxis: dvtProphylaxis + any DVT/SCD/Enoxaparin note in signout concerns. "
            "reference='Mechanical + pharmacological per risk (Caprini)'. judge→'Complete'(ok) if documented; "
            "'Review'(watch) if only partial/absent.\n"
            "- Intraoperative Risk Prediction: the risks the team flagged in timeout_events_anaesthesia/surgeon "
            "(report as documented anticipated risks, not a new forecast). reference='Anticipated risks "
            "mitigated'. judge→'Review'(watch) when risks were named; 'Normal'(ok) if none flagged.\n"
            "- Surgical Duration Prediction: booking.duration + operation start/end times (compute actual only from the "
            "times given). Do NOT estimate a duration not supported by the data. reference='Within ±20% of typical "
            "for the procedure'. judge→'Noted'(neutral) reporting the actual; 'Review'(watch) if markedly prolonged.\n"
            "- Intraoperative Complication: intraOpComplications + complicationDetails + intraOpCourse. "
            "reference='Uneventful intra-operative course'. judge→'Review'/'Critical'(watch/alert) if a "
            "complication occurred; 'Normal'(ok) if course was uneventful.\n"
            "- Critical Structure Risk Alerts: named structures at risk in timeout_events_surgeon / findings "
            "(e.g. aorta, azygos vein, celiac axis). reference='No threatened critical structure'. judge→'Review'"
            "(watch) with the mitigation as action when a hazard is named; 'Clear'(ok) if none noted.\n"
            "- Intraoperative Documentation: completeness of procedureDetails/findings/additionalNotes. "
            "reference='Complete operative narrative on file'. judge→'Complete'(ok) if a full narrative is "
            "present; 'Review'(watch) if sparse.\n"
            "- Surgical Workflow Dashboard: concise summary of anaesthesia mode + monitors + operative timings. "
            "reference='Standard monitoring & workflow'. judge→'Noted'(neutral) unless something departs from "
            "standard.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
