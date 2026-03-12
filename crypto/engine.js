'use strict';

/**
 * Crypto engine: provider-agnostic facade.
 *
 * In a Node.js environment it uses the Node provider (CommonJS).
 * In a browser (bundled) environment the caller should import
 * the browser provider directly from crypto/provider/browser.js.
 *
 * This file uses CommonJS so it can be required by server-side code.
 */

let provider;

if (typeof window === 'undefined') {
  // Node.js environment
  provider = require('./provider/node');
} else {
  // Browser environment — callers should use the ES-module browser provider.
  // This fallback is here only if engine.js is somehow loaded in the browser.
  throw new Error(
    'In a browser, import the crypto engine via crypto/provider/browser.js instead.'
  );
}

const {
  generateIdentityKey,
  generateECDHKey,
  deriveSharedSecret,
  deriveConversationKey,
  encryptMessage,
  decryptMessage,
  signData,
  verifySignature,
} = provider;

module.exports = {
  generateIdentityKey,
  generateECDHKey,
  deriveSharedSecret,
  deriveConversationKey,
  encryptMessage,
  decryptMessage,
  signData,
  verifySignature,
};
