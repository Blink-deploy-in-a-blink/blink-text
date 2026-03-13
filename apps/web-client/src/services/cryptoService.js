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

// --- Secure key storage using IndexedDB (avoids storing private keys in localStorage) ---
const KEY_DB_NAME = 'blink-crypto';
const KEY_DB_VERSION = 1;
const KEY_STORE_NAME = 'keys';

function openKeyDatabase() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      return reject(new Error('IndexedDB not supported'));
    }
    const request = indexedDB.open(KEY_DB_NAME, KEY_DB_VERSION);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(KEY_STORE_NAME)) {
        db.createObjectStore(KEY_STORE_NAME);
      }
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onerror = () => {
      reject(request.error || new Error('Failed to open key database'));
    };
  });
}

async function loadKeyFromSecureStore(key) {
  try {
    const db = await openKeyDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readonly');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to load key'));
      };
    });
  } catch {
    // Fallback: do not throw during initialization, just act as if no key is stored.
    return null;
  }
}

async function saveKeyToSecureStore(key, value) {
  try {
    const db = await openKeyDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readwrite');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => {
        resolve();
      };
      request.onerror = () => {
        reject(request.error || new Error('Failed to save key'));
      };
    });
  } catch {
    // If secure storage is unavailable, do NOT fall back to localStorage
    // for private keys, in order to avoid leaking them.
  }
}

/**
 * Load or generate an identity keypair + ECDH keypair, register as a device on the server.
 */
export async function initializeIdentity() {
  // Load keypairs from secure IndexedDB-backed storage
  identityKeypair = await loadKeyFromSecureStore('blink-identity-key');
  ecdhKeypair = await loadKeyFromSecureStore('blink-ecdh-key');
  // Device identifier is not sensitive cryptographic material; localStorage is acceptable here.
  deviceId = loadFromStorage('blink-device-id');

  if (!identityKeypair) {
    identityKeypair = await engine.generateIdentityKey();
    await saveKeyToSecureStore('blink-identity-key', identityKeypair);
  }

  if (!ecdhKeypair) {
    ecdhKeypair = await engine.generateECDHKey();
    await saveKeyToSecureStore('blink-ecdh-key', ecdhKeypair);
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
