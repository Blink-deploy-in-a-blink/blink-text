'use strict';

const engine = require('./engine');

/**
 * Encrypt a plaintext message for a conversation.
 * @param {Buffer} conversationKey - 32-byte AES-256-GCM key
 * @param {string} plaintext
 * @returns {{ ciphertext: string, iv: string }} base64-encoded values
 */
function encryptMessage(conversationKey, plaintext) {
  return engine.encryptMessage(conversationKey, plaintext);
}

/**
 * Decrypt an AES-256-GCM encrypted message.
 * @param {Buffer} conversationKey - 32-byte AES-256-GCM key
 * @param {string} ciphertext - base64
 * @param {string} iv - base64
 * @returns {string} plaintext
 */
function decryptMessage(conversationKey, ciphertext, iv) {
  return engine.decryptMessage(conversationKey, ciphertext, iv);
}

module.exports = { encryptMessage, decryptMessage };
