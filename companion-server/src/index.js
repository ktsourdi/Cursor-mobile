'use strict';

const http = require('http');
const express = require('express');
const path = require('path');
const { CompanionDB } = require('./db/database');
const { createRouter } = require('./api/routes');
const { createWSServer } = require('./ws/websocket');

const DEFAULT_PORT = 24842;

function createApp(options = {}) {
  const dbPath = options.dbPath || path.join(process.cwd(), 'companion.db');
  const port = options.port != null ? options.port : DEFAULT_PORT;

  // Initialize database
  const db = new CompanionDB(dbPath);
  db.open();

  // Create Express app
  const app = express();
  app.use(express.json());

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
      server.listen(port, () => {
        console.log(`Cursor Mobile Companion server running on port ${port}`);
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
    console.log(`Server started on port ${app.port}`);
  });
}

module.exports = { createApp, DEFAULT_PORT };
