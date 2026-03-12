/**
 * Browser crypto provider using the Web Crypto API (window.crypto.subtle).
 * All operations are async and return Promises.
 * Keys are represented as JWK objects.
 */

const subtle = globalThis.crypto && globalThis.crypto.subtle;

/**
 * Generate an ECDSA P-256 identity key pair.
 * @returns {Promise<{ publicKey: Object, privateKey: Object }>} JWK objects
 */
async function generateIdentityKey() {
  const keyPair = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
  );
  const [publicKey, privateKey] = await Promise.all([
    subtle.exportKey('jwk', keyPair.publicKey),
    subtle.exportKey('jwk', keyPair.privateKey),
  ]);
  return { publicKey, privateKey };
}

/**
 * Generate an ECDH P-256 key pair.
 * @returns {Promise<{ publicKey: Object, privateKey: Object }>} JWK objects
 */
async function generateECDHKey() {
  const keyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey', 'deriveBits']
  );
  const [publicKey, privateKey] = await Promise.all([
    subtle.exportKey('jwk', keyPair.publicKey),
    subtle.exportKey('jwk', keyPair.privateKey),
  ]);
  return { publicKey, privateKey };
}

/**
 * Derive a raw shared secret using ECDH.
 * @param {Object} privateKeyJwk
 * @param {Object} publicKeyJwk
 * @returns {Promise<ArrayBuffer>}
 */
async function deriveSharedSecret(privateKeyJwk, publicKeyJwk) {
  const [privKey, pubKey] = await Promise.all([
    subtle.importKey('jwk', privateKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
    subtle.importKey('jwk', publicKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []),
  ]);

  return subtle.deriveBits({ name: 'ECDH', public: pubKey }, privKey, 256);
}

/**
 * Derive an AES-256-GCM CryptoKey from a shared secret using HKDF.
 * @param {ArrayBuffer} sharedSecretBuffer
 * @param {string} salt
 * @returns {Promise<CryptoKey>}
 */
async function deriveConversationKey(sharedSecretBuffer, salt) {
  const saltBuf = new TextEncoder().encode(salt);
  const info = new TextEncoder().encode('blink-text-v1');

  const baseKey = await subtle.importKey(
    'raw',
    sharedSecretBuffer,
    { name: 'HKDF' },
    false,
    ['deriveKey']
  );

  return subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: saltBuf, info },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * @param {CryptoKey} conversationKey
 * @param {string} plaintext
 * @returns {Promise<{ ciphertext: string, iv: string }>} base64 strings
 */
async function encryptMessage(conversationKey, plaintext) {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const ciphertextBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    conversationKey,
    encoded
  );

  return {
    ciphertext: _bufToBase64(ciphertextBuf),
    iv: _bufToBase64(iv.buffer),
  };
}

/**
 * Decrypt an AES-256-GCM ciphertext.
 * @param {CryptoKey} conversationKey
 * @param {string} ciphertext - base64
 * @param {string} iv - base64
 * @returns {Promise<string>} plaintext
 */
async function decryptMessage(conversationKey, ciphertext, iv) {
  const ciphertextBuf = _base64ToBuf(ciphertext);
  const ivBuf = _base64ToBuf(iv);

  const plainBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: ivBuf },
    conversationKey,
    ciphertextBuf
  );

  return new TextDecoder().decode(plainBuf);
}

/**
 * Sign data with an ECDSA P-256 private key.
 * @param {Object} privateKeyJwk
 * @param {string} data
 * @returns {Promise<string>} base64 signature
 */
async function signData(privateKeyJwk, data) {
  const privKey = await subtle.importKey(
    'jwk',
    privateKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign']
  );
  const encoded = new TextEncoder().encode(data);
  const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, encoded);
  return _bufToBase64(sig);
}

/**
 * Verify an ECDSA P-256 signature.
 * @param {Object} publicKeyJwk
 * @param {string} data
 * @param {string} signature - base64
 * @returns {Promise<boolean>}
 */
async function verifySignature(publicKeyJwk, data, signature) {
  const pubKey = await subtle.importKey(
    'jwk',
    publicKeyJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
  const encoded = new TextEncoder().encode(data);
  const sigBuf = _base64ToBuf(signature);
  return subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, sigBuf, encoded);
}

// --- helpers ---

function _bufToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function _base64ToBuf(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export default {
  generateIdentityKey,
  generateECDHKey,
  deriveSharedSecret,
  deriveConversationKey,
  encryptMessage,
  decryptMessage,
  signData,
  verifySignature,
};
