// pages/MessagesPage.jsx
import React, { useEffect, useState, useRef } from 'react'
import { useNotifications } from '../context/NotificationsContext'

const API_BASE = 'https://doctorassist.ai/api/insurance/messages'
const WS_BASE  = 'wss://doctorassist.ai/api/insurance/messages'
export default function MessagesPage() {
  const [cases, setCases]           = useState([])
  const [activeCaseId, setActive]   = useState(null)
  const [messages, setMessages]     = useState([])
  const [input, setInput]           = useState('')
  const wsRef  = useRef(null)
  const userId = localStorage.getItem('sys_user_id') || localStorage.getItem('user_id') || 'web-user'
  const fullName = localStorage.getItem('full_name') || 'Supervisor'

  const { unreadByCase, caseListVersion, markCaseRead } = useNotifications()

  // NOTE: replace this with your real "list all cases" endpoint —
  // using a placeholder fetch here since I don't have your cases-list route.
  useEffect(() => {
    fetch('https://doctorassist.ai/api/insurance/web/cases?limit=100&skip=0', {
      headers: { 'X-User-Id': userId, 'X-User-Role': 'supervisor' },
    })
      .then(r => r.json())
      .then(data => setCases(data.cases || []))
      .catch(() => {})
  }, [userId, caseListVersion]) // ← refetches whenever the notifications socket signals a new message

  useEffect(() => {
    if (!activeCaseId) return
    fetch(`${API_BASE}/case/${activeCaseId}`)
      .then(r => r.json())
      .then(data => setMessages(data.messages || []))

    fetch(`${API_BASE}/case/${activeCaseId}/read`, { method: 'PATCH', headers: { 'X-User-Id': userId } })
      .then(() => markCaseRead(activeCaseId))

    const ws = new WebSocket(`${WS_BASE}/ws/case/${activeCaseId}?userId=${userId}`)
    ws.onmessage = (e) => {
      const parsed = JSON.parse(e.data)
      if (parsed.type === 'message') setMessages(prev => [...prev, parsed.data])
    }
    wsRef.current = ws
    return () => ws.close()
  }, [activeCaseId, userId, markCaseRead])

  const send = () => {
    const text = input.trim()
    if (!text || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    wsRef.current.send(JSON.stringify({
      senderId: userId, senderName: fullName, senderRole: 'supervisor', text,
    }))
    setInput('')
  }

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* Case list */}
      <div style={{ width: 280, borderRight: '1px solid var(--border)', overflowY: 'auto' }}>
        {cases.map(c => (
          <div
            key={c.caseId}
            onClick={() => setActive(c.caseId)}
            style={{
              padding: '12px 16px', cursor: 'pointer',
              background: activeCaseId === c.caseId ? 'var(--bg2)' : 'transparent',
              borderBottom: '1px solid var(--border)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{c.claimantName || c.caseId}</div>
              <div style={{ fontSize: 11, color: 'var(--muted)' }}>Case #{c.caseId}</div>
            </div>
            {unreadByCase[c.caseId] > 0 && (
              <span style={{
                background: '#ef4444', color: '#fff', borderRadius: 10,
                fontSize: 11, padding: '2px 7px', fontWeight: 700,
              }}>{unreadByCase[c.caseId]}</span>
            )}
          </div>
        ))}
      </div>

      {/* Chat panel */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {!activeCaseId ? (
          <div style={{ margin: 'auto', color: 'var(--muted)' }}>Select a case to view messages</div>
        ) : (
          <>
            <div style={{ flex: 1, overflowY: 'auto', padding: 16 }}>
              {messages.map((m, i) => {
                const mine = m.senderId === userId
                return (
                  <div key={m._id || i} style={{ display: 'flex', justifyContent: mine ? 'flex-end' : 'flex-start', marginBottom: 8 }}>
                    <div style={{
                      maxWidth: '60%', padding: '8px 12px', borderRadius: 12,
                      background: mine ? 'var(--accent)' : '#fff',
                      color: mine ? '#fff' : 'var(--text)',
                      border: mine ? 'none' : '1px solid var(--border)',
                    }}>
                      {!mine && <div style={{ fontSize: 10, fontWeight: 700, marginBottom: 2, opacity: 0.7 }}>{m.senderName}</div>}
                      <div style={{ fontSize: 13 }}>{m.text}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: 8, padding: 12, borderTop: '1px solid var(--border)' }}>
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') send() }}
                placeholder="Type a message..."
                style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)' }}
              />
              <button onClick={send} style={{ padding: '8px 16px', borderRadius: 8, background: 'var(--accent)', color: '#fff', border: 'none' }}>
                Send
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}