// Client-side crypto service using the @blink-text/crypto browser provider.
import { CryptoEngine, BrowserProvider } from '@blink-text/crypto';
import { registerDevice, storeKeyExchange, getKeyExchange } from './api.js';

// Engine backed by browser Web Crypto API
const engine = new CryptoEngine(new BrowserProvider());

// In-memory conversation key store: conversationId -> Uint8Array
const conversationKeys = new Map();

let identityKeypair = null;
let ecdhKeypair = null;
let deviceId = null;

function loadFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveToStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

/**
 * Load or generate an identity keypair + ECDH keypair, register as a device on the server.
 */
export async function initializeIdentity() {
  identityKeypair = loadFromStorage('blink-identity-key');
  ecdhKeypair = loadFromStorage('blink-ecdh-key');
  deviceId = loadFromStorage('blink-device-id');

  if (!identityKeypair) {
    identityKeypair = await engine.generateIdentityKey();
    saveToStorage('blink-identity-key', identityKeypair);
  }

  if (!ecdhKeypair) {
    ecdhKeypair = await engine.generateECDHKey();
    saveToStorage('blink-ecdh-key', ecdhKeypair);
  }

  if (!deviceId) {
    const device = await registerDevice(
      identityKeypair.publicKey,
      ecdhKeypair.publicKey,
      navigator.userAgent.slice(0, 64)
    );
    deviceId = device.id;
    saveToStorage('blink-device-id', deviceId);
  }

  return {
    identityPublicKey: identityKeypair.publicKey,
    ecdhPublicKey: ecdhKeypair.publicKey,
    deviceId,
  };
}

/**
 * Set up a conversation key via ECDH key exchange.
 */
export async function setupConversationKey(conversationId, myUserId) {
  if (!deviceId) throw new Error('Device not initialized. Call initializeIdentity() first.');

  const ephemeralPair = await engine.generateECDHKey();

  await storeKeyExchange(conversationId, deviceId, ephemeralPair.publicKey);

  const exchangeData = await getKeyExchange(conversationId);
  const peerEntry = exchangeData.find((e) => e.userId !== myUserId);

  if (peerEntry) {
    await _deriveAndStore(conversationId, ephemeralPair.privateKey, peerEntry.ephemeralPublicKey);
  }

  saveToStorage(`blink-ephemeral-${conversationId}`, ephemeralPair.privateKey);
}

/**
 * Called by the socket key_exchange handler when a peer's ephemeral key arrives.
 */
export async function completeKeyExchangeFromSocket(conversationId, theirEphemeralPublicKey) {
  if (conversationKeys.has(conversationId)) return;

  const ephemeralPrivateKey = loadFromStorage(`blink-ephemeral-${conversationId}`);
  if (!ephemeralPrivateKey) return;

  await _deriveAndStore(conversationId, ephemeralPrivateKey, theirEphemeralPublicKey);
}

async function _deriveAndStore(conversationId, myPrivateKey, theirPublicKey) {
  const key = await engine.deriveConversationKeyFromExchange(myPrivateKey, theirPublicKey, conversationId);
  conversationKeys.set(conversationId, key);
}

/**
 * Encrypt a plaintext message for a given conversation.
 * Returns an EncryptedPayload.
 */
export async function encryptForConversation(conversationId, plaintext) {
  const key = conversationKeys.get(conversationId);
  if (!key) throw new Error(`No conversation key for ${conversationId}. Run setupConversationKey first.`);
  return engine.encryptMessage(key, plaintext);
}

/**
 * Decrypt an incoming EncryptedMessage payload.
 */
export async function decryptConversationMessage(conversationId, encryptedPayload) {
  const key = conversationKeys.get(conversationId);
  if (!key) throw new Error(`No conversation key for ${conversationId}`);
  return engine.decryptMessage(key, encryptedPayload);
}

export function hasConversationKey(conversationId) {
  return conversationKeys.has(conversationId);
}

export function getDeviceId() {
  return deviceId;
}
