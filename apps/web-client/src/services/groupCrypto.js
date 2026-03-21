// Group E2E encryption service — Sender Key protocol.
//
// Each group member generates a 256-bit AES sender key and distributes
// encrypted copies to every other member via pairwise ECDH-derived channels.
// Messages are encrypted O(1) with the sender's key; decryption looks up
// the sender's key by userId.
//
// Wrapping keys for sender key distribution are derived from real ECDH
// shared secrets between each pair of participants (using their device
// ECDH keypairs), ensuring the server cannot derive wrapping keys.
//
// A symmetric chain ratchet (identical to the DM ratchet) derives a unique
// message key per message, providing forward secrecy within a session.

import { CryptoEngine, BrowserProvider } from '@blink-text/crypto';
import {
  getSenderKeys,
  storeSenderKeys,
  deleteSenderKeys,
  getUserDevices,
} from './api.js';
import {
  joinConversation,
} from './socket.js';
import {
  getECDHPrivateKey,
} from './cryptoService.js';

const engine = new CryptoEngine(new BrowserProvider());

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------

// conversationId -> { senderKey: Uint8Array, keyGeneration: number }
const mySenderKeys = new Map();

// conversationId -> Map<senderUserId, { senderKey: Uint8Array, keyGeneration: number }>
const peerSenderKeys = new Map();

// Group send chain: conversationId -> { sendChainKey: Uint8Array, sendCounter: number }
const groupSendChains = new Map();

// Tracks which conversations are group_chat (populated from API response)
// conversationId -> true
const groupConversations = new Map();

// Per-conversation setup lock to prevent concurrent setupGroupKeys calls
const groupSetupLocks = new Map();

// Cache of pairwise wrapping keys: `${myUserId}:${peerId}` -> Uint8Array
// Derived from ECDH(myPrivateKey, peerPublicKey). Cleared on logout.
const pairwiseKeyCache = new Map();

// Cache of peer ECDH public keys: userId -> JsonWebKey
// Fetched from GET /api/devices/:userId. Cleared on logout.
const peerECDHPublicKeys = new Map();

// ---------------------------------------------------------------------------
// IndexedDB helpers (reuse crypto service's DB)
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
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Failed to open key database'));
  });
}

async function loadKey(key) {
  try {
    const db = await openKeyDatabase();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readonly');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  } catch {
    return null;
  }
}

async function saveKey(key, value) {
  try {
    const db = await openKeyDatabase();
    await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readwrite');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch {
    // non-critical — key stays in memory only
  }
}

async function deleteKey(key) {
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

// ---------------------------------------------------------------------------
// Pairwise ECDH key derivation (the core E2E fix)
// ---------------------------------------------------------------------------

/**
 * Fetch a peer's ECDH public key from the server (cached).
 * Each user's device has an ECDH P-256 public key registered.
 */
async function _getPeerECDHPublicKey(peerId) {
  const cached = peerECDHPublicKeys.get(peerId);
  if (cached) return cached;

  const devices = await getUserDevices(peerId);
  if (!devices || devices.length === 0) {
    throw new Error(`No devices found for user ${peerId}`);
  }

  // Use the most recently created device's ECDH public key
  const sorted = [...devices].sort((a, b) =>
    (b.createdAt || 0) - (a.createdAt || 0)
  );
  const pubKey = sorted[0].ecdhPublicKey;
  if (!pubKey) {
    throw new Error(`No ECDH public key for user ${peerId}`);
  }

  peerECDHPublicKeys.set(peerId, pubKey);
  return pubKey;
}

/**
 * Derive a pairwise shared secret from our ECDH private key and a peer's
 * ECDH public key, then derive a wrapping key unique to (conversation, sender, recipient).
 *
 * This replaces the old public-input-only HKDF approach. The server cannot
 * derive these keys because it never has access to any user's ECDH private key.
 *
 * @param {string} conversationId
 * @param {string} senderUserId — the sender of the sender key
 * @param {string} recipientUserId — the intended recipient
 * @returns {Promise<Uint8Array>} — 256-bit AES wrapping key
 */
async function _deriveWrappingKey(conversationId, senderUserId, recipientUserId) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto API not available');

  // Determine which user is "us" and which is the peer
  const myUserId = _getCurrentUserId();
  const peerId = (senderUserId === myUserId) ? recipientUserId : senderUserId;

  // Check cache for pairwise base key
  // Use a canonical key (sorted user IDs) so both sides derive the same base key
  const cacheKey = [myUserId, peerId].sort().join(':');
  let pairwiseSecret = pairwiseKeyCache.get(cacheKey);

  if (!pairwiseSecret) {
    // Get our ECDH private key
    const myPrivateKey = getECDHPrivateKey();
    if (!myPrivateKey) {
      throw new Error('ECDH private key not available — identity not initialized');
    }

    // Get peer's ECDH public key
    const peerPublicKey = await _getPeerECDHPublicKey(peerId);

    // Derive ECDH shared secret
    pairwiseSecret = await engine.deriveSharedSecret(myPrivateKey, peerPublicKey);
    pairwiseKeyCache.set(cacheKey, pairwiseSecret);
  }

  // Derive a conversation-specific wrapping key from the pairwise secret
  // using HKDF with conversation + user context to ensure uniqueness
  const encoder = new TextEncoder();
  const keyMaterial = pairwiseSecret.buffer.slice(
    pairwiseSecret.byteOffset,
    pairwiseSecret.byteOffset + pairwiseSecret.byteLength,
  );
  const baseKey = await subtle.importKey('raw', keyMaterial, { name: 'HKDF' }, false, ['deriveBits']);

  // Salt: conversation ID (binds key to this group)
  // Info: sender + recipient IDs (ensures unique key per direction)
  const salt = encoder.encode(conversationId);
  const info = encoder.encode(`blink-group-wrap-v2:${senderUserId}:${recipientUserId}`);

  const bits = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt,
      info,
    },
    baseKey,
    256,
  );
  return new Uint8Array(bits);
}

// ---------------------------------------------------------------------------
// Chain ratchet (same HKDF algorithm as DM ratchet in cryptoService.js)
// ---------------------------------------------------------------------------

async function _hkdfChainStep(chainKey) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Web Crypto API not available');
  const keyMaterial = chainKey.buffer.slice(
    chainKey.byteOffset,
    chainKey.byteOffset + chainKey.byteLength,
  );
  const baseKey = await subtle.importKey('raw', keyMaterial, { name: 'HKDF' }, false, ['deriveBits']);
  const derived = await subtle.deriveBits(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32),
      info: new TextEncoder().encode('blink-group-chain-v1'),
    },
    baseKey,
    512,
  );
  const arr = new Uint8Array(derived);
  return {
    nextChainKey: arr.slice(0, 32),
    messageKey: arr.slice(32, 64),
  };
}

async function _advanceGroupSendChain(conversationId) {
  const chain = groupSendChains.get(conversationId);
  if (!chain) {
    // First message — use sender key as first chain key
    const myKey = mySenderKeys.get(conversationId);
    if (!myKey) throw new Error(`No sender key for group ${conversationId}`);
    const { nextChainKey, messageKey } = await _hkdfChainStep(myKey.senderKey);
    groupSendChains.set(conversationId, { sendChainKey: nextChainKey, sendCounter: 1 });
    return { messageKey, counter: 0 };
  }
  const { nextChainKey, messageKey } = await _hkdfChainStep(chain.sendChainKey);
  const counter = chain.sendCounter;
  chain.sendChainKey = nextChainKey;
  chain.sendCounter = counter + 1;
  return { messageKey, counter };
}

async function _deriveGroupMessageKeyAtCounter(senderKey, counter) {
  let chainKey = senderKey;
  for (let i = 0; i <= counter; i++) {
    const step = await _hkdfChainStep(chainKey);
    if (i === counter) return step.messageKey;
    chainKey = step.nextChainKey;
  }
  throw new Error('Failed to derive group message key');
}

// ---------------------------------------------------------------------------
// Conversation type tracking
// ---------------------------------------------------------------------------

/**
 * Mark a conversation as a group conversation.
 * Called when conversations are loaded from the API.
 */
export function registerGroupConversation(conversationId) {
  groupConversations.set(conversationId, true);
}

/**
 * Check if a conversation is a group conversation.
 */
export function isGroupConversation(conversationId) {
  return groupConversations.has(conversationId);
}

/**
 * Unregister a conversation (on leave/delete).
 */
export function unregisterGroupConversation(conversationId) {
  groupConversations.delete(conversationId);
}

// ---------------------------------------------------------------------------
// Setup: generate + distribute sender key
// ---------------------------------------------------------------------------

/**
 * Initialize group crypto for a conversation.
 *
 * 1. Generate (or reload) my sender key
 * 2. Encrypt my sender key for each other participant using ECDH pairwise keys
 * 3. POST encrypted copies to server
 * 4. Fetch and decrypt other participants' sender keys
 *
 * @param {string} conversationId
 * @param {string} myUserId
 * @param {string[]} participantIds — ALL participant user IDs (including me)
 * @param {object} deps — { emitSenderKeyDistributed }
 */
export async function setupGroupKeys(conversationId, myUserId, participantIds, deps) {
  // Acquire per-conversation lock
  let existingLock = groupSetupLocks.get(conversationId);
  while (existingLock) {
    await existingLock;
    existingLock = groupSetupLocks.get(conversationId);
  }

  // Already set up?
  if (mySenderKeys.has(conversationId)) {
    const peers = peerSenderKeys.get(conversationId);
    const otherIds = participantIds.filter((id) => id !== myUserId);
    if (peers && otherIds.every((id) => peers.has(id))) {
      return; // All keys present
    }
  }

  let releaseLock;
  const lock = new Promise((r) => { releaseLock = r; });
  groupSetupLocks.set(conversationId, lock);

  try {
    await _doSetupGroupKeys(conversationId, myUserId, participantIds, deps);
  } finally {
    groupSetupLocks.delete(conversationId);
    releaseLock();
  }
}

async function _doSetupGroupKeys(conversationId, myUserId, participantIds, deps) {
  const { emitSenderKeyDistributed } = deps || {};

  // Join the socket room
  joinConversation(conversationId);

  // 1. Generate or reload my sender key
  let myKey = mySenderKeys.get(conversationId);
  if (!myKey) {
    const stored = await loadKey(`group-sk-${conversationId}`);
    if (stored) {
      // Ensure senderKey is Uint8Array (IndexedDB structured clone may return ArrayBuffer)
      if (stored.senderKey && !(stored.senderKey instanceof Uint8Array)) {
        stored.senderKey = new Uint8Array(stored.senderKey);
      }
      myKey = stored;
      mySenderKeys.set(conversationId, myKey);
    }
  }

  if (!myKey) {
    const senderKey = await engine.generateSenderKey();
    myKey = { senderKey, keyGeneration: 0 };
    mySenderKeys.set(conversationId, myKey);
    await saveKey(`group-sk-${conversationId}`, myKey);
    console.log('[groupCrypto] Generated new sender key for', conversationId.slice(0, 8));
  }

  // 2. For each other participant, encrypt my sender key with ECDH-derived pairwise wrapping key
  const otherIds = participantIds.filter((id) => id !== myUserId);
  const keyCopies = [];

  for (const peerId of otherIds) {
    try {
      const wrapKey = await _deriveWrappingKey(conversationId, myUserId, peerId);
      const { ciphertext, iv } = await engine.encryptSenderKey(wrapKey, myKey.senderKey);

      keyCopies.push({
        recipientUserId: peerId,
        encryptedSenderKey: ciphertext,
        iv,
        keyGeneration: myKey.keyGeneration,
      });
    } catch (err) {
      console.warn('[groupCrypto] Failed to wrap sender key for', peerId.slice(0, 8), ':', err.message);
    }
  }

  // 3. POST encrypted copies to server
  if (keyCopies.length > 0) {
    try {
      await storeSenderKeys(conversationId, keyCopies);
      console.log('[groupCrypto] Distributed sender key to', keyCopies.length, 'participants');
    } catch (err) {
      console.error('[groupCrypto] Failed to distribute sender keys:', err.message);
    }
  }

  // 4. Notify via socket
  if (emitSenderKeyDistributed) {
    emitSenderKeyDistributed(conversationId, myKey.keyGeneration);
  }

  // 5. Fetch and decrypt sender keys from other participants
  await _fetchAndDecryptPeerKeys(conversationId, myUserId, otherIds, deps);
}

/**
 * Fetch encrypted sender keys addressed to us, decrypt them.
 */
async function _fetchAndDecryptPeerKeys(conversationId, myUserId, otherIds, deps) {
  try {
    const response = await getSenderKeys(conversationId);
    const keys = response.senderKeys || response;

    if (!keys || keys.length === 0) {
      console.log('[groupCrypto] No peer sender keys available yet for', conversationId.slice(0, 8));
      return;
    }

    if (!peerSenderKeys.has(conversationId)) {
      peerSenderKeys.set(conversationId, new Map());
    }
    const peerMap = peerSenderKeys.get(conversationId);

    for (const key of keys) {
      const { senderUserId, encryptedSenderKey, iv, keyGeneration } = key;

      // Skip our own key (server shouldn't return it, but just in case)
      if (senderUserId === myUserId) continue;

      // Skip if we already have a key at this or higher generation
      const existing = peerMap.get(senderUserId);
      if (existing && existing.keyGeneration >= keyGeneration) continue;

      try {
        // Derive the same wrapping key the sender used for us via ECDH
        const wrapKey = await _deriveWrappingKey(conversationId, senderUserId, myUserId);
        const senderKey = await engine.decryptSenderKey(wrapKey, encryptedSenderKey, iv);
        peerMap.set(senderUserId, { senderKey, keyGeneration });
        await saveKey(`group-pk-${conversationId}-${senderUserId}`, { senderKey, keyGeneration });
        console.log('[groupCrypto] Decrypted sender key from', senderUserId.slice(0, 8),
          'gen=', keyGeneration);
      } catch (err) {
        console.warn('[groupCrypto] Failed to decrypt sender key from', senderUserId.slice(0, 8), ':', err.message);
      }
    }
  } catch (err) {
    console.error('[groupCrypto] Failed to fetch peer sender keys:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Socket event handlers
// ---------------------------------------------------------------------------

/**
 * Called when a peer distributes a new/rotated sender key.
 * Fetches the encrypted key from server and decrypts it.
 */
export async function handleSenderKeyDistributed(conversationId, senderUserId, deps) {
  const myUserId = deps.getMyUserId();
  if (senderUserId === myUserId) return; // Skip our own key announcements

  await _fetchAndDecryptPeerKeys(conversationId, myUserId, [senderUserId], deps);

  // Notify any UI waiting for keys
  window.dispatchEvent(new CustomEvent('blink-group-key-ready', {
    detail: { conversationId, senderUserId },
  }));
}

/**
 * Called when a peer requests us to re-distribute our sender key.
 * Re-encrypts and re-posts our key for them.
 */
export async function handleSenderKeyRequest(conversationId, requestingUserId, deps) {
  const { emitSenderKeyDistributed } = deps || {};
  const myKey = mySenderKeys.get(conversationId);
  if (!myKey) {
    console.warn('[groupCrypto] Sender key request but we have no key for', conversationId.slice(0, 8));
    return;
  }

  const myUserId = deps.getMyUserId();

  try {
    const wrapKey = await _deriveWrappingKey(conversationId, myUserId, requestingUserId);
    const { ciphertext, iv } = await engine.encryptSenderKey(wrapKey, myKey.senderKey);

    await storeSenderKeys(conversationId, [{
      recipientUserId: requestingUserId,
      encryptedSenderKey: ciphertext,
      iv,
      keyGeneration: myKey.keyGeneration,
    }]);
    if (emitSenderKeyDistributed) {
      emitSenderKeyDistributed(conversationId, myKey.keyGeneration);
    }
    console.log('[groupCrypto] Re-distributed sender key to', requestingUserId.slice(0, 8));
  } catch (err) {
    console.error('[groupCrypto] Failed to re-distribute sender key:', err.message);
  }
}

// ---------------------------------------------------------------------------
// Encrypt / Decrypt
// ---------------------------------------------------------------------------

/**
 * Encrypt a message for the group using MY sender key + chain ratchet.
 * Returns an EncryptedPayload with chainIdx.
 */
export async function encryptGroupMessage(conversationId, plaintext) {
  const myKey = mySenderKeys.get(conversationId);
  if (!myKey) throw new Error(`No sender key for group ${conversationId}. Run setupGroupKeys first.`);

  const { messageKey, counter } = await _advanceGroupSendChain(conversationId);
  const payload = await engine.encryptMessage(messageKey, plaintext);
  payload.chainIdx = counter;
  return payload;
}

/**
 * Encrypt binary data (media) for the group using MY sender key.
 * Uses root sender key directly (same as DM media encryption).
 */
export async function encryptGroupMedia(conversationId, data) {
  const myKey = mySenderKeys.get(conversationId);
  if (!myKey) throw new Error(`No sender key for group ${conversationId}`);
  return engine.encryptBinary(myKey.senderKey, data);
}

/**
 * Decrypt a group message using the SENDER's key + chain ratchet.
 */
export async function decryptGroupMessage(conversationId, senderUserId, encryptedPayload) {
  const myUserId = _getCurrentUserId();

  // If we sent this message, use our own sender key
  let senderKey;
  if (senderUserId === myUserId) {
    const myKey = mySenderKeys.get(conversationId);
    if (!myKey) throw new Error(`Cannot decrypt own group message — no sender key`);
    senderKey = myKey.senderKey;
  } else {
    const peerMap = peerSenderKeys.get(conversationId);
    const peerKey = peerMap?.get(senderUserId);
    if (!peerKey) throw new Error(`No sender key from ${senderUserId} for group ${conversationId}`);
    senderKey = peerKey.senderKey;
  }

  const { ciphertext, iv, version, chainIdx } = encryptedPayload;

  if (typeof chainIdx === 'number') {
    const messageKey = await _deriveGroupMessageKeyAtCounter(senderKey, chainIdx);
    return engine.decryptMessage(messageKey, { ciphertext, iv, version });
  }

  // Fallback: no chain index — decrypt with sender key directly
  return engine.decryptMessage(senderKey, { ciphertext, iv, version });
}

/**
 * Decrypt binary media data for a group conversation.
 */
export async function decryptGroupMedia(conversationId, senderUserId, encrypted, iv) {
  const myUserId = _getCurrentUserId();

  let senderKey;
  if (senderUserId === myUserId) {
    const myKey = mySenderKeys.get(conversationId);
    if (!myKey) throw new Error('Cannot decrypt own group media — no sender key');
    senderKey = myKey.senderKey;
  } else {
    const peerMap = peerSenderKeys.get(conversationId);
    const peerKey = peerMap?.get(senderUserId);
    if (!peerKey) throw new Error(`No sender key from ${senderUserId}`);
    senderKey = peerKey.senderKey;
  }

  return engine.decryptBinary(senderKey, { encrypted, iv });
}

// ---------------------------------------------------------------------------
// Key rotation (on member removal/kick)
// ---------------------------------------------------------------------------

/**
 * Rotate my sender key and redistribute to remaining members.
 * Called after a member is kicked or leaves.
 */
export async function rotateMySenderKey(conversationId, myUserId, remainingParticipantIds, deps) {
  const { emitSenderKeyDistributed } = deps || {};

  // Generate new sender key with incremented generation
  const oldKey = mySenderKeys.get(conversationId);
  const newGeneration = oldKey ? oldKey.keyGeneration + 1 : 0;
  const senderKey = await engine.generateSenderKey();
  const myKey = { senderKey, keyGeneration: newGeneration };

  mySenderKeys.set(conversationId, myKey);
  await saveKey(`group-sk-${conversationId}`, myKey);

  // Reset send chain (new key = new chain)
  groupSendChains.delete(conversationId);

  // Delete old keys on server
  try {
    await deleteSenderKeys(conversationId, myUserId);
  } catch (err) {
    console.warn('[groupCrypto] Failed to delete old sender keys:', err.message);
  }

  // Encrypt and distribute to remaining participants using ECDH pairwise keys
  const otherIds = remainingParticipantIds.filter((id) => id !== myUserId);
  const keyCopies = [];

  for (const peerId of otherIds) {
    try {
      const wrapKey = await _deriveWrappingKey(conversationId, myUserId, peerId);
      const { ciphertext, iv: encIv } = await engine.encryptSenderKey(wrapKey, senderKey);
      keyCopies.push({
        recipientUserId: peerId,
        encryptedSenderKey: ciphertext,
        iv: encIv,
        keyGeneration: newGeneration,
      });
    } catch (err) {
      console.warn('[groupCrypto] Failed to wrap rotated key for', peerId.slice(0, 8), ':', err.message);
    }
  }

  if (keyCopies.length > 0) {
    try {
      await storeSenderKeys(conversationId, keyCopies);
    } catch (err) {
      console.error('[groupCrypto] Failed to distribute rotated sender key:', err.message);
    }
  }

  if (emitSenderKeyDistributed) {
    emitSenderKeyDistributed(conversationId, newGeneration);
  }

  console.log('[groupCrypto] Rotated sender key to generation', newGeneration);
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Clear all group crypto state for a single conversation.
 */
export async function clearGroupKeys(conversationId) {
  mySenderKeys.delete(conversationId);
  peerSenderKeys.delete(conversationId);
  groupSendChains.delete(conversationId);
  groupConversations.delete(conversationId);

  await deleteKey(`group-sk-${conversationId}`);

  // Clean up peer keys from IndexedDB (best-effort)
  try {
    const db = await openKeyDatabase();
    const allKeys = await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readonly');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const prefix = `group-pk-${conversationId}-`;
    for (const k of allKeys) {
      if (typeof k === 'string' && k.startsWith(prefix)) {
        await deleteKey(k);
      }
    }
  } catch {
    // non-critical
  }
}

/**
 * Clear ALL group crypto state (on logout).
 */
export async function clearAllGroupKeys() {
  mySenderKeys.clear();
  peerSenderKeys.clear();
  groupSendChains.clear();
  groupConversations.clear();
  pairwiseKeyCache.clear();
  peerECDHPublicKeys.clear();

  // Clean up IndexedDB
  try {
    const db = await openKeyDatabase();
    const allKeys = await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readonly');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    for (const k of allKeys) {
      if (typeof k === 'string' && (k.startsWith('group-sk-') || k.startsWith('group-pk-'))) {
        await deleteKey(k);
      }
    }
  } catch {
    // non-critical
  }
}

/**
 * Check if we have a valid sender key for a group conversation.
 */
export function hasGroupKeys(conversationId) {
  return mySenderKeys.has(conversationId);
}

/**
 * Check if we have a peer's sender key.
 */
export function hasPeerSenderKey(conversationId, senderUserId) {
  const peerMap = peerSenderKeys.get(conversationId);
  return peerMap?.has(senderUserId) || false;
}

// ---------------------------------------------------------------------------
// Internal: get current user ID from localStorage or sessionStorage (guests)
// ---------------------------------------------------------------------------
function _getCurrentUserId() {
  try {
    // Check registered user first (localStorage)
    const raw = localStorage.getItem('blink-user');
    if (raw) return JSON.parse(raw).id;

    // Fall back to guest session (sessionStorage)
    const guestRaw = sessionStorage.getItem('blink-guest-session');
    if (guestRaw) return JSON.parse(guestRaw).guestSessionId;

    return null;
  } catch {
    return null;
  }
}
