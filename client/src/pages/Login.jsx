import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth.jsx';
import { Alert, Field, btnPrimary, inputCls, fieldErrors } from '../ui.jsx';

export default function Login() {
  const { login, notice } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const s = await login(username, password);
      navigate(s.home, { replace: true }); // Owner -> Dashboard, Cashier -> POS Terminal
    } catch (err) {
      setError(err);
      setPassword(''); // always clear the password after a failure
    } finally {
      setBusy(false);
    }
  }

  const fe = fieldErrors(error);
  return (
    <div className="flex min-h-full items-center justify-center p-4">
      <form onSubmit={onSubmit} noValidate className="w-full max-w-sm space-y-4 rounded-xl border border-slate-200 bg-white p-8 shadow-sm">
        <div>
          <h1 className="text-2xl font-extrabold text-blue-800">BCD Restaurant POS</h1>
          <p className="text-sm text-slate-600">Sign in to continue</p>
        </div>
        {notice && <Alert kind="warn">{notice}</Alert>}
        {error && !error.fields && <Alert>{error.message}</Alert>}
        <Field id="username" label="Username" error={fe.username}>
          <input
            id="username"
            className={inputCls}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            aria-invalid={!!fe.username}
            aria-describedby={fe.username ? 'username-error' : undefined}
          />
        </Field>
        <Field id="password" label="Password" error={fe.password}>
          <input
            id="password"
            type="password"
            className={inputCls}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={!!fe.password}
            aria-describedby={fe.password ? 'password-error' : undefined}
          />
        </Field>
        <button type="submit" disabled={busy} className={`${btnPrimary} w-full`}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
