'use strict';

const crypto = require('crypto');

const PAIRING_TOKEN_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const SESSION_TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Generates a cryptographically secure random token.
 */
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Starts the pairing flow: creates a device record with a short-lived pairing token.
 * Returns the pairing token to display to the user (e.g. as a QR code or code).
 */
function startPairing(db, { device_name, platform }) {
  const { v4: uuidv4 } = require('uuid');
  const deviceId = uuidv4();
  const pairingToken = generateToken(16);
  const expiresAt = new Date(Date.now() + PAIRING_TOKEN_EXPIRY_MS).toISOString();

  db.createDevice({ id: deviceId, device_name, platform });
  db.updateDevice(deviceId, {
    pairing_token: pairingToken,
    pairing_token_expires_at: expiresAt
  });

  return { device_id: deviceId, pairing_token: pairingToken, expires_at: expiresAt };
}

/**
 * Confirms pairing: validates the pairing token and issues a session token.
 * Returns the session token or null if invalid/expired.
 */
function confirmPairing(db, { device_id, pairing_token }) {
  const device = db.getDevice(device_id);
  if (!device) return { error: 'Device not found' };
  if (device.revoked_at) return { error: 'Device has been revoked' };
  if (device.pairing_token !== pairing_token) return { error: 'Invalid pairing token' };

  const now = new Date();
  if (device.pairing_token_expires_at && new Date(device.pairing_token_expires_at) < now) {
    return { error: 'Pairing token has expired' };
  }

  const sessionToken = generateToken(32);
  const sessionExpiry = new Date(Date.now() + SESSION_TOKEN_EXPIRY_MS).toISOString();

  db.updateDevice(device_id, {
    trusted_at: now.toISOString(),
    pairing_token: null,
    pairing_token_expires_at: null,
    session_token: sessionToken,
    session_token_expires_at: sessionExpiry
  });

  return { session_token: sessionToken, expires_at: sessionExpiry };
}

/**
 * Validates a session token. Returns the device if valid, null otherwise.
 */
function validateSession(db, sessionToken) {
  if (!sessionToken) return null;
  const device = db.getDeviceBySessionToken(sessionToken);
  if (!device) return null;

  const now = new Date();
  if (device.session_token_expires_at && new Date(device.session_token_expires_at) < now) {
    return null;
  }

  return device;
}

/**
 * Express middleware to authenticate requests using Bearer token.
 */
function authMiddleware(db) {
  return (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const token = authHeader.slice(7);
    const device = validateSession(db, token);
    if (!device) {
      return res.status(401).json({ error: 'Invalid or expired session token' });
    }

    req.device = device;
    next();
  };
}

module.exports = {
  generateToken,
  startPairing,
  confirmPairing,
  validateSession,
  authMiddleware,
  PAIRING_TOKEN_EXPIRY_MS,
  SESSION_TOKEN_EXPIRY_MS
};
