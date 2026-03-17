/**
 * Proof of Work solver service.
 * Uses a Web Worker to solve SHA-256 puzzles without blocking the UI.
 */

/**
 * Solve a PoW challenge in a Web Worker.
 * @param {string} challenge - The challenge string from the server
 * @param {number} difficulty - Number of leading zero bits required
 * @param {(iterations: number) => void} [onProgress] - Optional progress callback
 * @returns {Promise<{ nonce: number, hashHex: string, iterations: number }>}
 */
export function solvePoW(challenge, difficulty, onProgress) {
  return new Promise((resolve, reject) => {
    const worker = new Worker('/pow-worker.js');

    worker.onmessage = (e) => {
      if (e.data.type === 'solved') {
        worker.terminate();
        resolve(e.data);
      } else if (e.data.type === 'progress') {
        onProgress?.(e.data.iterations);
      }
    };

    worker.onerror = (err) => {
      worker.terminate();
      reject(new Error('PoW solver failed: ' + (err.message || 'Unknown error')));
    };

    worker.postMessage({ challenge, difficulty });
  });
}
