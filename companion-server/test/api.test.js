'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { createApp } = require('../src/index');

function createTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-api-test-'));
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
  return confirmRes.body.session_token;
}

describe('API Routes', () => {
  let app, tmpDir, server;

  beforeEach(async () => {
    ({ app, tmpDir } = createTestApp());
    const started = await app.start();
    server = started.server;
  });

  afterEach(async () => {
    await app.stop();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Health check', () => {
    it('GET /health should return ok', async () => {
      const res = await request(server, 'GET', '/health');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
    });
  });

  describe('Status', () => {
    it('GET /api/status should return server status', async () => {
      const res = await request(server, 'GET', '/api/status');
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'ok');
      assert.equal(res.body.version, '1.0.0');
    });

    it('GET /api/status should reflect paired device count', async () => {
      // Pair a device
      await pairDevice(server);

      const res = await request(server, 'GET', '/api/status');
      assert.equal(res.status, 200);
      assert.equal(res.body.connected_devices, 1);
    });
  });

  describe('Pairing', () => {
    it('POST /api/pair/start should create a pairing request', async () => {
      const res = await request(server, 'POST', '/api/pair/start', {
        device_name: 'iPhone 15', platform: 'iphone'
      });
      assert.equal(res.status, 201);
      assert.ok(res.body.device_id);
      assert.ok(res.body.pairing_token);
      assert.ok(res.body.expires_at);
    });

    it('POST /api/pair/start should reject missing fields', async () => {
      const res = await request(server, 'POST', '/api/pair/start', {});
      assert.equal(res.status, 400);
    });

    it('POST /api/pair/start should reject invalid platform', async () => {
      const res = await request(server, 'POST', '/api/pair/start', {
        device_name: 'Phone', platform: 'android'
      });
      assert.equal(res.status, 400);
    });

    it('POST /api/pair/confirm should issue session token', async () => {
      const pairRes = await request(server, 'POST', '/api/pair/start', {
        device_name: 'iPhone 15', platform: 'iphone'
      });
      const confirmRes = await request(server, 'POST', '/api/pair/confirm', {
        device_id: pairRes.body.device_id,
        pairing_token: pairRes.body.pairing_token
      });
      assert.equal(confirmRes.status, 200);
      assert.ok(confirmRes.body.session_token);
    });

    it('POST /api/pair/confirm should reject wrong token', async () => {
      const pairRes = await request(server, 'POST', '/api/pair/start', {
        device_name: 'iPhone 15', platform: 'iphone'
      });
      const confirmRes = await request(server, 'POST', '/api/pair/confirm', {
        device_id: pairRes.body.device_id,
        pairing_token: 'wrong'
      });
      assert.equal(confirmRes.status, 400);
    });
  });

  describe('Authentication', () => {
    it('should reject unauthenticated requests', async () => {
      const res = await request(server, 'GET', '/api/projects');
      assert.equal(res.status, 401);
    });

    it('should reject invalid bearer tokens', async () => {
      const res = await request(server, 'GET', '/api/projects', null, {
        'Authorization': 'Bearer invalid-token'
      });
      assert.equal(res.status, 401);
    });
  });

  describe('Projects (authenticated)', () => {
    let token;

    beforeEach(async () => {
      token = await pairDevice(server);
    });

    it('GET /api/projects should return empty list', async () => {
      const res = await request(server, 'GET', '/api/projects', null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });

    it('POST /api/projects should create a project', async () => {
      const res = await request(server, 'POST', '/api/projects', {
        name: 'MyApp', local_path: '/Users/dev/myapp'
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(res.status, 201);
      assert.equal(res.body.name, 'MyApp');
    });

    it('POST /api/projects should reject missing fields', async () => {
      const res = await request(server, 'POST', '/api/projects', {}, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 400);
    });

    it('GET /api/projects/:id should return project', async () => {
      const createRes = await request(server, 'POST', '/api/projects', {
        name: 'MyApp', local_path: '/Users/dev/myapp'
      }, { 'Authorization': `Bearer ${token}` });

      const res = await request(server, 'GET', `/api/projects/${createRes.body.id}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'MyApp');
    });
  });

  describe('Threads (authenticated)', () => {
    let token, projectId;

    beforeEach(async () => {
      token = await pairDevice(server);
      const projRes = await request(server, 'POST', '/api/projects', {
        name: 'MyApp', local_path: '/Users/dev/myapp'
      }, { 'Authorization': `Bearer ${token}` });
      projectId = projRes.body.id;
    });

    it('GET /api/threads should return threads for a project', async () => {
      const res = await request(server, 'GET', `/api/threads?project_id=${projectId}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
    });

    it('POST /api/threads should create a thread', async () => {
      const res = await request(server, 'POST', '/api/threads', {
        project_id: projectId, title: 'New conversation'
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(res.status, 201);
      assert.equal(res.body.title, 'New conversation');
      assert.equal(res.body.project_id, projectId);
    });

    it('GET /api/threads should require project_id', async () => {
      const res = await request(server, 'GET', '/api/threads', null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 400);
    });

    it('GET /api/threads/:id should return a single thread', async () => {
      const createRes = await request(server, 'POST', '/api/threads', {
        project_id: projectId, title: 'Single thread test'
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(createRes.status, 201);

      const res = await request(server, 'GET', `/api/threads/${createRes.body.id}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.title, 'Single thread test');
      assert.equal(res.body.id, createRes.body.id);
    });

    it('GET /api/threads/:id should return 404 for non-existent thread', async () => {
      const res = await request(server, 'GET', '/api/threads/nonexistent-id', null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 404);
    });
  });

  describe('Messages (authenticated)', () => {
    let token, projectId, threadId;

    beforeEach(async () => {
      token = await pairDevice(server);
      const projRes = await request(server, 'POST', '/api/projects', {
        name: 'MyApp', local_path: '/Users/dev/myapp'
      }, { 'Authorization': `Bearer ${token}` });
      projectId = projRes.body.id;

      const threadRes = await request(server, 'POST', '/api/threads', {
        project_id: projectId, title: 'Chat'
      }, { 'Authorization': `Bearer ${token}` });
      threadId = threadRes.body.id;
    });

    it('POST /api/messages should create a message', async () => {
      const res = await request(server, 'POST', '/api/messages', {
        thread_id: threadId, role: 'user', body: 'Hello from mobile'
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(res.status, 201);
      assert.equal(res.body.body, 'Hello from mobile');
      assert.equal(res.body.role, 'user');
      assert.equal(res.body.source, 'mobile');
    });

    it('GET /api/messages should return messages for a thread', async () => {
      await request(server, 'POST', '/api/messages', {
        thread_id: threadId, role: 'user', body: 'Message 1'
      }, { 'Authorization': `Bearer ${token}` });
      await request(server, 'POST', '/api/messages', {
        thread_id: threadId, role: 'assistant', body: 'Reply 1'
      }, { 'Authorization': `Bearer ${token}` });

      const res = await request(server, 'GET', `/api/messages?thread_id=${threadId}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 2);
    });

    it('POST /api/ack should acknowledge a message', async () => {
      const msgRes = await request(server, 'POST', '/api/messages', {
        thread_id: threadId, role: 'user', body: 'Hello'
      }, { 'Authorization': `Bearer ${token}` });

      const ackRes = await request(server, 'POST', '/api/ack', {
        message_id: msgRes.body.id
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(ackRes.status, 200);
      assert.equal(ackRes.body.state, 'acked');
    });

    it('POST /api/messages should reject missing fields', async () => {
      const res = await request(server, 'POST', '/api/messages', {
        thread_id: threadId
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(res.status, 400);
    });

    it('POST /api/messages should reject non-existent thread', async () => {
      const res = await request(server, 'POST', '/api/messages', {
        thread_id: 'nonexistent-thread', role: 'user', body: 'Hello'
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(res.status, 404);
    });

    it('GET /api/messages should support limit parameter', async () => {
      // Create 3 messages
      for (let i = 1; i <= 3; i++) {
        await request(server, 'POST', '/api/messages', {
          thread_id: threadId, role: 'user', body: `Message ${i}`
        }, { 'Authorization': `Bearer ${token}` });
      }

      // Fetch with limit=2
      const res = await request(server, 'GET', `/api/messages?thread_id=${threadId}&limit=2`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.length, 2);
    });
  });
});
