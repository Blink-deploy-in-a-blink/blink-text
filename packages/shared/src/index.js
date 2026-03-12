'use strict';

/**
 * Current protocol version for encrypted message payloads.
 */
const PAYLOAD_VERSION = 'v1';

/**
 * Validate an EncryptedMessage object (the canonical wire format).
 *
 * Expected shape:
 * {
 *   id: string (UUID),
 *   conversationId: string (UUID),
 *   senderId: string (UUID),
 *   timestamp: number,
 *   payload: { ciphertext: string, iv: string, version: string }
 * }
 *
 * @param {unknown} msg
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEncryptedMessage(msg) {
  const errors = [];

  if (!msg || typeof msg !== 'object') {
    return { valid: false, errors: ['Message must be an object'] };
  }

  const m = /** @type {Record<string, unknown>} */ (msg);

  if (!m.id || typeof m.id !== 'string') errors.push('id must be a non-empty string');
  if (!m.conversationId || typeof m.conversationId !== 'string') errors.push('conversationId must be a non-empty string');
  if (!m.senderId || typeof m.senderId !== 'string') errors.push('senderId must be a non-empty string');
  if (typeof m.timestamp !== 'number' || m.timestamp <= 0) errors.push('timestamp must be a positive number');

  if (!m.payload || typeof m.payload !== 'object') {
    errors.push('payload must be an object');
  } else {
    const p = /** @type {Record<string, unknown>} */ (m.payload);
    if (!p.ciphertext || typeof p.ciphertext !== 'string') errors.push('payload.ciphertext must be a non-empty string');
    if (!p.iv || typeof p.iv !== 'string') errors.push('payload.iv must be a non-empty string');
    if (!p.version || typeof p.version !== 'string') errors.push('payload.version must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a KeyExchangePayload object.
 *
 * @param {unknown} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateKeyExchange(payload) {
  const errors = [];

  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }

  const p = /** @type {Record<string, unknown>} */ (payload);

  if (!p.conversationId || typeof p.conversationId !== 'string') errors.push('conversationId must be a non-empty string');
  if (!p.userId || typeof p.userId !== 'string') errors.push('userId must be a non-empty string');
  if (!p.deviceId || typeof p.deviceId !== 'string') errors.push('deviceId must be a non-empty string');
  if (!p.ephemeralPublicKey || typeof p.ephemeralPublicKey !== 'object') errors.push('ephemeralPublicKey must be a JWK object');

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a Device registration payload.
 *
 * @param {unknown} device
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateDevice(device) {
  const errors = [];

  if (!device || typeof device !== 'object') {
    return { valid: false, errors: ['Device must be an object'] };
  }

  const d = /** @type {Record<string, unknown>} */ (device);

  if (!d.identityPublicKey || typeof d.identityPublicKey !== 'object') errors.push('identityPublicKey must be a JWK object');
  if (!d.ecdhPublicKey || typeof d.ecdhPublicKey !== 'object') errors.push('ecdhPublicKey must be a JWK object');

  return { valid: errors.length === 0, errors };
}

module.exports = {
  PAYLOAD_VERSION,
  validateEncryptedMessage,
  validateKeyExchange,
  validateDevice,
};
