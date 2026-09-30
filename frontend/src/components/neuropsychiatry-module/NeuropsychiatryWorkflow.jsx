import React, { useState } from 'react';
import { NeuropsychiatryProvider, useNeuropsychiatry } from './context/NeuropsychiatryContext';
import {
  buildPsychotherapySession,
  buildMseSession,
  buildBaselineSession,
} from './context/tabFieldMap';

import PatientInfoTab from './tabs/PatientInfoTab';
import MSETab from './tabs/MSETab';
import BaselineDataTab from './tabs/BaselineDataTab';
import SurgeryTab from './tabs/SurgeryTab';
import EmergencyTab from './tabs/EmergencyTab';
import FindingsTab from './tabs/FindingsTab';
import PsychotherapyTab from './tabs/PsychotherapyTab';
import PostOpTab from './tabs/PostOpTab';
import SummaryTab from './tabs/SummaryTab';
import Toast from './components/Toast';
import VoiceDictation from './components/VoiceDictation';

const TABS = [
  { id: 'patient', label: 'Patient Info', component: PatientInfoTab },
  { id: 'mse', label: 'MSE & Cognition', component: MSETab },
  { id: 'baseline', label: 'Baseline Inv.', component: BaselineDataTab },
  { id: 'surgery', label: 'Surgery', component: SurgeryTab },
  { id: 'emergency', label: 'Emergency', component: EmergencyTab },
  { id: 'findings', label: 'Findings', component: FindingsTab },
  { id: 'psychotherapy', label: 'Psychotherapy/CBT Log', component: PsychotherapyTab },
  { id: 'post-procedure', label: 'Post-Procedure', component: PostOpTab },
  { id: 'summary', label: 'Summary', component: SummaryTab },
];

// ─────────────────────────────────────────────────────────────────────────────
// Which tabs offer the voice-dictation box, and the example each one shows.
//
// Adding a tab here is the whole change. VoiceDictation asks the provider which
// FormFields are currently mounted (getFieldSpecs) and posts that spec with the
// text, so it never needs to know a tab's fields — and because only the active
// tab's component is rendered, the registry already holds exactly that tab's
// fields and nothing else.
//
// The `section` value is the canonical section key from TAB_SECTION: it frames
// the backend prompt and is what the server logs, so it stays greppable.
// ─────────────────────────────────────────────────────────────────────────────
const DICTATION_TABS = {
  patient: {
    section: 'patient',
    hint: 'Dictate the history in one go — the form fills itself.',
    placeholder:
      'Press Record and speak, or type the note here…\n\n' +
      'e.g. "Female, date of birth 14 March 1988, married, blood group B positive, ' +
      'contact 98470 12345. Low mood and anhedonia for 8 weeks, insidious onset, no ' +
      'clear precipitant. Known hypertension and thyroid disorder. On escitalopram ' +
      '20 mg once daily, oral, good compliance. Non-smoker, social alcohol. Mother ' +
      'had depression. No known allergies."',
  },
  'post-procedure': {
    section: 'postProcedure',
    // This tab has its own inner tab bar (Monitoring → Observations / TDM /
    // Nursing / Efficacy / Resistance), which used to render only the open panel
    // — and since the registry holds only MOUNTED fields, a note could then fill
    // just that one panel. PostOpTab now keeps all five mounted and lays out only
    // the open one (see the Panel wrapper there), so one dictation covers the
    // whole tab: 60 fields, which the backend splits into 2 chunks.
    hint:
      'Dictate the whole note in one go — fills every monitoring tab, not just ' +
      'the one on screen.',
    placeholder:
      'Press Record and speak, or type the note here…\n\n' +
      'e.g. "Standard recovery. Observations at 10:15 — BP 118 over 76, pulse 82, ' +
      'SpO2 98 percent, GCS 15, assessed by Sr. Anu. Lithium 0.78, clozapine 420, ' +
      'ANC 3200. Night shift, slept 4.5 hours, agitation at 02:30 settled with PRN ' +
      'lorazepam. CGI-Improvement much improved, MADRS 11, sedation and weight gain. ' +
      'Stage 3 treatment-resistant depression, four failed trials. Ready for ' +
      'discharge home, follow-up 2 September 2026 at 10:30."',
  },
  psychotherapy: {
    section: 'psychotherapy',
    // A sessions tab: Save APPENDS a snapshot rather than overwriting a section,
    // so one dictation = one entry in the History records block. Nothing special
    // is needed for that — SessionHistory renders saved sessions as plain markup
    // and registers no FormFields, so the spec stays exactly the 24 live fields
    // of the session being logged, and buildPsychotherapySession's gate is "has
    // any value at all", which any successful fill clears.
    //
    // The SECOND tab to turn conversation mode on, and the last one. A therapy
    // hour is spent talking; the argument that put this on MSE & Cognition holds
    // here unchanged — dictating a summary afterwards is the duplicate work this
    // removes. Every other tab omits the flag and keeps the plain dictation
    // prompt with no severity ladders attached, exactly as before.
    //
    // The ladders these fields ship come from context/psychotherapyScale.js, NOT
    // the MSE scale — VoiceDictation routes on `section`. The instrument fields
    // (PHQ-9, GAD-7, Y-BOCS, SUDs) each carry an explicit caution never to guess
    // a total from how the patient sounds: a sad-sounding hour must not become a
    // fabricated "PHQ-9 about 15" in a medical record.
    conversation: true,
    hint:
      'Dictate the session note, or record the session itself — the patient’s own ' +
      'words are enough. Name the session date and number so the saved entry is ' +
      'labelled in the history above, and say any questionnaire totals out loud.',
    placeholder:
      'Press Record and speak, or type/paste the note or the session here…\n\n' +
      'Dictated: "Session on 19 August 2026, session 4 of 12, in-person at the ' +
      'clinic, 50 minutes, billing code 90834, therapist Dr. Meera Nair. PHQ-9 12, ' +
      'GAD-7 9, pre-session SUDs 70, post-session 40. Depressed mood with ' +
      'restricted affect, passive suicidal ideation with no plan, safety plan ' +
      'reviewed and adequate. CBT using cognitive restructuring and thought ' +
      'records. Highly engaged and collaborative, moderate progress. Last week’s ' +
      'homework completed partially. Homework — three thought records this week."' +
      '\n\n' +
      'As a recorded session: "Good to see you again, that makes four of the twelve ' +
      'we planned. The questionnaires first — the depression one came out at twelve ' +
      'this week and the anxiety one at nine. And the distress right now, out of a ' +
      'hundred? About seventy, it was worse this morning. I did most of the thought ' +
      'records, not all of them, four days out of the seven. There were moments ' +
      'where I thought everyone would be better off without me, but I would never ' +
      'act on it, and we read back through the plan we wrote — call my sister, then ' +
      'the helpline — it still holds. Let us take the presentation thought and put ' +
      'it down properly… and now, how bad is it? Forty, maybe. Lighter. For this ' +
      'week, three more thought records, any time it goes over fifty. Same time ' +
      'next Tuesday, an hour."',
  },
  summary: {
    section: 'summary',
    // Nothing dictated here can clobber a derived field: sProcedures, sKeyFindings
    // and sConsultant are readOnly, and FormField registers a field only when
    // `!readOnly`, so they never reach the spec at all. That leaves 11 live fields
    // (one chunk), four of them ARRAYS — secondary diagnoses, diagnostic codes,
    // discharge meds, follow-ups — the densest array tab in the module, so each
    // row wants its own clause in the note.
    //
    // sConsultantSign is a `checks` attestation and IS dictatable, so a note ending
    // "consultant sign-off done" ticks it. Left dictatable for consistency with
    // every other tab, but the Baseline work has since added a `noDictate` prop to
    // FormField — so if sign-off should be a deliberate click, mark that one field
    // `noDictate` and it stays clickable while dropping out of the spec. (readOnly
    // would not do: it greys out the checkbox itself.)
    hint: 'Dictate the discharge summary in one go — auto-filled fields are left alone.',
    placeholder:
      'Press Record and speak, or type the note here…\n\n' +
      'e.g. "Primary diagnosis major depressive disorder, severe, with psychotic ' +
      'features, in partial remission. Secondary diagnoses generalised anxiety ' +
      'disorder and hypothyroidism. Codes 6A70.2 severe depressive episode, 5A00.1 ' +
      'hypothyroidism. Discharge meds — escitalopram 20 mg OD oral for 6 months, ' +
      'continued; olanzapine 5 mg nocte oral for 3 months, new. Prognosis discussed ' +
      'with patient and family, yes. Follow-up 2 September 2026 with Dr. Meera Nair ' +
      'for review. Consultant sign-off done."',
  },
  surgery: {
    section: 'surgery',
    // Deliberately NOT the PostOpTab treatment. That tab's five monitoring panels
    // all describe the same episode, so mounting them together was right. Here the
    // eight procedure forms are MUTUALLY EXCLUSIVE — nobody gets a DBS lead and a
    // limbic leucotomy in one sitting — and they are near-duplicates by design:
    // dbsCoordRX / cingRX / capsRX / subcX / limbCingRX are all "target
    // coordinates", and cingRfTemp / capsRfTemp / subcRfTemp are all "RF
    // temperature". Mount all eight and "RF lesion at 80 degrees" has four equally
    // valid homes, so the model would pick one — a capsulotomy parameter landing in
    // the cingulotomy record. Keeping the switch on surgCategory is the safety
    // property, not a limitation.
    //
    // It costs nothing either, because runAutofill is multi-pass: surgCategory is a
    // select, so filling it flips mayRemount, waitForNewFields sees the sub-form
    // register, and pass 2 fills it — one click, same as procType on the Procedure
    // tab. Neither pass exceeds one chunk: 25 common fields, then at most 26 (DBS
    // electrode implantation, the largest form). If the category was already picked
    // by hand the sub-form is mounted from the start and it is one pass of 2 chunks
    // instead. Sub-forms are flat — no showIf, no readOnly — so it never needs a
    // third pass.
    //
    // The corollary is the hint below: a note that never names the procedure leaves
    // that form unmounted, and its device and coordinate details go nowhere.
    hint:
      'Name the surgical procedure in the note — that loads its form, and the rest ' +
      'fills in the same run.',
    placeholder:
      'Press Record and speak, or type the note here…\n\n' +
      'e.g. "DBS electrode implantation, 19 August 2026, 08:30 to 11:45, elective, ' +
      'ASA 2, MDT approved, meets refractoriness criteria. General anaesthesia with ' +
      'ETT, anaesthetist Dr. Raghav Menon. Frame-based Leksell, microelectrode ' +
      'recording used, intraoperative test stimulation done. Target subthalamic ' +
      'nucleus bilaterally — right 12.5, minus 2.0, minus 4.0; left 12.2, minus 1.8, ' +
      'minus 4.1. Boston Scientific Vercise Genus implanted. No intraoperative ' +
      'complications, blood loss 30 mL, transferred to Neuro ICU, post-op imaging ' +
      'ordered."',
  },
  mse: {
    section: 'mse',
    // 62 fields, all flat and all mounted — no arrays, no readOnly, no inner tabs.
    // Splits into 2 chunks. The one thing to know is that this tab is MOSTLY
    // checks/select/radio, so almost every value has to match an option string
    // exactly; free text is confined to five boxes.
    //
    // This tab saves SESSIONS: each Save appends an examination to the record's
    // list rather than overwriting one section, so a dictation here fills the form
    // for the examination being recorded now, and the previous ones stay intact
    // under "History records" at the top. That is also why mseDate and mseExaminer
    // are worth dictating — they are what label the entry in that history.
    //
    // delusionDetail and hallucinationDetail carry showIf against `delusions` /
    // `hallucinations`, which are `checks` — and checks store an ARRAY while showIf
    // does `showIf.in.includes(curVal)`, comparing against the array itself. That
    // never matches, so both fields are unreachable in the UI today (pre-existing,
    // not caused by dictation). Registration happens before the showIf return, so
    // dictation still fills them and Save still persists them — the value is just
    // not visible for review, which is why the hint says nothing about them and
    // they are left out of the example.
    // Two kinds of input work here, and the copy below says so on purpose. A
    // dictated summary is one; a recording of the consultation itself is the
    // other, because in neuropsychiatry the examination largely IS the
    // conversation and dictating it afterwards is time the doctor does not have.
    // What makes the conversational case work is on the extraction side, not
    // here: the prompt knows a question is not a finding and that the patient's
    // own words are the evidence, and every scored field ships its severity
    // ladder from context/clinicalScale.js so lay description ("hasn't washed in
    // a week") lands on a clinical option instead of being dropped.
    //
    // This flag is what turns that on, and it is set on THIS TAB ONLY. Every
    // other tab omits it, so they send the plain dictation prompt with no
    // severity ladders — the behaviour they had before any of this existed.
    // Dictating into this tab still works: the conversational prompt handles a
    // doctor's dictation too, it just also handles a patient's own words.
    conversation: true,
    hint:
      'Dictate the examination, or record the consultation itself — the patient’s ' +
      'own words are enough. Name the date and examiner so the saved entry is ' +
      'labelled in the history above.',
    placeholder:
      'Press Record and speak, or type/paste the note or the consultation here…\n\n' +
      'Dictated: "Examination on 21 August 2026 by Dr. Jane Doe. Unkempt with ' +
      'self-neglect, guarded, reduced eye contact, rapport ' +
      'difficult to establish, psychomotor retardation. No catatonic signs. Speech ' +
      'reduced in rate, soft, monotonous. Mood subjectively ‘empty’, objectively ' +
      'depressed, affect blunted and non-reactive. Persecutory and nihilistic ' +
      'delusions. Third-person auditory hallucinations. Alert, oriented to person ' +
      'and place but not time. MMSE 24, MoCA 21. Insight partial, judgement ' +
      'impaired. High risk of self-harm, low risk to others."\n\n' +
      'As a conversation: "Doctor: How have you been sleeping? — Patient: I haven’t ' +
      'washed or eaten in about a week, there’s no point in any of it. Doctor: Any ' +
      'thoughts of ending your life? — Patient: I think about it, but I wouldn’t do it."',
  },
  baseline: {
    section: 'baseline',
    // Section 3.5 (Laboratory Investigations) is OMITTED by request, and since the
    // shared LabInvestigations panel replaced the 19 numeric fields there, the
    // omission is now STRUCTURAL rather than a prop: those values are typed into
    // the panel's own inputs, so they are never FormFields, registerField never
    // sees them, and the model is never told they exist.
    //
    // The four organic-workup textareas that remain (csfBiomarkers,
    // autoimmunePanel, toxicology, labOther) still carry `noDictate` — the prop is
    // what protects a field that IS mounted, and it stays for exactly that reason:
    // it could not be a key filter inside VoiceDictation, because that component
    // knows nothing about any tab's fields and this keeps it that way.
    //
    // What is left is 40 fields, one chunk: the investigation date and requester,
    // 7 vitals, 3 measurements (bsa and bmi are readOnly), the 16 PHQ-9 / GAD-7
    // items, and 12 clinician-rated totals.
    //
    // The 16 item scores are worth dictating even though they are tedious to say,
    // because applyDictatedData ends with runCalculations — so the four readOnly
    // derived fields (phqTotal, phqSeverity, gadTotal, gadSeverity) score themselves
    // the moment the items land. Dictate the items and you get the instrument.
    hint:
      'Open with the investigation date and who requested it (each save records a ' +
      'new panel), then vitals, PHQ-9 / GAD-7 items and scale totals — lab values ' +
      'are entered in the investigations panel, not dictated.',
    placeholder:
      'Press Record and speak, or type the note here…\n\n' +
      'e.g. "Investigations on 21 August 2026, requested by Dr. Jane Doe. BP 118 ' +
      'over 76, pulse 82, temperature 36.8, respiratory rate 16, SpO2 ' +
      '98 percent, glucose 96. Height 172, weight 81, waist 98. PHQ-9 — items one ' +
      'to four nearly every day, items five to seven more than half the days, item ' +
      'eight several days, item nine not at all. GAD-7 — items one and two more than ' +
      'half the days, the rest several days. HAM-D 22, MADRS 28, YMRS 4, Y-BOCS 12, ' +
      'CGI-Severity 5, GAF 45."',
  },
  emergency: {
    section: 'emergency',
    // The simplest tab in the module to wire up: 30 fields, all flat, all mounted,
    // one chunk, one pass. No readOnly (nothing derived to protect), no showIf, no
    // noDictate.
    //
    // emgType6 is a select over eight presentations but — unlike surgCategory — it
    // drives NO conditional render: the presentation-specific detail is one free-text
    // box (emgSpecific) plus emgScaleScore. So there is no sub-form to load and no
    // second pass to wait for, and no risk of an NMS parameter landing in a
    // serotonin-syndrome record, because there are no per-presentation fields to
    // confuse.
    //
    // What IS specific to this tab is time: four datetime-local fields plus a
    // datetime-local cell inside the rapidTranq array. Array row cells skip
    // _coerce_value, so that cell was stored as whatever the model said — and an
    // <input type="datetime-local"> silently refuses to display anything that is not
    // YYYY-MM-DDTHH:MM, so the value saved but stayed invisible. Row cells are now
    // normalised by their declared type for every array in the module, and the
    // expected format is named in the prompt (see _ROW_CELL_NORMALISERS /
    // _ROW_CELL_KINDS in neuropsychiatry.py). Needs the pending redeploy.
    //
    // The normaliser can only repair a cell that HAS a date: '21 August 2026 08:40'
    // becomes 2026-08-21T08:40, but a bare '08:40' has no date to attach, so it is
    // left as typed and the cell stays blank on screen. Saying the date alongside
    // each drug time is what makes that cell land — hence the hint. The opposite
    // case is safe: a date with no clock lands at midnight rather than being lost.
    hint:
      'Dictate the whole episode in one go — say the date as well as the clock time ' +
      'for each timestamp, including each rapid-tranquillisation dose.',
    placeholder:
      'Press Record and speak, or type the note here…\n\n' +
      'e.g. "Neuroleptic malignant syndrome, brought in by ambulance, involuntary — ' +
      'treatment. All times on 21 August 2026 — onset 06:00, arrived 08:15, first ' +
      'assessed 08:25, first treatment 08:40. Airway patent; breathing spontaneous, ' +
      'chest clear; circulation tachycardic at 128 with two large-bore IVs; ' +
      'disability GCS 13, pupils equal, generalised rigidity; fully exposed and ' +
      'temperature measured. BP 165 over 95, heart rate 128, respiratory rate 26, ' +
      'SpO2 94 percent, temperature 39.4, glucose 138, GCS 13. De-escalation not ' +
      'appropriate, physical restraint and rapid tranquillisation used — lorazepam ' +
      '2 mg IV at 08:40 on 21 August 2026. C-SSRS no current ideation, unable to ' +
      'assess fully. On haloperidol and lithium. Organic screen done, yes. Next of ' +
      'kin notified. Rigidity with autonomic instability, no clonus, CK 4200. Scale ' +
      'score CK 4200. Plan — transfer to ICU, stop all antipsychotics, active ' +
      'cooling, IV fluids, dantrolene if no response."',
  },
};

const WorkflowContent = () => {
  const [activeTabId, setActiveTabId] = useState(TABS[0].id);
  const [feedback, setFeedback] = useState(null); // { ok: bool, text: string }

  const {
    formData,
    patientId,
    status,
    saving,
    loading,
    saveTab,
    completeFullRecord,
    savePsychotherapySession,
    saveMseSession,
    saveBaselineSession,
  } = useNeuropsychiatry();

  const activeTabIndex = TABS.findIndex((t) => t.id === activeTabId);
  const ActiveComponent = TABS[activeTabIndex]?.component || PatientInfoTab;

  const handlePrev = () => {
    if (activeTabIndex > 0) {
      setActiveTabId(TABS[activeTabIndex - 1].id);
      window.scrollTo(0, 0);
    }
  };

  const handleNext = () => {
    if (activeTabIndex < TABS.length - 1) {
      setActiveTabId(TABS[activeTabIndex + 1].id);
      window.scrollTo(0, 0);
    }
  };

  const handleTabSave = async (tabId, tabLabel) => {
    // Psychotherapy is a COURSE of therapy, so its Save APPENDS a session to the
    // record's session list (same logic as the Procedure entry) instead of
    // overwriting one flat section — every saved session shows up in the
    // "History records" block at the top of that tab.
    if (tabId === 'psychotherapy') {
      const built = buildPsychotherapySession(formData);
      if (!built) {
        setFeedback({ ok: false, text: 'Fill in the session details before saving.' });
        return;
      }
      const res = await savePsychotherapySession(built);
      setFeedback(
        res.ok
          ? {
              ok: true,
              text: res.sessionNo
                ? `CBT session ${res.sessionNo} saved successfully.`
                : 'CBT session saved successfully.',
            }
          : { ok: false, text: res.error || `Failed to save ${tabLabel}.` }
      );
      return;
    }

    // An MSE is a SNAPSHOT that is repeated at every review, and it is read as a
    // series — so its Save appends an examination the same way, and each one
    // shows up under "History records" at the top of the MSE tab.
    if (tabId === 'mse') {
      const built = buildMseSession(formData);
      if (!built) {
        setFeedback({
          ok: false,
          text: 'Record at least one examination finding before saving.',
        });
        return;
      }
      const res = await saveMseSession(built);
      setFeedback(
        res.ok
          ? {
              ok: true,
              text: res.sessionNo
                ? `Examination ${res.sessionNo} saved successfully.`
                : 'Examination saved successfully.',
            }
          : { ok: false, text: res.error || `Failed to save ${tabLabel}.` }
      );
      return;
    }

    // Baseline investigations are repeated on a monitoring schedule (metabolic
    // panel, clozapine ANC, lithium levels) and the TREND is the clinical point —
    // so its Save appends a panel too. Each panel shows up under "History records"
    // at the top of the tab, where it opens as a table of parameters and units.
    if (tabId === 'baseline') {
      const built = buildBaselineSession(formData);
      if (!built) {
        setFeedback({
          ok: false,
          text: 'Record at least one vital sign, score or lab value before saving.',
        });
        return;
      }
      const res = await saveBaselineSession(built);
      setFeedback(
        res.ok
          ? {
              ok: true,
              text: res.sessionNo
                ? `Investigation panel ${res.sessionNo} saved successfully.`
                : 'Investigation panel saved successfully.',
            }
          : { ok: false, text: res.error || `Failed to save ${tabLabel}.` }
      );
      return;
    }

    const res = await saveTab(tabId);
    if (res.ok) {
      setFeedback({
        ok: true,
        text: res.created
          ? 'Patient Info saved successfully — case is now Active.'
          : `${tabLabel} data saved successfully.`,
      });
    } else {
      setFeedback({ ok: false, text: res.error || `Failed to save ${tabLabel}.` });
    }
  };

  const handleSaveFullRecord = async () => {
    const res = await completeFullRecord();
    if (res.ok) {
      setFeedback({ ok: true, text: 'Record saved successfully — marked Completed.' });
    } else {
      setFeedback({ ok: false, text: res.error || 'Failed to complete record.' });
    }
  };

  return (
    <div
      style={{
        fontFamily: '"Open Sans", sans-serif',
        fontWeight: 300,
        background: '#f2f2f2',
        color: '#1a1a1a',
        fontSize: '13px',
        lineHeight: 1.5,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Floating save confirmation — pops up over the page, no inline banner */}
      <Toast toast={feedback} onClose={() => setFeedback(null)} />

      {/* App header — patient id + case status live on the right */}
      <header
        style={{
          background: '#ffffff',
          borderBottom: '1px solid #e8e8e8',
          padding: '14px 24px',
          boxShadow: '0 1px 3px rgba(0,0,0,.06)',
          zIndex: 30,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '16px',
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '4px',
              background: '#f2f2f2',
              border: '1px solid #e8e8e8',
              display: 'grid',
              placeItems: 'center',
              color: '#1a1a1a',
              flexShrink: 0,
            }}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.7"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 4.5a2.5 2.5 0 0 0-5 0 2.5 2.5 0 0 0-2 4 2.6 2.6 0 0 0 .5 4.9V15a2.5 2.5 0 0 0 4.5 1.5" />
              <path d="M12 4.5a2.5 2.5 0 0 1 5 0 2.5 2.5 0 0 1 2 4 2.6 2.6 0 0 1-.5 4.9V15a2.5 2.5 0 0 1-4.5 1.5" />
              <path d="M12 4.5v14" />
            </svg>
          </div>
          <div>
            <h1 style={{ margin: 0, fontSize: '15px', fontWeight: 500, letterSpacing: '.01em', color: '#1a1a1a' }}>
              Neuropsychiatry — Clinical & Procedural Workflow
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: '11px', color: '#7a7a7a' }}>
              Doctor's Workspace · 8 non-procedural modules
            </p>
          </div>
        </div>

        {/* Patient + case status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', color: '#a8a8a8', textTransform: 'uppercase', letterSpacing: '.06em' }}>
              Patient
            </div>
            <div style={{ fontSize: '13px', fontWeight: 500, color: '#1a1a1a' }}>
              {formData.hmsId || patientId || '—'}
            </div>
          </div>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 500,
              padding: '5px 11px',
              borderRadius: '3px',
              letterSpacing: '.03em',
              border: '1px solid',
              ...(status === 'Completed'
                ? { background: '#0a0a0a', color: '#ffffff', borderColor: '#0a0a0a' }
                : status === 'Active'
                ? { background: '#eef6ee', color: '#1e6b32', borderColor: '#cfe5d2' }
                : { background: '#f2f2f2', color: '#7a7a7a', borderColor: '#e8e8e8' }),
            }}
          >
            {loading ? 'Loading…' : status || 'Not saved'}
          </span>
        </div>
      </header>

      {/* Main Layout */}
      <div style={{ display: 'flex', flex: 1, alignItems: 'flex-start' }}>
        {/* Left Side Tab Navigation */}
        <nav
          style={{
            width: '220px',
            background: '#ffffff',
            borderRight: '1px solid #e8e8e8',
            padding: '14px 10px',
            flexShrink: 0,
            position: 'sticky',
            top: '20px',
            height: 'calc(100vh - 40px)',
            overflowY: 'auto',
          }}
        >
          {TABS.map((t) => {
            const isActive = t.id === activeTabId;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setActiveTabId(t.id);
                  window.scrollTo(0, 0);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  background: isActive ? '#0a0a0a' : 'transparent',
                  color: isActive ? '#ffffff' : '#2e2e2e',
                  border: 'none',
                  padding: '9px 12px',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                  fontSize: '12.5px',
                  fontWeight: isActive ? 600 : 400,
                  marginBottom: '2px',
                  letterSpacing: '.02em',
                }}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        {/* Active Tab Content Area */}
        <main style={{ flex: 1, padding: '24px 28px' }}>
          {/* ── Voice dictation — sits above the form it fills ─────────────────
                 Keyed by tab so switching tabs starts a clean note and releases
                 the microphone, instead of carrying one tab's transcript over to
                 another tab's fields. */}
          {DICTATION_TABS[activeTabId] && (
            <VoiceDictation key={activeTabId} {...DICTATION_TABS[activeTabId]} />
          )}

          <ActiveComponent />

          {/* Bottom Actions */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '10px',
              marginTop: '16px',
              paddingTop: '16px',
              borderTop: '1px solid #e8e8e8',
            }}
          >
            <button
              type="button"
              onClick={handlePrev}
              disabled={activeTabIndex === 0}
              style={{
                border: '1px solid #d4d4d4',
                borderRadius: '2px',
                padding: '9px 16px',
                fontSize: '12px',
                cursor: activeTabIndex === 0 ? 'not-allowed' : 'pointer',
                background: 'transparent',
                color: activeTabIndex === 0 ? '#a8a8a8' : '#2e2e2e',
              }}
            >
              ← Previous
            </button>
            <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
              <button
                type="button"
                onClick={() => handleTabSave(TABS[activeTabIndex].id, TABS[activeTabIndex].label)}
                disabled={saving || loading}
                style={{
                  border: 'none',
                  borderRadius: '2px',
                  padding: '9px 16px',
                  fontSize: '12px',
                  fontWeight: 500,
                  cursor: saving || loading ? 'not-allowed' : 'pointer',
                  background: '#0a0a0a',
                  color: '#ffffff',
                  opacity: saving || loading ? 0.6 : 1,
                }}
              >
                {saving ? 'Saving…' : `Save ${TABS[activeTabIndex].label} data`}
              </button>
              {activeTabId === 'summary' ? (
                <button
                  type="button"
                  onClick={handleSaveFullRecord}
                  disabled={saving || loading}
                  style={{
                    border: 'none',
                    borderRadius: '2px',
                    padding: '9px 16px',
                    fontSize: '12px',
                    fontWeight: 500,
                    cursor: saving || loading ? 'not-allowed' : 'pointer',
                    background: '#0a0a0a',
                    color: '#ffffff',
                    opacity: saving || loading ? 0.6 : 1,
                  }}
                >
                  {saving ? 'Saving…' : 'Save Full Record'}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleNext}
                  style={{
                    border: '1px solid #d4d4d4',
                    borderRadius: '2px',
                    padding: '9px 16px',
                    fontSize: '12px',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: '#2e2e2e',
                  }}
                >
                  Next →
                </button>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
};

const NeuropsychiatryWorkflow = ({
  patientId: propPatientId,
  doctorId: propDoctorId,
  hospitalId: propHospitalId,
} = {}) => {
  // Resolve identifiers: explicit props win, otherwise fall back to the URL
  // query string (mirrors RadiationTherapyWorkflow's id resolution). These flow
  // into the provider, which seeds patientId for display, creates the record
  // with patient_id + doctor_id + hospital_id, and autopopulates the doctor name.
  const searchParams =
    typeof window !== 'undefined'
      ? new URLSearchParams(window.location.search)
      : new URLSearchParams();
  const patientId =
    propPatientId || searchParams.get('patientId') || searchParams.get('patient_id') || '';
  const doctorId =
    propDoctorId || searchParams.get('doctorId') || searchParams.get('doctor_id') || '';
  const hospitalId =
    propHospitalId || searchParams.get('hospitalId') || searchParams.get('hospital_id') || '';

  return (
    <NeuropsychiatryProvider patientId={patientId} doctorId={doctorId} hospitalId={hospitalId}>
      <WorkflowContent />
    </NeuropsychiatryProvider>
  );
};

export default NeuropsychiatryWorkflow;
