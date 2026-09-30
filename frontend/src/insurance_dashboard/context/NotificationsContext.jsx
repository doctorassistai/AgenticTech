// context/NotificationsContext.jsx
import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'

const NotificationsContext = createContext(null)
const API_BASE = 'https://doctorassist.ai/api/insurance/messages'
const WS_BASE  = 'wss://doctorassist.ai/api/insurance/messages'

export function NotificationsProvider({ children }) {
  const [unreadByCase, setUnreadByCase] = useState({})
  const [unreadTotal, setUnreadTotal]   = useState(0)
  const [caseListVersion, setCaseListVersion] = useState(0)
  const wsRef = useRef(null)
  const reconnectTimer = useRef(null)
  const userId = localStorage.getItem('sys_user_id') || localStorage.getItem('user_id') || 'web-user'

  // one-time pull on load — the socket only pushes deltas after a new
  // message, it doesn't replay current state on connect
  useEffect(() => {
    fetch(`${API_BASE}/unread-summary`, { headers: { 'X-User-Id': userId } })
      .then(r => r.json())
      .then(data => {
        setUnreadByCase(data.unreadByCase || {})
        setUnreadTotal(data.total || 0)
      })
      .catch(() => {})
  }, [userId])

  const connect = useCallback(() => {
    const ws = new WebSocket(`${WS_BASE}/ws/notifications/${userId}`)

    ws.onmessage = (e) => {
      const parsed = JSON.parse(e.data)
      if (parsed.type === 'new_message') {
        // server sends the full, authoritative counts for this user —
        // replace wholesale, don't merge
        setUnreadByCase(parsed.unreadByCase || {})
        setUnreadTotal(parsed.total || 0)
        setCaseListVersion(v => v + 1)
      }
    }

    ws.onclose = () => {
      reconnectTimer.current = setTimeout(connect, 3000)
    }

    wsRef.current = ws
  }, [userId])

  useEffect(() => {
    connect()
    return () => {
      clearTimeout(reconnectTimer.current)
      wsRef.current?.close()
    }
  }, [connect])

  const markCaseRead = useCallback((caseId) => {
    setUnreadByCase(prev => {
      if (!prev[caseId]) return prev
      const next = { ...prev }
      const had = next[caseId]
      delete next[caseId]
      setUnreadTotal(t => Math.max(0, t - had))
      return next
    })
  }, [])

  return (
    <NotificationsContext.Provider value={{ unreadByCase, unreadTotal, caseListVersion, markCaseRead }}>
      {children}
    </NotificationsContext.Provider>
  )
}

export const useNotifications = () => useContext(NotificationsContext)