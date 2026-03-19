/**
 * Node.js crypto provider.
 * Uses the built-in `node:crypto` module. All methods are async to match
 * the CryptoProvider interface (even though the underlying Node APIs are sync).
 */
import * as nodeCrypto from 'node:crypto';
import type { CryptoProvider, IdentityKeyPair, ECDHKeyPair, EncryptedPayload, EncryptedBinaryPayload } from '../types.js';

const HKDF_INFO = Buffer.from('blink-text-v1', 'utf8');
const AES_KEY_LENGTH = 32; // 256-bit

export class NodeProvider implements CryptoProvider {
  async generateIdentityKey(): Promise<IdentityKeyPair> {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    return {
      publicKey: publicKey.export({ format: 'jwk' }) as JsonWebKey,
      privateKey: privateKey.export({ format: 'jwk' }) as JsonWebKey,
    };
  }

  async generateECDHKey(): Promise<ECDHKeyPair> {
    const { publicKey, privateKey } = nodeCrypto.generateKeyPairSync('ec', {
      namedCurve: 'P-256',
    });
    return {
      publicKey: publicKey.export({ format: 'jwk' }) as JsonWebKey,
      privateKey: privateKey.export({ format: 'jwk' }) as JsonWebKey,
    };
  }

  async deriveSharedSecret(privateKeyJwk: JsonWebKey, publicKeyJwk: JsonWebKey): Promise<Uint8Array> {
    const privKey = nodeCrypto.createPrivateKey({ key: privateKeyJwk, format: 'jwk' } as nodeCrypto.JsonWebKeyInput);
    const pubKey = nodeCrypto.createPublicKey({ key: publicKeyJwk, format: 'jwk' } as nodeCrypto.JsonWebKeyInput);
    const secret = nodeCrypto.diffieHellman({ privateKey: privKey, publicKey: pubKey });
    return new Uint8Array(secret);
  }

  async deriveConversationKey(sharedSecret: Uint8Array, conversationId: string): Promise<Uint8Array> {
    const salt = Buffer.from(conversationId, 'utf8');
    const key = nodeCrypto.hkdfSync(
      'sha256',
      Buffer.from(sharedSecret),
      salt,
      HKDF_INFO,
      AES_KEY_LENGTH
    );
    return new Uint8Array(key);
  }

  async encryptMessage(conversationKey: Uint8Array, plaintext: string): Promise<EncryptedPayload> {
    const keyBuf = Buffer.from(conversationKey);
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Append 16-byte GCM auth tag after ciphertext, matching Web Crypto API's behavior.
    const combined = Buffer.concat([encrypted, tag]);
    return {
      ciphertext: combined.toString('base64'),
      iv: iv.toString('base64'),
      version: 'v1',
    };
  }

  async decryptMessage(conversationKey: Uint8Array, payload: EncryptedPayload): Promise<string> {
    const keyBuf = Buffer.from(conversationKey);
    const ivBuf = Buffer.from(payload.iv, 'base64');
    const combined = Buffer.from(payload.ciphertext, 'base64');
    const tag = combined.subarray(combined.length - 16);
    const encrypted = combined.subarray(0, combined.length - 16);
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  async encryptBinary(conversationKey: Uint8Array, data: Uint8Array): Promise<EncryptedBinaryPayload> {
    const keyBuf = Buffer.from(conversationKey);
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(data)), cipher.final()]);
    const tag = cipher.getAuthTag();
    const combined = Buffer.concat([encrypted, tag]);
    return { encrypted: new Uint8Array(combined), iv: new Uint8Array(iv) };
  }

  async decryptBinary(conversationKey: Uint8Array, payload: EncryptedBinaryPayload): Promise<Uint8Array> {
    const keyBuf = Buffer.from(conversationKey);
    const ivBuf = Buffer.from(payload.iv);
    const combined = Buffer.from(payload.encrypted);
    const tag = combined.subarray(combined.length - 16);
    const encrypted = combined.subarray(0, combined.length - 16);
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]));
  }

  async signData(privateKeyJwk: JsonWebKey, data: string): Promise<string> {
    const privKey = nodeCrypto.createPrivateKey({ key: privateKeyJwk, format: 'jwk' } as nodeCrypto.JsonWebKeyInput);
    const sig = nodeCrypto.sign('SHA256', Buffer.from(data, 'utf8'), { key: privKey, dsaEncoding: 'ieee-p1363' });
    return sig.toString('base64');
  }

  async verifySignature(publicKeyJwk: JsonWebKey, data: string, signature: string): Promise<boolean> {
    const pubKey = nodeCrypto.createPublicKey({ key: publicKeyJwk, format: 'jwk' } as nodeCrypto.JsonWebKeyInput);
    return nodeCrypto.verify(
      'SHA256',
      Buffer.from(data, 'utf8'),
      { key: pubKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64')
    );
  }

  // ── Sender Key methods (group encryption) ──────────────────────────

  async generateSenderKey(): Promise<Uint8Array> {
    return new Uint8Array(nodeCrypto.randomBytes(32));
  }

  async encryptSenderKey(pairwiseKey: Uint8Array, senderKey: Uint8Array): Promise<{ ciphertext: string; iv: string }> {
    const keyBuf = Buffer.from(pairwiseKey);
    const iv = nodeCrypto.randomBytes(12);
    const cipher = nodeCrypto.createCipheriv('aes-256-gcm', keyBuf, iv);
    const encrypted = Buffer.concat([cipher.update(Buffer.from(senderKey)), cipher.final()]);
    const tag = cipher.getAuthTag();
    // Append 16-byte GCM auth tag after ciphertext, matching Web Crypto API's behavior.
    const combined = Buffer.concat([encrypted, tag]);
    return {
      ciphertext: combined.toString('base64'),
      iv: iv.toString('base64'),
    };
  }

  async decryptSenderKey(pairwiseKey: Uint8Array, ciphertext: string, iv: string): Promise<Uint8Array> {
    const keyBuf = Buffer.from(pairwiseKey);
    const ivBuf = Buffer.from(iv, 'base64');
    const combined = Buffer.from(ciphertext, 'base64');
    const tag = combined.subarray(combined.length - 16);
    const encrypted = combined.subarray(0, combined.length - 16);
    const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', keyBuf, ivBuf);
    decipher.setAuthTag(tag);
    return new Uint8Array(Buffer.concat([decipher.update(encrypted), decipher.final()]));
  }
}

export default new NodeProvider();
