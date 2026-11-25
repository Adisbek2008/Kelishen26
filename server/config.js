import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(import.meta.dirname, '..');
const isProd = process.env.NODE_ENV === 'production';
export const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
export const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o700 });

/**
 * Мастер-ключ (32 байта, base64) для шифрования PII и файлов.
 * В production обязателен через переменную окружения (а лучше — KMS/Vault).
 * В dev генерируется один раз и хранится в data/.master.key с правами 0600.
 */
function loadMasterKey() {
  const env = process.env.SAFEDEAL_MASTER_KEY;
  if (env) {
    const key = Buffer.from(env, 'base64');
    if (key.length !== 32) throw new Error('SAFEDEAL_MASTER_KEY must be 32 bytes base64');
    return key;
  }
  if (isProd) throw new Error('SAFEDEAL_MASTER_KEY is required in production');
  const file = path.join(DATA_DIR, '.master.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'base64');
}

export const config = {
  isProd,
  port: Number(process.env.PORT || 3000),
  // RENDER_EXTERNAL_URL Render подставляет сам (https://<имя>.onrender.com)
  publicUrl: process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${process.env.PORT || 3000}`,
  dbFile: process.env.DB_FILE || path.join(DATA_DIR, 'safedeal.db'),
  masterKey: loadMasterKey(),
  currency: 'USD',
  feeRate: 0.02,                  // комиссия платформы 2%
  minFeeCents: 100,               // но не меньше $1
  maxDealCents: 5_000_000_00,     // лимит сделки $5M
  sessionTtlMs: 7 * 24 * 3600e3,  // абсолютное время жизни сессии
  sessionIdleMs: 12 * 3600e3,     // таймаут бездействия
  maxLoginFailures: 5,
  lockoutMs: 15 * 60e3,
  maxUploadBytes: 10 * 1024 * 1024,
  autoReleaseDays: 7,             // авто-подтверждение после отметки «доставлено»
};
