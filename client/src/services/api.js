import axios from 'axios';

const BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const api = axios.create({ baseURL: BASE_URL });

// Attach the auth token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('blink-text-token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ── Auth ──────────────────────────────────────────────────────────────────────

export const register = (username, password) =>
  api.post('/api/auth/register', { username, password }).then((r) => r.data);

export const login = (username, password) =>
  api.post('/api/auth/login', { username, password }).then((r) => r.data);

// ── Conversations ─────────────────────────────────────────────────────────────

export const getConversations = () =>
  api.get('/api/conversations').then((r) => r.data.conversations);

export const createConversation = (type, participants, name) =>
  api.post('/api/conversations', { type, participants, name }).then((r) => r.data.conversation);

export const getMessages = (conversationId) =>
  api.get(`/api/conversations/${conversationId}/messages`).then((r) => r.data.messages);

export const getParticipants = (conversationId) =>
  api.get(`/api/conversations/${conversationId}/participants`).then((r) => r.data.participants);

// ── Keys ──────────────────────────────────────────────────────────────────────

export const uploadPublicKeys = (identityPublicKey, ecdhPublicKey) =>
  api
    .post('/api/keys', { identity_public_key: identityPublicKey, public_key: ecdhPublicKey })
    .then((r) => r.data);

export const getUserKeys = (userId) =>
  api.get(`/api/keys/${userId}`).then((r) => r.data);

export const storeKeyExchange = (conversationId, ephemeralPublicKey) =>
  api
    .post('/api/keys/exchange', { conversation_id: conversationId, ephemeral_public_key: ephemeralPublicKey })
    .then((r) => r.data);

export const getKeyExchange = (conversationId) =>
  api.get(`/api/keys/exchange/${conversationId}`).then((r) => r.data.keyExchangeData);

export default api;
