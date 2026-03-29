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

// Attach JWT token to every request (registered user token OR guest token)
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('blink-token') || sessionStorage.getItem('blink-guest-token');
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
      !error.config.url?.includes('/api/auth/register') &&
      // Don't auto-logout when admin verify returns 403 (normal for non-admins)
      !(error.config.url?.includes('/api/admin/verify') && error.response.status === 403) &&
      // Don't auto-logout for guest sessions — they use sessionStorage, not localStorage
      !sessionStorage.getItem('blink-guest-token')
    ) {
      isLoggingOut = true;

      // Detect if the session was invalidated by a login on another device
      const isSessionExpired = error.response.data?.reason === 'session_expired';

      console.warn('[api] Token expired or invalid — clearing session');
      // Only clear session keys, NOT crypto keys (ephemeral keys, device ID)
      // so old messages can still be decrypted after re-login
      localStorage.removeItem('blink-token');
      localStorage.removeItem('blink-user');
      localStorage.removeItem('blink-active-conv');
      sessionStorage.removeItem('blink-session');

      if (isSessionExpired) {
        // Dispatch a custom event so App.jsx can show a styled popup
        window.dispatchEvent(new CustomEvent('blink-session-expired'));
      } else {
        // Normal expiry — just reload
        window.location.reload();
      }
    }
    return Promise.reject(error);
  }
);

export const getPowChallenge = () =>
  api.get('/api/auth/pow-challenge').then((r) => r.data);

export const register = (username, password, { powChallenge, powNonce, acceptedTerms } = {}) =>
  api.post('/api/auth/register', { username, password, powChallenge, powNonce, acceptedTerms }).then((r) => r.data);

export const login = (username, password) =>
  api.post('/api/auth/login', { username, password }).then((r) => r.data);

export const getConversations = () =>
  api.get('/api/conversations').then((r) => r.data.conversations);

export const createConversation = (type, participants, name, disappearAfter, groupOptions = {}) =>
  api.post('/api/conversations', { type, participants, name, disappearAfter, ...groupOptions }).then((r) => r.data.conversation);

export const getMessages = (conversationId, { limit, before } = {}) => {
  const params = {};
  if (limit) params.limit = limit;
  if (before) params.before = before;
  return api.get(`/api/conversations/${conversationId}/messages`, { params }).then((r) => r.data);
};

export const getParticipants = (conversationId) =>
  api.get(`/api/conversations/${conversationId}/participants`).then((r) => r.data.participants);

export const getConversationParticipantIds = (conversationId) =>
  getParticipants(conversationId).then((ps) => ps.map((p) => p.id));

export const registerDevice = (identityPublicKey, ecdhPublicKey, deviceName) =>
  api.post('/api/devices', { identityPublicKey, ecdhPublicKey, deviceName }).then((r) => r.data.device);

export const getUserDevices = (userId) =>
  api.get(`/api/devices/${userId}`).then((r) => r.data.devices);

export const storeKeyExchange = (conversationId, deviceId, ephemeralPublicKey) =>
  api.post('/api/keys/exchange', { conversationId, deviceId, ephemeralPublicKey }).then((r) => r.data);

export const getKeyExchange = (conversationId) =>
  api.get(`/api/keys/exchange/${conversationId}`).then((r) => r.data.keyExchangeData);

// Prekey bundle endpoints
export const uploadPrekeys = (deviceId, signedPrekey, oneTimePrekeys) =>
  api.post('/api/keys/prekeys', { deviceId, signedPrekey, oneTimePrekeys }).then((r) => r.data);

export const getPrekeyBundle = (userId) =>
  api.get(`/api/keys/prekeys/${userId}`).then((r) => r.data.bundle);

export const searchUsers = (username) =>
  api.get('/api/users/search', { params: { q: username } }).then((r) => r.data.users);

export const deleteMessage = (conversationId, messageId, mode = 'for_me') =>
  api.delete(`/api/conversations/${conversationId}/messages/${messageId}`, { params: { mode } }).then((r) => r.data);

export const editMessage = (conversationId, messageId, payload) =>
  api.put(`/api/conversations/${conversationId}/messages/${messageId}`, { payload }).then((r) => r.data);

export const changePassword = (currentPassword, newPassword) =>
  api.put('/api/auth/password', { currentPassword, newPassword }).then((r) => r.data);

export const changeUsername = (currentPassword, newUsername) =>
  api.put('/api/auth/username', { currentPassword, newUsername }).then((r) => r.data);

export const deleteAccount = (password, deleteConversations = false) =>
  api.delete('/api/auth/account', { data: { password, deleteConversations } }).then((r) => r.data);

export const refreshToken = () =>
  api.post('/api/auth/refresh').then((r) => r.data);

export const submitReport = (reportedUserId, reason, { conversationId, messageId, details } = {}) =>
  api.post('/api/reports', { reportedUserId, reason, conversationId, messageId, details }).then((r) => r.data);

// Admin API — all these endpoints are protected server-side by requireAdmin middleware.
// The client discovers admin status ONLY via verifyAdmin(), which hits the DB on every call.
// Admin status is NEVER sent in auth responses or stored in localStorage.

/**
 * Check if the current user is an admin. Hits the server DB directly.
 * Returns true if admin, false if not (403 response = not admin).
 * This is the ONLY source of truth for admin status on the client.
 */
export const verifyAdmin = async () => {
  try {
    await api.get('/api/admin/verify');
    return true;
  } catch {
    return false;
  }
};

export const getAdminStats = () =>
  api.get('/api/admin/stats').then((r) => r.data);

export const getAdminReports = ({ status, page, limit } = {}) => {
  const params = {};
  if (status) params.status = status;
  if (page) params.page = page;
  if (limit) params.limit = limit;
  return api.get('/api/admin/reports', { params }).then((r) => r.data);
};

export const updateReport = (reportId, status) =>
  api.put(`/api/admin/reports/${reportId}`, { status }).then((r) => r.data);

export const getAdminUsers = ({ search, filter, page, limit } = {}) => {
  const params = {};
  if (search) params.search = search;
  if (filter) params.filter = filter;
  if (page) params.page = page;
  if (limit) params.limit = limit;
  return api.get('/api/admin/users', { params }).then((r) => r.data);
};

export const banUser = (userId) =>
  api.post(`/api/admin/ban/${userId}`).then((r) => r.data);

export const unbanUser = (userId) =>
  api.post(`/api/admin/unban/${userId}`).then((r) => r.data);

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

// ── Block / Unblock ──

export const blockUser = (userId) =>
  api.post(`/api/blocks/${userId}`).then((r) => r.data);

export const unblockUser = (userId) =>
  api.delete(`/api/blocks/${userId}`).then((r) => r.data);

export const getBlocks = () =>
  api.get('/api/blocks').then((r) => r.data.blocks);

export const checkBlocked = (userId) =>
  api.get(`/api/blocks/check/${userId}`).then((r) => r.data.blocked);

// ── Clear chat ──

export const clearChat = (conversationId) =>
  api.delete(`/api/conversations/${conversationId}/clear`).then((r) => r.data);

// ── Disappearing messages ──

/**
 * Update the disappearing message timer for a conversation.
 * @param {string} conversationId
 * @param {number|null} disappearAfter — duration in ms, or null to disable
 * @returns {Promise<{ updated: boolean, disappearAfter: number|null, systemMessage: string }>}
 */
export const updateConversationTimer = (conversationId, disappearAfter) =>
  api.put(`/api/conversations/${conversationId}/disappear`, { disappearAfter }).then((r) => r.data);

// ── Nuke chat ──

/**
 * Permanently delete ALL messages and media from a conversation for both participants.
 * This is irreversible.
 * @param {string} conversationId
 * @returns {Promise<{ nuked: boolean, messagesDeleted: number, mediaDeleted: number }>}
 */
export const nukeChat = (conversationId) =>
  api.delete(`/api/conversations/${conversationId}/nuke`).then((r) => r.data);

// ── Group sender keys ──

export const getSenderKeys = (conversationId) =>
  api.get(`/api/group-keys/${conversationId}`).then((r) => r.data);

export const storeSenderKeys = (conversationId, keys) =>
  api.post(`/api/group-keys/${conversationId}`, { keys }).then((r) => r.data);

export const deleteSenderKeys = (conversationId, senderUserId) =>
  api.delete(`/api/group-keys/${conversationId}/${senderUserId}`).then((r) => r.data);

// ── Group pairwise keys (ECDH key exchange for sender key wrapping) ──

export const publishPairwiseKey = (conversationId, peerUserId, ephemeralPublicKey) =>
  api.post(`/api/group-keys/${conversationId}/pairwise`, { peerUserId, ephemeralPublicKey }).then((r) => r.data);

export const getPairwiseKeys = (conversationId) =>
  api.get(`/api/group-keys/${conversationId}/pairwise`).then((r) => r.data);

// ── Invite / Room management ──

export const getConversationBySlug = (slug) =>
  api.get(`/api/conversations/join/${slug}`).then((r) => r.data);

export const updateInviteSettings = (conversationId, enabled) =>
  api.put(`/api/conversations/${conversationId}/invite`, { enabled }).then((r) => r.data);

export const updateConversationSettings = (conversationId, settings) =>
  api.put(`/api/conversations/${conversationId}/settings`, settings).then((r) => r.data);

export const kickMember = (conversationId, userId) =>
  api.post(`/api/conversations/${conversationId}/kick`, { userId }).then((r) => r.data);
