'use strict';

const http = require('http');
const express = require('express');
const path = require('path');
const { CompanionDB } = require('./db/database');
const { createRouter } = require('./api/routes');
const { createWSServer } = require('./ws/websocket');

const DEFAULT_PORT = 24842;

function createApp(options = {}) {
  const dbPath = options.dbPath || process.env.COMPANION_DB_PATH || path.join(process.cwd(), 'companion.db');
  const port = options.port != null
    ? options.port
    : (process.env.COMPANION_PORT ? parseInt(process.env.COMPANION_PORT, 10) : DEFAULT_PORT);
  const host = options.host || process.env.COMPANION_HOST || '0.0.0.0';

  // Initialize database
  const db = new CompanionDB(dbPath);
  db.open();

  // Create Express app
  const app = express();
  app.use(express.json());

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const log = `${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
      if (res.statusCode >= 400) {
        console.error(log);
      } else if (process.env.COMPANION_LOG_REQUESTS === 'true') {
        console.log(log);
      }
    });
    next();
  });

  // Create HTTP server
  const server = http.createServer(app);

  // Create WebSocket server
  const { wss, broadcast } = createWSServer(server, db);

  // Mount API routes
  const apiRouter = createRouter(db, { broadcast });
  app.use('/api', apiRouter);

  // Health check
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', uptime: process.uptime() });
  });

  function start() {
    return new Promise((resolve) => {
      server.listen(port, host, () => {
        const addr = server.address();
        console.log(`Cursor Mobile Companion server running on ${addr.address}:${addr.port}`);
        console.log(`Database: ${dbPath}`);
        console.log(`WebSocket: ws://${addr.address}:${addr.port}/ws`);
        console.log(`Health check: http://${addr.address}:${addr.port}/health`);
        resolve({ server, db, wss, app });
      });
    });
  }

  function stop() {
    return new Promise((resolve) => {
      wss.close();
      server.close(() => {
        db.close();
        resolve();
      });
    });
  }

  return { app, server, db, wss, broadcast, start, stop, port };
}

// Start server if run directly
if (require.main === module) {
  const app = createApp();
  app.start().then(() => {
    console.log('Ready to accept connections.');
  });

  // Graceful shutdown
  process.on('SIGINT', () => {
    console.log('\nShutting down...');
    app.stop().then(() => process.exit(0));
  });
  process.on('SIGTERM', () => {
    console.log('\nShutting down...');
    app.stop().then(() => process.exit(0));
  });
}

module.exports = { createApp, DEFAULT_PORT };
