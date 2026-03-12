import { useState, useCallback } from 'react';
import { login as apiLogin, register as apiRegister } from '../services/api.js';
import { connect, disconnect } from '../services/socket.js';
import { initializeIdentity } from '../services/cryptoService.js';

/**
 * Auth state hook.
 * Manages the current user, JWT token, and socket connection lifecycle.
 */
export function useAuth() {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('blink-text-user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const _postLogin = useCallback(async (data) => {
    const { token, user: u } = data;
    localStorage.setItem('blink-text-token', token);
    localStorage.setItem('blink-text-user', JSON.stringify(u));
    setUser(u);

    // Connect socket and initialize crypto identity
    connect(token);
    await initializeIdentity();
  }, []);

  const login = useCallback(
    async (username, password) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiLogin(username, password);
        await _postLogin(data);
      } catch (err) {
        const msg = err.response?.data?.error || 'Login failed';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [_postLogin]
  );

  const register = useCallback(
    async (username, password) => {
      setLoading(true);
      setError(null);
      try {
        const data = await apiRegister(username, password);
        await _postLogin(data);
      } catch (err) {
        const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Registration failed';
        setError(msg);
        throw new Error(msg);
      } finally {
        setLoading(false);
      }
    },
    [_postLogin]
  );

  const logout = useCallback(() => {
    localStorage.removeItem('blink-text-token');
    localStorage.removeItem('blink-text-user');
    disconnect();
    setUser(null);
  }, []);

  return { user, loading, error, login, register, logout };
}
