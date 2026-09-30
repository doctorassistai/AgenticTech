import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './OperationsHeadAssignment.css';

const BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || '';

// Roles the Operations Head can provision here (spec §16). Field Officer/Doctor
// have their own registration flows elsewhere, so this focuses on the four
// spec roles that previously had no way to be created.
const ROLE_OPTIONS = [
  { value: 'state-team', label: 'State Team' },
  { value: 'reporting-manager', label: 'Reporting Manager' },
  { value: 'qc-manager', label: 'QC Manager' },
  { value: 'portal-team', label: 'Portal Team' },
];

const EMPTY = { role: 'state-team', full_name: '', username: '', password: '', states: '' };

export default function UserManagement() {
  const [form, setForm] = useState(EMPTY);
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null); // sys_user_id being edited
  const [edit, setEdit] = useState({ full_name: '', role: 'state-team', status: 'active', states: '' });
  const [resetInfo, setResetInfo] = useState(null); // { username, password }
  const token = localStorage.getItem('operations_token');

  const authHeaders = { Authorization: `Bearer ${token || ''}` };

  async function loadUsers() {
    try {
      const response = await fetch(`${BASE_URL}/insurance/web/operations/users`, { headers: authHeaders });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to load users');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message || 'Unable to load users');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) loadUsers();
    else setLoading(false);
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        role: form.role,
        username: form.username.trim(),
        password: form.password,
        full_name: form.full_name.trim() || null,
      };
      if (form.role === 'state-team') {
        payload.states = form.states.split(',').map(s => s.trim()).filter(Boolean);
      }
      const response = await fetch(`${BASE_URL}/insurance/web/operations/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to create user');
      setSuccess(`User ${data.username} (${data.role}) created.`);
      setForm({ ...EMPTY, role: form.role });
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Unable to create user');
    } finally {
      setSaving(false);
    }
  }

  function startEdit(user) {
    setEditing(user.sys_user_id);
    setResetInfo(null);
    setError('');
    setSuccess('');
    setEdit({
      full_name: user.full_name || '',
      role: user.role,
      status: user.status || 'active',
      states: (user.states || []).join(', '),
    });
  }

  async function saveEdit(userId) {
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const payload = {
        full_name: edit.full_name.trim() || null,
        role: edit.role,
        status: edit.status,
        states: edit.role === 'state-team'
          ? edit.states.split(',').map(s => s.trim()).filter(Boolean)
          : [],
      };
      const response = await fetch(`${BASE_URL}/insurance/web/operations/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to update user');
      setSuccess('User updated.');
      setEditing(null);
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Unable to update user');
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(user) {
    setError('');
    setSuccess('');
    setResetInfo(null);
    if (!window.confirm(`Reset password for ${user.username}? A new password will be generated.`)) return;
    try {
      const response = await fetch(`${BASE_URL}/insurance/web/operations/users/${user.sys_user_id}/reset-password`, {
        method: 'POST',
        headers: authHeaders,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to reset password');
      setResetInfo({ username: data.username, password: data.password });
    } catch (err) {
      setError(err.message || 'Unable to reset password');
    }
  }

  function copyPassword() {
    if (resetInfo?.password) navigator.clipboard?.writeText(resetInfo.password);
  }

  return <div className="operations-assignment">
    <div className="panel">
      <div className="panel-header"><div className="panel-title">Create User</div></div>
      <div className="panel-body">
        <p className="operations-intro">Create a role account. Share the username and password securely with the assignee — they sign in from the main login page.</p>
        {!token && <p className="operations-error">Your Operations session is missing. <Link to="/insurance/operations/login">Sign in again</Link>.</p>}
        <form className="operations-form" onSubmit={handleSubmit}>
          <label>Role
            <select value={form.role} onChange={e => setForm({ ...form, role: e.target.value })}>
              {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label>Full name (optional)<input value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>
          <label>Username<input required minLength={3} maxLength={64} pattern="[A-Za-z0-9._-]{3,64}" title="Use 3–64 letters, numbers, dots, underscores or hyphens" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
          <label>Password<input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          {form.role === 'state-team' && (
            <label>Assigned states (comma-separated)<input required placeholder="e.g. Kerala, Tamil Nadu" value={form.states} onChange={e => setForm({ ...form, states: e.target.value })} /></label>
          )}
          <button className="btn btn-primary" type="submit" disabled={saving || !token}>{saving ? 'Creating…' : 'Create User'}</button>
        </form>
        {error && <p className="operations-error" role="alert">{error}</p>}
        {success && <p className="operations-success" role="status">{success}</p>}
        {resetInfo && (
          <div className="operations-success" role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>New password for <strong>{resetInfo.username}</strong>:</span>
            <code style={{ padding: '0.2rem 0.5rem', background: '#f1f1f1', borderRadius: 4, fontSize: '0.95rem' }}>{resetInfo.password}</code>
            <button type="button" className="btn" onClick={copyPassword}>Copy</button>
            <span style={{ fontSize: '0.8rem', color: '#777' }}>Share it securely — it won't be shown again.</span>
          </div>
        )}
      </div>
    </div>
    <div className="panel">
      <div className="panel-header"><div className="panel-title">Users</div></div>
      <div className="panel-body">
        {loading ? <p>Loading…</p> : users.length === 0 ? <p>No users created yet.</p> :
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Role</th><th>States</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            {users.map(user => editing === user.sys_user_id ? (
              <tr key={user.sys_user_id || user.username}>
                <td><input value={edit.full_name} onChange={e => setEdit({ ...edit, full_name: e.target.value })} /></td>
                <td>{user.username}</td>
                <td>
                  <select value={edit.role} onChange={e => setEdit({ ...edit, role: e.target.value })}>
                    {ROLE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    {!ROLE_OPTIONS.some(o => o.value === edit.role) && <option value={edit.role}>{edit.role}</option>}
                  </select>
                </td>
                <td>{edit.role === 'state-team'
                  ? <input placeholder="e.g. Kerala" value={edit.states} onChange={e => setEdit({ ...edit, states: e.target.value })} />
                  : '—'}</td>
                <td>
                  <select value={edit.status} onChange={e => setEdit({ ...edit, status: e.target.value })}>
                    <option value="active">active</option>
                    <option value="inactive">inactive</option>
                  </select>
                </td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button type="button" className="btn btn-primary" disabled={saving} onClick={() => saveEdit(user.sys_user_id)}>Save</button>{' '}
                  <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                </td>
              </tr>
            ) : (
              <tr key={user.sys_user_id || user.username}>
                <td>{user.full_name}</td>
                <td>{user.username}</td>
                <td>{user.role}</td>
                <td>{(user.states || []).join(', ') || '—'}</td>
                <td>{user.status || 'active'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {user.sys_user_id ? <>
                    <button type="button" className="btn" onClick={() => startEdit(user)}>Edit</button>{' '}
                    <button type="button" className="btn" onClick={() => resetPassword(user)}>Reset password</button>
                  </> : <span style={{ color: '#999', fontSize: '0.8rem' }}>—</span>}
                </td>
              </tr>
            ))}
          </tbody></table></div>}
      </div>
    </div>
  </div>;
}
