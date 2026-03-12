/**
 * Browser crypto provider using the Web Crypto API (globalThis.crypto.subtle).
 * All methods return Promises to match the CryptoProvider interface.
 */
import type { CryptoProvider, IdentityKeyPair, ECDHKeyPair, EncryptedPayload } from '../types.js';

const subtle = globalThis.crypto.subtle;

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToBuf(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export class BrowserProvider implements CryptoProvider {
  async generateIdentityKey(): Promise<IdentityKeyPair> {
    const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
    const [pub, priv] = await Promise.all([
      subtle.exportKey('jwk', kp.publicKey),
      subtle.exportKey('jwk', kp.privateKey),
    ]);
    return { publicKey: pub, privateKey: priv };
  }

  async generateECDHKey(): Promise<ECDHKeyPair> {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey', 'deriveBits']);
    const [pub, priv] = await Promise.all([
      subtle.exportKey('jwk', kp.publicKey),
      subtle.exportKey('jwk', kp.privateKey),
    ]);
    return { publicKey: pub, privateKey: priv };
  }

  async deriveSharedSecret(privateKeyJwk: JsonWebKey, publicKeyJwk: JsonWebKey): Promise<Uint8Array> {
    const [privKey, pubKey] = await Promise.all([
      subtle.importKey('jwk', privateKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']),
      subtle.importKey('jwk', publicKeyJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, []),
    ]);
    const bits = await subtle.deriveBits({ name: 'ECDH', public: pubKey }, privKey, 256);
    return new Uint8Array(bits);
  }

  async deriveConversationKey(sharedSecret: Uint8Array, conversationId: string): Promise<Uint8Array> {
    const baseKey = await subtle.importKey('raw', sharedSecret as unknown as ArrayBuffer, { name: 'HKDF' }, false, ['deriveKey']);
    const salt = new TextEncoder().encode(conversationId);
    const info = new TextEncoder().encode('blink-text-v1');
    const aesKey = await subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt, info },
      baseKey,
      { name: 'AES-GCM', length: 256 },
      true,  // extractable so we can export as raw bytes
      ['encrypt', 'decrypt']
    );
    const rawKey = await subtle.exportKey('raw', aesKey);
    return new Uint8Array(rawKey);
  }

  async encryptMessage(conversationKey: Uint8Array, plaintext: string): Promise<EncryptedPayload> {
    const aesKey = await subtle.importKey('raw', conversationKey as unknown as ArrayBuffer, { name: 'AES-GCM' }, false, ['encrypt']);
    const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);
    const ciphertextBuf = await subtle.encrypt({ name: 'AES-GCM', iv: iv as unknown as BufferSource }, aesKey, encoded as unknown as BufferSource);
    return {
      ciphertext: bufToBase64(ciphertextBuf),
      iv: bufToBase64(iv),
      version: 'v1',
    };
  }

  async decryptMessage(conversationKey: Uint8Array, payload: EncryptedPayload): Promise<string> {
    const aesKey = await subtle.importKey('raw', conversationKey as unknown as ArrayBuffer, { name: 'AES-GCM' }, false, ['decrypt']);
    const ciphertextBuf = base64ToBuf(payload.ciphertext);
    const ivBuf = base64ToBuf(payload.iv);
    const plainBuf = await subtle.decrypt({ name: 'AES-GCM', iv: ivBuf as unknown as BufferSource }, aesKey, ciphertextBuf as unknown as BufferSource);
    return new TextDecoder().decode(plainBuf);
  }

  async signData(privateKeyJwk: JsonWebKey, data: string): Promise<string> {
    const privKey = await subtle.importKey('jwk', privateKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
    const sig = await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privKey, new TextEncoder().encode(data) as unknown as BufferSource);
    return bufToBase64(sig);
  }

  async verifySignature(publicKeyJwk: JsonWebKey, data: string, signature: string): Promise<boolean> {
    const pubKey = await subtle.importKey('jwk', publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pubKey,
      base64ToBuf(signature) as unknown as BufferSource,
      new TextEncoder().encode(data) as unknown as BufferSource
    );
  }
}

export default new BrowserProvider();
