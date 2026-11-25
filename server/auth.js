import { db } from './db.js';
import { config } from './config.js';
import { randomToken, sha256, safeEqual } from './crypto.js';
import { fail } from './http.js';

export const COOKIE = config.isProd ? '__Host-sd_sid' : 'sd_sid';

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function setCookie(res, value, maxAgeSec) {
  const attrs = [`${COOKIE}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${maxAgeSec}`];
  if (config.isProd) attrs.push('Secure');
  res.append('Set-Cookie', attrs.join('; '));
}

/** Создаёт новую сессию (ротация идентификатора при каждом входе — защита от session fixation). */
export function createSession(req, res, userId) {
  const token = randomToken(32);
  const csrf = randomToken(32);
  const t = Date.now();
  db.prepare(`INSERT INTO sessions (id_hash, user_id, csrf_token, created_at, expires_at, last_seen, ip, user_agent)
              VALUES (?,?,?,?,?,?,?,?)`)
    .run(sha256(token), userId, csrf, t, t + config.sessionTtlMs, t, req.ip ?? null, String(req.get('user-agent') ?? '').slice(0, 200));
  setCookie(res, token, Math.floor(config.sessionTtlMs / 1000));
  return csrf;
}

export function destroySession(req, res) {
  if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(req.sessionHash);
  setCookie(res, '', 0);
}

export function sessionMiddleware(req, res, next) {
  const raw = parseCookies(req.headers.cookie)[COOKIE];
  if (raw) {
    const h = sha256(raw);
    const t = Date.now();
    const s = db.prepare('SELECT * FROM sessions WHERE id_hash = ?').get(h);
    if (s && s.expires_at > t && t - s.last_seen < config.sessionIdleMs) {
      const user = db.prepare('SELECT * FROM users WHERE id = ?').get(s.user_id);
      if (user) {
        req.user = user;
        req.sessionHash = h;
        req.csrfToken = s.csrf_token;
        if (t - s.last_seen > 60_000) db.prepare('UPDATE sessions SET last_seen = ? WHERE id_hash = ?').run(t, h);
      }
    } else if (s) {
      db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(h);
    }
  }
  next();
}

/**
 * CSRF: (1) cookie SameSite=Strict; (2) проверка Origin для небезопасных методов;
 * (3) synchronizer token в заголовке X-CSRF-Token для аутентифицированных запросов;
 * (4) обязательный заголовок X-Requested-With для анонимных (login/register) — его нельзя поставить из HTML-формы.
 */
export function csrfProtect(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.get('origin');
  if (origin) {
    const host = req.get('host');
    let ok = false;
    try { ok = new URL(origin).host === host || origin === config.publicUrl; } catch { ok = false; }
    if (!ok) return next(fail(403, 'Недопустимый Origin', 'bad_origin'));
  }
  if (req.get('x-requested-with') !== 'SafeDeal') return next(fail(403, 'CSRF check failed', 'csrf'));
  if (req.user && !safeEqual(req.get('x-csrf-token'), req.csrfToken)) return next(fail(403, 'CSRF token invalid', 'csrf'));
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return next(fail(401, 'Требуется вход', 'unauthenticated'));
  next();
}
export function requireAdmin(req, res, next) {
  if (!req.user) return next(fail(401, 'Требуется вход', 'unauthenticated'));
  if (req.user.role !== 'admin') return next(fail(403, 'Недостаточно прав', 'forbidden'));
  next();
}
export function requireVerified(req) {
  if (req.user.kyc_status !== 'verified') fail(403, 'Сначала пройдите верификацию личности', 'kyc_required');
}
