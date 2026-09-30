import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNeuropsychiatry } from '../context/NeuropsychiatryContext';
import { transcribeAudio, structureDictation } from '../api/neuropsychiatryApi';
import { guideFor as mseGuideFor } from '../context/clinicalScale';
import { guideFor as cbtGuideFor } from '../context/psychotherapyScale';

// ─────────────────────────────────────────────────────────────────────────────
// VoiceDictation — record or type a clinical note, then fill the form from it.
//
// Three provisions, in one box at the top of a section:
//   1. RECORD — MediaRecorder → the shared HMS speech-to-text endpoint,
//   2. READ   — the transcript shown as editable text,
//   3. TYPE   — the same textarea doubles as manual entry, so a doctor who
//               would rather type (or wants to correct the transcript) can.
// Then "AI Autofill" structures it and drops the values into the form.
//
// The component is section-agnostic: it asks the provider which FormFields are
// currently mounted (getFieldSpecs) and posts that spec with the text, so the
// backend prompt always describes the form on screen. Mounting this in another
// tab needs nothing but the tag and a `section` label.
// ─────────────────────────────────────────────────────────────────────────────

// A dictation may name a field that mounts MORE fields (choosing "ECT" as the
// Procedure Type renders the whole ECT form) or that unlocks another field's
// option list. Each pass re-scans the same transcript for whatever became
// available, so one dictation can fill a form the doctor had not opened yet:
//   pass 1 → common fields, sets Procedure Category
//   pass 2 → Procedure Type, whose options only exist once the category is set
//   pass 3 → the ~35 fields of the type-specific form that just mounted
// A pass with nothing new to ask costs one cheap local check, not a request.
const MAX_PASSES = 4;
const REMOUNT_POLL_MS = 150;
const REMOUNT_POLL_TRIES = 10; // ≤1.5s, and only after a choice field changed

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Identity of a field AS AN EXTRACTION TARGET — its key plus its option list.
 *
 * Passes are deduped on this, not on the key alone, because a field's allowed
 * values can change without the field itself changing: "Procedure Type" only
 * offers real options once "Procedure Category" is set (ProcedureTab derives
 * them from it), so before that its only listed value is a placeholder and no
 * dictated procedure name could ever match. Keyed by signature, the second pass
 * re-asks for procType now that its real options exist.
 */
const specSig = (f) => `${f.k}|${(f.options || []).join('~')}`;

// Field types whose value MUST come from their option list.
const NEEDS_OPTIONS = new Set(['select', 'radio', 'checks']);

// Placeholder entries some selects carry as their only option until a parent
// field is chosen ("— select category first —"). They are prompts to the user,
// not permitted values, so they must never reach the model as allowed answers.
const PLACEHOLDER_RE = /^[—–\-]\s*select\b/i;

// Which benchmark scale answers for which tab.
//
// Two tabs score their findings, against two SEPARATE scales — an examination
// (MSE & Cognition) and a course of treatment (Psychotherapy / CBT) do not share
// cut-points, and neither file imports the other. Routing on the section rather
// than trying both keeps that separation honest: were a key ever to appear in
// both tables, it could not pick up the wrong tab's ladder by accident.
//
// A section absent from this map gets no guidance at all — which is every other
// tab, exactly as before any of this existed.
const GUIDES = {
  mse: mseGuideFor,
  psychotherapy: cbtGuideFor,
};

const sanitizeSpec = (f, withGuide, section) => {
  // The benchmark scale's severity ladder for this field, when it has one. Sent
  // with the spec so the extractor can place a lay description ("hasn't washed
  // in a week") on a clinical option instead of dropping it for not naming one.
  //
  // Only attached in conversation mode. A doctor dictating states the finding in
  // clinical terms already, so there is nothing to translate and the ladder is
  // just noise in the prompt. Gating on the caller's flag rather than on whether
  // the scale happens to cover the key also means extending FIELD_SCALE to
  // another tab later (Baseline Inv.) adds scoring there WITHOUT quietly
  // changing what that tab's dictation sends.
  const guide = withGuide ? (GUIDES[section]?.(f.k) ?? null) : null;
  return {
    ...f,
    options: (f.options || [])
      .map((o) => (typeof o === 'string' ? o : String(o ?? '')))
      .filter((o) => o.trim() && !PLACEHOLDER_RE.test(o.trim())),
    ...(guide ? { guide } : {}),
  };
};

const VoiceDictation = ({
  section = 'procedure',
  title = 'Voice Dictation',
  hint = 'Dictate the whole note in one go — the form fills itself.',
  placeholder = 'Press Record and speak, or type the note here…\n\ne.g. "ECT session on 4 March 2026, bitemporal placement, 300 millicoulombs, seizure duration 32 seconds, propofol anaesthesia, consent taken, no complications."',
  // Opt in to consultation handling: the source may be the doctor and patient
  // talking rather than a doctor dictating, so the backend uses a different
  // extraction prompt and the fields carry the scale's severity guidance.
  // Off unless a tab asks for it, which keeps every other tab's dictation
  // exactly as it was.
  conversation = false,
}) => {
  const { getFieldSpecs, applyDictatedData, setFormData } = useNeuropsychiatry();

  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAutofilling, setIsAutofilling] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [overwrite, setOverwrite] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState(null); // { ok, text, filled[], dropped[] }
  const [showDetail, setShowDetail] = useState(false);

  // Keep formData.sessionTranscript in sync with the textarea
  useEffect(() => {
    if (setFormData) {
      setFormData((prev) => ({ ...prev, sessionTranscript: transcript }));
    }
  }, [transcript, setFormData]);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);

  // Recording timer, so the doctor can see the mic is actually live.
  useEffect(() => {
    if (!isRecording) return undefined;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  // Never leave the microphone open if the section unmounts mid-recording.
  useEffect(
    () => () => {
      const recorder = mediaRecorderRef.current;
      if (!recorder) return;
      try {
        if (recorder.state !== 'inactive') recorder.stop();
        recorder.stream.getTracks().forEach((track) => track.stop());
      } catch {
        /* already torn down */
      }
    },
    []
  );

  const startRecording = async () => {
    setResult(null);
    if (!navigator.mediaDevices?.getUserMedia) {
      setResult({
        ok: false,
        text: 'Microphone unavailable in this browser. Recording needs an HTTPS page (or localhost) — you can still type the note below.',
      });
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;
      audioChunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };
      recorder.start();
      setIsRecording(true);
    } catch (err) {
      console.error('Microphone access failed', err);
      setResult({
        ok: false,
        text: 'Microphone access was denied or no microphone was found. You can type the note below instead.',
      });
    }
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || !isRecording) return;

    recorder.onstop = async () => {
      setIsRecording(false);
      setIsProcessing(true);
      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
      audioChunksRef.current = [];
      try {
        const text = await transcribeAudio(audioBlob);
        if (text) {
          // Append, so a second burst of dictation adds to the note instead of
          // wiping what was already transcribed or typed.
          setTranscript((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text));
        } else {
          setResult({ ok: false, text: 'Nothing was transcribed — try recording again.' });
        }
      } catch (err) {
        console.error('Transcription failed', err);
        setResult({ ok: false, text: err.message || 'Could not transcribe the recording.' });
      } finally {
        setIsProcessing(false);
      }
    };

    try {
      recorder.stop();
      recorder.stream.getTracks().forEach((track) => track.stop());
    } catch (err) {
      console.error('Failed to stop recording', err);
      setIsRecording(false);
    }
  };

  /** Every mounted field, placeholder options stripped. */
  const currentSpecs = useCallback(
    () => getFieldSpecs().filter((f) => f && f.k).map((f) => sanitizeSpec(f, conversation, section)),
    [getFieldSpecs, conversation, section]
  );

  /**
   * Wait briefly for extraction targets that were not available on the last
   * pass — either newly mounted fields, or a field whose option list has just
   * been unlocked by a value we filled. Only called after a choice field
   * changed, so the common single-pass case never pays this delay.
   */
  const waitForNewFields = useCallback(
    async (attemptedSigs) => {
      for (let i = 0; i < REMOUNT_POLL_TRIES; i += 1) {
        await sleep(REMOUNT_POLL_MS);
        if (currentSpecs().some((f) => !attemptedSigs.has(specSig(f)))) return true;
      }
      return false;
    },
    [currentSpecs]
  );

  const runAutofill = async () => {
    const text = transcript.trim();
    if (!text) return;

    setIsAutofilling(true);
    setResult(null);
    setShowDetail(false);

    const attemptedSigs = new Set();
    const labels = new Map();
    const filled = new Set();
    const skipped = new Set();
    let dropped = [];
    let conflicts = [];
    let unknownCount = 0;
    let anyPartial = false;
    let anyTruncated = false;

    try {
      for (let pass = 0; pass < MAX_PASSES; pass += 1) {
        const fresh = currentSpecs().filter((f) => !attemptedSigs.has(specSig(f)));
        if (!fresh.length) break;
        fresh.forEach((f) => {
          attemptedSigs.add(specSig(f));
          labels.set(f.k, f.label || f.k);
        });

        // A choice field with no real options yet (procType before a category
        // is picked) is unanswerable — hold it for a later pass, which the
        // signature check above will pick up once its options appear.
        const fields = fresh.filter(
          (f) => !NEEDS_OPTIONS.has(f.type) || f.options.length > 0
        );
        if (!fields.length) break;

        const res = await structureDictation({ text, fields, section, conversation });
        dropped.push(...res.dropped);
        conflicts.push(...res.conflicts);
        unknownCount += res.unmatchedKeys.length;
        if (res.partial) anyPartial = true;
        if (res.truncated) anyTruncated = true;

        const merged = applyDictatedData(res.data, { overwrite });
        merged.applied.forEach((k) => {
          filled.add(k);
          skipped.delete(k);
        });
        merged.skipped.forEach((k) => {
          if (!filled.has(k)) skipped.add(k);
        });

        // Did this pass set a field that can reveal other fields, or unlock
        // another field's options?
        if (pass === MAX_PASSES - 1) break; // nothing left to feed
        const choiceKeys = new Set(
          fields.filter((f) => f.type === 'select' || f.type === 'radio').map((f) => f.k)
        );
        const mayRemount = merged.applied.some((k) => choiceKeys.has(k));
        if (!mayRemount) break;
        if (!(await waitForNewFields(attemptedSigs))) break;
      }

      // A field rejected on an early pass but filled on a later one (procType,
      // typically) is not a failure — don't report it as one. Keep one entry
      // per field, since a re-asked field can be rejected more than once.
      const byKey = new Map();
      dropped.forEach((d) => {
        if (!filled.has(d.key)) byKey.set(d.key, d);
      });
      dropped = Array.from(byKey.values());

      // Same for conflicts: one entry per field, and only for fields that
      // actually ended up filled — a disagreement about a value that never
      // reached the form is not something to send the doctor looking for.
      const conflictByKey = new Map();
      conflicts.forEach((c) => {
        if (filled.has(c.key)) conflictByKey.set(c.key, c);
      });
      conflicts = Array.from(conflictByKey.values());

      const parts = [
        filled.size
          ? `Filled ${filled.size} field${filled.size === 1 ? '' : 's'}.`
          : 'Nothing in the note matched a field on this form.',
      ];
      if (skipped.size) parts.push(`${skipped.size} left as already answered.`);
      if (dropped.length) parts.push(`${dropped.length} could not be matched.`);
      if (unknownCount) parts.push(`${unknownCount} unrecognised.`);
      // Two parts of the same note said different things. The form holds one of
      // them, so this is a value the doctor has to look at — not a statistic.
      if (conflicts.length) {
        parts.push(
          `${conflicts.length} field${conflicts.length === 1 ? '' : 's'} had conflicting evidence — confirm ${conflicts.length === 1 ? 'it' : 'them'} below.`
        );
      }
      // The note was longer than could be read even in overlapping passes, so
      // the end of it was never seen. Say that plainly: "filled N fields" over a
      // transcript that was two thirds read is the exact failure this replaced.
      if (anyTruncated) {
        parts.push('The note was too long to read in full — the end of it was not processed.');
      }
      // Part of the form was never looked at, so "filled N fields" is not the
      // whole story — say so rather than let it read as a complete pass.
      if (anyPartial && !anyTruncated) {
        parts.push('Part of the form could not be processed — please check it before saving.');
      }

      setResult({
        ok: filled.size > 0,
        text: parts.join(' '),
        filled: Array.from(filled, (k) => labels.get(k) || k),
        dropped,
        conflicts,
      });
    } catch (err) {
      console.error('Dictation autofill failed', err);
      // Report what did land before the failure — a later pass failing must not
      // make it look like nothing was filled.
      const partial = filled.size
        ? ` ${filled.size} field${filled.size === 1 ? '' : 's'} had already been filled.`
        : '';
      setResult({
        ok: false,
        text: `${err.message || 'Autofill failed.'}${partial}`,
        filled: Array.from(filled, (k) => labels.get(k) || k),
        dropped: dropped.filter((d) => !filled.has(d.key)),
        conflicts: conflicts.filter((c) => filled.has(c.key)),
      });
    } finally {
      setIsAutofilling(false);
    }
  };

  const busy = isRecording || isProcessing || isAutofilling;
  const recordLabel = isProcessing ? 'Transcribing…' : isRecording ? 'Stop Recording' : 'Record';

  return (
    // Explicit white: the Procedure page hosts this inside a white card, but the
    // main workflow's <main> sits on the grey page background, where an
    // unpainted body would show through under the #fafafa header. White matches
    // the Section cards this box sits above in both places.
    <div
      style={{
        marginBottom: '18px',
        border: '1px solid #e8e8e8',
        borderRadius: '4px',
        background: '#ffffff',
      }}
    >
      {/* ── Header: title + the record toggle ──────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '10px 14px',
          background: '#fafafa',
          borderRadius: '4px 4px 0 0',
        }}
      >
        <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a1a' }}>
          {title}
          <span style={{ marginLeft: '8px', fontWeight: 400, color: '#7a7a7a' }}>{hint}</span>
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {isRecording && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '11px',
                color: '#cf1322',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              <span
                style={{
                  width: '7px',
                  height: '7px',
                  borderRadius: '50%',
                  background: '#cf1322',
                }}
              />
              {String(Math.floor(elapsed / 60)).padStart(2, '0')}:
              {String(elapsed % 60).padStart(2, '0')}
            </span>
          )}
          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isProcessing || isAutofilling}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              border: 'none',
              borderRadius: '2px',
              padding: '7px 13px',
              fontSize: '12px',
              fontWeight: 500,
              fontFamily: 'inherit',
              cursor: isProcessing || isAutofilling ? 'not-allowed' : 'pointer',
              background: isRecording ? '#cf1322' : '#0a0a0a',
              color: '#ffffff',
              opacity: isProcessing || isAutofilling ? 0.6 : 1,
            }}
          >
            {isRecording ? <StopIcon /> : <MicIcon />}
            {recordLabel}
          </button>
        </div>
      </div>

      {/* ── Transcript: read it, edit it, or type it from scratch ──────────── */}
      <div style={{ padding: '12px 14px', borderTop: '1px solid #e8e8e8' }}>
        <textarea
          value={transcript}
          onChange={(e) => setTranscript(e.target.value)}
          placeholder={placeholder}
          rows={5}
          spellCheck
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '9px 10px',
            fontFamily: 'inherit',
            fontSize: '12.5px',
            fontWeight: 300,
            lineHeight: 1.6,
            color: '#1a1a1a',
            background: '#ffffff',
            border: '1px solid #d4d4d4',
            borderRadius: '3px',
            resize: 'vertical',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            marginTop: '10px',
          }}
        >
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '7px',
              fontSize: '11.5px',
              color: '#4a4a4a',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              style={{ cursor: 'pointer' }}
            />
            Overwrite answers already filled
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              type="button"
              onClick={() => {
                setTranscript('');
                setResult(null);
              }}
              disabled={busy || !transcript}
              style={{
                border: '1px solid #d4d4d4',
                borderRadius: '2px',
                padding: '7px 13px',
                fontSize: '12px',
                fontFamily: 'inherit',
                background: '#ffffff',
                color: '#4a4a4a',
                cursor: busy || !transcript ? 'not-allowed' : 'pointer',
                opacity: busy || !transcript ? 0.5 : 1,
              }}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={runAutofill}
              disabled={busy || !transcript.trim()}
              style={{
                border: 'none',
                borderRadius: '2px',
                padding: '7px 15px',
                fontSize: '12px',
                fontWeight: 500,
                fontFamily: 'inherit',
                background: '#0a0a0a',
                color: '#ffffff',
                cursor: busy || !transcript.trim() ? 'not-allowed' : 'pointer',
                opacity: busy || !transcript.trim() ? 0.5 : 1,
              }}
            >
              {isAutofilling ? 'Filling form…' : 'AI Autofill'}
            </button>
          </div>
        </div>

        {/* ── What landed, and what did not ────────────────────────────────── */}
        {result && (
          <div
            style={{
              marginTop: '10px',
              padding: '9px 11px',
              fontSize: '11.5px',
              lineHeight: 1.6,
              borderRadius: '3px',
              border: '1px solid',
              ...(result.ok
                ? { background: '#eef6ee', color: '#1e6b32', borderColor: '#cfe5d2' }
                : { background: '#fdf2f2', color: '#a8181f', borderColor: '#f3d2d4' }),
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ flex: 1 }}>{result.text}</span>
              {!!(result.filled?.length || result.dropped?.length || result.conflicts?.length) && (
                <button
                  type="button"
                  onClick={() => setShowDetail((s) => !s)}
                  style={{
                    border: 'none',
                    background: 'none',
                    padding: 0,
                    fontFamily: 'inherit',
                    fontSize: '11px',
                    color: 'inherit',
                    textDecoration: 'underline',
                    cursor: 'pointer',
                  }}
                >
                  {showDetail ? 'hide details' : 'details'}
                </button>
              )}
            </div>

            {showDetail && (
              <div style={{ marginTop: '7px' }}>
                {!!result.filled?.length && (
                  <div style={{ color: '#4a4a4a' }}>
                    <strong style={{ fontWeight: 600 }}>Filled:</strong>{' '}
                    {result.filled.join(', ')}
                  </div>
                )}
                {!!result.conflicts?.length && (
                  <div style={{ marginTop: '5px', color: '#8a5a12' }}>
                    <strong style={{ fontWeight: 600 }}>Conflicting evidence:</strong>{' '}
                    {result.conflicts
                      .map((c) => `${c.label || c.key} — kept "${c.kept}", also heard "${c.other}"`)
                      .join('; ')}
                    <div style={{ color: '#7a7a7a', marginTop: '3px' }}>
                      Two parts of the note disagreed. The first is in the form — check it
                      against what was actually said.
                    </div>
                  </div>
                )}
                {!!result.dropped?.length && (
                  <div style={{ marginTop: '5px', color: '#a8181f' }}>
                    <strong style={{ fontWeight: 600 }}>Not matched:</strong>{' '}
                    {result.dropped
                      .map((d) => `${d.label || d.key} (${d.reason})`)
                      .join('; ')}
                    <div style={{ color: '#7a7a7a', marginTop: '3px' }}>
                      Please enter these by hand.
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// Inline SVG — this module deliberately has no icon-library dependency.
const MicIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M12 15a4 4 0 0 0 4-4V5a4 4 0 0 0-8 0v6a4 4 0 0 0 4 4z" />
    <path d="M19 11a1 1 0 0 0-2 0 5 5 0 0 1-10 0 1 1 0 0 0-2 0 7 7 0 0 0 6 6.92V21a1 1 0 0 0 2 0v-3.08A7 7 0 0 0 19 11z" />
  </svg>
);

const StopIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <rect x="5" y="5" width="14" height="14" rx="2" />
  </svg>
);

export default VoiceDictation;
