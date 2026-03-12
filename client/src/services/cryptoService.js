// Client-side crypto service using the browser Web Crypto provider.
import browserProvider from '../../crypto/provider/browser.js';
import { uploadPublicKeys, storeKeyExchange, getKeyExchange } from './api.js';

// In-memory conversation key store: conversationId -> CryptoKey
const conversationKeys = new Map();

// Cached identity keypair
let identityKeypair = null;
// Cached ECDH keypair
let ecdhKeypair = null;

function _loadFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function _saveToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Load or generate an identity keypair and upload the public key to the server.
 */
export async function initializeIdentity() {
  // Try to load existing identity keys from localStorage
  identityKeypair = _loadFromStorage('blink-identity-key');
  ecdhKeypair = _loadFromStorage('blink-ecdh-key');

  if (!identityKeypair) {
    identityKeypair = await browserProvider.generateIdentityKey();
    _saveToStorage('blink-identity-key', identityKeypair);
  }

  if (!ecdhKeypair) {
    ecdhKeypair = await browserProvider.generateECDHKey();
    _saveToStorage('blink-ecdh-key', ecdhKeypair);
  }

  await uploadPublicKeys(identityKeypair.publicKey, ecdhKeypair.publicKey);
  return { identityPublicKey: identityKeypair.publicKey, ecdhPublicKey: ecdhKeypair.publicKey };
}

/**
 * Set up a conversation key via ECDH key exchange.
 * Generates an ephemeral key pair, publishes the public half, then waits for
 * the peer's key (either already on the server or arriving over the socket)
 * to derive a shared conversation key.
 *
 * @param {string} conversationId
 * @param {string} myUserId
 * @returns {Promise<void>}
 */
export async function setupConversationKey(conversationId, myUserId) {
  // Generate ephemeral key pair for this conversation
  const ephemeralPair = await browserProvider.generateECDHKey();

  // Upload our ephemeral public key to the server
  await storeKeyExchange(conversationId, ephemeralPair.publicKey);

  // Fetch any existing key exchange data for this conversation
  const exchangeData = await getKeyExchange(conversationId);
  const peerEntry = exchangeData.find((e) => e.user_id !== myUserId);

  if (peerEntry) {
    await _deriveAndStore(conversationId, ephemeralPair.privateKey, peerEntry.ephemeral_public_key);
  }
  // If no peer entry yet, the socket onKeyExchange handler should call
  // completeKeyExchangeFromSocket() when the peer's key arrives.

  // Store ephemeral private key temporarily so the socket handler can use it
  _saveToStorage(`blink-ephemeral-${conversationId}`, ephemeralPair.privateKey);
}

/**
 * Called by the socket key_exchange handler when a peer's ephemeral key arrives.
 * @param {string} conversationId
 * @param {Object} theirEphemeralPublicKey
 */
export async function completeKeyExchangeFromSocket(conversationId, theirEphemeralPublicKey) {
  if (conversationKeys.has(conversationId)) return; // already set up

  const ephemeralPrivateKey = _loadFromStorage(`blink-ephemeral-${conversationId}`);
  if (!ephemeralPrivateKey) return;

  await _deriveAndStore(conversationId, ephemeralPrivateKey, theirEphemeralPublicKey);
}

/** @private */
async function _deriveAndStore(conversationId, myPrivateKey, theirPublicKey) {
  const sharedSecret = await browserProvider.deriveSharedSecret(myPrivateKey, theirPublicKey);
  const conversationKey = await browserProvider.deriveConversationKey(sharedSecret, conversationId);
  conversationKeys.set(conversationId, conversationKey);
}

/**
 * Encrypt a plaintext message for a given conversation.
 * @param {string} conversationId
 * @param {string} plaintext
 * @returns {Promise<{ ciphertext: string, iv: string }>}
 */
export async function encryptAndSend(conversationId, plaintext) {
  const key = conversationKeys.get(conversationId);
  if (!key) throw new Error(`No conversation key for ${conversationId}. Run setupConversationKey first.`);
  return browserProvider.encryptMessage(key, plaintext);
}

/**
 * Decrypt an incoming encrypted message.
 * @param {string} conversationId
 * @param {{ ciphertext: string, iv: string }} encryptedPayload
 * @returns {Promise<string>} plaintext
 */
export async function decryptMessage(conversationId, encryptedPayload) {
  const key = conversationKeys.get(conversationId);
  if (!key) throw new Error(`No conversation key for ${conversationId}`);
  return browserProvider.decryptMessage(key, encryptedPayload.ciphertext, encryptedPayload.iv);
}

export function hasConversationKey(conversationId) {
  return conversationKeys.has(conversationId);
}
