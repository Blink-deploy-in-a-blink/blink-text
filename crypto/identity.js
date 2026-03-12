'use strict';

const fs = require('fs');
const path = require('path');
const engine = require('./engine');

const IDENTITY_KEY_PATH = path.join(
  process.env.HOME || process.cwd(),
  '.blink-text-identity.json'
);

/**
 * Generate an ECDSA P-256 identity key pair.
 * @returns {{ publicKey: Object, privateKey: Object }}
 */
function generateIdentityKeypair() {
  return engine.generateIdentityKey();
}

/**
 * Persist a key pair to disk (Node) or localStorage (browser).
 * @param {{ publicKey: Object, privateKey: Object }} keypair
 */
function storeIdentityKey(keypair) {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem('blink-text-identity', JSON.stringify(keypair));
  } else {
    fs.writeFileSync(IDENTITY_KEY_PATH, JSON.stringify(keypair), { mode: 0o600 });
  }
}

/**
 * Load a persisted identity key pair, or return null if none exists.
 * @returns {{ publicKey: Object, privateKey: Object } | null}
 */
function loadIdentityKey() {
  if (typeof localStorage !== 'undefined') {
    const raw = localStorage.getItem('blink-text-identity');
    return raw ? JSON.parse(raw) : null;
  }

  if (fs.existsSync(IDENTITY_KEY_PATH)) {
    try {
      return JSON.parse(fs.readFileSync(IDENTITY_KEY_PATH, 'utf8'));
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Extract the public portion of an identity key pair as a JWK.
 * @param {{ publicKey: Object }} keypair
 * @returns {Object} JWK
 */
function exportPublicKey(keypair) {
  return keypair.publicKey;
}

module.exports = {
  generateIdentityKeypair,
  storeIdentityKey,
  loadIdentityKey,
  exportPublicKey,
};
