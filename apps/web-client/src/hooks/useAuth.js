import { useState, useCallback, useEffect } from 'react';
import { login as apiLogin, register as apiRegister } from '../services/api.js';
import { connectSocket, disconnectSocket } from '../services/socket.js';
import { initializeIdentity } from '../services/cryptoService.js';

/**
 * Auth state hook.
 * Manages the current user, JWT token, and socket connection lifecycle.
 */
export function useAuth() {
  const [user, setUser] = useState(() => {
    try {
      const raw = localStorage.getItem('blink-user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Re-initialize socket + crypto when restoring a session from localStorage
  useEffect(() => {
    if (!user) return;
    const token = localStorage.getItem('blink-token');
    if (token) {
      connectSocket(token);
      initializeIdentity().catch((err) =>
        console.error('Failed to restore crypto identity:', err)
      );
    }
  }, []); // run once on mount

  const _postLogin = useCallback(async (data) => {
    const { token, user: u } = data;
    localStorage.setItem('blink-token', token);
    localStorage.setItem('blink-user', JSON.stringify(u));
    setUser(u);

    // Connect socket and initialize crypto identity
    connectSocket(token);
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
    localStorage.removeItem('blink-token');
    localStorage.removeItem('blink-user');
    disconnectSocket();
    setUser(null);
  }, []);

  return { user, loading, error, login, register, logout };
}
