import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './MDLogin.css';

export default function MDLogin({ operations = false }) {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const BASE_URL = import.meta.env.VITE_BACKEND_URL?.replace(/\/$/, '') || '';

  async function handleSubmit(event) {
    event.preventDefault();
    setError('');
    setLoading(true);
    try {
      const response = await fetch(`${BASE_URL}/insurance/web/${operations ? 'operations' : 'md'}/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.detail || 'Unable to sign in');
      if (!data.access_token) throw new Error('Unable to sign in');
      localStorage.setItem(operations ? 'operations_token' : 'md_token', data.access_token);
      localStorage.setItem(operations ? 'operations_name' : 'md_name', data.full_name || (operations ? 'Operations Head' : 'Managing Director'));
      if (operations) {
        localStorage.setItem('role', data.role);
        localStorage.setItem('user_id', data.user_id);
        localStorage.setItem('full_name', data.full_name || 'Operations Head');
      }
      navigate(operations ? '/insurance/operations/dashboard' : '/insurance/md/dashboard', { replace: true });
    } catch (err) {
      setError(err.message || 'Unable to sign in');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="md-login-page">
      <section className="md-login-card" aria-labelledby="md-login-title">
        <div className="md-login-brand">Verifin <span>{operations ? 'Operations Portal' : 'Executive Portal'}</span></div>
        <div className="md-login-eyebrow">{operations ? 'OPERATIONS HEAD' : 'MANAGING DIRECTOR'}</div>
        <h1 id="md-login-title">Sign in to your dashboard</h1>
        <p>{operations ? 'View operations analytics and manage the verification workflow.' : 'View organization-wide case analytics and performance.'}</p>
        <form onSubmit={handleSubmit}>
          <label htmlFor="md-username">Username or email</label>
          <input id="md-username" name="username" autoComplete="username" required value={username} onChange={e => setUsername(e.target.value)} />
          <label htmlFor="md-password">Password</label>
          <input id="md-password" name="password" type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)} />
          {error && <div className="md-login-error" role="alert">{error}</div>}
          <button type="submit" disabled={loading}>{loading ? 'Signing in…' : 'Sign in'}</button>
        </form>
      </section>
    </main>
  );
}
