'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const WebSocket = require('ws');
const { createApp } = require('../src/index');

function createTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-ws-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const app = createApp({ dbPath, port: 0 });
  return { app, tmpDir };
}

function request(server, method, urlPath, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json', ...headers }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data), headers: res.headers });
        } catch {
          resolve({ status: res.statusCode, body: data, headers: res.headers });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function pairDevice(server) {
  const pairRes = await request(server, 'POST', '/api/pair/start', {
    device_name: 'Test iPhone', platform: 'iphone'
  });
  const confirmRes = await request(server, 'POST', '/api/pair/confirm', {
    device_id: pairRes.body.device_id,
    pairing_token: pairRes.body.pairing_token
  });
  return { token: confirmRes.body.session_token, device_id: pairRes.body.device_id };
}

function connectWS(server, token) {
  const addr = server.address();
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws?token=${token}`);
    // Buffer messages received before anyone starts listening
    const messageQueue = [];
    ws._messageQueue = messageQueue;
    ws.on('message', (data) => {
      messageQueue.push(JSON.parse(data.toString()));
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, timeout = 3000) {
  // Check buffered messages first
  if (ws._messageQueue && ws._messageQueue.length > 0) {
    return Promise.resolve(ws._messageQueue.shift());
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      clearInterval(interval);
      reject(new Error('Timeout waiting for WS message'));
    }, timeout);
    const check = () => {
      if (ws._messageQueue && ws._messageQueue.length > 0) {
        clearTimeout(timer);
        clearInterval(interval);
        resolve(ws._messageQueue.shift());
      }
    };
    const interval = setInterval(check, 10);
  });
}

describe('WebSocket real-time sync', () => {
  let app, tmpDir, server;
  const openSockets = [];

  beforeEach(async () => {
    ({ app, tmpDir } = createTestApp());
    const started = await app.start();
    server = started.server;
    openSockets.length = 0;
  });

  afterEach(async () => {
    // Close all open WebSocket connections first
    for (const ws of openSockets) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.terminate();
      }
    }
    await app.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should authenticate via query parameter token', async () => {
    const { token } = await pairDevice(server);
    const ws = await connectWS(server, token);
    openSockets.push(ws);
    const msg = await waitForMessage(ws);

    assert.equal(msg.type, 'connection.changed');
    assert.equal(msg.data.status, 'connected');
  });

  it('should reject invalid token', async () => {
    const addr = server.address();
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws?token=invalid-token`);
    openSockets.push(ws);

    await new Promise((resolve) => {
      ws.on('close', (code) => {
        assert.equal(code, 4001);
        resolve();
      });
    });
  });

  it('should authenticate via initial auth message', async () => {
    const { token } = await pairDevice(server);
    const addr = server.address();

    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/ws`);
    openSockets.push(ws);
    // Buffer messages
    const messageQueue = [];
    ws._messageQueue = messageQueue;
    ws.on('message', (data) => {
      messageQueue.push(JSON.parse(data.toString()));
    });
    await new Promise((resolve) => ws.on('open', resolve));

    // Send auth message
    ws.send(JSON.stringify({ type: 'auth', token }));
    const msg = await waitForMessage(ws);

    assert.equal(msg.type, 'connection.changed');
    assert.equal(msg.data.status, 'connected');
  });

  it('should broadcast message.created to connected clients', async () => {
    const { token } = await pairDevice(server);
    const ws = await connectWS(server, token);
    openSockets.push(ws);

    // Consume the connection.changed message
    await waitForMessage(ws);

    // Create a project and thread first
    const projRes = await request(server, 'POST', '/api/projects', {
      name: 'WS Test', local_path: '/tmp/ws-test'
    }, { 'Authorization': `Bearer ${token}` });

    // Consume project.updated
    await waitForMessage(ws);

    const threadRes = await request(server, 'POST', '/api/threads', {
      project_id: projRes.body.id, title: 'WS Thread'
    }, { 'Authorization': `Bearer ${token}` });

    // Consume thread.updated
    await waitForMessage(ws);

    // Now send a message
    await request(server, 'POST', '/api/messages', {
      thread_id: threadRes.body.id, role: 'user', body: 'Hello via WS!'
    }, { 'Authorization': `Bearer ${token}` });

    // Should receive message.created broadcast
    const msg = await waitForMessage(ws);
    assert.equal(msg.type, 'message.created');
    assert.equal(msg.data.body, 'Hello via WS!');
  });

  it('should broadcast message.acked to connected clients', async () => {
    const { token } = await pairDevice(server);
    const ws = await connectWS(server, token);
    openSockets.push(ws);

    // Consume connection.changed
    await waitForMessage(ws);

    const projRes = await request(server, 'POST', '/api/projects', {
      name: 'Ack Test', local_path: '/tmp/ack-test'
    }, { 'Authorization': `Bearer ${token}` });
    await waitForMessage(ws); // project.updated

    const threadRes = await request(server, 'POST', '/api/threads', {
      project_id: projRes.body.id, title: 'Ack Thread'
    }, { 'Authorization': `Bearer ${token}` });
    await waitForMessage(ws); // thread.updated

    const msgRes = await request(server, 'POST', '/api/messages', {
      thread_id: threadRes.body.id, role: 'user', body: 'Need ack'
    }, { 'Authorization': `Bearer ${token}` });
    await waitForMessage(ws); // message.created

    // Acknowledge the message
    await request(server, 'POST', '/api/ack', {
      message_id: msgRes.body.id
    }, { 'Authorization': `Bearer ${token}` });

    const ackMsg = await waitForMessage(ws);
    assert.equal(ackMsg.type, 'message.acked');
    assert.equal(ackMsg.data.state, 'acked');
  });
});
