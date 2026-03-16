import axios from 'axios';

// In production (served from same origin), API is at /api on same host.
// In development (Vite proxy on 5173 → 3001), also use relative /api paths
// which Vite proxies to localhost:3001.
const baseURL = import.meta.env.VITE_API_URL ||
  (window.location.port === '5173'
    ? `${window.location.protocol}//${window.location.hostname}:3001`
    : window.location.origin);

const api = axios.create({
  baseURL,
  withCredentials: true,
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('blink-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Auto-logout on expired/invalid token (401 or 403 on authenticated routes)
let isLoggingOut = false;
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (
      !isLoggingOut &&
      error.response &&
      (error.response.status === 401 || error.response.status === 403) &&
      // Don't auto-logout on login/register failures
      !error.config.url?.includes('/api/auth/login') &&
      !error.config.url?.includes('/api/auth/register')
    ) {
      isLoggingOut = true;
      console.warn('[api] Token expired or invalid — clearing session');
      // Only clear session keys, NOT crypto keys (ephemeral keys, device ID)
      // so old messages can still be decrypted after re-login
      localStorage.removeItem('blink-token');
      localStorage.removeItem('blink-user');
      localStorage.removeItem('blink-active-conv');
      sessionStorage.removeItem('blink-session');
      // Reload to reset all state cleanly
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

export const register = (username, password) =>
  api.post('/api/auth/register', { username, password }).then((r) => r.data);

export const login = (username, password) =>
  api.post('/api/auth/login', { username, password }).then((r) => r.data);

export const getConversations = () =>
  api.get('/api/conversations').then((r) => r.data.conversations);

export const createConversation = (type, participants, name) =>
  api.post('/api/conversations', { type, participants, name }).then((r) => r.data.conversation);

export const getMessages = (conversationId, { limit, before } = {}) => {
  const params = {};
  if (limit) params.limit = limit;
  if (before) params.before = before;
  return api.get(`/api/conversations/${conversationId}/messages`, { params }).then((r) => r.data);
};

export const getParticipants = (conversationId) =>
  api.get(`/api/conversations/${conversationId}/participants`).then((r) => r.data.participants);

export const registerDevice = (identityPublicKey, ecdhPublicKey, deviceName) =>
  api.post('/api/devices', { identityPublicKey, ecdhPublicKey, deviceName }).then((r) => r.data.device);

export const getUserDevices = (userId) =>
  api.get(`/api/devices/${userId}`).then((r) => r.data.devices);

export const storeKeyExchange = (conversationId, deviceId, ephemeralPublicKey) =>
  api.post('/api/keys/exchange', { conversationId, deviceId, ephemeralPublicKey }).then((r) => r.data);

export const getKeyExchange = (conversationId) =>
  api.get(`/api/keys/exchange/${conversationId}`).then((r) => r.data.keyExchangeData);

export const searchUsers = (username) =>
  api.get('/api/users/search', { params: { q: username } }).then((r) => r.data.users);

export const deleteMessage = (conversationId, messageId, mode = 'for_me') =>
  api.delete(`/api/conversations/${conversationId}/messages/${messageId}`, { params: { mode } }).then((r) => r.data);

export const editMessage = (conversationId, messageId, payload) =>
  api.put(`/api/conversations/${conversationId}/messages/${messageId}`, { payload }).then((r) => r.data);

export const changePassword = (currentPassword, newPassword) =>
  api.put('/api/auth/password', { currentPassword, newPassword }).then((r) => r.data);

export const deleteAccount = (password, deleteConversations = false) =>
  api.delete('/api/auth/account', { data: { password, deleteConversations } }).then((r) => r.data);

export const refreshToken = () =>
  api.post('/api/auth/refresh').then((r) => r.data);

/**
 * Upload encrypted media binary to the server.
 * @param {string} conversationId
 * @param {Uint8Array} encryptedData - the encrypted binary data
 * @param {string} ivBase64 - base64-encoded IV
 * @returns {Promise<{ mediaId: string, fileSize: number }>}
 */
export const uploadMedia = (conversationId, encryptedData, ivBase64) => {
  const formData = new FormData();
  formData.append('conversationId', conversationId);
  formData.append('iv', ivBase64);
  formData.append('file', new Blob([encryptedData]), 'media.enc');
  return api.post('/api/media/upload', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    maxBodyLength: 110 * 1024 * 1024,
    maxContentLength: 110 * 1024 * 1024,
  }).then((r) => r.data);
};

/**
 * Download encrypted media binary from the server.
 * @param {string} mediaId
 * @returns {Promise<{ data: Uint8Array, iv: string, version: string }>}
 */
export const downloadMedia = async (mediaId) => {
  const response = await api.get(`/api/media/${mediaId}`, {
    responseType: 'arraybuffer',
  });
  return {
    data: new Uint8Array(response.data),
    iv: response.headers['x-media-iv'],
    version: response.headers['x-media-version'] || 'v1',
  };
};
