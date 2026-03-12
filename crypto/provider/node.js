'use strict';

const crypto = require('crypto');

/**
 * Node.js crypto provider.
 * All public/private keys are represented as JWK objects (plain JS objects).
 * Symmetric keys are represented as Buffer instances.
 */

/**
 * Generate an ECDSA P-256 identity key pair (for signing).
 * @returns {{ publicKey: Object, privateKey: Object }} JWK objects
 */
function generateIdentityKey() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'der' },
    privateKeyEncoding: { type: 'pkcs8', format: 'der' },
  });

  // Re-import as KeyObject to export as JWK
  const pubKeyObj = crypto.createPublicKey({ key: publicKey, format: 'der', type: 'spki' });
  const privKeyObj = crypto.createPrivateKey({ key: privateKey, format: 'der', type: 'pkcs8' });

  return {
    publicKey: pubKeyObj.export({ format: 'jwk' }),
    privateKey: privKeyObj.export({ format: 'jwk' }),
  };
}

/**
 * Generate an ECDH P-256 key pair (for key exchange).
 * @returns {{ publicKey: Object, privateKey: Object }} JWK objects
 */
function generateECDHKey() {
  return _generateECDHKeyPair();
}

/** @private */
function _generateECDHKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ec', {
    namedCurve: 'P-256',
  });
  return {
    publicKey: publicKey.export({ format: 'jwk' }),
    privateKey: privateKey.export({ format: 'jwk' }),
  };
}

/**
 * Derive a shared secret using ECDH.
 * @param {Object} privateKeyJwk - JWK private key
 * @param {Object} publicKeyJwk  - JWK public key
 * @returns {Buffer} raw shared secret
 */
function deriveSharedSecret(privateKeyJwk, publicKeyJwk) {
  const privKey = crypto.createPrivateKey({ key: privateKeyJwk, format: 'jwk' });
  const pubKey = crypto.createPublicKey({ key: publicKeyJwk, format: 'jwk' });

  return crypto.diffieHellman({ privateKey: privKey, publicKey: pubKey });
}

/**
 * Derive a 256-bit conversation key from a shared secret using HKDF.
 * @param {Buffer} sharedSecret
 * @param {string|Buffer} salt
 * @returns {Buffer} 32-byte derived key
 */
function deriveConversationKey(sharedSecret, salt) {
  const saltBuf = typeof salt === 'string' ? Buffer.from(salt, 'utf8') : salt;
  return crypto.hkdfSync('sha256', sharedSecret, saltBuf, Buffer.from('blink-text-v1'), 32);
}

/**
 * Encrypt plaintext with AES-256-GCM.
 * @param {Buffer} keyBuffer - 32-byte key
 * @param {string} plaintext
 * @returns {{ ciphertext: string, iv: string }} base64-encoded values
 */
function encryptMessage(keyBuffer, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', keyBuffer, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  // Prepend auth tag to ciphertext so it travels together
  const combined = Buffer.concat([tag, encrypted]);

  return {
    ciphertext: combined.toString('base64'),
    iv: iv.toString('base64'),
  };
}

/**
 * Decrypt AES-256-GCM ciphertext.
 * @param {Buffer} keyBuffer - 32-byte key
 * @param {string} ciphertext - base64
 * @param {string} iv - base64
 * @returns {string} plaintext
 */
function decryptMessage(keyBuffer, ciphertext, iv) {
  const ivBuf = Buffer.from(iv, 'base64');
  const combined = Buffer.from(ciphertext, 'base64');
  const tag = combined.slice(0, 16);
  const encrypted = combined.slice(16);

  const decipher = crypto.createDecipheriv('aes-256-gcm', keyBuffer, ivBuf);
  decipher.setAuthTag(tag);

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Sign data with an ECDSA P-256 private key.
 * @param {Object} privateKeyJwk
 * @param {string|Buffer} data
 * @returns {string} base64-encoded DER signature
 */
function signData(privateKeyJwk, data) {
  const privKey = crypto.createPrivateKey({ key: privateKeyJwk, format: 'jwk' });
  const dataBuf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const signature = crypto.sign('SHA256', dataBuf, privKey);
  return signature.toString('base64');
}

/**
 * Verify an ECDSA P-256 signature.
 * @param {Object} publicKeyJwk
 * @param {string|Buffer} data
 * @param {string} signature - base64
 * @returns {boolean}
 */
function verifySignature(publicKeyJwk, data, signature) {
  const pubKey = crypto.createPublicKey({ key: publicKeyJwk, format: 'jwk' });
  const dataBuf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
  const sigBuf = Buffer.from(signature, 'base64');
  return crypto.verify('SHA256', dataBuf, pubKey, sigBuf);
}

module.exports = {
  generateIdentityKey,
  generateECDHKey: _generateECDHKeyPair,
  deriveSharedSecret,
  deriveConversationKey,
  encryptMessage,
  decryptMessage,
  signData,
  verifySignature,
};
