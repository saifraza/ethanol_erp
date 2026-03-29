/**
 * UBI H2H Bank File Encryption — AES-256-GCM
 *
 * Ported from Java: com.intellect.h2h.util.AESFileCryption
 * Algorithm: AES/GCM/NoPadding
 * Key derivation: PBKDF2WithHmacSHA256, 65536 iterations, 256-bit key
 * GCM tag length: 128 bits
 *
 * Reads keys from env vars: UBI_ENC_KEY, UBI_ENC_IV, UBI_ENC_SALT
 * If not set, returns plaintext (mock mode for testing).
 */

import crypto from 'crypto';

const ITERATION_COUNT = 65536;
const KEY_LENGTH = 32; // 256 bits = 32 bytes
const TAG_LENGTH = 16; // 128 bits = 16 bytes
const ALGORITHM = 'aes-256-gcm';

interface EncryptionConfig {
  password: string;
  iv: string;
  salt: string;
}

/** Get encryption config from env vars. Returns null if not configured. */
function getConfig(): EncryptionConfig | null {
  const password = process.env.UBI_ENC_KEY;
  const iv = process.env.UBI_ENC_IV;
  const salt = process.env.UBI_ENC_SALT;
  if (!password || !iv || !salt) return null;
  return { password, iv, salt };
}

/** Derive AES-256 key from password using PBKDF2 (matches Java getAESKeyFromPassword) */
function deriveKey(password: string, salt: Buffer): Buffer {
  return crypto.pbkdf2Sync(password, salt, ITERATION_COUNT, KEY_LENGTH, 'sha256');
}

/**
 * Encrypt a buffer using AES-256-GCM.
 * Matches Java: cipher.init(ENCRYPT_MODE, key, GCMParameterSpec(128, IV.getBytes()))
 * Java appends auth tag via cipher.doFinal() — we do the same.
 *
 * Output format: [encrypted data][16-byte GCM auth tag]
 */
export function encryptBuffer(data: Buffer, config?: EncryptionConfig): Buffer {
  const cfg = config || getConfig();
  if (!cfg) {
    console.log('[BankEncryption] No encryption keys configured — returning plaintext (mock mode)');
    return data;
  }

  const saltBytes = Buffer.from(cfg.salt, 'utf-8');
  const ivBytes = Buffer.from(cfg.iv, 'utf-8');
  const key = deriveKey(cfg.password, saltBytes);

  const cipher = crypto.createCipheriv(ALGORITHM, key, ivBytes, { authTagLength: TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Java GCM appends auth tag to ciphertext — match that behavior
  return Buffer.concat([encrypted, authTag]);
}

/**
 * Decrypt a buffer using AES-256-GCM.
 * Input format: [encrypted data][16-byte GCM auth tag]
 */
export function decryptBuffer(data: Buffer, config?: EncryptionConfig): Buffer {
  const cfg = config || getConfig();
  if (!cfg) {
    console.log('[BankEncryption] No encryption keys configured — returning data as-is (mock mode)');
    return data;
  }

  const saltBytes = Buffer.from(cfg.salt, 'utf-8');
  const ivBytes = Buffer.from(cfg.iv, 'utf-8');
  const key = deriveKey(cfg.password, saltBytes);

  // Split ciphertext and auth tag
  const authTag = data.slice(data.length - TAG_LENGTH);
  const ciphertext = data.slice(0, data.length - TAG_LENGTH);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, ivBytes, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

/** Check if encryption is configured */
export function isEncryptionConfigured(): boolean {
  return getConfig() !== null;
}
