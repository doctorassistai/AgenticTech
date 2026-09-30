import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import './OperationsHeadAssignment.css';

const BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || '';

const SPECIALIZATIONS = [
  'General Medicine', 'Cardiology', 'Orthopedics', 'Neurology', 'Oncology',
  'Pediatrics', 'Gynecology', 'Radiology', 'Pathology', 'Other',
];

const EMPTY = {
  full_name: '', username: '', password: '', email: '', phone_number: '',
  specialization: '', qualification: '', registration_number: '', experience: '',
  date_of_joining: new Date().toISOString().slice(0, 10), probation_months: 3,
};

// Add N calendar months to a YYYY-MM-DD string, clamping the day — mirrors the
// backend so the form can preview the probation end date before submitting.
function addMonths(iso, months) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + Number(months || 0);
  const year = Math.floor(total / 12);
  const month = total % 12; // 0-based
  const lastDay = new Date(year, month + 1, 0).getDate();
  const day = Math.min(d, lastDay);
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

const STATUS_LABEL = {
  active: 'Active', extended: 'Extended', 'ended-early': 'Ended early', completed: 'Completed',
};

export default function DoctorManagement() {
  const [form, setForm] = useState(EMPTY);
  const [doctors, setDoctors] = useState([]);
  const [configMonths, setConfigMonths] = useState(3);
  const [configDraft, setConfigDraft] = useState(3);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [resetInfo, setResetInfo] = useState(null);
  const token = localStorage.getItem('operations_token');
  const authHeaders = { Authorization: `Bearer ${token || ''}` };

  async function loadConfig() {
    try {
      const res = await fetch(`${BASE_URL}/insurance/web/operations/config`, { headers: authHeaders });
      const data = await res.json();
      if (res.ok) {
        setConfigMonths(data.probation_months);
        setConfigDraft(data.probation_months);
        setForm(f => ({ ...f, probation_months: data.probation_months }));
      }
    } catch { /* keep defaults */ }
  }

  async function loadDoctors() {
    try {
      const res = await fetch(`${BASE_URL}/insurance/web/operations/doctors`, { headers: authHeaders });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Unable to load doctors');
      setDoctors(data.doctors || []);
    } catch (err) {
      setError(err.message || 'Unable to load doctors');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (token) { loadConfig(); loadDoctors(); }
    else setLoading(false);
  }, [token]);

  async function saveConfig() {
    setError(''); setSuccess('');
    try {
      const res = await fetch(`${BASE_URL}/insurance/web/operations/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify({ probation_months: Number(configDraft) }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Unable to save config');
      setConfigMonths(data.probation_months);
      setSuccess(`Default probation set to ${data.probation_months} month(s).`);
    } catch (err) {
      setError(err.message || 'Unable to save config');
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setSaving(true); setError(''); setSuccess(''); setResetInfo(null);
    try {
      const payload = {
        full_name: form.full_name.trim() || null,
        username: form.username.trim(),
        password: form.password,
        email: form.email.trim() || null,
        phone_number: form.phone_number.trim() || null,
        specialization: form.specialization || null,
        qualification: form.qualification.trim() || null,
        registration_number: form.registration_number.trim() || null,
        experience: form.experience.toString().trim() || null,
        date_of_joining: form.date_of_joining,
        probation_months: Number(form.probation_months),
      };
      const res = await fetch(`${BASE_URL}/insurance/web/operations/doctors`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Unable to register doctor');
      setSuccess(`Doctor ${data.username} registered. Probation ends ${data.probation_end}.`);
      setForm({ ...EMPTY, probation_months: configMonths, date_of_joining: form.date_of_joining });
      await loadDoctors();
    } catch (err) {
      setError(err.message || 'Unable to register doctor');
    } finally {
      setSaving(false);
    }
  }

  async function resetPassword(doctor) {
    setError(''); setSuccess(''); setResetInfo(null);
    if (!window.confirm(`Reset password for ${doctor.username}?`)) return;
    try {
      const res = await fetch(`${BASE_URL}/insurance/web/operations/doctors/${doctor.id}/reset-password`, {
        method: 'POST', headers: authHeaders,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Unable to reset password');
      setResetInfo({ username: data.username, password: data.password });
    } catch (err) {
      setError(err.message || 'Unable to reset password');
    }
  }

  async function probationAction(doctor, action) {
    setError(''); setSuccess('');
    let body = { action };
    if (action === 'set-duration') {
      const input = window.prompt('New probation duration in months (1–36):', doctor.probation_months || configMonths);
      if (input === null) return;
      body.months = Number(input);
    } else if (action === 'extend') {
      const input = window.prompt('Extend probation by how many months?', '1');
      if (input === null) return;
      body.months = Number(input);
    } else if (action === 'end-early') {
      if (!window.confirm(`End ${doctor.full_name}'s probation early (effective today)?`)) return;
    }
    try {
      const res = await fetch(`${BASE_URL}/insurance/web/operations/doctors/${doctor.id}/probation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Unable to update probation');
      setSuccess(`Probation updated — ends ${data.probation_end} (${STATUS_LABEL[data.probation_status] || data.probation_status}).`);
      await loadDoctors();
    } catch (err) {
      setError(err.message || 'Unable to update probation');
    }
  }

  function copyPassword() {
    if (resetInfo?.password) navigator.clipboard?.writeText(resetInfo.password);
  }

  const previewEnd = addMonths(form.date_of_joining, form.probation_months);

  return <div className="operations-assignment">
    <div className="panel">
      <div className="panel-header"><div className="panel-title">Register Doctor</div></div>
      <div className="panel-body">
        <p className="operations-intro">Register an auditing doctor. Probation is auto-calculated from the date of joining using the default below (editable per doctor after registration).</p>
        {!token && <p className="operations-error">Your Operations session is missing. <Link to="/insurance/operations/login">Sign in again</Link>.</p>}

        <div className="operations-form" style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <label style={{ margin: 0 }}>Default probation (months)
            <input type="number" min={1} max={36} value={configDraft} onChange={e => setConfigDraft(e.target.value)} />
          </label>
          <button type="button" className="btn" onClick={saveConfig} disabled={!token}>Save default</button>
          <span style={{ fontSize: '0.8rem', color: '#777' }}>Current default: {configMonths} month(s)</span>
        </div>

        <form className="operations-form" onSubmit={handleSubmit}>
          <label>Full name<input required value={form.full_name} onChange={e => setForm({ ...form, full_name: e.target.value })} /></label>
          <label>Username<input required minLength={3} maxLength={64} pattern="[A-Za-z0-9._-]{3,64}" title="Use 3–64 letters, numbers, dots, underscores or hyphens" value={form.username} onChange={e => setForm({ ...form, username: e.target.value })} /></label>
          <label>Password<input type="password" required minLength={8} autoComplete="new-password" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })} /></label>
          <label>Email (optional)<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} /></label>
          <label>Mobile (optional)<input value={form.phone_number} onChange={e => setForm({ ...form, phone_number: e.target.value })} /></label>
          <label>Specialization
            <select value={form.specialization} onChange={e => setForm({ ...form, specialization: e.target.value })}>
              <option value="">Select…</option>
              {SPECIALIZATIONS.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label>Qualification<input placeholder="e.g. MBBS, MD" value={form.qualification} onChange={e => setForm({ ...form, qualification: e.target.value })} /></label>
          <label>Registration number<input value={form.registration_number} onChange={e => setForm({ ...form, registration_number: e.target.value })} /></label>
          <label>Experience (years)<input type="number" min={0} value={form.experience} onChange={e => setForm({ ...form, experience: e.target.value })} /></label>
          <label>Date of joining<input type="date" required value={form.date_of_joining} onChange={e => setForm({ ...form, date_of_joining: e.target.value })} /></label>
          <label>Probation (months)<input type="number" min={1} max={36} required value={form.probation_months} onChange={e => setForm({ ...form, probation_months: e.target.value })} /></label>
          <p style={{ gridColumn: '1 / -1', margin: 0, fontSize: '0.85rem', color: '#555' }}>Probation ends: <strong>{previewEnd || '—'}</strong></p>
          <button className="btn btn-primary" type="submit" disabled={saving || !token}>{saving ? 'Registering…' : 'Register Doctor'}</button>
        </form>
        {error && <p className="operations-error" role="alert">{error}</p>}
        {success && <p className="operations-success" role="status">{success}</p>}
        {resetInfo && (
          <div className="operations-success" role="status" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            <span>New password for <strong>{resetInfo.username}</strong>:</span>
            <code style={{ padding: '0.2rem 0.5rem', background: '#f1f1f1', borderRadius: 4 }}>{resetInfo.password}</code>
            <button type="button" className="btn" onClick={copyPassword}>Copy</button>
            <span style={{ fontSize: '0.8rem', color: '#777' }}>Share it securely — it won't be shown again.</span>
          </div>
        )}
      </div>
    </div>

    <div className="panel">
      <div className="panel-header"><div className="panel-title">Doctors</div></div>
      <div className="panel-body">
        {loading ? <p>Loading…</p> : doctors.length === 0 ? <p>No doctors registered yet.</p> :
          <div className="table-wrap"><table><thead><tr>
            <th>Name</th><th>Username</th><th>Specialization</th><th>Joined</th><th>Probation ends</th><th>Probation</th><th>Status</th><th>Actions</th>
          </tr></thead><tbody>
            {doctors.map(doc => <tr key={doc.id}>
              <td>{doc.full_name}</td>
              <td>{doc.username}</td>
              <td>{doc.specialization || '—'}</td>
              <td>{doc.date_of_joining || '—'}</td>
              <td>{doc.probation_end || '—'}</td>
              <td>{STATUS_LABEL[doc.probation_status] || doc.probation_status}</td>
              <td>{doc.status || 'active'}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="btn" onClick={() => probationAction(doc, 'set-duration')}>Duration</button>{' '}
                <button type="button" className="btn" onClick={() => probationAction(doc, 'extend')}>Extend</button>{' '}
                <button type="button" className="btn" onClick={() => probationAction(doc, 'end-early')} disabled={doc.probation_status === 'ended-early'}>End early</button>{' '}
                <button type="button" className="btn" onClick={() => resetPassword(doc)}>Reset password</button>
              </td>
            </tr>)}
          </tbody></table></div>}
      </div>
    </div>
  </div>;
}
