import { Router } from 'express';
import { hash, verify } from '@node-rs/argon2';
import { db, now } from '../db.js';
import { config } from '../config.js';
import { uuid } from '../crypto.js';
import { audit } from '../audit.js';
import { balance } from '../ledger.js';
import { parse, fail, z, clientIp } from '../http.js';
import { createSession, destroySession, requireAuth } from '../auth.js';
import { userStats } from '../services.js';

// Параметры Argon2id по рекомендации OWASP (m=19 MiB, t=2, p=1)
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
const COMMON = new Set(['password', 'password1', 'qwerty123', '1234567890', '12345678', 'qwertyuiop', 'iloveyou', 'admin12345', 'password123']);
// Фиктивный хэш: при несуществующем email всё равно выполняем verify — одинаковое время ответа (нет user enumeration)
const DUMMY_HASH = await hash('dummy-password-for-timing', ARGON);

const zPassword = z.string().min(10, 'минимум 10 символов').max(128)
  .refine((p) => !COMMON.has(p.toLowerCase()), 'слишком простой пароль')
  .refine((p) => /[a-zA-Zа-яА-Я]/.test(p) && /\d/.test(p), 'нужны буквы и цифры');

export function me(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    kycStatus: u.kyc_status, kycNote: u.kyc_note,
    card: u.card_last4 ? { brand: u.card_brand, last4: u.card_last4, exp: u.card_exp } : null,
    balanceCents: balance('user:' + u.id),
    notifyEmail: !!u.notify_email,
    unread: db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND is_read = 0').get(u.id).n,
    createdAt: u.created_at,
    ...userStats(u.id),
  };
}

const r = Router();

r.post('/register', async (req, res) => {
  const body = parse(z.object({
    name: z.string().trim().min(2).max(60),
    email: z.email().max(254).transform((e) => e.toLowerCase()),
    password: zPassword,
  }), req.body);
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(body.email)) fail(409, 'Не удалось зарегистрироваться с этим email', 'register_failed');
  const id = uuid();
  db.prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?,?,?,?,?)')
    .run(id, body.email, body.name, await hash(body.password, ARGON), now());
  audit({ actorId: id, action: 'user.register', entity: 'user', entityId: id, ip: clientIp(req) });
  const csrfToken = createSession(req, res, id);
  res.status(201).json({ user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(id)), csrfToken });
});

r.post('/login', async (req, res) => {
  const body = parse(z.object({ email: z.string().trim().toLowerCase().max(254), password: z.string().max(128) }), req.body);
  const u = db.prepare('SELECT * FROM users WHERE email = ?').get(body.email);
  const t = Date.now();
  if (u && u.locked_until > t) {
    audit({ actorId: u.id, action: 'auth.login_locked', entity: 'user', entityId: u.id, ip: clientIp(req) });
    fail(429, 'Слишком много попыток. Попробуйте через 15 минут', 'locked');
  }
  const ok = await verify(u?.password_hash ?? DUMMY_HASH, body.password);
  if (!u || !ok) {
    if (u) {
      const failures = u.failed_logins + 1;
      const lock = failures >= config.maxLoginFailures ? t + config.lockoutMs : 0;
      db.prepare('UPDATE users SET failed_logins = ?, locked_until = ? WHERE id = ?').run(lock ? 0 : failures, lock, u.id);
      audit({ actorId: u.id, action: lock ? 'auth.account_locked' : 'auth.login_failed', entity: 'user', entityId: u.id, ip: clientIp(req) });
    }
    fail(401, 'Неверный email или пароль', 'bad_credentials');
  }
  db.prepare('UPDATE users SET failed_logins = 0, locked_until = 0 WHERE id = ?').run(u.id);
  audit({ actorId: u.id, action: 'auth.login', entity: 'user', entityId: u.id, ip: clientIp(req) });
  const csrfToken = createSession(req, res, u.id);
  res.json({ user: me(u), csrfToken });
});

r.post('/logout', (req, res) => {
  if (req.user) audit({ actorId: req.user.id, action: 'auth.logout', ip: clientIp(req) });
  destroySession(req, res);
  res.json({ ok: true });
});

r.get('/me', (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: me(req.user), csrfToken: req.csrfToken });
});

r.get('/sessions', requireAuth, (req, res) => {
  const rows = db.prepare('SELECT id_hash, created_at, last_seen, ip, user_agent FROM sessions WHERE user_id = ? ORDER BY last_seen DESC').all(req.user.id);
  res.json(rows.map((s) => ({ current: s.id_hash === req.sessionHash, createdAt: s.created_at, lastSeen: s.last_seen, ip: s.ip, userAgent: s.user_agent })));
});

r.post('/logout-others', requireAuth, (req, res) => {
  const n = db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(req.user.id, req.sessionHash).changes;
  audit({ actorId: req.user.id, action: 'auth.logout_others', meta: { n }, ip: clientIp(req) });
  res.json({ ok: true, closed: n });
});

r.post('/password', requireAuth, async (req, res) => {
  const body = parse(z.object({ current: z.string().max(128), next: zPassword }), req.body);
  if (!(await verify(req.user.password_hash, body.current))) fail(400, 'Текущий пароль неверен', 'bad_password');
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hash(body.next, ARGON), req.user.id);
  // Смена пароля завершает все остальные сессии
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(req.user.id, req.sessionHash);
  audit({ actorId: req.user.id, action: 'auth.password_changed', ip: clientIp(req) });
  res.json({ ok: true });
});

r.patch('/settings', requireAuth, (req, res) => {
  const body = parse(z.object({ notifyEmail: z.boolean().optional(), name: z.string().trim().min(2).max(60).optional() }), req.body);
  if (body.notifyEmail !== undefined) db.prepare('UPDATE users SET notify_email = ? WHERE id = ?').run(body.notifyEmail ? 1 : 0, req.user.id);
  if (body.name !== undefined) db.prepare('UPDATE users SET name = ? WHERE id = ?').run(body.name, req.user.id);
  res.json({ user: me(db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id)) });
});

export default r;
