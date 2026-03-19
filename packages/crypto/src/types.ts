/**
 * Encrypted payload stored inside an EncryptedMessage.
 */
export interface EncryptedPayload {
  ciphertext: string; // base64-encoded AES-256-GCM ciphertext (includes GCM auth tag)
  iv: string;         // base64-encoded 12-byte random IV
  version: string;    // protocol version, currently "v1"
}

/**
 * Canonical encrypted message format used over the wire, in the DB, and in API responses.
 */
export interface EncryptedMessage {
  id: string;             // UUID
  conversationId: string; // UUID
  senderId: string;       // UUID
  timestamp: number;      // Unix epoch ms
  payload: EncryptedPayload;
}

/**
 * Key exchange payload shared via the server so peers can derive a shared secret.
 */
export interface KeyExchangePayload {
  conversationId: string;
  userId: string;
  deviceId: string;
  ephemeralPublicKey: JsonWebKey; // ECDH P-256 public key as JWK
}

/**
 * Identity keypair (ECDSA P-256) — used to sign key exchange operations.
 */
export interface IdentityKeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

/**
 * ECDH keypair (P-256) — used for key exchange.
 */
export interface ECDHKeyPair {
  publicKey: JsonWebKey;
  privateKey: JsonWebKey;
}

/**
 * Encrypted binary payload returned by encryptBinary / consumed by decryptBinary.
 */
export interface EncryptedBinaryPayload {
  encrypted: Uint8Array; // raw AES-256-GCM ciphertext (includes GCM auth tag)
  iv: Uint8Array;        // 12-byte random IV
}

/**
 * A sender key bundle for group encryption.
 * Each group member generates their own sender key and distributes it to all
 * other members via pairwise-encrypted channels.
 */
export interface SenderKeyBundle {
  senderKey: Uint8Array;  // 256-bit AES-GCM key
  keyGeneration: number;  // increments on rotation
  signature: string;      // ECDSA signature of (senderKey + keyGeneration + conversationId)
}

/**
 * An encrypted copy of a sender key, ready for wire transport.
 * The sender key is encrypted with the pairwise key between sender and recipient.
 */
export interface EncryptedSenderKey {
  encryptedKey: string;   // base64 AES-GCM ciphertext (sender key encrypted with pairwise key)
  iv: string;             // base64 12-byte IV
  keyGeneration: number;
  signature: string;      // ECDSA signature for authentication
}

/**
 * Interface that all crypto providers must implement.
 * All methods are async to accommodate both browser (Web Crypto) and Node environments.
 */
export interface CryptoProvider {
  /** Generate an ECDSA P-256 identity keypair for signing. */
  generateIdentityKey(): Promise<IdentityKeyPair>;

  /** Generate an ECDH P-256 keypair for key exchange. */
  generateECDHKey(): Promise<ECDHKeyPair>;

  /**
   * Derive a raw shared secret (as Uint8Array) from one party's ECDH private key
   * and the other party's ECDH public key.
   */
  deriveSharedSecret(privateKeyJwk: JsonWebKey, publicKeyJwk: JsonWebKey): Promise<Uint8Array>;

  /**
   * Derive a symmetric conversation key from a shared secret using HKDF-SHA-256.
   * The conversationId is used as the HKDF salt to bind the key to the conversation.
   * Returns a serialized key (Uint8Array / Buffer) for portability.
   */
  deriveConversationKey(sharedSecret: Uint8Array, conversationId: string): Promise<Uint8Array>;

  /**
   * Encrypt a plaintext string with AES-256-GCM.
   * Returns an EncryptedPayload (ciphertext + iv, both base64).
   */
  encryptMessage(conversationKey: Uint8Array, plaintext: string): Promise<EncryptedPayload>;

  /**
   * Decrypt an EncryptedPayload with AES-256-GCM.
   * Returns the original plaintext string.
   */
  decryptMessage(conversationKey: Uint8Array, payload: EncryptedPayload): Promise<string>;

  /**
   * Encrypt raw binary data with AES-256-GCM.
   * Returns the encrypted bytes and IV as Uint8Arrays (no base64 overhead).
   */
  encryptBinary(conversationKey: Uint8Array, data: Uint8Array): Promise<EncryptedBinaryPayload>;

  /**
   * Decrypt raw binary data with AES-256-GCM.
   * Returns the original bytes.
   */
  decryptBinary(conversationKey: Uint8Array, payload: EncryptedBinaryPayload): Promise<Uint8Array>;

  /**
   * Sign arbitrary data with an ECDSA P-256 private key.
   * Returns a base64-encoded DER signature.
   */
  signData(privateKeyJwk: JsonWebKey, data: string): Promise<string>;

  /**
   * Verify an ECDSA P-256 signature.
   */
  verifySignature(publicKeyJwk: JsonWebKey, data: string, signature: string): Promise<boolean>;

  // ── Sender Key methods (group encryption) ──────────────────────────

  /**
   * Generate a random 256-bit sender key for group encryption.
   */
  generateSenderKey(): Promise<Uint8Array>;

  /**
   * Encrypt a sender key using a pairwise conversation key (for distribution
   * to another group member). Returns base64 ciphertext + IV.
   */
  encryptSenderKey(pairwiseKey: Uint8Array, senderKey: Uint8Array): Promise<{ ciphertext: string; iv: string }>;

  /**
   * Decrypt a sender key received from a group member.
   */
  decryptSenderKey(pairwiseKey: Uint8Array, ciphertext: string, iv: string): Promise<Uint8Array>;
}
