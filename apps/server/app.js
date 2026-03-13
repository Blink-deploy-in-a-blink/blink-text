'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const keysRoutes = require('./routes/keys');
const devicesRoutes = require('./routes/devices');
const usersRoutes = require('./routes/users');
const { registerSocketHandlers } = require('./websocket');

const app = express();
const httpServer = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const PORT = parseInt(process.env.PORT || '3001', 10);

app.use(helmet());
app.use(cors({
  origin: CLIENT_ORIGIN,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));
app.use(rateLimit({
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests' },
}));
app.use(express.json({ limit: '64kb' }));

app.use('/api/auth', authRoutes);
app.use('/api/conversations', conversationRoutes);
app.use('/api/keys', keysRoutes);
app.use('/api/devices', devicesRoutes);
app.use('/api/users', usersRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const io = new Server(httpServer, {
  cors: { origin: CLIENT_ORIGIN, methods: ['GET', 'POST'], credentials: true },
});

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`Blink-Text server listening on port ${PORT}`);
});

module.exports = { app, httpServer };
