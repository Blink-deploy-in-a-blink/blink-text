/**
 * CryptoEngine: a provider-agnostic facade.
 *
 * Wrap any CryptoProvider to get a consistent interface.
 * Application code should use CryptoEngine rather than calling providers directly.
 */
import type { CryptoProvider, IdentityKeyPair, ECDHKeyPair, EncryptedPayload, EncryptedBinaryPayload, EncryptedMessage, KeyExchangePayload } from './types.js';

export class CryptoEngine {
  constructor(private readonly provider: CryptoProvider) {}

  generateIdentityKey(): Promise<IdentityKeyPair> {
    return this.provider.generateIdentityKey();
  }

  generateECDHKey(): Promise<ECDHKeyPair> {
    return this.provider.generateECDHKey();
  }

  deriveSharedSecret(privateKeyJwk: JsonWebKey, publicKeyJwk: JsonWebKey): Promise<Uint8Array> {
    return this.provider.deriveSharedSecret(privateKeyJwk, publicKeyJwk);
  }

  deriveConversationKey(sharedSecret: Uint8Array, conversationId: string): Promise<Uint8Array> {
    return this.provider.deriveConversationKey(sharedSecret, conversationId);
  }

  encryptMessage(conversationKey: Uint8Array, plaintext: string): Promise<EncryptedPayload> {
    return this.provider.encryptMessage(conversationKey, plaintext);
  }

  decryptMessage(conversationKey: Uint8Array, payload: EncryptedPayload): Promise<string> {
    return this.provider.decryptMessage(conversationKey, payload);
  }

  encryptBinary(conversationKey: Uint8Array, data: Uint8Array): Promise<EncryptedBinaryPayload> {
    return this.provider.encryptBinary(conversationKey, data);
  }

  decryptBinary(conversationKey: Uint8Array, payload: EncryptedBinaryPayload): Promise<Uint8Array> {
    return this.provider.decryptBinary(conversationKey, payload);
  }

  signData(privateKeyJwk: JsonWebKey, data: string): Promise<string> {
    return this.provider.signData(privateKeyJwk, data);
  }

  verifySignature(publicKeyJwk: JsonWebKey, data: string, signature: string): Promise<boolean> {
    return this.provider.verifySignature(publicKeyJwk, data, signature);
  }

  /**
   * Full ECDH key exchange: derive a shared secret then derive the conversation key in one step.
   */
  async deriveConversationKeyFromExchange(
    myEphemeralPrivateKey: JsonWebKey,
    theirEphemeralPublicKey: JsonWebKey,
    conversationId: string
  ): Promise<Uint8Array> {
    const sharedSecret = await this.deriveSharedSecret(myEphemeralPrivateKey, theirEphemeralPublicKey);
    return this.deriveConversationKey(sharedSecret, conversationId);
  }
}
