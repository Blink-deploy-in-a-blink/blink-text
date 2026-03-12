'use strict';

const engine = require('./engine');

// In-memory store for conversation keys: conversationId -> key (Buffer)
const conversationKeys = new Map();

/**
 * Generate an ephemeral ECDH key pair to initiate a key exchange.
 * @returns {{ ephemeralPublicKey: Object, ephemeralPrivateKey: Object }} JWK objects
 */
function initiateKeyExchange() {
  const { publicKey: ephemeralPublicKey, privateKey: ephemeralPrivateKey } =
    engine.generateECDHKey();
  return { ephemeralPublicKey, ephemeralPrivateKey };
}

/**
 * Complete the key exchange: derive a shared conversation key.
 * @param {Object} myEphemeralPrivateKey  - JWK private key
 * @param {Object} theirEphemeralPublicKey - JWK public key
 * @param {string} conversationId          - used as HKDF salt
 * @returns {Buffer} 32-byte conversation key
 */
function completeKeyExchange(myEphemeralPrivateKey, theirEphemeralPublicKey, conversationId) {
  const sharedSecret = engine.deriveSharedSecret(
    myEphemeralPrivateKey,
    theirEphemeralPublicKey
  );
  return engine.deriveConversationKey(sharedSecret, conversationId);
}

/**
 * Store a derived conversation key in memory (and localStorage if available).
 * @param {string} conversationId
 * @param {Buffer} key
 */
function storeConversationKey(conversationId, key) {
  conversationKeys.set(conversationId, key);

  if (typeof localStorage !== 'undefined') {
    const keyB64 = Buffer.from(key).toString('base64');
    const stored = JSON.parse(localStorage.getItem('blink-text-conv-keys') || '{}');
    stored[conversationId] = keyB64;
    localStorage.setItem('blink-text-conv-keys', JSON.stringify(stored));
  }
}

/**
 * Retrieve a stored conversation key.
 * @param {string} conversationId
 * @returns {Buffer | null}
 */
function getConversationKey(conversationId) {
  if (conversationKeys.has(conversationId)) {
    return conversationKeys.get(conversationId);
  }

  if (typeof localStorage !== 'undefined') {
    const stored = JSON.parse(localStorage.getItem('blink-text-conv-keys') || '{}');
    if (stored[conversationId]) {
      const key = Buffer.from(stored[conversationId], 'base64');
      conversationKeys.set(conversationId, key);
      return key;
    }
  }

  return null;
}

module.exports = {
  initiateKeyExchange,
  completeKeyExchange,
  storeConversationKey,
  getConversationKey,
};
