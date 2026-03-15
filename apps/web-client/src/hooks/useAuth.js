import { useState, useCallback, useEffect } from 'react';
import { login as apiLogin, register as apiRegister } from '../services/api.js';
import { connectSocket, disconnectSocket } from '../services/socket.js';
import { initializeIdentity, clearAllCryptoKeys } from '../services/cryptoService.js';

/**
 * Auth state hook.
 * Manages the current user, JWT token, and socket connection lifecycle.
 */
/**
 * Remove all blink-related data from localStorage (ephemeral keys, device id, etc.)
 */
import { clearCache as clearMessageCache } from '../services/messageCache.js';

function clearBlinkLocalStorage() {
  // Clear session keys but preserve crypto keys (ephemeral keys, device ID)
  // so old messages can still be decrypted if the user logs back in
  localStorage.removeItem('blink-token');
  localStorage.removeItem('blink-user');
  localStorage.removeItem('blink-active-conv');
}

function clearAllBlinkData() {
  // Full wipe — used on explicit logout or account deletion
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('blink-')) keysToRemove.push(key);
  }
  keysToRemove.forEach((k) => localStorage.removeItem(k));
}

export function useAuth() {
  const [user, setUser] = useState(() => {
    try {
      // If sessionStorage sentinel is missing, the previous tab was closed → clear session
      if (!sessionStorage.getItem('blink-session')) {
        clearBlinkLocalStorage();
        return null;
      }
      const raw = localStorage.getItem('blink-user');
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [ready, setReady] = useState(false);

  // Re-initialize socket + crypto when restoring a session from localStorage
  useEffect(() => {
    if (!user) { setReady(true); return; }
    const token = localStorage.getItem('blink-token');
    if (token) {
      sessionStorage.setItem('blink-session', '1'); // keep sentinel alive across refreshes
      connectSocket(token);
      initializeIdentity()
        .then(() => setReady(true))
        .catch((err) => {
          console.error('Failed to restore crypto identity:', err);
          setReady(true);
        });
    } else {
      setReady(true);
    }
  }, []); // run once on mount

  const _postLogin = useCallback(async (data) => {
    const { token, user: u } = data;
    localStorage.setItem('blink-token', token);
    localStorage.setItem('blink-user', JSON.stringify(u));
    sessionStorage.setItem('blink-session', '1'); // sentinel: cleared when tab closes

    // Connect socket and initialize crypto identity BEFORE setting user,
    // so MessengerView doesn't render until identity is ready.
    connectSocket(token);
    await initializeIdentity();
    setUser(u);
    setReady(true);
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

  const logout = useCallback(async () => {
    clearAllBlinkData();
    clearMessageCache();
    await clearAllCryptoKeys();
    sessionStorage.removeItem('blink-session');
    disconnectSocket();
    setUser(null);
    setReady(true);
  }, []);

  return { user, loading, error, login, register, logout, ready };
}
