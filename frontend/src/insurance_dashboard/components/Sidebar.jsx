import './Sidebar.css'
import { useNavigate, useLocation } from "react-router-dom";
import { useState, useEffect } from 'react'
import { useNotifications } from '../context/NotificationsContext'

// Per-role config for the four spec roles added as auth scaffolding. Each maps
// to its localStorage token/name keys, portal label, and dashboard path so the
// sidebar can render a minimal single-item nav + correct sign-out in role mode.
const ROLE_CONFIG = {
  'state-team':        { label: 'State Team',        tokenKey: 'state_token',  nameKey: 'state_name',  subtitle: 'State Team Portal',        path: '/insurance/state-team/dashboard' },
  'reporting-manager': { label: 'Reporting Manager', tokenKey: 'rm_token',     nameKey: 'rm_name',     subtitle: 'Reporting Manager Portal', path: '/insurance/reporting-manager/dashboard' },
  'qc-manager':        { label: 'QC Manager',        tokenKey: 'qc_token',     nameKey: 'qc_name',     subtitle: 'QC Manager Portal',        path: '/insurance/qc-manager/dashboard' },
  'portal-team':       { label: 'Portal Team',       tokenKey: 'portal_token', nameKey: 'portal_name', subtitle: 'Portal Team Portal',       path: '/insurance/portal-team/dashboard' },
};
const ROUTE_MAP = {
  dashboard: "/insurance/dashboard",
  analytics: "/insurance/analytics",
  "case-create": "/insurance/new-case",
  qc: "/insurance/cq-review",
  "field-officers": "/insurance/field-officers",
  doctors: "/insurance/doctors",
  messages: "/insurance/messages",
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
      { id: 'analytics', label: 'Analytics', icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>
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
)},
    { id: 'messages', label: 'Messages', icon: (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
), badge: 'unread' }
  ]
},
  // {
  //   section: 'Documents',
  //   items: [
  //     { id: 'evidence', label: 'Evidence Vault', icon: (
  //       <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
  //         <rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>
  //       </svg>
  //     )},
    
  //   ]
  // },

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

export default function Sidebar({ mdMode = false, operationsMode = false, roleMode = '' }) {
  const navigate = useNavigate();
  const [user, setUser] = useState({ name: '', role: '' })
  const { unreadTotal } = useNotifications()
  const roleCfg = ROLE_CONFIG[roleMode] || null;
  useEffect(() => {
    if (mdMode) {
      setUser({ name: localStorage.getItem('md_name') || 'Managing Director', role: 'managing-director' })
      return
    }
    if (operationsMode) {
      setUser({ name: localStorage.getItem('operations_name') || 'Operations Head', role: 'operations-head' })
      return
    }
    if (roleCfg) {
      setUser({ name: localStorage.getItem(roleCfg.nameKey) || roleCfg.label, role: roleMode })
      return
    }
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
  }, [mdMode, operationsMode, roleMode])

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
    'managing-director': 'Managing Director',
    'operations-head': 'Operations Head',
    'state-team': 'State Team',
    'reporting-manager': 'Reporting Manager',
    'qc-manager': 'QC Manager',
    'portal-team': 'Portal Team',
  }[user.role] || user.role || 'User'

  const location = useLocation();
    return (
    <aside className="sidebar">
      <div className="logo">
        <div className="logo-mark">Verifin</div>
        <div className="logo-sub">{mdMode ? 'Executive Portal' : operationsMode ? 'Operations Portal' : roleCfg ? roleCfg.subtitle : 'Admin Portal'}</div>
      </div>

      <nav className="nav">
        {mdMode ? (
          <div>
            <div className="nav-section">Overview</div>
            <div className={`nav-item ${location.pathname === '/insurance/md/dashboard' ? 'active' : ''}`} onClick={() => navigate('/insurance/md/dashboard')}>
              <span className="nav-icon">▦</span>Dashboard
            </div>
            <div className={`nav-item ${location.pathname === '/insurance/md/operations-heads' ? 'active' : ''}`} onClick={() => navigate('/insurance/md/operations-heads')}>
              <span className="nav-icon">♙</span>Operations Heads
            </div>
          </div>
        ) : operationsMode ? (
          <div>
            <div className="nav-section">Overview</div>
            <div className={`nav-item ${location.pathname === '/insurance/operations/dashboard' ? 'active' : ''}`} onClick={() => navigate('/insurance/operations/dashboard')}>
              <span className="nav-icon">▦</span>Dashboard
            </div>
            <div className={`nav-item ${location.pathname === '/insurance/operations/users' ? 'active' : ''}`} onClick={() => navigate('/insurance/operations/users')}>
              <span className="nav-icon">♟</span>User Management
            </div>
            <div className={`nav-item ${location.pathname === '/insurance/operations/doctors' ? 'active' : ''}`} onClick={() => navigate('/insurance/operations/doctors')}>
              <span className="nav-icon">✚</span>Doctors
            </div>
          </div>
        ) : roleCfg ? (
          <div>
            <div className="nav-section">Overview</div>
            <div className={`nav-item ${location.pathname === roleCfg.path ? 'active' : ''}`} onClick={() => navigate(roleCfg.path)}>
              <span className="nav-icon">▦</span>Dashboard
            </div>
          </div>
        ) : NAV_ITEMS.map(({ section, items }) => (
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
                {badge === 'unread' && unreadTotal > 0 && (
                  <span className="nav-badge">{unreadTotal}</span>
                )}
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
      {(mdMode || operationsMode) && <button type="button" className="md-signout" onClick={() => {
        localStorage.removeItem(mdMode ? 'md_token' : 'operations_token')
        localStorage.removeItem(mdMode ? 'md_name' : 'operations_name')
        const activeRole = localStorage.getItem('role')
        if ((mdMode && ['md', 'managing-director', 'super-admin'].includes(activeRole)) || (operationsMode && activeRole === 'operations-head')) {
          localStorage.removeItem('role')
          localStorage.removeItem('user_id')
          localStorage.removeItem('full_name')
        }
        navigate(mdMode ? '/insurance/md/login' : '/insurance/operations/login', { replace: true })
      }}>Sign out</button>}
      {roleCfg && <button type="button" className="md-signout" onClick={() => {
        localStorage.removeItem(roleCfg.tokenKey)
        localStorage.removeItem(roleCfg.nameKey)
        if (localStorage.getItem('role') === roleMode) {
          localStorage.removeItem('role')
          localStorage.removeItem('user_id')
          localStorage.removeItem('full_name')
        }
        navigate('/', { replace: true })
      }}>Sign out</button>}
      </div>
    </aside>
  )
}
