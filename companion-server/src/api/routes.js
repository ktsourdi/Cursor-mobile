'use strict';

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { startPairing, confirmPairing, authMiddleware } = require('../auth/pairing');
const { getGitMetadata, scanForProjects } = require('../project-discovery/git');

function createRouter(db, { broadcast } = {}) {
  const router = express.Router();
  const auth = authMiddleware(db);

  // === Pairing endpoints (unauthenticated) ===

  router.post('/pair/start', (req, res) => {
    const { device_name, platform } = req.body;
    if (!device_name || !platform) {
      return res.status(400).json({ error: 'device_name and platform are required' });
    }
    if (!['mac', 'iphone'].includes(platform)) {
      return res.status(400).json({ error: 'platform must be mac or iphone' });
    }
    const result = startPairing(db, { device_name, platform });
    res.status(201).json(result);
  });

  router.post('/pair/confirm', (req, res) => {
    const { device_id, pairing_token } = req.body;
    if (!device_id || !pairing_token) {
      return res.status(400).json({ error: 'device_id and pairing_token are required' });
    }
    const result = confirmPairing(db, { device_id, pairing_token });
    if (result.error) {
      return res.status(400).json(result);
    }
    res.json(result);
  });

  // === Status endpoint ===

  router.get('/status', (req, res) => {
    const devices = db.listDevices();
    const projects = db.listProjects();
    res.json({
      status: 'ok',
      version: '1.0.0',
      connected_devices: devices.filter(d => d.trusted_at && !d.revoked_at).length,
      project_count: projects.length
    });
  });

  // === Authenticated endpoints ===

  // Devices
  router.get('/devices', auth, (req, res) => {
    const devices = db.listDevices().map(d => ({
      id: d.id,
      device_name: d.device_name,
      platform: d.platform,
      trusted_at: d.trusted_at,
      revoked_at: d.revoked_at
    }));
    res.json(devices);
  });

  router.delete('/devices/:id', auth, (req, res) => {
    const device = db.getDevice(req.params.id);
    if (!device) return res.status(404).json({ error: 'Device not found' });
    db.revokeDevice(req.params.id);
    if (broadcast) {
      broadcast({ type: 'connection.changed', data: { status: 'device_revoked', device_id: req.params.id } });
    }
    res.json({ status: 'revoked', device_id: req.params.id });
  });

  // Projects
  router.get('/projects', auth, (req, res) => {
    const projects = db.listProjects();
    // Enrich with live git metadata
    const enriched = projects.map(p => {
      const gitMeta = getGitMetadata(p.local_path);
      return { ...p, git: gitMeta };
    });
    res.json(enriched);
  });

  router.post('/projects', auth, (req, res) => {
    const { name, local_path, git_remote_url, current_branch, last_commit_hash } = req.body;
    if (!name || !local_path) {
      return res.status(400).json({ error: 'name and local_path are required' });
    }
    const id = uuidv4();
    const project = db.createProject({ id, name, local_path, git_remote_url, current_branch, last_commit_hash });

    if (broadcast) {
      broadcast({ type: 'project.updated', data: project });
    }

    res.status(201).json(project);
  });

  // Scan a directory path and auto-register discovered git projects
  router.post('/projects/scan', auth, (req, res) => {
    const { scan_path } = req.body;
    if (!scan_path) {
      return res.status(400).json({ error: 'scan_path is required' });
    }
    const discovered = scanForProjects(scan_path);
    const registered = [];
    for (const proj of discovered) {
      // Skip if already registered by local_path
      const existing = db.listProjects().find(p => p.local_path === proj.local_path);
      if (existing) {
        // Update git metadata on existing project
        db.updateProject(existing.id, {
          current_branch: proj.current_branch,
          last_commit_hash: proj.last_commit_hash,
          git_remote_url: proj.git_remote_url,
          last_active_at: new Date().toISOString()
        });
        registered.push({ ...db.getProject(existing.id), action: 'updated' });
      } else {
        const id = uuidv4();
        const created = db.createProject({
          id,
          name: proj.name,
          local_path: proj.local_path,
          git_remote_url: proj.git_remote_url,
          current_branch: proj.current_branch,
          last_commit_hash: proj.last_commit_hash
        });
        registered.push({ ...created, action: 'created' });
        if (broadcast) {
          broadcast({ type: 'project.updated', data: created });
        }
      }
    }
    res.json({ scanned_path: scan_path, discovered: discovered.length, projects: registered });
  });

  router.get('/projects/:id', auth, (req, res) => {
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });

    const gitMeta = getGitMetadata(project.local_path);
    res.json({ ...project, git: gitMeta });
  });

  router.put('/projects/:id', auth, (req, res) => {
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    const updated = db.updateProject(req.params.id, req.body);
    if (broadcast) {
      broadcast({ type: 'project.updated', data: updated });
    }
    res.json(updated);
  });

  router.delete('/projects/:id', auth, (req, res) => {
    const project = db.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    db.deleteProject(req.params.id);
    if (broadcast) {
      broadcast({ type: 'project.updated', data: { id: req.params.id, deleted: true } });
    }
    res.json({ status: 'deleted', project_id: req.params.id });
  });

  // Threads
  router.get('/threads', auth, (req, res) => {
    const { project_id } = req.query;
    if (!project_id) {
      return res.status(400).json({ error: 'project_id query parameter is required' });
    }
    const threads = db.listThreadsByProject(project_id);
    res.json(threads);
  });

  router.post('/threads', auth, (req, res) => {
    const { project_id, title, origin_type } = req.body;
    if (!project_id || !title) {
      return res.status(400).json({ error: 'project_id and title are required' });
    }
    const project = db.getProject(project_id);
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    const id = uuidv4();
    const thread = db.createThread({ id, project_id, title, origin_type });

    if (broadcast) {
      broadcast({ type: 'thread.updated', data: thread });
    }

    res.status(201).json(thread);
  });

  router.get('/threads/:id', auth, (req, res) => {
    const thread = db.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    res.json(thread);
  });

  router.put('/threads/:id', auth, (req, res) => {
    const thread = db.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    const updated = db.updateThread(req.params.id, req.body);
    if (broadcast) {
      broadcast({ type: 'thread.updated', data: updated });
    }
    res.json(updated);
  });

  router.delete('/threads/:id', auth, (req, res) => {
    const thread = db.getThread(req.params.id);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });
    db.deleteThread(req.params.id);
    if (broadcast) {
      broadcast({ type: 'thread.updated', data: { id: req.params.id, deleted: true } });
    }
    res.json({ status: 'deleted', thread_id: req.params.id });
  });

  // Messages
  router.get('/messages', auth, (req, res) => {
    const { thread_id, limit, before } = req.query;
    if (!thread_id) {
      return res.status(400).json({ error: 'thread_id query parameter is required' });
    }
    const messages = db.listMessagesByThread(thread_id, {
      limit: limit ? parseInt(limit, 10) : 100,
      before
    });
    res.json(messages);
  });

  router.post('/messages', auth, (req, res) => {
    const { thread_id, role, body, source, metadata_json } = req.body;
    if (!thread_id || !role || !body) {
      return res.status(400).json({ error: 'thread_id, role, and body are required' });
    }

    const thread = db.getThread(thread_id);
    if (!thread) {
      return res.status(404).json({ error: 'Thread not found' });
    }

    const id = uuidv4();
    const message = db.createMessage({
      id,
      thread_id,
      role,
      body,
      device_id: req.device.id,
      source: source || (req.device.platform === 'iphone' ? 'mobile' : 'mac'),
      state: 'sent',
      metadata_json: metadata_json ? JSON.stringify(metadata_json) : null
    });

    // Record sync event
    db.createSyncEvent({
      event_type: 'message.created',
      entity_type: 'message',
      entity_id: id,
      device_id: req.device.id,
      payload_json: JSON.stringify(message)
    });

    if (broadcast) {
      broadcast({ type: 'message.created', data: message });
    }

    res.status(201).json(message);
  });

  // Acknowledge message receipt
  router.post('/ack', auth, (req, res) => {
    const { message_id } = req.body;
    if (!message_id) {
      return res.status(400).json({ error: 'message_id is required' });
    }
    const message = db.getMessage(message_id);
    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }
    const updated = db.updateMessageState(message_id, 'acked');

    if (broadcast) {
      broadcast({ type: 'message.acked', data: updated });
    }

    res.json(updated);
  });

  return router;
}

module.exports = { createRouter };
