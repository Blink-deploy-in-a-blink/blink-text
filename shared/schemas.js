'use strict';

/**
 * Encrypted message structure sent over the wire and stored in DB.
 * @typedef {Object} EncryptedMessage
 * @property {string} conversation_id - UUID of the conversation
 * @property {string} sender_id       - UUID of the sending user
 * @property {string} ciphertext      - Base64-encoded AES-256-GCM ciphertext
 * @property {string} iv              - Base64-encoded 12-byte IV
 * @property {number} timestamp       - Unix timestamp (ms)
 */

/**
 * Key exchange payload stored server-side so peers can retrieve
 * each other's ephemeral public keys.
 * @typedef {Object} KeyExchangePayload
 * @property {string} conversation_id      - UUID of the conversation
 * @property {string} user_id             - UUID of the key owner
 * @property {Object} ephemeral_public_key - JWK-formatted ECDH public key
 */

/**
 * Validates an EncryptedMessage object.
 * @param {EncryptedMessage} msg
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateEncryptedMessage(msg) {
  const errors = [];
  if (!msg || typeof msg !== 'object') {
    return { valid: false, errors: ['Message must be an object'] };
  }
  if (!msg.conversation_id || typeof msg.conversation_id !== 'string') {
    errors.push('conversation_id must be a non-empty string');
  }
  if (!msg.sender_id || typeof msg.sender_id !== 'string') {
    errors.push('sender_id must be a non-empty string');
  }
  if (!msg.ciphertext || typeof msg.ciphertext !== 'string') {
    errors.push('ciphertext must be a non-empty base64 string');
  }
  if (!msg.iv || typeof msg.iv !== 'string') {
    errors.push('iv must be a non-empty base64 string');
  }
  if (msg.timestamp !== undefined && typeof msg.timestamp !== 'number') {
    errors.push('timestamp must be a number');
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Validates a KeyExchangePayload object.
 * @param {KeyExchangePayload} payload
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validateKeyExchange(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') {
    return { valid: false, errors: ['Payload must be an object'] };
  }
  if (!payload.conversation_id || typeof payload.conversation_id !== 'string') {
    errors.push('conversation_id must be a non-empty string');
  }
  if (!payload.user_id || typeof payload.user_id !== 'string') {
    errors.push('user_id must be a non-empty string');
  }
  if (!payload.ephemeral_public_key || typeof payload.ephemeral_public_key !== 'object') {
    errors.push('ephemeral_public_key must be a JWK object');
  }
  return { valid: errors.length === 0, errors };
}

module.exports = { validateEncryptedMessage, validateKeyExchange };
