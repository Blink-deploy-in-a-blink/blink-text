import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:3001',
  withCredentials: true,
});

// Attach JWT token to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem('blink-token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

export const register = (username, password) =>
  api.post('/api/auth/register', { username, password }).then((r) => r.data);

export const login = (username, password) =>
  api.post('/api/auth/login', { username, password }).then((r) => r.data);

export const getConversations = () =>
  api.get('/api/conversations').then((r) => r.data.conversations);

export const createConversation = (type, participants, name) =>
  api.post('/api/conversations', { type, participants, name }).then((r) => r.data.conversation);

export const getMessages = (conversationId) =>
  api.get(`/api/conversations/${conversationId}/messages`).then((r) => r.data.messages);

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

export const changePassword = (currentPassword, newPassword) =>
  api.put('/api/auth/password', { currentPassword, newPassword }).then((r) => r.data);
