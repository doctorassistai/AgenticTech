"""Surgical Oncology Intelligence Dashboard — agentic backend.

12 LangGraph agents (one per dashboard module) read the surgery DB *read-only*
and each produce one structured table (ModuleResult) for the frontend
`DashboardTab.jsx`. See PLAN.md for the full design.

Currently wired: m1 (Patient Assessment & Surgical Readiness),
m2 (Diagnosis, Staging & Surgical Planning),
m3 (Surgical Safety & Intraoperative Intelligence),
m4 (Pathology Correlation & Margin Intelligence — flagship),
m5 (Post-operative Management),
m6 (Surgical Quality & Outcome Analytics),
m7 (Adjuvant Therapy Decision Support — flagship),
m8 (Follow-up & Recurrence Surveillance),
m9 (Documentation & Clinical Intelligence — DOC_COLUMNS),
m10 (Multidisciplinary Oncology Intelligence),
m11 (Surgical Pathology Intelligence),
m12 (Department Analytics & Operations).

All 12 modules are wired.
"""
