'use strict';

require('dotenv').config();
const express = require('express');
const http = require('http');
const path = require('path');
const { Server } = require('socket.io');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const conversationRoutes = require('./routes/conversations');
const keysRoutes = require('./routes/keys');
const devicesRoutes = require('./routes/devices');
const usersRoutes = require('./routes/users');
const mediaRoutes = require('./routes/media');
const reportRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const { registerSocketHandlers } = require('./websocket');

const app = express();
const httpServer = http.createServer(app);

// Trust proxy so req.ip returns the real client IP behind reverse proxies
app.set('trust proxy', process.env.TRUST_PROXY || 'loopback');

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const PORT = parseInt(process.env.PORT || '3001', 10);

// ------------------------------------------------------------------
// CORS: accept Cloudflare domain, CLIENT_ORIGIN, and LAN IPs
// ------------------------------------------------------------------
function isAllowedOrigin(origin) {
  if (!origin) return true; // curl, mobile apps, same-origin
  if (origin === CLIENT_ORIGIN) return true;
  try {
    const url = new URL(origin);
    const ip = url.hostname;
    // localhost / loopback
    if (ip === 'localhost' || ip === '127.0.0.1') return true;
    // Private LAN ranges
    if (ip.startsWith('192.168.') || ip.startsWith('10.') ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return true;
    // If CLIENT_ORIGIN is a domain (e.g. https://blink.example.com),
    // also allow that exact domain
    const clientHost = new URL(CLIENT_ORIGIN).hostname;
    if (ip === clientHost || url.hostname === clientHost) return true;
  } catch {}
  return false;
}

app.use(helmet({
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
}));
app.use(cors({
  origin: (origin, cb) => {
    if (isAllowedOrigin(origin)) return cb(null, true);
    cb(new Error('Not allowed by CORS'));
  },
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
app.use('/api/media', mediaRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ------------------------------------------------------------------
// Serve the built web client in production (after `vite build`)
// ------------------------------------------------------------------
const clientDistPath = path.join(__dirname, '../web-client/dist');
app.use(express.static(clientDistPath));

// API 404 handler — only for /api routes
app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// SPA fallback — serve index.html for any non-API, non-file route
app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'), (err) => {
    if (err) res.status(404).json({ error: 'Not found' });
  });
});

app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (isAllowedOrigin(origin)) return cb(null, true);
      cb(new Error('Not allowed by CORS'));
    },
    methods: ['GET', 'POST'],
    credentials: true,
  },
});

// Make io accessible to routes via req.app.get('io')
app.set('io', io);

registerSocketHandlers(io);

httpServer.listen(PORT, () => {
  console.log(`Blink-Text server listening on port ${PORT}`);
});

module.exports = { app, httpServer };
