// AES-256-GCM encryption/decryption for protecting tokens at rest in KV
// Uses Web Crypto API (available in Cloudflare Workers)

const ALGORITHM = "AES-GCM";
const IV_LENGTH = 12; // 96 bits recommended for AES-GCM
const KEY_LENGTH = 256;

/**
 * Import a hex-encoded 32-byte key into a CryptoKey for AES-256-GCM.
 */
async function importKey(hexKey: string): Promise<CryptoKey> {
	const keyBytes = hexToBytes(hexKey);
	if (keyBytes.length !== 32) {
		throw new Error(
			`KV_ENCRYPTION_KEY must be exactly 32 bytes (64 hex chars), got ${keyBytes.length} bytes`,
		);
	}
	return crypto.subtle.importKey("raw", keyBytes, { name: ALGORITHM, length: KEY_LENGTH }, false, [
		"encrypt",
		"decrypt",
	]);
}

/**
 * Encrypt plaintext string to base64-encoded ciphertext with prepended IV.
 * Format: base64(IV || ciphertext || tag)
 */
export async function encrypt(plaintext: string, hexKey: string): Promise<string> {
	const key = await importKey(hexKey);
	const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
	const encoded = new TextEncoder().encode(plaintext);

	const ciphertext = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);

	// Combine IV + ciphertext into a single buffer
	const combined = new Uint8Array(IV_LENGTH + ciphertext.byteLength);
	combined.set(iv, 0);
	combined.set(new Uint8Array(ciphertext), IV_LENGTH);

	return bytesToBase64(combined);
}

/**
 * Decrypt base64-encoded ciphertext (with prepended IV) back to plaintext.
 */
export async function decrypt(base64Ciphertext: string, hexKey: string): Promise<string> {
	const key = await importKey(hexKey);
	const combined = base64ToBytes(base64Ciphertext);

	if (combined.length < IV_LENGTH + 1) {
		throw new Error("Ciphertext too short to contain IV and data");
	}

	const iv = combined.slice(0, IV_LENGTH);
	const ciphertext = combined.slice(IV_LENGTH);

	const decrypted = await crypto.subtle.decrypt({ name: ALGORITHM, iv }, key, ciphertext);

	return new TextDecoder().decode(decrypted);
}

// --- Helpers ---

function hexToBytes(hex: string): Uint8Array {
	const clean = hex.replace(/\s/g, "");
	if (clean.length % 2 !== 0) throw new Error("Hex string must have even length");
	const bytes = new Uint8Array(clean.length / 2);
	for (let i = 0; i < bytes.length; i++) {
		bytes[i] = parseInt(clean.substring(i * 2, i * 2 + 2), 16);
	}
	return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
