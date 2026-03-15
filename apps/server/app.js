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
const mediaRoutes = require('./routes/media');
const { registerSocketHandlers } = require('./websocket');

const app = express();
const httpServer = http.createServer(app);

const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
const PORT = parseInt(process.env.PORT || '3001', 10);

// Allow connections from localhost and any LAN IP
const allowedOrigins = [CLIENT_ORIGIN];
if (CLIENT_ORIGIN.includes('localhost')) {
  // Also accept requests from the machine's LAN IP
  allowedOrigins.push(CLIENT_ORIGIN.replace('localhost', '0.0.0.0'));
  // Dynamically allow any 192.168.x.x / 10.x.x.x / 172.x.x.x origin on the same port
}

app.use(helmet());
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (curl, mobile apps, etc.)
    if (!origin) return cb(null, true);
    // Allow any origin on the same port during development
    if (allowedOrigins.includes(origin)) return cb(null, true);
    // Allow any private-network origin (LAN)
    try {
      const url = new URL(origin);
      const ip = url.hostname;
      if (ip === 'localhost' || ip === '127.0.0.1' ||
          ip.startsWith('192.168.') || ip.startsWith('10.') ||
          /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
        return cb(null, true);
      }
    } catch {}
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

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

const io = new Server(httpServer, {
  cors: {
    origin: (origin, cb) => {
      if (!origin) return cb(null, true);
      try {
        const url = new URL(origin);
        const ip = url.hostname;
        if (ip === 'localhost' || ip === '127.0.0.1' ||
            ip.startsWith('192.168.') || ip.startsWith('10.') ||
            /^172\.(1[6-9]|2\d|3[01])\./.test(ip)) {
          return cb(null, true);
        }
      } catch {}
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
