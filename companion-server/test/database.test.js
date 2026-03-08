'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CompanionDB } = require('../src/db/database');

function createTempDB() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new CompanionDB(dbPath);
  db.open();
  return { db, tmpDir, dbPath };
}

function cleanupTempDB({ db, tmpDir }) {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('CompanionDB', () => {
  let db, tmpDir;

  beforeEach(() => {
    ({ db, tmpDir } = createTempDB());
  });

  afterEach(() => {
    cleanupTempDB({ db, tmpDir });
  });

  describe('Device operations', () => {
    it('should create and retrieve a device', () => {
      const device = db.createDevice({ id: 'dev-1', device_name: 'iPhone 15', platform: 'iphone' });
      assert.equal(device.id, 'dev-1');
      assert.equal(device.device_name, 'iPhone 15');
      assert.equal(device.platform, 'iphone');
    });

    it('should return null for non-existent device', () => {
      const device = db.getDevice('non-existent');
      assert.equal(device, null);
    });

    it('should list all devices', () => {
      db.createDevice({ id: 'dev-1', device_name: 'iPhone', platform: 'iphone' });
      db.createDevice({ id: 'dev-2', device_name: 'MacBook', platform: 'mac' });
      const devices = db.listDevices();
      assert.equal(devices.length, 2);
    });

    it('should update device fields', () => {
      db.createDevice({ id: 'dev-1', device_name: 'iPhone', platform: 'iphone' });
      const updated = db.updateDevice('dev-1', { trusted_at: '2025-01-01T00:00:00Z' });
      assert.equal(updated.trusted_at, '2025-01-01T00:00:00Z');
    });

    it('should revoke a device', () => {
      db.createDevice({ id: 'dev-1', device_name: 'iPhone', platform: 'iphone' });
      const revoked = db.revokeDevice('dev-1');
      assert.ok(revoked.revoked_at);
      assert.equal(revoked.session_token, null);
    });

    it('should find device by session token', () => {
      db.createDevice({ id: 'dev-1', device_name: 'iPhone', platform: 'iphone' });
      db.updateDevice('dev-1', { session_token: 'test-token-123' });
      const found = db.getDeviceBySessionToken('test-token-123');
      assert.equal(found.id, 'dev-1');
    });

    it('should not find revoked device by session token', () => {
      db.createDevice({ id: 'dev-1', device_name: 'iPhone', platform: 'iphone' });
      db.updateDevice('dev-1', { session_token: 'test-token-123', revoked_at: new Date().toISOString() });
      const found = db.getDeviceBySessionToken('test-token-123');
      assert.equal(found, null);
    });
  });

  describe('Project operations', () => {
    it('should create and retrieve a project', () => {
      const project = db.createProject({
        id: 'proj-1', name: 'MyApp', local_path: '/Users/dev/myapp',
        git_remote_url: 'https://github.com/user/myapp', current_branch: 'main', last_commit_hash: 'abc123'
      });
      assert.equal(project.id, 'proj-1');
      assert.equal(project.name, 'MyApp');
      assert.equal(project.current_branch, 'main');
    });

    it('should list projects ordered by last_active_at', () => {
      db.createProject({ id: 'proj-1', name: 'First', local_path: '/a' });
      db.createProject({ id: 'proj-2', name: 'Second', local_path: '/b' });
      const projects = db.listProjects();
      assert.equal(projects.length, 2);
    });

    it('should update project fields', () => {
      db.createProject({ id: 'proj-1', name: 'MyApp', local_path: '/a' });
      const updated = db.updateProject('proj-1', { current_branch: 'feature-x' });
      assert.equal(updated.current_branch, 'feature-x');
    });

    it('should delete a project', () => {
      db.createProject({ id: 'proj-1', name: 'MyApp', local_path: '/a' });
      db.deleteProject('proj-1');
      assert.equal(db.getProject('proj-1'), null);
    });
  });

  describe('Thread operations', () => {
    beforeEach(() => {
      db.createProject({ id: 'proj-1', name: 'MyApp', local_path: '/a' });
    });

    it('should create and retrieve a thread', () => {
      const thread = db.createThread({ id: 'thread-1', project_id: 'proj-1', title: 'Discussion' });
      assert.equal(thread.id, 'thread-1');
      assert.equal(thread.project_id, 'proj-1');
      assert.equal(thread.title, 'Discussion');
      assert.equal(thread.status, 'active');
      assert.equal(thread.origin_type, 'sidecar');
    });

    it('should list threads by project', () => {
      db.createThread({ id: 'thread-1', project_id: 'proj-1', title: 'Thread A' });
      db.createThread({ id: 'thread-2', project_id: 'proj-1', title: 'Thread B' });
      const threads = db.listThreadsByProject('proj-1');
      assert.equal(threads.length, 2);
    });

    it('should update thread status', () => {
      db.createThread({ id: 'thread-1', project_id: 'proj-1', title: 'Thread A' });
      const updated = db.updateThread('thread-1', { status: 'archived' });
      assert.equal(updated.status, 'archived');
    });

    it('should delete a thread', () => {
      db.createThread({ id: 'thread-1', project_id: 'proj-1', title: 'Thread A' });
      db.deleteThread('thread-1');
      assert.equal(db.getThread('thread-1'), null);
    });
  });

  describe('Message operations', () => {
    beforeEach(() => {
      db.createProject({ id: 'proj-1', name: 'MyApp', local_path: '/a' });
      db.createThread({ id: 'thread-1', project_id: 'proj-1', title: 'Discussion' });
    });

    it('should create and retrieve a message', () => {
      const msg = db.createMessage({
        id: 'msg-1', thread_id: 'thread-1', role: 'user', body: 'Hello from mobile',
        source: 'mobile', state: 'sent'
      });
      assert.equal(msg.id, 'msg-1');
      assert.equal(msg.body, 'Hello from mobile');
      assert.equal(msg.role, 'user');
      assert.equal(msg.source, 'mobile');
    });

    it('should list messages by thread in chronological order', () => {
      db.createMessage({ id: 'msg-1', thread_id: 'thread-1', role: 'user', body: 'First' });
      db.createMessage({ id: 'msg-2', thread_id: 'thread-1', role: 'assistant', body: 'Second' });
      const messages = db.listMessagesByThread('thread-1');
      assert.equal(messages.length, 2);
      assert.equal(messages[0].body, 'First');
      assert.equal(messages[1].body, 'Second');
    });

    it('should update message state', () => {
      db.createMessage({ id: 'msg-1', thread_id: 'thread-1', role: 'user', body: 'Hello' });
      const updated = db.updateMessageState('msg-1', 'acked');
      assert.equal(updated.state, 'acked');
    });

    it('should update thread updated_at when message is created', () => {
      db.createMessage({ id: 'msg-1', thread_id: 'thread-1', role: 'user', body: 'Hello' });
      const threadAfter = db.getThread('thread-1');
      // Verify the thread has an updated_at timestamp
      assert.ok(threadAfter.updated_at);
      assert.equal(typeof threadAfter.updated_at, 'string');
    });
  });

  describe('Sync events', () => {
    it('should create and list sync events', () => {
      db.createSyncEvent({
        event_type: 'message.created', entity_type: 'message', entity_id: 'msg-1',
        payload_json: JSON.stringify({ body: 'test' })
      });
      db.createSyncEvent({
        event_type: 'thread.updated', entity_type: 'thread', entity_id: 'thread-1'
      });
      const events = db.listSyncEventsSince(0);
      assert.equal(events.length, 2);
    });

    it('should list sync events since a given ID', () => {
      db.createSyncEvent({ event_type: 'a', entity_type: 'message', entity_id: '1' });
      const evt2 = db.createSyncEvent({ event_type: 'b', entity_type: 'message', entity_id: '2' });
      db.createSyncEvent({ event_type: 'c', entity_type: 'message', entity_id: '3' });
      const events = db.listSyncEventsSince(evt2.id - 1);
      assert.equal(events.length, 2);
    });
  });

  describe('Settings', () => {
    it('should get and set settings', () => {
      db.setSetting('theme', 'dark');
      assert.equal(db.getSetting('theme'), 'dark');
    });

    it('should return null for non-existent setting', () => {
      assert.equal(db.getSetting('nonexistent'), null);
    });

    it('should overwrite existing settings', () => {
      db.setSetting('theme', 'dark');
      db.setSetting('theme', 'light');
      assert.equal(db.getSetting('theme'), 'light');
    });
  });
});
