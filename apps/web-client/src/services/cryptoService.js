// Client-side crypto service using the @blink-text/crypto browser provider.
import { CryptoEngine, BrowserProvider } from '@blink-text/crypto';
import { registerDevice, storeKeyExchange, getKeyExchange } from './api.js';
import { sendKeyExchange, joinConversation } from './socket.js';

// Engine backed by browser Web Crypto API
const engine = new CryptoEngine(new BrowserProvider());

// In-memory conversation key store: conversationId -> Uint8Array
const conversationKeys = new Map();
// Track which peer public key was used to derive each conversation key
// conversationId -> JSON string of peer's ephemeral public JWK
const conversationKeyFingerprints = new Map();
// In-memory ephemeral private keys — used to avoid the race condition where
// completeKeyExchangeFromSocket is called before localStorage.setItem finishes
// conversationId -> privateKey object
const ephemeralPrivateKeys = new Map();

// Per-conversation setup lock to prevent concurrent calls from racing.
// conversationId -> Promise  (resolves when the in-flight setup finishes)
const setupLocks = new Map();

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

async function clearSecureStore() {
  try {
    const db = await openKeyDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readwrite');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // If clear fails, not critical
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

  // Migrate any ephemeral keys from old localStorage format to IndexedDB
  await _migrateEphemeralKeys();

  return {
    identityPublicKey: identityKeypair.publicKey,
    ecdhPublicKey: ecdhKeypair.publicKey,
    deviceId,
  };
}

/**
 * Migrate ephemeral keys from localStorage to IndexedDB (one-time).
 * Called during identity init to preserve keys from the old storage format.
 */
async function _migrateEphemeralKeys() {
  const keysToMigrate = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('blink-ephemeral-')) {
      keysToMigrate.push(key);
    }
  }
  for (const lsKey of keysToMigrate) {
    try {
      const conversationId = lsKey.replace('blink-ephemeral-', '');
      const value = JSON.parse(localStorage.getItem(lsKey));
      if (value) {
        await saveKeyToSecureStore(`ephemeral-${conversationId}`, value);
        ephemeralPrivateKeys.set(conversationId, value);
        localStorage.removeItem(lsKey);
      }
    } catch {
      // Skip failed migrations
    }
  }
}

/**
 * Set up a conversation key via ECDH key exchange.
 * If the peer hasn't published their key yet, retries a few times.
 * Always checks whether the peer has re-keyed and re-derives if so.
 *
 * A per-conversation lock prevents concurrent calls (e.g. background preloader
 * and useMessages) from racing and overwriting each other's ephemeral keys.
 *
 * @param {string} conversationId
 * @param {string} myUserId
 * @param {object} [options]
 * @param {number} [options.maxRetries=3] - Number of retries (use 0 for fire-and-forget preloading)
 * @param {number} [options.retryDelay=400] - Base delay in ms between retries
 */
export async function setupConversationKey(conversationId, myUserId, { maxRetries = 3, retryDelay = 400 } = {}) {
  // Wait for any in-progress setup for this same conversation to finish first.
  let existingLock = setupLocks.get(conversationId);
  while (existingLock) {
    await existingLock;
    existingLock = setupLocks.get(conversationId);
  }

  // After waiting, the previous call may have already established the key.
  if (conversationKeys.has(conversationId)) return;

  let releaseLock;
  const lock = new Promise((r) => { releaseLock = r; });
  setupLocks.set(conversationId, lock);

  try {
    await _doSetupConversationKey(conversationId, myUserId, { maxRetries, retryDelay });
  } finally {
    setupLocks.delete(conversationId);
    releaseLock();
  }
}

/**
 * Pick the most-recent peer key exchange entry (Issue 2.3).
 * Sorts by createdAt descending so that stale entries from old devices
 * don't shadow the latest one.
 */
function _findLatestPeerEntry(exchangeData, myUserId) {
  return exchangeData
    .filter((e) => e.userId !== myUserId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

/**
 * Internal implementation — always called under the per-conversation lock.
 */
async function _doSetupConversationKey(conversationId, myUserId, { maxRetries = 3, retryDelay = 400 } = {}) {
  if (!deviceId) throw new Error('Device not initialized. Call initializeIdentity() first.');

  // Always join the socket room so we can receive key_exchange events
  joinConversation(conversationId);

  // Reuse an existing ephemeral key if we already published one for this conversation,
  // otherwise generate and publish a new one.
  let ephemeralPair;
  // Check in-memory first, then IndexedDB
  const storedPrivate = ephemeralPrivateKeys.get(conversationId)
    || await loadKeyFromSecureStore(`ephemeral-${conversationId}`);

  if (storedPrivate) {
    // We already published our ephemeral key — reuse the private half.
    ephemeralPair = { privateKey: storedPrivate };
    ephemeralPrivateKeys.set(conversationId, storedPrivate);
  } else {
    ephemeralPair = await engine.generateECDHKey();

    // Store in memory immediately so completeKeyExchangeFromSocket can use it
    // even if the socket event arrives before IndexedDB write completes
    ephemeralPrivateKeys.set(conversationId, ephemeralPair.privateKey);

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
    // Persist to IndexedDB (durable across token expiry / page reload)
    await saveKeyToSecureStore(`ephemeral-${conversationId}`, ephemeralPair.privateKey);

    // Notify the peer via socket so they can derive immediately
    sendKeyExchange(conversationId, myUserId, deviceId, ephemeralPair.publicKey);
  }

  // If we already have a valid conversation key, just verify it's still fresh
  if (conversationKeys.has(conversationId)) {
    // Still do one check to see if peer re-keyed
    try {
      const exchangeData = await getKeyExchange(conversationId);
      const peerEntry = _findLatestPeerEntry(exchangeData, myUserId);
      if (peerEntry) {
        const peerFingerprint = JSON.stringify(peerEntry.ephemeralPublicKey);
        const existingFingerprint = conversationKeyFingerprints.get(conversationId);
        if (existingFingerprint !== peerFingerprint) {
          console.warn('[crypto] Peer re-keyed for', conversationId, '— re-deriving conversation key');
          await _deriveAndStore(conversationId, ephemeralPair.privateKey, peerEntry.ephemeralPublicKey);
        }
      }
    } catch {
      // Non-critical — we already have a key
    }
    return;
  }

  // Try to find the peer's ephemeral key, with retries
  for (let i = 0; i <= maxRetries; i++) {
    const exchangeData = await getKeyExchange(conversationId);
    const peerEntry = _findLatestPeerEntry(exchangeData, myUserId);

    if (peerEntry) {
      await _deriveAndStore(conversationId, ephemeralPair.privateKey, peerEntry.ephemeralPublicKey);
      return;
    }

    // Wait before retrying
    if (i < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelay));
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

  // Try in-memory first (avoids race), then fall back to IndexedDB
  const ephemeralPrivateKey = ephemeralPrivateKeys.get(conversationId)
    || await loadKeyFromSecureStore(`ephemeral-${conversationId}`);
  if (!ephemeralPrivateKey) {
    console.warn('[crypto] No ephemeral private key for', conversationId, '— cannot complete key exchange from socket');
    return;
  }

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

/**
 * Wipe all crypto state — called on explicit logout.
 * Clears in-memory keys, IndexedDB secure store, and device ID from localStorage.
 */
export async function clearAllCryptoKeys() {
  conversationKeys.clear();
  conversationKeyFingerprints.clear();
  ephemeralPrivateKeys.clear();
  identityKeypair = null;
  ecdhKeypair = null;
  deviceId = null;
  localStorage.removeItem('blink-device-id');
  await clearSecureStore();
}
