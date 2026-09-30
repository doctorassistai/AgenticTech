import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './OperationsHeadAssignment.css';

const BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || '';

export default function OperationsHeadAssignment() {
  const [form, setForm] = useState({ full_name: '', username: '', email: '', password: '' });
  const [users, setUsers] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const token = localStorage.getItem('md_token');

  async function loadUsers() {
    try {
      const response = await fetch(`${BASE_URL}/insurance/web/md/operations-heads`, {
        headers: { Authorization: `Bearer ${token || ''}` },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to load Operations Heads');
      setUsers(data.users || []);
    } catch (err) {
      setError(err.message || 'Unable to load Operations Heads');
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
      const response = await fetch(`${BASE_URL}/insurance/web/md/operations-heads`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token || ''}` },
        body: JSON.stringify({
          full_name: form.full_name.trim(),
          username: form.username.trim(),
          email: form.email.trim() || null,
          password: form.password,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to assign Operations Head');
      setSuccess(`Operations Head ${data.username} has been assigned.`);
      setForm({ full_name: '', username: '', email: '', password: '' });
      await loadUsers();
    } catch (err) {
      setError(err.message || 'Unable to assign Operations Head');
    } finally {
      setSaving(false);
    }
  }

  return <div className="operations-assignment">
    <div className="panel">
      <div className="panel-header"><div className="panel-title">Assign Operations Head</div></div>
      <div className="panel-body">
        <p className="operations-intro">Create an Operations Head account. Share the username and password securely with the assignee.</p>
        {!token && <p className="operations-error">Your MD session is missing. <Link to="/insurance/md/login">Sign in again</Link>.</p>}
        <form className="operations-form" onSubmit={handleSubmit}>
          <label>Full name<input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>
          <label>Username<input required minLength={3} maxLength={64} pattern="[A-Za-z0-9._-]{3,64}" title="Use 3–64 letters, numbers, dots, underscores or hyphens" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
          <label>Email (optional)<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label>Initial password<input type="password" required minLength={12} autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          <button className="btn btn-primary" type="submit" disabled={saving || !token}>{saving ? 'Assigning…' : 'Assign Operations Head'}</button>
        </form>
        {error && <p className="operations-error" role="alert">{error}</p>}
        {success && <p className="operations-success" role="status">{success} <Link to="/insurance/operations/login">Open Operations Head login</Link></p>}
      </div>
    </div>
    <div className="panel">
      <div className="panel-header"><div className="panel-title">Operations Heads</div></div>
      <div className="panel-body">
        {loading ? <p>Loading…</p> : users.length === 0 ? <p>No Operations Head assigned yet.</p> :
          <div className="table-wrap"><table><thead><tr><th>Name</th><th>Username</th><th>Email</th><th>Status</th></tr></thead><tbody>
            {users.map(user => <tr key={user.username}><td>{user.full_name}</td><td>{user.username}</td><td>{user.email || '—'}</td><td>{user.status || 'active'}</td></tr>)}
          </tbody></table></div>}
      </div>
    </div>
  </div>;
}
