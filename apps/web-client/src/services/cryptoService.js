// Client-side crypto service using the @blink-text/crypto browser provider.
import { CryptoEngine, BrowserProvider } from '@blink-text/crypto';
import { registerDevice, storeKeyExchange, getKeyExchange } from './api.js';

// Engine backed by browser Web Crypto API
const engine = new CryptoEngine(new BrowserProvider());

// In-memory conversation key store: conversationId -> Uint8Array
const conversationKeys = new Map();
// Track which peer public key was used to derive each conversation key
// conversationId -> JSON string of peer's ephemeral public JWK
const conversationKeyFingerprints = new Map();

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
 * If the peer hasn't published their key yet, retries a few times.
 * Always checks whether the peer has re-keyed and re-derives if so.
 */
export async function setupConversationKey(conversationId, myUserId) {
  if (!deviceId) throw new Error('Device not initialized. Call initializeIdentity() first.');

  // Reuse an existing ephemeral key if we already published one for this conversation,
  // otherwise generate and publish a new one.
  let ephemeralPair;
  const storedPrivate = loadFromStorage(`blink-ephemeral-${conversationId}`);

  if (storedPrivate) {
    // We already published our ephemeral key — reuse the private half.
    ephemeralPair = { privateKey: storedPrivate };
  } else {
    ephemeralPair = await engine.generateECDHKey();
    try {
      await storeKeyExchange(conversationId, deviceId, ephemeralPair.publicKey);
    } catch (err) {
      // If the device is no longer recognised (e.g. DB was recreated), re-register
      if (err.response?.status === 400) {
        console.warn('[crypto] Device rejected, re-registering…');
        const device = await registerDevice(
          identityKeypair.publicKey,
          ecdhKeypair.publicKey,
          navigator.userAgent.slice(0, 64)
        );
        deviceId = device.id;
        saveToStorage('blink-device-id', deviceId);
        await storeKeyExchange(conversationId, deviceId, ephemeralPair.publicKey);
      } else {
        throw err;
      }
    }
    saveToStorage(`blink-ephemeral-${conversationId}`, ephemeralPair.privateKey);
  }

  // Try to find the peer's ephemeral key, with retries
  const maxRetries = 8;
  for (let i = 0; i < maxRetries; i++) {
    const exchangeData = await getKeyExchange(conversationId);
    const peerEntry = exchangeData.find((e) => e.userId !== myUserId);

    if (peerEntry) {
      const peerFingerprint = JSON.stringify(peerEntry.ephemeralPublicKey);
      const existingFingerprint = conversationKeyFingerprints.get(conversationId);

      // Derive (or re-derive if the peer has a new key)
      if (!conversationKeys.has(conversationId) || existingFingerprint !== peerFingerprint) {
        if (existingFingerprint && existingFingerprint !== peerFingerprint) {
          console.warn('[crypto] Peer re-keyed for', conversationId, '— re-deriving conversation key');
        }
        await _deriveAndStore(conversationId, ephemeralPair.privateKey, peerEntry.ephemeralPublicKey);
      }
      return;
    }

    // Wait before retrying (500ms, 1s, 1.5s, ...)
    if (i < maxRetries - 1) {
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  // No peer key found after retries — key will be derived later via socket key_exchange event
}

/**
 * Called by the socket key_exchange handler when a peer's ephemeral key arrives.
 * Always re-derives if the peer's key is different from what we used last time.
 */
export async function completeKeyExchangeFromSocket(conversationId, theirEphemeralPublicKey) {
  const peerFingerprint = JSON.stringify(theirEphemeralPublicKey);
  const existingFingerprint = conversationKeyFingerprints.get(conversationId);

  // Skip only if we already derived with this exact key
  if (conversationKeys.has(conversationId) && existingFingerprint === peerFingerprint) return;

  const ephemeralPrivateKey = loadFromStorage(`blink-ephemeral-${conversationId}`);
  if (!ephemeralPrivateKey) return;

  if (existingFingerprint && existingFingerprint !== peerFingerprint) {
    console.warn('[crypto] Peer re-keyed via socket for', conversationId, '— re-deriving');
  }

  await _deriveAndStore(conversationId, ephemeralPrivateKey, theirEphemeralPublicKey);
}

async function _deriveAndStore(conversationId, myPrivateKey, theirPublicKey) {
  const key = await engine.deriveConversationKeyFromExchange(myPrivateKey, theirPublicKey, conversationId);
  conversationKeys.set(conversationId, key);
  // Store a fingerprint so we can detect when the peer re-keys
  conversationKeyFingerprints.set(conversationId, JSON.stringify(theirPublicKey));
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
