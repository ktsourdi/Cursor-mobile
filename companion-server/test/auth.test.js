'use strict';

const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { CompanionDB } = require('../src/db/database');
const { startPairing, confirmPairing, validateSession } = require('../src/auth/pairing');

function createTempDB() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'companion-auth-test-'));
  const dbPath = path.join(tmpDir, 'test.db');
  const db = new CompanionDB(dbPath);
  db.open();
  return { db, tmpDir };
}

function cleanupTempDB({ db, tmpDir }) {
  db.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

describe('Authentication and Pairing', () => {
  let db, tmpDir;

  beforeEach(() => {
    ({ db, tmpDir } = createTempDB());
  });

  afterEach(() => {
    cleanupTempDB({ db, tmpDir });
  });

  describe('startPairing', () => {
    it('should create a device with a pairing token', () => {
      const result = startPairing(db, { device_name: 'iPhone 15', platform: 'iphone' });
      assert.ok(result.device_id);
      assert.ok(result.pairing_token);
      assert.ok(result.expires_at);

      const device = db.getDevice(result.device_id);
      assert.equal(device.device_name, 'iPhone 15');
      assert.equal(device.platform, 'iphone');
      assert.equal(device.pairing_token, result.pairing_token);
    });
  });

  describe('confirmPairing', () => {
    it('should confirm pairing and issue a session token', () => {
      const pairResult = startPairing(db, { device_name: 'iPhone 15', platform: 'iphone' });
      const confirmResult = confirmPairing(db, {
        device_id: pairResult.device_id,
        pairing_token: pairResult.pairing_token
      });

      assert.ok(confirmResult.session_token);
      assert.ok(confirmResult.expires_at);

      // Pairing token should be cleared
      const device = db.getDevice(pairResult.device_id);
      assert.equal(device.pairing_token, null);
      assert.ok(device.trusted_at);
    });

    it('should reject invalid pairing token', () => {
      const pairResult = startPairing(db, { device_name: 'iPhone', platform: 'iphone' });
      const confirmResult = confirmPairing(db, {
        device_id: pairResult.device_id,
        pairing_token: 'wrong-token'
      });
      assert.equal(confirmResult.error, 'Invalid pairing token');
    });

    it('should reject non-existent device', () => {
      const confirmResult = confirmPairing(db, {
        device_id: 'fake-device',
        pairing_token: 'whatever'
      });
      assert.equal(confirmResult.error, 'Device not found');
    });

    it('should reject expired pairing token', () => {
      const pairResult = startPairing(db, { device_name: 'iPhone', platform: 'iphone' });

      // Manually expire the pairing token
      db.updateDevice(pairResult.device_id, {
        pairing_token_expires_at: new Date(Date.now() - 1000).toISOString()
      });

      const confirmResult = confirmPairing(db, {
        device_id: pairResult.device_id,
        pairing_token: pairResult.pairing_token
      });
      assert.equal(confirmResult.error, 'Pairing token has expired');
    });

    it('should reject revoked device', () => {
      const pairResult = startPairing(db, { device_name: 'iPhone', platform: 'iphone' });
      db.revokeDevice(pairResult.device_id);

      const confirmResult = confirmPairing(db, {
        device_id: pairResult.device_id,
        pairing_token: pairResult.pairing_token
      });
      assert.equal(confirmResult.error, 'Device has been revoked');
    });
  });

  describe('validateSession', () => {
    it('should validate a valid session token', () => {
      const pairResult = startPairing(db, { device_name: 'iPhone', platform: 'iphone' });
      const confirmResult = confirmPairing(db, {
        device_id: pairResult.device_id,
        pairing_token: pairResult.pairing_token
      });

      const device = validateSession(db, confirmResult.session_token);
      assert.ok(device);
      assert.equal(device.id, pairResult.device_id);
    });

    it('should return null for invalid token', () => {
      const device = validateSession(db, 'invalid-token');
      assert.equal(device, null);
    });

    it('should return null for null token', () => {
      const device = validateSession(db, null);
      assert.equal(device, null);
    });

    it('should return null for expired session', () => {
      const pairResult = startPairing(db, { device_name: 'iPhone', platform: 'iphone' });
      const confirmResult = confirmPairing(db, {
        device_id: pairResult.device_id,
        pairing_token: pairResult.pairing_token
      });

      // Manually expire the session
      db.updateDevice(pairResult.device_id, {
        session_token_expires_at: new Date(Date.now() - 1000).toISOString()
      });

      const device = validateSession(db, confirmResult.session_token);
      assert.equal(device, null);
    });
  });
});
