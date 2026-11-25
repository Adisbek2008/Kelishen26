import crypto from 'node:crypto';
import { config } from './config.js';

// Отдельные подключи из мастер-ключа (HKDF), чтобы компрометация одного назначения не раскрывала другое
const piiKey = Buffer.from(crypto.hkdfSync('sha256', config.masterKey, Buffer.alloc(0), 'safedeal/pii/v1', 32));
const fileKey = Buffer.from(crypto.hkdfSync('sha256', config.masterKey, Buffer.alloc(0), 'safedeal/files/v1', 32));

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');
export const uuid = () => crypto.randomUUID();
export const sha256 = (data) => crypto.createHash('sha256').update(data).digest('hex');

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a ?? ''));
  const bb = Buffer.from(String(b ?? ''));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// AES-256-GCM: [ver(1) | iv(12) | tag(16) | ciphertext]
function seal(key, plain) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
}
function open(key, buf) {
  if (buf[0] !== 1) throw new Error('unknown ciphertext version');
  const d = crypto.createDecipheriv('aes-256-gcm', key, buf.subarray(1, 13));
  d.setAuthTag(buf.subarray(13, 29));
  return Buffer.concat([d.update(buf.subarray(29)), d.final()]);
}

export const encryptPII = (s) => (s == null ? null : seal(piiKey, Buffer.from(String(s), 'utf8')).toString('base64'));
export const decryptPII = (s) => (s == null ? null : open(piiKey, Buffer.from(s, 'base64')).toString('utf8'));
export const encryptFile = (buf) => seal(fileKey, buf);
export const decryptFile = (buf) => open(fileKey, buf);
