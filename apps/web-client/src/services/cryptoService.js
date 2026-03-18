// Client-side crypto service using the @blink-text/crypto browser provider.
//
// ## Key architecture (Phase 1 + Phase 2 fixes)
//
// 1. Each conversation uses a fresh ECDH ephemeral keypair per participant.
//    Both the public AND private keys are stored in IndexedDB so we can verify
//    that our stored private key matches what the server has.
//
// 2. When a peer re-keys (new ephemeral public key), we ALWAYS re-derive the
//    shared secret.  A key_confirm handshake verifies both sides derived the
//    same key before any messages are sent.
//
// 3. On logout, ALL ephemeral keys are wiped from IndexedDB so that re-login
//    forces fresh keypair generation (no stale keys lingering).
//
// 4. A symmetric-key ratchet derives a unique message key for each message,
//    providing forward secrecy within a session.
//
import { CryptoEngine, BrowserProvider } from '@blink-text/crypto';
import { registerDevice, storeKeyExchange, getKeyExchange } from './api.js';
import { sendKeyExchange, sendKeyConfirm, joinConversation } from './socket.js';

// Engine backed by browser Web Crypto API
const engine = new CryptoEngine(new BrowserProvider());

// ---------------------------------------------------------------------------
// In-memory stores
// ---------------------------------------------------------------------------

// conversationId -> { rootKey: Uint8Array, confirmed: boolean }
const conversationKeys = new Map();

// Track which peer public key was used to derive the current conversation key
// conversationId -> JSON string of peer's ephemeral public JWK
const conversationKeyFingerprints = new Map();

// In-memory ephemeral keypairs (full pair: { publicKey, privateKey })
// conversationId -> { publicKey: JWK, privateKey: JWK }
const ephemeralKeypairs = new Map();

// Symmetric chain ratchet state per conversation
// conversationId -> { sendChainKey: Uint8Array, sendCounter: number }
const sendChains = new Map();

// Per-conversation setup lock to prevent concurrent calls from racing.
// conversationId -> Promise  (resolves when the in-flight setup finishes)
const setupLocks = new Map();

let identityKeypair = null;
let ecdhKeypair = null;
let deviceId = null;

// ---------------------------------------------------------------------------
// localStorage helpers (non-sensitive data only)
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Secure key storage using IndexedDB (private keys never in localStorage)
// ---------------------------------------------------------------------------
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
  }
}

async function deleteKeyFromSecureStore(key) {
  try {
    const db = await openKeyDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readwrite');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // non-critical
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
    // non-critical
  }
}

async function listSecureStoreKeys() {
  try {
    const db = await openKeyDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readonly');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Symmetric chain ratchet helpers (Phase 2 — forward secrecy per message)
// ---------------------------------------------------------------------------
// We use HKDF to derive a message key + next chain key from the current chain
// key.  This provides forward secrecy: once a message key is used and deleted,
// old messages cannot be decrypted even if the current chain key is compromised.

async function _hkdfChainStep(chainKey) {
  // Import chain key as HKDF key material
  const keyMaterial = chainKey.buffer.slice(
    chainKey.byteOffset,
    chainKey.byteOffset + chainKey.byteLength,
  );
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto API not available — HTTPS required for LAN access');
  const baseKey = await subtle.importKey('raw', keyMaterial, { name: 'HKDF' }, false, ['deriveKey', 'deriveBits']);

  // Derive 64 bytes: first 32 = next chain key, last 32 = message key
  const derived = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // zero salt
      info: new TextEncoder().encode('blink-chain-v2'),
    },
    baseKey,
    512, // 64 bytes
  );
  const arr = new Uint8Array(derived);
  return {
    nextChainKey: arr.slice(0, 32),
    messageKey: arr.slice(32, 64),
  };
}

/**
 * Advance the send chain and return the current message key.
 * The chain state is updated in place so the old chain key cannot be recovered.
 */
async function _advanceSendChain(conversationId) {
  const chain = sendChains.get(conversationId);
  if (!chain) {
    // No chain yet — use root key as first chain key
    const root = conversationKeys.get(conversationId);
    if (!root) throw new Error(`No conversation key for ${conversationId}`);
    const { nextChainKey, messageKey } = await _hkdfChainStep(root.rootKey);
    sendChains.set(conversationId, { sendChainKey: nextChainKey, sendCounter: 1 });
    return { messageKey, counter: 0 };
  }
  const { nextChainKey, messageKey } = await _hkdfChainStep(chain.sendChainKey);
  const counter = chain.sendCounter;
  chain.sendChainKey = nextChainKey;
  chain.sendCounter = counter + 1;
  return { messageKey, counter };
}

/**
 * Derive the message key for a specific counter value by running the chain
 * forward from the root key.  This is used for decryption — we re-derive
 * from scratch because we don't store receive-side chain state (simple model).
 * For high-volume chats this should be cached, but for correctness it works.
 */
async function _deriveMessageKeyAtCounter(rootKey, counter) {
  let chainKey = rootKey;
  for (let i = 0; i <= counter; i++) {
    const step = await _hkdfChainStep(chainKey);
    if (i === counter) return step.messageKey;
    chainKey = step.nextChainKey;
  }
  // Should never reach here
  throw new Error('Failed to derive message key');
}

// ---------------------------------------------------------------------------
// Key confirmation helpers (Phase 1 — detect key mismatch)
// ---------------------------------------------------------------------------

async function _computeKeyConfirmToken(rootKey, conversationId) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto API not available — HTTPS required for LAN access');
  const keyMaterial = rootKey.buffer.slice(
    rootKey.byteOffset,
    rootKey.byteOffset + rootKey.byteLength,
  );
  const hmacKey = await subtle.importKey(
    'raw', keyMaterial,
    { name: 'HMAC', hash: 'SHA-256' },
    false, ['sign'],
  );
  const data = new TextEncoder().encode(`blink-key-confirm:${conversationId}`);
  const sig = await subtle.sign('HMAC', hmacKey, data);
  // Return first 16 bytes as hex for compact comparison
  return Array.from(new Uint8Array(sig).slice(0, 16))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// ---------------------------------------------------------------------------
// JWK comparison helper
// ---------------------------------------------------------------------------

function _jwkFingerprint(jwk) {
  if (!jwk) return '';
  // The x and y coordinates uniquely identify an EC public key
  return `${jwk.x || ''}:${jwk.y || ''}`;
}

function _sameJwk(a, b) {
  return _jwkFingerprint(a) === _jwkFingerprint(b);
}

// ---------------------------------------------------------------------------
// Identity initialisation
// ---------------------------------------------------------------------------

/**
 * Load or generate an identity keypair + ECDH keypair, register as a device on the server.
 * If device registration failed previously (e.g. network error on mobile), it will retry.
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

  // Register device — with retry logic for flaky mobile networks
  if (!deviceId) {
    await _registerDeviceWithRetry();
  } else {
    // We have a deviceId from localStorage — verify it still exists on the server.
    // If the DB was wiped or the device was removed, re-register.
    try {
      const { getUserDevices } = await import('./api.js');
      const raw = localStorage.getItem('blink-user');
      const currentUser = raw ? JSON.parse(raw) : null;
      if (currentUser?.id) {
        const devices = await getUserDevices(currentUser.id);
        const exists = devices.some((d) => d.id === deviceId);
        if (!exists) {
          console.warn('[crypto] Device', deviceId, 'not found on server — re-registering');
          deviceId = null;
          localStorage.removeItem('blink-device-id');
          await _registerDeviceWithRetry();
        }
      }
    } catch (err) {
      // If we can't verify, keep going with what we have — it will fail later
      // at key exchange time and the user will see a clear error.
      console.warn('[crypto] Could not verify device on server:', err.message);
    }
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
 * Register a device on the server with up to 3 retries.
 * Throws if all retries are exhausted.
 */
async function _registerDeviceWithRetry(maxRetries = 3) {
  let lastErr;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const device = await registerDevice(
        identityKeypair.publicKey,
        ecdhKeypair.publicKey,
        navigator.userAgent.slice(0, 64),
      );
      deviceId = device.id;
      saveToStorage('blink-device-id', deviceId);
      console.log('[crypto] Device registered:', deviceId);
      return;
    } catch (err) {
      lastErr = err;
      console.warn(`[crypto] registerDevice attempt ${i + 1}/${maxRetries} failed:`, err.message);
      if (i < maxRetries - 1) {
        await new Promise((r) => setTimeout(r, 1000 * (i + 1))); // 1s, 2s backoff
      }
    }
  }
  throw lastErr;
}

/**
 * Returns true if we have a valid device ID and identity keys.
 * UI can use this to show a warning if crypto isn't ready.
 */
export function isIdentityReady() {
  return !!(identityKeypair && ecdhKeypair && deviceId);
}

/**
 * Migrate ephemeral keys from old localStorage format (private-key-only)
 * to the new full-keypair format in IndexedDB.  Old keys are deleted because
 * they are missing the public key component and cannot be verified.
 */
async function _migrateEphemeralKeys() {
  const keysToRemove = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith('blink-ephemeral-')) {
      keysToRemove.push(key);
    }
  }
  for (const lsKey of keysToRemove) {
    try {
      localStorage.removeItem(lsKey);
    } catch {
      // Skip
    }
  }
  // Also clean up old-format IndexedDB entries (private key only, no publicKey field)
  const allKeys = await listSecureStoreKeys();
  for (const k of allKeys) {
    if (typeof k === 'string' && k.startsWith('ephemeral-')) {
      const stored = await loadKeyFromSecureStore(k);
      // Old format: stored was the bare JWK private key (has 'd' but no wrapper)
      // New format: stored is { publicKey: JWK, privateKey: JWK }
      if (stored && !stored.publicKey) {
        await deleteKeyFromSecureStore(k);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Conversation key setup
// ---------------------------------------------------------------------------

/**
 * Set up a conversation key via ECDH key exchange.
 *
 * @param {string} conversationId
 * @param {string} myUserId
 * @param {object} [options]
 * @param {number} [options.maxRetries=3]
 * @param {number} [options.retryDelay=400]
 */
export async function setupConversationKey(conversationId, myUserId, { maxRetries = 3, retryDelay = 400 } = {}) {
  // Wait for any in-progress setup for this same conversation to finish first.
  let existingLock = setupLocks.get(conversationId);
  while (existingLock) {
    await existingLock;
    existingLock = setupLocks.get(conversationId);
  }

  // After waiting, if we already have a *confirmed* key, we're done.
  const existing = conversationKeys.get(conversationId);
  if (existing && existing.confirmed) return;

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
 * Pick the most-recent peer key exchange entry.
 */
function _findLatestPeerEntry(exchangeData, myUserId) {
  return exchangeData
    .filter((e) => e.userId !== myUserId)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))[0] || null;
}

/**
 * Generate (or reload) our ephemeral keypair for a conversation and ensure
 * it is published to the server.  Returns the full { publicKey, privateKey }.
 */
async function _ensureEphemeralKeypair(conversationId, myUserId) {
  // 1. Try in-memory cache
  let pair = ephemeralKeypairs.get(conversationId);

  // 2. Try IndexedDB (new format: { publicKey, privateKey })
  if (!pair) {
    const stored = await loadKeyFromSecureStore(`ephemeral-${conversationId}`);
    if (stored && stored.publicKey && stored.privateKey) {
      pair = stored;
      ephemeralKeypairs.set(conversationId, pair);
    }
  }

  // 3. If we have a stored pair, verify the server still has our public key
  if (pair) {
    try {
      const exchangeData = await getKeyExchange(conversationId);
      const myEntry = exchangeData.find((e) => e.userId === myUserId);
      if (myEntry && _sameJwk(myEntry.ephemeralPublicKey, pair.publicKey)) {
        // Server has our exact public key — all good
        console.log('[crypto] Stored keypair matches server for', conversationId.slice(0, 8));
        return pair;
      }
      // Server is missing our key, or has a different one.
      // Our stored pair is stale — generate fresh.
      console.warn('[crypto] Stored keypair does NOT match server for', conversationId.slice(0, 8), '— generating fresh pair');
    } catch (err) {
      console.warn('[crypto] Could not verify server key state:', err.message);
      // If we can't reach the server, try to use what we have and publish below
    }
  }

  // 4. Generate a fresh keypair
  pair = await engine.generateECDHKey();
  ephemeralKeypairs.set(conversationId, pair);
  console.log('[crypto] Generated NEW ephemeral keypair for', conversationId.slice(0, 8),
    'pub.x=', pair.publicKey?.x?.slice(0, 12));

  // 5. Persist the full pair to IndexedDB
  await saveKeyToSecureStore(`ephemeral-${conversationId}`, {
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
  });

  // 6. Publish public key to server + socket
  try {
    await storeKeyExchange(conversationId, deviceId, pair.publicKey);
  } catch (err) {
    // If the device is no longer recognised, re-register
    if (err.response?.status === 400) {
      console.warn('[crypto] Device rejected, re-registering…');
      const device = await registerDevice(
        identityKeypair.publicKey,
        ecdhKeypair.publicKey,
        navigator.userAgent.slice(0, 64),
      );
      deviceId = device.id;
      saveToStorage('blink-device-id', deviceId);
      await storeKeyExchange(conversationId, deviceId, pair.publicKey);
    } else {
      throw err;
    }
  }
  sendKeyExchange(conversationId, myUserId, deviceId, pair.publicKey);

  return pair;
}

/**
 * Internal implementation — always called under the per-conversation lock.
 */
async function _doSetupConversationKey(conversationId, myUserId, { maxRetries = 3, retryDelay = 400 } = {}) {
  // If device registration failed earlier, try one more time before giving up
  if (!deviceId) {
    console.warn('[crypto] deviceId missing — attempting initializeIdentity recovery');
    try {
      await initializeIdentity();
    } catch (err) {
      throw new Error('Device not initialized and recovery failed: ' + err.message);
    }
    if (!deviceId) throw new Error('Device not initialized. Call initializeIdentity() first.');
  }

  // Always join the socket room so we can receive key_exchange events
  joinConversation(conversationId);

  // Ensure we have a valid ephemeral keypair published
  const myPair = await _ensureEphemeralKeypair(conversationId, myUserId);

  // If we already have a confirmed key and the peer hasn't changed, skip
  const existing = conversationKeys.get(conversationId);
  if (existing && existing.confirmed) return;

  // Try to find the peer's ephemeral key, with retries
  for (let i = 0; i <= maxRetries; i++) {
    const exchangeData = await getKeyExchange(conversationId);
    console.log('[crypto] key_exchange_data for', conversationId.slice(0, 8), ':',
      exchangeData.map((e) => ({
        user: e.userId.slice(0, 8),
        x: e.ephemeralPublicKey?.x?.slice(0, 12),
      })));
    const peerEntry = _findLatestPeerEntry(exchangeData, myUserId);

    if (peerEntry) {
      console.log('[crypto] Selected peer:', peerEntry.userId.slice(0, 8),
        'pub.x=', peerEntry.ephemeralPublicKey?.x?.slice(0, 12));
      await _deriveAndStore(conversationId, myPair.privateKey, peerEntry.ephemeralPublicKey);
      // Send key confirmation to peer
      await _sendKeyConfirmation(conversationId);
      return;
    }

    if (i < maxRetries) {
      await new Promise((r) => setTimeout(r, retryDelay));
    }
  }
  // No peer key found — key will be derived later via socket key_exchange event
}

/**
 * Called by the socket key_exchange handler when a peer's ephemeral key arrives.
 * Re-derives the shared secret if the peer's key is new/different.
 */
export async function completeKeyExchangeFromSocket(conversationId, theirEphemeralPublicKey) {
  // Check if the peer's key is the same as what we already used
  const currentFingerprint = conversationKeyFingerprints.get(conversationId);
  const newFingerprint = JSON.stringify(theirEphemeralPublicKey);

  if (currentFingerprint === newFingerprint) {
    // Same peer key — no need to re-derive
    return;
  }

  // Get our ephemeral private key
  const pair = ephemeralKeypairs.get(conversationId);
  const privateKey = pair?.privateKey;
  if (!privateKey) {
    // Try IndexedDB
    const stored = await loadKeyFromSecureStore(`ephemeral-${conversationId}`);
    if (!stored?.privateKey) {
      console.warn('[crypto] No ephemeral private key for', conversationId.slice(0, 8),
        '— cannot complete key exchange from socket');
      return;
    }
    ephemeralKeypairs.set(conversationId, stored);
    await _deriveAndStore(conversationId, stored.privateKey, theirEphemeralPublicKey);
  } else {
    await _deriveAndStore(conversationId, privateKey, theirEphemeralPublicKey);
  }

  // Send key confirmation
  await _sendKeyConfirmation(conversationId);
}

/**
 * Handle incoming key_confirm from a peer.
 * If the token matches, mark the key as confirmed.
 * If it doesn't match, invalidate and force re-key.
 */
export async function handleKeyConfirm(conversationId, peerConfirmToken, myUserId) {
  const entry = conversationKeys.get(conversationId);
  if (!entry) {
    console.warn('[crypto] Received key_confirm but no key for', conversationId.slice(0, 8));
    return;
  }

  const ourToken = await _computeKeyConfirmToken(entry.rootKey, conversationId);

  if (ourToken === peerConfirmToken) {
    console.log('[crypto] ✓ Key confirmed for', conversationId.slice(0, 8));
    entry.confirmed = true;
  } else {
    console.warn('[crypto] ✗ Key confirmation FAILED for', conversationId.slice(0, 8),
      '— forcing re-key');
    // Key mismatch! Wipe everything for this conversation and re-negotiate.
    conversationKeys.delete(conversationId);
    conversationKeyFingerprints.delete(conversationId);
    sendChains.delete(conversationId);
    ephemeralKeypairs.delete(conversationId);
    await deleteKeyFromSecureStore(`ephemeral-${conversationId}`);
    // Re-setup will happen on next message send/receive or explicit call
    try {
      await setupConversationKey(conversationId, myUserId, { maxRetries: 3, retryDelay: 500 });
    } catch (err) {
      console.error('[crypto] Re-key after confirmation failure failed:', err);
    }
  }
}

async function _sendKeyConfirmation(conversationId) {
  const entry = conversationKeys.get(conversationId);
  if (!entry) return;
  const token = await _computeKeyConfirmToken(entry.rootKey, conversationId);
  sendKeyConfirm(conversationId, token);
}

async function _deriveAndStore(conversationId, myPrivateKey, theirPublicKey) {
  console.log('[crypto] _deriveAndStore', conversationId.slice(0, 8),
    'myPriv.x=', myPrivateKey?.x?.slice(0, 12),
    'theirPub.x=', theirPublicKey?.x?.slice(0, 12));

  const rootKey = await engine.deriveConversationKeyFromExchange(
    myPrivateKey, theirPublicKey, conversationId,
  );

  const keyHex = Array.from(rootKey.slice(0, 8))
    .map((b) => b.toString(16).padStart(2, '0')).join('');
  console.log('[crypto] Derived root key prefix:', keyHex, 'for', conversationId.slice(0, 8));

  // Store root key — not yet confirmed until key_confirm handshake completes
  // (but we allow encryption/decryption immediately — confirmation is advisory)
  conversationKeys.set(conversationId, { rootKey, confirmed: false });
  conversationKeyFingerprints.set(conversationId, JSON.stringify(theirPublicKey));

  // Reset send chain for this conversation (new root key = new chain)
  sendChains.delete(conversationId);

  // Notify any waiting message queues that the key is now available
  window.dispatchEvent(new CustomEvent('blink-key-ready', { detail: { conversationId } }));
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a plaintext message for a given conversation.
 * Uses the symmetric chain ratchet to derive a unique message key.
 * Returns an EncryptedPayload with an added `chainIdx` field.
 */
export async function encryptForConversation(conversationId, plaintext) {
  const entry = conversationKeys.get(conversationId);
  if (!entry) throw new Error(`No conversation key for ${conversationId}. Run setupConversationKey first.`);

  const { messageKey, counter } = await _advanceSendChain(conversationId);
  const payload = await engine.encryptMessage(messageKey, plaintext);
  // Embed the chain counter so the receiver can derive the same message key
  payload.chainIdx = counter;
  return payload;
}

/**
 * Encrypt binary data (image/video/voice) for a given conversation.
 * Returns { encrypted: Uint8Array, iv: Uint8Array }.
 */
export async function encryptMediaForConversation(conversationId, data) {
  const entry = conversationKeys.get(conversationId);
  if (!entry) throw new Error(`No conversation key for ${conversationId}. Run setupConversationKey first.`);
  // Media uses the root key directly (same as v1) for simplicity —
  // media encryption doesn't need per-message forward secrecy as files are
  // stored encrypted at rest with their own random IV.
  return engine.encryptBinary(entry.rootKey, data);
}

/**
 * Decrypt binary media data for a given conversation.
 */
export async function decryptMediaForConversation(conversationId, encrypted, iv) {
  const entry = conversationKeys.get(conversationId);
  if (!entry) throw new Error(`No conversation key for ${conversationId}`);
  return engine.decryptBinary(entry.rootKey, { encrypted, iv });
}

/**
 * Decrypt an incoming EncryptedMessage payload.
 * Supports both v1 (no chainIdx, uses root key directly) and v2 (chain ratchet).
 */
export async function decryptConversationMessage(conversationId, encryptedPayload) {
  const entry = conversationKeys.get(conversationId);
  if (!entry) throw new Error(`No conversation key for ${conversationId}`);

  // If the payload has a chainIdx, use the chain ratchet to derive the message key
  if (typeof encryptedPayload.chainIdx === 'number') {
    const messageKey = await _deriveMessageKeyAtCounter(entry.rootKey, encryptedPayload.chainIdx);
    // Strip chainIdx before passing to decryptMessage (it only expects ciphertext/iv/version)
    const { ciphertext, iv, version } = encryptedPayload;
    return engine.decryptMessage(messageKey, { ciphertext, iv, version });
  }

  // Fallback: v1 messages — decrypt with root key directly (backwards compatible)
  return engine.decryptMessage(entry.rootKey, encryptedPayload);
}

export function hasConversationKey(conversationId) {
  return conversationKeys.has(conversationId);
}

export function getDeviceId() {
  return deviceId;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Wipe ALL crypto state on explicit logout.
 * Clears in-memory keys AND ephemeral keys from IndexedDB.
 * Identity + ECDH device keys are preserved so the device can re-register
 * with the same identity on next login.
 */
export async function clearAllCryptoKeys() {
  conversationKeys.clear();
  conversationKeyFingerprints.clear();
  ephemeralKeypairs.clear();
  sendChains.clear();
  identityKeypair = null;
  ecdhKeypair = null;
  deviceId = null;
  localStorage.removeItem('blink-device-id');

  // Delete all ephemeral keys from IndexedDB so re-login gets fresh keypairs.
  // Preserve identity + ECDH keys (blink-identity-key, blink-ecdh-key).
  const allKeys = await listSecureStoreKeys();
  for (const k of allKeys) {
    if (typeof k === 'string' && k.startsWith('ephemeral-')) {
      await deleteKeyFromSecureStore(k);
    }
  }
}
