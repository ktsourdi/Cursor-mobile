'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync } = require('child_process');
const { createApp } = require('../src/index');

function createTestApp() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-extended-test-'));
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

describe('Extended API: Devices, PUT/DELETE, Scan', () => {
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

  // === Device management ===

  describe('GET /api/devices', () => {
    it('should list paired devices', async () => {
      const { token } = await pairDevice(server);
      const res = await request(server, 'GET', '/api/devices', null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.ok(Array.isArray(res.body));
      assert.equal(res.body.length, 1);
      assert.equal(res.body[0].platform, 'iphone');
      // Should not expose session token
      assert.equal(res.body[0].session_token, undefined);
    });
  });

  describe('DELETE /api/devices/:id', () => {
    it('should revoke a device', async () => {
      const { token, device_id } = await pairDevice(server);
      const res = await request(server, 'DELETE', `/api/devices/${device_id}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'revoked');
    });

    it('should return 404 for non-existent device', async () => {
      const { token } = await pairDevice(server);
      const res = await request(server, 'DELETE', '/api/devices/fake-id', null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 404);
    });
  });

  // === PUT/DELETE projects ===

  describe('PUT /api/projects/:id', () => {
    it('should update a project', async () => {
      const { token } = await pairDevice(server);
      const projRes = await request(server, 'POST', '/api/projects', {
        name: 'OldName', local_path: '/tmp/test-proj'
      }, { 'Authorization': `Bearer ${token}` });

      const res = await request(server, 'PUT', `/api/projects/${projRes.body.id}`, {
        name: 'NewName', current_branch: 'develop'
      }, { 'Authorization': `Bearer ${token}` });

      assert.equal(res.status, 200);
      assert.equal(res.body.name, 'NewName');
      assert.equal(res.body.current_branch, 'develop');
    });

    it('should return 404 for non-existent project', async () => {
      const { token } = await pairDevice(server);
      const res = await request(server, 'PUT', '/api/projects/fake-id', {
        name: 'X'
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(res.status, 404);
    });
  });

  describe('DELETE /api/projects/:id', () => {
    it('should delete a project', async () => {
      const { token } = await pairDevice(server);
      const projRes = await request(server, 'POST', '/api/projects', {
        name: 'ToDelete', local_path: '/tmp/del-test'
      }, { 'Authorization': `Bearer ${token}` });

      const res = await request(server, 'DELETE', `/api/projects/${projRes.body.id}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'deleted');

      // Verify it's gone
      const getRes = await request(server, 'GET', `/api/projects/${projRes.body.id}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(getRes.status, 404);
    });
  });

  // === PUT/DELETE threads ===

  describe('PUT /api/threads/:id', () => {
    it('should update a thread title and status', async () => {
      const { token } = await pairDevice(server);
      const projRes = await request(server, 'POST', '/api/projects', {
        name: 'Proj', local_path: '/tmp/thread-test'
      }, { 'Authorization': `Bearer ${token}` });

      const threadRes = await request(server, 'POST', '/api/threads', {
        project_id: projRes.body.id, title: 'Original'
      }, { 'Authorization': `Bearer ${token}` });

      const res = await request(server, 'PUT', `/api/threads/${threadRes.body.id}`, {
        title: 'Updated', status: 'archived'
      }, { 'Authorization': `Bearer ${token}` });

      assert.equal(res.status, 200);
      assert.equal(res.body.title, 'Updated');
      assert.equal(res.body.status, 'archived');
    });

    it('should return 404 for non-existent thread', async () => {
      const { token } = await pairDevice(server);
      const res = await request(server, 'PUT', '/api/threads/fake-id', {
        title: 'X'
      }, { 'Authorization': `Bearer ${token}` });
      assert.equal(res.status, 404);
    });
  });

  describe('DELETE /api/threads/:id', () => {
    it('should delete a thread', async () => {
      const { token } = await pairDevice(server);
      const projRes = await request(server, 'POST', '/api/projects', {
        name: 'DelThread', local_path: '/tmp/del-thread'
      }, { 'Authorization': `Bearer ${token}` });

      const threadRes = await request(server, 'POST', '/api/threads', {
        project_id: projRes.body.id, title: 'ToDelete'
      }, { 'Authorization': `Bearer ${token}` });

      const res = await request(server, 'DELETE', `/api/threads/${threadRes.body.id}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 200);
      assert.equal(res.body.status, 'deleted');

      // Verify it's gone
      const getRes = await request(server, 'GET', `/api/threads/${threadRes.body.id}`, null, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(getRes.status, 404);
    });
  });

  // === Project scan ===

  describe('POST /api/projects/scan', () => {
    it('should discover and register git projects from a directory', async () => {
      const { token } = await pairDevice(server);

      // Create a git repo in tmpDir
      const repoDir = path.join(tmpDir, 'my-scanned-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      execSync('git init', { cwd: repoDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test');
      execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });

      const res = await request(server, 'POST', '/api/projects/scan', {
        scan_path: tmpDir
      }, { 'Authorization': `Bearer ${token}` });

      assert.equal(res.status, 200);
      assert.ok(res.body.discovered >= 1);
      assert.ok(res.body.projects.length >= 1);

      const found = res.body.projects.find(p => p.name === 'my-scanned-repo');
      assert.ok(found);
      assert.equal(found.action, 'created');
    });

    it('should update existing projects on re-scan', async () => {
      const { token } = await pairDevice(server);

      const repoDir = path.join(tmpDir, 'rescan-repo');
      fs.mkdirSync(repoDir, { recursive: true });
      execSync('git init', { cwd: repoDir, stdio: 'pipe' });
      execSync('git config user.email "test@test.com"', { cwd: repoDir, stdio: 'pipe' });
      execSync('git config user.name "Test"', { cwd: repoDir, stdio: 'pipe' });
      fs.writeFileSync(path.join(repoDir, 'README.md'), '# Test');
      execSync('git add .', { cwd: repoDir, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: repoDir, stdio: 'pipe' });

      // First scan
      await request(server, 'POST', '/api/projects/scan', {
        scan_path: tmpDir
      }, { 'Authorization': `Bearer ${token}` });

      // Second scan
      const res = await request(server, 'POST', '/api/projects/scan', {
        scan_path: tmpDir
      }, { 'Authorization': `Bearer ${token}` });

      const found = res.body.projects.find(p => p.name === 'rescan-repo');
      assert.ok(found);
      assert.equal(found.action, 'updated');
    });

    it('should require scan_path', async () => {
      const { token } = await pairDevice(server);
      const res = await request(server, 'POST', '/api/projects/scan', {}, {
        'Authorization': `Bearer ${token}`
      });
      assert.equal(res.status, 400);
    });
  });
});
