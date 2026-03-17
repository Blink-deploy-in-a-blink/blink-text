/**
 * Proof of Work solver — runs in a Web Worker so the main thread stays responsive.
 *
 * Receives: { challenge: string, difficulty: number }
 * Responds: { nonce: number, hashHex: string, iterations: number }
 *
 * Finds a nonce such that SHA-256(challenge + nonce) starts with `difficulty` zero bits.
 */
self.onmessage = async function (e) {
  const { challenge, difficulty } = e.data;
  const encoder = new TextEncoder();

  let nonce = 0;
  const batchSize = 5000; // check in batches so we can report progress

  while (true) {
    for (let i = 0; i < batchSize; i++) {
      const input = encoder.encode(challenge + String(nonce));
      const hashBuffer = await crypto.subtle.digest('SHA-256', input);
      const hashArray = new Uint8Array(hashBuffer);

      if (checkLeadingZeroBits(hashArray, difficulty)) {
        // Convert hash to hex for debugging/display
        const hashHex = Array.from(hashArray)
          .map((b) => b.toString(16).padStart(2, '0'))
          .join('');
        self.postMessage({ type: 'solved', nonce, hashHex, iterations: nonce + 1 });
        return;
      }
      nonce++;
    }
    // Report progress every batch so UI can show status
    self.postMessage({ type: 'progress', iterations: nonce });
  }
};

/**
 * Check if a hash has at least `bits` leading zero bits.
 */
function checkLeadingZeroBits(hash, bits) {
  const fullBytes = Math.floor(bits / 8);
  for (let i = 0; i < fullBytes; i++) {
    if (hash[i] !== 0) return false;
  }
  const remaining = bits % 8;
  if (remaining > 0) {
    if ((hash[fullBytes] >> (8 - remaining)) !== 0) return false;
  }
  return true;
}
