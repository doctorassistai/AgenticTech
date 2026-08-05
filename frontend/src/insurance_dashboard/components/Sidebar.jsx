import './Sidebar.css'
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from 'react'

const ROUTE_MAP = {
  dashboard: "/insurance/dashboard",
  "case-create": "/insurance/new-case",
  "task-alloc": "/insurance/task-allocation",
  "field-track": "/insurance/field-tracking",
  evidence: "/insurance/evidence-vault",
  qc: "/insurance/cq-review",
  "field-officers": "/insurance/field-officers",
  doctors: "/insurance/doctors",   // ← add this line, matching your actual route
};
const NAV_ITEMS = [
  {
    section: 'Overview',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>
      )},
    ]
  },
  {
    section: 'Cases',
    items: [
      { id: 'case-create', label: 'New Case', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
      )},
      { id: 'task-alloc', label: 'Task Allocation', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      )},
      { id: 'field-track', label: 'Field Tracking', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10"/>
          <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
        </svg>
      )},
    ]
  },
    {
  section: 'Management',
  items: [
    { 
      id: 'field-officers', 
      label: 'Field Officers', 
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="9" cy="7" r="4"/>
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        </svg>
      )
    },
    { id: 'doctors', label: 'Doctors', icon: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"/>
  </svg>
)}
  ]
},
  {
    section: 'Documents',
    items: [
      { id: 'evidence', label: 'Evidence Vault', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
        </svg>
      )},
    
    ]
  },

  {
    section: 'Review',
    items: [
      { id: 'qc', label: 'QC Review', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="9 11 12 14 22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      )},
    ]
  },
]

export default function Sidebar() {
  const navigate = useNavigate();
  const [user, setUser] = useState({ name: '', role: '' })
  useEffect(() => {
    try {
      // Try plain stored fields first
      const name = localStorage.getItem('full_name') || localStorage.getItem('name')
      const role = localStorage.getItem('role')

      if (name) {
        setUser({ name, role: role || '' })
        return
      }

      // Fall back to decoding JWT
      const token = localStorage.getItem('token') || localStorage.getItem('access_token')
      if (token) {
        const payload = JSON.parse(atob(token.split('.')[1]))
        setUser({
          name: payload.full_name || payload.name || payload.sub || 'User',
          role: payload.role || '',
        })
      }
    } catch {
      setUser({ name: 'User', role: '' })
    }
  }, [])

  // Helper: initials from name
  const initials = user.name
    ? user.name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
    : 'U'

  // Role display label
  const roleLabel = {
    'supervisor': 'Supervisor',
    'auditing-doctor-new': 'Auditing Doctor',
    'field-officer': 'Field Officer',
    'admin': 'Admin',
  }[user.role] || user.role || 'User'

  const location = useLocation();
    return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">CIMS</div>
        <div className="logo-sub">Admin Portal</div>
      </div>

      <nav className="nav">
        {NAV_ITEMS.map(({ section, items }) => (
          <div key={section}>
            <div className="nav-section">{section}</div>
            {items.map(({ id, label, icon, badge }) => (
              <div
                key={id}
                className={`nav-item ${location.pathname === ROUTE_MAP[id] ? 'active' : ''}`}
                onClick={() => navigate(ROUTE_MAP[id])}
              >
                <span className="nav-icon">{icon}</span>
                {label}
                {badge && <span className="nav-badge">{badge}</span>}
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="sidebar-footer">
<div className="user-chip">
  <div className="avatar">{initials}</div>
  <div className="user-info">
    <div className="user-name">{user.name || 'User'}</div>
    <div className="user-role">{roleLabel}</div>
  </div>
</div>
      </div>
    </aside>
  )
}
