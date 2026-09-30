import React, { useState, useRef, useEffect, useCallback } from "react";

const T = {
  bg: "var(--bg)", bgAlt: "var(--bg3, #fafafa)", bgTert: "var(--bg2, var(--bg3, #f4f4f2))",
  text: "var(--text)", textSec: "color-mix(in srgb, var(--text) 85%, var(--muted))",
  textMuted: "var(--muted)", border: "var(--border)", accent: "var(--accent)",
  accentLight: "color-mix(in srgb, var(--accent) 10%, var(--bg))",
  accentSoft: "color-mix(in srgb, var(--accent) 14%, var(--bg))",
  danger: "var(--red)", warn: "var(--amber)",
  badgeBg: "#131b3a", // round toggle / avatar backdrop — deep blue, no orange
};

/* ─── ICONS ──────────────────────────────────────────────────────────── */
function ChatIcon({ size = 20, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 20l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
    </svg>
  );
}
function CloseIcon({ size = 18, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
function SendIcon({ size = 15, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="6 11 12 5 18 11" />
    </svg>
  );
}
function AlertIcon({ size = 13, color = "currentColor" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="13" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}
// Simple, professional person mark used for the assistant avatar (no emoji).
function PersonIcon({ size = 13, color = "#fff" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="8" r="3.4" />
      <path d="M5.5 20c0-3.6 2.9-6.2 6.5-6.2s6.5 2.6 6.5 6.2" />
    </svg>
  );
}

// Belt-and-braces: the system prompt tells the model to skip markdown, but
// LLMs sometimes slip into **bold**/bullets anyway. Strip it before display
// rather than relying on the prompt alone.
function stripMarkdown(text) {
  if (!text) return text;
  return text
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^[*\-]\s+/gm, "• ")
    .replace(/`([^`]+)`/g, "$1");
}

function formatTime(ts) {
  try {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function AssistantAvatar() {
  return (
    <div style={{
      width: 24, height: 24, borderRadius: "50%", flexShrink: 0,
      background: `linear-gradient(155deg, ${T.badgeBg}, color-mix(in srgb, ${T.badgeBg} 70%, #000))`,
      display: "flex", alignItems: "center", justifyContent: "center",
      boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
    }}>
      <PersonIcon />
    </div>
  );
}

function ChatMessage({ msg, animate }) {
  const isUser = msg.role === "user";
  const isError = msg.role === "error";
  const content = stripMarkdown(msg.content);
  return (
    <div style={{
      display: "flex", justifyContent: isUser ? "flex-end" : "flex-start",
      alignItems: "flex-end", gap: 7, marginBottom: 14,
      animation: animate ? "claimChatMsgIn 0.28s cubic-bezier(0.2,0.8,0.2,1) both" : "none",
    }}>
      {!isUser && !isError && <AssistantAvatar />}
      <div>
        {isError && (
          <div style={{
            display: "flex", gap: 8, alignItems: "flex-start", maxWidth: 260,
            padding: "9px 12px", borderRadius: 10,
            background: "color-mix(in srgb, var(--red) 8%, var(--bg))",
            border: `1px solid color-mix(in srgb, var(--red) 30%, var(--bg))`,
          }}>
            <span style={{ color: T.danger, flexShrink: 0, marginTop: 1 }}><AlertIcon /></span>
            <span style={{ fontSize: 12.5, lineHeight: 1.55, color: T.danger }}>{content}</span>
          </div>
        )}
        {!isError && (
          <div style={{
            maxWidth: 258, padding: "10px 13px", borderRadius: 14,
            borderBottomRightRadius: isUser ? 4 : 14,
            borderBottomLeftRadius: isUser ? 14 : 4,
            background: isUser ? T.accent : T.bgTert,
            color: isUser ? "#fff" : T.text,
            fontSize: 12.5, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word",
            boxShadow: isUser ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
          }}>
            {content}
          </div>
        )}
        {msg.ts && (
          <div style={{
            fontSize: 10, color: T.textMuted, marginTop: 4,
            textAlign: isUser ? "right" : "left", paddingLeft: isUser ? 0 : 2, paddingRight: isUser ? 2 : 0,
          }}>
            {formatTime(msg.ts)}
          </div>
        )}
      </div>
    </div>
  );
}

function TypingDots() {
  return (
    <div style={{ display: "flex", justifyContent: "flex-start", alignItems: "flex-end", gap: 7, marginBottom: 14, animation: "claimChatMsgIn 0.24s cubic-bezier(0.2,0.8,0.2,1) both" }}>
      <AssistantAvatar />
      <div style={{ display: "flex", gap: 4, padding: "11px 14px", borderRadius: 14, borderBottomLeftRadius: 4, background: T.bgTert }}>
        {[0, 1, 2].map(i => (
          <span key={i} style={{
            width: 5, height: 5, borderRadius: "50%", background: T.textMuted,
            animation: `claimChatBounce 1.1s ${i * 0.15}s infinite ease-in-out`,
          }} />
        ))}
      </div>
    </div>
  );
}

function SuggestionPills({ items, onPick, disabled }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{
      display: "flex", flexWrap: "wrap", gap: 7, marginTop: 2, marginBottom: 14,
      paddingLeft: 31, animation: "claimChatMsgIn 0.3s cubic-bezier(0.2,0.8,0.2,1) both",
    }}>
      {items.map((q, i) => (
        <button
          key={i}
          onClick={() => !disabled && onPick(q)}
          disabled={disabled}
          style={{
            border: "none", cursor: disabled ? "default" : "pointer",
            padding: "7px 12px", borderRadius: 999, fontSize: 11.5, lineHeight: 1.3,
            fontWeight: 500, color: T.accent,
            background: T.accentSoft,
            opacity: disabled ? 0.55 : 1,
            transition: "transform 0.12s ease, background 0.15s ease",
            fontFamily: "inherit",
          }}
          onMouseEnter={e => { if (!disabled) { e.currentTarget.style.background = T.accentLight; e.currentTarget.style.transform = "translateY(-1px)"; } }}
          onMouseLeave={e => { e.currentTarget.style.background = T.accentSoft; e.currentTarget.style.transform = "translateY(0)"; }}
        >
          {q}
        </button>
      ))}
    </div>
  );
}

const DEFAULT_SUGGESTIONS = [
  "Explain the billing mismatch",
  "Is the discharge date consistent?",
  "Are there any missing documents?",
  "Summarize this claim",
];

export default function ClaimChatWidget({ caseId, doctorId, baseUrl, claimantName }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, loading, suggestions]);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 150);
  }, [open]);

  const ask = useCallback(async (question) => {
    const q = question.trim();
    if (!q || loading) return;
    setInput("");
    setSuggestions([]);
    const userMsg = { role: "user", content: q, ts: Date.now() };
    const nextMessages = [...messages, userMsg];
    setMessages(nextMessages);
    setLoading(true);
    try {
      const history = nextMessages
        .filter(m => m.role === "user" || m.role === "assistant")
        .slice(-12)
        .map(m => ({ role: m.role, content: m.content }));

      const res = await fetch(`${baseUrl}insurance/web/doctor/case/${caseId}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-User-Id": doctorId,
          "X-User-Role": "auditing-doctor-new",
        },
        body: JSON.stringify({ question: q, history }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody.detail || "Request failed");
      }
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.answer, ts: Date.now() }]);
      // Prefer suggestions the backend hands back for this answer; otherwise
      // fall back to a small rotating set of generic claim follow-ups.
      if (Array.isArray(data.suggestions) && data.suggestions.length > 0) {
        setSuggestions(data.suggestions.slice(0, 4));
      } else {
        const shuffled = [...DEFAULT_SUGGESTIONS].sort(() => Math.random() - 0.5);
        setSuggestions(shuffled.slice(0, 2));
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: "error",
        content: `Couldn't get an answer (${err.message || "network error"}). Try again.`,
      }]);
    } finally {
      setLoading(false);
    }
  }, [loading, messages, baseUrl, caseId, doctorId]);

  const send = useCallback(() => ask(input), [ask, input]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  const canSend = !loading && input.trim().length > 0;

  return (
    <>
      <style>{`
        @keyframes claimChatBounce{0%,80%,100%{opacity:.35;transform:translateY(0)}40%{opacity:1;transform:translateY(-3px)}}
        @keyframes claimChatIn{from{opacity:0;transform:translateY(14px) scale(0.96)}to{opacity:1;transform:translateY(0) scale(1)}}
        @keyframes claimChatMsgIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        @keyframes claimChatPulse{0%{box-shadow:0 0 0 0 color-mix(in srgb, ${T.badgeBg} 45%, transparent)}70%{box-shadow:0 0 0 10px color-mix(in srgb, ${T.badgeBg} 0%, transparent)}100%{box-shadow:0 0 0 0 color-mix(in srgb, ${T.badgeBg} 0%, transparent)}}
      `}</style>

      {/* Floating panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 88, right: 24, width: 372, height: 508,
          background: T.bg, border: `1px solid ${T.border}`, borderRadius: 18,
          boxShadow: "0 16px 40px rgba(0,0,0,0.16), 0 2px 8px rgba(0,0,0,0.06)",
          display: "flex", flexDirection: "column",
          overflow: "hidden", zIndex: 500, animation: "claimChatIn 0.18s cubic-bezier(0.2,0.8,0.2,1)",
        }}>
          {/* Header */}
          <div style={{
            padding: "16px 18px", borderBottom: `1px solid ${T.border}`, background: T.bg,
            flexShrink: 0, display: "flex", alignItems: "center", gap: 10,
          }}>
            <AssistantAvatar />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: T.text, letterSpacing: "0.01em" }}>
                Ask about this claim
              </div>
              <div style={{ fontSize: 11, color: T.textMuted, marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {claimantName ? claimantName : "Grounded in the uploaded case documents"}
              </div>
            </div>
          </div>

          {/* Messages */}
          <div ref={listRef} style={{ flex: 1, overflowY: "auto", padding: "16px 14px", background: T.bgAlt }}>
            {messages.length === 0 && (
              <>
                <div style={{
                  display: "flex", gap: 7, marginBottom: 14,
                  animation: "claimChatMsgIn 0.28s cubic-bezier(0.2,0.8,0.2,1) both",
                }}>
                  <AssistantAvatar />
                  <div style={{
                    padding: "12px 14px", borderRadius: 14, borderBottomLeftRadius: 4,
                    background: T.bgTert, color: T.textSec, fontSize: 12, lineHeight: 1.6, maxWidth: 258,
                  }}>
                    <div style={{ fontWeight: 600, color: T.text, marginBottom: 4, fontSize: 12 }}>
                      How this works
                    </div>
                    Ask things like "what was the diagnosis" or "is there a conflict in the admission
                    date." Answers are grounded strictly in this case's fields and documents — nothing
                    is invented, and conflicting or missing information is called out explicitly.
                  </div>
                </div>
                <SuggestionPills items={DEFAULT_SUGGESTIONS.slice(0, 3)} onPick={ask} disabled={loading} />
              </>
            )}
            {messages.map((m, i) => (
              <ChatMessage key={i} msg={m} animate={i === messages.length - 1} />
            ))}
            {loading && <TypingDots />}
            {!loading && suggestions.length > 0 && (
              <SuggestionPills items={suggestions} onPick={ask} disabled={loading} />
            )}
          </div>

          {/* Input */}
          <div style={{ padding: 12, borderTop: `1px solid ${T.border}`, background: T.bg, display: "flex", gap: 8, alignItems: "flex-end", flexShrink: 0 }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a question about this claim…"
              rows={1}
              style={{
                flex: 1, resize: "none", border: `1px solid ${T.border}`, borderRadius: 12,
                padding: "9px 12px", fontSize: 12.5, fontFamily: "inherit", color: T.text,
                background: T.bgAlt, outline: "none", maxHeight: 90, lineHeight: 1.4,
                transition: "border-color 0.15s ease",
              }}
              onFocus={e => e.target.style.borderColor = T.accent}
              onBlur={e => e.target.style.borderColor = T.border}
            />
            <button
              onClick={send}
              disabled={!canSend}
              style={{
                width: 34, height: 34, flexShrink: 0, border: "none", borderRadius: "50%",
                background: canSend ? T.accent : T.bgTert,
                color: canSend ? "#fff" : T.textMuted,
                display: "flex", alignItems: "center", justifyContent: "center",
                cursor: canSend ? "pointer" : "not-allowed",
                transition: "background 0.15s, transform 0.1s",
              }}
              onMouseDown={e => { if (canSend) e.currentTarget.style.transform = "scale(0.92)"; }}
              onMouseUp={e => { e.currentTarget.style.transform = "scale(1)"; }}
              title="Send"
            >
              <SendIcon />
            </button>
          </div>
        </div>
      )}

      {/* Single floating toggle — round, solid blue, no orange */}
      <button
        data-tour="chat-toggle"
        onClick={() => setOpen(o => !o)}
        style={{
          position: "fixed", bottom: 24, right: 24, width: 56, height: 56,
          borderRadius: "50%", background: T.badgeBg, border: "none", cursor: "pointer",
          boxShadow: "0 10px 24px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.15)", zIndex: 501,
          display: "flex", alignItems: "center", justifyContent: "center",
          transition: "transform 0.15s ease",
          animation: (!open && messages.length === 0) ? "claimChatPulse 2.4s ease-out infinite" : "none",
        }}
        onMouseEnter={e => e.currentTarget.style.transform = "scale(1.05)"}
        onMouseLeave={e => e.currentTarget.style.transform = "scale(1)"}
        title={open ? "Close" : "Ask about this claim"}
      >
        {open ? <CloseIcon size={20} color="#fff" /> : <ChatIcon size={22} color="#fff" />}
      </button>
    </>
  );
}