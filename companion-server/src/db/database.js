'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const SCHEMA_VERSION = 1;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  platform TEXT NOT NULL CHECK(platform IN ('mac', 'iphone')),
  trusted_at TEXT,
  revoked_at TEXT,
  pairing_token TEXT,
  pairing_token_expires_at TEXT,
  session_token TEXT,
  session_token_expires_at TEXT
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  local_path TEXT NOT NULL,
  git_remote_url TEXT,
  current_branch TEXT,
  last_commit_hash TEXT,
  last_active_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS threads (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  origin_type TEXT NOT NULL DEFAULT 'sidecar' CHECK(origin_type IN ('sidecar', 'imported', 'manual')),
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'archived')),
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('user', 'system', 'assistant', 'tool')),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  device_id TEXT,
  source TEXT NOT NULL DEFAULT 'mac' CHECK(source IN ('mac', 'mobile', 'imported')),
  state TEXT NOT NULL DEFAULT 'sent' CHECK(state IN ('pending', 'sent', 'acked', 'failed')),
  external_ref TEXT,
  metadata_json TEXT,
  FOREIGN KEY (thread_id) REFERENCES threads(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS sync_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  device_id TEXT,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_threads_project_id ON threads(project_id);
CREATE INDEX IF NOT EXISTS idx_messages_thread_id ON messages(thread_id);
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_sync_events_created_at ON sync_events(created_at);
CREATE INDEX IF NOT EXISTS idx_projects_last_active ON projects(last_active_at);
`;

class CompanionDB {
  constructor(dbPath) {
    this.dbPath = dbPath || path.join(process.cwd(), 'companion.db');
    this.db = null;
  }

  open() {
    this.db = new Database(this.dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA_SQL);

    const versionRow = this.db.prepare("SELECT value FROM settings WHERE key = 'schema_version'").get();
    if (!versionRow) {
      this.db.prepare("INSERT INTO settings (key, value) VALUES ('schema_version', ?)").run(String(SCHEMA_VERSION));
    }
    return this;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // === Device operations ===

  createDevice({ id, device_name, platform }) {
    const stmt = this.db.prepare(
      'INSERT INTO devices (id, device_name, platform) VALUES (?, ?, ?)'
    );
    stmt.run(id, device_name, platform);
    return this.getDevice(id);
  }

  getDevice(id) {
    return this.db.prepare('SELECT * FROM devices WHERE id = ?').get(id) || null;
  }

  getDeviceBySessionToken(token) {
    return this.db.prepare(
      'SELECT * FROM devices WHERE session_token = ? AND revoked_at IS NULL'
    ).get(token) || null;
  }

  listDevices() {
    return this.db.prepare('SELECT * FROM devices ORDER BY trusted_at DESC').all();
  }

  updateDevice(id, fields) {
    const allowed = ['device_name', 'platform', 'trusted_at', 'revoked_at',
      'pairing_token', 'pairing_token_expires_at', 'session_token', 'session_token_expires_at'];
    const updates = [];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) return null;
    values.push(id);
    this.db.prepare(`UPDATE devices SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getDevice(id);
  }

  revokeDevice(id) {
    return this.updateDevice(id, { revoked_at: new Date().toISOString(), session_token: null, session_token_expires_at: null });
  }

  // === Project operations ===

  createProject({ id, name, local_path, git_remote_url, current_branch, last_commit_hash }) {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO projects (id, name, local_path, git_remote_url, current_branch, last_commit_hash, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name, local_path, git_remote_url || null, current_branch || null, last_commit_hash || null, now, now);
    return this.getProject(id);
  }

  getProject(id) {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) || null;
  }

  listProjects() {
    return this.db.prepare('SELECT * FROM projects ORDER BY last_active_at DESC').all();
  }

  updateProject(id, fields) {
    const allowed = ['name', 'local_path', 'git_remote_url', 'current_branch', 'last_commit_hash', 'last_active_at'];
    const updates = [];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(val);
      }
    }
    if (updates.length === 0) return null;
    values.push(id);
    this.db.prepare(`UPDATE projects SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getProject(id);
  }

  deleteProject(id) {
    this.db.prepare('DELETE FROM projects WHERE id = ?').run(id);
  }

  // === Thread operations ===

  createThread({ id, project_id, title, origin_type }) {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO threads (id, project_id, title, created_at, updated_at, origin_type)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(id, project_id, title, now, now, origin_type || 'sidecar');
    return this.getThread(id);
  }

  getThread(id) {
    return this.db.prepare('SELECT * FROM threads WHERE id = ?').get(id) || null;
  }

  listThreadsByProject(project_id) {
    return this.db.prepare(
      'SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC'
    ).all(project_id);
  }

  updateThread(id, fields) {
    const allowed = ['title', 'updated_at', 'status', 'origin_type'];
    const updates = ['updated_at = datetime(\'now\')'];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
      if (allowed.includes(key)) {
        updates.push(`${key} = ?`);
        values.push(val);
      }
    }
    values.push(id);
    this.db.prepare(`UPDATE threads SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    return this.getThread(id);
  }

  deleteThread(id) {
    this.db.prepare('DELETE FROM threads WHERE id = ?').run(id);
  }

  // === Message operations ===

  createMessage({ id, thread_id, role, body, device_id, source, state, metadata_json }) {
    const now = new Date().toISOString();
    this.db.prepare(
      `INSERT INTO messages (id, thread_id, role, body, created_at, device_id, source, state, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(id, thread_id, role, body, now, device_id || null, source || 'mac', state || 'sent', metadata_json || null);

    // Update thread's updated_at
    this.db.prepare("UPDATE threads SET updated_at = datetime('now') WHERE id = ?").run(thread_id);

    return this.getMessage(id);
  }

  getMessage(id) {
    return this.db.prepare('SELECT * FROM messages WHERE id = ?').get(id) || null;
  }

  listMessagesByThread(thread_id, { limit = 100, before } = {}) {
    if (before) {
      return this.db.prepare(
        'SELECT * FROM messages WHERE thread_id = ? AND created_at < ? ORDER BY created_at ASC LIMIT ?'
      ).all(thread_id, before, limit);
    }
    return this.db.prepare(
      'SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC LIMIT ?'
    ).all(thread_id, limit);
  }

  updateMessageState(id, state) {
    this.db.prepare('UPDATE messages SET state = ? WHERE id = ?').run(state, id);
    return this.getMessage(id);
  }

  // === Sync events ===

  createSyncEvent({ event_type, entity_type, entity_id, device_id, payload_json }) {
    const result = this.db.prepare(
      `INSERT INTO sync_events (event_type, entity_type, entity_id, device_id, payload_json)
       VALUES (?, ?, ?, ?, ?)`
    ).run(event_type, entity_type, entity_id, device_id || null, payload_json || null);
    return this.db.prepare('SELECT * FROM sync_events WHERE id = ?').get(result.lastInsertRowid);
  }

  listSyncEventsSince(sinceId = 0, limit = 100) {
    return this.db.prepare(
      'SELECT * FROM sync_events WHERE id > ? ORDER BY id ASC LIMIT ?'
    ).all(sinceId, limit);
  }

  // === Settings ===

  getSetting(key) {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
    return row ? row.value : null;
  }

  setSetting(key, value) {
    this.db.prepare(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)'
    ).run(key, String(value));
  }
}

module.exports = { CompanionDB };
