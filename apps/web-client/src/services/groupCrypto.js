// Group E2E encryption service — Sender Key protocol.
//
// Each group member generates a 256-bit AES sender key and distributes
// encrypted copies to every other member via virtual pairwise ECDH channels.
// Messages are encrypted O(1) with the sender's key; decryption looks up
// the sender's key by userId.
//
// A symmetric chain ratchet (identical to the DM ratchet) derives a unique
// message key per message, providing forward secrecy within a session.

import { CryptoEngine, BrowserProvider } from '@blink-text/crypto';
import {
  getSenderKeys,
  storeSenderKeys,
  deleteSenderKeys,
  publishPairwiseKey,
  getPairwiseKeys,
} from './api.js';
import {
  joinConversation,
  emitGroupPairwiseExchange,
  emitSenderKeyRequest,
} from './socket.js';

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

// Pairwise ECDH state for sender key wrapping:
// conversationId -> Map<peerId, { myPrivateKey: JWK, myPublicKey: JWK, pairwiseKey: Uint8Array | null }>
const pairwiseKeyState = new Map();

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
// Pairwise ECDH helpers — real key exchange for sender key wrapping
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic pairwise ID for two users in a conversation.
 * Sorted so both sides compute the same ID.
 */
function _pairwiseId(conversationId, userIdA, userIdB) {
  const sorted = [userIdA, userIdB].sort();
  return `${conversationId}:pair:${sorted[0]}:${sorted[1]}`;
}

/**
 * Get or establish a pairwise wrapping key with a specific peer.
 *
 * Flow:
 * 1. Check in-memory cache
 * 2. Check IndexedDB for a previously completed handshake
 * 3. If not found, generate ECDH keypair and publish our public key
 * 4. Fetch the peer's published key
 * 5. If peer key exists, complete ECDH → derive pairwise key
 * 6. If peer key doesn't exist yet, return null (will complete later)
 *
 * @returns {Promise<Uint8Array|null>} The pairwise wrapping key, or null if handshake incomplete
 */
async function _ensurePairwiseKey(conversationId, myUserId, peerId) {
  // 1. Check in-memory cache
  const convMap = pairwiseKeyState.get(conversationId);
  const cached = convMap?.get(peerId);
  if (cached?.pairwiseKey) return cached.pairwiseKey;

  const pairId = _pairwiseId(conversationId, myUserId, peerId);
  const idbKey = `group-pair-${pairId}`;

  // 2. Check IndexedDB
  const stored = await loadKey(idbKey);
  if (stored?.pairwiseKey) {
    const pairwiseKey = stored.pairwiseKey instanceof Uint8Array
      ? stored.pairwiseKey
      : new Uint8Array(stored.pairwiseKey);
    // Cache in memory
    if (!pairwiseKeyState.has(conversationId)) pairwiseKeyState.set(conversationId, new Map());
    pairwiseKeyState.get(conversationId).set(peerId, {
      myPrivateKey: stored.myPrivateKey,
      myPublicKey: stored.myPublicKey,
      pairwiseKey,
    });
    return pairwiseKey;
  }

  // 3. Generate fresh ECDH keypair (or reuse one we already published)
  let myPrivateKey, myPublicKey;
  if (cached?.myPrivateKey) {
    myPrivateKey = cached.myPrivateKey;
    myPublicKey = cached.myPublicKey;
  } else if (stored?.myPrivateKey) {
    myPrivateKey = stored.myPrivateKey;
    myPublicKey = stored.myPublicKey;
  } else {
    const kp = await engine.generateECDHKey();
    myPrivateKey = kp.privateKey;
    myPublicKey = kp.publicKey;
  }

  // Publish our public key for this peer
  try {
    await publishPairwiseKey(conversationId, peerId, myPublicKey);
  } catch (err) {
    console.warn('[groupCrypto] Failed to publish pairwise key for', peerId.slice(0, 8), ':', err.message);
  }

  // Notify the peer via socket so they can complete the handshake
  emitGroupPairwiseExchange(conversationId, peerId);

  // 4. Fetch peer's published key for us
  let peerPublicKey = null;
  try {
    const response = await getPairwiseKeys(conversationId);
    const keys = response.pairwiseKeys || [];
    // Find the key the peer published for us (userId = peer, peerUserId = me)
    const peerEntry = keys.find(
      (k) => k.userId === peerId && k.peerUserId === myUserId
    );
    if (peerEntry) {
      peerPublicKey = peerEntry.ephemeralPublicKey;
    }
  } catch (err) {
    console.warn('[groupCrypto] Failed to fetch pairwise keys:', err.message);
  }

  if (!peerPublicKey) {
    // Peer hasn't published yet — store our keypair and return null
    if (!pairwiseKeyState.has(conversationId)) pairwiseKeyState.set(conversationId, new Map());
    pairwiseKeyState.get(conversationId).set(peerId, {
      myPrivateKey, myPublicKey, pairwiseKey: null,
    });
    await saveKey(idbKey, { myPrivateKey, myPublicKey, pairwiseKey: null });
    console.log('[groupCrypto] Pairwise handshake pending for', peerId.slice(0, 8));
    return null;
  }

  // 5. Complete ECDH → derive pairwise key
  const pairwiseKey = await engine.deriveConversationKeyFromExchange(
    myPrivateKey, peerPublicKey, pairId
  );

  // Store in memory + IndexedDB
  if (!pairwiseKeyState.has(conversationId)) pairwiseKeyState.set(conversationId, new Map());
  pairwiseKeyState.get(conversationId).set(peerId, {
    myPrivateKey, myPublicKey, pairwiseKey,
  });
  await saveKey(idbKey, { myPrivateKey, myPublicKey, pairwiseKey });
  console.log('[groupCrypto] Pairwise key established with', peerId.slice(0, 8));

  return pairwiseKey;
}

/**
 * Handle incoming group_pairwise_exchange event — a peer published their key for us.
 * Complete the ECDH handshake, then:
 *   (a) fetch+decrypt any pending sender keys FROM the peer
 *   (b) wrap+store our own sender key FOR the peer (it was skipped during initial setup
 *       because the pairwise handshake wasn't complete yet)
 */
export async function handleGroupPairwiseExchange(conversationId, fromUserId, myUserId, deps) {
  // The peer published a NEW pairwise ECDH public key (e.g. they logged in from a new
  // browser). Invalidate our cached pairwise key so _ensurePairwiseKey re-fetches their
  // new public key and re-derives the wrapping key instead of returning a stale value.
  if (pairwiseKeyState.has(conversationId)) {
    pairwiseKeyState.get(conversationId).delete(fromUserId);
  }
  const pairId = _pairwiseId(conversationId, myUserId, fromUserId);
  const idbKey = `group-pair-${pairId}`;
  const stored = await loadKey(idbKey);
  if (stored) {
    // Preserve our own keypair (we haven't changed) but clear the derived pairwise key
    // so _ensurePairwiseKey falls through to re-fetch the peer's new public key and
    // re-derive, rather than returning the now-invalid old wrapping key.
    await saveKey(idbKey, { myPrivateKey: stored.myPrivateKey, myPublicKey: stored.myPublicKey, pairwiseKey: null });
  }

  const pairwiseKey = await _ensurePairwiseKey(conversationId, myUserId, fromUserId);
  if (pairwiseKey) {
    // (a) Fetch sender keys from this peer
    await _fetchAndDecryptPeerKeys(conversationId, myUserId, [fromUserId], deps);

    // (b) Distribute our sender key to this peer now that we have a pairwise key
    await _distributeMySenderKeyToPeer(conversationId, myUserId, fromUserId, pairwiseKey, deps);

    window.dispatchEvent(new CustomEvent('blink-group-key-ready', {
      detail: { conversationId, senderUserId: fromUserId },
    }));
  }
}

/**
 * Wrap and store our sender key for a specific peer using a pairwise wrapping key.
 * Called when a pairwise handshake completes after the initial setupGroupKeys missed it.
 */
async function _distributeMySenderKeyToPeer(conversationId, myUserId, peerId, pairwiseKey, deps) {
  const { emitSenderKeyDistributed } = deps || {};
  const myKey = mySenderKeys.get(conversationId);
  if (!myKey) {
    console.warn('[groupCrypto] Cannot distribute sender key — no sender key for', conversationId.slice(0, 8));
    return;
  }

  try {
    const { ciphertext, iv } = await engine.encryptSenderKey(pairwiseKey, myKey.senderKey);
    await storeSenderKeys(conversationId, [{
      recipientUserId: peerId,
      encryptedSenderKey: ciphertext,
      iv,
      keyGeneration: myKey.keyGeneration,
    }]);
    if (emitSenderKeyDistributed) {
      emitSenderKeyDistributed(conversationId, myKey.keyGeneration);
    }
    console.log('[groupCrypto] Distributed sender key to', peerId.slice(0, 8), 'after pairwise handshake');
  } catch (err) {
    console.warn('[groupCrypto] Failed to distribute sender key to', peerId.slice(0, 8), ':', err.message);
  }
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
 * 2. Encrypt my sender key for each other participant (wrapping key from HKDF)
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

  // 2. For each other participant, encrypt my sender key with a derived wrapping key
  const otherIds = participantIds.filter((id) => id !== myUserId);
  const keyCopies = [];

  for (const peerId of otherIds) {
    try {
      const wrapKey = await _ensurePairwiseKey(conversationId, myUserId, peerId);
      if (!wrapKey) {
        // Pairwise ECDH not yet complete — peer hasn't published their key yet.
        // They'll get our sender key when the handshake completes.
        console.log('[groupCrypto] Pairwise handshake pending with', peerId.slice(0, 8), '— skipping sender key wrap');
        continue;
      }
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
        // Derive the pairwise wrapping key via real ECDH with the sender
        const wrapKey = await _ensurePairwiseKey(conversationId, myUserId, senderUserId);
        if (!wrapKey) {
          console.log('[groupCrypto] Pairwise handshake pending with', senderUserId.slice(0, 8), '— cannot decrypt sender key yet');
          continue;
        }
        const senderKey = await engine.decryptSenderKey(wrapKey, encryptedSenderKey, iv);
        peerMap.set(senderUserId, { senderKey, keyGeneration });
        await saveKey(`group-pk-${conversationId}-${senderUserId}`, { senderKey, keyGeneration });
        console.log('[groupCrypto] Decrypted sender key from', senderUserId.slice(0, 8),
          'gen=', keyGeneration);
      } catch (err) {
        console.warn('[groupCrypto] Failed to decrypt sender key from', senderUserId.slice(0, 8), ':', err.message);
      }
    }

    // Request sender keys from peers we still don't have keys for
    const peerMap2 = peerSenderKeys.get(conversationId);
    for (const peerId of otherIds) {
      if (!peerMap2?.has(peerId)) {
        emitSenderKeyRequest(conversationId, peerId);
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
    const wrapKey = await _ensurePairwiseKey(conversationId, myUserId, requestingUserId);
    if (!wrapKey) {
      console.log('[groupCrypto] Pairwise handshake pending with', requestingUserId.slice(0, 8), '— cannot re-distribute sender key yet');
      return;
    }
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

  // Encrypt and distribute to remaining participants
  const otherIds = remainingParticipantIds.filter((id) => id !== myUserId);
  const keyCopies = [];

  for (const peerId of otherIds) {
    try {
      const wrapKey = await _ensurePairwiseKey(conversationId, myUserId, peerId);
      if (!wrapKey) {
        console.log('[groupCrypto] Pairwise handshake pending with', peerId.slice(0, 8), '— skipping rotated key wrap');
        continue;
      }
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
  pairwiseKeyState.delete(conversationId);

  await deleteKey(`group-sk-${conversationId}`);

  // Clean up peer keys + pairwise keys from IndexedDB (best-effort)
  try {
    const db = await openKeyDatabase();
    const allKeys = await new Promise((resolve, reject) => {
      const tx = db.transaction([KEY_STORE_NAME], 'readonly');
      const store = tx.objectStore(KEY_STORE_NAME);
      const request = store.getAllKeys();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
    const peerPrefix = `group-pk-${conversationId}-`;
    const pairPrefix = `group-pair-${conversationId}:pair:`;
    for (const k of allKeys) {
      if (typeof k === 'string' && (k.startsWith(peerPrefix) || k.startsWith(pairPrefix))) {
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
  pairwiseKeyState.clear();

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
      if (typeof k === 'string' && (k.startsWith('group-sk-') || k.startsWith('group-pk-') || k.startsWith('group-pair-'))) {
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
// Internal: get current user ID from localStorage (registered) or sessionStorage (guest)
// ---------------------------------------------------------------------------
function _getCurrentUserId() {
  try {
    // Registered user
    const raw = localStorage.getItem('blink-user');
    if (raw) return JSON.parse(raw).id;
    // Guest user
    const guestRaw = sessionStorage.getItem('blink-guest-session');
    if (guestRaw) return JSON.parse(guestRaw).guestSessionId;
    return null;
  } catch {
    return null;
  }
}
