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
   * Sign arbitrary data with an ECDSA P-256 private key.
   * Returns a base64-encoded DER signature.
   */
  signData(privateKeyJwk: JsonWebKey, data: string): Promise<string>;

  /**
   * Verify an ECDSA P-256 signature.
   */
  verifySignature(publicKeyJwk: JsonWebKey, data: string, signature: string): Promise<boolean>;
}
