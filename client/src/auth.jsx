import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { api, setCsrfToken, setUnauthorizedHandler } from './api.js';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);

const IDLE_LIMIT_MS = 30 * 60 * 1000; // mirrors the server's 30 minute idle timeout
const HEARTBEAT_MS = 60 * 1000; // report user activity at most once a minute

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, session: null, notice: '' });
  const lastBeat = useRef(0);
  const lastActivity = useRef(Date.now());

  const apply = useCallback((payload, notice = '') => {
    setCsrfToken(payload ? payload.csrfToken : null);
    setState({ loading: false, session: payload, notice });
  }, []);

  // Any 401 from the API (for example an expired session) sends the user back to login.
  useEffect(() => {
    setUnauthorizedHandler((err) => {
      apply(null, err.code === 'session_expired' ? 'Your session expired. Please sign in again.' : '');
    });
  }, [apply]);

  useEffect(() => {
    api
      .get('/api/auth/me')
      .then((p) => apply(p))
      .catch(() => apply(null));
  }, [apply]);

  const signedIn = !!state.session;

  // User activity (click or key press) is reported to the server at most once per minute.
  // Background polling never counts as activity.
  useEffect(() => {
    if (!signedIn) return undefined;
    const onActivity = () => {
      const now = Date.now();
      lastActivity.current = now;
      if (now - lastBeat.current > HEARTBEAT_MS) {
        lastBeat.current = now;
        api.post('/api/auth/activity').catch(() => {});
      }
    };
    window.addEventListener('click', onActivity);
    window.addEventListener('keydown', onActivity);
    // Idle check: ask the server (without touching the session) once the limit has passed,
    // so the login screen appears with an "expired" message even on a screen that never polls.
    const timer = setInterval(() => {
      if (Date.now() - lastActivity.current >= IDLE_LIMIT_MS) {
        api.get('/api/auth/me', { background: true }).catch(() => {});
      }
    }, 30 * 1000);
    return () => {
      window.removeEventListener('click', onActivity);
      window.removeEventListener('keydown', onActivity);
      clearInterval(timer);
    };
  }, [signedIn]);

  const login = useCallback(
    async (username, password) => {
      const payload = await api.post('/api/auth/login', { username, password });
      lastActivity.current = Date.now();
      apply(payload);
      return payload;
    },
    [apply]
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } finally {
      apply(null);
    }
  }, [apply]);

  const value = { ...state, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
