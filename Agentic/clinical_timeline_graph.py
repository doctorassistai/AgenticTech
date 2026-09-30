# clinical_timeline_graph.py
#
# This file is now a thin combiner. All logic has been split into:
#   - clinical_timeline_base.py       (patient / clinical event / doctor)
#   - clinical_timeline_encounters.py (encounter lifecycle + summaries)
#   - clinical_timeline_synthesis.py  (cross-encounter synthesis + process_document)
#
# The public class name, constructor signature, and every public
# method remain IDENTICAL to before, so existing callers such as:
#
#   from Agentic.clinical_timeline_graph import ClinicalTimelineGraph
#
#   clinical_timeline_graph = ClinicalTimelineGraph(
#       uri=neo4j_uri,
#       user=neo4j_user,
#       password=neo4j_password,
#   )
#
# require NO changes.

from .clinical_timeline_base import ClinicalTimelineBaseMixin
from .clinical_timeline_encounters import ClinicalTimelineEncounterMixin
from .clinical_timeline_synthesis import ClinicalTimelineSynthesisMixin
from .clinical_timeline_patient_profile import ClinicalTimelinePatientProfileMixin  # Add this


class ClinicalTimelineGraph(
    ClinicalTimelineSynthesisMixin,
    ClinicalTimelineEncounterMixin,
    ClinicalTimelinePatientProfileMixin,  # Add this
    ClinicalTimelineBaseMixin,
):
    """
    Same public API as the original monolithic ClinicalTimelineGraph.
    Behavior is unchanged — only the code has been split across
    three files for maintainability.
    """
    pass