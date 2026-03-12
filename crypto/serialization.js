'use strict';

/**
 * Utility functions for serializing/deserializing cryptographic material.
 */

/**
 * Convert an ArrayBuffer (or Buffer) to a base64 string.
 * @param {ArrayBuffer | Buffer} buffer
 * @returns {string}
 */
function arrayBufferToBase64(buffer) {
  return Buffer.from(buffer).toString('base64');
}

/**
 * Convert a base64 string to an ArrayBuffer.
 * @param {string} base64
 * @returns {ArrayBuffer}
 */
function base64ToArrayBuffer(base64) {
  const buf = Buffer.from(base64, 'base64');
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}

/**
 * Serialize a JWK object to a JSON string.
 * @param {Object} jwk
 * @returns {string}
 */
function jwkToString(jwk) {
  return JSON.stringify(jwk);
}

/**
 * Deserialize a JSON string back to a JWK object.
 * @param {string} str
 * @returns {Object}
 */
function stringToJwk(str) {
  return JSON.parse(str);
}

module.exports = {
  arrayBufferToBase64,
  base64ToArrayBuffer,
  jwkToString,
  stringToJwk,
};
