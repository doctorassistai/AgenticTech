import React, { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Send, User, Bot, ArrowLeft, Loader2, AlertCircle, FileText, Users,
  Mic, Square,
} from "lucide-react";

const API_BASE_URL = import.meta.env.VITE_BACKEND_URL;

/* ─── THEME TOKENS (matches DoctorDashboard) ─── */
const T = {
  bg: "#ffffff",
  bgAlt: "#fafafa",
  bgTert: "#f5f5f5",
  text: "#000000",
  sec: "#e2dbf7",
  textSec: "#444444",
  textMuted: "#888888",
  border: "#e0e0e0",
  borderStr: "#000000",
  accent: "#000000",
  danger: "#c0392b",
};

/* ─── TEXT CLEANUP ───────────────────────────────────────────
   Strips markdown artifacts (**bold**, *italic*, `code`, # headers,
   bullet dashes) from model output so the chat reads as plain text. */
function cleanText(raw) {
  if (!raw || typeof raw !== "string") return raw;
  return raw
    .replace(/\*\*\*(.*?)\*\*\*/g, "$1")   // ***bold italic***
    .replace(/\*\*(.*?)\*\*/g, "$1")       // **bold**
    .replace(/\*(.*?)\*/g, "$1")           // *italic*
    .replace(/__(.*?)__/g, "$1")           // __bold__
    .replace(/`{1,3}([^`]*)`{1,3}/g, "$1") // `code` / ```code```
    .replace(/^#{1,6}\s+/gm, "")           // # headers
    .replace(/^\s*[-*]\s+/gm, "• ")        // bullet markers → simple dot
    .trim();
}

/* ─── INLINE STYLES ─── */
const S = {
  page: {
    display: "flex",
    flexDirection: "column",
    height: "100vh",
    background: T.bg,
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    WebkitFontSmoothing: "antialiased",
    color: T.text,
  },
  topBar: {
    position: "sticky",
    top: 0,
    background: T.sec,
    borderBottom: `1px solid ${T.border}`,
    padding: "0.875rem 2rem",
    display: "flex",
    alignItems: "center",
    gap: "12px",
    zIndex: 100,
    flexShrink: 0,
  },
  backBtn: {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: T.text,
    padding: "4px",
    display: "flex",
    alignItems: "center",
  },
  topBarTitleWrap: { display: "flex", flexDirection: "column" },
  pageLabel: {
    fontSize: "0.58rem",
    textTransform: "uppercase",
    letterSpacing: "0.18em",
    color: T.textMuted,
    fontWeight: 400,
  },
  topBarTitle: {
    fontSize: "0.95rem",
    fontWeight: 400,
    color: T.text,
    letterSpacing: "-0.01em",
    margin: 0,
  },

  chatArea: {
    flex: 1,
    overflowY: "auto",
    padding: "2rem",
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
  },
  chatInner: {
    maxWidth: "760px",
    width: "100%",
    margin: "0 auto",
    display: "flex",
    flexDirection: "column",
    gap: "1.25rem",
    flex: 1,
  },

  emptyState: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    textAlign: "center",
    padding: "2rem",
  },
  emptyIcon: {
    width: 52, height: 52,
    border: `1px solid ${T.border}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    marginBottom: "1rem",
    color: T.textMuted,
  },
  emptyTitle: {
    fontSize: "1rem",
    fontWeight: 400,
    color: T.text,
    marginBottom: "0.4rem",
  },
  emptyText: {
    fontSize: "0.8rem",
    color: T.textMuted,
    maxWidth: 340,
    lineHeight: 1.6,
    marginBottom: "1.5rem",
  },
  suggestionRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: "0.5rem",
    justifyContent: "center",
  },
  suggestionChip: {
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.textSec,
    fontSize: "0.72rem",
    fontWeight: 300,
    padding: "0.45rem 0.9rem",
    cursor: "pointer",
    fontFamily: "'Open Sans', sans-serif",
    transition: "all 0.15s",
  },

  msgRow: { display: "flex", gap: "10px", alignItems: "flex-start" },
  msgRowUser: { flexDirection: "row-reverse" },
  avatar: {
    width: 28, height: 28,
    border: `1px solid ${T.borderStr}`,
    display: "flex", alignItems: "center", justifyContent: "center",
    flexShrink: 0, background: T.bg, color: T.text,
  },
  avatarUser: { background: T.text, color: T.bg },
  bubble: {
    maxWidth: "78%",
    padding: "0.75rem 1rem",
    fontSize: "0.82rem",
    lineHeight: 1.6,
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.text,
    whiteSpace: "pre-wrap",
  },
  bubbleUser: {
    background: T.text,
    color: T.bg,
    borderColor: T.text,
  },
  bubbleAssistant: {
    background: T.bgAlt,
  },
  bubbleError: {
    borderColor: T.borderStr,
    background: T.bg,
    color: T.textSec,
  },

  patientsWrap: {
    maxWidth: "78%",
    marginTop: "0.5rem",
    border: `1px solid ${T.border}`,
  },
  patientsHeader: {
    padding: "0.5rem 0.875rem",
    borderBottom: `1px solid ${T.border}`,
    background: T.bgAlt,
    fontSize: "0.6rem",
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: T.textMuted,
    display: "flex",
    alignItems: "center",
    gap: "6px",
  },
  patientRow: {
    padding: "0.6rem 0.875rem",
    borderBottom: `1px solid ${T.border}`,
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "10px",
  },
  patientName: { fontSize: "0.78rem", color: T.text, fontWeight: 400, margin: 0 },
  patientMeta: { fontSize: "0.65rem", color: T.textMuted, marginTop: "2px" },

  typingRow: { display: "flex", gap: "10px", alignItems: "center" },
  typingText: { fontSize: "0.78rem", color: T.textMuted, fontStyle: "italic" },

  inputBar: {
    borderTop: `1px solid ${T.border}`,
    padding: "1rem 2rem 1.5rem",
    flexShrink: 0,
  },
  inputInner: {
    maxWidth: "760px",
    margin: "0 auto",
    display: "flex",
    gap: "10px",
    alignItems: "flex-end",
  },
  textarea: {
    flex: 1,
    resize: "none",
    border: `1px solid ${T.border}`,
    padding: "0.7rem 0.9rem",
    fontFamily: "'Open Sans', sans-serif",
    fontWeight: 300,
    fontSize: "0.82rem",
    color: T.text,
    outline: "none",
    minHeight: 44,
    maxHeight: 140,
    lineHeight: 1.5,
  },
  micBtn: {
    height: 44, width: 44,
    flexShrink: 0,
    border: `1px solid ${T.border}`,
    background: T.bg,
    color: T.text,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
    transition: "all 0.15s",
  },
  micBtnActive: {
    background: T.danger,
    color: "#fff",
    borderColor: T.danger,
    animation: "da-mic-pulse 1.2s ease-in-out infinite",
  },
  micBtnDisabled: {
    background: T.bgAlt,
    color: T.textMuted,
    borderColor: T.border,
    cursor: "not-allowed",
  },
  sendBtn: {
    height: 44, width: 44,
    flexShrink: 0,
    border: `1px solid ${T.borderStr}`,
    background: T.text,
    color: T.bg,
    display: "flex", alignItems: "center", justifyContent: "center",
    cursor: "pointer",
  },
  sendBtnDisabled: {
    background: T.bgAlt,
    color: T.textMuted,
    borderColor: T.border,
    cursor: "not-allowed",
  },
  hint: {
    maxWidth: "760px",
    margin: "0.5rem auto 0",
    fontSize: "0.62rem",
    color: T.textMuted,
    textAlign: "center",
  },
  recordingHint: {
    maxWidth: "760px",
    margin: "0.5rem auto 0",
    fontSize: "0.68rem",
    color: T.danger,
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "6px",
  },
  recDot: {
    width: 6, height: 6, borderRadius: "50%", background: T.danger,
    animation: "da-mic-pulse 1.2s ease-in-out infinite",
  },
};

const SUGGESTIONS = [
  "Summarize this patient's treatment history",
  "What medications were prescribed recently?",
  "Any pending referrals to review?",
  "Show recent lab findings",
];

/* ─── SPINNER ─── */
function Spinner() {
  return (
    <span style={{ display: "inline-flex", animation: "da-spin 0.8s linear infinite" }}>
      <Loader2 size={13} />
    </span>
  );
}

/* ─── PATIENT REFERENCE CARD LIST ─── */
function PatientRefs({ patients }) {
  if (!patients || patients.length === 0) return null;
  return (
    <div style={S.patientsWrap}>
      <div style={S.patientsHeader}>
        <Users size={11} />
        <span>Referenced Patients ({patients.length})</span>
      </div>
      {patients.map((p, i) => (
        <div key={p.sys_user_id || p.patient_id || i} style={S.patientRow}>
          <div>
            <p style={S.patientName}>{cleanText(p.patient_name || p.name || "Unknown patient")}</p>
            {(p.reason || p.summary) && (
              <div style={S.patientMeta}>{cleanText(p.reason || p.summary)}</div>
            )}
          </div>
          {p.date && <span style={S.patientMeta}>{p.date}</span>}
        </div>
      ))}
    </div>
  );
}

/* ─── MAIN COMPONENT ─── */
function Chat() {
  const location = useLocation();
  const navigate = useNavigate();
  const query = new URLSearchParams(location.search);
  const doctorId = query.get("doctor_id");

  const [messages, setMessages] = useState([]); // { role, content, patients?, isError? }
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);
  const mediaRecorder = useRef(null);
  const audioChunks = useRef([]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, sending, recording, transcribing]);

  const autoGrow = (el) => {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 140) + "px";
  };

  /* ── Voice recording (same flow as GlassTranscriptionPanel) ── */
  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaRecorder.current = new MediaRecorder(stream);
      audioChunks.current = [];
      mediaRecorder.current.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.current.push(e.data);
      };
      mediaRecorder.current.start();
      setRecording(true);
    } catch {
      alert("Microphone permission is required.");
    }
  };

  const stopRecording = () => {
    if (!mediaRecorder.current) return;
    mediaRecorder.current.onstop = processAudio;
    mediaRecorder.current.stop();
    mediaRecorder.current.stream.getTracks().forEach((t) => t.stop());
    setRecording(false);
  };

  const processAudio = async () => {
    if (!audioChunks.current.length) return;
    setTranscribing(true);
    try {
      const blob = new Blob(audioChunks.current, { type: "audio/webm" });
      audioChunks.current = [];
      const formData = new FormData();
      formData.append("file", blob);
      const res = await fetch(`${API_BASE_URL}hms/users/ai/elevenlabs/api/transcribe_labs`, {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      const text = data?.text || "";
      if (text.trim()) {
        setInput((prev) => {
          const newValue = prev.trim() ? `${prev.trim()} ${text.trim()}` : text.trim();
          requestAnimationFrame(() => {
            if (textareaRef.current) autoGrow(textareaRef.current);
          });
          return newValue;
        });
      }
    } catch {
      alert("Transcription failed");
    } finally {
      setTranscribing(false);
    }
  };

  const toggleRecording = () => {
    if (recording) stopRecording();
    else startRecording();
  };

  const sendMessage = async (text) => {
    const question = (text ?? input).trim();
    if (!question || sending) return;

    if (!doctorId) {
      setMessages((m) => [
        ...m,
        { role: "user", content: question },
        { role: "assistant", content: "Doctor ID is missing from the URL. Please reopen this page from your dashboard.", isError: true },
      ]);
      setInput("");
      return;
    }

    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    if (textareaRef.current) textareaRef.current.style.height = "44px";
    setSending(true);

    try {
      const res = await fetch(`${API_BASE_URL}hms/users/data/context/doctor-rag/search`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doctor_id: doctorId,
          question,
          top_k: 10,
        }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: cleanText(data.answer) || "No answer was returned.",
            patients: data.patients || [],
          },
        ]);
      } else {
        setMessages((m) => [
          ...m,
          {
            role: "assistant",
            content: cleanText(data.detail || data.message) || "Something went wrong while fetching the answer.",
            isError: true,
          },
        ]);
      }
    } catch (err) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: "Network error. Please check your connection and try again.", isError: true },
      ]);
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const inputDisabled = sending || recording || transcribing;

  return (
    <div style={S.page}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;400;600&display=swap');
        * { box-sizing: border-box; }
        ::selection { background: #000; color: #fff; }
        @keyframes da-spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes da-mic-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.45; } }
        .chat-back:hover { opacity: 0.6; }
        .chat-chip:hover { border-color: ${T.text} !important; color: ${T.text} !important; }
        .chat-send:hover:not(:disabled) { background: ${T.textSec} !important; border-color: ${T.textSec} !important; }
        .chat-mic:hover:not(:disabled) { border-color: ${T.text} !important; }
        .chat-scroll::-webkit-scrollbar { width: 6px; }
        .chat-scroll::-webkit-scrollbar-thumb { background: ${T.border}; }
        textarea:focus { border-color: ${T.borderStr} !important; }
      `}</style>

      {/* ── TOP BAR ── */}
      <div style={S.topBar}>
        <button
          className="chat-back"
          style={S.backBtn}
          onClick={() => navigate(doctorId ? `/doctor-dashboard?doctor_id=${doctorId}` : "/dashboard")}
        >
          <ArrowLeft size={18} />
        </button>
        <div style={S.topBarTitleWrap}>
          <span style={S.pageLabel}>AI Assistant</span>
          <p style={S.topBarTitle}>Clinical Chat</p>
        </div>
      </div>

      {/* ── CHAT AREA ── */}
      <div className="chat-scroll" style={S.chatArea} ref={scrollRef}>
        <div style={S.chatInner}>
          {messages.length === 0 ? (
            <div style={S.emptyState}>
              <div style={S.emptyIcon}>
                <Bot size={22} />
              </div>
              <p style={S.emptyTitle}>Ask about your patients</p>
              <p style={S.emptyText}>
                Query treatments, referrals, medications, and clinical history across your patient records. Type or use the mic to dictate your question.
              </p>
              <div style={S.suggestionRow}>
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    className="chat-chip"
                    style={S.suggestionChip}
                    onClick={() => sendMessage(s)}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((m, i) => (
              <div key={i}>
                <div style={{ ...S.msgRow, ...(m.role === "user" ? S.msgRowUser : {}) }}>
                  <div style={{ ...S.avatar, ...(m.role === "user" ? S.avatarUser : {}) }}>
                    {m.role === "user" ? <User size={13} /> : <Bot size={13} />}
                  </div>
                  <div
                    style={{
                      ...S.bubble,
                      ...(m.role === "user" ? S.bubbleUser : S.bubbleAssistant),
                      ...(m.isError ? S.bubbleError : {}),
                    }}
                  >
                    {m.isError && (
                      <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "4px", color: T.textMuted }}>
                        <AlertCircle size={12} />
                        <span style={{ fontSize: "0.62rem", textTransform: "uppercase", letterSpacing: "0.08em" }}>Error</span>
                      </div>
                    )}
                    {m.content}
                  </div>
                </div>
                {m.role === "assistant" && !m.isError && (
                  <div style={{ display: "flex", justifyContent: "flex-start", marginLeft: 38 }}>
                    <PatientRefs patients={m.patients} />
                  </div>
                )}
              </div>
            ))
          )}

          {sending && (
            <div style={S.typingRow}>
              <div style={S.avatar}>
                <Bot size={13} />
              </div>
              <div style={{ ...S.bubble, ...S.bubbleAssistant, display: "flex", alignItems: "center", gap: "8px" }}>
                <Spinner />
                <span style={S.typingText}>Searching patient records…</span>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── INPUT BAR ── */}
      <div style={S.inputBar}>
        <div style={S.inputInner}>
          <button
            className="chat-mic"
            style={{
              ...S.micBtn,
              ...(recording ? S.micBtnActive : {}),
              ...(transcribing ? S.micBtnDisabled : {}),
            }}
            onClick={toggleRecording}
            disabled={sending || transcribing}
            title={recording ? "Stop recording" : "Dictate question"}
          >
            {transcribing ? <Loader2 size={16} style={{ animation: "da-spin 0.8s linear infinite" }} /> : recording ? <Square size={15} /> : <Mic size={16} />}
          </button>
          <textarea
            ref={textareaRef}
            style={S.textarea}
            placeholder={recording ? "Listening…" : "Ask about a patient, treatment, or referral…"}
            value={input}
            onChange={(e) => { setInput(e.target.value); autoGrow(e.target); }}
            onKeyDown={handleKeyDown}
            disabled={inputDisabled}
            rows={1}
          />
          <button
            className="chat-send"
            style={{ ...S.sendBtn, ...((!input.trim() || inputDisabled) ? S.sendBtnDisabled : {}) }}
            onClick={() => sendMessage()}
            disabled={!input.trim() || inputDisabled}
          >
            <Send size={16} />
          </button>
        </div>
        {recording ? (
          <div style={S.recordingHint}>
            <span style={S.recDot} />
            Recording — tap the square to stop and transcribe
          </div>
        ) : (
          <div style={S.hint}>
            <FileText size={10} style={{ verticalAlign: "-1px", marginRight: 4 }} />
            Answers are generated from this doctor's patient records and referral notes.
          </div>
        )}
      </div>
    </div>
  );
}

export default Chat;