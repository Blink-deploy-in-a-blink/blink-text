/**
 * Forward message service — handles forwarding messages (text + media) to a different conversation.
 * Works across conversations by setting up the target conversation key independently.
 */
import { v4 as uuidv4 } from 'uuid';
import { downloadMedia, uploadMedia } from './api.js';
import { sendMessage, joinConversation } from './socket.js';
import {
  setupConversationKey,
  encryptForConversation,
  encryptMediaForConversation,
  decryptMediaForConversation,
  hasConversationKey,
} from './cryptoService.js';

/**
 * Forward a message to a target conversation.
 *
 * For text messages: re-encrypts the plaintext for the target conversation.
 * For media messages: downloads + decrypts original media, re-encrypts for
 *   the target conversation, uploads the re-encrypted blob, then sends.
 *
 * @param {object} msg — the decrypted message object (must have .plaintext, .messageType, etc.)
 * @param {string} sourceConversationId — the conversation the message is from
 * @param {string} targetConversationId — the conversation to forward to
 * @param {string} myUserId — current user's ID
 * @returns {Promise<void>}
 */
export async function forwardMessage(msg, sourceConversationId, targetConversationId, myUserId) {
  // Ensure we've joined and have a key for the target conversation
  joinConversation(targetConversationId);
  await setupConversationKey(targetConversationId, myUserId, { maxRetries: 6, retryDelay: 500 });

  if (!hasConversationKey(targetConversationId)) {
    // Try waiting for socket key exchange
    for (let i = 0; i < 6; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (hasConversationKey(targetConversationId)) break;
    }
  }

  if (!hasConversationKey(targetConversationId)) {
    throw new Error('Could not establish encryption with the target conversation. The other user may not have opened this conversation yet.');
  }

  const isMedia = (msg.messageType === 'image' || msg.messageType === 'video' || msg.messageType === 'voice') && msg.mediaId;

  if (isMedia) {
    await _forwardMediaMessage(msg, sourceConversationId, targetConversationId, myUserId);
  } else {
    await _forwardTextMessage(msg, targetConversationId, myUserId);
  }
}

async function _forwardTextMessage(msg, targetConversationId, myUserId) {
  const plaintext = msg.plaintext || '';
  const payload = await encryptForConversation(targetConversationId, plaintext);
  const id = uuidv4();
  await sendMessage(id, targetConversationId, myUserId, payload, null, 'text', null);
}

async function _forwardMediaMessage(msg, sourceConversationId, targetConversationId, myUserId) {
  // 1. Download and decrypt the original media from the source conversation
  const { data: encryptedData, iv: ivBase64 } = await downloadMedia(msg.mediaId);
  const ivBinary = atob(ivBase64);
  const iv = new Uint8Array(ivBinary.length);
  for (let i = 0; i < ivBinary.length; i++) iv[i] = ivBinary.charCodeAt(i);

  const decryptedBytes = await decryptMediaForConversation(sourceConversationId, encryptedData, iv);

  // 2. Re-encrypt with target conversation key
  const { encrypted: reEncrypted, iv: newIv } = await encryptMediaForConversation(targetConversationId, decryptedBytes);

  // Base64-encode new IV for upload
  let binary = '';
  for (let i = 0; i < newIv.byteLength; i++) binary += String.fromCharCode(newIv[i]);
  const newIvBase64 = btoa(binary);

  // 3. Upload re-encrypted media to the server
  const { mediaId: newMediaId } = await uploadMedia(targetConversationId, reEncrypted, newIvBase64);

  // 4. Re-encrypt the metadata (plaintext) for the target conversation
  const payload = await encryptForConversation(targetConversationId, msg.plaintext);
  const id = uuidv4();

  // 5. Send the message
  await sendMessage(id, targetConversationId, myUserId, payload, null, msg.messageType, newMediaId);
}
