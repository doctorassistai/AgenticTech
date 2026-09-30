import React, { useState } from 'react';
import { cloneSuggestions } from './ClinicalSuggestionCard';

const API_BASE = 'https://doctorassist.ai/api';

const Spinner = ({ size = 14, color = '#fff' }) => (
  <span style={{
    display: 'inline-block', width: size, height: size,
    border: `2px solid ${color}33`, borderTopColor: color,
    borderRadius: '50%', animation: 'aisug-spin .6s linear infinite', flexShrink: 0,
  }} />
);

/**
 * AiSuggestionAction
 * ───────────────────
 * Triggers the same clinical-suggestion generation used by the full
 * "Process Patient Data" page (DataProcessing.jsx) — POST to
 * ai-legacy/emergency/voice-suggestions/{patientId} — and hands the
 * result up as an editable draft bubble via onPosted.
 *
 * This does NOT approve or save anything itself. The parent chat feed
 * renders the returned draft with ClinicalSuggestionCard and owns the
 * Approve / Discard actions (which post to clinical-action/save,
 * mirroring DataProcessing.jsx's handleApprove).
 *
 * Props:
 *  - patientId          (string, required)
 *  - incidentCompleted  (bool, optional)
 *  - onPosted(bubble)   (fn, required) — bubble shape:
 *      { id, type: 'ai_suggestion_draft', timestamp,
 *        sufficientData, missingInformation, suggestions, rawResult }
 */
const AiSuggestionAction = ({ patientId, incidentCompleted = false, onPosted }) => {
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);

  const runAiSuggestion = async () => {
    if (!patientId || loading || incidentCompleted) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `${API_BASE}/hms/users/ai-legacy/emergency/voice-suggestions/${patientId}`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      );
      const data = await res.json();
      if (data.status !== 'success') {
        throw new Error(data.detail || 'No suggestions available.');
      }
      const result = data.results?.[0];
      const suggestions = result?.suggestions || {};
      onPosted?.({
        id: `ai-draft-${Date.now()}`,
        type: 'ai_suggestion_draft',
        timestamp: new Date(),
        sufficientData: suggestions.sufficient_data !== false,
        missingInformation: suggestions.missing_information || [],
        suggestions: cloneSuggestions(suggestions),
        rawResult: result,
      });
    } catch (e) {
      console.error('AiSuggestionAction error:', e);
      setError(e.message || 'Failed to get AI suggestion');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ fontFamily: "'DM Sans', sans-serif", marginTop: 10 }}>
      <style>{`@keyframes aisug-spin { to { transform: rotate(360deg); } }`}</style>
      <button
        onClick={runAiSuggestion}
        disabled={loading || incidentCompleted || !patientId}
        style={{
          background: incidentCompleted ? '#999' : '#111',
          color: '#fff', border: 'none',
          padding: '8px 16px', borderRadius: 20,
          fontSize: 12.5, fontWeight: 700,
          cursor: (loading || incidentCompleted) ? 'not-allowed' : 'pointer',
          display: 'inline-flex', alignItems: 'center', gap: 7,
          opacity: (loading || incidentCompleted) ? 0.65 : 1,
        }}
      >
        {incidentCompleted
          ? 'Incident Completed'
          : loading
          ? <><Spinner size={12} /> Generating…</>
          : <>✦ Get AI Suggestion</>}
      </button>
      {error && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: '#dc2626', fontFamily: "'DM Sans', sans-serif" }}>
          {error}
        </div>
      )}
    </div>
  );
};

export default AiSuggestionAction;