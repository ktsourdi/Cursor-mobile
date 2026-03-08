'use strict';

const WebSocket = require('ws');
const { validateSession } = require('../auth/pairing');

const HEARTBEAT_INTERVAL_MS = 25000;

/**
 * Creates and configures the WebSocket server for real-time sync.
 */
function createWSServer(httpServer, db) {
  const wss = new WebSocket.Server({ server: httpServer, path: '/ws' });
  const clients = new Map(); // ws -> { device, alive }

  // Heartbeat to detect stale connections
  const heartbeatInterval = setInterval(() => {
    for (const [ws, meta] of clients.entries()) {
      if (!meta.alive) {
        ws.terminate();
        clients.delete(ws);
        continue;
      }
      meta.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });

  wss.on('connection', (ws, req) => {
    // Authenticate via query parameter or initial message
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    if (token) {
      const device = validateSession(db, token);
      if (!device) {
        ws.close(4001, 'Authentication failed');
        return;
      }
      clients.set(ws, { device, alive: true });
      ws.send(JSON.stringify({ type: 'connection.changed', data: { status: 'connected', device_id: device.id } }));
    } else {
      // Allow authentication via first message
      let authenticated = false;
      const authTimeout = setTimeout(() => {
        if (!authenticated) {
          ws.close(4001, 'Authentication timeout');
        }
      }, 10000);

      ws.once('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth' && msg.token) {
            const device = validateSession(db, msg.token);
            if (device) {
              authenticated = true;
              clearTimeout(authTimeout);
              clients.set(ws, { device, alive: true });
              ws.send(JSON.stringify({ type: 'connection.changed', data: { status: 'connected', device_id: device.id } }));
            } else {
              ws.close(4001, 'Authentication failed');
            }
          } else {
            ws.close(4001, 'Expected auth message');
          }
        } catch {
          ws.close(4002, 'Invalid message format');
        }
      });
    }

    ws.on('pong', () => {
      const meta = clients.get(ws);
      if (meta) meta.alive = true;
    });

    ws.on('close', () => {
      clients.delete(ws);
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  /**
   * Broadcasts a message to all connected, authenticated clients.
   * Optionally excludes a specific device.
   */
  function broadcast(message, { excludeDeviceId } = {}) {
    const payload = JSON.stringify(message);
    for (const [ws, meta] of clients.entries()) {
      if (ws.readyState === WebSocket.OPEN) {
        if (excludeDeviceId && meta.device && meta.device.id === excludeDeviceId) {
          continue;
        }
        ws.send(payload);
      }
    }
  }

  return { wss, broadcast, clients };
}

module.exports = { createWSServer };
