"""m5 — Post-operative Management.

Day-by-day recovery monitoring after the case: ERAS compliance, the complications
that actually occurred (the case is done, so 'prediction' rows report the DOCUMENTED
outcome — never a fabricated forecast), Clavien-Dindo grade, wound / anastomotic /
bleeding surveillance, drain & pain & nutrition management, and discharge readiness.

Sources (all read-only, all from the active booking):
  - `post_op`     : hasComplications, complications[], description, clavienDindo,
                    readmit30/90, mortality30/90 — the authoritative outcome block.
  - `management`  : drains, drainDetails, analgesiaPlan, dietInstructions,
                    dvtProphylaxis, transferTo, postOperativePlan, postOpAntibioticProtocol,
                    intraOpComplications, complicationDetails, typeOfAnesthesia (epidural → ERAS).
  - `discharge`   : courseInHospital, conditionAtDischarge, dischargeAdvice,
                    dischargeDate, followUpDate, adjuvantPlan — mostly empty until the
                    patient is actually discharged (→ discharge-readiness rows = 'Awaiting').

DESIGN (user decision — m7-style reasoning, via base._reasoning_license):
  m5 is DECISION SUPPORT, not transcription. Each recovery row names the expected STANDARD
  in `reference` (ERAS core elements present, Clavien 0-I, no wound/leak/bleed, adequate
  analgesia, discharge criteria met) and judges the DOCUMENTED outcome against it. HARD
  BOUNDARY (same as m7): the outcome facts — complications, Clavien grade, readmission,
  discharge status — come STRICTLY from the record; 'prediction' rows report what actually
  happened, never a forecast; if an outcome field is empty the finding stays 'Not
  available' while reference + action are still filled.
"""

from typing import Any, Dict

from .base import BaseDashboardAgent


class PostopAgent(BaseDashboardAgent):
    MODULE_ID = "m5"
    TITLE = "Post-operative Management"
    PARAMETERS = [
        "ERAS Protocol Compliance",
        "Post-operative Complication Prediction",
        "Clavien-Dindo Classification",
        "Wound Infection Detection",
        "Anastomotic Leak Risk",
        "Post-operative Bleeding Detection",
        "Drain Management",
        "Pain Management",
        "Nutrition Recovery Monitoring",
        "Discharge Readiness Assessment",
        "Readmission Risk Prediction",
        "Post-operative Care Dashboard",
    ]

    def _slice(self, state: Dict[str, Any]) -> Dict[str, Any]:
        active = state.get("active_booking") or {}
        booking = active.get("booking") or {}
        mgmt = active.get("management") or {}
        post_op = active.get("post_op") or {}
        discharge = active.get("discharge") or {}

        return {
            "procedureName": booking.get("procedureName", ""),

            # --- outcome / complications (authoritative post-op block) ---
            "hasComplications": post_op.get("hasComplications", ""),
            "complications": post_op.get("complications", []),
            "complicationDescription": post_op.get("description", ""),
            "clavienDindo": post_op.get("clavienDindo", ""),
            "readmit30": post_op.get("readmit30", ""),
            "readmit90": post_op.get("readmit90", ""),
            "mortality30": post_op.get("mortality30", ""),
            "mortality90": post_op.get("mortality90", ""),

            # --- intra-op carry-over (bleeding surveillance context) ---
            "intraOpComplications": mgmt.get("intraOpComplications", []),
            "complicationDetails": mgmt.get("complicationDetails", ""),

            # --- recovery management (ERAS / drains / pain / nutrition) ---
            "typeOfAnesthesia": mgmt.get("typeOfAnesthesia", []),
            "analgesiaPlan": mgmt.get("analgesiaPlan", ""),
            "dietInstructions": mgmt.get("dietInstructions", ""),
            "drains": mgmt.get("drains", []),
            "drainDetails": mgmt.get("drainDetails", ""),
            "dvtProphylaxis": mgmt.get("dvtProphylaxis", ""),
            "transferTo": mgmt.get("transferTo", ""),
            "postOperativePlan": mgmt.get("postOperativePlan", ""),
            "postOpAntibioticProtocol": mgmt.get("postOpAntibioticProtocol", ""),
            "additionalNotes": mgmt.get("additionalNotes", ""),

            # --- discharge block (mostly empty until discharge is documented) ---
            "courseInHospital": discharge.get("courseInHospital", ""),
            "conditionAtDischarge": discharge.get("conditionAtDischarge", ""),
            "dischargeAdvice": discharge.get("dischargeAdvice", ""),
            "dischargeDate": discharge.get("dischargeDate", ""),
            "followUpDate": discharge.get("followUpDate", ""),
            "adjuvantPlan": discharge.get("adjuvantPlan", ""),
        }

    def _prompt(self, data: Dict[str, Any]) -> str:
        guide = self._reasoning_license() + (
            "For m5 specifically: the case is ALREADY DONE, so 'prediction' rows report the DOCUMENTED "
            "outcome (what actually happened), NOT a forecast. The outcome facts come STRICTLY from the "
            "DATA; judge each against its recovery standard.\n\n"
            "PARAMETER GUIDANCE — [finding source] · reference=[standard] · judge→[pill/action]. "
            "'Not available' finding only if the source is empty (still fill reference + action):\n"
            "- ERAS Protocol Compliance: infer from present ERAS elements — epidural analgesia "
            "(typeOfAnesthesia contains 'Epidural'), VTE prophylaxis (dvtProphylaxis='Yes'), early "
            "nutrition (dietInstructions), analgesia plan, mobilization/care plan (postOperativePlan). "
            "reference='ERAS core elements present (target >=90% compliance)'. judge→'Complete'(ok) if "
            "several core elements are documented, 'Review'(watch) if sparse. Do NOT claim a formal ERAS "
            "pathway unless the text says so — describe the elements found.\n"
            "- Post-operative Complication Prediction: report the ACTUAL complications from "
            "hasComplications + complications[] + complicationDescription. reference='No post-operative "
            "complication (Clavien 0)'. judge→if hasComplications='Yes', 'Critical'(alert) and name them; "
            "if 'No', finding='No complications documented', 'Clear'(ok).\n"
            "- Clavien-Dindo Classification: from clavienDindo (e.g. 'Grade 2'). reference='Clavien-Dindo "
            "0-I favourable'. judge→'Normal'(ok) for Grade 0-I / none, 'Review'(watch) for Grade 2, "
            "'Critical'(alert) for Grade 3+.\n"
            "- Wound Infection Detection: ONLY report a wound infection if complications/description mention "
            "surgical-site or wound infection. Otherwise finding='No wound infection documented'. "
            "reference='No surgical-site infection'. judge→'Clear'(ok) if none; 'Critical'(alert) if SSI.\n"
            "- Anastomotic Leak Risk: for an esophagectomy this is a key anastomosis. Report a leak ONLY if "
            "complications/description mention one; otherwise 'No anastomotic leak documented'. reference='No "
            "anastomotic leak'. judge→'Clear'(ok) if none; 'Critical'(alert) if a leak is documented.\n"
            "- Post-operative Bleeding Detection: distinguish intra-op (intraOpComplications / complicationDetails) "
            "from post-op bleeding. reference='No post-operative haemorrhage'. judge→if bleeding was "
            "intra-operative and controlled, say so ('Review'/watch); if no post-op bleeding is documented, "
            "finding='No post-operative bleeding documented', 'Clear'(ok).\n"
            "- Drain Management: from drains[] + drainDetails (type, sites, output). reference='Drains managed "
            "to removal criteria'. judge→'Complete'(ok) if documented.\n"
            "- Pain Management: from analgesiaPlan (+ epidural in typeOfAnesthesia). reference='Adequate "
            "analgesia (target VAS <=4)'. judge→'Complete'(ok) if a plan exists; action names escalation if "
            "pain is uncontrolled.\n"
            "- Nutrition Recovery Monitoring: from dietInstructions + dischargeAdvice diet section. "
            "reference='Early enteral nutrition / diet progression'. judge→'Complete'(ok) if a diet/nutrition "
            "plan is documented; 'Review'(watch) if the patient had pre-op malnutrition and it's mentioned.\n"
            "- Discharge Readiness Assessment: from the discharge block. reference='Discharge criteria met "
            "(pain / diet / mobility / wound / vitals)'. judge→if dischargeDate is EMPTY, the patient is not "
            "yet discharged → finding='Awaiting discharge documentation', neutral, action='Complete discharge "
            "assessment'. If courseInHospital / conditionAtDischarge are present, summarise readiness "
            "('Complete'/ok when criteria are met).\n"
            "- Readmission Risk Prediction: from readmit30 / readmit90 (documented outcome). reference='No "
            "30/90-day readmission'. judge→if both 'No', finding='No readmission (30/90-day)', 'Normal'(ok); "
            "if 'Yes', 'Critical'(alert). 'Not available' if empty.\n"
            "- Post-operative Care Dashboard: one concise sentence — ICU/ward transfer (transferTo), key "
            "complication + Clavien-Dindo grade, and current recovery status. reference='Recovery on ERAS "
            "trajectory'. judge→'Complete'(ok) if recovery is on track.\n\n"
        )
        return super()._prompt(data).replace("DATA:\n", guide + "DATA:\n")
