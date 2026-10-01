// Holds the pairing QR string Baileys most recently emitted.
//
// Baileys hands us the raw QR payload as a string, which only renders usefully
// as terminal ASCII art -- and on a PaaS platform the terminal is wrapped and
// unreadable. The health server turns this string into a PNG on demand, so the
// module only needs to remember the latest payload and when it arrived.

let currentQR = null;
let generatedAt = null;

/** Store the QR payload from the Baileys 'qr' event. */
export function setQR(qr) {
  currentQR = qr || null;
  generatedAt = new Date().toISOString();
}

/** @returns {string|null} the current QR payload, or null when there is none */
export function getQR() {
  return currentQR;
}

/** @returns {string|null} ISO timestamp of the last setQR() call */
export function getQRGeneratedAt() {
  return generatedAt;
}

/** Drop the QR -- called once the socket is connected, or when it expires. */
export function clearQR() {
  currentQR = null;
  generatedAt = null;
}